import { describe, it, expect, vi } from "vitest";
import { NewsService, parseNews, callAI } from "../electron/network";
import { defaults } from "../electron/domain";
const paragraph =
  "The researchers acknowledged that the international community must carefully consider the consequences of this important discovery before introducing new policies. ";
const text = "<p>" + paragraph.repeat(15) + "</p>";
function data(now = new Date()) {
  return {
    parse: {
      text,
      wikitext: "{{date|" + now.toISOString().slice(0, 10) + "}}\n{{publish}}",
    },
  };
}
describe("real-source protocol using explicit fixtures", () => {
  it("parses licensed news metadata, publication date and original text", () => {
    const a = parseNews(12, "A research discovery", data());
    expect(a?.kind).toBe("news");
    expect(a?.license).toBe("CC BY 4.0");
    expect(a?.url).toBe("https://en.wikinews.org/?curid=12");
    expect(a?.words).toBeGreaterThan(200);
  });
  it("rejects stale, undated, retracted and oversized articles", () => {
    expect(parseNews(1, "old", data(new Date("2001-01-01")))).toBeNull();
    expect(
      parseNews(1, "missing", { parse: { text, wikitext: "{{publish}}" } }),
    ).toBeNull();
    const d = data();
    d.parse.wikitext += "{{retracted}}";
    expect(parseNews(1, "retracted", d)).toBeNull();
    expect(
      parseNews(1, "large", {
        parse: {
          text: "<p>" + paragraph.repeat(500) + "</p>",
          wikitext: data().parse.wikitext,
        },
      }),
    ).toBeNull();
  });
  it("fetches real API paths, returns only supported articles, and can fail offline", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("https://en.wikinews.org/w/api.php");
      return new Response(
        JSON.stringify(
          url.includes("categorymembers")
            ? {
                query: {
                  rightsinfo: {
                    url: "https://creativecommons.org/licenses/by/4.0/",
                  },
                  categorymembers: [
                    { pageid: 12, title: "A research discovery" },
                  ],
                },
              }
            : data(),
        ),
      );
    });
    expect(
      (await new NewsService(fetcher).refresh(new AbortController().signal))[0]
        .title,
    ).toBe("A research discovery");
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(
      new NewsService(async () => {
        throw Error("offline");
      }).refresh(new AbortController().signal),
    ).rejects.toThrow("offline");
  });

  it("skips cached IDs and URLs before the three-new-article cap", async () => {
    const parsedIds: number[] = [];
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("action") === "query") {
        return new Response(JSON.stringify({ query: {
          rightsinfo: { url: "https://creativecommons.org/licenses/by/4.0/" },
          categorymembers: Array.from({ length: 12 }, (_, i) => ({
            pageid: i + 1, title: "News " + (i + 1),
          })),
        } }));
      }
      parsedIds.push(Number(params.get("pageid")));
      return new Response(JSON.stringify(data()));
    });
    const cached = Array.from({ length: 9 }, (_, i) => ({
      id: i === 8 ? "imported-id" : "wikinews-" + (i + 1),
      url: "https://en.wikinews.org/?curid=" + (i + 1),
    }));
    const articles = await new NewsService(fetcher).refresh(
      new AbortController().signal, cached,
    );
    expect(articles.map((a) => a.id).sort()).toEqual([
      "wikinews-10", "wikinews-11", "wikinews-12",
    ]);
    expect(parsedIds).toEqual([10, 11, 12]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("treats an entirely cached list as no new articles without fetching bodies", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ query: {
      rightsinfo: { url: "https://creativecommons.org/licenses/by/4.0/" },
      categorymembers: [{ pageid: 12, title: "Cached" }],
    } })));
    await expect(new NewsService(fetcher).refresh(new AbortController().signal, [
      { id: "wikinews-12", url: "https://en.wikinews.org/?curid=12" },
    ])).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("deduplicates candidates and checks the bounded candidate window despite filtered early results", async () => {
    const parsedIds: string[] = [];
    const fetcher = async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get("action") === "query") return new Response(JSON.stringify({ query: {
        rightsinfo: { url: "https://creativecommons.org/licenses/by/4.0/" },
        categorymembers: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((pageid) => ({
          pageid, title: "Old news",
        })),
      } }));
      parsedIds.push(params.get("pageid")!);
      return new Response(JSON.stringify(data(new Date("2001-01-01"))));
    };
    await expect(new NewsService(fetcher).refresh(
      new AbortController().signal,
    )).resolves.toEqual([]);
    expect(parsedIds).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  });

  it("refuses to fetch content when source license is missing or unsupported", async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            query: {
              categorymembers: [{ pageid: 1, title: "unknown" }],
              rightsinfo: { url: "https://example.com/proprietary" },
            },
          }),
        ),
    );
    await expect(
      new NewsService(f).refresh(new AbortController().signal),
    ).rejects.toThrow("许可");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("cancels requests without returning generated fallback content", async () => {
    const c = new AbortController();
    const fetcher = async (_url: string, opts?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const result = new NewsService(fetcher).refresh(c.signal);
    c.abort();
    await expect(result).rejects.toThrow("aborted");
  });
  it("uses compatible API and limits the answer without live paid calls", async () => {
    const f = vi.fn(async (_url: string, opts?: RequestInit) => {
      expect(opts?.headers).toHaveProperty(
        "Authorization",
        "Bearer test-secret",
      );
      const b = JSON.parse(opts!.body as string);
      expect(b.model).toBe("deepseek-chat");
      expect(b.max_tokens).toBe(1800);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "fixture explanation" } }],
        }),
      );
    });
    expect(
      await callAI(
        defaults.models.context,
        "test-secret",
        "context",
        "truth",
        "It is a truth.",
        new AbortController().signal,
        f,
      ),
    ).toBe("fixture explanation");
    expect(f.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });
  it("blocks missing keys and reports HTTP errors without leaking response bodies", async () => {
    await expect(
      callAI(
        defaults.models.context,
        "",
        "context",
        "truth",
        "",
        new AbortController().signal,
      ),
    ).rejects.toThrow("未配置");
    const f = async () =>
      new Response("test-secret should never be surfaced", { status: 401 });
    await expect(
      callAI(
        defaults.models.context,
        "test-secret",
        "context",
        "truth",
        "",
        new AbortController().signal,
        f,
      ),
    ).rejects.toThrow("HTTP 401");
  });
});
