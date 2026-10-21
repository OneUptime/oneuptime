// Sync the VERSION file into the "version" field of every internal package.json,
// and into the package's own version in the package-lock.json beside it.
// Without this, internal packages (Common, App, Probe, ...) stay at 1.0.0 in source
// and vulnerability scanners flag them as outdated.
//
// Usage:
//   node Scripts/Install/SyncPackageVersions.js          # sync all package.json (and lockfiles) to VERSION
//   node Scripts/Install/SyncPackageVersions.js --check  # exit non-zero if any drift

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const VERSION_FILE = path.join(REPO_ROOT, "VERSION");
const LOCKFILE_NAME = "package-lock.json";

const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  ".git",
  "Backups",
  "coverage",
  ".next",
  ".cache",
  /*
   * Agent worktrees are full checkouts of this repo nested under the
   * root. Without this, every version bump silently rewrites the
   * package.json files of every in-flight worktree — dirtying dozens of
   * unrelated branches with a version their own VERSION file does not
   * carry (found the hard way during the 12.0.17 bump).
   */
  ".claude",
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

// A package's lockfile records the package's own version twice: the top-level
// "version" and packages[""].version (lockfileVersion 2 and 3; 1 has only the
// first). npm rewrites both on `npm install` and `npm version`, but nothing did
// on a VERSION bump, so they lagged a release behind until the next install -
// and an image's SBOM reads its package's version from there, as scanners do.
//
// Rewritten through JSON rather than a regex: every dependency entry carries a
// "version" key too, at the same indentation as packages[""]'s. That is only
// exact while the file is what npm writes - JSON.stringify with the file's own
// indentation and line ending, then a newline - so a lockfile that does not
// round-trip byte-for-byte is reported as unsafe and left alone rather than
// reformatted.
function syncLockfile(file, version, checkOnly) {
  let raw;
  let lock;
  try {
    raw = fs.readFileSync(file, "utf8");
    lock = JSON.parse(raw);
  } catch (err) {
    return { skipped: true };
  }
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    return { skipped: true };
  }

  const rootPackage =
    lock.packages && typeof lock.packages === "object"
      ? lock.packages[""]
      : undefined;
  const hasTopLevelVersion = typeof lock.version === "string";
  const hasRootPackageVersion =
    Boolean(rootPackage) &&
    typeof rootPackage === "object" &&
    typeof rootPackage.version === "string";
  if (!hasTopLevelVersion && !hasRootPackageVersion) return { skipped: true };

  const prev = hasTopLevelVersion ? lock.version : rootPackage.version;
  const inSync =
    (!hasTopLevelVersion || lock.version === version) &&
    (!hasRootPackageVersion || rootPackage.version === version);
  if (inSync) return { changed: false, prev };
  if (checkOnly) return { changed: true, prev };

  const indentMatch = raw.match(/^\{\r?\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : 2;
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const serialize = (value) => {
    const text = `${JSON.stringify(value, null, indent)}\n`;
    return newline === "\n" ? text : text.replace(/\n/g, newline);
  };
  if (serialize(lock) !== raw) return { changed: true, prev, unsafe: true };

  if (hasTopLevelVersion) lock.version = version;
  if (hasRootPackageVersion) rootPackage.version = version;
  fs.writeFileSync(file, serialize(lock));
  return { changed: true, prev };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check");
  const targetVersion = readTargetVersion();
  const files = walk(REPO_ROOT, []);

  const drifted = [];
  const leftAlone = [];
  let skipped = 0;
  let lockfiles = 0;
  for (const file of files) {
    const result = syncFile(file, targetVersion, checkOnly);
    if (result.skipped) {
      skipped++;
      continue;
    }
    if (result.changed) {
      drifted.push({ file: path.relative(REPO_ROOT, file), prev: result.prev });
    }

    // Only the lockfile of a package this syncs: it records that package.
    const lockfile = path.join(path.dirname(file), LOCKFILE_NAME);
    if (!fs.existsSync(lockfile)) continue;
    const lockResult = syncLockfile(lockfile, targetVersion, checkOnly);
    if (lockResult.skipped) continue;
    lockfiles++;
    if (lockResult.unsafe) {
      leftAlone.push({
        file: path.relative(REPO_ROOT, lockfile),
        prev: lockResult.prev,
      });
    } else if (lockResult.changed) {
      drifted.push({
        file: path.relative(REPO_ROOT, lockfile),
        prev: lockResult.prev,
      });
    }
  }

  // Never fails the run: the pre-commit hook runs this on every commit, and
  // `--check` still reports the file as drift until it is refreshed.
  for (const { file, prev } of leftAlone) {
    console.error(
      `left alone: ${file} (${prev}) is not formatted the way npm writes it, so its version was not rewritten. ` +
        `Run 'npm install --package-lock-only' in ${path.dirname(file)} to refresh it.`,
    );
  }

  if (drifted.length === 0) {
    if (leftAlone.length === 0) {
      console.log(
        `All ${files.length - skipped} package.json file(s) and ${lockfiles} package-lock.json file(s) already at ${targetVersion}.`,
      );
    }
    return;
  }

  for (const { file, prev } of drifted) {
    console.log(
      `${checkOnly ? "drift" : "sync"}: ${file} (${prev} -> ${targetVersion})`,
    );
  }

  if (checkOnly) {
    console.error(
      `\n${drifted.length} package.json / package-lock.json file(s) out of sync with VERSION (${targetVersion}).`,
    );
    console.error(
      "Run 'npm run sync-package-versions' from the repo root and commit the changes.",
    );
    process.exit(1);
  }

  console.log(
    `\nSynced ${drifted.length} package.json / package-lock.json file(s) to ${targetVersion}.`,
  );
}

main();
