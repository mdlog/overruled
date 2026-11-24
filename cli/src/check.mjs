// overruled check: the loop that runs when the policy page changes.
//   1. diff the policy (numbers per clause)
//   2. red: Kane shops as the customer (live run, or a recorded run_end, labelled)
//   3. read the values (final_state, else run_end.context.variables, labelled), judge the pack
//   4. list every line that restates the old number (sites) and the tests that assert it
//   5. packet -> headless Claude Code; free checks (npm test, sites residual, probe);
//      re-prompt with what failed, up to N attempts; then green.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parsePolicy, diffPolicies } from './policy.mjs';
import { findSites } from './sites.mjs';

const sh = (cmd, { cwd, env = {}, timeout = 900_000 } = {}) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status ?? (r.error ? 124 : 1), out: (r.stdout || '') + (r.stderr || '') };
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const fmt = (v, u) => (v == null ? '—' : u === 'usd' ? `$${v}` : u === 'days' ? `${v} days` : `${v}%`);
const log = (...a) => console.log('overruled:', ...a);

// ------------------------------------------------------------------ the store
async function startApp(cfg, root) {
  stopApp(cfg);
  const child = spawn('bash', ['-c', cfg.app.start], { cwd: join(root, cfg.app.dir), env: { ...process.env, ...cfg.app.env }, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (sh(`curl -sf ${cfg.app.base}${cfg.app.health} >/dev/null`).code === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (cfg.app.warmup) sh(cfg.app.warmup, { cwd: root });
}
function stopApp(cfg) { sh(`pkill -f ${JSON.stringify(cfg.app.process_pattern)} ; sleep 1`); }

// ------------------------------------------------------------------ Kane
export function readRunEnd(ndjsonPath) {
  const lines = readFileSync(ndjsonPath, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const e = JSON.parse(lines[i]); if (e.type === 'run_end') return e; } catch { /* not json */ }
  }
  return null;
}
export function kaneValues(runEnd, keys) {
  const fs = runEnd.final_state || {};
  const useFinal = keys.every((k) => k in fs);
  const vars = (runEnd.context && runEnd.context.variables) || {};
  const values = {};
  for (const k of keys) values[k] = useFinal ? fs[k] : vars[k]?.value;
  const missing = keys.filter((k) => values[k] == null);
  return { values, source: useFinal ? 'final_state' : 'run_end.context.variables', missing };
}
function kaneRun(cfg, root, objective, outBase) {
  const k = cfg.kane;
  const cmd = `kane-cli run ${JSON.stringify(objective)} --url ${k.url} --agent --headless --max-steps ${k.max_steps} --timeout ${k.timeout} < /dev/null > ${outBase}.ndjson 2> ${outBase}.stderr`;
  const before = sh('kane-cli balance 2>/dev/null | tail -1').out.trim();
  const r = sh(cmd, { cwd: root, timeout: (k.timeout + 60) * 1000 });
  const after = sh('kane-cli balance 2>/dev/null | tail -1').out.trim();
  const pack = (readFileSync(`${outBase}.stderr`, 'utf8').match(/evidence serve (\S+\.evidence)/) || [])[1] || null;
  return { exit: r.code, runEnd: readRunEnd(`${outBase}.ndjson`), pack, balance: { before, after } };
}
function verdict(cfg, root, pack) {
  if (!pack) return null;
  const r = sh(`kane-cli evidence verdict ${JSON.stringify(pack)} --policy ${JSON.stringify(join(root, cfg.kane.gate))} --json 2>/dev/null`, { cwd: dirname(pack) });
  try {
    const v = JSON.parse(r.out);
    return { result: v.result, failed_gates: v.policies?.flatMap((p) => p.failed_gate_ids) || [], pack_sha256: v.verdicts?.[0]?.pack?.sha256 };
  } catch { return { result: 'error', error: r.out.slice(0, 300) }; }
}

// ------------------------------------------------------------------ free checks
function npmTest(cfg, root) {
  const r = sh(cfg.app.test, { cwd: join(root, cfg.app.dir), timeout: 300_000 });
  const n = (re) => Number((r.out.match(re) || [])[1] || 0);
  return { pass: n(/^# pass (\d+)/m), fail: n(/^# fail (\d+)/m), ok: r.code === 0, tail: r.out.split('\n').filter((l) => /^not ok|^# (pass|fail)/.test(l)).slice(0, 12).join('\n') };
}
function residual(cfg, root, oldPolicy, newPolicy) {
  const appDir = join(root, cfg.app.dir);
  const policyAbs = join(root, cfg.policy);
  const current = parsePolicy(newPolicy).flatMap((c) => c.numbers.map((n) => ({ clause_id: c.id, title: c.title, value: n.value, unit: n.unit })));
  const old = diffPolicies(oldPolicy, newPolicy).filter((d) => d.from != null).map((d) => ({ clause_id: d.clause_id, title: d.title, value: d.from, unit: d.unit }));
  const sites = findSites(appDir, [...current, ...old], { exclude: [policyAbs] }).filter((s) => s.in_source);
  return { count: sites.length, sites };
}
async function probe(cfg, root) {
  await startApp(cfg, root);
  const r = sh(cfg.checks.probe, { cwd: root, env: { RESET_CMD: cfg.app.reset_cmd_from_root }, timeout: 900_000 });
  stopApp(cfg);
  const lines = r.out.split('\n').filter((l) => / seed\d+ /.test(l));
  const bad = lines.filter((l) => /BREACH|OVER-REFUSAL|ERROR/.test(l));
  return { runs: lines.length, bad: bad.length, ok: lines.length > 0 && bad.length === 0, lines };
}

// ------------------------------------------------------------------ packet
function packetMarkdown(p, cfg) {
  const diffRows = p.clause_diffs.map((d) => `| ${d.clause_id} ${d.title} | ${fmt(d.from, d.unit)} | ${fmt(d.to, d.unit)} | ${d.direction} |`).join('\n');
  const vals = Object.entries(p.kane.values).map(([k, v]) => `- \`${k}\`: ${JSON.stringify(v)}`).join('\n');
  const src = p.sites.filter((s) => s.in_source).map((s) => `- \`${s.file}:${s.line}\` [${s.kind}] ${s.text}`).join('\n');
  const tests = p.sites.filter((s) => s.kind === 'test').map((s) => `- \`${s.file}:${s.line}\` ${s.text}`).join('\n');
  const others = (p.other_sites || []).map((s) => `- \`${s.file}:${s.line}\` [${s.kind}] ${s.clause_id} ${fmt(s.value, s.unit)}: ${s.text}`).join('\n');
  return `# Overruled: the store acts on a rule its policy page no longer says

Operations edited \`policy.md\` (commit ${p.policy_commit}). No code changed. Kane then shopped as a customer through the real chat widget.

## What changed on the policy page
| Clause | Was | Now | Direction |
|---|---|---|---|
${diffRows}

## What Kane saw as the customer (${p.kane.source}${p.kane.recorded ? `, recorded run ${p.kane.recorded}` : ''})
Kane: **${p.kane.status}** (${p.kane.reason_code}). "${p.kane.one_liner}"
${vals}
Evidence pack: \`${p.kane.pack || 'n/a'}\`. Gate verdict: ${p.verdict ? `${p.verdict.result} (${p.verdict.failed_gates.join(', ')})` : 'n/a'}.

## Every source line that still restates the old number (${p.sites.filter((s) => s.in_source).length})
${src || '- none found'}

## Source lines that restate the other policy numbers (contract item 2 covers these too)
${others || '- none found'}

## Tests that assert the old rule (your suite is ${p.npm_test.fail ? 'failing' : `green: ${p.npm_test.pass} pass`})
${tests || '- none found'}

## What done looks like
${cfg.fix_contract.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Work only inside this directory. Do not edit the prose of \`policy.md\`, the seed data, or anything outside the app. Do not run git. When you finish, say in two lines what you changed.
`;
}
function assertNoHeldout(text, cfg, root) {
  const f = cfg.heldout_hash_file && join(root, cfg.heldout_hash_file);
  if (!f || !existsSync(f)) return;
  const hash = (readFileSync(f, 'utf8').match(/[0-9a-f]{64}/) || [])[0];
  if (/heldout|held-out|v1\.2/i.test(text) || (hash && text.includes(hash))) throw new Error('packet refused: it references the held-out edit');
}

function runAgent(cfg, root, prompt, transcriptPath) {
  const a = cfg.agent;
  const tools = a.allowed_tools.map((t) => JSON.stringify(t)).join(' ');
  writeFileSync(`${transcriptPath}.prompt.md`, prompt);
  const cmd = `claude -p "$(cat ${JSON.stringify(`${transcriptPath}.prompt.md`)})" --permission-mode acceptEdits --allowedTools ${tools} --append-system-prompt ${JSON.stringify(a.system)} --output-format stream-json --verbose > ${JSON.stringify(transcriptPath)} 2> ${JSON.stringify(`${transcriptPath}.stderr`)}`;
  const r = sh(cmd, { cwd: join(root, cfg.app.dir), timeout: a.timeout_s * 1000 });
  let result = '';
  try {
    const last = readFileSync(transcriptPath, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse().find((e) => e.type === 'result');
    result = last?.result || '';
  } catch { /* no transcript */ }
  return { exit: r.code, result };
}

// ------------------------------------------------------------------ main
export async function check(opts) {
  const configPath = resolve(opts.config || 'overruled.config.json');
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  const root = dirname(configPath);
  const git = (c) => sh(`git ${c}`, { cwd: root }).out.trim();
  const fromRev = opts.from || 'HEAD~1';
  const oldPolicy = git(`show ${fromRev}:${cfg.policy}`);
  const newPolicy = readFileSync(join(root, cfg.policy), 'utf8');
  const clause_diffs = diffPolicies(oldPolicy, newPolicy);
  if (!clause_diffs.length) { log('no policy number changed; nothing to check.'); return { status: 'no-change' }; }
  const policy_commit = git('rev-parse --short HEAD');
  const caseId = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}Z-${policy_commit}`;
  const out = join(root, cfg.out, caseId);
  mkdirSync(out, { recursive: true });
  for (const d of clause_diffs) log(`${d.clause_id} ${d.title}: ${fmt(d.from, d.unit)} → ${fmt(d.to, d.unit)} (${d.direction})`);

  // red
  const clause = clause_diffs[0];
  const objective = (cfg.kane.objectives[clause.clause_id] || '').replace(/\{to\}/g, clause.to).replace(/\{from\}/g, clause.from);
  let red;
  if (opts.recorded) {
    const runEnd = readRunEnd(resolve(opts.recorded));
    red = { runEnd, pack: opts.recordedPack ? resolve(opts.recordedPack) : null, recorded: relative(root, resolve(opts.recorded)) };
    log(`red: recorded Kane run ${red.recorded} (no credits spent)`);
  } else {
    log('red: Kane shops as the customer…');
    sh(cfg.app.reset, { cwd: join(root, cfg.app.dir) });
    await startApp(cfg, root);
    red = kaneRun(cfg, root, objective, join(out, 'kane-red'));
    stopApp(cfg);
  }
  const kv = kaneValues(red.runEnd, cfg.kane.keys);
  const ver = opts.recorded && opts.recordedVerdict ? JSON.parse(readFileSync(resolve(opts.recordedVerdict), 'utf8')) : verdict(cfg, root, red.pack);
  const v = ver && ver.policies ? { result: ver.result, failed_gates: ver.policies.flatMap((p) => p.failed_gate_ids), pack_sha256: ver.verdicts?.[0]?.pack?.sha256 } : ver;
  const kane = {
    status: red.runEnd?.status, reason_code: red.runEnd?.reason_code, one_liner: red.runEnd?.one_liner, credits: red.runEnd?.credits_consumed,
    values: kv.values, source: kv.source, missing: kv.missing, pack: red.pack && relative(root, red.pack), recorded: red.recorded || null,
  };
  log(`Kane: ${kane.status} (${kane.reason_code}) — ${kane.one_liner}`);
  if (kv.missing.length) log(`ERROR: Kane values missing: ${kv.missing.join(', ')}`);
  if (kane.status === 'passed') { log('Kane passed: the store already follows the new rule.'); return { status: 'green-already', kane }; }

  // sites + tests
  const appDir = join(root, cfg.app.dir);
  const oldNums = clause_diffs.filter((d) => d.from != null).map((d) => ({ clause_id: d.clause_id, title: d.title, value: d.from, unit: d.unit }));
  const sites = findSites(appDir, oldNums, { exclude: [join(root, cfg.policy)] });
  const npm_test = npmTest(cfg, root);
  log(`${sites.filter((s) => s.in_source).length} source lines restate the old number; npm test ${npm_test.pass} pass / ${npm_test.fail} fail`);

  const changed = new Set(oldNums.map((n) => `${n.clause_id}|${n.unit}`));
  const other_sites = residual(cfg, root, oldPolicy, newPolicy).sites.filter((s) => !changed.has(`${s.clause_id}|${s.unit}`));
  const packet = { id: caseId, policy_commit, clause_diffs, kane, verdict: v, sites, other_sites, npm_test: { pass: npm_test.pass, fail: npm_test.fail } };
  const md = packetMarkdown(packet, cfg);
  assertNoHeldout(md + JSON.stringify(packet), cfg, root);
  packet.sha256 = sha(md);
  writeFileSync(join(out, 'packet.json'), JSON.stringify(packet, null, 1));
  writeFileSync(join(out, 'packet.md'), md);
  log(`packet ${relative(root, join(out, 'packet.md'))} → Claude Code`);
  if (opts.packetOnly) return { status: 'packet', packet };

  // fix attempts
  const attempts = [];
  let prompt = md;
  const max = Number(opts.maxAttempts || 3);
  for (let n = 1; n <= max; n++) {
    log(`attempt ${n}: Claude Code is fixing…`);
    const agent = runAgent(cfg, root, prompt, join(out, `attempt-${n}.jsonl`));
    // porcelain is "XY path"; git() trims the output, so the first line may have lost its leading space
    const files = git(`status --porcelain -- ${cfg.app.dir}`).split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S{1,2}\s+/, ''));
    const t = npmTest(cfg, root);
    const fixedPolicy = readFileSync(join(root, cfg.policy), 'utf8');
    const res = residual(cfg, root, oldPolicy, fixedPolicy);
    const pr = (t.ok && res.count === 0) ? await probe(cfg, root) : { ok: false, skipped: true, runs: 0, bad: 0, lines: [] };
    const a = { n, files_changed: files, agent_summary: agent.result.slice(0, 600), npm_test: { pass: t.pass, fail: t.fail }, sites_residual: res.count, probe: { runs: pr.runs, bad: pr.bad, skipped: !!pr.skipped } };
    attempts.push(a);
    log(`attempt ${n}: npm test ${t.pass}/${t.pass + t.fail}, residual ${res.count}, probe ${pr.skipped ? 'skipped' : `${pr.runs - pr.bad}/${pr.runs} ok`}`);
    if (t.ok && res.count === 0 && pr.ok) {
      if (!opts.noCommit) {
        sh(`git add -A -- ${cfg.app.dir} && git commit -q -m "overruled: Claude Code fix, attempt ${n} (case ${caseId})"`, { cwd: root, env: { OVERRULED_RUNNING: '1' } });
        a.commit = git('rev-parse --short HEAD');
      }
      a.next = 'kane';
      break;
    }
    a.next = n < max ? 'reprompt' : 'stop';
    const why = [
      !t.ok && `npm test fails:\n${t.tail}`,
      res.count && `${res.count} source line(s) still restate a policy number:\n${res.sites.map((s) => `- ${s.file}:${s.line} ${s.text}`).join('\n')}`,
      !pr.skipped && !pr.ok && `As a customer the store still breaks the new rule:\n${pr.lines.join('\n')}`,
    ].filter(Boolean).join('\n\n');
    prompt = `${md}\n\n## Attempt ${n} was not done yet\n${why}\n\nFix these and finish.`;
  }
  writeFileSync(join(out, 'attempts.json'), JSON.stringify(attempts, null, 1));
  const fixed = attempts.at(-1)?.next === 'kane';

  // green
  let green = null;
  if (fixed && opts.kaneGreen) {
    log('green: Kane shops again…');
    sh(cfg.app.reset, { cwd: appDir });
    await startApp(cfg, root);
    const g = kaneRun(cfg, root, objective, join(out, 'kane-green'));
    stopApp(cfg);
    green = { status: g.runEnd?.status, reason_code: g.runEnd?.reason_code, one_liner: g.runEnd?.one_liner, credits: g.runEnd?.credits_consumed, ...kaneValues(g.runEnd, cfg.kane.keys), pack: g.pack && relative(root, g.pack), verdict: verdict(cfg, root, g.pack), balance: g.balance };
    log(`green: Kane ${green.status} — ${green.one_liner}`);
  } else if (fixed) {
    green = { status: 'not-run', note: 'reduced plan: Kane green not run (credits). The probe check above is the labelled stand-in.' };
  }
  const summary = { case: caseId, policy_commit, clause_diffs, kane, verdict: v, sites_in_source: sites.filter((s) => s.in_source).length, attempts, fixed, green };
  writeFileSync(join(out, 'case.json'), JSON.stringify(summary, null, 1));
  try {
    const { writeCase } = await import('./case-html.mjs');
    const r = writeCase({ caseDir: out, root, labels: cfg.kane.labels || {} });
    log(`case page ${relative(root, r.out)} (offline, ${Math.round(r.bytes / 1024)} KB)`);
  } catch (e) { log(`case page not written: ${e.message}`); }
  log(fixed ? `fixed in ${attempts.length} attempt(s); case ${relative(root, out)}` : `not fixed after ${attempts.length} attempt(s); case ${relative(root, out)}`);
  return summary;
}
