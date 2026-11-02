# experiments.galedra.org

Collected by [Brandon Hoult](https://hoult.co).

The files behind https://experiments.galedra.org: things built to see what happens, kept as
they were when copied there. Nothing here is maintained.

## What's here

| Path | What |
|---|---|
| `index.html`, `browser-os-01.jpg`, `browser-os-27.jpg` | The index page and its thumbnails |
| `browser-os-01/` | Browser OS after its first pass (45 minutes) |
| `browser-os-27/` | Browser OS after 26 passes (over 30 hours), copied about 15 minutes into the 27th |
| `skills/turd-polish/` | The skill that ran the passes (not part of the site) |

**Browser OS** is a desktop that runs in a browser tab: windows, a shell, a virtual filesystem
and nine small apps, in plain ES modules with no build step. The [pi](https://pi.dev/) coding
agent built it and then kept improving it in unattended passes, running Qwen3.8-Flash-Next
locally through Strata. Each pass read the previous one's notes, chose what to fix next, and
left notes for the next. Each folder's `README.md`, `project-description.md` and
`proposed-improvements.md` are that pass's own account.

**Two changes from the copies as the agent left them**, both made for hosting:

- each copy's `src/core/store.js` saves under its own browser-storage namespace
  (`browseros-01`, `browseros-27`) instead of the shared `browseros`, because both are served
  from one origin and would otherwise load each other's saved desktop;
- `node_modules/` (Playwright, for the tests only) is left out. `npm install` in a folder
  brings it back to run that folder's tests.

The `shots/` folders are kept although each project's own `.gitignore` excludes them: they are
on the site.

## The turd-polish skill

`skills/turd-polish/` is what produced Browser OS's versions: a [pi](https://pi.dev/) skill that
copies a project to numbered versions (`name-01`, `name-02`, ...) and runs one full
improvement pass inside each, until stopped.

- `scripts/polish-loop.mjs` is the loop. It is plain Node, not the model, so it carries on
  whatever a pass decides. Each pass is a fresh `pi --mode json` run with an empty context,
  in its own copy; continuity is on disk only, through `undone.md`,
  `project-description.md` and `proposed-improvements.md`.
- `references/iteration.md` is the procedure every pass is given as a system prompt addition:
  inherit the last pass's notes, describe the project, propose improvements, screenshot and
  critique it when it is visual, implement the best few, test them, and hand off.
- `SKILL.md` is how an agent starts it, watches it and stops it (`touch <name>-polish/STOP`).

To use it, put the folder where your agent finds skills (for pi, `.agents/skills/turd-polish`
in a project) and ask it to turd-polish something, or start the loop yourself:

```
node .agents/skills/turd-polish/scripts/polish-loop.mjs <file-or-folder> --thinking medium
```

The Browser OS run used `--thinking medium --delay 5`. The loop symlinks the original
project's `node_modules` into each version so its tests run; those links are not in this
repository.

## Running one locally

ES modules need an HTTP origin:

```
cd browser-os-27 && python3 -m http.server 8080
```

## Publishing

The site is these files, served as they are. The server copy is updated with rsync, leaving out
this README, the `.gitignore`, `.git` and `skills/`. Adding an experiment means copying its folder in
without `node_modules`, adding a card for it to `index.html` with a 960x600 thumbnail, and
copying both up.
