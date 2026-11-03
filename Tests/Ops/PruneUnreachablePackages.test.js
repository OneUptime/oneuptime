"use strict";

/**
 * Scripts/Docker/PruneUnreachablePackages.js - how the Nginx, Runner and App
 * images keep only the packages their programs reach.
 *
 * The sidecar (packages/Nginx/Index.ts) imports part of Common, and Common's
 * package.json lists every package any part of OneUptime needs: installed as
 * it was, 810 MB of packages (mermaid, React, Playwright, Twilio, ...) went
 * into an image of 1.5 GB (2 GB in `docker images`) whose sidecar loads about
 * 105 MB of them. The image's build stage now walks the sidecar's imports
 * with esbuild and prunes Common to what the walk reaches: 0.7 GB.
 *
 * What has to hold, and what each part of this suite pins:
 *
 *  - The walk: every installed package reached from the entry point counts,
 *    through the program's own files (a linked local package such as Common
 *    is the program's own code) and on into each package and the packages it
 *    requires, nested ones included. A package is resolved the way require()
 *    resolves it (its "require" export, as ts-node runs the sidecar), so a
 *    dual package's ES module and what only that imports do not count. A
 *    package that is not installed is optional (typeorm's other drivers) and
 *    is noted, not fatal. Files that are not code (a .node addon, a
 *    stylesheet) do not stop it. A require.resolve() of a name the code
 *    spells out counts as a require() of it (TypeOrmPatchVersion reads the
 *    package.json beside require.resolve("typeorm")): esbuild never reads the
 *    file it finds, so the walk follows that file itself - a package's main
 *    file, a subpath of one, a file of the program's own, from a package too
 *    - and notes a name that does not resolve, as require() would fail on it.
 *  - What it refuses: a require(), import() or require.resolve() of a
 *    computed name, a require.resolve() with options (esbuild does not record
 *    one, and their paths move where it looks) and a createRequire() in the
 *    program's own files (read with TypeScript's parser, so a comment or a
 *    string that says "require(name)" is not one) - they could need any
 *    package - while one inside a package is fine, since npm keeps a kept
 *    package's own dependencies. And code the program starts beside itself,
 *    whose file esbuild never reads: a new Worker() of worker_threads'
 *    Worker, child_process's fork(), a node started from process.execPath
 *    (the App's external calendar worker requires ical.js, which nothing else
 *    does). And a walk that read nothing, which would prune everything.
 *    Refusing changes nothing.
 *  - Several entries and entry loaders: a program that knowingly starts or
 *    loads code by a computed name walks that code as another --entry, and
 *    names the file that starts or loads it as an --entry-loader, whose
 *    computed loads and starts are then let through. An entry loader has to
 *    be a file the walk read that still loads or starts something by a
 *    computed name. The App's two (its Enterprise loader, and the external
 *    calendar's worker) are pinned here as they read today.
 *  - The prune: only dependencies the walk never reached leave package.json,
 *    every other field stays, then `npm prune --omit=dev --offline` runs in
 *    the package, and it fails if npm removed anything the walk reached.
 *    With real npm, on packages packed and installed for the test: the
 *    unreached package goes with the dependency only it needed and the
 *    development packages, a reached package keeps a dependency of its own
 *    the walk never saw used, and nothing is downloaded.
 *  - The real programs, where their packages are installed (a developer's
 *    checkout, and for the sidecar Ops Config Test's ingress-prune job, which
 *    installs them and sets RUN_REAL_SIDECAR_PRUNE_TESTS=1 so its walk fails
 *    rather than skips without them; the image build itself is the check
 *    everywhere else): the sidecar's and the Runner's walks read their files
 *    without a computed import, the App's finds computed loads and starts
 *    only in its two entry loaders, each reaches what it runs on and none of
 *    the Dashboard's packages, and every package any of them finds missing
 *    is one of the optional ones below.
 *
 * ContainerImageHardening.test.js holds the Nginx, Runner and App Dockerfiles'
 * stages to the script (where it runs, and that only what it leaves ships),
 * and RunnerImageRuntime.test.js starts the Runner image and has it run steps.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const esbuild = require("esbuild");
const typescript = require("typescript");

const {
  NOT_CODE,
  PROCESS_STARTS,
  computedImportsIn,
  directorySize,
  findComputedImports,
  packageDirectoryOf,
  parseArguments,
  pruneUnreachablePackages,
  reachedPackagesNothingKeeps,
  unreachedDependencies,
  walkImports,
  withDependencies,
  withoutDependencies,
} = require("../../Scripts/Docker/PruneUnreachablePackages.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Writes files under root: { "relative/path": "contents" }. */
function writeTree(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
  }
}

function packageJson(name, extra = {}) {
  return { name, version: "1.0.0", ...extra };
}

/*
 * A program laid out as the image lays out the sidecar: app/ imports a linked
 * local package, shared/, as Nginx imports Common, and the packages live in
 * shared/node_modules.
 */
function sidecarLikeProgram() {
  const root = temporaryDirectory("prune-walk-");
  writeTree(root, {
    "app/package.json": packageJson("app"),
    "app/Index.ts": [
      'import Thing from "shared/Thing";',
      'import "./style.css";',
      "export default Thing;",
      "",
    ].join("\n"),
    "app/style.css": "body { color: red; }\n",
    "shared/package.json": packageJson("shared"),
    "shared/Thing.ts": [
      'import alpha from "alpha";',
      'import { dual } from "dual";',
      'import beta from "@scope/beta";',
      'import delta from "delta";',
      'export const later = () => import("lazy");',
      "export default [alpha, dual, beta, delta];",
      "",
    ].join("\n"),
    // alpha requires gamma, an optional package that is not installed, and a
    // name it computes: inside a package, none of it stops the walk.
    "shared/node_modules/alpha/package.json": packageJson("alpha", {
      main: "index.js",
    }),
    "shared/node_modules/alpha/index.js": [
      'const gamma = require("gamma");',
      "let optional = null;",
      'try { optional = require("not-installed-driver"); } catch (error) { optional = null; }',
      "const computed = (name) => require(name);",
      "module.exports = { gamma, optional, computed };",
      "",
    ].join("\n"),
    "shared/node_modules/gamma/package.json": packageJson("gamma", {
      main: "index.js",
    }),
    "shared/node_modules/gamma/index.js": "module.exports = 'gamma';\n",
    // dual's ES module has no default export and imports a package of its
    // own; require() takes its CommonJS file, which imports another.
    "shared/node_modules/dual/package.json": packageJson("dual", {
      exports: { import: "./esm.mjs", require: "./cjs.js" },
    }),
    "shared/node_modules/dual/esm.mjs":
      'import "esm-only";\nexport const somethingElse = 1;\n',
    "shared/node_modules/dual/cjs.js":
      'module.exports = { dual: require("cjs-only") };\n',
    "shared/node_modules/esm-only/package.json": packageJson("esm-only", {
      main: "index.js",
    }),
    "shared/node_modules/esm-only/index.js": "module.exports = 1;\n",
    "shared/node_modules/cjs-only/package.json": packageJson("cjs-only", {
      main: "index.js",
    }),
    "shared/node_modules/cjs-only/index.js": "module.exports = 2;\n",
    // A scoped package with a native addon.
    "shared/node_modules/@scope/beta/package.json": packageJson("@scope/beta", {
      main: "index.js",
    }),
    "shared/node_modules/@scope/beta/index.js":
      'module.exports = require("./build/addon.node");\n',
    "shared/node_modules/@scope/beta/build/addon.node": "not really an addon",
    // delta has a package of its own nested under it.
    "shared/node_modules/delta/package.json": packageJson("delta", {
      main: "index.js",
    }),
    "shared/node_modules/delta/index.js":
      'module.exports = require("epsilon");\n',
    "shared/node_modules/delta/node_modules/epsilon/package.json": packageJson(
      "epsilon",
      { main: "index.js" },
    ),
    "shared/node_modules/delta/node_modules/epsilon/index.js":
      "module.exports = 'nested';\n",
    "shared/node_modules/lazy/package.json": packageJson("lazy", {
      main: "index.js",
    }),
    "shared/node_modules/lazy/index.js": "module.exports = 'lazy';\n",
    // Installed, never imported.
    "shared/node_modules/unused/package.json": packageJson("unused", {
      main: "index.js",
    }),
    "shared/node_modules/unused/index.js": "module.exports = 'unused';\n",
  });
  fs.mkdirSync(path.join(root, "app", "node_modules"));
  fs.symlinkSync(
    path.join(root, "shared"),
    path.join(root, "app", "node_modules", "shared"),
    "dir",
  );
  return root;
}

/*
 * The same layout, where the program names packages only in require.resolve()
 * calls, which esbuild records but never reads the file of.
 */
function resolvingProgram() {
  const root = temporaryDirectory("prune-resolve-");
  writeTree(root, {
    "app/package.json": packageJson("app"),
    "app/Index.ts": [
      'import { version } from "shared/Versions";',
      "export default version;",
      "",
    ].join("\n"),
    "shared/package.json": packageJson("shared"),
    "shared/Versions.ts": [
      'import fs from "fs";',
      'import path from "path";',
      /*
       * TypeOrmPatchVersion's way to typeorm's version: the exports map
       * leaves package.json out, so it is read from beside the main file.
       */
      'export const version: string = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve("closed")), "package.json"), "utf8")).version;',
      'export const manifest: string = require.resolve("open/package.json");',
      'export const inner: string = require.resolve("deep/lib/inner.js");',
      'export const addon: string = require.resolve("native/build/addon.node");',
      "export const templated: string = require.resolve(`templated`);",
      'export const worker: string = require.resolve("./Worker");',
      'export const builtin: string = require.resolve("fs");',
      "export const notExported = (): string => {",
      '  return require.resolve("closed/package.json");',
      "};",
      "export const absent = (): string => {",
      '  return require.resolve("not-installed-resolve");',
      "};",
      "",
    ].join("\n"),
    /*
     * Walked after Versions.ts, which it reads again: what that finds is
     * followed, and noted, once.
     */
    "shared/Worker.ts": [
      'import job from "worker-only";',
      'import { version } from "./Versions";',
      "export default [job, version];",
      "",
    ].join("\n"),
    /*
     * closed's main file requires closed-dep, which finds by-package with a
     * require.resolve() of its own.
     */
    "shared/node_modules/closed/package.json": packageJson("closed", {
      exports: { ".": { require: "./index.js" } },
    }),
    "shared/node_modules/closed/index.js":
      'module.exports = require("closed-dep");\n',
    "shared/node_modules/closed-dep/package.json": packageJson("closed-dep", {
      main: "index.js",
    }),
    "shared/node_modules/closed-dep/index.js":
      'module.exports = require.resolve("by-package");\n',
    "shared/node_modules/by-package/package.json": packageJson("by-package", {
      main: "index.js",
    }),
    "shared/node_modules/by-package/index.js": "module.exports = 1;\n",
    // Only open's package.json is named: its main file is never loaded.
    "shared/node_modules/open/package.json": packageJson("open", {
      main: "index.js",
    }),
    "shared/node_modules/open/index.js":
      'module.exports = require("open-main-only");\n',
    "shared/node_modules/open-main-only/package.json": packageJson(
      "open-main-only",
      { main: "index.js" },
    ),
    "shared/node_modules/open-main-only/index.js": "module.exports = 1;\n",
    "shared/node_modules/deep/package.json": packageJson("deep", {
      main: "index.js",
    }),
    "shared/node_modules/deep/index.js": "module.exports = 1;\n",
    "shared/node_modules/deep/lib/inner.js":
      'module.exports = require("deep-inner-dep");\n',
    "shared/node_modules/deep-inner-dep/package.json": packageJson(
      "deep-inner-dep",
      { main: "index.js" },
    ),
    "shared/node_modules/deep-inner-dep/index.js": "module.exports = 1;\n",
    "shared/node_modules/native/package.json": packageJson("native"),
    "shared/node_modules/native/build/addon.node": "not really an addon",
    "shared/node_modules/templated/package.json": packageJson("templated", {
      main: "index.js",
    }),
    "shared/node_modules/templated/index.js": "module.exports = 1;\n",
    "shared/node_modules/worker-only/package.json": packageJson("worker-only", {
      main: "index.js",
    }),
    "shared/node_modules/worker-only/index.js": "module.exports = 1;\n",
    // Installed, never named.
    "shared/node_modules/unused/package.json": packageJson("unused", {
      main: "index.js",
    }),
    "shared/node_modules/unused/index.js": "module.exports = 'unused';\n",
  });
  fs.mkdirSync(path.join(root, "app", "node_modules"));
  fs.symlinkSync(
    path.join(root, "shared"),
    path.join(root, "app", "node_modules", "shared"),
    "dir",
  );
  return root;
}

function relativeTo(root, directories) {
  return [...directories]
    .map((directory) => {
      return path.relative(root, directory).split(path.sep).join("/");
    })
    .sort();
}

describe("parseArguments", () => {
  test("reads the entry point, the package and --dry-run", () => {
    expect(
      parseArguments([
        "--entry",
        "/usr/src/app/Index.ts",
        "--package",
        "/usr/src/Common",
      ]),
    ).toEqual({
      entry: "/usr/src/app/Index.ts",
      entries: ["/usr/src/app/Index.ts"],
      entryLoaders: [],
      packageDirectory: "/usr/src/Common",
      dryRun: false,
    });
    expect(
      parseArguments(["--dry-run", "--package", "a", "--entry", "b"]),
    ).toEqual({
      entry: path.resolve("b"),
      entries: [path.resolve("b")],
      entryLoaders: [],
      packageDirectory: path.resolve("a"),
      dryRun: true,
    });
  });

  test("reads every --entry and --entry-loader, in order and once each; the first entry is the entry", () => {
    expect(
      parseArguments([
        "--entry",
        "/usr/src/app/Index.ts",
        "--entry-loader",
        "/usr/src/app/Utils/EnterpriseLoader.ts",
        "--entry",
        "/usr/src/Common/Worker.cjs",
        "--package",
        "/usr/src/Common",
        "--entry",
        "/usr/src/ee/Server/Index.ts",
        "--entry-loader",
        "/usr/src/Common/Starter.ts",
        "--entry",
        "/usr/src/Common/Worker.cjs",
        "--entry-loader",
        "/usr/src/Common/Starter.ts",
      ]),
    ).toEqual({
      entry: "/usr/src/app/Index.ts",
      entries: [
        "/usr/src/app/Index.ts",
        "/usr/src/Common/Worker.cjs",
        "/usr/src/ee/Server/Index.ts",
      ],
      entryLoaders: [
        "/usr/src/app/Utils/EnterpriseLoader.ts",
        "/usr/src/Common/Starter.ts",
      ],
      packageDirectory: "/usr/src/Common",
      dryRun: false,
    });
  });

  test("refuses a missing value, a missing option and an unknown one", () => {
    expect(() => {
      return parseArguments(["--entry"]);
    }).toThrow("--entry needs a value");
    expect(() => {
      return parseArguments([
        "--entry",
        "x",
        "--package",
        "y",
        "--entry-loader",
      ]);
    }).toThrow("--entry-loader needs a value");
    expect(() => {
      return parseArguments(["--entry-loader", "x", "--package", "y"]);
    }).toThrow("--entry is required");
    expect(() => {
      return parseArguments(["--entry", "--package", "x"]);
    }).toThrow("--entry needs a value");
    expect(() => {
      return parseArguments(["--package", "x"]);
    }).toThrow("--entry is required");
    expect(() => {
      return parseArguments(["--entry", "x"]);
    }).toThrow("--package is required");
    expect(() => {
      return parseArguments(["--entry", "x", "--package", "y", "--all"]);
    }).toThrow("Unknown option: --all");
  });
});

describe("packageDirectoryOf", () => {
  const cases = [
    [
      "/usr/src/Common/node_modules/typeorm/index.js",
      "/usr/src/Common/node_modules/typeorm",
    ],
    [
      "/usr/src/Common/node_modules/@azure/identity/dist/index.js",
      "/usr/src/Common/node_modules/@azure/identity",
    ],
    [
      "/usr/src/Common/node_modules/typeorm/node_modules/glob/dist/index.js",
      "/usr/src/Common/node_modules/typeorm/node_modules/glob",
    ],
    [
      "/usr/src/Common/node_modules/a/node_modules/@scope/b/x.js",
      "/usr/src/Common/node_modules/a/node_modules/@scope/b",
    ],
    [
      "/usr/src/Common/node_modules/typeorm",
      "/usr/src/Common/node_modules/typeorm",
    ],
  ];

  test.each(cases)("%s belongs to %s", (file, directory) => {
    expect(packageDirectoryOf(file.split("/").join(path.sep))).toBe(
      directory.split("/").join(path.sep),
    );
  });

  test("a file of the program's own is in no package", () => {
    for (const file of [
      "/usr/src/Common/Server/Utils/Logger.ts",
      "/usr/src/app/Index.ts",
      "/usr/src/Common/node_modules",
      "/usr/src/Common/node_modules/@scope",
    ]) {
      expect(packageDirectoryOf(file.split("/").join(path.sep))).toBeNull();
    }
  });
});

describe("withoutDependencies", () => {
  test("takes out only the named dependencies and keeps every other field", () => {
    const manifest = {
      name: "@oneuptime/common",
      version: "14.0.0",
      dependencies: { a: "^1.0.0", b: "^2.0.0", c: "^3.0.0" },
      devDependencies: { jest: "^30.0.0" },
      overrides: { d: "1.0.0" },
    };
    expect(withoutDependencies(manifest, ["b", "missing"])).toEqual({
      name: "@oneuptime/common",
      version: "14.0.0",
      dependencies: { a: "^1.0.0", c: "^3.0.0" },
      devDependencies: { jest: "^30.0.0" },
      overrides: { d: "1.0.0" },
    });
    // The manifest passed in is left as it was.
    expect(manifest.dependencies).toEqual({
      a: "^1.0.0",
      b: "^2.0.0",
      c: "^3.0.0",
    });
  });
});

describe("withDependencies", () => {
  test("adds the named packages at their versions and keeps every other field", () => {
    const manifest = {
      ...packageJson("shared"),
      dependencies: { alpha: "^1.0.0" },
      devDependencies: { jest: "^30.0.0" },
    };
    expect(
      withDependencies(manifest, [
        { name: "supports-color", version: "7.2.0" },
      ]),
    ).toEqual({
      ...packageJson("shared"),
      dependencies: { alpha: "^1.0.0", "supports-color": "7.2.0" },
      devDependencies: { jest: "^30.0.0" },
    });
    expect(manifest.dependencies).toEqual({ alpha: "^1.0.0" });
  });
});

/*
 * A package's node_modules as npm lays it out, without npm: each package's
 * package.json says what it depends on.
 */
describe("reachedPackagesNothingKeeps", () => {
  function installedTree() {
    const root = temporaryDirectory("prune-kept-");
    const modules = (name, extra) => {
      return {
        [`node_modules/${name}/package.json`]: packageJson(name, extra),
      };
    };
    writeTree(root, {
      "package.json": packageJson("shared"),
      // logger requires colors in a try, as debug requires supports-color,
      // and depends only on ms.
      ...modules("logger", {
        version: "4.3.7",
        dependencies: { ms: "^2.1.3", inner: "^1.0.0" },
        devDependencies: { "dev-tool": "^1.0.0" },
      }),
      ...modules("ms", { version: "2.1.3" }),
      // A copy nested under logger, which depends on it, and one nested
      // there that nothing depends on.
      ...modules("logger/node_modules/inner"),
      ...modules("logger/node_modules/stray"),
      // colors is installed because unused depends on it; colors needs flag.
      ...modules("unused", { dependencies: { colors: "^7.0.0" } }),
      ...modules("colors", {
        version: "7.2.0",
        dependencies: { "has-flag": "^4.0.0" },
      }),
      ...modules("has-flag", { version: "4.0.0" }),
      // A peer dependency keeps a package; an optional one does not.
      ...modules("@scope/host", {
        peerDependencies: {
          "@scope/peer": "^1.0.0",
          "optional-peer": "^1.0.0",
        },
        peerDependenciesMeta: { "optional-peer": { optional: true } },
      }),
      ...modules("@scope/peer"),
      ...modules("optional-peer"),
      // Only a development dependency of logger.
      ...modules("dev-tool"),
      // Two that need each other, and nothing else needs.
      ...modules("ping", { dependencies: { pong: "^1.0.0" } }),
      ...modules("pong", { dependencies: { ping: "^1.0.0" } }),
    });
    return root;
  }

  function reachedIn(root, names) {
    return new Set(
      names.map((name) => {
        return fs.realpathSync(path.join(root, "node_modules", name));
      }),
    );
  }

  test("names what the program reaches that nothing staying depends on, and only the first of what needs the rest", () => {
    const root = installedTree();
    const reached = reachedIn(root, [
      "logger",
      "ms",
      "logger/node_modules/inner",
      "colors",
      "has-flag",
      "@scope/host",
      "@scope/peer",
      "optional-peer",
      "dev-tool",
      "ping",
      "pong",
    ]);

    expect(
      reachedPackagesNothingKeeps({
        packageDirectory: root,
        dependencies: ["logger", "@scope/host", "not-installed"],
        reached,
      }),
    ).toEqual([
      // colors keeps has-flag; of ping and pong, ping keeps pong.
      { name: "colors", version: "7.2.0" },
      { name: "dev-tool", version: "1.0.0" },
      { name: "optional-peer", version: "1.0.0" },
      { name: "ping", version: "1.0.0" },
    ]);
  });

  test("names nothing a staying package keeps, through its dependencies, a nested copy and a peer", () => {
    const root = installedTree();
    expect(
      reachedPackagesNothingKeeps({
        packageDirectory: root,
        dependencies: ["logger", "@scope/host", "unused"],
        reached: reachedIn(root, [
          "logger",
          "ms",
          "logger/node_modules/inner",
          "colors",
          "has-flag",
          "@scope/host",
          "@scope/peer",
        ]),
      }),
    ).toEqual([]);
  });

  test("a nested package is its parent's to keep: it is never named at the top", () => {
    const root = installedTree();
    expect(
      reachedPackagesNothingKeeps({
        packageDirectory: root,
        dependencies: ["logger"],
        reached: reachedIn(root, ["logger", "logger/node_modules/stray"]),
      }),
    ).toEqual([]);
  });

  test("a package outside the package's own node_modules is left alone", () => {
    const root = installedTree();
    const elsewhere = temporaryDirectory("prune-elsewhere-");
    writeTree(elsewhere, {
      "node_modules/outside/package.json": packageJson("outside"),
    });
    expect(
      reachedPackagesNothingKeeps({
        packageDirectory: root,
        dependencies: [],
        reached: new Set([
          fs.realpathSync(path.join(elsewhere, "node_modules", "outside")),
        ]),
      }),
    ).toEqual([]);
  });
});

describe("unreachedDependencies", () => {
  test("lists the installed dependencies the walk never reached, in package.json's order", () => {
    const root = temporaryDirectory("prune-unreached-");
    writeTree(root, {
      "node_modules/kept/package.json": packageJson("kept"),
      "node_modules/dropped/package.json": packageJson("dropped"),
      "node_modules/@scope/dropped-too/package.json":
        packageJson("@scope/dropped-too"),
      "elsewhere/linked/package.json": packageJson("linked"),
    });
    fs.symlinkSync(
      path.join(root, "elsewhere", "linked"),
      path.join(root, "node_modules", "linked"),
      "dir",
    );
    const reached = new Set([
      path.join(root, "node_modules", "kept"),
      // A linked dependency is reached at its real path.
      path.join(root, "elsewhere", "linked"),
    ]);
    expect(
      unreachedDependencies({
        packageDirectory: root,
        dependencies: {
          dropped: "^1.0.0",
          kept: "^1.0.0",
          "not-installed": "^1.0.0",
          linked: "file:./elsewhere/linked",
          "@scope/dropped-too": "^1.0.0",
        },
        reached,
      }),
    ).toEqual(["dropped", "@scope/dropped-too"]);
  });

  test("a package without dependencies has nothing to remove", () => {
    expect(
      unreachedDependencies({
        packageDirectory: temporaryDirectory("prune-none-"),
        dependencies: undefined,
        reached: new Set(),
      }),
    ).toEqual([]);
  });
});

describe("directorySize", () => {
  test("adds up the files under a directory, nested ones included, without following links", () => {
    const root = temporaryDirectory("prune-size-");
    writeTree(root, { "a.txt": "12345", "b/c.txt": "123", "b/d/e.txt": "1" });
    fs.symlinkSync(path.join(root, "b"), path.join(root, "link"), "dir");
    expect(directorySize(root)).toBe(9);
    expect(directorySize(path.join(root, "missing"))).toBe(0);
  });
});

describe("the walk, with esbuild", () => {
  let root;
  let walk;

  beforeAll(async () => {
    root = sidecarLikeProgram();
    walk = await walkImports({
      entry: path.join(root, "app", "Index.ts"),
      esbuild,
    });
  });

  test("reaches every package the program imports, through a linked local package and on into each package", () => {
    expect(relativeTo(root, walk.reached)).toEqual([
      "shared/node_modules/@scope/beta",
      "shared/node_modules/alpha",
      "shared/node_modules/cjs-only",
      "shared/node_modules/delta",
      "shared/node_modules/delta/node_modules/epsilon",
      "shared/node_modules/dual",
      "shared/node_modules/gamma",
      "shared/node_modules/lazy",
    ]);
  });

  test("resolves a package as require() does, so what only its ES module imports is not reached", () => {
    const reached = relativeTo(root, walk.reached);
    expect(reached).toContain("shared/node_modules/cjs-only");
    expect(reached).not.toContain("shared/node_modules/esm-only");
  });

  test("never counts a package nothing imports", () => {
    expect(relativeTo(root, walk.reached)).not.toContain(
      "shared/node_modules/unused",
    );
  });

  test("counts the linked local package as the program's own files", () => {
    expect(relativeTo(root, walk.ownFiles)).toEqual([
      "app/Index.ts",
      "shared/Thing.ts",
    ]);
  });

  test("notes a package that is not installed, and goes on", () => {
    expect(walk.missing).toEqual([
      {
        specifier: "not-installed-driver",
        importer: path.join(
          root,
          "shared",
          "node_modules",
          "alpha",
          "index.js",
        ),
      },
    ]);
  });

  test("files that are not code do not stop it", () => {
    expect(NOT_CODE.test("addon.node")).toBe(true);
    expect(NOT_CODE.test("style.css")).toBe(true);
    expect(NOT_CODE.test("index.js")).toBe(false);
    expect(NOT_CODE.test("Index.ts")).toBe(false);
  });
});

describe("the walk, with require.resolve()", () => {
  let root;
  let walk;

  beforeAll(async () => {
    root = resolvingProgram();
    walk = await walkImports({
      entry: path.join(root, "app", "Index.ts"),
      esbuild,
    });
  });

  test("a name the code spells out reaches its package, and what the file it finds requires, as require() of the name would", () => {
    expect(relativeTo(root, walk.reached)).toEqual([
      "shared/node_modules/by-package",
      "shared/node_modules/closed",
      "shared/node_modules/closed-dep",
      "shared/node_modules/deep",
      "shared/node_modules/deep-inner-dep",
      "shared/node_modules/native",
      "shared/node_modules/open",
      "shared/node_modules/templated",
      "shared/node_modules/worker-only",
    ]);
  });

  test("a subpath reaches its package through that file alone: the main file it never loads, and what only that requires, do not count", () => {
    const reached = relativeTo(root, walk.reached);
    expect(reached).toContain("shared/node_modules/open");
    expect(reached).not.toContain("shared/node_modules/open-main-only");
    // deep/lib/inner.js is read, and what it requires reached.
    expect(reached).toContain("shared/node_modules/deep-inner-dep");
    // A file that is not code is not read, but its package counts.
    expect(reached).toContain("shared/node_modules/native");
  });

  test("a file of the program's own it finds is read as the program's own", () => {
    expect(relativeTo(root, walk.ownFiles)).toEqual([
      "app/Index.ts",
      "shared/Versions.ts",
      "shared/Worker.ts",
    ]);
  });

  test("a name that does not resolve is noted, as require() would fail on it: a package not installed, or a subpath its exports map leaves out", () => {
    const importer = path.join(root, "shared", "Versions.ts");
    expect(walk.missing).toEqual([
      { specifier: "closed/package.json", importer },
      { specifier: "not-installed-resolve", importer },
    ]);
  });

  test("with options it is not read, which is why the program's own files may not have one", async () => {
    const program = temporaryDirectory("prune-resolve-options-");
    const source = [
      'export const elsewhere = require.resolve("searched", { paths: [__dirname] });',
      "",
    ].join("\n");
    writeTree(program, {
      "Index.ts": source,
      "node_modules/searched/package.json": packageJson("searched", {
        main: "index.js",
      }),
      "node_modules/searched/index.js": "module.exports = 1;\n",
    });
    const optionsWalk = await walkImports({
      entry: path.join(program, "Index.ts"),
      esbuild,
    });
    expect(relativeTo(program, optionsWalk.reached)).toEqual([]);
    expect(computedImportsIn({ file: "Index.ts", source, typescript })).toEqual(
      [
        {
          line: 1,
          text: 'require.resolve("searched", { paths: [__dirname] })',
        },
      ],
    );
  });
});

describe("computed imports", () => {
  function computed(source, file = "Own.ts") {
    return computedImportsIn({ file, source, typescript });
  }

  test("a require() or import() of a name the code computes is one, with its line", () => {
    expect(
      computed(
        [
          "const name: string = String(process.env['PLUGIN']);",
          "export const plugin = require(name);",
          "export const later = () => import(name);",
          "export const joined = require('pl' + 'ugin');",
          "export const templated = require(`./plugins/${name}`);",
          "export const none = require();",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 2, text: "require(name)" },
      { line: 3, text: "import(name)" },
      { line: 4, text: "require('pl' + 'ugin')" },
      { line: 5, text: "require(`./plugins/${name}`)" },
      { line: 6, text: "require()" },
    ]);
  });

  test("a require.resolve() of a name the code spells out is not, as a require() of one is not", () => {
    expect(
      computed(
        [
          'import fs from "fs";',
          'import path from "path";',
          // TypeOrmPatchVersion's own call.
          'export const manifest = fs.readFileSync(path.join(path.dirname(require.resolve("typeorm")), "package.json"), "utf8");',
          "export const templated = require.resolve(`ioredis`);",
          'export const subpath = require.resolve("acme-client/package.json");',
          'export const own = require.resolve("./Worker");',
          // Where require() would look, not a load.
          'export const searched = require.resolve.paths("pg");',
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a require.resolve() of a computed name, with options or of nothing is one, and a createRequire() is whatever it is given", () => {
    expect(
      computed(
        [
          'import { createRequire } from "module";',
          "const name: string = String(process.env['PLUGIN']);",
          "export const a = require.resolve(name);",
          "export const b = require.resolve('pl' + 'ugin');",
          "export const c = require.resolve(`./plugins/${name}`);",
          'export const d = require.resolve("typeorm", { paths: [__dirname] });',
          "export const e = require.resolve(name, { paths: [process.cwd()] });",
          "export const f = require.resolve();",
          'export const g = require?.resolve("typeorm");',
          "export const local = createRequire(__filename);",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 3, text: "require.resolve(name)" },
      { line: 4, text: "require.resolve('pl' + 'ugin')" },
      { line: 5, text: "require.resolve(`./plugins/${name}`)" },
      { line: 6, text: 'require.resolve("typeorm", { paths: [__dirname] })' },
      { line: 7, text: "require.resolve(name, { paths: [process.cwd()] })" },
      { line: 8, text: "require.resolve()" },
      { line: 9, text: 'require?.resolve("typeorm")' },
      { line: 10, text: "createRequire(__filename)" },
    ]);
  });

  test("a name the code spells out is not, nor a type, a comment or a string that only says so", () => {
    expect(
      computed(
        [
          'import fs from "fs";',
          'import type { Options } from "typeorm";',
          'import Logger = require("./Logger");',
          'export const a = require("pg");',
          "export const b = require(`ioredis`);",
          'export const c = () => import("acme-client");',
          'export type Lazy = typeof import("./Lazy");',
          "// Never write require(name) here.",
          "/* or import(name) */",
          'export const message = "load it with require(name) or import(name)";',
          "export const template = `require(${fs.constants.F_OK})`;",
          "export const options: Options | undefined = undefined;",
          "export { Logger };",
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reads JavaScript files too", () => {
    expect(
      computed("module.exports = (name) => require(name);\n", "own.js"),
    ).toEqual([{ line: 1, text: "require(name)" }]);
  });

  test("a worker thread of worker_threads' Worker is one, however the file imports it, and whatever it is given", () => {
    expect(
      computed(
        [
          'import { Worker } from "worker_threads";',
          'import { Worker as Thread } from "node:worker_threads";',
          'import * as threads from "worker_threads";',
          'import threadsDefault from "worker_threads";',
          'import path from "path";',
          'export const a = new Worker(path.join(__dirname, "Worker.cjs"), { workerData: 1 });',
          'export const b = new Worker("./Literal.js");',
          "export const c = new Thread(new URL(import.meta.url));",
          "export const d = new threads.Worker(String(process.env['FILE']));",
          'export const e = new threadsDefault.Worker("./Other.js");',
          'export const f = new (require("worker_threads").Worker)("./Required.js");',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      {
        line: 6,
        text: 'new Worker(path.join(__dirname, "Worker.cjs"), { workerData: 1 })',
      },
      { line: 7, text: 'new Worker("./Literal.js")' },
      { line: 8, text: "new Thread(new URL(import.meta.url))" },
      { line: 9, text: "new threads.Worker(String(process.env['FILE']))" },
      { line: 10, text: 'new threadsDefault.Worker("./Other.js")' },
      {
        line: 11,
        text: 'new (require("worker_threads").Worker)("./Required.js")',
      },
    ]);
  });

  test("a Worker of anything else is not: BullMQ's, the browser's, the program's own", () => {
    expect(
      computed(
        [
          'import { Worker } from "bullmq";',
          'import * as queue from "bullmq";',
          "export const a = new Worker(queueName, handler, { connection });",
          "export const b = new queue.Worker(queueName, handler);",
          "class Local {}",
          "export const c = new Local();",
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      computed(
        "export const browser = new Worker(objectUrl, { type: 'module' });\n",
        "Page.ts",
      ),
    ).toEqual([]);
  });

  test("a forked process is one, and so is node started from process.execPath; another program is not", () => {
    expect(
      computed(
        [
          'import { fork, spawn } from "child_process";',
          'import * as childProcess from "node:child_process";',
          'import { execFile as run } from "child_process";',
          'const { fork: forkIt, spawnSync } = require("child_process");',
          'const cp = require("child_process");',
          "export const a = fork(scriptPath, [], { execArgv });",
          'export const b = childProcess.fork("./Child.js");',
          "export const c = forkIt(script);",
          'export const d = require("child_process").fork(script);',
          "export const e = cp.fork(script);",
          'export const f = spawn(process.execPath, ["--require", "ts-node/register", script]);',
          "export const g = spawnSync(process.execPath, [script]);",
          "export const h = childProcess.execFileSync(process.execPath, [script]);",
          "export const i = run(process.execPath, [script]);",
          'export const notNode = spawn("bash", ["-c", command]);',
          'export const kubectl = childProcess.spawnSync("kubectl", args);',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 6, text: "fork(scriptPath, [], { execArgv })" },
      { line: 7, text: 'childProcess.fork("./Child.js")' },
      { line: 8, text: "forkIt(script)" },
      { line: 9, text: 'require("child_process").fork(script)' },
      { line: 10, text: "cp.fork(script)" },
      {
        line: 11,
        text: 'spawn(process.execPath, ["--require", "ts-node/register", script])',
      },
      { line: 12, text: "spawnSync(process.execPath, [script])" },
      {
        line: 13,
        text: "childProcess.execFileSync(process.execPath, [script])",
      },
      { line: 14, text: "run(process.execPath, [script])" },
    ]);
    expect(PROCESS_STARTS).toEqual([
      "spawn",
      "spawnSync",
      "execFile",
      "execFileSync",
      "fork",
    ]);
  });

  test("a fork() of the program's own, or of a package that is not child_process, is not", () => {
    expect(
      computed(
        [
          'import { fork } from "./Forks";',
          'import * as git from "simple-git";',
          "const branch = (name: string) => name;",
          "export const a = fork(repository);",
          "export const b = git.fork(repository);",
          'export const c = branch("main");',
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("findComputedImports reads each file and says which it is in", () => {
    const root = temporaryDirectory("prune-computed-");
    writeTree(root, {
      "A.ts": 'export const a = require("pg");\n',
      "B.ts":
        "export const b = (name: string) => {\n  return require(name);\n};\n",
    });
    expect(
      findComputedImports({
        files: [path.join(root, "A.ts"), path.join(root, "B.ts")],
        typescript,
      }),
    ).toEqual([
      { file: path.join(root, "B.ts"), line: 2, text: "require(name)" },
    ]);
  });
});

describe("pruneUnreachablePackages", () => {
  function npmPruneThatRemoves(directories) {
    const calls = [];
    const run = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      for (const directory of directories) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };
    return { calls, run };
  }

  function sharedManifest(root) {
    return JSON.parse(
      fs.readFileSync(path.join(root, "shared", "package.json"), "utf8"),
    );
  }

  function withDependencies(root) {
    const manifestPath = path.join(root, "shared", "package.json");
    const manifest = {
      ...packageJson("shared"),
      description: "kept as it is",
      dependencies: {
        alpha: "^1.0.0",
        unused: "^1.0.0",
        dual: "^1.0.0",
        "not-installed": "^1.0.0",
      },
      devDependencies: { jest: "^30.0.0" },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  test("takes the unreached dependencies out of package.json, names the reached packages nothing else keeps, and runs npm prune there, offline", async () => {
    const root = sidecarLikeProgram();
    withDependencies(root);
    const npm = npmPruneThatRemoves([
      path.join(root, "shared", "node_modules", "unused"),
    ]);
    const lines = [];
    const result = await pruneUnreachablePackages({
      entry: path.join(root, "app", "Index.ts"),
      packageDirectory: path.join(root, "shared"),
      esbuild,
      typescript,
      run: npm.run,
      log: (line) => {
        lines.push(line);
      },
    });

    expect(result.removed).toEqual(["unused"]);
    /*
     * The program imports @scope/beta, delta and lazy, alpha requires gamma
     * and dual's CommonJS file cjs-only, and nothing declares any of them:
     * npm would remove them all, so package.json names them. epsilon is
     * nested under delta, so it is delta's to keep.
     */
    expect(result.added).toEqual([
      { name: "@scope/beta", version: "1.0.0" },
      { name: "cjs-only", version: "1.0.0" },
      { name: "delta", version: "1.0.0" },
      { name: "gamma", version: "1.0.0" },
      { name: "lazy", version: "1.0.0" },
    ]);
    expect(result.kept).toBe(8);
    expect(result.after).toBeLessThan(result.before);
    expect(sharedManifest(root)).toEqual({
      ...packageJson("shared"),
      description: "kept as it is",
      dependencies: {
        alpha: "^1.0.0",
        dual: "^1.0.0",
        "not-installed": "^1.0.0",
        "@scope/beta": "1.0.0",
        "cjs-only": "1.0.0",
        delta: "1.0.0",
        gamma: "1.0.0",
        lazy: "1.0.0",
      },
      devDependencies: { jest: "^30.0.0" },
    });
    expect(npm.calls).toEqual([
      {
        command: "npm",
        args: ["prune", "--omit=dev", "--offline", "--no-audit", "--no-fund"],
        cwd: path.join(root, "shared"),
      },
    ]);
    expect(lines.join("\n")).toContain(
      "1 of the 4 dependencies of " +
        path.join(root, "shared", "package.json") +
        " are never reached: unused.",
    );
    expect(lines.join("\n")).toContain(
      path.join(root, "shared", "package.json") +
        " now names, at the version installed, each package it reaches that nothing staying depends on, so npm keeps it: @scope/beta@1.0.0, cjs-only@1.0.0, delta@1.0.0, gamma@1.0.0, lazy@1.0.0.",
    );
  });

  test("--dry-run says what it would remove and changes nothing", async () => {
    const root = sidecarLikeProgram();
    withDependencies(root);
    const before = fs.readFileSync(
      path.join(root, "shared", "package.json"),
      "utf8",
    );
    const npm = npmPruneThatRemoves([]);
    const result = await pruneUnreachablePackages({
      entry: path.join(root, "app", "Index.ts"),
      packageDirectory: path.join(root, "shared"),
      dryRun: true,
      esbuild,
      typescript,
      run: npm.run,
      log: () => {},
    });
    expect(result.removed).toEqual(["unused"]);
    expect(
      result.added.map((item) => {
        return item.name;
      }),
    ).toEqual(["@scope/beta", "cjs-only", "delta", "gamma", "lazy"]);
    expect(npm.calls).toEqual([]);
    expect(
      fs.readFileSync(path.join(root, "shared", "package.json"), "utf8"),
    ).toBe(before);
  });

  test("fails when npm prune removed a package the program reaches", async () => {
    const root = sidecarLikeProgram();
    withDependencies(root);
    const npm = npmPruneThatRemoves([
      path.join(root, "shared", "node_modules", "gamma"),
    ]);
    await expect(
      pruneUnreachablePackages({
        entry: path.join(root, "app", "Index.ts"),
        packageDirectory: path.join(root, "shared"),
        esbuild,
        typescript,
        run: npm.run,
        log: () => {},
      }),
    ).rejects.toThrow(
      `npm prune removed packages the program reaches: ${path.join(root, "shared", "node_modules", "gamma")}`,
    );
  });

  test("refuses to prune for a program with a computed import, and changes nothing", async () => {
    const root = sidecarLikeProgram();
    withDependencies(root);
    writeTree(root, {
      "app/Plugin.ts": [
        'import Thing from "shared/Thing";',
        "export const plugin = require(String(process.env['PLUGIN']));",
        "export default Thing;",
        "",
      ].join("\n"),
    });
    const before = fs.readFileSync(
      path.join(root, "shared", "package.json"),
      "utf8",
    );
    const npm = npmPruneThatRemoves([]);
    await expect(
      pruneUnreachablePackages({
        entry: path.join(root, "app", "Plugin.ts"),
        packageDirectory: path.join(root, "shared"),
        esbuild,
        typescript,
        run: npm.run,
        log: () => {},
      }),
    ).rejects.toThrow(
      `${path.join(root, "app", "Plugin.ts")}:2: require(String(process.env['PLUGIN']))`,
    );
    expect(npm.calls).toEqual([]);
    expect(
      fs.readFileSync(path.join(root, "shared", "package.json"), "utf8"),
    ).toBe(before);
  });

  test("keeps a dependency the program names only in a require.resolve(), as TypeOrmPatchVersion names typeorm", async () => {
    const root = resolvingProgram();
    const manifestPath = path.join(root, "shared", "package.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        ...packageJson("shared"),
        dependencies: {
          closed: "^1.0.0",
          "open-main-only": "^1.0.0",
          unused: "^1.0.0",
          "worker-only": "^1.0.0",
        },
      }),
    );
    const npm = npmPruneThatRemoves([
      path.join(root, "shared", "node_modules", "open-main-only"),
      path.join(root, "shared", "node_modules", "unused"),
    ]);
    const result = await pruneUnreachablePackages({
      entry: path.join(root, "app", "Index.ts"),
      packageDirectory: path.join(root, "shared"),
      esbuild,
      typescript,
      run: npm.run,
      log: () => {},
    });

    expect(result.removed).toEqual(["open-main-only", "unused"]);
    /*
     * This fixture's packages declare no dependencies of their own, so what
     * closed and the rest require is kept only by being named.
     */
    const named = [
      "by-package",
      "closed-dep",
      "deep",
      "deep-inner-dep",
      "native",
      "open",
      "templated",
    ];
    expect(
      result.added.map((item) => {
        return item.name;
      }),
    ).toEqual(named);
    expect(sharedManifest(root).dependencies).toEqual({
      closed: "^1.0.0",
      "worker-only": "^1.0.0",
      ...Object.fromEntries(
        named.map((name) => {
          return [name, "1.0.0"];
        }),
      ),
    });
    expect(npm.calls).toHaveLength(1);
  });

  test("refuses to prune for a program with a require.resolve() of a computed name or with options, and changes nothing", async () => {
    const root = sidecarLikeProgram();
    withDependencies(root);
    writeTree(root, {
      "app/Resolve.ts": [
        'import Thing from "shared/Thing";',
        "export const where = require.resolve(String(process.env['PLUGIN']));",
        'export const elsewhere = require.resolve("alpha", { paths: [process.cwd()] });',
        'export const named = require.resolve("alpha");',
        "export default Thing;",
        "",
      ].join("\n"),
    });
    const before = fs.readFileSync(
      path.join(root, "shared", "package.json"),
      "utf8",
    );
    const npm = npmPruneThatRemoves([]);
    const error = await pruneUnreachablePackages({
      entry: path.join(root, "app", "Resolve.ts"),
      packageDirectory: path.join(root, "shared"),
      esbuild,
      typescript,
      run: npm.run,
      log: () => {},
    }).then(
      () => {
        return null;
      },
      (rejection) => {
        return rejection;
      },
    );

    const file = path.join(root, "app", "Resolve.ts");
    expect(error).toBeInstanceOf(Error);
    expect(
      error.message.split("\n").filter((line) => {
        return line.startsWith("  ");
      }),
    ).toEqual([
      `  ${file}:2: require.resolve(String(process.env['PLUGIN']))`,
      `  ${file}:3: require.resolve("alpha", { paths: [process.cwd()] })`,
    ]);
    expect(npm.calls).toEqual([]);
    expect(
      fs.readFileSync(path.join(root, "shared", "package.json"), "utf8"),
    ).toBe(before);
  });

  test("refuses a walk that reached no package, which would prune everything", async () => {
    const root = temporaryDirectory("prune-empty-");
    writeTree(root, {
      "Index.ts": "export const nothing = 1;\n",
      "package.json": {
        ...packageJson("empty"),
        dependencies: { a: "^1.0.0" },
      },
      "node_modules/a/package.json": packageJson("a"),
    });
    const npm = npmPruneThatRemoves([]);
    await expect(
      pruneUnreachablePackages({
        entry: path.join(root, "Index.ts"),
        packageDirectory: root,
        esbuild,
        typescript,
        run: npm.run,
        log: () => {},
      }),
    ).rejects.toThrow("read 1 of the program's files and reached 0 packages");
    expect(npm.calls).toEqual([]);
  });

  test("refuses an entry point that does not exist", async () => {
    const root = temporaryDirectory("prune-missing-");
    writeTree(root, { "package.json": packageJson("missing") });
    await expect(
      pruneUnreachablePackages({
        entry: path.join(root, "Index.ts"),
        packageDirectory: root,
        esbuild,
        typescript,
        run: () => {},
        log: () => {},
      }),
    ).rejects.toThrow(
      `The entry point ${path.join(root, "Index.ts")} does not exist`,
    );
  });
});

/*
 * A program laid out as the App is: its entry imports a starter that runs a
 * worker thread's file, and a loader that requires a module by a name it
 * computes (the App's Enterprise loader and ee/). Only the worker's file
 * requires worker-only, and only the plugin requires plugin-only: a walk from
 * the entry alone reaches neither.
 */
function startingProgram() {
  const root = temporaryDirectory("prune-starts-");
  writeTree(root, {
    "app/package.json": packageJson("app"),
    "app/Index.ts": [
      'import { startWorker } from "shared/Starter";',
      'import { loadPlugin } from "shared/Loader";',
      "export default [startWorker, loadPlugin];",
      "",
    ].join("\n"),
    "shared/package.json": packageJson("shared"),
    "shared/Starter.ts": [
      'import path from "path";',
      'import { Worker } from "worker_threads";',
      "export const startWorker = (): Worker => {",
      '  return new Worker(path.join(__dirname, "Worker.cjs"));',
      "};",
      "",
    ].join("\n"),
    "shared/Worker.cjs": [
      'const { parentPort } = require("worker_threads");',
      'const job = require("worker-only");',
      "parentPort.postMessage(job);",
      "",
    ].join("\n"),
    "shared/Loader.ts": [
      "export const loadPlugin = (file: string): unknown => {",
      "  return require(file);",
      "};",
      'export { default as alpha } from "alpha";',
      "",
    ].join("\n"),
    "plugin/Index.ts": [
      'import plugin from "plugin-only";',
      'import alpha from "alpha";',
      "export default [plugin, alpha];",
      "",
    ].join("\n"),
    "shared/node_modules/alpha/package.json": packageJson("alpha", {
      main: "index.js",
    }),
    "shared/node_modules/alpha/index.js": "module.exports = 'alpha';\n",
    "shared/node_modules/worker-only/package.json": packageJson("worker-only", {
      main: "index.js",
    }),
    "shared/node_modules/worker-only/index.js": "module.exports = 1;\n",
    "shared/node_modules/plugin-only/package.json": packageJson("plugin-only", {
      main: "index.js",
    }),
    "shared/node_modules/plugin-only/index.js": "module.exports = 2;\n",
    // Installed, never reached.
    "shared/node_modules/unused/package.json": packageJson("unused", {
      main: "index.js",
    }),
    "shared/node_modules/unused/index.js": "module.exports = 'unused';\n",
  });
  fs.mkdirSync(path.join(root, "app", "node_modules"));
  fs.symlinkSync(
    path.join(root, "shared"),
    path.join(root, "app", "node_modules", "shared"),
    "dir",
  );
  fs.mkdirSync(path.join(root, "plugin", "node_modules"));
  fs.symlinkSync(
    path.join(root, "shared", "node_modules", "plugin-only"),
    path.join(root, "plugin", "node_modules", "plugin-only"),
    "dir",
  );
  fs.symlinkSync(
    path.join(root, "shared", "node_modules", "alpha"),
    path.join(root, "plugin", "node_modules", "alpha"),
    "dir",
  );
  fs.writeFileSync(
    path.join(root, "shared", "package.json"),
    JSON.stringify(
      {
        ...packageJson("shared"),
        dependencies: {
          alpha: "^1.0.0",
          "worker-only": "^1.0.0",
          "plugin-only": "^1.0.0",
          unused: "^1.0.0",
        },
      },
      null,
      2,
    ),
  );
  return root;
}

describe("several entries and entry loaders", () => {
  function noNpm() {
    const calls = [];
    return {
      calls,
      run: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
      },
    };
  }

  function paths(root) {
    return {
      entry: path.join(root, "app", "Index.ts"),
      worker: path.join(root, "shared", "Worker.cjs"),
      plugin: path.join(root, "plugin", "Index.ts"),
      starter: path.join(root, "shared", "Starter.ts"),
      loader: path.join(root, "shared", "Loader.ts"),
      packageDirectory: path.join(root, "shared"),
    };
  }

  test("a walk from the entry alone never reaches what only the worker's file or the loaded module requires; one from every entry does", async () => {
    const root = startingProgram();
    const p = paths(root);

    const alone = await walkImports({ entry: p.entry, esbuild });
    expect(relativeTo(root, alone.reached)).toEqual([
      "shared/node_modules/alpha",
    ]);

    const every = await walkImports({
      entries: [p.entry, p.worker, p.plugin],
      esbuild,
    });
    expect(relativeTo(root, every.reached)).toEqual([
      "shared/node_modules/alpha",
      "shared/node_modules/plugin-only",
      "shared/node_modules/worker-only",
    ]);
    // Each entry is read as the program's own, and read once.
    expect(relativeTo(root, every.ownFiles)).toEqual([
      "app/Index.ts",
      "plugin/Index.ts",
      "shared/Loader.ts",
      "shared/Starter.ts",
      "shared/Worker.cjs",
    ]);
  });

  test("refuses the program while what starts the worker and what loads by a computed name are not entry loaders, and changes nothing", async () => {
    const root = startingProgram();
    const p = paths(root);
    const before = fs.readFileSync(
      path.join(p.packageDirectory, "package.json"),
      "utf8",
    );
    const npm = noNpm();

    let error = null;
    try {
      await pruneUnreachablePackages({
        entries: [p.entry, p.worker, p.plugin],
        packageDirectory: p.packageDirectory,
        esbuild,
        typescript,
        run: npm.run,
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).not.toBeNull();
    expect(error.message).toContain(`${p.loader}:2: require(file)`);
    expect(error.message).toContain(
      `${p.starter}:4: new Worker(path.join(__dirname, "Worker.cjs"))`,
    );
    expect(error.message).toContain("give its file as another --entry");
    expect(npm.calls).toEqual([]);
    expect(
      fs.readFileSync(path.join(p.packageDirectory, "package.json"), "utf8"),
    ).toBe(before);
  });

  test("prunes once every entry is walked and each starter and loader is an entry loader: what only the worker or the plugin needs stays", async () => {
    const root = startingProgram();
    const p = paths(root);
    const npm = noNpm();
    const lines = [];

    const result = await pruneUnreachablePackages({
      entries: [p.entry, p.worker, p.plugin],
      entryLoaders: [p.starter, p.loader],
      packageDirectory: p.packageDirectory,
      esbuild,
      typescript,
      run: npm.run,
      log: (line) => {
        lines.push(line);
      },
    });

    expect(result.removed).toEqual(["unused"]);
    expect(
      Object.keys(
        JSON.parse(
          fs.readFileSync(
            path.join(p.packageDirectory, "package.json"),
            "utf8",
          ),
        ).dependencies,
      ),
    ).toEqual(["alpha", "worker-only", "plugin-only"]);
    expect(npm.calls).toHaveLength(1);
    expect(lines.join("\n")).toContain(
      `what ${p.starter}, ${p.loader} load or start by a computed name is among the entries.`,
    );
  });

  test("the entry worker alone, without the starter as an entry loader, is still refused: the walk cannot know the starter starts only it", async () => {
    const root = startingProgram();
    const p = paths(root);

    await expect(
      pruneUnreachablePackages({
        entries: [p.entry, p.worker, p.plugin],
        entryLoaders: [p.loader],
        packageDirectory: p.packageDirectory,
        dryRun: true,
        esbuild,
        typescript,
        log: () => {},
      }),
    ).rejects.toThrow(`${p.starter}:4: new Worker(`);
  });

  test("an entry loader has to be a file the walk read", async () => {
    const root = startingProgram();
    const p = paths(root);
    writeTree(root, {
      "shared/Unused.ts":
        "export const unused = (file: string) => require(file);\n",
    });

    await expect(
      pruneUnreachablePackages({
        entries: [p.entry, p.worker, p.plugin],
        entryLoaders: [
          p.starter,
          p.loader,
          path.join(root, "shared", "Unused.ts"),
        ],
        packageDirectory: p.packageDirectory,
        dryRun: true,
        esbuild,
        typescript,
        log: () => {},
      }),
    ).rejects.toThrow(
      `The entry loader ${path.join(root, "shared", "Unused.ts")} is not a file the walk read`,
    );
  });

  test("an entry loader that loads and starts nothing by a computed name any more has to leave the list", async () => {
    const root = startingProgram();
    const p = paths(root);
    writeTree(root, {
      "shared/Loader.ts": [
        "export const loadPlugin = (): unknown => {",
        '  return require("alpha");',
        "};",
        'export { default as alpha } from "alpha";',
        "",
      ].join("\n"),
    });

    await expect(
      pruneUnreachablePackages({
        entries: [p.entry, p.worker, p.plugin],
        entryLoaders: [p.starter, p.loader],
        packageDirectory: p.packageDirectory,
        dryRun: true,
        esbuild,
        typescript,
        log: () => {},
      }),
    ).rejects.toThrow(
      `The entry loader ${p.loader} loads and starts nothing by a computed name any more: take it out of the --entry-loader list.`,
    );
  });

  test("an entry loader or an entry that does not exist is refused", async () => {
    const root = startingProgram();
    const p = paths(root);

    await expect(
      pruneUnreachablePackages({
        entries: [p.entry, p.worker, p.plugin],
        entryLoaders: [p.starter, path.join(root, "shared", "Gone.ts")],
        packageDirectory: p.packageDirectory,
        dryRun: true,
        esbuild,
        typescript,
        log: () => {},
      }),
    ).rejects.toThrow(
      `The entry loader ${path.join(root, "shared", "Gone.ts")} does not exist`,
    );
    await expect(
      pruneUnreachablePackages({
        entries: [p.entry, path.join(root, "shared", "Gone.cjs")],
        packageDirectory: p.packageDirectory,
        dryRun: true,
        esbuild,
        typescript,
        log: () => {},
      }),
    ).rejects.toThrow(
      `The entry point ${path.join(root, "shared", "Gone.cjs")} does not exist`,
    );
  });
});

/*
 * The App's two entry loaders, as they read today: each one call the walk
 * cannot follow, of the file the App image walks as an entry of its own.
 * A new computed load or start in either file has to be looked at (is it of
 * an entry?) before it is added here. Needs no installed packages, so it runs
 * in CI's Ops job too.
 */
describe("the App's entry loaders", () => {
  function computedIn(relativePath) {
    const file = path.join(REPO_ROOT, relativePath);
    return computedImportsIn({
      file,
      source: fs.readFileSync(file, "utf8"),
      typescript,
    }).map((item) => {
      return item.text;
    });
  }

  test("the Enterprise loader requires ee/'s entry file, and nothing else, by a computed name", () => {
    expect(computedIn("packages/App/Utils/EnterpriseLoader.ts")).toEqual([
      "require(entryFile)",
    ]);
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "packages/App/Utils/EnterpriseLoader.ts"),
      "utf8",
    );
    // The file it requires is one of ee/'s two entry candidates.
    expect(source).toContain('path.join("Server", "Index.ts")');
  });

  test("the external calendar starts its worker's file, and nothing else, beside the App", () => {
    expect(
      computedIn(
        "packages/Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion.ts",
      ),
    ).toEqual(["new Worker(EXTERNAL_CALENDAR_WORKER_PATH, {"]);
    const source = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion.ts",
      ),
      "utf8",
    );
    expect(source).toContain('"ExternalCalendarExpansionWorker.cjs"');
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "packages/Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansionWorker.cjs",
        ),
      ),
    ).toBe(true);
  });
});

/*
 * The same with real npm: packages packed into tarballs and installed with
 * npm, so package-lock.json and node_modules are npm's own, then the script
 * runs its real `npm prune --omit=dev --offline`.
 */
describe("with real npm", () => {
  function npm(args, cwd) {
    const result = spawnSync("npm", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: path.join(cwd, "..", "npm-cache"),
        npm_config_update_notifier: "false",
      },
    });
    if (result.status !== 0) {
      throw new Error(
        `npm ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
      );
    }
    return result.stdout;
  }

  function pack(root, name, files) {
    const source = path.join(root, "sources", name);
    writeTree(source, files);
    const output = npm(
      ["pack", "--json", "--pack-destination", path.join(root, "tarballs")],
      source,
    );
    return path.join(root, "tarballs", JSON.parse(output)[0].filename);
  }

  test("removes what nothing reached with what only it needed, keeps a reached package's own dependencies, and downloads nothing", async () => {
    const root = temporaryDirectory("prune-npm-");
    fs.mkdirSync(path.join(root, "tarballs"));
    const tarballs = {
      helper: pack(root, "helper", {
        "package.json": packageJson("helper", { main: "index.js" }),
        "index.js": "module.exports = 'helper';\n",
      }),
      onlyForUnused: pack(root, "only-for-unused", {
        "package.json": packageJson("only-for-unused", { main: "index.js" }),
        "index.js": "module.exports = 1;\n",
      }),
      devTool: pack(root, "dev-tool", {
        "package.json": packageJson("dev-tool", { main: "index.js" }),
        "index.js": "module.exports = 1;\n",
      }),
    };
    // used depends on helper but only requires it by a computed name, so the
    // walk never sees helper used; npm keeps it because used declares it.
    tarballs.used = pack(root, "used", {
      "package.json": packageJson("used", {
        main: "index.js",
        dependencies: { helper: `file:${tarballs.helper}` },
      }),
      "index.js":
        "const name = 'hel' + 'per';\nmodule.exports = () => require(name);\n",
    });
    tarballs.unused = pack(root, "unused", {
      "package.json": packageJson("unused", {
        main: "index.js",
        dependencies: { "only-for-unused": `file:${tarballs.onlyForUnused}` },
      }),
      "index.js": 'module.exports = require("only-for-unused");\n',
    });

    const program = path.join(root, "program");
    writeTree(program, {
      "package.json": {
        ...packageJson("program"),
        dependencies: {
          used: `file:${tarballs.used}`,
          unused: `file:${tarballs.unused}`,
        },
        devDependencies: { "dev-tool": `file:${tarballs.devTool}` },
      },
      "Index.ts": 'import used from "used";\nexport default used;\n',
    });
    npm(["install", "--offline", "--no-audit", "--no-fund"], program);
    for (const name of [
      "used",
      "helper",
      "unused",
      "only-for-unused",
      "dev-tool",
    ]) {
      expect(fs.existsSync(path.join(program, "node_modules", name))).toBe(
        true,
      );
    }

    const result = await pruneUnreachablePackages({
      entry: path.join(program, "Index.ts"),
      packageDirectory: program,
      esbuild,
      typescript,
      log: () => {},
    });

    expect(result.removed).toEqual(["unused"]);
    const left = fs
      .readdirSync(path.join(program, "node_modules"))
      .filter((name) => {
        return !name.startsWith(".");
      })
      .sort();
    expect(left).toEqual(["helper", "used"]);
    expect(
      JSON.parse(fs.readFileSync(path.join(program, "package.json"), "utf8"))
        .dependencies,
    ).toEqual({ used: `file:${tarballs.used}` });
  }, 120000);

  /*
   * 14.0.100's image build: debug (through acme-client) requires
   * supports-color in a try, and depends on nothing that brings it. Only
   * chalk did, for @elastic/elasticsearch's apache-arrow, which the sidecar
   * never reaches - so npm removed supports-color and has-flag, and the
   * build stopped on "npm prune removed packages the program reaches".
   */
  test("keeps a package the program reaches that only an unreached package kept installed, with what it needs", async () => {
    const root = temporaryDirectory("prune-npm-optional-");
    fs.mkdirSync(path.join(root, "tarballs"));
    const tarballs = {
      hasFlag: pack(root, "has-flag", {
        "package.json": packageJson("has-flag", {
          version: "4.0.0",
          main: "index.js",
        }),
        "index.js": "module.exports = () => false;\n",
      }),
    };
    tarballs.supportsColor = pack(root, "supports-color", {
      "package.json": packageJson("supports-color", {
        version: "7.2.0",
        main: "index.js",
        dependencies: { "has-flag": `file:${tarballs.hasFlag}` },
      }),
      "index.js": 'module.exports = require("has-flag")();\n',
    });
    tarballs.logger = pack(root, "logger", {
      "package.json": packageJson("logger", { main: "index.js" }),
      "index.js": [
        "let colors = null;",
        'try { colors = require("supports-color"); } catch (error) { colors = null; }',
        "module.exports = () => colors;",
        "",
      ].join("\n"),
    });
    tarballs.unused = pack(root, "unused", {
      "package.json": packageJson("unused", {
        main: "index.js",
        dependencies: { "supports-color": `file:${tarballs.supportsColor}` },
      }),
      "index.js": 'module.exports = require("supports-color");\n',
    });

    const program = path.join(root, "program");
    writeTree(program, {
      "package.json": {
        ...packageJson("program"),
        dependencies: {
          logger: `file:${tarballs.logger}`,
          unused: `file:${tarballs.unused}`,
        },
      },
      "Index.ts": 'import logger from "logger";\nexport default logger;\n',
    });
    npm(["install", "--offline", "--no-audit", "--no-fund"], program);
    for (const name of ["logger", "unused", "supports-color", "has-flag"]) {
      expect(fs.existsSync(path.join(program, "node_modules", name))).toBe(
        true,
      );
    }

    const result = await pruneUnreachablePackages({
      entry: path.join(program, "Index.ts"),
      packageDirectory: program,
      esbuild,
      typescript,
      log: () => {},
    });

    expect(result.removed).toEqual(["unused"]);
    expect(result.added).toEqual([
      { name: "supports-color", version: "7.2.0" },
    ]);
    const left = fs
      .readdirSync(path.join(program, "node_modules"))
      .filter((name) => {
        return !name.startsWith(".");
      })
      .sort();
    expect(left).toEqual(["has-flag", "logger", "supports-color"]);
    expect(
      JSON.parse(fs.readFileSync(path.join(program, "package.json"), "utf8"))
        .dependencies,
    ).toEqual({
      logger: `file:${tarballs.logger}`,
      "supports-color": "7.2.0",
    });
  }, 120000);
});

/*
 * The real sidecar, where its packages are installed: a developer's checkout
 * after `npm ci` in packages/Common and packages/Nginx, and Ops Config Test's
 * ingress-prune job, which installs both and sets
 * RUN_REAL_SIDECAR_PRUNE_TESTS=1: there these fail, rather than skip, when the
 * packages are missing. The job's main test step installs neither, and until
 * 2026-11-02 the image build was the only check of the real sidecar: #5358's
 * require.resolve("typeorm") failed master's Push Test Images after it merged
 * (fixed in 552b5ee5e4), and would have failed the release that carried it.
 */
const SIDECAR_ENTRY = path.join(REPO_ROOT, "packages", "Nginx", "Index.ts");
const SIDECAR_INSTALLED =
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "Nginx", "node_modules", "Common"),
  ) &&
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "Common", "node_modules", "typeorm"),
  );
const REAL_SIDECAR_REQUIRED = process.env.RUN_REAL_SIDECAR_PRUNE_TESTS === "1";
const OPS_WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "test.ops.yaml",
);

describe("the real certificate sidecar's walk runs in CI", () => {
  test("where RUN_REAL_SIDECAR_PRUNE_TESTS asks for it, packages/Common's and packages/Nginx's packages are installed", () => {
    if (!REAL_SIDECAR_REQUIRED) {
      return;
    }

    expect({
      required: REAL_SIDECAR_REQUIRED,
      nginxLinksCommon: fs.existsSync(
        path.join(REPO_ROOT, "packages", "Nginx", "node_modules", "Common"),
      ),
      commonHasTypeorm: fs.existsSync(
        path.join(REPO_ROOT, "packages", "Common", "node_modules", "typeorm"),
      ),
    }).toEqual({
      required: true,
      nginxLinksCommon: true,
      commonHasTypeorm: true,
    });
  });

  test("Ops Config Test's ingress-prune job installs both and runs this suite with RUN_REAL_SIDECAR_PRUNE_TESTS=1", () => {
    const yaml = require("js-yaml");
    const {
      stepCommand,
      stepWorkingDirectory,
    } = require("./Utils/WorkflowStep");
    const job = yaml.load(fs.readFileSync(OPS_WORKFLOW, "utf8")).jobs[
      "ingress-prune"
    ];

    expect(job).toBeDefined();

    const steps = job.steps;
    const installs = steps
      .filter((step) => {
        return stepCommand(step).startsWith("npm ");
      })
      .map((step) => {
        return stepWorkingDirectory(step);
      });

    expect(installs).toEqual([
      "Tests/Ops",
      "packages/Common",
      "packages/Nginx",
    ]);

    const runs = steps.filter((step) => {
      return stepCommand(step).includes("PruneUnreachablePackages");
    });

    expect(runs).toHaveLength(1);
    expect(stepWorkingDirectory(runs[0])).toBe("Tests/Ops");
    expect(runs[0].env).toEqual(
      expect.objectContaining({ RUN_REAL_SIDECAR_PRUNE_TESTS: "1" }),
    );
    // After the installs it needs, under a limit of its own.
    expect(steps.indexOf(runs[0])).toBeGreaterThan(
      steps.findIndex((step) => {
        return stepWorkingDirectory(step) === "packages/Nginx";
      }),
    );
    expect(Number(job["timeout-minutes"])).toBeGreaterThan(0);
  });
});

// Packages a reached package requires inside a try or for a database
// OneUptime does not use. None is installed, and none has to be (ssh2's
// cpu-features, a native helper it requires in a try, is installed where a
// build of it can be made: the Runner image's build stage).
const OPTIONAL_MISSING = new Set([
  "@google-cloud/spanner",
  "@sap/hana-client",
  "@sap/hana-client/extension/Stream",
  "better-sqlite3",
  "bufferutil",
  "cpu-features",
  "encoding",
  "mongodb",
  "mysql",
  "oracledb",
  "pg-native",
  "pg-query-stream",
  "react-native-sqlite-storage",
  "redis",
  "sql.js",
  "sqlite3",
  "typeorm-aurora-data-api-driver",
  "utf-8-validate",
]);

(SIDECAR_INSTALLED || REAL_SIDECAR_REQUIRED ? describe : describe.skip)(
  "the real certificate sidecar",
  () => {
    let walk;
    const common = path.join(REPO_ROOT, "packages", "Common");

    beforeAll(async () => {
      walk = await walkImports({ entry: SIDECAR_ENTRY, esbuild });
    }, 120000);

    // The top-level packages of Common the walk reached, by name.
    function reachedNames() {
      const nodeModules = path.join(common, "node_modules");
      return new Set(
        [...walk.reached]
          .map((directory) => {
            return path.relative(nodeModules, directory).split(path.sep);
          })
          .filter((parts) => {
            return parts[0] !== ".." && !parts.includes("node_modules");
          })
          .map((parts) => {
            return parts.join("/");
          }),
      );
    }

    test("loads nothing by a computed name", () => {
      expect(walk.ownFiles.length).toBeGreaterThan(1000);
      expect(findComputedImports({ files: walk.ownFiles, typescript })).toEqual(
        [],
      );
    });

    test("reaches what the sidecar runs on", () => {
      const names = reachedNames();
      for (const name of [
        "typeorm",
        "pg",
        "express",
        "ioredis",
        "acme-client",
        "node-forge",
        "reflect-metadata",
      ]) {
        expect({ name, reached: names.has(name) }).toEqual({
          name,
          reached: true,
        });
      }
    });

    test("reaches none of the Dashboard's packages", () => {
      const names = reachedNames();
      for (const name of [
        "mermaid",
        "react",
        "react-dom",
        "recharts",
        "posthog-js",
        "playwright",
        "esbuild",
        "twilio",
        "stripe",
      ]) {
        expect({ name, reached: names.has(name) }).toEqual({
          name,
          reached: false,
        });
      }
    });

    test("finds missing only the optional packages it is known to", () => {
      const missing = [
        ...new Set(
          walk.missing.map((item) => {
            return item.specifier;
          }),
        ),
      ].filter((specifier) => {
        return !OPTIONAL_MISSING.has(specifier);
      });
      expect(missing).toEqual([]);
    });
  },
);

/*
 * The top-level packages of Common a walk reached, by name.
 */
function reachedCommonNames(walk) {
  const nodeModules = path.join(
    REPO_ROOT,
    "packages",
    "Common",
    "node_modules",
  );
  return new Set(
    [...walk.reached]
      .map((directory) => {
        return path.relative(nodeModules, directory).split(path.sep);
      })
      .filter((parts) => {
        return parts[0] !== ".." && !parts.includes("node_modules");
      })
      .map((parts) => {
        return parts.join("/");
      }),
  );
}

function missingBeyondTheOptional(walk) {
  return [
    ...new Set(
      walk.missing.map((item) => {
        return item.specifier;
      }),
    ),
  ].filter((specifier) => {
    return !OPTIONAL_MISSING.has(specifier);
  });
}

// What none of the server programs loads: the Dashboard's and the build's.
const FRONTEND_AND_BUILD_PACKAGES = [
  "mermaid",
  "react",
  "react-dom",
  "recharts",
  "reactflow",
  "posthog-js",
  "playwright",
  "esbuild",
  "@testing-library/react",
];

const COMMON_INSTALLED = fs.existsSync(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "typeorm"),
);

/*
 * The real Runner, where its packages are installed (after `npm ci` in
 * packages/Common and packages/Runner). Elsewhere the image build runs this
 * walk, and RunnerImageRuntime.test.js starts the image it leaves.
 */
const RUNNER_ENTRY = path.join(REPO_ROOT, "packages", "Runner", "Index.ts");
const RUNNER_INSTALLED =
  COMMON_INSTALLED &&
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "Runner", "node_modules", "Common"),
  );

(RUNNER_INSTALLED ? describe : describe.skip)("the real Runner", () => {
  let walk;

  beforeAll(async () => {
    walk = await walkImports({ entry: RUNNER_ENTRY, esbuild });
  }, 180000);

  test("loads and starts nothing by a computed name", () => {
    expect(walk.ownFiles.length).toBeGreaterThan(300);
    expect(findComputedImports({ files: walk.ownFiles, typescript })).toEqual(
      [],
    );
  });

  test("reaches what the Runner runs on", () => {
    const names = reachedCommonNames(walk);
    for (const name of ["isolated-vm", "express", "axios", "ioredis"]) {
      expect({ name, reached: names.has(name) }).toEqual({
        name,
        reached: true,
      });
    }
    // ssh2 and ts-node are the Runner's own dependencies, kept by its own install.
    const runnerModules = path.join(
      REPO_ROOT,
      "packages",
      "Runner",
      "node_modules",
    );
    expect(
      [...walk.reached].some((directory) => {
        return directory === fs.realpathSync(path.join(runnerModules, "ssh2"));
      }),
    ).toBe(true);
  });

  test("reaches none of the Dashboard's or the build's packages", () => {
    const names = reachedCommonNames(walk);
    for (const name of [...FRONTEND_AND_BUILD_PACKAGES, "twilio", "stripe"]) {
      expect({ name, reached: names.has(name) }).toEqual({
        name,
        reached: false,
      });
    }
  });

  test("finds missing only the optional packages it is known to", () => {
    expect(missingBeyondTheOptional(walk)).toEqual([]);
  });
});

/*
 * The real App, as the App image walks it (packages/App/Dockerfile.tpl):
 * its entry and the external calendar's worker, with the Enterprise loader
 * and the external calendar as its entry loaders. Where its packages are
 * installed (after `npm ci` in packages/Common and packages/App); elsewhere
 * the image build runs this walk.
 */
const APP_ENTRY = path.join(REPO_ROOT, "packages", "App", "Index.ts");
const CALENDAR_DIRECTORY = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Server",
  "Utils",
  "ScheduledMaintenance",
  "ExternalCalendar",
);
const CALENDAR_WORKER = path.join(
  CALENDAR_DIRECTORY,
  "ExternalCalendarExpansionWorker.cjs",
);
const APP_ENTRY_LOADERS = [
  path.join(REPO_ROOT, "packages", "App", "Utils", "EnterpriseLoader.ts"),
  path.join(CALENDAR_DIRECTORY, "ExternalCalendarExpansion.ts"),
];
const APP_INSTALLED =
  COMMON_INSTALLED &&
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "App", "node_modules", "Common"),
  );

(APP_INSTALLED ? describe : describe.skip)("the real App", () => {
  let walk;
  let alone;

  beforeAll(async () => {
    walk = await walkImports({
      entries: [APP_ENTRY, CALENDAR_WORKER],
      esbuild,
    });
    alone = await walkImports({ entry: APP_ENTRY, esbuild });
  }, 300000);

  test("loads and starts code by a computed name only in its two entry loaders", () => {
    const computed = findComputedImports({ files: walk.ownFiles, typescript });
    expect(
      [
        ...new Set(
          computed.map((item) => {
            return item.file;
          }),
        ),
      ].sort(),
    ).toEqual(
      APP_ENTRY_LOADERS.map((file) => {
        return fs.realpathSync(file);
      }).sort(),
    );
    for (const loader of APP_ENTRY_LOADERS) {
      expect(walk.ownFiles).toContain(fs.realpathSync(loader));
    }
  });

  test("reaches ical.js only through the external calendar's worker, which is why the worker is an entry", () => {
    expect(reachedCommonNames(alone).has("ical.js")).toBe(false);
    expect(reachedCommonNames(walk).has("ical.js")).toBe(true);
  });

  test("reaches what the App runs on", () => {
    const names = reachedCommonNames(walk);
    for (const name of [
      "typeorm",
      "pg",
      "express",
      "ioredis",
      "bullmq",
      "@clickhouse/client",
      "isolated-vm",
      "ical.js",
      "marked",
    ]) {
      expect({ name, reached: names.has(name) }).toEqual({
        name,
        reached: true,
      });
    }
  });

  test("reaches none of the Dashboard's or the build's packages", () => {
    const names = reachedCommonNames(walk);
    for (const name of FRONTEND_AND_BUILD_PACKAGES) {
      expect({ name, reached: names.has(name) }).toEqual({
        name,
        reached: false,
      });
    }
  });

  test("reaches no package of the frontends' own installs: the image removes them once the bundles are built", () => {
    const featureSets = path.join(REPO_ROOT, "packages", "App", "FeatureSet");
    expect(
      [...walk.reached].filter((directory) => {
        return directory.startsWith(
          `${fs.realpathSync(featureSets)}${path.sep}`,
        );
      }),
    ).toEqual([]);
  });

  test("finds missing only the optional packages it is known to", () => {
    expect(missingBeyondTheOptional(walk)).toEqual([]);
  });
});
