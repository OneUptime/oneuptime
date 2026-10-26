import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  ExportConditions,
  ExportsMap,
  ModuleReferences,
  ModuleSelection,
  NODE_ENGINE,
  PackageManifest,
  RootExport,
  declarationSpecifiers,
  declaredExports,
  esModuleDeclaration,
  esModulePackageSpecifiers,
  esModuleWrapper,
  exportsMap,
  isBuiltinModule,
  isCandidateModule,
  moduleIdOf,
  namesUsedFrom,
  packageManifest,
  packageNameOf,
  pruneDeclaration,
  relativeSpecifier,
  requiredSpecifiers,
  resolveRelativeModule,
  rootEntryFiles,
  selectDeclarations,
  selectDependencies,
  selectModules,
  verifyPackage,
} from "../../../Scripts/NpmPackage/BuildNpmPackage";

/*
 * Scripts/NpmPackage/BuildNpmPackage.js builds what npm publishes as
 * @oneuptime/common (Scripts/NPM/PublishAllPackages.sh publishes
 * build/npm/package). Until it did, the package npm had could not be loaded
 * at all: its main, index.js, did not exist, its paths held TypeScript, and
 * its JavaScript was ES modules Node.js cannot resolve.
 *
 * These hold the build's parts, one by one: how it reads what tsc wrote,
 * decides which modules npm users get, writes each module's ES module twin
 * and its types for import, cuts a types-only declaration down, writes the
 * package root and the manifest, and checks the package it wrote.
 * BuildNpmPackageFixture.test.ts runs whole builds of a stand-in Common;
 * the smoke test (npm run smoke-test-npm-package, in CI) installs the real
 * package and uses it.
 */

// A module graph to decide on: module id -> what its JavaScript requires.
function graph(
  edges: Record<string, Partial<ModuleReferences>>,
): (id: string) => ModuleReferences {
  return (id: string): ModuleReferences => {
    const found: Partial<ModuleReferences> = edges[id] || {};

    return {
      modules: found.modules || [],
      packages: found.packages || [],
      unresolved: found.unresolved || [],
    };
  };
}

function exists(ids: Array<string>): (id: string) => boolean {
  const set: Set<string> = new Set(ids);

  return (id: string): boolean => {
    return set.has(id);
  };
}

// Runs a program in a Node.js process of its own: ES modules, for real.
function runNode(
  file: string,
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [file],
    { cwd, encoding: "utf8" },
  );

  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

let scratch: string = "";

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-npm-package-"));
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

describe("module ids and specifiers", () => {
  test("a module's id is its path from Common's root, without an extension", () => {
    expect(moduleIdOf("Types/API/URL.js")).toBe("Types/API/URL");
    expect(moduleIdOf("Types/API/URL.mjs")).toBe("Types/API/URL");
    expect(moduleIdOf("Types/API/URL.d.ts")).toBe("Types/API/URL");
    expect(moduleIdOf("Types/API/URL.d.mts")).toBe("Types/API/URL");
    expect(moduleIdOf("Types/API/URL.ts")).toBe("Types/API/URL");
    expect(moduleIdOf("UI/Components/Card/Card.tsx")).toBe(
      "UI/Components/Card/Card",
    );
    expect(moduleIdOf(["Types", "API", "URL.js"].join(path.sep))).toBe(
      "Types/API/URL",
    );
    // A dot inside a name is not an extension.
    expect(moduleIdOf("Types/Monitor/schema.v2.js")).toBe(
      "Types/Monitor/schema.v2",
    );
  });

  test("npm users may get the modules of Types/, Utils/ and Models/, and ServiceRoute", () => {
    for (const id of [
      "Types/ObjectID",
      "Types/API/URL",
      "Utils/API",
      "Models/DatabaseModels/Incident",
      "ServiceRoute",
    ]) {
      expect({ id, candidate: isCandidateModule(id) }).toEqual({
        id,
        candidate: true,
      });
    }

    for (const id of [
      "Server/Utils/Logger",
      "UI/Components/Dropdown/Dropdown",
      "Tests/Types/ObjectID",
      "Scripts/compile-tests",
      "Typings/Index",
      "TypesExtra/Thing",
      "Types",
      "index",
    ]) {
      expect({ id, candidate: isCandidateModule(id) }).toEqual({
        id,
        candidate: false,
      });
    }
  });

  test("tells Node.js's own modules from packages", () => {
    for (const specifier of [
      "fs",
      "fs/promises",
      "node:fs",
      "node:test",
      "crypto",
      "http",
      "path/posix",
    ]) {
      expect({ specifier, builtin: isBuiltinModule(specifier) }).toEqual({
        specifier,
        builtin: true,
      });
    }

    for (const specifier of ["typeorm", "zod", "@types/node", "fsevents"]) {
      expect({ specifier, builtin: isBuiltinModule(specifier) }).toEqual({
        specifier,
        builtin: false,
      });
    }
  });

  test("names the package a specifier comes from", () => {
    expect(packageNameOf("typeorm")).toBe("typeorm");
    expect(packageNameOf("typeorm/find-options/FindOperator")).toBe("typeorm");
    expect(packageNameOf("@asteasolutions/zod-to-openapi")).toBe(
      "@asteasolutions/zod-to-openapi",
    );
    expect(packageNameOf("@scope/name/sub/path")).toBe("@scope/name");
  });

  test("resolves a relative specifier to the module, or a directory's Index", () => {
    const ids: (id: string) => boolean = exists([
      "Types/API/URL",
      "Types/Email",
      "Types/Email/EmailMessage",
      "Types/Monitor/Index",
      "Types/Lower/index",
      "ServiceRoute",
    ]);

    expect(resolveRelativeModule("Types/API/Route", "./URL", ids)).toBe(
      "Types/API/URL",
    );
    expect(resolveRelativeModule("Types/API/Route", "./URL.js", ids)).toBe(
      "Types/API/URL",
    );
    expect(resolveRelativeModule("Types/ObjectID", "./Monitor", ids)).toBe(
      "Types/Monitor/Index",
    );
    expect(resolveRelativeModule("Types/ObjectID", "./Lower", ids)).toBe(
      "Types/Lower/index",
    );
    // A module beside the directory of the same name wins, as in Node.js.
    expect(
      resolveRelativeModule("Types/Email/EmailMessage", "../Email", ids),
    ).toBe("Types/Email");
    expect(
      resolveRelativeModule("Types/API/URL", "../../ServiceRoute", ids),
    ).toBe("ServiceRoute");
    expect(resolveRelativeModule("Types/API/URL", "./Missing", ids)).toBeNull();
    // Above Common's root is nothing the package has.
    expect(
      resolveRelativeModule("ServiceRoute", "../node_modules/x", ids),
    ).toBeNull();
  });

  test("writes a specifier for an ES module, relative to the file that has it", () => {
    expect(relativeSpecifier("Types/API/Route", "Types/API/URL", ".mjs")).toBe(
      "./URL.mjs",
    );
    expect(
      relativeSpecifier(
        "Types/API/Route",
        "Models/DatabaseModels/Incident",
        ".mjs",
      ),
    ).toBe("../../Models/DatabaseModels/Incident.mjs");
    expect(relativeSpecifier("ServiceRoute", "Types/API/Route", ".mjs")).toBe(
      "./Types/API/Route.mjs",
    );
    // Types/Email/X naming Types/Email: the file beside the directory.
    expect(
      relativeSpecifier("Types/Email/EmailMessage", "Types/Email", ".mjs"),
    ).toBe("../Email.mjs");
    expect(relativeSpecifier("Types/A", "Types/B/Index", "")).toBe("./B/Index");
  });
});

describe("reading what tsc wrote", () => {
  test("finds every require of a CommonJS file, and nothing that only looks like one", () => {
    const text: string = [
      '"use strict";',
      'const a_1 = __importDefault(require("./A"));',
      "const b = require('b-package');",
      '__exportStar(require("../C/Index"), exports);',
      'const lazy = () => Promise.resolve().then(() => __importStar(require("./D")));',
      'const dynamic = import("e-package");',
      '// require("commented-out")',
      'const text = "require(\\"in-a-string\\")";',
      'const template = `require("in-a-template")`;',
      "const name = 'f'; require(name);",
      'other.require("not-the-function");',
      'require("one", "two");',
    ].join("\n");

    expect(requiredSpecifiers(ts, "Types/X.js", text)).toEqual([
      "./A",
      "b-package",
      "../C/Index",
      "./D",
      "e-package",
    ]);
  });

  test("finds every module a declaration names, where its text sits", () => {
    const text: string = [
      '/// <reference path="./Ambient.d.ts" />',
      'import URL from "../API/URL";',
      'import type { Repository } from "typeorm";',
      'export * from "./Re";',
      'export { default as Other } from "./Other";',
      'import Old = require("./Old");',
      'declare module "./Augmented" {}',
      'export declare const inferred: import("./Inferred").default;',
      'export type NotAModule = "./LooksLikeOne";',
      "export {};",
    ].join("\n");
    const found: Array<{ text: string; start: number; end: number }> =
      declarationSpecifiers(ts, "Types/X.d.ts", text);

    expect(
      found.map((specifier: { text: string }) => {
        return specifier.text;
      }),
    ).toEqual([
      "./Ambient.d.ts",
      "../API/URL",
      "typeorm",
      "./Re",
      "./Other",
      "./Old",
      "./Augmented",
      "./Inferred",
    ]);

    // The positions bound each text inside its quotes.
    for (const specifier of found) {
      expect(text.slice(specifier.start, specifier.end)).toBe(specifier.text);
    }
  });

  test("reads the names a declaration file exports", () => {
    const text: string = [
      "export default class URL {}",
      "export interface JSONObject { [key: string]: unknown }",
      "export type JSONValue = string | number;",
      "export declare const LIMIT: number, OTHER: number;",
      'export declare enum ObjectType { ObjectID = "ObjectID" }',
      "export declare function helper(): void;",
      "declare const hidden: number;",
      "interface NotExported {}",
      "export { hidden as shown };",
      'export { fromElsewhere } from "./Elsewhere";',
    ].join("\n");

    expect([...declaredExports(ts, "Types/X.d.ts", text)].sort()).toEqual(
      [
        "default",
        "JSONObject",
        "JSONValue",
        "LIMIT",
        "OTHER",
        "ObjectType",
        "helper",
        "shown",
        "fromElsewhere",
      ].sort(),
    );
    expect([
      ...declaredExports(
        ts,
        "Types/Y.d.ts",
        "declare enum Protocol { HTTP = 1 }\nexport default Protocol;\n",
      ),
    ]).toEqual(["default"]);
  });
});

describe("which modules npm users get", () => {
  const dependencies: Record<string, string> = {
    typeorm: "^0.3.26",
    zod: "^3.25.76",
  };

  test("publishes a module whose JavaScript stays inside Types/, Utils/ and Models/", () => {
    const selection: ModuleSelection = selectModules({
      candidates: ["Types/B", "Types/A", "Models/Incident", "ServiceRoute"],
      requiresOf: graph({
        "Types/A": { modules: ["Types/B"], packages: ["typeorm"] },
        "Types/B": { modules: ["Types/A"] },
        "Models/Incident": { modules: ["Types/A"], packages: ["zod"] },
        ServiceRoute: { modules: ["Types/B"] },
      }),
      dependencies,
      leftOut: {},
    });

    // A cycle is fine, and the lists come sorted.
    expect(selection).toEqual({
      published: ["Models/Incident", "ServiceRoute", "Types/A", "Types/B"],
      leftOut: [],
    });
  });

  test("leaves out a module that loads Server/ or UI/ code, saying through which modules", () => {
    const selection: ModuleSelection = selectModules({
      candidates: ["Types/Direct", "Types/Far", "Types/Middle", "Utils/Ui"],
      requiresOf: graph({
        "Types/Direct": { modules: ["Server/Utils/Logger"] },
        "Types/Far": { modules: ["Types/Ok", "Types/Middle"] },
        "Types/Middle": { modules: ["Server/Utils/Logger"] },
        "Utils/Ui": { modules: ["UI/Utils/LocalStorage"] },
      }),
      dependencies,
      leftOut: {},
    });

    expect(selection.published).toEqual([]);
    expect(selection.leftOut).toEqual([
      {
        module: "Types/Direct",
        reason:
          "loads Server/Utils/Logger when it runs (Types/Direct -> Server/Utils/Logger)",
      },
      {
        module: "Types/Far",
        reason:
          "loads Server/Utils/Logger when it runs (Types/Far -> Types/Middle -> Server/Utils/Logger)",
      },
      {
        module: "Types/Middle",
        reason:
          "loads Server/Utils/Logger when it runs (Types/Middle -> Server/Utils/Logger)",
      },
      {
        module: "Utils/Ui",
        reason:
          "loads UI/Utils/LocalStorage when it runs (Utils/Ui -> UI/Utils/LocalStorage)",
      },
    ]);
  });

  test("names the shortest way a module reaches what leaves it out", () => {
    const selection: ModuleSelection = selectModules({
      candidates: ["Types/Start"],
      requiresOf: graph({
        "Types/Start": { modules: ["Types/Long1", "Types/Short"] },
        "Types/Long1": { modules: ["Types/Long2"] },
        "Types/Long2": { modules: ["UI/Thing"] },
        "Types/Short": { modules: ["UI/Thing"] },
      }),
      dependencies,
      leftOut: {},
    });

    expect(selection.leftOut[0]?.reason).toBe(
      "loads UI/Thing when it runs (Types/Start -> Types/Short -> UI/Thing)",
    );
  });

  test("leaves out what LEFT_OUT names, and every module that loads it", () => {
    const selection: ModuleSelection = selectModules({
      candidates: ["Utils/Analytics", "Utils/Tracks", "Types/Fine"],
      requiresOf: graph({
        "Utils/Analytics": { packages: ["zod"] },
        "Utils/Tracks": { modules: ["Utils/Analytics"] },
      }),
      dependencies,
      leftOut: { "Utils/Analytics": "a browser library" },
    });

    expect(selection).toEqual({
      published: ["Types/Fine"],
      leftOut: [
        { module: "Utils/Analytics", reason: "a browser library" },
        {
          module: "Utils/Tracks",
          reason:
            "loads Utils/Analytics, which is left out (Utils/Tracks -> Utils/Analytics)",
        },
      ],
    });
  });

  test("leaves out a module that needs a package Common does not depend on, or a file that is not there", () => {
    const selection: ModuleSelection = selectModules({
      candidates: ["Types/Faker", "Types/Fs", "Types/Gone", "Types/Uses"],
      requiresOf: graph({
        "Types/Faker": { packages: ["@faker-js/faker"] },
        // Node.js's own modules never leave a module out.
        "Types/Fs": { packages: [] },
        "Types/Gone": { unresolved: ["./Deleted"] },
        "Types/Uses": { modules: ["Types/Faker"] },
      }),
      dependencies,
      leftOut: {},
    });

    expect(selection).toEqual({
      published: ["Types/Fs"],
      leftOut: [
        {
          module: "Types/Faker",
          reason:
            "needs @faker-js/faker, which Common does not depend on (Types/Faker)",
        },
        {
          module: "Types/Gone",
          reason:
            "Types/Gone requires ./Deleted, which is not there (Types/Gone)",
        },
        {
          module: "Types/Uses",
          reason:
            "needs @faker-js/faker, which Common does not depend on (Types/Uses -> Types/Faker)",
        },
      ],
    });
  });

  test("ships every declaration the published ones refer to, and says what is missing", () => {
    const references: (id: string) => ModuleReferences = graph({
      "Types/A": { modules: ["Types/B", "UI/Dropdown"], packages: ["typeorm"] },
      "Types/B": { modules: ["Server/Types/Query"] },
      "UI/Dropdown": { packages: ["react"] },
      "Server/Types/Query": { modules: ["Types/B"] },
      "Types/Broken": { unresolved: ["./Gone"] },
    });

    expect(
      selectDeclarations({
        published: ["Types/A"],
        declarations: new Set([
          "Types/A",
          "Types/B",
          "UI/Dropdown",
          "Server/Types/Query",
        ]),
        referencesOf: references,
      }),
    ).toEqual({
      files: ["Server/Types/Query", "Types/A", "Types/B", "UI/Dropdown"],
      packages: { typeorm: ["Types/A"], react: ["UI/Dropdown"] },
      problems: [],
    });

    expect(
      selectDeclarations({
        published: ["Types/Broken", "Types/NoDeclaration"],
        declarations: new Set(["Types/Broken"]),
        referencesOf: references,
      }).problems,
    ).toEqual([
      "Types/NoDeclaration has no declaration",
      "Types/Broken.d.ts refers to ./Gone, which is not there",
    ]);
  });

  test("depends on exactly the packages the published JavaScript requires, at Common's versions", () => {
    expect(
      selectDependencies({
        published: ["Types/A", "Types/B"],
        requiresOf: graph({
          "Types/A": { packages: ["zod", "typeorm"] },
          "Types/B": { packages: ["typeorm"] },
          "Types/LeftOut": { packages: ["posthog-js"] },
        }),
        dependencies: {
          ...dependencies,
          "posthog-js": "^1.0.0",
          unused: "^1.0.0",
        },
      }),
    ).toEqual({ typeorm: "^0.3.26", zod: "^3.25.76" });
  });
});

describe("each module's ES module twin", () => {
  test("re-exports the CommonJS module's default and its named exports", () => {
    expect(
      esModuleWrapper("Types/JSON", {
        hasDefault: true,
        names: ["ObjectType", "Alpha"],
      }),
    ).toBe(
      [
        'import commonJsModule from "./JSON.js";',
        "export default commonJsModule.default;",
        "export const Alpha = commonJsModule.Alpha;",
        "export const ObjectType = commonJsModule.ObjectType;",
        "",
      ].join("\n"),
    );
    expect(
      esModuleWrapper("Types/Only", { hasDefault: false, names: ["X"] }),
    ).toBe(
      [
        'import commonJsModule from "./Only.js";',
        "export const X = commonJsModule.X;",
        "",
      ].join("\n"),
    );
  });

  test("still loads a module of types only, which exports nothing when it runs", () => {
    expect(
      esModuleWrapper("Types/Dictionary", { hasDefault: false, names: [] }),
    ).toBe('import "./Dictionary.js";\n');
  });

  test("re-exports a name no const can have through an alias, and never shadows one", () => {
    expect(
      esModuleWrapper("Types/Odd", {
        hasDefault: false,
        names: ["delete", "commonJsModule", "a-b"],
      }),
    ).toBe(
      [
        'import _commonJsModule from "./Odd.js";',
        'const _commonJsModule_0 = _commonJsModule["a-b"];',
        'export { _commonJsModule_0 as "a-b" };',
        "export const commonJsModule = _commonJsModule.commonJsModule;",
        'const _commonJsModule_2 = _commonJsModule["delete"];',
        "export { _commonJsModule_2 as delete };",
        "",
      ].join("\n"),
    );
  });

  test("hands out the CommonJS module's very values when Node.js imports it", () => {
    const directory: string = path.join(scratch, "twin");

    writeFiles(directory, {
      "Thing.js": [
        '"use strict";',
        'Object.defineProperty(exports, "__esModule", { value: true });',
        "exports.Kind = exports.helper = void 0;",
        "class Thing { constructor() { this.made = true; } }",
        "exports.default = Thing;",
        "function helper() { return 42; }",
        "exports.helper = helper;",
        "var Kind;",
        '(function (Kind) { Kind["A"] = "a"; })(Kind || (exports.Kind = Kind = {}));',
        'exports["delete"] = "reserved";',
        "",
      ].join("\n"),
      "Thing.mjs": esModuleWrapper("Thing", {
        hasDefault: true,
        names: ["helper", "Kind", "delete"],
      }),
      "check.mjs": [
        'import { createRequire } from "node:module";',
        'import Thing, { helper, Kind } from "./Thing.mjs";',
        'import * as all from "./Thing.mjs";',
        'const required = createRequire(import.meta.url)("./Thing.js");',
        "console.log(JSON.stringify({",
        "  sameClass: Thing === required.default,",
        "  instance: new Thing() instanceof required.default,",
        "  helper: helper(),",
        "  sameHelper: helper === required.helper,",
        "  kind: Kind.A,",
        '  reserved: all["delete"],',
        "  names: Object.keys(all).sort(),",
        "}));",
        "",
      ].join("\n"),
    });

    const run: { status: number; stdout: string; stderr: string } = runNode(
      path.join(directory, "check.mjs"),
      directory,
    );

    expect(run.stderr).toBe("");
    expect(JSON.parse(run.stdout)).toEqual({
      sameClass: true,
      instance: true,
      helper: 42,
      sameHelper: true,
      kind: "a",
      reserved: "reserved",
      names: ["Kind", "default", "delete", "helper"],
    });
  });

  test("types an ES module through declarations that name ES modules throughout", () => {
    const declarations: (id: string) => boolean = exists([
      "Types/API/URL",
      "Types/Email",
      "Types/Monitor/Index",
      "Types/Email/EmailMessage",
    ]);
    const text: string = [
      'import URL from "./API/URL";',
      'import { Repository } from "typeorm";',
      'export * from "./Monitor";',
      'export declare const sender: import("./Email").default;',
      'export type Path = "./API/URL";',
      'import Gone from "./Gone";',
      "",
    ].join("\n");

    expect(
      esModuleDeclaration(ts, "Types/Thing", text, { exists: declarations }),
    ).toBe(
      [
        'import URL from "./API/URL.mjs";',
        'import { Repository } from "typeorm";',
        'export * from "./Monitor/Index.mjs";',
        'export declare const sender: import("./Email.mjs").default;',
        // A string type is not a module specifier.
        'export type Path = "./API/URL";',
        // What resolves to nothing is left for verifyPackage to report.
        'import Gone from "./Gone";',
        "",
      ].join("\n"),
    );
    expect(
      esModuleDeclaration(
        ts,
        "Types/Email/EmailMessage",
        'import Email from "../Email";\n',
        { exists: declarations },
      ),
    ).toBe('import Email from "../Email.mjs";\n');
    expect(
      esModuleDeclaration(
        ts,
        "Types/Thing",
        'import { FindOperator } from "typeorm/find-options/FindOperator";\n',
        {
          exists: declarations,
          packageSpecifier: (specifier: string): string => {
            return `${specifier}.js`;
          },
        },
      ),
    ).toBe(
      'import { FindOperator } from "typeorm/find-options/FindOperator.js";\n',
    );
  });

  /*
   * typeorm's exports map opens "./*" to require, but to import only
   * "./*.js": the declarations' deep "typeorm/..." imports named nothing in
   * an ES module, and every type they brought became any.
   */
  test("gives a package's deep specifier the .js an ES module needs, only when that is what resolves", () => {
    const directory: string = path.join(scratch, "deep");

    writeFiles(directory, {
      "node_modules/deep-package/package.json": JSON.stringify({
        name: "deep-package",
        version: "1.0.0",
        exports: {
          ".": { types: "./index.d.ts", default: "./index.js" },
          "./*.js": "./*.js",
          "./*": { require: "./*.js", import: "./*" },
        },
      }),
      "node_modules/deep-package/index.d.ts": "export declare const a: 1;\n",
      "node_modules/deep-package/sub/Thing.d.ts":
        "export declare const b: 2;\n",
      "node_modules/plain-package/package.json": JSON.stringify({
        name: "plain-package",
        version: "1.0.0",
        types: "./index.d.ts",
      }),
      "node_modules/plain-package/index.d.ts": "export declare const c: 3;\n",
      "node_modules/plain-package/sub/Thing.d.ts":
        "export declare const d: 4;\n",
      "package/package.json": "{}",
    });

    const specifier: (specifier: string) => string = esModulePackageSpecifiers(
      ts,
      path.join(directory, "package"),
    );

    expect(specifier("deep-package/sub/Thing")).toBe(
      "deep-package/sub/Thing.js",
    );
    expect(specifier("deep-package")).toBe("deep-package");
    expect(specifier("plain-package")).toBe("plain-package");
    // An ES module names a file of a package without an exports map in full.
    expect(specifier("plain-package/sub/Thing")).toBe(
      "plain-package/sub/Thing.js",
    );
    expect(specifier("plain-package/sub/Thing.js")).toBe(
      "plain-package/sub/Thing.js",
    );
    // What resolves neither way stays as it is.
    expect(specifier("not-installed/sub")).toBe("not-installed/sub");
  });
});

describe("a declaration shipped for types only, cut down", () => {
  // The UI's Dropdown, as tsc declares it.
  const DROPDOWN: string = [
    'import DROPDOWN_MENU_Z_INDEX from "./DropdownMenuZIndex";',
    'import { FunctionComponent } from "react";',
    'import Color from "../../../Types/Color";',
    'import Label from "../../../Models/DatabaseModels/Label";',
    'import { CSSObjectWithLabel } from "react-select";',
    "export type DropdownValue = string | number | boolean;",
    "export type DropdownOptionLabel = Label | {",
    "    id?: string;",
    "    name: string;",
    "    color?: Color;",
    "};",
    "/** One option. */",
    "export interface DropdownOption {",
    "    value: DropdownValue;",
    "    label: string;",
    "    labels?: Array<DropdownOptionLabel>;",
    "}",
    "export interface DropdownOptionGroup {",
    "    label: string;",
    "    options: Array<DropdownOption>;",
    "}",
    "export { DROPDOWN_MENU_Z_INDEX };",
    "export interface ComponentProps {",
    "    options: Array<DropdownOption | DropdownOptionGroup>;",
    "}",
    "export declare const getDropdownOptionStyle: (provided: CSSObjectWithLabel) => CSSObjectWithLabel;",
    "declare const Dropdown: FunctionComponent<ComponentProps>;",
    "export default Dropdown;",
    "",
  ].join("\n");

  test("keeps what the others use and what that needs, and drops the React component", () => {
    expect(
      pruneDeclaration(
        ts,
        "UI/Components/Dropdown/Dropdown.d.ts",
        DROPDOWN,
        new Set(["DropdownOption"]),
      ),
    ).toBe(
      [
        'import Color from "../../../Types/Color";',
        'import Label from "../../../Models/DatabaseModels/Label";',
        "export type DropdownValue = string | number | boolean;",
        "export type DropdownOptionLabel = Label | {",
        "    id?: string;",
        "    name: string;",
        "    color?: Color;",
        "};",
        "/** One option. */",
        "export interface DropdownOption {",
        "    value: DropdownValue;",
        "    label: string;",
        "    labels?: Array<DropdownOptionLabel>;",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("keeps the default export, an export list's used names and an import's used bindings", () => {
    const pruned: string = pruneDeclaration(
      ts,
      "UI/Components/Dropdown/Dropdown.d.ts",
      DROPDOWN,
      new Set(["default", "DROPDOWN_MENU_Z_INDEX"]),
    );

    expect(pruned).toContain('import { FunctionComponent } from "react";');
    expect(pruned).toContain(
      'import DROPDOWN_MENU_Z_INDEX from "./DropdownMenuZIndex";',
    );
    expect(pruned).toContain("export { DROPDOWN_MENU_Z_INDEX };");
    expect(pruned).toContain(
      "declare const Dropdown: FunctionComponent<ComponentProps>;",
    );
    expect(pruned).toContain("export default Dropdown;");
    expect(pruned).toContain("export interface DropdownOptionGroup {");
    expect(pruned).not.toContain("react-select");
    expect(pruned).not.toContain("getDropdownOptionStyle");

    const partly: string = pruneDeclaration(
      ts,
      "Types/Thing.d.ts",
      [
        'import { Used, Unused } from "./Elsewhere";',
        'import "reflect-metadata";',
        "declare global { interface Window { thing: string } }",
        "export interface Thing { value: Used }",
        "export interface Other { value: Unused }",
        "export { Thing as Renamed, Other as Dropped };",
        "",
      ].join("\n"),
      new Set(["Renamed"]),
    );

    expect(partly).toBe(
      [
        'import { Used } from "./Elsewhere";',
        'import "reflect-metadata";',
        "declare global { interface Window { thing: string } }",
        "export interface Thing { value: Used }",
        "export { Thing as Renamed };",
        "",
      ].join("\n"),
    );
  });

  test("stays a module when nothing it exports is used", () => {
    expect(
      pruneDeclaration(
        ts,
        "Types/Thing.d.ts",
        'import { A } from "./A";\nexport interface Thing { a: A }\n',
        new Set(),
      ),
    ).toBe("export {};\n");
  });

  test("reads what a declaration uses from a module", () => {
    const isDropdown: (specifier: string) => boolean = (
      specifier: string,
    ): boolean => {
      return specifier.endsWith("/Dropdown");
    };
    const names: (text: string) => { all: boolean; names: Array<string> } = (
      text: string,
    ): { all: boolean; names: Array<string> } => {
      const used: { all: boolean; names: Set<string> } = namesUsedFrom(
        ts,
        "Types/User.d.ts",
        text,
        isDropdown,
      );

      return { all: used.all, names: [...used.names].sort() };
    };

    expect(
      names(
        [
          'import Dropdown, { DropdownOption, DropdownValue as Value } from "../UI/Dropdown";',
          'export { DropdownOptionGroup } from "../UI/Dropdown";',
          'export declare const style: import("../UI/Dropdown").Styles.Inner;',
          'import { Other } from "./Other";',
        ].join("\n"),
      ),
    ).toEqual({
      all: false,
      names: [
        "DropdownOption",
        "DropdownOptionGroup",
        "DropdownValue",
        "Styles",
        "default",
      ],
    });

    for (const whole of [
      'import * as Everything from "../UI/Dropdown";',
      'export * from "../UI/Dropdown";',
      'export * as Everything from "../UI/Dropdown";',
      'export declare const all: typeof import("../UI/Dropdown");',
      'import Old = require("../UI/Dropdown");',
    ]) {
      expect({ whole, used: names(whole).all }).toEqual({ whole, used: true });
    }
  });
});

describe("the package root and its manifest", () => {
  const ROOT: ReadonlyArray<RootExport> = [
    { name: "API", module: "Utils/API" },
    { name: "ObjectType", module: "Types/JSON", export: "ObjectType" },
    { name: "Dictionary", module: "Types/Dictionary", typeOnly: true },
    {
      name: "JSONObject",
      module: "Types/JSON",
      export: "JSONObject",
      typeOnly: true,
    },
  ];

  test("writes the root four ways: CommonJS, ES module, and the types of each", () => {
    const files: Record<string, string> = rootEntryFiles(ROOT);

    expect(Object.keys(files).sort()).toEqual([
      "index.d.mts",
      "index.d.ts",
      "index.js",
      "index.mjs",
    ]);
    expect(files["index.js"]).toContain('"use strict";\n');
    expect(files["index.js"]).toContain(
      'Object.defineProperty(exports, "__esModule", { value: true });',
    );
    expect(files["index.js"]).toContain(
      'exports.API = require("./Utils/API").default;',
    );
    expect(files["index.js"]).toContain(
      'exports.ObjectType = require("./Types/JSON").ObjectType;',
    );
    // What exists for TypeScript alone has no JavaScript.
    expect(files["index.js"]).not.toContain("Dictionary");
    expect(files["index.mjs"]).not.toContain("JSONObject");
    expect(files["index.mjs"]).toContain(
      'export { default as API } from "./Utils/API.mjs";',
    );
    expect(files["index.mjs"]).toContain(
      'export { ObjectType } from "./Types/JSON.mjs";',
    );
    expect(files["index.d.ts"]).toContain(
      'export { default as API } from "./Utils/API";',
    );
    expect(files["index.d.ts"]).toContain(
      'export type { default as Dictionary } from "./Types/Dictionary";',
    );
    expect(files["index.d.ts"]).toContain(
      'export type { JSONObject } from "./Types/JSON";',
    );
    expect(files["index.d.mts"]).toContain(
      'export type { default as Dictionary } from "./Types/Dictionary.mjs";',
    );
    expect(files["index.d.mts"]).toContain(
      'export { default as API } from "./Utils/API.mjs";',
    );
  });

  test("opens the root, the public files and directories, and maps each module left out to null", () => {
    const map: ExportsMap = exportsMap({
      publishedFiles: ["ServiceRoute"],
      leftOut: ["Utils/UserPreferences", "Utils/Analytics"],
    });
    const conditions: (base: string) => ExportConditions = (
      base: string,
    ): ExportConditions => {
      return {
        import: { types: `./${base}.d.mts`, default: `./${base}.mjs` },
        require: { types: `./${base}.d.ts`, default: `./${base}.js` },
      };
    };

    expect(map).toEqual({
      ".": conditions("index"),
      "./ServiceRoute": conditions("ServiceRoute"),
      "./Types/*": conditions("Types/*"),
      "./Utils/*": conditions("Utils/*"),
      "./Models/*": conditions("Models/*"),
      "./Utils/Analytics": null,
      "./Utils/UserPreferences": null,
      "./package.json": "./package.json",
    });

    // TypeScript takes the first condition that matches: types go first.
    for (const value of Object.values(map)) {
      if (value && typeof value === "object") {
        expect(Object.keys(value)).toEqual(["import", "require"]);
        expect(Object.keys(value.import)).toEqual(["types", "default"]);
        expect(Object.keys(value.require)).toEqual(["types", "default"]);
      }
    }
  });

  test("takes its name, version, licence and repository from Common, and runs nothing when installed", () => {
    const manifest: PackageManifest = packageManifest({
      source: {
        name: "@oneuptime/common",
        version: "14.0.90",
        repository: {
          type: "git",
          url: "https://github.com/OneUptime/oneuptime",
        },
        author: "OneUptime <hello@oneuptime.com> (https://oneuptime.com/)",
        license: "Apache-2.0",
        dependencies: { typeorm: "^0.3.26", react: "^18.3.1" },
        devDependencies: { jest: "^28.1.1" },
      },
      dependencies: { typeorm: "^0.3.26" },
      exports: { ".": "./index.js" },
      files: ["index.js"],
    });

    expect(manifest).toEqual({
      name: "@oneuptime/common",
      version: "14.0.90",
      description:
        "OneUptime's shared types, utilities and data models, for Node.js and TypeScript.",
      homepage: "https://oneuptime.com",
      // npm checks the provenance it signs against repository.url.
      repository: {
        type: "git",
        url: "https://github.com/OneUptime/oneuptime",
        directory: "packages/Common",
      },
      bugs: { url: "https://github.com/OneUptime/oneuptime/issues" },
      author: "OneUptime <hello@oneuptime.com> (https://oneuptime.com/)",
      license: "Apache-2.0",
      engines: { node: NODE_ENGINE },
      main: "./index.js",
      types: "./index.d.ts",
      exports: { ".": "./index.js" },
      files: ["index.js"],
      dependencies: { typeorm: "^0.3.26" },
    });
    expect(NODE_ENGINE).toBe(">=22");
  });
});

describe("checking the package it wrote", () => {
  // A small package that is right, written as the build writes one.
  function writeGoodPackage(directory: string): void {
    writeFiles(directory, {
      "package.json": JSON.stringify(
        {
          name: "@oneuptime/common",
          version: "1.0.0",
          main: "./index.js",
          types: "./index.d.ts",
          exports: {
            ".": {
              import: { types: "./index.d.mts", default: "./index.mjs" },
              require: { types: "./index.d.ts", default: "./index.js" },
            },
            "./Types/*": {
              import: { types: "./Types/*.d.mts", default: "./Types/*.mjs" },
              require: { types: "./Types/*.d.ts", default: "./Types/*.js" },
            },
            "./Types/LeftOut": null,
            "./package.json": "./package.json",
          },
          dependencies: { "some-package": "^1.0.0" },
        },
        null,
        2,
      ),
      "README.md": "# @oneuptime/common\n",
      LICENSE: "Apache-2.0\n",
      "index.js":
        '"use strict";\nexports.ObjectID = require("./Types/ObjectID").default;\n',
      "index.mjs":
        'export { default as ObjectID } from "./Types/ObjectID.mjs";\n',
      "index.d.ts": 'export { default as ObjectID } from "./Types/ObjectID";\n',
      "index.d.mts":
        'export { default as ObjectID } from "./Types/ObjectID.mjs";\n',
      "Types/ObjectID.js":
        '"use strict";\nconst a = require("some-package/sub");\nconst b = require("node:crypto");\nconst c = require("./Helper");\nexports.default = class ObjectID {};\n',
      "Types/ObjectID.mjs":
        'import commonJsModule from "./ObjectID.js";\nexport default commonJsModule.default;\n',
      "Types/ObjectID.d.ts":
        'import Query from "../Server/Types/Query";\nexport default class ObjectID { query: Query }\n',
      "Types/ObjectID.d.mts":
        'import Query from "../Server/Types/Query.mjs";\nexport default class ObjectID { query: Query }\n',
      "Types/Helper.js": '"use strict";\n',
      "Types/Helper.mjs": 'import "./Helper.js";\n',
      "Types/Helper.d.ts": "export {};\n",
      "Types/Helper.d.mts": "export {};\n",
      "Types/LeftOut.d.ts": "export interface LeftOut { a: string }\n",
      "Types/LeftOut.d.mts": "export interface LeftOut { a: string }\n",
      "Server/Types/Query.d.ts": "export default interface Query { a: 1 }\n",
      "Server/Types/Query.d.mts": "export default interface Query { a: 1 }\n",
    });
  }

  test("finds nothing wrong with a package that is right", () => {
    const directory: string = path.join(scratch, "good");
    writeGoodPackage(directory);

    expect(verifyPackage(ts, directory)).toEqual([]);
  });

  test("finds each way a package can be wrong", () => {
    const directory: string = path.join(scratch, "bad");
    writeGoodPackage(directory);

    writeFiles(directory, {
      // JavaScript of the server, and a source map and TypeScript.
      "Server/Utils/Logger.js": '"use strict";\n',
      "Types/ObjectID.js.map": "{}",
      "Types/Source.ts": "export const a = 1;\n",
      // A module with JavaScript but no twin or types.
      "Types/Lonely.js":
        '"use strict";\nrequire("./Nowhere");\nrequire("undeclared-package");\n',
      // A module mapped to null whose JavaScript is there.
      "Types/LeftOut.js": '"use strict";\n',
      "Types/LeftOut.mjs": 'import "./LeftOut.js";\n',
      // An ES module type naming a file without its extension.
      "Types/Helper.d.mts": 'import ObjectID from "./ObjectID";\nexport {};\n',
      // A declaration naming what is not there.
      "Types/Helper.d.ts": 'import Gone from "./Gone";\nexport {};\n',
      // A twin importing a package.
      "Types/Helper.mjs": 'import "some-package";\nimport "./Helper.js";\n',
    });

    const manifest: { main: string; exports: Record<string, unknown> } =
      JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    manifest.main = "./main.js";
    manifest.exports["./Extra"] = "./Extra.js";
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify(manifest),
    );

    expect(verifyPackage(ts, directory).sort()).toEqual(
      [
        "Server/Utils/Logger.js should not be in the package",
        "Types/ObjectID.js.map should not be in the package",
        "Types/Source.ts should not be in the package",
        "the manifest names ./main.js, which is not there",
        "./Extra names ./Extra.js, which is not there",
        "./Types/LeftOut is mapped to null but its JavaScript is in the package",
        "Types/Lonely has no .mjs",
        "Types/Lonely has no .d.ts",
        "Types/Lonely has no .d.mts",
        "Server/Utils/Logger has no .mjs",
        "Server/Utils/Logger has no .d.ts",
        "Server/Utils/Logger has no .d.mts",
        "Types/Lonely.js requires ./Nowhere, which is not there",
        "Types/Lonely.js requires undeclared-package, which is not a dependency",
        "Types/Helper.mjs imports some-package",
        "Types/Helper.d.ts refers to ./Gone, which is not there",
        "Types/Helper.d.mts refers to ./ObjectID, which does not name an ES module",
      ].sort(),
    );
  });

  test("says so when there is no manifest at all", () => {
    const directory: string = path.join(scratch, "empty");
    fs.mkdirSync(directory, { recursive: true });

    expect(verifyPackage(ts, directory)).toEqual(["there is no package.json"]);
  });
});
