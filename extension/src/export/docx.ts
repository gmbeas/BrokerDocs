import * as fs from 'fs';
import * as path from 'path';
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun,
  LevelFormat, LineRuleType, Packer, PageNumber, Paragraph, ParagraphChild, ShadingType, Table, TableCell, TableRow,
  TabStopType, TextRun, WidthType,
} from 'docx';
import { imageSize } from 'image-size';
import type Token from 'markdown-it/lib/token.mjs';
import { Brand } from '../brand';
import { createMd, isExternal, splitFrontMatter } from '../render';

export interface DiagramImage { png?: string | null; w: number; h: number }
export interface DocxOptions { baseDir: string; diagrams?: (DiagramImage | null)[]; pageSize?: 'Letter' | 'A4' }

const PAGE = { Letter: { w: 12240, h: 15840 }, A4: { w: 11906, h: 16838 } };
const MARGIN = 1247; // 2,2 cm en twips
const MAX_IMG_W = 600; // px (~16 cm)
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

type ImgType = 'png' | 'jpg' | 'gif' | 'bmp';

function loadImage(src: string, baseDir: string): { data: Buffer; type: ImgType; w: number; h: number } | undefined {
  try {
    let data: Buffer;
    if (src.startsWith('data:')) {
      const m = /^data:image\/(\w+);base64,(.*)$/.exec(src); if (!m) return;
      data = Buffer.from(m[2], 'base64');
    } else {
      if (isExternal(src)) return;
      const clean = decodeURIComponent(src.replace(/[?#].*$/, ''));
      const abs = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);
      if (!fs.existsSync(abs)) return;
      data = fs.readFileSync(abs);
    }
    const dim = imageSize(data);
    const t = (dim.type || '').toLowerCase();
    const type: ImgType | undefined = t === 'png' ? 'png' : t === 'jpg' || t === 'jpeg' ? 'jpg' : t === 'gif' ? 'gif' : t === 'bmp' ? 'bmp' : undefined;
    if (!type || !dim.width || !dim.height) return;
    return { data, type, w: dim.width, h: dim.height };
  } catch { return; }
}

function fit(w: number, h: number, maxW = MAX_IMG_W, maxH = 820) {
  const k = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

export async function buildDocx(src: string, brand: Brand, opts: DocxOptions): Promise<Buffer> {
  const c = brand.colores;
  const md = createMd();
  const { meta, body } = splitFrontMatter(src);
  const tokens = md.parse(body, { headings: [], opts: {} });
  const out: (Paragraph | Table)[] = [];
  const diagrams = opts.diagrams || [];
  let diagramIdx = 0, numInstance = 0;

  interface Fmt { bold?: boolean; italics?: boolean; strike?: boolean; color?: string; size?: number; font?: string }

  // ---------- texto en línea ----------
  const inline = (children: Token[] | null, base: Fmt = {}): ParagraphChild[] => {
    const runs: ParagraphChild[] = [];
    let bold = 0, ital = 0, strike = 0;
    let link: { href: string; runs: TextRun[] } | null = null;
    const push = (r: TextRun) => (link ? link.runs.push(r) : runs.push(r));
    const run = (text: string, extra: any = {}) => new TextRun({
      text, bold: base.bold || bold > 0, italics: base.italics || ital > 0, strike: strike > 0,
      color: base.color, size: base.size, font: base.font, ...extra,
    });
    for (const t of children || []) {
      switch (t.type) {
        case 'text': push(run(t.content, link ? { style: 'Hyperlink' } : {})); break;
        case 'strong_open': bold++; break; case 'strong_close': bold--; break;
        case 'em_open': ital++; break; case 'em_close': ital--; break;
        case 's_open': strike++; break; case 's_close': strike--; break;
        case 'code_inline': push(run(t.content, { font: brand.fuente_codigo, color: c.primario, size: (base.size || 21) - 2 })); break;
        case 'softbreak': push(run(' ')); break;
        case 'hardbreak': push(run('', { break: 1 })); break;
        case 'html_inline':
          if (/type="checkbox"/.test(t.content)) push(run(/checked/.test(t.content) ? '☑ ' : '☐ ', { color: c.primario }));
          else if (/^<br\s*\/?>$/i.test(t.content)) push(run('', { break: 1 }));
          break;
        case 'link_open': link = { href: t.attrGet('href') || '', runs: [] }; break;
        case 'link_close':
          if (link) {
            if (isExternal(link.href)) runs.push(new ExternalHyperlink({ link: link.href, children: link.runs }));
            else runs.push(...link.runs);
            link = null;
          }
          break;
        case 'image': {
          const img = loadImage(t.attrGet('src') || '', opts.baseDir);
          if (img) runs.push(new ImageRun({ type: img.type, data: img.data, transformation: fit(img.w, img.h) }));
          else push(run(`[imagen: ${t.content || t.attrGet('src')}]`, { color: c.gris, italics: true }));
          break;
        }
      }
    }
    return runs;
  };

  // ---------- contexto de bloques ----------
  const lists: { ordered: boolean; instance: number }[] = [];
  let itemFirst = false;
  const quotes: { title?: string; first: boolean; color: string }[] = [];
  let table: TableRow[] | null = null, row: TableCell[] | null = null, rowIdx = 0, isHeader = false;

  const calloutColor = (cls: string) =>
    /tip/.test(cls) ? '16A34A' : /important/.test(cls) ? '7C3AED' : /caution/.test(cls) ? 'DC2626' :
      /note/.test(cls) ? c.secundario : c.acento;

  const paraProps = (): any => {
    const p: any = { spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO } };
    if (lists.length && itemFirst) {
      const l = lists[lists.length - 1], level = Math.min(lists.length - 1, 2);
      p.numbering = l.ordered ? { reference: 'brokerdocs-num', level, instance: l.instance } : { reference: 'brokerdocs-bullet', level };
      p.spacing = { after: 40, line: 264, lineRule: LineRuleType.AUTO };
      itemFirst = false;
    } else if (lists.length) {
      p.indent = { left: 720 * lists.length }; p.spacing = { after: 60 };
    }
    if (quotes.length) {
      const q = quotes[quotes.length - 1];
      p.shading = { type: ShadingType.CLEAR, color: 'auto', fill: c.fondo_suave };
      p.border = { left: { style: BorderStyle.SINGLE, size: 24, color: q.color, space: 8 } };
      p.indent = { left: 284 + (p.indent?.left || 0), right: 142 };
    }
    return p;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const lvl = Number(t.tag.slice(1));
        out.push(new Paragraph({ heading: HEADINGS[lvl - 1], children: inline(tokens[i + 1].children) }));
        i += 2; break;
      }
      case 'paragraph_open': {
        if (table) break;
        const props = paraProps();
        const children = inline(tokens[i + 1].children);
        const q = quotes[quotes.length - 1];
        if (q && q.first && q.title) {
          children.unshift(new TextRun({ text: q.title.toUpperCase() + '  ', bold: true, color: q.color, size: 18 }));
        }
        if (q) q.first = false;
        out.push(new Paragraph({ ...props, children }));
        i += 2; break;
      }
      case 'bullet_list_open': lists.push({ ordered: false, instance: 0 }); break;
      case 'ordered_list_open': lists.push({ ordered: true, instance: ++numInstance }); break;
      case 'bullet_list_close': case 'ordered_list_close': lists.pop(); break;
      case 'list_item_open': itemFirst = true; break;
      case 'blockquote_open':
        quotes.push({ title: t.attrGet('data-title') || undefined, first: true, color: calloutColor(t.attrGet('class') || '') }); break;
      case 'blockquote_close': quotes.pop(); break;
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 1 } }, spacing: { after: 200 } }));
        break;
      case 'fence': case 'code_block': {
        const lang = t.info.trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid') {
          const d = diagrams[diagramIdx++];
          if (d && d.png) {
            out.push(new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 120, after: 200 },
              children: [new ImageRun({ type: 'png', data: Buffer.from(d.png, 'base64'), transformation: fit(d.w, d.h, 560, 700) })],
            }));
            break;
          }
        }
        const lines = t.content.replace(/\n$/, '').split('\n');
        out.push(new Paragraph({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F8FA' },
          border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'E5E7EB', space: 6 } },
          spacing: { after: 160, line: 240, lineRule: LineRuleType.AUTO }, indent: { left: 142 + (lists.length ? 720 * lists.length : 0) },
          children: lines.map((l, k) => new TextRun({ text: l, font: brand.fuente_codigo, size: 18, break: k ? 1 : 0 })),
        }));
        break;
      }
      case 'table_open': table = []; rowIdx = 0; break;
      case 'thead_open': isHeader = true; break;
      case 'thead_close': isHeader = false; break;
      case 'tr_open': row = []; break;
      case 'tr_close':
        table!.push(new TableRow({ children: row!, tableHeader: isHeader })); rowIdx++; row = null; break;
      case 'th_open': case 'td_open': {
        const head = t.type === 'th_open';
        const align = /text-align:(\w+)/.exec(t.attrGet('style') || '')?.[1];
        row!.push(new TableCell({
          shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: c.primario } :
            rowIdx % 2 === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: c.fondo_suave } : undefined,
          margins: { top: 60, bottom: 60, left: 110, right: 110 },
          children: [new Paragraph({
            spacing: { after: 0 },
            alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
            children: inline(tokens[i + 1].children, head ? { bold: true, color: 'FFFFFF', size: 20 } : { size: 20 }),
          })],
        }));
        i += 2; break;
      }
      case 'table_close': {
        const b = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
        out.push(new Table({
          rows: table!, width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
        }));
        out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        table = null; break;
      }
    }
  }

  // ---------- bloque de título (front matter) ----------
  const title: Paragraph[] = [];
  if (meta.titulo) {
    if (meta.tipo) title.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: meta.tipo.toUpperCase(), bold: true, size: 18, color: c.secundario })] }));
    title.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: meta.titulo, bold: true, size: 48, color: c.primario, font: brand.fuente_titulos })] }));
    const info = [meta.subtitulo, meta.fecha, meta.autor || brand.autor].filter(Boolean).join('  ·  ');
    title.push(new Paragraph({
      spacing: { after: 280 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: c.acento, space: 8 } },
      children: [new TextRun({ text: info, size: 20, color: c.gris })],
    }));
  }

  // ---------- encabezado y pie ----------
  const page = PAGE[opts.pageSize || 'Letter'];
  const contentW = page.w - 2 * MARGIN;
  const headerKids: ParagraphChild[] = [];
  const logo = brand.logo ? loadImage(brand.logo, '/') : undefined;
  if (logo) headerKids.push(new ImageRun({ type: logo.type, data: logo.data, transformation: fit(logo.w, logo.h, 220, 34) }));
  if (brand.empresa) headerKids.push(new TextRun({ text: '\t' + brand.empresa, size: 17, color: c.gris }));
  const header = new Header({
    children: headerKids.length ? [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: contentW }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: c.primario, space: 6 } }, children: headerKids,
    })] : [],
  });
  const footer = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: contentW }],
      children: [
        new TextRun({ text: brand.pie || '', size: 16, color: c.gris }),
        new TextRun({ children: ['\tPágina ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16, color: c.gris }),
      ],
    })],
  });

  const hStyle = (id: string, name: string, size: number, color: string, before: number) => ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font: brand.fuente_titulos, size, bold: true, color },
    paragraph: { spacing: { before, after: 120 }, keepNext: true, keepLines: true },
  });
  const bulletChars = ['•', '◦', '▪'];
  const doc = new Document({
    creator: meta.autor || brand.autor || brand.empresa || 'BrokerDocs',
    title: meta.titulo || '',
    styles: {
      default: { document: { run: { font: brand.fuente, size: 21, color: c.texto } } },
      paragraphStyles: [
        hStyle('Heading1', 'Heading 1', 36, c.primario, 360), hStyle('Heading2', 'Heading 2', 28, c.primario, 300),
        hStyle('Heading3', 'Heading 3', 24, c.texto, 220), hStyle('Heading4', 'Heading 4', 22, c.gris, 200),
      ],
      characterStyles: [{ id: 'Hyperlink', name: 'Hyperlink', run: { color: c.secundario, underline: {} } }],
    },
    numbering: {
      config: [
        {
          reference: 'brokerdocs-bullet',
          levels: [0, 1, 2].map(level => ({
            level, format: LevelFormat.BULLET, text: bulletChars[level], alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540 + 360 * level, hanging: 280 } }, run: { color: c.primario } },
          })),
        },
        {
          reference: 'brokerdocs-num',
          levels: [0, 1, 2].map(level => ({
            level, format: level === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540 + 360 * level, hanging: 320 } }, run: { color: c.primario, bold: true } },
          })),
        },
      ],
    },
    sections: [{
      properties: { page: { size: { width: page.w, height: page.h }, margin: { top: MARGIN, bottom: 1134, left: MARGIN, right: MARGIN, header: 510, footer: 510 } } },
      headers: { default: header }, footers: { default: footer },
      children: [...title, ...out],
    }],
  });
  return Packer.toBuffer(doc);
}
