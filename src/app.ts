import {
  ACESFilmicToneMapping, Box3, Clock, Euler, Matrix4, Mesh, MeshBasicMaterial, Object3D, PCFShadowMap, PerspectiveCamera,
  Plane, PMREMGenerator, PointLight, Quaternion, Raycaster, Scene, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DOCTOR, LOOK, SCENARIOS, SHOTS, VIEWMODEL, VITALS, type ScenarioId, type Side } from './config';
import { World } from './core/world';
import { downloadPatient, Patient } from './core/patient';
import { hermite, minJerk, Sequencia, type Fase } from './game/anim';
import { avaliar, estadoInicial, passoAtual, PASSOS, type Acao, type EasyState } from './game/easy';
import { Highlighter } from './game/highlight';
import { pick, type PickTarget } from './game/picking';
import { Hand } from './hands/hand';
import { leanIntent, lookIntent } from './input/controls';
import { Input } from './input/input';
import { COXIM } from './tools/models';
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
/** Mão sob o occipício: palma para cima, dedos apontando para os pés do paciente. */
const Q_NUCA = new Quaternion().setFromEuler(new Euler(-0.18, 0, Math.PI));
/** Mão espalmada sobre a fronte: palma para baixo, dedos para os pés. */
const Q_TESTA = new Quaternion().setFromEuler(new Euler(0.12, 0, 0));
/** Distância do ponto de empunhadura até a superfície da palma (ver `hands/hand.ts`). */
const PALMA = 0.016;
/** Abertura da mandíbula (graus): boca aberta em tesoura e com a lâmina tracionando. */
const JAW_ABERTA = 27;
const JAW_LAMINA = 32;
/** Extensão extra da cabeça durante a laringoscopia (1 = posição olfativa). */
const EXT_LAMINA = 1.2;
/**
 * Luzes da visão pela boca. A lâmpada da lâmina fica quase apagada (está a milímetros do aço e estouraria a
 * imagem); quem ilumina é uma luz no lugar dela, um pouco afastada.
 */
const INTERNA = { luzCamera: 0.075, luzLamina: 0.00005, ambiente: 0.3 };
/** Geometria da laringoscopia (metros). Ver `App.prepareSight`. */
const VISAO = {
  /** A linha de visão passa esta distância abaixo da borda dos incisivos superiores. */
  sobIncisivos: 0.004,
  /** 0 = mira na glote, 1 = mira na parede posterior da hipofaringe (entrada do esôfago). */
  miraEsofago: 0.5,
  /** Ponta da lâmina (valécula): distância até a mira ao longo da linha de visão, afastamento anterior e para a esquerda. */
  pontaAteMira: 0.03,
  pontaAnterior: 0.0115,
  laminaEsquerda: 0.004,
  /** Quanto a corda da lâmina se inclina para anterior em direção à boca (tangente do ângulo). */
  inclinacaoLamina: 0.21,
  /** O tecido comprimido fica esta distância além da lâmina. */
  folgaLamina: 0.002,
  /** Perto da boca a lâmina se afasta muito da linha de visão: o canal não a acompanha além deste limite. */
  tetoMax: 0.02,
  /** Semilargura mínima do canal (a espátula tem 21 mm de largura). */
  canalLargura: 0.014,
  /** Faixa de transição nas laterais do canal (paredes formadas pela própria língua). */
  canalBorda: 0.012,
  /** Espaço livre mantido atrás (posterior) da linha de visão: o palato mole e a úvula cedem até aqui. */
  folgaPalato: 0.014,
};
/** Instrumentos que a mão direita pode pegar pela roda, na visão da laringoscopia. */
const RODA: ToolId[] = ['tubo', 'aspirador', 'seringa', 'ambu'];

type State = 'menu' | 'jogo' | 'pausa';
/** Câmera: visão do médico, corte lateral (posição olfativa) ou visão interna (laringoscopia). */
type Mode = 'medico' | 'lateral' | 'interna';
interface Pose { pos: Vector3; quat: Quaternion }
/** Ponto de passagem de uma trajetória da mão (ver `App.caminho`). */
interface Ponto extends Omit<Fase, 'dur' | 'linear'> {
  pose: () => Pose;
  /** Tempo para chegar a este ponto a partir do anterior (s). */
  dur: number;
  /** A mão passa por aqui sem parar (a velocidade é contínua até o ponto seguinte). */
  passa?: boolean;
  /** Altura do arco do percurso (m). Padrão: proporcional à distância. Use 0 em aproximações de contato. */
  arco?: number;
}

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
  /** Velocidade atual de cada mão (m/s): dá continuidade ao começar um movimento novo. */
  private readonly handVel: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() };
  /** A mão está agindo no paciente (o médico se aproxima enquanto isso). */
  private readonly inWorld: Record<Side, boolean> = { left: false, right: false };
  private focus = 0;
  /** Corte de câmera em andamento: bloqueia os comandos até terminar. */
  private cut: Sequencia | null = null;
  /**
   * Linha de visão da laringoscopia (mundo): da boca até um ponto entre a glote e a entrada do esôfago.
   * A lâmina corre junto a ela, pelo lado anterior, e a câmera da visão pela boca fica sobre ela.
   */
  private sight: { boca: Vector3; mira: Vector3; dir: Vector3; anterior: Vector3; ponta: Vector3; corda: Vector3; comprimento: number } | null = null;
  /** Luz da visão pela boca (faz o papel da lâmpada da lâmina, que fica a milímetros do aço). */
  private readonly innerLight = new PointLight(0xfff1d8, 0, 0.5, 1);

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
    this.sight = null;
    this.mode = 'medico';
    this.cut = null;
    this.focus = 0;
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
      this.inWorld[side] = false;
      this.handVel[side].set(0, 0, 0);
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
    // Balanço lento, fora de fase entre as mãos (respiração): em repouso elas nunca ficam paradas de todo.
    const t = this.clock.elapsedTime, f = side === 'left' ? 0 : 1.7;
    pos.x += Math.sin(t * 0.83 + f) * VIEWMODEL.sway * 0.6;
    pos.y += Math.sin(t * 1.27 + f * 2) * VIEWMODEL.sway;
    quat.multiply(new Quaternion().setFromEuler(new Euler(Math.sin(t * 1.27 + f * 2 + 0.6) * VIEWMODEL.swayRot, 0, Math.sin(t * 0.71 + f) * VIEWMODEL.swayRot)));
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
    this.inWorld[side] = mundo;
    this.acting[side] = new Sequencia(fases);
  }

  /** Pose de repouso deslocada para baixo, fora da tela (troca de instrumento). */
  private dipPose(side: Side): Pose {
    const rest = this.restPose(side);
    rest.pos.add(MERGULHO.clone().applyQuaternion(this.deltaQ));
    return rest;
  }

  /**
   * Trajetória da mão por uma lista de pontos, pensada para parecer um gesto e não um robô:
   * - a velocidade é contínua nos pontos de passagem (`passa`), em vez de parar e arrancar em cada um;
   * - entre duas paradas o perfil é de mínimo jerk (o dos movimentos de alcance humanos);
   * - o percurso faz um leve arco, e a rotação da mão se adianta à posição (chega orientada ao alvo).
   * As poses são reavaliadas a cada quadro, então o alvo pode se mexer (ex.: a mandíbula abrindo).
   */
  private caminho(side: Side, pts: Ponto[]): Fase[] {
    const hand = this.hands[side];
    return pts.map((pt, i): Fase => {
      const p0 = new Vector3(), v0 = new Vector3(), v1 = new Vector3(), q0 = new Quaternion();
      const next = pts[i + 1];
      return {
        dur: pt.dur,
        linear: true,
        inicio: () => {
          p0.copy(hand.root.position);
          q0.copy(hand.root.quaternion);
          // Sai com a velocidade que a mão já tem (zero depois de uma parada).
          if (i > 0 && !pts[i - 1].passa) v0.set(0, 0, 0);
          else v0.copy(this.handVel[side]).multiplyScalar(pt.dur);
          pt.inicio?.();
        },
        update: (u) => {
          pt.update?.(u);
          const d = pt.pose();
          const pos = hand.root.position;
          if (pt.passa && next) v1.copy(next.pose().pos).sub(p0).multiplyScalar(pt.dur / (pt.dur + next.dur));
          else v1.set(0, 0, 0);
          if (v0.lengthSq() < 1e-8 && v1.lengthSq() < 1e-8) pos.lerpVectors(p0, d.pos, minJerk(u));
          else pos.set(hermite(p0.x, v0.x, d.pos.x, v1.x, u), hermite(p0.y, v0.y, d.pos.y, v1.y, u), hermite(p0.z, v0.z, d.pos.z, v1.z, u));
          const arco = pt.arco ?? Math.min(0.03, p0.distanceTo(d.pos) * 0.12);
          pos.y += arco * 4 * u * (1 - u);
          hand.root.quaternion.slerpQuaternions(q0, d.quat, minJerk(Math.min(1, u * 1.25)));
        },
        fim: pt.fim,
      };
    });
  }

  /** Uma parada só: leva a mão da pose atual até `destino` (reavaliado a cada quadro). */
  private ir(side: Side, destino: () => Pose, dur: number, extra: Omit<Ponto, 'pose' | 'dur'> = {}): Fase {
    return this.caminho(side, [{ pose: destino, dur, ...extra }])[0];
  }

  /** Mantém a mão presa a uma pose que se move (ex.: apoiando a cabeça) por `dur` segundos. */
  private seguir(side: Side, pose: () => Pose, dur: number, extra: Omit<Fase, 'dur'> = {}): Fase {
    const hand = this.hands[side];
    return {
      ...extra,
      dur,
      update: (t) => {
        extra.update?.(t);
        const d = pose();
        hand.place(d.pos, d.quat);
      },
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
      this.ir(side, () => this.dipPose(side), 0.16, {
        arco: 0,
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
      this.ir(side, () => this.restPose(side), 0.3, { arco: 0 }),
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
   * Coxim e posição olfativa, com corte para a vista lateral. Uma mão ergue a cabeça pelo occipício, a que
   * trouxe o coxim o desliza por baixo, a cabeça é pousada e depois estendida com a mão na fronte.
   */
  private doSniff(side: Side): void {
    const p = this.patient;
    const coxim = this.hands[side].tool;
    if (!p || !coxim) return;
    this.hands[side].tool = null;
    coxim.consume();
    this.easy.olfativa = true; // a colinha já avança; os comandos ficam bloqueados até o corte terminar
    this.mode = 'lateral';
    this.ui.blink();
    this.setHover(null);
    for (const s of SIDES) this.hands[s].setLayer(LAYER_WORLD);

    const z0 = p.towelRest.z - 0.34;
    const altura = p.towel.scale.y;
    p.towel.visible = true;
    p.towel.position.set(0, p.towelRest.y, z0);
    // Tempos do corte (s): aproximar, erguer, deslizar o coxim, pousar, levar a mão à fronte, estender.
    const T = { chegar: 0.9, erguer: 0.9, deslizar: 0.9, pousar: 0.8, trocar: 0.75, estender: 1.0, ver: 2.0 };

    // Mão que traz o coxim: segura a borda mais próxima e o empurra para baixo da cabeça.
    const lado = side === 'left' ? 1 : -1;
    const borda = (): Pose => ({
      pos: new Vector3(lado * 0.06, p.towel.position.y + altura / 2 - PALMA + 0.004, p.towel.position.z - COXIM.largura / 2 + 0.035),
      quat: Q_LIVRE,
    });
    this.act(side, [
      this.ir(side, borda, T.chegar),
      this.seguir(side, borda, T.erguer + T.deslizar),
      { dur: 0.2 },
      this.ir(side, () => this.restPose(side), 0.7),
    ], true);

    // A outra mão, se estiver livre, ergue a cabeça pelo occipício e depois a estende pela fronte.
    const outra: Side = side === 'left' ? 'right' : 'left';
    if (!this.hands[outra].tool) {
      const nuca = (): Pose => ({ pos: p.nuca().add(new Vector3(0, PALMA - 0.004, -0.012)), quat: Q_NUCA });
      const testa = (): Pose => ({ pos: p.landmark('fronte').add(new Vector3(0, -PALMA + 0.006, -0.01)), quat: Q_TESTA });
      const sobreTesta = (): Pose => {
        const t = testa();
        t.pos.add(new Vector3(0, 0.06, -0.05));
        return t;
      };
      const atrasDaCabeca = (): Pose => {
        const n = nuca();
        n.pos.add(new Vector3(0, 0, -0.14));
        return n;
      };
      this.act(outra, [
        ...this.caminho(outra, [{ pose: atrasDaCabeca, dur: T.chegar * 0.6, passa: true }, { pose: nuca, dur: T.chegar * 0.4, arco: 0 }]),
        this.seguir(outra, nuca, T.erguer + T.deslizar + T.pousar),
        ...this.caminho(outra, [
          { pose: atrasDaCabeca, dur: T.trocar * 0.3, passa: true, arco: 0 },
          { pose: sobreTesta, dur: T.trocar * 0.4, passa: true },
          { pose: testa, dur: T.trocar * 0.3, arco: 0 },
        ]),
        this.seguir(outra, testa, T.estender + 0.25),
        this.ir(outra, () => this.restPose(outra), 0.7),
      ], true);
    }

    this.ui.setCaption('Cabeça em posição neutra, apoiada no colchão.');
    this.cut = new Sequencia([
      { dur: T.chegar },
      { dur: T.erguer, update: (t) => p.applyPose({ flex: 1.3 * t, ext: 0.15 * t }) },
      { dur: T.deslizar, update: (t) => (p.towel.position.z = lerp(z0, p.towelRest.z, t)) },
      { dur: T.pousar, update: (t) => p.applyPose({ flex: lerp(1.3, 1, t), ext: lerp(0.15, 0.4, t) }) },
      { dur: T.trocar },
      {
        dur: T.estender,
        inicio: () => this.ui.setCaption('Posição olfativa: coxim sob o occipício, pescoço fletido e cabeça estendida.'),
        update: (t) => p.applyPose({ ext: lerp(0.4, 1, t) }),
      },
      { dur: T.ver },
      {
        dur: 0,
        fim: () => {
          this.mode = 'medico';
          this.ui.blink();
          this.ui.setCaption(null);
          this.world.refreshLandmarks();
          for (const s of SIDES) {
            this.acting[s] = null;
            this.inWorld[s] = false;
            this.hands[s].setLayer(LAYER_FPS);
          }
          this.updateView();
          this.snapHands();
        },
      },
    ]);
  }

  /**
   * Abertura da boca em tesoura com a mão direita: o polegar e o indicador vão aos dentes e se afastam,
   * a mandíbula desce acompanhada pela mão e a cabeça cede um pouco em extensão.
   */
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
      a.pos.add(new Vector3(-0.02, 0.07, -0.06));
      return a;
    };
    this.act(side, [
      // Gesto de tesoura: indicador e polegar estendidos e juntos, os outros dedos recolhidos.
      ...this.caminho(side, [
        { pose: pre, dur: 0.55, passa: true, inicio: () => (hand.fingerCurl = [0.3, 0.85, 0.95, 1, 0.35]) },
        { pose: at, dur: 0.35, arco: 0 },
      ]),
      this.seguir(side, at, 0.95, {
        update: (t) => {
          p.applyPose({ jaw: JAW_ABERTA * t, ext: 1 + 0.06 * Math.sin(Math.PI * t) });
          // Os dedos se afastam enquanto a boca abre.
          hand.fingerCurl = [lerp(0.3, 0, t), 0.85, 0.95, 1, lerp(0.35, 0, t)];
        },
      }),
      this.seguir(side, at, 0.25),
      ...this.caminho(side, [
        {
          pose: pre, dur: 0.35, passa: true, arco: 0,
          inicio: () => {
            this.easy.bocaAberta = true;
            hand.fingerCurl = null;
            this.world.refreshLandmarks();
          },
        },
        { pose: () => this.restPose(side), dur: 0.5 },
      ]),
    ], true);
  }

  /**
   * Calcula a geometria da laringoscopia, com a boca na abertura final, e deforma a língua de acordo:
   * - linha de visão: passa rente aos incisivos superiores e mira entre a glote e a entrada do esôfago;
   * - lâmina: anterior à linha de visão, ponta na valécula; como a lâmina é curva, a corda fica inclinada
   *   para que o "ventre" dela não tape a visão;
   * - língua e epiglote: tudo o que estiver entre a linha de visão e a lâmina é comprimido contra a lâmina.
   */
  private prepareSight(): void {
    const p = this.patient!;
    const tool = this.tools.find((t) => t.def.id === 'laringoscopio')!;
    const jaw = p.pose.jaw;
    const ext = p.pose.ext;
    p.applyPose({ jaw: JAW_LAMINA, ext: EXT_LAMINA, tongue: 0 });
    const g = p.glottisFrame();
    const mira = g.centro.clone().lerp(p.airLandmark('hipofaringePosterior'), VISAO.miraEsofago);
    // Começa rente à borda dos incisivos superiores (um pouco para o lado da língua).
    const boca = p.incisor('upper');
    const ant0 = g.anterior.clone().addScaledVector(mira.clone().sub(boca).normalize(), -g.anterior.dot(mira.clone().sub(boca).normalize())).normalize();
    boca.addScaledVector(ant0, VISAO.sobIncisivos);
    const comprimento = boca.distanceTo(mira);
    const dir = mira.clone().sub(boca).divideScalar(comprimento);
    const anterior = g.anterior.clone().addScaledVector(dir, -g.anterior.dot(dir)).normalize();
    const ponta = boca.clone().addScaledVector(dir, comprimento - VISAO.pontaAteMira)
      .addScaledVector(anterior, VISAO.pontaAnterior).addScaledVector(X, VISAO.laminaEsquerda);
    const corda = dir.clone().addScaledVector(anterior, -VISAO.inclinacaoLamina).normalize();
    this.sight = { boca, mira, dir, anterior, ponta, corda, comprimento };

    // Perfil da lâmina na posição final: distância ao longo da linha de visão × afastamento anterior.
    const pose = this.scopePose(1, 1);
    const q = pose.quat.clone().multiply(gripQuat('left', tool.def));
    const perfil = (tool.spine ?? []).map((v) => {
      const rel = v.clone().applyQuaternion(q).add(pose.pos).sub(boca);
      return { s: rel.dot(dir), h: rel.dot(anterior) };
    }).sort((a, b) => a.s - b.s);
    const teto = (s: number): number => {
      if (perfil.length === 0) return VISAO.pontaAnterior;
      if (s <= perfil[0].s) return perfil[0].h;
      for (let i = 1; i < perfil.length; i++) {
        if (s <= perfil[i].s) {
          const a = perfil[i - 1], b = perfil[i];
          return a.h + ((b.h - a.h) * (s - a.s)) / Math.max(1e-6, b.s - a.s);
        }
      }
      return perfil[perfil.length - 1].h;
    };
    // Canal da laringoscopia. A língua e a epiglote que estiverem entre a linha de visão e a lâmina são
    // comprimidas contra a lâmina (sempre para anterior: a língua é uma folha contínua e precisa passar
    // inteira para o mesmo lado). O palato mole e a úvula cedem para posterior.
    // (A laringe em si é protegida pelos pesos do paciente; aqui só se limita o início, junto aos dentes.)
    p.deformTissue((P, tipo) => {
      const rel = P.clone().sub(boca);
      const s = rel.dot(dir);
      const ends = smooth(0, 0.02, s) * (1 - smooth(comprimento, comprimento + 0.01, s));
      if (ends <= 0) return null;
      const h = rel.dot(anterior);
      const x = rel.x - VISAO.laminaEsquerda;
      const lado = 1 - smooth(VISAO.canalLargura, VISAO.canalLargura + VISAO.canalBorda, Math.abs(x));
      if (lado <= 0) return null;
      if (tipo === 'palato') {
        const livre = -VISAO.folgaPalato;
        return h > livre ? anterior.clone().multiplyScalar((livre - h) * lado * ends) : null;
      }
      const alvo = Math.min(teto(s), VISAO.tetoMax) + VISAO.folgaLamina; // logo além da lâmina
      return h < alvo ? anterior.clone().multiplyScalar((alvo - h) * lado * ends) : null;
    });
    p.applyPose({ jaw, ext });
  }

  /**
   * Pose da mão esquerda com o laringoscópio ao longo da inserção. `u` = 0 (lâmina sobre a boca, à
   * direita) a 1 (ponta na valécula); `lift` = tração no eixo do cabo (0–1).
   * Na posição de uso o cabo aponta para cima e para os pés, e a lâmina entra pela boca.
   */
  private scopePose(u: number, lift: number): Pose {
    const p = this.patient!;
    const tool = this.tools.find((t) => t.def.id === 'laringoscopio')!;
    if (!this.sight) this.prepareSight();
    const sight = this.sight!;
    const gate = p.incisor('upper').lerp(p.incisor('lower'), 0.5);
    const d1 = sight.corda;
    const d0 = d1.clone().applyAxisAngle(X, 0.5); // no início a lâmina vem mais de cima
    const dir = d0.lerp(d1, smooth(0, 1, u)).normalize();
    // Ponta: sai de cima da boca pelo lado direito do paciente, entra pelo canto direito e vai à valécula.
    const a = gate.clone().add(new Vector3(-0.014, 0.04, -0.012));
    const b = gate.clone().add(new Vector3(-0.013, -0.006, 0.004));
    const c = sight.ponta;
    const tip = a.multiplyScalar((1 - u) ** 2).addScaledVector(b, 2 * u * (1 - u)).addScaledVector(c, u * u);
    // Rotação do instrumento: cabo para cima (giro de 180° no eixo da lâmina) e a corda da lâmina em `dir`.
    const corda = tool.tipLocal.clone().sub(new Vector3(0, 0.066, 0.012));
    const a0 = Math.atan2(-corda.y, corda.z);
    const phi = a0 - Math.atan2(dir.y, dir.z);
    const quat = new Quaternion().setFromEuler(new Euler(phi, 0, Math.PI));
    const pos = tip.sub(tool.tipLocal.clone().applyQuaternion(quat));
    // Tração no eixo do cabo: no fim da inserção a lâmina ainda está "pousada"; a tração a leva ao lugar.
    pos.addScaledVector(new Vector3(0, -1, 0).applyQuaternion(quat), -0.007 * (1 - lift));
    return { pos, quat: quat.multiply(gripQuat('left', tool.def).invert()) };
  }

  /** Laringoscopia: a lâmina entra pela direita, rebate a língua, vai à valécula e traciona; corta para a visão interna. */
  private doLaryngoscopy(): void {
    const p = this.patient;
    if (!p) return;
    const side: Side = 'left';
    const hand = this.hands[side];
    this.prepareSight();
    this.act(side, [
      this.ir(side, () => this.scopePose(0, 0), 0.85),
      {
        // Inserção num gesto só: entra pela direita, varre a língua e avança até a valécula.
        dur: 1.8,
        linear: true,
        update: (u) => {
          const t = minJerk(u);
          p.applyPose({ tongue: smooth(0.2, 1, t), jaw: lerp(JAW_ABERTA, JAW_LAMINA, t), ext: lerp(1, EXT_LAMINA, t) });
          const pose = this.scopePose(t, 0);
          hand.place(pose.pos, pose.quat);
        },
      },
      {
        // Tração no eixo do cabo.
        dur: 0.7,
        linear: true,
        update: (u) => {
          const pose = this.scopePose(1, minJerk(u));
          hand.place(pose.pos, pose.quat);
        },
      },
      { dur: 0.45 },
      { dur: 0, fim: () => this.enterInside() },
    ], true);
  }

  /** Corta para a visão de dentro da boca. A esquerda segura o laringoscópio; a direita escolhe pela roda. */
  private enterInside(): void {
    this.easy.laringoscopia = true;
    this.mode = 'interna';
    this.ui.blink();
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
    this.ui.blink();
    this.pin.left = null;
    hand.setVisible(true);
    this.ui.setCaption(null);
    this.ui.setWheel(null);
    this.updateView();
    this.snapHands();
    this.act(side, [
      {
        dur: 1.1,
        linear: true,
        update: (u) => {
          const t = minJerk(u);
          p.applyPose({ tongue: 1 - smooth(0, 0.75, t), jaw: lerp(JAW_LAMINA, JAW_ABERTA, t), ext: lerp(EXT_LAMINA, 1, t) });
          const pose = this.scopePose(1 - t, 1 - t);
          hand.place(pose.pos, pose.quat);
        },
      },
      this.ir(side, () => this.restPose(side), 0.55, { inicio: () => this.world.refreshLandmarks() }),
    ], true);
  }

  // ------------------------------------------------------------------ depuração (testes e screenshots)
  private readonly marks: Mesh[] = [];

  /** Corta a cena num plano sagital (mostra só x < `x`); null desliga. */
  debugSection(x: number | null): void {
    this.renderer.clippingPlanes = x === null ? [] : [new Plane(new Vector3(-1, 0, 0), x)];
  }

  /** Marca pontos do mundo com esferas coloridas (vazio apaga). */
  debugMarks(points: Vector3[], raio = 0.0015): void {
    for (const m of this.marks) m.removeFromParent();
    this.marks.length = 0;
    points.forEach((p, i) => {
      const m = new Mesh(new SphereGeometry(raio, 10, 8), new MeshBasicMaterial({ color: [0xffe100, 0x00e5ff, 0x00ff66, 0xff00ff, 0xffffff][i % 5], depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 20;
      this.marks.push(m);
      this.scene.add(m);
    });
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
    const sight = this.sight;
    if (this.mode === 'interna' && p && sight) {
      // Visão pela boca: sobre a linha de visão, olhando para a laringe; "para cima" é o lado anterior
      // (onde está a lâmina). Fica um pouco à direita e abaixo da lâmina, como o olho do operador.
      this.view.position.copy(sight.mira).lerp(sight.boca, SHOTS.interna.recuo)
        .addScaledVector(X, -SHOTS.interna.direita).addScaledVector(sight.anterior, -SHOTS.interna.posterior);
      this.view.up.copy(sight.anterior);
      this.view.lookAt(sight.mira);
    } else {
      const eye = DOCTOR.eye.clone().add(this.lean);
      // O médico se debruça um pouco sobre o paciente enquanto age nele.
      eye.addScaledVector(this.world.landmarks.boca.clone().sub(eye).normalize(), VIEWMODEL.focus * this.focus);
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
    // Visão pela boca: uma luz junto ao olho do operador (como um fotóforo) ilumina o canal até a laringe;
    // a luz ambiente da sala entra pouco.
    const inside = this.mode === 'interna';
    this.innerLight.intensity = inside ? INTERNA.luzCamera : 0;
    if (inside && this.sight) {
      const st = this.sight;
      this.innerLight.position.copy(st.mira).lerp(st.boca, SHOTS.interna.recuo + 0.06).addScaledVector(st.anterior, -SHOTS.interna.posterior);
    }
    this.scene.environmentIntensity = inside ? INTERNA.ambiente : 0.45;
    const scope = this.tools.find((t) => t.def.id === 'laringoscopio');
    if (scope?.light && scope.light.intensity > 0) scope.light.intensity = this.mode === 'interna' ? INTERNA.luzLamina : 0.35;
  }

  private updateHands(dt: number): void {
    const reach = (DOCTOR.upperArm + DOCTOR.forearm) * 0.96;
    const alvoFoco = this.mode === 'medico' && (this.inWorld.left || this.inWorld.right) ? 1 : 0;
    this.focus += (alvoFoco - this.focus) * (1 - Math.exp(-3.5 * dt));
    const antes = new Vector3();
    for (const side of SIDES) {
      const hand = this.hands[side];
      const seq = this.acting[side];
      const pin = this.pin[side];
      antes.copy(hand.root.position);
      if (pin) {
        const pose = pin();
        const k = 1 - Math.exp(-12 * dt);
        hand.root.position.lerp(pose.pos, k);
        hand.root.quaternion.slerp(pose.quat, k);
      } else if (seq) {
        if (seq.update(dt)) {
          this.acting[side] = null;
          this.inWorld[side] = false;
          if (!this.pin[side] && this.mode !== 'lateral') hand.setLayer(LAYER_FPS);
        }
      } else {
        const rest = this.restPose(side);
        const k = 1 - Math.exp(-VIEWMODEL.follow * dt);
        hand.root.position.lerp(rest.pos, k);
        hand.root.quaternion.slerp(rest.quat, k);
      }
      if (dt > 1e-5) this.handVel[side].copy(hand.root.position).sub(antes).divideScalar(dt);
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
