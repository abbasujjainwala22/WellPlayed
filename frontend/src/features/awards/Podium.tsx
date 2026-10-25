import { PartyDoodle } from "../personality";
import "./awards.css";
import type { AwardsRecord } from "./history";

interface Champ {
  name: string;
  wins: number;
  parties: number;
  emoji: string;
}

/** Everyone who has won an award on this device, most decorated first. Names are matched case-insensitively. */
export function champions(records: AwardsRecord[]): Champ[] {
  const by = new Map<string, { name: string; wins: number; parties: Set<string>; emoji: Map<string, number> }>();
  for (const r of records)
    for (const a of r.awards)
      for (const w of a.winners) {
        const key = w.name.trim().toLowerCase();
        if (!key) continue;
        const c = by.get(key) ?? { name: w.name.trim(), wins: 0, parties: new Set<string>(), emoji: new Map<string, number>() };
        c.wins += 1;
        c.parties.add(`${r.code}-${r.at}`);
        c.emoji.set(a.emoji, (c.emoji.get(a.emoji) ?? 0) + 1);
        by.set(key, c);
      }
  return [...by.values()]
    .map((c) => ({
      name: c.name,
      wins: c.wins,
      parties: c.parties.size,
      emoji: [...c.emoji.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "🏅",
    }))
    .sort((a, b) => b.wins - a.wins || b.parties - a.parties || a.name.localeCompare(b.name));
}

const PLACE = ["1st", "2nd", "3rd"];

/** The top three award winners as a 2-1-3 podium (first place in the middle, wearing the crown). */
export function Podium({ records }: { records: AwardsRecord[] }) {
  const top = champions(records).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <section className="podium-wrap" aria-labelledby="podium-h">
      <h2 id="podium-h">Most decorated</h2>
      <ol className={`podium n${top.length}`}>
        {top.map((c, i) => (
          <li key={c.name} className={`podium-step p${i + 1}`}>
            <div className="podium-person">
              <span className="sr-only">{PLACE[i]} place: </span>
              {i === 0 && <PartyDoodle kind="crown" className="podium-crown" />}
              <span className="podium-emoji" aria-hidden="true">
                {c.emoji}
              </span>
              <strong className="podium-name">{c.name}</strong>
              <span className="podium-wins">
                {c.wins} {c.wins === 1 ? "award" : "awards"}
                {c.parties > 1 && ` · ${c.parties} parties`}
              </span>
            </div>
            <div className="podium-block" aria-hidden="true">
              {PLACE[i]}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
