"""Exporta o paciente (corpo, acessórios, via aérea e esqueleto) para .glb, com texturas reduzidas.

Uso: python -I exportar_glb.py <paciente.blend> <saida.glb>
"""
import sys

import bpy

SRC, OUT = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=SRC, load_ui=False)

# Texturas: pele em 2048 px, demais em 1024 px (o .glb fica com poucos MB).
for img in bpy.data.images:
    if img.size[0] == 0:
        continue
    limit = 2048 if 'skinned' in img.name or 'lightskinned' in img.name else 1024
    if max(img.size) > limit:
        f = limit / max(img.size)
        img.scale(int(img.size[0] * f), int(img.size[1] * f))
        img.pack()

air = bpy.data.objects['via_aerea']
air.data.color_attributes.active_color = air.data.color_attributes['cor']

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_yup=True,
    export_skins=True,
    export_animations=False,
    export_vertex_color='ACTIVE',
    export_image_format='AUTO',
    export_apply=False,
)
print('ok', OUT)
