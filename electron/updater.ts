import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { UpdateStatus } from "../src/types";

// Fixed public channel approved by the owner. No release is a recoverable, explicit status.
export const UPDATE_CHANNEL_ENABLED = true;
export const UPDATE_REPOSITORY = "lzx955520/english-reader";
const root = "https://github.com/" + UPDATE_REPOSITORY + "/releases/download/";
const api = "https://api.github.com/repos/" + UPDATE_REPOSITORY + "/releases/latest";
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
  return value === initial || u.hostname === "release-assets.githubusercontent.com";
}
async function request(fetcher: Fetcher, initial: string, signal: AbortSignal): Promise<Response> {
  let url = initial;
  for (let i = 0; i < 5; i++) {
    signal.throwIfAborted();
    if (!allowedURL(url, initial)) throw Error("更新下载地址不可信");
    const response = await fetcher(url, {
      redirect: "manual", credentials: "omit", signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "English-Reader-Update" },
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
    if (response.status === 403 || response.status === 429) throw Error("GitHub 请求受限，请稍后手动重试");
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
async function json(fetcher: Fetcher, url: string, signal: AbortSignal) {
  const pieces: Buffer[] = [];
  await chunks(await request(fetcher, url, signal), MAX_JSON, signal, async b => { pieces.push(Buffer.from(b)); });
  return JSON.parse(Buffer.concat(pieces).toString("utf8"));
}
function asset(release: any, name: string, tag: string) {
  const matches = release.assets?.filter((a: any) => a.name === name);
  const expected = root + tag + "/" + name;
  if (!Array.isArray(matches) || matches.length !== 1 ||
      matches[0].browser_download_url !== expected ||
      !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0)
    throw Error("发布附件不匹配");
  return matches[0];
}
export class UpdateManager {
  private state: UpdateStatus;
  private candidate?: Candidate;
  private downloaded?: string;
  private controller?: AbortController;
  private generation = 0;
  constructor(private options: {
    currentVersion: string; platform: string; arch: string; directory: string;
    fetcher: Fetcher; reveal: (file: string) => void; enabled?: boolean;
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
      this.state = { ...this.state, phase: controller.signal.aborted ? "cancelled" : "error",
        message: controller.signal.aborted ? "操作已取消或超时，可手动重试。" :
          e instanceof Error && /^(更新|GitHub|发布|版本)/.test(e.message) ? e.message :
            "更新失败，请检查网络或磁盘空间后手动重试。" };
    } finally { clearTimeout(timer); controller.abort(); this.controller = undefined; }
    return this.status();
  }
  async check() {
    if (this.controller) return this.status();
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
      const release = await json(this.options.fetcher, api, signal);
      if (!release || release.draft !== false || release.prerelease !== false ||
          typeof release.tag_name !== "string" || !release.tag_name.startsWith("v"))
        throw Error("发布版本无效");
      const version = release.tag_name.slice(1);
      stableVersion(version);
      if (!isNewer(version, this.options.currentVersion)) {
        this.state = { ...this.state, phase: "current", message: "没有可用的更高稳定版本。" };
        return;
      }
      const manifestAsset = asset(release, "update-manifest.json", release.tag_name);
      if (manifestAsset.size > MAX_JSON) throw Error("更新清单过大");
      const installer = validateManifest(await json(this.options.fetcher, manifestAsset.browser_download_url, signal), version);
      const installerAsset = asset(release, installer.name, release.tag_name);
      if (installerAsset.size !== installer.size) throw Error("更新附件大小不匹配");
      signal.throwIfAborted();
      this.candidate = { version, installer, url: installerAsset.browser_download_url };
      this.state = { ...this.state, phase: "available", latestVersion: version, total: installer.size,
        message: "发现新版本。下载安装包后需由你在文件夹中手动运行；不会自动安装。" };
    });
  }
  async download() {
    if (this.controller) return this.status();
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
        const response = await request(this.options.fetcher, candidate.url, signal);
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
