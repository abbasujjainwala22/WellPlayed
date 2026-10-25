"""Server-side validation of media links before they reach everyone's player.

The client runs the same checks first (frontend/src/lib/sources.ts) for instant feedback; this is the
authority. Rules: https only (plain http is allowed for this server itself and for localhost), no
embedded credentials, no web pages posing as video files, and a straight answer for streaming services
that don't let other sites embed or control their player.
"""

import re
from typing import Any
from urllib.parse import urlsplit

from app.errors import UserError

MAX_URL = 2000
MEDIA_EXT = re.compile(r"\.(mp4|m4v|webm|ogv|ogg|mov|mkv|mp3|m4a|aac|wav|flac|opus)$", re.I)
HLS_EXT = re.compile(r"\.m3u8$", re.I)
PAGE_EXT = re.compile(r"\.(html?|php|aspx?|jsp|cgi)$", re.I)
YT_ID = re.compile(r"^[\w-]{11}$")
YT_HOSTS = ("youtube.com", "youtu.be", "youtube-nocookie.com")
LOOPBACK = {"localhost", "127.0.0.1", "::1", "[::1]"}

# Services whose players can't be embedded or driven by another site. Domain -> display name.
PROVIDERS: dict[str, str] = {
    "netflix.com": "Netflix",
    "disneyplus.com": "Disney+",
    "primevideo.com": "Prime Video",
    "tubitv.com": "Tubi",
    "plex.tv": "Plex",
    "max.com": "Max",
    "hbomax.com": "Max",
    "hulu.com": "Hulu",
    "paramountplus.com": "Paramount+",
    "peacocktv.com": "Peacock",
    "crunchyroll.com": "Crunchyroll",
    "stan.com.au": "Stan",
    "binge.com.au": "Binge",
    "iview.abc.net.au": "ABC iview",
    "sbs.com.au": "SBS On Demand",
    "tv.apple.com": "Apple TV+",
}


def _on(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def provider_for(url: str) -> str | None:
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if _on(host, "amazon.com") or _on(host, "amazon.co.uk"):
        return "Prime Video" if "/video" in parts.path or "/gp/video" in parts.path else None
    return next((name for domain, name in PROVIDERS.items() if _on(host, domain)), None)


def external_error(provider: str, url: str) -> UserError:
    return UserError(
        f"{provider} doesn't let other sites embed or control its player, so it can't play in the shared player. "
        f"Open it on {provider} yourselves and start a group countdown, or choose “Own service (extension)”.",
        reason="external",
        provider=provider,
        url=url,
    )


def validate(kind: str, url: Any, same_host: str | None = None, explicit: bool = False) -> str:
    """Return the cleaned URL or raise UserError with a friendly reason.

    same_host: the Host header this request came in on (so the built-in demo clip works on a LAN IP).
    explicit: the user picked the source type by hand, so an extension-less file URL is accepted.
    """
    url = str(url or "").strip()
    if len(url) > MAX_URL:
        raise UserError("That link is too long.")
    if kind == "external":
        if url:
            _check_url(url, same_host, allow_relative=False)
        return url  # played by each viewer's own service through the household extension
    if not url:
        raise UserError("Paste a link first.")
    if kind == "youtube":
        if YT_ID.match(url):
            return url
        parts = _check_url(url, same_host, allow_relative=False)
        if not any(_on((parts.hostname or "").lower(), d) for d in YT_HOSTS):
            raise UserError("That isn't a YouTube link. Copy the link from the video's Share button.")
        return url

    provider = provider_for(url)
    if provider:
        raise external_error(provider, url)
    parts = _check_url(url, same_host, allow_relative=True)
    host = (parts.hostname or "").lower()
    if any(_on(host, d) for d in YT_HOSTS):
        raise UserError("That's a YouTube link. Choose YouTube (or Auto-detect) as the source type.")
    path = parts.path or ""
    last = path.rsplit("/", 1)[-1]
    if kind == "hls":
        if HLS_EXT.search(path) or explicit:
            return url
        raise UserError("HLS streams need a link ending in .m3u8.")
    if MEDIA_EXT.search(path) or HLS_EXT.search(path):
        return url
    if PAGE_EXT.search(last) or not last or (not explicit and "." not in last):
        raise UserError(
            "That's a web page, not a video file. Use a YouTube link or a direct link to a video (.mp4, .webm, .m3u8)."
        )
    if not explicit:
        raise UserError("That link doesn't point at a video file this player can open (.mp4, .webm, .mov, .m3u8).")
    return url


def _check_url(url: str, same_host: str | None, allow_relative: bool):
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018  (raises on a malformed port)
    except ValueError:
        raise UserError("That doesn't look like a valid link.") from None
    if not parts.scheme and not parts.netloc:
        if allow_relative and not url.startswith("//"):
            return parts  # a path on this server, such as the built-in demo clip
        raise UserError("Paste a full https:// link.")
    if parts.username or parts.password or "@" in parts.netloc:
        raise UserError("Links with a username or password in them aren't allowed. Use a link without embedded credentials.")
    scheme, host = parts.scheme.lower(), (parts.hostname or "").lower()
    if scheme not in ("https", "http") or not host:
        raise UserError("Only https:// links are supported.")
    if scheme == "http" and host not in LOOPBACK and not _same(parts.netloc, same_host):
        raise UserError("Only secure https:// links are supported.")
    return parts


def _same(netloc: str, same_host: str | None) -> bool:
    return bool(same_host) and netloc.lower() == same_host.lower()
