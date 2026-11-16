import * as fs from 'fs'; import * as path from 'path';
import { loadBrand, brandCss } from '../src/brand'; import { render, titleBlock } from '../src/render';
const dir = path.join(__dirname, 'sample'); const media = path.join(__dirname, '../media');
const brand = loadBrand(path.join(dir, '.brokerdocs/brand.json'));
const r = render(fs.readFileSync(path.join(dir, 'informe.md'), 'utf8'), {
  resolveImage: s => 'file://' + path.resolve(dir, s),
  linkExists: h => fs.existsSync(path.resolve(dir, h.split('#')[0])) });
const msg = { type: 'update', html: r.html, title: titleBlock(r.meta), headings: r.headings, words: r.words, hasMermaid: r.hasMermaid,
  brandCss: brandCss(brand), brand, brandBar: `<img src="file://${brand.logo}"><span>${brand.empresa}</span>` };
const tpl = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'out/webview.html'), tpl.replace(/MEDIA/g, 'file://' + media).replace('MSG', JSON.stringify(msg)));
