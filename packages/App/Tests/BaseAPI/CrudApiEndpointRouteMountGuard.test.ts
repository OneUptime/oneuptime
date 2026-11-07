import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "Common/Tests/Helpers/SeededRandom";
import { isInApiReference } from "Common/Utils/ApiReferencePage";
import { isModelInPublicApi } from "Common/Utils/DeveloperDocs/TerraformSchema";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Issue #5803: every model that declares @CrudApiEndpoint has a router that
 * serves its route.
 *
 * The Dashboard calls a model's CRUD route (/api and the model's
 * crudApiPath), and the route answers only once
 * packages/App/FeatureSet/BaseAPI/Index.ts mounts a router built for the
 * model. A model left out there compiles fine and answers 404:
 * VMwareVCenterConnectionTest shipped so on 2026-10-10, and its Test
 * connection button answered "Page not found" for about a month (#5801). The
 * *BaseAPIRegistration tests beside this one pin the models someone thought
 * to pin; this one holds every model.
 *
 * Booting the API feature set and walking Express's router stack pulls in
 * every service and took three minutes on a cold cache, so the mounts are
 * read from the source, as the registration tests read them - but from the
 * syntax tree rather than the text, so that:
 *
 *   - a mount in a comment, or a class a comment names, is no mount;
 *   - names are followed through the imports to the files they come from, so
 *     neither an alias (`import UserSMSAPI from ".../UserSmsAPI"`) nor a
 *     class named for something else (BillingInvoiceAPI.ts declares
 *     `class UserAPI extends BaseAPI<BillingInvoice, ...>`) misleads it;
 *   - a router counts only where app.use() mounts it under /api.
 *
 * A router serves the model it is built for. BaseAPI reads the route from
 * the model its constructor is handed (`new this.entityType()
 * .getCrudApiPath()`), not from its type arguments, so that is the model
 * followed:
 *
 *   - `new BaseAPI<Model, ...>(Model, Service)`, or a class that hands its
 *     own arguments on to BaseAPI, as ArchivableValueAPI and
 *     CustomFieldDefinitionAPI do (`new ArchivableValueAPI<...>(Model, ...)`);
 *   - a class of its own (packages/Common/Server/API, or beside Index.ts)
 *     whose constructor calls `super(Model, Service)`.
 *
 * The models are AllModelTypes', the registry the database and the API
 * Reference read, each with the crudApiPath its decorator set on it however
 * the decorator is written - on one line, or over several
 * (StatusPageSubscriberNotificationTemplateStatusPage).
 */

const APP_DIR: string = path.join(__dirname, "..", "..");
const PACKAGES_DIR: string = path.join(APP_DIR, "..");
const BASE_API_INDEX: string = path.join(
  APP_DIR,
  "FeatureSet",
  "BaseAPI",
  "Index.ts",
);
const MODELS_DIR: string = path.join(
  PACKAGES_DIR,
  "Common",
  "Models",
  "DatabaseModels",
);
const API_DIR: string = path.join(PACKAGES_DIR, "Common", "Server", "API");

// The router every CRUD router is in the end, whatever class it is built as.
const BASE_API: string = path.join(API_DIR, "BaseAPI.ts");

// The decorator that gives a model its route.
const CRUD_API_ENDPOINT: string = path.join(
  PACKAGES_DIR,
  "Common",
  "Types",
  "Database",
  "CrudApiEndpoint.ts",
);

// Where the Dashboard and every API client call a model's route.
const API_PATH: string = "/api";

/*
 * The models that declare a CRUD route BaseAPI/Index.ts does not mount, each
 * with the reason. The guard fails when one of them is mounted after all, or
 * no longer declares a route, so the list cannot go stale; and none of them
 * may be offered in the API Reference, the OpenAPI spec (and so the
 * Terraform provider and the CLI) or the MCP server, which would send people
 * to a route that answers 404.
 */
const UNMOUNTED_CRUD_API_EXCEPTIONS: Readonly<Record<string, string>> = {
  EnterpriseLicense:
    "Served only by OneUptime Cloud's license server: ee/Server/LicenseServer/Index.ts mounts EnterpriseLicenseAPI through the Enterprise module's getApiRouters() when billing is enabled (ee/Tests/Server/LicenseServer/LicenseServerArea.test.ts pins its routes). A self-hosted installation has no license server.",
  EnterpriseLicenseInstance:
    "Served only by OneUptime Cloud's license server, beside EnterpriseLicense: ee/Server/LicenseServer/Index.ts mounts its read, list and delete for the Admin Dashboard's license view when billing is enabled.",
  StatusPagePrivateUserSession:
    "Internal: private status page sign-in, refresh and sign-out keep these sessions through StatusPagePrivateUserSessionService (Identity's StatusPageAuthentication, StatusPageSSO and StatusPageOIDC). Every permission on the table is empty, no client reads it, and it is not documented.",
  UserSession:
    "Internal: sign-in, refresh and sign-out keep these sessions through UserSessionService (Identity's Authentication and the other sign-in routes). A CRUD route would let every master admin, and the instance's master API key, list everyone's sessions with their IP addresses and user agents, and delete sessions without the revocation that records why each one ended. Nothing in OneUptime asks for that, so it is neither mounted nor documented (#5803).",
};

// Source text the tests rewrote, by file. Every other file is read from disk.
type Rewrites = ReadonlyMap<string, string>;

const NO_REWRITES: Rewrites = new Map<string, string>();

// A name a file imports: the file it comes from (null for a package's) and which of its exports.
interface ImportedName {
  file: string | null;
  exportName: string;
}

interface ParsedFile {
  file: string;
  text: string;
  sourceFile: ts.SourceFile;
  imports: Map<string, ImportedName>;
}

const diskTexts: Map<string, string> = new Map<string, string>();
const parsedFiles: Map<string, ParsedFile> = new Map<string, ParsedFile>();
const filesOnDisk: Map<string, boolean> = new Map<string, boolean>();

function readSource(file: string, rewrites: Rewrites): string {
  const rewritten: string | undefined = rewrites.get(file);

  if (rewritten !== undefined) {
    return rewritten;
  }

  let text: string | undefined = diskTexts.get(file);

  if (text === undefined) {
    text = fs.readFileSync(file, "utf8");
    diskTexts.set(file, text);
  }

  return text;
}

function isSourceFile(file: string, rewrites: Rewrites): boolean {
  if (rewrites.has(file)) {
    return true;
  }

  let onDisk: boolean | undefined = filesOnDisk.get(file);

  if (onDisk === undefined) {
    onDisk = fs.existsSync(file);
    filesOnDisk.set(file, onDisk);
  }

  return onDisk;
}

// The file a module specifier names: one of packages/Common, or one beside the importer. Null for a package's.
function resolveModule(
  importer: string,
  specifier: string,
  rewrites: Rewrites,
): string | null {
  let base: string;

  if (specifier.startsWith("Common/")) {
    base = path.join(PACKAGES_DIR, specifier);
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  for (const candidate of [`${base}.ts`, path.join(base, "Index.ts")]) {
    if (isSourceFile(candidate, rewrites)) {
      return candidate;
    }
  }

  return null;
}

function parseFile(file: string, rewrites: Rewrites): ParsedFile {
  const text: string = readSource(file, rewrites);
  const cached: ParsedFile | undefined = parsedFiles.get(file);

  if (cached && cached.text === text) {
    return cached;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: Map<string, ImportedName> = new Map<string, ImportedName>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const from: string | null = resolveModule(
      file,
      statement.moduleSpecifier.text,
      rewrites,
    );
    const clause: ts.ImportClause = statement.importClause;

    if (clause.name) {
      imports.set(clause.name.text, { file: from, exportName: "default" });
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        imports.set(element.name.text, {
          file: from,
          exportName: (element.propertyName ?? element.name).text,
        });
      }
    }
  }

  const parsed: ParsedFile = { file, text, sourceFile, imports };
  parsedFiles.set(file, parsed);

  return parsed;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : []).some(
    (modifier: ts.Modifier): boolean => {
      return modifier.kind === kind;
    },
  );
}

// The class a file declares at its top level by this name.
function localClass(
  parsed: ParsedFile,
  name: string,
): ts.ClassDeclaration | null {
  for (const statement of parsed.sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
  }

  return null;
}

// The class a file exports under this name ("default" for its default export).
function exportedClass(
  parsed: ParsedFile,
  exportName: string,
): ts.ClassDeclaration | null {
  for (const statement of parsed.sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      const isDefault: boolean = hasModifier(
        statement,
        ts.SyntaxKind.DefaultKeyword,
      );

      if (
        exportName === "default"
          ? isDefault
          : !isDefault && statement.name?.text === exportName
      ) {
        return statement;
      }
    }

    // class X ...; export default X;
    if (
      exportName === "default" &&
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      return localClass(parsed, statement.expression.text);
    }

    // class X ...; export { X } / export { X as Y };
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === exportName) {
          return localClass(
            parsed,
            (element.propertyName ?? element.name).text,
          );
        }
      }
    }
  }

  return null;
}

// An argument as code wrote it: the expression, and the file it is written in.
interface Argument {
  parsed: ParsedFile;
  expression: ts.Expression;
}

// The model file an argument names: an identifier imported from a model's own file.
function modelFileOf(argument: Argument | undefined): string | null {
  if (!argument || !ts.isIdentifier(argument.expression)) {
    return null;
  }

  const imported: ImportedName | undefined = argument.parsed.imports.get(
    argument.expression.text,
  );

  if (
    !imported?.file ||
    imported.exportName !== "default" ||
    path.dirname(imported.file) !== MODELS_DIR
  ) {
    return null;
  }

  return imported.file;
}

// The first `super(...)` call in a node.
function superCallIn(node: ts.Node): ts.CallExpression | undefined {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.SuperKeyword
  ) {
    return node;
  }

  return ts.forEachChild(node, superCallIn);
}

// How long a chain of classes the guard follows to BaseAPI, so a cycle cannot hang it.
const LONGEST_CLASS_CHAIN: number = 10;

/*
 * The model file a router built as `new <name>(<args>)` in a file serves -
 * the model BaseAPI is handed in the end - or null when it serves none: a
 * router of its own that extends nothing, or a class the guard cannot follow.
 */
function modelServedBy(
  parsed: ParsedFile,
  name: ts.Expression,
  args: ReadonlyArray<Argument>,
  rewrites: Rewrites,
  depth: number,
): string | null {
  if (!ts.isIdentifier(name) || depth > LONGEST_CLASS_CHAIN) {
    return null;
  }

  const imported: ImportedName | undefined = parsed.imports.get(name.text);

  if (imported?.file === BASE_API && imported.exportName === "default") {
    return modelFileOf(args[0]);
  }

  let classFile: ParsedFile = parsed;
  let declaration: ts.ClassDeclaration | null = null;

  if (imported) {
    if (!imported.file) {
      return null;
    }

    classFile = parseFile(imported.file, rewrites);
    declaration = exportedClass(classFile, imported.exportName);
  } else {
    declaration = localClass(parsed, name.text);
  }

  const base: ts.ExpressionWithTypeArguments | undefined =
    declaration?.heritageClauses?.find((clause: ts.HeritageClause): boolean => {
      return clause.token === ts.SyntaxKind.ExtendsKeyword;
    })?.types[0];

  if (!declaration || !base) {
    return null;
  }

  const constructorDeclaration: ts.ConstructorDeclaration | undefined =
    declaration.members.find(
      (member: ts.ClassElement): member is ts.ConstructorDeclaration => {
        return ts.isConstructorDeclaration(member) && Boolean(member.body);
      },
    );

  // No constructor of its own: the base class's is handed the arguments as they are.
  if (!constructorDeclaration) {
    return modelServedBy(classFile, base.expression, args, rewrites, depth + 1);
  }

  const superCall: ts.CallExpression | undefined = superCallIn(
    constructorDeclaration.body!,
  );

  if (!superCall) {
    return null;
  }

  const parameterNames: Array<string> = constructorDeclaration.parameters.map(
    (parameter: ts.ParameterDeclaration): string => {
      return ts.isIdentifier(parameter.name) ? parameter.name.text : "";
    },
  );

  // An argument the class hands on from its own constructor is the one its caller gave.
  const superArgs: Array<Argument> = superCall.arguments.map(
    (expression: ts.Expression): Argument => {
      const handedOn: number = ts.isIdentifier(expression)
        ? parameterNames.indexOf(expression.text)
        : -1;

      return (
        (handedOn >= 0 ? args[handedOn] : undefined) ?? {
          parsed: classFile,
          expression,
        }
      );
    },
  );

  return modelServedBy(
    classFile,
    base.expression,
    superArgs,
    rewrites,
    depth + 1,
  );
}

// The string constants a file declares (`const APP_NAME: string = "api"`), by name.
function stringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constants: Map<string, string> = new Map<string, string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      !constants.has(node.name.text)
    ) {
      constants.set(node.name.text, node.initializer.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return constants;
}

/*
 * Whether a mount path is /api: "/api", or `/${NAME.toLocaleLowerCase()}`
 * (or toLowerCase) of a constant that is "api" - BaseAPI/Index.ts writes
 * `/${APP_NAME.toLocaleLowerCase()}`.
 */
function isApiPath(
  expression: ts.Expression,
  constants: Map<string, string>,
): boolean {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text === API_PATH;
  }

  if (
    !ts.isTemplateExpression(expression) ||
    expression.head.text !== "/" ||
    expression.templateSpans.length !== 1
  ) {
    return false;
  }

  const span: ts.TemplateSpan = expression.templateSpans[0]!;
  const lowered: ts.Expression = span.expression;

  if (
    span.literal.text !== "" ||
    !ts.isCallExpression(lowered) ||
    lowered.arguments.length !== 0 ||
    !ts.isPropertyAccessExpression(lowered.expression) ||
    !["toLocaleLowerCase", "toLowerCase"].includes(
      lowered.expression.name.text,
    ) ||
    !ts.isIdentifier(lowered.expression.expression)
  ) {
    return false;
  }

  const constant: string | undefined = constants.get(
    lowered.expression.expression.text,
  );

  return constant !== undefined && `/${constant.toLowerCase()}` === API_PATH;
}

// A router BaseAPI/Index.ts mounts for a model.
interface Mount {
  // The app.use(...) call that mounts it.
  call: ts.CallExpression;
  // The router it hands app.use: `new ...(...).getRouter()`.
  router: ts.Expression;
  // The model's file.
  modelFile: string;
}

// The model routers BaseAPI/Index.ts mounts under /api.
function crudMounts(rewrites: Rewrites): Array<Mount> {
  const index: ParsedFile = parseFile(BASE_API_INDEX, rewrites);
  const constants: Map<string, string> = stringConstants(index.sourceFile);
  const mounts: Array<Mount> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "use" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      node.arguments[0] &&
      isApiPath(node.arguments[0], constants)
    ) {
      for (const router of node.arguments.slice(1)) {
        // new X(...).getRouter()
        if (
          ts.isCallExpression(router) &&
          router.arguments.length === 0 &&
          ts.isPropertyAccessExpression(router.expression) &&
          router.expression.name.text === "getRouter" &&
          ts.isNewExpression(router.expression.expression)
        ) {
          const built: ts.NewExpression = router.expression.expression;
          const modelFile: string | null = modelServedBy(
            index,
            built.expression,
            (built.arguments || []).map(
              (expression: ts.Expression): Argument => {
                return { parsed: index, expression };
              },
            ),
            rewrites,
            0,
          );

          if (modelFile) {
            mounts.push({ call: node, router, modelFile });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(index.sourceFile);

  return mounts;
}

// The name of the class a model file exports: AllModelTypes holds that class.
function modelClassName(modelFile: string, rewrites: Rewrites): string {
  const parsed: ParsedFile = parseFile(modelFile, rewrites);

  return (
    exportedClass(parsed, "default")?.name?.text ?? path.basename(modelFile)
  );
}

function mountedModelNames(rewrites: Rewrites): Set<string> {
  return new Set<string>(
    crudMounts(rewrites).map((mount: Mount): string => {
      return modelClassName(mount.modelFile, rewrites);
    }),
  );
}

// A model with a CRUD route, as the API reads it.
interface CrudModel {
  name: string;
  route: string;
  modelType: DatabaseBaseModelType;
  model: BaseModel;
}

const CRUD_MODELS: Array<CrudModel> = [];

for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
  const model: BaseModel = new modelType();

  if (model.crudApiPath) {
    CRUD_MODELS.push({
      name: modelType.name,
      route: model.crudApiPath.toString(),
      modelType,
      model,
    });
  }
}

function isException(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    UNMOUNTED_CRUD_API_EXCEPTIONS,
    name,
  );
}

// The models with a CRUD route no router in BaseAPI/Index.ts serves, but for the exceptions.
function unmountedCrudModels(rewrites: Rewrites = NO_REWRITES): Array<string> {
  const mounted: Set<string> = mountedModelNames(rewrites);

  return CRUD_MODELS.filter((crudModel: CrudModel): boolean => {
    return !mounted.has(crudModel.name) && !isException(crudModel.name);
  })
    .map((crudModel: CrudModel): string => {
      return crudModel.name;
    })
    .sort();
}

// The exceptions that no longer hold: models with no CRUD route, or mounted after all.
function staleExceptions(rewrites: Rewrites = NO_REWRITES): Array<string> {
  const mounted: Set<string> = mountedModelNames(rewrites);
  const stale: Array<string> = [];

  for (const name of Object.keys(UNMOUNTED_CRUD_API_EXCEPTIONS).sort()) {
    if (
      !CRUD_MODELS.some((crudModel: CrudModel): boolean => {
        return crudModel.name === name;
      })
    ) {
      stale.push(
        `${name} is no model with a CRUD route any more: take it off UNMOUNTED_CRUD_API_EXCEPTIONS`,
      );
    } else if (mounted.has(name)) {
      stale.push(
        `${name} is mounted in BaseAPI/Index.ts now: take it off UNMOUNTED_CRUD_API_EXCEPTIONS`,
      );
    }
  }

  return stale;
}

/*
 * The classes the model files declare with @CrudApiEndpoint, read from their
 * syntax tree: the decorator is a call of the name the file imports from
 * Types/Database/CrudApiEndpoint, however it is written or named.
 */
function classesDeclaringCrudRoutes(rewrites: Rewrites): Array<string> {
  const classes: Array<string> = [];

  for (const entry of fs.readdirSync(MODELS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) {
      continue;
    }

    const parsed: ParsedFile = parseFile(
      path.join(MODELS_DIR, entry.name),
      rewrites,
    );

    for (const statement of parsed.sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) {
        continue;
      }

      const declaresRoute: boolean = (ts.getDecorators(statement) || []).some(
        (decorator: ts.Decorator): boolean => {
          const call: ts.Expression = decorator.expression;

          return (
            ts.isCallExpression(call) &&
            ts.isIdentifier(call.expression) &&
            parsed.imports.get(call.expression.text)?.file === CRUD_API_ENDPOINT
          );
        },
      );

      if (declaresRoute) {
        classes.push(statement.name.text);
      }
    }
  }

  return classes.sort();
}

describe("CrudApiEndpoint route mount guard (#5803)", () => {
  test("every model declaring @CrudApiEndpoint is mounted in BaseAPI/Index.ts", () => {
    const unmounted: Array<string> = unmountedCrudModels().map(
      (name: string): string => {
        const route: string | undefined = CRUD_MODELS.find(
          (crudModel: CrudModel): boolean => {
            return crudModel.name === name;
          },
        )?.route;

        return `${name}: ${API_PATH}${route} answers 404 - mount app.use(\`/\${APP_NAME.toLocaleLowerCase()}\`, new BaseAPI<${name}, ...>(${name}, ...).getRouter()) (or a class extending BaseAPI for it) in packages/App/FeatureSet/BaseAPI/Index.ts, or add ${name} to UNMOUNTED_CRUD_API_EXCEPTIONS with the reason`;
      },
    );

    expect(unmounted).toEqual([]);
  });

  test("the guard catches an unmounted model when a mount is missing", () => {
    const realBaseApi: string = fs.readFileSync(BASE_API_INDEX, "utf8");

    // Simulate removing VMwareVCenterConnectionTest mount
    const mutatedBaseApi: string = realBaseApi.replace(
      /new\s+BaseAPI<\s*VMwareVCenterConnectionTest[\s\S]*?\.getRouter\(\),?/,
      "",
    );

    const unmounted: Array<string> = unmountedCrudModels(
      new Map<string, string>([[BASE_API_INDEX, mutatedBaseApi]]),
    );

    expect(unmounted).toContain("VMwareVCenterConnectionTest");
  });

  test("it reads every model with a route, and every mount it follows ends at one", () => {
    // 571 on 2026-11-07: all but the four exceptions mounted.
    expect(CRUD_MODELS.length).toBeGreaterThan(500);

    const names: Set<string> = new Set<string>(
      CRUD_MODELS.map((crudModel: CrudModel): string => {
        return crudModel.name;
      }),
    );

    expect(
      [...mountedModelNames(NO_REWRITES)].filter((name: string): boolean => {
        return !names.has(name);
      }),
    ).toEqual([]);
  });

  test("every exception is a model with a route that BaseAPI/Index.ts does not mount", () => {
    expect(staleExceptions()).toEqual([]);
  });

  test("every exception gives its reason", () => {
    for (const reason of Object.values(UNMOUNTED_CRUD_API_EXCEPTIONS)) {
      expect(reason.trim().length).toBeGreaterThan(40);
    }
  });

  test("a model with no router is offered nowhere: not the API Reference, the OpenAPI spec, Terraform, the CLI or MCP", () => {
    const mounted: Set<string> = mountedModelNames(NO_REWRITES);
    const offered: Array<string> = [];

    for (const crudModel of CRUD_MODELS) {
      if (mounted.has(crudModel.name)) {
        continue;
      }

      const where: Array<string> = [];

      if (
        isInApiReference(crudModel.model, { isBillingEnabled: false }) ||
        isInApiReference(crudModel.model, { isBillingEnabled: true })
      ) {
        where.push("the API Reference");
      }

      // The OpenAPI spec, and so the Terraform provider and the CLI, which are built from it.
      if (isModelInPublicApi(crudModel.modelType)) {
        where.push("the OpenAPI spec");
      }

      if (crudModel.model.enableMCP) {
        where.push("the MCP server");
      }

      if (where.length > 0) {
        offered.push(`${crudModel.name}: ${where.join(", ")}`);
      }
    }

    expect(offered).toEqual([]);
  });

  test("UserSession, which no router serves, has no page in the API Reference and no path in the OpenAPI spec (#5803)", () => {
    const userSession: CrudModel | undefined = CRUD_MODELS.find(
      (crudModel: CrudModel): boolean => {
        return crudModel.name === "UserSession";
      },
    );

    expect(userSession?.route).toBe("/user-session");
    expect(userSession?.model.enableDocumentation).toBeFalsy();
    expect(
      isInApiReference(userSession!.model, { isBillingEnabled: false }),
    ).toBe(false);
    expect(isModelInPublicApi(userSession!.modelType)).toBe(false);
  });

  test("every model file that declares @CrudApiEndpoint is in AllModelTypes, whose models the API serves", () => {
    const declared: Array<string> = classesDeclaringCrudRoutes(NO_REWRITES);
    const registered: Set<string> = new Set<string>(
      CRUD_MODELS.map((crudModel: CrudModel): string => {
        return crudModel.name;
      }),
    );

    expect(
      declared.filter((name: string): boolean => {
        return !registered.has(name);
      }),
    ).toEqual([]);
    expect(declared).toHaveLength(CRUD_MODELS.length);
    // A decorator written over three lines is read like any other.
    expect(declared).toContain(
      "StatusPageSubscriberNotificationTemplateStatusPage",
    );
  });

  test("no two models declare one route: the router mounted second would never answer", () => {
    const owners: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const crudModel of CRUD_MODELS) {
      owners.set(crudModel.route, [
        ...(owners.get(crudModel.route) || []),
        crudModel.name,
      ]);
    }

    expect(
      [...owners.entries()]
        .filter((entry: [string, Array<string>]): boolean => {
          return entry[1].length > 1;
        })
        .map((entry: [string, Array<string>]): string => {
          return `${entry[0]}: ${entry[1].join(", ")}`;
        }),
    ).toEqual([]);
  });
});

/*
 * MUTATIONS: the guard fails when a mount goes, however it goes. Each takes a
 * mount out of a copy of the real source - or turns it into something that
 * only looks like one - and expects the guard to name exactly that model.
 */

const INDEX_SOURCE: string = fs.readFileSync(BASE_API_INDEX, "utf8");

function withIndex(text: string): Rewrites {
  return new Map<string, string>([[BASE_API_INDEX, text]]);
}

// The one app.use(...) statement of BaseAPI/Index.ts that mounts this model.
function mountOf(modelName: string): Mount {
  const mounts: Array<Mount> = crudMounts(NO_REWRITES).filter(
    (mount: Mount): boolean => {
      return modelClassName(mount.modelFile, NO_REWRITES) === modelName;
    },
  );

  expect(mounts).toHaveLength(1);
  expect(ts.isExpressionStatement(mounts[0]!.call.parent)).toBe(true);

  return mounts[0]!;
}

function replaceNode(text: string, node: ts.Node, replacement: string): string {
  return (
    text.slice(0, node.getStart()) + replacement + text.slice(node.getEnd())
  );
}

type Mutation = (mount: Mount) => string;

const MUTATIONS: Record<string, Mutation> = {
  "taken out": (mount: Mount): string => {
    return replaceNode(INDEX_SOURCE, mount.call.parent, "");
  },
  "commented out line by line": (mount: Mount): string => {
    return replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      mount.call.parent
        .getText()
        .split("\n")
        .map((line: string): string => {
          return `// ${line}`;
        })
        .join("\n"),
    );
  },
  "commented out as a block": (mount: Mount): string => {
    return replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      `/* ${mount.call.parent.getText()} */`,
    );
  },
  "built but never handed to app.use": (mount: Mount): string => {
    return replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      `void ${mount.router.getText()};`,
    );
  },
  "mounted at the root instead of /api": (mount: Mount): string => {
    return replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      `app.use(${mount.router.getText()});`,
    );
  },
  "mounted under another path": (mount: Mount): string => {
    return replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      `app.use("/apis", ${mount.router.getText()});`,
    );
  },
};

describe("the guard names a model whose mount goes (mutation checks)", () => {
  test.each(Object.keys(MUTATIONS))(
    "VMwareVCenterConnectionTest, the model #5801 mounted, %s",
    (mutation: string) => {
      const mount: Mount = mountOf("VMwareVCenterConnectionTest");

      expect(
        unmountedCrudModels(withIndex(MUTATIONS[mutation]!(mount))),
      ).toEqual(["VMwareVCenterConnectionTest"]);
    },
  );

  test.each([
    ["AlertState", "new ArchivableValueAPI<AlertState, ...>(AlertState, ...)"],
    [
      "InventoryItemCustomField",
      "new CustomFieldDefinitionAPI<InventoryItemCustomField, ...>(...)",
    ],
    ["BillingInvoice", "new BillingInvoiceAPI(), whose class is named UserAPI"],
    ["UserSMS", "new UserSMSAPI(), imported from UserSmsAPI.ts"],
    ["File", "new FileAPI(), beside a comment naming CustomFieldFileAPI"],
    [
      "IncidentVideoCall",
      "new IncidentVideoCallAPI(), below a comment naming IncidentVideoCallAPI",
    ],
    [
      "StatusPageSubscriberNotificationTemplateStatusPage",
      "new BaseAPI<...>(...) for a model whose decorator spans three lines",
    ],
  ])("%s, mounted as %s, taken out", (modelName: string) => {
    const mount: Mount = mountOf(modelName);

    expect(
      unmountedCrudModels(withIndex(MUTATIONS["taken out"]!(mount))),
    ).toEqual([modelName]);
  });

  test("BillingInvoice, when BillingInvoiceAPI.ts's class extends nothing", () => {
    const file: string = path.join(API_DIR, "BillingInvoiceAPI.ts");
    const parsed: ParsedFile = parseFile(file, NO_REWRITES);
    const declaration: ts.ClassDeclaration = exportedClass(parsed, "default")!;
    const extendsClause: ts.HeritageClause = declaration.heritageClauses![0]!;

    expect(declaration.name?.text).toBe("UserAPI");
    expect(
      unmountedCrudModels(
        new Map<string, string>([
          [file, replaceNode(parsed.text, extendsClause, "")],
        ]),
      ),
    ).toEqual(["BillingInvoice"]);
  });

  test("BillingInvoice, when BillingInvoiceAPI.ts hands BaseAPI another model", () => {
    const file: string = path.join(API_DIR, "BillingInvoiceAPI.ts");
    const parsed: ParsedFile = parseFile(file, NO_REWRITES);
    const declaration: ts.ClassDeclaration = exportedClass(parsed, "default")!;
    const superCall: ts.CallExpression = superCallIn(declaration)!;

    expect(superCall.arguments[0]!.getText()).toBe("BillingInvoice");
    // The file imports Project too; its type arguments still say BillingInvoice.
    expect(
      unmountedCrudModels(
        new Map<string, string>([
          [file, replaceNode(parsed.text, superCall.arguments[0]!, "Project")],
        ]),
      ),
    ).toEqual(["BillingInvoice"]);
  });

  test("an exception that gets mounted is stale, and the guard says so", () => {
    const mount: Mount = mountOf("VMwareVCenterConnectionTest");
    const mountsUserSession: string = replaceNode(
      INDEX_SOURCE,
      mount.call.parent,
      `${mount.call.parent.getText()}\napp.use(\`/\${APP_NAME.toLocaleLowerCase()}\`, new BaseAPI<UserSession, UserSessionServiceType>(UserSession, UserSessionService).getRouter());`,
    );

    expect(
      staleExceptions(
        withIndex(
          `import UserSession from "Common/Models/DatabaseModels/UserSession";\n${mountsUserSession}`,
        ),
      ),
    ).toEqual([
      "UserSession is mounted in BaseAPI/Index.ts now: take it off UNMOUNTED_CRUD_API_EXCEPTIONS",
    ]);
  });

  test("a model file the registry does not hold is named", () => {
    const file: string = path.join(
      MODELS_DIR,
      "VMwareVCenterConnectionTest.ts",
    );
    const renamed: string = readSource(file, NO_REWRITES).replace(
      /class VMwareVCenterConnectionTest\b/,
      "class VMwareVCenterConnectionTestUnregistered",
    );

    expect(
      classesDeclaringCrudRoutes(new Map<string, string>([[file, renamed]])),
    ).toContain("VMwareVCenterConnectionTestUnregistered");
  });

  test("forty mounts drawn at random, each taken out alone, are each named alone", () => {
    const mounts: Array<Mount> = crudMounts(NO_REWRITES);
    const timesMounted: Map<string, number> = new Map<string, number>();

    for (const mount of mounts) {
      const name: string = modelClassName(mount.modelFile, NO_REWRITES);
      timesMounted.set(name, (timesMounted.get(name) || 0) + 1);
    }

    // A model mounted twice (IoTDevice, Dashboard, ...) stays served when one mount goes.
    const mountedOnce: Array<Mount> = mounts.filter((mount: Mount): boolean => {
      return (
        timesMounted.get(modelClassName(mount.modelFile, NO_REWRITES)) === 1 &&
        ts.isExpressionStatement(mount.call.parent)
      );
    });

    expect(mountedOnce.length).toBeGreaterThan(500);

    const random: SeededRandom = seededRandom(5803);

    for (const mount of shuffled(mountedOnce, random).slice(0, 40)) {
      expect(
        unmountedCrudModels(withIndex(MUTATIONS["taken out"]!(mount))),
      ).toEqual([modelClassName(mount.modelFile, NO_REWRITES)]);
    }
  });
});

describe("how the guard follows a router to its model", () => {
  const head: string = [
    'import BaseAPI from "Common/Server/API/BaseAPI";',
    'import ArchivableValueAPI from "Common/Server/API/ArchivableValueAPI";',
    'import Monitor from "Common/Models/DatabaseModels/Monitor";',
    'import MonitorService from "Common/Server/Services/MonitorService";',
    'import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";',
    'import MonitorStatusService from "Common/Server/Services/MonitorStatusService";',
    'import ProbeAPI from "Common/Server/API/ProbeAPI";',
    'const APP_NAME: string = "api";',
  ].join("\n");

  function modelsMountedBy(body: string): Array<string> {
    return crudMounts(withIndex(`${head}\n${body}\n`))
      .map((mount: Mount): string => {
        return modelClassName(mount.modelFile, NO_REWRITES);
      })
      .sort();
  }

  test("the model is the constructor's first argument, and the path /api however written", () => {
    expect(
      modelsMountedBy(
        [
          'app.use("/api", new BaseAPI<Monitor, any>(Monitor, MonitorService).getRouter());',
          "app.use(`/${APP_NAME.toLowerCase()}`, new ArchivableValueAPI<MonitorStatus, any>(MonitorStatus, MonitorStatusService).getRouter());",
          "app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ProbeAPI().getRouter());",
        ].join("\n"),
      ),
    ).toEqual(["Monitor", "MonitorStatus", "Probe"]);
  });

  test("a class without a constructor of its own serves what its caller hands it", () => {
    expect(
      modelsMountedBy(
        [
          "class MonitorRouter extends BaseAPI<Monitor, any> {}",
          'app.use("/api", new MonitorRouter(Monitor, MonitorService).getRouter());',
        ].join("\n"),
      ),
    ).toEqual(["Monitor"]);
  });

  test("a class that extends another class of its own is followed down to BaseAPI", () => {
    expect(
      modelsMountedBy(
        [
          "class StatusRouter<T, S> extends ArchivableValueAPI<T, S> {",
          "  public constructor(type: any, service: any) {",
          "    super(type, service);",
          "  }",
          "}",
          "class MonitorStatusRouter extends StatusRouter<MonitorStatus, any> {",
          "  public constructor() {",
          "    super(MonitorStatus, MonitorStatusService);",
          "  }",
          "}",
          'app.use("/api", new MonitorStatusRouter().getRouter());',
        ].join("\n"),
      ),
    ).toEqual(["MonitorStatus"]);
  });

  test("names in comments, strings and types are no mounts", () => {
    expect(
      modelsMountedBy(
        [
          '// app.use("/api", new BaseAPI<Monitor, any>(Monitor, MonitorService).getRouter());',
          '/* app.use("/api", new BaseAPI<MonitorStatus, any>(MonitorStatus, MonitorStatusService).getRouter()); */',
          "const text: string = 'app.use(\"/api\", new BaseAPI<Monitor, any>(Monitor, MonitorService).getRouter())';",
          "type Router = BaseAPI<Monitor, any>;",
          'app.use("/api", text as any);',
          'app.use("/api", new ProbeAPI().getRouter());',
        ].join("\n"),
      ),
    ).toEqual(["Probe"]);
  });

  test("a router module, a class that extends nothing, or BaseAPI handed no model first, serves none", () => {
    expect(
      modelsMountedBy(
        [
          "class PlainRouter {",
          "  public getRouter(): any {",
          "    return null;",
          "  }",
          "}",
          'app.use("/api", new PlainRouter().getRouter());',
          'app.use("/api", ProbeAPI);',
          'app.use("/api", new BaseAPI<Monitor, any>(MonitorService as any, Monitor).getRouter());',
          'app.use("/api", new BaseAPI<MonitorStatus, any>(MonitorStatus, MonitorStatusService).getRouter());',
        ].join("\n"),
      ),
    ).toEqual(["MonitorStatus"]);
  });
});
