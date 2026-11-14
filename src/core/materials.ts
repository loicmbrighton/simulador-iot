import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';

/** Materiais compartilhados (PBR). Cores em sRGB. */
export const MAT = {
  aco: new MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.22 }),
  acoEscovado: new MeshStandardMaterial({ color: 0xa9adb4, metalness: 1, roughness: 0.42 }),
  acoEscuro: new MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.5 }),
  luva: new MeshStandardMaterial({ color: 0x6f95d8, roughness: 0.5, metalness: 0 }),
  pele: new MeshStandardMaterial({ color: 0xd9a688, roughness: 0.62 }),
  pijama: new MeshStandardMaterial({ color: 0x3f7f86, roughness: 0.85 }),
  manequim: new MeshStandardMaterial({ color: 0xe0b9a0, roughness: 0.55 }),
  labio: new MeshStandardMaterial({ color: 0xb87670, roughness: 0.45 }),
  boca: new MeshStandardMaterial({ color: 0x3a1515, roughness: 0.7 }),
  lencol: new MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.92 }),
  avental: new MeshStandardMaterial({ color: 0x9fb9cf, roughness: 0.9 }),
  colchao: new MeshStandardMaterial({ color: 0x2f4255, roughness: 0.7 }),
  plasticoBranco: new MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.35 }),
  plasticoAzul: new MeshStandardMaterial({ color: 0x2f6fc0, roughness: 0.4 }),
  plasticoVerde: new MeshStandardMaterial({ color: 0x3aa36b, roughness: 0.4 }),
  plasticoPreto: new MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.55 }),
  borracha: new MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.85 }),
  pvc: new MeshPhysicalMaterial({
    color: 0xeef6f8, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.5, side: DoubleSide, clearcoat: 1,
  }),
  silicone: new MeshPhysicalMaterial({
    color: 0xdfeef2, roughness: 0.2, transparent: true, opacity: 0.6, side: DoubleSide, clearcoat: 0.6,
  }),
  bolsaAmbu: new MeshPhysicalMaterial({ color: 0x8ec3e8, roughness: 0.3, transparent: true, opacity: 0.8, clearcoat: 0.5 }),
  lampada: new MeshStandardMaterial({ color: 0xfff6dd, emissive: new Color(0xfff2c8), emissiveIntensity: 0 }),
  tela: new MeshStandardMaterial({ color: 0x000000, roughness: 0.3 }),
  carrinho: new MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.6, roughness: 0.35 }),
  chao: new MeshStandardMaterial({ color: 0x8d9497, roughness: 0.6 }),
  marcaVerde: new MeshStandardMaterial({ color: 0x31d07a, emissive: new Color(0x0b6e3a), roughness: 0.4 }),
  alvo: new MeshStandardMaterial({ color: 0xffb020, emissive: new Color(0x7a4a00), transparent: true, opacity: 0.85 }),
};
