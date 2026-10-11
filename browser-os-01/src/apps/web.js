import { el } from '../core/utils.js';

const START = 'https://example.com/';

export default {
  id: 'web',
  name: 'Web Browser',
  icon: '🌐',
  width: 820,
  height: 560,
  minWidth: 360,
  minHeight: 260,
  keywords: ['browser', 'internet', 'url', 'iframe'],

  mount(ctx, win) {
    const start = win.data?.url || START;
    const address = el('input', { class: 'field', value: start, style: { flex: '1' }, spellcheck: 'false', 'aria-label': 'Address' });
    const frame = el('iframe', { class: 'web-main', src: start });
    const status = el('div', { class: 'statusbar' }, el('span', { text: 'Some sites refuse to be embedded — open them in a real tab if a page looks blank.' }));

    /* allow-scripts + allow-same-origin together let a same-origin frame drop its own
       sandbox, so only grant allow-same-origin to cross-origin pages. */
    const isSameOrigin = (url) => {
      try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
    };
    const applySandbox = (url) => {
      frame.sandbox = isSameOrigin(url)
        ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
        : 'allow-scripts allow-forms allow-popups allow-same-origin';
    };

    const go = () => {
      let url = address.value.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try { address.value = new URL(url).href; } catch { ctx.toast('Invalid URL', url, 'err'); return; }
      applySandbox(address.value);
      frame.src = address.value;
      win.data = { url: address.value };
      win.setTitle(`${new URL(address.value).hostname} — Web Browser`);
    };

    address.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn ghost', title: 'Reload', 'aria-label': 'Reload page', onclick: () => { frame.src = 'about:blank'; setTimeout(() => { frame.src = address.value; }, 60); } }, '↻'),
      address,
      el('button', { class: 'btn primary', onclick: go }, 'Go'),
      el('button', { class: 'btn ghost', title: 'Open in a real browser tab', onclick: () => window.open(address.value, '_blank') }, '⧉'),
    );

    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, frame, status));
    applySandbox(start);
  },
};
