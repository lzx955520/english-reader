import type { Article } from "../src/types";
import { localDay } from "./domain";
interface Cache {
  state(): { lastRefresh: string; articles: Pick<Article, "id" | "url">[] };
  addArticles(articles: Article[]): number;
  refreshFailure(error: string): void;
}
interface Source {
  refresh(
    signal: AbortSignal,
    cached: ReadonlyArray<Pick<Article, "id" | "url">>,
  ): Promise<Article[]>;
}
export class RefreshManager {
  private active: Promise<{ added: number; cancelled?: boolean }> | null = null;
  private controller: AbortController | null = null;
  private retryAfter = 0;
  constructor(
    private cache: Cache,
    private source: Source,
    private day = () => localDay(),
    private clock = () => Date.now(),
  ) {}
  refresh(force = false): Promise<{ added: number; cancelled?: boolean }> {
    if (this.active) return this.active;
    if (
      !force &&
      (this.cache.state().lastRefresh === this.day() ||
        this.clock() < this.retryAfter)
    )
      return Promise.resolve({ added: 0 });
    const controller = new AbortController();
    this.controller = controller;
    this.active = (async () => {
      try {
        const articles = await this.source.refresh(
          controller.signal,
          this.cache.state().articles,
        );
        controller.signal.throwIfAborted();
        this.retryAfter = 0;
        return { added: this.cache.addArticles(articles) };
      } catch (e) {
        this.retryAfter = this.clock() + 10 * 60 * 1000;
        if (controller.signal.aborted) return { added: 0, cancelled: true };
        this.cache.refreshFailure(
          "无法更新新闻：" + (e instanceof Error ? e.message : "网络不可用"),
        );
        return { added: 0 };
      } finally {
        this.controller = null;
        this.active = null;
      }
    })();
    return this.active;
  }
  cancel() {
    this.controller?.abort();
  }
}
