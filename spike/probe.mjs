// Hour-1 spike probe (no Kane credits): drive the target store's chat API as a
// customer, then read what actually happened from the customer-visible pages
// (/orders and /account/ledger). Classify each run into the said/did matrix.
//
// Usage: node spike/probe.mjs --model qwen3:8b --temp 0.7 --seeds 1,2,3,4,5 [--only s2-plain]
// Assumes the target server is already running on BASE (default http://localhost:3000)
// with OLLAMA_MODEL / OLLAMA_TEMPERATURE set to the same values, and that RESET_CMD
// restores the seed database (default: the target's seed script).

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const BASE = process.env.BASE || 'http://localhost:3000';
const MODEL = args.model || 'unknown';
const TEMP = args.temp ?? 'unknown';
const SEEDS = (args.seeds || '1').split(',').map(Number);
const ONLY = args.only ? args.only.split(',') : null;
const RESET_CMD = process.env.RESET_CMD;
const OUT = join(here, 'results', `${(args.file || 'scenarios.json').replace('.json', '')}_${MODEL.replace(/[:/]/g, '_')}_T${TEMP}.jsonl`);
mkdirSync(join(here, 'results'), { recursive: true });

const { scenarios } = JSON.parse(readFileSync(join(here, args.file || 'scenarios.json'), 'utf8'));

import { saidClaims, judge } from './judge.mjs';

// ---- customer-visible state ----
const strip = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function login(customer) {
  const r = await fetch(`${BASE}/login-as/${customer}`, { redirect: 'manual' });
  const set = r.headers.getSetCookie?.() || [r.headers.get('set-cookie')].filter(Boolean);
  return set.map(c => c.split(';')[0]).join('; ');
}
async function page(path, cookie) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return { status: r.status, html: await r.text() };
}
// parseState is filled in after the target is built (page format is the target's choice).
import { parseState } from './parse-state.mjs';

async function chat(cookie, messages, seed) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ messages, seed }),
  });
  const body = await r.text();
  let json; try { json = JSON.parse(body); } catch { json = { raw: body }; }
  return { status: r.status, json, ms: Date.now() - t0 };
}
const replyText = j => j.reply ?? j.message?.content ?? j.content ?? j.text ?? j.raw ?? JSON.stringify(j);

function diff(before, after) {
  // effects that appeared during the conversation, per order
  const eff = [];
  for (const [oid, a] of Object.entries(after.orders)) {
    const b = before.orders[oid] || {};
    if (a.status !== b.status) eff.push({ type: a.status === 'REFUNDED' ? 'refund' : a.status === 'ESCALATED' ? 'escalation' : 'status', order: oid, from: b.status, to: a.status });
  }
  const key = e => `${e.kind}|${e.order}|${e.amount}`;
  const seen = new Map();
  for (const e of before.ledger) seen.set(key(e), (seen.get(key(e)) || 0) + 1);
  for (const e of after.ledger) {
    const k = key(e);
    if (seen.get(k)) { seen.set(k, seen.get(k) - 1); continue; }
    eff.push({ type: e.kind === 'refund' ? 'refund_ledger' : 'credit', order: e.order, amount: e.amount });
  }
  return eff;
}

for (const sc of scenarios) {
  if (ONLY && !ONLY.includes(sc.id)) continue;
  for (const seed of SEEDS) {
    if (RESET_CMD) execSync(RESET_CMD, { stdio: 'ignore' });
    const cookie = await login(sc.customer);
    const before = parseState((await page("/orders", cookie)).html, (await page("/account/ledger", cookie)).html);
    const messages = []; const replies = []; let err = null; let ms = 0;
    for (const turn of sc.turns) {
      messages.push({ role: 'user', content: turn });
      const r = await chat(cookie, messages, seed);
      ms += r.ms;
      if (r.status !== 200) { err = `HTTP ${r.status}: ${replyText(r.json).slice(0, 200)}`; break; }
      const t = replyText(r.json);
      replies.push(t); messages.push({ role: 'assistant', content: t });
    }
    const after = parseState((await page("/orders", cookie)).html, (await page("/account/ledger", cookie)).html);
    const allReplies = replies.join('\n---\n');
    const said = saidClaims(allReplies);
    const effects = diff(before, after);
    const verdict = err ? { error: err } : judge(sc, effects, said, allReplies);
    const row = { scenario: sc.id, clause: sc.clause, model: MODEL, temp: TEMP, seed, ms, said, effects, ...verdict, replies };
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    const tag = err ? 'ERROR' : verdict.breaches.length ? 'BREACH' : verdict.overRefusal ? 'OVER-REFUSAL' : verdict.saidCells.length ? 'SAID?' : 'ok';
    console.log(`${MODEL} T${TEMP} seed${seed} ${sc.id.padEnd(16)} ${tag.padEnd(12)} ${(err || [...verdict.breaches, ...verdict.saidCells].join('; ')).slice(0, 90)}  (${(ms / 1000).toFixed(1)}s)`);
  }
}
