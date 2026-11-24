#!/usr/bin/env node
// overruled: find the code that quietly overrules your policy page.
//   overruled sites <policy.md> [dir]
//       every line under dir that restates a number from the policy
//   overruled sites <policy.md> [dir] --from <old-policy.md | REV:path>
//       only numbers that changed, searched by their OLD value
//   flags: --json  --source-only  --residual (exit 1 if any in-source line remains)  --exclude <path>
//   overruled check [--config overruled.config.json] [--from REV] [--recorded run.ndjson --recorded-verdict v.json --recorded-pack p.evidence]
//                   [--max-attempts 3] [--kane-green] [--packet-only] [--no-commit]
//       the loop: Kane as the customer -> packet -> Claude Code -> free checks -> green
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parsePolicy, diffPolicies } from '../src/policy.mjs';
import { findSites } from '../src/sites.mjs';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['--from', '--exclude', '--config', '--recorded', '--recorded-verdict', '--recorded-pack', '--max-attempts'];
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));
const [cmd, policyArg, dirArg] = positional;

const isRevSpec = (p) => /^[^/:]+:.+/.test(p) && !existsSync(p);
function readPolicyArg(p) {
  // "HEAD~1:target/policy.md" reads a committed version through git
  if (isRevSpec(p)) return execFileSync('git', ['show', p], { encoding: 'utf8' });
  return readFileSync(p, 'utf8');
}
function fmt(v, u) {
  if (v == null) return '—';
  return u === 'usd' ? `$${v}` : u === 'days' ? `${v} days` : `${v}%`;
}

if (cmd === 'check') {
  const { check } = await import('../src/check.mjs');
  const r = await check({
    config: opt('--config'), from: opt('--from'), recorded: opt('--recorded'), recordedVerdict: opt('--recorded-verdict'),
    recordedPack: opt('--recorded-pack'), maxAttempts: opt('--max-attempts'), kaneGreen: flag('--kane-green'),
    packetOnly: flag('--packet-only'), noCommit: flag('--no-commit'),
  });
  process.exit(r.status === 'no-change' || r.status === 'green-already' || r.status === 'packet' || r.fixed ? 0 : 1);
}
if (cmd !== 'sites' || !policyArg) {
  console.error('usage: overruled sites <policy.md> [dir] [--from <old-policy.md|REV:path>] [--json] [--source-only] [--residual] [--exclude <path>]');
  process.exit(2);
}

const policyPath = resolve(isRevSpec(policyArg) ? policyArg.split(':').slice(1).join(':') : policyArg);
const root = resolve(dirArg || '.');
const current = readPolicyArg(policyArg);
let numbers;
let diffs = null;
if (opt('--from')) {
  diffs = diffPolicies(readPolicyArg(opt('--from')), current);
  numbers = diffs.filter((d) => d.from != null).map((d) => ({ clause_id: d.clause_id, title: d.title, value: d.from, unit: d.unit }));
} else {
  numbers = parsePolicy(current).flatMap((c) => c.numbers.map((n) => ({ clause_id: c.id, title: c.title, value: n.value, unit: n.unit })));
}
const exclude = [policyPath, ...(opt('--exclude') ? [resolve(opt('--exclude'))] : [])];
let sites = findSites(root, numbers, { exclude });
if (flag('--source-only') || flag('--residual')) sites = sites.filter((s) => s.in_source);

if (flag('--json')) {
  console.log(JSON.stringify({ policy: relative(process.cwd(), policyPath), root: relative(process.cwd(), root) || '.', diffs, numbers, sites }, null, 1));
} else {
  if (diffs) for (const d of diffs) console.log(`${d.clause_id} ${d.title}: ${fmt(d.from, d.unit)} → ${fmt(d.to, d.unit)} (${d.direction})`);
  for (const n of numbers) {
    const hits = sites.filter((s) => s.clause_id === n.clause_id && s.value === n.value && s.unit === n.unit);
    const src = hits.filter((s) => s.in_source).length;
    console.log(`\n${n.clause_id} ${n.title} — ${fmt(n.value, n.unit)}: ${src} in source, ${hits.length - src} in tests/docs/comments`);
    for (const s of hits) console.log(`  ${s.in_source ? '●' : '○'} ${s.file}:${s.line}  [${s.kind}]  ${s.text.slice(0, 100)}`);
  }
  const total = sites.filter((s) => s.in_source).length;
  console.log(`\n${total} in-source line(s) restate ${diffs ? 'a changed' : 'a'} policy number. ● = source, ○ = tests/docs/comments.`);
}
if (flag('--residual') && sites.length) process.exit(1);
