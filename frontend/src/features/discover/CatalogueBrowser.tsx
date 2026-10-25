import { useQuery } from "@tanstack/react-query";
import { PlayCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../lib/api";

interface Service {
  id: string;
  name: string;
  free: boolean;
}
interface Title {
  id: string;
  title: string;
  year: number;
  type: string;
  genres: string[];
  runtime: number;
  sample?: boolean;
  availability: Record<string, string[]>;
  media?: { kind: string; url: string };
}

const REGIONS = ["AU", "US", "GB", "CA", "DE", "IN"];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CatalogueBrowser() {
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const query = useDebounced(q.trim(), 250);
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => api<Service[]>("/api/services") });
  const { data, isPending, isError } = useQuery({
    queryKey: ["catalogue", query, region],
    queryFn: () => {
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      if (region) p.set("region", region);
      const qs = p.toString();
      return api<Title[]>(`/api/catalogue${qs ? `?${qs}` : ""}`);
    },
    placeholderData: (prev) => prev,
  });
  const name = (id: string) => services.find((s) => s.id === id)?.name ?? id;
  const where = (t: Title) =>
    Object.entries(t.availability)
      .filter(([, regions]) => !region || regions.includes("*") || regions.includes(region))
      .map(([id]) => name(id));

  return (
    <section className="discover-section" aria-labelledby="catalogue-heading">
      <div className="discover-head">
        <div className="grow">
          <h2 id="catalogue-heading">
            Browse the sample catalogue <span className="tag warning">Sample data</span>
          </h2>
          <p className="muted">
            A small built-in list for trying the movie-night planner. Titles marked “sample” are placeholders with made-up availability.
          </p>
        </div>
      </div>
      <div className="cat-controls">
        <label className="cat-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" placeholder="Search titles" aria-label="Search the sample catalogue" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Any region</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      {isPending && <p className="muted">Loading the catalogue…</p>}
      {isError && <p className="error">Couldn’t load the catalogue.</p>}
      {data && data.length === 0 && <p className="muted">Nothing matches{query ? ` “${query}”` : ""}{region ? ` in ${region}` : ""}.</p>}
      {data && data.length > 0 && (
        <ul className="cat-list">
          {data.map((t) => (
            <li key={t.id} className="cat-item">
              <div className="cat-item-head">
                <strong>{t.title}</strong>
                {t.sample ? <span className="tag">sample</span> : t.media && (
                  <span className="tag success">
                    <PlayCircle /> Plays in WellPlayed
                  </span>
                )}
              </div>
              <p className="muted">
                {t.year} · {t.runtime} min · {t.genres.join(", ")}
              </p>
              <p className="faint">On: {where(t).join(", ") || "not listed in this region"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
