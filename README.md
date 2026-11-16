# simulador-iot
Simulador 3D de intubação orotraqueal em primeira pessoa (Three.js + TypeScript).

**Status:** Modo Easy point-and-click em construção (`docs/MODO_EASY.md`). Já funciona do início até a
laringoscopia: coxim e posição olfativa (corte lateral), abertura da boca, inserção do laringoscópio e visão
interna da glote, com colinha na tela e erros que pioram os sinais vitais. Sequência Rápida e Eletiva estão
em standby (regras em `docs/CENARIOS.md`).

```bash
npm install
npm run dev     # abre em http://localhost:5173
npm test
```

Decisões do projeto em `CLAUDE.md`; atribuições em `CREDITOS.md`.
