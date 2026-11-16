import { describe, expect, it } from 'vitest';
import { ease, Sequencia } from '../src/game/anim';

describe('Sequencia', () => {
  it('executa as fases em ordem, com início, progresso e fim', () => {
    const log: string[] = [];
    const seq = new Sequencia([
      { dur: 1, inicio: () => log.push('a:inicio'), update: (t) => log.push(`a:${t.toFixed(2)}`), fim: () => log.push('a:fim') },
      { dur: 0.5, inicio: () => log.push('b:inicio'), fim: () => log.push('b:fim') },
    ]);
    expect(seq.update(0.5)).toBe(false);
    expect(seq.update(0.6)).toBe(false);
    expect(seq.update(0.5)).toBe(true);
    expect(log).toEqual(['a:inicio', 'a:0.50', 'a:1.00', 'a:fim', 'b:inicio', 'b:fim']);
    expect(seq.terminada).toBe(true);
  });
  it('um passo longo atravessa várias fases sem pular os callbacks', () => {
    let n = 0;
    const seq = new Sequencia([{ dur: 0.1, fim: () => n++ }, { dur: 0.1, fim: () => n++ }, { dur: 0.1, fim: () => n++ }]);
    expect(seq.update(1)).toBe(true);
    expect(n).toBe(3);
  });
  it('ease é suave nas pontas e limitado a 0..1', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(2)).toBe(1);
  });
});
