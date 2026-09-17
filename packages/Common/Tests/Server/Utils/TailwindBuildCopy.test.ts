import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { VendorAssetsPath } from "../../../Server/Utils/VendorAssets";

/*
 * The five frontends no longer commit their own copy of Tailwind; the esbuild
 * build copies the one under Common/Server/Static/Vendor into each
 * public/assets/js. Their index.ejs is unchanged, so if that copy silently
 * stops happening nothing fails loudly - the dashboard, accounts, admin, status
 * page and public dashboard all just render unstyled, in production, with a 404
 * in the console.
 *
 * So the real copyTailwindAsset runs here, against real directories, rather
 * than the test reading the build script and hoping.
 *
 * It runs in a node subprocess because requiring esbuild-config.js pulls in
 * esbuild, which refuses to load under jsdom (jsdom's TextEncoder does not
 * produce a real Uint8Array and esbuild asserts on that). A `@jest-environment
 * node` docblock does not help - Common's shared jest.setup.ts touches
 * `window`. Spawning node is also how the build itself loads this module, so
 * this exercises the shipped path rather than an approximation of it.
 */

const ESBUILD_CONFIG: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "esbuild-config.js",
);

const CANONICAL: string = path.join(
  VendorAssetsPath,
  "tailwind",
  "tailwind-3.4.5.js",
);

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const temporaryRoots: Array<string> = [];

function makeOutdir(): string {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-tailwind-copy-"),
  );

  temporaryRoots.push(root);

  /*
   * Mirrors the real layout: esbuild's outdir is <public>/dist, and the copy
   * lands in <public>/assets/js - a sibling of outdir, not a child.
   */
  return path.join(root, "public", "dist");
}

function copiedPath(outdir: string): string {
  return path.join(path.dirname(outdir), "assets", "js", "tailwind-3.4.5.js");
}

type RunCopy = (outdir: string) => { ok: boolean; error: string };

const runCopy: RunCopy = (outdir: string): { ok: boolean; error: string } => {
  const script: string = `
    const config = require(${JSON.stringify(ESBUILD_CONFIG)});
    try {
      config.copyTailwindAsset(${JSON.stringify(outdir)});
      console.log(JSON.stringify({ ok: true, error: "" }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: String(error && error.message || error) }));
    }
  `;

  const stdout: string = childProcess.execFileSync(
    process.execPath,
    ["-e", script],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );

  return JSON.parse(stdout.trim()) as { ok: boolean; error: string };
};

describe("the frontend build's Tailwind copy", () => {
  afterAll(() => {
    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop() as string, {
        recursive: true,
        force: true,
      });
    }
  });

  test("is exported by the build config the frontends load", () => {
    const exported: string = childProcess
      .execFileSync(
        process.execPath,
        [
          "-e",
          `const c = require(${JSON.stringify(ESBUILD_CONFIG)});
           console.log(JSON.stringify({
             fn: typeof c.copyTailwindAsset,
             filename: c.TAILWIND_FILENAME,
           }));`,
        ],
        { cwd: REPOSITORY_ROOT, encoding: "utf8" },
      )
      .trim();

    expect(JSON.parse(exported)).toEqual({
      fn: "function",
      filename: "tailwind-3.4.5.js",
    });
  });

  test("puts the file where index.ejs looks for it", () => {
    const outdir: string = makeOutdir();

    expect(runCopy(outdir)).toEqual({ ok: true, error: "" });
    expect(fs.existsSync(copiedPath(outdir))).toBe(true);
  });

  test("writes the canonical bytes, not a re-encoded copy", () => {
    const outdir: string = makeOutdir();

    runCopy(outdir);

    expect(
      fs.readFileSync(copiedPath(outdir)).equals(fs.readFileSync(CANONICAL)),
    ).toBe(true);
  });

  test("creates assets/js when the frontend has no such directory yet", () => {
    /*
     * A clean checkout has no public/assets/js for some services - the copy has
     * to create it rather than throw ENOENT and take the whole build down.
     */
    const outdir: string = makeOutdir();

    expect(fs.existsSync(path.join(path.dirname(outdir), "assets"))).toBe(
      false,
    );

    expect(runCopy(outdir).ok).toBe(true);
  });

  test("overwrites a stale copy from a previous build", () => {
    const outdir: string = makeOutdir();
    const destination: string = copiedPath(outdir);

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "/* stale */");

    runCopy(outdir);

    expect(
      fs.readFileSync(destination).equals(fs.readFileSync(CANONICAL)),
    ).toBe(true);
  });

  test("lands outside the outdir that build() wipes before every build", () => {
    /*
     * build() rm -rf's config.outdir first. assets/js has to be a sibling, not
     * a child - if it were inside, each service's build would delete the copy
     * and only the last frontend built would have a stylesheet.
     */
    const outdir: string = makeOutdir();

    runCopy(outdir);

    fs.mkdirSync(outdir, { recursive: true });
    fs.rmSync(outdir, { recursive: true, force: true });

    expect(fs.existsSync(copiedPath(outdir))).toBe(true);
  });

  test("names the file the same thing every index.ejs asks for", () => {
    /*
     * The version lives in the filename, so bumping Tailwind means editing five
     * views. This is the tripwire for doing one without the other.
     */
    const featureSets: string = path.join(REPOSITORY_ROOT, "App", "FeatureSet");

    const services: Array<[string, string]> = [
      ["Dashboard", "dashboard"],
      ["Accounts", "accounts"],
      ["AdminDashboard", "admin"],
      ["StatusPage", "status-page"],
      ["PublicDashboard", "public-dashboard"],
    ];

    for (const [service, routePrefix] of services) {
      const indexView: string = fs.readFileSync(
        path.join(featureSets, service, "views", "index.ejs"),
        "utf8",
      );

      const expectedUrl: string = `/${routePrefix}/assets/js/tailwind-3.4.5.js`;

      expect([service, indexView.includes(expectedUrl)]).toEqual([
        service,
        true,
      ]);
    }
  });

  test("is wired into both build and watch, so no service can miss it", () => {
    const source: string = fs.readFileSync(ESBUILD_CONFIG, "utf8");

    /*
     * `npm run build-frontends:prod` in the Dockerfile goes through build(),
     * the dev watcher through watch(). Wiring only one means it works in
     * development and 404s in the image, or the reverse.
     */
    const inBuild: RegExp =
      /async function build\([\s\S]*?copyTailwindAsset\(config\.outdir\)/;
    const inWatch: RegExp =
      /async function watch\([\s\S]*?copyTailwindAsset\(config\.outdir\)/;

    expect(inBuild.test(source)).toBe(true);
    expect(inWatch.test(source)).toBe(true);
  });
});
