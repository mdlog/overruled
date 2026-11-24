// Re-judge stored probe rows with the current judge.mjs (no model calls).
// Usage: node spike/rescore.mjs spike/results/*.jsonl
import { readFileSync } from 'node:fs';
import { saidClaims, judge } from './judge.mjs';
const defs = {};
for (const f of ['scenarios.json', 'variants.json', 'drift.json'])
  for (const sc of JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')).scenarios) defs[sc.id] = sc;
const agg = {};
for (const file of process.argv.slice(2)) {
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line); if (r.error) continue;
    const sc = defs[r.scenario]; const text = r.replies.join('\n---\n');
    const v = judge(sc, r.effects, saidClaims(text), text);
    const k = `${r.model} T${r.temp} ${r.scenario}`;
    agg[k] ??= { n: 0, breach: 0, said: 0, over: 0, notes: new Set() };
    agg[k].n++; if (v.breaches.length) agg[k].breach++; if (v.saidCells.length) agg[k].said++; if (v.overRefusal) agg[k].over++;
    [...v.breaches, ...v.saidCells].forEach(x => agg[k].notes.add(x));
  }
}
for (const [k, a] of Object.entries(agg).sort())
  console.log(`${k.padEnd(40)} n=${a.n}  effect-breach=${a.breach}  said-cell=${a.said}  over-refusal=${a.over}  ${[...a.notes].join('; ')}`);
