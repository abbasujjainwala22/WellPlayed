// Households -> coverage plan -> swipe.  node e2e/movie.mjs
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

for (const p of [host, guest]) await p.getByRole("button", { name: "Movie night", exact: true }).click();
await host.getByPlaceholder(/Household name/).fill("Host home");
await host.getByRole("button", { name: "Netflix", exact: true }).click();
await host.getByRole("button", { name: "Create my household" }).click();
await guest.getByPlaceholder(/Household name/).fill("Gus home");
await guest.getByRole("button", { name: "Create my household" }).click();
await host.getByText("Gus home").first().waitFor({ timeout: 5000 });

await host.getByRole("button", { name: "🎯 Plan" }).click();
await host.getByRole("button", { name: /Sample: Cooking Showdown/ }).click();
await host.getByText(/need 2 subscriptions/).waitFor({ timeout: 5000 });
await host.getByText(/Subscribe to Netflix/).waitFor();
console.log("PLANNER OK");

await guest.getByRole("button", { name: "👈 Swipe" }).click();
await guest.getByRole("button", { name: "⭐ Love" }).click();
await host.getByRole("button", { name: /Big Buck Bunny|WellPlayed demo clip/ }).first().waitFor({ timeout: 5000 });
console.log("SWIPE OK");
await browser.close();
