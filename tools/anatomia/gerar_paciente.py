"""Gera o corpo do paciente a partir dos DADOS do MakeHuman/MPFB2 (malha-base e targets, CC0).

Não executa nenhum código do MPFB: lê `base.obj` e os arquivos `.target.gz` como dados e aplica
os deslocamentos com a mesma regra de mistura de macros do MakeHuman.

Uso: python -I gerar_paciente.py <pasta mpfb2/src/mpfb/data> <saida.blend>
"""
import gzip
import os
import sys

import bpy
import numpy as np

DATA, OUT = sys.argv[-2], sys.argv[-1]

# Paciente-base: homem adulto, ~40 anos, musculatura e peso médios, fenótipo brasileiro misto.
AGE_YEARS = 40
RACE = {'caucasian': 0.55, 'african': 0.3, 'asian': 0.15}
GENDER_MALE = 1.0


def age_weights(years: float) -> dict:
    """MakeHuman: 25 anos = 'young' (0,5), 90 anos = 'old' (1,0); interpolação linear entre eles."""
    v = 0.5 + (years - 25) / (90 - 25) * 0.5
    old = max(0.0, min(1.0, (v - 0.5) / 0.5))
    return {'young': 1 - old, 'old': old}


def read_obj(path):
    verts, uvs, faces, face_uvs, group = [], [], [], [], None
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                group = line.split()[1]
            elif line.startswith('f ') and group == 'body':
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
bpy.ops.wm.save_as_mainfile(filepath=OUT)
