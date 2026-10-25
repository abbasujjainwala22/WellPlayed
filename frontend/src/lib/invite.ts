import { normalizeCode } from "./api";

/** Room codes are six letters and digits (the server avoids look-alikes such as 0/O and 1/I). */
export const CODE_LENGTH = 6;

/**
 * Turn whatever someone pasted into a room code, or null if it isn't one. Accepts a full invite link
 * (any host, /join/CODE, /room/CODE or /companion/CODE), a bare path, or a code typed in any case
 * with spaces or dashes ("abc 123", "ABC-123").
 */
export function parseInviteCode(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  let value = s;
  const path = /(?:^|\/)(?:join|room|companion)\/([^/?#\s]+)/i;
  if (/^https?:\/\//i.test(s) || /^[\w.-]+\.[a-z]{2,}(:\d+)?\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return null;
    }
    const m = url.pathname.match(path);
    if (!m) return null;
    try {
      value = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  } else {
    const m = s.match(path);
    if (m) value = m[1];
  }
  if (!/^[A-Za-z0-9\s-]+$/.test(value)) return null;
  const code = normalizeCode(value);
  return code.length === CODE_LENGTH ? code : null;
}
