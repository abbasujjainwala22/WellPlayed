export type AnimalId =
  | "cat"
  | "dog"
  | "fox"
  | "bunny"
  | "panda"
  | "tiger"
  | "frog"
  | "raccoon"
  | "bear"
  | "lion"
  | "penguin"
  | "owl";

export interface Animal {
  id: AnimalId;
  name: string;
  emoji: string;
  line: string;
}

export const ANIMALS: Animal[] = [
  { id: "cat", name: "Cat", emoji: "🐱", line: "Nine lives, zero apologies." },
  { id: "dog", name: "Dog", emoji: "🐶", line: "Very good. Very loud." },
  { id: "fox", name: "Fox", emoji: "🦊", line: "Suspiciously clever." },
  { id: "bunny", name: "Bunny", emoji: "🐰", line: "Cute, and plotting something." },
  { id: "panda", name: "Panda", emoji: "🐼", line: "Professional snacker." },
  { id: "tiger", name: "Tiger", emoji: "🐯", line: "The group chat is in danger." },
  { id: "frog", name: "Frog", emoji: "🐸", line: "Unreasonable pond energy." },
  { id: "raccoon", name: "Raccoon", emoji: "🦝", line: "Midnight snack bandit." },
  { id: "bear", name: "Bear", emoji: "🐻", line: "Hibernation mode on." },
  { id: "lion", name: "Lion", emoji: "🦁", line: "Absolute cinema royalty." },
  { id: "penguin", name: "Penguin", emoji: "🐧", line: "Dressed up, dressed down." },
  { id: "owl", name: "Owl", emoji: "🦉", line: "Judging every plot twist." },
];

const BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));

export const animalInfo = (id: string): Animal => BY_ID.get(id as AnimalId) ?? { id: id as AnimalId, name: id, emoji: "🐾", line: "" };

export const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word.toLowerCase()}`;
