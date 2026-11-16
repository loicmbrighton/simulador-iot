import { describe, expect, it } from 'vitest';
import { leanIntent, lookIntent } from '../src/input/controls';

const keys = (...codes: string[]) => (c: string) => codes.includes(c);

describe('atalhos de visão', () => {
  it('A vira para a esquerda e W olha para cima', () => {
    expect(lookIntent(keys('KeyA', 'KeyW')).toArray()).toEqual([1, 1]);
    expect(lookIntent(keys('KeyD', 'KeyS')).toArray()).toEqual([-1, -1]);
  });
  it('teclas opostas se anulam', () => {
    expect(lookIntent(keys('KeyA', 'KeyD', 'KeyW', 'KeyS')).toArray()).toEqual([0, 0]);
  });
  it('setas inclinam o corpo', () => {
    expect(leanIntent(keys('ArrowUp', 'ArrowLeft')).toArray()).toEqual([1, 0, 1]);
  });
});
