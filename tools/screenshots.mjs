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

await sim(() => window.__sim.ui.toggleHelp(false));
await shot('03_repouso_maos_fps');

// Posição na tela (px) de um ponto do mundo, para mover o mouse até ele.
const tela = (alvo) => sim((alvo) => {
  const s = window.__sim;
  const p = alvo === 'boca' ? s.world.landmarks.boca.clone()
    : alvo === 'cabeca' ? s.world.landmarks.fronte.clone()
    : alvo === 'bandeja' ? s.world.landmarks.boca.clone().set(-0.6, 0.94, 0.2) // área vazia do campo
    : s.tools.find((t) => t.def.id === alvo).object.getWorldPosition(s.world.landmarks.boca.clone());
  p.project(s.camera);
  const r = s.renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}, alvo);
const apontar = async (alvo) => {
  const p = await tela(alvo);
  await page.mouse.move(p.x - 30, p.y - 30);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await quadros(2);
  return p;
};
// Espera alguns quadros renderizados (o renderizador por software é lento e irregular).
const quadros = async (n) => {
  const f = await sim(() => window.__sim.frames);
  await page.waitForFunction((alvo) => window.__sim.frames >= alvo, f + n);
};
const livre = async () => {
  await quadros(2); // o clique só vira ação no quadro seguinte
  await page.waitForFunction(() => !window.__sim.busy('left') && !window.__sim.busy('right'));
};

// Destaque e dica sobre a boca e a cabeça.
await apontar('boca');
await shot('04_dica_boca');
await apontar('cabeca');
await shot('05_dica_cabeca');

// Tab: mão esquerda ativa; pegar o laringoscópio.
await page.keyboard.press('Tab');
await apontar('laringoscopio');
await shot('06_dica_laringoscopio');
await page.mouse.down();
await page.mouse.up();
await livre();
await shot('08_laringoscopio_na_mao_esquerda');

// Mão direita pega o tubo.
await page.keyboard.press('Tab');
await apontar('tubo');
await page.mouse.down();
await page.mouse.up();
await livre();
await shot('09_duas_maos_com_instrumentos');

// Clique na boca com a mão esquerda (laringoscópio): a mão sai da camada FPS e age no mundo.
await page.keyboard.press('Tab');
await apontar('boca');
await shot('10_dica_inserir_laringoscopio');
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction(() => {
  const s = window.__sim;
  return s.hands.left.tipWorld().distanceTo(s.world.landmarks.boca) < 0.03;
});
await page.screenshot({ path: `${out}/11_acao_no_mundo.png` });
await sim(() => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(1.1, 1.45, -0.2), target: new V(0, 1.2, -0.2) };
});
await livre();
await shot('12_lateral_bracos');

// Devolver o tubo à bandeja.
await sim(() => (window.__sim.debugView = null));
await quadros(2);
await page.keyboard.press('Tab');
await apontar('bandeja');
await shot('13_dica_devolver');
await page.mouse.down();
await page.mouse.up();
await livre();
await apontar('aspirador');
await shot('14_tubo_devolvido_dica_aspirador');

// Bandeja e paciente (câmera livre).
await sim(() => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(-0.4, 1.45, -0.05), target: new V(-0.68, 0.94, 0.33) };
});
await shot('15_bandeja');
await sim(() => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  s.debugView = { pos: new V(1.6, 1.5, 0.6), target: new V(0, 1.0, 0.55) };
});
await shot('16_maca_lateral');

await browser.close();
server.close();
