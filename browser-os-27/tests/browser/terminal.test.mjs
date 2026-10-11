import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

/* How many monospace characters the open terminal can actually show on one line, measured the way
   the terminal measures it (the font is monospace, so one glyph is the answer). Two tests need it:
   the index must fit the window it prints into, and it must fit at *any* width the window can be.
   A hard-coded column count here would be a fact about the default window size. */
const termColumns = () => page.evaluate(() => {
  const out = document.querySelector('.window[data-app="terminal"] .term-out');
  const cs = getComputedStyle(out);
  const probe = document.createElement('span');
  probe.textContent = '0123456789abcdefghij';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;'
    + `font-style:${cs.fontStyle};font-weight:${cs.fontWeight};font-size:${cs.fontSize};font-family:${cs.fontFamily}`;
  out.append(probe);
  const glyph = probe.getBoundingClientRect().width / probe.textContent.length;
  probe.remove();
  return Math.floor((out.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / glyph);
});

test('terminal commands drive the filesystem', async () => {
  await openApp('terminal');
  await runCommand('mkdir smoke');
  await runCommand('echo hello from tests > smoke/greeting.txt');
  await runCommand('cd smoke && pwd');

  const content = await page.evaluate(() => window.browserOS.fs.read('/home/user/smoke/greeting.txt'));
  assert.match(content, /hello from tests/);

  // Tab completion for command names and for paths.
  await page.fill(TERM_INPUT, 'neo');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'neofetch ');

  await page.fill(TERM_INPUT, 'cat greet');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'cat greeting.txt');
  await page.press(TERM_INPUT, 'Enter');

  const out = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(out, /hello from tests/);
  assert.match(out, /\/home\/user\/smoke/);

  // Up arrow walks the command history.
  await page.press(TERM_INPUT, 'ArrowUp');
  assert.equal(await page.inputValue(TERM_INPUT), 'cat greeting.txt');
  await page.fill(TERM_INPUT, '');

  await runCommand('cd .. && rm -r smoke');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/smoke')), false);
});

test('terminal: nano alias, quoted && and storage commands', async () => {
  await openApp('terminal');

  await runCommand('nano ~/Documents/notes.md');
  await win('editor').waitFor({ state: 'attached', timeout: 5000 });
  assert.match(await page.inputValue('.editor-area'), /# Notes/);
  await closeApp('editor');

  await runCommand('echo "one && two"');
  const out = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(out, /one && two/, 'a quoted && must not split the command');

  await runCommand('stat ~/Documents/notes.md');
  assert.match(await page.textContent('.window[data-app="terminal"] .term-out'), /type\s+file/);

  await runCommand('df');
  const df = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(df, /files\s+\d+/);
  assert.match(df, /stored\s+\S+/);

  await runCommand('du ~/Documents');
  assert.match(await page.textContent('.window[data-app="terminal"] .term-out'), /Documents/);

  // Ctrl+C abandons the line being typed, without touching history.
  await page.fill(TERM_INPUT, 'half-typed');
  await page.press(TERM_INPUT, 'Control+c');
  assert.equal(await page.inputValue(TERM_INPUT), '');
  await page.press(TERM_INPUT, 'ArrowUp');
  assert.equal(await page.inputValue(TERM_INPUT), 'du ~/Documents');
  await page.fill(TERM_INPUT, '');
});

/* The shell knows three things about where you are: your home, the folder you are in, and
   your name. Quoting is what keeps them literal — the same rule every shell uses, and the
   reason `echo "$HOME"` is how you print a dollar sign. */

test('terminal: $HOME, $PWD and ~ expand, and quoting stops that', async () => {
  await closeAll();
  await openApp('terminal');
  const lastLine = async (cmd) => {
    await runCommand(cmd);
    await page.waitForTimeout(150);
    const lines = await page.locator('.window[data-app="terminal"] .term-out > div').allTextContents();
    return lines[lines.length - 1] ?? '';
  };

  assert.equal(await lastLine('echo $HOME'), '/home/user');
  assert.equal(await lastLine('echo $USER'), 'user');
  assert.equal(await lastLine('echo ~'), '/home/user');
  assert.equal(await lastLine('echo ~/Documents'), '/home/user/Documents');
  assert.equal(await lastLine('echo path$HOME'), 'path/home/user');

  /* A name the shell does not know stays exactly as typed. Silently blanking it would
     turn a typo into an empty argument, which is a much worse mistake to make. */
  assert.equal(await lastLine('echo $NOT_A_REAL_VARIABLE'), '$NOT_A_REAL_VARIABLE');

  /* Quoting is the escape hatch, in both quote styles. */
  assert.equal(await lastLine('echo "$HOME"'), '$HOME');
  assert.equal(await lastLine("echo '$HOME'"), '$HOME');

  /* $PWD follows the directory, and a variable builds a path the filesystem accepts. */
  await lastLine('mkdir $HOME/var-test');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/var-test')), true, 'mkdir must see the expanded path');
  await lastLine('cd var-test');
  assert.equal(await lastLine('echo $PWD'), '/home/user/var-test');
  assert.equal(await lastLine('echo $HOME/var-test'), '/home/user/var-test');
  await lastLine('cd ~ && rm -r var-test');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/var-test')), false);

  /* A redirect target is a word too. Before this, `> "$HOME/my target.txt"` wrote a file
     whose name contained the quote characters themselves. */
  await lastLine('echo quoted > "$HOME/my target.txt"');
  assert.equal((await page.evaluate(() => window.browserOS.fs.read('/home/user/$HOME/my target.txt'))).trim(), 'quoted',
    'a quoted target keeps its spaces, loses its quotes, and is not expanded — exactly as a word on the command line behaves');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/"$HOME/my target.txt"')), false,
    'the quote characters must not end up inside the file name');
  await lastLine('echo via-var > $HOME/var-target.txt');
  assert.equal((await page.evaluate(() => window.browserOS.fs.read('/home/user/var-target.txt'))).trim(), 'via-var',
    'an unquoted $HOME in a redirect target expands like any other word');
  await page.evaluate(() => {
    window.browserOS.fs.rm('/home/user/$HOME', '/', true);
    window.browserOS.fs.rm('/home/user/var-target.txt', '/');
  });

  /* Tab completes a word that starts with `$` as a variable, not as a file name. */
  await page.fill(TERM_INPUT, 'echo $HO');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'echo $HOME');
  await page.fill(TERM_INPUT, '');

  /* help must describe what the shell actually does, not what it used to not do. */
  await runCommand('help');
  const help = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(help, /\$HOME/, 'help must document the variables it supports');
  assert.ok(!/variables beyond/.test(help), 'help must not still claim variables are unsupported');

  await closeAll();
});

/* `cd -` is the shell habit people type without thinking, and the only one here that needs
   memory: the directory the shell just left. `$OLDPWD` exists for the same reason — a shell
   that can take you back should be able to tell you where it is taking you back to. */

test('terminal: cd - goes back to the directory you came from', async () => {
  await closeAll();
  await openApp('terminal');
  const lastLine = async (cmd) => {
    await runCommand(cmd);
    await page.waitForTimeout(150);
    const lines = await page.locator('.window[data-app="terminal"] .term-out > div').allTextContents();
    return lines[lines.length - 1] ?? '';
  };
  const cwd = () => page.textContent('.window[data-app="terminal"] .term-cwd');

  /* A shell that has never moved says so instead of silently going somewhere. */
  assert.match(await lastLine('cd -'), /no previous directory/);
  assert.match(await cwd(), /browseros:~\$/, 'and a failed cd - must leave you where you were');
  assert.equal(await lastLine('echo $OLDPWD'), '$OLDPWD', 'there is no previous directory to expand');

  await lastLine('mkdir ~/cdtest');
  await lastLine('mkdir ~/cdtest/deeper');
  await lastLine('cd ~/cdtest');
  await lastLine('cd deeper');
  assert.equal(await lastLine('pwd'), '/home/user/cdtest/deeper');
  assert.equal(await lastLine('echo $OLDPWD'), '/home/user/cdtest', 'the shell knows where it came from');

  await lastLine('cd -');
  assert.equal(await lastLine('pwd'), '/home/user/cdtest', 'cd - returns to the directory you were just in');
  assert.match(await cwd(), /browseros:~\/cdtest\$/, 'the prompt moves with it');

  await lastLine('cd -');
  assert.equal(await lastLine('pwd'), '/home/user/cdtest/deeper', 'and it toggles, which is what people expect from it');

  /* A chain is no exception: `cd -` is an ordinary command with an ordinary argument. */
  await lastLine('cd .. && cd -');
  assert.equal(await lastLine('pwd'), '/home/user/cdtest/deeper', 'cd - inside a chain still means the same thing');

  /* A previous directory that no longer exists is an error, not a jump to nowhere. */
  await lastLine('cd ~');
  await lastLine('rm -r cdtest');
  assert.match(await lastLine('cd -'), /no such directory/);
  assert.match(await cwd(), /browseros:~\$/, 'and the failed cd - leaves the working directory alone');

  /* Tab completes it like any other variable. */
  await page.fill(TERM_INPUT, 'echo $OLD');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'echo $OLDPWD');
  await page.fill(TERM_INPUT, '');

  await runCommand('man cd');
  const man = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(man, /cd \[directory \| -\]/, 'the manual page must mention the option');

  await closeAll();
});

test('terminal pipes: grep, head, tail, wc, sort and uniq read the previous command', async () => {
  await openApp('terminal');
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.write('~/pipe.txt', 'alpha\nbravo two\ncharlie\nbravo one\n');
    fs.write('~/numbers.txt', '10\n2\n33\n');
  });

  /* Run one command on a clean screen and return only what it printed. */
  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    /* innerText, not textContent: block-level output lines need their separators. */
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  assert.deepEqual(await runClean('cat ~/pipe.txt | grep bravo'), ['bravo two', 'bravo one'],
    'grep must keep only the matching lines, in order');
  assert.deepEqual(await runClean('ls | grep pipe'), ['pipe.txt'], 'a filter must be able to read a listing');
  assert.deepEqual(await runClean('cat ~/pipe.txt | head -n 2'), ['alpha', 'bravo two'], 'head takes the first n');
  assert.deepEqual(await runClean('cat ~/pipe.txt | tail -n 1'), ['bravo one'], 'tail takes the last n');
  assert.deepEqual(await runClean('cat ~/numbers.txt | sort -n'), ['2', '10', '33'], 'sort -n compares numbers, not text');
  assert.deepEqual(await runClean('cat ~/pipe.txt | sort | grep bravo | uniq'), ['bravo one', 'bravo two'],
    'three stages must chain');

  const counts = await runClean('cat ~/pipe.txt | wc -l');
  assert.match(counts[0], /^\s*4$/, `a four-line file must count as 4 lines, got ${JSON.stringify(counts)}`);
  const fileCounts = await runClean('wc -l ~/pipe.txt');
  assert.match(fileCounts[0], /^\s*4\s+\/home\/user\/pipe\.txt$/, 'wc on a file must say which file it counted');
  /* A glob hands a command several files; counting one of them and printing it as if it were the
     answer is the trap that makes a half-feature worse than no feature. */
  const both = await runClean('wc -l ~/pipe.txt ~/numbers.txt');
  assert.equal(both.length, 3, `two files must produce two counts and a total, got ${JSON.stringify(both)}`);
  assert.match(both[0], /^\s*4\s+\/home\/user\/pipe\.txt$/);
  assert.match(both[1], /^\s*3\s+\/home\/user\/numbers\.txt$/);
  assert.match(both[2], /^\s*7\s+total$/, 'and the total must be the sum, not the last file');
  const heads = await runClean('head -n 1 ~/pipe.txt ~/numbers.txt');
  assert.deepEqual(heads, ['==> /home/user/pipe.txt <==', 'alpha', '==> /home/user/numbers.txt <==', '10'],
    'several files must be labelled, not merged');

  const refused = await runClean('ls | pwd');
  assert.ok(refused.some((l) => /cannot read piped input/.test(l)),
    `a command that cannot read a pipe must say so, got ${JSON.stringify(refused)}`);

  const none = await runClean('cat ~/pipe.txt | grep zzz');
  assert.ok(none.some((l) => /no lines match/.test(l)), 'an empty result must be reported, not silent');

  /* Redirects work on any command, not just echo — that is what makes a pipe useful
      to keep. */
  const wrote = await runClean('ls -l ~/ | grep pipe > ~/listing.txt');
  assert.ok(wrote.some((l) => /wrote 1 line\(s\) to ~\/listing\.txt/.test(l)),
    `a redirect must report what it wrote, got ${JSON.stringify(wrote)}`);
  assert.match(await page.evaluate(() => window.browserOS.fs.read('~/listing.txt')), /pipe\.txt/,
    'the listing must actually be in the file');

  const appended = await runClean('cat ~/pipe.txt | grep bravo >> ~/listing.txt');
  assert.ok(appended.some((l) => /wrote 2 line\(s\)/.test(l)), '>> must report the appended lines');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('~/listing.txt')),
    /pipe\.txt\nbravo two\nbravo one/, '>> adds to the file, > replaces it');

  /* A pipe or > inside quotes is data. */
  assert.deepEqual(await runClean('echo "a|b"'), ['a|b'], 'a quoted | must not split the command');
  assert.deepEqual(await runClean('echo "a > b"'), ['a > b'], 'a quoted > must not redirect');

  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.rm('~/pipe.txt'); fs.rm('~/numbers.txt'); fs.rm('~/listing.txt');
  });
  await closeApp('terminal');
});

test('terminal: < fills a command from a file, and && stops at the command that failed', async () => {
  await openApp('terminal');
  await page.evaluate(() => window.browserOS.fs.write('~/redir.txt', 'one\ntwo three\nfour\n'));

  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  assert.deepEqual(await runClean('cat < ~/redir.txt'), ['one', 'two three', 'four'],
    'cat must read the file named after <');
  const counted = await runClean('wc -l < ~/redir.txt');
  assert.match(counted[0], /^\s*3$/, `wc must count the redirected file, got ${JSON.stringify(counted)}`);
  assert.deepEqual(await runClean('grep three < ~/redir.txt'), ['two three'], 'a filter must read < too');
  assert.deepEqual(await runClean('grep -n three < ~/redir.txt'), ['2: two three'],
    'grep -n numbers the lines it keeps, counting from 1');
  assert.ok((await runClean('grep --bogus three < ~/redir.txt')).some((l) => /unknown option --bogus/.test(l)),
    'an option grep does not have must be named, not quietly treated as the pattern');
  assert.deepEqual((await runClean('cat ~/redir.txt | head -n 2 | wc -l')).map((l) => l.trim()), ['2'],
    'a pipe must still work next to a redirect');

  /* `<` and `>` in the same stage: read one file, write another. */
  await runClean('grep three < ~/redir.txt > ~/found.txt');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('~/found.txt')), /two three/);

  /* `&&` is a promise: a chain that carries on after a failure promises something that
     did not happen. */
  const notFound = await runClean('nope && echo should not run');
  assert.ok(notFound.some((l) => /command not found/.test(l)));
  assert.ok(!notFound.some((l) => /should not run/.test(l)), 'a failed stage must stop the chain');

  const noMatch = await runClean('grep zzz < ~/redir.txt && echo found it');
  assert.ok(noMatch.some((l) => /no lines match/.test(l)));
  assert.ok(!noMatch.some((l) => /found it/.test(l)), 'grep with no match failed, so the chain must stop');

  const matched = await runClean('grep three < ~/redir.txt && echo found it');
  assert.ok(matched.some((l) => /found it/.test(l)), 'a successful stage must let the chain continue');

  const brokenFile = await runClean('cat < ~/nowhere.txt && echo ran anyway');
  assert.ok(brokenFile.some((l) => /nowhere\.txt/.test(l)), 'a missing input file must be named');
  assert.ok(!brokenFile.some((l) => /ran anyway/.test(l)), 'and it must stop the chain');

  const noTarget = await runClean('cat < && echo ran');
  assert.ok(noTarget.some((l) => /missing file after </.test(l)), '`<` with no file must say so');
  assert.ok(!noTarget.some((l) => /ran$/.test(l)));

  /* A quoted `<` is data, not a redirect. */
  assert.deepEqual(await runClean('echo "a < b"'), ['a < b']);

  await page.evaluate(() => { window.browserOS.fs.rm('~/redir.txt'); window.browserOS.fs.rm('~/found.txt'); });
  await closeApp('terminal');
});

test('terminal: `;` runs regardless, `||` runs only after a failure, and `2>` sends errors to a file', async () => {
  await openApp('terminal');
  await page.evaluate(() => window.browserOS.fs.write('~/errsrc.txt', 'visible\n'));

  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  /* `;` is "do this, then do that": the second command takes no notice of the first. */
  const seq = await runClean('echo first; nope; echo last');
  assert.ok(seq.some((l) => /first/.test(l)) && seq.some((l) => /last/.test(l)),
    'a `;` chain must carry on past a failure');
  assert.ok(seq.some((l) => /command not found: nope/.test(l)), 'and still report the failure it carried on past');

  /* `||` is the other half of the promise `&&` makes. */
  assert.ok((await runClean('nope || echo handled it')).some((l) => /handled it/.test(l)),
    '|| must run when the left side failed');
  assert.ok(!(await runClean('echo fine || echo should not run')).some((l) => /should not run/.test(l)),
    '|| must not run when the left side worked');

  /* The two kinds of separator must not bleed into each other. */
  const mixed = await runClean('nope; echo second && echo third');
  assert.ok(mixed.some((l) => /second/.test(l)) && mixed.some((l) => /third/.test(l)),
    'a `;` group starts fresh: the group before it failed, and that is not its business');

  /* `2>` is a second stream. Errors are the part of a command's output you most often
     want to keep, and the part you most often want out of the way. */
  const quiet = await runClean('cat ~/nowhere.txt 2> ~/errors.txt');
  assert.ok(!quiet.some((l) => /no such file/.test(l)), 'the error must not reach the screen');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('~/errors.txt')), /nowhere\.txt/,
    'the error must be in the file you named');
  assert.ok(quiet.some((l) => /wrote 1 error line/.test(l)), 'moving an error must be said, not implied');

  /* A redirected failure is still a failure. */
  assert.ok(!(await runClean('cat ~/nowhere.txt 2> ~/errors.txt && echo carried on')).some((l) => /carried on/.test(l)),
    'hiding an error does not fix the command that made it');

  await runClean('cat ~/errsrc.txt 2>> ~/errors.txt');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('~/errors.txt')), /nowhere/,
    '2>> must add to the file, not replace it');

  await runClean('echo fine 2> ~/clean.txt');
  assert.equal(await page.evaluate(() => window.browserOS.fs.read('~/clean.txt')), '',
    'a command with no errors writes an empty file, not a blank line');

  /* `2` is only part of the operator when it stands alone: `echo a2 > f` writes a2. */
  await runClean('echo a2 > ~/letters.txt');
  assert.equal(await page.evaluate(() => window.browserOS.fs.read('~/letters.txt')), 'a2\n');

  await page.evaluate(() => {
    for (const f of ['~/errsrc.txt', '~/errors.txt', '~/clean.txt', '~/letters.txt']) window.browserOS.fs.rm(f);
  });
  await closeApp('terminal');
});

test('terminal: one line may use `;`, `&&`, `||`, `|` and `2>` at the same time', async () => {
  /* Each layer of the grammar is tested on its own. This one exists so that a refactor of
     run() cannot quietly change how the layers interact. */
  await closeAll();
  await openApp('terminal');
  await page.evaluate(() => window.browserOS.fs.write('~/gram.txt', 'one line\ntwo lines here\nthree\n'));

  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(250);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };
  const read = (path) => page.evaluate((p) => window.browserOS.fs.read(p), path);

  const out = await runClean(
    'cat ~/gram.txt | grep two > ~/found.txt && echo found || echo missed; cat ~/nowhere.txt 2> ~/gerr.txt; echo end');

  assert.match(await read('~/found.txt'), /two lines here/, 'the redirect belongs to the last stage of the pipeline');
  assert.ok(out.some((l) => /found/.test(l)), 'a pipeline that worked must let `&&` continue');
  assert.ok(!out.some((l) => /missed/.test(l)), 'so `||` must not run');
  assert.ok(!out.some((l) => /no such file/.test(l)), 'the second group’s error went to a file');
  assert.match(await read('~/gerr.txt'), /nowhere\.txt/, 'and it is in the file that group named');
  assert.ok(out.some((l) => /end/.test(l)), 'a `;` group runs whatever the group before it did');

  /* The same line, with the pipeline failing: the status is the last stage’s, and the
     chain must react to it. */
  const failed = await runClean('cat ~/gram.txt | grep zzz && echo found it || echo nothing found');
  assert.ok(failed.some((l) => /no lines match/.test(l)), 'grep said it found nothing');
  assert.ok(!failed.some((l) => /found it/.test(l)), 'so `&&` must stop');
  assert.ok(failed.some((l) => /nothing found/.test(l)), 'and `||` must run');

  /* A stage that fails does not cancel the pipeline: what it produced still goes to the
     next stage, and that stage decides the status — which is what `cat missing | wc -l`
     means in a real shell. */
  const piped = await runClean('cat ~/nowhere.txt | wc -l; echo after');
  assert.ok(piped.some((l) => /no such file/.test(l)), 'the failure is still reported');
  assert.ok(piped.some((l) => /^\s*0$/.test(l.trim())), 'and the next stage still ran, on nothing');
  assert.ok(piped.some((l) => /after/.test(l)), 'which decided the status, so the `;` group ran anyway');

  await page.evaluate(() => {
    for (const f of ['~/gram.txt', '~/found.txt', '~/gerr.txt']) window.browserOS.fs.rm(f);
  });
  await closeApp('terminal');
});

test('terminal: `2>&1` merges the streams and `&>` writes both to one file', async () => {
  await closeAll();
  await openApp('terminal');

  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(250);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };
  const read = (path) => page.evaluate((p) => window.browserOS.fs.read(p), path);

  /* `2>&1` is the one redirect people reach for and could not use: "stop treating the
     error as a separate stream". It has to mean that everywhere the output goes. */
  const merged = await runClean('cat ~/nowhere.txt 2>&1 | grep such');
  assert.ok(merged.some((l) => /no such file/.test(l)), 'the error became part of the piped output');

  await runClean('cat ~/nowhere.txt 2>&1 > ~/merged.txt');
  assert.match(await read('~/merged.txt'), /no such file/, 'it is part of a redirected output too');

  const quiet = await runClean('cat ~/nowhere.txt 2> ~/separate.txt');
  assert.ok(!quiet.some((l) => /no such file/.test(l)), 'without it the error stays a separate stream');
  assert.match(await read('~/separate.txt'), /no such file/);

  /* `&> file` is the shorter way of asking for the same thing, and the two writes must
     not erase each other. */
  await runClean('echo spoken > ~/both.txt; cat ~/nowhere.txt &>> ~/both.txt');
  const both = await read('~/both.txt');
  assert.match(both, /spoken/, 'the output is there');
  assert.match(both, /no such file/, 'and so is the error, after it, not instead of it');

  await runClean('cat ~/nowhere.txt &> ~/both2.txt');
  assert.match(await read('~/both2.txt'), /no such file/, '&> writes the error to the file it names');
  assert.ok(!(await runClean('cat ~/nowhere.txt &> ~/both2.txt')).some((l) => /no such file/.test(l)),
    'and keeps it off the screen');

  /* A quoted redirect is data, exactly like a quoted pipe or `&&`. */
  assert.deepEqual(await runClean("echo 'a 2>&1 b'"), ['a 2>&1 b'], 'quoted operators are not redirections');

  await page.evaluate(() => {
    for (const f of ['~/merged.txt', '~/separate.txt', '~/both.txt', '~/both2.txt']) window.browserOS.fs.rm(f);
  });
  await closeApp('terminal');
});

test('terminal: Ctrl+R searches the command history instead of retyping it', async () => {
  await openApp('terminal');

  for (const cmd of ['echo findme-one', 'ls ~', 'echo findme-two']) await runCommand(cmd);
  await page.waitForTimeout(200);

  await page.press(TERM_INPUT, 'Control+r');
  await page.waitForTimeout(150);
  assert.match(await page.inputValue(TERM_INPUT), /reverse-i-search/, 'the prompt must say it is searching');

  /* Typing narrows the search; the newest match comes first, as in a real shell. */
  await page.keyboard.type('findme');
  await page.waitForTimeout(150);
  let value = await page.inputValue(TERM_INPUT);
  assert.match(value, /findme/, 'the query must be visible in the prompt');
  assert.match(value, /echo findme-two/, 'the most recent command containing it is the one to offer');

  /* Ctrl+R again walks further back, and says how far. */
  await page.press(TERM_INPUT, 'Control+r');
  await page.waitForTimeout(150);
  value = await page.inputValue(TERM_INPUT);
  assert.match(value, /echo findme-one/, 'Ctrl+R again must offer the older match');
  assert.match(value, /2\/2/, 'and say which of the matches this is');

  /* Enter accepts it into the prompt line — it does not run it unseen. */
  const linesBefore = await page.evaluate(() => document.querySelector('.window[data-app="terminal"] .term-out').childElementCount);
  await page.press(TERM_INPUT, 'Enter');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue(TERM_INPUT), 'echo findme-one', 'Enter puts the found command where you can still edit it');
  assert.equal(await page.evaluate(() => document.querySelector('.window[data-app="terminal"] .term-out').childElementCount), linesBefore,
    'accepting a search must not run it behind your back');

  /* Escape abandons the search and gives you back what you were typing. */
  await page.fill(TERM_INPUT, 'echo half-writt');
  await page.press(TERM_INPUT, 'Control+r');
  await page.keyboard.type('zzz');
  await page.waitForTimeout(120);
  await page.press(TERM_INPUT, 'Escape');
  await page.waitForTimeout(120);
  assert.equal(await page.inputValue(TERM_INPUT), 'echo half-writt', 'Escape must not lose the line you were writing');

  await runCommand('clear');
  await closeApp('terminal');
});

test('mkdir -p is a flag, not a folder called "-p"', async () => {
  await closeAll();
  await openApp('terminal');
  const lastLine = async (cmd) => {
    await runCommand(cmd);
    await page.waitForTimeout(150);
    const lines = await page.locator('.window[data-app="terminal"] .term-out > div').allTextContents();
    return lines[lines.length - 1] ?? '';
  };

  /* Two separate claims, both of which the old code failed: the dash is a flag, and a directory
     that is already there is not "created" a second time. */
  assert.match(await lastLine('mkdir -p ~/deep/a/b'), /created ~\/deep\/a\/b/);
  assert.ok(await page.evaluate(() => !!window.browserOS.fs.getNode('/home/user/deep/a/b')), 'the parents were created');
  assert.ok(!(await page.evaluate(() => window.browserOS.fs.list('/home/user').map((e) => e.name))).includes('-p'),
    'no directory called "-p" was created in the home folder');
  assert.match(await lastLine('mkdir ~/deep/a/b'), /already exists/, 'a second mkdir says what actually happened');

  await runCommand('rm -r ~/deep');
  await closeAll();
});

test('terminal: NAME=value defines a variable you can see, expand and unset', async () => {
  await closeAll();
  await openApp('terminal');
  const lastLine = async (cmd) => {
    await runCommand(cmd);
    await page.waitForTimeout(150);
    const lines = await page.locator('.window[data-app="terminal"] .term-out > div').allTextContents();
    return lines[lines.length - 1] ?? '';
  };
  const out = () => page.locator('.window[data-app="terminal"] .term-out > div').allTextContents();

  /* The whole point of a variable is that it is *listable*. A value you cannot print is a
     second hidden state in a shell whose entire job is to be inspectable. */
  assert.match(await lastLine('set'), /no variables defined yet/);
  await lastLine('GREETING=hello');
  assert.equal(await lastLine('echo $GREETING'), 'hello');
  await runCommand('set');
  await page.waitForTimeout(150);
  const listed = (await out()).map((l) => l.trim());
  assert.ok(listed.includes('GREETING="hello"'), `set must list the variable by name, with its value quoted so an empty one is distinguishable from a missing one. Saw ${JSON.stringify(listed)}`);

  /* The two rules that make a variable usable rather than a surprise, both inherited from the
     built-ins and both re-asserted here for a name the user chose. */
  assert.equal(await lastLine('echo "$GREETING"'), '$GREETING', 'quoting stops expansion');
  assert.equal(await lastLine('echo $NOPE'), '$NOPE', 'an unknown name is left exactly as typed');

  /* A value with a space in it is one value, not two words — which is the reason tokens carry
     which *parts* were quoted rather than whether the whole word was. */
  await lastLine('export SIGN="out to sea"');
  assert.equal(await lastLine('echo $SIGN'), 'out to sea');
  assert.equal(await lastLine('echo "$SIGN"'), '$SIGN');

  /* A variable is a path like any other, in an argument and in a redirect target. */
  await lastLine('DOCS=~/Documents');
  assert.match(await lastLine('ls $DOCS'), /notes\.md/);
  await lastLine('echo written by a variable > $DOCS/from-var.txt');
  assert.match(await page.evaluate(() => window.browserOS.fs.read('/home/user/Documents/from-var.txt')), /written by a variable/);
  /* Expansion happens before globbing, so a variable can name the directory a pattern runs in. */
  assert.match(await lastLine('ls $DOCS/*.md'), /notes\.md/);

  /* `a=b` after a command name is an argument, not an assignment: `echo a=b` must still print
     `a=b`, and `FOO=1 ls` must still run ls. */
  assert.equal(await lastLine('echo a=b'), 'a=b');
  assert.match(await lastLine('FOO=1 pwd'), /\/home\/user/);
  await lastLine('unset FOO');

  /* The built-ins are not yours to overwrite — `HOME=/tmp` silently turning `cd ~` into a trip
     to a directory that does not exist is worse than refusing. */
  assert.match(await lastLine('HOME=/tmp'), /cannot be assigned/);
  assert.equal(await lastLine('echo $HOME'), '/home/user');
  assert.match(await lastLine('unset HOME'), /set by the shell, not by you/);
  assert.match(await lastLine('unset NOPE'), /no such variable/);

  await lastLine('unset GREETING');
  assert.equal(await lastLine('echo $GREETING'), '$GREETING', 'unset really removes it');
  assert.equal(await lastLine('echo $SIGN'), 'out to sea', 'and only it');
  await lastLine('unset SIGN');
  await lastLine('unset DOCS');
  assert.match(await lastLine('set'), /no variables defined yet/);

  /* Tab completes your own names as well as the shell's. */
  await lastLine('MYDIR=~/Documents');
  await page.fill(TERM_INPUT, 'ls $MY');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'ls $MYDIR');
  await page.fill(TERM_INPUT, '');
  await lastLine('unset MYDIR');

  /* A variable is this shell's session. A new terminal is a new shell. */
  await lastLine('KEPT=visible');
  await closeApp('terminal');
  await openApp('terminal');
  assert.equal(await lastLine('echo $KEPT'), '$KEPT', 'a restored terminal does not inherit variables it never defined');

  /* And the manual can be asked about it. */
  await runCommand('man variables');
  const man = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(man, /NAME=value/, 'man variables must describe the syntax');
  assert.match(man, /cannot be assigned/, 'and the built-in rule');

  await closeAll();
});

test('terminal: * and ? match names, and a quoted glob is just a name', async () => {
  await closeAll();
  await openApp('terminal');
  await runCommand('mkdir ~/globtest && cd ~/globtest');
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    for (const [name, body] of [['a1.txt', 'one\n'], ['a2.txt', 'two\n'], ['b.md', 'three\n'], ['note.md', 'four\n'], ['note7.md', 'five\n'], ['note22.md', 'six\n']]) {
      fs.write(`/home/user/globtest/${name}`, body);
    }
  });
  /* Run one command on a clean screen and return only what it printed. */
  const runClean = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(150);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  /* The expansion is the whole feature: one word becomes every name it matches, and only those. */
  assert.deepEqual(await runClean('ls *.txt'), ['a1.txt', 'a2.txt'], 'ls *.txt must expand to both matches and nothing else');
  assert.deepEqual(await runClean('ls a*.md'), ['ls: no such directory: /home/user/globtest/a*.md'], 'a pattern that matches nothing is left as typed, so ls can say what it could not find');
  assert.deepEqual(await runClean('ls *.md'), ['b.md', 'note.md', 'note22.md', 'note7.md'], '*.md matches every .md file, in the order ls lists them');

  /* `?` is exactly one character — the difference between a glob and a prefix. */
  assert.deepEqual(await runClean('ls note?.md'), ['note7.md'], '? matches exactly one character: note7.md matches, note.md and note22.md do not');

  /* A pattern that matches nothing is left exactly as typed, so the command can say what
     happened — the same rule as an unknown variable, for the same reason. */
  assert.match((await runClean('cat *.nope'))[0], /no such file: .*\.nope/);
  assert.deepEqual(await runClean('echo "*.txt"'), ['*.txt'], 'quoting stops a glob, exactly as it stops $HOME');
  assert.deepEqual(await runClean("echo 'a1.txt'"), ['a1.txt'], 'and a quoted name is still that name');

  /* Several matches means several file arguments, and the commands that take them have to say
     what each one did rather than quietly using the first. */
  assert.deepEqual(await runClean('wc -l *.txt'), ['      1 a1.txt', '      1 a2.txt', '      2 total'],
    'wc must count every match, name each one, and total them');
  assert.deepEqual(await runClean('cat a1.txt | cat'), ['one'], 'a pipe is unaffected');

  await runClean('rm *.txt');
  assert.deepEqual(await page.evaluate(() => window.browserOS.fs.list('/home/user/globtest').map((e) => e.name).filter((n) => n.endsWith('.txt'))),
    [], 'rm *.txt removed both matches');

  /* A glob against an absolute path, and against a directory that does not exist: neither is
     allowed to fail silently. */
  assert.ok((await runClean('ls ~/Documents/*')).includes('notes.md'));
  assert.match((await runClean('ls /nope/*'))[0], /no such directory: \/nope/);

  /* A glob is not a name: a quoted one is a path, and no file is called `*.md`. */
  assert.match((await runClean('ls "*.md"'))[0], /no such directory: \/home\/user\/globtest\/\*\.md/);

  await runCommand('cd ~ && rm -r globtest');
  await closeAll();
});

/* Run one command on a clean screen and return only what it printed — no echoed prompt, no
   blank lines. Several of the tests below need to compare an *exact* list of output lines, and
   filtering the prompt out is the only way to tell "this command printed nothing" from "the
   prompt is here". */
const cleanRuns = async (cmd) => {
  await runCommand('clear');
  await page.waitForTimeout(150);
  await runCommand(cmd);
  await page.waitForTimeout(200);
  const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
  return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
};

test('terminal: $(command) runs a command and puts its output where you typed it', async () => {
  await closeAll();
  await openApp('terminal');
  await runCommand('mkdir ~/subtest && cd ~/subtest');
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.write('/home/user/subtest/a.txt', 'one\ntwo\n');
    fs.write('/home/user/subtest/b.txt', 'three\n');
  });

  /* The expansion itself: a command becomes its output, in the middle of a word if that is where
     it was typed. */
  assert.deepEqual(await cleanRuns('echo $(pwd)'), ['/home/user/subtest']);
  assert.deepEqual(await cleanRuns('echo $(echo hi)'), ['hi'], 'the simplest case, and the one that has to work for the rest to');
  assert.deepEqual(await cleanRuns('echo $(pwd)/a.txt'), ['/home/user/subtest/a.txt'], 'a substitution is a fragment of a path, not a whole argument');
  assert.deepEqual(await cleanRuns('echo a $(true) b'), ['a b'], 'a command that prints nothing expands to nothing');
  assert.deepEqual(await cleanRuns('echo "$(pwd)"'), ['$(pwd)'], 'quoting stops it, exactly as it stops $HOME — a quoted word is a literal word in this shell');

  /* An unquoted result is a *list*: the output of a command is several values, where the value of
     a variable is one. Without this, `wc -l $(echo a.txt b.txt)` counts one file named "a.txt
     b.txt", which is a wrong answer that looks like an answer. */
  assert.deepEqual(await cleanRuns('wc -l $(echo a.txt b.txt)'),
    ['      2 a.txt', '      1 b.txt', '      3 total'], 'a substituted list becomes several file arguments');

  /* The inner command is a whole command. `;`, `&&`, `||` and `|` inside $( ) belong to it —
     splitting them at the outer level would run half of it in the wrong place. */
  assert.deepEqual(await cleanRuns('echo $(echo one; echo two)'), ['one two'], 'the ; inside $( ) is the inner command’s');
  assert.deepEqual(await cleanRuns('echo $(false || echo fallback)'), ['fallback'], 'so is the ||');
  assert.deepEqual(await cleanRuns('echo $(cat a.txt b.txt | head -n 1)'), ['one'], 'and so is the pipe');
  assert.deepEqual(await cleanRuns('echo $(echo $(echo deep))'), ['deep'], 'nesting works');
  const nest = (n, inner) => `echo ${'$(echo '.repeat(n)}${inner}${')'.repeat(n)}`;
  assert.deepEqual(await cleanRuns(nest(4, 'hi')), ['hi'], 'and it works several levels deep');

  /* An assignment and a redirect target may both be the output of a command. */
  assert.deepEqual(await cleanRuns('HERE=$(pwd); echo $HERE'), ['/home/user/subtest'], 'FOO=$(pwd) is an assignment whose value is a command');
  await cleanRuns('echo written > $(echo target.txt)');
  assert.equal((await page.evaluate(() => window.browserOS.fs.read('/home/user/subtest/target.txt'))).trim(), 'written',
    'a redirect target may be a substitution');

  /* The inner command's *errors* are not captured: they go to the screen. That is what makes a
     failed substitution a visible empty one instead of a silent one. */
  const failed = await cleanRuns('echo [$(cat nope.txt)]');
  assert.ok(failed.some((l) => /no such file/.test(l)), `the missing file was swallowed: ${JSON.stringify(failed)}`);
  assert.ok(failed.some((l) => l.includes('[]')), 'the substitution itself expanded to nothing, which is the point');

  /* And the recursion has a floor: a shell that loops forever is a hung browser tab. */
  const deep = nest(8, 'x');
  assert.ok((await cleanRuns(deep)).some((l) => /nested too deeply/.test(l)),
    'a substitution nested past the limit must say so rather than spin');

  /* help and man describe it, because a feature nobody can look up is a feature nobody uses. */
  await runCommand('help');
  const help = await page.textContent('.window[data-app="terminal"] .term-out');
  assert.match(help, /\$\(command\)/, 'help must document command substitution');
  assert.ok(!/command substitution/.test(help.split('Not supported:')[1] || ''), 'help must not still list it as unsupported');
  assert.match((await cleanRuns('man substitution')).join('\n'), /run a command and put its output/);
  /* `man` on its own used to answer “no manual entry for undefined”. An index is the answer that
     helps — and it is generated from the topic table, so the test asks the index what it lists and
     checks that every one of them answers, instead of comparing against a list typed out here too. */
  const index = (await cleanRuns('man')).join('\n');
  const listed = (index.match(/topics: ([a-z, ]+)\./) || [])[1]?.split(', ') || [];
  assert.ok(listed.length >= 4, `man must print an index of its topics, got ${JSON.stringify(index)}`);
  for (const topic of ['variables', 'aliases', 'globs', 'substitution'])
    assert.ok(listed.includes(topic), `the index must list ${topic}`);
  for (const topic of listed)
    assert.ok(!(await cleanRuns(`man ${topic}`)).some((l) => /no manual entry/.test(l)),
      `the index lists ${topic}, so man ${topic} must not say it has no entry`);

  await runCommand('cd ~ && rm -r subtest');
  await closeAll();
});

test('terminal: several files at once — grep names them, mv and cp take a directory, a glob in a redirect is a name', async () => {
  await closeAll();
  await openApp('terminal');
  await runCommand('mkdir ~/manyfiles && cd ~/manyfiles');
  await page.evaluate(() => {
    const fs = window.browserOS.fs;
    fs.write('/home/user/manyfiles/a.txt', 'alpha\nshared\n');
    fs.write('/home/user/manyfiles/b.txt', 'beta\nshared\n');
    fs.write('/home/user/manyfiles/nums.txt', '10\n9\n2\n');
  });

  /* Three matching lines from three files look exactly like three lines from one file. `grep` is
     the multi-file command where the answer is unreadable without the name, so the name goes on
     the line — and only when there is more than one file, because `grep x file` is not a report. */
  assert.deepEqual(await cleanRuns('grep shared a.txt b.txt'), ['a.txt:shared', 'b.txt:shared'],
    'several files means every match says which file it came from');
  assert.deepEqual(await cleanRuns('grep shared *.txt'), ['a.txt:shared', 'b.txt:shared'], 'including the files a glob produced');
  assert.deepEqual(await cleanRuns('grep -n shared a.txt b.txt'), ['a.txt:2: shared', 'b.txt:2: shared'],
    'line numbers are per file, as real grep numbers them');
  assert.deepEqual(await cleanRuns('grep shared a.txt'), ['shared'], 'one file needs no prefix');

  /* `sort -n notes.md`: `-n` is a mode here and a number in `head -n 5`. The shared list of
     "flags that eat the next word" got this wrong and read no file at all. */
  assert.deepEqual(await cleanRuns('sort -n nums.txt'), ['2', '9', '10'], 'sort -n <file> sorts the file, not nothing');

  /* Several names, last one a directory — the only reading that makes `mv *.txt out/` mean what
     it looks like it means. */
  await cleanRuns('mkdir out');
  assert.deepEqual(await cleanRuns('mv a.txt b.txt out/'),
    ['moved a.txt → ~/manyfiles/out/a.txt', 'moved b.txt → ~/manyfiles/out/b.txt'],
    'several names with a directory last: every one moves, and each says where it went');
  assert.deepEqual(await page.evaluate(() => window.browserOS.fs.list('/home/user/manyfiles/out').map((e) => e.name).sort()),
    ['a.txt', 'b.txt'], 'both files really moved, not just both messages');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/manyfiles/a.txt')), false,
    'a move is a move: the source is gone');
  const copied = await cleanRuns('cp out/*.txt .');
  assert.equal(copied.length, 2, `cp takes the same shape, glob included: ${JSON.stringify(copied)}`);
  assert.match((await cleanRuns('mv a.txt b.txt nowhere/'))[0], /target is not a directory/, 'and says so when the last name is not one');

  /* `cd` with several directories used to take whichever one sorted first. A decision the shell
     made on your behalf should be one you can see it refuse. */
  assert.match((await cleanRuns('cd a.txt b.txt'))[0], /too many arguments/);

  /* A redirect target is a name, never a pattern — bash agrees — but this filesystem is one you
     can open in Files afterwards, so the shell says what it just made instead of leaving a file
     called `*.out` to be explained later. */
  const redirected = await cleanRuns('echo x > *.out');
  assert.ok(redirected.some((l) => /wrote 1 line\(s\)/.test(l)), redirected.join('\n'));
  assert.ok(redirected.some((l) => /is a name, not a pattern/.test(l)), 'the shell must say it did not expand the glob');
  assert.equal(await page.evaluate(() => window.browserOS.fs.exists('/home/user/manyfiles/*.out')), true);

  await runCommand('cd ~ && rm -r manyfiles');
  await closeAll();
});

/* An alias is the one expansion that has to happen while words are still words: it stands for a
   command line, not for a value. Everything below is a consequence of that placement — the body is
   stored unexpanded, only the command word is looked up, and the body then goes through the same
   pipeline as a command you typed yourself. */
test('terminal: alias names a command, expands when it is used, and unalias takes it back', async () => {
  await closeAll();
  await openApp('terminal');
  await runCommand('mkdir ~/aliastest && cd ~/aliastest');
  await page.evaluate(() => window.browserOS.fs.write('/home/user/aliastest/one.txt', 'one line\n'));
  const runs = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(150);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  assert.deepEqual(await runs("alias show=cat"), ["alias show='cat'"], 'the definition says what was defined');
  assert.deepEqual(await runs('show one.txt'), ['one line'], 'and the name works where the command would have');

  /* The body is a whole command line, and it is tokenized like one: `-l` becomes a flag of `ls`,
     not an argument of `show`. */
  await runs("alias ll='ls -l'");
  const long = await runs('ll');
  assert.ok(long.some((l) => l.startsWith('-') && l.includes('one.txt')), `ls -l shape, not ls shape: ${JSON.stringify(long)}`);

  /* `alias ls='ls -l'` is the alias people write first, and the one an expansion loop dies on. */
  const shadow = await runs("alias ls='ls -l'");
  assert.ok(shadow.some((l) => /already means something/.test(l)), 'shadowing a command has to be said out loud');
  const shadowed = await runs('ls');
  assert.ok(shadowed.some((l) => l.startsWith('-') && l.includes('one.txt')), 'the alias is used instead of the command');
  assert.deepEqual(await runs('unalias ls'), ['unalias ls (ls is the command again)'], 'and it is reversible');
  assert.ok((await runs('ls')).every((l) => !l.startsWith('- ')), 'the real command is back');

  /* A quoted command word is a word you asked for literally — the same rule that stops $NAME and
     *.txt — so it is not looked up. */
  assert.ok((await runs('"ll"')).some((l) => /command not found/.test(l)), 'a quoted command name is not an alias');

  /* The body is stored exactly as typed. This is the difference between an alias and a variable:
     `$MYVAR` inside an alias means whatever it means on the day the alias is *used*. */
  await runs("alias greet='echo $MYVAR'");
  await runs('MYVAR=first');
  assert.deepEqual(await runs('greet'), ['first'], 'expanded when used');
  await runs('MYVAR=second');
  assert.deepEqual(await runs('greet'), ['second'], 'not frozen at the moment it was defined');

  /* An alias body goes through the whole pipeline, so it can be a chain or a filter. */
  await runs("alias upper='tr a-z A-Z'");
  assert.deepEqual(await runs('echo hi | upper'), ['HI'], 'an alias may be the far end of a pipe');
  await runs("alias here='pwd'");
  assert.deepEqual(await runs('echo $(here)'), ['/home/user/aliastest'], '…or a substitution');

  /* An alias body is a command line, so the operators *in* it are operators. Expanded after the
     split into commands, `&&` would be an argument of `cd`. */
  await runs("alias go='cd ~/aliastest && pwd'");
  assert.deepEqual(await runs('go'), ['/home/user/aliastest'], 'an alias body may chain with &&');
  await runs("alias back='pwd | cat'");
  assert.deepEqual(await runs('back'), ['/home/user/aliastest'], '…and may contain a pipe of its own');

  /* Listing, naming one, and refusing to pretend it removed something it never had. */
  const listed = await runs('alias');
  assert.ok(listed.some((l) => l === "alias show='cat'") && listed.some((l) => l === "alias greet='echo $MYVAR'"),
    `alias with no argument lists them: ${JSON.stringify(listed)}`);
  assert.deepEqual(await runs('alias show'), ["alias show='cat'"]);
  assert.ok((await runs('alias nope')).some((l) => /no alias defined for nope/.test(l)));
  assert.ok((await runs('unalias nope')).some((l) => /no alias defined for nope/.test(l)));

  /* Tab completes your own names too — they are commands as far as the prompt is concerned. */
  await page.fill(TERM_INPUT, 'sho');
  await page.press(TERM_INPUT, 'Tab');
  assert.equal(await page.inputValue(TERM_INPUT), 'show ', 'Tab knows the alias');
  await page.fill(TERM_INPUT, '');

  /* Aliases are this shell's session, like variables: a new terminal starts without them. */
  await closeAll();
  await openApp('terminal');
  assert.ok((await runs('show one.txt')).some((l) => /command not found/.test(l)),
    'a new terminal is a new shell, and a new shell has no aliases');

  await runCommand('cd ~ && rm -r aliastest');
  await closeAll();
});

test('terminal: sed and tr edit the lines a pipeline carries', async () => {
  await closeAll();
  await openApp('terminal');
  await runCommand('mkdir ~/editpipe && cd ~/editpipe');
  await page.evaluate(() => window.browserOS.fs.write('/home/user/editpipe/notes.txt', 'alpha note\nbeta note\ngamma\n'));
  const runs = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(150);
    await runCommand(cmd);
    await page.waitForTimeout(200);
    const text = await page.locator('.window[data-app="terminal"] .term-out').innerText();
    return text.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  assert.deepEqual(await runs("echo 'hello world' | sed 's/world/there/'"), ['hello there'], 'the one-liner everything else here stops short of');
  assert.deepEqual(await runs("echo 'hello world' | sed 's/o/0/g'"), ['hell0 w0rld'], 'g means every match, not the first');
  assert.deepEqual(await runs("echo 'Hello' | sed 's/h/H/'"), ['Hello', 'sed: s/h/H/ matched none of 1 line(s)'],
    'a substitution that matched nothing says so instead of looking like it worked');
  assert.deepEqual(await runs("echo 'Hello' | sed 's/h/H/i'"), ['Hello'], 'and i is the one that matches across case');
  assert.deepEqual(await runs("echo 'a/b' | sed 's|a/b|c|'"), ['c'], 'the delimiter is whatever comes after s, so a path needs no backslashes');
  assert.deepEqual(await runs("echo 'x1y' | sed 's/1/&&/'"), ['x11y'], '& is the part that matched');
  assert.deepEqual(await runs("echo 'a$b' | sed 's/a/-/'"), ['-$b'], 'a $ in a replacement stays a $, not a backreference');

  assert.deepEqual(await runs("sed '/note/d' notes.txt"), ['gamma'], 'and /find/d is the other half of it');
  assert.deepEqual(await runs("grep note notes.txt | sed 's/ note//'"), ['alpha', 'beta'], 'the two commands people actually chain');
  assert.deepEqual(await runs("sed 's/a/A/' notes.txt"), ['Alpha note', 'betA note', 'gAmma'],
    'a file argument works too, and without g it is one replacement per line — which is what g is for');

  /* A substitution that matched nothing looks exactly like one that worked. Saying how many lines
     it touched is the difference between "it ran" and "it did what you asked". */
  assert.ok((await runs("sed 's/zzz/x/' notes.txt")).some((l) => /matched none of 3 line/.test(l)),
    'sed must not silently do nothing');

  assert.ok((await runs("sed 's/(/x/'")).some((l) => /not a pattern I can use/.test(l)), 'an unbalanced pattern is named');
  assert.ok((await runs('sed -n')).some((l) => /I only know s\//.test(l)), 'an unsupported expression says what is supported');

  assert.deepEqual(await runs('echo hi | tr a-z A-Z'), ['HI'], 'ranges are the reason anyone types tr');
  assert.deepEqual(await runs('echo hello | tr -d ae'), ['hllo'], 'and -d deletes a set');
  assert.deepEqual(await runs('echo abc | tr a-z x'), ['xxx'], 'a short set2 is the shorthand real tr uses');
  assert.deepEqual(await runs('echo a-b | tr -+ _'), ['a_b'], 'a - at either end is a literal');
  assert.ok((await runs('echo x | tr z-a b')).some((l) => /range the wrong way round/.test(l)));
  assert.ok((await runs('tr a-z A-Z notes.txt')).some((l) => /reads the pipe/.test(l)),
    'tr has no file arguments, and saying so beats reading the file as set2');
  assert.deepEqual(await runs('tr a-z A-Z < notes.txt'), ['ALPHA NOTE', 'BETA NOTE', 'GAMMA'], 'but < is a pipe like any other');

  await runCommand('cd ~ && rm -r editpipe');
  await closeAll();
});

/* `help` used to be a command list followed by eleven paragraphs: a manual pretending to be a
   prompt, and the longer the shell got the more it read as a wall to scroll past. What it is now
   is an index, and an index has properties that can be checked: every command is filed under a
   group, every feature line points at a page that exists, and nothing printed is wider than the
   window it is printed in. */
test('terminal: help is an index, and every pointer in it resolves', async () => {
  await closeAll();
  await openApp('terminal');
  const runs = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(250);
    return (await page.locator('.window[data-app="terminal"] .term-out').innerText())
      .split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };
  const help = await runs('help');
  const text = help.join('\n');

  for (const group of ['Files', 'Text', 'Shell', 'Apps & desktop', 'System'])
    assert.ok(help.some((l) => l.trim() === group), `help must file commands under a "${group}" group`);
  /* The label only prints when a command actually landed there, so this is a drift guard: add a
     command to the table and forget to file it, and help shows it under a name that says so. */
  assert.ok(!/Ungrouped/.test(text), `every command must be filed in a group; help printed:
${text}`);
  assert.ok(!/Available commands:/.test(text), 'help is no longer one flat list of everything');

  for (const name of ['cat', 'grep', 'sed', 'tr', 'source', 'alias', 'man', 'ls', 'wc', 'wallpaper'])
    assert.ok(help.some((l) => l.trim().split(/\s+/)[0] === name), `help must list the ${name} command`);

  /* The features that are not commands have to be reachable from here — that is the entire reason
     the index exists. Every `man <topic>` help points at must answer. (Flattened first: a long
     entry wraps, and its pointer may land on the continuation line.) */
  const flat = help.join(' ').replace(/\s+/g, ' ');
  const pointers = [...new Set([...flat.matchAll(/\bman ([a-z]+)\b/g)].map((m) => m[1]))];
  for (const topic of ['variables', 'globs', 'substitution', 'aliases', 'pipes', 'startup'])
    assert.ok(pointers.includes(topic), `help must point at the ${topic} topic`);
  for (const topic of pointers) {
    const page = await runs(`man ${topic}`);
    assert.ok(!page.some((l) => /no manual entry/.test(l)), `help points at man ${topic}, which does not exist`);
    assert.ok(page.length > 1, `man ${topic} must be a page, not a stub`);
  }

  /* The regression this is really guarding: a description that runs past the window wraps to column
     0, and a table that wraps to column 0 is a paragraph again. The budget is the window's own, not
     a number typed here — the shell wraps to the width it has, and this window is resizable. */
  const limit = await termColumns();
  const widest = help.reduce((m, l) => Math.max(m, l.length), 0);
  assert.ok(widest <= limit, `help must fit the terminal window it prints into (${limit} columns); widest line is ${widest}:
${help.filter((l) => l.length > limit).join('\n')}`);
  await closeApp('terminal');
});

/* ~/.shellrc: the one place where a *file* changes what the shell means, and `source`, the way to
   read one without opening a terminal. Both are only worth having if the file stays visible —
   listed by `ls`, editable, reported when it is read — so that is what these assert. */
test('terminal: ~/.shellrc runs when a terminal opens, and source runs a file in this shell', async () => {
  await closeAll();
  await openApp('terminal');
  const out = () => page.locator('.window[data-app="terminal"] .term-out').innerText();
  const runs = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(250);
    return (await out()).split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  /* The seeded file is the feature. A shell that never typed `alias` already has `ll`. */
  const boot = await out();
  assert.match(boot, /~\/\.shellrc: ran \d+ line\(s\) and defined 2 alias\(es\)/,
    'a terminal must say out loud what its startup file did');
  assert.match(boot, /man startup/, 'and point at the page that explains it');
  assert.ok((await runs('ls -a')).some((l) => l === '.shellrc'), 'the startup file must be a visible file, not hidden shell state');

  const listing = await runs('ll');
  assert.ok(listing.some((l) => /^[-d]\s.*\s\.shellrc$/.test(l) && /\d{4}-\d\d-\d\d \d\d:\d\d/.test(l)),
    `ll must be the \`ls -l\` the startup file defines, got ${JSON.stringify(listing)}`);
  assert.ok((await runs('docs')).some((l) => l === 'notes.md'), 'an alias body may be a whole command line');
  assert.match((await runs('pwd')).join('\n'), /\/Documents$/, '`docs` really changed directory');

  /* Undoable, like everything else in this shell. */
  assert.match((await runs('unalias ll')).join('\n'), /unalias ll/);
  assert.ok((await runs('ll')).some((l) => /not found/.test(l)), 'unalias must survive the startup file');

  /* A file is not a session: a new terminal reads it again. */
  await closeApp('terminal');
  await openApp('terminal');
  assert.ok((await runs('ll')).some((l) => /\.shellrc$/.test(l)), 'a new terminal reads ~/.shellrc again');

  /* `source` is the same machinery, aimed at a file you choose. */
  await runCommand("echo '# a file I wrote' > ~/rc-test.sh");
  await page.waitForTimeout(150);
  await runCommand("echo '' >> ~/rc-test.sh");
  await page.waitForTimeout(120);
  await runCommand("echo 'export RCVAR=from-file' >> ~/rc-test.sh");
  await page.waitForTimeout(120);
  await runCommand("echo 'alias rcalias=\'echo aliased\'' >> ~/rc-test.sh");
  await page.waitForTimeout(120);
  await runCommand("echo 'cat does-not-exist-in-rc.txt' >> ~/rc-test.sh");
  await page.waitForTimeout(150);
  const sourced = await runs('source ~/rc-test.sh');
  assert.ok(sourced.some((l) => /source: ran 3 line\(s\) from ~\/rc-test\.sh/.test(l)),
    `source must say how much of the file it ran, got ${JSON.stringify(sourced)}`);
  assert.ok(sourced.some((l) => /1 of 3 line\(s\) failed/.test(l)), 'a file that half-worked has to say so');
  assert.ok(sourced.some((l) => /no such file.*does-not-exist-in-rc/.test(l)), 'and name the line that failed');
  assert.match((await runs('echo $RCVAR')).join('\n'), /from-file/, 'a sourced assignment is this shell’s');
  assert.ok((await runs('rcalias')).some((l) => l === 'aliased'), 'a sourced alias is live');
  assert.ok((await runs('set')).some((l) => /RCVAR="from-file"/.test(l)), 'and it is listed like any other');

  const missing = await runs('source ~/nope.rc');
  assert.ok(missing.some((l) => /source:.*nope\.rc/.test(l)), 'a missing file must be named, not ignored');

  /* The loop guard: a file whose last line is `source` on itself is a hung tab without it. */
  await runCommand("echo 'source ~/loop.rc' > ~/loop.rc");
  await page.waitForTimeout(150);
  const loop = await runs('source ~/loop.rc');
  assert.ok(loop.some((l) => /already running/.test(l)), `a file that sources itself must be refused, got ${JSON.stringify(loop)}`);

  assert.match((await runs('man startup')).join('\n'), /~\/\.shellrc/, 'man must explain the startup file');
  await runCommand('rm ~/rc-test.sh ~/loop.rc');
  await page.waitForTimeout(150);
  await closeApp('terminal');
});

/* `sed` and `tr` are documented subsets. A subset is only honest if the page that documents it and
   the code that implements it agree, in both directions: everything the page names works, and
   everything the page does not name is refused with the page's own words. */
test('terminal: sed and tr accept exactly what their own manual says they accept', async () => {
  await closeAll();
  await openApp('terminal');
  const runs = async (cmd) => {
    await runCommand('clear');
    await page.waitForTimeout(120);
    await runCommand(cmd);
    await page.waitForTimeout(250);
    return (await page.locator('.window[data-app="terminal"] .term-out').innerText())
      .split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.includes('$ '));
  };

  const sedUsage = (await runs('man sed')).join('\n');
  assert.match(sedUsage, /s\/find\/replace\/\[gi\]/, 'man sed must name the substitution form');
  assert.match(sedUsage, /\/find\/d/, 'man sed must name the delete form');
  const trUsage = (await runs('man tr')).join('\n');
  assert.match(trUsage, /tr \[-d\] <set1> \[set2\]/, 'man tr must name the only forms it has');

  const sedFile = async () => {
    for (const [op, line] of [['>', 'one'], ['>>', 'two'], ['>>', 'three']]) {
      await runCommand(`echo ${line} ${op} ~/sedtest.txt`);
      await page.waitForTimeout(140);
    }
  };
  await sedFile();

  const works = [
    ['echo aaa | sed \'s/a/b/\'', ['baa'], 'first match only'],
    ['echo aaa | sed \'s/a/b/g\'', ['bbb'], 'g replaces every match'],
    ['echo Aa | sed \'s/a/b/i\'', ['ba'], 'i ignores case, and without g only the first match moves'],
    ['echo Aa | sed \'s/a/b/gi\'', ['bb'], 'g and i together'],
    ['cat ~/sedtest.txt | sed \'/two/d\'', ['one', 'three'], 'the delete form'],
    ['echo aXb | sed \'s/X/&-&/\'', ['aX-Xb'], 'the replacement may name the match'],
    ['echo ab | sed \'s/(a)(b)/[&]/\'', ['[ab]'], 'the pattern is a real regular expression, and & stands for what matched'],
  ];
  for (const [cmd, want, why] of works) {
    const got = await runs(cmd);
    assert.deepEqual(got, want, `${cmd} — ${why}`);
  }

  const refuses = [
    ['echo a | sed \'1,3s/a/b/\'', /I only know s\/find\/replace/, 'line addresses are not this sed'],
    ['echo a | sed \'-e s/a/b/\'', /I only know s\/find\/replace/, 'no -e'],
    ['echo a | sed \'s/a/b/x\'', /flags here are g and i/, 'an unknown flag must not be quietly ignored'],
    ['echo a | sed \'s/a/\'', /I only know s\/find\/replace/, 'a half-typed expression'],
    ['echo a | sed \'/a/x\'', /I only know s\/find\/replace/, 'the delete form only'],
    ['echo a | sed', 'usage: sed', 'with no expression, the usage'],
    ['echo a | tr -s a', /not a flag this tr has/, 'an unknown tr flag must not become a character set'],
    ['echo a | tr a', /what should the characters become/, 'one set is not a translation'],
    ['tr a-z A-Z /etc/motd', /no file arguments/, 'tr reads the pipe or a < redirect, not file arguments'],
  ];
  for (const [cmd, want, why] of refuses) {
    const got = await runs(cmd);
    const text = got.join('\n');
    assert.ok(got.length, `${cmd} must say something: ${why}`);
    if (want instanceof RegExp) assert.ok(want.test(text), `${cmd} must refuse (${why}), got ${JSON.stringify(text)}`);
    else assert.ok(text.includes(want), `${cmd} must say ${want}, got ${JSON.stringify(text)}`);
  }
  await runCommand('rm ~/sedtest.txt');
  await page.waitForTimeout(150);
  await closeApp('terminal');
});

test('df reports the measured quota, not a made-up one', async () => {
  await resetStorage();
  await openApp('terminal');
  await runCommand('df');
  const out = await page.textContent(`.window[data-app="terminal"]`);
  assert.match(out, /capacity\s+\d[^\n]*measured by probing/, 'df must show a measured capacity');
  assert.match(out, /free\s+\d/, 'df must show the free space');
  await closeApp('terminal');
});

/* `help` and `man` are written at a width, and the window is not. A table wrapped for the default
   terminal turns back into a paragraph the moment it is dragged narrow — the continuation lines jump
   to column 0 and the column the text belongs to is gone. So the claim to test is not “it fits at
   700px”, it is “it fits at the narrowest width the window can be”. */
test('terminal: help and man wrap to the width the window actually has', async () => {
  await openApp('terminal');
  /* Measured the way the terminal measures it: the font is monospace, so one glyph is the answer. */
  const cols = termColumns;
  /* innerText does not gain newlines where the browser soft-wraps, so a line longer than the
     window is a line the shell failed to wrap itself. */
  const widest = async () => Math.max(...(await page.locator('.term-out').innerText())
    .split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !l.includes('$ ')).map((l) => l.length));

  for (const w of [700, 480, 340]) {
    await page.evaluate((w) => {
      const wn = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
      wn.el.style.width = `${w}px`;
    }, w);
    await page.waitForTimeout(250);
    const limit = await cols();
    assert.ok(limit >= 24, `a ${w}px terminal reports ${limit} columns, which is not a width anything can read`);
    for (const cmd of ['help', 'man pipes', 'man startup']) {
      await runCommand('clear');
      await page.waitForTimeout(120);
      await runCommand(cmd);
      await page.waitForTimeout(220);
      const max = await widest();
      assert.ok(max <= limit, `${cmd} in a ${w}px terminal (${limit} columns) left a line ${max} characters wide — the browser wrapped it, which is what wrapping here exists to prevent`);
    }
  }
  /* And the hanging indent survived the narrow case: a continuation is still under its column. */
  await runCommand('clear'); await page.waitForTimeout(120);
  await runCommand('help'); await page.waitForTimeout(250);
  const lines = (await page.locator('.term-out').innerText()).split('\n').filter((l) => l && !l.includes('$ '));
  const continued = lines.filter((l) => /^ {8,}\S/.test(l) && !/^ {4}\S/.test(l));
  assert.ok(continued.length >= 3, `a wrapped table should still have indented continuations at 340px, saw ${JSON.stringify(lines.slice(0, 6))}`);
  await closeApp('terminal');
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
