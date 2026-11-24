"""Narration: one MP3 per beat (edge-tts, en-US-AndrewNeural) plus the time of every written token, so record.mjs can
anchor actions to phrases and captions.py can time cues. Measures the take and re-renders faster once if it would run
over the budget.

    video/.venv/bin/python video/tts.py
"""

import asyncio
import difflib
import json
import random
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

VIDEO = Path(__file__).resolve().parent
OUT = VIDEO / "out"
TTS = OUT / "tts"
VOICE = "en-US-AndrewNeural"
TAIL_S = 0.8  # a clip holds this long after its narration ends, unless its beat sets tailMs
BUDGET_S = 172.0  # the skill's rule: over 172 s at +0% -> +6%; still over -> VIDEO_SCRIPT's cut order (2:25-2:45, then 2:00-2:25)
FFPROBE = Path.home() / ".local/bin/ffprobe"


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


async def synth(text: str, rate: str, mp3: Path) -> list[dict]:
    """Writes the MP3 and returns the word boundaries (seconds); retries when the voice service is briefly down."""
    for attempt in range(12):
        try:
            words = await synth_once(text, rate, mp3)
            await asyncio.sleep(1.5)  # back-to-back requests get "No audio was received" in streaks
            return words
        except Exception as e:  # the service answers 503 or no audio now and then
            if attempt == 11:
                raise
            print(f"    voice service: {str(e)[:60]}; retrying")
            await asyncio.sleep(4 + 3 * attempt + random.random() * 3)
    raise AssertionError


async def synth_once(text: str, rate: str, mp3: Path) -> list[dict]:
    com = edge_tts.Communicate(text, VOICE, rate=rate, boundary="WordBoundary")
    words = []
    with mp3.open("wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"w": chunk["text"], "s": start, "e": start + chunk["duration"] / 1e7})
    return words


def align(tokens: list[dict], bounds: list[dict]) -> list[dict]:
    """Times of each written token from the voice's word boundaries; spoken sub-words map back to their token."""
    spoken = [(i, w) for i, t in enumerate(tokens) for w in t["words"] if norm(w)]
    a = [norm(w) for _, w in spoken]
    b = [norm(x["w"]) for x in bounds]
    at: list[int | None] = [None] * len(a)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            at[blk.a + k] = blk.b + k
    # A spoken word the voice reported differently takes its neighbours' boundary.
    for k in range(len(at)):
        if at[k] is None:
            prev = next((at[j] for j in range(k - 1, -1, -1) if at[j] is not None), None)
            nxt = next((at[j] for j in range(k + 1, len(at)) if at[j] is not None), None)
            at[k] = prev if prev is not None else nxt
    times = []
    for i, t in enumerate(tokens):
        idx = [at[k] for k, (ti, _) in enumerate(spoken) if ti == i and at[k] is not None]
        if not idx:
            times.append(None)
            continue
        times.append({"w": t["written"], "s": round(bounds[min(idx)]["s"], 3), "e": round(bounds[max(idx)]["e"], 3)})
    # A token without a spoken word (rare) inherits the previous token's end.
    for i, x in enumerate(times):
        if x is None:
            prev_end = times[i - 1]["e"] if i and times[i - 1] else 0.0
            times[i] = {"w": tokens[i]["written"], "s": prev_end, "e": prev_end}
    return times


def duration(mp3: Path) -> float:
    out = subprocess.run([str(FFPROBE), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp3)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


async def render(beats: list[dict], rate: str) -> float:
    total = 0.0
    for b in beats:
        mp3 = TTS / f"{b['id']}.mp3"
        bounds = await synth(b["spoken"], rate, mp3)
        dur = duration(mp3)
        tokens = align(b["tokens"], bounds)
        (TTS / f"{b['id']}.json").write_text(json.dumps({"id": b["id"], "rate": rate, "duration": dur, "tokens": tokens}, indent=1))
        clip = max(dur + b.get("tailMs", TAIL_S * 1000) / 1000 + b.get("holdAfterMs", 0) / 1000, b["minMs"] / 1000)
        total += clip
        print(f"  {b['id']:13s} audio {dur:5.1f}s  clip {clip:5.1f}s  words {len(tokens)}")
    return total


def main() -> None:
    TTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(["node", str(VIDEO / "beats.mjs")], check=True)
    beats = json.loads((OUT / "beats.json").read_text())
    only = sys.argv[1:]
    if only:  # re-voice the named beats at the take's rate; the others keep their audio (and the timings filmed to it)
        rate = json.loads((TTS / "summary.json").read_text())["rate"]
        asyncio.run(render([b for b in beats if b["id"] in only], rate))
        return
    for rate in ("+0%", "+6%"):
        print(f"rate {rate}")
        total = asyncio.run(render(beats, rate))
        print(f"projected length {total:.1f}s (budget {BUDGET_S:.0f}s)")
        if total <= BUDGET_S:
            (TTS / "summary.json").write_text(json.dumps({"rate": rate, "projected": round(total, 2)}))
            return
    sys.exit("over budget even at +6%: cut narration in VIDEO_SCRIPT's order (the 'why' beat 2:25-2:45 first, then 'whatskane'); never 0:00-1:10")


if __name__ == "__main__":
    main()
