import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { mediaErrorMessage } from "../../lib/mediaErrors";
import "./voice.css";

const MIC_KEY = "wp:mic-device";

/** The microphone picked in Settings or before a call (this device only). Empty means the default. */
export function savedMicId(): string {
  try {
    return localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveMicId(id: string): void {
  try {
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    /* storage unavailable */
  }
}

type MicStatus = "idle" | "starting" | "live" | "error";

/**
 * Local-only microphone level (Web Audio AnalyserNode). Nothing is recorded or sent anywhere; the
 * microphone is released on stop(), when switching devices, and on unmount.
 */
export function useMicLevel() {
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const attempt = useRef(0);
  const [status, setStatus] = useState<MicStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(savedMicId);

  const release = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    attempt.current++; // cancels a start() still waiting for permission
    release();
    setStatus("idle");
  }, [release]);

  const start = useCallback(
    async (id?: string) => {
      release();
      setError("");
      const fail = (e: unknown) => {
        setStatus("error");
        setError(mediaErrorMessage(e, "mic"));
      };
      if (!window.isSecureContext) return fail({ name: "InsecureContext" });
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) return fail({ name: "Unsupported" });
      const mine = ++attempt.current;
      setStatus("starting");
      try {
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true, video: false });
        } catch (e) {
          if (!id || (e as Error).name !== "OverconstrainedError") throw e;
          s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); // saved mic was unplugged
        }
        if (mine !== attempt.current) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        const audio = new AudioContext();
        ctx.current = audio;
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        audio.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        timer.current = setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        }, 80);
        setStatus("live");
        // Device labels only appear once permission is granted.
        setMics((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        const used = s.getAudioTracks()[0]?.getSettings().deviceId ?? id ?? "";
        setDeviceId(used);
        if (id) saveMicId(used);
      } catch (e) {
        if (mine === attempt.current) fail(e);
      }
    },
    [release],
  );

  const choose = useCallback(
    (id: string) => {
      saveMicId(id);
      setDeviceId(id);
      void start(id);
    },
    [start],
  );

  useEffect(
    () => () => {
      attempt.current++;
      release();
    },
    [release],
  );

  return { status, level, error, mics, deviceId, start, stop, choose };
}

/** Level bar plus device picker. `compact` is the slimmer version used before joining a call. */
export function MicTest({ compact = false, onDevice }: { compact?: boolean; onDevice?: (id: string) => void }) {
  const { status, level, error, mics, deviceId, start, stop, choose } = useMicLevel();
  const pickerId = useId();
  const live = status === "live";
  const pct = Math.round(level * 100);

  useEffect(() => onDevice?.(deviceId), [deviceId, onDevice]);

  return (
    <div className={`mic-test ${compact ? "compact" : ""}`}>
      <div className="mic-test-row">
        {live ? (
          <button type="button" className={compact ? "sm" : ""} onClick={stop}>
            <Square size={14} /> {compact ? "Stop" : "Stop microphone test"}
          </button>
        ) : (
          <button type="button" className={compact ? "sm" : ""} onClick={() => void start(deviceId || undefined)} disabled={status === "starting"}>
            {status === "starting" ? <span className="spinner sm" /> : <Mic size={16} />}
            {status === "starting" ? "Waiting for permission…" : status === "error" ? "Try again" : compact ? "Test mic" : "Test my microphone"}
          </button>
        )}
        <div
          className={`mic-meter ${live ? "live" : ""}`}
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {live && mics.length > 1 && (
        <label className="field" htmlFor={pickerId}>
          <span>Microphone</span>
          <select id={pickerId} value={deviceId} onChange={(e) => choose(e.target.value)}>
            {mics.map((m, i) => (
              <option key={m.deviceId || i} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {live && !compact && <p className="faint">Speak to see the level. Nothing is recorded or shared.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
