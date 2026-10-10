import { describe, it, expect } from "vitest";
import { SessionConsent, consentDetails, consentPreview } from "../electron/consent";

describe("session-only AI consent", () => {
  it("starts off, grants only current revision, and revokes pending grants", () => {
    const consent = new SessionConsent();
    expect(consent.enabled).toBe(false);
    expect(consent.grant(0)).toBe(true);
    consent.revoke();
    expect(consent.enabled).toBe(false);
    expect(consent.grant(0)).toBe(false);
    expect(consent.grant(consent.revision)).toBe(true);
    expect(new SessionConsent().enabled).toBe(false);
  });
  it("bounds native dialog previews without implying truncated transmission", () => {
    expect(consentPreview("short")).toBe("short");
    const preview = consentPreview("x".repeat(15000));
    expect(preview.length).toBeLessThan(450);
    expect(preview).toContain("完整 15000 字符");
  });
  it("discloses each feature's exact recipient, model and data", () => {
    const text = consentDetails({
      context: { provider: "deepseek", baseUrl: "https://api.deepseek.com/", model: "context-model" },
      grammar: { provider: "compatible", baseUrl: "https://grammar.example/v1", model: "grammar-model" },
      selection: { provider: "compatible", baseUrl: "https://selection.example/v1/", model: "selection-model" },
    });
    for (const value of ["当前段落", "周围段落", "编号、标题、词数、难度、发布日期", "context-model", "grammar-model", "selection-model", "https://api.deepseek.com/chat/completions", "https://grammar.example/v1/chat/completions", "https://selection.example/v1/chat/completions"]) expect(text).toContain(value);
  });
});
