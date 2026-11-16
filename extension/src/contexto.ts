import { spawnSync } from 'child_process';

/** Resumen compacto de actividad git/GitHub para redactar avances con pocos tokens. */

const sh = (cmd: string, args: string[]) => {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    return (r.stdout || '').trim();
  } catch { return ''; }
};

interface Commit { h: string; f: string; a: string; s: string; add: number; del: number; files: string[] }

function commits(o: { desde?: string; hasta?: string; grep?: string; autor?: string }): Commit[] {
  const args = ['log', '--all', '--no-merges', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%h|%ad|%an|%s', '--numstat'];
  if (o.desde) args.push(`--since=${o.desde} 00:00`);
  if (o.hasta) args.push(`--until=${o.hasta} 23:59`);
  if (o.autor) args.push(`--author=${o.autor}`);
  if (o.grep) args.push(`--grep=${o.grep}`, '-i');
  const res: Commit[] = []; let cur: Commit | undefined;
  for (const line of sh('git', args).split('\n')) {
    if (!line.includes('\t') && line.split('|').length >= 4) {
      const [h, f, a, ...s] = line.split('|');
      cur = { h, f, a, s: s.join('|'), add: 0, del: 0, files: [] }; res.push(cur);
    } else if (line.includes('\t') && cur) {
      const [ad, de, file] = line.split('\t');
      cur.add += parseInt(ad, 10) || 0; cur.del += parseInt(de, 10) || 0; if (file) cur.files.push(file);
    }
  }
  return res;
}

function count<T>(items: T[]): [T, number][] {
  const m = new Map<T, number>(); for (const i of items) m.set(i, (m.get(i) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function resumen(cs: Commit[], titulo: string, max: number): string[] {
  const out = [`## ${titulo}`];
  const rama = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const repo = sh('git', ['rev-parse', '--show-toplevel']).split(/[\\/]/).pop();
  out.push(`repo: ${repo} | rama actual: ${rama} | commits: ${cs.length}`);
  if (!cs.length) out.push('(sin commits en el período)');
  else {
    const add = cs.reduce((n, c) => n + c.add, 0), del = cs.reduce((n, c) => n + c.del, 0);
    out.push(`líneas: +${add} -${del} | autores: ` + count(cs.map(c => c.a)).map(([a, n]) => `${a}(${n})`).join(', '));
    const areas = count(cs.flatMap(c => c.files.map(f => f.split('/').slice(0, 2).join('/'))));
    out.push('áreas tocadas: ' + areas.slice(0, 8).map(([a, n]) => `${a}(${n})`).join(', '));
    out.push('commits:');
    for (const c of cs.slice(0, max)) out.push(`- ${c.f} ${c.h} ${c.s} [+${c.add}/-${c.del}]`);
    if (cs.length > max) out.push(`- … y ${cs.length - max} commits más`);
  }
  const pend = sh('git', ['status', '--short']).split('\n').filter(Boolean);
  if (pend.length) out.push(`cambios sin commit: ${pend.length} archivos (${pend.slice(0, 6).map(l => l.slice(3)).join(', ')}${pend.length > 6 ? '…' : ''})`);
  return out;
}

const gh = (args: string[]) => { const o = sh('gh', args); try { return o ? JSON.parse(o) : undefined; } catch { return undefined; } };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function contexto(args: string[]): string {
  const opt = (name: string, def?: string) => {
    const i = args.indexOf(name); if (i < 0) return def;
    const v = args[i + 1]; args.splice(i, 2); return v;
  };
  const autor = opt('--autor'); const max = parseInt(opt('--max', '40')!, 10);
  const [modo, a1, a2] = args;
  const hoy = new Date();
  if (modo === 'dia') {
    const d = a1 || iso(hoy);
    return resumen(commits({ desde: d, hasta: d, autor }), `Actividad del ${d}`, max).join('\n');
  }
  if (modo === 'semana') {
    const ref = a1 ? new Date(a1 + 'T12:00:00') : hoy;
    const lunes = new Date(ref); lunes.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
    const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const out = resumen(commits({ desde: iso(lunes), hasta: iso(dom), autor }), `Semana ${iso(lunes)} a ${iso(dom)}`, max);
    const prs = gh(['pr', 'list', '--state', 'all', '--search', `updated:>=${iso(lunes)}`, '--json', 'number,title,state', '--limit', '20']);
    if (prs?.length) { out.push('PRs de la semana:'); for (const p of prs) out.push(`- #${p.number} [${p.state}] ${p.title}`); }
    return out.join('\n');
  }
  if (modo === 'issue' && a1) {
    const out: string[] = [];
    const it = gh(['issue', 'view', a1, '--json', 'number,title,state,labels,assignees,body,comments']);
    if (it) {
      const body = String(it.body || '').replace(/\r/g, '').trim();
      out.push(`## Issue #${it.number}: ${it.title} [${it.state}]`);
      out.push('etiquetas: ' + (it.labels || []).map((l: any) => l.name).join(', ') + ' | asignado: ' + (it.assignees || []).map((a: any) => a.login).join(', '));
      out.push('descripción: ' + (body.length > 1200 ? body.slice(0, 1200) + '…' : body));
      const coms = it.comments || [];
      if (coms.length) {
        out.push(`últimos comentarios (${coms.length} en total):`);
        for (const c of coms.slice(-4)) out.push(`- ${c.author?.login}: ${String(c.body).replace(/\s+/g, ' ').slice(0, 250)}`);
      }
    } else out.push(`## Issue #${a1} (gh no disponible o sin acceso: completar con lo que indique el usuario)`);
    out.push(...resumen(commits({ grep: `#${a1}`, autor }), `Commits que mencionan #${a1}`, max));
    return out.join('\n');
  }
  if (modo === 'rango' && a1 && a2) return resumen(commits({ desde: a1, hasta: a2, autor }), `Actividad ${a1} a ${a2}`, max).join('\n');
  return 'Uso: brokerdocs contexto dia [AAAA-MM-DD] | semana [AAAA-MM-DD] | issue <n> | rango <desde> <hasta>  [--autor nombre] [--max 40]';
}
