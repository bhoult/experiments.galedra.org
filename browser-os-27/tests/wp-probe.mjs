/* Dev probe (not part of `npm test`): what ink the theme chooses for a wallpaper, measured the
   way the app measures it — by painting the wallpaper and reading it back. */
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const { server, url } = await serve(process.cwd());
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(url);
await page.waitForTimeout(700);

const ask = async (label) => console.log(label.padEnd(14), await page.evaluate(() => ({
  setting: String(window.browserOS.theme.settings.customWallpaper || '').slice(0, 24),
  style: document.getElementById('wallpaper').style.background.slice(0, 34),
  ratio: window.browserOS.theme.wallpaperInkRatio,
  plate: window.browserOS.theme.wallpaperPlate,
  ink: getComputedStyle(document.querySelector('.desktop .dicon .label')).color,
})));

for (const id of ['aurora', 'paper', 'sunset']) {
  await page.evaluate((wp) => window.browserOS.theme.set('wallpaper', wp), id);
  await page.waitForTimeout(150);
  await ask('preset ' + id);
}

for (const [name, stops] of [['pale png', ['#f4f7fb', '#dfe7f2']], ['dark png', ['#101828', '#1c2a44']]]) {
  const dataUrl = await page.evaluate((cs) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 64, 64);
    cs.forEach((col, i) => grad.addColorStop(i / (cs.length - 1), col));
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png');
  }, stops);
  console.log('dataUrl head:', dataUrl.slice(0, 30), 'len', dataUrl.length);
  console.log('direct style test:', await page.evaluate((u) => {
    const el = document.getElementById('wallpaper');
    el.style.background = u;
    const afterDirect = el.style.background.slice(0, 20);
    el.style.background = ''; el.style.backgroundImage = u;
    const viaImage = el.style.backgroundImage.slice(0, 24);
    el.style.backgroundImage = ''; el.style.background = `url("${u}")`;
    const quoted = el.style.background.slice(0, 24);

    window.browserOS.theme.apply();
    return { afterDirect, viaImage, quoted, afterApply: el.style.background.slice(0, 20), custom: String(window.browserOS.theme.settings.customWallpaper).slice(0, 12) };
  }, dataUrl));
  console.log('identity:', await page.evaluate(() => ({
    same: window.browserOS.theme.wallpaperEl === document.getElementById('wallpaper'),
    count: document.querySelectorAll('#wallpaper').length,
    inline: window.browserOS.theme.wallpaperEl.style.background.slice(0, 20),
  })));
  console.log('set result:', await page.evaluate((u) => {
    try {
      window.browserOS.theme.set('customWallpaper', u);
      return { setting: String(window.browserOS.theme.settings.customWallpaper).slice(0, 20), style: document.getElementById('wallpaper').style.background.slice(0, 20) };
    } catch (e) { return { error: String(e) }; }
  }, dataUrl));
  await page.evaluate((u) => window.browserOS.theme.set('customWallpaper', u), dataUrl);
  await page.waitForFunction(() => window.browserOS.theme.wallpaperInkRatio !== null, null, { timeout: 5000 }).catch(() => null);
  await ask(name);
}
await page.evaluate(() => window.browserOS.theme.set('customWallpaper', null));
await browser.close(); await server.close();
