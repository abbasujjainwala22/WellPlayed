import { ExternalLink, Timer } from "lucide-react";

import { useRoom } from "../../lib/room-context";
import "./lifecycle.css";

/** Honest fallback: the provider plays on its own site; WellPlayed shares chat, reactions and a countdown. */
export function ExternalWatch({ provider, url, message, onUseExtension }: { provider: string; url: string; message: string; onUseExtension?: () => void }) {
  const { socket } = useRoom();
  return (
    <div className="external-watch" role="status">
      <strong>Not loaded into the shared player</strong>
      <p className="muted">
        {message} You can still watch on {provider} with chat and reactions here, but playback won’t stay in sync.
      </p>
      <div className="row">
        <a className="external-open" href={url} target="_blank" rel="noopener noreferrer">
          Open on {provider} (not synced) <ExternalLink size={13} />
        </a>
        <button type="button" className="sm" onClick={() => socket.send("countdown:start", { provider, url })}>
          <Timer size={14} /> Start a group countdown
        </button>
        {onUseExtension && (
          <button type="button" className="ghost sm" onClick={onUseExtension} title="Every viewer with the WellPlayed extension stays in sync">
            Use the household extension
          </button>
        )}
      </div>
    </div>
  );
}
