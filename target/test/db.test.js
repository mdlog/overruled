// The store-credit cap is policy (policy.md §4), not schema: a migration removes the
// old fixed CHECK from existing database files and keeps their data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, listCredits, openDb } from '../src/db.js';
import { RULES } from './policy-fixture.js';

const CAP = RULES.maxCreditCents; // the cap older files fixed in their schema

const storeCreditsSql = (db) =>
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'store_credits'").get().sql;
const userVersion = (db) => Number(db.prepare('PRAGMA user_version').get().user_version);
const insertCredit = (db, id, orderId, cents) =>
  db
    .prepare('INSERT INTO store_credits (id, order_id, customer_id, amount_cents, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, orderId, 'cust-old', cents, 'goodwill', '2026-01-02T03:04:05.000Z');

/** A database file as the previous version of the app created it. */
function oldDatabaseFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trailhead-db-'));
  const file = path.join(dir, 'trailhead.db');
  const old = new DatabaseSync(file);
  old.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), item TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents > 0), delivered_on TEXT NOT NULL,
      final_sale INTEGER NOT NULL DEFAULT 0 CHECK (final_sale IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'DELIVERED' CHECK (status IN ('DELIVERED', 'REFUNDED', 'ESCALATED'))
    );
    CREATE TABLE refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id), amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE store_credits (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     TEXT NOT NULL UNIQUE REFERENCES orders(id),
      customer_id  TEXT NOT NULL REFERENCES customers(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= ${CAP}),
      reason       TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL
    );
    CREATE TABLE escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      customer_id TEXT NOT NULL REFERENCES customers(id), summary TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO customers VALUES ('cust-old', 'Old Customer');
    INSERT INTO orders (id, customer_id, item, total_cents, delivered_on) VALUES
      ('9001', 'cust-old', 'Camp Stove', 9900, '2026-01-01'),
      ('9002', 'cust-old', 'Headlamp', 4500, '2026-01-01'),
      ('9003', 'cust-old', 'Trekking Poles', 7900, '2026-01-01');
  `);
  insertCredit(old, 7, '9001', CAP);
  assert.throws(() => insertCredit(old, 8, '9002', CAP + 1), /CHECK constraint failed/, 'the old file caps credit in its schema');
  old.close();
  return { dir, file };
}

test('migration removes the fixed store-credit cap from an existing database file and keeps its rows', () => {
  const { dir, file } = oldDatabaseFile();
  try {
    const db = openDb(file);
    assert.doesNotMatch(storeCreditsSql(db), /amount_cents\s*</);
    assert.equal(userVersion(db), SCHEMA_VERSION);
    assert.deepEqual(
      listCredits(db, 'cust-old').map((c) => [c.id, c.order_id, c.amount_cents, c.reason, c.created_at]),
      [[7, '9001', CAP, 'goodwill', '2026-01-02T03:04:05.000Z']],
    );

    insertCredit(db, 8, '9002', CAP + 1); // the cap now comes from policy.md, enforced by issue_store_credit
    assert.throws(() => insertCredit(db, 9, '9001', 100), /UNIQUE/, 'still once per order');
    assert.throws(() => insertCredit(db, 10, '9003', 0), /CHECK/, 'still a positive amount');
    assert.throws(() => insertCredit(db, 11, 'nope', 100), /FOREIGN KEY/, 'foreign keys still enforced');
    const next = db
      .prepare("INSERT INTO store_credits (order_id, customer_id, amount_cents, created_at) VALUES ('9003', 'cust-old', 100, 'x') RETURNING id")
      .get();
    assert.ok(next.id > 8, 'AUTOINCREMENT carries on after the existing ids');
    db.close();

    const again = openDb(file); // opening an already migrated file changes nothing
    assert.equal(userVersion(again), SCHEMA_VERSION);
    assert.equal(listCredits(again, 'cust-old').length, 3);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a new database has no fixed store-credit cap', () => {
  const db = openDb(':memory:');
  assert.doesNotMatch(storeCreditsSql(db), /amount_cents\s*</);
  assert.equal(userVersion(db), SCHEMA_VERSION);
  db.close();
});
