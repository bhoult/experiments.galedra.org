# Proposed improvements (cumulative list; current iteration: version 26)

Findings come from reading the code in this directory. Difficulty: **S** ≈ under an hour,
**M** ≈ a focused session, **L** ≈ a redesign.

Statuses: `[todo]`, `[doing]`, `[done]` (done in an earlier iteration, verified against
this copy of the code).

---

## A. Correctness / behaviour bugs

### A1. `nano` is advertised but does not exist — `[done]`
`src/apps/terminal.js` now has a `nano` alias entry; covered by a browser test.

### A2. `&&` chaining split inside quotes — `[done]`
`splitChain()` in `terminal.js` ignores separators inside quotes; covered by tests.

### A3. `fs.write('/')` created a file named `""` — `[done]`
`write()` throws `cannot write to /`; unit-tested.

### A4. `fs.mv(dir, existingFile)` silently destroyed the file — `[done]`
`mv()` now handles trailing-slash destinations, refuses dir-onto-file and
dir-into-itself; unit-tested.

### A5. `fs.list()` never reported directory counts — `[done]`
`list()` includes `children`; Files shows "N items"; browser-tested.

### A6. Editor reload used a prefix match — `[done]`
Exact path match plus a `reset` branch; the editor also notices its file disappearing.

### A7. "Open in new window" was a no-op — `[done]`
`wm.launch(..., { newWindow: true })` skips de-duplication; browser-tested.

### A8. localStorage quota failures were swallowed — `[done]`
`Store` reports failures once (`onStorageFailure` → toast) and Settings shows real usage
via `fs.counts()`; unit-tested with a full-storage fake.

### A9. Closing an editor with unsaved changes lost them — `[done]`
`win.onCloseRequest` guard + `close(id, { guarded: true })`; browser-tested.

### A10. Terminal `history`/`Ctrl+C` edge cases — `[done]`
`Ctrl+C` resets `histIndex` to the end of history.

### A13. A disabled control looked exactly like an enabled one — `[done]` (v08)
`styles/os.css` had **no** `:disabled` rule anywhere, so Paint's new Undo/Redo buttons —
and any future disabled button or field — were full-strength with a `pointer` cursor while
doing nothing. Added `.btn:disabled, .toolbar button:disabled, .seg button:disabled,
.field:disabled, .wbtn:disabled { opacity: .45; cursor: not-allowed }`. Found by measuring
computed styles in a real window, not by reading the CSS. Browser-tested.

### A14. Only two of nine app toolbars admitted being cut off — `[done]` (v08)
`watchToolbarOverflow()` was called by Files and Web only; Paint's toolbar measured 639px
of content in a 418px bar at a 420px window with **no** fade and no hint. The window
manager now attaches one watcher per window toolbar after mount and stops them on close
(`win.toolbarFades`), and the app-level duplicates were removed. Browser-tested via Paint.

### A15. Icon-only buttons had no accessible name — `[done]` (v08)
Files' `←`/`↑` navigation buttons and the Editor's `📅`/`Σ` buttons were unnamed buttons.
Found by the new audit (`tests/a11y.mjs`), fixed with `aria-label`, and now asserted on
every app window, the shell, both menus and a real dialog.

### A16. `Store.headroom()` is measured once per page load — `[done]` (v10)
`capacity()` cached the probe, so anything that ate `localStorage` later in the session —
another app on the same origin, which `usage()` cannot even see — left the ceiling stale and
the free space too generous. A write that fails with a quota-shaped error now invalidates
the measurement (`#isQuotaError` → `#invalidateCapacity`), so the next `headroom()`
re-probes; the re-probe is rate limited to one per 30s so a genuinely full disk is not
re-measured per keystroke, and a failure that is *not* about the quota (a value that cannot
be serialised) leaves the measurement alone. Unit-tested both ways.

### A17. A segmented control clipped its own labels while its toolbar “fit” — `[done]` (v09)
`.seg` is `overflow: hidden` and its buttons were shrinkable flex items, so at 900px Paint
rendered “Eras” for Eraser — the bar was not overflowing, the group *inside* it was, so no
toolbar test could see it. Found by looking at `shots/06-paint.png`. `.seg button` is now
`flex: 0 0 auto`, so a segment is always its natural width and the bar decides what to
give way.

### A18. Files' filter placeholder was cut to “Filter r” at narrow widths — `[done]` (v09)
The whole hint lived in the placeholder, which is width-limited. It is now `Filter…`, with
the hint in `aria-label`/`title` where nothing clips.

### A19. A toolbar only re-fitted when the window was resized — `[done]` (v09)
`watchToolbarOverflow()` used a ResizeObserver, which cannot see content changes: Files
rebuilding a longer breadcrumb, or any app adding a control, left a stale collapse level
and a fade that lied. The watcher now observes the toolbar subtree (batched into one frame)
and re-collects the collapsible list each pass. Browser-tested by widening a fitted toolbar
without touching the window.

---

---

### A20. A disabled menu row and a destructive menu row looked identical — `[done]` (v10)
`.cmenu-item:disabled` had no rule anywhere: the context menu's "Paste" with an empty
clipboard was full-strength, hoverable and `cursor: default`, so it promised a click that
does nothing. Added `.cmenu-item:disabled` (dimmed, `not-allowed`, no hover) and
`.cmenu-item.danger` for destructive actions, which the new window menu uses for `Close`.
Browser-tested via computed styles.

### A21. The desktop icon grid ran off the right-hand side of a narrow screen — `[done]` (v10)
`.desktop-icons` used `grid-auto-flow: column` with only implicit rows, which gives a grid
one row and as many columns as it needs: at a 420px viewport five of the nine icons were
laid out past the right edge, unreachable, with nothing to scroll them into view. The grid
now fills rows and wraps (4 columns × 3 rows there, unchanged at 1280px). Found by
screenshotting a 420px desktop, which no earlier shot covered; browser-tested at both widths.

### A22. Files' toolbar still does not fit a phone-width window — `[done]` (v11), M
Even fully compacted, Files' toolbar measured 501px of content in a 356px bar at a 420px
viewport (`shots/16-narrow-desktop.png`), so ~145px — the sort and create buttons — was only
reachable by scrolling the bar. The answer chosen is neither a fourth collapse tier nor a
lie about the minimum width: `watchToolbarOverflow()` now adds a sticky `⋯` button whenever
anything is genuinely out of reach, and its menu lists exactly the controls the bar cannot
show (`controlName()` reads each one's accessible name), clicking an item scrolls the control
into view and activates it. The promise an app makes is now "every action is reachable — in
the bar or in the ⋯", which is why Files' `minWidth` could drop 580 → 360 and still be
true. `tests/measure-toolbars.mjs` prints the proof per app (`files@360 … ⋯=shown → all
reachable via ⋯ (4 in the menu)`), and three browser tests cover the menu's contents, its
stickiness at every scroll position, and that it disappears when everything fits.

### A24. Files' counts read as "0 folders, 1 files" — `[done]` (v10)
The status bar and every folder's tooltip pluralised unconditionally; the first capture of
`shots/16-narrow-desktop.png` showed "0 folders, 1 files". A `plural()` helper in
`src/apps/files.js` now writes "1 file", "1 folder, 1 file" and "folder · 1 item".
Browser-tested.

### A23. The desktop icon grid has no scroll and no paging — `[done]` (v11), S
Fixing A21 made the icons wrap, but the grid was `position: absolute; inset: 12px` inside a
`#desktop` with `overflow: hidden`: enough desktop files put the last ones below the visible
area with no way to reach them. `#desktop-icons` is now `overflow: hidden auto` — a real
scroll container — and `WM#iconBottom()` only reserves space for the icons actually inside
the scroll viewport, so a 40-file desktop no longer pushes new windows off the bottom of the
screen. Browser-tested at 640×480 with 40 files: the grid scrolls, the last icon is
reachable, and a window opened on top of it stays fully inside the viewport.

### A25. `grep -n pattern file` failed with "no such file: pattern" — `[done]` (v11), S
Found by reading a screenshot, not a test: `grep` took `args[0]` as the pattern, so the one
flag people type out of habit became the pattern and the pattern became the file name.
`grep` now separates flags from words, honours `-n` (line numbers, counting from 1, correct
through a pipe too), and names any option it does not have instead of guessing. Browser-tested.

### A26. A command that threw skipped its own `2>` file — `[done]` (v11), S
`cat missing 2> errors.txt` wrote nothing: the `catch` around `cmd.run()` printed the
message and `break`-ed out of the stage loop before the redirect block ran, so the error went
to the screen and the file was never created. A thrown diagnostic is now recorded like any
other, the redirect is written, and only then does the stage stop. Browser-tested.

### A27. Files' breadcrumb disappeared completely at Files' *default* width — `[done]` (v12), M
`measure-toolbars.mjs` used to report `files@840 … collapsed=1 hidden: root`: at the width
Files asks for by default the first collapse tier fired and the whole `.crumbs` group went
away. The path was still in the title bar, but the app's most common window size hid the
affordance that says "where am I".

Two changes, both needed. First, the trail is written the way the title bar and the shell
prompt already write it — `~ / Documents / notes / deep`, not `root / home / user / Documents
/ notes / deep` — the anchor segment is `~` when the path is under the home folder, which
costs the bar about 90px for information the user already has. Second, the group is no longer
all-or-nothing: each foldable middle segment travels with its own separator inside a
`.crumb-mid` wrapper, and the collapse rule hides those wrappers and reveals a
`.crumb-elide` (`/ …`) that is only rendered when something really was folded away. The
anchor and the folder you are in survive; the window title still spells the whole path. And
the collapse order was reversed — `.files-create, .files-sort, .files-search, .crumbs` — so
button *labels*, whose glyphs already say what the button does, give way before the
breadcrumb is touched at all.

`measure-toolbars.mjs` now reports `files@840 … collapsed=- ⋯=- → all reachable`, and a
browser test asserts the full trail at the default width and the `~ / … / deep` fold at 700px.

### A28. `2>&1`, `&&` inside a `;` group and pipelines that mix both were untested together — `[done]` (v12), S
`tests/browser.test.mjs` now runs one line that uses `;`, `&&`, `||`, `|` and `2>` at once
and checks each part's effect separately — which file got written, which branch ran, which
error went where — plus a line where the pipeline *fails*, and one where a stage fails and
the stage after it still runs. Cheap, and the only thing standing between a refactor of
`run()` and a silent change in how the layers interact.

### A29. A stage that threw cancelled the rest of its pipeline — `[done]` (v12), S
`cat missing | wc -l` printed the error and then stopped: `run()` had `if (threw) break;`
after the redirect block, so the filter after a failed command never ran. Bash pipes whatever
the stage produced, whatever its exit status, and the *last* stage decides the pipeline —
which is exactly the semantics v11 documented and this one line contradicted. The `break` is
gone, along with the `threw` variable it needed. Covered by the combined-grammar test.

### A30. `&> file` wrote the output and then erased it — `[done]` (v12), S
Adding `&>` ("both streams to this file") exposed this: `&> f` parses to `> f` *and* `2> f`,
and the two writes ran in order — `write(f, stdout)` then `write(f, stderr)` — so the second
truncated the first. When the error file is the file the output already went to, the errors
are now appended to it. Browser-tested both ways (`> f` then `2>> f`, and `&> f` alone).

### A31. The ⋯ menu listed hidden actions without saying where they were — `[done]` (v12), S
`offscreenControls()` knew which edge each control was past but threw that information away,
so a bar scrolled to its far end produced a menu that read exactly like one scrolled to the
start, and you had to guess which way to scroll to check. The items now use the standard
`.cmenu-hint` slot — `off the left ←` / `→ off the right` (`shots/19-toolbar-overflow.png`)
— and a browser test asserts the side named flips with the scroll position.

### A32. A storage failure was only diagnosed properly if something had already measured the quota — `[done]` (v12), S
`Store.#classifyWrite()` uses the measured ceiling as its last piece of evidence (a write
that fits inside it is not the quota talking — see C6), but it read `this.#capacity` and said
`unknown` when nothing had probed yet. Early in a session, or from a code path that never
asks for free space, the first failure of the day got the least useful answer. It now probes
on demand — once per failure, not per keystroke. Unit-tested by running the same
classification with and without a prior probe and requiring the same answer.

### A33. A menu glyph column wrapped Files' `📁＋` glyph onto two lines — `[done]` (v12), S
`.cmenu-item .glyph` was a fixed 18px column: fine for one character, and it turns a
two-character glyph into a stack. `shots/19-toolbar-overflow.png` showed a folder emoji above
a plus. The column is now `min-width: 18px; white-space: nowrap`.

### A34. A toolbar gave up a whole group when one piece of it would have been enough — `[done]` (v13), M
`data-collapse` is all-or-nothing per group. For Files that meant the breadcrumb: at 760px
the bar needed about 40px more room, and the cheapest thing it was allowed to give up was
the whole trail — so `~ / Documents / notes / deep` became nothing at all, and the ⋯ had to
say where you were. Now a group may declare `data-collapse-units=".crumb-mid"`: `fit()`
hides its pieces one at a time, in document order, before the group itself goes, and
`data-collapse-units-from="end"` reverses which end gives way (a colour palette keeps the
colours it lists first; a path trail gives up the segments nearest its root). Files now
reads `~ / … / notes / deep` at 760px and `~ / … / deep` at 700px. `styles/os.css` no longer
has a `.crumbs.is-collapsed` rule at all. Hard: core change, needed a new kind of test (a
width sweep with a minimality check, not one screenshot at one width).

### A35. Once a toolbar had run out of one group, it kept hiding pieces it no longer needed — `[done]` (v13), S
With units in play, a bar can exhaust a low-priority group and *then* collapse the next one.
The greedy pass leaves the first group fully given up even though the second collapse made
some of it unnecessary: at 560px Paint hid all eight swatches *and* the size readout, when
seven swatches plus the readout would have fitted. `fit()` now runs a take-back pass in the
reverse order the pieces were given up, restoring any piece that fits. The priority order
still decides which end starts; it is just not a licence to keep cutting after the bar fits.

### A36. `> "my file.txt"` created a file whose name contained the quote characters — `[done]` (v13), S
`splitRedirect()` took the raw text after `>` as the path, quotes included, and never
expanded anything in it. Redirect targets now go through the same tokenizer and expansion as
a command-line word: quotes are stripped, spaces survive, `$HOME` expands.

### A37. An empty folder's message was squeezed into one 104px grid column — `[done]` (v13), S
`.empty-state` was a plain child of `.filegrid`, a `repeat(auto-fill, minmax(104px, 1fr))`
grid, so it was laid out as one cell and "This folder is empty. Use the buttons above…"
wrapped into a narrow strip that read as broken text. Found by looking at
`shots/23-files-partial-fold.png`, not by measuring. It is now `grid-column: 1 / -1`.

### A38. A context menu outlived the window it came from — `[done]` (v13), S
The menu is a document-level overlay. Closing the window it was opened from left it floating
on the desktop, reading as a menu *of* the desktop — and it turned up in every later
capture of `tests/screenshot.mjs`. `shell.js` now closes it on `win:closed`.

### A39. `fit()` could not undo a cut that was a whole group, and probed the bar once per thing it was allowed to give up — `[done]` (v14), M

`fit()` walked the declared order, cut one thing at a time until the bar fitted, then ran a
*take-back* pass — but the take-back pass only ever restored **units**, the pieces inside a
group that declared `data-collapse-units`. A cut that was a whole group (`.files-upload`,
`.paint-size-readout`, `.files-search`) was permanent, even when a later cut made it
unnecessary. It also measured the bar once per item, so the cost grew with the length of the
list: v13's note that this was "bounded today by the size of the two palettes" was a statement
about nobody having put a long list in a group yet, not a property of the code.

**Change:** `fit()` now flattens the declared order into one sacrifice sequence and
`shortestFit()` (exported from `src/core/utils.js`) binary-searches the shortest *prefix* of
that sequence the bar actually needs, then walks back over any cut that turns out not to have
been needed. The answer has the same shape as before — a prefix, in the app's order — but it is
minimal by construction, it can undo any kind of cut, and it costs ~log n layout reads instead
of n. `tests/fit.test.mjs` tests the rule without a browser, including a probe-count ceiling
for a 1000-item list and the breadcrumb shape where the first cut *adds* width (the `…` is
wider than the shortest segment it replaces).

**Honest result:** measured with `tests/probe-fit.mjs`, the behaviour at every width I could
find is unchanged — Paint keeps 5 swatches at 720px, 3 at 660px and 2 at 620px in this copy
exactly as v13 documented, and 560px still needs all eight plus the size readout. The value of
the rewrite is the guarantee and the cost, not a different picture. What *did* change the
picture is A40.

### A40. Files' Upload button was the one control at the end of its bar that no width was allowed to compact — `[done]` (v14), S

Files' `data-collapse` listed `.files-create, .files-sort, .files-search, .crumbs`. Upload —
the last control in the bar, and the only one with no compact form at all — was exempt, so at
Files' declared 360px minimum the bar measured **444px of content in 312px of room** and New
file and Upload files were both pushed into the ⋯. Upload is an ordinary action with an
ordinary label; exempting it was an accident of it having been added last.

**Change:** the button is now `<glyph> + <label>` like its neighbours and joins the order
between Sort and the filter box. Measured: `files@360` 444 → **413px**, and `files@380` needs
one item in the ⋯ instead of two. The glyph is `📤`, not `⬆` — see E17.

### A41. A variable in the expansion list with no value printed the word `undefined` — `[done]` (v14), S

`expandWord()` matched `/(HOME|PWD|USER)/` and replaced with `vars[name]`. Every name in that
list always had a value, so the bug was invisible — until `$OLDPWD`, which legitimately has no
value in a shell that has never moved, turned `echo $OLDPWD` into `undefined`. That is exactly
the failure mode B23 documents as unacceptable: an unset name must be left as typed.
**Change:** the replacer returns the original text when there is no value.

### A42. The screenshot that was supposed to show a partial palette fold showed no fold at all — `[done]` (v14), S

`shots/24-paint-palette-fold.png` was captured at 720px under the comment "the width where the
palette only has to give up part of itself". Measured, Paint's bar needs nothing at 720px: the
capture showed a full palette and the interesting state had no evidence. **Change:** the shot is
taken at 680px, where four of the eight genuinely go — `node tests/probe-fit.mjs paint 680` is
the command that says so — and the comment now names the measurement instead of asserting it.

### A43. Files at 360px still wants ~100px more than the bar has — `[done]` (v15), M

After A40 the gap was 413px of content in 312px of room. v15 took the first of the two options
listed here — the create pair became **one menu button** — and then went one step further than
either option suggested: the compact button is itself a *unit* of the fold, so the bar gives up
the pair, then the word on its replacement, then Sort's label, then Upload's, then the filter
box's width. Measured now (`node tests/measure-toolbars.mjs 360 400 520 580`):
`files@360` fits in 312px of room with nothing in the ⋯; the ⋯ first appears at 340px, which
is genuinely below the declared minimum. See A44 for the one case where this is still not true.

### A44. Files' declared 360px minimum was only honoured for short folder names — `[done]` (v16), M

`measure-toolbars.mjs` measures the seeded `~`. Open the same window at a folder with a long
name — `~/Documents` is enough — and the bar is 35px over at 360px: the ⋯ appears at exactly
the width the app claims it needs. Nothing is unreachable (the ⋯ lists what is off the edge, and
the bar scrolls), so this is not a bug, but the app's own `minWidth` is a promise its toolbar
cannot always keep.

v16 took (a) and (b) together. The current folder is now a named unit of the bar (`.crumb-last`)
and the **last thing the bar may give up**, so what a long name costs is the length of that name
and not an action sitting next to it: uncollapsed it is capped at 160px, collapsed at `12ch` — a
character count rather than a pixel width, because a cap a short name already fits under is a cut
that buys nothing, and `shortestFit` hands that cut straight back. `Documents` is never truncated;
a 35-character name always is, and the whole name stays in the button's accessible name and its
tooltip. The app spec now says what `minWidth` does and does not promise: reachability at that
width, not fitting for every content.

Measured at 360px: `~/Documents` is 430px of content in 312px of room and the ⋯ covers the two
actions that fall off; a 35-character name and a 60-character name cost the bar *exactly the same*
(465px), which is what the rung is for and is now asserted by a test.

### A45. A wider Files window compacted *more* than a narrower one — `[done]` (v16), M

Measured, not inferred: at 640px the Files bar shows both create buttons; at 700px it has given
the pair up. The cause is `.files.is-narrow`, which trades the Places sidebar for toolbar width
somewhere between those two widths — so the toolbar is 174px narrower than the window above the
threshold and 48px narrower below it. The fold itself is behaving correctly in both cases; what
is odd is that the app asks the bar to give up more at a width the user would call *larger*.
**Why it matters:** a user resizing a Files window wider should never see controls disappear.

Fixed in the core rather than in Files: `watchToolbarOverflow` now honours `data-collapse-scope`,
so a bar may declare groups that live outside it. Files declares `.files-side-labels` — a hidden
marker the sidebar reacts to (`…is-collapsed ~ .files-side`) — as the second rung of its own
ladder. There is one measured decision now and no second breakpoint to keep in step, and a prefix
order can only ever give back more as the window grows: monotonicity is a property of the
mechanism rather than something to re-verify per change. `is-narrow` is gone from the CSS and from
`files.js`.

The ordering was decided by looking at both options at the default width. With the sidebar first,
an 840px window at `~/Documents/notes/deep` loses its Places labels and keeps both create buttons;
with the pair first it keeps the labels and the pair becomes one `＋ New` menu — the only rung on
this ladder that costs the user nothing. The second is what fifteen earlier iterations had
converged on and what the default-width screenshot shows, so the free 90px is spent before the
126px is taken. Asserted as a shape, not at fixed widths: *widening a Files window never takes a
control away* sweeps 320→840px and compares what each affordance can do at every step.

### A46. A truncated window title cannot be read in full — `[done]` (v17), S

`Files — ~/Documents/a-folder-name-long-enough-to-cost-the-bar-room` is ellipsised by the title
bar with no `title` attribute and no way to see the rest: `src/core/wm.js` sets `.wtitle`
`textContent` and nothing else. The breadcrumb button carries the full name; the title bar does
not. **Fix:** set `title` on `.wtitle` wherever the title is set. **Difficulty: S.**

Done in v17: `openWindow()` sets `title` on `.wtitle` and `setTitle()` updates it, so the summary
on screen and the full string are the same value in two places. Browser-tested at 360px: the title
is asserted to *actually be truncated* (`scrollWidth > clientWidth`) before asserting that
`title` and the window's `aria-label` both equal the untruncated text — and again after an app
calls `setTitle()` itself, because a fix that only covers the first title is not a fix.

### A47. `bar.dataset.collapsed` counts cuts that bought nothing — `[done]` (v17), S

At 360px with `~/Documents` the bar reports `collapsed=7` — every rung used — but the last rung
(truncating the current folder's name) is a no-op for a 77px name, and the ⋯ is needed anyway.
`shortestFit` walks back the cuts a bar did not *need*, but when nothing fits it returns the whole
ladder, so the number in the DOM overstates what was given up and the measurement scripts print it
as if it were a fact about the layout. **Fix:** have `shortestFit` report which rungs actually
changed the measurement, or return "nothing fits, and here is the whole ladder" as its own case.
**Difficulty: S.** Worth doing before a later iteration writes a test that trusts `collapsed` as a
count of real sacrifices.

Done in v17, both halves. `shortestFit` returns `{ cuts, fits }` — "ran out of things to give up"
is now its own answer instead of a number that looks like a fit — and every caller in `utils.js`
reads `.cuts`/`.fits`. `watchToolbarOverflow` writes `data-collapsed-exhausted="true"` when the
whole ladder is not enough and `data-collapsed-effective`, the rungs that actually changed the
measured bar: found by un-applying them from the last backwards and re-measuring, capped at 24
reads (`EFFECTIVE_SCAN_LIMIT`), and measuring `scrollWidth` **and** `clientWidth` because a scope
rung like the Places sidebar buys room by making the bar *wider*, which a `scrollWidth`-only check
would report as a rung that did nothing. `data-fit-passes` counts the measurements, which is what
makes the settle loop testable at all. Unit-tested in `tests/fit.test.mjs` (a bar that gave up
everything and still does not fit is not repaired into a fit; the walk-back is not re-run when
nothing fits); browser-tested on a lab bar where the no-op rung is isolated (3 applied, 2
effective, the rung's box measured to be the same width collapsed or not) and on the real Files
bar as a *shape*: with a folder called `Documents` the name-shortening rung buys nothing, with a
60-character folder name every rung buys something.

### A48. Files trusted the path string it was given — `[done]` (v17), S

Found while using the merged probe: `node tests/probe.mjs ~/Documents/<name> 360` produced a bar
with **nine** rungs where the same folder opened by absolute path produced eight, and the trail
read `root / ~ / Documents / <name>`. `src/apps/files.js` initialised `cwd` from
`win.data?.path` **unresolved**, and everything downstream — the breadcrumb's `underHome` test
first of all — assumes an absolute path. A caller (the console, a restored session, any future app)
is allowed to say `~/Documents`, and got a trail with a segment that does not exist, plus one extra
foldable segment, which is one extra rung on the bar's ladder. **Fix:** `cwd =
ctx.fs.resolve(win.data?.path ?? '', ctx.fs.home)` — normalise once at mount. Browser-tested: the
trail, the window title, the stored `win.data.path` and the resolved rung count are asserted to be
identical for `/home/user/Documents`, `~/Documents` and `Documents`; that no trail inside home ever
contains `root`; and that a folder genuinely outside home is still shown as outside home.

### A49. An app that focuses its own control on a timer took the keyboard back from the desktop — `[done]` (v18), M

`Alt+Arrow snaps the focused window` failed roughly once every ten runs of the browser suite. The
cause was not the window manager: `terminal.js`, `editor.js` and `viewer.js` each ended `mount()`
with `setTimeout(() => control.focus(), 30)`, so 30ms after opening, an app claimed the keyboard
whatever you had focused in the meantime. In the test that meant a taskbar button lost focus to
the terminal's input, and the shell — correctly refusing to treat arrow keys as window commands
while a text field has them — did nothing at all. In use it is the same bug with no test: open an
app, immediately click or tab somewhere else, and the app takes it back.

**Fix:** one core rule, `claimFocus(win, control, { delay })`, which claims focus only when
nothing else has (an empty desktop, or something inside its own window). All three apps use it,
including the terminal's click-to-focus handler. `tests/contracts.test.mjs` now forbids an app
focusing a control on its own timer. Browser-tested both ways: the terminal must not take the
keyboard back from the taskbar, and opening the editor with nothing else focused must still focus
the editor. Eight consecutive runs of the previously flaky test: 0 failures.

### A50. `data-collapsed-effective` was re-walked on every resize, and reported 0 for a ladder it never looked at — `[done]` (v18), M

v17 added the attribute and a 24-rung cap, and left two things open. First, the walk ran on
every exhausted fit pass: a Files window 12 folders deep has a **20-rung** ladder
(`node tests/probe.mjs <deep path> 360` → 19 of 20 rungs buy room, 117px still over), and each
resize event paid for 20 mutate-and-measure cycles (~0.6ms of forced layout, measured) at the
moment the bar is at its worst. Second, a ladder longer than the cap wrote `0`, which reads
exactly like "nothing bought anything" — the lie the attribute exists to avoid.

**Fix:** cache the walk against the content it measured (ladder length, cut level, the bar's
content width at that level) — what a rung buys is a property of the content, not of the window's
width — and expose `data-collapsed-effective-walks` so the bound is observable. Over the cap,
write `unmeasured` plus `data-collapsed-effective-limit`. Browser-tested: eight resizes of a
deep-breadcrumb bar re-fit (pass counter 4 → 11) and walk once; an 18-folder-deep path (26 rungs)
reports `unmeasured`/`24` and zero walks.

### A51. Files' missing-folder fallback was a toast and a silent jump to home — `[done]` (v18), S

Opening Files on a path that is gone — a restored session after a `rm -r`, a `open` for a folder
you deleted, a typo — has always worked: it falls back to home. But the only thing the window
said was a toast, which is gone by the time you look, and a window quietly showing home looks
exactly like an empty home. `shots/30-files-missing-folder.png` is the state now: the window names
the folder it could not find, says it is showing home instead, and offers **Create that folder**,
which makes it and opens it. The notice describes the window's request, so it survives a render
caused by an unrelated filesystem change and is cleared when you navigate somewhere real.

### A52. The 24-rung cap on the effective-rungs walk was a guess, and nothing measured the walk — `[done]` (v19), S

v18 chose `EFFECTIVE_SCAN_LIMIT = 24` by reasoning: "26 rungs is 18 folders deep, which is
absurd, and 24 is comfortably above any ladder a real window produces". It was never measured,
and the attribute that exists to make the bound observable (`data-collapsed-effective-walks`)
could count walks without saying what one costs. `tests/probe.mjs` now prints the walk time
alongside the rung counts.

Measured on a 25-rung ladder (18 folders deep) in a 360px window: **1.5ms**, once per content —
the cache means a resize does not re-walk it. That is not a cost worth capping, and the cap was
the thing worth changing: 24 sits just below a ladder a deliberate user can build, so a deep
path silently lost its most useful diagnostic. Raised to **48** (two folders' worth of depth
beyond anything the seeded filesystem can produce, and ~3ms at the measured cost), with the
measurement written into the comment next to the constant so the number has a source.

`data-collapsed-effective-walk-ms` records how long the walk actually took, so "is this bound
still right?" is a question a later iteration can answer without re-deriving it. Browser-tested:
a 45-folder-deep path (53 rungs) reports `unmeasured`/`48`/no walk; an 18-folder-deep path
reports a real count with `walkMs < 25`, and a cached re-fit does not re-pay it.

### A53. A window that could not open the folder it was asked for remembered the wrong folder — `[done]` (v19), S

A51 put the missing folder in the window, and `win.data.path` still said `home`. Session restore
is a write of `win.data`, so a reload produced a window that had *never* been asked to open
`~/Documents/used-to-be-here` — the notice, the tooltip and the Create button all gone, and the
session quietly rewriting what the user had asked for. `open` on a deleted folder was the same
story: the toast said the truth for two seconds and the window kept the lie.

`win.data` now carries both facts, because they are two different facts: `path` is the folder
being shown, `requested` is the folder that was asked for. On mount Files resolves
`requested`, and if it is gone it shows home *and* says so; if it came back — created in the
terminal, or by the button — the window goes to it. The notice is no longer a memory of this
session; it is in the saved session.

The same fact is shown where the path lives: the breadcrumb ends in a **dead-end crumb** — the
name struck through, marked `missing`, not a button, because a control that looks clickable and
is not is a lie about the interface. It is not clickable; the button that fixes it is in the
notice. `~ / used-to-be-here missing` is the whole diagnosis, in the place a path is normally
read. Browser-tested in all three shapes: asked-for-and-gone, restored-and-still-gone, and
gone-then-created-again.

### A54. An empty home and a missing folder said the same thing twice — `[done]` (v19), S

The fallback is home, and home can be empty. The notice said "This is your home folder instead"
above an empty-state that said "This folder is empty" — two panels that read as two unrelated
problems. The empty state now knows: "Your home folder is empty too." One sentence, one state.

---

## B. Features / gaps

### B1. `theme.settings.icons` was dead config — `[done]`
Settings toggle hides desktop shortcuts; shell re-renders on `settings:change`.

### B2. Paint Line tool had no preview — `[done]`
`lineBackup` canvas restores under the preview stroke on every move.

### B3. Paint window titles leaked internal ids — `[done]`
No `uid()` in titles any more.

### B4. Files app had no keyboard interaction — `[done]`
Enter/F2/Delete// filtering plus a sort control (name/size/newest), browser-tested.

### B5. Terminal lacked `df`/`du` — `[done]`
Both exist and use `fs.counts()`; browser-tested.

### B6. No quarter snapping / no keyboard window moves — `[done]`
`geometry.js` (halves/quarters/`nearestQuarter`), Alt+arrow snapping, arrow-key move and
Shift+arrow resize via the title bar; unit + browser tested.

### B7. Image Viewer had no zoom/next/previous — `[done]`
Zoom controls and folder walking exist; browser-tested.

### B8. Web Browser had no history/loading/error state — `[done]`
Back/forward history, loading state, "may refuse to be embedded" hint and an
"Open in a real tab" escape hatch; browser-tested.

### B9. Touch/small screens are second-class — `[done]`
`addLongPress()` in `utils.js` gives desktop icons and Files cells a long-press context
menu; on coarse pointers a second tap on the selected icon opens it (no double-tap race);
`.taskbar-items` scrolls instead of hiding overflow; `-webkit-touch-callout: none` stops
the iOS callout. Covered by a Playwright test in a `hasTouch` context.
Remaining touch polish is listed under B10.

### B10. Touch support was functional but shallow — `[done]`
Long-press vs native `contextmenu` is now deduplicated in both directions (our timer wins
→ the native duplicate is swallowed via `consumedContext()`; the native menu arrives first
→ our timer is cancelled), browser-tested in both orders. `watchToolbarOverflow()` is now
also applied to `#taskbar-items`, so a crowded taskbar shows the same honest fades as app
toolbars (`shots/09-taskbar-overflow.png`); browser-tested. The Viewer gained pinch-zoom
(two-finger, continuous 10–800%, `touch-action` locked only while pinching);
browser-tested in a touch context. Remaining touch polish moved to B12/B13.

### B11. Dropping files onto the desktop did nothing — `[done]`
The desktop now accepts file drops (with a dashed `.dropping` outline affordance and
`dragend` cleanup) and uploads them into `~/Desktop` via the shared `importFiles()`
helper; browser-tested, including the desktop icon appearing.

### B12. Pinch-zoom anchors at the top-centre, not the pinch midpoint — `[done]`
`applyZoom()` always lays the zoomed image out at `start center`, so zooming in loses the
point you pinched on. **Change:** offset `.viewer-main`'s scrollLeft/scrollTop by the pinch
midpoint delta. Matters for actually inspecting a detail of a photo.

### B13. Taskbar items have no touch affordance — `[done]`
Taskbar buttons only respond to `contextmenu` (mouse right-click); on touch there is no
long-press menu for minimise/maximise/close. `addLongPress()` is already the right tool.

### B14. Upload/drop has no size budget — `[done]`
`importFiles()` refuses files over `MAX_IMPORT_BYTES` before reading them, with a
per-file toast naming the file and size; the Upload button title states the limit.
Batch-level budget added in v07 — see B15.

### B15. A batch of individually-legal files could still blow the storage quota — `[done]` (v07)
`importFiles()` now tracks a cumulative `MAX_IMPORT_BATCH_BYTES` (4 MiB) per batch and
refuses the files that no longer fit, with a toast naming the remaining budget. The
Upload button title states both limits. Browser-tested (two 2.6 MB files: first
imports, second refused).

### B16. Paint had Undo but no Redo — `[done]` (v08)
An accidental `Ctrl+Z` used to be irreversible. `undo()` now pushes what it removed onto a
`redoStack`, any new stroke drops that branch, and `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
work while the Paint window is focused. Both buttons are visibly disabled when their stack
is empty and say why in the title; an empty redo says so in a toast instead of doing
nothing silently. Browser-tested (shortcuts, buttons, branch invalidation, empty-state
toast, disabled appearance).

### B17. Import limits were constants that lied about the device — `[done]` (v08)
`MAX_IMPORT_BYTES` was a guess about `localStorage`. `Store.capacity()` now measures the
real quota once per page load (exponential search then a bounded binary search with a
64 KiB reserve), `headroom()` subtracts `usage()`, and `importLimits(store)` derives the
per-file and batch budgets from it, capped by the documented constants. `df`, the Settings
storage card and the Upload button title all report the measured numbers. Unit-tested
against a quota-enforcing fake storage (6 MiB and 400 KiB quotas) and browser-tested
end to end (fill the storage, then a 2.5 MB import is refused naming the free space).

### B18. No interactive tiling manager — `[done]` (v10), M
The geometry was only reachable by knowing to drag to an edge. Two ways to discover it now:
**right-click a window's title bar** for a window menu listing every zone the
geometry implements — built from `geometry.js`'s exported `ZONES` table, with the same
Alt-shortcuts the keyboard uses, and `Close` styled as the destructive action it is — and a
snap preview that **names the zone it is previewing** ("Left half", "Top-left quarter",
"Full screen") instead of being a grey rectangle. The taskbar button's menu (added in v06
for touch) routes to the same menu, so both entry points now say the same thing.
`top`/`bottom` half zones were added so the menu covers the vertical split too. `tests/contracts.test.mjs` fails if the menu ever
advertises a zone `zoneRect()` does not implement. Browser-tested end to end
(`shots/17-window-menu.png`, `shots/18-snap-preview.png`).
Still not here: a tiling *manager* (split views, snapping to another window's edge).

### B19. The terminal is a toy shell — `[partly done]` (v10), M
Done: pipes (`cmd | cmd`) with six filters that read stdin (`grep`, `head`, `tail`, `wc`,
`sort`, `uniq`), general `>` / `>>` redirection for *any* command (previously only `echo`
had it, and it parsed `>` out of its own arguments), **`<` input redirection for any
command** (`wc -l < notes.txt`, `cat < file | head`), **`&&` that stops at the command that
failed** — every stage now tracks whether it printed an error, `cat` of a missing file and
`grep` with no match fail the way a real shell says they do, and `cat` became a filter so
`echo hi | cat` works — and a `help` that shows all of it. Quote-aware: `echo "a < b"` and
`echo "a && b"` are data.
Still missing: variables/aliases, globs, `sed`/`tr`, command substitution.
Done in v11: **`;` groups** (each one starts fresh; a failure in the group before it is not
its business), **`||`** (runs only when the left side failed), **`2>` / `2>>`** for any
command — errors are a second stream, they still count as a failure for `&&`, `2> /dev/null`
says nothing and `2> file` on a clean command writes an empty file — and **`Ctrl+R` reverse
history search** (narrows as you type, newest match first, repeated `Ctrl+R` walks further
back and says `2/2`, Enter accepts the command into the prompt line rather than running it
unseen, Escape gives back the line you were writing). Pipeline semantics now match bash: the
*last* stage's status decides the pipeline, so `cat missing | wc -l` succeeds.
Done in v12: **`2>&1`** — the error stops being a separate stream and joins the output,
through a pipe or into a `>` file — **`&>` / `&>>`** for both streams to one file (appended,
not truncated: see A30), and a stage that failed no longer cancels the stages after it in the
same pipeline (A29). One deliberate simplification: `2>&1 > f` and `> f 2>&1` mean the same
thing here (both streams into `f`); a real shell distinguishes them by order of appearance.
Done in v13: **`$HOME` / `$PWD` / `~`** expand in every word a command reads, including
redirect targets (see B23, A36). Done in v23: user-defined variables and globs. Done in v24:
`$(…)` command substitution. Done in v25: **aliases** (`alias`/`unalias`, expanded at the point
of use) and **`sed` / `tr`** as pipe filters. Still missing: job control (`&`).

### B20. Paint's toolbar needed scrolling to reach “Save PNG” at 420px — `[done]` (v09)
`watchToolbarOverflow()` now supports an app-declared collapse order
(`toolbar[data-collapse]`): groups are compacted, in the order the app chose, only when the
bar genuinely cannot fit. Paint hides the swatch row, then the px readout, then falls back
to glyph-only tool/history buttons (`shots/14-paint-compact.png`); Files elides the
breadcrumb to the last two entries with a leading `…`, shrinks the filter field, then drops
to glyph-only create/sort buttons (`shots/15-files-compact.png`). Every app now declares a
`minWidth` its toolbar actually fits at, and a test asserts that (`tests/measure-toolbars.mjs`
is the dev tool that prints the measurements).

### B21. A window you moved could not be put back — `[done]` (v11), M
Dragging, arrow-key nudging, snapping and resizing all change a window's rect, and until now
the only way back was to drag it back by eye. `WM` keeps a small `moveHistory` per window
(max 5) and the window menu offers **"Undo move"** — only when there is something to undo.
A burst of arrow keys within a second is one intention, so it is one undo, and a title-bar
press that did not change the rect records nothing. Restoring clamps to the current viewport,
so undoing a move does not put a window off a screen you have since resized.

### B22. A window's menu could be a different menu depending on where you clicked it — `[done]` (v11), S
The title-bar right-click and the taskbar right-click both go through `#windowMenu`, but
nothing said so. A test now asserts the two lists are `deepEqual`, item for item — including
"Undo move" appearing in both or neither.

### B23. The terminal had no variables at all — `[done]` (v13), M
Every path in the shell had to be typed out or clicked into the Files address, and `cd ~`
— which the prompt itself prints — did not work. `$HOME`, `$PWD` and `~` now expand in
every word a command reads, arguments and redirect targets alike, with the two rules that
make a variable usable rather than a surprise: quoting stops expansion (`echo "$HOME"`
prints `$HOME`), and an unknown name is left exactly as typed rather than silently blanked
(`echo $NOPE` prints `$NOPE`, because a blank is how a typo gets lost). Tab completes a
half-typed name (`$HO` → `$HOME`). Deliberately *not* added: user-defined variables — they
would need state the user cannot see or list, which is a different feature.

### B24. `cd -` did not exist, and the shell could not name the directory it had just left — `[done]` (v14), S

The one shell habit people type without thinking. `cd` now accepts `-`: it goes to the directory
the shell came from, it *toggles* (two `cd -` in a row are back and forth), it works inside a
`&&` chain like any other argument, it refuses with `cd: no previous directory` when there is
none and `cd: no such directory` when it has been deleted — and in both refusals the working
directory, the prompt and the window title stay where they were. `$OLDPWD` joins
`$HOME`/`$PWD`/`$USER` in expansion and in Tab completion, because a shell that can take you
back should say where it is taking you back to. `man cd` and `help` describe it. Browser-tested
end to end, including the deleted-directory case, the chain, and Tab-completing `$OLD` →
`$OLDPWD`.

### B25. What the shell still does not have — `[partly done]` (v23: variables, globs; v24: `$(…)`; v25: aliases, `sed`/`tr`), M

**Variables and globs landed in v23** (`set`/`unset`/`export`, `$NAME`, `~`, `*`, `?`, `[abc]`,
with quoting rules shared between them and `man variables` / `man globs`), **command substitution
in v24**, and **aliases and the text-editing filters in v25** (`alias`/`unalias`, `man aliases`,
`sed 's/x/y/g'`, `sed '/x/d'`, `tr a-z A-Z`). What is left is job control (`&`), which needs a
real async command model rather than another expansion in the pipeline. B19 records what landed
in which iteration.

---

## C. Error handling & trust boundaries

### C1. `window.confirm`/`window.prompt` were the only modal UI — `[done]`
`src/core/dialogs.js`: themed, focus-trapping, promise-based; browser-tested that no
native dialogs are used.

### C2. Web iframe sandbox `allow-scripts allow-same-origin` — `[done]`
`allow-same-origin` is only granted for cross-origin URLs.

### C5. One bad uploaded file aborted the whole batch — `[done]`
Upload and drop now go through `importFiles()` (in `utils.js`): each file is read and
written independently, FileReader errors are reported per file as a toast, and the
toast count reflects files actually imported (the drop handler used to announce
“Dropped N files” before any write had finished). Browser-tested.

### C3. Dead `escapeHtml()`/`isText()` in utils — `[done]`
Removed.

### C4. Version string duplicated in four places — `[done]`
Single `VERSION` export in `utils.js`.

### C6. A failed write was reported as whatever wording the browser happened to use — `[done]` (v11), M
`Store` used to pattern-match error text for "quota". Browsers disagree about that text
(`QuotaExceededError`, `NS_ERROR_DOM_QUOTA_REACHED`, `The quota has been exceeded.`), and a
storage that is simply *unavailable* (private mode, blocked storage) looked like a quota
problem. `Store.#classifyWrite()` now returns a `kind` — `quota` / `unavailable` /
`serialisation` / `unknown` — from the error identity first, its message second, and a
measurement last (it only claims "unavailable" when a capacity probe also fails, and never
claims it without one). `lastErrorKind` is exposed, and the three places that talk to a user
about it say something different per kind: `main.js` has a message per kind, `df` names the
kind, and the Settings storage card states the cause and what you can do about it (delete
files / this browser is blocking storage / the data could not be encoded). Unit-tested with
all three wordings of a quota error plus an unavailable and a serialisation failure.

---

## D. Performance

### D1. Tray walked the whole tree on every focus change — `[done]`
`fs.counts()` is cached and invalidated by mutations.

### D2. `#renderTaskbar()` rebuilt every button on every focus event — `[done]`
The taskbar is now incremental: a `Map<winId, button>`, structural changes only on
create/close, class/label updates on focus/state/rename; covered by a test that marks a
button and asserts it survives focus changes.

### D3. Paint's undo stack stores up to 25 full-canvas PNG data URLs — `[done]` (v07)
Undo snapshots are now raw `ImageData`, capped by a 48 MiB byte budget instead of a
fixed count: no PNG encode/decode per stroke, and undo is synchronous `putImageData`.
Snapshots taken before a window resize are restored scaled to the current backing
store. Browser-tested (exact restore, restore across a resize, undo-to-blank).

---

## E. Accessibility / UX

### E1. Windows were not keyboard reachable — `[done]`
`role="dialog"`, labelled title bar with `tabindex=0`, keyboard move/resize/snap/maximise,
labelled window buttons.

### E2. Menus claimed `role="menu"` with plain buttons — `[done]`
`role="menuitem"`/`separator` now used.

### E3. No `prefers-reduced-motion` handling — `[done]`
`styles/os.css` disables window/menu animations under reduced motion.

### E4. No visible focus ring — `[done]`
`:focus-visible` styles exist across the shell.

### E5. Narrow-window toolbars clipped content invisibly — `[done]`
Toolbars scroll horizontally with overflow fades (`data-overflow-*`); browser-tested.

### E6. Accent presets had poor contrast on accent buttons — `[done]`
`--on-accent` is now a theme token (`#fff` default; dark for lime/amber/rose) used by
`.btn.primary`, `.dlg-btn.primary`, `.seg .active` and `.calc-key.eq`; asserted by a
browser test and visible in `shots/07-accent-contrast.png`.

### E7. Taskbar had no empty state — `[done]`
A muted “No open windows” hint appears when no windows exist
(`shots/08-taskbar-empty.png`); browser-tested.

---

## F. Test coverage

### F1. No unit tests for window maths — `[done]`
`tests/geometry.test.mjs` covers zoneRect/snapTarget/resizeRect/moveRect/nearestQuarter/
spawnOrigin.

### F2. Browser test gaps — `[done]`
Now covered: drag-resize via a corner handle, Paint “Save PNG” → Viewer, session restore
of a maximised window, touch long-press/tap-to-open, taskbar incremental updates and
empty state, accent contrast, Files clipboard copy/paste through the context menu,
Upload-button and drag-and-drop file import (into Files and onto the desktop),
long-press/contextmenu dedupe in both orders, pinch zoom, and taskbar overflow fades.

### E8. Resize strips are hittable but invisible — `[done]` (v07)
Each corner handle now carries three short diagonal grip lines (CSS
`repeating-linear-gradient` on `::after`): hidden at rest, faint while the window is
hovered, stronger when the handle itself is hovered. `shots/11-resize-grip.png` shows
the south-east grip; browser-tested via computed styles of the pseudo-element.

### E9. Windows were labelled, but nothing proved it — `[done]` (v08)
`role="dialog"` + `aria-label` existed since E1 and `setTitle()` kept it in sync, but no
test asserted either. `assertWindowsAreLabelled()` now checks every open window has a
non-empty `aria-label` matching its title bar text, including after a rename.

### E10. No focus trap inside app windows — `[done]` (v09)
`#wireFocusRing(win)` in `src/core/wm.js`: Tab is intercepted only at the first/last
visible control of a window, so focus wraps inside the window you are working in instead of
walking into the desktop behind it. The ring is computed per Tab press (apps add controls
freely), it respects `defaultPrevented` (the terminal's Tab completion still works), and it
skips hidden/disabled/`aria-hidden` controls. Browser-tested in Paint and the terminal.

### E12. Two copies of “what counts as a control” — `[done]` (v10)
`#wireFocusRing`'s selector in `wm.js` and `auditControls()`'s selector in
`tests/a11y.mjs` were the same list written twice. `src/core/utils.js` now owns it once —
`INTERACTIVE_SELECTOR`, `isUsableControl()` (rendered, not `aria-hidden`, not disabled) and
`reachableControls()` — the focus ring walks `reachableControls(win.el)` and the audit is
handed the same selector. Two tests keep it that way: `tests/contracts.test.mjs` fails if
either file grows its own copy again, and a browser test walks Paint's whole Tab ring and
asserts it stops at exactly the controls the audit names, and never at the disabled
Undo/Redo.

### E13. A window's context menu could hang out of the window it belonged to — `[done]` (v11), S
`openContextMenu()` clamped to the viewport only. On a 360px Files window the overflow menu
(`shots/19-toolbar-overflow.png`, first capture) ran 240px past the window's right edge, which
reads as a menu for something else. `openContextMenu(x, y, items, { within })` now takes the
rect the menu belongs to and keeps it inside horizontally; the window menu and every toolbar
⋯ menu pass their window's rect. Vertically it may still spill past a short window — there
is nowhere else for a 12-item menu to go — and that is said in the code.

### E14. The ⋯ button overlapped the control scrolled under it — `[done]` (v11, closed v13), S
A sticky overflow control sits on top of scrolled content; that is what real toolbars do, but
the first capture showed the Files filter field cut mid-word behind it. The bar's own edge
fade sits *behind* the button, so `.toolbar-more` now carries its own left gradient, which
cuts the content instead of overlapping it. The remaining half — end padding on the scrollport
— was looked at in v13 and rejected: padding moves the *content*, not the sticky button, so a
control still travels under it while scrolling, and it would shift every toolbar measurement
the width tests depend on. The gradient is the fix; the padding was a guess at one.

### E15. A toolbar's overflow menu named things by their tooltip, not their name — `[done]` (v11), S
The first draft of the ⋯ menu used `title` when a control had no `aria-label`, which produced
menu rows like "Upload files (up to 1.0 MB each — only 3.7 MB of this browser's storage is
free)". `controlName()` in `utils.js` now has one order for every surface: accessible name →
visible text (ignoring the glyph span) → title. A menu of actions should read as a list of
actions. The Upload button also gained a real `aria-label`.

### E16. The folded breadcrumb's `…` hugged its separator on one side — `[done]` (v13), S
Every crumb is a button with 6px of horizontal padding; the ellipsis that replaces the folded
segments was a bare `<span>`, so `~ / …/ notes / deep` read as a typo in a path rather than
as a fold. The ellipsis now takes the same padding a crumb's text would: it stands in for a
segment, so it occupies a segment's room. Visible in `shots/23-files-partial-fold.png`.

### E11. Grabbing the top edge of a window resized it when you meant to move it — `[done]` (v08)
The north resize handle spanned the whole top edge. Its middle (32%–68%) is now a
`.rz-move` strip that drags the window through the same `#startMove()` the title bar uses
(snap preview included), and only the parts near the corners still resize. A short dash in
the strip shows where the grab is (`shots/12-move-strip.png`). Browser-tested: the strip
moves without changing size, the same edge near a corner still resizes.

### E17. A narrow Files bar had two identical `↑` buttons meaning different things — `[done]` (v14), S

Found by looking at `shots/15-files-compact.png`, not by measuring: the parent-folder button is
`↑`, and the compacted Upload button added by A40 was `⬆`. At a 580px window they sit seven
controls apart and read as the same action twice. A compacted form has to be distinguishable
from every other glyph in the bar, so Upload is `📤` — an outbox tray with an arrow, which is
what it is, in the same visual language as the `📁＋` and `📄＋` beside it.

### E18. The dead-end crumb was the widest thing in the bar at the width the bar is worst at — `[done]` (v19), S

A53's crumb is longer than the segment it replaces: `used-to-be-here missing` costs more than
any real folder name at the collapsed cap. At 360px that is exactly the width where the bar has
already given up everything else, so the new affordance arrived with a new reason for the ⋯.

`.crumb-gone` is now the **first** entry in Files' declared collapse order — ahead of
`.files-create`, which is the rung that costs the user nothing. A path you cannot go to is not
worth more than an action you cannot take; the notice carries the same information and the button
that fixes it, so the crumb is the redundant copy. Browser-tested as a shape: at 360px the crumb
is hidden, the anchor and the notice are not, and the declared order is read from the DOM and
asserted to place the crumb ahead of the trail.

The first capture also showed the failure mode E16 was about, one level further along: hiding the
crumb left an orphan `/` at the end of the trail — `~ /` with nothing after it, which reads as a
path cut off mid-word. The separator now travels *inside* the dead end, exactly as a foldable
middle segment carries its own.

### E19. A long file name lost the part that says what kind of file it is — `[done]` (v19), M

This is the truncation gap A44/E17 left open, and it is worse for files than for folders: a CSS
ellipsis eats the **end** of a name, and for a file the end is the extension. In a narrow grid
column `2024-06-30-team-retrospective-notes-final.tar.gz` renders as
`2024-06-30-team-retrospective-n…` — the one piece of the name that was not the author's
choosing is the piece that got thrown away, and `.tar.gz` is the difference between an archive
and a document.

`splitExtension()` (in `utils.js`) hands the layout a head it may cut and a tail it must keep;
`.filecell .name` is a flex row whose head carries the ellipsis and whose tail is never shrunk.
There is still exactly **one** truncation mechanism — the ellipsis does the cutting, this only
decides which half it is allowed to eat — which is the objection v18 raised against middle
ellipsis, and it is the reason this is safe: the grid cell is not a rung on any bar's ladder, so
nothing about `fit()` changes.

The rules for *not* splitting are the part that keeps it from becoming a second shape names can
have: a short name is left whole, a dotfile (`.gitignore…`) is a whole name, a chain of dotted
words (`Makefile.build.target.thing…`) is not an extension, and a compound extension is kept
whole — `.tar.gz` cut to `.gz` protects the wrong half. Every split is lossless: the cell's text
and tooltip still contain the entire name. Unit-tested in `tests/names.test.mjs` (eight cases,
including a lossless sweep over awkward names) and browser-tested in a 360px window: the head is
asserted to *actually be truncated* before the tail is asserted to be visible.

### F5. Remaining test gaps — `[done]`
Closed in v06: the `.dropping` affordance, multi-file uploads, cut-mode paste via the
Files menu, and pinch clamping at 10%/800% are all browser-tested. v07 added Paint undo
(including the scaled-restore path), the batch import budget, and the resize-grip
affordance. v08 added Paint redo, the measured storage headroom (unit + browser), the
`df` output, the accessibility audit, window labelling, the disabled-control appearance,
the universal toolbar fade and the top-edge move strip.

### F7. The quota probe had no unit test — `[done]` (v08)
`tests/storage.test.mjs` uses a `quotaStorage(limit)` fake that throws the way browsers do
and asserts: the probe finds most of a 6 MiB quota but never more than it, a 400 KiB
quota is reported as tiny (so imports shrink), usage moves the free space but not the
ceiling, the ceiling is cached, and with no `localStorage` headroom is `Infinity` rather
than a fabricated number.

### F6. The accessibility helper has no self-test — `[done]` (v09)
A test now feeds `auditControls()` a probe containing a named button, an unnamed button, a
hidden unnamed control and an `aria-hidden` subtree, asserts it reports exactly the one
problem it should, asserts `assertNoUnnamedControls()` throws on it, then breaks a live
window's `aria-label` and asserts `assertWindowsAreLabelled()` catches that too. Neither
helper can silently become a no-op.

### F3. `consoleErrors` assertion hid behind a final test — `[done]`
Each test now reports console errors it caused.

### F4. Tests depended on wall-clock/locale output — `[done]`
No locale-dependent assertions remain in `browser.test.mjs`.

### F8. The width sweeps waited a fixed 300ms per width whether the bar had settled or not — `[done]` (v14), S

Two of the most expensive tests in the suite walk a Files window and a Paint window through six
widths each, waiting 300ms at every one — 3.6s of pure waiting, and still not a guarantee:
the wait was a guess about when the ResizeObserver, the collapse and the layout had all
finished. **Change:** `setWidths()` resizes and then polls until two consecutive reads of the
bar's own signature (`clientWidth | scrollWidth | how many controls are collapsed`) agree,
typically two frames. Deterministic *and* about 2.5× faster. Every width-sweep loop uses it.

### F9. The fold's minimality test asked the wrong question — `[done]` (v14), S

The Files and Paint sweeps asserted "put the innermost hidden piece back and the bar must
overflow", implemented as *the first hidden swatch* / *the last hidden crumb*. That is not the
last thing the bar gave up whenever the prefix runs past the units into a whole group: at 560px
Paint gives up eight swatches **and** the size readout, and putting a swatch back is not
undoing that cut — the brush slider shrinks to absorb it and the bar still fits. The test
failed, and the test was the thing that was wrong.

**Change:** a `lastCut(bar)` page helper reconstructs the same flattened sequence the watcher
uses and returns the element at the end of the prefix; both sweeps now assert that un-hiding
*that* element breaks the fit, and both assert that the set of given-up groups is a prefix of
the declared order (`1*0*`, never `101`). Those are the two properties `shortestFit` exists to guarantee, which is the point of having them in a test rather than in a comment.

### D4. The browser suite is ~130s — `[done]` (v18), M

F8 removed the fixed waits from the two sweeps; the suite went from ~146s to ~127s. The
remaining cost was not waiting: it was ~86 tests sharing one page and one Chromium, in a fixed
order, each one able to depend on what the test before it left open.

**Change:** `tests/browser/` — seven area files (desktop, windows, toolbars, terminal, files,
apps, a11y) over one `fixture.mjs` that owns the browser, the server and the desktop helpers.
`node --test` runs the files in parallel: **103 tests in ~35s**, down from 158s for the single
file. The split also removed a class of bug the single file had: two tests were quietly borrowing
state from earlier tests (one used a window another had opened, one used a file another had
written) and now write their own. `setWidths()` was hardened to wait for the *layout* to settle —
every bar's box, chosen cut level and pass counter unchanged across two polls, after three frames
— because a ResizeObserver-driven fit is not finished when the resize is.

**What keeps it from decaying:** `tests/contracts.test.mjs` reads the directory and fails if any
area file imports playwright or starts its own server, or if any of them does not import the
fixture. A second fixture is a second Chromium per file, which is the whole cost back.

### D5. The browser suite's speed is a property of the machine, and had never been measured on a slow one — `[done]` (v19), S

D4's "103 tests in ~35s" is true on the 24-core box it was measured on. The split buys
parallelism, and parallelism is what a two-core laptop does not have. Measured here with
`node --test --test-concurrency=2 tests/browser/*.test.mjs`: **107 tests in 93s** — still under
the 158s of the single file D4 replaced, but not the 35s the README claimed.

The README now states both numbers and what each one is a property of, and suggests running one
area file at a time on a small machine. No code change: the honest thing about a performance
claim is the conditions it was measured under.

---

## G. Documentation

### G1. README missed `tests/serve.mjs`/PORT/symlinked node_modules — `[done]`

### G2. No documented `undone.md` / iteration contract — `[done]`
The README now has a “How this repo is maintained” section describing the three
maintenance files.

### G3. The core writes eleven `data-*` diagnostics and none of them were written down — `[done]` (v19), M

`data-collapsed`, `data-collapsed-effective`, `data-collapsed-exhausted`,
`data-collapsed-units`, `data-collapsed-limit`, `data-collapsed-effective-limit`,
`data-collapsed-effective-walks`, `data-collapsed-effective-walk-ms`, `data-fit-passes`,
`data-overflow-*`, `data-diagnostic-depth`. They are the reason `probe.mjs` and the width sweeps
can assert anything about a bar at all — and until now the only place they were described was the
source that writes them, one attribute at a time, in three different files.

The README has a **DOM diagnostics** reference: what each attribute says, what it counts, and —
the half that matters — what it does *not* say (`data-collapsed` is rungs applied, not rungs
needed; `data-collapsed-effective` is absent when nothing was measured, which is not the same as
zero; `unmeasured` is not `0`).

It is kept honest by a contract test rather than by care: the test scans `src/core/*.js` for
`dataset.<name> =` writes and fails if any of them is missing from the table, and fails the other
way too for a documented attribute nothing writes any more. Adding a diagnostic without
documenting it is now a failing test, and so is documenting one that has been removed.

---

## Visual improvements (see `shots/`)

Captured with `npm run screenshots` (Playwright, 1280×800, deviceScaleFactor 2).

1. **Welcome window over desktop icons** — `[done]` `spawnOrigin()` places new windows
   below the icon grid; browser-tested.
2. **Files breadcrumb truncation / missing counts / dead empty area** — `[done]`
   scrollable toolbars with fades, counts shown, real empty state.
3. **Paint title ids, colour-swatch sliver, clipped Calculator** — `[done]` for titles
   and swatches (`input[type=color].swatch` is styled to 26px); the clipped-window case
   is now honest via clamping + keyboard move.
4. **Paint canvas affordance** — `[done]` the status bar shows `W×H px`.
5. **Accent contrast (`lime`, `amber`)** — `[done]` see E6; `shots/07-accent-contrast.png`
   shows the light-theme + lime case with dark text on primary buttons.
6. **Missing states** — Web loading/error `[done]`, Files empty `[done]`, taskbar empty
   state `[done]` (`shots/08-taskbar-empty.png`).
7. **Crowded taskbar cut buttons off with no hint** — `[done]` the taskbar now reuses
   the toolbar overflow fades; `shots/09-taskbar-overflow.png` shows six window buttons
   in a 760px viewport with the cut side faded; browser-tested — and the fade now
   refreshes when windows open/close (A12).
8. **Desktop drop affordance had no visual proof** — `[done]` `shots/10-drop-affordance.png`
   shows the dashed outline during a file drag; the class toggling itself is browser-tested.
9. **Resize handles looked fine but were ungrabbable at the corner** — `[done]` see A11;
   handles now sit inside the window edges.
10. **Resize handles were invisible** — `[done]` see E8; `shots/11-resize-grip.png`
   shows the diagonal grip revealed at the south-east corner while the handle is hovered.
11. **The top edge gave no hint that its middle moves** — `[done]` see E11;
   `shots/12-move-strip.png` shows the dash in the middle of a terminal window's top edge.
12. **Undo/Redo gave no hint of which step existed** — `[done]` see B16/A13;
   `shots/13-paint-history.png` shows Undo dimmed and unusable next to a live Redo after
   undoing back to a blank sheet.
13. **Paint's toolbar at 420px** — `[done]` (v09) see B20. `shots/14-paint-compact.png`
    shows the compacted result: glyph-only tools, one swatch, the slider, glyph-only
    history, and “Save PNG” still labelled and reachable.
14. **Files at its 580px minimum** — `[done]` (v09) `shots/15-files-compact.png`: the
    breadcrumb reads `… user / Documents` (the `…` says the trail is elided; the full path
    is in the title bar), the filter field is `Filter…`, create/sort are glyph-only and the
    sidebar is icon-only. Nothing is clipped.
15. **New in this pass, found by looking rather than measuring** — “Eras” (A17) and the
    cut-off placeholder (A18), both fixed above. `shots/06-paint.png` and
    `shots/05-files-toolbar.png` now show full labels at the default window sizes.
16. **Everything else re-checked in `shots/01`–`shots/13`** — no layout breakage, no
    clipped or overlapping content, empty/loading/error states still present. The Welcome
    tour still fits its window (asserted by a test); its copy now mentions the window menu
    and `<` input redirection.
17. **A 420px desktop, which had never been looked at** (`shots/16-narrow-desktop.png`,
    new) — this is where the pass found A21: five of nine desktop icons off the right edge
    of the screen. After the fix the icons wrap into 4×3, the Files window is clamped to
    the viewport with its title bar buttons reachable, and its toolbar scrolls with the cut
    side faded. Two things the shot still shows and A22 records: the toolbar needs ~145px
    more than the window has, and the window covers the icon grid (the documented
    `spawnOrigin` fallback when a window will not fit below it). The first capture of this
    screen also showed the status bar reading "0 folders, 1 files" (A24); it now reads
    "0 folders, 1 file".
18. **The taskbar at phone width** — `1 window · 5 files` was competing with the window
    buttons for room and a 220px button title was most of the screen. Below 560px the
    status text and the clock's date are dropped and the button cap is 150px; the window
    buttons and the time are what a taskbar is for. Visible in the same shot.
19. **Tiling you can see** (`shots/17-window-menu.png`, `shots/18-snap-preview.png`, new)
    — the window menu lists every zone with a glyph that draws the zone, the shortcuts
    beside them, and `Close` in the destructive colour; the drag preview is the zone's own
    rectangle with a label naming it. Both are generated from the same `ZONES` table the
    geometry uses.
20. **A toolbar that cannot fit, and the ⋯ that fixes it** (`shots/19-toolbar-overflow.png`,
    new in v11) — Files at its declared 360px minimum: the bar is 312px of room around 533px
    of content, the sticky ⋯ sits at the visible end with its own left fade, and its menu
    lists exactly the actions the bar cannot show (New folder, New file, Upload files), each
    with the control's own glyph and, since A31, a hint naming the side it is off. The menu is
    kept inside the window (E13). Choosing an item scrolls the control into view and runs it —
    verified in a browser test that then finds the created folder or file in the filesystem.
    (The glyph column no longer wraps a two-character glyph: A33.)
21. **A desktop full of files** (new test, 640×480 with 40 files) — the icon grid scrolls,
    the last icon is reachable, and a window opened on top of it is still fully inside the
    screen. This is A23, which no screenshot of the seeded nine-icon desktop could ever show.
22. **The terminal mid-search** (`shots/20-terminal-rsearch.png`, new in v11) —
    `user@browseros:~$ (reverse-i-search)'grep': grep -n note ~/notes.txt`: the query, the
    command it found, and the history above it that the search is walking. The same shot is
    how A25 was found: the previous capture of this line showed `no such file: /home/user/note`,
    because `grep -n` had been read as the pattern.
23. **Files at the width it opens by default** (`shots/21-files-default-width.png`, new in v12)
    — `~/Documents/notes/deep` in a 840px window. Before this pass this is the screen where
    the breadcrumb was hidden outright (A27). Now the whole trail reads
    `~ / Documents / notes / deep`, nothing is out of reach, and what gave way instead is the
    *labels* on the two create buttons — whose glyphs were already the icon for the action.
24. **The same window too narrow for the whole trail** (`shots/22-files-folded-crumb.png`, new
    in v12) — 700px: the middle folds and says so, `~ / … / deep`. The two segments that
    survive are the ones that orient you (where the tree starts, and where you are), and the
    title bar still spells the full path. The ellipsis only appears when a segment really was
    folded — a two-deep path at the same width shows no `…`.
25. **The width in between** (`shots/23-files-partial-fold.png`, new in v13) — 760px, where
    the bar needed one segment's worth of room and gave up exactly one: `~ / … / notes / deep`.
    This is the state the old all-or-nothing collapse could not produce at any width. Looking
    at this capture is also how two things that had nothing to do with the fold were found:
    the ellipsis hugging its separator (E16) and the empty folder's message wrapped into a
    single 104px grid column (A37) — `deep` is empty, and "This / folder is" was being laid
    out as if it were a file cell. Both are fixed above; the regenerated capture reads
    `~ / … / notes / deep` with even spacing and shows the empty folder's message as one
    centred sentence.
26. **A palette that gives up one colour at a time** (`shots/24-paint-palette-fold.png`)
    — re-measured in v14 with `tests/probe-fit.mjs`: the shot used to be taken at 720px, where
    the bar in fact needs nothing (A42), so it showed a full palette under a caption claiming a
    partial fold. It is now taken at **680px**, where four of the eight swatches go and nothing
    needs a ⋯: the colour input and the four colours listed first stay, the brush slider, the
    size, Undo/Redo/Clear and a labelled Save PNG are all still there. The measured ladder is
    720px → five kept, 680px → four, 660px → three, 640px → two, 600px → one, 560px → none and
    the size readout too.
27. **Files at 580px, looked at again after A40** (`shots/15-files-compact.png`) — every group
    in the bar can now be compacted, and at this width none has to be: the trail is whole, the
    filter field is whole, and the create, sort and Upload buttons are glyph-only. That is where
    E17 was found — Upload's `⬆` and the parent folder's `↑` are the same arrow — and why
    Upload is now `📤`, which is unmistakable in the regenerated capture.
28. **Files at its 360px minimum** — `measure-toolbars.mjs` now names what is off the edge and
    prints the width of every control in the bar, because "4 in the menu" is not something you
    can act on. `files@360`: 413px of content in 312px of room, `New file` and `Upload files`
    in the ⋯; `files@380`: one. Before A40 it was 444px and two at both widths.
    **Re-measured in v15: nothing is in the ⋯ at 360px any more** (A43), and the ⋯ first
    appears at 340px — see 30.
29. **The create pair becomes one button, then one glyph** (`shots/25-files-new-menu.png`, new
    in v15; and `shots/15-files-compact.png`, re-measured) — the ladder this pass added, read
    off the measurements: 640px and above, `📁 New folder` and `📄 New file`; 700–520px, one
    `＋ New` button whose menu names both actions; 460–360px, the word is given up too and the
    button keeps its `＋`; below 360px, the ⋯. `shots/25` is the 360px state with its menu open
    — the menu is the part that never gets given up, and it is drawn inside the window it belongs
    to. `shots/15` at 580px is the honest version of the old capture: `Sort: Name` keeps its
    word while `＋` loses its, which is the declared priority — the glyph already means "new",
    and `⇅` alone would no longer say what the folder is sorted by.
30. **The ⋯ at 340px, not 360px** (`shots/19-toolbar-overflow.png`, re-taken) — the caption used
    to say "Files at its declared 360px minimum" while the shot was really showing a bar that
    had run out of things to give up. After A43 that state only exists *below* the minimum, so
    the capture is taken at 340px and says so: `Upload files → off the right`, with the tray
    glyph still peeking past the ⋯ and the right edge faded.
31. **The fold's band is as wide as the thing it folds** (`shots/22-files-folded-crumb.png` at
    470px, `shots/23-files-partial-fold.png` at 520px, re-taken) — both captions named widths
    that no longer fold anything after A43 freed ~50px of room. The partial fold now lives
    between 490px and 540px: a band exactly as wide as the breadcrumb segment it gives up. That
    is worth remembering the next time a test sweeps widths in 80px steps and concludes a state
    does not exist.

32. **The Places list becomes icons because the bar asked it to** (`shots/26-files-places-as-icons.png`,
    new in v16) — the widest window that still needs the 126px, found by bisection (722px at
    `~/Documents`). The sidebar is a column of five recognisable glyphs, every one still clickable and
    still named, and the toolbar has given up nothing but the create pair. This is the state the old
    independent breakpoint produced by accident at some width between 640 and 700; now it happens
    because the bar measured that it needed it.
33. **A name the bar refuses to pay for** (`shots/27-files-long-folder-name.png`, new in v16) —
    `~/Documents/a-folder-name-long-enough-to-cost-the-bar-room` at the declared 360px minimum:
    `~ / … / a-folder-n…`. The middle is folded, the current folder is *shortened*, and only then are
    actions given up — the ⋯ covers what still falls off. Looking at this capture is what turned A44
    from "the minimum is not honoured" into "the minimum is honoured by the chrome, and the content
    pays a bounded amount", which is what the app spec now says.
34. **Files at its declared minimum, in a real folder** (`shots/15-files-compact.png`, retaken) — the
    old caption claimed this width shows everything on the bar. It does not, and never did for a
    folder with a name: at 360px `~/Documents` is 430px of content in 312px of room. The caption now
    says what is actually promised — every action reachable, the rest named in the ⋯.

35. **What `12ch` of a folder name actually is** (`shots/28-files-long-single-word.png`,
    `shots/29-files-cjk-folder-name.png`, new in v17) — the last crumb's collapsed cap was
    re-examined by measuring it in characters instead of reasoning about it in `ch`. At the 12px
    crumb font the cap resolves to **82px**, which shows eleven Latin characters of
    `extraordinarilylongfoldernameonewordwithnohyphensatall` (`extraordinin…`) and five characters
    of `日本語のフォルダ名前です` (`日本語のフ…`): CJK is about twice as wide per glyph, so a cap
    written in `ch` is a cap in Latin. The bar's overflow is **identical** in every case — 465px of
    content in 312px of room — which is A44 working: the name costs the bar its cap, not its length.
    The honest conclusion is in `project-description.md`: eleven characters of a word you have never
    seen is not a recognisable name, and no ellipsis position fixes that in an 82px box. What makes
    the trade acceptable is that the name is never *lost*, only summarised — full in the crumb's
    accessible name, its tooltip, and (since A46) the title bar, which is visible in both captures:
    `Files — ~/Documents/extraordin…` and `Files — ~/Documents/日本語のフ…` each carry the whole
    string as a `title`.
36. **The ⋯ and the filter box, looked at closely** — the 1× capture of Files at 360px reads as
    though the ⋯ is sitting on top of the filter field, merging them into one control. Re-captured
    at deviceScaleFactor 3 and measured: the field is 70px at `[200, 270]`, the ⋯ starts at 273, and
    `Filter…` is fully legible with a 3px gap and the bar's own fade beyond it. E14 stays closed;
    the overlap was a downscaling artifact, and the caption here is the record of having checked.

37. **The folder that is not there** (`shots/30-files-missing-folder.png`, new in v18) — the first
    capture of A51 put the notice at the *bottom* of the grid, under the folder icons, where the
    window's status bar clipped the button off. That is the wrong order of importance: the notice is
    the reason the window looks different, so it now sits above the contents in its own bordered
    panel (`grid.prepend`, a surface and a border rather than faint centred text, which read like a
    caption belonging to the grid). Re-captured: the sentence, the path in the user's own notation
    (`~/Documents/used-to-be-here`) and the **Create that folder** button are all fully inside the
    window at 640×430, and the home folder below is still usable.

---

38. **The path that ends in a dead end** (`shots/30-files-missing-folder.png`,
`shots/31-files-missing-narrow.png`, new in v19) — the breadcrumb now carries the fact itself:
`~ / used-to-be-here missing`, the name struck through, marked, and **not a button** — a control
that looks clickable and is not is a lie about the interface, and the button that fixes it is in
the notice below. The second capture is the same window at 360px, the width the bar is worst at:
the dead-end crumb is the first thing the bar gives up (E18), the anchor and the notice are not,
and — this is the part only a screenshot caught — the first version left an orphan `/` after `~`
when the crumb was hidden, which reads as a path cut off mid-word. The separator now travels
inside the crumb.

39. **A long file name, cut from the end it cannot afford to lose** (`shots/32-files-long-names.png`,
new in v19) — Files' grid at 420px with `2024-06-30-team-retrospective-notes-final.tar.gz`,
`quarterly-report-draft-3.docx` and `short.md`. The first two are cut after their beginnings and
keep `.tar.gz` and `.docx`; the third is not split at all, because a name nobody would truncate
should not acquire a second shape for no reason (E19). The full name is still the cell's text and
its tooltip — the split is a layout instruction, not a rewrite of the name.

---

40. **A folder name in the breadcrumb, cut so the word that says *which* folder survives**
(`shots/33-files-crumb-marker-tail.png`, `shots/34-files-crumb-widest-tail.png`,
`shots/37-light-long-folder-name.png`, new in v20) — `release-2024-06-30-snapshot` in a 360px
window renders as `release-2024-…-snapshot`: the head is ellipsised inside the 12ch box, the
tail is pinned and never cut. The second capture is the widest tail the rule is allowed to keep
(8 characters, `-final`), which is the case where the head is closest to disappearing; it is a
measured cap, not a taste (`node tests/measure-crumb.mjs`). The third is the same window in the
light theme.

41. **A desktop icon whose name is longer than the icon** (`shots/35-desktop-long-names.png`,
`shots/38-light-desktop-long-names.png`, new in v19, *actually showing the feature* in v20) —
`2024-06-30-team-retrospective-notes-final.tar.gz` renders as `2024-06-30-te…` over `.tar.gz`,
`release-2024-…` over `-snapshot`, and `short.md` is not split at all. The label wraps, so the
line the clamp throws away used to be the last one — the line the extension was on. The head is
now one ellipsised line and the tail is its own line under it.
*The capture was the bug here*: both desktop shots were clipped to 420px of a 1280px desktop,
and the desktop lays its icons out in a row — the long names were at x ≥ 812, so for two
iterations these captures showed Terminal, Files and Text Editor and none of the names the
feature is about.

42. **The light theme, measured instead of looked at** (`shots/36-light-missing-narrow.png`,
`shots/37-light-long-folder-name.png`, `shots/38-light-desktop-long-names.png`, new in v20) —
every capture in this project was dark until now, and the states that carry their meaning in
colour are exactly the ones a dark theme hides. The dead-end crumb's name was 2.92:1 in the
light theme (it used `--text-faint`, which is a dark-theme faint); it now uses `--text-dim` and
measures **5.63:1**. The desktop labels were worse: the light theme's ink is a dark ink, the
wallpaper is a user setting that defaults to a dark gradient, and the two met for the first
time at **1.4:1** — text nobody can read. They now measure **10.8:1 to 13.6:1** on every
shipped wallpaper, in both themes. The numbers are printed by `npm run screenshots`, computed
from the wallpaper's actual painted pixels, not from the CSS that describes it.

43. **A danger button that was unreadable in the theme it was hardest to read in**
(`shots/39-light-danger-button.png`, new in v21) — the Settings "Factory reset" / "Reset
filesystem" button, light theme: white on `#ff4d5e`, **1.98:1**. It is now white on
`#b3261e`, **6.54:1**, and the same button in the dark theme is `#21070c` on `#ff5f6d`,
**6.46:1**. The same capture shows the System card's plain buttons unchanged — the fix is a
colour pair, not a redesign.

44. **What the token report prints now** (`npm run screenshots`, new in v21) — the light- and
 dark-theme token pairs are measured and printed whether or not a window is open to paint them:
 status text on a window, a danger button label, accent-coloured text on a window, a primary
 button label. Every pair is ≥4.5:1 in both themes as of this pass; the report is what would
 notice if one drifted.

45. **A desktop label with room for the name it is showing** (`shots/35-desktop-long-names.png`,
`shots/38-light-desktop-long-names.png`, updated in v21) — the head is now two clamped lines
instead of one ellipsised line: `2024-06-30-team-…` over `.tar.gz`, `quarterly-report-draft-3`
over `.docx` (the whole stem, not `quarterly-re…`), `release-2024-` / `06-30` over `-snapshot`.
The row track went 92px → 108px to hold it; the numbers are in `tests/measure-desktop.mjs`.
Line breaks prefer a hyphen over the middle of a number (`overflow-wrap: break-word`), which is
why `release-2024-` ends a line and `06-30` starts the next one.

---

## What I did in this iteration (v23)

Carried in from v22's list: A64 (the CSS contracts check), A65 (fold the probe into the suite),
A66 (per-screen coverage claims) and B25 (shell variables and globs). All four are done. Two
latent bugs were found on the way, one in the shell and one in the test suite's own claims; both
are described below because they are the kind this loop exists to find.

**1 — A contracts check over the stylesheets (`tests/contracts.test.mjs`).** A64's class, closed.
The new test walks every rule block in `styles/os.css` that *rebinds* an ink token (`--text`,
`--text-dim`, `--accent-text`, `--ok-text`, …) and requires a `color:` declaration in the same
block: rebinding a token is not applying it, which is exactly how the terminal's text went
invisible in the light theme at v22. The check runs in both directions — every ink token defined
in `styles/theme.css` must be painted with somewhere in `os.css`, so a token can be added to the
palette and used by nothing. Verified non-vacuous: deleting the `color: var(--text);` line from
`.term` makes that block the single failure it reports.

**2 — Variables and globs in the shell (`src/apps/terminal.js`).** B25, the longest-open item in
this file, in the shape the rest of the shell already has.

- A real tokenizer. `tokenize()` now produces `{text, parts: [{text, quoted}]}` instead of a
  regex split, because `FOO="a b"` is one word whose *middle* is quoted. Quoting used to be a
  property of a whole word, which is why `NAME="a b"` could not have worked before.
- `NAME=value` at the start of a command defines a variable; `set` lists them, `unset` removes
  them, `export NAME=value` is the same thing with the words preserved. `set` is the point of the
  feature: a value the user cannot list is a second hidden state in a shell whose job is to be
  inspectable. Built-ins (`HOME`, `PWD`, `USER`, `OLDPWD`) refuse assignment — `HOME=/tmp` turning
  `cd ~` into a trip to a directory that does not exist is worse than an error.
- `$NAME` expands only in unquoted parts; an unknown name is left exactly as typed; `~` expands
  only when the whole word is unquoted. Variables expand before globs, so `ls $DOCS/*.md` works.
- `*`, `?` and `[abc]` expand against a directory listing. A pattern that matches nothing is left
  literal, so the command says what happened (`cat *.nope` → `no such file: *.nope`) instead of
  the shell inventing a result. Quoting stops a glob exactly as it stops `$HOME`.
- `man variables` and `man globs` are real pages; `help` and Tab completion know both.

**3 — Several file arguments, honestly (`src/apps/terminal.js`).** A glob turns one word into
many, and every command that took "the file argument" would have used only the first match — a
half-answer that looks like a result. `ls` now takes several targets and shows a file as itself;
`wc` names each file and totals them; `head`/`tail` label each file with `==> name <==` when
there is more than one; `sort` concatenates. `uniq` is unchanged because merging files into one
neighbour-dedup is what `sort a b | uniq` already means.

**4 — `head -n 2 notes.md` was reading a file called "2".** Found while testing the above:
`fileArg()` was `args.find(a => !a.startsWith('-'))`, so the *value* of `-n` was the file
argument. It had been there since the flag existed and no test had ever passed a file to a
`-n` command. `fileArgs()` now skips a value flag and its value. `mkdir -p` was the same bug in
a different command: it created a directory named `-p` in the home folder (visible in
`shots/40-terminal-vars-globs.png` before the fix). `mkdir` now treats `-p` as the no-op it is in
this filesystem — parents have always been created — and says `already exists` instead of
`created` about a directory that was already there.

**5 — The contrast audit now has a coverage claim (`tests/contrast.mjs`).** `assertReadable` takes
`expect: [string | RegExp]` and fails when a run of text it was asked about was never measured,
with a message that says what is missing and why that is the suspicious case. `minRuns` stays as a
floor, but it is no longer the claim: a screen could lose half its labels and still clear ten
runs. Every screen in `tests/browser/contrast.test.mjs` now names the text it must have seen — the
tray's `N windows · M files`, the Start menu's app rows, the context menu's labels, a dialog's
title and both buttons, the terminal's prompt/result/error lines, Files' sidebar and status bar.

**6 — And the audit's own guards are tested.** A new test asserts that an expectation of text that
is not on the screen fails the audit (as a string and as a pattern), that the same audit passes
when asked about text that *is* there, and that an audit of a selector matching nothing is a
failure rather than a pass. Without these, `expect` is a feature that could silently stop working.

Writing that test exposed a trap in the same mechanism: a run's text is stored truncated to 60
characters because that is what a *report* prints, and a claim was being matched against it — so an
expectation longer than 60 characters could never be satisfied by text that is plainly on the page.
Runs now carry `fullText` as well as `text`, claims are matched against the full one, and a test
writes a 100-character sentence into the page and asserts both that the report form is still the
truncated one and that the claim matches the whole run.

**7 — Every app, once, in one theme (`tests/browser/contrast.test.mjs`).** A65. The nine
registered apps are opened maximized and audited in the dark theme, each with its own window title
as the coverage claim — the one piece of text every app window is guaranteed to paint, which is
what stops "an app opened empty" from auditing cleanly. Cost: 10.7s, against the four minutes the
dev probe takes for 28 sections in two themes. `tests/contrast-probe.mjs` stays as the reporting
tool it is for.

**8 — A test that was auditing the wrong screen.** `page.click('.desktop', …)` is a *left* click:
the test named "the desktop context menu" had never opened a context menu, and `minRuns: 6` was
satisfied by the desktop icons behind it. It is now a right click, it names the menu's labels, and
it asserts that `Paste` is *skipped as disabled* — so the WCAG 1.4.3 exemption cannot quietly
grow to cover something that is not disabled. This is the same failure mode as A66, found by
fixing A66.

### Still open, ranked (v23)

- **A67. The modal exemption is broad.** `covers()` treats a text run as occluded when any element
  in its covering chain *contains* a `[role="dialog"]` anywhere in its subtree. That is right for a
  scrim over the desktop, and wrong for a sibling subtree: a toast in an overlay layer that also
  holds a dialog would be skipped because a dialog exists nearby. The precise version is
  geometric — the dialog's own box has to contain the sampled point — and it is a change to a
  delicate audit that currently passes, so it wants its own failing test first. S
- **A68. `wc`/`head`/`tail` name files as the shell wrote them, `ls` names them as the
  filesystem calls them.** `wc -l a1.txt` prints `a1.txt`, `wc -l ~/x/a1.txt` prints the absolute
  path. Real `wc` echoes the argument. Consistent today; worth a decision before a third command
  copies one of the two. S
- **A69. `grep` over several files does not prefix the matches.** `grep note *.md` prints matching
  lines with no indication of which file they came from, which is the one multi-file command where
  the answer is unreadable without it. S
- **A70. No `cd` into a glob, and no glob in a redirect target.** `echo x > $DOCS/*.txt` writes a
  file literally named `*.txt`. Real shells refuse; this one silently creates a strange name. S
- **E27. `sampleCanvas` samples the element, not the visible viewport.** Unchanged from v21. S
- **B25 (remaining): aliases, `sed`/`tr`, command substitution, job control.** `$(…)` is the next
  one after variables — it is the same expansion machinery with a subprocess attached.
- **B18 no tiling manager, `win.data.requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** — unchanged
  from v19, for the same reasons.

### Visual notes (see `shots/`)

Captured for this pass: the full `npm run screenshots` set, plus a new
`shots/40-terminal-vars-globs.png` — a terminal showing `set` listing a user variable with its
value quoted, `ls $DOCS/*.txt` expanding to both matches, `wc -l $DOCS/*.txt` naming each file and
totalling them, and a quoted `"*.txt"` staying a name. Judging that screen is what found the
`mkdir -p` bug: the first version of the shot has a directory called `-p` in the home listing.
No layout breakage, clipping or overlap in the new capture. The one thing it does show is the
first command line scrolled off the top of a 640×470 terminal, which is a terminal behaving like
one rather than a defect — but it is also why the demo commands were kept short.

---

## What I did in this iteration (v22)

Carried in from v21's list: A63 (the rendered-text audit), A62 (accent text on its own tint),
E26 (derive the plate alpha), and making the screenshot token report assert. All four are done.
A63 was the one worth doing first, and it earned its place immediately: it found two defects that
the project's entire token-level test suite — built up over five iterations of exactly this
concern — could not see.

**1 — The audit itself (`tests/contrast.mjs`, `tests/png.mjs`).** It walks every visible text run
in the live page, records its computed colour, the product of its ancestors' `opacity`, its font
size and weight, whether it is a disabled control and whether it is a lone glyph, then hit-tests a
grid over each line box with `elementFromPoint` so that only points where that run is genuinely
the topmost thing get sampled. Two screenshots are taken — one as the page is, one with every
glyph fill made transparent — and the background is whatever the browser composited at those
points: gradients, plates, translucent surfaces, backdrop blur, the window on top. `tests/png.mjs`
decodes the screenshots with `zlib` alone, so the measurement is of real pixels and the project
still has no runtime dependency. `assertReadable(result, where, { minRuns })` makes it an
assertion rather than a report.

The interesting parts are the three things it deliberately does *not* hold to the bar, each
counted in the result so a page cannot pass by hiding everything: text under a modal (a layer
carrying `role="dialog"` makes everything below it inert), glyphs that have a name next to them
(WCAG 1.4.11 — an icon beside the words it stands for is decoration), and disabled controls
(1.4.3). A covering element whose composited alpha is under 0.85 is treated as a veil and the
text under it is measured *through* it, which is what a dialog scrim is.

**2 — What it found first: the terminal was never painting with its own ink.** `.term` rebinds
`--text` to a terminal palette, and the token tests proved that palette reads. They never proved
anything *used* it. Plain terminal output has no `color:` declaration, so it inherits a computed
colour from the nearest ancestor that has one — the window, not the terminal. In the light theme
`ls` output was `#16202f` on `#0f172a`, **1.15:1**: invisible. The audit did not even report it
at first, because text that close to its own background produces no glyph pixels and was skipped
as unpainted — so the audit was changed to judge such a run from its declared ink against the
background measured under it, which is the same claim, made honestly. `color: var(--text)` on
`.term` fixes it; `tests/token-contrast.test.mjs` asserts the line exists.

**3 — Desktop icon tiles followed the theme while their labels followed the wallpaper.**
`.dicon`'s colour is `--wallpaper-text`; its tile was `--surface-2`, which follows the theme. On
a dark wallpaper in the light theme that is light ink on a light tile — **1.1:1** for every
monochrome glyph (⌨️, 📄, the document icon). The tile is now built from the ink it carries:
`color-mix(in srgb, var(--wallpaper-text) 26%, transparent)` over 9%, with a 32% border. A tile
can no longer be stronger than the glyph it holds, in any theme, on any wallpaper.

**4 — The ink hierarchy, measured rather than named (A63's token half).** `--text-faint` was
2.90:1 on its own theme's panel and 2.11:1 on a tinted one. Rather than collapsing the third
level into the second, all three were recomputed so each clears 4.5:1 on the worst surface it is
actually used on while staying visibly separate: dark 14.76 / 9.07 / 6.44, light 16.38 / 8.96 /
5.98 — a factor of at least 1.25 between adjacent levels, which `tests/token-contrast.test.mjs`
asserts. The terminal got its own palette (`--term-text`, `--term-dim`, `--term-faint`,
`--term-ok`, `--term-danger`) because its canvas does not change with the theme and its text
tokens were being asked to.

**5 — Accent text on its own tint (A62).** Each accent preset now defines `--accent-text-dark`
and `--accent-text-light`; `:root` picks one and the light theme overrides it. The dark values
were raised in HSL (hue and saturation kept, lightness lifted until the preset clears 4.5:1 on
plain panels *and* on its own `--accent-soft` tint); the two light-theme values that needed help
were mixed toward black in sRGB, which preserves the hue exactly. Rose, the worst case at 3.02:1,
is now 4.6:1 on its tint. A browser test pins the weakest preset on both surfaces.

**6 — The dialog scrim became a named token.** `.dialog-layer` painted a literal `rgba(4,7,14,.55)`
in both themes; in the light theme that is a dark sheet over a light desktop. `--scrim` is now a
per-theme token (`rgba(15,23,42,.35)` in the light theme). The audit does not measure text under
a modal, so this is a judgement about how the background should look rather than a contrast fix.

**7 — The plate's strength is solved for, not guessed (E26).** `PLATE_FOR` was one fixed rgba per
ink: `.62` dark, `.74` light, for every wallpaper that needed one. `plateAlphaFor` now bisects for
the weakest alpha that lifts *this* wallpaper's worst point to 4.5:1, capped at 0.9 because past
that it is a panel and not a plate. A wallpaper that misses the bar by 0.25:1 gets a 4% plate
instead of a 62% slab; a wallpaper that spans near-black to near-white still gets a strong one
(0.52), and no derived plate is stronger than the guess it replaced — which is asserted, along
with a 400-wallpaper sweep proving that every plate ever chosen is measured, capped, applied only
where there is a real shortfall, and reported as the number it actually produces.

**8 — The screenshot token report asserts.** `tokenReport()` in `tests/screenshot.mjs` throws on
any pair below 4.5:1 instead of printing a table a human is expected to read.

**Tests: 212, all passing** (87 unit + 125 browser; was 196). New: `tests/token-contrast.test.mjs`
(5), `tests/browser/contrast.test.mjs` (8, including a self-test proving the audit fails on text
that is not readable), 3 plate-strength tests, and a `.term` colour assertion. `tests/contrast-probe.mjs`
and `tests/png.mjs` are support files, not test files.

### Still open, ranked (v22)

- **A64. "Rebinds a token" is being mistaken for "paints with that token", and only `.term` is
  checked.** The terminal bug is a class: any rule that redefines `--text*` in a block and relies
  on inheritance to apply it will silently use an ancestor's value. `tests/token-contrast.test.mjs`
  asserts the line exists for `.term` and nothing asserts it for the next component that makes the
  same mistake. A contracts check that walks the stylesheets for blocks redefining a text token and
  requires a `color:` in the same block would close the class. M
- **A65. The full-app contrast probe is a dev tool, not a test.** `tests/contrast-probe.mjs`
  audits all eight apps in both themes — 28 sections, all clean — and takes about four minutes.
  `npm test` covers the shell, the terminal, Files and the weakest accent. The gap is every app the
  audit is not currently asserting on. Cheapest useful version: every app opened once in one theme.
  M
- **A66. `minRuns` is a proxy for coverage.** `[done in v23 — `expect:` in `assertReadable`]` `assertReadable` proves the audit saw *enough* runs,
  not the runs it expected; a modal dialog legitimately has four, so the floor is configurable and
  a screen could lose half its text and still pass. What is wanted is a per-screen expectation.
  S
- **A67. The modal exemption is broad.** Anything whose covering chain contains
  `[role="dialog"]` is skipped. Correct for a scrim over the desktop; it would also skip real
  content placed inside a dialog-shaped container. S
- **E27. `sampleCanvas` samples the element, not the visible viewport.** Unchanged from v21. S
- **B25 shell gaps, B18 no tiling manager, `requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** —
  unchanged from v19, for the same reasons.

### Visual notes (see `shots/`)

Captured for this pass: `90-before-light-terminal.png` / `92-after-light-terminal.png` (the
terminal's `ls` output going from invisible to normal), `91-before-light-dialog.png` /
`93-after-light-dialog.png` (the light theme's dialog scrim, and the taskbar under it),
`94-after-desktop-dark.png` / `95-after-desktop-light.png` (the desktop is now identical in both
themes, which is the point: it follows the wallpaper, not the theme), and
`96-after-startmenu-dark.png`, `97-after-startmenu-light-rose.png`, `98-after-files-light-rose.png`
(selected states under the weakest accent). No layout breakage, clipping or overlap was found in
any of them; the defects were contrast defects, and the before/after pairs are the record of that.

---

## What I did in this iteration (v21)

Carried in from v20's "next iteration should": the Settings readout (1), the desktop head cap
(2), the dense sample and the mid-tone case (3), the dead `--wallpaper` declaration (4), a
Settings-level upload test (5). All five are done. Reading the stylesheet to do 1 turned up a
larger problem than 1: several tokens were being used as *text* while being defined as *fills*,
which is the same bug v20 found on the desktop labels, one layer down in the token system.

**1 — `--ok` / `--warn` / `--danger` were one value doing two jobs (A60).** They are fills: a
toast's left border, a danger button's background, a strikethrough colour. They were also used
as *text* in four places — the terminal's error output, a context menu's "Delete", a danger
dialog's icon, and (before v20) the crumb's dead-end name. The light theme never redefined any
of the three: `--danger: #ff4d5e` was chosen to read on a dark desktop, and as text on a white
card it is **1.63:1**. Split into `--ok-text` / `--warn-text` / `--danger-text` (ink on a
surface) and `--on-danger` (ink on a danger fill), each defined per theme. Measured, text on
`--surface-2`: dark 8.83 / 8.85 / 5.29, light 5.98 / 6.02 / 6.05; danger button labels 6.46 /
6.54. The fills stay as they were — a border and a background are not text and were never the
problem.

**2 — the same split for the accent (A61, finishing E6).** `--accent` was used as text in ten
rules: the Calculator's operator keys, `.linkbtn`, terminal output, the Start button, the
wallpaper picker's selected swatch, the snap-preview label. In the light theme that is `#4f8cff`
on white — **2.14:1**. And `--on-accent` was white for every preset except lime/amber/rose, so
white on blue, violet and teal is **2.1–3.5:1**: E6 fixed three presets and left three.
`--accent-text` is now defined per theme and per preset (light: blue `#1d4ed8` 6.20, violet
`#6d28d9` 6.57, teal `#0f766e` 5.06, amber 5.20, rose 5.43, lime 6.55; dark: blue `#4f8cff`
4.85, violet `#b18aff` 5.91, the rest unchanged), and `--on-accent` gained dark inks for
blue/violet/teal (`#08111f` 5.88, `#12081f` 5.59, `#04140f` 8.93). `--accent` itself is
unchanged as a fill.

**3 — a contract test for the token system (F11).** `tests/contracts.test.mjs` now walks every
`var(--x)` in `styles/os.css` and requires it to be defined in `theme.css` or written at runtime
by `theme.js`; a *text-colour* token must be defined in both the `:root` block and the light
block, or be listed as deliberately theme-independent with a reason. It is mutation-tested —
deleting `--ok-text` from the light block makes the suite fail — and it is the test that found
item 1. Without it the split in items 1–2 is a one-off fix that the next edit quietly undoes.

**4 — the wallpaper is sampled, not stepped over (E24).** `sampleCanvas()` takes 32 samples
along the longest side (≈1000 points, capped at 4096) instead of nine points at fixed fractions.
The case it was written for: a 128×128 wallpaper that is `#101828` except for a `#7d858e` band
8% of its height, placed between two of the old sample rows. Nine points reported light ink at
**15.15:1 with nothing behind the label**; the label on the band was really **3.19:1**. The
dense sample reports the same ink at **10.36:1 with a plate**, which is the honest number, and
the browser test asserts the *worse* one — that a minority of the image is allowed to change the
answer. `tests/measure.mjs`'s local copies of the contrast formula were deleted and re-exported
from `src/core/utils.js`, so the instrument and the app cannot disagree.

**5 — a plate, for a wallpaper no ink reads on (E25).** Two inks cannot serve a mid-tone: at
Sunset's `#b23a48` the better ink is 5.0:1 and the worse is 2.2:1, and the old code took the
better one and called it fine. Now, if the best ink's worst point is under **4.5:1**, the label
gets a plate — a dark one under light ink, a light one under dark ink (`PLATE_FOR`) — and the
ratio is measured *through* the plate by compositing (`mixOver`). A wallpaper that already reads
gets no plate; `--wallpaper-plate` defaults to `transparent` and the label paints it as
`background` plus a 3px `box-shadow` spread, which costs no layout when it is transparent.
Padding was tried first and rejected: it takes 8px off every label's text room, on every
wallpaper, to pay for a plate that is never drawn. Verified end to end with an uploaded
`#7d858e` image: dark ink on a light plate, **12.03:1**.

**6 — Settings says what the measurement found (A58b).** Under the wallpaper tiles and the
upload button: "Desktop labels: readable on this wallpaper (10.66:1)", or "…need a plate behind
them (3.19:1 without one)", or "…could not be measured from this wallpaper". It subscribes to
the `wallpaper:ink` event the theme emits, so it follows an upload the moment the image is
measured, and it unsubscribes when the window closes. Three browser tests cover it, including
one that drives the real `<input type=file>` with `setInputFiles` and reads the number back.

**7 — two lines of name, measured before they were allowed (E23).** `tests/measure-desktop.mjs`
(now part of the repo's probes) measures the label box: 92px wide, no padding, 6.86px per
glyph at 12px → ~13 glyphs a line, ~26 across a two-line head, where one line held 13. The
head is `-webkit-line-clamp: 2`, the grid row track went 92px → 108px (measured icon content:
padding 12 + glyph 46 + gap 4 + label 42 = 104px), and the plate halo is counted in the
overflow assertion only when a plate is actually painted. `overflow-wrap` went from `anywhere`
to `break-word` so a hyphenated name breaks at its hyphens and a name with no delimiter still
breaks somewhere.

**8 — housekeeping that was worth finding.** `tests/wallpaper.test.mjs` was not in `npm test`
or `npm run test:unit` — twelve tests were being skipped by the project's own script; both
scripts now include it. The dead `background: var(--wallpaper)` in `.wallpaper` is gone (A59):
`Theme.apply()` writes the element's inline style and `theme.js` owns the token, and the one
rule that still referenced the token was a lie about which of the two was in charge.

**Tests: 196, all passing** (was 178). New: 6 plate/compositing tests in
`tests/wallpaper.test.mjs`; 4 browser tests (the thin-band regression, an uploaded mid-tone
image through the real file input, the Settings readout following the measurement across two
wallpapers, every accent preset as button text *and* as text on a surface in both themes, status
colours at token level and on a rendered `.btn.danger`); 1 contracts test for the token system,
mutation-tested; the desktop label test now asserts two head lines, the row track, and that the
label does not overflow its row; the preset sweep test now uses the app's own `sampleCanvas`
instead of a re-implementation injected into the page.

### Still open, ranked (v21)

- **A62. Accent text on an accent-tinted background is under the bar for four presets.**
  `--accent-soft` is the tint used for the active/selected state (Start menu items, the active
  taskbar button, `.seg.on`, `.cmenu-item.on`). `--accent-text` on that tint measures blue 4.39,
  amber 4.36, rose **3.02**, teal-light **3.54**. The token split made the *plain surface* case
  correct and left the *tinted* case alone, because fixing it means either a lighter tint or a
  second accent token, which is a decision rather than a correction. M
- **A63. No audit of rendered text against its effective background.** Items 1–2 are token-level:
  they prove the pairs are right, not that every element uses the right pair. A pass that walks
  visible text nodes, computes the background it is actually painted on (including gradients and
  plates), and reports the failures is the version of this that cannot be gamed. M
- **E26. The plate is one fixed colour per ink.** `PLATE_FOR` is a constant rgba. A wallpaper
  that is only *slightly* mid-tone gets the same 62%/74% plate as one that is exactly the worst
  case. Choosing the plate's alpha from the measured shortfall would be a small, well-scoped
  improvement; it is not needed by any shipped preset. S
- **E27. `sampleCanvas` samples the element, not the visible viewport.** A 4K photograph in a
  400px window is sampled at 32 points across 400px of it, which is right for "what is behind a
  label" but means a wallpaper detail smaller than the sample step is still invisible to the
  measurement. S
- **B25 shell gaps, B18 no tiling manager, `requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** —
  unchanged from v19, for the same reasons.

---

## What I did in this iteration (v20)

Carried from v19: the head/tail split for breadcrumb folder names (1), the same split for
desktop labels plus the light theme (2), `try/finally` for the screenshot script's filesystem
mutations (3), `EFFECTIVE_SCAN_LIMIT` (4) and `win.data.requested` (5). Items 1–3 are done;
4 and 5 were deliberately not touched, for the reasons v19 gave. Working on 2 turned up a
larger problem than 2 — the light theme had never been looked at, and the wallpaper's ink was
nobody's job.

**1 — `splitName`: the same mechanism, one case wider (A56, E20).** `splitExtension` is now a
case of `splitName`: a name with an extension is split exactly as before; a name without one is
split at its last delimiter run, and the delimiter travels *with* the tail so the cut is
lossless (`-final`, not `final` — `…-final` and `…final` are different claims about the name).
Applied to the breadcrumb's last crumb, the breadcrumb's dead-end crumb, and the desktop's icon
labels. The tail cap is 8 characters, measured with `tests/measure-crumb.mjs`: the 12ch box is
82px with 70px of text, a 13-character tail leaves 0px of head, an 8-character tail leaves
12px and still buys 20px+ for every real name tested.

**2 — the desktop label's truncator is not the grid's, and the fix is different (E21).** A grid
cell is one line; a desktop label wraps to three and `-webkit-line-clamp` throws away *the last
line*, which is where the extension was. The first attempt (let the head wrap) made it worse: a
wrapped head pushed the tail past the end of the clamp, so the longest name lost its extension
exactly as before. The working shape is a block head (one ellipsised line) plus a block tail
(`line-height: 1`), with the clamp at 3 because the tail is a second box — 27px of label, two
lines of text, tail bottom landing on the label's bottom instead of past it.

**3 — the light theme, and the ink on the wallpaper (A57, E22).** `wallpaperColors()`
(`src/core/theme.js`) reads the solid colours out of the wallpaper CSS and picks the ink whose
**worst** point on the gradient is the most readable, then writes `--wallpaper-text` /
`--wallpaper-shadow` onto `<html>`. The ink follows the wallpaper, not the theme, because that
is what it is drawn on: "Paper" on the dark theme gets dark ink, "Aurora" on the light theme
gets light ink. Two shipped presets could not be fixed that way — Dusk ended at `#7597de`
(2.5:1 against any ink) and Sunset at `#f6a94a` (1.7:1): pretty gradients with unreadable
desktop labels. Their last stops were deepened, and `tests/wallpaper.test.mjs` now asserts that
every preset reaches 4.5:1 with the ink it is given, so a preset cannot be added blind again.

**4 — three ways the measuring instrument was wrong before the thing it measures was.** Worth
recording because each one produced a *passing* test or a *plausible* screenshot:
- `canvas.fillStyle` cannot be told a CSS gradient. It takes a colour; a gradient string is
  silently not one, and it paints black. The wallpaper contrast test measured everything against
  black and passed. `tests/browser/measure.mjs` now parses the gradient and rebuilds it as a
  real canvas gradient, at the same angle and stops.
- `.dicon .label` also matches labels *inside app windows*, which sit on a surface. The first
  contrast number was a Settings window's label on a white card.
- The desktop captures were clipped to 420px of a 1280px desktop whose icons flow in a row, so
  for two iterations they contained none of the names they were captions for.

**5 — `tests/screenshot.mjs` cannot leave a mess behind (F10).** Every path it creates is
registered with `track()` and removed deepest-first in one `finally`; the scattered inline `fs.rm`
calls are gone, including the ones on paths a crashed run never reached.

**Tests: 178, all passing** (was 177 + 5 new wallpaper tests + the browser wallpaper sweep).
New: `tests/wallpaper.test.mjs` (presets, worst-point selection, the unmeasurable-wallpaper
fallback, ink/shadow pairing); a browser test that walks all eight presets and measures the
label ink against the **painted pixels** sampled at nine points; three browser tests for the
name split (Files crumb at 360px, the dead-end crumb at 720px, desktop labels including
`.tar.gz`); 8 unit tests for `splitName`. `tests/contracts.test.mjs`'s one-fixture rule was
narrowed to *files that drive a browser*, so a shared instrument in `tests/browser/` is not
forced to import a browser to satisfy it.

**6 — the custom wallpaper never worked, and the reason it hid (A58, E23).** Settings' "Use your
own image…" hands the theme a bare `data:` URL. A bare data URL is not a valid `background`
value: the CSS parser rejects the declaration and the element keeps the wallpaper it already had.
No error, no log — the upload appeared to do nothing, and the only reason it was found now is
that the ink code asked the same element what it was painted with and got an answer that did not
match the setting. `wallpaperCss()` normalises it to `url("data:…")`. Then the measurement:
`paintCssBackground` returned *black* for a `url()` background, because `fillStyle` cannot be told
a non-colour and silently keeps the colour it had — so an uploaded pale photograph was measured
against black and "passed" at 17:1. It now returns false for a background it cannot paint, the
theme loads the image and samples its pixels, and `theme.wallpaperInkRatio` stays `null` until a
measurement has actually happened instead of carrying the previous wallpaper's number.


### Still open, ranked

- **A58. A custom wallpaper is not measured. `[done]`** — and it was worse than "not measured":
  it did not work at all. See item 6 below.
- **A58b. Settings does not tell the user what the measurement found. `[done v21]`** — a line
  under the wallpaper tiles, subscribed to `wallpaper:ink`, with the ratio and the plate case
  spelled out. See v21 item 6.
- **E24. `wallpaperInkFromRendered` samples nine points, not the whole wallpaper. `[done v21]`**
  — 32 samples along the longest side, with a regression test built from a thin bright band.
  See v21 item 4.
- **A59. `--wallpaper` in `styles/os.css` is dead. `[done v21]`** — the declaration is deleted;
  `theme.js` is the only mechanism. See v21 item 8.
- **E23. The desktop label's head is 78px of text in a 96px icon. `[done v21]`** — a two-line
  head, a 108px row track, and the geometry measured in `tests/measure-desktop.mjs`. See v21
  item 7.
- **E25. `wallpaperInkFromSamples` has no middle option. `[done v21]`** — not a third ink: a
  plate, measured through. See v21 item 5.
- **B25 shell gaps, B18 no tiling manager, `requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** —
  unchanged from v19, for the same reasons.

## What I did in this iteration (v19)

Carried from v18: document the diagnostics (1), re-examine the 24-rung cap with measurements (2),
measure the suite under constrained concurrency (3), the missing-folder sidebar behaviour (4),
`win.data.requested` (5), and the standing truncation gap (6). All six were worked; four are
finished, one is finished differently from how v18 framed it, and one is deferred with a reason.

**2 — the cap was the wrong number, and it was measured before changing it (A52).**
`tests/probe.mjs` now prints the walk's cost. An 18-folder-deep path at 360px: 25 rungs, **1.5ms
for the walk**, once per content because of v18's cache. A cap of 24 was therefore protecting the
user from a cost that does not exist, at the price of losing the diagnostic for exactly the deep
paths the diagnostic is interesting for. Raised to 48 with the measurement written next to the
constant, and `data-collapsed-effective-walk-ms` added so the next iteration does not have to
re-derive it. Tests updated: a 45-folder-deep path (53 rungs) is the new `unmeasured` case, and
the deep case now asserts `walkMs < 25` and that a cached re-fit does not re-pay the walk.

**4 and 5 — the missing folder became a fact the window keeps (A53, A54).**
`win.data` separates `path` (what is being shown) from `requested` (what was asked for), so a
restored session still knows it was asked for something that is gone — and still goes to it if it
came back. The breadcrumb ends in a dead-end crumb rather than only a notice, the crumb is placed
first in the collapse order (E18) and carries its own separator, and an empty home under a missing
folder says "Your home folder is empty too" instead of describing two unrelated problems. Four
new browser tests, one of them asserting the collapse order read out of the DOM.

**1 — every diagnostic the core writes is now written down (G3).**
A DOM diagnostics reference in the README for eleven `data-*` attributes, including what each one
does *not* say, kept honest by a contract test that scans `src/core/*.js` for `dataset.X =` writes
and fails in both directions: undocumented diagnostic, or documented diagnostic nothing writes.

**3 — the suite's speed is a property of the machine (D5).**
`--test-concurrency=2`: 107 browser tests in **93s**, against ~35s at the default concurrency on
this 24-core box. The README now says both, and says which one a two-core laptop should expect.

**6 — the truncation gap, answered for files rather than for folder names (E19).**
`splitExtension()` + a two-part grid cell: the beginning is cut, the extension is kept. This is
the half of the gap where the lost text is *load-bearing* — `.tar.gz` says something about the
file that the middle of its name does not — and it is the half where a second truncation
mechanism is safe, because a grid cell is not a rung on any bar's ladder. Folder names in the
breadcrumb are still end-ellipsised at the `12ch` cap; see the deferred list in `undone.md`.

**One thing only a screenshot caught:** the orphan `/`. The narrow capture showed `~ /` with
nothing after it — the separator belonging to a crumb that had been hidden. E16 was the same bug
one level earlier in the same mechanism.

Suite: **166 tests, all passing in 36s** (108 browser + 58 unit/contract), including the new
`tests/names.test.mjs` (8) and four new Files browser tests.

---

## What I did in this iteration (v18)

Carried from v17: split the browser test file (D4), check the keyboard-snap flake, bound or
measure the cost of the `data-collapsed-effective` walk, and Files' fallback when a launched path
does not exist. All four were done, plus the flake turned out to be a real bug (A49) rather than a
test problem.

1. **D4 — the suite is split** (`tests/browser/`, `tests/browser/fixture.mjs`). 86 tests in one
   3800-line file became seven area files over one shared fixture: **103 tests in ~35s** (was 158s
   serial). Two hidden dependencies on test order were found and fixed while verifying the split — a
   window-management test borrowing a terminal another test had opened, and a session-restore test
   reading a file another test had written. `setWidths()` now waits for the layout to settle
   (boxes, chosen cut levels and pass counters unchanged across two polls after three frames)
   instead of for the DOM to stop changing, and includes `data-fit-passes` in what it considers
   settled. `tests/contracts.test.mjs` guards the split against decaying back into per-file browsers.
2. **A49 — the keyboard steal.** The flake was reproduced 1 in 10, traced to three apps'
   `setTimeout(() => control.focus(), 30)`, and fixed with one core rule (`claimFocus`) that only
   claims focus when nothing else has. Eight consecutive runs of the previously flaky test: clean.
   A contract test forbids an app focusing a control on its own timer.
3. **A50 — the walk is bounded and observable.** Measured first: a 12-folder-deep Files path gives
   a 20-rung ladder, 19 of which buy room, 117px still over at the declared minimum; one rung costs
   ~0.03ms of forced layout, so an exhausted fit was paying ~0.6ms per resize event. Now cached
   against the content it measured: eight resizes re-fit (passes 4 → 11) and walk once
   (`data-collapsed-effective-walks`). Past the 24-rung cap the bar says `unmeasured` instead of `0`.
   Both are browser-tested; `probe.mjs` and `measure-toolbars.mjs` print `walks=`.
4. **A51 — Files names a folder it could not open**, in the window, with a way back to it.
   Browser-tested (including that an unrelated filesystem change does not erase it) and captured.
5. **Docs**: README, project-description and this file now describe `tests/browser/`, the walk
   cache and `unmeasured`, `claimFocus`, and the missing-folder state — all of which still said
   `tests/browser.test.mjs` at the start of this pass.

**Deliberately not done:** see `undone.md`.

---

## What I did in this iteration (v17)

Carried from v16: A46, A47, the two missing `watchToolbarOverflow` tests (scope fallback, bounded
settle), re-examining the `12ch` crumb cap, and merging the two probe scripts. All six were done.

1. **A46 — a title the bar truncates can still be read.** `src/core/wm.js`: `.wtitle` gets a
   `title` attribute when the window opens and `setTitle()` keeps it in step with the accessible
   name. Test asserts the title really is truncated at 360px before asserting the fallback exists,
   and asserts it again after an app renames its own window.
2. **A47 — the difference between what a bar gave up and what that cost.** `shortestFit` returns
   `{ cuts, fits }`; `watchToolbarOverflow` publishes `data-collapsed-exhausted`,
   `data-collapsed-effective` (walk-back re-measurement, ≤ 24 reads, watching `clientWidth` as well
   as `scrollWidth`) and `data-fit-passes`. `tests/fit.test.mjs` updated and extended; the browser
   suite gained a lab bar that isolates a no-op rung and a shape test on the real Files bar
   (`Documents` → one rung bought nothing; a 60-character name → all eight did).
3. **The two missing watcher tests.** A bar whose `data-collapse-scope` names an ancestor that does
   not exist behaves *identically* to a bar that declared no scope (compared field by field). And a
   bar whose collapse changes its own width — Files folding its Places sidebar — settles: the state
   is unchanged 700ms later, the pass counter stops increasing, and one resize costs at most 8
   measurement passes (measured: ≤ 3).
4. **The `12ch` cap, measured rather than argued** — see Visual improvements 35. No code change: the
   finding is that the cap is 82px ≈ eleven Latin or five CJK characters, that the bar's overflow is
   the same for every name length (A44 holding), and that the remaining unrecognisability is a
   property of an 82px box, not of this cap. Recorded in `project-description.md` so a later
   iteration does not re-derive it.
5. **One probe instead of two.** `tests/probe.mjs` replaces `probe-fit.mjs` and `probe-files.mjs`
   (deleted): app id *or* Files path, `--mkdir=` to create the folders being measured, the settled
   state first (including the new exhausted/effective/passes fields), then the rung-by-rung table
   with `(buys nothing)` marked on rungs that did not change the measurement. `README.md` and
   `project-description.md` point at it.
6. **Tests: 135 pass** (47 unit, 88 browser). Five new browser tests, two new unit tests. Two new
   screenshots (28, 29) taken by the same bisection-free script as the rest.
7. **A48, found by using the tool this pass wrote** — `node tests/probe.mjs ~/Documents/<name> 360`
   gave the same folder a *different bar* than opening it by absolute path: nine rungs instead of
   eight, and a breadcrumb reading `root / ~ / Documents / …`. `files.js` took `win.data.path` as
   `cwd` without resolving it, and the whole breadcrumb (and therefore the ladder) assumes an
   absolute path. One line at mount now normalises it; a test compares the trail, the title, the
   stored path and the resolved rung count across `/home/user/Documents`, `~/Documents` and
   `Documents`, and checks that a folder outside home is still honestly shown as outside home.
8. **One test made deterministic while chasing a flake.** `windows can be moved, resized and
   snapped from the keyboard` failed once in a full run and passed in the next, and passed in
   isolation both times. It focused `windows.values()[0]` — whichever window happened to have been
   opened first — before asserting that a keyboard snap moved *the terminal*. It now focuses the
   terminal by app id. Whether that was the whole cause is not proven: see `undone.md`.

**Deliberately not done:** splitting `tests/browser.test.mjs` (D4) — it is now ~3700 lines and the
next iteration should do it, but doing it in the same pass as four new tests would have made this
pass's own diff unreadable. Middle-ellipsis for long folder names — it only pays for itself above
the collapsed cap, where the box is 160px, and it would put a second truncation mechanism on a bar
that already has one.

---

## What I did in this iteration (v16)

Carried v15's list: A44 and A45 are done, the screenshot widths are derived instead of remembered,
the test-suite split (D4) and the real-device touch pass are still deferred. Two new findings came
out of this pass (A46, A47).

- **A45, in the core.** `watchToolbarOverflow` honours `data-collapse-scope`: a bar may declare
  groups that live outside itself, resolved against `toolbar.closest(scope)`. Files declares a
  hidden `.files-side-labels` marker as the second rung of its own ladder and the CSS reacts to it
  (`…is-collapsed ~ .files-side`). `.files.is-narrow` and the `narrowSide()` breakpoint are gone:
  one measured decision instead of two that had to be kept in step by hand. `is-tiny` stays — it is
  about the status bar and a keyboard that is not there, not about the bar.
- **The ladder order, chosen by looking at both options.** Pair first, sidebar second. At 840px with
  `~/Documents/notes/deep` that keeps the Places labels and folds the create pair into one `＋ New`
  menu; sidebar-first would have kept both create buttons and lost the labels. The rung that costs
  nothing is spent before the rung that costs 126px.
- **A44.** `.crumb-last` is a named unit of the crumbs group and the last thing the bar may give up:
  capped at 160px normally, at `12ch` when collapsed. A character cap rather than a pixel cap so a
  name short enough to fit under it is never cut for nothing (`shortestFit` hands that cut back).
  `minWidth`'s comment now states what it does not promise.
- **Tests ask for shapes, not widths.** `widthWhere(lo, hi, predicate)` bisects for the widest window
  where something is true, and leaves the window there. The middle rung of the create ladder is now
  asserted *at the width where the pair first goes* instead of at a remembered 580px. Two new tests:
  *widening a Files window never takes a control away* (a 320→840px sweep compared per affordance —
  the `＋ New` menu counts as New folder *and* New file, so replacing the pair is not a loss) and
  *a folder name too long for the bar costs the bar its own length, not another action* (a 35-char
  and a 60-char name must cost the same, the cut must be visible as an ellipsis, and the full name
  must still be in the accessible name and the tooltip). The test helpers now resolve collapse
  selectors through `data-collapse-scope` like the core does.
- **Screenshots derive their widths.** `tests/screenshot.mjs` has `setFilesWidth`/`widestWhere` and
  prints each boundary it found (`every middle crumb folded: widest at 489px`, `the Places words
  gone: widest at 722px`), so a caption can no longer quietly go stale when the layout moves — the
  shot moves with it. `shots/22` and `shots/23` are now taken at measured boundaries rather than at
  470px and 520px, which had already stopped being those states.
- New captures: `shots/26-files-places-as-icons.png` (the widest window that still needs the 126px:
  icon sidebar, nothing else compacted) and `shots/27-files-long-folder-name.png` (`~ / … / a-folder-n…`
  at the declared minimum, with the ⋯ covering the rest). `shots/15` is now Files at its declared
  minimum in a real folder, which is the honest version of the old 580px shot.
- `tests/probe-files.mjs` is a permanent dev tool (bar *and* sidebar at any widths, at any path);
  `measure-toolbars.mjs` now prints `places=N` because a collapse count no longer says what a window
  looks like.

All 128 tests pass (83 browser + 45 unit). `shots/` regenerated once.

---

## What I did in this iteration (v15)

Carried v14's list: A43 and the `shortestFit` proof are done, `prevCwd` was already documented
(closed), the test-suite split and real-device touch are still deferred. Two new findings came
out of the measuring (A44, A45).

- **A43 the create pair** — Files' two create buttons are now one `.files-new-menu` button whose
  context menu names both actions, and the fold is a *ladder* rather than a switch: the declared
  order is `pair → the word on its replacement → Sort → Upload → filter box → breadcrumb`, so a
  bar with room for one affordance keeps the word on it and only strips the glyph when it has
  shown it cannot afford the word either. Measured: `files@360` is 313px in 312px of room with
  **nothing in the ⋯** (was 413px with two items); the ⋯ first appears at 340px. The pair and
  its replacement are siblings in the DOM, so `.files-create-pair.is-collapsed ~ .files-new-menu`
  is what swaps them — no app code keeps the two in step.
- **`.toolbar .spacer { min-width: 0 }`** — a spacer is free space, not a control, and it was
  holding 4px in bars that had no room to give it. Four pixels is what `files@360` needed.
- **`.toolbar .btn-label.is-collapsed`** — found by measuring, not by reading: a unit that *is*
  the label carries the marker itself instead of inheriting it from a group, and the existing
  rule only matched the inherited case. The first version of the ladder silently kept the word.
- **A39 finished: `shortestFit` now verifies its own answer.** Probe caching, a walk-back over
  any cut the bar did not need, a `sawNonMonotone()` check, and a bounded linear scan when the
  predicate really is not monotone — so a control that grows when its neighbour is hidden (a
  fold marker, a flexible slider) cannot make a bar give up more than it needs. Proven both
  ways: five unit tests in `tests/fit.test.mjs` for non-monotone predicates, one of which
  asserts what the search *deliberately cannot see* (a prefix that fits before one that does not
  is invisible to any search that never probes it — the test names the accepted trade-off rather
  than pretending it is correct), and one browser test with a synthetic growable control in a
  real collapsible bar.
- **The tests now sweep widths the way the fold actually works.** The band of window widths where
  folding *one* breadcrumb segment is the right answer is exactly as wide as that segment; the
  old 80px steps walked straight over it and the test concluded the partial fold did not exist.
  The sweep is in 20–40px steps through that band and runs below the declared minimum, which is
  where the ⋯ is allowed to appear.
- Screenshots: `shots/25-files-new-menu.png` is new; `shots/22` (470px), `shots/23` (520px) and
  `shots/19` (340px) moved to widths where the claim in their caption is still true after A43.
  `shots/15` now shows the ladder's middle rung — `Sort: Name` keeping its word while `＋` loses
  its — which is the priority decision, written down in the code comment.

All 126 tests pass (81 browser + 45 unit). `shots/` regenerated.

---

## What I did in this iteration (v14)

Carried all six of v13's "next iteration should" items; five are done, one (real-device touch)
is still deferred.

- **A39 the fold's algorithm** — `shortestFit()` in `src/core/utils.js`: the declared order is
  flattened into one sacrifice sequence and the bar binary-searches the shortest prefix it
  needs, then walks back over any cut that was not needed. Whole-group cuts can now be undone,
  which the old take-back pass could not do, and the number of layout reads no longer grows
  with the length of the list. Measured against v13 at 720/660/620/560px: the same pictures. It
  is a guarantee and a cost, not a redesign — and `tests/fit.test.mjs` is the first place that
  guarantee is testable without a browser.
- **B24 `cd -` and `$OLDPWD`** — previous-directory tracking in the terminal's `cd`, toggling,
  refusal when there is none or it has been deleted, expansion and Tab completion for
  `$OLDPWD`, `man cd` and `help` updated. A41 fell out of it: an expansion list must return
  the original text for a name with no value, not `undefined`.
- **A40/E17 Files' Upload button** — collapsible like every other control in that bar
  (`files@360`: 444px → 413px of content, two items in the ⋯ → still two at 360px but one at
  380px), and re-glyphed from `⬆` to `📤` after looking at a screenshot where two identical
  arrows meant two different things.
- **F8/F9 the tests** — `setWidths()` settles by polling the bar's own signature instead of
  waiting 300ms per width; both sweeps assert the prefix invariant and the *right* minimality
  question via a shared `lastCut()` helper. Writing that assertion is what found A42: the Paint
  "partial fold" screenshot had been showing no fold.
- Tooling: `tests/probe-fit.mjs` (one app, every cut level, at the widths you ask for) and
  `node tests/measure-toolbars.mjs [widths…]`. Both are documented in the README and were used
  to write the numbers in this file.

All 119 tests pass (79 browser + 40 unit). `shots/` regenerated; `shots/24` moved to the width
where the claim in its caption is true.

---

## What I did in this iteration (v13)

Carried v12's list forward: both of its "next iteration should" feature items are done, and
E14 was closed by deciding against it rather than by doing it.

- **A34/A35 the graduated fold** — `watchToolbarOverflow()` grew `data-collapse-units` and
  `data-collapse-units-from="end"` in `src/core/utils.js`: a group declares which of its
  children it is willing to give up one at a time, and `fit()` hides them in the declared
  order before the group itself goes, then runs a **take-back pass** so nothing stays hidden
  that the bar no longer needed hidden. Files' breadcrumb and Paint's palette are the two
  users; `styles/os.css` lost `.crumbs.is-collapsed` and `.paint-palette.is-collapsed` and
  gained per-unit `.is-collapsed` rules. Measured: Paint at 720px keeps 5 of 8 swatches, at
  660px three, at 620px two — where before every one of those widths had none. Files at 760px
  reads `~ / … / notes / deep`.
- **B23/A36 shell variables** — `tokenize()` now returns `{text, quoted}` per word, which is
  the piece the whole shell was missing: `expandWord()` expands `$HOME`/`$PWD`/`~` only in
  unquoted text, and `splitRedirect()` runs its target through the same path, which is what
  fixed the quote-characters-in-the-filename bug. Tab completes `$HO` → `$HOME`; `help` and
  the README describe the rules. Unknown names are left alone on purpose.
- **A37, A38, E16, found by looking at the new captures** — an empty folder's message laid
  out inside one grid column; a context menu left floating after its window closed; an
  ellipsis with half the padding of the crumbs either side of it. All three were invisible to
  the measurement harness and visible in `shots/23`.
- **E14 closed by rejection**: end padding on a scrolling toolbar moves the content, not the
  sticky button, so it does not stop a control travelling under it — and it would shift every
  width the toolbar tests measure. Recorded rather than implemented.
- New tests: 4 browser (a Files *width sweep* that asserts the fold's shape rather than one
  trail — the ends always survive, the `…` appears exactly when something was folded, and
  putting the last folded segment back must overflow; the same three invariants for Paint's
  palette plus "some width must fold partially"; terminal variables and quoting; the empty
  state spanning the grid; a menu not outliving its window). `tests/screenshot.mjs` now closes
  the menu it opens in shot 05 instead of leaking it into every later capture.

All 112 tests pass (78 browser + 34 unit). New shots `23-files-partial-fold.png` and
`24-paint-palette-fold.png`.

---

## What I did in this iteration (v12)

Carried all four of v11's open items and finished them.

- **A27 the breadcrumb at the default width** — `~`-relative crumbs, foldable middle
  segments that carry their own separator, an explicit `/ …` when one was folded, and a
  reversed `data-collapse` order so labels give way before the trail. `measure-toolbars.mjs`
  went from `files@840 collapsed=1 hidden: root` to `collapsed=- ⋯=- → all reachable`.
- **A28 the combined-grammar test**, and while writing it two real bugs in the shell: A29 (a
  stage that threw cancelled the rest of its pipeline, contradicting the bash semantics the
  code documents) and A30 (`&> file` truncated the output it had just written).
- **`2>&1` and `&>` / `&>>`** in `splitRedirect()` and `print()`: `mergeErrInto` makes the
  error stream part of the output stream wherever the output goes — a pipe, a `>` file, both.
  `help` documents it, including the one place this shell is deliberately simpler than bash.
- **A31 the ⋯ menu names the side** — `offscreenControls()` returns `{control, side}` and the
  menu items say `off the left ←` / `→ off the right`.
- **A32 the lazy capacity probe** in `#classifyWrite()`, so the first storage failure of a
  session is diagnosed as well as a later one.
- **A33, found by looking at `shots/19`**: a menu glyph column that wrapped `📁＋`.
- New tests: 3 browser (breadcrumb at the default width and folded at 700px; the ⋯ side hints
  at both scroll positions; the two terminal grammar tests) and one unit (classification with
  and without a prior probe). One existing overflow-menu test had to stop hard-coding "New
  folder": which action is off the edge now depends on how far the bar had to compact, so it
  picks whichever create action the bar is actually hiding.

All 108 tests pass (74 browser + 34 unit). New shots `21-files-default-width.png` and
`22-files-folded-crumb.png`; `shots/` regenerated for this copy.

---

## What I did in this iteration (v10)

Carried v09's "next iteration should" list forward and finished four of its five items.

- **E12 one definition of a control** — `INTERACTIVE_SELECTOR` / `isUsableControl()` /
  `reachableControls()` in `src/core/utils.js`; the focus ring and the accessibility audit
  both use it, `tests/contracts.test.mjs` forbids either from growing its own copy, and a
  browser test walks Paint's whole Tab ring and checks it against the audit's list.
- **B18 tiling made discoverable** — `ZONES` + `zoneLabel()` exported from `geometry.js`
  (with new `top`/`bottom` half zones), a labelled snap preview during the drag, and a
  right-click **window menu** that lists the same zones (the taskbar button's menu already
  routed to it, so it gained the tiling list for free). A unit test asserts the menu and
  the geometry describe exactly the same zones; a browser test tiles a window into a quarter
  through the menu and reads the label mid-drag.
- **B19 terminal `<` and honest `&&`** — `splitRedirect` handles `<`/`>`/`>>` quote-aware,
  every stage tracks whether it printed an error, `grep` with no match and `cat` of a
  missing file fail, `cat` reads stdin, and `&&` stops at the first failure. Browser-tested
  including the quoted-`<` case and the chain that must not run.
- **A16 re-probe after a quota refusal** — a quota-shaped write failure throws the cached
  ceiling away (rate limited to one re-probe per 30s); a non-quota failure does not. Unit-
  tested by filling the quota from outside the namespace, which is the case the cached
  number could not see.
- **Found by looking at a screen that had never been screenshotted**: A21 (five desktop
  icons off a 420px screen — the icon grid now wraps), A20 (a disabled context-menu row was
  indistinguishable from an enabled one; destructive rows now read as destructive) and the
  phone-width taskbar rules. New shots `16-narrow-desktop.png`, `17-window-menu.png`,
  `18-snap-preview.png`.
- **A24, from the same shot**: Files' counts pluralised unconditionally ("0 folders, 1
  files", "1 items"). Now correct, browser-tested.
- New: `tests/contracts.test.mjs` (source-level contracts), added to `npm test` and
  `npm run test:unit`.

All 96 tests pass (63 browser + 33 unit).

---

## What I did in this iteration (v06)

B12 (pinch-zoom anchored at the pinch midpoint, browser-tested with a detail kept under
the fingers), B13 (long-press window menu on taskbar buttons, with native-contextmenu
dedupe, browser-tested), B14 (`MAX_IMPORT_BYTES` pre-flight refusal in `importFiles()`,
Upload button states the limit, browser-tested), Files menu gained “Cut to clipboard”,
F5 closed (`.dropping` affordance, multi-file upload + 5 MB refusal, cut-mode paste via
the Files menu, pinch clamping at 10%/800%), plus two real bugs found while chasing test
flakes: A11 (resize handles clipped by `overflow:hidden` + border-radius — moved inside
the window edges) and A12 (taskbar overflow fades stale after structural changes —
`watchToolbarOverflow().refresh()` now called from `#taskbarSync()`), and F6 (viewport
reset in `finally`, `closeAll()` at the start of fixture-dependent tests, deterministic
resize grab). All 66 tests pass (43 browser + 23 unit), verified across three
consecutive browser-suite runs; new evidence shot `10-drop-affordance.png`.

---

## What I did in this iteration (v07)

B15 (cumulative `MAX_IMPORT_BATCH_BYTES` per import batch, refusal naming the remaining
budget, Upload title states both limits, browser-tested), D3 (Paint undo switched from
PNG data URLs to `ImageData` snapshots under a 48 MiB byte budget, with scaled restore
across window resizes; browser-tested including the scaled path and undo-to-blank), and
E8 (visible diagonal resize grips at all four corners, revealed on window hover and
strengthened on handle hover; browser-tested via computed pseudo-element styles,
evidence shot `11-resize-grip.png`). Also removed a duplicated viewport reset in
`screenshot.mjs` and added a `dragleave` so the drop-affordance state cannot leak into
later shots. All 69 tests pass (46 browser + 23 unit).

---

## What I did in this iteration (v08)

Carried the unfinished work from v07 forward and finished three of its four items.

- **B16 Paint redo** — `redoStack`, `restoreSnapshot()`, `syncHistory()` honest button
  states, `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` scoped to the focused window, new-stroke branch
  invalidation, and a toast when there is nothing to redo. While there: `aria-pressed` on
  the tool buttons and an `aria-label` on the brush-size slider, and `setTool('pen')` at
  mount so the toolbar shows the tool the status bar claims is active.
- **B17 measured storage headroom** — `Store.capacity()`/`headroom()` probe the real
  `localStorage` quota once (≈18 ms in headless Chromium, ≈3.9 MB there),
  `importLimits(store)` derives the budgets from it with a 64 KiB reserve, and Files,
  the desktop drop handler, `df` and the Settings storage card all use it. Shell now
  receives `store` in its context so the drop path can measure too.
- **E9/A15 accessibility audit** — `tests/a11y.mjs` (`auditControls`,
  `assertNoUnnamedControls`, `assertWindowsAreLabelled`) run over the shell, the Start
  menu, a context menu, a real confirm dialog and all nine app windows. It found three
  unnamed icon-only buttons and one unnamed range input, all fixed.
- **E11 top-edge move strip** — `#startMove()` extracted from the title-bar drag and
  shared with a `.rz-move` strip in the middle of the north edge; corners still resize.
- **A13/A14 found while checking the above visually**: no `:disabled` styling existed
  anywhere in the stylesheet, and only Files and Web toolbars admitted being clipped.
  Both are fixed centrally (a shared disabled rule; the WM owns every window's toolbar
  fades) and both are browser-tested.
- Test harness: `resetStorage()` gives quota-sensitive tests a known storage instead of
  whatever the previous test left behind; `tests/storage.test.mjs` added to `test:unit`.

All 79 tests pass (52 browser + 27 unit). New evidence shots `12-move-strip.png` and
`13-paint-history.png`; `shots/` regenerated for this copy (a stale, unreferenced
`live.png` left over from the original project copy was removed).

---

## What I did in this iteration (v09)

Carried v08's unfinished list forward and closed four of its five items.

- **B20 toolbar collapse** — `watchToolbarOverflow()` gained an app-declared collapse order
  (`toolbar[data-collapse]`) and compacts groups, in the app's own priority, only when the
  bar genuinely cannot fit. Paint and Files declare one; both got glyph/label span pairs,
  Files also got a narrow icon-only sidebar. Every app now declares a `minWidth` its toolbar
  really fits at, and a test proves it at both the default and the minimum width.
  `tests/measure-toolbars.mjs` is the dev tool behind the numbers.
- **B19 terminal pipes and general redirects** — `splitPipe`/`splitRedirect`, a `sink` in
  `print()` that captures a stage's output (errors bypass it: a diagnostic is not data), six
  stdin filters, tab completion after `|`, and `>`/`>>` for any command instead of `echo`
  parsing `>` out of its own arguments.
- **E10 focus ring** — Tab wraps inside the window you are working in; boundary-only, so the
  browser's own order is untouched in the middle and `defaultPrevented` is respected.
- **F6 a11y self-test** — the audit is now proven to find what it claims to find.
- **A17/A18/A19 found while looking at the screenshots**: a `.seg` that clipped its own
  labels while its toolbar “fit”, a placeholder cut to “Filter r”, and a collapse watcher
  that could not see content changes. All three fixed, the last one browser-tested.

All 84 tests pass (57 browser + 27 unit). New shots `14-paint-compact.png` and
`15-files-compact.png`; `shots/` regenerated for this copy.

---

## What I did in this iteration (v11)

Carried all five of v10's "next iteration should" items and finished them.

- **A22 the ⋯ overflow menu** — `watchToolbarOverflow()` grew `ensureMore()`,
  `offscreenControls()`, `openOverflow()` and `controlName()`. A sticky ⋯ appears only while
  something is genuinely out of reach; its menu is the OS context menu (same keyboard
  handling, same accessible names), listing exactly the controls the bar cannot show, and
  choosing one scrolls it into view and activates it. `fit()` measures with the button hidden
  every time, so the button's own width cannot change what the collapse decided. Files'
  `minWidth` 580 → 360 and Paint's stayed 420: both are now honest because reachability no
  longer depends on the bar fitting.
- **A23 the desktop grid scrolls** — `#desktop-icons` is a scroll container;
  `WM#iconBottom()` reserves space only for icons inside the viewport.
- **B19 `;`, `||`, `2>`/`2>>`, Ctrl+R** — `run()` is now `;` groups → `&&`/`||` chains →
  `|` stages → redirects with bash's pipeline semantics (the last stage decides), a thrown
  diagnostic still counts as a failure and still reaches its `2>` file (A26), and reverse
  history search behaves like the one in a real shell.
- **B21/B22 Undo move + window menu parity** — `moveHistory` per window with 1s burst
  coalescing, `undoMove()` clamped to the viewport, "Undo move" offered only when there is
  something to undo, and a test that the title-bar and taskbar menus are the same list.
- **C6 the storage error taxonomy** — `Store.#classifyWrite()` → `lastErrorKind`, with a
  different sentence per kind in `main.js`, `df` and the Settings storage card.
- **E13/E14/E15 found by looking at the new screenshots** — a menu hanging outside its
  window, the ⋯ overlapping the control scrolled under it, and a menu that named actions by
  their tooltip.
- **A25 `grep -n`** — found in `shots/20-terminal-rsearch.png`, not in a test.

All 104 tests pass (70 browser + 34 unit). New shots `19-toolbar-overflow.png` and
`20-terminal-rsearch.png`; `shots/` regenerated for this copy; `tests/measure-toolbars.mjs`
now reports whether the ⋯ covers what is out of reach.

---

## What I did in this iteration (v24)

Carried v23's list (its A67–A70 and the rest of B25) and closed four of the five terminal
items, including the one v23 named as the next one after variables.

- **B25 `$(…)` command substitution** — the largest item here, and the one that touched the
  shell's structure. `run()` became `run()` (history, echo, status) + `execute()` (the body),
  so a line can be run *inside* another line. `captureLine()` runs `execute()` with the
  output redirected into a buffer and returns it as text; `substitute()` scans a word for
  `$(` and matches the closing paren. Three details are the whole feature and each one is a
  test:
  - `tokenize()` now treats an open `$(` as part of the word it starts in, spaces included —
    tokenizing first turned `echo $(echo hi)` into `$(echo` and `hi)`.
  - `splitOn` / `splitChain` / `splitRedirect` all track `$(`-depth, so `;`, `|`, `&&` and `>`
    inside a substitution belong to the inner command.
  - `execute()` gives the *last* stage a buffer when `capturing` is non-zero (`captureSink`),
    because a substitution has no screen. Without that, `echo $(pwd)` printed the path and
    substituted nothing — which is the kind of bug that passes a test that only checks the
    printed half.
  Unquoted results are word-split (`wc -l $(echo a.txt b.txt)` counts two files); quoting stops
  it, exactly as quoting stops `$NAME`; the inner command's errors go to the screen rather than
  into the value, so `$(cat missing)` is empty *and* says why; nesting is capped at six.
  Added `true`/`false` while doing it: `&&`/`||` had no way to succeed or fail on purpose, and
  `$(false)` is the clearest demonstration that a failed substitution is empty rather than
  missing. New `TOPICS.substitution`, `help` updated (and it no longer lists substitution as
  unsupported), and `man` with no argument now prints an index instead of "no manual entry for
  undefined" — the only place the three topics are listed together.
- **A69 `grep` prefixes matches with the filename** — `grep x a.txt b.txt` and `grep x *.txt`
  print `a.txt:…`; `-n` numbers per file (`a.txt:2: …`); one file, or piped stdin, gets no
  prefix. The source is now a list of `{line, file, no}` records instead of a list of strings,
  which is what made the prefix possible without special-casing the multi-file case.
- **A70 a glob in a redirect target says so.** `echo x > *.out` still writes a file called
  `*.out` — a redirect target is a name, and that is what real shells do — but the shell now
  adds a dim note naming the file it just made, for both `>` and `2>`. Refusing outright was
  considered and rejected: the refusal would be a guess about what the user meant, and the note
  is the honest version of the same information.
- **A68 decided, not changed.** Commands echo paths in the form you typed them (that is what
  real `wc` does, and it is the form you can click on or retype); errors show the resolved
  absolute path, because the point of an error is to tell you which file it means. Documented
  in `project-description.md` so a third command copies the decision rather than one of the two
  behaviours.
- **`mv`/`cp` take several sources into a directory**, `cd` refuses more than one directory, and
  a shared `VALUE_FLAGS` list that made `sort -n file.txt` read *no file* is gone: `fileArgs()`
  now takes the value flags per command (`head`/`tail` pass `-n`, `sort`/`wc`/`ls`/`mkdir` pass
  none). A contracts test parses every command block in `terminal.js` and asserts that each
  `numFlag(args, '-x')` has a matching `fileArgs(args, ['-x'])` and the reverse, so the two
  halves of an argument parser cannot drift apart again.

**A real bug found while writing the tests, not before:** `VALUE_FLAGS = {'-n'}` was global, so
`sort -n notes.md` consumed `notes.md` as `-n`'s value and printed nothing. The test for it is
in the multi-file test, because the two are the same mistake about what a flag is.

All 222 tests pass (133 browser + 89 unit; was 219). New shots `12-terminal-substitution.png`
and `12-terminal-substitution-clean.png`, captured by `tests/capture-substitution.mjs` — a
single-screen capture, because regenerating all eleven shots to judge one text-output change is
the most expensive thing in the pass.

### Visual improvements (v24, from `shots/12-terminal-substitution.png`)

Judged the one screen this iteration changes. What the capture shows:

- No clipping, no overflow, no overlap. `wc -l $(echo a.txt b.txt)`, `echo written >
  $(echo target.txt)`, and the `note:` line all render on one line each at the default 640×470
  terminal width. The longest line in the capture is the note itself (~70 columns) and it fits.
- The `note:` line is the weakest ink in the terminal palette (`dim`, the same level used by
  `grep`'s "no lines match" and `man`'s usage lines). It reads, and it is deliberately not an
  error — but it is the message that tells you the file you just made has a `*` in its name,
  which is the kind of thing a later `ls` would otherwise look like a bug. Worth trying the
  `ok`/green level or a slightly stronger ink for notes specifically; deferred, because "which
  messages deserve the second-strongest level" is a decision about the whole terminal, not about
  this one line.
- The capture also shows the terminal's own scroll behaviour: the first command has scrolled
  partly off the top. Same note as v23 — a terminal behaving like a terminal, not a defect, and
  the reason demo commands are kept short.
- `no lines match "shared" (2 looked at)` appears where the demo had no matching line: the
  count of files looked at is what makes that message useful, and it was already there.

### Still open, ranked (v24)

- **A67. The modal exemption is broad.** Unchanged, and still wanting its own failing test
  first. Re-checked this pass: the audit's dialog test (`minRuns: 4`) is the one that would
  move if `covers()` became geometric, and I could not construct a case in the current DOM where
  the *wrong* exemption actually bites. That makes it a speculative fix to a delicate measurement
  — do it with the failing test in hand, not before it.
- **E27. `sampleCanvas` samples the element, not the visible viewport.** Unchanged from v21.
- **B25 (remaining): aliases, `sed`/`tr`, job control.** Substitution is done; aliases are next
  (they need to be expanded before `tokenize` decides what a word is, which is a different
  place in the pipeline from variables), then `sed`/`tr` (both are stdin filters, which the
  pipeline already supports), then job control (`&`), which is the one that would need a real
  async command model.
- **`$(…)` limits, stated rather than hidden:** backticks are not supported; a quoted `)` inside
  `$( )` closes the substitution early because quotes are gone by the time the paren matching
  runs; an inner command's errors do not reach an outer `2>` file (they go to the screen); and
  a substitution runs in the *same* shell, so `$(cd /tmp)` changes your directory. All four are
  in `man substitution`.
- **B18 no tiling manager, `win.data.requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** — unchanged
  from v19, for the same reasons.

---

## What I did in this iteration (v25)

Carried v24's list: the rest of B25 (aliases, then `sed`/`tr`), E27 (the wallpaper sampler), the
terminal message levels it had deferred, and A67 (left alone, on purpose).

- **B25 aliases.** `alias name=<command line>`, bare `alias` lists, `alias name` shows one,
  `unalias name` removes one, Tab completes them, `man aliases` explains them. The interesting part
  is *where* they expand: in `execute()`, after the leading `NAME=value` words and before
  `expandArgs`. An alias stands for a command line, so it is the only expansion that has to happen
  while words are still words — expanding after variable/glob expansion would make `alias ll='ls -l'`
  a command called `ls -l`. Three consequences, each tested: only the command word is looked up (a
  quoted `"ll"`, an `a=ll` argument and `echo ll` are not aliases); the body is re-tokenized and
  re-expanded at the point of use, so `$VAR` in a body means what it means *that* time; and a
  recursive body expands once and stops, which is what makes `alias ls='ls -l'` usable instead of
  fatal. Session state, like variables: not persisted.
- **B25 `sed` and `tr`,** both `filter: true` so they read the pipe like `grep` and `head` do.
  `sed` does `s/find/replace/[gi]` (the delimiter is whatever follows the `s`, so `s|a/b|c|` needs no
  escaping; `&` in the replacement is the match, done by hand so a `$` stays a `$`) and `/find/d`;
  an expression it does not know names the two it does. `tr` does `[-d] <set1> [set2]` with ranges,
  a short set2 replicated the way real `tr` does it, and refuses a reversed range. `tr` has no file
  arguments and says so rather than reading `notes.txt` as `set2`.
- **The message levels, which v24 deferred, are now four and named.** `err` / `ok` / `note` / `dim`,
  documented in one comment in `terminal.js` and one rule in `os.css`. `note` is the level that was
  being spelled with `dim` in four places (a glob that did not expand, `mkdir` on an existing
  directory, `touch` on an existing file, `grep` with no match) — messages the shell produces whether
  you asked for them or not, which is not the same kind of thing as help text you asked for. It uses
  the terminal's *existing* middle ink (`--text-dim`) rather than inventing a fourth colour token;
  `dim` stays on `--text-faint`, so the two are visibly different levels and not one ink with two
  names. The contrast audit now measures a `note` line in both themes.
- **E27, and then the thing the test for it found.** `sampleCanvas` no longer samples a grid: it
  reads every pixel and keeps the darkest and lightest colour in each luminance band. The first
  version of that used evenly spaced bands and the new test caught it — `aurora`'s colours all sit in
  two of them, because a dark wallpaper's entire range fits inside the first band of a linear scale.
  Bands are now logarithmic (128 of them, eight to the octave), which makes the sampler's promise
  uniform: no colour is more than ~9% of luminance from a sample. `wallpaperInkFromRendered` caps the
  *canvas* at 640px on the long side (a gradient has the same colours at 640px as at 4K) while still
  reading every pixel of it; the `url()` path went 256px → 512px for the same reason.
- **A real bug found while writing the tests, not before:** `rawArgs` passed the command's *own*
  word to the command, so `export FOO=bar` answered `export: not a variable assignment: export`.
  It had been there since `export` was written and no test looked at that line. `rawArgs` is now the
  words after the command name.

**Tests.** 225 pass (136 browser + 89 unit; was 222). New: an alias test (definition, listing,
`unalias`, quoting, expansion at the point of use, recursion, Tab, session-only), a `sed`/`tr` test
(both forms, `g`/`i`, delimiters, `&`, ranges, `-d`, reversed ranges, no-file-arguments, `<`), a
sampler test that a 2-pixel band in a 1200×800 canvas is in the answer (a 32-point grid had a 37px
step and found only the field), and the wallpaper-preset test rewritten: it no longer asserts "at
least 100 sample points" — a grid can have a thousand points and still miss the colour that decides
the answer — it compares the sampler's *worst contrast* against a brute-force scan of the same
pixels, and asserts the sampler is not optimistic by more than a band. The contrast audit gained a
`note` line.

### Visual improvements (v25, from `shots/02-terminal-files.png`)

Judged the terminal screen the shell changes affect. What the capture shows:

- `alias ll='ls -l'` → green confirmation; `ll demo` → a real `ls -l` row; `cat … | sed
  's/the shell/an alias/' | tr a-z A-Z` → `CREATED BY AN ALIAS`; `mkdir demo` → `~/demo already
  exists` in the middle ink, visibly weaker than ordinary output and visibly stronger than help text.
  The four levels read as levels.
- No clipping or overlap at the default 640×470. The first capture of this shot had a `sed` error
  line running to the window edge — that was my own malformed expression (`s/x/y` with no closing
  delimiter), which is the same mistake real `sed` would have rejected.
- The terminal scrolls its own output off the top when a demo runs long (`neofetch` after six
  commands). Same note as v23/v24: a terminal behaving like a terminal. Worth one dedicated short
  demo screen if a later pass wants the shell's features visible at once rather than scrolling.
- The Files window in the same shot has a large empty lower half at 620×520 with five folders. Not
  this iteration's change and not broken, but it is the most obviously unfinished region of any shot
  in the set.

### Still open, ranked (v25)

- **A67. The modal exemption is broad.** Unchanged for a third pass, and still wanting its own
  failing test first. Nothing in the current DOM makes the wrong exemption bite.
- **B25 (remaining): job control (`&`).** The last shell gap, and the only one that needs a new
  execution model rather than another expansion: a backgrounded stage has to keep running while the
  prompt returns, which the synchronous `execute()` cannot do.
- **`$(…)` limits, stated rather than hidden:** no backticks; a quoted `)` inside `$( )` closes it
  early; an inner command's errors do not reach an outer `2>` file; a substitution runs in the same
  shell, so `$(cd /tmp)` moves you. All four are in `man substitution`.
- **`sed` is a subset.** No address ranges (`1,3s/x/y/`), no `n`/`d`/`p` commands, no multiple
  `-e` expressions, no in-place `-i`. Enough for the pipelines the shell can build today.
- **Aliases are not persisted and there is no startup file.** Deliberate for the same reason
  variables are not persisted, but it does mean `alias` is a per-window thing; a `~/.shellrc` would
  be the honest next step, and it needs a decision about whether the filesystem is allowed to change
  what a command means.
- **B18 no tiling manager, `win.data.requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** — unchanged
  from v19, for the same reasons.

---

## What I did in this iteration (v26)

Carried v25's list in full: its items 1–4 (give `help` a shape, decide `~/.shellrc`, test `sed`/`tr`
against their own manual, assert the plate against a brute-force scan). All four are done. A67 was
left alone again, on purpose, for the same reason: no test in the suite fails because of it.

### A70. An alias whose body was more than one command did not work — `[done]` (v26), M
Found by writing the startup file, not by reading the alias code. `alias docs='cd ~/Documents && ls'`
expanded to the *words* `cd`, `~/Documents`, `&&`, `ls` spliced into the token list at the command
position, so the chain splitter never saw them: `cd` got `&&` and `ls` as arguments. The alias test
passed because it only ever used `alias show=cat`.

`expandAliases(words)` is gone. `expandAliasText(line)` now walks the **raw line** before it is split
into commands: it tracks quotes and `$( )` depth, decides which words are in a *command position*
(start of the line, after `;`, `|`, `&&`, `||`, `(`, or after a leading `NAME=value`), and splices
the body's text in at that point, then lets the ordinary splitters do their job. A quoted `"ll"` is
still not an alias, `echo a=ll` is still not one, and a body is re-scanned with a cycle guard so
`alias ls='ls -l'` terminates. This is what a shell actually does, and it is the only way a body can
contain an operator. Covered by a new test that defines `alias go='cd ~/aliastest && pwd'` and runs it.

### A71. `sed` and `tr` accepted flags they do not implement — `[done]` (v26), S
Found by writing the test that asks each command to accept *exactly what its own `man` page says it
accepts*. `sed 's/a/b/x'` silently treated `x` as part of the replacement; `tr -x a-z` silently
treated `-x` as set1. Both now name what they refuse. The same test also caught that `tr` reads a `<`
redirect but not a file argument — which is the documented behaviour, so the test now asserts the
refusal against a file argument instead.

### A72. `help` wrapped at a width somebody guessed — `[done]` (v26), M
The new index wrapped descriptions at 80 columns because 80 is the width the *default* terminal shows.
The window's minimum is 340px — about 40 columns — and at that width a table wrapped for 80 is a
paragraph again, which is the exact thing wrapping was added to prevent. `termCols()` measures the
output area (the font is monospace, so one measured glyph is the answer) and `wrapDoc`/`wrapPreserving`
wrap to it, leaving one column of slack so the browser never wraps a line for us. `man` pages are
wrapped the same way, keeping their own indentation and their blank lines. `wrapDoc` moved out of
`help.run` to the terminal's mount scope so `man` can use it too. Tested at 700, 480 and 340px: no
line is wider than the window, and the hanging indent survives the narrow case.

### A73. `man` with no argument answered "no manual entry for undefined" — `[done]` (v26), S
It now prints an index generated from `Object.keys(TOPICS)`, and its `usage:` line is generated from
the same table. A list written next to a table is a list that drifts; there is now only one.

### B25 (continued). `~/.shellrc` and `source` — `[done]` (v26), M
The gap v25 named — "aliases are not persisted and there is no startup file" — closed with the file
rather than with persistence. `runScript(path, why)` runs a file one line at a time through the same
`execute()` a user types into: a line that fails is reported and the next line still runs; a file that
sources itself is refused (`sourcing[]`, depth 8); an absent file says nothing at startup and `source
missing.txt` refuses. At startup it runs after the banner and motd and reports what it defined. The
seed ships a commented `~/.shellrc` with `alias ll='ls -l'` and `alias docs='cd ~/Documents && ls'` —
visible in `ls`, in Files, and in `edit`, because a startup file you cannot see is the kind of thing
that makes a shell behave oddly for reasons nobody can find. `man startup` states the rules;
`SHELL_FEATURES` points at it.

### `help` is an index (B25 item 1) — `[done]` (v26), M
`COMMAND_GROUPS` (Files / Text / Shell / Apps & desktop / System) plus `UNGROUPED`, so a command added
to the table without being filed anywhere is printed under "Ungrouped (a command nobody filed)" and
*both* guards fail. `SHELL_FEATURES` gives one line per feature of the shell itself with a `man`
pointer; two new topics were written to make those pointers true (`pipes`, `startup`) and the existing
`aliases`/`variables` pages now mention the startup file. Nothing was deleted from the old `help` text
— it moved to `man`, where a description that has to stay true to a command belongs.

### Tests (F)
231 pass (141 browser + 90 unit; was 225). New: `help`-is-an-index (every group present, every
pointer resolves, nothing under "Ungrouped", nothing wider than the window); `~/.shellrc` (read at
startup, reported, its alias and its variable work, `source` on a file with a bad line in it,
`source` on a missing file, self-sourcing refused); `sed`/`tr` accept exactly their documented subset;
`help`/`man` wrapped at 700/480/340px; a plate chosen from sampled colours checked against a
brute-force scan of **every pixel** of the wallpaper it is painted onto, at the size it is actually
drawn (the sampler's own canvas is capped at 640px, so this is the wider claim). New unit contract in
`contracts.test.mjs`: every command is filed in exactly one group, every group entry is a command,
every `man` pointer resolves, and no `man` page exists that nothing in `help` points at. That contract
also broadened the existing command-table regex so one-line entries (`clear: { … }`) are no longer
invisible to it — it had been skipping them since it was written.

Two brittle assertions were replaced because they were facts about the seed, not about the app:
`files.test.mjs` hard-coded the home folder's listing and broke the moment the seed gained a file (it
now compares against what `fs.list` reports), and `terminal.test.mjs` hard-coded "80 columns" for the
help width (it now measures the window, with one shared `termColumns()` helper used by both terminal
tests).

### Visual improvements (v26, from `shots/41-terminal-help-commands.png`, `shots/42-terminal-help-features.png`)

Two new captures of the thing this iteration actually changed, taken by `npm run screenshots` (the
Files window is closed first: in the first capture it overlapped the terminal and the text looked
clipped when nothing was clipped).

- The grouped index reads as a table at 700px: group headings in the accent ink, command names in a
  fixed column, descriptions with a hanging indent, nothing running to the window edge.
- The feature index reads as a pointer list, not as more prose: one line per feature, each ending in
  `(man <topic>)`. When a line wraps, the pointer lands on the continuation line — legible, but the
  "(man" / "globs)" split is the weakest part of the layout. Reserving the pointer on its own line,
  or wrapping the description to `limit − pointer`, would read better. Noted, not done.
- At 340px (the window minimum) the table is still a table: both columns survive and continuations
  stay indented under the description column. It is cramped — about ten characters of description per
  line — and a narrow-width mode that dropped to `name: description` lines would read better.
- A `man` page at 340px re-wraps cleanly and keeps its indentation; the `startup` page reads as one
  long paragraph because its source lines are long. Splitting those topic entries into shorter
  paragraphs is a content fix, not a layout one.
- `shots/02-terminal-files.png` now shows the startup file working: the two seeded aliases and the
  line `~/.shellrc: ran 2 line(s) and defined 2 alias(es) — \`man startup\` explains` at the top of a
  fresh terminal. That is the feature visible in a screenshot rather than only in a test.
- The Files window's empty lower half in that same shot is unchanged and still the most obviously
  unfinished region in the set.

### Still open, ranked (v26)

1. **B25 (remaining): job control (`&`).** The last shell gap, and the only one that needs a new
   execution model rather than another expansion: `execute()` is synchronous and a backgrounded stage
   has to keep running while the prompt returns. `help` says "Not supported: background jobs." rather
   than pretending.
2. **The wrapped `man` pointer splits across lines** in the feature index (see Visual improvements).
   Small, and it is the one part of the new index that reads worse than it should.
3. **A narrow-terminal layout for `help`.** At 340px the two-column table is legible but ~10
   characters of description per line. A `name: description` mode below some column count is the
   honest fix.
4. **`sed` is a subset.** No address ranges, no `n`/`p`, no multiple `-e`, no `-i`. Now *stated* in
   `man sed` and enforced (an unknown flag is refused), which is the right shape for a subset; adding
   to it is a feature decision, not a bug.
5. **`$(…)` limits, stated rather than hidden:** no backticks; a quoted `)` inside `$( )` closes it
   early; an inner command's errors do not reach an outer `2>` file; a substitution runs in the same
   shell, so `$(cd /tmp)` moves you. All four are in `man substitution`.
6. **A67. The modal exemption is broad.** Unchanged for a fourth pass. Still wants its own failing
   test written first; nothing in the current DOM makes it bite.
7. **The Files window's empty lower half** at default size with five folders. Four iterations of
   screenshots have said so.
8. **B18 no tiling manager, `win.data.requested` in the WM, `EFFECTIVE_SCAN_LIMIT`** — unchanged from
   v19, for the same reasons.
