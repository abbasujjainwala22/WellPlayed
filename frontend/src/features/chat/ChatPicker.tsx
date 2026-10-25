import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { EmojiPicker } from "./EmojiPicker";
import { GiphyPicker } from "./GiphyPicker";
import type { GiphyItem } from "./giphy";

export type PickerTab = "emoji" | "gif" | "sticker";

const LABELS: Record<PickerTab, string> = { emoji: "Emoji", gif: "GIFs", sticker: "Stickers" };

/** The composer's pop-up: Emoji / GIFs / Stickers. Escape or a click outside closes it. */
export function ChatPicker({
  tab,
  onTab,
  gifs,
  onEmoji,
  onMedia,
  onClose,
}: {
  tab: PickerTab;
  onTab: (t: PickerTab) => void;
  /** GIPHY is configured on the server; otherwise only the emoji tab exists. */
  gifs: boolean;
  onEmoji: (emoji: string) => void;
  onMedia: (item: GiphyItem) => void;
  /** `refocus`: hand focus back to the message box (Escape, close button), not after a click elsewhere. */
  onClose: (refocus: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tabs: PickerTab[] = gifs ? ["emoji", "gif", "sticker"] : ["emoji"];
  const current = tabs.includes(tab) ? tab : "emoji";

  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>(".picker-body input")?.focus();
  }, [current]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      // the composer's own launcher buttons toggle the picker themselves
      if (!box.current?.contains(t) && !(t instanceof Element && t.closest("[data-picker-launcher]"))) onClose(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose(true);
    }
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onTab(n);
    box.current?.querySelector<HTMLButtonElement>(`#chat-picker-tab-${n}`)?.focus();
  };

  return (
    <div ref={box} className="chat-picker" role="dialog" aria-label={gifs ? "Emoji, GIFs and stickers" : "Emoji"} onKeyDown={onKey}>
      <div className="chat-picker-head">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label="Picker type" className="chat-picker-tabs">
            {tabs.map((t, i) => (
              <button
                key={t}
                id={`chat-picker-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={current === t}
                aria-controls="chat-picker-panel"
                tabIndex={current === t ? 0 : -1}
                className={current === t ? "on" : ""}
                onClick={() => onTab(t)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {LABELS[t]}
              </button>
            ))}
          </div>
        ) : (
          <strong className="chat-picker-title">Emoji</strong>
        )}
        <button type="button" className="ghost icon sm" aria-label="Close picker" onClick={() => onClose(true)}>
          <X size={16} />
        </button>
      </div>
      <div
        id="chat-picker-panel"
        className="picker-body"
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `chat-picker-tab-${current}` : undefined}
      >
        {current === "emoji" ? <EmojiPicker onPick={onEmoji} /> : <GiphyPicker key={current} kind={current} onSend={onMedia} />}
      </div>
    </div>
  );
}
