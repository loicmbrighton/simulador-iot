"""Renders de validação da via aérea: corte sagital, visão laringoscópica, boca aberta e vista geral.

Uso: python -I renderizar_via_aerea.py <paciente_via_aerea.blend> <pasta_saida>
"""
import math
import sys

import bpy
import mathutils as M

src, outdir = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
scn = bpy.context.scene
arm = bpy.data.objects['esqueleto']
pb = arm.pose.bones
air = bpy.data.objects['via_aerea']
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.8, 0.83, 0.86, 1)
sun = bpy.data.objects.new('sol', bpy.data.lights.new('sol', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.9, 0, 0.6)
scn.collection.objects.link(sun)
lamp = bpy.data.objects.new('lampada', bpy.data.lights.new('lampada', 'POINT')); lamp.data.shadow_soft_size = 0.002
scn.collection.objects.link(lamp)
r = scn.render; r.engine = 'CYCLES'; scn.cycles.device = 'CPU'; scn.cycles.samples = 48; scn.cycles.use_denoising = True
scn.view_settings.view_transform = 'AgX'; r.resolution_x = r.resolution_y = 640
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam


def jaw(deg):
    pb['jaw'].rotation_mode = 'XYZ'; pb['jaw'].rotation_euler = (math.radians(deg), 0, 0)


def cut_copies():
    """Cópias das malhas (já posadas) cortadas no plano sagital, sem a metade x > 0."""
    import bmesh
    dg = bpy.context.evaluated_depsgraph_get()
    made = []
    for o in [o for o in scn.objects if o.type == 'MESH' and not o.name.startswith('corte_')]:
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
        me.transform(o.matrix_world)
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0.0005, 0, 0), plane_no=(1, 0, 0), clear_outer=True)
        bm.to_mesh(me); bm.free()
        c = bpy.data.objects.new('corte_' + o.name, me); scn.collection.objects.link(c); made.append(c.name)
    return set(made)


def shot(name, pos, target, lens=35, clip=0.002, up=(0, 0, 1), world=0.7, lamp_w=0.0, only=None):
    pos, target = M.Vector(pos), M.Vector(target)
    fwd = (target - pos).normalized(); upv = M.Vector(up)
    right = fwd.cross(upv).normalized(); upv = right.cross(fwd)
    cam.matrix_world = M.Matrix((right, upv, -fwd)).transposed().to_4x4() @ M.Matrix.Identity(4)
    cam.location = pos; cam.data.lens = lens; cam.data.clip_start = clip
    bg.inputs[1].default_value = world; sun.data.energy = 3 if world > 0 else 0
    lamp.location = pos + fwd * 0.004; lamp.data.energy = lamp_w
    for o in scn.objects:
        if o.type == 'MESH':
            o.hide_render = only is not None and o.name not in only
    r.filepath = f'{outdir}/{name}'; bpy.ops.render.render(write_still=True); print('ok', name)


shot('v2_via_aerea_isolada.png', (0.22, -0.20, 1.56), (0, -0.065, 1.50), 40, only={'via_aerea'})
shot('v3_laringoscopica.png', (0, -0.0565, 1.540), (0, -0.0615, 1.476), 24, up=(0, -1, 0), world=0.0, lamp_w=0.012)
shot('v4_adito_de_cima.png', (0, -0.060, 1.522), (0, -0.0615, 1.476), 30, up=(0, -1, 0), world=0.0, lamp_w=0.008)
cut = cut_copies()
sun.rotation_euler = (0, math.pi / 2, 0.25)
shot('v1_corte_sagital.png', (0.30, -0.08, 1.52), (0, -0.08, 1.52), 45, only=cut)
for n in cut:
    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
sun.rotation_euler = (0.9, 0, 0.6)
jaw(26)
shot('v5_boca_aberta.png', (0, -0.26, 1.565), (0, -0.07, 1.555), 50, lamp_w=0.25)
cut = cut_copies()
sun.rotation_euler = (0, math.pi / 2, 0.25)
shot('v6_corte_boca_aberta.png', (0.30, -0.09, 1.52), (0, -0.09, 1.52), 45, only=cut)
