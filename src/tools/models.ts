import {
  CatmullRomCurve3, CylinderGeometry, DoubleSide, Group, Mesh, PointLight, Quaternion, SphereGeometry,
  TorusGeometry, TubeGeometry, Vector2, Vector3, BoxGeometry, ConeGeometry, Object3D, Material,
} from 'three';
import { MAT } from '../core/materials';
import { sweepPlanar } from './sweep';

/**
 * Modelos procedurais das ferramentas, em metros e com dimensões reais.
 * Convenção do espaço local: origem = ponto de empunhadura; eixo +Y = eixo do cabo
 * (fica atravessado na palma); a "ponta útil" fica em `tip`.
 */
export interface ToolModel {
  object: Group;
  tip: Vector3;
  light?: PointLight;
  /** Malha emissiva da lâmpada (acende junto com a luz). */
  lamp?: Mesh;
}

const UP = new Vector3(0, 1, 0);

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: Material, pos?: Vector3): Mesh {
  const m = new Mesh(geo, mat);
  if (pos) m.position.copy(pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Orienta um objeto para que seu eixo +Y aponte na direção `dir`. */
function alignY(obj: Object3D, dir: Vector3): void {
  obj.quaternion.copy(new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
}

function tube(points: Vector3[], radius: number, mat: Material, segments = 48): { mesh: Mesh; curve: CatmullRomCurve3 } {
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  return { mesh: mesh(new TubeGeometry(curve, segments, radius, 14, false), mat), curve };
}

// ---------------------------------------------------------------- Laringoscópio (cabo + lâmina Macintosh 3)
export function buildLaryngoscope(): ToolModel {
  const g = new Group();
  g.name = 'laringoscopio';

  // Cabo serrilhado (pilhas dentro).
  g.add(mesh(new CylinderGeometry(0.0145, 0.0145, 0.125, 28), MAT.acoEscovado, new Vector3(0, -0.0075, 0)));
  for (let i = 0; i < 9; i++) {
    const ring = mesh(new TorusGeometry(0.0146, 0.0011, 6, 28), MAT.acoEscuro, new Vector3(0, -0.055 + i * 0.01, 0));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  g.add(mesh(new CylinderGeometry(0.0149, 0.0149, 0.008, 28), MAT.acoEscuro, new Vector3(0, -0.073, 0)));
  // Encaixe (gancho) da lâmina.
  g.add(mesh(new BoxGeometry(0.024, 0.014, 0.03), MAT.aco, new Vector3(0, 0.061, 0.004)));

  // Lâmina: perfil em "Z" invertido com flange vertical à esquerda (+X) que rebate a língua.
  const path = new CatmullRomCurve3([
    new Vector3(0, 0.066, 0.012), new Vector3(0, 0.072, 0.045), new Vector3(0, 0.071, 0.078),
    new Vector3(0, 0.064, 0.105), new Vector3(0, 0.053, 0.126), new Vector3(0, 0.040, 0.141),
  ]).getPoints(48);
  const th = 0.0016;
  const blade = sweepPlanar(path, (t) => {
    const w = 0.021 - 0.005 * t;
    const fh = 0.0025 + 0.0135 * (1 - t) ** 1.3;
    const lip = Math.max(th + 0.0006, 0.008 * (1 - t));
    return [
      new Vector2(-w / 2, 0), new Vector2(w / 2, 0), new Vector2(w / 2, fh), new Vector2(w / 2 - lip, fh),
      new Vector2(w / 2 - lip, fh - th), new Vector2(w / 2 - th, fh - th), new Vector2(w / 2 - th, th),
      new Vector2(-w / 2, th),
    ];
  });
  const bladeMat = MAT.aco.clone();
  bladeMat.side = DoubleSide;
  g.add(mesh(blade, bladeMat));
  // Ponta romba (bulbo distal).
  const tip = path[path.length - 1].clone();
  g.add(mesh(new CylinderGeometry(0.0022, 0.0022, 0.016, 12).rotateZ(Math.PI / 2), bladeMat, tip.clone().add(new Vector3(0, 0.0012, 0))));

  // Lâmpada junto à flange, apontando para a ponta.
  const bulbPos = path[26].clone().add(new Vector3(0.004, 0.004, 0));
  const lamp = mesh(new SphereGeometry(0.0025, 12, 8), MAT.lampada.clone(), bulbPos);
  lamp.castShadow = false;
  g.add(lamp);
  const light = new PointLight(0xfff1d0, 0, 0.35, 2);
  light.position.copy(bulbPos).add(new Vector3(0, -0.003, 0.004));
  g.add(light);

  return { object: g, tip, light, lamp };
}

// ---------------------------------------------------------------- Tubo orotraqueal 7,5 com fio-guia
export function buildEndotrachealTube(): ToolModel {
  const g = new Group();
  g.name = 'tubo';
  const pts = [
    new Vector3(0, 0.1, 0), new Vector3(0, 0.04, 0), new Vector3(0, -0.03, 0.001),
    new Vector3(0, -0.095, 0.008), new Vector3(0, -0.14, 0.03), new Vector3(0, -0.162, 0.056),
  ];
  const { mesh: body, curve } = tube(pts, 0.0055, MAT.pvc, 80);
  body.castShadow = false;
  g.add(body);

  // Linha radiopaca azul ao longo do tubo.
  const stripe = tube(pts.map((p) => p.clone().add(new Vector3(0.0052, 0, 0))), 0.0007, MAT.plasticoAzul, 80).mesh;
  g.add(stripe);

  // Marcas de profundidade (21, 22, 23 cm a partir da ponta).
  const len = curve.getLength();
  for (const cm of [20, 21, 22, 23, 24]) {
    const u = 1 - cm / 100 / len;
    if (u <= 0) continue;
    const ring = mesh(new TorusGeometry(0.0057, 0.00045, 4, 20), MAT.plasticoPreto, curve.getPointAt(u));
    alignY(ring, curve.getTangentAt(u));
    ring.rotateX(Math.PI / 2);
    g.add(ring);
  }

  // Conector de 15 mm.
  g.add(mesh(new CylinderGeometry(0.0076, 0.0068, 0.028, 20), MAT.plasticoBranco, new Vector3(0, 0.114, 0)));
  g.add(mesh(new CylinderGeometry(0.0115, 0.0115, 0.004, 20), MAT.plasticoBranco, new Vector3(0, 0.104, 0)));

  // Balonete (cuff) desinsuflado perto da ponta.
  const cu = 0.86;
  const cuff = mesh(new SphereGeometry(1, 20, 12), MAT.silicone, curve.getPointAt(cu));
  alignY(cuff, curve.getTangentAt(cu));
  cuff.scale.set(0.0068, 0.016, 0.0068);
  cuff.name = 'cuff';
  g.add(cuff);

  // Fio-guia: segue o tubo e sai pelo conector dobrado.
  const stylet = tube(
    [new Vector3(0.012, 0.142, 0), new Vector3(0, 0.15, 0), ...pts.slice(0, 5).map((p, i) => (i === 0 ? p.clone().setY(0.13) : p.clone()))],
    0.0014, MAT.aco, 80,
  ).mesh;
  g.add(stylet);

  // Linha e balão-piloto.
  const pilot = tube([new Vector3(0.005, 0.05, 0), new Vector3(0.02, 0.07, -0.004), new Vector3(0.038, 0.105, -0.01), new Vector3(0.046, 0.14, -0.012)], 0.0009, MAT.pvc, 30).mesh;
  g.add(pilot);
  const balloon = mesh(new SphereGeometry(1, 16, 10), MAT.silicone, new Vector3(0.047, 0.152, -0.012));
  balloon.scale.set(0.0045, 0.009, 0.003);
  g.add(balloon);
  g.add(mesh(new CylinderGeometry(0.0032, 0.0032, 0.012, 12), MAT.plasticoBranco, new Vector3(0.047, 0.168, -0.012)));

  return { object: g, tip: curve.getPoint(1) };
}

// ---------------------------------------------------------------- Seringa de 10 mL
export function buildSyringe(): ToolModel {
  const g = new Group();
  g.name = 'seringa';
  const barrel = mesh(new CylinderGeometry(0.0088, 0.0088, 0.085, 24, 1, true), MAT.pvc, new Vector3(0, -0.002, 0));
  barrel.castShadow = false;
  g.add(barrel);
  g.add(mesh(new BoxGeometry(0.034, 0.003, 0.017), MAT.plasticoBranco, new Vector3(0, 0.041, 0)));
  g.add(mesh(new ConeGeometry(0.0088, 0.008, 20).rotateX(Math.PI), MAT.plasticoBranco, new Vector3(0, -0.048, 0)));
  g.add(mesh(new CylinderGeometry(0.0022, 0.0018, 0.012, 12), MAT.plasticoBranco, new Vector3(0, -0.058, 0)));
  // Êmbolo.
  g.add(mesh(new CylinderGeometry(0.0084, 0.0084, 0.006, 20), MAT.borracha, new Vector3(0, -0.01, 0)));
  g.add(mesh(new BoxGeometry(0.012, 0.075, 0.0016), MAT.plasticoBranco, new Vector3(0, 0.027, 0)));
  g.add(mesh(new BoxGeometry(0.0016, 0.075, 0.012), MAT.plasticoBranco, new Vector3(0, 0.027, 0)));
  g.add(mesh(new CylinderGeometry(0.011, 0.011, 0.0025, 24), MAT.plasticoBranco, new Vector3(0, 0.066, 0)));
  return { object: g, tip: new Vector3(0, -0.064, 0) };
}

// ---------------------------------------------------------------- Bolsa-válvula-máscara (AMBU)
export function buildBagValveMask(): ToolModel {
  const g = new Group();
  g.name = 'ambu';
  const bag = mesh(new SphereGeometry(1, 32, 20), MAT.bolsaAmbu);
  bag.scale.set(0.058, 0.125, 0.058);
  g.add(bag);
  // Válvula unidirecional + cotovelo até a máscara.
  g.add(mesh(new CylinderGeometry(0.012, 0.014, 0.035, 20), MAT.plasticoAzul, new Vector3(0, 0.14, 0)));
  const elbow = mesh(new CylinderGeometry(0.011, 0.011, 0.03, 20), MAT.silicone, new Vector3(0, 0.162, 0.016));
  elbow.rotation.x = Math.PI / 2;
  g.add(elbow);
  // Máscara facial (abre para +Z local, que fica voltado para baixo quando pronta).
  const mask = mesh(new CylinderGeometry(0.013, 0.047, 0.045, 28, 1, true), MAT.silicone, new Vector3(0, 0.162, 0.052));
  mask.rotation.x = Math.PI / 2;
  mask.scale.set(0.82, 1, 1.15);
  g.add(mask);
  const cushion = mesh(new TorusGeometry(0.046, 0.0085, 12, 32), MAT.silicone, new Vector3(0, 0.162, 0.075));
  cushion.scale.set(0.82, 1.15, 1);
  g.add(cushion);
  // Entrada de O₂ e reservatório.
  g.add(mesh(new CylinderGeometry(0.011, 0.011, 0.03, 16), MAT.plasticoAzul, new Vector3(0, -0.14, 0)));
  const resMat = MAT.plasticoVerde.clone();
  resMat.transparent = true;
  resMat.opacity = 0.55;
  const res = mesh(new SphereGeometry(1, 20, 12), resMat, new Vector3(0, -0.21, 0));
  res.scale.set(0.035, 0.06, 0.035);
  g.add(res);
  return { object: g, tip: new Vector3(0, 0.162, 0.08) };
}

// ---------------------------------------------------------------- Aspirador rígido (Yankauer)
export function buildYankauer(): ToolModel {
  const g = new Group();
  g.name = 'aspirador';
  const handle = mesh(new CylinderGeometry(0.0095, 0.0075, 0.13, 20), MAT.pvc, new Vector3(0, 0.005, 0));
  handle.castShadow = false;
  g.add(handle);
  for (let i = 0; i < 6; i++) {
    g.add(mesh(new TorusGeometry(0.009, 0.0012, 6, 20).rotateX(Math.PI / 2), MAT.silicone, new Vector3(0, 0.03 + i * 0.008, 0)));
  }
  const { mesh: shaft, curve } = tube(
    [new Vector3(0, -0.06, 0), new Vector3(0, -0.1, 0.004), new Vector3(0, -0.135, 0.02), new Vector3(0, -0.152, 0.042)],
    0.0038, MAT.pvc, 40,
  );
  shaft.castShadow = false;
  g.add(shaft);
  const tipPos = curve.getPoint(1);
  g.add(mesh(new SphereGeometry(0.0058, 14, 10), MAT.pvc, tipPos));
  // Extensão de silicone até o vácuo (pende para fora da bandeja).
  g.add(tube(
    [new Vector3(0, 0.07, 0), new Vector3(0, 0.12, 0), new Vector3(0, 0.2, 0.002), new Vector3(-0.03, 0.25, 0.004), new Vector3(-0.28, 0.27, 0.006)],
    0.0045, MAT.silicone, 48,
  ).mesh);
  return { object: g, tip: tipPos };
}
