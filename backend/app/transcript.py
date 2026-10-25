"""Timed text (subtitles / transcripts): parse SRT/VTT, render WebVTT."""

import re
from dataclasses import asdict, dataclass


@dataclass
class Cue:
    start: float
    end: float
    text: str

    def dict(self) -> dict:
        return asdict(self)


_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


def _secs(ts: str) -> float:
    m = _TS.fullmatch(ts.strip())
    if not m:
        raise ValueError(f"bad timestamp {ts!r}")
    h, mi, s, ms = m.groups()
    return int(h or 0) * 3600 + int(mi) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def parse_cues(text: str) -> list[Cue]:
    """Parse SRT or WebVTT into cues."""
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        for i, ln in enumerate(lines):
            if "-->" in ln:
                a, b = ln.split("-->")
                body = re.sub(r"<[^>]+>", "", " ".join(lines[i + 1 :])).strip()
                if body:
                    cues.append(Cue(_secs(a), _secs(b.split()[0]), body))
                break
    return cues


def to_vtt(cues: list[Cue]) -> str:
    def ts(x: float) -> str:
        return f"{int(x // 3600):02}:{int(x % 3600 // 60):02}:{x % 60:06.3f}"

    body = "\n\n".join(f"{ts(c.start)} --> {ts(c.end)}\n{c.text}" for c in cues)
    return f"WEBVTT\n\n{body}\n"
