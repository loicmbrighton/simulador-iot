import type { Vector2 } from 'three';
import { SCENARIOS, type ScenarioId, type Side } from '../config';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface MenuChoice {
  scenario: ScenarioId;
}

export const HELP_LINES: [string, string][] = [
  ['Mouse', 'Apontar: o que é clicável ganha destaque e uma dica'],
  ['Clique', 'Agir com a mão ativa: pegar ou devolver na bandeja, usar no paciente'],
  ['Tab', 'Trocar a mão ativa'],
  ['W A S D', 'Olhar em volta (ou botão direito + mouse)'],
  ['Setas', 'Inclinar o corpo'],
  ['X', 'Recentralizar a visão'],
  ['H', 'Mostrar/ocultar ajuda'],
  ['Esc', 'Pausa (na visão da laringoscopia: retirar o laringoscópio e voltar)'],
];

export interface WheelItem {
  id: string;
  nome: string;
  /** Está na mão direita agora. */
  naMao: boolean;
  /** Não pode ser pego (está na outra mão ou já foi usado). */
  indisponivel: boolean;
}

export class UI {
  private readonly menu = el('div', 'menu');
  private readonly hud = el('div', 'hud');
  private readonly help = el('div', 'help panel');
  private readonly toast = el('div', 'toast');
  private readonly hint = el('div', 'hint');
  private readonly handBoxes: Record<Side, HTMLDivElement> = { left: el('div', 'handbox left'), right: el('div', 'handbox right') };
  private readonly topLeft = el('div', 'topleft');
  private readonly topRight = el('div', 'topright', 'Tab = trocar de mão · H = ajuda');
  private readonly vitals = el('div', 'vitals');
  private readonly checklist = el('div', 'checklist panel');
  private readonly flashBox = el('div', 'redflash');
  private readonly caption = el('div', 'caption');
  private readonly wheel = el('div', 'wheel');
  private toastTimer = 0;
  private checklistKey = '';
  private wheelKey = '';
  /** Clique num item da roda (null = soltar o que está na mão direita). */
  onWheel: (id: string | null) => void = () => {};
  private readonly patientStatus = el('p', 'note status', 'Paciente: carregando…');
  choice: MenuChoice = { scenario: 'easy' };
  onStart: (c: MenuChoice) => void = () => {};
  onResume: () => void = () => {};

  constructor(private readonly root: HTMLElement) {
    this.buildMenu();
    this.toast.setAttribute('role', 'status');
    this.caption.setAttribute('role', 'status');
    this.hud.append(
      this.flashBox, this.topLeft, this.vitals, this.topRight, this.checklist, this.handBoxes.left, this.handBoxes.right, this.wheel,
      this.caption, this.help, this.toast, this.hint,
    );
    root.append(this.hud, this.menu);
    this.hud.hidden = true;
    this.help.hidden = true;
    this.hint.hidden = true;
    this.caption.hidden = true;
    this.wheel.hidden = true;
    this.renderHelp();
  }

  private buildMenu(): void {
    const card = el('div', 'menu-card');
    card.append(el('p', 'eyebrow', 'Protótipo · Modo Easy'), el('h1', '', 'Simulador de Intubação Orotraqueal'));
    card.append(el('h2', '', 'Cenário'));
    const scenarios = el('div', 'options');
    for (const s of Object.values(SCENARIOS)) {
      const b = el('button', 'option');
      b.type = 'button';
      b.dataset.id = s.id;
      b.disabled = !s.disponivel;
      const title = el('strong', '', s.nome);
      if (!s.disponivel) title.append(el('span', 'badge', 'Em breve'));
      b.append(title, el('span', 'where', s.local), el('span', '', s.resumo));
      b.onclick = () => {
        this.choice.scenario = s.id;
        this.syncMenu();
      };
      scenarios.append(b);
    }
    card.append(scenarios);
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
    card.append(this.patientStatus, actions, el('p', 'note', 'Feito para computador com teclado e mouse: aponte, clique e use Tab para trocar de mão. H mostra todos os comandos.'));
    this.menu.append(card);
    this.syncMenu();
  }

  private syncMenu(): void {
    this.menu.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => {
      const on = b.dataset.id === this.choice.scenario;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  setPatientStatus(text: string): void {
    this.patientStatus.textContent = text;
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

  toggleHelp(force?: boolean): void {
    this.help.hidden = force !== undefined ? !force : !this.help.hidden;
  }

  private renderHelp(): void {
    this.help.replaceChildren(el('h3', '', 'Comandos'));
    const dl = el('dl');
    for (const [k, v] of HELP_LINES) dl.append(el('dt', '', k), el('dd', '', v));
    this.help.append(dl);
  }

  flash(msg: string, erro = false): void {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    this.toast.classList.toggle('error', erro);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), erro ? 4200 : 2600);
  }

  /** Erro de conduta: a tela pisca em vermelho e a mensagem aparece em destaque. */
  redFlash(msg: string): void {
    this.flashBox.classList.remove('on');
    void this.flashBox.offsetWidth; // reinicia a animação
    this.flashBox.classList.add('on');
    this.flash(msg, true);
  }

  /** Legenda no rodapé (cortes de câmera). null esconde. */
  setCaption(text: string | null): void {
    this.caption.hidden = text === null;
    if (text !== null) this.caption.textContent = text;
  }

  /** Colinha: sequência de passos, com os cumpridos marcados e o atual em destaque. */
  setChecklist(passos: string[], atual: number, rodape: string | null): void {
    const key = `${atual}|${rodape}`;
    if (key === this.checklistKey) return;
    this.checklistKey = key;
    const ol = el('ol');
    passos.forEach((texto, i) => {
      const li = el('li', i < atual ? 'done' : i === atual ? 'current' : '');
      if (i === atual) li.setAttribute('aria-current', 'step');
      li.append(el('span', 'mark', i < atual ? '✓' : String(i + 1)), el('span', '', texto));
      ol.append(li);
    });
    this.checklist.replaceChildren(el('h3', '', 'Sequência'), ol);
    if (rodape) this.checklist.append(el('p', 'foot', rodape));
  }

  /** Roda de seleção de instrumentos da mão direita (visão da laringoscopia). null esconde. */
  setWheel(itens: WheelItem[] | null): void {
    this.wheel.hidden = itens === null;
    if (itens === null) {
      this.wheelKey = '';
      return;
    }
    const key = itens.map((i) => `${i.id}${i.naMao ? '*' : ''}${i.indisponivel ? '-' : ''}`).join('|');
    if (key === this.wheelKey) return;
    this.wheelKey = key;
    const R = 37; // raio em % do tamanho da roda
    const nodes: HTMLElement[] = [];
    itens.forEach((item, i) => {
      const a = (i / itens.length) * Math.PI * 2 - Math.PI / 2;
      const b = el('button', 'wheel-item', item.nome);
      b.type = 'button';
      b.disabled = item.indisponivel;
      b.classList.toggle('held', item.naMao);
      b.setAttribute('aria-pressed', String(item.naMao));
      b.style.left = `${50 + R * Math.cos(a)}%`;
      b.style.top = `${50 + R * Math.sin(a)}%`;
      b.onclick = () => this.onWheel(item.id);
      nodes.push(b);
    });
    const held = itens.some((i) => i.naMao);
    const center = el('button', 'wheel-center', held ? 'Soltar' : 'Mão direita');
    center.type = 'button';
    center.disabled = !held;
    center.onclick = () => this.onWheel(null);
    this.wheel.replaceChildren(...nodes, center);
  }

  /** Dica ao lado do cursor (null esconde). `pointer` em coordenadas normalizadas (-1..1). */
  setHint(text: string | null, pointer: Vector2): void {
    this.hint.hidden = text === null;
    if (text === null) return;
    if (this.hint.textContent !== text) this.hint.textContent = text;
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const x = ((pointer.x + 1) / 2) * w;
    const y = ((1 - pointer.y) / 2) * h;
    // Mantém a dica dentro da tela: passa para a esquerda/acima do cursor perto das bordas.
    const bw = this.hint.offsetWidth, bh = this.hint.offsetHeight;
    const left = x + 18 + bw > w - 8 ? x - 18 - bw : x + 18;
    const top = y + 22 + bh > h - 8 ? y - 14 - bh : y + 22;
    this.hint.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  updateHud(s: {
    scenario: ScenarioId; active: Side; elapsed: number; erros: number; tools: Record<Side, string | null>;
    vitals: { fc: number; spo2: number }; alarme: { fc: number; spo2: number };
  }): void {
    const mm = Math.floor(s.elapsed / 60).toString().padStart(2, '0');
    const ss = Math.floor(s.elapsed % 60).toString().padStart(2, '0');
    const top = `${SCENARIOS[s.scenario].nome} · ${mm}:${ss} · Erros: ${s.erros}`;
    if (this.topLeft.textContent !== top) this.topLeft.textContent = top;
    // Sinais vitais também na HUD (o monitor da sala nem sempre está à vista).
    const vkey = `${Math.round(s.vitals.fc)}|${Math.round(s.vitals.spo2)}`;
    if (this.vitals.dataset.key !== vkey) {
      this.vitals.dataset.key = vkey;
      const fc = el('span', s.vitals.fc >= s.alarme.fc ? 'alarm' : '', `FC ${Math.round(s.vitals.fc)}`);
      const spo2 = el('span', s.vitals.spo2 <= s.alarme.spo2 ? 'alarm' : '', `SpO₂ ${Math.round(s.vitals.spo2)}%`);
      this.vitals.replaceChildren(fc, spo2);
    }
    for (const side of ['left', 'right'] as Side[]) {
      const box = this.handBoxes[side];
      const on = s.active === side;
      const key = `${on}|${s.tools[side]}`;
      if (box.dataset.key === key) continue;
      box.dataset.key = key;
      box.classList.toggle('active', on);
      const label = el('small', '', side === 'left' ? 'Mão esquerda' : 'Mão direita');
      if (on) label.append(el('span', 'tag', 'ativa'));
      box.replaceChildren(label, el('strong', '', s.tools[side] ?? 'Livre'));
    }
  }
}
