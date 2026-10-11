import { el, fmtBytes, iconFor, parentPath } from '../core/utils.js';

const PLACES = [
  { label: 'Home', path: '/home/user', icon: '🏠' },
  { label: 'Desktop', path: '/home/user/Desktop', icon: '🖥️' },
  { label: 'Documents', path: '/home/user/Documents', icon: '📄' },
  { label: 'Pictures', path: '/home/user/Pictures', icon: '🖼️' },
  { label: 'Downloads', path: '/home/user/Downloads', icon: '⬇️' },
  { label: 'System (/)', path: '/', icon: '🗄️' },
];

export default {
  id: 'files',
  name: 'Files',
  icon: '🗂️',
  width: 760,
  height: 500,
  minWidth: 420,
  minHeight: 260,
  keywords: ['file', 'manager', 'explorer', 'folder'],

  mount(ctx, win) {
    let cwd = win.data?.path || ctx.fs.home;
    const back = [];
    let selected = null;
    let currentEntries = [];

    const side = el('nav', { class: 'files-side' });
    const crumbs = el('div', { class: 'crumbs' });
    const grid = el('div', { class: 'filegrid' });
    const status = el('div', { class: 'statusbar' });
    const upload = el('input', { type: 'file', class: 'hidden', multiple: '' });

    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn ghost', title: 'Back', onclick: () => { const p = back.pop(); if (p) go(p, false); } }, '←'),
      el('button', { class: 'btn ghost', title: 'Parent folder', onclick: () => go(parentPath(cwd)) }, '↑'),
      crumbs,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: () => create('dir') }, '+ Folder'),
      el('button', { class: 'btn', onclick: () => create('file') }, '+ File'),
      el('button', { class: 'btn', onclick: () => upload.click() }, 'Upload'),
    );

    win.body.replaceChildren(el('div', { class: 'app files' }, side, el('div', { class: 'files-main' }, toolbar, grid, status), upload));

    const renderSidebar = () => {
      side.replaceChildren(
        el('div', { class: 'start-section' }, 'Places'),
        ...PLACES.map((place) => el('button', {
          class: `side-item${place.path === cwd ? ' active' : ''}`, type: 'button',
          onclick: () => go(place.path),
        }, el('span', { text: place.icon }), el('span', { text: place.label }))),
      );
    };

    const renderCrumbs = () => {
      const parts = cwd.split('/').filter(Boolean);
      const nodes = [el('button', { type: 'button', onclick: () => go('/') }, 'root')];
      let acc = '';
      for (const part of parts) {
        acc += `/${part}`;
        const target = acc;
        nodes.push(el('span', { class: 'muted', text: '/' }));
        nodes.push(el('button', { type: 'button', onclick: () => go(target) }, part));
      }
      crumbs.replaceChildren(...nodes);
    };

    const render = () => {
      let entries = [];
      try { entries = ctx.fs.list(cwd); } catch (err) { ctx.toast('Folder missing', err.message, 'err'); cwd = ctx.fs.home; entries = ctx.fs.list(cwd); }
      currentEntries = entries;
      selected = null;
      grid.replaceChildren(...entries.map((entry) => el('button', {
        class: 'filecell', type: 'button',
        dataset: { path: entry.path, name: entry.name, kind: entry.type },
        title: `${entry.name}\n${entry.type === 'dir' ? `folder · ${entry.children} items` : fmtBytes(entry.size)}`,
        onclick: (e) => {
          selected?.classList.remove('selected');
          selected = e.currentTarget;
          selected.classList.add('selected');
          renderStatus(entries);
        },
        ondblclick: () => (entry.type === 'dir' ? go(entry.path) : ctx.openPath(entry.path)),
        oncontextmenu: (e) => { e.preventDefault(); entryMenu(e, entry); },
      },
        el('span', { class: 'glyph', text: iconFor(entry.name, entry.type) }),
        el('span', { class: 'name', text: entry.name }),
        el('span', { class: 'meta', text: entry.type === 'dir' ? `${entry.children} item${entry.children === 1 ? '' : 's'}` : fmtBytes(entry.size) }),
      )));
      if (!entries.length) grid.append(el('div', { class: 'empty-state' }, 'This folder is empty. Use the buttons above to add something.'));
      renderCrumbs();
      renderSidebar();
      renderStatus(entries);
      win.setTitle(`Files — ${ctx.fs.display(cwd)}`);
      win.data = { path: cwd };
    };

    const renderStatus = (entries) => {
      const dirs = entries.filter((e) => e.type === 'dir').length;
      const files = entries.length - dirs;
      const bytes = entries.reduce((sum, e) => sum + e.size, 0);
      status.replaceChildren(
        el('span', { text: `${dirs} folders, ${files} files` }),
        el('span', { text: fmtBytes(bytes) }),
        el('span', { text: selected ? `selected: ${selected.dataset.name}` : '' }),
        el('span', { class: 'muted', text: 'Enter opens · F2 renames · Delete removes' }),
      );
    };

    const go = (path, pushHistory = true) => {
      const abs = ctx.fs.resolve(path, cwd);
      if (pushHistory && abs !== cwd) back.push(cwd);
      cwd = abs;
      render();
    };

    const create = (kind) => {
      const base = kind === 'dir' ? 'new folder' : 'untitled.txt';
      const name = ctx.fs.uniqueName(cwd, base);
      try {
        const abs = `${cwd}/${name}`;
        if (kind === 'dir') ctx.fs.mkdir(abs, '/'); else ctx.fs.write(abs, '', '/');
        render();
        ctx.toast('Created', name, 'ok');
      } catch (err) { ctx.toast('Create failed', err.message, 'err'); }
    };

    const remove = (entry) => {
      if (!window.confirm(`Delete ${entry.name}?`)) return;
      try {
        ctx.fs.rm(entry.path, '/', true);
        render();
        ctx.toast('Deleted', entry.name, 'ok');
      } catch (err) { ctx.toast('Delete failed', err.message, 'err'); }
    };

    const rename = (entry) => {
      const name = window.prompt('New name', entry.name);
      if (!name || name === entry.name) return;
      try {
        ctx.fs.mv(entry.path, `${cwd}/${name}`, '/');
        render();
        ctx.toast('Renamed', `${entry.name} → ${name}`, 'ok');
      } catch (err) { ctx.toast('Rename failed', err.message, 'err'); }
    };

    const entryMenu = (e, entry) => {
      const abs = entry.path;
      ctx.shell.openContextMenu(e.clientX, e.clientY, [
        { label: entry.type === 'dir' ? 'Open folder' : 'Open', glyph: iconFor(entry.name, entry.type), run: () => (entry.type === 'dir' ? go(abs) : ctx.openPath(abs)) },
        { label: 'Rename', glyph: '✎', run: () => rename(entry) },
        { label: 'Copy to clipboard', glyph: '⧉', run: () => { ctx.shell.clipboard = { path: abs, mode: 'copy' }; ctx.toast('Copied', entry.name); } },
        { label: 'Paste clipboard here', glyph: '📋', disabled: !ctx.shell.clipboard, run: () => { ctx.shell.paste(cwd); render(); } },
        { sep: true },
        { label: 'Delete', glyph: '🗑', run: () => remove(entry) },
      ]);
    };

    /* Keyboard: the grid is a column of real buttons, so Tab reaches them. */
    const onGridKeys = (e) => {
      const cell = e.target.closest?.('.filecell');
      if (!cell) return;
      const entry = currentEntries.find((x) => x.path === cell.dataset.path) || { path: cell.dataset.path, name: cell.dataset.name, type: cell.dataset.kind };
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        entry.type === 'dir' ? go(entry.path) : ctx.openPath(entry.path);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(entry);
      } else if (e.key === 'F2') {
        e.preventDefault();
        rename(entry);
      }
    };
    grid.addEventListener('keydown', onGridKeys);

    upload.addEventListener('change', async () => {
      const files = [...upload.files || []];
      for (const file of files) {
        const name = ctx.fs.uniqueName(cwd, file.name);
        const isImg = file.type.startsWith('image/');
        const content = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        });
        ctx.fs.write(`${cwd}/${name}`, isImg ? content : decodeDataUrl(content), '/');
      }
      if (files.length) ctx.toast('Uploaded', `${files.length} file(s) into ${ctx.fs.display(cwd)}`, 'ok');
      upload.value = '';
    });

    const decodeDataUrl = (dataUrl) => {
      const comma = dataUrl.indexOf(',');
      const meta = dataUrl.slice(0, comma);
      const body = dataUrl.slice(comma + 1);
      if (meta.includes(';base64')) {
        try { return decodeURIComponent(escape(atob(body))); } catch { return body; }
      }
      return decodeURIComponent(body);
    };

    win.body.addEventListener('dragover', (e) => { e.preventDefault(); });
    win.body.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      for (const file of files) {
        const name = ctx.fs.uniqueName(cwd, file.name);
        const reader = new FileReader();
        reader.onload = () => {
          const isImg = file.type.startsWith('image/');
          const result = String(reader.result);
          ctx.fs.write(`${cwd}/${name}`, isImg ? result : decodeDataUrl(result), '/');
        };
        reader.readAsDataURL(file);
      }
      ctx.toast('Dropped', `${files.length} file(s) into ${ctx.fs.display(cwd)}`, 'ok');
    });

    const off = ctx.bus.on('fs:change', () => render());
    render();

    return () => {
      off?.();
      grid.removeEventListener('keydown', onGridKeys);
    };
  },
};
