/* Measurement harness for the toolbar collapse mechanism: for every app, open it at its
   default width and at its declared minimum width, and report what (if anything) is out
   of reach without scrolling — named, with the width of every control in the bar. Run:
   node tests/measure-toolbars.mjs [extra widths…] e.g. `… 380 460` */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const server = await serve(ROOT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${server.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
await page.waitForTimeout(300);

const specs = await page.evaluate(() => window.browserOS.apps.map((a) => ({ id: a.id, width: a.width, minWidth: a.minWidth })));

/* Extra widths to probe, from the command line: `node tests/measure-toolbars.mjs 380 460`.
   A bar's default and its declared minimum are two points; the interesting behaviour is
   what happens in between, and re-running with widths is cheaper than guessing. */
const extraWidths = process.argv.slice(2).map(Number).filter(Number.isFinite);

const measure = async (app, width) => {
  await page.evaluate(([app, width]) => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === app);
    if (w) { w.el.style.width = `${width}px`; w.el.style.height = '360px'; }
  }, [app, width]);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const out = [];
    for (const w of document.querySelectorAll('.window')) {
      const bar = w.querySelector('.toolbar');
      if (!bar) continue;
      const box = bar.getBoundingClientRect();
      const items = [...bar.querySelectorAll('button, input')].filter((c) => !c.classList.contains('toolbar-more')).map((c) => {
        const r = c.getBoundingClientRect();
        return {
          label: (c.getAttribute('aria-label') || c.textContent || c.dataset.color || c.type || '').trim().slice(0, 20),
          w: Math.round(r.width),
          hidden: r.width === 0,
          offscreen: r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1),
        };
      });
      out.push({
        app: w.dataset.app, client: bar.clientWidth, scroll: bar.scrollWidth,
        collapsed: bar.dataset.collapsed || '',
        /* `collapsed` is the ladder the bar walked; `exhausted` says the walk did not
           finish the job, and `effective` is how many of those rungs changed the measured
           width. Printing the first alone is how a bar that gave up seven things and still
           overflows gets read as a bar that solved its problem. */
        exhausted: bar.dataset.collapsedExhausted === 'true',
        effective: bar.dataset.collapsedEffective ?? null,
        /* How many times the ladder was actually walked for this bar. The walk is the
           expensive half of an exhausted fit, so it is worth seeing next to the number it
           produced. */
        walks: bar.dataset.collapsedEffectiveWalks ?? '0',
        passes: Number(bar.dataset.fitPasses || 0),
        /* A bar may now give up groups that live outside it (data-collapse-scope) — Files'
           Places words are the first one — so the collapse count alone does not say what
           the window actually looks like. */
        places: [...w.querySelectorAll('.side-label')].filter((n) => n.getBoundingClientRect().width > 0).length,
        more: !!bar.querySelector('.toolbar-more') && !bar.querySelector('.toolbar-more').hidden,
        offscreen: items.filter((i) => i.offscreen).map((i) => i.label),
        widths: items.map((i) => `${i.label}=${i.hidden ? 'gone' : i.w}${i.offscreen ? '!' : ''}`),
        hidden: items.filter((i) => i.hidden).map((i) => i.label),
      });
    }
    return out;
  });
};

for (const spec of specs) {
  if (!spec.width) continue;
  await page.evaluate((id) => window.browserOS.launch(id), spec.id);
  await page.waitForTimeout(350);
  for (const width of [...new Set([spec.width, spec.minWidth ?? 320, ...extraWidths])]) {
    for (const r of await measure(spec.id, width)) {
      if (r.app !== spec.id) continue;
      /* The promise is not "the bar fits" — it is "every action can be reached". When it
         cannot fit, the ⋯ must be there and must list exactly what is out of reach. */
      let menu = null;
      if (r.more) {
        await page.click(`.window[data-app="${spec.id}"] .toolbar .toolbar-more`);
        await page.waitForTimeout(200);
        menu = (await page.locator('#context-menu .cmenu-item').allTextContents()).map((t) => t.trim());
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      const covered = menu ? r.offscreen.filter((l) => !menu.some((m) => m.includes(l))) : [];
      const status = r.offscreen.length
        ? (r.more
          ? (covered.length ? `NOT IN THE ⋯ MENU: ${covered.join(', ')}` : `all reachable via ⋯ (${menu.length} in the menu)`)
          : `OUT OF REACH, NO MENU: ${r.offscreen.join(', ')}`)
        : 'all reachable';
      const cut = r.collapsed
        ? `${r.collapsed}${r.exhausted ? `/${r.effective === null ? '?' : r.effective} bought, still over` : ''}`
        : '-';
      console.log(`${spec.id}@${width} client=${r.client} scroll=${r.scroll} collapsed=${cut} passes=${r.passes} walks=${r.walks} places=${r.places} ⋯=${r.more ? 'shown' : '-'} → ${status}`);
      /* Named even when the ⋯ covers them: "all reachable via ⋯" is honest but not
         comfortable, and you cannot make a bar better without knowing which controls are
         still sitting off its edge. */
      if (r.offscreen.length) console.log(`    off the edge: ${r.offscreen.join(', ')}`);
      if (r.offscreen.length) console.log(`    widths: ${r.widths.join(' ')}`);
      if (r.hidden.length) console.log(`    hidden: ${r.hidden.join(', ')}`);
    }
  }
  await page.evaluate((id) => {
    for (const w of [...window.browserOS.wm.windows.values()]) if (w.appId === id) window.browserOS.wm.close(w.id);
  }, spec.id);
  await page.waitForTimeout(250);
}

await browser.close();
await server.close();
