import { UserX } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { FullscreenState } from "../../components/ui";
import "./lifecycle.css";

/** Our saved session stopped working (we left on another device, or the token is stale): offer a way back in. */
export function SessionLost({ code, name }: { code: string; name?: string }) {
  const nav = useNavigate();
  const rejoin = () => nav(`/join/${code}${name ? `?name=${encodeURIComponent(name)}` : ""}`);
  return (
    <FullscreenState
      icon={
        <div className="state-icon">
          <UserX size={26} />
        </div>
      }
      title="You’re no longer in this party"
    >
      <p className="muted">Your session for this room has expired or was closed. The party may still be going, so you can rejoin with the same name.</p>
      <div className="row center-row">
        <button className="primary" onClick={rejoin}>
          Rejoin{name ? ` as ${name}` : ""}
        </button>
        <button className="ghost" onClick={() => nav("/")}>
          Back to home
        </button>
      </div>
    </FullscreenState>
  );
}
