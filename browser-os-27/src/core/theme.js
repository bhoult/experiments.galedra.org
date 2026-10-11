import { debounce, paintCssBackground, contrastRatio, hexToRgb, mixOver } from './utils.js';

/* Wallpapers are a user setting, and the desktop's labels are drawn straight on them — so each
   preset is chosen so that the ink `wallpaperColors` picks clears 4.5:1 against every stop of
   its own gradient. Dusk used to end at #7597de (2.5:1) and Sunset at #f6a94a (1.7:1): pretty
   gradients with unreadable desktop labels. */
export const WALLPAPERS = [
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(140deg, #16213e 0%, #0f3460 45%, #1a1a2e 100%)' },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(160deg, #2b1055 0%, #3f5f9e 100%)' },
  { id: 'forest', label: 'Forest', css: 'linear-gradient(150deg, #0b2b1e 0%, #1f5c3d 55%, #0b2b1e 100%)' },
  { id: 'sunset', label: 'Sunset', css: 'linear-gradient(160deg, #2d1b4e 0%, #b23a48 55%, #8f5a22 100%)' },
  { id: 'slate', label: 'Slate', css: 'linear-gradient(150deg, #1b1f2a 0%, #2f3646 60%, #1b1f2a 100%)' },
  { id: 'grid', label: 'Grid', css: 'linear-gradient(180deg, #0d1117 0%, #101826 100%), repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 48px)' },
  { id: 'paper', label: 'Paper', css: 'linear-gradient(160deg, #e9edf5 0%, #d7deea 60%, #c3cddd 100%)' },
  { id: 'candy', label: 'Candy', css: 'linear-gradient(140deg, #ff9a9e 0%, #fad0c4 40%, #a1c4fd 100%)' },
];

export const ACCENTS = [
  { id: 'blue', label: 'Blue', css: '#4f8cff' },
  { id: 'violet', label: 'Violet', css: '#a06bff' },
  { id: 'teal', label: 'Teal', css: '#21c7b8' },
  { id: 'amber', label: 'Amber', css: '#f2a33c' },
  { id: 'rose', label: 'Rose', css: '#ff5f8f' },
  { id: 'lime', label: 'Lime', css: '#7ac94a' },
];

const DEFAULTS = {
  theme: 'dark',
  accent: 'blue',
  wallpaper: 'aurora',
  customWallpaper: null,
  icons: true,
};

/* ---------- reading on the wallpaper ----------
   The desktop's labels, and anything else drawn directly on the wallpaper, are not drawn on a
   surface: there is no card behind them, no `--surface` to inherit a contrast guarantee from.
   The wallpaper is a user setting with eight presets and an upload-your-own, so the only honest
   way to pick the ink is to measure the wallpaper. `wallpaperColors` does exactly that — it reads
   the solid colours out of the gradient CSS and picks the pair (ink, shadow) whose *worst* point
   on the gradient is the most readable.
   Before this, the desktop labels used `--text`, which is dark ink in the light theme: on the
   default dark wallpaper that measured 1.4:1, i.e. text nobody can read. */
const INK_ON_WALLPAPER = [
  { text: '#e9edf7', shadow: '0 1px 3px rgba(0, 0, 0, .75)' },
  { text: '#16202f', shadow: '0 1px 2px rgba(255, 255, 255, .9)' },
];

/* The WCAG bar for body text, and the last resort when no ink clears it.
   Two inks can only ever be a light one and a dark one, so a wallpaper that is *mid-tone all
   the way across* — a photograph of a brick wall, a beige interior — is served by the less bad
   ink at 3:1 or 4:1 no matter which is picked. A translucent plate behind the label is what
   actually fixes that; `plateFor` gives each ink the plate that helps it, at the weakest alpha
   that actually clears the bar on the wallpaper in front of it, and the ratio that
   gets reported is measured against the composited pixels, not claimed. */
const MIN_INK_RATIO = 4.5;
/* The plate's *colour* is fixed per ink — a dark plate under a light ink, a light one under a
   dark ink. Its alpha is not: it is solved for. A fixed .62 is what the mid-grey test wallpaper
   happens to need, and it is far more than a wallpaper that misses the bar by two tenths needs;
   a plate that is stronger than the problem paints a grey slab over someone's desktop to fix a
   problem that was not there. `plateAlphaFor` searches for the weakest plate that clears the bar
   on *this* wallpaper, and stops at MAX_PLATE_ALPHA because past that it is a panel, not a plate. */
const PLATE_TINT = {
  '#e9edf7': [6, 10, 18],
  '#16202f': [252, 253, 255],
};
const MAX_PLATE_ALPHA = 0.9;

/** The weakest alpha of `tint` that lifts every background to the bar; if none does, the
 * strongest plate allowed, because a plate that only gets part way there is still better than a
 * label nobody can read — and the ratio reported afterwards is the measured one, bar or no bar. */
function plateAlphaFor(inkRgb, tint, backgrounds) {
  const worstAt = (a) => Math.min(...backgrounds.map((bg) => contrastRatio(inkRgb, mixOver(bg, [...tint, a]))));
  if (worstAt(MAX_PLATE_ALPHA) < MIN_INK_RATIO) return MAX_PLATE_ALPHA;
  /* Contrast only improves as more of a plate that is on the ink's side goes down, so the
     predicate is monotone and a bisection finds the boundary rather than guessing at it. */
  let lo = 0, hi = MAX_PLATE_ALPHA;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (worstAt(mid) >= MIN_INK_RATIO) hi = mid; else lo = mid;
  }
  return Math.ceil(hi * 100) / 100;   // round up: never claim a plate weaker than the one measured
}

function plateFor(inkRgb, tint, backgrounds) {
  const alpha = plateAlphaFor(inkRgb, tint, backgrounds);
  if (alpha === null) return null;
  return { css: `rgba(${tint.join(', ')}, ${alpha.toFixed(2)})`, alpha };
}

export function wallpaperColors(css) {
  const colors = String(css || '').match(/#[0-9a-f]{6}/gi) || [];
  /* A wallpaper with no readable colours in it (a plain image, a `url()`) keeps the default ink,
     which is the one the presets were designed against. */
  if (!colors.length) return { text: INK_ON_WALLPAPER[0].text, shadow: INK_ON_WALLPAPER[0].shadow, ratio: null, plate: null };
  return wallpaperInkFromSamples(colors.map(hexToRgb));
}

/** The same decision, made from *samples* instead of from a CSS string: the colours actually
   painted, wherever they came from — a gradient, a photo, a solid colour. */
export function wallpaperInkFromSamples(samples) {
  const bgs = (samples || []).filter((c) => Array.isArray(c) && c.length >= 3);
  if (!bgs.length) return { text: INK_ON_WALLPAPER[0].text, shadow: INK_ON_WALLPAPER[0].shadow, ratio: null, plate: null };
  let best = null;
  for (const ink of INK_ON_WALLPAPER) {
    const rgb = hexToRgb(ink.text);
    const worst = Math.min(...bgs.map((bg) => contrastRatio(rgb, bg)));
    if (!best || worst > best.ratio) best = { text: ink.text, shadow: ink.shadow, ratio: +worst.toFixed(2), plate: null };
  }
  if (best.ratio >= MIN_INK_RATIO) return best;

  /* Nothing reads on this wallpaper directly. Try the plate, and measure it: the number that
     gets reported is the contrast of the ink against the pixels the plate actually paints.
     If the plate does not help (it cannot, on a wallpaper that is already darker than the
     plate), `plate` stays null and the honest low number is reported instead. */
  const tint = PLATE_TINT[best.text];
  if (!tint) return best;
  const plate = plateFor(hexToRgb(best.text), tint, bgs);
  if (!plate) return best;
  const plated = bgs.map((bg) => mixOver(bg, [...tint, plate.alpha]));
  const worstPlated = Math.min(...plated.map((bg) => contrastRatio(hexToRgb(best.text), bg)));
  if (worstPlated <= best.ratio) return best;
  return { ...best, ratio: +worstPlated.toFixed(2), plate: plate.css };
}

/** Paint the wallpaper the way the browser would and read it back at nine points. This is the
   version that works for a *custom* wallpaper — an uploaded photo has no colours to read out of
   a CSS string, and the default ink chosen for gradients is exactly the wrong answer for a pale
   photograph. */
export function wallpaperInkFromRendered(css, w, h) {
  try {
    /* Measuring the colours that are *present* does not need the wallpaper at screen size: a
       gradient paints the same set of colours at 640px as it does at 4K, and reading back 8M
       pixels to find out which colours they are is the expensive half of a theme change. The cap
       is on the canvas, not on the reading — `sampleCanvas` below looks at every pixel of whatever
       canvas it is given. */
    const scale = Math.min(1, 640 / Math.max(1, w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!paintCssBackground(ctx, css, canvas.width, canvas.height)) return null;   // a url(): not paintable from a string
    const samples = sampleCanvas(ctx, canvas.width, canvas.height);
    return samples.length ? wallpaperInkFromSamples(samples) : null;
  } catch { return null; }
}

/* The sRGB linearisation `relLuminance` uses, as a 256-entry table. Reading a wallpaper is a loop
   over every pixel in it, and `** 2.4` three times per pixel is the difference between a
   measurement that costs milliseconds and one that blocks the desktop while it thinks. */
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lumaOf = (r, g, b) => 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
const LUMA_BANDS = 128;
/* Eight bands to the octave, starting at 0.0002 and covering the whole 0–1 range in 101 of them.
   Evenly spaced bands are exact at the top of the range and useless at the bottom: every colour of
   a dark wallpaper fits inside the first one, which is the half of the range a dark ink is read
   against. Logarithmic bands make the promise the same everywhere — no colour is more than about 9%
   of luminance away from a sample — and 9% is a number the worst-contrast claim can be stated in. */
const bandOf = (l) => Math.max(0, Math.min(LUMA_BANDS - 1, Math.round(8 * Math.log2(Math.max(l, 1e-6) / 0.0002))));

/** Read every pixel of a painted canvas and keep the colours that can decide the answer.
   A grid — nine points, then thirty-two — is a *sampling* of the wallpaper, and it has the same
   failure however fine it is: a detail smaller than the step is invisible to the measurement, so a
   4K photograph in a 400px window is still read at 32 points across it, and the ink gets chosen
   against a wallpaper that is not the one on screen.
   What the decision actually needs is not many points, it is the *right* points. Contrast against a
   given ink depends only on how close the background's luminance is to that ink's, so the colours
   that can change the answer are the extremes and the ones near the ink — never the middle of a
   smooth wash. Looking at every pixel and keeping the darkest and lightest colour in each luminance
   band keeps all of them, at any resolution, for one `getImageData` and one loop. */
export function sampleCanvas(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const lo = new Array(LUMA_BANDS).fill(null);
  const hi = new Array(LUMA_BANDS).fill(null);
  const loL = new Array(LUMA_BANDS).fill(Infinity);
  const hiL = new Array(LUMA_BANDS).fill(-1);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const l = lumaOf(r, g, b);
    const band = bandOf(l);
    const rgb = [r, g, b];
    /* The two ends of each band, not one point from it: the worst case for a light ink is the
       brightest colour in a band and the worst case for a dark ink is the darkest, and keeping one
       representative would make this sampler guess which ink it is being used for. */
    if (l < loL[band]) { loL[band] = l; lo[band] = rgb; }
    if (l > hiL[band]) { hiL[band] = l; hi[band] = rgb; }
  }
  const samples = [];
  for (let band = 0; band < LUMA_BANDS; band++) {
    if (lo[band]) samples.push(lo[band]);
    if (hi[band] && hi[band] !== lo[band]) samples.push(hi[band]);
  }
  return samples;
}

/** A wallpaper setting may arrive as a raw data URL (that is what an upload produces) or as CSS
   that already says `url(...)`. A bare data URL is not a valid `background` value — the CSS
   parser rejects it and the element keeps whatever it had before, silently. So: wrap it, and say
   which one it became, rather than hoping the string was already in the right shape. */
export function wallpaperCss(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^(data:|https?:|\/)/i.test(v) && !/^url\(/i.test(v)) return `url("${v}")`;
  return v;
}

export class Theme {
  constructor(bus, store) {
    this.bus = bus;
    this.store = store;
    this.settings = { ...DEFAULTS, ...(store.load('settings') || {}) };
    this.save = debounce(() => store.save('settings', this.settings), 150);
    this.wallpaperEl = document.getElementById('wallpaper');
    this.apply();
  }

  apply() {
    const root = document.documentElement;
    root.dataset.theme = this.settings.theme;
    root.dataset.accent = this.settings.accent;
    const custom = wallpaperCss(this.settings.customWallpaper);
    const preset = WALLPAPERS.find((w) => w.id === this.settings.wallpaper) || WALLPAPERS[0];
    this.wallpaperEl.style.background = custom || preset.css;
    this.wallpaperEl.style.backgroundSize = 'cover';
    this.wallpaperEl.style.backgroundPosition = 'center';
    /* The ink is chosen from the wallpaper that is actually on screen, not from the theme: a
       reader who picks "Paper" on the dark theme gets dark ink, and one who picks "Aurora" on
       the light theme gets light ink, which is the opposite of what a theme switch alone says. */
    const css = custom || preset.css;
    this.wallpaperInkRatio = null;   // a measurement from the previous wallpaper is not this one
    this.wallpaperPlate = null;
    const ink = wallpaperInkFromRendered(css, this.wallpaperEl.clientWidth, this.wallpaperEl.clientHeight)
      || wallpaperColors(css);
    this.#publishInk(ink);
    /* A `url()` wallpaper — an upload, or anything else the canvas cannot paint from a string —
       has no colours to read out of CSS. Load it and measure the pixels instead; until then the
       fallback ink is used, and `wallpaperInkRatio` stays null rather than claiming a number
       that was never measured. */
    if (/url\(/.test(css) && this.wallpaperInkRatio === null) {
      const img = new Image();
      img.onload = () => {
        try {
          /* Read the image at a reduced size: the answer is about which colours are *present*, and
             512px of a photograph keeps every luminance band a wallpaper can have while keeping the
             read at a fraction of a millisecond-scale cost. Reading a 4K upload at 4K would be the
             same answer, slower. */
          const scale = Math.min(1, 512 / Math.max(1, img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.naturalWidth || 64) * scale));
          canvas.height = Math.max(1, Math.round((img.naturalHeight || 64) * scale));
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const samples = sampleCanvas(ctx, canvas.width, canvas.height);
          if (!samples.length) return;
          const fromImage = wallpaperInkFromSamples(samples);
          if (wallpaperCss(this.settings.customWallpaper) === css) {   // still the wallpaper on screen — not a newer one
            this.#publishInk(fromImage);
          }
        } catch { /* a tainted canvas (a cross-origin image) cannot be read; keep the fallback */ }
      };
      img.src = css.match(/url\(["']?([^"')]+)["']?\)/)?.[1] || css;
      img.decoding = 'async';
    }
  }

  /** One place writes the ink decision to the document, and one place announces it. Settings
   * shows the number, so the measurement has to arrive there whenever it changes — including
   * the asynchronous one for an uploaded image, which lands after the settings panel rendered. */
  #publishInk(ink) {
    const root = document.documentElement;
    root.style.setProperty('--wallpaper-text', ink.text);
    root.style.setProperty('--wallpaper-shadow', ink.shadow);
    root.style.setProperty('--wallpaper-plate', ink.plate || 'transparent');
    this.wallpaperInkRatio = ink.ratio;
    this.wallpaperPlate = ink.plate || null;
    this.bus.emit('wallpaper:ink', { text: ink.text, ratio: ink.ratio, plate: ink.plate || null });
  }

  set(key, value) {
    this.settings[key] = value;
    this.apply();
    this.save();
    this.bus.emit('settings:change', { key, value });
  }

  reset() {
    this.settings = { ...DEFAULTS };
    this.store.save('settings', this.settings);
    this.apply();
    this.bus.emit('settings:change', { key: null, value: null });
  }
}
