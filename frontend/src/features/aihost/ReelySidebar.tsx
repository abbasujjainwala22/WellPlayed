import { MessageSquare, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import type { ConvoSummary } from "./general-api";

export interface ConvoList {
  items: ConvoSummary[];
  more: boolean;
  loading: boolean;
  error: string;
}

export function ReelySidebar({
  list,
  current,
  onSelect,
  onNew,
  onDelete,
  onMore,
  onRetry,
  disabled,
}: {
  list: ConvoList;
  current: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (c: ConvoSummary) => void;
  onMore: () => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <aside className="reely-side" aria-label="Your Reely chats">
      <button type="button" className="primary sm reely-side-new" onClick={onNew} disabled={disabled}>
        <Plus size={15} /> New chat
      </button>
      <span className="reely-poll-kicker">Saved on this device</span>
      <ul className="reely-side-list">
        {list.items.map((c) => (
          <li key={c.id} className={c.id === current ? "on" : ""}>
            <button type="button" className="reely-side-item" aria-current={c.id === current ? "true" : undefined} onClick={() => onSelect(c.id)} disabled={disabled}>
              <MessageSquare size={14} aria-hidden="true" />
              <span>{c.title}</span>
            </button>
            <button type="button" className="ghost icon sm" aria-label={`Delete “${c.title}”`} onClick={() => onDelete(c)} disabled={disabled}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      {list.loading && <p className="faint">Loading chats…</p>}
      {list.error && (
        <p className="reely-side-error" role="alert">
          Chats couldn’t load.{" "}
          <button type="button" className="link" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {!list.loading && !list.error && list.items.length === 0 && <p className="faint">Your first message starts a saved chat.</p>}
      {list.more && !list.loading && (
        <button type="button" className="link reely-side-more" onClick={onMore}>
          Load older chats
        </button>
      )}
      <div className="reely-side-foot">
        <p>
          <ShieldCheck size={14} aria-hidden="true" /> Chats here are private to this browser. Inside a party, open Reely in the room sidebar for room-aware chat.
        </p>
        <Link to="/settings#reely">Reely preferences</Link>
      </div>
    </aside>
  );
}
