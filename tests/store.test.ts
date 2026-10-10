import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { defaults } from "../electron/domain";
let directory: string, store: Store;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "reader-store-"));
  store = await Store.open(directory, path.resolve("assets"));
});
afterEach(() => {
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
describe("SQLite integration", () => {
  it("opens real licensed classic and bilingual dictionary with word forms", () => {
    expect(store.state().articles[0].kind).toBe("classic");
    const d = store.lookup("universally");
    expect(d.found).toBe(true);
    expect(d.translation).toMatch(/[\u4e00-\u9fff]/);
    expect(store.lookup("acknowledged").found).toBe(true);
    expect(store.lookup("zzzzxxxyz").found).toBe(false);
  });
  it("deduplicates repeated clicks and preserves source and sentence", () => {
    const a = store.state().articles[0];
    const input = {
      word: "truth",
      meaning: "真理",
      example: a.text.slice(0, 150),
      articleId: a.id,
    };
    const x = store.saveCard(input),
      y = store.saveCard(input);
    expect(x.id).toBe(y.id);
    expect(store.state().cards.length).toBe(1);
    expect(x.sourceUrl).toBe(a.url);
    expect(x.example).toBe(input.example);
  });
  it("persists progress, settings, cards and review schedule across restart", async () => {
    const a = store.state().articles[0];
    store.progress(a.id, 0.65, 123);
    store.saveSettings({ ...defaults, dailyMinutes: 60 });
    const c = store.saveCard({
      word: "truth",
      meaning: "真理",
      example: "It is a truth.",
      articleId: a.id,
    });
    const reviewed = store.review(c.id, 4, c.version);
    store.close();
    store = await Store.open(directory, path.resolve("assets"));
    expect(store.state().articles[0].progress).toBe(0.65);
    expect(store.state().articles[0].position).toBe(123);
    expect(store.state().settings.dailyMinutes).toBe(60);
    expect(store.state().cards[0].due).toBe(reviewed.due);
  });
  it("rejects repeated review of a stale card", () => {
    const a = store.state().articles[0];
    const c = store.saveCard({
      word: "truth",
      meaning: "",
      example: "",
      articleId: a.id,
    });
    store.review(c.id, 4, c.version);
    expect(() => store.review(c.id, 4, c.version)).toThrow("已复习");
    expect(store.state().cards[0].version).toBe(1);
  });
  it("round-trips backup including progress, examples and schedule", () => {
    const a = store.state().articles[0];
    store.progress(a.id, 0.4, 900);
    const c = store.saveCard({
      word: "truth",
      meaning: "真理",
      example: "A truth universally acknowledged.",
      articleId: a.id,
    });
    store.review(c.id, 3, 0);
    store.trackSeconds(60);
    const b = store.backup();
    store.deleteCard(c.id);
    store.restore(b);
    expect(store.backup().articles).toEqual(b.articles);
    expect(store.backup().cards).toEqual(b.cards);
    expect(store.backup().study).toEqual(b.study);
    expect(JSON.stringify(b)).not.toContain("hasKey");
  });
  it("rejects corrupt backup without losing existing data", () => {
    const before = store.state();
    expect(() =>
      store.restore({ ...store.backup(), cards: [{ id: "broken" }] }),
    ).toThrow();
    expect(store.state().articles).toEqual(before.articles);
    const b = store.backup();
    expect(() =>
      store.restore({ ...b, articles: [...b.articles, ...b.articles] }),
    ).toThrow("重复");
    expect(store.state().articles.length).toBe(1);
  });
  it("retains cached articles on offline errors and deduplicates successful updates", () => {
    const a = {
      ...store.state().articles[0],
      id: "news-123",
      url: "https://en.wikinews.org/?curid=123",
      kind: "news" as const,
    };
    expect(store.addArticles([a, a])).toBe(1);
    expect(store.addArticles([a])).toBe(0);
    store.refreshFailure("网络不可用");
    expect(store.state().articles.length).toBe(2);
    expect(store.state().refreshError).toBe("网络不可用");
  });
});

it("persists source diagnostics and retains previous success on failure", async () => {
  const report = { id:"nih", name:"NIH Research Matters",url:"https://www.nih.gov/nih-research-matters/feed.xml",
    status:"no-new" as const,lastAttempt:"2026-10-10T00:00:00.000Z",lastSuccess:"2026-10-10T00:00:00.000Z",
    candidates:1,added:0,duplicates:1,filtered:0,failures:0,cached:0,message:"" };
  store.saveDiagnostics([report]);
  store.saveDiagnostics([{...report,status:"failed",lastSuccess:"",failures:1,message:"offline"}]);
  store.saveSettings({...defaults,inlineGlosses:false});
  store.close(); store = await Store.open(directory,path.resolve("assets"));
  expect(store.state().sourceDiagnostics?.[0].lastSuccess).toBe(report.lastSuccess);
  expect(store.state().sourceDiagnostics?.[0].status).toBe("failed");
  expect(store.state().settings.inlineGlosses).toBe(false);
});
it("old backups default gloss settings and glossary leaves source text intact",()=>{
  const b=store.backup();
  delete b.settings.inlineGlosses;
  store.restore(b);
  expect(store.state().settings.inlineGlosses).toBe(true);
  const a=store.state().articles[0], text=a.text;
  const first=store.glosses(a.id),again=store.glosses(a.id);
  expect(again).toEqual(first);
  expect(store.article(a.id)?.text).toBe(text);
  expect(store.glosses(a.id).truth).toBeUndefined();
});
