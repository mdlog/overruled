// Read a markdown policy and pull out every number a rule depends on:
// day counts, dollar amounts and percentages, each tied to its clause heading.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWord(n) {
  if (n < 20) return WORDS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `[- ]?${WORDS[n % 10]}` : '');
  return null;
}

/** Clauses: [{ id, title, numbers: [{ value, unit, text }] }]. A clause starts at any markdown heading. */
export function parsePolicy(markdown) {
  const clauses = [];
  let cur = { id: 'preamble', title: '', body: [] };
  for (const line of String(markdown).split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      clauses.push(cur);
      const sect = h[1].match(/(§\s?\d+[a-z]?)/);
      cur = { id: sect ? sect[1].replace(/\s/g, '') : h[1].trim(), title: h[1].replace(/§\s?\d+[a-z]?\s*/, '').trim(), body: [] };
    } else cur.body.push(line);
  }
  clauses.push(cur);
  const out = [];
  for (const c of clauses) {
    const text = c.body.join('\n').replace(/\*\*/g, '');
    const numbers = [];
    const seen = new Set();
    const add = (value, unit, t) => { const k = `${unit}:${value}`; if (!seen.has(k)) { seen.add(k); numbers.push({ value, unit, text: t }); } };
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:-\s*)?days?\b/gi)) add(Number(m[1]), 'days', m[0]);
    for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)) add(Number(m[1].replace(/,/g, '')), 'usd', m[0]);
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) add(Number(m[1]), 'percent', m[0]);
    if (numbers.length || c.id !== 'preamble') out.push({ id: c.id, title: c.title, numbers });
  }
  return out.filter(c => c.numbers.length);
}

/** Clause-level changes between two policy versions (numbers only). */
export function diffPolicies(fromMd, toMd) {
  const a = parsePolicy(fromMd), b = parsePolicy(toMd);
  const byId = new Map(b.map(c => [c.id, c]));
  const diffs = [];
  for (const c of a) {
    const d = byId.get(c.id);
    for (const n of c.numbers) {
      const same = d?.numbers.find(x => x.unit === n.unit && x.value === n.value);
      if (same) continue;
      const repl = d?.numbers.find(x => x.unit === n.unit && !c.numbers.some(y => y.unit === x.unit && y.value === x.value));
      diffs.push({ clause_id: c.id, title: c.title, unit: n.unit, from: n.value, to: repl ? repl.value : null,
        direction: repl == null ? 'removed' : directionOf(c, n, repl) });
    }
  }
  for (const d of b) if (!a.some(c => c.id === d.id)) for (const n of d.numbers) diffs.push({ clause_id: d.id, title: d.title, unit: n.unit, from: null, to: n.value, direction: 'added' });
  return diffs;
}
function directionOf(clause, from, to) {
  // a window or a cap that grows gives the customer more; a threshold that grows asks less of support
  return to.value > from.value ? 'loosen' : 'tighten';
}

/** Regexes that find a number restated in code or copy, including derived forms. */
export function patternsFor({ value, unit }) {
  const v = String(value).replace('.', '\\.');
  const sp = '[-\\s\\u00a0\\u202f]?';
  if (unit === 'days') {
    const w = Number.isInteger(value) ? numberWord(value) : null;
    return {
      strong: [new RegExp(`\\b${v}${sp}days?\\b`, 'i'), new RegExp(`\\b${v}-day\\b`, 'i'), ...(w ? [new RegExp(`\\b${w}${sp}days?\\b`, 'i')] : [])],
      contextual: { re: new RegExp(`(?<![\\w.])${v}(?![\\w.])`), context: /day|window|refund|return/i },
    };
  }
  if (unit === 'usd') {
    const cents = Math.round(value * 100);
    return {
      // a trailing sentence period is fine ("over $200."); "$200.50" or "$2000" is a different number
      strong: [new RegExp(`\\$\\s?${v}(?:\\.00)?(?!\\d|\\.\\d)`), new RegExp(`(?<![\\w.])${cents}(?!\\w|\\.\\d)`)],
      contextual: { re: new RegExp(`(?<![\\w.$])${v}(?:\\.00)?(?!\\w|\\.\\d)`), context: /usd|dollar|amount|credit|max|limit|cap|total|over|price|cents?/i },
    };
  }
  return { strong: [new RegExp(`(?<![\\w.])${v}\\s?%`)], contextual: null };
}
