import { el } from '../core/utils.js';

const START = 'https://example.com/';
const LOAD_TIMEOUT = 8000;

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
    const history = [win.data?.url || START];
    let at = 0;
    let loadTimer = null;

    const address = el('input', { class: 'field', value: history[0], style: { flex: '1' }, spellcheck: 'false', 'aria-label': 'Address' });
    const frame = el('iframe', { class: 'web-main', src: history[0], title: 'Web page' });
    const statusText = el('span', { text: '' });
    const status = el('div', { class: 'statusbar' }, statusText);
    const backBtn = el('button', { class: 'btn ghost', title: 'Back', 'aria-label': 'Back', onclick: () => navigate(-1) }, '←');
    const fwdBtn = el('button', { class: 'btn ghost', title: 'Forward', 'aria-label': 'Forward', onclick: () => navigate(1) }, '→');

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

    const setStatus = (kind) => {
      statusText.replaceChildren();
      if (kind === 'loading') {
        statusText.append(el('span', { class: 'web-loading', text: 'Loading…' }));
      } else if (kind === 'slow') {
        statusText.append(el('span', { class: 'web-loading', text: 'Still loading — this site may refuse to be embedded.' }));
        statusText.append(el('button', {
          class: 'linkbtn', type: 'button',
          onclick: () => window.open(history[at], '_blank'),
        }, 'Open in a real tab'));
      } else if (kind === 'blocked') {
        statusText.append(el('span', { text: 'This page refused to be embedded in a frame.' }));
        statusText.append(el('button', { class: 'linkbtn', type: 'button', onclick: () => window.open(history[at], '_blank') }, 'Open in a real tab'));
      } else {
        statusText.append(el('span', { text: history[at] }));
        statusText.append(el('span', { class: 'muted', text: isSameOrigin(history[at]) ? 'same origin — sandboxed without allow-same-origin' : 'cross-origin' }));
      }
      backBtn.disabled = at === 0;
      fwdBtn.disabled = at === history.length - 1;
    };

    const load = (url) => {
      clearTimeout(loadTimer);
      applySandbox(url);
      frame.src = url;
      win.data = { url };
      win.setTitle(`${hostname(url)} — Web Browser`);
      setStatus('loading');
      loadTimer = setTimeout(() => setStatus('slow'), LOAD_TIMEOUT);
    };

    const hostname = (url) => {
      try { return new URL(url).hostname; } catch { return url; }
    };

    const go = () => {
      let url = address.value.trim();
      if (!url) return;
      /* new URL() happily percent-encodes spaces ("https://not a url" becomes a host),
         so reject whitespace before normalising — a URL with spaces is a typo, not a site. */
      if (/\s/.test(url)) { ctx.toast('Invalid URL', 'URLs cannot contain spaces', 'err'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try { url = new URL(url).href; } catch { ctx.toast('Invalid URL', url, 'err'); return; }
      address.value = url;
      history.splice(at + 1, history.length - at - 1, url);
      at = history.length - 1;
      load(url);
    };

    const navigate = (dir) => {
      const next = at + dir;
      if (next < 0 || next >= history.length) return;
      at = next;
      address.value = history[at];
      load(history[at]);
    };

    frame.addEventListener('load', () => {
      clearTimeout(loadTimer);
      // The very first load event is the empty iframe; ignore it until a real page is set.
      setStatus('ready');
    });
    frame.addEventListener('error', () => { clearTimeout(loadTimer); setStatus('blocked'); });

    address.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });

    const toolbar = el('div', { class: 'toolbar' },
      backBtn, fwdBtn,
      el('button', { class: 'btn ghost', title: 'Reload', 'aria-label': 'Reload page', onclick: () => { frame.src = 'about:blank'; setTimeout(() => load(history[at]), 60); } }, '↻'),
      address,
      el('button', { class: 'btn primary', onclick: go }, 'Go'),
      el('button', { class: 'btn ghost', title: 'Open in a real browser tab', 'aria-label': 'Open in a real browser tab', onclick: () => window.open(history[at], '_blank') }, '⧉'),
    );

    win.body.replaceChildren(el('div', { class: 'app' }, toolbar, frame, status));
    setStatus('loading');
    loadTimer = setTimeout(() => setStatus('slow'), LOAD_TIMEOUT);

    return () => clearTimeout(loadTimer);
  },
};
