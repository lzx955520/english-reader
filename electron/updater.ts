import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { UpdateStatus } from "../src/types";

// Fixed public channel approved by the owner. No release is a recoverable, explicit status.
export const UPDATE_CHANNEL_ENABLED = true;
export const UPDATE_REPOSITORY = "lzx955520/english-reader";
const root = "https://github.com/" + UPDATE_REPOSITORY + "/releases/download/";
export const UPDATE_MANIFEST_URL = "https://github.com/" + UPDATE_REPOSITORY + "/releases/latest/download/update-manifest.json";
const CACHE_MS = 5 * 60 * 1000;
class RequestLimit extends Error {
  constructor(public until: number) { super("GitHub 请求受限，请等待冷却结束后手动重试。"); }
}
function retryTime(response: Response, now: number): number {
  const retry = response.headers.get("retry-after");
  const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
  const after = Number.isFinite(seconds) ? now + seconds * 1000 : retry ? Date.parse(retry) : NaN;
  const reset = response.headers.get("x-ratelimit-reset");
  const resetAt = reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : NaN;
  return Math.max(now + 60_000, Number.isFinite(after) ? after : 0,
    response.headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(resetAt) ? resetAt : 0);
}
const MAX_INSTALLER = 512 * 1024 * 1024;
const MAX_JSON = 256 * 1024;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Installer = { name: string; size: number; sha256: string };
type Candidate = { version: string; installer: Installer; url: string };

export function stableVersion(value: unknown): number[] {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value))
    throw Error("版本格式无效");
  return value.split(".").map(Number);
}
export function isNewer(version: string, current: string): boolean {
  const a = stableVersion(version), b = stableVersion(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function validateManifest(value: any, version: string): Installer {
  stableVersion(version);
  const expected = "English-Reader-" + version + "-x64-Setup.exe";
  if (!value || value.schemaVersion !== 1 || value.version !== version ||
      value.platform !== "win32" || value.arch !== "x64" ||
      value.installer?.name !== expected ||
      !Number.isSafeInteger(value.installer.size) ||
      value.installer.size <= 0 || value.installer.size > MAX_INSTALLER ||
      typeof value.installer.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.installer.sha256))
    throw Error("更新清单不匹配或不完整");
  return { name: expected, size: value.installer.size, sha256: value.installer.sha256 };
}
function allowedURL(value: string, initial: string): boolean {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return false;
  if (value === initial || u.hostname === "release-assets.githubusercontent.com") return true;
  // Only the documented latest-manifest redirect may move to a versioned GitHub asset.
  if (initial !== UPDATE_MANIFEST_URL || !value.startsWith(root) || u.search) return false;
  const tail = value.slice(root.length);
  const match = /^v([^/]+)\/update-manifest\.json$/.exec(tail);
  try { if (match) { stableVersion(match[1]); return true; } } catch { /* fail closed */ }
  return false;
}
async function request(fetcher: Fetcher, initial: string, signal: AbortSignal, now: () => number = Date.now): Promise<Response> {
  let url = initial;
  for (let i = 0; i < 5; i++) {
    signal.throwIfAborted();
    if (!allowedURL(url, initial)) throw Error("更新下载地址不可信");
    const response = await fetcher(url, {
      redirect: "manual", credentials: "omit", signal,
      headers: { Accept: "application/octet-stream", "User-Agent": "English-Reader-Update" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("更新下载重定向无效");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) await response.body?.cancel().catch(() => {});
    if (response.status === 404) throw Error("更新渠道尚未发布或不可访问");
    if (response.status === 429 || response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))
      throw new RequestLimit(retryTime(response, now()));
    if (response.status === 403) throw Error("GitHub 拒绝访问（403），请检查网络或稍后手动重试；这不一定是请求配额耗尽。");
    if (!response.ok) throw Error("更新服务暂不可用");
    return response;
  }
  throw Error("更新下载重定向过多");
}
async function chunks(response: Response, limit: number, signal: AbortSignal, consume: (bytes: Uint8Array) => Promise<void>) {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel().catch(() => {});
    throw Error("更新文件超过大小限制");
  }
  if (!response.body) throw Error("更新文件为空");
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw Error("更新文件超过大小限制");
      await consume(value);
    }
    signal.throwIfAborted();
    return total;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function json(fetcher: Fetcher, url: string, signal: AbortSignal, now: () => number) {
  const pieces: Buffer[] = [];
  await chunks(await request(fetcher, url, signal, now), MAX_JSON, signal, async b => { pieces.push(Buffer.from(b)); });
  return JSON.parse(Buffer.concat(pieces).toString("utf8"));
}
export class UpdateManager {
  private state: UpdateStatus;
  private candidate?: Candidate;
  private downloaded?: string;
  private controller?: AbortController;
  private generation = 0;
  private checkedAt?: number;
  private cached?: { state: UpdateStatus; candidate?: Candidate };
  private retryAt = 0;
  private now() { return this.options.now?.() ?? Date.now(); }
  private cooling() {
    if (this.now() >= this.retryAt) return false;
    this.state = { ...this.state, phase: "error", message: "GitHub 请求受限，请约 " + Math.ceil((this.retryAt - this.now()) / 1000) + " 秒后手动重试。" };
    return true;
  }
  constructor(private options: {
    currentVersion: string; platform: string; arch: string; directory: string;
    fetcher: Fetcher; reveal: (file: string) => void; enabled?: boolean; now?: () => number;
  }) {
    stableVersion(options.currentVersion);
    this.state = { currentVersion: options.currentVersion, phase: "idle",
      message: "仅在点击时检查更新，不会自动下载或安装。" };
  }
  status(): UpdateStatus { return { ...this.state }; }
  cancel() { this.controller?.abort(); }
  private async operation(phase: "checking" | "downloading", fn: (signal: AbortSignal) => Promise<void>) {
    if (this.controller) return this.status();
    const controller = new AbortController();
    this.controller = controller;
    this.generation++;
    const timer = setTimeout(() => controller.abort(), phase === "checking" ? 30000 : 10 * 60 * 1000);
    this.state = { ...this.state, phase, message: phase === "checking" ? "正在检查更新…" : "正在下载安装包…", received: 0 };
    try { await fn(controller.signal); }
    catch (e) {
      if (e instanceof RequestLimit) this.retryAt = e.until;
      this.state = { ...this.state, phase: controller.signal.aborted ? "cancelled" : "error",
        message: controller.signal.aborted ? "操作已取消或超时，可手动重试。" :
          e instanceof Error && /^(更新|GitHub|发布|版本)/.test(e.message) ? e.message :
            "更新失败，请检查网络或磁盘空间后手动重试。" };
    } finally { clearTimeout(timer); controller.abort(); this.controller = undefined; }
    return this.status();
  }
  async check() {
    if (this.controller || this.cooling()) return this.status();
    if (this.cached && this.checkedAt !== undefined && this.now() - this.checkedAt >= 0 && this.now() - this.checkedAt < CACHE_MS) {
      if (this.state.phase === "downloaded") return this.status();
      this.candidate = this.cached.candidate;
      this.state = { ...this.cached.state, message: this.cached.state.message + "（使用 5 分钟内的检查结果）" };
      return this.status();
    }
    this.generation++;
    this.candidate = undefined;
    // Do not delete a verified prior download until a new download is requested.
    this.state = { currentVersion: this.options.currentVersion, phase: "idle", message: "" };
    if (!(this.options.enabled ?? UPDATE_CHANNEL_ENABLED)) {
      this.state = { ...this.state, phase: "unpublished", message: "公开更新渠道尚未发布。此版本已准备更新入口，暂不能在线升级。" };
      return this.status();
    }
    if (this.options.platform !== "win32" || this.options.arch !== "x64") {
      this.state = { ...this.state, phase: "unsupported", message: "当前更新渠道仅支持 Windows x64 安装版。" };
      return this.status();
    }
    return this.operation("checking", async signal => {
      // Public release asset metadata avoids anonymous REST API quota entirely.
      // Never fall back to another origin after access denial or rate limiting.
      const latest = await json(this.options.fetcher, UPDATE_MANIFEST_URL, signal, () => this.now());
      const version = latest?.version;
      const advertised = validateManifest(latest, version);
      const pinnedURL = root + "v" + version + "/update-manifest.json";
      const installer = validateManifest(await json(this.options.fetcher, pinnedURL, signal, () => this.now()), version);
      if (JSON.stringify(advertised) !== JSON.stringify(installer)) throw Error("更新清单在检查期间发生变化，请稍后重试");
      signal.throwIfAborted();
      if (!isNewer(version, this.options.currentVersion)) {
        this.state = { ...this.state, phase: "current", message: "没有可用的更高稳定版本。" };
        this.checkedAt = this.now(); this.cached = { state: { ...this.state } };
        return;
      }
      this.candidate = { version, installer, url: root + "v" + version + "/" + installer.name };
      this.state = { ...this.state, phase: "available", latestVersion: version, total: installer.size,
        message: "发现新版本。下载安装包后需由你在文件夹中手动运行；不会自动安装。" };
      this.checkedAt = this.now(); this.cached = { state: { ...this.state }, candidate: this.candidate };
    });
  }
  async download() {
    if (this.controller || this.cooling()) return this.status();
    if (this.state.phase === "downloaded") return this.status();
    const candidate = this.candidate;
    if (!candidate) return this.status();
    return this.operation("downloading", async signal => {
      const previousDownload = this.downloaded;
      this.downloaded = undefined;
      await fs.mkdir(this.options.directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.options.directory, randomUUID() + ".part");
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      let destination: string | undefined;
      let published = false;
      try {
        handle = await fs.open(temporary, "wx", 0o600);
        const hash = createHash("sha256");
        const response = await request(this.options.fetcher, candidate.url, signal, () => this.now());
        const total = await chunks(response, candidate.installer.size, signal, async bytes => {
          hash.update(bytes);
          await handle!.writeFile(bytes);
          this.state = { ...this.state, received: (this.state.received || 0) + bytes.byteLength };
        });
        if (total !== candidate.installer.size || hash.digest("hex") !== candidate.installer.sha256)
          throw Error("更新文件完整性校验失败，未保留安装包");
        await handle.sync(); await handle.close(); handle = undefined;
        signal.throwIfAborted();
        // Unique private subdirectory avoids collisions, arbitrary paths, and replacing an existing file.
        destination = await fs.mkdtemp(path.join(this.options.directory, "verified-"));
        signal.throwIfAborted();
        const file = path.join(destination, candidate.installer.name);
        await fs.rename(temporary, file);
        signal.throwIfAborted();
        this.downloaded = file;
        published = true;
        this.state = { ...this.state, phase: "downloaded",
          message: "下载并通过 SHA-256 校验。安装包未签名；校验不能独立证明发布者身份。请先完整备份，再在文件夹中手动运行安装包，遵循 Windows 安全提示。" };
        if (previousDownload) {
          // Only the manager's own prior cache entry; never a user-selected path.
          await fs.rm(path.dirname(previousDownload), { recursive: true, force: true }).catch(() => {});
        }
      } finally {
        await handle?.close().catch(() => {});
        if (destination && !published) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
  }
  async reveal() {
    if (this.controller || !this.downloaded || this.state.phase !== "downloaded") return false;
    const file = this.downloaded, generation = this.generation;
    const info = await fs.lstat(file).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || this.controller ||
        generation !== this.generation || file !== this.downloaded || this.state.phase !== "downloaded") return false;
    this.options.reveal(file);
    return true;
  }
}
