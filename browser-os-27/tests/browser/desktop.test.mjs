import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

test('boots into a usable desktop', async () => {
  assert.ok(await page.locator('#taskbar').isVisible());
  assert.ok(await page.locator('#clock .time').textContent());
  const icons = await page.locator('.dicon').count();
  assert.ok(icons >= 8, `expected desktop shortcuts, got ${icons}`);
  assert.ok(await page.locator('.dicon[data-kind="file"]').first().isVisible(), 'welcome.txt should be on the desktop');
  assert.ok(await win('welcome').isVisible(), 'first run should show the Welcome app');
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
  /* The file is this test's own setup. Session restore is a claim about what was in storage
     when the page closed, so the test has to put something there itself rather than rely on
     another test having written it. */
  await page.evaluate(() => window.browserOS.fs.write('/home/user/Documents/notes.md', 'restored after reload\n'));
  await openApp('terminal');
  await openApp('calc');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  assert.equal(await win('terminal').count(), 1, 'terminal window should come back');
  assert.equal(await win('calc').count(), 1, 'calculator window should come back');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Documents/notes.md')), /restored after reload/);
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

test('in-OS dialogs are keyboard driven and hand focus back', async () => {
  await openApp('terminal');
  await page.focus(TERM_INPUT);

  await page.evaluate(() => { window.__d = window.browserOS.dialogs.confirm({ title: 'Confirm test', message: 'press escape', confirmLabel: 'Yes', danger: true }); return true; });
  await page.waitForSelector('#dialogs .dialog', { state: 'visible', timeout: 5000 });
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#dialogs')), 'the dialog should take focus');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('dlg-btn')), 'the primary action should be focused');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__d), false, 'Escape cancels');
  await page.waitForSelector('#dialogs .dialog', { state: 'detached', timeout: 5000 });
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('.term-input')), 'focus should return to the terminal input');

  // Enter submits a prompt and the typed value is returned.
  await page.evaluate(() => { window.__p = window.browserOS.dialogs.prompt({ title: 'Type something', value: 'abc' }); return true; });
  await page.waitForSelector('#dialogs .dlg-input', { state: 'visible', timeout: 5000 });
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('dlg-input')),
    'a prompt must own focus the moment it is visible (a deferred focus races the caller)');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__p), 'abc');

  // Tab stays inside the dialog.
  await page.evaluate(() => { window.__c = window.browserOS.dialogs.confirm({ title: 'Trap test' }); return true; });
  await page.waitForSelector('#dialogs .dialog', { state: 'visible', timeout: 5000 });
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#dialogs')), 'Tab must not escape an open dialog');
  await dialogCancel();
  await closeApp('terminal');
});

test('new windows open below the desktop icons instead of on top of them', async () => {
  await closeAll();
  await openApp('calc');
  await openApp('terminal');
  const overlapping = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.dicon')].map((i) => i.getBoundingClientRect());
    return [...document.querySelectorAll('.window')]
      .map((w) => w.getBoundingClientRect())
      .flatMap((r) => icons.filter((i) => i.bottom > r.top + 2 && i.top < r.bottom - 2 && i.right > r.left + 2 && i.left < r.right - 2))
      .length;
  });
  assert.equal(overlapping, 0, 'no desktop icon should be hidden behind a freshly opened window');
  await closeAll();
});

test('a desktop full of files scrolls instead of spilling past the bottom of the screen', async () => {
  await closeAll();
  /* A 1280x800 screen fits forty icons in four rows. To see the bottom of a desktop at
     all, this one needs a smaller screen — which is also the case that used to break. */
  await page.setViewportSize({ width: 640, height: 480 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) window.browserOS.fs.write(`~/Desktop/bunch-${String(i).padStart(2, '0')}.txt`, 'x', '/');
  });
  await page.waitForTimeout(500);

  const grid = await page.evaluate(() => {
    const layer = document.getElementById('desktop-icons');
    const box = layer.getBoundingClientRect();
    const icons = [...layer.querySelectorAll('.dicon')];
    return {
      count: icons.length,
      scrollable: layer.scrollHeight > layer.clientHeight + 1,
      overflow: layer.scrollHeight - layer.clientHeight,
      atTop: icons.filter((i) => { const r = i.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1; }).length,
    };
  });
  assert.ok(grid.count >= 40, `the desktop should show the files it has, saw ${grid.count}`);
  assert.ok(grid.scrollable, `a desktop that does not fit must be scrollable, not clipped (overflow ${grid.overflow})`);
  assert.ok(grid.atTop >= 4, 'the top of the grid must still be visible without scrolling');

  /* The last icon is reachable, and opening a window does not lose it. */
  await page.evaluate(() => { const l = document.getElementById('desktop-icons'); l.scrollTop = l.scrollHeight; });
  await page.waitForTimeout(250);
  const reached = await page.evaluate(() => {
    const layer = document.getElementById('desktop-icons');
    const box = layer.getBoundingClientRect();
    const icons = [...layer.querySelectorAll('.dicon')];
    const last = icons[icons.length - 1].getBoundingClientRect();
    return { visible: last.top < box.bottom && last.bottom > box.top, scrollTop: layer.scrollTop };
  });
  assert.ok(reached.scrollTop > 0, 'the grid must actually scroll');
  assert.ok(reached.visible, 'scrolling must bring the last icon into view');

  await openApp('calc');
  const inside = await page.evaluate(() => {
    const r = document.querySelector('.window[data-app="calc"]').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: window.innerHeight, w: window.innerWidth, right: r.right, left: r.left };
  });
  assert.ok(inside.top >= -1 && inside.bottom <= inside.h + 1 && inside.left >= -1 && inside.right <= inside.w + 1,
    `a window must stay inside the screen even when the desktop is full: ${JSON.stringify(inside)}`);
  await closeAll();

  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) window.browserOS.fs.rm(`~/Desktop/bunch-${String(i).padStart(2, '0')}.txt`, '/');
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
});

test('the taskbar shows an empty state and updates without rebuilding buttons', async () => {
  await closeAll();
  assert.ok(await page.locator('.taskbar-empty').isVisible(), 'an empty taskbar should say “No open windows”');
  await openApp('terminal');
  assert.equal(await page.locator('.taskbar-empty').count(), 0, 'the hint must disappear once a window exists');
  await openApp('calc');
  assert.equal(await page.locator('.titem').count(), 2);
  /* Mark a button; focus changes must update classes in place, not recreate nodes. */
  await page.evaluate(() => { document.querySelector('.titem').dataset.marker = 'keepme'; });
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'calc');
    window.browserOS.wm.focus(w.id);
  });
  assert.ok(await page.evaluate(() => document.querySelector('.titem[data-marker="keepme"]') !== null),
    'focus changes must not rebuild taskbar buttons');
  assert.equal(await page.locator('.titem.focused').count(), 1, 'exactly one taskbar item is focused');
  /* A renamed window updates its taskbar label in place. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'calc');
    w.setTitle('Renamed calc');
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.titem .t', { hasText: 'Renamed calc' }).count(), 1);
  await closeAll();
  assert.ok(await page.locator('.taskbar-empty').isVisible(), 'closing every window brings the hint back');
});

test('a maximised window comes back maximised after a reload', async () => {
  await closeAll();
  await openApp('calc');
  await page.click('.window[data-app="calc"] .wbtn.max');
  await page.waitForTimeout(300);
  assert.ok(await win('calc').evaluate((el) => el.classList.contains('maximized')));
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'calc');
    return w ? { maximized: w.maximized, cls: w.el.classList.contains('maximized') } : null;
  });
  assert.deepEqual(state, { maximized: true, cls: true }, 'maximised state must survive a reload');
  await closeAll();
});

test('a crowded taskbar scrolls and marks the cut side with a fade', async () => {
  await closeAll();
  await page.setViewportSize({ width: 760, height: 560 });
  try {
    await openApp('terminal');
    await openApp('files');
    await openApp('calc');
    await openApp('settings');
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const t = document.getElementById('taskbar-items');
      return { scrollable: t.scrollWidth > t.clientWidth, right: t.dataset.overflowRight, left: t.dataset.overflowLeft };
    });
    assert.ok(state.scrollable, 'four window buttons should not fit in 760px');
    assert.equal(state.right, 'true', 'the cut right side must be marked for the fade');
    assert.equal(state.left, '', 'the left side is fully visible');

    await page.evaluate(() => { const t = document.getElementById('taskbar-items'); t.scrollLeft = t.scrollWidth; });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const t = document.getElementById('taskbar-items');
      return { right: t.dataset.overflowRight, left: t.dataset.overflowLeft };
    });
    assert.equal(after.right, '', 'scrolled to the end: no right fade');
    assert.equal(after.left, 'true', 'the left side is now the clipped one');
  } finally {
    /* A failure here must not leave every later test running in a 760px viewport. */
    await page.setViewportSize({ width: 1280, height: 800 });
    await closeAll();
  }
});

test('files clipboard: copy in one folder, paste into another via the context menu', async () => {
  await closeAll();
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.write('/home/user/clip-src.txt', 'clipboard payload', '/');
    fs.mkdir('/home/user/clip-dest', '/');
    fs.write('/home/user/clip-dest/anchor.txt', 'anchor', '/');
  });
  await openApp('files', { path: '/home/user' });

  await page.locator('.filecell[data-name="clip-src.txt"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  await page.click('#context-menu >> text=Copy to clipboard');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#toasts'), /Copied/);

  await page.locator('.filecell[data-name="clip-dest"]').dblclick();
  await page.waitForTimeout(400);
  await page.locator('.filecell[data-name="anchor.txt"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  const items = await page.locator('#context-menu .cmenu-item').allTextContents();
  assert.ok(items.some((t) => t.includes('Paste clipboard here')), 'paste must be offered when the clipboard is set');
  await page.click('#context-menu >> text=Paste clipboard here');
  await page.waitForTimeout(500);

  const names = await page.evaluate(() => window.browserOS.fs.list('/home/user/clip-dest').map((f) => f.name));
  assert.ok(names.includes('clip-src.txt'), `paste should copy the file into the folder, got ${JSON.stringify(names)}`);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/clip-dest/clip-src.txt')), /clipboard payload/);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/clip-src.txt')), true, 'copy mode keeps the original');

  await closeApp('files');
  await page.evaluate(() => {
    window.browserOS.shell.clipboard = null;
    window.browserOS.fs.rm('/home/user/clip-src.txt', '/', false);
    window.browserOS.fs.rm('/home/user/clip-dest', '/', true);
  });
});

test('uploading and drag-and-drop put real files into the virtual filesystem', async () => {
  await closeAll();
  await openApp('files', { path: '/home/user/Downloads' });

  /* The Upload button path. */
  await page.setInputFiles('.window[data-app="files"] input[type="file"]', {
    name: 'uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('uploaded via the input'),
  });
  await page.waitForTimeout(600);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Downloads/uploaded.txt')), /uploaded via the input/);

  /* The drag-and-drop-onto-a-Files-window path. */
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello dropped'], 'dropped.txt', { type: 'text/plain' }));
    document.querySelector('.window[data-app="files"] .wbody')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Downloads/dropped.txt')), /hello dropped/);
  assert.match(await page.textContent('#toasts'), /Uploaded/);

  /* Dropping onto the desktop uploads into ~/Desktop and shows an icon. */
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['from the desktop'], 'desktop-drop.txt', { type: 'text/plain' }));
    document.getElementById('desktop')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Desktop/desktop-drop.txt')), /from the desktop/);
  assert.equal(await page.locator('.dicon[data-kind="file"][data-path="/home/user/Desktop/desktop-drop.txt"]').count(), 1,
    'the desktop icon grid should show the dropped file');

  /* Multi-file upload, and the size guard: an oversized file is refused per-file
     without stopping the rest of the batch. */
  await page.setInputFiles('.window[data-app="files"] input[type="file"]', [
    { name: 'multi-1.txt', mimeType: 'text/plain', buffer: Buffer.from('first of many') },
    { name: 'multi-2.txt', mimeType: 'text/plain', buffer: Buffer.from('second of many') },
    { name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(5 * 1024 * 1024, 7) },
  ]);
  await page.waitForTimeout(900);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Downloads/multi-1.txt')), /first of many/);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Downloads/multi-2.txt')), /second of many/);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/Downloads/huge.bin')), false,
    'a 5 MB file must be refused before it is read');
  const toasts = await page.textContent('#toasts');
  assert.match(toasts, /too large/i, 'the refusal must name the reason');
  assert.match(toasts, /huge\.bin/, 'the refusal must name the file');

  /* The desktop shows its drop affordance while a file drag is over it (and clears it). */
  const affordance = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'dragging.txt', { type: 'text/plain' }));
    const d = document.getElementById('desktop');
    d.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    const during = d.classList.contains('dropping');
    d.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true }));
    return { during, after: d.classList.contains('dropping') };
  });
  assert.deepEqual(affordance, { during: true, after: false }, 'the dashed outline appears during the drag and goes away after');

  await closeApp('files');
  await page.evaluate(() => {
    for (const p of ['/home/user/Downloads/uploaded.txt', '/home/user/Downloads/dropped.txt',
      '/home/user/Downloads/multi-1.txt', '/home/user/Downloads/multi-2.txt',
      '/home/user/Desktop/desktop-drop.txt']) {
      window.browserOS.fs.rm(p, '/', false);
    }
  });
});

test('files clipboard: cut moves the file and empties the clipboard', async () => {
  await closeAll();
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.write('/home/user/cut-src.txt', 'moved content', '/');
    fs.mkdir('/home/user/cut-dest', '/');
    fs.write('/home/user/cut-dest/anchor.txt', 'anchor', '/');
    window.browserOS.shell.clipboard = null;
  });
  await openApp('files', { path: '/home/user' });

  await page.locator('.filecell[data-name="cut-src.txt"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  await page.click('#context-menu >> text=Cut to clipboard');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#toasts'), /Cut/);

  await page.locator('.filecell[data-name="cut-dest"]').dblclick();
  await page.waitForTimeout(400);
  await page.locator('.filecell[data-name="anchor.txt"]').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)');
  await page.click('#context-menu >> text=Paste clipboard here');
  await page.waitForTimeout(500);

  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/cut-src.txt')), false,
    'cut mode must remove the original');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/cut-dest/cut-src.txt')), /moved content/);
  assert.equal(await page.evaluate(() => window.browserOS.shell.clipboard), null,
    'a pasted cut must leave nothing on the clipboard');

  await closeApp('files');
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/cut-dest', '/', true));
});

test('touch: long-press opens the menu and a second tap opens the icon', async () => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 640 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${server.url}/index.html`);
  await p.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
  await p.waitForTimeout(200);
  assert.ok(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the touch context should report a coarse pointer');

  const box = await p.locator('.dicon[data-kind="app"][data-app-id="terminal"]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  /* Long-press (the touch right-click): hold a touch pointer still for >500ms. */
  await p.evaluate(([x, y]) => {
    const node = document.querySelector('.dicon[data-app-id="terminal"]');
    node.dispatchEvent(new PointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
  }, [cx, cy]);
  await p.waitForTimeout(750);
  assert.ok(await p.locator('#context-menu').isVisible(), 'long-press should open the icon menu');
  assert.match(await p.textContent('#context-menu'), /Open/);
  await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })));
  await p.evaluate(() => window.browserOS.shell.closeContextMenu());

  /* Deselect explicitly, then: tap selects, second tap opens. Wait past the
     long-press click-suppression window so these taps are unambiguous. */
  await p.evaluate(() => {
    const shell = window.browserOS.shell;
    shell.selected?.classList.remove('selected');
    shell.selected = null;
  });
  await p.waitForTimeout(600);
  await p.touchscreen.tap(cx, cy);
  await p.waitForTimeout(200);
  assert.equal(await p.locator('.window[data-app="terminal"]').count(), 0, 'the first tap should only select');
  assert.ok(await p.locator('.dicon[data-app-id="terminal"]').evaluate((el) => el.classList.contains('selected')));
  await p.touchscreen.tap(cx, cy);
  await p.waitForTimeout(400);
  assert.equal(await p.locator('.window[data-app="terminal"]').count(), 1, 'a second tap on the selected icon opens it');
  assert.deepEqual(errs, [], `touch session logged errors: ${errs.join('\n')}`);
  await ctx.close();
});

test('touch: long-press and the native contextmenu open a menu only once', async () => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 640 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${server.url}/index.html`);
  await p.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
  await p.evaluate(() => {
    const shell = window.browserOS.shell;
    window.__menuOpens = 0;
    const orig = shell.openContextMenu.bind(shell);
    shell.openContextMenu = (...args) => { window.__menuOpens++; return orig(...args); };
  });
  const box = await p.locator('.dicon[data-kind="app"][data-app-id="terminal"]').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const touchDown = (id) => p.evaluate(([id, x, y]) => {
    document.querySelector('.dicon[data-app-id="terminal"]').dispatchEvent(new PointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: id, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
  }, [id, x, y]);
  const nativeMenu = () => p.evaluate(() => document.querySelector('.dicon[data-app-id="terminal"]')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));

  /* Case 1: our long-press fires first; the native contextmenu that follows must be ignored. */
  await touchDown(21);
  await p.waitForTimeout(700);
  assert.equal(await p.evaluate(() => window.__menuOpens), 1, 'long-press should open the menu once');
  await nativeMenu();
  assert.equal(await p.evaluate(() => window.__menuOpens), 1, 'the duplicate native contextmenu must be ignored');
  await p.evaluate(() => { window.browserOS.shell.closeContextMenu(); });
  await p.waitForTimeout(500);

  /* Case 2: the native contextmenu arrives while the long-press timer is pending;
     the timer must be cancelled so nothing opens a second time. */
  await touchDown(22);
  await p.waitForTimeout(200);
  await nativeMenu();
  assert.equal(await p.evaluate(() => window.__menuOpens), 2, 'the native long-press menu should open once');
  await p.waitForTimeout(700); // past the original long-press deadline
  assert.equal(await p.evaluate(() => window.__menuOpens), 2, 'the cancelled timer must not open the menu again');
  await p.evaluate(() => { window.browserOS.shell.closeContextMenu(); });

  assert.deepEqual(errs, [], `touch session logged errors: ${errs.join('\n')}`);
  await ctx.close();
});

test('touch: long-press on a taskbar button opens the window menu once', async () => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 640 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${server.url}/index.html`);
  await p.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('calc');
  });
  await p.waitForSelector('.titem');
  await p.evaluate(() => {
    const shell = window.browserOS.shell;
    window.__menuOpens = 0;
    const orig = shell.openContextMenu.bind(shell);
    shell.openContextMenu = (...args) => { window.__menuOpens++; return orig(...args); };
  });

  const box = await p.locator('.titem').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await p.evaluate(([x, y]) => {
    document.querySelector('.titem').dispatchEvent(new PointerEvent('pointerdown', {
      pointerType: 'touch', pointerId: 61, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
  }, [x, y]);
  await p.waitForTimeout(750);
  assert.equal(await p.evaluate(() => window.__menuOpens), 1, 'long-press should open the window menu once');
  const items = await p.locator('#context-menu .cmenu-item').allTextContents();
  assert.ok(items.some((t) => t.includes('Minimise')), `menu should offer Minimise, got ${JSON.stringify(items)}`);
  assert.ok(items.some((t) => t.includes('Close')), 'menu should offer Close');

  /* The native contextmenu Android Chrome fires after a long-press must not reopen it. */
  await p.evaluate(() => document.querySelector('.titem')
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  assert.equal(await p.evaluate(() => window.__menuOpens), 1, 'the duplicate native contextmenu must be ignored');
  await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 61, bubbles: true })));
  await p.evaluate(() => window.browserOS.shell.closeContextMenu());

  /* A normal tap still works: the focused window's button minimises it. */
  await p.waitForTimeout(600); // past the click-suppression window
  await p.touchscreen.tap(x, y);
  await p.waitForTimeout(300);
  assert.ok(await p.evaluate(() => document.querySelector('.titem').classList.contains('minimized')), 'a tap should minimise the focused window');
  await p.touchscreen.tap(x, y);
  await p.waitForTimeout(300);
  assert.ok(await p.evaluate(() => !document.querySelector('.titem').classList.contains('minimized')), 'tapping again restores it');

  assert.deepEqual(errs, [], `touch session logged errors: ${errs.join('\n')}`);
  await ctx.close();
});

test('the desktop icon grid wraps instead of running off a narrow screen', async () => {
  await closeAll();
  await page.setViewportSize({ width: 420, height: 720 });
  await page.waitForTimeout(400);
  try {
    const narrow = await page.evaluate(() => {
      const grid = document.querySelector('.desktop-icons');
      const icons = [...document.querySelectorAll('.dicon')];
      const vw = window.innerWidth, vh = window.innerHeight;
      return {
        icons: icons.length,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        rows: getComputedStyle(grid).gridTemplateRows.split(' ').length,
        outside: icons.filter((i) => {
          const r = i.getBoundingClientRect();
          return r.right > vw + 1 || r.bottom > vh + 1 || r.width === 0;
        }).map((i) => i.textContent.trim()),
      };
    });
    assert.equal(narrow.outside.length, 0,
      `every icon must be on a 420px screen; off-screen: ${JSON.stringify(narrow.outside)}`);
    assert.equal(narrow.icons, 9, 'the test is only meaningful if all the icons are there');
    assert.ok(narrow.columns >= 2 && narrow.rows >= 2,
      `at 420px the icons must wrap into a grid, saw ${narrow.columns} columns x ${narrow.rows} rows`);

    /* The wide layout must not regress into a single tall column either. */
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => {
      const icons = [...document.querySelectorAll('.dicon')];
      const vw = window.innerWidth;
      return { outside: icons.filter((i) => i.getBoundingClientRect().right > vw + 1).length, columns: icons[0].getBoundingClientRect().width };
    });
    assert.equal(wide.outside, 0, 'a wide screen must show every icon too');
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
  }
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

test('a desktop icon with a long name keeps the part of the name that says what it is', async () => {
  /* The desktop truncates differently from the file grid: the label wraps to two lines and the
     *last* line is what the clamp throws away — which is exactly where an extension lives, so
     `2024-06-30-team-retrospective-notes-final.tar.gz` rendered as a long name with its meaning
     clipped off. Same split as everywhere else; the layout keeps the tail on the last visible
     line. */
  await closeAll();
  /* Two long names, because they fail differently: this one is a chain of short fragments the
     desktop would happily wrap, and a single 30-character word the desktop cannot wrap at all. */
  const long = '2024-06-30-team-retrospective-notesfromthelastquarter-final.tar.gz';
  const marker = 'release-2024-06-30-snapshot';
  await page.evaluate(([a, b]) => {
    window.browserOS.fs.write(`~/Desktop/${a}`, 'x', '/');
    window.browserOS.fs.write(`~/Desktop/${b}`, 'y', '/');
    window.browserOS.fs.write('~/Desktop/short.md', 'z', '/');
  }, [long, marker]);
  await page.waitForTimeout(500);

  const labels = await page.evaluate(([a, b]) => {
    const icon = (name) => [...document.querySelectorAll('.dicon[data-kind="file"]')]
      .find((n) => (n.dataset.path || '').endsWith(name));
    const grid = document.querySelector('.desktop-icons');
    const rowTrack = parseFloat(getComputedStyle(grid).gridAutoRows);
    /* The plate paints a 3px halo around a label. It costs no layout, but it does overlap what
       is next to it, so it counts when asking whether a row is big enough. */
    const plate = getComputedStyle(document.documentElement).getPropertyValue('--wallpaper-plate').trim();
    const halo = plate && plate !== 'transparent' ? 3 : 0;
    const parts = (name) => {
      const node = icon(name);
      if (!node) return null;
      const label = node.querySelector('.label');
      const head = label.querySelector('.name-head');
      const tail = label.querySelector('.name-tail');
      const shown = (n) => !!n && n.getBoundingClientRect().width > 0;
      const lines = (n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight));
      return {
        full: label.textContent,
        title: node.getAttribute('title'),
        labelHeight: Math.round(label.getBoundingClientRect().height),
        headText: head?.textContent ?? null,
        /* Text bigger than the box holding it is what a clamp *is* — measured rather than
           inferred from the CSS. A head that wraps is taller than it is wide-cut, so both
           directions are checked. */
        headCut: !!head && (head.scrollWidth > head.clientWidth + 1 || head.scrollHeight > head.clientHeight + 1),
        headLines: head ? lines(head) : 0,
        tailText: tail?.textContent ?? null,
        tailShown: shown(tail),
        /* The tail must land inside the label's own box: a floated tail that ends up below the
           clamp is a tail nobody can read. */
        tailInside: !!tail && tail.getBoundingClientRect().bottom <= label.getBoundingClientRect().bottom + 1,
        /* A grid row is a fixed track. An icon taller than its track overlaps the row below it,
           which is how a "two lines of label" change turns into a broken desktop. */
        overflowsRow: label.getBoundingClientRect().bottom + halo > node.getBoundingClientRect().top + rowTrack + 1,
        rowTrack,
      };
    };
    return { long: parts(a), marker: parts(b), short: parts('short.md') };
  }, [long, marker]);

  for (const [what, got] of Object.entries(labels)) assert.ok(got, `no desktop icon for ${what}`);
  assert.ok(labels.long.title.includes(long), 'the tooltip has the full name');
  assert.ok(labels.long.headCut, `the half that cannot fit is the one that gets cut: ${JSON.stringify(labels.long.headText)}`);
  /* The head is allowed two lines and no more, and the whole icon still has to fit its row. */
  assert.equal(labels.long.headLines, 2, `the name head is clamped to two lines, it rendered ${labels.long.headLines}`);
  assert.ok(labels.long.labelHeight <= 46, `the label is two lines of name plus its tail, got ${labels.long.labelHeight}px`);
  for (const [what, got] of Object.entries(labels))
    assert.equal(got.overflowsRow, false, `${what}: the icon is taller than its ${got.rowTrack}px grid row and overlaps the row below`);
  assert.equal(labels.long.tailText, '.tar.gz');
  assert.equal(labels.long.tailShown, true, 'the extension is on screen');
  assert.equal(labels.long.tailInside, true, 'and inside the label box, not below the clamp');
  assert.equal(labels.marker.tailText, '-snapshot', 'a folder-style marker is protected here too');
  assert.equal(labels.marker.tailShown, true);
  assert.equal(labels.short.tailText, null, 'a name nobody would truncate is not split into pieces');
  assert.equal(labels.short.headLines, 1, 'a short name is not given a second line to be');

  await page.evaluate(([a, b]) => {
    window.browserOS.fs.rm(`~/Desktop/${a}`, '/');
    window.browserOS.fs.rm(`~/Desktop/${b}`, '/');
    window.browserOS.fs.rm('~/Desktop/short.md', '/');
  }, [long, marker]);
  await closeAll();
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
