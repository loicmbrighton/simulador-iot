import { Vector3 } from 'three';

export interface TwoBoneResult {
  elbow: Vector3;
  wrist: Vector3;
  /** true se o alvo estava fora do alcance e o braço ficou esticado. */
  clamped: boolean;
}

const EPS = 1e-4;

/**
 * IK analítico de duas articulações (ombro → cotovelo → punho).
 * `pole` indica para onde o cotovelo deve apontar.
 */
export function solveTwoBone(shoulder: Vector3, target: Vector3, pole: Vector3, l1: number, l2: number): TwoBoneResult {
  const toTarget = target.clone().sub(shoulder);
  const rawDist = toTarget.length();
  const minD = Math.abs(l1 - l2) + EPS;
  const maxD = l1 + l2 - EPS;
  const d = Math.min(Math.max(rawDist, minD), maxD);
  const dir = rawDist > EPS ? toTarget.divideScalar(rawDist) : new Vector3(0, 0, 1);

  const wrist = shoulder.clone().addScaledVector(dir, d);

  // Distância do ombro até a projeção do cotovelo no eixo ombro→punho (lei dos cossenos).
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

  const poleDir = pole.clone().sub(shoulder);
  poleDir.addScaledVector(dir, -poleDir.dot(dir));
  if (poleDir.lengthSq() < EPS * EPS) {
    poleDir.copy(Math.abs(dir.y) < 0.9 ? new Vector3(0, -1, 0) : new Vector3(1, 0, 0));
    poleDir.addScaledVector(dir, -poleDir.dot(dir));
  }
  poleDir.normalize();

  const elbow = shoulder.clone().addScaledVector(dir, a).addScaledVector(poleDir, h);
  return { elbow, wrist, clamped: rawDist > maxD || rawDist < minD };
}
