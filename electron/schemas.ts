import { z } from "zod";

// This is literal-host validation only; it does not resolve DNS or police redirects.
function blockedIPv4(host: string) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}
function blockedHost(hostname: string) {
  // WHATWG URL canonicalizes IPv4 aliases and IPv6 compression before this check.
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (!host.startsWith("[")) return blockedIPv4(host);
  const address = host.slice(1, -1);
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = (
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
  ).map((word) => parseInt(word, 16));
  // Unspecified, loopback, unique-local, link-local and deprecated site-local.
  if (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) ||
    (words[0] & 0xfe00) === 0xfc00 ||
    (words[0] & 0xffc0) === 0xfe80 ||
    (words[0] & 0xffc0) === 0xfec0
  ) return true;
  // IPv4-mapped and deprecated IPv4-compatible forms must share IPv4 policy.
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    (words[5] === 0xffff || words[5] === 0)
  ) {
    return blockedIPv4([
      words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255,
    ].join("."));
  }
  return false;
}

export const feature = z.enum(["context", "grammar", "selection"]);
export const model = z.object({
  provider: z.enum(["deepseek", "compatible"]),
  baseUrl: z
    .string()
    .url()
    .max(300)
    .refine((s) => {
      try {
        const u = new URL(s);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          !blockedHost(u.hostname)
        );
      } catch {
        return false;
      }
    }, "接口必须为不含凭据的公网 HTTPS 地址"),
  model: z.string().trim().min(1).max(100),
});
export const settingsSchema = z.object({
  dailyMinutes: z.number().int().min(30).max(60),
  models: z.object({ context: model, grammar: model, selection: model }),
});
export const articleSchema = z.object({
  id: z.string().max(150),
  title: z.string().max(500),
  source: z.string().max(200),
  url: z.string().url().max(1000),
  published: z.string().max(30),
  fetchedAt: z.string().datetime(),
  kind: z.enum(["news", "classic"]),
  license: z.string().max(100),
  licenseUrl: z.string().url(),
  author: z.string().max(300),
  text: z.string().min(1).max(200000),
  words: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  difficulty: z.string().max(100),
  progress: z.number().min(0).max(1),
  position: z.number().nonnegative(),
});
export const cardSchema = z.object({
  id: z.string().max(150),
  word: z.string().min(1).max(120),
  meaning: z.string().max(12000),
  example: z.string().max(10000),
  articleId: z.string().max(150),
  sourceTitle: z.string().max(500),
  sourceUrl: z.string().max(1000),
  createdAt: z.string().datetime(),
  due: z.string().datetime(),
  interval: z.number().int().min(0).max(36500),
  ease: z.number().min(1.3).max(5),
  repetitions: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});
export const backupSchema = z
  .object({
    format: z.literal("english-reader-backup"),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    articles: z.array(articleSchema).max(1000),
    cards: z.array(cardSchema).max(50000),
    settings: settingsSchema,
    study: z.record(z.number().nonnegative()),
    lastRefresh: z.string().max(30),
  })
  .strict();
