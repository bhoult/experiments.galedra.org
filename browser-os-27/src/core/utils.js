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

/**
 * What counts as an interactive control.
 *
 * Two things need to agree on this list: the window manager's Tab focus ring (which
 * controls can be tabbed to inside a window) and the accessibility audit in `tests/a11y.mjs`
 * (which controls must have an accessible name). Written twice they drift — a control the
 * focus ring can reach but the audit never checks is an unnamed button nobody notices.
 * One list, imported by both.
 *
 * Deliberately *not* filtered here: the focus ring wants only controls it can actually
 * focus (see `isUsableControl`), while the audit must also name the disabled and hidden
 * ones. The list is shared; each caller decides what to skip.
 */
export const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[role="slider"]',
].join(', ');

/** A control this page can actually be tabbed to: rendered, not hidden, not disabled. */
export function isUsableControl(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.getAttribute('aria-hidden')) return false;
  if (node.closest('[hidden]')) return false;
  try { if (node.matches(':disabled')) return false; } catch { /* not a disableable element */ }
  return node.getClientRects().length > 0;
}

/** Every interactive control inside `root` that a keyboard user can reach. */
export function reachableControls(root) {
  return [...root.querySelectorAll(INTERACTIVE_SELECTOR)].filter(isUsableControl);
}

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

/** Split a file name so the part that says *what kind of file it is* survives truncation.
 *
 *  CSS ellipsis cuts the end of a name, and for a file the end is the extension: a long
 *  `2024-06-30-team-retrospective-notes-final.tar.gz` renders as
 *  `2024-06-30-team-retrospective-n…`, which is a name with its meaning cut off — the one
 *  piece of it that was not arbitrary. Splitting the extension out lets the layout ellipsise
 *  the beginning and keep the tail, with a *single* truncation mechanism (the ellipsis still
 *  does the cutting; this only decides which half it is allowed to cut).
 *
 *  Returns `{ head, tail }`. `tail` is empty — i.e. nothing changes, plain end-ellipsis —
 *  when there is no extension, when the name is short enough that nothing will be cut, or
 *  when the "extension" is really the whole name (`.gitignore`) or something too long to be
 *  worth protecting. Compound extensions are kept whole: `.tar.gz` cut to `.gz` protects the
 *  wrong half. */
export function splitExtension(name = '') {
  let at = name.lastIndexOf('.');
  if (at <= 0) return { head: name, tail: '' };
  /* Walk back over further extension-looking components, so `archive.tar.zst` keeps
     `.tar.zst` rather than `.zst`. A component stops the walk when it does not look like an
     extension — that is what keeps `Makefile.build.target.thing.that.is.long` from being
     treated as one enormous suffix. */
  for (let prev = name.lastIndexOf('.', at - 1); prev > 0; prev = name.lastIndexOf('.', prev - 1)) {
    const part = name.slice(prev + 1, at);
    if (part.length > 12 || !/^[A-Za-z0-9]+$/.test(part)) break;
    at = prev;
  }
  const tail = name.slice(at);
  if (tail.length > 16 || name.length < 24) return { head: name, tail: '' };
  return { head: name.slice(0, at), tail };
}

/**
 * The same head/tail split, for a name that has no extension: a folder, or an extension-less
 * file.
 *
 * The problem is identical — a CSS ellipsis eats the end of a name, and a layout that cuts
 * only the end says nothing about the name except how it began. Folders are cut in Files'
 * breadcrumb (`.crumb-last`, the one crumb a narrow window shortens instead of hiding) and
 * the dead-end crumb for a folder that is not there; a long name there costs the bar room and
 * the user the end of the word.
 *
 * What counts as a tail worth protecting is the question, and the answer is the same shape as
 * for an extension: a **trailing component** — the piece after the last `-`, `_` or `.` —
 * short enough to be a single marker (`final`, `draft3`, `old`) and long enough to be a word
 * rather than a fragment (`06-30`, `3`). The search goes from the end inward and takes the
 * *shortest* such tail.
 *
 * The tail's 8-character ceiling is a measured number, not a taste. The collapsed breadcrumb
 * box is 12ch = 82px of box = 70px of text (`tests/measure-crumb.mjs`), and the widest
 * 8-character tail measured there is 56px, leaving the head 12px. A 13-character tail like
 * `retrospective` measured 74px and left the head at **zero** — the beginning, the one part of
 * a name people recognise, gone. A tail is only worth protecting when it fits *alongside* a
 * beginning. Long trailing words are not markers, they are the middle of the name — end-ellipsis
 * is the right answer for them.
 *
 * Deliberately not split: short names (nothing would have been cut), names whose tail is a
 * numeric fragment, and names with no delimiter at all — `extraordinarilylongfoldername…` has
 * no structure to respect, and end-ellipsis is the right answer for it.
 */
export function splitName(name = '') {
  const viaExt = splitExtension(name);
  if (viaExt.tail) return viaExt;
  if (name.length < 20) return { head: name, tail: '' };
  for (let at = name.length - 1; at > 0; at--) {
    if (!/[-_.]/.test(name[at])) continue;
    /* The delimiter belongs to the tail, exactly as it does for an extension (`.tar.gz`, not
       `tar.gz`): the split must be lossless, and a tail that starts with a bare word reads as
       a different word from the one in the name. */
    const part = name.slice(at + 1);
    /* The head keeps its own identity: `a-bcd` is one name, not a prefix and a suffix. */
    if (at < 6) break;
    if (part.length < 3 || part.length > 8) continue;
    if (!/^[A-Za-z0-9]+$/.test(part)) continue;
    return { head: name.slice(0, at), tail: name.slice(at) };
  }
  return { head: name, tail: '' };
}

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

export function titleCase(s) {
  return String(s).replace(/[-_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The name a control would be listed under — in an overflow menu, or anywhere a control
 * has to be named without being shown. Same order of preference as an accessible name:
 * the control's own label first, then the words it displays, and only last its tooltip,
 * which is a hint ("up to 1.0 MB each") rather than a name.
 */
export function controlName(node) {
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
  const aria = node.getAttribute('aria-label');
  if (aria) return flat(aria);
  const text = [...node.childNodes]
    .filter((n) => !(n.nodeType === 1 && n.matches('.btn-glyph, .glyph, .kbd')))
    .map((n) => n.textContent)
    .join(' ');
  if (flat(text).length > 1) return flat(text);
  const title = node.getAttribute('title');
  if (title) return flat(title);
  if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return `${node.getAttribute('type') || 'text'} field`;
  return 'control';
}

/**
 * The shortest prefix of a list that is enough.
 *
 * `fitsAt(k)` is a question about the real world ("does the bar fit if I hide the first k
 * things?"), and the search below is only *valid* when that world is monotone — hiding more
 * never makes the bar wider. That is true of a bar made of fixed-width controls, and it is
 * a lie for a bar containing a control that grows when its neighbour disappears (a flexible
 * slider, say) or a fold marker that costs more than the thing it replaces.
 *
 * So the answer is verified rather than trusted:
 *  - cuts that turn out not to have been needed are taken back (a walk back over the tail),
 *  - if the predicate was *seen* to be non-monotone, or the answer does not actually fit,
 *    the shorter prefixes are scanned for one that does.
 * A monotone bar pays for that verification with one extra probe; a non-monotone bar pays
 * with a scan, which is the price of being correct about something unusual. One thing is
 * deliberately not chased: a prefix that fits, followed by prefixes that do not, is invisible
 * to any search that never probes it — finding it costs a linear scan, which is exactly what
 * a monotone bar must not be made to pay.
 *
 * It returns `{ cuts, fits }`, not just a number. `cuts` is the shortest prefix to give up
 * (0 when nothing needs to be given up, `total` when even giving up everything is not
 * enough) and `fits` says whether that answer *actually fits*. The second half matters: a
 * caller that reports "the bar gave up 7 things" without saying "and it still does not fit"
 * is describing a ladder it walked, not a layout that worked, and the two read the same.
 * Reporting `fits` costs no probe — the search already measured that point.
 */
export function shortestFit(total, fitsAt) {
  const probe0 = () => Boolean(fitsAt(0));
  if (total <= 0) return { cuts: 0, fits: probe0() };
  /* Probes are cached: verifying an answer must not re-measure a layout the search already
     measured, and a walk back over the tail re-asks questions the binary search asked. */
  const seen = new Map();
  const fits = (k) => {
    if (!seen.has(k)) seen.set(k, Boolean(fitsAt(k)));
    return seen.get(k);
  };

  if (fits(0)) return { cuts: 0, fits: true };

  let k = total;
  if (fits(total)) {
    let lo = 1;
    let hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) hi = mid;
      else lo = mid + 1;
    }
    k = lo;
  }

  /* Take back whatever the bar did not need. Under monotonicity this costs exactly one
     probe (the answer's predecessor does not fit) and stops. */
  while (k > 0 && fits(k - 1)) k--;

  /* The two ways the search can have been wrong: an answer that does not fit at all, and an
     answer past a smaller one that did. Both need the assumption to have been violated, so
     they are only paid for when it was. */
  if (!fits(k) || sawNonMonotone(seen)) {
    for (let i = 1; i < k; i++) {
      if (fits(i)) { k = i; break; }
    }
  }
  return { cuts: k, fits: fits(k) };
}

/** True when the measured points disprove "hiding more never makes it wider". */
function sawNonMonotone(seen) {
  const points = [...seen.keys()].sort((a, b) => a - b);
  for (const later of points) {
    if (seen.get(later)) continue;
    for (const earlier of points) {
      if (earlier >= later) break;
      if (seen.get(earlier)) return true;
    }
  }
  return false;
}

/** How long a collapse ladder may be walked rung-by-rung to report what each rung bought.
 *  See `fit()`: this only happens for a bar that has run out of things to give up, so the
 *  cost is paid by the pathological bar, never by the ordinary one — and it is paid once per
 *  *content*, not once per resize (see the walk cache in `fit()`).
 *
 *  48 is a measured number, not a guess. The longest ladder this project can build today is
 *  a Files window 18 folders deep (`node tests/probe.mjs <deep path> 360` → 25 rungs), and
 *  walking it costs ~1ms of forced layout, once per content (`data-collapsed-effective-walk-ms`
 *  is what it actually cost). The limit is no longer protecting the ordinary resize — the
 *  cache does that — it is protecting against a bar that declares a ladder hundreds long, and
 *  48 is comfortably past any path a user can type into this filesystem while still being a
 *  cost you can see in one frame. A bar that declares more gets
 *  `data-collapsed-effective="unmeasured"` rather than a number that was never measured. */
const EFFECTIVE_SCAN_LIMIT = 48;

/**
 * Mark which side of a scrollable toolbar is actually cut off, so CSS can show a fade
 * there. Scrolling a toolbar is honest; silently clipping buttons is not — but a fade
 * that lies about *where* the cut is would be worse.
 *
 * Give it an `openMenu(x, y, items)` and it also guarantees *reachability*: whatever the
 * bar cannot show gets a `⋯` button pinned to its right edge that lists those controls,
 * and choosing one scrolls it into view and activates it. Compacting is the app's choice;
 * being able to reach every action is the core's promise.
 *
 * The watcher writes `data-fit-passes` — how many times it has re-measured this bar.
 * Collapsing a group that lives outside the bar (`data-collapse-scope`) changes the bar's
 * own width, which asks the watcher to measure it again; that is a loop that is supposed to
 * converge, and without a counter in the DOM there is no way to tell a converging loop from
 * a running one.
 */
export function watchToolbarOverflow(toolbar, { openMenu } = {}) {
  let more = null;
  let passes = 0;
  /* How many times this bar's ladder has actually been walked rung by rung, and the content
     the last walk measured. `data-collapsed-effective-walks` is the only way to see that the
     bound in `fit()` held; without it "we only walk when we have to" is an assertion. */
  let walks = 0;
  let walkCache = null;

  /* Controls the bar is currently hiding off its edges, and which edge. The side matters:
     a menu that lists "Upload" without saying it is off to the right leaves you scrolling
     in the wrong half of the bar to check. */
  const offscreenControls = () => {
    const box = toolbar.getBoundingClientRect();
    return reachableControls(toolbar)
      .filter((c) => c !== more)
      .map((c) => {
        const r = c.getBoundingClientRect();
        if (!r.width) return null;
        if (r.left < box.left - 1) return { control: c, side: 'left' };
        if (r.right > box.right + 1) return { control: c, side: 'right' };
        return null;
      })
      .filter(Boolean);
  };

  const openOverflow = () => {
    const hidden = offscreenControls();
    if (!hidden.length) return;
    const at = more.getBoundingClientRect();
    openMenu(at.left, at.bottom + 4, hidden.map(({ control: c, side }) => ({
      label: controlName(c),
      glyph: c.querySelector('.btn-glyph, .glyph')?.textContent?.trim() || '',
      hint: side === 'left' ? 'off the left ←' : '→ off the right',
      run: () => {
        c.scrollIntoView({ inline: 'center', block: 'nearest' });
        if (c.isContentEditable || c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') c.focus();
        else c.click();
      },
    })));
  };

  const ensureMore = () => {
    if (more || !openMenu) return more;
    more = el('button', {
      class: 'toolbar-more', type: 'button', hidden: true,
      'aria-label': 'More toolbar actions', title: 'Actions this window is too narrow to show',
      onclick: openOverflow,
    }, '⋯');
    toolbar.append(more);
    return more;
  };

  /* An app may mark low-priority groups of its toolbar (`data-collapse=".a, .b"`, in the
     order they may disappear). When the bar genuinely cannot fit everything, those groups
     are hidden one at a time — in the order the app chose — until the primary actions are
     reachable without scrolling. Hiding a group is honest only if the bar is really too
     narrow, so this is measured, never guessed from a breakpoint.

     A group may also declare `data-collapse-units=".x"`: pieces inside it that can be
     given up one at a time before the group goes. "Hide the breadcrumb" is a blunt
     instrument when hiding one more path segment would have been enough. Say
     `data-collapse-units-from="end"` when the pieces at the *other* end are the ones to
     drop — a colour palette keeps the colours it lists first; a path trail gives up the
     segments nearest its root.

     What the bar gives up is always a *prefix* of that declared order and never more of it
     than it needs: the watcher searches for the shortest prefix the bar actually requires,
     so nothing is ever hidden for nothing, and a group is only given up when every piece
     the app offered before it has already gone.

     A group does not have to live *in* the bar. `data-collapse-scope` names an ancestor
     the selectors are resolved against, which is how an app gives up room it is being
     *given* rather than room it is showing: Files' Places labels sit in a sidebar whose
     width is the toolbar's, so hiding them is one of the widths the bar can buy — and it
     is a decision the bar makes by measurement instead of an independent breakpoint the
     app keeps in step by hand. Two independent thresholds for one layout is how a wider
     window ends up showing *less* than a narrower one. */
  const unitsOf = (group) => {
    const sel = group.dataset.collapseUnits;
    if (!sel) return [];
    const units = [...group.querySelectorAll(sel)];
    return group.dataset.collapseUnitsFrom === 'end' ? units.reverse() : units;
  };

  const fit = () => {
    /* Measured with the overflow button hidden, every time: if its own width changed what
       fits, the collapse level would depend on whether the button was showing, and the
       two states would chase each other. */
    passes++;
    toolbar.dataset.fitPasses = String(passes);
    ensureMore();
    if (more) more.hidden = true;
    /* One flat sequence out of the app's nested declaration: a group's pieces first, in
       the order the app said to give them up; the group itself only if it offered no
       pieces. A group that declared units is never collapsed as a whole — hiding every
       piece and then the container too would only count a step that changes nothing. */
    const scope = toolbar.dataset.collapseScope
      ? (toolbar.closest(toolbar.dataset.collapseScope) || toolbar)
      : toolbar;
    const declared = (toolbar.dataset.collapse || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .flatMap((sel) => [...scope.querySelectorAll(sel)]);
    const sequence = [];
    const unitGroups = [];
    for (const group of declared) {
      const units = unitsOf(group);
      if (!units.length) { sequence.push({ node: group }); continue; }
      unitGroups.push({ node: group, start: sequence.length });
      for (const u of units) sequence.push({ node: u });
    }

    const apply = (k) => {
      for (let i = 0; i < sequence.length; i++) sequence[i].node.classList.toggle('is-collapsed', i < k);
      /* A group's pieces are contiguous in the sequence, so "any of them hidden" is just
         "the cut is past where this group starts". */
      for (const g of unitGroups) g.node.classList.toggle('has-units-hidden', g.start < k);
    };

    const fits = () => toolbar.scrollWidth <= toolbar.clientWidth + 1;
    /* Both halves of a bar's shape. A rung that lives outside the bar (a Places sidebar)
       buys room by making the bar *wider*, not by making its contents narrower, so a scan
       that only looks at scrollWidth would report the one rung that changed the most as
       having bought nothing. */
    const measure = () => [Math.round(toolbar.scrollWidth), Math.round(toolbar.clientWidth)];
    const differs = (a, b) => Math.abs(a[0] - b[0]) > 0.5 || Math.abs(a[1] - b[1]) > 0.5;
    /* The one question this watcher has to answer: *how little* of the declared order does
       the bar actually need to give up? Everything past that prefix is a control the bar
       hid for nothing. Searching for the shortest prefix directly — instead of cutting group
       by group and then taking back what turned out to be spare — is the same answer with
       far fewer layout reads: logarithmic in the length of the list rather than linear,
       which is the guard against somebody putting a 200-item group in a toolbar.

       The search assumes the obvious monotonicity: hiding more of the bar never makes it
       wider. Two things in real toolbars break that — a fold marker (Files' `…` appears
       when the first breadcrumb segment goes) and a control that grows when the control
       beside it is hidden (a flexible slider). `shortestFit` verifies its own answer and
       repairs both cases, so a bar that only needed one cut never keeps a second one. */
    const answer = shortestFit(sequence.length, (k) => { apply(k); return fits(); });
    apply(answer.cuts);

    /* What goes in the DOM is the ladder the bar walked *and* whether walking it worked.
       `data-collapsed` is the number of rungs applied; `data-collapsed-exhausted` says the
       bar gave up everything it is allowed to and still overflows. Without the second half,
       "collapsed=7" at the minimum width reads like a fact about the layout when it is only
       a fact about the declaration — and the last of those 7 rungs may have bought nothing
       at all (shortening a folder name that was already short). `data-collapsed-effective`
       is the honest number for the exhausted case: how many of those rungs changed the
       measured bar. Counting it costs one walk back over the ladder, which is paid for
       only when the bar has run out of things to give up — and only for ladders short
       enough for that walk to be cheap. */
    toolbar.dataset.collapsed = answer.cuts ? String(answer.cuts) : '';
    if (answer.fits) {
      delete toolbar.dataset.collapsedExhausted;
      delete toolbar.dataset.collapsedEffective;
    } else {
      toolbar.dataset.collapsedExhausted = 'true';
      /* What each rung bought is a property of the bar's *content*, not of the window: the
         walk measures how the bar's own width changes as rungs are put back, and none of
         those deltas depend on how wide the bar happens to be right now. So the walk is
         cached against the content it measured — the length of the ladder, the cut level it
         walked from, and the bar's content width at that level — and dragging a window that
         has run out of rungs pays for the walk once, not once per resize event. A bar whose
         *content* changed measures a different content width, so it re-walks.

         The cache is a cache about a diagnostic. Nothing about the layout depends on the
         number: the cut level above is chosen by measurement every single pass. The most a
         stale cache can do is repeat a number for two different contents that measured
         identically at the same cut level. */
      const key = `${sequence.length}|${answer.cuts}|${Math.round(toolbar.scrollWidth)}`;
      if (walkCache && walkCache.key === key) {
        toolbar.dataset.collapsedEffective = walkCache.value;
        if (walkCache.ms) toolbar.dataset.collapsedEffectiveWalkMs = walkCache.ms;
      } else {
        let value = '';
        let ms = '';
        if (answer.cuts > EFFECTIVE_SCAN_LIMIT) {
          /* Longer than the walk is allowed to chase. Writing 0 here would be the exact lie
             this attribute exists to avoid: "nothing bought anything" and "nobody looked" read
             the same, and only one of them is true. */
          value = 'unmeasured';
          toolbar.dataset.collapsedEffectiveLimit = String(EFFECTIVE_SCAN_LIMIT);
          delete toolbar.dataset.collapsedEffectiveWalkMs;
        } else if (answer.cuts > 0) {
          walks++;
          toolbar.dataset.collapsedEffectiveWalks = String(walks);
          /* The walk is the one part of this watcher whose cost grows with the *content*, so
             its cost belongs in the DOM next to the number it produced: "we only walk when we
             have to, and the cache makes it once per content" is a claim about milliseconds,
             and milliseconds are the thing a later change would break. */
          const startedAt = performance.now();
          let bought = 0;
          let measured = measure();
          for (let k = answer.cuts - 1; k >= 0; k--) {
            apply(k);
            const now = measure();
            if (differs(measured, now)) bought++;
            measured = now;
          }
          apply(answer.cuts);
          value = String(bought);
          ms = (performance.now() - startedAt).toFixed(1);
          toolbar.dataset.collapsedEffectiveWalkMs = ms;
          delete toolbar.dataset.collapsedEffectiveLimit;
        } else {
          delete toolbar.dataset.collapsedEffectiveLimit;
          delete toolbar.dataset.collapsedEffectiveWalkMs;
        }
        toolbar.dataset.collapsedEffective = value;
        walkCache = { key, value, ms };
      }
    }
    if (more) more.hidden = fits();
  };

  const update = () => {
    const left = toolbar.scrollLeft > 2;
    const right = toolbar.scrollLeft + toolbar.clientWidth < toolbar.scrollWidth - 2;
    toolbar.dataset.overflowLeft = left ? 'true' : '';
    toolbar.dataset.overflowRight = right ? 'true' : '';
  };

  const sync = () => { fit(); update(); };

  toolbar.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(sync);
  ro.observe(toolbar);
  /* A ResizeObserver only sees the container change size. Rebuilding a breadcrumb, adding a
     button or renaming a label changes the bar's content width without changing its box, so
     the subtree is watched too — otherwise the fade and the collapse level quietly lie.
     Batched into one frame so a long re-render cannot thrash the layout. */
  let queued = 0;
  const schedule = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => { queued = 0; sync(); });
  };
  const mo = new MutationObserver(schedule);
  mo.observe(toolbar, { childList: true, subtree: true, characterData: true });
  sync();
  const stop = () => { ro.disconnect(); mo.disconnect(); if (queued) cancelAnimationFrame(queued); queued = 0; };
  stop.refresh = sync;
  return stop;
}

/** True when the device's primary pointer is a finger rather than a mouse. */
export function coarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Long-press support for touch pointers (the touch equivalent of right-click).
 *
 * Fires `onLongPress(event)` when a non-mouse pointer presses `target`, stays roughly
 * still for `ms`, and has not been released. Mouse pointers are ignored entirely so
 * desktop behaviour is unchanged. Returns `{ consumedClick(), consumedContext() }`:
 * call them at the top of the click / contextmenu handlers — after a long-press the
 * browser still delivers a click (and, on Android Chrome, a native `contextmenu`),
 * and neither must select the item or open a second menu.
 */
export function addLongPress(target, onLongPress, { ms = 500, slop = 12 } = {}) {
  let timer = null;
  let start = null;
  let suppressUntil = 0;
  const detach = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', cleanup);
  };
  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    start = null;
    detach();
  };
  const onMove = (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) cleanup();
  };
  const onUp = () => cleanup();
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    cleanup();
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      cleanup();
      suppressUntil = Date.now() + 400;
      onLongPress(e);
    }, ms);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', cleanup);
  });
  /* Android Chrome also fires a native `contextmenu` on long-press. If it arrives
     while our timer is still pending, the element's own contextmenu handler opens the
     menu — cancel our timer so the menu is not opened a second time. If our timer
     fired first, the caller must ignore the duplicate via consumedContext(). */
  target.addEventListener('contextmenu', () => {
    if (timer) {
      cleanup();
      suppressUntil = Date.now() + 400;
    }
  });
  return {
    consumedClick: () => Date.now() < suppressUntil,
    consumedContext: () => Date.now() < suppressUntil,
  };
}

/* ---------- focus ---------- */

/** Give a window's main control the keyboard when the window opens.
 *
 *  The delay is because the control has only just been created and is not worth focusing
 *  before it exists. The delay is also the bug: 30ms is long enough to have clicked,
 *  tabbed or typed somewhere else, and an app that unconditionally calls `.focus()` on a
 *  timer takes the keyboard back from whatever you chose — which is exactly what an app
 *  should never do to the rest of the desktop.
 *
 *  So it claims focus only when nothing else has claimed it: an empty desktop (body) or
 *  something inside its own window. Anything else — a taskbar button, another window, a
 *  desktop icon — is a decision that was already made. */
export function claimFocus(win, control, { delay = 30 } = {}) {
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !win.el.contains(active)) return;
    control.focus();
  }, delay);
}

/* ---------- file import (Upload button, drag-and-drop) ---------- */

export function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    try { return decodeURIComponent(escape(atob(body))); } catch { return body; }
  }
  return decodeURIComponent(body);
}

/**
 * The whole virtual filesystem lives in one localStorage JSON blob, so a single huge
 * upload would either blow the storage quota or eat megabytes of memory reading it.
 * Refusing oversized files up front — with a clear per-file message — is honest and
 * cheap; guessing after reading the file is neither.
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/* Even files that individually pass the per-file limit can blow the storage quota as a
 * batch: the whole filesystem is one JSON blob. A cumulative per-batch budget refuses
 * the files that genuinely do not fit, instead of letting the write layer fail later. */
export const MAX_IMPORT_BATCH_BYTES = 4 * 1024 * 1024;

/* Room deliberately left out of an import budget: the OS writes its own keys (window
 * layout, settings) after an import, and JSON escaping inflates file content slightly. */
export const STORAGE_RESERVE_BYTES = 64 * 1024;

/**
 * The limits to apply to *this* import, derived from the storage that is actually free.
 *
 * The fixed constants above are ceilings, not promises: a browser with 1 MB of quota
 * left cannot accept a 3 MB file even though it is "under the limit". When a Store can
 * measure its headroom, tighten the limits to what will really fit; when it cannot
 * (in-memory fallback, or an older Store without a probe), fall back to the constants.
 *
 * @returns {{perFile:number, batch:number, free:number}} free is Infinity when unknown.
 */
export function importLimits(store) {
  const free = typeof store?.headroom === 'function' ? store.headroom() : Infinity;
  if (!Number.isFinite(free)) return { perFile: MAX_IMPORT_BYTES, batch: MAX_IMPORT_BATCH_BYTES, free };
  const usable = Math.max(0, free - STORAGE_RESERVE_BYTES);
  return {
    perFile: Math.min(MAX_IMPORT_BYTES, usable),
    batch: Math.min(MAX_IMPORT_BATCH_BYTES, usable),
    free,
  };
}

/**
 * Write browser File objects (from an <input type=file> or a drop) into the virtual
 * filesystem. Each file is handled independently: one unreadable, oversized or
 * unwritable file is reported and skipped instead of aborting the whole batch.
 * Images are stored as data URLs; everything else is decoded to text.
 * Returns the number imported.
 */
export async function importFiles({ fs, store, toast }, files, destDir) {
  let imported = 0;
  let used = 0;
  const limits = importLimits(store);
  if (limits.batch === 0) {
    toast('Storage is full', `${fmtBytes(limits.free)} of this browser's storage is free — nothing can be imported`, 'err');
    return 0;
  }
  for (const file of files) {
    try {
      if (file.size > limits.perFile) {
        const why = limits.perFile < MAX_IMPORT_BYTES
          ? `only ${fmtBytes(limits.perFile)} fits — ${fmtBytes(limits.free)} of storage is free`
          : `the import limit is ${fmtBytes(limits.perFile)}`;
        toast('File too large', `${file.name} (${fmtBytes(file.size)}) — ${why}`, 'err');
        continue;
      }
      if (used + file.size > limits.batch) {
        toast('Import budget exceeded', `${file.name} (${fmtBytes(file.size)}) — only ${fmtBytes(limits.batch - used)} of this batch's ${fmtBytes(limits.batch)} budget remains`, 'err');
        continue;
      }
      const name = fs.uniqueName(destDir, file.name);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('could not be read'));
        reader.readAsDataURL(file);
      });
      const content = (file.type || '').startsWith('image/') ? dataUrl : decodeDataUrl(dataUrl);
      fs.write(`${destDir}/${name}`, content, '/');
      imported++;
      used += file.size;
    } catch (err) {
      toast('Upload failed', `${file.name}: ${err?.message || err}`, 'err');
    }
  }
  return imported;
}

/* ---------- contrast, in one place ----------
   Every contrast claim in this project (the theme choosing ink for a wallpaper, the tests
   asserting a preset is readable, the screenshot script reporting ratios) is the same WCAG
   calculation. Written down once, it cannot drift into three slightly different formulas. */
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbOf = (cssColor) => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(cssColor || ''));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = /^#([0-9a-f]{6})$/i.exec(String(cssColor || '').trim());
  return h ? hexToRgb(h[0]) : null;
};
export const relLuminance = ([r, g, b]) => {
  const ch = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `rgba(r, g, b, a)` / `#rrggbb` -> `[r, g, b, a]`, for compositing rather than comparing. */
export const rgbaOf = (css) => {
  const s = String(css || '').trim();
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  const h = /^#([0-9a-f]{6})$/i.exec(s);
  return h ? [...hexToRgb(h[0]), 1] : null;
};

/** What a translucent layer over a background actually paints (source-over).
   A plate behind a label is only a fix if it is *measured* as a fix: the number Settings
   reports has to be the contrast of the ink against the composited pixels, not against the
   wallpaper the plate is sitting on. */
export const mixOver = (bg, layer) => {
  const [r, g, b, a] = layer;
  return [0, 1, 2].map((i) => Math.round(r * a + bg[i] * (1 - a)));
};

/* ---------- painting a CSS background into a canvas ----------
   A canvas cannot be *told* a CSS gradient: `fillStyle` takes a colour, and a gradient string
   is silently not one — it paints black. Anything that wants to know what a wallpaper actually
   looks like (the theme, to pick ink that reads on it; the tests, to measure contrast against
   real pixels instead of the CSS that describes it) has to parse the gradient and rebuild it as
   a real canvas gradient, at the same angle and the same stops the browser was given.
   Solid colours and `url()` backgrounds are handled too: a `url()` paints nothing here, which
   is the honest answer and the signal to fall back to loading the image. */
export function paintCssBackground(ctx, css, w, h) {
  css = String(css || '');
  const open = css.indexOf('(');
  /* `fillStyle` takes a colour. A `url(...)` is not one, and a canvas does not complain — it
     keeps the colour it already had (black, by default) and paints that, which is how a
     measurement ends up reporting an image as black. Say so instead: paint nothing and return
     false, so the caller knows these pixels were never the wallpaper's. */
  if (/url\(/i.test(css) && !/gradient\(/i.test(css)) return false;
  if (!/^linear-gradient\(/.test(css) || open < 0) { ctx.fillStyle = css || 'transparent'; ctx.fillRect(0, 0, w, h); return true; }
  const body = css.slice(open + 1, balancedEnd(css, open));
  const parts = splitTop(body);
  let angle = 180;
  const dir = /^(to\s+(?:top|bottom|left|right)(?:\s+(?:top|bottom|left|right))?|-?\d+(?:\.\d+)?(?:deg|turn))/i;
  if (dir.test(parts[0])) {
    const t = parts.shift();
    if (/^to\s/i.test(t)) {
      const dirs = { top: 0, right: 90, bottom: 180, left: 270 };
      angle = dirs[/^to\s+([a-z]+)/i.exec(t)[1].toLowerCase()];
    } else if (/turn$/i.test(t)) angle = parseFloat(t) * 360;
    else angle = parseFloat(t);
  }
  const stops = [];
  for (const part of parts) {
    const cm = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/.exec(part);
    if (!cm) continue;
    const pm = /([0-9.]+)%/.exec(part.slice(cm.index + cm[1].length));
    stops.push({ color: cm[1], at: pm ? parseFloat(pm[1]) / 100 : null });
  }
  if (!stops.length) { ctx.fillStyle = 'transparent'; ctx.fillRect(0, 0, w, h); return; }
  if (stops[0].at === null) stops[0].at = 0;
  if (stops[stops.length - 1].at === null) stops[stops.length - 1].at = 1;
  stops.forEach((st) => { if (st.at === null) st.at = 0; });
  /* CSS measures an angle clockwise from "to top"; a canvas gradient is a line. The line that
     paints the same wash is the projection of that direction onto the box. */
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const half = Math.min(Math.abs((w / 2) / (dx || 1e-9)), Math.abs((h / 2) / (dy || 1e-9)));
  const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  stops.forEach((st) => g.addColorStop(Math.max(0, Math.min(1, st.at)), st.color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return true;
  /* Nested on purpose: the test injects this one function's source into the page, and a
     function that reaches for a helper that stayed behind is a test that throws. */
  function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function balancedEnd(s, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (!depth) return i; }
    }
    return s.length;
  }
}

