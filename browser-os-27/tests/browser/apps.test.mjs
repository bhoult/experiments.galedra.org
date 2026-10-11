import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

import { contrastRatio, hexToRgb, rgbaOf, mixOver } from './measure.mjs';
const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

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

test('desktop labels are readable on every wallpaper preset', async () => {
  const ids = await page.evaluate(async () => (await import('/src/core/theme.js')).WALLPAPERS.map((w) => w.id));
  assert.ok(ids.length >= 8, 'the test is only meaningful if it walks the real preset list');

  const results = [];
  for (const id of ids) {
    await page.evaluate((wp) => window.browserOS.theme.set('wallpaper', wp), id);
    await page.waitForTimeout(120);
    results.push(await page.evaluate(async (wp) => {
      /* Measured with the app's own instruments: the same sampler the theme uses to choose the
         ink, the same CSS painter, the same contrast formula. A test that carries its own copy
         of the maths can pass on a colour the app would reject. */
      const { sampleCanvas } = await import('/src/core/theme.js');
      const { contrastRatio, paintCssBackground, relLuminance } = await import('/src/core/utils.js');
      /* A *desktop* label — the ones with nothing behind them. `.dicon` also appears inside
         app windows, and those sit on a surface, which is a different question. */
      const label = document.querySelector('.desktop .dicon .label');
      if (!label) return { id: wp, ink: 'no label', samples: 0, worst: 0 };
      const wall = document.getElementById('wallpaper');
      const box = wall.getBoundingClientRect();
      const w = Math.round(box.width), h = Math.round(box.height);
      const ink = getComputedStyle(label).color;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const c2d = canvas.getContext('2d', { willReadFrequently: true });
      if (!paintCssBackground(c2d, wall.style.background || getComputedStyle(wall).backgroundImage, w, h))
        return { id: wp, ink, samples: 0, worst: 0 };
      const surfaces = sampleCanvas(c2d, w, h);
      const parse = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number);
      const inkRgb = parse(ink);
      /* The independent measurement: walk the pixels themselves, on a stride that has nothing to
         do with the sampler's, and find the real worst case and the real extremes. The sampler is
         allowed to be a subset of the wallpaper; it is not allowed to be an *optimistic* one. */
      const lum = (c) => relLuminance(c);
      const px = c2d.getImageData(0, 0, w, h).data;
      let trueWorst = Infinity, trueMin = Infinity, trueMax = -1;
      for (let i = 0; i < px.length; i += 4 * 3) {
        if (px[i + 3] === 0) continue;
        const rgb = [px[i], px[i + 1], px[i + 2]];
        const c = contrastRatio(inkRgb, rgb);
        if (c < trueWorst) trueWorst = c;
        const L = lum(rgb);
        if (L < trueMin) trueMin = L;
        if (L > trueMax) trueMax = L;
      }
      const worst = Math.min(...surfaces.map((c) => contrastRatio(inkRgb, c)));
      const sMin = Math.min(...surfaces.map(lum));
      const sMax = Math.max(...surfaces.map(lum));
      return { id: wp, ink, samples: surfaces.length, worst, trueWorst, darkGap: sMin / Math.max(trueMin, 1e-6), lightGap: sMax / Math.max(trueMax, 1e-6) };
    }, id));
  }

  for (const r of results) {
    /* Not "enough sample points": a grid can have a thousand points and still miss the one colour
       that decides the answer. The claim the sampler makes is about the *worst* colour, so that is
       what is compared. Samples are a subset of the wallpaper, so the number they give can never be
       worse than the truth — the way it can be wrong is by being *optimistic*, and the band width
       (about 9% of luminance) is what bounds that. */
    assert.ok(r.samples >= 2, `${r.id}: the sampler found only ${r.samples} colours in a gradient wallpaper`);
    assert.ok(r.darkGap <= 1.15, `${r.id}: the darkest colour the sampler found is ${r.darkGap.toFixed(2)}× the luminance of the darkest colour the wallpaper has — it is not reading the dark end of this wallpaper`);
    assert.ok(r.lightGap >= 0.85, `${r.id}: the lightest colour the sampler found is only ${r.lightGap.toFixed(2)}× the luminance of the lightest the wallpaper has — it is not reading the bright end of this wallpaper`);
    assert.ok(r.worst <= r.trueWorst * 1.15 + 0.02,
      `${r.id}: the sampler says the worst place that label can land gives ${r.worst.toFixed(2)}:1, but the wallpaper has a place that gives ${r.trueWorst.toFixed(2)}:1 — the ink is being chosen against a friendlier wallpaper than the one on screen`);
    assert.ok(r.worst >= 4.5,
      `${r.id}: the desktop label ink ${r.ink} reaches only ${r.worst.toFixed(2)}:1 against the wallpaper`);
  }

  /* The ink really does change with the wallpaper — a fixed colour would pass some presets by
     luck and fail others, and this is the regression the fix is for. */
  const byId = Object.fromEntries(results.map((r) => [r.id, r.ink]));
  assert.notEqual(byId.paper, byId.aurora, 'a light wallpaper and a dark one cannot share one ink');

  await page.evaluate(() => { window.browserOS.theme.set('wallpaper', 'aurora'); window.browserOS.theme.set('theme', 'dark'); });
});

/* A custom wallpaper has no colours to read out of its CSS — it is a `url()`, an upload. That
   is the one input where the string-measuring route has nothing to say, and it is exactly where
   a fixed default ink reproduces the original failure. The theme loads the image and measures
   the pixels instead. */
test('an uploaded wallpaper gets its ink measured from the image, not guessed from a default', async () => {
  const inks = {};
  for (const [name, stops] of [['pale', ['#f4f7fb', '#dfe7f2']], ['dark', ['#101828', '#1c2a44']]]) {
    const dataUrl = await page.evaluate(([n, cs]) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 64, 64);
      cs.forEach((col, i) => grad.addColorStop(i / (cs.length - 1), col));
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png');
    }, [name, stops]);
    await page.evaluate((url) => window.browserOS.theme.set('customWallpaper', url), dataUrl);
    if (!(await page.waitForFunction(() => window.browserOS.theme.wallpaperInkRatio !== null, null, { timeout: 4000 }).catch(() => null)))
      assert.fail(`${name}: the theme never measured the uploaded wallpaper (wallpaperInkRatio stayed null)`);
    inks[name] = await page.evaluate(() => ({
      ink: getComputedStyle(document.querySelector('.desktop .dicon .label')).color,
      ratio: window.browserOS.theme.wallpaperInkRatio,
      painted: document.getElementById('wallpaper').style.background.slice(0, 12),
    }));
  }

  assert.ok(inks.pale.painted.startsWith('url("data:'), `the wallpaper really is the uploaded image, not a preset (${inks.pale.painted})`);
  assert.notEqual(inks.pale.ink, inks.dark.ink, 'a pale photograph and a dark one cannot share one ink');
  assert.equal(inks.pale.ink, 'rgb(22, 32, 47)', 'a pale wallpaper needs dark ink');
  assert.equal(inks.dark.ink, 'rgb(233, 237, 247)', 'a dark wallpaper needs light ink');
  for (const k of ['pale', 'dark']) {
    assert.ok(inks[k].ratio >= 4.5, `${k}: measured only ${inks[k].ratio}:1 against the uploaded image`);
  }

  await page.evaluate(() => window.browserOS.theme.set('customWallpaper', null));
});

/* ---------- what the measurement is for ----------
   Until now the ink decision happened in the theme and nowhere else: pick a wallpaper, watch the
   desktop go unreadable, and have no way to know why. Two of these are about the measurement
   being *right* (a thin band, a mid-tone), and one is about it being *visible*. */
test('a thin bright band in a wallpaper is measured, not stepped over', async () => {
  /* The old sampler took nine points, one sixth of the way across at a time. A band 8% of the
     height tall — a window in an otherwise dark room — sat between two of those points, so the
     ink was chosen against a wallpaper that was not the one on screen, and the number Settings
     would have quoted was 15.15:1 for a label that was really 3.19:1 on the band.
     The sampler now takes a fixed number of samples across the longest side. */
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#101828'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#7d858e'; g.fillRect(0, 40, 128, 10);   // 8% of the height, between two old sample rows
    return c.toDataURL('image/png');
  });
  await page.evaluate((url) => window.browserOS.theme.set('customWallpaper', url), dataUrl);
  if (!(await page.waitForFunction(() => window.browserOS.theme.wallpaperInkRatio !== null, null, { timeout: 4000 }).catch(() => null)))
    assert.fail('the banded wallpaper was never measured');

  const got = await page.evaluate(() => ({
    ink: getComputedStyle(document.querySelector('.desktop .dicon .label')).color,
    ratio: window.browserOS.theme.wallpaperInkRatio,
    plate: window.browserOS.theme.wallpaperPlate,
  }));

  const field = hexToRgb('#101828'), band = hexToRgb('#7d858e');
  const light = hexToRgb('#e9edf7');
  assert.ok(contrastRatio(light, field) > 15 && contrastRatio(light, band) < 3.5,
    'the setup of this test: the ink the dark part of the image wants is invisible on the bright band');

  /* Nine points would have missed the band and reported 15.15:1 with nothing behind the label.
     The band has to make the measurement worse — and make it honest. */
  assert.ok(got.ratio < 15, `the measurement did not see the band: it reported ${got.ratio}:1, the field-only number`);
  assert.ok(got.plate, `the band drags the best ink below the bar (${got.ratio}:1 before a plate), so one is required`);
  assert.ok(got.ratio >= 4.5, `and the plated answer still has to clear it: ${got.ratio}:1`);

  const layer = rgbaOf(got.plate);
  const onBand = contrastRatio(light, mixOver(band, layer));
  assert.ok(onBand >= 4.5, `the label on the band itself reads at ${onBand.toFixed(2)}:1 through the plate the measurement promised`);

  await page.evaluate(() => window.browserOS.theme.set('customWallpaper', null));
});

/* The thin-band test above uses an image the theme loads. This one goes straight at the sampler,
   at a size where the old "32 points across the long side" rule had a step of 37 pixels: a detail
   2 rows tall in 800 is smaller than any grid, and it must still be in the answer. */
test('the sampler reads every pixel, so a detail finer than any grid still counts', async () => {
  const got = await page.evaluate(async () => {
    const { sampleCanvas } = await import('/src/core/theme.js');
    const { contrastRatio } = await import('/src/core/utils.js');
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#101828'; g.fillRect(0, 0, 1200, 800);
    g.fillStyle = '#f6f8fb'; g.fillRect(0, 400, 1200, 2);   // 2 rows of near-white in 800
    const samples = sampleCanvas(c.getContext('2d', { willReadFrequently: true }), 1200, 800);
    const field = [16, 24, 40];
    return { count: samples.length, brightest: Math.max(...samples.map((s) => contrastRatio(field, s))) };
  });

  assert.ok(got.count >= 2, `the sampler returned ${got.count} colours`);
  /* The brightest thing in the image is the band. A grid with a 37px step found only the field, so
     the brightest colour it could report was the field itself — 1.00:1 against it. */
  assert.ok(got.brightest >= 15,
    `the near-white band was not in the answer: the brightest colour found reaches only ${got.brightest.toFixed(2)}:1 against the field`);
});

test('a mid-tone upload gets a plate, and Settings says so out loud', async () => {
  /* Two inks are a light one and a dark one. A wallpaper that is mid-tone all the way across
     fails both — the honest answer is not "whichever is less bad", it is "neither, so put a
     plate behind the label and measure through it". */
  const bare = (ink) => contrastRatio(hexToRgb(ink), hexToRgb('#7d858e'));
  assert.ok(bare('#e9edf7') < 4.5 && bare('#16202f') < 4.5,
    `#7d858e has to be a wallpaper neither ink reads on, got ${bare('#e9edf7').toFixed(2)} and ${bare('#16202f').toFixed(2)}`);

  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#7d858e'; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#8b939c'; g.fillRect(0, 0, 64, 48);      // a lighter half, same mid-tone family
    g.fillStyle = '#6f7780'; g.fillRect(64, 48, 64, 48);
    return c.toDataURL('image/png');
  });

  await openApp('settings');
  await page.setInputFiles('#wall-upload', {
    name: 'mid-tone.png', mimeType: 'image/png',
    buffer: Buffer.from(png.split(',')[1], 'base64'),
  });
  if (!(await page.waitForFunction(() => window.browserOS.theme.wallpaperPlate !== null, null, { timeout: 5000 }).catch(() => null)))
    assert.fail(`a wallpaper no ink reads on did not get a plate (ratio ${await page.evaluate(() => window.browserOS.theme.wallpaperInkRatio)})`);

  const state = await page.evaluate(() => ({
    ratio: window.browserOS.theme.wallpaperInkRatio,
    plate: window.browserOS.theme.wallpaperPlate,
    labelBg: getComputedStyle(document.querySelector('.desktop .dicon .label')).backgroundColor,
    labelColor: getComputedStyle(document.querySelector('.desktop .dicon .label')).color,
    note: document.querySelector('.window[data-app="settings"] .ink-note')?.textContent || '',
  }));
  assert.ok(state.ratio >= 4.5, `the plate has to actually work: measured ${state.ratio}:1`);
  assert.notEqual(state.labelBg, 'rgba(0, 0, 0, 0)', 'the plate the measurement promised has to be painted');
  const painted = rgbaOf(state.labelBg), measured = rgbaOf(state.plate);
  assert.deepEqual(painted, measured,
    `the painted plate (${state.labelBg}) is not the plate that was measured (${state.plate})`);
  assert.match(state.note, /plate/i, `Settings did not say a plate is in use: ${state.note}`);
  assert.match(state.note, new RegExp(String(state.ratio).replace('.', '\\.')), 'Settings shows the plated ratio');

  await page.evaluate(() => window.browserOS.theme.set('customWallpaper', null));
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => ({
    plate: window.browserOS.theme.wallpaperPlate,
    painted: getComputedStyle(document.querySelector('.desktop .dicon .label')).backgroundColor,
    note: document.querySelector('.window[data-app="settings"] .ink-note')?.textContent || '',
  }));
  assert.equal(cleared.plate, null, 'a preset that reads must not keep the plate from the upload');
  assert.equal(cleared.painted, 'rgba(0, 0, 0, 0)', `the plate is still painted on the desktop (${cleared.painted})`);
  assert.match(cleared.note, /readable on this wallpaper/);

  await closeApp('settings');
});

/* The plate is chosen from a *bounded* reading of the wallpaper: one colour per luminance band,
   from a canvas capped at 640px. The claim it has to survive is wider than that — the plate it
   chose has to work at every pixel of the wallpaper it is painted onto, at the size the wallpaper
   is actually drawn. So: let the sampler choose, then check it against a brute-force scan of the
   same wallpaper. If the bounded reading ever misses a colour that decides the answer, this is the
   test that says so. */
test('a plate chosen from sampled colours reads on every pixel of the wallpaper', async () => {
  /* Mid-tone all the way across: the light ink fails on the dark half (2.5:1 at #8f97a1) and the
     dark ink fails on the light half (3.5:1 at #6c747d). Neither is “less bad” enough. */
  const css = 'linear-gradient(155deg, #6c747d 0%, #8f97a1 45%, #7d858e 72%, #868f99 100%)';
  await page.evaluate((css) => window.browserOS.theme.set('customWallpaper', css), css);
  if (!(await page.waitForFunction(() => window.browserOS.theme.wallpaperPlate !== null, null, { timeout: 5000 }).catch(() => null)))
    assert.fail(`a wallpaper both inks fail on did not get a plate (measured ${await page.evaluate(() => window.browserOS.theme.wallpaperInkRatio)}:1)`);

  const r = await page.evaluate(async (css) => {
    const { rgbaOf, contrastRatio, mixOver, paintCssBackground } = await import('/src/core/utils.js');
    const label = document.querySelector('.desktop .dicon .label');
    if (!label) return { error: 'no desktop label to measure' };
    const ink = rgbaOf(getComputedStyle(label).color);
    const plate = rgbaOf(getComputedStyle(label).backgroundColor);
    const reported = window.browserOS.theme.wallpaperInkRatio;

    const wall = document.getElementById('wallpaper');
    const w = Math.round(wall.getBoundingClientRect().width);
    const h = Math.round(wall.getBoundingClientRect().height);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!paintCssBackground(ctx, css, w, h)) return { error: 'the gradient did not paint' };
    const data = ctx.getImageData(0, 0, w, h).data;

    let worst = Infinity;
    let worstAt = null;
    for (let p = 0; p < data.length; p += 4) {
      const bg = [data[p], data[p + 1], data[p + 2]];
      const c = contrastRatio(ink, mixOver(bg, plate));
      if (c < worst) { worst = c; worstAt = { x: (p / 4) % w, y: Math.floor((p / 4) / w), bg }; }
    }
    return { w, h, pixels: data.length / 4, reported, worst: +worst.toFixed(2), worstAt, ink, plate };
  }, css);

  try {
    assert.ok(!r.error, r.error);
    assert.ok(r.plate[3] > 0, `the plate the theme promised is not painted on the label (${JSON.stringify(r.plate)})`);
    assert.ok(r.reported >= 4.5, `the theme reported ${r.reported}:1, which is under the bar it claims`);
    /* The reported number is rounded to 2dp and the plate alpha is rounded *up*, so the true worst
       is never worse than what was reported — a gap here means the bounded reading missed a colour. */
    assert.ok(r.worst >= 4.49, `the plate fails at ${JSON.stringify(r.worstAt.bg)} (${r.worst}:1) out of ${r.pixels} pixels of a ${r.w}x${r.h} wallpaper, while the theme reported ${r.reported}:1`);
  } finally {
    await page.evaluate(() => window.browserOS.theme.set('customWallpaper', null));
    await page.waitForTimeout(200);
  }
});

test('Settings says what the wallpaper measurement found', async () => {
  await openApp('settings');
  const note = page.locator('.window[data-app="settings"] .ink-note');
  await note.waitFor({ state: 'visible', timeout: 4000 });

  const readout = async () => ({
    text: (await note.textContent()) || '',
    live: await page.evaluate(() => ({
      ratio: window.browserOS.theme.wallpaperInkRatio,
      ink: getComputedStyle(document.querySelector('.desktop .dicon .label')).color,
    })),
  });

  const first = await readout();
  assert.ok(first.live.ratio >= 4.5, `the preset on screen measured ${first.live.ratio}:1`);
  assert.match(first.text, new RegExp(`readable on this wallpaper \\(${String(first.live.ratio).replace('.', '\\.')}\\:1`),
    `Settings is not reporting the measurement it has: ${first.text}`);

  /* Switching wallpaper has to change what Settings says — a number printed once is a decoration. */
  const before = await page.evaluate(() => window.browserOS.theme.settings.wallpaper);
  const ids = ['paper', 'aurora'];
  const seen = [];
  for (const id of ids) {
    await page.evaluate((wp) => window.browserOS.theme.set('wallpaper', wp), id);
    await page.waitForTimeout(250);
    const r = await readout();
    assert.match(r.text, /readable on this wallpaper/, `on ${id}: ${r.text}`);
    assert.match(r.text, new RegExp(String(r.live.ratio).replace('.', '\\.')), `${id}: the number shown is not the number measured`);
    seen.push(r.live.ink);
  }
  assert.notEqual(seen[0], seen[1], 'the two wallpapers picked different inks, so the readout is following the measurement');

  await page.evaluate((wp) => window.browserOS.theme.set('wallpaper', wp), before);
  await closeApp('settings');
});

test('editor asks before closing a document with unsaved changes', async () => {
  await openApp('editor');
  await page.click('.window[data-app="editor"] .editor-area');
  await page.keyboard.type('this was never saved');
  assert.match(await page.textContent('.window[data-app="editor"] .statusbar'), /unsaved/);

  await win('editor').locator('.wbtn.close').click();
  await dialogShown(/unsaved changes/);
  await dialogCancel();
  assert.equal(await win('editor').count(), 1, 'dismissing the warning should keep the window open');

  await win('editor').locator('.wbtn.close').click();
  await dialogShown();
  await dialogAccept();
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

  await closeApp('editor');
});

test('paint draws where the pointer is and saves a full-resolution PNG', async () => {
  await openApp('paint');
  await page.waitForTimeout(500); // let the window-open animation finish before measuring
  const canvas = win('paint').locator('.paint-canvas');
  const box = await canvas.boundingBox();
  await page.click('.window[data-app="paint"] >> [aria-label="Line"]');

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
  // Leave ~/Pictures as we found it: a stray sketch.png changes what later viewer tests see.
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/Pictures/sketch.png', '/', false));
});

test('the Settings storage card names the kind of storage failure, not just that one happened', async () => {
  await closeAll();
  const cardText = async () => {
    const text = (await page.locator('.window[data-app="settings"] .card').allTextContents()).join('\n');
    const advice = await page.evaluate(() => document.querySelector('.window[data-app="settings"] .card p.muted')?.textContent || '');
    return { text, advice };
  };
  const openCard = async () => {
    await closeApp('settings');
    await openApp('settings');
    await page.waitForTimeout(300);
    return cardText();
  };

  await openApp('settings');
  await page.waitForTimeout(300);
  assert.match((await cardText()).text, /Failed writes\s*none/, 'with nothing wrong, the card says so');

  /* A full storage and a storage that does not exist are different problems, and the card
     is where a user finds out which one they have. */
  await page.evaluate(() => {
    Object.assign(window.browserOS.store, { failures: 2, lastError: 'The quota has been exceeded.', lastErrorKind: 'quota' });
  });
  const full = await openCard();
  assert.match(full.text, /Failed writes[\s\S]{0,80}the storage is full/, 'a quota failure must be called what it is');
  assert.match(full.advice, /Delete files/, 'and say the thing that would actually help');

  await page.evaluate(() => {
    Object.assign(window.browserOS.store, { lastErrorKind: 'unavailable', lastError: 'localStorage is not available' });
  });
  const blocked = await openCard();
  assert.match(blocked.text, /not giving the page any storage/);
  assert.match(blocked.advice, /Private windows/);
  assert.ok(!/Delete files/.test(blocked.advice), 'advice for a full disk is wrong advice for no disk');

  await page.evaluate(() => {
    Object.assign(window.browserOS.store, { failures: 0, lastError: null, lastErrorKind: null });
  });
  assert.match((await openCard()).text, /Failed writes\s*none/);
  await closeApp('settings');
});

test('image viewer zooms and walks the images in a folder', async () => {
  await page.evaluate(() => {
    const mk = (w, h, color) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, w, h);
      return c.toDataURL('image/png');
    };
    window.browserOS.fs.write('/home/user/Pictures/zoom-a.png', mk(40, 20, '#ff0000'), '/');
    window.browserOS.fs.write('/home/user/Pictures/zoom-b.png', mk(80, 60, '#00ff00'), '/');
  });

  await openApp('viewer', { path: '/home/user/Pictures/zoom-a.png' });
  await page.waitForTimeout(400);
  const status = () => page.textContent('.window[data-app="viewer"] .statusbar');
  assert.match(await status(), /zoom-a\.png/);
  assert.match(await status(), /40×20 px/, 'the status bar should report the real pixel size');
  assert.match(await page.textContent('.window[data-app="viewer"] .toolbar'), /1 \/ 2/, 'the viewer should know it is in a folder of two images');

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  assert.match(await status(), /zoom-b\.png/, '→ should open the next image in the folder');
  assert.match(await page.textContent('.window[data-app="viewer"] .titlebar'), /zoom-b\.png/, 'the title should follow');

  await page.click('.window[data-app="viewer"] button[title="Zoom in"]');
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() => document.querySelector('.viewer-main img').getBoundingClientRect().width);
  assert.ok(shown >= 150, `a 200% zoom of an 80px image should be ~160px wide, got ${Math.round(shown)}`);
  assert.match(await page.textContent('.window[data-app="viewer"] .toolbar'), /200%/);

  await page.click('.window[data-app="viewer"] >> text=Fit');
  await page.waitForTimeout(200);
  const fitted = await page.evaluate(() => document.querySelector('.viewer-main img').getBoundingClientRect().width);
  assert.ok(fitted <= 80 + 1, 'Fit must not upscale beyond the real size');

  await page.evaluate(() => { window.browserOS.fs.rm('/home/user/Pictures/zoom-a.png', '/', false); window.browserOS.fs.rm('/home/user/Pictures/zoom-b.png', '/', false); });
  await closeApp('viewer');
});

test('web browser has a loading state and a working history', async () => {
  await openApp('web');
  const status = '.window[data-app="web"] .statusbar';
  const address = '.window[data-app="web"] .field';
  assert.match(await page.textContent(status), /Loading|example\.com/, 'a fresh web window should say what it is doing');

  /* Navigate to a plain fixture page, not index.html: a same-origin page is framed
     without allow-same-origin, so the OS's own module scripts would (correctly) fail
     its CORS check and log errors. The fixture has no scripts and must load cleanly. */
  await page.fill(address, `${server.url}/tests/fixtures/embed.html`);
  await page.press(address, 'Enter');
  await page.waitForFunction((needle) => document.querySelector('.window[data-app="web"] .statusbar')?.textContent.includes(needle), 'embed.html', { timeout: 8000 });
  assert.match(await page.textContent(status), /embed\.html/);
  assert.match(await page.textContent(status), /same origin/, 'the sandbox note should say what it did');
  assert.match(await win('web').locator('.titlebar').textContent(), /Web Browser/);

  await page.click('.window[data-app="web"] button[title="Back"]');
  await page.waitForTimeout(400);
  assert.match(await page.inputValue(address), /example\.com/, 'Back returns to the previous page');
  const backDisabled = await page.evaluate(() => document.querySelector('.window[data-app="web"] button[title="Back"]').disabled);
  assert.ok(backDisabled, 'Back is disabled at the start of the history');

  await page.click('.window[data-app="web"] button[title="Forward"]');
  await page.waitForTimeout(400);
  assert.match(await page.inputValue(address), /embed\.html/, 'Forward moves ahead again');

  await page.fill(address, 'not a url !!');
  await page.press(address, 'Enter');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#toasts'), /Invalid URL/);
  await closeApp('web');
});

test('paint saves a PNG into ~/Pictures and opens it in the viewer', async () => {
  await closeAll();
  await openApp('paint');
  const box = await win('paint').locator('.paint-canvas').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 10 });
  await page.mouse.up();
  await page.click('.window[data-app="paint"] >> text=Save PNG');
  await win('viewer').waitFor({ state: 'attached', timeout: 5000 });
  const info = await page.evaluate(() => ({
    files: window.browserOS.fs.list('/home/user/Pictures').map((f) => f.name),
    natural: (() => { const i = document.querySelector('.viewer-main img'); return i ? { w: i.naturalWidth, h: i.naturalHeight } : null; })(),
  }));
  assert.ok(info.files.some((n) => n.startsWith('sketch') && n.endsWith('.png')),
    `a sketch.png should exist in ~/Pictures, got ${JSON.stringify(info.files)}`);
  assert.ok(info.natural && info.natural.w > 100 && info.natural.h > 100,
    `the viewer should render the saved bitmap at full size, got ${JSON.stringify(info.natural)}`);
  await closeApp('paint');
  await closeApp('viewer');
});

test('every accent preset is readable as button text and as text on a surface, in both themes', async () => {
  /* The accent was doing two jobs with one token: a fill to paint a primary button, and the ink
     to write terminal output and links in. White on #21c7b8 is 2.12:1 — a button label nobody
     can read — and #4f8cff on a light panel is 2.98:1. The presets now carry their own
     `--on-accent` (chosen against the fill) and `--accent-text` (chosen against the surface). */
  const accents = await page.evaluate(async () => (await import('/src/core/theme.js')).ACCENTS.map((a) => a.id));
  assert.ok(accents.length >= 6, 'the test is only meaningful if it walks the real accent list');

  /* A primary button to measure against. */
  await openApp('welcome');

  const failures = [];
  const rendered = [];
  for (const theme of ['dark', 'light']) {
    for (const id of accents) {
      await page.evaluate(([t, a]) => { window.browserOS.theme.set('theme', t); window.browserOS.theme.set('accent', a); }, [theme, id]);
      await page.waitForTimeout(90);
      const t = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const names = ['--accent', '--on-accent', '--accent-text', '--surface-2', '--bg'];
        return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
      });
      const check = (inkName, bgName, what) => {
        const r = contrastRatio(rgbaOf(t[inkName]), rgbaOf(t[bgName]));
        if (r < 4.5) failures.push(`${theme}/${id}: ${inkName} ${t[inkName]} on ${bgName} ${t[bgName]} is ${r.toFixed(2)}:1 (${what})`);
      };
      check('--on-accent', '--accent', 'primary-button label');
      check('--accent-text', '--surface-2', 'text on a window surface');
      check('--accent-text', '--bg', 'text on the desktop');

      /* And once in the real DOM, so the tokens are not merely well-declared. */
      const btn = page.locator('.window[data-app="welcome"] .btn.primary').first();
      if (await btn.count()) {
        const got = await btn.evaluate((n) => ({
          color: getComputedStyle(n).color, background: getComputedStyle(n).backgroundColor,
        }));
        const r = contrastRatio(rgbaOf(got.color), rgbaOf(got.background));
        if (r < 4.5) failures.push(`${theme}/${id}: a real primary button reads at ${r.toFixed(2)}:1 (${got.color} on ${got.background})`);
        rendered.push(`${theme}/${id} ${r.toFixed(2)}`);
      }
    }
  }
  assert.ok(failures.length === 0, `accent colours that fail 4.5:1\n  ${failures.join('\n  ')}`);
  assert.ok(rendered.length >= 2, `no real accent-coloured button was measured (${rendered.length})`);

  await closeApp('welcome');
  await page.evaluate(() => window.browserOS.theme.set('accent', 'blue'));
});

test('status colours are readable as text, in both themes', async () => {
  /* --ok / --warn / --danger were the same two-job mistake as the accent: a fill to paint a
     button with, and the ink to write a sentence in. #3ddc97 is a fine toast border on a dark
     card and 1.63:1 as text on a light one, and white on #ff5f6d is 2.95:1 on the *dark* theme
     too — the "Reset filesystem" button, unreadable the whole time. */
  const failures = [];
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => window.browserOS.theme.set('theme', t), theme);
    await page.waitForTimeout(120);
    const t = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const names = ['--ok', '--warn', '--danger', '--ok-text', '--warn-text', '--danger-text', '--on-danger', '--surface-2', '--bg', '--surface-solid'];
      return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    });
    for (const ink of ['--ok-text', '--warn-text', '--danger-text']) {
      for (const bg of ['--surface-2', '--bg', '--surface-solid']) {
        const r = contrastRatio(rgbaOf(t[ink]), rgbaOf(t[bg]));
        if (r < 4.5) failures.push(`${theme}: ${ink} ${t[ink]} on ${bg} ${t[bg]} is ${r.toFixed(2)}:1`);
      }
    }
    const r = contrastRatio(rgbaOf(t['--on-danger']), rgbaOf(t['--danger']));
    if (r < 4.5) failures.push(`${theme}: a danger button's label (${t['--on-danger']}) on its own fill (${t['--danger']}) is ${r.toFixed(2)}:1`);

    /* A real danger button, painted. */
    await openApp('settings');
    const btn = page.locator('.window[data-app="settings"] .btn.danger').first();
    await btn.waitFor({ state: 'visible', timeout: 4000 });
    const got = await btn.evaluate((n) => ({ color: getComputedStyle(n).color, background: getComputedStyle(n).backgroundColor, text: n.textContent }));
    const rr = contrastRatio(rgbaOf(got.color), rgbaOf(got.background));
    if (rr < 4.5) failures.push(`${theme}: the real "${got.text}" button reads at ${rr.toFixed(2)}:1 (${got.color} on ${got.background})`);
    await closeApp('settings');
  }
  assert.ok(failures.length === 0, failures.join('\n'));
  await page.evaluate(() => window.browserOS.theme.set('theme', 'dark'));
});

test('paint undo restores the canvas, including across a window resize', async () => {
  await closeAll();
  await openApp('paint');
  await page.waitForTimeout(500); // let the window-open animation finish before measuring
  const box = await win('paint').locator('.paint-canvas').boundingBox();
  await page.click('.window[data-app="paint"] >> [aria-label="Line"]');

  const sample = (cx, cy) => page.evaluate(([x, y]) => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [cx, cy]);
  const nonWhite = () => page.evaluate(() => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
    return n;
  });
  const drawLine = async (x1, y1, x2, y2) => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
    await page.mouse.up();
  };

  /* First stroke, then undo: the canvas must go fully blank again. */
  await drawLine(40, 40, box.width - 40, box.height - 40);
  const mid = { x: box.width / 2, y: box.height / 2 };
  const drawn = await sample(mid.x, mid.y);
  assert.ok(drawn[2] > 180 && drawn[0] < 160, `the diagonal should be drawn, got rgb(${drawn})`);

  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.waitForTimeout(200);
  assert.equal(await nonWhite(), 0, 'undo must restore the pre-stroke canvas exactly');

  /* Redraw the diagonal, add a horizontal line, then resize the window: the next
     undo snapshot has the *old* canvas dimensions, so restoring it exercises the
     scaled path. */
  await drawLine(40, 40, box.width - 40, box.height - 40);
  await drawLine(40, 60, box.width - 40, 60);
  assert.ok((await sample(box.width / 2, 60))[2] > 180, 'the horizontal line should be drawn');

  const beforeWidth = await page.evaluate(() => document.querySelector('.window[data-app="paint"] .paint-canvas').width);
  await win('paint').locator('.titlebar').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(400); // let the resize settle and fit() re-lay the canvas
  const grew = await page.evaluate(() => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    return c.width;
  });
  assert.ok(grew > beforeWidth,
    'resizing the window must grow the canvas backing store (setup for the scaled-undo path)');

  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.waitForTimeout(200);
  assert.deepEqual(await sample(box.width / 2, 60), [255, 255, 255],
    'the horizontal stroke (drawn after the snapshot) must be gone after undo');
  assert.ok(await nonWhite() > 0, 'the earlier diagonal must come back scaled to the resized canvas');

  /* One more undo reaches the blank snapshot taken before the first stroke. */
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.waitForTimeout(200);
  assert.equal(await nonWhite(), 0, 'undoing back to the first snapshot leaves a blank sheet');

  await closeApp('paint');
});

test('paint redo brings back what undo took, and the history buttons tell the truth', async () => {
  await closeAll();
  await openApp('paint');
  await page.waitForTimeout(500); // let the window-open animation finish before measuring
  const box = await win('paint').locator('.paint-canvas').boundingBox();

  const sample = (cx, cy) => page.evaluate(([x, y]) => {
    const c = document.querySelector('.window[data-app="paint"] .paint-canvas');
    const dpr = window.devicePixelRatio || 1;
    const d = c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [cx, cy]);
  const drawLine = async (x1, y1, x2, y2) => {
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
    await page.mouse.up();
  };
  const disabled = (label) => page.evaluate((label) => {
    const b = [...document.querySelectorAll('.window[data-app="paint"] .toolbar button')]
      .find((b) => b.getAttribute('aria-label') === label);
    return b ? { found: true, disabled: b.disabled, title: b.title } : { found: false };
  }, label);

  const fresh = { undo: await disabled('Undo'), redo: await disabled('Redo') };
  assert.deepEqual(fresh, { undo: { found: true, disabled: true, title: 'Nothing to undo' }, redo: { found: true, disabled: true, title: 'Nothing to redo' } },
    'a blank canvas must not offer Undo or Redo');

  /* A button that can do nothing must look like it can do nothing. */
  const look = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.window[data-app="paint"] .toolbar button')].find((b) => b.getAttribute('aria-label') === 'Undo');
    const s = getComputedStyle(b);
    return { opacity: Number(s.opacity), cursor: s.cursor };
  });
  assert.ok(look.opacity < 0.7, `a disabled button must look dimmed, opacity ${look.opacity}`);
  assert.equal(look.cursor, 'not-allowed', `a disabled button must not offer a pointer, cursor ${look.cursor}`);

  /* Two strokes: a diagonal, then a horizontal line. */
  await drawLine(40, 40, box.width - 40, box.height - 40);
  await drawLine(40, 90, box.width - 40, 90);
  const mid = { x: box.width / 2 };
  assert.ok((await sample(mid.x, 90))[2] > 180, 'the horizontal stroke should be drawn');
  assert.equal((await disabled('Undo')).disabled, false, 'a stroke makes Undo real');
  assert.equal((await disabled('Redo')).disabled, true, 'Redo stays empty until something is undone');

  /* Keyboard shortcuts, scoped to this window: Ctrl+Z undoes, Ctrl+Shift+Z redoes. */
  await page.focus('.window[data-app="paint"] input[type="range"]');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.deepEqual(await sample(mid.x, 90), [255, 255, 255], 'Ctrl+Z must remove the last stroke');
  assert.ok((await sample(mid.x, box.height / 2))[2] > 180, 'Ctrl+Z must keep the earlier stroke');
  assert.equal((await disabled('Redo')).disabled, false, 'undoing must make Redo real');

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  assert.ok((await sample(mid.x, 90))[2] > 180, 'Ctrl+Shift+Z must put the undone stroke back');
  assert.equal((await disabled('Redo')).disabled, true, 'the redo stack is empty again');

  /* The toolbar buttons drive the same stacks. */
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  await page.waitForTimeout(200);
  assert.deepEqual(await sample(mid.x, 90), [255, 255, 255]);
  await page.click('.window[data-app="paint"] >> [aria-label="Redo"]');
  await page.click('.window[data-app="paint"] >> [aria-label="Redo"]');
  await page.waitForTimeout(200);
  assert.ok((await sample(mid.x, 90))[2] > 180, 'Redo must restore both undone strokes');

  /* A new stroke invalidates the redo branch — you cannot replay into a different drawing. */
  await page.click('.window[data-app="paint"] >> [aria-label="Undo"]');
  assert.equal((await disabled('Redo')).disabled, false, 'setup: Redo holds one step');
  await drawLine(60, 200, 200, 60);
  assert.equal((await disabled('Redo')).disabled, true, 'drawing again must discard the redo branch');

  /* Redo with nothing to redo says so instead of doing nothing silently. */
  await page.evaluate(() => document.getElementById('toasts').replaceChildren());
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#toasts'), /nothing to redo/i, 'an empty redo must be reported');

  await closeApp('paint');
});

test('a batch of files over the total import budget is refused with a clear message', async () => {
  await resetStorage();
  await openApp('files', { path: '/home/user/Downloads' });

  /* Two files each pass the per-file limit, but together they pass the batch budget. */
  const big = Buffer.alloc(2.6 * 1024 * 1024, 0x41);
  await page.setInputFiles('.window[data-app="files"] input[type="file"]', [
    { name: 'batch-1.txt', mimeType: 'text/plain', buffer: big },
    { name: 'batch-2.txt', mimeType: 'text/plain', buffer: big },
  ]);
  await page.waitForTimeout(900);
  assert.ok(await page.evaluate(() => window.browserOS.fs.exists('/home/user/Downloads/batch-1.txt')),
    'the first file fits the batch budget and must import');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/Downloads/batch-2.txt')), false,
    'the second file exceeds the remaining batch budget and must be refused');
  const toasts = await page.textContent('#toasts');
  assert.match(toasts, /budget/i, 'the refusal must name the batch budget');
  assert.match(toasts, /batch-2\.txt/, 'the refusal must name the file');

  await closeApp('files');
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/Downloads/batch-1.txt', '/', false));
});

test('storage headroom is measured, not guessed', async () => {
  await resetStorage();
  const before = await page.evaluate(() => ({
    cap: window.browserOS.store.capacity(),
    free: window.browserOS.store.headroom(),
    available: window.browserOS.store.available,
  }));
  assert.ok(before.available, 'this browser should offer localStorage');
  assert.ok(Number.isFinite(before.cap) && before.cap > 1024 * 1024, `the quota should be measurable, got ${before.cap}`);
  assert.ok(before.free > 0 && before.free <= before.cap, `free space must sit inside the measured capacity: ${before.free} of ${before.cap}`);

  /* Writing must reduce the free space without moving the measured ceiling. */
  await page.evaluate(() => window.browserOS.fs.write('/home/user/Downloads/filler.txt', 'x'.repeat(3 * 1024 * 1024), '/'));
  await page.waitForTimeout(400); // fs persistence is debounced
  const after = await page.evaluate(() => ({ cap: window.browserOS.store.capacity(), free: window.browserOS.store.headroom() }));
  assert.ok(after.free < before.free - 2 * 1024 * 1024,
    `writing 3 MB must shrink the measured free space (${before.free} → ${after.free})`);
  assert.ok(Math.abs(after.cap - before.cap) < 1024 * 1024,
    `the measured capacity must not drift when usage moves (${before.cap} → ${after.cap})`);

  /* The import limit tightens to what actually fits, instead of a constant that lies. */
  await openApp('files', { path: '/home/user/Downloads' });
  await page.setInputFiles('.window[data-app="files"] input[type="file"]', {
    name: 'no-room.txt', mimeType: 'text/plain', buffer: Buffer.alloc(2.5 * 1024 * 1024, 0x42),
  });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/Downloads/no-room.txt')), false,
    'a file larger than the remaining free space must be refused before it is read');
  const toasts = await page.textContent('#toasts');
  assert.match(toasts, /no-room\.txt/, 'the refusal must name the file');
  assert.match(toasts, /free/i, 'the refusal must say the space is not there');

  /* The Upload button must state the limit that really applies, not the documented one. */
  const title = await page.getAttribute('.window[data-app="files"] button:has-text("Upload")', 'title');
  assert.match(title, /of this browser's storage is free/, `the Upload button must admit the real limit: ${title}`);

  await closeApp('files');
  await page.evaluate(() => window.browserOS.fs.rm('/home/user/Downloads/filler.txt', '/', false));
});

test('touch: pinch zoom scales the image in the viewer', async () => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 640 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${server.url}/index.html`);
  await p.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const mk = (w, h, color) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
      return c.toDataURL('image/png');
    };
    window.browserOS.fs.write('/home/user/Pictures/pinch.png', mk(100, 80, '#ff00ff'), '/');
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('viewer', { data: { path: '/home/user/Pictures/pinch.png' } });
  });
  await p.waitForSelector('.viewer-main img');
  await p.waitForTimeout(500);

  const before = await p.evaluate(() => document.querySelector('.viewer-main img').getBoundingClientRect().width);
  await p.evaluate(() => {
    const main = document.querySelector('.viewer-main');
    const ev = (type, id, x, y) => main.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, isPrimary: id === 31, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
    ev('pointerdown', 31, 300, 300);
    ev('pointerdown', 32, 340, 300); // start 40px apart
    ev('pointermove', 31, 220, 300);
    ev('pointermove', 32, 420, 300); // end 200px apart → 5× zoom
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({
    width: document.querySelector('.viewer-main img').getBoundingClientRect().width,
    status: document.querySelector('.window[data-app="viewer"] .toolbar')?.textContent || '',
    touchAction: document.querySelector('.viewer-main').style.touchAction,
  }));
  assert.ok(after.width >= before * 4.5, `pinch-out should zoom in: ${Math.round(before)} → ${Math.round(after.width)}`);
  assert.match(after.status, /500%/, 'the status bar should report the pinch zoom level');
  assert.equal(after.touchAction, 'none', 'panning is locked only while pinching');

  /* Clamping: a wild pinch-out stops at 800%, a wild pinch-in stops at 10%. */
  await p.evaluate(() => {
    const main = document.querySelector('.viewer-main');
    const ev = (type, id, x, y) => main.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, isPrimary: false, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
    ev('pointermove', 31, -1680, 300);
    ev('pointermove', 32, 2320, 300); // 4000px apart → 100× if unclamped
  });
  await p.waitForTimeout(200);
  assert.match(await p.textContent('.window[data-app="viewer"] .toolbar'), /800%/, 'pinch-out must clamp at 800%');

  await p.evaluate(() => {
    const main = document.querySelector('.viewer-main');
    const ev = (type, id, x, y) => main.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, isPrimary: false, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
    ev('pointermove', 31, 319, 300);
    ev('pointermove', 32, 321, 300); // 2px apart → ~0.4% if unclamped
  });
  await p.waitForTimeout(200);
  assert.match(await p.textContent('.window[data-app="viewer"] .toolbar'), /10%/, 'pinch-in must clamp at 10%');

  await p.evaluate(() => {
    const main = document.querySelector('.viewer-main');
    for (const id of [31, 32]) main.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: id, bubbles: true }));
  });
  await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => document.querySelector('.viewer-main').style.touchAction), '', 'one finger can scroll again after the pinch');

  await p.evaluate(() => { window.browserOS.fs.rm('/home/user/Pictures/pinch.png', '/', false); });
  assert.deepEqual(errs, [], `touch session logged errors: ${errs.join('\n')}`);
  await ctx.close();
});

test('touch: pinch zoom keeps the point between your fingers between your fingers', async () => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 640 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${server.url}/index.html`);
  await p.waitForFunction(() => window.browserOS, null, { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#ff0000'; g.fillRect(540, 260, 60, 60); // a detail near the bottom-right
    window.browserOS.fs.write('/home/user/Pictures/pinch-anchor.png', c.toDataURL('image/png'), '/');
    for (const w of [...window.browserOS.wm.windows.values()]) window.browserOS.wm.close(w.id);
    window.browserOS.launch('viewer', { data: { path: '/home/user/Pictures/pinch-anchor.png' } });
  });
  await p.waitForSelector('.viewer-main img');
  await p.waitForTimeout(500);

  /* Pinch 2× with the midpoint over the red detail (80% across, 70% down the image). */
  const res = await p.evaluate(() => {
    const main = document.querySelector('.viewer-main');
    const img = main.querySelector('img');
    const r0 = img.getBoundingClientRect();
    const mid = { x: r0.left + r0.width * 0.8, y: r0.top + r0.height * 0.7 };
    const ev = (type, id, x, y) => main.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, isPrimary: id === 51, button: 0, clientX: x, clientY: y, bubbles: true,
    }));
    ev('pointerdown', 51, mid.x - 20, mid.y);
    ev('pointerdown', 52, mid.x + 20, mid.y);
    ev('pointermove', 51, mid.x - 40, mid.y);
    ev('pointermove', 52, mid.x + 40, mid.y); // 2× pinch, midpoint unmoved
    const r1 = img.getBoundingClientRect();
    const out = {
      before: { left: r0.left, top: r0.top, w: r0.width },
      after: { left: r1.left, top: r1.top, w: r1.width },
      mid, scroll: main.scrollLeft,
    };
    for (const id of [51, 52]) main.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: id, bubbles: true }));
    return out;
  });

  const f = res.after.w / res.before.w;
  assert.ok(f > 1.8, `the pinch should roughly double the scale, got ${f.toFixed(2)}`);
  const wantLeft = res.mid.x - (res.mid.x - res.before.left) * f;
  assert.ok(Math.abs(res.after.left - wantLeft) <= 3,
    `the content under the pinch midpoint must stay there: expected left ${wantLeft.toFixed(1)}, got ${res.after.left.toFixed(1)}`);
  assert.ok(res.scroll > 50, `anchoring must actually scroll the zoomed image, scrollLeft=${res.scroll}`);

  await p.evaluate(() => { window.browserOS.fs.rm('/home/user/Pictures/pinch-anchor.png', '/', false); });
  assert.deepEqual(errs, [], `touch session logged errors: ${errs.join('\n')}`);
  await ctx.close();
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
