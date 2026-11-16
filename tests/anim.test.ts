import { describe, expect, it } from 'vitest';
import { ease, hermite, minJerk, Sequencia } from '../src/game/anim';

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
  it('fase linear recebe o progresso bruto', () => {
    const vistos: number[] = [];
    const seq = new Sequencia([{ dur: 1, linear: true, update: (t) => vistos.push(t) }]);
    seq.update(0.25);
    expect(vistos[0]).toBeCloseTo(0.25);
  });
  it('minJerk vai de 0 a 1, é simétrico e parte devagar', () => {
    expect(minJerk(0)).toBe(0);
    expect(minJerk(1)).toBe(1);
    expect(minJerk(0.5)).toBeCloseTo(0.5);
    expect(minJerk(0.1)).toBeLessThan(ease(0.1));
    expect(minJerk(0.3) + minJerk(0.7)).toBeCloseTo(1);
  });
  it('hermite respeita posições e velocidades nas pontas', () => {
    expect(hermite(2, 3, 5, -1, 0)).toBe(2);
    expect(hermite(2, 3, 5, -1, 1)).toBeCloseTo(5);
    const h = 1e-5;
    expect((hermite(2, 3, 5, -1, h) - 2) / h).toBeCloseTo(3, 3);
    expect((5 - hermite(2, 3, 5, -1, 1 - h)) / h).toBeCloseTo(-1, 3);
  });
});
