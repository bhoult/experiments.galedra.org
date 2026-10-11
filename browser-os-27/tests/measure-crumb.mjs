/* What the breadcrumb's length caps actually cost, in pixels.

   `.crumb-last` is capped at 160px normally and 12ch when the bar has run out of room. Those
   two numbers are the only place in Files where a *name* is shortened rather than hidden, so
   they are worth measuring rather than arguing about:

     - is 12ch below the width of the shortest name the rung can ever fire on? (a cap above
       that width is a rung that buys nothing, and shortestFit hands it straight back)
     - with a protected tail (`splitName`), how much of the head is left inside the box?
     - is the uncollapsed 160px cap doing anything a real name reaches?

   node tests/measure-crumb.mjs [width]
*/
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { fileURLToPath } from 'node:url';
import { splitName } from '../src/core/utils.js';

const width = Number(process.argv[2] || 360);
const NAMES = [
  'nineteen-char-name!!',                    /* 19: the longest name `splitName` will not touch */
  'twenty-char-name-here!',                 /* 20: the shortest one it will */
  'a-folder-name-long-enough-to-cost-the-bar-room',
  '2024-06-30-team-retrospective',
  'release-2024-06-30-final',
  'release-2024-06-30-snapshot',                 /* the widest tail `splitName` will protect */
  'extraordinarilylongfoldernameonewordwithnohyphensatall',
  '日本語のフォルダ名前です',
];

const server = await serve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${server.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });

const rows = [];
for (const name of NAMES) {
  const path = `/home/user/Documents/${name}`;
  await page.evaluate((p) => { window.browserOS.fs.mkdir(p, '/'); }, path);
  await page.evaluate((p) => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: p } });
  }, path);
  await page.waitForTimeout(400);
  await page.evaluate((w) => {
    const win = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(win.el.style, { left: '20px', top: '60px', width: `${w}px`, height: '360px' });
  }, width);
  await page.waitForTimeout(400);

  const row = await page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const last = bar.querySelector('.crumb-last');
    const head = last.querySelector('.crumb-name-head');
    const tail = last.querySelector('.crumb-name-tail');
    const box = (n) => (n ? Math.round(n.getBoundingClientRect().width) : 0);
    const wasCut = (n) => !!n && n.scrollWidth > n.clientWidth + 1;
    const collapsed = last.classList.contains('is-collapsed');
    /* Ask the browser what 12ch means here, in px, so the number in the CSS is compared with
       the number that was actually rendered. */
    const probe = document.createElement('span');
    const cs = getComputedStyle(last);
    probe.style.cssText = `font:${cs.fontSize} ${cs.fontFamily}; position:absolute; visibility:hidden; white-space:pre; max-width:none`;
    /* `ch` is the width of "0", not of "m" — measuring the wrong glyph is how a cap gets
       argued about in pixels that were never the pixels the browser used. */
    probe.textContent = '0'.repeat(12);
    document.body.append(probe);
    const ch12 = Math.round(probe.getBoundingClientRect().width);
    /* How many characters the *uncollapsed* cap actually holds, in the same glyph: the number
       a name has to exceed before the 160px cap says anything at all. */
    let cap160 = 0;
    for (let n = 1; n < 80; n++) {
      probe.textContent = '0'.repeat(n);
      if (probe.getBoundingClientRect().width > 148) break; /* 160px less the button padding */
      cap160 = n;
    }
    probe.remove();
    return {
      collapsed, cuts: Number(bar.dataset.collapsed || 0),
      button: box(last), head: box(head), tail: box(tail),
      headNatural: head ? head.scrollWidth : 0,
      headCut: wasCut(head), tailShown: !!tail && box(tail) > 0,
      textRoom: box(last) - 12, ch12, cap160,
    };
  });
  const { head, tail } = splitName(name);
  rows.push({ name, ...row, splitHead: head, splitTail: tail });
  await page.evaluate((p) => { window.browserOS.fs.rm(p, '/', true); }, path);
}

console.log(`== breadcrumb length caps, Files window ${width}px wide\n`);
console.log(`12ch = ${rows[0]?.ch12}px of box = ${rows[0]?.ch12 - 12}px of text (the button's own padding is 12px).`);
console.log(`The 160px cap holds about ${rows[0]?.cap160} zero-width glyphs before it cuts anything.\n`);
for (const r of rows) {
  const tailNote = r.splitTail ? `tail ${JSON.stringify(r.splitTail)}` : 'no split';
  console.log(`${String(r.name.length).padStart(3)} chars  ${r.name}`);
  console.log(`    split: ${tailNote}`);
  console.log(`    rendered: collapsed=${r.collapsed} button=${r.button}px head=${r.head}px(cut:${r.headCut ? 'yes' : 'no'}) tail=${r.tail}px headNatural=${r.headNatural}px`);
  if (r.tailShown && r.head === 0) console.log('    !! the tail has taken the whole box: the beginning is gone');
}
await browser.close();
await server.close();
