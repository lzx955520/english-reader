import type { Article } from "./types";
/** Recent material first, with one representative of each available source. */
export function dailyArticles(articles: Article[], now = Date.now(), limit = 4) {
  const recent = articles.filter(a => a.kind === "news" && now - Date.parse(a.published) < 30 * 86400000 &&
    Date.parse(a.published) <= now + 86400000)
    .sort((a,b) => b.published.localeCompare(a.published));
  const selected: Article[] = [], sources = new Set<string>(), ids = new Set<string>();
  for (const a of recent) {
    if (sources.has(a.source)) continue;
    selected.push(a); sources.add(a.source); ids.add(a.id);
    if (selected.length >= limit) break;
  }
  for (const a of recent) {
    if (selected.length >= limit) break;
    if (!ids.has(a.id)) { selected.push(a); ids.add(a.id); }
  }
  return selected.sort((a,b) => b.published.localeCompare(a.published));
}
