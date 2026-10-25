import { Drama, Ghost, Star, Trophy, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AwardsSummary, Stars } from "../features/awards/AwardsSummary";
import { Podium } from "../features/awards/Podium";
import { PartyBackdrop, ReelyAside, ReelyMascot } from "../features/personality";
import { clearAwards, loadAwards, type AwardsRecord } from "../features/awards/history";
import { sampleAwards } from "../features/awards/sample";
import { MODES } from "../lib/modes";

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Party({ r, sample }: { r: AwardsRecord; sample?: boolean }) {
  const mode = MODES[r.mode];
  return (
    <section className="hof-party" aria-label={r.roomName}>
      <div className="hof-party-head">
        <h2>{r.roomName}</h2>
        {sample && <span className="tag warning">Sample</span>}
        {mode && <span className="tag">{mode.label}</span>}
        {r.title && <span className="muted">watched {r.title}</span>}
        <span className="faint spacer">{fmtDate(r.at)}</span>
        {r.review.avg !== null && r.review.count > 0 && (
          <span className="row faint" style={{ gap: 6 }}>
            <Stars value={r.review.avg} size={14} /> {r.review.avg.toFixed(1)} from {r.review.count}
          </span>
        )}
      </div>
      <AwardsSummary awards={r.awards} />
    </section>
  );
}

/** This device's past parties and the awards handed out. There are no accounts, so it lives in localStorage. */
export function HallOfFame() {
  const [records, setRecords] = useState<AwardsRecord[]>(loadAwards);
  const [samples] = useState(sampleAwards);
  const nav = useNavigate();

  useEffect(() => {
    document.title = "Hall of Fame · WellPlayed";
    return () => void (document.title = "WellPlayed: watch anything together");
  }, []);

  const forget = () => {
    if (!window.confirm("Forget every party saved on this device?")) return;
    clearAwards();
    setRecords([]);
  };

  return (
    <div>
      <div className="hof">
        <div className="hof-hero party-host">
          <PartyBackdrop scene="awards" />
          <div className="hof-head">
            <p className="eyebrow">
              <Trophy size={14} /> Hall of Fame
            </p>
            <h1>Best reactions and awards</h1>
            <p>
              Awards from your past watch parties on this device, earned from what really happened in the room plus the votes of
              everyone watching.
            </p>
          </div>
          {records.length > 0 && <ReelyAside mood="celebrating">Thank you, thank you. I’d like to thank the snacks.</ReelyAside>}
        </div>

        {records.length === 0 && (
          <div className="hof-empty">
            <div className="hof-empty-body">
              <ReelyMascot mood="thinking" size={104} />
              <div>
                <strong>No awards yet. The trophy cabinet is echoing.</strong>
                <p className="muted">Start a party, then when the credits roll the host opens the Awards tab and reveals:</p>
                <ul>
                  <li>
                    <Drama size={15} className="inline-icon" aria-hidden />
                    react the most to become The Reaction Machine</li>
                  <li>
                    <WandSparkles size={15} className="inline-icon" aria-hidden />
                    call predictions and quizzes right to become The Oracle</li>
                  <li>
                    <Ghost size={15} className="inline-icon" aria-hidden />
                    get voted The Plot-Twist Goblin for your wildest theory</li>
                  <li>
                    <Star size={15} className="inline-icon" aria-hidden />
                    rate what you watched and leave a one-line take</li>
                </ul>
                <button className="primary" onClick={() => nav("/")}>
                  Start a party
                </button>
              </div>
            </div>
          </div>
        )}

        {records.length === 0 ? (
          <div className="hof-sample" aria-label="Sample Hall of Fame">
            <p className="hof-sample-note">
              <span className="tag warning">Sample</span> Here’s how it looks after a couple of parties. These are made-up
              examples and go away once you have real awards.
            </p>
            <Podium records={samples} />
            {samples.map((r) => (
              <Party key={r.code} r={r} sample />
            ))}
          </div>
        ) : (
          <>
            <Podium records={records} />
            {records.map((r) => (
              <Party key={`${r.code}-${r.at}`} r={r} />
            ))}
          </>
        )}

        <div className="hof-foot">
          <p className="faint">
            Privacy: no camera images are ever stored. Awards use names and emoji only, and are kept in this browser (last 20 parties).
          </p>
          {records.length > 0 && (
            <button className="ghost sm spacer" onClick={forget}>
              Forget saved parties
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
