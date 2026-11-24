// Small shared helpers: dates, money, HTML escaping, order-id normalisation.

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The local calendar date `n` days before `from`, as YYYY-MM-DD. */
export function daysAgo(n, from = new Date()) {
  return localDateString(new Date(from.getFullYear(), from.getMonth(), from.getDate() - n));
}

function utcDay(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `fromStr` to `toStr` (both YYYY-MM-DD). */
export function daysBetween(fromStr, toStr) {
  return Math.round((utcDay(toStr) - utcDay(fromStr)) / 86_400_000);
}

export function daysSince(dateStr, today = localDateString()) {
  return daysBetween(dateStr, today);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents) {
  return usd.format((Number(cents) || 0) / 100);
}

export function centsToDollars(cents) {
  return Math.round(Number(cents)) / 100;
}

/**
 * Parse a money amount given by the model ("68", 68, "$68.00", "68 USD") into
 * integer cents. Returns null when it is not a usable positive amount.
 */
export function parseAmountToCents(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim().replace(/^usd\s*/i, '').replace(/\s*(usd|dollars?)$/i, '').replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    n = Number.parseFloat(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Accepts 1042, "1042", "#1042", "order 1042", "Order #1042". */
export function normalizeOrderId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const s = String(value).trim();
  const digits = s.match(/\d+/);
  if (digits) return digits[0];
  return s.replace(/^order\s*/i, '').replace(/^#/, '').trim();
}

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function isoToLocalDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : localDateString(d);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Tagged template that escapes interpolated values unless they are `raw()`. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += renderValue(v) + strings[i + 1];
  });
  return raw(out);
}

class RawHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export function raw(s) {
  return new RawHtml(String(s));
}

function renderValue(v) {
  if (v instanceof RawHtml) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v === null || v === undefined || v === false) return '';
  return escapeHtml(v);
}
