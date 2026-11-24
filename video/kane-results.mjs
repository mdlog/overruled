// VIDEO_SCRIPT C6 as a file, so the terminal shows a short command: Kane's three results from a run.ndjson, one
// line per condition, then the raw run_end. Same logic as the C6 one-liner.
//
//   node video/kane-results.mjs <run.ndjson>

import { readFileSync } from 'node:fs';

for (const l of readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
  const e = JSON.parse(l);
  if (e.step) console.log(`condition ${e.step}  ${e.remark.split(';').pop().trim()}`);
  if (e.type === 'run_end')
    console.log(`run_end  ${e.status} · ${e.duration} s · ${(+e.credits_consumed).toFixed(2)} credits · results ${JSON.stringify(e.condition_results)}`);
}
