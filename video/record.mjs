// Films every beat as timestamped JPEG frames from Chrome's screencast. A clip starts once its page and overlay are
// ready (t0); every action fires when the narration reaches its anchor phrase; the clip holds
// max(narration + tail + hold, minMs). Writes out/timeline.json for captions.py / build.py, including what was
// readable on screen at each action (for the banned-word check in verify.sh).
//
//   node video/record.mjs --probe      every page, overlay, selector and anchor resolves; films nothing
//   node video/record.mjs [beat ...]   film every beat, or only the named ones (the timeline keeps the others)

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { beats } from './beats.mjs';
import { CHROME, OUT, ROOT, STORE, STORE_PATTERN } from './config.mjs';
import { APP_INIT } from './scenes.mjs';

const TAIL_MS = 800;
const VIEW = { width: 1920, height: 1080 };
/** Never film these. */
const REFUSE = ['Something went wrong', 'could not load', 'Cannot GET', 'Internal Server Error', '404', 'POLICY_UNAVAILABLE'];

const args = process.argv.slice(2);
const probe = args.includes('--probe');
const only = args.filter((a) => !a.startsWith('--'));
const take = JSON.parse(readFileSync(`${OUT}take.json`, 'utf8'));
const all = beats(take);
const list = all.filter((b) => only.length === 0 || only.includes(b.id));
const cfg = JSON.parse(readFileSync(`${ROOT}overruled.config.json`, 'utf8'));

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Milliseconds into the narration where `phrase` starts ("$end": where the narration ends). */
function anchor(words, phrase) {
  if (phrase === '$end') return words.tokens.at(-1).e * 1000;
  const want = phrase.split(/\s+/).map(norm).filter(Boolean);
  const have = words.tokens.map((t) => norm(t.w));
  for (let i = 0; i + want.length <= have.length; i++) if (want.every((w, k) => have[i + k] === w)) return words.tokens[i].s * 1000;
  throw new Error(`anchor "${phrase}" is not in the narration`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the store (for the beat that films /orders) ─────────────────────────────────────────────────────────────────
async function startStore() {
  const up = async () => {
    try {
      return (await fetch(`${STORE}/healthz`)).ok;
    } catch {
      return false;
    }
  };
  execSync(`pkill -f "${STORE_PATTERN}" || true`);
  await sleep(1200);
  // Only one thing may use port 3000. Anything still listening there now is not ours: leave it alone and wait.
  const held = execSync('ss -ltnp 2>/dev/null | grep ":3000 " || true', { encoding: 'utf8' }).trim();
  if (held || (await up())) throw new Error(`port 3000 is held by something else; retry when it is free\n${held}`);
  const log = openSync(`${OUT}store.log`, 'w');
  // KEEP_DB=1: the database as the loop's conversation left it (1042 refunded). Same env as the loop's own store.
  const child = spawn('npm', ['run', 'store'], { cwd: ROOT, env: { ...process.env, ...cfg.app.env, KEEP_DB: '1' }, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  if (!(await up())) throw new Error(`the store did not start; see ${OUT}store.log`);
  // Refuse a take of /orders that would not show what the narration says.
  const login = await fetch(`${STORE}/login-as/cust-ana`, { redirect: 'manual' });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const html = await (await fetch(`${STORE}/orders`, { headers: { cookie } })).text();
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const row = text.match(/1042 Alpine Hiking Boots .{0,80}/)?.[0] ?? '';
  if (!/REFUNDED/.test(row)) throw new Error(`/orders: 1042 is not REFUNDED (${row}). Run node video/capture-green.mjs first (its conversation refunds it).`);
  if (!new RegExp(`within ${take.clause.to} days`).test(text)) throw new Error(`/orders does not say within ${take.clause.to} days`);
  console.log(`  store up (KEEP_DB=1): ${row.slice(0, 70)}`);
}
const stopStore = () => execSync(`pkill -f "${STORE_PATTERN}" || true`);

// ── on-screen actions ───────────────────────────────────────────────────────────────────────────────────────────
function helpers(page, b, st) {
  const v = (fn, ...a) => page.evaluate(([fn, a]) => window.__v[fn](...a), [fn, a]);
  const frame = () => page.frame({ name: '__ov' });
  const s = async (fn, ...a) => {
    const f = frame();
    if (!f) throw new Error(`no overlay for S.${fn}`);
    return f.evaluate(([fn, a]) => window.S[fn](...a), [fn, a]);
  };
  // Background animations (a clock, a schedule) end quietly when the cut removes their overlay.
  const quiet = (p) => p.catch((e) => { if (!/detached|Target closed|has been closed/.test(e.message)) throw e; });
  const h = {
    page,
    v,
    s,
    label: (items) => v('label', items),
    lower: (t, sub, tone) => v('lower', t, sub, tone ?? ''),
    unlower: () => v('unlower'),
    overlay: (html) => v('overlay', html),
    unoverlay: () => v('unoverlay'),
    overlay2: () => v('overlay', b.overlay2),
    async hl(sel, keep = false) {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'attached', timeout: 5000 });
      await loc.evaluate((el, keep) => window.__v.hl(el, keep), keep);
    },
    async hlText(text, keep = false) {
      const loc = page.getByText(text).first();
      await loc.waitFor({ state: 'attached', timeout: 5000 });
      await loc.evaluate((el, keep) => window.__v.hl(el, keep), keep);
    },
    unhl: () => v('unhl'),
    async scrollTo(sel, block = 'center', ms = 700) {
      await page.locator(sel).first().evaluate((el, block) => el.scrollIntoView({ behavior: 'smooth', block }), block);
      await page.waitForTimeout(ms);
    },
    callout: (i) => page.evaluate((i) => document.querySelectorAll('.frame .callout')[i].classList.add('on'), i),
    chip: async (text) => st.chips.push({ t: Date.now() - st.t0, text }),
    // The Kane beat (beats.mjs greenBeat): speeds come from the anchors, so each segment fits the words over it.
    greenConversation: () => {
      const g = b.green;
      const [aC, aK] = [st.anchor('The conversation runs'), st.anchor('Kane signs in')];
      const sA = g.timed ? Math.max(1, Math.ceil(g.convEnd / Math.max(500, aK - aC - 250))) : null;
      st.speeds.conversation = sA;
      const model = cfg.kane.green.setup.match(/--model (\S+)/)[1];
      const temp = cfg.kane.green.setup.match(/--temp (\S+)/)[1];
      const p = h.label([[`PROBE · conversation via /api/chat (the widget's endpoint) · ${model} T${temp}${sA ? ` · ${sA}×` : ' · time-lapse'}`, 'probe']]);
      if (sA) st.bg.push(quiet(s('clock', 'A', 0, g.convEnd, sA, 'PROBE conversation · ')));
      // Lines the loop printed during the conversation (none, normally), at their compressed times.
      const rel = g.lines.map((l) => (l.t ?? 0) - g.lines[0].t);
      rel.forEach((r, i) => {
        if (i > 0 && g.timed && r < g.convEnd) st.bg.push(quiet(sleep(r / sA).then(() => s('reveal', 'A', 0, i, i + 1))));
      });
      return p;
    },
    greenKane: () => {
      const g = b.green;
      const [aK, aR] = [st.anchor('Kane signs in'), st.anchor(`${b.narration.match(/: (\d+) refunded/)[1]} refunded`)];
      const rel = g.lines.map((l) => (l.t ?? 0) - g.lines[0].t);
      const sA = st.speeds.conversation;
      const run = async () => {
        if (g.mode === 'recorded') {
          // The loop read the committed record: its remaining lines came within a second, at the same speed.
          await h.label([[g.label, 'kane']]);
          const t0 = Date.now();
          for (let i = 1; i < rel.length; i++) {
            if (rel[i] < g.convEnd) continue;
            const wait = (rel[i] - g.convEnd) / (sA ?? 1) - (Date.now() - t0);
            if (wait > 0) await sleep(wait);
            await s('reveal', 'A', 0, i, i + 1);
          }
          // Then the record itself: `cut` prints the whole file at once.
          await s('type', 'B', 0, 450);
          await s('out', 'B', 0, 0);
          return;
        }
        // A live take: Kane's NDJSON and the loop's last lines at their real times, compressed by sB.
        const last = rel.at(-1);
        // Untimed (an imported take): the log has no times, but Kane's own NDJSON does.
        const kaneReal = g.timed ? Math.max(1, last - g.convEnd) : Math.max(1, g.nd.at(-1)?.t ?? 0);
        const sB = kaneReal ? Math.max(1, Math.ceil(kaneReal / Math.max(500, aR - aK - 1400))) : null;
        st.speeds.kane = sB;
        await h.label([[`${g.label}${sB ? ` · ${sB}×` : ''}`, 'kane']]);
        await s('type', 'B', 0, 400);
        if (sB) st.bg.push(quiet(s('clock', 'B', 0, kaneReal, sB, 'KANE · ')));
        const evs = [
          ...g.nd.map((l, i) => ({ at: l.t / (sB ?? 1), fn: () => s('reveal', 'B', 0, i, i + 1) })),
          ...rel.map((r, i) => ({ i, r })).filter(({ i, r }) => i > 0 && (!g.timed || r >= g.convEnd)).map(({ i, r }) => ({ at: g.timed ? (r - g.convEnd) / sB : aR - aK - 1400, fn: () => s('reveal', 'A', 0, i, i + 1) })),
        ].sort((x, y) => x.at - y.at);
        const t0 = Date.now();
        for (const e of evs) {
          const wait = e.at - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          await e.fn();
        }
      };
      st.green = quiet(run());
      return null; // runs on while the narration goes on; greenDone() waits for it
    },
    greenDone: () => st.green ?? Promise.resolve(),
  };
  return h;
}

/** What a viewer can read on screen now: the overlay (it covers the page) or the page, plus labels and lower third. */
async function screenText(page) {
  const host = await page.evaluate(() => {
    const out = [];
    for (const id of ['__labels', '__lower']) {
      const e = document.getElementById(id);
      if (e && e.textContent.trim()) out.push(e.textContent);
    }
    if (document.getElementById('__ov')) return { covered: true, out };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const t = n.textContent.trim();
      const el = n.parentElement;
      if (!t || !el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      let e = el;
      let op = 1;
      let shown = true;
      while (e) {
        const cs = getComputedStyle(e);
        op *= Number(cs.opacity);
        if (cs.visibility === 'hidden' || cs.display === 'none') shown = false;
        e = e.parentElement;
      }
      if (shown && op > 0.05) out.push(t);
    }
    return { covered: false, out };
  });
  let ov = '';
  const f = page.frame({ name: '__ov' });
  if (host.covered && f) ov = await f.evaluate(() => (window.S ? window.S.text() : document.body.innerText));
  return [...host.out, ov].filter(Boolean).join('\n');
}

/** Records the page's screencast into dir: one JPEG per frame plus frames.json with each frame's epoch time (s). */
async function screencast(page, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const name = `${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(`${dir}/${name}`, Buffer.from(data, 'base64'));
    frames.push({ name, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    writeFileSync(`${dir}/frames.json`, JSON.stringify(frames));
    return frames.length;
  };
}

async function film(browser, b) {
  const words = JSON.parse(readFileSync(`${OUT}tts/${b.id}.json`, 'utf8'));
  const narrMs = words.duration * 1000;
  let durMs = Math.round(Math.max(narrMs + (b.tailMs ?? TAIL_MS) + (b.holdAfterMs ?? 0), b.minMs));
  const dir = `${OUT}clips/${b.id}`;
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
  await ctx.addInitScript(APP_INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Off camera: the page, then the overlay and the beat's own preparation.
  if (b.open?.url) {
    await page.goto(b.open.url, { waitUntil: 'load', timeout: 45_000 });
    try {
      await page.locator(b.open.ready).first().waitFor({ state: 'attached', timeout: 20_000 });
    } catch {
      await page.reload({ waitUntil: 'load' });
      await page.locator(b.open.ready).first().waitFor({ state: 'attached', timeout: 20_000 });
    }
    await page.evaluate(() => document.fonts.ready);
    // case.html: entrance animations are off (?still); wait out any that still run on the page.
    await page.evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 5000)),
      ]),
    );
    await page.waitForTimeout(b.open.remote ? 2500 : 600);
  } else {
    await page.setContent(b.open?.html ?? '<!doctype html><html><body style="margin:0;background:#0b0e13"></body></html>', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
  }
  const text = await page.evaluate(() => document.body.innerText);
  // The store must show no error; a committed page or GitHub only has to show its ready marker (case.html quotes
  // POLICY_UNAVAILABLE on purpose).
  const bad = b.open?.store && REFUSE.find((x) => text.includes(x));
  if (bad) throw new Error(`${b.id}: "${bad}" is on the page`);
  if (b.overlay) await page.evaluate((html) => window.__v.overlay(html), b.overlay);

  const st = { t0: 0, chips: b.chip ? [{ t: 0, text: b.chip }] : [], bg: [], speeds: {}, green: null, anchor: (p) => anchor(words, p) };
  const h = helpers(page, b, st);
  if (b.prep) await b.prep(h);
  // Resolve every anchor before filming.
  const plan = b.actions.map((a) => ({ ...a, atMs: anchor(words, a.at) + (a.offsetMs ?? 0) }));
  const stop = probe ? null : await screencast(page, dir);
  await page.waitForTimeout(250);

  st.t0 = Date.now();
  const seen = [{ t: 0, text: await screenText(page) }];
  for (const a of plan) {
    if (!probe) {
      const wait = st.t0 + a.atMs - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const late = Date.now() - (st.t0 + a.atMs);
      if (late > 700) console.warn(`  ${b.id}: "${a.at}" started ${late} ms late`);
    }
    try {
      if (process.env.VIDEO_DEBUG) console.log(`    ${b.id} @ ${a.at} (${Math.round(a.atMs)} ms)`);
      await a.do(h);
    } catch (e) {
      throw new Error(`${b.id} @ "${a.at}": ${e.message.split('\n')[0]}`);
    }
    seen.push({ t: Date.now() - st.t0, text: await screenText(page) });
  }
  await Promise.all(st.bg);
  if (st.green) await st.green;
  if (!probe) {
    durMs = Math.max(durMs, Date.now() - st.t0 + 400);
    const rest = st.t0 + durMs - Date.now();
    if (rest > 0) await page.waitForTimeout(rest);
  }
  seen.push({ t: Date.now() - st.t0, text: await screenText(page) });
  if (errors.length) console.warn(`  ${b.id}: page errors ${JSON.stringify(errors).slice(0, 300)}`);
  const frames = probe ? 0 : await stop();
  await ctx.close();
  if (probe) return { id: b.id, seen };
  if (frames < 1) throw new Error(`${b.id}: no frames captured`);
  return { id: b.id, dir, t0: st.t0 / 1000, durMs, frames, chapter: b.chapter, chips: st.chips, speeds: st.speeds, seen, imageText: b.imageText ?? [] };
}

mkdirSync(`${OUT}clips`, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const timelinePath = `${OUT}timeline.json`;
const timeline = existsSync(timelinePath) && only.length ? JSON.parse(readFileSync(timelinePath, 'utf8')) : [];
function saveTimeline() {
  const order = all.map((b) => b.id);
  const kept = timeline.filter((c) => order.includes(c.id));
  kept.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  writeFileSync(timelinePath, JSON.stringify(kept, null, 1));
}
const needsStore = list.some((b) => b.open?.store);
try {
  if (needsStore) await startStore();
  for (const b of list) {
    const t = Date.now();
    const clip = await film(browser, b);
    const sp = Object.keys(clip.speeds ?? {}).length ? ` speeds ${JSON.stringify(clip.speeds)}` : '';
    console.log(`${probe ? 'probe ok' : 'filmed  '} ${b.id.padEnd(10)} ${clip.durMs ? `${(clip.durMs / 1000).toFixed(1)}s` : ''} (${((Date.now() - t) / 1000).toFixed(1)}s)${sp}`);
    if (!probe) {
      const i = timeline.findIndex((c) => c.id === clip.id);
      if (i >= 0) timeline[i] = clip;
      else timeline.push(clip);
      saveTimeline();
    }
  }
} finally {
  await browser.close();
  if (needsStore) stopStore();
}
