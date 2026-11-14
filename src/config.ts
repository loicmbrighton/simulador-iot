import { Vector3 } from 'three';

/**
 * Sistema de coordenadas (metros), visto pelo médico em pé na cabeceira:
 *   +X = esquerda do médico (= esquerda do paciente, que está em decúbito dorsal com a cabeça no médico)
 *   +Y = para cima
 *   +Z = em direção aos pés do paciente (para longe do médico)
 */

export type ScenarioId = 'sri' | 'eletiva' | 'easy';
export type ControlScheme = 'duas-maos' | 'mao-ativa';
export type Side = 'left' | 'right';

export interface ScenarioInfo {
  id: ScenarioId;
  nome: string;
  local: string;
  resumo: string;
  paredes: number;
}

export const SCENARIOS: Record<ScenarioId, ScenarioInfo> = {
  sri: {
    id: 'sri',
    nome: 'Sequência Rápida',
    local: 'Sala de emergência',
    resumo: 'Estômago cheio, indução e bloqueio em bólus, sem ventilação de rotina antes da laringoscopia.',
    paredes: 0xb9c4bd,
  },
  eletiva: {
    id: 'eletiva',
    nome: 'Eletiva',
    local: 'Centro cirúrgico',
    resumo: 'Jejum adequado, indução titulada e ventilação sob máscara antes do bloqueio neuromuscular.',
    paredes: 0x9fc3c4,
  },
  easy: {
    id: 'easy',
    nome: 'Modo Easy',
    local: 'Sala de treino',
    resumo: 'Só a mecânica da intubação: sem fármacos e sem mensagens de erro para deslizes leves.',
    paredes: 0xc7c3bb,
  },
};

/** Alcance das mãos (caixa no referencial do corpo do médico). */
export const WORKSPACE = {
  min: new Vector3(-0.84, 0.95, -0.78),
  max: new Vector3(0.55, 1.6, 0.5),
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

export const SPEED = {
  /** Velocidade da mão esquerda pelo teclado (m/s). Shift = modo de precisão. */
  leftHand: 0.32,
  precisionFactor: 0.3,
  rotate: 1.6, // rad/s pelo teclado
  mouseRotate: 0.006, // rad por pixel
  wheelHeight: 0.0006, // m por unidade de deltaY da roda
  /** Constante de suavização do seguimento das mãos (maior = mais rápido). */
  follow: 14,
};
