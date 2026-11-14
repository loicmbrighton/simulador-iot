import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';

/**
 * Varre uma seção transversal (polígono fechado no plano lateral×normal) ao longo de um caminho
 * contido no plano YZ. O eixo lateral é sempre +X, então a peça nunca "torce" (útil para lâminas).
 *
 * @param path pontos do caminho (no plano YZ)
 * @param section função t∈[0,1] → polígono fechado; x do Vector2 = lateral (+X), y = normal
 */
export function sweepPlanar(path: Vector3[], section: (t: number) => Vector2[]): BufferGeometry {
  const side = new Vector3(1, 0, 0);
  const rings: Vector3[][] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const normal = tangent.clone().cross(side).normalize();
    const t = i / (path.length - 1);
    rings.push(section(t).map((p) => path[i].clone().addScaledVector(side, p.x).addScaledVector(normal, p.y)));
  }

  const pos: number[] = [];
  const push = (v: Vector3) => pos.push(v.x, v.y, v.z);
  const n = rings[0].length;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % n], c = rings[i + 1][(j + 1) % n], d = rings[i + 1][j];
      push(a); push(b); push(c);
      push(a); push(c); push(d);
    }
  }
  // Tampas nas extremidades (leque a partir do centroide).
  for (const [ring, flip] of [[rings[0], true], [rings[rings.length - 1], false]] as const) {
    const center = ring.reduce((acc, v) => acc.add(v), new Vector3()).divideScalar(ring.length);
    for (let j = 0; j < n; j++) {
      const a = ring[j], b = ring[(j + 1) % n];
      if (flip) { push(center); push(b); push(a); } else { push(center); push(a); push(b); }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
