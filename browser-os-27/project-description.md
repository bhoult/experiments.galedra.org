# Project description — Browser OS (version 26)

## What this is

A desktop environment that runs entirely in a browser tab. Plain ES modules, no build
step, no runtime dependencies (Playwright is a devDependency used only by the test
harness and the screenshot script).

It provides:

- a **window manager** (drag, resize from 8 handles with a move strip in the middle of
  the top edge, focus/z-order, minimise, maximise, edge *and quarter* snap-tiling with a
  preview that names the zone it is showing, a right-click **window menu** offering the
  same tiling as a list plus **Undo move** for the last position change, viewport clamping,
  keyboard move/resize/snap via the title bar, guarded close for dirty apps, per-window
  toolbar overflow fades, *app-declared toolbar compaction* and a **⋯ overflow menu** for
  whatever the bar still cannot show, a per-window keyboard focus ring, session restore),
- a **virtual filesystem** persisted to `localStorage` with a POSIX-ish path resolver,
  cached file/byte counts, and a reported-once storage-quota warning,
- a **storage budget that is measured, not assumed**: `Store.capacity()` probes the real
  `localStorage` quota once, `headroom()` subtracts what is in use, and file imports are
  limited by that number (`df`, `du` and the Settings storage card report it). A write the
  browser refuses for quota reasons invalidates that measurement, so the next answer is
  measured again instead of repeating the number that just proved wrong.
- a **shell** (desktop icons, taskbar with overflow fades, Start menu with search,
  context menus, clipboard, toasts, clock, show-desktop, global hotkeys, drag-and-drop
  upload onto the desktop),
- **in-OS modal dialogs** (`confirm`/`prompt` replacements: themed, focus-trapping,
  Escape-closable, promise-based),
- **nine apps**: Terminal, Files, Text Editor, Image Viewer, Paint, Calculator, Web
  Browser, Settings, Welcome.

## Structure

```
index.html          static shell markup: #desktop, #windows, #taskbar, menus, toasts, dialogs
styles/theme.css    CSS custom properties, dark/light themes, accent presets
styles/os.css       window chrome, taskbar, menus, and every app's styles
serve.mjs           `npm start` entry — thin wrapper over tests/serve.mjs
src/main.js         constructs EventBus → Store → VirtualFS → Theme → WindowManager →
                    Shell → Dialogs, wires the shared `ctx`, restores the saved layout,
                    exposes `window.browserOS` for the console
src/core/
  eventbus.js       pub/sub; handler errors are caught and logged, never fatal
  store.js          namespaced localStorage wrapper; failed writes fall back to memory
                  and are surfaced once via `onStorageFailure`, classified by cause
                  (`#classifyWrite` → `lastErrorKind`: quota / unavailable / serialisation /
                  unknown); `usage()`, a lazily probed `capacity()` (exponential + binary
                  search over probe writes) that is **thrown away and re-measured after a
                  quota-shaped refusal** (rate limited to one probe per 30s) and that
                  `#classifyWrite` will take itself if nothing has measured it yet,
                  `headroom()`, or Infinity when there is no localStorage
  fs.js             VirtualFS: resolve/stat/list/read/write/append/mkdir/rm/mv/copy/
                  uniqueName/tree/counts/reset; emits `fs:change` on every mutation
  geometry.js       pure window maths: zoneRect (halves, top/bottom halves, quarters,
                  max), the `ZONES` table + `zoneLabel()` that the window menu and the
                  drag preview are both built from, snapTarget, resizeRect, moveRect,
                  nearestQuarter, spawnOrigin (icon-grid aware)
  theme.js          settings object + wallpaper/accent presets, applies to <html>;
                  `wallpaperCss()` normalises a wallpaper setting into something CSS accepts,
                  `wallpaperInkFromRendered()` paints the wallpaper into a canvas capped at 640px on
                  the long side (a gradient has the same colours at 640px as at 4K) and
                  `sampleCanvas()` reads **every pixel** of it, keeping the darkest and lightest
                  colour in each of 128 logarithmic luminance bands, and
                  `wallpaperInkFromSamples()` / `wallpaperColors()` pick the ink whose *worst*
                  point is the most readable; if that is still under 4.5:1 the label gets a
                  **plate** whose alpha is *solved for* (`PLATE_TINT` gives the colour, `plateAlphaFor`
                  bisects for the weakest alpha that clears 4.5:1 on that wallpaper, capped at 0.9;
                  measured *through* by compositing with `mixOver`).
                  `#publishInk()` writes `--wallpaper-text` / `--wallpaper-shadow` /
                  `--wallpaper-plate` onto `<html>` and emits `wallpaper:ink`, which is what
                  Settings' readout subscribes to (see "Name truncation" and "Ink on the
                  wallpaper" below for why the ink is a wallpaper property and not a theme one)
  wm.js             WindowManager: launch/mount lifecycle, z-order, drag (#startMove is
                  shared by the title bar and the top-edge move strip), resize, snap
                  preview labelled from geometry.zoneLabel, minimise/maximise, keyboard
                  move/resize, `moveHistory`/`undoMove()` (max 5 per window, bursts of
                  nudges coalesced to one entry), guarded close, per-window
                  `watchToolbarOverflow()` fades + collapse + ⋯ menu (the menu is requested
                  over the bus so it is the same component the shell uses),
                  `#iconBottom()` counts only icons inside the scroll viewport,
                  `#wireFocusRing()` (Tab wraps inside the window, using the shared
                  `reachableControls()`), serialize/restore
  shell.js          desktop icons, taskbar, Start menu, context menus (`openContextMenu`
                  keeps a menu inside the window it belongs to, horizontally), toasts,
                  clock, global hotkeys, file clipboard, openPath() app routing
  dialogs.js        themed confirm()/prompt() modals with focus trap and restore
  utils.js          `el()` DOM helper, clamp/debounce, byte + path + icon helpers,
                  `INTERACTIVE_SELECTOR` / `isUsableControl()` / `reachableControls()` —
                  the one definition of "a control", used by the focus ring *and* the
                  accessibility audit — and `controlName()` (the one way to name a control:
                  aria-label → visible text → title), toolbar-overflow fades +
                  `data-collapse` compaction (whole groups, or — with `data-collapse-units`
                  and `data-collapse-units-from` — the pieces inside one group: the declared
                  order is flattened into one sacrifice sequence and `shortestFit()`
                  binary-searches the *shortest prefix* of it the bar actually needs, caches its
                  probes, then verifies its own answer — walking back over any cut that turns out
                  not to have been needed, and falling back to a bounded scan when hiding more of
                  the bar made it *wider* (a fold marker, a control that grows when its neighbour
                  is hidden); a group
                  that declares pieces is never given up as a whole). A bar may also declare
                  `data-collapse-scope`, in which case its selectors are resolved against that
                  ancestor instead of the bar — which is how Files' Places sidebar is a rung of the
                  toolbar's own ladder instead of a second width threshold that has to be kept in
                  step by hand (see `files.js`: a hidden `.files-side-labels` marker the sidebar
                  reacts to with `…is-collapsed ~ .files-side`)
                  + the sticky ⋯ overflow menu (watched by a
                  ResizeObserver *and* a MutationObserver, with `refresh()`),
                  coarse-pointer/long-press helpers, `importLimits(store)` (limits derived
                  from measured headroom, capped by the 4 MiB documented constants) and
                  file-import using them, VERSION (the single source of the version string),
                  and the colour maths everything else measures with — `hexToRgb` / `rgbOf` /
                  `relLuminance` / `contrastRatio` (WCAG), plus `rgbaOf` and `mixOver` for
                  compositing a plate over a sampled pixel
src/apps/
  index.js          APPS array — the order here is the Start menu / desktop order
  <app>.js          default-exported { id, name, icon, size, keywords, mount(ctx, win) }
tests/
  serve.mjs         tiny static server used by both the browser tests and screenshots
  fs.test.mjs       node:test unit tests for VirtualFS/Store (no browser)
  geometry.test.mjs unit tests for the window maths
  storage.test.mjs  unit tests for the quota probe, re-probing after a refusal, and the
                  limits derived from it
  contracts.test.mjs unit tests that read the source: rules that must stay *shared* (one
                  control list, one zone table, one keyboard-claiming rule, one browser fixture)
                  rather than copied into a second file, a reference table in the README for
                  every `data-*` diagnostic the core writes — in both directions, so an
                  undocumented diagnostic and a documented one nothing writes both fail — the
                  token contract: every `var(--x)` the stylesheet paints with is defined in
                  `theme.css` or written at runtime by `theme.js`, and a *text-colour* token is
                  defined for both themes or listed as deliberately theme-independent with a
                  reason (mutation-tested: deleting one light-theme definition fails the suite) —
                  and the ink-painting contract: any rule block in `os.css` that *rebinds* an ink
                  token must also declare a `color:` in the same block, and every ink token defined
                  in `theme.css` must be painted with somewhere in `os.css` (also mutation-tested:
                  deleting `.term`'s `color: var(--text)` makes that block the single failure),
                  and the shell's argument contract: every flag a command reads as taking a value
                  (`numFlag(args, '-n')`) must be passed to `fileArgs` as a value flag by that
                  same command, and every flag passed there must be one it reads — the two halves
                  of an argument parser drifting apart is what made `sort -n notes.md` read no file
  fit.test.mjs      unit tests for `shortestFit` — the rule the toolbar collapse depends on,
                  tested without a browser: nothing given up when nothing is needed, the exact
                  prefix needed, everything when that is not enough, a probe count that does not
                  grow with the length of the list, and what the search does when hiding more of
                  the bar makes it *wider* (a fold marker, a control that grows when its
                  neighbour is hidden) — including one test that states what it deliberately
                  cannot see
  a11y.mjs          accessibility audit helper: named controls, labelled windows
  names.test.mjs    unit tests for name truncation: when a name may be split so its extension —
                  or, for a name with no extension, its last delimiter run — survives the
                  ellipsis, the cases where it must not be split at all, and that a tail keeps
                  its delimiter (the cut is lossless)
  wallpaper.test.mjs unit tests for the wallpaper ink: every shipped preset must reach 4.5:1 with
                  the ink it gets, the choice is made against the *worst* point of a gradient and
                  not its average, a wallpaper with no measurable colours falls back instead of
                  guessing, the samples route and the CSS-string route agree, a bare data URL is
                  turned into CSS that a browser will accept, a mid-tone wallpaper gets a plate
                  rather than the less bad ink, a wallpaper that already reads gets none, the
                  plate is the ink's own plate (light ink gets a dark one, dark ink a light one),
                  that the plate's alpha is derived — as strong as the shortfall and no stronger,
                  monotone in it, never stronger than the fixed value it replaced, and never above
                  the cap — over a 400-wallpaper sweep that checks the number reported is the
                  number measured, and `mixOver` / `rgbaOf` — the compositing the plate claim
                  rests on
  token-contrast.test.mjs unit tests that read `theme.css` and measure it: every ink level clears
                  4.5:1 on every surface of its own theme *and* on its accent's own tint, the three
                  levels stay a visible factor apart, every accent preset clears 4.5:1 as text in
                  both theme columns, the terminal's palette is rebound *and actually painted with*
                  (`.term` must declare `color: var(--text)`, not merely rebind the token), and the
                  light theme resolves `--accent-text` to its own column
  contrast.mjs      the rendered-text contrast audit, not a test file: walks every visible text run
                  in a live page, hit-tests a sample grid so only points where that run is the
                  topmost thing are used, composites the run's declared ink over the background the
                  browser actually painted, and classifies monochrome glyphs from colour glyphs by
                  geometry. Documents its three exemptions (under a modal, a glyph that has a name,
                  disabled controls) and counts each one. `assertReadable(result, where, { minRuns,
                  expect })` turns it into an assertion: `minRuns` is a floor that proves the audit
                  is looking at a page, `expect` is the claim that it measured *this* screen — every
                  string or pattern in it must have been measured as a run of text, or the audit
                  fails and names what it did not see.
  png.mjs           a dependency-free PNG decoder (8-bit, non-interlaced, colour types 2 and 6) over
                  `zlib.inflateSync`, so the audit measures real pixels without a library
  contrast-probe.mjs dev tool: the audit over the shell, every menu, a dialog, the terminal with
                  real output, and every app maximized, in both themes — 28 sections (not part of
                  `npm test`; it takes minutes, not seconds)
  browser/          the Playwright suite, split by area. One Chromium per file; 131 tests, and the
                  whole 219-test run takes ~44s at the default concurrency on a 24-core box (it was
                  93s at `--test-concurrency=2` when this suite was 108 tests — the single
                  3800-line file this split replaced took 158s serially and broke whenever a test
                  was reordered).
    fixture.mjs       the only file that imports playwright or starts a server: before()/after()
                      boot one browser per area file, and `desktop()` gives every area the same
                      helpers — openApp/closeApp/closeAll, setWidths, runCommand, the dialog
                      spies, resetStorage. `setWidths` waits for the *layout* to settle (every
                      bar's box, its chosen cut level and its pass counter unchanged across two
                      polls), because a ResizeObserver-driven fit is not finished when the resize
                      is.
                      `widthWhere()` bisects for the widest window where a claim about the page
                      is true, so tests describe the *shape* of a collapse ladder instead of
                      asserting at remembered pixel widths. Its helpers mirror the core (they
                      resolve `data-collapse` through `data-collapse-scope` the same way
                      `watchToolbarOverflow` does).
    desktop.test.mjs  shell, desktop icons, taskbar, session restore, toasts, dialogs, touch,
                      upload
    windows.test.mjs  focus/minimise/maximise/close, drag, snap, keyboard geometry, resize
                      handles, the window menu, the Tab ring, and who owns the keyboard when an
                      app opens
    toolbars.test.mjs every toolbar collapse, overflow, fold and fit claim, including the deep
                      breadcrumb that makes a bar run out of rungs
    terminal.test.mjs commands, pipes, redirects, history, user-defined variables, globs,
                      `$(…)` command substitution, aliases (definition, expansion at the point of
                      use, quoting, Tab, `unalias`, a body that is a whole command line), `sed`/`tr`
                      as pipe filters (including that each accepts exactly what its own `man` page
                      says it accepts), `~/.shellrc` and `source`, `help` as an index whose every
                      `man` pointer resolves, `help`/`man` wrapped to the width the window actually
                      has at three widths, and several files at once (grep prefixes, mv/cp into a
                      directory, a glob in a redirect naming itself)
    files.test.mjs    listing, filtering, sorting, a folder that is not there (in the window and
                      in the saved session), and a file name whose extension survives truncation
    apps.test.mjs     editor, paint, viewer, web, settings, welcome, storage headroom, pinch zoom,
                      and the desktop's labels measured against every wallpaper preset — including a
                      check that the wallpaper sampler's answer is not more optimistic than a
                      brute-force scan of the same pixels, and a 2-pixel band in a 1200×800 canvas
                      that no grid of any step would have found
    measure.mjs       shared measuring instrument, not a test file: `paintCssBackground` rebuilds
                      a CSS gradient as a real canvas gradient, because `fillStyle` cannot be
                      *told* a gradient and silently paints black instead. The WCAG helpers are
                      re-exported from `src/core/utils.js` rather than reimplemented here, so the
                      instrument and the app cannot drift apart
    a11y.test.mjs     the accessibility audit (which is itself tested)
    contrast.test.mjs the rendered-text audit asserted in the browser: the shell with its Start menu,
                      context menu and a dialog open, the terminal with real output, Files maximized,
                      in both themes; the weakest accent on its own tint; **every registered app
                      opened once** in one theme, each claimed by its own window title; a self-test
                      proving the audit fails on text that is not readable; and a self-test proving
                      the coverage claim fails on text that is not *there* (as a string and as a
                      pattern), passes on text that is, and fails an audit of a selector that matches
                      nothing. Every screen names the labels it must have been measured on.
  measure-toolbars.mjs  dev tool: measures every app's toolbar at its declared default and
                  minimum width (plus any widths you pass on the command line), opens the ⋯
                  when there is one, and prints what is off the edge, named, with the width
                  of every control in the bar and how many Places labels the window is showing
                  (not part of `npm test`)
  capture-substitution.mjs dev tool: one screenshot of the one screen a shell change affects
                  (`shots/12-terminal-substitution.png`), plus a second frame with the fixture
                  removed. It exists because `npm run screenshots` regenerates eleven shots, and
                  judging a text-output change should not cost all of them (not part of `npm test`)
  probe.mjs         dev tool: one bar, one or more widths — the settled state (what it gave
                  up, whether that was enough, which rungs actually bought room, and how many
                  milliseconds measuring them took), then what the bar would do at every cut
                  level. Takes an app id, or a Files path with `--mkdir=` to create the folders
                  first, because Files' bar and its Places sidebar are one decision now (not part
                  of `npm test`)
  measure-crumb.mjs dev tool: the real rendered widths inside a collapsed crumb — how wide a
                  12ch box actually is, how much of it a tail of N characters takes, and where
                  the head stops existing (not part of `npm test`)
  measure-desktop.mjs dev tool: the desktop label's box — how many zero-width glyphs fit a line
                  of it, how many lines the head is allowed, where the label ends relative to its
                  grid row, and what a two-line head does to a long name (not part of `npm test`)
  screenshot.mjs    writes PNGs to shots/; the widths it captures at are found by bisection
                  and printed, so a caption cannot go stale when the layout moves. Every file it
                  creates is registered with a `track()` helper and removed in one `finally`, so
                  a crashed run cannot leave fixtures behind for the next one. It also prints a
                  contrast report per theme — WCAG ratios computed from the computed styles, and
                  for anything on the wallpaper, from the wallpaper's actual painted pixels — and
                  a **token report** for both themes: the pairs a status colour and an accent
                  colour are used in (ink on a surface, ink on a fill), measured whether or not a
                  window is open to paint them, flagged under 4.5:1
```

`screenshot.mjs` writes 41 numbered shots. Two of them are the terminal's `help` index (`41-`, `42-`),
taken with the Files window closed — in the first version of that capture the Files window overlapped
the terminal and text that was not clipped *looked* clipped, which is the kind of finding a screenshot
is supposed to give you and this one nearly did not. A handful of files in `shots/` (`90-`…`98-`, and
`39-light-danger-button.png`) are leftovers from earlier iterations' ad-hoc before/after captures:
nothing in this copy regenerates them, and they are kept only because older notes in
`proposed-improvements.md` refer to them.

## The two contracts everything else builds on

1. **App contract** — `mount(ctx, win)` returns an optional cleanup function that the WM
   runs on close. `ctx` = `{ bus, store, fs, theme, apps, accents, wallpapers, wm, shell,
   launch, openPath, toast, dialogs, version }`. `win` = `{ id, appId, el, body, data,
   title, setTitle(), minimized, maximized, cleanup, onCloseRequest }`. `win.data` is what
   gets persisted for session restore. Setting `win.onCloseRequest = () => boolean` lets an
   app veto a *user-initiated* close (the Editor uses it for unsaved changes).
2. **FS contract** — every app that touches files goes through `ctx.fs` and listens for
   `fs:change` so the desktop, Files and open editors stay in sync. `fs.counts()` is
   cached and invalidated by mutations; the tray and Settings read it instead of walking
   the tree.
3. **Toolbar contract** — an app's spec may declare `width` and `minWidth`, and its
   toolbar may declare `data-collapse=".a, .b"`: the groups it is willing to give up, worst
   first. A group may instead offer its *pieces* (`data-collapse-units`) — the segments of a
   breadcrumb, the swatches of a palette, or the word on a button whose glyph already stands
   alone — and those pieces are given up one at a time, before the group. A group may live
   *outside* the bar (`data-collapse-scope`), which is the only way one layout can have one
   width decision instead of two. The core only ever compacts when the bar genuinely cannot
   fit, only in the order the app chose, and only as far as it has to: the given-up set is
   always a *prefix* of the flattened order, and a test asserts that putting back the last thing
   the bar gave up makes it overflow again. Because a prefix order can only give back more as
   the window grows, widening a window can never take a control away — asserted directly, per
   affordance, over a 320→840px sweep. If anything is *still* out of reach the core adds a
   sticky ⋯ whose menu lists exactly those controls and activates them. So `minWidth` is a
   promise about **reachability**, not about the bar fitting whatever content it is showing, and
   a test checks it at both widths — and below.

## Entry points

- Browser: `index.html` → `src/main.js` (`boot()` restores the saved layout, or opens
  Welcome on first run).
- Dev: `npm start` (or `python3 -m http.server 8080`). ES modules need an HTTP origin, so
  opening `index.html` from the filesystem does not work.
- Console: `window.browserOS.{bus, store, fs, theme, wm, shell, dialogs, apps, launch, openPath}`
  — the same `ctx` the apps are given, which is also how the browser tests drive the OS.

## Running and testing

```
npm install && npx playwright install chromium   # once
npm run test:unit      # VirtualFS + Store + storage budget + geometry + name splitting +
                       # wallpaper ink + source contracts (including that the `help` index files
                       # every command and points only at pages that exist) + the toolbar-fit rule,
                       # no browser
npm run test:browser   # Playwright smoke tests (boots its own static server, ephemeral port)
npm test               # both — 231 tests (90 unit + 141 browser), ~110s at the default concurrency
npm run screenshots    # writes shots/*.png; the contrast report is printed, the token report throws
node tests/contrast-probe.mjs [theme]  # the rendered-text audit over every app, both themes
node tests/measure-toolbars.mjs [widths…]   # what every bar actually gives up, per width
node tests/probe.mjs <app|path> <widths…>   # one bar, every cut level, at the widths you ask for
node tests/measure-desktop.mjs             # the desktop label box and what fits in it
```

`PORT=… npm start` picks another port for the dev server. `node_modules` in this version
directory is a symlink to the original project's `node_modules`; nothing here installs its
own copy.

## Deliberately simple / unfinished

- No bundler, no framework, no components: everything is hand-rolled DOM + `el()`.
- The filesystem is a single JSON blob in `localStorage` (whole tree rewritten on every
  debounced change). No per-file keys. Import limits are now derived from the storage that
  is actually free (`store.headroom()` minus a 64 KiB reserve), capped by the documented
  4 MiB per-file / 4 MiB per-batch constants; refusals name the file and the free space.
  The quota is probed once per page load and cached, and re-probed only after a write the
  browser actually refuses (at most one re-probe per 30s), so a quota that shrinks
  mid-session is noticed when it bites rather than on a timer.
- The terminal is a small shell, not a real one: it has `;` groups, `&&`/`||` chains that
  honour the stage that failed, `|` pipes with eight stdin filters (`grep` — including `-n`,
  `head`, `tail`, `wc`, `sort`, `uniq`, `sed`, `tr`), `>`/`>>` output redirects, `2>`/`2>>` error
  redirects, `2>&1` (the error joins the output stream) and `&>`/`&>>` (both streams into
  one file), `<` input redirects for any command, bash's pipeline semantics (the last stage
  decides the pipeline's status, and a stage that failed still pipes what it produced), and
  `Ctrl+R` reverse history search, and `$HOME`/`$PWD`/`$OLDPWD`/`~` expansion in every word
  a command reads — arguments *and* redirect targets, stopped by quoting — plus `cd -`,
  which goes back to the directory the shell just left (it toggles, it works inside a
  chain, it refuses when there is no previous directory or it has been deleted, and the
  prompt and title follow it). It has **user-defined variables**: `NAME=value` before a command
  defines one, `set` lists them (quoted, so an empty value is distinguishable from a missing one),
  `unset` removes one, `export NAME=value` is the same thing with the words preserved, and
  `man variables` explains it. The built-ins (`HOME`, `PWD`, `USER`, `OLDPWD`) refuse assignment.
  It has **globs**: `*`, `?` and `[abc]` expand against a directory listing, `?` is exactly one
  character, a pattern that matches nothing is left exactly as typed so the command can say what
  happened, and quoting stops a glob exactly as it stops `$NAME`. Variables expand before globs, so
  `ls $DOCS/*.md` works. Commands that take file arguments take the whole expansion — `ls` lists
  several targets, `wc` names each file and totals them, `head`/`tail` label each one — and a flag
  that takes a value (`-n 5`) swallows it, so `head -n 2 notes.md` reads `notes.md`; which flags
  swallow is decided *per command* (`head`/`tail` take `-n`, `sort`/`wc`/`ls`/`mkdir` do not),
  because a shared list made `sort -n notes.md` read no file at all. `mv` and `cp` accept several
  names with a directory last (`mv *.txt out/`), and `cd` refuses more than one directory rather
  than picking one for you. `grep` over several files prefixes each match with the filename
  (`a.txt:2: …` with `-n`, per file); one file or piped stdin gets no prefix.
  It has **command substitution**: `$(command)` runs a command and puts its output where you
  typed it, in the middle of a word if that is where it was typed. `run()` is `run()` (history,
  echo, status) over `execute()` (the body), and `captureLine()` runs `execute()` with the output
  buffered instead of painted — which is also why the last stage of a line has to be told there
  is no screen. An unquoted result is word-split into several arguments; quoting stops it exactly
  as it stops `$NAME`; the inner command's own errors go to the screen, not into the value, so
  `$(cat missing)` expands to nothing *and* says why; nesting is capped at six; `$(…)` is
  protected from the outer `;`, `|`, `&&` and `>` by paren-depth tracking in all three splitters.
  `true` and `false` exist so `&&`/`||` can succeed or fail on purpose. `man substitution`.
  A glob in a redirect target is not expanded — a target is a name — but the shell adds a note
  naming the file it just made, so `echo x > *.out` does not leave a `*.out` to be explained later.
  It has **aliases**: `alias ll='ls -l'` names a whole command line, `alias` lists them, `alias ll`
  shows one, `unalias ll` takes one back, Tab completes them, and `man aliases` explains it. They are
  expanded by `expandAliasText()` **on the raw line, before it is split into commands**, because an
  alias stands for a command *line*: the shell walks the text, keeps track of quotes and `$( )`, knows
  which words are in a command position (start of the line, after `;`, `|`, `&&`, `||`, `(`, or after
  a `NAME=value` word), and splices the body's text in at that point. Expanding tokens instead was a
  real bug — `alias docs='cd ~/Documents && ls'` put `&&` and `ls` in the argument list of `cd`.
  Only a word in a command position is looked up (a quoted `"ll"`, an `a=ll` argument and `echo ll`
  are not aliases); the body is re-scanned and re-expanded at the point of use, so `$VAR` inside a
  body means what it means *that* time and `alias ls='ls -l'` terminates instead of looping.
  Like variables they are session state: not persisted, gone in a new terminal — unless they are in
  `~/.shellrc`, which is the next paragraph.
- **A startup file, and `source`.** `~/.shellrc` is read when a terminal opens, after the banner and
  the motd, by `runScript()`: one line at a time through the same `execute()` you type into, so a
  line that fails is reported and the next line still runs. It is an ordinary file — listed by `ls`,
  opened by `edit`, shown by Files — and it is never created for you: an absent file says nothing, a
  present one reports how many lines it ran and what it defined. `source <file>` runs the same thing
  in a shell that is already open, `source missing.txt` refuses rather than looking like it worked,
  and a file that sources itself is refused (a depth guard, `sourcing[]`, capped at 8). The seed ships
  one with two aliases in it. `man startup` states the rules.
- **`help` is an index, not a manual.** `COMMAND_GROUPS` files every command under Files / Text /
  Shell / Apps & desktop / System; a command in the table but in no group is printed under "Ungrouped
  (a command nobody filed)" and both a browser test and a `contracts.test.mjs` guard fail. Below the
  commands, `SHELL_FEATURES` gives one line per feature of the shell itself with a `man <topic>`
  pointer, and `man` with no argument prints an index generated from `TOPICS` rather than a list typed
  out next to it. `wrapDoc()` word-wraps with a hanging indent so a wrapped description stays under
  the column it belongs to, and `termCols()` measures how many monospace characters the output area
  can actually show (the font is monospace, so one measured glyph is the answer) so the table is
  wrapped for *this* window — 86 columns at the default 700px, 40 at the 340px minimum — instead of
  for a width somebody guessed. `man` pages are wrapped the same way, keeping their own indentation.
  And it has **filters that edit text**: `sed` (`s/find/replace/[gi]`, any delimiter, `&` for the
  match, or `/find/d`) and `tr` (`[-d] <set1> [set2]`, ranges like `a-z`, a short set2 replicated),
  both reading the pipe the way the other filters do.
  Output lines have four levels and each one is a class the terminal owns: `err` for a failure, `ok`
  for a success, `note` for something the shell is telling you whether you asked or not (a name that
  will surprise you later, a `sed` that matched none of its input), and `dim` for help you asked for.
  `note` and `dim` are two different inks in the terminal palette, not one ink under two names.
  What it still does not have: job control, backticks for `$(…)`, a quoted `)` inside `$(…)`. `2>&1 > f` and `> f 2>&1` mean
  the same thing here. `sed` is a subset (no address ranges, no `n`/`p`, no `-i`), `tr` is
  byte-oriented and takes no file arguments, and both refuse a flag they do not implement rather
  than ignoring it.
- `help`'s two-column table is kept at every width the terminal can be resized to, which at 340px
  means about ten characters of description per line. It is legible and the columns survive; a
  narrow-width mode that drops to `name: description` lines instead would read better and is not
  written. The seed also puts a `~/.shellrc` in every new home, so `ls` in a fresh session lists a
  file the OS wrote — deliberately, because a startup file you cannot see is the kind of thing that
  makes a shell behave differently for reasons nobody can find.
- **Which form of a path a command prints** is a decision, not an accident: output labels use the
  form you typed (`wc -l a1.txt` says `a1.txt`, `wc -l ~/x/a1.txt` says the path you wrote),
  because that is what real `wc` does and what you can retype; errors use the resolved absolute
  path, because the point of an error is to say which file it means. A third command should copy
  this rule rather than either of the two commands that already follow it.
- Window snapping is halves/quarters/max via drag-to-edge, the window menu or Alt+arrows;
  there is no interactive tiling manager (no half-screen split view, no snapping to another
  window's edge).
- Who owns the keyboard when a window opens is one rule, `claimFocus()` in the core: an app may
  focus its own main control a beat after it opens (so you can type straight away) or after you
  click inside it, but only if nothing else has taken focus in the meantime. Three apps used to
  do this with their own `setTimeout(..., 30)`, which took the keyboard back from a taskbar
  button or another window — and, because the shell refuses to treat arrow keys as window
  commands while a text field has them, that is what made Alt+Arrow snapping fail once every
  ten runs of the test suite.
- Files falls back to home when the path it was opened on is gone, and says so in the window:
  which folder it could not find, that it is showing home instead, and a button to create the
  folder it was asked for. A toast alone was gone before you looked, and a window that quietly
  showed home looked like an empty home.
- Session restore is best-effort: app, `win.data`, rect and maximised/minimised flags.
- The Web Browser app is an `<iframe>`; sites that send `X-Frame-Options` look blank, but
  the app now explains that and offers "Open in a real tab".
- Touch support is real but still not first-class: long-press context menus on icons,
  Files cells and taskbar buttons (deduplicated against Android Chrome's native long-press
  menu), tap-select-then-tap-open on icons and Files cells, and anchored pinch-zoom in
  the Viewer (the point under your fingers stays there; 10–800%). There is no
  pinch-to-pan window gesture and no touch affordance for dragging windows beyond
  `touch-action: none`.
- Accessibility is now audited, not assumed: `tests/a11y.mjs` walks the shell, every open
  menu, a real dialog and all nine app windows and fails on any control without an
  accessible name; windows are asserted to be labelled dialogs whose name follows
  `setTitle()`; and a test proves the audit itself still finds a deliberately broken
  control. Tab wraps inside the window you are working in, and both the ring and the audit
  ask the *same* `isUsableControl()` for what a control is (`tests/contracts.test.mjs`
  fails if either grows its own copy again). The audit still checks names, not full
  screen-reader semantics.
- Toolbar compaction exists for the two bars that genuinely need it (Paint, Files). Other
  apps fit their toolbars at their declared `minWidth` without help; adding a control to
  one of those bars may break that promise, which the width test will catch. Two groups are
  offered as *pieces* (`data-collapse-units`) rather than all-or-nothing: Files' breadcrumb
  gives up the segments nearest the root one at a time — `~ / … / notes / deep` before
  `~ / … / deep` before the trail goes — and Paint's palette gives up its swatches from the
  end of the row. Measured with `node tests/probe.mjs paint 680 640 600`: a 680px window
  keeps four colours, 640px keeps two, 600px keeps one, and 560px gives up the whole palette
  plus the size readout. Files' declared order is the create pair → **the Places words** → the
  word on the pair's replacement → Sort → Upload → the filter box (shrunk, not removed) → the
  breadcrumb, and every one of those can be given up, so nothing at the end of the bar is
  exempt. The Places sidebar is in that order through `data-collapse-scope`: `files.js` declares
  a hidden marker as a rung of the bar's ladder and the CSS reacts to it, so there is one width
  decision for that layout instead of a sidebar breakpoint and a toolbar breakpoint that had to
  be kept in step. The create pair is the one thing in this project that changes *shape* when it
  is given up: below the width where both labelled buttons fit they are replaced by a single
  `＋ New` button whose menu names both actions, and the word on that button is itself a later
  unit in the order — the pair goes first because folding it costs the user nothing, and the
  126px of the sidebar is only taken after that free 90px has been spent. The current folder is
  the last unit in the breadcrumb group (`.crumb-last`): it is never hidden, only shortened —
  capped at 160px normally and at `12ch` when the bar has run out of everything else, with the
  full name kept in the button's accessible name and tooltip. When the folder the window was
  asked to open is not there, the trail ends in a **dead-end crumb** (`.crumb-gone`): the name
  struck through, marked `missing`, and not a button — it carries its own separator so hiding it
  cannot leave an orphan `/`, and it is the first thing the bar gives up, ahead of the create
  pair. `win.data` keeps `path` (what is shown) and `requested` (what was asked for) separately,
  so a restored session still knows the folder it could not open, and goes to it if it came back. Measured with
  `node tests/probe.mjs /home/user 360 540 640 760`: 760px and above shows both create
  buttons; 640–540px shows one button with its word; below ~460px the word is gone and the
  button keeps its `＋`. At the declared 360px minimum a bar showing `~` fits with nothing in the
  ⋯; a bar showing a folder with a name is over, and the ⋯ names what fell off — which is the
  promise the spec actually makes.
  What `12ch` actually buys was measured rather than argued (shots/27–29, and
  `node tests/probe.mjs ~/Documents/<name> 360 --mkdir=…`): the cap resolves to 82px at the
  12px crumb font, which shows about eleven Latin characters of a 54-character single word
  (`extraordinin…`) or five of a twelve-character CJK name (`日本語のフ…`) — CJK is about twice
  as wide per character, so a cap written in `ch` is a cap in Latin. The bar's overflow at 360px
  is the same 465px for a 54-character word, a 48-character hyphenated name and a 12-character
  Japanese one, because the name is bounded by the cap and not by its length. What closes the
  loop for a *folder* is that the name is never lost, only summarised: full in the crumb's
  accessible name and tooltip, and in the window title bar (A46: `.wtitle` and `setTitle()` carry
  a `title` attribute, so a title the bar truncates can still be read in full). For a *file* the
  half that gets thrown away is the half that carries meaning, so the grid cuts the other end:
  `splitName()` (`src/core/utils.js`) splits a long name into a head the layout may ellipsise
  and a tail it must keep — `.tar.gz` stays on screen, `.docx` stays, a dotfile or a chain of
  dotted words is left whole, and a compound extension is kept whole rather than cut to `.gz`.
  There is still one truncation mechanism (the ellipsis on `.name-head`); the split only decides
  which half it may eat. `splitName` is `splitExtension` plus one more case: a name with **no**
  extension is split at its last delimiter run, so a folder or marker name keeps the part that
  says which one it is (`release-2024-…-snapshot` keeps `-snapshot`, `…-final` keeps `-final`,
  the delimiter is kept with the tail so the cut is lossless). The tail is capped at 8
  characters — measured, not chosen: in the 12ch crumb box (82px, 70px of text) a 13-character
  tail leaves 0px for the head, an 8-character tail leaves 12px. What is *not* done: middle-ellipsis for folder names in the breadcrumb,
  where eleven characters of a word you have never seen is not a recognisable name at any
  ellipsis position in an 82px box. A47 closed the other half:
  `data-collapsed` is now paired with `data-collapsed-exhausted` (the bar applied every rung it
  may and still does not fit) and `data-collapsed-effective` (how many of those rungs actually
  changed the measured bar — found by un-applying them one at a time, capped at 48 reads, and
  reading both `scrollWidth` and `clientWidth` because the sidebar rung buys room by making the
  bar *wider*). The cap is a measurement, not a guess: an 18-folder-deep path costs **1.5ms** to
  walk, once per content, so the limit exists to bound a pathological ladder and not to save the
  user from a cost (`data-collapsed-effective-walk-ms` is in the DOM for the same reason the
  other counters are). A rung whose whole job is shortening the current folder's name buys nothing when
  the folder is called `Documents` and buys something when it is called sixty characters; a test
  asserts exactly that shape, plus a lab bar where the no-op rung is isolated and reported as two
  effective of three applied.
  That walk is cached against the *content* it measured (ladder length, the cut level it walked
  from, and the bar's content width at that level), because what a rung buys is a property of the
  bar's content, not of how wide the window is: dragging a window that has run out of rungs
  re-decides its layout on every resize event but walks the ladder once. `data-collapsed-effective-walks`
  is in the DOM so that is observable rather than asserted — a Files window 12 folders deep has a
  20-rung ladder, 19 of which buy room, 117px still over at the declared minimum
  (`node tests/probe.mjs <deep path> 360`), and eight resizes of it take one walk. A ladder
  longer than 48 rungs reports `unmeasured` with `data-collapsed-effective-limit`, because
  "nothing bought anything" and "nobody looked" read identically and only one of them is true.
  `watchToolbarOverflow()` finds the shortest prefix of the declared order the bar needs
  (`shortestFit`, unit-tested in `tests/fit.test.mjs`) and then walks back over any cut
  that turns out not to have been needed, so nothing stays hidden that the bar does not
  need hidden; `tests/measure-toolbars.mjs` prints how many pieces each bar gave up at its
  declared minimum, and the width sweep asserts the given-up set is always a prefix of the
  declared order. Tests that care about *where* a rung happens ask for it: `widthWhere(lo, hi,
  predicate)` bisects for the widest window where a condition about the page is true, so no test
  or screenshot carries a remembered width again.
- The desktop icon grid fills rows and wraps (it used to flow by column, which laid every
  icon out to the right and pushed five of nine off a 420px screen), and it scrolls: with
  more files than the screen shows, the last ones are reachable by scrolling and new windows
  are placed below only the icons actually in the viewport. There is no paging or
  multi-page desktop.
- Name truncation is one mechanism with two cases, applied everywhere a name is cut: the Files
  grid, the breadcrumb's last crumb and its dead-end crumb, and the desktop's icon labels
  (`splitName` / `nameParts`, `tests/names.test.mjs`, `tests/browser/{files,desktop}.test.mjs`).
  A name with an extension keeps the extension; a name without one keeps its last delimiter run.
  A desktop label wraps, so the line a clamp throws away is the last one — which is where the
  extension was. Its head is its own two-line clamped box (measured: 92px of text room, ~13
  glyphs a line, ~26 across the two lines; `node tests/measure-desktop.mjs`), the tail is a
  separate line under it, and the grid row track is 108px because a 92px one could not hold the
  taller icon. Line breaks prefer a hyphen to the middle of a number (`overflow-wrap: break-word`).
  A **folder** name in the middle of the breadcrumb is still end-ellipsised at the `12ch` cap and
  is not middle-elided — deliberate: inside an 82px box, eleven characters of a word you have
  never seen is not a recognisable name at any ellipsis position, and the full name is always
  available in the accessible name, the tooltip and the title bar.
- Anything drawn *on the wallpaper* gets its ink from the wallpaper, not from the theme.
  `Theme.apply()` paints the wallpaper into a canvas capped at 640px on the long side
  (`paintCssBackground`, `src/core/utils.js`) and `sampleCanvas()` reads **every pixel** of it,
  keeping the darkest and lightest colour in each of 128 logarithmic luminance bands. A grid —
  nine points, then thirty-two — was the previous answer and it fails the same way however fine it
  is: a detail thinner than the step is invisible to it, so a 4K photograph read at 32 points is a
  measurement of a wallpaper that is not the one on screen. Bands keep the promise the decision
  actually needs (the worst contrast against an ink is attained at the colour nearest that ink's
  luminance, and no colour is more than about 9% of luminance from a sample), which is a number the
  tests assert against a brute-force scan of the same pixels. `wallpaperInkFromSamples()`
  picks the ink whose **worst** point is the most readable and writes `--wallpaper-text` /
  `--wallpaper-shadow` onto `<html>`. If even the better ink's worst point is under 4.5:1 — a
  mid-tone photograph, a sunset gradient — the label gets a **plate**: a dark rgba under light
  ink, a light one under dark ink, at the **weakest alpha that clears 4.5:1 on that wallpaper**
  (`plateAlphaFor` bisects for it, capped at 0.9 because past that it is a panel and not a plate),
  and the reported ratio is measured *through* it by compositing (`mixOver`). A fixed alpha was a
  guess about the wallpaper: a near-miss and a real mid-tone cannot both need the same slab. The
  plate is painted as `background` plus a 3px `box-shadow` spread and defaults to `transparent`, so
  it costs no layout on a wallpaper that does not need one. The desktop labels are the only
  consumers today; they are the only text in the OS with no surface behind them, and the tiles
  under their glyphs are derived from `--wallpaper-text` for the same reason — a tile that follows
  the theme instead of the ink can end up the same brightness as the glyph it holds. A `url()` wallpaper — an upload — cannot be painted from a string, so the theme loads the
  image and measures its pixels instead, and `theme.wallpaperInkRatio` stays `null` until
  something has actually been measured rather than reporting a number that was guessed. Settings
  prints what the measurement found (ratio, plate, or "could not be measured") and follows the
  `wallpaper:ink` event. WCAG maths (`hexToRgb` / `relLuminance` / `contrastRatio` / `rgbaOf` /
  `mixOver`) lives in `utils.js` so the theme, the tests and the screenshot report cannot grow
  three slightly different formulas.
- A colour that is used as *text* is a different token from the same colour used as a *fill*.
  `--ok` / `--warn` / `--danger` / `--accent` are fills — a toast border, a button background, a
  strikethrough, a selected state. Their text counterparts are `--ok-text` / `--warn-text` /
  `--danger-text` / `--accent-text` (ink on a surface) and `--on-danger` / `--on-accent` (ink on
  the fill), each defined per theme and, for the accent, per preset. The reason is measurable:
  `--danger: #ff4d5e` was chosen to read on a dark desktop and the light theme never redefined
  it, so the terminal's error output sat on a white card at 1.63:1, and white on a blue primary
  button was 2.1:1. `tests/contracts.test.mjs` enforces the split — every `var(--x)` in
  `os.css` is defined somewhere, and a text-colour token is defined for both themes or listed as
  deliberately theme-independent with a reason — and `npm run screenshots` **throws** on any pair
  below 4.5:1 rather than printing a table for someone to read. The split now extends past the
  theme: `--accent-text` is `--accent-text-dark` / `--accent-text-light` per preset so an accent
  reads on its own `--accent-soft` tint as well as on a plain surface, and the terminal has its own
  palette (`--term-text` / `--term-dim` / `--term-faint` / `--term-ok` / `--term-danger`) rebound
  inside `.term`, because its canvas is dark in both themes and its text tokens were being asked to
  follow a theme it does not follow. Beyond the tokens, `tests/contrast.mjs` measures *rendered*
  text against the background the browser actually painted, and `tests/token-contrast.test.mjs`
  measures `theme.css` itself. One rule that audit learned the hard way: **rebinding a custom
  property is not the same as painting with it** — text with no `color:` declaration inherits a
  computed colour from the nearest ancestor that has one, so `.term` has to declare
  `color: var(--text)` and not merely rebind `--text` (A64 in `proposed-improvements.md`).
- A wallpaper setting is normalised before it is used. Settings' "Use your own image…" produces a
  bare `data:` URL, and a bare data URL is not a valid `background` value — the CSS parser
  rejects it and the element keeps whatever it had, silently, which is how an upload appeared to
  do nothing. `wallpaperCss()` wraps it (`url("data:…")`) and leaves real CSS alone.
- Only Files remembers what it was *asked* to open (`win.data.requested`). The mechanism is
  general — a window's request and its actual state are different facts, and a session that
  conflates them rewrites what the user asked for — but no other app has a request that can fail
  in a way worth showing yet.
