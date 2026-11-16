import {
  Bone, BufferAttribute, DoubleSide, Float32BufferAttribute, Group, Matrix3, Mesh, MeshStandardMaterial, PlaneGeometry,
  Quaternion, SkinnedMesh, Vector3, BoxGeometry, type Material,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MAT } from './materials';
import { COXIM } from '../tools/models';

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
  labioSuperior: new Vector3(0, 1.574, 0.157),
  labioInferior: new Vector3(0, 1.554, 0.156),
};
export type LandmarkName = keyof typeof MODEL_LANDMARKS;

/** Pontos da via aérea no espaço do modelo (ver marcos em tools/anatomia/gerar_via_aerea.py). */
const AIR_LANDMARKS = {
  valecula: new Vector3(0, 1.501, 0.078),
  comissuraAnterior: new Vector3(0, 1.4765, 0.0715),
  glotePosterior: new Vector3(0, 1.4765, 0.0505),
  traqueiaAnterior: new Vector3(0, 1.446, 0.072),
  /** Parede posterior da hipofaringe, atrás das aritenoides (entrada do esôfago). */
  hipofaringePosterior: new Vector3(0, 1.485, 0.041),
};
export type AirLandmarkName = keyof typeof AIR_LANDMARKS;

/** Posição olfativa: flexão do pescoço sobre o coxim e extensão da cabeça (graus, por osso). */
// Com estes ângulos o plano da face fica ~13° estendido em relação à horizontal (medido no modelo).
const SNIFF = { head: -28, neck03: -7, neck02: 4.4, neck01: 9.1 };
const NECK_BONES = ['head', 'neck03', 'neck02', 'neck01'] as const;

export interface PatientPose {
  /** Abertura da mandíbula (graus). */
  jaw: number;
  /** Flexão do pescoço: 0 = cabeça no colchão (neutra), 1 = sobre o coxim. Pode passar de 1 (cabeça erguida). */
  flex: number;
  /** Extensão da cabeça: 0 = neutra, 1 = posição olfativa; acima de 1 = extensão extra (laringoscopia). */
  ext: number;
  /** Língua comprimida pela lâmina e epiglote levantada (0–1; forma definida por `deformTissue`). */
  tongue: number;
}

export class Patient {
  readonly root = new Group();
  readonly model: Group;
  readonly bones: Record<string, Bone> = {};
  readonly body: SkinnedMesh;
  readonly meshes: Record<string, Mesh> = {};
  readonly towel: Mesh;
  /** Posição final da toalha sob o occipício (a animação desliza a toalha até aqui). */
  readonly towelRest = new Vector3();
  sheet: Mesh | null = null;
  readonly pose: PatientPose = { jaw: 0, flex: 0, ext: 0, tongue: 0 };
  private readonly air: SkinnedMesh | null;
  private readonly rest: Record<string, Quaternion> = {};
  private readonly landmarkVertex = new Map<LandmarkName, number>();
  private readonly airVertex = new Map<AirLandmarkName, number>();
  /** Ângulos (graus) dos ossos do pescoço na posição neutra, com a cabeça apoiada no colchão. */
  private neutral: Record<(typeof NECK_BONES)[number], number> = { head: 0, neck03: 0, neck02: 0, neck01: 0 };
  private headVerts: number[] = [];
  private readonly headShapes = { neutral: { c: new Vector3(), r: new Vector3() }, sniff: { c: new Vector3(), r: new Vector3() } };
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
    this.air = (this.meshes['via_aerea'] as SkinnedMesh | undefined) ?? null;
    this.findLandmarkVertices();
    this.anchorTrachea();
    this.buildTongueMorph();

    // Coxim: toalha dobrada sob o occipício (altura ajustada em layout()); só aparece quando é colocada.
    this.towel = new Mesh(new BoxGeometry(COXIM.comprimento, 1, COXIM.largura), MAT.toalha);
    this.towel.castShadow = true;
    this.towel.receiveShadow = true;
    this.root.add(this.towel);

    for (const side of ['L', 'R'] as const) this.adductArm(side, 1);
    // Mede tudo na posição olfativa (altura da toalha, lençol) e depois acha a posição neutra.
    this.applyPose({ jaw: 0, flex: 1, ext: 1, tongue: 0 });
    this.layout();
    this.findNeutral();
    this.reset();
  }

  /** Volta ao início do cenário: cabeça neutra no colchão, boca fechada, sem coxim. */
  reset(): void {
    this.applyPose({ jaw: 0, flex: 0, ext: 0, tongue: 0 });
    this.towel.visible = false;
    this.towel.position.copy(this.towelRest);
  }

  /** Aplica a pose (só ossos e morph: barato, pode ser chamado a cada quadro). */
  applyPose(p: Partial<PatientPose>): void {
    Object.assign(this.pose, p);
    const { jaw, flex, ext, tongue } = this.pose;
    this.rot('jaw', jaw);
    for (const b of NECK_BONES) {
      const k = b === 'head' || b === 'neck03' ? ext : flex;
      this.rot(b, this.neutral[b] + (SNIFF[b] - this.neutral[b]) * k);
    }
    if (this.air) {
      if (this.air.morphTargetInfluences) this.air.morphTargetInfluences[0] = tongue;
      // A via aérea só é vista pela boca, com a cabeça já posicionada. Fora disso fica oculta: nas poses
      // extremas do pescoço ela não acompanha a pele e apareceria por fora.
      this.air.visible = ext > 0.95 && Math.abs(flex - 1) < 0.05;
    }
    // Elipsoide da cabeça (para o cursor): interpola entre as duas posições medidas.
    const k = Math.min(1, Math.max(0, (flex + ext) / 2));
    this.headCenter.lerpVectors(this.headShapes.neutral.c, this.headShapes.sniff.c, k);
    this.headRadii.lerpVectors(this.headShapes.neutral.r, this.headShapes.sniff.r, k);
    this.root.updateMatrixWorld(true);
  }

  private rot(name: string, deg: number): void {
    const b = this.bones[name];
    if (!b) return;
    b.quaternion.copy(this.rest[name]).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (deg * Math.PI) / 180));
  }

  /** Ponto mais baixo da cabeça (occipício) na pose atual, no mundo. */
  occiput(out = new Vector3()): Vector3 {
    const v = new Vector3();
    out.set(0, Infinity, 0);
    this.root.updateMatrixWorld(true);
    this.body.skeleton.update();
    for (const i of this.headVerts) {
      this.body.getVertexPosition(i, v).applyMatrix4(this.body.matrixWorld);
      if (v.y < out.y) out.copy(v);
    }
    return out;
  }

  /**
   * Posição neutra: sem coxim a cabeça repousa no colchão. Procura (bisseção) a extensão do pescoço que
   * encosta o occipício no colchão, com a cabeça compensando para a face continuar voltada para cima.
   */
  private findNeutral(): void {
    const set = (d: number) => {
      this.neutral = { head: 0.35 * d, neck03: 0, neck02: -0.4 * d, neck01: -0.6 * d };
      this.applyPose({ flex: 0, ext: 0 });
      return this.occiput().y - (this.place.mattressTop + 0.004);
    };
    let lo = 0, hi = 45;
    if (set(lo) > 0) {
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (set(mid) > 0) lo = mid; else hi = mid;
      }
      set((lo + hi) / 2);
    }
    this.measureHead(this.headShapes.neutral);
  }

  private measureHead(out: { c: Vector3; r: Vector3 }): void {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const v = new Vector3();
    this.root.updateMatrixWorld(true);
    this.body.skeleton.update();
    for (const i of this.headVerts) {
      this.body.getVertexPosition(i, v).applyMatrix4(this.body.matrixWorld);
      min.min(v);
      max.max(v);
    }
    out.c.copy(min).add(max).multiplyScalar(0.5);
    out.r.copy(max).sub(min).multiplyScalar(0.47);
  }

  /**
   * A traqueia intratorácica não acompanha o pescoço: abaixo da cricoide os pesos passam, aos poucos,
   * para o osso pai do pescoço. Sem isso, ao estender o pescoço a traqueia sairia pela frente do tórax.
   */
  private anchorTrachea(): void {
    const air = this.air;
    const parent = this.bones['neck01']?.parent as Bone | undefined;
    if (!air || !parent) return;
    const bone = air.skeleton.bones.indexOf(parent);
    if (bone < 0) return;
    const pos = air.geometry.getAttribute('position') as BufferAttribute;
    const idx = air.geometry.getAttribute('skinIndex') as BufferAttribute;
    const wgt = air.geometry.getAttribute('skinWeight') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (1.45 - pos.getY(i)) / 0.045)); // 0 na cricoide, 1 a 4,5 cm abaixo
      if (t <= 0) continue;
      const k = t * t * (3 - 2 * t);
      // Reduz os pesos atuais e põe o restante no osso do tórax, no lugar da menor influência.
      let min = 0;
      for (let c = 0; c < 4; c++) {
        wgt.setComponent(i, c, wgt.getComponent(i, c) * (1 - k));
        if (wgt.getComponent(i, c) < wgt.getComponent(i, min)) min = c;
      }
      idx.setComponent(i, min, bone);
      wgt.setComponent(i, min, k);
      let sum = 0;
      for (let c = 0; c < 4; c++) sum += wgt.getComponent(i, c);
      for (let c = 0; c < 4; c++) wgt.setComponent(i, c, wgt.getComponent(i, c) / sum);
    }
    idx.needsUpdate = true;
    wgt.needsUpdate = true;
  }

  /** Prepara o morph da laringoscopia: um único alvo, vazio no início, preenchido por `deformTissue`. */
  private buildTongueMorph(): void {
    const air = this.air;
    if (!air) return;
    const count = air.geometry.getAttribute('position').count;
    air.geometry.morphAttributes.position = [new Float32BufferAttribute(new Float32Array(count * 3), 3)];
    air.geometry.morphTargetsRelative = true;
    air.updateMorphTargets();
    (air.material as MeshStandardMaterial).needsUpdate = true;
  }

  /**
   * Deforma a mucosa da via aérea (morph). `fn` recebe a posição atual de cada vértice no mundo e devolve o
   * deslocamento desejado (mundo), ou null para não mexer. Deve ser um campo contínuo no espaço (vértices
   * vizinhos com deslocamentos parecidos), senão a malha estica em "cortinas". O deslocamento é convertido
   * para a pose de repouso (inversa da parte linear do skinning) e ligado/desligado por `pose.tongue`.
   */
  deformTissue(fn: (P: Vector3) => Vector3 | null): void {
    const air = this.air;
    const morph = air?.geometry.morphAttributes.position?.[0] as BufferAttribute | undefined;
    if (!air || !morph) return;
    const pos = air.geometry.getAttribute('position') as BufferAttribute;
    this.root.updateMatrixWorld(true);
    air.skeleton.update();
    const world = air.matrixWorld;
    const skin = (i: number, v: Vector3) => air.applyBoneTransform(i, v).applyMatrix4(world);
    const p = new Vector3(), P = new Vector3(), q = new Vector3();
    const L = new Matrix3(), col = [new Vector3(), new Vector3(), new Vector3()];
    const eps = 0.001;
    const out = morph.array as Float32Array;
    out.fill(0);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      skin(i, P.copy(p));
      const d = fn(P);
      if (!d) continue;
      for (let k = 0; k < 3; k++) {
        q.copy(p).setComponent(k, p.getComponent(k) + eps);
        col[k].copy(skin(i, q)).sub(P).divideScalar(eps);
      }
      L.set(col[0].x, col[1].x, col[2].x, col[0].y, col[1].y, col[2].y, col[0].z, col[1].z, col[2].z).invert();
      d.applyMatrix3(L);
      out[i * 3] = d.x;
      out[i * 3 + 1] = d.y;
      out[i * 3 + 2] = d.z;
    }
    // A textura de morph é criada uma vez por geometria: descartar os buffers força a recriação com os dados novos.
    air.geometry.dispose();
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

  /** Posiciona o corpo na maca e mede a toalha sob o occipício e o lençol (pose atual = olfativa). */
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
    this.towelRest.set(0, this.place.mattressTop + h / 2, occZ + 0.01);
    this.towel.position.copy(this.towelRest);

    // Vértices da cabeça (acima do pescoço, no modelo) e elipsoide na posição olfativa.
    this.headVerts = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 1.53) this.headVerts.push(i);
    this.measureHead(this.headShapes.sniff);
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
    if (!this.air) return;
    const apos = this.air.geometry.getAttribute('position') as BufferAttribute;
    for (const [name, p] of Object.entries(AIR_LANDMARKS) as [AirLandmarkName, Vector3][]) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < apos.count; i++) {
        const d = v.fromBufferAttribute(apos, i).distanceToSquared(p);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.airVertex.set(name, best);
    }
  }

  private incisors: { upper: number; lower: number } | null = null;

  /** Borda do incisivo central (superior ou inferior) na pose atual, no mundo. */
  incisor(which: 'upper' | 'lower', out = new Vector3()): Vector3 {
    const teeth = this.meshes['dentes'] as SkinnedMesh | undefined;
    if (!teeth?.isSkinnedMesh) return out.copy(this.landmark(which === 'upper' ? 'labioSuperior' : 'labioInferior'));
    if (!this.incisors) {
      // Dentes da frente perto da linha média: os de baixo seguem o osso `jaw`; a borda é o extremo vertical.
      const pos = teeth.geometry.getAttribute('position') as BufferAttribute;
      const idx = teeth.geometry.getAttribute('skinIndex') as BufferAttribute;
      const wgt = teeth.geometry.getAttribute('skinWeight') as BufferAttribute;
      const jaw = teeth.skeleton.bones.findIndex((b) => b.name === 'jaw');
      let upper = 0, lower = 0, upY = Infinity, loY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getX(i)) > 0.005 || pos.getZ(i) < 0.135) continue;
        let wj = 0;
        for (let c = 0; c < 4; c++) if (idx.getComponent(i, c) === jaw) wj += wgt.getComponent(i, c);
        const y = pos.getY(i);
        if (wj > 0.5) {
          if (y > loY) [loY, lower] = [y, i];
        } else if (y < upY) [upY, upper] = [y, i];
      }
      this.incisors = { upper, lower };
    }
    this.root.updateMatrixWorld(true);
    teeth.skeleton.update();
    teeth.getVertexPosition(this.incisors[which], out);
    return out.applyMatrix4(teeth.matrixWorld);
  }

  /** Posição atual (mundo) de um ponto da via aérea. */
  airLandmark(name: AirLandmarkName, out = new Vector3()): Vector3 {
    const air = this.air;
    const i = this.airVertex.get(name);
    if (!air || i === undefined) return out.copy(this.landmark('boca'));
    air.getVertexPosition(i, out);
    return out.applyMatrix4(air.matrixWorld);
  }

  /** Referencial da glote no mundo: centro entre as pregas vocais, direção cranial (eixo da laringe) e anterior. */
  glottisFrame(): { centro: Vector3; cranial: Vector3; anterior: Vector3 } {
    const ant = this.airLandmark('comissuraAnterior');
    const post = this.airLandmark('glotePosterior');
    const traq = this.airLandmark('traqueiaAnterior');
    const anterior = ant.clone().sub(post).normalize();
    const cranial = ant.clone().sub(traq);
    cranial.addScaledVector(anterior, -cranial.dot(anterior)).normalize();
    return { centro: ant.add(post).multiplyScalar(0.5), cranial, anterior };
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

function sheetMaterial(): Material {
  const m = MAT.avental.clone();
  m.side = DoubleSide;
  return m;
}
