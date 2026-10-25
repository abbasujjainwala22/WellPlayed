import { ArrowRight, SearchX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Logo } from "../components/Logo";
import { RoomEnded } from "../components/RoomEnded";
import { FullscreenState } from "../components/ui";
import { api, ApiError, errorText, joinKey, LANGUAGES, loadSession, normalizeCode, preferredLanguage, saveSession } from "../lib/api";
import { MODES } from "../lib/modes";
import { addRecent, recentName } from "../lib/settings";
import type { Mode, Session } from "../lib/types";

export function Join() {
  const { code: raw = "" } = useParams();
  const { search } = useLocation();
  const code = normalizeCode(raw);
  // invite codes shared as "abc-123" or "ABC 123" still work, and the address bar shows the tidy form
  if (code !== raw) return <Navigate to={`/join/${code}${search}`} replace />;
  return <JoinForm key={code} code={code} />;
}

function JoinForm({ code }: { code: string }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  // prefilled when rejoining: from the "Rejoin as" link, else the name you last used here on this device
  const [name, setName] = useState(params.get("name") ?? recentName(code) ?? "");
  const [language, setLanguage] = useState(preferredLanguage());
  const [info, setInfo] = useState<{ name: string; mode: string; members: number; limit?: number; full?: boolean } | null>(null);
  const [notFound, setNotFound] = useState("");
  const [ended, setEnded] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loadSession(code)) {
      nav(`/room/${code}`, { replace: true });
      return;
    }
    api<{ name: string; mode: string; members: number; limit?: number; full?: boolean }>(`/api/rooms/${code}`)
      .then((i) => {
        setInfo(i);
        document.title = `Join ${i.name} · WellPlayed`;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 410) setEnded(e.message);
        else if (e instanceof ApiError && e.status === 404) setNotFound(e.message);
        else setError(errorText(e)); // offline or a server hiccup: not a reason to say the room doesn't exist
      });
  }, [code, nav]);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>(`/api/rooms/${code}/join`, {
        method: "POST",
        // the same key until this join succeeds: a retry after a dropped response gets the same seat back
        json: { display_name: name.trim() || "Guest", language, join_key: joinKey(code) },
      });
      saveSession(s);
      if (info) addRecent({ code: s.code, name: info.name, mode: info.mode as Mode, as: s.name });
      nav(`/room/${s.code}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) return setEnded(e.message);
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (ended) return <RoomEnded title="This party has ended" message={ended.replace(/^This party has ended.s*/, "") || undefined} />;

  if (notFound)
    return (
      <FullscreenState
        icon={
          <div className="state-icon">
            <SearchX size={26} />
          </div>
        }
        title="We couldn’t find that room"
      >
        <p className="muted">
          The code <code>{code.toUpperCase()}</code> doesn’t match an active room. Rooms end when the server restarts, so ask the host
          for a fresh link.
        </p>
        <button className="primary" onClick={() => nav("/")}>
          Back to home
        </button>
      </FullscreenState>
    );

  const mode = info ? MODES[info.mode as Mode] : null;
  const ModeIcon = mode?.icon;
  return (
    <div className="site">
      <div className="fullscreen-state">
        <div className="start-card join-card" style={{ textAlign: "center" }}>
          <Logo size={20} />
          <h2 style={{ marginTop: 22 }}>You’re invited to watch together</h2>
          <div className="room-preview">
            {info && ModeIcon ? (
              <>
                <div className="state-icon brand" style={{ width: 46, height: 46 }}>
                  <ModeIcon size={22} />
                </div>
                <div className="grow">
                  <strong style={{ fontSize: 16 }} className="truncate">
                    {info.name}
                  </strong>
                  <div className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {mode.label} · <Users size={13} /> {info.members}
                    {info.limit ? `/${info.limit}` : ""} {info.members === 1 && !info.limit ? "person" : "people"} here
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="skeleton" style={{ width: 46, height: 46, borderRadius: 14 }} />
                <div className="grow stack" style={{ gap: 8 }}>
                  <div className="skeleton" style={{ height: 14, width: "60%" }} />
                  <div className="skeleton" style={{ height: 12, width: "40%" }} />
                </div>
              </>
            )}
          </div>
          <form
            className="stack"
            style={{ textAlign: "left" }}
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <label className="field">
              <span>Your name</span>
              <input autoFocus placeholder="How should others see you?" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </label>
            <label className="field">
              <span>
                Your language <span className="hint">· chat and subtitles are translated into it</span>
              </span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {Object.entries(LANGUAGES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {info?.full && <p className="error">This party is full right now. Ask the host to make room, or try again in a few minutes.</p>}
            <button type="submit" className="primary lg block" disabled={!info || busy || info.full}>
              {busy && <span className="spinner sm" />}
              Join
              {!busy && <ArrowRight size={18} />}
            </button>
            {error && <p className="error">{error}</p>}
            <p className="faint" style={{ textAlign: "center" }}>
              Room code <code>{code.toUpperCase()}</code> · No account needed
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
