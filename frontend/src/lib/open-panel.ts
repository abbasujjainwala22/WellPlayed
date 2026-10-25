/**
 * Lets any part of the room ask for a sidebar panel (and optionally a section inside it) without
 * threading callbacks through the tree. The room page listens with `onOpenPanel`.
 */
const EVENT = "wp:open-panel";

export interface OpenPanelRequest {
  id: string;
  /** A panel-specific sub-view, e.g. "swipe" in Movie night. */
  section?: string;
}

/** The last section asked for, so a panel that mounts because of the request can start there. */
const pending = new Map<string, string>();

export function openPanel(id: string, section?: string): void {
  if (section) pending.set(id, section);
  window.dispatchEvent(new CustomEvent<OpenPanelRequest>(EVENT, { detail: { id, section } }));
}

export function onOpenPanel(fn: (req: OpenPanelRequest) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<OpenPanelRequest>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** The section requested for a panel that is about to mount (read in its initial state). */
export function panelSection(id: string): string | undefined {
  return pending.get(id);
}

/** Forget a handled request (call from the panel's mount effect). */
export function clearPanelSection(id: string): void {
  pending.delete(id);
}
