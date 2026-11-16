/** Uma fase de animação: `update` recebe o progresso suavizado (0..1). */
export interface Fase {
  dur: number;
  /** Com `linear`, `update` recebe o progresso bruto (quem anima aplica a própria curva). */
  linear?: boolean;
  inicio?: () => void;
  update?: (t: number) => void;
  fim?: () => void;
}

/** Suavização de entrada e saída (smoothstep). */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Perfil de mínimo jerk (10t³ − 15t⁴ + 6t⁵): velocidade em forma de sino, com aceleração nula nas pontas.
 * É o perfil dos movimentos de alcance humanos; fica menos "robótico" que o smoothstep.
 */
export function minJerk(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (10 + x * (-15 + 6 * x));
}

/** Interpolação cúbica de Hermite (u em 0..1): sai de p0 com velocidade v0 e chega a p1 com velocidade v1. */
export function hermite(p0: number, v0: number, p1: number, v1: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return p0 * (2 * u3 - 3 * u2 + 1) + v0 * (u3 - 2 * u2 + u) + p1 * (-2 * u3 + 3 * u2) + v1 * (u3 - u2);
}

/** Executa fases em ordem. É a base das animações automáticas disparadas por clique. */
export class Sequencia {
  private i = 0;
  private t = 0;
  private started = false;

  constructor(private readonly fases: Fase[]) {}

  get terminada(): boolean {
    return this.i >= this.fases.length;
  }

  /** Avança o tempo; retorna true quando a sequência termina. */
  update(dt: number): boolean {
    let resto = dt;
    while (!this.terminada) {
      const f = this.fases[this.i];
      if (!this.started) {
        this.started = true;
        f.inicio?.();
      }
      const falta = f.dur - this.t;
      if (resto < falta) {
        this.t += resto;
        f.update?.(f.linear ? this.t / f.dur : ease(this.t / f.dur));
        return false;
      }
      resto -= Math.max(0, falta);
      f.update?.(1);
      f.fim?.();
      this.i++;
      this.t = 0;
      this.started = false;
    }
    return true;
  }
}
