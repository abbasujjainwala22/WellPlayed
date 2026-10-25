import { Gauge } from "lucide-react";

import { useRoom } from "../../lib/room-context";
import "./lifecycle.css";

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Room-wide playback speed. A native <select> so the menu still opens in fullscreen. */
export function SpeedControl({ rate, limited }: { rate: number; limited: boolean }) {
  const { socket, canControl } = useRoom();
  const options = RATES.includes(rate) ? RATES : [...RATES, rate].sort((a, b) => a - b);
  return (
    <>
      {limited && (
        <span className="tag warning speed-limited" title="This player can’t play at the room’s speed, so it keeps catching up by jumping">
          <Gauge size={12} /> Speed limited
        </span>
      )}
      <select
        className="speed-select"
        aria-label="Playback speed"
        title={canControl ? "Playback speed for everyone" : "The host sets the speed"}
        value={rate}
        disabled={!canControl}
        onChange={(e) => socket.send("timeline:set", { action: "rate", rate: Number(e.target.value) })}
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </>
  );
}
