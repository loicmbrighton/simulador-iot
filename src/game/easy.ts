import type { Side } from '../config';
import type { ToolId } from '../tools/tools';

/** Progresso do Modo Easy no paciente. */
export interface EasyState {
  /** Coxim sob o occipício e cabeça em posição olfativa. */
  olfativa: boolean;
  bocaAberta: boolean;
  /** Laringoscópio na valécula, com a glote exposta. */
  laringoscopia: boolean;
}

export const estadoInicial = (): EasyState => ({ olfativa: false, bocaAberta: false, laringoscopia: false });

export type Alvo = 'cabeca' | 'boca';
export type Acao = 'olfativa' | 'abrirBoca' | 'laringoscopia';

/**
 * Resultado de um clique no paciente:
 * - `acao`: está certo, dispara a animação;
 * - `dica`: nada acontece, só uma orientação neutra (deslize leve);
 * - `erro`: conduta errada (instrumento errado, mão errada ou fora de ordem): a tela pisca em vermelho
 *   e os sinais vitais pioram.
 */
export type Resultado = { tipo: 'acao'; acao: Acao } | { tipo: 'dica'; msg: string } | { tipo: 'erro'; msg: string };

const acao = (a: Acao): Resultado => ({ tipo: 'acao', acao: a });
const dica = (msg: string): Resultado => ({ tipo: 'dica', msg });
const erro = (msg: string): Resultado => ({ tipo: 'erro', msg });

/**
 * Regras do clique no paciente. Pegar ou devolver instrumentos nunca é erro: só é erro tentar agir
 * no paciente com o instrumento errado, com a mão errada ou antes da hora.
 */
export function avaliar(estado: EasyState, alvo: Alvo, mao: Side, instrumento: ToolId | null): Resultado {
  if (alvo === 'cabeca') {
    if (instrumento === 'coxim') return estado.olfativa ? dica('O coxim já está no lugar.') : acao('olfativa');
    if (instrumento === null) return dica(estado.olfativa ? 'A cabeça já está em posição olfativa.' : 'Para posicionar a cabeça, pegue antes o coxim.');
    return erro('Este instrumento não é usado na cabeça.');
  }

  // Boca.
  if (instrumento === 'coxim') return erro('O coxim vai sob a cabeça, não na boca.');
  if (!estado.olfativa) return erro('Antes de mexer na boca, coloque o coxim e deixe a cabeça em posição olfativa.');
  if (instrumento === null) {
    if (estado.bocaAberta) return dica('A boca já está aberta.');
    return mao === 'right' ? acao('abrirBoca') : dica('Abra a boca com a mão direita: a esquerda é a do laringoscópio.');
  }
  if (instrumento === 'laringoscopio') {
    if (!estado.bocaAberta) return erro('Abra a boca do paciente antes de inserir o laringoscópio.');
    if (mao === 'right') return erro('O laringoscópio é empunhado com a mão esquerda.');
    return estado.laringoscopia ? dica('O laringoscópio já está posicionado.') : acao('laringoscopia');
  }
  if (!estado.bocaAberta) return erro('Abra a boca do paciente antes de inserir qualquer instrumento.');
  return erro('Faça a laringoscopia antes: sem ver a glote, não se insere este instrumento.');
}

export interface Passo {
  id: string;
  texto: string;
  /** O passo está cumprido neste estado? `maos` = o que cada mão segura. */
  feito: (estado: EasyState, maos: Record<Side, ToolId | null>) => boolean;
}

/** A "colinha": sequência correta, na ordem. O passo atual é o primeiro ainda não cumprido. */
export const PASSOS: Passo[] = [
  { id: 'coxim', texto: 'Pegar o coxim', feito: (e, m) => e.olfativa || m.left === 'coxim' || m.right === 'coxim' },
  { id: 'olfativa', texto: 'Clicar na cabeça: coxim e posição olfativa', feito: (e) => e.olfativa },
  { id: 'laringo', texto: 'Pegar o laringoscópio com a mão esquerda', feito: (e, m) => e.laringoscopia || m.left === 'laringoscopio' },
  { id: 'boca', texto: 'Abrir a boca com a mão direita livre', feito: (e) => e.bocaAberta },
  { id: 'laringoscopia', texto: 'Inserir o laringoscópio pela boca', feito: (e) => e.laringoscopia },
];

/** Índice do passo atual (PASSOS.length = todos cumpridos). */
export function passoAtual(estado: EasyState, maos: Record<Side, ToolId | null>): number {
  const i = PASSOS.findIndex((p) => !p.feito(estado, maos));
  return i < 0 ? PASSOS.length : i;
}
