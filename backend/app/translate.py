"""Translation providers: Argos (offline, free) or the LLM. Selected via WP_TRANSLATOR."""

import asyncio
import os
from typing import Protocol


class Translator(Protocol):
    name: str

    async def translate_many(self, texts: list[str], src: str, tgt: str) -> list[str] | None: ...


class NoTranslator:
    name = "none"

    async def translate_many(self, texts, src, tgt):
        return None


class MockTranslator:
    """For local testing without models: tags text with the target language."""

    name = "mock"

    async def translate_many(self, texts, src, tgt):
        return [f"[{tgt}] {t}" for t in texts]


class ArgosTranslator:
    name = "argos"

    async def translate_many(self, texts, src, tgt):
        def run() -> list[str] | None:
            import argostranslate.translate as at

            try:
                return [at.translate(t, src, tgt) for t in texts]
            except Exception:
                return None  # language pair not installed

        return await asyncio.to_thread(run)


class LLMTranslator:
    name = "llm"

    async def translate_many(self, texts, src, tgt):
        from app.llm import llm

        try:
            out = await llm.json(
                "You translate chat messages and subtitles faithfully, keeping tone and slang.",
                f"Translate each string from '{src}' to '{tgt}'. Return a JSON array of "
                f"{len(texts)} strings in the same order.\n{texts!r}",
            )
        except Exception:
            return None
        return out if isinstance(out, list) and len(out) == len(texts) else None


def _select() -> Translator:
    choice = os.environ.get("WP_TRANSLATOR", "auto")
    if choice == "mock":
        return MockTranslator()
    if choice == "none":
        return NoTranslator()
    if choice == "argos":
        return ArgosTranslator()
    if choice == "llm":
        return LLMTranslator()
    from app.llm import llm

    if llm.available:
        return LLMTranslator()
    try:
        import argostranslate.translate  # noqa: F401

        return ArgosTranslator()
    except ImportError:
        return NoTranslator()


class CachedTranslator:
    """Wraps a provider with an in-memory cache keyed by (src, tgt, text)."""

    def __init__(self, inner: Translator | None = None) -> None:
        self.inner = inner or _select()
        self.cache: dict[tuple[str, str, str], str] = {}

    @property
    def name(self) -> str:
        return self.inner.name

    async def one(self, text: str, src: str, tgt: str) -> str | None:
        res = await self.many([text], src, tgt)
        return res[0] if res else None

    async def many(self, texts: list[str], src: str, tgt: str) -> list[str] | None:
        if src == tgt:
            return texts
        missing = [t for t in dict.fromkeys(texts) if (src, tgt, t) not in self.cache]
        if missing:
            done = await self.inner.translate_many(missing, src, tgt)
            if done is None:
                return None
            self.cache.update({(src, tgt, t): d for t, d in zip(missing, done, strict=True)})
        return [self.cache[(src, tgt, t)] for t in texts]


translator = CachedTranslator()
