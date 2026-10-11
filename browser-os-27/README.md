# Browser OS

A desktop environment that runs entirely in a browser tab — windows, a shell, a virtual
filesystem, and nine small apps. Plain ES modules, no build step, no runtime dependencies.

```
python3 -m http.server 8080        # or: npm start  (PORT=… to pick another port)
open http://localhost:8080/
```

ES modules need an HTTP origin, so opening `index.html` straight from the file system won't work.

---

## What's in it

**Window manager** — drag title bars, focus and z-order, minimise, maximise (button,
double-click the title bar, or drag to the top edge), and edge snapping: drag a title bar
to the left or right edge to tile half the screen, a corner to tile a quarter, and the
preview that appears while you drag **says which zone it is showing** ("Left half",
"Top-left quarter"). **Right-click a title bar** for the same tiling as a menu, so the
feature does not have to be discovered by dragging — and for **Undo move**, which puts the
window back where it was before the last drag, nudge, snap or resize. Grabbing the **middle of a window's top
edge moves it**; only the parts of that edge near the corners resize, and the corner
handles show a grip on hover. Windows are constrained back into the viewport when you
resize the browser. A toolbar that genuinely cannot fit its buttons **compacts the groups
its app is willing to give up** (Paint's colour swatches, button labels, and Files'
breadcrumb) before it scrolls, and gives up the *fewest* pieces it needs: a bar that only
needs a little room drops one colour swatch, or hides one path segment to show
`~ / … / notes / deep`, rather than deleting the whole group. Nothing is hidden that the
bar did not have to hide. A control may also change *shape* rather than disappear: Files'
two create buttons become one `＋ New` button whose menu names both actions, and the word on
that button is the next thing the bar is allowed to give up — a cramped bar gets a smaller
correct control, not two wordless ones. It marks the side it is really cut off on instead of hiding
buttons silently. If
it still cannot show everything, a sticky **⋯** appears at the visible end listing exactly
the actions that are out of reach, each one marked with the side of the bar it is off — so an
app's declared minimum window width is a promise
that every action is *reachable*, not that the bar fits. Tab
stays inside the window you are working in.

**Virtual filesystem** — a POSIX-ish tree (`~`, `.`, `..`, `/home/user/...`) persisted to
`localStorage`. Every app that touches files goes through the same `VirtualFS`, and a
`fs:change` event keeps the Files app, desktop icons and open editors in sync.

**Shell** — desktop icons, taskbar with running windows (a crowded taskbar scrolls and
fades the cut side instead of silently hiding buttons), Start menu with app search,
right-click context menus (desktop, icons, taskbar items), clipboard copy/cut/paste,
toasts, a clock, and a "show desktop" tray button. On touch devices a long-press opens
the context menu — on icons, Files cells and taskbar buttons — deduplicated against the
browser's own long-press menu, and a second tap on a selected icon opens it. Dropping
real files onto the desktop uploads them into `~/Desktop`. Upload limits are derived from
the storage the browser *actually* grants — `Store.capacity()` probes the `localStorage`
quota once — and a write the browser refuses **throws that measurement away**, so the next
answer is measured again instead of repeating the number that just proved wrong.

**Session restore** — open windows (app, file, position, size, maximised state) are saved
and reopened when the page reloads.

### Apps

| App | What it does |
| --- | --- |
| Terminal | `help`, `ls -l`, `cd` (including `cd -`, which goes back to the directory you came from, and `$OLDPWD`, which names it), `cat`, `echo hi > file`, `mkdir`, `rm -r`, `mv`, `cp`, `tree`, `open`, `edit` (alias `nano`), `launch`, `theme`, `wallpaper`, `df`, `du`, `neofetch`, plus the filters `grep` (with `-n`), `head`, `tail`, `wc`, `sort`, `uniq` — all usable through pipes, output redirects, error redirects and input redirects: `ls -l | grep notes`, `tree | head -n 3`, `wc -l < notes.txt`, `cat file | wc -l >> counts.txt`, `cat missing 2> errors.txt`, `cat missing 2>&1 | grep such` (the error joins the output), `cat missing &> both.txt` (both streams into one file). `&&` runs the next command only if the previous one succeeded, `||` only if it failed, `;` runs regardless, and in a pipeline the *last* command's status is what the chain sees (`cat missing | wc -l` succeeds). `$HOME`, `$PWD`, `$OLDPWD` and `~` expand anywhere a path or a word
is read — `cat ~/notes.txt`, `echo x > $HOME/out.txt`, `cd ~` — quoted words are left
exactly as typed (`echo "$HOME"` prints `$HOME`), an unknown name is left alone rather
than blanked, and Tab completes a half-typed variable (`$HO` → `$HOME`). It also has **your own** variables — `DOCS=~/Documents` defines one, `set` lists them, `unset DOCS` removes it, `export NAME=value` is the same with the words preserved, and `man variables` explains the rules (the built-ins cannot be assigned) — and **globs**: `ls *.txt`, `cat notes?.md`, `ls $DOCS/*.md`, `wc -l *.txt` (which counts every match, names each one and totals them). A pattern that matches nothing is left exactly as typed, and quoting stops a glob just as it stops `$NAME`. It also has **command substitution**: `$(command)` runs a command and puts its output where you typed it — `cd $(pwd)`, `wc -l $(echo a.txt b.txt)`, `echo hi > $(echo out.txt)`, `ls $(pwd) | head` (the inner line is a whole line: its own `;`, `|`, `&&` and `>` belong to it). An unquoted result becomes several arguments; quoting stops it; the inner command's errors go to the screen, not into the value, so `$(cat missing)` is empty and says why; `man substitution`. `mv`/`cp` take several names into a directory (`mv *.txt out/`), `grep` over several files prefixes each match with its filename, and a glob in a redirect target is named back to you instead of silently becoming a file called `*.out`. It also has **aliases**: `alias ll='ls -l'` names a whole command line, `alias` lists them, `alias ll` shows one, `unalias ll` takes it back. The body is stored exactly as typed, so `$VAR` inside an alias means whatever it means when the alias is *used*; only the command word is looked up, so a quoted `"ll"` is not an alias and `echo a=ll` is not one either; Tab completes your own names; `alias ls='ls -l'` is allowed and says so; and `man aliases` explains it. The body is re-read as a whole line, so `alias docs='cd ~/Documents && ls'` runs both halves. And **filters that edit text**: `sed 's/find/replace/[gi]'` (any delimiter, `&` for the match) and `sed '/find/d'`, plus `tr a-z A-Z` and `tr -d ae` — all on whatever a pipe carries: `grep note file | sed 's/ note//'`, `tr a-z A-Z < notes.txt`, `echo hi | tr a-z A-Z`. A `sed` that matched none of its input says so rather than looking like it worked. And **a startup file**: `~/.shellrc` is read when a terminal opens — it is an ordinary file you can `edit`, it is never created for you, and `source ~/.shellrc` re-reads one in a shell that is already open (`source missing.txt` says so rather than looking like it worked; `man startup`). `help` is an **index** grouped by what you are doing, one line per command, plus a list of the shell's own features; `man <command | topic>` is the page that explains something — `man pipes`, `man startup`, `man variables`. Also Tab
completion (command names after a `|`), ↑/↓ history, `Ctrl+R` reverse history search,
quote-aware parsing and `Ctrl+L` |
| Files | Browse, create, rename, delete, upload, drag-and-drop; filter box (`/`) and Name/Size/Newest sort |
| Text Editor | Edits real files in the filesystem, `Ctrl+S` to save, reloads when another app rewrites the file, asks before closing with unsaved changes |
| Image Viewer | Shows PNGs saved by Paint or uploaded from disk; zoom / fit, anchored pinch-zoom on touch (the point under your fingers stays there), and ← → walk the images in the folder |
| Paint | Pen / line (with live preview) / eraser, byte-budgeted undo **and redo**, resize-safe canvas, saves PNGs into `~/Pictures` |
| Calculator | Expression evaluation with keyboard support |
| Web Browser | An iframe with an address bar, back/forward history and a loading state (needs network; some sites refuse to be embedded). Same-origin pages are framed *without* `allow-same-origin`, so their own scripts may be blocked — the status bar says so and offers a real-tab button |
| Settings | Theme, accent colour, wallpapers (including your own image), desktop-shortcut toggle, storage card (measured capacity, used, free), factory reset |
| Welcome | First-run tour |

### Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+T` | Terminal |
| `Ctrl+Alt+F` | Files |
| `Ctrl+Space` | Toggle the Start menu |
| `Alt+F4` | Close the focused window (the editor asks first if unsaved) |
| `Alt+←/→/↑` | Snap the focused window left / right / maximise (`Alt+Shift+…` snaps to the nearest quarter) |
| Focus a title bar | `←/→/↑/↓` move the window, `Shift+arrows` resize it, `Enter` maximises |
| `Ctrl+S` | Save in the editor |
| `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y` | Undo / redo in Paint (only while the Paint window is focused) |
| `Tab` / `↑` `↓` / `Ctrl+R` | Completion, history and reverse history search in the terminal |
| Files grid | `Enter` opens, `F2` renames, `Delete` removes, `/` jumps to the filter box, `Esc` clears it |
| Dialogs | `Enter` confirms, `Esc` cancels, `Tab` stays inside the dialog |

---

## Layout

```
index.html              shell markup (desktop, taskbar, menus, toasts)
styles/theme.css        design tokens, dark/light themes, accent presets
styles/os.css           window chrome, taskbar, and every app's styles
serve.mjs               tiny static server for `npm start`
src/main.js             wires the core together and boots the session
src/core/
  eventbus.js           tiny pub/sub used by every subsystem
  store.js              localStorage wrapper: in-memory fallback, usage(), and a probed
                        capacity()/headroom() so limits match the real quota
  fs.js                 VirtualFS: resolve/list/read/write/mkdir/rm/mv/copy/tree
  dialogs.js            in-OS confirm/prompt modals (no window.confirm anywhere)
  geometry.js           pure window-geometry maths (zones, resize, move, spawn)
  theme.js              settings + wallpaper/accent presets
  wm.js                 WindowManager: lifecycle, z-order, drag, resize, snap, restore
  shell.js              desktop, taskbar, menus, toasts, clock, global keys
  utils.js              el() DOM helper, formatting, toolbar-overflow fades, and import
                        limits derived from measured storage headroom
src/apps/
  index.js              app registry (order = Start menu order)
  terminal.js files.js editor.js viewer.js paint.js calc.js web.js settings.js welcome.js
tests/
  serve.mjs             tiny static server used by the tests, screenshots and `npm start`
  fs.test.mjs           node:test unit tests for the filesystem core
  geometry.test.mjs     unit tests for the window-geometry maths
  storage.test.mjs      unit tests for the quota probe and derived import limits
  contracts.test.mjs    source-level contracts: rules that must stay shared, including that the
                        `help` index files every command and points only at pages that exist
  a11y.mjs              accessibility audit helper (named controls, labelled windows)
  browser/              Playwright suite, split by area, one Chromium per file
    fixture.mjs           the only place that opens a browser or a server: shared desktop
                          helpers (openApp, setWidths, widthWhere, dialogs) + before/after
    desktop.test.mjs      shell, icons, taskbar, session restore, toasts, touch, upload
    windows.test.mjs      focus, drag, snap, keyboard geometry, window menu, focus stealing
    toolbars.test.mjs     every toolbar collapse / overflow / fit claim
    terminal.test.mjs     commands, pipes, history, variables, globs, `$(…)`, aliases, `sed`/`tr`, `~/.shellrc`, several files at once
    files.test.mjs        listing, filtering, sorting, a folder that is gone
    apps.test.mjs         editor, paint, viewer, web, settings, welcome, storage, pinch zoom
    a11y.test.mjs         the accessibility audit
  fixtures/embed.html   script-free page the Web-app test frames in its iframe
  screenshot.mjs        writes PNGs to shots/
  probe.mjs measure-toolbars.mjs   the two measurement tools (see Testing below)
```

## Adding an app

Drop a module in `src/apps/` that default-exports a definition, then add it to `src/apps/index.js`:

```js
export default {
  id: 'clock',            // used for launch('clock') and window de-duplication
  name: 'Clock',
  icon: '🕒',
  width: 320, height: 240,
  shortcut: true,         // show on the desktop (default: true for everything but Welcome)
  singleton: true,        // focus the existing window instead of opening another
  keywords: ['time'],     // matched by Start menu search and terminal `apps`

  mount(ctx, win) {
    win.body.replaceChildren(/* ...DOM... */);
    win.setTitle('Clock');
    return () => { /* optional cleanup, runs on window close */ };
  },
};
```

`ctx` gives an app everything it needs: `ctx.fs`, `ctx.bus`, `ctx.wm`, `ctx.theme`,
`ctx.apps`, `ctx.launch(appId)`, `ctx.openPath(path)` and `ctx.toast(title, detail, kind)`.
`win` gives `win.body` (the content area), `win.setTitle()`, `win.data` (per-window state,
which is what gets persisted for session restore) and `win.el`.

## Tests

```
npm run test:unit      # filesystem, geometry, storage/quota and source-contract unit tests,
                       # the theme token sheet, the wallpaper ink, the toolbar-fit rule — no browser
npm run test:browser   # Playwright suite: the desktop shell, window management, toolbar fit,
                       # the terminal, Files, the other apps, an accessibility audit, and the
                       # rendered-text contrast audit in both themes
npm test               # both — 231 tests
npm run screenshots    # writes shots/*.png (needs Playwright browsers installed); the token
                       # report throws if any pair it measures falls below 4.5:1
```

The browser suite is split by area under `tests/browser/`, and all of it shares one fixture
(`tests/browser/fixture.mjs`) that owns the browser, the server and the desktop helpers. Run
one area while working on it:

```
node --test tests/browser/toolbars.test.mjs
node --test --test-name-pattern="keyboard" tests/browser/windows.test.mjs
```

Each area file is independent: it boots its own Chromium, opens its own windows and does not
inherit state from a test that ran earlier. That is what makes the split worth having — the
single 3800-line file it replaced took 158s on its own and broke when tests were reordered.

The speed is a property of the machine, not of the suite. Measured on a 24-core box: the
browser suite is ~35s at the default concurrency (one Chromium per area file, seven at a
time) and **93s with `--test-concurrency=2`**, which is roughly what a two-core laptop pays.
Still under the 158s of the file it replaced, and the parallel case is the one the split was
for. If you are on a small machine, run one area file at a time while you work in it.

`npm install && npx playwright install chromium` once before running the browser tests.
The browser tests and the screenshot script start their own static server
(`tests/serve.mjs`) on an ephemeral port — you do not need `npm start` running.
In these polish copies `node_modules` is a symlink to the original project's install;
deleting the symlink and running `npm install` gives this copy its own.

### Measuring a toolbar

One dev tool, not a test — it answers "what does this bar actually do at this width", which is
the question the collapse algorithm is hard to reason about from the CSS alone:

```
node tests/measure-toolbars.mjs              # every app, at its default and minimum width:
                                             # what is off the edge, named, with each width
node tests/measure-toolbars.mjs 380 460      # …and at any widths you ask for
node tests/probe.mjs paint 680               # one app: the settled state, then what the bar
                                             # would do at every cut level, and which it chose
node tests/probe.mjs ~/Documents 700         # Files' bar *and* its Places sidebar at the
                                             # widths you ask for — they are one decision now
node tests/probe.mjs ~/Documents/… 360 --mkdir=…   # create the folders you are measuring first
```

The settled line reports `collapsed=k` (rungs applied), `still over` plus
`collapsed-effective` (rungs that actually changed the measured bar — a rung whose cap the
content never reaches buys nothing), `walks=n`, how many times the ladder was actually walked
rung by rung to produce that number and `walk=…ms` what the last one cost, and `passes=n`,
how many times the watcher measured that bar. A ladder longer than 48 rungs reports
`unmeasured` rather than a number nobody measured.
The rung table marks anything that did not change the measurement `(buys nothing)`.

Three smaller probes answer the same kind of question for the other measured limits in the
code. None of them are part of `npm test`:

```
node tests/measure-crumb.mjs      # how wide a 12ch crumb box really is, how much of it a tail
                                  # of N characters takes, and where the head stops existing
node tests/measure-desktop.mjs    # the desktop label box: glyphs per line, the lines the head
                                  # is allowed, where the label ends inside its grid row
node tests/wp-probe.mjs           # what ink the theme chooses for a wallpaper, measured by
                                  # painting it and reading it back — ratio and plate included
node tests/contrast-probe.mjs     # the rendered-text audit over the shell, every menu, a dialog,
                                  # the terminal with real output and every app maximized, in both
                                  # themes — 28 sections, several minutes
```

### Reading the contrast audits

Two different claims, two different tools.

`tests/token-contrast.test.mjs` reads `styles/theme.css` and measures the *sheet*: every ink level
against every surface it could be used on, every accent against its own tint, the terminal palette
against the canvas it is actually painted on. It is fast and it catches a token that drifted.

`tests/contrast.mjs` measures the *screen*. It walks the visible text in a live page, hit-tests a
grid over each line box so it only samples points where that text is genuinely the topmost thing,
takes a screenshot with the glyphs and one without, and compares the declared ink against the
background the browser actually composited — gradients, plates, veils and all. Three things are
exempt and each is counted in the result: text under a modal, glyphs that have a name next to them
(WCAG 1.4.11 — an icon beside its own label is decoration), and disabled controls. A run where no
glyph was found is still judged from its declared ink, because "no glyph appeared" is also what
text the same colour as its background looks like; that rule is what found the terminal bug.

Each screen it asserts on carries a **coverage claim** as well as a contrast claim: `assertReadable(result, where, { expect: [...] })`
names strings or patterns that must have been measured, and fails by naming what it did not see.
Without it, "no problems among 40 runs" is only as good as the assumption that those runs are the
ones a user reads — a screen that hid half of its labels would still clear a floor of ten. The
browser suite asserts on the shell and its menus, a dialog, the terminal with real output, Files,
every registered app opened once, and the audit's own guards: that it fails on unreadable text,
that a coverage claim fails on text that is not there and passes on text that is, and that an audit
of a selector matching nothing is a failure rather than a pass.

## DOM diagnostics

<!-- diagnostics:start -->
The core writes a small number of `data-*` attributes into the page while it is measuring.
They are diagnostics, not styling hooks and not a promise about the layout — every layout
decision is re-measured on its own, and these are what it measured. Open devtools and look
at a `.toolbar` to see what a bar actually did; `tests/probe.mjs` and
`tests/measure-toolbars.mjs` print these same numbers.

| Attribute | Written by | What it says | What it does **not** say |
| --- | --- | --- | --- |
| `data-collapsed` | toolbar watcher | how many rungs of *this bar's declared ladder* are applied right now | that the bar needed them, or that they helped — see `data-collapsed-exhausted` |
| `data-collapsed-exhausted` | toolbar watcher | the bar gave up everything it is allowed to and still overflows | anything about a bar that fits (the attribute is removed) |
| `data-collapsed-effective` | toolbar watcher | in the exhausted case: how many of those rungs actually changed the measured bar | a layout claim. It is a diagnostic produced by walking the ladder back, and it is cached against the content it measured |
| `data-collapsed-effective-limit` | toolbar watcher | the ladder was longer than this many rungs, so nobody walked it: `data-collapsed-effective` is `unmeasured` | that nothing bought anything — that is exactly the difference it exists to make |
| `data-collapsed-effective-walks` | toolbar watcher | how many times this bar's ladder was actually walked rung by rung | how many times the bar was re-fitted — that is `data-fit-passes` |
| `data-collapsed-effective-walk-ms` | toolbar watcher | how long the last walk took, in milliseconds | anything about the ordinary resize: the walk is paid once per *content*, not per resize |
| `data-fit-passes` | toolbar watcher | how many times this bar has been re-measured | that anything changed; a converging loop and a runaway one look the same without it |
| `data-overflow-left`, `data-overflow-right` | toolbar watcher | which edge of a scrollable bar is currently cut off (CSS shows a fade there) | that the action is unreachable — an overflowing bar is also given a `⋯` menu that names it |
| `data-theme`, `data-accent` | theme | the theme the CSS is reading | nothing about what the user chose in Settings beyond the current value |
| `data-win-id`, `data-app` | window manager | which window this is and which app owns it | that the app mounted successfully |
| `data-dir` | window manager | which resize handle this is (`nw`, `se`, …) | — |
| `data-kind`, `data-app-id`, `data-path`, `data-value` | shell / dialogs | what a desktop icon, taskbar item, file cell or dialog button refers to | — |

Declared by apps, read by the core (inputs, not diagnostics): `data-collapse` (the order a
bar gives up its groups), `data-collapse-units` (pieces inside a group that may be given up
one at a time), `data-collapse-units-from="end"` (give up the far end first) and
`data-collapse-scope` (an ancestor those selectors resolve against, for room the bar is
*given* rather than room it is showing).

A contract test (`tests/contracts.test.mjs`) fails if the core starts writing a `data-*`
attribute this table does not name, or keeps a row for one it stopped writing — which is how
a diagnostic ends up being read as a promise.
<!-- diagnostics:end -->

## Console

`window.browserOS` is exposed for poking at the OS from devtools:

```js
browserOS.launch('terminal')
browserOS.fs.write('~/notes.md', 'hello')
browserOS.openPath('~/notes.md')
browserOS.theme.set('accent', 'teal')
browserOS.wm.serialize()
```

## How this repo is maintained

This copy is part of an iterative polish loop. Three files document the work and are
updated every iteration — treat them as the maintenance contract:

- `project-description.md` — what *this version* is: structure, entry points, how to run
  and test it, and what is deliberately unfinished.
- `proposed-improvements.md` — a ranked, honest list of concrete improvements with
  statuses (`[todo]`/`[done]`), including visual findings from `shots/`.
- `undone.md` — handover notes for the next iteration: what was implemented here, what
  was deliberately left undone, known bugs and a short "next should" list.

If you change behaviour, update these three files in the same pass; do not modify earlier
version directories.
