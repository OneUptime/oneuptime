import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PackageFromSeveralInstalls,
  SINGLE_COPY_PLUGIN_NAME,
  SingleCopyMetafile,
  canStandIn,
  installedPackageFolder,
  packageNameOf,
  packagesFromSeveralInstalls,
} from "../../UI/esbuild-single-copy";

/*
 * ONE COPY OF EACH PACKAGE IN A FRONTEND'S BUNDLE (issue #9335).
 *
 * Common and each frontend install their packages apart, and esbuild takes a
 * package from the install nearest the importing file, so a public dashboard
 * bundled recharts twice: Common's charts took Common's copy, the
 * Dashboard's widgets the Dashboard's. UI/esbuild-single-copy.js gives an
 * import from outside Common Common's copy instead, when Common's copy can
 * stand in for the other.
 *
 * The builds run in a node subprocess: esbuild refuses to load under the
 * jsdom environment Common's jest uses (see EsbuildConfig.test.ts). Each
 * install is a physical folder of its own, as npm makes them: a symlink
 * would resolve to one real path and hide the duplicate.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const PLUGIN_MODULE: string = path.join(
  COMMON_ROOT,
  "UI",
  "esbuild-single-copy.js",
);
const ESBUILD_CONFIG: string = path.join(
  COMMON_ROOT,
  "UI",
  "esbuild-config.js",
);

const temporaryRoots: Array<string> = [];

function makeTemporaryRoot(prefix: string): string {
  const root: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function runNode(script: string, cwd: string, nodeEnv: string): string {
  return childProcess.execFileSync(process.execPath, ["-e", script], {
    cwd,
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe("the package a bare specifier names", () => {
  test.each([
    ["recharts", "recharts"],
    ["recharts/types/util/types", "recharts"],
    ["@reduxjs/toolkit", "@reduxjs/toolkit"],
    ["@reduxjs/toolkit/query/react", "@reduxjs/toolkit"],
    ["Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart", "Common"],
    ["react-dom/client", "react-dom"],
  ])("%s names %s", (specifier: string, name: string) => {
    expect(packageNameOf(specifier)).toBe(name);
  });

  test.each([
    ["./Chart"],
    ["../Utils/Chart"],
    ["/home/someone/packages/Common/UI/Chart"],
    ["@scope"],
    ["@/x"],
    [""],
  ])("%s names none", (specifier: string) => {
    expect(packageNameOf(specifier)).toBeNull();
  });
});

describe("whether Common's copy can stand in for another install's", () => {
  test.each([
    // The same version always can.
    ["3.8.1", "3.8.1", true],
    // Newer, in the same major: a patch, a minor.
    ["11.11.4", "11.11.3", true],
    ["3.9.0", "3.8.5", true],
    ["2.12.0", "2.11.2", true],
    // Older, in the same major, cannot: the other code may need what it added.
    ["11.11.3", "11.11.4", false],
    ["3.8.1", "3.9.0", false],
    // Another major is another API, newer or older.
    ["4.0.0", "3.8.1", false],
    ["2.15.0", "3.8.1", false],
    // Below 1.0.0 each minor may break: the minor must match.
    ["0.4.9", "0.8.3", false],
    ["0.8.3", "0.4.9", false],
    ["0.4.9", "0.4.3", true],
    ["0.4.3", "0.4.9", false],
    // Below 0.1.0 each patch may: only the same version.
    ["0.0.5", "0.0.3", false],
    ["0.0.3", "0.0.3", true],
    // Across 1.0.0.
    ["1.0.0", "0.9.0", false],
    // A prerelease, a build tag or a version missing stands in for itself alone.
    ["3.0.0-beta.2", "3.0.0-beta.1", false],
    ["3.0.0-beta.1", "3.0.0-beta.1", true],
    ["3.0.0", "3.0.0-beta.1", false],
    ["3.8.1+build.7", "3.8.0", false],
    ["latest", "3.8.1", false],
    ["", "", false],
  ])(
    "Common's %s for another's %s: %s",
    (common: string, own: string, standsIn: boolean) => {
      expect(canStandIn(common, own)).toBe(standsIn);
    },
  );

  test("with sameVersionOnly, only the same version can", () => {
    expect(canStandIn("3.8.1", "3.8.1", true)).toBe(true);
    expect(canStandIn("11.11.4", "11.11.3", true)).toBe(false);
    expect(canStandIn("3.9.0", "3.8.5", true)).toBe(false);
  });

  test("a version that is not there stands in for nothing", () => {
    expect(canStandIn(null, "3.8.1")).toBe(false);
    expect(canStandIn("3.8.1", undefined)).toBe(false);
    expect(canStandIn(null, null)).toBe(false);
  });
});

describe("the installed package a resolved file belongs to", () => {
  const separator: string = path.sep;
  const join: (...parts: Array<string>) => string = (
    ...parts: Array<string>
  ): string => {
    return parts.join(separator);
  };

  test("is its path up to the last node_modules/<name>", () => {
    expect(
      installedPackageFolder(
        join("", "app", "node_modules", "recharts", "es6", "index.js"),
        "recharts",
      ),
    ).toBe(join("", "app", "node_modules", "recharts"));

    // A copy nested inside another package's install.
    expect(
      installedPackageFolder(
        join(
          "",
          "app",
          "node_modules",
          "recharts",
          "node_modules",
          "react-redux",
          "dist",
          "react-redux.mjs",
        ),
        "react-redux",
      ),
    ).toBe(
      join(
        "",
        "app",
        "node_modules",
        "recharts",
        "node_modules",
        "react-redux",
      ),
    );

    expect(
      installedPackageFolder(
        join("", "app", "node_modules", "@reduxjs", "toolkit", "index.js"),
        "@reduxjs/toolkit",
      ),
    ).toBe(join("", "app", "node_modules", "@reduxjs", "toolkit"));
  });

  test("is none when the file is not in that package", () => {
    // A browser field sent the import to another package.
    expect(
      installedPackageFolder(
        join("", "app", "node_modules", "other", "index.js"),
        "recharts",
      ),
    ).toBeNull();
    // A name that only starts like it.
    expect(
      installedPackageFolder(
        join("", "app", "node_modules", "recharts-extra", "index.js"),
        "recharts",
      ),
    ).toBeNull();
    expect(
      installedPackageFolder(join("", "app", "src", "Chart.tsx"), "recharts"),
    ).toBeNull();
  });
});

describe("the packages a build bundled from more than one install", () => {
  const imports: (...paths: Array<string>) => {
    imports: Array<{ path: string }>;
  } = (...paths: Array<string>): { imports: Array<{ path: string }> } => {
    return {
      imports: paths.map((importedPath: string) => {
        return { path: importedPath };
      }),
    };
  };

  // A public dashboard's build, before Common's copy stood in for the Dashboard's.
  const METAFILE: SingleCopyMetafile = {
    inputs: {
      "../../../Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx":
        imports("../../../Common/node_modules/recharts/es6/index.js"),
      "../Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent.tsx":
        imports(
          "../Dashboard/node_modules/recharts/es6/index.js",
          // A type a bundler drops, from Common's own folder: not a package.
          "../../../Common/UI/Components/Charts/Utils/YAxisWidth.ts",
        ),
      "../Dashboard/node_modules/recharts/es6/index.js": imports(
        "../Dashboard/node_modules/@reduxjs/toolkit/dist/redux-toolkit.modern.mjs",
      ),
      "../../../Common/node_modules/recharts/es6/index.js": imports(
        "../../../Common/node_modules/@reduxjs/toolkit/dist/redux-toolkit.modern.mjs",
      ),
      "src/Index.tsx": imports(
        "node_modules/use-async-effect/index.js",
        "react-native-sqlite-storage",
      ),
      "../../../Common/UI/Utils/UseAsyncEffect.ts": imports(
        "../../../Common/node_modules/use-async-effect/index.js",
      ),
    },
    outputs: {
      "public/dist/Index.js": {
        inputs: {
          "src/Index.tsx": { bytesInOutput: 300 },
          "node_modules/use-async-effect/index.js": { bytesInOutput: 200 },
          "../../../Common/node_modules/use-async-effect/index.js": {
            bytesInOutput: 210,
          },
          "../../../Common/node_modules/recharts/es6/index.js": {
            bytesInOutput: 1000,
          },
          "../../../Common/node_modules/recharts/es6/chart/LineChart.js": {
            bytesInOutput: 4000,
          },
          // Mermaid's own second version of stylis, inside Common's install.
          "../../../Common/node_modules/mermaid/node_modules/stylis/dist/stylis.mjs":
            { bytesInOutput: 4400 },
          "../../../Common/node_modules/stylis/dist/stylis.mjs": {
            bytesInOutput: 4700,
          },
        },
      },
      "public/dist/chunk-WIDGETS.js": {
        inputs: {
          "../Dashboard/node_modules/recharts/es6/index.js": {
            bytesInOutput: 990,
          },
          "../Dashboard/node_modules/recharts/es6/chart/LineChart.js": {
            bytesInOutput: 3990,
          },
          "../Dashboard/node_modules/@reduxjs/toolkit/dist/redux-toolkit.modern.mjs":
            { bytesInOutput: 16000 },
          "../../../Common/node_modules/@reduxjs/toolkit/dist/redux-toolkit.modern.mjs":
            { bytesInOutput: 15800 },
          // Tree-shaken to nothing, and a module a browser field turned off.
          "../Dashboard/node_modules/decimal.js-light/decimal.mjs": {
            bytesInOutput: 0,
          },
          "../../../Common/node_modules/decimal.js-light/decimal.mjs": {
            bytesInOutput: 13500,
          },
          "(disabled):../Dashboard/node_modules/eventemitter3/index.js": {
            bytesInOutput: 10,
          },
          "../../../Common/node_modules/eventemitter3/index.mjs": {
            bytesInOutput: 3000,
          },
        },
      },
    },
  };

  let found: Array<PackageFromSeveralInstalls> = [];

  beforeAll(() => {
    found = packagesFromSeveralInstalls(METAFILE);
  });

  test("lists each, by name, with each install's copy and its bytes", () => {
    expect(
      found.map((bundled: PackageFromSeveralInstalls) => {
        return bundled.name;
      }),
    ).toEqual(["@reduxjs/toolkit", "recharts", "use-async-effect"]);

    expect(
      found.find((bundled: PackageFromSeveralInstalls) => {
        return bundled.name === "recharts";
      }),
    ).toEqual({
      name: "recharts",
      installs: [
        {
          install: "../../../Common/node_modules",
          bytes: 5000,
          importedByOwnCode: true,
        },
        {
          install: "../Dashboard/node_modules",
          bytes: 4980,
          importedByOwnCode: true,
        },
      ],
    });
  });

  test("tells a copy OneUptime's code imports from one only packages bring", () => {
    expect(
      found.find((bundled: PackageFromSeveralInstalls) => {
        return bundled.name === "@reduxjs/toolkit";
      }),
    ).toEqual({
      name: "@reduxjs/toolkit",
      installs: [
        {
          install: "../../../Common/node_modules",
          bytes: 15800,
          importedByOwnCode: false,
        },
        {
          install: "../Dashboard/node_modules",
          bytes: 16000,
          importedByOwnCode: false,
        },
      ],
    });

    // A frontend's own install, at the top of its folder.
    expect(
      found.find((bundled: PackageFromSeveralInstalls) => {
        return bundled.name === "use-async-effect";
      }),
    ).toEqual({
      name: "use-async-effect",
      installs: [
        {
          install: "../../../Common/node_modules",
          bytes: 210,
          importedByOwnCode: true,
        },
        { install: "node_modules", bytes: 200, importedByOwnCode: true },
      ],
    });
  });

  test("leaves out a second version npm nests inside one install, and copies that put no bytes in the output", () => {
    const names: Array<string> = found.map(
      (bundled: PackageFromSeveralInstalls) => {
        return bundled.name;
      },
    );

    expect(names).not.toContain("stylis");
    expect(names).not.toContain("decimal.js-light");
    expect(names).not.toContain("eventemitter3");
  });

  test("finds nothing in a build of one copy each, or in an empty one", () => {
    expect(
      packagesFromSeveralInstalls({
        outputs: {
          "public/dist/Index.js": {
            inputs: {
              "../../../Common/node_modules/recharts/es6/index.js": {
                bytesInOutput: 1000,
              },
              "src/Index.tsx": { bytesInOutput: 300 },
            },
          },
        },
      }),
    ).toEqual([]);
    expect(packagesFromSeveralInstalls({ outputs: {} })).toEqual([]);
  });

  test("reads every copy as packages' alone when the metafile names no imports", () => {
    const withoutImports: Array<PackageFromSeveralInstalls> =
      packagesFromSeveralInstalls({ outputs: METAFILE.outputs });

    expect(
      withoutImports.every((bundled: PackageFromSeveralInstalls) => {
        return bundled.installs.every(
          (copy: PackageFromSeveralInstalls["installs"][number]) => {
            return !copy.importedByOwnCode;
          },
        );
      }),
    ).toBe(true);
  });
});

/*
 * The plugin alone, in a world of two installs it makes: a Common folder and
 * an app folder, each with packages of its own, one for each case. Every
 * package exports a marker naming the install and version it came from, and
 * the app's entry collects the markers of what it imports, so the bundle says
 * which copy each import took.
 */
describe("the plugin, between two installs", () => {
  interface FixturePackage {
    name: string;
    version: string;
    // Extra package.json fields: exports, browser, sideEffects.
    fields?: Record<string, unknown>;
    // Files besides index.js, by path inside the package.
    files?: Record<string, string>;
  }

  interface Built {
    ok: boolean;
    error: string;
    markers: Array<string>;
    output: string;
    inputs: Array<string>;
  }

  // Both installs, each case's versions in turn.
  const BOTH: Array<[string, string, string]> = [
    ["same-version", "1.2.3", "1.2.3"],
    ["common-newer-patch", "1.2.4", "1.2.3"],
    ["common-newer-minor", "1.3.0", "1.2.3"],
    ["common-older", "1.2.2", "1.2.3"],
    ["other-major", "2.0.0", "1.2.3"],
    ["zero-minor-differs", "0.5.0", "0.4.0"],
    ["zero-patch-newer", "0.4.2", "0.4.1"],
    ["@scope/scoped", "1.0.0", "1.0.0"],
    ["cjs-lib", "1.0.0", "1.0.0"],
    ["aliased-lib", "1.0.0", "1.0.0"],
    ["transitive-same", "1.0.0", "1.0.0"],
    ["transitive-newer", "1.0.1", "1.0.0"],
  ];

  let root: string = "";
  let built: Built = {
    ok: false,
    error: "not built",
    markers: [],
    output: "",
    inputs: [],
  };

  function writePackage(installRoot: string, fixture: FixturePackage): void {
    const folder: string = path.join(installRoot, "node_modules", fixture.name);
    // "Common:recharts@3.8.1": the install's folder, the package and its version.
    const where: string = `${path.basename(installRoot)}:${fixture.name}@${fixture.version}`;

    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "package.json"),
      JSON.stringify({
        name: fixture.name,
        version: fixture.version,
        main: "index.js",
        ...(fixture.fields || {}),
      }),
    );
    fs.writeFileSync(
      path.join(folder, "index.js"),
      `export const marker = ${JSON.stringify(where)};\n`,
    );

    for (const [file, contents] of Object.entries(fixture.files || {})) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(
        path.join(folder, file),
        contents.split("<where>").join(where),
      );
    }
  }

  beforeAll(() => {
    root = makeTemporaryRoot("single-copy-");
    const common: string = path.join(root, "Common");
    const app: string = path.join(root, "App");

    for (const [name, commonVersion, appVersion] of BOTH) {
      const files: Record<string, string> =
        name === "cjs-lib"
          ? { "index.js": 'module.exports = { marker: "<where>" };\n' }
          : {};
      writePackage(common, { name, version: commonVersion, files });
      writePackage(app, { name, version: appVersion, files });
    }

    // A subpath published through an exports map only.
    for (const installRoot of [common, app]) {
      writePackage(installRoot, {
        name: "with-exports",
        version: "1.0.0",
        fields: { exports: { ".": "./index.js", "./sub": "./lib/sub.js" } },
        files: { "lib/sub.js": 'export const marker = "<where>/sub";\n' },
      });
    }

    // Common's copy picks a browser file, as the build's platform does.
    writePackage(common, {
      name: "browser-lib",
      version: "1.0.0",
      fields: { browser: "browser.js" },
      files: { "browser.js": 'export const marker = "<where>/browser";\n' },
    });
    writePackage(app, { name: "browser-lib", version: "1.0.0" });

    // Has no side effects: an import of it nothing reads leaves no code.
    for (const installRoot of [common, app]) {
      writePackage(installRoot, {
        name: "side-effect-free",
        version: "1.0.0",
        fields: { sideEffects: false },
        files: {
          "index.js":
            'globalThis.sideEffectFreeRan = "<where>";\nexport const unused = 1;\n',
        },
      });
    }

    // Installed with the app alone.
    writePackage(app, { name: "only-in-app", version: "1.0.0" });

    // A package of the app's install that imports two of the cases itself.
    writePackage(app, {
      name: "app-only-pkg",
      version: "1.0.0",
      files: {
        "index.js": [
          'import { marker as same } from "transitive-same";',
          'import { marker as newer } from "transitive-newer";',
          "export const markers = [same, newer];",
          "",
        ].join("\n"),
      },
    });

    // Common's own code imports Common's copies.
    fs.mkdirSync(path.join(common, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(common, "src", "Uses.js"),
      'export { marker } from "same-version";\n',
    );

    const entry: string = path.join(app, "src", "Entry.js");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(
      entry,
      [
        ...BOTH.filter(([name]: [string, string, string]) => {
          return !["cjs-lib", "transitive-same", "transitive-newer"].includes(
            name,
          );
        }).map(([name]: [string, string, string], index: number) => {
          return `import { marker as m${index} } from ${JSON.stringify(name)};`;
        }),
        'import { marker as subpath } from "with-exports/sub";',
        'import { marker as browser } from "browser-lib";',
        'import { marker as onlyInApp } from "only-in-app";',
        'import { markers as fromAppPackage } from "app-only-pkg";',
        'import { unused } from "side-effect-free";',
        'import { marker as common } from "../../Common/src/Uses.js";',
        'const cjs = require("cjs-lib").marker;',
        `globalThis.markers = [${BOTH.filter(
          ([name]: [string, string, string]) => {
            return !["cjs-lib", "transitive-same", "transitive-newer"].includes(
              name,
            );
          },
        )
          .map((_case: [string, string, string], index: number) => {
            return `m${index}`;
          })
          .join(
            ", ",
          )}, subpath, browser, onlyInApp, ...fromAppPackage, common, cjs];`,
        "",
      ].join("\n"),
    );

    const script: string = `
      const path = require("path");
      const vm = require("vm");
      const esbuild = require(require.resolve("esbuild", { paths: [${JSON.stringify(COMMON_ROOT)}] }));
      const { createSingleCopyPlugin } = require(${JSON.stringify(PLUGIN_MODULE)});

      esbuild.build({
        absWorkingDir: ${JSON.stringify(app)},
        entryPoints: [${JSON.stringify(entry)}],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        metafile: true,
        logLevel: "silent",
        alias: {
          "aliased-lib": ${JSON.stringify(path.join(app, "node_modules", "aliased-lib"))},
        },
        plugins: [createSingleCopyPlugin({ commonRoot: ${JSON.stringify(common)} })],
      }).then((result) => {
        const output = result.outputFiles[0].text;
        const context = {};
        vm.runInNewContext(output, context);
        console.log(JSON.stringify({
          ok: true,
          error: "",
          markers: context.markers,
          output,
          inputs: Object.keys(result.metafile.inputs),
        }));
      }).catch((error) => {
        console.log(JSON.stringify({ ok: false, error: String(error), markers: [], output: "", inputs: [] }));
      });
    `;

    built = JSON.parse(runNode(script, app, "production")) as Built;
  }, 120000);

  test("builds", () => {
    expect([built.ok, built.error]).toEqual([true, ""]);
  });

  test.each([
    ["same-version", "Common:same-version@1.2.3"],
    ["common-newer-patch", "Common:common-newer-patch@1.2.4"],
    ["common-newer-minor", "Common:common-newer-minor@1.3.0"],
    ["zero-patch-newer", "Common:zero-patch-newer@0.4.2"],
    ["@scope/scoped", "Common:@scope/scoped@1.0.0"],
  ])(
    "the app's import of %s takes Common's copy, which stands in for its own",
    (_name: string, marker: string) => {
      expect(built.markers).toContain(marker);
    },
  );

  test.each([
    ["common-older", "App:common-older@1.2.3"],
    ["other-major", "App:other-major@1.2.3"],
    ["zero-minor-differs", "App:zero-minor-differs@0.4.0"],
  ])(
    "the app's import of %s keeps its own copy, which Common's cannot stand in for",
    (_name: string, marker: string) => {
      expect(built.markers).toContain(marker);
    },
  );

  test("a subpath an exports map publishes resolves in Common's copy, through its exports map", () => {
    expect(built.markers).toContain("Common:with-exports@1.0.0/sub");
  });

  test("Common's copy resolves as the build's platform asks: its browser file", () => {
    expect(built.markers).toContain("Common:browser-lib@1.0.0/browser");
  });

  test("a package Common does not install resolves in the app's install, as before", () => {
    expect(built.markers).toContain("App:only-in-app@1.0.0");
  });

  test("a require() takes Common's copy too", () => {
    expect(built.markers).toContain("Common:cjs-lib@1.0.0");
  });

  test("an aliased specifier is left to its alias", () => {
    expect(built.markers).toContain("App:aliased-lib@1.0.0");
  });

  test("a package of the app's install takes Common's copy of the same version, and keeps its own of any other", () => {
    expect(built.markers).toContain("Common:transitive-same@1.0.0");
    expect(built.markers).toContain("App:transitive-newer@1.0.0");
  });

  test("Common's own code keeps Common's copy, which the app's import now shares", () => {
    expect(
      built.markers.filter((marker: string) => {
        return marker === "Common:same-version@1.2.3";
      }).length,
    ).toBe(2);
    expect(built.output).not.toContain("App:same-version@1.2.3");
  });

  test("Common's copy keeps its package's sideEffects: an import nothing reads leaves no code", () => {
    expect(built.output).not.toContain("sideEffectFreeRan");
  });

  test("the bundle holds one copy of each package Common's copy stands in for", () => {
    const appInstall: string = path.join("node_modules", "same-version");

    expect(
      built.inputs.filter((input: string) => {
        return input.startsWith(appInstall);
      }),
    ).toEqual([]);
  });
});

/*
 * The shared config (UI/esbuild-config.js), with recharts installed twice as
 * the Dashboard and Common install it: a copy of Common's in a frontend's own
 * node_modules. The frontend's entry imports recharts, and Common's chart
 * annotations, which import it from Common's code. Built without the plugin
 * too, so the duplicate it removes is shown to be there.
 */
describe("the shared build config, with recharts installed in a frontend and in Common", () => {
  interface RechartsBuild {
    ok: boolean;
    error: string;
    rechartsInstalls: Array<string>;
    severalInstalls: Array<string>;
    pluginNames: Array<string>;
  }

  const builds: Map<string, RechartsBuild> = new Map<string, RechartsBuild>();
  let frontend: string = "";

  function buildRecharts(nodeEnv: string, withPlugin: boolean): RechartsBuild {
    const entry: string = path.join(frontend, "src", "Entry.tsx");
    const script: string = `
      const path = require("path");
      const esbuild = require(require.resolve("esbuild", { paths: [${JSON.stringify(COMMON_ROOT)}] }));
      const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
      const { packagesFromSeveralInstalls } = require(${JSON.stringify(PLUGIN_MODULE)});

      const config = createConfig({
        serviceName: "PublicDashboard",
        publicPath: "/public-dashboard/dist/",
        entryPoint: ${JSON.stringify(entry)},
      });
      const plugins = config.plugins.filter((plugin) => {
        return ${withPlugin ? "true" : `plugin.name !== ${JSON.stringify(SINGLE_COPY_PLUGIN_NAME)}`};
      });

      esbuild.build({
        ...config,
        plugins,
        // The rest of recharts' dependencies, which this frontend's copy leaves out.
        nodePaths: [${JSON.stringify(path.join(COMMON_ROOT, "node_modules"))}],
        outdir: ${JSON.stringify(path.join(frontend, "dist"))},
        write: false,
        sourcemap: false,
        metafile: true,
        logLevel: "silent",
      }).then((result) => {
        const installs = new Set();

        for (const input of Object.keys(result.metafile.inputs)) {
          const index = input.lastIndexOf("node_modules/recharts/");

          if (index !== -1 && !input.slice(index).includes("/node_modules/", 1)) {
            installs.add(path.resolve(input.slice(0, index + "node_modules/recharts".length)));
          }
        }

        console.log(JSON.stringify({
          ok: true,
          error: "",
          rechartsInstalls: [...installs].sort(),
          severalInstalls: packagesFromSeveralInstalls(result.metafile).map((found) => found.name),
          pluginNames: plugins.map((plugin) => plugin.name),
        }));
      }).catch((error) => {
        console.log(JSON.stringify({ ok: false, error: String(error), rechartsInstalls: [], severalInstalls: [], pluginNames: [] }));
      });
    `;

    return JSON.parse(runNode(script, frontend, nodeEnv)) as RechartsBuild;
  }

  beforeAll(() => {
    const root: string = makeTemporaryRoot("single-copy-recharts-");
    frontend = path.join(root, "Frontend");

    fs.cpSync(
      path.join(COMMON_ROOT, "node_modules", "recharts"),
      path.join(frontend, "node_modules", "recharts"),
      { recursive: true, dereference: true },
    );
    fs.mkdirSync(path.join(frontend, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(frontend, "src", "Entry.tsx"),
      [
        'import { Surface, ResponsiveContainer } from "recharts";',
        `import ChartAnnotationLayer from ${JSON.stringify(
          path.join(
            COMMON_ROOT,
            "UI/Components/Charts/ChartLibrary/Annotations/ChartAnnotationLayer",
          ),
        )};`,
        "export { Surface, ResponsiveContainer, ChartAnnotationLayer };",
        "",
      ].join("\n"),
    );

    for (const nodeEnv of ["production", "development"]) {
      builds.set(`${nodeEnv} with`, buildRecharts(nodeEnv, true));
    }
    builds.set("production without", buildRecharts("production", false));
  }, 300000);

  test("without the plugin, the frontend's copy and Common's are both bundled", () => {
    const built: RechartsBuild = builds.get("production without")!;

    expect([built.ok, built.error]).toEqual([true, ""]);
    expect(built.pluginNames).not.toContain(SINGLE_COPY_PLUGIN_NAME);
    expect(built.rechartsInstalls).toEqual(
      [
        fs.realpathSync(path.join(COMMON_ROOT, "node_modules", "recharts")),
        path.join(frontend, "node_modules", "recharts"),
      ].sort(),
    );
    expect(built.severalInstalls).toContain("recharts");
  });

  test.each(["production", "development"])(
    "in %s, the frontend's import takes Common's copy: one recharts",
    (nodeEnv: string) => {
      const built: RechartsBuild = builds.get(`${nodeEnv} with`)!;

      expect([built.ok, built.error]).toEqual([true, ""]);
      expect(built.pluginNames).toContain(SINGLE_COPY_PLUGIN_NAME);
      expect(built.rechartsInstalls).toEqual([
        fs.realpathSync(path.join(COMMON_ROOT, "node_modules", "recharts")),
      ]);
      expect(built.severalInstalls).toEqual([]);
    },
  );
});
