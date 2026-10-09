import { it, expect, vi } from "vitest";
import { RefreshManager } from "../electron/refresh";
function cache() {
  let lastRefresh = "";
  return {
    state: () => ({
      lastRefresh,
      articles: [{ id: "wikinews-12", url: "https://en.wikinews.org/?curid=12" }],
    }),
    addArticles: vi.fn(() => {
      lastRefresh = "2026-10-09";
      return 1;
    }),
    refreshFailure: vi.fn(),
  };
}
it("skips a successful same-day refresh and updates after local day changes", async () => {
  const c = cache(),
    source = { refresh: vi.fn(async () => []) };
  let day = "2026-10-09";
  const manager = new RefreshManager(c, source, () => day);
  await manager.refresh();
  await manager.refresh();
  expect(source.refresh).toHaveBeenCalledTimes(1);
  expect(source.refresh).toHaveBeenCalledWith(
    expect.any(AbortSignal),
    c.state().articles,
  );
  day = "2026-10-10";
  await manager.refresh();
  expect(source.refresh).toHaveBeenCalledTimes(2);
});
it("coalesces duplicate update clicks into one cancellable operation", async () => {
  const c = cache();
  const source = {
    refresh: vi.fn(
      (signal: AbortSignal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(Error("cancel"))),
        ),
    ),
  };
  const manager = new RefreshManager(c, source);
  const first = manager.refresh(true),
    second = manager.refresh(true);
  expect(first).toBe(second);
  manager.cancel();
  expect(await first).toEqual({ added: 0, cancelled: true });
  expect(c.addArticles).not.toHaveBeenCalled();
  expect(c.refreshFailure).not.toHaveBeenCalled();
  expect(source.refresh).toHaveBeenCalledTimes(1);
});
it("preserves cache on failure and forces a retry when connectivity returns", async () => {
  const c = cache();
  let offline = true;
  const source = {
    refresh: vi.fn(async () => {
      if (offline) throw Error("offline");
      return [];
    }),
  };
  const manager = new RefreshManager(c, source);
  await manager.refresh();
  expect(c.state().lastRefresh).toBe("");
  expect(c.refreshFailure).toHaveBeenCalledWith(
    expect.stringContaining("offline"),
  );
  await manager.refresh();
  expect(source.refresh).toHaveBeenCalledTimes(1);
  offline = false;
  expect(await manager.refresh(true)).toEqual({ added: 1 });
  expect(c.state().lastRefresh).toBe("2026-10-09");
});
it("aborted source results cannot be committed even if the source ignores cancellation", async () => {
  const c = cache();
  let resolve!: (a: never[]) => void;
  const manager = new RefreshManager(c, {
    refresh: () => new Promise((r) => (resolve = r)),
  });
  const promise = manager.refresh();
  manager.cancel();
  resolve([]);
  expect((await promise).cancelled).toBe(true);
  expect(c.addArticles).not.toHaveBeenCalled();
});
