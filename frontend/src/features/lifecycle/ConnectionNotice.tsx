import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { FullscreenState } from "../../components/ui";
import { useRoom, type ConnStatus, type RoomConnection } from "../../lib/room-context";
import "./connection.css";

/** Brief blips are covered by the "Reconnecting…" chip in the top bar; the notice waits this long before showing. */
const RECONNECTING_GRACE_MS = 3000;

const COPY: Record<Exclude<ConnStatus, "live" | "connecting">, { text: string; action: string }> = {
  reconnecting: { text: "Lost touch with the room. Reconnecting…", action: "Retry now" },
  offline: { text: "You’re offline. We’ll reconnect as soon as your network is back.", action: "Try again" },
  failed: { text: "We couldn’t reconnect to the room. Your seat is saved for a few minutes.", action: "Reconnect" },
};

/** Floating notice under the top bar while the room connection is down, with a Retry button. */
export function ConnectionNotice() {
  const { status, retry } = useRoom();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status !== "reconnecting") return setShow(status === "offline" || status === "failed");
    const t = window.setTimeout(() => setShow(true), RECONNECTING_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [status]);
  if (!show || status === "live" || status === "connecting") return null;
  const copy = COPY[status];
  const Icon = status === "offline" ? WifiOff : CloudOff;
  return (
    <div className={`banner conn-notice ${status === "failed" ? "danger" : "warn"}`} role="alert">
      <Icon size={17} />
      <span className="grow">{copy.text}</span>
      <button className={status === "failed" ? "primary sm" : "ghost sm"} onClick={retry}>
        <RefreshCw size={14} /> {copy.action}
      </button>
    </div>
  );
}

/** Short label for the top-bar connection chip. */
export function connLabel(status: ConnStatus): string {
  return { live: "Live", connecting: "Connecting…", reconnecting: "Reconnecting…", offline: "Offline", failed: "Disconnected" }[status];
}

/** The room's loading screen, with a way out when connecting takes too long or has given up. */
export function RoomLoading({ status, retry }: RoomConnection) {
  const nav = useNavigate();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  const failed = status === "failed";
  const offline = status === "offline";
  const title = failed ? "We couldn’t reach the room" : offline ? "You’re offline" : "Connecting to the room…";
  return (
    <FullscreenState
      title={title}
      icon={
        failed || offline ? (
          <div className="state-icon">{offline ? <WifiOff size={26} /> : <CloudOff size={26} />}</div>
        ) : undefined
      }
    >
      <p className="muted">
        {failed
          ? "The connection kept dropping. Check your network, then try again."
          : offline
            ? "We’ll connect as soon as your network is back."
            : status === "reconnecting"
              ? "Still trying. This usually only takes a moment."
              : "Syncing clocks and catching up on what everyone’s watching."}
      </p>
      {(failed || offline || slow || status === "reconnecting") && (
        <div className="row center-row">
          <button className={failed ? "primary" : "ghost"} onClick={retry}>
            <RefreshCw size={15} /> Retry
          </button>
          <button className="ghost" onClick={() => nav("/")}>
            Back to home
          </button>
        </div>
      )}
    </FullscreenState>
  );
}
