import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

test('files app lists a folder and creates one', async () => {
  await openApp('files', { path: '/home/user' });
  await win('files').waitFor({ state: 'visible' });
  /* Compared against what the filesystem says the folder holds, not against a list typed here: a
     hard-coded seed is a fact about the demo files, and it breaks (silently for the wrong reason)
     the moment the seed gains a file — which is exactly what `~/.shellrc` did. */
  const [cells, fsNames] = await Promise.all([
    page.locator('.window[data-app="files"] .filecell .name').allTextContents(),
    page.evaluate(() => window.browserOS.fs.list('/home/user').map((e) => e.name)),
  ]);
  assert.ok(fsNames.length >= 4, `the seeded home should have folders to list, got ${JSON.stringify(fsNames)}`);
  assert.deepEqual(cells, fsNames, 'Files must show the folder it was given, in the order the filesystem lists it');
  await page.click('.window[data-app="files"] >> [aria-label="New folder"]');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/new folder')), true);
  await closeApp('files');
});

/* Files takes a path from whoever launched it — the Start menu, the terminal, a restored session,
   the console — and a caller is allowed to say `~/Documents`. Everything in the app then assumes
   `cwd` is absolute: the breadcrumb's "am I under home?" test, and therefore the trail itself.
   Unnormalised, `~/Documents` rendered as `root / ~ / Documents` — a segment that does not exist,
   and one extra foldable segment, which is one extra rung on the bar's ladder. */

test('Files reads the path it was given instead of the string it was given', async () => {
  const read = async (path) => {
    await openApp('files', { path });
    await win('files').waitFor({ state: 'visible' });
    const out = await page.evaluate(() => {
      const w = document.querySelector('.window[data-app="files"]');
      const bar = w.querySelector('.toolbar');
      const crumbs = w.querySelector('.crumbs');
      /* The ladder the core actually builds, resolved the way the core resolves it. */
      const scope = bar.closest(bar.dataset.collapseScope || ':scope') || bar;
      const rungs = (bar.dataset.collapse || '').split(',').map((s) => s.trim()).filter(Boolean)
        .flatMap((sel) => [...scope.querySelectorAll(sel)])
        .flatMap((g) => {
          const sel = g.dataset.collapseUnits;
          if (!sel) return [g];
          let units = [...g.querySelectorAll(sel)];
          if (g.dataset.collapseUnitsFrom === 'end') units.reverse();
          return units.length ? units : [g];
        });
      return {
        trail: [...crumbs.querySelectorAll('button')].map((b) => b.textContent),
        title: w.querySelector('.wtitle').textContent,
        stored: [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files').data.path,
        rungs: rungs.length,
      };
    });
    await closeApp('files');
    return out;
  };

  const absolute = await read('/home/user/Documents');
  const tilde = await read('~/Documents');
  const relative = await read('Documents');

  assert.deepEqual(absolute.trail, ['~', 'Documents'], 'the trail starts at home and ends where you are');
  for (const [how, got] of [['a ~ path', tilde], ['a path relative to home', relative]]) {
    assert.deepEqual(got.trail, absolute.trail, `${how} produced a different trail from the same folder: ${got.trail.join(' / ')}`);
    assert.equal(got.title, absolute.title, `${how} produced a different window title`);
    assert.equal(got.stored, '/home/user/Documents', `${how} was stored back unnormalised, which is how a bad path survives a session restore`);
    assert.equal(got.rungs, absolute.rungs, `${how} gave the toolbar a different number of things it is allowed to give up`);
  }
  for (const got of [absolute, tilde, relative]) {
    assert.ok(!got.trail.includes('root'), 'a folder inside home is never under root in the trail');
  }

  /* A path that is genuinely outside home still says so, honestly. */
  await page.evaluate(() => window.browserOS.fs.mkdir('/tmp/outside-home', '/'));
  const outside = await read('/tmp/outside-home');
  assert.deepEqual(outside.trail, ['root', 'tmp', 'outside-home'], 'a folder outside home is shown as outside home');
  assert.equal(outside.stored, '/tmp/outside-home');
  await page.evaluate(() => window.browserOS.fs.rm('/tmp', '/', true));

  await closeAll();
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
  await page.keyboard.press('Delete');
  await dialogShown(/Delete kb-target\.txt/);
  await dialogAccept();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/kb-target.txt')), false, 'Delete should remove the selected file');

  // Cancelling the in-OS dialog keeps the file.
  await page.evaluate(() => window.browserOS.fs.write('~/keep-me.txt', 'x'));
  await page.waitForTimeout(300);
  await page.locator('.filecell[data-name="keep-me.txt"]').focus();
  await page.keyboard.press('Delete');
  await dialogShown();
  await dialogCancel();
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/keep-me.txt')), true, 'cancelling must not delete');
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/keep-me.txt', '/', false));

  // F2 renames through the in-OS prompt.
  await page.evaluate(() => window.browserOS.fs.write('~/rename-me.txt', 'x'));
  await page.waitForTimeout(300);
  await page.locator('.filecell[data-name="rename-me.txt"]').focus();
  await page.keyboard.press('F2');
  await page.waitForSelector('#dialogs .dlg-input', { state: 'visible' });
  assert.equal(await page.inputValue('#dialogs .dlg-input'), 'rename-me.txt', 'the prompt should be prefilled');
  await page.fill('#dialogs .dlg-input', 'renamed.txt');
  await dialogAccept();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/renamed.txt')), true);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/rename-me.txt')), false);
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/renamed.txt', '/', false));
  await closeApp('files');
});

test('Files counts read as English, not as "1 files"', async () => {
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.mkdir('/home/user/Counts', '/');
    fs.write('/home/user/Counts/one.txt', 'x');
    fs.mkdir('/home/user/Counts/OneItem', '/');
    fs.write('/home/user/Counts/OneItem/inside.txt', 'y');
  });
  await openApp('files', { path: '/home/user/Counts' });

  const status = await page.locator('.window[data-app="files"] .statusbar span').first().textContent();
  assert.equal(status.trim(), '1 folder, 1 file', `status bar read ${JSON.stringify(status)}`);

  const tip = await page.locator('.filecell[data-name="OneItem"]').getAttribute('title');
  assert.match(tip, /folder · 1 item/, `folder tooltip read ${JSON.stringify(tip)}`);

  await closeApp('files');
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/Counts', '/', true));
});

test('files app filters and sorts a folder', async () => {
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.mkdir('/home/user/sort-test', '/');
    fs.write('/home/user/sort-test/a-small.txt', 'x');
    fs.write('/home/user/sort-test/b-big.txt', 'x'.repeat(500));
    fs.mkdir('/home/user/sort-test/z-folder', '/');
  });
  await openApp('files', { path: '/home/user/sort-test' });

  const names = () => page.locator('.filecell .name').allTextContents();
  assert.deepEqual(await names(), ['z-folder', 'a-small.txt', 'b-big.txt'], 'default order is folders first, then names');

  // The sort control cycles; size sort keeps folders first but orders files by size.
  await page.click('.files-sort');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('.files-sort'), /Sort: Size/, 'the button must show the active sort');
  assert.deepEqual(await names(), ['z-folder', 'b-big.txt', 'a-small.txt'], 'size sort puts the bigger file first');

  // `/` jumps from the grid to the filter box.
  await page.locator('.filecell').first().focus();
  await page.keyboard.press('/');
  assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('files-search')), '/ should focus the filter');

  await page.fill('.files-search', 'small');
  await page.waitForTimeout(200);
  assert.deepEqual(await names(), ['a-small.txt'], 'filter narrows the grid');
  assert.match(await page.textContent('.window[data-app="files"] .statusbar'), /of 3/, 'status should say the listing is filtered');

  // No match → an honest empty state, not a blank grid.
  await page.fill('.files-search', 'zzz-nothing');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('.filegrid .empty-state'), /Nothing here matches/);

  // Escape in the filter box clears it.
  await page.focus('.files-search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal((await names()).length, 3, 'Escape clears the filter');

  await page.evaluate(() => window.browserOS.fs.rm('/home/user/sort-test', '/', true));
  await closeApp('files');
});

test('a folder that is not there is named in the window, not only in a toast', async () => {
  /* Files has always fallen back to home when the path it was given is gone — the terminal,
     a restored session or a mistyped `open` can all ask for a folder that isn't there. What
     it used to say was a toast and nothing else: the window showed home, which looks exactly
     like an empty home. Now the window names the folder it could not open and offers to put
     it back. */
  await closeAll();
  const gone = '/home/user/Documents/used-to-be-here';
  await openApp('files', { path: gone });
  const shown = () => page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    return {
      title: w.querySelector('.wtitle')?.textContent.trim(),
      note: w.querySelector('.missing-state')?.textContent.trim() ?? null,
      fix: w.querySelector('.missing-fix')?.textContent.trim() ?? null,
      gone: w.querySelector('.crumb-gone')?.textContent.trim() ?? null,
      goneTitle: w.querySelector('.crumb-gone')?.getAttribute('title') ?? null,
      goneIsButton: !!w.querySelector('.crumb-gone button'),
      activePlace: [...w.querySelectorAll('.side-item.active')].map((b) => b.getAttribute('aria-label')),
      cells: w.querySelectorAll('.filecell').length,
    };
  });

  const first = await shown();
  assert.match(first.title, /Files — ~$/, 'the title says where you actually are');
  assert.ok(first.note?.includes('~/Documents/used-to-be-here'),
    `the window must name the folder it could not open, got ${JSON.stringify(first.note)}`);
  assert.ok(first.fix, 'and offer the way back to it');
  assert.ok(first.cells >= 1, 'while still showing a folder you can use');

  /* The trail ends in the folder it could not walk into. A window that quietly shows home
     without saying where it was trying to go is the failure this covers. */
  assert.ok(first.gone?.includes('used-to-be-here'),
    `the breadcrumb must end in the missing folder as a dead end, got ${JSON.stringify(first.gone)}`);
  assert.match(first.goneTitle, /used-to-be-here/, 'and say why it is not clickable');
  assert.equal(first.goneIsButton, false, 'a crumb that leads nowhere must not pretend to be clickable');
  assert.deepEqual(first.activePlace, ['Home'], 'the sidebar marks the folder actually being shown');

  /* The notice describes what this window was asked to show, so a render caused by something
     else — a file appearing in home — must not make the problem disappear. */
  await page.evaluate(() => window.browserOS.fs.write('/home/user/keep.txt', 'kept\n'));
  await page.waitForTimeout(300);
  assert.ok((await shown()).note, 'an unrelated filesystem change must not erase it');

  await page.click('.window[data-app="files"] .missing-fix');
  await page.waitForTimeout(300);
  const fixed = await shown();
  assert.match(fixed.title, /used-to-be-here$/, 'creating it takes you there');
  assert.equal(fixed.note, null, 'and the window stops reporting a problem it no longer has');
  assert.equal(fixed.gone, null, 'and the breadcrumb stops ending in a folder that now exists');
  assert.equal(await page.evaluate((p) => window.browserOS.fs.exists(p, '/'), gone), true);

  await page.evaluate((p) => { window.browserOS.fs.rm(p, '/', true); window.browserOS.fs.rm('/home/user/keep.txt', '/'); }, gone);
  await closeAll();
});

test('a restored window still knows the folder it could not open', async () => {
  /* Files falls back to home when the folder it was asked for is gone. Until now that fact
     lived only in the live window: `win.data.path` was rewritten to home, so closing the tab
     and coming back gave you a Files window that had apparently always meant to show home —
     while the folder you actually wanted was still missing. The request is part of the window,
     so it survives the reload and the window says the same thing both times. */
  await closeAll();
  const gone = '/home/user/Documents/gone-after-reload';
  await openApp('files', { path: gone });
  await page.waitForTimeout(400);
  const stored = await page.evaluate(() => window.browserOS.wm.serialize()
    .find((w) => w.appId === 'files')?.data);
  assert.equal(stored?.requested, gone, 'the window must persist what it was asked to show');
  assert.equal(stored?.path, '/home/user', 'while still recording where it ended up');

  await page.reload();
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    if (!w) return null;
    return {
      note: w.querySelector('.missing-state')?.textContent.trim() ?? null,
      gone: w.querySelector('.crumb-gone')?.textContent.trim() ?? null,
      fix: w.querySelector('.missing-fix')?.textContent.trim() ?? null,
    };
  });
  assert.ok(after, 'the Files window itself must come back');
  assert.ok(after.note?.includes('gone-after-reload'),
    `a restored window must still name the folder it cannot open, got ${JSON.stringify(after.note)}`);
  assert.ok(after.gone?.includes('gone-after-reload'), 'and the breadcrumb must still end in it');
  assert.ok(after.fix, 'and still offer to make it');

  /* If the folder came back while the window was closed, the request wins over the error. */
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), gone);
  /* The filesystem persists on a short debounce; reloading immediately would be a test that
     quietly asks "did the write reach localStorage in time?" instead of the one it names. */
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    return { title: w?.querySelector('.wtitle')?.textContent.trim(), note: w?.querySelector('.missing-state') ?? null };
  });
  assert.match(back.title ?? '', /gone-after-reload$/, 'a folder that reappeared must be opened, not reported missing');
  assert.equal(back.note, null);

  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), gone);
  await closeAll();
});

test('a narrow window gives up the dead-end crumb before it gives up the trail', async () => {
  /* The dead end is the widest thing in the bar when it is showing, and it is the one piece
     of "where you are" that is written out in full somewhere else (the notice). So the bar's
     ladder must spend it before it starts folding path segments — otherwise the narrowest
     window would be the one that lost the trail. */
  await closeAll();
  const gone = '/home/user/Documents/a/b/c/used-to-be-here';
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), gone);
  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), gone);
  await openApp('files', { path: gone });
  await setWidths(360, { height: 340 });

  const at = await page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    const shown = (sel) => [...w.querySelectorAll(sel)].filter((n) => n.getBoundingClientRect().width > 0).length;
    const order = w.querySelector('.toolbar').dataset.collapse.split(',').map((s) => s.trim());
    return {
      gone: shown('.crumb-gone'),
      anchor: shown('.crumbs > button:first-child'),
      anchorLabel: w.querySelector('.crumbs > button:first-child')?.textContent.trim(),
      note: !!w.querySelector('.missing-state'),
      cuts: Number(w.querySelector('.toolbar').dataset.collapsed || 0),
      goneBeforeCrumbs: order.indexOf('.crumb-gone') > -1 && order.indexOf('.crumb-gone') < order.indexOf('.crumbs'),
    };
  });
  assert.equal(at.note, true, 'the notice is still there at the narrow width');
  assert.equal(at.gone, 0, 'the dead-end crumb is given up before the bar runs out of room');
  assert.equal(at.goneBeforeCrumbs, true, 'and it is declared ahead of the trail, so it goes first');
  assert.equal(at.anchor, 1, `the trail must keep its anchor, got ${JSON.stringify(at)}`);
  assert.equal(at.anchorLabel, '~', 'the fallback folder you are actually looking at');
  assert.ok(at.cuts > 0, 'and the bar really was out of room');

  await closeAll();
});

test('an empty home and a missing folder say something coherent together', async () => {
  /* The one combination the two states were never looked at: the window fell back to a home
     folder that is *also* empty. Two centred panels that each explain a different problem read
     as a bug unless the second one confirms the first. */
  await closeAll();
  const gone = '/home/user/Documents/vanished';
  /* Home is only ever empty if you deleted your own Places folders, which Files lets you do.
     Delete everything in it, and put it back afterwards: the desktop and the other tests in
     this file both expect ~/Desktop and ~/Documents to exist. */
  const homeChildren = await page.evaluate(() => window.browserOS.fs.list('/home/user').map((e) => ({ path: e.path, type: e.type })));
  await page.evaluate((items) => { for (const it of items) window.browserOS.fs.rm(it.path, '/', true); }, homeChildren);
  await page.waitForTimeout(400);
  await openApp('files', { path: gone });
  await page.waitForTimeout(400);

  const both = await page.evaluate(() => {
    const w = document.querySelector('.window[data-app="files"]');
    return {
      missing: w.querySelector('.missing-state')?.textContent.trim() ?? null,
      empty: w.querySelector('.empty-state')?.textContent.trim() ?? null,
      panels: [...w.querySelectorAll('.missing-state, .empty-state')].map((n) => n.getBoundingClientRect().top),
    };
  });
  assert.ok(both.missing?.includes('vanished'), 'the missing folder is still named');
  assert.ok(both.empty, 'the empty home is still admitted');
  assert.match(both.empty ?? '', /home folder is empty too/i, `the second panel must confirm the first, not repeat it: ${JSON.stringify(both.empty)}`);
  assert.ok(both.panels.length === 2 && both.panels[0] < both.panels[1], 'the reason comes before the consequence');

  await page.evaluate((items) => { for (const it of items) window.browserOS.fs.mkdir(it.path, '/'); }, homeChildren);
  await closeAll();
});

test('a long file name keeps the part that says what kind of file it is', async () => {
  /* A CSS ellipsis eats the end of a name, and for a file the end is the extension. In a
     narrow window that turns `…-final.tar.gz` into `…-retrospective-n…`: the one piece of
     the name that was not the author's choosing is the piece that got thrown away. The grid
     now cuts the beginning and keeps the tail. */
  await closeAll();
  const dir = '/home/user/Documents/names';
  const long = '2024-06-30-team-retrospective-notes-final.tar.gz';
  await page.evaluate(([d, n]) => {
    window.browserOS.fs.mkdir(d, '/');
    window.browserOS.fs.write(`${d}/${n}`, 'x\n', '/');
    window.browserOS.fs.write(`${d}/short.md`, 'y\n', '/');
  }, [dir, long]);
  await openApp('files', { path: dir });
  await setWidths(360, { height: 420 });

  const cell = await page.evaluate((name) => {
    const c = [...document.querySelectorAll('.filecell')].find((n) => n.dataset.name === name);
    const head = c.querySelector('.name-head');
    const tail = c.querySelector('.name-tail');
    const shown = (n) => n && n.getBoundingClientRect().width > 0;
    return {
      full: c.querySelector('.name').textContent,
      title: c.getAttribute('title'),
      headText: head.textContent,
      headCut: head.scrollWidth > head.clientWidth + 1,
      tailShown: shown(tail),
      tailText: tail?.textContent ?? null,
      shortTail: !![...document.querySelectorAll('.filecell')]
        .find((n) => n.dataset.name === 'short.md')?.querySelector('.name-tail'),
    };
  }, long);

  assert.equal(cell.full, long, 'the cell still contains the whole name, split or not');
  assert.ok(cell.title.includes(long), 'and the tooltip has it in full');
  assert.ok(cell.headCut, `the beginning is the half that gets cut, got ${JSON.stringify(cell.headText)}`);
  assert.equal(cell.tailShown, true, 'the extension is still on screen');
  assert.equal(cell.tailText, '.tar.gz');
  assert.equal(cell.shortTail, false, 'a name nobody would ever truncate is not split into pieces');

  await page.evaluate((d) => window.browserOS.fs.rm(d, '/', true), dir);
  await closeAll();
});

test('a cut folder name in the breadcrumb keeps the word that says which folder it is', async () => {
  /* The same mechanism as the file cell, pointed at a folder: the bar's last rung shortens
     the current folder's name rather than hiding another action, and until now what it gave
     up was the *end* of the name — `-final`, `-snapshot`, the part that usually distinguishes
     a folder from its siblings. The head is still the half that gets cut, and the tail is
     still on screen at the width where the bar is worst. */
  await closeAll();
  const name = 'release-2024-06-30-snapshot';
  await page.evaluate((n) => window.browserOS.fs.mkdir(`/home/user/Documents/${n}`, '/'), name);
  await openApp('files', { path: `/home/user/Documents/${name}` });
  await setWidths(360, { height: 380 });

  const at = await page.evaluate((n) => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const last = bar.querySelector('.crumb-last');
    const head = last.querySelector('.crumb-name-head');
    const tail = last.querySelector('.crumb-name-tail');
    const box = (x) => Math.round(x.getBoundingClientRect().width);
    return {
      collapsed: last.classList.contains('is-collapsed'),
      full: last.textContent,
      headText: head.textContent,
      headCut: head.scrollWidth > head.clientWidth + 1,
      headWidth: box(head),
      tailText: tail?.textContent ?? null,
      tailShown: !!tail && box(tail) > 0,
      label: last.getAttribute('aria-label'),
      title: last.getAttribute('title'),
      /* The claim the 8-character tail cap exists to keep: a protected tail must not eat the
         whole box, or the crumb shows an end and no beginning. */
      boxWidth: box(last),
    };
  }, name);

  assert.equal(at.full, name, 'the whole name is still in the DOM');
  assert.ok(at.label.includes(name) && at.title.includes(name), 'and in the accessible name and the tooltip');
  assert.equal(at.collapsed, true, 'at 360px the bar really did run out of room');
  assert.equal(at.tailText, '-snapshot');
  assert.equal(at.tailShown, true, 'the marker survives the cut');
  assert.ok(at.headCut, `the beginning is the half that gets cut, got ${JSON.stringify(at.headText)}`);
  assert.ok(at.headWidth >= 8, `the head keeps some of the box (got ${at.headWidth}px of ${at.boxWidth}px)`);

  await page.evaluate((n) => window.browserOS.fs.rm(`/home/user/Documents/${n}`, '/', true), name);
  await closeAll();
});

test('the dead-end crumb is cut the same way as a name that exists', async () => {
  /* A folder that is not there is still a name, and the bar treats it the same: cut the
     beginning, keep the end. The two spans inherit the strikethrough, so the protected tail is
     struck through too rather than coming out looking like a different word. */
  await closeAll();
  const gone = '/home/user/Documents/backup-before-migration-old';
  await page.evaluate((p) => window.browserOS.fs.mkdir(p, '/'), gone);
  await page.evaluate((p) => window.browserOS.fs.rm(p, '/', true), gone);
  await openApp('files', { path: gone });
  /* Wide enough that the dead end is *showing* — the narrow-width case, where the bar gives
     the crumb up entirely, is the other test's job. */
  await setWidths(720, { height: 360 });

  const at = await page.evaluate(() => {
    const gone = document.querySelector('.crumb-gone-name');
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const box = (x) => (x ? Math.round(x.getBoundingClientRect().width) : 0);
    const deco = gone ? getComputedStyle(gone).textDecorationLine : null;
    return {
      present: !!gone,
      collapsed: !!gone && gone.closest('.crumb-gone').classList.contains('is-collapsed'),
      cuts: Number(bar.dataset.collapsed || 0),
      full: gone?.textContent ?? null,
      head: box(gone?.querySelector('.crumb-gone-name-head')),
      tailText: gone?.querySelector('.crumb-gone-name-tail')?.textContent ?? null,
      tailShown: box(gone?.querySelector('.crumb-gone-name-tail')),
      decoration: deco,
    };
  });

  assert.equal(at.present, true, `the dead end is in the trail at 720px (collapsed=${at.collapsed} cuts=${at.cuts})`);
  assert.equal(at.collapsed, false, 'and it is not one of the rungs the bar gave up at this width');
  assert.equal(at.full, 'backup-before-migration-old');
  assert.equal(at.tailText, '-old', 'the tail is protected here too');
  assert.ok(at.tailShown > 0, 'the tail is protected here too');
  assert.ok(at.head >= 8, `the head is still drawn, got ${JSON.stringify(at)}`);
  assert.equal(at.decoration, 'line-through', 'the whole name, both halves, is struck through');

  await closeAll();
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
