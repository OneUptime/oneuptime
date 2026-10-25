import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  dependentsOf,
  isVersionAtLeast,
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
 * COMMON HAS NO ZOD 3: GHSA-mrhx-c7xc-m3w5.
 *
 * "Zod can exhaust memory while validating oversized constrained
 * collections": every zod below 4.6.6 is affected, and there is no fixed
 * zod 3. Common's zod 3 came from three places, all moved to zod 4:
 *
 *   - Common's own Utils/Schema (the OpenAPI document, the MCP tools'
 *     schemas, the Terraform provider's spec): zod 4.6.7;
 *   - @asteasolutions/zod-to-openapi 7, which needs zod 3: now 9, on zod 4;
 *   - botbuilder 4.23.3, the last Bot Framework SDK (its repository is
 *     archived), which asks for zod ^3.23.8: package.json overrides its zod
 *     with Common's own ("botbuilder": { "zod": "$zod" }), and
 *     Server/Utils/Workspace/MicrosoftTeams/BotbuilderOnZod4 puts back the two
 *     zod 3 names it calls.
 *
 * So Common's audit exception for the advisory is gone
 * (Scripts/Security/npm-audit-exceptions.json), and these keep it so: one
 * zod in Common's lock, a fixed one, the one every package that asks for zod
 * loads.
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..");
const FIXED_IN: string = "4.6.6";

const lock: PackageLock = readPackageLock(COMMON_DIRECTORY);
const packageJson: PackageJson = readPackageJson(COMMON_DIRECTORY);

describe("Common's zod", () => {
  test(`the lock installs one zod, ${FIXED_IN} or later`, () => {
    const copies: Array<LockedCopy> = lockedCopies(lock, "zod");

    expect(
      copies.map((copy: LockedCopy): string => {
        return copy.path;
      }),
    ).toEqual(["node_modules/zod"]);
    expect(isVersionAtLeast(copies[0]!.version, FIXED_IN)).toBe(true);
  });

  test("every package that asks for zod loads that one", () => {
    const dependents: Array<{ path: string; range: string }> = dependentsOf(
      lock,
      "zod",
    );
    const names: Array<string> = dependents.map(
      (dependent: { path: string; range: string }): string => {
        return dependent.path;
      },
    );

    // Common itself, zod-to-openapi and botbuilder's four packages.
    expect(names).toEqual(
      expect.arrayContaining([
        "",
        "node_modules/@asteasolutions/zod-to-openapi",
        "node_modules/botbuilder",
        "node_modules/botbuilder-core",
        "node_modules/botframework-connector",
        "node_modules/botframework-schema",
      ]),
    );

    for (const dependent of dependents) {
      expect({
        dependent: dependent.path,
        loads: resolvedCopy(lock, dependent.path, "zod")?.path,
      }).toEqual({ dependent: dependent.path, loads: "node_modules/zod" });
    }
  });

  test(`Common asks for zod 4, at ${FIXED_IN} or later`, () => {
    const range: string | undefined = packageJson.dependencies?.["zod"];

    expect(range?.startsWith("^4.")).toBe(true);
    expect(isVersionAtLeast(rangeFloor(range as string), FIXED_IN)).toBe(true);
  });

  test("zod-to-openapi is 9, the release line for zod 4", () => {
    expect(
      packageJson.dependencies?.["@asteasolutions/zod-to-openapi"]?.startsWith(
        "^9.",
      ),
    ).toBe(true);

    const copies: Array<LockedCopy> = lockedCopies(
      lock,
      "@asteasolutions/zod-to-openapi",
    );

    expect(copies).toHaveLength(1);
    expect(copies[0]!.version.startsWith("9.")).toBe(true);
    expect(
      lock.packages["node_modules/@asteasolutions/zod-to-openapi"]
        ?.peerDependencies?.["zod"],
    ).toBe("^4.0.0");
  });

  test("botbuilder still asks for zod 3, and gets Common's zod through the override", () => {
    // If botbuilder ever asks for zod 4 itself, the override can go.
    expect(
      lock.packages["node_modules/botbuilder"]?.dependencies?.["zod"],
    ).toBe("^3.23.8");
    expect(
      (packageJson.overrides?.["botbuilder"] as Record<string, string>)?.[
        "zod"
      ],
    ).toBe("$zod");
  });

  test("what is installed is what the lock says", () => {
    const installed: string = path.join(
      COMMON_DIRECTORY,
      "node_modules",
      "zod",
      "package.json",
    );

    expect(fs.existsSync(installed)).toBe(true);
    expect(
      (JSON.parse(fs.readFileSync(installed, "utf8")) as PackageJson).version,
    ).toBe(lock.packages["node_modules/zod"]?.version);
  });
});
