import { useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { Pause, Play, SmartphoneNfc } from "lucide-react";

import { BreakBanner, BreakButton } from "../features/breaks/BreakBanner";
import { FullscreenState, Loading } from "../components/ui";
import { MODES } from "../lib/modes";
import { mediaTitle } from "../lib/players";
import { RoomEnded } from "../components/RoomEnded";
import { panels } from "../features/panels";
import { QuizOverlay } from "../features/polls/QuizOverlay";
import { ReactionBar } from "../features/reactions/Reactions";
import { CalibrationPrompt } from "../features/sports/SportsPanel";
import { api, errorText, loadSession, normalizeCode, saveSession } from "../lib/api";
import { ConnectionNotice, RoomLoading } from "../features/lifecycle/ConnectionNotice";
import { RoomProvider, useRoom } from "../lib/room-context";
import type { Session } from "../lib/types";
import { voicePanel } from "../features/voice/VoicePanel";

function CompanionView() {
  const { room, connected, media, timeline } = useRoom();
  panels.forEach((p) => p.useSetup?.());
  const mine = [...panels, voicePanel].filter((p) => p.companion && (!p.modes || p.modes.includes(room.mode)));
  const [tab, setTab] = useState(mine.find((p) => p.id === "chat")?.id ?? mine[0]?.id);
  const Active = mine.find((p) => p.id === tab)?.component;
  const mode = MODES[room.mode];
  const playing = timeline.state === "playing";
  useEffect(() => {
    document.title = `${room.name} · Remote · WellPlayed`;
  }, [room.name]);
  return (
    <div className="companion">
      <header className="companion-head">
        <div className="state-icon brand" style={{ width: 42, height: 42, borderRadius: 12 }}>
          {media ? playing ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" /> : <mode.icon size={18} />}
        </div>
        <div className="np">
          <strong className="truncate">{media ? mediaTitle(media) : room.name}</strong>
          <span className="faint">
            {media ? `${playing ? "Playing" : "Paused"} · ${room.name}` : `${mode.label} · Nothing playing yet`}
          </span>
        </div>
        <span className="conn">
          <span className={connected ? "dot on" : "dot off"} />
          {connected ? "Live" : "Offline"}
        </span>
      </header>
      <BreakBanner />
      <QuizOverlay />
      <CalibrationPrompt />
      <ReactionBar />
      <BreakButton />
      <div className="panel-card">{Active && <Active />}</div>
      <nav className="tabbar">
        {mine.map((p) => (
          <button key={p.id} className={p.id === tab ? "active" : ""} onClick={() => setTab(p.id)} aria-label={p.title}>
            <p.icon size={20} />
            {p.short ?? p.title}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Companion() {
  const code = normalizeCode(useParams().code ?? "");
  const [sp] = useSearchParams();
  const pair = sp.get("pair");
  const [ready, setReady] = useState(!pair && !!loadSession(code));
  const [error, setError] = useState("");

  const claimed = useRef(false); // StrictMode runs effects twice; the code is one-time use
  useEffect(() => {
    if (!pair || claimed.current) return;
    claimed.current = true;
    api<Session>(`/api/rooms/${code}/pair/claim`, { method: "POST", json: { pair } })
      .then((s) => {
        saveSession(s);
        setReady(true);
        history.replaceState(null, "", `/companion/${code}`); // the one-time code is spent; keep the URL clean
      })
      .catch((e) => setError(errorText(e)));
  }, [code, pair]);

  if (error)
    return (
      <FullscreenState icon={<div className="state-icon"><SmartphoneNfc size={26} /></div>} title="This pairing link didn’t work">
        <p className="error">{error}</p>
        <p className="muted">Scan a fresh QR code from “Pair phone” on the big screen.</p>
      </FullscreenState>
    );
  if (!pair && !ready) return <Navigate to={`/join/${code}`} replace />;
  if (!ready) return <Loading label="Pairing your phone…" />;
  return (
    <RoomProvider code={code} device="companion" fallback={(conn) => <RoomLoading {...conn} />} ended={<RoomEnded />}>
      <ConnectionNotice />
      <CompanionView />
    </RoomProvider>
  );
}
