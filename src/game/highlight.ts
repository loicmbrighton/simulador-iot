import { Color, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, TorusGeometry, Vector3 } from 'three';

const COR = new Color(0x35c8ff);

/** Destaque do que está sob o cursor: brilho no instrumento ou anel pulsante num ponto do paciente. */
export class Highlighter {
  readonly ring: Mesh;
  private readonly cache = new Map<Material, Material>();
  private swapped: [Mesh, Material][] = [];
  private current: Object3D | null = null;
  private clock = 0;

  constructor() {
    const mat = new MeshBasicMaterial({ color: COR, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    this.ring = new Mesh(new TorusGeometry(1, 0.06, 8, 48), mat);
    this.ring.renderOrder = 10;
    this.ring.visible = false;
  }

  /** Destaca um objeto (instrumento) trocando seus materiais por cópias com emissão. */
  object(obj: Object3D | null): void {
    if (obj === this.current) return;
    for (const [m, mat] of this.swapped) m.material = mat;
    this.swapped = [];
    this.current = obj;
    obj?.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const src = m.material as MeshStandardMaterial;
      if (!src.emissive || src.emissive.getHex() !== 0) return; // lâmpada e marcas já emissivas ficam como estão
      let hi = this.cache.get(src);
      if (!hi) {
        const c = src.clone();
        c.emissive = COR.clone();
        c.emissiveIntensity = 0.45;
        hi = c;
        this.cache.set(src, hi);
      }
      this.swapped.push([m, src]);
      m.material = hi;
    });
  }

  /** Anel num ponto do mundo (null esconde). */
  zone(p: Vector3 | null, raio = 0.03): void {
    this.ring.visible = p !== null;
    if (!p) return;
    this.ring.position.copy(p);
    this.ring.userData.raio = raio;
  }

  update(dt: number, cameraPos: Vector3): void {
    if (!this.ring.visible) return;
    this.clock += dt;
    this.ring.scale.setScalar((this.ring.userData.raio as number) * (1 + Math.sin(this.clock * 6) * 0.08));
    this.ring.lookAt(cameraPos);
  }
}
