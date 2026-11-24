# Trailhead Supply

A small outdoor-gear store with an AI customer-support assistant. It uses Node.js 22, Express, SQLite (Node's built-in `node:sqlite`) and server-rendered HTML with a little vanilla JS. The assistant is a local model running through [Ollama](https://ollama.com) with tool calling.

## Run

```bash
ollama pull qwen3:8b        # once; any tool-capable model works (see OLLAMA_MODEL)
npm install && npm start    # http://localhost:3000
```

**The database is reset to the seed data on every start**, so delivery dates stay relative to today. Set `KEEP_DB=1` to keep existing data, or run `npm run seed` to reset it by hand. The data lives in `data/trailhead.db`.

## Seed customers

There is no real login. Open `/login-as/<customerId>`, which sets a cookie and redirects to `/orders`.

| Customer | Sign in | Orders (delivered N days ago) |
|---|---|---|
| Ana Lima | [`/login-as/cust-ana`](http://localhost:3000/login-as/cust-ana) | `1042` Alpine Hiking Boots $129 (45d) · `1043` Trail Running Vest $68 (10d) · `1044` Clearance Down Jacket $90, **Final Sale** (5d) · `1045` 4-Person Expedition Tent $340 (3d) |
| Ben Okafor | [`/login-as/cust-ben`](http://localhost:3000/login-as/cust-ben) | `2001` Ultralight Sleeping Bag $210 (12d) |

## Pages

- `/orders`: order id, item, total, delivery date, days since delivery, status (`DELIVERED` / `REFUNDED` / `ESCALATED`), Final Sale.
- `/account/ledger`: refunds and store credits (order id, amount, date), plus the store-credit balance.
- `/policy`: the support policy (`policy.md`).
- Every page has the support chat. It does not stream. The assistant bubble appears only when the full reply has arrived, and it carries `data-reply-complete="true"`. The conversation history is kept in the page and sent with each message.

## Chat API

`POST /api/chat` (needs the sign-in cookie)

```json
{ "messages": [{ "role": "user", "content": "Can I return order 1043?" }], "seed": 42 }
```

`seed` is optional and is passed to Ollama's `options.seed`. Only `user` and `assistant` text messages from the client are used; system and tool turns come only from the server. The response looks like this:

```json
{
  "reply": "…",
  "message": { "role": "assistant", "content": "…" },
  "actions": [{ "type": "refund", "order_id": "1043", "amount": 68, "description": "…" }],
  "tool_calls": [{ "name": "issue_refund", "arguments": { }, "result": { "ok": true } }],
  "verification": { "corrections": 0, "sanitized": false, "problems": [] },
  "model": "qwen3:8b"
}
```

Tools: `list_orders`, `get_order(order_id)`, `issue_refund(order_id, amount, reason)`, `issue_store_credit(order_id, amount, reason)` and `escalate_to_human(order_id, summary)`. All of them act on the real database and are scoped to the signed-in customer.

## How the policy is enforced

1. **Prompt.** The system prompt includes `policy.md` word for word, plus a fresh account snapshot with days since delivery and what is allowed for each order.
2. **Tools.** The tools enforce the policy in code: ownership (§1), the 30-day window (§2), Final Sale (§3), $25 once per order (§4), and no direct refund for damage claims over $200 (§5). The §5 check looks at the customer's own messages, so a refund is blocked even if the model leaves "damaged" out of the reason. Database constraints back these up.
3. **Honest confirmations (§6).** Before a reply is returned, `src/claims.js` checks every "refunded / credited / escalated / I'll do it now" statement against the database. It also checks that real actions are mentioned. If anything doesn't match, the draft goes back to the model with the specific problem (at most twice). After that, the false sentences are removed and a factual statement of what really happened is added.

## Configuration

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `OLLAMA_MODEL` | `qwen3:8b` |
| `OLLAMA_TEMPERATURE` | `0` |
| `OLLAMA_URL` | `http://localhost:11434/api/chat` |
| `OLLAMA_NUM_CTX` | `8192` |
| `OLLAMA_THINK` | unset (model default); `true` / `false` / `low` / `medium` / `high` |
| `OLLAMA_TIMEOUT_MS` | `300000` |
| `KEEP_DB` | unset (reseed on start); `1` keeps data |
| `DB_PATH` | `data/trailhead.db` |

## Tests

```bash
npm test
```

The tests cover the policy rules in the tools, the claim checker, and the HTTP routes and chat loop. They use a scripted fake Ollama, so no model is needed.
