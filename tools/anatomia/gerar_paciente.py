"""Gera o corpo do paciente a partir dos DADOS do MakeHuman/MPFB2 (malha-base e targets, CC0).

Não executa nenhum código do MPFB: lê `base.obj` e os arquivos `.target.gz` como dados e aplica
os deslocamentos com a mesma regra de mistura de macros do MakeHuman.

Uso: python -I gerar_paciente.py <pasta mpfb2/src/mpfb/data> <pasta do pacote de assets extraído> <saida.blend>

O pacote de assets é o "MakeHuman system assets" (CC0): pele, olhos, sobrancelhas, cílios, cabelo,
dentes e língua. Os acessórios são ajustados ao corpo pelos arquivos .mhclo (cada vértice do acessório
= combinação de 3 vértices do corpo + deslocamento escalado), lidos como dados.
"""
import gzip
import os
import sys

import bpy
import numpy as np

DATA, ASSETS, OUT = sys.argv[-3], sys.argv[-2], sys.argv[-1]

# Paciente-base: homem adulto, ~40 anos, musculatura e peso médios, fenótipo brasileiro misto.
AGE_YEARS = 40
SKIN = 'skins/middleage_caucasian_male/middleage_lightskinned_male_diffuse.png'
PROXIES = {  # nome: (pasta, arquivo de textura, material)
    'olhos': ('eyes/high-poly', 'eyes/materials/brown_eye.png', 'olho'),
    'sobrancelhas': ('eyebrows/eyebrow001', 'eyebrows/eyebrow001/eyebrow001.png', 'pelo'),
    'cilios': ('eyelashes/eyelashes01', 'eyelashes/eyelashes01/eyelashes01.png', 'pelo'),
    'cabelo': ('hair/short02', 'hair/short02/short02_diffuse.png', 'pelo'),
    'dentes': ('teeth/teeth_base', 'teeth/teeth_base/teeth.png', 'dente'),
    'lingua': ('tongue/tongue01', 'tongue/tongue01/tongue01_diffuse.png', 'mucosa'),
}
RACE = {'caucasian': 0.55, 'african': 0.3, 'asian': 0.15}
GENDER_MALE = 1.0


def age_weights(years: float) -> dict:
    """MakeHuman: 25 anos = 'young' (0,5), 90 anos = 'old' (1,0); interpolação linear entre eles."""
    v = 0.5 + (years - 25) / (90 - 25) * 0.5
    old = max(0.0, min(1.0, (v - 0.5) / 0.5))
    return {'young': 1 - old, 'old': old}


def read_obj(path, only_group='body'):
    verts, uvs, faces, face_uvs, group = [], [], [], [], None
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                group = line.split()[1]
            elif line.startswith('f ') and (only_group is None or group == only_group):
                parts = [p.split('/') for p in line.split()[1:]]
                faces.append([int(p[0]) - 1 for p in parts])
                face_uvs.append([int(p[1]) - 1 for p in parts])
    return np.array(verts), np.array(uvs), faces, face_uvs


def read_target(path):
    idx, delta = [], []
    with gzip.open(path, 'rt', encoding='utf-8') as fh:
        for line in fh:
            if not line.strip() or line.startswith('#'):
                continue
            p = line.split()
            idx.append(int(p[0]))
            delta.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, dtype=int), np.array(delta).reshape(-1, 3)


verts, uvs, faces, face_uvs = read_obj(os.path.join(DATA, '3dobjs', 'base.obj'))
macro = os.path.join(DATA, 'targets', 'macrodetails')
applied = []
ages = age_weights(AGE_YEARS)
for race, rw in RACE.items():
    for age, aw in ages.items():
        w = rw * aw * GENDER_MALE
        if w < 1e-3:
            continue
        idx, d = read_target(os.path.join(macro, f'{race}-male-{age}.target.gz'))
        verts[idx] += d * w
        applied.append((f'{race}-male-{age}', round(w, 3)))
# Proporções "ideais" a 50 %.
for age, aw in ages.items():
    f = os.path.join(macro, 'proportions', f'male-{age}-averagemuscle-averageweight-idealproportions.target.gz')
    if os.path.exists(f) and aw > 1e-3:
        idx, d = read_target(f)
        verts[idx] += d * 0.5 * aw
        applied.append((os.path.basename(f), round(0.5 * aw, 3)))
print('targets aplicados:', applied)

# Só os vértices usados pelo corpo; MakeHuman é Y-up em decímetros → Blender Z-up em metros.
used = sorted({i for f in faces for i in f})
remap = {old: new for new, old in enumerate(used)}
v = verts[used] * 0.1
v = np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)
v[:, 2] -= v[:, 2].min()

bpy.ops.wm.read_factory_settings(use_empty=True)
me = bpy.data.meshes.new('paciente')
me.from_pydata(v.tolist(), [], [[remap[i] for i in f] for f in faces])
uv_layer = me.uv_layers.new(name='UVMap')
loop = 0
for f_uv in face_uvs:
    for t in f_uv:
        uv_layer.data[loop].uv = uvs[t]
        loop += 1
me.validate()
for p in me.polygons:
    p.use_smooth = True

obj = bpy.data.objects.new('paciente', me)
bpy.context.scene.collection.objects.link(obj)
# Guarda o mapeamento para os índices originais (necessário para rig e targets locais depois).
attr = me.attributes.new('mh_index', 'INT', 'POINT')
attr.data.foreach_set('value', np.array(used, dtype=np.int32))
print(f'corpo: {len(me.vertices)} vértices, {len(me.polygons)} faces, altura {v[:, 2].max():.3f} m')
Z_OFFSET = (verts[used] * 0.1)[:, 1].min()


def to_blender(p):
    """MakeHuman (dm, Y-up) → Blender (m, Z-up), com os pés no chão."""
    p = p * 0.1
    out = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    out[:, 2] -= Z_OFFSET
    return out


def fit_mhclo(path):
    """Posição dos vértices do acessório a partir do corpo deformado (regra do MakeHuman)."""
    scale = np.ones(3)
    refs, weights, offsets = [], [], []
    in_verts = False
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            t = line.split()
            if not t or t[0].startswith('#'):
                continue
            if t[0] in ('x_scale', 'y_scale', 'z_scale'):
                a, b, ref = int(t[1]), int(t[2]), float(t[3])
                axis = 'xyz'.index(t[0][0])
                scale[axis] = abs(verts[a, axis] - verts[b, axis]) / ref
            elif t[0] == 'verts':
                in_verts = True
            elif in_verts and t[0].lstrip('-').isdigit():
                if len(t) == 1:
                    refs.append([int(t[0])] * 3); weights.append([1, 0, 0]); offsets.append([0, 0, 0])
                else:
                    refs.append([int(x) for x in t[:3]]); weights.append([float(x) for x in t[3:6]]); offsets.append([float(x) for x in t[6:9]])
            elif in_verts and t[0].isalpha():
                in_verts = False
    refs, weights, offsets = np.array(refs), np.array(weights), np.array(offsets)
    pos = (verts[refs] * weights[:, :, None]).sum(axis=1) + offsets * scale
    return pos


def material(name, tex_path, kind):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(tex_path)
    tex.image.pack()
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if kind == 'pele':
        b.inputs['Roughness'].default_value = 0.5
        b.inputs['Subsurface Weight'].default_value = 0.15
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
        b.inputs['Subsurface Scale'].default_value = 0.008
    elif kind == 'pelo':
        nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
        b.inputs['Roughness'].default_value = 0.6
        m.surface_render_method = 'BLENDED'
    elif kind == 'olho':
        b.inputs['Roughness'].default_value = 0.08
        b.inputs['Coat Weight'].default_value = 1.0
    elif kind == 'dente':
        b.inputs['Roughness'].default_value = 0.25
    else:
        b.inputs['Roughness'].default_value = 0.3
    return m


obj.data.materials.append(material('pele', os.path.join(ASSETS, SKIN), 'pele'))

for name, (folder, tex, kind) in PROXIES.items():
    base = os.path.join(ASSETS, folder)
    clo = next(f for f in os.listdir(base) if f.endswith('.mhclo'))
    objf = next(f for f in os.listdir(base) if f.endswith('.obj'))
    pv = fit_mhclo(os.path.join(base, clo))
    _, puv, pfaces, pfuv = read_obj(os.path.join(base, objf), only_group=None)
    pm = bpy.data.meshes.new(name)
    pm.from_pydata(to_blender(pv).tolist(), [], pfaces)
    layer = pm.uv_layers.new(name='UVMap')
    k = 0
    for f_uv in pfuv:
        for t in f_uv:
            layer.data[k].uv = puv[t]
            k += 1
    for p in pm.polygons:
        p.use_smooth = True
    pm.materials.append(material(name, os.path.join(ASSETS, tex), kind))
    po = bpy.data.objects.new(name, pm)
    bpy.context.scene.collection.objects.link(po)
    print(f'{name}: {len(pm.vertices)} vértices')

bpy.ops.wm.save_as_mainfile(filepath=OUT)
