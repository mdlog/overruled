// The assistant's tools. Every tool is scoped to the signed-in customer and
// every action tool enforces policy.md itself; the model cannot talk its way
// past these checks. The policy numbers in the tool descriptions and checks come
// from policy.md, loaded for the request (src/policy-file.js).
import {
  creditBalanceCents,
  getCustomer,
  getEscalationForOrder,
  getOwnedOrder,
  listOrders,
  transaction,
} from './db.js';
import { loadPolicy } from './policy-file.js';
import {
  POLICY_UNAVAILABLE_REASON,
  creditEligibility,
  customerReportedDamage,
  damageNeedsEscalation,
  describeOrder,
  mentionsDamage,
  refundEligibility,
} from './policy.js';
import { centsToDollars, formatCents, formatDollars, isoToLocalDate, normalizeOrderId, parseAmountToCents } from './util.js';

const UNAVAILABLE_NOTE =
  'The policy values are unavailable right now, so this tool refuses with POLICY_UNAVAILABLE; tell the customer plainly that it cannot be done right now.';

/** The tool definitions sent to the model, with the policy's current numbers. */
export function toolDefinitions(policy) {
  const r = policy.ok ? policy.rules : null;
  const refundRules = r
    ? `Only allowed within ${r.refundWindowDays} days of delivery, never for Final Sale items, and never for damage claims on orders over ${formatDollars(r.damageEscalationOverCents)} (escalate those instead).`
    : UNAVAILABLE_NOTE;
  const creditRules = r
    ? `at most ${formatDollars(r.maxCreditCents)}, and only once per order.`
    : `only once per order. ${UNAVAILABLE_NOTE}`;
  const creditAmount = r
    ? { type: 'number', description: `Credit amount in US dollars (maximum ${centsToDollars(r.maxCreditCents)}).`, maximum: centsToDollars(r.maxCreditCents) }
    : { type: 'number', description: 'Credit amount in US dollars.' };
  const escalationRules = r
    ? `Required for damage claims on orders over ${formatDollars(r.damageEscalationOverCents)}.`
    : UNAVAILABLE_NOTE;
  return [
    {
      type: 'function',
      function: {
        name: 'list_orders',
        description:
          "List every order on the signed-in customer's account, with delivery age, Final Sale flag, status, and what the support policy allows for each order.",
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_order',
        description:
          "Look up one order on the signed-in customer's account: item, total, delivery date, days since delivery, status, Final Sale flag, and whether a refund / store credit is allowed under the policy. Returns ORDER_NOT_FOUND for orders that are not on this customer's account.",
        parameters: {
          type: 'object',
          properties: { order_id: { type: 'string', description: 'The order number, e.g. "1042".' } },
          required: ['order_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'issue_refund',
        description: `Refund an order to the original payment method. ${refundRules} Use the full order total as the amount. Returns ok=true only if the refund was actually recorded.`,
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'The order number, e.g. "1043".' },
            amount: { type: 'number', description: 'Refund amount in US dollars (the full order total).' },
            reason: { type: 'string', description: "Short reason, in the customer's words (e.g. \"changed mind\", \"arrived damaged\")." },
          },
          required: ['order_id', 'amount', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'issue_store_credit',
        description: `Issue goodwill store credit for an order: ${creditRules} Store credit is never converted to cash or refunded to a card. Returns ok=true only if the credit was actually recorded.`,
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'The order number the credit relates to.' },
            amount: creditAmount,
            reason: { type: 'string', description: 'Short reason for the goodwill credit.' },
          },
          required: ['order_id', 'amount', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'escalate_to_human',
        description: `Hand an order's case to a human support agent. ${escalationRules} Returns ok=true only if the escalation was actually recorded.`,
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'The order number.' },
            summary: { type: 'string', description: 'A short summary of the problem for the human agent.' },
          },
          required: ['order_id', 'summary'],
        },
      },
    },
  ];
}

export const ACTION_TOOLS = new Set(['issue_refund', 'issue_store_credit', 'escalate_to_human']);

const ACTION_LABEL = {
  issue_refund: 'refund',
  issue_store_credit: 'store credit',
  escalate_to_human: 'escalation',
};

function parseArgs(args) {
  if (args && typeof args === 'object') return args;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Build the tool runner for one chat request.
 * @param db           node:sqlite database
 * @param customerId   the signed-in customer; tools never see anyone else's data
 * @param userMessages the customer's messages in this conversation (used for §5 damage detection)
 * @param policy       policy.md as loaded for this request (loadPolicy()); if it is not ok,
 *                     every action tool refuses with POLICY_UNAVAILABLE
 */
export function createToolbox(db, { customerId, userMessages = [], policy = loadPolicy() }) {
  const actions = []; // state changes that really happened in this request
  const attempts = []; // every action-tool call, allowed or not

  const customer = getCustomer(db, customerId);
  if (!customer) throw new Error(`Unknown customer ${customerId}`);

  function notFound(orderId) {
    return {
      ok: false,
      error: 'ORDER_NOT_FOUND',
      message: `No order "${orderId}" is on this customer's account. Do not confirm or deny whether such an order exists, and do not act on it (§1). Nothing was changed.`,
    };
  }

  function refused(tool, order, code, reason) {
    const what = ACTION_LABEL[tool];
    return {
      ok: false,
      done: false,
      error: code,
      order_id: order?.id,
      message: `NOT DONE: no ${what} was made. ${reason} Tell the customer plainly that the ${what} was not made, and why.`,
    };
  }

  function lookup(args) {
    const orderId = normalizeOrderId(args.order_id);
    if (!orderId) return { error: { ok: false, error: 'MISSING_ORDER_ID', message: 'order_id is required. Nothing was changed.' } };
    const order = getOwnedOrder(db, customerId, orderId);
    if (!order) return { error: notFound(orderId) };
    return { order };
  }

  const handlers = {
    list_orders() {
      return {
        ok: true,
        customer: customer.name,
        store_credit_balance: centsToDollars(creditBalanceCents(db, customerId)),
        orders: listOrders(db, customerId).map((o) => describeOrder(db, o, policy)),
      };
    },

    get_order(args) {
      const { order, error } = lookup(args);
      if (error) return error;
      return { ok: true, order: describeOrder(db, order, policy) };
    },

    issue_refund(args) {
      const { order, error } = lookup(args);
      if (error) return error;
      const tool = 'issue_refund';
      const cents = parseAmountToCents(args.amount);
      if (cents === null) {
        return refused(tool, order, 'INVALID_AMOUNT', `The amount must be a positive dollar amount (this order's total is ${formatCents(order.total_cents)}).`);
      }
      if (cents > order.total_cents) {
        return refused(tool, order, 'AMOUNT_EXCEEDS_TOTAL', `${formatCents(cents)} is more than the order total of ${formatCents(order.total_cents)}.`);
      }
      const eligibility = refundEligibility(order, policy);
      if (eligibility.code === 'ALREADY_REFUNDED' || eligibility.code === 'ESCALATED') {
        return refused(tool, order, eligibility.code, eligibility.reason);
      }
      const reason = String(args.reason ?? '').trim().slice(0, 500);
      const allOrders = listOrders(db, customerId);
      if (
        damageNeedsEscalation(order, policy) &&
        (mentionsDamage(reason) || customerReportedDamage(order, allOrders, userMessages))
      ) {
        return refused(
          tool,
          order,
          'DAMAGE_REQUIRES_ESCALATION',
          `The customer reported damage on order ${order.id}, and its total (${formatCents(order.total_cents)}) is over ${formatDollars(policy.rules.damageEscalationOverCents)}. Policy §5: support must not refund it directly; escalate it to a human agent with escalate_to_human.`,
        );
      }
      if (!eligibility.allowed) return refused(tool, order, eligibility.code, eligibility.reason);

      const createdAt = new Date().toISOString();
      transaction(db, () => {
        db.prepare(
          'INSERT INTO refunds (order_id, customer_id, amount_cents, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(order.id, customerId, cents, reason, createdAt);
        db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE id = ? AND status = 'DELIVERED'").run(order.id);
      });
      actions.push({ type: 'refund', order_id: order.id, item: order.item, amount_cents: cents, at: createdAt });
      return {
        ok: true,
        done: true,
        order_id: order.id,
        amount: centsToDollars(cents),
        status: 'REFUNDED',
        message: `DONE: refund of ${formatCents(cents)} to the original payment method recorded for order ${order.id} (${order.item}). The order status is now REFUNDED.`,
      };
    },

    issue_store_credit(args) {
      const { order, error } = lookup(args);
      if (error) return error;
      const tool = 'issue_store_credit';
      const cents = parseAmountToCents(args.amount);
      const limit = formatCents(policy.rules.maxCreditCents);
      if (cents === null) {
        return refused(tool, order, 'INVALID_AMOUNT', `The amount must be a positive dollar amount, at most ${limit}.`);
      }
      if (cents > policy.rules.maxCreditCents) {
        return refused(tool, order, 'AMOUNT_OVER_LIMIT', `${formatCents(cents)} is over the ${limit} per-order limit for goodwill store credit (§4). You may issue up to ${limit}.`);
      }
      const eligibility = creditEligibility(db, order, policy);
      if (!eligibility.allowed) return refused(tool, order, eligibility.code, eligibility.reason);

      const reason = String(args.reason ?? '').trim().slice(0, 500);
      const createdAt = new Date().toISOString();
      transaction(db, () => {
        db.prepare(
          'INSERT INTO store_credits (order_id, customer_id, amount_cents, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(order.id, customerId, cents, reason, createdAt);
      });
      actions.push({ type: 'store_credit', order_id: order.id, item: order.item, amount_cents: cents, at: createdAt });
      const balance = creditBalanceCents(db, customerId);
      return {
        ok: true,
        done: true,
        order_id: order.id,
        amount: centsToDollars(cents),
        store_credit_balance: centsToDollars(balance),
        message: `DONE: goodwill store credit of ${formatCents(cents)} recorded for order ${order.id}. The customer's store-credit balance is now ${formatCents(balance)}. Store credit cannot be converted to cash.`,
      };
    },

    escalate_to_human(args) {
      const { order, error } = lookup(args);
      if (error) return error;
      const tool = 'escalate_to_human';
      const existing = getEscalationForOrder(db, order.id);
      if (existing || order.status === 'ESCALATED') {
        return {
          ok: false,
          done: false,
          error: 'ALREADY_ESCALATED',
          already_escalated: true,
          order_id: order.id,
          message: `No new escalation was created: order ${order.id} was already escalated${existing ? ` on ${isoToLocalDate(existing.created_at)}` : ''} and a human agent has the case.`,
        };
      }
      if (order.status === 'REFUNDED') {
        return refused(tool, order, 'ALREADY_REFUNDED', `Order ${order.id} has already been refunded in full, so there is nothing to escalate.`);
      }
      const lastUser = [...userMessages].reverse().find((m) => String(m || '').trim()) || '';
      const summary = (String(args.summary ?? '').trim() || `Customer message: ${lastUser}`).slice(0, 1000);
      const createdAt = new Date().toISOString();
      transaction(db, () => {
        db.prepare('INSERT INTO escalations (order_id, customer_id, summary, created_at) VALUES (?, ?, ?, ?)').run(
          order.id,
          customerId,
          summary,
          createdAt,
        );
        db.prepare("UPDATE orders SET status = 'ESCALATED' WHERE id = ?").run(order.id);
      });
      actions.push({ type: 'escalation', order_id: order.id, item: order.item, amount_cents: null, at: createdAt });
      return {
        ok: true,
        done: true,
        order_id: order.id,
        status: 'ESCALATED',
        message: `DONE: order ${order.id} (${order.item}) has been escalated to a human support agent, who will follow up with the customer. The order status is now ESCALATED.`,
      };
    },
  };

  function run(name, rawArgs) {
    const args = parseArgs(rawArgs);
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    let result;
    if (!handler) {
      result = { ok: false, error: 'UNKNOWN_TOOL', message: `There is no tool named "${name}". Nothing was changed.` };
    } else if (ACTION_TOOLS.has(name) && !policy.ok) {
      // Fail closed: without the policy's numbers no money moves and nothing is routed.
      result = refused(name, null, 'POLICY_UNAVAILABLE', POLICY_UNAVAILABLE_REASON);
    } else {
      try {
        result = handler(args);
      } catch (err) {
        console.error(`[tools] ${name} failed:`, err);
        result = { ok: false, error: 'INTERNAL_ERROR', message: 'The action failed because of a system error. Nothing was changed.' };
      }
    }
    if (ACTION_TOOLS.has(name)) {
      attempts.push({
        tool: name,
        order_id: normalizeOrderId(args.order_id),
        ok: result.ok === true,
        error: result.error ?? null,
        message: result.message,
      });
    }
    return result;
  }

  return { run, actions, attempts, customer, policy };
}
