import { describe, expect, it } from 'vitest';
import { digitPressed, keyboardHandIntent, leanIntent } from '../src/input/controls';

const keys = (...codes: string[]) => (c: string) => codes.includes(c);

describe('keyboardHandIntent', () => {
  it('W leva a mão para os pés do paciente (+Z) e A para a esquerda do médico (+X)', () => {
    const i = keyboardHandIntent(keys('KeyW', 'KeyA'));
    expect(i.move.toArray()).toEqual([1, 0, 1]);
  });
  it('teclas opostas se anulam', () => {
    expect(keyboardHandIntent(keys('KeyW', 'KeyS', 'KeyQ', 'KeyE')).move.toArray()).toEqual([0, 0, 0]);
  });
  it('R/F inclinam e Z/C giram', () => {
    expect(keyboardHandIntent(keys('KeyR')).tilt).toBe(1);
    expect(keyboardHandIntent(keys('KeyF')).tilt).toBe(-1);
    expect(keyboardHandIntent(keys('KeyC')).roll).toBe(-1);
  });
});

describe('outros atalhos', () => {
  it('setas inclinam o corpo', () => {
    expect(leanIntent(keys('ArrowUp', 'ArrowLeft')).toArray()).toEqual([1, 0, 1]);
  });
  it('dígitos viram índice de ferramenta', () => {
    expect(digitPressed(new Set(['Digit3']))).toBe(3);
    expect(digitPressed(new Set(['Numpad0']))).toBe(0);
    expect(digitPressed(new Set(['KeyW']))).toBeNull();
  });
});
