import { Vector3 } from 'three';

/**
 * Mapeamento puro de teclas → intenção de movimento da mão no teclado.
 * Separado do resto para poder ser testado sem navegador.
 */
export interface KeyboardHandIntent {
  /** Direção de translação (componentes -1..1, referencial do corpo do médico). */
  move: Vector3;
  /** Rotação em torno do eixo lateral (X): inclina a ponta da ferramenta para frente/trás. */
  tilt: number;
  /** Rotação em torno do eixo frontal (Z): gira a mão de lado. */
  roll: number;
}

export function keyboardHandIntent(down: (code: string) => boolean): KeyboardHandIntent {
  const axis = (pos: string, neg: string) => (down(pos) ? 1 : 0) - (down(neg) ? 1 : 0);
  return {
    // W = para frente (pés do paciente), A = esquerda do médico (+X), E = sobe.
    move: new Vector3(axis('KeyA', 'KeyD'), axis('KeyE', 'KeyQ'), axis('KeyW', 'KeyS')),
    tilt: axis('KeyR', 'KeyF'),
    roll: axis('KeyZ', 'KeyC'),
  };
}

/** Setas = inclinar o corpo (ver melhor dentro da boca). */
export function leanIntent(down: (code: string) => boolean): Vector3 {
  const axis = (pos: string, neg: string) => (down(pos) ? 1 : 0) - (down(neg) ? 1 : 0);
  return new Vector3(axis('ArrowLeft', 'ArrowRight'), 0, axis('ArrowUp', 'ArrowDown'));
}

/** Tecla numérica pressionada → índice da ferramenta (0 = mão livre). */
export function digitPressed(pressed: Set<string>): number | null {
  for (let i = 0; i <= 5; i++) if (pressed.has(`Digit${i}`) || pressed.has(`Numpad${i}`)) return i;
  return null;
}
