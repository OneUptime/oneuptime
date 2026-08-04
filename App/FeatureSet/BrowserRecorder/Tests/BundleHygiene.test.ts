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
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      encoding?: string;
    },
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
    files: Record<
      string,
      { bytes: number; gzipBytes: number; integrity: string }
    >;
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
   * Gzip is what the customer's browser downloads, and it was previously
   * unbudgeted: only the raw size was checked, and minified JavaScript
   * compresses at wildly different ratios depending on what changed.
   */
  it("records the gzip size of both artifacts", (): void => {
    const recorderGzip: number = manifest.files["recorder.js"]?.gzipBytes || 0;
    const loaderGzip: number = manifest.files["loader.js"]?.gzipBytes || 0;

    expect(recorderGzip).toBeGreaterThan(0);
    expect(recorderGzip).toBeLessThanOrEqual(76 * 1024);
    expect(loaderGzip).toBeGreaterThan(0);
    expect(loaderGzip).toBeLessThanOrEqual(3 * 1024);
  });

  /*
   * The version is what names the artifact's URL path, and src/Config.ts
   * refuses to build that URL from anything that is not a plain semver. A
   * build that stamps something else produces an artifact no loader will ever
   * request.
   */
  it("stamps a version the loader will accept", (): void => {
    expect(manifest.recorderVersion).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/,
    );
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
    expect(loaderBundle.length).toBeLessThan(7 * 1024);
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

/*
 * The Common allow-list, exercised directly.
 *
 * The plugin used to hook only `^Common/` specifiers, which are what this
 * package's own src/ writes. Files INSIDE Common reach each other with
 * relative paths - Common/Utils/Rum/ChunkMath.ts imports
 * "../../Types/Rum/SessionReplay" - and those resolved natively and
 * unchecked, so a future "../../Types/Dictionary" added inside a Rum module
 * would have been inlined silently into a bundle served to third-party
 * origins. The FORBIDDEN_IN_BUNDLE grep is a backstop, not a substitute: a
 * Common module with no express/typeorm/process.env token passes it.
 *
 * Driven through a child Node process because esbuild's own startup invariant
 * check fails under jsdom, and requiring esbuild.config.js loads esbuild.
 */
describe("common allow-list resolver", (): void => {
  interface ResolverCase {
    name: string;
    blocked: boolean;
  }

  let results: Record<string, boolean> = {};

  beforeAll((): void => {
    const script: string = [
      `const config = require(${JSON.stringify(nodePath.join(PACKAGE_ROOT, "esbuild.config.js"))});`,
      `const p = require("path");`,
      `const rum = p.join(config.COMMON_ROOT, "Utils", "Rum");`,
      `const typesRum = p.join(config.COMMON_ROOT, "Types", "Rum");`,
      `const src = p.join(${JSON.stringify(PACKAGE_ROOT)}, "src");`,
      `const cases = [`,
      `  ["relative-escape-from-common", { path: "../../Types/Dictionary", resolveDir: rum, importer: p.join(rum, "ChunkMath.ts") }],`,
      `  ["relative-deep-escape", { path: "../../Server/Utils/Express", resolveDir: rum, importer: p.join(rum, "ChunkMath.ts") }],`,
      `  ["relative-allowed-cross-rum", { path: "../../Types/Rum/SessionReplay", resolveDir: rum, importer: p.join(rum, "ChunkMath.ts") }],`,
      `  ["relative-allowed-sibling", { path: "./SessionReplayConsentMode", resolveDir: typesRum, importer: p.join(typesRum, "SessionReplay.ts") }],`,
      `  ["package-from-common", { path: "typeorm", resolveDir: rum, importer: p.join(rum, "ChunkMath.ts") }],`,
      `  ["package-from-src", { path: "rrweb", resolveDir: src, importer: p.join(src, "Recorder.ts") }],`,
      `  ["relative-inside-src", { path: "./Chunker", resolveDir: src, importer: p.join(src, "Recorder.ts") }],`,
      `];`,
      `const out = {};`,
      `for (const [name, args] of cases) { out[name] = Boolean(config.resolveCommonEscape(args)); }`,
      `process.stdout.write(JSON.stringify(out));`,
    ].join("\n");

    const raw: unknown = childProcess.execFileSync(
      process.execPath,
      ["-e", script],
      {
        cwd: PACKAGE_ROOT,
        env: { ...process.env },
        encoding: "utf8",
      },
    );

    results = JSON.parse(String(raw)) as Record<string, boolean>;
  }, 60000);

  const expected: Array<ResolverCase> = [
    { name: "relative-escape-from-common", blocked: true },
    { name: "relative-deep-escape", blocked: true },
    { name: "relative-allowed-cross-rum", blocked: false },
    { name: "relative-allowed-sibling", blocked: false },
    { name: "package-from-common", blocked: true },
    { name: "package-from-src", blocked: false },
    { name: "relative-inside-src", blocked: false },
  ];

  /*
   * it.each rather than a for loop: `results` is populated in beforeAll, so a
   * closure declared inside a loop closes over a binding that is still empty
   * at declaration time, which is exactly what no-loop-func warns about.
   */
  it.each(expected)(
    "$name is resolved as expected",
    (testCase: ResolverCase): void => {
      expect(results[testCase.name]).toBe(testCase.blocked);
    },
  );
});

/* Marks this file as a module, so its ambient Node declarations stay local. */
export {};
