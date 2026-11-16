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

## Foco atual: Modo Easy point-and-click
**Leia `docs/MODO_EASY.md` antes de qualquer trabalho.** Resumo: só o Modo Easy por enquanto; mãos em camada
FPS (modelo híbrido); usuário só pega instrumentos e clica no lugar certo; animações automáticas com cortes
de câmera; Tab troca a mão ativa; colinha na tela; erro de conduta pisca em vermelho e piora os sinais vitais.
A sequência (hoje até a laringoscopia) está definida lá. Sequência Rápida e Eletiva em standby.

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
- Visualizador 3D: `visualizador/index.html` + `public/paciente.json` (publicar junto como `paciente.json`) (glTF em JSON com dados embutidos;
  páginas publicadas não servem `.glb`). Gerar com `exportar_glb.py` e converter o .glb para JSON (buffer em
  base64). Publicado em https://claude.ai/artifact/DvjkakWW9com4a3CFLRHje

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

## Código (Modo Easy: etapas 1 a 5 da sequência)
```
src/
├── main.ts / app.ts      # entrada, estados (menu/jogo/pausa), loop, modos de câmera (médico, corte lateral,
│                         # visão interna), mãos em repouso (camada FPS), ações no paciente, cursor e clique
├── config.ts             # coordenadas, cenários (`disponivel`), postura do médico, VIEWMODEL, LOOK, VITALS, SHOTS
├── core/world.ts         # sala, maca, bandeja, monitor (sinais vitais), luzes, landmarks
├── core/patient.ts       # paciente real: pose barata por quadro (`applyPose`: jaw, flex, ext, tongue), posição
│                         # neutra × olfativa, coxim, lençol, landmarks do corpo e da via aérea, morph da língua
├── core/materials.ts     # materiais PBR compartilhados
├── hands/hand.ts, ik.ts  # mãos procedurais (fechamento por dedo, visibilidade, camada) + IK de dois ossos
├── tools/models.ts       # instrumentos procedurais com medidas reais (inclui o coxim)
├── tools/tools.ts        # definições, pose "pronta", lugar na bandeja, empunhadura por instrumento
├── input/                # entrada bruta (input.ts) e mapeamentos puros testáveis (controls.ts)
├── game/easy.ts          # regras do Modo Easy: `avaliar` (ação × dica × erro) e a colinha (`PASSOS`); puro, testado
├── game/picking.ts       # o que está sob o cursor (raio × esfera/elipsoide/caixa, com prioridade); puro, testado
├── game/anim.ts          # `Sequencia` de fases (início/progresso/fim): base das animações automáticas
├── game/highlight.ts     # destaque: brilho no instrumento, anel pulsante em pontos do paciente
└── ui/ui.ts              # menu, HUD (mãos, sinais vitais, colinha), dica do cursor, piscada vermelha, legenda, roda
```
- Coordenadas em metros: +X = esquerda do médico/paciente, +Y = cima, +Z = pés do paciente.
- **Mãos (modelo híbrido):** em repouso ficam presas à câmera e são desenhadas na camada 1, numa segunda
  passada com a profundidade limpa (nunca atravessam a cena). **Pegar e devolver instrumentos é 100% na
  camada FPS** (decisão do usuário): a mão não vai até a bandeja; ela desce um pouco, o instrumento aparece
  empunhado e a mão sobe (`App.swap`). A mão só passa para a camada 0 (mundo, com oclusão e sombra) quando
  mexe no paciente (`App.act(..., true)`) ou num corte de câmera. `pin[lado]` prende a mão a uma pose do
  mundo recalculada a cada quadro (ex.: a esquerda segurando o laringoscópio na boca).
- **Movimento das mãos:** `App.caminho(lado, pontos)` gera a trajetória (velocidade contínua nos pontos com
  `passa`, mínimo jerk entre paradas, arco, rotação adiantada); `ir` é o caso de um ponto só e `seguir` prende
  a mão a uma pose que se move. Não voltar a encadear interpolações lineares: foi o que deixou as mãos
  "mecânicas". Curvas em `src/game/anim.ts` (`minJerk`, `hermite`).
- **Câmera (`App.mode`):** `medico` (visão padrão), `lateral` (corte do coxim/posição olfativa, `SHOTS.lateral`)
  e `interna` (visão pela boca na laringoscopia, `SHOTS.interna`). `App.cut` é a `Sequencia` do corte e
  bloqueia os comandos enquanto roda; `ui.blink()` escurece a tela na troca.
- **Paciente:** `applyPose` só mexe em ossos e no morph (pode rodar todo quadro). `flex` (pescoço) e `ext`
  (cabeça) vão de 0 (neutra, cabeça no colchão) a 1 (olfativa sobre o coxim); `ext` > 1 = extensão extra da
  laringoscopia. Depois de mudar `ext` com o coxim no lugar, chamar `seat()` (senão a cabeça flutua ou
  afunda no coxim). A medição cara (`layout`) roda uma vez. Abaixo da cricoide os pesos da traqueia passam para o
  tórax (`anchorTrachea`). `incisor()`, `nuca()`, `airLandmark()` e `glottisFrame()` dão pontos vivos.
- **Laringoscópio:** o modelo é espelhado em X e empunhado com o cabo para cima e a lâmina embaixo (uso real;
  a flange fica à esquerda do operador). `App.prepareSight` calcula a linha de visão (incisivos superiores →
  entre a glote e a entrada do esôfago), a pose final da lâmina e a deformação dos tecidos
  (`Patient.deformTissue`, ligada por `pose.tongue`); `App.scopePose(u, lift)` dá a pose ao longo da inserção.
  Constantes em `VISAO` (app.ts). A deformação tem de empurrar a língua toda para o mesmo lado (anterior):
  empurrar radialmente fecha o canal com uma parede de triângulos esticados; suavizar o deslocamento pela
  malha também piorou. Triângulos muito esticados no istmo deixam de ser desenhados (índice alternativo) e,
  na visão pela boca, a pele vira mucosa escura (`setInsideView`) e a periferia escurece (`setScopeView`).
  A placa de "assoalho da boca" da malha de dentes do MakeHuman foi removida (`trimMouthFloor`): tapava a visão.
- **Aproximação do médico:** `App.closeUp` liga durante as ações na boca; a visão vai para perto da boca
  (`APROXIMA`). Os ombros seguem o corpo (`bodyEye`), não a câmera, exceto na visão pela boca.
- **Visão pela boca:** `Patient.placeVocalFolds`/`placeEsophagus` desenham as pregas vocais e a entrada do
  esôfago; `ui.setLabels` põe os nomes na tela (tecla L).
- **Depuração visual:** `debugSection(x)` corta a cena num plano sagital e `debugMarks(pontos)` marca pontos;
  foi o que permitiu acertar a laringoscopia (olhar o corte, não adivinhar).
- **Controles:** mouse aponta (destaque + dica), clique age com a mão ativa, Tab troca a mão ativa,
  WASD ou botão direito olham em volta, setas inclinam o corpo, X recentraliza, H ajuda, Esc pausa
  (na visão interna, Esc desfaz a laringoscopia).
- A bandeja fica à direita do paciente, na altura do ombro, dentro da visão padrão (tudo alcançável só
  com o cursor). Em ações no paciente além do alcance o braço é alongado a partir do ombro (fora da tela).
- Nomes de ossos no three.js perdem o ponto (`upperarm01.L` → `upperarm01L`; GLTFLoader sanitiza).
- A página publicada bloqueia fetch de `data:`/`blob:`: o glTF é baixado por fetch relativo e montado como
  .glb em memória (`downloadPatient`); publicar `pagina.html` com `paciente.json` como arquivo de apoio.
- `window.__sim` expõe o App para testes e depuração: `debugView` (câmera livre), `frames` (contador de
  quadros), `timeScale` (acelera as animações), `animating`, `equip(lado, id)`, `click({ tipo })`,
  `debugSection`, `debugMarks`.
- O renderizador por software dos testes é muito lento na visão interna (a malha da via aérea cobre a tela):
  esperar por quadros/estado, não por tempo, e usar timeouts longos.

Comandos:
- `npm run dev`: servidor local. `npm test`: testes (Vitest). `npm run typecheck`.
- `npx vite build && node tools/screenshots.mjs <pasta>`: screenshots de inspeção via Playwright.
- `npm run build:artifact`: gera `dist-artifact/pagina.html` (fragmento de arquivo único) que é publicado como a
  página de teste do Claude: https://claude.ai/artifact/UQRGchnukeKB5bwgbfQNjk

## Fluxo de trabalho
- Sessões do Claude são efêmeras: commitar e dar push com frequência.
- Arquivos de origem `.blend` ficam em `assets/fonte/`; os `.glb` otimizados para o jogo vão para `public/` (a definir).
- Validação clínica é do usuário (médico). Na dúvida sobre conduta, perguntar em vez de assumir.
