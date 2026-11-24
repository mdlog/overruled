// Server-rendered HTML. Every page shares one layout, which includes the support chat.
import { html, raw, formatCents, daysSince, isoToLocalDate } from './util.js';

const LOGO = raw(`<svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path d="M3 41 L18 15 L25 27 L31 18 L45 41 Z" fill="currentColor"/>
  <path d="M18 15 L22.5 22.8 L19.6 21.4 L16.6 23.8 Z" fill="#f3ead8"/>
  <rect x="29" y="4" width="5" height="9" rx="1" fill="#e2622b"/>
</svg>`);

function header(customer, active) {
  const link = (href, label, key) =>
    html`<a href="${href}" class="${active === key ? 'is-active' : ''}" ${raw(active === key ? 'aria-current="page"' : '')}>${label}</a>`;
  return html`<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="/">${LOGO}<span class="brand-name">Trailhead<em>Supply</em></span></a>
    <nav class="site-nav" aria-label="Account">
      ${link('/orders', 'Orders', 'orders')}
      ${link('/account/ledger', 'Ledger', 'ledger')}
    </nav>
    <div class="account-chip">
      ${customer
        ? html`<span class="account-chip__label">Signed in as</span>
      <strong id="signed-in-customer" data-customer-id="${customer.id}">${customer.name}</strong>
      <a class="account-chip__out" href="/logout">Sign out</a>`
        : html`<span class="account-chip__label">Not signed in</span>`}
    </div>
  </div>
</header>`;
}

function chatWidget(customer) {
  return html`<aside id="support-chat" class="chat" data-signed-in="${customer ? 'true' : 'false'}" aria-label="Customer support chat">
  <div class="chat__head">
    <div>
      <p class="chat__eyebrow">Trail desk</p>
      <h2 class="chat__title">Support chat</h2>
    </div>
    <button type="button" class="chat__toggle" id="chat-toggle" aria-expanded="true" aria-controls="chat-body" title="Minimise chat">
      <span aria-hidden="true">–</span><span class="visually-hidden">Toggle chat</span>
    </button>
  </div>
  <div class="chat__body" id="chat-body">
    <div class="chat__messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
      <div class="chat-intro">
        ${customer
          ? html`<p>Hi ${customer.name.split(' ')[0]}! I'm the Trailhead Supply support assistant. Ask me about your orders, returns, refunds or a damaged delivery.</p>`
          : html`<p>Sign in to chat with support about your orders.</p>`}
      </div>
    </div>
    <form class="chat__form" id="chat-form" autocomplete="off">
      <label class="visually-hidden" for="chat-input">Message support</label>
      <textarea id="chat-input" name="message" rows="2" placeholder="${customer ? 'Type your message…' : 'Sign in to chat'}" ${raw(customer ? '' : 'disabled')}></textarea>
      <button type="submit" id="chat-send" class="chat__send" ${raw(customer ? '' : 'disabled')}>Send</button>
    </form>
    <p class="chat__fineprint">Replies follow our <a href="/policy">support policy</a>. Actions are logged to your account.</p>
  </div>
</aside>`;
}

export function layout({ title, customer, active = '', body, status = 200 }) {
  void status;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html`${title}`} · Trailhead Supply</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M3 41 L18 15 L25 27 L31 18 L45 41 Z' fill='%231d3326'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/static/styles.css">
<script src="/static/chat.js" defer></script>
</head>
<body>
${header(customer, active)}
<div class="shell">
  <main id="main" class="main">
${body}
  </main>
  ${chatWidget(customer)}
</div>
<footer class="site-footer"><p>Trailhead Supply · Outdoor gear since the first switchback · Dev build: accounts via <code>/login-as/:customerId</code></p></footer>
</body>
</html>`;
}

function statusBadge(status) {
  return html`<span class="stamp stamp--${status.toLowerCase()}" data-status="${status}">${status}</span>`;
}

export function signInPrompt(customers) {
  return html`<section class="hero">
  <p class="eyebrow">Dev sign-in</p>
  <h1>Pick an account to explore the store.</h1>
  <p class="lede">There is no real login in this build. Choose a seed customer to see their orders, ledger and support chat.</p>
  <ul class="customer-picks">
    ${customers.map(
      (c) => html`<li><a class="customer-pick" href="/login-as/${c.id}"><span class="customer-pick__name">${c.name}</span><code>${c.id}</code></a></li>`,
    )}
  </ul>
</section>`;
}

/** The refund terms shown on /orders, from policy.md as loaded for this request. */
export function refundTermsCopy(policy) {
  return policy.ok
    ? `Refunds are available within ${policy.rules.refundWindowDays} days of delivery; Final Sale items can't be returned.`
    : "Refunds and store credit can't be arranged right now. Please try again later. Final Sale items can't be returned.";
}

export function ordersPage(customer, orders, policy) {
  const rows = orders.map((o, i) => {
    const days = daysSince(o.delivered_on);
    return html`<tr data-order-id="${o.id}" style="--i:${i}">
      <td class="mono" data-label="Order"><span class="order-id">#${o.id}</span></td>
      <td data-label="Item">${o.item}</td>
      <td class="num mono" data-label="Total">${formatCents(o.total_cents)}</td>
      <td class="mono" data-label="Delivered"><time datetime="${o.delivered_on}">${o.delivered_on}</time></td>
      <td class="num mono" data-label="Days since delivery" data-days-since-delivery="${days}">${days}</td>
      <td data-label="Status">${statusBadge(o.status)}</td>
      <td data-label="Final Sale" data-final-sale="${o.final_sale ? 'true' : 'false'}">${o.final_sale ? html`<span class="tag tag--final">Final Sale</span>` : html`<span class="muted">No</span>`}</td>
    </tr>`;
  });
  return html`<section class="page-head">
  <p class="eyebrow">Account · ${customer.name}</p>
  <h1>Your orders</h1>
  <p class="lede">${orders.length} ${orders.length === 1 ? 'order' : 'orders'} on this account. ${refundTermsCopy(policy)}</p>
</section>
<div class="card table-wrap">
  <table class="data-table" id="orders-table">
    <thead>
      <tr><th scope="col">Order</th><th scope="col">Item</th><th scope="col" class="num">Total</th><th scope="col">Delivered</th><th scope="col" class="num">Days since delivery</th><th scope="col">Status</th><th scope="col">Final Sale</th></tr>
    </thead>
    <tbody>
      ${rows.length ? rows : html`<tr><td colspan="7" class="empty">No orders yet.</td></tr>`}
    </tbody>
  </table>
</div>`;
}

function moneyTable(id, caption, rows) {
  return html`<section class="card ledger-block">
  <h2>${caption}</h2>
  <table class="data-table" id="${id}">
    <thead><tr><th scope="col">Order</th><th scope="col" class="num">Amount</th><th scope="col">Date</th></tr></thead>
    <tbody>
      ${rows.length
        ? rows.map(
            (r) => html`<tr data-order-id="${r.order_id}" data-amount-cents="${r.amount_cents}">
        <td class="mono" data-label="Order"><span class="order-id">#${r.order_id}</span></td>
        <td class="num mono" data-label="Amount">${formatCents(r.amount_cents)}</td>
        <td class="mono" data-label="Date"><time datetime="${r.created_at}">${isoToLocalDate(r.created_at)}</time></td>
      </tr>`,
          )
        : html`<tr><td colspan="3" class="empty">None yet.</td></tr>`}
    </tbody>
  </table>
</section>`;
}

export function ledgerPage(customer, { refunds, credits, balanceCents }) {
  return html`<section class="page-head">
  <p class="eyebrow">Account · ${customer.name}</p>
  <h1>Ledger</h1>
  <p class="lede">Every refund and store credit on your account.</p>
</section>
<div class="balance card">
  <p class="balance__label">Store-credit balance</p>
  <p class="balance__amount mono" id="store-credit-balance" data-balance-cents="${balanceCents}">${formatCents(balanceCents)}</p>
  <p class="balance__note">Store credit can be used on future orders. It can't be exchanged for cash.</p>
</div>
<div class="ledger-grid">
  ${moneyTable('refunds-table', 'Refunds', refunds)}
  ${moneyTable('store-credits-table', 'Store credits', credits)}
</div>`;
}

export function policyPage(policyText) {
  return html`<section class="page-head">
  <p class="eyebrow">How support works</p>
  <h1>Support policy</h1>
</section>
<article class="card prose"><pre class="policy-text">${policyText ?? "The support policy can't be shown right now. Please try again later."}</pre></article>`;
}

export function messagePage(heading, text, extra = '') {
  return html`<section class="page-head">
  <h1>${heading}</h1>
  <p class="lede">${text}</p>
  ${raw(extra)}
</section>`;
}
