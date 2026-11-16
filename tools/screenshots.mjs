// Percorre o Modo Easy com mouse e teclado de verdade e gera screenshots de inspeção a partir do build
// em dist/ (rode `npx vite build` antes). Também serve de teste de ponta a ponta: falha se uma etapa travar.
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
page.setDefaultTimeout(120000); // o renderizador por software é lento, sobretudo na visão interna
page.on('pageerror', (e) => console.error('ERRO NA PÁGINA:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__sim);

const sim = (fn, arg) => page.evaluate(fn, arg);
// Espera quadros renderizados (não tempo: a taxa de quadros aqui é baixa e irregular).
const quadros = async (n = 2) => {
  const f = await sim(() => window.__sim.frames);
  await page.waitForFunction((alvo) => window.__sim.frames >= alvo, f + n);
};
const shot = async (name) => {
  await quadros(3);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('ok', name);
};
const livre = async () => {
  await quadros(2); // o clique só vira ação no quadro seguinte
  await page.waitForFunction(() => !window.__sim.animating);
};
const estado = () => sim(() => {
  const s = window.__sim;
  return { ...s.easy, modo: s.mode, erros: s.erros, spo2: s.world.vitals.spo2, esq: s.hands.left.tool?.def.id ?? null, dir: s.hands.right.tool?.def.id ?? null };
});
const conferir = async (nome, esperado) => {
  const e = await estado();
  for (const [k, v] of Object.entries(esperado)) {
    if (e[k] !== v) throw new Error(`${nome}: esperava ${k} = ${v}, veio ${e[k]} (${JSON.stringify(e)})`);
  }
};

// Posição na tela (px) de um ponto do mundo, para mover o mouse até ele.
const tela = (alvo) => sim((alvo) => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  const p = alvo === 'boca' ? s.world.landmarks.boca.clone()
    : alvo === 'cabeca' ? s.world.landmarks.fronte.clone()
    : alvo === 'bandeja' ? new V(-0.6, 0.94, 0.2) // área vazia do campo
    : (() => {
      // Instrumento: origem da peça; o coxim é grande e a origem fica fora dele, então usa o centro.
      const t = s.tools.find((t) => t.def.id === alvo);
      const o = t.object.getWorldPosition(new V());
      return alvo === 'coxim' ? o.add(new V(0, 0.07, 0)) : o;
    })();
  p.project(s.camera);
  const r = s.renderer.domElement.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}, alvo);
const apontar = async (alvo) => {
  const p = await tela(alvo);
  await page.mouse.move(p.x - 30, p.y - 30);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await quadros(2);
};
const clicar = async (alvo) => {
  await apontar(alvo);
  await page.mouse.down();
  await page.mouse.up();
  await livre();
};

await page.waitForFunction(() => window.__sim.world.patient, null, { timeout: 180000 });
await shot('01_menu');
await page.click('.primary');
await shot('02_inicio_neutro');

// Erro de conduta: mão direita livre na boca antes do coxim (fora de ordem).
await clicar('boca');
await page.waitForFunction(() => document.querySelector('.redflash.on'));
await shot('03_erro_fora_de_ordem');
await conferir('erro', { erros: 1, olfativa: false });

// 1–2. Coxim e posição olfativa (corte lateral).
await apontar('coxim');
await shot('04_dica_coxim');
await clicar('coxim');
await conferir('coxim na mão', { dir: 'coxim' });
await apontar('cabeca');
await shot('05_dica_colocar_coxim');
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction(() => window.__sim.mode === 'lateral');
await shot('06_corte_lateral_neutro');
await page.waitForFunction(() => window.__sim.world.patient.pose.flex > 1.2);
await shot('07_corte_lateral_cabeca_erguida');
await page.waitForFunction(() => window.__sim.world.patient.pose.flex < 1.02 && window.__sim.world.patient.towel.position.z > window.__sim.world.patient.towelRest.z - 0.01);
await shot('07b_corte_lateral_coxim_no_lugar');
await page.waitForFunction(() => window.__sim.world.patient.pose.ext > 0.7);
await page.screenshot({ path: `${out}/08a_corte_lateral_estendendo.png` });
await page.waitForFunction(() => window.__sim.world.patient.pose.ext > 0.99);
await shot('08_corte_lateral_olfativa');
await livre();
await conferir('olfativa', { olfativa: true, modo: 'medico', dir: null });
await shot('09_olfativa_visao_do_medico');

// 3. Laringoscópio na mão esquerda.
await page.keyboard.press('Tab');
await clicar('laringoscopio');
await conferir('laringoscópio', { esq: 'laringoscopio' });

// Erro: inserir o laringoscópio antes de abrir a boca.
await clicar('boca');
await conferir('erro boca fechada', { erros: 2, laringoscopia: false });

// 4. Abrir a boca com a mão direita.
await page.keyboard.press('Tab');
await apontar('boca');
await shot('10_dica_abrir_boca');
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction(() => window.__sim.world.patient.pose.jaw > 12);
await page.screenshot({ path: `${out}/11_abrindo_a_boca.png` });
await livre();
await conferir('boca aberta', { bocaAberta: true });

// 5. Laringoscopia e visão interna.
await page.keyboard.press('Tab');
await apontar('boca');
await shot('12_dica_inserir_laringoscopio');
await page.mouse.down();
await page.mouse.up();
await page.waitForFunction(() => window.__sim.world.patient.pose.tongue > 0.5);
await page.screenshot({ path: `${out}/13_inserindo_laringoscopio.png` });
await page.waitForFunction(() => window.__sim.mode === 'interna');
await shot('14_visao_interna');
await conferir('laringoscopia', { laringoscopia: true, modo: 'interna' });

// Roda: a mão direita pega o tubo.
await page.click('.wheel-item');
await livre();
await conferir('roda', { dir: 'tubo' });
await shot('15_roda_tubo_na_mao');

// Vistas externas da laringoscopia (câmera livre).
const vista = (pos, target) => sim(([p, t]) => {
  const s = window.__sim;
  const V = s.camera.position.constructor;
  s.debugView = p ? { pos: new V(...p), target: new V(...t) } : null;
}, [pos, target]);
await vista([0.42, 1.3, 0.06], [0, 1.2, 0.07]);
await shot('16_laringoscopio_lateral');
await vista(null);

// Esc: desfaz a laringoscopia e volta à visão do médico.
await page.keyboard.press('Escape');
await livre();
await conferir('esc', { laringoscopia: false, modo: 'medico', esq: 'laringoscopio', dir: 'tubo', bocaAberta: true });
await shot('17_apos_esc');

console.log('estado final:', JSON.stringify(await estado()));
await browser.close();
server.close();
