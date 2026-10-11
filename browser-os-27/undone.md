# Undone — version 27 (in progress)

## Carried in from v26

v26 finished all four of v25's items. Its "next iteration should" list is my plan:

1. Fix the split `man` pointer in the feature index (wrap description to `limit − pointer.length`).
2. Narrow-width layout for `help` (drop to `name: description` below ~50 columns) + assert at 340px.
3. Re-paragraph `TOPICS` pages (`man startup`, `man pipes`) so wrapped pages keep paragraph breaks.
4. Decide `echo 2>&1` / `>&` as an operator, or state in `man pipes` that it is not one.
5. Fill or shrink the Files window's default layout.
6. A67 only with a failing test written first.
7. Make `contrast.test.mjs`'s "every app reads" deterministic for the Web app (wait for iframe text).

## Deferred / known from earlier passes

- A67 modal-contrast exemption (needs a failing test first).
- B25 job control (`&`).
- `sed`/`tr` subset extension (feature decision).
- Browser suite cost (~110s) — worth making fixed-cost someday.

## To do this pass

Items 1, 2, 3, 4, 7 from the list above (all shell/help-related, low risk, testable), plus
whatever the code says is worth doing. Item 5 (Files layout) is a layout decision — attempt only
if time allows.
