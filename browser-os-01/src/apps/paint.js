import { el } from '../core/utils.js';

const PALETTE = ['#e9edf7', '#ff5f6d', '#f2a33c', '#7ac94a', '#21c7b8', '#4f8cff', '#a06bff', '#111318'];

export default {
  id: 'paint',
  name: 'Paint',
  icon: '🎨',
  width: 720,
  height: 520,
  minWidth: 360,
  minHeight: 300,
  keywords: ['draw', 'canvas', 'sketch', 'image'],

  mount(ctx, win) {
    let tool = 'pen';
    let color = '#4f8cff';
    let size = 6;
    let drawing = false;
    let last = null;
    const undoStack = [];

    const canvas = el('canvas', { class: 'paint-canvas' });
    const main = el('div', { class: 'paint-main' }, canvas);
    const status = el('div', { class: 'statusbar' },
      el('span', { class: 'paint-tool-hint', text: 'pen tool · drag to draw' }),
      el('span', { class: 'muted paint-size', text: '' }));
    const colorInput = el('input', { type: 'color', class: 'swatch', value: color, title: 'Custom colour', 'aria-label': 'Custom colour' });
    const sizeInput = el('input', { type: 'range', min: '1', max: '48', value: '6', class: 'field', style: { width: '120px', padding: '0 6px' } });
    const sizeLabel = el('span', { class: 'muted', text: '6px' });

    const seg = el('div', { class: 'seg' });
    const setTool = (name) => {
      tool = name;
      [...seg.children].forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
      status.firstChild.textContent = `${name} tool · drag to draw`;
    };
    for (const [name, label] of [['pen', '✏️ Pen'], ['line', '📏 Line'], ['eraser', '🧽 Eraser']]) {
      seg.append(el('button', { type: 'button', dataset: { tool: name }, onclick: () => setTool(name) }, label));
    }

    const toolbar = el('div', { class: 'toolbar' },
      seg,
      colorInput,
      ...PALETTE.map((c) => el('button', {
        class: 'swatch', type: 'button', title: c, 'aria-label': `Colour ${c}`, dataset: { color: c },
        style: { background: c },
        onclick: () => { setColor(c); if (tool === 'eraser') setTool('pen'); },
      })),
      sizeInput, sizeLabel,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn ghost', onclick: () => undo() }, 'Undo'),
      el('button', { class: 'btn ghost', onclick: () => { snapshot(); clearCanvas(); paintBackground(); } }, 'Clear'),
      el('button', { class: 'btn primary', onclick: () => save() }, 'Save PNG'),
    );

    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, main, status));

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
        undoStack.push(canvas.toDataURL());
        if (undoStack.length > 25) undoStack.shift();
      } catch { /* ignore */ }
    };

    const undo = () => {
      const prev = undoStack.pop();
      if (!prev) return ctx.toast('Nothing to undo', '', 'err');
      const img = new Image();
      img.onload = () => {
        clearCanvas();
        ctx2d.save();
        ctx2d.setTransform(1, 0, 0, 1, 0, 0);
        ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx2d.restore();
      };
      img.src = prev;
    };

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
