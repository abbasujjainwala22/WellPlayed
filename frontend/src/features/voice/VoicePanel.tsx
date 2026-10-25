import { Mic, MicOff, PhoneCall, PhoneOff, RefreshCw, Video, VideoOff, Volume2, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useRoom } from "../../lib/room-context";
import { useSettings } from "../../lib/settings";
import { useCameraPreview } from "../../lib/useCameraPreview";
import { AnimalLauncher } from "../animal/AnimalChaos";
import type { Panel } from "../panels";
import { CallStatusNote } from "./CameraStrip";
import { MicTest, savedMicId } from "./MicTest";
import { MAX_REJOINS, useVoice } from "./voice";
import "./voice.css";

/** Opt-in step before the call: a local preview only. Nothing is published until "Join call". */
function PreJoin({ onJoin }: { onJoin: (opts: { mic: boolean; cam: boolean; micId: string }) => void }) {
  const { videoRef, status, error, start, stop } = useCameraPreview();
  const [mic, setMic] = useState(() => useSettings.getState().joinMic);
  const [micId, setMicId] = useState(savedMicId);
  const camOn = status === "live" || status === "starting";

  useEffect(() => {
    if (useSettings.getState().joinCam) void start();
  }, [start]);

  const join = () => {
    const cam = status === "live";
    stop(); // hand the camera back before the call opens it again
    onJoin({ mic, cam, micId });
  };

  return (
    <div className="prejoin">
      <div className={`prejoin-frame ${status === "live" ? "live" : ""}`}>
        <video ref={videoRef} autoPlay playsInline muted aria-label="Your camera preview" />
        {status !== "live" && (
          <span className="prejoin-off">
            {status === "starting" ? <span className="spinner sm" /> : <VideoOff size={22} />}
            {status === "starting" ? "Starting camera…" : "Camera off"}
          </span>
        )}
        <span className={`prejoin-mic ${mic ? "" : "off"}`} title={mic ? "Microphone on" : "Microphone off"}>
          {mic ? <Mic size={14} /> : <MicOff size={14} />}
        </span>
      </div>
      <div className="prejoin-toggles">
        <button type="button" aria-pressed={mic} className={mic ? "" : "off"} onClick={() => setMic((m) => !m)}>
          {mic ? <Mic size={16} /> : <MicOff size={16} />}
          {mic ? "Mic on" : "Mic off"}
        </button>
        <button type="button" aria-pressed={camOn} className={camOn ? "" : "off"} onClick={() => (camOn ? stop() : void start())}>
          {camOn ? <Video size={16} /> : <VideoOff size={16} />}
          {camOn ? "Camera on" : "Camera off"}
        </button>
      </div>
      {mic && <MicTest compact onDevice={setMicId} />}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" className="primary lg block" onClick={join} disabled={status === "starting"}>
        <PhoneCall size={18} /> Join call
      </button>
      <p className="faint">Only people in this room hear or see you. Nothing is recorded. You can keep watching without joining.</p>
    </div>
  );
}

/** Shown instead of the pre-join when the server says calls can't work right now. */
function Unavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="voice-unavailable" role="status">
      <WifiOff size={18} />
      <div>
        <strong>Voice and video are unavailable</strong>
        <p className="muted">{message || "The call service can’t be reached right now."} Watching and chat still work.</p>
        <button type="button" className="sm" onClick={onRetry}>
          <RefreshCw size={14} /> Check again
        </button>
      </div>
    </div>
  );
}

function VoicePanel() {
  const { room, members } = useRoom();
  const { status, error, micOn, camOn, people, attempt, availability, checkAvailability, join, leave, toggleMic, toggleCam } = useVoice();
  const names = new Map(members.map((m) => [m.id, m.name]));
  const inCall = status === "on" || status === "reconnecting";

  useEffect(() => {
    if (status === "off") void checkAvailability(room.code);
  }, [room.code, status, checkAvailability]);

  return (
    <div className="stack">
      <p className="muted">Talk while you watch. Cameras show under the video. On a phone, use the paired remote so the big screen stays quiet.</p>
      {status === "off" &&
        (availability.checked && !availability.available ? (
          <Unavailable message={availability.message} onRetry={() => void checkAvailability(room.code)} />
        ) : (
          <PreJoin onJoin={(opts) => void join(room.code, opts)} />
        ))}
      {status === "connecting" && (
        <p className="muted row">
          <span className="spinner sm" /> Connecting…
        </p>
      )}
      {status === "rejoining" && (
        <div className="row">
          <CallStatusNote />
          <span className="faint">Attempt {attempt} of {MAX_REJOINS}</span>
          <button type="button" className="sm danger" onClick={leave}>
            Stop
          </button>
        </div>
      )}
      {inCall && (
        <div className="row">
          <button onClick={() => void toggleMic()} disabled={status !== "on"}>
            {micOn ? <><Mic size={16} /> Mute</> : <><MicOff size={16} /> Unmute</>}
          </button>
          <button onClick={() => void toggleCam()} disabled={status !== "on"}>
            {camOn ? <><VideoOff size={16} /> Camera off</> : <><Video size={16} /> Camera on</>}
          </button>
          <button className="danger" onClick={leave}>
            <PhoneOff size={16} /> Leave
          </button>
          <AnimalLauncher />
          <CallStatusNote />
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {people.length > 0 && (
        <ul className="plain voice-people">
          {people.map((p) => {
            const Icon = p.speaking ? Volume2 : p.muted ? MicOff : Mic;
            const state = p.speaking ? "Speaking" : p.muted ? "Muted" : "Mic on";
            return (
              <li key={p.id} className={p.speaking ? "is-speaking" : ""}>
                <Icon size={15} aria-label={state} className={p.muted && !p.speaking ? "muted-icon" : ""} />
                <span className="truncate">{names.get(p.id) ?? p.name}</span>
                {p.local && <span className="muted">(you)</span>}
                {p.video && <Video size={13} aria-label="Camera on" className="faint-icon" />}
                {p.poor && <WifiOff size={13} aria-label="Weak connection" className="poor-icon" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const voicePanel: Panel = { id: "voice", title: "Voice", icon: Mic, description: "Talk while you watch. Your voice stays out of the video’s way.", component: VoicePanel, companion: true };
