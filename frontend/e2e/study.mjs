// Study mode: transcript -> quiz break pauses both browsers -> fastest correct answer scores.
// Backend needs WP_QUIZ_SECONDS=4.   node e2e/study.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173";
const SRT = `1
00:00:00,000 --> 00:00:04,000
Photosynthesis converts light energy into chemical energy inside chloroplasts.

2
00:00:04,000 --> 00:00:08,000
The chlorophyll pigment absorbs red and blue light but reflects green light.

3
00:00:08,000 --> 00:00:12,000
During the light reactions, water molecules are split and oxygen is released.

4
00:00:12,000 --> 00:00:16,000
The Calvin cycle then uses carbon dioxide to build glucose in the stroma.
`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const host = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Prof");
await host.getByRole("radio", { name: /Study/ }).click();
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];
await guest.goto(`${BASE}/join/${code}`);
await guest.getByLabel("Your name").fill("Stu");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/room\//);

await host.getByPlaceholder(/YouTube link/).fill(`${BASE}/demo.webm`);
await host.getByText("Load", { exact: true }).click();
await host.getByRole("button", { name: "AI", exact: true }).click();
await host.locator('input[type=file]').last().setInputFiles({ name: "lecture.srt", mimeType: "text/plain", buffer: Buffer.from(SRT) });
await host.getByText("Transcript loaded").waitFor();
await host.locator('input[type=number]').fill("1");
await host.getByText("Generate from transcript").click();
await host.getByText(/⏱/).waitFor({ timeout: 5000 });
console.log("QUIZ PLAN OK");

await guest.getByRole("button", { name: "Polls", exact: true }).click();
await host.getByRole("button", { name: "Play", exact: true }).click();
await guest.getByText(/Quiz break/).first().waitFor({ timeout: 20000 });
const t = await guest.evaluate(() => document.querySelector("video").paused);
console.log("guest video paused during quiz:", t);
// the correct option is the one with the blanked word; guest just picks the first option
await guest.locator(".quiz .opt").first().click();
await guest.getByText(/revealed/).first().waitFor({ timeout: 10000 });
console.log("QUIZ REVEALED OK");
await browser.close();
process.exit(t ? 0 : 1);
