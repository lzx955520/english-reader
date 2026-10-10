import { describe, expect, it, vi } from "vitest";
import { annotateArticle } from "../src/gloss";
import { buildGlosses, GLOSS_MAX_TEXT, GLOSS_MAX_WORDS } from "../electron/gloss";
import type { Definition } from "../src/types";

const definition = (word: string, extra: Partial<Definition> = {}): Definition => ({
  word, phonetic: "", definition: "", translation: "vt. 承认, 确认\\nvi. 致谢",
  pos: "", found: true, source: "ECDICT · MIT", ...extra,
});
const hints = {
  acknowledged: { lemma: "acknowledge", translation: "承认" },
  acknowledging: { lemma: "acknowledge", translation: "承认" },
  universally: { lemma: "universally", translation: "普遍地" },
};

describe("inline gloss presentation", () => {
  it("annotates a lemma only at its first lowercase occurrence across paragraphs", () => {
    const paragraphs = annotateArticle(
      "Acknowledged, acknowledged and acknowledging.\n\nIt was acknowledged universally.",
      hints,
    );
    const glossed = paragraphs.flatMap((p) => p.tokens).filter((t) => t.gloss);
    expect(glossed.map((t) => t.text)).toEqual(["acknowledged", "universally"]);
    expect(paragraphs[0].tokens.find((t) => t.text === "Acknowledged")?.gloss).toBeUndefined();
  });

  it("preserves every original character, punctuation, apostrophe and separator", () => {
    const raw = "It's well-known: acknowledged!\nWithin one paragraph.\n\n\nMary’s book; universally.";
    const paragraphs = annotateArticle(raw, hints);
    expect(paragraphs.map((p) => p.separatorBefore + p.tokens.map((t) => t.text).join("")).join("")).toBe(raw);
    expect(paragraphs.every((p) => p.tokens.map((t) => t.text).join("") === p.text)).toBe(true);
  });

  it("has no hints when disabled or unknown and never mutates input", () => {
    const before = JSON.stringify(hints);
    expect(annotateArticle("acknowledged unknown constructor", {}).flatMap((p) => p.tokens).some((t) => t.gloss)).toBe(false);
    annotateArticle("acknowledged acknowledged", hints);
    expect(JSON.stringify(hints)).toBe(before);
  });

  it("renders dictionary markup as text data, never as parsed HTML", () => {
    const tokens = annotateArticle("acknowledged", {
      acknowledged: { lemma: "acknowledge", translation: "<script>字</script>" },
    })[0].tokens;
    expect(tokens.find((t) => t.gloss)?.gloss?.translation).toBe("<script>字</script>");
  });
});

describe("bounded offline gloss heuristic", () => {
  it("resolves inflected forms, excludes capitals and common words, and shortens Chinese", () => {
    const lookup = vi.fn((word: string) => definition(
      word === "acknowledged" || word === "acknowledging" ? "acknowledge" : "travel",
    ));
    const result = buildGlosses(
      "Acknowledged ACKNOWLEDGED acknowledged acknowledged acknowledging important information travelling truth",
      lookup,
    );
    expect(result).toEqual({
      acknowledged: { lemma: "acknowledge", translation: "承认" },
      acknowledging: { lemma: "acknowledge", translation: "承认" },
    });
    expect(lookup.mock.calls.filter(([word]) => word === "acknowledged")).toHaveLength(1);
    expect(lookup.mock.calls.some(([word]) => /[A-Z]/.test(word))).toBe(false);
  });

  it("skips missing, non-Chinese and proper-name dictionary entries", () => {
    expect(buildGlosses("nonexistent", () => definition("nonexistent", { found: false }))).toEqual({});
    expect(buildGlosses("acknowledged", () => definition("acknowledge", { translation: "acknowledge" }))).toEqual({});
    expect(buildGlosses("washington", () => definition("Washington", { translation: "华盛顿" }))).toEqual({});
  });

  it.each([
    { tag: "cet4" }, { tag: "cet6 toefl" }, { tag: "gk" }, { tag: "zk" },
    { tag: "core" }, { bnc: 6000 }, { frq: 1 }, { oxford: 1 },
  ])("uses dictionary common-word metadata when available: %j", (metadata) => {
    expect(buildGlosses("acknowledged", () => definition("acknowledge", metadata))).toEqual({});
  });

  it("does not mistake missing/zero ranks for common words", () => {
    expect(buildGlosses("acknowledged", () => definition("acknowledge", {
      tag: "toefl", bnc: 0, frq: 10000, oxford: 0,
    })).acknowledged.translation).toBe("承认");
  });

  it("limits hint length without splitting Unicode characters", () => {
    const translation = "n. " + "测试".repeat(30);
    const result = buildGlosses("acknowledged", () => definition("acknowledge", { translation }));
    expect(Array.from(result.acknowledged.translation)).toHaveLength(19);
    expect(result.acknowledged.translation.endsWith("…")).toBe(true);
  });

  it("bounds both scanned text and unique dictionary lookups", () => {
    const lookup = vi.fn((word: string) => definition(word));
    const words = Array.from({ length: GLOSS_MAX_WORDS + 100 }, (_, i) =>
      "uncommonword" +
      String.fromCharCode(97 + Math.floor(i / (26 * 26))) +
      String.fromCharCode(97 + Math.floor(i / 26) % 26) +
      String.fromCharCode(97 + i % 26),
    );
    buildGlosses(words.join(" "), lookup);
    expect(lookup).toHaveBeenCalledTimes(GLOSS_MAX_WORDS);
    lookup.mockClear();
    buildGlosses(" ".repeat(GLOSS_MAX_TEXT) + "acknowledged", lookup);
    expect(lookup).not.toHaveBeenCalled();
  });
});

it("does not rely on dictionary headword capitals for names",()=>{
  expect(buildGlosses("washington",()=>definition("washington",{translation:"[地名] 华盛顿",definition:"capital of the United States"}))).toEqual({});
  expect(buildGlosses("Washington",()=>definition("washington",{translation:"华盛顿"}))).toEqual({});
});
