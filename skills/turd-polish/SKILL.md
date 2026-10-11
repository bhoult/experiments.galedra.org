---
name: turd-polish
description: Polish a file or folder forever by copying it to numbered versions (name-01, name-02, ...) and running one full improvement pass inside each version. Use when asked to turd-polish, polish continuously, iterate on a project until stopped, or improve code indefinitely.
---

# turd-polish

Turn any file or folder into an endless improvement pipeline. Each iteration copies the
previous version to `<name>-NN`, works only inside that copy, and never touches the
original or earlier versions.

The loop is driven by `scripts/polish-loop.mjs`, not by the model. It spawns a fresh,
empty-context `pi --mode json` run per iteration and keeps going until you stop it.
**Do not do the polishing yourself in this turn — start the loop and report how to watch and
stop it.**

## Start it

```bash
SKILL=.agents/skills/turd-polish
nohup node "$SKILL/scripts/polish-loop.mjs" browser-os > polish.log 2>&1 &
```

Use `nohup ... &` so the loop outlives the agent turn. Then tell the user where the log
is and how to stop it.

## Options

| Flag | Meaning |
|---|---|
| `--max N` | stop after N iterations (default: unlimited) |
| `--restart` | start again at `-01` from the original target instead of resuming |
| `--delay S` | seconds between iterations (default 3) |
| `--timeout MIN` | optional kill after MIN minutes (default: no time box) |
| `--stall MIN` | optional kill after MIN minutes with no output (default: off) |
| `--versions-dir DIR` | where versions go (default `<target>/../<name>-polish`) |
| `--prefix NAME` | version prefix (default: target name) |
| `--model PATTERN` / `--thinking LEVEL` | passed through to each `pi` run |
| `--extra TEXT` | extra instructions appended to every iteration prompt |
| `--exclude PATTERN` | extra rsync excludes |
| `--dry-run` | copy versions only, no model runs (structure check) |

## Watch and stop

```bash
tail -f polish.log                    # live progress
tail -f <name>-polish/logs/<name>-07.log   # that iteration's JSONL event stream
cat <name>-polish/HISTORY.md          # one row per iteration
touch <name>-polish/STOP              # stop after the current iteration finishes
```

The loop also stops on `SIGINT`, or when `--max` is reached. A failed iteration is logged
and the loop continues.

## Restarting

Each iteration runs in a **fresh `pi` session with an empty context** — nothing carries over
in the conversation. Continuity is on disk only: the copied code plus
`project-description.md`, `proposed-improvements.md` and `undone.md`.

If the driver dies or you start it again, it scans the versions directory and continues
from the highest existing version (`--restart` forces a fresh `-01`).

## What one iteration does

See `references/iteration.md`; that file is injected into every child run as a system
prompt addition. In short: review the previous version's `undone.md`, refresh
`project-description.md`, write `proposed-improvements.md`, capture and critique screenshots
when the project is visual, implement the highest-value items, run and extend the automated
tests, then write `undone.md` for the next iteration.

## Notes

- `node_modules` is excluded from copies and symlinked into each version so tests still run.
- Each iteration writes its own `undone.md`; the next iteration is told to read it first.
  It is written as a stub at the very start of an iteration, so an interrupted run still hands off.
- Child runs are grouped under `<versions-dir>/sessions` so you can inspect any iteration.
- Child runs use `--mode json`, so each log is a live JSONL event stream. Count what an
  iteration has actually done with:
  `grep -c tool_execution_start <name>-polish/logs/<name>-07.log`
