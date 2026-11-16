import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import url from "url";
import type * as PrecompileModule from "../../../../Server/Utils/TsNode/Precompile";
import type * as PrecompiledSourceMapsModule from "../../../../Server/Utils/TsNode/PrecompiledSourceMaps";
import type * as TranspilerModule from "../../../../Server/Utils/TsNode/Transpiler";

/*
 * Common/Server/Utils/TsNode/PrecompiledSourceMaps.js, which every image's
 * start command requires before the JavaScript its build compiled
 * (Precompile.js): stack traces name the TypeScript files, lines and columns
 * through the maps the build wrote beside each module, read the first time a
 * stack trace passes through it, and with source-map-support's caches
 * bounded; the source line of an uncaught exception comes from the
 * TypeScript on disk; and no TypeScript is loaded, by name or by an import
 * the build did not compile. A process that runs through ts-node keeps
 * ts-node's.
 *
 * Each case runs in a node of its own, as an image's start command runs it:
 * jest installs source maps of its own. App/Tests/PrecompiledServer does the
 * same on the App and Common compiled whole.
 */

const TS_NODE_FOLDER: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Utils",
  "TsNode",
);
const PRECOMPILED_SOURCE_MAPS: string = path.join(
  TS_NODE_FOLDER,
  "PrecompiledSourceMaps.js",
);

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Precompile: typeof PrecompileModule = require(
  path.join(TS_NODE_FOLDER, "Precompile.js"),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Transpiler: typeof TranspilerModule = require(
  path.join(TS_NODE_FOLDER, "Transpiler.js"),
);

const COMPILER_OPTIONS: Record<string, unknown> =
  Transpiler.runtimeCompilerOptions({
    target: ts.ScriptTarget.ES2018,
    module: ts.ModuleKind.CommonJS,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    esModuleInterop: true,
    sourceMap: true,
    inlineSourceMap: false,
    inlineSources: true,
    outDir: ".ts-node",
  });

/*
 * Thrower.ts throws from a line and column a stack trace names; its
 * JavaScript puts them elsewhere (helpers above, types gone).
 */
const THROWER: string = [
  "interface Shape {",
  "  side: number;",
  "}",
  "",
  "export function area(shape: Shape): number {",
  "  if (shape.side < 0) {",
  '    throw new Error("a side cannot be negative");',
  "  }",
  "  return shape.side * shape.side;",
  "}",
  "",
].join("\n");
// Where the TypeScript throws: line 7, the column of `new`.
const THROWN_AT: string = "Thrower.ts:7:11";

let root: string = "";

function node(
  args: Array<string>,
  options: { cwd?: string } = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    timeout: 60000,
  });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-precompiled-"));
  fs.writeFileSync(path.join(root, "Thrower.ts"), THROWER);
  fs.writeFileSync(
    path.join(root, "Uncompiled.ts"),
    "export const value: number = 1;\n",
  );
  fs.writeFileSync(path.join(root, "Plain.js"), "module.exports = 1;\n");
  const result: PrecompileModule.CompileResult = Precompile.compileFiles(
    ts,
    [path.join(root, "Thrower.ts")],
    COMPILER_OPTIONS,
    Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
  );
  expect(result.failures).toEqual([]);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const STACK_OF_THE_THROW: string = [
  'try { require("./Thrower").area({ side: -1 }); } catch (error) {',
  '  process.stdout.write(error.stack.split("\\n").slice(0, 2).join("\\n"));',
  "}",
].join("\n");

describe("stack traces", () => {
  test("name the TypeScript's file, line and column", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      STACK_OF_THE_THROW,
    ]);

    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("Error: a side cannot be negative");
    expect(run.stdout).toContain(`${path.join(root, THROWN_AT)})`);
  });

  test("(control) without it, they name the JavaScript", () => {
    const run: SpawnSyncReturns<string> = node(["-e", STACK_OF_THE_THROW]);

    expect(run.stdout).toContain(path.join(root, "Thrower.js:"));
    expect(run.stdout).not.toContain("Thrower.ts");
  });

  test("an uncaught exception prints the TypeScript line it was thrown from, read from disk", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      'require("./Thrower").area({ side: -1 });',
    ]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(path.join(root, THROWN_AT));
    expect(run.stderr).toContain(
      '    throw new Error("a side cannot be negative");',
    );
  });

  test("a map is read when a stack trace first passes through its module, not when the module loads", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      [
        'const fs = require("fs");',
        "const read = [];",
        "const readFileSync = fs.readFileSync;",
        "fs.readFileSync = function (file, ...rest) { read.push(String(file)); return readFileSync.call(this, file, ...rest); };",
        'const thrower = require("./Thrower");',
        'const before = read.filter((file) => file.endsWith(".map"));',
        "try { thrower.area({ side: -1 }); } catch (error) { void error.stack; }",
        'const after = read.filter((file) => file.endsWith(".map"));',
        "process.stdout.write(JSON.stringify({ before, after }));",
      ].join("\n"),
    ]);

    expect(JSON.parse(run.stdout)).toEqual({
      before: [],
      after: [path.join(root, "Thrower.js.map")],
    });
  });

  test("source-map-support keeps what it read within a budget", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      [
        'const shared = globalThis[Symbol.for("source-map-support/sharedData")];',
        'shared.fileContentsCache["first"] = "x".repeat(8 * 1024 * 1024);',
        'shared.fileContentsCache["second"] = "y";',
        'process.stdout.write(JSON.stringify(Object.keys(shared.fileContentsCache)));',
      ].join("\n"),
    ]);

    // The text kept first went once the budget was passed.
    expect(JSON.parse(run.stdout)).toEqual(["second"]);
  });
});

describe("TypeScript", () => {
  test("a .ts file required by name is refused, and the error says why", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      'require("./Uncompiled.ts");',
    ]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(
      `${path.join(root, "Uncompiled.ts")} is TypeScript, and this process runs the JavaScript its image compiled when it was built`,
    );
  });

  test("an import of a file the build did not compile is refused, where it would not be found", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      'require("./Uncompiled");',
    ]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(
      "Either the build did not compile Uncompiled.ts, or something requires it by its .ts name",
    );
  });

  test("(control) without it, Node runs a .ts file asked for by name with its own type stripping", () => {
    const run: SpawnSyncReturns<string> = node([
      "-e",
      'process.stdout.write(String(require("./Uncompiled.ts").value));',
    ]);

    expect(run.stdout).toBe("1");
  });

  test("JavaScript, compiled or not, loads as before", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      'process.stdout.write(String(require("./Plain") + require("./Thrower").area({ side: 2 })));',
    ]);

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("5");
  });
});

describe("under ts-node", () => {
  test("it does nothing: ts-node has its own source maps, and loads the TypeScript", () => {
    const run: SpawnSyncReturns<string> = node([
      "-e",
      [
        'process[Symbol.for("ts-node.register.instance")] = {};',
        'const installed = require(process.argv[1]).install();',
        'const shared = globalThis[Symbol.for("source-map-support/sharedData")];',
        'process.stdout.write(JSON.stringify({ installed, ts: Boolean(require("module")._extensions[".ts"]), sourceMapSupport: Boolean(shared) }));',
      ].join("\n"),
      PRECOMPILED_SOURCE_MAPS,
    ]);

    expect(JSON.parse(run.stdout)).toEqual({
      installed: false,
      ts: false,
      sourceMapSupport: false,
    });
  });

  test("and installs once in a process that requires it twice", () => {
    const run: SpawnSyncReturns<string> = node([
      "--require",
      PRECOMPILED_SOURCE_MAPS,
      "-e",
      'process.stdout.write(String(require(process.argv[1]).install()));',
      PRECOMPILED_SOURCE_MAPS,
    ]);

    expect(run.stdout).toBe("false");
  });
});

describe("the maps it hands source-map-support", () => {
  /*
   * What retrieveSourceMap answers for each source, asked in a node of its
   * own (requiring the module installs it, which jest's process must not).
   */
  function retrieve(
    sources: Array<unknown>,
  ): Array<PrecompiledSourceMapsModule.PrecompiledSourceMap | null> {
    const run: SpawnSyncReturns<string> = node([
      "-e",
      [
        "const { retrieveSourceMap } = require(process.argv[1]);",
        "const sources = JSON.parse(process.argv[2]);",
        "process.stdout.write(JSON.stringify(sources.map(retrieveSourceMap)));",
      ].join("\n"),
      PRECOMPILED_SOURCE_MAPS,
      JSON.stringify(sources),
    ]);
    expect(run.stderr).toBe("");
    return JSON.parse(run.stdout);
  }

  test("the map beside a compiled module, by file name or file URL, named by its own path", () => {
    const javaScript: string = path.join(root, "Thrower.js");
    const expected: PrecompiledSourceMapsModule.PrecompiledSourceMap = {
      url: `${javaScript}.map`,
      map: fs.readFileSync(`${javaScript}.map`, "utf8"),
    };

    expect(
      retrieve([javaScript, url.pathToFileURL(javaScript).href]),
    ).toEqual([expected, expected]);
  });

  test("none for a module without a map, an installed package's script, a TypeScript file, a relative name or not a name: source-map-support's own handler looks at those", () => {
    fs.mkdirSync(path.join(root, "node_modules", "package"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "node_modules", "package", "index.js"),
      "module.exports = 1;\n",
    );
    fs.writeFileSync(
      path.join(root, "node_modules", "package", "index.js.map"),
      "{}",
    );

    expect(
      retrieve([
        path.join(root, "Plain.js"),
        path.join(root, "node_modules", "package", "index.js"),
        path.join(root, "Thrower.ts"),
        "Thrower.js",
        "",
        7,
        null,
      ]),
    ).toEqual([null, null, null, null, null, null, null]);
  });

  test("needs nothing but Node, its sibling and source-map-support: it loads before anything else", () => {
    const required: Array<string> = [];
    for (const match of fs
      .readFileSync(PRECOMPILED_SOURCE_MAPS, "utf8")
      .matchAll(/require\(\s*"([^"]+)"\s*\)/gu)) {
      required.push(match[1] as string);
    }

    expect(required.sort()).toEqual([
      "./SourceMapSupportCaches.js",
      "@cspotcode/source-map-support",
      "fs",
      "module",
      "path",
      "url",
    ]);
  });
});
