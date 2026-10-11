import { el, basename, parentPath, iconFor, fmtBytes, isImage, VERSION } from './utils.js';

export class Shell {
  constructor({ bus, wm, fs, theme, apps, version = VERSION }) {
    this.bus = bus;
    this.wm = wm;
    this.fs = fs;
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
    this.renderDesktop();
    this.startClock();
    this.updateTray();
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

  renderDesktop() {
    this.iconLayer.replaceChildren();
    this.selected = null;

    for (const app of this.apps.filter((a) => a.shortcut && this.theme.settings.icons !== false)) {
      this.iconLayer.append(el('button', {
        class: 'dicon', type: 'button', dataset: { kind: 'app', appId: app.id },
        ondblclick: () => this.launch(app.id),
        onclick: (e) => this.#select(e.currentTarget),
        oncontextmenu: (e) => this.#iconMenu(e, { kind: 'app', app }),
      },
        el('span', { class: 'glyph', text: app.icon }),
        el('span', { class: 'label', text: app.name }),
      ));
    }

    let entries = [];
    try { entries = this.fs.list('/home/user/Desktop'); } catch { /* desktop missing */ }
    for (const entry of entries) {
      this.iconLayer.append(el('button', {
        class: 'dicon', type: 'button', dataset: { kind: 'file', path: entry.path },
        title: `${entry.name}\n${entry.type === 'dir' ? 'folder' : fmtBytes(entry.size)}`,
        ondblclick: () => this.openPath(entry.path),
        onclick: (e) => this.#select(e.currentTarget),
        oncontextmenu: (e) => this.#iconMenu(e, { kind: 'file', entry }),
      },
        el('span', { class: 'glyph', text: iconFor(entry.name, entry.type) }),
        el('span', { class: 'label', text: entry.name }),
      ));
    }
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
    this.#select(e.currentTarget.closest('.dicon'));
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
      items.push({ label: 'Delete', glyph: '🗑', danger: true, run: () => {
        try {
          this.fs.rm(entry.path, '/', true);
          this.toast('Deleted', entry.name, 'ok');
        } catch (err) { this.toast('Delete failed', err.message, 'err'); }
      } });
    }
    this.openContextMenu(e.clientX, e.clientY, items);
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

  #rename(entry) {
    const name = window.prompt('New name', entry.name);
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
    this.bus.on('win:created', ({ win }) => this.#renderTaskbar());
    this.bus.on('win:closed', () => this.#renderTaskbar());
    this.bus.on('win:state', () => { this.#renderTaskbar(); this.updateTray(); });
    this.bus.on('win:focus', () => { this.#renderTaskbar(); this.updateTray(); });
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
    this.openContextMenu(e.clientX, e.clientY - 8, [
      { label: win.minimized ? 'Restore' : 'Minimise', glyph: '▾', run: () => this.wm.setMinimized(win.id, !win.minimized) },
      { label: win.maximized ? 'Restore size' : 'Maximise', glyph: '▢', run: () => this.wm.toggleMaximize(win.id) },
      { sep: true },
      { label: 'Close', glyph: '✕', run: () => this.wm.close(win.id, { guarded: true }) },
    ]);
  }

  #renderTaskbar() {
    this.taskbarItems.replaceChildren();
    for (const win of this.wm.windows.values()) {
      this.taskbarItems.append(el('button', {
        class: `titem${win.id === this.wm.focusedId ? ' focused' : ''}${win.minimized ? ' minimized' : ''}`,
        type: 'button',
        title: win.title,
        onclick: () => {
          if (win.minimized) this.wm.setMinimized(win.id, false);
          else if (win.id === this.wm.focusedId) this.wm.setMinimized(win.id, true);
          else this.wm.focus(win.id);
        },
        oncontextmenu: (e) => this.#taskbarMenu(e, win),
      },
        el('span', { class: 'glyph', text: win.icon || '▫' }),
        el('span', { class: 't', text: win.title }),
      ));
    }
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

  openContextMenu(x, y, items) {
    const menu = this.contextMenu;
    menu.replaceChildren(...items.map((item) => {
      if (item.sep) return el('div', { class: 'cmenu-sep', role: 'separator' });
      return el('button', {
        class: 'cmenu-item', type: 'button', role: 'menuitem', disabled: item.disabled === true,
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
    menu.style.left = `${Math.min(x, window.innerWidth - w - 6)}px`;
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
      if (e.altKey && e.key === 'F4') { e.preventDefault(); this.wm.closeFocused(); }
    });
  }
}
