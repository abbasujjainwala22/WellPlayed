// Prediction poll + reactions heatmap across two browsers.  node e2e/polls.mjs
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

await host.getByRole("button", { name: "Polls", exact: true }).click();
await guest.getByRole("button", { name: "Polls", exact: true }).click();
await host.locator("select").last().selectOption("prediction");
await host.getByPlaceholder("Question").fill("Who is the killer?");
await host.getByPlaceholder("One option per line").fill("Ana\nBo");
await host.getByRole("button", { name: "Create" }).click();
await guest.getByRole("button", { name: /^Bo/ }).click();
await host.getByTitle("Reveal with this as the correct answer").nth(1).click();
await guest.getByText("Gus +50").waitFor({ timeout: 5000 });
console.log("PREDICTION SCORING OK");

await guest.getByTitle("laugh").click();
await guest.getByTitle("laugh").click();
await host.getByRole("button", { name: "Highlights", exact: true }).click();
await host.getByText("Refresh reaction timeline").click();
await host.getByText(/2 reactions/).first().waitFor({ timeout: 5000 });
console.log("HEATMAP OK");
await browser.close();
