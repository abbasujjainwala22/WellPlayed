// The core demo: friends watch a YouTube video together.
// YouTube's iframe API is replaced by e2e/fake-youtube.js (rates rounded like YouTube, error 150 for
// "noembed…" ids), so this runs offline. Checks: start in sync, drift gets corrected even though the
// player can't nudge its rate, guests can't hijack playback, embed errors are explained, the room
// pauses when the video ends, and a dead room says so instead of reconnecting forever.
// Run: (backend on :8000, frontend on :5173)  node e2e/youtube.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");

const BASE = process.env.BASE ?? "http://localhost:5173";
const FAKE = readFileSync(new URL("./fake-youtube.js", import.meta.url), "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = async () => {
  const ctx = await browser.newContext();
  await ctx.route("https://www.youtube.com/iframe_api", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
  await ctx.route("https://i.ytimg.com/**", (r) => r.abort());
  return ctx.newPage();
};
const time = (p) => p.evaluate(() => window.__ytPlayers.at(-1)?.getCurrentTime() ?? -1);
const gap = async (a, b) => Math.abs((await time(a)) - (await time(b)));
const fail = async (msg) => {
  console.log("FAIL:", msg);
  await browser.close();
  process.exit(1);
};

const host = await page();
const guest = await page();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Akhil");
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];
await guest.goto(`${BASE}/join/${code}`);
await guest.getByLabel("Your name").fill("Uzi");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/room\//);

// 1. host loads a YouTube link; both get a player, nobody starts until the host presses play
await host.getByLabel("Video URL").fill("https://youtu.be/aqz-KE-bpKQ?si=share");
await host.getByRole("button", { name: "Load" }).click();
await guest.waitForFunction(() => window.__ytPlayers?.length > 0);
await host.waitForTimeout(800);
await host.getByRole("button", { name: "Play", exact: true }).click();
await host.waitForTimeout(3500);
let g = await gap(host, guest);
console.log("start gap", g.toFixed(2));
if (g > 0.6) await fail("players did not start together");
console.log("SYNCED START OK");

// 2. knock the guest 1.5 s ahead; the player can't use a 1.05x nudge, so the loop must seek it back
await guest.evaluate(() => (window.__ytPlayers.at(-1).video.currentTime += 1.5));
await guest.waitForTimeout(3500);
g = await gap(host, guest);
console.log("gap after drift", g.toFixed(2));
if (g > 0.6) await fail("drift on a coarse-rate player was not corrected");
console.log("DRIFT CORRECTED OK");

// 3. the guest presses pause inside the YouTube player: blocked, explained, pulled back to playing
await guest.evaluate(() => window.__ytPlayers.at(-1).userPause());
await guest.getByText(/Only the host controls playback/).waitFor({ timeout: 5000 });
await guest.waitForFunction(() => window.__ytPlayers.at(-1).getPlayerState() === 1, null, { timeout: 5000 });
console.log("GUEST PAUSE BLOCKED OK");

// 4. host pauses; both stop at the same point
await host.getByRole("button", { name: "Pause", exact: true }).click();
await guest.waitForFunction(() => window.__ytPlayers.at(-1).getPlayerState() === 2, null, { timeout: 5000 });
await host.waitForTimeout(600);
g = await gap(host, guest);
if (g > 0.3) await fail(`paused apart by ${g}`);
console.log("SYNCED PAUSE OK");

// 5. the room pauses at the end instead of looping, and Play starts it again from the top
await host.getByRole("button", { name: "Play", exact: true }).click();
await host.waitForTimeout(800);
if (process.env.DEBUG) console.log("after play", await host.evaluate(() => [window.__ytPlayers.at(-1).getCurrentTime(), window.__ytPlayers.at(-1).getPlayerState(), document.querySelector(".controls-row button")?.getAttribute("aria-label")]));
const dur = await host.evaluate(() => window.__ytPlayers.at(-1).getDuration());
await host.locator(".progress").click({ position: { x: Math.round((await host.locator(".progress").boundingBox()).width * ((dur - 2) / dur)), y: 2 } });
for (let i = 0; i < 8 && process.env.DEBUG; i++) {
  await host.waitForTimeout(1000);
  console.log(await host.evaluate(() => { const p = window.__ytPlayers.at(-1); return [p.getCurrentTime(), p.getDuration(), p.getPlayerState(), p.video.ended, document.querySelector(".controls-row button")?.getAttribute("aria-label"), document.querySelector(".stage-note")?.textContent]; }));
}
await guest.getByText("Finished").waitFor({ timeout: 10000 });
await host.waitForTimeout(1500);
if ((await guest.evaluate(() => window.__ytPlayers.at(-1).getPlayerState())) === 1) await fail("video replayed after it ended");
await host.getByRole("button", { name: "Play", exact: true }).click();
await host.waitForTimeout(2500);
if ((await time(guest)) > 5) await fail("play after the end did not restart from the top");
console.log("END OF VIDEO OK");

// 6. a video whose owner blocks embedding is explained to everyone
await host.getByRole("button", { name: "Change video" }).click();
await host.getByLabel("Video URL").fill("https://www.youtube.com/watch?v=noembed0001");
await host.getByRole("button", { name: "Load" }).click();
await guest.getByText(/doesn’t allow this video to be played outside YouTube/).waitFor({ timeout: 5000 });
console.log("EMBED ERROR EXPLAINED OK");

// 7. a link that isn't a video is caught before anyone's player breaks
await host.getByRole("button", { name: "Change video" }).click();
await host.getByLabel("Video URL").fill("https://www.youtube.com/@blender");
await host.getByRole("button", { name: "Load" }).click();
await host.getByText(/doesn’t point at a video/).waitFor({ timeout: 3000 });
console.log("BAD LINK CAUGHT OK");

// 8. a room the server no longer knows ends cleanly
const stale = await page();
await stale.goto(BASE);
await stale.evaluate(() => localStorage.setItem("wp:session:ZZZZZZ", JSON.stringify({ code: "ZZZZZZ", member_id: "x", token: "dead" })));
await stale.goto(`${BASE}/room/ZZZZZZ`);
await stale.getByText("This room has ended").waitFor({ timeout: 8000 });
console.log("ENDED ROOM OK");

await browser.close();
