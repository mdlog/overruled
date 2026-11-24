// Customer-visible state of the Trailhead Supply target, read from its own markup:
//   /orders          -> <tr data-order-id> ... <span data-status="DELIVERED|REFUNDED|ESCALATED">
//   /account/ledger  -> #refunds-table / #store-credits-table rows <tr data-order-id data-amount-cents>
export function parseState(ordersHtml, ledgerHtml) {
  const orders = {};
  for (const m of ordersHtml.matchAll(/<tr data-order-id="([^"]+)"[\s\S]*?data-status="([^"]+)"/g)) {
    orders[m[1]] = { status: m[2] };
  }
  const ledger = [];
  const table = (id, kind) => {
    const t = ledgerHtml.match(new RegExp(`<table[^>]*id="${id}"[\\s\\S]*?</table>`));
    if (!t) return;
    for (const r of t[0].matchAll(/<tr data-order-id="([^"]+)" data-amount-cents="(\d+)"/g)) {
      ledger.push({ kind, order: r[1], amount: Number(r[2]) / 100 });
    }
  };
  table('refunds-table', 'refund');
  table('store-credits-table', 'credit');
  return { orders, ledger };
}
