import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  compareVersions,
  dependentsOf,
  isInAffectedRange,
  isVersionAtLeast,
  lockedCopies,
  packageNameAt,
  PackageLock,
  rangeFloor,
  readPackageLock,
  resolvedCopy,
} from "./PackageLock";

/*
 * PackageLock reads an npm lockfile the way npm installs it, for the tests
 * that hold a package to a version no advisory covers (Tests/Dependencies,
 * Probe's Tests/Build/MsalNodeAdvisory). Those tests are only as right as
 * these answers: which copies a lock installs, which copy a package loads,
 * and semver's order - in which an advisory fixed in 7.1.0 still covers
 * 7.1.0-beta.1.
 */

// A lock shaped like Common's: a nested @azure/identity with its own msal-node.
const LOCK: PackageLock = {
  packages: {
    "": { dependencies: { tedious: "^20.0.0", botbuilder: "^4.23.3" } },
    "node_modules/tedious": {
      version: "20.3.7",
      dependencies: { "@azure/identity": "^4.13.1" },
    },
    "node_modules/@azure/identity": {
      version: "4.14.0",
      dependencies: { "@azure/msal-node": "^6.0.0" },
    },
    "node_modules/@azure/identity/node_modules/@azure/msal-node": {
      version: "7.1.1",
    },
    "node_modules/@azure/msal-node": { version: "2.16.3" },
    "node_modules/botbuilder": {
      version: "4.23.3",
      dependencies: { "@azure/msal-node": "^2.13.1", zod: "^3.23.8" },
    },
    "node_modules/botbuilder/node_modules/zod": { version: "3.25.76" },
    "node_modules/zod": { version: "4.6.7" },
    "node_modules/zod-plugin": {
      version: "1.0.0",
      peerDependencies: { zod: "^4.0.0" },
      optionalDependencies: { "@azure/identity": "^4.0.0" },
    },
    "node_modules/Common": { link: true },
    "../Common": { version: "14.0.89", dependencies: { zod: "^4.6.7" } },
  },
};

describe("semver's order", () => {
  test.each([
    ["4.6.7", "4.6.6", 1],
    ["4.6.6", "4.6.6", 0],
    ["4.6.5", "4.6.6", -1],
    ["10.0.0", "9.9.9", 1],
    ["7.10.0", "7.9.0", 1],
    ["7.1.0-beta.1", "7.1.0", -1],
    ["7.1.0", "7.1.0-beta.1", 1],
    ["7.1.0-beta.1", "7.1.0-beta.0", 1],
    ["7.1.0-beta.10", "7.1.0-beta.9", 1],
    ["7.1.0-alpha", "7.1.0-beta", -1],
    ["7.1.0-1", "7.1.0-alpha", -1],
    ["7.1.0-beta", "7.1.0-beta.1", -1],
    ["7.1.0+build.5", "7.1.0", 0],
    ["7.1.1", "7.1.0-beta.3", 1],
  ])("%s against %s: %d", (a: string, b: string, expected: number) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
    // 0 - expected: the other way round, and a plain 0 for the same version.
    expect(Math.sign(compareVersions(b, a))).toBe(0 - expected);
    expect(isVersionAtLeast(a, b)).toBe(expected >= 0);
  });
});

describe("an advisory's affected range", () => {
  // GHSA-xcx6-jx8p-x3h5: @azure/msal-node from 5.0.0-beta.0, fixed in 7.1.0.
  const range: { introduced: string; fixed: string } = {
    introduced: "5.0.0-beta.0",
    fixed: "7.1.0",
  };

  test.each([
    ["5.0.0-beta.0", true],
    ["5.0.0-beta.3", true],
    ["5.0.0", true],
    ["6.0.0", true],
    ["7.0.2", true],
    ["7.1.0-beta.1", true],
    ["7.1.0", false],
    ["7.1.1", false],
    ["8.0.0", false],
    ["4.9.9", false],
    ["2.16.3", false],
  ])("%s: %s", (version: string, affected: boolean) => {
    expect(isInAffectedRange(version, range)).toBe(affected);
  });
});

describe("the copies a lock installs", () => {
  test("every copy of a package, nested ones too, links and the project itself aside", () => {
    expect(lockedCopies(LOCK, "@azure/msal-node")).toEqual([
      {
        path: "node_modules/@azure/identity/node_modules/@azure/msal-node",
        version: "7.1.1",
      },
      { path: "node_modules/@azure/msal-node", version: "2.16.3" },
    ]);
    expect(lockedCopies(LOCK, "Common")).toEqual([]);
    expect(lockedCopies(LOCK, "missing")).toEqual([]);
  });

  test("a lock key's package name, scoped ones included", () => {
    expect(
      packageNameAt("node_modules/tedious/node_modules/@azure/identity"),
    ).toBe("@azure/identity");
    expect(packageNameAt("node_modules/zod")).toBe("zod");
  });
});

describe("the copy a package loads, by Node's lookup", () => {
  test("its own node_modules first", () => {
    expect(
      resolvedCopy(LOCK, "node_modules/@azure/identity", "@azure/msal-node"),
    ).toEqual({
      path: "node_modules/@azure/identity/node_modules/@azure/msal-node",
      version: "7.1.1",
    });
    expect(resolvedCopy(LOCK, "node_modules/botbuilder", "zod")).toEqual({
      path: "node_modules/botbuilder/node_modules/zod",
      version: "3.25.76",
    });
  });

  test("else the nearest node_modules above it", () => {
    expect(
      resolvedCopy(LOCK, "node_modules/botbuilder", "@azure/msal-node"),
    ).toEqual({ path: "node_modules/@azure/msal-node", version: "2.16.3" });
    expect(
      resolvedCopy(LOCK, "node_modules/tedious", "@azure/identity"),
    ).toEqual({ path: "node_modules/@azure/identity", version: "4.14.0" });
    expect(resolvedCopy(LOCK, "", "zod")).toEqual({
      path: "node_modules/zod",
      version: "4.6.7",
    });
  });

  test("nothing when no copy is installed", () => {
    expect(resolvedCopy(LOCK, "node_modules/tedious", "missing")).toBe(
      undefined,
    );
  });
});

describe("the packages that ask for one", () => {
  test("in dependencies, optional dependencies or peer dependencies; links left out", () => {
    expect(dependentsOf(LOCK, "zod")).toEqual([
      { path: "../Common", range: "^4.6.7" },
      { path: "node_modules/botbuilder", range: "^3.23.8" },
      { path: "node_modules/zod-plugin", range: "^4.0.0" },
    ]);
    expect(dependentsOf(LOCK, "@azure/identity")).toEqual([
      { path: "node_modules/tedious", range: "^4.13.1" },
      { path: "node_modules/zod-plugin", range: "^4.0.0" },
    ]);
  });
});

describe("a range's floor", () => {
  test.each([
    ["^4.6.7", "4.6.7"],
    ["~1.2.3", "1.2.3"],
    ["7.1.0", "7.1.0"],
  ])("%s: %s", (range: string, floor: string) => {
    expect(rangeFloor(range)).toBe(floor);
  });
});

describe("Common's own lock, read with it", () => {
  const lock: PackageLock = readPackageLock(
    path.resolve(__dirname, "..", ".."),
  );

  test("has packages to read, and tedious loads the @azure/identity it installs", () => {
    expect(Object.keys(lock.packages).length).toBeGreaterThan(100);
    expect(
      resolvedCopy(lock, "node_modules/tedious", "@azure/identity"),
    ).toEqual({
      path: expect.stringContaining("@azure/identity"),
      version: expect.any(String),
    });
  });
});
