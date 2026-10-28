import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";

/*
 * NOTHING A FRONTEND LOADS BUILDS AN API SCHEMA.
 *
 * Common's Types used to build their OpenAPI schemas themselves
 * (Email.getSchema(), ObjectID.getSchema(), the monitor criteria and steps),
 * with zod and zod-to-openapi. Every frontend loads those Types, so every
 * frontend - the Dashboard, Accounts, the Admin Dashboard, status pages and
 * public dashboards - carried zod for schemas no browser reads: about 111 KB
 * (33 KB gzipped) of the chunks every page loads, and the monitor criteria
 * made their schemas as they loaded. The schemas live in Common's
 * Utils/Schema now (TypeSchemas, MonitorSchemas, ModelSchema ...), which the
 * server loads to write the API reference, the MCP tools and the Terraform
 * provider.
 *
 * This keeps it so. It walks every frontend from its entry points, as
 * esbuild does: through each import that loads code (import, export ...
 * from, require(), import()), resolving relative paths, "Common/..." and the
 * aliases the Enterprise build sets (Common/UI/esbuild-enterprise). It fails
 * when a module it reaches imports zod, zod-to-openapi or a module of
 * Common's Utils/Schema, and names the imports that led there. A type-only
 * import loads nothing, so the walk does not follow it - but one of zod or of
 * Utils/Schema is still a finding: what a frontend loads does not deal in
 * API schemas at all. The detector and the resolver are pinned on snippets,
 * and the walk on a stand-in tree, before the real frontends are walked.
 */

const COMMON_DIRECTORY: string = path.join(
  REPOSITORY_DIRECTORY,
  "packages",
  "Common",
);
const FEATURE_SET_DIRECTORY: string = path.join(
  REPOSITORY_DIRECTORY,
  "packages",
  "App",
  "FeatureSet",
);
const SCHEMA_DIRECTORY: string = path.join(COMMON_DIRECTORY, "Utils", "Schema");

// The packages that build API schemas.
const SCHEMA_PACKAGES: ReadonlyArray<string> = [
  "zod",
  "@asteasolutions/zod-to-openapi",
];

// esbuild's order (Common/UI/esbuild-config's resolveExtensions).
const RESOLVE_EXTENSIONS: ReadonlyArray<string> = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".json",
  ".css",
  ".scss",
];

// What the walk reads: the files that can import other modules.
const CODE_FILE: RegExp = /\.(tsx?|jsx?|mjs|cjs)$/;

interface ModuleReference {
  // 1-based.
  line: number;
  specifier: string;
  // False for a reference TypeScript erases: import type, typeof import().
  loadsCode: boolean;
}

interface EnterpriseAlias {
  pluginSpecifier: string;
  eeSubdir: string;
  internalSpecifier: string;
}

interface Frontend {
  // Its directory under packages/App/FeatureSet.
  name: string;
  // Relative to that directory, as its esbuild.config.js names them.
  entryPoints: ReadonlyArray<string>;
  enterprise?: EnterpriseAlias;
}

/*
 * Every bundle a browser (or, for the mobile recorder, an app) runs, with
 * what its esbuild.config.js builds from. "the frontends" below holds this
 * list to the configs.
 */
const FRONTENDS: ReadonlyArray<Frontend> = [
  {
    name: "Dashboard",
    entryPoints: ["src/Index.tsx"],
    enterprise: {
      pluginSpecifier: "@oneuptime/ee-dashboard",
      eeSubdir: "Dashboard",
      internalSpecifier: "@oneuptime/dashboard",
    },
  },
  {
    name: "AdminDashboard",
    entryPoints: ["src/Index.tsx"],
    enterprise: {
      pluginSpecifier: "@oneuptime/ee-admin-dashboard",
      eeSubdir: "AdminDashboard",
      internalSpecifier: "@oneuptime/admin-dashboard",
    },
  },
  { name: "Accounts", entryPoints: ["src/Index.tsx"] },
  { name: "StatusPage", entryPoints: ["src/Index.tsx"] },
  { name: "PublicDashboard", entryPoints: ["src/Index.tsx"] },
  { name: "BrowserRecorder", entryPoints: ["src/Index.ts", "src/Loader.ts"] },
  { name: "MobileRecorder", entryPoints: ["src/index.ts"] },
];

// The Types that built their own API schema until the schemas moved to Utils/Schema.
const TYPES_THAT_BUILT_SCHEMAS: ReadonlyArray<string> = [
  "Types/Color.ts",
  "Types/Database/DatabaseProperty.ts",
  "Types/Date.ts",
  "Types/Domain.ts",
  "Types/Email.ts",
  "Types/IP/IP.ts",
  "Types/Monitor/CriteriaAlert.ts",
  "Types/Monitor/CriteriaFilter.ts",
  "Types/Monitor/CriteriaIncident.ts",
  "Types/Monitor/IncomingMonitor/IncidentGroupingConfig.ts",
  "Types/Monitor/MonitorCriteria.ts",
  "Types/Monitor/MonitorCriteriaInstance.ts",
  "Types/Monitor/MonitorStep.ts",
  "Types/Monitor/MonitorSteps.ts",
  "Types/Name.ts",
  "Types/ObjectID.ts",
  "Types/Phone.ts",
  "Types/Port.ts",
  "Types/Version.ts",
];

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  return ts.ScriptKind.JS;
}

// An import whose every binding is a type: TypeScript and esbuild erase it.
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause: ts.ImportClause | undefined = node.importClause;

  if (!clause) {
    // import "x": loaded for its side effects.
    return false;
  }

  if (clause.isTypeOnly) {
    return true;
  }

  const bindings: ts.NamedImportBindings | undefined = clause.namedBindings;

  return (
    !clause.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element: ts.ImportSpecifier): boolean => {
      return element.isTypeOnly;
    })
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) {
    return true;
  }

  const clause: ts.NamedExportBindings | undefined = node.exportClause;

  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element: ts.ExportSpecifier): boolean => {
      return element.isTypeOnly;
    })
  );
}

// Every module a file names: in an import, an export ... from, require(), import() or a type.
function moduleReferences(
  fileName: string,
  source: string,
): Array<ModuleReference> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const found: Array<ModuleReference> = [];

  const record: (
    node: ts.Node,
    specifier: string,
    loadsCode: boolean,
  ) => void = (node: ts.Node, specifier: string, loadsCode: boolean): void => {
    found.push({
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      specifier: specifier,
      loadsCode: loadsCode,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text, !isTypeOnlyImport(node));
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text, !isTypeOnlyExport(node));
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node, node.moduleReference.expression.text, !node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      const argument: ts.Expression | undefined = node.arguments[0];
      const isRequire: boolean =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport: boolean =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;

      if (
        (isRequire || isDynamicImport) &&
        argument &&
        ts.isStringLiteralLike(argument)
      ) {
        record(node, argument.text, true);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      record(node, node.argument.literal.text, false);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// "zod", "zod/v4", "@asteasolutions/zod-to-openapi/..." -> the package's name.
function packageNameOf(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] as string);
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// A path as esbuild finds it: as written, with an extension, or a directory's index.
function resolvePath(base: string): string | null {
  if (isFile(base)) {
    return base;
  }

  for (const extension of RESOLVE_EXTENSIONS) {
    if (isFile(`${base}${extension}`)) {
      return `${base}${extension}`;
    }
  }

  for (const extension of RESOLVE_EXTENSIONS) {
    const index: string = path.join(base, `index${extension}`);

    if (isFile(index)) {
      return index;
    }
  }

  return null;
}

interface Resolution {
  // The file the specifier names, or null for a package.
  file: string | null;
  // A specifier of the repository's own code that names no file.
  unresolved: boolean;
}

/*
 * Where an import leads: a file of the repository (relative, "Common/...",
 * or an alias), or a package (file null). `aliases` maps a specifier, and
 * anything under it, to a path, as esbuild's alias option does.
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  commonDirectory: string,
  aliases: Readonly<Record<string, string>>,
): Resolution {
  let base: string | null = null;

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier === "Common" || specifier.startsWith("Common/")) {
    base = path.join(commonDirectory, specifier.slice("Common".length));
  } else {
    for (const [alias, target] of Object.entries(aliases)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        base = path.join(target, specifier.slice(alias.length));
        break;
      }
    }
  }

  if (base === null) {
    return { file: null, unresolved: false };
  }

  const file: string | null = resolvePath(base);

  return { file: file, unresolved: file === null };
}

interface WalkFinding {
  // Repository-relative, from the entry point to the file that imports it.
  chain: Array<string>;
  line: number;
  specifier: string;
}

interface WalkResult {
  // Repository-relative paths of every file reached.
  reached: Set<string>;
  findings: Array<WalkFinding>;
  unresolved: Array<string>;
}

/*
 * Reads every file the entry points load, breadth first, and reports each
 * reference to a schema package or a file under schemaDirectory.
 */
function walk(options: {
  entryPoints: ReadonlyArray<string>;
  commonDirectory: string;
  schemaDirectory: string;
  aliases: Readonly<Record<string, string>>;
  root: string;
}): WalkResult {
  const parents: Map<string, string | null> = new Map<string, string | null>();
  const queue: Array<string> = [];
  const findings: Array<WalkFinding> = [];
  const unresolved: Array<string> = [];
  const relative: (file: string) => string = (file: string): string => {
    return path.relative(options.root, file).split(path.sep).join("/");
  };
  const chainTo: (file: string) => Array<string> = (
    file: string,
  ): Array<string> => {
    const chain: Array<string> = [];

    for (
      let at: string | null = file;
      at !== null;
      at = parents.get(at) ?? null
    ) {
      chain.unshift(relative(at));
    }

    return chain;
  };
  const isSchemaFile: (file: string) => boolean = (file: string): boolean => {
    return file.startsWith(`${options.schemaDirectory}${path.sep}`);
  };

  for (const entryPoint of options.entryPoints) {
    if (!parents.has(entryPoint)) {
      parents.set(entryPoint, null);
      queue.push(entryPoint);
    }
  }

  while (queue.length > 0) {
    const file: string = queue.shift() as string;

    for (const reference of moduleReferences(
      file,
      fs.readFileSync(file, "utf8"),
    )) {
      const resolution: Resolution = resolveSpecifier(
        file,
        reference.specifier,
        options.commonDirectory,
        options.aliases,
      );

      if (resolution.unresolved) {
        unresolved.push(
          `${relative(file)}:${reference.line} ${reference.specifier}`,
        );
        continue;
      }

      const target: string | null = resolution.file;
      const namesSchemaCode: boolean =
        target === null
          ? SCHEMA_PACKAGES.includes(packageNameOf(reference.specifier))
          : isSchemaFile(target);

      if (namesSchemaCode) {
        findings.push({
          chain: chainTo(file),
          line: reference.line,
          specifier: reference.specifier,
        });
        continue;
      }

      if (
        target !== null &&
        reference.loadsCode &&
        CODE_FILE.test(target) &&
        !parents.has(target)
      ) {
        parents.set(target, file);
        queue.push(target);
      }
    }
  }

  return {
    reached: new Set<string>([...parents.keys()].map(relative)),
    findings: findings,
    unresolved: unresolved,
  };
}

// Common/UI/esbuild-enterprise.js, as the Dashboard's and Admin Dashboard's builds load it.
interface EsbuildEnterprise {
  resolveEnterpriseBuild: (options: {
    frontendDir: string;
    pluginSpecifier: string;
    eeSubdir: string;
    internalSpecifier: string;
  }) => { alias: Record<string, string> };
}

const ESBUILD_ENTERPRISE: string = path.join(
  COMMON_DIRECTORY,
  "UI",
  "esbuild-enterprise.js",
);

// The aliases a frontend's build sets, as its esbuild.config.js asks for them.
function aliasesOf(frontend: Frontend): Record<string, string> {
  if (!frontend.enterprise) {
    return {};
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const enterprise: EsbuildEnterprise = require(ESBUILD_ENTERPRISE);
  const alias: Record<string, string> = {
    ...enterprise.resolveEnterpriseBuild({
      frontendDir: path.join(FEATURE_SET_DIRECTORY, frontend.name),
      ...frontend.enterprise,
    }).alias,
  };

  // "Common" is the frontend's node_modules/Common: Common itself here.
  delete alias["Common"];

  return alias;
}

function describeFinding(finding: WalkFinding): string {
  return `${finding.chain.join(" -> ")}:${finding.line} imports ${finding.specifier}`;
}

const temporaryRoots: Array<string> = [];

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A tree of stand-in files, each written with its text.
function standInTree(files: Record<string, string>): string {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-zod-guard-"),
  );

  temporaryRoots.push(root);

  for (const [name, text] of Object.entries(files)) {
    const file: string = path.join(root, name);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  return root;
}

function referencesIn(
  source: string,
  fileName: string = "Fixture.ts",
): Array<string> {
  return moduleReferences(fileName, source).map(
    (reference: ModuleReference): string => {
      return `${reference.line}: ${reference.specifier}${reference.loadsCode ? "" : " (types only)"}`;
    },
  );
}

describe("the detector reads every way a file names a module", () => {
  test.each([
    ['import Zod from "zod";', ["1: zod"]],
    ['import { z } from "zod";', ["1: zod"]],
    ['import * as z from "zod";', ["1: zod"]],
    ['import "zod";', ["1: zod"]],
    ['import Zod, { type ZodType } from "zod";', ["1: zod"]],
    ['import { type ZodType, object } from "zod";', ["1: zod"]],
    ['import type { ZodType } from "zod";', ["1: zod (types only)"]],
    [
      'import { type ZodType, type ZodObject } from "zod";',
      ["1: zod (types only)"],
    ],
    ['export * from "zod";', ["1: zod"]],
    ['export { object } from "zod";', ["1: zod"]],
    ['export type { ZodType } from "zod";', ["1: zod (types only)"]],
    ['export { type ZodType } from "zod";', ["1: zod (types only)"]],
    ['const zod = require("zod");', ["1: zod"]],
    ['const zod = await import("zod");', ["1: zod"]],
    ['import zod = require("zod");', ["1: zod"]],
    ['type Z = typeof import("zod");', ["1: zod (types only)"]],
    [
      'import A from "./A";\nimport B from "Common/Types/B";\nconst c = require("../c");',
      ["1: ./A", "2: Common/Types/B", "3: ../c"],
    ],
  ])("%s", (source: string, expected: Array<string>) => {
    expect(referencesIn(source)).toEqual(expected);
  });

  test("a module named in a string, a comment or a template is no import", () => {
    expect(
      referencesIn(
        [
          "const text = \"import Zod from 'zod'\";",
          '// import Zod from "zod";',
          "/* require('zod') */",
          'const template = `import("zod")`;',
          'const call = load("zod");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reads JSX files too", () => {
    expect(
      referencesIn(
        'import Zod from "zod";\nconst View = () => <div>{String(Zod)}</div>;',
        "View.tsx",
      ),
    ).toEqual(["1: zod"]);
  });

  test("names the package of a subpath", () => {
    expect(packageNameOf("zod")).toBe("zod");
    expect(packageNameOf("zod/v4/core")).toBe("zod");
    expect(packageNameOf("@asteasolutions/zod-to-openapi")).toBe(
      "@asteasolutions/zod-to-openapi",
    );
    expect(packageNameOf("@asteasolutions/zod-to-openapi/dist/index")).toBe(
      "@asteasolutions/zod-to-openapi",
    );
    expect(packageNameOf("zodiac")).toBe("zodiac");
  });
});

describe("the resolver finds files as esbuild does", () => {
  const root: string = standInTree({
    "Common/Types/Email.ts": "",
    "Common/Types/Folder/index.ts": "",
    "Common/Utils/Schema/Zod.ts": "",
    "App/src/Index.tsx": "",
    "App/src/Pages/Home.tsx": "",
    "App/src/Styles/site.css": "",
    "App/src/data.json": "",
    "ee/Dashboard/Index.tsx": "",
  });
  const from: string = path.join(root, "App", "src", "Index.tsx");
  const common: string = path.join(root, "Common");
  const aliases: Record<string, string> = {
    "@oneuptime/ee-dashboard": path.join(root, "ee", "Dashboard", "Index.tsx"),
    "@oneuptime/dashboard": path.join(root, "App", "src"),
  };
  const resolved: (specifier: string) => string | null = (
    specifier: string,
  ): string | null => {
    const resolution: Resolution = resolveSpecifier(
      from,
      specifier,
      common,
      aliases,
    );

    return resolution.unresolved
      ? "unresolved"
      : resolution.file && path.relative(root, resolution.file);
  };

  test("relative paths, with or without an extension, and a directory's index", () => {
    expect(resolved("./Pages/Home")).toBe("App/src/Pages/Home.tsx");
    expect(resolved("./Pages/Home.tsx")).toBe("App/src/Pages/Home.tsx");
    expect(resolved("./Styles/site.css")).toBe("App/src/Styles/site.css");
    expect(resolved("./data.json")).toBe("App/src/data.json");
    expect(resolved("../../Common/Types/Folder")).toBe(
      "Common/Types/Folder/index.ts",
    );
  });

  test("Common/... is Common itself", () => {
    expect(resolved("Common/Types/Email")).toBe("Common/Types/Email.ts");
    expect(resolved("Common/Utils/Schema/Zod")).toBe(
      "Common/Utils/Schema/Zod.ts",
    );
  });

  test("an alias, and a path under it", () => {
    expect(resolved("@oneuptime/ee-dashboard")).toBe("ee/Dashboard/Index.tsx");
    expect(resolved("@oneuptime/dashboard/Pages/Home")).toBe(
      "App/src/Pages/Home.tsx",
    );
  });

  test("a package is no file of the repository", () => {
    expect(resolved("zod")).toBeNull();
    expect(resolved("react")).toBeNull();
    // A name that only starts like an alias is a package of its own.
    expect(resolved("@oneuptime/dashboard-extras")).toBeNull();
    expect(resolved("Commonly")).toBeNull();
  });

  test("code of the repository that names no file is reported, not skipped", () => {
    expect(resolved("./Pages/Missing")).toBe("unresolved");
    expect(resolved("Common/Types/Missing")).toBe("unresolved");
  });
});

describe("the walk, on a stand-in tree", () => {
  const root: string = standInTree({
    "Common/Types/Email.ts": 'import Zod from "../Utils/Schema/Zod";\n',
    "Common/Types/Name.ts": "export default class Name {}\n",
    "Common/Types/OnlyTypes.ts": 'import type { ZodType } from "zod";\n',
    "Common/Utils/Schema/Zod.ts": 'import { object } from "zod";\n',
    "Common/Server/Logger.ts": 'import { z } from "zod";\n',
    "App/src/Index.tsx": [
      'import Page from "./Page";',
      'import type Logger from "Common/Server/Logger";',
      'const lazy = () => import("./Lazy");',
      "",
    ].join("\n"),
    "App/src/Page.tsx": 'import Name from "Common/Types/Name";\n',
    "App/src/Lazy.tsx": 'import Email from "Common/Types/Email";\n',
    "App/src/Unused.tsx": 'import Zod from "zod";\n',
  });
  const result: WalkResult = walk({
    entryPoints: [path.join(root, "App", "src", "Index.tsx")],
    commonDirectory: path.join(root, "Common"),
    schemaDirectory: path.join(root, "Common", "Utils", "Schema"),
    aliases: {},
    root: root,
  });

  test("finds a schema module however far down, through a lazy import, with the imports that led there", () => {
    expect(result.findings.map(describeFinding)).toEqual([
      "App/src/Index.tsx -> App/src/Lazy.tsx -> Common/Types/Email.ts:1 imports ../Utils/Schema/Zod",
    ]);
  });

  test("follows what loads code, not a type-only import, and reads no file the entry does not reach", () => {
    expect([...result.reached].sort()).toEqual([
      "App/src/Index.tsx",
      "App/src/Lazy.tsx",
      "App/src/Page.tsx",
      "Common/Types/Email.ts",
      "Common/Types/Name.ts",
    ]);
  });

  test("a type-only import of zod is a finding all the same", () => {
    const typesOnly: WalkResult = walk({
      entryPoints: [path.join(root, "Common", "Types", "OnlyTypes.ts")],
      commonDirectory: path.join(root, "Common"),
      schemaDirectory: path.join(root, "Common", "Utils", "Schema"),
      aliases: {},
      root: root,
    });

    expect(typesOnly.findings.map(describeFinding)).toEqual([
      "Common/Types/OnlyTypes.ts:1 imports zod",
    ]);
  });

  test("reports an import of the repository's own code that names no file", () => {
    const broken: string = standInTree({
      "src/Index.tsx": 'import Missing from "./Missing";\n',
    });

    expect(
      walk({
        entryPoints: [path.join(broken, "src", "Index.tsx")],
        commonDirectory: path.join(broken, "Common"),
        schemaDirectory: path.join(broken, "Common", "Utils", "Schema"),
        aliases: {},
        root: broken,
      }).unresolved,
    ).toEqual(["src/Index.tsx:1 ./Missing"]);
  });
});

describe("the frontends", () => {
  test("every bundle under packages/App/FeatureSet is walked, from the entry points its esbuild.config.js builds", () => {
    const withConfig: Array<string> = fs
      .readdirSync(FEATURE_SET_DIRECTORY)
      .filter((name: string): boolean => {
        return isFile(
          path.join(FEATURE_SET_DIRECTORY, name, "esbuild.config.js"),
        );
      })
      .sort();

    expect(
      FRONTENDS.map((frontend: Frontend): string => {
        return frontend.name;
      }).sort(),
    ).toEqual(withConfig);

    for (const frontend of FRONTENDS) {
      const config: string = fs.readFileSync(
        path.join(FEATURE_SET_DIRECTORY, frontend.name, "esbuild.config.js"),
        "utf8",
      );

      for (const entryPoint of frontend.entryPoints) {
        expect({
          frontend: frontend.name,
          entryPoint: entryPoint,
          exists: isFile(
            path.join(FEATURE_SET_DIRECTORY, frontend.name, entryPoint),
          ),
        }).toEqual({
          frontend: frontend.name,
          entryPoint: entryPoint,
          exists: true,
        });
      }

      // createConfig's default entry point, or the ones the config names.
      const namesEntries: boolean = config.includes("createConfig({")
        ? frontend.entryPoints.length === 1 &&
          frontend.entryPoints[0] === "src/Index.tsx" &&
          !config.includes("entryPoint:")
        : frontend.entryPoints.every((entryPoint: string): boolean => {
            return config.includes(`${entryPoint}"`);
          });

      expect({ frontend: frontend.name, namesEntries }).toEqual({
        frontend: frontend.name,
        namesEntries: true,
      });

      // The Enterprise plugin, with the specifiers the config gives it.
      for (const specifier of frontend.enterprise
        ? [
            frontend.enterprise.pluginSpecifier,
            frontend.enterprise.internalSpecifier,
            `eeSubdir: "${frontend.enterprise.eeSubdir}"`,
          ]
        : []) {
        expect({
          frontend: frontend.name,
          specifier,
          named: config.includes(specifier),
        }).toEqual({
          frontend: frontend.name,
          specifier,
          named: true,
        });
      }

      expect({
        frontend: frontend.name,
        enterprise: config.includes("resolveEnterpriseBuild("),
      }).toEqual({
        frontend: frontend.name,
        enterprise: frontend.enterprise !== undefined,
      });
    }
  });

  // Each frontend is walked once, whichever test asks first.
  const results: Map<string, WalkResult> = new Map<string, WalkResult>();
  const walkOf: (frontend: Frontend) => WalkResult = (
    frontend: Frontend,
  ): WalkResult => {
    const known: WalkResult | undefined = results.get(frontend.name);

    if (known) {
      return known;
    }

    const result: WalkResult = walk({
      entryPoints: frontend.entryPoints.map((entryPoint: string): string => {
        return path.join(FEATURE_SET_DIRECTORY, frontend.name, entryPoint);
      }),
      commonDirectory: COMMON_DIRECTORY,
      schemaDirectory: SCHEMA_DIRECTORY,
      aliases: aliasesOf(frontend),
      root: REPOSITORY_DIRECTORY,
    });

    results.set(frontend.name, result);

    return result;
  };
  const frontendNamed: (name: string) => Frontend = (
    name: string,
  ): Frontend => {
    return FRONTENDS.find((frontend: Frontend): boolean => {
      return frontend.name === name;
    }) as Frontend;
  };

  for (const frontend of FRONTENDS) {
    test(`${frontend.name} loads no zod, zod-to-openapi or Utils/Schema module: API schemas are built in Utils/Schema, which only the server loads`, () => {
      const result: WalkResult = walkOf(frontend);

      expect(result.unresolved).toEqual([]);
      // Each line runs from an entry point to schema code: move that code into Utils/Schema (TypeSchemas, MonitorSchemas).
      expect(result.findings.map(describeFinding)).toEqual([]);
    });
  }

  test("the walks read the frontends whole: the Dashboard reaches thousands of files, and the Types that built schemas are reached", () => {
    expect(walkOf(frontendNamed("Dashboard")).reached.size).toBeGreaterThan(
      3000,
    );

    const reachedByAny: Set<string> = new Set<string>();

    for (const frontend of FRONTENDS) {
      for (const file of walkOf(frontend).reached) {
        reachedByAny.add(file);
      }
    }

    for (const type of TYPES_THAT_BUILT_SCHEMAS) {
      expect({
        type,
        reached: reachedByAny.has(`packages/Common/${type}`),
      }).toEqual({
        type,
        reached: true,
      });
    }

    // Status pages load the Types too, monitor criteria included.
    const statusPage: WalkResult = walkOf(frontendNamed("StatusPage"));

    expect(statusPage.reached.has("packages/Common/Types/Email.ts")).toBe(true);
    expect(
      statusPage.reached.has("packages/Common/Types/Monitor/CriteriaFilter.ts"),
    ).toBe(true);
  });
});
