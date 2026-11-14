"""Renderiza vistas de inspeção do recorte da via aérea e monta um painel.

Uso: python -I renderizar_vistas.py <via_aerea.blend> <pasta_saida>

Cores provisórias só para diferenciar tecidos: osso marfim, dente branco,
cartilagem azulada, epiglote amarela, tecido mole rosa.
"""
import sys

import bpy
import mathutils as M

src, outdir = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
scn = bpy.data.scenes['Airway']
objs = {o.name: o for o in scn.objects if o.type == 'MESH'}


def bbox(names):
    pts = [objs[n].matrix_world @ M.Vector(c) for n in names for c in objs[n].bound_box]
    mn = M.Vector([min(p[i] for p in pts) for i in range(3)])
    mx = M.Vector([max(p[i] for p in pts) for i in range(3)])
    return (mn + mx) / 2, max(mx - mn)


# Orientação anatômica derivada dos próprios ossos (o atlas está em pé, unidades em metros).
c_head, s_head = bbox([n for n in objs if n not in ('Oesophagus', 'Trachea')])
front = bbox(['Mandible'])[0] - bbox(['Vertebra C3'])[0]
front.z = 0
front.normalize()
up = M.Vector((0, 0, 1))
left = front.cross(up)


def material(name, rgb, rough=0.4):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


MATS = {'osso': material('osso', (0.82, 0.76, 0.62), 0.5), 'dente': material('dente', (0.95, 0.93, 0.86), 0.25),
        'cartilagem': material('cartilagem', (0.70, 0.80, 0.88), 0.35), 'mole': material('mole', (0.78, 0.36, 0.36), 0.3)}
for col in scn.collection.children:
    for o in col.objects:
        o.data.materials.clear()
        o.data.materials.append(material('epiglote', (0.95, 0.75, 0.35), 0.3) if o.name == 'Epiglottis' else MATS[col.name])
        for p in o.data.polygons:
            p.use_smooth = True

world = bpy.data.worlds.new('mundo')
scn.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.9, 0.92, 0.95, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.8
sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (front + up * 2 + left * 0.5).to_track_quat('Z', 'Y').to_euler()
scn.collection.objects.link(sun)

r = scn.render
r.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 48
scn.cycles.use_denoising = True
r.resolution_x = r.resolution_y = 900
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.clip_start = 0.001
scn.collection.objects.link(cam)
scn.camera = cam


def shot(fname, pos, target, lens=50, hide=(), ghost=(), roll=False):
    """hide: objetos ocultos; ghost: objetos semitransparentes; roll: gira a câmera 180°."""
    for o in objs.values():
        o.hide_render = o.name in hide
    original = {n: objs[n].data.materials[0] for n in ghost}
    for n in ghost:
        g = original[n].copy()
        g.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.25
        objs[n].data.materials[0] = g
    q = (target - pos).to_track_quat('-Z', 'Y')
    if roll:
        q = q @ M.Quaternion((0, 0, 1), 3.14159265)
    cam.location, cam.rotation_euler, cam.data.lens = pos, q.to_euler(), lens
    r.filepath = f'{outdir}/{fname}'
    bpy.ops.render.render(write_still=True, scene=scn.name)
    for n in ghost:
        objs[n].data.materials[0] = original[n]
    print('ok', fname)


TEETH = [n for n in objs if any(k in n for k in ('incisor', 'canine', 'molar'))]
PHARYNX = ['Nasopharynx', 'Oropharynx', 'Laryngopharynx']
UPPER = ['Mandible', 'Tongue', 'Mucosa of nasal cavity', 'Maxilla.l', 'Maxilla.r', 'Palatine bone.l',
         'Palatine bone.r', 'Soft palate', 'Uvula of palate'] + TEETH
c_lar, s_lar = bbox(['Thyroid cartilage', 'Cricoid cartilage', 'Arytenoid cartilage.l', 'Epiglottis'])
c_inlet, _ = bbox(['Epiglottis', 'Arytenoid cartilage.l', 'Arytenoid cartilage.r'])
c_tongue, s_tongue = bbox(['Tongue', 'Epiglottis', 'Hyoid bone'])

VIEWS = [
    ('1_tres_quartos.png', '1. Visão geral (3/4)',
     lambda: shot('1_tres_quartos.png', c_head + (front * 0.8 + left * 0.6 + up * 0.25).normalized() * s_head * 2.6, c_head)),
    ('2_lateral.png', '2. Lateral (mandíbula e faringe transparentes)',
     lambda: shot('2_lateral.png', c_head + left * s_head * 2.6, c_head, ghost=PHARYNX + ['Mandible'])),
    ('3_laringe.png', '3. Laringe: cartilagens, hioide, traqueia',
     lambda: shot('3_laringe.png', c_lar + (front * 0.6 - left * 0.5 + up * 0.35).normalized() * s_lar * 3.2, c_lar,
                  hide=UPPER + ['Thyroid gland', 'Palatine tonsil.l', 'Palatine tonsil.r'], ghost=PHARYNX)),
    ('4_lingua_epiglote.png', '4. Língua × epiglote (lateral)',
     lambda: shot('4_lingua_epiglote.png', c_tongue + left * s_tongue * 2.8, c_tongue,
                  ghost=PHARYNX + ['Mandible'], hide=['Mucosa of nasal cavity', 'Thyroid gland'])),
    ('5_entrada_laringe.png', '5. Entrada da laringe vista de cima',
     lambda: shot('5_entrada_laringe.png', c_inlet + up * s_lar * 1.6 + front * s_lar * 0.72, c_inlet, lens=35,
                  hide=UPPER + ['Nasopharynx', 'Atlas (C1)', 'Axis (C2)'], ghost=['Oropharynx', 'Laryngopharynx'], roll=True)),
    ('6_lingua_faringe.png', '6. Língua + faringe (esquemáticas)',
     lambda: shot('6_lingua_faringe.png', c_tongue + (left * 0.9 + up * 0.5 + front * 0.4).normalized() * s_tongue * 2.6,
                  c_tongue, hide=[n for n in objs if n not in {'Tongue', 'Epiglottis', 'Hyoid bone', 'Oropharynx', 'Laryngopharynx'}])),
]
for _, _, render in VIEWS:
    render()

try:
    from PIL import Image, ImageDraw, ImageFont
    W, PAD = 600, 50
    sheet = Image.new('RGB', (W * 3, (W + PAD) * 2), 'white')
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
    except OSError:
        font = ImageFont.load_default()
    for k, (fname, title, _) in enumerate(VIEWS):
        x, y = (k % 3) * W, (k // 3) * (W + PAD)
        sheet.paste(Image.open(f'{outdir}/{fname}').convert('RGB').resize((W, W)), (x, y + PAD))
        draw.text((x + 12, y + 12), title, fill=(30, 30, 30), font=font)
    sheet.save(f'{outdir}/painel.png')
    print('ok painel.png')
except ImportError:
    print('Pillow ausente: painel não gerado')
