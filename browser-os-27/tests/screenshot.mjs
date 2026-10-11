import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { paintCssBackground } from './browser/measure.mjs';

const s = await serve(process.cwd());
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(`${s.url}/index.html`);
await page.waitForFunction(() => window.browserOS);
await page.waitForTimeout(600);

/* The width of a window, and the widths at which a bar makes a particular decision.
   Hard-coded numbers here used to be measurements of the *seed* — rename a folder and the
   number stops being the interesting state, and the shot quietly shows something else.
   Asking for the boundary instead ("the widest window where the trail is folded") is the
   same claim with no number in it, and it survives the next change to the layout. */
const setFilesWidth = async (w) => {
  await page.evaluate((px) => {
    const wn = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(wn.el.style, { width: `${px}px` });
  }, w);
  await page.waitForTimeout(260);
};
const widestWhere = async (predicate, lo = 320, hi = 840) => {
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    await setFilesWidth(mid);
    if (await page.evaluate(predicate)) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (best !== null) await setFilesWidth(best);
  return best;
};
const assertBoundary = (w, what) => {
  if (w === null) throw new Error(`no width between 320 and 840 produced: ${what}`);
  console.log(`  ${what}: widest at ${w}px`);
  return w;
};

/* Every folder and file this script creates is registered here and removed in the `finally`
   below. Creating a fixture half-way through and deleting it at the end of the block looked
   tidy, but a throw between the two left the fixture in the virtual filesystem for the *next*
   run — where it turned up in the desktop capture and in another test's directory listing. */
const created = [];
const track = (path) => created.push(path);
try {
  await page.screenshot({ path: 'shots/01-desktop.png' });

  await page.evaluate(() => { window.browserOS.wm.close([...window.browserOS.wm.windows.values()][0].id); });
  await page.evaluate(() => window.browserOS.launch('terminal'));
  await page.waitForTimeout(300);
  const run = async (c) => { await page.fill('.window[data-app="terminal"] .term-input', c); await page.press('.window[data-app="terminal"] .term-input', 'Enter'); };
  await run('mkdir demo && echo created by the shell > demo/hello.txt');
  await run('ls -l ~/demo');
  await run('cat demo/hello.txt');
  /* The three things a shell session actually shows: a name the user defined, a line edited on its
     way through a pipe, and a `note` — the level that is neither an error nor help. */
  await run("alias ll='ls -l'");
  await run('ll demo');
  await run('cat demo/hello.txt | sed \'s/the shell/an alias/\' | tr a-z A-Z');
  await run('mkdir demo');
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

  /* `help` is an index now, and an index is judged by reading it: does a grouped command list with
     wrapped descriptions still read as a table at the width a terminal actually gets opened at, and
     does the feature index read as a pointer list rather than more prose? Two clips, because the
     point of an index is that you can see both ends of it. The Files window is closed first — it
     overlapped the terminal here, and text covered by another window is not a layout finding. */
  await page.evaluate(() => {
    const files = [...window.browserOS.wm.windows.values()].find((w) => w.appId === 'files');
    if (files) window.browserOS.wm.close(files.id);
    const term = [...window.browserOS.wm.windows.values()].find((w) => w.appId === 'terminal');
    Object.assign(term.el.style, { left: '24px', top: '24px', width: '700px', height: '560px' });
  });
  await page.waitForTimeout(250);
  await run('clear');
  await run('help');
  await page.waitForTimeout(350);
  const termBox = await page.locator('.window[data-app="terminal"]').boundingBox();
  const termClip = { x: termBox.x, y: termBox.y, width: termBox.width, height: termBox.height };
  await page.evaluate(() => { const o = document.querySelector('.window[data-app="terminal"] .term-out'); o.scrollTop = 0; });
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'shots/41-terminal-help-commands.png', clip: termClip });
  await page.evaluate(() => { const o = document.querySelector('.window[data-app="terminal"] .term-out'); o.scrollTop = o.scrollHeight; });
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'shots/42-terminal-help-features.png', clip: termClip });

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

  /* Back to dark, fresh desktop: Files with the filter box in use and a context menu. */
  await page.evaluate(() => {
    window.browserOS.theme.set('theme', 'dark');
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
  });
  await page.evaluate(() => window.browserOS.launch('files', { data: { path: '/home/user' } }));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '400px', top: '110px', width: '840px', height: '540px' });
  });
  await page.waitForTimeout(400);
  await page.fill('.files-search', 'doc');
  await page.waitForTimeout(300);
  await page.locator('.filecell[data-name="Documents"]').click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/05-files-toolbar.png' });
  /* The menu is a document-level overlay: if it is left open here it turns up in every
     later capture of this script, floating over windows it has nothing to do with. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* Files at its *default* width: the width most people will see, so this is the state in
     which the breadcrumb has to keep saying where you are. */
  await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
  await page.evaluate(() => {
    window.browserOS.fs.mkdir('/home/user/Documents/notes/deep');
    window.browserOS.launch('files', { data: { path: '/home/user/Documents/notes/deep' } });
  });
  track('/home/user/Documents/notes');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '380px', top: '120px', width: '840px', height: '500px' });
  });
  await page.waitForTimeout(500);
  const dbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/21-files-default-width.png', clip: { x: dbox.x, y: dbox.y, width: dbox.width, height: 160 } });

  /* The same window too narrow for the whole trail: the middle folds away and says so. The
     width is the boundary — the widest window that has had to fold every middle segment — so
     the shot shows the fold at the exact moment it stops being optional. */
  const folded = await widestWhere(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const mids = [...bar.querySelectorAll('.crumb-mid')];
    const shown = mids.filter((m) => { const r = m.getBoundingClientRect(); return r.width > 0; });
    return mids.length > 0 && shown.length === 0;
  });
  assertBoundary(folded, 'every middle crumb folded');
  const hbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/22-files-folded-crumb.png', clip: { x: hbox.x, y: hbox.y, width: hbox.width, height: 160 } });

  /* The width in between: the bar only needed room for one segment less, so only one is
     folded. `~ / … / notes / deep` is what a fold that gives up the fewest pieces looks like.
     Found by bisection because the band is only as wide as the segment being folded. */
  const partly = await widestWhere(() => {
    const bar = document.querySelector('.window[data-app="files"] .toolbar');
    const mids = [...bar.querySelectorAll('.crumb-mid')];
    const shown = mids.filter((m) => m.getBoundingClientRect().width > 0).length;
    return shown < mids.length;
  });
  assertBoundary(partly, 'a middle crumb folded');
  const mbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/23-files-partial-fold.png', clip: { x: mbox.x, y: mbox.y, width: mbox.width, height: 160 } });

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
  await page.click('.window[data-app="paint"] >> [aria-label="Line"]');
  const canvasBox = await page.locator('.window[data-app="paint"] .paint-canvas').boundingBox();
  const pt = (fx, fy) => [canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy];
  await page.mouse.move(...pt(0.12, 0.18));
  await page.mouse.down();
  await page.mouse.move(...pt(0.45, 0.72), { steps: 12 });
  await page.mouse.up();
  await page.click('.window[data-app="paint"] >> [aria-label="Pen"]');
  await page.mouse.move(...pt(0.55, 0.25));
  await page.mouse.down();
  await page.mouse.move(...pt(0.85, 0.6), { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/06-paint.png' });

  /* Accent contrast: the worst case (light theme + lime) with primary buttons visible. */
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.theme.set('theme', 'light');
    window.browserOS.theme.set('accent', 'lime');
  });
  await page.evaluate(() => window.browserOS.launch('welcome'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/07-accent-contrast.png' });
  await page.evaluate(() => {
    window.browserOS.theme.set('accent', 'blue');
    window.browserOS.theme.set('theme', 'dark');
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/08-taskbar-empty.png' });

  /* Taskbar overflow: many windows in a narrow viewport — the cut side gets a fade. */
  await page.setViewportSize({ width: 760, height: 560 });
  await page.evaluate(() => {
    window.browserOS.launch('terminal');
    window.browserOS.launch('files');
    window.browserOS.launch('calc');
    window.browserOS.launch('settings');
    window.browserOS.launch('paint');
    window.browserOS.launch('web');
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const t = document.getElementById('taskbar-items'); t.scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/09-taskbar-overflow.png' });
  await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });

  /* Desktop drop affordance: the dashed outline shown while real files are dragged over. */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'dragging.txt', { type: 'text/plain' }));
    document.getElementById('desktop').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/10-drop-affordance.png' });
  await page.evaluate(() => document.getElementById('desktop').dispatchEvent(new DragEvent('dragleave', { bubbles: true })));

  /* Resize grip: hovering a window reveals diagonal grips in its corner handles. */
  await page.evaluate(() => window.browserOS.launch('terminal'));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    Object.assign(w.el.style, { left: '300px', top: '150px', width: '640px', height: '440px' });
  });
  await page.waitForTimeout(300);
  const wbox = await page.locator('.window[data-app="terminal"]').boundingBox();
  await page.mouse.move(wbox.x + wbox.width - 8, wbox.y + wbox.height - 8);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/11-resize-grip.png', clip: { x: wbox.x + wbox.width - 140, y: wbox.y + wbox.height - 140, width: 140, height: 150 } });

  /* Move strip: the middle of the top edge is where a hand goes to move a window, and the
     dash shows it. The corners of the same edge stay resize handles. */
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  const wbox2 = await page.locator('.window[data-app="terminal"]').boundingBox();
  await page.mouse.move(wbox2.x + wbox2.width * 0.5, wbox2.y + 4);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/12-move-strip.png', clip: { x: wbox2.x - 4, y: wbox2.y - 4, width: wbox2.width + 8, height: 90 } });

  /* Paint history: the Undo and Redo buttons show which step is actually available. */
  await page.evaluate(() => { for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id); });
  await page.evaluate(() => { window.browserOS.theme.set('theme', 'dark'); window.browserOS.launch('paint'); });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    Object.assign(w.el.style, { left: '160px', top: '120px', width: '900px', height: '480px' });
  });
  await page.waitForTimeout(400);
  const pbox = await page.locator('.window[data-app="paint"] .paint-canvas').boundingBox();
  const at = (fx, fy) => [pbox.x + pbox.width * fx, pbox.y + pbox.height * fy];
  await page.mouse.move(...at(0.15, 0.2)); await page.mouse.down(); await page.mouse.move(...at(0.5, 0.8), { steps: 10 }); await page.mouse.up();
  await page.mouse.move(...at(0.55, 0.25)); await page.mouse.down(); await page.mouse.move(...at(0.9, 0.7), { steps: 10 }); await page.mouse.up();
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.waitForTimeout(300);
  const pwin = await page.locator('.window[data-app="paint"]').boundingBox();
  await page.screenshot({ path: 'shots/13-paint-history.png', clip: { x: pwin.x, y: pwin.y, width: pwin.width, height: 150 } });

  /* Compaction: the same Paint window at its minimum width. The colour swatches give way
     first; the tools, brush size, history and Save stay reachable. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    Object.assign(w.el.style, { left: '60px', top: '120px', width: '420px', height: '420px' });
  });
  await page.waitForTimeout(500);
  const nbox = await page.locator('.window[data-app="paint"]').boundingBox();
  await page.screenshot({ path: 'shots/14-paint-compact.png', clip: { x: nbox.x, y: nbox.y, width: nbox.width, height: 150 } });

  /* The width where the palette only has to give up part of itself: the swatches at the end
     of the row go, the ones listed first — including the current colour — stay. Measured at
     680px (tests/probe.mjs paint 680): four of the eight give way, and the bar still
     needs no ⋯. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    Object.assign(w.el.style, { width: '680px' });
  });
  await page.waitForTimeout(500);
  const pfold = await page.locator('.window[data-app="paint"]').boundingBox();
  await page.screenshot({ path: 'shots/24-paint-palette-fold.png', clip: { x: pfold.x, y: pfold.y, width: pfold.width, height: 150 } });

  /* Files at the smallest width it declares it needs, in a real folder. Everything the bar is
     willing to give up it has given up — the Places words, both create buttons, the words on
     Sort and Upload, most of the filter box — and what still does not fit is named in the ⋯.
     The promise at this width is that every action is reachable, not that all of them fit. */
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: '/home/user/Documents' } });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '60px', top: '120px', height: '420px' });
  });
  const minWidth = await page.evaluate(() => window.browserOS.apps.find((a) => a.id === 'files').minWidth);
  await setFilesWidth(minWidth);
  const fbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/15-files-compact.png', clip: { x: fbox.x, y: fbox.y, width: fbox.width, height: 150 } });

  /* The other half of the same trade, at the widest window that still needs it: the Places
     words are gone and the toolbar has given up nothing else. This is what "the sidebar is a
     rung of the bar's ladder, not a second breakpoint" looks like from the user's side. */
  assertBoundary(await widestWhere(() => {
    const root = document.querySelector('.window[data-app="files"] .app');
    const labels = [...root.querySelectorAll('.files-side .side-label')].filter((n) => n.getBoundingClientRect().width > 0);
    return labels.length === 0;
  }), 'the Places words gone');
  const sbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/26-files-places-as-icons.png', clip: { x: sbox.x, y: sbox.y, width: sbox.width, height: 300 } });

  /* A folder name longer than the bar. The name is what gets cut, not the action next to it:
     the last crumb is capped at a recognisable beginning, and the whole name is still in the
     button's accessible name, its tooltip and the title bar. */
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.fs.mkdir('/home/user/Documents/a-folder-name-long-enough-to-cost-the-bar-room');
    window.browserOS.launch('files', { data: { path: '/home/user/Documents/a-folder-name-long-enough-to-cost-the-bar-room' } });
  });
  track('/home/user/Documents/a-folder-name-long-enough-to-cost-the-bar-room');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '40px', top: '120px', width: '360px', height: '420px' });
  });
  await page.waitForTimeout(500);
  const lbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/27-files-long-folder-name.png', clip: { x: lbox.x, y: lbox.y, width: lbox.width, height: 160 } });

  /* The same cap measured in characters, which is what it actually is (12ch). Two names that
     test the claim "the beginning of a name is recognisable": a single 54-character word, and
     a CJK name where every character is twice as wide, so the same box holds half as many of
     them. Looking at these two is how the cap is judged instead of argued about. */
  for (const [n, file] of [
    ['extraordinarilylongfoldernameonewordwithnohyphensatall', '28-files-long-single-word.png'],
    ['日本語のフォルダ名前です', '29-files-cjk-folder-name.png'],
  ]) {
    await page.evaluate((name) => {
      for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
      window.browserOS.fs.mkdir(`/home/user/Documents/${name}`);
      window.browserOS.launch('files', { data: { path: `/home/user/Documents/${name}` } });
    }, n);
    track(`/home/user/Documents/${n}`);
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
      Object.assign(w.el.style, { left: '40px', top: '120px', width: '360px', height: '420px' });
    });
    await page.waitForTimeout(500);
    const nbox = await page.locator('.window[data-app="files"]').boundingBox();
    await page.screenshot({ path: `shots/${file}`, clip: { x: nbox.x, y: nbox.y, width: nbox.width, height: 160 } });
  }

  /* The folder this window was opened on is gone — a restored session, a `open` for a path you
     deleted, a typo. The old behaviour was a toast and a quiet jump to home, which reads exactly
     like an empty home folder. This is the state where the window says which path it could not
     find, where it ended up instead, and offers to put it back. */
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: '/home/user/Documents/used-to-be-here' } });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '300px', top: '110px', width: '640px', height: '430px' });
  });
  await page.waitForTimeout(500);
  const gonebox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/30-files-missing-folder.png', clip: { x: gonebox.x, y: gonebox.y, width: gonebox.width, height: gonebox.height } });

  /* The same window at the width the bar is worst at. The dead-end crumb is the widest thing
     in the toolbar when it is showing, so this is the case where "the trail always keeps the
     anchor and the folder you are in" is actually tested by an eye. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '60px', top: '110px', width: '360px', height: '360px' });
  });
  await page.waitForTimeout(700);
  const goneNarrow = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/31-files-missing-narrow.png', clip: { x: goneNarrow.x, y: goneNarrow.y, width: goneNarrow.width, height: 220 } });

  /* A long file name in a narrow grid. The cell cuts the beginning and keeps the extension —
     the end of a file name is the part that says what kind of file it is. */
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    const d = '/home/user/Documents/names';
    fs.mkdir(d, '/');
    fs.write(`${d}/2024-06-30-team-retrospective-notes-final.tar.gz`, 'x\n', '/');
    fs.write(`${d}/quarterly-report-draft-3.docx`, 'y\n', '/');
    fs.write(`${d}/short.md`, 'z\n', '/');
    for (const w of [...window.browserOS.wm.windows.values()]) if (w.appId === 'files') window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: d } });
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '120px', top: '120px', width: '420px', height: '420px' });
  });
  await page.waitForTimeout(400);
  track('/home/user/Documents/names');
  await page.screenshot({ path: 'shots/32-files-long-names.png' });

  /* The same idea aimed at a *folder* name in the breadcrumb: a name that ends in a marker
     (`-final`, `-snapshot`) keeps the marker when the bar cuts it, because the marker is often
     the only difference between this folder and its siblings. `release-2024-06-30-snapshot` is
     the widest tail the split will protect (8 characters), so this is the worst case for the
     head — and the case the tail cap was chosen against. */
  for (const [n, file] of [
    ['release-2024-06-30-final', '33-files-crumb-marker-tail.png'],
    ['release-2024-06-30-snapshot', '34-files-crumb-widest-tail.png'],
  ]) {
    await page.evaluate((name) => {
      for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
      window.browserOS.fs.mkdir(`/home/user/Documents/${name}`);
      window.browserOS.launch('files', { data: { path: `/home/user/Documents/${name}` } });
    }, n);
    track(`/home/user/Documents/${n}`);
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
      Object.assign(w.el.style, { left: '40px', top: '120px', width: '360px', height: '420px' });
    });
    await page.waitForTimeout(500);
    const cbox = await page.locator('.window[data-app="files"]').boundingBox();
    await page.screenshot({ path: `shots/${file}`, clip: { x: cbox.x, y: cbox.y, width: cbox.width, height: 160 } });
  }

  /* Long names on the desktop, where the truncator is a two-line clamp rather than an
     ellipsis on one line — a different mechanism, and the one that had never been looked at.
     The label wraps and the last line is what gets thrown away, which is where the extension
     lived. */
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    const d = '/home/user/Desktop';
    fs.write(`${d}/2024-06-30-team-retrospective-notes-final.tar.gz`, 'x\n', '/');
    fs.write(`${d}/quarterly-report-draft-3.docx`, 'y\n', '/');
    fs.write(`${d}/release-2024-06-30-snapshot`, 'z\n', '/');
    fs.write(`${d}/short.md`, 'w\n', '/');
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
  });
  for (const f of ['2024-06-30-team-retrospective-notes-final.tar.gz', 'quarterly-report-draft-3.docx',
    'release-2024-06-30-snapshot', 'short.md']) track(`/home/user/Desktop/${f}`);
  await page.waitForTimeout(600);
  /* Clipped to where the long names actually are. A 420px clip of a desktop that lays its
     icons out in a 1280px row shows Terminal, Files, Text Editor and Image Viewer — a capture
     of the feature that contains none of the names the feature is about. */
  await page.screenshot({ path: 'shots/35-desktop-long-names.png', clip: { x: 800, y: 0, width: 440, height: 220 } });

  /* ---------- the light theme ----------
     Every other capture in this file is dark. The states that carry their meaning in colour —
     a red strikethrough on a folder that is not there, a dimmed "missing" badge, a label
     sitting on a wallpaper — are exactly the ones a dark theme hides: on a light surface the
     same faint grey text is doing much more work. This is the pass where they are looked at,
     with the contrast measured rather than eyeballed. */
  const contrastReport = async (theme) => {
    await page.evaluate(`window.paintCssBackground = ${paintCssBackground.toString()}`);
    const rows = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => { const [hi, lo] = [Math.max(a, b), Math.min(a, b)]; return (hi + 0.05) / (lo + 0.05); };
      const onSurface = (node) => {
        const bg = getComputedStyle(node).color;
        let el = node;
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/, 0\)$/.test(c)) return [bg, c];
          el = el.parentElement;
        }
        return [bg, 'rgb(255,255,255)'];
      };
      const pick = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const [fg, bg] = onSurface(n);
        return { sel, fg, bg, ratio: +ratio(lum(fg), lum(bg)).toFixed(2), text: n.textContent.trim().slice(0, 30) };
      };
      /* A desktop label has no surface to walk up to — its background *is* the wallpaper, which
         is a gradient, not a colour. Paint the wallpaper and read the pixel behind the label. */
      const pickOnWallpaper = (n) => {
        const sel = '.desktop .dicon .label';
        /* Every label, not the first one: the longest name is the one that gets the least
           wallpaper behind it. */
        const wall = document.getElementById('wallpaper');
        const w = wall.clientWidth, h = wall.clientHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const c2d = canvas.getContext('2d');
        window.paintCssBackground(c2d, wall.style.background || getComputedStyle(wall).backgroundImage, w, h);
        const box = n.getBoundingClientRect();
        const x = Math.min(w - 1, Math.max(0, Math.round(box.left + box.width / 2)));
        const y = Math.min(h - 1, Math.max(0, Math.round(box.top + box.height / 2)));
        const d = c2d.getImageData(x, y, 1, 1).data;
        const bg = `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
        const fg = getComputedStyle(n).color;
        return { sel, fg, bg, ratio: +ratio(lum(fg), lum(bg)).toFixed(2), text: n.textContent.trim().slice(0, 30) };
      };
      const rows = [pick('.crumb-gone-name'), pick('.crumb-gone-mark')].filter(Boolean);
      const labels = [...document.querySelectorAll('.desktop .dicon .label')].map((n) => pickOnWallpaper(n)).filter(Boolean);
      if (labels.length) {
        labels.sort((a, b) => a.ratio - b.ratio);
        rows.push(labels[0]);
        rows.push({ ...labels[labels.length - 1], sel: labels[labels.length - 1].sel + ' (best of ' + labels.length + ')' });
      }
      return rows;
    });
    for (const r of rows) console.log(`  contrast[${theme}] ${r.ratio.toFixed(2)}:1 ${r.sel} ${r.fg} on ${r.bg} ${JSON.stringify(r.text)}`);
    return rows;
  };

  /* The same report at the other end: the tokens themselves, before any window is open to paint
     them. A status colour and an accent colour are each used two ways — as a fill something is
     written *on*, and as the ink something is written *in* — and the two jobs need different
     values on a light surface. This is the pass that says which pairs are under 4.5:1 without
     needing a window on screen to find out. */
  const tokenReport = async (theme) => {
    const rows = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const tok = (n) => cs.getPropertyValue(n).trim();
      const parse = (c) => {
        const m = c.match(/#([0-9a-f]{6})/i);
        if (m) return [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16));
        return c.match(/\d+/g).slice(0, 3).map(Number);
      };
      const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [hi, lo] = [Math.max(a, b), Math.min(a, b)]; return (hi + 0.05) / (lo + 0.05); };
      const pairs = [
        ['--ok-text', '--surface-2', 'status text on a window'],
        ['--warn-text', '--surface-2', 'warning text on a window'],
        ['--danger-text', '--surface-2', 'error text on a window'],
        ['--on-danger', '--danger', 'a danger button label'],
        ['--accent-text', '--surface-2', 'accent-coloured text on a window'],
        ['--on-accent', '--accent', 'a primary button label'],
      ];
      return pairs.map(([ink, bg, what]) => ({
        ink, bg, what, fg: tok(ink), bgv: tok(bg), ratio: +ratio(lum(parse(tok(ink))), lum(parse(tok(bg)))).toFixed(2),
      }));
    });
    for (const r of rows) {
      const flag = r.ratio < 4.5 ? '  UNDER 4.5' : '';
      console.log(`  tokens[${theme}] ${r.ratio.toFixed(2)}:1 ${r.ink} ${r.fg} on ${r.bg} ${r.bgv} — ${r.what}${flag}`);
    }
    /* A report nobody reads is a report nobody acts on. `npm run screenshots` used to print
       "UNDER 4.5" and exit 0. tests/token-contrast.test.mjs is the real guard and covers more
       pairs than this one; this is the same claim in the tool that is already looking at the
       tokens, so a run that produces new screenshots cannot quietly ship an unreadable one. */
    const under = rows.filter((r) => r.ratio < 4.5);
    if (under.length) {
      throw new Error(`${theme}: ${under.length} token pair(s) below 4.5:1 — ` +
        under.map((r) => `${r.ink} on ${r.bg} is ${r.ratio.toFixed(2)}:1 (${r.what})`).join('; '));
    }
    return rows;
  };

  /* The dead-end crumb and a cut folder name, on the light theme. */
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.theme.set('theme', 'light');
    window.browserOS.launch('files', { data: { path: '/home/user/Documents/used-to-be-here' } });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '60px', top: '110px', width: '360px', height: '380px' });
  });
  await page.waitForTimeout(600);
  await contrastReport('light');
  await tokenReport('light');
  const lbox2 = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/36-light-missing-narrow.png', clip: { x: lbox2.x, y: lbox2.y, width: lbox2.width, height: 240 } });

  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: '/home/user/Documents/release-2024-06-30-snapshot' } });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '40px', top: '120px', width: '360px', height: '420px' });
  });
  await page.waitForTimeout(500);
  const lbox3 = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/37-light-long-folder-name.png', clip: { x: lbox3.x, y: lbox3.y, width: lbox3.width, height: 160 } });

  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    /* The long names again, in the light theme: this is the capture where the labels sit on a
       wallpaper the theme was never designed against. */
    const fs = window.browserOS.fs;
    for (const f of ['2024-06-30-team-retrospective-notes-final.tar.gz', 'quarterly-report-draft-3.docx',
      'release-2024-06-30-snapshot', 'short.md']) fs.write(`/home/user/Desktop/${f}`, 'x\n', '/');
  });
  await page.waitForTimeout(600);
await contrastReport('light-desktop');
  await page.screenshot({ path: 'shots/38-light-desktop-long-names.png', clip: { x: 800, y: 0, width: 440, height: 220 } });
  await page.evaluate(() => window.browserOS.theme.set('theme', 'dark'));
  await page.waitForTimeout(300);
  await tokenReport('dark');

  /* A narrow device: the whole desktop at 420px with Files open. The width measurements in
     the test suite say a toolbar fits at the width an app declares it needs; this is the
     case where the device is smaller than that promise, which only a screenshot can judge. */
  await page.setViewportSize({ width: 420, height: 720 });
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: '/home/user/Documents' } });
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/16-narrow-desktop.png' });

  /* Tiling: the window menu, and the drag preview that names the zone it is showing. */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('terminal');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    Object.assign(w.el.style, { left: '320px', top: '180px', width: '620px', height: '420px' });
  });
  await page.waitForTimeout(300);
  await page.locator('.window[data-app="terminal"] .titlebar').click({ button: 'right' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/17-window-menu.png' });

  const tbox = await page.locator('.window[data-app="terminal"]').boundingBox();
  await page.mouse.move(tbox.x + 150, tbox.y + 12);
  await page.mouse.down();
  await page.mouse.move(8, 300, { steps: 14 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/18-snap-preview.png' });
  await page.mouse.up();

  /* The overflow menu: a Files window *below* the smallest width it declares, with the ⋯
     open. At its declared minimum Files now compacts enough to show everything; this is the
     state where it genuinely cannot, and the point of the ⋯ is that it is still reachable. */
  await page.setViewportSize({ width: 420, height: 720 });
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('files', { data: { path: '/home/user' } });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { left: '24px', top: '40px', width: '340px', height: '420px' });
  });
  await page.waitForTimeout(400);
  await page.click('.window[data-app="files"] .toolbar .toolbar-more');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/19-toolbar-overflow.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* The compact form of the create pair, at the width Files asks for: one button whose menu
     names both actions, instead of two buttons whose words had to be thrown away to fit them.
     The word on the button is the next thing the bar gives up; the menu never goes. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'files');
    Object.assign(w.el.style, { width: '360px' });
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.window[data-app="files"] .files-new-menu').click());
  await page.waitForTimeout(300);
  const newbox = await page.locator('.window[data-app="files"]').boundingBox();
  await page.screenshot({ path: 'shots/25-files-new-menu.png', clip: { x: newbox.x, y: newbox.y, width: newbox.width, height: 280 } });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* Reverse history search: the prompt line while it is mid-search. */
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('terminal');
  });
  await page.waitForTimeout(500);
  const trun = async (c) => { await page.fill('.window[data-app="terminal"] .term-input', c); await page.press('.window[data-app="terminal"] .term-input', 'Enter'); };
  await trun('echo remember to write a note > ~/notes.txt');
  await trun('wc -l ~/notes.txt');
  await trun('grep -n note ~/notes.txt');
  await trun('ls -l ~/Documents');
  track('/home/user/globdemo');
  await page.waitForTimeout(200);
  await page.press('.window[data-app="terminal"] .term-input', 'Control+r');
  await page.keyboard.type('grep');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/20-terminal-rsearch.png' });

  /* Variables and globs. A variable is only a real feature if `set` can show it, and a glob is
     only a real feature if the listing shows every name it matched — both of those are claims a
     screenshot can actually be looked at, unlike the expansion itself. */
  await page.press('.window[data-app="terminal"] .term-input', 'Escape');
  await trun('mkdir -p ~/globdemo && echo one > ~/globdemo/a1.txt && echo two > ~/globdemo/a2.txt');
  await trun('DOCS=~/globdemo');
  await trun('set');
  await trun('ls $DOCS/*.txt');
  await trun('wc -l $DOCS/*.txt');
  await trun('echo "*.txt" is a quoted glob, so it stays a name');
  await page.waitForTimeout(300);
  const vbox = await page.locator('.window[data-app="terminal"]').boundingBox();
  await page.screenshot({ path: 'shots/40-terminal-vars-globs.png', clip: vbox });
  await trun('unset DOCS');
} finally {
  /* Deepest first: removing a parent takes its children with it, and `rm` on a path that is
     already gone is not worth a second pass. */
  await page.evaluate((paths) => {
    for (const p of [...paths].sort((a, b) => b.split('/').length - a.split('/').length)) {
      try { window.browserOS.fs.rm(p, '/', true); } catch { /* already gone */ }
    }
  }, created);
}
await b.close(); await s.close();
