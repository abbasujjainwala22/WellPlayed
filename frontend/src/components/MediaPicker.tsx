import { ChevronDown, Film, Play, SkipForward, MonitorPlay, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ExternalWatch } from "../features/lifecycle/ExternalWatch";
import { onOpenPanel } from "../lib/open-panel";
import { guessMedia, mediaTitle } from "../lib/players";
import { youtubeId, youtubeThumb } from "../lib/players/youtube";
import { useRoom } from "../lib/room-context";
import { checkSource, providerFor } from "../lib/sources";
import type { MediaKind } from "../lib/types";

const KIND_LABEL: Record<MediaKind, string> = { youtube: "YouTube", html5: "Video file", hls: "HLS stream", external: "Own service" };

/** A known-embeddable YouTube video for trying the room out (Blender Foundation, Creative Commons). */
const SAMPLE_YOUTUBE = { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", title: "Big Buck Bunny" };

/** "https://x/films/my_clip.mp4?sig=1" -> "my clip" */
const fileTitle = (url: string): string => {
  try {
    const name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() ?? "");
    return name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || url;
  } catch {
    return url;
  }
};

function PickerForm({ onDone, hero }: { onDone?: () => void; hero?: boolean }) {
  const { socket } = useRoom();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MediaKind | "auto">("auto");
  const [live, setLive] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [ext, setExt] = useState<{ provider: string; url: string; message: string } | null>(null);
  const submit = (type: "media:set" | "episode:next" = "media:set", src = url.trim(), name = title.trim(), forceKind?: MediaKind) => {
    if (!src) return;
    setExt(null);
    const guess = guessMedia(src);
    const explicit = !!forceKind || kind !== "auto";
    const k = forceKind ?? (kind === "auto" ? guess.kind : kind);
    if (k === "youtube" && !youtubeId(src))
      return setErr("That YouTube link doesn’t point at a video. Copy the link from the video’s Share button.");
    const check = checkSource(k, src, explicit);
    if (!check.ok) {
      setErr("external" in check ? "" : check.message);
      if ("external" in check) setExt(check);
      return;
    }
    // YouTube titles are looked up by the server; files get a readable name from the URL
    const fallbackTitle = k === "youtube" ? undefined : k === "external" ? "Watching on our own services" : fileTitle(src);
    socket.send(type, { ...guess, url: src, kind: k, explicit, title: name || fallbackTitle, live });
    setUrl("");
    setTitle("");
    setErr("");
    onDone?.();
  };
  const detected = url.trim() ? guessMedia(url.trim()).kind : null;
  const provider = url.trim() ? providerFor(url) : null;
  return (
    <form
      className="picker-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="url-row">
        <input
          autoFocus={!hero}
          placeholder="Paste a YouTube link or video URL (.mp4, .webm, .m3u8)"
          aria-label="Video URL"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setErr("");
            setExt(null);
          }}
        />
        <button type="submit" className="primary" disabled={!url.trim()}>
          <Play size={16} /> Load
        </button>
      </div>
      <div className="opts">
        {detected && kind === "auto" && (
          <span className={provider ? "tag warning" : "tag violet"}>Detected: {provider ? `${provider} (plays on its own site)` : KIND_LABEL[detected]}</span>
        )}
        <button type="button" className="ghost sm" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <ChevronDown size={14} style={{ transform: more ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
          {more ? "Fewer options" : "More options"}
        </button>
        {hero && (
          <span className="sample-chips">
            <button type="button" className="ghost sm" onClick={() => submit("media:set", SAMPLE_YOUTUBE.url, SAMPLE_YOUTUBE.title)}>
              <MonitorPlay size={14} /> Try a YouTube video
            </button>
            <button
              type="button"
              className="ghost sm"
              onClick={() => submit("media:set", `${location.origin}/demo.webm`, "WellPlayed demo clip")}
            >
              <Sparkles size={14} /> Try the demo clip
            </button>
          </span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="sm"
          disabled={!url.trim()}
          onClick={() => submit("episode:next")}
          title="Starts immediately, or after everyone’s stretch if the room requires it"
        >
          <SkipForward size={14} /> Next episode
        </button>
      </div>
      {err && <span className="picker-error" role="alert">{err}</span>}
      {ext && <ExternalWatch {...ext} onUseExtension={() => submit("media:set", ext.url, title.trim() || `${ext.provider} (own service)`, "external")} />}
      {more && (
        <div className="opts">
          <input placeholder="Title shown to everyone (optional)" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind | "auto")} aria-label="Source type">
            <option value="auto">Auto-detect</option>
            <option value="youtube">YouTube</option>
            <option value="html5">Video file</option>
            <option value="hls">HLS stream</option>
            <option value="external">Own service (extension)</option>
          </select>
          <label className="check" title="Live streams free-run on each device; WellPlayed aligns reactions instead of video">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live stream
          </label>
        </div>
      )}
    </form>
  );
}

export function MediaPicker({ variant = "compact" }: { variant?: "hero" | "compact" }) {
  const { canControl, media } = useRoom();
  const [open, setOpen] = useState(false);
  // "Pick the next one" on the credits card opens the change-video form
  useEffect(() => {
    if (variant !== "compact") return;
    return onOpenPanel(({ id }) => {
      if (id !== "picker") return;
      setOpen(true);
      requestAnimationFrame(() => document.querySelector(".now-playing")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    });
  }, [variant]);
  if (!canControl) return null;
  if (variant === "hero") return <PickerForm hero />;
  if (!media) return null;
  return (
    <>
      <div className="now-playing">
        {media.kind === "youtube" && youtubeThumb(media.url) ? (
          <img className="np-thumb" src={youtubeThumb(media.url)!} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        ) : (
          <div className="np-icon">
            <Film size={18} />
          </div>
        )}
        <div className="grow">
          <div className="faint">Now playing · {KIND_LABEL[media.kind]}{media.live ? " · Live" : ""}</div>
          <strong className="truncate" style={{ display: "block" }}>
            {mediaTitle(media)}
          </strong>
        </div>
        <button className="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Cancel" : "Change video"}
        </button>
      </div>
      {open && (
        <div className="picker-card">
          <PickerForm onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
