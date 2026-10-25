import { ChevronDown, Mic, MicOff, PhoneOff, Video, VideoOff, WifiOff } from "lucide-react";
import { useState } from "react";

import { useRoom } from "../../lib/room-context";
import { AnimalChaosDialog, AnimalLauncher, AnimalNotice } from "../animal/AnimalChaos";
import { AnimalOverlay } from "../animal/AnimalOverlay";
import { useAnimalSetup } from "../animal/store";
import { MAX_REJOINS, useVoice } from "./voice";
import { VoiceTile } from "./VoiceTile";
import "./voice.css";

const OPEN_KEY = "wp:cameras-open";

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

/** Live call state in words, shared by the camera strip and the voice panel. */
export function CallStatusNote() {
  const { status, attempt } = useVoice();
  if (status !== "reconnecting" && status !== "rejoining") return null;
  return (
    <span className="call-state" role="status">
      <WifiOff size={13} />
      {status === "reconnecting" ? "Reconnecting…" : `Rejoining (try ${attempt} of ${MAX_REJOINS})…`}
    </span>
  );
}

/** Everyone in the call, under the stage. Only shown while you are in the call; collapsible. */
export function CameraStrip() {
  const { members } = useRoom();
  const { status, people, micOn, camOn, toggleMic, toggleCam, leave } = useVoice();
  const [open, setOpen] = useState(readOpen);
  useAnimalSetup(); // before the early return, so effect state is kept while the strip is hidden
  if (status === "off" || status === "connecting") return null;

  const names = new Map(members.map((m) => [m.id, m.name]));
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      /* storage unavailable */
    }
  };
  const live = status === "on";

  return (
    <section className={`camera-strip ${open ? "open" : ""}`} aria-label="Cameras">
      <div className="camera-strip-head">
        <button type="button" className="ghost camera-strip-toggle" aria-expanded={open} onClick={toggle}>
          <Video size={16} />
          <strong>Cameras</strong>
          <span className="faint">({people.length})</span>
          <ChevronDown size={16} className="chev" />
        </button>
        <CallStatusNote />
        <span className="spacer" />
        <AnimalLauncher />
        <button
          type="button"
          className={`ghost icon ${micOn ? "" : "off"}`}
          disabled={!live}
          aria-pressed={micOn}
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
          title={micOn ? "Mute" : "Unmute"}
          onClick={() => void toggleMic()}
        >
          {micOn ? <Mic size={17} /> : <MicOff size={17} />}
        </button>
        <button
          type="button"
          className={`ghost icon ${camOn ? "" : "off"}`}
          disabled={!live}
          aria-pressed={camOn}
          aria-label={camOn ? "Turn camera off" : "Turn camera on"}
          title={camOn ? "Camera off" : "Camera on"}
          onClick={() => void toggleCam()}
        >
          {camOn ? <Video size={17} /> : <VideoOff size={17} />}
        </button>
        <button type="button" className="ghost icon danger" aria-label="Leave call" title="Leave call" onClick={leave}>
          <PhoneOff size={17} />
        </button>
      </div>
      {open && people.length > 0 && (
        <div className="camera-grid">
          {people.map((p) => (
            <VoiceTile key={p.id} person={p} name={names.get(p.id)} overlay={(ctx) => <AnimalOverlay {...ctx} />} />
          ))}
        </div>
      )}
      <AnimalChaosDialog />
      <AnimalNotice />
    </section>
  );
}
