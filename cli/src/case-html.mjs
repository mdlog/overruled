// overruled case: render one loop case as a single static HTML file that works offline.
// Reads evidence/loop/<case>/{case,packet,attempts}.json and the sealed Kane pack (.evidence is a zip),
// embeds the screenshots and fonts as base64, and writes case.html next to them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, u) => (v == null ? '—' : u === 'usd' ? `$${v}` : u === 'days' ? `${v} days` : `${v}%`);
const b64 = (buf, mime) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

// ---------------------------------------------------------------- zip (no deps)
export function readZip(path) {
  const buf = readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`not a zip: ${path}`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return method === 0 ? raw : inflateRawSync(raw);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function packShots(packPath) {
  const z = readZip(packPath);
  const actionsName = [...z.keys()].find((k) => /^tests\/[^/]+\/logs\/0-actions\.ndjson$/.test(k));
  if (!actionsName) return { steps: [], z };
  const testDir = actionsName.replace(/logs\/0-actions\.ndjson$/, '');
  const steps = z.get(actionsName)().toString('utf8').trim().split('\n').map((l) => JSON.parse(l)).map((e) => {
    const shot = [...z.keys()].find((k) => k.startsWith(`${testDir}steps/${e.step}-`) && k.endsWith('/screenshot.jpg'));
    return { step: Number(e.step), type: e.action_type, variable: e.output_variable !== 'None' ? e.output_variable : null, instruction: e.action_instruction, status: e.status, shot };
  });
  return { steps, z };
}

// ---------------------------------------------------------------- render
function highlight(text, diffs) {
  let out = esc(String(text ?? '').replace(/\*\*/g, ''));
  const forms = (v, unit) => (unit === 'usd' ? [`\\$${v}(?:\\.00)?(?![\\d])`, `\\b${v * 100}\\b`] : [`\\b${v}\\b`]);
  for (const d of diffs) {
    const parts = [];
    if (d.from != null) parts.push(`(${forms(d.from, d.unit).join('|')})`);
    if (d.to != null) parts.push(`(${forms(d.to, d.unit).join('|')})`);
    if (!parts.length) continue;
    const re = new RegExp(parts.join('|'), 'g');
    out = out.replace(/(<[^>]*>)|([^<]+)/g, (all, tagm, txt) => tagm || txt.replace(re, (m, a, b) => (d.from != null && a ? `<mark>${m}</mark>` : `<mark class="new">${m}</mark>`)));
  }
  return out;
}
// the agent's own words: first paragraph only, with `code` and **bold** rendered
function prose(md) {
  const para = String(md || '').split(/\n\s*\n|\n- /)[0].trim();
  return esc(para).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

function ratio(cell) {
  if (!cell) return '<td class="na">—</td>';
  const [b, n] = cell.split('/').map(Number);
  return `<td class="${b ? 'bad' : 'good'}"><b>${b}</b><span>/${n}</span></td>`;
}

export function renderCase({ caseDir, root, pack, frameStep, callouts, heldout, labels = {} }) {
  const read = (f) => JSON.parse(readFileSync(join(caseDir, f), 'utf8'));
  const c = read('case.json');
  const packet = read('packet.json');
  const attempts = existsSync(join(caseDir, 'attempts.json')) ? read('attempts.json') : c.attempts || [];
  const diffs = packet.clause_diffs;
  const d0 = diffs[0];
  const packPath = pack || (packet.kane.pack && join(root, packet.kane.pack));
  const { steps, z } = packPath && existsSync(packPath) ? packShots(packPath) : { steps: [] };
  const packSha = packPath && existsSync(packPath) ? createHash('sha256').update(readFileSync(packPath)).digest('hex') : null;
  const shot = (s) => (s?.shot ? b64(z.get(s.shot)(), 'image/jpeg') : null);
  const frame = steps.find((s) => s.step === Number(frameStep)) || steps.filter((s) => s.variable && s.shot).at(-1);
  const valueSteps = steps.filter((s) => s.variable && s.shot && Object.hasOwn(packet.kane.values, s.variable));
  const font = (f) => b64(readFileSync(join(here, '..', 'assets', f)), 'font/woff2');
  const srcSites = packet.sites.filter((s) => s.in_source);
  const testSites = packet.sites.filter((s) => s.kind === 'test');
  const fixed = c.fixed;
  const last = attempts.at(-1) || {};
  const green = c.green || {};
  const tag = (k) => `<span class="kind k-${esc(k)}">${esc(k)}</span>`;

  const valuesRows = Object.entries(packet.kane.values).map(([k, v]) => {
    const s = valueSteps.find((x) => x.variable === k);
    return `<tr><th>${esc(labels[k] || k.replace(/_/g, ' '))}${s ? `<small>step ${s.step}</small>` : ''}</th><td>${highlight(v, diffs)}</td></tr>`;
  }).join('');

  // which copy of the rule each part of the store followed (first changed clause only)
  const says = (txt, v, unit) => v != null && new RegExp(unit === 'usd' ? `\\$${v}(?![\\d])` : `\\b${v}\\b`).test(String(txt));
  const sideNew = [], sideOld = [];
  for (const [k, v] of Object.entries(packet.kane.values)) {
    const lab = labels[k] || k.replace(/_/g, ' ');
    if (says(v, d0.to, d0.unit)) sideNew.push(lab); else if (says(v, d0.from, d0.unit)) sideOld.push(lab);
  }
  if (srcSites.length) sideOld.push(`the code: ${srcSites.length} source line${srcSites.length === 1 ? '' : 's'}`);
  if (testSites.length) sideOld.push(`the tests: ${testSites.length}`);
  const whichCopy = `<div class="which"><div class="w-new"><p>Followed the page <b>${esc(fmt(d0.to, d0.unit))}</b></p><ul>${sideNew.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div><div class="w-old"><p>Followed the old rule <b>${esc(fmt(d0.from, d0.unit))}</b></p><ul>${sideOld.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></div>`;

  const calloutHtml = (callouts || []).map((o, i) => `<div class="callout t-${esc(o.tone || 'bad')}${o.below ? ' below' : ''}" style="left:${(o.x / 1920) * 100}%;top:${(o.y / 1080) * 100}%;width:${(o.w / 1920) * 100}%;height:${(o.h / 1080) * 100}%;animation-delay:${1.1 + i * 0.25}s"><span>${esc(o.label)}</span></div>`).join('');

  const heldoutHtml = heldout ? `
  <section class="exhibit" style="--i:5">
    <p class="label">Exhibit D · the edit it never saw</p>
    <h2>${esc(heldout.title)}</h2>
    <p class="lede">${esc(heldout.lede)}</p>
    <div class="edit-chips">${heldout.edit.map((e) => `<span>${esc(e.clause_id)} ${esc(fmt(e.from, e.unit))} → <b>${esc(fmt(e.to, e.unit))}</b></span>`).join('')}</div>
    <table class="matrix">
      <thead><tr><th rowspan="2">Customer</th>${heldout.models.map((m) => `<th colspan="2">${esc(m)}</th>`).join('')}</tr>
      <tr>${heldout.models.map(() => '<th>unfixed</th><th>fixed</th>').join('')}</tr></thead>
      <tbody>${heldout.rows.map((r) => `<tr><th>${esc(r.label)}${r.lang ? ` <i>${esc(r.lang)}</i>` : ''}<small>${esc(r.id)} · ${esc(r.expect)}</small></th>${heldout.models.map((m) => ratio(r.pre?.[m]) + ratio(r.post?.[m])).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th>All customers</th>${heldout.models.map((m) => ratio(heldout.totals.pre[m]) + ratio(heldout.totals.post[m])).join('')}</tr></tfoot>
    </table>
    <p class="fine">Cells count conversations that broke the edited policy (a forbidden refund, credit or escalation, or a required one that never happened), out of ${esc(heldout.seeds)} seeds at temperature ${esc(heldout.temperature)}. Code changed between the fix and this run: <b>${esc(heldout.code_diff_lines)} lines</b>.</p>
    ${heldout.stale_totals ? `<p class="fine">The bot also <i>said</i> a number the edit had replaced (21 days, $40 and $120 replaced 30 days, $25 and $200 before the fix, and 60 days, $25 and $200 after it): ${heldout.models.map((m) => `${esc(m)} ${esc(heldout.stale_totals.pre[m])} before the fix, ${esc((heldout.stale_post_rescored?.totals || heldout.stale_totals.post)[m])} after`).join('; ')}.${heldout.stale_post_rescored ? ` The after-fix count uses a 60-day pattern for §2, added after the run (labelled).` : ''}</p>` : ''}
    ${heldout.half ? `<div class="aside"><p class="label">Half-applied</p><p>${esc(heldout.half)}</p></div>` : ''}
    ${heldout.deviation ? `<p class="fine dev"><b>Labelled deviation.</b> ${esc(heldout.deviation)}</p>` : ''}
  </section>` : '';

  const greenHtml = green.status === 'passed' && green.kind === 'analyzer-only'
    ? `<p><b>Kane, again as the customer:</b> ${esc(green.status)} — “${esc(green.one_liner)}”</p>
    <table class="values"><tbody>${(green.conditions || []).map((k) => `<tr><th>${esc(k.text)}<small>expected ${k.expected ? 'true' : 'false'}</small></th><td>${k.result === k.expected ? '✓' : '✗'} judged <b>${k.result ? 'true' : 'false'}</b> · read “${esc(k.extracted)}”</td></tr>`).join('')}</tbody></table>
    <p class="fine">Labelled. The conversation ran in the probe, ${esc(green.conversation)}. Kane then signed in as Ana and read <code>/orders</code> in <code>--analyzer-only</code> mode: no agent steps and no evidence pack, ${esc(green.duration_s)} s, ${esc(green.credits)} credits. The third condition is a negative control. Record: <code>${esc(green.recorded)}</code>.</p>`
    : green.status === 'passed'
    ? `<p><b>Kane, again as the customer:</b> ${esc(green.status)} — “${esc(green.one_liner)}”</p>`
    : green.status === 'not-run'
      ? '<p class="fine"><b>Kane green run: not run yet.</b> Out of Kane credits, so the customer replay above is the labelled stand-in.</p>'
      : '<p class="fine"><b>Kane green run: not run.</b> The case was not fixed.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Overruled — case ${esc(c.case)}</title>
<script>if(!/still/.test(location.search)&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('anim')</script>
<style>
@font-face{font-family:G;src:url(${font('garamond-regular.woff2')}) format('woff2');font-weight:400}
@font-face{font-family:G;src:url(${font('garamond-italic.woff2')}) format('woff2');font-style:italic}
@font-face{font-family:G;src:url(${font('garamond-bold.woff2')}) format('woff2');font-weight:700}
@font-face{font-family:M;src:url(${font('mono-regular.woff2')}) format('woff2');font-weight:400}
@font-face{font-family:M;src:url(${font('mono-bold.woff2')}) format('woff2');font-weight:700}
:root{--paper:#f1eadb;--paper-2:#e9e0cc;--ink:#1d1b17;--ink-2:#57513f;--ink-3:#8a8270;--rule:#b9483d;--blood:#8f1d1a;--green:#1e5a3b;--mark:#f2cf6b;--line:#cfc4ab}
*{box-sizing:border-box}
html{background:var(--paper);color:var(--ink);font:400 19px/1.55 G,Georgia,serif;font-variant-numeric:oldstyle-nums;-webkit-font-smoothing:antialiased}
body{margin:0;min-height:100vh;background:
  url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .3 0 0 0 0 .25 0 0 0 0 .15 0 0 0 .09 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
  radial-gradient(120% 80% at 70% 0%,#f7f1e4 0%,transparent 60%),var(--paper)}
.sheet{position:relative;max-width:1180px;margin:0 auto;padding:56px 56px 96px 132px}
.sheet::before{content:"";position:absolute;top:0;bottom:0;left:96px;border-left:3px double var(--rule);opacity:.55}
.sheet::after{content:"";position:absolute;top:0;bottom:0;right:28px;border-left:1px solid var(--rule);opacity:.3}
.gutter{position:absolute;left:0;top:56px;bottom:0;width:80px;overflow:hidden;font:400 13px/38px M,monospace;color:var(--ink-3);text-align:right;opacity:.7;user-select:none}
.docket{font:400 13px/1.6 M,monospace;letter-spacing:.04em;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:6px 22px;border-bottom:1px solid var(--line);padding-bottom:14px}
.docket b{color:var(--ink);font-weight:700}
header{position:relative;padding:44px 0 18px}
.caption{font-variant-caps:all-small-caps;letter-spacing:.14em;font-size:1.05rem;color:var(--ink-2);margin:0 0 10px}
h1{font-weight:400;font-size:clamp(2.6rem,6.4vw,5.1rem);line-height:.98;letter-spacing:-.012em;margin:0;max-width:16ch;text-wrap:balance;font-variant-numeric:lining-nums}
h1 em{font-style:italic;color:var(--blood)}
.lede{font-size:1.22rem;max-width:58ch;color:var(--ink);margin:22px 0 0}
.stamp{position:absolute;font:700 clamp(1.6rem,3.4vw,2.6rem)/1 G,serif;letter-spacing:.2em;text-transform:uppercase;padding:.34em .55em .28em .75em;border:5px double currentColor;border-radius:6px;mix-blend-mode:multiply;
  -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.7'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='120'%3E%3Cfilter id='g'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.7'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
  opacity:.9;transform:rotate(var(--r))}
html.anim .stamp{animation:thunk .55s cubic-bezier(.2,1.5,.35,1) both}
.stamp.red{color:var(--blood);right:-34px;top:58px;--r:-9deg;animation-delay:.7s}
.stamp.green{color:var(--green);position:relative;display:inline-block;margin:0 0 0 auto;--r:-6deg;animation-delay:.2s;font-size:clamp(1.3rem,2.6vw,2rem)}
.ruling{display:flex;align-items:center;gap:30px;flex-wrap:wrap}
@keyframes thunk{0%{opacity:0;transform:rotate(var(--r)) scale(2.4)}60%{opacity:.95}100%{opacity:.9;transform:rotate(var(--r)) scale(1)}}
.exhibit{padding:54px 0 8px;border-top:1px solid var(--line);margin-top:46px}
html.anim .exhibit{animation:rise .8s ease both;animation-delay:calc(var(--i) * .12s + .3s)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.label{font:700 12px/1 M,monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--rule);margin:0 0 14px}
h2{font-weight:400;font-size:clamp(1.8rem,3.4vw,2.6rem);line-height:1.08;margin:0 0 10px;max-width:24ch;text-wrap:balance;font-variant-numeric:lining-nums}
h2 em{color:var(--blood)}
table{border-collapse:collapse;width:100%}
.clauses td,.clauses th{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:baseline}
.clauses thead th{font:700 11px M,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-2)}
.clauses .was{text-decoration:line-through;text-decoration-color:var(--blood);color:var(--ink-2)}
.clauses .now{font-size:1.35rem}
.frame{position:relative;margin:28px -24px 0 0;border:1px solid var(--ink);box-shadow:0 1px 0 var(--ink),14px 16px 0 -2px var(--paper-2),14px 16px 0 -1px var(--line);background:#fff}
.frame img{display:block;width:100%;height:auto}
.frame .tab{position:absolute;left:-1px;top:-30px;font:700 11px/1 M,monospace;letter-spacing:.2em;text-transform:uppercase;background:var(--ink);color:var(--paper);padding:9px 12px}
.callout{position:absolute;border:3px solid var(--blood);border-radius:4px}
html.anim .callout{animation:ring .6s ease both}
.callout.t-ok{border-color:var(--green)}
.callout span{position:absolute;left:-3px;bottom:100%;margin-bottom:4px;white-space:nowrap;font:700 12px/1 M,monospace;letter-spacing:.06em;background:var(--blood);color:#fff;padding:6px 8px}
.callout.t-ok span{background:var(--green)}
.callout.below span{bottom:auto;top:100%;margin:4px 0 0}
@keyframes ring{from{opacity:0;transform:scale(1.25)}to{opacity:1;transform:none}}
.two{display:grid;grid-template-columns:1.05fr 1fr;gap:42px;margin-top:40px;align-items:start}
.values th{font:400 .95rem/1.3 G,serif;font-variant-caps:all-small-caps;letter-spacing:.08em;color:var(--ink-2);text-align:left;padding:10px 16px 10px 0;width:36%;vertical-align:top;border-bottom:1px solid var(--line)}
.values th small{display:block;font:400 11px M,monospace;letter-spacing:.04em;color:var(--ink-3);font-variant-caps:normal}
.values td{font:400 14.5px/1.5 M,monospace;padding:10px 0;border-bottom:1px solid var(--line)}
mark{background:linear-gradient(transparent 12%,var(--mark) 12%,var(--mark) 88%,transparent 88%);color:var(--ink);padding:0 .12em;font-weight:700}
mark.new{background:none;color:var(--green);box-shadow:inset 0 -2px 0 var(--green)}
code{font:400 .8em M,monospace}
.verdict{border-left:4px solid var(--blood);padding:6px 0 6px 18px;margin:0}
.verdict .code{font:700 13px M,monospace;color:var(--blood);letter-spacing:.04em}
.verdict q{display:block;font-style:italic;font-size:1.2rem;margin-top:6px;quotes:"“" "”"}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:12px;margin-top:30px}
.strip figure{margin:0}
.strip img{width:100%;display:block;border:1px solid var(--ink-3);filter:sepia(.15) saturate(.9)}
.strip figcaption{font:400 11px/1.35 M,monospace;color:var(--ink-2);margin-top:6px}
.sites{list-style:none;margin:24px 0 0;padding:0;counter-reset:s}
.sites li{display:grid;grid-template-columns:44px 230px 1fr;gap:14px;align-items:baseline;padding:11px 0;border-bottom:1px dashed var(--line);counter-increment:s}
.sites li::before{content:counter(s,decimal-leading-zero);font:400 12px M,monospace;color:var(--ink-3)}
.sites .where{font:700 13px M,monospace}
.sites code{font:400 13.5px/1.5 M,monospace;color:var(--ink-2);overflow-wrap:anywhere}
.kind{display:inline-block;font:700 10px/1 M,monospace;letter-spacing:.12em;text-transform:uppercase;padding:4px 6px;border:1px solid currentColor;margin-left:8px;color:var(--ink-2)}
.k-db-check,.k-tool-schema{color:var(--blood)}.k-test{color:var(--green)}
.which{display:grid;grid-template-columns:1fr 1fr;margin-top:26px;border:1px solid var(--ink)}.which>div{padding:14px 16px}.which .w-new{border-right:1px solid var(--ink)}.which p{margin:0 0 8px;font-variant-caps:all-small-caps;letter-spacing:.08em;font-size:1.05rem}.which p b{font-variant-caps:normal;font-variant-numeric:lining-nums;letter-spacing:0}.w-new p b{color:var(--green)}.w-old p b{color:var(--blood)}.w-old{background:repeating-linear-gradient(-45deg,transparent 0 9px,rgba(143,29,26,.05) 9px 10px)}.which ul{margin:0;padding:0;list-style:none;font:400 13px/1.7 M,monospace}.which li::before{content:'— ';color:var(--ink-3)}
details{margin-top:18px}summary{cursor:pointer;font-variant-caps:all-small-caps;letter-spacing:.1em;color:var(--ink-2)}
.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin:28px 0 0;border:1px solid var(--ink)}
.checks div{padding:20px 22px;border-right:1px solid var(--ink)}.checks div:last-child{border:0}
.checks b{display:block;font:400 2.6rem/1 G,serif;font-variant-numeric:lining-nums}
.checks span{font:400 12px/1.4 M,monospace;color:var(--ink-2);letter-spacing:.04em}
.checks .ok b{color:var(--green)}.checks .no b{color:var(--blood)}
.summary{font-style:italic;font-size:1.15rem;max-width:62ch;border-left:2px solid var(--line);padding-left:18px;margin:26px 0 0;color:var(--ink-2)}
.edit-chips{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}.edit-chips span{font:400 13px M,monospace;border:1px solid var(--ink);padding:6px 10px;background:var(--paper-2)}
.matrix{margin-top:22px}
.matrix th,.matrix td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:center}
.matrix thead th{font:700 11px M,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
.matrix tbody th,.matrix tfoot th{text-align:left;font-weight:400}
.matrix th small{display:block;font:400 11px M,monospace;color:var(--ink-3)}
.matrix th i{font:700 10px M,monospace;font-style:normal;letter-spacing:.1em;color:var(--rule);border:1px solid var(--rule);padding:2px 4px;vertical-align:2px}
.matrix td b{font:400 1.5rem/1 G,serif;font-variant-numeric:lining-nums}.matrix td span{font:400 12px M,monospace;color:var(--ink-3)}
.matrix td.bad b{color:var(--blood)}.matrix td.good b{color:var(--green)}
.matrix tfoot th,.matrix tfoot td{border-top:2px solid var(--ink);border-bottom:0}
.aside{margin-top:26px;background:var(--paper-2);border:1px solid var(--line);padding:16px 20px;max-width:70ch}
.aside p{margin:0}.aside .label{margin-bottom:8px}
.fine{font-size:.92rem;color:var(--ink-2);max-width:72ch;margin-top:16px}
.dev{border-left:3px solid var(--rule);padding-left:14px}
footer{margin-top:70px;border-top:3px double var(--ink);padding-top:16px;font:400 12px/1.8 M,monospace;color:var(--ink-2)}
footer b{color:var(--ink)}
@media (max-width:860px){.sheet{padding:36px 20px 60px 46px}.sheet::before{left:30px}.gutter{display:none}.two{grid-template-columns:1fr}.sites li{grid-template-columns:1fr}.sites li::before{display:none}.stamp.red{position:relative;right:auto;top:auto;display:inline-block;margin-top:20px}.frame{margin-right:0}.checks{grid-template-columns:1fr}.checks div{border-right:0;border-bottom:1px solid var(--ink)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.stamp{opacity:.9;transform:rotate(var(--r))}}
@media print{.gutter{display:none}*{animation:none!important}}
</style></head>
<body><div class="sheet">
<div class="gutter" aria-hidden="true">${Array.from({ length: 400 }, (_, i) => i + 1).join('<br>')}</div>
<div class="docket"><span>Case <b>${esc(c.case)}</b></span><span>filed by commit <b>${esc(c.policy_commit)}</b></span><span>${esc(diffs.length)} clause${diffs.length === 1 ? '' : 's'} changed</span><span>Kane CLI · Claude Code</span></div>
<header>
  <p class="caption">The policy page v. the code</p>
  <h1>The page said <em>${esc(fmt(d0.to, d0.unit))}</em>. The code said ${esc(fmt(d0.from, d0.unit))}.</h1>
  <div class="stamp red" aria-label="Overruled">Overruled</div>
  <p class="lede">Operations changed ${diffs.length === 1 ? 'one number' : `${diffs.length} numbers`} on the support policy page. No code changed. Then Kane shopped as the customer, through the store's real chat widget, and wrote down what each part of the store said and did.</p>
</header>

<section class="exhibit" style="--i:0">
  <p class="label">Exhibit A · the edit</p>
  <table class="clauses"><thead><tr><th>Clause</th><th>Was</th><th>Now</th><th>Direction</th></tr></thead><tbody>
  ${diffs.map((d) => `<tr><td>${esc(d.clause_id)} ${esc(d.title)}</td><td class="was">${esc(fmt(d.from, d.unit))}</td><td class="now">${esc(fmt(d.to, d.unit))}</td><td>${esc(d.direction)}</td></tr>`).join('')}
  </tbody></table>
</section>

<section class="exhibit" style="--i:1">
  <p class="label">Exhibit B · what Kane saw as the customer</p>
  <h2>One screen, three answers. <em>The code's is the one that counts.</em></h2>
  ${frame ? `<div class="frame"><span class="tab">Kane step ${esc(frame.step)} · sealed pack</span><img src="${shot(frame)}" alt="Kane screenshot, step ${esc(frame.step)}: the orders page and the support chat">${calloutHtml}</div>` : ''}
  <div class="two">
    <div>
      <p class="label">What Kane stored${packet.kane.recorded ? ' · recorded run' : ''}</p>
      <table class="values"><tbody>${valuesRows}</tbody></table>
      <p class="fine">Values read from <code>${esc(packet.kane.source)}</code>${packet.kane.source !== 'final_state' ? ' (Kane leaves <code>final_state</code> empty on a failed run)' : ''}.</p>
    </div>
    <div>
      <p class="label">Kane's verdict</p>
      <blockquote class="verdict"><span class="code">${esc(packet.kane.status)} · ${esc(packet.kane.reason_code)}</span><q>${esc(packet.kane.one_liner)}</q></blockquote>
      ${packet.verdict ? `<p class="fine">Evidence policy <code>policy-gate.yaml</code>: <b>${esc(packet.verdict.result)}</b> on ${packet.verdict.failed_gates.map((g) => `<code>${esc(g)}</code>`).join(', ')}.</p>` : ''}
      <p class="fine">Same day, same code: <code>npm test</code> passed <b>${esc(packet.npm_test.pass)}/${esc(packet.npm_test.pass + packet.npm_test.fail)}</b>. ${testSites.length} of those tests assert the old rule.</p>
      ${whichCopy}
    </div>
  </div>
  ${valueSteps.length ? `<div class="strip">${valueSteps.map((s) => `<figure><img src="${shot(s)}" alt="Kane step ${esc(s.step)}" loading="lazy"><figcaption>step ${esc(s.step)} · ${esc(s.variable)}</figcaption></figure>`).join('')}</div>` : ''}
</section>

<section class="exhibit" style="--i:2">
  <p class="label">Exhibit C · the lines that overruled it</p>
  <h2>${srcSites.length} source line${srcSites.length === 1 ? '' : 's'} still said ${esc(fmt(d0.from, d0.unit))}.</h2>
  <p class="lede">Found by <code>overruled sites --from</code>: it looks for the old value of every changed number, in all its forms, then sorts each hit into source or not.</p>
  <ol class="sites">${srcSites.map((s) => `<li><span class="where">${esc(s.file)}:${esc(s.line)}${tag(s.kind)}</span><code>${highlight(s.text, diffs)}</code></li>`).join('')}</ol>
  ${testSites.length ? `<details><summary>${testSites.length} tests that assert the old rule</summary><ol class="sites">${testSites.map((s) => `<li><span class="where">${esc(s.file)}:${esc(s.line)}${tag('test')}</span><code>${highlight(s.text, diffs)}</code></li>`).join('')}</ol></details>` : ''}
  ${(packet.other_sites || []).length ? `<details><summary>${packet.other_sites.length} more lines that restate the other policy numbers</summary><ol class="sites">${packet.other_sites.map((s) => `<li><span class="where">${esc(s.file)}:${esc(s.line)}${tag(s.kind)}</span><code>${esc(s.text)}</code></li>`).join('')}</ol></details>` : ''}
</section>

<section class="exhibit" style="--i:3">
  <p class="label">Ruling · Claude Code's fix</p>
  <div class="ruling"><h2>${fixed ? `Fixed in ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}.` : `Not fixed after ${attempts.length} attempts.`}</h2>
  ${fixed ? '<div class="stamp green" aria-label="Sustained">Sustained</div>' : ''}</div>
  <p class="lede">The packet Claude Code received held the clause diff, Kane's values, every line above and a definition of done. Nothing in it mentions the held-out edit: the loop refuses to build a packet that does.</p>
  <div class="checks">
    <div class="${last.npm_test?.fail === 0 ? 'ok' : 'no'}"><b>${esc(last.npm_test?.pass ?? '—')}/${esc((last.npm_test?.pass ?? 0) + (last.npm_test?.fail ?? 0))}</b><span>npm test, after the fix (was ${esc(packet.npm_test.pass)} tests)</span></div>
    <div class="${last.sites_residual === 0 ? 'ok' : 'no'}"><b>${esc(last.sites_residual ?? '—')}</b><span>source lines still restating a policy number</span></div>
    <div class="${last.probe && !last.probe.skipped && last.probe.bad === 0 ? 'ok' : 'no'}"><b>${last.probe?.skipped ? '—' : `${esc((last.probe?.runs ?? 0) - (last.probe?.bad ?? 0))}/${esc(last.probe?.runs ?? 0)}`}</b><span>customer conversations replayed, correct outcome</span></div>
  </div>
  ${last.agent_summary ? `<p class="summary">${prose(last.agent_summary)}</p><p class="fine">— Claude Code, summing up attempt ${esc(last.n)} in its own words.</p>` : ''}
  <p class="fine">${last.files_changed ? `${esc(last.files_changed.length)} paths changed` : ''}${last.commit ? `, committed as <code>${esc(last.commit)}</code>` : ''}.</p>
  ${greenHtml}
</section>
${heldoutHtml}
<footer>
  <div><b>Record.</b> Rendered offline from <code>${esc(relative(root, caseDir))}/</code>${packPath ? ` and the sealed Kane pack <code>${esc(relative(root, packPath))}</code>` : ''}.</div>
  ${packSha ? `<div>pack sha256 ${esc(packSha)}</div>` : ''}
  <div>packet sha256 ${esc(packet.sha256)}</div>
  ${heldout?.hash ? `<div>held-out edit sha256 ${esc(heldout.hash)}, committed in ${esc(heldout.commit)} before any fix ran</div>` : ''}
  <div>Fonts: EB Garamond and Noto Sans Mono, SIL Open Font License 1.1.</div>
</footer>
</div></body></html>
`;
}

export function writeCase(opts) {
  const html = renderCase(opts);
  const out = opts.out || join(opts.caseDir, 'case.html');
  writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html) };
}

export function findRoot(start) {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, 'overruled.config.json'))) return d;
    const up = dirname(d);
    if (up === d) return resolve(start);
    d = up;
  }
}
