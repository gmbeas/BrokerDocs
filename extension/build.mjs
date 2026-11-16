// Compila la extensión de VS Code y el CLI que usa el plugin de Claude Code.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

const watch = process.argv.includes('--watch');
const PLUGIN_SCRIPTS = '../plugin/skills/documentar/scripts';
mkdirSync(PLUGIN_SCRIPTS, { recursive: true });
copyFileSync('node_modules/mermaid/dist/mermaid.min.js', 'media/mermaid.min.js');
copyFileSync('node_modules/mermaid/dist/mermaid.min.js', `${PLUGIN_SCRIPTS}/mermaid.min.js`);
copyFileSync('media/brokerdocs.css', `${PLUGIN_SCRIPTS}/brokerdocs.css`);

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node18', minify: !watch, sourcemap: watch, legalComments: 'none' };
const builds = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
  { ...common, entryPoints: ['src/cli.ts'], outfile: `${PLUGIN_SCRIPTS}/brokerdocs.js`, banner: { js: '#!/usr/bin/env node' } },
];
if (watch) for (const b of builds) (await esbuild.context(b)).watch();
else await Promise.all(builds.map(b => esbuild.build(b)));
console.log('build ok');
