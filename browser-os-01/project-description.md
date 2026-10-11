# Project description — Browser OS (version 01)

## What this is

A desktop environment that runs entirely in a browser tab. Plain ES modules, no build
step, no runtime dependencies (Playwright is a devDependency used only by the test
harness and the screenshot script).

It provides:

- a **window manager** (drag, resize from 8 handles, focus/z-order, minimise, maximise,
  edge snap-tiling, viewport clamping, session restore),
- a **virtual filesystem** persisted to `localStorage` with a POSIX-ish path resolver,
- a **shell** (desktop icons, taskbar, Start menu with search, context menus, clipboard,
  toasts, clock, show-desktop),
- **nine apps**: Terminal, Files, Text Editor, Image Viewer, Paint, Calculator, Web
  Browser, Settings, Welcome.

## Structure

```
index.html          static shell markup: #desktop, #windows, #taskbar, menus, toasts
styles/theme.css    CSS custom properties, dark/light themes, accent presets
styles/os.css       window chrome, taskbar, menus, and every app's styles
serve.mjs           `npm start` entry — thin wrapper over tests/serve.mjs
src/main.js         constructs EventBus → Store → VirtualFS → Theme → WindowManager →
                    Shell, wires the shared `ctx`, restores the saved layout, exposes
                    `window.browserOS` for the console
src/core/
  eventbus.js       pub/sub; handler errors are caught and logged, never fatal
  store.js          namespaced localStorage wrapper with an in-memory fallback
  fs.js             VirtualFS: resolve/stat/list/read/write/append/mkdir/rm/mv/copy/
                    uniqueName/tree/reset; emits `fs:change` on every mutation
  theme.js          settings object + wallpaper/accent presets, applies to <html>
  wm.js             WindowManager: launch/mount lifecycle, z-order, drag, resize,
                    snap preview, minimise/maximise, serialize/restore
  shell.js          desktop icons, taskbar, Start menu, context menus, toasts, clock,
                  global hotkeys, file clipboard, openPath() app routing
  utils.js          `el()` DOM helper, clamp/debounce, byte + path + icon helpers
src/apps/
  index.js          APPS array — the order here is the Start menu / desktop order
  <app>.js          default-exported { id, name, icon, size, keywords, mount(ctx, win) }
tests/
  serve.mjs         tiny static server used by both the browser tests and screenshots
  fs.test.mjs       node:test unit tests for VirtualFS/Store (no browser)
  browser.test.mjs  Playwright smoke tests for the whole desktop
  screenshot.mjs    writes PNGs to shots/
```

## The two contracts everything else builds on

1. **App contract** — `mount(ctx, win)` returns an optional cleanup function that the WM
   runs on close. `ctx` = `{ bus, store, fs, theme, apps, accents, wallpapers, wm, shell,
   launch, openPath, toast, version }`. `win` = `{ id, appId, el, body, data, title,
   setTitle(), minimized, maximized, cleanup }`. `win.data` is what gets persisted for
   session restore.
2. **FS contract** — every app that touches files goes through `ctx.fs` and listens for
   `fs:change` so the desktop, Files and open editors stay in sync.

## Entry points

- Browser: `index.html` → `src/main.js` (`boot()` restores the saved layout, or opens
  Welcome on first run).
- Dev: `npm start` (or `python3 -m http.server 8080`). ES modules need an HTTP origin, so
  opening `index.html` from the filesystem does not work.
- Console: `window.browserOS.{fs,wm,theme,shell,launch,openPath}`.

## Running and testing

```
npm install && npx playwright install chromium   # once
npm run test:unit      # VirtualFS + Store unit tests, no browser
npm run test:browser   # Playwright smoke tests (boots its own static server)
npm test               # both
npm run screenshots    # writes shots/*.png
```

`node_modules` in this version directory is a symlink to the original project's
`node_modules`; nothing here installs its own copy.

## Deliberately simple / unfinished

- No bundler, no framework, no components: everything is hand-rolled DOM + `el()`.
- The filesystem is a single JSON blob in `localStorage` (whole tree rewritten on every
  debounced change). No quota budget, no per-file keys.
- The terminal is a toy shell: no pipes, no globs, no `sed`/`grep`, no job control.
- Window snapping is half-screen and maximise only (no quarters, no tiling manager).
- Session restore is best-effort: app, `win.data`, rect and maximised/minimised flags.
- The Web Browser app is an `<iframe>`; sites that send `X-Frame-Options` look blank.
- `window.confirm`/`window.prompt` are used for rename/save-as/delete confirmation.
- Accessibility is partial: buttons are real `<button>`s and toasts are `aria-live`, but
  windows themselves are not keyboard reachable and there is no focus trapping.
