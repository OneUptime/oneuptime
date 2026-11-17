import { afterEach, describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import type * as PrecompileModule from "../../../../Server/Utils/TsNode/Precompile";
import type * as TranspilerModule from "../../../../Server/Utils/TsNode/Transpiler";

/*
 * Common/Server/Utils/TsNode/Precompile.js: compiles a server's TypeScript to
 * JavaScript when its image is built, beside each file, with the options
 * ts-node ran it with (TypeScript's transpileModule through Common's
 * transpiler), so the image runs JavaScript and loads neither TypeScript nor
 * ts-node.
 *
 * These run its parts on folders of their own with Common's TypeScript (Common
 * installs no ts-node, which only the whole compile asks for its options):
 * what it compiles and leaves alone, what it writes, that it refuses a file
 * that is already there, a syntax error and a git checkout, and that its
 * worker threads write what one thread does. App/Tests/PrecompiledServer
 * compiles the App and Common with the App's own ts-node and compares every
 * module with what ts-node runs.
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
const PRECOMPILE: string = path.join(TS_NODE_FOLDER, "Precompile.js");

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Precompile: typeof PrecompileModule = require(PRECOMPILE);
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Transpiler: typeof TranspilerModule = require(
  path.join(TS_NODE_FOLDER, "Transpiler.js"),
);

/*
 * What ts-node hands Common's transpiler for a server (the tsconfig's
 * options, ts-node's "compilerOptions" overrides and the options it forces),
 * made the transpiler's: no TypeScript in the map, no comments.
 */
const COMPILER_OPTIONS: Record<string, unknown> =
  Transpiler.runtimeCompilerOptions({
    target: ts.ScriptTarget.ES2018,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
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
  });

const folders: Array<string> = [];

function makeTree(files: Record<string, string>): string {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-precompile-"),
  );
  folders.push(root);
  for (const [name, text] of Object.entries(files)) {
    const file: string = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

function relative(root: string, files: Array<string>): Array<string> {
  return files
    .map((file: string): string => {
      return path.relative(root, file);
    })
    .sort();
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe("what it compiles", () => {
  test("every TypeScript file under a root, but declarations, installed packages and tests", () => {
    const root: string = makeTree({
      "Index.ts": "export default 1;\n",
      "View.tsx": "export default 2;\n",
      "Types/Thing.d.ts": "export type Thing = string;\n",
      "Utils/Helper.ts": "export default 3;\n",
      "Utils/Plain.js": "module.exports = 4;\n",
      "Tests/Index.test.ts": "export default 5;\n",
      "Deep/Tests/Fixture.ts": "export default 6;\n",
      "node_modules/package/index.ts": "export default 7;\n",
    });

    const found: { compiled: Array<string>; otherPackages: Set<string> } =
      Precompile.findTypeScript(root);

    expect(relative(root, found.compiled)).toEqual([
      "Index.ts",
      "Utils/Helper.ts",
      "View.tsx",
    ]);
    expect(found.otherPackages.size).toBe(0);
  });

  test("a folder with a package.json of its own is another program: only what the compiled files import from it", () => {
    const root: string = makeTree({
      "package.json": "{}",
      "Server/BaseAPI.ts":
        'import { version } from "../Recorder/Manifest";\nexport default version;\n',
      "Recorder/package.json": "{}",
      "Recorder/Manifest.ts":
        'import base from "./Version";\nexport const version = base;\n',
      "Recorder/Version.ts": "export default 1;\n",
      "Recorder/src/Recorder.ts": "export default 2;\n",
      "Recorder/Tests/Manifest.test.ts": 'import "../Manifest";\n',
      "Frontend/package.json": "{}",
      "Frontend/src/Index.tsx": "export default 3;\n",
    });

    const found: { compiled: Array<string>; otherPackages: Set<string> } =
      Precompile.findTypeScript(root);
    expect(relative(root, found.compiled)).toEqual(["Server/BaseAPI.ts"]);
    expect(relative(root, Array.from(found.otherPackages))).toEqual([
      "Frontend",
      "Recorder",
    ]);

    expect(
      relative(
        root,
        Precompile.importedFromOtherPackages(
          ts,
          found.compiled,
          found.otherPackages,
          [root],
        ),
      ),
    ).toEqual(["Recorder/Manifest.ts", "Recorder/Version.ts"]);
  });

  test.each([
    ["./Helper", "Helper.ts"],
    ["./View", "View.tsx"],
    ["./Folder", "Folder/index.ts"],
    ["./Helper.js", "Helper.ts"],
    ["./Missing", null],
    ["./Types", null],
  ])(
    "resolves %s as require() finds its JavaScript",
    (specifier: string, expected: string | null) => {
      const root: string = makeTree({
        "Index.ts": "",
        "Helper.ts": "",
        "View.tsx": "",
        "Folder/index.ts": "",
        "Types.d.ts": "",
      });

      const resolved: string | null = Precompile.resolveRelativeImport(
        path.join(root, "Index.ts"),
        specifier,
      );

      expect(resolved === null ? null : path.relative(root, resolved)).toBe(
        expected,
      );
    },
  );
});

describe("what it writes", () => {
  test("Foo.js beside Foo.ts, as transpile-only ts-node compiles it, ending with its map's name; and the map, naming Foo.ts", () => {
    const source: string = [
      "/*! A licence comment that stays. */",
      "// A comment the code leaves out.",
      'import Thing from "./Thing";',
      "export default class Holder {",
      "  @Column()",
      "  public thing!: Thing;",
      "}",
      "function Column(): PropertyDecorator {",
      "  return (): void => {};",
      "}",
      "",
    ].join("\n");
    const root: string = makeTree({ "Holder.ts": source });
    const file: string = path.join(root, "Holder.ts");

    const result: PrecompileModule.CompileResult = Precompile.compileFiles(
      ts,
      [file],
      COMPILER_OPTIONS,
      Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
    );
    expect(result.failures).toEqual([]);

    const javaScript: string = fs.readFileSync(
      path.join(root, "Holder.js"),
      "utf8",
    );
    const expected: ts.TranspileOutput = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: COMPILER_OPTIONS as ts.CompilerOptions,
      reportDiagnostics: true,
    });
    expect(javaScript).toBe(expected.outputText);
    expect(javaScript.endsWith("\n//# sourceMappingURL=Holder.js.map")).toBe(
      true,
    );
    // Decorator metadata as transpile-only emits it, for an imported type.
    expect(javaScript).toContain(
      '__metadata("design:type", typeof (_a = typeof Thing_1.default !== "undefined" && Thing_1.default) === "function" ? _a : Object)',
    );
    expect(javaScript).not.toContain("A comment the code leaves out");
    expect(javaScript).toContain("A licence comment that stays");

    const map: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(root, "Holder.js.map"), "utf8"),
    );
    const expectedMap: Record<string, unknown> = JSON.parse(
      expected.sourceMapText as string,
    );
    expect(map).toEqual({
      version: 3,
      file: "Holder.js",
      sources: ["Holder.ts"],
      names: expectedMap["names"],
      mappings: expectedMap["mappings"],
    });
    expect(map).not.toHaveProperty("sourcesContent");
    expect(result.javaScriptBytes).toBe(Buffer.byteLength(javaScript));
  });

  test("Foo.tsx becomes Foo.js", () => {
    const root: string = makeTree({
      "View.tsx":
        'import React from "react";\nexport default (): React.ReactElement => <div>hi</div>;\n',
    });

    Precompile.compileFiles(
      ts,
      [path.join(root, "View.tsx")],
      COMPILER_OPTIONS,
      Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
    );

    expect(fs.readFileSync(path.join(root, "View.js"), "utf8")).toContain(
      '.createElement("div", null, "hi")',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "View.js.map"), "utf8"))
        .sources,
    ).toEqual(["View.tsx"]);
  });

  test("refuses to write where a .js or its map already is, and compiles the rest", () => {
    const root: string = makeTree({
      "Mine.ts": "export default 1;\n",
      "Mine.js": "module.exports = 'somebody else';\n",
      "Mapped.ts": "export default 2;\n",
      "Mapped.js.map": "{}",
      "Free.ts": "export default 3;\n",
    });

    const result: PrecompileModule.CompileResult = Precompile.compileFiles(
      ts,
      ["Mine.ts", "Mapped.ts", "Free.ts"].map((name: string): string => {
        return path.join(root, name);
      }),
      COMPILER_OPTIONS,
      Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
    );

    expect(result.failures).toEqual([
      `${path.join(root, "Mine.js")} is already there, and not this compile's: ${path.join(root, "Mine.ts")} is not compiled over it`,
      `${path.join(root, "Mapped.js.map")} is already there, and not this compile's: ${path.join(root, "Mapped.ts")} is not compiled over it`,
    ]);
    expect(fs.readFileSync(path.join(root, "Mine.js"), "utf8")).toBe(
      "module.exports = 'somebody else';\n",
    );
    expect(fs.existsSync(path.join(root, "Free.js"))).toBe(true);
  });

  test("reports a file it cannot compile, and writes nothing for it", () => {
    const root: string = makeTree({ "Broken.ts": "export const = ;\n" });

    const result: PrecompileModule.CompileResult = Precompile.compileFiles(
      ts,
      [path.join(root, "Broken.ts")],
      COMPILER_OPTIONS,
      Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain(path.join(root, "Broken.ts"));
    expect(fs.existsSync(path.join(root, "Broken.js"))).toBe(false);
  });

  test("its worker threads write what one thread writes", async () => {
    const files: Record<string, string> = {};
    for (let index: number = 0; index < 12; index++) {
      files[`Module${index}.ts`] =
        `export const value${index}: number = ${index};\n`;
    }
    const single: string = makeTree(files);
    const threaded: string = makeTree(files);
    const list: (root: string) => Array<string> = (
      root: string,
    ): Array<string> => {
      return Object.keys(files).map((name: string): string => {
        return path.join(root, name);
      });
    };

    Precompile.compileFiles(
      ts,
      list(single),
      COMPILER_OPTIONS,
      Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
    );
    const result: PrecompileModule.CompileResult =
      await Precompile.compileInWorkers(
        list(threaded),
        {
          compilerPath: require.resolve("typescript"),
          compilerOptions: COMPILER_OPTIONS,
          ignoredDiagnostics: Precompile.DIAGNOSTICS_TS_NODE_IGNORES,
        },
        3,
      );

    expect(result.failures).toEqual([]);
    for (const name of Object.keys(files)) {
      const javaScript: string = name.replace(/\.ts$/, ".js");
      for (const output of [javaScript, `${javaScript}.map`]) {
        expect(fs.readFileSync(path.join(threaded, output), "utf8")).toBe(
          fs.readFileSync(path.join(single, output), "utf8"),
        );
      }
    }
  });
});

describe("where it runs", () => {
  test("finds the git checkout a folder is in, a .git file or folder above it", () => {
    const checkout: string = makeTree({ ".git": "gitdir: elsewhere\n" });
    fs.mkdirSync(path.join(checkout, "packages", "App"), { recursive: true });
    const copy: string = makeTree({ "packages/App/Index.ts": "" });

    expect(
      Precompile.gitCheckoutOf(path.join(checkout, "packages", "App")),
    ).toBe(checkout);
    expect(Precompile.gitCheckoutOf(path.join(copy, "packages", "App"))).toBe(
      null,
    );
  });

  test("refuses to compile in a git checkout, where ts-node would load the stale JavaScript in place of the TypeScript being edited", async () => {
    const checkout: string = makeTree({
      ".git": "gitdir: elsewhere\n",
      "packages/App/Index.ts": "export default 1;\n",
    });

    await expect(
      Precompile.precompile({
        project: path.join(checkout, "packages", "App", "tsconfig.json"),
        roots: [path.join(checkout, "packages", "App")],
        jobs: 1,
      }),
    ).rejects.toThrow(/is in a git checkout/);
    expect(
      fs.existsSync(path.join(checkout, "packages", "App", "Index.js")),
    ).toBe(false);
  });

  test("its command line asks for a project and a root", () => {
    const run: (args: Array<string>) => SpawnSyncReturns<string> = (
      args: Array<string>,
    ): SpawnSyncReturns<string> => {
      return spawnSync(process.execPath, [PRECOMPILE, ...args], {
        encoding: "utf8",
      });
    };

    expect(run([]).status).toBe(2);
    expect(run([]).stderr).toContain("--project <tsconfig.json> is required");
    expect(run(["--project", "tsconfig.json"]).stderr).toContain(
      "At least one --root <directory> is required",
    );
    expect(
      run(["--project", "tsconfig.json", "--root", ".", "--jobs", "0"]).stderr,
    ).toContain("--jobs needs a whole number of at least 1");
    expect(run(["--project", "a", "--root", "b", "--other"]).stderr).toContain(
      "Unknown argument: --other",
    );

    expect(
      Precompile.parseArguments([
        "--project",
        "/usr/src/app/tsconfig.json",
        "--root",
        "/usr/src/app",
        "--root",
        "/usr/src/Common",
        "--jobs",
        "2",
      ]),
    ).toEqual({
      project: "/usr/src/app/tsconfig.json",
      roots: ["/usr/src/app", "/usr/src/Common"],
      jobs: 2,
    });
  });

  test("needs nothing but Node and its siblings: it runs before anything is compiled", () => {
    const required: Array<string> = [];
    for (const match of fs
      .readFileSync(PRECOMPILE, "utf8")
      .matchAll(/require\(\s*"([^"]+)"\s*,?\s*\)/gu)) {
      required.push(match[1] as string);
    }

    expect(required.sort()).toEqual([
      "./Transpiler.js",
      "buffer",
      "fs",
      "os",
      "path",
      "worker_threads",
    ]);
  });
});
