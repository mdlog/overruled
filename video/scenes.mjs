// What the recorder puts on screen besides the real pages: the terminal stage (verbatim captured output, drawn as
// terminal windows in a full-screen <iframe srcdoc> over the page, so cutting back to the page is removing one node),
// the label pill every artifact carries, lower thirds, the still viewer for the sealed-pack screenshot, and the two
// cards. Everything is designed at 1920x1080 and lives outside <body>, so a page zoom never scales it.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=block" rel="stylesheet">';

/** Init script for every filmed page: hidden scrollbars, the overlay/label/lower-third runtime (window.__v), a cursor. */
export const APP_INIT = `(() => {
  const css = '::-webkit-scrollbar{display:none} html{scrollbar-width:none}' +
    '#__labels{position:fixed;left:32px;top:22px;z-index:2147483600;display:flex;gap:12px;pointer-events:none}' +
    '.__pill{display:flex;align-items:center;gap:10px;font:600 21px/1 Inter,system-ui,sans-serif;letter-spacing:.01em;padding:10px 16px 10px 13px;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.35);animation:__pin .35s ease both}' +
    '.__pill i{width:10px;height:10px;border-radius:3px;display:block}' +
    '.__pill.kane{background:#0f766e;color:#ecfeff}.__pill.kane i{background:#5eead4}' +
    '.__pill.probe{background:#b45309;color:#fffbeb}.__pill.probe i{background:#fcd34d}' +
    '.__pill.plain{background:rgba(17,24,39,.92);color:#e5e7eb;border:1px solid #374151}.__pill.plain i{background:#9ca3af}' +
    '@keyframes __pin{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}' +
    '#__lower{position:fixed;left:64px;bottom:200px;z-index:2147483500;padding:22px 30px 22px 26px;border-radius:12px;background:rgba(10,12,16,.92);border-left:7px solid #b91c1c;box-shadow:0 14px 44px rgba(0,0,0,.5);animation:__lin .5s cubic-bezier(.2,.8,.2,1) both}' +
    '#__lower b{display:block;font:700 38px/1.15 Inter,system-ui,sans-serif;color:#fff;letter-spacing:-.01em}' +
    '#__lower span{display:block;margin-top:8px;font:500 22px/1.3 "DejaVu Sans Mono",monospace;color:#fca5a5}' +
    '#__lower.neutral{border-left-color:#e2a03f}#__lower.neutral span{color:#f5d08a}' +
    '@keyframes __lin{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}' +
    '.__hl{outline:4px solid #f59e0b !important;outline-offset:4px;border-radius:6px;box-shadow:0 0 0 14px rgba(245,158,11,.16) !important;transition:outline-color .3s}' +
    '#__ov{position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#0b0e13}';
  const mount = () => {
    if (document.getElementById('__vstyle')) return;
    const st = document.createElement('style'); st.id = '__vstyle'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
    const labels = document.createElement('div'); labels.id = '__labels';
    document.documentElement.appendChild(labels);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.__v = {
    overlay(html) {
      mount();
      return new Promise((done) => {
        document.getElementById('__ov')?.remove();
        const f = document.createElement('iframe');
        f.id = '__ov'; f.name = '__ov';
        f.onload = () => f.contentDocument.fonts.ready.then(() => setTimeout(done, 150));
        f.srcdoc = html;
        document.documentElement.appendChild(f);
      });
    },
    unoverlay() { document.getElementById('__ov')?.remove(); },
    label(items) {
      mount();
      const box = document.getElementById('__labels');
      box.innerHTML = '';
      for (const [text, kind] of items) {
        const p = document.createElement('div'); p.className = '__pill ' + kind;
        p.innerHTML = '<i></i>'; p.appendChild(document.createTextNode(text)); box.appendChild(p);
      }
    },
    lower(title, sub, tone) {
      mount();
      document.getElementById('__lower')?.remove();
      const el = document.createElement('div'); el.id = '__lower'; if (tone) el.className = tone;
      const b = document.createElement('b'); b.textContent = title; el.appendChild(b);
      if (sub) { const s = document.createElement('span'); s.textContent = sub; el.appendChild(s); }
      document.documentElement.appendChild(el);
    },
    unlower() { document.getElementById('__lower')?.remove(); },
    hl(sel, keep) {
      if (!keep) document.querySelectorAll('.__hl').forEach((e) => e.classList.remove('__hl'));
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) throw new Error('no element ' + sel);
      el.classList.add('__hl');
    },
    unhl() { document.querySelectorAll('.__hl').forEach((e) => e.classList.remove('__hl')); },
  };
})();`;

// ── the terminal stage ───────────────────────────────────────────────────────────────────────────────────────────

const FG = { 30: '#5c6370', 31: '#ff6b6b', 32: '#4ade80', 33: '#fbbf24', 34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e7eb', 90: '#7d8590', 91: '#ff8787', 92: '#86efac', 93: '#fde68a', 94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff' };

/** One line of terminal output (ANSI SGR colours) as HTML. */
export function ansi(line) {
  let out = '';
  let st = { b: 0, d: 0, fg: null };
  const open = () => {
    const css = [];
    if (st.fg) css.push(`color:${st.fg}`);
    if (st.b) css.push('font-weight:700');
    if (st.d) css.push('opacity:.62');
    return css.length ? `<span style="${css.join(';')}">` : '<span>';
  };
  let cur = open();
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) {
      cur += esc(part);
      continue;
    }
    out += `${cur}</span>`;
    for (const c of (m[1] || '0').split(';').map(Number)) {
      if (c === 0) st = { b: 0, d: 0, fg: null };
      else if (c === 1) st.b = 1;
      else if (c === 2) st.d = 1;
      else if (c === 22) st = { ...st, b: 0, d: 0 };
      else if (c === 39) st.fg = null;
      else if (FG[c]) st.fg = FG[c];
    }
    cur = open();
  }
  return out + cur + '</span>';
}
export const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** packet.md as an editor shows it: headings, bold, code and table pipes coloured. */
function mdLine(line) {
  let h = esc(line);
  if (/^#{1,3} /.test(line)) return `<span style="color:#93c5fd;font-weight:700">${h}</span>`;
  h = h.replace(/`([^`]+)`/g, '<span style="color:#fca5a5">`$1`</span>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<span style="color:#fff;font-weight:700">**$1**</span>');
  if (/^\|/.test(line)) h = h.replace(/\|/g, '<span style="color:#5c6370">|</span>');
  if (/^- /.test(line)) h = `<span style="color:#7d8590">-</span>${h.slice(1)}`;
  return h;
}

/**
 * The stage: terminal windows over a dark backdrop. `windows`: [{ id, title, box: [x, y, w, h], font, min, max,
 * editor, blocks: [{ cwd, cmd, lines: [text], shown }] }]. Output lines keep their colours; nothing is added to them.
 */
export function stage({ windows }) {
  const wins = windows
    .map((w) => {
      const [x, y, wd, ht] = w.box;
      const rows = [];
      w.blocks.forEach((b, bi) => {
        if (b.cmd != null)
          rows.push(
            `<div class="ln p${b.shown ? '' : ' off'}" data-b="${bi}" data-p="1"><span class="cwd">${esc(b.cwd ?? '')}</span><span class="ps">$</span> <span class="cmd" data-full="${esc(b.cmd)}">${b.shown ? esc(b.cmd) : ''}</span></div>`,
          );
        b.lines.forEach((l, li) => {
          const txt = plain(l);
          const body = w.editor ? mdLine(txt) : ansi(l);
          const num = w.editor ? `<span class="num">${li + 1}</span>` : '';
          rows.push(`<div class="ln o${b.shown ? '' : ' off'}" data-b="${bi}" data-i="${li}" data-t="${esc(txt)}">${num}<span class="tx">${body || '&nbsp;'}</span></div>`);
        });
      });
      return `<section class="win${w.editor ? ' editor' : ''}${w.wrap ? ' wrap' : ''}" id="${w.id}" style="left:${x}px;top:${y}px;width:${wd}px;height:${ht}px;--lh:${w.lh ?? 1.36}" data-box="${w.box.join(',')}" data-font="${w.font ?? 'fit'}" data-min="${w.min ?? 17}" data-max="${w.max ?? 30}" data-compact="${w.compact ? 1 : 0}">
  <header><i></i><i></i><i></i><span class="title">${esc(w.title)}</span><span class="meta"></span></header>
  <div class="body"><div class="inner">${rows.join('')}</div></div>
</section>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(1200px 700px at 70% 10%,#141a24 0%,#0b0e13 60%) #0b0e13;color:#d8dee9}
.win{position:absolute;display:flex;flex-direction:column;background:#0f141b;border:1px solid #273142;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.55);overflow:hidden;transition:opacity .35s}
.win.dim{opacity:.38}
.win header{flex:0 0 46px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#151b25;border-bottom:1px solid #222b38}
.win header i{width:13px;height:13px;border-radius:50%;background:#3a4352}.win header i:nth-child(1){background:#ff5f57}.win header i:nth-child(2){background:#febc2e}.win header i:nth-child(3){background:#28c840}
.win .title{margin-left:12px;font:500 17px/1 "DejaVu Sans Mono",monospace;color:#9aa6b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.win .meta{font:700 17px/1 "DejaVu Sans Mono",monospace;color:#fcd34d;white-space:nowrap}
.body{flex:1;overflow:hidden;position:relative;padding:14px 22px 14px 22px;clip-path:inset(14px 0 14px 0)}
.inner{font-family:"DejaVu Sans Mono",monospace;font-size:22px;line-height:var(--lh);white-space:pre}
.win.editor .inner,.win.wrap .inner{white-space:pre-wrap;overflow-wrap:anywhere}
.ln{position:relative;padding:0 8px;margin:0 -8px;border-radius:4px;transition:background .25s,box-shadow .25s}
.ln.off,.ln.cut{display:none}
.ln .cwd{color:#7aa2f7;margin-right:.6em}.ln .ps{color:#4ade80;font-weight:700}.ln .cmd{color:#f8fafc}
.ln.p.typing .cmd::after{content:'';display:inline-block;width:.6em;height:1.05em;margin-left:2px;vertical-align:-.18em;background:#f8fafc;animation:blink .9s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.num{display:inline-block;width:2.6em;margin-right:1em;text-align:right;color:#4b5563;user-select:none}
.win.editor .ln{padding-left:calc(3.6em + 8px);text-indent:-3.6em}
.ln.hl{background:rgba(250,204,21,.17);box-shadow:inset 5px 0 0 #facc15}
.ln.hl-ok{background:rgba(74,222,128,.16);box-shadow:inset 5px 0 0 #4ade80}
.ln.hl-bad{background:rgba(248,113,113,.18);box-shadow:inset 5px 0 0 #f87171}
.tag{display:inline-block;margin-left:1em;padding:3px 10px;border-radius:6px;font:700 .78em/1.25 Inter,system-ui,sans-serif;vertical-align:.08em;background:#facc15;color:#111;white-space:nowrap;animation:tin .3s ease both}
.tag.ok{background:#4ade80}.tag.bad{background:#f87171}
@keyframes tin{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
</style></head><body>
${wins}
<script>
const $ = (id) => document.getElementById(id);
const inner = (id) => $(id).querySelector('.inner');
const lines = (id, b) => [...inner(id).querySelectorAll('.ln.o' + (b == null ? '' : '[data-b="' + b + '"]'))];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const charW = (() => { const c = document.createElement('canvas').getContext('2d'); c.font = '100px "DejaVu Sans Mono"'; return c.measureText('MMMMMMMMMM').width / 1000; })();
function visible(id) { return [...inner(id).querySelectorAll('.ln')].filter((l) => !l.classList.contains('off') && !l.classList.contains('cut')); }
function kept(id) { return [...inner(id).querySelectorAll('.ln')].filter((l) => !l.classList.contains('cut')); }
function cols(l) { const t = l.classList.contains('p') ? (l.querySelector('.cwd').textContent + ' $ ' + l.querySelector('.cmd').dataset.full) : l.dataset.t; return t.length + (l.querySelector('.num') ? 4 : 0); }
const S = window.S = {
  /** Font size: fixed, or the largest that fits the widest visible line (and, with rows, that many rows). */
  fit(id, rows) {
    const w = $(id), body = w.querySelector('.body');
    const lh = parseFloat(getComputedStyle(w).getPropertyValue('--lh')) || 1.36;
    let px = +w.dataset.font;
    if (w.dataset.font === 'fit') {
      // Sized for every line the window will show (hidden ones included), so revealing lines never resizes it.
      const widest = Math.max(20, ...kept(id).map(cols));
      px = (body.clientWidth - 44 - 16) / (widest * charW);
      if (rows) px = Math.min(px, (body.clientHeight - 28) / (rows * lh));
      px = Math.max(+w.dataset.min, Math.min(+w.dataset.max, px));
    }
    inner(id).style.fontSize = px.toFixed(1) + 'px';
    if (w.dataset.compact === '1') S.compact(id);
  },
  /** Shrinks the window to its content (all lines it will show) and centres it in its box. */
  compact(id) {
    const w = $(id), box = w.dataset.box.split(',').map(Number);
    // Measure the content as it will finally stand: every kept line shown, every command fully typed.
    const off = kept(id).filter((l) => l.classList.contains('off'));
    const cmds = [...inner(id).querySelectorAll('.ln.p .cmd')];
    const typed = cmds.map((c) => c.textContent);
    off.forEach((l) => l.classList.remove('off'));
    cmds.forEach((c) => { c.textContent = c.dataset.full; });
    const need = inner(id).scrollHeight;
    cmds.forEach((c, i) => { c.textContent = typed[i]; });
    off.forEach((l) => l.classList.add('off'));
    const h = Math.min(box[3], Math.ceil(46 + 28 + need + 4));
    w.style.height = h + 'px';
    w.style.top = Math.round(box[1] + (box[3] - h) / 2) + 'px';
  },
  async type(id, b, ms = 700) {
    const p = inner(id).querySelector('.ln.p[data-b="' + b + '"]');
    p.classList.remove('off'); p.classList.add('typing');
    const cmd = p.querySelector('.cmd'), full = cmd.dataset.full;
    S.bottom(id);
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / ms);
      cmd.textContent = full.slice(0, Math.round(full.length * k));
      if (k >= 1) break;
      await sleep(16);
    }
    p.classList.remove('typing');
  },
  /** Reveals block b's output; at: one delay (ms) per line from now, or a total spread evenly, or 0 for at once. */
  async out(id, b, at = 0) {
    const ls = lines(id, b);
    const when = Array.isArray(at) ? at : ls.map((_, i) => (at ? (at * (i + 1)) / ls.length : 0));
    const t0 = performance.now();
    for (let i = 0; i < ls.length; i++) {
      const wait = when[i] - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
      ls[i].classList.remove('off');
      S.bottom(id);
    }
  },
  /** Output lines [from, to) of block b, at once (lines a process printed at a given moment). */
  reveal(id, b, from, to) {
    lines(id, b).slice(from, to).forEach((l) => l.classList.remove('off'));
    S.bottom(id);
  },
  show(id, b) {
    const p = inner(id).querySelector('.ln.p[data-b="' + b + '"]');
    if (p) { p.classList.remove('off'); p.querySelector('.cmd').textContent = p.querySelector('.cmd').dataset.full; }
    lines(id, b).forEach((l) => l.classList.remove('off'));
  },
  /** Shows only these output lines of block b (indices or [from, to) ranges), no prompt; refits the font. */
  crop(id, b, picks) {
    const want = new Set();
    for (const p of picks) if (Array.isArray(p)) for (let i = p[0]; i < p[1]; i++) want.add(i); else want.add(p);
    inner(id).querySelectorAll('.ln').forEach((l) => l.classList.add('cut'));
    lines(id, b).forEach((l) => { if (want.has(+l.dataset.i)) { l.classList.remove('cut', 'off'); } });
    inner(id).style.transform = '';
    S.fit(id);
  },
  uncrop(id) { inner(id).querySelectorAll('.ln').forEach((l) => l.classList.remove('cut')); S.fit(id); },
  find(id, match) {
    const ls = visible(id).filter((l) => l.classList.contains('o'));
    const hit = ls.find((l) => l.dataset.t.includes(match));
    if (!hit) throw new Error('no visible line with ' + match);
    return hit;
  },
  hl(id, match, tone = 'hl', keep = false) {
    if (!keep) S.unhl(id);
    const l = S.find(id, match);
    l.classList.add(tone === 'hl' ? 'hl' : 'hl-' + tone);
    return l;
  },
  unhl(id) { inner(id).querySelectorAll('.hl,.hl-ok,.hl-bad').forEach((l) => l.classList.remove('hl', 'hl-ok', 'hl-bad')); },
  tag(id, match, text, tone = '') {
    const l = S.find(id, match);
    const t = document.createElement('span'); t.className = 'tag ' + tone; t.textContent = text;
    l.querySelector('.tx').appendChild(t);
  },
  /** Scrolls so that the line holding match sits pad rows from the top (smoothly over ms). */
  async scroll(id, match, ms = 600, pad = 1) {
    const box = inner(id), body = $(id).querySelector('.body');
    const l = S.find(id, match);
    const lh = parseFloat(getComputedStyle(box).fontSize) * (parseFloat(getComputedStyle($(id)).getPropertyValue('--lh')) || 1.36);
    const maxY = Math.max(0, box.scrollHeight - (body.clientHeight - 28));
    const to = Math.min(maxY, Math.max(0, l.offsetTop - pad * lh));
    const from = -(parseFloat((box.style.transform.match(/-?[\\d.]+/) || [0])[0]) || 0);
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      const e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      box.style.transform = 'translateY(' + (-(from + (to - from) * e)).toFixed(1) + 'px)';
      if (k >= 1) break;
      await sleep(16);
    }
  },
  /** Like a terminal: keep the last line in view. */
  bottom(id) {
    const box = inner(id), body = $(id).querySelector('.body');
    let over = box.scrollHeight - (body.clientHeight - 28);
    // Scroll by whole rows, so the top line is never cut in half.
    const lh = parseFloat(getComputedStyle(box).fontSize) * (parseFloat(getComputedStyle($(id)).getPropertyValue('--lh')) || 1.36);
    if (over > 0) over = Math.ceil(over / lh - 0.02) * lh;
    box.style.transform = over > 0 ? 'translateY(' + (-over).toFixed(1) + 'px)' : '';
  },
  meta(id, text) { $(id).querySelector('.meta').textContent = text; },
  /** A real-time clock in the title bar, played at speed x: shows how much real time the shot compresses. */
  async clock(id, fromMs, toMs, speed, prefix = '') {
    const t0 = performance.now();
    const fmt = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    for (;;) {
      const real = Math.min(toMs, fromMs + (performance.now() - t0) * speed);
      S.meta(id, prefix + speed + '× · ' + fmt(real) + ' real time');
      if (real >= toMs) break;
      await sleep(50);
    }
  },
  dim(id, on = true) { $(id).classList.toggle('dim', on); },
  /** One window on screen, the others gone (a cut). */
  only(id) { document.querySelectorAll('.win').forEach((w) => { w.style.display = w.id === id ? '' : 'none'; }); S.fit(id); },
  fitRows(id, rows) { S.fit(id, rows); },
  /** Everything a viewer can read in the windows now, for the banned-word check. */
  text() {
    return [...document.querySelectorAll('.win')].filter((w) => w.style.display !== 'none').map((w) => {
      const body = w.querySelector('.body').getBoundingClientRect();
      const vis = visible(w.id).filter((l) => { const r = l.getBoundingClientRect(); return r.bottom > body.top && r.top < body.bottom; });
      return w.querySelector('.title').textContent + '\\n' + w.querySelector('.meta').textContent + '\\n' + vis.map((l) => l.textContent).join('\\n');
    }).join('\\n');
  },
};
for (const w of document.querySelectorAll('.win')) S.fit(w.id);
</script></body></html>`;
}

/** A terminal block from a capture: what ran, where, and every line it printed. */
export const block = (capture, { shown = false, cwd } = {}) => ({ cwd: cwd ?? capture.cwd, cmd: capture.cmd, lines: capture.out.split('\n'), shown });

// ── stills and cards ─────────────────────────────────────────────────────────────────────────────────────────────

/** A 1920x1080 screenshot, full frame, ready to zoom on a region (`zoom(...)`) and box a phrase in it. */
export const stillPage = (dataUrl) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
#cam{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;will-change:transform}
#cam img{display:block;width:1920px;height:1080px}
.box{position:absolute;border:4px solid #f59e0b;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,0);opacity:0;transition:opacity .4s, box-shadow .6s}
.box.on{opacity:1;box-shadow:0 0 0 9999px rgba(0,0,0,.28)}
</style></head><body><div id="cam"><img src="${dataUrl}" alt=""></div></body></html>`;

/** The "what is Kane, what is probe" card (VIDEO_SCRIPT 2:00-2:25). */
export const kaneProbeCard = ({ kane, probe }) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(1100px 680px at 72% 18%,#16202c 0%,#0b0e13 62%) #0b0e13;color:#e5e7eb;font-family:Inter,system-ui,sans-serif}
.wrap{position:absolute;left:150px;right:150px;top:150px;animation:in .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
h1{margin:0 0 48px;font:800 64px/1.05 Inter;letter-spacing:-.02em;color:#fff}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.col{border-radius:20px;padding:34px 38px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09)}
.col .tag{display:inline-flex;align-items:center;gap:12px;font:700 28px/1 Inter;letter-spacing:.04em;padding:12px 18px;border-radius:10px}
.col .tag i{width:13px;height:13px;border-radius:3px}
.kane .tag{background:#0f766e;color:#ecfeff}.kane .tag i{background:#5eead4}
.probe .tag{background:#b45309;color:#fffbeb}.probe .tag i{background:#fcd34d}
ul{margin:30px 0 0;padding:0;list-style:none}
li{font:500 34px/1.3 Inter;color:#f3f4f6;padding:14px 0;border-top:1px solid rgba(255,255,255,.08)}
li small{display:block;margin-top:6px;font:400 22px/1.3 "DejaVu Sans Mono",monospace;color:#9ca3af}
</style></head><body><div class="wrap">
<h1>What is Kane, and what is probe</h1>
<div class="cols">
<div class="col kane"><span class="tag"><i></i>KANE CLI</span><ul>${kane.map(([a, b]) => `<li>${esc(a)}<small>${esc(b)}</small></li>`).join('')}</ul></div>
<div class="col probe"><span class="tag"><i></i>PROBE</span><ul>${probe.map(([a, b]) => `<li>${esc(a)}<small>${esc(b)}</small></li>`).join('')}</ul></div>
</div></div></body></html>`;

/** The end card (VIDEO_SCRIPT 2:45-2:50). */
export const endCard = ({ repo, cmd, credit }) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;color:#e5e7eb;font-family:Inter,system-ui,sans-serif;
  background:radial-gradient(1000px 640px at 76% 26%,rgba(185,28,28,.16) 0%,rgba(185,28,28,0) 62%),#0b0e13}
.wrap{position:absolute;left:190px;top:210px;animation:in .9s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
.name{font:800 128px/1 Inter;letter-spacing:-.035em;color:#fff}
.tag{margin-top:34px;font:500 40px/1.25 Inter;color:#d1d5db;max-width:1400px}
.row{margin-top:64px;display:flex;flex-direction:column;gap:20px;align-items:flex-start}
.pill{padding:16px 26px;border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);font:500 32px/1 "DejaVu Sans Mono",monospace;color:#f3f4f6}
.pill.repo{border-color:rgba(248,113,113,.55);color:#fecaca}
.credit{margin-top:56px;font:500 28px/1 Inter;color:#9ca3af;letter-spacing:.02em}
</style></head><body><div class="wrap">
<div class="name">Overruled</div>
<div class="tag">Kane CLI shops as your customer, finds every rule your code quietly overrules, and hands each one back to Claude Code.</div>
<div class="row"><div class="pill repo">${esc(repo)}</div><div class="pill">${esc(cmd)}</div></div>
<div class="credit">${esc(credit)}</div>
</div></body></html>`;
