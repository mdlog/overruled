import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePolicy, diffPolicies } from '../src/policy.mjs';
import { findSites } from '../src/sites.mjs';

const POLICY = `# Shop policy
Version 1.0.

## §2 Refund window
A full refund is available within **30 days of delivery**. After 30 days, no refund is issued.

## §4 Goodwill store credit
Support may issue store credit of **up to $25 per order**.
`;

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'overruled-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

test('parsePolicy ties each number to its clause', () => {
  const c = parsePolicy(POLICY);
  assert.deepEqual(c.map((x) => [x.id, x.numbers.map((n) => `${n.unit}:${n.value}`)]), [
    ['§2', ['days:30']],
    ['§4', ['usd:25']],
  ]);
});

test('diffPolicies reports old and new value with a direction', () => {
  const d = diffPolicies(POLICY, POLICY.replace(/30 days/g, '60 days'));
  assert.deepEqual(d.map((x) => [x.clause_id, x.from, x.to, x.direction]), [['§2', 30, 60, 'loosen']]);
  const t = diffPolicies(POLICY, POLICY.replace('$25', '$10'));
  assert.deepEqual(t.map((x) => [x.clause_id, x.from, x.to, x.direction]), [['§4', 25, 10, 'tighten']]);
});

test('findSites catches literal and derived forms, and skips other numbers', () => {
  const dir = fixture({
    'src/rules.js': [
      'export const RULES = { refundWindowDays: 30, maxCreditCents: 2500 };', // 1: constant, both
      "const copy = 'Refunds within 30 days of delivery';", // 2: days literal
      "const t = 'a 30-day window';", // 3: derived 30-day
      "const w = 'thirty days to return';", // 4: number word
      "refuse('at most $25.00.');", // 5: $25.00 with a sentence period
      "const big = '$250 bundle';", // 6: different number
      "const odd = '$25.50 fee';", // 7: different number
      'setTimeout(run, 30);', // 8: bare 30 without day context
    ].join('\n'),
    'src/notes.js': '// the window is 30 days\n',
    'test/rules.test.js': "assert('refund after 30 days is refused');\n",
  });
  const numbers = parsePolicy(POLICY).flatMap((c) => c.numbers.map((n) => ({ clause_id: c.id, value: n.value, unit: n.unit })));
  const sites = findSites(dir, numbers);
  const at = (file, line) => sites.filter((s) => s.file === file && s.line === line).map((s) => `${s.clause_id}:${s.kind}`).sort();
  assert.deepEqual(at('src/rules.js', 1), ['§2:constant', '§4:constant']);
  assert.equal(at('src/rules.js', 2).length, 1);
  assert.equal(at('src/rules.js', 3).length, 1);
  assert.equal(at('src/rules.js', 4).length, 1);
  assert.deepEqual(at('src/rules.js', 5), ['§4:refusal']);
  assert.deepEqual(at('src/rules.js', 6), []);
  assert.deepEqual(at('src/rules.js', 7), []);
  assert.deepEqual(at('src/rules.js', 8), []);
  const comment = sites.find((s) => s.file === 'src/notes.js');
  assert.equal(comment.kind, 'comment');
  assert.equal(comment.in_source, false);
  const t = sites.find((s) => s.file === 'test/rules.test.js');
  assert.equal(t.kind, 'test');
  assert.equal(t.in_source, false);
});
