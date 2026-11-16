import {
  ACESFilmicToneMapping, Box3, Clock, Euler, Matrix4, Object3D, PCFShadowMap, PerspectiveCamera, PMREMGenerator,
  PointLight, Quaternion, Raycaster, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DOCTOR, LOOK, SCENARIOS, SHOTS, VIEWMODEL, VITALS, type ScenarioId, type Side } from './config';
import { World } from './core/world';
import { downloadPatient, Patient } from './core/patient';
import { Sequencia, type Fase } from './game/anim';
import { avaliar, estadoInicial, passoAtual, PASSOS, type Acao, type EasyState } from './game/easy';
import { Highlighter } from './game/highlight';
import { pick, type PickTarget } from './game/picking';
import { Hand } from './hands/hand';
import { leanIntent, lookIntent } from './input/controls';
import { Input } from './input/input';
import { gripQuat, readyHandQuat, Tool, TOOL_DEFS, TRAY_SIZE, TRAY_TOP, type ToolId } from './tools/tools';
import { UI } from './ui/ui';

const SIDES: Side[] = ['left', 'right'];
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
/** Camadas de renderização: mundo (com oclusão) e camada FPS (mãos em repouso, por cima da cena). */
const LAYER_WORLD = 0;
const LAYER_FPS = 1;
/** Mão livre em repouso: palma para baixo, dedos levemente caídos. */
const Q_LIVRE = new Quaternion().setFromEuler(new Euler(0.35, 0, 0));
/** Troca de instrumento na camada FPS: quanto a mão desce (para fora da tela) antes de voltar. */
const MERGULHO = new Vector3(0, -0.16, -0.06);
/** Mão que toca o paciente: dedos apontando para baixo e para frente. */
const Q_TOQUE = new Quaternion().setFromEuler(new Euler(0.95, 0, 0.25));
/** Mão esquerda na lateral da cabeça (lado esquerdo do paciente): palma contra a cabeça, dedos para o occipício. */
const Q_APOIO = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(new Vector3(0, -0.85, -0.53).normalize(), new Vector3(1, 0, 0), new Vector3(0, -0.53, 0.85).normalize()),
);
/** Abertura da mandíbula (graus): boca aberta em tesoura e com a lâmina tracionando. */
const JAW_ABERTA = 27;
const JAW_LAMINA = 31;
/**
 * Luzes da visão interna (candelas): a cena é pequena, então valores baixos já iluminam bem. A lâmpada da
 * lâmina fica quase apagada aqui (ela está a milímetros do aço e estouraria a imagem); quem ilumina a glote
 * é a luz junto à câmera.
 */
const INTERNA = { luzCamera: 0.001, luzLamina: 0.00005, ambiente: 0.1 };
/** Instrumentos que a mão direita pode pegar pela roda, na visão da laringoscopia. */
const RODA: ToolId[] = ['tubo', 'aspirador', 'seringa', 'ambu'];

type State = 'menu' | 'jogo' | 'pausa';
/** Câmera: visão do médico, corte lateral (posição olfativa) ou visão interna (laringoscopia). */
type Mode = 'medico' | 'lateral' | 'interna';
interface Pose { pos: Vector3; quat: Quaternion }

/** O que pode estar sob o cursor. */
export type TargetId = { tipo: 'ferramenta'; tool: Tool } | { tipo: 'bandeja' } | { tipo: 'cabeca' } | { tipo: 'boca' };

export const sideName = (s: Side): string => (s === 'left' ? 'esquerda' : 'direita');
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(SHOTS.medico.fov, 1, 0.004, 30);
  readonly input: Input;
  readonly world = new World();
  readonly hands: Record<Side, Hand>;
  readonly tools: Tool[];
  readonly ui: UI;
  readonly highlight = new Highlighter();

  state: State = 'menu';
  scenario: ScenarioId = 'easy';
  mode: Mode = 'medico';
  /** Progresso no paciente (posição olfativa, boca aberta, laringoscopia). */
  easy: EasyState = estadoInicial();
  /** Mão que age no clique (Tab alterna). */
  active: Side = 'right';
  elapsed = 0;
  /** Quadros renderizados (os testes usam para esperar a cena atualizar). */
  frames = 0;
  /** Acelera o tempo das animações (só para testes e screenshots). */
  timeScale = 1;
  /** Cliques de ação e erros de conduta na partida. */
  clicks = 0;
  erros = 0;
  /** Alvo sob o cursor neste quadro. */
  hover: TargetId | null = null;
  /** Câmera livre para inspeção (testes/screenshots). null = câmera do modo atual. */
  debugView: { pos: Vector3; target: Vector3 } | null = null;

  private readonly clock = new Clock();
  private readonly raycaster = new Raycaster();
  private readonly lean = new Vector3();
  private yaw = 0;
  private pitch = 0;
  /** Referencial das mãos em repouso: visão do médico ou, na laringoscopia, a visão interna. */
  private readonly view = new Object3D();
  /** Inversa da visão padrão: converte poses "do mundo na visão padrão" em poses presas à câmera. */
  private readonly nominalInv: Matrix4;
  private readonly delta = new Matrix4();
  private readonly deltaQ = new Quaternion();
  /** Animação em andamento de cada mão (null = em repouso na camada FPS). */
  private readonly acting: Record<Side, Sequencia | null> = { left: null, right: null };
  /** Mão presa a uma pose do mundo, recalculada a cada quadro (ex.: segurando o laringoscópio na boca). */
  private readonly pin: Record<Side, (() => Pose) | null> = { left: null, right: null };
  /** Corte de câmera em andamento: bloqueia os comandos até terminar. */
  private cut: Sequencia | null = null;
  /** Luz junto à câmera na visão interna (a ponta da lâmina ilumina a glote). */
  private readonly innerLight = new PointLight(0xfff1d8, 0, 0.3, 2);

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
    this.scene.add(this.world.group, this.highlight.ring, this.innerLight);
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
    this.ui.onWheel = (id) => this.wheelSelect(id as ToolId | null);
    this.reset();
    this.ui.showMenu(false);
    void this.loadPatient();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.state === 'pausa') this.resume();
      else if (this.state === 'jogo' && !this.cut) {
        // Na visão interna, Esc desfaz a laringoscopia; fora dela, pausa.
        if (this.mode === 'interna') this.exitInside();
        else this.pause();
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

  private get patient(): Patient | null {
    return this.world.patient;
  }

  // ------------------------------------------------------------------ estados
  start(scenario: ScenarioId): void {
    this.scenario = scenario;
    this.world.applyScenario(SCENARIOS[scenario]);
    this.reset();
    this.state = 'jogo';
    this.input.enabled = true;
    this.ui.showGame();
    this.ui.toggleHelp(false);
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

  /** Início do cenário: paciente em posição neutra, mãos livres, instrumentos na bandeja, sinais vitais normais. */
  reset(): void {
    for (const t of this.tools) t.placeOnTray(this.world.group);
    this.patient?.reset();
    this.world.refreshLandmarks();
    this.world.vitals.fc = VITALS.fc;
    this.world.vitals.spo2 = VITALS.spo2;
    this.easy = estadoInicial();
    this.mode = 'medico';
    this.cut = null;
    this.lean.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.active = 'right';
    this.elapsed = 0;
    this.clicks = 0;
    this.erros = 0;
    this.updateView();
    for (const side of SIDES) {
      const h = this.hands[side];
      h.tool = null;
      h.curlOverride = null;
      h.fingerCurl = null;
      h.setVisible(true);
      this.acting[side] = null;
      this.pin[side] = null;
      h.setLayer(LAYER_FPS);
    }
    this.snapHands();
    this.setHover(null);
    this.ui.setCaption(null);
    this.ui.setWheel(null);
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

  /** Há alguma animação em andamento (mão ou corte de câmera)? */
  get animating(): boolean {
    return this.cut !== null || this.busy('left') || this.busy('right');
  }

  /** Pose de repouso da mão, presa à câmera (parte de baixo da tela), segurando o instrumento atual. */
  private restPose(side: Side): Pose {
    const h = this.hands[side];
    const pos = VIEWMODEL.rest[side].clone();
    if (side === this.active) pos.add(VIEWMODEL.activeLift);
    if (h.tool?.def.repouso) pos.add(h.tool.def.repouso);
    const quat = h.tool ? readyHandQuat(h.tool.def, side) : Q_LIVRE.clone();
    return { pos: pos.applyMatrix4(this.delta), quat: quat.premultiply(this.deltaQ) };
  }

  /** Coloca na hora as mãos em repouso (depois de um corte de câmera, para não atravessarem a cena). */
  private snapHands(): void {
    for (const side of SIDES) {
      if (this.acting[side] || this.pin[side]) continue;
      const rest = this.restPose(side);
      this.hands[side].place(rest.pos, rest.quat);
    }
  }

  /**
   * Inicia uma animação da mão. Com `mundo`, ela sai da camada FPS (oclusão correta, para mexer no
   * paciente) e volta a ela no fim; sem isso, a animação acontece toda na camada FPS.
   */
  private act(side: Side, fases: Fase[], mundo: boolean): void {
    if (mundo) this.hands[side].setLayer(LAYER_WORLD);
    this.acting[side] = new Sequencia(fases);
  }

  /** Pose de repouso deslocada para baixo, fora da tela (troca de instrumento). */
  private dipPose(side: Side): Pose {
    const rest = this.restPose(side);
    rest.pos.add(MERGULHO.clone().applyQuaternion(this.deltaQ));
    return rest;
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
        extra.update?.(t);
        const d = destino();
        hand.root.position.lerpVectors(p0, d.pos, t);
        hand.root.quaternion.slerpQuaternions(q0, d.quat, t);
      },
      fim: extra.fim,
    };
  }

  /**
   * Troca o que a mão segura, 100% na camada FPS: a mão não vai até a bandeja. Ela desce um pouco, o
   * instrumento antigo volta para a bandeja, o novo aparece empunhado, e a mão sobe de volta.
   */
  private swap(side: Side, novo: Tool | null): void {
    const hand = this.hands[side];
    const velho = hand.tool;
    if (this.busy(side) || (!velho && !novo) || velho === novo || (novo && novo.holder)) return;
    if (novo) novo.holder = side; // reservado: deixa de ser clicável
    this.act(side, [
      this.ir(side, () => this.dipPose(side), 0.13, {
        fim: () => {
          velho?.placeOnTray(this.world.group);
          hand.tool = novo;
          if (novo) {
            novo.attachTo(hand.anchor, side);
            hand.setLayer(LAYER_FPS);
            this.ui.flash(`Mão ${sideName(side)}: ${novo.def.nome}`);
          }
        },
      }),
      this.ir(side, () => this.restPose(side), 0.24),
    ], false);
  }

  /** Pega um instrumento da bandeja com a mão livre. */
  pickUp(side: Side, tool: Tool): void {
    if (!this.hands[side].tool) this.swap(side, tool);
  }

  /** Devolve à bandeja o instrumento que a mão segura. */
  putBack(side: Side): void {
    this.swap(side, null);
  }

  /** Roda de seleção (visão da laringoscopia): troca o instrumento da mão direita; null = soltar. */
  wheelSelect(id: ToolId | null): void {
    if (this.mode !== 'interna' || this.cut) return;
    const tool = id ? this.tools.find((t) => t.def.id === id) ?? null : null;
    if (tool && tool === this.hands.right.tool) this.swap('right', null);
    else this.swap('right', tool);
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

  // ------------------------------------------------------------------ ações no paciente
  /** Erro de conduta: a tela pisca em vermelho e os sinais vitais pioram. */
  private penalize(msg: string): void {
    this.erros++;
    const v = this.world.vitals;
    v.fc = Math.min(VITALS.limite.fc, v.fc + VITALS.erro.fc);
    v.spo2 = Math.max(VITALS.limite.spo2, v.spo2 + VITALS.erro.spo2);
    this.ui.redFlash(msg);
  }

  private run(acao: Acao, side: Side): void {
    if (acao === 'olfativa') this.doSniff(side);
    else if (acao === 'abrirBoca') this.doOpenMouth();
    else this.doLaryngoscopy();
  }

  /**
   * Coxim e posição olfativa, com corte para a vista lateral: a cabeça é erguida, o coxim desliza sob o
   * occipício e a cabeça é estendida sobre ele.
   */
  private doSniff(side: Side): void {
    const p = this.patient;
    const coxim = this.hands[side].tool;
    if (!p || !coxim) return;
    this.hands[side].tool = null;
    coxim.consume();
    this.mode = 'lateral';
    this.setHover(null);
    for (const s of SIDES) this.hands[s].setLayer(LAYER_WORLD);

    const z0 = p.towelRest.z - 0.36;
    p.towel.visible = true;
    p.towel.position.set(0, p.towelRest.y, z0);
    // Mãos livres participam: a esquerda apoia a cabeça, a direita desliza o coxim.
    if (!this.hands.left.tool) {
      this.pin.left = () => ({
        pos: new Vector3(p.headCenter.x + p.headRadii.x + 0.03, p.headCenter.y - 0.02, p.headCenter.z + 0.01),
        quat: Q_APOIO,
      });
    }
    if (!this.hands.right.tool) {
      const h = p.towel.scale.y;
      this.pin.right = () => ({
        pos: new Vector3(-0.07, p.towel.position.y + h / 2 + 0.03, p.towel.position.z - 0.07),
        quat: Q_LIVRE,
      });
    }
    this.ui.setCaption('Cabeça em posição neutra, apoiada no colchão.');
    this.cut = new Sequencia([
      { dur: 0.9 },
      { dur: 0.8, update: (t) => p.applyPose({ flex: 1.3 * t, ext: 0.15 * t }) },
      { dur: 0.8, update: (t) => (p.towel.position.z = lerp(z0, p.towelRest.z, t)) },
      { dur: 0.9, update: (t) => p.applyPose({ flex: lerp(1.3, 1, t), ext: lerp(0.15, 1, t) }) },
      {
        dur: 2.2,
        inicio: () => {
          this.pin.left = this.pin.right = null;
          this.ui.setCaption('Posição olfativa: coxim sob o occipício, pescoço fletido e cabeça estendida.');
        },
      },
      {
        dur: 0,
        fim: () => {
          this.easy.olfativa = true;
          this.mode = 'medico';
          this.ui.setCaption(null);
          this.world.refreshLandmarks();
          for (const s of SIDES) this.hands[s].setLayer(LAYER_FPS);
          this.snapHands();
        },
      },
    ]);
  }

  /** Abertura da boca em tesoura com a mão direita: polegar e indicador nos dentes, a mandíbula desce. */
  private doOpenMouth(): void {
    const p = this.patient;
    if (!p) return;
    const side: Side = 'right';
    const hand = this.hands[side];
    hand.root.updateMatrixWorld(true);
    const tipLocal = hand.root.worldToLocal(hand.tipWorld());
    const at = (): Pose => {
      // Ponta do indicador nos dentes de baixo, do lado direito da boca (acompanha a mandíbula).
      const alvo = p.landmark('labioInferior').lerp(p.landmark('comissuraDireita'), 0.45);
      return { pos: alvo.sub(tipLocal.clone().applyQuaternion(Q_TOQUE)), quat: Q_TOQUE };
    };
    const pre = (): Pose => {
      const a = at();
      a.pos.add(new Vector3(0, 0.06, -0.05));
      return a;
    };
    this.act(side, [
      // Gesto de tesoura: indicador e polegar estendidos, os outros dedos recolhidos.
      this.ir(side, pre, 0.45, { inicio: () => (hand.fingerCurl = [0.12, 0.85, 0.95, 1, 0.05]) }),
      this.ir(side, at, 0.25),
      this.ir(side, at, 0.7, { update: (t) => p.applyPose({ jaw: JAW_ABERTA * t }) }),
      { dur: 0.3 },
      this.ir(side, () => this.restPose(side), 0.5, {
        inicio: () => {
          this.easy.bocaAberta = true;
          hand.fingerCurl = null;
          this.world.refreshLandmarks();
        },
      }),
    ], true);
  }

  /**
   * Pose da mão esquerda com o laringoscópio ao longo da inserção. `u` = 0 (lâmina sobre a boca, à
   * direita) a 1 (ponta na valécula, na linha média); `lift` = tração no eixo do cabo (0–1).
   * Na posição de uso o cabo aponta para cima e para os pés, e a lâmina entra pela boca.
   */
  private scopePose(u: number, lift: number): Pose {
    const p = this.patient!;
    const tool = this.tools.find((t) => t.def.id === 'laringoscopio')!;
    const gate = p.landmark('labioSuperior').lerp(p.landmark('labioInferior'), 0.4);
    const val = p.airLandmark('valecula');
    const d1 = val.clone().sub(gate).normalize();
    const d0 = d1.clone().applyAxisAngle(X, 0.55); // no início a lâmina vem mais de cima
    const dir = d0.lerp(d1, smooth(0, 1, u)).normalize();
    // Ponta: sai de cima da boca pelo lado direito do paciente, entra pelo canto direito e vai à valécula.
    const a = gate.clone().add(new Vector3(-0.014, 0.04, -0.012));
    const b = gate.clone().add(new Vector3(-0.013, -0.006, 0.004));
    const c = val.clone().addScaledVector(d1, -0.003);
    const tip = a.multiplyScalar((1 - u) ** 2).addScaledVector(b, 2 * u * (1 - u)).addScaledVector(c, u * u);
    // Rotação do instrumento: cabo para cima (giro de 180° no eixo da lâmina) e a corda da lâmina em `dir`.
    const corda = tool.tipLocal.clone().sub(new Vector3(0, 0.066, 0.012));
    const a0 = Math.atan2(-corda.y, corda.z);
    const phi = a0 - Math.atan2(dir.y, dir.z);
    const quat = new Quaternion().setFromEuler(new Euler(phi, 0, Math.PI));
    const pos = tip.sub(tool.tipLocal.clone().applyQuaternion(quat));
    pos.addScaledVector(new Vector3(0, -1, 0).applyQuaternion(quat), 0.008 * lift);
    return { pos, quat: quat.multiply(gripQuat('left', tool.def).invert()) };
  }

  /** Laringoscopia: a lâmina entra pela direita, rebate a língua, vai à valécula e traciona; corta para a visão interna. */
  private doLaryngoscopy(): void {
    const p = this.patient;
    if (!p) return;
    const side: Side = 'left';
    const hand = this.hands[side];
    this.act(side, [
      this.ir(side, () => this.scopePose(0, 0), 0.7),
      {
        dur: 1.5,
        update: (t) => {
          p.applyPose({ tongue: smooth(0.25, 1, t), jaw: lerp(JAW_ABERTA, JAW_LAMINA, t) });
          const pose = this.scopePose(t, 0);
          hand.place(pose.pos, pose.quat);
        },
      },
      {
        dur: 0.6,
        update: (t) => {
          const pose = this.scopePose(1, t);
          hand.place(pose.pos, pose.quat);
        },
      },
      { dur: 0.5 },
      { dur: 0, fim: () => this.enterInside() },
    ], true);
  }

  /** Corta para a visão de dentro da boca. A esquerda segura o laringoscópio; a direita escolhe pela roda. */
  private enterInside(): void {
    this.easy.laringoscopia = true;
    this.mode = 'interna';
    this.active = 'right';
    this.setHover(null);
    this.pin.left = () => this.scopePose(1, 1);
    this.hands.left.setVisible(false);
    this.updateView();
    this.snapHands();
    this.ui.setCaption('Glote exposta. Escolha na roda o instrumento da mão direita · Esc: retirar o laringoscópio');
  }

  /** Sai da visão interna e desfaz a laringoscopia: a lâmina sai e a esquerda volta com o laringoscópio. */
  exitInside(): void {
    const p = this.patient;
    if (this.mode !== 'interna' || !p) return;
    const side: Side = 'left';
    const hand = this.hands[side];
    this.easy.laringoscopia = false;
    this.mode = 'medico';
    this.pin.left = null;
    hand.setVisible(true);
    this.ui.setCaption(null);
    this.ui.setWheel(null);
    this.updateView();
    this.snapHands();
    this.act(side, [
      {
        dur: 0.9,
        update: (t) => {
          p.applyPose({ tongue: 1 - smooth(0, 0.75, t), jaw: lerp(JAW_LAMINA, JAW_ABERTA, t) });
          const pose = this.scopePose(1 - t, 1 - t);
          hand.place(pose.pos, pose.quat);
        },
      },
      this.ir(side, () => this.restPose(side), 0.55, { inicio: () => this.world.refreshLandmarks() }),
    ], true);
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
    list.push({ id: { tipo: 'boca' }, prioridade: 3, forma: { tipo: 'esfera', centro: this.world.landmarks.boca, raio: 0.028 } });
    return list;
  }

  /** Texto da dica para o alvo sob o cursor: descreve o que a mão ativa vai tentar fazer. */
  hint(t: TargetId): string {
    const held = this.hands[this.active].tool;
    const mao = `mão ${sideName(this.active)}`;
    switch (t.tipo) {
      case 'ferramenta':
        return `Clique: pegar ${t.tool.def.nome} com a ${mao}`;
      case 'bandeja':
        return `Clique: devolver ${held!.def.nome} à bandeja`;
      case 'cabeca':
        if (!held) return 'Clique: posicionar a cabeça';
        return held.def.id === 'coxim' ? 'Clique: colocar o coxim sob a cabeça' : `Clique: usar ${held.def.curto} na cabeça`;
      case 'boca':
        if (!held) return `Clique: abrir a boca com a ${mao}`;
        return held.def.id === 'laringoscopio' ? `Clique: inserir o laringoscópio com a ${mao}` : `Clique: usar ${held.def.curto} na boca`;
    }
  }

  private setHover(t: TargetId | null): void {
    this.hover = t;
    this.highlight.object(t?.tipo === 'ferramenta' ? t.tool.object : null);
    if (t?.tipo === 'cabeca') this.highlight.zone(this.world.landmarks.fronte, 0.045);
    else if (t?.tipo === 'boca') this.highlight.zone(this.world.landmarks.boca, 0.028);
    else this.highlight.zone(null);
    this.renderer.domElement.style.cursor = t ? 'pointer' : 'default';
    this.ui.setHint(t ? this.hint(t) : null, this.input.pointer);
  }

  private updateHover(): void {
    const inp = this.input;
    if (this.mode !== 'medico' || this.cut || !inp.pointerInside || inp.looking || this.busy(this.active)) {
      this.setHover(null);
      return;
    }
    this.raycaster.setFromCamera(inp.pointer, this.camera);
    this.setHover(pick(this.raycaster.ray, this.targets())?.id ?? null);
  }

  /**
   * Clique: age com a mão ativa sobre o alvo. Pegar ou devolver instrumentos nunca é erro; no paciente,
   * as regras de `avaliar` decidem entre animar, dar uma dica neutra ou penalizar.
   */
  click(t: TargetId): void {
    const side = this.active;
    this.clicks++;
    if (t.tipo === 'ferramenta') {
      this.pickUp(side, t.tool);
      return;
    }
    if (t.tipo === 'bandeja') {
      this.putBack(side);
      return;
    }
    if (!this.patient) {
      this.ui.flash('Aguarde o paciente terminar de carregar.');
      return;
    }
    if (this.animating) return; // uma ação no paciente por vez
    const r = avaliar(this.easy, t.tipo, side, this.hands[side].tool?.def.id ?? null);
    if (r.tipo === 'erro') this.penalize(r.msg);
    else if (r.tipo === 'dica') this.ui.flash(r.msg);
    else this.run(r.acao, side);
  }

  // ------------------------------------------------------------------ loop
  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05) * this.timeScale;
    if (this.state === 'jogo') {
      this.updateInput(dt);
      if (this.cut?.update(dt)) this.cut = null;
    }
    this.updateView();
    this.updateHands(dt);
    this.updateCamera();
    if (this.state === 'jogo') {
      this.updateHover();
      if (this.input.clicked.has(0) && this.hover) this.click(this.hover);
      this.updateHud();
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

  private updateHud(): void {
    const maos = { left: this.hands.left.tool?.def.id ?? null, right: this.hands.right.tool?.def.id ?? null };
    this.ui.updateHud({
      scenario: this.scenario, active: this.active, elapsed: this.elapsed, erros: this.erros,
      vitals: this.world.vitals, alarme: VITALS.alarme,
      tools: { left: this.hands.left.tool?.def.nome ?? null, right: this.hands.right.tool?.def.nome ?? null },
    });
    const atual = passoAtual(this.easy, maos);
    this.ui.setChecklist(
      PASSOS.map((p) => p.texto), atual,
      atual >= PASSOS.length ? 'Glote exposta. As próximas etapas (tubo, cuff, ventilação) ainda estão em construção.' : null,
    );
    if (this.mode === 'interna') {
      this.ui.setWheel(RODA.map((id) => {
        const tool = this.tools.find((t) => t.def.id === id)!;
        return { id, nome: tool.def.curto, naMao: tool === this.hands.right.tool, indisponivel: tool.holder === 'left' || tool.holder === 'usado' };
      }));
    }
  }

  private updateInput(dt: number): void {
    const inp = this.input;
    this.elapsed += dt;
    if (inp.pressed.has('KeyH')) this.ui.toggleHelp();
    if (this.mode !== 'medico' || this.cut) return;
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

  /** Referencial das mãos em repouso: a visão do médico ou, na laringoscopia, a visão interna. */
  private updateView(): void {
    const p = this.patient;
    if (this.mode === 'interna' && p) {
      // Dentro da faringe, no eixo da laringe, olhando para a glote; "para cima" é o lado anterior.
      const g = p.glottisFrame();
      this.view.position.copy(g.centro).addScaledVector(g.cranial, SHOTS.interna.distancia).addScaledVector(g.anterior, -SHOTS.interna.posterior);
      this.view.up.copy(g.anterior);
      this.view.lookAt(g.centro);
    } else {
      const eye = DOCTOR.eye.clone().add(this.lean);
      const dir = DOCTOR.lookAt.clone().sub(DOCTOR.eye).normalize();
      dir.applyAxisAngle(Y, this.yaw);
      const side = dir.clone().cross(Y).normalize();
      dir.applyAxisAngle(side, this.pitch);
      this.view.position.copy(eye);
      this.view.up.copy(Y);
      this.view.lookAt(eye.clone().add(dir));
    }
    this.view.rotateY(Math.PI);
    this.view.updateMatrixWorld();
    this.delta.multiplyMatrices(this.view.matrixWorld, this.nominalInv);
    this.deltaQ.setFromRotationMatrix(this.delta);
  }

  private updateCamera(): void {
    const cam = this.camera;
    if (this.debugView) {
      cam.up.copy(Y);
      cam.position.copy(this.debugView.pos);
      cam.lookAt(this.debugView.target);
    } else if (this.mode === 'lateral') {
      cam.up.copy(Y);
      cam.position.copy(SHOTS.lateral.pos);
      cam.lookAt(SHOTS.lateral.target);
    } else {
      cam.position.copy(this.view.position);
      cam.quaternion.copy(this.view.quaternion);
    }
    const fov = this.debugView ? SHOTS.medico.fov : SHOTS[this.mode].fov;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    // Visão interna: só a luz da lâmina e uma luz fraca junto à câmera; o ambiente da sala quase não entra.
    const inside = this.mode === 'interna' && !this.debugView;
    this.innerLight.intensity = inside ? INTERNA.luzCamera : 0;
    if (inside) {
      // Um pouco à frente da câmera e para o lado posterior: ilumina a glote sem estourar a lâmina, que passa rente.
      const g = this.patient!.glottisFrame();
      this.innerLight.position.copy(this.view.position).addScaledVector(g.cranial, -0.022).addScaledVector(g.anterior, -0.006);
    }
    this.scene.environmentIntensity = inside ? INTERNA.ambiente : 0.45;
    const scope = this.tools.find((t) => t.def.id === 'laringoscopio');
    if (scope?.light && scope.light.intensity > 0) scope.light.intensity = inside ? INTERNA.luzLamina : 0.35;
  }

  private updateHands(dt: number): void {
    const reach = (DOCTOR.upperArm + DOCTOR.forearm) * 0.96;
    for (const side of SIDES) {
      const hand = this.hands[side];
      const seq = this.acting[side];
      const pin = this.pin[side];
      if (pin) {
        const pose = pin();
        const k = 1 - Math.exp(-12 * dt);
        hand.root.position.lerp(pose.pos, k);
        hand.root.quaternion.slerp(pose.quat, k);
      } else if (seq) {
        if (seq.update(dt)) {
          this.acting[side] = null;
          if (!this.pin[side] && this.mode !== 'lateral') hand.setLayer(LAYER_FPS);
        }
      } else {
        const rest = this.restPose(side);
        const k = 1 - Math.exp(-VIEWMODEL.follow * dt);
        hand.root.position.lerp(rest.pos, k);
        hand.root.quaternion.slerp(rest.quat, k);
      }
      // Ombro preso à câmera (fora da tela). Se o alvo está além do alcance, o cotovelo é resolvido com um
      // ombro adiantado e a manga é desenhada desde o ombro real: o braço alonga em vez de aparecer solto.
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
