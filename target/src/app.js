// Express app: pages, dev sign-in, and the chat API.
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  ROOT_DIR,
  creditBalanceCents,
  getCustomer,
  listCredits,
  listCustomers,
  listOrders,
  listRefunds,
} from './db.js';
import { loadConfig, runSupportChat } from './assistant.js';
import { loadPolicy } from './policy-file.js';
import { layout, ledgerPage, messagePage, ordersPage, policyPage, signInPrompt } from './views.js';
import { html } from './util.js';

export const SESSION_COOKIE = 'customer_id';

export function createApp(db, { config = loadConfig(), fetchImpl = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use('/static', express.static(path.join(ROOT_DIR, 'public'), { maxAge: 0 }));

  // Resolve the signed-in customer from the dev cookie on every request.
  app.use((req, _res, next) => {
    req.customer = getCustomer(db, req.cookies?.[SESSION_COOKIE]) ?? null;
    next();
  });

  const page = (res, opts, status = 200) =>
    res.status(status).type('html').send(layout({ ...opts }));

  const requireCustomer = (req, res, next) => {
    if (req.customer) return next();
    return page(
      res,
      { title: 'Sign in', customer: null, body: signInPrompt(listCustomers(db)) },
      401,
    );
  };

  app.get('/', (req, res) => {
    if (req.customer) return res.redirect('/orders');
    return page(res, { title: 'Welcome', customer: null, body: signInPrompt(listCustomers(db)) });
  });

  // Dev-only sign-in: no password, just pick a customer.
  app.get('/login-as/:customerId', (req, res) => {
    const customer = getCustomer(db, req.params.customerId);
    if (!customer) {
      return page(
        res,
        {
          title: 'Unknown customer',
          customer: req.customer,
          body: messagePage('Unknown customer', `There is no customer with id "${req.params.customerId}".`, String(signInPrompt(listCustomers(db)))),
        },
        404,
      );
    }
    res.cookie(SESSION_COOKIE, customer.id, { httpOnly: true, sameSite: 'lax', path: '/' });
    return res.redirect(302, '/orders');
  });

  app.get('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect(302, '/');
  });

  app.get('/orders', requireCustomer, (req, res) => {
    page(res, {
      title: 'Your orders',
      customer: req.customer,
      active: 'orders',
      body: ordersPage(req.customer, listOrders(db, req.customer.id), loadPolicy()),
    });
  });

  app.get('/account/ledger', requireCustomer, (req, res) => {
    page(res, {
      title: 'Ledger',
      customer: req.customer,
      active: 'ledger',
      body: ledgerPage(req.customer, {
        refunds: listRefunds(db, req.customer.id),
        credits: listCredits(db, req.customer.id),
        balanceCents: creditBalanceCents(db, req.customer.id),
      }),
    });
  });

  app.get('/policy', (req, res) => {
    page(res, { title: 'Support policy', customer: req.customer, body: policyPage(loadPolicy().text) });
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.post('/api/chat', express.json({ limit: '256kb' }), async (req, res) => {
    if (!req.customer) {
      return res.status(401).json({ error: 'Not signed in. Visit /login-as/<customerId> first.' });
    }
    const { messages, seed } = req.body ?? {};
    let seedValue;
    if (seed !== undefined && seed !== null && seed !== '') {
      const n = Number(seed);
      if (!Number.isFinite(n)) return res.status(400).json({ error: '"seed" must be a number.' });
      seedValue = Math.trunc(n);
    }
    const started = Date.now();
    const result = await runSupportChat({
      db,
      customerId: req.customer.id,
      messages,
      seed: seedValue,
      config,
      fetchImpl,
    });
    console.log(
      `[chat] ${req.customer.id} seed=${seedValue ?? '-'} tools=[${result.tool_calls
        .map((t) => `${t.name}${t.arguments?.order_id ? `(${t.arguments.order_id})` : ''}:${t.result.ok ? 'ok' : t.result.error}`)
        .join(', ')}] corrections=${result.verification.corrections}${result.verification.sanitized ? ' SANITIZED' : ''} ${Date.now() - started}ms`,
    );
    return res.json({ ...result, message: { role: 'assistant', content: result.reply } });
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    return page(res, { title: 'Not found', customer: req.customer, body: messagePage('Trail not found', 'That page does not exist.', String(html`<p><a href="/orders">Back to your orders</a></p>`)) }, 404);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    if (req.path.startsWith('/api/')) {
      const message =
        status === 503
          ? 'The support assistant is unavailable right now (the local model could not be reached). Please try again shortly.'
          : status >= 500
            ? 'Something went wrong on our side. Nothing was changed.'
            : err.expose === false
              ? 'Bad request.'
              : err.message;
      return res.status(status).json({ error: message, detail: status === 503 ? err.message : undefined });
    }
    return page(res, { title: 'Error', customer: req.customer ?? null, body: messagePage('Something went wrong', 'Please try again.') }, status);
  });

  return app;
}
