import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TERM_INPUT = '.window[data-app="terminal"] .term-input';

let server, browser, page;
const consoleErrors = [];

before(async () => {
  server = await serve(ROOT);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`${server.url}/index.html`);
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const win = (app) => page.locator(`.window[data-app="${app}"]`);
const openApp = async (id, data) => {
  await page.evaluate(([id, data]) => window.browserOS.launch(id, data ? { data } : {}), [id, data]);
  await win(id).waitFor({ state: 'attached', timeout: 5000 });
};
const closeApp = async (id) => {
  const w = win(id);
  if (await w.count() === 0) return;
  await w.locator('.wbtn.close').click();
  await w.waitFor({ state: 'detached', timeout: 5000 });
};
const closeAll = async () => {
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
  });
  await page.waitForTimeout(400);
};
const runCommand = async (cmd) => {
  await page.fill(TERM_INPUT, cmd);
  await page.press(TERM_INPUT, 'Enter');
};

test('boots into a usable desktop', async () => {
  assert.ok(await page.locator('#taskbar').isVisible());
  assert.ok(await page.locator('#clock .time').textContent());
  const icons = await page.locator('.dicon').count();
  assert.ok(icons >= 8, `expected desktop shortcuts, got ${icons}`);
  assert.ok(await page.locator('.dicon[data-kind="file"]').first().isVisible(), 'welcome.txt should be on the desktop');
  assert.ok(await win('welcome').isVisible(), 'first run should show the Welcome app');
});

test('the Welcome tour fits its window without clipping the buttons', async () => {
  const fit = await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'welcome');
    const body = w.el.querySelector('.wbody');
    const cta = body.querySelector('.cta');
    return {
      clipped: cta.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1,
      overflowing: body.scrollHeight > body.clientHeight + 1,
    };
  });
  assert.deepEqual(fit, { clipped: false, overflowing: false });
});

test('terminal commands drive the filesystem', async () => {
  await openApp('terminal');
  await runCommand('mkdir smoke');
  await runCommand('echo hello from tests > smoke/greeting.txt');
  await runCommand('cd smoke && pwd');

  const content = await page.evaluate(() => window.browserOS.fs.read('/home/user/smoke/greeting.txt'));
  assert.match(content, /hello from tests/);

  // Tab completion for command names and for paths.
  await page.fill(TERM_INPUT, 'neo');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'neofetch ');

  await page.fill(TERM_INPUT, 'cat greet');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'cat greeting.txt');
  await page.press(TERM_INPUT, 'Enter');

  const out = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(out, /hello from tests/);
  assert.match(out, /\/home\/user\/smoke/);

  // Up arrow walks the command history.
  await page.press(TERM_INPUT, 'ArrowUp');
  assert.equal(await page.inputValue(TERM_INPUT), 'cat greeting.txt');
  await page.fill(TERM_INPUT, '');

  await runCommand('cd .. && rm -r smoke');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/smoke')), false);
});

test('windows focus, minimise, maximise and close', async () => {
  await openApp('calc');
  await win('terminal').locator('.titlebar').click();
  assert.equal(await page.evaluate(() => window.browserOS.wm.focusedId), await win('terminal').getAttribute('id'));

  // Re-launching a singleton app raises the existing window instead of opening a second one.
  await openApp('calc');
  assert.equal(await win('calc').count(), 1, 'calc should be raised, not duplicated');
  await win('calc').locator('.wbtn.max').click();
  assert.ok((await win('calc').getAttribute('class')).includes('maximized'));
  const box = await win('calc').boundingBox();
  assert.ok(box.width > 1200, 'maximised window should fill the desktop');
  await win('calc').locator('.wbtn.max').click();
  assert.ok(!(await win('calc').getAttribute('class')).includes('maximized'));

  await win('calc').locator('.wbtn.min').click();
  assert.ok((await page.locator('.titem[title="Calculator"]').getAttribute('class')).includes('minimized'));
  await page.locator('.titem[title="Calculator"]').click();
  assert.ok(!(await win('calc').getAttribute('class')).includes('minimized'));

  await closeApp('calc');
  assert.equal(await win('calc').count(), 0);
});

test('windows can be dragged and snapped to screen edges', async () => {
  await openApp('viewer');
  const before = await win('viewer').evaluate((el) => ({ left: el.style.left, top: el.style.top }));
  const bar = await win('viewer').locator('.titlebar').boundingBox();

  await page.mouse.move(bar.x + 120, bar.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar.x + 300, bar.y + 160, { steps: 12 });
  await page.mouse.up();
  const moved = await win('viewer').evaluate((el) => ({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) }));
  assert.ok(moved.left > parseInt(before.left, 10) + 100, 'drag should move the window right');
  assert.ok(moved.top > parseInt(before.top, 10) + 100, 'drag should move the window down');

  // Drag the title bar to the left edge → snap to the left half.
  const bar2 = await win('viewer').locator('.titlebar').boundingBox();
  await page.mouse.move(bar2.x + 120, bar2.y + 12);
  await page.mouse.down();
  await page.mouse.move(4, 200, { steps: 12 });
  await page.mouse.up();
  const snapped = await win('viewer').evaluate((el) => ({ w: el.offsetWidth, x: parseInt(el.style.left, 10) }));
  assert.equal(snapped.x, 0, 'snapped window should sit flush with the left edge');
  assert.ok(Math.abs(snapped.w - 640) <= 2, `expected a half-width window, got ${snapped.w}`);
  await closeApp('viewer');
});

test('start menu searches and launches apps', async () => {
  await page.click('#start-btn');
  await page.fill('.start-search input', 'calc');
  await page.waitForSelector('.app-tile');
  const names = await page.locator('.app-tile .name').allTextContents();
  assert.deepEqual(names, ['Calculator']);
  await page.click('.app-tile');
  await win('calc').waitFor({ state: 'attached' });
  assert.ok(await page.locator('#start-menu').isHidden());
  await closeApp('calc');
});

test('editor writes files back into the filesystem', async () => {
  await openApp('editor', { path: '/home/user/Documents/notes.md' });
  await page.click('.window[data-app="editor"] .editor-area');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nadded by the smoke test');
  await page.keyboard.press('Control+s');
  const saved = await page.evaluate(() => window.browserOS.fs.read('/home/user/Documents/notes.md'));
  assert.match(saved, /added by the smoke test/);
  await closeApp('editor');
});

test('files app lists a folder and creates one', async () => {
  await openApp('files', { path: '/home/user' });
  await win('files').waitFor({ state: 'visible' });
  const cells = await page.locator('.window[data-app="files"] .filecell .name').allTextContents();
  assert.deepEqual(cells, ['Desktop', 'Documents', 'Downloads', 'Pictures']);
  await page.click('.window[data-app="files"] >> text=+ Folder');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/new folder')), true);
  await closeApp('files');
});

test('settings changes theme and wallpaper', async () => {
  await openApp('settings');
  await page.click('.window[data-app="settings"] >> text=☀️ Light');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.locator('.window[data-app="settings"] .wp-tile').nth(2).click();
  const bg = await page.evaluate(() => document.getElementById('wallpaper').style.background);
  assert.ok(bg.length > 10, 'wallpaper should be applied');
  await page.click('.window[data-app="settings"] >> text=🌙 Dark');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  await closeApp('settings');
});

test('open desktop shortcuts and context menu work', async () => {
  await closeAll();
  await page.dblclick('.dicon[data-kind="app"][data-app-id="paint"]');
  await win('paint').waitFor({ state: 'attached' });
  await closeApp('paint');

  await page.locator('.dicon[data-kind="file"]').first().click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  const items = await page.locator('#context-menu .cmenu-item span:nth-child(2)').allTextContents();
  assert.ok(items.includes('Open'));
  assert.ok(items.includes('Delete'));
  await page.keyboard.press('Escape');
});

test('the session is restored after a reload', async () => {
  await closeAll();
  await openApp('terminal');
  await openApp('calc');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  assert.equal(await win('terminal').count(), 1, 'terminal window should come back');
  assert.equal(await win('calc').count(), 1, 'calculator window should come back');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Documents/notes.md')), /smoke test/);
});

test('show desktop minimises everything and brings it back', async () => {
  await openApp('terminal');
  await openApp('calc');
  await page.click('#show-desktop');
  assert.ok(await page.evaluate(() => [...window.browserOS.wm.windows.values()].every((w) => w.minimized)));
  await page.click('#show-desktop');
  assert.ok(await page.evaluate(() => [...window.browserOS.wm.windows.values()].some((w) => !w.minimized)));
  await closeAll();
});

test('windows stay inside the viewport when the browser is resized', async () => {
  await openApp('terminal');
  await openApp('settings');
  await page.setViewportSize({ width: 720, height: 520 });
  await page.waitForTimeout(400);
  const overflowing = await page.evaluate(() => [...window.browserOS.wm.windows.values()]
    .map((w) => w.el.getBoundingClientRect())
    .filter((r) => r.right > window.innerWidth + 2 || r.bottom > window.innerHeight + 2)
    .map((r) => `${Math.round(r.right)}x${Math.round(r.bottom)}`));
  assert.deepEqual(overflowing, []);
  await page.setViewportSize({ width: 1280, height: 800 });
  await closeAll();
});

test('toolbars keep buttons on one line even in narrow windows', async () => {
  await openApp('files');
  await openApp('paint');
  await page.evaluate(() => {
    for (const w of window.browserOS.wm.windows.values()) {
      w.el.style.width = '420px';
      w.el.style.height = '360px';
    }
  });
  await page.waitForTimeout(300);
  const wrapped = await page.evaluate(() => [...document.querySelectorAll('.window .toolbar .btn')]
    .map((b) => ({ label: b.textContent.trim(), height: Math.round(b.getBoundingClientRect().height) }))
    .filter((b) => b.height > 30));
  assert.deepEqual(wrapped, []);
  await closeAll();
});

test('terminal: nano alias, quoted && and storage commands', async () => {
  await openApp('terminal');

  await runCommand('nano ~/Documents/notes.md');
  await win('editor').waitFor({ state: 'attached', timeout: 5000 });
  assert.match(await page.inputValue('.editor-area'), /# Notes/);
  await closeApp('editor');

  await runCommand('echo "one && two"');
  const out = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(out, /one && two/, 'a quoted && must not split the command');

  await runCommand('stat ~/Documents/notes.md');
  assert.match(await page.textContent('.window[data-app="terminal"] .term-out'), /type\s+file/);

  await runCommand('df');
  const df = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(df, /files\s+\d+/);
  assert.match(df, /stored\s+\S+/);

  await runCommand('du ~/Documents');
  assert.match(await page.textContent('.window[data-app="terminal"] .term-out'), /Documents/);

  // Ctrl+C abandons the line being typed, without touching history.
  await page.fill(TERM_INPUT, 'half-typed');
  await page.press(TERM_INPUT, 'Control+c');
  assert.equal(await page.inputValue(TERM_INPUT), '');
  await page.press(TERM_INPUT, 'ArrowUp');
  assert.equal(await page.inputValue(TERM_INPUT), 'du ~/Documents');
  await page.fill(TERM_INPUT, '');
});

test('files app shows folder sizes and supports keyboard actions', async () => {
  await page.evaluate(() => window.browserOS.fs.write('~/kb-target.txt', 'delete me'));
  await openApp('files', { path: '/home/user' });

  const metas = await page.locator('.filecell .meta').allTextContents();
  assert.ok(metas.some((m) => /\d+ items?/.test(m)), `folders should show entry counts, got ${JSON.stringify(metas)}`);
  assert.ok(metas.some((m) => /bytes|B$/.test(m)), 'files should show their size');

  const cell = page.locator('.filecell[data-name="kb-target.txt"]');
  await cell.waitFor({ state: 'attached' });
  await cell.focus();
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/kb-target.txt')), false, 'Delete should remove the selected file');

  // F2 renames.
  await page.evaluate(() => window.browserOS.fs.write('~/rename-me.txt', 'x'));
  await page.waitForTimeout(300);
  await page.locator('.filecell[data-name="rename-me.txt"]').focus();
  page.once('dialog', (d) => d.accept('renamed.txt'));
  await page.keyboard.press('F2');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/renamed.txt')), true);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/rename-me.txt')), false);
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/renamed.txt', '/', false));
  await closeApp('files');
});

test('editor asks before closing a document with unsaved changes', async () => {
  await openApp('editor');
  await page.click('.window[data-app="editor"] .editor-area');
  await page.keyboard.type('this was never saved');
  assert.match(await page.textContent('.window[data-app="editor"] .statusbar'), /unsaved/);

  await win('editor').locator('.wbtn.close').click();
  await page.waitForTimeout(300);
  assert.equal(await win('editor').count(), 1, 'dismissing the warning should keep the window open');

  page.once('dialog', (d) => d.accept());
  await win('editor').locator('.wbtn.close').click();
  await win('editor').waitFor({ state: 'detached', timeout: 5000 });
});

test('editor notices when its file disappears instead of going stale', async () => {
  await page.evaluate(() => window.browserOS.fs.write('/home/user/scratch.txt', 'important text'));
  await openApp('editor', { path: '/home/user/scratch.txt' });
  await page.waitForTimeout(300);
  assert.match(await page.inputValue('.editor-area'), /important text/);

  // A sibling file with a shared prefix must not touch this buffer.
  await page.evaluate(() => window.browserOS.fs.write('/home/user/scratch.txt.bak', 'other file'));
  await page.waitForTimeout(300);
  assert.match(await page.inputValue('.editor-area'), /important text/);
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/scratch.txt.bak', '/', false));

  await page.evaluate(() => window.browserOS.fs.reset());
  await page.waitForTimeout(400);
  const toast = await page.textContent('#toasts');
  assert.match(toast, /File disappeared/, 'a factory reset should warn open editors');
  assert.match(await page.inputValue('.editor-area'), /important text/, 'the buffer must survive');
  assert.match(await page.textContent('.window[data-app="editor"] .statusbar'), /unsaved/);

  page.once('dialog', (d) => d.accept());
  await closeApp('editor');
});

test('paint draws where the pointer is and saves a full-resolution PNG', async () => {
  await openApp('paint');
  await page.waitForTimeout(500); // let the window-open animation finish before measuring
  const canvas = win('paint').locator('.paint-canvas');
  const box = await canvas.boundingBox();
  await page.click('.window[data-app="paint"] >> text=📏 Line');

  const sizing = await page.evaluate(() => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    return { backing: [c.width, c.height], layout: [c.offsetWidth, c.offsetHeight], dpr: window.devicePixelRatio || 1 };
  });
  assert.deepEqual(sizing.backing, [sizing.layout[0] * sizing.dpr, sizing.layout[1] * sizing.dpr],
    'the canvas backing store must match its layout size (HiDPI-correct)');

  const sample = (cx, cy) => page.evaluate(([x, y]) => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [cx, cy]);

  const from = { x: 40, y: 40 };
  const to = { x: Math.floor(box.width) - 40, y: Math.floor(box.height) - 40 };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };

  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + mid.x, box.y + mid.y, { steps: 10 });

  const during = await sample(mid.x, mid.y);
  assert.ok(during[2] > 180 && during[0] < 160, `the line preview should follow the pointer, got rgb(${during})`);

  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await page.mouse.up();

  const atMid = await sample(mid.x, mid.y);
  assert.ok(atMid[2] > 180 && atMid[0] < 160, `the stroke should be at the pointer position, got rgb(${atMid})`);
  const offLine = await sample(mid.x, mid.y + 60);
  assert.deepEqual(offLine, [255, 255, 255], 'pixels away from the stroke must stay white');

  await page.click('.window[data-app="paint"] >> text=Save PNG');
  await win('viewer').waitFor({ state: 'attached', timeout: 5000 });

  const saved = await page.evaluate(async () => {
    const data = window.browserOS.fs.read('/home/user/Pictures/sketch.png');
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    const img = new Image();
    img.src = data;
    await img.decode();
    return { isPng: data.startsWith('data:image/png'), png: [img.naturalWidth, img.naturalHeight], canvas: [c.width, c.height] };
  });
  assert.ok(saved.isPng, 'the saved file should be a PNG data URL');
  assert.deepEqual(saved.png, saved.canvas, 'the PNG should keep the full-resolution backing store');

  await closeApp('viewer');
  await closeApp('paint');
});

test('context menus close on an outside click and can open a second window', async () => {
  await closeAll();
  await openApp('terminal');

  await page.locator('.dicon[data-kind="app"][data-app-id="terminal"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  await page.mouse.click(760, 520);
  await page.waitForSelector('#context-menu.hidden', { state: 'attached', timeout: 3000 });

  await page.locator('.dicon[data-kind="app"][data-app-id="terminal"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  await page.click('#context-menu >> text=Open in new window');
  await page.waitForTimeout(500);
  assert.equal(await win('terminal').count(), 2, '“Open in new window” must not replace the existing window');
  await closeAll();
});

test('settings can hide the desktop app shortcuts', async () => {
  await openApp('settings');
  const appIcons = () => page.locator('.dicon[data-kind="app"]').count();
  const before = await appIcons();
  assert.ok(before >= 5, 'shortcuts should be visible by default');

  await page.getByRole('button', { name: 'Desktop shortcuts: shown' }).click();
  await page.waitForTimeout(300);
  assert.equal(await appIcons(), 0, 'hiding shortcuts should remove the app icons');
  assert.ok(await page.locator('.dicon[data-kind="file"]').count() > 0, 'file shortcuts stay');

  await page.getByRole('button', { name: 'Desktop shortcuts: hidden' }).click();
  await page.waitForTimeout(300);
  assert.equal(await appIcons(), before, 'showing shortcuts again should restore them');

  const storage = (await page.locator('.window[data-app="settings"] .card').allTextContents()).join('\n');
  assert.match(storage, /Files & storage[\s\S]*?\d+ files, /, 'the storage card should report file counts');
  await closeApp('settings');
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});
