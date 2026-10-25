import { CircleCheck } from "lucide-react";

type Status = "synced" | "household" | "planned";

/**
 * An honest lineup. "Synced" sources play inside the room's own player. "Household" services play in
 * each home's own tab, kept in step by the WellPlayed Sync extension (extension/README.md), which so far
 * has only been tested against our demo video page. Everything else is planned, not promised.
 */
const PLATFORMS: { name: string; status: Status }[] = [
  { name: "YouTube", status: "synced" },
  { name: "Video files (MP4 / WebM)", status: "synced" },
  { name: "HLS streams", status: "synced" },
  { name: "Netflix", status: "household" },
  { name: "Prime Video", status: "household" },
  { name: "Disney+", status: "household" },
  ...[
    "Max",
    "Paramount+",
    "Apple TV+",
    "Hulu",
    "Crunchyroll",
    "Discovery+",
    "SkyShowtime",
    "MGM+",
    "Stan",
    "Binge",
    "Kayo Sports",
    "BritBox",
    "Hayu",
    "ZEE5",
    "SonyLIV",
    "Tencent Video",
  ].map((name) => ({ name, status: "planned" as Status })),
];

const LABEL: Record<Status, string> = {
  synced: "Synced playback",
  household: "Household Mode (beta)",
  planned: "Planned",
};

export function StreamingMultiverse() {
  return (
    <section className="discover-section multiverse" aria-labelledby="multiverse-heading">
      <div className="multiverse-grid-bg" aria-hidden="true" />
      <div className="multiverse-inner">
        <h2 id="multiverse-heading" className="multiverse-title">
          The streaming <span>multiverse</span>
        </h2>
        <p className="muted multiverse-tag">
          Multiple platforms. Infinite options. And somehow your group will still spend 45 minutes deciding what to watch. 💀
        </p>
        <ul className="platforms">
          {PLATFORMS.map((p) => (
            <li key={p.name} className={`platform ${p.status}`}>
              <span className="platform-name">{p.name}</span>
              <span className="platform-status">
                {p.status === "synced" && <CircleCheck size={11} className="inline-icon" aria-hidden />} {LABEL[p.status]}
              </span>
            </li>
          ))}
        </ul>
        <div className="multiverse-legend">
          <p>
            <strong className="lg-synced">Synced playback</strong> plays in the room’s own player and stays in step for everyone.
          </p>
          <p>
            <strong className="lg-household">Household Mode (beta)</strong> means each home plays from its own account and the
            WellPlayed Sync browser extension keeps that tab in time. Nothing is restreamed. It has been tested on our demo page,
            not yet against every service.
          </p>
          <p className="faint">Availability depends on your region, the title and each platform’s terms.</p>
        </div>
      </div>
    </section>
  );
}
