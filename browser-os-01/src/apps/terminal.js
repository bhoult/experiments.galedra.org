import { el, fmtBytes, basename, VERSION } from '../core/utils.js';

const BANNER = 'Browser OS shell — type `help` to get started.';

export default {
  id: 'terminal',
  name: 'Terminal',
  icon: '⌨️',
  width: 700,
  height: 440,
  minWidth: 340,
  minHeight: 200,
  keywords: ['shell', 'console', 'cli', 'command'],

  mount(ctx, win) {
    const state = {
      cwd: win.data?.cwd || ctx.fs.home,
      history: [],
      histIndex: 0,
    };

    const out = el('div', { class: 'term-out' });
    const cwdLabel = el('span', { class: 'term-cwd' });
    const input = el('input', {
      class: 'term-input', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
      placeholder: 'type a command…',
    });
    const root = el('div', { class: 'term' }, out, el('div', { class: 'term-row' }, cwdLabel, input));
    win.body.replaceChildren(root);

    const print = (text = '', cls = '') => {
      out.append(el('div', { class: cls, text: String(text) }));
      out.scrollTop = out.scrollHeight;
    };
    const printLines = (lines, cls) => lines.forEach((l) => print(l, cls));

    const refreshPrompt = () => {
      cwdLabel.textContent = `user@browseros:${ctx.fs.display(state.cwd)}$`;
      win.setTitle(`Terminal — ${ctx.fs.display(state.cwd)}`);
    };

    const tokenize = (line) => {
      const tokens = [];
      const re = /"[^"]*"|'[^']*'|\S+/g;
      for (const m of line.match(re) || []) tokens.push(m.replace(/^(['"])(.*)\1$/, '$2'));
      return tokens;
    };

    const commands = {
      help: {
        usage: 'help',
        desc: 'List available commands.',
        run: () => {
          print('Available commands:', 'acc');
          printLines(Object.entries(commands).map(([name, c]) => `  ${name.padEnd(10)} ${c.desc}`));
          print('Tip: Tab completes commands and paths, ↑/↓ walks history, `>` redirects echo into a file.', 'dim');
        },
      },
      man: {
        usage: 'man <command>',
        desc: 'Show usage for a command.',
        run: (args) => {
          const c = commands[args[0]];
          if (!c) return print(`no manual entry for "${args[0]}"`, 'err');
          print(`${args[0]} — ${c.desc}`);
          print(`usage: ${c.usage}`, 'dim');
        },
      },
      clear: { usage: 'clear', desc: 'Clear the screen.', run: () => out.replaceChildren() },
      pwd: { usage: 'pwd', desc: 'Print the working directory.', run: () => print(state.cwd) },
      cd: {
        usage: 'cd [directory]',
        desc: 'Change directory (no argument goes home).',
        run: (args) => {
          const target = ctx.fs.resolve(args[0] || '~', state.cwd);
          const node = ctx.fs.getNode(target);
          if (!node) return print(`cd: no such directory: ${target}`, 'err');
          if (node.type !== 'dir') return print(`cd: not a directory: ${target}`, 'err');
          state.cwd = target;
          refreshPrompt();
        },
      },
      ls: {
        usage: 'ls [-l] [directory]',
        desc: 'List directory contents.',
        run: (args) => {
          const flags = args.filter((a) => a.startsWith('-'));
          const target = ctx.fs.resolve(args.find((a) => !a.startsWith('-')) || '.', state.cwd);
          const entries = ctx.fs.list(target, state.cwd);
          if (!entries.length) return print('(empty)', 'dim');
          if (flags.includes('-l')) {
            printLines(entries.map((e) =>
              `${e.type === 'dir' ? 'd' : '-'}  ${(fmtBytes(e.size)).padStart(9)}  ${(e.modified || '').slice(0, 16).replace('T', ' ')}  ${e.name}${e.type === 'dir' ? '/' : ''}`));
          } else {
            printLines(entries.map((e) => `${e.name}${e.type === 'dir' ? '/' : ''}`));
          }
        },
      },
      tree: {
        usage: 'tree [directory]',
        desc: 'Show a directory tree.',
        run: (args) => printLines(ctx.fs.tree(args[0] || '.', state.cwd).split('\n')),
      },
      cat: {
        usage: 'cat <file…>',
        desc: 'Print file contents.',
        run: (args) => {
          if (!args.length) return print('usage: cat <file…>', 'err');
          for (const a of args) print(ctx.fs.read(a, state.cwd));
        },
      },
      echo: {
        usage: 'echo <text> [> file]',
        desc: 'Print text, optionally redirecting into a file.',
        run: (args) => {
          const idx = args.findIndex((a) => a === '>' || a === '>>');
          if (idx === -1) return print(args.join(' '));
          const text = args.slice(0, idx).join(' ');
          const append = args[idx] === '>>';
          const target = args.slice(idx + 1).join(' ');
          if (!target) return print('missing file after >', 'err');
          if (append) ctx.fs.append(target, text + '\n', state.cwd);
          else ctx.fs.write(target, text + '\n', state.cwd);
          print(`wrote ${ctx.fs.display(ctx.fs.resolve(target, state.cwd))}`, 'ok');
        },
      },
      touch: {
        usage: 'touch <file>',
        desc: 'Create an empty file.',
        run: (args) => {
          if (!args[0]) return print('usage: touch <file>', 'err');
          if (ctx.fs.exists(args[0], state.cwd)) return print('ok (exists)', 'dim');
          ctx.fs.write(args[0], '', state.cwd);
          print(`created ${basename(ctx.fs.resolve(args[0], state.cwd))}`, 'ok');
        },
      },
      mkdir: {
        usage: 'mkdir <directory…>',
        desc: 'Create directories.',
        run: (args) => {
          if (!args.length) return print('usage: mkdir <directory…>', 'err');
          for (const a of args) { ctx.fs.mkdir(a, state.cwd); print(`created ${ctx.fs.display(ctx.fs.resolve(a, state.cwd))}`, 'ok'); }
        },
      },
      rm: {
        usage: 'rm [-r] <path…>',
        desc: 'Delete files (and folders with -r).',
        run: (args) => {
          const recursive = args.includes('-r') || args.includes('-rf') || args.includes('-fr');
          const targets = args.filter((a) => !a.startsWith('-'));
          if (!targets.length) return print('usage: rm [-r] <path…>', 'err');
          for (const t of targets) { ctx.fs.rm(t, state.cwd, recursive); print(`removed ${t}`, 'ok'); }
        },
      },
      mv: {
        usage: 'mv <from> <to>',
        desc: 'Move or rename.',
        run: (args) => {
          if (args.length < 2) return print('usage: mv <from> <to>', 'err');
          ctx.fs.mv(args[0], args[1], state.cwd);
          print(`moved ${args[0]} → ${args[1]}`, 'ok');
        },
      },
      cp: {
        usage: 'cp <from> <to>',
        desc: 'Copy a file or folder.',
        run: (args) => {
          if (args.length < 2) return print('usage: cp <from> <to>', 'err');
          ctx.fs.copy(args[0], args[1], state.cwd);
          print(`copied ${args[0]} → ${args[1]}`, 'ok');
        },
      },
      open: {
        usage: 'open <path>',
        desc: 'Open a file or folder in the right app.',
        run: (args) => {
          if (!args[0]) return print('usage: open <path>', 'err');
          ctx.openPath(args[0], state.cwd);
        },
      },
      edit: {
        usage: 'edit <file>   (alias: nano)',
        desc: 'Open a file in the Text Editor.',
        run: (args) => {
          if (!args[0]) return print('usage: edit <file>', 'err');
          ctx.launch('editor', { data: { path: ctx.fs.resolve(args[0], state.cwd) } });
        },
      },
      nano: {
        usage: 'nano <file>',
        desc: 'Open a file in the Text Editor (alias of edit).',
        run: (args) => commands.edit.run(args),
      },
      launch: {
        usage: 'launch <app>',
        desc: 'Start an application.',
        run: (args) => {
          if (!args[0]) return print('usage: launch <app>', 'err');
          ctx.launch(args[0]);
        },
      },
      apps: {
        usage: 'apps',
        desc: 'List installed applications.',
        run: () => printLines(ctx.apps.map((a) => `  ${a.id.padEnd(10)} ${a.name}`)),
      },
      theme: {
        usage: 'theme [dark|light]',
        desc: 'Show or set the colour scheme.',
        run: (args) => {
          if (!args[0]) return print(`current theme: ${ctx.theme.settings.theme}`);
          if (!['dark', 'light'].includes(args[0])) return print('theme must be dark or light', 'err');
          ctx.theme.set('theme', args[0]);
          print(`theme → ${args[0]}`, 'ok');
        },
      },
      accent: {
        usage: 'accent [name]',
        desc: 'Show or set the accent colour.',
        run: (args) => {
          const names = ctx.accents.map((a) => a.id);
          if (!args[0]) return print(`current accent: ${ctx.theme.settings.accent}\navailable: ${names.join(', ')}`);
          if (!names.includes(args[0])) return print(`unknown accent (try: ${names.join(', ')})`, 'err');
          ctx.theme.set('accent', args[0]);
          print(`accent → ${args[0]}`, 'ok');
        },
      },
      wallpaper: {
        usage: 'wallpaper [name]',
        desc: 'Show or set the wallpaper.',
        run: (args) => {
          const names = ctx.wallpapers.map((w) => w.id);
          if (!args[0]) return print(`current: ${ctx.theme.settings.wallpaper}\navailable: ${names.join(', ')}`);
          if (!names.includes(args[0])) return print(`unknown wallpaper (try: ${names.join(', ')})`, 'err');
          ctx.theme.set('wallpaper', args[0]);
          print(`wallpaper → ${args[0]}`, 'ok');
        },
      },
      date: { usage: 'date', desc: 'Print the current date and time.', run: () => print(new Date().toString()) },
      stat: {
        usage: 'stat <path>',
        desc: 'Show metadata for a file or directory.',
        run: (args) => {
          if (!args[0]) return print('usage: stat <path>', 'err');
          const info = ctx.fs.stat(args[0], state.cwd);
          if (!info) return print(`no such file: ${ctx.fs.resolve(args[0], state.cwd)}`, 'err');
          printLines([
            `  path      ${ctx.fs.display(info.path)}`,
            `  type      ${info.type}`,
            `  size      ${info.type === 'file' ? fmtBytes(info.size) : `${info.children} entries`}`,
            `  modified  ${info.modified ? info.modified.slice(0, 19).replace('T', ' ') : 'unknown'}`,
          ]);
        },
      },
      du: {
        usage: 'du [directory]',
        desc: 'Estimate the size of a directory tree.',
        run: (args) => {
          const target = ctx.fs.resolve(args[0] || '.', state.cwd);
          const node = ctx.fs.getNode(target);
          if (!node) return print(`no such path: ${target}`, 'err');
          const sizeOf = (n) => n.type === 'file'
            ? (n.content?.length ?? 0)
            : Object.values(n.children).reduce((sum, c) => sum + sizeOf(c), 0);
          const lines = [];
          const walk = (n, abs) => {
            if (n.type === 'dir') {
              for (const c of Object.values(n.children).sort((a, b) => a.name.localeCompare(b.name))) {
                walk(c, abs === '/' ? `/${c.name}` : `${abs}/${c.name}`);
              }
            }
            lines.push(`${fmtBytes(sizeOf(n)).padStart(9)}  ${ctx.fs.display(abs)}`);
          };
          walk(node, target);
          printLines(lines);
        },
      },
      df: {
        usage: 'df',
        desc: 'Show how much storage the virtual filesystem uses.',
        run: () => {
          const { files, bytes } = ctx.fs.counts();
          const stored = ctx.store.usage();
          printLines([
            'Filesystem usage',
            `  files        ${files}`,
            `  content      ${fmtBytes(bytes)}`,
            `  stored       ${fmtBytes(stored)} (${ctx.store.available ? 'localStorage' : 'in-memory — storage is blocked'})`,
            `  save errors  ${ctx.store.failures}${ctx.store.lastError ? ` — ${ctx.store.lastError}` : ''}`,
            '',
            'localStorage has a hard per-origin quota; large PNGs from Paint fill it quickly.',
          ]);
        },
      },
      whoami: { usage: 'whoami', desc: 'Print the current user.', run: () => print('user') },
      history: { usage: 'history', desc: 'Show recent commands.', run: () => printLines(state.history.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`)) },
      neofetch: {
        usage: 'neofetch',
        desc: 'Show system information.',
        run: () => {
          const mem = performance?.memory?.jsHeapSizeLimit
            ? fmtBytes(performance.memory.jsHeapSizeLimit)
            : 'n/a';
          printLines([
            '',
            '        ▄▄▄▄▄        user@browseros',
            '      ▄█████████▄     ─────────────────────',
            '     ▄████▀   ▀████▄   OS: Browser OS ' + ctx.version,
            '    ▄████▀  ▄▄  ▀████▄  Host: ' + (navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome') ? 'Safari' : 'Chromium'),
            '    ████▀   ▀▀   ▀███▌  Shell: browsersh',
            '    ▀████▄       ▄████▀  Resolution: ' + window.innerWidth + 'x' + window.innerHeight,
            '     ▀████▄   ▄████▀    Windows open: ' + ctx.wm.windows.size,
            '       ▀█████████▀      Heap limit: ' + mem,
            '         ▀▄▄▄▄▄▀▀       Theme: ' + ctx.theme.settings.theme + ' / ' + ctx.theme.settings.accent,
            '',
          ], 'neof');
        },
      },
      sudo: { usage: 'sudo <command>', desc: 'Everything here already runs as root.', run: (args) => args.length ? run(args.join(' ')) : print('sudo: you are already root here', 'dim') },
      exit: { usage: 'exit', desc: 'Close the terminal.', run: () => ctx.wm.close(win.id) },
    };

    const run = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      state.history.push(trimmed);
      state.histIndex = state.history.length;
      print(`${ctx.fs.display(state.cwd)}$ ${trimmed}`, 'acc');
      // Support simple `cmd1 && cmd2` chaining, without splitting inside quotes.
      for (const part of splitChain(trimmed)) {
        const [name, ...args] = tokenize(part);
        if (!name) continue;
        const cmd = commands[name];
        if (!cmd) { print(`command not found: ${name}  (try \`help\`)`, 'err'); return; }
        try {
          cmd.run(args);
        } catch (err) {
          print(String(err?.message || err), 'err');
          return;
        }
      }
    };

    const complete = (line) => {
      const parts = line.split(/\s+/);
      const first = parts.length === 1 && !line.includes(' ');
      if (first) {
        const matches = Object.keys(commands).filter((c) => c.startsWith(parts[0]));
        if (matches.length === 1) return matches[0] + ' ';
        if (matches.length > 1) { print(parts[0] + '\n' + matches.join('  ')); }
        return null;
      }
      const token = parts[parts.length - 1];
      const abs = ctx.fs.resolve(token || '.', state.cwd);
      const dir = token.endsWith('/') ? abs : parentDir(abs);
      const stem = token.endsWith('/') ? '' : baseName(abs);
      let entries = [];
      try { entries = ctx.fs.list(dir, state.cwd); } catch { return null; }
      const matches = entries.filter((e) => e.name.startsWith(stem)).map((e) => e.name + (e.type === 'dir' ? '/' : ''));
      if (matches.length === 1) {
        parts[parts.length - 1] = token.slice(0, token.length - stem.length) + matches[0];
        return parts.join(' ');
      }
      if (matches.length > 1) print(`${stem}\n` + matches.join('  '), 'dim');
      return null;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const line = input.value;
        input.value = '';
        run(line);
      } else if (e.key === 'ArrowUp') {
        if (!state.history.length) return;
        e.preventDefault();
        state.histIndex = Math.max(0, state.histIndex - 1);
        input.value = state.history[state.histIndex] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.histIndex = Math.min(state.history.length, state.histIndex + 1);
        input.value = state.history[state.histIndex] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const completed = complete(input.value);
        if (completed !== null) input.value = completed;
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        out.replaceChildren();
      } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        print('^C', 'dim');
        input.value = '';
        state.histIndex = state.history.length;
      }
    });

    const parentDir = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
    const baseName = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };

    /** Split a command line on `&&`, ignoring separators inside quotes. */
    const splitChain = (line) => {
      const parts = [];
      let cur = '';
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          cur += ch;
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '&' && line[i + 1] === '&') { parts.push(cur); cur = ''; i++; continue; }
        cur += ch;
      }
      parts.push(cur);
      return parts;
    };

    print(BANNER, 'dim');
    const motd = (() => { try { return ctx.fs.read('/etc/motd'); } catch { return null; } })();
    if (motd) print(motd.trim(), 'ok');
    refreshPrompt();
    setTimeout(() => input.focus(), 30);
    win.body.addEventListener('pointerdown', () => setTimeout(() => input.focus(), 0));
  },
};
