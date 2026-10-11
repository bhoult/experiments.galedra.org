import { el, fmtBytes, basename, claimFocus } from '../core/utils.js';

export default {
  id: 'editor',
  name: 'Text Editor',
  icon: '📝',
  width: 640,
  height: 480,
  minWidth: 380,
  minHeight: 220,
  keywords: ['text', 'notepad', 'code', 'write'],

  mount(ctx, win) {
    let path = win.data?.path || null;
    let dirty = false;

    const area = el('textarea', {
      class: 'editor-area', spellcheck: 'false', wrap: 'off',
      placeholder: 'Start typing…',
    });
    const status = el('div', { class: 'statusbar' });
    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn', onclick: () => ctx.launch('files', { data: { path: ctx.fs.home } }) }, 'Open…'),
      el('button', { class: 'btn primary', onclick: () => save() }, 'Save'),
      el('button', { class: 'btn ghost', onclick: () => saveAs() }, 'Save as…'),
      el('button', { class: 'btn ghost', onclick: () => openNew() }, 'New'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn ghost', title: 'Insert current date', 'aria-label': 'Insert the current date', onclick: () => { insert(new Date().toLocaleString()); } }, '📅'),
      el('button', { class: 'btn ghost', title: 'Word count', 'aria-label': 'Count words in this file', onclick: () => countWords() }, 'Σ'),
    );
    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, area, status));

    const setPath = (p) => {
      path = p;
      win.data = { path };
      win.setTitle(`${p ? basename(p) : 'Untitled'}${dirty ? ' •' : ''} — Text Editor`);
    };

    const renderStatus = () => {
      const value = area.value;
      const lines = value.split('\n').length;
      const info = path && ctx.fs.exists(path, '/') ? ctx.fs.stat(path, '/') : null;
      status.replaceChildren(
        el('span', { text: path ? ctx.fs.display(path) : 'unsaved document' }),
        el('span', { text: `${lines} lines` }),
        el('span', { text: `${value.length} chars` }),
        el('span', { text: info ? `saved ${fmtBytes(info.size)}` : '' }),
        el('span', { text: dirty ? '● unsaved changes' : '' }),
      );
    };

    const load = (p) => {
      try {
        area.value = ctx.fs.read(p, '/');
        area.readOnly = false;
        dirty = false;
        setPath(p);
        renderStatus();
      } catch (err) {
        ctx.toast('Cannot open file', err.message, 'err');
      }
    };

    const save = () => {
      if (!path) return saveAs();
      try {
        ctx.fs.write(path, area.value, '/');
        dirty = false;
        setPath(path);
        renderStatus();
        ctx.toast('Saved', ctx.fs.display(path), 'ok');
      } catch (err) {
        ctx.toast('Save failed', err.message, 'err');
      }
    };

    const saveAs = async () => {
      const suggested = path ? basename(path) : 'untitled.txt';
      const name = await ctx.prompt({
        title: 'Save as…',
        message: 'A path, or just a file name (saved under ~/Documents).',
        value: path ? ctx.fs.display(path) : `~/Documents/${suggested}`,
        placeholder: '~/Documents/untitled.txt',
      });
      if (!name) return;
      const abs = name.includes('/') ? ctx.fs.resolve(name, ctx.fs.home) : `${ctx.fs.home}/Documents/${name}`;
      try {
        ctx.fs.write(abs, area.value, '/');
        dirty = false;
        setPath(abs);
        renderStatus();
        ctx.toast('Saved', ctx.fs.display(abs), 'ok');
      } catch (err) { ctx.toast('Save failed', err.message, 'err'); }
    };

    const openNew = () => {
      area.value = '';
      dirty = false;
      setPath(null);
      renderStatus();
      area.focus();
    };

    const insert = (text) => {
      area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
      dirty = true;
      renderStatus();
      area.focus();
    };

    const countWords = () => {
      const words = area.value.trim().split(/\s+/).filter(Boolean).length;
      ctx.toast('Word count', `${words} words, ${area.value.length} characters`);
    };

    area.addEventListener('input', () => {
      dirty = true;
      win.setTitle(`${path ? basename(path) : 'Untitled'} • — Text Editor`);
      renderStatus();
    });

    area.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        insert('  ');
      }
    });

    const unsubscribe = ctx.bus.on('fs:change', ({ path: changed, reset }) => {
      if (!path) return;
      // Only react to *this* file (or a factory reset), never to files that merely share a prefix.
      if (!reset && changed !== path) return;
      try {
        area.value = ctx.fs.read(path, '/');
        dirty = false;
        setPath(path);
        renderStatus();
      } catch {
        // The file was deleted or reset away: keep the buffer, but say so.
        dirty = true;
        renderStatus();
        ctx.toast('File disappeared', `${ctx.fs.display(path)} was deleted; your text is still here`, 'err');
      }
    });

    // A user-initiated close (✕ or Alt+F4) asks first when there are unsaved changes.
    win.onCloseRequest = async () => {
      if (!dirty) return true;
      const name = path ? basename(path) : 'Untitled';
      return ctx.confirm({
        title: 'Close without saving?',
        message: `${name} has unsaved changes. Closing now throws them away.`,
        confirmLabel: 'Close without saving',
        cancelLabel: 'Keep editing',
        danger: true,
      });
    };

    if (path) load(path); else { openNew(); }
    claimFocus(win, area);

    return () => unsubscribe?.();
  },
};
