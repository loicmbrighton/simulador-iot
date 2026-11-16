/** Uma fase de animação: `update` recebe o progresso suavizado (0..1). */
export interface Fase {
  dur: number;
  inicio?: () => void;
  update?: (t: number) => void;
  fim?: () => void;
}

/** Suavização de entrada e saída (smoothstep). */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
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
        f.update?.(ease(this.t / f.dur));
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
