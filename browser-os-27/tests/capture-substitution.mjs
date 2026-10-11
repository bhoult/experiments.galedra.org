/* One screenshot, of the one screen this iteration changed: the terminal, showing `$(…)` doing
   the things the tests claim it does. The full `npm run screenshots` pass regenerates all
   eleven shots; this one exists so a text-output change can be judged for clipping and
   overflow without paying for all of them. */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const s = await serve(process.cwd());
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(`${s.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.waitForTimeout(600);

const run = async (c) => {
  await page.fill('.window[data-app="terminal"] .term-input', c);
  await page.press('.window[data-app="terminal"] .term-input', 'Enter');
  await page.waitForTimeout(120);
};

const created = [];
try {
  await page.evaluate(() => window.browserOS.launch('terminal'));
  await page.waitForTimeout(400);
  await run('mkdir -p demo/subs && cd ~/demo/subs');
  await run('echo one > a.txt; echo two > b.txt');
  await run('echo $(pwd)');
  await run('wc -l $(echo a.txt b.txt)');
  await run('grep shared a.txt b.txt');
  await run('echo written > $(echo target.txt) && cat target.txt');
  await run('echo x > *.out');
  await run('ls');
  await page.screenshot({ path: 'shots/12-terminal-substitution.png' });
  created.push('/home/user/demo');
} finally {
  /* The fixture is removed whatever happens, so a failure here cannot leave a `demo` folder
     behind for the next run's desktop capture to show. */
  await page.evaluate((paths) => { for (const p of paths) { try { window.browserOS.fs.rm(p, '/', true); } catch { /* already gone */ } } }, created);
  await page.screenshot({ path: 'shots/12-terminal-substitution-clean.png' });
  await b.close();
  await s.close();
}
