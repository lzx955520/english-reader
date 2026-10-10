const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
function buildArtifacts(directory, version, portableOnly = false) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid build version.");
  const base = "English-Reader-" + version + "-x64-";
  const names = portableOnly ? [base + "Portable.exe"] : [base + "Setup.exe", base + "Portable.exe"];
  const describe = name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size < 2 || !Number.isSafeInteger(stat.size)) throw new Error("Invalid build artifact.");
    const bytes = fs.readFileSync(file);
    if (name.endsWith(".exe") && (bytes[0] !== 0x4d || bytes[1] !== 0x5a)) throw new Error("Invalid Windows executable.");
    return { name, size: stat.size, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const files = names.map(describe);
  const manifestPath = path.join(directory, "update-manifest.json");
  if (portableOnly) {
    fs.rmSync(manifestPath, { force: true });
  } else {
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1, version, platform: "win32", arch: "x64", installer: files[0],
    }, null, 2) + "\n");
    files.push(describe("update-manifest.json"));
  }
  fs.writeFileSync(path.join(directory, "SHA256SUMS.txt"),
    files.map(file => file.sha256 + "  " + file.name).join("\n") + "\n");
  return files;
}
module.exports = { buildArtifacts };
if (require.main === module) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--portable")) throw new Error();
    buildArtifacts(path.join(root, "release"), pkg.version, args.includes("--portable"));
    console.log("Generated checksums for build artifacts only; nothing was published.");
  } catch {
    console.error("Build artifact metadata generation failed.");
    process.exitCode = 1;
  }
}
