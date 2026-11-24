# Overruled: the store acts on a rule its policy page no longer says

Operations edited `policy.md` (commit fcbbf44). No code changed. Kane then shopped as a customer through the real chat widget.

## What changed on the policy page
| Clause | Was | Now | Direction |
|---|---|---|---|
| §2 Refund window | 30 days | 60 days | loosen |

## What Kane saw as the customer (run_end.context.variables, recorded run evidence/kane/e2-run.ndjson)
Kane: **failed** (assertion_error.confirmed_product_bug). "Order 1042 was denied a full refund even though it was delivered 45 days ago and the support policy says full refunds are available for 60 days."
- `policy_page_window`: "A full refund to the original payment method is available within **60 days of delivery** (extended holiday returns)."
- `orders_page_copy`: "4 orders on this account. Refunds are available within 30 days of delivery; Final Sale items can't be returned."
- `delivered_1042`: "2026-10-10"
- `bot_window`: "The refund window is 60 days from the delivery date. If you'd like to process a refund for an eligible order, let me know the order number!"
- `bot_reply`: "The refund window for order 1042 (Alpine Hiking Boots) has passed, as it was delivered 45 days ago. Full refunds are only available within 30 days of delivery. However, I can issue goodwill store credit of up to $25 for this order. Would you like to proceed with store credit instead?"
- `order_status`: "DELIVERED"
- `refund_rows`: "0"
Evidence pack: `evidence/kane/e2-pack/b089bcc1-8547-49a5-a4d5-11d73186c7fd.evidence`. Gate verdict: fail (no-failed-tests, all-pass).

## Every source line that still restates the old number (4)
- `src/assistant.js:107` [prompt] - §2: Within 30 days of delivery, a refund is for the full order total (call issue_refund). After 30 days, no refund. Offer goodwill store credit instead.
- `src/policy.js:11` [constant] refundWindowDays: 30, // §2
- `src/tools.js:50` [code] 'Refund an order to the original payment method. Only allowed within 30 days of delivery, never for Final Sale items, and never for damage claims on orders over
- `src/views.js:118` [page-copy] <p class="lede">${orders.length} ${orders.length === 1 ? 'order' : 'orders'} on this account. Refunds are available within 30 days of delivery; Final Sale items

## Source lines that restate the other policy numbers (contract item 2 covers these too)
- `src/assistant.js:109` [prompt] §4 $25: - §4: Goodwill store credit is at most $25 per order, once per order, and is never turned into cash or a card refund. Offer it when a refund isn't possible. Iss
- `src/assistant.js:110` [prompt] §5 $200: - §5: If the customer says an item arrived damaged and the order total is over $200, call escalate_to_human with a short summary. Do not refund it. Damage on or
- `src/db.js:42` [db-check] §4 $25: amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 2500),
- `src/policy.js:12` [constant] §4 $25: maxCreditCents: 2500, // §4
- `src/policy.js:13` [constant] §5 $200: damageEscalationOverCents: 20000, // §5: "over $200"
- `src/policy.js:46` [refusal] §5 $200: reason: `Delivered ${days} days ago, within the ${RULES.refundWindowDays}-day window (§2): a full refund of ${formatCents(order.total_cents)} is allowed, unless
- `src/policy.js:69` [code] §5 $200: ? `Total is over $200: a damage claim on this order must be escalated with escalate_to_human. It must not be refunded directly (§5).`
- `src/policy.js:70` [code] §5 $200: : `Total is $200 or less: a damage claim on this order follows the normal refund rules (§2, §3).`;
- `src/tools.js:50` [code] §5 $200: 'Refund an order to the original payment method. Only allowed within 30 days of delivery, never for Final Sale items, and never for damage claims on orders over
- `src/tools.js:67` [code] §4 $25: 'Issue goodwill store credit for an order: at most $25, and only once per order. Store credit is never converted to cash or refunded to a card. Returns ok=true 
- `src/tools.js:72` [tool-schema] §4 $25: amount: { type: 'number', description: 'Credit amount in US dollars (maximum 25).' },
- `src/tools.js:84` [code] §5 $200: "Hand an order's case to a human support agent. Required for damage claims on orders over $200. Returns ok=true only if the escalation was actually recorded.",
- `src/tools.js:199` [code] §5 $200: `The customer reported damage on order ${order.id}, and its total (${formatCents(order.total_cents)}) is over $200. Policy §5: support must not refund it direct
- `src/tools.js:228` [refusal] §4 $25: return refused(tool, order, 'INVALID_AMOUNT', 'The amount must be a positive dollar amount, at most $25.00.');
- `src/tools.js:231` [refusal] §4 $25: return refused(tool, order, 'AMOUNT_OVER_LIMIT', `${formatCents(cents)} is over the $25.00 per-order limit for goodwill store credit (§4). You may issue up to $

## Tests that assert the old rule (your suite is green: 32 pass)
- `test/app.test.js:116` say("I'm sorry, I couldn't refund order 1042: it was delivered 45 days ago, outside the 30-day refund window. I can offer a $25 store credit instead."),
- `test/claims.test.js:44` 'A full refund is available within 30 days of delivery.',
- `test/claims.test.js:109` const attempts = [{ tool: 'issue_refund', order_id: '1042', ok: false, message: 'NOT DONE: no refund was made. Delivered 45 days ago. Full refunds are only avai
- `test/tools.test.js:47` test('§2: refund inside 30 days succeeds and is recorded; a second refund is refused', () => {
- `test/tools.test.js:60` test('§2: refund after 30 days is refused', () => {

## What done looks like
1. Add exactly one fenced block to policy.md, right after the version line, opened with ```policy-values and holding these keys with the values the prose states today: refund_window_days, goodwill_credit_max_usd, damage_escalation_over_usd (one `key: number` per line). Do not change any prose in policy.md.
2. Read those values at request time from policy.md (the same file the /policy page renders) through one module. No source file may restate a policy number: not in constants, the assistant's rule summary, tool descriptions or JSON schemas, refusal messages, page copy, or the database schema. Build every such text from the values. `node ../cli/bin/overruled.mjs sites policy.md . --residual` must exit 0.
3. Fail closed. If the block is missing, cannot be parsed, or a value disagrees with the number the prose states in its clause, every money-moving or routing action (issue_refund, issue_store_credit, escalate_to_human) refuses with code POLICY_UNAVAILABLE and the customer is told plainly that it can't be done right now. Never fall back to a built-in default.
4. Remove the database CHECK that caps store credit at a fixed amount, through a migration that also works on an existing database file; the credit tool enforces the cap from the block.
5. Tests take policy numbers from policy.md instead of hard-coding them, and cover: each rule follows the block; changing the block and the prose together changes behaviour with no code change; each fail-closed case. `npm test` passes.
6. The customer-facing copy on /orders and the assistant's rule summary show the current values.

Work only inside this directory. Do not edit the prose of `policy.md`, the seed data, or anything outside the app. Do not run git. When you finish, say in two lines what you changed.
