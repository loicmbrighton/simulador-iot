import { Vector2 } from 'three';

/** Teclas cujo comportamento padrão do navegador deve ser bloqueado durante o jogo. */
const GAME_KEYS = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyZ', 'KeyC', 'KeyG', 'KeyV', 'KeyH', 'KeyT',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
]);

/** Estado bruto de teclado e mouse, lido uma vez por quadro. */
export class Input {
  readonly keys = new Set<string>();
  readonly pressed = new Set<string>();
  /** Posição do cursor em coordenadas normalizadas (-1..1). */
  readonly pointer = new Vector2(0, -0.3);
  readonly mouseDelta = new Vector2();
  readonly clicked = new Set<number>();
  buttons = 0;
  wheel = 0;
  enabled = false;
  pointerInside = false;

  constructor(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = 0;
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
      this.pointerInside = true;
    });
    el.addEventListener('pointerleave', () => (this.pointerInside = false));
    el.addEventListener('pointerdown', (e) => {
      this.buttons = e.buttons;
      this.clicked.add(e.button);
      el.focus();
    });
    window.addEventListener('pointerup', (e) => (this.buttons = e.buttons));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      },
      { passive: false },
    );
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  get shift(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Botão direito pressionado (olhar em volta). */
  get looking(): boolean {
    return (this.buttons & 2) !== 0;
  }

  endFrame(): void {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDelta.set(0, 0);
    this.wheel = 0;
  }
}
