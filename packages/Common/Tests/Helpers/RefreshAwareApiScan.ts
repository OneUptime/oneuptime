import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the "browser requests go through the refresh-aware
 * client" guards. Two suites use it:
 *
 *   - packages/App/Tests/FrontendRequestsUseRefreshAwareApi.test.ts scans the
 *     core frontends and Common/UI. It runs in the App Test job, where ee/ is
 *     deleted.
 *   - ee/Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts scans the
 *     Enterprise screens (ee/Dashboard, ee/AdminDashboard) that the Community
 *     / Enterprise split moved out of the core frontends.
 *
 * Why the rule exists: the access-token cookie lives exactly as long as the
 * 15-minute JWT inside it, so a Dashboard left open past that sends its next
 * request with no access token at all. The server answers 401, and the UI
 * client (Common/UI/Utils/API/API, class BaseAPI) answers that by refreshing
 * the session once and replaying the request - the user never notices.
 *
 * The core client underneath it (Common/Utils/API) cannot do that. Its
 * tryRefreshAuth returns false and its handleError does nothing, because it
 * is also the server's HTTP client and has no session to refresh. A page that
 * imports it directly therefore works for fifteen minutes and then fails. The
 * same happens to a raw fetch(), axios or XMLHttpRequest call: none of them
 * know the session can be refreshed.
 *
 * This module holds the detector only - file listing, the two syntax checks,
 * and the allowlist plumbing. Each suite keeps its own roots and its own
 * allowlist entries, each with a reason a reviewer would accept.
 *
 * It lives under Common/Tests so both suites reach it through the "Common/..."
 * specifier: core never imports ee/, and ee/ imports core only through the
 * package specifiers.
 */

// packages/Common, found from this file so every path below shares one origin.
export const COMMON_DIR: string = path.resolve(__dirname, "..", "..");

// packages/
export const PACKAGES_DIR: string = path.resolve(COMMON_DIR, "..");

/* The core client: no session, so no refresh. */
export const BARE_CLIENT: string = path.join(COMMON_DIR, "Utils", "API.ts");

export interface AllowlistEntry {
  // Path relative to the suite's base directory, with "/" separators.
  file: string;
  reason: string;
}

export interface Finding {
  line: number;
  description: string;
}

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

/* A file's path relative to baseDir, with "/" separators on every platform. */
export function toRelativePath(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

/* The inverse of toRelativePath. */
export function fromRelativePath(baseDir: string, relative: string): string {
  return path.join(baseDir, ...relative.split("/"));
}

/*
 * Every .ts / .tsx module under a directory. node_modules and __mocks__ are
 * never browser code, and neither is src/Server under StatusPage and
 * PublicDashboard: that is the node side that renders those pages, where the
 * core client is correct.
 */
export function listSourceFiles(directory: string): Array<string> {
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

/* Each file's text, keyed by its absolute path. */
export function readSources(files: Array<string>): Map<string, string> {
  return new Map<string, string>(
    files.map((file: string): [string, string] => {
      return [file, fs.readFileSync(file, "utf8")];
    }),
  );
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
export function findBareClientValueImports(
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
export function referencesBareClient(
  filePath: string,
  source: string,
): boolean {
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
export function findRawTransports(
  filePath: string,
  source: string,
): Array<Finding> {
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

export function allowlistedFiles(
  allowlist: ReadonlyArray<AllowlistEntry>,
): Set<string> {
  return new Set<string>(
    allowlist.map((entry: AllowlistEntry): string => {
      return entry.file;
    }),
  );
}

/*
 * Allowlist entries that no longer earn their place: the file is gone, or it
 * no longer does what it was excused for. A suite asserts this is empty, so an
 * allowlist cannot quietly outlive its reasons.
 */
export function findStaleAllowlistEntries(data: {
  baseDir: string;
  bareClientAllowlist: ReadonlyArray<AllowlistEntry>;
  rawTransportAllowlist: ReadonlyArray<AllowlistEntry>;
}): Array<string> {
  const stale: Array<string> = [];

  for (const entry of data.bareClientAllowlist) {
    const filePath: string = fromRelativePath(data.baseDir, entry.file);

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

  for (const entry of data.rawTransportAllowlist) {
    const filePath: string = fromRelativePath(data.baseDir, entry.file);

    if (!fs.existsSync(filePath)) {
      stale.push(
        `${entry.file} no longer exists - remove it from RAW_TRANSPORT_ALLOWLIST`,
      );
      continue;
    }

    if (
      findRawTransports(filePath, fs.readFileSync(filePath, "utf8")).length ===
      0
    ) {
      stale.push(
        `${entry.file} no longer makes a raw request - remove it from RAW_TRANSPORT_ALLOWLIST`,
      );
    }
  }

  return stale;
}

/*
 * One line per module that holds the core client, naming the file, the line
 * and the fix. The strings ARE the failure message: jest prints the received
 * array.
 */
export function findBareClientOffenders(data: {
  sources: ReadonlyMap<string, string>;
  baseDir: string;
  allowlist: ReadonlyArray<AllowlistEntry>;
}): Array<string> {
  const allowed: Set<string> = allowlistedFiles(data.allowlist);
  const offenders: Array<string> = [];

  for (const [file, source] of data.sources) {
    const relative: string = toRelativePath(data.baseDir, file);

    if (allowed.has(relative)) {
      continue;
    }

    for (const finding of findBareClientValueImports(file, source)) {
      offenders.push(
        `${relative}:${finding.line} ${finding.description}. Import API from "Common/UI/Utils/API/API" (or the feature's own subclass, e.g. StatusPage/src/Utils/API) instead: the core client never refreshes an expired session, so this request fails once the 15-minute access token lapses.`,
      );
    }
  }

  return offenders;
}

/* One line per request opened around the client, as above. */
export function findRawTransportOffenders(data: {
  sources: ReadonlyMap<string, string>;
  baseDir: string;
  allowlist: ReadonlyArray<AllowlistEntry>;
}): Array<string> {
  const allowed: Set<string> = allowlistedFiles(data.allowlist);
  const offenders: Array<string> = [];

  for (const [file, source] of data.sources) {
    const relative: string = toRelativePath(data.baseDir, file);

    if (allowed.has(relative)) {
      continue;
    }

    for (const finding of findRawTransports(file, source)) {
      offenders.push(
        `${relative}:${finding.line} ${finding.description}. Use API from "Common/UI/Utils/API/API", which refreshes an expired session and replays the request. If the response cannot come through it (binary data, keepalive), call API.refreshSession() on a 401 and add the file to RAW_TRANSPORT_ALLOWLIST with the reason.`,
      );
    }
  }

  return offenders;
}
