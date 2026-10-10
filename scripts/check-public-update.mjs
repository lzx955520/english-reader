import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Read-only public-release smoke: simulate an older version, never run an installer.
// The published tag/binaries remain unchanged. This is not an installed Windows upgrade.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "reader-public-update-"));
let manager;
try {
  const output = path.join(directory, "updater.cjs");
  await build({ entryPoints: ["electron/updater.ts"], outfile: output,
    platform: "node", target: "node24", format: "cjs", bundle: true, logLevel: "silent" });
  const { UpdateManager, UPDATE_REPOSITORY, UPDATE_CHANNEL_ENABLED } = createRequire(import.meta.url)(output);
  assert.equal(UPDATE_REPOSITORY, "lzx955520/english-reader");
  assert.equal(UPDATE_CHANNEL_ENABLED, true);
  let revealed;
  let requests = 0;
  const urls = [];
  manager = new UpdateManager({
    currentVersion: "0.3.1", platform: "win32", arch: "x64",
    directory: path.join(directory, "downloads"),
    fetcher: async (url, init) => {
      requests++;
      urls.push(url);
      assert.notEqual(new URL(url).hostname, "api.github.com");
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return fetch(url, init);
    },
    reveal: file => { revealed = file; }, // Record the path; no shell or executable launch.
  });
  assert.equal(requests, 0);
  const available = await manager.check();
  assert.equal(available.phase, "available", available.message);
  assert.equal(available.latestVersion, "0.3.2");
  assert.equal(available.total, 97992070);
  assert.equal(revealed, undefined);
  assert.ok(urls.includes("https://github.com/" + UPDATE_REPOSITORY + "/releases/latest/download/update-manifest.json"));
  assert.ok(urls.includes("https://github.com/" + UPDATE_REPOSITORY + "/releases/download/v0.3.2/update-manifest.json"));
  const checkedRequests = requests;
  assert.equal((await manager.check()).phase, "available");
  assert.equal(requests, checkedRequests, "cached checks must not make network requests");
  const downloaded = await manager.download();
  assert.equal(downloaded.phase, "downloaded", downloaded.message);
  assert.equal(revealed, undefined);
  assert.equal(await manager.reveal(), true);
  assert.equal(path.basename(revealed), "English-Reader-0.3.2-x64-Setup.exe");
  const bytes = await fs.readFile(revealed);
  assert.equal(bytes.length, 97992070);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "MZ");
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "931c0677ad397dcd8d0ab63be353ed8ee8cba3262a16388a0431f2d980d05ce8");
  console.log("Public update smoke passed: public latest and pinned manifests, cached check, installer download and pinned SHA-256.");
  console.log("Installer was not executed; this is not a real Windows installation or upgrade test.");
} finally {
  manager?.cancel();
  await fs.rm(directory, { recursive: true, force: true });
}
