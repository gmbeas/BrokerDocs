import * as fs from 'fs';
import * as path from 'path';

export interface Brand {
  empresa: string;
  autor: string;
  logo?: string; // ruta absoluta
  fuente: string;
  fuente_titulos: string;
  fuente_codigo: string;
  colores: {
    primario: string; secundario: string; acento: string;
    texto: string; gris: string; fondo_suave: string;
  };
  pie: string;
}

export const DEFAULT_BRAND: Brand = {
  empresa: '',
  autor: '',
  fuente: 'Calibri',
  fuente_titulos: 'Calibri',
  fuente_codigo: 'Consolas',
  colores: {
    primario: '1E40AF', secundario: '0EA5E9', acento: 'F59E0B',
    texto: '1F2937', gris: '6B7280', fondo_suave: 'EFF6FF',
  },
  pie: '',
};

const hex = (v: unknown, d: string) =>
  typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().replace('#', '').toUpperCase() : d;

/** Une la marca por defecto con un objeto parcial (mismo formato que usa el CLI/plugin). */
export function mergeBrand(partial: any, baseDir?: string): Brand {
  const b: Brand = JSON.parse(JSON.stringify(DEFAULT_BRAND));
  if (!partial || typeof partial !== 'object') return b;
  for (const k of ['empresa', 'autor', 'fuente', 'fuente_titulos', 'fuente_codigo', 'pie'] as const) {
    if (typeof partial[k] === 'string' && partial[k].trim()) (b as any)[k] = partial[k].trim();
  }
  const c = partial.colores || {};
  for (const k of Object.keys(b.colores) as (keyof Brand['colores'])[]) b.colores[k] = hex(c[k], b.colores[k]);
  if (typeof partial.logo === 'string' && partial.logo.trim()) {
    const p = partial.logo.trim();
    const abs = path.isAbsolute(p) ? p : path.resolve(baseDir || '.', p);
    if (fs.existsSync(abs)) b.logo = abs;
  }
  return b;
}

/** Busca brand.json: ruta explícita > .brokerdocs/brand.json subiendo desde el documento > ninguno. */
export function findBrandFile(docPath: string | undefined, explicit?: string, roots: string[] = []): string | undefined {
  if (explicit) {
    const cands = path.isAbsolute(explicit) ? [explicit] : roots.map(r => path.join(r, explicit));
    for (const c of cands) if (fs.existsSync(c)) return c;
  }
  let dir = docPath ? path.dirname(docPath) : roots[0];
  for (let i = 0; dir && i < 12; i++) {
    for (const folder of ['.brokerdocs', '.folio']) { // .folio: compatibilidad con versiones anteriores
      const f = path.join(dir, folder, 'brand.json');
      if (fs.existsSync(f)) return f;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function loadBrand(file?: string, overrides?: any): Brand {
  let data: any = {};
  if (file) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* json inválido: se ignora */ }
  }
  const merged = { ...data, ...(overrides || {}), colores: { ...(data.colores || {}), ...((overrides || {}).colores || {}) } };
  return mergeBrand(merged, file ? path.dirname(file) : undefined);
}

/** Variables CSS para la vista y la exportación HTML/PDF. */
export function brandCss(b: Brand): string {
  const c = b.colores;
  return `:root{--f-pri:#${c.primario};--f-sec:#${c.secundario};--f-acc:#${c.acento};--f-txt:#${c.texto};` +
    `--f-gray:#${c.gris};--f-soft:#${c.fondo_suave};--f-font:'${b.fuente}',system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `--f-hfont:'${b.fuente_titulos}',system-ui,-apple-system,'Segoe UI',sans-serif;--f-mono:'${b.fuente_codigo}',ui-monospace,Menlo,monospace;}`;
}
