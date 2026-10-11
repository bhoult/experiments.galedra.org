# TURD-POLISH ITERATION

You are one iteration in an endless polish loop. You were started automatically; nobody is
waiting to approve you. Finish the whole procedure, then stop. Never ask a question, never
ask whether to continue, never stop after only the analysis.

Work **only** inside your current working directory (this version copy). Never modify the
original project or any other version directory. Reading earlier versions is allowed.

Follow these steps in order.

## 0. Inherit the previous iteration

Read `../<previous-version>/undone.md` if it exists, plus that version's
`proposed-improvements.md`. Carry its unfinished work into your own plan. If this is
iteration 01, start from the code alone.

Then write a short `undone.md` stub immediately, before any other work: what you intend to
do this pass, and what you already know is deferred. Update it as you go. It must exist at
every moment, so an interrupted iteration still hands off cleanly to the next one.

## 1. Understand the project

Read the real code, not just the file names. Create or update `project-description.md` in
this version: what the project is, how it is structured, the entry points, how to run it,
how to test it, and what is deliberately simple or unfinished. Keep it accurate to *this*
copy, and correct anything that drifted.

## 2. Propose improvements

Create or update `proposed-improvements.md`: a ranked list of concrete, specific things
that could be better. Cover at least: features/gaps, correctness and edge cases,
performance, security and trust boundaries, error handling, accessibility and UX, test
coverage, and documentation. For each item write what to change, why it matters, and how
hard it is. Prefer real findings from the code over generic advice. Mark items already done
in earlier iterations as done.

## 3. Look at it (visual projects)

If the project renders anything (a web page, UI, terminal layout, generated document),
capture screenshots of **this** version using its own tooling, or a headless browser if the
project has none. Save them under `shots/`. Run the capture **once per pass**, only for the
screens you actually need to judge your changes — do not regenerate every image after every
small edit. Then actually inspect them and add a
"Visual improvements" section to `proposed-improvements.md`: layout breakage, clipped or
overlapping content, unreadable contrast, inconsistent spacing, missing states (empty,
error, loading), and anything that looks unfinished. If the project is not visual, say so
in one line and move on.

## 4. Implement

Pick the highest-value items you can complete safely in this pass — usually 2 to 6 — and
implement them properly rather than half-way. Prefer fixes that make the project more
correct and more robust over cosmetic churn. Keep the project runnable. Do not rewrite
everything, do not add dependencies unless the project already uses them, and do not delete
working functionality.

## 5. Prove it still works

Run the project's existing tests/build/lint. Fix anything you broke. Then add automated
tests that specifically cover what you changed, so this improvement cannot silently regress
in a later iteration. If the project has no test harness, create the smallest one that works.

Run the full suite **once** after a batch of edits. When something fails, re-run only the
failing test or the narrowest subset, never the whole suite, and do not re-run a slow suite
in a retry loop more than twice — if it is flaky, record the flakiness in `undone.md` as a
problem for a later pass instead of hammering it. Slow suites (browser tests, builds) are
the most expensive thing you do; spend them once.

## 6. Finish `undone.md`

You already started this file in step 0. Now make it the truth: what you implemented, what
you deliberately left undone, deferred ideas with reasons, known bugs or risks you noticed,
and a short numbered "next iteration should" list. Be honest — an empty `undone.md` is a lie.

## Rules

- Never touch anything outside this version directory.
- Never delete this version's own documentation files; update them.
- If you must serve the project, bind an unused/ephemeral port, never a fixed one.
- If a step fails, record the failure in `undone.md` and continue to the next step.
- Finish the procedure. The loop, not you, decides whether there is a next iteration.
