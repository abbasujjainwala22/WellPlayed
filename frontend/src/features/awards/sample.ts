import type { AwardsRecord } from "./history";

const DAY = 86_400_000;

/** Made-up parties shown on an empty Hall of Fame so people can see what it fills up with. Never saved. */
export function sampleAwards(now = Date.now()): AwardsRecord[] {
  return [
    {
      code: "SAMPLE1",
      roomName: "Friday Movie Night",
      mode: "movie",
      at: now - 2 * DAY,
      title: "Knives Out",
      review: { avg: 4.5, count: 4 },
      awards: [
        { id: "reactor", kind: "auto", emoji: "🎭", name: "The Reaction Machine", blurb: "Felt every scene, loudly.",
          winners: [{ name: "Priya" }], stat: "42 reactions, mostly 😱" },
        { id: "oracle", kind: "auto", emoji: "🔮", name: "The Oracle", blurb: "Saw it coming, called it, collected the points.",
          winners: [{ name: "Sam" }], stat: "30 pts from 3 correct calls" },
        { id: "peer-goblin", kind: "peer", emoji: "👺", name: "The Plot-Twist Goblin", blurb: "Most unhinged theory",
          winners: [{ name: "Jordan" }], stat: "3 votes" },
        { id: "snacks", kind: "auto", emoji: "🍿", name: "Snack Run Champion", blurb: "Kept the snack supply chain alive.",
          winners: [{ name: "Priya" }], stat: "2 break requests" },
      ],
    },
    {
      code: "SAMPLE2",
      roomName: "Derby Day",
      mode: "sports",
      at: now - 6 * DAY,
      title: null,
      review: { avg: 4, count: 3 },
      awards: [
        { id: "peer-hype", kind: "peer", emoji: "📣", name: "Chief Hype Officer", blurb: "Kept the energy up all night",
          winners: [{ name: "Sam" }], stat: "4 votes" },
        { id: "chatter", kind: "auto", emoji: "💬", name: "Chatterbox Supreme", blurb: "Narrated the whole thing so nobody else had to.",
          winners: [{ name: "Priya" }], stat: "57 messages" },
        { id: "buffering", kind: "auto", emoji: "⏳", name: "The Human Buffering Icon",
          blurb: "Their Wi-Fi took a few dramatic pauses of its own.", winners: [{ name: "Alex" }], stat: "5 stalls" },
      ],
    },
  ];
}
