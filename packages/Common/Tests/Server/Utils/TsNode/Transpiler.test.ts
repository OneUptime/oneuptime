import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import vm from "vm";
import type * as TranspilerModule from "../../../../Server/Utils/TsNode/Transpiler";
import {
  lastJsonLine,
  runTranspileOnlyNode,
} from "../../../Helpers/TranspileOnlyNode";

/*
 * Common/Server/Utils/TsNode/Transpiler.js: the ts-node transpiler every
 * OneUptime server runs its TypeScript with. Outside development it compiles
 * each module as ts-node does, but without comments and with the module's
 * source map kept outside the code (deflated, handed to source-map-support
 * when a stack trace needs it) - because V8 keeps every script's text, and
 * the App's inline maps were ~470 MB of its heap.
 *
 * These run it as ts-node does - its create() called with ts-node's service,
 * compiler options and resolver - against a stand-in for source-map-support
 * (Common installs neither). App/Tests/TsNodeTranspiler runs it under the
 * real ts-node and compares stack traces.
 */

const TRANSPILER: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Utils",
  "TsNode",
  "Transpiler.js",
);
const STUB: string = path.join(__dirname, "SourceMapSupportStub.js");
const EMPTY_SOURCE_MAP: string =
  '{"version":3,"sources":[],"names":[],"mappings":""}';

type Transpiler = typeof TranspilerModule;

interface Stub {
  installs: Array<Record<string, unknown>>;
}

// Where SourceMapSupportStub.js records what it is told.
const INSTALLS_KEY: string = "__oneuptimeTranspilerTestSourceMapSupportInstalls";

/*
 * A fresh copy of the module (it keeps its maps and its hook per process),
 * and what source-map-support has been told since.
 */
function load(): { transpiler: Transpiler; stub: Stub } {
  let transpiler: Transpiler | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    transpiler = require(TRANSPILER) as Transpiler;
  });
  const installs: Array<Record<string, unknown>> = [];
  (globalThis as unknown as Record<string, unknown>)[INSTALLS_KEY] = installs;
  return { transpiler: transpiler as Transpiler, stub: { installs: installs } };
}

/*
 * The compiler options ts-node hands a transpiler for the App: App's
 * tsconfig, its "ts-node" overrides and the options ts-node forces
 * (sourceMap, inlineSources ...).
 */
const COMPILER_OPTIONS: ts.CompilerOptions = ts.convertCompilerOptionsFromJson(
  {
    target: "es2017",
    module: "commonjs",
    jsx: "react",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    sourceMap: true,
    inlineSourceMap: false,
    inlineSources: true,
    declaration: false,
    noEmit: false,
    outDir: ".ts-node",
  },
  process.cwd(),
).options;

function createOptions(
  extra?: Partial<TranspilerModule.TsNodeTranspilerCreateOptions>,
  asked?: Array<string>,
): TranspilerModule.TsNodeTranspilerCreateOptions {
  return {
    service: {
      options: {},
      config: { options: { ...COMPILER_OPTIONS } },
      projectLocalResolveHelper: (specifier: string): string => {
        asked?.push(specifier);
        if (specifier === "@cspotcode/source-map-support") {
          return STUB;
        }
        return require.resolve(specifier);
      },
    },
    nodeModuleEmitKind: undefined,
    ...extra,
  };
}

function withNodeEnv<T>(value: string | undefined, run: () => T): T {
  const before: string | undefined = process.env["NODE_ENV"];
  if (value === undefined) {
    delete process.env["NODE_ENV"];
  } else {
    process.env["NODE_ENV"] = value;
  }
  try {
    return run();
  } finally {
    if (before === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = before;
    }
  }
}

function transpilerFor(transpiler: Transpiler): TranspilerModule.TsNodeTranspiler {
  return withNodeEnv("production", () => {
    const made: TranspilerModule.TsNodeTranspiler | undefined =
      transpiler.create(createOptions());
    expect(made).toBeDefined();
    return made as TranspilerModule.TsNodeTranspiler;
  });
}

/*
 * A module with what ts-node meets in OneUptime's code: a licence comment,
 * comments with characters past Latin-1, a decorated class with metadata, a
 * template literal holding a dash, and a throw.
 */
const SOURCE: string = [
  "/*!",
  " * A licence comment: it stays.",
  " */",
  "// A comment past Latin-1 \u{2014} it goes, and the script is one byte a character.",
  'import { inspect } from "util";',
  "",
  "/*",
  " * A decorated class: decorators and their metadata compile as before.",
  " */",
  "function Tag(): ClassDecorator {",
  "  return (): void => {};",
  "}",
  "",
  "@Tag()",
  "export class Thing {",
  '  public name: string = "thing";',
  "  public describe(): string {",
  "    return `name \u{2014} ${this.name}`; // a dash in a template literal stays",
  "  }",
  "}",
  "",
  "export function fail(): never {",
  "  // The next line throws.",
  '  throw new Error("boom");',
  "}",
  "",
  "export const shown: string = inspect({ a: 1 });",
  "",
].join("\n");

let directory: string = "";
let moduleFile: string = "";

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-transpiler-"));
  moduleFile = path.join(directory, "Thing.ts").split(path.sep).join("/");
  fs.writeFileSync(moduleFile, SOURCE);
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

// What the module's code does: its exports, run as Node runs a module.
function run(code: string): { described: string; failed: string; shown: string } {
  const exported: Record<string, unknown> = {};
  const wrapper: (
    exports: Record<string, unknown>,
    requireFunction: NodeRequire,
  ) => void = vm.runInThisContext(
    `(function (exports, require) {${code}\n})`,
  ) as (exports: Record<string, unknown>, requireFunction: NodeRequire) => void;
  wrapper(exported, require);
  const Thing: new () => { describe: () => string } = exported["Thing"] as new () => {
    describe: () => string;
  };
  let failed: string = "";
  try {
    (exported["fail"] as () => void)();
  } catch (error) {
    failed = (error as Error).message;
  }
  return {
    described: new Thing().describe(),
    failed: failed,
    shown: exported["shown"] as string,
  };
}

describe("when ts-node hands modules to it", () => {
  test.each([["production"], ["test"], ["staging"], [""], [undefined]])(
    "with NODE_ENV=%s it keeps source maps outside the code",
    (value: string | undefined) => {
      const { transpiler } = load();
      withNodeEnv(value, () => {
        expect(transpiler.keepsSourceMapsOutsideCode()).toBe(true);
      });
    },
  );

  test("in development it is no transpiler at all: ts-node compiles as it always has", () => {
    const { transpiler, stub } = load();
    withNodeEnv("development", () => {
      expect(transpiler.keepsSourceMapsOutsideCode()).toBe(false);
      expect(transpiler.create(createOptions())).toBeUndefined();
    });
    // And source-map-support is left as ts-node installed it.
    expect(stub.installs).toEqual([]);
  });

  test.each([["nodecjs"], ["nodeesm"]])(
    "ts-node's %s emit (node16/nodenext, which no OneUptime package uses) stays ts-node's own",
    (kind: string) => {
      const { transpiler } = load();
      withNodeEnv("production", () => {
        expect(
          transpiler.create(
            createOptions({
              nodeModuleEmitKind: kind as "nodecjs" | "nodeesm",
            }),
          ),
        ).toBeUndefined();
      });
    },
  );

  test("ts-node makes one for each emit variant; source-map-support is told once, of maps only", () => {
    const { transpiler, stub } = load();
    const asked: Array<string> = [];
    withNodeEnv("production", () => {
      for (let variant: number = 0; variant < 5; variant++) {
        expect(transpiler.create(createOptions({}, asked))).toBeDefined();
      }
    });

    expect(stub.installs).toHaveLength(1);
    expect(Object.keys(stub.installs[0] as Record<string, unknown>)).toEqual([
      "retrieveSourceMap",
    ]);
    expect(typeof (stub.installs[0] as Record<string, unknown>)["retrieveSourceMap"]).toBe(
      "function",
    );
    // The TypeScript and source-map-support ts-node resolved, not copies.
    expect(asked.filter((name: string) => name === "typescript")).toHaveLength(5);
    expect(asked.filter((name: string) => name === "@cspotcode/source-map-support")).toHaveLength(1);
  });

  test("the compiler named in ts-node's options is the one it uses", () => {
    const { transpiler } = load();
    const asked: Array<string> = [];
    withNodeEnv("production", () => {
      transpiler.create({
        ...createOptions({}, asked),
        service: {
          ...createOptions({}, asked).service,
          options: { compiler: "typescript" },
        },
      });
    });
    expect(asked).toContain("typescript");
  });
});

describe("the code it hands ts-node", () => {
  test("is TypeScript's own output for ts-node's options, with comments left out and no sources in the map", () => {
    const { transpiler } = load();
    const output: TranspilerModule.TsNodeTranspileOutput = transpilerFor(
      transpiler,
    ).transpile(SOURCE, { fileName: moduleFile });

    const expected: ts.TranspileOutput = ts.transpileModule(SOURCE, {
      fileName: moduleFile,
      compilerOptions: {
        ...COMPILER_OPTIONS,
        inlineSources: false,
        removeComments: true,
      },
      reportDiagnostics: true,
    });

    expect(output.outputText).toBe(expected.outputText);
    expect(output.diagnostics).toEqual([]);
  });

  test("ends with an empty source map: ts-node inlines what it gets, and gets nothing", () => {
    const { transpiler } = load();
    const output: TranspilerModule.TsNodeTranspileOutput = transpilerFor(
      transpiler,
    ).transpile(SOURCE, { fileName: moduleFile });

    expect(output.sourceMapText).toBe(EMPTY_SOURCE_MAP);
    expect(output.outputText).not.toContain("sourcesContent");
  });

  test("keeps licence comments and string text, and leaves every other comment out", () => {
    const { transpiler } = load();
    const code: string = transpilerFor(transpiler).transpile(SOURCE, {
      fileName: moduleFile,
    }).outputText;

    expect(code).toContain("A licence comment: it stays.");
    expect(code).toContain("name \u{2014} ");
    expect(code).not.toContain("A comment past Latin-1");
    expect(code).not.toContain("decorators and their metadata");
    expect(code).not.toContain("The next line throws.");
    expect(code).not.toContain("a dash in a template literal stays");
    // Decorators and their metadata still compile.
    expect(code).toContain("__decorate(");
    expect(code).toContain("Thing = __decorate(");
  });

  test("runs as ts-node's own output runs", () => {
    const { transpiler } = load();
    const ours: string = transpilerFor(transpiler).transpile(SOURCE, {
      fileName: moduleFile,
    }).outputText;
    const tsNodes: string = ts.transpileModule(SOURCE, {
      fileName: moduleFile,
      compilerOptions: COMPILER_OPTIONS,
    }).outputText;

    expect(run(ours)).toEqual(run(tsNodes));
    expect(run(ours)).toEqual({
      described: "name \u{2014} thing",
      failed: "boom",
      shown: "{ a: 1 }",
    });
  });

  test("hands back TypeScript's diagnostics, so ts-node still refuses a module that does not parse", () => {
    const { transpiler } = load();
    const output: TranspilerModule.TsNodeTranspileOutput = transpilerFor(
      transpiler,
    ).transpile("const broken = ;\n", {
      fileName: path.join(directory, "Broken.ts"),
    });

    expect((output.diagnostics || []).length).toBeGreaterThan(0);
  });
});

describe("the source map it keeps", () => {
  function expectedMap(fileName: string): { names: Array<string>; mappings: string } {
    const map: { names: Array<string>; mappings: string } = JSON.parse(
      ts.transpileModule(SOURCE, {
        fileName: fileName,
        compilerOptions: {
          ...COMPILER_OPTIONS,
          inlineSources: false,
          removeComments: true,
        },
      }).sourceMapText as string,
    ) as { names: Array<string>; mappings: string };
    return { names: map.names, mappings: map.mappings };
  }

  test("is TypeScript's map of that code, with the module's TypeScript as its source, as ts-node's inline map was", () => {
    const { transpiler } = load();
    transpilerFor(transpiler).transpile(SOURCE, { fileName: moduleFile });

    const kept: TranspilerModule.KeptSourceMap | null =
      transpiler.retrieveSourceMap(moduleFile);

    expect(kept).toEqual({
      url: moduleFile,
      map: {
        version: 3,
        file: moduleFile,
        sources: [moduleFile],
        ...expectedMap(moduleFile),
        sourcesContent: [SOURCE],
      },
    });
    expect(kept?.map.mappings.length).toBeGreaterThan(100);
  });

  test("reads the module's TypeScript as Node does, without a byte order mark", () => {
    const { transpiler } = load();
    const withBom: string = path.join(directory, "Bom.ts").split(path.sep).join("/");
    fs.writeFileSync(withBom, `\u{feff}${SOURCE}`);
    transpilerFor(transpiler).transpile(SOURCE, { fileName: withBom });

    expect(transpiler.retrieveSourceMap(withBom)?.map.sourcesContent).toEqual([
      SOURCE,
    ]);
  });

  test("still maps a module whose file is gone, without its source", () => {
    const { transpiler } = load();
    const gone: string = path.join(directory, "Gone.ts").split(path.sep).join("/");
    fs.writeFileSync(gone, SOURCE);
    transpilerFor(transpiler).transpile(SOURCE, { fileName: gone });
    fs.rmSync(gone);

    const kept: TranspilerModule.KeptSourceMap | null =
      transpiler.retrieveSourceMap(gone);

    expect(kept?.map.mappings).toBe(expectedMap(gone).mappings);
    expect(kept?.map.sourcesContent).toBeUndefined();
  });

  test("is found by the module's file URL and by a Windows-style path too", () => {
    const { transpiler } = load();
    transpilerFor(transpiler).transpile(SOURCE, { fileName: moduleFile });

    const byUrl: TranspilerModule.KeptSourceMap | null =
      transpiler.retrieveSourceMap(`file://${moduleFile}`);
    expect(byUrl?.map.file).toBe(moduleFile);
    expect(byUrl?.url).toBe(`file://${moduleFile}`);

    const backslashed: TranspilerModule.KeptSourceMap | null =
      transpiler.retrieveSourceMap(moduleFile.split("/").join("\\"));
    expect(backslashed?.map.file).toBe(moduleFile);
  });

  test("is none for a script it did not compile, and never throws", () => {
    const { transpiler } = load();
    transpilerFor(transpiler).transpile(SOURCE, { fileName: moduleFile });

    for (const source of [
      path.join(directory, "Other.ts"),
      "node:internal/modules/cjs/loader",
      "",
      undefined,
      42,
      {},
      "file://%%%",
    ]) {
      expect(transpiler.retrieveSourceMap(source)).toBeNull();
    }
  });

  test("source-map-support is handed this function", () => {
    const { transpiler, stub } = load();
    transpilerFor(transpiler).transpile(SOURCE, { fileName: moduleFile });

    const handler: (source: string) => unknown = (
      stub.installs[0] as Record<string, unknown>
    )["retrieveSourceMap"] as (source: string) => unknown;

    expect(handler(moduleFile)).toEqual(transpiler.retrieveSourceMap(moduleFile));
  });

  test("is kept deflated: a fraction of the map's size", () => {
    const { transpiler } = load();
    const made: TranspilerModule.TsNodeTranspiler = transpilerFor(transpiler);
    // Real modules of Common's, large and small.
    const modules: Array<string> = [
      path.resolve(__dirname, "..", "..", "..", "..", "Server", "Utils", "OpenAPI.ts"),
      path.resolve(__dirname, "..", "..", "..", "..", "Server", "Utils", "Response.ts"),
      path.resolve(__dirname, "..", "..", "..", "..", "Types", "ObjectID.ts"),
    ];
    let raw: number = 0;
    for (const file of modules) {
      const text: string = fs.readFileSync(file, "utf8");
      made.transpile(text, { fileName: file });
      const map: { names: Array<string>; mappings: string } = JSON.parse(
        ts.transpileModule(text, {
          fileName: file,
          compilerOptions: {
            ...COMPILER_OPTIONS,
            inlineSources: false,
            removeComments: true,
          },
        }).sourceMapText as string,
      ) as { names: Array<string>; mappings: string };
      raw += JSON.stringify({ names: map.names, mappings: map.mappings }).length;
    }

    expect(transpiler.keptSourceMapCount()).toBe(modules.length);
    expect(raw).toBeGreaterThan(20000);
    // The App's 5,500 maps: 34.7 MB of JSON, kept in 7.0 MB.
    expect(transpiler.keptSourceMapBytes()).toBeLessThan(raw * 0.35);
  });
});

describe("what it keeps for a whole program", () => {
  /*
   * In a fresh Node: the maps of 400 of Common's modules, kept. They are
   * strings: kept as small Buffers they each pinned a slice of a 64 KB pool
   * slab (Node 26's Buffer.poolSize), and the App's 5,500 held 150 MB of
   * array buffers.
   */
  test("holds no array buffers: the maps are strings on V8's heap", () => {
    const commonDirectory: string = path.resolve(__dirname, "..", "..", "..", "..");
    const script: string = [
      'const fs = require("fs");',
      'const path = require("path");',
      `const transpiler = require(${JSON.stringify(TRANSPILER)});`,
      `const stub = ${JSON.stringify(STUB)};`,
      'process.env.NODE_ENV = "production";',
      `const options = ${JSON.stringify(COMPILER_OPTIONS)};`,
      "const made = transpiler.create({",
      "  service: {",
      "    options: {},",
      "    config: { options },",
      "    projectLocalResolveHelper: (name) => name === '@cspotcode/source-map-support' ? stub : require.resolve(name),",
      "  },",
      "});",
      "const files = [];",
      "function walk(dir) {",
      "  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {",
      "    const full = path.join(dir, entry.name);",
      "    if (entry.isDirectory()) walk(full);",
      "    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full);",
      "  }",
      "}",
      `walk(${JSON.stringify(path.join(commonDirectory, "Types"))});`,
      "files.sort();",
      "(async () => {",
      "  global.gc();",
      "  const before = process.memoryUsage().arrayBuffers;",
      "  for (const file of files.slice(0, 400)) {",
      "    made.transpile(fs.readFileSync(file, 'utf8'), { fileName: file });",
      "  }",
      "  for (let i = 0; i < 3; i++) {",
      "    await new Promise((resolve) => setImmediate(resolve));",
      "    global.gc();",
      "  }",
      "  console.log(JSON.stringify({",
      "    kept: transpiler.keptSourceMapCount(),",
      "    keptBytes: transpiler.keptSourceMapBytes(),",
      "    arrayBuffersGrowth: process.memoryUsage().arrayBuffers - before,",
      "  }));",
      "})();",
    ].join("\n");

    const report: { kept: number; keptBytes: number; arrayBuffersGrowth: number } =
      lastJsonLine<{ kept: number; keptBytes: number; arrayBuffersGrowth: number }>(
        runTranspileOnlyNode(script, {
          cwd: commonDirectory,
          nodeArgs: ["--expose-gc"],
          timeoutMs: 240000,
        }),
      );

    expect(report.kept).toBe(400);
    expect(report.keptBytes).toBeGreaterThan(100 * 1024);
    // Kept as Buffers this was megabytes of pinned pool slabs.
    expect(report.arrayBuffersGrowth).toBeLessThan(512 * 1024);
  }, 300000);
});
