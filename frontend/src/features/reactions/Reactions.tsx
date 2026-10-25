import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePlayback } from "../../lib/playback-store";
import { useRoom } from "../../lib/room-context";
import "./reactions.css";

export const EMOJI: Record<string, string> = {
  laugh: "😂",
  cheer: "🎉",
  scream: "😱",
  gasp: "😮",
  clap: "👏",
  heart: "❤️",
  sad: "😢",
  groan: "😩",
};

export function ReactionBar() {
  const { socket } = useRoom();
  // a brief "delivered" receipt that floats over the bar's top edge, so nothing around it moves
  const [sent, setSent] = useState<{ emoji: string; n: number } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const react = (kind: string) => {
    const pb = usePlayback.getState(); // a companion phone has no player, so the server stamps the time
    socket.send("reaction:send", pb.active ? { kind, at: pb.position } : { kind });
    setSent((s) => ({ emoji: EMOJI[kind], n: (s?.n ?? 0) + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSent(null), 1600);
  };
  return (
    <div className="reactions" role="group" aria-label="Send a reaction">
      <span className="reaction-receipt" role="status">
        {sent && (
          <span key={sent.n}>
            <Check size={12} aria-hidden="true" /> {sent.emoji} delivered to the room
          </span>
        )}
      </span>
      {Object.entries(EMOJI).map(([kind, e]) => (
        <button key={kind} title={kind[0].toUpperCase() + kind.slice(1)} aria-label={`React: ${kind}`} onClick={() => react(kind)}>
          {e}
        </button>
      ))}
    </div>
  );
}

interface Floating {
  id: number;
  emoji: string;
  name: string;
  left: number;
}

/** Floating emoji overlay. In sports mode the sports feature wraps delivery (see releaseAt). */
export function ReactionFloat() {
  const { socket } = useRoom();
  const [items, setItems] = useState<Floating[]>([]);
  useEffect(
    () =>
      socket.on("reaction:display", (r: { kind: string; name: string }) => {
        const id = Math.random();
        setItems((s) => [...s.slice(-25), { id, emoji: EMOJI[r.kind] ?? "✨", name: r.name, left: 8 + Math.random() * 84 }]);
        window.setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 2600);
      }),
    [socket],
  );
  return (
    <div className="floaters">
      {items.map((i) => (
        <span key={i.id} style={{ left: `${i.left}%` }}>
          <b>{i.emoji}</b>
          <i>{i.name}</i>
        </span>
      ))}
    </div>
  );
}
