// policy.md is the only place the support policy lives. This module is the only
// code that reads it: the /policy page, the assistant's prompt, the tools and the
// /orders copy all get the policy text and its numbers from loadPolicy(), which
// reads the file again on every call (so an edit takes effect on the next request).
//
// The numbers come from the ```policy-values block. Each value must agree with the
// number the prose states in its clause. If the block is missing, cannot be parsed
// or disagrees with the prose, the policy is unavailable ({ ok: false }) and every
// money-moving or routing action refuses. There is no built-in default.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './db.js';

export const DEFAULT_POLICY_PATH = path.join(ROOT_DIR, 'policy.md');

/** policy.md, or the file named by POLICY_PATH. Read on every call. */
export function policyPath(env = process.env) {
  return env.POLICY_PATH || DEFAULT_POLICY_PATH;
}

/**
 * The keys of the policy-values block: the clause whose prose must state the same
 * number, the unit that number is written in, and the name of the rule in code.
 */
export const POLICY_KEYS = Object.freeze({
  refund_window_days: { clause: '§2', unit: 'days', rule: 'refundWindowDays' },
  goodwill_credit_max_usd: { clause: '§4', unit: 'usd', rule: 'maxCreditCents' },
  damage_escalation_over_usd: { clause: '§5', unit: 'usd', rule: 'damageEscalationOverCents' },
});

export class PolicyError extends Error {}

const FENCE_OPEN = /^```policy-values[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const ANY_FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+(.*)$/;
const VALUE_FORMAT = { days: /^\d+$/, usd: /^\d+(?:\.\d{1,2})?$/ };

const toCents = (usd) => Math.round(usd * 100);

/** Read the policy-values block. Throws PolicyError unless there is exactly one, well formed. */
function readBlock(lines) {
  const starts = lines.flatMap((line, i) => (FENCE_OPEN.test(line) ? [i] : []));
  if (starts.length === 0) throw new PolicyError('policy.md has no ```policy-values block.');
  if (starts.length > 1) throw new PolicyError('policy.md has more than one ```policy-values block.');
  const start = starts[0];
  const end = lines.findIndex((line, i) => i > start && FENCE_CLOSE.test(line));
  if (end < 0) throw new PolicyError('The ```policy-values block is not closed.');

  const values = {};
  for (const line of lines.slice(start + 1, end)) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*([a-z][a-z0-9_]*)\s*:\s*(\S+)\s*$/);
    if (!m) throw new PolicyError(`Cannot parse policy-values line "${line.trim()}" (expected "key: number").`);
    const [, key, text] = m;
    if (!Object.hasOwn(POLICY_KEYS, key)) throw new PolicyError(`Unknown policy-values key "${key}".`);
    if (Object.hasOwn(values, key)) throw new PolicyError(`policy-values key "${key}" is given twice.`);
    const spec = POLICY_KEYS[key];
    if (!VALUE_FORMAT[spec.unit].test(text)) {
      throw new PolicyError(`policy-values ${key} is "${text}", which is not a valid ${spec.unit === 'days' ? 'whole number of days' : 'dollar amount'}.`);
    }
    values[key] = Number(text);
  }
  for (const key of Object.keys(POLICY_KEYS)) {
    if (!Object.hasOwn(values, key)) throw new PolicyError(`policy-values is missing "${key}".`);
  }
  return { values, fence: [start, end] };
}

/** The prose of each "§N" clause, without fenced blocks or markdown emphasis. */
function clauseProse(lines, fence) {
  const clauses = new Map();
  let current = null;
  let inFence = false;
  lines.forEach((line, i) => {
    if (i >= fence[0] && i <= fence[1]) return;
    if (ANY_FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const h = line.match(HEADING);
    if (h) {
      const id = h[1].match(/§\s?(\d+[a-z]?)/);
      current = id ? `§${id[1]}` : null;
      if (current) clauses.set(current, clauses.get(current) ?? []);
      return;
    }
    if (current) clauses.get(current).push(line);
  });
  return new Map([...clauses].map(([id, body]) => [id, body.join('\n').replace(/\*\*|__/g, '')]));
}

/** Every number of `unit` the prose states: "N days" / "N-day", or "$N". */
function statedNumbers(prose, unit) {
  if (unit === 'days') return [...prose.matchAll(/(\d+(?:\.\d+)?)\s*-?\s*days?\b/gi)].map((m) => Number(m[1]));
  return [...prose.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

function same(unit, a, b) {
  return unit === 'usd' ? toCents(a) === toCents(b) : a === b;
}

function show(unit, n) {
  return unit === 'usd' ? `$${n}` : `${n} days`;
}

/**
 * Parse and check the policy-values block of a policy markdown.
 * @returns {{refundWindowDays:number, maxCreditCents:number, damageEscalationOverCents:number}}
 * @throws {PolicyError} if the block is missing, malformed, or disagrees with the prose
 */
export function parsePolicyValues(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const { values, fence } = readBlock(lines);
  const prose = clauseProse(lines, fence);
  for (const [key, { clause, unit }] of Object.entries(POLICY_KEYS)) {
    if (!prose.has(clause)) throw new PolicyError(`policy.md has no ${clause} clause to check ${key} against.`);
    const stated = statedNumbers(prose.get(clause), unit);
    if (!stated.length) throw new PolicyError(`${clause} states no ${unit === 'usd' ? 'dollar amount' : 'number of days'} to check ${key} against.`);
    const conflict = stated.find((n) => !same(unit, n, values[key]));
    if (conflict !== undefined) {
      throw new PolicyError(`${clause} says ${show(unit, conflict)} but policy-values ${key} is ${values[key]}.`);
    }
  }
  return Object.freeze({
    refundWindowDays: values.refund_window_days,
    maxCreditCents: toCents(values.goodwill_credit_max_usd),
    damageEscalationOverCents: toCents(values.damage_escalation_over_usd),
  });
}

/**
 * Read policy.md now.
 * @returns {{ok:true, text:string, rules:object, error:null} | {ok:false, text:string|null, rules:null, error:string}}
 *   `text` is the policy as written (null if the file could not be read).
 */
export function loadPolicy(file = policyPath()) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, text: null, rules: null, error: `Cannot read ${file}: ${err.code || err.message}` };
  }
  try {
    return { ok: true, text: text.trim(), rules: parsePolicyValues(text), error: null };
  } catch (err) {
    if (!(err instanceof PolicyError)) throw err;
    return { ok: false, text: text.trim(), rules: null, error: err.message };
  }
}
