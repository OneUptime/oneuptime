import fs from "fs";
import path from "path";

/*
 * NO ZOD BELOW THE FIX: GHSA-mrhx-c7xc-m3w5.
 *
 * Every zod below 4.6.6 is affected by GHSA-mrhx-c7xc-m3w5, and no 3.x is fixed. The one package
 * here that ever used zod was Expo's developer tooling: up to 57.0.32 @expo/cli asked for zod 3,
 * which package.json overrode with zod 4, and a test ran its schemas on it. @expo/cli 57.0.33, which
 * SDK 57 asks for now, asks for no zod at all, and its schemas moved to @expo/schema-utils, so the
 * override is gone. This holds the tree to what the override was for: whatever brings zod back,
 * it is not a zod the advisory names.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const FIXED_IN: string = "4.6.6";

interface LockedPackage {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const lock: { packages: Record<string, LockedPackage> } = JSON.parse(
  fs.readFileSync(path.join(APP_ROOT, "package-lock.json"), "utf8"),
) as { packages: Record<string, LockedPackage> };

// a < b: negative; a = b: 0; a > b: positive. Release versions only (x.y.z).
function compareVersions(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (let index: number = 0; index < 3; index++) {
    const difference: number = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

// Every copy of a package the lock holds: its path there, and its version.
function lockedCopies(name: string): Array<[string, string]> {
  return Object.entries(lock.packages)
    .filter(([location]: [string, LockedPackage]): boolean => {
      return (
        location === `node_modules/${name}` ||
        location.endsWith(`/node_modules/${name}`)
      );
    })
    .map(([location, locked]: [string, LockedPackage]): [string, string] => {
      return [location, locked.version || ""];
    });
}

describe("zod in the app's dependencies", () => {
  test(`every zod the lock holds is ${FIXED_IN} or later`, () => {
    const affected: Array<[string, string]> = lockedCopies("zod").filter(
      ([, version]: [string, string]): boolean => {
        return compareVersions(version, FIXED_IN) < 0;
      },
    );

    expect(affected).toEqual([]);
  });

  test("@expo/cli asks for no zod: if that changes, it needs the override back", () => {
    const copies: Array<[string, string]> = lockedCopies("@expo/cli");

    expect(copies.length).toBeGreaterThan(0);

    for (const [location] of copies) {
      expect({
        location,
        zod: lock.packages[location]?.dependencies?.["zod"],
      }).toEqual({ location, zod: undefined });
    }
  });

  test("reads the versions as numbers: 4.10.0 is later than 4.6.6, and 3.25.76 earlier", () => {
    expect(compareVersions("4.10.0", FIXED_IN)).toBeGreaterThan(0);
    expect(compareVersions("4.6.6", FIXED_IN)).toBe(0);
    expect(compareVersions("3.25.76", FIXED_IN)).toBeLessThan(0);
  });
});
