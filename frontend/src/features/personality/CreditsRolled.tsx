import { ListPlus, RotateCcw, Trophy, Vote, X } from "lucide-react";
import { useState } from "react";

import { openPanel } from "../../lib/open-panel";
import { useRoom } from "../../lib/room-context";
import { ReelyMascot } from "./ReelyMascot";
import "./personality.css";

const LINES: [string, string][] = [
  ["Credits rolled. Opinions did not.", "Hand out the awards while the hot takes are still warm."],
  ["That’s a wrap.", "The film is over. The group chat gets the sequel."],
  ["Roll credits.", "Somebody definitely cried. The awards will reveal who."],
  ["Fin.", "Now is the time to argue about the ending. Politely."],
];

function lineFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return LINES[Math.abs(h) % LINES.length];
}

/**
 * Shown on the stage once the room's video reaches its end (the server pauses it with the note "Finished").
 * It sits over the picture only, never over the playback controls, and each viewer can dismiss it.
 */
export function CreditsRolled() {
  const { media, timeline, room, canControl, socket } = useRoom();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!media || media.live || timeline.state !== "paused" || timeline.note !== "Finished") return null;
  const key = `${media.id}:${timeline.version}`;
  if (dismissed === key) return null;

  const [title, sub] = lineFor(media.id);
  const next =
    room.mode === "movie"
      ? { label: "Pick the next one", icon: Vote, go: () => openPanel("movie", "swipe") }
      : room.mode === "hangout"
        ? { label: "Queue the next one", icon: ListPlus, go: () => openPanel("hangout") }
        : canControl
          ? { label: "Pick the next one", icon: ListPlus, go: () => openPanel("picker") }
          : null;

  return (
    <section className="credits-card" aria-label="The video has finished">
      <button className="ghost icon sm credits-close" aria-label="Dismiss" title="Dismiss" onClick={() => setDismissed(key)}>
        <X size={15} />
      </button>
      <div className="credits-head">
        <ReelyMascot mood="celebrating" size={52} />
        <div>
          <p className="credits-kicker">The end</p>
          <h2>{title}</h2>
          <p className="credits-sub">{sub}</p>
        </div>
      </div>
      <div className="credits-actions">
        <button className="primary sm" onClick={() => openPanel("awards")}>
          <Trophy size={14} /> Hand out awards
        </button>
        {next && (
          <button className="sm" onClick={next.go}>
            <next.icon size={14} /> {next.label}
          </button>
        )}
        {canControl && (
          <button className="ghost sm" onClick={() => socket.send("timeline:set", { action: "play", at: 0 })}>
            <RotateCcw size={14} /> Watch again
          </button>
        )}
      </div>
    </section>
  );
}
