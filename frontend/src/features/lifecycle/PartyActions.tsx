import { LogOut, Power } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Modal } from "../../components/ui";
import { api, clearSession, errorText, loadSession } from "../../lib/api";
import { useRoom } from "../../lib/room-context";
import "./lifecycle.css";

/** Codes this browser ended itself, so the ended screen can say "You ended the party". */
export const endedByMe = new Set<string>();

/** Top-bar Leave (everyone) and End party (host) buttons with their confirmations. */
export function PartyActions() {
  const { room, me, members, online, isHost, socket } = useRoom();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<"leave" | "end" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = loadSession(room.code)?.token ?? "";
  const others = members.filter((m) => m.id !== me.id);
  // same rule as the server: the longest-present member, preferring people who are here right now
  const nextHost = others.find((m) => online.has(m.id)) ?? others[0];

  const leave = async () => {
    setBusy(true);
    socket.close(); // stop reconnecting before the server drops our membership
    await api(`/api/rooms/${room.code}/leave`, { method: "POST", headers: { "x-member-token": token }, keepalive: true }).catch(() => {
      /* already gone, or offline: the seat frees itself after a few minutes */
    });
    clearSession(room.code);
    nav("/");
  };

  const end = async () => {
    setBusy(true);
    setError("");
    endedByMe.add(room.code);
    try {
      await api(`/api/rooms/${room.code}/end`, { method: "POST", headers: { "x-member-token": token } });
      // the server's room:ended message swaps this screen for the ended screen
    } catch (e) {
      endedByMe.delete(room.code);
      setError(errorText(e));
      setBusy(false);
    }
  };

  const close = () => !busy && setDialog(null);

  return (
    <>
      <button
        className="ghost party-leave"
        title="Leave this party"
        aria-label="Leave party"
        onClick={() => (isHost && others.length ? setDialog("leave") : void leave())}
        disabled={busy}
      >
        <LogOut size={16} />
        <span className="hide-sm">Leave</span>
      </button>
      {isHost && (
        <button className="ghost danger party-end" title="End the party for everyone" aria-label="End party" onClick={() => setDialog("end")}>
          <Power size={16} />
          <span className="hide-sm">End</span>
        </button>
      )}

      {dialog === "end" && (
        <Modal title="End this party for everyone?" icon={<Power size={20} />} onClose={close}>
          <p className="muted">Everyone will be removed and the invite will stop working. Chat, polls and reactions are cleared.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="party-dialog-actions">
            <button onClick={close} disabled={busy}>
              Cancel
            </button>
            <button className="primary" onClick={() => void end()} disabled={busy}>
              {busy && <span className="spinner sm" />}
              End party
            </button>
          </div>
        </Modal>
      )}

      {dialog === "leave" && (
        <Modal title="Leave the party?" icon={<LogOut size={20} />} onClose={close}>
          <p className="muted">
            The party keeps going without you{nextHost ? <> and <strong>{nextHost.name}</strong> becomes the host</> : null}. To close it for
            everyone instead, end the party.
          </p>
          <div className="party-dialog-actions">
            <button className="ghost danger" onClick={() => setDialog("end")} disabled={busy}>
              <Power size={15} /> End for everyone
            </button>
            <span className="spacer" />
            <button onClick={close} disabled={busy}>
              Stay
            </button>
            <button className="primary" onClick={() => void leave()} disabled={busy}>
              {busy && <span className="spinner sm" />}
              Leave
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
