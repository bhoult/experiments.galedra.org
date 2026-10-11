#!/usr/bin/env node
/**
 * turd-polish loop driver.
 *
 * Copies a project (or single file) to numbered versions and runs one full improvement
 * pass inside each version, forever. The loop lives here, in plain Node, so continuation
 * never depends on a model deciding to keep going.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITERATION_DOC = path.join(SKILL_DIR, 'references', 'iteration.md');

const USAGE = `turd-polish — polish a file or folder forever, one numbered version at a time.

usage: node scripts/polish-loop.mjs <file-or-folder> [options]

  --versions-dir DIR   where versions go          (default: <target-parent>/<name>-polish)
  --prefix NAME        version prefix             (default: target name)
  --max N              stop after N iterations    (default: unlimited)
  --restart            start at -01 from the original target instead of resuming
  --delay S            seconds between iterations (default: 3)
  --timeout MIN        optional: kill an iteration after MIN minutes (default: no limit)
  --stall MIN          optional: kill an iteration with no output for MIN minutes (default: no limit)
  --model PATTERN      passed to each pi run
  --thinking LEVEL     passed to each pi run
  --extra TEXT         extra instructions appended to every iteration prompt
  --exclude PATTERN    extra rsync exclude (repeatable)
  --keep-skills        let child runs discover skills (default: --no-skills, to avoid recursion)
  --lean               also pass --no-mcp --no-extensions to child runs
  --dry-run            copy versions, do not run the model
  -h, --help           this text

stop the loop:  touch <versions-dir>/STOP`;

const DEFAULT_EXCLUDES = ['node_modules', '.git', '.venv', '__pycache__', '*.log'];

function parseArgs(argv) {
  const o = {
    target: null, versionsDir: null, prefix: null, max: Infinity, delay: 3, timeout: 0, stall: 0,
    model: null, thinking: null, extra: '', excludes: [...DEFAULT_EXCLUDES],
    noSkills: true, lean: false, dryRun: false, restart: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--max') o.max = Number(val());
    else if (a === '--delay') o.delay = Number(val());
    else if (a === '--timeout') o.timeout = Number(val());
    else if (a === '--stall') o.stall = Number(val());
    else if (a === '--model') o.model = val();
    else if (a === '--thinking') o.thinking = val();
    else if (a === '--extra') o.extra = val();
    else if (a === '--exclude') o.excludes.push(val());
    else if (a === '--versions-dir') o.versionsDir = path.resolve(val());
    else if (a === '--prefix') o.prefix = val();
    else if (a === '--restart') o.restart = true;
    else if (a === '--keep-skills') o.noSkills = false;
    else if (a === '--lean') o.lean = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else rest.push(a);
  }
  if (!rest.length) { console.error(USAGE); process.exit(2); }
  o.target = path.resolve(rest[0]);
  if (!fs.existsSync(o.target)) { console.error(`no such path: ${o.target}`); process.exit(2); }
  const stat = fs.statSync(o.target);
  o.isFile = stat.isFile();
  const base = path.basename(o.target);
  o.prefix = o.prefix || (o.isFile ? base.replace(/\.[^.]+$/, '') : base);
  o.versionsDir = o.versionsDir || path.join(path.dirname(o.target), `${o.prefix}-polish`);
  return o;
}

const versionName = (prefix, n) => `${prefix}-${String(n).padStart(2, '0')}`;

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Highest existing version number in the versions dir, so a restarted loop continues instead of starting over. */
function latestVersion(o) {
  if (!fs.existsSync(o.versionsDir)) return 0;
  const re = new RegExp(`^${escRe(o.prefix)}-(\\d+)$`);
  let max = 0;
  for (const entry of fs.readdirSync(o.versionsDir)) {
    const m = entry.match(re);
    if (m && fs.statSync(path.join(o.versionsDir, entry)).isDirectory()) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function copyTree(src, dst, excludes) {
  fs.mkdirSync(dst, { recursive: true });
  const args = ['-a'];
  for (const e of excludes) args.push('--exclude', e);
  const r = spawnSync('rsync', [...args, `${src}/`, `${dst}/`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`copy failed (${r.status})`);
}

/** Keep copies cheap but tests runnable: symlink the original node_modules into the copy. */
function linkNodeModules(target, dst) {
  const src = path.join(target, 'node_modules');
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return;
  const link = path.join(dst, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(src, link, 'dir');
}

function historyPath(versionsDir) {
  const p = path.join(versionsDir, 'HISTORY.md');
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, '# turd-polish history\n\n| # | version | started | duration | exit | summary |\n|---|---|---|---|---|---|\n');
  }
  return p;
}

function appendHistory(versionsDir, row) {
  fs.appendFileSync(historyPath(versionsDir), `| ${row.n} | ${row.name} | ${row.started} | ${row.duration} | ${row.exit} | ${row.summary} |\n`);
}

function summaryFrom(versionDir) {
  for (const name of ['undone.md', 'proposed-improvements.md']) {
    const p = path.join(versionDir, name);
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('|'));
    if (line) return line.replace(/\|/g, '\\|').slice(0, 160);
  }
  return 'no summary produced';
}

function buildPrompt(o, n, dst, previous) {
  const workOn = o.isFile ? `the file \`${path.basename(dst)}\` in your current directory` : 'this project in your current directory';
  const lines = [
    `You are iteration ${String(n).padStart(2, '0')} of an endless turd-polish loop.`,
    `Work only on ${workOn}. Your directory is ${dst}.`,
    previous ? `The previous version is ${previous}. Read its undone.md first and carry its unfinished work forward.` : 'This is the first version; start from the code itself.',
    'Follow the TURD-POLISH ITERATION procedure in your system prompt, in order, completely.',
    'Nobody is waiting to approve you: do not ask questions, do not stop after analysis, finish the procedure.',
  ];
  if (o.extra) lines.push(`Additional instructions for every iteration: ${o.extra}`);
  return lines.join('\n');
}

function runPi(o, dst, prompt, logFile) {
  const args = ['--mode', 'json', '-a', '--offline', '--append-system-prompt', ITERATION_DOC, '--session-dir', path.join(o.versionsDir, 'sessions')];
  if (o.noSkills) args.push('--no-skills');
  if (o.lean) args.push('--no-mcp', '--no-extensions');
  if (o.model) args.push('--model', o.model);
  if (o.thinking) args.push('--thinking', o.thinking);
  args.push(prompt);

  const fd = fs.openSync(logFile, 'a');
  const log = (msg) => fs.writeSync(fd, msg);
  return new Promise((resolve) => {
    const child = spawn('pi', args, { cwd: dst, stdio: ['ignore', fd, fd] });
    let timedOut = false;
    let stalled = false;

    // No time box by default: an iteration runs until it finishes.
    const kill = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10_000).unref(); };
    const timer = o.timeout > 0 ? setTimeout(() => { timedOut = true; kill(); }, o.timeout * 60_000) : null;

    // Optional stall detector: no new output for --stall minutes means it is stuck.
    let lastSize = 0;
    let lastGrowth = Date.now();
    const watchdog = o.stall > 0 ? setInterval(() => {
      let size = 0;
      try { size = fs.fstatSync(fd).size; } catch { return; }
      if (size > lastSize) { lastSize = size; lastGrowth = Date.now(); return; }
      if (Date.now() - lastGrowth > o.stall * 60_000) { stalled = true; kill(); }
    }, 15_000) : null;

    const stopWatching = () => { if (timer) clearTimeout(timer); if (watchdog) clearInterval(watchdog); };
    child.on('error', (err) => log(`\n[driver] failed to start pi: ${err.message}\n`));
    child.on('exit', (code, signal) => {
      stopWatching();
      fs.closeSync(fd);
      resolve({ exit: timedOut ? 'timeout' : stalled ? 'stalled' : (code ?? signal ?? 0) });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(ITERATION_DOC)) { console.error(`missing ${ITERATION_DOC}`); process.exit(2); }

  fs.mkdirSync(o.versionsDir, { recursive: true });
  fs.mkdirSync(path.join(o.versionsDir, 'logs'), { recursive: true });
  historyPath(o.versionsDir);

  let running = true;
  process.on('SIGINT', () => { console.log('\n[turd-polish] stopping after this iteration…'); running = false; });
  const stopFile = path.join(o.versionsDir, 'STOP');

  console.log(`[turd-polish] target      ${o.target}`);
  console.log(`[turd-polish] versions    ${o.versionsDir}/${o.prefix}-NN`);
  console.log(`[turd-polish] history     ${historyPath(o.versionsDir)}`);
  console.log(`[turd-polish] stop with   touch ${stopFile}`);

  const resumeFrom = o.restart ? 0 : latestVersion(o);
  if (resumeFrom) console.log(`[turd-polish] resuming    continuing from ${versionName(o.prefix, resumeFrom)} (use --restart to start over at 01)`);

  let n = resumeFrom;
  let done = 0;
  let failures = 0;
  while (running && done < o.max) {
    if (fs.existsSync(stopFile)) { console.log('[turd-polish] STOP file found; ending the loop.'); break; }
    n += 1;
    done += 1;
    const name = versionName(o.prefix, n);
    const dst = path.join(o.versionsDir, name);
    const prev = versionName(o.prefix, n - 1);
    const src = n > 1 && fs.existsSync(path.join(o.versionsDir, prev)) ? path.join(o.versionsDir, prev) : o.target;
    const started = new Date().toISOString();
    const t0 = Date.now();

    console.log(`\n[turd-polish] iteration ${n}: ${path.relative(path.dirname(o.versionsDir), src)} -> ${name}`);
    if (o.isFile) {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(o.target, path.join(dst, path.basename(o.target)));
    } else {
      copyTree(src, dst, o.excludes);
      linkNodeModules(o.target, dst);
    }

    if (o.dryRun) { appendHistory(o.versionsDir, { n, name, started, duration: '0s', exit: 'dry-run', summary: 'copied only' }); continue; }

    const logFile = path.join(o.versionsDir, 'logs', `${name}.log`);
    const previous = src === o.target ? null : path.basename(src);
    const { exit } = await runPi(o, dst, buildPrompt(o, n, dst, previous), logFile);
    const duration = `${Math.round((Date.now() - t0) / 1000)}s`;
    const summary = summaryFrom(dst);
    appendHistory(o.versionsDir, { n, name, started: started.slice(0, 16).replace('T', ' '), duration, exit, summary });
    if (exit !== 0) failures += 1;
    console.log(`[turd-polish] iteration ${n} finished (exit ${exit}, ${duration}) log: ${logFile}`);
    if (exit !== 0) console.log(`[turd-polish] continuing despite the failure (${failures} total)`);

    if (done < o.max && running) await sleep(o.delay * 1000);
  }

  console.log(`\n[turd-polish] loop ended after ${done} iteration(s). See ${historyPath(o.versionsDir)}`);
}

main().catch((err) => { console.error(`[turd-polish] ${err.message}`); process.exit(1); });
