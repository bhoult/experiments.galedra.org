/* The shared browser fixture.
 *
 * tests/browser.test.mjs used to be one 3800-line file: one page, one browser, ~86 tests in
 * a fixed order. That made every test's page state somebody else's business — a Files test
 * could only be understood by knowing which earlier tests had left which windows open — and it
 * made the whole suite run in one process, one browser, one at a time.
 *
 * Each area file imports this one. It boots the desktop once per file (so a file's tests
 * still share a page, which is what makes the width sweeps affordable) but files run in
 * parallel and start from a fresh origin, so an area's state is its own.
 */
import { test as baseTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serve } from '../serve.mjs';

/* This file lives one level deeper than tests/browser.test.mjs did, so the project root is
   two levels up. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const TERM_INPUT = '.window[data-app="terminal"] .term-input';

export let server, page;
export let browser;
const consoleErrors = [];
const nativeDialogs = [];
export { consoleErrors, nativeDialogs };

/* Wrap node:test so a failing test prints the console errors it caused instead of hiding them
   until the last test of the file. */
export const test = (name, fn) => baseTest(name, async (t) => {
  const mark = consoleErrors.length;
  const nativeMark = nativeDialogs.length;
  try {
    await fn(t);
  } catch (err) {
    const caused = consoleErrors.slice(mark);
    const dialogs = nativeDialogs.slice(nativeMark);
    if (caused.length) t.diagnostic(`console errors during "${name}":\n  ${caused.join('\n  ')}`);
    if (dialogs.length) t.diagnostic(`native dialogs used during "${name}": ${dialogs.join(' | ')}`);
    throw err;
  }
});

before(async () => {
  server = await serve(ROOT);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  /* A test-only helper, injected before the page runs, so the width sweeps can ask the same
     question about a bar ("what has it given up, in the order it was allowed to?") without
     each carrying their own copy of the answer. */
  await page.addInitScript(() => {
    window.testHelpers = {
      /* Mirrors core/utils.js: a bar may declare groups that live outside itself
         (data-collapse-scope), so the selectors are resolved against that ancestor. */
      declaredGroups(bar) {
        const scope = bar.dataset.collapseScope
          ? (bar.closest(bar.dataset.collapseScope) || bar)
          : bar;
        return (bar.dataset.collapse || '')
          .split(',').map((s) => s.trim()).filter(Boolean)
          .map((sel) => scope.querySelector(sel)).filter(Boolean);
      },
      givenUpOrder(bar) {
        return window.testHelpers.declaredGroups(bar).map((g) => {
          const sel = g.dataset.collapseUnits;
          const units = sel ? [...g.querySelectorAll(sel)] : [];
          const gone = units.length
            ? units.some((u) => u.classList.contains('is-collapsed'))
            : g.classList.contains('is-collapsed');
          return gone ? 1 : 0;
        });
      },
      /* The element a bar gave up *last*, in the order it was allowed to give things up.
         Minimality has to be tested against that one: "put the innermost swatch back" is
         the wrong question when the bar's last cut was something else entirely (a text
         readout, say) and the swatch it kept would have been absorbed by a flexible
         neighbour. */
      lastCut(bar) {
        const k = Number(bar.dataset.collapsed || 0);
        if (!k) return null;
        const sequence = [];
        for (const g of window.testHelpers.declaredGroups(bar)) {
          const sel = g.dataset.collapseUnits;
          let units = sel ? [...g.querySelectorAll(sel)] : [];
          if (sel && g.dataset.collapseUnitsFrom === 'end') units = units.reverse();
          if (units.length) sequence.push(...units);
          else sequence.push(g);
        }
        return sequence[k - 1] || null;
      },
    };
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('dialog', (d) => nativeDialogs.push(`${d.type()}: ${d.message()}`));
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

export const desktop = {
  win: (app) => page.locator(`.window[data-app="${app}"]`),
  openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage,
};

async function openApp(id, data) {
  await page.evaluate(([id, data]) => window.browserOS.launch(id, data ? { data } : {}), [id, data]);
  await desktop.win(id).waitFor({ state: 'attached', timeout: 5000 });
}
async function closeApp(id) {
  const w = desktop.win(id);
  if (await w.count() === 0) return;
  await w.locator('.wbtn.close').click();
  // A guarded close (an editor with unsaved changes) asks first — answer with "close anyway".
  await page.waitForTimeout(150);
  if (await page.locator('#dialogs .dialog').count()) await dialogAccept();
  await w.waitFor({ state: 'detached', timeout: 5000 });
}
async function closeAll() {
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
  });
  await page.waitForTimeout(400);
}
/* Resize every window and wait until the toolbars have actually settled.

   The width sweeps do this a dozen times each. A fixed sleep made them both the slowest
   part of the suite and the flakiest part of it — the wait was a guess about how long a
   re-fit takes, and a slow machine could lose the race. Polling the bars until two
   consecutive reads agree waits for the thing the test actually depends on (the collapse
   has run and the bar is not still changing), and it usually returns in two polls. */
async function setWidths(width, { height } = {}) {
  await page.evaluate(([w, h]) => {
    for (const win of window.browserOS.wm.windows.values()) {
      win.el.style.width = `${w}px`;
      if (h) win.el.style.height = `${h}px`;
    }
  }, [width, height]);
  /* Give the browser one rendering cycle before asking whether it has settled.

     A ResizeObserver notification is delivered at the end of a rendering update, so a poll
     loop that starts immediately can read the *pre-fit* state twice and call it stable —
     which is what made the width sweeps fail under load: the collapse had simply not run
     yet, and the two reads agreed about that. Waiting for three frames guarantees at least
     one delivered notification, and the pass counter (below) makes "a fit is still
     happening" visible as instability instead of as a settled layout. */
  await page.evaluate(() => new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
  let prev = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const sig = await page.evaluate(() => [...document.querySelectorAll('.toolbar')]
      .map((t) => `${t.clientWidth}|${t.scrollWidth}|${t.dataset.collapsed || ''}|${t.dataset.fitPasses || ''}`).join(';'));
    if (prev !== null && sig === prev) return;
    prev = sig;
    await page.waitForTimeout(40);
  }
  throw new Error(`toolbars were still changing 1s after resizing to ${width}px`);
}
/* Find, by bisection, the *widest* window in [lo, hi] for which something about the page is
   true — and leave the window at that width.

   Every width in this suite used to be a number somebody measured by hand against the seeded
   filesystem, which made it a fact about the seed rather than about the app: rename a folder
   and the number stops meaning anything, and the test then asserts the wrong thing quietly.
   A bar's behaviour is a shape, and a shape can be asked for directly — "the widest window
   where this control is gone" is the same claim with no hard-coded number in it. Assumes the
   predicate is monotone in width (true below some threshold), which is what a collapse ladder
   guarantees. */
async function widthWhere(lo, hi, predicate) {
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    await setWidths(mid);
    if (await predicate()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best !== null) await setWidths(best);
  return best;
}
async function runCommand(cmd) {
  await page.fill(TERM_INPUT, cmd);
  await page.press(TERM_INPUT, 'Enter');
}
/* In-OS dialogs (never window.confirm/prompt). */
async function dialogShown(text) {
  await page.waitForSelector('#dialogs .dialog', { state: 'visible', timeout: 5000 });
  if (text) assert.match(await page.textContent('#dialogs .dialog'), text);
}
async function dialogAccept() {
  await page.click('#dialogs .dlg-btn.primary');
  await page.waitForSelector('#dialogs .dialog', { state: 'detached', timeout: 5000 });
}
async function dialogCancel() {
  await page.click('#dialogs .dlg-btn:not(.primary)');
  await page.waitForSelector('#dialogs .dialog', { state: 'detached', timeout: 5000 });
}
/* Start from a genuinely empty origin: quota behaviour can only be tested against a storage
   whose contents we know. */
async function resetStorage() {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  await closeAll();
}
