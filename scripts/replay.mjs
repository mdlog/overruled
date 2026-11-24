#!/usr/bin/env node
// npm run replay — the whole case from committed files, in a few seconds.
// No GPU, no model, no Kane credits, no network. Every number below is read from evidence/
// or spike/ at run time, and the pre-registration hashes and commit order are re-checked.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (p) => readFileSync(join(root, p));
const txt = (p) => raw(p).toString('utf8');
const json = (p) => JSON.parse(txt(p));
const jsonl = (p) => txt(p).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c('1'), dim = c('2'), red = c('31'), green = c('32'), yellow = c('33');
const ok = (b) => (b ? green('✓') : red('✗'));
const cut = (s, n = 96) => { const t = String(s ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const h = (n, title, label) => console.log(`\n${bold(`${n}  ${title}`)}${label ? `  ${dim(label)}` : ''}`);
const row = (k, v) => console.log(`   ${dim(k.padEnd(34))} ${v}`);
let failures = 0;
const check = (pass, what) => { if (!pass) failures++; console.log(`   ${ok(pass)} ${what}`); };

const CASE = 'evidence/loop/2026-11-24T0720Z-fcbbf44';
const kase = json(`${CASE}/case.json`);
const packet = json(`${CASE}/packet.json`);
const attempts = json(`${CASE}/attempts.json`);
const labels = json('overruled.config.json').kane.labels;

console.log(bold('Overruled') + dim(' · replay from committed evidence · no GPU, no model, no Kane credits, no network'));
console.log(dim('Trailhead Supply: a store whose support bot was built by Claude Code from a neutral prompt.'));
console.log(dim('Operations then edited the policy page, and only the page: §2 refund window 30 → 60 days.'));

// 1 ─ the catch
h(1, 'Kane shops as Ana after the policy edit', 'Kane CLI 0.10.8, recorded run, sealed evidence pack');
// Show the sentence that carries a policy number, with the old value in red and the new one in green.
const d0 = kase.clause_diffs[0];
const num = (v) => new RegExp(`\\b${v}(?=[- ]days?\\b)`, 'g');
const focus = (v) => {
  const t = String(v ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  const sents = t.split(/(?<=[.!?])\s+/);
  const i = sents.findIndex((x) => num(d0.from).test(x) || num(d0.to).test(x));
  const s = i < 0 ? cut(t) : `${i > 0 ? '… ' : ''}${cut(sents[i], 92)}`;
  return s.replace(num(d0.from), (m) => red(bold(m))).replace(num(d0.to), (m) => green(bold(m)));
};
for (const [k, v] of Object.entries(kase.kane.values)) row(labels[k] || k, focus(v));
row('Kane', `${red(kase.kane.status)} · ${kase.kane.reason_code}`);
row('Kane says', cut(kase.kane.one_liner, 110));
const packSha = sha256(raw(kase.kane.pack));
check(packSha === kase.verdict.pack_sha256, `evidence pack sha256 ${packSha.slice(0, 12)}… matches the sealed record`);
const verdict = json('evidence/kane/e2-pack/verdict.json');
row('policy-gate verdict', `${red(verdict.result ?? kase.verdict.result)} · blocking gates failed: ${kase.verdict.failed_gates.join(', ')}`);

// 2 ─ the agent's own tests
h(2, "The coding agent's own tests were green the whole time", 'npm test under the edited policy');
const t = txt('evidence/npm-test-under-e2.txt');
const ok24 = t.split('\n').find((l) => /^ok 24\b/.test(l));
row('the test that asserts the bug', cut(ok24, 90));
row('npm test', `${green(`pass ${t.match(/^# pass (\d+)/m)?.[1]}`)} · fail ${t.match(/^# fail (\d+)/m)?.[1]}`);

// 3 ─ which copy each model obeys
h(3, 'Which copy of the rule each model obeys', 'probe, not Kane · pre-registered · 5 seeds at T0.7 per cell');
const pre = txt('spike/drift-set.sha256');
const hashWant = pre.match(/=\s*([0-9a-f]{64})/)[1];
const files = pre.match(/cat (.+?) \| sha256sum/)[1].split(/\s+/);
check(sha256(Buffer.concat(files.map((f) => raw(f)))) === hashWant, `drift set + its 8 policy edits hash to ${hashWant.slice(0, 8)}… (spike/drift-set.sha256)`);
const added = (p) => git('log', '--diff-filter=A', '--format=%h %ct', '--', p)?.split('\n').at(-1);
const hashCommit = added('spike/drift-set.sha256'), resultCommit = added('spike/results/drift-set_qwen3_8b_T0.7.jsonl');
if (hashCommit && resultCommit) check(Number(hashCommit.split(' ')[1]) < Number(resultCommit.split(' ')[1]), `hash committed ${hashCommit.split(' ')[0]} before the first result ${resultCommit.split(' ')[0]}`);
const models = { 'qwen3:8b': 'qwen3_8b', 'gpt-oss:20b': 'gpt-oss_20b' };
const cells = Object.fromEntries(Object.entries(models).map(([m, f]) => [m, jsonl(`spike/results/drift-set_${f}_T0.7.jsonl`).filter((r) => !r.error)]));
const count = (m, ids) => { const rs = cells[m].filter((r) => ids.includes(r.scenario)); return `${rs.filter((r) => (r.breaches || []).length).length}/${rs.length}`; };
const groups = [
  ['moved money it should not have', ['e1-window14-1043', 'e3-credit10-1043', 'e7-highvalue-1045']],
  ['refused what the page grants', ['e2-window60-1042', 'e6-damage500-1045']],
  ['wording-only control', ['c0-pc-1043', 'c0-refund-1042', 'c0-credit-1043']],
];
console.log(`   ${dim(''.padEnd(34))}${Object.keys(models).map((m) => bold(m.padEnd(14))).join('')}`);
for (const [name, ids] of groups) console.log(`   ${name.padEnd(34)}${Object.keys(models).map((m) => count(m, ids).padEnd(14)).join('')}`);
console.log(dim('   Same code, same edit: one model pays out, the other refuses. A number lint finds the 30; it can\'t tell you that.'));

// 4 ─ the lines that overrule the page
h(4, 'Every line that restated the old rule', '`overruled sites` · no Kane, no model');
const src = packet.sites.filter((s) => s.in_source);
for (const s of src) row(`${s.file}:${s.line}`, `${dim(`[${s.kind}]`)} ${cut(s.text, 70)}`);
row('also in the tests', `${packet.sites.filter((s) => s.kind === 'test').length} lines, e.g. ${packet.sites.find((s) => s.kind === 'test')?.file}`);
let residual = null;
try { execFileSync('node', ['cli/bin/overruled.mjs', 'sites', 'target/policy.md', 'target', '--residual'], { cwd: root, stdio: 'ignore' }); residual = 0; } catch (e) { residual = e.status; }
check(residual === 0, 'after the fix: 0 source lines restate a policy number (live: overruled sites --residual)');

// 5 ─ the loop
h(5, 'The loop: commit → hook → Kane red → packet → Claude Code → checks', `case ${kase.case}`);
for (const a of attempts) {
  row(`attempt ${a.n}`, `commit ${a.commit} · ${a.files_changed.length} paths · npm test ${green(`${a.npm_test.pass}/${a.npm_test.pass + a.npm_test.fail}`)} · residual ${a.sites_residual} · probe ${a.probe.runs - a.probe.bad}/${a.probe.runs}`);
  row('Claude Code, in its words', cut(a.agent_summary, 100));
}
const subj = git('show', '-s', '--format=%s', attempts.at(-1).commit);
if (subj) row('fix commit', cut(subj, 90));

// 6 ─ Kane green
h(6, 'Kane shops again after the fix', 'conversation in the probe; Kane reads /orders (--analyzer-only) · labelled');
const g = jsonl('evidence/kane/green-read/run.ndjson').find((e) => e.type === 'run_end');
const expect = [true, true, false];
g.condition_sub_checks.forEach((s, i) => check(g.condition_results[i] === expect[i], `${cut(s.description.replace(/^The text near the top of the page says /, '/orders copy: '), 90)} → ${g.condition_results[i]}${expect[i] ? '' : dim(' (negative control)')}`));
row('Kane', `${green(g.status)} · ${g.duration} s · ${Math.round(g.credits_consumed * 100) / 100} credits`);

// 7 ─ the edit it never saw
h(7, 'Then Operations changed three more numbers. Nobody touched the code.', 'held-out v1.2 · probe · labelled');
const ho = json('evidence/heldout/v1.2-summary.json');
const hoWant = txt('spike/heldout.sha256').match(/=\s*([0-9a-f]{64})/)[1];
check(sha256(raw('evidence/heldout/v1.2.json')) === hoWant, `v1.2 hashes to ${hoWant.slice(0, 8)}…, committed in ${ho.commit}`);
const before = git('merge-base', '--is-ancestor', ho.commit, attempts.at(-1).commit) !== null;
check(before, `${ho.commit} (the hash) is an ancestor of ${attempts.at(-1).commit} (the fix)`);
row('edit', ho.edit.map((e) => `${e.clause_id} → ${e.unit === 'usd' ? `$${e.to}` : `${e.to} days`}`).join(' · '));
row('breaches, unfixed build', Object.entries(ho.totals.pre).map(([m, v]) => `${m} ${red(v)}`).join(' · '));
row('breaches, fixed build', Object.entries(ho.totals.post).map(([m, v]) => `${m} ${green(v)}`).join(' · '));
row('code changed since the fix', `${ho.code_diff_lines} lines`);

console.log(`\n${failures ? red(`${failures} check(s) failed`) : green('All checks passed.')} ${dim('Open the offline case page:')} ${CASE}/case.html`);
process.exit(failures ? 1 : 0);
