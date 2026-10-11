import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

test('windows focus, minimise, maximise and close', async () => {
  /* This test compares two windows, so it opens both. It used to borrow the terminal from
     whichever earlier test had left one open — which read fine in one file in a fixed order
     and means nothing when the areas run in parallel. */
  await closeAll();
  await openApp('terminal');
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

test('windows can be moved, resized and snapped from the keyboard', async () => {
  await closeAll();
  await openApp('calc');
  const rect = () => win('calc').evaluate((el) => ({
    x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10), w: el.offsetWidth, h: el.offsetHeight,
  }));
  const area = await page.evaluate(() => {
    const l = document.getElementById('windows');
    return { w: l.clientWidth, h: l.clientHeight };
  });

  const before = await rect();
  await win('calc').locator('.titlebar').focus();

  await page.keyboard.press('ArrowRight');
  const moved = await rect();
  assert.ok(moved.x > before.x, 'Arrow keys move a window whose title bar has focus');
  assert.equal(moved.w, before.w, 'moving must not resize');

  await page.keyboard.press('Shift+ArrowRight');
  assert.ok((await rect()).w > moved.w, 'Shift+Arrow resizes');

  await page.keyboard.press('Alt+ArrowLeft');
  const half = await rect();
  assert.equal(half.x, 0, 'Alt+Arrow snaps to the left half');
  assert.ok(Math.abs(half.w - Math.floor(area.w / 2)) <= 2, `expected a half-width window, got ${half.w}`);

  await page.keyboard.press('Alt+Shift+ArrowDown');
  const quarter = await rect();
  assert.equal(quarter.x, 0);
  assert.ok(Math.abs(quarter.y - Math.floor(area.h / 2)) <= 2, `expected the bottom half, got y=${quarter.y}`);
  assert.ok(Math.abs(quarter.h - Math.floor(area.h / 2)) <= 2, `expected a quarter height, got ${quarter.h}`);

  await page.keyboard.press('Enter');
  assert.ok((await win('calc').getAttribute('class')).includes('maximized'), 'Enter on a title bar maximises');
  await closeApp('calc');

  // Alt+Arrow also works from the shell for the focused window, but never while typing.
  await openApp('terminal');
  await page.focus(TERM_INPUT);
  const beforeTyping = await win('terminal').evaluate((el) => parseInt(el.style.left, 10));
  await page.keyboard.press('Alt+ArrowLeft');
  assert.equal(await win('terminal').evaluate((el) => parseInt(el.style.left, 10)), beforeTyping,
    'Alt+Arrow must not steal arrow keys from a text field');
  /* Focus the window this test is about, not "whichever window was opened first": a leftover
     window from an earlier test would make windows[0] a different window, and the snap would
     land on it while this one sat where it was. */
  await page.evaluate(() => {
    const t = [...window.browserOS.wm.windows.values()].find((w) => w.appId === 'terminal');
    window.browserOS.wm.focus(t.id);
  });
  await page.evaluate(() => document.getElementById('start-btn').focus());
  await page.keyboard.press('Alt+ArrowLeft');
  assert.equal(await win('terminal').evaluate((el) => parseInt(el.style.left, 10)), 0, 'Alt+Arrow snaps the focused window');
  await closeApp('terminal');
});

test('an app may take the keyboard when it opens, but not after you have chosen somewhere else', async () => {
  /* Every app that opens focuses its main control a beat later, so you can type straight
     away. A beat is also long enough to have clicked, tabbed or focused elsewhere — and an
     app that focuses on a timer unconditionally takes the keyboard back from that choice.
     That is what made Alt+Arrow snapping stop working once every ten runs: the test focused
     a taskbar button, the terminal stole focus back 30ms later, and the shell correctly
     refused to treat arrow keys as window commands while a text field had them. */
  await closeAll();
  await openApp('terminal');
  await page.evaluate(() => document.getElementById('start-btn').focus());
  await page.waitForTimeout(150);
  const kept = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  assert.equal(kept, 'start-btn', 'the terminal must not take the keyboard back from the taskbar');

  /* The other half of the claim: with nothing chosen, opening an app still hands you its
     keyboard. Removing the steal would pass the first half and break this one. */
  await page.evaluate(() => document.activeElement?.blur());
  await openApp('editor');
  await page.waitForTimeout(150);
  const typed = await page.evaluate(() => {
    const a = document.activeElement;
    return a?.closest('.window[data-app="editor"]') ? a.tagName : null;
  });
  assert.equal(typed, 'TEXTAREA', 'opening the editor still focuses the editor');

  await closeAll();
});

test('windows can be resized by dragging a resize handle', async () => {
  await closeAll();
  await openApp('terminal');
  /* Park the window where a +130/+90 drag cannot hit the viewport edge — the drag
     itself clamps to the desktop, and a spawn-position lottery made this flaky. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    w.el.style.left = '120px';
    w.el.style.top = '80px';
  });
  await page.waitForTimeout(200);
  const box = await win('terminal').boundingBox();
  /* Grab the south-east corner handle (a few px inside the rounded corner, where the
     handle actually is hittable) and pull it down-right. */
  await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 130, box.y + box.height + 90, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await win('terminal').boundingBox();
  assert.ok(after.width >= box.width + 100, `drag-resize should widen the window: ${box.width} → ${after.width}`);
  assert.ok(after.height >= box.height + 70, `drag-resize should heighten the window: ${box.height} → ${after.height}`);
  await closeApp('terminal');
});

test('the middle of a window top edge moves it; the ends still resize it', async () => {
  await closeAll();
  await openApp('terminal');
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    w.el.style.left = '200px';
    w.el.style.top = '150px';
  });
  await page.waitForTimeout(250);
  const box = await win('terminal').boundingBox();

  /* Grab the move strip in the middle of the top edge. */
  await page.mouse.move(box.x + box.width * 0.5, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + 103, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const moved = await win('terminal').boundingBox();
  assert.ok(Math.abs(moved.width - box.width) < 2 && Math.abs(moved.height - box.height) < 2,
    `the move strip must not resize the window: ${box.width}×${box.height} → ${moved.width}×${moved.height}`);
  assert.ok(moved.x >= box.x + 100 && moved.y >= box.y + 80,
    `the move strip must move the window: (${box.x},${box.y}) → (${moved.x},${moved.y})`);

  /* Grab the same edge near the corner: that is still a resize handle — pulling the
     north edge up grows the window upwards. */
  await page.mouse.move(moved.x + 30, moved.y + 3);
  await page.mouse.down();
  await page.mouse.move(moved.x + 30, moved.y - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const resized = await win('terminal').boundingBox();
  assert.ok(resized.height >= moved.height + 40,
    `the top edge near a corner must still resize: ${moved.height} → ${resized.height}`);
  assert.ok(resized.y <= moved.y - 30, `resizing the north edge must move the top up: ${moved.y} → ${resized.y}`);
  assert.ok(Math.abs(resized.width - moved.width) < 2, 'the north edge must not change the width');

  await closeApp('terminal');
});

test('window corners show a resize grip on hover', async () => {
  await closeAll();
  await openApp('terminal');
  const grip = await page.evaluate(() => {
    const h = document.querySelector('.window[data-app="terminal"] .rz-se');
    const s = getComputedStyle(h, '::after');
    return { bg: s.backgroundImage, idle: Number(s.opacity) };
  });
  assert.match(grip.bg, /repeating-linear-gradient/, 'corner handles should carry a grip pattern');
  assert.equal(grip.idle, 0, 'the grip stays hidden while the window is not hovered');

  await page.hover('.window[data-app="terminal"] .titlebar');
  await page.waitForTimeout(350);
  const onWindow = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.window[data-app="terminal"] .rz-se'), '::after').opacity));
  assert.ok(onWindow > 0.2, `hovering the window should reveal the grip, got opacity ${onWindow}`);

  await page.hover('.window[data-app="terminal"] .rz-se');
  await page.waitForTimeout(350);
  const onHandle = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.window[data-app="terminal"] .rz-se'), '::after').opacity));
  assert.ok(onHandle > onWindow, 'hovering the handle itself should strengthen the grip');

  await closeApp('terminal');
});

test('right-clicking a window lists the tiling a drag-to-edge would have done', async () => {
  await closeAll();
  await openApp('calc');
  const area = await page.evaluate(() => window.browserOS.wm.area);

  await win('calc').locator('.titlebar').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });

  const labels = (await page.locator('.cmenu-item').allTextContents()).map((t) => t.trim());
  for (const wanted of ['Minimise', 'Maximise', 'Left half', 'Right half', 'Top half', 'Bottom half',
    'Top-left quarter', 'Top-right quarter', 'Bottom-left quarter', 'Bottom-right quarter', 'Full screen', 'Close']) {
    assert.ok(labels.some((l) => l.includes(wanted)), `the window menu must offer "${wanted}", saw ${JSON.stringify(labels)}`);
  }

  /* It is the shared context-menu component, so it is audited like the other menus. */
  assertNoUnnamedControls(await auditControls(page, ['#context-menu']), 'the window menu');
  const colourOf = (sel) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).color);
  const danger = await colourOf('.cmenu-item.danger');
  const plain = await colourOf('.cmenu-item:not(.danger)');
  assert.notEqual(danger, plain, 'Close must look like the destructive action it is');

  /* The menu is the geometry, not a second copy of it. */
  await page.click('.cmenu-item:has-text("Top-left quarter")');
  await page.waitForTimeout(300);
  const quarter = await win('calc').evaluate((el) => ({
    x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10), w: el.offsetWidth, h: el.offsetHeight,
  }));
  assert.deepEqual(quarter, { x: 0, y: 0, w: Math.floor(area.w / 2), h: Math.floor(area.h / 2) },
    'the menu must tile the window exactly where the geometry says');

  await win('calc').locator('.titlebar').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  await page.click('.cmenu-item:has-text("Right half")');
  await page.waitForTimeout(300);
  const half = await win('calc').evaluate((el) => ({ x: parseInt(el.style.left, 10), w: el.offsetWidth, h: el.offsetHeight }));
  assert.equal(half.x, area.w - Math.floor(area.w / 2));
  assert.equal(half.w, Math.floor(area.w / 2));
  assert.equal(half.h, area.h, 'a half must span the full height');

  /* A destructive entry must not look like a harmless one. */
  const closeStyle = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.cmenu-item')].find((i) => i.textContent.includes('Close'));
    return { danger: item.classList.contains('danger'), color: getComputedStyle(item).color };
  });
  assert.ok(closeStyle.danger, 'Close is the destructive action in this menu');

  await page.evaluate(() => { window.browserOS.shell.clipboard = null; });
  await page.mouse.click(600, 400, { button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const paste = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.cmenu-item')].find((i) => i.textContent.includes('Paste'));
    const s = getComputedStyle(item);
    return { disabled: item.disabled, opacity: s.opacity, cursor: s.cursor };
  });
  assert.equal(paste.disabled, true, 'Paste is disabled with nothing on the clipboard');
  assert.ok(parseFloat(paste.opacity) < 0.6, `a disabled menu row must look disabled, opacity ${paste.opacity}`);
  assert.equal(paste.cursor, 'not-allowed');
  await page.keyboard.press('Escape');
  await closeAll();
});

test('the window menu is the same menu from the title bar and the taskbar, and can put a moved window back', async () => {
  await closeAll();
  await openApp('calc');

  const labels = async () => (await page.locator('#context-menu .cmenu-item').allTextContents()).map((t) => t.trim());
  const fromTitlebar = async () => {
    await win('calc').locator('.titlebar').click({ button: 'right' });
    await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
    const out = await labels();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    return out;
  };
  const rect = () => win('calc').evaluate((el) => ({
    x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10), w: el.offsetWidth, h: el.offsetHeight,
  }));

  /* A window has one menu. Where you happened to right-click is not a second feature. */
  const viaTitlebar = await fromTitlebar();
  await page.locator('.taskbar .titem').first().click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const viaTaskbar = await labels();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.deepEqual(viaTaskbar, viaTitlebar, 'the same window must offer the same menu wherever you ask for it');

  /* Nothing to undo until something has actually been moved. */
  assert.ok(!(await fromTitlebar()).some((l) => l.includes('Undo move')),
    'a window nobody has moved must not offer an Undo that does nothing');

  /* A burst of arrow-key nudges is one intention, so it is one undo — and the undo goes
     back to before the burst started, not back one step. */
  const before = await rect();
  await win('calc').locator('.titlebar').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(200);
  const nudged = await rect();
  assert.ok(nudged.x > before.x && nudged.w > before.w, 'the keyboard must have moved and resized it');

  const menu = await fromTitlebar();
  assert.ok(menu.some((l) => l.includes('Undo move')), 'after a move the menu must offer to put it back');
  await win('calc').locator('.titlebar').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  await page.click('.cmenu-item:has-text("Undo move")');
  await page.waitForTimeout(300);
  assert.deepEqual(await rect(), before, 'one undo must undo the whole burst, position and size both');

  /* And it is gone once there is nothing left to undo. */
  assert.ok(!(await fromTitlebar()).some((l) => l.includes('Undo move')),
    'the menu must not keep offering an undo that has run out');

  /* A drag is the same promise. */
  const bar = await win('calc').locator('.titlebar').boundingBox();
  await page.mouse.move(bar.x + 120, bar.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar.x + 380, bar.y + 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await rect();
  assert.notDeepEqual(dragged, before, 'the drag must have moved the window');
  await win('calc').locator('.titlebar').click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  await page.click('.cmenu-item:has-text("Undo move")');
  await page.waitForTimeout(300);
  assert.deepEqual(await rect(), before, 'a dragged window comes back to where it was');

  /* Pressing a title bar without moving anything is not a move. */
  const still = await win('calc').locator('.titlebar').boundingBox();
  await page.mouse.move(still.x + 120, still.y + 12);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.ok(!(await fromTitlebar()).some((l) => l.includes('Undo move')),
    'a click that did not move the window must not create an undo');

  await closeAll();
});

test('the drag preview names the zone it is previewing', async () => {
  await openApp('calc');
  const bar = await win('calc').locator('.titlebar').boundingBox();
  await page.mouse.move(bar.x + 120, bar.y + 12);
  await page.mouse.down();
  await page.mouse.move(bar.x + 300, bar.y + 200, { steps: 8 });

  const midDrag = await page.evaluate(() => {
    const p = document.getElementById('snap-preview');
    return { hidden: p.classList.contains('hidden'), text: p.textContent.trim() };
  });
  assert.deepEqual(midDrag, { hidden: true, text: '' }, 'the middle of the screen is not a zone');

  await page.mouse.move(6, 300, { steps: 10 });
  await page.waitForTimeout(150);
  const atEdge = await page.evaluate(() => {
    const p = document.getElementById('snap-preview');
    return { hidden: p.classList.contains('hidden'), text: p.textContent.trim(), w: p.offsetWidth };
  });
  assert.equal(atEdge.hidden, false, 'dragging to an edge must show the preview');
  assert.equal(atEdge.text, 'Left half', 'and it must say which zone that is');

  await page.mouse.move(6, 6, { steps: 6 });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.getElementById('snap-preview').textContent.trim()),
    'Top-left quarter', 'the corner must say it is a quarter, not a half');

  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const p = document.getElementById('snap-preview');
    return { hidden: p.classList.contains('hidden'), text: p.textContent.trim() };
  });
  assert.deepEqual(after, { hidden: true, text: '' }, 'the preview must not linger after the drop');
  await closeAll();
});

test('Tab stays inside the window you are working in', async () => {
  await closeAll();
  await openApp('paint');

  const active = () => page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    return {
      inPaint: !!a.closest('.window[data-app="paint"]'),
      probe: a.dataset.probe || null,
      label: a.getAttribute('aria-label') || a.tagName,
    };
  });

  /* Mark the ends of the window's own focus ring, using the same kind of selector a
     screen reader would follow. */
  const ringSize = await page.evaluate(() => {
    const win = document.querySelector('.window[data-app="paint"]');
    const sel = ['button:not([disabled])', 'a[href]', 'input:not([disabled])', 'select:not([disabled])',
      'textarea:not([disabled])', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])']
      .join(', ');
    const items = [...win.querySelectorAll(sel)].filter((n) => n.getClientRects().length);
    items[0].dataset.probe = 'first';
    items[items.length - 1].dataset.probe = 'last';
    items[0].focus();
    return items.length;
  });
  assert.ok(ringSize >= 5, `Paint should have a real focus ring, found ${ringSize}`);
  assert.equal((await active()).probe, 'first', 'setup: focus starts on the first control');

  /* Forward: the ring reaches the last control, wraps, and never leaves the window. */
  const seen = [];
  for (let i = 0; i < ringSize + 3; i++) {
    await page.keyboard.press('Tab');
    seen.push(await active());
  }
  const escaped = seen.filter((s) => !s.inPaint);
  assert.deepEqual(escaped, [], `Tab left the window ${escaped.length} time(s): ${JSON.stringify(escaped)}`);
  assert.ok(seen.some((s) => s.probe === 'last'), 'the ring must reach the last control');
  assert.ok(seen.some((s) => s.probe === 'first'), 'and wrap back to the first one');

  /* Backwards from the first control wraps to the other end. */
  await page.evaluate(() => document.querySelector('.window[data-app="paint"] [data-probe="first"]').focus());
  await page.keyboard.press('Shift+Tab');
  assert.equal((await active()).probe, 'last', 'Shift+Tab must wrap backwards');

  /* A control that handles Tab itself keeps it: the terminal completes paths with Tab,
     and the focus must not be yanked away. */
  await openApp('terminal');
  await page.fill(TERM_INPUT, 'cat Doc');
  await page.press(TERM_INPUT, 'Tab');
  await page.waitForTimeout(200);
  assert.match(await page.inputValue(TERM_INPUT), /Documents\//, 'Tab completion must still complete');
  assert.ok(await page.evaluate(() => !!document.activeElement?.closest('.window[data-app="terminal"]')),
    'and the terminal keeps focus while completing');

  await closeApp('terminal');
  await closeApp('paint');
});

test('the Tab ring walks exactly the controls the accessibility audit names', async () => {
  await closeAll();
  await openApp('paint');

  /* Both sides ask the same shared definition (src/core/utils.js). If wm.js grew its own
     list again, the ring would stop at controls the audit never looks at. */
  const info = await page.evaluate(async () => {
    const { INTERACTIVE_SELECTOR, isUsableControl } = await import('/src/core/utils.js');
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    const audited = [...w.el.querySelectorAll(INTERACTIVE_SELECTOR)]
      .filter((n) => n.getAttribute('aria-hidden') !== 'true' && n.getBoundingClientRect().height > 0);
    const ring = audited.filter(isUsableControl);
    return {
      audited: audited.length,
      ring: ring.length,
      skipped: audited.filter((n) => !isUsableControl(n)).map((n) => n.getAttribute('aria-label') || n.tagName),
      first: ring[0]?.getAttribute('aria-label') || ring[0]?.textContent.trim(),
    };
  });
  assert.ok(info.audited >= 10, `Paint's toolbar and title bar have many controls, saw ${info.audited}`);
  assert.ok(info.ring < info.audited, 'Paint opens with Undo/Redo disabled, and the ring must not stop there');
  assert.deepEqual(info.skipped.sort(), ['Redo', 'Undo'], `only disabled controls may be skipped, saw ${JSON.stringify(info.skipped)}`);

  /* Walk the whole ring and check what Tab actually stops at. */
  await page.evaluate(() => {
    window.__stops = [];
    document.addEventListener('focusin', (e) => window.__stops.push({
      disabled: e.target.matches(':disabled'),
      label: e.target.getAttribute('aria-label') || (e.target.textContent || '').trim().slice(0, 24),
    }));
  });
  await page.evaluate(async () => {
    const { INTERACTIVE_SELECTOR, isUsableControl } = await import('/src/core/utils.js');
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    const ring = [...w.el.querySelectorAll(INTERACTIVE_SELECTOR)].filter(isUsableControl);
    window.__ring = ring.length;
    window.__stops = [];
    ring[0].focus();
  });
  const ring = await page.evaluate(() => window.__ring);
  for (let i = 0; i < ring; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(30);
  }
  const stops = await page.evaluate(() => window.__stops.slice(1));
  assert.ok(stops.length >= ring - 2, `Tab must keep moving inside the window, saw ${stops.length} stops`);
  assert.ok(!stops.some((s) => s.disabled), `Tab must never land on a disabled control: ${JSON.stringify(stops)}`);
  await closeAll();
});

test('a window title too long for the title bar can still be read in full', async () => {
  await closeAll();
  const name = 'a-folder-name-long-enough-to-be-cut-out-of-the-title-bar';
  await page.evaluate((n) => window.browserOS.fs.mkdir(`/home/user/Documents/${n}`), name);
  await openApp('files', { path: `/home/user/Documents/${name}` });
  await setWidths(360, { height: 360 });

  const read = () => page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    const t = w.querySelector('.wtitle');
    return {
      text: t.textContent,
      title: t.getAttribute('title'),
      aria: w.getAttribute('aria-label'),
      /* Text wider than the box holding it is what an ellipsis *is*, measured. */
      cut: t.scrollWidth > t.clientWidth + 1,
    };
  });

  const at = await read();
  assert.ok(at.cut, 'the point of the test: at this width the title really is truncated');
  assert.match(at.text, /^Files — ~\/Documents\//);
  assert.ok(at.text.includes(name), 'the name is still the name in the DOM');
  assert.equal(at.title, at.text, 'the tooltip carries the whole title, not the summary on screen');
  assert.equal(at.aria, at.text, 'and so does the accessible name of the window');

  /* The other way a title changes: an app renaming its own window mid-session. */
  const renamed = await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    w.setTitle('Some other very long window title that will not fit in 360px either');
    const t = w.el.querySelector('.wtitle');
    return { text: t.textContent, title: t.getAttribute('title'), aria: w.el.getAttribute('aria-label') };
  });
  assert.equal(renamed.title, renamed.text, 'setTitle has to update the tooltip too, or the fix only covers the first title');
  assert.equal(renamed.aria, renamed.text);

  await page.evaluate((n) => window.browserOS.fs.rm(`/home/user/Documents/${n}`, '/', true), name);
  await closeAll();
});

/* A47. `data-collapsed` used to be the number of rungs a bar *walked*, which reads exactly
   like the number of things it gave up. When the ladder runs out the two come apart: a bar
   can apply every rung it is allowed and still overflow, and the last rung (shortening the
   current folder’s name) can change nothing at all. The watcher now reports both halves. */

test('closing a window closes the menu that came from it', async () => {
  await closeAll();
  await openApp('files');
  await page.locator('.window[data-app="files"] .filecell').first().click({ button: 'right' });
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  assert.ok(await page.evaluate(() => !!document.querySelector('#context-menu .cmenu-item')), 'the cell menu must open');

  await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => document.getElementById('context-menu').classList.contains('hidden')),
    'the menu must not outlive the window it was opened from');
});

/* The same fold, applied to a row of swatches instead of a path: a bar that only needs a
   little room gives up a little palette, and it gives up the colours listed last. */

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
