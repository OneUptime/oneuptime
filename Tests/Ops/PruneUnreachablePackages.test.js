"use strict";

/**
 * Scripts/Docker/PruneUnreachablePackages.js - how the Nginx image keeps only
 * the packages its certificate sidecar reaches.
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
 *    stylesheet) do not stop it.
 *  - What it refuses: a require() or import() of a computed name, a
 *    require.resolve() or a createRequire() in the program's own files (read
 *    with TypeScript's parser, so a comment or a string that says
 *    "require(name)" is not one) - they could need any package - while one
 *    inside a package is fine, since npm keeps a kept package's own
 *    dependencies. And a walk that read nothing, which would prune
 *    everything. Refusing changes nothing.
 *  - The prune: only dependencies the walk never reached leave package.json,
 *    every other field stays, then `npm prune --omit=dev --offline` runs in
 *    the package, and it fails if npm removed anything the walk reached.
 *    With real npm, on packages packed and installed for the test: the
 *    unreached package goes with the dependency only it needed and the
 *    development packages, a reached package keeps a dependency of its own
 *    the walk never saw used, and nothing is downloaded.
 *  - The real sidecar, where its packages are installed (a developer's
 *    checkout; the image build itself is the check everywhere else): the
 *    walk reads its files without a computed import, reaches what the
 *    sidecar runs on and none of the Dashboard's packages, and every package
 *    it finds missing is one of the optional ones below.
 *
 * ContainerImageHardening.test.js holds the Nginx Dockerfile's stages to the
 * script (where it runs, and that only what it leaves ships).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const esbuild = require("esbuild");
const typescript = require("typescript");

const {
  NOT_CODE,
  computedImportsIn,
  directorySize,
  findComputedImports,
  packageDirectoryOf,
  parseArguments,
  pruneUnreachablePackages,
  unreachedDependencies,
  walkImports,
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
      packageDirectory: "/usr/src/Common",
      dryRun: false,
    });
    expect(
      parseArguments(["--dry-run", "--package", "a", "--entry", "b"]),
    ).toEqual({
      entry: path.resolve("b"),
      packageDirectory: path.resolve("a"),
      dryRun: true,
    });
  });

  test("refuses a missing value, a missing option and an unknown one", () => {
    expect(() => {
      return parseArguments(["--entry"]);
    }).toThrow("--entry needs a value");
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

  test("require.resolve() and createRequire() are, whatever they name", () => {
    expect(
      computed(
        [
          'import { createRequire } from "module";',
          'export const where = require.resolve("typeorm");',
          "export const local = createRequire(__filename);",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 2, text: 'require.resolve("typeorm")' },
      { line: 3, text: "createRequire(__filename)" },
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

  test("takes the unreached dependencies out of package.json and runs npm prune there, offline", async () => {
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
    expect(result.kept).toBe(8);
    expect(result.after).toBeLessThan(result.before);
    expect(sharedManifest(root)).toEqual({
      ...packageJson("shared"),
      description: "kept as it is",
      dependencies: {
        alpha: "^1.0.0",
        dual: "^1.0.0",
        "not-installed": "^1.0.0",
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
});

/*
 * The real sidecar, where its packages are installed: a developer's checkout
 * after `npm ci` in packages/Common and packages/Nginx. Elsewhere (CI's Ops
 * job installs neither) the image build is the check: it runs this walk and
 * fails on what these tests would.
 */
const SIDECAR_ENTRY = path.join(REPO_ROOT, "packages", "Nginx", "Index.ts");
const SIDECAR_INSTALLED =
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "Nginx", "node_modules", "Common"),
  ) &&
  fs.existsSync(
    path.join(REPO_ROOT, "packages", "Common", "node_modules", "typeorm"),
  );

// Packages a reached package requires inside a try or for a database
// OneUptime does not use. None is installed, and none has to be.
const OPTIONAL_MISSING = new Set([
  "@google-cloud/spanner",
  "@sap/hana-client",
  "@sap/hana-client/extension/Stream",
  "better-sqlite3",
  "bufferutil",
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

(SIDECAR_INSTALLED ? describe : describe.skip)(
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
