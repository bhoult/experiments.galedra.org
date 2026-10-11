import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALLPAPERS, wallpaperColors, wallpaperInkFromSamples, wallpaperCss } from '../src/core/theme.js';
import { contrastRatio, hexToRgb, mixOver, rgbaOf } from '../src/core/utils.js';

/**
 * Ink on the wallpaper.
 *
 * The desktop's icon labels are drawn straight onto the wallpaper: no card behind them, no
 * `--surface` to inherit a contrast guarantee from. The wallpaper is a user setting with eight
 * presets and an upload-your-own, so "which ink is readable here?" cannot be answered by the
 * theme — it has to be answered by the wallpaper. `wallpaperColors` measures it.
 *
 * The bug this exists for: the labels used `--text`, which is dark ink in the light theme, and
 * the default wallpaper is dark. That is 1.4:1, which is not text.
 */

const ratio = contrastRatio;

/* The local hexToRgb / channel / lum / ratio quartet used to live here as well as in
   src/core/utils.js and in tests/browser/measure.mjs. "One contrast formula" is only true if
   the files that assert contrast import it; three copies of a formula is how a test starts
   passing for a colour the app would fail. */

test('every shipped wallpaper gets ink that reads on all of it', () => {
  for (const wp of WALLPAPERS) {
    const ink = wallpaperColors(wp.css);
    const colors = wp.css.match(/#[0-9a-f]{6}/gi);
    const worst = Math.min(...colors.map((c) => ratio(hexToRgb(ink.text), hexToRgb(c))));
    assert.ok(worst >= 4.5,
      `${wp.id}: the ink ${ink.text} reaches only ${worst.toFixed(2)}:1 against ${colors.join(' ')} — a label needs 4.5:1`);
    assert.equal(ink.ratio, +worst.toFixed(2), `${wp.id}: the reported worst point must be the real worst point`);
  }
});

test('a light wallpaper gets dark ink and a dark one gets light ink', () => {
  assert.equal(wallpaperColors('linear-gradient(140deg, #16213e 0%, #0f3460 45%, #1a1a2e 100%)').text, '#e9edf7',
    'Aurora (the default) is dark: the labels must be light');
  assert.equal(wallpaperColors('linear-gradient(160deg, #e9edf5 0%, #d7deea 60%, #c3cddd 100%)').text, '#16202f',
    'Paper is light: the labels must be dark');
  assert.equal(wallpaperColors('#ffffff').text, '#16202f');
  assert.equal(wallpaperColors('#000000').text, '#e9edf7');
});

test('the choice is made against the worst point of the gradient, not the average', () => {
  /* A wallpaper that is mostly near-white with one mid-tone blue corner — a plausible upload.
     Light ink is worst *at the light stops*, which are most of the surface (1.03:1); dark ink
     is worst at the darkest stop and still 6.6:1 there. An average, or "which half is bigger",
     would pick light ink; the worst point picks the ink that is never unreadable. */
  const css = 'linear-gradient(140deg, #f2f5fa 0%, #e3eaf4 55%, #8fa6c8 100%)';
  const ink = wallpaperColors(css);
  assert.equal(ink.text, '#16202f');
  const worst = Math.min(...css.match(/#[0-9a-f]{6}/gi).map((c) => ratio(hexToRgb(ink.text), hexToRgb(c))));
  assert.equal(ink.ratio, +worst.toFixed(2), 'the reported ratio is the worst point, not a mean');
});

test('a wallpaper with no measurable colours keeps the default ink instead of guessing', () => {
  for (const css of ['', null, undefined, 'url(/img/photo.jpg)', 'linear-gradient(140deg, rgba(0,0,0,.5), rgba(255,255,255,.5))']) {
    const ink = wallpaperColors(css);
    assert.equal(ink.text, '#e9edf7', `unmeasurable wallpaper ${JSON.stringify(css)} must fall back, not invent`);
    assert.equal(ink.ratio, null, 'and must say that it did not measure anything');
    assert.ok(ink.shadow, 'the shadow still has to be a shadow');
  }
});

test('the ink pair is a matched pair: a light shadow only with dark ink', () => {
  for (const wp of WALLPAPERS) {
    const ink = wallpaperColors(wp.css);
    const lightInk = ink.text === '#e9edf7';
    assert.match(ink.shadow, lightInk ? /rgba\(0, 0, 0/ : /rgba\(255, 255, 255/,
      `${wp.id}: ${ink.text} on this wallpaper needs a ${lightInk ? 'dark' : 'light'} halo, got ${ink.shadow}`);
  }
});

test('measuring painted samples and measuring the CSS string agree — the string is only a shortcut', () => {
  /* `wallpaperInkFromRendered` (browser-only) reads the pixels; `wallpaperColors` reads the
     gradient's stops. They must not become two rules with two answers: the samples path is what
     a custom wallpaper takes, and it is the one that has to keep agreeing. */
  for (const wp of WALLPAPERS) {
    const fromCss = wallpaperColors(wp.css);
    const stops = wp.css.match(/#[0-9a-f]{6}/gi).map((h) => hexToRgb(h));
    const fromSamples = wallpaperInkFromSamples(stops);
    assert.equal(fromSamples.text, fromCss.text, `${wp.id}: the two routes chose different inks`);
    assert.equal(fromSamples.ratio, fromCss.ratio, `${wp.id}: the two reported different ratios`);
  }
});

test('samples are what a custom wallpaper would produce: a pale photo gets dark ink, a dark one gets light', () => {
  /* No CSS string to read here — these are pixels, which is all an uploaded wallpaper offers. */
  const pale = [[240, 243, 248], [232, 238, 246], [225, 232, 242]];
  const dark = [[18, 24, 38], [24, 32, 48], [30, 40, 58]];
  assert.equal(wallpaperInkFromSamples(pale).text, '#16202f');
  assert.equal(wallpaperInkFromSamples(dark).text, '#e9edf7');
  assert.equal(wallpaperInkFromSamples([]).ratio, null, 'no samples is not a measurement');
  assert.equal(wallpaperInkFromSamples(null).text, '#e9edf7');
});

test('a wallpaper setting is turned into something CSS can actually be told', () => {
  /* An upload arrives as a bare data URL. A bare data URL is not a valid `background` value:
     the parser rejects it and the element silently keeps the old wallpaper — which is how
     "Use your own image…" appeared to do nothing at all. */
  const data = 'data:image/png;base64,iVBORw0KGg==';
  assert.equal(wallpaperCss(data), `url("${data}")`);
  assert.equal(wallpaperCss('https://example.com/x.png'), 'url("https://example.com/x.png")');
  assert.equal(wallpaperCss('/img/x.png'), 'url("/img/x.png")');
  assert.equal(wallpaperCss(`url("${data}")`), `url("${data}")`, 'already CSS is left alone');
  assert.equal(wallpaperCss('linear-gradient(#123456, #654321)'), 'linear-gradient(#123456, #654321)');
  assert.equal(wallpaperCss(''), null);
  assert.equal(wallpaperCss(null), null);
});

/* ---------- the plate: what happens when neither ink reads ----------
   Two inks can only ever be a light one and a dark one. A wallpaper that is mid-tone *all the
   way across* — a photograph of a brick wall, a grey interior — fails both: the light ink is
   3.5:1 and the dark ink is 4.3:1, and picking "the less bad one" is not a fix. The plate is
   the fix, and the ratio reported has to be the one measured *through* it. */
test('a mid-tone wallpaper gets a plate rather than the less bad ink', () => {
  /* Every sample sits at luminance ~0.21: light ink 3.4:1, dark ink 4.3:1. Both below the bar. */
  const mid = [[125, 133, 142], [120, 128, 137], [130, 138, 147]];
  const ink = wallpaperInkFromSamples(mid);
  assert.ok(ink.plate, 'a wallpaper no ink reads on has to be answered with something other than an ink');
  assert.ok(ink.ratio >= 4.5, `the plate has to actually work: measured ${ink.ratio}:1`);
  /* The reported number is the composited one, not the ink-on-the-wallpaper one. */
  const layer = rgbaOf(ink.plate);
  const worst = Math.min(...mid.map((bg) => contrastRatio(hexToRgb(ink.text), mixOver(bg, layer))));
  assert.equal(ink.ratio, +worst.toFixed(2), 'the ratio Settings shows must be the ratio the plate produces');
});

test('a wallpaper that already reads gets no plate — the plate is not decoration', () => {
  for (const wp of WALLPAPERS) {
    const ink = wallpaperColors(wp.css);
    assert.equal(ink.plate, null, `${wp.id}: measured ${ink.ratio}:1, so nothing may be painted behind the label`);
  }
  assert.equal(wallpaperInkFromSamples([[18, 24, 38]]).plate, null);
  assert.equal(wallpaperInkFromSamples([[240, 243, 248]]).plate, null);
});

test('the plate is the ink\'s own plate: light ink gets a dark one, dark ink gets a light one', () => {
  /* Two mid-tones, one on each side of the crossover. Both fail the bar with both inks, so both
     need a plate — and the plate that helps light ink (near-black) is the opposite of the one
     that helps dark ink (near-white). A pairing that got flipped would still "improve" one of
     these and ruin the other, which is why both directions are asserted. */
  const darkerMid = [[110, 114, 120], [112, 116, 122]];      /* light ink 4.01, dark ink 3.39 */
  const lighterMid = [[125, 133, 142], [120, 128, 137]];     /* light ink 3.19, dark ink 4.09 */
  for (const [samples, inkText, plateRe] of [
    [darkerMid, '#e9edf7', /rgba\(6, 10, 18/],
    [lighterMid, '#16202f', /rgba\(252, 253, 255/],
  ]) {
    const ink = wallpaperInkFromSamples(samples);
    assert.equal(ink.text, inkText, 'the better of the two inks is still the one picked');
    assert.ok(ink.plate, `both inks are under the bar here (${ink.ratio}:1), so a plate is required`);
    assert.match(ink.plate, plateRe, `${inkText} needs the ${inkText === '#e9edf7' ? 'dark' : 'light'} plate`);
    const layer = rgbaOf(ink.plate);
    const bare = Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), bg)));
    const plated = Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), mixOver(bg, layer))));
    assert.ok(bare < 4.5, `the setup of this test is the whole point: ${inkText} reads on this at ${bare.toFixed(2)}:1`);
    assert.ok(plated > bare, `the plate has to make it better, not merely different (${bare.toFixed(2)} → ${plated.toFixed(2)})`);
    assert.equal(ink.ratio, +plated.toFixed(2), 'and the number it reports is the plated one');
  }
});

/* ---------- the plate's strength ----------
   A fixed alpha is a guess about the wallpaper. A wallpaper that misses the bar by two tenths and
   one that misses by two points cannot both need the same slab, and the stronger of the two
   guesses paints a grey sheet over a desktop that needed a whisper. The alpha is solved for. */
test('the plate is as strong as the problem is, and no stronger', () => {
  /* A ladder of greys, all of them needing the light ink, from a near-miss to a bad one. */
  const ladder = [108, 112, 116].map((g) => [[g, g + 4, g + 10]]);
  const results = ladder.map((samples) => {
    const ink = wallpaperInkFromSamples(samples);
    assert.equal(ink.text, '#e9edf7', `${samples[0][0]}: the light ink is still the better of the two`);
    assert.ok(ink.plate, `${samples[0][0]}: below the bar, so a plate is required`);
    const layer = rgbaOf(ink.plate);
    const [r, g, b, a] = layer;
    const worstWith = (alpha) => Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), mixOver(bg, [r, g, b, alpha]))));
    assert.ok(worstWith(a) >= 4.5, `${samples[0][0]}: the plate chosen has to reach the bar (${worstWith(a).toFixed(2)}:1)`);
    assert.ok(worstWith(Math.max(0, a - 0.01)) < 4.5,
      `${samples[0][0]}: a plate one step weaker also works, so this one is not the weakest (${a})`);
    return a;
  });
  assert.ok(results[0] < results[1], `a near-miss must not get the same plate as a worse one: ${results.join(' ≥ ')}`);
  assert.ok(results[1] <= results[2], `strength has to follow the shortfall: ${results.join(' ≥ ')}`);
  assert.ok(results[0] <= 0.1, `a wallpaper that misses by 0.25:1 gets a whisper of a plate, not a slab (got ${results[0]})`);
});

test('every plate that is ever chosen is measured, capped, and only ever for a real shortfall', () => {
  /* A deterministic sweep over wallpapers nobody designed: multi-stop gradients, near-neutrals,
     noisy photos. The claim being tested is not "these look nice" — it is that the number the
     theme reports is the number the plate produces, for every wallpaper the code can be handed. */
  let seed = 12345;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 * n;
  let plated = 0;
  for (let i = 0; i < 400; i++) {
    const base = rnd(256);
    const spread = i % 3 === 0 ? 12 : 90;          /* some near-neutral, some all over the place */
    const samples = Array.from({ length: 6 }, () =>
      [base, base + rnd(spread) - spread / 2, base + rnd(spread) - spread / 2].map((c) => Math.max(0, Math.min(255, Math.round(c)))));
    const ink = wallpaperInkFromSamples(samples);
    const bare = Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), bg)));
    if (!ink.plate) { assert.ok(bare >= 4.5, `no plate offered, so the ink has to read on its own: ${bare.toFixed(2)}:1`); continue; }
    plated++;
    const [r, g, b, a] = rgbaOf(ink.plate);
    assert.ok(a > 0 && a <= 0.9, `a plate past 0.9 is a panel, not a plate: ${ink.plate}`);
    assert.ok(bare < 4.5, `a plate was painted where none was needed (bare ${bare.toFixed(2)}:1)`);
    const withPlate = Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), mixOver(bg, [r, g, b, a]))));
    assert.ok(withPlate > bare, `the plate has to help (${bare.toFixed(2)} → ${withPlate.toFixed(2)})`);
    assert.equal(ink.ratio, +withPlate.toFixed(2), 'the reported ratio is the measured one, bar or no bar');
    /* A plate exists to make the label readable. If a future change caps it below what a wallpaper
       needs, this is the assertion that says so, rather than a test that quietly skips the case. */
    assert.ok(withPlate >= 4.5, `a plate was painted and the label still does not read: ${withPlate.toFixed(2)}:1 at alpha ${a}`);
  }
  assert.ok(plated > 20, `this sweep is only a test if it actually finds wallpapers that need a plate (${plated} did)`);
});

test('a plate is never stronger than the fixed guess it replaces', () => {
  /* The old code guessed: .62 for a dark plate, .74 for a light one, for every wallpaper that
     needed one. The derived alpha has to stay under that, or this change made the desktop worse
     in exchange for making it more correct — and a wallpaper that spans near-black to near-white,
     which is the hardest case there is, is where a search that overshot would show up. */
  const OLD_FIXED_ALPHA = { '#e9edf7': 0.62, '#16202f': 0.74 };
  const hard = [
    [[255, 255, 255], [0, 0, 0]],
    [[250, 251, 252], [8, 9, 11]],
    [[128, 128, 128], [127, 128, 129], [129, 130, 131]],
    [[200, 205, 210], [40, 42, 46]],
  ];
  for (const samples of hard) {
    const ink = wallpaperInkFromSamples(samples);
    assert.ok(ink.plate, `these span the range, so a plate is required (${ink.ratio}:1)`);
    const [, , , a] = rgbaOf(ink.plate);
    const old = OLD_FIXED_ALPHA[ink.text];
    assert.ok(a < old, `${JSON.stringify(samples[0])}→${JSON.stringify(samples[1])}: derived ${a}, the old guess was ${old}`);
    const withPlate = Math.min(...samples.map((bg) => contrastRatio(hexToRgb(ink.text), mixOver(bg, rgbaOf(ink.plate)))));
    assert.ok(withPlate >= 4.5, `and the weaker plate still has to finish the job: ${withPlate.toFixed(2)}:1`);
  }
});

test('mixOver and rgbaOf: the compositing the plate claim rests on', () => {
  assert.deepEqual(mixOver([0, 0, 0], [255, 255, 255, 1]), [255, 255, 255], 'an opaque layer replaces what is under it');
  assert.deepEqual(mixOver([200, 100, 50], [0, 0, 0, 0]), [200, 100, 50], 'a transparent layer changes nothing');
  assert.deepEqual(mixOver([200, 100, 50], [0, 0, 0, 0.5]), [100, 50, 25], 'half of each');
  assert.deepEqual(rgbaOf('rgba(6, 10, 18, .62)'), [6, 10, 18, 0.62]);
  assert.deepEqual(rgbaOf('rgb(1 2 3 / 40%)'), [1, 2, 3, 0.4], 'the modern syntax is the one CSS writes back');
  assert.deepEqual(rgbaOf('#ff5f6d'), [255, 95, 109, 1], 'a hex is an opaque colour');
  assert.equal(rgbaOf('transparent'), null, 'something that is not a colour is not a plate');
});
