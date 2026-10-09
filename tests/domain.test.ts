import { describe, it, expect } from "vitest";
import {
  analyze,
  localDay,
  schedule,
  normalizeWord,
  defaults,
} from "../electron/domain";
import { settingsSchema } from "../electron/schemas";
import type { Card } from "../src/types";
const base: Card = {
  id: "a",
  word: "reader",
  meaning: "",
  example: "",
  articleId: "a",
  sourceTitle: "",
  sourceUrl: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  due: "2026-01-01T00:00:00.000Z",
  interval: 0,
  ease: 2.5,
  repetitions: 0,
  lapses: 0,
  version: 0,
};
describe("SM-2 and difficulty", () => {
  it("schedules first and second successful reviews at 1 and 6 days", () => {
    const now = new Date("2026-01-01T08:00:00Z");
    const first = schedule(base, 4, now);
    expect(first.interval).toBe(1);
    expect(first.version).toBe(1);
    expect(schedule(first, 4, now).interval).toBe(6);
  });
  it("relearns a forgotten card in ten minutes with bounded ease", () => {
    const c = schedule(
      { ...base, ease: 1.3, repetitions: 8, interval: 40 },
      0,
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(c.due).toBe("2026-01-01T00:10:00.000Z");
    expect(c.lapses).toBe(1);
    expect(c.ease).toBe(1.3);
    expect(c.repetitions).toBe(0);
  });
  it("easy reviews produce longer mature intervals than difficult ones", () => {
    const c = { ...base, repetitions: 3, interval: 10 };
    expect(schedule(c, 5).interval).toBeGreaterThan(schedule(c, 3).interval);
  });
  it("counts actual words and marks estimation", () => {
    expect(analyze("Hello world.").words).toBe(2);
    expect(
      analyze("Comprehensive institutional investigations.").difficulty,
    ).toContain("挑战");
  });
  it("uses local calendar day and normalizes words", () => {
    expect(localDay(new Date(2026, 0, 2))).toBe("2026-01-02");
    expect(normalizeWord(" “Reader’s!” ")).toBe("reader's");
  });
  it("rejects insecure and credential-bearing model URLs", () => {
    expect(settingsSchema.safeParse(defaults).success).toBe(true);
    for (const url of [
      "http://api.example.com",
      "https://name:secret@example.com",
      "https://api.example.com/?token=secret",
      "https://127.0.0.1",
    ])
      expect(
        settingsSchema.safeParse({
          ...defaults,
          models: {
            ...defaults.models,
            context: { ...defaults.models.context, baseUrl: url },
          },
        }).success,
      ).toBe(false);
  });
});
