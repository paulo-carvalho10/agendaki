import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

await mkdir('docs/barbearia-demo', { recursive: true });
await mkdir('docs/painel', { recursive: true });
// Uma página para o cliente (demo.js) e outra para o painel do dono (painel.js).
for (const [entrada, saida] of [['demo/main.tsx', 'docs/demo.js'], ['demo/painel.tsx', 'docs/painel.js']]) {
  await build({
    entryPoints: [entrada], outfile: saida, bundle: true,
    platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    minify: true, legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' },
  });
}
const css = (await readFile('app/globals.css', 'utf8')).replace('@import "tailwindcss";', '');
await writeFile('docs/demo.css', css);
await copyFile('public/favicon.svg', 'docs/favicon.svg');
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Experimente o Agendaki: serviços, calendário e horários livres para uma barbearia fictícia. Projeto de Paulo Carvalho.">
<meta name="theme-color" content="#192d32">
<title>Agendaki · Demonstração interativa</title>
<link rel="icon" href="/agendaki/favicon.svg">
<link rel="stylesheet" href="/agendaki/demo.css">
</head><body><div id="root"></div>
<noscript>Ative o JavaScript para explorar a agenda interativa.</noscript>
<script type="module" src="/agendaki/demo.js"></script></body></html>`;
await writeFile('docs/index.html', html);
await writeFile('docs/barbearia-demo/index.html', html);
await writeFile('docs/painel/index.html', html
  .replace('<title>Agendaki · Demonstração interativa</title>', '<title>Agendaki · Painel do dono (demonstração)</title>')
  .replace('Experimente o Agendaki: serviços, calendário e horários livres para uma barbearia fictícia.', 'Veja o painel do dono do Agendaki: agenda do dia, lembretes, bloqueios e agendamento manual, com uma barbearia fictícia.')
  .replace('/agendaki/demo.js', '/agendaki/painel.js'));
await writeFile('docs/.nojekyll', '');
console.log('GitHub Pages pronto em docs/: sem servidor, banco ou credenciais.');
