import { create } from "zustand";

interface Prefs {
  subtitleLang: string; // "auto" = my language, "off", or a language code
  subtitleSize: number;
  showOriginal: boolean;
  set: (p: Partial<Omit<Prefs, "set">>) => void;
}

const KEY = "wp:prefs";
const load = (): Partial<Prefs> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

export const usePrefs = create<Prefs>((set, get) => ({
  subtitleLang: "auto",
  subtitleSize: 20,
  showOriginal: false,
  ...load(),
  set: (p) => {
    set(p);
    try {
      const { set: _s, ...rest } = get();
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable */
    }
  },
}));
