# Modo Easy v1: especificação (decidida com o usuário)

## Escopo
- **Só o Modo Easy** por enquanto. Sequência Rápida e Eletiva ficam em standby (bloqueadas no menu como
  "em breve"); as regras delas continuam em `docs/CENARIOS.md`.
- O simulador vira **point-and-click**: o usuário só pega os instrumentos na ordem certa e clica no lugar
  certo. Os movimentos (abrir a boca, inserir a lâmina, rebater a língua, passar o tubo etc.) são
  **animações automáticas** disparadas pelo clique. O trabalho principal é deixar essas animações boas.

## Mãos: modelo híbrido (estilo FPS)
Motivo: bugs da Fase 0. Ao pegar instrumentos o braço comprimia/atrapalhava a visão; a mão ia fundo demais
(até o abdome) por ter movimento 3D livre.
1. **Repouso:** braços e mãos numa camada própria presa à câmera (viewmodel), na parte de baixo da tela,
   segurando o instrumento atual. Nunca esticam nem atravessam a maca.
2. **Mirar:** o mouse move um cursor; o que é clicável sob ele (instrumento na bandeja, boca, glote,
   fio-guia, balão-piloto, conector do tubo, cabeça) ganha destaque e uma dica ("Clique: inserir laringoscópio").
3. **Agir:** no clique, a mão sai da camada FPS e executa a animação no mundo 3D (com oclusão correta);
   no fim volta para a tela.
   **Só ações no paciente** (abrir a boca, inserir a lâmina, passar o tubo etc.) saem da camada FPS.
   Pegar e devolver instrumentos fica 100% na camada FPS, estilo Minecraft: o instrumento some da bandeja
   e aparece na mão com uma animação leve; a mão **não** se estica até a bandeja (fica feio).
4. **Tab** troca a mão ativa (destacada na HUD). **Clique** age com a mão ativa. Pegar um instrumento da
   bandeja coloca-o na mão ativa.
- Remove o controle livre das mãos (WASD/mouse em 3D) da Fase 0; WASD/setas podem ficar para olhar/inclinar.

## Sequência correta (v2, decidida com o usuário)
Paciente já sedado, relaxado e monitorizado; material na bandeja (o coxim é um instrumento da bandeja);
laringoscópio já montado. O paciente começa com a cabeça em posição **neutra**, apoiada no colchão.

| # | Mão | Ação do usuário | O que acontece |
|---|---|---|---|
| 1 | qualquer | Pegar o coxim | Aparece na mão (camada FPS) |
| 2 | a do coxim | Clicar na cabeça | **Corte para a vista lateral**: a cabeça é erguida, o coxim desliza sob o occipício, a cabeça é estendida (posição olfativa); legenda explica; volta à visão do médico |
| 3 | esquerda | Pegar o laringoscópio | Aparece na mão; a luz da lâmina acende |
| 4 | direita, livre | Clicar na boca | Mão vai à boca (gesto de tesoura) e a mandíbula abre |
| 5 | esquerda | Clicar na boca com o laringoscópio | Lâmina entra pela direita, língua comprimida contra a lâmina (animação simples), ponta na valécula, cabeça um pouco mais estendida, tração no eixo do cabo; **corte para a visão pela boca** |

**Visão pela boca** (decisão do usuário: não tão aproximada, e mostrando o esôfago): a câmera fica dentro da
boca, sobre a linha que vai da borda dos incisivos superiores até um ponto entre a glote e a parede posterior da
hipofaringe, a cerca de 15 cm da laringe. Na imagem (anterior para cima): a lâmina em cima, a glote, as
aritenoides e, logo abaixo delas, a **entrada do esôfago** como uma abertura escura. A lâmina traciona a
laringe para a frente, o que abre o espaço atrás das aritenoides. Como na malha o esôfago é colapsado (uma
fenda que de longe não se lê como abertura), a entrada é reforçada por uma marca escura (`esophagusMark`,
posicionada por raios da câmera em `App.findEsophagus`). A periferia é escurecida como o campo visto através
da boca aberta (`ui.setScopeView`). A ideia é que, na etapa do tubo, o usuário possa errar e intubar o esôfago.
A mão esquerda segura o laringoscópio; a mão direita troca de instrumento por uma **roda de
seleção** na tela (tubo, aspirador, seringa, AMBU; centro = soltar). **Esc** sai dessa visão e desfaz a
laringoscopia (a lâmina sai, a boca continua aberta). Fora dela, Esc pausa.

As etapas seguintes (passar o tubo, fio-guia, retirar o laringoscópio, cuff, AMBU/ventilação e confirmação)
**ainda não têm o visual decidido**: refinar bem as etapas 1 a 5 antes de seguir.

### Colinha e erros
- **Colinha** no canto esquerdo: a sequência na ordem, com os passos cumpridos marcados e o atual em destaque.
- **Erro de conduta** = tentar agir **no paciente** com o instrumento errado, com a mão errada ou fora de
  ordem: a **tela pisca em vermelho**, aparece o motivo e os **sinais vitais pioram** (FC sobe, SpO₂ cai;
  valores em `VITALS`, `src/config.ts`). Exemplos: laringoscópio na mão direita; laringoscópio com a boca
  fechada; qualquer coisa na boca antes do coxim e da posição olfativa; coxim na boca.
- **Não é erro** (no máximo uma dica neutra): pegar o instrumento errado, devolver, clicar na cabeça com a
  mão livre, tentar abrir a boca com a mão esquerda, repetir algo já feito.
- As regras ficam em `src/game/easy.ts` (`avaliar`, puro e testado em `tests/easy.test.ts`).
- Pendências futuras: ausculta e fixação do tubo; tempo e cliques extras no fim.

## Ordem de implementação
1. Mãos na camada FPS + sistema de cursor/destaque/clique + Tab. Menu só com Modo Easy ativo. **(feito)**
2. Etapas 1 a 5 da tabela acima, colinha e erros. **(primeira versão feita; em refinamento com o usuário)**
3. Etapas seguintes (tubo em diante): aguardando o usuário decidir o visual.
4. Publicar na página de teste a cada entrega (`npm run build:artifact`; ver `CLAUDE.md`).

## Mãos: como deixar o movimento menos mecânico
Queixa do usuário: as animações das mãos (coxim, laringoscópio etc.) estavam feias e mecânicas. Frentes:
1. **Movimento procedural melhor (feito):** trajetórias contínuas por pontos de passagem (`App.caminho`), perfil
   de mínimo jerk entre paradas, leve arco no percurso, rotação que se adianta à posição, dedos que fecham em
   sequência, balanço de respiração em repouso, o médico se debruça enquanto age, cabeça do paciente reage, e
   os cortes de câmera têm um escurecimento rápido. A coreografia do coxim foi refeita (uma mão ergue a cabeça
   pelo occipício, a outra desliza o coxim, depois a mão vai à fronte e estende a cabeça).
2. **Mãos de verdade (proposto, não feito):** trocar as mãos de cápsulas por uma malha com esqueleto (dá para
   gerar do MakeHuman, CC0, como o paciente), com poses de dedos por instrumento. É o maior ganho visual.
3. **Gestos gravados (proposto, não feito):** o usuário faz os gestos diante da webcam (rastreamento de mãos no
   navegador) e eles viram as animações. É o caminho mais fiel à técnica real.

## Estado atual
- Etapas 1 a 5 funcionando de ponta a ponta (`tools/screenshots.mjs` percorre tudo com mouse e teclado e
  confere o estado a cada passo). Detalhes técnicos no `CLAUDE.md`, seção "Código".
- **Laringoscopia (geometria):** no modelo, a linha dos incisivos superiores à glote atravessa a base da língua
  e a epiglote. `App.prepareSight` calcula essa linha, posiciona a lâmina anterior a ela e deforma os tecidos
  moles: língua e parede anterior da faringe são comprimidas contra a lâmina, a epiglote dobra pela base e o
  palato mole cede para trás. Para a linha passar entre os dentes a cabeça estende mais um pouco (`EXT_LAMINA`).
- **Posição olfativa:** os ângulos foram aumentados para a face ficar ~13° estendida (antes ficava horizontal).
  Conferir com o usuário se o resultado no corte lateral está de acordo.
- A posição neutra é achada por busca (extensão do pescoço até o occipício tocar o colchão). A via aérea fica
  oculta fora da posição olfativa, porque nas poses extremas ela não acompanha a pele do pescoço.
- Sinais vitais são didáticos (não há modelo fisiológico): cada erro soma `VITALS.erro`.
- **Ainda simples:** mãos de cápsulas (ver acima); gesto de tesoura aproximado; a mucosa esticada pela lâmina
  não tem física; a entrada do esôfago é só um funil escuro atrás das aritenoides (está colapsada na malha).
- Ainda aguardando o retorno do usuário sobre a anatomia da visão laringoscópica (visualizador publicado).
