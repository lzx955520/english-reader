const fs = require("node:fs");
const path = require("node:path");
const policy = require("./package-policy.cjs");
const root = path.resolve(__dirname, "..");
const stage = path.join(root, "release", "app");
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const sql = JSON.parse(fs.readFileSync(path.join(root, "node_modules/sql.js/package.json"), "utf8"));
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const files = [
    "dist-electron/main.cjs", "dist-electron/preload.cjs",
    "assets/classics.json", "assets/dictionary.sqlite", "assets/dictionary-provenance.txt",
    "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/ECDICT-MIT.txt", "licenses/GUTENBERG.txt",
    "node_modules/sql.js/LICENSE", "node_modules/sql.js/dist/sql-wasm.js", "node_modules/sql.js/dist/sql-wasm.wasm",
  ];
  function collect(relative) {
    for (const name of fs.readdirSync(path.join(root, relative))) {
      const file = relative + "/" + name;
      const stat = fs.lstatSync(path.join(root, file));
      if (stat.isSymbolicLink()) throw new Error();
      if (stat.isDirectory()) collect(file);
      else if (stat.isFile() && policy.allowed(file)) files.push(file);
      else throw new Error();
    }
  }
  collect("dist");
  collect("licenses/dependencies");
  for (const file of files) {
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error();
    const destination = path.join(stage, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  const metadata = {
    name: pkg.name, version: pkg.version, description: pkg.description,
    author: pkg.author, license: pkg.license, main: pkg.main,
    dependencies: { "sql.js": sql.version },
  };
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(metadata, null, 2) + "\n");
  fs.writeFileSync(path.join(stage, "node_modules/sql.js/package.json"), JSON.stringify({
    name: "sql.js", version: sql.version, main: "dist/sql-wasm.js", license: sql.license,
  }, null, 2) + "\n");
  policy.check(stage);
  console.log("Prepared a runtime-only application package.");
} catch {
  console.error("Runtime package preparation failed. No file contents or suspected secret values were logged.");
  process.exitCode = 1;
}
