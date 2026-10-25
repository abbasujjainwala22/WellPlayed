import { CircleCheck, Clock, FileText, History, NotebookPen, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { api, loadSession } from "../../lib/api";
import { usePlayback } from "../../lib/playback-store";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";

interface PlanItem {
  id: string;
  at: number;
  fired: boolean;
  question: string;
}
interface Recap {
  bullets: string[];
  source: string;
  note?: string;
}
interface Notes {
  summary: string;
  points: { t: number; text: string }[];
  source: string;
}

export const useStudy = create<{ plan: PlanItem[]; set: (p: PlanItem[]) => void }>((set) => ({ plan: [], set: (plan) => set({ plan }) }));

function useAiSetup() {
  const { socket } = useRoom();
  useEffect(() => socket.on("study:plan", (d) => useStudy.getState().set(d.plan)), [socket]);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function AiPanel() {
  const { room, isHost, socket } = useRoom();
  const token = loadSession(room.code)?.token ?? "";
  const headers = { "x-member-token": token };
  const plan = useStudy((s) => s.plan);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [notes, setNotes] = useState<Notes | null>(null);
  const [msg, setMsg] = useState("");
  const [count, setCount] = useState(4);

  const run = async (fn: () => Promise<void>) => {
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const uploadTranscript = (f: File) =>
    run(async () => {
      const r = await api<{ cues: number }>(`/api/rooms/${room.code}/transcript`, {
        method: "POST",
        headers,
        json: { language: "en", content: await f.text() },
      });
      setMsg(`Transcript loaded (${r.cues} lines).`);
    });

  return (
    <div className="stack">
      <p className="muted">AI features read the transcript. Upload subtitles (.srt/.vtt) as the transcript, then try these. Without an API key they use built-in extractive summaries.</p>
      {isHost && (
        <label className="field">
          <span>
            <FileText size={13} style={{ verticalAlign: -2 }} /> Transcript
          </span>
          <input type="file" accept=".srt,.vtt" onChange={(e) => e.target.files?.[0] && void uploadTranscript(e.target.files[0])} />
        </label>
      )}

      <button
        onClick={() =>
          run(async () => setRecap(await api<Recap>(`/api/rooms/${room.code}/catchup?at=${usePlayback.getState().position}`, { headers })))
        }
      >
        <History size={16} /> Catch me up (spoiler-safe, up to now)
      </button>
      {recap && (
        <div className="card inner">
          <div className="muted">Recap ({recap.source})</div>
          {recap.bullets.length ? <ul>{recap.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : <em>{recap.note ?? "Nothing yet."}</em>}
        </div>
      )}

      <button onClick={() => run(async () => setNotes(await api<Notes>(`/api/rooms/${room.code}/notes`, { headers })))}>
        <NotebookPen size={16} /> Lecture notes
      </button>
      {notes && (
        <div className="card inner">
          <div className="muted">Notes ({notes.source})</div>
          <p>{notes.summary}</p>
          <ul className="plain">
            {notes.points.map((p, i) => (
              <li key={i}>
                <button className="link" onClick={() => isHost && socket.send("timeline:set", { action: "seek", to: p.t })}>
                  {fmt(p.t)}
                </button>{" "}
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isHost && (
        <div className="stack">
          <h3>Quiz breaks</h3>
          <div className="row">
            <input type="number" min={1} max={15} value={count} style={{ width: 70 }} onChange={(e) => setCount(+e.target.value)} />
            <button
              onClick={() =>
                run(async () => {
                  await api(`/api/rooms/${room.code}/study/prepare`, { method: "POST", headers, json: { count } });
                })
              }
            >
              Generate from transcript
            </button>
            <button onClick={() => socket.send("study:skip")}>Skip current quiz</button>
          </div>
        </div>
      )}
      {plan.length > 0 && (
        <ul className="plain">
          {plan.map((q) => (
            <li key={q.id} className={q.fired ? "muted" : ""}>
              {q.fired ? (
                <CircleCheck size={14} className="inline-icon" role="img" aria-label="Asked" />
              ) : (
                <Clock size={14} className="inline-icon" role="img" aria-label="Scheduled" />
              )}{" "}
              {fmt(q.at)} — {q.question.slice(0, 60)}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

export const aiPanel: Panel = { id: "ai", title: "AI", icon: Sparkles, group: "tools", description: "Spoiler-safe catch-up, lecture notes and quiz breaks from the transcript.", component: AiPanel, useSetup: useAiSetup };
