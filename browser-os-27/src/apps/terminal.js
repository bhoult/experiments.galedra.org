import { el, fmtBytes, basename, parentPath, claimFocus, VERSION } from '../core/utils.js';

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
      /* Deliberately not persisted with win.data: a restored terminal is a new shell, and a new
         shell has no `cd -` and no variables either. */
      prevCwd: null,
      /* Variables you define yourself. They live here, not in `win.data`, for the same reason as
         `prevCwd`: they are this shell's session, and a new shell should not inherit them. They
         are also *listable* (`set`), which is what makes them state you can see rather than a
         surprise — the reason they were left out for eleven iterations. */
      vars: {},
      /* Aliases live here too, for the same reason as `vars`: they are this shell's session, not
         a setting. They are kept *apart* from `commands` rather than written into it, so that
         `unalias ls` can bring the real `ls` back — an alias that overwrote the command it shadows
         could never be undone. */
      aliases: {},
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
      /* A diagnostic is a failure: it is how a stage says it did not work, and `&&` uses
         that to stop. Mid-pipe, a command's normal output is captured instead of shown. */
      if (cls === 'err') {
        stageFailed = true;
        if (errSink) { errSink.lines.push(...String(text).split('\n')); return; }
        if (mergeErrInto) { mergeErrInto.lines.push(...String(text).split('\n')); return; }
      }
      if (sink && cls !== 'err') {
        sink.lines.push(...String(text).split('\n'));
        return;
      }
      out.append(el('div', { class: cls, text: String(text) }));
      out.scrollTop = out.scrollHeight;
    };
    const printLines = (lines, cls) => lines.forEach((l) => print(l, cls));

    /* How many characters this output area can actually show on one line. The font is monospace, so
       measuring one glyph measures them all. `help` and `man` wrap to *this* number rather than to a
       width someone guessed: the default window is ~86 columns, its minimum is ~40, and a table that
       was wrapped for 86 turns back into a paragraph the moment the window is dragged narrow. */
    const termCols = () => {
      const cs = getComputedStyle(out);
      const probe = document.createElement('span');
      probe.textContent = '0123456789abcdefghij';
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;`
        + `font-style:${cs.fontStyle};font-weight:${cs.fontWeight};font-size:${cs.fontSize};font-family:${cs.fontFamily}`;
      out.append(probe);
      const glyph = probe.getBoundingClientRect().width / probe.textContent.length || 7.8;
      probe.remove();
      const inner = out.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      /* One column of slack: a line exactly as wide as the area is a line the browser will wrap for
         us, at column 0, which is the thing wrapping here exists to prevent. */
      return Math.max(24, Math.min(120, Math.floor(inner / glyph) - 1));
    };

    /* Word-wrap with a hanging indent: a continuation line goes under the column its text started
       in, not under the start of the line. Used for command tables and manual pages. */
    const wrapDoc = (prefix, text, limit = termCols()) => {
      const indent = ' '.repeat(prefix.length);
      const lines = [];
      let line = '';
      for (const word of String(text).split(/\s+/)) {
        const next = line ? `${line} ${word}` : `${prefix}${word}`;
        if (line && next.length > limit) { lines.push(line); line = `${indent}${word}`; }
        else line = next;
      }
      if (line) lines.push(line);
      return lines;
    };
    /* Wrapping a line that is already laid out (a manual page, an example indented under a heading):
       its own leading spaces are part of its meaning, and a blank line is a paragraph break. */
    const wrapPreserving = (line, limit = termCols()) => {
      if (!line.trim()) return [line];
      const lead = /^\s*/.exec(line)[0];
      return wrapDoc(lead, line.slice(lead.length), limit);
    };

    /* Pipes: everything left of `|` writes into this buffer instead of the screen. */
    let sink = null;
    /* Set while a stage has its errors redirected (`2> file`): the diagnostics go there
       instead of onto the screen, but they still count as a failure for `&&`. */
    let errSink = null;
    /* Set by `2>&1`: the stage has no separate error stream, so its diagnostics join its
       output — which means they are captured by a pipe or a `>` just like everything else. */
    let mergeErrInto = null;
    /* Set by print() when the stage currently running reports a problem. */
    let stageFailed = false;
    /* Non-zero while a `$(…)` is running: the *last* stage of the inner line is captured too,
       because there is no screen for it — its whole job is to become a word. */
    let capturing = 0;
    /* Where the last stage of a captured line writes. `execute` normally gives the last stage no
       buffer at all so it prints; `captureLine` gives it this one. It has to be a separate value
       from `sink`, or a pipeline inside `$(…)` would share one buffer between its stages and the
       substitution would collect the whole pipeline, not its result. */
    let captureSink = null;
    /* A trailing newline terminates the last line, it is not an extra empty line —
       otherwise `wc -l` counts one too many. */
    const dropTrailingBlank = (lines) => (lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines);
    const readLines = (path) => (path ? dropTrailingBlank(ctx.fs.read(path, state.cwd).split('\n')) : []);
    /* Every file the command was given. A glob turns one word into several, so a command that
     * took "the file argument" would quietly read only the first match — which is the kind of
     * half-answer that looks like a result.
     *
     * `valueFlags` is the *command's* answer to "does this flag eat the next word", not the
     * shell's. `-n` means two different things: in `head -n 5 file` it is a number, in `sort -n
     * file` it is a mode. A single global list got one of them wrong — `sort -n notes.md` read no
     * file at all, because the parser ate `notes.md` as `-n`'s value. Only the command that owns
     * the flag knows which one it is, so the list is passed in.
     */
    const fileArgs = (args, valueFlags = []) => {
      const out = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('-')) { if (valueFlags.includes(args[i])) i++; continue; }
        out.push(args[i]);
      }
      return out;
    };
    const numFlag = (args, flag, dflt) => {
      const i = args.indexOf(flag);
      if (i === -1) return dflt;
      const n = Number(args[i + 1]);
      return Number.isFinite(n) ? Math.max(0, n) : dflt;
    };

    /* A redirect target is a name, never a pattern: `echo x > docs/*.txt` creates a file called
       `*.txt`, exactly as a real shell does (bash does not glob a redirection target either).
       What it must not be is *silent* — this filesystem is one you can open in Files afterwards,
       and a file named `*.txt` is something you will have to explain to yourself. Written straight
       to the screen rather than through print(), because a note about the shell is not this
       command's output and does not belong in a pipe or a `>`. */
    /* Four levels of ink, and the difference between them is "did this fail", not "how important
       is it":
       - `err`     the command did not do what you asked, and something is wrong.
       - `ok`      the command changed something.
       - `note`    nothing failed, but you should know: a file you just made has a `*` in its name,
                   a directory was already there, a substitution matched nothing. The messages whose
                   absence would later look like a bug.
       - `dim`     help, usage, completion lists — text you asked for by asking for help.
       `note` is deliberately the *second* strongest ink rather than a new colour: the terminal has
       three inks and adding a fourth would be a fourth thing to keep readable on a canvas that is
       already its own palette.
     */
    const noteUnexpandedGlob = (target, op) => {
      if (typeof target !== 'string' || !/[*?]/.test(target)) return;
      out.append(el('div', { class: 'note', text: `note: ${op} ${target} is a name, not a pattern — the file is called exactly that` }));
    };

    const refreshPrompt = () => {
      cwdLabel.textContent = `user@browseros:${ctx.fs.display(state.cwd)}$`;
      win.setTitle(`Terminal — ${ctx.fs.display(state.cwd)}`);
    };

    /* Tokens keep *which parts* were quoted, not just whether the whole word was. That is what
       makes `DOCS="my notes"` one word with a space in it while `echo $NOPE` still refuses to
       expand, and it is the same rule a real shell uses: quoting is a property of a fragment, and
       only unquoted fragments get expanded or globbed. */
    const tokenize = (line) => {
      const tokens = [];
      let cur = null;
      /* A `$(…)` is part of the word it starts in, spaces and all. Tokenizing first and
         substituting later would turn `echo $(echo hi)` into the two words `$(echo` and `hi)`,
         which is the same mistake a shell makes when it splits a quoted string in the wrong
         place — and the fix is the same one: finish the construct before looking for a space. */
      let sub = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (sub) {
          if (ch === '(') sub++;
          else if (ch === ')') sub--;
          cur.parts.push({ text: ch, quoted: false });
          continue;
        }
        if (/\s/.test(ch)) { if (cur) tokens.push(cur); cur = null; continue; }
        cur = cur || { parts: [] };
        if (ch === '"' || ch === "'") {
          const quote = ch;
          let j = i + 1;
          let part = '';
          while (j < line.length && line[j] !== quote) { part += line[j]; j++; }
          cur.parts.push({ text: part, quoted: true });
          i = j;
          continue;
        }
        if (ch === '$' && line[i + 1] === '(') { sub = 1; cur.parts.push({ text: '$(', quoted: false }); i++; continue; }
        cur.parts.push({ text: ch, quoted: false });
      }
      if (cur) tokens.push(cur);
      return tokens.map((t) => ({
        parts: mergeParts(t.parts),
        get text() { return this.parts.map((p) => p.text).join(''); },
        get quoted() { return this.parts.every((p) => p.quoted); },
      }));
    };
    const mergeParts = (parts) => {
      const out = [];
      for (const p of parts) {
        const last = out[out.length - 1];
        if (last && last.quoted === p.quoted) last.text += p.text;
        else out.push({ ...p });
      }
      return out;
    };

    /* The built-in variables describe where you are right now; the user's own live in
       `state.vars` and are listed by `set`. A built-in always wins, so `HOME=/tmp` cannot make
       `cd ~` stop meaning home — and the assignment is refused rather than silently ignored. */
    const BUILTINS = ['HOME', 'PWD', 'USER', 'OLDPWD'];
    const shellVars = () => ({
      HOME: ctx.fs.home, PWD: state.cwd, USER: 'user',
      ...(state.prevCwd ? { OLDPWD: state.prevCwd } : {}),
      ...state.vars,
    });
    /* `$(command)` runs the command and puts its output where you typed it. It is expanded in
       unquoted parts only, for the same reason `$NAME` is: in this shell a quoted word is a word
       you asked for literally, in both quote styles. An unquoted result *is* word-split, which is
       what makes `wc -l $(echo a.txt b.txt)` two file arguments rather than one with a space in
       it — the output of a command is a list, where the value of a variable is one value. */
    let substDepth = 0;
    const substitute = (text) => {
      if (!text.includes('$(')) return text;
      /* A shell that recurses forever is a hung tab. The limit is generous; the point is that
         there is a number, and that hitting it says so instead of freezing. */
      if (substDepth >= 6) { print('command substitution nested too deeply', 'err'); return ''; }
      let out = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '$' && text[i + 1] === '(') {
          let depth = 1; let j = i + 2; let inner = '';
          while (j < text.length) {
            const ch = text[j];
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (!depth) break; }
            inner += ch; j++;
          }
          if (depth) { print(`unbalanced $( in: ${text}`, 'err'); return out; }
          substDepth++;
          try { out += captureLine(inner); } finally { substDepth--; }
          i = j;
          continue;
        }
        out += text[i];
      }
      return out;
    };

    const expandParts = (token) => {
      const vars = shellVars();
      let text = token.parts
        .map((p) => (p.quoted ? p.text : substitute(p.text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name) => vars[name] ?? whole))))
        .join('');
      /* `~` stands for home only when it is the whole word and nothing in it was quoted. */
      if (!token.parts.some((p) => p.quoted) && (text === '~' || text.startsWith('~/'))) text = ctx.fs.resolve(text, state.cwd);
      return text;
    };
    const expandWord = (token) => expandParts(token);
    const hasSubstitution = (token) => token.parts.some((p) => !p.quoted && p.text.includes('$('));
    /* `NAME=value` is an assignment, not a command. The `=` has to be in an unquoted part and
       the name has to be a plain identifier, which is what keeps `echo a=b` printing `a=b` while
       `FOO="a b"` still defines one variable holding `a b`. */
    const assignmentOf = (token) => {
      for (let i = 0; i < token.parts.length; i++) {
        const p = token.parts[i];
        if (p.quoted) continue;
        const at = p.text.indexOf('=');
        if (at === -1) continue;
        const name = token.parts.slice(0, i).map((q) => q.text).join('') + p.text.slice(0, at);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
        return { name, value: expandWord({ parts: [{ text: p.text.slice(at + 1), quoted: false }, ...token.parts.slice(i + 1)] }) };
      }
      return null;
    };
    const defineVar = (name, value) => {
      if (BUILTINS.includes(name)) { print(`${name} is set by the shell and cannot be assigned`, 'err'); return false; }
      state.vars[name] = value;
      return true;
    };

    /* Aliases. They are the one expansion that cannot happen in `expandParts`, because by the
       time a word has been turned into text it has already been decided what the word *is* — and
       an alias is not a value, it is a command line that stands in for a word. So an alias is
       expanded on the *token list*, on the command word only, before variables or globs are
       touched: `alias ll='ls -l'` turns one token into two, and the second one is then expanded
       like any other argument.
       Two rules come from that placement and both are the shell's rules, not accidents:
       - the body is stored exactly as typed, with no variable expansion, because `alias G='echo $USER'`
         has to keep `$USER` until the day you type `G`;
       - a *quoted* command word is not an alias (`"ll"` is a word you asked for literally), which
         is the same rule that stops `$NAME` and `*.txt`.
     */
    const ALIAS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
    /* `alias ll='ls -l'` is an assignment-shaped word, but it is an *argument* to `alias`, not a
       variable assignment — which is why `assignmentOf` is not used here: it would expand the
       value, and an alias body must not be expanded when it is defined. */
    const aliasDefOf = (token) => {
      for (let i = 0; i < token.parts.length; i++) {
        const p = token.parts[i];
        if (p.quoted) continue;
        const at = p.text.indexOf('=');
        if (at === -1) continue;
        const name = token.parts.slice(0, i).map((q) => q.text).join('') + p.text.slice(0, at);
        if (!ALIAS_NAME.test(name)) return null;
        return { name, rest: [p.text.slice(at + 1), ...token.parts.slice(i + 1).map((q) => q.text)].join(' ') };
      }
      return null;
    };
    const printAlias = (name) => {
      if (!(name in state.aliases)) { print(`alias: no alias defined for ${name}`, 'err'); return false; }
      print(`alias ${name}='${state.aliases[name]}'`, 'ok');
      return true;
    };
    const listAliases = () => {
      const names = Object.keys(state.aliases).sort();
      if (!names.length) return print('no aliases defined yet — `alias ll=\'ls -l\'` defines one, `unalias ll` removes one', 'dim');
      names.forEach((n) => print(`alias ${n}='${state.aliases[n]}'`));
      print(`${names.length} alias(es) in this shell. They are expanded when the command is typed, not when they are defined.`, 'dim');
    };
    /* Aliases are expanded on the *line*, before it is split into commands. That is what a shell
       does, and it is the difference between an alias standing for a few words and an alias standing
       for a command line: expanded after the split, `alias docs='cd ~/Documents && ls'` would hand
       `&&` and `ls` to `cd` as arguments. Expanded before it, the body's `&&`, `|` and `;` are
       operators again, and `echo hi | upper` still works because the body is spliced in where the
       name was.
       The scanner follows the same rules the rest of the shell does: a quoted word is never a name,
       a `$(…)` is one word (its inside is a command line too, so it is expanded as well), and an
       operator ends a word. `expanding` is the loop guard: `alias ls='ls -l'` must expand once and
       then run the real `ls`, which is exactly what a real shell does with that alias. */
    const closeOf = (line, open) => {
      let depth = 0;
      for (let i = open; i < line.length; i++) {
        if (line[i] === '(') depth++;
        else if (line[i] === ')') { depth--; if (!depth) return i; }
      }
      return -1;
    };
    const expandAliasText = (line, expanding = new Set()) => {
      let out = '';
      let i = 0;
      /* "command position" = the word a command would be. Start of the line, after `;` `&&` `||`
         `|` or `(`, and after a leading `NAME=value`, which is an assignment and not a command. */
      let atCmd = true;
      while (i < line.length) {
        const ch = line[i];
        if (/\s/.test(ch)) { out += ch; i++; continue; }
        if (ch === '"' || ch === "'") {
          const quote = ch;
          let j = i + 1;
          while (j < line.length && line[j] !== quote) j++;
          out += line.slice(i, Math.min(j + 1, line.length));
          i = j + 1;
          atCmd = false;
          continue;
        }
        if (ch === '$' && line[i + 1] === '(') {
          const end = closeOf(line, i + 1);
          if (end < 0) { out += line.slice(i); break; }
          out += `$(${expandAliasText(line.slice(i + 2, end), expanding)})`;
          i = end + 1;
          atCmd = true;
          continue;
        }
        if (ch === ';' || ch === '|' || ch === '&') {
          const next = line[i + 1];
          if (next === ch || (ch === '&' && next === '>')) { out += ch + next; i += 2; }
          else { out += ch; i++; }
          atCmd = true;
          continue;
        }
        if (ch === '>' || ch === '<') {
          /* Redirect operators are copied through untouched — this pass only inserts alias bodies,
             and it must reproduce everything else exactly. `2>&1`, `>>` and `&>` are two characters. */
          const next = line[i + 1];
          if (next === ch || next === '&') { out += ch + next; i += 2; }
          else { out += ch; i++; }
          atCmd = true;
          continue;
        }
        let j = i;
        while (j < line.length && !/[\s"'|&;<>]/.test(line[j])) j++;
        if (j === i) { out += ch; i++; continue; }   // never stuck on a character it does not know
        const word = line.slice(i, j);
        if (atCmd && word in state.aliases && !expanding.has(word)) {
          out += expandAliasText(state.aliases[word], new Set([...expanding, word]));
        } else {
          out += word;
        }
        /* `FOO=x cmd` — the assignment is not the command, so `cmd` is still in command position. */
        atCmd = /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
        i = j;
      }
      return out;
    };

    /* Globs. A word containing `*`, `?` or `[...]` is a pattern, not a name: it is matched
       against the directory it points at and becomes every name it matches, in the order `ls`
       would show them. Two rules keep it safe rather than surprising:
       - quoting stops it, exactly like `$HOME` does: `echo "*.txt"` prints `*.txt`;
       - a pattern that matches nothing is left exactly as written, so `cat *.nope` reports
         "no such file: *.nope" instead of quietly expanding to nothing and waiting. */
    const globRe = (pattern) => new RegExp('^' + [...pattern].map((ch) => {
      if (ch === '*') return '[^/]*';
      if (ch === '?') return '[^/]';
      if (ch === '[') return '[';
      if (ch === ']') return ']';
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('') + '$');
    const expandGlob = (text) => {
      if (!/[*?[]/.test(text)) return [text];
      const slash = text.lastIndexOf('/');
      const dirText = slash === -1 ? '.' : text.slice(0, slash);
      const pattern = slash === -1 ? text : text.slice(slash + 1);
      const dir = ctx.fs.resolve(dirText, state.cwd);
      let entries;
      try { entries = ctx.fs.list(dir, state.cwd); } catch { return [text]; }
      const re = (() => { try { return globRe(pattern); } catch { return null; } })();
      if (!re) return [text];   // an unbalanced `[` is a name with a bracket in it, not a pattern
      const hits = entries.filter((e) => re.test(e.name));
      if (!hits.length) return [text];
      const prefix = dirText === '.' ? '' : dirText.endsWith('/') ? dirText : `${dirText}/`;
      return hits.map((e) => prefix + e.name + (e.type === 'dir' ? '/' : ''));
    };
    /* The order an argument list is built in: expand variables, then glob what they produced
       (`ls $DOCS/*` works), and never glob a fragment the user quoted. */
    const expandArgs = (tokens) => tokens.flatMap((t) => {
      const text = expandWord(t);
      if (t.parts.some((p) => p.quoted)) return [text];
      /* Only a substitution is split on whitespace. `$NAME` is one word even when its value has
         a space in it — `DOCS="my notes"; ls $DOCS` is one path, which is why quoting exists —
         but the output of a command is a *list*, and `wc -l $(echo a.txt b.txt)` is meant to be
         two files. Globbing runs afterwards, so a substituted name can still be a pattern. */
      if (!hasSubstitution(t)) return expandGlob(text);
      return text.split(/\s+/).filter(Boolean).flatMap(expandGlob);
    });

    /* Not commands, but worth a manual page: the two rules that belong to the shell rather than
       to any one command. `man` looks here after it has looked at the commands, so `man variables`
       reads like any other entry without putting a fake command in `help`'s list. */
    const TOPICS = {
      variables: [
        'Variables',
        '  NAME=value          define one for the rest of this shell (no spaces around the =)',
        '  export NAME=value   the same thing; there is no child process to pass it to',
        '  set                 list the ones you defined',
        '  unset NAME          remove one',
        '',
        '  $NAME expands anywhere a word is read — an argument, a path, a redirect target.',
        '  Quoting stops it: `echo "$HOME"` prints $HOME, `echo "$NOPE"` prints $NOPE.',
        '  An unknown name is left exactly as typed, because a blank is how a typo gets lost.',
        '  $HOME, $PWD, $USER and $OLDPWD are set by the shell and cannot be assigned.',
        '  Tab completes your own variables as well as the built-ins.',
        '  `~/.shellrc` is the file a terminal reads when it opens, which is where a variable',
        '  you want in *every* shell belongs. `man startup`.',
      ],
      substitution: [
        'Command substitution',
        '  $(command)  run a command and put its output where you typed it',
        '',
        '  ls $(pwd)              expand a path by asking for it',
        '  echo $(date)           print what another command produced',
        '  wc -l $(echo a.txt b)  an unquoted result is split into separate arguments',
        '  FOO=$(pwd)             an assignment may be the output of a command',
        '  echo hi > $(echo /tmp/f.txt)   a redirect target may be one too',
        '  ls $(pwd) | head       the inner command is a whole command: pipes, redirects, &&',
        '',
        '  The command runs in this shell: it sees your variables, your current directory, your',
        '  pipes and your redirects. Its own errors go to the screen, not into the',
        '  substitution — only its output is captured, which is what `$(cat missing.txt)`',
        '  expanding to nothing while still telling you the file is missing means.',
        '  A substitution that produces nothing produces nothing: `echo a $(true) b` is `echo a b`.',
        '  Nesting is allowed up to six deep; deeper than that is a mistake and says so.',
        '  Quoting stops it, exactly as it stops $NAME: `echo "$(date)"` prints $(date).',
        '  Not supported: backticks, and a quoted `)` inside $( ) — the quotes are gone by the',
        '  time the matching runs, so `$(echo "a)b")` closes early.',
      ],
      pipes: [
        'Pipes, redirects and chaining',
        '  a | b        feed a’s output into b            ls | grep notes',
        '  a > file     write a’s output to a file        ls -l > listing.txt',
        '  a >> file    append to it instead              wc -l notes.md >> count.txt',
        '  a < file     fill a’s input from a file        wc -l < notes.md',
        '  a 2> file    send a’s *errors* there instead of to the screen',
        '  a 2>> file   append those errors',
        '  a 2>&1       errors go where the output goes, so a pipe or a > sees them too',
        '  a &> file    both streams into one file',
        '',
        '  Only a command that reads the pipe may sit on the right of a | :',
        '  cat grep head tail wc sort uniq sed tr echo. One that cannot says so rather than',
        '  ignoring the pipe you built.',
        '  A redirect target is a name, never a pattern: `echo x > docs/*.txt` makes a file',
        '  called *.txt, and the shell tells you it did.',
        '',
        '  a && b       run b only if a worked',
        '  a || b       run b only if a did not',
        '  a ; b        run b whatever a did',
        '  A failed stage stops its own `&&` chain, and the diagnostics it printed are what',
        '  “failed” means. `true` and `false` are how you choose a branch on purpose.',
        '  `;` groups are independent; `&&` and `||` are one chain, and the chain breaks at the',
        '  first link that did not hold.',
      ],
      startup: [
        'Startup: ~/.shellrc and source',
        '  ~/.shellrc       the commands a terminal runs when it opens',
        '  source <file…>   run the commands in a file in this shell, right now',
        '',
        '  Every line of the file is a command line, run in the shell that is about to hand you',
        '  the prompt. Assignments and aliases are what belongs there; anything else runs too,',
        '  because it is a command line. `#` starts a comment and a blank line is nothing.',
        '  Edit it with `edit ~/.shellrc` (or in Files), then `source ~/.shellrc` to read it',
        '  again without opening a new terminal.',
        '  A line that fails is reported and the next line still runs. A file that sources',
        '  itself is refused instead of hanging the tab.',
        '',
        '  This is the one place where a *file* changes what the shell means, so it is the one',
        '  place with rules about it: the file lives in your home folder where `ls` can see it,',
        '  the shell says out loud that it read it and what that gave it, it is never created',
        '  for you, and everything it defined is still undoable with `unset` / `unalias` for as',
        '  long as that shell is open.',
      ],
      aliases: [
        'Aliases',
        '  alias name=command   give a name to a command line',
        '  alias                list the ones you defined',
        '  alias name           show one',
        '  unalias name         remove one',
        '',
        '  alias ll=\'ls -l\'          then `ll Documents` is `ls -l Documents`',
        '  alias ll=ls -l            the same thing: the body is everything that follows',
        '  alias go=\'cd ~/Documents && ls\'   an alias body is a whole command line',
        '  alias ls=\'ls -l\'          an alias may shadow a command, and `unalias ls` undoes it',
        '',
        '  The body is kept exactly as you typed it. Variables, globs and `$(…)` inside it are',
        '  expanded when the alias is *used*, not when it is defined — `alias G=\'echo $USER\'`',
        '  prints whatever $USER means on the day you type `G`.',
        '  The body is put in place of the name before the line is split into commands, so the',
        '  operators in it are operators: `alias go=\'cd ~/Documents && ls\'` chains, and an alias',
        '  whose body is a filter works at the end of a pipe you typed.',
        '  Only the first word of a command is looked up, and only when it is not quoted:',
        '  `"ll"` is a word you asked for literally, so it is not found.',
        '  An alias expands in this shell only — it is not passed to anything, because there is',
        '  nothing else to pass it to. Like variables, it lives in this terminal window and a new',
        '  one starts with none — *except* the ones `~/.shellrc` defines, which every new shell',
        '  reads for itself. `man startup`.',
        '  An alias that expands to itself stops after one expansion: `alias ls=\'ls -l\'` runs the',
        '  real `ls` with `-l`, it does not loop.',
      ],
      globs: [
        'Globs',
        '  *  matches any run of characters in a name    ls ~/Downloads/*',
        '  ?  matches exactly one character              cat notes?.md',
        '  [abc] matches one of them                     ls log[0-9]*',
        '',
        '  A pattern is matched against the directory it points at and becomes every name it',
        '  matches, in the order ls would show them. Directories come with a trailing /.',
        '  Quoting stops it: `echo "*.txt"` prints *.txt.',
        '  A pattern that matches nothing is left as written, so the command can say so.',
        '  A redirect target is a name, never a pattern: `echo x > *.txt` creates a file called',
        '  *.txt, and the shell says so rather than letting you find it in Files later.',
      ],
    };

    /* Several names, the last one a directory: `mv *.txt docs/`. The destination is checked once,
       up front, so a typo there does not move three files and then fail on the fourth. */
    const moveMany = (args, name, act) => {
      const dest = args[args.length - 1];
      const destAbs = ctx.fs.resolve(dest, state.cwd);
      const node = ctx.fs.getNode(destAbs);
      if (node?.type !== 'dir') return print(`${name}: target is not a directory: ${destAbs}`, 'err');
      for (const from of args.slice(0, -1)) {
        const srcAbs = ctx.fs.resolve(from, state.cwd);
        if (!node || !ctx.fs.getNode(srcAbs)) { print(`${name}: no such file: ${srcAbs}`, 'err'); continue; }
        /* Moving `docs/a.txt` into `docs/` is not a move, and moving `docs` into `docs/x` is not
           either. Saying so is better than fs quietly returning "done" — but `manyfiles/out/a.txt`
           into `manyfiles/` *is* one, so the test is "is it already in that exact folder", not
           "is it anywhere below it". */
        if (srcAbs === destAbs || parentPath(srcAbs) === destAbs) { print(`${name}: ${from} is already in ${destAbs}`, 'err'); continue; }
        act(from, destAbs);
        print(`${name === 'mv' ? 'moved' : 'copied'} ${from} → ${ctx.fs.display(`${destAbs}/${basename(srcAbs)}`)}`, 'ok');
      }
    };

    /* Two tables `help` is built from, and they exist so that `help` can be *shaped* rather than
       long. Every command is filed under one group; anything a future command forgets to file lands
       in `UNGROUPED`, which `help` prints under a label that says what it is, and which
       tests/browser/terminal.test.mjs refuses. Same for the feature index: it is an index, and the
       page it points at is the thing that explains the feature. */
    const COMMAND_GROUPS = [
      { label: 'Files', names: ['cd', 'ls', 'tree', 'cat', 'touch', 'mkdir', 'rm', 'mv', 'cp', 'stat', 'du', 'df'] },
      { label: 'Text', names: ['echo', 'grep', 'head', 'tail', 'wc', 'sort', 'uniq', 'sed', 'tr'] },
      { label: 'Shell', names: ['help', 'man', 'clear', 'pwd', 'set', 'unset', 'export', 'alias', 'unalias', 'source', 'history', 'exit', 'sudo', 'true', 'false'] },
      { label: 'Apps & desktop', names: ['open', 'edit', 'nano', 'launch', 'apps', 'theme', 'accent', 'wallpaper'] },
      { label: 'System', names: ['date', 'whoami', 'neofetch'] },
    ];
    const UNGROUPED = { label: 'Ungrouped (a command nobody filed)' };

    const SHELL_FEATURES = [
      ['variables', 'NAME=value defines one; $HOME $PWD $USER $OLDPWD and ~ expand', 'man variables'],
      ['globs', '* ? [abc] match names in a word you did not quote', 'man globs'],
      ['substitution', '$(command) runs it and puts its output in that place', 'man substitution'],
      ['aliases', "alias ll='ls -l' names a command line; unalias takes it back", 'man aliases'],
      ['pipes & redirects', '| > >> < 2> 2>&1 &> move a command’s output around', 'man pipes'],
      ['chaining', '&& stops at the first failure, || runs only then, ; runs anyway', 'man pipes'],
      ['startup file', '~/.shellrc runs when a terminal opens; source <file> runs one now', 'man startup'],
      ['filters', "sed 's/find/replace/g', sed '/find/d', tr a-z A-Z edit the lines in a pipe", 'man sed, man tr'],
    ];

    const commands = {
      help: {
        usage: 'help',
        desc: 'List the commands, and the shell features that are not commands.',
        run: () => {
          /* `help` used to be the command list followed by eleven paragraphs, and the paragraphs
             were a manual crammed into a screen: the longer the shell got, the more it read as a
             wall to scroll past. The list is the part anyone uses, so it is grouped by what the
             commands are *for*; the features get one line each and a pointer to the page that
             explains them. Nothing was removed — it moved to `man`, which is where a description
             that has to stay true to a command belongs. */
          const names = Object.keys(commands);
          const width = Math.max(...names.map((n) => n.length));
          /* A description that runs past the window wraps to column 0, which is how a table turns
             into a paragraph. Wrapping here keeps the continuation under the description column it
             belongs to — at the width this window actually has. */
          const limit = termCols();
          const groupOf = new Map();
          for (const g of COMMAND_GROUPS) for (const n of g.names) groupOf.set(n, g);
          const buckets = new Map();
          for (const name of names) {
            const g = groupOf.get(name) || UNGROUPED;
            if (!buckets.has(g)) buckets.set(g, []);
            buckets.get(g).push(name);
          }
          print('Commands:', 'acc');
          for (const g of [...COMMAND_GROUPS, UNGROUPED]) {
            const list = buckets.get(g);
            if (!list?.length) continue;
            print(`  ${g.label}`, 'acc');
            printLines(list.sort().flatMap((n) => wrapDoc(`    ${n.padEnd(width)} `, commands[n].desc, limit)));
          }
          const fw = Math.max(...SHELL_FEATURES.map(([n]) => n.length));
          printLines(wrapDoc('', 'The shell itself — one line each; `man <topic>` is the page that explains it:'), 'acc');
          printLines(SHELL_FEATURES.flatMap(([name, line, pointer]) => wrapDoc(`  ${name.padEnd(fw)}  `, `${line}   (${pointer})`, limit)));
          printLines(wrapDoc('', 'Tip: Tab completes commands, aliases, variables and paths, ↑/↓ walks history, Ctrl+R searches it.'), 'dim');
          printLines(wrapDoc('', 'Not supported: background jobs.'), 'dim');
        },
      },
      man: {
        usage: `man <command | ${Object.keys(TOPICS).join(' | ')}>`,
        desc: 'Show usage for a command, or a page about a shell feature (no argument lists the pages).',
        run: (args) => {
          /* `man` with nothing after it used to answer "no manual entry for undefined", which is
             the shell not knowing what it was asked. An index is the useful answer — and it is
             generated from the topic table rather than typed out next to it, because a list written
             twice is a list that drifts. */
          if (!args[0]) {
            const topics = Object.keys(TOPICS);
            print(`man <command | ${topics.join(' | ')}>`);
            print('  help lists the commands; man explains one of them, or one of the shell’s own', 'dim');
            print(`  topics: ${topics.join(', ')}.`, 'dim');
            return;
          }
          const c = commands[args[0]];
          if (c) {
            print(`${args[0]} — ${c.desc}`);
            print(`usage: ${c.usage}`, 'dim');
            return;
          }
          const topic = TOPICS[args[0]];
          /* A manual page is written at a fixed width and the window is not. Wrapping it here keeps
             its indented examples indented when the terminal is narrow. */
          if (topic) { printLines(topic.flatMap((l) => wrapPreserving(l))); return; }
          print(`no manual entry for "${args[0]}"`, 'err');
        },
      },
      clear: { usage: 'clear', desc: 'Clear the screen.', run: () => out.replaceChildren() },
      pwd: { usage: 'pwd', desc: 'Print the working directory.', run: () => print(state.cwd) },
      set: {
        usage: 'set',
        desc: 'List the variables you have defined.',
        run: () => {
          const names = Object.keys(state.vars).sort();
          if (!names.length) return print('no variables defined yet — `NAME=value` defines one, `unset NAME` removes one', 'dim');
          printLines(names.map((n) => `  ${n}=${JSON.stringify(state.vars[n])}`));
          print(`${names.length} variable(s) in this shell. Built-ins ($HOME, $PWD, $USER, $OLDPWD) are not listed; they cannot be assigned.`, 'dim');
        },
      },
      unset: {
        usage: 'unset <name…>',
        desc: 'Remove a variable you defined.',
        run: (args) => {
          if (!args[0]) return print('usage: unset <name…>', 'err');
          for (const name of args) {
            if (BUILTINS.includes(name)) { print(`unset: ${name} is set by the shell, not by you`, 'err'); continue; }
            if (!(name in state.vars)) { print(`unset: no such variable: ${name}`, 'err'); continue; }
            delete state.vars[name];
            print(`unset ${name}`, 'ok');
          }
        },
      },
      export: {
        usage: 'export <name>=<value>…',
        desc: 'Define a variable (the same as `NAME=value`; there is no child process to pass it to).',
        /* Takes the words as typed, because `export FOO="a b"` is one assignment with a space in
           it — re-reading it as already-split arguments would turn it into two. */
        rawArgs: true,
        run: (tokens) => {
          if (!tokens.length) return commands.set.run([]);
          for (const t of tokens) {
            const a = assignmentOf(t);
            if (!a) { print(`export: not a variable assignment: ${t.text}`, 'err'); continue; }
            defineVar(a.name, a.value);
          }
        },
      },
      alias: {
        usage: 'alias [name=<command line>…]   (see also: unalias)',
        desc: 'Give a name to a command line, or list the names you have defined.',
        /* The words as typed, for the same reason `export` takes them that way: `alias ll='ls -l'`
           is one argument with a space in it, and re-reading it as split words would turn it into
           two definitions. */
        rawArgs: true,
        run: (tokens) => {
          if (!tokens.length) return listAliases();
          for (let i = 0; i < tokens.length; i++) {
            const def = aliasDefOf(tokens[i]);
            if (!def) {
              /* A bare name is a question, not a definition: `alias ll` shows `ll`. */
              if (ALIAS_NAME.test(tokens[i].text)) printAlias(tokens[i].text);
              else print(`alias: not a name=<command> pair: ${tokens[i].text}`, 'err');
              continue;
            }
            /* `alias go=cd ~/Documents && ls` is one body spread over several words. Everything
               that follows and is not itself a definition belongs to it. */
            const body = [def.rest];
            while (i + 1 < tokens.length && !aliasDefOf(tokens[i + 1])) body.push(tokens[++i].text);
            state.aliases[def.name] = body.join(' ').trim();
            print(`alias ${def.name}='${state.aliases[def.name]}'`, 'ok');
            if (commands[def.name]) print(`note: ${def.name} already means something — the alias is used instead, until \`unalias ${def.name}\``, 'note');
          }
        },
      },
      unalias: {
        usage: 'unalias <name…>',
        desc: 'Remove an alias you defined.',
        run: (args) => {
          if (!args[0]) return print('usage: unalias <name…>', 'err');
          for (const name of args) {
            if (!(name in state.aliases)) { print(`unalias: no alias defined for ${name}`, 'err'); continue; }
            delete state.aliases[name];
            print(`unalias ${name}${commands[name] ? ` (${name} is the command again)` : ''}`, 'ok');
          }
        },
      },
      source: {
        usage: 'source <file…>',
        desc: 'Run the commands in a file in this shell (`~/.shellrc` is the one a terminal reads by itself).',
        run: (args) => {
          if (!args.length) return print('usage: source <file…>   (~/.shellrc is the file a terminal reads when it opens)', 'err');
          for (const file of args) {
            const r = runScript(file, 'source');
            if (!r) continue;
            print(`source: ran ${r.ran} line(s) from ${ctx.fs.display(ctx.fs.resolve(file, state.cwd))}`, 'ok');
            /* A file that half-worked has to say so: the point of `source` is that the shell is now
               what the file says it is, and “it ran” is not the same claim. */
            if (r.failed) print(`source: ${r.failed} of ${r.ran} line(s) failed`, 'err');
          }
        },
      },
      cd: {
        usage: 'cd [directory | -]',
        desc: 'Change directory (no argument goes home, `-` goes back).',
        run: (args) => {
          /* More than one argument is an error rather than "the first one", because a glob can
             turn `cd docs/*` into four directories, and ending up in whichever one sorted first
             is a decision the shell made silently on your behalf. */
          if (args.length > 1) return print(`cd: too many arguments (${args.length} directories given, cd takes one)`, 'err');
          /* `cd -` is the one shell habit people reach for without thinking, and it is the
             only one that needs memory the shell already has: the directory it just left. */
          const want = args[0] === '-' ? state.prevCwd : (args[0] || '~');
          if (args[0] === '-' && !want) return print('cd: no previous directory to go back to', 'err');
          const from = state.cwd;
          const target = ctx.fs.resolve(want, state.cwd);
          const node = ctx.fs.getNode(target);
          if (!node) return print(`cd: no such directory: ${target}`, 'err');
          if (node.type !== 'dir') return print(`cd: not a directory: ${target}`, 'err');
          state.prevCwd = from;
          state.cwd = target;
          refreshPrompt();
        },
      },
      ls: {
        usage: 'ls [-l] [directory…]',
        desc: 'List directory contents (or the names you pass).',
        run: (args) => {
          const flags = args.filter((a) => a.startsWith('-'));
          const targets = fileArgs(args);
          /* One target or several: a glob turns `ls *.txt` into a list of names, and a list of
             names is not "the first one, silently". A file is shown as itself, which is what
             `ls somefile` means in a real shell. */
          for (const raw of targets.length ? targets : ['.']) {
            const target = ctx.fs.resolve(raw, state.cwd);
            const node = ctx.fs.getNode(target);
            if (!node) { print(`ls: no such directory: ${target}`, 'err'); continue; }
            const entries = node.type === 'dir'
              ? ctx.fs.list(target, state.cwd)
              : [{ name: node.name, type: 'file', size: node.content?.length ?? 0, modified: node.modified || null }];
            if (!entries.length) { print('(empty)', 'dim'); continue; }
            if (flags.includes('-l')) {
              printLines(entries.map((e) =>
                `${e.type === 'dir' ? 'd' : '-'}  ${(fmtBytes(e.size)).padStart(9)}  ${(e.modified || '').slice(0, 16).replace('T', ' ')}  ${e.name}${e.type === 'dir' ? '/' : ''}`));
            } else {
              printLines(entries.map((e) => `${e.name}${e.type === 'dir' ? '/' : ''}`));
            }
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
        desc: 'Print file contents (or piped input).',
        filter: true,
        run: (args, stdin) => {
          if (stdin) return printLines(stdin);
          if (!args.length) return print('usage: cat <file…>', 'err');
          for (const a of args) print(ctx.fs.read(a, state.cwd));
        },
      },
      /* The filters are the only commands that read a pipe. Each also works on a file
         argument, so `wc -l notes.md` needs no pipe at all. */
      grep: {
        usage: 'grep [-n] <pattern> [file…]',
        desc: 'Keep only the lines matching a pattern (case-insensitive). -n numbers them.',
        filter: true,
        run: (args, stdin) => {
          /* `-n` is the one flag people type out of habit here, so it is honoured rather
             than silently treated as the pattern — which is what made `grep -n x file`
             fail with "no such file: x". */
          const flags = args.filter((a) => a.startsWith('-'));
          const words = args.filter((a) => !a.startsWith('-'));
          const unknown = flags.find((f) => f !== '-n');
          if (unknown) return print(`grep: unknown option ${unknown}`, 'err');
          const numbered = flags.includes('-n');
          const pattern = words[0];
          if (!pattern) return print('usage: grep [-n] <pattern> [file…]', 'err');
          let test;
          try {
            const re = new RegExp(pattern, 'i');
            test = (line) => re.test(line);
          } catch {
            test = (line) => line.toLowerCase().includes(pattern.toLowerCase());
          }
          const files = stdin ? [] : words.slice(1);
          if (!stdin && !files.length) return print('usage: grep [-n] <pattern> <file…>  (or pipe something in)', 'err');
          /* Each line keeps the file it came from. `grep note *.md` is the one multi-file command
             where the answer is unreadable without it: three matching lines from three files look
             like three lines from one. Line numbers are per file, as real grep numbers them. */
          const source = stdin
            ? stdin.map((line, i) => ({ line, file: null, no: i + 1 }))
            : files.flatMap((f) => readLines(f).map((line, i) => ({ line, file: f, no: i + 1 })));
          const nameFiles = files.length > 1;
          const hits = [];
          source.forEach((s) => {
            if (!test(s.line)) return;
            hits.push(`${s.file && nameFiles ? `${s.file}:` : ''}${numbered ? `${s.no}: ` : ''}${s.line}`);
          });
          if (!hits.length) {
            /* grep exits 1 when nothing matched, and that is the whole point of
               `grep x && echo found`: the chain has to stop here. */
            stageFailed = true;
            return print(`no lines match "${pattern}" (${source.length} looked at)`, 'note');
          }
          printLines(hits);
        },
      },
      head: {
        usage: 'head [-n <lines>] [file…]',
        desc: 'Print the first lines (10 by default).',
        filter: true,
        run: (args, stdin) => {
          const n = numFlag(args, '-n', 10);
          const files = fileArgs(args, ['-n']);
          if (stdin || !files.length) return printLines((stdin ?? []).slice(0, n));
          /* More than one file has to say which line came from which, or the output is a
             merged pile nobody can read. Same as real head. */
          for (const f of files) { if (files.length > 1) print(`==> ${f} <==`); printLines(readLines(f).slice(0, n)); }
        },
      },
      tail: {
        usage: 'tail [-n <lines>] [file…]',
        desc: 'Print the last lines (10 by default).',
        filter: true,
        run: (args, stdin) => {
          const n = numFlag(args, '-n', 10);
          const files = fileArgs(args, ['-n']);
          if (stdin || !files.length) {
            const lines = stdin ?? [];
            return printLines(lines.slice(Math.max(0, lines.length - n)));
          }
          for (const f of files) {
            const lines = readLines(f);
            if (files.length > 1) print(`==> ${f} <==`);
            printLines(lines.slice(Math.max(0, lines.length - n)));
          }
        },
      },
      wc: {
        usage: 'wc [-l] [-w] [-c] [file…]',
        desc: 'Count lines, words and bytes.',
        filter: true,
        run: (args, stdin) => {
          const flags = args.filter((a) => a.startsWith('-'));
          const all = !flags.some((f) => ['-l', '-w', '-c'].includes(f));
          const parts = (lines) => {
            const text = lines.join('\n');
            const out = [];
            if (all || flags.includes('-l')) out.push(String(lines.length).padStart(7));
            if (all || flags.includes('-w')) out.push(String(text.split(/\s+/).filter(Boolean).length).padStart(7));
            if (all || flags.includes('-c')) out.push(String(text.length).padStart(7));
            return out;
          };
          const files = fileArgs(args);
          if (stdin || !files.length) return print(parts(stdin ?? []).join(''));
          /* A count is only useful if you know what it counted: with file arguments the name
             goes on the line, and more than one gets a total, exactly as real wc does. */
          const totals = [];
          for (const f of files) {
            const p = parts(readLines(f));
            p.forEach((v, i) => { totals[i] = (totals[i] || 0) + Number(v); });
            print(`${p.join('')} ${f}`);
          }
          if (files.length > 1) print(`${totals.map((v) => String(v).padStart(7)).join('')} total`);
        },
      },
      sort: {
        usage: 'sort [-r] [-n] [file…]',
        desc: 'Sort lines (optionally reversed, or numerically).',
        filter: true,
        run: (args, stdin) => {
          /* `-n` here is "sort numerically", not "the next word is my value" — see fileArgs. */
          const lines = [...(stdin ?? fileArgs(args).flatMap(readLines))];
          const cmp = args.includes('-n')
            ? (a, b) => (Number(a) || 0) - (Number(b) || 0)
            : (a, b) => a.localeCompare(b);
          const sorted = lines.sort(cmp);
          printLines(args.includes('-r') ? sorted.reverse() : sorted);
        },
      },
      uniq: {
        usage: 'uniq [file]',
        desc: 'Drop repeated neighbouring lines (use after sort).',
        filter: true,
        run: (args, stdin) => {
          const lines = stdin ?? readLines(fileArgs(args)[0]);
          printLines(lines.filter((l, i) => i === 0 || l !== lines[i - 1]));
        },
      },
      /* The two text editors of the pipeline. They exist because everything else here only *reads*
         lines: `grep`, `sort`, `head` can select them but nothing could change them, so the usual
         one-liners (`grep x file | sed 's/foo/bar/'`) stopped halfway. Both are `filter: true`, so
         they work on a pipe and on a file, and both say what they cannot do rather than guessing. */
      sed: {
        usage: "sed <expression> [file…]   (s/find/replace/[gi] or /find/d)",
        desc: 'Edit lines as they pass through: substitute, or delete the ones that match.',
        filter: true,
        run: (args, stdin) => {
          const expr = args[0];
          if (!expr) return print("usage: sed <expression> [file…]  (this sed does s/find/replace/[gi] and /find/d)", 'err');
          /* The expression is not a file, so it is cut off before fileArgs runs — the mistake
             `sort -n file.txt` used to make, in the other direction. */
          const lines = stdin ?? fileArgs(args.slice(1)).flatMap(readLines);
          const sub = /^s(.)((?:\\.|[^\\])*?)\1((?:\\.|[^\\])*)\1([a-z]*)$/.exec(expr);
          const del = /^\/(.*)\/d$/.exec(expr);
          const flags = (extra) => (sub?.[4]?.includes('i') || extra) ? 'i' : '';
          /* Only `g` and `i` mean anything here, and an unknown one has to be refused rather than
             ignored: `s/a/b/x` doing the same thing as `s/a/b/` is a flag that looks like it worked.
             This is also the half of "sed is a subset" that a user can actually type by accident. */
          const unknownFlag = sub?.[4]?.replace(/[gi]/g, '') || '';
          let re = null;
          if (sub && unknownFlag) return print(`sed: the flags here are g and i — not ${unknownFlag} in ${expr}`, 'err');
          if (sub) {
            try { re = new RegExp(sub[2], flags() + (sub[4].includes('g') ? 'g' : '')); }
            catch { return print(`sed: not a pattern I can use: ${sub[2]}`, 'err'); }
          } else if (del) {
            try { re = new RegExp(del[1], 'i'); }
            catch { return print(`sed: not a pattern I can use: ${del[1]}`, 'err'); }
          } else {
            /* Naming the two forms is the useful answer; "unsupported expression" on its own is the
               shell shrugging. */
            return print(`sed: I only know s/find/replace/[gi] and /find/d — not ${expr}`, 'err');
          }
          /* `&` in the replacement means the part that matched, which is the one sed feature people
             reach for. Doing it by hand rather than with a replacement string is what keeps a `$`
             in someone's replacement a `$`. */
          const fill = (match) => {
            let out = '';
            for (let k = 0; k < sub[3].length; k++) {
              const ch = sub[3][k];
              if (ch === '\\') { out += sub[3][k + 1] ?? ''; k++; continue; }
              out += ch === '&' ? match : ch;
            }
            return out;
          };
          const changed = [];
          let matches = 0;
          for (const line of lines) {
            if (sub) {
              /* Counted by matching, not by "did the line change": `s/h/H/i` on `Hello` matches and
                 produces the same text, and calling that "matched none" would be a small lie that
                 reads like a diagnosis. `match`, not `test`, because a `/g` pattern remembers where it
                 got to. */
              if (line.match(re)) matches++;
              changed.push(line.replace(re, fill));
            } else if (!re.test(line)) {
              changed.push(line);
            } else {
              matches++;
            }
          }
          printLines(changed);
          /* Saying how many lines were touched is the difference between "it ran" and "it did what
             you asked" — a substitution that matched nothing otherwise looks exactly like one that
             worked. */
          if (!matches) print(`sed: ${expr} matched none of ${lines.length} line(s)`, 'note');
        },
      },
      tr: {
        usage: 'tr [-d] <set1> [set2]',
        desc: 'Translate or delete characters as they pass through (ranges like a-z are allowed).',
        filter: true,
        run: (args, stdin) => {
          const del = args[0] === '-d';
          const sets = del ? args.slice(1) : args;
          /* `-s`, `-c`, `-n` are not what this tr does. Read as a set they do something quiet and
             wrong — `tr -s a` translating `-` and `s` into `a` — which is worse than a refusal.
             A *set* that begins with a dash is not a flag: `-` first in a set is a literal, and
             `'-+'` is not shaped like a flag. */
          if (!del && /^-[a-z]+$/.test(args[0] || '')) return print(`tr: ${args[0]} is not a flag this tr has — the only one is -d`, 'err');
          if (!sets[0]) return print('usage: tr [-d] <set1> [set2]  (e.g. `echo hi | tr a-z A-Z`)', 'err');
          if (!del && !sets[1]) return print('tr: what should the characters become? tr [-d] <set1> [set2]', 'err');
          if (stdin === null) return print('tr has no file arguments — it reads the pipe: `echo hi | tr a-z A-Z`, or `tr -d x < file`', 'err');
          /* `a-z` is the reason anyone types tr. The endpoints are added by the characters around the
             dash, so the dash itself never becomes a literal — and `-` first or last in a set *is*
             a literal, which is how `tr '-+' ' '` works. */
          const expand = (spec) => {
            const out = [];
            for (let i = 0; i < spec.length; i++) {
              if (spec[i] === '-' && i > 0 && i < spec.length - 1) {
                const a = spec.charCodeAt(i - 1);
                const b = spec.charCodeAt(i + 1);
                if (a >= b) { print(`tr: ${spec} has a range the wrong way round (${spec[i - 1]}-${spec[i + 1]})`, 'err'); return null; }
                for (let c = a + 1; c < b; c++) out.push(String.fromCharCode(c));
                continue;
              }
              out.push(spec[i]);
            }
            return out;
          };
          const from = expand(sets[0]);
          if (!from) return;
          const to = del ? [] : expand(sets[1]);
          if (del) {
            const drop = new Set(from);
            printLines(stdin.map((l) => [...l].filter((c) => !drop.has(c)).join('')));
            return;
          }
          if (!to) return;
          /* A short set2 is not an error, it is the shorthand real tr uses: `tr 0-9 x` fills every
             digit with `x`. Silently stopping at the end of set2 would leave the rest unchanged and
             read like a bug. */
          const map = new Map();
          from.forEach((c, i) => map.set(c, to[Math.min(i, to.length - 1)]));
          printLines(stdin.map((l) => [...l].map((c) => map.get(c) ?? c).join('')));
        },
      },
      echo: {
        usage: 'echo <text>',
        desc: 'Print text. Combine with > to write it into a file.',
        run: (args) => print(args.join(' ')),
      },
      touch: {
        usage: 'touch <file>',
        desc: 'Create an empty file.',
        run: (args) => {
          if (!args[0]) return print('usage: touch <file>', 'err');
          if (ctx.fs.exists(args[0], state.cwd)) return print('ok (exists)', 'note');
          ctx.fs.write(args[0], '', state.cwd);
          print(`created ${basename(ctx.fs.resolve(args[0], state.cwd))}`, 'ok');
        },
      },
      mkdir: {
        /* `-p` is accepted and changes nothing, because this filesystem has always created missing
           parents — `mkdir a/b/c` already works. Treating the flag as a directory name is what
           used to happen, and it leaves a folder called `-p` in the home directory. */
        usage: 'mkdir [-p] <directory…>',
        desc: 'Create directories, with their missing parents (-p is accepted and is already the default).',
        run: (args) => {
          const targets = fileArgs(args);
          if (!targets.length) return print('usage: mkdir [-p] <directory…>', 'err');
          for (const a of targets) {
            const abs = ctx.fs.resolve(a, state.cwd);
            /* "created" about something that was already there is a small lie, and `mkdir -p` in a
               script runs on directories that usually do exist. */
            print(ctx.fs.getNode(abs) ? `${ctx.fs.display(abs)} already exists` : `created ${ctx.fs.display(abs)}`, ctx.fs.getNode(abs) ? 'note' : 'ok');
            ctx.fs.mkdir(a, state.cwd);
          }
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
        usage: 'mv <from…> <to>',
        desc: 'Move or rename. With several names, the last one is a directory.',
        run: (args) => {
          if (args.length < 2) return print('usage: mv <from…> <to>', 'err');
          /* A glob turns `mv *.txt docs/` into four arguments, and "the last one is where they
             go" is the only reading that means anything — it is also what mv has always done.
             Silently ignoring the extra names, which is what used to happen, moves one file and
             pretends it moved all of them. */
          if (args.length > 2) return moveMany(args, 'mv', (from, to) => ctx.fs.mv(from, to, state.cwd));
          ctx.fs.mv(args[0], args[1], state.cwd);
          print(`moved ${args[0]} → ${args[1]}`, 'ok');
        },
      },
      cp: {
        usage: 'cp <from…> <to>',
        desc: 'Copy a file or folder. With several names, the last one is a directory.',
        run: (args) => {
          if (args.length < 2) return print('usage: cp <from…> <to>', 'err');
          if (args.length > 2) return moveMany(args, 'cp', (from, to) => ctx.fs.copy(from, to, state.cwd));
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
          const cap = ctx.store.capacity();
          const free = ctx.store.headroom();
          printLines([
            'Filesystem usage',
            `  files        ${files}`,
            `  content      ${fmtBytes(bytes)}`,
            `  stored       ${fmtBytes(stored)} (${ctx.store.available ? 'localStorage' : 'in-memory — storage is blocked'})`,
            `  capacity     ${Number.isFinite(cap) ? `${fmtBytes(cap)} (measured by probing)` : 'unbounded (in-memory)'}`,
            `  free         ${Number.isFinite(free) ? fmtBytes(free) : 'unbounded'}`,
            `  save errors  ${ctx.store.failures}${ctx.store.lastError ? ` — ${ctx.store.lastErrorKind}: ${ctx.store.lastError}` : ''}`,
            '',
            'localStorage has a hard per-origin quota; large PNGs from Paint fill it quickly.',
            'Imports are refused before they are read if they would not fit in the space above.',
          ]);
        },
      },
      whoami: { usage: 'whoami', desc: 'Print the current user.', run: () => print('user') },
      history: { usage: 'history', desc: 'Show recent commands.', run: () => printLines(state.history.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`)) },
      /* The two commands `&&` and `||` exist for. `cmd || echo done` and `cmd && echo ok` were
         only half usable without a way to say "succeed anyway" or "fail on purpose", and
         `$(false)` is the clearest way to show that a failed substitution is empty rather than
         missing. */
      true: { usage: 'true', desc: 'Do nothing, successfully.', run: () => {} },
      false: { usage: 'false', desc: 'Do nothing, unsuccessfully — the way to make `&&` stop and `||` continue on purpose.', run: () => { stageFailed = true; } },
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
      execute(trimmed);
    };

    /* The body of a command line, without the history entry and without echoing the prompt.
       `$(…)` needs exactly that: the same machinery — pipes, redirects, `&&` — run for its output
       instead of for the screen. */
    const execute = (trimmed) => {
      /* One pass over the whole line first, so an alias body's operators are operators. */
      const expanded = expandAliasText(trimmed);
      /* `;` separates commands that run no matter what happened before them. Inside one
         group, `&&` continues only from a stage that worked and `||` only from one that
         did not — the chain is a promise, and a broken promise stops the chain. */
      for (const group of splitOn(expanded, ';')) {
        let prevOk = true;
        for (const { text, op } of splitChain(group)) {
          if (!text.trim()) continue;
          if (op === '&&' && !prevOk) { prevOk = false; continue; }
          if (op === '||' && prevOk) { prevOk = true; continue; }
          /* Each `|` hands the left side's output to the right side as input. Only the
             last stage writes to the screen. */
          const stages = splitPipe(text);
          let stdin = null;
          for (let i = 0; i < stages.length; i++) {
            /* `> file` / `>> file` sends this stage's output into the filesystem, `< file`
               fills its input from the filesystem, and `2> file` sends its errors there
               instead of onto the screen — so any command can be redirected in any
               direction. */
            const { command: stage, redirect, append, input, errFile, errAppend, mergeErr } = splitRedirect(stages[i]);
            /* Leading `NAME=value` words are assignments, not a command. They are applied to this
               shell before the rest of the line runs, so `DOCS=~/Documents && ls $DOCS` works and
               `GREETING=hi; echo $GREETING` works. An `=` after a command name is an ordinary
               argument — that is what keeps `echo a=b` printing `a=b`. */
            const words = tokenize(stage);
            let cut = 0;
            while (cut < words.length && assignmentOf(words[cut])) cut++;
            for (const t of words.slice(0, cut)) { const a = assignmentOf(t); defineVar(a.name, a.value); }
            if (cut === words.length) { prevOk = !stageFailed; continue; }
            /* Aliases were already expanded, on the line, before it was split — see
               `expandAliasText`. What happens here is everything that turns *words* into values:
               variables, globs and `$(…)`, through the same pipeline for an alias body as for a
               command you typed yourself. */
            const [name, ...args] = expandArgs(words.slice(cut));
            if (!name) continue;
            const cmd = commands[name];
            if (!cmd) { print(`command not found: ${name}  (try \`help\`)`, 'err'); break; }
            /* `rawArgs` is the words as typed, *after* the command name: `export FOO="a b"` is one
               assignment with a space in it, and re-reading it as already-split arguments would turn
               it into two. Including the command's own word in that list made `export FOO=bar` answer
               "export: not a variable assignment: export" — the command reading itself as one of its
               own arguments. */
            const cmdArgs = cmd.rawArgs ? words.slice(cut + 1) : args;
            if (input !== null) {
              if (!input) { print('missing file after <', 'err'); break; }
              try { stdin = readLines(input); }
              catch (err) { print(`${name}: ${err?.message || err}`, 'err'); break; }
            }
            if (stdin && !cmd.filter) {
              print(`${name}: this command cannot read piped input`, 'err');
              break;
            }
            const isLast = i === stages.length - 1;
            /* The last stage of a line normally writes to the screen. Inside `$(…)` there is no
               screen: its whole job is to become a word, so the last stage writes into the
               substitution's buffer instead. */
            const captured = isLast && !redirect ? (capturing ? captureSink : null) : { lines: [] };
            sink = captured;
            errSink = errFile === null ? null : { lines: [] };
            /* `2>&1` has no file of its own: the errors go wherever the output is going —
               into `captured` when there is a pipe or a `>`, and to the screen when there is
               neither, which is where they would have gone anyway. */
            mergeErrInto = mergeErr ? captured : null;
            stageFailed = false;
            try {
              cmd.run(cmdArgs, stdin);
            } catch (err) {
              /* The command failed by throwing. That is still its diagnostic, and `2>` still
                 applies to it — so record it, then let the redirect below write it out. A
                 stage that failed does not end the pipeline: what it managed to produce
                 still goes to the next stage, and the last stage decides the status, which
                 is what bash does (`cat missing | wc -l` counts zero and succeeds). */
              print(String(err?.message || err), 'err');
            } finally {
              sink = null;
              mergeErrInto = null;
            }
            const lines = captured ? dropTrailingBlank(captured.lines) : [];
            let wroteOut = false;
            if (redirect !== null) {
              if (!redirect) { print('missing file after >', 'err'); break; }
              const text2 = lines.length ? `${lines.join('\n')}\n` : '';
              try {
                if (append) ctx.fs.append(redirect, text2, state.cwd);
                else ctx.fs.write(redirect, text2, state.cwd);
                wroteOut = true;
              } catch (err) {
                print(String(err?.message || err), 'err');
                break;
              }
              print(`wrote ${lines.length} line(s) to ${ctx.fs.display(ctx.fs.resolve(redirect, state.cwd))}`, 'ok');
              noteUnexpandedGlob(redirect, '>');
            }
            if (errFile !== null) {
              const errs = dropTrailingBlank(errSink.lines);
              errSink = null;
              if (!errFile) { print('missing file after 2>', 'err'); break; }
              const text2 = errs.length ? `${errs.join('\n')}\n` : '';
              /* `&> file` sends both streams to the same file. The output got there first,
                 so the errors have to be added to it — a second `write` would erase it. */
              const sameFile = errFile === redirect && wroteOut;
              try {
                if (errAppend || sameFile) ctx.fs.append(errFile, text2, state.cwd);
                else ctx.fs.write(errFile, text2, state.cwd);
              } catch (err) {
                print(String(err?.message || err), 'err');
                break;
              }
              /* Silence is the point of `2> /dev/null`; only say something when something
                 was actually moved. */
              if (errs.length) print(`wrote ${errs.length} error line(s) to ${ctx.fs.display(ctx.fs.resolve(errFile, state.cwd))}`, 'dim');
              noteUnexpandedGlob(errFile, '2>');
            }
            stdin = isLast ? null : lines;
          }
          prevOk = !stageFailed;
        }
      }
    };

    /* Run a line and hand back what it printed, for `$(…)`. The outer stage's capture state is
       saved and restored around it, because a substitution runs *inside* a pipeline that may
       already be buffering. The inner command's own errors are not captured: they go to the
       screen, which is where a real shell puts them and the reason `$(cat missing)` expands to
       nothing while still telling you the file is missing. */
    const captureLine = (line) => {
      const saved = { sink, errSink, mergeErrInto, stageFailed, captureSink };
      const outBuf = { lines: [] };
      captureSink = outBuf;
      /* The inner command's own errors are not captured: they go to the screen, which is where a
         real shell puts them and the reason `$(cat missing)` expands to nothing while still
         telling you the file is missing. */
      errSink = null;
      mergeErrInto = null;
      stageFailed = false;
      capturing++;
      try {
        execute(line);
      } finally {
        capturing--;
        captureSink = saved.captureSink;
        sink = saved.sink;
        errSink = saved.errSink;
        mergeErrInto = saved.mergeErrInto;
        stageFailed = saved.stageFailed;
      }
      /* A trailing newline is how a line ends, not an extra line — and a substitution's result is
         spliced into the middle of a word, where it would show up as a blank argument. */
      return outBuf.lines.join('\n').replace(/\n+$/, '');
    };

    const complete = (line) => {
      const parts = line.split(/\s+/);
      const first = parts.length === 1 && !line.includes(' ');
      /* After a pipe the thing being typed is another command, not a path. */
      const afterPipe = parts.length >= 2 && parts[parts.length - 2] === '|';
      if (first || afterPipe) {
        const stem = first ? parts[0] : parts[parts.length - 1];
        /* Your own aliases are commands too, as far as Tab is concerned — and they come first,
           because completing `ll` to `ll ` is the answer when `ll` is what you defined. */
        const names = [...Object.keys(state.aliases), ...Object.keys(commands)];
        const matches = names.filter((c) => c.startsWith(stem));
        if (matches.length === 1) {
          if (first) return matches[0] + ' ';
          parts[parts.length - 1] = matches[0];
          return parts.join(' ');
        }
        if (matches.length > 1) print((stem || '') + '\n' + matches.join('  '), 'dim');
        return null;
      }
      const token = parts[parts.length - 1];
      /* A word that starts with `$` is a variable, not a path — completing it names the
         variables rather than searching the filesystem for a file called `$HO`. */
      if (token.startsWith('$')) {
        const stem = token.slice(1).toUpperCase();
        const names = Object.keys(shellVars());
        const matches = names.filter((n) => n.startsWith(stem));
        if (matches.length === 1) { parts[parts.length - 1] = `$${matches[0]}`; return parts.join(' '); }
        if (matches.length > 1) print(`${token}\n` + matches.map((n) => `$${n}`).join('  '), 'dim');
        return null;
      }
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

    /* Ctrl+R: reverse search through the command history, the way a real shell does it —
       type a fragment, get the most recent command containing it, press Ctrl+R again for
       the next older one. The search lives in the prompt line, exactly as bash puts it
       there, so there is never a hidden mode whose state you cannot see. */
    const rsearch = { active: false, query: '', at: 0, saved: '' };
    const rsearchMatches = () => {
      const q = rsearch.query.toLowerCase();
      if (!q) return [];
      return state.history
        .map((text, i) => ({ text, i }))
        .filter(({ text }) => text.toLowerCase().includes(q))
        .reverse();
    };
    const rsearchHit = () => {
      const matches = rsearchMatches();
      return matches[Math.min(rsearch.at, matches.length - 1)] || null;
    };
    const rsearchShow = () => {
      const hit = rsearchHit();
      const total = rsearchMatches().length;
      input.value = rsearch.query
        ? `(reverse-i-search)‘${rsearch.query}’: ${hit ? hit.text : ''}${total > 1 ? `  (${rsearch.at + 1}/${total})` : ''}`
        : '(reverse-i-search)`: ';
    };
    const rsearchEnd = (accept) => {
      const hit = accept ? rsearchHit() : null;
      input.value = hit ? hit.text : rsearch.saved;
      rsearch.active = false;
      rsearch.query = '';
      rsearch.at = 0;
      rsearch.saved = '';
    };

    input.addEventListener('keydown', (e) => {
      if (rsearch.active) {
        if (e.key === 'Escape') { e.preventDefault(); rsearchEnd(false); return; }
        if (e.key === 'Enter') { e.preventDefault(); rsearchEnd(true); return; }
        if (e.key === 'Backspace') {
          e.preventDefault();
          if (!rsearch.query) { rsearchEnd(false); return; }
          rsearch.query = rsearch.query.slice(0, -1);
          rsearch.at = 0;
          rsearchShow();
          return;
        }
        if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
          e.preventDefault();
          const total = rsearchMatches().length;
          if (!total) return;
          rsearch.at = (rsearch.at + 1) % total; // Ctrl+R again walks further back
          rsearchShow();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          rsearch.query += e.key;
          rsearch.at = 0;
          rsearchShow();
        }
        return; // while searching, the prompt line is not a command line
      }
      if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        rsearch.active = true;
        rsearch.query = '';
        rsearch.at = 0;
        rsearch.saved = input.value;
        rsearchShow();
        return;
      }
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

    /**
     * Split one `;`-separated group into its `&&` / `||` parts, quote-aware, keeping the
     * operator that joins each part so the caller can decide whether to run it.
     * @returns {{text:string, op:'&&'|'||'|null}[]}
     */
    const splitChain = (line) => {
      const parts = [];
      let cur = '';
      let quote = null;
      let pending = null;
      /* Inside `$(…)` the operators belong to the inner command: `echo $(ls || echo none)` is one
         stage, not two, and `||` is not this line's business. */
      let sub = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (sub) {
          if (ch === '(') sub++;
          else if (ch === ')') sub--;
          cur += ch;
          continue;
        }
        if (ch === '$' && line[i + 1] === '(') { sub = 1; cur += '$('; i++; continue; }
        const op = line.startsWith('&&', i) ? '&&' : line.startsWith('||', i) ? '||' : null;
        if (op) { parts.push({ text: cur, op: pending }); cur = ''; pending = op; i++; continue; }
        cur += ch;
      }
      parts.push({ text: cur, op: pending });
      return parts;
    };

    /** Split one command on `|`, ignoring pipes inside quotes. */
    const splitPipe = (line) => splitOn(line, '|');

    /**
     * Split a stage's redirections off it: `> file`, `>> file`, `< file`, `2> file`,
     * `2>> file`, `2>&1` and `&> file`.
     * Quoted operators stay part of the command (`echo "a > b"` prints what it says).
     */
    const splitRedirect = (text) => {
      const pieces = [];
      let quote = null;
      let cur = '';
      let sub = 0;
      const flush = () => { const s = cur.trim(); if (s) pieces.push({ text: s }); cur = ''; };
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        /* A `>` inside `$(…)` belongs to the inner command. Without this, `echo $(cat a > b)`
           would be read as this stage being redirected to a file called `b)`. */
        if (sub) {
          if (ch === '(') sub++;
          else if (ch === ')') sub--;
          cur += ch;
          continue;
        }
        if (ch === '$' && text[i + 1] === '(') { sub = 1; cur += '$('; i++; continue; }
        if (ch === '&' && text[i + 1] === '>') {
          /* `&> file` is "both streams into one file", which is what people who type it
             are trying to do with `2>&1 > file`. */
          const bothAppend = text[i + 2] === '>';
          flush();
          pieces.push({ op: bothAppend ? 'appendBoth' : 'both' });
          i += bothAppend ? 2 : 1;
          continue;
        }
        if (ch === '>' || ch === '<') {
          /* `2>` is stderr. The `2` belongs to the operator, not to the command — but only
             when it stands alone (`ls 2> log`), not when it is part of a word. */
          let stderr = false;
          if (ch === '>' && /(^|\s)2$/.test(cur)) {
            stderr = true;
            cur = cur.replace(/\s*2$/, '');
          }
          flush();
          const append = ch === '>' && text[i + 1] === '>';
          if (append) i++;
          pieces.push({ op: ch === '<' ? 'read' : append ? 'append' : 'write', stderr });
          continue;
        }
        cur += ch;
      }
      flush();

      const command = pieces[0]?.text ?? '';
      /* A redirect target is a word like any other: quoting it protects the spaces in it,
         and an unquoted `$HOME` or `~` in it expands. Without this, `echo hi > "$HOME/my
         notes.txt"` would have created a file with literal quotes in its name. */
      const targetOf = (raw) => {
        const ts = tokenize(raw || '');
        return ts.length ? expandWord(ts[0]) : '';
      };
      let redirect = null, appendTo = false, input = null;
      let errFile = null, errAppend = false, mergeErr = false;
      for (let i = 1; i < pieces.length; i++) {
        const op = pieces[i].op;
        if (!op) continue;
        const target = targetOf(pieces[i + 1]?.text);
        if (op === 'both' || op === 'appendBoth') {
          redirect = target; appendTo = op === 'appendBoth';
          errFile = target; errAppend = op === 'appendBoth';
          continue;
        }
        if (pieces[i].stderr) {
          /* `2>&1` names no file: it says "errors go where the output goes", so there is
             no second stream to write. `&1` is only a target when it is the whole target. */
          if (target === '&1') { mergeErr = true; errFile = null; errAppend = false; continue; }
          errFile = target; errAppend = op === 'append';
          continue;
        }
        if (op === 'read') { input = target; continue; }
        redirect = target; appendTo = op === 'append';
      }
      return { command, redirect, append: appendTo, input, errFile, errAppend, mergeErr };
    };

    const splitOn = (line, sep) => {
      const parts = [];
      let cur = '';
      let quote = null;
      let sub = 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          cur += ch;
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        /* A `;`, `|` or `&&` inside `$(…)` separates the inner command, not this one. */
        if (sub) {
          if (ch === '(') sub++;
          else if (ch === ')') sub--;
          cur += ch;
          continue;
        }
        if (ch === '$' && line[i + 1] === '(') { sub = 1; cur += '$('; i++; continue; }
        if (line.startsWith(sep, i)) { parts.push(cur); cur = ''; i += sep.length - 1; continue; }
        cur += ch;
      }
      parts.push(cur);
      return parts;
    };

    /* ~/.shellrc, and `source` — the one place where a *file* is allowed to change what this
       shell means. That is worth being deliberate about, because everything else about this shell
       is stateless between windows on purpose: variables, aliases and `cd -` all die with the
       window. A startup file is the exception, and the reasoning is the same one that made the
       filesystem worth persisting at all: something you *wrote* is yours to keep, and something the
       shell invented for you is not. So the rules here are: the file is in your home folder where
       `ls` can see it, it is never created for you, reading it is announced rather than silent,
       every line of it is an ordinary command line (so `man` explains it), a line that fails does
       not stop the rest, and everything it defined is still undoable with `unset`/`unalias`.
       `sourcing` is the loop guard: a file whose last line is `source ~/.shellrc` is a hung tab. */
    const SHELLRC = '~/.shellrc';
    const sourcing = [];
    const runScript = (path, why) => {
      const abs = ctx.fs.resolve(path, state.cwd);
      let text;
      try { text = ctx.fs.read(abs, state.cwd); }
      catch (err) { print(`${why}: ${err?.message || err}`, 'err'); return null; }
      if (sourcing.includes(abs)) { print(`${why}: ${ctx.fs.display(abs)} is already running — a file that sources itself`, 'err'); return null; }
      if (sourcing.length >= 8) { print(`${why}: too many files deep`, 'err'); return null; }
      sourcing.push(abs);
      let ran = 0;
      let failed = 0;
      try {
        for (const raw of String(text).split('\n')) {
          const line = raw.trim();
          if (!line || line.startsWith('#')) continue;
          ran++;
          /* The same `execute` a typed line goes through: pipes, redirects, `&&`, aliases, all of it.
             A startup file is not a different language with its own parser. */
          execute(line);
          if (stageFailed) failed++;
        }
      } finally { sourcing.pop(); }
      return { ran, failed };
    };

    print(BANNER, 'dim');
    const motd = (() => { try { return ctx.fs.read('/etc/motd'); } catch { return null; } })();
    if (motd) print(motd.trim(), 'ok');
    /* An absent ~/.shellrc is the normal state and says nothing. A present one says what it did,
       because an alias that works and nobody can see the origin of is exactly the kind of thing a
       shell is supposed to be able to show you (`alias` lists it; this line says where it came from). */
    if (ctx.fs.getNode(ctx.fs.resolve(SHELLRC, ctx.fs.home))) {
      const rc = runScript(SHELLRC, SHELLRC);
      if (rc?.ran) {
        const defined = [];
        const aliases = Object.keys(state.aliases).length;
        const vars = Object.keys(state.vars).length;
        if (aliases) defined.push(`${aliases} alias(es)`);
        if (vars) defined.push(`${vars} variable(s)`);
        print(`${SHELLRC}: ran ${rc.ran} line(s)${defined.length ? ` and defined ${defined.join(' and ')}` : ''} — \`man startup\` explains this file`, 'dim');
      }
    }
    refreshPrompt();
    /* Opening a terminal means you want to type in it, and clicking its body means the same.
       Both go through the core so neither can take the keyboard back from something you
       focused in the meantime. */
    claimFocus(win, input);
    win.body.addEventListener('pointerdown', () => claimFocus(win, input, { delay: 0 }));
  },
};
