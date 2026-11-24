// The support policy's rules, applied to orders. The numbers come from policy.md
// (src/policy-file.js), read for each request: every rule here takes that
// `policy` ({ ok, rules }). The assistant's action tools call these checks, so the
// policy holds even when the model gets it wrong.
import {
  getCreditForOrder,
  getEscalationForOrder,
  getRefundForOrder,
} from './db.js';
import { centsToDollars, daysSince, formatCents, formatDollars, isoToLocalDate, localDateString } from './util.js';

/** What the customer is told when policy.md's values can't be used. */
export const POLICY_UNAVAILABLE_REASON =
  "Refunds, store credit and escalations can't be done right now, because the store's support policy could not be loaded. Please try again later.";

/** §2 / §3 refund eligibility, ignoring damage (handled by §5 separately). */
export function refundEligibility(order, policy, today = localDateString()) {
  const days = daysSince(order.delivered_on, today);
  if (order.status === 'REFUNDED') {
    return { allowed: false, code: 'ALREADY_REFUNDED', reason: 'This order has already been refunded.' };
  }
  if (order.status === 'ESCALATED') {
    return {
      allowed: false,
      code: 'ESCALATED',
      reason: 'This order has been escalated to a human agent, who now handles it. Support cannot refund it directly.',
    };
  }
  if (order.final_sale) {
    return {
      allowed: false,
      code: 'FINAL_SALE',
      reason: 'This is a Final Sale (clearance) item. It cannot be refunded or exchanged at any time (§3).',
    };
  }
  if (!policy.ok) return { allowed: false, code: 'POLICY_UNAVAILABLE', reason: POLICY_UNAVAILABLE_REASON };
  const { refundWindowDays } = policy.rules;
  if (days > refundWindowDays) {
    return {
      allowed: false,
      code: 'OUTSIDE_REFUND_WINDOW',
      reason: `Delivered ${days} days ago. Full refunds are only available within ${refundWindowDays} days of delivery (§2). Goodwill store credit may be offered instead (§4).`,
    };
  }
  const damageCaveat = damageNeedsEscalation(order, policy)
    ? `, unless this is a damage claim on an order over ${formatDollars(policy.rules.damageEscalationOverCents)} (§5)`
    : '';
  return {
    allowed: true,
    code: 'ELIGIBLE',
    reason: `Delivered ${days} days ago, within the ${refundWindowDays}-day window (§2): a full refund of ${formatCents(order.total_cents)} is allowed${damageCaveat}.`,
  };
}

/** §4 goodwill store credit eligibility. */
export function creditEligibility(db, order, policy) {
  const existing = getCreditForOrder(db, order.id);
  if (existing) {
    return {
      allowed: false,
      code: 'CREDIT_ALREADY_ISSUED',
      reason: `Goodwill store credit of ${formatCents(existing.amount_cents)} was already issued for this order on ${isoToLocalDate(existing.created_at)}. It can only be issued once per order (§4).`,
    };
  }
  if (!policy.ok) return { allowed: false, code: 'POLICY_UNAVAILABLE', reason: POLICY_UNAVAILABLE_REASON };
  return {
    allowed: true,
    code: 'CREDIT_AVAILABLE',
    reason: `Goodwill store credit of up to ${formatCents(policy.rules.maxCreditCents)} may be issued, once for this order (§4).`,
  };
}

/** §5: would a damage claim on this order have to be escalated instead of refunded? */
export function damageNeedsEscalation(order, policy) {
  return order.total_cents > policy.rules.damageEscalationOverCents;
}

export function damageRule(order, policy) {
  if (!policy.ok) return POLICY_UNAVAILABLE_REASON;
  const limit = formatDollars(policy.rules.damageEscalationOverCents);
  return damageNeedsEscalation(order, policy)
    ? `Total is over ${limit}: a damage claim on this order must be escalated with escalate_to_human. It must not be refunded directly (§5).`
    : `Total is ${limit} or less: a damage claim on this order follows the normal refund rules (§2, §3).`;
}

/** Everything the model needs to know about one order, computed from the database and the policy. */
export function describeOrder(db, order, policy, today = localDateString()) {
  const refund = getRefundForOrder(db, order.id);
  const credit = getCreditForOrder(db, order.id);
  const escalation = getEscalationForOrder(db, order.id);
  const refundCheck = refundEligibility(order, policy, today);
  const creditCheck = creditEligibility(db, order, policy);
  return {
    order_id: order.id,
    item: order.item,
    total: centsToDollars(order.total_cents),
    total_display: formatCents(order.total_cents),
    delivered_on: order.delivered_on,
    days_since_delivery: daysSince(order.delivered_on, today),
    status: order.status,
    final_sale: Boolean(order.final_sale),
    refund_issued: refund
      ? { amount: centsToDollars(refund.amount_cents), date: isoToLocalDate(refund.created_at) }
      : null,
    store_credit_issued: credit
      ? { amount: centsToDollars(credit.amount_cents), date: isoToLocalDate(credit.created_at) }
      : null,
    escalated: escalation ? { date: isoToLocalDate(escalation.created_at), summary: escalation.summary } : null,
    refund_allowed: refundCheck.allowed,
    refund_rule: refundCheck.reason,
    store_credit_allowed: creditCheck.allowed,
    store_credit_max: policy.ok ? centsToDollars(policy.rules.maxCreditCents) : null,
    store_credit_rule: creditCheck.reason,
    damage_claim_rule: damageRule(order, policy),
  };
}

// ------------------------------------------------------------ damage (§5)

const DAMAGE_RE =
  /\b(damag\w*|broken|broke|breaks|torn|tear|tears|ripped|rip|rips|cracked|cracks?|defect\w*|faulty|shattered|dented|dents?|smashed|crushed|bent|snapped|leak\w*|holes?|punctur\w*|busted|destroyed|ruined|frayed|missing (?:parts?|pieces?|poles?|stakes?)|doesn'?t work|does not work|not working|stopped working|fell apart|falling apart|came apart|unusable|mou?ld(?:y|ed)?|stain(?:s|ed)?)\b/gi;
const NEGATED_DAMAGE_RE = /\b(not|no|never|nothing|without|isn'?t|wasn'?t|aren'?t|weren'?t|didn'?t|hasn'?t|haven'?t)\b(\W+\w+){0,2}\W*$/i;

/** True if `text` reports damage (ignores "not damaged", "nothing is broken", ...). */
export function mentionsDamage(text) {
  if (!text) return false;
  const s = String(text).replace(/[’‘]/g, "'");
  for (const m of s.matchAll(DAMAGE_RE)) {
    const before = s.slice(Math.max(0, m.index - 30), m.index);
    if (!NEGATED_DAMAGE_RE.test(before)) return true;
  }
  return false;
}

function itemKeywordRe(item) {
  const words = String(item).toLowerCase().match(/[a-z]+/g) || [];
  const noun = words[words.length - 1] || '';
  const stem = noun.endsWith('s') ? noun.slice(0, -1) : noun;
  return stem ? new RegExp(`\\b${stem}s?\\b`, 'i') : null;
}

/** Which of `orders` a piece of text refers to, by order id or item noun ("tent", "boots"). */
export function ordersMentioned(text, orders) {
  const s = String(text || '');
  const found = [];
  for (const o of orders) {
    const idRe = new RegExp(`(?<![\\d.,])${o.id}(?![\\d])`);
    const kw = itemKeywordRe(o.item);
    if (idRe.test(s) || (kw && kw.test(s))) found.push(o.id);
  }
  return found;
}

/**
 * Has the customer (in this conversation) reported damage on `order`?
 * Damage sentences are attributed to the orders they mention; a damage report that
 * names no order is attributed to the orders named in the same message, then the
 * next or previous customer message, and failing that to every order (conservative).
 */
export function customerReportedDamage(order, orders, userMessages) {
  const msgs = userMessages.map((m) => String(m || ''));
  for (let i = 0; i < msgs.length; i++) {
    const sentences = msgs[i].split(/(?<=[.!?])\s+|\n+/);
    for (const sentence of sentences) {
      if (!mentionsDamage(sentence)) continue;
      let refs = ordersMentioned(sentence, orders);
      if (!refs.length) refs = ordersMentioned(msgs[i], orders);
      if (!refs.length && i + 1 < msgs.length) refs = ordersMentioned(msgs[i + 1], orders);
      if (!refs.length && i > 0) refs = ordersMentioned(msgs[i - 1], orders);
      if (!refs.length) return true; // unattributed damage report: be conservative
      if (refs.includes(order.id)) return true;
    }
  }
  return false;
}
