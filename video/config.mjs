// Shared paths and the one switch for the Kane beat. Every other value the video states is read from a capture or
// a committed file by select.mjs; nothing here is a number the narration says.

import { existsSync } from 'node:fs';

export const VIDEO = new URL('./', import.meta.url).pathname;
/** The repo root (saydo/). Commands on screen run from here unless a capture says otherwise. */
export const ROOT = new URL('../', import.meta.url).pathname;
export const OUT = `${VIDEO}out/`;
/** Verbatim output of every command filmed (capture.mjs, capture-green.mjs). */
export const CAP = `${OUT}captures/`;
/**
 * Scratch space outside the repo: the step-6 still from the sealed pack, the before/after snapshots for `sites`, the
 * fresh clone. Never inside the repo.
 */
export const WORK =
  process.env.VIDEO_WORK ?? '/tmp/claude-1000/-home-mdlog-Project-MDlabs/37c7791a-c290-4bbd-bca5-24035c66d8da/scratchpad/video-work';

/** Chromium from Playwright's cache (playwright-core 1.64.1). */
export const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
/** The fixed store (npm run store). */
export const STORE = 'http://localhost:3000';
export const STORE_PATTERN = 'disable-warning=ExperimentalWarning server[.]js';
export const REPO = 'github.com/mdlog/overruled';
export const CASE = 'evidence/loop/2026-11-24T0720Z-fcbbf44';
export const PACK = 'evidence/kane/e2-pack/b089bcc1-8547-49a5-a4d5-11d73186c7fd.evidence';
export const STEP6 = 'tests/you-are-ana-a-signed-in-customer-of-trai-e3f73219/steps/6-0-6/screenshot.jpg';

/**
 * THE KANE BEAT (0:50-1:10). One value: the capture of `overruled check --green-only` that the beat shows: its log
 * lines with their times, the run.ndjson Kane wrote (or the committed record), the three results and the label.
 *   recorded (default, 0 credits): node video/capture-green.mjs          -> out/captures/green-recorded.json
 *   live take (about 5 credits):    node video/capture-green.mjs --live   -> out/captures/green-live.json
 * Point GREEN_TAKE at the one to film. Unset, the beat films the live take when its capture exists (the take was
 * filmed on 2026-11-24 09:51 UTC and committed in c01e42b), else the recorded one. select.mjs refuses a take whose
 * conditions did not come out as expected (VIDEO_SCRIPT: never retry, fall back).
 */
export const GREEN_TAKE = process.env.GREEN_TAKE ?? (existsSync(`${CAP}green-live.json`) ? `${CAP}green-live.json` : `${CAP}green-recorded.json`);
export const greenTakeExists = () => existsSync(GREEN_TAKE);
