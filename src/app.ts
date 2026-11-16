import {
  ACESFilmicToneMapping, Box3, Clock, Euler, Matrix4, Object3D, PCFShadowMap, PerspectiveCamera, PMREMGenerator,
  Quaternion, Raycaster, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DOCTOR, LOOK, SCENARIOS, VIEWMODEL, type ScenarioId, type Side } from './config';
import { World } from './core/world';
import { downloadPatient, Patient } from './core/patient';
import { Sequencia, type Fase } from './game/anim';
import { Highlighter } from './game/highlight';
import { pick, type PickTarget } from './game/picking';
import { Hand } from './hands/hand';
import { leanIntent, lookIntent } from './input/controls';
import { Input } from './input/input';
import { gripQuat, readyHandQuat, Tool, TOOL_DEFS, TRAY_SIZE, TRAY_TOP, type ToolId } from './tools/tools';
import { UI } from './ui/ui';

const SIDES: Side[] = ['left', 'right'];
const Y = new Vector3(0, 1, 0);
/** Camadas de renderização: mundo (com oclusão) e camada FPS (mãos em repouso, por cima da cena). */
const LAYER_WORLD = 0;
const LAYER_FPS = 1;
/** Mão livre em repouso: palma para baixo, dedos levemente caídos. */
const Q_LIVRE = new Quaternion().setFromEuler(new Euler(0.35, 0, 0));
/** Mão sobre a bandeja: palma para baixo, dedos apontando para a direita do médico. */
const Q_BANDEJA = new Quaternion().setFromAxisAngle(Y, -Math.PI / 2);
/** Mão que toca o paciente: dedos apontando para baixo e para frente. */
const Q_TOQUE = new Quaternion().setFromEuler(new Euler(0.8, 0, 0));

type State = 'menu' | 'jogo' | 'pausa';
interface Pose { pos: Vector3; quat: Quaternion }

/** O que pode estar sob o cursor. */
export type TargetId = { tipo: 'ferramenta'; tool: Tool } | { tipo: 'bandeja' } | { tipo: 'cabeca' } | { tipo: 'boca' };

export const sideName = (s: Side): string => (s === 'left' ? 'esquerda' : 'direita');

export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(58, 1, 0.01, 30);
  readonly input: Input;
  readonly world = new World();
  readonly hands: Record<Side, Hand>;
  readonly tools: Tool[];
  readonly ui: UI;
  readonly highlight = new Highlighter();

  state: State = 'menu';
  scenario: ScenarioId = 'easy';
  /** Mão que age no clique (Tab alterna). */
  active: Side = 'right';
  elapsed = 0;
  /** Quadros renderizados (os testes usam para esperar a cena atualizar). */
  frames = 0;
  /** Cliques de ação feitos na partida (base da contagem de cliques extras no fim). */
  clicks = 0;
  /** Alvo sob o cursor neste quadro. */
  hover: TargetId | null = null;
  /** Câmera livre para inspeção (testes/screenshots). null = visão do médico. */
  debugView: { pos: Vector3; target: Vector3 } | null = null;

  private readonly clock = new Clock();
  private readonly raycaster = new Raycaster();
  private readonly lean = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /** Visão do médico (a câmera copia daqui, exceto em `debugView`). */
  private readonly view = new Object3D();
  /** Inversa da visão padrão: converte poses "do mundo na visão padrão" em poses presas à câmera. */
  private readonly nominalInv: Matrix4;
  private readonly delta = new Matrix4();
  private readonly deltaQ = new Quaternion();
  /** Animação em andamento de cada mão (null = em repouso na camada FPS). */
  private readonly acting: Record<Side, Sequencia | null> = { left: null, right: null };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.autoClear = false;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    container.append(canvas);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.input = new Input(canvas);
    this.scene.add(this.world.group, this.highlight.ring);
    // As luzes iluminam as duas camadas (as mãos em repouso são desenhadas numa passada separada).
    this.scene.traverse((o) => {
      if ((o as unknown as { isLight?: boolean }).isLight) o.layers.enableAll();
    });
    this.hands = { left: new Hand('left', this.scene), right: new Hand('right', this.scene) };
    this.tools = TOOL_DEFS.map((d) => new Tool(d));

    this.view.position.copy(DOCTOR.eye);
    this.view.lookAt(DOCTOR.lookAt);
    this.view.rotateY(Math.PI); // Object3D.lookAt aponta +Z; a câmera olha por -Z
    this.view.updateMatrixWorld();
    this.nominalInv = this.view.matrixWorld.clone().invert();

    this.ui = new UI(container);
    this.ui.onStart = (c) => this.start(c.scenario);
    this.ui.onResume = () => this.resume();
    this.reset();
    this.ui.showMenu(false);
    void this.loadPatient();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'jogo') this.pause();
        else if (this.state === 'pausa') this.resume();
      }
    });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Baixa o paciente real (≈14 MB) em segundo plano; até lá a cena usa o manequim. */
  private async loadPatient(): Promise<void> {
    try {
      const gltf = await downloadPatient('paciente.json', (f) => this.ui.setPatientStatus(`Paciente: carregando ${Math.round(f * 100)}%`));
      this.ui.setPatientStatus('Paciente: preparando…');
      const patient = new Patient(gltf, { mattressTop: 0.92, headTopZ: -0.13 });
      this.world.setPatient(patient);
      this.ui.setPatientStatus('Paciente pronto.');
      if (this.state === 'jogo') this.ui.flash('Paciente carregado');
    } catch (e) {
      console.error(e);
      this.ui.setPatientStatus(`Não foi possível carregar o paciente (${(e as Error).message}). O manequim será usado.`);
    }
  }

  // ------------------------------------------------------------------ estados
  start(scenario: ScenarioId): void {
    this.scenario = scenario;
    this.world.applyScenario(SCENARIOS[scenario]);
    this.reset();
    this.state = 'jogo';
    this.input.enabled = true;
    this.ui.showGame();
    this.ui.toggleHelp(true);
    this.renderer.domElement.focus();
  }

  pause(): void {
    this.state = 'pausa';
    this.input.enabled = false;
    this.setHover(null);
    this.ui.showMenu(true);
  }

  resume(): void {
    this.state = 'jogo';
    this.input.enabled = true;
    this.ui.showGame();
    this.renderer.domElement.focus();
  }

  /** Mãos livres em repouso, ferramentas na bandeja, visão centralizada. */
  reset(): void {
    for (const t of this.tools) t.placeOnTray(this.world.group);
    this.lean.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.active = 'right';
    this.elapsed = 0;
    this.clicks = 0;
    this.updateView();
    for (const side of SIDES) {
      const h = this.hands[side];
      h.tool = null;
      h.curlOverride = null;
      this.acting[side] = null;
      const rest = this.restPose(side);
      h.place(rest.pos, rest.quat);
      h.setLayer(LAYER_FPS);
    }
    this.setHover(null);
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ mãos: repouso e ações
  busy(side: Side): boolean {
    return this.acting[side] !== null;
  }

  /** Pose de repouso da mão, presa à câmera (parte de baixo da tela), segurando o instrumento atual. */
  private restPose(side: Side): Pose {
    const h = this.hands[side];
    const pos = VIEWMODEL.rest[side].clone();
    if (side === this.active) pos.add(VIEWMODEL.activeLift);
    const quat = h.tool ? readyHandQuat(h.tool.def, side) : Q_LIVRE.clone();
    return { pos: pos.applyMatrix4(this.delta), quat: quat.premultiply(this.deltaQ) };
  }

  /** Inicia uma animação no mundo: a mão sai da camada FPS e volta a ela no fim. */
  private act(side: Side, fases: Fase[]): void {
    const hand = this.hands[side];
    hand.setLayer(LAYER_WORLD);
    this.acting[side] = new Sequencia(fases);
  }

  /** Fase que leva a mão da pose atual até `destino` (reavaliado a cada quadro). */
  private ir(side: Side, destino: () => Pose, dur: number, extra: Omit<Fase, 'dur'> = {}): Fase {
    const hand = this.hands[side];
    const p0 = new Vector3();
    const q0 = new Quaternion();
    return {
      dur,
      inicio: () => {
        p0.copy(hand.root.position);
        q0.copy(hand.root.quaternion);
        extra.inicio?.();
      },
      update: (t) => {
        const d = destino();
        hand.root.position.lerpVectors(p0, d.pos, t);
        hand.root.quaternion.slerpQuaternions(q0, d.quat, t);
        extra.update?.(t);
      },
      fim: extra.fim,
    };
  }

  /** Pega um instrumento da bandeja: a mão vai até ele, fecha, acomoda na empunhadura e volta para a tela. */
  pickUp(side: Side, tool: Tool): void {
    const hand = this.hands[side];
    if (hand.tool || tool.holder || this.busy(side)) return;
    tool.holder = side; // reservado: deixa de ser clicável
    const grab = tool.gripWorld().add(new Vector3(0, 0.02, 0));
    const above = grab.clone().add(new Vector3(0, 0.1, 0));
    const p0 = new Vector3();
    const q0 = new Quaternion();
    const grip = gripQuat(side);
    hand.curlOverride = 0;
    this.act(side, [
      this.ir(side, () => ({ pos: above, quat: Q_BANDEJA }), 0.5),
      this.ir(side, () => ({ pos: grab, quat: Q_BANDEJA }), 0.22),
      this.ir(side, () => ({ pos: above, quat: Q_BANDEJA }), 0.35, {
        inicio: () => {
          hand.tool = tool;
          hand.curlOverride = null;
          tool.attachTo(hand.anchor, side, true);
          p0.copy(tool.object.position);
          q0.copy(tool.object.quaternion);
        },
        update: (t) => {
          tool.object.position.copy(p0).multiplyScalar(1 - t);
          tool.object.quaternion.slerpQuaternions(q0, grip, t);
        },
        fim: () => this.ui.flash(`Mão ${sideName(side)}: ${tool.def.nome}`),
      }),
      this.ir(side, () => this.restPose(side), 0.55),
    ]);
  }

  /** Devolve à bandeja o instrumento que a mão segura. */
  putBack(side: Side): void {
    const hand = this.hands[side];
    const tool = hand.tool;
    if (!tool || this.busy(side)) return;
    const slot = tool.trayPose();
    const drop = slot.pos.clone().add(new Vector3(0, 0.02, 0));
    const above = drop.clone().add(new Vector3(0, 0.1, 0));
    const p0 = new Vector3();
    const q0 = new Quaternion();
    this.act(side, [
      this.ir(side, () => ({ pos: above, quat: Q_BANDEJA }), 0.55),
      this.ir(side, () => ({ pos: drop, quat: Q_BANDEJA }), 0.25, {
        inicio: () => {
          this.world.group.attach(tool.object);
          tool.setLight(false);
          hand.tool = null;
          hand.curlOverride = 0;
          p0.copy(tool.object.position);
          q0.copy(tool.object.quaternion);
        },
        update: (t) => {
          tool.object.position.lerpVectors(p0, slot.pos, t);
          tool.object.quaternion.slerpQuaternions(q0, slot.quat, t);
        },
        fim: () => tool.placeOnTray(this.world.group),
      }),
      this.ir(side, () => this.restPose(side), 0.55, { fim: () => (hand.curlOverride = null) }),
    ]);
  }

  /** Leva a ponta do dedo (ou do instrumento) até um ponto do mundo e volta. `aoTocar` roda no contato. */
  touch(side: Side, ponto: Vector3, aoTocar?: () => void): void {
    const hand = this.hands[side];
    if (this.busy(side)) return;
    hand.root.updateMatrixWorld(true);
    const tipLocal = hand.root.worldToLocal(hand.tipWorld());
    const quat = hand.tool ? readyHandQuat(hand.tool.def, side) : Q_TOQUE.clone();
    const pos = ponto.clone().sub(tipLocal.applyQuaternion(quat));
    const pre = pos.clone().add(new Vector3(0, 0.06, -0.04));
    this.act(side, [
      this.ir(side, () => ({ pos: pre, quat }), 0.5),
      this.ir(side, () => ({ pos, quat }), 0.22, { fim: aoTocar }),
      { dur: 0.3 },
      this.ir(side, () => this.restPose(side), 0.55),
    ]);
  }

  /** Coloca (ou tira, com null) um instrumento na mão instantaneamente. Para testes e depuração. */
  equip(side: Side, id: ToolId | null): void {
    const hand = this.hands[side];
    if (hand.tool) {
      hand.tool.placeOnTray(this.world.group);
      hand.tool = null;
    }
    const tool = id ? this.tools.find((t) => t.def.id === id) : null;
    if (tool) {
      const other = this.hands[side === 'left' ? 'right' : 'left'];
      if (other.tool === tool) other.tool = null;
      hand.tool = tool;
      tool.attachTo(hand.anchor, side);
    }
    hand.setLayer(this.busy(side) ? LAYER_WORLD : LAYER_FPS);
  }

  // ------------------------------------------------------------------ cursor: alvos, dica e clique
  /** Alvos clicáveis no estado atual (o raycaster já deve estar apontado para o cursor). */
  private targets(): PickTarget<TargetId>[] {
    const list: PickTarget<TargetId>[] = [];
    if (this.hands[this.active].tool) {
      // Mão ocupada: a bandeja inteira serve para devolver o instrumento.
      const h = new Vector3(TRAY_SIZE.x / 2, 0, TRAY_SIZE.z / 2);
      const caixa = new Box3(TRAY_TOP.clone().sub(h).setY(TRAY_TOP.y - 0.03), TRAY_TOP.clone().add(h).setY(TRAY_TOP.y + 0.08));
      list.push({ id: { tipo: 'bandeja' }, prioridade: 2, forma: { tipo: 'caixa', caixa } });
    } else {
      // Mão livre: instrumentos na bandeja. Acertar a malha vale mais que acertar só a caixa envolvente
      // (folga para peças finas), o que evita que a caixa de uma peça grande cubra as vizinhas.
      for (const tool of this.tools) {
        if (tool.holder) continue;
        const caixa = new Box3().setFromObject(tool.object).expandByScalar(0.01);
        const exato = this.raycaster.intersectObject(tool.object, true).length > 0;
        list.push({ id: { tipo: 'ferramenta', tool }, prioridade: exato ? 4 : 2, forma: { tipo: 'caixa', caixa } });
      }
    }
    const head = this.world.headShape();
    list.push({ id: { tipo: 'cabeca' }, prioridade: 1, forma: { tipo: 'elipsoide', centro: head.centro, raios: head.raios } });
    list.push({ id: { tipo: 'boca' }, prioridade: 3, forma: { tipo: 'esfera', centro: this.world.landmarks.boca, raio: 0.026 } });
    return list;
  }

  /** Texto da dica para o alvo sob o cursor, considerando a mão ativa. */
  hint(t: TargetId): string {
    const held = this.hands[this.active].tool;
    const mao = `mão ${sideName(this.active)}`;
    switch (t.tipo) {
      case 'ferramenta':
        return `Clique: pegar ${t.tool.def.nome} com a ${mao}`;
      case 'bandeja':
        return `Clique: devolver ${held!.def.nome} à bandeja`;
      case 'cabeca':
        return held ? 'Cabeça do paciente' : 'Clique: posicionar a cabeça';
      case 'boca':
        if (!held) return 'Clique: abrir a boca';
        return held.def.id === 'laringoscopio' ? 'Clique: inserir o laringoscópio' : 'Boca do paciente';
    }
  }

  private setHover(t: TargetId | null): void {
    this.hover = t;
    this.highlight.object(t?.tipo === 'ferramenta' ? t.tool.object : null);
    if (t?.tipo === 'cabeca') this.highlight.zone(this.world.landmarks.fronte, 0.045);
    else if (t?.tipo === 'boca') this.highlight.zone(this.world.landmarks.boca, 0.026);
    else this.highlight.zone(null);
    this.renderer.domElement.style.cursor = t ? 'pointer' : 'default';
    this.ui.setHint(t ? this.hint(t) : null, this.input.pointer);
  }

  private updateHover(): void {
    const inp = this.input;
    if (!inp.pointerInside || inp.looking || this.busy(this.active)) {
      this.setHover(null);
      return;
    }
    this.raycaster.setFromCamera(inp.pointer, this.camera);
    this.setHover(pick(this.raycaster.ray, this.targets())?.id ?? null);
  }

  /** Clique: age com a mão ativa sobre o alvo. No Modo Easy, erro só gera uma dica neutra. */
  click(t: TargetId): void {
    const side = this.active;
    this.clicks++;
    switch (t.tipo) {
      case 'ferramenta':
        this.pickUp(side, t.tool);
        break;
      case 'bandeja':
        this.putBack(side);
        break;
      case 'cabeca':
        // As animações das etapas (posição olfativa, abertura da boca, laringoscopia) entram na etapa 2 da implementação.
        this.touch(side, this.world.landmarks.fronte);
        break;
      case 'boca':
        this.touch(side, this.world.landmarks.boca);
        break;
    }
  }

  // ------------------------------------------------------------------ loop
  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'jogo') this.updateInput(dt);
    this.updateView();
    this.updateHands(dt);
    this.updateCamera();
    if (this.state === 'jogo') {
      this.updateHover();
      if (this.input.clicked.has(0) && this.hover) this.click(this.hover);
      this.ui.updateHud({
        scenario: this.scenario, active: this.active, elapsed: this.elapsed,
        tools: { left: this.hands.left.tool?.def.nome ?? null, right: this.hands.right.tool?.def.nome ?? null },
      });
    }
    this.highlight.update(dt, this.camera.position);
    this.world.update(dt);

    // Passada 1: mundo. Passada 2: camada FPS, com a profundidade limpa (as mãos em repouso nunca atravessam a cena).
    this.renderer.clear();
    this.camera.layers.set(LAYER_WORLD);
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.camera.layers.set(LAYER_FPS);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    this.frames++;
  }

  private updateInput(dt: number): void {
    const inp = this.input;
    this.elapsed += dt;
    if (inp.pressed.has('KeyH')) this.ui.toggleHelp();
    if (inp.pressed.has('Tab')) this.active = this.active === 'left' ? 'right' : 'left';
    if (inp.pressed.has('KeyX')) {
      this.lean.set(0, 0, 0);
      this.yaw = this.pitch = 0;
    }
    // Olhar em volta (WASD ou botão direito) e inclinar o corpo (setas).
    const look = lookIntent((c) => inp.down(c)).multiplyScalar(LOOK.keys * dt);
    if (inp.looking) look.set(look.x - inp.mouseDelta.x * LOOK.mouse, look.y - inp.mouseDelta.y * LOOK.mouse);
    this.yaw = clamp(this.yaw + look.x, -LOOK.yawMax, LOOK.yawMax);
    this.pitch = clamp(this.pitch + look.y, LOOK.pitchMin, LOOK.pitchMax);
    const lean = leanIntent((c) => inp.down(c)).multiplyScalar(LOOK.lean * dt);
    this.lean.add(lean).clamp(DOCTOR.leanMax.clone().negate(), DOCTOR.leanMax);
  }

  /** Visão do médico e a transformação que prende as mãos em repouso a ela. */
  private updateView(): void {
    const eye = DOCTOR.eye.clone().add(this.lean);
    const dir = DOCTOR.lookAt.clone().sub(DOCTOR.eye).normalize();
    dir.applyAxisAngle(Y, this.yaw);
    const side = dir.clone().cross(Y).normalize();
    dir.applyAxisAngle(side, this.pitch);
    this.view.position.copy(eye);
    this.view.lookAt(eye.clone().add(dir));
    this.view.rotateY(Math.PI);
    this.view.updateMatrixWorld();
    this.delta.multiplyMatrices(this.view.matrixWorld, this.nominalInv);
    this.deltaQ.setFromRotationMatrix(this.delta);
  }

  private updateCamera(): void {
    if (this.debugView) {
      this.camera.position.copy(this.debugView.pos);
      this.camera.lookAt(this.debugView.target);
    } else {
      this.camera.position.copy(this.view.position);
      this.camera.quaternion.copy(this.view.quaternion);
    }
    this.camera.updateMatrixWorld();
  }

  private updateHands(dt: number): void {
    const reach = (DOCTOR.upperArm + DOCTOR.forearm) * 0.96;
    for (const side of SIDES) {
      const hand = this.hands[side];
      const seq = this.acting[side];
      if (seq) {
        if (seq.update(dt)) {
          this.acting[side] = null;
          hand.setLayer(LAYER_FPS);
        }
      } else {
        const rest = this.restPose(side);
        const k = 1 - Math.exp(-VIEWMODEL.follow * dt);
        hand.root.position.lerp(rest.pos, k);
        hand.root.quaternion.slerp(rest.quat, k);
      }
      // Ombro preso à câmera (fora da tela). Se o alvo está além do alcance (bandeja), o cotovelo é resolvido
      // com um ombro adiantado e a manga é desenhada desde o ombro real: o braço alonga em vez de aparecer solto.
      const origin = DOCTOR.shoulder[side].clone().applyMatrix4(this.delta);
      const shoulder = origin.clone();
      const to = hand.root.position.clone().sub(shoulder);
      const d = to.length();
      if (d > reach) shoulder.addScaledVector(to, (d - reach) / d);
      const pole = new Vector3(side === 'left' ? 0.45 : -0.45, -0.5, -0.15).applyQuaternion(this.deltaQ).add(shoulder);
      hand.update(dt, shoulder, pole, origin);
    }
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}
