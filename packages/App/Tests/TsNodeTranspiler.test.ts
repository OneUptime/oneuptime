import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { seededRandom, shuffled } from "Common/Tests/Helpers/SeededRandom";

/*
 * The App runs its TypeScript through ts-node with Common's transpiler
 * (App/tsconfig.json "ts-node"; Common/Server/Utils/TsNode/Transpiler.js).
 * Outside development it compiles each module as ts-node does, without
 * comments, and keeps the module's source map outside its code: V8 keeps
 * every script's text for the life of the process, and ts-node's inline
 * maps, with each module's TypeScript inside, were ~470 MB of an idle App's
 * 1.4 GB heap.
 *
 * These run the real ts-node with the App's tsconfig, as the image boots
 * (node --require ts-node/register), in production and in development (where
 * ts-node compiles as it always has), and hold the production run to:
 * - stack traces that name the same TypeScript files, lines and columns;
 * - the same programs: every sampled module of the App and Common parses to
 *   the same syntax tree, token for token, comments aside;
 * - code a fraction of the size, with no TypeScript source in it.
 */

const APP_ROOT: string = path.resolve(__dirname, "..");
const COMMON_ROOT: string = path.resolve(APP_ROOT, "..", "Common");
const FIXTURE_DIR: string = path.join(APP_ROOT, ".ts-node-transpiler-fixture");
const FIXTURE: string = path.join(FIXTURE_DIR, "Thrower.ts");
const PORT_MODULE: string = path.join(COMMON_ROOT, "Types", "Port.ts");
/*
 * The sample's file list and its compiled output (tens of megabytes) go
 * outside the App: only the fixture needs the App's tsconfig.
 */
let workDirectory: string = "";

const FIXTURE_SOURCE: string = [
  "/*!",
  " * A licence comment, which stays.",
  " */",
  "// A comment past Latin-1 \u{2014} which goes.",
  "function Logged(): MethodDecorator {",
  "  return (): void => {};",
  "}",
  "",
  "export class Thrower {",
  "  /*",
  "   * A comment that moves the code below it down.",
  "   */",
  "  @Logged()",
  "  public throwHere(): never {",
  '    throw new Error("thrown from Thrower.ts");',
  "  }",
  "}",
  "",
].join("\n");

// Where a throw's frame points: the line, and the column of `new`.
function throwPosition(source: string, marker: string): string {
  const lines: Array<string> = source.split("\n");
  const index: number = lines.findIndex((line: string): boolean => {
    return line.includes(marker);
  });
  expect(index).toBeGreaterThanOrEqual(0);
  const column: number = (lines[index] as string).indexOf("new ") + 1;
  return `${index + 1}:${column}`;
}

interface RunReport {
  fixtureStack: string;
  portStack: string;
  fixtureCode: string;
  codeBytes: number;
  modules: number;
}

/*
 * Node with ts-node registered the way the image starts it, from the App's
 * directory (its tsconfig), records the code each .ts module is compiled to,
 * requires the fixture and real modules, and reports.
 */
function runApp(nodeEnv: string): RunReport {
  const script: string = [
    'const Module = require("module");',
    "const compiled = {};",
    "const compile = Module.prototype._compile;",
    "Module.prototype._compile = function (content, filename) {",
    "  compiled[filename] = content;",
    "  return compile.call(this, content, filename);",
    "};",
    `const { Thrower } = require(${JSON.stringify(FIXTURE)});`,
    "let fixtureStack = '';",
    "try { new Thrower().throwHere(); } catch (error) { fixtureStack = error.stack; }",
    `const Port = require(${JSON.stringify(PORT_MODULE)}).default;`,
    "let portStack = '';",
    "try { new Port(70000); } catch (error) { portStack = error.stack; }",
    // Real modules of every size: the permission catalogue, workflow templates, the API's response helpers.
    `require(${JSON.stringify(path.join(COMMON_ROOT, "Types", "Permission.ts"))});`,
    `require(${JSON.stringify(path.join(COMMON_ROOT, "Types", "Workflow", "Templates.ts"))});`,
    `require(${JSON.stringify(path.join(COMMON_ROOT, "Server", "Utils", "Response.ts"))});`,
    "let codeBytes = 0;",
    "let modules = 0;",
    "for (const [file, content] of Object.entries(compiled)) {",
    "  if (file.endsWith('.ts')) { codeBytes += content.length; modules++; }",
    "}",
    "console.log(JSON.stringify({ fixtureStack, portStack, fixtureCode: compiled[" +
      JSON.stringify(FIXTURE) +
      "], codeBytes, modules }));",
  ].join("\n");

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--require", "ts-node/register", "-e", script],
    {
      cwd: APP_ROOT,
      env: { ...process.env, NODE_ENV: nodeEnv, TS_NODE_TRANSPILE_ONLY: "1" },
      encoding: "utf8",
      timeout: 240000,
    },
  );

  const line: string | undefined = (result.stdout || "")
    .split("\n")
    .filter((each: string): boolean => {
      return each.startsWith("{");
    })
    .pop();

  if (!line) {
    throw new Error(
      `The App's ts-node printed nothing (exit ${String(result.status)}):\n${result.stderr}`,
    );
  }

  return JSON.parse(line) as RunReport;
}

// The TypeScript frames of a stack: "file:line:column", in order.
function typeScriptFrames(stack: string): Array<string> {
  const frames: Array<string> = [];
  for (const line of stack.split("\n")) {
    const at: number = line.indexOf(".ts:");
    if (!line.trim().startsWith("at ") || at < 0) {
      continue;
    }
    const start: number = Math.max(
      line.lastIndexOf("(", at) + 1,
      line.lastIndexOf(" ", at) + 1,
    );
    const end: number = line.indexOf(")", at);
    frames.push(line.slice(start, end < 0 ? undefined : end));
  }
  return frames;
}

let production: RunReport;
let development: RunReport;

beforeAll(() => {
  workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ts-node-transpiler-"));
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(FIXTURE, FIXTURE_SOURCE);
  production = runApp("production");
  development = runApp("development");
}, 600000);

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  if (workDirectory) {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});

describe("the App's ts-node in production", () => {
  test("names the same TypeScript lines and columns in a stack trace as ts-node's own compile", () => {
    const thrown: string = `Thrower.ts:${throwPosition(FIXTURE_SOURCE, "throw new Error")}`;

    expect(typeScriptFrames(production.fixtureStack)[0]).toBe(
      `${FIXTURE}:${throwPosition(FIXTURE_SOURCE, "throw new Error")}`,
    );
    expect(production.fixtureStack).toContain(thrown);
    expect(typeScriptFrames(production.fixtureStack)).toEqual(
      typeScriptFrames(development.fixtureStack),
    );
  });

  test("and so for an error a real Common module throws", () => {
    const portSource: string = fs.readFileSync(PORT_MODULE, "utf8");
    const position: string = throwPosition(
      portSource,
      'throw new BadDataException("Port is not in valid format.")',
    );

    expect(typeScriptFrames(production.portStack)).toContain(
      `${PORT_MODULE}:${position}`,
    );
    expect(typeScriptFrames(production.portStack)).toEqual(
      typeScriptFrames(development.portStack),
    );
  });

  test("hands V8 code without comments or the module's TypeScript, its inline map empty", () => {
    const code: string = production.fixtureCode;
    const map: string = code.slice(code.lastIndexOf("base64,") + 7);

    expect(code).toContain("A licence comment, which stays.");
    expect(code).not.toContain("which goes.");
    expect(code).not.toContain("moves the code below it down");
    expect(map.length).toBeLessThan(400);
    expect(
      JSON.parse(Buffer.from(map, "base64").toString("utf8")) as unknown,
    ).toMatchObject({ mappings: "", names: [] });
    expect(code).not.toContain("sourcesContent");

    // Development is ts-node's own: the whole module inline, comments and all.
    expect(development.fixtureCode).toContain("which goes.");
    const developmentMap: string = development.fixtureCode.slice(
      development.fixtureCode.lastIndexOf("base64,") + 7,
    );
    expect(Buffer.from(developmentMap, "base64").toString("utf8")).toContain(
      "sourcesContent",
    );
  });

  test("hands V8 a fraction of the code ts-node's own compile did, for the same modules", () => {
    expect(production.modules).toBe(development.modules);
    expect(production.modules).toBeGreaterThan(50);
    // The App's 5,535 modules: 468 MB of script text and map URLs, 77 MB now.
    expect(production.codeBytes).toBeLessThan(development.codeBytes * 0.5);
  });
});

describe("the programs it compiles", () => {
  /*
   * Every module of a seeded sample of the App's and Common's server code,
   * plus the largest, compiled by the App's ts-node service in production
   * and in development: parsed, the two outputs are the same syntax tree,
   * node for node and token for token (comments are no part of it).
   */
  function serverFiles(): Array<string> {
    const files: Array<string> = [];
    const skipped: Array<string> = [
      `${path.sep}node_modules${path.sep}`,
      `${path.sep}Tests${path.sep}`,
      `${path.sep}build${path.sep}`,
      `${path.sep}FeatureSet${path.sep}Dashboard${path.sep}`,
      `${path.sep}FeatureSet${path.sep}AdminDashboard${path.sep}`,
      `${path.sep}FeatureSet${path.sep}StatusPage${path.sep}`,
      `${path.sep}FeatureSet${path.sep}Accounts${path.sep}`,
      `${path.sep}FeatureSet${path.sep}PublicDashboard${path.sep}`,
      `${path.sep}FeatureSet${path.sep}BrowserRecorder${path.sep}`,
      `${path.sep}FeatureSet${path.sep}MobileRecorder${path.sep}`,
      `${path.sep}FeatureSet${path.sep}Docs${path.sep}Content${path.sep}`,
      `${path.sep}UI${path.sep}`,
    ];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);
        if (
          skipped.some((part: string): boolean => {
            return `${full}${path.sep}`.includes(part);
          })
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".d.ts")
        ) {
          files.push(full);
        }
      }
    };
    walk(path.join(APP_ROOT, "FeatureSet"));
    walk(path.join(COMMON_ROOT, "Server"));
    walk(path.join(COMMON_ROOT, "Types"));
    walk(path.join(COMMON_ROOT, "Models"));
    walk(path.join(COMMON_ROOT, "Utils"));
    return files.sort();
  }

  test("are the same, node for node, in production and in development", () => {
    const files: Array<string> = serverFiles();
    expect(files.length).toBeGreaterThan(2000);

    const bySize: Array<string> = [...files].sort((a: string, b: string) => {
      return fs.statSync(b).size - fs.statSync(a).size;
    });
    const sample: Array<string> = [
      ...new Set([
        ...bySize.slice(0, 20),
        ...shuffled(files, seededRandom(5361)).slice(0, 220),
      ]),
    ];
    const listFile: string = path.join(workDirectory, "sample.json");
    const compiledFile: string = path.join(workDirectory, "compiled.json");
    fs.writeFileSync(listFile, JSON.stringify(sample));

    const script: string = [
      'const fs = require("fs");',
      'const tsNode = require("ts-node");',
      "const files = JSON.parse(fs.readFileSync(" +
        JSON.stringify(listFile) +
        ", 'utf8'));",
      "function service(nodeEnv) {",
      "  process.env.NODE_ENV = nodeEnv;",
      "  return tsNode.create({ transpileOnly: true, cwd: process.cwd() });",
      "}",
      "const production = service('production');",
      "const development = service('development');",
      "const out = [];",
      "for (const file of files) {",
      "  const text = fs.readFileSync(file, 'utf8');",
      "  out.push([file, production.compile(text, file), development.compile(text, file)]);",
      "}",
      "fs.writeFileSync(" +
        JSON.stringify(compiledFile) +
        ", JSON.stringify(out));",
      "console.log(JSON.stringify({ compiled: out.length }));",
    ].join("\n");

    const result: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      ["-e", script],
      { cwd: APP_ROOT, encoding: "utf8", timeout: 300000 },
    );
    if (result.status !== 0) {
      throw new Error(
        `Compiling the sample failed (exit ${String(result.status)}):\n${result.stderr}`,
      );
    }

    const compiled: Array<[string, string, string]> = JSON.parse(
      fs.readFileSync(compiledFile, "utf8"),
    ) as Array<[string, string, string]>;
    expect(compiled).toHaveLength(sample.length);

    const shape: (text: string) => Array<string> = (
      text: string,
    ): Array<string> => {
      // Comments are no part of the tree: JSDoc is not parsed into it.
      const source: ts.SourceFile = ts.createSourceFile(
        "module.js",
        text,
        {
          languageVersion: ts.ScriptTarget.Latest,
          jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
        },
        true,
        ts.ScriptKind.JS,
      );
      const nodes: Array<string> = [];
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        const children: Array<ts.Node> = node
          .getChildren(source)
          .filter((child: ts.Node): boolean => {
            return (
              child.kind < ts.SyntaxKind.FirstJSDocNode ||
              child.kind > ts.SyntaxKind.LastJSDocNode
            );
          });
        nodes.push(
          children.length === 0
            ? `${node.kind}:${node.getText(source)}`
            : String(node.kind),
        );
        for (const child of children) {
          visit(child);
        }
      };
      visit(source);
      return nodes;
    };

    const different: Array<string> = [];
    let productionBytes: number = 0;
    let developmentBytes: number = 0;
    for (const [file, ours, tsNodes] of compiled) {
      productionBytes += ours.length;
      developmentBytes += tsNodes.length;
      const a: Array<string> = shape(ours);
      const b: Array<string> = shape(tsNodes);
      if (
        a.length !== b.length ||
        a.some((node: string, index: number) => {
          return node !== b[index];
        })
      ) {
        different.push(path.relative(APP_ROOT, file));
      }
    }

    expect(different).toEqual([]);
    expect(productionBytes).toBeLessThan(developmentBytes * 0.5);
  }, 600000);
});
