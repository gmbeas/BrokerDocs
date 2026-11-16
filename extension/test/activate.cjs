const Module = require('module'); const orig = Module._load; const cmds = [];
const any = new Proxy(function () {}, { get: (t, k) => k === 'then' ? undefined : any, apply: () => any, construct: () => any });
const vscode = { commands: { registerCommand: (id) => { cmds.push(id); return { dispose() {} }; }, executeCommand: async () => {} },
  window: { activeTextEditor: undefined, visibleTextEditors: [], createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }), onDidChangeActiveTextEditor: () => ({ dispose() {} }), registerCustomEditorProvider: () => ({ dispose() {} }) },
  workspace: any, env: any, Uri: class {}, ViewColumn: { Beside: -2, Active: -1, One: 1 }, StatusBarAlignment: { Right: 2 }, ProgressLocation: {}, Position: any, Selection: any, Range: any, SnippetString: any, TextEditorRevealType: {} };
Module._load = function (r, ...a) { return r === 'vscode' ? vscode : orig.call(this, r, ...a); };
const ext = require('../dist/extension.js');
ext.activate({ subscriptions: { push() {} }, extensionUri: {}, extensionPath: __dirname + '/..' });
const pkg = require('../package.json').contributes.commands.map(c => c.command);
console.log('registrados', cmds.length, '| faltan en código:', pkg.filter(c => !cmds.includes(c)), '| sin declarar:', cmds.filter(c => !pkg.includes(c)));
