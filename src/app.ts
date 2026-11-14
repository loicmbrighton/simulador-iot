import {
  ACESFilmicToneMapping, Clock, Euler, PCFShadowMap, PerspectiveCamera, Plane, PMREMGenerator, Quaternion,
  Raycaster, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DOCTOR, SCENARIOS, SPEED, WORKSPACE, type ControlScheme, type ScenarioId, type Side } from './config';
import { World } from './core/world';
import { downloadPatient, Patient } from './core/patient';
import { Exercise } from './game/exercise';
import { Hand } from './hands/hand';
import { digitPressed, keyboardHandIntent, leanIntent } from './input/controls';
import { Input } from './input/input';
import { readyHandQuat, Tool, TOOL_DEFS, TRAY_TOP } from './tools/tools';
import { UI } from './ui/ui';

const HAND_RADIUS = 0.035;
const GRAB_DIST = 0.13;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

type State = 'menu' | 'jogo' | 'pausa';

export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.01, 30);
  readonly input: Input;
  readonly world = new World();
  readonly hands: Record<Side, Hand>;
  readonly tools: Tool[];
  readonly ui: UI;
  readonly exercise: Exercise;

  state: State = 'menu';
  scenario: ScenarioId = 'easy';
  scheme: ControlScheme = 'duas-maos';
  active: Side = 'right';
  elapsed = 0;

  private readonly clock = new Clock();
  private readonly raycaster = new Raycaster();
  private readonly lean = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /** Câmera livre para inspeção (testes/screenshots). null = visão do médico. */
  debugView: { pos: Vector3; target: Vector3 } | null = null;
  /** Altura do plano em que o mouse posiciona a mão. */
  private readonly mouseHeight: Record<Side, number> = { left: 1.2, right: 1.2 };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    container.append(canvas);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.input = new Input(canvas);
    this.scene.add(this.world.group);
    this.hands = { left: new Hand('left', this.scene), right: new Hand('right', this.scene) };
    this.tools = TOOL_DEFS.map((d) => new Tool(d));
    this.exercise = new Exercise(this.exerciseTargets());
    this.scene.add(this.exercise.group);


    this.ui = new UI(container);
    this.ui.onStart = (c) => this.start(c.scenario, c.scheme);
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

  private exerciseTargets() {
    const L = this.world.landmarks;
    const up = (v: Vector3, d: number) => v.clone().add(new Vector3(0, d, 0));
    return [
      { nome: 'Centro da boca', pos: up(L.boca, 0.012), mao: 'left' as Side },
      { nome: 'Comissura labial direita', pos: up(L.comissuraDireita, 0.012), mao: 'right' as Side },
      { nome: 'Fronte', pos: up(L.fronte, 0.012), mao: 'left' as Side },
      { nome: 'Mento', pos: up(L.mento, 0.014), mao: 'right' as Side },
      { nome: 'Comissura labial esquerda', pos: up(L.comissuraEsquerda, 0.012), mao: 'left' as Side },
      { nome: 'Cartilagem cricoide', pos: up(L.cricoide, 0.03), mao: 'right' as Side },
    ];
  }

  /** Baixa o paciente real (≈14 MB) em segundo plano; até lá a cena usa o manequim. */
  private async loadPatient(): Promise<void> {
    try {
      const gltf = await downloadPatient('paciente.json', (f) => this.ui.setPatientStatus(`Paciente: carregando ${Math.round(f * 100)}%`));
      this.ui.setPatientStatus('Paciente: preparando…');
      const patient = new Patient(gltf, { mattressTop: 0.92, headTopZ: -0.13 });
      this.world.setPatient(patient);
      this.exercise.setTargets(this.exerciseTargets());
      this.ui.setPatientStatus('Paciente pronto.');
      if (this.state === 'jogo') this.ui.flash('Paciente carregado');
    } catch (e) {
      console.error(e);
      this.ui.setPatientStatus(`Não foi possível carregar o paciente (${(e as Error).message}). O manequim será usado.`);
    }
  }

  // ------------------------------------------------------------------ estados
  start(scenario: ScenarioId, scheme: ControlScheme): void {
    this.scenario = scenario;
    this.scheme = scheme;
    this.world.applyScenario(SCENARIOS[scenario]);
    this.reset();
    this.elapsed = 0;
    this.state = 'jogo';
    this.input.enabled = true;
    this.ui.showGame();
    this.ui.toggleHelp(scheme, true);
    this.renderer.domElement.focus();
  }

  pause(): void {
    this.state = 'pausa';
    this.input.enabled = false;
    this.ui.showMenu(true);
  }

  resume(): void {
    this.state = 'jogo';
    this.input.enabled = true;
    this.ui.showGame();
    this.renderer.domElement.focus();
  }

  /** Mãos na posição inicial, ferramentas na bandeja, visão centralizada. */
  reset(): void {
    for (const t of this.tools) t.placeOnTray(this.world.group);
    for (const side of ['left', 'right'] as Side[]) {
      const h = this.hands[side];
      h.tool = null;
      h.target.set(side === 'left' ? 0.16 : -0.16, 1.2, -0.2);
      h.targetQ.setFromEuler(new Euler(0.35, 0, 0));
      h.snap();
      this.mouseHeight[side] = 1.2;
    }
    this.lean.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    if (this.exercise.active) this.exercise.toggle();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ ferramentas
  equip(side: Side, toolIndex: number): void {
    const hand = this.hands[side];
    if (hand.tool) {
      hand.tool.placeOnTray(this.world.group);
      hand.tool = null;
    }
    if (toolIndex === 0) return;
    const tool = this.tools.find((t) => t.def.tecla === toolIndex);
    if (!tool) return;
    const other = this.hands[side === 'left' ? 'right' : 'left'];
    if (other.tool === tool) other.tool = null;
    hand.tool = tool;
    tool.attachTo(hand.anchor, side);
    hand.targetQ.copy(readyHandQuat(tool.def, side));
    this.ui.flash(`${side === 'left' ? 'Mão esquerda' : 'Mão direita'}: ${tool.def.nome}`);
  }

  /** Pegar da bandeja a ferramenta mais próxima, ou devolver a que está na mão. */
  grabOrRelease(side: Side): void {
    const hand = this.hands[side];
    const p = hand.root.position;
    if (hand.tool) {
      if (p.distanceTo(TRAY_TOP) < 0.3 && p.y < TRAY_TOP.y + 0.2) {
        hand.tool.placeOnTray(this.world.group);
        hand.tool = null;
      } else {
        this.ui.flash('Leve a mão até a bandeja para devolver');
      }
      return;
    }
    let best: Tool | null = null;
    let bestD = GRAB_DIST;
    const tmp = new Vector3();
    for (const t of this.tools) {
      if (t.holder) continue;
      const d = t.gripWorld(tmp).distanceTo(p);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best) this.equip(side, best.def.tecla);
    else this.ui.flash('Nenhuma ferramenta ao alcance');
  }

  // ------------------------------------------------------------------ loop
  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'jogo') this.updateGame(dt);
    this.updateCamera();
    for (const side of ['left', 'right'] as Side[]) {
      this.hands[side].update(dt, DOCTOR.shoulder[side].clone().add(this.lean));
    }
    this.world.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  private updateCamera(): void {
    if (this.debugView) {
      this.camera.position.copy(this.debugView.pos);
      this.camera.lookAt(this.debugView.target);
      this.camera.updateMatrixWorld();
      return;
    }
    const eye = DOCTOR.eye.clone().add(this.lean);
    const dir = DOCTOR.lookAt.clone().sub(DOCTOR.eye).normalize();
    dir.applyAxisAngle(Y, this.yaw);
    const side = dir.clone().cross(Y).normalize();
    dir.applyAxisAngle(side, this.pitch);
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(dir));
    this.camera.updateMatrixWorld();
  }

  private updateGame(dt: number): void {
    const inp = this.input;
    this.elapsed += dt;

    // Atalhos gerais.
    if (inp.pressed.has('KeyH')) this.ui.toggleHelp(this.scheme);
    if (inp.pressed.has('KeyV')) {
      this.scheme = this.scheme === 'duas-maos' ? 'mao-ativa' : 'duas-maos';
      this.ui.flash(`Esquema: ${this.scheme === 'duas-maos' ? 'Duas mãos' : 'Mão ativa'}`);
      this.ui.renderHelp(this.scheme);
    }
    if (inp.pressed.has('KeyT')) this.exercise.toggle();
    if (inp.pressed.has('KeyX')) {
      this.lean.set(0, 0, 0);
      this.yaw = this.pitch = 0;
      for (const side of ['left', 'right'] as Side[]) {
        const h = this.hands[side];
        h.target.set(side === 'left' ? 0.16 : -0.16, 1.2, -0.2);
        this.mouseHeight[side] = 1.2;
        h.targetQ.copy(h.tool ? readyHandQuat(h.tool.def, side) : new Quaternion().setFromEuler(new Euler(0.35, 0, 0)));
      }
    }
    if (this.scheme === 'mao-ativa' && inp.pressed.has('Tab')) {
      this.active = this.active === 'left' ? 'right' : 'left';
      this.mouseHeight[this.active] = this.hands[this.active].target.y;
    }

    // Ferramentas por tecla.
    const digit = digitPressed(inp.pressed);
    if (digit !== null) {
      const side: Side = this.scheme === 'duas-maos' ? (inp.shift ? 'left' : 'right') : this.active;
      this.equip(side, digit);
    }

    // Olhar em volta (botão direito) e inclinar o corpo (setas).
    if (inp.looking) {
      this.yaw = clamp(this.yaw - inp.mouseDelta.x * 0.004, -1.2, 1.2);
      this.pitch = clamp(this.pitch - inp.mouseDelta.y * 0.004, -0.6, 0.7);
    }
    const lean = leanIntent((c) => inp.down(c)).multiplyScalar(0.25 * dt);
    this.lean.add(lean).clamp(DOCTOR.leanMax.clone().negate(), DOCTOR.leanMax);

    // Mão controlada pelo mouse.
    const mouseSide: Side = this.scheme === 'duas-maos' ? 'right' : this.active;
    this.updateMouseHand(mouseSide);
    if (inp.clicked.has(0)) this.grabOrRelease(mouseSide);

    // Mão esquerda pelo teclado (só no esquema "duas mãos").
    if (this.scheme === 'duas-maos') {
      this.updateKeyboardHand('left', dt);
      if (inp.pressed.has('KeyG')) this.grabOrRelease('left');
    }

    // Restrições físicas simples.
    for (const side of ['left', 'right'] as Side[]) {
      const t = this.hands[side].target;
      t.clamp(WORKSPACE.min, WORKSPACE.max);
      this.world.pushOut(t, HAND_RADIUS);
    }

    // Exercício.
    if (this.exercise.active) {
      const tips = { left: this.hands.left.tipWorld(), right: this.hands.right.tipWorld() };
      if (this.exercise.update(dt, tips, this.camera.position)) this.ui.flash('Alvo atingido!');
    }
    const cur = this.exercise.current;
    this.ui.updateExercise({
      active: this.exercise.active, index: this.exercise.index, total: this.exercise.total,
      nome: cur?.nome, mao: cur?.mao, elapsed: this.exercise.elapsed, finished: this.exercise.finishedTime,
    });
    this.ui.updateHud({
      scenario: this.scenario, scheme: this.scheme, active: this.active, elapsed: this.elapsed,
      tools: { left: this.hands.left.tool?.def.nome ?? null, right: this.hands.right.tool?.def.nome ?? null },
      outOfReach: { left: this.hands.left.outOfReach, right: this.hands.right.outOfReach },
    });
  }

  private updateMouseHand(side: Side): void {
    const inp = this.input;
    const hand = this.hands[side];
    if (inp.down('Space')) {
      // Rotação em eixos do mundo: arrastar na vertical inclina, na horizontal gira; roda = rola.
      const dq = new Quaternion()
        .setFromAxisAngle(X, inp.mouseDelta.y * SPEED.mouseRotate)
        .multiply(new Quaternion().setFromAxisAngle(Y, -inp.mouseDelta.x * SPEED.mouseRotate))
        .multiply(new Quaternion().setFromAxisAngle(Z, inp.wheel * 0.002));
      hand.targetQ.premultiply(dq).normalize();
      return;
    }
    this.mouseHeight[side] = clamp(this.mouseHeight[side] - inp.wheel * SPEED.wheelHeight, WORKSPACE.min.y, WORKSPACE.max.y);
    if (inp.looking || !inp.pointerInside) {
      hand.target.y = this.mouseHeight[side];
      return;
    }
    this.raycaster.setFromCamera(inp.pointer, this.camera);
    const plane = new Plane(new Vector3(0, 1, 0), -this.mouseHeight[side]);
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (hit) hand.target.copy(hit);
  }

  private updateKeyboardHand(side: Side, dt: number): void {
    const inp = this.input;
    const hand = this.hands[side];
    const intent = keyboardHandIntent((c) => inp.down(c));
    const speed = SPEED.leftHand * (inp.shift ? SPEED.precisionFactor : 1);
    hand.target.addScaledVector(intent.move, speed * dt);
    const rot = SPEED.rotate * (inp.shift ? SPEED.precisionFactor : 1) * dt;
    if (intent.tilt || intent.roll) {
      const dq = new Quaternion()
        .setFromAxisAngle(X, intent.tilt * rot)
        .multiply(new Quaternion().setFromAxisAngle(Z, intent.roll * rot));
      hand.targetQ.premultiply(dq).normalize();
    }
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}
