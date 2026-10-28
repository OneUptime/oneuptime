import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  LockedCopy,
  lockedCopies,
  PackageJson,
  PackageLock,
  rangeFloor,
  readPackageJson,
  readPackageLock,
  resolvedCopy,
} from "../Helpers/PackageLock";

/*
 * THE REPOSITORY ROOT COMPILES COMMON WITH COMMON'S NODE TYPES.
 *
 * The root package's ts-node compiles Common's server code: `npm run
 * generate-openapi-spec` and `npm run generate-terraform-provider` (the
 * OpenAPI Spec Generation, Terraform Provider Generation and Terraform
 * Provider E2E Tests workflows) run `node --require ts-node/register` from
 * the root, so the root's tsconfig.json and its node_modules/@types/node type
 * every file they reach. The lint job installs only the root's dependencies,
 * so its type-aware rules read the root's Node types for every package too.
 *
 * Nothing at the root asked for @types/node - jest and ts-node ask for any
 * version ("*") - so the root's lock kept the 18.11.15 of 2022 while every
 * package moved to 26. TypeScript 5.9's typed arrays do not take an
 * @types/node 18 Buffer, so when #5368's Server/Utils/OpenAPI.ts handed a
 * Buffer to crypto's update() and zlib's gzipSync(), Common's own compile
 * passed and the root's failed ("Argument of type 'Buffer' is not assignable
 * to parameter of type 'BinaryLike'"), which stopped the three workflows.
 *
 * The root now asks for Common's @types/node, and these keep them together:
 * bump the root's and Common's in the same change.
 */

const NODE_TYPES: string = "@types/node";
const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_DIRECTORY, "..", "..");

/*
 * Where package.json files live: the root (0), Scripts and ee (1), packages,
 * agents and Scripts' tools (2), the App's feature sets (4).
 */
const PACKAGE_DEPTH: number = 4;
const NOT_PACKAGES: Array<string> = ["node_modules", "build", "dist"];

const rootPackageJson: PackageJson = readPackageJson(REPOSITORY_ROOT);
const rootLock: PackageLock = readPackageLock(REPOSITORY_ROOT);
const commonPackageJson: PackageJson = readPackageJson(COMMON_DIRECTORY);
const commonLock: PackageLock = readPackageLock(COMMON_DIRECTORY);

// The range a package.json asks for, in its dependencies or devDependencies.
function askedFor(packageJson: PackageJson, name: string): string | undefined {
  return (
    packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
  );
}

// "26" for "^26.1.1", "~26.6.0" or "26.1.1".
function majorOf(rangeOrVersion: string): string {
  return rangeFloor(rangeOrVersion).split(".")[0] || "";
}

// The folders under `directory` that hold a package.json, as paths from the root.
function packageFolders(directory: string, depth: number): Array<string> {
  const found: Array<string> = fs.existsSync(
    path.join(directory, "package.json"),
  )
    ? [path.relative(REPOSITORY_ROOT, directory) || "."]
    : [];

  if (depth === PACKAGE_DEPTH) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !NOT_PACKAGES.includes(entry.name)
    ) {
      found.push(
        ...packageFolders(path.join(directory, entry.name), depth + 1),
      );
    }
  }

  return found;
}

describe("the repository root's Node types", () => {
  test("the root asks for the @types/node Common asks for", () => {
    const commonRange: string | undefined = askedFor(
      commonPackageJson,
      NODE_TYPES,
    );

    expect(commonRange).toBeDefined();
    expect(askedFor(rootPackageJson, NODE_TYPES)).toBe(commonRange);
  });

  test("the root's lock installs one @types/node, the version Common's lock installs", () => {
    const rootCopies: Array<LockedCopy> = lockedCopies(rootLock, NODE_TYPES);
    const commonCopy: LockedCopy | undefined = resolvedCopy(
      commonLock,
      "",
      NODE_TYPES,
    );

    /*
     * One copy: a second one, nested under a package that asks for another
     * version, would reach the compile through that package's own type
     * references and declare Buffer and the node: modules twice.
     */
    expect(
      rootCopies.map((copy: LockedCopy): string => {
        return copy.path;
      }),
    ).toEqual(["node_modules/@types/node"]);
    expect(commonCopy).toBeDefined();
    expect(rootCopies[0]!.version).toBe(commonCopy!.version);
  });

  test("every package that asks for @types/node asks for the root's major", () => {
    const rootMajor: string = majorOf(
      askedFor(rootPackageJson, NODE_TYPES) || "",
    );
    const folders: Array<string> = packageFolders(REPOSITORY_ROOT, 0);
    const asking: Array<string> = folders.filter((folder: string): boolean => {
      return (
        askedFor(
          readPackageJson(path.join(REPOSITORY_ROOT, folder)),
          NODE_TYPES,
        ) !== undefined
      );
    });
    const otherMajors: Array<string> = asking
      .map((folder: string): string => {
        const range: string = askedFor(
          readPackageJson(path.join(REPOSITORY_ROOT, folder)),
          NODE_TYPES,
        ) as string;

        return `${folder}: ${range}`;
      })
      .filter((line: string): boolean => {
        return majorOf(line.split(": ")[1] || "") !== rootMajor;
      });

    expect(rootMajor).toBe("26");
    // The walk finds the packages (Common, the App, Scripts and the rest).
    expect(asking).toEqual(
      expect.arrayContaining([
        ".",
        "Scripts",
        "packages/Common",
        "packages/App",
      ]),
    );
    expect(otherMajors).toEqual([]);
  });
});
