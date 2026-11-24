// Policy §6 "Honest confirmations": find what the assistant's reply says it did
// (or is about to do) and check that against what really exists in the database.
//
// Deliberately rule-based and conservative: a sentence that *claims* a refund,
// store credit or escalation must be backed by a real record. Negated sentences
// ("I can't refund…") and questions/offers ("Would you like a store credit?") are
// not claims.
import { ordersMentioned } from './policy.js';
import { formatCents } from './util.js';

const AMT = String.raw`(?:\$\s?\d[\d,]*(?:\.\d{1,2})?\s+)`;
const DET = String.raw`(?:(?:a|an|the|your|this|that|its|one)\s+)`;
const ADJ = String.raw`(?:(?:full|partial|complete|goodwill|store|account|one-time|courtesy)\s+)`;
const ADV = String.raw`(?:(?:now|just|already|successfully|also|gone ahead and|went ahead and|go ahead and|fully|officially|right away|immediately)\s+)`;
const PROMISE = String.raw`(?:i'll|i will|i'm going to|i am going to|i'm about to|i am about to|let me|allow me to|i'm now|i am now|i'm|i am|i shall|i'd like to|i want to|we'll|we will|we're|we are)`;
const PROMISE_LEAD = String.raw`\b${PROMISE}\s+${ADV}*(?:(?:go ahead and|proceed to|now|be)\s+)*`;
const CREDIT = String.raw`credit(?!\s*card)(?!\s*or\s+debit)\b`;
const HUMAN = String.raw`(?:human|agent|specialist|team|supervisor|manager|colleague|representative|staff|person|teammate)s?`;
// The few words allowed between a noun ("refund", "credit") and its verb in one clause.
const NEAR = String.raw`[^.!?]{0,60}?`;

// `[^.!?]` gaps must still step over decimal points in amounts like "$68.00".
const GAP = String.raw`(?:[^.!?]|\.(?=\d))`;
const rx = (s) => new RegExp(s.replaceAll('[^.!?]', GAP), 'i');

const PATTERNS = {
  refund: {
    done: [
      rx(String.raw`\b(?:issued|processed|initiated|completed|approved|submitted|sent|granted|applied|finali[sz]ed|authori[sz]ed|put through|arranged|executed|triggered|started)\s+(?:you\s+)?${DET}?${AMT}?${ADJ}*${AMT}?refund\b`),
      rx(String.raw`\brefund\b${NEAR}\b(?:has|have)\s+${ADV}*been\s+${ADV}*(?:issued|processed|initiated|completed|approved|submitted|sent|granted|applied|finali[sz]ed|authori[sz]ed|created|made|done|recorded|confirmed)\b`),
      rx(String.raw`\brefund\b${NEAR}\b(?:was|is)\s+${ADV}*(?:being\s+)?(?:issued|processed|initiated|completed|complete|approved|submitted|sent|granted|applied|finali[sz]ed|done|on its way|underway|confirmed|recorded|successful)\b`),
      rx(String.raw`\b(?:has|have|had|was|is|been)\s+${ADV}*(?:been\s+)?${ADV}*refunded\b`),
      rx(String.raw`\b(?:i|we)(?:'ve|\s+have)?\s+${ADV}*refunded\b`),
      rx(String.raw`^${ADV}*refunded\b`), // "…and refunded order 1043" (subject elided)
      rx(String.raw`\brefund\s+(?:issued|processed|completed|complete|approved|confirmed|initiated|done|successful|submitted|sent)\b`),
    ],
    implied: [
      rx(String.raw`\b(?:you(?:'ll|\s+will)|you\s+should|you\s+can\s+expect\s+to)\s+(?:receive|see|get)\s+${DET}?${AMT}?${ADJ}*${AMT}?refund\b`),
      rx(String.raw`\brefund\b${NEAR}\b(?:will|should)\s+(?:appear|show up|arrive|post|be posted|reflect|be reflected|land|go back)\b`),
      rx(String.raw`\bwill\s+be\s+${ADV}*refunded\b`),
    ],
    promise: [
      rx(String.raw`${PROMISE_LEAD}(?:issue|issuing|process|processing|initiate|initiating|submit|submitting|start|starting|put through|putting through|arrange|arranging|complete|completing|send|sending|create|creating)\b[^.!?]{0,40}?\brefund\b`),
      rx(String.raw`${PROMISE_LEAD}(?:refund|refunding)\b`),
      rx(String.raw`^(?:now\s+)?(?:processing|issuing|initiating|submitting)\s+${DET}?${AMT}?${ADJ}*refund\b`),
    ],
  },
  store_credit: {
    done: [
      rx(String.raw`\b(?:issued|added|applied|granted|given|gave|processed|created|deposited|loaded|put|placed|sent|provided|awarded|approved|posted)\s+(?:you\s+)?${DET}?${AMT}?(?:(?:in|of|worth of)\s+)?${ADJ}*${AMT}?(?:(?:in|of)\s+)?${ADJ}*${CREDIT}`),
      rx(String.raw`\b${CREDIT}${NEAR}\b(?:has|have)\s+${ADV}*been\s+${ADV}*(?:issued|added|applied|granted|given|processed|created|deposited|loaded|placed|sent|provided|awarded|approved|posted|recorded)\b`),
      rx(String.raw`\b${CREDIT}${NEAR}\b(?:was|is)\s+${ADV}*(?:being\s+)?(?:issued|added|applied|granted|given|processed|created|deposited|loaded|placed|sent|provided|awarded|approved|posted|recorded|in your account|on your account)\b`),
      rx(String.raw`\b(?:store|goodwill)\s+credit\s+(?:issued|added|applied|granted|confirmed|approved)\b`),
    ],
    implied: [
      rx(String.raw`\b(?:you(?:'ll|\s+will)|you\s+should|you\s+now)\s+(?:receive|see|get|have)\s+${DET}?${AMT}?(?:(?:in|of)\s+)?${ADJ}*${AMT}?(?:(?:in|of)\s+)?${ADJ}*${CREDIT}`),
    ],
    promise: [
      rx(String.raw`${PROMISE_LEAD}(?:issue|issuing|add|adding|apply|applying|give|giving|grant|granting|process|processing|put|putting|create|creating|send|sending|post|posting|award|awarding)\b[^.!?]{0,40}?\b${CREDIT}`),
      rx(String.raw`${PROMISE_LEAD}(?:credit|crediting)\b(?!\s*card)`),
      rx(String.raw`^(?:now\s+)?(?:issuing|adding|applying|crediting)\b[^.!?]{0,30}?${CREDIT}`),
    ],
  },
  escalation: {
    done: [
      rx(String.raw`\b(?:i|we)(?:'ve|\s+have)?\s+${ADV}*escalated\b`),
      rx(String.raw`^${ADV}*escalated\b`),
      rx(String.raw`\b(?:has|have|had|was|is|been)\s+${ADV}*(?:been\s+)?${ADV}*escalated\b`),
      rx(String.raw`\bescalation\b[^.!?]{0,40}?\b(?:has been|was|is)\s+${ADV}*(?:created|submitted|filed|opened|logged|recorded|complete|completed|confirmed|in place|raised|done)\b`),
      rx(String.raw`\b(?:created|submitted|filed|opened|logged|raised)\s+${DET}?(?:an?\s+)?(?:escalation|ticket|support ticket|case)\b`),
      rx(String.raw`\b(?:forwarded|transferred|handed\s+(?:it\s+|this\s+|your case\s+)?(?:off|over)|passed\s+(?:it\s+|this\s+)?(?:along|on)|referred|assigned|routed)\b[^.!?]{0,50}?\b${HUMAN}\b`),
      rx(String.raw`\b(?:escalation|ticket)\s+(?:created|submitted|filed|opened|confirmed|complete)\b`),
    ],
    implied: [
      rx(String.raw`\b(?:a|an|our|one of our|the)\s+(?:human\s+|support\s+|customer\s+(?:service|support|care)\s+|senior\s+)?(?:agent|specialist|team member|representative|teammate|colleague|team|supervisor|person|staff member)\s+(?:will|is going to|should|is now going to)\s+(?:contact|reach|be in touch|get back|follow up|review|look into|be reaching|email|call|handle|take over|assist)\b`),
    ],
    promise: [
      rx(String.raw`${PROMISE_LEAD}(?:escalate|escalating|forward|forwarding|transfer|transferring|connect|connecting|hand|handing|pass|passing|refer|referring|loop in|looping in|route|routing)\b`),
      rx(String.raw`^(?:now\s+)?(?:escalating|forwarding|transferring)\b`),
    ],
  },
};

const CREDITED_RE = /(?:^|\b(?:(?:i|we)(?:'ve|\s+have)?|has|have|had|was|is|been)\s+)(?:(?:now|just|already|successfully|also|fully)\s+)*(?:been\s+)?credited\b/i;
const CARD_RE = /\b(?:card|payment method|original payment|bank|statement)\b/i;

const NEGATION_RE =
  /\b(?:not|never|no|cannot|can't|cant|couldn't|won't|wouldn't|isn't|wasn't|aren't|weren't|haven't|hasn't|hadn't|didn't|don't|doesn't|unable|ineligible|denied|declined|failed|unsuccessful|neither|nor|without|instead of|unless)\b|n't\b/i;
// Conditional clauses are offers, not claims. "would"/"could" only soften future
// statements; a past-tense "I've refunded … and would be happy to help" is still a claim.
const CONDITIONAL_RE = /\b(?:if|whether|should you|in case|unless)\b/i;
const HYPOTHETICAL_RE = /\b(?:if|would|could|whether|once you|should you|in case|unless)\b/i;
const QUESTION_OPENER_RE = /^(?:would|do|does|did|shall|should|can|could|will|is|are|may|want|how about|what about)\b/i;
const BALANCE_RE = /\bbalance\b/i;

function normalize(text) {
  return String(text || '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒­]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\b(?:no problem|no worries|no rush|not a problem)\b/gi, 'okay')
    .replace(/[ \t]+/g, ' ');
}

function splitSentences(text) {
  return normalize(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().replace(/^[-•\d.)\s]+(?=[a-z$])/i, ''))
    .filter(Boolean);
}

function splitClauses(sentence) {
  return sentence
    .split(
      /;\s*|:\s+|,\s+|\s[-–—]\s|(?<!ahead)\s+and\s+|\b(?:but|however|although|though|whereas|instead|while|unfortunately|meanwhile)\b/i,
    )
    .map((c) => c.trim())
    .filter((c) => /[a-z0-9]/i.test(c));
}

function amountsIn(text) {
  return [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) =>
    Math.round(Number.parseFloat(m[1].replace(/,/g, '')) * 100),
  );
}

/**
 * Extract the action claims in a reply.
 * @returns {Array<{type:'refund'|'store_credit'|'escalation', kind:'done'|'implied'|'promise', clause:string, sentence:string, orderIds:string[], amounts:number[]}>}
 */
export function extractClaims(reply, orders = []) {
  const claims = [];
  const replyRefs = ordersMentioned(normalize(reply), orders);
  for (const sentence of splitSentences(reply)) {
    const isQuestion = /\?\s*$/.test(sentence);
    const sentenceRefs = ordersMentioned(sentence, orders);
    const clauses = splitClauses(sentence);
    clauses.forEach((clause, index) => {
      // Questions and offers ("Would you like a store credit?") are not claims.
      if (isQuestion && (index === clauses.length - 1 || QUESTION_OPENER_RE.test(clause))) return;
      if (NEGATION_RE.test(clause)) return;
      const conditional = CONDITIONAL_RE.test(clause);
      const hypothetical = HYPOTHETICAL_RE.test(clause);
      const found = new Map(); // type -> kind
      for (const [type, groups] of Object.entries(PATTERNS)) {
        if (!conditional && groups.done.some((re) => re.test(clause))) found.set(type, 'done');
        else if (!hypothetical && groups.implied.some((re) => re.test(clause))) found.set(type, 'implied');
        else if (!hypothetical && groups.promise.some((re) => re.test(clause))) found.set(type, 'promise');
      }
      if (!conditional && CREDITED_RE.test(clause)) {
        const type = CARD_RE.test(clause) ? 'refund' : 'store_credit';
        if (!found.has(type)) found.set(type, 'done');
      }
      const amounts = amountsIn(clause);
      if (!conditional && BALANCE_RE.test(clause) && /\bcredit\b/i.test(sentence) && amounts.length) {
        claims.push({ type: 'balance', kind: 'done', clause, sentence, orderIds: [], amounts });
      }
      if (!found.size) return;
      let orderIds = ordersMentioned(clause, orders);
      if (!orderIds.length) orderIds = sentenceRefs;
      if (!orderIds.length && replyRefs.length === 1) orderIds = replyRefs;
      for (const [type, kind] of found) {
        claims.push({ type, kind, clause, sentence, orderIds, amounts });
      }
    });
  }
  return claims;
}

const NOUN = { refund: 'refund', store_credit: 'store credit', escalation: 'escalation' };

/**
 * Check a reply against reality.
 * @param reply   the assistant's draft reply
 * @param state   { orders, refunds, credits, escalations, balanceCents } for this customer (fresh from the DB)
 * @param actions state changes made during this request (from the toolbox)
 * @returns {{ ok: boolean, problems: Array<{sentence:string, message:string}>, claims: object[] }}
 */
export function verifyReply(reply, state, actions = []) {
  const { orders = [], refunds = [], credits = [], escalations = [], balanceCents = 0 } = state;
  const records = { refund: refunds, store_credit: credits, escalation: escalations };
  const claims = extractClaims(reply, orders);
  const problems = [];

  for (const claim of claims) {
    if (claim.type === 'balance') {
      if (!claim.amounts.includes(balanceCents)) {
        problems.push({
          sentence: claim.sentence,
          message: `The reply states a store-credit balance ("${claim.sentence}") but the real balance is ${formatCents(balanceCents)}.`,
        });
      }
      continue;
    }
    const recs = records[claim.type];
    const noun = NOUN[claim.type];
    const verb = claim.kind === 'promise' ? 'says it is about to make' : 'says there is';
    let matched;
    if (claim.orderIds.length) {
      const missing = claim.orderIds.filter((id) => !recs.some((r) => r.order_id === id));
      if (missing.length) {
        problems.push({
          sentence: claim.sentence,
          message: `The reply ${verb} a ${noun} for order ${missing.join(', ')} ("${claim.sentence}"), but no ${noun} exists for ${missing.length > 1 ? 'those orders' : 'that order'}.`,
        });
        continue;
      }
      matched = recs.filter((r) => claim.orderIds.includes(r.order_id));
    } else {
      const thisTurn = actions.filter((a) => a.type === claim.type);
      if (!thisTurn.length) {
        problems.push({
          sentence: claim.sentence,
          message: `The reply ${verb} a ${noun} ("${claim.sentence}"), but no ${noun} was made while answering this message. If you mean an earlier one, name its order number.`,
        });
        continue;
      }
      matched = thisTurn;
    }
    if (claim.type !== 'escalation' && claim.amounts.length) {
      const allowed = new Set(matched.map((r) => Number(r.amount_cents)));
      for (const id of claim.orderIds) {
        const o = orders.find((x) => x.id === id);
        if (o) allowed.add(Number(o.total_cents));
      }
      if (claim.type === 'store_credit') allowed.add(balanceCents);
      if (!claim.amounts.some((a) => allowed.has(a))) {
        problems.push({
          sentence: claim.sentence,
          message: `The reply states an amount for the ${noun} ("${claim.sentence}") that does not match the recorded amount (${matched.map((r) => formatCents(r.amount_cents)).join(', ')}).`,
        });
      }
    }
  }

  // The reverse direction: something was done but the reply doesn't say so.
  for (const action of actions) {
    const acknowledged = claims.some(
      (c) => c.type === action.type && c.kind !== 'promise' && (!c.orderIds.length || c.orderIds.includes(action.order_id)),
    );
    if (!acknowledged) {
      problems.push({
        sentence: null,
        message: `A ${NOUN[action.type]} WAS made for order ${action.order_id}${action.amount_cents ? ` (${formatCents(action.amount_cents)})` : ''}, but the reply does not clearly tell the customer it is done.`,
      });
    }
  }

  return { ok: problems.length === 0, problems, claims };
}

/** One plain sentence per real action, for receipts and the last-resort fallback. */
export function describeAction(action) {
  switch (action.type) {
    case 'refund':
      return `Refund of ${formatCents(action.amount_cents)} issued to your original payment method for order ${action.order_id} (${action.item}).`;
    case 'store_credit':
      return `Store credit of ${formatCents(action.amount_cents)} added to your account for order ${action.order_id} (${action.item}).`;
    case 'escalation':
      return `Order ${action.order_id} (${action.item}) escalated to a human support agent, who will follow up with you.`;
    default:
      return '';
  }
}

/**
 * Last resort when the model keeps producing a reply that does not match reality:
 * drop the offending sentences and state, deterministically, what actually happened.
 */
export function sanitizeReply(reply, verification, actions, attempts) {
  const bad = new Set(verification.problems.map((p) => p.sentence).filter(Boolean));
  const kept = splitSentences(reply).filter((s) => !bad.has(s));
  const parts = [];
  if (kept.length) parts.push(kept.join(' '));
  if (actions.length) {
    parts.push(`What I actually completed just now: ${actions.map(describeAction).join(' ')}`);
  }
  const failed = attempts.filter((a) => !a.ok);
  if (failed.length) {
    const lines = failed.map((a) => {
      const reason = String(a.message || '')
        .replace(/^NOT DONE: no [a-z ]+ was made\.\s*/i, '')
        .replace(/\s*Tell the customer plainly.*$/i, '')
        .replace(/\s*Nothing was changed\.?$/i, '')
        .replace(/\s*\(§\d\)/g, '');
      return `I could not complete the ${NOUN[{ issue_refund: 'refund', issue_store_credit: 'store_credit', escalate_to_human: 'escalation' }[a.tool]]} for order ${a.order_id}: ${reason}`;
    });
    parts.push(lines.join(' '));
  }
  if (!actions.length) {
    parts.push('To be clear: no refund, store credit or escalation was made in this reply.');
  }
  return parts.join('\n\n');
}
