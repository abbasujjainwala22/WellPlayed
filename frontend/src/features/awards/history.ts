import type { Mode } from "../../lib/types";

export interface Award {
  id: string;
  kind: "auto" | "peer";
  emoji: string;
  name: string;
  blurb: string;
  winners: { id?: string; name: string }[];
  stat: string;
}

export interface ReviewTake {
  name: string;
  stars: number;
  take: string;
}

export interface ReviewSummary {
  avg: number | null;
  count: number;
  takes?: ReviewTake[];
}

export interface AwardsResult {
  at: number;
  title?: string | null;
  awards: Award[];
  review: ReviewSummary;
}

/** What this device remembers about a past party. Names and emoji only, never camera images. */
export interface AwardsRecord {
  code: string;
  roomName: string;
  mode: Mode;
  at: number;
  title?: string | null;
  awards: Award[];
  review: { avg: number | null; count: number };
}

const KEY = "wp:awards";
const MAX = 20;

export function loadAwards(): AwardsRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? (list as AwardsRecord[]) : [];
  } catch {
    return [];
  }
}

export function awardsFor(code: string): AwardsRecord | undefined {
  return loadAwards().find((r) => r.code === code.toUpperCase());
}

export function saveAwards(room: { code: string; name: string; mode: Mode }, result: AwardsResult): void {
  const record: AwardsRecord = {
    code: room.code.toUpperCase(),
    roomName: room.name,
    mode: room.mode,
    at: result.at,
    title: result.title ?? null,
    awards: result.awards.map((a) => ({ ...a, winners: a.winners.map((w) => ({ name: w.name })) })),
    review: { avg: result.review.avg, count: result.review.count },
  };
  try {
    const rest = loadAwards().filter((r) => !(r.code === record.code && r.at === record.at));
    localStorage.setItem(KEY, JSON.stringify([record, ...rest].sort((a, b) => b.at - a.at).slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function clearAwards(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
