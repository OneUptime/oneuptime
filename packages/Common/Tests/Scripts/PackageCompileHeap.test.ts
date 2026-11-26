import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PACKAGES THAT TYPE-CHECK THE MOST GIVE TSC A HEAP OF THEIR OWN.
 *
 * Node's default heap is about 4 GB, and tsc keeps every file and type of
 * its program until it exits. Common's and App's compile scripts gave tsc
 * 8 GiB long ago; the Probe's ran plain `tsc`, and once #11166 (the SAN
 * switch packs) grew its program it ran out of memory there - in its
 * Docker image's build (`RUN npm run compile`) and in the Compile
 * workflow's Compile Probe step alike, which both run this script. Each of
 * these packages' compile sets the heap before tsc, keeping whatever
 * NODE_OPTIONS the caller set.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const HEAP_AT_LEAST_MB: number = 8192;

const SETS_THE_HEAP: RegExp =
  /^export NODE_OPTIONS="--max-old-space-size=(\d+)\$\{NODE_OPTIONS:\+ \$NODE_OPTIONS\}" && tsc\b/;

function compileScriptOf(packageName: string): string {
  const manifest: { scripts?: Record<string, string> } = JSON.parse(
    fs.readFileSync(
      path.join(PACKAGES_ROOT, packageName, "package.json"),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };

  return manifest.scripts?.["compile"] || "";
}

describe("a package's compile script", () => {
  test.each(["Common", "App", "Probe"])(
    "%s gives tsc at least 8 GiB, before tsc runs, keeping the caller's NODE_OPTIONS",
    (packageName: string) => {
      const match: RegExpMatchArray | null =
        compileScriptOf(packageName).match(SETS_THE_HEAP);

      expect({ packageName, setsTheHeap: Boolean(match) }).toEqual({
        packageName,
        setsTheHeap: true,
      });
      expect(Number(match![1])).toBeGreaterThanOrEqual(HEAP_AT_LEAST_MB);
    },
  );

  test("the Probe's image and the Compile workflow type-check through that script", () => {
    const repository: string = path.resolve(PACKAGES_ROOT, "..");
    const dockerfile: string = fs.readFileSync(
      path.join(PACKAGES_ROOT, "Probe", "Dockerfile.tpl"),
      "utf8",
    );
    const workflow: string = fs.readFileSync(
      path.join(repository, ".github", "workflows", "compile.yml"),
      "utf8",
    );

    expect(dockerfile).toContain("RUN npm run compile");
    expect(dockerfile).not.toMatch(/RUN (npx )?tsc\b/);
    expect(workflow).toContain("cd packages/Probe && npm run compile");
  });
});
