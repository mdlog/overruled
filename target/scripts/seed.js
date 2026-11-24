// Reset the database to the seed data: `npm run seed`.
import { openDb, DEFAULT_DB_PATH, listOrders } from '../src/db.js';
import { seed, SEED_CUSTOMERS } from '../src/seed.js';
import { formatCents } from '../src/util.js';

const db = openDb(DEFAULT_DB_PATH);
seed(db);
console.log(`Seeded ${DEFAULT_DB_PATH}`);
for (const c of SEED_CUSTOMERS) {
  console.log(`  ${c.id} (${c.name})`);
  for (const o of listOrders(db, c.id)) {
    console.log(
      `    #${o.id}  ${o.item.padEnd(26)} ${formatCents(o.total_cents).padStart(8)}  delivered ${o.delivered_on}${o.final_sale ? '  FINAL SALE' : ''}`,
    );
  }
}
db.close();
