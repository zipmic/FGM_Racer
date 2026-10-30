// Packs dist/ into one self-contained HTML file (JS + CSS inlined) that can be
// opened straight from disk by double-clicking it – no server needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/, (_, file) =>
  `<style>${readFileSync(join(dist, file), 'utf8')}</style>`);

if (/(src|href)="\.\/assets\//.test(html)) throw new Error('standalone: unresolved asset reference left in index.html');

const out = join(dist, 'theme-grand-prix.html');
writeFileSync(out, html);
console.log(`standalone: wrote ${out} (${(html.length / 1024).toFixed(0)} kB)`);
