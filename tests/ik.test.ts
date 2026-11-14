import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBone } from '../src/hands/ik';

const S = new Vector3(0, 0, 0);
const POLE = new Vector3(0, -1, 0);

describe('solveTwoBone', () => {
  it('mantém o comprimento dos dois segmentos', () => {
    const { elbow, wrist } = solveTwoBone(S, new Vector3(0.3, 0.1, 0.35), POLE, 0.32, 0.3);
    expect(elbow.distanceTo(S)).toBeCloseTo(0.32, 5);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(0.3, 5);
    expect(wrist.distanceTo(new Vector3(0.3, 0.1, 0.35))).toBeLessThan(1e-6);
  });

  it('aponta o cotovelo para o polo', () => {
    const { elbow } = solveTwoBone(S, new Vector3(0, 0, 0.4), POLE, 0.32, 0.3);
    expect(elbow.y).toBeLessThan(0);
  });

  it('estica o braço e sinaliza quando o alvo está fora de alcance', () => {
    const r = solveTwoBone(S, new Vector3(0, 0, 2), POLE, 0.32, 0.3);
    expect(r.clamped).toBe(true);
    expect(r.wrist.distanceTo(S)).toBeCloseTo(0.62, 3);
    expect(r.wrist.z).toBeGreaterThan(0.6);
  });

  it('não gera NaN com alvo sobre o ombro ou polo colinear', () => {
    const a = solveTwoBone(S, S.clone(), POLE, 0.32, 0.3);
    const b = solveTwoBone(S, new Vector3(0, -0.5, 0), POLE, 0.32, 0.3);
    for (const v of [a.elbow, a.wrist, b.elbow, b.wrist]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });
});
