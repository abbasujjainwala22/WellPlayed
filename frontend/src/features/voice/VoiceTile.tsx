import type { Track } from "livekit-client";
import { MicOff, VideoOff, WifiOff } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { colorFor, initials } from "../../components/ui";
import type { Person } from "./voice";
import "./voice.css";

/** What an overlay (e.g. a face-effect canvas) needs to draw over a tile. */
export interface TileOverlayContext {
  person: Person;
  /** The <video> element showing the camera, or null while the camera is off. */
  video: HTMLVideoElement | null;
  track: Track | null;
  /** The local tile is drawn mirrored (scaleX(-1)); overlays should match. */
  mirrored: boolean;
}

export function VoiceTile({
  person,
  name,
  children,
  overlay,
}: {
  person: Person;
  /** Display name from room state; falls back to the LiveKit name. */
  name?: string;
  /** Rendered absolutely over the video, under the name label. */
  children?: ReactNode;
  /** Like children, but with access to the <video> element and track. */
  overlay?: (ctx: TileOverlayContext) => ReactNode;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const track = person.video;
  const label = name || person.name;
  const mirrored = person.local;

  useEffect(() => {
    if (!track || !video) return;
    track.attach(video);
    return () => void track.detach(video);
  }, [track, video]);

  const status = [person.muted && "microphone muted", person.poor && "weak connection", person.speaking && "speaking"].filter(Boolean).join(", ");

  return (
    <figure
      className={`voice-tile ${person.speaking ? "is-speaking" : ""} ${track ? "cam" : ""}`}
      aria-label={`${label}${person.local ? " (you)" : ""}${status ? `: ${status}` : ""}`}
    >
      {track ? (
        <video ref={setVideo} autoPlay playsInline muted className={mirrored ? "mirror" : ""} />
      ) : (
        <div className="voice-tile-off">
          <span className="voice-tile-avatar" style={{ background: colorFor(person.id) }}>
            {initials(label)}
          </span>
          <span className="voice-tile-note">
            <VideoOff size={12} /> Camera off
          </span>
        </div>
      )}
      {(children || overlay) && (
        <div className="voice-tile-overlay">
          {overlay?.({ person, video: track ? video : null, track, mirrored })}
          {children}
        </div>
      )}
      <figcaption className="voice-tile-label">
        <span className="truncate">
          {label}
          {person.local && <span className="you"> (you)</span>}
        </span>
        {person.muted && <MicOff size={12} aria-label="Muted" className="voice-tile-icon mic-off" />}
        {person.poor && <WifiOff size={12} aria-label="Weak connection" className="voice-tile-icon poor" />}
      </figcaption>
    </figure>
  );
}
