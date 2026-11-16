import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

export interface Meta { [k: string]: string }
export interface Heading { level: number; text: string; id: string; line: number }
export interface RenderOptions {
  /** Convierte la ruta de una imagen local en una URL utilizable (webview, file:// o data:). */
  resolveImage?: (src: string) => string;
  /** Devuelve false si un enlace relativo apunta a un archivo inexistente. */
  linkExists?: (href: string) => boolean;
}
export interface RenderResult { html: string; meta: Meta; headings: Heading[]; words: number; hasMermaid: boolean }

const CALLOUTS: Record<string, string> = {
  NOTE: 'Nota', TIP: 'Consejo', IMPORTANT: 'Importante', WARNING: 'Advertencia', CAUTION: 'Precaución',
  NOTA: 'Nota', CONSEJO: 'Consejo', IMPORTANTE: 'Importante', ADVERTENCIA: 'Advertencia', RIESGO: 'Riesgo', BLOQUEO: 'Bloqueo',
};
const CALLOUT_CLASS: Record<string, string> = {
  NOTE: 'note', NOTA: 'note', TIP: 'tip', CONSEJO: 'tip', IMPORTANT: 'important', IMPORTANTE: 'important',
  WARNING: 'warning', ADVERTENCIA: 'warning', RIESGO: 'warning', CAUTION: 'caution', BLOQUEO: 'caution',
};

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

/** Separa el front matter YAML simple (clave: valor). */
export function splitFrontMatter(src: string): { meta: Meta; body: string; offset: number } {
  const meta: Meta = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta, body: src, offset: 0 };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  // alias en inglés
  for (const [en, es] of [['title', 'titulo'], ['subtitle', 'subtitulo'], ['date', 'fecha'], ['author', 'autor'], ['type', 'tipo']]) {
    if (meta[en] && !meta[es]) meta[es] = meta[en];
  }
  return { meta, body: src.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

export const isExternal = (href: string) => /^(https?:|mailto:|tel:|vscode:|data:)/i.test(href);

export function createMd(): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: true, linkify: true, typographer: true, breaks: false,
    highlight: (str: string, lang: string) => {
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch { /* */ }
      }
      return '';
    },
  });

  // Callouts estilo GitHub: > [!NOTE] / > [!RIESGO]   y   > **Nota:** texto
  md.core.ruler.after('inline', 'brokerdocs_callouts', state => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i].type !== 'blockquote_open') continue;
      const inline = t.slice(i + 1).find(x => x.type === 'inline');
      if (!inline || !inline.children?.length) continue;
      const first = inline.children[0];
      const m = first.type === 'text' ? /^\[!(\w+)\]\s*/.exec(first.content) : null;
      if (m && CALLOUTS[m[1].toUpperCase()]) {
        const key = m[1].toUpperCase();
        t[i].attrJoin('class', `callout callout-${CALLOUT_CLASS[key]}`);
        t[i].attrSet('data-title', CALLOUTS[key]);
        first.content = first.content.slice(m[0].length);
        if (!first.content && inline.children[1]?.type === 'softbreak') inline.children.splice(1, 1);
      } else {
        t[i].attrJoin('class', 'callout callout-plain');
      }
    }
  });

  // Listas de tareas
  md.core.ruler.after('inline', 'brokerdocs_tasks', state => {
    const t = state.tokens;
    for (let i = 2; i < t.length; i++) {
      if (t[i].type !== 'inline' || t[i - 2]?.type !== 'list_item_open') continue;
      const first = t[i].children?.[0];
      const m = first && first.type === 'text' ? /^\[([ xX])\]\s+/.exec(first.content) : null;
      if (!m) continue;
      first!.content = first!.content.slice(m[0].length);
      t[i - 2].attrJoin('class', 'task-item' + (m[1] !== ' ' ? ' done' : ''));
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
      t[i].children!.unshift(box);
    }
  });

  // data-line en bloques (sincronizar scroll / doble clic) + ids en títulos
  md.core.ruler.push('brokerdocs_lines', state => {
    const used: Record<string, number> = {};
    const env: any = state.env;
    const off = env.lineOffset || 0;
    for (const tok of state.tokens) {
      if (tok.map && tok.nesting >= 0 && tok.level < 6) {
        tok.attrSet('data-line', String(tok.map[0] + off));
        tok.attrSet('data-line-end', String(tok.map[1] + off));
      }
      if (tok.type === 'heading_open') {
        const idx = state.tokens.indexOf(tok);
        const text = state.tokens[idx + 1].content;
        let id = slugify(text) || 'seccion';
        if (used[id] !== undefined) id = `${id}-${++used[id]}`; else used[id] = 0;
        tok.attrSet('id', id);
        env.headings.push({ level: Number(tok.tag.slice(1)), text, id, line: (tok.map?.[0] ?? 0) + off });
      }
    }
  });

  const fenceDefault = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, opts, env: any, self) => {
    const tok = tokens[idx];
    const lang = tok.info.trim().split(/\s+/)[0].toLowerCase();
    const line = tok.attrGet('data-line') ?? '';
    const lend = tok.attrGet('data-line-end') ?? '';
    if (lang === 'mermaid') {
      env.hasMermaid = true;
      return `<div class="mermaid-wrap" data-line="${line}" data-line-end="${lend}"><pre class="mermaid">${md.utils.escapeHtml(tok.content)}</pre></div>\n`;
    }
    const html = fenceDefault(tokens, idx, opts, env, self);
    return html.replace('<pre>', `<pre class="code-block" data-line="${line}" data-line-end="${lend}"${lang ? ` data-lang="${md.utils.escapeHtml(lang)}"` : ''}>`)
      .replace('<code class="language-', '<code class="hljs language-');
  };

  md.renderer.rules.image = (tokens, idx, opts, env: any, self) => {
    const tok = tokens[idx];
    const src = tok.attrGet('src') || '';
    if (!isExternal(src) && env.opts?.resolveImage) tok.attrSet('src', env.opts.resolveImage(src));
    if (!isExternal(src) && env.opts?.linkExists && !env.opts.linkExists(src)) tok.attrJoin('class', 'brokerdocs-broken');
    tok.attrSet('alt', self.renderInlineAsText(tok.children || [], opts, env));
    tok.attrSet('loading', 'lazy');
    return self.renderToken(tokens, idx, opts);
  };

  md.renderer.rules.link_open = (tokens, idx, opts, env: any, self) => {
    const tok = tokens[idx];
    const href = tok.attrGet('href') || '';
    tok.attrSet('data-href', href);
    if (!isExternal(href) && !href.startsWith('#')) {
      if (env.opts?.linkExists && !env.opts.linkExists(href)) {
        tok.attrJoin('class', 'brokerdocs-broken'); tok.attrSet('title', 'Enlace roto: el archivo no existe');
      } else if (!/\.(md|markdown)(#.*)?$/i.test(href)) tok.attrJoin('class', 'brokerdocs-attachment');
    }
    return self.renderToken(tokens, idx, opts);
  };

  return md;
}

let shared: MarkdownIt | undefined;

export function render(src: string, opts: RenderOptions = {}): RenderResult {
  shared ??= createMd();
  const { meta, body, offset } = splitFrontMatter(src);
  const env: any = { headings: [], hasMermaid: false, opts, lineOffset: offset };
  const html = shared.render(body, env);
  const words = (body.replace(/```[\s\S]*?```/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
  return { html, meta, headings: env.headings, words, hasMermaid: env.hasMermaid };
}

/** Bloque de título a partir del front matter (mismo formato que el plugin). */
export function titleBlock(meta: Meta, defaultAuthor = ''): string {
  if (!meta.titulo) return '';
  const e = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const info = [meta.subtitulo, meta.fecha, meta.autor || defaultAuthor].filter(Boolean).map(x => e(x!)).join(' · ');
  return `<header class="brokerdocs-title">${meta.tipo ? `<div class="kicker">${e(meta.tipo)}</div>` : ''}` +
    `<h1 class="doc-title">${e(meta.titulo)}</h1>${info ? `<div class="doc-info">${info}</div>` : ''}</header>`;
}
