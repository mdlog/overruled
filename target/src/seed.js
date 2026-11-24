// Seed data. Delivery dates are relative to "today" at seed time.
import { transaction } from './db.js';
import { daysAgo } from './util.js';

export const SEED_CUSTOMERS = [
  { id: 'cust-ana', name: 'Ana Lima' },
  { id: 'cust-ben', name: 'Ben Okafor' },
];

export const SEED_ORDERS = [
  { id: '1042', customer_id: 'cust-ana', item: 'Alpine Hiking Boots', total_cents: 12900, days_ago: 45, final_sale: 0 },
  { id: '1043', customer_id: 'cust-ana', item: 'Trail Running Vest', total_cents: 6800, days_ago: 10, final_sale: 0 },
  { id: '1044', customer_id: 'cust-ana', item: 'Clearance Down Jacket', total_cents: 9000, days_ago: 5, final_sale: 1 },
  { id: '1045', customer_id: 'cust-ana', item: '4-Person Expedition Tent', total_cents: 34000, days_ago: 3, final_sale: 0 },
  { id: '2001', customer_id: 'cust-ben', item: 'Ultralight Sleeping Bag', total_cents: 21000, days_ago: 12, final_sale: 0 },
];

/** Wipe every table and insert the seed data. */
export function seed(db, now = new Date()) {
  transaction(db, () => {
    db.exec(`
      DELETE FROM escalations;
      DELETE FROM store_credits;
      DELETE FROM refunds;
      DELETE FROM orders;
      DELETE FROM customers;
      DELETE FROM sqlite_sequence WHERE name IN ('escalations', 'store_credits', 'refunds');
    `);
    const insertCustomer = db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)');
    for (const c of SEED_CUSTOMERS) insertCustomer.run(c.id, c.name);

    const insertOrder = db.prepare(
      `INSERT INTO orders (id, customer_id, item, total_cents, delivered_on, final_sale, status)
       VALUES (?, ?, ?, ?, ?, ?, 'DELIVERED')`,
    );
    for (const o of SEED_ORDERS) {
      insertOrder.run(o.id, o.customer_id, o.item, o.total_cents, daysAgo(o.days_ago, now), o.final_sale);
    }
  });
}
