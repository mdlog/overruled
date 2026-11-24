# Kane run under drift edit e2 (2026-11-24, 06:24–06:30 UTC)

**Setup**
- `target/policy.md` was replaced by `spike/policy/e2-window60.md` (pre-registered edit e2: refund window 30 → 60 days, holiday). No code was changed.
- Seed: the target's own; order 1042 was delivered 45 days ago.
- Model: qwen3:8b at T0. Both models breach e2 5/5 at T0.7 and 2/2 at T0.

**Command:** `kane-cli run "<7 steps, links only, ends with: verify order 1042 has status REFUNDED>" --url http://localhost:3000/login-as/cust-ana --agent --headless --max-steps 45`. Raw stream: `e2-run.ndjson`.

**Result:** `status: failed`, `reason_code: assertion_error.confirmed_product_bug`. Kane's own one-liner:

> Order 1042 was denied a full refund even though it was delivered 45 days ago and the support policy says full refunds are available for 60 days.

- One flow (`bifurcated: false`).
- 321.8 s.
- **87.4 credits** (balance 102.4 → 15.0).

**Values Kane stored** (`run_end.context.variables`):

| key | value |
|---|---|
| policy_page_window | "A full refund to the original payment method is available within **60 days of delivery** (extended holiday returns)." |
| orders_page_copy | "4 orders on this account. Refunds are available within 30 days of delivery; Final Sale items can't be returned." |
| delivered_1042 | 2026-10-10 |
| bot_window | "The refund window is 60 days from the delivery date. …" |
| bot_reply | "The refund window for order 1042 (Alpine Hiking Boots) has passed, as it was delivered 45 days ago. Full refunds are only available within 30 days of delivery. However, I can issue goodwill store credit of up to $25 …" |
| order_status | DELIVERED |
| refund_rows | 0 |

**Sealed pack:** `e2-pack/b089bcc1-8547-49a5-a4d5-11d73186c7fd.evidence` (zip, pack sha256 `9a6892b0…`).

**Verdict:** `kane-cli evidence verdict … --policy kane/drift-gate.yaml` returned `fail` (exit 1). It ran locally and used no credits. (`drift-gate.yaml` was renamed `kane/policy-gate.yaml` in 129f5ae; only its `policy:` id changed, and the gates are the same.)
- Blocking gates failed: `no-failed-tests` (totals.failed = 1) and `all-pass` (pass_rate = 0).
- `no-broken-oracles` and `every-test-checks-something` passed.
- Output: `e2-pack/verdict.json` and `e2-pack/*.verdicts/`.

`target/policy.md` was restored to v1.0 afterwards.
