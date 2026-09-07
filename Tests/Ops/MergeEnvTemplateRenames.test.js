"use strict";

/**
 * Scripts/Install/MergeEnvTemplate.js and renamed settings.
 *
 * The merge runs on every `npm run update` (configure.sh -> prerun) and appends
 * any key present in config.example.env but missing from the operator's
 * config.env, TAKING THE TEMPLATE'S VALUE. That is fine for a genuinely new
 * setting and catastrophic for a renamed one: when REDIS_PASSWORD became
 * VALKEY_PASSWORD, the naive merge would have appended
 * `VALKEY_PASSWORD=please-change-this-to-random-value` next to the operator's
 * real secret. The app prefers the new name, so the whole stack would have come
 * back up on a password published in this repository — with no error anywhere.
 *
 * The RENAMED_FROM table is what prevents that, and this file is the only thing
 * guarding it. The rule it encodes: a renamed key whose OLD name is still set is
 * left alone entirely, so the operator keeps their single copy of the value and
 * docker-compose.base.yml resolves the new name to it via
 * `${VALKEY_PASSWORD:-${REDIS_PASSWORD}}`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "Scripts",
  "Install",
  "MergeEnvTemplate.js",
);
const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, "config.example.env");

const PLACEHOLDER = "please-change-this-to-random-value";

/**
 * Runs the real script against a throwaway config.env and returns the result.
 * The script resolves both files relative to the process working directory, so
 * it needs a directory shaped like the repo root.
 */
function runMerge(configEnvContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-env-"));

  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(SCRIPT_PATH, path.join(dir, "Scripts", "Install", "MergeEnvTemplate.js"));
  fs.copyFileSync(CONFIG_EXAMPLE_PATH, path.join(dir, "config.example.env"));
  fs.writeFileSync(path.join(dir, "config.env"), configEnvContents);

  execFileSync(process.execPath, ["./Scripts/Install/MergeEnvTemplate.js"], {
    cwd: dir,
    stdio: "pipe",
  });

  return fs.readFileSync(path.join(dir, "config.env"), "utf8");
}

function valueOf(contents, key) {
  const line = contents.split("\n").find((candidate) => {
    return candidate.split("=")[0] === key;
  });

  return line === undefined ? undefined : line.slice(line.indexOf("=") + 1);
}

function keysIn(contents) {
  return contents
    .split("\n")
    .filter((line) => {
      return line && !line.startsWith("#") && line.includes("=");
    })
    .map((line) => {
      return line.split("=")[0];
    });
}

/** Every rename the merge script knows about, read from the script itself. */
function renamedPairs() {
  const source = fs.readFileSync(SCRIPT_PATH, "utf8");
  const table = source.slice(
    source.indexOf("const RENAMED_FROM = {"),
    source.indexOf("};", source.indexOf("const RENAMED_FROM = {")),
  );

  return [...table.matchAll(/^\s*([A-Z0-9_]+):\s*"([A-Z0-9_]+)",/gm)].map(
    (match) => {
      return { current: match[1], legacy: match[2] };
    },
  );
}

describe("MergeEnvTemplate carries renamed settings over", () => {
  const REAL_SECRET = "a-real-production-secret";

  /*
   * The exact shape of an install that predates the rename: the cache settings
   * are all present, under their old names, and one of them is a real secret.
   */
  const LEGACY_CONFIG = [
    "NODE_ENV=production",
    `REDIS_PASSWORD=${REAL_SECRET}`,
    "REDIS_HOST=redis",
    "REDIS_PORT=6379",
    "REDIS_DB=0",
    "REDIS_USERNAME=default",
    "REDIS_IP_FAMILY=",
    "REDIS_TLS_CA=",
    "REDIS_TLS_SENTINEL_MODE=false",
    "",
  ].join("\n");

  test("the script declares a rename for every cache setting", () => {
    const pairs = renamedPairs();

    expect(pairs.length).toBeGreaterThan(0);
    for (const { current, legacy } of pairs) {
      expect(current).toMatch(/^VALKEY_/);
      expect(legacy).toBe(current.replace(/^VALKEY_/, "REDIS_"));
    }
  });

  /*
   * The one that matters: no placeholder may be introduced next to a real
   * secret. Asserted on the whole file rather than on VALKEY_PASSWORD alone, so
   * it also catches a future rename that reintroduces the same bug.
   */
  test("never appends a placeholder for a setting the operator already has", () => {
    const merged = runMerge(LEGACY_CONFIG);

    for (const { current, legacy } of renamedPairs()) {
      if (!keysIn(LEGACY_CONFIG).includes(legacy)) {
        continue;
      }

      expect(keysIn(merged)).not.toContain(current);
    }

    expect(valueOf(merged, "REDIS_PASSWORD")).toBe(REAL_SECRET);
    expect(valueOf(merged, "VALKEY_PASSWORD")).toBeUndefined();
  });

  test("leaves every legacy line byte-identical", () => {
    const merged = runMerge(LEGACY_CONFIG);

    for (const line of LEGACY_CONFIG.split("\n")) {
      if (line) {
        expect(merged.split("\n")).toContain(line);
      }
    }
  });

  /*
   * The rename skip must be narrow: unrelated settings added to the template
   * since the operator's install still have to arrive.
   */
  test("still appends genuinely new settings", () => {
    const merged = runMerge(LEGACY_CONFIG);
    const templateKeys = keysIn(fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8"));
    const legacyOnly = renamedPairs().map((pair) => {
      return pair.current;
    });

    const expected = templateKeys.filter((key) => {
      return !legacyOnly.includes(key);
    });

    expect(expected.length).toBeGreaterThan(10);
    for (const key of expected) {
      expect(keysIn(merged)).toContain(key);
    }
  });

  /* A fresh install has neither name, so the new one is written normally. */
  test("appends the current name when no legacy value exists", () => {
    const merged = runMerge("NODE_ENV=production\n");

    expect(valueOf(merged, "VALKEY_PASSWORD")).toBe(PLACEHOLDER);
    expect(valueOf(merged, "VALKEY_HOST")).toBe("valkey");
    expect(keysIn(merged)).not.toContain("REDIS_PASSWORD");
  });

  /*
   * Exactly one cache-password line may carry the placeholder. Home/Scripts/
   * Install.sh replaces placeholder occurrences ONE AT A TIME with freshly
   * generated values, so shipping the password under both names would hand the
   * server one secret and the app a different one.
   */
  test("config.example.env carries exactly one cache password line", () => {
    const cachePasswordLines = fs
      .readFileSync(CONFIG_EXAMPLE_PATH, "utf8")
      .split("\n")
      .filter((line) => {
        return /^(VALKEY|REDIS)_PASSWORD=/.test(line);
      });

    expect(cachePasswordLines).toEqual([`VALKEY_PASSWORD=${PLACEHOLDER}`]);
  });

  /*
   * A config.env that has already been migrated by hand must not be disturbed,
   * and the operator's real value must not be replaced by the template default.
   */
  test("leaves a config.env that already uses the new names alone", () => {
    const migrated = [
      "NODE_ENV=production",
      `VALKEY_PASSWORD=${REAL_SECRET}`,
      "VALKEY_HOST=my-cache.internal",
      "",
    ].join("\n");

    const merged = runMerge(migrated);

    expect(valueOf(merged, "VALKEY_PASSWORD")).toBe(REAL_SECRET);
    expect(valueOf(merged, "VALKEY_HOST")).toBe("my-cache.internal");
  });
});
