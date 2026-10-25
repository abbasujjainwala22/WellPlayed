import { BarChart3, RefreshCw } from "lucide-react";
import { useState } from "react";

import { api, loadSession } from "../../lib/api";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";
import { EMOJI } from "./Reactions";

interface Bin {
  start: number;
  end: number;
  counts: Record<string, number>;
  total: number;
}
interface Heat {
  bins: Bin[];
  top: (Bin & { dominant: string })[];
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function HeatmapPanel() {
  const { room, canControl, socket } = useRoom();
  const [heat, setHeat] = useState<Heat | null>(null);
  const [clips, setClips] = useState<{ start: number; end: number; reaction: string; reactions: number }[]>([]);
  const token = loadSession(room.code)?.token ?? "";

  const load = async () => {
    setHeat(await api<Heat>(`/api/rooms/${room.code}/heatmap?token=${token}`));
    setClips((await api<{ clips: typeof clips }>(`/api/rooms/${room.code}/highlights?token=${token}`)).clips);
  };
  const max = Math.max(1, ...(heat?.bins.map((b) => b.total) ?? [1]));
  const dominant = (b: Bin) => Object.entries(b.counts).sort((a, c) => c[1] - a[1])[0]?.[0];

  return (
    <div className="stack">
      <button onClick={() => void load()}>
        <RefreshCw size={15} /> Refresh reaction timeline
      </button>
      {!heat && <p className="faint">Load the timeline to see the room’s biggest moments. Click a bar to jump there.</p>}
      {heat && heat.bins.length === 0 && <p className="muted">No reactions yet — tap an emoji under the video.</p>}
      {heat && heat.bins.length > 0 && (
        <>
          <div className="heat">
            {heat.bins.map((b) => (
              <div
                key={b.start}
                className="bar"
                title={`${fmt(b.start)} — ${Object.entries(b.counts).map(([k, n]) => `${EMOJI[k]}×${n}`).join(" ")}`}
                style={{ height: `${(b.total / max) * 100}%`, opacity: b.total ? 1 : 0.15 }}
                onClick={() => canControl && socket.send("timeline:set", { action: "seek", to: b.start })}
              >
                {b.total > 0 && <span>{EMOJI[dominant(b) ?? ""]}</span>}
              </div>
            ))}
          </div>
          <h3>Biggest moments</h3>
          <ul className="plain">
            {heat.top.map((m) => (
              <li key={m.start}>
                {fmt(m.start)} {EMOJI[m.dominant]} <span className="muted">{m.total} reactions</span>
              </li>
            ))}
          </ul>
          <h3>Highlight reel candidates</h3>
          <ul className="plain">
            {clips.map((c) => (
              <li key={c.start}>
                {fmt(c.start)}–{fmt(c.end)} {EMOJI[c.reaction]} <span className="muted">{c.reactions}</span>
              </li>
            ))}
          </ul>
          <p className="muted">Clip rendering is not built yet; these are the time ranges a renderer would cut.</p>
        </>
      )}
    </div>
  );
}

export const heatmapPanel: Panel = { id: "heat", title: "Highlights", icon: BarChart3, group: "tools", description: "Where the room laughed, cheered or gasped, on a timeline.", component: HeatmapPanel };
