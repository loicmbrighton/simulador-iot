import { Euler, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, PointLight, Quaternion, Vector3 } from 'three';
import type { Side } from '../config';
import {
  buildBagValveMask, buildCoxim, buildEndotrachealTube, buildLaryngoscope, buildSyringe, buildYankauer, type ToolModel,
} from './models';

export type ToolId = 'coxim' | 'laringoscopio' | 'tubo' | 'seringa' | 'ambu' | 'aspirador';

export interface ToolDef {
  id: ToolId;
  nome: string;
  /** Nome curto (roda de seleção, dicas). */
  curto: string;
  build: () => ToolModel;
  /** Orientação "pronta para uso" no mundo, aplicada ao pegar a ferramenta. */
  pronta: Euler;
  /**
   * Onde a ferramenta fica na bandeja: posição e para onde apontam os eixos X e Y locais
   * da ferramenta (o Z é deduzido).
   */
  bandeja: { pos: Vector3; ex: Vector3; ey: Vector3 };
  /**
   * Empunhadura: rotação (graus, em torno do eixo dos dedos) do instrumento em relação à mão.
   * Padrão: o eixo +Y do instrumento aponta para o lado do polegar (-90 na direita, +90 na esquerda).
   */
  empunhadura?: Record<Side, number>;
  /** Deslocamento da mão em repouso na camada FPS (peças grandes ficam mais baixas, para não tapar a cena). */
  repouso?: Vector3;
}

const D = Math.PI / 180;

/**
 * Bandeja (carrinho) encostada na maca, à direita do paciente, na altura do ombro: fica dentro da visão
 * padrão do médico, para que tudo seja alcançável só com o cursor. Topo = 0,936 m.
 */
export const TRAY_TOP = new Vector3(-0.68, 0.936, 0.46);
/** A bandeja se estende para o lado dos pés para caber o coxim. */
export const TRAY_SIZE = { x: 0.44, z: 0.76 };
const UP = new Vector3(0, 1, 0);
const ALONG = new Vector3(0, 0, 1);

export const TOOL_DEFS: ToolDef[] = [
  {
    // Toalha dobrada: carregada sobre a palma (mão com a palma para cima), nas duas mãos.
    id: 'coxim', nome: 'Coxim (toalha dobrada)', curto: 'Coxim', build: buildCoxim,
    pronta: new Euler(24 * D, 0, 90 * D),
    repouso: new Vector3(-0.03, -0.085, 0.05),
    bandeja: { pos: new Vector3(-0.68, 0.902, 0.71), ex: UP, ey: new Vector3(1, 0, 0) },
    empunhadura: { left: -90, right: -90 },
  },
  {
    // Empunhado como no uso real: cabo para cima, lâmina embaixo apontando para longe do médico.
    id: 'laringoscopio', nome: 'Laringoscópio (Macintosh 3)', curto: 'Laringoscópio', build: buildLaryngoscope,
    pronta: new Euler(38 * D, 0, 180 * D),
    empunhadura: { left: -90, right: 90 },
    bandeja: { pos: new Vector3(-0.720, 0.951, 0.200), ex: UP, ey: ALONG },
  },
  {
    id: 'tubo', nome: 'Tubo orotraqueal 7,5 + fio-guia', curto: 'Tubo', build: buildEndotrachealTube,
    pronta: new Euler(15 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.520, 0.9425, 0.360), ex: UP, ey: ALONG },
  },
  {
    id: 'seringa', nome: 'Seringa 10 mL', curto: 'Seringa', build: buildSyringe,
    pronta: new Euler(0, 0, 0),
    bandeja: { pos: new Vector3(-0.620, 0.9455, 0.480), ex: UP, ey: ALONG },
  },
  {
    id: 'ambu', nome: 'Bolsa-válvula-máscara (AMBU)', curto: 'AMBU', build: buildBagValveMask,
    pronta: new Euler(90 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.845, 0.995, 0.350), ex: new Vector3(0, -1, 0), ey: ALONG },
  },
  {
    id: 'aspirador', nome: 'Aspirador rígido (Yankauer)', curto: 'Aspirador', build: buildYankauer,
    pronta: new Euler(10 * D, 0, 0),
    bandeja: { pos: new Vector3(-0.720, 0.9455, 0.450), ex: UP, ey: ALONG },
  },
];

/**
 * Rotação ferramenta→mão: por padrão o eixo +Y da ferramenta (cabo) fica atravessado na palma,
 * apontando para o lado do polegar (na mão esquerda, espelhada, o polegar fica em -X).
 * Instrumentos assimétricos definem a própria empunhadura.
 */
export function gripQuat(side: Side, def?: ToolDef): Quaternion {
  const deg = def?.empunhadura?.[side] ?? (side === 'right' ? -90 : 90);
  return new Quaternion().setFromEuler(new Euler(0, 0, deg * D));
}

/** Orientação da mão que deixa a ferramenta na pose "pronta". */
export function readyHandQuat(def: ToolDef, side: Side): Quaternion {
  return new Quaternion().setFromEuler(def.pronta).multiply(gripQuat(side, def).invert());
}

export class Tool {
  readonly object: Group;
  readonly tipLocal: Vector3;
  readonly light?: PointLight;
  /** Linha central da lâmina (só o laringoscópio), no espaço local. */
  readonly spine?: Vector3[];
  private readonly lamp?: Mesh;
  /** Mão que segura (ou reservou) a ferramenta; 'usado' = já aplicada no paciente (coxim sob a cabeça). */
  holder: Side | 'usado' | null = null;

  constructor(readonly def: ToolDef) {
    const model = def.build();
    this.object = model.object;
    this.tipLocal = model.tip;
    this.light = model.light;
    this.spine = model.spine;
    this.lamp = model.lamp;
  }

  /** Coloca a ferramenta de volta na bandeja (no espaço do mundo). */
  placeOnTray(parent: Object3D): void {
    this.holder = null;
    parent.add(this.object);
    const { pos, quat } = this.trayPose();
    this.object.position.copy(pos);
    this.object.quaternion.copy(quat);
    this.object.traverse((o) => {
      if (!(o as unknown as { isLight?: boolean }).isLight) o.layers.set(0);
    });
    this.setLight(false);
  }

  /** Pose (mundo) da ferramenta no seu lugar da bandeja. */
  trayPose(): { pos: Vector3; quat: Quaternion } {
    const { pos, ex, ey } = this.def.bandeja;
    return { pos: pos.clone(), quat: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ex, ey, ex.clone().cross(ey))) };
  }

  /**
   * Prende a ferramenta à mão. Com `manterPose`, ela continua onde está no mundo (quem chama anima
   * a acomodação até a empunhadura); sem isso, já fica empunhada.
   */
  attachTo(anchor: Object3D, side: Side, manterPose = false): void {
    this.holder = side;
    if (manterPose) {
      anchor.attach(this.object);
    } else {
      anchor.add(this.object);
      this.object.position.set(0, 0, 0);
      this.object.quaternion.copy(gripQuat(side, this.def));
    }
    this.setLight(this.def.id === 'laringoscopio');
  }

  /** Tira a ferramenta de cena por já ter sido aplicada no paciente. */
  consume(): void {
    this.holder = 'usado';
    this.object.removeFromParent();
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
