/** Client for the room-free Reely chat on /ai. Conversations are private to this device (no accounts). */
import { api } from "../../lib/api";
import { deviceId } from "../discover/recs-api";
import type { ReelyMessage } from "./ReelyChat";

export interface ConvoSummary {
  id: string;
  title: string;
  updated: number;
  count: number;
}

const headers = () => ({ "X-Device-Id": deviceId() });

export const generalReely = {
  list: (offset = 0) =>
    api<{ items: ConvoSummary[]; more: boolean; llm: boolean }>(`/api/reely/conversations?offset=${offset}`, { headers: headers() }),
  get: (id: string) =>
    api<{ conversation: ConvoSummary; messages: ReelyMessage[]; llm: boolean }>(`/api/reely/conversations/${encodeURIComponent(id)}`, {
      headers: headers(),
    }),
  remove: (id: string) => api<{ ok: boolean }>(`/api/reely/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }),
  chat: (body: { conversationId: string | null; text: string; vibe: string; spoilerSafe: boolean; kind: "chat" | "commentary" }) =>
    api<{ conversation: ConvoSummary; messages: ReelyMessage[]; llm: boolean }>("/api/reely/chat", {
      method: "POST",
      headers: headers(),
      json: body,
    }),
};

const CURRENT_KEY = "wp:reely:current";

export function savedConversation(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function rememberConversation(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage unavailable */
  }
}
