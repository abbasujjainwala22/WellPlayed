// Regenerate src/features/chat/emoji-data.json, the compact emoji set behind the chat picker.
// Run by hand when moving to a newer Emojibase release (not part of the build):
//   node scripts/gen-emoji-data.mjs
// Source: emojibase-data (MIT). Rows are [emoji, label, group, extra tags, skins?] where skins is
// 1 when the toned forms follow the usual modifier rule, or the five toned forms otherwise.
import { writeFileSync } from "node:fs";

const VERSION = "16.0.3";
const ORDER = [0, 1, 3, 4, 6, 5, 7, 8, 9]; // emojibase group ids in picker order (2 = components, skipped)
const OUT = new URL("../src/features/chat/emoji-data.json", import.meta.url);

const tone = (base, t) => {
  const cps = [...base];
  const mod = String.fromCodePoint(0x1f3fa + t);
  if (cps[1] === "️") cps[1] = mod;
  else cps.splice(1, 0, mod);
  return cps.join("");
};

const res = await fetch(`https://cdn.jsdelivr.net/npm/emojibase-data@${VERSION}/en/data.json`);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const rows = [];
for (const e of await res.json()) {
  if (e.group === undefined || e.group === 2) continue;
  const g = ORDER.indexOf(e.group);
  const words = new Set(e.label.toLowerCase().replaceAll(":", " ").split(/\s+/));
  const tags = (e.tags ?? []).filter((t) => !words.has(t.toLowerCase())).slice(0, 6);
  const row = [e.emoji, e.label, g, tags.join(" ")];
  const skins = (e.skins ?? []).filter((s) => Number.isInteger(s.tone));
  if (skins.length === 5) {
    const byTone = Object.fromEntries(skins.map((s) => [s.tone, s.emoji]));
    const derivable = [1, 2, 3, 4, 5].every((t) => tone(e.emoji, t) === byTone[t]);
    row.push(derivable ? 1 : [1, 2, 3, 4, 5].map((t) => byTone[t]));
  }
  rows.push({ g, order: e.order ?? 0, row });
}
rows.sort((a, b) => a.g - b.g || a.order - b.order);
writeFileSync(OUT, JSON.stringify(rows.map((r) => r.row)));
console.log(`${rows.length} emoji written to src/features/chat/emoji-data.json`);
