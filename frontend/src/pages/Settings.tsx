import { BellRing, Camera, CameraOff, Palette, Settings as SettingsIcon, Sparkles, Video } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";

import { ThemeChooser } from "../components/ThemeToggle";
import { MicTest } from "../features/voice/MicTest";
import { LANGUAGES, preferredLanguage, setPreferredLanguage } from "../lib/api";
import { clearRecent, getRecent, REELY_INTERVALS, type ReelyVibe, useSettings } from "../lib/settings";
import { playBlip } from "../lib/sound";
import { useCameraPreview } from "../lib/useCameraPreview";
import "./settings.css";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Anchors for the section nav. Card ids default to a slug of their title. */
const SECTIONS: [string, string][] = [
  ["appearance", "Appearance"],
  ["camera-and-microphone", "Devices"],
  ["reely", "Reely AI"],
  ["notifications-and-privacy", "Privacy"],
];

function SectionNav() {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SECTIONS.map(([id, label]) => (
        <a key={id} href={`#${id}`}>
          {label}
        </a>
      ))}
    </nav>
  );
}

function Card({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id?: string }) {
  return (
    <section className="settings-card" aria-label={title} id={id ?? slug(title)}>
      <h2>
        <span className="settings-card-icon">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children, id, stack }: { label: string; hint?: string; children: ReactNode; id?: string; stack?: boolean }) {
  return (
    <div className={stack ? "srow stack-sm" : "srow"}>
      <div className="txt">
        {id ? (
          <label htmlFor={id}>
            <strong>{label}</strong>
          </label>
        ) : (
          <strong>{label}</strong>
        )}
        {hint && <span>{hint}</span>}
      </div>
      <div className="ctl">{children}</div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="srow check">
      <span className="txt">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Local-only hardware check: the camera is requested on click, never uploaded or recorded. */
function CameraTest() {
  const { videoRef, status, error, cameras, deviceId, start, stop } = useCameraPreview();
  const live = status === "live";
  const pickerId = useId();
  return (
    <div className="cam-test">
      <div className={`cam-frame ${live ? "live" : ""}`}>
        <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
        {!live && (
          <span className="cam-placeholder">
            {status === "starting" ? <span className="spinner sm" /> : <CameraOff size={22} />}
            {status === "starting" ? "Waiting for permission…" : "Camera is off"}
          </span>
        )}
      </div>
      {live && (
        <p className="cam-note" aria-live="polite">
          <span className="dot on" /> Preview only. Nothing is shared or recorded.
        </p>
      )}
      {cameras.length > 1 && (
        <label className="field" htmlFor={pickerId}>
          <span>Camera</span>
          <select id={pickerId} value={deviceId} onChange={(e) => void start(e.target.value)}>
            {cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        {live ? (
          <button type="button" onClick={stop}>
            <CameraOff size={16} /> Stop test
          </button>
        ) : (
          <button type="button" onClick={() => void start(deviceId || undefined)} disabled={status === "starting"}>
            <Camera size={16} /> {status === "error" ? "Try again" : "Test my camera"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Settings() {
  const s = useSettings();
  const [language, setLanguage] = useState(preferredLanguage);
  const [recentCount, setRecentCount] = useState(() => getRecent().length);
  const [cleared, setCleared] = useState(false);
  const langId = useId();
  const vibeId = useId();
  const everyId = useId();
  const { hash } = useLocation();

  useEffect(() => {
    document.title = "Settings · WellPlayed";
    return () => void (document.title = "WellPlayed: watch anything together");
  }, []);

  useEffect(() => {
    // client-side navigation to /settings#reely doesn't scroll by itself
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="page settings-page">
      <header className="page-head">
        <span className="eyebrow">
          <SettingsIcon size={14} /> Settings
        </span>
        <h1>Preferences</h1>
        <p>Saved on this device only.</p>
      </header>

      <SectionNav />

      <div className="settings-grid">
        <Card icon={<Palette size={18} />} title="Appearance">
          <Row stack label="Theme" hint="System follows your device’s light or dark setting.">
            <ThemeChooser />
          </Row>
          <Toggle label="Reduce motion" hint="Turns off animations and transitions." checked={s.reduceMotion} onChange={(v) => s.set({ reduceMotion: v })} />
          <Row stack label="Display language" hint="Used when you start or join a room. Chat is translated into it." id={langId}>
            <select
              id={langId}
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setPreferredLanguage(e.target.value);
              }}
            >
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Row>
        </Card>

        <Card icon={<Video size={18} />} title="Camera and microphone">
          <Toggle
            label="Camera on when I join a call"
            hint="You still see a preview and confirm before anything is shared."
            checked={s.joinCam}
            onChange={(v) => s.set({ joinCam: v })}
          />
          <Toggle label="Microphone on when I join a call" checked={s.joinMic} onChange={(v) => s.set({ joinMic: v })} />
          <CameraTest />
          <MicTest />
        </Card>

        <Card icon={<Sparkles size={18} />} title="Reely AI" id="reely">
          <Row label="Personality" hint="How Reely talks to you, in rooms and on the Reely page." id={vibeId}>
            <select id={vibeId} value={s.reelyVibe} onChange={(e) => s.set({ reelyVibe: e.target.value as ReelyVibe })}>
              <option value="quiet">Quiet</option>
              <option value="normal">Normal</option>
              <option value="chaotic">Chaotic</option>
            </select>
          </Row>
          <Toggle
            label="Spoiler-safe by default"
            hint="Reely avoids plot reveals beyond where you are, unless you ask."
            checked={s.aiSpoilerSafe}
            onChange={(v) => s.set({ aiSpoilerSafe: v })}
          />
          <Toggle
            label="Timed prompts"
            hint="Reely drops an occasional debate or trivia question after your first message, only while its chat is open and visible."
            checked={s.reelyTimed}
            onChange={(v) => s.set({ reelyTimed: v })}
          />
          <Row label="Prompt frequency" hint="Counted from the last message, so it never interrupts a conversation." id={everyId}>
            <select id={everyId} value={s.reelyEvery} disabled={!s.reelyTimed} onChange={(e) => s.set({ reelyEvery: Number(e.target.value) })}>
              {REELY_INTERVALS.map((n) => (
                <option key={n} value={n}>
                  Every {n} minutes
                </option>
              ))}
            </select>
          </Row>
        </Card>

        <Card icon={<BellRing size={18} />} title="Notifications and privacy">
          <Toggle
            label="Chat message sound"
            hint="A soft blip when someone else sends a message."
            checked={s.chatSound}
            onChange={(v) => {
              s.set({ chatSound: v });
              if (v) playBlip();
            }}
          />
          <Row
            label="Recent rooms"
            hint={cleared ? "History cleared." : `Room names and codes kept on this device (${recentCount} saved). Never your access key.`}
          >
            <button
              type="button"
              className="sm"
              disabled={recentCount === 0}
              onClick={() => {
                clearRecent();
                setRecentCount(0);
                setCleared(true);
              }}
            >
              {cleared ? "Cleared" : "Clear"}
            </button>
          </Row>
        </Card>
      </div>
    </div>
  );
}
