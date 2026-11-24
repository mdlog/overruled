# video/: the Overruled demo, built by script

`docs/VIDEO_SCRIPT.md` (one level above this repo) is the script. This folder turns it into
`video/out/overruled-demo.mp4`. No screen recorder, no human voice.

- Terminal shots are real commands, captured to `out/captures/*.json` and drawn as terminal windows.
- Browser shots are the real store, the real `case.html` and the real GitHub page, filmed with Chromium.
- The narration is edge-tts. Every on-screen action is timed to a word of it.
- Every number in the narration or on screen comes from `out/take.json`. `select.mjs` builds that file from the
  captures and the committed evidence, and refuses when two sources disagree.

The whole pipeline spends **0 Kane CLI credits**. The only command here that spends credits is
`capture-green.mjs --live` (see [the Kane beat](#the-kane-beat-recorded-now-live-later)).

## Run it (from `saydo/`)

```sh
npm --prefix video install                                  # playwright-core (uses the cached Chromium 1243)
python3 -m venv video/.venv && video/.venv/bin/pip install edge-tts

node video/capture.mjs              # terminal shots, 0 credits; needs network (npx github:..., git clone)
node video/capture-green.mjs        # the Kane beat's source, 0 credits (--recorded-green); needs Ollama and port 3000
node video/select.mjs               # -> out/take.json (every number), with cross-checks
node video/beats.mjs                # -> out/beats.json (narration per beat)
video/.venv/bin/python video/tts.py # -> out/tts/ (measures the take: 172 s budget at +0%)
node video/record.mjs               # -> out/clips/, out/timeline.json (starts and stops the store itself)
video/.venv/bin/python video/build.py   # -> out/overruled-demo.mp4, .srt, captions.ass, youtube.md
bash video/verify.sh                # checks + out/contact.png (a frame every 5 s): look at it
```

- `node video/record.mjs green heldout` re-films only those beats; the others keep their clips. `--probe` runs a
  beat's actions without filming them.
- `VIDEO_DEBUG=1` logs each action as it fires.
- Narration changed? Run `video/.venv/bin/python video/tts.py <beat>` to re-voice only that beat, then re-film it.

## Files

| file | what it does |
|---|---|
| `config.mjs` | paths, the case, the store, and **`GREEN_TAKE`**: the Kane beat's source |
| `run.mjs` | runs a command like a terminal (optionally under a pty for colours) and keeps every line with its time. Refuses output that holds an e-mail address, and `git log`/`git show` without `--format='%h %s'` |
| `capture.mjs` | the free terminal shots (C2, C3, C4, C8, C9, hook log, packet). Prepares the scratch folder (`VIDEO_WORK`, default in the session scratchpad): the step-6 still via `unzip -p`, `sites` before/after snapshots, an empty clone folder. Nothing is written into the repo |
| `capture-green.mjs` | the Kane beat's source (C5 + C6) |
| `kane-results.mjs` | C6: Kane's three condition results from a run.ndjson |
| `select.mjs` | `out/take.json`: every number spoken or shown, cross-checked |
| `beats.mjs` | the 11 beats: narration (from take.json), what is on screen, actions anchored to words |
| `scenes.mjs` | the terminal stage, label pills, lower thirds, the still viewer, the two cards |
| `tts.py` / `captions.py` / `build.py` | voice, captions (burned in + SRT, chips bottom left), assembly and youtube.md |
| `record.mjs` | films each beat by CDP screencast. For the store beat it starts the store (`KEEP_DB=1`, the loop's env) and refuses unless /orders shows 1042 REFUNDED and "within 60 days" |
| `verify.sh` | format (≤180 s, 1080p30 h264, AAC 48 kHz), banned words in the title, the VO and on-screen text before 0:15, no e-mail, labels, chapters, repo clean, store stopped |

`out/`, `node_modules/` and `.venv/` are git-ignored. `out/clips/` holds JPEG frames (about 300 MB). `build.py`
needs every beat's clips.

## The Kane beat: recorded now, live later

The beat at 0:51 (VIDEO_SCRIPT C5/C6, "Kane shops again after the fix") films one capture of
`overruled check --green-only`. The capture holds:

- the loop's log, with the time of every line
- the run.ndjson Kane wrote
- Kane's three results
- the label

`select.mjs` reads the capture that **`GREEN_TAKE`** points at and records it in `take.json`. `beats.mjs`,
`record.mjs` and `build.py` follow `take.json`.

**Now (default, 0 credits): `out/captures/green-recorded.json`**

- It comes from
  `node cli/bin/overruled.mjs check --green-only evidence/loop/2026-11-24T0720Z-fcbbf44 --recorded-green evidence/kane/green-read/run.ndjson`.
- The probe conversation runs for real. Kane's read is the committed 08:04 record.
- Afterwards `capture-green.mjs` restores `case.json` and removes the new `kane-green-*/`.
- Label: `KANE CLI · recorded 08:04 UTC · run --analyzer-only · 3 conditions`.
- Chapter: "(recorded run)".

### Swap in the live take (re-shoot this beat only, then rebuild)

Run from `saydo/`. Before you start:

- Nothing else may hold port 3000. Other sessions' Remotion renders also use port 3000; `ss -ltnp | grep :3000` shows them.
- Ollama must be up.
- `git status -- evidence/loop/2026-11-24T0720Z-fcbbf44` must be clean.

```sh
node video/capture-green.mjs --live
#   THE one live Kane take (~5 credits): kane-cli run --analyzer-only, run by the loop. Prints its log as it goes.
#   -> video/out/captures/green-live.json. It leaves evidence/loop/<case>/kane-green-*/ and case.json changed:
#      `npm run case`, then commit them (VIDEO_SCRIPT recording order).
GREEN_TAKE=video/out/captures/green-live.json node video/select.mjs
#   refuses a take whose results are not [true,true,false] or whose loop did not exit 0. Then stop: the cut keeps
#   the recorded beat (VIDEO_SCRIPT: never retry).
node video/record.mjs green              # re-films only this beat (restarts the store with KEEP_DB=1, stops it after)
video/.venv/bin/python video/build.py
bash video/verify.sh                     # after the live take's files are committed; before that, the "case dir
                                         # clean" and "git" checks fail as expected
```

What changes on its own:

- The label becomes `KANE CLI · live take · run --analyzer-only · 3 conditions · N×`. N is the real Kane time divided
  by the seconds the narration gives it; the bottom window's title bar shows a clock in real time.
- The bottom window becomes `tail -F kane-green-*/run.ndjson | cut -c1-140`, with lines appearing at Kane's own times.
- The chapter reads "(live take)".
- youtube.md names the live source.

The narration does not change. It says only the three results, and `select.mjs` already requires them, so no
re-voicing is needed.

**If you ran the take by hand** (VIDEO_SCRIPT C5: `node cli/bin/overruled.mjs check --green-only <case> | tee stdout.txt`):

```sh
node video/capture-green.mjs --import stdout.txt evidence/loop/2026-11-24T0720Z-fcbbf44/kane-green-<ts>/run.ndjson
```

This writes the same `green-live.json` at 0 credits. A tee'd log has no line times, so the loop's lines appear
together. Kane's NDJSON keeps its own times. Then continue from the `GREEN_TAKE=... select.mjs` line above.

**To go back to the recorded beat:** run `node video/select.mjs` (no `GREEN_TAKE`), then `node video/record.mjs green`,
then `build.py`.

## Rules the scripts enforce

- 0 credits: no `kane-cli run`, and no `overruled check` without `--recorded-green`, except `capture-green.mjs --live`.
- The store is filmed only on port 3000, only when nothing else holds the port, and is stopped afterwards (`record.mjs`
  `finally`). `verify.sh` checks that it is stopped.
- Never on screen:
  - an e-mail address (`run.mjs` refuses one; `verify.sh` scans the captures)
  - `tui.log` / `result.yaml`
  - a `git log`/`git show` without `--format='%h %s'`
- Banned words (VIDEO_SCRIPT) in the title, the VO before 0:15 and the on-screen text before 0:15:
  - Checked by `verify.sh`.
  - The "on-screen text" is what `record.mjs` read off the screen at every action (`timeline.json` → `seen`), plus
    the stills' text.
- Labels: `KANE CLI · recorded …` on Kane artifacts, `PROBE · not Kane …` on probe artifacts, none on local commands.
  Each is a pill at the top left.
