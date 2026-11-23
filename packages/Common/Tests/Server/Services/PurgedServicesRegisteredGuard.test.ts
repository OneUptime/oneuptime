import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseService from "../../../Server/Services/BaseService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import OlderRowsPurge from "../../../Server/Utils/Retention/OlderRowsPurge";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY SERVICE THAT ASKS FOR ITS ROWS TO BE PURGED IS IN THE LIST THE
 * PURGE READS (#10792).
 *
 * The daily Workers jobs HardDelete:HardDeleteOlderItemsInDatabase and
 * HardDelete:HardDeleteItemsInDatabase delete only the rows of the services
 * listed in Server/Services/Index.ts. A service that asks for its old rows
 * to be deleted (DatabaseService.hardDeleteItemsOlderThanInDays) - or for
 * its soft-deleted rows to be purged on every installation
 * (purgesSoftDeletedRowsOnEveryInstall) - and is not in that list is never
 * purged at all. A dashboard's and a form's private user sessions (#10275,
 * #10447) were: their base class asked for their expired refresh tokens to
 * go 30 days after they lapse, and nothing ever deleted one.
 *
 * Read from source, through the TypeScript syntax tree, so it sees what
 * the services do not do in a test: a window set only where billing is on,
 * a window a base class sets, and a service nothing imports. Every module
 * under Server/Services whose default export is an instance of a class
 * that asks - itself, or through the classes it extends - must be imported
 * by the list and be in it, or be named in NOT_LISTED with why.
 *
 * And, for the sessions themselves: every table of sign-in sessions - a
 * model with a refresh token that runs out (refreshTokenExpiresAt) - has a
 * service that deletes them by that column, in the list.
 */

// packages/Common/Tests/Server/Services -> packages/Common/Server/Services.
const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

// The list the purge reads, as a module of SERVICES_DIRECTORY.
const REGISTRY_MODULE: string = "Index";

/*
 * Services that ask for a purge and are left out of the list on purpose,
 * and why. The list only shrinks: an entry that is listed now, or no
 * longer asks, fails, so the reason cannot outlive the gap.
 */
const NOT_LISTED: Record<string, string> = {
  LlmLogService:
    "Asks for 3 days where billing is on, but the AI Logs pages still read older rows as history: listing it would empty them on Cloud. Its window is to be decided first (#10828).",
};

// What a class asks of the purge, in its own body.
enum PurgeAsk {
  // this.hardDeleteItemsOlderThanInDays(column, days)
  Window = "a window",
  // this.purgesSoftDeletedRowsOnEveryInstall = true
  SoftDeletedRows = "its soft-deleted rows purged on every install",
}

interface ClassInSource {
  name: string;
  // The class it extends, by the name the module knows it by.
  extendsName: string | null;
  asks: Array<PurgeAsk>;
}

interface ServiceSource {
  // The module, relative to SERVICES_DIRECTORY, without ".ts": "Mcp/OAuth" or "UserSessionService".
  module: string;
  classes: Map<string, ClassInSource>;
  // The class a module exports as its default, by its own name in the module.
  defaultClassName: string | null;
  // The class of the instance the module exports as its default: `export default new Service()`.
  defaultInstanceClassName: string | null;
  // Names imported from a module of SERVICES_DIRECTORY: local name -> [module, imported name or "default"].
  imports: Map<string, { module: string; importedName: string }>;
}

interface PurgeAsker {
  module: string;
  asks: Array<PurgeAsk>;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function isThisMember(node: ts.Node, member: string): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === member
  );
}

// What a class's own body asks of the purge (PurgeAsk).
function asksOf(declaration: ts.ClassDeclaration): Array<PurgeAsk> {
  const asks: Set<PurgeAsk> = new Set();

  visit(declaration, (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isThisMember(node.expression, "hardDeleteItemsOlderThanInDays")
    ) {
      asks.add(PurgeAsk.Window);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isThisMember(node.left, "purgesSoftDeletedRowsOnEveryInstall") &&
      node.right.kind === ts.SyntaxKind.TrueKeyword
    ) {
      asks.add(PurgeAsk.SoftDeletedRows);
    }

    if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "purgesSoftDeletedRowsOnEveryInstall" &&
      node.initializer?.kind === ts.SyntaxKind.TrueKeyword
    ) {
      asks.add(PurgeAsk.SoftDeletedRows);
    }
  });

  return Array.from(asks);
}

// "./UserSessionService" from a module of the folder -> "UserSessionService"; null outside it.
function moduleOfSpecifier(
  fromModule: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const resolved: string = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromModule), specifier),
  );

  return resolved.startsWith("..") ? null : resolved;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier: ts.Modifier): boolean => {
        return modifier.kind === kind;
      }),
  );
}

function readServiceSource(module: string, text: string): ServiceSource {
  const sourceFile: ts.SourceFile = parse(`${module}.ts`, text);
  const source: ServiceSource = {
    module,
    classes: new Map(),
    defaultClassName: null,
    defaultInstanceClassName: null,
    imports: new Map(),
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause
    ) {
      const from: string | null = moduleOfSpecifier(
        module,
        statement.moduleSpecifier.text,
      );

      if (!from) {
        continue;
      }

      if (statement.importClause.name) {
        source.imports.set(statement.importClause.name.text, {
          module: from,
          importedName: "default",
        });
      }

      const bindings: ts.NamedImportBindings | undefined =
        statement.importClause.namedBindings;

      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          source.imports.set(element.name.text, {
            module: from,
            importedName: (element.propertyName || element.name).text,
          });
        }
      }

      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      const heritage: ts.HeritageClause | undefined =
        statement.heritageClauses?.find((clause: ts.HeritageClause) => {
          return clause.token === ts.SyntaxKind.ExtendsKeyword;
        });
      const extended: ts.Expression | undefined =
        heritage?.types[0]?.expression;

      source.classes.set(statement.name.text, {
        name: statement.name.text,
        extendsName:
          extended && ts.isIdentifier(extended) ? extended.text : null,
        asks: asksOf(statement),
      });

      if (
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      ) {
        source.defaultClassName = statement.name.text;
      }

      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const exported: ts.Expression = statement.expression;

      if (
        ts.isNewExpression(exported) &&
        ts.isIdentifier(exported.expression)
      ) {
        source.defaultInstanceClassName = exported.expression.text;
      } else if (ts.isIdentifier(exported)) {
        source.defaultClassName = exported.text;
      }
    }
  }

  return source;
}

/*
 * What a class asks of the purge, itself or through the classes it extends,
 * followed into the modules of the folder it imports them from.
 */
function asksThroughHeritage(
  sources: Map<string, ServiceSource>,
  source: ServiceSource,
  className: string,
  seen: Set<string> = new Set(),
): Array<PurgeAsk> {
  const key: string = `${source.module}#${className}`;

  if (seen.has(key)) {
    return [];
  }

  seen.add(key);

  const declared: ClassInSource | undefined = source.classes.get(className);

  if (!declared) {
    const imported: { module: string; importedName: string } | undefined =
      source.imports.get(className);
    const from: ServiceSource | undefined = imported
      ? sources.get(imported.module)
      : undefined;

    if (!imported || !from) {
      return [];
    }

    const name: string | null =
      imported.importedName === "default"
        ? from.defaultClassName
        : imported.importedName;

    return name ? asksThroughHeritage(sources, from, name, seen) : [];
  }

  const inherited: Array<PurgeAsk> = declared.extendsName
    ? asksThroughHeritage(sources, source, declared.extendsName, seen)
    : [];

  return Array.from(new Set([...declared.asks, ...inherited]));
}

/*
 * Every module whose default export is a service that asks for a purge,
 * and what it asks, by module name.
 */
function findPurgeAskers(
  sources: Map<string, ServiceSource>,
): Array<PurgeAsker> {
  const askers: Array<PurgeAsker> = [];

  for (const source of Array.from(sources.values())) {
    if (!source.defaultInstanceClassName) {
      continue;
    }

    const asks: Array<PurgeAsk> = asksThroughHeritage(
      sources,
      source,
      source.defaultInstanceClassName,
    );

    if (asks.length > 0) {
      askers.push({ module: source.module, asks: asks.sort() });
    }
  }

  return askers.sort((a: PurgeAsker, b: PurgeAsker): number => {
    return a.module.localeCompare(b.module);
  });
}

/*
 * The modules the list the purge reads holds: imported by it, and named in
 * its `services` array.
 */
function readListedModules(registryText: string): Set<string> {
  const sourceFile: ts.SourceFile = parse("Index.ts", registryText);
  const moduleByName: Map<string, string> = new Map();
  const listed: Set<string> = new Set();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.name
    ) {
      const from: string | null = moduleOfSpecifier(
        REGISTRY_MODULE,
        statement.moduleSpecifier.text,
      );

      if (from) {
        moduleByName.set(statement.importClause.name.text, from);
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "services" &&
          declaration.initializer &&
          ts.isArrayLiteralExpression(declaration.initializer)
        ) {
          for (const element of declaration.initializer.elements) {
            const module: string | undefined = ts.isIdentifier(element)
              ? moduleByName.get(element.text)
              : undefined;

            if (module) {
              listed.add(module);
            }
          }
        }
      }
    }
  }

  return listed;
}

// The services that ask for a purge and are not in the list, by module.
function findUnlistedPurgeAskers(data: {
  sources: Map<string, ServiceSource>;
  registryText: string;
}): Array<PurgeAsker> {
  const listed: Set<string> = readListedModules(data.registryText);

  return findPurgeAskers(data.sources).filter((asker: PurgeAsker) => {
    return !listed.has(asker.module);
  });
}

function listServiceModules(directory: string, prefix: string): Array<string> {
  const modules: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      modules.push(
        ...listServiceModules(
          path.join(directory, entry.name),
          `${prefix}${entry.name}/`,
        ),
      );
      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      modules.push(`${prefix}${entry.name.slice(0, -".ts".length)}`);
    }
  }

  return modules;
}

function readSources(): Map<string, ServiceSource> {
  const sources: Map<string, ServiceSource> = new Map();

  for (const module of listServiceModules(SERVICES_DIRECTORY, "")) {
    sources.set(
      module,
      readServiceSource(
        module,
        fs.readFileSync(path.join(SERVICES_DIRECTORY, `${module}.ts`), "utf8"),
      ),
    );
  }

  return sources;
}

const SOURCES: Map<string, ServiceSource> = readSources();
const REGISTRY_TEXT: string = fs.readFileSync(
  path.join(SERVICES_DIRECTORY, `${REGISTRY_MODULE}.ts`),
  "utf8",
);
const ASKERS: Array<PurgeAsker> = findPurgeAskers(SOURCES);

function modulesOf(askers: Array<PurgeAsker>): Array<string> {
  return askers.map((asker: PurgeAsker): string => {
    return asker.module;
  });
}

// The service a module of the folder exports as its default.
function loadService(module: string): unknown {
  return jest.requireActual<{ default: unknown }>(
    path.join(SERVICES_DIRECTORY, module),
  ).default;
}

describe("the services the purge reads", () => {
  test("every service that asks for its rows to be purged is in the list, but those named with why", () => {
    const unlisted: Array<string> = modulesOf(
      findUnlistedPurgeAskers({
        sources: SOURCES,
        registryText: REGISTRY_TEXT,
      }),
    ).filter((module: string): boolean => {
      return !NOT_LISTED[module];
    });

    expect(unlisted).toEqual([]);
  });

  test("a dashboard's and a form's private user sessions are in it, as a status page's are", () => {
    const listed: Set<string> = readListedModules(REGISTRY_TEXT);

    for (const module of [
      "StatusPagePrivateUserSessionService",
      "DashboardPrivateUserSessionService",
      "FormPrivateUserSessionService",
      "UserSessionService",
    ]) {
      expect({ module, isListed: listed.has(module) }).toEqual({
        module,
        isListed: true,
      });
    }
  });

  test("the services named as left out are still left out, and still ask: the list only shrinks", () => {
    const listed: Set<string> = readListedModules(REGISTRY_TEXT);
    const askers: Array<string> = modulesOf(ASKERS);

    for (const module of Object.keys(NOT_LISTED)) {
      expect({
        module,
        isListed: listed.has(module),
        asks: askers.includes(module),
      }).toEqual({ module, isListed: false, asks: true });
    }
  });
});

describe("the sweep sees every way a service asks", () => {
  test("through a base class: each kind of private user session, by PrivateUserSessionServiceBase", () => {
    for (const module of [
      "DashboardPrivateUserSessionService",
      "FormPrivateUserSessionService",
    ]) {
      expect(ASKERS).toContainEqual({ module, asks: [PurgeAsk.Window] });
    }

    // The base class itself is no service: it exports no instance.
    expect(modulesOf(ASKERS)).not.toContain("PrivateUserSessionServiceBase");
  });

  test("a window set only where billing is on, which a test never sees set", () => {
    expect(ASKERS).toContainEqual({
      module: "LlmLogService",
      asks: [PurgeAsk.Window],
    });
  });

  test("soft-deleted rows purged on every install: the discovered devices", () => {
    expect(ASKERS).toContainEqual({
      module: "NetworkEndpointService",
      asks: [PurgeAsk.SoftDeletedRows],
    });
  });

  test("every listed service that asks, as the services are built, is one the sweep found", () => {
    const found: Set<unknown> = new Set(
      modulesOf(ASKERS).map((module: string): unknown => {
        return loadService(module);
      }),
    );

    const askingButNotFound: Array<string> = Services.filter(
      (service: BaseService): boolean => {
        return (
          OlderRowsPurge.isPurged(service) ||
          (service instanceof DatabaseService &&
            service.purgesSoftDeletedRowsOnEveryInstall)
        );
      },
    )
      .filter((service: BaseService): boolean => {
        return !found.has(service);
      })
      .map((service: BaseService): string => {
        return (service as DatabaseService<BaseModel>).getModel().tableName!;
      });

    expect(found.size).toBeGreaterThan(50);
    expect(askingButNotFound).toEqual([]);
  });
});

/*
 * The guard on what it was written for: a session service whose base class
 * asks for a window, left out of the list.
 */
describe("the guard itself", () => {
  const FIXTURES: Record<string, string> = {
    SessionServiceBase: [
      'import DatabaseService from "./DatabaseService";',
      "export default abstract class SessionServiceBase<T> extends DatabaseService<T> {",
      "  public constructor(model: { new (): T }) {",
      "    super(model);",
      '    this.hardDeleteItemsOlderThanInDays("refreshTokenExpiresAt", 30);',
      "  }",
      "}",
    ].join("\n"),
    WidgetPrivateUserSessionService: [
      'import SessionServiceBase from "./SessionServiceBase";',
      'import Model from "../../Models/DatabaseModels/WidgetPrivateUserSession";',
      "export class Service extends SessionServiceBase<Model> {",
      "  public constructor() {",
      "    super(Model);",
      "  }",
      "}",
      "export default new Service();",
    ].join("\n"),
    ReportLogService: [
      'import DatabaseService from "./DatabaseService";',
      'import { IsBillingEnabled } from "../EnvironmentConfig";',
      "export class Service extends DatabaseService<Model> {",
      "  public constructor() {",
      "    super(Model);",
      "    if (IsBillingEnabled) {",
      '      this.hardDeleteItemsOlderThanInDays("createdAt", 3);',
      "    }",
      "  }",
      "}",
      "export default new Service();",
    ].join("\n"),
    WidgetService: [
      'import DatabaseService from "./DatabaseService";',
      "export class Service extends DatabaseService<Model> {",
      "  public constructor() {",
      "    super(Model);",
      "  }",
      "}",
      "export default new Service();",
    ].join("\n"),
    DatabaseService: [
      "class DatabaseService<T> {",
      "  public hardDeleteItemsOlderThanInDays(column: string, days: number): void {}",
      "}",
      "export default DatabaseService;",
    ].join("\n"),
  };

  function fixtureSources(): Map<string, ServiceSource> {
    return new Map(
      Object.entries(FIXTURES).map(
        ([module, text]: [string, string]): [string, ServiceSource] => {
          return [module, readServiceSource(module, text)];
        },
      ),
    );
  }

  function registry(listed: Array<string>, imported: Array<string>): string {
    return [
      ...imported.map((module: string): string => {
        return `import ${module} from "./${module}";`;
      }),
      "const services: Array<BaseService> = [",
      ...listed.map((module: string): string => {
        return `  ${module},`;
      }),
      "];",
      "export default services;",
    ].join("\n");
  }

  test("fails on a session service its base class purges, and on a billing-only window, left out of the list", () => {
    expect(
      modulesOf(
        findUnlistedPurgeAskers({
          sources: fixtureSources(),
          registryText: registry(["WidgetService"], ["WidgetService"]),
        }),
      ),
    ).toEqual(["ReportLogService", "WidgetPrivateUserSessionService"]);
  });

  test("an import alone is not a listing: the service must be in the array", () => {
    expect(
      modulesOf(
        findUnlistedPurgeAskers({
          sources: fixtureSources(),
          registryText: registry(
            ["ReportLogService"],
            ["ReportLogService", "WidgetPrivateUserSessionService"],
          ),
        }),
      ),
    ).toEqual(["WidgetPrivateUserSessionService"]);
  });

  test("passes once both are listed", () => {
    expect(
      findUnlistedPurgeAskers({
        sources: fixtureSources(),
        registryText: registry(
          ["ReportLogService", "WidgetPrivateUserSessionService"],
          ["ReportLogService", "WidgetPrivateUserSessionService"],
        ),
      }),
    ).toEqual([]);
  });

  test("a service that asks nothing is never required, though the class it extends defines how to ask", () => {
    expect(findPurgeAskers(fixtureSources())).toEqual([
      { module: "ReportLogService", asks: [PurgeAsk.Window] },
      { module: "WidgetPrivateUserSessionService", asks: [PurgeAsk.Window] },
    ]);
  });
});

describe("every table of sign-in sessions", () => {
  // The models with a refresh token that runs out: a table of sessions.
  const SESSION_MODELS: Array<string> = (
    AllModelTypes as Array<{ new (): BaseModel; name: string }>
  )
    .filter((modelType: { new (): BaseModel; name: string }): boolean => {
      return new modelType().hasColumn("refreshTokenExpiresAt");
    })
    .map((modelType: { new (): BaseModel; name: string }): string => {
      return new modelType().tableName || modelType.name;
    })
    .sort();

  test("are the four kinds of session: a user's, and a status page's, a dashboard's and a form's private users'", () => {
    expect(SESSION_MODELS).toEqual(
      expect.arrayContaining([
        "DashboardPrivateUserSession",
        "FormPrivateUserSession",
        "StatusPagePrivateUserSession",
        "UserSession",
      ]),
    );
  });

  test.each(SESSION_MODELS)(
    "%s is deleted by its refresh token's expiry, by a service in the list",
    (tableName: string) => {
      const service: unknown = loadService(`${tableName}Service`);

      expect(service).toBeInstanceOf(DatabaseService);

      const sessions: DatabaseService<BaseModel> =
        service as DatabaseService<BaseModel>;

      expect({
        column: sessions.hardDeleteItemByColumnName,
        isPurged: OlderRowsPurge.isPurged(sessions),
        isListed: Services.includes(sessions),
      }).toEqual({
        column: "refreshTokenExpiresAt",
        isPurged: true,
        isListed: true,
      });
      expect(sessions.hardDeleteItemsOlderThanDays).toBe(30);
    },
  );
});
