import { Crown, Users } from "lucide-react";

import { Avatar } from "../../components/ui";
import { LANGUAGES } from "../../lib/api";
import { useRoom } from "../../lib/room-context";
import { EMOJI } from "../../lib/wellbeing/signals";
import { useWellbeing } from "../wellbeing/WellbeingPanel";
import type { Panel } from "../panels";

const STATE_LABEL: Record<string, string> = {
  shrimp: "Slouching",
  fish: "Forgot to blink",
  potato: "Sitting too long",
  animal: "Distracted",
};

function PeoplePanel() {
  const { members, online, isHost, socket, settings, me } = useRoom();
  const well = useWellbeing((s) => s.members);
  const sorted = [...members].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || Number(b.isHost) - Number(a.isHost));
  const here = members.filter((m) => online.has(m.id)).length;
  return (
    <div className="stack">
      <h3>
        {here} watching · {members.length} joined
      </h3>
      <div className="people">
        {sorted.map((m) => {
          const state = settings.playfulTransforms ? well[m.id]?.state : undefined;
          const transformed = state && state !== "normal";
          return (
            <div key={m.id} className="person">
              <Avatar id={m.id} name={m.name} size={36} online={online.has(m.id)} emoji={transformed ? EMOJI[state] : undefined} emojiTitle={state} />
              <div className="who">
                <strong>
                  <span className="truncate">{m.name}</span>
                  {m.id === me.id && <span className="tag">You</span>}
                  {m.isHost && (
                    <span className="host-badge" title="Host">
                      <Crown size={14} />
                    </span>
                  )}
                </strong>
                <span className="faint">
                  {LANGUAGES[m.language] ?? m.language}
                  {transformed ? ` · ${EMOJI[state]} ${STATE_LABEL[state] ?? state}` : ""}
                  {!online.has(m.id) ? " · away" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {isHost && (
        <>
          <div className="divider" />
          <label className="check">
            <input
              type="checkbox"
              checked={settings.membersCanControl}
              onChange={(e) => socket.send("settings:set", { membersCanControl: e.target.checked })}
            />
            Everyone can control playback
          </label>
        </>
      )}
    </div>
  );
}

export const peoplePanel: Panel = {
  id: "people",
  title: "People",
  icon: Users,
  description: "Who’s here, their language and how they’re holding up.",
  component: PeoplePanel,
};
