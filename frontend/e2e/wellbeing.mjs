// Simulated slouch shows a shrimp to others; next episode waits for the stretch.
// Backend needs WP_STRETCH_SECONDS=3.  node e2e/wellbeing.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const host = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Host");
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];
await guest.goto(`${BASE}/join/${code}`);
await guest.getByLabel("Your name").fill("Gus");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/room\//);

for (const p of [host, guest]) {
  await p.getByRole("button", { name: "Wellbeing", exact: true }).click();
  await p.getByLabel("Join healthy-watching").check();
}
await guest.getByRole("button", { name: "Slouch", exact: true }).click();
await host.getByTitle("shrimp").waitFor({ timeout: 5000 });
console.log("SHRIMP VISIBLE TO GROUP OK");

await host.getByLabel("Next episode only starts after everyone stretches").click();
await host.waitForFunction(() => [...document.querySelectorAll("label")].some((l) => l.textContent.includes("Next episode only") && l.querySelector("input").checked));
await host.getByPlaceholder(/YouTube link/).fill(`${BASE}/demo.webm`);
await host.getByRole("button", { name: "Next episode" }).click();
await guest.getByText(/unlocks when everyone stretches/).waitFor({ timeout: 5000 });
await host.getByText("Guided 3s timer").click();
await guest.getByText("Guided 3s timer").click();
await guest.getByText("WellPlayed demo clip").or(guest.locator("video")).first().waitFor({ timeout: 10000 });
console.log("STRETCH LOCK RELEASED OK");
await browser.close();
