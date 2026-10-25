import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { toast } from "../../components/ui";
import { AddRecForm } from "./AddRecForm";
import { DEMO_RECS } from "./demo-recs";
import { RecCard } from "./RecCard";
import { recsApi, type NewRec, type Rec } from "./recs-api";

const KEY = ["recs"];

/** `openAdd` bumps to open the "recommend" form from elsewhere on the page (the hero button). */
export function Recommendations({ openAdd = 0 }: { openAdd?: number }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openAdd) return;
    setAdding(true);
    requestAnimationFrame(() => {
      section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      section.current?.querySelector<HTMLInputElement>(".rec-form input")?.focus({ preventScroll: true });
    });
  }, [openAdd]);
  // Refreshed when the page regains focus or becomes visible again, and after every action. No polling loop.
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: KEY,
    queryFn: recsApi.list,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const patch = (rec: Rec) =>
    qc.setQueryData<{ recs: Rec[]; demo: boolean }>(KEY, (d) => d && { ...d, recs: d.recs.map((r) => (r.id === rec.id ? rec : r)) });
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const create = async (rec: NewRec) => {
    const made = await recsApi.create(rec);
    qc.setQueryData<{ recs: Rec[]; demo: boolean }>(KEY, (d) => ({ demo: false, recs: [made, ...(d?.recs ?? [])] }));
    toast("Thanks! Your recommendation is live.");
    void refresh();
  };
  const vote = async (id: string, option: number) => {
    try {
      patch(await recsApi.vote(id, option));
    } finally {
      void refresh();
    }
  };
  const remove = async (id: string) => {
    await recsApi.remove(id);
    qc.setQueryData<{ recs: Rec[]; demo: boolean }>(KEY, (d) => d && { ...d, recs: d.recs.filter((r) => r.id !== id) });
    toast("Recommendation deleted", "info");
    void refresh();
  };

  // newest first, so the latest pick gets the big featured card
  const real = [...(data?.recs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const demo = !!data && real.length === 0;

  return (
    <section className="discover-section" id="recommendations" ref={section} aria-labelledby="recs-heading">
      <div className="discover-head">
        <div className="grow">
          <h2 id="recs-heading">
            {demo ? "Demo recommendations" : "Community recommendations"}
            {demo && <span className="tag warning">Demo</span>}
          </h2>
          <p className="muted">
            {demo
              ? "Sample cards with made-up votes to show how this works. Add the first real one and they disappear for everyone."
              : "Picked by people using WellPlayed. One vote per poll on each device."}
          </p>
        </div>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Recommend something
          </button>
        )}
      </div>

      {adding && <AddRecForm onSubmit={create} onCancel={() => setAdding(false)} />}

      {isPending && (
        <div className="rec-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rec-card skeleton rec-skeleton" />
          ))}
        </div>
      )}
      {isError && (
        <div className="card discover-note">
          <p className="error">Couldn’t load recommendations right now.</p>
          <button className="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}
      {data && (
        <div className="rec-grid">
          {demo
            ? DEMO_RECS.map((r, i) => <RecCard key={r.id} rec={r} emoji={r.emoji} demo featured={i === 0} />)
            : real.map((r, i) => (
                <RecCard key={r.id} rec={r} featured={i === 0} onVote={(o) => vote(r.id, o)} onDelete={() => remove(r.id)} />
              ))}
        </div>
      )}
    </section>
  );
}
