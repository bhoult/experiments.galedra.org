import assert from 'node:assert/strict';
import { auditControls, assertNoUnnamedControls, assertWindowsAreLabelled } from '../a11y.mjs';
import { desktop, test, page, browser, server, consoleErrors, nativeDialogs, TERM_INPUT } from './fixture.mjs';

const { win, openApp, closeApp, closeAll, setWidths, widthWhere, runCommand,
  dialogShown, dialogAccept, dialogCancel, resetStorage } = desktop;

test("the accessibility audit is not vacuous: it finds what it claims to find", async () => {
  /* A test that can never fail is worse than no test. Feed the audit a known-bad
     fragment and require it to report exactly the bad part. */
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'a11y-probe';
    probe.innerHTML = [
      '<button id="probe-unnamed"></button>',                       // visible, no name -> must be reported
      '<button id="probe-named" aria-label="named one"></button>', // named -> must not be
      '<button id="probe-text">named two</button>',                // text content counts
      '<button id="probe-hidden" style="display:none"></button>',  // not rendered -> nothing to name
      '<button id="probe-title" title="named three"></button>',    // title is a name too
    ].join('');
    document.body.appendChild(probe);
  });

  const problems = await auditControls(page, ['#a11y-probe']);
  assert.equal(problems.length, 1, `exactly one control is unnamed, audit reported ${problems.length}: ${JSON.stringify(problems)}`);
  assert.equal(problems[0].kind, 'unnamed-control');
  assert.match(problems[0].node, /probe-unnamed/, 'the report must point at the control it found');

  /* And the assertion helper must actually fail on that report, not shrug at it. */
  assert.throws(
    () => assertNoUnnamedControls(problems, 'the probe'),
    /without an accessible name/,
    'assertNoUnnamedControls must reject an unnamed control',
  );

  /* The window check gets the same treatment: break a label, expect it to be noticed. */
  await openApp('terminal');
  await assertWindowsAreLabelled(page);
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    w.el.setAttribute('aria-label', 'something that is not its title');
  });
  await assert.rejects(
    () => assertWindowsAreLabelled(page),
    /does not match the title/,
    'a window whose accessible name drifts from its title must be caught',
  );
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'terminal');
    w.el.setAttribute('aria-label', w.el.querySelector('.wtitle').textContent.trim());
  });
  await assertWindowsAreLabelled(page);

  await page.evaluate(() => document.getElementById('a11y-probe').remove());
  await closeApp('terminal');
});

test('every visible control has an accessible name', async () => {
  await closeAll();
  assertNoUnnamedControls(await auditControls(page, ['#taskbar', '#desktop']), 'the shell');

  /* Menus only exist while they are open, so audit them open. */
  await page.click('#start-btn');
  await page.waitForTimeout(300);
  assertNoUnnamedControls(await auditControls(page, ['#start-menu']), 'the Start menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.click('.dicon[data-kind="app"][data-app-id="terminal"]', { button: 'right' });
  await page.waitForTimeout(300);
  assertNoUnnamedControls(await auditControls(page, ['#context-menu']), 'the context menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  /* A real in-OS dialog, opened the way a user opens one. */
  await openApp('files', { path: '/home/user/Desktop' });
  await page.click(`.window[data-app="files"] [data-path="/home/user/Desktop/welcome.txt"]`);
  await page.keyboard.press('Delete');
  await page.waitForSelector('#dialogs .dialog', { state: 'visible', timeout: 5000 });
  assertNoUnnamedControls(await auditControls(page, ['#dialogs']), 'the confirm dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await closeApp('files');

  const appIds = await page.evaluate(() => window.browserOS.apps.map((a) => a.id));
  assert.ok(appIds.length >= 9, 'the audit should cover every app');
  for (const id of appIds) {
    await openApp(id);
    assertNoUnnamedControls(await auditControls(page, [`.window[data-app="${id}"]`]), `the ${id} window`);
    await closeApp(id);
  }
});

test('windows are labelled dialogs and say what their title bar does', async () => {
  await closeAll();
  await openApp('terminal');
  await openApp('paint');
  await assertWindowsAreLabelled(page);

  /* Renaming a window (the Editor and Paint do this) must rename the accessible name too. */
  await page.evaluate(() => {
    const w = [...window.browserOS.wm.windows.values()].find((v) => v.appId === 'paint');
    w.setTitle('Paint — renamed');
  });
  await assertWindowsAreLabelled(page);

  /* The Paint toolbar must show which tool is active, not just which one is coloured. */
  const tools = await page.evaluate(() => [...document.querySelectorAll('.window[data-app="paint"] .seg button')]
    .map((b) => ({ tool: b.dataset.tool, pressed: b.getAttribute('aria-pressed'), active: b.classList.contains('active') })));
  assert.deepEqual(tools.map((t) => t.pressed), ['true', 'false', 'false'], 'exactly one tool is pressed at open');
  assert.deepEqual(tools.map((t) => t.active), [true, false, false], 'the pressed tool is the highlighted one');
  await page.click('.window[data-app="paint"] >> [aria-label="Eraser"]');
  const after = await page.evaluate(() => [...document.querySelectorAll('.window[data-app="paint"] .seg button')]
    .map((b) => b.getAttribute('aria-pressed')));
  assert.deepEqual(after, ['false', 'false', 'true'], 'switching tools must move aria-pressed');

  await closeApp('paint');
  await closeApp('terminal');
});

test('nothing logged an error to the console', () => {
  assert.deepEqual(consoleErrors, []);
});

test('nothing used a native window.confirm/prompt dialog', () => {
  assert.deepEqual(nativeDialogs, [], `the OS should use its own dialogs, saw: ${nativeDialogs.join('\n')}`);
});
