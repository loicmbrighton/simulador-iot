"""Extrai do atlas Z-Anatomy as estruturas de cabeça, pescoço e via aérea.

Uso: python -I extrair_via_aerea.py <Startup.blend> <saida.blend>

Gera uma cena 'Airway' com 4 coleções (osso, dente, cartilagem, mole). Os modificadores
são aplicados e curvas (ex.: esôfago) viram malha. Scripts embutidos no atlas NÃO são executados.
"""
import re
import sys

import bpy

src, out = sys.argv[-2], sys.argv[-1]
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=src, load_ui=False)

TEETH = sorted(n for n in bpy.data.objects.keys()
               if re.match(r'^(Upper|Lower) .*(incisor|canine|premolar|molar tooth)\.[lr]$', n))
GROUPS = {
    'osso': ['Mandible', 'Maxilla.l', 'Maxilla.r', 'Palatine bone.l', 'Palatine bone.r', 'Hyoid bone',
             'Atlas (C1)', 'Axis (C2)'] + [f'Vertebra C{i}' for i in range(3, 8)],
    'dente': TEETH,
    'cartilagem': ['Thyroid cartilage', 'Cricoid cartilage', 'Arytenoid cartilage.l', 'Arytenoid cartilage.r',
                   'Corniculate cartilage.l', 'Corniculate cartilage.r', 'Epiglottis'],
    'mole': ['Tongue', 'Soft palate', 'Uvula of palate', 'Nasopharynx', 'Oropharynx', 'Laryngopharynx',
             'Trachea', 'Oesophagus', 'Palatine tonsil.l', 'Palatine tonsil.r', 'Thyroid gland',
             'Mucosa of nasal cavity'],
}

dg = bpy.context.evaluated_depsgraph_get()
copies = []
for group, names in GROUPS.items():
    for name in names:
        o = bpy.data.objects.get(name)
        if o is None:
            print('FALTANDO:', name)
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=False, depsgraph=dg)
        copies.append((group, name, me, o.matrix_world.copy()))

# Remove o atlas inteiro da memória para que as cópias fiquem com os nomes originais (sem ".001").
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scn = bpy.data.scenes.new('Airway')
cols = {}
for group, name, me, mw in copies:
    if group not in cols:
        cols[group] = bpy.data.collections.new(group)
        scn.collection.children.link(cols[group])
    me.name = name
    obj = bpy.data.objects.new(name, me)
    obj.matrix_world = mw
    cols[group].objects.link(obj)
    print(f'{group:<11}{name:<32}{len(me.vertices):>7} vértices')

bpy.data.libraries.write(out, {scn}, fake_user=True, compress=True)
print('Salvo em', out)
