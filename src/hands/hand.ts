import { CapsuleGeometry, CylinderGeometry, Group, Mesh, Object3D, type Quaternion, SphereGeometry, Vector3 } from 'three';
import { DOCTOR, type Side } from '../config';
import { MAT } from '../core/materials';
import type { Tool } from '../tools/tools';
import { solveTwoBone } from './ik';

/**
 * Referencial local da mão (mão direita; a esquerda é espelhada em X):
 *   origem = punho, +Z = direção dos dedos, palma voltada para -Y, polegar em +X.
 * O objeto `root` fica posicionado no ponto de empunhadura (centro do punho fechado). Quem posiciona
 * `root` é o App: preso à câmera em repouso (camada FPS) ou animado no mundo durante uma ação.
 */
const ANCHOR_IN_WRIST = new Vector3(0, -0.033, 0.083);
const UP = new Vector3(0, 1, 0);

interface Finger {
  joints: Group[];
  open: number[];
  closed: number[];
}

function part(geo: ConstructorParameters<typeof Mesh>[0], mat = MAT.luva): Mesh {
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Cadeia de falanges. Retorna os grupos de flexão: girar `rotation.x` de cada um dobra
 * aquela falange e todas as seguintes para o lado da palma.
 */
function buildFinger(base: Vector3, dir: Vector3, lengths: number[], radius: number, parent: Object3D): Group[] {
  const bends: Group[] = [];
  const root = new Group();
  root.position.copy(base);
  root.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize());
  parent.add(root);
  let p: Object3D = root;
  lengths.forEach((len, i) => {
    const bend = new Group();
    if (i > 0) bend.position.set(0, 0, lengths[i - 1]);
    const seg = part(new CapsuleGeometry(radius * (1 - i * 0.08), Math.max(0.001, len - radius), 4, 10));
    seg.rotation.x = Math.PI / 2;
    seg.position.z = len / 2;
    bend.add(seg);
    p.add(bend);
    bends.push(bend);
    p = bend;
  });
  return bends;
}

export class Hand {
  /** Ponto controlado (centro da empunhadura) com a orientação da mão. */
  readonly root = new Group();
  /** Onde as ferramentas são presas (não espelhado). */
  readonly anchor = new Group();
  tool: Tool | null = null;
  /** Força a abertura dos dedos (0 = aberta, 1 = fechada); null = fecha quando há ferramenta. */
  curlOverride: number | null = null;
  /** true quando o braço está totalmente esticado (alvo fora do alcance). */
  outOfReach = false;

  private readonly model = new Group();
  private readonly fingers: Finger[] = [];
  private curl = 0;
  private readonly upper: Group;
  private readonly fore: Group;
  private readonly elbowBall: Mesh;

  constructor(readonly side: Side, parent: Object3D) {
    this.root.name = `mao-${side}`;
    this.root.add(this.model, this.anchor);
    this.model.position.copy(ANCHOR_IN_WRIST).negate();
    if (side === 'left') this.model.scale.x = -1;

    // Palma e dorso.
    const palm = part(new SphereGeometry(1, 24, 16));
    palm.scale.set(0.043, 0.017, 0.05);
    palm.position.set(0, 0, 0.048);
    this.model.add(palm);
    // Punho da luva (fecha a junção com o antebraço).
    const cuff = part(new SphereGeometry(1, 20, 12));
    cuff.scale.set(0.031, 0.024, 0.04);
    cuff.position.set(0, 0, 0.0);
    this.model.add(cuff);

    // Dedos (indicador em +X, ao lado do polegar).
    const specs: [number, number[]][] = [
      [0.03, [0.044, 0.027, 0.021]],
      [0.01, [0.048, 0.03, 0.022]],
      [-0.01, [0.045, 0.028, 0.021]],
      [-0.029, [0.036, 0.022, 0.019]],
    ];
    for (const [x, lens] of specs) {
      const joints = buildFinger(new Vector3(x, 0, 0.094), new Vector3(x * 0.6, -0.05, 1), lens, 0.0088, this.model);
      this.fingers.push({ joints, open: [0.18, 0.15, 0.1], closed: [1.22, 1.05, 0.7] });
    }
    const thumb = buildFinger(new Vector3(0.036, -0.01, 0.03), new Vector3(0.85, -0.45, 0.6), [0.04, 0.032], 0.0105, this.model);
    this.fingers.push({ joints: thumb, open: [0.1, 0.1], closed: [0.55, 0.75] });

    // Braço: manga do pijama + antebraço.
    this.upper = new Group();
    const sleeve = part(new CylinderGeometry(0.052, 0.046, DOCTOR.upperArm * 0.6, 18), MAT.pijama);
    sleeve.position.y = DOCTOR.upperArm * 0.3;
    const upperSkin = part(new CapsuleGeometry(0.038, DOCTOR.upperArm, 4, 14), MAT.pele);
    upperSkin.position.y = DOCTOR.upperArm / 2;
    this.upper.add(sleeve, upperSkin);
    this.fore = new Group();
    // A pele termina dentro do punho da luva para não atravessar a tampa do cilindro.
    const foreSkin = part(new CapsuleGeometry(0.029, DOCTOR.forearm - 0.11, 4, 14), MAT.pele);
    foreSkin.position.y = (DOCTOR.forearm - 0.05) / 2;
    foreSkin.scale.set(1, 1, 0.85);
    const gloveCuff = part(new CylinderGeometry(0.031, 0.0305, 0.1, 18));
    gloveCuff.position.y = DOCTOR.forearm - 0.04;
    this.fore.add(foreSkin, gloveCuff);
    this.elbowBall = part(new SphereGeometry(0.036, 14, 10), MAT.pele);

    parent.add(this.root, this.upper, this.fore, this.elbowBall);
  }

  /** Coloca a mão (ponto de empunhadura) numa pose do mundo. */
  place(pos: Vector3, quat: Quaternion): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
  }

  /** Mostra ou esconde a mão e o braço. O instrumento empunhado continua visível. */
  setVisible(v: boolean): void {
    this.model.visible = v;
    this.upper.visible = v;
    this.fore.visible = v;
    this.elbowBall.visible = v;
  }

  /** Camada de renderização: 1 = camada FPS (por cima da cena), 0 = mundo (com oclusão). Luzes valem nas duas. */
  setLayer(layer: number): void {
    for (const o of [this.root, this.upper, this.fore, this.elbowBall]) {
      o.traverse((c) => {
        if ((c as unknown as { isLight?: boolean }).isLight) c.layers.enableAll();
        else c.layers.set(layer);
      });
    }
  }

  /**
   * Atualiza dedos e braço. `shoulder` e `pole` (direção do cotovelo) em coordenadas do mundo.
   * `origin` = de onde a manga parte (ombro real); se diferente de `shoulder`, o braço é alongado.
   */
  update(dt: number, shoulder: Vector3, pole: Vector3, origin = shoulder): void {
    // Dedos fecham quando há ferramenta.
    const want = this.curlOverride ?? (this.tool ? 1 : 0);
    this.curl += (want - this.curl) * (1 - Math.exp(-10 * dt));
    for (const f of this.fingers) {
      f.joints.forEach((j, i) => {
        j.rotation.x = f.open[i] + (f.closed[i] - f.open[i]) * this.curl;
      });
    }

    // IK do braço até o punho.
    this.root.updateMatrixWorld(true);
    const wrist = this.model.localToWorld(new Vector3(0, 0, -0.045));
    const { elbow, clamped } = solveTwoBone(shoulder, wrist, pole, DOCTOR.upperArm, DOCTOR.forearm);
    this.outOfReach = clamped;
    this.placeSegment(this.upper, origin, elbow);
    this.upper.scale.y = origin.distanceTo(elbow) / DOCTOR.upperArm;
    this.placeSegment(this.fore, elbow, wrist);
    this.elbowBall.position.copy(elbow);
  }

  private placeSegment(seg: Group, from: Vector3, to: Vector3): void {
    seg.position.copy(from);
    const dir = to.clone().sub(from);
    seg.quaternion.setFromUnitVectors(UP, dir.normalize());
  }

  /** Ponta útil: ponta da ferramenta ou, sem ferramenta, a ponta do indicador. */
  tipWorld(out = new Vector3()): Vector3 {
    if (this.tool) return this.tool.tipWorld(out);
    const indexTip = this.fingers[0].joints[2];
    return indexTip.localToWorld(out.set(0, 0, 0.021));
  }
}
