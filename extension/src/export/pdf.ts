import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** Busca Chrome, Edge, Chromium o Brave instalado (no se incluye ningún navegador en la extensión). */
export function findBrowser(custom?: string): string | undefined {
  const cands: string[] = [];
  if (custom) cands.push(custom);
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean) as string[];
    for (const b of pf) {
      cands.push(path.join(b, 'Google/Chrome/Application/chrome.exe'), path.join(b, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(b, 'BraveSoftware/Brave-Browser/Application/brave.exe'), path.join(b, 'Chromium/Application/chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser']) {
      cands.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(os.homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    }
  } else {
    const dirs = (process.env.PATH || '/usr/bin').split(':');
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']) {
      for (const d of dirs) cands.push(path.join(d, n));
    }
    cands.push('/snap/bin/chromium');
  }
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

/** Imprime un HTML a PDF con el navegador en modo headless. */
export function htmlToPdf(html: string, outFile: string, browser: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brokerdocs-'));
  const tmpHtml = path.join(tmpDir, 'doc.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--user-data-dir=${path.join(tmpDir, 'profile')}`, '--no-pdf-header-footer', '--virtual-time-budget=4000',
    '--run-all-compositor-stages-before-draw', `--print-to-pdf=${outFile}`, pathToFileURL(tmpHtml).href,
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  return new Promise((resolve, reject) => {
    execFile(browser, args, { timeout: 60000 }, (err, _o, stderr) => {
      fs.rm(tmpDir, { recursive: true, force: true }, () => undefined);
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) resolve();
      else reject(new Error((err?.message || '') + ' ' + (stderr || '').slice(-400)));
    });
  });
}
