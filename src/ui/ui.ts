import { SCENARIOS, type ControlScheme, type ScenarioId, type Side } from '../config';
import { TOOL_DEFS } from '../tools/tools';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface MenuChoice {
  scenario: ScenarioId;
  scheme: ControlScheme;
}

const SCHEMES: Record<ControlScheme, { nome: string; desc: string }> = {
  'duas-maos': { nome: 'Duas mãos', desc: 'Teclado (WASD) move a mão esquerda; mouse move a mão direita.' },
  'mao-ativa': { nome: 'Mão ativa', desc: 'O mouse move a mão ativa; Tab alterna entre as mãos.' },
};

export function helpLines(scheme: ControlScheme): [string, string][] {
  const common: [string, string][] = [
    ['Botão direito + mouse', 'Olhar em volta'],
    ['Setas', 'Inclinar o corpo'],
    ['X', 'Recentralizar visão e mãos'],
    ['T', 'Treino de precisão (alvos)'],
    ['V', 'Trocar esquema de controle'],
    ['H', 'Mostrar/ocultar ajuda'],
    ['Esc', 'Pausa'],
  ];
  if (scheme === 'duas-maos') {
    return [
      ['W A S D', 'Mão esquerda: frente, esquerda, trás, direita'],
      ['Q / E', 'Mão esquerda: descer / subir'],
      ['R / F', 'Mão esquerda: inclinar a ponta para frente / trás'],
      ['Z / C', 'Mão esquerda: girar'],
      ['Shift (segurado)', 'Mão esquerda: modo precisão'],
      ['G', 'Mão esquerda: pegar / devolver na bandeja'],
      ['Mouse', 'Mão direita: mover'],
      ['Roda do mouse', 'Mão direita: subir / descer'],
      ['Espaço + mouse', 'Mão direita: inclinar e girar'],
      ['Clique', 'Mão direita: pegar / devolver na bandeja'],
      ['1–5', 'Ferramenta na mão direita (0 = soltar)'],
      ['Shift + 1–5', 'Ferramenta na mão esquerda (Shift+0 = soltar)'],
      ...common,
    ];
  }
  return [
    ['Mouse', 'Mover a mão ativa'],
    ['Roda do mouse', 'Subir / descer'],
    ['Espaço + mouse', 'Inclinar e girar'],
    ['Tab', 'Alternar mão ativa'],
    ['Clique', 'Pegar / devolver na bandeja'],
    ['1–5', 'Ferramenta na mão ativa (0 = soltar)'],
    ...common,
  ];
}

export class UI {
  private readonly menu = el('div', 'menu');
  private readonly hud = el('div', 'hud');
  private readonly help = el('div', 'help panel');
  private readonly toast = el('div', 'toast');
  private readonly handBoxes: Record<Side, HTMLDivElement> = { left: el('div', 'handbox left'), right: el('div', 'handbox right') };
  private readonly topLeft = el('div', 'topleft');
  private readonly topRight = el('div', 'topright');
  private readonly exerciseBox = el('div', 'exercise panel');
  private toastTimer = 0;
  choice: MenuChoice = { scenario: 'easy', scheme: 'duas-maos' };
  onStart: (c: MenuChoice) => void = () => {};
  onResume: () => void = () => {};

  constructor(root: HTMLElement) {
    this.buildMenu();
    this.hud.append(this.topLeft, this.topRight, this.handBoxes.left, this.handBoxes.right, this.exerciseBox, this.help, this.toast);
    root.append(this.hud, this.menu);
    this.hud.hidden = true;
    this.help.hidden = true;
    this.exerciseBox.hidden = true;
  }

  private buildMenu(): void {
    const card = el('div', 'menu-card');
    card.append(el('p', 'eyebrow', 'Protótipo · Fase 0: controle das mãos'), el('h1', '', 'Simulador de Intubação Orotraqueal'));
    card.append(el('h2', '', 'Cenário'));
    const scenarios = el('div', 'options');
    for (const s of Object.values(SCENARIOS)) {
      const b = el('button', 'option');
      b.type = 'button';
      b.dataset.id = s.id;
      b.append(el('strong', '', s.nome), el('span', 'where', s.local), el('span', '', s.resumo));
      b.onclick = () => {
        this.choice.scenario = s.id;
        this.syncMenu();
      };
      scenarios.append(b);
    }
    card.append(scenarios, el('p', 'note', 'Nesta fase os três cenários usam a mesma cena: as regras clínicas de cada um entram na Fase 3.'));
    card.append(el('h2', '', 'Esquema de controle'));
    const schemes = el('div', 'options two');
    for (const [id, s] of Object.entries(SCHEMES) as [ControlScheme, (typeof SCHEMES)[ControlScheme]][]) {
      const b = el('button', 'option');
      b.type = 'button';
      b.dataset.scheme = id;
      b.append(el('strong', '', s.nome), el('span', '', s.desc));
      b.onclick = () => {
        this.choice.scheme = id;
        this.syncMenu();
      };
      schemes.append(b);
    }
    card.append(schemes);
    const actions = el('div', 'actions');
    const start = el('button', 'primary', 'Iniciar');
    start.type = 'button';
    start.onclick = () => this.onStart({ ...this.choice });
    const resume = el('button', 'secondary', 'Continuar');
    resume.type = 'button';
    resume.dataset.resume = '1';
    resume.hidden = true;
    resume.onclick = () => this.onResume();
    actions.append(resume, start);
    card.append(actions, el('p', 'note', 'Clique na cena para dar foco ao teclado. Use H durante o jogo para ver todos os comandos.'));
    this.menu.append(card);
    this.syncMenu();
  }

  private syncMenu(): void {
    this.menu.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.classList.toggle('selected', b.dataset.id === this.choice.scenario));
    this.menu.querySelectorAll<HTMLButtonElement>('[data-scheme]').forEach((b) => b.classList.toggle('selected', b.dataset.scheme === this.choice.scheme));
  }

  showMenu(paused: boolean): void {
    this.menu.hidden = false;
    this.hud.hidden = true;
    (this.menu.querySelector('[data-resume]') as HTMLButtonElement).hidden = !paused;
    (this.menu.querySelector('.primary') as HTMLButtonElement).textContent = paused ? 'Reiniciar' : 'Iniciar';
  }

  showGame(): void {
    this.menu.hidden = true;
    this.hud.hidden = false;
  }

  toggleHelp(scheme: ControlScheme, force?: boolean): void {
    this.help.hidden = force !== undefined ? !force : !this.help.hidden;
    this.renderHelp(scheme);
  }

  renderHelp(scheme: ControlScheme): void {
    this.help.replaceChildren(el('h3', '', `Comandos: ${SCHEMES[scheme].nome}`));
    const dl = el('dl');
    for (const [k, v] of helpLines(scheme)) dl.append(el('dt', '', k), el('dd', '', v));
    this.help.append(dl);
  }

  flash(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }

  updateHud(s: {
    scenario: ScenarioId; scheme: ControlScheme; active: Side; elapsed: number;
    tools: Record<Side, string | null>; outOfReach: Record<Side, boolean>;
  }): void {
    const mm = Math.floor(s.elapsed / 60).toString().padStart(2, '0');
    const ss = Math.floor(s.elapsed % 60).toString().padStart(2, '0');
    this.topLeft.textContent = `${SCENARIOS[s.scenario].nome} · ${mm}:${ss}`;
    this.topRight.textContent = `${SCHEMES[s.scheme].nome} · H = ajuda`;
    for (const side of ['left', 'right'] as Side[]) {
      const box = this.handBoxes[side];
      const label = side === 'left' ? 'Mão esquerda' : 'Mão direita';
      const ctrl = s.scheme === 'duas-maos' ? (side === 'left' ? 'teclado' : 'mouse') : s.active === side ? 'mouse (ativa)' : 'parada';
      box.classList.toggle('active', s.scheme === 'mao-ativa' && s.active === side);
      box.classList.toggle('reach', s.outOfReach[side]);
      box.replaceChildren(el('small', '', `${label} · ${ctrl}`), el('strong', '', s.tools[side] ?? 'Livre'));
    }
  }

  updateExercise(state: { active: boolean; index: number; total: number; nome?: string; mao?: Side; elapsed: number; finished: number | null }): void {
    this.exerciseBox.hidden = !state.active;
    if (!state.active) return;
    if (state.finished !== null) {
      this.exerciseBox.replaceChildren(el('strong', '', `Treino concluído em ${state.finished.toFixed(1)} s`), el('span', '', 'T para fechar'));
      return;
    }
    this.exerciseBox.replaceChildren(
      el('strong', '', `Alvo ${state.index + 1}/${state.total}: ${state.nome}`),
      el('span', state.mao === 'left' ? 'tag left' : 'tag right', state.mao === 'left' ? 'mão esquerda' : 'mão direita'),
      el('span', '', `${state.elapsed.toFixed(1)} s`),
    );
  }
}

export const TOOL_NAMES = Object.fromEntries(TOOL_DEFS.map((d) => [d.id, d.nome]));
