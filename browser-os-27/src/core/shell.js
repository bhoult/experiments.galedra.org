import { el, basename, parentPath, iconFor, fmtBytes, isImage, coarsePointer, addLongPress, watchToolbarOverflow, importFiles, splitName, VERSION } from './utils.js';
import { ZONES } from './geometry.js';

export class Shell {
  constructor({ bus, wm, fs, store, theme, apps, dialogs, version = VERSION }) {
    this.bus = bus;
    this.wm = wm;
    this.dialogs = dialogs;
    this.fs = fs;
    this.store = store; // used to size file imports against the storage that is free
    this.theme = theme;
    this.apps = apps;
    this.version = version;
    this.clipboard = null; // { path, mode: 'copy' | 'cut' }
    this.selected = null;

    this.desktop = document.getElementById('desktop');
    this.iconLayer = document.getElementById('desktop-icons');
    this.startBtn = document.getElementById('start-btn');
    this.startMenu = document.getElementById('start-menu');
    this.taskbarItems = document.getElementById('taskbar-items');
    this.taskbarButtons = new Map(); // winId -> button; the taskbar updates incrementally
    this.taskbarEmpty = el('span', { class: 'taskbar-empty', text: 'No open windows' });
    this.contextMenu = document.getElementById('context-menu');
    this.toastLayer = document.getElementById('toasts');
    this.clockEl = document.getElementById('clock');
    this.trayStatus = document.getElementById('tray-status');
    this.menuReturnFocus = null;

    this.#wireGlobal();
    this.#wireTaskbar();
    this.#wireStartMenu();
    this.#wireContextMenu();
    this.#wireDesktop();
    this.taskbarOverflow = watchToolbarOverflow(this.taskbarItems); // same honest overflow fades as app toolbars
    this.renderDesktop();
    this.startClock();
    this.#taskbarSync();
  }

  /* ---------- launching ---------- */

  launch(appId, opts) {
    return this.wm.launch(appId, opts).catch((err) => {
      this.toast('Could not open app', err.message, 'err');
    });
  }

  openPath(path, cwd) {
    const abs = this.fs.resolve(path, cwd);
    let info;
    try {
      info = this.fs.stat(abs);
    } catch {
      this.toast('Not found', `${abs} does not exist`, 'err');
      return null;
    }
    if (!info) { this.toast('Not found', `${abs} does not exist`, 'err'); return null; }
    if (info.type === 'dir') return this.launch('files', { data: { path: abs } });
    if (isImage(info.name)) return this.launch('viewer', { data: { path: abs } });
    return this.launch('editor', { data: { path: abs } });
  }

  /* ---------- desktop ---------- */

  /* A desktop label wraps to two lines and throws the last one away, which is where an
     extension lives. Same split as the file grid: the head may wrap and be clamped, the tail
     is kept (see `.dicon .label` in styles/os.css for how the two are laid out). */
  #iconNameParts(name) {
    const { head, tail } = splitName(name);
    return el('span', { class: 'label' },
      el('span', { class: 'name-head', text: head }),
      tail && el('span', { class: 'name-tail', text: tail }));
  }

  renderDesktop() {
    this.iconLayer.replaceChildren();
    this.selected = null;

    for (const app of this.apps.filter((a) => a.shortcut && this.theme.settings.icons !== false)) {
      let lp = null;
      const node = el('button', {
        class: 'dicon', type: 'button', dataset: { kind: 'app', appId: app.id },
        ondblclick: () => this.launch(app.id),
        onclick: (e) => this.#iconClick(e.currentTarget, lp, () => this.launch(app.id)),
        oncontextmenu: (e) => { if (lp?.consumedContext()) { e.preventDefault(); return; } this.#iconMenu(e, { kind: 'app', app }); },
      },
        el('span', { class: 'glyph', text: app.icon }),
        el('span', { class: 'label', text: app.name }),
      );
      lp = addLongPress(node, (e) => this.#iconMenuAt(e.clientX, e.clientY, node, { kind: 'app', app }));
      this.iconLayer.append(node);
    }

    let entries = [];
    try { entries = this.fs.list('/home/user/Desktop'); } catch { /* desktop missing */ }
    for (const entry of entries) {
      let lp = null;
      const node = el('button', {
        class: 'dicon', type: 'button', dataset: { kind: 'file', path: entry.path },
        title: `${entry.name}\n${entry.type === 'dir' ? 'folder' : fmtBytes(entry.size)}`,
        ondblclick: () => this.openPath(entry.path),
        onclick: (e) => this.#iconClick(e.currentTarget, lp, () => this.openPath(entry.path)),
        oncontextmenu: (e) => { if (lp?.consumedContext()) { e.preventDefault(); return; } this.#iconMenu(e, { kind: 'file', entry }); },
      },
        el('span', { class: 'glyph', text: iconFor(entry.name, entry.type) }),
        this.#iconNameParts(entry.name),
      );
      lp = addLongPress(node, (e) => this.#iconMenuAt(e.clientX, e.clientY, node, { kind: 'file', entry }));
      this.iconLayer.append(node);
    }
  }

  /* Desktop icons with a pointer: click selects, double-click opens. With a finger:
     tap selects, a second tap on the already-selected icon opens it (no double-tap
     race), and a long-press opens the context menu (the touch right-click). */
  #iconClick(node, lp, open) {
    if (lp?.consumedClick()) return; // the click that ends a long-press must not also select
    if (coarsePointer() && this.selected === node) { open(); return; }
    this.#select(node);
  }

  #select(node) {
    this.selected?.classList.remove('selected');
    this.selected = node;
    node.classList.add('selected');
  }

  #wireDesktop() {
    this.desktop.addEventListener('pointerdown', (e) => {
      if (e.target === this.desktop || e.target === this.iconLayer) {
        this.selected?.classList.remove('selected');
        this.selected = null;
      }
      this.closeStartMenu();
      this.closeContextMenu();
    });

    this.desktop.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.dicon')) return; // handled by the icon
      e.preventDefault();
      this.#desktopMenu(e);
    });

    /* Dropping real files onto the desktop uploads them into ~/Desktop, the same way
       dropping onto a Files window uploads into that folder. */
    let dragDepth = 0;
    const hasFiles = (dt) => dt?.types?.includes('Files');
    this.desktop.addEventListener('dragenter', (e) => {
      if (!hasFiles(e.dataTransfer)) return;
      dragDepth++;
      this.desktop.classList.add('dropping');
    });
    this.desktop.addEventListener('dragover', (e) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    });
    this.desktop.addEventListener('dragleave', () => {
      if (--dragDepth <= 0) { dragDepth = 0; this.desktop.classList.remove('dropping'); }
    });
    this.desktop.addEventListener('dragend', () => { dragDepth = 0; this.desktop.classList.remove('dropping'); });
    this.desktop.addEventListener('drop', async (e) => {
      dragDepth = 0;
      this.desktop.classList.remove('dropping');
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      const imported = await importFiles({ fs: this.fs, store: this.store, toast: (...a) => this.toast(...a) }, files, '/home/user/Desktop');
      if (imported) this.toast('Uploaded to Desktop', `${imported} file${imported === 1 ? '' : 's'}`, 'ok');
    });
  }

  #desktopMenu(e) {
    const items = [
      { label: 'New folder', glyph: '📁', run: () => this.#createOnDesktop('folder') },
      { label: 'New file', glyph: '📄', run: () => this.#createOnDesktop('file') },
      { sep: true },
      { label: 'Open terminal here', glyph: '⌨️', run: () => this.launch('terminal', { data: { cwd: '/home/user/Desktop' } }) },
      { label: 'Open files', glyph: '🗂️', run: () => this.launch('files', { data: { path: '/home/user/Desktop' } }) },
      { sep: true },
      { label: 'Paste', glyph: '📋', disabled: !this.clipboard, run: () => this.paste('/home/user/Desktop') },
      { label: 'Display settings', glyph: '🎨', run: () => this.launch('settings') },
      { label: 'Refresh', glyph: '↻', run: () => { this.renderDesktop(); this.toast('Desktop refreshed'); } },
    ];
    this.openContextMenu(e.clientX, e.clientY, items);
  }

  #iconMenu(e, target) {
    e.preventDefault();
    e.stopPropagation();
    this.#iconMenuAt(e.clientX, e.clientY, e.currentTarget.closest('.dicon'), target);
  }

  #iconMenuAt(x, y, node, target) {
    if (node) this.#select(node);
    const items = [];
    if (target.kind === 'app') {
      items.push({ label: 'Open', glyph: target.app.icon, run: () => this.launch(target.app.id) });
      items.push({ label: 'Open in new window', glyph: '⧉', run: () => this.wm.launch(target.app.id, { newWindow: true }).catch(() => {}) });
    } else {
      const { entry } = target;
      items.push({ label: 'Open', glyph: iconFor(entry.name, entry.type), run: () => this.openPath(entry.path) });
      if (entry.type === 'file') {
        items.push({ label: 'Open with terminal', glyph: '⌨️', run: () => this.launch('terminal', { data: { cwd: parentPath(entry.path) } }) });
      }
      items.push({ sep: true });
      items.push({ label: 'Rename', glyph: '✎', run: () => this.#rename(entry) });
      items.push({ label: 'Copy', glyph: '⧉', run: () => { this.clipboard = { path: entry.path, mode: 'copy' }; this.toast('Copied', entry.name); } });
      items.push({ label: 'Cut', glyph: '✂', run: () => { this.clipboard = { path: entry.path, mode: 'cut' }; this.toast('Cut', entry.name); } });
      items.push({ label: 'Delete', glyph: '🗑', danger: true, run: async () => {
        const ok = await this.dialogs.confirm({ title: `Delete ${entry.name}?`, message: entry.path, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try {
          this.fs.rm(entry.path, '/', true);
          this.toast('Deleted', entry.name, 'ok');
        } catch (err) { this.toast('Delete failed', err.message, 'err'); }
      } });
    }
    this.openContextMenu(x, y, items);
  }

  #createOnDesktop(kind) {
    const base = kind === 'folder' ? 'new folder' : 'untitled.txt';
    const name = this.fs.uniqueName('/home/user/Desktop', base);
    try {
      if (kind === 'folder') this.fs.mkdir(`/home/user/Desktop/${name}`, '/');
      else this.fs.write(`/home/user/Desktop/${name}`, '', '/');
      this.toast(`Created ${kind}`, name, 'ok');
    } catch (err) { this.toast('Create failed', err.message, 'err'); }
  }

  async #rename(entry) {
    const name = await this.dialogs.prompt({ title: 'Rename', message: entry.path, value: entry.name, placeholder: 'new name' });
    if (!name || name === entry.name) return;
    try {
      this.fs.mv(entry.path, `${parentPath(entry.path)}/${name}`, '/');
      this.toast('Renamed', `${entry.name} → ${name}`, 'ok');
    } catch (err) { this.toast('Rename failed', err.message, 'err'); }
  }

  paste(destDir) {
    if (!this.clipboard) return;
    const { path, mode } = this.clipboard;
    try {
      const name = this.fs.uniqueName(destDir, basename(path));
      const target = `${destDir}/${name}`;
      if (mode === 'cut') this.fs.mv(path, target, '/');
      else this.fs.copy(path, target, '/');
      this.toast('Pasted', name, 'ok');
      if (mode === 'cut') this.clipboard = null;
    } catch (err) { this.toast('Paste failed', err.message, 'err'); }
  }

  /* ---------- taskbar ---------- */

  #wireTaskbar() {
    /* Incremental updates: only window creation/removal touch the DOM structure; focus,
       minimise and renames just update classes/labels on the existing buttons. */
    this.bus.on('win:created', ({ win }) => this.#taskbarAdd(win));
    this.bus.on('win:closed', ({ win }) => this.#taskbarRemove(win));
    this.bus.on('win:state', () => this.#taskbarSync());
    this.bus.on('win:focus', () => this.#taskbarSync());
    /* The window manager asks for its window menu; the shell owns the only context menu. */
    this.bus.on('window:menu', ({ win, x, y }) => this.#windowMenu(x, y, win));
    /* So does the toolbar overflow menu: a narrow window's hidden actions are listed in the
       same menu component, with the same keyboard handling and the same accessible names. */
    this.bus.on('contextmenu:request', ({ x, y, items, within }) => this.openContextMenu(x, y, items, { within }));
    /* A menu belongs to the thing you clicked. When that thing is a window and the window
       goes away, the menu has nothing left to be a menu *of* — leaving it floating on the
       desktop reads as a menu for the desktop itself. */
    this.bus.on('win:closed', () => this.closeContextMenu());
    this.bus.on('fs:change', () => { this.renderDesktop(); this.updateTray(); });
    this.bus.on('settings:change', ({ key }) => { if (key === 'icons') this.renderDesktop(); });
    this.startBtn.addEventListener('click', () => this.toggleStartMenu());
    document.getElementById('show-desktop').addEventListener('click', () => this.toggleShowDesktop());
  }

  toggleShowDesktop() {
    const wins = [...this.wm.windows.values()];
    const anyVisible = wins.some((w) => !w.minimized);
    for (const w of wins) this.wm.setMinimized(w.id, anyVisible);
    if (!anyVisible && wins[0]) this.wm.focus(wins[0].id);
  }

  #taskbarMenu(e, win) {
    e.preventDefault();
    this.#windowMenu(e.clientX, e.clientY - 8, win);
  }

  #taskbarMenuAt(x, y, win) {
    this.#windowMenu(x, y, win);
  }

  /**
   * The menu for a window: the state changes, then every zone it can be tiled into.
   * Tiling used to exist only as a drag to a screen edge or an Alt+arrow nobody found,
   * so the same zones the geometry supports are listed here — from the shared ZONES
   * table, which is also what the drag preview labels itself with.
   */
  #windowMenu(x, y, win) {
    if (!this.wm.windows.has(win.id)) return;
    this.openContextMenu(x, y, [
      { label: win.minimized ? 'Restore' : 'Minimise', glyph: '▾', run: () => this.wm.setMinimized(win.id, !win.minimized) },
      { label: win.maximized ? 'Restore size' : 'Maximise', glyph: '▢', run: () => this.wm.toggleMaximize(win.id) },
      { sep: true },
      ...ZONES.map((z) => ({
        label: z.label, glyph: z.glyph, hint: z.hint,
        run: () => this.wm.snapTo(win.id, z.zone),
      })),
      /* Only once the window has actually been moved: an "Undo move" on a window nobody
         moved would be a menu item that does nothing. */
      ...(win.moveHistory.length
        ? [{ label: 'Undo move', glyph: '↺', hint: 'back to where it was', run: () => this.wm.undoMove(win.id) }]
        : []),
      { sep: true },
      { label: 'Close', glyph: '✕', danger: true, run: () => this.wm.close(win.id, { guarded: true }) },
    ], { within: win.el.getBoundingClientRect() });
  }

  #taskbarAdd(win) {
    if (this.taskbarButtons.has(win.id)) return;
    let lp = null;
    const btn = el('button', {
      class: 'titem', type: 'button', dataset: { winId: win.id },
      onclick: () => {
        if (win.minimized) this.wm.setMinimized(win.id, false);
        else if (win.id === this.wm.focusedId) this.wm.setMinimized(win.id, true);
        else this.wm.focus(win.id);
      },
      oncontextmenu: (e) => {
        if (lp?.consumedContext()) { e.preventDefault(); return; } // the native menu that follows our long-press
        this.#taskbarMenu(e, win);
      },
    },
      el('span', { class: 'glyph', text: win.icon || '▫' }),
      el('span', { class: 't', text: win.title }),
    );
    /* Touch equivalent of right-clicking a taskbar button. */
    lp = addLongPress(btn, (e) => this.#taskbarMenuAt(e.clientX, e.clientY - 8, win));
    this.taskbarButtons.set(win.id, btn);
    this.taskbarItems.append(btn);
    this.#taskbarSync();
  }

  #taskbarRemove(win) {
    this.taskbarButtons.get(win.id)?.remove();
    this.taskbarButtons.delete(win.id);
    this.#taskbarSync();
  }

  #taskbarSync() {
    for (const [id, btn] of this.taskbarButtons) {
      const win = this.wm.windows.get(id);
      if (!win) { btn.remove(); this.taskbarButtons.delete(id); continue; }
      btn.classList.toggle('focused', id === this.wm.focusedId);
      btn.classList.toggle('minimized', !!win.minimized);
      btn.title = win.title;
      const t = btn.querySelector('.t');
      if (t && t.textContent !== win.title) t.textContent = win.title;
      const g = btn.querySelector('.glyph');
      if (g && g.textContent !== (win.icon || '▫')) g.textContent = win.icon || '▫';
    }
    const empty = this.taskbarButtons.size === 0;
    if (empty && !this.taskbarEmpty.isConnected) this.taskbarItems.append(this.taskbarEmpty);
    if (!empty && this.taskbarEmpty.isConnected) this.taskbarEmpty.remove();
    this.taskbarOverflow.refresh(); // buttons came and went: re-check which side is cut
    this.updateTray();
  }

  updateTray() {
    const wins = this.wm.windows.size;
    const { files } = this.fs.counts();
    this.trayStatus.textContent = `${wins} window${wins === 1 ? '' : 's'} · ${files} files`;
  }

  startClock() {
    const tick = () => {
      const d = new Date();
      this.clockEl.replaceChildren(
        el('div', { class: 'time', text: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
        el('div', { class: 'date', text: d.toLocaleDateString([], { month: 'short', day: 'numeric' }) }),
      );
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- start menu ---------- */

  #wireStartMenu() {
    document.addEventListener('pointerdown', (e) => {
      if (this.startMenu.classList.contains('hidden')) return;
      if (this.startMenu.contains(e.target) || this.startBtn.contains(e.target)) return;
      this.closeStartMenu();
    });
  }

  toggleStartMenu() {
    if (this.startMenu.classList.contains('hidden')) this.openStartMenu();
    else this.closeStartMenu();
  }

  openStartMenu() {
    const search = el('input', { class: 'field', placeholder: 'Search apps…', style: { width: '100%', height: '34px' } });
    const grid = el('div', { class: 'app-grid' });

    const render = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const matches = this.apps.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || (a.keywords || []).some((k) => k.includes(q)));
      grid.replaceChildren(...matches.map((a) => el('button', {
        class: 'app-tile', type: 'button', 'aria-label': `Open ${a.name}`,
        onclick: () => { this.closeStartMenu(); this.launch(a.id); },
      },
        el('span', { class: 'glyph', text: a.icon }),
        el('span', { class: 'name', text: a.name }),
      )));
      if (!matches.length) grid.append(el('div', { class: 'empty-state' }, 'No apps match that search.'));
    };
    render();

    search.addEventListener('input', () => render(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = grid.querySelector('.app-tile'); if (first) first.click(); }
      if (e.key === 'Escape') this.closeStartMenu();
    });

    this.startMenu.replaceChildren(
      el('div', { class: 'start-search' }, search),
      el('div', { class: 'start-body' },
        el('div', { class: 'start-section' }, 'All applications'),
        grid,
      ),
      el('div', { class: 'start-footer' },
        el('span', { text: `Browser OS v${this.version}` }),
        el('div', {},
          el('button', { class: 'linkbtn', onclick: () => { this.closeStartMenu(); this.launch('welcome'); } }, 'Tour'),
          el('button', { class: 'linkbtn', onclick: () => { this.closeStartMenu(); this.launch('settings'); } }, 'Settings'),
        ),
      ),
    );

    this.startMenu.classList.remove('hidden');
    this.startBtn.classList.add('open');
    this.startBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => search.focus(), 10);
  }

  closeStartMenu() {
    if (this.startMenu.classList.contains('hidden')) return;
    this.startMenu.classList.add('hidden');
    this.startBtn.classList.remove('open');
    this.startBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------- context menu ---------- */

  #wireContextMenu() {
    // Click anywhere outside an open menu dismisses it (previously only the desktop did).
    document.addEventListener('pointerdown', (e) => {
      if (this.contextMenu.classList.contains('hidden')) return;
      if (this.contextMenu.contains(e.target)) return;
      this.closeContextMenu();
    });

    this.contextMenu.tabIndex = -1;
    this.contextMenu.addEventListener('keydown', (e) => {
      const items = [...this.contextMenu.querySelectorAll('.cmenu-item:not(:disabled)')];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown'
          ? (at < 0 ? 0 : (at + 1) % items.length)
          : (at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length);
        items[next].focus();
      } else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items.at(-1).focus(); }
      else if (e.key === 'Enter' || e.key === ' ') {
        if (at >= 0) return; // the button handles its own click
        e.preventDefault();
        items[0].click();
      }
    });
  }

  openContextMenu(x, y, items, { within } = {}) {
    const menu = this.contextMenu;
    menu.replaceChildren(...items.map((item) => {
      if (item.sep) return el('div', { class: 'cmenu-sep', role: 'separator' });
      return el('button', {
        class: `cmenu-item${item.danger ? ' danger' : ''}`.trim(), type: 'button', role: 'menuitem', disabled: item.disabled === true,
        onclick: () => { this.closeContextMenu(); item.run?.(); },
      },
        el('span', { class: 'glyph', text: item.glyph || '' }),
        el('span', { text: item.label }),
        item.hint ? el('span', { class: 'cmenu-hint', text: item.hint }) : null,
      );
    }));
    menu.classList.remove('hidden');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    /* A menu belongs to the thing you clicked. Vertically it may have to spill past the
       bottom of a short window — there is nowhere else for it — but horizontally it is
       kept inside it, so it never reads as a menu for something else. */
    const right = within ? Math.min(window.innerWidth, within.right) : window.innerWidth;
    menu.style.left = `${Math.max(6, Math.min(x, right - w - 6))}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - h - 6)}px`;
    this.menuReturnFocus = document.activeElement;
    menu.focus();
  }

  closeContextMenu() {
    if (this.contextMenu.classList.contains('hidden')) return;
    this.contextMenu.classList.add('hidden');
    const back = this.menuReturnFocus;
    this.menuReturnFocus = null;
    if (back && document.contains(back)) back.focus?.();
  }

  /* ---------- toasts ---------- */

  toast(title, detail = '', kind = '') {
    const node = el('div', { class: `toast ${kind}`.trim() },
      el('div', { class: 't', text: title }),
      detail ? el('div', { class: 'd', text: detail }) : null,
    );
    this.toastLayer.append(node);
    setTimeout(() => {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(12px)';
      setTimeout(() => node.remove(), 320);
    }, 3200);
  }

  /* ---------- global keys ---------- */

  #wireGlobal() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        this.closeStartMenu();
        this.closeContextMenu();
      }
      if (mod && e.altKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); this.launch('terminal'); }
      if (mod && e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.launch('files'); }
      if (mod && e.key === ' ' ) { e.preventDefault(); this.toggleStartMenu(); }
      if (e.altKey && e.key === 'F4') { e.preventDefault(); this.wm.closeFocused(); return; }

      /* Alt+Arrow snaps the focused window; Alt+Shift+Arrow snaps it to its screen quarter.
         Skipped while a text control has focus, and title bars handle their own keys. */
      const zones = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max', ArrowDown: 'minimise' };
      if (e.altKey && !e.ctrlKey && !e.metaKey && zones[e.key]) {
        const active = document.activeElement;
        const typing = active && (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
        if (typing || !this.wm.focusedWindow) return;
        e.preventDefault();
        if (e.shiftKey) { this.wm.snapFocused('nearest'); return; }
        if (zones[e.key] === 'minimise') { this.wm.setMinimized(this.wm.focusedWindow.id, true); return; }
        this.wm.snapFocused(zones[e.key]);
      }
    });
  }
}
