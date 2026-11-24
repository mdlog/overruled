// The demo's beats, in VIDEO_SCRIPT order: what is on screen, the label it carries, what the narration says, and the
// on-screen actions anchored to spoken phrases. The narration is a template over out/take.json (select.mjs); the
// terminal shots are the captures in out/captures/ (capture.mjs, capture-green.mjs), drawn line for line.
//
//   node video/beats.mjs        dump narration (display + spoken text) to out/beats.json for tts.py / captions.py

import { readFileSync, writeFileSync } from 'node:fs';
import { CAP, CASE, OUT, REPO, ROOT, STORE, WORK } from './config.mjs';
import { block, endCard, kaneProbeCard, plain, stage, stillPage } from './scenes.mjs';

/** How the voice says a written token; captions keep the written form. */
export const PRONOUNCE = { 1042: 'ten forty-two', npm: 'N P M' };

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n) => WORDS[n] ?? String(n);
const Word = (n) => word(n)[0].toUpperCase() + word(n).slice(1);
const TENS = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' };
const tens = (n) => TENS[n] ?? String(n);
const Tens = (n) => tens(n)[0].toUpperCase() + tens(n).slice(1);
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Full-width terminal, clear of the label row above and the captions below. */
const FULL = [60, 92, 1800, 772];
const cap = (id) => JSON.parse(readFileSync(`${CAP}${id}.json`, 'utf8'));
const idx = (lines, match, from = 0) => {
  const i = lines.findIndex((l, k) => k >= from && plain(l).includes(match));
  if (i < 0) throw new Error(`no line with "${match}"`);
  return i;
};
const dataUrl = (p, type) => `data:${type};base64,${readFileSync(p).toString('base64')}`;

export function beats(take) {
  const { clause, red, whichCopy: wc, loop, heldout: ho, sites } = take;
  // The Kane beat films the take select.mjs chose (GREEN_TAKE when it ran), so record and build follow take.json.
  const src = take.green.take;
  const green = JSON.parse(readFileSync(src.startsWith('/') ? src : `${ROOT}${src}`, 'utf8'));
  const c3 = cap('c3');
  const c3l = c3.out.split('\n');
  const s1 = idx(c3l, '1  Kane shops');
  const s3 = idx(c3l, '3  Which copy');
  const s5 = idx(c3l, '5  The loop');
  const s7 = idx(c3l, '7  Then Operations');
  const replayWin = (id, extra = {}) => ({ id, title: 'saydo — npm run -s replay', box: FULL, max: 30, compact: true, blocks: [block(c3, { shown: true })], ...extra });
  const order = green.runEnd.descriptions[0].match(/Order (\d+)/)[1];
  const greenLabel = `${green.label} · run --analyzer-only · ${take.green.conditions} conditions`;

  return [
    // ── 0:00 the policy page, as Kane saw it (sealed pack, step 6) ──────────────────────────────────────────────
    {
      id: 'policy',
      chapter: `The bot says ${clause.to}, then refuses under ${clause.from} (Kane CLI, recorded run)`,
      // Read only when this beat is filmed, so re-shooting another beat does not need the scratch folder.
      // (Missing? node video/capture.mjs re-extracts it from the sealed pack, or set VIDEO_WORK.)
      get open() { return { html: stillPage(dataUrl(`${WORK}/overruled-step6.jpg`, 'image/jpeg')) }; },
      prep: (h) => h.label([['KANE CLI · recorded · sealed pack · step 6', 'kane']]),
      // What the still shows, for the banned-word check (an image has no DOM text): the policy text it renders.
      imageText: [readFileSync(`${ROOT}spike/policy/e2-window60.md`, 'utf8'), 'Trailhead SUPPLY Orders Ledger Signed in as Ana Lima Sign out HOW SUPPORT WORKS Support policy TRAIL DESK Support chat'],
      narration: `The store's policy page says ${clause.to} days.`,
      actions: [
        { at: "The store's", do: (h) => h.page.evaluate(() => {
          const cam = document.getElementById('cam');
          cam.style.transition = 'transform 3.4s cubic-bezier(.33,.05,.2,1)';
          cam.style.transform = 'translate(-395px,-372px) scale(1.8)';
        }) },
        { at: `${clause.to} days`, do: (h) => h.page.evaluate(() => {
          const b = document.createElement('div');
          b.className = 'box';
          Object.assign(b.style, { left: '779px', top: '456px', width: '234px', height: '30px' });
          document.getElementById('cam').appendChild(b);
          requestAnimationFrame(() => b.classList.add('on'));
        }) },
      ],
      minMs: 4000,
      tailMs: 500,
    },
    // ── 0:04 Kane's step-20 frame: the bot says 60, does 30 ───────────────────────────────────────────────────────
    {
      id: 'catch',
      chapter: null,
      open: { url: `file://${ROOT}${CASE}/case.html?still`, ready: '.frame img' },
      chip: `${CASE}/case.html · Exhibit B`,
      prep: async (h) => {
        await h.page.evaluate(() => {
          const st = document.createElement('style');
          st.textContent = '.callout{opacity:0}.callout.on{animation:ring .55s ease both}';
          document.head.appendChild(st);
          // The exhibit's heading and Kane's frame, as large as fits between the label (top) and the captions.
          const f = document.querySelector('.frame');
          const h2 = [...document.querySelectorAll('h2')].find((e) => e.textContent.includes('the one that counts')).previousElementSibling;
          let z = 1.5;
          for (let i = 0; i < 4; i++) {
            document.body.style.zoom = String(z);
            window.scrollTo(0, 0);
            const span = f.getBoundingClientRect().bottom - h2.getBoundingClientRect().top;
            z = Math.min(1.5, z * (866 / span));
          }
          document.body.style.zoom = String(z);
          window.scrollTo(0, 0);
          const r = f.getBoundingClientRect();
          document.querySelector('.sheet').style.transform = `translateX(${((1920 - r.width) / 2 - r.left) / z}px)`;
          window.scrollTo(0, h2.getBoundingClientRect().top - 88);
        });
        await h.label([['KANE CLI · recorded · step 20', 'kane']]);
      },
      imageText: ['Trailhead SUPPLY Orders Ledger Signed in as Ana Lima Sign out ACCOUNT · ANA LIMA Your orders ORDER ITEM TOTAL DELIVERED DAYS SINCE DELIVERY STATUS FINAL SALE TRAIL DESK Support chat Send Type your message',
        ...Object.values(JSON.parse(readFileSync(`${ROOT}${CASE}/case.json`, 'utf8')).kane.values)],
      narration: `Its support bot says ${clause.to} days, then turns away a ${red.ageDays}-day-old order: only within ${clause.from} days.`,
      actions: [
        { at: `says ${clause.to} days`, do: (h) => h.callout(1) },
        { at: 'turns away', do: (h) => h.callout(2) },
        { at: `${red.ageDays}-day-old order`, do: (h) => h.callout(3) },
        { at: 'only within', do: async (h) => {
          await h.callout(0);
          await h.lower(`Kane CLI: ${red.status}`, red.reason.split('.').pop());
        } },
      ],
      minMs: 6500,
    },
    // ── 0:11 the agent's own tests pass ─────────────────────────────────────────────────────────────────────────
    {
      id: 'tests',
      chapter: null,
      overlay: stage({ windows: [{ id: 'A', title: 'saydo — npm test with the edited policy, no code changed', box: [150, 260, 1620, 420], font: 31, wrap: true, compact: true, blocks: [block(cap('c2'))] }] }),
      prep: (h) => h.label([['npm test, same edit, same day', 'plain']]),
      narration: `The coding agent's ${take.tests.pass} tests pass, including one that asserts this exact refusal.`,
      actions: [
        { at: "The coding agent's", do: async (h) => {
          await h.s('type', 'A', 0, 650);
          await h.s('out', 'A', 0, 0);
        } },
        { at: `${take.tests.pass} tests pass`, offsetMs: 300, do: (h) => h.s('hl', 'A', `# pass ${take.tests.pass}`, 'ok') },
        { at: 'including one', do: (h) => h.s('hl', 'A', 'ok 24 ', 'bad', true) },
      ],
      minMs: 4000,
    },
    // ── 0:15 which copy each model obeys (probe) ────────────────────────────────────────────────────────────────
    {
      id: 'whichcopy',
      chapter: 'Which copy each model obeys (probe, pre-registered)',
      overlay: stage({ windows: [replayWin('A')] }),
      prep: async (h) => {
        await h.s('crop', 'A', 0, [s1, idx(c3l, '   Kane   ', s1), idx(c3l, 'Kane says', s1)]);
        await h.label([['KANE CLI · recorded · sealed pack', 'kane']]);
      },
      narration:
        `Kane fails the run: confirmed product bug. A number lint finds that ${clause.from}. It can't tell you this: ` +
        `in a pre-registered probe, not Kane, one model moved money it shouldn't ${wc.moved.qwen.n} times in ${wc.moved.qwen.of}, the other ${times(wc.moved.gpt.n)}.`,
      actions: [
        { at: 'Kane fails the run', do: (h) => h.s('hl', 'A', red.reason, 'bad') },
        { at: 'A number lint', do: async (h) => {
          await h.s('crop', 'A', 0, [s3, [idx(c3l, 'qwen3:8b', s3), idx(c3l, 'Same code, same edit', s3) + 1]]);
          await h.label([[`PROBE · not Kane · pre-registered ${wc.prereg}… · ${wc.seeds} seeds, T${wc.temp}`, 'probe']]);
          await h.s('hl', 'A', 'A number lint finds');
        } },
        { at: 'one model moved money', do: (h) => h.s('hl', 'A', 'moved money it should not have', 'bad') },
      ],
      minMs: 6000,
    },
    // ── 0:30 the loop: hook → packet → Claude Code → checks ─────────────────────────────────────────────────────
    {
      id: 'loop',
      chapter: "The loop: Kane's result → packet → Claude Code",
      overlay: stage({
        windows: [
          { id: 'A', title: 'saydo — cat evidence/loop-run-1.log', box: FULL, font: 22, wrap: true, compact: true, blocks: [block(cap('hook'), { shown: true })] },
          { id: 'B', title: `packet.md — ${CASE}/packet.md`, box: FULL, font: 21, editor: true, blocks: [{ cmd: null, lines: cap('packet').out.split('\n'), shown: true }] },
          { id: 'C', title: 'saydo — the fix commit', box: [150, 300, 1620, 300], font: 30, wrap: true, compact: true, blocks: [block(cap('c4'))] },
          replayWin('D'),
        ],
      }),
      prep: async (h) => {
        await h.s('only', 'A');
        await h.s('crop', 'D', 0, [s5, [s5 + 1, s5 + 4]]);
        await h.label([[`KANE CLI · recorded red (${red.at} UTC), replayed by the hook to save credits`, 'kane']]);
      },
      narration:
        `A git hook on the policy file hands Kane's result to Claude Code as one packet: the clause diff, every value Kane stored, and the ${word(loop.inSource)} source lines that still say ${clause.from}. ` +
        `${Word(loop.attempt)} attempt${loop.attempt > 1 ? 's' : ''}: one policy block feeds them all, the money tools fail closed, ${loop.tests} of ${loop.testsOf} tests.`,
      actions: [
        { at: 'A git hook', do: (h) => h.s('hl', 'A', 'policy.md changed in') },
        { at: "hands Kane's result", do: (h) => h.s('hl', 'A', 'overruled: Kane: ', 'bad') },
        { at: 'as one packet', do: async (h) => {
          await h.s('only', 'B');
          await h.label([]);
          await h.s('scroll', 'B', '# Overruled:', 0, 0);
        } },
        { at: 'the clause diff', do: async (h) => {
          await h.s('scroll', 'B', '## What changed on the policy page', 450, 0);
          await h.s('hl', 'B', `| ${clause.id} ${clause.title}`);
        } },
        { at: 'every value Kane stored', do: async (h) => {
          await h.s('scroll', 'B', '## What Kane saw as the customer', 500, 0);
          await h.s('hl', 'B', '## What Kane saw as the customer');
        } },
        { at: 'source lines that still', do: async (h) => {
          await h.s('scroll', 'B', '## Every source line that still restates', 500, 0);
          await h.s('hl', 'B', '## Every source line that still restates');
        } },
        { at: `${Word(loop.attempt)} attempt`, do: async (h) => {
          await h.s('only', 'C');
          await h.label([[`Claude Code · claude -p · attempt ${loop.attempt}`, 'plain']]);
          await h.s('type', 'C', 0, 500);
          await h.s('out', 'C', 0, 0);
        } },
        { at: 'fail closed', do: (h) => h.s('hl', 'C', 'files changed', 'ok') },
        { at: `${loop.tests} of ${loop.testsOf}`, do: async (h) => {
          await h.s('only', 'D');
          await h.label([]);
          await h.s('hl', 'D', `npm test ${loop.tests}/${loop.testsOf}`, 'ok');
        } },
      ],
      minMs: 6000,
    },
    // ── 0:50 WOW: Kane shops again after the fix (the swappable beat: GREEN_TAKE, via take.json) ───────────────────────────────
    greenBeat({ take, green, greenLabel, order }),
    // ── 1:10 the held-out edit ──────────────────────────────────────────────────────────────────────────────────
    {
      id: 'heldout',
      chapter: 'An edit Claude Code never saw (probe)',
      open: { url: `file://${ROOT}${CASE}/case.html?still`, ready: 'table.matrix' },
      overlay: stage({ windows: [replayWin('A')] }),
      prep: async (h) => {
        await h.page.evaluate(() => {
          document.body.style.zoom = '1.32';
          const t = document.querySelector('table.matrix');
          window.scrollTo(0, 0);
          window.scrollTo(0, t.getBoundingClientRect().top - 150);
        });
        await h.s('crop', 'A', 0, [[s7, s7 + 8]]);
        await h.label([[`PROBE · not Kane · held-out v1.2, hash ${ho.hash}… committed in ${ho.commit} before the fix`, 'probe']]);
      },
      narration:
        `Then Operations changes ${word(ho.edits)} more numbers, in an edit written and hashed before the fix and never shown to Claude Code. ` +
        (ho.codeLines === 0 ? 'Nobody touches the code. ' : '') +
        `Unfixed, the store broke it ${ho.pre.qwen.n} and ${ho.pre.gpt.n} times in ${ho.pre.qwen.of}. Fixed: ${word(ho.post.qwen.n)} and ${word(ho.post.gpt.n)}, on both models. ` +
        'Applied halfway, it refuses to move money.',
      actions: [
        { at: 'Then Operations changes', do: (h) => h.s('hl', 'A', '   edit ') },
        { at: 'written and hashed', do: async (h) => {
          await h.s('hl', 'A', `v1.2 hashes to ${ho.hash}`, 'ok');
          await h.s('hl', 'A', `${ho.commit} (the hash) is an ancestor of`, 'ok', true);
        } },
        { at: 'Nobody touches', do: (h) => h.s('hl', 'A', 'code changed since the fix', 'ok') },
        { at: 'Unfixed,', do: async (h) => {
          await h.unoverlay();
          await h.chip(`${CASE}/case.html · Exhibit D`);
          await h.hl('table.matrix tfoot td.bad');
          await h.hl('table.matrix tfoot td.bad ~ td.bad', true);
        } },
        { at: 'Fixed:', do: async (h) => {
          await h.hl('table.matrix tfoot td.good');
          await h.hl('table.matrix tfoot td.good ~ td.good', true);
        } },
        { at: 'Applied halfway', do: async (h) => {
          await h.unhl();
          // The totals row stays in view under the label, the half-applied note below it.
          await h.page.evaluate(() => window.scrollBy({ top: document.querySelector('table.matrix tfoot').getBoundingClientRect().top - 84, behavior: 'smooth' }));
          await h.page.waitForTimeout(700);
          await h.hl('.aside');
        } },
      ],
      minMs: 6000,
    },
    // ── 1:32 overruled sites, on any repo ──────────────────────────────────────────────────────────────────────
    {
      id: 'sites',
      chapter: 'overruled sites: run it on your repo tonight',
      overlay: stage({
        windows: [{
          id: 'A',
          title: 'a scratch folder · before/ = the store at the policy edit, before the fix · after/ = the store at HEAD, fixed',
          box: [60, 92, 1800, 790],
          min: 17.5,
          max: 24,
          lh: 1.22,
          blocks: [block(cap('c8a')), block(cap('c8b')), block(cap('c8c'))],
        }],
      }),
      prep: (h) => h.label([]),
      narration:
        'The part you can install tonight is overruled sites. No dependencies, no model, no Kane. ' +
        'Point it at your policy file and it lists every line that restates a number: constants, prompt text, tool schemas, refusal strings, page copy, even a database check. ' +
        `With residual, it exits ${sites.exitBefore} until none are left. Kane tells you which of those lines a customer actually hits.`,
      actions: [
        { at: 'The part you can install', do: async (h) => {
          await h.s('fitRows', 'A', 29.6);
          await h.s('type', 'A', 0, 1300);
          await h.s('out', 'A', 0, 900);
        } },
        { at: 'constants', do: (h) => h.s('hl', 'A', '[constant]') },
        { at: 'prompt text', do: (h) => h.s('hl', 'A', '[prompt]') },
        { at: 'tool schemas', do: (h) => h.s('hl', 'A', '[tool-schema]') },
        { at: 'refusal strings', do: (h) => h.s('hl', 'A', '[refusal]') },
        { at: 'page copy', do: (h) => h.s('hl', 'A', '[page-copy]') },
        { at: 'database check', do: (h) => h.s('hl', 'A', '[db-check]', 'bad') },
        { at: 'With residual', do: async (h) => {
          await h.s('unhl', 'A');
          await h.s('type', 'A', 1, 1100);
          await h.s('out', 'A', 1, 300);
          await h.s('hl', 'A', `exit=${sites.exitBefore}`, 'bad');
        } },
        { at: 'until none are left', offsetMs: 400, do: async (h) => {
          await h.s('type', 'A', 2, 1000);
          await h.s('out', 'A', 2, 300);
          await h.s('hl', 'A', `exit=${sites.exitAfter}`, 'ok', true);
        } },
      ],
      minMs: 6000,
    },
    // ── 2:00 what is Kane, what is probe; the judges' 30-second path ────────────────────────────────────────────
    {
      id: 'whatskane',
      chapter: 'What is Kane and what is probe',
      overlay: kaneProbeCard({
        kane: [
          ['The red run', 'run --agent · end to end in Chrome · sealed pack'],
          ['The green read after the fix', 'run --analyzer-only · 3 conditions, one a negative control'],
        ],
        probe: [
          ['The which-copy table', 'pre-registered · spike/probe.mjs'],
          ['The held-out edit v1.2', 'hashed before the fix'],
          ['The post-fix conversation', 'through /api/chat, the widget’s endpoint'],
        ],
      }),
      overlay2: stage({ windows: [{ id: 'A', title: 'clone/ — a fresh clone of github.com/mdlog/overruled', box: FULL, max: 26, blocks: [block(cap('c9'))] }] }),
      prep: (h) => h.label([]),
      narration:
        "Here's what's Kane and what isn't. Kane drove the red run end to end and read the result after the fix. " +
        'The which-copy table, the held-out edit and the post-fix conversation ran in our probe, and each one is labelled. ' +
        'Clone the repo, run npm run replay, and it re-checks every hash and the commit order, offline, in seconds.',
      actions: [
        { at: 'Clone the repo', do: async (h) => {
          await h.overlay2();
          await h.s('fitRows', 'A', 28);
          await h.s('type', 'A', 0, 1100);
          const c9 = cap('c9');
          await h.s('out', 'A', 0, c9.lines.map((l) => l.t - c9.lines[0].t + 200));
          await h.s('hl', 'A', 'All checks passed.', 'ok');
        } },
      ],
      minMs: 6000,
    },
    // ── 2:25 why it matters ─────────────────────────────────────────────────────────────────────────────────────
    {
      id: 'why',
      chapter: 'Why it matters',
      open: { url: `https://${REPO}`, ready: 'article.markdown-body img[alt^="Kane, step 20"]', remote: true },
      chip: REPO,
      prep: async (h) => {
        await h.page.evaluate(() => {
          document.body.style.zoom = '1.25';
          const img = document.querySelector('article.markdown-body img[alt^="Kane, step 20"]');
          window.scrollTo(0, 0);
          window.scrollTo(0, img.getBoundingClientRect().top - 260);
        });
      },
      narration:
        'In 2024 a tribunal held Air Canada liable when its chatbot contradicted the policy page it linked to. ' +
        "Your policy page will change again. Overruled makes sure your customer isn't the first to find out what your code still says.",
      actions: [
        { at: 'In 2024', do: (h) => h.lower('Moffatt v. Air Canada', 'BC Civil Resolution Tribunal, 14 Feb 2024', 'neutral') },
        { at: 'Your policy page', do: (h) => h.unlower() },
      ],
      minMs: 6000,
    },
    // ── 2:45 end card ───────────────────────────────────────────────────────────────────────────────────────────
    {
      id: 'end',
      chapter: null,
      overlay: endCard({ repo: REPO, cmd: 'npx github:mdlog/overruled sites policy.md src/', credit: `Claude Code + Kane CLI ${red.kaneVersion}` }),
      narration: 'Overruled. Built with Claude Code and Kane CLI.',
      actions: [],
      minMs: 5000,
      tailMs: 1600,
    },
  ];
}

/**
 * The Kane beat, built from GREEN_TAKE. Top: the loop's own log (`overruled check --green-only`), its probe
 * conversation compressed and labelled with its real speed; bottom: Kane's run.ndjson and its three results. Then a
 * hard cut to the store's /orders as it is now (KEEP_DB=1: the state the conversation left).
 */
function greenBeat({ take, green, greenLabel, order }) {
  const { clause } = take;
  const log = green.lines.map((l) => l.text);
  const convEnd = green.mode === 'recorded'
    ? green.lines.find((l) => l.text.includes('recorded Kane read')).t
    : Date.parse(green.ndLines.length ? JSON.parse(readFileSync(`${ROOT}${green.ndjson}`, 'utf8').split('\n')[0]).ts : green.at) - Date.parse(green.at);
  const firstAt = green.lines[0].t;
  return {
    id: 'green',
    chapter: `Kane shops again after the fix (${green.mode === 'live' ? 'live take' : 'recorded run'})`,
    open: { url: `${STORE}/login-as/cust-ana`, ready: 'text=REFUNDED', store: true },
    chip: null,
    overlay: stage({
      windows: [
        { id: 'A', title: 'saydo — the loop runs its own green', box: [60, 80, 1800, 360], font: 20, lh: 1.25, wrap: true, blocks: [{ cwd: 'saydo', cmd: green.cmd, lines: log }] },
        { id: 'B', title: green.mode === 'live' ? `${CASE.split('/').pop()} — Kane writes run.ndjson` : 'saydo — the Kane read the loop replayed', box: [60, 456, 1800, 410], font: 20, lh: 1.25,
          blocks: [{ cwd: green.mode === 'live' ? CASE.split('/').pop() : 'saydo', cmd: green.ndjsonCmd, lines: green.ndLines.map((l) => l.text) }, { cwd: 'saydo', cmd: green.c6.cmd, lines: green.c6.out.split('\n') }] },
      ],
    }),
    prep: (h) => h.label([]),
    narration:
      "Then the loop sends Kane shopping again. The conversation runs through the widget's own endpoint, and we label that probe. " +
      `Kane signs in as Ana and reads her orders page: ${order} refunded, ${green.runEnd.results[0]}. ${Tens(clause.to)} days, ${green.runEnd.results[1]}. The old ${tens(clause.from)}-day copy: ${green.runEnd.results[2]}.`,
    // record.mjs fills in the speeds from the anchors: real seconds of each segment over the screen seconds it gets.
    green: { convEnd: convEnd - firstAt, firstAt, mode: green.mode, label: greenLabel, lines: green.lines, nd: green.ndLines, timed: green.timed },
    actions: [
      { at: 'Then the loop', do: async (h) => {
        await h.s('type', 'A', 0, 900);
        await h.s('reveal', 'A', 0, 0, 1); // the first line now; the rest at their (compressed) times, below
      } },
      { at: 'The conversation runs', do: (h) => h.greenConversation() },
      { at: 'Kane signs in', do: (h) => h.greenKane() },
      { at: 'reads her orders page', do: async (h) => {
        await h.greenDone();
        await h.s('type', 'B', 1, 450);
        await h.s('out', 'B', 1, 0);
      } },
      { at: `${order} refunded`, do: async (h) => {
        await h.s('hl', 'B', 'condition 1', 'ok');
        await h.s('hl', 'A', `Order ${order} has status REFUNDED`, 'ok');
      } },
      { at: `${Tens(clause.to)} days`, do: async (h) => {
        await h.s('hl', 'B', 'condition 2', 'ok', true);
        await h.s('hl', 'A', `within ${clause.to} days of delivery. →`, 'ok', true);
      } },
      { at: `The old ${tens(clause.from)}-day`, do: async (h) => {
        await h.s('hl', 'B', 'condition 3', 'ok', true);
        await h.s('tag', 'B', 'condition 3', 'negative control: expected false', 'ok');
        await h.s('hl', 'A', `within ${clause.from} days of delivery. →`, 'ok', true);
      } },
      { at: '$end', offsetMs: 700, do: async (h) => {
        await h.unoverlay();
        await h.label([]);
        await h.chip('localhost:3000/orders · the store now');
        await h.hl(`tr:has(td:has-text("#${order}")) .stamp`);
      } },
      { at: '$end', offsetMs: 1700, do: (h) => h.hlText('Refunds are available within', true) },
    ],
    holdAfterMs: 2900,
    minMs: 6000,
  };
}

/** Written tokens of a narration, each with its spoken form (for TTS) and its words as the voice says them. */
export function tokens(narration) {
  return narration
    .split(/\s+/)
    .filter(Boolean)
    .map((written) => {
      const m = written.match(/^(.*?)([.,:;!?]*)$/);
      const spoken = (PRONOUNCE[m[1]] ?? m[1]) + m[2];
      return { written, spoken, words: spoken.split(/\s+/) };
    });
}
export const spokenText = (narration) => tokens(narration).map((t) => t.spoken).join(' ');

if (import.meta.url === `file://${process.argv[1]}`) {
  const take = JSON.parse(readFileSync(`${OUT}take.json`, 'utf8'));
  const dump = beats(take).map((b) => ({
    id: b.id,
    chapter: b.chapter,
    minMs: b.minMs,
    tailMs: b.tailMs ?? 800,
    holdAfterMs: b.holdAfterMs ?? 0,
    narration: b.narration,
    spoken: spokenText(b.narration),
    tokens: tokens(b.narration).map(({ written, words }) => ({ written, words })),
  }));
  writeFileSync(`${OUT}beats.json`, JSON.stringify(dump, null, 2));
  console.log(`beats: ${dump.length}, words: ${dump.reduce((n, b) => n + b.tokens.length, 0)}`);
}
