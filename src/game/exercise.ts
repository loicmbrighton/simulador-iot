import { Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Side } from '../config';

export interface ExerciseTarget {
  nome: string;
  pos: Vector3;
  mao: Side;
}

/** Treino de controle: tocar alvos com a ponta da ferramenta (ou do dedo) da mão indicada. */
export class Exercise {
  readonly group = new Group();
  active = false;
  index = 0;
  elapsed = 0;
  finishedTime: number | null = null;
  private readonly marker: Mesh;
  private readonly ring: Mesh;
  private readonly mats: Record<Side, MeshStandardMaterial> = {
    left: new MeshStandardMaterial({ color: 0xffa531, emissive: 0x8a4a00, transparent: true, opacity: 0.85 }),
    right: new MeshStandardMaterial({ color: 0x35c8ff, emissive: 0x00527a, transparent: true, opacity: 0.85 }),
  };

  constructor(private targets: ExerciseTarget[], private readonly radius = 0.014) {
    this.marker = new Mesh(new SphereGeometry(0.007, 16, 12), this.mats.left);
    this.ring = new Mesh(new TorusGeometry(radius, 0.0012, 8, 32), this.mats.left);
    this.group.add(this.marker, this.ring);
    this.group.visible = false;
  }

  setTargets(t: ExerciseTarget[]): void {
    this.targets = t;
    if (this.active) this.toggle();
  }

  get current(): ExerciseTarget | null {
    return this.active && this.index < this.targets.length ? this.targets[this.index] : null;
  }

  get total(): number {
    return this.targets.length;
  }

  toggle(): void {
    this.active = !this.active;
    this.index = 0;
    this.elapsed = 0;
    this.finishedTime = null;
    this.group.visible = this.active;
    this.place();
  }

  /** Retorna true quando um alvo é atingido. */
  update(dt: number, tips: Record<Side, Vector3>, cameraPos: Vector3): boolean {
    const t = this.current;
    if (!t) return false;
    this.elapsed += dt;
    const pulse = 1 + Math.sin(this.elapsed * 6) * 0.15;
    this.ring.scale.setScalar(pulse);
    this.ring.lookAt(cameraPos);
    if (tips[t.mao].distanceTo(t.pos) < this.radius) {
      this.index++;
      if (this.index >= this.targets.length) {
        this.finishedTime = this.elapsed;
        this.group.visible = false;
      } else {
        this.place();
      }
      return true;
    }
    return false;
  }

  private place(): void {
    const t = this.current;
    if (!t) return;
    this.marker.position.copy(t.pos);
    this.ring.position.copy(t.pos);
    this.marker.material = this.mats[t.mao];
    this.ring.material = this.mats[t.mao];
  }
}
