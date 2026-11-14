// Converte dist-artifact/index.html (documento completo) no fragmento que a página publicada espera:
// <title> e estilos no topo, sem <!doctype>/<html>/<head>/<body>.
// Uso: node tools/artifact.mjs <saida.html>
import { readFile, writeFile } from 'node:fs/promises';

const html = await readFile('dist-artifact/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? '<title>Simulador IOT</title>';
const links = pick(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1].replace(/<script[\s\S]*?<\/script>/g, '').trim() ?? '';
const out = [title, ...links, ...styles, body, ...scripts].join('\n');
await writeFile(process.argv[2], out);
console.log(`ok ${(out.length / 1024).toFixed(0)} KB, ${scripts.length} script(s), ${styles.length} style(s)`);
