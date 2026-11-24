// The free shots, captured verbatim (0 Kane credits, no model): every command the terminal beats show, run now,
// output kept as printed (colours included) in out/captures/<id>.json. Also prepares the scratch files those
// commands read, outside the repo: the step-6 still from the sealed pack, the before/after store snapshots for
// `sites`, and an empty folder for the fresh clone.
//
//   node video/capture.mjs            all of them
//   node video/capture.mjs c3 c8a     only these

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CAP, CASE, PACK, ROOT, STEP6, WORK } from './config.mjs';
import { run } from './run.mjs';

const SITES = `${WORK}/sites`;
const CLONE = `${WORK}/clone`;

/** What each terminal shot runs, and where. `prep` runs first, off camera. */
export const SHOTS = {
  c2: { cwd: ROOT, cmd: "grep '^ok 24 ' evidence/npm-test-under-e2.txt; tail -3 evidence/npm-test-under-e2.txt" },
  c3: { cwd: ROOT, cmd: 'npm run -s replay', tty: true },
  hook: { cwd: ROOT, cmd: 'cat evidence/loop-run-1.log' },
  packet: { cwd: ROOT, cmd: `cat ${CASE}/packet.md` },
  c4: { cwd: ROOT, cmd: "git show --shortstat --format='%h %s' 5652674", tty: true },
  c8a: { cwd: SITES, cmd: 'npx -y github:mdlog/overruled sites policy-v1.0.md before/target --source-only', tty: true },
  c8b: { cwd: SITES, cmd: 'npx -y github:mdlog/overruled sites before/target/policy.md before/target --from policy-v1.0.md --residual; echo exit=$?', tty: true },
  c8c: { cwd: SITES, cmd: 'npx -y github:mdlog/overruled sites after/target/policy.md after/target --residual; echo exit=$?', tty: true },
  c9: {
    cwd: CLONE,
    cmd: 'git clone https://github.com/mdlog/overruled && cd overruled && npm run replay',
    tty: true,
    prep: () => {
      rmSync(CLONE, { recursive: true, force: true });
      mkdirSync(CLONE, { recursive: true });
    },
  },
};

function prepWork() {
  mkdirSync(WORK, { recursive: true });
  // VIDEO_SCRIPT C1: the /policy page as Kane saw it, step 6 of the sealed pack, extracted outside the repo.
  execSync(`unzip -p ${PACK} '${STEP6}' > ${WORK}/overruled-step6.jpg`, { cwd: ROOT });
  // DEMO_RUNBOOK "pre-fix snapshot": the store at the policy edit (before the fix), the v1.0 policy, and the store
  // at HEAD (after the fix). git archive writes tracked files only, read-only for the repo.
  rmSync(SITES, { recursive: true, force: true });
  mkdirSync(`${SITES}/before`, { recursive: true });
  mkdirSync(`${SITES}/after`, { recursive: true });
  execSync(`git show fcbbf44~1:target/policy.md > ${SITES}/policy-v1.0.md`, { cwd: ROOT });
  execSync(`git archive fcbbf44 target | tar -x -C ${SITES}/before`, { cwd: ROOT });
  execSync(`git archive HEAD target | tar -x -C ${SITES}/after`, { cwd: ROOT });
  // The npx cache: the first fetch from GitHub takes ~12 s; warm it so the take is not the first.
  execSync('npx -y github:mdlog/overruled sites policy-v1.0.md before/target --source-only > /dev/null', { cwd: SITES });
}

const only = process.argv.slice(2);
mkdirSync(CAP, { recursive: true });
if (only.length === 0 || only.some((id) => id.startsWith('c8'))) prepWork();
else mkdirSync(WORK, { recursive: true });
for (const [id, s] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(id)) continue;
  s.prep?.();
  const r = await run(s.cmd, { cwd: s.cwd, tty: s.tty });
  const display = s.cwd === ROOT ? 'saydo' : s.cwd.replace(`${WORK}/`, '');
  writeFileSync(`${CAP}${id}.json`, JSON.stringify({ id, ...r, cwd: display }, null, 1));
  console.log(`${id.padEnd(7)} exit ${r.exit}  ${String(r.lines.length).padStart(3)} lines  ${(r.ms / 1000).toFixed(1)}s  $ ${s.cmd}`);
}
// The fresh clone is evidence for one shot only; keep the scratch folder small.
if (only.length === 0 || only.includes('c9')) rmSync(`${CLONE}/overruled/node_modules`, { recursive: true, force: true });
// Nothing here may change the repo.
const dirty = execSync('git status --porcelain -- . ":!video" ":!.gitignore"', { cwd: ROOT, encoding: 'utf8' }).trim();
if (dirty) {
  console.error(`the repo changed during capture:\n${dirty}`);
  process.exit(1);
}
readFileSync(`${WORK}/overruled-step6.jpg`);
