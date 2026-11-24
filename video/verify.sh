#!/usr/bin/env bash
# Checks the built demo video against the brief before anyone uploads it. Run from anywhere:
#   bash video/verify.sh
# Exit 0 only if every check passes. Also (re)writes out/contact.png: one frame every 5 s, to look at.
set -uo pipefail

VIDEO="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$VIDEO")"
OUT="$VIDEO/out"
MP4="$OUT/overruled-demo.mp4"
FFMPEG="${FFMPEG:-$HOME/.local/bin/ffmpeg}"
FFPROBE="${FFPROBE:-$HOME/.local/bin/ffprobe}"
CASE="evidence/loop/2026-11-24T0720Z-fcbbf44"
fails=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }

echo "files"
for f in "$MP4" "$OUT/overruled-demo.srt" "$OUT/youtube.md" "$OUT/timeline.json" "$OUT/take.json"; do
  [ -s "$f" ] && ok "${f#$ROOT/}" || bad "missing or empty: ${f#$ROOT/}"
done
[ -s "$MP4" ] || { echo "no video; stopping"; exit 1; }

echo "format"
dur=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$MP4")
v=$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate -of csv=p=0 "$MP4")
a=$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate -of csv=p=0 "$MP4")
awk -v d="$dur" 'BEGIN { exit !(d > 0 && d <= 180) }' && ok "duration ${dur}s (cap 180 s)" || bad "duration ${dur}s is over 180 s"
[ "$v" = "h264,1920,1080,30/1" ] && ok "video $v" || bad "video is '$v', want h264,1920,1080,30/1"
[ "$a" = "aac,48000" ] && ok "audio $a" || bad "audio is '$a', want aac,48000"
mean=$("$FFMPEG" -hide_banner -i "$MP4" -af volumedetect -vn -f null - 2>&1 | sed -n 's/.*mean_volume: \(-\?[0-9.]*\) dB/\1/p')
awk -v m="$mean" 'BEGIN { exit !(m != "" && m > -40) }' && ok "narration audible (mean ${mean} dB)" || bad "audio is silent or missing (mean '${mean}' dB)"

echo "contact sheet"
if "$FFMPEG" -v error -y -i "$MP4" -vf "fps=1/5,scale=480:-1,tile=6x6:padding=6:margin=6" -frames:v 1 "$OUT/contact.png"; then
  ok "out/contact.png written (look at it)"
else
  bad "could not write out/contact.png"
fi

echo "words, numbers and labels"
VIDEO="$VIDEO" ROOT="$ROOT" python3 - <<'PY' || fails=$((fails + 1))
import json, os, re, sys
from pathlib import Path

video = Path(os.environ["VIDEO"]); out = video / "out"; root = Path(os.environ["ROOT"])
BANNED = re.compile(r"drift|doc|spec|reconcile|gate|ship|prove", re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]")
bad = 0
def fail(msg):
    global bad
    bad += 1
    print(f"  FAIL  {msg}")
def ok(msg):
    print(f"  ok    {msg}")

def hits(text):
    return sorted({m.group(0).lower() + ":" + text[max(0, m.start() - 12):m.end() + 12].replace("\n", " ") for m in BANNED.finditer(text)})

# The title.
md = (out / "youtube.md").read_text()
title = re.search(r"\*\*Title\*\*[^`]*`([^`]+)`", md).group(1)
h = hits(title)
fail(f"title has banned words: {h}") if h else ok(f"title clean ({len(title)} chars): {title}")
if len(title) > 100: fail("title is over 100 characters")

# Narration whose cue starts before 15 s (the SRT is what the voice says, cue by cue).
srt = (out / "overruled-demo.srt").read_text()
def secs(t):
    hh, mm, rest = t.split(":"); ss, ms = rest.split(",")
    return int(hh) * 3600 + int(mm) * 60 + int(ss) + int(ms) / 1000
early_vo = []
for block in srt.strip().split("\n\n"):
    lines = block.split("\n")
    start = secs(lines[1].split(" --> ")[0])
    if start < 15: early_vo.append(" ".join(lines[2:]))
h = hits(" ".join(early_vo))
fail(f"VO before 0:15 has banned words: {h}") if h else ok(f"VO before 0:15 clean ({len(early_vo)} cues)")

# On-screen text before 15 s: what the recorder read off the screen at every action, the stills' text, and chips.
timeline = json.loads((out / "timeline.json").read_text())
at, screen = 0.0, []
starts = {}
for clip in timeline:
    starts[clip["id"]] = at
    if at < 15:
        screen += [s["text"] for s in clip["seen"] if at + s["t"] / 1000 < 15]
        screen += clip.get("imageText", [])
        screen += [c["text"] for c in clip.get("chips", []) if at + c["t"] / 1000 < 15]
    at += clip["durMs"] / 1000
h = hits("\n".join(screen))
fail(f"on-screen text before 0:15 has banned words: {h[:8]}") if h else ok(f"on-screen text before 0:15 clean ({len(screen)} snapshots)")

# No e-mail address anywhere a viewer or uploader sees it.
texts = {"srt": srt, "youtube.md": md, "timeline": json.dumps(timeline)}
for p in sorted((out / "captures").rglob("*")):
    if p.is_file() and p.suffix in (".json", ".log", ".jsonl", ".txt"): texts[str(p.relative_to(out))] = p.read_text(errors="replace")
leaked = [k for k, v in texts.items() if EMAIL.search(v)]
fail(f"e-mail address in: {leaked}") if leaked else ok(f"no e-mail address ({len(texts)} files)")

# Every Kane artifact carries a KANE CLI label, every probe artifact a PROBE label (spot checks per beat).
want = {"policy": "KANE CLI · recorded", "catch": "KANE CLI · recorded", "whichcopy": "PROBE · not Kane", "loop": "KANE CLI · recorded red",
        "green": "PROBE · conversation", "heldout": "PROBE · not Kane"}
for bid, label in want.items():
    clip = next((c for c in timeline if c["id"] == bid), None)
    if not clip or not any(label in s["text"] for s in clip["seen"]): fail(f"{bid}: no '{label}' label seen")
green = next(c for c in timeline if c["id"] == "green")
if not any("KANE CLI · " in s["text"] for s in green["seen"]): fail("green: no KANE CLI label seen")
ok("labels present on the Kane and probe beats")

# Numbers on screen and in the VO come from take.json; the Kane beat says where it came from.
take = json.loads((out / "take.json").read_text())
g = take["green"]
if not g.get("label", "").startswith("KANE CLI · "): fail(f"green label is {g.get('label')!r}")
else: ok(f"Kane beat: {g['label']} ({g['mode']}, {g['take']})")
for needle in (f"{take['tests']['pass']} tests pass", f"{take['loop']['tests']} of {take['loop']['testsOf']} tests"):
    (ok if needle in srt.replace("\n", " ") else fail)(f"VO says '{needle}' (take.json)")

# Chapters in youtube.md start at 0:00 and match the timeline.
chap = re.findall(r"^(\d+):(\d\d) (.+)$", md, re.M)
if not chap or chap[0][:2] != ("0", "00"): fail("chapters do not start at 0:00")
else: ok(f"{len(chap)} chapters, first at 0:00")
for m, s, name in chap:
    if int(m) * 60 + int(s) >= at: fail(f"chapter '{name}' starts after the end")

print(f"  beat starts: " + ", ".join(f"{k} {int(v // 60)}:{v % 60:04.1f}" for k, v in starts.items()))
sys.exit(1 if bad else 0)
PY

echo "repository and machine state"
cd "$ROOT"
st=$(git status --porcelain)
extra=$(printf '%s\n' "$st" | grep -v -e '^ M \.gitignore$' -e '^?? video/$' | grep -v '^$' || true)
[ -z "$extra" ] && ok "git: only .gitignore and video/ changed (nothing committed by the pipeline)" || bad "git has other changes: $extra"
[ -z "$(git status --porcelain -- "$CASE")" ] && ok "$CASE clean" || bad "$CASE has changes (restore: git checkout -- $CASE/case.json)"
git check-ignore -q video/out/x && git check-ignore -q video/node_modules/x && git check-ignore -q video/.venv/x && ok "video/out, node_modules, .venv ignored" || bad ".gitignore misses video/out, node_modules or .venv"
if pgrep -f 'disable-warning=ExperimentalWarning server[.]js' >/dev/null; then bad "the store is still running (pkill -f 'disable-warning=ExperimentalWarning server[.]js')"; else ok "store stopped"; fi

echo
[ "$fails" -eq 0 ] && echo "verify: all checks passed" || echo "verify: $fails check(s) failed"
exit $((fails > 0))
