import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

test('toolbars stay on one line: they compact first, and only then scroll', async () => {
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

  /* Files at 420px is 60px narrower than the width it asks for. It must have compacted —
     nothing out of reach, no fade, no scroll. */
  const filesBar = '.window[data-app="files"] .toolbar';
  const compacted = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const box = t.getBoundingClientRect();
    const out = [...t.querySelectorAll('button, input')]
      .filter((c) => c.getBoundingClientRect().width > 0)
      .filter((c) => c.getBoundingClientRect().right > box.right + 1)
      .map((c) => c.getAttribute('aria-label') || '');
    return {
      scrollable: t.scrollWidth > t.clientWidth + 1,
      right: t.dataset.overflowRight,
      collapsed: Number(t.dataset.collapsed || 0),
      out,
    };
  }, filesBar);
  assert.ok(!compacted.scrollable, 'a Files window 60px under its minimum must compact, not scroll');
  assert.deepEqual(compacted.out, [], `nothing may be out of reach: ${compacted.out.join(', ')}`);
  assert.ok(compacted.collapsed > 0, 'a 420px Files window must compact something');
  assert.notEqual(compacted.right, 'true', 'a bar that fits must not be faded');

  /* Below the width the app declares it needs, the bar has run out of things it is willing
   * to give up. Then it must scroll — and mark the clipped side (CSS fades it). */
  await page.evaluate((sel) => { document.querySelector(sel).closest('.window').style.width = '340px'; }, filesBar);
  await page.waitForTimeout(300);
  const clipped = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    return { scrollable: t.scrollWidth > t.clientWidth + 1, right: t.dataset.overflowRight };
  }, filesBar);
  assert.ok(clipped.scrollable, 'a Files window below its 360px minimum must overflow');
  assert.equal(clipped.right, 'true', 'the clipped right side must be marked for the fade');

  await page.evaluate((sel) => { const t = document.querySelector(sel); t.scrollLeft = t.scrollWidth; }, filesBar);
  await page.waitForTimeout(200);
  const afterScroll = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    return { right: t.dataset.overflowRight, left: t.dataset.overflowLeft };
  }, filesBar);
  assert.equal(afterScroll.right, '', 'scrolled to the end: no right fade');
  assert.equal(afterScroll.left, 'true', 'the left side is now the clipped one');

  /* Paint at the same width has compacted instead: nothing is out of reach, and the
     thing that gave way is the colour swatches, not the tools or Save. */
  const paintBar = '.window[data-app="paint"] .toolbar';
  const paint = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const box = t.getBoundingClientRect();
    const items = [...t.querySelectorAll('button, input')].filter((c) => !c.classList.contains('toolbar-more')).map((c) => {
      const r = c.getBoundingClientRect();
      return {
        label: c.getAttribute('aria-label') || '',
        hidden: r.width === 0,
        clipped: r.width > 0 && r.right > box.right + 1,
      };
    });
    return {
      overflow: t.scrollWidth > t.clientWidth + 1,
      collapsed: Number(t.dataset.collapsed || 0),
      clipped: items.filter((i) => i.clipped).map((i) => i.label),
      hidden: items.filter((i) => i.hidden).map((i) => i.label),
    };
  }, paintBar);
  assert.ok(!paint.overflow, 'a compacted Paint toolbar must fit, not scroll');
  assert.deepEqual(paint.clipped, [], `nothing may be out of reach: ${paint.clipped.join(', ')}`);
  assert.ok(paint.collapsed > 0, 'a 420px Paint window must compact something');
  assert.ok(paint.hidden.length && paint.hidden.every((l) => /Palette/.test(l)),
    `the swatch row gives way first, hid: ${paint.hidden.join(', ')}`);

  await closeAll();
});

test('a toolbar re-fits when its content changes, not only when the window is resized', async () => {
  await openApp('files');
  const bar = '.window[data-app="files"] .toolbar';
  await page.evaluate(() => {
    for (const w of window.browserOS.wm.windows.values()) { w.el.style.width = '900px'; }
  });
  await page.waitForTimeout(300);

  const read = () => page.evaluate((sel) => {
    const t = document.querySelector(sel);
    return {
      level: Number(t.dataset.collapsed || 0),
      scroll: t.scrollWidth,
      client: t.clientWidth,
      overflowRight: t.dataset.overflowRight,
    };
  }, bar);

  const before = await read();
  assert.ok(before.scroll <= before.client + 1,
    `Files should fit its own toolbar at 900px before the change (${before.scroll}/${before.client})`);

  /* Make the bar's content wider without touching the window — this is what navigating
     into a deeper folder or renaming a control does. A ResizeObserver cannot see this.
     Wide enough to matter: a bar has slack (a filter box and a spacer can shrink), and the
     point is that the slack running out makes the bar give up a group. */
  await page.evaluate((sel) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'A very wide injected control that will not fit';
    btn.setAttribute('aria-label', 'A very wide injected control that will not fit');
    document.querySelector(sel).appendChild(btn);
  }, bar);
  await page.waitForTimeout(400);

  const after = await read();
  assert.ok(after.level > before.level,
    `more content must compact more groups: level ${before.level} -> ${after.level}`);
  assert.ok(after.scroll <= after.client + 1 || after.overflowRight === 'true',
    `a bar that still cannot fit must admit it rather than clip silently (${after.scroll}/${after.client})`);

  await closeAll();
});

test("every app's toolbar reaches every control at the width it declares it needs", async () => {
  await closeAll();
  const apps = await page.evaluate(() => window.browserOS.apps
    .filter((a) => a.minWidth)
    .map((a) => ({ id: a.id, minWidth: a.minWidth, width: a.width })));
  assert.ok(apps.length >= 6, `apps should declare a minimum width, saw ${apps.length}`);

  for (const app of apps) {
    await openApp(app.id);
    await setWidths(app.minWidth);
    /* The guarantee an app's minWidth is a promise about: at that width every action is
       reachable — either in the bar, or named in the `⋯` menu the core adds to a bar that
       genuinely cannot show it. "It fits" was the old promise, and Files broke it. */
    const bars = await page.evaluate(() => {
      /* Mirrors core/utils.js controlName(): a failure must name a control the way the
         menu would name it. */
      const name = (c) => {
        const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
        if (c.getAttribute('aria-label')) return flat(c.getAttribute('aria-label'));
        const text = [...c.childNodes]
          .filter((n) => !(n.nodeType === 1 && n.matches('.btn-glyph, .glyph, .kbd')))
          .map((n) => n.textContent).join(' ');
        if (flat(text).length > 1) return flat(text);
        return flat(c.getAttribute('title') || '') || 'control';
      };
      return [...document.querySelectorAll('.window .toolbar')].map((bar) => {
        const box = bar.getBoundingClientRect();
        const clipped = [...bar.querySelectorAll('button, input')]
          .filter((c) => !c.classList.contains('toolbar-more'))
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
          })
          .map(name);
        const more = bar.querySelector('.toolbar-more');
        return {
          app: bar.closest('.window').dataset.app,
          clipped,
          more: !!more && !more.hidden,
          /* The button is only useful if it is the part that is *not* cut off. */
          pinned: !!more && !more.hidden && (() => {
            const r = more.getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right - 1;
          })(),
        };
      });
    });
    for (const bar of bars) {
      if (!bar.clipped.length) continue;
      assert.ok(bar.more, `${bar.app} at ${app.minWidth}px leaves ${bar.clipped.join(', ')} out of reach and offers no ⋯ menu`);
      assert.ok(bar.pinned, `${bar.app} at ${app.minWidth}px: the ⋯ button must sit inside the visible part of the bar`);
    }
    await closeApp(app.id);
  }
});

test('a toolbar too narrow for its actions offers them in a ⋯ menu, and using it works', async () => {
  await openApp('files');
  /* 340px is under the 360px Files declares it needs. At its own minimum Files compacts
     enough to show everything, so the ⋯ menu is tested where it is genuinely needed. */
  await setWidths(340, { height: 360 });

  const bar = '.window[data-app="files"] .toolbar';
  const state = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const box = t.getBoundingClientRect();
    const more = t.querySelector('.toolbar-more');
    const clipped = [...t.querySelectorAll('button, input')]
      .filter((c) => !c.classList.contains('toolbar-more'))
      .filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.right > box.right + 1; })
      .map((c) => c.getAttribute('aria-label') || c.getAttribute('title') || c.textContent || '');
    if (!more) return { clipped, missing: true };
    const r = more.getBoundingClientRect();
    return {
      clipped,
      missing: false,
      hidden: more.hidden,
      visible: r.width > 0 && r.left >= box.left - 1 && r.right <= box.right - 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      named: !!(more.getAttribute('aria-label') || '').trim(),
    };
  }, bar);

  assert.ok(state.clipped.length, 'a Files window below its 360px minimum must leave some actions out of reach');
  assert.ok(!state.missing, 'an overflowing bar must be given a ⋯ button');
  assert.equal(state.hidden, false, 'the ⋯ button must show exactly when something is out of reach');
  assert.ok(state.named, 'the ⋯ button needs an accessible name');
  assert.ok(state.visible, 'the ⋯ button belongs to the bar, not to the window frame');

  /* Sticky: the one control that must always be reachable is the one that reveals the
     rest. Checked at every scroll position, because a button pinned to the *content*
     would scroll away with everything else. */
  for (const where of ['start', 'middle', 'end']) {
    await page.evaluate(([sel, pos]) => {
      const t = document.querySelector(sel);
      t.scrollLeft = pos === 'end' ? t.scrollWidth : pos === 'middle' ? Math.round(t.scrollWidth / 2) : 0;
    }, [bar, where]);
    await page.waitForTimeout(150);
    const still = await page.evaluate((sel) => {
      const t = document.querySelector(sel);
      const box = t.getBoundingClientRect();
      const r = t.querySelector('.toolbar-more').getBoundingClientRect();
      return { ok: r.width > 0 && r.left >= box.left - 1 && r.right <= box.right - 1, scrollLeft: t.scrollLeft };
    }, bar);
    assert.ok(still.ok, `the ⋯ button must stay in view when the bar is scrolled to the ${where} (scrollLeft ${still.scrollLeft})`);
  }

  await page.evaluate((sel) => { document.querySelector(sel).scrollLeft = 0; }, bar);
  await page.waitForTimeout(150);
  await page.click(`${bar} .toolbar-more`);
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const menu = await page.textContent('#context-menu');
  for (const label of state.clipped) {
    assert.ok(menu.includes(label.trim()), `the menu must name the hidden action "${label.trim()}"`);
  }

  /* Picking an action must perform it, not merely scroll the bar. Files at this width has
     already given its create pair to a single "New" button, so the one thing genuinely off
     the edge is Upload — whose result is a native file picker this test cannot drive. Paint
     at 380px is the same situation with an action whose effect is observable. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await closeAll();

  await openApp('paint');
  await setWidths(380, { height: 420 });
  const paintBar = '.window[data-app="paint"] .toolbar';
  /* Opened with a real click on the button, not a Playwright click: Playwright scrolls its
     target into view, and the ⋯ is pinned to the right end of a scrollable bar — so a
     Playwright click would scroll the bar to its end and change what is out of reach. */
  await page.evaluate((sel) => { document.querySelector(`${sel} .toolbar-more`).click(); }, paintBar);
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const offered = await page.evaluate(() => [...document.querySelectorAll('#context-menu .cmenu-item')]
    .map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  const target = offered.find((l) => l.includes('Save PNG'));
  assert.ok(target, `a Paint bar too narrow for its Save action must offer it in the ⋯ menu (offered: ${offered.join(', ')})`);

  const pngs = () => page.evaluate(() => window.browserOS.fs.list('/home/user/Pictures')
    .filter((e) => e.name.endsWith('.png')).map((e) => e.name));
  const before = await pngs();
  await page.click('#context-menu .cmenu-item:has-text("Save PNG")');
  await page.waitForTimeout(700);
  const after = await pngs();
  assert.ok(after.length > before.length, 'choosing Save PNG from the overflow menu must save the drawing');

  const reached = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const box = t.getBoundingClientRect();
    const btn = [...t.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Save PNG'));
    const r = btn.getBoundingClientRect();
    return { found: r.width > 0, ok: r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 };
  }, paintBar);
  assert.ok(reached.found, 'the action the menu offered must be a control on the bar');
  assert.ok(reached.ok, 'the control you chose is scrolled into view as well as used');

  await page.evaluate((extra) => {
    for (const name of extra) window.browserOS.fs.rm(`/home/user/Pictures/${name}`, '/', true);
  }, after.filter((n) => !before.includes(n)));
  await closeAll();
});

test('a ⋯ menu is only offered while something is out of reach, and goes away when it fits', async () => {
  await openApp('files');
  const bar = '.window[data-app="files"] .toolbar';
  const read = () => page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const more = t.querySelector('.toolbar-more');
    return {
      overflow: t.scrollWidth > t.clientWidth + 1,
      shown: !!more && !more.hidden,
      level: Number(t.dataset.collapsed || 0),
    };
  }, bar);

  await page.evaluate(() => { for (const w of window.browserOS.wm.windows.values()) w.el.style.width = '340px'; });
  await page.waitForTimeout(300);
  const narrow = await read();
  assert.ok(narrow.overflow && narrow.shown, 'a bar below the width its app asks for must overflow and offer the menu');

  await page.evaluate(() => { for (const w of window.browserOS.wm.windows.values()) w.el.style.width = '900px'; });
  await page.waitForTimeout(300);
  const wide = await read();
  assert.ok(!wide.overflow, 'the same bar at 900px must fit everything');
  assert.equal(wide.shown, false, 'a bar that fits must not offer a menu of hidden actions');
  assert.equal(wide.level, 0, 'and must not have hidden any group');

  await closeAll();
});

test('Files names the folder you are in at the width it opens by default', async () => {
  await closeAll();
  await page.evaluate(() => window.browserOS.fs.mkdir('/home/user/Documents/notes/deep'));
  await openApp('files', { path: '/home/user/Documents/notes/deep' });

  const read = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const trail = bar.querySelector('.crumbs');
    const shown = (node) => node && node.getBoundingClientRect().width > 0;
    return {
      width: Math.round(document.querySelector('.window[data-app="files"]').getBoundingClientRect().width),
      level: Number(bar.dataset.collapsed || 0),
      overflow: bar.scrollWidth > bar.clientWidth + 1,
      more: !!bar.querySelector('.toolbar-more:not([hidden])'),
      trail: [...trail.querySelectorAll('button')].filter((b) => shown(b)).map((b) => b.textContent),
      mids: trail.querySelectorAll('.crumb-mid').length,
      shownMids: [...trail.querySelectorAll('.crumb-mid')].filter(shown).length,
      /* Minimality, measured the only way it can be: put back the thing the bar gave up
         last and see whether it would still have fitted. */
      restoresLast: (() => {
        const last = window.testHelpers.lastCut(bar);
        if (!last) return null;
        last.classList.remove('is-collapsed');
        const fits = bar.scrollWidth <= bar.clientWidth + 1;
        last.classList.add('is-collapsed');
        return fits;
      })(),
      elide: shown(trail.querySelector('.crumb-elide')),
      /* What the bar has given up, in the order the app declared it may be given up. The
         promise is that this is always a prefix: a later group is only touched once every
         group before it has already given way, and nothing after the point where the bar
         fitted is hidden for nothing. */
      order: window.testHelpers.givenUpOrder(bar),
      title: document.querySelector('.window[data-app="files"] .wtitle').textContent,
    };
  });

  /* The default width is the width most people will actually use, so this is the case
     that matters most: the trail must say where you are without the app giving anything
     up for it. */
  const atDefault = await read();
  assert.ok(atDefault.width >= 800, `the test is about the width Files asks for, got ${atDefault.width}`);
  assert.deepEqual(atDefault.trail, ['~', 'Documents', 'notes', 'deep'],
    'the breadcrumb must spell out the path in the `~` form the prompt and the title already use');
  assert.ok(!atDefault.overflow && !atDefault.more,
    'and it must not have to put anything out of reach to do it — the labels give way first');
  assert.match(atDefault.title, /notes\/deep/, 'the title bar names the folder too');

  /* When the bar really is too narrow the fold keeps the two segments that orient you —
     the anchor and the folder you are in — and says out loud that something was folded.
     It is swept over widths rather than checked at one, because the promise is a shape:
     give up as little as possible, and never give up the ends. The steps are finer than
     the segments being folded, because the band of window widths where *one* segment is
     the right answer is exactly as wide as that segment — a sweep in 80px steps can walk
     straight over it. The sweep also runs past the 360px Files asks for, since that is
     where the breadcrumb is finally asked to give way. */
  const sweep = [];
  for (const width of [840, 800, 760, 720, 700, 640, 560, 540, 520, 500, 480, 440, 400, 360, 340, 320]) {
    await setWidths(width);
    const at = await read();
    sweep.push(at);

    assert.deepEqual(at.order, [...at.order].sort((a, b) => b - a),
      `at ${width}px the bar gave up ${JSON.stringify(at.order)} — a later group was hidden while an earlier one was kept`);

    assert.deepEqual([at.trail[0], at.trail.at(-1)], ['~', 'deep'],
      `at ${width}px the trail must still name the anchor and the folder you are in, got ${JSON.stringify(at.trail)}`);

    const hidden = at.mids - at.shownMids;
    if (at.level > 0) {
      assert.equal(at.restoresLast, false,
        `at ${width}px the fold gave up more than it had to: putting back the last thing it gave up still fits`);
    }
    if (hidden > 0) {
      assert.ok(at.elide, `at ${width}px ${hidden} segment(s) were folded away, so the fold must be said out loud`);
    } else {
      assert.ok(!at.elide, `at ${width}px nothing was folded, so no ellipsis may be claimed`);
    }
  }
  assert.ok(sweep.some((s) => s.mids > 0 && s.shownMids > 0 && s.shownMids < s.mids),
    'somewhere between the default width and the smallest, the fold must be partial — hiding one segment at a time, not the whole trail at once');

  /* Clicking a crumb goes there — the trail is navigation, not decoration. */
  await setWidths(840);
  await page.click('.window[data-app="files"] .crumbs button:has-text("Documents")');
  await page.waitForTimeout(400);
  assert.match(await page.evaluate(() => document.querySelector('.window[data-app="files"] .wtitle').textContent), /Files — ~\/Documents$/);

  await page.evaluate(() => { window.browserOS.fs.rm('/home/user/Documents/notes', '/', true); });
  await closeAll();
});

/* The empty state is a message about the whole folder. As a plain child of the file grid
   it was laid out in one 104px column and wrapped into a narrow strip of text. */

test('an empty folder says so across the window, not down one grid column', async () => {
  await closeAll();
  await page.evaluate(() => window.browserOS.fs.mkdir('/home/user/Documents/empty-demo'));
  await openApp('files', { path: '/home/user/Documents/empty-demo' });

  const read = () => page.evaluate(() => {
    const grid = document.querySelector('.window[data-app="files"] .filegrid');
    const msg = grid.querySelector('.empty-state');
    if (!msg) return null;
    const range = document.createRange();
    range.selectNodeContents(msg);
    return {
      grid: Math.round(grid.getBoundingClientRect().width),
      msg: Math.round(msg.getBoundingClientRect().width),
      lines: range.getClientRects().length,
      text: msg.textContent.trim(),
    };
  });

  for (const width of [760, 480]) {
    await setWidths(width);
    const at = await read();
    assert.ok(at, 'an empty folder must show an empty state, not a blank panel');
    assert.match(at.text, /folder is empty/);
    assert.ok(at.msg >= at.grid * 0.8,
      `at ${width}px the message must span the folder, got ${at.msg}px of ${at.grid}px`);
    assert.ok(at.lines <= 2, `at ${width}px the sentence must read as a sentence, not ${at.lines} wrapped lines`);
  }

  await page.evaluate(() => { window.browserOS.fs.rm('/home/user/Documents/empty-demo', '/', true); });
  await closeAll();
});

/* A menu belongs to the thing that was clicked. When that thing is a window, closing the
   window has to close the menu too, or it stays on the desktop looking like a menu *of*
   the desktop. */

test('Paint gives up its palette one swatch at a time, from the end', async () => {
  await closeAll();
  await openApp('paint');
  const read = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="paint"] .toolbar');
    const sw = [...bar.querySelectorAll('.paint-palette .swatch[data-color]')];
    const shown = (n) => n.getBoundingClientRect().width > 0;
    /* Minimality against the thing the bar gave up *last* — which, once the whole palette
       is gone, is whatever group comes next in Paint's declared order, not a swatch. */
    const last = window.testHelpers.lastCut(bar);
    let restoresLastCut = null;
    if (last) {
      last.classList.remove('is-collapsed');
      restoresLastCut = bar.scrollWidth <= bar.clientWidth + 1;
      last.classList.add('is-collapsed');
    }
    return {
      total: sw.length,
      shown: sw.filter(shown).length,
      /* A row that keeps its first items shows them as one unbroken run. */
      pattern: sw.map((s) => (shown(s) ? 1 : 0)).join(''),
      level: Number(bar.dataset.collapsed || 0),
      restoresLastCut,
      tools: [...bar.querySelectorAll('.paint-tools button')].filter(shown).length,
      save: shown([...bar.querySelectorAll('button')].find((b) => b.textContent.includes('Save PNG'))),
      order: window.testHelpers.givenUpOrder(bar),
      overflow: bar.scrollWidth > bar.clientWidth + 1,
    };
  });

  const seen = [];
  for (const width of [880, 800, 720, 660, 620, 560, 500, 440, 420]) {
    await setWidths(width);
    const at = await read();
    seen.push(at);
    assert.ok(!at.overflow, `at ${width}px the Paint bar must compact rather than scroll`);
    assert.deepEqual(at.order, [...at.order].sort((a, b) => b - a),
      `at ${width}px Paint gave up ${JSON.stringify(at.order)} — a later group was hidden while swatches it could have kept were already on offer`);
    assert.ok(at.tools >= 3 && at.save, `at ${width}px the tools and Save must survive while swatches are being given up`);
    if (at.shown < at.total) {
      assert.match(at.pattern, /^1*0+$/, `at ${width}px the swatches given up must be the end of the row, got ${at.pattern}`);
    }
    if (at.level > 0) {
      assert.equal(at.restoresLastCut, false,
        `at ${width}px the bar gave up more than it had to: putting back the last thing it gave up still fits`);
    }
  }
  assert.ok(seen.some((s) => s.shown > 0 && s.shown < s.total),
    'between the width Paint asks for and its declared minimum there must be a width where only part of the palette is given up');
  assert.ok(seen[0].shown === seen[0].total, 'at its own default width Paint keeps its whole palette');

  await closeAll();
});

test('the ⋯ menu says which side of the bar an action is off', async () => {
  await closeAll();
  await openApp('files');
  await setWidths(340);
  const bar = '.window[data-app="files"] .toolbar';

  /* Scrolled to the far end, what is out of reach is behind you. A menu that lists those
     actions without saying so sends you scrolling the wrong way to check. */
  await page.evaluate((sel) => { const t = document.querySelector(sel); t.scrollLeft = t.scrollWidth; }, bar);
  await page.waitForTimeout(200);
  await page.click(`${bar} .toolbar-more`);
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const atEnd = await page.evaluate(() => [...document.querySelectorAll('#context-menu .cmenu-item')].map((b) => ({
    label: b.textContent.replace(/\s+/g, ' ').trim(),
    hint: b.querySelector('.cmenu-hint')?.textContent?.trim() || '',
  })));
  assert.ok(atEnd.length, 'a scrolled bar must still offer its off-screen actions');
  assert.ok(atEnd.every((i) => i.hint), 'every entry must say that it is off the bar');
  assert.ok(atEnd.some((i) => /left/.test(i.hint)), 'and name the side it is off');
  assert.ok(!atEnd.some((i) => /right/.test(i.hint)), 'scrolled to the end, nothing is off the right');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.evaluate((sel) => { document.querySelector(sel).scrollLeft = 0; }, bar);
  await page.waitForTimeout(200);
  await page.click(`${bar} .toolbar-more`);
  await page.waitForTimeout(250);
  const atStart = await page.evaluate(() => [...document.querySelectorAll('#context-menu .cmenu-hint')].map((h) => h.textContent.trim()));
  assert.ok(atStart.length && atStart.every((h) => /right/.test(h)), 'scrolled to the start, the menu names the right-hand side');
  await page.keyboard.press('Escape');

  await closeAll();
});

/* The one assumption the toolbar fit makes about a bar is "hiding more never makes it
   wider". A control that *grows* when the control beside it is hidden breaks that, and a
   search that trusts it can give up more than the bar needed — or give up everything and
   still overflow. This is that shape, built out of the real watcher and a real layout, with
   nothing but the assumption changed. */
/* A bar that cannot fit "New folder" and "New file" does not need two wordless glyphs — it
   needs one button that still says what it does. This is the difference between compacting a
   toolbar and shrinking one. */

test('Files gives its create pair one menu button when the bar cannot fit both', async () => {
  await closeAll();
  await openApp('files');

  const read = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const box = bar.getBoundingClientRect();
    const at = (label) => {
      const b = [...bar.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === label);
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const word = b.querySelector('.btn-label');
      return {
        w: Math.round(r.width),
        inBar: r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1,
        named: !!word && word.getBoundingClientRect().width > 0,
      };
    };
    return {
      level: Number(bar.dataset.collapsed || 0),
      folder: at('New folder'),
      file: at('New file'),
      menu: at('New folder or file'),
    };
  });

  await setWidths(840);
  const wide = await read();
  assert.ok(wide.folder?.w > 0 && wide.file?.w > 0, 'at its default width Files shows both create buttons, by name');
  assert.equal(wide.menu?.w ?? 0, 0, 'and no create menu button, because nothing is missing');

  /* The middle of the gradient, found rather than remembered. The widest window that has no
     room for the pair is exactly the window that could not afford two create buttons and did
     not need to give up anything else — so it is the width at which the replacement's word
     matters most. A bar is stripped to a bare glyph only after it has shown it cannot afford
     the word either. Compacting is a slope, not a cliff. */
  const pairGone = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const b = [...bar.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'New folder');
    return !b || b.getBoundingClientRect().width === 0;
  });
  const widestWithoutPair = await widthWhere(360, 820, pairGone);
  assert.ok(widestWithoutPair, 'somewhere between its minimum and its default width Files must give up the create pair');
  const mid = await read();
  assert.equal(mid.folder?.w ?? 0, 0, 'the pair is still the first thing given up');
  assert.ok(mid.menu?.w > 0 && mid.menu.named,
    `at ${widestWithoutPair}px — the widest window that cannot fit the pair — the replacement must still say "New"`);

  await setWidths(360, { height: 360 });
  const narrow = await read();
  assert.ok(narrow.level > 0, 'the bar must have compacted');
  assert.equal(narrow.folder?.w ?? 0, 0, 'the pair the bar cannot fit is gone');
  assert.equal(narrow.file?.w ?? 0, 0, 'the pair the bar cannot fit is gone');
  assert.ok(narrow.menu?.w > 0, 'one button that names the action takes their place');
  assert.equal(narrow.menu.inBar, true, 'and it sits inside the bar, not off its end');

  /* Opened by the button itself, not by a Playwright click: the bar is scrollable and
     Playwright would scroll its target into view first. */
  await page.evaluate(() => document.querySelector('.window[data-app="files"] .files-new-menu').click());
  await page.waitForSelector('#context-menu:not(.hidden)', { timeout: 3000 });
  const offered = await page.evaluate(() => [...document.querySelectorAll('#context-menu .cmenu-item')]
    .map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(offered.some((l) => l.includes('New folder')), `the menu must offer the folder (${offered.join(', ')})`);
  assert.ok(offered.some((l) => l.includes('New file')), `the menu must offer the file (${offered.join(', ')})`);

  const before = await page.evaluate(() => window.browserOS.fs.list('/home/user').length);
  await page.click('#context-menu .cmenu-item:has-text("New folder")');
  await page.waitForTimeout(400);
  const names = await page.evaluate(() => window.browserOS.fs.list('/home/user').map((e) => e.name));
  assert.ok(names.length > before, 'choosing New folder from the compacted bar must create it');
  await page.evaluate(() => {
    for (const e of window.browserOS.fs.list('/home/user')) {
      if (e.name.startsWith('new folder')) window.browserOS.fs.rm(`/home/user/${e.name}`, '/', true);
    }
  });
  await closeAll();
});

test('a control that grows when its neighbour is hidden cannot make a bar give up more than it needs', async () => {
  const out = await page.evaluate(async () => {
    const { watchToolbarOverflow } = await import('/src/core/utils.js');
    const style = document.createElement('style');
    style.id = 'lab-grow-style';
    style.textContent = `
      #lab-grow { position: fixed; left: -2000px; top: 0; width: 300px; display: flex; padding: 0; overflow: auto hidden; }
      #lab-grow > * { flex: 0 0 auto; height: 28px; }
      #lab-grow .lab-a, #lab-grow .lab-c, #lab-grow .lab-b { width: 40px; }
      #lab-grow .lab-fixed { width: 200px; }
      #lab-grow .is-collapsed { display: none; }
      /* The wobble: giving up .lab-c frees room that .lab-b expands into. */
      #lab-grow .lab-c.is-collapsed ~ .lab-b { width: 140px; }
    `;
    document.head.append(style);
    const bar = document.createElement('div');
    bar.id = 'lab-grow';
    bar.dataset.collapse = '.lab-a, .lab-c';
    for (const cls of ['lab-a', 'lab-c', 'lab-b', 'lab-fixed']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.setAttribute('aria-label', cls);
      bar.append(b);
    }
    document.body.append(bar);

    const stop = watchToolbarOverflow(bar);
    const rendered = (sel) => bar.querySelector(sel).getClientRects().length > 0;
    const result = {
      level: Number(bar.dataset.collapsed || 0),
      keptFirstCut: rendered('.lab-a') === false,
      keptSecondCut: rendered('.lab-c'),
      fits: bar.scrollWidth <= bar.clientWidth + 1,
      scroll: bar.scrollWidth,
      client: bar.clientWidth,
    };
    stop();
    bar.remove();
    style.remove();
    return result;
  });

  /* Hiding only the first thing fits (280px in a 300px bar). Hiding both does not (the
     growable control makes it 340px). The bar must stop at the first, not at the deepest. */
  assert.equal(out.level, 1, `the bar needed one cut and gave up ${out.level} (scroll ${out.scroll} in ${out.client}px)`);
  assert.equal(out.keptFirstCut, true, 'the cut the bar needed must stay given up');
  assert.equal(out.keptSecondCut, true, 'the cut the bar did not need must be given back');
  assert.equal(out.fits, true, 'the level it settles on must be one the bar really fits at');
});

/* A45. Two independent width thresholds for one layout is how a wider window ends up showing
   *less* than a narrower one: Files used to swap its Places labels for toolbar room on a
   breakpoint of its own, while the toolbar made the same decision on a different one, so at
   700px the bar had given up its create buttons while a 640px window had all of them. The
   sidebar is now one rung of the bar's own ladder, which makes the promise structural rather
   than something to remember: a prefix order can only ever give back more as the window
   grows. Asserted as a shape over a sweep, because the widths where each rung happens are a
   property of the folder being shown, not of the app. */

test('widening a Files window never takes a control away', async () => {
  await closeAll();
  await openApp('files');

  const state = () => page.evaluate(() => {
    const root = document.querySelector('.window[data-app="files"] .app');
    const bar = root.querySelector('.toolbar');
    const box = bar.getBoundingClientRect();
    const shown = (n) => n && n.getBoundingClientRect().width > 0;
    const inBar = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right <= box.right + 1 && r.left >= box.left - 1; };
    const btn = (label) => [...bar.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === label);
    /* 0 = gone, 1 = the glyph alone, 2 = the control with its word. */
    const rank = (label) => {
      const b = btn(label);
      if (!b || !shown(b) || !inBar(b)) return 0;
      return shown(b.querySelector('.btn-label')) ? 2 : 1;
    };
    const pair = [rank('New folder'), rank('New file')];
    const menu = rank('New folder or file');
    return {
      level: Number(bar.dataset.collapsed || 0),
      /* Compared by what the user can still do, not by which element is on the bar: the
         "New" menu *is* New folder and New file one click deeper, so the pair becoming a
         menu is not a control disappearing — it is the same affordance in less room. */
      create: pair[0] === 2 && pair[1] === 2 ? 3 : menu === 2 ? 2 : menu === 1 ? 1 : 0,
      sort: rank('Sort items'),
      upload: rank('Upload files'),
      back: rank('Back to the previous folder'),
      parent: rank('Go to the parent folder'),
      filter: shown(bar.querySelector('.files-search')) ? 1 : 0,
      trail: [...bar.querySelectorAll('.crumbs button')].filter((b) => shown(b) && inBar(b)).length,
      places: [...root.querySelectorAll('.files-side .side-label')].filter(shown).length,
    };
  });

  const AFFORDANCES = ['create', 'sort', 'upload', 'back', 'parent', 'filter', 'trail', 'places'];
  const sweep = [];
  for (const width of [320, 360, 420, 480, 540, 600, 660, 720, 780, 840]) {
    await setWidths(width, { height: 360 });
    sweep.push({ width, s: await state() });
  }

  for (let i = 1; i < sweep.length; i++) {
    const prev = sweep[i - 1]; const at = sweep[i];
    for (const key of AFFORDANCES) {
      assert.ok(at.s[key] >= prev.s[key],
        `going from ${prev.width}px to ${at.width}px took away ${key} (${prev.s[key]} → ${at.s[key]}) — a wider window must be able to do at least what a narrower one could`);
    }
    assert.ok(at.s.level <= prev.s.level,
      `going from ${prev.width}px to ${at.width}px gave up ${at.s.level} things, more than the ${prev.s.level} it gave up at the narrower width`);
    /* A prefix order means a rung is never used before the one above it. The Places words
       are the second rung, so they are only taken once the create pair has already become a
       menu — the one saving on this ladder that costs the user nothing. */
    if (at.s.places === 0) {
      assert.ok(at.s.create < 3,
        `at ${at.width}px the Places words are gone while the bar still shows both create buttons — it took the 126px before the free 90px`);
    }
  }

  /* Not a vacuous sweep: the ladder must actually be walked, and it must end where a wide
     window should end — everything shown, nothing compacted, Places labelled. */
  assert.ok(sweep.some((x) => x.s.places === 0), 'a narrow Files window must have given up the Places words');
  assert.ok(sweep.some((x) => x.s.level > 0), 'a narrow Files window must have compacted its toolbar');
  const widest = sweep.at(-1);
  assert.equal(widest.s.level, 0, `at ${widest.width}px nothing may be compacted`);
  assert.ok(widest.s.places > 0, `at ${widest.width}px the Places list must be back`);

  await closeAll();
});

/* A44. The bar's width is fixed by the app; the breadcrumb's is chosen by the filesystem. A
   folder name long enough to cost the bar room used to cost it whatever actions happened to
   sit at the far end. Now the last thing the bar may give up is the *length of the name* —
   which bounds what any folder can cost, and leaves the full name where a name should be
   readable: the button's accessible name, its tooltip and the title bar. */

test('a folder name too long for the bar costs the bar its own length, not another action', async () => {
  await closeAll();
  const names = [
    'a-fairly-long-folder-name-that-does-not-fit-in-a-narrow-bar',
    'an-absurdly-long-folder-name-that-nobody-would-choose-but-the-filesystem-lets-you-have-it',
  ];
  await page.evaluate((ns) => { for (const n of ns) window.browserOS.fs.mkdir(`/home/user/Documents/${n}`); }, names);

  const measure = async (name) => {
    await openApp('files', { path: `/home/user/Documents/${name}` });
    await setWidths(360, { height: 360 });
    const out = await page.evaluate(() => {
      const bar = document.querySelector('.window[data-app="files"] .toolbar');
      const box = bar.getBoundingClientRect();
      const last = bar.querySelector('.crumbs .crumb-last');
      const r = last.getBoundingClientRect();
      /* The ellipsis now lives on the name's head span, not on the button: the button is a
         flex row of head + protected tail, so "is this name cut?" is a question about the
         half that is allowed to be cut. */
      const head = last.querySelector('.crumb-name-head') || last;
      return {
        bar: bar.scrollWidth,
        crumb: Math.round(r.width),
        inBar: r.right <= box.right + 1 && r.left >= box.left - 1,
        /* Text wider than the box that holds it is what an ellipsis *is*, measured rather
           than assumed from the CSS. */
        ellipsised: head.scrollWidth > head.clientWidth + 1,
        label: last.getAttribute('aria-label'),
        title: last.getAttribute('title'),
        text: last.textContent,
      };
    });
    await closeApp('files');
    return out;
  };

  const [medium, longest] = [await measure(names[0]), await measure(names[1])];

  assert.ok(medium.ellipsised && longest.ellipsised,
    'at its declared minimum a name too long for the bar must be cut short out loud, not left to push controls off its end');
  assert.equal(longest.bar, medium.bar,
    `a name ${names[1].length} characters long costs the bar ${longest.bar}px, the same as one ${names[0].length} characters long — the cost of a name must be bounded`);
  assert.ok(longest.crumb <= medium.crumb + 1, 'the longer name must not take more room than the shorter one');
  assert.ok(longest.inBar, 'the folder you are in must still be in the bar, whatever it is called');
  assert.match(longest.text, /absurdly/, 'the name is still the name in the DOM');
  assert.ok(longest.label.includes(names[1]), 'the full name belongs in the button’s accessible name');
  assert.ok(longest.title.includes(names[1]), 'and in its tooltip');

  await page.evaluate((ns) => { for (const n of ns) window.browserOS.fs.rm(`/home/user/Documents/${n}`, '/', true); }, names);
  await closeAll();
});

/* A46. The breadcrumb carries a long name in full — in its accessible name and its tooltip.
   The title bar used to ellipsise the same name with nothing to fall back to, so the one
   place that is *supposed* to say where you are was the one place that could not be read.
   A name that does not fit may be summarised; it may not be lost. */

test('a bar that ran out of things to give up says so, and says which rungs bought nothing', async () => {
  const lab = await page.evaluate(async () => {
    const { watchToolbarOverflow } = await import('/src/core/utils.js');
    const style = document.createElement('style');
    style.id = 'lab-exhaust-style';
    style.textContent = `
      #lab-exhaust { position: fixed; left: -2000px; top: 0; width: 200px; display: flex; padding: 0; overflow: auto hidden; }
      #lab-exhaust > * { flex: 0 0 auto; height: 28px; }
      /* 210px of bar that is not in the ladder at all: no prefix of it can make this fit. */
      #lab-exhaust .lab-fixed { width: 210px; }
      #lab-exhaust .lab-a, #lab-exhaust .lab-b { width: 40px; }
      #lab-exhaust .lab-a.is-collapsed, #lab-exhaust .lab-b.is-collapsed { display: none; }
      /* The no-op rung, modelled on Files’ last breadcrumb: a cap on a name that never
         reaches it. 12ch is wider than this 60px box, so “give it up” changes nothing. */
      #lab-exhaust .lab-name { width: 60px; max-width: 200px; }
      #lab-exhaust .lab-name.is-collapsed { max-width: 12ch; }
    `;
    document.head.append(style);
    const bar = document.createElement('div');
    bar.id = 'lab-exhaust';
    bar.dataset.collapse = '.lab-a, .lab-b, .lab-name';
    for (const [tag, cls] of [['div', 'lab-fixed'], ['button', 'lab-a'], ['button', 'lab-b'], ['span', 'lab-name']]) {
      const n = document.createElement(tag);
      n.className = cls;
      if (tag === 'button') n.setAttribute('aria-label', cls);
      if (cls === 'lab-name') n.textContent = 'ok';
      bar.append(n);
    }
    document.body.append(bar);
    const stop = watchToolbarOverflow(bar);
    const nameWidth = () => Math.round(bar.querySelector('.lab-name').getBoundingClientRect().width);

    const givenUp = {
      k: bar.dataset.collapsed,
      exhausted: bar.dataset.collapsedExhausted,
      effective: bar.dataset.collapsedEffective,
      nameWidthCut: nameWidth(),
    };

    /* The same bar with room: the exhausted claims must not survive a width that fits. */
    bar.style.width = '400px';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    const comfortable = {
      k: bar.dataset.collapsed,
      exhausted: bar.dataset.collapsedExhausted ?? null,
      effective: bar.dataset.collapsedEffective ?? null,
      nameWidthOpen: nameWidth(),
    };

    stop();
    bar.remove();
    style.remove();
    return { givenUp, comfortable };
  });

  assert.equal(lab.givenUp.k, '3', 'the bar applies every rung it is allowed to');
  assert.equal(lab.givenUp.exhausted, 'true', 'and says that doing so was not enough');
  assert.equal(lab.givenUp.effective, '2', 'two of those three rungs changed the measured bar; the name cap changed nothing');
  assert.equal(lab.comfortable.nameWidthOpen, lab.givenUp.nameWidthCut,
    'the rung that bought nothing is a cap the content never reaches — its box is the same size either way');
  assert.equal(lab.comfortable.k, '', 'a bar that fits gives up nothing');
  assert.equal(lab.comfortable.exhausted, null, 'and stops claiming it ran out');
  assert.equal(lab.comfortable.effective, null);

  /* The same claim on a real bar, where it is a *shape* rather than a fixture: the rung
     whose whole job is shortening the folder you are in buys nothing for a short name and
     buys something for a long one. */
  const shortName = '/home/user/Documents';
  const longName = '/home/user/Documents/a-folder-name-long-enough-to-cost-the-bar-its-whole-name-cap';
  /* Files falls back to home when a path does not exist, so the folder has to be real
     before the bar can be measured showing it. */
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), longName);
  const waste = async (path) => {
    await openApp('files', { path });
    await setWidths(360, { height: 360 });
    const out = await page.evaluate(() => {
      const bar = document.querySelector('.window[data-app="files"] .toolbar');
      return {
        k: Number(bar.dataset.collapsed || 0),
        exhausted: bar.dataset.collapsedExhausted === 'true',
        effective: Number(bar.dataset.collapsedEffective),
        over: bar.scrollWidth - bar.clientWidth,
        more: !!bar.querySelector('.toolbar-more') && !bar.querySelector('.toolbar-more').hidden,
      };
    });
    await closeApp('files');
    return out;
  };

  const [short, long] = [await waste(shortName), await waste(longName)];
  for (const [label, r] of [['short name', short], ['long name', long]]) {
    assert.ok(r.exhausted, `${label}: at its declared minimum this bar gives up everything it may and still needs ${r.over}px more — it must say so`);
    assert.ok(r.more, `${label}: a bar that ran out must hand the rest to the ⋯`);
    assert.ok(r.effective <= r.k, `${label}: effective (${r.effective}) cannot exceed the rungs applied (${r.k})`);
  }
  assert.ok(short.effective < short.k,
    `with a folder called "Documents" the name-shortening rung bought nothing, so ${short.effective} of ${short.k} rungs must be reported as real`);
  assert.equal(long.effective, long.k,
    `with a 60-character folder name every rung bought something (${long.effective} of ${long.k}) — the difference between the two is the point of reporting both`);

  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), longName);
  await closeAll();
});

/* `data-collapse-scope` is an opt-in. A bar whose declared scope is not there must behave
   exactly as a bar that never declared one — the fallback is a silent one otherwise. */

test('a deep breadcrumb is a long ladder, and an exhausted bar walks it once, not once per resize', async () => {
  /* Twelve folders deep: the longest ladder this project builds today (20 rungs), and the
     only case where a bar gives up every rung it is allowed to and still needs ~117px more.
     That is also the case where reporting `data-collapsed-effective` costs a walk down the
     whole ladder — so it is worth knowing whether that walk is paid once or once per resize
     event. Measured here rather than argued: eight resizes, one walk. */
  await closeAll();
  const deep = '/home/user/Documents/deep/a/b/c/d/e/f/g/h/i/j/k/l';
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), deep);
  await openApp('files', { path: deep });
  await setWidths(360, { height: 340 });

  const state = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const scope = bar.dataset.collapseScope ? (bar.closest(bar.dataset.collapseScope) || bar) : bar;
    const ladder = (bar.dataset.collapse || '').split(',').map((s) => s.trim()).filter(Boolean)
      .flatMap((sel) => [...scope.querySelectorAll(sel)])
      .reduce((n, g) => n + ((g.dataset.collapseUnits ? g.querySelectorAll(g.dataset.collapseUnits).length : 0) || 1), 0);
    return {
      ladder,
      cuts: Number(bar.dataset.collapsed || 0),
      exhausted: bar.dataset.collapsedExhausted === 'true',
      effective: bar.dataset.collapsedEffective,
      walkMs: Number(bar.dataset.collapsedEffectiveWalkMs ?? -1),
      walks: Number(bar.dataset.collapsedEffectiveWalks || 0),
      passes: Number(bar.dataset.fitPasses || 0),
      over: bar.scrollWidth - bar.clientWidth,
    };
  });

  const first = await state();
  assert.ok(first.ladder >= 18, `a 12-folder-deep path should give the bar a long ladder, got ${first.ladder}`);
  assert.ok(first.ladder <= 48, `the walk limit must cover the longest ladder this app can build (${first.ladder} rungs), or the deep case reports unmeasured`);
  assert.equal(first.exhausted, true, 'a bar that gave up everything it may is out of rungs');
  assert.equal(first.cuts, first.ladder, 'and it applied every one of them');
  assert.ok(first.over > 0, `and it still needs ${first.over}px more`);
  const effective = Number(first.effective);
  assert.ok(Number.isInteger(effective) && effective >= 1 && effective <= first.cuts,
    `data-collapsed-effective must be a count of rungs that changed the bar, got ${first.effective}`);
  assert.ok(effective < first.cuts,
    `one of these ${first.cuts} rungs is the cap on the current folder's name, and a one-character folder name never reaches it`);
  /* The cost of the walk is claimed in the docs as ~1ms for the longest ladder this project
     builds. It is a claim about milliseconds, so it is measured here: a walk that quietly grew
     to 50ms would otherwise only show up as "the browser tests got slow". */
  assert.ok(first.walkMs >= 0 && first.walkMs < 25,
    `walking a ${first.cuts}-rung ladder cost ${first.walkMs}ms — the number is only worth reporting if it is cheap to report`);

  /* The bound. Every one of these widths leaves the bar out of rungs, so the layout decision
     is re-measured each time — that is what `data-fit-passes` is for, and it must grow.
     What must not grow is the *walk*: it measures how the bar's content changes as rungs go
     back, and nothing about the content changed. */
  for (const width of [356, 364, 360, 368, 358, 366, 362, 370]) await setWidths(width);
  const after = await state();
  assert.ok(after.passes > first.passes, 'the bar really did re-fit for each of the eight resizes');
  assert.equal(after.walks, first.walks,
    `re-walking a ${first.ladder}-rung ladder on every resize event is the cost the cache exists to avoid (${first.walks} → ${after.walks})`);
  assert.equal(after.effective, first.effective, 'the number it stopped re-measuring must not change');
  assert.equal(after.walkMs, first.walkMs, 'and the cost it stopped paying must not come back');
  assert.equal(after.cuts, after.ladder, 'and the layout it re-measured must still be the same answer');

  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), deep);
  await closeAll();
});

test('a ladder longer than the walk is reported as unmeasured, not as zero', async () => {
  /* Forty-five folders deep is past the point where walking the ladder rung by rung is a
     cheap thing to do. The old code reported 0 for that — "nothing bought anything" — which
     is the exact lie `data-collapsed-effective` was added to avoid. */
  await closeAll();
  const deeper = `/home/user/Documents/deeper/${Array.from({ length: 45 }, (_, i) => `d${i}`).join('/')}`;
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), deeper);
  await openApp('files', { path: deeper });
  await setWidths(360, { height: 340 });
  const out = await page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    return {
      cuts: Number(bar.dataset.collapsed || 0),
      exhausted: bar.dataset.collapsedExhausted === 'true',
      effective: bar.dataset.collapsedEffective,
      limit: bar.dataset.collapsedEffectiveLimit ?? null,
      walks: Number(bar.dataset.collapsedEffectiveWalks || 0),
    };
  });
  assert.ok(out.exhausted && out.cuts > 48, `expected a ladder longer than the walk limit, got ${out.cuts}`);
  assert.equal(out.effective, 'unmeasured', 'a number nobody measured is not a zero');
  assert.equal(out.limit, '48', 'and the bar says how long a ladder it would have needed to look');
  assert.equal(out.walks, 0, 'and it did not look');

  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), deeper);
  await closeAll();
});

test('a collapse scope that does not exist changes nothing', async () => {
  const out = await page.evaluate(async () => {
    const { watchToolbarOverflow } = await import('/src/core/utils.js');
    const style = document.createElement('style');
    style.id = 'lab-scope-style';
    style.textContent = `
      #lab-scope { position: fixed; left: -2000px; top: 0; width: 90px; display: flex; padding: 0; overflow: auto hidden; }
      #lab-scope > * { flex: 0 0 auto; height: 28px; width: 50px; }
      #lab-scope .is-collapsed { display: none; }
    `;
    document.head.append(style);
    const build = (scope) => {
      const bar = document.createElement('div');
      bar.id = 'lab-scope';
      bar.dataset.collapse = '.lab-x, .lab-y';
      if (scope) bar.dataset.collapseScope = scope;
      for (const cls of ['lab-x', 'lab-y']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.setAttribute('aria-label', cls);
        bar.append(b);
      }
      document.body.append(bar);
      const stop = watchToolbarOverflow(bar);
      const result = {
        k: Number(bar.dataset.collapsed || 0),
        cutFirst: bar.querySelector('.lab-x').getClientRects().length === 0,
        fits: bar.scrollWidth <= bar.clientWidth + 1,
      };
      stop();
      bar.remove();
      return result;
    };
    const withScope = build('.no-such-ancestor-anywhere');
    const withoutScope = build(null);
    style.remove();
    return { withScope, withoutScope };
  });

  assert.ok(out.withScope.k > 0, 'a bar whose scope ancestor is missing must still compact its own declared groups');
  assert.ok(out.withScope.cutFirst, 'and must really hide them, not just count the cut');
  assert.deepEqual(out.withScope, out.withoutScope, 'a scope that resolves to nothing must be the same as declaring no scope at all');
});

/* Collapsing a group that lives *outside* the bar changes the bar’s own width, which asks
   the watcher to measure it again. That is a loop that is supposed to converge; until now
   nothing in the DOM distinguished a converging loop from a running one. */

test('a bar whose collapse changes its own width settles instead of chasing itself', async () => {
  await closeAll();
  await openApp('files');
  await setWidths(840, { height: 360 });

  const state = () => page.evaluate(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    return {
      passes: Number(bar.dataset.fitPasses || 0),
      k: bar.dataset.collapsed || '',
      scroll: bar.scrollWidth,
      client: bar.clientWidth,
    };
  });

  const wide = await state();
  /* 840 → 360 is the resize that folds the Places sidebar, which widens the bar, which is
     a new bar to measure. Every pass after the first is the loop being asked again. */
  await setWidths(360, { height: 360 });
  const narrow = await state();
  await page.waitForTimeout(700);
  const later = await state();

  assert.ok(narrow.client > 186,
    `the sidebar fold must have given the bar room (client went ${wide.client} → ${narrow.client}) — without that this test measures nothing`);
  assert.deepEqual({ k: later.k, scroll: later.scroll, client: later.client }, { k: narrow.k, scroll: narrow.scroll, client: narrow.client },
    'the bar was still changing after nothing was asking it to');
  assert.equal(later.passes, narrow.passes, 'the watcher kept re-measuring a bar that had already settled');
  assert.ok(later.passes - wide.passes <= 8,
    `one resize cost ${later.passes - wide.passes} measurement passes; a loop that converges stops in a handful`);

  await closeAll();
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
