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

- **Plataforma prioritária: PC** (navegador, teclado + mouse). Celular vem depois como versão
  adaptada (toque, gráficos reduzidos); VR fica como possibilidade futura (WebXR).
- **Três cenários selecionáveis no menu:** Sequência Rápida, Eletiva e Modo Easy. Regras, doses,
  diretrizes e pesos de erro em **`docs/CENARIOS.md`** (fonte da verdade clínica).
- **Paciente sempre com anatomia normal** (sem preditores de via aérea difícil). Não criar
  variações anatômicas (obeso, pescoço curto, trauma cervical etc.) sem pedido explícito.
- **Diretrizes:** Walls (SRI na emergência), DAS 2015 (eletiva e via aérea falha), PreVent 2019
  (BVM durante a SRI). Pontos controversos ficam configuráveis.

## Anatomia (Z-Anatomy)
Pipeline em `tools/anatomia/`:
1. `./baixar_z_anatomy.sh`: baixa o atlas e cria um venv com `bpy` (Blender como módulo Python) em `.cache/`.
2. `.cache/venv/bin/python -I extrair_via_aerea.py .cache/Z-Anatomy/Startup.blend ../../assets/fonte/via_aerea.blend`
3. `.cache/venv/bin/python -I renderizar_vistas.py ../../assets/fonte/via_aerea.blend <pasta>`: 6 vistas + `painel.png`.

Corpo do paciente: `gerar_paciente.py <mpfb2/src/mpfb/data> <assets extraídos> <saida.blend>` lê a malha-base,
os targets e os acessórios (.mhclo) do MakeHuman (CC0) **como dados**: homem, 40 anos, fenótipo misto, pele
texturizada, olhos, sobrancelhas, cílios, cabelo curto, dentes e língua. Não rodar o código do MPFB.
- Malha-base/targets: `git clone --depth 1 https://github.com/makehumancommunity/mpfb2`.
- Assets: `https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip`
  (~280 MB; o ambiente de nuvem "simulador-iot" libera `static.` e `files.makehumancommunity.org`).
- Pálpebras fechadas em definitivo (unidades `eye-*-closure`). Esqueleto "default" do MakeHuman (163 ossos,
  inclui `jaw`, `neck01-03`, `head`, `tongue00-07`) com pesos transferidos aos acessórios.
- `testar_poses.py`: boca aberta (rotação X positiva do `jaw`), posição olfativa (`neck01/02` flexão,
  `head` extensão) e corte sagital. Resultado em `docs/referencias/paciente_rig_v1.png`.
- **Achado:** a boca do MakeHuman é um "bolso" fechado, sem faringe/laringe.

Via aérea interna: `gerar_via_aerea.py <paciente.blend> <saida.blend>` (precisa de `scikit-image` no venv).
- Modela o **volume de ar** como SDF numa grade de 0,7 mm (cavidade oral, faringe, lúmen laríngeo com
  vestíbulo/pregas vestibulares/ventrículo/glote/subglote, traqueia com anéis, esôfago colapsado) e subtrai
  tecidos (língua, palato mole/úvula, pilares, coluna laríngea com adito inclinado, epiglote em ômega,
  prega glossoepiglótica, cuneiformes/corniculados). Superfície por marching cubes → objeto `via_aerea`.
- Marcos na linha média estão no topo do script (glote em z=1,4765, comissura anterior, processos vocais).
  O alinhamento direto Z-Anatomy→MakeHuman pelos dentes foi descartado (laringe sairia do pescoço);
  a via aérea é construída no espaço do MakeHuman com proporções anatômicas.
- Remove o "bolso" oral do MakeHuman por inundação a partir do fundo da boca (não atravessa os lábios)
  e apaga o acessório `lingua` (a língua agora faz parte da via aérea).
- Pesos: palato/faringe alta → `head`; língua → `jaw` (base parcial); laringe/traqueia → `neck01-03`.
- Cores por região em atributo de vértice `cor` (mucosa, língua, epiglote, aritenoides, palato, pregas vocais).
- `renderizar_via_aerea.py`: visão laringoscópica, ádito, cortes sagitais, boca aberta, via aérea isolada.
- Resultado salvo em `assets/fonte/paciente.blend` (paciente completo) e `docs/referencias/via_aerea_v1.png`.

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

## Código (Fase 0: protótipo de controle)
```
src/
├── main.ts / app.ts      # entrada, estados (menu/jogo/pausa), loop, câmera, lógica de controle
├── config.ts             # sistema de coordenadas, cenários, alcance, postura do médico, velocidades
├── core/world.ts         # sala, maca, paciente provisório (manequim), bandeja, monitor, luzes, colisões
├── core/materials.ts     # materiais PBR compartilhados
├── hands/hand.ts, ik.ts  # mãos procedurais (dedos que fecham na empunhadura) + IK de dois ossos
├── tools/models.ts       # ferramentas procedurais com medidas reais
├── tools/tools.ts        # definições, teclas, pose "pronta", posição na bandeja, empunhadura
├── input/                # entrada bruta (input.ts) e mapeamentos puros testáveis (controls.ts)
├── game/exercise.ts      # treino de precisão (alvos na face/pescoço)
└── ui/ui.ts              # menu (cenário + esquema de controle), HUD, ajuda
```
- Coordenadas em metros: +X = esquerda do médico/paciente, +Y = cima, +Z = pés do paciente.
- Dois esquemas de controle selecionáveis (menu ou tecla V): **Duas mãos** (WASD = esquerda,
  mouse = direita) e **Mão ativa** (mouse controla a mão ativa, Tab alterna). O mouse posiciona a
  mão por raycast num plano horizontal cuja altura muda com a roda; não usa pointer lock.
- `window.__sim` expõe o App para testes e depuração; `debugView` troca para câmera livre.

Comandos:
- `npm run dev`: servidor local. `npm test`: testes (Vitest). `npm run typecheck`.
- `npx vite build && node tools/screenshots.mjs <pasta>`: screenshots de inspeção via Playwright.
- `npm run build:artifact`: gera `dist-artifact/pagina.html` (fragmento de arquivo único) que é publicado como a
  página de teste do Claude: https://claude.ai/artifact/UQRGchnukeKB5bwgbfQNjk

## Fluxo de trabalho
- Sessões do Claude são efêmeras: commitar e dar push com frequência.
- Arquivos de origem `.blend` ficam em `assets/fonte/`; os `.glb` otimizados para o jogo vão para `public/` (a definir).
- Validação clínica é do usuário (médico). Na dúvida sobre conduta, perguntar em vez de assumir.
