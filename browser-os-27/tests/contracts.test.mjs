import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source-level contracts: things that must stay *shared* to stay correct.
 *
 * These are not behaviour tests — they guard against the specific way a shared rule rots:
 * somebody writes a second copy of it locally, and the two copies drift until a control is
 * tabbable but unaudited, or audited but unreachable. Reading the source is the only way
 * to catch that without a browser.
 */

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the Tab focus ring and the accessibility audit share one control list', () => {
  const wm = read('../src/core/wm.js');
  const a11y = read('./a11y.mjs');
  const utils = read('../src/core/utils.js');

  assert.match(utils, /export const INTERACTIVE_SELECTOR =/, 'utils.js must own the list');
  assert.match(wm, /import \{[^}]*reachableControls[^}]*\} from '\.\/utils\.js'/,
    'wm.js must take the focus ring from the shared helper');
  assert.match(a11y, /import \{[^}]*INTERACTIVE_SELECTOR[^}]*\} from '\.\.\/src\/core\/utils\.js'/,
    'the audit must use the same list');

  /* A local copy is the regression this guards: a selector written inline in either file
     is a second definition of "control" that nothing keeps in sync. */
  assert.doesNotMatch(wm, /const SELECTOR =/, 'wm.js has its own copy of the control list');
  assert.doesNotMatch(a11y, /const SELECTOR =/, 'tests/a11y.mjs has its own copy of the control list');
});

test('the window menu and the drag preview both come from the geometry ZONES table', () => {
  const shell = read('../src/core/shell.js');
  const wm = read('../src/core/wm.js');
  const geometry = read('../src/core/geometry.js');

  assert.match(geometry, /export const ZONES =/, 'geometry.js must own the zone list');
  assert.match(shell, /import \{[^}]*ZONES[^}]*\} from '\.\/geometry\.js'/,
    'the window menu must be built from it');
  assert.match(wm, /import \{[^}]*zoneLabel[^}]*\} from '\.\/geometry\.js'/,
    'the drag preview must label itself with it');
});

test('the browser suite shares one fixture, so it boots one browser per file', () => {
  /* The browser suite used to be one 3800-line file: one Chromium for 86 tests, 158s, and
     every test depending on which test ran before it. Splitting it by area only holds if the
     browser, the server and the desktop helpers stay in one place — if a test file starts
     importing playwright directly it has quietly become a second fixture with its own browser,
     and the split turns into eight slow files instead of seven fast ones. */
  const dir = new URL('./browser/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  const suites = files.filter((f) => f !== 'fixture.mjs');

  assert.ok(suites.length >= 2, 'the browser suite is expected to be split by area');
  assert.ok(files.includes('fixture.mjs'), 'tests/browser/fixture.mjs must exist as the one fixture');

  for (const f of files) {
    const src = readFileSync(fileURLToPath(new URL(f, dir)), 'utf8');
    if (f === 'fixture.mjs') {
      assert.match(src, /from 'playwright'/, 'the fixture is the only place that imports playwright');
      assert.match(src, /before\(/, 'the fixture owns the browser lifecycle: before()');
      assert.match(src, /after\(/, 'and closes it: after()');
      continue;
    }
    assert.doesNotMatch(src, /from 'playwright'/, `${f} must take the browser from the fixture, not open its own`);
    assert.doesNotMatch(src, /serve\.mjs/, `${f} must not start its own server`);
    /* A file that drives a browser must do it through the fixture. A file that drives none —
       a shared measuring instrument, imported by both the tests and the screenshot script —
       has no browser to share and must not import one just to satisfy this rule. */
    if (/from 'node:test'/.test(src)) assert.match(src, /from '\.\/fixture\.mjs'/, `${f} must use the shared fixture`);
  }
});

test('every data-* diagnostic the core writes is documented, and nothing documented is stale', () => {
  /* Five DOM diagnostics became six became seven, each explained where it was written and
     partly in the README — which is how a diagnostic gets read as a promise about the layout.
     The README has one table that names them all and says what each one does *not* mean; this
     keeps that table from drifting away from the code that writes the attributes. */
  const readme = read('../README.md');
  const section = readme.match(/<!-- diagnostics:start -->\n([\s\S]*?)\n<!-- diagnostics:end -->/);
  assert.ok(section, 'README.md must have a diagnostics section between the start/end markers');

  const camelToKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const written = new Map(); // kebab name -> file
  for (const file of ['utils.js', 'wm.js', 'shell.js', 'theme.js', 'dialogs.js', 'fs.js', 'store.js', 'eventbus.js', 'geometry.js']) {
    const src = read(`../src/core/${file}`);
    for (const m of src.matchAll(/dataset\.([A-Za-z0-9]+)\s*=(?![=>])/g)) written.set(camelToKebab(m[1]), `src/core/${file}`);
    for (const m of src.matchAll(/dataset:\s*\{([^}]*)\}/g)) {
      for (const key of m[1].split(',')) {
        const name = key.split(':')[0].trim();
        if (/^[A-Za-z0-9]+$/.test(name)) written.set(camelToKebab(name), `src/core/${file}`);
      }
    }
  }

  assert.ok(written.size >= 8, `expected the core to write a number of diagnostics, found ${written.size}`);
  for (const [name, where] of written) {
    assert.ok(section[1].includes(`\`data-${name}\``),
      `${where} writes data-${name}, which the README diagnostics table does not name`);
  }

  /* The other direction: a row for an attribute nobody writes is a table people keep reading.
     Names are matched against the whole source, because these attributes are also the ones the
     tests and the dev tools look for. */
  const allSource = ['utils.js', 'wm.js', 'shell.js', 'theme.js', 'dialogs.js', 'fs.js', 'store.js']
    .map((f) => read(`../src/core/${f}`)).join('\n')
    + readdirSync(fileURLToPath(new URL('../src/apps/', import.meta.url)))
      .map((f) => read(`../src/apps/${f}`)).join('\n')
    + read('../styles/os.css');
  for (const m of section[1].matchAll(/`data-([a-z0-9-]+)+`/g)) {
    const kebab = m[1];
    const camel = kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    assert.ok(allSource.includes(`data-${kebab}`) || allSource.includes(camel),
      `the README documents data-${kebab}, which nothing in src/ or styles/ writes or reads any more`);
  }
});

test('an app that wants the keyboard uses the shared claimFocus, not its own timer', () => {
  /* `setTimeout(() => control.focus(), 30)` appeared in three apps and is wrong in all three:
     30ms is long enough to have focused something else, and an app that takes the keyboard
     back from that choice breaks the shell's keyboard commands. claimFocus is the one place
     allowed to decide, because it is the one place that checks who has the keyboard right now. */
  const utils = read('../src/core/utils.js');
  assert.match(utils, /export function claimFocus\(/, 'utils.js must own the rule');

  for (const app of readdirSync(fileURLToPath(new URL('../src/apps/', import.meta.url)))) {
    const src = readFileSync(fileURLToPath(new URL(`../src/apps/${app}`, import.meta.url)), 'utf8');
    assert.doesNotMatch(src, /setTimeout\(\(\) => [\w.]+\.focus\(\)/,
      `${app} focuses a control on its own timer instead of claimFocus`);
  }
});

test('a flag that takes a value is a flag its own command parser knows about', () => {
  /* `fileArgs()` decides which words are files. It used to ask one global question — "is this a
     flag that eats the next word?" — and the answer was wrong for half the flags in the shell:
     `-n` is a number in `head -n 5 notes.md` and a mode in `sort -n notes.md`, and the shared
     list ate `notes.md` as `-n`'s value, so `sort -n <file>` silently sorted nothing. Only the
     command that owns a flag knows which kind it is, so the list is now passed in per command —
     which means it can be forgotten again, and this is the check that notices.

     The contract is read off the two things a command must write to have flags at all: it reads a
     value with `numFlag(args, '-x', …)`, and it names that flag in `fileArgs(args, ['-x'])`. A
     command that does one without the other is either reading a value the parser will hand back
     as a filename, or eating an argument for a flag it never reads. */
  const src = read('../src/apps/terminal.js');
  const lines = src.split('\n');
  /* Command entries in the `commands` table are the only things at exactly six spaces of indent
     that open a block. Everything nested inside them is deeper. The `{` need not end the line — a
     short command is written on one line, and a check that only sees multi-line entries silently
     skips the short ones. */
  const starts = [];
  lines.forEach((line, i) => {
    const m = /^      ([a-z]+): \{/.exec(line);
    if (m) starts.push({ name: m[1], at: i });
  });
  assert.ok(starts.length >= 10, `expected to find the shell's command table, found ${starts.length} entries`);

  let checked = 0;
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].at : lines.length;
    const body = lines.slice(start.at, end).join('\n');
    const readsValue = [...body.matchAll(/numFlag\(args,\s*'(-[a-z]+)'/g)].map((m) => m[1]);
    const declared = [...body.matchAll(/fileArgs\(args,\s*\[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'(-[a-z]+)'/g)].map((x) => x[1]));
    if (!readsValue.length && !declared.length) return;
    checked++;
    for (const flag of readsValue) {
      assert.ok(declared.includes(flag),
        `${start.name} reads a value for ${flag} with numFlag but does not pass it to fileArgs, so ${flag} 5 will be handed to it as a file name`);
    }
    for (const flag of declared) {
      assert.ok(readsValue.includes(flag),
        `${start.name} tells fileArgs that ${flag} eats the next word but never reads that value — either use numFlag for it or drop it, because right now it swallows an argument for nothing`);
    }
  });

  assert.ok(checked >= 1, 'no command declares a value flag, which means this check has nothing to check');
});

test('the help index files every command, and every page it points at exists', () => {
  /* `help` is an index now: a table of commands filed into groups, and a list of the shell's own
     features each pointing at a `man` page. An index fails in two directions, and both are invisible
     until someone reads it — a command that is not filed anywhere, and a pointer to a page that was
     renamed or never written. Checking it in the browser suite catches it eventually; checking the
     tables here catches it in the fast suite, before anyone opens a window. */
  const src = read('../src/apps/terminal.js');
  const lines = src.split('\n');
  const blockOf = (header) => {
    const at = lines.findIndex((l) => l.trimStart().startsWith(header));
    assert.ok(at >= 0, `terminal.js no longer has ${header}, so this check is looking at nothing`);
    let end = at + 1;
    while (end < lines.length && !/^(    \];|    \};)$/.test(lines[end])) end++;
    assert.ok(end < lines.length, `${header} is never closed`);
    return lines.slice(at + 1, end);
  };
  const strings = (line) => [...line.matchAll(/"[^"]*"|'[^']*'/g)].map((m) => m[0].slice(1, -1));

  const commands = blockOf('const commands = {')
    .flatMap((l) => [...l.matchAll(/^      ([a-z]+): \{/g)].map((m) => m[1]));
  assert.ok(commands.length >= 30, `expected the shell's command table, found ${commands.length} commands`);

  const groups = blockOf('const COMMAND_GROUPS = [')
    .flatMap((l) => [...l.matchAll(/label: '([^']+)', names: \[([^\]]*)\]/g)]
      .map((m) => ({ label: m[1], names: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) })));
  assert.ok(groups.length >= 3, `help is grouped into ${groups.length} groups, which is not an index`);

  const filed = groups.flatMap((g) => g.names);
  assert.ok(new Set(filed).size === filed.length,
    `a command filed in two groups is printed twice: ${filed.filter((n, i) => filed.indexOf(n) !== i).join(', ')}`);
  for (const g of groups) for (const n of g.names)
    assert.ok(commands.includes(n), `the group "${g.label}" lists \`${n}\`, which is not a command`);
  const orphaned = commands.filter((n) => !filed.includes(n));
  assert.deepEqual(orphaned, [], `these commands are in the table but in no group, so help prints them under "Ungrouped": ${orphaned.join(', ')}`);

  const features = blockOf('const SHELL_FEATURES = [')
    .map((l) => strings(l)).filter((s) => s.length >= 3).map((s) => ({ name: s[0], pointer: s[s.length - 1] }));
  assert.ok(features.length >= 4, `the feature index has ${features.length} entries`);
  const topics = blockOf('const TOPICS = {')
    .flatMap((l) => [...l.matchAll(/^      ([a-z]+): \[$/g)].map((m) => m[1]));
  assert.ok(topics.length >= 4, `expected the shell's topic pages, found ${topics.length}`);

  for (const f of features) {
    const targets = [...f.pointer.matchAll(/\bman ([a-z]+)/g)].map((m) => m[1]);
    assert.ok(targets.length, `the feature "${f.name}" points at "${f.pointer}", which is not a \`man\` pointer`);
    for (const t of targets)
      assert.ok(topics.includes(t) || commands.includes(t), `the feature "${f.name}" points at \`man ${t}\`, and there is no such page`);
  }
  const unreachable = topics.filter((t) => !features.some((f) => new RegExp(`\\bman ${t}\\b`).test(f.pointer)));
  assert.deepEqual(unreachable, [], `these \`man\` pages exist but nothing in help points at them, so nobody finds them: ${unreachable.join(', ')}`);
});

test('every token the stylesheet paints with is a token somebody defines', () => {
  /* `background: var(--wallpaper)` sat in os.css for twenty iterations pointing at a custom
     property no file ever defined — a declaration that could only ever resolve to nothing, and
     that read like a rule. The other half of this test is the half that actually bit: a colour
     token defined for the dark theme only, used as text in the light one. `--ok` was #3ddc97
     everywhere, which is 8.8:1 on a dark card and 1.63:1 on a light one. */
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const themeCss = strip(read('../styles/theme.css'));
  const osCss = strip(read('../styles/os.css'));
  const themeJs = read('../src/core/theme.js');

  const defined = new Set([...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  /* Three tokens are written at runtime by the theme, from a measurement, and are given a
     default in theme.css so a stylesheet never depends on the measurement having happened. */
  const runtime = ['--wallpaper-text', '--wallpaper-shadow', '--wallpaper-plate'];
  for (const name of runtime) {
    assert.ok(defined.has(name), `theme.css does not give ${name} a default, so the first paint has nothing`);
    assert.ok(themeJs.includes(`setProperty('${name}'`), `theme.js never sets ${name}, which it is supposed to own`);
  }

  const used = new Set([...osCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((n) => !defined.has(n) && !runtime.includes(n));
  assert.deepEqual(missing, [], `os.css paints with tokens nothing defines: ${missing.join(', ')}`);

  /* A colour used as *text* has to be chosen for the surface it sits on, which means the light
     theme has to say its own value for it — unless the reason it does not is written down. */
  const rootBlock = themeCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const lightBlocks = [...themeCss.matchAll(/html[^{]*data-theme="light"[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  const inRoot = new Set([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const inLight = new Set([...lightBlocks.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

  const themeIndependent = {
    '--on-accent': 'chosen against the accent fill, which is the same colour in both themes',
    '--wallpaper-text': 'measured from the wallpaper on screen, not from the theme',
    '--wallpaper-shadow': 'measured from the wallpaper on screen, not from the theme',
    '--wallpaper-plate': 'measured from the wallpaper on screen, not from the theme',
  };

  const textTokens = new Set([
    ...osCss.matchAll(/(?:^|[{;])\s*color:\s*var\((--[a-z0-9-]+)\)/gm),
    ...osCss.matchAll(/(?:^|[{;])\s*-webkit-text-fill-color:\s*var\((--[a-z0-9-]+)\)/gm),
  ].map((m) => m[1]));

  assert.ok(textTokens.size >= 8, `expected the stylesheet to write text with theme tokens, found ${textTokens.size}`);
  for (const name of textTokens) {
    assert.ok(inRoot.has(name), `${name} is used as text but :root does not define it`);
    if (inLight.has(name)) continue;
    assert.ok(themeIndependent[name],
      `${name} is used as text and the light theme never redefines it — either give it a light value or write down here why one is not needed`);
  }
});

test('a rule that rebinds a text token also paints with it', () => {
  /* The class of bug, not the bug. A rule that redefines `--text` changes what `var(--text)`
     resolves to *inside that block* — it does not change the *inherited computed colour* of any
     text that has no `color:` declaration of its own. That text keeps the colour of the nearest
     ancestor that has one, which is usually the window.

     `.term` rebinds the whole ink palette onto a canvas that stays dark in both themes, and for
     twenty-two iterations nothing said the other half of that rule: the terminal never declared a
     `color:` of its own, so plain `ls` output inherited the light theme's near-black and measured
     1.15:1 on a near-black canvas. The pixel audit found it; the token tests could not, because
     every token in the file was correct.

     So the contract is the shape of the rule, not the line in `.term`: any block in the
     stylesheet that rebinds a text-ink token must also say what colour it paints text with. A
     future component that re-does the terminal's trick and forgets the second half fails here,
     in a unit test, before a browser has to be started. */
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const osCss = strip(read('../styles/os.css'));

  /* The tokens whose whole job is "the colour of text". Tokens used for fills, borders and
     shadows are excluded on purpose: rebinding one of those is not a claim about ink. */
  const INK_TOKENS = new Set([
    '--text', '--text-dim', '--text-faint', '--accent-text', '--accent-text-dark', '--accent-text-light',
    '--ok-text', '--warn-text', '--danger-text', '--on-accent', '--on-danger', '--wallpaper-text',
  ]);

  const blocks = [...osCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([_, selector, body]) => ({
    selector: selector.trim().replace(/\s+/g, ' '),
    body,
    rebound: [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).filter((n) => INK_TOKENS.has(n)),
  })).filter((b) => b.rebound.length);

  assert.ok(blocks.length >= 1, 'expected at least one block rebinding an ink token (the terminal does)');
  for (const b of blocks) {
    const paints = /(?:^|[;])\s*(?:color|-webkit-text-fill-color)\s*:/.test(b.body);
    assert.ok(paints,
      `${b.selector} rebinds ${b.rebound.join(', ')} but never declares a color: — text inside it will be painted with an ancestor's ink, not with these`);
  }

  /* And the other direction: a token whose declared purpose is ink has to be *used* as ink
     somewhere. `--term-ok` defined in theme.css and painted nowhere is a palette nobody wears. */
  const themeCss = strip(read('../styles/theme.css'));
  const inkDefined = [...themeCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])
    .filter((n) => INK_TOKENS.has(n));
  const paintedWith = new Set([...osCss.matchAll(/(?:color|-webkit-text-fill-color)\s*:[^;]*var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  /* `--accent-text-dark` / `-light` are deliberately never painted directly: a theme block maps
     `--accent-text` to one of them, which is what keeps an accent preset from outranking a theme
     (asserted in tests/token-contrast.test.mjs). */
  const indirect = ['--accent-text-dark', '--accent-text-light'];
  for (const name of inkDefined) {
    if (indirect.includes(name)) {
      assert.ok(themeCss.includes(`--accent-text: var(${name})`),
        `${name} is defined but no theme block ever maps --accent-text to it`);
      continue;
    }
    assert.ok(paintedWith.has(name), `${name} is defined as ink but the stylesheet never writes text with it`);
  }
});
