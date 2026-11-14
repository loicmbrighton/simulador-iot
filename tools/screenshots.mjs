// Gera screenshots de inspeção a partir do build em dist/ (rode `npx vite build` antes).
// Uso: node tools/screenshots.mjs [pasta_saida]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Playwright pode estar instalado globalmente (NODE_PATH) ou como dependência local.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve('dist');
const out = resolve(process.argv[2] ?? 'screenshots');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('ERRO NA PÁGINA:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__sim);
await page.waitForTimeout(800);

const shot = async (name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('ok', name);
};
const sim = (fn, arg) => page.evaluate(fn, arg);

await page.waitForFunction(() => window.__sim.world.patient, null, { timeout: 180000 }).catch(() => console.log('paciente não carregou'));
await shot('01_menu');
await page.click('.primary');
await shot('02_inicio_ajuda');

// Ferramentas nas mãos, perto da boca.
await sim(() => {
  const s = window.__sim;
  s.ui.toggleHelp(s.scheme, false);
  s.equip('left', 1);
  s.equip('right', 2);
  s.hands.left.target.set(0.03, 1.2, 0.0);
  s.hands.right.target.set(-0.08, 1.22, 0.02);
});
await page.waitForTimeout(600);
await shot('03_ferramentas_na_mao');

// Vista lateral livre para conferir braços (IK) e empunhadura.
await sim(() => {
  const s = window.__sim;
  s.debugView = { pos: new s.camera.position.constructor(1.1, 1.45, -0.2), target: new s.camera.position.constructor(0, 1.2, -0.2) };
});
await shot('04_lateral_bracos');

// Bandeja.
await sim(() => {
  const s = window.__sim;
  s.equip('left', 0);
  s.equip('right', 0);
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(-0.42, 1.4, -0.85), target: new V(-0.6, 0.94, -0.48) };
});
await shot('05_bandeja');

// Close das ferramentas segurando (vista frontal da mão).
await sim(() => {
  const s = window.__sim;
  s.equip('left', 1);
  s.equip('right', 2);
  const V = s.camera.position.constructor;
  s.hands.left.target.set(0.15, 1.3, -0.15);
  s.hands.right.target.set(-0.15, 1.3, -0.15);
  s.debugView = { pos: new V(0, 1.38, 0.35), target: new V(0, 1.28, -0.15) };
});
await shot('06_maos_frente');

// Paciente na maca: lateral e cabeça de perto.
await sim(() => {
  const s = window.__sim;
  s.equip('left', 0);
  s.equip('right', 0);
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(1.6, 1.5, 0.6), target: new V(0, 1.0, 0.55) };
});
await shot('08_maca_lateral');
await sim(() => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(0.55, 1.18, -0.05), target: new V(0, 1.07, 0.02) };
});
await shot('09_cabeca_posicao_olfativa');

// Exercício.
await sim(() => {
  const s = window.__sim;
  s.debugView = null;
  s.exercise.toggle();
});
await shot('07_exercicio');

await browser.close();
server.close();
