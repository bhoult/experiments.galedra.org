import { el, fmtBytes, iconFor, parentPath, coarsePointer, addLongPress, importFiles, importLimits, splitName, MAX_IMPORT_BYTES } from '../core/utils.js';

/* "0 folders, 1 files" is the kind of wording that makes a status bar look unread. */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const PLACES = [
  { label: 'Home', path: '/home/user', icon: '🏠' },
  { label: 'Desktop', path: '/home/user/Desktop', icon: '🖥️' },
  { label: 'Documents', path: '/home/user/Documents', icon: '📄' },
  { label: 'Pictures', path: '/home/user/Pictures', icon: '🖼️' },
  { label: 'Downloads', path: '/home/user/Downloads', icon: '⬇️' },
  { label: 'System (/)', path: '/', icon: '🗄️' },
];

export default {
  id: 'files',
  name: 'Files',
  icon: '🗂️',
  width: 840,
  height: 500,
  /* The promise this app makes about its own toolbar, and the one thing it does *not*
     promise. At this width every action is reachable — either in the bar, or named in the
     `⋯` menu the core adds to a bar that genuinely cannot show it (see
     watchToolbarOverflow). It is not a promise that nothing is compacted, and it is not a
     promise that the bar fits whatever the folder happens to be called: the bar's width is
     fixed here and the breadcrumb's is not. What varies with the content is bounded too — a
     folder name long enough to cost the bar room costs it a fixed amount, because the last
     thing the bar is allowed to give up is the *length of that name*, not another action. */
  minWidth: 360,
  minHeight: 260,
  keywords: ['file', 'manager', 'explorer', 'folder'],

  mount(ctx, win) {
    /* `win.data.path` is whatever a caller or a restored session chose, and a caller is allowed
       to say `~/Documents`. Everything below assumes `cwd` is absolute — the breadcrumb's "am I
       under home?" test above all — so the path is normalised once here instead of being guessed
       at. Unnormalised, `~/Documents` renders as `root / ~ / Documents`: a trail with a segment
       that does not exist, and (because each foldable segment is a rung of the bar's ladder) a
       bar with a rung it never had. */
    let cwd = ctx.fs.resolve(win.data?.path ?? '', ctx.fs.home);
    /* The folder this window was opened on and could not find. Two ways to arrive in that state:
       a path handed to `open`/`launch` that is not there (found below, when `list` throws), and
       a *restored* session whose folder was deleted while the window was closed. The second one
       is checked here, before anything is rendered, because `win.data.requested` is persisted
       with the window: a restored Files window still knows what it was asked to show, and says
       so again rather than quietly reopening on home. If the folder came back in the meantime,
       the window goes back to it — the request is still the user's, not a stale error. */
    let missingPath = null;
    const requested = win.data?.requested ? ctx.fs.resolve(win.data.requested, cwd) : null;
    if (requested && requested !== cwd && !ctx.fs.exists(requested, '/')) missingPath = requested;
    else if (requested && ctx.fs.exists(requested, '/')) cwd = requested;
    const back = [];
    let selected = null;
    let currentEntries = [];
    let filter = '';
    const SORTS = [
      { key: 'name', label: 'Name' },
      { key: 'size', label: 'Size' },
      { key: 'newest', label: 'Newest' },
    ];
    let sortKey = SORTS.some((s) => s.key === win.data?.sort) ? win.data.sort : 'name';

    const side = el('nav', { class: 'files-side' });
    /* Not a control and not visible: a handle the toolbar watcher can hold the Places labels
       by. Declaring it in the bar's collapse order (see `toolbar` below) is what lets *the
       bar* decide when the sidebar becomes icons, by measuring whether it needs the 126px —
       instead of this app keeping a sidebar breakpoint and a toolbar breakpoint in step by
       hand, which is exactly how a wider window used to end up showing less than a narrower
       one. The CSS reacts to the marker (`…is-collapsed ~ .files-side`), so no app code has
       to track the decision either. */
    const sideLabelsOff = el('span', { class: 'files-side-labels', 'aria-hidden': 'true', hidden: true });
    const crumbs = el('div', { class: 'crumbs', dataset: { collapseUnits: '.crumb-mid, .crumb-last' } });
    const grid = el('div', { class: 'filegrid' });
    const status = el('div', { class: 'statusbar' });
    const upload = el('input', { type: 'file', class: 'hidden', multiple: '' });

    const search = el('input', {
      class: 'field files-search', type: 'search', placeholder: 'Filter…',
      'aria-label': 'Filter files in this folder (press /)', title: 'Filter names — press / to jump here', spellcheck: 'false',
      oninput: () => { filter = search.value; render(); },
      onkeydown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); search.value = ''; filter = ''; render(); }
        e.stopPropagation(); // typing here must not trigger grid shortcuts
      },
    });
    let sortLabel;
    const sortBtn = el('button', {
      class: 'btn ghost files-sort', type: 'button',
      title: 'Change the sort order', 'aria-label': 'Sort items',
      onclick: () => {
        sortKey = SORTS[(SORTS.findIndex((s) => s.key === sortKey) + 1) % SORTS.length].key;
        render();
      },
    },
      el('span', { class: 'btn-glyph', 'aria-hidden': 'true', text: '⇅' }),
      (sortLabel = el('span', { class: 'btn-label', text: 'Sort: Name' })),
    );

    /* Creating things is grouped so a narrow window can compact the pair. What the compact
       form is matters: two glyph buttons are the pair with its words thrown away, and a bar
       that is too narrow for the words is a bar that is too narrow for the pair. So the
       first thing this bar gives up is the pair, and what replaces it is one menu button
       that names both actions — cheaper than either of them, and nothing about the app is
       hidden by it. If even that is too much, the *next* thing to go is the word on it, so
       the bar degrades in steps instead of all at once. It is deliberately not a split
       button: a split button is two affordances in the width of one, which is the same lie
       as a glyph with a hidden label. */
    const createBtn = (glyph, label, kind) => el('button', { class: 'btn btn-create', type: 'button', 'aria-label': label, title: label, onclick: () => create(kind) },
      el('span', { class: 'btn-glyph', 'aria-hidden': 'true', text: glyph }),
      el('span', { class: 'btn-label', text: label }),
    );
    const newMenuBtn = el('button', {
      class: 'btn files-new-menu', type: 'button',
      'aria-label': 'New folder or file', title: 'Create a folder or a file',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        /* `within` is what makes this the window's menu: it is kept inside the window it
           belongs to, the same as every other menu this window opens. */
        ctx.shell.openContextMenu(r.left, r.bottom + 4, [
          { label: 'New folder', glyph: '📁', run: () => create('dir') },
          { label: 'New file', glyph: '📄', run: () => create('file') },
        ], { within: win.el.getBoundingClientRect() });
      },
    },
      el('span', { class: 'btn-glyph', 'aria-hidden': 'true', text: '＋' }),
      el('span', { class: 'btn-label', text: 'New' }),
    );
    const createGroup = el('div', { class: 'files-create' },
      el('div', { class: 'files-create-pair' },
        createBtn('📁＋', 'New folder', 'dir'),
        createBtn('📄＋', 'New file', 'file'),
      ),
      newMenuBtn,
    );

    /* The Upload button states the limit that actually applies to this browser, which is
       the measured free space when it is smaller than the documented ceiling. Its glyph is
       a tray, not an arrow: the bar already has an ↑ that means "go to the parent
       folder", and a narrow window shows only glyphs. */
    const uploadBtn = el('button', { class: 'btn files-upload', type: 'button', 'aria-label': 'Upload files', onclick: () => upload.click() },
      el('span', { class: 'btn-glyph', 'aria-hidden': 'true', text: '📤' }),
      el('span', { class: 'btn-label', text: 'Upload' }),
    );
    const syncUploadHint = () => {
      const l = importLimits(ctx.store);
      uploadBtn.title = l.perFile < MAX_IMPORT_BYTES
        ? `Upload files (up to ${fmtBytes(l.perFile)} each — only ${fmtBytes(l.free)} of this browser's storage is free)`
        : `Upload files (up to ${fmtBytes(l.perFile)} each, ${fmtBytes(l.batch)} per batch)`;
    };

    /* Collapse order for a bar that cannot fit everything. The order is a judgement about
       what loses the *least*, and it is a gradient rather than a switch. First the create
       pair becomes one menu button that still says "New" — the only rung on this list that
       costs the user nothing, because the menu names both actions. Then the Places words:
       126px is the most room this window can buy at once, and the sidebar's icons stay
       clickable and keep their accessible names, so it is taken only after the one free
       saving is spent. Then the menu loses the word and keeps its glyph, then Sort and
       Upload lose theirs, then the filter box shrinks, and only last the breadcrumb — the
       one control that says where you are, and even then it keeps the anchor and the folder
       you are in; what it gives up at the very end is the *length* of that folder's name.
       A dead-end crumb naming a folder this window could not open goes one rung *before*
       the breadcrumb: that path is already spelled out in full in the notice under the bar,
       so repeating it in the trail is the one piece of "where you are" this bar can afford
       to lose first.
       The order is not arbitrary: the word on ＋ goes before the word on Sort because the
       glyph already means "new", while "Sort: Name" is the only place this window says what
       the folder is sorted by — a bare ⇅ would be a control that has stopped telling you
       anything. Navigation is never collapsible: it is the reason this window is open. */
    const toolbar = el('div', { class: 'toolbar', dataset: { collapseScope: '.app', collapse: '.files-create-pair, .files-side-labels, .files-new-menu .btn-label, .files-sort, .files-upload, .files-search, .crumb-gone, .crumbs' } },
      el('button', { class: 'btn ghost', title: 'Back', 'aria-label': 'Back to the previous folder', onclick: () => { const p = back.pop(); if (p) go(p, false); } }, '←'),
      el('button', { class: 'btn ghost', title: 'Parent folder', 'aria-label': 'Go to the parent folder', onclick: () => go(parentPath(cwd)) }, '↑'),
      crumbs,
      el('span', { class: 'spacer' }),
      search,
      sortBtn,
      createGroup,
      uploadBtn,
    );
    syncUploadHint();

    const appRoot = el('div', { class: 'app files' }, sideLabelsOff, side, el('div', { class: 'files-main' }, toolbar, grid, status), upload);
    win.body.replaceChildren(appRoot);

    /* The only width decision this app still makes by itself, and it is not a toolbar one:
       a phone-width window has no keyboard, so the status bar's keyboard cheat-sheet is not
       worth the lines it takes (the counts stay). Everything about the bar and the sidebar
       is measured — see the collapse order above. */
    const tinyStatus = () => appRoot.classList.toggle('is-tiny', win.body.clientWidth < 460);
    const sideObserver = new ResizeObserver(tinyStatus);
    sideObserver.observe(win.body);
    tinyStatus();

    const renderSidebar = () => {
      side.replaceChildren(
        el('div', { class: 'start-section' }, 'Places'),
        ...PLACES.map((place) => el('button', {
          class: `side-item${place.path === cwd ? ' active' : ''}`, type: 'button',
          title: place.label, 'aria-label': place.label,
          onclick: () => go(place.path),
        }, el('span', { class: 'side-glyph', 'aria-hidden': 'true', text: place.icon }), el('span', { class: 'side-label', text: place.label }))),
      );
    };

    /* The trail is written the way every shell writes it: `/home/user/Documents` is
       `~/Documents`. Two reasons, both real. It is the form people already read and type
       (the prompt, the window title and `fs.display()` all use it), and it is the form
       that fits: the long `root / home / user / Documents` trail is the single widest
       thing in this toolbar and the first thing a narrow window has to give up.
       Segments between the anchor and the current folder are marked `.crumb-mid` and
       offered to the toolbar watcher as foldable units, so a narrow window gives up one
       segment at a time — the ones nearest the root first — instead of the whole trail. */
    const renderCrumbs = () => {
      const home = ctx.fs.home;
      const underHome = home !== '/' && (cwd === home || cwd.startsWith(`${home}/`));
      const parts = cwd.split('/').filter(Boolean);
      const segs = underHome ? [{ path: home, label: '~' }] : [{ path: '/', label: 'root' }];
      const tail = underHome ? parts.slice(home.split('/').filter(Boolean).length) : parts;
      for (const part of tail) {
        const at = segs[segs.length - 1].path;
        segs.push({ path: at === '/' ? `/${part}` : `${at}/${part}`, label: part });
      }

      const crumb = (seg) => el('button', {
        type: 'button',
        title: ctx.fs.display(seg.path),
        'aria-label': `Go to ${seg.label === '~' ? 'home folder' : seg.label}`,
        onclick: () => go(seg.path),
      }, seg.label);
      const sep = (text = '/') => el('span', { class: 'muted crumb-sep', text });
      /* A name the bar may have to shorten is written in two pieces: the head the ellipsis is
         allowed to cut, and a tail it must keep. The same mechanism the file grid uses
         (`splitName`), pointed at a folder name — the end of a name like `…-final` or
         `…-retrospective` is often the part that distinguishes this folder from its siblings,
         and a plain ellipsis throws it away. When the name fits, both spans are whole and the
         crumb reads exactly as it did before. */
      const nameParts = (label, base = 'crumb-name') => {
        const { head, tail } = splitName(label);
        return [el('span', { class: `${base}-head`, text: head }),
          tail && el('span', { class: `${base}-tail`, text: tail })];
      };

      const nodes = [crumb(segs[0])];
      /* The ellipsis comes first, immediately after the anchor, because that is the order
         the fold works in: the segments nearest the root are the ones given up. So a
         partially folded trail still reads `~ / … / notes`, never `~ / notes / …`. */
      if (segs.length > 2) nodes.push(el('span', { class: 'crumb-elide' }, sep(), el('span', { class: 'muted', text: '…' })));
      /* Each foldable segment carries its own separator, so hiding it hides the gap too. */
      for (const seg of segs.slice(1, -1)) nodes.push(el('span', { class: 'crumb-mid' }, sep(), crumb(seg)));
      /* The folder you are in is the one segment that is never hidden. It is, however, the
         one thing in this bar whose width is not the app's choosing — a 40-character folder
         name is 200px of toolbar nobody asked for — so it is the last unit the bar may give
         up, and what it gives up is *length*: the name is cut short with an ellipsis, and
         the whole thing is still in the button's accessible name, in its tooltip and in the
         title bar. A long name costing the bar an action is the failure this rung prevents;
         a long name costing the bar a few characters of itself is the correct trade. */
      if (segs.length > 1) {
        const last = segs[segs.length - 1];
        nodes.push(sep(), el('button', {
          type: 'button',
          class: 'crumb-last',
          title: ctx.fs.display(last.path),
          'aria-label': `Go to ${last.label}`,
          onclick: () => go(last.path),
        }, ...nameParts(last.label)));
      }
      /* A folder this window was asked to open and could not find is part of where you are:
         the trail ends in it, as a dead end you cannot click. Without it the window reads as
         "I am showing home", which is true but is not the whole truth — the reason the window
         is showing home is standing two characters to the right of the anchor. Only the final
         segment is drawn (the notice below spells the full path), and it is a span, not a
         button: a crumb you can click but that leads nowhere is a lie about the filesystem. */
      if (missingPath) {
        const goneName = missingPath.split('/').filter(Boolean).pop() || missingPath;
        /* The separator travels *inside* the dead end, exactly as a foldable middle segment
           carries its own: hiding the crumb must not leave an orphan `/` at the end of the
           trail, which reads as a path that was cut off mid-word. */
        nodes.push(el('span', {
          class: 'crumb-gone',
          title: `${ctx.fs.display(missingPath)} — this folder is not there`,
          'aria-label': `Go to ${goneName}: this folder is missing`,
        }, sep(), el('span', { class: 'crumb-gone-name' }, ...nameParts(goneName, 'crumb-gone-name')), el('span', { class: 'muted crumb-gone-mark', text: 'missing' })));
      }
      crumbs.replaceChildren(...nodes);
    };

    /* View layer: filter + sort on top of the raw directory listing. Folders stay
       first within any order so navigation is never buried under large files. */
    const viewEntries = (entries) => {
      const q = filter.trim().toLowerCase();
      const view = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries];
      const dirFirst = (a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1);
      if (sortKey === 'size') view.sort((a, b) => dirFirst(a, b) || b.size - a.size || a.name.localeCompare(b.name));
      else if (sortKey === 'newest') view.sort((a, b) => dirFirst(a, b) || String(b.modified ?? '').localeCompare(String(a.modified ?? '')) || a.name.localeCompare(b.name));
      else view.sort((a, b) => dirFirst(a, b) || a.name.localeCompare(b.name));
      return view;
    };

    const render = () => {
      /* A folder that is not there is not something to recover from silently. This window was
         opened on a path, so it says which path it could not find, where it ended up instead,
         and offers to put it back — a toast alone is gone by the time you look at the window,
         and a window that quietly shows your home folder looks like the folder was empty. */
      let entries = [];
      try {
        entries = ctx.fs.list(cwd);
      } catch (err) {
        missingPath = cwd;
        cwd = ctx.fs.home;
        entries = ctx.fs.list(cwd);
        ctx.toast('Folder missing', `${ctx.fs.display(missingPath)} is not there — showing ${ctx.fs.display(cwd)} instead`, 'err');
      }
      const view = viewEntries(entries);
      currentEntries = view;
      selected = null;
      const grid_cells = view.map((entry) => {
        let lp = null;
        const open = () => (entry.type === 'dir' ? go(entry.path) : ctx.openPath(entry.path));
        /* A name is shown in two pieces when the second piece is an extension: the grid
           ellipsises the beginning and keeps the part that says what kind of file this is.
           The full name is still the cell's accessible name and its tooltip. */
        const { head, tail } = splitName(entry.name);
        const cell = el('button', {
          class: 'filecell', type: 'button',
          dataset: { path: entry.path, name: entry.name, kind: entry.type },
          title: `${entry.name}\n${entry.type === 'dir' ? `folder · ${plural(entry.children, 'item', 'items')}` : fmtBytes(entry.size)}`,
          onclick: (e) => {
            if (lp?.consumedClick()) return; // the click that ends a long-press must not also select
            if (coarsePointer() && selected === e.currentTarget) { open(); return; }
            selected?.classList.remove('selected');
            selected = e.currentTarget;
            selected.classList.add('selected');
            renderStatus(view, entries, view.length);
          },
          ondblclick: open,
          oncontextmenu: (e) => {
            if (lp?.consumedContext()) { e.preventDefault(); return; } // the native long-press menu duplicate
            e.preventDefault();
            entryMenu(e, entry);
          },
        },
          el('span', { class: 'glyph', text: iconFor(entry.name, entry.type) }),
          el('span', { class: 'name' },
            el('span', { class: 'name-head', text: head }),
            tail && el('span', { class: 'name-tail', text: tail })),
          el('span', { class: 'meta', text: entry.type === 'dir' ? `${entry.children} item${entry.children === 1 ? '' : 's'}` : fmtBytes(entry.size) }),
        );
        /* Touch: long-press is the right-click equivalent. */
        lp = addLongPress(cell, (e) => entryMenu({ clientX: e.clientX, clientY: e.clientY, preventDefault: () => {} }, entry));
        return cell;
      });
      grid.replaceChildren(...grid_cells);
      if (missingPath) {
        const wanted = missingPath;
        /* Prepended, not appended: this is the reason the window looks different, so it goes
           where the eye lands, not under the folders it is explaining. */
        grid.prepend(el('div', { class: 'missing-state' },
          el('span', { text: `“${ctx.fs.display(wanted)}” is not there any more. This is your home folder instead.` }),
          el('button', {
            class: 'btn missing-fix', type: 'button', text: 'Create that folder',
            title: `Make ${wanted} and open it`,
            onclick: () => {
              try {
                ctx.fs.mkdir(wanted, '/');
                missingPath = null;
                go(wanted);
                ctx.toast('Folder created', ctx.fs.display(wanted));
              } catch (err) {
                ctx.toast('Could not create it', String(err?.message || err), 'err');
              }
            },
          }),
        ));
      }
      if (!view.length) {
        grid.append(el('div', { class: 'empty-state' },
          filter.trim()
            ? `Nothing here matches “${filter.trim()}”. Press Escape in the filter box to clear it.`
            : missingPath
              /* Two empty-looking states at once is the one combination that reads as a bug —
                 "this is your home folder instead" next to "this folder is empty" — so the second
                 panel says what it is confirming rather than repeating the first. */
              ? 'Your home folder is empty too. The button above makes the folder you asked for.'
              : 'This folder is empty. Use the buttons above to add something.'));
      }
      const sortLabel2 = SORTS.find((s) => s.key === sortKey).label;
      sortLabel.textContent = `Sort: ${sortLabel2}`;
      renderCrumbs();
      renderSidebar();
      renderStatus(view, entries, view.length);
      /* Rebuilding the breadcrumb trail changes the toolbar's content width without
         changing the bar's box. The watcher watches the subtree for exactly this, but
         asking directly keeps the fade honest on this frame instead of the next one. */
      win.refreshToolbarFades?.();
      win.setTitle(`Files — ${ctx.fs.display(cwd)}`);
      /* `path` is where the window is; `requested` is what it was asked for. Both are persisted,
         because session restore is a reload of a *window*, not of a shell session: the folder it
         could not open is still a fact about the window, and dropping it is what made a restored
         Files window look like it had always meant to show home. */
      win.data = { path: cwd, ...(missingPath ? { requested: missingPath } : {}) };
    };

    const renderStatus = (view, all, shown) => {
      const dirs = view.filter((e) => e.type === 'dir').length;
      const files = view.length - dirs;
      const bytes = view.reduce((sum, e) => sum + e.size, 0);
      const filtered = shown !== all.length ? ` (of ${all.length})` : '';
      status.replaceChildren(
        el('span', { text: `${plural(dirs, 'folder', 'folders')}, ${plural(files, 'file', 'files')}${filtered}` }),
        el('span', { text: fmtBytes(bytes) }),
        el('span', { text: selected ? `selected: ${selected.dataset.name}` : '' }),
        el('span', { class: 'muted', text: 'Enter opens · F2 renames · Delete removes · / filters' }),
      );
    };

    const go = (path, pushHistory = true) => {
      const abs = ctx.fs.resolve(path, cwd);
      if (pushHistory && abs !== cwd) back.push(cwd);
      cwd = abs;
      /* Navigating is a new request; the window stops reporting the one it could not honour. */
      missingPath = null;
      render();
    };

    const create = (kind) => {
      const base = kind === 'dir' ? 'new folder' : 'untitled.txt';
      const name = ctx.fs.uniqueName(cwd, base);
      try {
        const abs = `${cwd}/${name}`;
        if (kind === 'dir') ctx.fs.mkdir(abs, '/'); else ctx.fs.write(abs, '', '/');
        render();
        ctx.toast('Created', name, 'ok');
      } catch (err) { ctx.toast('Create failed', err.message, 'err'); }
    };

    const remove = async (entry) => {
      const ok = await ctx.confirm({
        title: `Delete ${entry.name}?`,
        message: entry.type === 'dir'
          ? `${entry.children} item${entry.children === 1 ? '' : 's'} inside this folder will be removed.`
          : 'This file will be removed from the virtual filesystem.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        ctx.fs.rm(entry.path, '/', true);
        render();
        ctx.toast('Deleted', entry.name, 'ok');
      } catch (err) { ctx.toast('Delete failed', err.message, 'err'); }
    };

    const rename = async (entry) => {
      const name = await ctx.prompt({ title: 'Rename', message: ctx.fs.display(entry.path), value: entry.name, placeholder: 'new name' });
      if (!name || name === entry.name) return;
      try {
        ctx.fs.mv(entry.path, `${cwd}/${name}`, '/');
        render();
        ctx.toast('Renamed', `${entry.name} → ${name}`, 'ok');
      } catch (err) { ctx.toast('Rename failed', err.message, 'err'); }
    };

    const entryMenu = (e, entry) => {
      const abs = entry.path;
      ctx.shell.openContextMenu(e.clientX, e.clientY, [
        { label: entry.type === 'dir' ? 'Open folder' : 'Open', glyph: iconFor(entry.name, entry.type), run: () => (entry.type === 'dir' ? go(abs) : ctx.openPath(abs)) },
        { label: 'Rename', glyph: '✎', run: () => rename(entry) },
        { label: 'Copy to clipboard', glyph: '⧉', run: () => { ctx.shell.clipboard = { path: abs, mode: 'copy' }; ctx.toast('Copied', entry.name); } },
        { label: 'Cut to clipboard', glyph: '✂', run: () => { ctx.shell.clipboard = { path: abs, mode: 'cut' }; ctx.toast('Cut', entry.name); } },
        { label: 'Paste clipboard here', glyph: '📋', disabled: !ctx.shell.clipboard, run: () => { ctx.shell.paste(cwd); render(); } },
        { sep: true },
        { label: 'Delete', glyph: '🗑', run: () => remove(entry) },
      ]);
    };

    /* Keyboard: the grid is a column of real buttons, so Tab reaches them. `/` anywhere
       in the window jumps to the filter box. */
    const onGridKeys = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '') || e.target.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
        return;
      }
      const cell = e.target.closest?.('.filecell');
      if (!cell) return;
      const entry = currentEntries.find((x) => x.path === cell.dataset.path) || { path: cell.dataset.path, name: cell.dataset.name, type: cell.dataset.kind };
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        entry.type === 'dir' ? go(entry.path) : ctx.openPath(entry.path);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(entry);
      } else if (e.key === 'F2') {
        e.preventDefault();
        rename(entry);
      }
    };
    win.body.addEventListener('keydown', onGridKeys);

    const importBrowserFiles = async (files) => {
      const imported = await importFiles({ fs: ctx.fs, store: ctx.store, toast: ctx.toast }, files, cwd);
      if (imported) ctx.toast('Uploaded', `${imported} file${imported === 1 ? '' : 's'} into ${ctx.fs.display(cwd)}`, 'ok');
      syncUploadHint();
    };

    upload.addEventListener('change', async () => {
      const files = [...upload.files || []];
      upload.value = '';
      if (files.length) await importBrowserFiles(files);
    });

    win.body.addEventListener('dragover', (e) => { e.preventDefault(); });
    win.body.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) await importBrowserFiles(files);
    });

    const off = ctx.bus.on('fs:change', () => render());
    render();

    return () => {
      off?.();
      sideObserver.disconnect();
      win.body.removeEventListener('keydown', onGridKeys);
    };
  },
};
