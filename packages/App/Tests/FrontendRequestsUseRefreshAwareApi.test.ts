import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every browser request to our backend goes through the refresh-aware client.
 *
 * The access-token cookie lives exactly as long as the 15-minute JWT inside
 * it, so a Dashboard left open past that sends its next request with no
 * access token at all. The server answers 401, and the UI client
 * (Common/UI/Utils/API/API, class BaseAPI) answers that by refreshing the
 * session once and replaying the request - the user never notices.
 *
 * The core client underneath it (Common/Utils/API) cannot do that. Its
 * tryRefreshAuth returns false and its handleError does nothing, because it
 * is also the server's HTTP client and has no session to refresh. A page that
 * imports it directly therefore works for fifteen minutes and then fails -
 * which is how "Send setup reminder" came to answer a customer with "You are
 * not authorized to access this project's data." after they left a tab open.
 * The same happens to a raw fetch(), axios or XMLHttpRequest call: none of
 * them know the session can be refreshed.
 *
 * Nothing about either mistake shows up in a type check or a quick manual
 * test, because both work perfectly with a fresh session. This guard is what
 * catches them: it reads every browser module and names the file and line.
 */

const APP_DIR: string = path.join(__dirname, "..");
const PACKAGES_DIR: string = path.join(APP_DIR, "..");
const COMMON_DIR: string = path.join(PACKAGES_DIR, "Common");

/* The core client: no session, so no refresh. */
const BARE_CLIENT: string = path.join(COMMON_DIR, "Utils", "API.ts");

/*
 * Browser code only. src/Server under StatusPage and PublicDashboard is the
 * node side that renders those pages, where the core client is correct.
 */
const BROWSER_SOURCE_ROOTS: Array<string> = [
  path.join(APP_DIR, "FeatureSet", "Dashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "Accounts", "src"),
  path.join(APP_DIR, "FeatureSet", "StatusPage", "src"),
  path.join(APP_DIR, "FeatureSet", "PublicDashboard", "src"),
  path.join(COMMON_DIR, "UI"),
];

interface AllowlistEntry {
  file: string;
  reason: string;
}

/*
 * Browser modules that may hold the core client as a value. Every entry needs
 * a reason a reviewer would accept, and each is checked below both to exist
 * and to still need the exception, so this list cannot quietly outlive its
 * reasons.
 *
 * Type-only references (`import type`, or named imports of the interfaces the
 * core module exports, such as RequestOptions and AuthRetryContext) are not
 * listed: they carry no client, and the detector already lets them through.
 * Common/UI/Utils/API/RequestOptions.ts is the live example, pinned by its own
 * test below.
 */
const BARE_CLIENT_ALLOWLIST: Array<AllowlistEntry> = [
  {
    file: "Common/UI/Utils/API/API.ts",
    reason:
      "It IS the refresh-aware client: BaseAPI extends the core class and adds the refresh.",
  },
  {
    file: "Common/UI/Utils/GlobalConfig.ts",
    reason:
      "GET /api/global-config/vars is anonymous by design and loads before any session exists, so there is nothing to refresh.",
  },
  {
    file: "App/FeatureSet/StatusPage/src/Utils/User.ts",
    reason:
      "Logout is called from handleError; going through the status page client would recurse into handleError on a failed logout.",
  },
];

/*
 * Browser modules that may open a request without any client. The same two
 * checks apply.
 */
const RAW_TRANSPORT_ALLOWLIST: Array<AllowlistEntry> = [
  {
    file: "App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayer.tsx",
    reason:
      "Recording chunks are application/octet-stream, which the JSON client cannot return, and the watch-time heartbeat needs fetch keepalive to survive pagehide. The player refreshes through API.refreshSession() on a 401 itself.",
  },
];

/* Globals that send a request carrying the session cookie. */
const RAW_TRANSPORT_GLOBALS: ReadonlySet<string> = new Set<string>([
  "fetch",
  "XMLHttpRequest",
  "EventSource",
]);

/* Receivers through which those globals are reachable by property access. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set<string>([
  "window",
  "globalThis",
  "self",
]);

/*
 * Every finding below spells one of these words, so a module without any of
 * them needs no parse.
 */
const RAW_TRANSPORT_HINT: RegExp =
  /fetch|XMLHttpRequest|EventSource|sendBeacon|axios/;

interface Finding {
  line: number;
  description: string;
}

function toPackagesPath(filePath: string): string {
  return path.relative(PACKAGES_DIR, filePath).split(path.sep).join("/");
}

function fromPackagesPath(packagesPath: string): string {
  return path.join(PACKAGES_DIR, ...packagesPath.split("/"));
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "__mocks__" ||
        (entry.name === "Server" && path.basename(directory) === "src")
      ) {
        continue;
      }
      found.push(...listSourceFiles(full));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}

/*
 * Both scans below walk the same few thousand modules; parse each once. Keyed
 * by path and checked against the text, so a fixture can never be answered
 * with a stale tree.
 */
const parsedSources: Map<string, { source: string; tree: ts.SourceFile }> =
  new Map<string, { source: string; tree: ts.SourceFile }>();

function parse(filePath: string, source: string): ts.SourceFile {
  const cached: { source: string; tree: ts.SourceFile } | undefined =
    parsedSources.get(filePath);

  if (cached && cached.source === source) {
    return cached.tree;
  }

  const tree: ts.SourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  parsedSources.set(filePath, { source: source, tree: tree });

  return tree;
}

/*
 * Resolve a specifier the way the feature-set bundles do: "Common/*" is the
 * Common package, relative paths try .ts, .tsx and /index. Anything else is a
 * node module and never the core client.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;

  if (specifier.startsWith("Common/")) {
    base = path.join(COMMON_DIR, specifier.slice("Common/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/*
 * The core client is Common/Utils/API.ts, so any specifier that reaches it
 * ends in "API". Checking that first keeps the scan from touching the disk
 * for every one of the thousands of other imports.
 */
function mightNameBareClient(specifier: string): boolean {
  const lastSegment: string = specifier.split("/").pop() || "";

  return lastSegment === "API" || lastSegment === "API.ts";
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/* `import(x)`, `require(x)` and jest's require helpers: the whole module. */
function getDynamicModuleSpecifier(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) {
    return null;
  }

  const isModuleLoader: boolean =
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
    (ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "jest" &&
      (node.expression.name.text === "requireActual" ||
        node.expression.name.text === "requireMock"));

  const firstArgument: ts.Expression | undefined = node.arguments[0];

  if (
    !isModuleLoader ||
    !firstArgument ||
    !ts.isStringLiteralLike(firstArgument)
  ) {
    return null;
  }

  return firstArgument.text;
}

function importsDefaultAsValue(importClause: ts.ImportClause): boolean {
  if (importClause.isTypeOnly) {
    return false;
  }

  if (importClause.name) {
    return true;
  }

  const bindings: ts.NamedImportBindings | undefined =
    importClause.namedBindings;

  if (!bindings) {
    return false;
  }

  /* `import * as Core` hands over Core.default, the class itself. */
  if (ts.isNamespaceImport(bindings)) {
    return true;
  }

  return bindings.elements.some((element: ts.ImportSpecifier): boolean => {
    return (
      !element.isTypeOnly &&
      (element.propertyName ?? element.name).text === "default"
    );
  });
}

function exportsDefaultAsValue(declaration: ts.ExportDeclaration): boolean {
  if (declaration.isTypeOnly || !declaration.exportClause) {
    /* `export * from` never re-exports a default. */
    return false;
  }

  if (ts.isNamespaceExport(declaration.exportClause)) {
    return true;
  }

  return declaration.exportClause.elements.some(
    (element: ts.ExportSpecifier): boolean => {
      return (
        !element.isTypeOnly &&
        (element.propertyName ?? element.name).text === "default"
      );
    },
  );
}

/*
 * Every place a module gets hold of the core client class. Parsed rather than
 * grepped so a comment or a code sample quoting the import cannot trip it,
 * and so `import type` and named imports of the core module's interfaces
 * pass: those carry no client.
 */
function findBareClientValueImports(
  filePath: string,
  source: string,
): Array<Finding> {
  /*
   * Cheap exit first: this runs over every browser module, and one that never
   * spells "API" cannot be importing Common/Utils/API.
   */
  if (!source.includes("API")) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(filePath, source);
  const findings: Array<Finding> = [];

  const isBareClient: (specifier: string) => boolean = (
    specifier: string,
  ): boolean => {
    return (
      mightNameBareClient(specifier) &&
      resolveSpecifier(filePath, specifier) === BARE_CLIENT
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isBareClient(node.moduleSpecifier.text) &&
      node.importClause &&
      importsDefaultAsValue(node.importClause)
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `imports the core client from "${node.moduleSpecifier.text}"`,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isBareClient(node.moduleSpecifier.text) &&
      exportsDefaultAsValue(node)
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `re-exports the core client from "${node.moduleSpecifier.text}"`,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression) &&
      isBareClient(node.moduleReference.expression.text)
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `requires the core client from "${node.moduleReference.expression.text}"`,
      });
    } else {
      const dynamicSpecifier: string | null = getDynamicModuleSpecifier(node);

      if (dynamicSpecifier !== null && isBareClient(dynamicSpecifier)) {
        findings.push({
          line: lineOf(sourceFile, node),
          description: `loads the core client from "${dynamicSpecifier}"`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}

/* Any reference to the core module at all, types included. */
function referencesBareClient(filePath: string, source: string): boolean {
  const sourceFile: ts.SourceFile = parse(filePath, source);

  return sourceFile.statements.some((statement: ts.Statement): boolean => {
    if (
      !ts.isImportDeclaration(statement) &&
      !ts.isExportDeclaration(statement)
    ) {
      return false;
    }

    const specifier: ts.Expression | undefined = statement.moduleSpecifier;

    return (
      specifier !== undefined &&
      ts.isStringLiteralLike(specifier) &&
      resolveSpecifier(filePath, specifier.text) === BARE_CLIENT
    );
  });
}

function collectBindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNames(element.name, into);
    }
  }
}

function namesDeclaredByStatements(
  statements: ts.NodeArray<ts.Statement>,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause: ts.ImportClause = statement.importClause;

      if (clause.name) {
        names.add(clause.name.text);
      }

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            names.add(element.name.text);
          }
        }
      }
    }
  }

  return names;
}

function namesDeclaredByScope(scope: ts.Node): Set<string> {
  if (
    ts.isSourceFile(scope) ||
    ts.isBlock(scope) ||
    ts.isModuleBlock(scope) ||
    ts.isCaseClause(scope) ||
    ts.isDefaultClause(scope)
  ) {
    return namesDeclaredByStatements(scope.statements);
  }

  const names: Set<string> = new Set<string>();

  if (ts.isFunctionLike(scope)) {
    for (const parameter of scope.parameters) {
      collectBindingNames(parameter.name, names);
    }

    if (ts.isFunctionExpression(scope) && scope.name) {
      names.add(scope.name.text);
    }
  } else if (
    (ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)) &&
    scope.initializer &&
    ts.isVariableDeclarationList(scope.initializer)
  ) {
    for (const declaration of scope.initializer.declarations) {
      collectBindingNames(declaration.name, names);
    }
  } else if (ts.isCatchClause(scope) && scope.variableDeclaration) {
    collectBindingNames(scope.variableDeclaration.name, names);
  }

  return names;
}

/*
 * `const fetch = async () => {...}; void fetch();` is a local loader, not the
 * global - ExceptionsNavTabs does exactly that. Walk the enclosing scopes and
 * only report the global when nothing between here and the file declares it.
 */
function isDeclaredInEnclosingScope(node: ts.Node, name: string): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (namesDeclaredByScope(current).has(name)) {
      return true;
    }
    current = current.parent;
  }

  return false;
}

function isAxios(specifier: string): boolean {
  return specifier === "axios" || specifier.startsWith("axios/");
}

/*
 * FilePicker imports AxiosProgressEvent as a type; that sends nothing. Only a
 * binding that exists at runtime can make a request.
 */
function importsAnyValue(importClause: ts.ImportClause): boolean {
  if (importClause.isTypeOnly) {
    return false;
  }

  if (importClause.name) {
    return true;
  }

  const bindings: ts.NamedImportBindings | undefined =
    importClause.namedBindings;

  if (!bindings) {
    return false;
  }

  if (ts.isNamespaceImport(bindings)) {
    return true;
  }

  return bindings.elements.some((element: ts.ImportSpecifier): boolean => {
    return !element.isTypeOnly;
  });
}

function getGlobalMemberName(node: ts.Node): string | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    GLOBAL_OBJECTS.has(node.expression.text)
  ) {
    return node.name.text;
  }

  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    GLOBAL_OBJECTS.has(node.expression.text) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }

  return null;
}

/*
 * Requests that bypass every client: the global fetch (bare or through
 * window / globalThis / self), XMLHttpRequest, EventSource,
 * navigator.sendBeacon, and axios loaded as a value. Strings and comments are
 * never syntax, so the code samples on the telemetry and monitor pages - which
 * quote fetch and axios for the reader to copy - do not count.
 */
function findRawTransports(filePath: string, source: string): Array<Finding> {
  if (!RAW_TRANSPORT_HINT.test(source)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(filePath, source);
  const findings: Array<Finding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const globalMember: string | null = getGlobalMemberName(node);

    if (globalMember !== null && RAW_TRANSPORT_GLOBALS.has(globalMember)) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `uses ${node.getText(sourceFile)}`,
      });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      !isDeclaredInEnclosingScope(node, "fetch")
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: "calls the global fetch()",
      });
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      RAW_TRANSPORT_GLOBALS.has(node.expression.text) &&
      !isDeclaredInEnclosingScope(node, node.expression.text)
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `constructs ${node.expression.text}`,
      });
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "sendBeacon"
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `uses ${node.getText(sourceFile)}`,
      });
    } else if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isAxios(node.moduleSpecifier.text) &&
      node.importClause &&
      importsAnyValue(node.importClause)
    ) {
      findings.push({
        line: lineOf(sourceFile, node),
        description: `imports axios from "${node.moduleSpecifier.text}"`,
      });
    } else {
      const dynamicSpecifier: string | null = getDynamicModuleSpecifier(node);

      if (dynamicSpecifier !== null && isAxios(dynamicSpecifier)) {
        findings.push({
          line: lineOf(sourceFile, node),
          description: `loads axios from "${dynamicSpecifier}"`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}

function allowlistedFiles(allowlist: Array<AllowlistEntry>): Set<string> {
  return new Set<string>(
    allowlist.map((entry: AllowlistEntry): string => {
      return entry.file;
    }),
  );
}

describe("Browser requests to our backend go through the refresh-aware client", () => {
  const browserFiles: Array<string> = BROWSER_SOURCE_ROOTS.flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Map<string, string> = new Map<string, string>(
    browserFiles.map((file: string): [string, string] => {
      return [file, fs.readFileSync(file, "utf8")];
    }),
  );

  test("the import detector reads syntax, not text", () => {
    /*
     * The fixture pretends to live beside TableView, so a relative
     * "../../../Utils/API" really does resolve to the core client.
     */
    const fixturePath: string = path.join(
      COMMON_DIR,
      "UI",
      "Components",
      "ModelTable",
      "ImportDetectorFixture.tsx",
    );

    const findings: Array<Finding> = findBareClientValueImports(
      fixturePath,
      [
        'import API from "Common/Utils/API";',
        'import Core, { AuthRetryContext } from "../../../Utils/API";',
        'import * as CoreModule from "Common/Utils/API";',
        'import { default as Renamed } from "Common/Utils/API";',
        'export { default } from "Common/Utils/API";',
        'const lazy = import("Common/Utils/API");',
        'const required = require("../../../Utils/API");',
        'import type TypeOnly from "Common/Utils/API";',
        'import { AuthRetryContext as Context, RequestOptions } from "Common/Utils/API";',
        'import { type default as AlsoTypeOnly } from "Common/Utils/API";',
        'export type { APIRequestOptions } from "Common/Utils/API";',
        'import RefreshAware from "Common/UI/Utils/API/API";',
        'import Sibling from "../../Utils/API/API";',
        'const quoted = `import API from "Common/Utils/API"`;',
        '// import API from "Common/Utils/API";',
        '/* import API from "../../../Utils/API"; */',
      ].join("\n"),
    );

    expect(
      findings.map((finding: Finding): number => {
        return finding.line;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("the transport detector reads syntax and scope, not text", () => {
    const findings: Array<Finding> = findRawTransports(
      "TransportDetectorFixture.tsx",
      [
        "void fetch('/api/thing');",
        "void window.fetch('/api/thing');",
        "const f = globalThis['fetch'];",
        "const xhr = new XMLHttpRequest();",
        "const events = new EventSource('/api/stream');",
        "navigator.sendBeacon('/api/beacon');",
        'import axios from "axios";',
        'const lazyAxios = import("axios");',
        "function load(): void {",
        "  const fetch = async (): Promise<void> => {};",
        "  void fetch();",
        "}",
        "function withParameter(fetch: () => void): void { fetch(); }",
        'import type { AxiosProgressEvent } from "axios";',
        'import { type AxiosError } from "axios";',
        "const instrumentation = new XMLHttpRequestInstrumentation();",
        "void ENV.fetch('REGION');",
        "void loader.fetch();",
        "const sample = `const response = await fetch(url);`;",
        "const snippet = \"await axios.get('https://example.com')\";",
        "// fetch('/api/commented-out');",
      ].join("\n"),
    );

    expect(
      findings.map((finding: Finding): number => {
        return finding.line;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("the scan actually found the browser source", () => {
    /*
     * Guards the guard: a moved directory or a broken walk would otherwise
     * leave every assertion below passing over nothing.
     */
    for (const root of BROWSER_SOURCE_ROOTS) {
      expect(fs.existsSync(root)).toBe(true);
    }

    expect(browserFiles.length).toBeGreaterThan(1000);

    expect(
      browserFiles.some((file: string): boolean => {
        return file.includes(`${path.sep}src${path.sep}Server${path.sep}`);
      }),
    ).toBe(false);
  });

  test("a type-only reference to the core module is not a finding", () => {
    /*
     * RequestOptions.ts names the core module for its RequestOptions
     * interface. It is deliberately NOT allowlisted: were it ever to take
     * the class as a value, the main assertion below should catch it.
     */
    const requestOptions: string = fromPackagesPath(
      "Common/UI/Utils/API/RequestOptions.ts",
    );
    const source: string = fs.readFileSync(requestOptions, "utf8");

    expect(referencesBareClient(requestOptions, source)).toBe(true);
    expect(findBareClientValueImports(requestOptions, source)).toEqual([]);
  });

  test("every allowlisted file still exists and still needs its exception", () => {
    const stale: Array<string> = [];

    for (const entry of BARE_CLIENT_ALLOWLIST) {
      const filePath: string = fromPackagesPath(entry.file);

      if (!fs.existsSync(filePath)) {
        stale.push(
          `${entry.file} no longer exists - remove it from BARE_CLIENT_ALLOWLIST`,
        );
        continue;
      }

      if (
        findBareClientValueImports(filePath, fs.readFileSync(filePath, "utf8"))
          .length === 0
      ) {
        stale.push(
          `${entry.file} no longer imports the core client - remove it from BARE_CLIENT_ALLOWLIST`,
        );
      }
    }

    for (const entry of RAW_TRANSPORT_ALLOWLIST) {
      const filePath: string = fromPackagesPath(entry.file);

      if (!fs.existsSync(filePath)) {
        stale.push(
          `${entry.file} no longer exists - remove it from RAW_TRANSPORT_ALLOWLIST`,
        );
        continue;
      }

      if (
        findRawTransports(filePath, fs.readFileSync(filePath, "utf8"))
          .length === 0
      ) {
        stale.push(
          `${entry.file} no longer makes a raw request - remove it from RAW_TRANSPORT_ALLOWLIST`,
        );
      }
    }

    expect(stale).toEqual([]);
  });

  test("no browser module holds the core client, which never refreshes a session", () => {
    const allowed: Set<string> = allowlistedFiles(BARE_CLIENT_ALLOWLIST);
    const offenders: Array<string> = [];

    for (const [file, source] of sources) {
      const relative: string = toPackagesPath(file);

      if (allowed.has(relative)) {
        continue;
      }

      for (const finding of findBareClientValueImports(file, source)) {
        offenders.push(
          `${relative}:${finding.line} ${finding.description}. Import API from "Common/UI/Utils/API/API" (or the feature's own subclass, e.g. StatusPage/src/Utils/API) instead: the core client never refreshes an expired session, so this request fails once the 15-minute access token lapses.`,
        );
      }
    }

    /*
     * The strings ARE the message: jest prints the received array, so a
     * failure names every file and line along with the fix.
     */
    expect(offenders).toEqual([]);
  });

  test("no browser module opens a request around the client", () => {
    const allowed: Set<string> = allowlistedFiles(RAW_TRANSPORT_ALLOWLIST);
    const offenders: Array<string> = [];

    for (const [file, source] of sources) {
      const relative: string = toPackagesPath(file);

      if (allowed.has(relative)) {
        continue;
      }

      for (const finding of findRawTransports(file, source)) {
        offenders.push(
          `${relative}:${finding.line} ${finding.description}. Use API from "Common/UI/Utils/API/API", which refreshes an expired session and replays the request. If the response cannot come through it (binary data, keepalive), call API.refreshSession() on a 401 and add the file to RAW_TRANSPORT_ALLOWLIST with the reason.`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });
});
