import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const s = await serve(process.cwd());
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(`${s.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/01-desktop.png' });

await page.evaluate(() => { window.browserOS.wm.close([...window.browserOS.wm.windows.values()][0].id); });
await page.evaluate(() => window.browserOS.launch('terminal'));
await page.waitForTimeout(300);
const run = async (c) => { await page.fill('.window[data-app="terminal"] .term-input', c); await page.press('.window[data-app="terminal"] .term-input', 'Enter'); };
await run('mkdir demo && echo created by the shell > demo/hello.txt');
await run('ls -l ~/demo');
await run('cat demo/hello.txt');
await run('neofetch');
await page.evaluate(() => window.browserOS.launch('files', { data: { path: '/home/user' } }));
await page.waitForTimeout(400);
await page.evaluate(() => {
  const wins = [...window.browserOS.wm.windows.values()];
  const term = wins.find(w => w.appId === 'terminal');
  const files = wins.find(w => w.appId === 'files');
  Object.assign(term.el.style, { left: '24px', top: '24px', width: '640px', height: '470px' });
  Object.assign(files.el.style, { left: '620px', top: '150px', width: '620px', height: '520px' });
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/02-terminal-files.png' });

await page.evaluate(() => window.browserOS.launch('paint'));
await page.evaluate(() => window.browserOS.launch('calc'));
await page.evaluate(() => window.browserOS.launch('settings'));
await page.waitForTimeout(600);
await page.evaluate(() => {
  const wins = [...window.browserOS.wm.windows.values()];
  const place = (id, x, y, w, h) => { const wn = wins.find(v => v.appId === id); if (wn) Object.assign(wn.el.style, { left: x+'px', top: y+'px', width: w+'px', height: h+'px' }); };
  place('settings', 20, 20, 520, 620);
  place('paint', 560, 20, 700, 420);
  place('calc', 1180 - 300, 470, 300, 300);
});
await page.waitForTimeout(400);
await page.click('#start-btn');
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/03-apps-startmenu.png' });

await page.keyboard.press('Escape');
await page.evaluate(() => window.browserOS.theme.set('theme', 'light'));
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/04-light.png' });

/* Back to dark, fresh desktop: Files with a context menu and folder item counts. */
await page.evaluate(() => {
  window.browserOS.theme.set('theme', 'dark');
  for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
});
await page.evaluate(() => window.browserOS.launch('files', { data: { path: '/home/user' } }));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
  Object.assign(w.el.style, { left: '400px', top: '110px', width: '720px', height: '540px' });
});
await page.waitForTimeout(400);
await page.locator('.filecell[data-name="Documents"]').click({ button: 'right' });
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/05-files-toolbar.png' });

/* Paint: a real stroke drawn with the line tool. */
await page.keyboard.press('Escape');
await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
await page.evaluate(() => window.browserOS.launch('paint'));
await page.waitForTimeout(700);
await page.evaluate(() => {
  const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
  Object.assign(w.el.style, { left: '120px', top: '90px', width: '900px', height: '600px' });
});
await page.waitForTimeout(500);
await page.click('.window[data-app="paint"] >> text=📏 Line');
const canvasBox = await page.locator('.window[data-app="paint"] .paint-canvas').boundingBox();
const pt = (fx, fy) => [canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy];
await page.mouse.move(...pt(0.12, 0.18));
await page.mouse.down();
await page.mouse.move(...pt(0.45, 0.72), { steps: 12 });
await page.mouse.up();
await page.click('.window[data-app="paint"] >> text=✏️ Pen');
await page.mouse.move(...pt(0.55, 0.25));
await page.mouse.down();
await page.mouse.move(...pt(0.85, 0.6), { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/06-paint.png' });

await b.close(); await s.close();
