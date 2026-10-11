/* The rendered-text contrast audit.
 *
 * `tests/contracts.test.mjs` proves the *tokens* are right: `--ok-text` is defined in both theme
 * blocks, `--accent-text` is darkened for the light theme, and every `var(--x)` in os.css exists.
 * That is not the same claim as "the text on this screen is readable". An element can pick the
 * wrong pair, a 14% tint can sit under a text token measured against a plain surface, a
 * `color-mix` can compose to something neither test looked at, an `opacity: .72` can quietly take
 * a point and a half off a title bar, and a scrim can put a veil over the whole desktop.
 *
 * So this audit measures pixels. It takes two screenshots of the live page — one as it is, one
 * with every glyph fill made transparent (the *text-shadow* stays, because a shadow really is
 * painted behind the glyphs) — and for every visible run of text it asks, at the points where a
 * glyph is actually drawn: what colour is this ink, what is behind it, what is the ratio. Nothing
 * about the CSS is trusted: the background is whatever the browser composited, including gradients,
 * translucent surfaces, backdrop blur, plates and the window on top.
 *
 * Three details make the measurement honest rather than merely elaborate.
 *
 *  - The sample points are chosen in the page, by hit-testing a grid over each line box: a point
 *    counts only when the element that owns the text is the topmost thing there. Without that, a
 *    desktop label behind a maximized window is "measured" against the window's own pixels — the
 *    letters of the text *in front of it* make the two screenshots differ, and the audit reports a
 *    contrast for a label nobody can see. (It did, before this: 1.08:1 for a hidden icon label.)
 *  - Only points where the two screenshots differ are used to decide *what was painted*. A run
 *    where nothing was found is still judged — from its declared ink against the background that
 *    was measured under it — because "no glyph appeared at the sampled points" is also exactly what
 *    text the same colour as its background looks like. (That is how the terminal's `ls` output was
 *    missed for one run of this audit: near-black text on a near-black canvas, skipped as
 *    unpainted. It is counted in `skipped.unpainted` so the number is visible.)
 *  - The ink is the *specified* colour composited over that background, with the ancestor `opacity`
 *    folded into its alpha. A dimmed title bar is measured as the dim it renders as.
 *
 * Glyph-only runs are classified before they are measured. A monochrome glyph (`▢`, `✕`, a letter)
 * is drawn in the colour it was given, and WCAG judges that colour against the background; an
 * emoji is not one colour and its specified colour is a lie. The audit tells them apart by
 * geometry: a monochrome glyph's pixels all lie on the line between the background and the ink, an
 * emoji's do not. Monochrome runs are measured with the specified ink (so a thin, heavily
 * anti-aliased 13px glyph is judged on its colour, not on how much of a pixel it covers); colour
 * glyphs are measured from the strongest pixels actually painted.
 *
 * Three things are deliberately not held to the bar, and each one is counted in the result so a
 * page that hides everything cannot pass by hiding everything:
 *
 *  - Text behind a modal. A layer carrying `role="dialog"` makes everything under it inert.
 *  - Glyphs that have a name. WCAG 1.4.11 asks for contrast in a graphic *required* to understand
 *    the content; an icon next to the words it stands for is decoration. A glyph with no words
 *    near it — a calculator key, the show-desktop arrow — is measured like any other text.
 *  - Disabled controls, which WCAG 1.4.3 exempts.
 */
import assert from 'node:assert/strict';
import { decodePng } from './png.mjs';
import { contrastRatio, mixOver } from '../src/core/utils.js';

/* WCAG 1.4.3: 4.5:1 for body text, 3:1 for large text (24px, or 18.5px bold). A glyph run is an
   icon, and 3:1 is the bar non-text content gets (1.4.11). */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;
export const AA_GLYPH = 3.0;

/* A point counts as "a glyph is here" when hiding the text visibly changed the pixel. Anti-aliased
   edges move a pixel by a few units; 16 is comfortably past that and still catches thin strokes.
   The two numbers inside `collectInPage` are not constants of this module on purpose: Playwright
   serialises that function into the page, and a helper that stayed behind is a ReferenceError. */
const INK_DIFF = 16;

const HIDE_CSS = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; }';

function collectInPage({ roots }) {
  const describe = (el) => {
    const cls = String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const path = [];
    for (let n = el; n && n !== document.documentElement && path.length < 4; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      path.unshift(`${tag}${n.id ? `#${n.id}` : ''}${n === el && cls ? `.${cls}` : ''}`);
    }
    return path.join(' > ');
  };

  const parseColor = (s) => {
    const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/.exec(String(s || ''));
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    return null;
  };

  const runs = [];
  let named = 0;
  for (const rootSel of roots) {
    const root = document.querySelector(rootSel);
    if (!root) continue;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own.length) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;

      /* Walk up once: visibility, opacity and the disabled state are all inherited facts about
         this run, and `getComputedStyle` on the run's own element does not report them. */
      let opacity = 1, hidden = false, disabled = false;
      for (let n = el; n; n = n.parentElement) {
        const s = n === el ? cs : getComputedStyle(n);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') { hidden = true; break; }
        opacity *= Number(s.opacity);
        if (!disabled && n.matches('[disabled], [aria-disabled="true"]')) disabled = true;
        if (n === document.body) break;
      }
      if (hidden || opacity <= 0) continue;

      const color = parseColor(cs.color);
      if (!color) continue;

      /* The elements between this text and whatever is on top of it, if anything. A window over a
         desktop label is a cover; the dialog scrim is a *veil*, and text under a veil is still
         text — the honest measurement is the veiled one, which is what the pixels say. */
      const ownChain = new Set();
      for (let n = el; n; n = n.parentElement) ownChain.add(n);

      /* WCAG 1.4.11 asks for contrast in a graphic that is *required* to understand the content.
         An icon that sits next to the words it stands for — a Start menu row, a taskbar button, a
         desktop icon with a caption, a file row with a filename — is decoration, and the words are
         what carries the information. A glyph with no name anywhere near it is the only thing
         saying what it is, and that one is measured like any other text. */
      const hasName = (textNode) => {
        const words = (s) => /[\p{L}\p{N}]{2,}/u.test(s || '');
        for (let n = el, depth = 0; n && depth < 3; n = n.parentElement, depth++) {
          if (n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('title'))) return true;
          for (const img of n.querySelectorAll('img, svg')) {
            if (img.getAttribute('alt') || img.getAttribute('aria-label')) return true;
          }
          for (const child of n.childNodes) {
            if (child === textNode) continue;
            if (child.nodeType === 3) { if (words(child.textContent)) return true; }
            else if (child.nodeType === 1 && !child.contains(el) && words(child.textContent)) return true;
          }
        }
        return false;
      };
      const covers = (top) => {
        if (top === el || el.contains(top) || top.contains(el)) return false;
        let common = top;
        while (common && !ownChain.has(common)) common = common.parentElement;
        let clear = 1;
        for (let n = top; n && n !== common && clear > 0.15; n = n.parentElement) {
          const s = getComputedStyle(n);
          const bg = parseColor(s.backgroundColor);
          clear *= 1 - (bg ? bg[3] : 0) * Number(s.opacity);
          /* A layer holding a modal makes everything behind it inert — nothing under it can be
             clicked, and it is not the content a person is being asked to read. That scenery is
             not measured. A translucent overlay that is *not* a modal is a veil, and text under a
             veil is still text: the honest measurement is the veiled one, which is what the
             pixels say. */
          if (n.matches('[role="dialog"], [aria-modal="true"]') || n.querySelector('[role="dialog"], [aria-modal="true"]')) return true;
        }
        return 1 - clear >= 0.85;
      };

      const fontPx = parseFloat(cs.fontSize) || 16;
      const weight = Number(cs.fontWeight) || 400;
      const large = fontPx >= 24 || (fontPx >= 18.5 && weight >= 700);

      for (const node of own) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        /* Letters, digits and their marks: a run of those is text a person reads, and its colour
           is the thing being measured. A run of nothing but symbols is a glyph. */
        const isGlyph = !/[\p{L}\p{N}]/u.test(text);
        const range = document.createRange();
        range.selectNodeContents(node);
        const boxes = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 2);
        if (!boxes.length) continue;

        /* Where is this text actually on screen? Hit-test a grid over each line box and keep the
           points where this element is the topmost thing — `elementFromPoint` skips
           `pointer-events: none` layers, which is exactly right: a transparent layer over text is
           not covering it, and a window is. A glyph is sampled at every pixel: a 15px icon on a 4px
           grid lands on whichever part of it the grid happened to hit, and "the strongest pixel
           actually painted" has to mean the strongest of *all* of them. */
        const points = [];
        const SAMPLE_STEP = isGlyph ? 1 : 4, MAX_SAMPLES = isGlyph ? 900 : 400;
        let lastTop = null, lastCovered = false;
        for (const r of boxes) {
          const x0 = Math.max(0, Math.ceil(r.x)), x1 = Math.min(window.innerWidth - 1, Math.floor(r.x + r.width));
          const y0 = Math.max(0, Math.ceil(r.y)), y1 = Math.min(window.innerHeight - 1, Math.floor(r.y + r.height));
          for (let y = y0; y <= y1 && points.length < MAX_SAMPLES; y += SAMPLE_STEP) {
            for (let x = x0; x <= x1 && points.length < MAX_SAMPLES; x += SAMPLE_STEP) {
              const top = document.elementFromPoint(x, y);
              if (!top) continue;
              /* Hit-testing a whole line box against the same thing that is on top of it: the
                 answer only changes where something else crosses the line, so cache it per node. */
              if (top !== lastTop) { lastTop = top; lastCovered = covers(top); }
              if (lastCovered) continue;
              points.push([x, y]);
            }
          }
        }
        if (!points.length) continue;   // off screen, or behind another window
        if (isGlyph && hasName(node)) { named++; continue; }
        runs.push({
          /* `text` is what a report shows; `fullText` is what a coverage claim is matched against.
             Truncating the thing you match expectations against means a long expectation can never
             be satisfied by text that is plainly on the page. */
          where: describe(el), text: text.slice(0, 60), fullText: text.slice(0, 240),
          color, opacity, fontPx, weight, large,
          glyph: isGlyph,
          disabled, points,
        });
      }
    }
  }
  return { runs, named };
}

async function shoot(page) {
  return decodePng(await page.screenshot({ animations: 'disabled' }));
}

/** Audit every visible run of text in the live page. Returns { runs, problems, skipped }. */
export async function auditContrast(page, roots = ['body']) {
  const collected = await page.evaluate(collectInPage, { roots: Array.isArray(roots) ? roots : [roots] });
  const runs = collected.runs;

  const withText = await shoot(page);
  await page.evaluate((css) => {
    let tag = document.getElementById('contrast-audit-hide');
    if (!tag) { tag = document.createElement('style'); tag.id = 'contrast-audit-hide'; document.head.appendChild(tag); }
    tag.textContent = css;
  }, HIDE_CSS);
  const withoutText = await shoot(page);
  await page.evaluate(() => document.getElementById('contrast-audit-hide')?.remove());

  const problems = [];
  const skipped = { unpainted: 0, disabled: 0 };
  for (const run of runs) {
    if (run.disabled) { skipped.disabled++; continue; }   // WCAG 1.4.3 exempts inactive controls
    const ink = run.color.slice(0, 3);
    const alpha = Math.max(0, Math.min(1, run.color[3] * run.opacity));

    let painted = 0;
    let worstSpec = Infinity, worstBg = null;   // the specified ink, at its worst point
    let bestRendered = 0;                       // whatever was painted, at its strongest
    let bestCoverage = 0, bestResidual = 0;
    for (const [x, y] of run.points) {
      const i = (y * withText.width + x) * 4;
      const bg = [withoutText.data[i], withoutText.data[i + 1], withoutText.data[i + 2]];
      const a = [withText.data[i], withText.data[i + 1], withText.data[i + 2]];
      const diff = Math.max(Math.abs(a[0] - bg[0]), Math.abs(a[1] - bg[1]), Math.abs(a[2] - bg[2]));
      if (diff < INK_DIFF) {
        /* No glyph here. The specified ink still has a background under it, and that pair is
           still what a reader would have to cope with — so it is measured even though nothing was
           found. Text that is *this* close to its own background is the case a "did we see the
           glyph" test would otherwise wave through. */
        const composited = alpha >= 1 ? ink : mixOver(bg, [...ink, alpha]);
        const ratio = contrastRatio(composited, bg);
        if (ratio < worstSpec) { worstSpec = ratio; worstBg = bg; }
        continue;
      }
      painted++;

      const composited = alpha >= 1 ? ink : mixOver(bg, [...ink, alpha]);
      const ratio = contrastRatio(composited, bg);
      if (ratio < worstSpec) { worstSpec = ratio; worstBg = bg; }
      bestRendered = Math.max(bestRendered, contrastRatio(a, bg));

      /* Coverage and residual for this point: how far along bg→ink it sits, and how far off that
         line it actually is. Off the line means the pixels are not the run's colour. */
      const d = [0, 1, 2].map((c) => a[c] - bg[c]);
      const dir = [0, 1, 2].map((c) => ink[c] - bg[c]);
      let t = 0, usable = false;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(dir[c]) < 20) continue;
        usable = true;
        t = Math.max(t, Math.abs(d[c]) / Math.abs(dir[c]));
      }
      if (!usable) continue;
      t = Math.min(1.2, t);
      const residual = Math.max(...[0, 1, 2].map((c) => Math.abs(d[c] - dir[c] * t)));
      if (t > bestCoverage) { bestCoverage = t; bestResidual = residual; }
    }
    if (!painted) skipped.unpainted++;   // still judged from the declared ink, just noted

    /* Only a run that is *not* drawn in its own colour gets measured from painted pixels, and it
       has to be well off the line, not merely anti-aliased. */
    const colourGlyph = run.glyph && bestResidual > 30;
    const measured = colourGlyph ? bestRendered : worstSpec;
    const required = run.glyph ? AA_GLYPH : (run.large ? AA_LARGE : AA_NORMAL);
    if (measured < required) {
      problems.push({
        kind: 'low-contrast', ratio: +measured.toFixed(2), required,
        where: run.where, text: run.text, glyph: run.glyph, colourGlyph,
        color: `rgb(${ink.join(' ')})`, alpha: +alpha.toFixed(2),
        background: worstBg ? `rgb(${worstBg.join(' ')})` : 'painted pixels',
        fontPx: run.fontPx, samples: painted,
      });
    }
  }
  return { runs, problems, skipped, decorativeGlyphs: collected.named };
}

export function assertReadable(result, where, { minRuns = 10, expect = [] } = {}) {
  const { problems, runs, skipped } = result;
  const lines = problems.map((p) =>
    `${p.ratio}:1 (needs ${p.required}:1)  ${p.where}\n      text: ${JSON.stringify(p.text)}  ink ${p.color}${p.alpha < 1 ? ` at alpha ${p.alpha}` : ''}  on ${p.background}  ${p.fontPx}px`);
  /* Not a contrast claim: a guard against an audit that measured nothing. A page that is off
     screen, or a root selector that matches no visible element, produces zero runs — and an audit
     of zero runs passes every contrast assertion it has.

     `expect` is the stronger version of the same guard, and the screens that matter use it: a
     count proves the audit saw *some* text, a coverage claim proves it saw *this* text. A screen
     could lose half its labels and still clear a floor of ten. Claims are matched against a run's
     full text, not the 60-character form a report prints — otherwise a long expectation could
     never be satisfied by text that is plainly on the page. */
  assert.ok(runs.length >= minRuns,
    `${where}: the audit measured ${runs.length} run(s) of text — fewer than ${minRuns}, so it is not measuring the page; is it on screen?`);
  const texts = runs.map((r) => String(r.fullText ?? r.text));
  const shown = expect.filter((p) => !texts.some((t) => (p instanceof RegExp ? p.test(t) : t.includes(String(p)))));
  assert.deepEqual(shown.map(String), [],
    `${where}: the audit never measured ${shown.map((p) => JSON.stringify(String(p))).join(', ')}, so whatever it did measure is not this screen. A run is only counted when its own element is the topmost thing at the sampled points — is the text behind a window, off screen, or gone?`);
  assert.deepEqual(problems, [], `${where}: ${problems.length} run(s) of rendered text below the WCAG bar:\n  ${lines.join('\n  ')}`);
  /* Not a failure, but it must be visible: "no glyph at the sampled points" is also what text
     hidden behind another window looks like, and a page that hid everything would pass. */
  assert.ok(skipped.unpainted < runs.length,
    `${where}: none of ${runs.length} runs produced a single glyph pixel — the page is not being painted`);
}
