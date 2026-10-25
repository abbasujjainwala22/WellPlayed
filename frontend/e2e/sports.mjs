// Spoiler-safe sports: a 3s-behind viewer sees the fast viewer's cheer ~3s later.  node e2e/sports.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const host = await (await browser.newContext()).newPage();
const guest = await (await browser.newContext()).newPage();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Fast");
await host.getByRole("radio", { name: /Sports/ }).click();
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
const code = host.url().split("/room/")[1];
await guest.goto(`${BASE}/join/${code}`);
await guest.getByLabel("Your name").fill("Slow");
await guest.getByRole("button", { name: "Join", exact: true }).click();
await guest.waitForURL(/\/room\//);

for (const p of [host, guest]) await p.getByRole("button", { name: "Live sync", exact: true }).click();
await host.getByLabel("Spoiler-safe mode").click();
await host.waitForFunction(() => [...document.querySelectorAll("label")].some((l) => l.textContent.includes("Spoiler-safe") && l.querySelector("input").checked));
// the slow viewer says they are 3s behind
await guest.locator('input[type=range]').first().evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, "3"); el.dispatchEvent(new Event("input", { bubbles: true }));
});
await guest.getByText(/3\.0s \(manual\)/).first().waitFor({ timeout: 5000 });
await host.getByPlaceholder(/YouTube link/).fill(`${BASE}/demo.webm`);
await host.getByText("Load", { exact: true }).click();
await host.getByRole("button", { name: "Chat", exact: true }).click();
await guest.getByRole("button", { name: "Chat", exact: true }).click();
await host.getByPlaceholder(/Message the room/).fill("GOOOAL");
const t0 = Date.now();
await host.getByRole("button", { name: "Send" }).click();
await host.getByText("GOOOAL").first().waitFor();
const fastMs = Date.now() - t0;
await guest.getByText("GOOOAL").first().waitFor({ timeout: 8000 });
const slowMs = Date.now() - t0;
console.log(`fast viewer saw it after ${fastMs} ms, slow viewer after ${slowMs} ms`);
await browser.close();
const ok = fastMs < 1500 && slowMs >= 2800;
console.log(ok ? "SPOILER-SAFE OK" : "SPOILER-SAFE FAILED");
process.exit(ok ? 0 : 1);
