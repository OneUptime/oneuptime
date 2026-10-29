/*
 * The versions a guide's end-to-end check installed, read from the lock
 * file its package manager left (Scripts/VerifyOpenTelemetryGuides.ts
 * records them in Verifications.json): go.mod, Gemfile.lock, composer.lock,
 * Cargo.lock and mix.lock. Each reader takes the file's text, or "" for a
 * file the run did not write, and gives each package's version by its
 * name as the registry writes it.
 */

// A version's "v" before its first digit: "v1.40.0" is 1.40.0.
const VERSION_PREFIX: RegExp = /^v(?=[0-9])/;

/*
 * The modules a Go build selected, from go.mod as the run left it: since
 * Go 1.17 it lists every module the build needs, each at the version the
 * build used, in require blocks and on require lines of their own.
 */
export function goModVersions(goMod: string): Record<string, string> {
  const versions: Record<string, string> = {};
  let inRequireBlock: boolean = false;

  for (const rawLine of goMod.split("\n")) {
    const line: string = rawLine.trim();

    if (line === "require (") {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ")") {
      inRequireBlock = false;
      continue;
    }

    const words: Array<string> = (
      line.startsWith("require ") ? line.slice("require ".length) : line
    )
      .split(" ")
      .filter((word: string): boolean => {
        return word.length > 0;
      });

    if (
      (inRequireBlock || line.startsWith("require ")) &&
      words.length >= 2 &&
      words[0] &&
      words[1]
    ) {
      versions[words[0]] = words[1];
    }
  }

  return versions;
}

/*
 * The gems Bundler resolved, from Gemfile.lock's specs (four spaces in):
 * "    sqlite3 (2.10.2-x86_64-linux-gnu)" is sqlite3 2.10.2. A spec's own
 * dependencies, six spaces in, are requirements, not versions.
 */
export function gemfileLockVersions(lock: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const line of lock.split("\n")) {
    if (!line.startsWith("    ") || line.startsWith("     ")) {
      continue;
    }

    const open: number = line.indexOf(" (");
    const close: number = line.indexOf(")", open);

    if (open > 0 && close > open) {
      const version: string = line.slice(open + 2, close);
      versions[line.slice(0, open).trim()] = version.split("-")[0] || version;
    }
  }

  return versions;
}

interface ComposerLock {
  packages?: Array<{ name: string; version: string }>;
  "packages-dev"?: Array<{ name: string; version: string }>;
}

// The packages Composer installed, from composer.lock: "v13.39.0" is 13.39.0.
export function composerLockVersions(lock: string): Record<string, string> {
  const versions: Record<string, string> = {};

  if (!lock) {
    return versions;
  }

  const parsed: ComposerLock = JSON.parse(lock) as ComposerLock;

  for (const item of [
    ...(parsed.packages || []),
    ...(parsed["packages-dev"] || []),
  ]) {
    versions[item.name] = item.version.replace(VERSION_PREFIX, "");
  }

  return versions;
}

// Which of two dotted versions is the higher: above 0 for a, below 0 for b.
export function compareVersions(a: string, b: string): number {
  const partsA: Array<number> = a.split(".").map(Number);
  const partsB: Array<number> = b.split(".").map(Number);

  for (
    let index: number = 0;
    index < Math.max(partsA.length, partsB.length);
    index++
  ) {
    const difference: number = (partsA[index] || 0) - (partsB[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/*
 * The crates Cargo resolved, from Cargo.lock: [[package]] blocks with a
 * name and a version. A crate the build needs at two versions is recorded
 * at the higher.
 */
export function cargoLockVersions(lock: string): Record<string, string> {
  const versions: Record<string, string> = {};
  let name: string = "";

  for (const rawLine of lock.split("\n")) {
    const line: string = rawLine.trim();

    if (line === "[[package]]") {
      name = "";
      continue;
    }

    const [key, value] = line.split(" = ");
    const unquoted: string = (value || "").split('"').join("");

    if (key === "name") {
      name = unquoted;
    } else if (key === "version" && name) {
      const known: string | undefined = versions[name];

      if (!known || compareVersions(unquoted, known) > 0) {
        versions[name] = unquoted;
      }
    }
  }

  return versions;
}

/*
 * The Hex packages Mix resolved, from mix.lock:
 *   "opentelemetry": {:hex, :opentelemetry, "1.7.0", "...", [:rebar3], [...], "hexpm", "..."},
 * A dependency from git or a path has no Hex version, and is left out.
 */
export function mixLockVersions(lock: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const line of lock.split("\n")) {
    const marker: string = "{:hex, :";
    const at: number = line.indexOf(marker);

    if (at < 0) {
      continue;
    }

    const rest: string = line.slice(at + marker.length);
    const comma: number = rest.indexOf(",");
    const quoteStart: number = rest.indexOf('"', comma);
    const quoteEnd: number = rest.indexOf('"', quoteStart + 1);

    if (comma > 0 && quoteStart > comma && quoteEnd > quoteStart) {
      versions[rest.slice(0, comma)] = rest.slice(quoteStart + 1, quoteEnd);
    }
  }

  return versions;
}
