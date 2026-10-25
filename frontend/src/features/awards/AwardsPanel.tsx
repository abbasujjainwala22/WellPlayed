import { Award as AwardIcon, Check, Clapperboard, Lock, Medal, PartyPopper, Popcorn, RotateCcw, Sparkles, Star, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { Avatar } from "../../components/ui";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";
import { PartyCelebration } from "../personality";
import "./awards.css";
import { AwardsSummary, ReviewBlock } from "./AwardsSummary";
import { saveAwards, type Award, type AwardsResult } from "./history";

interface Category {
  id: string;
  emoji: string;
  name: string;
  blurb: string;
}

export interface AwardsView {
  phase: "idle" | "voting" | "revealed";
  presets: Category[];
  categories: Category[];
  myVotes: Record<string, string>;
  ballots: Record<string, number>;
  myReview: { stars: number; take: string } | null;
  reviewCount: number;
  preview: Award[];
  result: AwardsResult | null;
}

const TAKE_LEN = 140;
const MAX_CATEGORIES = 3;

export const useAwards = create<{ view: AwardsView | null; celebrate: boolean }>(() => ({ view: null, celebrate: false }));

function useAwardsSetup() {
  const { socket, room } = useRoom();
  useEffect(
    () =>
      socket.on("awards:state", (view: AwardsView) => {
        const prev = useAwards.getState().view;
        const justRevealed = !!view.result && !!prev && prev.phase !== "revealed";
        useAwards.setState({ view, celebrate: justRevealed || useAwards.getState().celebrate });
        if (view.result) saveAwards(room, view.result); // this device's Hall of Fame
      }),
    [socket, room],
  );
}

function FrontRunners({ preview }: { preview: Award[] }) {
  if (preview.length === 0)
    return (
      <p className="faint">
        No front-runners yet. Awards come from what really happens: reactions, chat, predictions, breaks and (if you opt in) wellbeing.
      </p>
    );
  return (
    <ul className="award-preview">
      {preview.map((a) => (
        <li key={a.id}>
          <span className="award-preview-emoji" aria-hidden="true">
            {a.emoji}
          </span>
          <span className="grow">
            <strong>{a.name}</strong>
            <span className="faint">
              {a.winners.map((w) => w.name).join(" & ")} · {a.stat}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CategoryPicker({ presets }: { presets: Category[] }) {
  const { socket } = useRoom();
  const [picked, setPicked] = useState<string[]>(() => presets.slice(0, 2).map((p) => p.id));
  const [custom, setCustom] = useState("");
  const total = picked.length + (custom.trim() ? 1 : 0);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length + (custom.trim() ? 1 : 0) < MAX_CATEGORIES ? [...p, id] : p));
  return (
    <div className="card inner">
      <strong>Pick 2–3 categories for the room to vote on</strong>
      <div className="award-cats">
        {presets.map((p) => (
          <button key={p.id} className={`award-cat ${picked.includes(p.id) ? "on" : ""}`} aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
            <span aria-hidden="true">{p.emoji}</span>
            <span className="grow">
              <strong>{p.name}</strong>
              <span className="faint">{p.blurb}</span>
            </span>
            {picked.includes(p.id) && <Check size={15} />}
          </button>
        ))}
      </div>
      <input
        placeholder="Or add your own award (optional)"
        maxLength={48}
        value={custom}
        disabled={!custom && picked.length >= MAX_CATEGORIES}
        onChange={(e) => setCustom(e.target.value)}
      />
      <button
        className="primary"
        disabled={total < 1 || total > MAX_CATEGORIES}
        onClick={() => socket.send("awards:open-voting", { categories: picked, custom: custom.trim() ? { name: custom.trim() } : null })}
      >
        <AwardIcon size={15} /> Open awards voting
      </button>
    </div>
  );
}

function Ballot({ cat, view }: { cat: Category; view: AwardsView }) {
  const { socket, members, me } = useRoom();
  const mine = view.myVotes[cat.id];
  const others = members.filter((m) => m.id !== me.id);
  return (
    <div className="card inner">
      <div className="row">
        <span className="award-preview-emoji" aria-hidden="true">
          {cat.emoji}
        </span>
        <span className="grow">
          <strong>{cat.name}</strong>
          <span className="faint award-sub">{cat.blurb}</span>
        </span>
        <span className="faint">{view.ballots[cat.id] ?? 0} voted</span>
      </div>
      {others.length === 0 ? (
        <p className="faint">Invite someone to vote for. You can’t vote for yourself.</p>
      ) : (
        <div className="award-nominees" role="group" aria-label={`Vote for ${cat.name}`}>
          {others.map((m) => (
            <button
              key={m.id}
              className={`award-nominee ${mine === m.id ? "on" : ""}`}
              disabled={!!mine}
              aria-pressed={mine === m.id}
              onClick={() => socket.send("awards:vote", { categoryId: cat.id, memberId: m.id })}
            >
              <Avatar id={m.id} name={m.name} size={22} />
              <span className="truncate">{m.name}</span>
              {mine === m.id && <Lock size={13} />}
            </button>
          ))}
        </div>
      )}
      {mine && <p className="faint">Vote locked in. It stays secret until the host reveals.</p>}
    </div>
  );
}

function ReviewForm({ view }: { view: AwardsView }) {
  const { socket } = useRoom();
  const [stars, setStars] = useState(view.myReview?.stars ?? 0);
  const [take, setTake] = useState(view.myReview?.take ?? "");
  const [hover, setHover] = useState(0);
  const saved = view.myReview && view.myReview.stars === stars && view.myReview.take === take.trim();
  return (
    <div className="card inner">
      <strong>How was it?</strong>
      <div className="award-rate" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            role="radio"
            aria-checked={stars === i}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            className={`ghost icon sm ${i <= (hover || stars) ? "on" : ""}`}
            onMouseEnter={() => setHover(i)}
            onClick={() => setStars(i)}
          >
            <Star size={20} />
          </button>
        ))}
      </div>
      <input placeholder="Your one-line take (optional)" maxLength={TAKE_LEN} value={take} onChange={(e) => setTake(e.target.value)} />
      <div className="row">
        <span className="faint">{TAKE_LEN - take.length} characters left</span>
        <button className="sm spacer" disabled={!stars || !!saved} onClick={() => socket.send("awards:review", { stars, take: take.trim() })}>
          {saved ? (
            <>
              <Check size={14} /> Saved
            </>
          ) : view.myReview ? (
            "Update review"
          ) : (
            "Save review"
          )}
        </button>
      </div>
      <p className="faint">
        {view.reviewCount} {view.reviewCount === 1 ? "review" : "reviews"} in. The average and everyone’s takes appear with the awards.
      </p>
    </div>
  );
}

function AwardsPanel() {
  const { socket, isHost, room } = useRoom();
  const view = useAwards((s) => s.view);
  const phase = view?.phase;

  useEffect(() => {
    if (phase === "revealed") return;
    socket.send("awards:sync"); // refresh the front-runners while the panel is open
    const t = window.setInterval(() => socket.send("awards:sync"), 15000);
    return () => window.clearInterval(t);
  }, [socket, phase]);

  if (!view) return <p className="faint">Loading awards…</p>;

  if (view.phase === "revealed" && view.result)
    return (
      <div className="stack">
        <PartyCelebration eventKey={`awards-${room.code}-${view.result.at}`}>The awards are in. Acceptance speeches go in the chat.</PartyCelebration>
        <AwardsSummary awards={view.result.awards} review={view.result.review} compact />
        <p className="faint">
          Saved to this device’s <a href="/hall-of-fame" target="_blank" rel="noreferrer">Hall of Fame</a>. Awards use names and emoji only;
          no camera images are ever stored.
        </p>
        {isHost && (
          <button onClick={() => socket.send("awards:reset")}>
            <RotateCcw size={15} /> Start a new awards round
          </button>
        )}
      </div>
    );

  return (
    <div className="stack">
      <h3>Front-runners so far</h3>
      <FrontRunners preview={view.preview} />

      <h3>Peer-voted awards</h3>
      {view.phase === "idle" &&
        (isHost ? (
          <CategoryPicker presets={view.presets} />
        ) : (
          <p className="faint">The host can open voting for fun awards like “The Plot-Twist Goblin”. You’ll vote for someone else, never yourself.</p>
        ))}
      {view.phase === "voting" && view.categories.map((c) => <Ballot key={c.id} cat={c} view={view} />)}

      <h3>Your review</h3>
      <ReviewForm view={view} />

      {isHost ? (
        <button className="primary lg" onClick={() => socket.send("awards:reveal")}>
          <Trophy size={17} /> Reveal awards
        </button>
      ) : (
        <p className="faint">The host reveals the awards, usually when the credits roll.</p>
      )}
      <p className="faint">Awards use names and emoji only. No camera images are ever stored.</p>
    </div>
  );
}

/** Full-screen celebration the moment the host reveals. Mounted once by the room page. */
const CONFETTI = [PartyPopper, Trophy, Sparkles, Popcorn, Star, Medal, Clapperboard, Sparkles, PartyPopper, Trophy, Star, Popcorn];
const CONFETTI_COLORS = ["var(--brand)", "var(--warning)", "var(--violet)", "var(--success)"];

export function AwardsReveal() {
  const { celebrate, view } = useAwards();
  const close = () => useAwards.setState({ celebrate: false });
  useEffect(() => {
    if (!celebrate) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [celebrate]);
  if (!celebrate || !view?.result) return null;
  const { awards, review } = view.result;
  return (
    <div className="award-reveal" role="dialog" aria-modal="true" aria-label="Awards revealed" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="award-confetti" aria-hidden="true">
        {CONFETTI.map((Icon, i) => (
          <span key={i} style={{ left: `${4 + i * 8}%`, animationDelay: `${(i % 4) * 0.35}s` }}>
            <Icon size={26} color={CONFETTI_COLORS[i % CONFETTI_COLORS.length]} />
          </span>
        ))}
      </div>
      <div className="award-reveal-inner">
        <p className="eyebrow">
          <PartyPopper size={14} /> Hall of Fame
        </p>
        <h1>And the awards go to…</h1>
        <AwardsSummary awards={awards} animate />
        <ReviewBlock review={review} />
        <button className="primary lg" onClick={close} autoFocus>
          Back to the party
        </button>
      </div>
    </div>
  );
}

export const awardsPanel: Panel = {
  id: "awards",
  title: "Awards",
  icon: Trophy,
  description: "End-of-party awards from what really happened, plus peer votes and a quick review.",
  component: AwardsPanel,
  useSetup: useAwardsSetup,
};
