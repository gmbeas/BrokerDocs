import * as fs from 'fs';
import * as path from 'path';
import { Brand, brandCss } from '../brand';
import { render, titleBlock } from '../render';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
};

export function fileToDataUri(abs: string): string | undefined {
  try {
    const ext = path.extname(abs).slice(1).toLowerCase();
    if (!MIME[ext]) return;
    return `data:${MIME[ext]};base64,${fs.readFileSync(abs).toString('base64')}`;
  } catch { return; }
}

export function resolveLocal(src: string, baseDir: string): string {
  const clean = decodeURIComponent(src.replace(/[?#].*$/, ''));
  return path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
}

export interface HtmlOptions {
  baseDir: string;
  /** SVG de cada diagrama en orden (desde la vista previa). */
  diagramSvgs?: (string | null)[];
  mediaDir: string; // carpeta con brokerdocs.css
  pageSize?: 'Letter' | 'A4';
  forPrint?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** HTML autónomo (imágenes embebidas) para exportar o imprimir a PDF. */
export function buildHtml(src: string, brand: Brand, o: HtmlOptions): string {
  const r = render(src, {
    resolveImage: s => fileToDataUri(resolveLocal(s, o.baseDir)) || s,
  });
  let body = r.html;
  if (o.diagramSvgs?.length) {
    let k = 0;
    body = body.replace(/<pre class="mermaid">[\s\S]*?<\/pre>/g, m => {
      const svg = o.diagramSvgs![k++];
      return svg ? svg.replace(/^<\?xml[^>]*>/, '') : m;
    });
  }
  const css = fs.readFileSync(path.join(o.mediaDir, 'brokerdocs.css'), 'utf8');
  const logo = brand.logo ? fileToDataUri(brand.logo) : undefined;
  const bar = logo || brand.empresa
    ? `<div class="brokerdocs-brandbar">${logo ? `<img src="${logo}" alt="">` : '<span></span>'}<span>${esc(brand.empresa)}</span></div>` : '';
  const size = o.pageSize === 'A4' ? 'A4' : 'Letter';
  const pie = (brand.pie || '').replace(/["\\]/g, '\\$&');
  const print = `@page{size:${size};margin:16mm 18mm 18mm;` +
    `@bottom-left{content:"${pie}";font:9px ${brand.fuente},sans-serif;color:#${brand.colores.gris}}` +
    `@bottom-right{content:"Página " counter(page) " de " counter(pages);font:9px ${brand.fuente},sans-serif;color:#${brand.colores.gris}}}` +
    `html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  const title = esc(r.meta.titulo || r.headings[0]?.text || 'Documento');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title><style>${brandCss(brand)}\n${css}\n${print}\nbody{margin:0;background:#fff}` +
    `${o.forPrint ? '' : '@media screen{body{background:#F3F4F6;padding:24px 0}.brokerdocs-page{background:#fff;max-width:920px;margin:0 auto;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12)}}'}</style></head>` +
    `<body><div class="brokerdocs-page">${bar}<article class="brokerdocs-doc">${titleBlock(r.meta, brand.autor)}${body}</article></div></body></html>`;
}
