import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { FullscreenState, Toaster } from "./components/ui";
import { Companion } from "./pages/Companion";
import { Discover } from "./pages/Discover";
import { HallOfFame } from "./pages/HallOfFame";
import { Home } from "./pages/Home";
import { Join } from "./pages/Join";
import { ReelyAI } from "./pages/ReelyAI";
import { Room } from "./pages/Room";
import { Settings } from "./pages/Settings";

const queryClient = new QueryClient();

function NotFound() {
  return (
    <FullscreenState icon={<div className="state-icon"><Compass size={26} /></div>} title="This page doesn’t exist">
      <p className="muted">The link may be mistyped. Start a new watch party or join one with a code.</p>
      <Link to="/">Go to the home page</Link>
    </FullscreenState>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Pages with the app shell (top nav, footer, bottom tabs on phones) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/ai" element={<ReelyAI />} />
            <Route path="/hall-of-fame" element={<HallOfFame />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          {/* Full-screen pages */}
          <Route path="/join/:code" element={<Join />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="/companion/:code" element={<Companion />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
