/* Dev probe (not part of `npm test`): the rendered-text contrast audit, printed.
 *
 *   node tests/contrast-probe.mjs [app…]        audit the shell, then each app maximized
 *   node tests/contrast-probe.mjs --theme=light  only the light theme
 *   node tests/contrast-probe.mjs --accent=rose  every accent preset too
 *
 * The test file (tests/browser/contrast.test.mjs) asserts; this one reports, which is what you
 * want when something has failed and you need to see all of it at once. Each app is measured on
 * its own and maximized: two windows stacked over each other make the one underneath
 * "unpainted", and an audit that measures nothing passes for the wrong reason.
 */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { fileURLToPath } from 'node:url';
import { auditContrast } from './contrast.mjs';

const argv = process.argv.slice(2);
const themes = argv.includes('--theme=light') ? ['light'] : argv.includes('--theme=dark') ? ['dark'] : ['dark', 'light'];
const allAccents = argv.includes('--accent');
const apps = argv.filter((a) => !a.startsWith('--'));

const ALL_APPS = ['welcome', 'terminal', 'files', 'editor', 'viewer', 'paint', 'calc', 'settings', 'web'];
const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'lime'];
const target = apps.length ? apps : ALL_APPS;

const server = await serve(fileURLToPath(new URL('..', import.meta.url)));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.waitForTimeout(400);

const closeAll = () => page.evaluate(() => {
  for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
});

const openMaximized = async (id) => {
  await page.evaluate((app) => window.browserOS.launch(app, {}), id);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const w of window.browserOS.wm.windows.values()) if (!w.maximized) window.browserOS.wm.toggleMaximize(w.id);
  });
  await page.waitForTimeout(250);
};

const report = async (label) => {
  const res = await auditContrast(page, ['body']);
  const byWhere = new Map();
  for (const p of res.problems) {
    const key = `${p.where}|${p.color}|${p.background}`;
    if (!byWhere.has(key) || byWhere.get(key).ratio > p.ratio) byWhere.set(key, p);
  }
  console.log(`\n--- ${label}: ${res.runs.length} runs, ${res.problems.length} flagged, skipped ${JSON.stringify(res.skipped)}, decorative glyphs ${res.decorativeGlyphs}`);
  for (const p of [...byWhere.values()].sort((a, b) => a.ratio - b.ratio)) {
    console.log(`  ${String(p.ratio).padStart(5)}:1 (need ${p.required}) ${p.colourGlyph ? '[colour-glyph] ' : ''}${p.where}`);
    console.log(`         text ${JSON.stringify(p.text)} ink ${p.color}${p.alpha < 1 ? ` alpha ${p.alpha}` : ''} on ${p.background} @${p.fontPx}px`);
  }
};

for (const theme of themes) {
  for (const accent of allAccents ? ACCENTS : ['blue']) {
    await page.evaluate(([t, a]) => { window.browserOS.theme.set('theme', t); window.browserOS.theme.set('accent', a); }, [theme, accent]);
    await closeAll();
    await page.waitForTimeout(300);
    const tag = `${theme}${accent === 'blue' ? '' : ` · ${accent}`}`;

    await report(`${tag} — shell`);

    /* Shell states: the Start menu, a desktop context menu, a toast, a dialog. */
    await page.click('.start-btn'); await page.waitForTimeout(250);
    await report(`${tag} — Start menu`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);

    await page.click('.desktop', { position: { x: 700, y: 400 } }); await page.waitForTimeout(250);
    await report(`${tag} — desktop context menu`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);

    await openMaximized('terminal');
    await page.fill('.window[data-app="terminal"] .term-input', 'nope');
    await page.press('.window[data-app="terminal"] .term-input', 'Enter');
    /* Plain output — a line with no class at all. This is the case that was missed once: the
       terminal's own text, inherited from a window that is not the terminal. */
    await page.fill('.window[data-app="terminal"] .term-input', 'ls');
    await page.press('.window[data-app="terminal"] .term-input', 'Enter');
    await page.fill('.window[data-app="terminal"] .term-input', 'echo hello');
    await page.press('.window[data-app="terminal"] .term-input', 'Enter');
    await page.waitForTimeout(300);
    await report(`${tag} — terminal + error toast`);
    await closeAll();

    /* `void`, because confirm() returns a promise that only settles when the dialog is answered —
       and page.evaluate waits for a returned promise. */
    await page.evaluate(() => { void window.browserOS.dialogs.confirm({ title: 'Delete?', message: 'This cannot be undone.', danger: true }); });
    await page.waitForTimeout(300);
    await report(`${tag} — dialog`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);

    for (const app of target) {
      await openMaximized(app);
      await report(`${tag} — ${app}`);
      await closeAll();
      await page.waitForTimeout(200);
    }
  }
}

await browser.close();
await server.close();
