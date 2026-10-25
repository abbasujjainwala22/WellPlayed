import { Play } from "lucide-react";
import { useState } from "react";

import { safeMediaUrl, useReducedMotion, type ChatMedia } from "./giphy";

const MAX_W = 240;
const MAX_H = 200;

/** A GIF or sticker in the chat log: fixed aspect ratio (no layout jump), lazy, and paused
 *  on a still frame when reduced motion is on, with a button to play it on demand. */
export function MediaMessage({ media }: { media: ChatMedia }) {
  const reduce = useReducedMotion();
  const [play, setPlay] = useState(false);
  const [broken, setBroken] = useState(false);
  const animated = safeMediaUrl(media.url);
  const still = safeMediaUrl(media.still);
  const moving = !reduce || play;
  const src = moving ? animated : still || animated;
  const noun = media.kind === "sticker" ? "Sticker" : "GIF";
  // fit inside MAX_W × MAX_H keeping the aspect ratio
  const ratio = media.w > 0 && media.h > 0 ? media.w / media.h : 1;
  const width = Math.round(Math.min(MAX_W, MAX_H * ratio));

  if (!src || broken)
    return (
      <div className="chat-media missing">
        {noun} unavailable: {media.title}
      </div>
    );

  return (
    <figure className={`chat-media ${media.kind}`} style={{ width, aspectRatio: `${media.w || 1} / ${media.h || 1}` }}>
      <img src={src} alt={media.title} title={media.title} width={media.w} height={media.h} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      {reduce && (
        <button type="button" className="chat-media-play" aria-pressed={play} aria-label={play ? `Pause ${noun}` : `Play ${noun}`} onClick={() => setPlay((p) => !p)}>
          {play ? noun : <Play size={14} />}
        </button>
      )}
      {media.kind === "gif" && !reduce && <span className="chat-media-badge" aria-hidden>GIF</span>}
    </figure>
  );
}
