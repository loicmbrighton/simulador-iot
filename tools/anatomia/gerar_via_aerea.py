"""Constrói a via aérea interna do paciente (cavidade oral → faringe → laringe → traqueia/esôfago).

Método: define o VOLUME DE AR como uma função de distância com sinal (SDF) numa grade 3D, subtrai os
tecidos (língua, palato mole/úvula, coluna laríngea, epiglote, aritenoides) e extrai a superfície com
marching cubes. A superfície resultante é a mucosa, contínua, com valécula, seios piriformes,
pregas vestibulares/vocais e ventrículo formados pela própria geometria.

Coordenadas: espaço do paciente MakeHuman em pé (metros, Blender): +X = esquerda do paciente,
-Y = anterior (face), +Z = cranial. Pontos de referência medidos no paciente gerado (dentes, língua,
perfil do pescoço, ossos) e proporções anatômicas de adulto (Z-Anatomy / literatura).

Uso: python -I gerar_via_aerea.py <paciente.blend> <saida.blend>
"""
import sys

import bpy  # precisa vir antes de bmesh
import bmesh
import numpy as np
from skimage.measure import marching_cubes

SRC, OUT = sys.argv[-2], sys.argv[-1]
STEP = 0.0007  # 0,7 mm
LO = np.array([-0.045, -0.162, 1.37], dtype=np.float32)
HI = np.array([0.045, -0.022, 1.625], dtype=np.float32)

# ------------------------------------------------------------------ marcos anatômicos (linha média)
Z_GLOTE = 1.4765            # pregas vocais (altura da cartilagem tireoide)
Y_COMISSURA_ANT = -0.0715   # comissura anterior
Y_PROC_VOCAL = -0.0505      # processos vocais das aritenoides
Y_LARINGE = -0.0615         # centro do lúmen laríngeo


def interp(t, keys):
    """Interpolação linear por partes: keys = [(t, valor), ...] (t crescente)."""
    k = np.array(keys, dtype=np.float32)
    return np.interp(t, k[:, 0], k[:, 1]).astype(np.float32)


def ellipse(dx, dy, a, b):
    """SDF aproximada de elipse 2D (negativa dentro)."""
    return (np.sqrt((dx / a) ** 2 + (dy / b) ** 2) - 1.0) * np.minimum(a, b)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def capsule(P, a, b, r):
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    pa, ba = P - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - r


def ellipsoid(P, c, r):
    q = (P - np.asarray(c, np.float32)) / np.asarray(r, np.float32)
    k = np.linalg.norm(q, axis=1)
    return (k - 1.0) * min(r)


# ------------------------------------------------------------------ componentes
def oral_air(x, y, z):
    """Cavidade oral: do lábio ao istmo das fauces, entre o assoalho e o palato."""
    a = interp(y, [(-0.16, 0.016), (-0.145, 0.019), (-0.12, 0.029), (-0.09, 0.031), (-0.07, 0.025), (-0.055, 0.018)])
    roof = interp(y, [(-0.16, 1.572), (-0.145, 1.575), (-0.12, 1.587), (-0.10, 1.592), (-0.08, 1.589), (-0.065, 1.584), (-0.055, 1.582)])
    floor = interp(y, [(-0.16, 1.556), (-0.14, 1.547), (-0.10, 1.543), (-0.065, 1.545)])
    zc, h = (roof + floor) / 2, (roof - floor) / 2
    # Superelipse (expoente 3): laterais arredondadas, abóbada palatina alta no meio.
    k = (np.abs(x) / a) ** 3 + (np.abs(z - zc) / h) ** 3
    d = (np.cbrt(k) - 1.0) * np.minimum(a, h)
    d = smax(d, np.maximum(-0.162 - y, y + 0.054), 0.005)
    return d


def tongue(x, y, z):
    """Língua: parte oral (dorso quase horizontal) + base (quase vertical) até a valécula."""
    a = interp(y, [(-0.142, 0.013), (-0.13, 0.021), (-0.10, 0.027), (-0.075, 0.024), (-0.062, 0.02)])
    top = interp(y, [(-0.142, 1.553), (-0.13, 1.559), (-0.11, 1.567), (-0.09, 1.5715), (-0.075, 1.571), (-0.066, 1.566)])
    top = top - 0.007 * (np.clip(np.abs(x) / a, 0, 1)) ** 2 - 0.0012 * np.exp(-(x / 0.002) ** 2)   # sulco mediano
    oral = smax(z - top, np.abs(x) - a, 0.006)
    oral = smax(oral, -0.142 - y, 0.006)
    oral = smax(oral, 1.535 - z, 0.003)
    oral = smax(oral, y + 0.061, 0.004)          # limite posterior: daqui para trás é a base
    # Base: superfície posterior y_s(z), da úvula à valécula.
    ys = interp(z, [(1.503, -0.0805), (1.512, -0.0785), (1.525, -0.0725), (1.54, -0.0675), (1.555, -0.0645), (1.566, -0.065)])
    ab = interp(z, [(1.503, 0.012), (1.515, 0.017), (1.54, 0.021), (1.566, 0.022)])
    base = np.maximum(y - ys - 0.004 * (x / ab) ** 2, np.abs(x) - ab)
    base = smax(base, 1.503 - z, 0.003)
    base = smax(base, z - 1.567, 0.004)
    return smin(oral, base, 0.006)


def pharynx_air(x, y, z):
    """Naso/oro/hipofaringe: tubo achatado à frente da coluna cervical, afinando até a boca do esôfago."""
    yp = interp(z, [(1.40, -0.037), (1.462, -0.0395), (1.49, -0.0415), (1.52, -0.0435), (1.56, -0.0455), (1.61, -0.047)])
    b = interp(z, [(1.40, 0.0011), (1.458, 0.0013), (1.466, 0.004), (1.475, 0.0105), (1.49, 0.0145), (1.505, 0.0195), (1.515, 0.0185), (1.53, 0.0155), (1.56, 0.0125), (1.59, 0.0105), (1.61, 0.009)])
    a = interp(z, [(1.40, 0.0065), (1.458, 0.0075), (1.466, 0.012), (1.478, 0.019), (1.50, 0.021), (1.53, 0.021), (1.56, 0.0195), (1.61, 0.016)])
    d = ellipse(x, y - (yp - b), a, b)
    return smax(d, np.maximum(1.40 - z, z - 1.612), 0.003)


def larynx_column(x, y, z):
    """Tecido da laringe (paredes + pregas ariepiglóticas), com a borda superior inclinada (adito)."""
    d = ellipse(x, y - (-0.0615), 0.0135, 0.0145)
    top = 1.4915 + (-0.0485 - y) * 0.72        # sobe de trás (aritenoides) para frente (epiglote)
    d = smax(d, z - top, 0.0015)
    return smax(d, 1.44 - z, 0.002)


def larynx_lumen(x, y, z):
    """Lúmen laríngeo: vestíbulo, pregas vestibulares, ventrículo, glote (triângulo) e subglote/traqueia."""
    zz = z
    a = interp(zz, [(1.37, 0.0088), (1.455, 0.0088), (1.468, 0.0068), (1.4738, 0.0045), (1.4795, 0.0045),
                    (1.4805, 0.0076), (1.4822, 0.0077), (1.4838, 0.0043), (1.4862, 0.0046), (1.4885, 0.0078),
                    (1.50, 0.0095), (1.516, 0.0105)])
    b = interp(zz, [(1.37, 0.0088), (1.455, 0.0088), (1.468, 0.0095), (1.4738, 0.0105), (1.4795, 0.0105),
                    (1.4805, 0.0098), (1.4838, 0.0092), (1.4885, 0.0102), (1.50, 0.0112), (1.516, 0.0122)])
    cy = interp(zz, [(1.37, -0.0575), (1.455, -0.0625), (1.4738, Y_LARINGE), (1.50, -0.0615), (1.516, -0.0605)])
    ring = 0.0005 * np.sin(zz / 0.0042 * 2 * np.pi) * (zz < 1.452)   # anéis traqueais
    d_ell = ellipse(x, y - cy, a + ring, b + ring)
    # Glote: triângulo com ápice na comissura anterior e base nos processos vocais (abduzida, paciente curarizado).
    t = np.clip((y - Y_COMISSURA_ANT) / (Y_PROC_VOCAL - Y_COMISSURA_ANT), 0, 1)
    half = 0.0006 + 0.0039 * t
    d_tri = np.maximum(np.abs(x) - half, np.maximum(Y_COMISSURA_ANT - y, y - (Y_PROC_VOCAL + 0.0028)))
    g = np.exp(-((zz - Z_GLOTE) / 0.0016) ** 2)
    d = d_ell * (1 - g) + d_tri * g
    return smax(d, zz - 1.517, 0.002)


def epiglottis(x, y, z):
    """Epiglote: folha curva (lados curvados para trás), da prega até a ponta livre."""
    ye = interp(z, [(1.488, -0.0738), (1.50, -0.0748), (1.512, -0.0738), (1.52, -0.0712), (1.526, -0.0685)])
    a = interp(z, [(1.488, 0.003), (1.498, 0.0085), (1.51, 0.0118), (1.519, 0.0108), (1.526, 0.0055)])
    yc = ye + 42.0 * x ** 2                      # curvatura: bordas laterais para posterior ("ômega")
    thick = interp(z, [(1.488, 0.0022), (1.505, 0.0016), (1.526, 0.0011)])
    d = smax(np.abs(y - yc) - thick, np.abs(x) - a, 0.0012)
    z_top = 1.5265 - 55.0 * x ** 2               # borda livre arredondada
    d = smax(d, np.maximum(1.487 - z, z - z_top), 0.0018)
    return d


def soft_palate(P):
    d = capsule(P, (0, -0.0735, 1.5815), (0, -0.0585, 1.5655), 0.0042)
    d = smax(d, np.abs(P[:, 0]) - 0.017, 0.004)
    uvula = capsule(P, (0, -0.0585, 1.566), (0, -0.0565, 1.5545), 0.0032)
    return smin(d, uvula, 0.002)


def fauces(x, y, z):
    """Pilares (arcos palatoglossos): tecido em volta de uma abertura em arco no istmo das fauces."""
    opening = ellipse(x, z - 1.546, 0.0165, 0.031)
    slab = np.maximum(np.maximum(-0.0665 - y, y + 0.0575), 1.534 - z)   # só acima do dorso da língua
    return smax(-opening, slab, 0.004)


def arytenoids(P):
    d = np.full(len(P), 1.0, np.float32)
    for s in (1, -1):
        d = np.minimum(d, ellipsoid(P, (s * 0.0055, -0.0500, 1.4905), (0.0036, 0.0042, 0.0050)))   # corniculados
        d = np.minimum(d, ellipsoid(P, (s * 0.0092, -0.0540, 1.4960), (0.0024, 0.0030, 0.0030)))   # cuneiformes
    return d


def glossoepiglottic(P):
    return capsule(P, (0, -0.0790, 1.5045), (0, -0.0745, 1.5035), 0.0012)


# ------------------------------------------------------------------ avaliação na grade
nx, ny, nz = (np.ceil((HI - LO) / STEP)).astype(int) + 1
xs = LO[0] + np.arange(nx, dtype=np.float32) * STEP
ys = LO[1] + np.arange(ny, dtype=np.float32) * STEP
zs = LO[2] + np.arange(nz, dtype=np.float32) * STEP
print(f'grade {nx}×{ny}×{nz} = {nx * ny * nz / 1e6:.1f} M pontos')
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
x, y, z = X.ravel(), Y.ravel(), Z.ravel()
del X, Y, Z
P = np.stack([x, y, z], axis=1)

d_t = tongue(x, y, z)
air = smin(oral_air(x, y, z), pharynx_air(x, y, z), 0.006)
air = smax(air, -soft_palate(P), 0.0015)
air = smax(air, -fauces(x, y, z), 0.003)
air = smax(air, -d_t, 0.0015)
air = smax(air, -larynx_column(x, y, z), 0.0012)
air = smin(air, larynx_lumen(x, y, z), 0.0012)
d_e = epiglottis(x, y, z)
air = smax(air, -d_e, 0.0008)
air = smax(air, -glossoepiglottic(P), 0.001)
air = smax(air, -arytenoids(P), 0.0028)
# Abre para fora pela boca (o corte frontal é removido depois, atrás dos lábios).
vol = air.reshape(nx, ny, nz)
del P

verts, faces, normals, _ = marching_cubes(vol, level=0.0, spacing=(STEP, STEP, STEP))
verts = verts + LO
print(f'superfície: {len(verts)} vértices, {len(faces)} triângulos')

# ------------------------------------------------------------------ malha no Blender
bpy.ops.wm.open_mainfile(filepath=SRC, load_ui=False)
me = bpy.data.meshes.new('via_aerea')
me.from_pydata(verts.tolist(), [], faces[:, ::-1].tolist())   # normais apontando para dentro do ar
obj = bpy.data.objects.new('via_aerea', me)
bpy.context.scene.collection.objects.link(obj)

# Remove o que fica à frente dos lábios (o volume de ar "vaza" pela boca).
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.1475], context='FACES')
bm.to_mesh(me)
bm.free()

# Simplifica mantendo a forma.
dec = obj.modifiers.new('simplificar', 'DECIMATE')
dec.ratio = 0.35
bpy.context.view_layer.objects.active = obj
bpy.ops.object.modifier_apply(modifier=dec.name)
for p in me.polygons:
    p.use_smooth = True

# ------------------------------------------------------------------ cores por região (atributo de vértice)
V = np.array([v.co for v in me.vertices], dtype=np.float32)
vx, vy, vz = V[:, 0], V[:, 1], V[:, 2]
regions = {
    'lingua': np.abs(tongue(vx, vy, vz)),
    'epiglote': np.abs(epiglottis(vx, vy, vz)),
    'aritenoides': np.abs(arytenoids(V)),
    'palato': np.minimum(np.abs(soft_palate(V)), np.abs(fauces(vx, vy, vz))),
}
cores = {
    'mucosa': (0.66, 0.24, 0.23), 'lingua': (0.74, 0.38, 0.36), 'epiglote': (0.86, 0.60, 0.50),
    'aritenoides': (0.76, 0.40, 0.36), 'palato': (0.72, 0.30, 0.30), 'prega_vocal': (0.93, 0.88, 0.80),
}
col = np.tile(np.array(cores['mucosa'], np.float32), (len(V), 1))
for name, dist in regions.items():
    w = np.clip(1.0 - (dist - 0.0008) / 0.0022, 0, 1)[:, None]
    col = col * (1 - w) + np.array(cores[name], np.float32) * w
w_v = (np.exp(-((vz - Z_GLOTE) / 0.0015) ** 2) * (np.abs(vx) < 0.0065)
       * np.clip((vy - Y_COMISSURA_ANT + 0.0015) / 0.002, 0, 1) * np.clip((Y_PROC_VOCAL + 0.001 - vy) / 0.002, 0, 1))[:, None]
col = col * (1 - w_v) + np.array(cores['prega_vocal'], np.float32) * w_v
deep = np.clip((Z_GLOTE - vz) / 0.04, 0, 1)[:, None]          # traqueia escurece com a profundidade
col = col * (1 - 0.35 * deep)
attr = me.color_attributes.new('cor', 'FLOAT_COLOR', 'POINT')
attr.data.foreach_set('color', np.hstack([col, np.ones((len(V), 1), np.float32)]).ravel())

mat = bpy.data.materials.new('mucosa')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
vc = nt.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'cor'
nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.28
bsdf.inputs['Coat Weight'].default_value = 0.6
bsdf.inputs['Coat Roughness'].default_value = 0.08
bsdf.inputs['Subsurface Weight'].default_value = 0.12
bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.3, 0.2)
bsdf.inputs['Subsurface Scale'].default_value = 0.003
me.materials.append(mat)

# ------------------------------------------------------------------ integração com o paciente
body = bpy.data.objects['paciente']
bm = bmesh.new()
bm.from_mesh(body.data)
bm.faces.ensure_lookup_table()
# Bolso oral do MakeHuman: inundação a partir de uma face no fundo da boca, sem atravessar os lábios
# (y < -0,143) nem sair da região da boca. Assim a pele das bochechas nunca é atingida.
seed_pt = np.array([0.0, -0.095, 1.565])
cand = [f for f in bm.faces if abs(f.calc_center_median().x) < 0.04 and -0.143 < f.calc_center_median().y < -0.045
        and 1.525 < f.calc_center_median().z < 1.60]
seed = min(cand, key=lambda f: np.linalg.norm(np.array(f.calc_center_median()) - seed_pt))
inside, stack = {seed}, [seed]
while stack:
    f = stack.pop()
    for e in f.edges:
        for g in e.link_faces:
            c = g.calc_center_median()
            if g not in inside and c.y > -0.143 and abs(c.x) < 0.045 and 1.52 < c.z < 1.61:
                inside.add(g)
                stack.append(g)
pocket = list(inside)
bmesh.ops.delete(bm, geom=pocket, context='FACES')
bm.to_mesh(body.data)
bm.free()
print(f'bolso oral do MakeHuman removido: {len(pocket)} faces')
if 'lingua' in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects['lingua'], do_unlink=True)

# Pesos: palato/faringe alta → cabeça; assoalho/língua → mandíbula; laringe/traqueia → pescoço.
arm = bpy.data.objects['esqueleto']
groups = {n: obj.vertex_groups.new(name=n) for n in ('head', 'jaw', 'neck03', 'neck02', 'neck01')}
w_jaw = (np.clip((1.566 - vz) / 0.010, 0, 1) * np.clip((vz - 1.522) / 0.012, 0, 1)
         * np.clip((-0.062 - vy) / 0.010, 0, 1))
# Língua: presa à mandíbula; a base acompanha parcialmente (inserção no hioide).
on_tongue = np.abs(tongue(vx, vy, vz)) < 0.0025
w_jaw = np.where(on_tongue, interp(vz, [(1.505, 0.1), (1.528, 0.45), (1.545, 0.9), (1.556, 1.0)]), w_jaw)
w_head = np.clip((vz - 1.53) / 0.03, 0, 1) * (1 - w_jaw)
rest = 1 - w_jaw - w_head
w_n3 = rest * np.clip((vz - 1.49) / 0.03, 0, 1)
w_n2 = np.clip(rest - w_n3, 0, 1) * np.clip((vz - 1.43) / 0.04, 0, 1)
w_n1 = np.clip(rest - w_n3 - w_n2, 0, 1)
for name, w in (('jaw', w_jaw), ('head', w_head), ('neck03', w_n3), ('neck02', w_n2), ('neck01', w_n1)):
    for i in np.nonzero(w > 1e-3)[0]:
        groups[name].add([int(i)], float(w[i]), 'REPLACE')
obj.parent = arm
mod = obj.modifiers.new('esqueleto', 'ARMATURE')
mod.object = arm
print(f'via aérea final: {len(me.vertices)} vértices')
bpy.ops.wm.save_as_mainfile(filepath=OUT)
