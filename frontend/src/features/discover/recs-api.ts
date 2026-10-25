import { api } from "../../lib/api";

export interface Rec {
  id: string;
  title: string;
  kind: "movie" | "series";
  genre: string;
  year: number | null;
  description: string;
  poster_url: string;
  poll_question: string;
  poll_options: string[];
  counts: number[];
  submitted_by_name: string;
  created_at: string;
  mine: boolean;
  myVote: number | null;
}

export interface NewRec {
  title: string;
  kind: "movie" | "series";
  genre: string;
  year: string;
  description: string;
  poster_url: string;
  poll_question: string;
  poll_options: string[];
  name: string;
}

const DEVICE_KEY = "wp:device";
let memoryDevice = "";

/** A random id for this browser. There are no accounts, so this is what "my vote" and "my rec" mean. */
export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,128}$/.test(saved)) return saved;
  } catch {
    /* storage unavailable: fall back to an id for this tab only */
  }
  if (!memoryDevice) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    memoryDevice = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  try {
    localStorage.setItem(DEVICE_KEY, memoryDevice);
  } catch {
    /* storage unavailable */
  }
  return memoryDevice;
}

const headers = () => ({ "X-Device-Id": deviceId() });

export const recsApi = {
  list: () => api<{ recs: Rec[]; demo: boolean }>("/api/recs", { headers: headers() }),
  create: (rec: NewRec) => api<Rec>("/api/recs", { method: "POST", headers: headers(), json: rec }),
  vote: (id: string, option: number) =>
    api<Rec>(`/api/recs/${encodeURIComponent(id)}/vote`, { method: "POST", headers: headers(), json: { option } }),
  remove: (id: string) => api<{ ok: boolean }>(`/api/recs/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }),
};
