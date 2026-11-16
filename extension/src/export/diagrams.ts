import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Brand } from '../brand';

export interface RenderedDiagram { svg: string; png: string | null; w: number; h: number }

function run(browser: string, args: string[], timeout = 60000): Promise<string> {
  const base = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars'];
  if (process.platform === 'linux' && process.getuid?.() === 0) base.unshift('--no-sandbox');
  return new Promise((resolve, reject) => {
    execFile(browser, [...base, ...args], { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err); else resolve(stdout);
    });
  });
}

/**
 * Renderiza diagramas Mermaid con el navegador del sistema (sin VS Code):
 * 1) una página con mermaid.js devuelve los SVG; 2) cada SVG se captura como PNG (para Word).
 */
export async function renderDiagrams(sources: string[], brand: Brand, browser: string, mermaidJs: string, withPng = true): Promise<(RenderedDiagram | null)[]> {
  if (!sources.length) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brokerdocs-mmd-'));
  try {
    const c = brand.colores;
    const cfg = {
      startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false, flowchart: { htmlLabels: false, curve: 'basis' },
      fontFamily: `'${brand.fuente}', Arial, sans-serif`,
      themeVariables: {
        primaryColor: '#' + c.fondo_suave, primaryBorderColor: '#' + c.primario, primaryTextColor: '#' + c.texto,
        lineColor: '#' + c.primario, secondaryColor: '#FEF3C7', tertiaryColor: '#FFFFFF', fontSize: '14px',
      },
    };
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="${pathToFileURL(mermaidJs).href}"></script></head><body>
<pre id="out">PENDIENTE</pre><script>
(async () => {
  const src = ${JSON.stringify(sources)}; const res = [];
  mermaid.initialize(${JSON.stringify(cfg)});
  for (let i = 0; i < src.length; i++) {
    try {
      const { svg } = await mermaid.render('d' + i, src[i]);
      const box = document.createElement('div'); box.innerHTML = svg; document.body.appendChild(box);
      const el = box.querySelector('svg'); const vb = el.viewBox.baseVal;
      const w = Math.ceil(vb && vb.width ? vb.width : el.getBoundingClientRect().width);
      const h = Math.ceil(vb && vb.height ? vb.height : el.getBoundingClientRect().height);
      el.setAttribute('width', w); el.setAttribute('height', h); el.style.maxWidth = '';
      res.push({ svg: new XMLSerializer().serializeToString(el), w, h });
    } catch (e) { res.push(null); }
  }
  document.getElementById('out').textContent = 'JSON:' + btoa(unescape(encodeURIComponent(JSON.stringify(res))));
})();
</script></body></html>`;
    const pagePath = path.join(tmp, 'render.html');
    fs.writeFileSync(pagePath, page);
    const dom = await run(browser, ['--allow-file-access-from-files', '--virtual-time-budget=15000', `--user-data-dir=${path.join(tmp, 'p')}`, '--dump-dom', pathToFileURL(pagePath).href]);
    const m = /JSON:([A-Za-z0-9+/=]+)/.exec(dom);
    if (!m) return sources.map(() => null);
    const list: ({ svg: string; w: number; h: number } | null)[] = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));

    const out: (RenderedDiagram | null)[] = [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) { out.push(null); continue; }
      let png: string | null = null;
      if (withPng) {
        const scale = 2, W = Math.max(1, Math.round(d.w * scale)), H = Math.max(1, Math.round(d.h * scale));
        const svgSized = d.svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, `<svg$1 width="${W}"`).replace(/<svg([^>]*?)\sheight="[^"]*"/, `<svg$1 height="${H}"`);
        const shot = path.join(tmp, `d${i}.html`), png1 = path.join(tmp, `d${i}.png`);
        fs.writeFileSync(shot, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block}</style></head><body>${svgSized}</body></html>`);
        try {
          await run(browser, [`--user-data-dir=${path.join(tmp, 'p')}`, `--window-size=${W},${H}`, '--default-background-color=ffffffff',
            `--screenshot=${png1}`, pathToFileURL(shot).href]);
          if (fs.existsSync(png1)) png = fs.readFileSync(png1).toString('base64');
        } catch { /* sin PNG: Word mostrará el código */ }
      }
      out.push({ svg: d.svg, png, w: d.w, h: d.h });
    }
    return out;
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => undefined);
  }
}

/** Extrae el código de cada bloque ```mermaid en orden. */
export function mermaidSources(md: string): string[] {
  const out: string[] = [];
  const re = /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push(m[3]);
  return out;
}
