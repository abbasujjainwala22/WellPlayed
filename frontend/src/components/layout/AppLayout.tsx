import { NavLink, Outlet } from "react-router-dom";

import { Logo } from "../Logo";
import { ThemeToggle } from "../ThemeToggle";
import "./layout.css";
import { NAV } from "./navItems";

/** Shell for the non-room pages: sticky top nav, page content, footer and a bottom tab bar on phones. */
export function AppLayout() {
  return (
    <div className="site app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-nav">
        <div className="app-nav-inner">
          <Logo size={22} />
          <nav className="app-nav-links" aria-label="Main">
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end}>
                {label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="app-main">
        <Outlet />
      </main>

      <footer className="site-foot">
        <div>
          <Logo size={16} link={false} />
          <span>Built for Sys AI Hackathon 2026</span>
          <span className="spacer">Syncs playback only. Respects DRM and platform terms.</span>
        </div>
      </footer>

      <nav className="app-tabbar" aria-label="Main" style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}>
        {NAV.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label}>
            <Icon size={20} aria-hidden="true" />
            <span>{short ?? label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
