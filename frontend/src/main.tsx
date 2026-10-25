import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { initSettings } from "./lib/settings";
import "./styles.css";

// Theme and reduced motion go on <html> before the first render, so there is no flash of the wrong theme.
initSettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
