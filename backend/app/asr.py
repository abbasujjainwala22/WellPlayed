"""Optional speech-to-text with faster-whisper (install the `asr` extra)."""

from app.transcript import Cue


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except ImportError:
        return False


def transcribe(path: str, language: str | None = None, model: str = "base") -> list[Cue]:
    from faster_whisper import WhisperModel

    segments, _info = WhisperModel(model, compute_type="int8").transcribe(path, language=language)
    return [Cue(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
