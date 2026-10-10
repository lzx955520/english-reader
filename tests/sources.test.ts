import { describe, it, expect, vi } from "vitest";
import { MultiSourceNews, readingSources, parseFeed, parseSourceArticle, canonicalUrl } from "../electron/sources";
const now = new Date();
const paragraph = "These researchers carefully investigated environmental changes and discussed their observations with local communities. ";
const body = "<main><article><div class='field--name-body'><p>" + paragraph.repeat(15) + "</p><h2>References</h2><p>EXCLUDED reference text</p></div></article></main>";
const item = { url:"https://www.nih.gov/news-events/nih-research-matters/test", title:"Fixture only", published:now.toISOString(), author:"Fixture Author" };
function feed(url:string, author="Fixture Author") { return `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item><title>Fixture only</title><link>${url}</link><pubDate>${now.toUTCString()}</pubDate><dc:creator>${author}</dc:creator></item></channel></rss>`; }
describe("licensed source fixtures, not live reachability",()=>{
  it("parses independent metadata, canonical links and excludes unrelated hosts",()=>{
    const source=readingSources[0];
    const found=parseFeed(feed(item.url+"?utm_source=test#x"),source);
    expect(found[0].url).toBe(item.url);
    expect(found[0].author).toBe("Fixture Author");
    expect(parseFeed(feed("https://evil.example/article"),source)).toEqual([]);
    expect(canonicalUrl(item.url+"/?utm_campaign=a")).toBe(item.url);
  });
  it("keeps raw text and rejects dated, short and restricted material",()=>{
    const article=parseSourceArticle(body,item,readingSources[0],now)!;
    expect(article.text).not.toContain("EXCLUDED");
    expect(article.licenseUrl).toContain("nih.gov");
    expect(article.words).toBeGreaterThan(100);
    expect(parseSourceArticle(body,{...item,published:"2000-01-01"},readingSources[0],now)).toBeNull();
    expect(parseSourceArticle("<main><p>Short.</p></main>",item,readingSources[0],now)).toBeNull();
    expect(parseSourceArticle(body.replace("These","Copyright 2026 These"),item,readingSources[0],now)).toBeNull();
    expect(parseSourceArticle(body,{...item,author:""},readingSources[2],now)).toBeNull();
  });
  it("isolates a failed source, mixes successful sources, records cache/no-new",async()=>{
    const urls=[item.url,"https://www.nsf.gov/news/fixture","https://globalvoices.org/2026/10/10/fixture"];
    const fetcher=async(url:string)=>{
      if(url.includes("wikinews")) throw Error("offline fixture");
      const source=readingSources.findIndex(s=>s.feed===url);
      return new Response(source>=0 ? feed(urls[source]) : body);
    };
    const service=new MultiSourceNews(fetcher);
    const articles=await service.refresh(new AbortController().signal);
    expect(articles).toHaveLength(3);
    expect(new Set(articles.map(a=>a.source)).size).toBe(3);
    expect(service.diagnostics[0].status).toBe("failed");
    expect(service.diagnostics.slice(1).every(r=>r.status==="updated")).toBe(true);
    expect(await service.refresh(new AbortController().signal,articles)).toEqual([]);
    expect(service.diagnostics.slice(1).every(r=>r.status==="no-new" && r.duplicates===1)).toBe(true);
  });
  it("distinguishes filtering from connection failure",async()=>{
    const service=new MultiSourceNews(async url=>{
      if(url.includes("wikinews")) throw Error("offline");
      const source=readingSources.find(s=>s.feed===url);
      const urlFor=source?.id==="nih" ? item.url : source?.id==="nsf" ? "https://www.nsf.gov/news/fixture" : "https://globalvoices.org/2026/10/10/fixture";
      return new Response(source ? feed(urlFor) : "<main><p>Too short.</p></main>");
    });
    expect(await service.refresh(new AbortController().signal)).toEqual([]);
    expect(service.diagnostics.slice(1).every(r=>r.status==="filtered" && r.filtered===1)).toBe(true);
    await expect(new MultiSourceNews(async()=>{throw Error("offline");}).refresh(new AbortController().signal)).rejects.toThrow("所有来源");
  });
  it("never returns partial results after cancellation",async()=>{
    const c=new AbortController();c.abort();
    await expect(new MultiSourceNews().refresh(c.signal)).rejects.toThrow();
  });
});

it("retains completed articles when that source later times out", async () => {
  const deadline = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 60000 ? deadline.signal : new AbortController().signal);
  const urls = [1, 2, 3].map(n => item.url + n);
  const xml = `<rss><channel>${urls.map(url => `<item><title>Fixture only</title><link>${url}</link><pubDate>${now.toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
  const requested: string[] = [];
  const service = new MultiSourceNews(async url => {
    if (url === readingSources[0].feed) return new Response(xml);
    if (url === urls[0]) return new Response(body);
    if (url === urls[1]) { requested.push(url); deadline.abort(new DOMException("source timeout", "TimeoutError")); throw deadline.signal.reason; }
    if (url === urls[2]) requested.push(url);
    throw Error("offline fixture");
  });
  try {
    const result = await service.refresh(new AbortController().signal);
    expect(result.map(a => a.url)).toEqual([urls[0]]);
    expect(service.diagnostics[1]).toMatchObject({ status: "updated", added: 1 });
    expect(service.diagnostics[1].failures).toBeGreaterThan(0);
    expect(requested).toEqual([urls[1]]);
  } finally { timeout.mockRestore(); }
});
it("prefers original publication over update and chooses Atom alternate links",()=>{
  const xml=`<feed><entry><title>Fixture</title><link rel="self" href="https://example.org/api"/><link rel="alternate" href="${item.url}"/><updated>${now.toISOString()}</updated><published>2001-01-01T00:00:00Z</published><author>Fixture</author></entry></feed>`;
  const candidate=parseFeed(xml,readingSources[0])[0];
  expect(candidate.url).toBe(item.url);
  expect(candidate.published).toBe("2001-01-01T00:00:00.000Z");
  expect(parseSourceArticle(body,candidate,readingSources[0],now)).toBeNull();
});

it("rejects article-scoped third-party credit before cleanup",()=>{
  expect(parseSourceArticle(body.replace("<p>","<div class='credit'>Republished from Third Party</div><p>"),item,readingSources[0],now)).toBeNull();
});
it("rejects same-host article redirect outside approved path",async()=>{
  const service=new MultiSourceNews(async url=>{
    if(url===readingSources[0].feed) return new Response(feed(item.url));
    if(url===item.url) return new Response(null,{status:302,headers:{location:"https://www.nih.gov/unrelated/fixture"}});
    throw Error("offline fixture");
  });
  await expect(service.refresh(new AbortController().signal)).rejects.toThrow("所有来源");
  expect(service.diagnostics[1].failures).toBeGreaterThan(0);
});
