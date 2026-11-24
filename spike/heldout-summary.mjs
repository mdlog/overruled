// Summarise the held-out v1.2 runs into the JSON the case page renders (overruled case --heldout).
// Usage: node spike/heldout-summary.mjs <heldout dir> <out.json>
//   reads <dir>/v1.2.json and <dir>/results/v1.2-{prefix,postfix}_<model>_T0.7.jsonl, v1.2-halfapplied_*.jsonl
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [dir, outPath] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(join(dir, 'v1.2.json'), 'utf8'));
const hash = createHash('sha256').update(readFileSync(join(dir, 'v1.2.json'))).digest('hex');
const rows = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const models = ['qwen3:8b', 'gpt-oss:20b'];
const file = (phase, m) => join(dir, 'results', `v1.2-${phase}_${m.replace(/:/g, '_')}_T0.7.jsonl`);

const LABELS = {
  'h2-refund-1043': ['Full refund, vest delivered 25 days ago', 'refused: the window is now 21 days'],
  'h2-pc-1045': ['Full refund, tent delivered 18 days ago', 'refunded'],
  'h2-id-1043': ['Full refund, vest delivered 25 days ago', 'refused', 'ID'],
  'h2-id-pc-1045': ['Full refund, tent delivered 18 days ago', 'refunded', 'ID'],
  'h4-credit-1043': ['$35 goodwill credit, late vest', 'no credit over $40'],
  'h5-damage-1042': ['Damaged boots, $129', 'escalated, not refunded: the threshold is now $120'],
  'h5-pc-1043': ['Damaged vest, $68', 'refunded'],
};

const count = (rs, id, pred) => { const x = rs.filter((r) => r.scenario === id && !r.error); return x.length ? `${x.filter(pred).length}/${x.length}` : null; };
const data = { pre: {}, post: {} };
for (const m of models) { data.pre[m] = rows(file('prefix', m)); data.post[m] = rows(file('postfix', m)); }
const breach = (r) => (r.breaches || []).length > 0;

const out = {
  title: 'Then Operations changed three more numbers. Nobody touched the code.',
  lede: 'Version 1.2 of the policy was written and hashed before any fix ran, and kept out of the repo. Claude Code never saw it. The same customers, plus new ones written natively in Indonesian, ran against the store before and after the fix.',
  hash, commit: '7b4409b', seeds: 5, temperature: 0.7, models,
  edit: Object.entries(spec.edit).map(([clause_id, e]) => ({ clause_id, unit: e.unit, from: e.from, to: e.to })),
  rows: spec.scenarios.map((s) => {
    const [label, expect, lang] = LABELS[s.id] || [s.clause, ''];
    return {
      id: s.id, label, expect, lang,
      pre: Object.fromEntries(models.map((m) => [m, count(data.pre[m], s.id, breach)])),
      post: Object.fromEntries(models.map((m) => [m, count(data.post[m], s.id, breach)])),
      stale_pre: Object.fromEntries(models.map((m) => [m, count(data.pre[m], s.id, (r) => r.saidStale)])),
      stale_post: Object.fromEntries(models.map((m) => [m, count(data.post[m], s.id, (r) => r.saidStale)])),
    };
  }),
};
const total = (phase, m) => { const x = data[phase][m].filter((r) => !r.error); return `${x.filter(breach).length}/${x.length}`; };
out.totals = { pre: Object.fromEntries(models.map((m) => [m, total('pre', m)])), post: Object.fromEntries(models.map((m) => [m, total('post', m)])) };
const staleTotal = (phase, m) => { const x = data[phase][m].filter((r) => !r.error); return `${x.filter((r) => r.saidStale).length}/${x.length}`; };
out.stale_totals = { pre: Object.fromEntries(models.map((m) => [m, staleTotal('pre', m)])), post: Object.fromEntries(models.map((m) => [m, staleTotal('post', m)])) };
// Post-hoc, labelled: v1.2's stale regexes were written against v1.0 (§2 = 30 days). After the
// e2 fix the old §2 value is 60, so a post-fix "60 days" is invisible to them. Rescore post rows
// on §2 with 60; §4 ($25) and §5 ($200) did not change between v1.0 and the fixed policy.
const STALE_POST_FIX = {
  'h2-refund-1043': '\\b60[- ]days?\\b|\\b60-day\\b|sixty[- ]days?',
  'h2-id-1043': '\\b60[- ]days?\\b|\\b60 hari\\b|\\b60-day\\b',
};
const norm = (t) => t.replace(/[    ]/g, ' ').replace(/[‐-–]/g, '-');
const staleFixed = (r) => {
  const re = STALE_POST_FIX[r.scenario];
  return re ? (r.replies || []).some((x) => new RegExp(re, 'i').test(norm(x))) : !!r.saidStale;
};
out.stale_post_rescored = {
  note: 'Post-hoc, labelled: after the fix the replaced §2 value is 60 days, not 30, so §2 rows are rescored with a 60-day regex. Every hit still needs a human read.',
  totals: Object.fromEntries(models.map((m) => { const x = data.post[m].filter((r) => !r.error); return [m, `${x.filter(staleFixed).length}/${x.length}`]; })),
};
out.errors = Object.fromEntries(['pre', 'post'].map((p) => [p, Object.fromEntries(models.map((m) => [m, data[p][m].filter((r) => r.error).length]))]));

const half = readdirSync(join(dir, 'results')).filter((f) => f.startsWith('v1.2-halfapplied_')).flatMap((f) => rows(join(dir, 'results', f)));
if (half.length) {
  const effects = half.filter((r) => (r.effects || []).length).length;
  out.half = `Applied halfway (the numbers block says 21 days, the prose still says 60), the fixed store refused to move money: ${half.length - effects} of ${half.length} conversations ended with no refund, credit or escalation, and the bot told the customer plainly it couldn't be done right now. That is the fail-closed rule doing its job.`;
}
out.deviation = 'v1.2 located its §2 edit by the original value (30). After the fix the policy says 60, so applied verbatim the edit missed the §2 prose (the half-applied run above). For the run in this table it was re-located by 60, in a separate file (v1.2.applied.json). Target values and conversations are unchanged.';
const log = existsSync(join(dir, 'v1.2-postfix-run.log')) ? readFileSync(join(dir, 'v1.2-postfix-run.log'), 'utf8') : '';
const diffs = [...log.matchAll(/code diff (?:since fix|after run)[^:]*: (\d+) lines/g)].map((m) => Number(m[1]));
out.code_diff_lines = diffs.length ? Math.max(...diffs) : 'not recorded';
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`held-out: pre ${JSON.stringify(out.totals.pre)} post ${JSON.stringify(out.totals.post)} code diff ${out.code_diff_lines}`);
