import { el, fmtBytes } from '../core/utils.js';

export default {
  id: 'settings',
  name: 'Settings',
  icon: '⚙️',
  width: 640,
  height: 560,
  minWidth: 360,
  minHeight: 300,
  keywords: ['preferences', 'theme', 'wallpaper', 'appearance'],

  mount(ctx, win) {
    const main = el('div', { class: 'settings-main' });
    win.body.replaceChildren(el('div', { class: 'app' }, main));

    const card = (title, hint, ...body) => el('div', { class: 'card' },
      el('h3', { text: title }),
      hint ? el('p', { text: hint }) : null,
      ...body,
    );

    /* appearance */
    const themeSeg = el('div', { class: 'seg' });
    for (const value of ['dark', 'light']) {
      themeSeg.append(el('button', {
        type: 'button', class: ctx.theme.settings.theme === value ? 'active' : '',
        onclick: (e) => {
          ctx.theme.set('theme', value);
          [...themeSeg.children].forEach((b) => b.classList.toggle('active', b === e.currentTarget));
        },
      }, value === 'dark' ? '🌙 Dark' : '☀️ Light'));
    }

    const accentRow = el('div', { class: 'row' });
    for (const accent of ctx.accents) {
      accentRow.append(el('button', {
        class: 'swatch', type: 'button', title: accent.label,
        style: { background: accent.css, outline: ctx.theme.settings.accent === accent.id ? '2px solid var(--text)' : 'none' },
        onclick: () => { ctx.theme.set('accent', accent.id); render(); },
      }));
    }

    const wpGrid = el('div', { class: 'row' });
    for (const wp of ctx.wallpapers) {
      wpGrid.append(el('button', {
        class: `wp-tile${ctx.theme.settings.wallpaper === wp.id && !ctx.theme.settings.customWallpaper ? ' active' : ''}`,
        type: 'button', title: wp.label, style: { background: wp.css },
        onclick: () => { ctx.theme.set('customWallpaper', null); ctx.theme.set('wallpaper', wp.id); render(); },
      }));
    }
    const wpFile = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });    wpFile.addEventListener('change', async () => {
      const file = wpFile.files?.[0];
      if (!file) return;
      const data = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
      });
      ctx.theme.set('customWallpaper', data);
      ctx.toast('Wallpaper updated', file.name, 'ok');
      render();
    });

    /* desktop */
    const desktopCard = () => {
      const hidden = ctx.theme.settings.icons === false;
      return card('Desktop', 'App shortcuts live on the desktop by default.',
        el('div', { class: 'row' }, el('button', {
          class: `btn ${hidden ? 'ghost' : 'primary'}`,
          type: 'button',
          'aria-pressed': String(!hidden),
          onclick: () => { ctx.theme.set('icons', hidden); render(); },
        }, hidden ? 'Desktop shortcuts: hidden' : 'Desktop shortcuts: shown')));
    };

    /* storage */
    const storageCard = () => {
      const bytes = ctx.store.usage();
      const counts = ctx.fs.counts();
      return card('Files & storage', 'The virtual filesystem lives in localStorage for this origin.',
        el('div', { class: 'kv' },
          el('span', { class: 'k', text: 'Stored size' }), el('span', { text: fmtBytes(bytes) }),
          el('span', { class: 'k', text: 'Files' }), el('span', { text: `${counts.files} files, ${fmtBytes(counts.bytes)} of content` }),
          el('span', { class: 'k', text: 'Persistence' }), el('span', { text: ctx.store.available ? 'localStorage' : 'in-memory (storage blocked)' }),
          el('span', { class: 'k', text: 'Failed writes' }), el('span', { text: ctx.store.failures ? `${ctx.store.failures}${ctx.store.lastError ? ` — ${ctx.store.lastError}` : ''}` : 'none' }),
        ),
        ctx.store.failures ? el('p', { class: 'muted', text: 'Some writes could not be saved. Open windows and new files will not survive a reload.' }) : null,
        el('div', { class: 'row', style: { marginTop: '12px' } },
          el('button', { class: 'btn', onclick: () => ctx.launch('files', { data: { path: ctx.fs.home } }) }, 'Open Files'),
          el('button', { class: 'btn', onclick: () => ctx.launch('terminal') }, 'Run df'),
          el('button', { class: 'btn danger', onclick: () => {
            if (!window.confirm('Reset the filesystem to its factory contents?')) return;
            ctx.fs.reset();
            ctx.toast('Filesystem reset', 'Factory files restored', 'ok');
            render();
          } }, 'Reset filesystem'),
        ),
      );
    };

    /* system */
    const systemCard = () => card('System', 'Everything here is plain ES modules — no build step, no bundler.',
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'Build' }), el('span', { text: `Browser OS ${ctx.version}` }),
        el('span', { class: 'k', text: 'Viewport' }), el('span', { text: `${window.innerWidth} × ${window.innerHeight}` }),
        el('span', { class: 'k', text: 'Open windows' }), el('span', { text: String(ctx.wm.windows.size) }),
        el('span', { class: 'k', text: 'Installed apps' }), el('span', { text: ctx.apps.map((a) => a.id).join(', ') }),
      ),
      el('div', { class: 'row', style: { marginTop: '12px' } },
        el('button', { class: 'btn', onclick: () => { for (const w of [...ctx.wm.windows.values()]) ctx.wm.close(w.id); } }, 'Close all windows'),
        el('button', { class: 'btn danger', onclick: () => {
          if (!window.confirm('Clear all Browser OS data and reload?')) return;
          ctx.store.clearAll();
          location.reload();
        } }, 'Factory reset'),
      ),
    );

    const shortcuts = card('Keyboard shortcuts', 'Handled by the shell.',
      el('div', { class: 'kv' },
        el('span', { class: 'k', text: 'Ctrl + Alt + T' }), el('span', { text: 'Open a terminal' }),
        el('span', { class: 'k', text: 'Ctrl + Alt + F' }), el('span', { text: 'Open Files' }),
        el('span', { class: 'k', text: 'Ctrl + Space' }), el('span', { text: 'Toggle the app menu' }),
        el('span', { class: 'k', text: 'Alt + F4' }), el('span', { text: 'Close the focused window' }),
        el('span', { class: 'k', text: 'Ctrl + S' }), el('span', { text: 'Save in the Text Editor' }),
        el('span', { class: 'k', text: 'Tab / ↑ ↓' }), el('span', { text: 'Completion and history in the terminal' }),
      ),
    );

    function render() {
      main.replaceChildren(
        card('Appearance', 'Theme, accent colour and wallpaper.',
          el('div', { class: 'row' }, themeSeg),
          el('div', { class: 'start-section', text: 'Accent' }),
          accentRow,
          el('div', { class: 'start-section', text: 'Wallpaper' }),
          wpGrid,
          el('div', { class: 'row', style: { marginTop: '10px' } },
            el('button', { class: 'btn', onclick: () => wpFile.click() }, 'Use your own image…'),
            ctx.theme.settings.customWallpaper ? el('button', { class: 'btn ghost', onclick: () => { ctx.theme.set('customWallpaper', null); render(); } }, 'Remove custom wallpaper') : null,
            wpFile,
          ),
        ),
        desktopCard(),
        storageCard(),
        systemCard(),
        shortcuts,
      );
    }

    render();
  },
};
