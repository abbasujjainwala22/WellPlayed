import { MoreVertical, Settings2, UserPlus, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { AwardsReveal } from "../features/awards/AwardsPanel";
import { EndedAwards } from "../features/awards/EndedAwards";
import { BreakBanner, BreakButton } from "../features/breaks/BreakBanner";
import { useChat } from "../features/chat/ChatPanel";
import { GroupCountdown } from "../features/lifecycle/GroupCountdown";
import { endedByMe, PartyActions } from "../features/lifecycle/PartyActions";
import { SessionLost } from "../features/lifecycle/SessionLost";
import { ConnectionNotice, connLabel, RoomLoading } from "../features/lifecycle/ConnectionNotice";
import { QuizOverlay } from "../features/polls/QuizOverlay";
import { CalibrationPrompt } from "../features/sports/SportsPanel";
import { PairCard } from "../features/companion/PairCard";
import { CameraStrip } from "../features/voice/CameraStrip";
import { voicePanel } from "../features/voice/VoicePanel";
import { StretchGate } from "../features/wellbeing/StretchGate";
import { useWellbeing } from "../features/wellbeing/WellbeingPanel";
import { EMOJI } from "../lib/wellbeing/signals";
import { ReactionBar } from "../features/reactions/Reactions";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { MediaPicker } from "../components/MediaPicker";
import { InviteDialog, SettingsDialog } from "../components/RoomDialogs";
import { RoomEnded } from "../components/RoomEnded";
import { Stage } from "../components/Stage";
import { Avatar, AvatarStack, toast } from "../components/ui";
import { panels } from "../features/panels";
import { loadSession, normalizeCode } from "../lib/api";
import { MODES } from "../lib/modes";
import { onOpenPanel } from "../lib/open-panel";
import { RoomProvider, useRoom } from "../lib/room-context";
import { addRecent } from "../lib/settings";

/** Red dot on the chat tab when messages arrive while another tab is open. */
function useUnreadChat(active: boolean) {
  const count = useChat((s) => s.messages.filter((m) => m.kind === "user").length);
  const seen = useRef(count);
  if (active || count < seen.current) seen.current = count;
  return count > seen.current;
}

function RoomView() {
  const { room, connected, status, me, members, online, isHost, socket, settings } = useRoom();
  panels.forEach((p) => p.useSetup?.()); // constant list, so hook order is stable
  const all = [...panels.filter((p) => !p.group), voicePanel, ...panels.filter((p) => p.group)];
  const visible = all.filter((p) => !p.modes || p.modes.includes(room.mode));
  const [tab, setTab] = useState(visible.find((p) => p.id === "chat")?.id ?? visible[0]?.id);
  const [dialog, setDialog] = useState<"invite" | "settings" | null>(null);
  const [more, setMore] = useState(false); // phone-width overflow menu for the secondary top-bar actions
  const active = visible.find((p) => p.id === tab);
  const Active = active?.component;
  const unread = useUnreadChat(tab === "chat");
  const mode = MODES[room.mode];
  const ModeIcon = mode.icon;
  const well = useWellbeing((s) => s.members);
  // transformed people (🦐 🐟 🥔) float to the front of the top-bar stack so the whole group sees them
  const here = members
    .filter((m) => online.has(m.id))
    .map((m) => {
      const state = settings.playfulTransforms ? well[m.id]?.state : undefined;
      return state && state !== "normal" ? { ...m, emoji: EMOJI[state], emojiTitle: state } : m;
    })
    .sort((a, b) => Number("emoji" in b) - Number("emoji" in a));

  useEffect(() => {
    document.title = `${room.name} · WellPlayed`;
    return () => void (document.title = "WellPlayed: watch anything together");
  }, [room.name]);
  useEffect(() => addRecent({ code: room.code, name: room.name, mode: room.mode }), [room.code, room.name, room.mode]);
  // errors tied to a chat send (cid) are shown on that message instead, with Retry send
  useEffect(() => socket.on("error", (e: { message: string; cid?: string }) => !e.cid && toast(e.message, "error")), [socket]);
  // the host went quiet for a couple of minutes and the room handed the controls to us
  useEffect(
    () => socket.on("host:changed", (d: { hostId: string }) => d.hostId === me.id && toast("You’re the host now, so the playback controls are yours.", "info")),
    [socket, me.id],
  );
  // other parts of the room (e.g. the credits card on the stage) can ask for a tab; on phones the panel sits below, so scroll to it
  const tabIds = visible.map((p) => p.id).join();
  useEffect(
    () =>
      onOpenPanel(({ id }) => {
        if (!tabIds.split(",").includes(id)) return;
        setTab(id);
        if (window.matchMedia("(max-width: 900px)").matches) requestAnimationFrame(() => document.querySelector(".room-side")?.scrollIntoView({ behavior: "smooth" }));
      }),
    [tabIds],
  );

  return (
    <div className="room">
      <header className="topbar">
        <Logo size={20} />
        <span className="vdivider hide-sm" />
        <div className="room-title">
          <strong className="truncate">{room.name}</strong>
          <span className="faint">
            <ModeIcon size={12} /> {mode.label} · <span className="code-chip">{room.code}</span>
          </span>
        </div>
        <div className="actions">
          <span className="hide-sm" title={here.map((m) => m.name).join(", ")}>
            <AvatarStack people={here} />
          </span>
          <span className="conn" title={connected ? "Connected" : connLabel(status)}>
            {connected ? <span className="dot on" /> : <WifiOff size={13} color={status === "failed" ? "var(--danger)" : "var(--warning)"} />}
            <span className="hide-sm">{connected ? "Live" : connLabel(status)}</span>
          </span>
          {/* inline on wider screens; on phones these fold into the "More" menu so the top bar fits */}
          <button
            className="ghost icon topbar-more"
            aria-label="More room actions"
            title="More room actions"
            aria-haspopup="true"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            <MoreVertical size={18} />
          </button>
          {more && <div className="topbar-scrim" onClick={() => setMore(false)} />}
          <div className={more ? "topbar-extra open" : "topbar-extra"} onClick={() => setMore(false)}>
            <PairCard />
            <ThemeToggle />
            {isHost && (
              <button className="ghost icon" aria-label="Room settings" title="Room settings" onClick={() => setDialog("settings")}>
                <Settings2 size={18} />
              </button>
            )}
          </div>
          <button className="primary" onClick={() => setDialog("invite")}>
            <UserPlus size={16} />
            <span className="hide-sm">Invite</span>
          </button>
          <PartyActions />
          <span className="hide-sm">
            <Avatar id={me.id} name={me.name} size={32} />
          </span>
        </div>
      </header>
      <ConnectionNotice />

      <div className="room-body">
        <main className="room-main">
          <div className="room-main-inner">
            <BreakBanner />
            <GroupCountdown />
            <QuizOverlay />
            <StretchGate />
            <CalibrationPrompt />
            <Stage />
            <div className="actionbar">
              <ReactionBar />
              <span className="spacer" />
              <BreakButton />
            </div>
            <CameraStrip />
            <MediaPicker />
          </div>
        </main>

        <aside className="room-side">
          <nav className="rail" aria-label="Room tools">
            {visible.map((p, i) => {
              const Icon = p.icon;
              const sep = p.group && !visible[i - 1]?.group;
              return (
                <span key={p.id} style={{ display: "contents" }}>
                  {sep && <span className="rail-sep" />}
                  <button className={p.id === tab ? "active" : ""} onClick={() => setTab(p.id)} aria-label={p.title} aria-current={p.id === tab}>
                    <Icon size={19} />
                    <span>{p.short ?? p.title}</span>
                    {p.id === "chat" && unread && <i className="unread" />}
                  </button>
                </span>
              );
            })}
          </nav>
          {active && Active && (
            <section className="side-panel">
              <div className="side-head">
                <h2>
                  <active.icon size={17} /> {active.title}
                </h2>
                {active.description && <p>{active.description}</p>}
              </div>
              <div className={active.flush ? "side-body flush" : "side-body"}>
                <Active />
              </div>
            </section>
          )}
        </aside>
      </div>

      {dialog === "invite" && <InviteDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      <AwardsReveal />
    </div>
  );
}

export function Room() {
  const { code: raw = "" } = useParams();
  const code = normalizeCode(raw);
  if (code !== raw) return <Navigate to={`/room/${code}`} replace />; // /room/abc-123 → /room/ABC123
  if (!loadSession(code)) return <Navigate to={`/join/${code}`} replace />;
  return (
    <RoomProvider
      code={code}
      fallback={(conn) => <RoomLoading {...conn} />}
      ended={(gone) =>
        gone.kind === "session" ? (
          <SessionLost code={code} name={gone.name} />
        ) : (
          <RoomEnded gone={gone.kind === "ended" ? gone : null} isMe={endedByMe.has(code.toUpperCase())}>
            <EndedAwards code={code} />
          </RoomEnded>
        )
      }
    >
      <RoomView />
    </RoomProvider>
  );
}
