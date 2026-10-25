import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // reachable from phones and laptops on the same Wi-Fi
    allowedHosts: true, // and through a tunnel (cloudflared, ngrok) for friends elsewhere
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  test: { environment: "node" },
});
