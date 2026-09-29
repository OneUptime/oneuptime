import fs from "fs";
import ts from "typescript";
import {
  AllowlistEntry,
  Finding,
  allowlistedFiles,
  fromRelativePath,
  toRelativePath,
} from "./RefreshAwareApiScan";

/*
 * The detector behind the "Dashboard requests name the project they are for"
 * guard.
 *
 * Model CRUD goes through ModelAPI, which calls getCommonHeaders() on every
 * request and so always sends a `tenantid` header. Custom (non-CRUD) routes
 * have no ModelAPI to go through, so pages reach them with a raw
 * `API.post` / `API.get` from Common/UI/Utils/API/API - and BaseAPI.getHeaders()
 * adds only the default and permission-hash headers. It does NOT add
 * `tenantid`. ModelAPI.getCommonHeaders() is the only producer of that header
 * in the entire codebase.
 *
 * Server side, ProjectMiddleware.getProjectId is the only thing that resolves
 * the project, and it looks in exactly these places:
 *
 *     req.params.projectId, req.params.tenantid, req.query.tenantid,
 *     req.headers.tenantid, req.headers.projectid, req.body.projectId
 *
 * So a raw call from the Dashboard has to make the project explicit in one of
 * three ways: the tenant header, a `projectId` in the body, or a project id in
 * the URL. A call that does none of them arrives with no project at all.
 *
 * What that costs is not theoretical. OneUptime issue #3920 ("Can't test SMTP
 * connection") was `/smtp-config/test` posted without the header: the route
 * had been hardened to require an authenticated member of the config's own
 * project, and with no `tenantid` there was no project to check, so every
 * click on "Send Test Email" came back "Project ID is required". Before that
 * hardening the same omission showed up as "You do not have permissions to
 * read <model>", naming permissions the caller already held. Neither failure
 * is visible in a type check, in a compile, or in any test that does not send
 * the request - which is what this scan is for.
 *
 * The three existing guards (ProjectScopedApiTenantHeader,
 * ProjectScopedCustomRouteTenantHeader, MonitorTemplateSyncTenantHeader) each
 * pin a hardcoded list of files and routes, which is why none of them saw
 * `/smtp-config/test`: it was not on any list. This one sweeps instead, so a
 * new page is covered the day it lands and the only way out is an allowlist
 * entry with a reason.
 *
 * It lives under Common/Tests so both the core suite and ee/ reach it through
 * the "Common/..." specifier, the same way RefreshAwareApiScan does.
 */

/* The HTTP verbs the browser client exposes as `API.<verb>({ ... })`. */
const REQUEST_VERBS: ReadonlySet<string> = new Set<string>([
  "get",
  "post",
  "put",
  "delete",
  "patch",
]);

/*
 * Module specifiers whose default export is a raw, non-model client: it sends
 * the session cookie but never a tenant header. Matched as a suffix so both
 * "Common/UI/Utils/API/API" and a relative "../../Utils/API/API" resolve.
 *
 * ModelAPI and AnalyticsModelAPI are deliberately absent: those attach the
 * header themselves, so demanding an explicit one from their call sites would
 * be wrong.
 */
const RAW_CLIENT_SPECIFIERS: ReadonlyArray<string> = [
  "UI/Utils/API/API",
  "Utils/API/API",
];

/*
 * Every file that opens a request spells one of these, so a module with
 * neither needs no parse.
 */
const REQUEST_HINT: RegExp = /API\s*\.\s*(?:get|post|put|delete|patch)\b/;

/*
 * A `headers` expression that reaches getCommonHeaders(). Both ModelAPI and
 * AnalyticsModelAPI expose it and both produce the tenant header, so the
 * method is what is matched rather than the class.
 */
const TENANT_HEADER: RegExp = /\bgetCommonHeaders\s*\(/;

/* `projectId: value`, or the shorthand `projectId`, in an object literal. */
const PROJECT_ID_PROPERTY: RegExp = /\bprojectId\b\s*(?::|,|\}|$)/m;

/*
 * A project id named in the url itself - a `:projectId` path segment, or a
 * lookup of the current one.
 */
const PROJECT_ID_IN_URL: RegExp = /\bprojectId\b|getCurrentProjectId\s*\(/;

export interface RawApiCall {
  // 1-based, for a clickable file:line in the failure message.
  line: number;
  verb: string;
  // Source text of the call's `url:`, `data:` and `headers:` properties.
  url: string;
  data: string;
  headers: string;
}

/*
 * Identifiers this file declares at any level, mapped to the source text of
 * their declaration - but only when the name is declared exactly once.
 *
 * This is what lets the scan see through the one indirection these pages
 * actually use: LogsViewer.tsx writes `headers: getHeaders()` and declares
 * `function getHeaders() { return ModelAPI.getCommonHeaders(); }` a few lines
 * above. Resolving that is the difference between a true reading and a false
 * accusation.
 *
 * Ambiguity has to read as "cannot tell", never as "take the first one": a
 * name declared twice (two branches of a conditional, a shadowed parameter)
 * would otherwise attribute a call to whichever declaration happened to come
 * first. Such a name is simply absent from the map, and the call is then
 * judged on its own text - which fails closed, into a finding a human reads.
 */
function collectDeclarations(sourceFile: ts.SourceFile): Map<string, string> {
  const seen: Map<string, number> = new Map<string, number>();
  const text: Map<string, string> = new Map<string, string>();

  const record: (name: string, node: ts.Node) => void = (
    name: string,
    node: ts.Node,
  ): void => {
    seen.set(name, (seen.get(name) || 0) + 1);
    text.set(name, node.getText(sourceFile));
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      record(node.name.text, node);
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      record(node.name.text, node);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  for (const [name, count] of seen) {
    if (count !== 1) {
      text.delete(name);
    }
  }

  return text;
}

/*
 * An expression's own text, plus the text of every identifier in it that this
 * file declares - one level deep.
 *
 * One level is what the indirection in these pages is worth (`getHeaders()`
 * returning `ModelAPI.getCommonHeaders()`), and stopping there keeps the
 * expansion bounded and readable. A deeper chain reads as unresolved, which
 * fails closed into a finding rather than quietly passing.
 */
function expand(expression: string, declarations: Map<string, string>): string {
  const identifiers: Array<string> =
    expression.match(/[A-Za-z_$][\w$]*/g) || [];
  const parts: Array<string> = [expression];

  for (const identifier of new Set<string>(identifiers)) {
    const declaration: string | undefined = declarations.get(identifier);

    if (declaration) {
      parts.push(declaration);
    }
  }

  return parts.join("\n");
}

/*
 * The local names bound to a raw client in this file, e.g. `API` from
 * `import API from "Common/UI/Utils/API/API"`.
 *
 * Reading the imports rather than matching the literal name `API` is what
 * keeps `ModelAPI.post` and `AnalyticsModelAPI.post` out of the sweep: those
 * resolve to a different module, and demanding an explicit tenant header from
 * them would be wrong - they send one already.
 */
function rawClientNames(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;

    const isRawClient: boolean = RAW_CLIENT_SPECIFIERS.some(
      (suffix: string): boolean => {
        return specifier.endsWith(suffix);
      },
    );

    if (!isRawClient || !statement.importClause) {
      continue;
    }

    // A type-only import carries no client, so it opens no request.
    if (statement.importClause.isTypeOnly) {
      continue;
    }

    if (statement.importClause.name) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

/* The source text of one property of an object literal, or "" when unset. */
function readProperty(
  literal: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): string {
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) {
      continue;
    }

    if (property.name.text === name) {
      return property.initializer.getText(sourceFile);
    }
  }

  return "";
}

/* One module's syntax tree. JSX only parses under the TSX script kind. */
function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/*
 * Every `API.<verb>(...)` in one browser module, where `API` is a raw client
 * this file imported.
 *
 * A call whose argument is not an object literal - `API.post(buildRequest())`
 * - has no `url`/`data`/`headers` to read, so it is reported with all three
 * empty rather than dropped. Empty reads as "names no project", which turns
 * an unreadable call into a finding a human looks at instead of a hole the
 * sweep walks past. There are none in the Dashboard today; the point is that
 * the first one cannot arrive unnoticed.
 */
export function findRawApiCalls(
  source: string,
  file: string,
): Array<RawApiCall> {
  if (!REQUEST_HINT.test(source)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(source, file);

  const clients: Set<string> = rawClientNames(sourceFile);

  if (clients.size === 0) {
    return [];
  }

  const calls: Array<RawApiCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    ts.forEachChild(node, visit);

    if (!ts.isCallExpression(node)) {
      return;
    }

    const callee: ts.LeftHandSideExpression = node.expression;

    /*
     * `API.post<T>({...})` parses as a call whose expression is the property
     * access; the type argument lives on the call, so nothing extra is needed
     * to match both spellings.
     */
    if (!ts.isPropertyAccessExpression(callee)) {
      return;
    }

    if (!ts.isIdentifier(callee.expression)) {
      return;
    }

    if (!clients.has(callee.expression.text)) {
      return;
    }

    if (!REQUEST_VERBS.has(callee.name.text)) {
      return;
    }

    const argument: ts.Expression | undefined = node.arguments[0];

    const literal: ts.ObjectLiteralExpression | null =
      argument && ts.isObjectLiteralExpression(argument) ? argument : null;

    calls.push({
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      verb: callee.name.text,
      url: literal ? readProperty(literal, "url", sourceFile) : "",
      data: literal ? readProperty(literal, "data", sourceFile) : "",
      headers: literal ? readProperty(literal, "headers", sourceFile) : "",
    });
  };

  ts.forEachChild(sourceFile, visit);

  return calls.sort((left: RawApiCall, right: RawApiCall): number => {
    return left.line - right.line;
  });
}

/* Whether a call sends `tenantid` - see TENANT_HEADER. */
export function sendsTenantHeader(
  call: RawApiCall,
  declarations: Map<string, string>,
): boolean {
  if (!call.headers) {
    return false;
  }

  return TENANT_HEADER.test(expand(call.headers, declarations));
}

/*
 * Whether the request body carries `projectId`, which
 * ProjectMiddleware.getProjectId reads as its last fallback. Most of the
 * Dashboard's raw posts scope themselves this way rather than with the
 * header - `projectId: ProjectUtil.getCurrentProjectId()!` - and that is a
 * perfectly good answer to "which project is this for?".
 *
 * Both spellings count: `projectId: x` and the shorthand `projectId`.
 */
export function sendsProjectIdInBody(
  call: RawApiCall,
  declarations: Map<string, string>,
): boolean {
  if (!call.data) {
    return false;
  }

  const text: string = expand(call.data, declarations);

  return PROJECT_ID_PROPERTY.test(text);
}

/*
 * Whether the project is named in the URL itself - either as a path segment
 * the route declares as `:projectId`, or by a call to getCurrentProjectId().
 */
export function urlCarriesProjectId(
  call: RawApiCall,
  declarations: Map<string, string>,
): boolean {
  if (!call.url) {
    return false;
  }

  const text: string = expand(call.url, declarations);

  return PROJECT_ID_IN_URL.test(text);
}

/* The three ways a request can name its project, in one question. */
export function makesProjectExplicit(
  call: RawApiCall,
  declarations: Map<string, string>,
): boolean {
  return (
    sendsTenantHeader(call, declarations) ||
    sendsProjectIdInBody(call, declarations) ||
    urlCarriesProjectId(call, declarations)
  );
}

/* Every raw call in one module that names no project. */
export function findImplicitProjectCalls(
  source: string,
  file: string,
): Array<Finding> {
  const calls: Array<RawApiCall> = findRawApiCalls(source, file);

  if (calls.length === 0) {
    return [];
  }

  const declarations: Map<string, string> = collectDeclarations(
    parse(source, file),
  );

  return calls
    .filter((call: RawApiCall): boolean => {
      return !makesProjectExplicit(call, declarations);
    })
    .map((call: RawApiCall): Finding => {
      const target: string = call.url.replace(/\s+/g, " ").trim();

      return {
        line: call.line,
        description: target
          ? `API.${call.verb} to ${target} sends no project`
          : `API.${call.verb} is not written as an object literal, so the scan cannot tell whether it names a project`,
      };
    });
}

/*
 * One line per request that names no project, naming the file, the line and
 * the fix. The strings ARE the failure message: jest prints the received
 * array.
 */
export function findImplicitProjectOffenders(data: {
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

    for (const finding of findImplicitProjectCalls(source, file)) {
      offenders.push(
        `${relative}:${finding.line} ${finding.description}. Add \`headers: ModelAPI.getCommonHeaders(),\` to the call so a \`tenantid\` header is sent (or put \`projectId\` in the body). Without it ProjectMiddleware.getProjectId finds no project, and a project-scoped route answers "Project ID is required".`,
      );
    }
  }

  return offenders;
}

/*
 * Allowlist entries that no longer earn their place: the file is gone, or
 * every raw call in it now names a project. A suite asserts this is empty, so
 * an allowlist cannot quietly outlive its reasons.
 */
export function findStaleProjectAllowlistEntries(data: {
  baseDir: string;
  allowlist: ReadonlyArray<AllowlistEntry>;
  allowlistName: string;
}): Array<string> {
  const stale: Array<string> = [];

  for (const entry of data.allowlist) {
    const filePath: string = fromRelativePath(data.baseDir, entry.file);

    if (!fs.existsSync(filePath)) {
      stale.push(
        `${entry.file} no longer exists - remove it from ${data.allowlistName}`,
      );
      continue;
    }

    if (
      findImplicitProjectCalls(fs.readFileSync(filePath, "utf8"), filePath)
        .length === 0
    ) {
      stale.push(
        `${entry.file} no longer makes a request without a project - remove it from ${data.allowlistName}`,
      );
    }
  }

  return stale;
}

/*
 * The declarations one module contributes to the scan, exposed so a suite can
 * ask about a single call it names rather than only about the whole sweep.
 */
export function readDeclarations(
  source: string,
  file: string,
): Map<string, string> {
  return collectDeclarations(parse(source, file));
}
