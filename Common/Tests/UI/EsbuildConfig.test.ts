import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * createConfig() is what every frontend bundle is built from. Two of its fields
 * decide how many bytes every user downloads on a cold load and how much the
 * image carries: `minify` and `sourcemap`. Both are derived from NODE_ENV, and
 * getting the derivation backwards fails silently - the build succeeds either
 * way, and the only symptom is a multi-megabyte bundle in production or an
 * undebuggable one in development.
 *
 * These run createConfig for real, in a node subprocess, the same way the build
 * loads it. Requiring esbuild-config.js pulls in esbuild, which refuses to load
 * under the jsdom-based environment Common's jest config uses (jsdom's
 * TextEncoder does not produce a real Uint8Array and esbuild asserts on that),
 * and a `@jest-environment node` docblock does not help because Common's shared
 * jest.setup.ts touches `window`. Spawning node is also exactly how the build
 * itself loads this module - see Tests/Server/Utils/TailwindBuildCopy.test.ts,
 * which does the same for the Tailwind copy.
 */

const ESBUILD_CONFIG: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "esbuild-config.js",
);

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const temporaryRoots: Array<string> = [];

/*
 * The five services that go through createConfig. BrowserRecorder is
 * deliberately absent: it has its own esbuild.config.js and never calls
 * createConfig.
 */
const FRONTENDS: Array<[string, string]> = [
  ["Accounts", "/accounts/dist/"],
  ["Dashboard", "/dashboard/dist/"],
  ["AdminDashboard", "/admin/dist/"],
  ["StatusPage", "/status-page/dist/"],
  ["PublicDashboard", "/public-dashboard/dist/"],
];

interface ConfigSnapshot {
  entryPoints: Array<string>;
  bundle: boolean;
  outdir: string;
  format: string;
  platform: string;
  target: string;
  sourcemap: string | boolean;
  minify: boolean;
  /*
   * Optional on purpose: when createConfig does not set keepNames at all,
   * JSON.stringify drops the key entirely and it arrives here as undefined,
   * not false. Typing it `boolean` would let a `toBe(true)` assertion read as
   * though the field is always present when it is not.
   */
  keepNames?: boolean;
  treeShaking: boolean;
  splitting: boolean;
  publicPath: string;
  metafile: boolean;
  external: Array<string>;
  loader: Record<string, string>;
  resolveExtensions: Array<string>;
  monacoAssetPath: string;
  definedNodeEnv: string;
  keys: Array<string>;
  pluginNames: Array<string>;
}

type ChildEnvironment = Record<string, string>;

/*
 * jest runs with NODE_ENV=test, so "unset" has to mean actually deleting it
 * from the child's environment rather than inheriting whatever is here.
 */
function childEnvironment(nodeEnv: string | null): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  delete environment["NODE_ENV"];
  delete environment["analyze"];

  if (nodeEnv !== null) {
    environment["NODE_ENV"] = nodeEnv;
  }

  return environment;
}

function runNode(script: string, nodeEnv: string | null): string {
  return childProcess
    .execFileSync(process.execPath, ["-e", script], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: childEnvironment(nodeEnv),
    })
    .trim();
}

/*
 * The real config object holds plugin closures and so is not JSON-serializable
 * in full. Snapshot every field a build actually depends on, plus the raw key
 * list, so a dropped or renamed field is caught even if no assertion below
 * names it.
 */
function readConfig(
  nodeEnv: string | null,
  publicPath: string = "/dashboard/dist/",
  serviceName: string = "Dashboard",
): ConfigSnapshot {
  const script: string = `
    const c = require(${JSON.stringify(ESBUILD_CONFIG)});
    const cfg = c.createConfig({
      serviceName: ${JSON.stringify(serviceName)},
      publicPath: ${JSON.stringify(publicPath)},
    });
    console.log(JSON.stringify({
      entryPoints: cfg.entryPoints,
      bundle: cfg.bundle,
      outdir: cfg.outdir,
      format: cfg.format,
      platform: cfg.platform,
      target: cfg.target,
      sourcemap: cfg.sourcemap,
      minify: cfg.minify,
      keepNames: cfg.keepNames,
      treeShaking: cfg.treeShaking,
      splitting: cfg.splitting,
      publicPath: cfg.publicPath,
      metafile: cfg.metafile,
      external: cfg.external,
      loader: cfg.loader,
      resolveExtensions: cfg.resolveExtensions,
      monacoAssetPath: JSON.parse(cfg.define["process.env.MONACO_ASSET_PATH"]),
      definedNodeEnv: JSON.parse(cfg.define["process.env.NODE_ENV"]),
      keys: Object.keys(cfg),
      pluginNames: cfg.plugins.map(function (p) { return p.name; }),
    }));
  `;

  return JSON.parse(runNode(script, nodeEnv)) as ConfigSnapshot;
}

function makeTempDir(prefix: string): string {
  const root: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

describe("the frontend build config's production output settings", () => {
  afterAll(() => {
    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop() as string, {
        recursive: true,
        force: true,
      });
    }
  });

  describe("minification", () => {
    test("is on for a production build", () => {
      /*
       * The happy path, and the whole point: `npm run build-frontends:prod`
       * runs with NODE_ENV=production and must emit minified bundles. One
       * service measured 4,842,357 bytes unminified against 2,636,716
       * minified.
       */
      const config: ConfigSnapshot = readConfig("production");

      expect(config.minify).toBe(true);
    });

    test("is off when NODE_ENV is not set at all", () => {
      /*
       * The plain `npm run build-frontends` / watch path. Minifying here would
       * slow every watch rebuild and make every browser stack trace useless,
       * for a size win nobody is measuring on a laptop.
       */
      const config: ConfigSnapshot = readConfig(null);

      expect(config.minify).toBe(false);
    });

    test("is off for an explicit development build", () => {
      const config: ConfigSnapshot = readConfig("development");

      expect(config.minify).toBe(false);
    });

    test("is off for any NODE_ENV that is not exactly production", () => {
      /*
       * isDev is `NODE_ENV !== "production"`, so anything else - including the
       * "test" jest itself sets, and a capitalised "Production" typo in a CI
       * variable - has to land on the development side rather than silently
       * half-enabling a production build.
       */
      for (const nodeEnv of ["test", "staging", "Production", "PRODUCTION"]) {
        expect([nodeEnv, readConfig(nodeEnv).minify]).toEqual([nodeEnv, false]);
      }
    });

    test("agrees with the NODE_ENV baked into the bundle", () => {
      /*
       * Both come off the same isDev, so they can never disagree - but a
       * bundle that defines process.env.NODE_ENV as "production" (stripping
       * React's dev warnings) while shipping unminified is exactly the
       * half-configured state this guards.
       */
      expect(readConfig("production").definedNodeEnv).toBe("production");
      expect(readConfig("production").minify).toBe(true);

      expect(readConfig(null).definedNodeEnv).toBe("development");
      expect(readConfig(null).minify).toBe(false);
    });

    test("is enabled for every one of the five frontends", () => {
      /*
       * All five go through the same createConfig, so this is really a guard
       * against someone adding a per-service opt-out later.
       */
      for (const [serviceName, publicPath] of FRONTENDS) {
        const config: ConfigSnapshot = readConfig(
          "production",
          publicPath,
          serviceName,
        );

        expect([serviceName, config.minify]).toEqual([serviceName, true]);
      }
    });
  });

  describe("keepNames", () => {
    test("is on so minification cannot rename functions or classes", () => {
      /*
       * esbuild renames functions and classes when minifying. Anything reading
       * fn.name or instance.constructor.name at runtime - error classes that
       * switch on their own name, displayName inference - breaks only in
       * production, only after a deploy.
       */
      expect(readConfig("production").keepNames).toBe(true);
    });

    test("is on in development too, so both modes behave identically", () => {
      /*
       * If keepNames were gated on production, a name-dependent bug would
       * behave differently in dev than in the image - which is the situation
       * keepNames exists to prevent.
       */
      expect(readConfig(null).keepNames).toBe(true);
      expect(readConfig("development").keepNames).toBe(true);
    });
  });

  describe("sourcemaps (unchanged behaviour)", () => {
    test("stay inline in development", () => {
      expect(readConfig(null).sourcemap).toBe("inline");
      expect(readConfig("development").sourcemap).toBe("inline");
    });

    test("stay off in production", () => {
      /*
       * Turning minification on is not licence to start emitting sourcemaps:
       * that would put the readable sources back into the image and undo most
       * of the size win.
       */
      expect(readConfig("production").sourcemap).toBe(false);
    });
  });

  describe("everything else the build depends on", () => {
    test("keeps the exact same set of config fields in both modes", () => {
      /*
       * esbuild ignores nothing quietly, but a field dropped while editing
       * this file - splitting, publicPath, resolveExtensions - produces a
       * build that still succeeds and a frontend that does not load. The key
       * list is the tripwire.
       */
      const expectedKeys: Array<string> = [
        "entryPoints",
        "bundle",
        "outdir",
        "format",
        "platform",
        "target",
        "sourcemap",
        "minify",
        "keepNames",
        "treeShaking",
        "splitting",
        "publicPath",
        "define",
        "external",
        "alias",
        "plugins",
        "loader",
        "resolveExtensions",
        "metafile",
      ];

      expect(readConfig("production").keys.sort()).toEqual(
        [...expectedKeys].sort(),
      );
      expect(readConfig(null).keys.sort()).toEqual([...expectedKeys].sort());
    });

    test("keeps format, target, platform, splitting and tree shaking", () => {
      for (const nodeEnv of ["production", null]) {
        const config: ConfigSnapshot = readConfig(nodeEnv);

        expect([
          nodeEnv,
          config.format,
          config.platform,
          config.target,
          config.splitting,
          config.treeShaking,
          config.bundle,
        ]).toEqual([nodeEnv, "esm", "browser", "es2017", true, true, true]);
      }
    });

    test("keeps the entry point, outdir and publicPath each service relies on", () => {
      const config: ConfigSnapshot = readConfig(
        "production",
        "/status-page/dist/",
        "StatusPage",
      );

      expect(config.entryPoints).toEqual(["./src/Index.tsx"]);
      expect(config.outdir).toBe("./public/dist");
      expect(config.publicPath).toBe("/status-page/dist/");
    });

    test("keeps the loaders, resolveExtensions and externals", () => {
      const config: ConfigSnapshot = readConfig("production");

      expect(config.loader).toEqual({
        ".tsx": "tsx",
        ".ts": "ts",
        ".jsx": "jsx",
        ".js": "js",
        ".json": "json",
      });
      expect(config.resolveExtensions).toEqual([
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".json",
        ".css",
        ".scss",
      ]);
      expect(config.external).toEqual(["react-native-sqlite-storage"]);
    });

    test("keeps all four plugins wired, in order", () => {
      /*
       * Minified output still has to go through the mermaid and refractor
       * shims and the CSS/asset loaders - dropping one produces a build error
       * for mermaid but a silently unstyled page for CSS.
       */
      expect(readConfig("production").pluginNames).toEqual([
        "mermaid-prebundled",
        "refractor-compatibility",
        "css",
        "file-loader",
      ]);
    });

    test("leaves the metafile gated on the analyze flag, not on NODE_ENV", () => {
      expect(readConfig("production").metafile).toBe(false);
      expect(readConfig(null).metafile).toBe(false);
    });
  });

  describe("Monaco asset path (unchanged: one copy per frontend)", () => {
    /*
     * Each frontend still resolves Monaco under its own route prefix, because
     * that is the only path the running server actually serves: in production
     * a single App container mounts /usr/src/app/FeatureSet/<Service>/public
     * at /<prefix> (App/FeatureSet/Frontend/Index.ts). There is no root-level
     * /assets mount in production - App/Index.ts does not pass isFrontendApp,
     * so StartServer.ts's ExpressStatic("/usr/src/app/public") never runs -
     * and nginx has no /assets location either. Collapsing these five paths to
     * one shared path would 404 the editor offline, which is the exact failure
     * copyMonacoAssets exists to prevent.
     */
    test("resolves under each service's own public path", () => {
      const expected: Array<[string, string]> = [
        ["Accounts", "/accounts/assets/monaco/vs"],
        ["Dashboard", "/dashboard/assets/monaco/vs"],
        ["AdminDashboard", "/admin/assets/monaco/vs"],
        ["StatusPage", "/status-page/assets/monaco/vs"],
        ["PublicDashboard", "/public-dashboard/assets/monaco/vs"],
      ];

      for (let index: number = 0; index < FRONTENDS.length; index++) {
        const [serviceName, publicPath] = FRONTENDS[index] as [string, string];
        const [, expectedPath] = expected[index] as [string, string];

        const config: ConfigSnapshot = readConfig(
          "production",
          publicPath,
          serviceName,
        );

        expect([serviceName, config.monacoAssetPath]).toEqual([
          serviceName,
          expectedPath,
        ]);
      }
    });

    test("does not change between development and production builds", () => {
      expect(readConfig(null).monacoAssetPath).toBe(
        readConfig("production").monacoAssetPath,
      );
    });
  });

  describe("esbuild actually honours the produced config", () => {
    /*
     * Everything above asserts on the config object. This runs esbuild with
     * it, so an option esbuild rejects (or silently ignores) cannot pass.
     */
    interface BuildResult {
      ok: boolean;
      error: string;
      output: string;
    }

    function buildFixture(nodeEnv: string | null): BuildResult {
      const root: string = makeTempDir("oneuptime-esbuild-config-");
      const entry: string = path.join(root, "Entry.js");
      const outdir: string = path.join(root, "out");

      fs.writeFileSync(
        entry,
        `
        export class MyDistinctiveClassName {
          constructor(theFirstArgument, theSecondArgument) {
            this.total = theFirstArgument + theSecondArgument;
          }
        }

        export function myDistinctiveFunctionName(aLongParameterName) {
          const anUnusedLocalVariableName = aLongParameterName * 2;
          return anUnusedLocalVariableName + 1;
        }

        globalThis.result = new MyDistinctiveClassName(
          1,
          myDistinctiveFunctionName(2),
        );
        `,
      );

      const script: string = `
        const c = require(${JSON.stringify(ESBUILD_CONFIG)});
        const fs = require("fs");
        const path = require("path");

        /*
         * esbuild lives in Common/node_modules, so it has to be resolved
         * relative to esbuild-config.js rather than to this script's cwd -
         * which is the repository root, exactly as in the Tailwind copy test.
         */
        const esbuild = require(require.resolve("esbuild", {
          paths: [path.dirname(${JSON.stringify(ESBUILD_CONFIG)})],
        }));

        const cfg = c.createConfig({
          serviceName: "Dashboard",
          publicPath: "/dashboard/dist/",
        });

        cfg.entryPoints = [${JSON.stringify(entry)}];
        cfg.outdir = ${JSON.stringify(outdir)};

        esbuild.build(cfg).then(function () {
          const file = path.join(${JSON.stringify(outdir)}, "Entry.js");
          console.log(JSON.stringify({
            ok: true,
            error: "",
            output: fs.readFileSync(file, "utf8"),
          }));
        }).catch(function (error) {
          console.log(JSON.stringify({
            ok: false,
            error: String((error && error.message) || error),
            output: "",
          }));
        });
      `;

      return JSON.parse(runNode(script, nodeEnv)) as BuildResult;
    }

    test("produces minified output for a production build", () => {
      const result: BuildResult = buildFixture("production");

      expect([result.ok, result.error]).toEqual([true, ""]);

      /*
       * Minified esbuild output collapses to very few lines and drops the
       * source's indentation entirely.
       */
      expect(result.output.split("\n").length).toBeLessThan(5);
      expect(result.output).not.toContain("\n          ");
      expect(result.output).not.toContain("anUnusedLocalVariableName");
    });

    test("keeps class and function names in that minified output", () => {
      /*
       * The keepNames guarantee, proven against the real minifier rather than
       * against the config field.
       */
      const result: BuildResult = buildFixture("production");

      expect(result.output).toContain("MyDistinctiveClassName");
      expect(result.output).toContain("myDistinctiveFunctionName");
    });

    test("produces readable output with an inline sourcemap in development", () => {
      const result: BuildResult = buildFixture(null);

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(result.output).toContain("anUnusedLocalVariableName");
      expect(result.output).toContain("sourceMappingURL=data:application/json");
    });

    test("emits no sourcemap in the production build", () => {
      const result: BuildResult = buildFixture("production");

      expect(result.output).not.toContain("sourceMappingURL");
    });

    /*
     * The dev bundle carries an inline base64 sourcemap that is several times
     * the size of the code it maps. Comparing raw lengths against it is
     * vacuous - the production bundle comes out smaller whether or not it is
     * minified, so the assertion passes just as happily on a `minify: false`
     * config. Strip the map and compare code against code.
     */
    function withoutInlineSourcemap(output: string): string {
      return output.replace(/\n?\/\/# sourceMappingURL=[^\n]*\n?/g, "");
    }

    test("makes the production bundle at least 20% smaller than the dev code", () => {
      /*
       * The size win is the entire reason for the change, so assert on bytes
       * and not only on the flag.
       */
      const production: BuildResult = buildFixture("production");
      const development: BuildResult = buildFixture(null);

      expect([production.ok, development.ok]).toEqual([true, true]);

      // Guard the strip: if esbuild ever stopped emitting the inline map, the
      // regex would silently become a no-op and the comparison would change
      // meaning without anything saying so.
      expect(development.output).toContain("sourceMappingURL");

      const developmentCode: string = withoutInlineSourcemap(
        development.output,
      );

      expect(developmentCode).not.toContain("sourceMappingURL");

      const productionBytes: number = production.output.length;
      const developmentBytes: number = developmentCode.length;

      expect([productionBytes > 0, developmentBytes > 0]).toEqual([true, true]);

      /*
       * Measured at 0.35 on this fixture (325 bytes against ~910; the dev
       * output embeds the temp entry's path as a comment, so its exact size
       * moves with the tmpdir) and 0.54 on a real frontend bundle (2,636,716
       * against 4,842,357). Against a `minify: false` config the two outputs
       * are the same code and the ratio measures 1.002, so the budget below is
       * what makes this test load-bearing rather than decorative. 0.8 is
       * deliberately loose: it tracks "minification is on" rather than
       * esbuild's exact codegen, which shifts between versions.
       */
      expect(productionBytes / developmentBytes).toBeLessThanOrEqual(0.8);
    });
  });
});
