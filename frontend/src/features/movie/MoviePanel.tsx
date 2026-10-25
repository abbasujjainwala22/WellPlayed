import { CircleAlert, CircleCheck, CircleX, Clapperboard, CornerDownRight, Crosshair, Hand, House, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { api, loadSession } from "../../lib/api";
import { clearPanelSection, onOpenPanel, panelSection } from "../../lib/open-panel";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";
import { GroupVote, useRoundsSetup } from "../rounds/GroupVote";

interface Service {
  id: string;
  name: string;
  free: boolean;
  price: number;
}
interface Household {
  id: string;
  name: string;
  region: string;
  size: number;
  services: string[];
  members: string[];
}
interface Title {
  id: string;
  title: string;
  year: number;
  genres: string[];
  runtime: number;
  sample?: boolean;
}
interface PlanHousehold {
  householdId: string;
  name: string;
  region: string;
  size: number;
  covered: boolean;
  fixable: boolean;
  extraCost: number;
  options: { type: string; detail: string; cost: number }[];
}
interface Plan {
  households: PlanHousehold[];
  viewers: number;
  coverage: number;
  extraCost: number;
  subscriptionsNeeded: number;
  savingsPct: number;
}
interface Suggestion {
  title: Title;
  coverage: number;
  extraCost: number;
  likes: number;
  dislikes: number;
  votes: number;
  everyoneCovered: boolean;
}

const useMovie = create<{ households: Household[]; tick: number; bump: () => void; set: (h: Household[]) => void }>((set) => ({
  households: [],
  tick: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),
  set: (households) => set((s) => ({ households, tick: s.tick + 1 })),
}));

function useMovieSetup() {
  const { socket, room } = useRoom();
  useRoundsSetup(room.mode === "movie");
  useEffect(() => {
    const offs = [
      socket.on("household:state", (d) => useMovie.getState().set(d.households)),
      socket.on("swipe:progress", () => useMovie.getState().bump()),
    ];
    return () => offs.forEach((o) => o());
  }, [socket]);
}

const REGIONS = ["AU", "US", "GB", "CA", "DE", "IN"];

function HouseholdTab() {
  const { socket, me, room } = useRoom();
  const households = useMovie((s) => s.households);
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => api<Service[]>("/api/services") });
  const mine = households.find((h) => h.id === me.householdId);
  const [form, setForm] = useState({ name: "", region: navigator.language.slice(3, 5).toUpperCase() || "AU", size: 2, services: [] as string[] });
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mine && loadedFor.current !== mine.id) {
      loadedFor.current = mine.id;
      setForm({ name: mine.name, region: mine.region, size: mine.size, services: mine.services });
    }
  }, [mine]);
  const toggle = (id: string) =>
    setForm((f) => ({ ...f, services: f.services.includes(id) ? f.services.filter((s) => s !== id) : [...f.services, id] }));

  return (
    <div className="stack">
      <p className="muted">One screen per home: each household plays from its own accounts and WellPlayed keeps them in sync.</p>
      <input placeholder="Household name (e.g. Nan’s place)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <div className="row">
        <select value={REGIONS.includes(form.region) ? form.region : "AU"} onChange={(e) => setForm({ ...form, region: e.target.value })}>
          {REGIONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <label className="check">
          People
          <input type="number" min={1} max={30} style={{ width: 70 }} value={form.size} onChange={(e) => setForm({ ...form, size: +e.target.value })} />
        </label>
      </div>
      <div className="chips">
        {services.map((s) => (
          <button key={s.id} className={form.services.includes(s.id) ? "chip on" : "chip"} onClick={() => toggle(s.id)}>
            {s.name}
            {s.free ? " (free)" : ""}
          </button>
        ))}
      </div>
      <button className="primary" onClick={() => socket.send("household:upsert", { id: mine?.id, ...form })}>
        {mine ? "Save my household" : "Create my household"}
      </button>
      <h3>Households in {room.name}</h3>
      <ul className="plain">
        {households.map((h) => (
          <li key={h.id}>
            <strong>{h.name}</strong> · {h.region} · {h.size} people · {h.services.join(", ") || "no services"}
            <div className="muted">{h.members.join(", ")}</div>
            {h.id !== me.householdId && <button onClick={() => socket.send("household:join", { householdId: h.id })}>Join this home</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vote on titles the group suggests, or swipe through the built-in sample catalogue. */
function SwipeTab() {
  const [source, setSource] = useState<"ours" | "sample">("ours");
  return (
    <div>
      <nav className="tabs rounds-source" aria-label="What to swipe on">
        <button className={source === "ours" ? "active" : ""} aria-pressed={source === "ours"} onClick={() => setSource("ours")}>
          Our picks
        </button>
        <button className={source === "sample" ? "active" : ""} aria-pressed={source === "sample"} onClick={() => setSource("sample")}>
          Sample catalogue
        </button>
      </nav>
      {source === "ours" ? <GroupVote /> : <CatalogueSwipe />}
    </div>
  );
}

function CatalogueSwipe() {
  const { socket, room } = useRoom();
  const token = loadSession(room.code)?.token ?? "";
  const [deck, setDeck] = useState<Title[] | null>(null);
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    api<Title[]>(`/api/rooms/${room.code}/swipe-deck?token=${token}`).then(setDeck);
  }, [room.code, token]);
  const top = deck?.[0];
  const vote = (v: "like" | "dislike" | "super") => {
    if (!top) return;
    socket.send("swipe:vote", { titleId: top.id, vote: v });
    setDeck((d) => d!.slice(1));
    setDx(0);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") vote("like");
      if (e.key === "ArrowLeft") vote("dislike");
      if (e.key === "ArrowUp") vote("super");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!deck) return <p className="muted">Loading…</p>;
  if (!top) return <p className="muted">You’ve swiped everything. Check the “Plan” tab.</p>;
  return (
    <div className="swipe">
      <div
        className="swipecard"
        style={{ transform: `translateX(${dx}px) rotate(${dx / 20}deg)` }}
        onPointerDown={(e) => {
          start.current = e.clientX;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
        onPointerUp={() => {
          const d = dx;
          start.current = null;
          if (d > 90) vote("like");
          else if (d < -90) vote("dislike");
          else setDx(0);
        }}
      >
        <h2>{top.title}</h2>
        <div className="muted">
          {top.year} · {top.runtime} min · {top.genres.join(", ")}
        </div>
        {top.sample && <span className="tag">sample data</span>}
      </div>
      <div className="row center-row">
        <button onClick={() => vote("dislike")}>
          <ThumbsDown size={16} aria-hidden /> Nope
        </button>
        <button onClick={() => vote("super")}>
          <Star size={16} aria-hidden /> Love
        </button>
        <button className="primary" onClick={() => vote("like")}>
          <ThumbsUp size={16} aria-hidden /> Yes
        </button>
      </div>
      <p className="muted">Drag the card or use ← ↑ → keys. {deck.length} left.</p>
    </div>
  );
}

function PlanTab() {
  const { room, isHost, socket } = useRoom();
  const token = loadSession(room.code)?.token ?? "";
  const tick = useMovie((s) => s.tick);
  const [selected, setSelected] = useState<string | null>(null);
  const sugg = useQuery({
    queryKey: ["suggestions", room.code, tick],
    queryFn: () => api<Suggestion[]>(`/api/rooms/${room.code}/suggestions?token=${token}`),
  });
  const plan = useQuery({
    queryKey: ["plan", room.code, selected, tick],
    enabled: !!selected,
    queryFn: () => api<Plan>(`/api/rooms/${room.code}/plan?title=${selected}&token=${token}`),
  });
  return (
    <div className="stack">
      <h3>What can we all watch?</h3>
      {(sugg.data ?? []).map((s) => (
        <button key={s.title.id} className={`opt ${selected === s.title.id ? "mine" : ""}`} onClick={() => setSelected(s.title.id)}>
          <strong>{s.title.title}</strong> {s.title.sample && <span className="tag">sample</span>}
          <div className="muted">
            {Math.round(s.coverage * 100)}% of homes covered · extra ${s.extraCost.toFixed(2)}/mo · <ThumbsUp size={13} className="inline-icon" role="img" aria-label="Likes" /> {s.likes}{" "}
            <ThumbsDown size={13} className="inline-icon" role="img" aria-label="Dislikes" /> {s.dislikes}
          </div>
        </button>
      ))}
      {plan.data && selected && (
        <div className="card inner">
          <strong>
            {plan.data.viewers} people across {plan.data.households.length} homes need {plan.data.subscriptionsNeeded} subscriptions
            {plan.data.savingsPct > 0 && ` (${plan.data.savingsPct}% fewer)`}
          </strong>
          <div className="muted">Extra cost across the group: ${plan.data.extraCost.toFixed(2)}/mo</div>
          {plan.data.households.map((h) => (
            <div key={h.householdId}>
              <HomeStatus covered={h.covered} fixable={h.fixable} /> <strong>{h.name}</strong> ({h.region})
              {h.options.map((o, i) => (
                <div key={i} className="muted">
                  <CornerDownRight size={13} className="inline-icon" aria-hidden /> {o.detail} {o.cost > 0 && `(+$${o.cost.toFixed(2)})`}
                </div>
              ))}
              {!h.covered && h.options.length === 0 && (
                <div className="muted">
                  <CornerDownRight size={13} className="inline-icon" aria-hidden /> not available in this region
                </div>
              )}
            </div>
          ))}
          {isHost && (
            <button className="primary" onClick={() => socket.send("title:pick", { titleId: selected })}>
              Watch this together
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const TABS = {
  home: (
    <>
      <House size={14} aria-hidden /> Homes
    </>
  ),
  swipe: (
    <>
      <Hand size={14} aria-hidden /> Swipe
    </>
  ),
  plan: (
    <>
      <Crosshair size={14} aria-hidden /> Plan
    </>
  ),
};

function HomeStatus({ covered, fixable }: { covered: boolean; fixable: boolean }) {
  const props = { size: 14, className: "inline-icon", role: "img" } as const;
  if (covered) return <CircleCheck {...props} color="var(--success)" aria-label="Covered" />;
  if (fixable) return <CircleAlert {...props} color="var(--warning)" aria-label="Needs a subscription" />;
  return <CircleX {...props} color="var(--danger)" aria-label="Not available" />;
}

function MoviePanel() {
  type Tab = "home" | "swipe" | "plan";
  const [tab, setTab] = useState<Tab>(() => (panelSection("movie") as Tab | undefined) ?? "home");
  useEffect(() => {
    clearPanelSection("movie");
    return onOpenPanel(({ id, section }) => id === "movie" && section && setTab(section as Tab));
  }, []);
  return (
    <div>
      <nav className="tabs">
        {(["home", "swipe", "plan"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {TABS[t]}
          </button>
        ))}
      </nav>
      {tab === "home" && <HouseholdTab />}
      {tab === "swipe" && <SwipeTab />}
      {tab === "plan" && <PlanTab />}
    </div>
  );
}

export const moviePanel: Panel = { id: "movie", title: "Movie night", short: "Movie", icon: Clapperboard, description: "Sync households, vote on what to watch and plan the cheapest way to watch it.", component: MoviePanel, useSetup: useMovieSetup, modes: ["movie"], companion: true };
