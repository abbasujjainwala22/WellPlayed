// Pair a phone via the QR link; it chats and reacts as the same member.  node e2e/companion.mjs
import { createRequire } from "node:module";
const { chromium, devices } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const BASE = process.env.BASE ?? "http://localhost:5173";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const host = await (await browser.newContext()).newPage();
await host.goto(BASE);
await host.getByLabel("Your name").fill("Host");
await host.getByText("Create room").click();
await host.waitForURL(/\/room\//);
await host.getByRole("button", { name: "Pair phone" }).click();
await host.locator("svg").first().waitFor();
const link = await host.locator(".pairlink").innerText();

const phoneCtx = await browser.newContext({ ...devices["iPhone 13"] });
const phone = await phoneCtx.newPage();
await phone.goto(link);
await phone.getByPlaceholder(/Message the room/).waitFor({ timeout: 8000 });
await phone.getByPlaceholder(/Message the room/).fill("from my phone");
await phone.getByRole("button", { name: "Send" }).click();
await host.getByRole("button", { name: "Close" }).click();
await host.getByRole("button", { name: "Chat", exact: true }).click();
await host.getByText("from my phone").waitFor({ timeout: 5000 });
console.log("PHONE CHAT OK; url cleaned:", new URL(phone.url()).search === "");

const again = await (await browser.newContext()).newPage();
await again.goto(link);
await again.getByText(/expired or was already used/).waitFor({ timeout: 5000 });
console.log("ONE-TIME LINK OK");
await browser.close();
