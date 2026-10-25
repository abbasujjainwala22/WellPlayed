import { Puzzle, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import { CopyField, Modal } from "../../components/ui";
import { API_BASE, api, loadSession } from "../../lib/api";
import { useRoom } from "../../lib/room-context";

/** QR code that turns your phone into a remote: chat, react and vote, so the big screen stays clean. */
export function PairCard() {
  const { room } = useRoom();
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const token = loadSession(room.code)?.token ?? "";
      const r = await api<{ pair: string }>(`/api/rooms/${room.code}/pair`, { method: "POST", headers: { "x-member-token": token }, json: {} });
      setLink(`${location.origin}/companion/${room.code}?pair=${r.pair}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="ghost" onClick={() => void open()} disabled={busy} title={error || "Use your phone as a remote"}>
        <Smartphone size={16} />
        <span className="hide-sm">Pair phone</span>
      </button>
      {link && (
        <Modal
          title="Use your phone as a remote"
          description="Chat, react, vote and talk from your phone so the big screen stays clean."
          icon={<Smartphone size={20} />}
          onClose={() => setLink("")}
        >
          <div className="qr-wrap">
            <div className="qr">
              <QRCodeSVG value={link} size={150} bgColor="#ffffff" fgColor="#151d2b" />
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <strong>Scan with your phone’s camera</strong>
              <span className="muted">This one-time link signs your phone in as you. It expires after 10 minutes.</span>
              <code className="pairlink">{link}</code>
            </div>
          </div>
          <details>
            <summary>
              <Puzzle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Watching on your own streaming service? Use the browser extension
            </summary>
            <div className="stack" style={{ gap: 8 }}>
              <span className="muted">
                Load the <code>extension/</code> folder in Chrome (chrome://extensions → Developer mode → Load unpacked), open your service
                in a tab and paste these into the extension popup:
              </span>
              <CopyField label="Server" value={API_BASE || location.origin} />
              <CopyField label="Room code" value={room.code} />
              <CopyField label="Token" value={loadSession(room.code)?.token ?? ""} />
            </div>
          </details>
          <button className="block" onClick={() => setLink("")}>
            Close
          </button>
        </Modal>
      )}
    </>
  );
}
