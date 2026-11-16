import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Brand, brandCss, findBrandFile, loadBrand } from './brand';
import { isExternal, render, titleBlock } from './render';

export interface Diagram { png?: string | null; svg?: string; w: number; h: number }

const isMd = (d?: vscode.TextDocument) => !!d && (d.languageId === 'markdown' || /\.(md|markdown|mdx)$/i.test(d.fileName));

export type Mode = 'preview' | 'editor';

export class BrokerDocsPreview implements vscode.Disposable {
  /** Todas las vistas abiertas (panel lateral + editores personalizados). */
  static instances = new Set<BrokerDocsPreview>();
  /** Panel lateral único ("Abrir vista BrokerDocs al lado"). */
  static side: BrokerDocsPreview | undefined;
  private static active: BrokerDocsPreview | undefined;
  static get current(): BrokerDocsPreview | undefined {
    return (BrokerDocsPreview.active && BrokerDocsPreview.instances.has(BrokerDocsPreview.active) ? BrokerDocsPreview.active : undefined)
      ?? BrokerDocsPreview.side ?? [...BrokerDocsPreview.instances][0];
  }
  static forDocument(doc: vscode.TextDocument) {
    return [...BrokerDocsPreview.instances].find(i => i.doc === doc);
  }
  static reloadBrandAll() { for (const i of BrokerDocsPreview.instances) { i.loadBrandData(); i.update(); } }

  private panel: vscode.WebviewPanel;
  private doc: vscode.TextDocument;
  private brand!: Brand;
  private brandFile?: string;
  private disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private ready = false;
  private readyWaiters: (() => void)[] = [];
  private pending = new Map<string, (d: Diagram[]) => void>();
  private lastEditor?: vscode.TextEditor;
  private quietUntil = 0; // evita rebotes editor <-> vista
  private selTimer?: NodeJS.Timeout;
  private static _flash: vscode.TextEditorDecorationType | undefined;
  private static get flash() {
    return BrokerDocsPreview._flash ??= vscode.window.createTextEditorDecorationType({
      isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.rangeHighlightForeground'), overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
  }


  static show(ctx: vscode.ExtensionContext, doc: vscode.TextDocument, column: vscode.ViewColumn) {
    const existing = BrokerDocsPreview.forDocument(doc);
    if (existing && existing.mode === 'editor') { existing.panel.reveal(undefined, true); return existing; }
    if (BrokerDocsPreview.side) {
      BrokerDocsPreview.side.setDocument(doc);
      BrokerDocsPreview.side.panel.reveal(column, true);
      return BrokerDocsPreview.side;
    }
    BrokerDocsPreview.side = new BrokerDocsPreview(ctx, doc, column, 'preview');
    return BrokerDocsPreview.side;
  }

  /** Usado por el editor personalizado (menú "Reopen with" / "Set Default"). */
  static attach(ctx: vscode.ExtensionContext, doc: vscode.TextDocument, panel: vscode.WebviewPanel) {
    return new BrokerDocsPreview(ctx, doc, panel, 'editor');
  }

  private constructor(private ctx: vscode.ExtensionContext, doc: vscode.TextDocument,
    target: vscode.ViewColumn | vscode.WebviewPanel, readonly mode: Mode) {
    this.doc = doc;
    this.loadBrandData();
    if (typeof target === 'object') {
      this.panel = target;
      this.panel.webview.options = { enableScripts: true, localResourceRoots: this.roots() };
    } else {
      this.panel = vscode.window.createWebviewPanel('brokerdocs.preview', this.titleFor(doc), { viewColumn: target, preserveFocus: true }, {
        enableScripts: true, retainContextWhenHidden: true, localResourceRoots: this.roots(),
      });
      this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'images', 'icon.png');
    }
    BrokerDocsPreview.instances.add(this);
    BrokerDocsPreview.active = this;
    this.panel.webview.html = this.shell();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(e => { if (e.webviewPanel.active) BrokerDocsPreview.active = this; }, null, this.disposables);
    this.panel.webview.onDidReceiveMessage(m => this.onMessage(m), null, this.disposables);

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === this.doc) this.schedule();
        else if (this.brandFile && e.document.fileName === this.brandFile) this.schedule(true);
      }),
      vscode.workspace.onDidSaveTextDocument(d => { if (/brand\.json$/i.test(d.fileName)) { this.loadBrandData(); this.update(); } }),
      vscode.window.onDidChangeActiveTextEditor(ed => {
        if (ed && isMd(ed.document)) {
          if (ed.document === this.doc) this.lastEditor = ed;
          if (this.mode === 'preview' && ed.document !== this.doc && this.cfg().get('followActiveEditor', true)) {
            this.lastEditor = ed; this.setDocument(ed.document);
          }
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor.document !== this.doc || !this.cfg().get('selectionSync', true)) return;
        if (e.kind === vscode.TextEditorSelectionChangeKind.Command || Date.now() < this.quietUntil) return;
        clearTimeout(this.selTimer);
        this.selTimer = setTimeout(() => this.post({ type: 'highlight', line: e.selections[0].active.line }), 60);
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        if (Date.now() < this.quietUntil) return;
        if (e.textEditor.document === this.doc && this.cfg().get('syncScroll', true) && e.visibleRanges.length) {
          this.post({ type: 'scrollTo', line: e.visibleRanges[0].start.line });
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('brokerdocs')) { this.loadBrandData(); this.update(); } }),
    );
  }

  get document() { return this.doc; }
  get brandData() { return this.brand; }
  get brandPath() { return this.brandFile; }
  cfg() { return vscode.workspace.getConfiguration('brokerdocs', this.doc.uri); }

  /** Editor de texto asociado al documento (para insertar contenido). */
  async editor(): Promise<vscode.TextEditor | undefined> {
    const vis = vscode.window.visibleTextEditors.find(e => e.document === this.doc);
    if (vis) return vis;
    // sin código visible: se abre al lado para que el usuario ubique el cursor
    await this.showSource();
    this.post({ type: 'toast', text: 'Abrí el código al lado: ubica el cursor y vuelve a usar la barra' });
    return undefined;
  }

  /** Abre el Markdown original al lado (según brokerdocs.sourceSide). */
  async showSource() {
    const vis = vscode.window.visibleTextEditors.find(e => e.document === this.doc);
    if (vis) { await vscode.window.showTextDocument(this.doc, vis.viewColumn, false); return; }
    await this.arrange();
  }

  private sideOf(): 'left' | 'right' | undefined {
    const vis = vscode.window.visibleTextEditors.find(e => e.document === this.doc);
    if (!vis?.viewColumn || !this.panel.viewColumn) return undefined;
    return vis.viewColumn < this.panel.viewColumn ? 'left' : 'right';
  }

  /** Intercambia código y vista de lado, y recuerda la preferencia. */
  async swap() {
    const now = this.sideOf() ?? this.cfg().get<'left' | 'right'>('sourceSide', 'left');
    const next = now === 'left' ? 'right' : 'left';
    await vscode.workspace.getConfiguration('brokerdocs').update('sourceSide', next, vscode.ConfigurationTarget.Global);
    await this.arrange(next);
  }

  /** Ubica el código en una columna y BrokerDocs en la otra. */
  async arrange(side?: 'left' | 'right') {
    side ??= this.cfg().get<'left' | 'right'>('sourceSide', 'left');
    const codeCol = side === 'left' ? vscode.ViewColumn.One : vscode.ViewColumn.Two;
    const brokerdocsCol = side === 'left' ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
    const key = this.doc.uri.toString();
    const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => ({ g, t })));
    this.quietUntil = Date.now() + 800;

    if (this.mode === 'preview') this.panel.reveal(brokerdocsCol, true);
    await vscode.window.showTextDocument(this.doc, { viewColumn: codeCol, preserveFocus: this.mode === 'preview', preview: false });
    const strayText = tabs().filter(({ g, t }) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key && g.viewColumn !== codeCol).map(x => x.t);
    if (strayText.length) await vscode.window.tabGroups.close(strayText, true);

    if (this.mode === 'editor' && this.panel.viewColumn !== brokerdocsCol) {
      const old = tabs().filter(({ g, t }) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'brokerdocs.editor' &&
        t.input.uri.toString() === key && g.viewColumn !== brokerdocsCol).map(x => x.t);
      await vscode.commands.executeCommand('vscode.openWith', this.doc.uri, 'brokerdocs.editor', { viewColumn: brokerdocsCol, preserveFocus: true });
      if (old.length) await vscode.window.tabGroups.close(old, true);
    }
  }

  /** Marca en el código lo que se seleccionó en la vista. */
  private async selectSource(line: number, end: number | undefined, text: string, focus: boolean) {
    let ed = vscode.window.visibleTextEditors.find(e => e.document === this.doc);
    if (!ed) {
      if (!focus) return;
      await this.arrange(); ed = vscode.window.visibleTextEditors.find(e => e.document === this.doc); if (!ed) return;
    }
    const d = this.doc;
    const start = Math.max(0, Math.min(line, d.lineCount - 1));
    const stop = Math.max(start, Math.min((end ?? line + 1) - 1, d.lineCount - 1));
    const block = new vscode.Range(start, 0, stop, d.lineAt(stop).text.length);
    let range: vscode.Range = block;
    const t = text.replace(/\s+/g, ' ').trim();
    if (t) {
      // busca el texto marcado dentro del bloque (tolerando espacios y marcas de formato)
      const src = d.getText(block), base = d.offsetAt(block.start);
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const words = t.split(' ').slice(0, 40).map(esc).join('[\\s*_`~\\[\\]()]*\\s*[*_`~]*');
      const m = new RegExp(words, 'i').exec(src);
      if (m) range = new vscode.Range(d.positionAt(base + m.index), d.positionAt(base + m.index + m[0].length));
    }
    this.quietUntil = Date.now() + 500;
    ed.selection = new vscode.Selection(range.start, range.end);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    ed.setDecorations(BrokerDocsPreview.flash, [block]);
    setTimeout(() => ed!.setDecorations(BrokerDocsPreview.flash, []), 1200);
    if (focus) await vscode.window.showTextDocument(d, ed.viewColumn, false);
  }

  setDocument(doc: vscode.TextDocument) {
    if (doc === this.doc || this.mode === 'editor') return;
    this.doc = doc;
    this.panel.title = this.titleFor(doc);
    this.panel.webview.options = { ...this.panel.webview.options, localResourceRoots: this.roots() };
    this.loadBrandData();
    this.update();
  }

  private titleFor(d: vscode.TextDocument) { return 'BrokerDocs · ' + path.basename(d.fileName); }

  private roots(): vscode.Uri[] {
    const r = [vscode.Uri.joinPath(this.ctx.extensionUri, 'media'), vscode.Uri.joinPath(this.ctx.extensionUri, 'images')];
    for (const f of vscode.workspace.workspaceFolders || []) r.push(f.uri);
    if (this.doc.uri.scheme === 'file') r.push(vscode.Uri.file(path.dirname(this.doc.fileName)));
    if (this.brand?.logo) r.push(vscode.Uri.file(path.dirname(this.brand.logo)));
    return r;
  }

  private loadBrandData() {
    const c = vscode.workspace.getConfiguration('brokerdocs', this.doc.uri);
    const roots = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
    this.brandFile = findBrandFile(this.doc.uri.scheme === 'file' ? this.doc.fileName : undefined, c.get<string>('brandFile') || undefined, roots);
    this.brand = loadBrand(this.brandFile, c.get('brand') || {});
  }

  private schedule(reloadBrand = false) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (reloadBrand) this.loadBrandData(); this.update(); }, this.cfg().get('debounceMs', 120));
  }

  private baseDir() { return this.doc.uri.scheme === 'file' ? path.dirname(this.doc.fileName) : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''); }

  update() {
    if (!this.ready) return;
    const base = this.baseDir();
    const wv = this.panel.webview;
    const resolveLocal = (s: string) => {
      const clean = decodeURIComponent(s.replace(/[?#].*$/, ''));
      return path.isAbsolute(clean) ? clean : path.resolve(base, clean);
    };
    const r = render(this.doc.getText(), {
      resolveImage: s => wv.asWebviewUri(vscode.Uri.file(resolveLocal(s))).toString(),
      linkExists: s => { if (!base || isExternal(s) || s.startsWith('#')) return true; try { return fs.existsSync(resolveLocal(s)); } catch { return true; } },
    });
    const b = this.brand;
    const showBar = this.cfg().get('preview.showBrandHeader', true) && (b.logo || b.empresa);
    const brandBar = showBar
      ? `${b.logo ? `<img src="${wv.asWebviewUri(vscode.Uri.file(b.logo))}" alt="">` : '<span></span>'}<span>${b.empresa.replace(/</g, '&lt;')}</span>` : '';
    this.post({
      type: 'update', html: r.html, title: titleBlock(r.meta, b.autor), headings: r.headings, words: r.words,
      hasMermaid: r.hasMermaid, brandCss: brandCss(b), brand: b, brandBar,
    });
  }

  post(msg: any) { return this.panel.webview.postMessage(msg); }

  /** Pide a la vista los diagramas renderizados (PNG + SVG). */
  async collectDiagrams(): Promise<Diagram[]> {
    await this.whenReady();
    const id = Math.random().toString(36).slice(2);
    return new Promise(res => {
      const to = setTimeout(() => { this.pending.delete(id); res([]); }, 15000);
      this.pending.set(id, d => { clearTimeout(to); res(d); });
      this.post({ type: 'collectDiagrams', id });
    });
  }

  private whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise(r => this.readyWaiters.push(r));
  }

  private async onMessage(m: any) {
    switch (m.type) {
      case 'ready':
        this.ready = true; this.update();
        setTimeout(() => { this.readyWaiters.splice(0).forEach(f => f()); }, 50);
        break;
      case 'diagrams': this.pending.get(m.id)?.(m.diagrams || []); this.pending.delete(m.id); break;
      case 'openLink': await this.openLink(m.href); break;
      case 'revealLine': await this.selectSource(m.line, m.end, m.text || '', true); break;
      case 'selectSource': if (this.cfg().get('selectionSync', true)) await this.selectSource(m.line, m.end, m.text || '', false); break;
      case 'action':
        if (m.action === 'source') await this.showSource();
        else if (m.action === 'swap') await this.swap();
        else if (m.action === 'brand') await vscode.commands.executeCommand('brokerdocs.editBrand');
        else { BrokerDocsPreview.active = this; await vscode.commands.executeCommand(`brokerdocs.insert.${m.action}`); }
        break;
      case 'export': await vscode.commands.executeCommand(`brokerdocs.export.${m.format}`, this.doc.uri); break;
      case 'saveFile': await vscode.commands.executeCommand('brokerdocs.internal.saveDropped', m); break;
    }
  }

  private editorColumn() {
    return vscode.window.visibleTextEditors.find(e => e.document === this.doc)?.viewColumn ?? vscode.ViewColumn.One;
  }

  private async openLink(href: string) {
    if (isExternal(href)) { await vscode.env.openExternal(vscode.Uri.parse(href)); return; }
    const [file, frag] = href.split('#');
    const abs = path.resolve(this.baseDir(), decodeURIComponent(file.split('?')[0]));
    if (!fs.existsSync(abs)) { vscode.window.showWarningMessage(`BrokerDocs: no existe el archivo ${file}`); return; }
    const uri = vscode.Uri.file(abs);
    if (/\.(md|markdown|mdx)$/i.test(abs)) {
      const d = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(d, this.editorColumn());
      this.setDocument(d);
      if (frag) setTimeout(() => this.post({ type: 'update-anchor', id: frag }), 200);
      return;
    }
    const inVsCode = /\.(txt|json|ya?ml|csv|log|png|jpe?g|gif|svg|webp|pdf|js|ts|py|sql|html?|css|xml)$/i.test(abs);
    if (inVsCode) await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: this.editorColumn(), preview: true });
    else await vscode.env.openExternal(uri); // Word, Excel, zip… con la app del sistema
  }

  private shell(): string {
    const wv = this.panel.webview;
    const media = (f: string) => wv.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const btn = (act: string, label: string, title: string) => `<button data-act="${act}" title="${title}">${label}</button>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${wv.cspSource} https: data: blob:; style-src ${wv.cspSource} 'unsafe-inline'; font-src ${wv.cspSource} data:; script-src 'nonce-${nonce}' ${wv.cspSource};">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${media('brokerdocs.css')}"><link rel="stylesheet" href="${media('preview.css')}">
</head><body data-mermaid="${media('mermaid.min.js')}">
<div id="bar">
${btn('bold', '<b>B</b>', 'Negrita (Ctrl+B)')}${btn('italic', '<i>I</i>', 'Cursiva (Ctrl+I)')}${btn('strike', '<s>S</s>', 'Tachado')}${btn('code', '&lt;/&gt;', 'Código')}
<span class="sep"></span>${btn('h1', 'H1', 'Título 1')}${btn('h2', 'H2', 'Título 2')}${btn('h3', 'H3', 'Título 3')}
<span class="sep"></span>${btn('bullet', '•≡', 'Lista')}${btn('numbered', '1≡', 'Lista numerada')}${btn('task', '☑', 'Tarea')}${btn('quote', '❝', 'Nota / callout')}
<span class="sep"></span>${btn('link', '🔗', 'Enlace')}${btn('image', '🖼', 'Imagen')}${btn('attachment', '📎', 'Adjuntar archivo')}${btn('table', '▦', 'Tabla')}${btn('diagram', '◇', 'Diagrama de flujo')}
<span class="sep"></span>${btn('toc', '☰', 'Índice')}${btn('source', '{ }', 'Ver código al lado')}${btn('swap', '⇄', 'Intercambiar lados: código / vista')}${btn('brand', '🎨', 'Editar marca (colores, logo, fuentes)')}
<span class="grow"></span><span class="stats" id="stats"></span>
<button class="exp" data-export="docx" title="Exportar a Word">Word</button>
<button class="exp" data-export="pdf" title="Exportar a PDF">PDF</button>
<button class="exp" data-export="html" title="Exportar HTML autónomo">HTML</button>
</div>
<div id="wrap"><nav id="toc"></nav><main id="page"><div id="paper"><div class="brokerdocs-brandbar" id="brandbar" style="display:none"></div><article id="content" class="brokerdocs-doc"></article></div></main></div>
<div id="drop">Suelta para insertar en el documento</div><div id="toast"></div>
<script nonce="${nonce}" src="${media('preview.js')}"></script>
</body></html>`;
  }

  dispose() {
    BrokerDocsPreview.instances.delete(this);
    if (BrokerDocsPreview.side === this) BrokerDocsPreview.side = undefined;
    if (BrokerDocsPreview.active === this) BrokerDocsPreview.active = undefined;
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

export { isMd };
