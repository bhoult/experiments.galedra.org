import { debounce, basename, parentPath, extOf, VERSION } from './utils.js';

/**
 * A tiny in-memory filesystem with localStorage persistence.
 * Paths are POSIX-ish: '/', '/home/user', '~' expands to the user home.
 */
export class VirtualFS {
  home = '/home/user';

  constructor(bus, store) {
    this.bus = bus;
    this.store = store;
    this.root = store.load('fs') || defaultTree();
    this.persist = debounce(() => store.save('fs', this.root), 200);
  }

  /* ---------- paths ---------- */

  resolve(path = '', cwd = this.home) {
    let p = String(path).trim();
    if (!p) return cwd;
    if (p === '~') p = this.home;
    else if (p.startsWith('~/')) p = this.home + p.slice(1);

    const stack = p.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
    for (const part of p.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return '/' + stack.join('/');
  }

  display(abs) {
    if (abs === this.home) return '~';
    if (abs.startsWith(this.home + '/')) return '~' + abs.slice(this.home.length);
    return abs;
  }

  /* ---------- queries ---------- */

  getNode(abs) {
    let node = this.root;
    for (const part of abs.split('/').filter(Boolean)) {
      if (node.type !== 'dir') return null;
      node = node.children[part];
      if (!node) return null;
    }
    return node;
  }

  exists(path, cwd) {
    return !!this.getNode(this.resolve(path, cwd));
  }

  stat(path, cwd) {
    const abs = this.resolve(path, cwd);
    const node = this.getNode(abs);
    if (!node) return null;
    return {
      path: abs,
      name: node.name || '/',
      type: node.type,
      size: node.type === 'file' ? (node.content?.length ?? 0) : 0,
      modified: node.modified || null,
      ext: extOf(node.name),
      children: node.type === 'dir' ? Object.keys(node.children).length : 0,
    };
  }

  list(path, cwd) {
    const abs = this.resolve(path, cwd);
    const node = this.getNode(abs);
    if (!node) throw new Error(`no such directory: ${abs}`);
    if (node.type !== 'dir') throw new Error(`not a directory: ${abs}`);
    return Object.values(node.children)
      .map((child) => ({
        path: abs === '/' ? `/${child.name}` : `${abs}/${child.name}`,
        name: child.name,
        type: child.type,
        size: child.type === 'file' ? (child.content?.length ?? 0) : 0,
        children: child.type === 'dir' ? Object.keys(child.children).length : 0,
        modified: child.modified || null,
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  read(path, cwd) {
    const abs = this.resolve(path, cwd);
    const node = this.getNode(abs);
    if (!node) throw new Error(`no such file: ${abs}`);
    if (node.type === 'dir') throw new Error(`is a directory: ${abs}`);
    return node.content ?? '';
  }

  /* ---------- mutations ---------- */

  mkdir(path, cwd = this.home, recursive = true) {
    const abs = this.resolve(path, cwd);
    if (abs === '/') return this.getNode('/');
    const parts = abs.split('/').filter(Boolean);
    let node = this.root;
    let created = false;
    for (const part of parts) {
      if (node.type !== 'dir') throw new Error(`not a directory: ${parentPath(abs)}`);
      if (!node.children[part]) {
        if (!recursive) throw new Error(`parent missing: ${part}`);
        node.children[part] = { name: part, type: 'dir', children: {}, modified: now() };
        created = true;
      }
      node = node.children[part];
    }
    if (node.type !== 'dir') throw new Error(`not a directory: ${abs}`);
    if (created) this.#changed(abs);
    return node;
  }

  write(path, content, cwd = this.home) {
    const abs = this.resolve(path, cwd);
    if (abs === '/') throw new Error('cannot write to /');
    const parent = this.mkdir(parentPath(abs), '/', true);
    const name = basename(abs);
    if (parent.children[name]?.type === 'dir') throw new Error(`is a directory: ${abs}`);
    parent.children[name] = { name, type: 'file', content: String(content), modified: now() };
    this.#changed(abs);
    return this.getNode(abs);
  }

  append(path, content, cwd = this.home) {
    let existing = '';
    try { existing = this.read(path, cwd); } catch { /* new file */ }
    return this.write(path, existing + content, cwd);
  }

  rm(path, cwd = this.home, recursive = false) {
    const abs = this.resolve(path, cwd);
    if (abs === '/') throw new Error('cannot delete /');
    const parent = this.getNode(parentPath(abs));
    const name = basename(abs);
    const node = parent?.children?.[name];
    if (!node) throw new Error(`no such file: ${abs}`);
    if (node.type === 'dir' && Object.keys(node.children).length && !recursive) {
      throw new Error(`directory not empty (use rm -r): ${abs}`);
    }
    delete parent.children[name];
    this.#changed(abs);
    return true;
  }

  mv(from, to, cwd = this.home) {
    const src = this.resolve(from, cwd);
    const wantsDir = String(to ?? '').trim().endsWith('/');
    const dst = this.resolve(to, cwd);
    if (src === '/' || dst === '/') throw new Error('cannot move /');
    if (dst === src) return true;
    if (dst.startsWith(src + '/')) throw new Error('cannot move a directory into itself');
    const srcParent = this.getNode(parentPath(src));
    const node = srcParent?.children?.[basename(src)];
    if (!node) throw new Error(`no such file: ${src}`);
    const dstNode = this.getNode(dst);
    if (wantsDir && dstNode && dstNode.type !== 'dir') throw new Error(`not a directory: ${dst}`);
    const dstAbs = wantsDir || dstNode?.type === 'dir' ? join(dst, node.name) : dst;
    if (dstAbs === src) return true;
    const existing = this.getNode(dstAbs);
    if (existing?.type === 'dir' && node.type !== 'dir') throw new Error(`is a directory: ${dstAbs}`);
    if (existing && node.type === 'dir' && existing.type === 'file') {
      throw new Error(`cannot move a directory onto a file: ${dstAbs}`);
    }
    const dstParent = this.mkdir(parentPath(dstAbs), '/', true);
    delete srcParent.children[basename(src)];
    node.name = basename(dstAbs);
    node.modified = now();
    dstParent.children[node.name] = node;
    this.#changed(src);
    this.#changed(dstAbs);
    return true;
  }

  copy(path, dest, cwd = this.home) {
    const src = this.resolve(path, cwd);
    const node = this.getNode(src);
    if (!node) throw new Error(`no such file: ${src}`);
    const destAbs = this.resolve(dest, cwd);
    const destNode = this.getNode(destAbs);
    const target = destNode?.type === 'dir' ? join(destAbs, node.name) : destAbs;
    if (target === src) throw new Error('source and destination are the same');
    if (node.type === 'file') this.write(target, node.content, '/');
    else this.#copyDir(node, target);
    return true;
  }

  #copyDir(node, abs) {
    this.mkdir(abs, '/', true);
    for (const child of Object.values(node.children)) {
      if (child.type === 'file') this.write(`${abs}/${child.name}`, child.content, '/');
      else this.#copyDir(child, `${abs}/${child.name}`);
    }
  }

  uniqueName(dirPath, desired, cwd = this.home) {
    const dir = this.resolve(dirPath, cwd);
    const taken = new Set(Object.keys(this.getNode(dir)?.children || {}));
    if (!taken.has(desired)) return desired;
    const dot = desired.lastIndexOf('.');
    const stem = dot > 0 ? desired.slice(0, dot) : desired;
    const ext = dot > 0 ? desired.slice(dot) : '';
    let n = 2;
    while (taken.has(`${stem}-${n}${ext}`)) n++;
    return `${stem}-${n}${ext}`;
  }

  tree(path = this.home, cwd = this.home, depth = 3) {
    const lines = [];
    const walk = (abs, prefix, isLast, level) => {
      const node = this.getNode(abs);
      if (!node) return;
      const branch = level === 0 ? '' : `${prefix}${isLast ? '└── ' : '├── '}`;
      lines.push(`${branch}${node.name || '/'}${node.type === 'dir' ? '/' : ''}`);
      if (level >= depth || node.type !== 'dir') return;
      const kids = Object.values(node.children).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
      kids.forEach((child, i) => {
        const childAbs = abs === '/' ? `/${child.name}` : `${abs}/${child.name}`;
        walk(childAbs, level === 0 ? '' : `${prefix}${isLast ? '    ' : '│   '}`, i === kids.length - 1, level + 1);
      });
    };
    walk(this.resolve(path, cwd), '', true, 0);
    return lines.join('\n');
  }

  /** Total bytes of file content and file count, cached until the next mutation. */
  counts() {
    if (this.stats) return this.stats;
    let files = 0;
    let bytes = 0;
    const walk = (node) => {
      if (node.type === 'file') { files++; bytes += node.content?.length ?? 0; return; }
      for (const child of Object.values(node.children)) walk(child);
    };
    walk(this.root);
    this.stats = { files, bytes };
    return this.stats;
  }

  reset() {
    this.root = defaultTree();
    this.store.save('fs', this.root);
    this.stats = null;
    this.bus.emit('fs:change', { path: '/', reset: true });
  }

  #changed(abs) {
    this.stats = null;
    this.persist();
    this.bus.emit('fs:change', { path: abs });
  }
}

const now = () => new Date().toISOString();
const join = (dir, name) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

function defaultTree() {
  const dir = (name, children = {}) => ({ name, type: 'dir', children, modified: now() });
  const file = (name, content) => ({ name, type: 'file', content, modified: now() });

  return dir('', {
    home: dir('home', {
      user: dir('user', {
        Desktop: dir('Desktop', {
          'welcome.txt': file('welcome.txt',
            'Welcome to Browser OS!\n\nEverything here runs in your browser tab:\n- windows you can drag, resize, snap and tile\n- a virtual filesystem persisted in localStorage\n- a terminal with a handful of commands\n\nTry right-clicking the desktop.\n'),
        }),
        Documents: dir('Documents', {
          'notes.md': file('notes.md', '# Notes\n\n- double-click a file in the Files app to edit it\n- Ctrl+S saves straight back into the virtual filesystem\n- `open notes.md` works from the terminal too\n'),
        }),
        Pictures: dir('Pictures', {}),
        Downloads: dir('Downloads', {}),
        /* The shell reads this file when a terminal opens (`man startup`). It is a file like any
           other — visible to `ls`, openable in Files, editable — because the whole point of it is
           that *you* wrote it, and a thing you wrote should be a thing you can see and delete.
           Two aliases so the feature is not a hidden one: `ll` is the alias everyone writes first. */
        '.shellrc': file('.shellrc',
          '# ~/.shellrc — the commands this shell runs when a terminal opens.\n'
          + '# Any command line works here; assignments and aliases are what belongs here.\n'
          + '# Edit it with `edit ~/.shellrc`, then `source ~/.shellrc` to read it again.\n'
          + "alias ll='ls -l'\n"
          + "alias docs='cd ~/Documents && ls'\n"),
      }),
    }),
    etc: dir('etc', {
      motd: file('motd', 'Browser OS — a desktop that fits in a tab.\n'),
      'os-release': file('os-release', `NAME="Browser OS"\nVERSION="${VERSION}"\nID=browseros\n`),
    }),
  });
}
