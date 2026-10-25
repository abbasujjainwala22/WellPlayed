import { AlertTriangle, Clock, Hourglass, Link2, Maximize, Pause, Play, Radio, RotateCcw, RotateCw, Tv, Volume2, VolumeX } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { SpeedControl } from "../features/lifecycle/SpeedControl";
import { CreditsRolled, PartyBackdrop } from "../features/personality";
import { ReactionFloat } from "../features/reactions/Reactions";
import { SubtitleOverlay } from "../features/subtitles/SubtitleOverlay";
import { copyText } from "../lib/clipboard";
import { createAdapter, type PlayerAdapter } from "../lib/players";
import { useRoom } from "../lib/room-context";
import { usePlayback } from "../lib/playback-store";
import { SyncController, type SyncStatus } from "../lib/sync/controller";
import { MediaPicker } from "./MediaPicker";
import { toast } from "./ui";

export const stageRef: { controller: SyncController | null; adapter: PlayerAdapter | null } = {
  controller: null,
  adapter: null,
};

/** Buffer reported once a player holds everything up to the end of the video. */
const BUFFERED_TO_END_S = 30;

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

function SyncPill({ status }: { status: SyncStatus | null }) {
  if (!status) return <span className="sync-pill">Syncing…</span>;
  const d = Math.abs(status.driftMs);
  const cls = d < 250 ? "good" : "warn";
  return (
    <span className={`sync-pill ${cls}`} title={`Your player is ${status.driftMs} ms from the room timeline`}>
      <span className={`dot ${cls === "good" ? "on" : "warn"}`} />
      {d < 250 ? "In sync" : "Catching up"} · {status.driftMs} ms
    </span>
  );
}

/** Local volume for file / HLS sources (YouTube draws its own). Volume is personal, never synced. */
function VolumeControl({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const video = () => box.current?.querySelector("video") ?? null;
  if (!video()) return null;
  const apply = (v: number, m: boolean) => {
    const el = video();
    if (!el) return;
    el.volume = v;
    el.muted = m;
    setVolume(v);
    setMuted(m);
  };
  return (
    <span className="hide-mini" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <button className="ghost icon" aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"} onClick={() => apply(volume, !muted)}>
        {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label="Volume"
        style={{ width: 80 }}
        onChange={(e) => apply(+e.target.value, +e.target.value === 0)}
      />
    </span>
  );
}

function StageError({ message }: { message: string }) {
  const { canControl } = useRoom();
  return (
    <div className="stage-error" role="alert">
      <div className="state-icon">
        <AlertTriangle size={24} />
      </div>
      <strong>This video can’t play</strong>
      <p>{message}</p>
      <p className="faint">{canControl ? "Use “Change video” below to pick another one." : "The host can pick another video."}</p>
    </div>
  );
}

function EmptyStage() {
  const { canControl, members, room } = useRoom();
  const host = members.find((m) => m.id === room.hostId);
  const link = `${location.origin}/join/${room.code}`;
  if (canControl)
    return (
      <div className="stage-empty party-host">
        <PartyBackdrop scene="stage" />
        <div className="inner">
          <div className="state-icon brand">
            <Tv size={26} />
          </div>
          <h2>What are we watching?</h2>
          <p>Paste a YouTube link or a video URL. Everyone’s player loads it and starts in sync.</p>
          <div className="picker">
            <MediaPicker variant="hero" />
          </div>
        </div>
      </div>
    );
  return (
    <div className="stage-empty party-host">
      <PartyBackdrop scene="stage" />
      <div className="inner">
        <div className="state-icon pulse">
          <Hourglass size={26} />
        </div>
        <h2>Waiting for {host?.name ?? "the host"} to pick something</h2>
        <p>Playback starts on your screen automatically, in sync with everyone else. Grab a snack while you wait.</p>
        <button
          className="sm"
          style={{ marginTop: 8 }}
          onClick={async () => {
            if (await copyText(link)) toast("Invite link copied");
            else toast("Couldn’t copy the link", "error");
          }}
        >
          <Link2 size={14} /> Copy invite link
        </button>
      </div>
    </div>
  );
}

export function Stage() {
  const { socket, media, timeline, canControl, settings } = useRoom();
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ctl = useRef<SyncController | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const latest = useRef(timeline);
  latest.current = timeline;

  useEffect(() => {
    setStatus(null);
    setDuration(0);
    setError("");
    if (!media || !box.current) return;
    const adapter = createAdapter(media.kind, box.current);
    if (!adapter) return;
    let dead = false;
    stageRef.adapter = adapter;
    const fail = (message: string) => !dead && setError(message);
    adapter.onError?.(fail);
    adapter.onEnded?.(() => socket.send("queue:ended", { mediaId: media.id, at: adapter.getTime() }));
    if (media.live) {
      // free-running live stream: no timeline to follow; the user presses play themselves
      adapter
        .load(media)
        .then(async () => {
          if (dead) return;
          const ok = await adapter.play();
          setStatus({ driftMs: 0, needsGesture: !ok, state: "playing", position: 0 });
        })
        .catch((e: Error) => fail(e.message));
      return () => {
        dead = true;
        adapter.destroy();
        stageRef.adapter = null;
      };
    }
    const c = new SyncController(socket, adapter);
    ctl.current = c;
    stageRef.controller = c;
    const telemetry = window.setInterval(() => {
      // Near the end only a few seconds remain to buffer. If they are all loaded, report a healthy buffer,
      // or buffer forecasting reads "almost empty" and pauses the room just before the credits, forever.
      const ahead = adapter.bufferedAhead();
      const left = adapter.duration() - adapter.getTime();
      const toEnd = adapter.duration() > 0 && ahead >= left - 0.25;
      socket.send("telemetry:buffer", {
        bufferAheadS: toEnd ? BUFFERED_TO_END_S : ahead,
        buffering: adapter.isBuffering(),
        bandwidthKbps: adapter.bandwidthKbps?.() ?? null,
        t: Date.now(),
      });
    }, 2000);
    const offBoost = socket.on("preload:boost", (d) => adapter.boost?.(d.seconds));
    let lastBlocked = 0;
    c.onBlocked = () => {
      if (Date.now() - lastBlocked < 4000) return;
      lastBlocked = Date.now();
      toast("Only the host controls playback, so you’ve been kept in sync with the room.", "info");
    };
    c.onStatus = (s) => {
      setStatus(s);
      const d = adapter.duration();
      setDuration(Number.isFinite(d) ? d : 0);
      usePlayback.getState().set(s.position, s.driftMs);
    };
    adapter
      .load(media)
      .then(() => !dead && c.apply(latest.current))
      .catch((e: Error) => fail(e.message));
    return () => {
      dead = true;
      window.clearInterval(telemetry);
      offBoost();
      c.destroy();
      ctl.current = null;
      stageRef.controller = null;
      stageRef.adapter = null;
    };
  }, [media?.id, media?.url, socket]);

  useEffect(() => {
    if (ctl.current) ctl.current.canControl = canControl;
  }, [canControl, media?.id]);
  useEffect(() => ctl.current?.apply(timeline), [timeline]);

  const playing = timeline.state === "playing";
  const send = (data: object) => socket.send("timeline:set", data);
  // after the video finishes, play starts it again from the top
  const togglePlay = () => send(playing ? { action: "pause" } : { action: "play", ...(timeline.note === "Finished" ? { at: 0 } : {}) });

  // Space toggles playback for anyone allowed to control it
  useEffect(() => {
    if (!media || media.live || !canControl) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!media) return <EmptyStage />;
  if (media.kind === "external")
    return (
      <div className="stage-empty">
        <div className="inner">
          <div className="state-icon brand">
            <Tv size={26} />
          </div>
          <h2>{media.title}</h2>
          <p>Everyone plays this on their own streaming service. The WellPlayed browser extension keeps every tab in sync to the second.</p>
          <p className="faint">Open “Pair phone” in the top bar for the extension’s connection details.</p>
        </div>
      </div>
    );

  const fullscreen = () => void wrap.current?.requestFullscreen?.();
  const position = status?.position ?? 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  if (media.live) {
    return (
      <div className={settings.audioFirst ? "player mini" : "player"}>
        <div className="stage-wrap" ref={wrap}>
          <div className="stage" ref={box} />
          <SubtitleOverlay />
          <ReactionFloat />
          {error && <StageError message={error} />}
          {!error && status?.needsGesture && (
            <button className="primary overlay" onClick={() => void stageRef.adapter?.play()}>
              <Play size={18} /> Tap to start the stream
            </button>
          )}
        </div>
        <div className="controls">
          <div className="controls-row">
            <span className="tag live">
              <Radio size={12} /> LIVE
            </span>
            <span className="muted grow">Streams run on your own connection. Reactions and chat are lined up to your delay.</span>
            <button className="ghost icon sm hide-mini" aria-label="Fullscreen" onClick={fullscreen}>
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={settings.audioFirst ? "player mini" : "player"}>
      <div className="stage-wrap" ref={wrap}>
        <div className="stage" ref={box} />
        <SubtitleOverlay />
        <ReactionFloat />
        {error && <StageError message={error} />}
        {!error && <CreditsRolled />}
        {!error && status?.needsGesture && (
          <button className="primary overlay lg" onClick={() => void ctl.current?.unlock()}>
            <Play size={18} /> Tap to join playback
          </button>
        )}
      </div>
      <div className="controls">
        <div
          className={`progress ${canControl && duration > 0 ? "seekable" : ""}`}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          onClick={(e) => {
            if (!canControl || duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            send({ action: "seek", to: ((e.clientX - r.left) / r.width) * duration });
          }}
        >
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="controls-row">
          <button
            className="ghost icon"
            disabled={!canControl}
            aria-label={playing ? "Pause" : "Play"}
            title={canControl ? (playing ? "Pause (Space)" : "Play (Space)") : "Only the host controls playback"}
            onClick={togglePlay}
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="ghost icon" disabled={!canControl} aria-label="Back 10 seconds" title="Back 10s" onClick={() => send({ action: "seek", to: Math.max(0, position - 10) })}>
            <RotateCcw size={18} />
          </button>
          <button className="ghost icon" disabled={!canControl} aria-label="Forward 10 seconds" title="Forward 10s" onClick={() => send({ action: "seek", to: position + 10 })}>
            <RotateCw size={18} />
          </button>
          <VolumeControl box={box} />
          <span className="time">
            {fmtTime(position)}
            {duration > 0 && <span className="faint"> / {fmtTime(duration)}</span>}
          </span>
          {timeline.note && (
            <span className="stage-note">
              <Clock size={14} /> {timeline.note}
            </span>
          )}
          <span className="spacer" />
          <SpeedControl rate={timeline.rate} limited={!!status?.rateLimited} />
          <span className="hide-mini hide-sm">
            <SyncPill status={status} />
          </span>
          <button className="ghost icon hide-mini" aria-label="Fullscreen" title="Fullscreen" onClick={fullscreen}>
            <Maximize size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
