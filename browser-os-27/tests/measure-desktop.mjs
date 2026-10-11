/* What a desktop label's box actually is, in pixels (dev probe, not part of `npm test`).

   The breadcrumb's caps were measured (tests/measure-crumb.mjs) before they were kept. The
   desktop's label has the same shape of problem and has never been measured:

     - how wide is `.label`, and how much of that is text the head can actually show?
     - how many characters is that, in the glyph the browser uses (`0`, not `m`)?
     - does the label overflow its grid row, and by how much? (grid-auto-rows is a fixed
       track height; content taller than the track overlaps the row below it)
     - what would a two-line head cost in row height?

   node tests/measure-desktop.mjs
*/
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { splitName } from '../src/core/utils.js';

const NAMES = [
  'welcome.txt',
  '2024-06-30-team-retrospective-notes-final.tar.gz',
  'release-2024-06-30-snapshot',
  'quarterly-report.docx',
  'extraordinarilylongfoldernameonewordwithnohyphensatall',
  '日本語のフォルダ名前です',
];

const server = await serve(process.cwd());
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${server.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
await page.waitForTimeout(300);

await page.evaluate((names) => {
  for (const n of names) window.browserOS.fs.write(`~/Desktop/${n}`, 'x', '/');
}, NAMES);
await page.waitForTimeout(400);

const rows = await page.evaluate(() => {
  const out = [];
  for (const node of document.querySelectorAll('.dicon[data-kind="file"]')) {
    const label = node.querySelector('.label');
    const head = label.querySelector('.name-head');
    const tail = label.querySelector('.name-tail');
    const box = (n) => (n ? Math.round(n.getBoundingClientRect().width) : 0);
    const height = (n) => (n ? Math.round(n.getBoundingClientRect().height) : 0);
    const cell = node.closest('.desktop-icons');
    const cs = getComputedStyle(label);
    out.push({
      name: node.dataset.path.split('/').pop(),
      icon: Math.round(node.getBoundingClientRect().width),
      cellRow: cell ? getComputedStyle(cell).gridAutoRows : '?',
      label: box(label), labelMax: cs.maxWidth,
      head: box(head), headNatural: head ? head.scrollWidth : 0,
      headLines: head ? Math.round(head.getBoundingClientRect().height / parseFloat(getComputedStyle(head).lineHeight || '15')) : 0,
      headCut: !!head && head.scrollWidth > head.clientWidth + 1,
      tail: tail ? tail.textContent : null,
      labelHeight: height(label), iconHeight: height(node),
      glyphBottom: Math.round(node.querySelector('.glyph').getBoundingClientRect().bottom),
      labelBottom: Math.round(label.getBoundingClientRect().bottom),
      nodeTop: Math.round(node.getBoundingClientRect().top),
      nodeBottom: Math.round(node.getBoundingClientRect().bottom),
      fontSize: cs.fontSize, lineHeight: cs.lineHeight,
    });
  }
  /* What the box can hold, in the glyph the browser actually measures with. */
  const probe = document.createElement('span');
  const label = document.querySelector('.dicon[data-kind="file"] .label') || document.querySelector('.dicon .label');
  const head = label.querySelector('.name-head') || label;
  const lcs = getComputedStyle(label);
  probe.style.cssText = `font:${lcs.fontSize} ${lcs.fontFamily}; position:absolute; visibility:hidden; white-space:pre; max-width:none`;
  document.body.append(probe);
  const room = head.clientWidth;
  let chars = 0;
  for (let n = 1; n < 80; n++) {
    probe.textContent = '0'.repeat(n);
    if (probe.getBoundingClientRect().width > room) break;
    chars = n;
  }
  const widths = {};
  for (const s of ['0', 'm', 'i', '-', '.', 'W']) {
    probe.textContent = s.repeat(20);
    widths[s] = +(probe.getBoundingClientRect().width / 20).toFixed(2);
  }
  probe.remove();
  const grid = document.querySelector('.desktop-icons');
  return {
    rows: out, room, chars, widths,
    clamp: getComputedStyle(document.querySelector('.dicon .label .name-head') || label).webkitLineClamp,
    padding: getComputedStyle(label).padding,
    rowTrack: getComputedStyle(grid).gridAutoRows,
  };
});

console.log('== the desktop label box, 1280px viewport');
console.log(`head box ${rows.room}px = about ${rows.chars} zero-width glyphs per line (${JSON.stringify(rows.widths)} px/glyph)`);
console.log(`line-clamp on the head: ${rows.clamp} line(s); label padding ${rows.padding}; row track ${rows.rowTrack}\n`);
for (const r of rows.rows) {
  const { head, tail } = splitName(r.name);
  console.log(`${r.name}`);
  console.log(`    split head ${JSON.stringify(head)} tail ${JSON.stringify(tail)}`);
  console.log(`    rendered head box ${r.head}px (natural ${r.headNatural}px, cut: ${r.headCut ? 'yes' : 'no'}) tail ${JSON.stringify(r.tail)}`);
  console.log(`    icon ${r.icon}x${r.iconHeight}px, row track ${r.cellRow}, label ${r.label}px wide x ${r.labelHeight}px tall`);
  console.log(`    glyph bottom ${r.glyphBottom} label bottom ${r.labelBottom} node bottom ${r.nodeBottom}${r.labelBottom > r.nodeBottom ? '  !! label hangs below its icon' : ''}`);
}
await browser.close();
await server.close();
