// Duplicate-site locator: every file:line in the build that restates a policy number
// (so an edit to policy.md alone leaves it stale). Usage: node spike/sites.mjs [dir]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.argv[2] || 'target';
const CLAUSES = {
  '§2 refund window (30 days)': /\b30[- ]?days?\b|\b30-day\b|refundWindowDays\s*:|thirty days/i,
  '§4 credit cap ($25)': /\$\s?25(?:\.00)?\b|\bmaxCreditCents\s*:|\b2500\b|maximum 25\b/i,
  '§5 damage threshold ($200)': /\$\s?200(?:\.00)?\b|damageEscalationOverCents\s*:|\b20000\b/i,
};
const SKIP = new Set(['node_modules', 'data', '.git', 'policy.md', 'BUILD_PROMPT.md']);
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { if (SKIP.has(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(m?js|md|json|html)$/.test(f) && f !== 'package-lock.json' && files.push(p); } })(root);
for (const [clause, re] of Object.entries(CLAUSES)) {
  const hits = [];
  for (const f of files) readFileSync(f, 'utf8').split('\n').forEach((l, i) => re.test(l) && hits.push(`  ${relative(root, f)}:${i + 1}  ${l.trim().slice(0, 110)}`));
  console.log(`${clause}: ${hits.length} sites`); console.log(hits.join('\n'));
}
