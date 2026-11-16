/* BrokerDocs CLI: el mismo motor de la extensión de VS Code, para la terminal y para el plugin. */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_BRAND, findBrandFile, loadBrand } from './brand';
import { contexto } from './contexto';
import { renderDiagrams, mermaidSources } from './export/diagrams';
import { buildDocx } from './export/docx';
import { buildHtml } from './export/html';
import { findBrowser, htmlToPdf } from './export/pdf';

const HERE = __dirname; // carpeta donde vive brokerdocs.js (junto a brokerdocs.css y mermaid.min.js)
const VERSION = '2.0.0';

const HELP = `BrokerDocs ${VERSION} · Markdown con marca → Word, PDF y HTML

Uso:
  brokerdocs export <archivo.md> [--to docx|pdf|html|all] [--out ruta] [--brand brand.json] [--page Letter|A4]
  brokerdocs contexto dia|semana|issue|rango ...   resumen compacto de git/GitHub
  brokerdocs brand init [carpeta]                   crea .brokerdocs/brand.json
  brokerdocs brand show [archivo.md]                muestra la marca que se aplicará

La marca se busca en .brokerdocs/brand.json subiendo desde la carpeta del documento.
El PDF usa Chrome, Edge o Chromium instalado (o la variable CHROME_PATH).`;

function opt(args: string[], name: string, def?: string) {
  const i = args.indexOf(name); if (i < 0) return def;
  const v = args[i + 1]; args.splice(i, 2); return v;
}

async function exportCmd(args: string[]) {
  const to = (opt(args, '--to', 'docx') || 'docx').toLowerCase();
  const outArg = opt(args, '--out');
  const brandArg = opt(args, '--brand');
  const page = (opt(args, '--page', 'Letter') === 'A4' ? 'A4' : 'Letter') as 'A4' | 'Letter';
  const file = args[0];
  if (!file || !fs.existsSync(file)) throw new Error(`No encuentro el archivo: ${file ?? '(falta)'}`);
  const abs = path.resolve(file), base = path.dirname(abs);
  const brandFile = brandArg ? path.resolve(brandArg) : findBrandFile(abs, undefined, [process.cwd()]);
  const brand = brandFile ? loadBrand(brandFile) : JSON.parse(JSON.stringify(DEFAULT_BRAND));
  const src = fs.readFileSync(abs, 'utf8');
  const formats = to === 'all' ? ['docx', 'pdf'] : to.split(',').map(s => s.trim());
  const browser = findBrowser(process.env.BROKERDOCS_BROWSER);

  const sources = mermaidSources(src);
  const diagrams = sources.length && browser
    ? await renderDiagrams(sources, brand, browser, path.join(HERE, 'mermaid.min.js'), formats.includes('docx'))
    : [];
  if (sources.length && !browser) console.error('Aviso: sin Chrome/Edge no puedo dibujar los diagramas; irán como código.');

  const target = (ext: string) => {
    if (outArg && formats.length === 1) return path.resolve(outArg);
    const dir = outArg ? path.resolve(outArg) : base;
    if (outArg) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, path.basename(abs).replace(/\.(md|markdown|mdx)$/i, '') + '.' + ext);
  };
  const written: string[] = [];
  for (const f of formats) {
    if (f === 'docx') {
      const buf = await buildDocx(src, brand, { baseDir: base, diagrams: diagrams.map(d => d && { png: d.png, w: d.w, h: d.h }), pageSize: page });
      fs.writeFileSync(target('docx'), buf); written.push(target('docx'));
    } else if (f === 'pdf' || f === 'html') {
      const html = buildHtml(src, brand, { baseDir: base, diagramSvgs: diagrams.map(d => d?.svg || null), mediaDir: HERE, pageSize: page, forPrint: f === 'pdf' });
      if (f === 'html') { fs.writeFileSync(target('html'), html, 'utf8'); written.push(target('html')); }
      else if (!browser) {
        const alt = target('html'); fs.writeFileSync(alt, html, 'utf8'); written.push(alt);
        console.error('Aviso: no encontré Chrome/Edge/Chromium para el PDF; generé HTML (ábrelo e imprime a PDF) o define CHROME_PATH.');
      } else { await htmlToPdf(html, target('pdf'), browser); written.push(target('pdf')); }
    } else throw new Error(`Formato no soportado: ${f} (usa docx, pdf, html o all)`);
  }
  console.log(written.map(w => 'OK -> ' + path.relative(process.cwd(), w)).join('\n'));
  if (!brandFile) console.log('(sin .brokerdocs/brand.json: se usó la marca por defecto; crea una con "brokerdocs brand init")');
}

function brandCmd(args: string[]) {
  const sub = args[0];
  if (sub === 'init') {
    const dir = path.resolve(args[1] || '.', '.brokerdocs');
    const f = path.join(dir, 'brand.json');
    if (fs.existsSync(f)) { console.log(`Ya existe: ${path.relative(process.cwd(), f)}`); return; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      empresa: 'Mi Empresa', autor: 'Equipo', logo: 'logo.png', fuente: 'Calibri', fuente_titulos: 'Calibri', fuente_codigo: 'Consolas',
      colores: DEFAULT_BRAND.colores, pie: 'Documento interno', carpeta_salida: 'docs/avances',
    }, null, 2) + '\n');
    console.log(`Creado ${path.relative(process.cwd(), f)}. Pon tu logo en .brokerdocs/logo.png`);
    return;
  }
  if (sub === 'show') {
    const ref = path.resolve(args[1] || '.');
    const f = findBrandFile(fs.existsSync(ref) && fs.statSync(ref).isFile() ? ref : path.join(ref, 'x.md'), undefined, [process.cwd()]);
    console.log(f ? `brand: ${path.relative(process.cwd(), f)}` : 'brand: (por defecto)');
    console.log(JSON.stringify(f ? loadBrand(f) : DEFAULT_BRAND, null, 2));
    return;
  }
  console.log(HELP);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'export') await exportCmd(rest);
    else if (cmd === 'contexto' || cmd === 'context') console.log(contexto(rest));
    else if (cmd === 'brand') brandCmd(rest);
    else if (cmd === '--version' || cmd === '-v') console.log(VERSION);
    else console.log(HELP);
  } catch (e: any) {
    console.error('Error: ' + (e?.message || e)); process.exit(1);
  }
})();
