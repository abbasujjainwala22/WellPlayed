import { ArrowRight, ArrowUpRight, Compass, PlayCircle, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { CatalogueBrowser } from "../features/discover/CatalogueBrowser";
import { Recommendations } from "../features/discover/Recommendations";
import { StreamingMultiverse } from "../features/discover/StreamingMultiverse";
import "../features/discover/discover.css";
import { PartyBackdrop, PartyDoodle, ReelyMascot } from "../features/personality";

export function Discover() {
  const [openAdd, setOpenAdd] = useState(0);
  return (
    <div className="discover">

      <div className="discover-main">
        <header className="discover-hero party-host">
          <PartyBackdrop scene="discover" />
          <div className="discover-hero-text">
            <span className="eyebrow">
              <Compass size={14} /> Good movies. Questionable company.
            </span>
            <h1>
              Your group chat has <span className="grad">terrible taste.</span> Let’s fix that.
            </h1>
            <p className="lede">
              See what other people are recommending, vote in their silly polls, and check what can actually be played together today.
            </p>
            <div className="discover-hero-actions">
              <button className="primary" onClick={() => setOpenAdd((n) => n + 1)}>
                <Plus size={16} /> Recommend a title
              </button>
              <Link to="/?mode=movie" className="discover-hero-link" title="Start a movie night, add contenders and swipe on them together">
                Let the group decide <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <div className="discover-hero-art" aria-hidden="true">
            <span className="discover-ticket">Admit one bad opinion</span>
            <ReelyMascot size={150} />
            <PartyDoodle kind="popcorn" className="discover-hero-popcorn" />
            <p className="speech">I brought popcorn. Not a neutral opinion.</p>
          </div>
        </header>

        <Recommendations openAdd={openAdd} />
        <CatalogueBrowser />
        <StreamingMultiverse />

        <section className="discover-cta" aria-label="Start a party">
          <PlayCircle size={26} aria-hidden="true" />
          <p>
            Already picked something? Watch a YouTube video, an MP4 or WebM file, or an HLS stream together right now. Start a party
            and paste a link.
          </p>
          <Link to="/" className="cta-btn">
            Start a party <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
}
