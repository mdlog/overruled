// Every fact the narration and the overlays state, read from the captures (verbatim command output) and the
// committed evidence, into out/take.json. Nothing the video says is typed in by hand: beats.mjs is a template over
// this file. Refuses the take when two sources disagree, or when the Kane capture is not one the video may show.
//
//   node video/select.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAP, CASE, GREEN_TAKE, OUT, ROOT } from './config.mjs';

const fail = (m) => {
  console.error(`refused: ${m}`);
  process.exit(1);
};
const file = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(file(p));
const cap = (id) => JSON.parse(readFileSync(`${CAP}${id}.json`, 'utf8'));
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const need = (v, what) => (v == null || Number.isNaN(v) ? fail(`could not read ${what}`) : v);
const frac = (s) => {
  const m = String(s).match(/^(\d+)\/(\d+)$/);
  return m ? { n: Number(m[1]), of: Number(m[2]) } : fail(`not a fraction: ${s}`);
};

const kase = json(`${CASE}/case.json`);
const packet = json(`${CASE}/packet.json`);
const attempts = json(`${CASE}/attempts.json`);
const ho = json('evidence/heldout/v1.2-summary.json');

// ── the edit and the red run ───────────────────────────────────────────────────────────────────────────────────
const d0 = kase.clause_diffs[0];
const red = kase.kane;
const e2 = file('evidence/kane/e2-run.ndjson').trim().split('\n').map((l) => JSON.parse(l));
const e2Start = e2[0].ts;
const delivered = red.values.delivered_1042;
const ageDays = Math.round((Date.parse(e2Start.slice(0, 10)) - Date.parse(delivered)) / 86_400_000);
const saidAge = Number(red.one_liner.match(/delivered (\d+) days ago/)?.[1]);
if (ageDays !== saidAge) fail(`1042's age: ${ageDays} days from the dates, ${saidAge} in Kane's one-liner`);
const kaneVersion = e2[0].cli_version;

// ── npm test under the edit (C2) ───────────────────────────────────────────────────────────────────────────────
const c2 = cap('c2').out;
const pass = Number(c2.match(/^# pass (\d+)/m)?.[1]);
const failN = Number(c2.match(/^# fail (\d+)/m)?.[1]);
if (!/^ok 24 - .*refused/m.test(c2)) fail('C2 does not show ok 24 (the refusal test)');
if (failN !== 0) fail(`npm test under the edit has ${failN} failures`);

// ── the replay (C3) ────────────────────────────────────────────────────────────────────────────────────────────
const c3 = plain(cap('c3').out);
if (!/All checks passed\./.test(c3)) fail('the replay did not end with "All checks passed."');
const row3 = (name) => {
  const m = c3.match(new RegExp(`^\\s+${name}\\s+(\\d+/\\d+)\\s+(\\d+/\\d+)`, 'm'));
  return m ? { qwen: frac(m[1]), gpt: frac(m[2]) } : fail(`replay section 3 has no row "${name}"`);
};
const moved = row3('moved money it should not have');
const refusedGrant = row3('refused what the page grants');
const control = row3('wording-only control');
const prereg = c3.match(/hash to ([0-9a-f]{8})… \(spike\/drift-set\.sha256\)/)?.[1] ?? fail('no pre-registration hash in the replay');
if (!file('spike/drift-set.sha256').includes(prereg)) fail('the replay hash is not the one in spike/drift-set.sha256');
const seedsTemp = c3.match(/(\d+) seeds at T([\d.]+) per cell/) ?? fail('no seeds/temperature in the replay');
const sec5 = c3.match(/attempt (\d+)\s+commit (\w+) · (\d+) paths · npm test (\d+)\/(\d+) · residual (\d+) · probe (\d+)\/(\d+)/) ?? fail('no attempt line in the replay');

// ── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────
const a = attempts.at(-1);
const inSource = packet.sites.filter((s) => s.in_source && s.clause_id === d0.clause_id).length;
const hook = cap('hook').out;
const hookLines = Number(hook.match(/(\d+) source lines restate the old number/)?.[1]);
if (hookLines !== inSource) fail(`source lines: hook log ${hookLines}, packet ${inSource}`);
if (Number(sec5[4]) !== a.npm_test.pass || Number(sec5[3]) !== a.files_changed.length || sec5[2] !== a.commit) fail('replay section 5 disagrees with attempts.json');
const c4 = plain(cap('c4').out);
const shortstat = c4.match(/(\d+) files? changed, (\d+) insertions?\(\+\), (\d+) deletions?/) ?? fail('no shortstat in C4');
const redAt = e2Start.slice(11, 16);

// ── the Kane green (the swappable beat) ────────────────────────────────────────────────────────────────────────
let green;
try {
  green = JSON.parse(readFileSync(GREEN_TAKE, 'utf8'));
} catch {
  fail(`no Kane green capture at ${GREEN_TAKE}: run node video/capture-green.mjs`);
}
if (!green.asExpected) fail(`${GREEN_TAKE}: Kane's results ${JSON.stringify(green.runEnd.results)} are not the expected ${JSON.stringify(green.expected)}; film the recorded take (VIDEO_SCRIPT: never retry)`);
if (green.exit !== 0) fail(`${GREEN_TAKE}: overruled check exited ${green.exit}`);
const conds = green.runEnd.descriptions;
if (!conds[1]?.includes(`within ${d0.to} days`) || !conds[2]?.includes(`within ${d0.from} days`)) fail('the green conditions do not name the new and the old value');

// ── the held-out edit ──────────────────────────────────────────────────────────────────────────────────────────
const sec7pre = c3.match(/breaches, unfixed build\s+qwen3:8b (\d+\/\d+) · gpt-oss:20b (\d+\/\d+)/) ?? fail('no unfixed row in replay section 7');
const sec7post = c3.match(/breaches, fixed build\s+qwen3:8b (\d+\/\d+) · gpt-oss:20b (\d+\/\d+)/) ?? fail('no fixed row in replay section 7');
if (sec7pre[1] !== ho.totals.pre['qwen3:8b'] || sec7post[2] !== ho.totals.post['gpt-oss:20b']) fail('replay section 7 disagrees with v1.2-summary.json');
const half = file('evidence/heldout/v1.2-halfapplied-summary.txt');
const halfM = half.match(/Result: (\d+) money or routing effects in (\d+)\/(\d+)/) ?? fail('no result line in the half-applied summary');

// ── sites (C8) ─────────────────────────────────────────────────────────────────────────────────────────────────
const c8a = cap('c8a').out;
const c8b = cap('c8b').out;
const c8c = cap('c8c').out;
const sitesAll = Number(c8a.match(/^(\d+) in-source line\(s\) restate a policy number/m)?.[1]);
const sitesChanged = Number(c8b.match(/^(\d+) in-source line\(s\) restate a changed policy number/m)?.[1]);
const exitB = Number(c8b.match(/^exit=(\d+)/m)?.[1]);
const exitC = Number(c8c.match(/^exit=(\d+)/m)?.[1]);
if (sitesChanged !== inSource) fail(`sites --from found ${sitesChanged} lines, the packet ${inSource}`);
if (exitB === 0 || exitC !== 0) fail(`sites --residual exits: before ${exitB}, after ${exitC}`);
if (!/src\/db\.js:\d+\s+\[db-check\]/.test(c8a)) fail('sites shows no db-check line');

// ── the fresh clone (C9) ───────────────────────────────────────────────────────────────────────────────────────
const c9 = cap('c9');
if (c9.exit !== 0 || !/All checks passed\./.test(plain(c9.out))) fail('the fresh clone replay did not pass');

const take = {
  at: new Date().toISOString(),
  clause: { id: d0.clause_id, title: d0.title, from: need(d0.from, 'from'), to: need(d0.to, 'to'), unit: d0.unit },
  red: { status: red.status, reason: red.reason_code, at: redAt, ageDays, kaneVersion },
  tests: { pass: need(pass, 'npm test pass') },
  whichCopy: { moved, refusedGrant, control, prereg, seeds: Number(seedsTemp[1]), temp: seedsTemp[2] },
  loop: {
    inSource,
    attempt: a.n,
    commit: a.commit,
    paths: a.files_changed.length,
    tests: a.npm_test.pass,
    testsOf: a.npm_test.pass + a.npm_test.fail,
    residual: a.sites_residual,
    probe: `${a.probe.runs - a.probe.bad}/${a.probe.runs}`,
    shortstat: { files: Number(shortstat[1]), ins: Number(shortstat[2]), del: Number(shortstat[3]) },
  },
  green: {
    take: GREEN_TAKE.replace(ROOT, ''),
    mode: green.mode,
    label: green.label,
    results: green.runEnd.results,
    expected: green.expected,
    conditions: conds.length,
  },
  heldout: {
    edits: ho.edit.length,
    hash: ho.hash.slice(0, 8),
    commit: ho.commit,
    fix: a.commit,
    pre: { qwen: frac(ho.totals.pre['qwen3:8b']), gpt: frac(ho.totals.pre['gpt-oss:20b']) },
    post: { qwen: frac(ho.totals.post['qwen3:8b']), gpt: frac(ho.totals.post['gpt-oss:20b']) },
    codeLines: ho.code_diff_lines,
    half: { effects: Number(halfM[1]), n: Number(halfM[2]), of: Number(halfM[3]) },
  },
  sites: { all: sitesAll, changed: sitesChanged, exitBefore: exitB, exitAfter: exitC },
};
if (take.heldout.post.qwen.n !== 0 || take.heldout.post.gpt.n !== 0) fail('the narration says zero and zero after the fix');
if (take.heldout.half.effects !== 0) fail('the narration says the half-applied store refuses to move money');
writeFileSync(`${OUT}take.json`, JSON.stringify(take, null, 2));
console.log(JSON.stringify(take, null, 2));
