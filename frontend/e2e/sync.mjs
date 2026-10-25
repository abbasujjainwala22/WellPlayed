// Two real browsers join one room; the host plays/seeks; we assert the guest converges.
// Run: (backend on :8000, frontend on :5173)  node e2e/sync.mjs
import { createRequire } from "node:module";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const host = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();

await host.goto(BASE);
await host.getByLabel("Your name").fill("Host");
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];

await guest.goto(`${BASE}/join/${code}`);
await guest.getByLabel("Your name").fill("Guest");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/room\//);

await host.getByPlaceholder(/YouTube link/).fill(`${BASE}/demo.webm`);
await host.getByText("Load", { exact: true }).click();
await host.waitForSelector("video");
await guest.waitForSelector("video");
await host.waitForTimeout(1500);

const ready = (p) => p.evaluate(() => { const v = document.querySelector("video"); return v.readyState >= 3 && !v.error; });
if (!(await ready(host)) || !(await ready(guest))) { console.log("media did not load"); process.exit(2); }
const playingNow = (p) => p.evaluate(() => !document.querySelector("video").paused);
const t = (p) => p.evaluate(() => document.querySelector("video").currentTime);
await host.getByRole("button", { name: "Play", exact: true }).click();
await host.waitForTimeout(4000);
const [a, b] = [await t(host), await t(guest)];
console.log("after play  host", a.toFixed(2), "guest", b.toFixed(2), "playing:", await playingNow(host), await playingNow(guest));

await host.getByRole("button", { name: "Forward 10 seconds" }).click();
await host.waitForTimeout(3000);
const [c, d] = [await t(host), await t(guest)];
console.log("after seek  host", c.toFixed(2), "guest", d.toFixed(2));

await host.getByRole("button", { name: "Pause", exact: true }).click();
await host.waitForTimeout(1500);
const [e, f] = [await t(host), await t(guest)];
console.log("after pause host", e.toFixed(2), "guest", f.toFixed(2));
await browser.close();
const ok = [Math.abs(a - b), Math.abs(c - d), Math.abs(e - f)].every((x) => x < 0.5) && c > a + 8 && a > 2;
console.log(ok ? "SYNC OK" : "SYNC FAILED");
process.exit(ok ? 0 : 1);
