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
  it('cada ferramenta tem uma tecla única de 1 a 5', () => {
    const keys = TOOL_DEFS.map((d) => d.tecla).sort();
    expect(keys).toEqual([1, 2, 3, 4, 5]);
  });
});
