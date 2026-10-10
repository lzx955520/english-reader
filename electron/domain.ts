import type { Card, Article, Settings } from "../src/types";
export const defaults: Settings = {
  dailyMinutes: 45,
  inlineGlosses: true,
  models: {
    context: {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
    selection: {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
    grammar: {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-reasoner",
    },
  },
};
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function analyze(text: string) {
  const tokens = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
  const sentences = text.split(/[.!?]+/).filter((s) => /[a-z]/i.test(s));
  const avg = tokens.length / Math.max(1, sentences.length);
  const long =
    tokens.filter((t) => t.length >= 9).length / Math.max(1, tokens.length);
  return {
    words: tokens.length,
    minutes: Math.max(5, Math.ceil(tokens.length / 45)),
    difficulty:
      avg > 26 || long > 0.2
        ? "较难 · 挑战（估计）"
        : avg > 15 || long > 0.12
          ? "适中略高 · 推荐（估计）"
          : "较易 · 热身（估计）",
  };
}
export function schedule(
  card: Card,
  rating: 0 | 3 | 4 | 5,
  now = new Date(),
): Card {
  let interval = card.interval,
    repetitions = card.repetitions,
    ease = card.ease,
    lapses = card.lapses;
  if (rating === 0) {
    interval = 0;
    repetitions = 0;
    lapses++;
  } else {
    repetitions++;
    interval =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 6
          : Math.max(
              1,
              Math.round(
                interval * ease * (rating === 3 ? 0.8 : rating === 5 ? 1.2 : 1),
              ),
            );
  }
  ease = Math.max(
    1.3,
    ease + 0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02),
  );
  const due = new Date(now);
  if (rating === 0) due.setMinutes(due.getMinutes() + 10);
  else due.setDate(due.getDate() + interval);
  return {
    ...card,
    interval,
    repetitions,
    ease,
    lapses,
    due: due.toISOString(),
    version: card.version + 1,
  };
}
export function rank(articles: Article[]) {
  return [...articles].sort((a, b) => {
    const score = (x: Article) =>
      (x.difficulty.includes("略高") ? 30 : 0) +
      (x.minutes >= 8 && x.minutes <= 25 ? 15 : 0) -
      x.progress * 15;
    // Fresh publication comes first; difficulty is advisory within a day.
    return b.published.localeCompare(a.published) || score(b) - score(a);
  });
}
export function normalizeWord(word: string) {
  return word
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/gi, "");
}
