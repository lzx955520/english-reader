const fs = require("node:fs");
const path = require("node:path");

const required = [
  "package.json", "dist/index.html", "dist-electron/main.cjs", "dist-electron/preload.cjs",
  "assets/classics.json", "assets/dictionary.sqlite", "assets/dictionary-provenance.txt",
  "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/ECDICT-MIT.txt", "licenses/GUTENBERG.txt",
  "node_modules/sql.js/package.json", "node_modules/sql.js/LICENSE",
  "node_modules/sql.js/dist/sql-wasm.js", "node_modules/sql.js/dist/sql-wasm.wasm",
];
const directories = new Set([
  "dist", "dist/assets", "dist-electron", "assets", "licenses", "licenses/dependencies",
  "node_modules", "node_modules/sql.js", "node_modules/sql.js/dist",
]);
const allowed = name => required.includes(name) ||
  /^dist\/assets\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:js|css|svg|png|webp|woff2?)$/.test(name) ||
  /^licenses\/dependencies\/[A-Za-z0-9_.-]+\.txt$/.test(name);

function fail() {
  // Never include paths, matched values, file contents or underlying errors.
  throw new Error("Package privacy validation failed. Review the allowlist, required notices and secret scan privately.");
}
function suspicious(bytes) {
  const text = bytes.toString("utf8");
  return [
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bAIza[A-Za-z0-9_-]{30,}\b/,
    /(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']/i,
    /["'](?:Authorization|authorization)["']?\s*:\s*["'](?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{16,}/,
    /https?:\/\/[^/\s:@"']+:[^/\s@"']+@/i,
    /(?:[A-Z]:\\+Users\\+[^\\\s"']+|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)/i,
  ].some(pattern => pattern.test(text));
}
function checkEntries(entries) {
  for (const [name, bytes] of entries) {
    if (!allowed(name) || !Buffer.isBuffer(bytes) || suspicious(bytes)) fail();
  }
  for (const name of required) if (!entries.has(name) || entries.get(name).length === 0) fail();
  const pkg = JSON.parse(entries.get("package.json").toString("utf8"));
  if (Object.keys(pkg).some(key => !["name", "version", "description", "author", "license", "main", "dependencies"].includes(key)) ||
      pkg.name !== "english-reader" || pkg.main !== "dist-electron/main.cjs" ||
      !/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.license !== "MIT" ||
      Object.keys(pkg.dependencies || {}).join() !== "sql.js") fail();
  const sql = JSON.parse(entries.get("node_modules/sql.js/package.json").toString("utf8"));
  if (Object.keys(sql).some(key => !["name", "version", "main", "license"].includes(key)) ||
      sql.name !== "sql.js" || sql.main !== "dist/sql-wasm.js" ||
      pkg.dependencies["sql.js"] !== sql.version) fail();
  const notices = entries.get("THIRD_PARTY_NOTICES.md").toString("utf8");
  const names = [...notices.matchAll(/^- \*\*([^*]+)\*\*/gm)].map(match => match[1]);
  if (!names.length) fail();
  for (const name of names) {
    if (!entries.has("licenses/dependencies/" + name.replace(/[^a-zA-Z0-9_.-]/g, "_") + ".txt")) fail();
  }
  return entries.size;
}
function directoryEntries(root) {
  const entries = new Map();
  if (!fs.lstatSync(root).isDirectory()) fail();
  function walk(relative = "") {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const relativeName = relative ? relative + "/" + name : name;
      const file = path.join(root, relativeName);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail();
      if (stat.isDirectory()) {
        if (!directories.has(relativeName)) fail();
        walk(relativeName);
      } else if (stat.isFile() && allowed(relativeName)) {
        entries.set(relativeName, fs.readFileSync(file));
      } else fail();
    }
  }
  walk();
  return entries;
}
function archiveEntries(file) {
  const asar = require("@electron/asar"); // Already locked through electron-builder.
  const entries = new Map();
  const unpacked = new Set();
  for (const item of asar.listPackage(file)) {
    const name = item.replace(/^[/\\]/, "").replace(/\\/g, "/");
    if (!name || name.split("/").some(part => !part || part === "." || part === "..")) fail();
    // ASAR 3.x traverses with path.sep; keep POSIX names only for our allowlist.
    const nativeName = name.split("/").join(path.sep);
    const stat = asar.statFile(file, nativeName, false);
    if ("link" in stat) fail();
    if ("files" in stat) {
      if (!directories.has(name)) fail();
    } else {
      if (!allowed(name)) fail();
      if (stat.unpacked) unpacked.add(name);
      entries.set(name, asar.extractFile(file, nativeName));
    }
  }
  if (fs.existsSync(file + ".unpacked")) {
    const outside = directoryEntries(file + ".unpacked");
    if (outside.size !== unpacked.size || [...outside.keys()].some(name => !unpacked.has(name))) fail();
  } else if (unpacked.size) fail();
  return entries;
}
function check(target) {
  try {
    return checkEntries(target.endsWith(".asar") ? archiveEntries(target) : directoryEntries(target));
  } catch {
    fail();
  }
}
function afterPack(context) {
  try {
    const root = context.appOutDir;
    const resource = context.packager.getResourcesDir(root);
    check(path.join(resource, "app.asar"));
    if (!["LICENSE", "LICENSE.electron.txt"].some(name => fs.existsSync(path.join(root, name))) ||
        !fs.existsSync(path.join(root, "LICENSES.chromium.html"))) fail();
    for (const name of fs.readdirSync(resource)) {
      if (!["app.asar", "app.asar.unpacked", "elevate.exe"].includes(name)) fail();
    }
    console.log("Packaged runtime and mandatory notices passed privacy validation.");
  } catch {
    fail();
  }
}
module.exports = afterPack;
Object.assign(module.exports, { allowed, suspicious, checkEntries, directoryEntries, check });
if (require.main === module) {
  try {
    check(process.argv[2] || "release/app");
    console.log("Package privacy validation passed.");
  } catch {
    console.error("Package privacy validation failed. No matched values or file contents were logged.");
    process.exitCode = 1;
  }
}
