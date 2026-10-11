# Browser OS

A desktop environment that runs entirely in a browser tab — windows, a shell, a virtual
filesystem, and nine small apps. Plain ES modules, no build step, no runtime dependencies.

```
python3 -m http.server 8080        # or: npm start
open http://localhost:8080/
```

ES modules need an HTTP origin, so opening `index.html` straight from the file system won't work.

---

## What's in it

**Window manager** — drag title bars, resize from any edge or corner, focus and z-order,
minimise, maximise (button, double-click the title bar, or drag to the top edge), and
edge snapping: drag a title bar to the left or right edge to tile half the screen.
Windows are constrained back into the viewport when you resize the browser.

**Virtual filesystem** — a POSIX-ish tree (`~`, `.`, `..`, `/home/user/...`) persisted to
`localStorage`. Every app that touches files goes through the same `VirtualFS`, and a
`fs:change` event keeps the Files app, desktop icons and open editors in sync.

**Shell** — desktop icons, taskbar with running windows, Start menu with app search,
right-click context menus (desktop, icons, taskbar items), clipboard copy/cut/paste,
toasts, a clock, and a "show desktop" tray button.

**Session restore** — open windows (app, file, position, size, maximised state) are saved
and reopened when the page reloads.

### Apps

| App | What it does |
| --- | --- |
| Terminal | `help`, `ls -l`, `cd`, `cat`, `echo hi > file`, `mkdir`, `rm -r`, `mv`, `cp`, `tree`, `open`, `edit`, `launch`, `theme`, `wallpaper`, `neofetch`, … plus Tab completion, ↑/↓ history, `&&` chaining and `Ctrl+L` |
| Files | Browse, create, rename, delete, upload, drag-and-drop files into the filesystem |
| Text Editor | Edits real files in the filesystem, `Ctrl+S` to save, reloads when another app rewrites the file |
| Image Viewer | Shows PNGs saved by Paint or uploaded from disk |
| Paint | Pen / line / eraser, undo, resize-safe canvas, saves PNGs into `~/Pictures` |
| Calculator | Expression evaluation with keyboard support |
| Web Browser | An iframe with an address bar (needs network; some sites refuse to be embedded) |
| Settings | Theme, accent colour, wallpapers (including your own image), storage info, factory reset |
| Welcome | First-run tour |

### Keyboard

| Keys | Action |
| --- | --- |
| `Ctrl+Alt+T` | Terminal |
| `Ctrl+Alt+F` | Files |
| `Ctrl+Space` | Toggle the Start menu |
| `Alt+F4` | Close the focused window |
| `Ctrl+S` | Save in the editor |
| `Tab` / `↑` `↓` | Completion and history in the terminal |

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
  store.js              localStorage wrapper with an in-memory fallback
  fs.js                 VirtualFS: resolve/list/read/write/mkdir/rm/mv/copy/tree
  theme.js              settings + wallpaper/accent presets
  wm.js                 WindowManager: lifecycle, z-order, drag, resize, snap, restore
  shell.js              desktop, taskbar, menus, toasts, clock, global keys
  utils.js              el() DOM helper and small formatting utilities
src/apps/
  index.js              app registry (order = Start menu order)
  terminal.js files.js editor.js viewer.js paint.js calc.js web.js settings.js welcome.js
tests/
  fs.test.mjs           node:test unit tests for the filesystem core
  browser.test.mjs      Playwright smoke tests for the whole desktop
  screenshot.mjs        writes PNGs to shots/
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
npm run test:unit      # filesystem + store unit tests, no browser needed
npm run test:browser   # Playwright smoke tests: boot, terminal, window ops, drag/snap,
                       # start menu, editor save, files, settings, reload restore, layout
npm test               # both
npm run screenshots    # writes shots/*.png (needs Playwright browsers installed)
```

`npm install && npx playwright install chromium` once before running the browser tests.

## Console

`window.browserOS` is exposed for poking at the OS from devtools:

```js
browserOS.launch('terminal')
browserOS.fs.write('~/notes.md', 'hello')
browserOS.openPath('~/notes.md')
browserOS.theme.set('accent', 'teal')
browserOS.wm.serialize()
```
