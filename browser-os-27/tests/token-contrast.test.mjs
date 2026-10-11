/**
 * The colour tokens, measured against the surfaces they are actually painted on.
 *
 * This is the guard for the numbers chosen in theme.css. Every one of them was picked by searching
 * for the value that clears 4.5:1 on the *worst* surface in the theme — including the tinted panels
 * a selected state paints, which is where an accent quietly fails: `--accent-soft` lifts a dark
 * surface by 18% of the accent, and blue measured 4.85:1 on a plain panel but 3.96:1 on its own
 * tint. A test that only compares tokens against other tokens would never see that.
 *
 * It also checks the shape of the ink hierarchy. `--text-faint` is used for real messages — the
 * taskbar's "No open windows", a file's size, an app's empty state — so the faintest level has to
 * clear the bar on its own; and the three levels have to stay visibly three levels apart, or a
 * later "just make it darker" edit quietly collapses them into one.
 *
 * tests/browser/contrast.test.mjs measures the same claim from rendered pixels. This is the fast
 * half: it catches a token that drifted before a browser has to be started.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrastRatio, hexToRgb, rgbaOf, mixOver } from '../src/core/utils.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (p) => readFileSync(here + p, 'utf8');
const raw = read('../styles/theme.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

const MIN_TEXT = 4.5;    // WCAG 1.4.3, normal text
const MIN_LEVEL = 1.25;  // how much stronger one ink level must be than the one below it

const block = (selector) => {
  const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `theme.css has no ${selector} block`);
  const out = {};
  for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
};

const root = block(':root');
const light = block('html\\[data-theme="light"\\]');
const accents = [...css.matchAll(/html\[data-accent="([a-z]+)"\]\s*\{([^}]*)\}/g)].map(([_, id, body]) => {
  const d = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) d[m[1]] = m[2].trim();
  return { id, d };
});

/** A token as pixels: `[r, g, b, a]`. `var(...)` resolves against the dark theme, which is where
    the light theme borrows a value from. */
const colour = (value, fallback) => {
  const c = rgbaOf(value?.startsWith('var(') ? (fallback || '') : (value || ''));
  assert.ok(c, `not a colour: ${JSON.stringify(value)}`);
  return c;
};

const themeTokens = (theme) => (theme === 'light' ? { ...root, ...light } : root);

const surfaces = (theme) => {
  const t = themeTokens(theme);
  const solid = ['--surface-solid', '--surface-2', '--surface-3'].map((n) => {
    const c = colour(t[n], root[n]);
    return { name: `${n} ${t[n]}`, rgb: c };
  });
  /* A selected state paints `--accent-soft` over the panel it is on. That composite is the real
     background of the text in a sidebar row, a segmented control, a context menu item. */
  const tinted = (id, d) => {
    const tint = colour(d['--accent-soft'], root['--accent-soft']);
    return solid.map((bg) => ({ name: `--accent-soft(${id}) over ${bg.name}`, rgb: mixOver(bg.rgb, tint) }));
  };
  return { solid, tinted };
};

const ratio = (ink, bg) => contrastRatio(ink, bg);

test('every ink level clears 4.5:1 on every surface of its own theme', () => {
  for (const theme of ['dark', 'light']) {
    const t = themeTokens(theme);
    for (const name of ['--text', '--text-dim', '--text-faint']) {
      const ink = colour(t[name], root[name]);
      for (const bg of surfaces(theme).solid) {
        const r = ratio(ink, bg.rgb);
        assert.ok(r >= MIN_TEXT, `${theme} ${name} ${t[name]} on ${bg.name} is ${r.toFixed(2)}:1, needs ${MIN_TEXT}`);
      }
    }
  }
});

test('the three ink levels stay three levels apart', () => {
  /* A hierarchy where the faintest level is legible is a different thing from one where everything
     is legible because everything is the same colour. */
  for (const theme of ['dark', 'light']) {
    const t = themeTokens(theme);
    const bg = colour(t['--surface-3'], root['--surface-3']);
    const strength = (name) => ratio(colour(t[name], root[name]), bg);
    const [text, dim, faint] = ['--text', '--text-dim', '--text-faint'].map(strength);
    assert.ok(text > dim * MIN_LEVEL, `${theme}: --text is only ${(text / dim).toFixed(2)}× stronger than --text-dim`);
    assert.ok(dim > faint * MIN_LEVEL, `${theme}: --text-dim is only ${(dim / faint).toFixed(2)}× stronger than --text-faint`);
  }
});

test('every accent clears 4.5:1 as text, on plain panels and on its own tint', () => {
  assert.equal(accents.length, 6, 'expected six accent presets in theme.css');
  for (const { id, d } of accents) {
    for (const [token, theme] of [['--accent-text-dark', 'dark'], ['--accent-text-light', 'light']]) {
      const ink = colour(d[token], themeTokens(theme)[token]);
      const set = surfaces(theme);
      for (const bg of [...set.solid, ...set.tinted(id, d)]) {
        const r = ratio(ink, bg.rgb);
        assert.ok(r >= MIN_TEXT,
          `${theme} accent "${id}" ${token} ${d[token]} on ${bg.name} is ${r.toFixed(2)}:1, needs ${MIN_TEXT}`);
      }
    }
  }
});

test('the terminal keeps its own palette, because its canvas does not change with the theme', () => {
  /* os.css paints the terminal dark in *both* themes. If that canvas ever changes colour this test
     fails rather than letting the ink quietly fall below the bar on it. */
  const os = read('../styles/os.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const canvases = [
    ...os.matchAll(/^\.term\s*\{[^}]*?background:\s*(#[0-9a-f]{6})/gm),
    ...os.matchAll(/data-theme="light"\]\s*\.term\s*\{[^}]*?background:\s*(#[0-9a-f]{6})/gm),
  ].map((m) => hexToRgb(m[1]));
  assert.equal(canvases.length, 2, 'expected one terminal canvas per theme in os.css');

  const term = os.match(/^\.term\s*\{[\s\S]*?\n\}/m)?.[0] || '';
  /* Rebinding the tokens is only half of it. Text with no `color:` of its own inherits a
     *computed* colour from the nearest ancestor that has one — which is the window, not the
     terminal. Without this line, `ls` output is the light theme's near-black on a dark canvas. */
  assert.ok(term.includes('color: var(--text)'), 'the terminal never actually paints with its own ink');
  for (const name of ['--text', '--text-dim', '--text-faint', '--ok-text', '--danger-text']) {
    assert.ok(term.includes(`${name}: var(--term`), `the terminal does not rebind ${name} to its own palette`);
  }
  assert.ok(term.includes('--accent-text: var(--accent-text-dark)'),
    'the terminal paints accent text with the dark-theme ink, because its canvas is dark in both themes');

  for (const name of ['--term-text', '--term-dim', '--term-faint', '--term-ok', '--term-danger']) {
    const ink = colour(root[name]);
    for (const bg of canvases) {
      const r = ratio(ink, bg);
      assert.ok(r >= MIN_TEXT, `${name} ${root[name]} on the terminal canvas ${bg.join(',')} is ${r.toFixed(2)}:1, needs ${MIN_TEXT}`);
    }
  }
});

test('the light theme says its own value for every ink it writes text with', () => {
  /* The mechanism the token test depends on: `--accent-text` in the light theme must resolve to the
     light column, and the accent presets must not be able to override that. */
  assert.match(raw, /html\[data-theme="light"\][^}]*--accent-text:\s*var\(--accent-text-light\)/s);
  assert.match(raw, /:root[^}]*--accent-text:\s*var\(--accent-text-dark\)/s);
  for (const { id, d } of accents) {
    assert.ok(!d['--accent-text'], `accent "${id}" sets --accent-text directly, which would outrank the theme`);
  }
});
