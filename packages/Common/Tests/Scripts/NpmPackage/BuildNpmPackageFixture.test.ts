import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  BuildReport,
  RootExport,
} from "../../../Scripts/NpmPackage/BuildNpmPackage";

/*
 * Whole builds of a stand-in Common - a few modules under Types/, Utils/
 * and Models/, a server and a UI module, a package Common depends on and
 * one it does not - each run as the release runs the build: a Node.js
 * process of its own, which compiles with TypeScript, writes the package
 * and loads its modules. Then the package is used, from CommonJS, from an
 * ES module and from TypeScript in each module mode, the way a project that
 * installed it does (linked into its node_modules).
 *
 * The smoke test (npm run smoke-test-npm-package, which CI runs on every
 * Node.js line the package supports) does the same with the real Common,
 * installed from the tarball npm publishes.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const SCRIPT: string = path.join(
  COMMON_ROOT,
  "Scripts",
  "NpmPackage",
  "BuildNpmPackage.js",
);

const ROOT_EXPORTS: ReadonlyArray<RootExport> = [
  { name: "ObjectID", module: "Types/ObjectID" },
  { name: "URL", module: "Types/API/URL" },
  { name: "ObjectType", module: "Types/JSON", export: "ObjectType" },
  {
    name: "JSONObject",
    module: "Types/JSON",
    export: "JSONObject",
    typeOnly: true,
  },
  { name: "Dictionary", module: "Types/Dictionary", typeOnly: true },
];

const LEFT_OUT: Record<string, string> = {
  "Utils/Analytics": "a browser library",
};

// A stand-in Common, file by file.
const STAND_IN: Record<string, string> = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "es2017",
      module: "es2022",
      moduleResolution: "node",
      strict: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      skipLibCheck: true,
      types: [],
      outDir: "./build/dist",
    },
  }),
  "package.json": JSON.stringify({
    name: "@oneuptime/common",
    version: "9.9.9",
    repository: {
      type: "git",
      url: "https://github.com/OneUptime/oneuptime",
    },
    author: "OneUptime <hello@oneuptime.com> (https://oneuptime.com/)",
    license: "Apache-2.0",
    main: "index.js",
    dependencies: {
      "fake-dependency": "^1.2.3",
      "unused-dependency": "^4.0.0",
    },
    devDependencies: { "dev-only": "^1.0.0" },
  }),
  "README.md": "# The stand-in's README\n",
  "LICENSE.txt": "The stand-in's licence\n",
  "node_modules/fake-dependency/package.json": JSON.stringify({
    name: "fake-dependency",
    version: "1.2.3",
    main: "index.js",
    types: "index.d.ts",
  }),
  "node_modules/fake-dependency/index.js":
    "exports.double = function (n) { return n * 2; };\n",
  "node_modules/fake-dependency/index.d.ts":
    "export declare function double(n: number): number;\n",
  "node_modules/dev-only/package.json": JSON.stringify({
    name: "dev-only",
    version: "1.0.0",
    main: "index.js",
    types: "index.d.ts",
  }),
  "node_modules/dev-only/index.js":
    "exports.double = function (n) { return n * 2; };\n",
  "node_modules/dev-only/index.d.ts":
    "export declare function double(n: number): number;\n",
  // An ambient module, as Common's Typings/ declares the ones it lacks.
  "Typings/Index.d.ts":
    'declare module "react" {\n  export type FunctionComponent<P> = (props: P) => unknown;\n}\n',
  "Types/ObjectID.ts": [
    "export default class ObjectID {",
    "  public constructor(public readonly id: string) {}",
    "  public toString(): string {",
    "    return this.id;",
    "  }",
    "}",
    "",
  ].join("\n"),
  "Types/JSON.ts": [
    'import ObjectID from "./ObjectID";',
    'export enum ObjectType { ObjectID = "ObjectID" }',
    "export interface JSONObject { [key: string]: JSONValue }",
    "export type JSONValue = string | number | boolean | null | JSONObject | Array<JSONValue> | ObjectID;",
    "",
  ].join("\n"),
  "Types/Dictionary.ts":
    "export default interface Dictionary<T> { [key: string]: T }\n",
  "Types/API/URL.ts": [
    'import { double } from "fake-dependency";',
    "export default class URL {",
    "  public constructor(public readonly href: string) {}",
    "  public doubled(n: number): number {",
    "    return double(n);",
    "  }",
    "}",
    "",
  ].join("\n"),
  "Types/UsesServer.ts": [
    'import Logger from "../Server/Logger";',
    "export const log: (text: string) => string = (text: string): string => {",
    "  return Logger.prefix + text;",
    "};",
    "",
  ].join("\n"),
  "Types/UsesServerTypes.ts": [
    'import Thing from "../Server/Types/Thing";',
    "export default function describeThing(thing: Thing): string {",
    "  return thing.name;",
    "}",
    "",
  ].join("\n"),
  "Types/UsesUiTypes.ts": [
    'import { DropdownOption } from "../UI/Dropdown";',
    'export const option: DropdownOption = { value: "a", label: "A" };',
    "",
  ].join("\n"),
  "Types/UsesDevDependency.ts": [
    'import { double } from "dev-only";',
    "export const four: number = double(2);",
    "",
  ].join("\n"),
  "Utils/Analytics.ts":
    'export const track: () => string = (): string => {\n  return "tracked";\n};\n',
  "Utils/Tracker.ts":
    'import { track } from "./Analytics";\nexport default track;\n',
  "Utils/Everything.ts":
    'export * from "../Types/JSON";\nexport { default as ObjectID } from "../Types/ObjectID";\n',
  "Utils/Reserved.ts":
    'const remove: () => string = (): string => {\n  return "removed";\n};\nexport { remove as delete };\n',
  "Models/Incident.ts":
    'export default class Incident {\n  public title: string = "";\n  public tableName: string = "Incident";\n}\n',
  "Models/Index.ts":
    'import Incident from "./Incident";\nexport default [Incident];\n',
  "ServiceRoute.ts": 'export const AppApiRoute: string = "/api";\n',
  "Server/Logger.ts":
    'export default class Logger {\n  public static prefix: string = "server: ";\n}\n',
  "Server/Types/Thing.ts":
    "export default interface Thing {\n  name: string;\n}\n",
  "UI/Dropdown.ts": [
    'import { FunctionComponent } from "react";',
    "export interface DropdownOption { value: string; label: string }",
    "export interface Props { options: Array<DropdownOption> }",
    "export const Dropdown: FunctionComponent<Props> = (): unknown => {",
    "  return null;",
    "};",
    "export default Dropdown;",
    "",
  ].join("\n"),
};

interface BuildRun {
  report?: BuildReport;
  error?: string;
}

let scratch: string = "";

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-npm-fixture-"));
});

afterAll(() => {
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const file: string = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// Every file under `directory`, relative and with forward slashes.
function filesIn(directory: string): Array<string> {
  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(
          path.relative(directory, absolute).split(path.sep).join("/"),
        );
      }
    }
  };

  walk(directory);

  return files.sort();
}

/*
 * A stand-in Common, with `extra` files on top, built in a Node.js process
 * of its own, as `npm run build-npm-package` builds the real one.
 */
function buildStandIn(
  name: string,
  extra: Record<string, string>,
  options: { rootExports?: ReadonlyArray<RootExport>; buildDirectory?: string },
): { sourceRoot: string; run: BuildRun } {
  const sourceRoot: string = path.join(scratch, name);
  writeFiles(sourceRoot, { ...STAND_IN, ...extra });

  const settings: string = path.join(scratch, `${name}.options.json`);
  const output: string = path.join(scratch, `${name}.report.json`);
  const runner: string = path.join(scratch, `${name}.build.js`);

  fs.writeFileSync(
    settings,
    JSON.stringify({
      sourceRoot,
      buildDirectory:
        options.buildDirectory || path.join(sourceRoot, "build", "npm"),
      leftOut: LEFT_OUT,
      rootExports: options.rootExports || ROOT_EXPORTS,
      licenseFile: path.join(sourceRoot, "LICENSE.txt"),
      readmeFile: path.join(sourceRoot, "README.md"),
    }),
  );
  fs.writeFileSync(
    runner,
    [
      'const fs = require("fs");',
      `const Build = require(${JSON.stringify(SCRIPT)});`,
      'const options = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
      "let result;",
      "try {",
      "  result = { report: Build.buildNpmPackage(options) };",
      "} catch (error) {",
      "  result = { error: String(error.message) };",
      "}",
      "fs.writeFileSync(process.argv[3], JSON.stringify(result));",
      "",
    ].join("\n"),
  );

  const built: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [runner, settings, output],
    { cwd: sourceRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (built.status !== 0 || !fs.existsSync(output)) {
    throw new Error(`The build did not run:\n${built.stdout}${built.stderr}`);
  }

  return {
    sourceRoot,
    run: JSON.parse(fs.readFileSync(output, "utf8")) as BuildRun,
  };
}

// Runs a script with Node.js in `cwd`; it prints one JSON line.
function runScript(
  cwd: string,
  file: string,
  text: string,
): Record<string, unknown> {
  const script: string = path.join(cwd, file);
  fs.writeFileSync(script, text);

  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [script],
    { cwd, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`${file} failed:\n${result.stderr}`);
  }

  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

describe("a build of a stand-in Common", () => {
  let sourceRoot: string = "";
  let report: BuildReport;
  let packageDirectory: string = "";
  let project: string = "";

  beforeAll(() => {
    const built: { sourceRoot: string; run: BuildRun } = buildStandIn(
      "standin",
      {},
      {},
    );

    if (!built.run.report) {
      throw new Error(`The build failed: ${built.run.error}`);
    }

    sourceRoot = built.sourceRoot;
    report = built.run.report;
    packageDirectory = report.packageDirectory;

    // A project with the package installed, as npm links one.
    project = path.join(scratch, "project");
    fs.mkdirSync(path.join(project, "node_modules", "@oneuptime"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "project", version: "1.0.0", private: true }),
    );
    fs.symlinkSync(
      packageDirectory,
      path.join(project, "node_modules", "@oneuptime", "common"),
      "dir",
    );
  });

  test("writes the package into build/npm/package", () => {
    expect(packageDirectory).toBe(
      path.join(sourceRoot, "build", "npm", "package"),
    );
  });

  test("publishes the modules whose JavaScript stays inside Types/, Utils/ and Models/, and ServiceRoute", () => {
    expect(report.published).toEqual([
      "Models/Incident",
      "Models/Index",
      "ServiceRoute",
      "Types/API/URL",
      "Types/Dictionary",
      "Types/JSON",
      "Types/ObjectID",
      "Types/UsesServerTypes",
      "Types/UsesUiTypes",
      "Utils/Everything",
      "Utils/Reserved",
    ]);
  });

  test("leaves out, with why, what loads server code, a module left out on purpose, or a package Common does not depend on", () => {
    expect(report.leftOut).toEqual([
      {
        module: "Types/UsesDevDependency",
        reason:
          "needs dev-only, which Common does not depend on (Types/UsesDevDependency)",
      },
      {
        module: "Types/UsesServer",
        reason:
          "loads Server/Logger when it runs (Types/UsesServer -> Server/Logger)",
      },
      { module: "Utils/Analytics", reason: "a browser library" },
      {
        module: "Utils/Tracker",
        reason:
          "loads Utils/Analytics, which is left out (Utils/Tracker -> Utils/Analytics)",
      },
    ]);
  });

  test("ships the server and UI declarations the published types refer to, for types only, and cuts the UI one down", () => {
    expect(report.typeOnlyDeclarations).toEqual([
      "Server/Types/Thing",
      "UI/Dropdown",
    ]);
    expect(report.prunedDeclarations).toEqual(["UI/Dropdown"]);
    // No declaration it ships names a package it does not install.
    expect(report.typeOnlyPackages).toEqual([]);

    const dropdown: string = fs.readFileSync(
      path.join(packageDirectory, "UI", "Dropdown.d.ts"),
      "utf8",
    );

    expect(dropdown).toContain("export interface DropdownOption {");
    expect(dropdown).not.toContain("react");
    expect(dropdown).not.toContain("Props");
  });

  test("holds each module four ways, the root, the manifest, the README and the licence, and nothing else", () => {
    const expected: Array<string> = [
      "LICENSE",
      "README.md",
      "package.json",
      "index.js",
      "index.mjs",
      "index.d.ts",
      "index.d.mts",
      "Server/Types/Thing.d.ts",
      "Server/Types/Thing.d.mts",
      "UI/Dropdown.d.ts",
      "UI/Dropdown.d.mts",
    ];

    for (const id of report.published) {
      expected.push(`${id}.js`, `${id}.mjs`, `${id}.d.ts`, `${id}.d.mts`);
    }

    expect(filesIn(packageDirectory)).toEqual(expected.sort());
    expect(
      fs.readFileSync(path.join(packageDirectory, "README.md"), "utf8"),
    ).toBe("# The stand-in's README\n");
    expect(
      fs.readFileSync(path.join(packageDirectory, "LICENSE"), "utf8"),
    ).toBe("The stand-in's licence\n");
  });

  test("writes a manifest with the exports map, the files and the dependencies the JavaScript needs", () => {
    const written: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(written).toEqual(report.manifest);
    expect(report.manifest.name).toBe("@oneuptime/common");
    expect(report.manifest.version).toBe("9.9.9");
    expect(report.manifest.main).toBe("./index.js");
    expect(report.manifest.types).toBe("./index.d.ts");
    // What the JavaScript requires, never what nothing published needs.
    expect(report.manifest.dependencies).toEqual({
      "fake-dependency": "^1.2.3",
    });
    expect(Object.keys(report.manifest.exports)).toEqual([
      ".",
      "./ServiceRoute",
      "./Types/*",
      "./Utils/*",
      "./Models/*",
      "./Types/UsesDevDependency",
      "./Types/UsesServer",
      "./Utils/Analytics",
      "./Utils/Tracker",
      "./package.json",
    ]);
    expect(report.manifest.files).toEqual([
      "index.js",
      "index.mjs",
      "index.d.ts",
      "index.d.mts",
      "ServiceRoute.js",
      "ServiceRoute.mjs",
      "ServiceRoute.d.ts",
      "ServiceRoute.d.mts",
      "Models/",
      "Server/**/*.d.ts",
      "Server/**/*.d.mts",
      "Types/",
      "UI/**/*.d.ts",
      "UI/**/*.d.mts",
      "Utils/",
    ]);
    expect(written["scripts"]).toBeUndefined();
    expect(written["devDependencies"]).toBeUndefined();
  });

  test("leaves Common's own manifest alone", () => {
    expect(
      JSON.parse(
        fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
      ),
    ).toEqual(JSON.parse(STAND_IN["package.json"] as string));
  });

  test("require() loads the root and every published module, and a left-out or server module is not exported", () => {
    expect(
      runScript(
        project,
        "use.cjs",
        [
          '"use strict";',
          'const root = require("@oneuptime/common");',
          'const ObjectID = require("@oneuptime/common/Types/ObjectID").default;',
          'const URL = require("@oneuptime/common/Types/API/URL").default;',
          'const Incident = require("@oneuptime/common/Models/Incident").default;',
          'const models = require("@oneuptime/common/Models/Index").default;',
          'const reserved = require("@oneuptime/common/Utils/Reserved");',
          'const everything = require("@oneuptime/common/Utils/Everything");',
          'const { AppApiRoute } = require("@oneuptime/common/ServiceRoute");',
          "const code = (specifier) => {",
          "  try {",
          "    require(specifier);",
          '    return "loaded";',
          "  } catch (error) {",
          "    return error.code;",
          "  }",
          "};",
          "console.log(JSON.stringify({",
          "  root: Object.keys(root).sort(),",
          "  rootIsDeep: root.ObjectID === ObjectID && root.URL === URL,",
          '  id: String(new ObjectID("abc")),',
          '  doubled: new root.URL("https://oneuptime.com").doubled(21),',
          "  objectType: root.ObjectType.ObjectID,",
          "  models: models.length === 1 && models[0] === Incident,",
          "  tableName: new Incident().tableName,",
          "  reserved: reserved.delete(),",
          "  reExported: everything.ObjectID === ObjectID && everything.ObjectType === root.ObjectType,",
          "  route: AppApiRoute,",
          '  leftOut: code("@oneuptime/common/Types/UsesServer"),',
          '  onPurpose: code("@oneuptime/common/Utils/Analytics"),',
          '  server: code("@oneuptime/common/Server/Logger"),',
          '  ui: code("@oneuptime/common/UI/Dropdown"),',
          "}));",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      root: ["ObjectID", "ObjectType", "URL"],
      rootIsDeep: true,
      id: "abc",
      doubled: 42,
      objectType: "ObjectID",
      models: true,
      tableName: "Incident",
      reserved: "removed",
      reExported: true,
      route: "/api",
      leftOut: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      onPurpose: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      server: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      ui: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  test("import loads the same values require() does, so an instanceof holds either way", () => {
    expect(
      runScript(
        project,
        "use.mjs",
        [
          'import { createRequire } from "node:module";',
          'import * as root from "@oneuptime/common";',
          'import ObjectID from "@oneuptime/common/Types/ObjectID";',
          'import { ObjectType } from "@oneuptime/common/Types/JSON";',
          'import Incident from "@oneuptime/common/Models/Incident";',
          'import { delete as remove } from "@oneuptime/common/Utils/Reserved";',
          'import { ObjectID as ReExported } from "@oneuptime/common/Utils/Everything";',
          'import "@oneuptime/common/Types/Dictionary";',
          "const require = createRequire(import.meta.url);",
          'const RequiredObjectID = require("@oneuptime/common/Types/ObjectID").default;',
          "let leftOut;",
          "try {",
          '  await import("@oneuptime/common/Types/UsesServer");',
          '  leftOut = "loaded";',
          "} catch (error) {",
          "  leftOut = error.code;",
          "}",
          "console.log(JSON.stringify({",
          "  root: Object.keys(root).sort(),",
          "  sameClass: ObjectID === RequiredObjectID && root.ObjectID === ObjectID && ReExported === ObjectID,",
          '  instanceOf: new ObjectID("a") instanceof RequiredObjectID && new RequiredObjectID("b") instanceof ObjectID,',
          "  objectType: ObjectType.ObjectID,",
          "  tableName: new Incident().tableName,",
          "  reserved: remove(),",
          "  leftOut,",
          "}));",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      root: ["ObjectID", "ObjectType", "URL"],
      sameClass: true,
      instanceOf: true,
      objectType: "ObjectID",
      tableName: "Incident",
      reserved: "removed",
      leftOut: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  /*
   * With skipLibCheck off, so every declaration the package ships is
   * checked too - the Dropdown cut down without React among them - and with
   * no @types package at all.
   */
  const TYPED_USE: string = [
    'import { Dictionary, JSONObject, ObjectID, ObjectType, URL } from "@oneuptime/common";',
    'import Incident from "@oneuptime/common/Models/Incident";',
    'import describeThing from "@oneuptime/common/Types/UsesServerTypes";',
    'import { option } from "@oneuptime/common/Types/UsesUiTypes";',
    'import { AppApiRoute } from "@oneuptime/common/ServiceRoute";',
    "// @ts-expect-error What is left out is not exported, to TypeScript either.",
    'import { log } from "@oneuptime/common/Types/UsesServer";',
    "",
    'const id: ObjectID = new ObjectID("abc");',
    'const doubled: number = new URL("https://oneuptime.com").doubled(2);',
    "const json: JSONObject = { type: ObjectType.ObjectID };",
    'const headers: Dictionary<string> = { APIKey: "key" };',
    "// @ts-expect-error A Dictionary<string> holds strings: the types are real, not any.",
    "const notStrings: Dictionary<string> = { APIKey: 1 };",
    "const incident: Incident = new Incident();",
    'const described: string = describeThing({ name: "thing" });',
    "// @ts-expect-error A server type's declaration is shipped, so it is checked.",
    'describeThing({ title: "thing" });',
    "const label: string = option.label;",
    "const route: string = AppApiRoute;",
    "export const used: Array<unknown> = [id, doubled, json, headers, notStrings, incident, described, label, route, log];",
    "",
  ].join("\n");

  const MODES: Array<{
    name: string;
    extension: string;
    options: ts.CompilerOptions;
  }> = [
    {
      name: "nodenext, CommonJS",
      extension: ".cts",
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    },
    {
      name: "nodenext, ES module",
      extension: ".mts",
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    },
    {
      name: "bundler",
      extension: ".ts",
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
    },
    {
      name: "node10, CommonJS",
      extension: ".ts",
      options: {
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
      },
    },
  ];

  test.each(MODES)(
    "TypeScript ($name) resolves the types and checks a typed use, skipLibCheck off",
    ({
      name,
      extension,
      options,
    }: {
      name: string;
      extension: string;
      options: ts.CompilerOptions;
    }) => {
      const directory: string = path.join(
        project,
        `types-${name.replace(", ", "-").replace(" ", "-")}`,
      );
      const file: string = path.join(directory, `use${extension}`);

      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(file, TYPED_USE);

      const program: ts.Program = ts.createProgram({
        rootNames: [file],
        options: {
          ...options,
          target: ts.ScriptTarget.ES2022,
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
      });
      const diagnostics: Array<string> = ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic: ts.Diagnostic): string => {
          return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        });

      expect(diagnostics).toEqual([]);
    },
  );
});

describe("a build that cannot publish what it would write", () => {
  test("fails when a root export's module is left out, saying why", () => {
    const { run }: { run: BuildRun } = buildStandIn(
      "root-left-out",
      {},
      {
        rootExports: [
          ...ROOT_EXPORTS,
          { name: "log", module: "Types/UsesServer", export: "log" },
        ],
      },
    );

    expect(run.report).toBeUndefined();
    expect(run.error).toBe(
      "The package root exports log from Types/UsesServer, which cannot be published: loads Server/Logger when it runs (Types/UsesServer -> Server/Logger)",
    );
  });

  test("fails when a root export names what its module does not export, when it runs or in its types", () => {
    const missing: { run: BuildRun } = buildStandIn(
      "root-missing",
      {},
      {
        rootExports: [
          ...ROOT_EXPORTS,
          { name: "Missing", module: "Types/ObjectID", export: "Missing" },
        ],
      },
    );

    expect(missing.run.error).toBe(
      "The package root exports Missing as Types/ObjectID's Missing, which Types/ObjectID does not export",
    );

    const missingType: { run: BuildRun } = buildStandIn(
      "root-missing-type",
      {},
      {
        rootExports: [
          ...ROOT_EXPORTS,
          {
            name: "Nope",
            module: "Types/Dictionary",
            export: "Nope",
            typeOnly: true,
          },
        ],
      },
    );

    expect(missingType.run.error).toBe(
      "The package root exports Nope as Types/Dictionary's Nope, which Types/Dictionary does not export in its types",
    );
  });

  test("fails when a published module throws as Node.js loads it", () => {
    const { run }: { run: BuildRun } = buildStandIn(
      "throws",
      {
        "Types/Throws.ts":
          'export const value: number = 1;\nthrow new Error("Needs an environment");\n',
      },
      {},
    );

    expect(run.report).toBeUndefined();
    expect(run.error).toBe(
      "These modules throw when Node.js loads them from the package:\n  Types/Throws: Needs an environment",
    );
  });

  test("fails, with the diagnostics, when the TypeScript does not compile", () => {
    const { run }: { run: BuildRun } = buildStandIn(
      "type-error",
      { "Types/Broken.ts": 'export const count: number = "not a number";\n' },
      {},
    );

    expect(run.report).toBeUndefined();
    expect(run.error).toContain(
      "TypeScript could not compile what the package holds:",
    );
    expect(run.error).toContain("Types/Broken.ts");
    expect(run.error).toContain(
      "Type 'string' is not assignable to type 'number'.",
    );
  });

  test("refuses to build into a directory it does not own, since it deletes it first", () => {
    const elsewhere: string = path.join(COMMON_ROOT, "Scripts");
    const { run }: { run: BuildRun } = buildStandIn(
      "elsewhere",
      {},
      { buildDirectory: elsewhere },
    );

    expect(run.report).toBeUndefined();
    expect(run.error).toContain(`Refusing to build into ${elsewhere}`);
    // Nothing was deleted.
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });
});
