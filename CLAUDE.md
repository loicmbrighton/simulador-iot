# Simulador IOT: simulador 3D de intubação orotraqueal

Simulação em primeira pessoa: o usuário controla as duas mãos do médico (WASD = mão esquerda,
mouse = mão direita no PC; controles por toque no celular) e executa a intubação orotraqueal
completa: preparo e montagem do material, posicionamento, pré-oxigenação, drogas, laringoscopia,
passagem do tubo, confirmação e fixação. Expansões futuras: cricotireoidostomia e traqueostomia.

Idioma do projeto, da interface e da documentação: **português (Brasil)**.

## Decisões tomadas
- **Stack:** Three.js + TypeScript + Vite (navegador). Física com Rapier, som com Web Audio API,
  interface em HTML sobre o canvas. Testes com Vitest e screenshots com Playwright.
- **Visual:** semi-realista, um pouco acima de jogos de cirurgia casuais em primeira pessoa:
  materiais PBR, iluminação por HDRI, oclusão de ambiente e iluminação global pré-calculadas
  (lightmaps), reflexos, mucosa úmida com especular e aproximação de subsurface scattering.
  A referência é só de nível gráfico; arte, personagens e design são originais.
- **Prioridade máxima:** anatomia e física **convincentes** (deformação da língua, forma e
  levantamento da epiglote, visão glótica, contato com dentes). Fotorrealismo vem depois.
- **Uso:** pessoal e apresentações acadêmicas, sem fins comerciais. Manter `CREDITOS.md`
  atualizado sempre que entrar um asset de terceiros.

## Decisões pendentes
- Plataforma prioritária (PC, celular, VR) e protocolo clínico de referência.

## Anatomia (Z-Anatomy)
Pipeline em `tools/anatomia/`:
1. `./baixar_z_anatomy.sh`: baixa o atlas e cria um venv com `bpy` (Blender como módulo Python) em `.cache/`.
2. `.cache/venv/bin/python -I extrair_via_aerea.py .cache/Z-Anatomy/Startup.blend ../../assets/fonte/via_aerea.blend`
3. `.cache/venv/bin/python -I renderizar_vistas.py ../../assets/fonte/via_aerea.blend <pasta>`: 6 vistas + `painel.png`.

O atlas é dado de terceiros: abrir sempre com `-I` e sem executar os scripts embutidos (já tratado nos scripts).

Avaliação do recorte (`docs/referencias/z_anatomy_recorte_inicial.png`):
- **Usar como está** (após reduzir polígonos): mandíbula, maxila, palatinos, dentes individuais,
  cartilagens da laringe (tireoide, cricoide, aritenoides, corniculadas, epiglote), hioide,
  traqueia, vértebras C1–C7, glândula tireoide.
- **Refazer:** língua (malha pobre e facetada, precisa deformar) e faringe (placas esquemáticas, não é tubo).
- **Ausente, modelar do zero:** pregas vocais e vestibulares, pregas ariepiglóticas, valécula,
  seios piriformes, mucosa contínua oral, faríngea e laríngea, lábios, bochechas e pele.
- Estratégia: o Z-Anatomy é o **esqueleto de referência** (posições e proporções); a mucosa e os
  tecidos moles deformáveis são modelados por script por cima dele.

## Fluxo de trabalho
- Sessões do Claude são efêmeras: commitar e dar push com frequência.
- Arquivos de origem `.blend` ficam em `assets/fonte/`; os `.glb` otimizados para o jogo vão para `public/` (a definir).
- Validação clínica é do usuário (médico). Na dúvida sobre conduta, perguntar em vez de assumir.
