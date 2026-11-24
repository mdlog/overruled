// The Kane beat's source (VIDEO_SCRIPT C5 + C6): runs the loop's own green, `overruled check --green-only`, and keeps
// what it printed with the time of every line, the run.ndjson Kane wrote, and Kane's three results. The beat films
// whatever capture GREEN_TAKE (config.mjs) points at.
//
//   node video/capture-green.mjs            0 credits: --recorded-green evidence/kane/green-read/run.ndjson. The probe
//                                           conversation runs for real; Kane's read is the committed 08:04 record.
//                                           The case dir is restored afterwards.          -> out/captures/green-recorded.json
//   node video/capture-green.mjs --live     THE ONE KANE TAKE, about 5 credits: kane-cli run --analyzer-only, run by
//                                           the loop. Leaves the new kane-green-*/ and case.json for you to commit.
//                                                                                          -> out/captures/green-live.json
//   node video/capture-green.mjs --import <stdout.txt> <run.ndjson>
//                                           a take already run by hand (C5): its saved stdout and run.ndjson, 0 credits.
//                                           Log lines carry no times, so they are shown at an even pace.
//                                                                                          -> out/captures/green-live.json
//
// Either way the store ends stopped, with 1042 refunded in its database (the conversation's result): film /orders
// with KEEP_DB=1 (record.mjs does).

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CAP, CASE, ROOT, STORE_PATTERN } from './config.mjs';
import { EMAIL, run } from './run.mjs';

const RECORDED = 'evidence/kane/green-read/run.ndjson';
const argv = process.argv.slice(2);
const live = argv.includes('--live');
const imp = argv.includes('--import') ? argv.slice(argv.indexOf('--import') + 1, argv.indexOf('--import') + 3) : null;
const mode = live || imp ? 'live' : 'recorded';
const caseAbs = join(ROOT, CASE);
const sh = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8' });
const fail = (m) => {
  console.error(`refused: ${m}`);
  process.exit(1);
};

const greens = () => new Set(readdirSync(caseAbs).filter((d) => d.startsWith('kane-green-')));
const before = greens();
let cmd, lines, exit, at, newDir;

if (imp) {
  const [logPath, nd] = imp;
  if (!logPath || !nd || !existsSync(logPath) || !existsSync(nd)) fail('--import needs <stdout.txt> <run.ndjson>');
  const text = readFileSync(logPath, 'utf8').trimEnd();
  if (EMAIL.test(text)) fail('the log contains an e-mail address');
  cmd = `node cli/bin/overruled.mjs check --green-only ${CASE}`;
  lines = text.split('\n').map((t, i) => ({ t: null, i, text: t }));
  exit = 0;
  at = new Date().toISOString();
  newDir = relative(ROOT, join(nd, '..'));
} else {
  // Port 3000: the loop stops the store by its pattern itself, but nothing else may hold the port.
  const holder = execSync('ss -ltnp 2>/dev/null | grep ":3000 " || true', { encoding: 'utf8' }).trim();
  const pids = [...holder.matchAll(/pid=(\d+)/g)].map((m) => m[1]);
  const ours = (pid) => { try { return new RegExp(STORE_PATTERN).test(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')); } catch { return false; } };
  if (holder && !(pids.length && pids.every(ours))) fail(`port 3000 is held by something that is not the store; retry when it is free:\n${holder}`);
  if (sh(`git status --porcelain -- ${CASE}`).trim()) fail(`${CASE} has uncommitted changes; commit or restore them first`);
  cmd = `node cli/bin/overruled.mjs check --green-only ${CASE}${live ? '' : ` --recorded-green ${RECORDED}`}`;
  if (live) console.log('LIVE KANE TAKE: this spends Kane credits (about 5). Ctrl-C now to stop.\n');
  const r = await run(cmd, { cwd: ROOT, echo: true });
  ({ lines, exit, at } = r);
  const made = [...greens()].filter((d) => !before.has(d));
  if (made.length !== 1) fail(`expected one new kane-green-* dir, found ${made.length}`);
  newDir = `${CASE}/${made[0]}`;
}

const ndjson = mode === 'recorded' ? RECORDED : imp ? relative(ROOT, imp[1]) : `${newDir}/run.ndjson`;
if (!existsSync(join(ROOT, ndjson))) fail(`no ${ndjson}`);
const events = readFileSync(join(ROOT, ndjson), 'utf8').trim().split('\n');
if (EMAIL.test(events.join('\n'))) fail(`${ndjson} contains an e-mail address`);
const t0 = Date.parse(JSON.parse(events[0]).ts);
// What `tail -F run.ndjson | cut -c1-140` prints (140: one terminal row at the size the beat films), each line at the time Kane wrote it.
const ndLines = events.map((l) => ({ t: Date.parse(JSON.parse(l).ts) - t0, text: l.slice(0, 140) }));
const runEnd = events.map((l) => JSON.parse(l)).find((e) => e.type === 'run_end');
if (!runEnd) fail(`${ndjson} has no run_end`);

const cfg = JSON.parse(readFileSync(join(ROOT, 'overruled.config.json'), 'utf8'));
const expected = cfg.kane.green.conditions['§2'].map((c) => c.expect);
const c6 = await run(`node video/kane-results.mjs ${ndjson}`, { cwd: ROOT });

// Keep the probe conversation's own record next to the capture (the case dir is restored below in recorded mode).
const keep = `${CAP}green-${mode}/`;
rmSync(keep, { recursive: true, force: true });
mkdirSync(keep, { recursive: true });
const dirAbs = join(ROOT, newDir);
if (existsSync(dirAbs)) for (const f of readdirSync(dirAbs)) if (/\.(log|jsonl)$/.test(f)) copyFileSync(join(dirAbs, f), keep + f);

const hhmm = new Date(runEnd.ts).toISOString().slice(11, 16);
const take = {
  mode,
  at,
  cmd,
  exit,
  lines,
  timed: !imp,
  ndjson,
  ndjsonCmd: mode === 'recorded' ? `cut -c1-140 ${ndjson}` : `tail -F ${newDir.replace(`${CASE}/`, '')}/run.ndjson | cut -c1-140`,
  ndLines,
  runEnd: {
    status: runEnd.status,
    duration: runEnd.duration,
    credits: Math.round(runEnd.credits_consumed * 100) / 100,
    results: runEnd.condition_results,
    descriptions: (runEnd.condition_sub_checks ?? []).map((s) => s.description),
    ts: runEnd.ts,
  },
  expected,
  asExpected: runEnd.condition_results.length === expected.length && runEnd.condition_results.every((r, i) => r === expected[i]),
  label: mode === 'recorded' ? `KANE CLI · recorded ${hhmm} UTC` : 'KANE CLI · live take',
  c6: { cmd: c6.cmd, out: c6.out, exit: c6.exit },
  probeRecord: existsSync(keep) ? readdirSync(keep).map((f) => relative(ROOT, keep + f)) : [],
  caseDir: newDir,
};
mkdirSync(CAP, { recursive: true });
writeFileSync(`${CAP}green-${mode}.json`, JSON.stringify(take, null, 1));
console.log(`\nwrote ${relative(ROOT, `${CAP}green-${mode}.json`)}: exit ${exit}, Kane ${runEnd.status}, results ${JSON.stringify(runEnd.condition_results)} (expected ${JSON.stringify(expected)})`);

if (mode === 'recorded') {
  // The dry run's only footprint: case.json and the new kane-green-*/. Restore both (DEMO_RUNBOOK).
  sh(`git checkout -- ${CASE}/case.json`);
  rmSync(dirAbs, { recursive: true, force: true });
  const left = sh(`git status --porcelain -- ${CASE}`).trim();
  if (left) fail(`${CASE} is not clean after the restore:\n${left}`);
  console.log(`restored ${CASE} (case.json, ${newDir.split('/').pop()} removed)`);
} else {
  console.log(`next: npm run case, then commit ${newDir}/ and ${CASE}/case.json (VIDEO_SCRIPT recording order step 4)`);
}
// The loop stops the store when it is done; make sure nothing is left on port 3000.
execSync(`pkill -f "${STORE_PATTERN}" || true`);
