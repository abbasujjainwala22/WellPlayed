// Loads the unpacked extension; a plain <video> tab (standing in for a streaming site) follows the room.
// node e2e/extension.mjs
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173";
const ext = path.resolve("../extension");
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "wp-ext-")), {
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent("serviceworker", { timeout: 15000 });

const host = await ctx.newPage();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Host");
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];
const token = JSON.parse(await host.evaluate((c) => localStorage.getItem(`wp:session:${c}`), code)).token;

// a second member whose "TV" is the extension tab
const g = await (await fetch(`${BASE}/api/rooms/${code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "TV" }) })).json();
await sw.evaluate((cfg) => chrome.storage.local.set({ wpConfig: cfg }), { server: BASE, code, token: g.token, isHost: false, auto: true });

const tv = await ctx.newPage();
await tv.goto(`${BASE}/demo.webm`);
await host.getByPlaceholder(/YouTube link/).fill(`${BASE}/demo.webm`);
await host.getByText("Load", { exact: true }).click();
await host.waitForSelector("video");
await host.waitForTimeout(1500);
await host.getByRole("button", { name: "Play", exact: true }).click();
await host.waitForTimeout(4000);
const t = (p) => p.evaluate(() => document.querySelector("video").currentTime);
const playing = await tv.evaluate(() => !document.querySelector("video").paused);
const [a, b] = [await t(host), await t(tv)];
console.log(`room ${a.toFixed(2)}s, extension tab ${b.toFixed(2)}s, tab playing: ${playing}`);
await host.getByRole("button", { name: "Forward 10 seconds" }).click();
await host.waitForTimeout(2500);
const [c, d] = [await t(host), await t(tv)];
console.log(`after seek: room ${c.toFixed(2)}s, extension tab ${d.toFixed(2)}s`);
await host.getByRole("button", { name: "Pause", exact: true }).click();
await host.waitForTimeout(1500);
const paused = await tv.evaluate(() => document.querySelector("video").paused);
await ctx.close();
const ok = playing && paused && Math.abs(a - b) < 0.6 && Math.abs(c - d) < 0.6 && c > a + 8;
console.log(ok ? "EXTENSION SYNC OK" : "EXTENSION SYNC FAILED");
process.exit(ok ? 0 : 1);
