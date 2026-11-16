import { Box3, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pick, rayShapeDistance, type PickTarget } from '../src/game/picking';

const down = (x: number, z: number) => new Ray(new Vector3(x, 2, z), new Vector3(0, -1, 0));

describe('picking', () => {
  it('distância até esfera, elipsoide e caixa', () => {
    expect(rayShapeDistance(down(0, 0), { tipo: 'esfera', centro: new Vector3(0, 1, 0), raio: 0.1 })).toBeCloseTo(0.9, 6);
    expect(rayShapeDistance(down(0, 0), { tipo: 'elipsoide', centro: new Vector3(0, 1, 0), raios: new Vector3(0.3, 0.2, 0.1) })).toBeCloseTo(0.8, 6);
    expect(rayShapeDistance(down(0, 0), { tipo: 'caixa', caixa: new Box3(new Vector3(-1, 0, -1), new Vector3(1, 0.5, 1)) })).toBeCloseTo(1.5, 6);
  });
  it('raio que passa ao lado ou aponta para longe não acerta', () => {
    const esfera = { tipo: 'esfera' as const, centro: new Vector3(0, 1, 0), raio: 0.1 };
    expect(rayShapeDistance(down(0.2, 0), esfera)).toBeNull();
    expect(rayShapeDistance(new Ray(new Vector3(0, 2, 0), new Vector3(0, 1, 0)), esfera)).toBeNull();
  });
  it('elipsoide respeita os raios de cada eixo', () => {
    const e = { tipo: 'elipsoide' as const, centro: new Vector3(0, 1, 0), raios: new Vector3(0.3, 0.2, 0.1) };
    expect(rayShapeDistance(down(0.25, 0), e)).not.toBeNull();
    expect(rayShapeDistance(down(0, 0.25), e)).toBeNull();
  });
  it('prioridade maior ganha mesmo estando atrás; empate fica com o mais próximo', () => {
    const alvos: PickTarget[] = [
      { id: 'cabeca', prioridade: 1, forma: { tipo: 'esfera', centro: new Vector3(0, 1, 0), raio: 0.3 } },
      { id: 'boca', prioridade: 3, forma: { tipo: 'esfera', centro: new Vector3(0, 1, 0), raio: 0.05 } },
      { id: 'longe', prioridade: 1, forma: { tipo: 'esfera', centro: new Vector3(0, 0, 0), raio: 0.3 } },
    ];
    expect(pick(down(0, 0), alvos)?.id).toBe('boca');
    expect(pick(down(0.2, 0), alvos)?.id).toBe('cabeca');
    expect(pick(down(5, 0), alvos)).toBeNull();
  });
});
