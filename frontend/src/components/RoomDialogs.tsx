import { Settings2, UserPlus } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { useRoom } from "../lib/room-context";
import type { RoomSettings } from "../lib/types";
import { CopyField, Modal } from "./ui";

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const { room } = useRoom();
  const link = `${location.origin}/join/${room.code}`;
  return (
    <Modal title="Invite people" description="Anyone with the link or code can join. No account needed." icon={<UserPlus size={20} />} onClose={onClose}>
      <CopyField label="Invite link" value={link} />
      <div className="qr-wrap">
        <div className="qr">
          <QRCodeSVG value={link} size={128} bgColor="#ffffff" fgColor="#151d2b" />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Or enter this code on the home page</span>
          <span className="big-code">{room.code}</span>
          <span className="muted">Each person plays from their own source. WellPlayed only syncs the playback.</span>
        </div>
      </div>
    </Modal>
  );
}

type Key = keyof RoomSettings;
const GROUPS: { title: string; items: { key: Key; label: string; hint: string; modes?: string[] }[] }[] = [
  {
    title: "Playback",
    items: [
      { key: "membersCanControl", label: "Everyone can control playback", hint: "Otherwise only you can play, pause and seek." },
      { key: "spoilerSafe", label: "Spoiler-safe live sync", hint: "Hold back chat and cheers until each viewer reaches that moment.", modes: ["sports"] },
      { key: "audioFirst", label: "Audio-first", hint: "Shrink the video so the conversation stays front and centre.", modes: ["hangout"] },
    ],
  },
  {
    title: "Healthy watching",
    items: [
      { key: "stretchLock", label: "Stretch before the next episode", hint: "The next episode starts once everyone completes a 30-second stretch." },
      { key: "seatedOnly", label: "Seated stretch routine", hint: "An inclusive routine that works for every level of mobility." },
      { key: "playfulTransforms", label: "Playful transformations", hint: "Show 🦐 🐟 🥔 next to people who slouch, stare or sit too long." },
    ],
  },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { room, settings, socket } = useRoom();
  return (
    <Modal title="Room settings" description="Changes apply to everyone in the room straight away." icon={<Settings2 size={20} />} onClose={onClose}>
      {GROUPS.map((g) => (
        <div key={g.title} className="settings-group">
          <h3 style={{ margin: 0 }}>{g.title}</h3>
          {g.items
            .filter((i) => !i.modes || i.modes.includes(room.mode))
            .map((i) => (
              <label key={i.key} className="setting check">
                <span className="txt">
                  <strong>{i.label}</strong>
                  <span>{i.hint}</span>
                </span>
                <input type="checkbox" checked={settings[i.key]} onChange={(e) => socket.send("settings:set", { [i.key]: e.target.checked })} />
              </label>
            ))}
        </div>
      ))}
    </Modal>
  );
}
