import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, listRefunds, listCredits, listEscalations, getOwnedOrder, creditBalanceCents } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createToolbox } from '../src/tools.js';
import { mentionsDamage, customerReportedDamage } from '../src/policy.js';
import { daysAgo, formatCents, formatDollars } from '../src/util.js';
import { RULES } from './policy-fixture.js';

// The policy's numbers, read from policy.md (the same file the app reads).
const { refundWindowDays: WINDOW, maxCreditCents: CAP, damageEscalationOverCents: OVER } = RULES;

let db;
beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
});

const ana = (userMessages = []) => createToolbox(db, { customerId: 'cust-ana', userMessages });
// Move an order's delivery date or total to a rule's boundary (test data only; the seed is unchanged).
const setDelivered = (id, days) => db.prepare('UPDATE orders SET delivered_on = ? WHERE id = ?').run(daysAgo(days), id);
const setTotal = (id, cents) => db.prepare('UPDATE orders SET total_cents = ? WHERE id = ?').run(cents, id);

test('seed data matches the spec', () => {
  const t = ana();
  const { orders } = t.run('list_orders', {});
  assert.deepEqual(
    orders.map((o) => [o.order_id, o.item, o.total, o.days_since_delivery, o.final_sale, o.status]),
    [
      ['1045', '4-Person Expedition Tent', 340, 3, false, 'DELIVERED'],
      ['1044', 'Clearance Down Jacket', 90, 5, true, 'DELIVERED'],
      ['1043', 'Trail Running Vest', 68, 10, false, 'DELIVERED'],
      ['1042', 'Alpine Hiking Boots', 129, 45, false, 'DELIVERED'],
    ],
  );
  const ben = createToolbox(db, { customerId: 'cust-ben' }).run('list_orders', {});
  assert.deepEqual(ben.orders.map((o) => [o.order_id, o.total, o.days_since_delivery]), [['2001', 210, 12]]);
});

test('§1: other customers\' orders look exactly like missing orders', () => {
  const t = ana();
  const other = t.run('get_order', { order_id: '2001' });
  const missing = t.run('get_order', { order_id: '9999' });
  assert.equal(other.ok, false);
  assert.equal(other.error, 'ORDER_NOT_FOUND');
  assert.equal(other.message.replace('2001', 'X'), missing.message.replace('9999', 'X'));
  for (const tool of ['issue_refund', 'issue_store_credit', 'escalate_to_human']) {
    const r = t.run(tool, { order_id: '2001', amount: 10, reason: 'x', summary: 'x' });
    assert.equal(r.error, 'ORDER_NOT_FOUND', tool);
  }
  assert.equal(listRefunds(db, 'cust-ben').length, 0);
  assert.equal(getOwnedOrder(db, 'cust-ben', '2001').status, 'DELIVERED');
});

test('§2: refund on the last day of the window succeeds and is recorded; a second refund is refused', () => {
  setDelivered('1043', WINDOW);
  const t = ana(['Please refund my running vest, I changed my mind']);
  const r = t.run('issue_refund', { order_id: '1043', amount: 68, reason: 'changed mind' });
  assert.equal(r.ok, true);
  assert.equal(getOwnedOrder(db, 'cust-ana', '1043').status, 'REFUNDED');
  assert.deepEqual(listRefunds(db, 'cust-ana').map((x) => [x.order_id, x.amount_cents]), [['1043', 6800]]);
  assert.equal(t.actions.length, 1);
  const again = t.run('issue_refund', { order_id: '1043', amount: 68, reason: 'again' });
  assert.equal(again.ok, false);
  assert.equal(again.error, 'ALREADY_REFUNDED');
  assert.equal(listRefunds(db, 'cust-ana').length, 1);
});

test('§2: refund one day after the window is refused', () => {
  setDelivered('1042', WINDOW + 1);
  const r = ana().run('issue_refund', { order_id: '1042', amount: 129, reason: 'too small' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'OUTSIDE_REFUND_WINDOW');
  assert.match(r.message, /NOT DONE/);
  assert.ok(r.message.includes(`within ${WINDOW} days of delivery`), r.message);
  assert.equal(listRefunds(db, 'cust-ana').length, 0);
});

test('§2/§4: what the read tools report follows policy.md', () => {
  setDelivered('1043', WINDOW);
  setDelivered('1042', WINDOW + 1);
  const { orders } = ana().run('list_orders', {});
  const byId = Object.fromEntries(orders.map((o) => [o.order_id, o]));
  assert.equal(byId['1043'].refund_allowed, true);
  assert.ok(byId['1043'].refund_rule.includes(`within the ${WINDOW}-day window`), byId['1043'].refund_rule);
  assert.equal(byId['1042'].refund_allowed, false);
  assert.equal(byId['1042'].store_credit_max, CAP / 100);
  assert.ok(byId['1042'].store_credit_rule.includes(`up to ${formatCents(CAP)}`), byId['1042'].store_credit_rule);
});

test('§3: Final Sale is never refunded', () => {
  const r = ana().run('issue_refund', { order_id: '1044', amount: 90, reason: 'does not fit' });
  assert.equal(r.error, 'FINAL_SALE');
  assert.equal(listRefunds(db, 'cust-ana').length, 0);
});

test('refund amounts are validated', () => {
  setDelivered('1043', 0);
  const t = ana();
  assert.equal(t.run('issue_refund', { order_id: '1043', amount: 500, reason: 'x' }).error, 'AMOUNT_EXCEEDS_TOTAL');
  assert.equal(t.run('issue_refund', { order_id: '1043', amount: -5, reason: 'x' }).error, 'INVALID_AMOUNT');
  assert.equal(t.run('issue_refund', { order_id: '1043', amount: 'lots', reason: 'x' }).error, 'INVALID_AMOUNT');
  assert.equal(t.run('issue_refund', { order_id: '#1043', amount: '$68.00', reason: 'x' }).ok, true);
});

test('§4: store credit up to the cap in policy.md, once per order', () => {
  const t = ana();
  const over = t.run('issue_store_credit', { order_id: '1042', amount: (CAP + 1) / 100, reason: 'goodwill' });
  assert.equal(over.error, 'AMOUNT_OVER_LIMIT');
  assert.ok(over.message.includes(`up to ${formatCents(CAP)}`), over.message);
  const ok = t.run('issue_store_credit', { order_id: '1042', amount: CAP / 100, reason: 'goodwill' });
  assert.equal(ok.ok, true);
  assert.equal(ok.store_credit_balance, CAP / 100);
  assert.equal(t.run('issue_store_credit', { order_id: '1042', amount: 1, reason: 'more' }).error, 'CREDIT_ALREADY_ISSUED');
  assert.equal(t.run('issue_store_credit', { order_id: '1044', amount: CAP / 100, reason: 'goodwill' }).ok, true);
  assert.equal(creditBalanceCents(db, 'cust-ana'), 2 * CAP);
  assert.equal(listCredits(db, 'cust-ana').length, 2);
});

test('§5: a damaged item over the threshold cannot be refunded, only escalated', () => {
  setTotal('1045', OVER + 100);
  const amount = (OVER + 100) / 100;
  const t = ana(['My expedition tent arrived with a torn rainfly. I want my money back.']);
  const r = t.run('issue_refund', { order_id: '1045', amount, reason: 'customer request' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'DAMAGE_REQUIRES_ESCALATION');
  assert.ok(r.message.includes(`is over ${formatDollars(OVER)}`), r.message);
  assert.equal(listRefunds(db, 'cust-ana').length, 0);
  const e = t.run('escalate_to_human', { order_id: '1045', summary: 'Tent arrived with torn rainfly' });
  assert.equal(e.ok, true);
  assert.equal(getOwnedOrder(db, 'cust-ana', '1045').status, 'ESCALATED');
  assert.equal(listEscalations(db, 'cust-ana').length, 1);
  const again = t.run('escalate_to_human', { order_id: '1045', summary: 'again' });
  assert.equal(again.error, 'ALREADY_ESCALATED');
  assert.equal(t.run('issue_refund', { order_id: '1045', amount, reason: 'x' }).error, 'ESCALATED');
});

test('§5: damage reason given by the model also blocks the refund', () => {
  setTotal('1045', OVER + 1);
  const r = ana(['refund order 1045 please']).run('issue_refund', { order_id: '1045', amount: (OVER + 1) / 100, reason: 'arrived damaged' });
  assert.equal(r.error, 'DAMAGE_REQUIRES_ESCALATION');
});

test('§5: an order over the threshold without damage can be refunded inside the window', () => {
  setTotal('1045', OVER + 100);
  setDelivered('1045', WINDOW);
  const r = ana(['I changed my mind about the tent, please refund order 1045']).run('issue_refund', {
    order_id: '1045',
    amount: (OVER + 100) / 100,
    reason: 'changed mind',
  });
  assert.equal(r.ok, true);
});

test('§5: damage on an order at the threshold follows §2; one cent over must be escalated', () => {
  setTotal('1043', OVER);
  setDelivered('1043', 0);
  const at = ana(['My trail running vest arrived ripped.']).run('issue_refund', { order_id: '1043', amount: OVER / 100, reason: 'arrived damaged' });
  assert.equal(at.ok, true);
  setTotal('1042', OVER + 1);
  setDelivered('1042', 0);
  const over = ana(['My hiking boots arrived damaged.']).run('issue_refund', { order_id: '1042', amount: (OVER + 1) / 100, reason: 'arrived damaged' });
  assert.equal(over.error, 'DAMAGE_REQUIRES_ESCALATION');
});

test('damage detection attributes reports to the right order', () => {
  const orders = [
    { id: '1043', item: 'Trail Running Vest' },
    { id: '1045', item: '4-Person Expedition Tent' },
  ];
  assert.equal(mentionsDamage("it's not damaged, I just don't want it"), false);
  assert.equal(mentionsDamage('the zipper is broken'), true);
  assert.equal(customerReportedDamage(orders[1], orders, ['My vest arrived damaged.', 'Also refund the tent, I changed my mind.']), false);
  assert.equal(customerReportedDamage(orders[1], orders, ['Something I ordered arrived broken.', 'It was the tent, order 1045.']), true);
  assert.equal(customerReportedDamage(orders[1], orders, ['It arrived broken']), true);
});
