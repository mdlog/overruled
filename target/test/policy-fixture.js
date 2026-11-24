// Test helpers. Policy numbers always come from policy.md, never from the tests:
// RULES is what the app reads from the real file, and withValues() writes a copy of
// policy.md whose policy-values block and prose both say new numbers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY_PATH, POLICY_KEYS, loadPolicy } from '../src/policy-file.js';

export const POLICY_MD = fs.readFileSync(DEFAULT_POLICY_PATH, 'utf8');
export const POLICY = loadPolicy(DEFAULT_POLICY_PATH);
assert.equal(POLICY.ok, true, `policy.md must load: ${POLICY.error}`);
/** { refundWindowDays, maxCreditCents, damageEscalationOverCents } from policy.md. */
export const RULES = POLICY.rules;

const OPEN = '```policy-values';

function blockRange(lines) {
  const start = lines.indexOf(OPEN);
  const end = lines.findIndex((l, i) => i > start && l.trim() === '```');
  assert.ok(start >= 0 && end > start, 'policy.md has a closed policy-values block');
  return [start, end];
}

/** The policy-values block as written: { key: number }. */
export function blockValues(md = POLICY_MD) {
  const lines = md.split('\n');
  const [start, end] = blockRange(lines);
  return Object.fromEntries(
    lines
      .slice(start + 1, end)
      .filter((l) => l.trim())
      .map((l) => l.split(':').map((s) => s.trim()))
      .map(([k, v]) => [k, Number(v)]),
  );
}

/** Rewrite lines of the block: changes = { key: newValue } (any text, to make broken blocks). */
export function blockOnly(changes, md = POLICY_MD) {
  const lines = md.split('\n');
  const [start, end] = blockRange(lines);
  for (let i = start + 1; i < end; i++) {
    const key = lines[i].split(':')[0].trim();
    if (Object.hasOwn(changes, key)) lines[i] = `${key}: ${changes[key]}`;
  }
  return lines.join('\n');
}

/** Rewrite the numbers the prose states in each key's clause (old value -> new value). */
export function proseOnly(changes, md = POLICY_MD) {
  const old = blockValues(md);
  const lines = md.split('\n');
  let clause = null;
  return lines
    .map((line) => {
      const h = line.match(/^#{1,6}\s.*(§\d+)/);
      if (h) {
        clause = h[1];
        return line;
      }
      let out = line;
      for (const [key, value] of Object.entries(changes)) {
        const spec = POLICY_KEYS[key];
        if (spec.clause !== clause) continue;
        out =
          spec.unit === 'days'
            ? out.replace(/(\d+)(\s*-?\s*days?\b)/gi, (m, n, rest) => (Number(n) === old[key] ? `${value}${rest}` : m))
            : out.replace(/\$(\s?)(\d[\d,]*(?:\.\d{1,2})?)/g, (m, sp, n) =>
                Number(n.replace(/,/g, '')) === old[key] ? `$${sp}${value}` : m,
              );
      }
      return out;
    })
    .join('\n');
}

/** policy.md with the block and the prose both changed, as Operations would edit it. */
export function withValues(changes, md = POLICY_MD) {
  return blockOnly(changes, proseOnly(changes, md));
}

/** policy.md without its policy-values block (prose untouched). */
export function withoutBlock(md = POLICY_MD) {
  const lines = md.split('\n');
  const [start, end] = blockRange(lines);
  lines.splice(start, end - start + 1);
  return lines.join('\n');
}

let tmpDir;
/** Write a policy file into a temporary directory and return its path. */
export function writePolicy(text, name = 'policy.md') {
  tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-policy-'));
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, text);
  return file;
}

/** Load a policy markdown (through a file, the way the app reads it). */
export function policyFrom(text) {
  return loadPolicy(writePolicy(text, `policy-${Math.random().toString(36).slice(2)}.md`));
}

export function cleanupPolicies() {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
}
