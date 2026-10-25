export type MediaKind = "camera" | "mic" | "both";

/** Friendly, actionable copy for getUserMedia failures. */
export function mediaErrorMessage(e: unknown, kind: MediaKind = "camera"): string {
  const what = kind === "mic" ? "microphone" : kind === "camera" ? "camera" : "camera or microphone";
  switch ((e as { name?: string } | null)?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return `Access to your ${what} was blocked. Allow it in your browser’s site settings (the icon left of the address bar), then try again.`;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return `No ${what} was found. Connect one, then try again.`;
    case "NotReadableError":
    case "AbortError":
      return `Your ${what} couldn’t start. Another app (like Zoom or Teams) may be using it. Close that app, then try again.`;
    case "OverconstrainedError":
      return `That ${what} isn’t available right now. Pick another one, then try again.`;
    case "InsecureContext":
      return `Your browser only allows ${what} access over a secure (https) connection.`;
    case "Unsupported":
      return `This browser doesn’t support ${what} access. Try a recent Chrome, Edge, Firefox or Safari.`;
    default:
      return `Couldn’t start your ${what}. Try again, or restart your browser.`;
  }
}

const DEVICE_ERRORS = new Set(["NotAllowedError", "SecurityError", "NotFoundError", "DevicesNotFoundError", "NotReadableError", "AbortError", "OverconstrainedError"]);

/** Friendly copy for joining or using a voice/video call: server setup, session, network and device failures. */
export function callErrorMessage(e: unknown, kind: MediaKind = "both"): string {
  const err = e as { name?: string; status?: number } | null;
  switch (err?.status) {
    case 503:
      return "Voice and video aren’t set up on this server yet. You can keep watching and chatting.";
    case 501:
      return "Voice and video aren’t available on this server. You can keep watching and chatting.";
    case 401:
    case 410:
      return "Your room session ended. Reload the page to rejoin the room, then try the call again.";
    case 429:
      return "Too many tries in a row. Wait a moment, then join the call again.";
  }
  if (err?.name && DEVICE_ERRORS.has(err.name)) return mediaErrorMessage(e, kind);
  return "Couldn’t connect to the call. Check your connection, then try again.";
}
