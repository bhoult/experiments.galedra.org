import { el } from '../core/utils.js';

const PALETTE = ['#e9edf7', '#ff5f6d', '#f2a33c', '#7ac94a', '#21c7b8', '#4f8cff', '#a06bff', '#111318'];

export default {
  id: 'paint',
  name: 'Paint',
  icon: '🎨',
  width: 880,
  height: 560,
  minWidth: 420,
  minHeight: 300,
  keywords: ['draw', 'canvas', 'sketch', 'image'],

  mount(ctx, win) {
    let tool = 'pen';
    let color = '#4f8cff';
    let size = 6;
    let drawing = false;
    let last = null;
    /* Undo snapshots are raw ImageData, not PNG data URLs: no encode/decode per stroke,
       and the stack is capped by a byte budget rather than a fixed count, so a large
       canvas keeps fewer (but still plenty of) steps instead of tens of megabytes. */
    const MAX_UNDO_BYTES = 48 * 1024 * 1024;
    const undoStack = [];
    /* Undo pops snapshots; without somewhere to put them, an accidental Ctrl+Z is
       irreversible. Redo holds what undo has taken, and any new stroke drops it. */
    const redoStack = [];

    const canvas = el('canvas', { class: 'paint-canvas' });
    const main = el('div', { class: 'paint-main' }, canvas);
    const status = el('div', { class: 'statusbar' },
      el('span', { class: 'paint-tool-hint', text: 'pen tool · drag to draw' }),
      el('span', { class: 'muted paint-size', text: '' }));
    const colorInput = el('input', { type: 'color', class: 'swatch', value: color, title: 'Custom colour', 'aria-label': 'Custom colour' });
    const sizeInput = el('input', { type: 'range', min: '1', max: '48', value: '6', class: 'field paint-size-slider', 'aria-label': 'Brush size in pixels', title: 'Brush size in pixels' });
    const sizeLabel = el('span', { class: 'muted paint-size-readout', text: '6px' });

    const seg = el('div', { class: 'seg paint-tools', role: 'group', 'aria-label': 'Paint tools' });
    const setTool = (name) => {
      tool = name;
      [...seg.children].forEach((b) => {
        const active = b.dataset.tool === name;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      status.firstChild.textContent = `${name} tool · drag to draw`;
    };
    /* Every toolbar control carries both a glyph and a word. The word is what you read
       normally; the glyph is what survives when the bar gets narrow (see data-collapse),
       so a cramped Paint window still shows its tools instead of losing them. */
    const labelled = (glyph, label, cls, attrs = {}) => el('button', {
      type: 'button', class: cls, 'aria-label': label, title: label, ...attrs,
    },
      el('span', { class: 'btn-glyph', 'aria-hidden': 'true', text: glyph }),
      el('span', { class: 'btn-label', text: label }),
    );
    for (const [name, glyph, label] of [['pen', '✏️', 'Pen'], ['line', '📏', 'Line'], ['eraser', '🧽', 'Eraser']]) {
      seg.append(labelled(glyph, label, '', { dataset: { tool: name }, 'aria-pressed': 'false', onclick: () => setTool(name) }));
    }

    let undoBtn, redoBtn;
    /** Undo/Redo are honest: a button that can do nothing is visibly disabled. */
    const syncHistory = () => {
      if (undoBtn) {
        undoBtn.disabled = undoStack.length === 0;
        undoBtn.title = undoStack.length ? `Undo (${undoStack.length} step${undoStack.length > 1 ? 's' : ''} available)` : 'Nothing to undo';
      }
      if (redoBtn) {
        redoBtn.disabled = redoStack.length === 0;
        redoBtn.title = redoStack.length ? `Redo (${redoStack.length} step${redoStack.length > 1 ? 's' : ''})` : 'Nothing to redo';
      }
    };

    /* The palette is the one part of this toolbar that is genuinely replaceable: the
       colour input next to it picks any colour at all. So at a width where the bar cannot
       fit everything, the swatches are what disappears (see data-collapse) and Undo/Redo/
       Clear/Save PNG — the actions with no other route — stay reachable. It is offered as
       foldable units rather than one block, so a bar that only needs 40px gives up one
       swatch and not the whole row, and from the end: the colours listed first are the
       ones worth keeping. */
    const palette = el('div', {
      class: 'paint-palette', role: 'group', 'aria-label': 'Palette',
      dataset: { collapseUnits: '.swatch[data-color]', collapseUnitsFrom: 'end' },
    },
      ...PALETTE.map((c) => el('button', {
        class: 'swatch', type: 'button', title: c, 'aria-label': `Palette colour ${c}`, dataset: { color: c },
        style: { background: c },
        onclick: () => { setColor(c); if (tool === 'eraser') setTool('pen'); },
      })),
    );

    const history = el('div', { class: 'paint-actions' },
      (undoBtn = labelled('↶', 'Undo', 'btn ghost', { onclick: () => undo() })),
      (redoBtn = labelled('↷', 'Redo', 'btn ghost', { onclick: () => redo() })),
      labelled('🗑', 'Clear', 'btn ghost', { onclick: () => { snapshot(); clearCanvas(); paintBackground(); } }),
    );

    /* Collapse order, least valuable first: the palette (the colour input beside it can
       pick any colour), the size readout (the slider itself still shows the value), then
       the tool and action labels shrink to their glyphs. "Save PNG" is never collapsible:
       it is the one action with no other route out of this window. */
    const toolbar = el('div', { class: 'toolbar', dataset: { collapse: '.paint-palette, .paint-size-readout, .paint-tools, .paint-actions' } },
      seg,
      colorInput,
      palette,
      sizeInput, sizeLabel,
      el('span', { class: 'spacer' }),
      history,
      el('button', { class: 'btn primary', onclick: () => save() }, 'Save PNG'),
    );

    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, main, status));

    setTool('pen'); // the toolbar must show the tool the status bar claims is active

    const swatches = [...win.body.querySelectorAll('.swatch[data-color]')];

    const ctx2d = canvas.getContext('2d');

    /* The canvas backing store is sized in device pixels, but every drawing call uses CSS
       pixels. Keeping a persistent dpr transform is what makes strokes land where the
       pointer is on HiDPI screens (and keeps saved PNGs at full resolution). */
    let dpr = 1;
    let cssW = 1;
    let cssH = 1;

    const fit = () => {
      // Layout size, not getBoundingClientRect: window open/close animations use a CSS
      // transform, which would otherwise bake an oversized backing store into the canvas.
      cssW = Math.max(1, main.clientWidth || 1);
      cssH = Math.max(1, main.clientHeight || 1);
      dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width === w && canvas.height === h) return;
      const prev = document.createElement('canvas');
      prev.width = canvas.width; prev.height = canvas.height;
      prev.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width = w; canvas.height = h;
      ctx2d.save();
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.drawImage(prev, 0, 0);
      ctx2d.restore();
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintBackground();
      status.querySelector('.paint-size').textContent = `${cssW}×${cssH} px`;
    };

    const paintBackground = () => {
      // Keep an opaque white sheet so saved PNGs are not transparent.
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'destination-over';
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, cssW, cssH);
      ctx2d.restore();
    };

    const clearCanvas = () => {
      ctx2d.save();
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.restore();
    };

    const observer = new ResizeObserver(() => fit());
    observer.observe(main);
    fit();

    const pos = (e) => {
      const rect = canvas.getBoundingClientRect();
      // Convert pointer coordinates into layout pixels, which is the space the backing
      // store is drawn in. During a transform animation the two differ slightly.
      const fx = rect.width ? (canvas.offsetWidth || rect.width) / rect.width : 1;
      const fy = rect.height ? (canvas.offsetHeight || rect.height) / rect.height : 1;
      return { x: (e.clientX - rect.left) * fx, y: (e.clientY - rect.top) * fy };
    };

    const strokeStyle = () => {
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.lineWidth = size;
      ctx2d.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
      ctx2d.globalCompositeOperation = 'source-over';
    };

    const drawLine = (from, to) => {
      strokeStyle();
      ctx2d.beginPath();
      ctx2d.moveTo(from.x, from.y);
      ctx2d.lineTo(to.x, to.y);
      ctx2d.stroke();
    };

    let lineBackup = null;

    const restoreBackup = () => {
      if (!lineBackup) return;
      clearCanvas();
      ctx2d.save();
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.drawImage(lineBackup, 0, 0);
      ctx2d.restore();
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      snapshot();
      drawing = true;
      last = pos(e);
      if (tool === 'line') {
        // Keep the pre-drag pixels so the rubber-band preview can be redrawn every frame.
        lineBackup = document.createElement('canvas');
        lineBackup.width = canvas.width; lineBackup.height = canvas.height;
        lineBackup.getContext('2d').drawImage(canvas, 0, 0);
      } else {
        strokeStyle();
        ctx2d.beginPath();
        ctx2d.moveTo(last.x, last.y);
        ctx2d.lineTo(last.x + 0.01, last.y);
        ctx2d.stroke();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      if (tool === 'line') {
        restoreBackup();
        drawLine(last, p);
        return;
      }
      drawLine(last, p);
      last = p;
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drawing) return;
      drawing = false;
      const p = pos(e);
      if (tool === 'line') {
        restoreBackup();
        drawLine(last, p);
        lineBackup = null;
      }
      last = p;
    });

    const snapshot = () => {
      try {
        undoStack.push(ctx2d.getImageData(0, 0, canvas.width, canvas.height));
        let total = 0;
        for (const s of undoStack) total += s.data.byteLength;
        while (undoStack.length > 1 && total > MAX_UNDO_BYTES) total -= undoStack.shift().data.byteLength;
        redoStack.length = 0; // a new stroke invalidates the redo branch
        syncHistory();
      } catch { /* ignore */ }
    };

    const restoreSnapshot = (prev) => {
      ctx2d.save();
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      if (prev.width === canvas.width && prev.height === canvas.height) {
        ctx2d.putImageData(prev, 0, 0);
      } else {
        /* The canvas was resized after this snapshot: restore it scaled to the current
           backing store, the same way fit() carries the live canvas across a resize. */
        const tmp = document.createElement('canvas');
        tmp.width = prev.width;
        tmp.height = prev.height;
        tmp.getContext('2d').putImageData(prev, 0, 0);
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        ctx2d.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      }
      ctx2d.restore();
    };

    const undo = () => {
      const prev = undoStack.pop();
      if (!prev) return ctx.toast('Nothing to undo', '', 'err');
      redoStack.push(prev);
      restoreSnapshot(prev);
      syncHistory();
    };

    const redo = () => {
      const next = redoStack.pop();
      if (!next) return ctx.toast('Nothing to redo', '', 'err');
      undoStack.push(next);
      restoreSnapshot(next);
      syncHistory();
    };

    /* Ctrl/Cmd+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes — scoped to this window, so the
       shortcut never steals a keystroke from another app. */
    win.el.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
    });

    syncHistory();

    const save = () => {
      paintBackground();
      const data = canvas.toDataURL('image/png');
      const dir = `${ctx.fs.home}/Pictures`;
      const name = ctx.fs.uniqueName(dir, 'sketch.png');
      const path = `${dir}/${name}`;
      try {
        ctx.fs.write(path, data, '/');
        win.setTitle(`${name} — Paint`);
        win.data = { path };
        ctx.toast('Saved', ctx.fs.display(path), 'ok');
        ctx.launch('viewer', { data: { path } });
      } catch (err) { ctx.toast('Save failed', err.message, 'err'); }
    };

    colorInput.addEventListener('input', () => setColor(colorInput.value));
    sizeInput.addEventListener('input', () => { size = Number(sizeInput.value); sizeLabel.textContent = `${size}px`; });

    const setColor = (c) => {
      color = c;
      colorInput.value = c;
      swatches.forEach((b) => b.classList.toggle('active', b.dataset.color === c));
    };
    setColor(color); // show which colour is currently selected from the first stroke on

    win.setTitle('Paint — untitled');

    /* Re-opening a saved sketch (session restore, or opening a PNG from Files). */
    if (win.data?.path) {
      try {
        const data = ctx.fs.read(win.data.path, '/');
        if (data.startsWith('data:image')) {
          const img = new Image();
          img.onload = () => {
            clearCanvas();
            ctx2d.save();
            ctx2d.setTransform(1, 0, 0, 1, 0, 0);
            ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx2d.restore();
            paintBackground();
          };
          img.src = data;
          win.setTitle(`${win.data.path.split('/').pop()} — Paint`);
        }
      } catch { /* stale restored path: start a blank sheet instead */ }
    }

    return () => observer.disconnect();
  },
};
