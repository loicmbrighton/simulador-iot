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
| 5 | esquerda | Clicar na boca com o laringoscópio | Lâmina entra pela direita, língua rebatida para a esquerda (animação simples), ponta na valécula, tração no eixo do cabo; **corte para a visão de dentro da boca** (glote) |

Na **visão interna**: a mão esquerda segura o laringoscópio; a mão direita troca de instrumento por uma
**roda de seleção** na tela (tubo, aspirador, seringa, AMBU; centro = soltar). **Esc** sai dessa visão e
desfaz a laringoscopia (a lâmina sai, a boca continua aberta). Fora da visão interna, Esc pausa.

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

## Estado atual
- Etapas 1 a 5 funcionando de ponta a ponta (`tools/screenshots.mjs` percorre tudo com mouse e teclado e
  confere o estado a cada passo). Detalhes técnicos no `CLAUDE.md`, seção "Código".
- **O que ainda é simples e pode ser refinado:** a mão que abre a boca (gesto de tesoura aproximado); as mãos
  no corte lateral (uma na lateral da cabeça, outra empurrando o coxim); a língua (morph que desloca a
  língua para a esquerda e a afunda, sem física); a lâmina na visão interna (aparece só a ponta, no topo).
- A posição neutra é achada por busca (extensão do pescoço até o occipício tocar o colchão). A via aérea fica
  oculta fora da posição olfativa, porque nas poses extremas ela não acompanha a pele do pescoço.
- Sinais vitais são didáticos (não há modelo fisiológico): cada erro soma `VITALS.erro`.
- Ainda aguardando o retorno do usuário sobre a anatomia da visão laringoscópica (visualizador publicado).
