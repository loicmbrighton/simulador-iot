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
4. **Tab** troca a mão ativa (destacada na HUD). **Clique** age com a mão ativa. Pegar um instrumento da
   bandeja coloca-o na mão ativa.
- Remove o controle livre das mãos (WASD/mouse em 3D) da Fase 0; WASD/setas podem ficar para olhar/inclinar.

## Sequência correta (v1)
Paciente já sedado, relaxado e monitorizado; material na bandeja; laringoscópio já montado.
O paciente começa com a cabeça em posição **neutra** (a posição olfativa é a etapa 1).

| # | Mão | Ação do usuário | Animação automática |
|---|---|---|---|
| 1 | qualquer, livre | Clicar na cabeça | Coxim (toalha) + extensão da cabeça: posição olfativa |
| 2 | esquerda | Pegar o laringoscópio | Acende a luz da lâmina |
| 3 | direita, livre | Clicar na boca | Abertura da boca em tesoura (polegar e indicador nos dentes) |
| 4 | esquerda | Clicar na boca com o laringoscópio | Lâmina entra pela direita, rebate a língua para a esquerda, ponta na valécula, levanta no eixo do cabo; câmera aproxima e mostra a glote |
| 5 | direita | Pegar o tubo (esquerda segura o laringoscópio) | n/a |
| 6 | direita | Clicar na glote | Tubo entra pelo canto direito, passa as cordas, cuff abaixo delas, marca de 22 cm |
| 7 | direita | Clicar no fio-guia | Retira o fio-guia segurando o tubo |
| 8 | esquerda | Clicar na boca | Retira o laringoscópio e devolve à bandeja |
| 9 | direita | Pegar a seringa → clicar no balão-piloto | Insufla o cuff com 10 mL |
| 10 | direita | Pegar o AMBU → clicar no conector do tubo | Conecta e ventila: tórax expande, curva de capnografia no monitor; intubação confirmada |

- **Erros no Easy** (instrumento errado ou ordem trocada): nada de ruim acontece; só uma dica neutra
  ("Antes, abra a boca do paciente") e o usuário tenta de novo. No fim: tempo e número de cliques extras.
- Pendências para etapas futuras: ausculta (11) e fixação do tubo (12). Ordem fio-guia/laringoscópio pode
  ser invertida se o usuário preferir.

## Ordem de implementação
1. Mãos na camada FPS + sistema de cursor/destaque/clique + Tab. Menu só com Modo Easy ativo. **(feito)**
2. Etapas 1 a 4 (posição olfativa, abrir a boca, laringoscopia com a língua sendo rebatida: a mais difícil).
3. Etapas 5 a 10.
4. Publicar na página de teste (`npm run build:artifact`; ver `CLAUDE.md`).

## Estado atual
- **Etapa 1 da implementação concluída** (detalhes técnicos no `CLAUDE.md`, seção "Código"): mãos em repouso
  na camada FPS, cursor com destaque e dica, clique com a mão ativa, Tab, pegar e devolver instrumentos com
  animação no mundo, menu só com o Modo Easy. Controle livre das mãos e treino de precisão removidos.
- A bandeja foi movida para a direita do paciente, na altura do ombro, para caber na visão padrão.
- Clicar na cabeça ou na boca por enquanto só leva a mão até o ponto (sem efeito no paciente).
- **Próximo (etapa 2):** o paciente ainda começa já em posição olfativa (`Patient` chama
  `setPose({ ext: 26 })`): começar em neutro, sem toalha, e animar até a olfativa no clique da cabeça. Depois
  a máquina de etapas (ordem correta, dica neutra em erro, contagem de cliques extras: `App.clicks` já conta
  os cliques), abertura da boca e laringoscopia.
- A boca abre pelo osso `jaw` (rotação X positiva); a língua faz parte da malha `via_aerea` (pesada no `jaw`).
  Rebater a língua vai exigir deformação própria (ossos `tongue00-07` existem no esqueleto, mas a língua da
  via aérea não está pesada neles ainda).
- Ainda aguardando o retorno do usuário sobre a anatomia da visão laringoscópica (visualizador publicado).
