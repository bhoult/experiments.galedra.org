# Proposed improvements (version 01)

Findings come from reading the code in this directory. Difficulty: **S** ≈ under an hour,
**M** ≈ a focused session, **L** ≈ a redesign.

Statuses: `[todo]`, `[doing]`, `[done]`.

---

## A. Correctness / behaviour bugs

### A1. `nano` is advertised but does not exist — `[todo]` (S)
`src/apps/terminal.js` describes `edit` as `edit <file>   (alias: nano)`, but there is no
`nano` entry in `commands`, so `nano notes.md` prints `command not found`.
**Why it matters:** the shell lies about its own interface; `help`/`man` promise it.
**Change:** add `nano` as an alias entry (and make Tab completion work for it).

### A2. `&&` chaining splits inside quotes — `[todo]` (S)
`run()` does `trimmed.split('&&')` before tokenizing, so `echo "a && b"` runs two broken
commands. **Change:** split on `&&` only outside quotes.

### A3. `fs.write('/')` creates a file named `""` — `[todo]` (S)
`write()` computes `basename('/home/user/..')` → `''` and happily writes an empty-named
file into the parent directory. `stat`/`list` then show a nameless entry that no app can
open or delete cleanly. **Change:** throw `cannot write to /` (and cover with a unit test).

### A4. `fs.mv(dir, existingFile)` silently destroys the file — `[todo]` (S)
In `mv()`, if the destination exists and is *not* a directory the node is written over it.
Moving a directory onto a file should be an error, like real `mv`.
**Change:** throw when a directory would overwrite a file. Also treat a trailing `/` in the
destination as "this is a directory" (`mv a.txt new/` should create `new/a.txt`).

### A5. `fs.list()` never reports directory contents, so Files shows blank metadata — `[todo]` (S)
`list()` omits `children`, but `src/apps/files.js` renders `entry.children ?? ''` in the
cell meta. Every folder in the Files app therefore shows no count (visible in
`shots/05-files-toolbar.png`). **Change:** include `children` count in `list()` output.

### A6. Editor reload logic uses a prefix match — `[todo]` (S)
`src/apps/editor.js`: `if (!path || !changed.startsWith(path) || dirty) return;`.
A write to `/home/user/notes.md.bak` "changes" `/home/user/notes.md`. It also ignores the
`{ path: '/', reset: true }` event emitted by `fs.reset()`, so open editors keep showing a
file that no longer exists. **Change:** exact path match plus a reset branch.

### A7. "Open in new window" does not open a new window — `[todo]` (S)
`WindowManager.launch()` de-duplicates on `appId + JSON.stringify(data)` unless the app
explicitly sets `singleton: false`, but the desktop context menu item "Open in new window"
just calls `wm.launch(app.id)` again — which raises the existing window. The menu item is
a no-op. **Change:** add an explicit `opts.newWindow` that skips the de-duplication lookup
and use it from that menu item.

### A8. localStorage quota failures are swallowed and silently corrupt state — `[todo]` (M)
`Store.save()` catches a `QuotaExceededError` and writes to the in-memory `Map` instead,
while `Store.load()` keeps reading `localStorage` (because `available` is still true).
After Paint saves a couple of PNGs (base64 data URLs are large) the user can keep
"saving" data that a reload will silently throw away, with no warning anywhere.
**Change:** make `save()` report failure, surface it once as a toast, and show it in
Settings → Files & storage.

### A9. Closing an editor with unsaved changes loses them silently — `[todo]` (S)
`dirty` is tracked and shown in the status bar, but the ✕ button and `Alt+F4` close the
window regardless. **Change:** a guarded close path (`win.requestClose`) that confirms when
dirty, used only for user-initiated closes so programmatic closes stay predictable.

### A10. Terminal `history`/`Ctrl+C` edge cases — `[todo]` (S)
`Ctrl+C` clears the line but leaves the caret in the middle of history navigation; `↑`
after a failed command re-offers a command that was never valid. Minor, but cheap to tidy.

---

## B. Features / gaps

### B1. `theme.settings.icons` is dead config — `[todo]` (S)
`DEFAULTS` includes `icons: true` and nothing reads or writes it. Either delete it or make
it real: a Settings toggle that hides the app shortcuts from the desktop. Making it real is
more useful (small screens, people who only want their files on the desktop).

### B2. Paint has no rubber-band preview for the Line tool — `[todo]` (S)
`pointermove` explicitly returns for `tool === 'line'` with the comment "preview handled on
up" — there is no preview at all. You draw a blind line and only see it when you release.
**Change:** draw the preview on a temporary overlay/`save()`+`restore()` layer.

### B3. Paint window titles leak internal ids (`Paint — untitled (paint-lrg9tpk)`) — `[todo]` (S)
Visible in `shots/03-apps-startmenu.png`. The `uid()` is only needed to make the title
unique; it is noise in the taskbar.

### B4. Files app has no keyboard interaction — `[todo]` (M)
Everything is mouse-only: Enter to open, `Delete` to delete, `F2` to rename, Backspace to go
up. There is also no search/filter in a folder and no sort control (the list is hard-coded
to folders-then-name).

### B5. Terminal is missing the commands the UI implies — `[todo]` (S)
No `df`/`du` even though Settings advertises "Stored size" and the filesystem has a real
quota problem (A8); no `stat`; no `write`/`tee`. `df` + `du` are ~20 lines and make the
quota story explainable from the shell.

### B6. No quarter snapping / no keyboard window moves — `[todo]` (M)
`#snapTarget` only knows left/right/top. Windows cannot be moved or resized without a
pointer, which is also an accessibility gap.

### B7. Image Viewer has no zoom/fit and no next/previous in the folder — `[todo]` (M)
`viewer.js` renders one `<img>` at `max-width:100%`. For a Paint PNG that is fine; for an
uploaded photo there is no way to inspect detail.

### B8. Web Browser app has no history, no loading state, no error state — `[todo]` (M)
`web.js` has a reload button only. A blank iframe (blocked by `X-Frame-Options`) looks like
a broken app; there is no "this site refused to embed" hint beyond a static status line.

---

## C. Error handling & trust boundaries

### C1. `window.confirm`/`window.prompt` are the only modal UI — `[todo]` (M)
They are unthemeable, blocking, and cannot be styled to match the desktop; they also break
under some embedding contexts. A tiny in-OS prompt dialog would fix rename/save-as/delete.

### C2. `web.js` iframe sandbox is `allow-scripts allow-same-origin` — `[todo]` (S)
For a same-origin URL (the user can type `http://127.0.0.1:8080/`) that combination lets
the framed document script itself out of its own sandbox. Drop `allow-same-origin` unless
the URL is cross-origin.

### C3. `escapeHtml()` and `isText()` are exported but never used — `[todo]` (S)
Dead code in `utils.js`; either use them or remove them so the "safe by construction"
story (everything renders via `textContent`) is obvious.

### C4. Version string is duplicated in four places — `[todo]` (S)
`main.js` (`ctx.version`), `shell.js` (`Browser OS v0.1`), `settings.js` (`Browser OS 0.1`),
`terminal.js` neofetch (`OS: Browser OS 0.1`), plus `fs.js` `/etc/os-release`. One source.

---

## D. Performance

### D1. `updateTray()` walks the whole tree on every focus change — `[todo]` (S)
`#wireTaskbar` subscribes to `win:focus` → `updateTray()` → full recursive walk of the FS.
Cheap today, silly at 10k files. Cache the count on `fs:change`.

### D2. `#renderTaskbar()` rebuilds every button on every focus event — `[todo]` (S)
Same subscription; fine for a handful of windows, but it also re-renders the tray.

### D3. Paint's undo stack stores up to 25 full-canvas PNG data URLs — `[todo]` (M)
Simple and correct, but memory-heavy on large canvases. ImageBitmap or an ImageData ring
buffer would be better.

---

## E. Accessibility / UX

### E1. Windows are not keyboard reachable — `[todo]` (M)
No `role="dialog"`, no `aria-label`, no tab stop, no keyboard move/resize/close. Window
control buttons have `title` but no accessible name beyond the glyph (`–`, `▢`, `✕`).

### E2. Menus claim `role="menu"` but contain plain buttons — `[todo]` (S)
`#start-menu` and `#context-menu` should use `menuitem` roles (and arrow-key navigation in
the context menu, which currently is mouse-only).

### E3. No `prefers-reduced-motion` handling — `[todo]` (S)
`win-in`, `win-out`, `pop-in` and the snap-preview transition always run.

### E4. No visible focus ring for keyboard users — `[todo]` (S)
Buttons rely on `:hover` only; `:focus-visible` styling is missing across the shell.

### E5. Narrow-window toolbars clip content invisibly — `[todo]` (S)
`.toolbar { flex-wrap: nowrap }` keeps the row intact but the Files breadcrumb and buttons
simply get cut off (`shots/05-files-toolbar.png` shows `root / home / u…`). A horizontally
scrollable toolbar with a fade is honest; silent clipping is not.

### E6. Touch/small screens are second-class — `[todo]` (M)
Desktop icons and Files cells rely on `dblclick`, which is awkward on touch; the taskbar
hides overflow instead of scrolling; there is no long-press context menu.

---

## F. Test coverage

### F1. No unit tests for `wm.js`, `shell.js`, `utils.js` — `[todo]` (M)
`resolve`, `fmtBytes`, `uniqueName`, `parentPath` are covered; window geometry maths
(clamp, snap targets, resize from the west/north edges) is not.

### F2. Browser tests do not cover: drag-resize, context menu actions, clipboard
copy/paste, upload/drag-drop, Paint save → Viewer, session restore of maximised windows,
or the Web app — `[todo]` (M)

### F3. `consoleErrors` assertion is last, so earlier failures hide console noise — `[todo]` (S)
Print collected errors on every failing test rather than as a separate final test.

### F4. Tests depend on wall-clock/locale output (`ls -l` dates, clock text) — `[todo]` (S)
Assert shape rather than content where possible.

---

## G. Documentation

### G1. README does not mention `tests/serve.mjs`, the `PORT` env var, or that
`node_modules` may be a symlink — `[todo]` (S)

### G2. No `undone.md` / `project-description.md` contract documented for contributors — `[todo]` (S)

---

## Visual improvements (see `shots/`)

Captured with `npm run screenshots` (Playwright, 1280×800, deviceScaleFactor 2).

1. **`01-desktop.png`** — the Welcome window spawns on top of the first row of desktop
   icons, so the desktop looks broken on first boot. Either spawn windows lower/right of
   the icon grid, or reserve the left column.
2. **`05-files-toolbar.png`** — breadcrumb silently truncated to `root / home / u…`; folder
   cells show no item count (A5); the empty folder area is a large dead rectangle.
3. **`03-apps-startmenu.png`** — Paint's title shows the internal `paint-lrg9tpk` id
   (B3); the `<input type=color>` swatch renders as a thin sliver next to the palette
   buttons, so it reads as a broken control; the Calculator is clipped by the screen edge
   with no indication it is scrollable/movable.
4. **`06-paint.png`** — the canvas has no border/handle affordance and no indication of
   image size; the palette has no "current colour" affordance.
5. **`04-light.png`** — light theme is mostly fine, but accent presets (`lime`, `amber`)
   are low-contrast against `--surface-solid: #fff` for text-on-accent buttons; the terminal
   keeps its dark background, which is intentional but undocumented.
6. **Missing states**: no loading state anywhere (Web app), no empty state for the taskbar
   (it is just blank), no error state for a failed app mount beyond a plain sentence.

---

## What I am doing in this iteration

A1, A2, A3, A4, A5, A6, A7, A8, A9, B1, B2, B3, B5, C2, C4, D1, E1 (partial), E2, E3, E4,
E5, plus tests for each and a refreshed README.
