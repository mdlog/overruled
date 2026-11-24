// policy.md's policy-values block drives every rule; editing the block and the prose
// together changes behaviour with no code change; anything wrong with the block
// fails closed. No policy number is written in this file: they come from policy.md.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb, listRefunds, listCredits, listEscalations, getOwnedOrder } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createToolbox, toolDefinitions } from '../src/tools.js';
import { createApp } from '../src/app.js';
import { buildSystemPrompt, loadConfig } from '../src/assistant.js';
import { POLICY_KEYS, loadPolicy } from '../src/policy-file.js';
import { daysAgo, daysSince, formatDollars } from '../src/util.js';
import {
  POLICY,
  POLICY_MD,
  RULES,
  blockOnly,
  blockValues,
  cleanupPolicies,
  policyFrom,
  proseOnly,
  withValues,
  withoutBlock,
  writePolicy,
} from './policy-fixture.js';

const { refundWindowDays: WINDOW, maxCreditCents: CAP } = RULES;
const BLOCK = blockValues(); // the block as written in policy.md

let db;
beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
});
after(() => cleanupPolicies());

const toolbox = (policy, userMessages = []) => createToolbox(db, { customerId: 'cust-ana', userMessages, policy });
const order = (id) => getOwnedOrder(db, 'cust-ana', id);
const setDelivered = (id, days) => db.prepare('UPDATE orders SET delivered_on = ? WHERE id = ?').run(daysAgo(days), id);
const defsByName = (policy) => Object.fromEntries(toolDefinitions(policy).map((d) => [d.function.name, d.function]));

// ------------------------------------------------------------- the block

test('policy.md has one policy-values block, right after the version line, that agrees with the prose', () => {
  const lines = POLICY_MD.split('\n');
  const version = lines.findIndex((l) => l.startsWith('Version '));
  const open = lines.indexOf('```policy-values');
  assert.ok(version >= 0, 'policy.md has a version line');
  assert.ok(open > version && lines.slice(version + 1, open).every((l) => !l.trim()), 'the block follows the version line');
  assert.equal(lines.filter((l) => l.startsWith('```policy-values')).length, 1);
  assert.deepEqual(Object.keys(BLOCK).sort(), Object.keys(POLICY_KEYS).sort());
  assert.equal(POLICY.ok, true, POLICY.error);
  assert.deepEqual({ ...RULES }, {
    refundWindowDays: BLOCK.refund_window_days,
    maxCreditCents: Math.round(BLOCK.goodwill_credit_max_usd * 100),
    damageEscalationOverCents: Math.round(BLOCK.damage_escalation_over_usd * 100),
  });
  assert.ok(POLICY_MD.includes(`${BLOCK.refund_window_days} days of delivery`));
  assert.ok(POLICY_MD.includes(`$${BLOCK.goodwill_credit_max_usd} per order`));
  assert.ok(POLICY_MD.includes(`over $${BLOCK.damage_escalation_over_usd}`));
});

test('the values are read from the file on every call, not cached', () => {
  const file = writePolicy(POLICY_MD, 'reread.md');
  assert.equal(loadPolicy(file).rules.refundWindowDays, WINDOW);
  fs.writeFileSync(file, withValues({ refund_window_days: WINDOW + 7 }));
  assert.equal(loadPolicy(file).rules.refundWindowDays, WINDOW + 7);
});

// ------------------------------------------- block + prose edited together

test('§2: changing the window in the block and the prose changes refunds, with no code change', () => {
  const age = daysSince(order('1042').delivered_on);
  const ending = policyFrom(withValues({ refund_window_days: age - 1 }));
  const including = policyFrom(withValues({ refund_window_days: age }));
  assert.equal(ending.ok && including.ok, true);

  const refused = toolbox(ending).run('issue_refund', { order_id: '1042', amount: 129, reason: 'changed mind' });
  assert.equal(refused.error, 'OUTSIDE_REFUND_WINDOW');
  assert.ok(refused.message.includes(`within ${age - 1} days of delivery`));
  assert.equal(listRefunds(db, 'cust-ana').length, 0);

  assert.equal(toolbox(including).run('issue_refund', { order_id: '1042', amount: 129, reason: 'changed mind' }).ok, true);
  assert.equal(order('1042').status, 'REFUNDED');

  assert.ok(defsByName(ending).issue_refund.description.includes(`within ${age - 1} days`));
  const prompt = buildSystemPrompt(db, { id: 'cust-ana', name: 'Ana Lima' }, ending);
  assert.ok(prompt.includes(`- §2: Within ${age - 1} days of delivery`));
  assert.ok(prompt.includes(`refund_window_days: ${age - 1}`), 'the prompt quotes the edited policy.md');
});

test('§4: changing the store-credit cap changes what can be issued (the database does not cap it)', () => {
  const raisedCents = CAP + 1000;
  const raised = policyFrom(withValues({ goodwill_credit_max_usd: raisedCents / 100 }));
  const loweredUsd = Math.max(1, Math.floor(CAP / 100 / 2)); // half the current cap, in whole dollars
  const lowered = policyFrom(withValues({ goodwill_credit_max_usd: loweredUsd }));
  assert.equal(raised.ok && lowered.ok, true);

  const aboveOld = (CAP + 500) / 100;
  assert.equal(toolbox(POLICY).run('issue_store_credit', { order_id: '1042', amount: aboveOld, reason: 'goodwill' }).error, 'AMOUNT_OVER_LIMIT');
  const ok = toolbox(raised).run('issue_store_credit', { order_id: '1042', amount: aboveOld, reason: 'goodwill' });
  assert.equal(ok.ok, true, ok.message);
  assert.deepEqual(listCredits(db, 'cust-ana').map((c) => c.amount_cents), [CAP + 500]);

  const tooMuch = toolbox(lowered).run('issue_store_credit', { order_id: '1043', amount: CAP / 100, reason: 'goodwill' });
  assert.equal(tooMuch.error, 'AMOUNT_OVER_LIMIT');
  assert.ok(tooMuch.message.includes(`$${loweredUsd}.00`), tooMuch.message);

  assert.equal(defsByName(raised).issue_store_credit.parameters.properties.amount.maximum, raisedCents / 100);
  assert.ok(defsByName(raised).issue_store_credit.description.includes(`at most ${formatDollars(raisedCents)}`));
});

test('§5: changing the damage threshold changes which damage claims must be escalated', () => {
  const tent = order('1045');
  const vest = order('1043');
  const aboveTent = policyFrom(withValues({ damage_escalation_over_usd: (tent.total_cents + 10000) / 100 }));
  const belowVest = policyFrom(withValues({ damage_escalation_over_usd: (vest.total_cents - 1000) / 100 }));
  assert.equal(aboveTent.ok && belowVest.ok, true);

  const damagedTent = ['My expedition tent arrived with a torn rainfly.'];
  const tentRefund = toolbox(aboveTent, damagedTent).run('issue_refund', { order_id: '1045', amount: tent.total_cents / 100, reason: 'torn' });
  assert.equal(tentRefund.ok, true, tentRefund.message);

  const damagedVest = ['My trail running vest arrived ripped.'];
  const vestRefund = toolbox(belowVest, damagedVest).run('issue_refund', { order_id: '1043', amount: vest.total_cents / 100, reason: 'ripped' });
  assert.equal(vestRefund.error, 'DAMAGE_REQUIRES_ESCALATION');
  assert.ok(vestRefund.message.includes(`is over ${formatDollars(vest.total_cents - 1000)}`));
  assert.ok(defsByName(belowVest).escalate_to_human.description.includes(`orders over ${formatDollars(vest.total_cents - 1000)}`));
});

// ------------------------------------------------------------ fail closed

const lines = POLICY_MD.split('\n');
const openAt = lines.indexOf('```policy-values');
const closeAt = lines.findIndex((l, i) => i > openAt && l === '```');
const editLines = (fn) => {
  const copy = [...lines];
  fn(copy);
  return copy.join('\n');
};
const blockText = lines.slice(openAt, closeAt + 1).join('\n');

const BROKEN = {
  'the block is missing': withoutBlock(),
  'a value is not a number': blockOnly({ refund_window_days: 'soon' }),
  'a value is negative': blockOnly({ goodwill_credit_max_usd: `-${BLOCK.goodwill_credit_max_usd}` }),
  'a value has a unit': blockOnly({ damage_escalation_over_usd: `$${BLOCK.damage_escalation_over_usd}` }),
  'the days value is not a whole number': blockOnly({ refund_window_days: `${BLOCK.refund_window_days}.5` }),
  'a line is not "key: number"': editLines((l) => l.splice(openAt + 1, 0, 'refunds are generous')),
  'the block is not closed': editLines((l) => l.splice(closeAt, 1)),
  'a key is missing': editLines((l) => l.splice(l.findIndex((x) => x.startsWith('damage_escalation_over_usd:')), 1)),
  'a key is repeated': editLines((l) => l.splice(openAt + 1, 0, l[openAt + 1])),
  'a key is unknown': editLines((l) => l.splice(openAt + 1, 0, 'restocking_fee_usd: 5')),
  'there are two blocks': `${POLICY_MD}\n${blockText}\n`,
  'the block disagrees with the prose (§2)': blockOnly({ refund_window_days: BLOCK.refund_window_days + 1 }),
  'the block disagrees with the prose (§4)': blockOnly({ goodwill_credit_max_usd: BLOCK.goodwill_credit_max_usd + 1 }),
  'the block disagrees with the prose (§5)': blockOnly({ damage_escalation_over_usd: BLOCK.damage_escalation_over_usd + 1 }),
  'the prose was edited but the block was not': proseOnly({ refund_window_days: BLOCK.refund_window_days + 1 }),
  'a clause no longer states its number': editLines((l) => {
    const i = l.findIndex((x) => x.startsWith('Support may issue goodwill store credit'));
    l[i] = 'Support may issue goodwill store credit, once per order.';
  }),
};

/** The three money-moving / routing actions, on orders where policy.md would allow each one. */
function tryEveryAction(policy) {
  setDelivered('1043', 0);
  const t = toolbox(policy, ['My tent arrived damaged.']);
  return {
    t,
    results: [
      t.run('issue_refund', { order_id: '1043', amount: order('1043').total_cents / 100, reason: 'changed mind' }),
      t.run('issue_store_credit', { order_id: '1042', amount: CAP / 100, reason: 'goodwill' }),
      t.run('escalate_to_human', { order_id: '1045', summary: 'Tent arrived damaged' }),
    ],
  };
}

function assertFailsClosed(policy) {
  assert.equal(policy.ok, false);
  assert.equal(policy.rules, null, 'no built-in default values');
  assert.ok(policy.error);
  const { t, results } = tryEveryAction(policy);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.error, 'POLICY_UNAVAILABLE');
    assert.match(r.message, /^NOT DONE: no (refund|store credit|escalation) was made\./);
    assert.match(r.message, /can't be done right now/);
  }
  assert.deepEqual(t.actions, []);
  assert.deepEqual(t.attempts.map((a) => a.error), ['POLICY_UNAVAILABLE', 'POLICY_UNAVAILABLE', 'POLICY_UNAVAILABLE']);
  assert.equal(listRefunds(db, 'cust-ana').length, 0);
  assert.equal(listCredits(db, 'cust-ana').length, 0);
  assert.equal(listEscalations(db, 'cust-ana').length, 0);
  for (const id of ['1042', '1043', '1045']) assert.equal(order(id).status, 'DELIVERED');

  // What the model is told about each order and each tool says the same.
  const { orders } = t.run('list_orders', {});
  for (const o of orders) {
    assert.equal(o.refund_allowed, false);
    assert.equal(o.store_credit_allowed, false);
    assert.equal(o.store_credit_max, null);
  }
  const defs = defsByName(policy);
  for (const name of ['issue_refund', 'issue_store_credit', 'escalate_to_human']) {
    assert.match(defs[name].description, /POLICY_UNAVAILABLE/);
  }
  assert.equal(defs.issue_store_credit.parameters.properties.amount.maximum, undefined);
}

test('control: with policy.md intact, the same three actions go through', () => {
  const { results } = tryEveryAction(POLICY);
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
});

for (const [name, text] of Object.entries(BROKEN)) {
  test(`fail closed: ${name}`, () => {
    assertFailsClosed(policyFrom(text));
  });
}

test('fail closed: the policy file cannot be read', () => {
  const policy = loadPolicy(`${writePolicy('', 'gone.md')}.missing`);
  assert.equal(policy.text, null);
  assertFailsClosed(policy);
});

// ------------------------------------------------- the running app (HTTP)

async function startApp() {
  const script = [];
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = script.shift();
    if (!next) throw new Error('fake Ollama: script exhausted');
    return new Response(JSON.stringify({ message: { role: 'assistant', ...next } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const app = createApp(db, { config: loadConfig({ OLLAMA_MODEL: 'fake-model' }), fetchImpl });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = 'customer_id=cust-ana';
  return {
    script,
    requests,
    page: async (p) => (await fetch(`${base}${p}`, { headers: { cookie } })).text(),
    chat: async (content) => {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ messages: [{ role: 'user', content }] }),
      });
      return res.json();
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
const call = (name, args) => ({ content: '', tool_calls: [{ function: { name, arguments: args } }] });
const say = (content) => ({ content });

async function withPolicyFile(text, fn) {
  const file = writePolicy(text, 'live-policy.md');
  process.env.POLICY_PATH = file;
  const app = await startApp();
  try {
    await fn(app, file);
  } finally {
    delete process.env.POLICY_PATH;
    await app.close();
  }
}

test('the running app follows an edit to policy.md on the next request: pages, prompt and tools', async () => {
  const age = daysSince(order('1042').delivered_on);
  await withPolicyFile(withValues({ refund_window_days: age - 1 }), async (app, file) => {
    assert.ok((await app.page('/orders')).includes(`Refunds are available within ${age - 1} days of delivery`));
    assert.ok((await app.page('/policy')).includes(`refund_window_days: ${age - 1}`));
    app.script.push(
      call('issue_refund', { order_id: '1042', amount: 129, reason: 'changed mind' }),
      say(`I'm sorry, I couldn't refund order 1042: it is outside the ${age - 1}-day refund window.`),
    );
    const before = await app.chat('Please refund my boots, order 1042.');
    assert.equal(before.tool_calls[0].result.error, 'OUTSIDE_REFUND_WINDOW');
    assert.ok(app.requests[0].messages[0].content.includes(`- §2: Within ${age - 1} days of delivery`));
    assert.equal(listRefunds(db, 'cust-ana').length, 0);

    // Operations edits the file again; no restart, no code change.
    fs.writeFileSync(file, withValues({ refund_window_days: age }));
    assert.ok((await app.page('/orders')).includes(`Refunds are available within ${age} days of delivery`));
    app.script.push(
      call('issue_refund', { order_id: '1042', amount: 129, reason: 'changed mind' }),
      say("Done! I've issued a full refund of $129.00 for order 1042 to your original payment method."),
    );
    const afterEdit = await app.chat('Please refund my boots, order 1042.');
    assert.equal(afterEdit.tool_calls[0].result.ok, true);
    assert.ok(app.requests.at(-1).messages[0].content.includes(`- §2: Within ${age} days of delivery`));
    assert.deepEqual(listRefunds(db, 'cust-ana').map((r) => r.order_id), ['1042']);
  });
});

test('fail closed through the chat: the customer is told plainly that it cannot be done right now', async () => {
  await withPolicyFile(withoutBlock(), async (app) => {
    const orders = await app.page('/orders');
    assert.ok(orders.includes("Refunds and store credit can&#39;t be arranged right now"), 'the /orders copy says so');
    assert.ok(!orders.includes('Refunds are available within'));

    const lie = say('Your refund of $68.00 for order 1043 has been processed.');
    app.script.push(call('issue_refund', { order_id: '1043', amount: 68, reason: 'changed mind' }), lie, lie, lie);
    const data = await app.chat('Please refund my vest, order 1043.');
    assert.equal(data.tool_calls[0].result.error, 'POLICY_UNAVAILABLE');
    assert.equal(data.verification.sanitized, true);
    assert.doesNotMatch(data.reply, /has been processed/);
    assert.match(data.reply, /could not complete the refund for order 1043/);
    assert.match(data.reply, /can't be done right now/);
    assert.equal(listRefunds(db, 'cust-ana').length, 0);

    const prompt = app.requests[0].messages[0].content;
    assert.match(prompt, /policy values could not be loaded, so refunds, store credit and escalations can't be done right now/);
    assert.ok(!prompt.includes(`- §2: Within ${WINDOW} days`), 'no rule summary from built-in numbers');
  });
});
