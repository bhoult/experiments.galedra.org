/* One probe for every bar. It replaces probe-fit.mjs (one app, every cut level) and
   probe-files.mjs (Files' bar *and* its Places sidebar): after `data-collapse-scope` those
   are the same question — what a bar does at each rung of its ladder, including the room it
   buys outside itself.

   node tests/probe.mjs [app] [path] [widths…] [--mkdir=<path>]…
   A Files path may be given on its own — `node tests/probe.mjs ~/Documents 360` is the bar.
   e.g. node tests/probe.mjs files /home/user/Documents/notes 360 560 760
        node tests/probe.mjs paint 680 640
        node tests/probe.mjs files /home/user/Documents/日本 420 --mkdir=/home/user/Documents/日本
*/
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const mkdirs = [];
const widths = [];
const positionals = [];
for (const a of argv) {
  if (a.startsWith('--mkdir=')) mkdirs.push(a.slice(8));
  else if (Number.isFinite(Number(a))) widths.push(Number(a));
  else positionals.push(a);
}
let app = positionals[0] || 'files';
let path = positionals[1] || '/home/user';
/* A path in the first position is what you type when you are probing Files, which is the bar
   most worth probing: recognise it instead of launching an app called "~/Documents". */
if (app === '/' || app.startsWith('/') || app.startsWith('~')) { path = app; app = 'files'; }
if (!widths.length) widths.push(360, 420, 480, 560, 640, 700, 760);

const server = await serve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${server.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
await page.evaluate(([dirs, id, p]) => {
  for (const d of dirs) window.browserOS.fs.mkdir(d, '/');
  window.browserOS.launch(id, id === 'files' ? { data: { path: p } } : {});
}, [mkdirs, app, path]);
await page.waitForTimeout(600);

for (const width of widths) {
  await page.evaluate(([w]) => {
    for (const win of window.browserOS.wm.windows.values()) { win.el.style.width = `${w}px`; win.el.style.height = '360px'; }
  }, [width]);
  await page.waitForTimeout(450);

  const out = await page.evaluate(() => {
    const root = document.querySelector('.window .app') || document.querySelector('.window');
    const bar = root.querySelector('.toolbar');
    if (!bar) return { error: 'this app has no toolbar' };
    const box = bar.getBoundingClientRect();
    const shown = (n) => n && n.getBoundingClientRect().width > 0;
    const inBar = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right <= box.right + 1 && r.left >= box.left - 1; };

    /* The same ladder the core builds, resolved the same way (a group may live outside the
       bar), so what this prints is what the watcher is actually doing. */
    const scope = bar.dataset.collapseScope ? (bar.closest(bar.dataset.collapseScope) || bar) : bar;
    const groups = (bar.dataset.collapse || '').split(',').map((s) => s.trim()).filter(Boolean)
      .flatMap((sel) => [...scope.querySelectorAll(sel)]);
    const sequence = [];
    for (const g of groups) {
      const sel = g.dataset.collapseUnits;
      let units = sel ? [...g.querySelectorAll(sel)] : [];
      if (sel && g.dataset.collapseUnitsFrom === 'end') units = units.reverse();
      if (units.length) sequence.push(...units); else sequence.push(g);
    }
    const apply = (k) => sequence.forEach((n, i) => n.classList.toggle('is-collapsed', i < k));
    const name = (n) => (n.getAttribute('aria-label') || n.getAttribute('class') || n.tagName).trim().slice(0, 28);

    const more = bar.querySelector('.toolbar-more');
    const settled = {
      client: bar.clientWidth, scroll: bar.scrollWidth,
      k: bar.dataset.collapsed || '', exhausted: bar.dataset.collapsedExhausted === 'true',
      effective: bar.dataset.collapsedEffective ?? null,
      effectiveLimit: bar.dataset.collapsedEffectiveLimit ?? null,
      walks: bar.dataset.collapsedEffectiveWalks ?? '0',
      walkMs: bar.dataset.collapsedEffectiveWalkMs ?? null,
      passes: Number(bar.dataset.fitPasses || 0),
      more: !!more && !more.hidden,
      offscreen: [...bar.querySelectorAll('button, input')].filter((c) => !c.classList.contains('toolbar-more'))
        .map((c) => c.getBoundingClientRect()).filter((r) => r.width && (r.right > box.right + 1 || r.left < box.left - 1)).length,
    };

    /* Files-specific, because the sidebar is now part of the bar's decision — measured
       BEFORE the manual sweep below, or it reports the sweep's artificial state instead of
       the settled one. */
    const side = root.querySelector('.files-side');
    const extras = [];
    if (side) extras.push(`side=${Math.round(side.getBoundingClientRect().width)}`, `places=${[...root.querySelectorAll('.side-label')].filter(shown).length}`);
    if (root.classList.contains('is-tiny')) extras.push('tiny-statusbar');
    const swatches = bar.querySelectorAll('.swatch[data-color]');
    if (swatches.length) extras.push(`swatches=${[...swatches].filter(shown).length}/${swatches.length}`);
    const slider = bar.querySelector('.paint-size-slider');
    if (slider) extras.push(`slider=${Math.round(slider.getBoundingClientRect().width)}`);

    /* Then the ladder itself, rung by rung: the width each one buys, and what it costs. */
    const rows = [];
    for (let k = 0; k <= sequence.length; k++) {
      apply(k);
      const scroll = bar.scrollWidth;
      rows.push({
        k,
        cut: k ? name(sequence[k - 1]) : '',
        client: bar.clientWidth,
        scroll,
        bought: k ? scroll !== rows[k - 1].scroll || bar.clientWidth !== rows[k - 1].client : false,
        fits: scroll <= bar.clientWidth + 1,
        controls: [...bar.querySelectorAll('button, input')].filter(shown).filter(inBar).length,
      });
    }
    apply(0);

    return { settled, rows, extras, ladder: sequence.length };
  });

  if (out.error) { console.log(`${app}@${width}px: ${out.error}`); continue; }

  const cut = out.settled.k
    ? `${out.settled.k}${out.settled.exhausted ? ` of ${out.ladder}, ${out.settled.effective ?? '?'} bought anything, still ${out.settled.scroll - out.settled.client}px over` : ''}`
    : 'nothing';
  console.log(`== ${app} at ${width}px  path=${path}`);
  console.log(`   settled: client=${out.settled.client} scroll=${out.settled.scroll} gave up ${cut} ⋯=${out.settled.more ? 'shown' : '-'} off-edge=${out.settled.offscreen} passes=${out.settled.passes} walks=${out.settled.walks}${out.settled.walkMs ? ` walk=${out.settled.walkMs}ms` : ''}${out.settled.effectiveLimit ? ` (ladder over ${out.settled.effectiveLimit}: not walked)` : ''}${out.extras.length ? ' ' + out.extras.join(' ') : ''}`);
  for (const r of out.rows) {
    if (!r.k) continue;
    console.log(`   rung ${r.k}${r.bought ? '' : ' (buys nothing)'}: give up ${r.cut.padEnd(28)} → client=${r.client} scroll=${r.scroll} ${r.fits ? 'FITS' : `over by ${r.scroll - r.client}`} controls=${r.controls}`);
  }

  /* The manual sweep left the bar in an artificial state; nudge the window so the watcher
     re-fits before the next width, or the next measurement reads this one. */
  await page.evaluate(([w]) => {
    for (const win of window.browserOS.wm.windows.values()) { win.el.style.width = `${w + 1}px`; }
  }, [width]);
  await page.waitForTimeout(120);
  await page.evaluate(([w]) => {
    for (const win of window.browserOS.wm.windows.values()) { win.el.style.width = `${w}px`; }
  }, [width]);
  await page.waitForTimeout(250);
}

await browser.close();
await server.close();
