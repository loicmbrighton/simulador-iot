import { Euler, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, PointLight, Quaternion, Vector3 } from 'three';
import type { Side } from '../config';
import {
  buildBagValveMask, buildEndotrachealTube, buildLaryngoscope, buildSyringe, buildYankauer, type ToolModel,
} from './models';

export type ToolId = 'laringoscopio' | 'tubo' | 'seringa' | 'ambu' | 'aspirador';

export interface ToolDef {
  id: ToolId;
  nome: string;
  /** Tecla numérica que equipa a ferramenta. */
  tecla: number;
  build: () => ToolModel;
  /** Orientação "pronta para uso" no mundo, aplicada ao pegar a ferramenta. */
  pronta: Euler;
  /**
   * Onde a ferramenta fica na bandeja: posição e para onde apontam os eixos X e Y locais
   * da ferramenta (o Z é deduzido).
   */
  bandeja: { pos: Vector3; ex: Vector3; ey: Vector3 };
}

const D = Math.PI / 180;

/** Bandeja (carrinho) à direita do médico, ao alcance da mão direita. Topo = 0,936 m. */
export const TRAY_TOP = new Vector3(-0.6, 0.936, -0.5);
export const TRAY_SIZE = { x: 0.44, z: 0.5 };
const UP = new Vector3(0, 1, 0);
const ALONG = new Vector3(0, 0, 1);

export const TOOL_DEFS: ToolDef[] = [
  {
    id: 'laringoscopio', nome: 'Laringoscópio (Macintosh 3)', tecla: 1, build: buildLaryngoscope,
    pronta: new Euler(25 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.64, 0.951, -0.63), ex: UP, ey: ALONG },
  },
  {
    id: 'tubo', nome: 'Tubo orotraqueal 7,5 + fio-guia', tecla: 2, build: buildEndotrachealTube,
    pronta: new Euler(15 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.44, 0.9425, -0.47), ex: UP, ey: ALONG },
  },
  {
    id: 'seringa', nome: 'Seringa 10 mL', tecla: 3, build: buildSyringe,
    pronta: new Euler(0, 0, 0),
    bandeja: { pos: new Vector3(-0.54, 0.9455, -0.35), ex: UP, ey: ALONG },
  },
  {
    id: 'ambu', nome: 'Bolsa-válvula-máscara (AMBU)', tecla: 4, build: buildBagValveMask,
    pronta: new Euler(90 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.765, 0.995, -0.48), ex: new Vector3(0, -1, 0), ey: ALONG },
  },
  {
    id: 'aspirador', nome: 'Aspirador rígido (Yankauer)', tecla: 5, build: buildYankauer,
    pronta: new Euler(10 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.64, 0.9455, -0.38), ex: UP, ey: ALONG },
  },
];

/**
 * Rotação ferramenta→mão: o eixo +Y da ferramenta (cabo) fica atravessado na palma,
 * apontando para o lado do polegar. Na mão esquerda (espelhada) o polegar fica em -X.
 */
export function gripQuat(side: Side): Quaternion {
  return new Quaternion().setFromEuler(new Euler(0, 0, side === 'right' ? -Math.PI / 2 : Math.PI / 2));
}

/** Orientação da mão que deixa a ferramenta na pose "pronta". */
export function readyHandQuat(def: ToolDef, side: Side): Quaternion {
  return new Quaternion().setFromEuler(def.pronta).multiply(gripQuat(side).invert());
}

export class Tool {
  readonly object: Group;
  readonly tipLocal: Vector3;
  readonly light?: PointLight;
  private readonly lamp?: Mesh;
  holder: Side | null = null;

  constructor(readonly def: ToolDef) {
    const model = def.build();
    this.object = model.object;
    this.tipLocal = model.tip;
    this.light = model.light;
    this.lamp = model.lamp;
  }

  /** Coloca a ferramenta de volta na bandeja (no espaço do mundo). */
  placeOnTray(parent: Object3D): void {
    this.holder = null;
    parent.add(this.object);
    const { pos, ex, ey } = this.def.bandeja;
    this.object.position.copy(pos);
    this.object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(ex, ey, ex.clone().cross(ey)));
    this.setLight(false);
  }

  attachTo(anchor: Object3D, side: Side): void {
    this.holder = side;
    anchor.add(this.object);
    this.object.position.set(0, 0, 0);
    this.object.quaternion.copy(gripQuat(side));
    this.setLight(this.def.id === 'laringoscopio');
  }

  setLight(on: boolean): void {
    if (!this.light) return;
    this.light.intensity = on ? 0.35 : 0;
    if (this.lamp) (this.lamp.material as MeshStandardMaterial).emissiveIntensity = on ? 2.5 : 0;
  }

  tipWorld(out = new Vector3()): Vector3 {
    return this.object.localToWorld(out.copy(this.tipLocal));
  }

  /** Ponto de empunhadura no mundo (para pegar da bandeja). */
  gripWorld(out = new Vector3()): Vector3 {
    return this.object.getWorldPosition(out);
  }
}
