import {
  Bone, BufferAttribute, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion,
  SkinnedMesh, Vector3, BoxGeometry, type Material,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MAT } from './materials';

/**
 * Paciente real (MakeHuman + via aérea), carregado de `paciente.json` (glTF com buffer embutido).
 *
 * Espaço do modelo (glTF): Y para cima (paciente em pé), face voltada para +Z, pés em y = 0.
 * No mundo do simulador o paciente fica em decúbito dorsal: cabeça para -Z (médico), face para +Y.
 */

/**
 * Baixa e monta o glTF. A página publicada bloqueia fetch de URLs data:/blob:, então o buffer
 * base64 é decodificado aqui e o modelo é entregue ao GLTFLoader como um .glb em memória.
 */
export async function downloadPatient(url: string, onProgress: (frac: number) => void): Promise<GLTF> {
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`o servidor respondeu ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || 13.9e6;
  const reader = resp.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / total));
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  const json = JSON.parse(new TextDecoder().decode(bytes));
  const uri: string = json.buffers[0].uri;
  const raw = atob(uri.slice(uri.indexOf(',') + 1));
  const bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  delete json.buffers[0].uri;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(jsonBytes.length / 4) * 4;
  const bl = Math.ceil(bin.length / 4) * 4;
  const glb = new ArrayBuffer(28 + jl + bl);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, glb.byteLength, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  u8.fill(0x20, 20 + jsonBytes.length, 20 + jl);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  u8.set(bin, 28 + jl);
  // Texturas via <img> (TextureLoader): createImageBitmap faria fetch de blob:, também bloqueado.
  const w = window as unknown as { createImageBitmap?: unknown };
  const cib = w.createImageBitmap;
  w.createImageBitmap = undefined;
  try {
    return await new GLTFLoader().parseAsync(glb, '');
  } finally {
    w.createImageBitmap = cib;
  }
}

export interface PatientPlacement {
  /** Altura do colchão (topo). */
  mattressTop: number;
  /** Posição Z do topo da cabeça no mundo (deitado). */
  headTopZ: number;
}

/** Pontos anatômicos no espaço do modelo (glTF, paciente em pé). */
const MODEL_LANDMARKS = {
  boca: new Vector3(0, 1.567, 0.162),
  comissuraDireita: new Vector3(-0.024, 1.565, 0.149),
  comissuraEsquerda: new Vector3(0.024, 1.565, 0.149),
  mento: new Vector3(0, 1.512, 0.142),
  fronte: new Vector3(0, 1.69, 0.125),
  cricoide: new Vector3(0, 1.455, 0.083),
  nariz: new Vector3(0, 1.605, 0.18),
};
export type LandmarkName = keyof typeof MODEL_LANDMARKS;

export class Patient {
  readonly root = new Group();
  readonly model: Group;
  readonly bones: Record<string, Bone> = {};
  readonly body: SkinnedMesh;
  readonly meshes: Record<string, Mesh> = {};
  readonly towel: Mesh;
  sheet: Mesh | null = null;
  private readonly rest: Record<string, Quaternion> = {};
  private readonly landmarkVertex = new Map<LandmarkName, number>();
  /** Elipsoide da cabeça (pose atual), para as colisões das mãos. */
  readonly headCenter = new Vector3();
  readonly headRadii = new Vector3();
  private heightMap: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array } | null = null;

  constructor(gltf: GLTF, private readonly place: PatientPlacement) {
    this.model = gltf.scene;
    this.root.name = 'paciente-real';
    this.root.add(this.model);
    this.model.rotation.x = -Math.PI / 2; // em pé → decúbito dorsal, cabeça para -Z, face para +Y
    let body: SkinnedMesh | null = null;
    this.model.traverse((o) => {
      if ((o as Bone).isBone) {
        // O GLTFLoader remove '.', ':', '/' e colchetes dos nomes ("upperarm01.L" → "upperarm01L").
        this.bones[o.name] = o as Bone;
        this.rest[o.name] = o.quaternion.clone();
      }
      const m = o as Mesh;
      if (m.isMesh) {
        this.meshes[m.name] = m;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as MeshStandardMaterial;
        if (m.name === 'via_aerea') {
          mat.vertexColors = true;
          mat.roughness = 0.32;
          mat.metalness = 0;
          mat.side = DoubleSide;
          m.castShadow = false;
        }
        if (['cabelo', 'cilios', 'sobrancelhas'].includes(m.name)) {
          mat.transparent = true;
          mat.alphaTest = 0.3;
          m.castShadow = false;
        }
        if (m.name === 'paciente') body = m as SkinnedMesh;
      }
    });
    if (!body) throw new Error('malha do corpo não encontrada');
    this.body = body;
    this.findLandmarkVertices();

    // Coxim: toalha dobrada sob o occipício (altura ajustada em layout()).
    this.towel = new Mesh(new BoxGeometry(0.3, 1, 0.2), towelMaterial());
    this.towel.castShadow = true;
    this.towel.receiveShadow = true;
    this.root.add(this.towel);

    this.setPose({ jaw: 0, ext: 26, arms: 1 });
  }

  /** Pose: abertura da mandíbula (graus), extensão da cabeça / posição olfativa (graus), braços aduzidos (0–1). */
  setPose(p: { jaw: number; ext: number; arms: number }): void {
    this.rot('jaw', p.jaw);
    this.rot('head', -p.ext * 0.8);
    this.rot('neck03', -p.ext * 0.2);
    this.rot('neck02', p.ext * 0.17);
    this.rot('neck01', p.ext * 0.35);
    // Braços: da pose em "A" do MakeHuman para junto do corpo, mão ao lado da coxa.
    for (const side of ['L', 'R'] as const) this.adductArm(side, p.arms);
    this.layout();
  }

  private rot(name: string, deg: number): void {
    const b = this.bones[name];
    if (!b) return;
    b.quaternion.copy(this.rest[name]).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (deg * Math.PI) / 180));
  }

  private armSolution: Record<string, Quaternion> = {};

  /**
   * Gira `upperarm01` para levar o punho até um alvo ao lado da coxa. A rotação é encontrada por busca
   * (eixos locais X/Y/Z, ±90°), o que evita depender das convenções de eixo de cada osso.
   */
  private adductArm(side: 'L' | 'R', amount: number): void {
    const upper = this.bones[`upperarm01${side}`];
    const wrist = this.bones[`wrist${side}`] ?? this.bones[`lowerarm02${side}`];
    if (!upper || !wrist) return;
    upper.quaternion.copy(this.rest[upper.name]);
    if (amount <= 0) return;
    if (!this.armSolution[side]) {
      this.model.updateMatrixWorld(true);
      const shoulder = upper.getWorldPosition(new Vector3());
      const lateral = side === 'L' ? 1 : -1; // .L fica em +X (esquerda do paciente)
      // Alvo no espaço do modelo (em pé): 0,55 m abaixo do ombro, junto à coxa, levemente atrás (apoiado).
      const target = this.model.localToWorld(this.model.worldToLocal(shoulder.clone()).add(new Vector3(lateral * 0.06, -0.55, -0.03)));
      // Rotação mínima que leva a direção ombro→punho até ombro→alvo (2 iterações).
      for (let it = 0; it < 2; it++) {
        upper.updateMatrixWorld(true);
        const cur = wrist.getWorldPosition(new Vector3()).sub(shoulder).normalize();
        const want = target.clone().sub(shoulder).normalize();
        const qd = new Quaternion().setFromUnitVectors(cur, want);
        const parentQ = upper.parent!.getWorldQuaternion(new Quaternion());
        upper.quaternion.premultiply(parentQ.clone().invert().multiply(qd).multiply(parentQ));
      }
      this.armSolution[side] = this.rest[upper.name].clone().invert().multiply(upper.quaternion);
    }
    upper.quaternion.copy(this.rest[upper.name]).slerp(this.rest[upper.name].clone().multiply(this.armSolution[side]), amount);
  }

  /** Posiciona o corpo na maca, a toalha sob o occipício e recalcula colisões/lençol. */
  private layout(): void {
    // Altura: costas no colchão. Usa a pose atual (vértices deformados).
    this.root.position.set(0, 0, 0);
    this.model.position.set(0, 0, this.place.headTopZ + 1.745);
    this.root.updateMatrixWorld(true);
    const pts = this.posedBody();
    let minY = Infinity;
    for (let i = 1; i < pts.length; i += 3) {
      const z = pts[i + 1];
      if (z > 0.25 && pts[i] < minY) minY = pts[i]; // tronco e membros (não a cabeça)
    }
    // Só o modelo sobe; a raiz fica na origem para que toalha e lençol usem coordenadas do mundo.
    const lift = this.place.mattressTop + 0.004 - minY;
    this.model.position.y = lift;
    this.root.updateMatrixWorld(true);
    for (let i = 1; i < pts.length; i += 3) pts[i] += lift;

    // Toalha: do colchão até o ponto mais baixo da cabeça (occipício), centrada sob ele.
    const pos = this.body.geometry.getAttribute('position') as BufferAttribute;
    let occY = Infinity;
    let occZ = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 1.6) continue; // só a cabeça (espaço do modelo, em pé)
      if (pts[i * 3 + 1] < occY) {
        occY = pts[i * 3 + 1];
        occZ = pts[i * 3 + 2];
      }
    }
    const h = Math.max(0.01, occY - 0.002 - this.place.mattressTop);
    this.towel.scale.set(1, h, 1);
    this.towel.position.set(0, this.place.mattressTop + h / 2, occZ + 0.01);

    // Elipsoide da cabeça: vértices acima do pescoço (no modelo).
    const head = this.verticesAbove(pts, 1.53);
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const v of head) {
      min.min(v);
      max.max(v);
    }
    this.headCenter.copy(min).add(max).multiplyScalar(0.5);
    this.headRadii.copy(max).sub(min).multiplyScalar(0.47);
    this.buildSheet(pts);
  }

  /** Posições deformadas (mundo) de todos os vértices do corpo, como [x, y, z, ...]. */
  private posedBody(): Float32Array {
    const pos = this.body.geometry.getAttribute('position') as BufferAttribute;
    const out = new Float32Array(pos.count * 3);
    const v = new Vector3();
    this.body.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      this.body.getVertexPosition(i, v);
      v.applyMatrix4(this.body.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    return out;
  }

  private verticesAbove(pts: Float32Array, modelY: number): Vector3[] {
    const pos = this.body.geometry.getAttribute('position') as BufferAttribute;
    const res: Vector3[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > modelY) res.push(new Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]));
    return res;
  }

  private findLandmarkVertices(): void {
    const pos = this.body.geometry.getAttribute('position') as BufferAttribute;
    const v = new Vector3();
    for (const [name, p] of Object.entries(MODEL_LANDMARKS) as [LandmarkName, Vector3][]) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const d = v.fromBufferAttribute(pos, i).distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.landmarkVertex.set(name, best);
    }
  }

  /** Posição atual (mundo) de um ponto anatômico. */
  landmark(name: LandmarkName, out = new Vector3()): Vector3 {
    const i = this.landmarkVertex.get(name)!;
    this.body.getVertexPosition(i, out);
    return out.applyMatrix4(this.body.matrixWorld);
  }

  /** Lençol moldado sobre o corpo (mapa de alturas do corpo deformado), do tórax aos pés. */
  private buildSheet(pts: Float32Array): void {
    const step = 0.02;
    const x0 = -0.5, x1 = 0.5;
    const z0 = this.landmark('cricoide').z + 0.13;
    const z1 = 1.8;
    const nx = Math.round((x1 - x0) / step) + 1;
    const nz = Math.round((z1 - z0) / step) + 1;
    const base = this.place.mattressTop + 0.008;
    let h = new Float32Array(nx * nz).fill(base);
    for (let i = 0; i < pts.length; i += 3) {
      const ix = Math.round((pts[i] - x0) / step);
      const iz = Math.round((pts[i + 2] - z0) / step);
      if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
      const k = iz * nx + ix;
      h[k] = Math.max(h[k], pts[i + 1] + (pts[i + 2] > 1.45 ? 0.03 : 0.014));
    }
    // Dilata e suaviza (o pano não acompanha cada reentrância).
    for (let pass = 0; pass < 3; pass++) {
      const n = new Float32Array(h);
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          let m = 0;
          let s = 0;
          let c = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const jx = ix + dx, jz = iz + dz;
              if (jx < 0 || jx >= nx || jz < 0 || jz >= nz) continue;
              const val = h[jz * nx + jx];
              m = Math.max(m, val);
              s += val;
              c++;
            }
          }
          n[iz * nx + ix] = pass === 0 ? m : s / c;
        }
      }
      h = n;
    }
    this.heightMap = { x0, z0, step, nx, nz, h };
    const geo = new PlaneGeometry(x1 - x0, z1 - z0, nx - 1, nz - 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i) + (z0 + z1) / 2;
      const ix = Math.round((x - x0) / step);
      const iz = Math.round((z - z0) / step);
      let y = h[Math.min(nz - 1, Math.max(0, iz)) * nx + Math.min(nx - 1, Math.max(0, ix))];
      const over = Math.abs(x) - 0.43; // pende para fora do colchão
      if (over > 0) y = Math.min(y, this.place.mattressTop + 0.01) - over * 1.6;
      p.setXYZ(i, x, y, z); // z já em coordenadas do mundo
    }
    geo.computeVertexNormals();
    if (this.sheet) {
      this.sheet.geometry.dispose();
      this.sheet.geometry = geo;
    } else {
      this.sheet = new Mesh(geo, sheetMaterial());
      this.sheet.castShadow = true;
      this.sheet.receiveShadow = true;
      this.root.add(this.sheet);
    }
  }

  /** Altura do lençol/corpo em (x, z) no mundo; -Infinity fora da área coberta. */
  coverHeight(x: number, z: number): number {
    const m = this.heightMap;
    if (!m) return -Infinity;
    const ix = Math.round((x - m.x0) / m.step);
    const iz = Math.round((z - m.z0) / m.step);
    if (ix < 0 || ix >= m.nx || iz < 0 || iz >= m.nz) return -Infinity;
    return m.h[iz * m.nx + ix];
  }
}

function towelMaterial(): Material {
  return new MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.95 });
}

function sheetMaterial(): Material {
  const m = MAT.avental.clone();
  m.side = DoubleSide;
  return m;
}
