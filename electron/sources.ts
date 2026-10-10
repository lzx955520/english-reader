import { load } from "cheerio";
import { createHash } from "node:crypto";
import { analyze, rank } from "./domain";
import { boundedText, NewsService, type Fetcher } from "./network";
import type { Article, SourceDiagnostic } from "../src/types";

export const readingSources = [
  { id: "nih", name: "NIH Research Matters", feed: "https://www.nih.gov/nih-research-matters/feed.xml", host: "www.nih.gov",
    license: "Public domain unless otherwise noted", licenseUrl: "https://www.nih.gov/about-nih/frequently-asked-questions",
    paths: ["/news-events/nih-research-matters/", "/nih-research-matters/"] },
  { id: "nsf", name: "NSF News", feed: "https://www.nsf.gov/rss/rss_www_news.xml", host: "www.nsf.gov",
    license: "Public domain unless otherwise noted", licenseUrl: "https://www.nsf.gov/policies/digital",
    paths: ["/news/", "/science-matters/"] },
  { id: "globalvoices", name: "Global Voices", feed: "https://globalvoices.org/feed/", host: "globalvoices.org",
    license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", paths: ["/20"] },
] as const;
type Source = typeof readingSources[number];
type Candidate = { url: string; title: string; published: string; author: string };
export function canonicalUrl(raw: string) {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (k !== "curid") u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}
function allowed(raw: string, source: Source) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === source.host && !u.username && !u.password &&
      source.paths.some(p => u.pathname.startsWith(p)) && !u.pathname.startsWith("/news/releases");
  } catch { return false; }
}
export function parseFeed(xml: string, source: Source): Candidate[] {
  const $ = load(xml, { xmlMode: true });
  if (!$("rss, feed").length) throw Error("来源返回的内容不是 RSS/Atom");
  return $("item, entry").slice(0, 18).toArray().flatMap(el => {
    const item = $(el);
    const link = item.find('link[rel="alternate"]').first().length ? item.find('link[rel="alternate"]').first() : item.find("link").first();
    const raw = link.attr("href") || link.text().trim();
    if (!allowed(raw, source)) return [];
    const date = item.find("pubDate").first().text() || item.find("published").first().text() ||
      item.find("dc\\:date, date").first().text() || item.find("updated").first().text();
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return [];
    return [{ url: canonicalUrl(raw), title: item.find("title").first().text().trim().slice(0,500),
      published: new Date(timestamp).toISOString(), author: item.find("creator, author, dc\\:creator").first().text().trim().slice(0,300) }];
  });
}
export function parseSourceArticle(html: string, item: Candidate, source: Source, now = new Date()): Article | null {
  const age = now.getTime() - Date.parse(item.published);
  if (!Number.isFinite(age) || age < -86400000 || age > 180 * 86400000 || !item.title) return null;
  const $ = load(html);
  $("script,style,nav,figure,img,video,audio,form,.caption,.field--name-field-image").remove();
  const root = $(".field--name-body, .entry-content, .article-body, .node__content").first();
  const body = root.length ? root : $("article").first().length ? $("article").first() : $("main").first();
  if (!body.length) return null; // Never fall back to the entire navigation/footer document.
  // Inspect article-scoped credit/aside notices before removing them from reading text.
  const content = body.text();
  // Conservative rights gate: no third-party or specifically copyrighted article text.
  if (/©|all rights reserved|copyright (?:20|19)|reprinted (?:with|from)|republished (?:with|from)|originally published (?:by|on|in)|syndicated from/i.test(content)) return null;
  body.find("aside,footer,.credit").remove();
  const paragraphs: string[] = [];
  let stopped = false;
  body.find("h2,h3,h4,p").each((_, el) => {
    const t = $(el).text().replace(/\s+/g," ").trim();
    if (/^(?:Related Links|References|Funding|Media Contacts?|Related Stories|Read more|Support our work)\b/i.test(t)) stopped = true;
    if (!stopped && el.tagName === "p" && t.length >= 40 && !/^(?:Image|Photo|Credit|Last reviewed|Last updated):/i.test(t)) paragraphs.push(t);
  });
  const text = paragraphs.join("\n\n"), metrics = analyze(text);
  if (metrics.words < 100 || metrics.words > 6000 || text.length > 100000) return null;
  const author = item.author || $('meta[name="author"]').attr("content")?.trim() || "";
  if (source.id === "globalvoices" && !author) return null;
  return { id: source.id + "-" + createHash("sha256").update(item.url).digest("hex").slice(0,24),
    title: item.title, source: source.name, url: item.url, published: item.published.slice(0,10),
    fetchedAt: now.toISOString(), kind: "news", license: source.license, licenseUrl: source.licenseUrl,
    author: author.slice(0,300) || source.name, text, ...metrics, progress: 0, position: 0 };
}
export class MultiSourceNews {
  diagnostics: SourceDiagnostic[] = [];
  constructor(private fetcher: Fetcher = fetch) {}
  async refresh(signal: AbortSignal, cached: ReadonlyArray<Pick<Article,"id"|"url">> = []) {
    signal.throwIfAborted();
    const wiki = new NewsService(this.fetcher);
    const wikiReport: SourceDiagnostic = { id:"wikinews",name:"Wikinews",url:"https://en.wikinews.org/",status:"failed",
      lastAttempt:new Date().toISOString(),lastSuccess:"",candidates:0,added:0,duplicates:0,filtered:0,failures:0,cached:0,message:"" };
    const reports = [wikiReport, ...readingSources.map(source => ({
      id:source.id,name:source.name,url:source.feed,status:"no-new" as SourceDiagnostic["status"],
      lastAttempt:new Date().toISOString(),lastSuccess:"",candidates:0,added:0,duplicates:0,filtered:0,failures:0,
      cached:cached.filter(a=>a.id.startsWith(source.id+"-")).length,message:"",
    }))];
    this.diagnostics = reports;
    const cachedUrls = new Set(cached.map(a => { try { return canonicalUrl(a.url); } catch { return a.url; } }));
    const get = async (url:string, timeout:AbortSignal, source?:Source) => {
      const host = new URL(url).hostname;
      for (let hop=0;hop<4;hop++) {
        const response = await this.fetcher(url,{
          signal:AbortSignal.any([signal,timeout,AbortSignal.timeout(15000)]),
          redirect:"manual",headers:{"User-Agent":"EnglishReader/0.2 (noncommercial reading app)"},
        });
        if ([301,302,303,307,308].includes(response.status)) {
          const location=response.headers.get("location");
          await response.body?.cancel();
          if (!location) throw Error("来源重定向缺少地址");
          const target=new URL(location,url);
          if(target.protocol!=="https:" || target.hostname!==host || target.username || target.password || (source && !allowed(target.toString(),source)))
            throw Error("来源重定向离开已核实站点");
          url=target.toString(); continue;
        }
        return boundedText(response);
      }
      throw Error("来源重定向次数过多");
    };
    const jobs = [
      (async () => {
        try {
          const result = await wiki.refresh(AbortSignal.any([signal,AbortSignal.timeout(60000)]),cached);
          Object.assign(wikiReport,wiki.diagnostics[0]);
          return result;
        } catch(e) {
          Object.assign(wikiReport,wiki.diagnostics[0]);
          wikiReport.added=wiki.partialArticles.length;
          wikiReport.status=wikiReport.added ? "updated" : "failed";
          if(wikiReport.added) wikiReport.lastSuccess=new Date().toISOString();
          wikiReport.failures=Math.max(1,wikiReport.failures);
          wikiReport.message=e instanceof Error ? e.message : "连接失败";
          return wiki.partialArticles;
        }
      })(),
      ...readingSources.map(async (source,i) => {
        const report=reports[i+1], articles:Article[]=[];
        const timeout=AbortSignal.timeout(60000);
        try {
          const xml=await get(source.feed,timeout);
          const candidates=parseFeed(xml,source);
          report.candidates=load(xml,{xmlMode:true})("item, entry").length;
          report.filtered=Math.max(0, Math.min(18,report.candidates)-candidates.length);
          const seen=new Set(cachedUrls);
          let attempted=0;
          for (const item of candidates) {
            signal.throwIfAborted(); timeout.throwIfAborted();
            if (seen.has(item.url)) { report.duplicates++; continue; }
            seen.add(item.url);
            if (attempted++ >= 6 || articles.length>=3) break;
            try {
              const a=parseSourceArticle(await get(item.url,timeout,source),item,source);
              if(a) articles.push(a); else report.filtered++;
            } catch(e) { if(signal.aborted) throw e; report.failures++; }
          }
          report.added=articles.length;
          report.status=articles.length ? "updated" : report.failures ? "failed" : report.filtered ? "filtered" : "no-new";
          if(report.status!=="failed") report.lastSuccess=new Date().toISOString();
          report.message=report.failures ? "部分正文连接或解析失败；缓存仍可读" : report.filtered ? "日期、授权标记或正文长度检查未通过；难度不拒收" : candidates.length ? "" : "订阅源没有可用的带日期文章链接";
        } catch(e) {
          report.added=articles.length;
          report.status=articles.length ? "updated" : "failed";
          if(articles.length) report.lastSuccess=new Date().toISOString();
          report.failures++;
          report.message=e instanceof Error ? e.message : "连接失败";
        }
        return articles;
      }),
    ];
    const batches=await Promise.all(jobs);
    signal.throwIfAborted();
    if(reports.every(r=>r.status==="failed")) throw Error("所有来源连接或正文获取失败，保留已有缓存；可逐源查看详情后重试");
    // Round-robin makes each successful source visible before any one source dominates.
    const result:Article[]=[]; const seen=new Set(cachedUrls);
    for(let i=0;i<3;i++) for(const batch of batches) {
      const a=rank(batch)[i];
      if(a && !seen.has(canonicalUrl(a.url))) {seen.add(canonicalUrl(a.url));result.push(a);}
    }
    return result;
  }
}
