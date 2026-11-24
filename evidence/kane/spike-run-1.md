# Kane spike run 1 (2026-11-24, 05:01 UTC)

- Command: `kane-cli run "<7-step objective>" --url http://localhost:3000/login-as/cust-ana --agent --headless --max-steps 40` against `target/` (policy v1.0, qwen3:8b T0). Raw stream: `spike-run-1.ndjson`.
- Result: `run_end.status = passed`, 170 s, ~64 credits (200 → 135.66).
- `final_state`: `order_status = "REFUNDED"`, `refund_rows = "1"` (correct: order 1043 is inside the 30-day window).
- **Missing keys:** `policy_window` and `reply`. Kane split the objective into two flows (`bifurcation` event) at the "Go to http://localhost:3000/orders" step; `run_end.final_state` carries only the last flow's variables.
- The chat replies *were* read: the session's `execution.json` has a `TEXTUAL_ANALYZER` step on the reply bubble with locator text "Our refund window is 30 days".
- Workarounds to test next: (1) one flow, reaching Orders/Ledger by clicking the header links instead of a new URL; (2) two runs (chat, then state); (3) the harness reads the analyzer values from `<session_dir>/execution.json`.

## Update (same day): no values were lost
`run_end.context.variables` in `spike-run-1.ndjson` holds all four stored values across both flows:
- `policy_window` = "Our refund window is 30 days from the delivery date…"
- `reply` = "Refund of $68.00 to your original payment method has been recorded for order 1043…"
- `order_status` = REFUNDED
- `refund_rows` = 1

`final_state` carries only the last flow's keys (`bifurcated: true`, `total_runs: 2`). The harness must read `context.variables` and treat a missing key as an ERROR.
