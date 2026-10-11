// Small DOM + formatting helpers shared across the OS.

/** Single source of truth for the version string shown in the shell, Settings and neofetch. */
export const VERSION = '0.1';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : String(c));
  }
  return node;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function debounce(fn, ms = 250) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

export function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
export const isImage = (name) => IMAGE_EXT.has(extOf(name));
export const isText = (name) => !isImage(name);

export function iconFor(name, type) {
  if (type === 'dir') return '📁';
  if (isImage(name)) return '🖼️';
  const e = extOf(name);
  if (['js', 'mjs', 'ts'].includes(e)) return '📜';
  if (['json'].includes(e)) return '🧾';
  if (['md'].includes(e)) return '📘';
  if (['txt', 'conf', 'cfg', 'log'].includes(e)) return '📄';
  if (['html', 'css'].includes(e)) return '🌐';
  return '📄';
}

export function basename(path) {
  const p = path.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

export function parentPath(path) {
  const p = path.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function titleCase(s) {
  return String(s).replace(/[-_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
