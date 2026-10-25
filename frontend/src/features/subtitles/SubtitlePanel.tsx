import { Captions } from "lucide-react";
import { useEffect, useState } from "react";

import { api, LANGUAGES, loadSession } from "../../lib/api";
import { usePrefs } from "../../lib/prefs";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";
import { type Cue, useCues } from "./SubtitleOverlay";

function useSubtitleSetup() {
  const { room, me, socket } = useRoom();
  const lang = usePrefs((s) => s.subtitleLang);
  const [version, setVersion] = useState(0);
  const token = loadSession(room.code)?.token ?? "";
  useEffect(() => socket.on("subtitles:updated", () => setVersion((v) => v + 1)), [socket]);
  useEffect(() => {
    const target = lang === "auto" ? me.language : lang;
    if (lang === "off") return useCues.getState().set([]);
    api<{ source: string | null }>(`/api/rooms/${room.code}/subtitles?token=${token}`)
      .then((a) => (a.source ? api<{ cues: Cue[] }>(`/api/rooms/${room.code}/subtitles/${target}?token=${token}`) : { cues: [] as Cue[] }))
      .then((d) => useCues.getState().set(d.cues))
      .catch((e) => useCues.getState().set([], e.message));
  }, [room.code, token, lang, me.language, version]);
}

function SubtitlePanel() {
  const { room, isHost, canControl, me } = useRoom();
  const { subtitleLang, subtitleSize, set } = usePrefs();
  const error = useCues((s) => s.error);
  const [srcLang, setSrcLang] = useState(me.language);
  const [msg, setMsg] = useState("");
  const token = loadSession(room.code)?.token ?? "";

  const upload = async (file: File) => {
    try {
      const content = await file.text();
      const r = await api<{ cues: number }>(`/api/rooms/${room.code}/subtitles`, {
        method: "POST",
        headers: { "x-member-token": token },
        json: { language: srcLang, content },
      });
      setMsg(`Loaded ${r.cues} cues`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="stack">
      <label>
        My subtitles
        <select value={subtitleLang} onChange={(e) => set({ subtitleLang: e.target.value })}>
          <option value="auto">My language ({LANGUAGES[me.language]})</option>
          <option value="off">Off</option>
          {Object.entries(LANGUAGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Size {subtitleSize}px
        <input type="range" min={12} max={40} value={subtitleSize} onChange={(e) => set({ subtitleSize: +e.target.value })} />
      </label>
      {error && <p className="muted">{error}</p>}
      {(isHost || canControl) && (
        <div>
          <h3>Upload subtitles (.srt / .vtt)</h3>
          <div className="row">
            <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)}>
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input type="file" accept=".srt,.vtt" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </div>
          {msg && <p className="muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export const subtitlesPanel: Panel = {
  id: "subs",
  title: "Subtitles",
  icon: Captions,
  group: "tools",
  description: "Pick your own subtitle language and size. Others keep theirs.",
  component: SubtitlePanel,
  useSetup: useSubtitleSetup,
};
