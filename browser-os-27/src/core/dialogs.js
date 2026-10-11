import { el } from './utils.js';

/**
 * In-OS modal dialogs.
 *
 * Replaces window.confirm / window.prompt, which are unthemeable, block the UI thread and
 * cannot be styled to match the desktop. These are real DOM: they follow the current theme,
 * trap Tab inside the dialog, close on Escape, and hand focus back to whatever opened them.
 *
 * Every method returns a promise: confirm() resolves to boolean, prompt() to string|null.
 */
export class Dialogs {
  constructor(layer) {
    this.layer = layer;
    this.open = new Set();
  }

  confirm({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
    return this.#show({
      title,
      message,
      actions: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, value: true, primary: true, danger },
      ],
    });
  }

  prompt({ title, message = '', value = '', placeholder = '', confirmLabel = 'Save', cancelLabel = 'Cancel' } = {}) {
    return this.#show({
      title,
      message,
      input: { value, placeholder },
      actions: [
        { label: cancelLabel, value: null },
        { label: confirmLabel, value: 'input', primary: true },
      ],
    });
  }

  #show({ title, message, actions, input }) {
    const previous = document.activeElement;
    let settle = null;
    const result = new Promise((resolve) => { settle = resolve; });

    const field = input ? el('input', {
      class: 'field dlg-input', value: input.value ?? '', placeholder: input.placeholder ?? '',
      'aria-label': title, spellcheck: 'false',
    }) : null;

    const buttons = actions.map((action) => el('button', {
      class: `dlg-btn${action.primary ? ' primary' : ''}${action.danger ? ' danger' : ''}`,
      type: 'button', dataset: { value: String(action.value) },
      onclick: () => finish(action),
    }, action.label));

    const form = el('form', { class: 'dlg-form' },
      field,
      el('div', { class: 'dlg-actions' }, ...buttons),
    );

    const dialog = el('div', {
      class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1',
      dataset: actions.some((a) => a.danger) ? { danger: 'true' } : null,
      onkeydown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(actions[0]); return; }
        if (e.key === 'Tab') this.#trap(e, dialog);
      },
    },
      el('div', { class: 'dlg-title' },
        el('span', { class: 'dlg-icon', text: input ? '✎' : actions.at(-1).danger ? '⚠' : '❔' }),
        el('span', { text: title }),
      ),
      message ? el('div', { class: 'dlg-message', text: message }) : null,
      form,
    );

    const overlay = el('div', {
      class: 'dialog-layer',
      onpointerdown: (e) => { if (e.target === overlay) finish(actions[0]); },
    }, dialog);

    const finish = (action) => {
      if (done) return;
      done = true;
      document.removeEventListener('focusin', keepFocus);
      overlay.remove();
      this.open.delete(overlay);
      if (!this.open.size) this.layer.classList.add('hidden');
      if (previous && document.contains(previous)) previous.focus?.();
      settle(action.value === 'input' ? (field.value.trim() || null) : action.value);
    };
    let done = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(actions.find((a) => a.primary) || actions.at(-1));
    });

    this.layer.append(overlay);
    this.layer.classList.remove('hidden');
    this.open.add(overlay);

    const focusTarget = field || buttons.at(-1);
    /* A modal keeps its focus. Without this, an app that focuses something on a timer
       (the terminal focuses its prompt 30ms after opening) can quietly steal it back. */
    const keepFocus = (e) => {
      if (done || !document.isConnected) return;
      if (dialog.contains(e.target)) return;
      focusTarget.focus();
    };
    document.addEventListener('focusin', keepFocus);
    /* Focus synchronously, after the layer is visible. A deferred focus (setTimeout 0)
       races callers that act as soon as the dialog is visible — a keypress could land
       in whatever had focus before the dialog opened. */
    focusTarget.focus();
    if (field) field.select();

    return result;
  }

  #trap(e, dialog) {
    const items = [...dialog.querySelectorAll('input, button')].filter((n) => !n.disabled);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    e.preventDefault();
    const next = e.shiftKey
      ? items[(at - 1 + items.length) % items.length]
      : items[(at + 1) % items.length];
    next.focus();
  }
}
