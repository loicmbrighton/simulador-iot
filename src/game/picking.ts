import { Box3, Ray, Vector3 } from 'three';

/** Forma simples usada para saber o que está sob o cursor (sem depender das malhas). */
export type PickShape =
  | { tipo: 'esfera'; centro: Vector3; raio: number }
  | { tipo: 'elipsoide'; centro: Vector3; raios: Vector3 }
  | { tipo: 'caixa'; caixa: Box3 };

export interface PickTarget<T = string> {
  id: T;
  /** Alvos de prioridade maior ganham dos de prioridade menor, mesmo estando atrás (ex.: boca × cabeça). */
  prioridade: number;
  forma: PickShape;
}

const tmp = new Vector3();

/** Distância ao longo do raio até a forma, ou null se o raio não a atinge. */
export function rayShapeDistance(ray: Ray, forma: PickShape): number | null {
  if (forma.tipo === 'caixa') {
    const hit = ray.intersectBox(forma.caixa, tmp);
    return hit ? hit.distanceTo(ray.origin) : null;
  }
  // Esfera/elipsoide: resolve no espaço em que a forma é a esfera unitária.
  const r = forma.tipo === 'esfera' ? new Vector3(forma.raio, forma.raio, forma.raio) : forma.raios;
  const o = ray.origin.clone().sub(forma.centro).divide(r);
  const d = ray.direction.clone().divide(r);
  const a = d.dot(d);
  const b = 2 * o.dot(d);
  const c = o.dot(o) - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a);
  const t1 = (-b + s) / (2 * a);
  if (t1 < 0) return null;
  return Math.max(t0, 0); // direção unitária no espaço original: t já é a distância
}

/** Alvo sob o raio: maior prioridade; em caso de empate, o mais próximo. */
export function pick<T>(ray: Ray, alvos: PickTarget<T>[]): { id: T; dist: number } | null {
  let best: { id: T; dist: number } | null = null;
  let bestPri = -Infinity;
  for (const a of alvos) {
    const dist = rayShapeDistance(ray, a.forma);
    if (dist === null) continue;
    if (a.prioridade > bestPri || (a.prioridade === bestPri && best !== null && dist < best.dist)) {
      best = { id: a.id, dist };
      bestPri = a.prioridade;
    }
  }
  return best;
}
