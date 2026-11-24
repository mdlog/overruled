import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClaims, verifyReply, sanitizeReply } from '../src/claims.js';
import { formatCents, formatDollars } from '../src/util.js';
import { RULES } from './policy-fixture.js';

// Policy numbers come from policy.md: the refund window, the store-credit cap and the §5 threshold.
const { refundWindowDays: WINDOW, maxCreditCents: CAP, damageEscalationOverCents: OVER } = RULES;
const CREDIT = formatDollars(CAP); // e.g. "$N" as the assistant would say it
const CREDIT_CENTS = formatCents(CAP); // e.g. "$N.00"

const orders = [
  { id: '1042', item: 'Alpine Hiking Boots', total_cents: 12900 },
  { id: '1043', item: 'Trail Running Vest', total_cents: 6800 },
  { id: '1044', item: 'Clearance Down Jacket', total_cents: 9000 },
  { id: '1045', item: '4-Person Expedition Tent', total_cents: 34000 },
];
const empty = { orders, refunds: [], credits: [], escalations: [], balanceCents: 0 };

const types = (text) => extractClaims(text, orders).map((c) => `${c.type}:${c.kind}`);

test('detects completion claims', () => {
  assert.deepEqual(types("I've issued a full refund of $68.00 for order 1043."), ['refund:done']);
  assert.deepEqual(types('Your refund for the vest has been processed.'), ['refund:done']);
  assert.deepEqual(
    types('Your refund of $68.00 for order 1043 has been processed to the original payment method.'),
    ['refund:done'],
  );
  assert.deepEqual(types(`A store credit of ${CREDIT_CENTS} has been added to your account.`), ['store_credit:done']);
  assert.deepEqual(types('Order 1043 has been refunded.'), ['refund:done']);
  assert.deepEqual(types(`I've added a ${CREDIT} store credit to your account.`), ['store_credit:done']);
  assert.deepEqual(types(`A goodwill credit of ${CREDIT} has been applied to your account.`), ['store_credit:done']);
  assert.deepEqual(types("I've escalated your tent order to a human agent."), ['escalation:done']);
  assert.deepEqual(types('Your case has been escalated.'), ['escalation:done']);
  assert.deepEqual(types('A human agent will contact you within 24 hours.'), ['escalation:implied']);
  assert.deepEqual(types('The $68 has been credited back to your original payment method.'), ['refund:done']);
});

test('detects promises of action', () => {
  assert.deepEqual(types("I'll process your refund now."), ['refund:promise']);
  assert.deepEqual(types('Let me issue that store credit for you.'), ['store_credit:promise']);
  assert.deepEqual(types("I'm escalating this to our team right away."), ['escalation:promise']);
});

test('ignores refusals, questions, offers and policy explanations', () => {
  const none = [
    "I'm sorry, but I can't issue a refund for order 1042 because it was delivered 45 days ago.",
    'Unfortunately the jacket is Final Sale, so it cannot be refunded.',
    `Would you like me to issue a ${CREDIT} store credit instead?`,
    'If you like, I can escalate this to a human agent.',
    `A full refund is available within ${WINDOW} days of delivery.`,
    'Refunds are processed to the original payment method.',
    'No refund was issued.',
    'Let me know if you would like me to escalate this.',
    `I can offer you a goodwill store credit of up to ${CREDIT}.`,
    "I wasn't able to process the refund.",
    `Damage claims over ${formatDollars(OVER)} must be escalated to a human agent.`,
  ];
  for (const text of none) assert.deepEqual(types(text), [], text);
});

test('splits mixed sentences into clauses', () => {
  assert.deepEqual(types(`I can't refund the boots, but I've issued a ${CREDIT} store credit for order 1042.`), ['store_credit:done']);
  assert.deepEqual(types(`I've issued a ${CREDIT} store credit instead of a refund.`), ['store_credit:done']);
});

test('a refund claim with no refund in the database is a problem', () => {
  const v = verifyReply('Good news! Your refund of $129 for order 1042 has been processed.', empty, []);
  assert.equal(v.ok, false);
  assert.match(v.problems[0].message, /no refund exists/);
});

test('a promise with no tool call is a problem', () => {
  const v = verifyReply("Sure, I'll process the refund for your vest right away.", empty, []);
  assert.equal(v.ok, false);
});

test('a true claim passes', () => {
  const state = { ...empty, refunds: [{ order_id: '1043', amount_cents: 6800 }] };
  const actions = [{ type: 'refund', order_id: '1043', item: 'Trail Running Vest', amount_cents: 6800 }];
  const v = verifyReply("Done! I've issued a full refund of $68.00 for order 1043 to your original payment method.", state, actions);
  assert.deepEqual(v.problems, []);
});

test('a wrong amount is a problem', () => {
  const issued = Math.round(CAP / 2); // the reply claims the full cap, but less was issued
  const state = { ...empty, credits: [{ order_id: '1042', amount_cents: issued }], balanceCents: issued };
  const actions = [{ type: 'store_credit', order_id: '1042', item: 'Alpine Hiking Boots', amount_cents: issued }];
  const v = verifyReply(`I've added a ${CREDIT} store credit to your account for order 1042.`, state, actions);
  assert.equal(v.ok, false);
});

test('a false balance is a problem', () => {
  const state = { ...empty, credits: [{ order_id: '1042', amount_cents: CAP }], balanceCents: CAP };
  const v = verifyReply(`Your store credit balance is now ${formatCents(2 * CAP)}.`, state, []);
  assert.equal(v.ok, false);
});

test('an action the reply does not mention is a problem', () => {
  const state = { ...empty, escalations: [{ order_id: '1045' }] };
  const actions = [{ type: 'escalation', order_id: '1045', item: '4-Person Expedition Tent', amount_cents: null }];
  const v = verifyReply("I'm sorry your tent arrived damaged.", state, actions);
  assert.equal(v.ok, false);
  assert.match(v.problems[0].message, /WAS made/);
});

test('escalation claim for the escalated order passes, and other orders are checked separately', () => {
  const state = { ...empty, escalations: [{ order_id: '1045' }] };
  const actions = [{ type: 'escalation', order_id: '1045', item: '4-Person Expedition Tent', amount_cents: null }];
  assert.equal(verifyReply("I've escalated order 1045 to a human agent, who will follow up with you.", state, actions).ok, true);
  assert.equal(verifyReply("I've escalated order 1045 and refunded order 1043.", state, actions).ok, false);
});

test('sanitizeReply drops false sentences and states what really happened', () => {
  const reply = "I'm sorry about that. Your refund of $129 for order 1042 has been processed.";
  const v = verifyReply(reply, empty, []);
  const attempts = [{ tool: 'issue_refund', order_id: '1042', ok: false, message: `NOT DONE: no refund was made. Delivered ${WINDOW + 1} days ago. Full refunds are only available within ${WINDOW} days of delivery (§2). Tell the customer plainly that the refund was not made, and why.` }];
  const out = sanitizeReply(reply, v, [], attempts);
  assert.doesNotMatch(out, /has been processed/);
  assert.match(out, /could not complete the refund for order 1042/);
  assert.match(out, /no refund, store credit or escalation was made/);
  assert.equal(verifyReply(out, empty, []).ok, true);
});
