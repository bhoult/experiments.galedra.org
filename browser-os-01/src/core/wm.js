import { el, clamp } from './utils.js';

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
    this.bus.emit('win:created', { win });
    return win;
  }

  openWindow(spec) {
    const id = `win-${++idSeq}`;
    const area = this.area;
    const width = clamp(spec.width, spec.minWidth, Math.max(240, area.w - 16));
    const height = clamp(spec.height, spec.minHeight, Math.max(140, area.h - 16));
    const offset = (this.spawnCount++ % 7) * 26;
    const x = spec.x ?? clamp(48 + offset, 0, Math.max(0, area.w - width));
    const y = spec.y ?? clamp(36 + offset * 0.8, 0, Math.max(0, area.h - height));

    const node = el('div', { class: 'window', id, role: 'dialog', 'aria-modal': 'false', 'aria-label': spec.title, dataset: { winId: id, app: spec.appId || '' } },
      el('div', { class: 'titlebar' },
        el('span', { class: 'wicon', text: spec.icon || '▫' }),
        el('span', { class: 'wtitle', text: spec.title }),
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
        node.append(el('div', { class: `rz rz-${dir}`, dataset: { dir } }));
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
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      cleanup: null,
      /** Apps may set win.onCloseRequest to veto a user-initiated close (return false). */
      onCloseRequest: null,
      setTitle: (t) => {
        win.title = t;
        node.querySelector('.wtitle').textContent = t;
        node.setAttribute('aria-label', t);
        this.bus.emit('win:state', { win });
      },
    };

    this.windows.set(id, win);
    node.addEventListener('pointerdown', () => this.focus(id));
    this.#wireTitlebar(win);
    this.#wireResize(win);
    this.focus(id);
    return win;
  }

  close(id, { guarded = false } = {}) {
    const win = this.windows.get(id);
    if (!win) return;
    if (guarded && win.onCloseRequest) {
      let allowed = true;
      try { allowed = win.onCloseRequest() !== false; } catch { allowed = true; }
      if (!allowed) return false;
    }
    try { win.cleanup?.(); } catch (err) { console.error('[wm] cleanup failed:', err); }
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

  #rect(win) {
    return {
      x: parseInt(win.el.style.left || 0, 10),
      y: parseInt(win.el.style.top || 0, 10),
      w: win.el.offsetWidth,
      h: win.el.offsetHeight,
    };
  }

  #wireTitlebar(win) {
    const bar = win.el.querySelector('.titlebar');

    bar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.wbtn')) return;
      this.toggleMaximize(win.id);
    });

    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wbtn')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      this.focus(win.id);
      bar.setPointerCapture(e.pointerId);

      const start = { px: e.clientX, py: e.clientY, ...this.#rect(win) };
      const wasMaximized = win.maximized;
      let snap = null;

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

        const nx = clamp(start.x + dx, -start.w + 80, area.w - 80);
        const ny = clamp(start.y + dy, 0, area.h - 28);
        Object.assign(win.el.style, { left: `${nx}px`, top: `${ny}px` });

        const next = this.#snapTarget(ev.clientX, ev.clientY);
        if (next?.key !== snap?.key) {
          snap = next;
          if (snap) {
            this.snapPreview.classList.remove('hidden');
            Object.assign(this.snapPreview.style, {
              left: `${snap.x}px`, top: `${snap.y}px`, width: `${snap.w}px`, height: `${snap.h}px`,
            });
          } else {
            this.snapPreview.classList.add('hidden');
          }
        }
      };

      const onUp = () => {
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        bar.removeEventListener('pointercancel', onUp);
        this.snapPreview.classList.add('hidden');
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

      bar.addEventListener('pointermove', onMove);
      bar.addEventListener('pointerup', onUp);
      bar.addEventListener('pointercancel', onUp);
    });
  }

  #snapTarget(px, py) {
    const area = this.area;
    const edge = 14;
    const half = { w: Math.floor(area.w / 2), h: area.h };
    if (py <= edge) return { key: 'max', maximize: true, x: 0, y: 0, w: area.w, h: area.h };
    if (px <= edge) return { key: 'left', x: 0, y: 0, w: half.w, h: half.h };
    if (px >= area.w - edge) return { key: 'right', x: area.w - half.w, y: 0, w: half.w, h: half.h };
    return null;
  }

  /* ---------- resizing ---------- */

  #wireResize(win) {
    for (const handle of win.el.querySelectorAll('.rz')) {
      const dir = handle.dataset.dir;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.focus(win.id);
        handle.setPointerCapture(e.pointerId);
        const start = { px: e.clientX, py: e.clientY, ...this.#rect(win) };
        const area = this.area;

        const onMove = (ev) => {
          const dx = ev.clientX - start.px;
          const dy = ev.clientY - start.py;
          let { x, y, w, h } = start;
          if (dir.includes('e')) w = clamp(start.w + dx, win.minWidth, area.w - x);
          if (dir.includes('s')) h = clamp(start.h + dy, win.minHeight, area.h - y);
          if (dir.includes('w')) {
            w = clamp(start.w - dx, win.minWidth, start.x + start.w);
            x = start.x + start.w - w;
          }
          if (dir.includes('n')) {
            h = clamp(start.h - dy, win.minHeight, start.y + start.h);
            y = start.y + start.h - h;
          }
          Object.assign(win.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        };

        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    }
  }
}
