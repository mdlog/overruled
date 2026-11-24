"""Assembles out/overruled-demo.mp4: each beat's screencast frames become an exact-length 30 fps clip, the clips are
joined, each narration is laid on its clip's start (padded to the clip's length), loudness is normalised to -14 LUFS,
and the captions are burned in. Also writes out/youtube.md: title, description and chapters from the real timeline.

    video/.venv/bin/python video/build.py
"""

import json
import subprocess
from pathlib import Path

import captions

VIDEO = Path(__file__).resolve().parent
OUT = VIDEO / "out"
BUILD = OUT / "build"
FFMPEG = str(Path.home() / ".local/bin/ffmpeg")
REPO = "https://github.com/mdlog/overruled"


def ff(*args: str, cwd: Path | None = None) -> None:
    subprocess.run([FFMPEG, "-v", "error", "-y", *args], check=True, cwd=cwd)


def frame_list(clip: dict) -> Path:
    """ffconcat list showing, from t0 to t0 + length, whichever screencast frame was on screen."""
    d = Path(clip["dir"])
    frames = json.loads((d / "frames.json").read_text())
    t0, t1 = clip["t0"], clip["t0"] + clip["durMs"] / 1000
    first = max((i for i, f in enumerate(frames) if f["t"] <= t0), default=0)
    sel = [f for f in frames[first:] if f["t"] < t1]
    lines = ["ffconcat version 1.0"]
    for k, f in enumerate(sel):
        start = t0 if k == 0 else f["t"]
        end = sel[k + 1]["t"] if k + 1 < len(sel) else t1
        if end - start <= 0:
            continue
        lines += [f"file '{d / f['name']}'", f"duration {end - start:.4f}"]
    lines.append(f"file '{d / sel[-1]['name']}'")
    out = BUILD / f"{clip['id']}.ffconcat"
    out.write_text("\n".join(lines) + "\n")
    return out


def normalize(src: Path, dst: Path) -> None:
    """Two-pass EBU R128 loudness normalisation to -14 LUFS (true peak -1.5 dBTP)."""
    target = "I=-14:TP=-1.5:LRA=11"
    probe = subprocess.run([FFMPEG, "-hide_banner", "-i", str(src), "-af", f"loudnorm={target}:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, check=True).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    ff("-i", str(src), "-af",
       f"loudnorm={target}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
       f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000",
       "-c:a", "pcm_s16le", str(dst))


def clip_video(clip: dict) -> Path:
    mp4 = BUILD / f"{clip['id']}.mp4"
    ff("-f", "concat", "-safe", "0", "-i", str(frame_list(clip)),
       "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
       "-t", f"{clip['durMs'] / 1000:.3f}", "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", str(mp4))
    return mp4


def assemble(clips: list[dict]) -> Path:
    final = OUT / f"{captions.NAME}.mp4"
    (BUILD / "video.ffconcat").write_text("ffconcat version 1.0\n" + "".join(f"file '{BUILD / c['id']}.mp4'\n" for c in clips))
    ff("-f", "concat", "-safe", "0", "-i", str(BUILD / "video.ffconcat"), "-c", "copy", str(BUILD / "video.mp4"))

    inputs, chains = [], []
    for i, clip in enumerate(clips):
        inputs += ["-i", str(OUT / "tts" / f"{clip['id']}.mp3")]
        dur = clip["durMs"] / 1000
        chains.append(f"[{i}:a]aresample=48000,apad=whole_dur={dur:.3f},atrim=0:{dur:.3f}[a{i}]")
    graph = ";".join(chains) + ";" + "".join(f"[a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[out]"
    ff(*inputs, "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", str(BUILD / "narration.wav"))
    normalize(BUILD / "narration.wav", BUILD / "audio.wav")

    # libass resolves the subtitle path relative to the working directory: run from out/. Fade in from and out to black.
    total = sum(c["durMs"] for c in clips) / 1000
    fades = f"fade=t=in:st=0:d=0.4,fade=t=out:st={total - 0.9:.3f}:d=0.9"
    ff("-i", str(BUILD / "video.mp4"), "-i", str(BUILD / "audio.wav"), "-vf", f"ass=captions.ass,{fades}",
       "-af", f"afade=t=out:st={total - 0.6:.3f}:d=0.6",
       "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", "30",
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest", str(final), cwd=OUT)
    return final


def chapters(clips: list[dict]) -> list[tuple[int, str]]:
    """One chapter per beat that names one; a beat without a chapter continues the one before it."""
    rows, at = [], 0.0
    for clip in clips:
        if clip.get("chapter"):
            rows.append((int(at), clip["chapter"]))
        at += clip["durMs"] / 1000
    return rows


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    timeline = json.loads((OUT / "timeline.json").read_text())
    take = json.loads((OUT / "take.json").read_text())
    for clip in timeline:
        clip_video(clip)
    total = captions.write(timeline)
    print(f"built {assemble(timeline)} ({total:.1f}s)")

    c, red = take["clause"], take["red"]
    title = f"Overruled: the support bot says {c['to']} days, then refuses a {red['ageDays']}-day return (Kane CLI + Claude Code)"
    chap = "\n".join(f"{s // 60}:{s % 60:02d} {name}" for s, name in chapters(timeline))
    green = take["green"]
    (OUT / "youtube.md").write_text(f"""# YouTube upload: Overruled demo

- **File:** `video/out/{captions.NAME}.mp4` ({total:.1f} s, 1080p30, AAC). Captions: `video/out/{captions.NAME}.srt` (English; also burned in).
- **Title** ({len(title)} characters; YouTube allows 100): `{title}`
- **Visibility:** Public, so the launch posts can embed it (Unlisted also passes the form's validator).
- **Thumbnail:** `evidence/kane/e2-frame.jpg` with the callouts from `case.html` Exhibit B. Text: "says {c['to']} · does {c['from']}".
- **The Kane beat in this cut:** {green['label']} ({green['mode']}; source `{green['take']}`).
- After the upload, check that YouTube shows the duration as 3:00 or less.

## Description (paste)

```
Your policy page says {c['to']} days. Your AI support bot says {c['to']}, then turns away a {red['ageDays']}-day return.
Kane CLI shops as your customer, finds every rule your code quietly overrules, and hands each one back to Claude Code.
Code + evidence: {REPO}  (clone, then `npm run replay`: no GPU, no credits, offline)

{chap}

Labels: "Kane CLI" = a Kane CLI {red['kaneVersion']} run. "Probe" = spike/probe.mjs talking to the store's own /api/chat endpoint, pre-registered and labelled.
#KaneCLIHackathon #KaneCLI
```
""")
    print("wrote youtube.md")


if __name__ == "__main__":
    main()
