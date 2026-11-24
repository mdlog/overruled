// Apply an Operations-style policy edit to a policy.md, the way a person would:
// change the numbers in the named clauses' prose, and, if the file has a
// ```policy-values block, set the named keys there too. Nothing else changes.
// Usage: node spike/apply-edit.mjs <edit.json> <policy.md in> <policy.md out>
// edit.json: { "edit": { "§2": { "unit": "days", "from": 30, "to": 60 } }, "block": { "refund_window_days": 60 } }
import { readFileSync, writeFileSync } from 'node:fs';

export function applyEdit(policy, spec) {
  const lines = policy.split('\n');
  let clause = null;
  let inBlock = false;
  const changed = { prose: [], block: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```\s*policy-values\b/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^```/.test(line)) { inBlock = false; continue; }
    if (inBlock) {
      const m = line.match(/^(\s*)([A-Za-z_][\w]*)(\s*[:=]\s*)([^#\n]*?)(\s*(#.*)?)$/);
      if (m && spec.block && Object.hasOwn(spec.block, m[2])) {
        lines[i] = `${m[1]}${m[2]}${m[3]}${spec.block[m[2]]}${m[5] || ''}`;
        changed.block.push(m[2]);
      }
      continue;
    }
    const h = line.match(/^#{1,6}\s+.*?(§\s?\d+[a-z]?)/);
    if (/^#{1,6}\s/.test(line)) { clause = h ? h[1].replace(/\s/g, '') : null; continue; }
    const e = clause && spec.edit?.[clause];
    if (!e) continue;
    let out = line;
    if (e.unit === 'days') {
      out = out.replace(new RegExp(`\\b${e.from}(\\s*(?:-\\s*)?days?\\b)`, 'gi'), `${e.to}$1`);
      out = out.replace(new RegExp(`\\b${e.from}-day\\b`, 'gi'), `${e.to}-day`);
    } else if (e.unit === 'usd') {
      out = out.replace(new RegExp(`\\$\\s?${e.from}((?:\\.00)?)(?!\\d|\\.\\d)`, 'g'), `$$${e.to}$1`);
    } else if (e.unit === 'percent') {
      out = out.replace(new RegExp(`\\b${e.from}\\s?%`, 'g'), `${e.to}%`);
    }
    if (out !== line) { lines[i] = out; changed.prose.push(clause); }
  }
  return { text: lines.join('\n'), changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [specPath, inPath, outPath] = process.argv.slice(2);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const { text, changed } = applyEdit(readFileSync(inPath, 'utf8'), spec);
  writeFileSync(outPath, text);
  console.error(`applied: prose in ${[...new Set(changed.prose)].join(', ') || 'none'}; block keys ${changed.block.join(', ') || 'none (no policy-values block)'}`);
}
