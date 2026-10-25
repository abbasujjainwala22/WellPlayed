import { AlertCircle, Check, Copy, Info, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";

import { copyText } from "../lib/clipboard";

/* ───────── Avatars ───────── */

const PALETTE = ["#d1495b", "#8b7bff", "#2fc987", "#f2a93b", "#38bdf8", "#f472b6", "#a3e635", "#fb923c"];

export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({
  name,
  id,
  size = 32,
  online,
  emoji,
  emojiTitle,
}: {
  name: string;
  id?: string;
  size?: number;
  online?: boolean;
  emoji?: string;
  emojiTitle?: string;
}) {
  return (
    <span className="avatar" style={{ ["--size" as string]: `${size}px`, background: colorFor(id ?? name) }} title={name}>
      {initials(name)}
      {online !== undefined && <span className={`presence ${online ? "on" : ""}`} />}
      {emoji && (
        <span className="badge-emoji" title={emojiTitle}>
          {emoji}
        </span>
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
}: {
  people: { id: string; name: string; emoji?: string; emojiTitle?: string }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} id={p.id} name={p.name} size={30} emoji={p.emoji} emojiTitle={p.emojiTitle} />
      ))}
      {rest > 0 && <span className="avatar more">+{rest}</span>}
    </span>
  );
}

/* ───────── Toasts ───────── */

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));

export function toast(text: string, kind: ToastKind = "success"): void {
  const id = Date.now() + Math.random();
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, kind, text }] }));
  window.setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), 3200);
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "success" ? <Check size={16} /> : t.kind === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ───────── Modal ───────── */

export function Modal({
  title,
  description,
  icon,
  onClose,
  children,
  width,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          {icon && <div className="state-icon brand" style={{ width: 40, height: 40, borderRadius: 12 }}>{icon}</div>}
          <div className="grow">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="ghost icon sm" aria-label="Dismiss" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ───────── Misc ───────── */

export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!(await copyText(value))) return toast("Couldn’t copy. Select the text and copy it yourself.", "error");
    setDone(true);
    toast(`${label} copied`);
    window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <div className="copy-field">
      <code className={className}>{value}</code>
      <button className="sm" onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
        {done ? <Check size={14} /> : <Copy size={14} />}
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function FullscreenState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="fullscreen-state">
      <div className="stack">
        {icon ?? <div className="spinner" />}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading({ label = "Connecting to the room…" }: { label?: string }) {
  return (
    <FullscreenState title={label}>
      <p className="muted">Syncing clocks and catching up on what everyone’s watching.</p>
    </FullscreenState>
  );
}
