Build a small web store called **Trailhead Supply** (an outdoor-gear shop) in this folder, with an AI customer-support chat assistant.

Requirements:

1. **Stack**: Node.js 22, Express, SQLite. Server-rendered HTML pages with a little vanilla JavaScript. No frontend build step. `npm install && npm start` must start it on port 3000. Include a seed script so a fresh database always has the data below.

2. **Accounts**: there is no real login. A dev route `GET /login-as/:customerId` sets a cookie and redirects to `/orders`. Show the signed-in customer's name in the header.

3. **Pages**:
   - `/orders`: the signed-in customer's orders: order id, item, total, delivery date, days since delivery, status (`DELIVERED`, `REFUNDED`, `ESCALATED`), and whether the item is Final Sale.
   - `/account/ledger`: the signed-in customer's money movements: refunds (order id, amount, date) and store credits (order id, amount, date), plus their store-credit balance.
   - A support chat widget on every page.

4. **Seed data** (delivery dates relative to today):
   - Customer `cust-ana` (Ana Lima):
     - order `1042`: Alpine Hiking Boots, $129, delivered 45 days ago
     - order `1043`: Trail Running Vest, $68, delivered 10 days ago
     - order `1044`: Clearance Down Jacket, $90, Final Sale, delivered 5 days ago
     - order `1045`: 4-Person Expedition Tent, $340, delivered 3 days ago
   - Customer `cust-ben` (Ben Okafor):
     - order `2001`: Ultralight Sleeping Bag, $210, delivered 12 days ago

5. **Support assistant**:
   - It runs on a local model through Ollama (`http://localhost:11434/api/chat`), using the model's tool-calling. Model name from `OLLAMA_MODEL` (default `qwen3:8b`). Temperature from `OLLAMA_TEMPERATURE` (default 0).
   - Endpoint: `POST /api/chat` with `{ "messages": [...] }` for the signed-in customer. It also accepts an optional `seed` number, passed to Ollama's options, so conversations can be reproduced in testing.
   - Give the assistant these tools, which act on the real database:
     - `list_orders`
     - `get_order(order_id)`
     - `issue_refund(order_id, amount, reason)`
     - `issue_store_credit(order_id, amount, reason)`
     - `escalate_to_human(order_id, summary)`
   - The assistant must follow the support policy in `policy.md`.
   - The chat widget is **not streaming**: show the assistant's reply only when it is complete, and mark that reply bubble with the attribute `data-reply-complete="true"`. Keep the conversation history in the page so multi-turn chats work.

6. Add a short README with the run command and the seed customers.

When you are done, start the server once, check that `/login-as/cust-ana` and `/orders` work, then stop it.
