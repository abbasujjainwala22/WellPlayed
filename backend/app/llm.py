"""Provider-agnostic LLM gateway. Everything degrades gracefully when no key is configured."""

import json
import re

from app.config import get_settings


class LLM:
    def __init__(self) -> None:
        self._client = None

    @staticmethod
    def _foundry() -> bool:
        s = get_settings()
        return bool(s.anthropic_foundry_api_key and s.anthropic_foundry_resource)

    @property
    def available(self) -> bool:
        return self._foundry() or bool(get_settings().anthropic_api_key)

    def _get(self):
        if self._client is None:
            s = get_settings()
            if self._foundry():
                from anthropic import AsyncAnthropicFoundry  # optional dependency (extra: ai)

                self._client = AsyncAnthropicFoundry(
                    api_key=s.anthropic_foundry_api_key, resource=s.anthropic_foundry_resource
                )
            else:
                from anthropic import AsyncAnthropic

                self._client = AsyncAnthropic(api_key=s.anthropic_api_key)
        return self._client

    async def complete(self, system: str, prompt: str, max_tokens: int = 1024) -> str:
        resp = await self._get().messages.create(
            model=get_settings().wp_llm_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

    async def json(self, system: str, prompt: str, max_tokens: int = 2048, retries: int = 1):
        """Ask for JSON only; validate by parsing, retry once on malformed output."""
        sys = system + "\nRespond with valid JSON only, no prose and no code fences."
        last: Exception | None = None
        for _ in range(retries + 1):
            text = await self.complete(sys, prompt, max_tokens)
            text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                last = exc
        raise ValueError(f"LLM returned invalid JSON: {last}")


llm = LLM()
