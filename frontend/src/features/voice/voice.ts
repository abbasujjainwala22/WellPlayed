import { ConnectionQuality, DisconnectReason, type Participant, Room, RoomEvent, Track } from "livekit-client";
import { create } from "zustand";

import { api, ApiError, loadSession } from "../../lib/api";
import { callErrorMessage } from "../../lib/mediaErrors";

export interface Person {
  /** LiveKit identity, which is the room member id. */
  id: string;
  name: string;
  speaking: boolean;
  muted: boolean;
  local: boolean;
  /** Weak or lost connection, from LiveKit's connection quality. */
  poor: boolean;
  /** The live camera track, or null when the camera is off or muted. */
  video: Track | null;
}

/**
 * off → connecting → on. A dropped media connection shows "reconnecting" while LiveKit resumes it;
 * if LiveKit gives up we fetch a fresh token and rejoin with backoff ("rejoining").
 */
export type CallStatus = "off" | "connecting" | "on" | "reconnecting" | "rejoining";

export interface Availability {
  checked: boolean;
  available: boolean;
  message: string;
}

interface VoiceState {
  status: CallStatus;
  error: string;
  micOn: boolean;
  camOn: boolean;
  people: Person[];
  /** Current rejoin attempt (1-based) while status is "rejoining". */
  attempt: number;
  availability: Availability;
  /** Asks the server whether calls work right now (cached server-side), so the UI can hide voice cleanly. */
  checkAvailability: (code: string) => Promise<void>;
  /** Connects to the call; nothing is published until this runs. Defaults: mic on, camera off. */
  join: (code: string, opts?: { mic?: boolean; cam?: boolean; micId?: string }) => Promise<void>;
  leave: () => void;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  room: Room | null;
}

export const MAX_REJOINS = 5;

/** Disconnects that a rejoin can't fix, with what to tell the person. */
const FINAL: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.DUPLICATE_IDENTITY]: "You joined this call from another tab or device, so it was closed here.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the call.",
  [DisconnectReason.ROOM_DELETED]: "The call has ended.",
  [DisconnectReason.ROOM_CLOSED]: "The call has ended.",
};

const ROSTER_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionQualityChanged,
] as const;

const audioHost = () => {
  let el = document.getElementById("wp-audio");
  if (!el) {
    el = document.createElement("div");
    el.id = "wp-audio";
    el.style.display = "none";
    document.body.appendChild(el);
  }
  return el;
};

const memberHeaders = (code: string) => ({ "x-member-token": loadSession(code)?.token ?? "" });

/** Rejoins can't fix a missing setup or a dead room session; network blips and 5xx are worth retrying. */
const transient = (e: unknown) => {
  const status = e instanceof ApiError ? e.status : undefined;
  return status === undefined || (status >= 500 && status !== 501 && status !== 503);
};

export const useVoice = create<VoiceState>((set, get) => {
  // What the person asked for, so a rejoin restores the same call. Every connect attempt gets a
  // generation number; events and results from an older generation are ignored.
  const want = { code: "", mic: true, cam: false, micId: "" };
  let gen = 0;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refresh = () => {
    const room = get().room;
    if (!room) return;
    const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    set({
      people: all.map((p) => {
        const cam = p.getTrackPublication(Track.Source.Camera);
        return {
          id: p.identity,
          name: p.name || p.identity,
          speaking: p.isSpeaking,
          muted: !p.isMicrophoneEnabled,
          local: p === room.localParticipant,
          poor: p.connectionQuality === ConnectionQuality.Poor || p.connectionQuality === ConnectionQuality.Lost,
          video: cam?.track && !cam.isMuted ? cam.track : null,
        };
      }),
      micOn: room.localParticipant.isMicrophoneEnabled,
      camOn: room.localParticipant.isCameraEnabled,
    });
  };

  const reset = (extra: Partial<VoiceState>) => {
    audioHost().replaceChildren();
    set({ room: null, people: [], micOn: false, camOn: false, attempt: 0, ...extra });
  };

  const scheduleRejoin = () => {
    tries += 1;
    if (tries > MAX_REJOINS) {
      reset({ status: "off", error: "We lost the call connection. Join again when you’re ready." });
      return;
    }
    const mine = ++gen;
    reset({ status: "rejoining", attempt: tries });
    timer = setTimeout(() => void connect(mine), Math.min(1000 * 2 ** (tries - 1), 15000));
  };

  const wire = (room: Room, mine: number) => {
    const current = () => mine === gen && get().room === room;
    const update = () => current() && refresh();
    ROSTER_EVENTS.forEach((ev) => room.on(ev, update));
    room
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (mine === gen && track.kind === Track.Kind.Audio) audioHost().appendChild(track.attach());
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((e) => e.remove()))
      .on(RoomEvent.Reconnecting, () => current() && set({ status: "reconnecting" }))
      .on(RoomEvent.Reconnected, () => {
        if (!current()) return;
        set({ status: "on" });
        refresh();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        // ignore: we left on purpose, a newer attempt replaced this room, or connect() never finished (its catch handles that)
        if (!current()) return;
        if (reason === DisconnectReason.CLIENT_INITIATED) return reset({ status: "off" });
        const final = reason === undefined ? undefined : FINAL[reason];
        if (final) return reset({ status: "off", error: final });
        scheduleRejoin();
      });
  };

  const connect = async (mine: number) => {
    let room: Room | null = null;
    try {
      // Tokens are short-lived (15 min). A connected participant stays connected past expiry because
      // LiveKit refreshes the token for its own reconnects; every (re)join here fetches a new one.
      const t = await api<{ url: string; token: string }>(`/api/rooms/${want.code}/voice-token`, { headers: memberHeaders(want.code) });
      if (mine !== gen) return;
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: want.micId ? { deviceId: want.micId } : undefined,
      });
      wire(room, mine);
      await room.connect(t.url, t.token);
      if (mine !== gen) {
        void room.disconnect();
        return;
      }
      tries = 0;
      set({ room, status: "on", attempt: 0, error: "" });
      refresh();
      const problems: string[] = [];
      if (want.mic) {
        await room.localParticipant.setMicrophoneEnabled(true).catch((e) => {
          want.mic = false;
          problems.push(`${callErrorMessage(e, "mic")} You can still listen.`);
        });
      }
      if (want.cam) {
        await room.localParticipant.setCameraEnabled(true).catch((e) => {
          want.cam = false;
          problems.push(callErrorMessage(e, "camera"));
        });
      }
      if (mine !== gen) return;
      if (problems.length) set({ error: problems.join(" ") });
      refresh();
    } catch (e) {
      if (mine !== gen) return;
      gen++; // ignore anything the half-open room still emits
      void room?.disconnect();
      if (get().status === "rejoining" && transient(e)) return scheduleRejoin();
      reset({ status: "off", error: callErrorMessage(e) });
    }
  };

  return {
    status: "off",
    error: "",
    micOn: false,
    camOn: false,
    people: [],
    attempt: 0,
    availability: { checked: false, available: true, message: "" },
    room: null,
    async checkAvailability(code) {
      try {
        const a = await api<{ available: boolean; message: string }>(`/api/rooms/${code}/voice-status`, { headers: memberHeaders(code) });
        set({ availability: { checked: true, available: a.available, message: a.message } });
      } catch {
        // can't tell (older server, network): let a join attempt report the real problem
        set({ availability: { checked: true, available: true, message: "" } });
      }
    },
    async join(code, opts) {
      if (get().status !== "off") return;
      clearTimeout(timer);
      Object.assign(want, { code, mic: opts?.mic ?? true, cam: opts?.cam ?? false, micId: opts?.micId ?? "" });
      tries = 0;
      set({ status: "connecting", error: "", attempt: 0 });
      await connect(++gen);
    },
    leave() {
      clearTimeout(timer);
      gen++; // the Disconnected event of this room is now ignored
      const room = get().room;
      reset({ status: "off", error: "" });
      void room?.disconnect();
    },
    async toggleMic() {
      const lp = get().room?.localParticipant;
      if (!lp) return;
      const next = !lp.isMicrophoneEnabled;
      try {
        await lp.setMicrophoneEnabled(next);
        want.mic = next;
        set({ error: "" });
      } catch (e) {
        set({ error: callErrorMessage(e, "mic") });
      }
      refresh();
    },
    async toggleCam() {
      const lp = get().room?.localParticipant;
      if (!lp) return;
      const next = !lp.isCameraEnabled;
      try {
        await lp.setCameraEnabled(next);
        want.cam = next;
        set({ error: "" });
      } catch (e) {
        set({ error: callErrorMessage(e, "camera") });
      }
      refresh();
    },
  };
});
