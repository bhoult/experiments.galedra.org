import { el, clamp, watchToolbarOverflow, reachableControls } from './utils.js';
import { snapTarget, zoneRect, zoneLabel, resizeRect, moveRect, spawnOrigin, nearestQuarter } from './geometry.js';

let zTop = 100;
let idSeq = 0;

/**
 * Minimal but real window manager: z-order, focus, drag, resize, snap-tiling,
 * minimize/maximize, and per-app mount lifecycle.
 */
export class WindowManager {
  constructor({ bus, layer, apps, ctx }) {
    this.bus = bus;
    this.layer = layer;
    this.apps = new Map(apps.map((a) => [a.id, a]));
    this.windows = new Map();
    this.focusedId = null;
    this.snapPreview = document.getElementById('snap-preview');
    this.ctx = ctx;
    this.spawnCount = 0;

    window.addEventListener('resize', () => this.constrainAll());
  }

  get area() {
    return { w: this.layer.clientWidth, h: this.layer.clientHeight };
  }

  /* ---------- lifecycle ---------- */

  async launch(appId, opts = {}) {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`unknown app: ${appId}`);

    const dedupe = app.singleton === true || (app.singleton !== false && !opts.newWindow);
    const key = dedupe ? `${appId}::${opts.data ? JSON.stringify(opts.data) : ''}` : null;
    if (key) {
      for (const win of this.windows.values()) {
        if (win.key === key) {
          if (win.minimized) this.setMinimized(win.id, false);
          this.focus(win.id);
          return win;
        }
      }
    }

    const spec = {
      appId,
      app,
      key,
      title: opts.title || app.name,
      icon: app.icon,
      data: opts.data || null,
      width: opts.width || app.width || 640,
      height: opts.height || app.height || 420,
      minWidth: app.minWidth ?? 260,
      minHeight: app.minHeight ?? 160,
      resizable: app.resizable !== false,
      closable: app.closable !== false,
      x: opts.x, y: opts.y,
    };

    const win = this.openWindow(spec);
    try {
      const cleanup = await app.mount(this.ctx, win);
      if (typeof cleanup === 'function') win.cleanup = cleanup;
    } catch (err) {
      console.error(`[wm] app "${appId}" failed to mount:`, err);
      win.body.replaceChildren(el('div', { class: 'empty-state' }, `This app crashed: ${String(err?.message || err)}`));
    }
    /* One place owns the "this toolbar is cut off on that side" fade, so no app can
       forget to ask for it: a toolbar that scrolls must show which side is hidden. It also
       owns the `⋯` menu that keeps the cut-off actions reachable — the menu itself is the
       Shell's, so this asks for it over the bus. */
    const openMenu = (x, y, items) => this.bus.emit('contextmenu:request', { x, y, items, within: win.el.getBoundingClientRect() });
    win.toolbarFades = [...win.el.querySelectorAll('.toolbar')].map((bar) => watchToolbarOverflow(bar, { openMenu }));
    win.refreshToolbarFades = () => { for (const stop of win.toolbarFades) stop.refresh(); };
    this.bus.emit('win:created', { win });
    return win;
  }

  openWindow(spec) {
    const id = `win-${++idSeq}`;
    const area = this.area;
    const width = clamp(spec.width, spec.minWidth, Math.max(240, area.w - 16));
    const height = clamp(spec.height, spec.minHeight, Math.max(140, area.h - 16));
    const spot = spawnOrigin(area, width, height, this.#iconBottom(), this.spawnCount++);
    const x = spec.x ?? spot.x;
    const y = spec.y ?? spot.y;

    const node = el('div', { class: 'window', id, role: 'dialog', 'aria-modal': 'false', 'aria-label': spec.title, dataset: { winId: id, app: spec.appId || '' } },
      el('div', {
        class: 'titlebar', tabindex: '0', role: 'group',
        'aria-label': `${spec.title} title bar — arrow keys move the window, Shift+arrow keys resize it, Alt+arrow keys snap it, Enter maximises`,
      },
        el('span', { class: 'wicon', text: spec.icon || '▫' }),
        /* The title is ellipsised when the window is narrow. `title` is what makes a cut
           name readable in full: the visible text is a summary, the tooltip is the name. */
        el('span', { class: 'wtitle', title: spec.title, text: spec.title }),
        el('div', { class: 'wcontrols' },
          spec.app?.hideMinimize ? null : el('button', { class: 'wbtn min', title: 'Minimize', 'aria-label': 'Minimize window', onclick: () => this.setMinimized(id, true) }, '–'),
          spec.app?.hideMaximize ? null : el('button', { class: 'wbtn max', title: 'Maximize', 'aria-label': 'Maximize window', onclick: () => this.toggleMaximize(id) }, '▢'),
          spec.closable === false ? null : el('button', { class: 'wbtn close', title: 'Close', 'aria-label': 'Close window', onclick: () => this.close(id, { guarded: true }) }, '✕'),
        ),
      ),
      el('div', { class: 'wbody' }),
    );

    if (spec.resizable !== false) {
      for (const dir of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
        node.append(el('div', { class: `rz rz-${dir}`, dataset: { dir } },
          /* The top edge is the one people grab to *move* a window, so its middle is a
             move strip and only its ends stay resize handles. */
          dir === 'n' ? el('div', { class: 'rz-move', 'aria-hidden': 'true', title: 'Drag to move this window' }) : null));
      }
    }

    Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    this.layer.append(node);

    const win = {
      id,
      appId: spec.appId,
      app: spec.app,
      key: spec.key,
      title: spec.title,
      icon: spec.icon,
      data: spec.data,
      el: node,
      body: node.querySelector('.wbody'),
      minimized: false,
      maximized: false,
      prevRect: null,
      /* Rectangles this window had before the user moved or resized it — see #recordMove. */
      moveHistory: [],
      moveAt: 0,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      cleanup: null,
      /** Apps may set win.onCloseRequest to veto a user-initiated close (return false). */
      onCloseRequest: null,
      setTitle: (t) => {
        win.title = t;
        const titleNode = node.querySelector('.wtitle');
        titleNode.textContent = t;
        titleNode.title = t;
        node.setAttribute('aria-label', t);
        this.bus.emit('win:state', { win });
      },
    };

    this.windows.set(id, win);
    node.addEventListener('pointerdown', () => this.focus(id));
    this.#wireTitlebar(win);
    this.#wireFocusRing(win);
    this.#wireResize(win);
    this.focus(id);
    return win;
  }

  async close(id, { guarded = false } = {}) {
    const win = this.windows.get(id);
    if (!win) return;
    if (guarded && win.onCloseRequest) {
      let allowed = true;
      try { allowed = (await win.onCloseRequest()) !== false; } catch { allowed = true; }
      if (!allowed) return false;
    }
    try { win.cleanup?.(); } catch (err) { console.error('[wm] cleanup failed:', err); }
    for (const stop of win.toolbarFades || []) { try { stop(); } catch { /* already gone */ } }
    win.el.classList.add('closing');
    win.el.addEventListener('animationend', () => win.el.remove(), { once: true });
    setTimeout(() => win.el.remove(), 240);
    this.windows.delete(id);
    if (this.focusedId === id) this.focusedId = null;
    this.bus.emit('win:closed', { win });
    const next = [...this.windows.values()].find((w) => !w.minimized);
    if (next) this.focus(next.id);
    return true;
  }

  closeFocused() {
    if (this.focusedId) this.close(this.focusedId, { guarded: true });
  }

  /** Snap the focused window into a zone; 'nearest' means whichever quarter it is in. */
  snapFocused(zone) {
    const win = this.focusedWindow;
    if (!win) return false;
    if (zone === 'nearest') return this.snapTo(win.id, nearestQuarter(this.#rect(win), this.area));
    return this.snapTo(win.id, zone);
  }

  /* ---------- keyboard-driven geometry ---------- */

  /** Snap a window into a named zone: max | left | right | tl | tr | bl | br. */
  snapTo(id, zone) {
    const win = this.windows.get(id);
    if (!win) return false;
    const target = zoneRect(this.area, zone);
    if (!target) return false;
    if (zone === 'max') { if (!win.maximized) this.toggleMaximize(id); return true; }
    if (win.maximized) { win.maximized = false; win.el.classList.remove('maximized'); }
    this.#recordMove(win);
    win.prevRect = this.#rect(win);
    Object.assign(win.el.style, {
      left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px`,
    });
    this.focus(id);
    this.bus.emit('win:state', { win });
    return true;
  }

  /** Move the window by a keyboard step, keeping the title bar reachable. */
  nudge(id, dx, dy) {
    const win = this.windows.get(id);
    if (!win || win.maximized) return false;
    this.#recordMove(win);
    const next = moveRect(this.#rect(win), dx, dy, this.area);
    Object.assign(win.el.style, { left: `${next.x}px`, top: `${next.y}px` });
    this.bus.emit('win:state', { win });
    return true;
  }

  /** Grow/shrink the window from the keyboard (keeps the top-left corner fixed). */
  resizeBy(id, dx, dy) {
    const win = this.windows.get(id);
    if (!win || win.maximized) return false;
    this.#recordMove(win);
    const next = resizeRect(this.#rect(win), 'se', dx, dy, {
      minWidth: win.minWidth, minHeight: win.minHeight, area: this.area,
    });
    Object.assign(win.el.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
    this.bus.emit('win:state', { win });
    return true;
  }

  /** Bottom edge of the desktop icon grid, so new windows do not land on top of it. */
  #iconBottom() {
    const layer = document.getElementById('desktop-icons');
    if (!layer) return 0;
    /* Only the part of the grid you can actually see: the grid scrolls now, and reserving
       space for icons below the fold would push every window off the bottom of the screen. */
    const visible = layer.getBoundingClientRect().bottom;
    let bottom = 0;
    for (const icon of layer.children) bottom = Math.max(bottom, icon.getBoundingClientRect().bottom);
    return Math.max(0, Math.min(bottom, visible) - this.layer.getBoundingClientRect().top);
  }

  /** Snapshot of open windows, for restoring the session after a reload. */
  serialize() {
    return [...this.windows.values()].map((win) => ({
      appId: win.appId,
      data: win.data ?? null,
      rect: this.#rect(win),
      maximized: win.maximized,
      minimized: win.minimized,
    }));
  }

  async restore(list = []) {
    for (const item of list) {
      if (!item?.appId || !this.apps.has(item.appId)) continue;
      const r = item.rect || {};
      const win = await this.launch(item.appId, { data: item.data, x: r.x, y: r.y, width: r.w, height: r.h });
      if (!win) continue;
      if (item.maximized && !win.maximized) this.toggleMaximize(win.id);
      if (item.minimized) this.setMinimized(win.id, true);
    }
  }

  setMinimized(id, minimized) {
    const win = this.windows.get(id);
    if (!win || win.minimized === minimized) return;
    win.minimized = minimized;
    win.el.classList.toggle('minimized', minimized);
    if (minimized && this.focusedId === id) this.focusedId = null;
    else if (!minimized) this.focus(id);
    this.bus.emit('win:state', { win });
  }

  toggleMaximize(id) {
    const win = this.windows.get(id);
    if (!win) return;
    const area = this.area;
    if (win.maximized) {
      const r = win.prevRect || { x: 40, y: 40, w: 640, h: 420 };
      Object.assign(win.el.style, {
        left: `${clamp(r.x, 0, Math.max(0, area.w - r.w))}px`,
        top: `${clamp(r.y, 0, Math.max(0, area.h - r.h))}px`,
        width: `${r.w}px`, height: `${r.h}px`,
      });
      win.maximized = false;
      win.prevRect = null;
      win.el.classList.remove('maximized');
    } else {
      win.prevRect = this.#rect(win);
      win.maximized = true;
      win.el.classList.add('maximized');
      Object.assign(win.el.style, { left: '0px', top: '0px', width: `${area.w}px`, height: `${area.h}px` });
    }
    this.focus(id);
    this.bus.emit('win:state', { win });
  }

  focus(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (this.focusedId === id && win.el.style.zIndex == zTop) return;
    this.focusedId = id;
    win.el.style.zIndex = String(++zTop);
    for (const w of this.windows.values()) w.el.classList.toggle('focused', w.id === id);
    this.bus.emit('win:focus', { win });
  }

  get focusedWindow() {
    return this.focusedId ? this.windows.get(this.focusedId) : null;
  }

  constrainAll() {
    const area = this.area;
    for (const win of this.windows.values()) {
      if (win.maximized) {
        Object.assign(win.el.style, { left: '0px', top: '0px', width: `${area.w}px`, height: `${area.h}px` });
        continue;
      }
      const w = clamp(win.el.offsetWidth, win.minWidth, Math.max(240, area.w));
      const h = clamp(win.el.offsetHeight, win.minHeight, Math.max(140, area.h));
      Object.assign(win.el.style, {
        width: `${w}px`, height: `${h}px`,
        left: `${clamp(parseInt(win.el.style.left || 0, 10), 0, Math.max(0, area.w - w))}px`,
        top: `${clamp(parseInt(win.el.style.top || 0, 10), 0, Math.max(0, area.h - h))}px`,
      });
    }
  }

  /* ---------- dragging ---------- */

  /**
   * Remember where a window was before the user changed its rectangle, so the window menu
   * can put it back. Called at every place a user action moves a window.
   */
  #recordMove(win) {
    const rect = this.#rect(win);
    const history = win.moveHistory;
    const last = history[history.length - 1];
    const now = Date.now();
    /* A burst of arrow-key nudges is one intention, not twenty undos: records close
       together in time keep the rectangle from before the burst started. */
    if (last && now - (win.moveAt || 0) < 1000) { win.moveAt = now; return; }
    if (last && last.x === rect.x && last.y === rect.y && last.w === rect.w && last.h === rect.h) return;
    history.push(rect);
    if (history.length > 5) history.shift();
    win.moveAt = now;
  }

  /** Put a window back where it was before the last thing that moved or resized it. */
  undoMove(id) {
    const win = this.windows.get(id);
    if (!win) return false;
    const rect = win.moveHistory.pop();
    if (!rect) return false;
    if (win.maximized) {
      win.maximized = false;
      win.el.classList.remove('maximized');
    }
    const area = this.area;
    /* The screen may have shrunk since that rectangle was valid, so it is clamped back
       into it rather than restored off-screen. */
    const w = clamp(rect.w, win.minWidth, Math.max(240, area.w));
    const h = clamp(rect.h, win.minHeight, Math.max(140, area.h));
    Object.assign(win.el.style, {
      left: `${clamp(rect.x, 0, Math.max(0, area.w - w))}px`,
      top: `${clamp(rect.y, 0, Math.max(0, area.h - h))}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    win.prevRect = null;
    this.focus(id);
    this.bus.emit('win:state', { win });
    return true;
  }

  #rect(win) {
    return {
      x: parseInt(win.el.style.left || 0, 10),
      y: parseInt(win.el.style.top || 0, 10),
      w: win.el.offsetWidth,
      h: win.el.offsetHeight,
    };
  }

  /* Tab must stay inside the window you are working in: from its last control it wraps
     back to the first instead of walking out into the desktop behind it. Only the ends
     of the ring are intercepted — in the middle the browser's own order is better than
     mine, and anything that already handled Tab (the terminal's completion) is left alone. */
  #wireFocusRing(win) {
    /* The same definition of "control" the accessibility audit uses (utils.js), so the
       ring and the audit can never disagree about which controls matter. */
    const ring = () => reachableControls(win.el);

    win.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const items = ring();
      if (items.length < 2) return;
      const i = items.indexOf(document.activeElement);
      if (i === -1) return;
      const atEnd = e.shiftKey ? i === 0 : i === items.length - 1;
      if (!atEnd) return;
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    });
  }

  #wireTitlebar(win) {
    const bar = win.el.querySelector('.titlebar');

    /* Right-clicking a window's chrome is how you find out the WM can tile it: the same
       zones a drag-to-edge performs, listed where somebody can read them. The Shell owns
       the shared context menu, so this asks for it over the bus. */
    bar.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.wbtn')) return;
      e.preventDefault();
      this.focus(win.id);
      this.bus.emit('window:menu', { win, x: e.clientX, y: e.clientY });
    });

    bar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.wbtn')) return;
      this.toggleMaximize(win.id);
    });

    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wbtn')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      this.#startMove(win, e, bar);
    });

    /* Keyboard control of the window itself: focus the title bar (Tab reaches it) and use
       arrows to move, Shift+arrows to resize, Alt+arrows to snap, Enter to maximise. */
    bar.addEventListener('keydown', (e) => {
      if (e.target.closest('.wbtn')) return;
      const step = e.shiftKey && !e.altKey ? 8 : 24;
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = arrows[e.key];
      if (dir) {
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'ArrowDown' && !e.shiftKey) { this.setMinimized(win.id, !win.minimized); return; }
          this.snapTo(win.id, e.shiftKey
            ? nearestQuarter(this.#rect(win), this.area)
            : { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max' }[e.key]);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.focus(win.id);
        if (e.shiftKey) this.resizeBy(win.id, dir[0] * step, dir[1] * step);
        else this.nudge(win.id, dir[0] * step, dir[1] * step);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleMaximize(win.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close(win.id, { guarded: true });
      }
    });
  }

  /* ---------- dragging ---------- */

  /**
   * Drag the window itself. `handle` is the element that captures the pointer: the
   * title bar, or the move strip inset in the top resize edge (grabbing the top of a
   * window to move it is the instinct; only near the corners should it resize).
   */
  #startMove(win, e, handle) {
    this.focus(win.id);
    handle.setPointerCapture(e.pointerId);

    const start = { px: e.clientX, py: e.clientY, ...this.#rect(win) };
    const wasMaximized = win.maximized;
    /* Recorded before anything moves, so "Undo move" can put the window back here. */
    this.#recordMove(win);
    let snap = null;
    let preview = null;

    const onMove = (ev) => {
      const area = this.area;
      let dx = ev.clientX - start.px;
      let dy = ev.clientY - start.py;

      if (wasMaximized && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        // Pull a maximized window back off the top edge.
        const prev = win.prevRect || { w: 720, h: 460 };
        const ratio = area.w ? (start.x + start.w / 2) / area.w : 0.5;
        this.toggleMaximize(win.id);
        start.w = prev.w; start.h = prev.h;
        start.x = clamp(ev.clientX - prev.w * ratio, 0, area.w - prev.w);
        start.y = 0;
        start.px = ev.clientX; start.py = ev.clientY;
        dx = 0; dy = 0;
      }

      const moved = moveRect({ x: start.x + dx, y: start.y + dy, w: start.w, h: start.h }, 0, 0, area);
      Object.assign(win.el.style, { left: `${moved.x}px`, top: `${moved.y}px` });

      const next = snapTarget(area, ev.clientX, ev.clientY);
      if (next?.key !== preview?.key) {
        preview = next;
        snap = next;
        if (snap) {
          this.snapPreview.classList.remove('hidden');
          /* A translucent rectangle says "something will happen here"; the name inside it
             says what. Without the label a snap is a guess the user has to make twice. */
          this.snapPreview.replaceChildren(el('span', { class: 'snap-label', text: zoneLabel(snap.key) }));
          Object.assign(this.snapPreview.style, {
            left: `${snap.x}px`, top: `${snap.y}px`, width: `${snap.w}px`, height: `${snap.h}px`,
          });
        } else {
          this.snapPreview.classList.add('hidden');
          this.snapPreview.replaceChildren();
        }
      }
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      this.snapPreview.classList.add('hidden');
      this.snapPreview.replaceChildren();
      /* Pressing a title bar is not moving a window: if the rectangle is the one the drag
         started in, take the record back off so "Undo move" is not offered for nothing. */
      const now = this.#rect(win);
      if (now.x === start.x && now.y === start.y && now.w === start.w && now.h === start.h) {
        win.moveHistory.pop();
        return;
      }
      if (!snap) return;
      if (snap.maximize) {
        if (!win.maximized) this.toggleMaximize(win.id);
        return;
      }
      win.prevRect = this.#rect(win);
      win.maximized = false;
      win.el.classList.remove('maximized');
      Object.assign(win.el.style, { left: `${snap.x}px`, top: `${snap.y}px`, width: `${snap.w}px`, height: `${snap.h}px` });
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /* ---------- resizing ---------- */

  #wireResize(win) {
    for (const handle of win.el.querySelectorAll('.rz')) {
      const dir = handle.dataset.dir;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        /* The middle of the top edge is a move strip, not a resize handle. */
        if (dir === 'n' && e.target.closest('.rz-move')) { this.#startMove(win, e, handle); return; }
        this.focus(win.id);
        handle.setPointerCapture(e.pointerId);
        const start = { px: e.clientX, py: e.clientY, ...this.#rect(win) };
        const area = this.area;
        this.#recordMove(win);

        const onMove = (ev) => {
          const next = resizeRect(start, dir, ev.clientX - start.px, ev.clientY - start.py, {
            minWidth: win.minWidth, minHeight: win.minHeight, area,
          });
          Object.assign(win.el.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
        };

        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          const now = this.#rect(win);
          if (now.x === start.x && now.y === start.y && now.w === start.w && now.h === start.h) win.moveHistory.pop();
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    }
  }
}
