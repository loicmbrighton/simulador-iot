import { Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import { gripQuat, readyHandQuat, TOOL_DEFS } from '../src/tools/tools';

describe('empunhadura', () => {
  it('a mão na pose pronta deixa a ferramenta exatamente na orientação "pronta", nas duas mãos', () => {
    for (const def of TOOL_DEFS) {
      for (const side of ['left', 'right'] as const) {
        const world = readyHandQuat(def, side).multiply(gripQuat(side));
        const expected = new Quaternion().setFromEuler(def.pronta);
        expect(Math.abs(world.dot(expected))).toBeCloseTo(1, 6);
      }
    }
  });
  it('cada ferramenta tem um identificador único e um lugar próprio na bandeja', () => {
    expect(new Set(TOOL_DEFS.map((d) => d.id)).size).toBe(TOOL_DEFS.length);
    for (const a of TOOL_DEFS) for (const b of TOOL_DEFS) if (a !== b) expect(a.bandeja.pos.distanceTo(b.bandeja.pos)).toBeGreaterThan(0.05);
  });
});
