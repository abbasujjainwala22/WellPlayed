import { Monitor, Moon, Sun } from "lucide-react";

import { type ThemePref, useResolvedTheme, useSettings } from "../lib/settings";

/** One-tap light/dark switch (top nav, room top bar). Picks an explicit theme; Settings can go back to "System". */
export function ThemeToggle({ className = "ghost icon" }: { className?: string }) {
  const resolved = useResolvedTheme();
  const set = useSettings((s) => s.set);
  const next = resolved === "dark" ? "light" : "dark";
  const label = `Switch to ${next} theme`;
  return (
    <button type="button" className={className} onClick={() => set({ theme: next })} aria-label={label} title={label}>
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

const OPTIONS: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

/** System / Light / Dark segmented control for the Settings page. */
export function ThemeChooser() {
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  return (
    <div className="tabs theme-chooser" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} className={theme === id ? "active" : ""} onClick={() => set({ theme: id })}>
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
