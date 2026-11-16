import { Vector3 } from 'three';

/**
 * Sistema de coordenadas (metros), visto pelo médico em pé na cabeceira:
 *   +X = esquerda do médico (= esquerda do paciente, que está em decúbito dorsal com a cabeça no médico)
 *   +Y = para cima
 *   +Z = em direção aos pés do paciente (para longe do médico)
 */

export type ScenarioId = 'sri' | 'eletiva' | 'easy';
export type Side = 'left' | 'right';

export interface ScenarioInfo {
  id: ScenarioId;
  nome: string;
  local: string;
  resumo: string;
  paredes: number;
  /** false = em standby (aparece no menu como "em breve"). */
  disponivel: boolean;
}

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  sri: {
    id: 'sri',
    nome: 'Sequência Rápida',
    local: 'Sala de emergência',
    resumo: 'Estômago cheio, indução e bloqueio em bólus, sem ventilação de rotina antes da laringoscopia.',
    paredes: 0xb9c4bd,
    disponivel: false,
  },
  eletiva: {
    id: 'eletiva',
    nome: 'Eletiva',
    local: 'Centro cirúrgico',
    resumo: 'Jejum adequado, indução titulada e ventilação sob máscara antes do bloqueio neuromuscular.',
    paredes: 0x9fc3c4,
    disponivel: false,
  },
  easy: {
    id: 'easy',
    nome: 'Modo Easy',
    local: 'Sala de treino',
    resumo: 'Aponte e clique: pegue os instrumentos na ordem certa e clique no lugar certo. As animações são automáticas.',
    paredes: 0xc7c3bb,
    disponivel: true,
  },
};

export const DOCTOR = {
  eye: new Vector3(0, 1.56, -0.6),
  lookAt: new Vector3(0, 1.06, 0.15),
  /** Ombros um pouco abaixo e ao lado dos olhos (médico levemente inclinado sobre a cabeceira). */
  shoulder: { left: new Vector3(0.19, 1.33, -0.56), right: new Vector3(-0.19, 1.33, -0.56) } as Record<Side, Vector3>,
  upperArm: 0.32,
  forearm: 0.3,
  /** Inclinação máxima do corpo (setas do teclado). */
  leanMax: new Vector3(0.18, 0.12, 0.16),
};

/**
 * Mãos em repouso na "camada FPS": posições definidas no mundo para a visão padrão do médico e
 * depois presas à câmera (acompanham o olhar e a inclinação do corpo).
 */
export const VIEWMODEL = {
  rest: { left: new Vector3(0.23, 1.14, -0.33), right: new Vector3(-0.23, 1.14, -0.33) } as Record<Side, Vector3>,
  /** A mão ativa fica um pouco mais alta e mais à frente que a outra. */
  activeLift: new Vector3(0, 0.025, 0.03),
  /** Suavização do retorno à pose de repouso (maior = mais rápido). */
  follow: 16,
  /** Balanço lento das mãos em repouso (respiração): amplitude em metros e em radianos. */
  sway: 0.003,
  swayRot: 0.018,
  /** Quanto o médico se aproxima do paciente enquanto uma mão age nele (metros). */
  focus: 0.06,
};

export const LOOK = {
  /** rad/s pelo teclado (WASD) e rad por pixel com o botão direito. */
  keys: 1.1,
  mouse: 0.004,
  yawMax: 1.2,
  pitchMin: -0.6,
  pitchMax: 0.7,
  lean: 0.25, // m/s
};

/**
 * Sinais vitais do Modo Easy. Valores iniciais e o quanto cada erro de conduta piora o paciente.
 * São números didáticos, não um modelo fisiológico: ajustar à vontade (validação clínica do usuário).
 */
export const VITALS = {
  fc: 78,
  spo2: 98,
  /** Efeito de cada erro. */
  erro: { fc: 9, spo2: -4 },
  limite: { fc: 165, spo2: 60 },
  /** A partir daqui o valor pisca em vermelho no monitor. */
  alarme: { fc: 110, spo2: 90 },
};

/** Câmeras de corte (posições no mundo). */
export const SHOTS = {
  /** Vista lateral da cabeça e do pescoço, para mostrar a posição olfativa. */
  lateral: { pos: new Vector3(0.98, 1.17, -0.1), target: new Vector3(0, 1.07, 0.06), fov: 35 },
  /**
   * Visão pela boca (laringoscopia): a câmera fica sobre a linha boca → laringe. `recuo` = 0 na laringe,
   * 1 nos lábios; `direita`/`posterior` afastam a câmera da lâmina (metros).
   */
  interna: { recuo: 0.85, direita: 0.004, posterior: 0.006, fov: 33 },
  medico: { fov: 58 },
};
