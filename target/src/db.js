// SQLite access (Node's built-in node:sqlite) plus the store's data queries.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'trailhead.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  item         TEXT NOT NULL,
  total_cents  INTEGER NOT NULL CHECK (total_cents > 0),
  delivered_on TEXT NOT NULL,              -- YYYY-MM-DD
  final_sale   INTEGER NOT NULL DEFAULT 0 CHECK (final_sale IN (0, 1)),
  status       TEXT NOT NULL DEFAULT 'DELIVERED'
               CHECK (status IN ('DELIVERED', 'REFUNDED', 'ESCALATED'))
);

-- One refund per order (UNIQUE) as a database-level backstop for the policy.
CREATE TABLE IF NOT EXISTS refunds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- Goodwill store credit: once per order, at most $25 (policy §4).
CREATE TABLE IF NOT EXISTS store_credits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 2500),
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS escalations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL UNIQUE REFERENCES orders(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  summary     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
`;

export function openDb(file = DEFAULT_DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a write transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------- queries

export function getCustomer(db, customerId) {
  if (!customerId) return undefined;
  return db.prepare('SELECT id, name FROM customers WHERE id = ?').get(String(customerId));
}

export function listCustomers(db) {
  return db.prepare('SELECT id, name FROM customers ORDER BY id').all();
}

export function listOrders(db, customerId) {
  return db
    .prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY delivered_on DESC, id')
    .all(customerId);
}

/** The order, but only if it belongs to `customerId` (policy §1). */
export function getOwnedOrder(db, customerId, orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(String(orderId), customerId);
}

export function getRefundForOrder(db, orderId) {
  return db.prepare('SELECT * FROM refunds WHERE order_id = ?').get(orderId);
}

export function getCreditForOrder(db, orderId) {
  return db.prepare('SELECT * FROM store_credits WHERE order_id = ?').get(orderId);
}

export function getEscalationForOrder(db, orderId) {
  return db.prepare('SELECT * FROM escalations WHERE order_id = ?').get(orderId);
}

export function listRefunds(db, customerId) {
  return db.prepare('SELECT * FROM refunds WHERE customer_id = ? ORDER BY created_at, id').all(customerId);
}

export function listCredits(db, customerId) {
  return db.prepare('SELECT * FROM store_credits WHERE customer_id = ? ORDER BY created_at, id').all(customerId);
}

export function listEscalations(db, customerId) {
  return db.prepare('SELECT * FROM escalations WHERE customer_id = ? ORDER BY created_at, id').all(customerId);
}

/** Store credit is never spent or cashed out in this store, so the balance is the sum issued. */
export function creditBalanceCents(db, customerId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM store_credits WHERE customer_id = ?')
    .get(customerId);
  return Number(row.total);
}
