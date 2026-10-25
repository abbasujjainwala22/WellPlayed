import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { clearSession, loadSession } from "./api";
import { RoomSocket, type ConnStatus } from "./socket";
import type { Media, Member, RoomSettings, RoomSnapshot, Timeline } from "./types";

export type { ConnStatus };

/** Connection state for screens shown before the room has loaded (see RoomProvider's `fallback`). */
export interface RoomConnection {
  status: ConnStatus;
  retry: () => void;
}

export interface RoomCtx {
  socket: RoomSocket;
  room: RoomSnapshot;
  members: Member[];
  online: Set<string>;
  me: Member;
  isHost: boolean;
  canControl: boolean;
  connected: boolean;
  /** Finer-grained than `connected`: connecting, live, reconnecting, offline or failed. */
  status: ConnStatus;
  /** Reconnect now (the Retry button after the socket gave up). */
  retry: () => void;
  timeline: Timeline;
  media: Media | null;
  settings: RoomSettings;
}

/** Why this screen can't show the room any more. */
export type RoomGone =
  | { kind: "ended"; reason: "host" | "expired" | "empty" | "unknown"; by?: string | null; message?: string }
  | { kind: "session"; name?: string } // our token stopped working (we left, or were removed)
  | { kind: "missing" }; // the server doesn't know the room at all (it restarted)

const Ctx = createContext<RoomCtx | null>(null);

export function useRoom(): RoomCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRoom outside RoomProvider");
  return v;
}

export function RoomProvider({
  code,
  device = "screen",
  fallback,
  ended,
  children,
}: {
  code: string;
  device?: "screen" | "companion";
  /** Shown until the room loads; a function gets the connection state, e.g. to offer Retry. */
  fallback: ReactNode | ((conn: RoomConnection) => ReactNode);
  /** Shown when the party ended, the server forgot the room, or this session stopped working. */
  ended: ReactNode | ((gone: RoomGone) => ReactNode);
  children: ReactNode;
}) {
  const session = loadSession(code);
  const socket = useMemo(
    () => (session ? new RoomSocket(code, session.token, device) : null),
    [code, device, session?.token],
  );
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [gone, setGone] = useState<RoomGone | null>(null);

  useEffect(() => {
    if (!socket) return;
    const offs = [
      socket.on("room:snapshot", (s: RoomSnapshot) => {
        setRoom(s);
        setMembers(s.members);
        setTimeline(s.timeline);
        setMedia(s.media);
        setSettings(s.settings);
      }),
      socket.on("members:state", (d) => {
        setMembers(d.members);
        // the host can change hands when they leave
        if (d.hostId) setRoom((r) => (r && r.hostId !== d.hostId ? { ...r, hostId: d.hostId } : r));
      }),
      socket.on("room:ended", (d) => {
        clearSession(code); // the invite and this token stop working
        setGone({ kind: "ended", reason: d.reason ?? "unknown", by: d.by, message: d.message });
      }),
      socket.on("presence", (d) => setOnline(new Set(d.online as string[]))),
      socket.on("_connected", setConnected),
      socket.on("_status", setStatus),
      socket.on("_ended", (closeCode: number) => {
        const name = loadSession(code)?.name;
        clearSession(code); // the token is dead; joining again needs a fresh one
        setGone(
          (g) =>
            g ?? (closeCode === 4410 ? { kind: "ended", reason: "unknown" } : closeCode === 4404 ? { kind: "missing" } : { kind: "session", name }),
        );
      }),
      socket.on("timeline:state", setTimeline),
      socket.on("media:state", (d) => setMedia(d.media)),
      socket.on("settings:state", (d) => setSettings(d.settings)),
      // By default reactions display immediately; sports mode re-routes this to a delayed queue.
      socket.on("reaction:event", (r) => socket.deliver("reaction:display", r)),
    ];
    socket.connect();
    return () => {
      offs.forEach((o) => o());
      socket.close();
    };
  }, [socket, code]);

  if (gone) return <>{typeof ended === "function" ? ended(gone) : ended}</>;
  const retry = () => socket?.retry();
  if (!socket || !room || !timeline || !settings)
    return <>{typeof fallback === "function" ? fallback({ status, retry }) : fallback}</>;
  const me = members.find((m) => m.id === room.you.id) ?? room.you;
  const isHost = me.id === room.hostId;
  const value: RoomCtx = {
    socket,
    room,
    members,
    online,
    me,
    isHost,
    canControl: isHost || settings.membersCanControl,
    connected,
    status,
    retry,
    timeline,
    media,
    settings,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
