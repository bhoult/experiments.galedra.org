import { el } from '../core/utils.js';

export default {
  id: 'welcome',
  name: 'Welcome',
  icon: '👋',
  width: 600,
  height: 560,
  minWidth: 320,
  minHeight: 260,
  resizable: true,
  keywords: ['tour', 'help', 'start'],

  mount(ctx, win) {
    const launch = (id) => () => ctx.launch(id);
    const body = el('div', { class: 'welcome' },
      el('h1', { text: 'Welcome to Browser OS' }),
      el('div', { class: 'sub' }, 'A tiny desktop that lives entirely in this tab: windows, a virtual filesystem, a shell, and a handful of apps.'),
      el('ul', {},
        el('li', {}, el('b', { text: 'Windows' }), ' — drag a title bar to a screen edge or corner to snap (halves and quarters), grab the middle of the top edge to move a window and its corners to resize, double-click the title bar to maximise, or Tab to a title bar and use the arrow keys. Right-click a title bar for the same tiling as a menu.'),
        el('li', {}, el('b', { text: 'Terminal' }), ' — try ', el('code', { text: 'help' }), ', ', el('code', { text: 'ls -l' }), ', ', el('code', { text: 'neofetch' }), ', ', el('code', { text: 'ls | grep notes' }), ', ', el('code', { text: 'wc -l < notes.txt' }), ', ', el('code', { text: 'echo hi > note.txt' }), '.'),
        el('li', {}, el('b', { text: 'Files' }), ' — browse, create, rename, delete, upload or drag-and-drop files into the virtual filesystem.'),
        el('li', {}, el('b', { text: 'Editor & Paint' }), ' — ', el('code', { text: 'Ctrl+S' }), ' in the Editor saves straight back to the filesystem; ', el('code', { text: 'Ctrl+Z' }), ' and ', el('code', { text: 'Ctrl+Shift+Z' }), ' undo and redo in Paint.'),
        el('li', {}, el('b', { text: 'Right-click' }), ' the desktop for a context menu, and the Start menu has app search.'),
        el('li', {}, el('b', { text: 'Keys' }), ': ', el('code', { text: 'Ctrl+Alt+T' }), ' terminal · ', el('code', { text: 'Ctrl+Alt+F' }), ' files · ', el('code', { text: 'Ctrl+Space' }), ' menu · ', el('code', { text: 'Alt+F4' }), ' close · ', el('code', { text: 'Alt+Arrow' }), ' snap · ', el('code', { text: 'Alt+Shift+Arrow' }), ' snap to a quarter · ', el('code', { text: 'Ctrl+R' }), ' in the terminal finds a command you already ran.'),
      ),
      el('p', { class: 'muted' }, 'Everything you create is saved to localStorage, so it survives a reload — including your open windows.'),
      el('div', { class: 'cta' },
        el('button', { class: 'btn primary', onclick: launch('terminal') }, 'Open Terminal'),
        el('button', { class: 'btn', onclick: launch('files') }, 'Open Files'),
        el('button', { class: 'btn', onclick: launch('paint') }, 'Open Paint'),
        el('button', { class: 'btn ghost', onclick: launch('settings') }, 'Settings'),
      ),
    );
    win.body.replaceChildren(el('div', { class: 'app' }, body));
  },
};
