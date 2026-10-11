import { el } from '../core/utils.js';

const SAFE = /^[0-9+\-*/(). %]+$/;

export default {
  id: 'calc',
  name: 'Calculator',
  icon: '🧮',
  width: 340,
  height: 460,
  minWidth: 280,
  minHeight: 380,
  resizable: false,
  keywords: ['math', 'arithmetic'],

  mount(ctx, win) {
    let expr = '';
    const exprEl = el('div', { class: 'expr' });
    const valEl = el('div', { class: 'val', text: '0' });
    const display = el('div', { class: 'calc-display' }, exprEl, valEl);
    const pad = el('div', { class: 'calc-pad' });

    const render = () => {
      exprEl.textContent = expr || '\u00a0';
      valEl.textContent = expr ? evaluate(expr).display : '0';
    };

    const press = (key) => {
      if (key === 'clear') { expr = ''; render(); return; }
      if (key === 'back') { expr = expr.slice(0, -1); render(); return; }
      if (key === 'neg') { expr = expr.startsWith('-') ? expr.slice(1) : `-${expr}`; render(); return; }
      if (key === '=') {
        const { display: value, error } = evaluate(expr);
        expr = error ? '' : String(value);
        render();
        if (error) ctx.toast('Bad expression', error, 'err');
        return;
      }
      if (!SAFE.test(expr + key)) return;
      expr += key;
      render();
    };

    const keys = [
      ['clear', 'C', 'op'], ['back', '⌫', 'op'], ['%', '%', 'op'], ['/', '÷', 'op'],
      ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'op'],
      ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'op'],
      ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
      ['neg', '±', 'op'], ['0', '0'], ['.', '.'], ['=', '=', 'eq'],
    ];

    for (const [key, label, cls] of keys) {
      pad.append(el('button', { class: `calc-key ${cls || ''}`.trim(), type: 'button', onclick: () => press(key) }, label));
    }

    win.body.replaceChildren(el('div', { class: 'app' }, el('div', { class: 'calc' }, display, pad)));

    const onKey = (e) => {
      if (e.target.closest('.window') !== win.el) return;
      const k = e.key;
      if (/^[0-9.+\-*/%()]$/.test(k)) { press(k); e.preventDefault(); }
      else if (k === 'Enter' || k === '=') { press('='); e.preventDefault(); }
      else if (k === 'Backspace') { press('back'); e.preventDefault(); }
      else if (k === 'Escape') { press('clear'); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  },
};

function evaluate(raw) {
  const expr = String(raw)
    .replace(/÷/g, '/').replace(/×/g, '*')
    .replace(/\s+/g, '')
    .replace(/%(?=\+|-|\*|\/|\)|$)/g, '/100');
  if (!expr) return { display: '0', error: null };
  if (!SAFE.test(expr)) return { display: 'invalid', error: 'only numbers and + - * / ( ) % are supported' };
  try {
    const value = Function(`"use strict"; return (${expr});`)();
    if (typeof value !== 'number' || !Number.isFinite(value)) return { display: 'error', error: 'not a finite number' };
    const rounded = Math.round(value * 1e10) / 1e10;
    return { display: String(rounded), error: null };
  } catch (err) {
    return { display: 'invalid', error: String(err.message || err) };
  }
}
