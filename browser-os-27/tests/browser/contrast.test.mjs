/**
 * Rendered-text contrast, measured from pixels.
 *
 * tests/token-contrast.test.mjs checks the *declarations*. This one checks the result, because a
 * stylesheet can compose a background nobody declared: a translucent taskbar over a wallpaper, a
 * gradient plate behind a desktop icon, a dialog scrim over the whole screen. Every failure this
 * audit found in its first run was one of those — including the one every previous iteration's
 * token checks had missed, which is that the light theme wrote its near-black ink on a terminal
 * canvas that stays dark in both themes.
 *
 * The rules the audit applies (occlusion, decorative glyphs, disabled controls) are written out in
 * tests/contrast.mjs. What is chosen here is which *states* to measure: the shell, the states a
 * user reaches for (Start menu, context menu, a modal), a terminal that has actually printed
 * something, the app with the most chrome in it, and every registered app once. Each of the
 * shell states in both themes; the app sweep in one.
 *
 * Each of those carries a coverage claim as well as a contrast claim: the strings that must have
 * been measured. "No problems among 40 runs" is only reassuring if those runs are the ones a user
 * reads — a screen that hid half of its labels would still clear a floor of ten runs.
 */
import assert from 'node:assert/strict';
import { test, page, desktop } from './fixture.mjs';
import { auditContrast, assertReadable } from '../contrast.mjs';

const setTheme = (theme, accent = 'blue') => page.evaluate(([t, a]) => {
  window.browserOS.theme.set('theme', t);
  window.browserOS.theme.set('accent', a);
}, [theme, accent]);

const maximize = async (id) => {
  await desktop.openApp(id);
  await page.evaluate(() => {
    for (const w of window.browserOS.wm.windows.values()) if (!w.maximized) window.browserOS.wm.toggleMaximize(w.id);
  });
  await page.waitForTimeout(350);
};

const audit = async (label, opts) => assertReadable(await auditContrast(page, ['body']), label, opts);

/* Both themes, because the whole class of bug this audit exists to catch is a token that is only
   correct in one of them. */
for (const theme of ['dark', 'light']) {
  test(`the shell reads in the ${theme} theme`, async () => {
    await setTheme(theme);
    await desktop.closeAll();
    /* The tray line is the dimmest text on the desktop, and the app icons are labels painted on a
       wallpaper. Naming them is what turns "no problems" into "this screen was read". */
    await audit(`${theme}: desktop, taskbar and tray`, { expect: [/\d+ window/, /\d+ files/, 'Terminal', 'Files'] });

    await page.click('.start-btn');
    await page.waitForTimeout(250);
    await audit(`${theme}: Start menu`, { expect: ['Terminal', 'Settings'] });
    await page.keyboard.press('Escape');

    await page.click('.desktop', { position: { x: 700, y: 400 }, button: 'right' });
    await page.waitForTimeout(250);
    /* A left click does not open a context menu, and an audit of `body` cannot tell the
       difference between the menu and the desktop behind it — which is exactly the kind of claim
       this file used to be unable to make. `Paste` is the one label in the OS allowed to sit at
       3:1, because it is disabled with nothing on the clipboard; it is named here as a *skip*,
       so the disabled rule cannot quietly grow to cover something that is not disabled. */
    const ctxMenu = await auditContrast(page, ['body']);
    assertReadable(ctxMenu, `${theme}: desktop context menu`, {
      minRuns: 6, expect: ['New folder', 'New file', 'Open terminal here', 'Display settings', 'Refresh'],
    });
    assert.ok(ctxMenu.skipped.disabled >= 1, `${theme}: desktop context menu: no run was skipped as disabled, so "Paste" was measured against the bar for a disabled control`);
    await page.keyboard.press('Escape');

    /* A modal, with the desktop still behind it. Everything under the scrim is inert and is not
       measured, so what is left is the dialog itself — title, message, both buttons. That is the
       point: a dialog paints its own surface, on top of a background no token was written for. */
    await page.evaluate(() => { void window.browserOS.dialogs.confirm({ title: 'Delete?', message: 'This cannot be undone.', danger: true }); });
    await page.waitForTimeout(300);
    await audit(`${theme}: modal dialog`, { minRuns: 4, expect: ['Delete?', 'This cannot be undone.', 'Cancel', 'Delete'] });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  test(`a terminal that has printed something reads in the ${theme} theme`, async () => {
    await setTheme(theme);
    await desktop.closeAll();
    await maximize('terminal');
    /* One line of each kind the terminal can produce: an error, a success, the dim banner, the
       accent path in the prompt, ordinary output, and a `note` — the level that is neither an error
       nor help, and that therefore has an ink of its own. */
    await desktop.runCommand('nope');
    await page.waitForTimeout(250);
    await desktop.runCommand('echo hello');
    await desktop.runCommand('mkdir Documents');
    await desktop.runCommand('ls');
    await page.waitForTimeout(350);
    await audit(`${theme}: terminal output`, {
      /* The three kinds of line a terminal prints: a prompt, a result, a diagnostic. A terminal
         that had stopped drawing its output would still offer plenty of runs to audit. */
      expect: [/user@browseros:/, /command not found/, /hello/, /already exists/, /Documents/],
    });
    await desktop.closeAll();
  });

  test(`the file manager reads in the ${theme} theme`, async () => {
    await setTheme(theme);
    await desktop.closeAll();
    await maximize('files');
    await audit(`${theme}: files (sidebar, toolbar, grid, status bar)`, {
      /* Sidebar section and shortcut, toolbar label, a real folder in the grid, and the status
         bar's cheat-sheet: the four surfaces a window this busy can quietly lose. */
      expect: ['Places', 'Home', 'Sort: Name', 'Documents', 'Enter opens'],
    });
    await desktop.closeAll();
  });
}

/* The accent presets are the tokens most likely to be wrong, because they are six sets of colours
   chosen by eye and they are used as text on a tint of themselves. The token test checks all six
   against every surface; this checks the one that needed the largest change, in the place where a
   selected state is actually painted. */
test('a selected state under the weakest accent still reads', async () => {
  await setTheme('dark', 'rose');
  await desktop.closeAll();
  await maximize('files');
  await audit('dark · rose accent: files sidebar selected item', { expect: ['Home', 'Documents'] });

  await page.click('.start-btn');
  await page.waitForTimeout(250);
  await audit('dark · rose accent: Start menu', { expect: ['Terminal', 'Settings'] });
  await page.keyboard.press('Escape');
  await setTheme('dark');
});

/* The audit itself has to fail when something is unreadable, or it is a report and not a test. */
test('the audit fails when the text is not readable', async () => {
  await setTheme('dark');
  await desktop.closeAll();
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'contrast-probe';
    probe.style.cssText = 'position:fixed;left:40px;top:40px;z-index:99999;color:#1a2030;background:#232c44;font:14px sans-serif';
    probe.textContent = 'This ink is almost the colour of its background';
    document.body.append(probe);
  });
  const res = await auditContrast(page, ['body']);
  const flagged = res.problems.filter((p) => p.text.includes('almost the colour'));
  assert.equal(flagged.length, 1, 'a run of unreadable text was not flagged');
  assert.ok(flagged[0].ratio < 4.5, `flagged at ${flagged[0].ratio}:1, which is not below the bar`);
  await page.evaluate(() => document.getElementById('contrast-probe').remove());
  // Re-auditing after removing it must be clean again.
  await audit('after removing the probe');
});

/* The two apps above are the ones a user is most likely to be reading. This is the guard that no
 * app was left out of the palette: every registered app, opened once, maximized, measured. It is
 * one theme only on purpose — the theme-specific bugs are the paired dark/light tests' job, and
 * doubling this pass would double the slowest thing in the suite for no new information.
 *
 * The coverage claim is each window's own title bar: the one piece of text every app window is
 * guaranteed to paint. Without it, an app that opened empty would audit cleanly — and it is why
 * the run floor here is low: a freshly opened terminal is the sparsest window in the OS, and a
 * floor high enough for it would be one only the busiest apps ever had to clear. */
test('every app reads in the dark theme', async () => {
  await setTheme('dark');
  await desktop.closeAll();
  for (const id of ['welcome', 'terminal', 'files', 'editor', 'viewer', 'paint', 'calc', 'settings', 'web']) {
    await maximize(id);
    const title = await page.locator(`.window[data-app="${id}"] .wtitle`).textContent();
    assertReadable(await auditContrast(page, [`.window[data-app="${id}"]`]), `dark: ${id}`, { minRuns: 4, expect: [title] });
    await desktop.closeAll();
    await page.waitForTimeout(150);
  }
});

/* The two guards that stop this file from being a report. Both are tested against the real shell,
   because a guard that cannot fail is the same as no guard — and every screen above is only as
   trustworthy as these. */
test('an audit that measured the wrong thing is itself a failure', async () => {
  await setTheme('dark');
  await desktop.closeAll();
  const taskbar = await auditContrast(page, ['#taskbar']);

  /* A coverage claim has to reject a string that is not on the screen, in both of its forms. */
  for (const absent of ['a label that does not exist', /never-printed-\d+/]) {
    assert.throws(() => assertReadable(taskbar, 'taskbar', { minRuns: 1, expect: [absent] }),
      /never measured/, `an expectation of ${absent} should have failed the audit`);
  }
  /* The same audit, asked about a label that *is* there, passes — so the failure above is about
     the missing text and not about the mechanism. */
  assertReadable(taskbar, 'taskbar', { minRuns: 4, expect: [/\d+ files/] });

  /* And an audit of a selector that matches nothing must not be allowed to pass by having found
     nothing wrong. */
  const empty = await auditContrast(page, ['#no-such-element']);
  assert.throws(() => assertReadable(empty, 'nothing', { minRuns: 1 }), /not measuring the page/);
});

/* A coverage claim is matched against a run's full text. Matched against the 60-character form the
   report prints, a long expectation would fail on text that is plainly on the page — which is the
   one way this guard could quietly stop working. The long run is written into the page rather than
   hunted for, because this tests the matching, not any app's copy. */
test('a coverage claim is matched against the whole run, not the truncated form a report prints', async () => {
  await setTheme('dark');
  await desktop.closeAll();
  const sentence = 'a sentence long enough that the report form of it is truncated, which is the whole point of this test.';
  await page.evaluate((text) => {
    const p = document.createElement('p');
    p.id = 'long-run-probe';
    p.textContent = text;
    document.querySelector('#desktop').appendChild(p);
  }, sentence);
  try {
    const result = await auditContrast(page, ['#long-run-probe']);
    assert.ok(result.runs.length >= 1, 'the probe paragraph should have been measured as a run of text');
    const run = result.runs[0];
    assert.ok(run.text.length <= 60, 'the report form of a run is the truncated one');
    assert.ok(run.fullText.length > 60, 'the full form is what a claim is matched against');
    assertReadable(result, 'a coverage claim about a long run of text',
      { minRuns: 1, expect: [sentence, run.fullText, sentence.slice(0, 40)] });
  } finally {
    await page.evaluate(() => document.querySelector('#long-run-probe')?.remove());
  }
});
