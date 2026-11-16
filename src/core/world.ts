import {
  BackSide, BoxGeometry, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  Group, HemisphereLight, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SpotLight, SRGBColorSpace,
  TorusGeometry, Vector3, ConeGeometry, Object3D,
} from 'three';
import { VITALS, type ScenarioInfo } from '../config';
import type { Patient } from './patient';
import { TRAY_SIZE, TRAY_TOP } from '../tools/tools';
import { MAT } from './materials';

const MATTRESS_TOP = 0.92;
const HEAD_C = new Vector3(0, 1.035, 0);
const HEAD_R = new Vector3(0.078, 0.095, 0.105);

function m(geo: ConstructorParameters<typeof Mesh>[0], mat: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Sala, maca, paciente (manequim provisório), bandeja, monitor e luzes. */
export class World {
  readonly group = new Group();
  /** Pontos de referência anatômicos usados pelos exercícios e, depois, pelas interações. */
  readonly landmarks = {
    boca: new Vector3(0, HEAD_C.y + 0.081, 0.058),
    comissuraDireita: new Vector3(-0.024, HEAD_C.y + 0.076, 0.06),
    comissuraEsquerda: new Vector3(0.024, HEAD_C.y + 0.076, 0.06),
    mento: new Vector3(0, HEAD_C.y + 0.04, 0.1),
    fronte: new Vector3(0, HEAD_C.y + 0.088, -0.045),
    cricoide: new Vector3(0, 1.05, 0.165),
  };
  /** Sinais vitais mostrados no monitor (pioram a cada erro de conduta). */
  readonly vitals = { fc: VITALS.fc, spo2: VITALS.spo2 };
  /** Paciente real (carregado depois); enquanto isso o manequim aparece. */
  patient: Patient | null = null;
  private mannequin: Group | null = null;
  private spotTarget: Object3D | null = null;
  private readonly wallMat = new MeshStandardMaterial({ color: 0xc7c3bb, roughness: 0.95, side: BackSide });
  private readonly monitorCanvas = document.createElement('canvas');
  private readonly monitorTex: CanvasTexture;
  private monitorClock = 0;
  private ecgPhase = 0;

  constructor() {
    this.buildRoom();
    this.buildBed();
    this.buildPatient();
    this.buildTray();
    this.monitorCanvas.width = 512;
    this.monitorCanvas.height = 372;
    this.monitorTex = new CanvasTexture(this.monitorCanvas);
    this.monitorTex.colorSpace = SRGBColorSpace;
    this.buildMonitor();
    this.buildLights();
  }

  /** Troca o manequim pelo paciente real e atualiza os pontos de referência. */
  setPatient(p: Patient): void {
    this.patient = p;
    this.group.add(p.root);
    if (this.mannequin) this.mannequin.visible = false;
    this.refreshLandmarks();
  }

  /** Atualiza os pontos de referência para a pose atual do paciente (cabeça e boca mudam de lugar). */
  refreshLandmarks(): void {
    const p = this.patient;
    if (!p) return;
    // Boca: entre os lábios (acompanha a abertura).
    this.landmarks.boca.copy(p.landmark('labioSuperior')).add(p.landmark('labioInferior')).multiplyScalar(0.5);
    this.landmarks.comissuraDireita.copy(p.landmark('comissuraDireita'));
    this.landmarks.comissuraEsquerda.copy(p.landmark('comissuraEsquerda'));
    this.landmarks.mento.copy(p.landmark('mento'));
    this.landmarks.fronte.copy(p.landmark('fronte'));
    this.landmarks.cricoide.copy(p.landmark('cricoide'));
    this.spotTarget?.position.copy(this.landmarks.boca);
  }

  applyScenario(s: ScenarioInfo): void {
    this.wallMat.color = new Color(s.paredes);
  }

  /** Elipsoide aproximado da cabeça (para saber se o cursor está sobre ela). */
  headShape(): { centro: Vector3; raios: Vector3 } {
    return this.patient ? { centro: this.patient.headCenter, raios: this.patient.headRadii } : { centro: HEAD_C, raios: HEAD_R };
  }

  // ------------------------------------------------------------------ construção
  private buildRoom(): void {
    const room = m(new BoxGeometry(7, 3.2, 7), this.wallMat, 0, 1.6, 0.6);
    room.castShadow = false;
    this.group.add(room);
    const floor = m(new PlaneGeometry(7, 7), MAT.chao, 0, 0.001, 0.6);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    // Luminárias de teto.
    const panelMat = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 });
    for (const z of [-0.8, 1.2]) {
      const panel = m(new BoxGeometry(1.2, 0.02, 0.6), panelMat, 0, 3.19, z);
      panel.castShadow = false;
      this.group.add(panel);
    }
  }

  private buildBed(): void {
    const bed = new Group();
    bed.add(m(new BoxGeometry(0.86, 0.12, 2.0), MAT.colchao, 0, MATTRESS_TOP - 0.06, 0.78));
    bed.add(m(new BoxGeometry(0.8, 0.06, 1.9), MAT.carrinho, 0, MATTRESS_TOP - 0.15, 0.78));
    bed.add(m(new BoxGeometry(0.5, 0.5, 1.4), MAT.acoEscuro, 0, 0.45, 0.78));
    for (const x of [-0.36, 0.36]) for (const z of [-0.12, 1.68]) bed.add(m(new CylinderGeometry(0.02, 0.02, 0.72, 10), MAT.carrinho, x, 0.4, z));
    // Lençol.
    bed.add(m(new BoxGeometry(0.88, 0.012, 2.02), MAT.lencol, 0, MATTRESS_TOP + 0.001, 0.78));
    this.group.add(bed);
  }

  private buildPatient(): void {
    const p = new Group();
    p.name = 'paciente';
    this.mannequin = p;
    // Coxim occipital.
    const pad = m(new CylinderGeometry(0.11, 0.12, 0.03, 24), MAT.lencol, 0, MATTRESS_TOP + 0.012, -0.01);
    p.add(pad);
    // Cabeça (manequim). Face voltada para +Y, queixo para +Z.
    const head = m(new SphereGeometry(1, 40, 28), MAT.manequim, HEAD_C.x, HEAD_C.y, HEAD_C.z);
    head.scale.copy(HEAD_R);
    p.add(head);
    const nose = m(new ConeGeometry(0.014, 0.034, 16), MAT.manequim, 0, HEAD_C.y + 0.098, 0.012);
    nose.scale.set(1, 1, 1.5);
    p.add(nose);
    const mouth = m(new CircleGeometry(1, 24), MAT.boca, 0, HEAD_C.y + 0.0796, 0.058);
    mouth.rotation.x = -Math.PI / 2 + 0.55;
    mouth.scale.set(0.02, 0.006, 1);
    p.add(mouth);
    const lips = m(new TorusGeometry(1, 0.28, 10, 28), MAT.labio, 0, HEAD_C.y + 0.079, 0.058);
    lips.rotation.x = -Math.PI / 2 + 0.55;
    lips.scale.set(0.022, 0.0085, 0.012);
    p.add(lips);
    for (const x of [-0.03, 0.03]) {
      const eye = m(new CapsuleGeometry(0.0022, 0.018, 4, 8), MAT.boca, x, HEAD_C.y + 0.0935, -0.014);
      eye.rotation.z = Math.PI / 2;
      p.add(eye);
      const ear = m(new TorusGeometry(0.018, 0.006, 8, 16, Math.PI * 1.2), MAT.manequim, Math.sign(x) * 0.079, HEAD_C.y + 0.01, 0.0);
      ear.rotation.y = Math.PI / 2;
      p.add(ear);
    }
    // Pescoço.
    const neck = m(new CylinderGeometry(0.055, 0.06, 0.16, 24), MAT.manequim, 0, 0.995, 0.13);
    neck.rotation.x = Math.PI / 2;
    p.add(neck);
    // Tronco com avental.
    const torso = m(new CapsuleGeometry(0.12, 0.5, 8, 24), MAT.avental, 0, 1.04, 0.48);
    torso.rotation.x = Math.PI / 2;
    torso.scale.set(1.55, 1, 1);
    p.add(torso);
    for (const x of [-0.25, 0.25]) {
      const arm = m(new CapsuleGeometry(0.045, 0.55, 6, 14), MAT.avental, x, 0.99, 0.6);
      arm.rotation.x = Math.PI / 2;
      p.add(arm);
      p.add(m(new SphereGeometry(0.045, 14, 10), MAT.manequim, x, 0.985, 0.94));
    }
    // Pernas sob o lençol.
    p.add(m(new BoxGeometry(0.7, 0.14, 0.95), MAT.lencol, 0, MATTRESS_TOP + 0.07, 1.28));
    this.group.add(p);
  }

  private buildTray(): void {
    const cart = new Group();
    const { x: w, z: d } = TRAY_SIZE;
    const c = TRAY_TOP;
    cart.add(m(new BoxGeometry(w, 0.02, d), MAT.carrinho, c.x, c.y - 0.011, c.z));
    // Campo verde estéril.
    cart.add(m(new BoxGeometry(w - 0.03, 0.002, d - 0.03), new MeshStandardMaterial({ color: 0x3f8a6e, roughness: 0.95 }), c.x, c.y - 0.0005, c.z));
    for (const x of [c.x - w / 2 + 0.02, c.x + w / 2 - 0.02]) {
      for (const z of [c.z - d / 2 + 0.02, c.z + d / 2 - 0.02]) cart.add(m(new CylinderGeometry(0.012, 0.012, c.y - 0.02, 8), MAT.carrinho, x, (c.y - 0.02) / 2, z));
    }
    cart.add(m(new BoxGeometry(w, 0.02, d), MAT.carrinho, c.x, 0.3, c.z));
    this.group.add(cart);
  }

  private buildMonitor(): void {
    const g = new Group();
    g.position.set(0.62, 1.42, 0.22);
    g.rotation.y = Math.PI + 0.75;
    g.add(m(new BoxGeometry(0.36, 0.27, 0.07), MAT.plasticoPreto));
    const screen = new Mesh(new PlaneGeometry(0.33, 0.24), new MeshStandardMaterial({ map: this.monitorTex, emissiveMap: this.monitorTex, emissive: 0xffffff, emissiveIntensity: 0.9, color: 0x000000 }));
    screen.position.z = 0.036;
    g.add(screen);
    const pole = m(new CylinderGeometry(0.015, 0.015, 1.42, 10), MAT.carrinho, 0, -0.71, -0.02);
    g.add(pole);
    this.group.add(g);
  }

  private buildLights(): void {
    this.group.add(new HemisphereLight(0xf2f6ff, 0x4d443c, 0.5));
    const sun = new DirectionalLight(0xffffff, 0.6);
    sun.position.set(-1, 3, 1);
    this.group.add(sun);
    // Foco auxiliar sobre a cabeça do paciente.
    const spot = new SpotLight(0xfff4e6, 22, 0, 0.42, 0.65, 2);
    spot.position.set(0.35, 2.35, -0.25);
    spot.target.position.copy(this.landmarks.boca);
    this.spotTarget = spot.target;
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0002;
    spot.shadow.normalBias = 0.01;
    spot.shadow.camera.near = 0.5;
    spot.shadow.camera.far = 4;
    this.group.add(spot, spot.target);
  }

  // ------------------------------------------------------------------ monitor (provisório, sinais estáveis)
  update(dt: number): void {
    this.monitorClock += dt;
    this.ecgPhase += dt;
    if (this.monitorClock < 1 / 24) return;
    this.monitorClock = 0;
    const c = this.monitorCanvas.getContext('2d')!;
    const W = c.canvas.width, H = c.canvas.height;
    c.fillStyle = '#05080a';
    c.fillRect(0, 0, W, H);
    const t = this.ecgPhase;
    const trace = (y0: number, amp: number, color: string, fn: (x: number) => number) => {
      c.strokeStyle = color;
      c.lineWidth = 2.5;
      c.beginPath();
      for (let x = 0; x < 330; x += 2) {
        const y = y0 - amp * fn(t * 1.3 - (330 - x) / 120);
        if (x === 0) c.moveTo(12 + x, y); else c.lineTo(12 + x, y);
      }
      c.stroke();
    };
    const { fc, spo2 } = this.vitals;
    const T = 60 / fc / 1.3; // período do batimento na escala de tempo do traçado
    const beat = (s: number) => {
      const ph = ((s % T) + T) % T / T;
      return Math.exp(-((ph - 0.3) ** 2) / 0.0006) * 1 - Math.exp(-((ph - 0.33) ** 2) / 0.0004) * 0.35 + Math.exp(-((ph - 0.55) ** 2) / 0.004) * 0.18;
    };
    const pleth = (s: number) => {
      const ph = ((s % T) + T) % T / T;
      return Math.sin(Math.PI * Math.min(1, ph * 2.2)) * (ph < 0.45 ? 1 : 0.6) + (ph > 0.45 ? Math.sin((ph - 0.45) * 8) * 0.12 : 0);
    };
    trace(90, 55, '#3cff7a', beat);
    trace(200, 34, '#4fd8ff', pleth);
    c.strokeStyle = '#ffe14d';
    c.beginPath();
    c.moveTo(12, 320);
    c.lineTo(340, 320);
    c.stroke();
    c.font = 'bold 44px sans-serif';
    // Valores fora da faixa piscam em vermelho (alarme).
    const blink = Math.floor(t * 3) % 2 === 0;
    c.fillStyle = fc >= VITALS.alarme.fc && blink ? '#ff5a4d' : '#3cff7a';
    c.fillText(String(Math.round(fc)), 380, 95);
    c.fillStyle = spo2 <= VITALS.alarme.spo2 && blink ? '#ff5a4d' : '#4fd8ff';
    c.fillText(String(Math.round(spo2)), 380, 210);
    c.fillStyle = '#ffe14d';
    c.fillText('--', 380, 325);
    c.font = '18px sans-serif';
    c.fillStyle = '#9fb3bf';
    c.fillText('FC', 380, 40);
    c.fillText('SpO₂ %', 380, 155);
    c.fillText('EtCO₂', 380, 270);
    c.fillStyle = '#e8eef2';
    c.font = '20px sans-serif';
    c.fillText('PA 124/76 (92)', 20, 260);
    this.monitorTex.needsUpdate = true;
  }
}
