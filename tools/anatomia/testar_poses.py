"""Testa o esqueleto do paciente: pálpebras, abertura da boca, corte sagital e posição olfativa.

Uso: python -I testar_poses.py <paciente.blend> <pasta_saida>
"""
import bpy, sys, math, mathutils as M
src, outdir = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)
scn = bpy.context.scene
arm = bpy.data.objects['esqueleto']
pb = arm.pose.bones
def world_tail(name):
    bpy.context.view_layer.update(); return arm.matrix_world @ pb[name].tail
def rot(name, deg):
    pb[name].rotation_mode = 'XYZ'; pb[name].rotation_euler = (math.radians(deg), 0, 0)
# Descobrir sinais: queixo deve descer ao abrir; topo da cabeça deve ir para trás (+Y) na extensão.
c0 = world_tail('jaw').copy(); rot('jaw', 10); s_jaw = 1 if world_tail('jaw').z < c0.z else -1; rot('jaw', 0)
h0 = world_tail('head').copy(); rot('head', 10); s_ext = 1 if world_tail('head').y > h0.y else -1; rot('head', 0)
print('sinais', s_jaw, s_ext)
for o in scn.objects:
    if o.name == 'paciente':
        sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = 1
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.83, 0.86, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.8
for r_, e in (((0.9, 0, 0.6), 3.2), ((1.1, 0, -2.4), 1.0)):
    L = bpy.data.objects.new('l', bpy.data.lights.new('l', 'SUN')); L.data.energy = e; L.rotation_euler = r_; scn.collection.objects.link(L)
r = scn.render; r.engine = 'CYCLES'; scn.cycles.device = 'CPU'; scn.cycles.samples = 40; scn.cycles.use_denoising = True
scn.view_settings.view_transform = 'AgX'; r.resolution_x = r.resolution_y = 640
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam
def shot(name, pos, target, lens=60, clip=0.01):
    cam.location = pos; cam.rotation_euler = (M.Vector(target) - M.Vector(pos)).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = lens; cam.data.clip_start = clip
    r.filepath = f'{outdir}/{name}'; bpy.ops.render.render(write_still=True); print('ok', name)
head = arm.matrix_world @ pb['head'].head
mouth = arm.matrix_world @ pb['jaw'].head
print('cabeca', tuple(round(x,3) for x in head), 'boca', tuple(round(x,3) for x in mouth))
F = M.Vector((0, -1, 0))  # frente do paciente
shot('r1_palpebras.png', mouth + M.Vector((0.18, -0.42, 0.12)), mouth + M.Vector((0, 0, 0.06)))
rot('jaw', 24 * s_jaw)
shot('r2_boca_aberta.png', mouth + M.Vector((0.0, -0.4, 0.05)), mouth + M.Vector((0, -0.05, -0.02)))
shot('r3_corte_sagital.png', mouth + M.Vector((0.45, -0.02, -0.02)), mouth + M.Vector((0, -0.02, -0.02)), 50, clip=0.448)
rot('jaw', 0)
rot('neck01', -12 * s_ext); rot('neck02', -6 * s_ext); rot('head', 28 * s_ext); rot('jaw', 20 * s_jaw)
shot('r4_posicao_olfativa.png', head + M.Vector((0.75, -0.1, -0.08)), head + M.Vector((0, -0.05, -0.1)), 45)
