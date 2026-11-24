# Kane green after the fix (reduced plan)

**Result: `passed`.** Kane signed in as Ana and read `/orders`:
- Order 1042 is REFUNDED.
- The page says refunds are available within 60 days.
- The old copy (30 days), used as a negative control, is judged false.

| Condition | Expected | Kane | Read on the page |
|---|---|---|---|
| Order 1042 has status REFUNDED. | true | **true** | `REFUNDED` |
| The text near the top of the page says refunds are available within 60 days of delivery. | true | **true** | "4 orders on this account. Refunds are available within 60 days of delivery; …" |
| The text near the top of the page says refunds are available within 30 days of delivery. | false | **false** | (same sentence) |

## Why it is shaped like this
Only 15.03 credits were left. The red run (`../e2-run.md`) was a 26-step agent run and cost 87.4. So the run was split:

1. **The conversation ran in the probe (labelled).** It used `spike/probe.mjs` → `/api/chat`, the endpoint the chat widget posts to: qwen3:8b at temperature 0, seed 1, under the e2 policy (60 days).
   - Reply 1: "Our refund window is **60 days from delivery**".
   - Reply 2: "Your refund of **$129.00** for order **1042** … has been processed".
   - Record: `after-edit-e2_qwen3_8b_T0.jsonl`, `probe.log`.
2. **Free pre-check.** curl read `/orders` (`orders-after-probe.html`, `precheck.json`). No credits would have been spent if 1042 had not been REFUNDED.
3. **Kane, `--analyzer-only`.** There were no agent steps and no evidence pack. One verdict per condition is written on `run_end`. It took 12.8 s and cost **5.12 credits**: the balance went from 15.0282 (`balance-before.txt`) to 9.9051 (`balance-after.txt`).

The command is in `../../../kane/green-read.sh`.

## Notes
- The CLI prints `info: --analyzer-only ignores --url` (`run.stderr`). Kane's own session log still records `RUN 0 START … url=http://localhost:3000/login-as/cust-ana` (`session-tui.log`), and the text Kane extracted is the store's `/orders` page as Ana sees it after the fix. `/login-as/cust-ana` sets the session cookie and redirects to `/orders`.
- `session-tui.log` is copied from `~/.testmuai/kaneai/sessions/345bdb92-…/` with the account username masked.
- Before this run, the code under `target/src` and `target/public` was unchanged since the fix commit 5652674 (0 lines, `context.txt`).
