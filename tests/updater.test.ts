import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { UpdateManager, stableVersion, isNewer, validateManifest, UPDATE_REPOSITORY, UPDATE_MANIFEST_URL } from "../electron/updater";

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }); });
const payload = Buffer.from("mock installer bytes, never executed");
const digest = createHash("sha256").update(payload).digest("hex");
const version = "0.4.0";
const name = "English-Reader-" + version + "-x64-Setup.exe";
const root = "https://github.com/" + UPDATE_REPOSITORY + "/releases/download/v" + version + "/";
const manifest = { schemaVersion: 1, version, platform: "win32", arch: "x64", installer: { name, size: payload.length, sha256: digest } };
async function fixture(overrides: Record<string, unknown> = {}, fetchOverride?: (url: string, init?: RequestInit) => Promise<Response>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "reader-update-test-"));
  folders.push(directory);
  const reveal = vi.fn();
  const fetcher = vi.fn(fetchOverride || (async (url: string) => {
    if (url.endsWith(".json")) return Response.json(manifest);
    return new Response(new Uint8Array(payload));
  }));
  const manager = new UpdateManager({
    currentVersion: "0.3.0", platform: "win32", arch: "x64", directory, reveal, fetcher, enabled: true,
    ...overrides,
  });
  return { manager, directory, reveal, fetcher };
}
describe("manual update trust boundary", () => {
  it("accepts stable semver only and never downgrades", () => {
    for (const bad of ["v1.2.3", "01.2.3", "1.2.3-beta", "../1.2.3", "1.2", "", "1000000.1.1"])
      expect(() => stableVersion(bad)).toThrow();
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  });
  it("rejects wrong architecture, filename, size and digest", () => {
    for (const changed of [
      { ...manifest, arch: "arm64" }, { ...manifest, version: "0.5.0" },
      ...[{ name: "../evil.exe" }, { size: 0 }, { size: 600 * 1024 * 1024 }, { size: 1.5 }, { sha256: "oops" }]
        .map(fields => ({ ...manifest, installer: { ...manifest.installer, ...fields } })),
    ]) expect(() => validateManifest(changed, version)).toThrow();
  });
  it("unpublished configuration never contacts the network", async () => {
    const { manager, fetcher } = await fixture({ enabled: false });
    expect((await manager.check()).phase).toBe("unpublished");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await manager.reveal()).toBe(false);
  });
  it("unsupported platforms do not contact the channel", async () => {
    const { manager, fetcher } = await fixture({ platform: "linux" });
    expect((await manager.check()).phase).toBe("unsupported");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("404 is an honest unpublished/error result rather than up-to-date", async () => {
    const { manager } = await fixture({}, async () => new Response("", { status: 404 }));
    expect((await manager.check()).message).toContain("尚未发布");
    expect(manager.status().phase).toBe("error");
  });
  it("rejects malformed versions and never offers equal or lower releases", async () => {
    for (const bad of ["0.4.0-beta", "../0.4.0", undefined]) {
      const { manager } = await fixture({}, async () => Response.json({ ...manifest, version: bad }));
      expect((await manager.check()).phase).toBe("error");
    }
    for (const currentVersion of [version, "0.5.0"]) {
      const { manager } = await fixture({ currentVersion });
      expect((await manager.check()).phase).toBe("current");
    }
  });
  it("rejects a latest/pinned manifest mismatch", async () => {
    const { manager } = await fixture({}, async url => Response.json(url === UPDATE_MANIFEST_URL ? manifest :
      { ...manifest, installer: { ...manifest.installer, sha256: "a".repeat(64) } }));
    expect((await manager.check()).phase).toBe("error");
  });
  it("rejects off-host and insecure redirects before fetching them", async () => {
    for (const location of ["https://evil.invalid/file", "http://release-assets.githubusercontent.com/file", "https://user:pass@release-assets.githubusercontent.com/file"]) {
      const { manager, fetcher } = await fixture({}, async () => new Response("", { status: 302, headers: { location } }));
      expect((await manager.check()).phase).toBe("error");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("limits metadata size even when content-length is missing", async () => {
    const { manager } = await fixture({}, async () => new Response("x".repeat(256 * 1024 + 1)));
    expect((await manager.check()).phase).toBe("error");
  });
  it("checks first, downloads only on explicit action, then reveals without executing", async () => {
    const { manager, fetcher, reveal } = await fixture();
    expect((await manager.download()).phase).toBe("idle");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await manager.check()).phase).toBe("available");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(reveal).not.toHaveBeenCalled();
    expect((await manager.download()).phase).toBe("downloaded");
    expect(reveal).not.toHaveBeenCalled();
    expect(await manager.reveal()).toBe(true);
    expect(await fs.readFile(reveal.mock.calls[0][0])).toEqual(payload);
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.credentials).toBe("omit");
      expect(call[1]?.redirect).toBe("manual");
      expect(JSON.stringify(call[1]?.headers)).not.toContain("Authorization");
    }
  });
  it("deletes partial or corrupt files and never reveals them", async () => {
    for (const bad of [Buffer.from("bad"), Buffer.alloc(payload.length, 1), Buffer.alloc(payload.length + 1)]) {
      const { manager, directory, reveal } = await fixture({}, async url =>
        url.endsWith(".json") ? Response.json(manifest) : new Response(new Uint8Array(bad)));
      await manager.check();
      expect((await manager.download()).phase).toBe("error");
      expect(await fs.readdir(directory)).toEqual([]);
      expect(await manager.reveal()).toBe(false);
      expect(reveal).not.toHaveBeenCalled();
    }
  });
  it("deduplicates clicks and handles cancellation and explicit retry", async () => {
    let first = true;
    const { manager, fetcher } = await fixture({}, async (url, init) => {
      if (first) {
        first = false;
        return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(Error("cancelled")), { once: true }));
      }
      return Response.json(manifest);
    });
    const pending = manager.check();
    expect((await manager.check()).phase).toBe("checking");
    expect(fetcher).toHaveBeenCalledTimes(1);
    manager.cancel();
    expect((await pending).phase).toBe("cancelled");
    expect((await manager.check()).phase).toBe("available");
  });
  it("cleans up a cancelled download", async () => {
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const { manager, directory } = await fixture({}, async (url, init) => {
        if (url.endsWith(".json")) return Response.json(manifest);
      started();
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(Error("cancelled")), { once: true }));
    });
    await manager.check();
    const downloading = manager.download();
    await began;
    expect((await manager.download()).phase).toBe("downloading");
    manager.cancel();
    expect((await downloading).phase).toBe("cancelled");
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it("does not reveal missing or symlinked installer files", async () => {
    const { manager, reveal } = await fixture();
    await manager.check(); await manager.download(); await manager.reveal();
    const file = reveal.mock.calls[0][0];
    await fs.rm(file);
    expect(await manager.reveal()).toBe(false);
  });
});

it("cancellation during final rename removes the uncommitted verified directory", async () => {
  const { manager, directory } = await fixture();
  await manager.check();
  const original = fs.rename;
  const spy = vi.spyOn(fs, "rename").mockImplementationOnce(async (from, to) => {
    await original(from, to);
    manager.cancel();
  });
  try {
    expect((await manager.download()).phase).toBe("cancelled");
    expect(await fs.readdir(directory)).toEqual([]);
    expect(await manager.reveal()).toBe(false);
  } finally { spy.mockRestore(); }
});
it("failed network checks are retryable without automatic retries", async () => {
  const { manager, fetcher } = await fixture({}, async () => { throw Error("network failed"); });
  expect((await manager.check()).phase).toBe("error");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await manager.check()).phase).toBe("error");
  expect(fetcher).toHaveBeenCalledTimes(2);
});


describe("public metadata, cache and rate-limit handling", () => {
  it("uses documented public assets only, caches success for five minutes", async () => {
    let now = 1000;
    const { manager, fetcher } = await fixture({ now: () => now });
    await manager.check();
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([UPDATE_MANIFEST_URL, root + "update-manifest.json"]);
    expect((await manager.check()).message).toContain("5 分钟");
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 300000;
    await manager.check();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("follows only a stable manifest redirect within this publisher", async () => {
    const { manager } = await fixture({}, async url => url === UPDATE_MANIFEST_URL ?
      new Response(null, { status: 302, headers: { location: root + "update-manifest.json" } }) : Response.json(manifest));
    expect((await manager.check()).phase).toBe("available");
    for (const location of [root.replace(UPDATE_REPOSITORY, "other/repo") + "update-manifest.json",
      root + name, root.replace("v0.4.0", "v0.4.0-beta") + "update-manifest.json", root + "update-manifest.json?x=1"]) {
      const { manager, fetcher } = await fixture({}, async () => new Response(null, { status: 302, headers: { location } }));
      expect((await manager.check()).phase).toBe("error");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    [429, { "retry-after": "120" }, 120000],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1300" }, 300000],
    [429, { "retry-after": new Date(1120000).toUTCString() }, 120000],
    [429, { "retry-after": "bad", "x-ratelimit-reset": "bad" }, 60000],
    [429, { "retry-after": "0" }, 60000],
  ])("honors %s rate cooldown without retrying or alternate endpoints", async (status, headers, duration) => {
    let now = 1000000;
    const { manager, fetcher } = await fixture({ now: () => now }, async () => new Response(null, { status, headers: headers as Record<string,string> }));
    expect((await manager.check()).message).toContain("受限");
    now += duration - 1;
    await manager.check(); await manager.download();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now++;
    await manager.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not claim a bare 403 proves quota exhaustion", async () => {
    const { manager, fetcher } = await fixture({}, async () => new Response(null, { status: 403 }));
    expect((await manager.check()).message).toContain("不一定");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not cache malformed metadata or cancellation", async () => {
    const { manager, fetcher } = await fixture({}, async () => Response.json({ ...manifest, installer: { ...manifest.installer, size: -1 } }));
    await manager.check(); await manager.check();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await manager.download()).phase).toBe("error");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps an already verified download revealable on a cached check", async () => {
    const { manager } = await fixture();
    await manager.check(); await manager.download();
    expect((await manager.check()).phase).toBe("downloaded");
    expect(await manager.reveal()).toBe(true);
  });
});

it("starts relative Retry-After when the response arrives, not before a slow request", async () => {
  let now = 1000000;
  const { manager, fetcher } = await fixture({ now: () => now }, async () => {
    now += 20000;
    return new Response(null, { status: 429, headers: { "retry-after": "120" } });
  });
  await manager.check();
  now += 119999;
  await manager.check();
  expect(fetcher).toHaveBeenCalledTimes(1);
  now++;
  await manager.check();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
