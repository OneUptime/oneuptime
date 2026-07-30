/*
 * What actually ships.
 *
 * Everything else in this suite tests TypeScript sources. This one runs the
 * real build and inspects the emitted artifacts, because the properties that
 * matter to a customer - "your page does not download a server framework",
 * "the stub is tiny", "the module format is loadable by a plain script tag" -
 * are properties of the bundle, not of the source.
 *
 * The build is invoked as a child process rather than by importing esbuild
 * here, so the esbuild.config.js the Dockerfile runs is the exact thing under
 * test, including its own hygiene assertions.
 */

declare function require(id: string): unknown;
declare const __dirname: string;

interface FileSystem {
  existsSync: (file: string) => boolean;
  readFileSync: (file: string, encoding: string) => string;
}

interface PathModule {
  join: (...parts: Array<string>) => string;
}

interface ChildProcess {
  execFileSync: (
    file: string,
    args: Array<string>,
    options: { cwd: string; env: Record<string, string | undefined> },
  ) => unknown;
}

interface ProcessLike {
  env: Record<string, string | undefined>;
  execPath: string;
}

declare const process: ProcessLike;

const fs: FileSystem = require("fs") as FileSystem;
const nodePath: PathModule = require("path") as PathModule;
const childProcess: ChildProcess = require("child_process") as ChildProcess;

const PACKAGE_ROOT: string = nodePath.join(__dirname, "..");
const DIST: string = nodePath.join(PACKAGE_ROOT, "public", "dist");

describe("bundle hygiene", (): void => {
  let recorderBundle: string = "";
  let loaderBundle: string = "";
  let manifest: {
    recorderVersion: string;
    rrwebVersion: string;
    files: Record<string, { bytes: number; integrity: string }>;
  };

  beforeAll((): void => {
    childProcess.execFileSync(
      process.execPath,
      [nodePath.join(PACKAGE_ROOT, "esbuild.config.js")],
      {
        cwd: PACKAGE_ROOT,
        env: { ...process.env, NODE_ENV: "production" },
      },
    );

    recorderBundle = fs.readFileSync(
      nodePath.join(DIST, "recorder.js"),
      "utf8",
    );
    loaderBundle = fs.readFileSync(nodePath.join(DIST, "loader.js"), "utf8");
    manifest = JSON.parse(
      fs.readFileSync(nodePath.join(DIST, "manifest.json"), "utf8"),
    ) as typeof manifest;
  }, 120000);

  it("emits both artifacts and a manifest", (): void => {
    expect(fs.existsSync(nodePath.join(DIST, "recorder.js"))).toBe(true);
    expect(fs.existsSync(nodePath.join(DIST, "loader.js"))).toBe(true);
    expect(manifest.rrwebVersion).toBe("2.1.1");
    expect(manifest.files["recorder.js"]?.integrity).toMatch(/^sha384-/);
  });

  /*
   * The reason the shared pure logic is COPIED in at build time rather than
   * imported: Common/UI/Config.ts reads window.process.env, which only exists
   * because the OneUptime Dashboard server injects /env.js, and
   * Common/package.json pulls express, typeorm, stripe and monaco.
   */
  it("carries no server dependency and no process.env", (): void => {
    for (const bundle of [recorderBundle, loaderBundle]) {
      expect(bundle).not.toContain("process.env");
      expect(bundle).not.toMatch(/\bexpress\b/);
      expect(bundle).not.toMatch(/\btypeorm\b/);
      expect(bundle).not.toMatch(/\bstripe\b/i);
      expect(bundle).not.toContain("node_modules");
    }
  });

  /*
   * IIFE with one global, because it is loaded by a plain <script src> from
   * arbitrary customer pages. ESM would need type="module" and splitting
   * would need chunk URLs the page cannot know in advance.
   */
  it("publishes the recorder as an IIFE under one global", (): void => {
    expect(recorderBundle).toContain("var OneUptimeReplay");
    expect(recorderBundle).not.toContain("export {");
    expect(recorderBundle).not.toContain("import(");
  });

  it("inlines the shared Rum logic instead of importing Common", (): void => {
    expect(recorderBundle).not.toContain('require("Common');
    expect(recorderBundle).not.toContain('from"Common');

    /*
     * A token that exists ONLY in Common/Utils/Rum/Masking proves the shared
     * module really was inlined rather than stubbed out. esbuild escapes
     * non-ASCII by default, so the mask character is matched in its escaped
     * form.
     */
    expect(recorderBundle).toContain("cc-exp-month");
    expect(recorderBundle).toMatch(/\\u2022|•/);
  });

  it("keeps rrweb out of the loader stub", (): void => {
    /* A distinctive rrweb internal that would appear if it were bundled. */
    expect(loaderBundle).not.toContain("rrweb");
    expect(loaderBundle).not.toContain("takeFullSnapshot");
    expect(loaderBundle.length).toBeLessThan(6 * 1024);
  });

  it("contains the recorder itself", (): void => {
    expect(recorderBundle).toContain("takeFullSnapshot");
    expect(recorderBundle.length).toBeGreaterThan(100 * 1024);
    expect(recorderBundle.length).toBeLessThan(320 * 1024);
  });

  /*
   * The customer's page loads the stub, and only then the pinned artifact.
   * That two-stage load is what makes a bad masking release recoverable by
   * changing one config field instead of waiting out a cache TTL.
   */
  it("has the loader fetch config before loading anything", (): void => {
    expect(loaderBundle).toContain("/session-replay/v1/config");
    expect(loaderBundle).toContain("globalPrivacyControl");
    expect(loaderBundle).toContain("integrity");
  });
});

/* Marks this file as a module, so its ambient Node declarations stay local. */
export {};
