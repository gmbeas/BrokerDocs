// Prueba fuera de VS Code: render, Word y HTML/PDF
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { loadBrand } from '../src/brand';
import { render } from '../src/render';
import { buildDocx } from '../src/export/docx';
import { buildHtml } from '../src/export/html';
import { findBrowser, htmlToPdf } from '../src/export/pdf';

(async () => {
  const dir = path.join(__dirname, 'sample'), out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const src = fs.readFileSync(path.join(dir, 'informe.md'), 'utf8');
  fs.writeFileSync(path.join(dir, '.brokerdocs/brand.json'), JSON.stringify({ empresa: 'ACME Logística', logo: 'logo.png', pie: 'Documento interno · Confidencial' }));
  const brand = loadBrand(path.join(dir, '.brokerdocs/brand.json'));

  const r = render(src, { linkExists: h => fs.existsSync(path.resolve(dir, h.split('#')[0])) });
  console.log('headings', r.headings.map(h => h.text), 'words', r.words, 'mermaid', r.hasMermaid,
    'broken', (r.html.match(/brokerdocs-broken/g) || []).length, 'callouts', (r.html.match(/callout-\w+/g) || []));

  // diagrama renderizado con mermaid-cli (simula lo que entrega la vista)
  const mmd = /```mermaid\n([\s\S]*?)```/.exec(src)![1];
  fs.writeFileSync(path.join(out, 'd.mmd'), mmd);
  fs.writeFileSync(path.join(out, 'cfg.json'), JSON.stringify({ theme: 'base', flowchart: { htmlLabels: false }, themeVariables: { primaryColor: '#EFF6FF', primaryBorderColor: '#1E40AF', lineColor: '#1E40AF' } }));
  fs.writeFileSync(path.join(out, 'p.json'), '{"args":["--no-sandbox"]}');
  for (const ext of ['png', 'svg']) execFileSync('mmdc', ['-i', path.join(out, 'd.mmd'), '-o', path.join(out, 'd.' + ext), '-c', path.join(out, 'cfg.json'), '-p', path.join(out, 'p.json'), '-b', 'white', '-s', '2', '-q']);
  const png = fs.readFileSync(path.join(out, 'd.png'));
  const svg = fs.readFileSync(path.join(out, 'd.svg'), 'utf8');
  const diag = { png: png.toString('base64'), svg, w: png.readUInt32BE(16) / 2, h: png.readUInt32BE(20) / 2 };

  const t0 = Date.now();
  fs.writeFileSync(path.join(out, 'informe.docx'), await buildDocx(src, brand, { baseDir: dir, diagrams: [diag] }));
  console.log('docx ms', Date.now() - t0);
  const html = buildHtml(src, brand, { baseDir: dir, diagramSvgs: [svg], mediaDir: path.join(__dirname, '../media'), forPrint: true });
  fs.writeFileSync(path.join(out, 'informe.html'), html);
  const b = findBrowser(); console.log('browser', b);
  const t1 = Date.now();
  await htmlToPdf(html, path.join(out, 'informe.pdf'), b!);
  console.log('pdf ms', Date.now() - t1);
})();
