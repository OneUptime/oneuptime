// Sync the VERSION file into the "version" field of every internal package.json.
// Without this, internal packages (Common, App, Probe, ...) stay at 1.0.0 in source
// and vulnerability scanners flag them as outdated.
//
// Usage:
//   node Scripts/Install/SyncPackageVersions.js          # sync all package.json to VERSION
//   node Scripts/Install/SyncPackageVersions.js --check  # exit non-zero if any drift

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VERSION_FILE = path.join(REPO_ROOT, "VERSION");

const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  ".git",
  "Backups",
  "coverage",
  ".next",
  ".cache",
]);

function readTargetVersion() {
  const raw = fs.readFileSync(VERSION_FILE, "utf8").trim();
  if (!raw) {
    console.error("VERSION file is empty");
    process.exit(1);
  }
  return raw;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name === "package.json") {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function syncFile(file, version, checkOnly) {
  const raw = fs.readFileSync(file, "utf8");
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    return { skipped: true };
  }
  if (typeof pkg.version !== "string") return { skipped: true };
  if (pkg.version === version) return { changed: false, prev: pkg.version };
  if (!checkOnly) {
    // Replace only the first "version": "..." occurrence. package.json schema
    // forbids a duplicate top-level "version" field, and dependency entries use
    // package names as keys (never the literal "version"), so this regex is safe.
    const updated = raw.replace(
      /("version"\s*:\s*")[^"]*(")/,
      `$1${version}$2`,
    );
    fs.writeFileSync(file, updated);
  }
  return { changed: true, prev: pkg.version };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check");
  const targetVersion = readTargetVersion();
  const files = walk(REPO_ROOT, []);

  const drifted = [];
  let skipped = 0;
  for (const file of files) {
    const result = syncFile(file, targetVersion, checkOnly);
    if (result.skipped) {
      skipped++;
      continue;
    }
    if (result.changed) {
      drifted.push({ file: path.relative(REPO_ROOT, file), prev: result.prev });
    }
  }

  if (drifted.length === 0) {
    console.log(
      `All ${files.length - skipped} package.json file(s) already at ${targetVersion}.`,
    );
    return;
  }

  for (const { file, prev } of drifted) {
    console.log(
      `${checkOnly ? "drift" : "sync"}: ${file} (${prev} -> ${targetVersion})`,
    );
  }

  if (checkOnly) {
    console.error(
      `\n${drifted.length} package.json file(s) out of sync with VERSION (${targetVersion}).`,
    );
    console.error(
      "Run 'npm run sync-package-versions' from the repo root and commit the changes.",
    );
    process.exit(1);
  }

  console.log(
    `\nSynced ${drifted.length} package.json file(s) to ${targetVersion}.`,
  );
}

main();
