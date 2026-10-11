import { el, fmtBytes, basename, parentPath, isImage, clamp, claimFocus } from '../core/utils.js';

const ZOOMS = [0.25, 0.5, 1, 2, 4];

export default {
  id: 'viewer',
  name: 'Image Viewer',
  icon: '🖼️',
  width: 620,
  height: 480,
  minWidth: 380,
  minHeight: 220,
  keywords: ['image', 'photo', 'preview'],

  mount(ctx, win) {
    let path = win.data?.path || null;
    let zoom = null; // null = fit to the window
    let natural = { w: 0, h: 0 };

    const main = el('div', { class: 'viewer-main' });
    const status = el('div', { class: 'statusbar' });
    const counter = el('span', { class: 'muted', text: '' });
    const zoomLabel = el('span', { class: 'muted', text: 'fit' });

    const setZoom = (z) => {
      zoom = z;
      applyZoom();
      renderStatus();
    };
    const stepZoom = (dir) => {
      const current = zoom ?? 1;
      const next = dir > 0
        ? ZOOMS.find((z) => z > current + 0.001) ?? ZOOMS.at(-1)
        : [...ZOOMS].reverse().find((z) => z < current - 0.001) ?? ZOOMS[0];
      setZoom(next);
    };

    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn ghost', title: 'Previous image in this folder', 'aria-label': 'Previous image', onclick: () => step(-1) }, '◀'),
      el('button', { class: 'btn ghost', title: 'Next image in this folder', 'aria-label': 'Next image', onclick: () => step(1) }, '▶'),
      counter,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn ghost', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => stepZoom(-1) }, '−'),
      el('button', { class: 'btn ghost', onclick: () => setZoom(null) }, 'Fit'),
      zoomLabel,
      el('button', { class: 'btn ghost', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => stepZoom(1) }, '+'),
      el('button', { class: 'btn ghost', title: 'Actual size', 'aria-label': 'Actual size', onclick: () => setZoom(1) }, '1:1'),
      el('button', { class: 'btn', onclick: () => ctx.launch('files', { data: { path: parentPath(path || ctx.fs.home) } }) }, 'Folder'),
    );

    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, main, status));

    const siblings = () => {
      if (!path) return [];
      try {
        return ctx.fs.list(parentPath(path), '/').filter((e) => e.type === 'file' && isImage(e.name));
      } catch { return []; }
    };

    const step = (dir) => {
      const list = siblings();
      if (list.length < 2) { ctx.toast('No other images', 'This is the only image in this folder', 'err'); return; }
      const at = list.findIndex((e) => e.path === path);
      const next = list[(at + dir + list.length) % list.length];
      show(next.path);
    };

    const applyZoom = () => {
      const img = main.querySelector('img');
      if (!img) return;
      if (zoom === null) {
        main.classList.remove('zoomed');
        img.style.width = '';
        img.style.height = '';
      } else {
        main.classList.add('zoomed');
        img.style.width = `${Math.max(1, Math.round(natural.w * zoom))}px`;
      }
    };

    const renderStatus = () => {
      const info = path && ctx.fs.stat(path, '/');
      const list = siblings();
      const at = list.findIndex((e) => e.path === path);
      counter.textContent = list.length > 1 ? `${at + 1} / ${list.length}` : '';
      zoomLabel.textContent = zoom === null ? 'fit' : `${Math.round(zoom * 100)}%`;
      status.replaceChildren(
        el('span', { text: path ? ctx.fs.display(path) : 'no file' }),
        el('span', { text: info?.type === 'file' ? fmtBytes(info.size) : '' }),
        el('span', { text: natural.w ? `${natural.w}×${natural.h} px` : '' }),
        el('span', { text: info?.modified ? `modified ${info.modified.slice(0, 16).replace('T', ' ')}` : '' }),
        el('span', { class: 'muted', text: '← → change image · + − zoom · 0 fit' }),
      );
    };

    const show = (nextPath) => {
      path = nextPath;
      win.data = { path };
      zoom = null;
      natural = { w: 0, h: 0 };
      main.replaceChildren(el('div', { class: 'empty-state' }, 'Loading…'));
      main.classList.remove('zoomed');
      win.setTitle(`${basename(path)} — Image Viewer`);

      let content = '';
      try { content = ctx.fs.read(path, '/'); } catch (err) {
        main.replaceChildren(el('div', { class: 'empty-state' }, String(err.message)));
        renderStatus();
        return;
      }

      if (isImage(path) && content.startsWith('data:image')) {
        const img = el('img', { src: content, alt: basename(path) });
        img.addEventListener('load', () => {
          natural = { w: img.naturalWidth, h: img.naturalHeight };
          applyZoom();
          renderStatus();
        });
        img.addEventListener('error', () => {
          main.replaceChildren(el('div', { class: 'empty-state' }, 'This image could not be decoded.'));
          renderStatus();
        });
        main.replaceChildren(img);
      } else if (isImage(path)) {
        main.replaceChildren(el('div', { class: 'empty-state' }, 'This file has an image name but does not contain image data.'));
      } else {
        main.classList.add('viewer-text');
        main.replaceChildren(el('pre', { text: content }));
      }
      renderStatus();
    };

    /* Keyboard: arrows walk the folder, +/-/0 control the zoom. */
    const onKeys = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
      else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
      else if (e.key === '0') { e.preventDefault(); setZoom(null); }
      else if (e.key === '1') { e.preventDefault(); setZoom(1); }
    };
    win.body.setAttribute('tabindex', '0');
    win.body.addEventListener('keydown', onKeys);

    /* Pinch zoom (touch): two fingers scale the image continuously between 10% and
       800%. The zoom is anchored at the pinch midpoint — the point of the image
       between your fingers stays between your fingers, so you can actually inspect a
       detail. One finger still scrolls a zoomed image (CSS touch-action allows pan;
       it is switched off only while a pinch is in progress). */
    const touchPointers = new Map();
    let pinch = null;
    const pinchDist = () => {
      const [a, b] = [...touchPointers.values()];
      return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    };
    const pinchMid = () => {
      const [a, b] = [...touchPointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const currentScale = () => {
      const img = main.querySelector('img');
      if (!img || !natural.w) return 1;
      return img.getBoundingClientRect().width / natural.w;
    };
    /* Keep the image content that was under the starting midpoint under the current
       midpoint: measure where the image landed after relayout and scroll by the
       difference. Measuring beats arithmetic here — the image is centred by CSS, so
       the layout origin is not something we should have to re-derive. */
    const anchorPinch = (mid) => {
      const img = main.querySelector('img');
      if (!img || !pinch?.anchor) return;
      const scaleNow = currentScale();
      const f = scaleNow / pinch.zoom;
      if (!Number.isFinite(f) || f <= 0) return;
      const rect = img.getBoundingClientRect();
      main.scrollLeft += rect.left - (mid.x - pinch.anchor.x * f);
      main.scrollTop += rect.top - (mid.y - pinch.anchor.y * f);
    };
    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !natural.w) return;
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointers.size === 2) {
        const mid = pinchMid();
        const img = main.querySelector('img');
        const rect = img ? img.getBoundingClientRect() : null;
        pinch = {
          dist: pinchDist(),
          zoom: currentScale(),
          anchor: rect ? { x: mid.x - rect.left, y: mid.y - rect.top } : null,
        };
        main.style.touchAction = 'none';
      }
    });
    main.addEventListener('pointermove', (e) => {
      if (!touchPointers.has(e.pointerId)) return;
      touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touchPointers.size === 2) {
        const mid = pinchMid();
        zoom = clamp(pinch.zoom * (pinchDist() / pinch.dist), 0.1, 8);
        applyZoom();
        anchorPinch(mid);
        renderStatus();
      }
    });
    const endTouch = (e) => {
      touchPointers.delete(e.pointerId);
      if (touchPointers.size < 2 && pinch) {
        pinch = null;
        main.style.touchAction = '';
      }
    };
    main.addEventListener('pointerup', endTouch);
    main.addEventListener('pointercancel', endTouch);

    if (!path) {
      main.replaceChildren(el('div', { class: 'empty-state' }, 'Open an image from the Files app, or draw one in Paint.'));
      renderStatus();
    } else {
      show(path);
      claimFocus(win, win.body);
    }

    return () => win.body.removeEventListener('keydown', onKeys);
  },
};
