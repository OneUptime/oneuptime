import fs from "fs";
import path from "path";

/*
 * Reading an npm package-lock.json (lockfileVersion 2 or 3) the way npm
 * installs it, for tests that hold a package to a dependency version: which
 * copies of a package the lock installs, and which copy a given package
 * loads when it requires it (Node's lookup: its own node_modules, then each
 * node_modules above it).
 */

export interface PackageLockEntry {
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  link?: boolean;
  dev?: boolean;
}

export interface PackageLock {
  packages: Record<string, PackageLockEntry>;
}

export interface PackageJson {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

export interface LockedCopy {
  // The lock's key: "node_modules/a" or "node_modules/a/node_modules/b".
  path: string;
  version: string;
}

export function readPackageLock(directory: string): PackageLock {
  return JSON.parse(
    fs.readFileSync(path.join(directory, "package-lock.json"), "utf8"),
  ) as PackageLock;
}

export function readPackageJson(directory: string): PackageJson {
  return JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  ) as PackageJson;
}

const NODE_MODULES: string = "node_modules/";

/*
 * The name of the package a lock key installs ("@azure/identity" for
 * "node_modules/tedious/node_modules/@azure/identity").
 */
export function packageNameAt(lockPath: string): string {
  const index: number = lockPath.lastIndexOf(NODE_MODULES);

  return index === -1 ? lockPath : lockPath.slice(index + NODE_MODULES.length);
}

// Every copy of `name` the lock installs, links aside.
export function lockedCopies(
  lock: PackageLock,
  name: string,
): Array<LockedCopy> {
  return Object.entries(lock.packages)
    .filter(([lockPath, entry]: [string, PackageLockEntry]): boolean => {
      return (
        lockPath !== "" &&
        !entry.link &&
        packageNameAt(lockPath) === name &&
        typeof entry.version === "string"
      );
    })
    .map(([lockPath, entry]: [string, PackageLockEntry]): LockedCopy => {
      return { path: lockPath, version: entry.version as string };
    })
    .sort((a: LockedCopy, b: LockedCopy): number => {
      return a.path.localeCompare(b.path);
    });
}

/*
 * The lock key of the folder that holds `lockPath`'s node_modules: "" for the
 * project itself, "node_modules/a" for "node_modules/a/node_modules/b".
 */
function parentOf(lockPath: string): string {
  const index: number = lockPath.lastIndexOf(`/${NODE_MODULES}`);

  return index === -1 ? "" : lockPath.slice(0, index);
}

/*
 * The copy of `name` the package at `fromPath` loads - its own
 * node_modules/<name>, else the nearest one above - or undefined when none is
 * installed.
 */
export function resolvedCopy(
  lock: PackageLock,
  fromPath: string,
  name: string,
): LockedCopy | undefined {
  let base: string = fromPath;

  for (;;) {
    const candidate: string = base
      ? `${base}/${NODE_MODULES}${name}`
      : `${NODE_MODULES}${name}`;
    const entry: PackageLockEntry | undefined = lock.packages[candidate];

    if (entry && typeof entry.version === "string") {
      return { path: candidate, version: entry.version };
    }

    if (base === "") {
      return undefined;
    }

    base = parentOf(base);
  }
}

// Every package in the lock that asks for `name`, in any of its dependency lists.
export function dependentsOf(
  lock: PackageLock,
  name: string,
): Array<{ path: string; range: string }> {
  const found: Array<{ path: string; range: string }> = [];

  for (const [lockPath, entry] of Object.entries(lock.packages)) {
    if (entry.link) {
      continue;
    }

    const range: string | undefined =
      entry.dependencies?.[name] ||
      entry.optionalDependencies?.[name] ||
      entry.peerDependencies?.[name];

    if (range) {
      found.push({ path: lockPath, range: range });
    }
  }

  return found.sort(
    (
      a: { path: string; range: string },
      b: { path: string; range: string },
    ): number => {
      return a.path.localeCompare(b.path);
    },
  );
}

function releaseParts(version: string): Array<number> {
  return (version.split("-")[0] || "")
    .split(".")
    .map((part: string): number => {
      return Number(part);
    });
}

/*
 * Whether `version` is `minimum` or later, by major, minor and patch (a
 * prerelease of a version counts as that version - the advisories these
 * tests read name release versions).
 */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const have: Array<number> = releaseParts(version);
  const need: Array<number> = releaseParts(minimum);

  for (let index: number = 0; index < 3; index++) {
    const a: number = have[index] ?? 0;
    const b: number = need[index] ?? 0;

    if (a !== b) {
      return a > b;
    }
  }

  return true;
}

const RANGE_OPERATOR: RegExp = /^[\^~]/;

// The lowest version a "^x.y.z" or "~x.y.z" or plain range admits.
export function rangeFloor(range: string): string {
  return range.replace(RANGE_OPERATOR, "").trim();
}
