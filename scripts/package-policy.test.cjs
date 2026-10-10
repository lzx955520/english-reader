const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const policy = require("./package-policy.cjs");
const { buildArtifacts } = require("./package-artifacts.cjs");
function fixture() {
  const names = [
    "dist/index.html", "dist/assets/index-123.js", "dist-electron/main.cjs", "dist-electron/preload.cjs",
    "assets/classics.json", "assets/dictionary.sqlite", "assets/dictionary-provenance.txt",
    "LICENSE", "licenses/ECDICT-MIT.txt", "licenses/GUTENBERG.txt",
    "node_modules/sql.js/LICENSE", "node_modules/sql.js/dist/sql-wasm.js", "node_modules/sql.js/dist/sql-wasm.wasm",
    "licenses/dependencies/sql.js_1.14.2.txt",
  ];
  const files = new Map(names.map(name => [name, Buffer.from("fixture")]));
  files.set("THIRD_PARTY_NOTICES.md", Buffer.from("- **sql.js@1.14.2** — MIT\n"));
  files.set("package.json", Buffer.from(JSON.stringify({
    name: "english-reader", version: "0.3.0", license: "MIT", main: "dist-electron/main.cjs", dependencies: { "sql.js": "1.14.2" },
  })));
  files.set("node_modules/sql.js/package.json", Buffer.from(JSON.stringify({
    name: "sql.js", version: "1.14.2", main: "dist/sql-wasm.js", license: "MIT",
  })));
  return files;
}
function temporary(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "reader-package-"));
  return Promise.resolve().then(() => fn(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}
function materialize(directory, entries) {
  for (const [name, bytes] of entries) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), bytes);
  }
}
test("runtime allowlist and required dependency notices", () => {
  assert.ok(policy.checkEntries(fixture()) > 0);
  assert.equal(policy.suspicious(Buffer.from("https://github.com/lzx955520/english-reader/releases")), false);
  for (const name of ["README.md", "docs/private.md", ".env", "dist/assets/index.js.map", "licenses/development.json", "reader.sqlite"]) {
    const files = fixture(); files.set(name, Buffer.from("fixture"));
    assert.throws(() => policy.checkEntries(files));
  }
  const files = fixture(); files.delete("licenses/dependencies/sql.js_1.14.2.txt");
  assert.throws(() => policy.checkEntries(files));
});
test("detects secret families and excludes development metadata", () => {
  for (const secret of ["ghp_" + "x".repeat(36), "sk-" + "x".repeat(32), "-----BEGIN PRIVATE KEY-----", 'api_key="' + "x".repeat(24) + '"']) {
    const files = fixture(); files.set("dist/assets/index-123.js", Buffer.from(secret));
    assert.throws(() => policy.checkEntries(files));
  }
  const files = fixture();
  const metadata = JSON.parse(files.get("package.json")); metadata.repository = "private-source";
  files.set("package.json", Buffer.from(JSON.stringify(metadata)));
  assert.throws(() => policy.checkEntries(files));
});
test("actual ASAR contents are checked, and CLI failures never print suspect values", () => temporary(async directory => {
  const app = path.join(directory, "app"); materialize(app, fixture());
  const archive = path.join(directory, "app.asar");
  const asar = require("@electron/asar");
  await asar.createPackage(app, archive);
  assert.ok(policy.check(archive) > 0);
  // Covers nested native ASAR paths, including actual unpacked WASM, on Windows and POSIX.
  const unpackedArchive = path.join(directory, "unpacked.asar");
  await asar.createPackageWithOptions(app, unpackedArchive, { unpack: "**/sql-wasm.wasm" });
  assert.ok(policy.check(unpackedArchive) > 0);
  const secret = "ghp_" + "x".repeat(36);
  fs.writeFileSync(path.join(app, "dist/assets/index-123.js"), secret);
  const result = spawnSync(process.execPath, [path.join(__dirname, "package-policy.cjs"), app], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
}));
test("manifest/checksums contain only expected build files", () => temporary(directory => {
  for (const kind of ["Setup", "Portable"]) fs.writeFileSync(path.join(directory, "English-Reader-0.3.0-x64-" + kind + ".exe"), "MZ" + kind);
  fs.writeFileSync(path.join(directory, "builder-effective-config.yaml"), "private-source-metadata");
  buildArtifacts(directory, "0.3.0");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "update-manifest.json")));
  assert.deepEqual(Object.keys(manifest), ["schemaVersion", "version", "platform", "arch", "installer"]);
  assert.deepEqual(Object.keys(manifest.installer), ["name", "size", "sha256"]);
  assert.equal(manifest.installer.sha256, createHash("sha256").update("MZSetup").digest("hex"));
  assert.equal(manifest.installer.size, Buffer.byteLength("MZSetup"));
  const sums = fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8");
  assert.equal(sums.trim().split("\n").length, 3);
  assert.equal(sums.includes("builder-effective-config"), false);
  buildArtifacts(directory, "0.3.0", true);
  assert.equal(fs.existsSync(path.join(directory, "update-manifest.json")), false);
  assert.equal(fs.readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim().split("\n").length, 1);
  assert.throws(() => buildArtifacts(directory, "../0.3.0"));
}));
