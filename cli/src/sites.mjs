// Walk a source tree and list every line that restates a policy number.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, extname, basename } from 'node:path';
import { patternsFor } from './policy.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'dist', 'build', 'coverage', '.next', '.context', 'evidence']);
const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.java', '.html', '.ejs', '.hbs',
  '.vue', '.svelte', '.md', '.json', '.yaml', '.yml', '.sql', '.txt']);

export function walk(root, { exclude = [] } = {}) {
  const files = [];
  const ex = new Set(exclude.map((p) => resolve(p)));
  (function go(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (ex.has(resolve(p))) continue;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(f) && !f.startsWith('.')) go(p);
      } else if (EXTS.has(extname(f)) && !/lock\.json$|\.min\.js$/.test(f) && st.size < 1_000_000) {
        files.push(p);
      }
    }
  })(root);
  return files;
}

const COMMENT_START = ['//', '/*', '*', '--'];

export function classify(file, line) {
  const t = line.trim();
  const isTest = /(^|\/)(tests?|__tests__|spec)\//.test(file) || /\.(test|spec)\.[a-z]+$/.test(file);
  if (isTest) return 'test';
  if (/\.md$/.test(file)) return /readme/i.test(basename(file)) ? 'readme' : 'doc';
  if (COMMENT_START.some((c) => t.startsWith(c)) || (t.startsWith('#') && !t.startsWith('#!'))) return 'comment';
  if (/\bCHECK\s*\(/i.test(t)) return 'db-check';
  if (/description\s*:/.test(t)) return 'tool-schema';
  if (/refus|reason\s*:|throw\s|error/i.test(t)) return 'refusal';
  if (/^-?\s*§\d/.test(t) || /system ?prompt/i.test(t)) return 'prompt';
  if (/\.(html|ejs|hbs|vue|svelte)$/.test(file) || /<\/?(p|span|div|li|h\d|td)\b|class=/.test(t)) return 'page-copy';
  if (/^[\w$.]+\s*[:=]\s*-?\d/.test(t) || /\b(const|let|var)\s+\w+\s*=\s*-?\d/.test(t) || /\b[A-Za-z_$][\w$]*\s*:\s*-?\d/.test(t)) return 'constant';
  return 'code';
}

/** Sites for the given numbers ([{clause_id, title, value, unit}]) under root. */
export function findSites(root, numbers, opts = {}) {
  const files = walk(root, opts);
  const sites = [];
  for (const f of files) {
    const rel = relative(root, f);
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const n of numbers) {
        const p = patternsFor(n);
        const strong = p.strong.some((re) => re.test(line));
        const ctx = !strong && p.contextual && p.contextual.re.test(line) && p.contextual.context.test(line) && !/\.md$/.test(f);
        if (!strong && !ctx) continue;
        const kind = classify(rel, line);
        sites.push({
          clause_id: n.clause_id, value: n.value, unit: n.unit, file: rel, line: i + 1, text: line.trim().slice(0, 160), kind,
          in_source: !['test', 'readme', 'doc', 'comment'].includes(kind), match: strong ? 'literal' : 'contextual',
        });
      }
    });
  }
  return sites;
}
