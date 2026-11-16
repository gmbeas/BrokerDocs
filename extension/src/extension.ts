import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildDocx } from './export/docx';
import { buildHtml } from './export/html';
import { findBrowser, htmlToPdf } from './export/pdf';
import { openBrandEditor } from './brandEditor';
import { BrokerDocsPreview, isMd } from './preview';

let ctx: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  ctx = context;
  const reg = (id: string, fn: (...a: any[]) => any) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('brokerdocs.openPreview', (uri?: vscode.Uri) => openPreview(uri, vscode.ViewColumn.Beside));
  reg('brokerdocs.openPreviewHere', (uri?: vscode.Uri) => openPreview(uri, vscode.ViewColumn.Active));
  reg('brokerdocs.export.docx', (uri?: vscode.Uri) => exportAs('docx', uri));
  reg('brokerdocs.export.pdf', (uri?: vscode.Uri) => exportAs('pdf', uri));
  reg('brokerdocs.export.html', (uri?: vscode.Uri) => exportAs('html', uri));
  reg('brokerdocs.createBrand', () => openBrandEditor(context));
  reg('brokerdocs.editBrand', () => openBrandEditor(context));
  reg('brokerdocs.showSource', async (uri?: vscode.Uri) => {
    const doc = await targetDoc(uri); if (!doc) return;
    const inst = BrokerDocsPreview.forDocument(doc);
    if (inst) await inst.showSource();
    else await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  });
  reg('brokerdocs.swapSides', async (uri?: vscode.Uri) => {
    const doc = await targetDoc(uri); if (!doc) return;
    const inst = BrokerDocsPreview.forDocument(doc) ?? BrokerDocsPreview.show(ctx, doc, vscode.ViewColumn.Beside);
    await inst.swap();
  });
  reg('brokerdocs.reopenAsBrokerDocs', async (uri?: vscode.Uri) => {
    const doc = await targetDoc(uri); if (!doc) return;
    await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'brokerdocs.editor');
  });

  // editor personalizado: aparece en "Reopen Editor With…" y en "Set Default for '*.md'"
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('brokerdocs.editor', {
    resolveCustomTextEditor(document, panel) { BrokerDocsPreview.attach(context, document, panel); },
  }, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));

  // recargar la marca si cambia cualquier brand.json (también si se edita fuera de VS Code)
  const w = vscode.workspace.createFileSystemWatcher('**/{.brokerdocs/brand.json,.folio/brand.json,brand.json,.brokerdocs/logo.*}');
  const reload = () => BrokerDocsPreview.reloadBrandAll();
  context.subscriptions.push(w, w.onDidChange(reload), w.onDidCreate(reload), w.onDidDelete(reload));
  reg('brokerdocs.internal.saveDropped', saveDropped);

  // edición
  reg('brokerdocs.insert.bold', () => wrap('**'));
  reg('brokerdocs.insert.italic', () => wrap('*'));
  reg('brokerdocs.insert.strike', () => wrap('~~'));
  reg('brokerdocs.insert.code', () => wrap('`'));
  reg('brokerdocs.insert.h1', () => linePrefix('# ', /^#{1,6}\s/));
  reg('brokerdocs.insert.h2', () => linePrefix('## ', /^#{1,6}\s/));
  reg('brokerdocs.insert.h3', () => linePrefix('### ', /^#{1,6}\s/));
  reg('brokerdocs.insert.bullet', () => linePrefix('- ', /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/));
  reg('brokerdocs.insert.numbered', () => linePrefix('1. ', /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/));
  reg('brokerdocs.insert.task', () => linePrefix('- [ ] ', /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/));
  reg('brokerdocs.insert.quote', () => snippet('\n> [!${1|NOTE,TIP,IMPORTANT,WARNING,CAUTION|}]\n> ${2:${TM_SELECTED_TEXT:texto}}\n'));
  reg('brokerdocs.insert.link', () => snippet('[${1:${TM_SELECTED_TEXT:texto}}](${2:https://})'));
  reg('brokerdocs.insert.table', insertTable);
  reg('brokerdocs.insert.diagram', () => snippet('\n```mermaid\nflowchart LR\n  A[${1:Inicio}] --> B{${2:¿Decisión?}}\n  B -->|Sí| C[${3:Acción}]\n  B -->|No| D[${4:Fin}]\n```\n'));
  reg('brokerdocs.insert.image', () => pickAndInsert('image'));
  reg('brokerdocs.insert.attachment', () => pickAndInsert('attachment'));

  // barra de estado
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sb.text = '$(book) BrokerDocs'; sb.tooltip = 'Abrir vista BrokerDocs'; sb.command = 'brokerdocs.openPreview';
  const refresh = () => (isMd(vscode.window.activeTextEditor?.document) ? sb.show() : sb.hide());
  context.subscriptions.push(sb, vscode.window.onDidChangeActiveTextEditor(refresh));
  refresh();

}

export function deactivate() { for (const i of [...BrokerDocsPreview.instances]) i.dispose(); }

// ---------------- vista previa ----------------
async function targetDoc(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  if (uri instanceof vscode.Uri) return vscode.workspace.openTextDocument(uri);
  const ed = vscode.window.activeTextEditor;
  if (ed && isMd(ed.document)) return ed.document;
  if (BrokerDocsPreview.current) return BrokerDocsPreview.current.document;
  const any = vscode.window.visibleTextEditors.find(e => isMd(e.document));
  if (any) return any.document;
  vscode.window.showInformationMessage('BrokerDocs: abre un archivo Markdown primero.');
  return undefined;
}

async function openPreview(uri: vscode.Uri | undefined, column: vscode.ViewColumn) {
  const doc = await targetDoc(uri);
  if (doc) return BrokerDocsPreview.show(ctx, doc, column);
}

// ---------------- edición ----------------
async function editor(): Promise<vscode.TextEditor | undefined> {
  const ed = vscode.window.activeTextEditor;
  if (ed && isMd(ed.document)) return ed;
  if (BrokerDocsPreview.current) return BrokerDocsPreview.current.editor();
  return undefined;
}

async function wrap(mark: string) {
  const ed = await editor(); if (!ed) return;
  await ed.edit(eb => {
    for (const sel of ed.selections) {
      let range: vscode.Range = sel;
      if (sel.isEmpty) range = ed.document.getWordRangeAtPosition(sel.active) || sel;
      const text = ed.document.getText(range);
      const wrapped = text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2;
      eb.replace(range, wrapped ? text.slice(mark.length, -mark.length) : `${mark}${text}${mark}`);
    }
  });
  if (ed.selection.isEmpty && !ed.document.getWordRangeAtPosition(ed.selection.active)) {
    const p = ed.selection.active.translate(0, -mark.length);
    ed.selection = new vscode.Selection(p, p);
  }
}

async function linePrefix(prefix: string, existing: RegExp) {
  const ed = await editor(); if (!ed) return;
  await ed.edit(eb => {
    const lines = new Set<number>();
    for (const s of ed.selections) for (let l = s.start.line; l <= s.end.line; l++) lines.add(l);
    let n = 1;
    for (const l of [...lines].sort((a, b) => a - b)) {
      const line = ed.document.lineAt(l);
      const m = existing.exec(line.text);
      const indent = m?.[1] && !prefix.startsWith('#') ? m[1] : '';
      const p = prefix === '1. ' ? `${n++}. ` : prefix;
      const current = m ? m[0].slice(indent.length) : '';
      const range = new vscode.Range(l, 0, l, m ? m[0].length : 0);
      eb.replace(range, current === p ? indent : indent + p); // alterna
    }
  });
}

async function snippet(s: string) {
  const ed = await editor(); if (!ed) return;
  await ed.insertSnippet(new vscode.SnippetString(s));
}

async function insertTable() {
  const pick = await vscode.window.showQuickPick(['2 × 2', '3 × 3', '4 × 3', '3 × 5', 'Personalizada…'], { placeHolder: 'Columnas × filas' });
  if (!pick) return;
  let cols = 3, rows = 3;
  if (pick.startsWith('Personalizada')) {
    const v = await vscode.window.showInputBox({ prompt: 'Columnas x filas', value: '3x4', validateInput: t => /^\d+\s*[x×]\s*\d+$/.test(t) ? null : 'Formato: 3x4' });
    if (!v) return;
    [cols, rows] = v.split(/[x×]/).map(x => Math.min(12, Math.max(1, parseInt(x, 10))));
  } else [cols, rows] = pick.split('×').map(x => parseInt(x, 10));
  let k = 1;
  const cell = (d: string) => `\${${k++}:${d}}`;
  const head = '| ' + Array.from({ length: cols }, (_, i) => cell(`Columna ${i + 1}`)).join(' | ') + ' |';
  const sep = '|' + Array(cols).fill('---').join('|') + '|';
  const body = Array.from({ length: rows }, () => '| ' + Array.from({ length: cols }, () => cell(' ')).join(' | ') + ' |').join('\n');
  await snippet(`\n${head}\n${sep}\n${body}\n`);
}

// ---------------- imágenes y adjuntos ----------------
function docDir(doc: vscode.TextDocument) {
  return doc.uri.scheme === 'file' ? path.dirname(doc.fileName) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function uniquePath(dir: string, name: string) {
  const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '-');
  const ext = path.extname(safe), base = path.basename(safe, ext);
  let p = path.join(dir, safe), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base}-${i++}${ext}`);
  return p;
}

const toMdPath = (from: string, to: string) => {
  const rel = path.relative(from, to).split(path.sep).join('/');
  return /[\s()]/.test(rel) ? `<${rel}>` : rel;
};

const IMG = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

async function placeFile(doc: vscode.TextDocument, src: string | { name: string; data: Buffer }, kind: 'image' | 'attachment') {
  const dir = docDir(doc); if (!dir) throw new Error('Guarda el documento antes de insertar archivos.');
  const cfg = vscode.workspace.getConfiguration('brokerdocs', doc.uri);
  const folder = path.resolve(dir, cfg.get<string>(kind === 'image' ? 'imagesFolder' : 'attachmentsFolder', kind === 'image' ? 'assets' : 'adjuntos'));
  if (typeof src === 'string') {
    const ws = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(src));
    if (ws && !cfg.get('alwaysCopyFiles', false)) return toMdPath(dir, src); // ya está en el proyecto: solo enlazar
    fs.mkdirSync(folder, { recursive: true });
    const dest = uniquePath(folder, path.basename(src));
    fs.copyFileSync(src, dest);
    return toMdPath(dir, dest);
  }
  fs.mkdirSync(folder, { recursive: true });
  const dest = uniquePath(folder, src.name);
  fs.writeFileSync(dest, src.data);
  return toMdPath(dir, dest);
}

function mdFor(rel: string, name: string, kind: 'image' | 'attachment') {
  const label = path.basename(name, kind === 'image' ? path.extname(name) : '').replace(/[[\]]/g, '');
  return kind === 'image' ? `![${label}](${rel})` : `[${label}](${rel})`;
}

async function pickAndInsert(kind: 'image' | 'attachment') {
  const ed = await editor(); if (!ed) return;
  const files = await vscode.window.showOpenDialog({
    canSelectMany: true, openLabel: kind === 'image' ? 'Insertar imagen' : 'Adjuntar',
    filters: kind === 'image' ? { Imágenes: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] } : undefined,
    defaultUri: vscode.Uri.file(docDir(ed.document) || ''),
  });
  if (!files?.length) return;
  try {
    const parts: string[] = [];
    for (const f of files) {
      const k = kind === 'attachment' && IMG.test(f.fsPath) ? 'attachment' : kind;
      parts.push(mdFor(await placeFile(ed.document, f.fsPath, k), f.fsPath, k));
    }
    await ed.insertSnippet(new vscode.SnippetString(parts.join(kind === 'image' ? '\n\n' : '\n').replace(/\$/g, '\\$')));
  } catch (e: any) { vscode.window.showErrorMessage('BrokerDocs: ' + e.message); }
}

async function saveDropped(m: { name: string; mime: string; data: string }) {
  const ed = await editor(); if (!ed) return;
  const kind: 'image' | 'attachment' = /^image\//.test(m.mime) || IMG.test(m.name) ? 'image' : 'attachment';
  let name = m.name;
  if (kind === 'image' && /^image\.(png|jpe?g)$/i.test(name)) name = `imagen-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}${path.extname(name)}`;
  try {
    const rel = await placeFile(ed.document, { name, data: Buffer.from(m.data, 'base64') }, kind);
    await ed.insertSnippet(new vscode.SnippetString(mdFor(rel, name, kind).replace(/\$/g, '\\$')));
    BrokerDocsPreview.current?.post({ type: 'toast', text: `Insertado: ${rel}` });
  } catch (e: any) { vscode.window.showErrorMessage('BrokerDocs: ' + e.message); }
}

// ---------------- exportación ----------------
async function exportAs(format: 'docx' | 'pdf' | 'html', uri?: vscode.Uri) {
  const doc = await targetDoc(uri); if (!doc) return;
  const preview = BrokerDocsPreview.forDocument(doc) ?? BrokerDocsPreview.show(ctx, doc, vscode.ViewColumn.Beside);
  const cfg = vscode.workspace.getConfiguration('brokerdocs', doc.uri);
  const pageSize = cfg.get<'Letter' | 'A4'>('export.pageSize', 'Letter');
  const base = docDir(doc) || '';
  const defName = doc.uri.scheme === 'file' ? doc.fileName.replace(/\.(md|markdown|mdx)$/i, '') + '.' + format : path.join(base, 'documento.' + format);
  const filters: Record<string, Record<string, string[]>> = { docx: { Word: ['docx'] }, pdf: { PDF: ['pdf'] }, html: { HTML: ['html'] } };
  const target = cfg.get('export.askLocation', true)
    ? await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defName), filters: filters[format] })
    : vscode.Uri.file(defName);
  if (!target) return;

  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `BrokerDocs: exportando a ${format.toUpperCase()}…` }, async () => {
    try {
      const src = doc.getText();
      const diagrams = /```\s*mermaid/i.test(src) ? await preview.collectDiagrams() : [];
      const brand = preview.brandData;
      if (format === 'docx') {
        const buf = await buildDocx(src, brand, { baseDir: base, diagrams, pageSize });
        fs.writeFileSync(target.fsPath, buf);
      } else {
        const html = buildHtml(src, brand, {
          baseDir: base, diagramSvgs: diagrams.map(d => d?.svg || null),
          mediaDir: path.join(ctx.extensionPath, 'media'), pageSize, forPrint: format === 'pdf',
        });
        if (format === 'html') fs.writeFileSync(target.fsPath, html, 'utf8');
        else {
          const browser = findBrowser(cfg.get<string>('export.browserPath') || undefined);
          if (!browser) {
            const tmp = target.fsPath.replace(/\.pdf$/i, '.html');
            fs.writeFileSync(tmp, html, 'utf8');
            const open = 'Abrir HTML';
            const r = await vscode.window.showWarningMessage(
              'BrokerDocs: no encontré Chrome, Edge ni Chromium para generar el PDF. Guardé un HTML: ábrelo y usa Imprimir → Guardar como PDF, o configura "brokerdocs.export.browserPath".', open);
            if (r === open) vscode.env.openExternal(vscode.Uri.file(tmp));
            return;
          }
          await htmlToPdf(html, target.fsPath, browser);
        }
      }
      const open = 'Abrir', folder = 'Mostrar en carpeta';
      vscode.window.showInformationMessage(`BrokerDocs: exportado ${path.basename(target.fsPath)}`, open, folder).then(r => {
        if (r === open) vscode.env.openExternal(target);
        if (r === folder) vscode.commands.executeCommand('revealFileInOS', target);
      });
    } catch (e: any) {
      vscode.window.showErrorMessage('BrokerDocs: error al exportar: ' + (e?.message || e));
    }
  });
}

