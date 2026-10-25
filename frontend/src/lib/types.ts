export type Mode = "movie" | "study" | "sports" | "hangout";

export interface Timeline {
  state: "playing" | "paused";
  anchorServerMs: number;
  anchorMediaS: number;
  rate: number;
  version: number;
  note?: string | null;
}

export type MediaKind = "youtube" | "html5" | "hls" | "external";

export interface Media {
  id: string;
  kind: MediaKind;
  url: string;
  title: string;
  live?: boolean;
}

export interface Member {
  id: string;
  name: string;
  language: string;
  isHost: boolean;
  householdId: string | null;
}

export interface RoomSettings {
  membersCanControl: boolean;
  spoilerSafe: boolean;
  stretchLock: boolean;
  seatedOnly: boolean;
  playfulTransforms: boolean;
  audioFirst: boolean;
}

export interface RoomSnapshot {
  code: string;
  name: string;
  mode: Mode;
  hostId: string;
  members: Member[];
  media: Media | null;
  settings: RoomSettings;
  timeline: Timeline;
  serverNowMs: number;
  you: Member;
  device: "screen" | "companion";
}

export interface Session {
  code: string;
  member_id: string;
  token: string;
  /** Display name, remembered so "Rejoin" can prefill it. */
  name?: string;
}
