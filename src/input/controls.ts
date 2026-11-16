import { Vector2, Vector3 } from 'three';

/** Mapeamentos puros de teclas → intenção, separados para poderem ser testados sem navegador. */
type Down = (code: string) => boolean;
const axis = (down: Down, pos: string, neg: string) => (down(pos) ? 1 : 0) - (down(neg) ? 1 : 0);

/** WASD = olhar em volta. x > 0 vira para a esquerda (A), y > 0 olha para cima (W). */
export function lookIntent(down: Down): Vector2 {
  return new Vector2(axis(down, 'KeyA', 'KeyD'), axis(down, 'KeyW', 'KeyS'));
}

/** Setas = inclinar o corpo (ver melhor dentro da boca). */
export function leanIntent(down: Down): Vector3 {
  return new Vector3(axis(down, 'ArrowLeft', 'ArrowRight'), 0, axis(down, 'ArrowUp', 'ArrowDown'));
}
