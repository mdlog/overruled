// Seed the target database as if it were seeded `offset` days ago, so every order
// is `offset` days older today (e.g. offset 10: the vest delivered 10 days ago is
// now 20 days old). Uses the target's own seed(); no target code is changed.
// Usage (from target/): node --experimental-sqlite ../spike/seed-at.mjs 10
import { openDb, DEFAULT_DB_PATH } from '../target/src/db.js';
import { seed } from '../target/src/seed.js';
const offset = Number(process.argv[2] || 0);
const now = new Date(); now.setDate(now.getDate() - offset);
const db = openDb(DEFAULT_DB_PATH);
seed(db, now);
db.close();
