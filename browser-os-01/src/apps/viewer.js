import { el, fmtBytes, basename, isImage } from '../core/utils.js';

export default {
  id: 'viewer',
  name: 'Image Viewer',
  icon: '🖼️',
  width: 620,
  height: 480,
  minWidth: 300,
  minHeight: 220,
  keywords: ['image', 'photo', 'preview'],

  mount(ctx, win) {
    const path = win.data?.path;
    const main = el('div', { class: 'viewer-main' });
    const status = el('div', { class: 'statusbar' });
    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn', onclick: () => ctx.launch('files', { data: { path: ctx.fs.home } }) }, 'Browse…'),
      el('button', { class: 'btn', onclick: () => ctx.launch('editor', { data: { path } }) }, 'Open as text'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn ghost', onclick: () => { main.querySelector('img')?.remove(); main.append(el('div', { class: 'empty-state' }, 'No preview')); } }, 'Clear'),
    );
    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, main, status));

    if (!path) {
      main.append(el('div', { class: 'empty-state' }, 'Open an image from the Files app.'));
      status.textContent = 'no file';
      return;
    }

    win.setTitle(`${basename(path)} — Image Viewer`);

    let content = '';
    try { content = ctx.fs.read(path, '/'); } catch (err) {
      main.append(el('div', { class: 'empty-state' }, String(err.message)));
      return;
    }

    if (isImage(path) && content.startsWith('data:image')) {
      main.append(el('img', { src: content, alt: basename(path) }));
    } else if (isImage(path)) {
      main.append(el('div', { class: 'empty-state' }, 'This file has an image name but does not contain image data.'));
    } else {
      main.classList.add('viewer-text');
      main.textContent = content;
    }

    const info = ctx.fs.stat(path, '/');
    status.replaceChildren(
      el('span', { text: ctx.fs.display(path) }),
      el('span', { text: info.type === 'file' ? fmtBytes(info.size) : 'folder' }),
      el('span', { text: info.modified ? `modified ${info.modified.slice(0, 16).replace('T', ' ')}` : '' }),
    );
  },
};
