// Post-hoc said-stale rescore of the drift set (labelled deviation from the
// pre-registration). The pre-registered `stale` regexes missed gpt-oss output
// that writes "30 days" with U+202F and hyphens as U+2011. This script reports
// BOTH counts; it never rewrites the committed result rows.
// Usage: node spike/rescore-stale.mjs > spike/results/drift-set-stale-rescore.json
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const sc = Object.fromEntries(JSON.parse(readFileSync(join(here, 'drift-set.json'), 'utf8')).scenarios.map(s => [s.id, s]));
const norm = t => t.replace(/[    ]/g, ' ').replace(/[‐-–]/g, '-');
const cells = {};
for (const f of readdirSync(join(here, 'results')).filter(f => /^drift-set_.*\.jsonl$/.test(f)).sort()) {
  for (const line of readFileSync(join(here, 'results', f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line); const s = sc[r.scenario];
    if (!s?.stale) continue;
    const k = `${r.scenario} | ${r.model}`; const c = (cells[k] ??= { runs: 0, preregistered_regex: 0, after_normalisation: 0 });
    const text = r.replies.join('\n'); const re = new RegExp(s.stale, 'i');
    c.runs++; c.preregistered_regex += re.test(text); c.after_normalisation += re.test(norm(text));
  }
}
console.log(JSON.stringify({ note: 'said-stale counts per cell; preregistered_regex = as committed in b84cee1; after_normalisation = U+202F/U+00A0/U+2009/U+2007 -> space, U+2010..U+2013 -> hyphen. Every hit still needs a human read.', cells }, null, 1));
