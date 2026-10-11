import assert from 'node:assert/strict';
import { INTERACTIVE_SELECTOR } from '../src/core/utils.js';

/**
 * Small accessibility audit for the browser test suite.
 *
 * The project tests with `node:test`, not a browser test runner, so there is no built-in
 * "expect this control to have a name". These helpers run a deliberately simple audit in
 * the page and turn the result into ordinary assertions: every *visible* interactive
 * control must have an accessible name, and every window must be a labelled dialog.
 *
 * The name computation is the accessible-name-by-spec shortcut browsers actually use for
 * this markup: aria-label → aria-labelledby → text content → title/placeholder/alt.
 */

function auditInPage({ roots, selector }) {
  /* Self-contained: Playwright serialises this function into the page, so it may not
     close over anything from this module — the control list is passed in, and it is the
     very same `INTERACTIVE_SELECTOR` the window manager's Tab ring walks (utils.js).
     The list is shared; what each caller skips is its own business: the focus ring skips
     disabled and unrendered controls, this audit names them, because a disabled button
     still needs a name. */
  const nameOf = (n) => {
    const label = n.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    const by = n.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ').trim();
      if (t) return t;
    }
    const text = (n.textContent || '').trim();
    if (text) return text;
    for (const attr of ['title', 'placeholder', 'alt']) {
      const v = n.getAttribute(attr);
      if (v && v.trim()) return v.trim();
    }
    return '';
  };

  const describe = (n) => {
    const cls = String(n.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const id = n.id ? `#${n.id}` : '';
    return `<${n.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}> ${n.outerHTML.slice(0, 140).replace(/\s+/g, ' ')}`;
  };

  const seen = new Set();
  const problems = [];
  for (const root of roots) {
    const scope = document.querySelector(root);
    if (!scope) { problems.push({ kind: 'missing-root', root }); continue; }
    for (const node of scope.querySelectorAll(selector)) {
      if (seen.has(node)) continue;
      seen.add(node);
      if (node.getAttribute('aria-hidden') === 'true') continue;
      const r = node.getBoundingClientRect();
      // Not rendered (display:none, a closed window, a hidden file input): nothing to name.
      if (r.width === 0 || r.height === 0) continue;
      if (!nameOf(node)) problems.push({ kind: 'unnamed-control', where: root, node: describe(node) });
    }
  }
  return problems;
}

/** Audit the given selectors in the live page. Returns a list of problems. */
export async function auditControls(page, roots) {
  return page.evaluate(auditInPage, {
    roots: Array.isArray(roots) ? roots : [roots],
    selector: INTERACTIVE_SELECTOR,
  });
}

export function assertNoUnnamedControls(problems, where) {
  const unnamed = problems.filter((p) => p.kind === 'unnamed-control');
  assert.deepEqual(
    unnamed,
    [],
    `${where}: ${unnamed.length} visible control(s) without an accessible name:\n  ${unnamed.map((p) => p.node).join('\n  ')}`,
  );
}

/** Every window must be an aria-labelled dialog whose name matches its title bar. */
export async function assertWindowsAreLabelled(page) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const w of document.querySelectorAll('.window')) {
      const title = (w.querySelector('.wtitle')?.textContent || '').trim();
      const node = w.querySelector('[data-win-id]') || w;
      if (node.getAttribute('role') !== 'dialog') out.push(`${w.dataset.app}: role is "${node.getAttribute('role')}"`);
      if (node.getAttribute('aria-label') !== title) {
        out.push(`${w.dataset.app}: aria-label "${node.getAttribute('aria-label')}" does not match the title "${title}"`);
      }
      const bar = w.querySelector('.titlebar');
      if (!bar || !bar.getAttribute('aria-label')) out.push(`${w.dataset.app}: title bar has no instructions for screen readers`);
    }
    return out;
  });
  assert.deepEqual(bad, [], 'windows should be labelled dialogs');
}
