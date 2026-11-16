// BrokerDocs · script del panel de vista previa (se ejecuta dentro del webview)
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const content = $('#content'), toc = $('#toc'), stats = $('#stats'), brandbar = $('#brandbar');
  const saved = vscode.getState() || {};
  let mermaidReady = null, brand = null, mermaidUri = document.body.dataset.mermaid;
  const svgCache = new Map(); // fuente mermaid -> svg

  if (saved.toc) { toc.classList.add('show'); $('[data-act="toc"]').classList.add('on'); }

  // ---------- barra ----------
  $('#bar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act, exp = b.dataset.export;
    if (act === 'toc') {
      const on = toc.classList.toggle('show'); b.classList.toggle('on', on);
      vscode.setState({ ...vscode.getState(), toc: on }); return;
    }
    if (exp) { vscode.postMessage({ type: 'export', format: exp }); toast('Exportando ' + exp.toUpperCase() + '…'); return; }
    vscode.postMessage({ type: 'action', action: act });
  });

  // ---------- enlaces, doble clic ----------
  content.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-href]'); if (!a) return;
    e.preventDefault();
    const href = a.dataset.href;
    if (href.startsWith('#')) { scrollToId(decodeURIComponent(href.slice(1))); return; }
    vscode.postMessage({ type: 'openLink', href });
  });
  // ---------- selección vista -> código ----------
  const lineOf = (el) => ({ line: Number(el.dataset.line), end: el.dataset.lineEnd ? Number(el.dataset.lineEnd) : undefined });
  function blockFrom(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest('[data-line]') : null;
  }
  let clickTimer;
  content.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || e.target.closest('a,button,input')) return;
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : '';
    // bloque común a toda la selección (o el bloque clicado)
    let el = blockFrom(text ? sel.getRangeAt(0).commonAncestorContainer : e.target);
    if (!el) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { // deja pasar el doble clic
      mark(el, false);
      vscode.postMessage({ type: 'selectSource', ...lineOf(el), text });
    }, text ? 0 : 180);
  });
  content.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimer);
    const el = blockFrom(e.target); if (!el) return;
    mark(el, false);
    const sel = window.getSelection();
    vscode.postMessage({ type: 'revealLine', ...lineOf(el), text: sel ? sel.toString() : '' });
  });

  // ---------- resaltado código -> vista ----------
  let marked = null;
  function mark(el, scroll) {
    if (marked) marked.classList.remove('brokerdocs-active');
    marked = el; if (!el) return;
    el.classList.add('brokerdocs-active');
    if (scroll) {
      const r = el.getBoundingClientRect(), top = 46;
      if (r.top < top || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function highlightLine(line) {
    let best = null;
    for (const el of content.querySelectorAll('[data-line]')) {
      const s = +el.dataset.line, e = el.dataset.lineEnd ? +el.dataset.lineEnd : s + 1;
      if (s <= line && line < e) best = el; // el último que contiene la línea es el más interno
      else if (s > line) break;
    }
    mark(best, true);
  }
  toc.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return; e.preventDefault(); scrollToId(a.dataset.id);
  });

  function scrollToId(id) {
    const el = document.getElementById(id); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // ---------- pegar / arrastrar archivos ----------
  const drop = $('#drop'); let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; drop.classList.add('show'); e.preventDefault(); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('show'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    dragDepth = 0; drop.classList.remove('show');
    if (!e.dataTransfer?.files?.length) return; e.preventDefault();
    [...e.dataTransfer.files].forEach(sendFile);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])]; if (!files.length) return;
    e.preventDefault(); files.forEach(sendFile);
  });
  function hasFiles(e) { return [...(e.dataTransfer?.types || [])].includes('Files'); }
  function sendFile(f) {
    if (f.size > 25 * 1024 * 1024) { toast('Archivo muy grande (máx. 25 MB)'); return; }
    const r = new FileReader();
    r.onload = () => vscode.postMessage({ type: 'saveFile', name: f.name || 'imagen.png', mime: f.type, data: String(r.result).split(',')[1] });
    r.readAsDataURL(f);
  }

  // ---------- mensajes desde la extensión ----------
  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (m.type === 'update') await update(m);
    else if (m.type === 'scrollTo') scrollToLine(m.line);
    else if (m.type === 'highlight') highlightLine(m.line);
    else if (m.type === 'toast') toast(m.text);
    else if (m.type === 'update-anchor') scrollToId(m.id);
    else if (m.type === 'collectDiagrams') {
      let diagrams = [];
      try { await (mermaidReady || Promise.resolve()); diagrams = await collectDiagrams(); } catch (err) { console.error(err); }
      vscode.postMessage({ type: 'diagrams', id: m.id, diagrams });
    }
  });

  async function update(m) {
    if (m.brandCss) {
      let st = document.getElementById('brand-css');
      if (!st) { st = document.createElement('style'); st.id = 'brand-css'; document.head.appendChild(st); }
      st.textContent = m.brandCss;
      if (brand && JSON.stringify(brand) !== JSON.stringify(m.brand)) { svgCache.clear(); mermaidReady = null; }
      brand = m.brand;
    }
    brandbar.innerHTML = m.brandBar || ''; brandbar.style.display = m.brandBar ? '' : 'none';
    const keep = marked ? marked.dataset.line : null;
    content.innerHTML = (m.title || '') + m.html;
    marked = null;
    if (keep !== null) { const el = content.querySelector('[data-line="' + keep + '"]'); if (el) mark(el, false); }
    toc.innerHTML = '<div class="ttl">Índice</div>' + (m.headings || []).map(h =>
      `<a href="#" class="l${h.level}" data-id="${h.id}" title="${esc(h.text)}">${esc(h.text)}</a>`).join('');
    const min = Math.max(1, Math.round(m.words / 200));
    stats.textContent = `${m.words.toLocaleString()} palabras · ${min} min`;
    if (m.hasMermaid) await renderMermaid();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((res, rej) => {
      const init = () => {
        const c = (brand && brand.colores) || {};
        window.mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false,
          flowchart: { htmlLabels: false, curve: 'basis' },
          fontFamily: (brand && brand.fuente ? `'${brand.fuente}',` : '') + 'Arial, sans-serif',
          themeVariables: {
            primaryColor: '#' + (c.fondo_suave || 'EFF6FF'), primaryBorderColor: '#' + (c.primario || '1E40AF'),
            primaryTextColor: '#' + (c.texto || '1F2937'), lineColor: '#' + (c.primario || '1E40AF'),
            secondaryColor: '#FEF3C7', tertiaryColor: '#FFFFFF', fontSize: '14px',
          },
        });
        res();
      };
      if (window.mermaid) return init();
      const s = document.createElement('script'); s.src = mermaidUri; s.onload = init; s.onerror = rej;
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  let seq = 0;
  async function renderMermaid() {
    await loadMermaid();
    for (const pre of content.querySelectorAll('pre.mermaid')) {
      const src = pre.textContent;
      if (svgCache.has(src)) { pre.outerHTML = svgCache.get(src); continue; }
      try {
        const { svg } = await window.mermaid.render('fm' + (++seq), src);
        svgCache.set(src, svg); if (svgCache.size > 60) svgCache.delete(svgCache.keys().next().value);
        if (pre.isConnected) pre.outerHTML = svg;
      } catch (err) {
        pre.textContent = '⚠ Error en el diagrama: ' + (err && err.message ? err.message.split('\n')[0] : err);
        pre.style.color = '#DC2626';
        document.querySelectorAll('[id^="dfm"]').forEach(n => n.remove()); // restos de mermaid
      }
    }
  }

  // Convierte cada diagrama a PNG (para Word) y devuelve también el SVG (para PDF/HTML)
  async function collectDiagrams() {
    const out = [];
    for (const wrap of content.querySelectorAll('.mermaid-wrap')) {
      const svg = wrap.querySelector('svg');
      if (!svg) { out.push(null); continue; }
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const w = Math.round(vb && vb.width ? vb.width : svg.getBoundingClientRect().width);
      const h = Math.round(vb && vb.height ? vb.height : svg.getBoundingClientRect().height);
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', w); clone.setAttribute('height', h);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.style.maxWidth = '';
      const xml = new XMLSerializer().serializeToString(clone);
      const scale = 2, img = new Image();
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      const png = await new Promise((res) => {
        img.onload = () => {
          const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          try { res(cv.toDataURL('image/png').split(',')[1]); } catch { res(null); }
        };
        img.onerror = () => res(null); img.src = url;
      });
      out.push({ png, svg: xml, w, h });
    }
    return out;
  }

  // ---------- sincronización con el editor ----------
  let lastLine = -1;
  function scrollToLine(line) {
    if (line === lastLine) return; lastLine = line;
    const els = [...content.querySelectorAll('[data-line]')];
    let prev = null, next = null;
    for (const el of els) { const l = +el.dataset.line; if (l <= line) prev = el; else { next = el; break; } }
    if (!prev) { window.scrollTo({ top: 0 }); return; }
    const pl = +prev.dataset.line, top = prev.getBoundingClientRect().top + window.scrollY;
    let y = top;
    if (next) {
      const nl = +next.dataset.line, ntop = next.getBoundingClientRect().top + window.scrollY;
      y = top + (ntop - top) * ((line - pl) / Math.max(1, nl - pl));
    }
    window.scrollTo({ top: Math.max(0, y - 60) });
  }

  let tt;
  function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

  vscode.postMessage({ type: 'ready' });
})();
