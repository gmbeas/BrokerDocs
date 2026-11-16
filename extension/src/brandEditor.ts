import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findBrandFile, loadBrand } from './brand';
import { BrokerDocsPreview } from './preview';

let panel: vscode.WebviewPanel | undefined;

function targetFile(): string | undefined {
  const cur = BrokerDocsPreview.current;
  const roots = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  const doc = cur?.document ?? vscode.window.activeTextEditor?.document;
  const docPath = doc?.uri.scheme === 'file' ? doc.fileName : undefined;
  const explicit = vscode.workspace.getConfiguration('brokerdocs', doc?.uri).get<string>('brandFile') || undefined;
  const found = cur?.brandPath ?? findBrandFile(docPath, explicit, roots);
  if (found) return found;
  const ws = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) || vscode.workspace.workspaceFolders?.[0];
  if (ws) return path.join(ws.uri.fsPath, '.brokerdocs', 'brand.json');
  if (docPath) return path.join(path.dirname(docPath), '.brokerdocs', 'brand.json');
  return undefined;
}

export async function openBrandEditor(ctx: vscode.ExtensionContext) {
  const file = targetFile();
  if (!file) { vscode.window.showWarningMessage('BrokerDocs: abre una carpeta o un archivo Markdown para definir la marca.'); return; }
  const dir = path.dirname(file);
  if (panel) { panel.reveal(); post(); return; }
  const b0 = loadBrand(fs.existsSync(file) ? file : undefined);
  const roots = [vscode.Uri.file(dir), vscode.Uri.joinPath(ctx.extensionUri, 'media')];
  if (b0.logo) roots.push(vscode.Uri.file(path.dirname(b0.logo)));
  panel = vscode.window.createWebviewPanel('brokerdocs.brand', 'BrokerDocs · Marca', vscode.ViewColumn.Active, {
    enableScripts: true, localResourceRoots: roots,
  });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'images', 'icon.png');
  panel.onDidDispose(() => { panel = undefined; });

  let raw: any = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* nuevo */ }

  function post() {
    const b = loadBrand(fs.existsSync(file!) ? file : undefined);
    const logoUri = b.logo ? panel!.webview.asWebviewUri(vscode.Uri.file(b.logo)).toString() + '?t=' + Date.now() : '';
    panel!.webview.postMessage({ type: 'load', brand: b, logoUri, file: vscode.workspace.asRelativePath(file!) });
  }

  panel.webview.onDidReceiveMessage(async m => {
    if (m.type === 'ready') post();
    if (m.type === 'pickLogo') {
      const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Imagen: ['png', 'jpg', 'jpeg'] }, openLabel: 'Usar como logo' });
      if (!pick?.[0]) return;
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, 'logo' + path.extname(pick[0].fsPath).toLowerCase());
      fs.copyFileSync(pick[0].fsPath, dest);
      raw.logo = path.basename(dest);
      panel!.webview.postMessage({ type: 'logo', logo: raw.logo, logoUri: panel!.webview.asWebviewUri(vscode.Uri.file(dest)).toString() + '?t=' + Date.now() });
    }
    if (m.type === 'save') {
      const b = m.brand;
      const keepLogo = !('logo' in b);
      const prevLogo = raw.logo;
      raw = { ...raw, ...b, colores: { ...(raw.colores || {}), ...b.colores } };
      if (keepLogo) raw.logo = prevLogo;
      if (!raw.logo) delete raw.logo;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
      BrokerDocsPreview.reloadBrandAll();
      panel!.webview.postMessage({ type: 'saved' });
      vscode.window.setStatusBarMessage('BrokerDocs: marca guardada en ' + vscode.workspace.asRelativePath(file), 3000);
    }
    if (m.type === 'openJson') {
      if (!fs.existsSync(file)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, '{}\n'); }
      vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside });
    }
  });

  const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', 'brokerdocs.css'));
  const nonce = Math.random().toString(36).slice(2);
  panel.webview.html = /* html */ `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"><style id="vars"></style>
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0}
.wrap{display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:24px;padding:20px 24px;max-width:1300px}
h2{font-size:15px;margin:0 0 4px}.sub{opacity:.65;font-size:12px;margin-bottom:16px}
fieldset{border:1px solid var(--vscode-panel-border,#ccc);border-radius:8px;padding:10px 12px 12px;margin:0 0 14px}
legend{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.7;padding:0 4px}
label{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;margin:6px 0}
input[type=text]{flex:1;max-width:200px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#ccc);border-radius:4px;padding:4px 6px}
.color{display:flex;gap:6px;align-items:center}.color input[type=color]{width:34px;height:26px;border:0;padding:0;background:none;cursor:pointer}
.color input[type=text]{width:78px;font-family:monospace}
.presets{display:flex;flex-wrap:wrap;gap:6px}.presets button{all:unset;cursor:pointer;display:flex;gap:2px;padding:4px;border-radius:6px;border:1px solid var(--vscode-panel-border,#ccc)}
.presets button:hover{border-color:var(--vscode-focusBorder)}.presets i{width:14px;height:22px;border-radius:3px;display:block}
.logo{display:flex;align-items:center;gap:10px}.logo img{max-height:40px;max-width:160px;background:#fff;border-radius:4px;padding:3px}
.btns{display:flex;gap:8px;margin-top:6px;position:sticky;bottom:0;padding:10px 0;background:var(--vscode-editor-background)}
.btn{all:unset;cursor:pointer;padding:6px 14px;border-radius:4px;font-size:13px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn.pri{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.ok{font-size:12px;color:#16A34A;opacity:0;transition:opacity .3s;align-self:center}.ok.show{opacity:1}
.paper{background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.15);overflow:hidden;align-self:start;position:sticky;top:20px}
.paper .brokerdocs-doc{padding:6px 32px 28px;font-size:14px}
</style></head><body>
<div class="wrap"><div>
<h2>Marca del documento</h2><div class="sub" id="file"></div>
<fieldset><legend>Identidad</legend>
<label>Empresa <input type="text" id="empresa" placeholder="Mi Empresa"></label>
<label>Autor <input type="text" id="autor" placeholder="Equipo"></label>
<label>Pie de página <input type="text" id="pie" placeholder="Documento interno"></label>
<div class="logo"><img id="logoImg" alt="" style="display:none"><button class="btn" id="logoBtn">Elegir logo…</button><button class="btn" id="logoDel" title="Quitar logo">✕</button></div>
</fieldset>
<fieldset><legend>Paletas rápidas</legend><div class="presets" id="presets"></div></fieldset>
<fieldset><legend>Colores</legend><div id="colors"></div></fieldset>
<fieldset><legend>Fuentes</legend>
<label>Texto <input type="text" id="fuente" list="fonts"></label>
<label>Títulos <input type="text" id="fuente_titulos" list="fonts"></label>
<label>Código <input type="text" id="fuente_codigo" list="mono"></label>
<datalist id="fonts"><option>Calibri<option>Aptos<option>Arial<option>Segoe UI<option>Helvetica<option>Inter<option>Roboto<option>Open Sans<option>Lato<option>Montserrat<option>Georgia<option>Cambria<option>Times New Roman</datalist>
<datalist id="mono"><option>Consolas<option>Cascadia Code<option>JetBrains Mono<option>Courier New<option>Menlo</datalist>
</fieldset>
<div class="btns"><button class="btn pri" id="save">Guardar</button><button class="btn" id="json">Abrir JSON</button><span class="ok" id="ok">✓ Guardado</span></div>
</div>
<div class="paper"><div class="brokerdocs-brandbar" id="bar"></div><article class="brokerdocs-doc">
<header class="brokerdocs-title"><div class="kicker">Informe semanal</div><h1 class="doc-title">Avance semana 47</h1><div class="doc-info">Portal de Pedidos · 2026-11-22 · <span id="pAutor"></span></div></header>
<h2>Resumen</h2><p>El login con SSO quedó <strong>operativo</strong> en staging. Detalle en <a href="#">la guía de arquitectura</a> y configuración en <code>appsettings.json</code>.</p>
<blockquote class="callout callout-plain" data-title="Riesgo"><p>El certificado del IdP vence el 30/11.</p></blockquote>
<table><thead><tr><th>Indicador</th><th>Meta</th><th>Actual</th></tr></thead><tbody><tr><td>Servicios migrados</td><td>10</td><td>7</td></tr><tr><td>Tiempo de respuesta</td><td>&lt; 2 s</td><td>1,4 s</td></tr><tr><td>Errores por día</td><td>&lt; 5</td><td>3</td></tr></tbody></table>
<h3>Próximos pasos</h3><ol><li>Pasar SSO a producción</li><li>Pruebas de carga</li></ol>
<div style="display:flex;justify-content:space-between;color:var(--f-gray);font-size:11px;border-top:1px solid #eee;padding-top:8px;margin-top:20px"><span id="pPie"></span><span>Página 1 de 1</span></div>
</article></div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi(); const $ = id => document.getElementById(id);
const KEYS = [['primario','Principal (títulos, tablas)'],['secundario','Secundario (enlaces)'],['acento','Acento (líneas, notas)'],['texto','Texto'],['gris','Gris (metadatos)'],['fondo_suave','Fondo suave (filas, notas)']];
const PRESETS = {
  'Azul corporativo': {primario:'1E40AF',secundario:'0EA5E9',acento:'F59E0B',texto:'1F2937',gris:'6B7280',fondo_suave:'EFF6FF'},
  'Verde': {primario:'166534',secundario:'0D9488',acento:'EAB308',texto:'1C1917',gris:'78716C',fondo_suave:'F0FDF4'},
  'Grafito': {primario:'111827',secundario:'2563EB',acento:'EF4444',texto:'111827',gris:'6B7280',fondo_suave:'F3F4F6'},
  'Vino': {primario:'7F1D1D',secundario:'B45309',acento:'D97706',texto:'292524',gris:'78716C',fondo_suave:'FEF2F2'},
  'Violeta': {primario:'5B21B6',secundario:'DB2777',acento:'F59E0B',texto:'1F2937',gris:'6B7280',fondo_suave:'F5F3FF'},
  'Petróleo': {primario:'0F4C5C',secundario:'0891B2',acento:'F97316',texto:'1E293B',gris:'64748B',fondo_suave:'ECFEFF'},
};
let brand = null, logoUri = '';
$('colors').innerHTML = KEYS.map(([k,l]) => '<label>'+l+'<span class="color"><input type="color" data-k="'+k+'"><input type="text" data-hex="'+k+'" maxlength="7"></span></label>').join('');
$('presets').innerHTML = Object.entries(PRESETS).map(([n,p]) => '<button title="'+n+'" data-p="'+n+'">'+['primario','secundario','acento','fondo_suave'].map(k=>'<i style="background:#'+p[k]+'"></i>').join('')+'</button>').join('');
const clean = v => (v||'').replace('#','').toUpperCase();
function apply() {
  const c = brand.colores;
  $('vars').textContent = ':root{--f-pri:#'+c.primario+';--f-sec:#'+c.secundario+';--f-acc:#'+c.acento+';--f-txt:#'+c.texto+';--f-gray:#'+c.gris+';--f-soft:#'+c.fondo_suave+
    ";--f-font:'"+brand.fuente+"',sans-serif;--f-hfont:'"+brand.fuente_titulos+"',sans-serif;--f-mono:'"+brand.fuente_codigo+"',monospace}";
  $('bar').innerHTML = (logoUri ? '<img src="'+logoUri+'">' : '<span></span>') + '<span>'+(brand.empresa||'').replace(/</g,'&lt;')+'</span>';
  $('bar').style.display = (logoUri || brand.empresa) ? '' : 'none';
  $('pAutor').textContent = brand.autor || 'Autor'; $('pPie').textContent = brand.pie || '';
  $('logoImg').src = logoUri; $('logoImg').style.display = logoUri ? '' : 'none'; $('logoDel').style.display = logoUri ? '' : 'none';
}
function fill() {
  for (const k of ['empresa','autor','pie','fuente','fuente_titulos','fuente_codigo']) $(k).value = brand[k] || '';
  for (const [k] of KEYS) { document.querySelector('[data-k='+k+']').value = '#'+brand.colores[k]; document.querySelector('[data-hex='+k+']').value = '#'+brand.colores[k]; }
  apply();
}
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.k) { brand.colores[t.dataset.k] = clean(t.value); document.querySelector('[data-hex='+t.dataset.k+']').value = t.value.toUpperCase(); }
  else if (t.dataset.hex) { const v = clean(t.value); if (/^[0-9A-F]{6}$/.test(v)) { brand.colores[t.dataset.hex] = v; document.querySelector('[data-k='+t.dataset.hex+']').value = '#'+v; } }
  else if (t.id) brand[t.id] = t.value;
  apply();
});
$('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; brand.colores = {...PRESETS[b.dataset.p]}; fill(); });
$('logoBtn').onclick = () => vscode.postMessage({type:'pickLogo'});
$('logoDel').onclick = () => { logoUri = ''; brand.logoName = ''; apply(); };
$('json').onclick = () => vscode.postMessage({type:'openJson'});
$('save').onclick = () => {
  const out = {}; for (const k of ['empresa','autor','pie','fuente','fuente_titulos','fuente_codigo']) out[k] = brand[k] || '';
  out.colores = brand.colores;
  if (brand.logoName) out.logo = brand.logoName; else if (!logoUri) out.logo = '';
  vscode.postMessage({type:'save', brand: out});
};
window.addEventListener('message', ev => {
  const m = ev.data;
  if (m.type === 'load') { brand = m.brand; logoUri = m.logoUri; $('file').textContent = 'Se guarda en ' + m.file; fill(); }
  if (m.type === 'logo') { brand.logoName = m.logo; logoUri = m.logoUri; apply(); }
  if (m.type === 'saved') { $('ok').classList.add('show'); setTimeout(() => $('ok').classList.remove('show'), 1800); }
});
vscode.postMessage({type:'ready'});
</script></body></html>`;
}
