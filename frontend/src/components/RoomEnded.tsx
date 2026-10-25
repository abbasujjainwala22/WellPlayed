import { DoorClosed } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { RoomGone } from "../lib/room-context";
import { FullscreenState } from "./ui";

type Ended = Extract<RoomGone, { kind: "ended" }>;

/** Copy for each way a party can end. */
export function endedCopy(gone?: Ended | null, isMe = false): { title: string; message: string } {
  switch (gone?.reason) {
    case "host":
      return isMe
        ? { title: "You ended the party", message: "Everyone has been removed and the invite link no longer works. Thanks for hosting!" }
        : {
            title: "This party has ended",
            message: `${gone.by ?? "The host"} ended the party for everyone. Thanks for watching together. Start a new party any time.`,
          };
    case "expired":
      return { title: "This party has ended", message: "It closed after a while with nobody watching. Start a new party and send everyone the fresh link." };
    case "empty":
      return { title: "This party has ended", message: "Everyone left, so the room closed. Start a new party any time." };
    case "unknown":
      return { title: "This party has ended", message: "The invite link no longer works. Start a new party and send everyone the fresh link." };
    default:
      return {
        title: "This room has ended",
        message: "Rooms close when the WellPlayed server restarts. Start a new one and send everyone the fresh invite link.",
      };
  }
}

/**
 * The room is gone: the host ended it, it expired, or the server restarted.
 * Pass `gone` for the matching copy, or override `title`/`message`. `children` render below the message
 * (for a summary of the party, for example).
 */
export function RoomEnded({
  gone,
  isMe,
  title,
  message,
  children,
}: {
  gone?: Ended | null;
  /** The viewer is the host who ended it. */
  isMe?: boolean;
  title?: string;
  message?: ReactNode;
  children?: ReactNode;
}) {
  const nav = useNavigate();
  const copy = endedCopy(gone, isMe);
  return (
    <FullscreenState
      icon={
        <div className="state-icon">
          <DoorClosed size={26} />
        </div>
      }
      title={title ?? copy.title}
    >
      <p className="muted">{message ?? copy.message}</p>
      {children}
      <button className="primary" onClick={() => nav("/")}>
        Start a new party
      </button>
    </FullscreenState>
  );
}
