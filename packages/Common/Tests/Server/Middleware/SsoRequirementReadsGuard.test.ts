import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A SIGN-IN RULE THAT CANNOT BE READ IS NEVER TAKEN FOR AN ANSWER.
 *
 * Whether a person must have signed in with SSO to open a project is read
 * from three rules: the project's Require SSO for Login
 * (ProjectService.getRequireSsoForLogin), the provider the project pins
 * (ProjectService.getRequireSsoWithSsoProviderId), and the server's Require
 * SSO for Login (GlobalConfigService.getRequireSsoForLogin). A read of one
 * can fail - the database restarting, its pool full, a statement out of
 * time - and a failure caught and answered with a value ("not required",
 * "any provider will do") lets in, while it lasts, every session that never
 * signed in with SSO. Every reader lets the failure through, and the
 * request is refused with it. These hold all product code (ee/ too, when it
 * is checked out) to that:
 *
 *   - every read of the rules is listed below, by file and function, so a
 *     new reader fails here until it is looked at - and added to the suites
 *     that make each read fail (SsoRequirementUnreadableOverHttp,
 *     UserAuthorizationSsoEnforcement, RealtimeJoinGuard, Realtime,
 *     FileImageRouteViewers, McpOAuthSso, McpOAuthGrantAccess and the MCP
 *     server's OAuthFlow) - and the getters themselves keep nothing a read
 *     that failed, or that a change overtook, answered
 *     (ProjectSignInRuleCache, ServerSignInRuleCache);
 *   - no read is handed to a .catch, or sits in a try whose catch, can end
 *     as a value: each ends by throwing, and the one failure it may answer
 *     on the way is the project not existing
 *     (UserMiddleware.isUnknownProject) - nor to a .then with a rejection
 *     handler, or Promise.allSettled;
 *   - no getter is taken without being called, where these checks would
 *     not see what is done with it.
 *
 * Read from the code by TypeScript's own parser, so a word in a comment is
 * never taken for code.
 */

const RULE_GETTERS: Array<string> = [
  "getRequireSsoForLogin",
  "getRequireSsoWithSsoProviderId",
];

const RULE_GETTER_MENTION: RegExp =
  /\bgetRequireSsoForLogin\b|\bgetRequireSsoWithSsoProviderId\b/;

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

// Every product read of the rules: "<function>: <service>.<getter>".
const READERS: Record<string, Array<string>> = {
  // Every API request in a project, the image routes and the realtime join.
  "packages/Common/Server/Middleware/UserAuthorization.ts": [
    "getUserTenantAccessPermissionWithTenantId: ProjectService.getRequireSsoForLogin",
    "getUserTenantAccessPermissionWithTenantId: GlobalConfigService.getRequireSsoForLogin",
    "getUserTenantAccessPermissionWithTenantId: ProjectService.getRequireSsoWithSsoProviderId",
    // A request across the person's projects.
    "getUserTenantAccessPermissionForMultiTenant: GlobalConfigService.getRequireSsoForLogin",
    "getUserTenantAccessPermissionForMultiTenant: ProjectService.getRequireSsoForLogin",
    "getUserTenantAccessPermissionForMultiTenant: ProjectService.getRequireSsoWithSsoProviderId",
  ],
  // An MCP client's grant, at the consent screen and on every use.
  "packages/Common/Server/Utils/Mcp/McpOAuthSso.ts": [
    "getRequirement: ProjectService.getRequireSsoForLogin",
    "getRequirement: GlobalConfigService.getRequireSsoForLogin",
    "getRequirement: ProjectService.getRequireSsoWithSsoProviderId",
  ],
  /*
   * Every sign-in that is not SSO - a password and its second steps, a
   * passkey, Sign in with Microsoft - and every sign-up, while the server
   * requires SSO (SsoRequiredSignInRoutes, MicrosoftSignInAPI and
   * SsoSignInMethods make each read fail).
   */
  "packages/Common/Server/Utils/SsoRequiredSignIn.ts": [
    "isNonSsoSignInRefused: GlobalConfigService.getRequireSsoForLogin",
    "isSsoRequired: GlobalConfigService.getRequireSsoForLogin",
  ],
  // The providers the page a project that requires SSO sends people to lists.
  "packages/Common/Server/Utils/SsoSignInMethods.ts": [
    "getProjectSignInMethods: ProjectService.getRequireSsoWithSsoProviderId",
  ],
};

interface Finding {
  file: string;
  line: number;
  code: string;
}

interface Scan {
  readers: Record<string, Array<string>>;
  // Reads whose failure is caught and can end as a value.
  swallowed: Array<Finding & { how: string }>;
  // A getter taken without being called.
  uncalled: Array<Finding>;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

// `<anything>.<getter>(...)`: the getter's name, or null.
function ruleGetterCalled(node: ts.Node): string | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    RULE_GETTERS.includes(node.expression.name.text)
  ) {
    return node.expression.name.text;
  }

  return null;
}

// Whether a block's last statement is a throw.
function endsInThrow(block: ts.Block): boolean {
  const last: ts.Statement | undefined =
    block.statements[block.statements.length - 1];

  return Boolean(last && ts.isThrowStatement(last));
}

// The return statements of a block's own function, not of the functions inside it.
function ownReturns(block: ts.Block): Array<ts.ReturnStatement> {
  const returns: Array<ts.ReturnStatement> = [];

  const walk: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      returns.push(node);
      return;
    }

    if (isFunctionLike(node)) {
      return;
    }

    ts.forEachChild(node, walk);
  };

  ts.forEachChild(block, walk);

  return returns;
}

// Whether an expression calls a function of this name.
function callsFunctionNamed(expression: ts.Node, name: string): boolean {
  let found: boolean = false;

  visit(expression, (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === name) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === name))
    ) {
      found = true;
    }
  });

  return found;
}

/*
 * Whether a return answers that the project does not exist: it sits in the
 * then-branch of an `if` that asks so (UserMiddleware.isUnknownProject) -
 * the one failure of a read that is an answer, about the project.
 */
function answersAnUnknownProject(
  statement: ts.ReturnStatement,
  block: ts.Block,
): boolean {
  let node: ts.Node = statement;

  while (node.parent && node.parent !== block) {
    const up: ts.Node = node.parent;

    if (
      ts.isIfStatement(up) &&
      up.thenStatement === node &&
      callsFunctionNamed(up.expression, "isUnknownProject")
    ) {
      return true;
    }

    node = up;
  }

  return false;
}

/*
 * Whether a catch - a .catch handler's body, or a catch clause - can end
 * as a value: it does not end by throwing, or it returns on the way for
 * anything but a project that does not exist.
 */
function catchCanEndAsAValue(block: ts.Block): boolean {
  if (!endsInThrow(block)) {
    return true;
  }

  return ownReturns(block).some((statement: ts.ReturnStatement): boolean => {
    return !answersAnUnknownProject(statement, block);
  });
}

// Whether a function handed a rejection (a .catch handler) can end as a value.
function handlerCanEndAsAValue(handler: ts.Expression | undefined): boolean {
  if (!handler) {
    return false;
  }

  // A function from elsewhere: what it does with the failure is not seen here.
  if (!(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
    return true;
  }

  // An expression for a body is a value.
  if (!ts.isBlock(handler.body)) {
    return true;
  }

  return catchCanEndAsAValue(handler.body);
}

// How a read's failure is caught and can end as a value, or null when it is let through.
function howSwallowed(call: ts.CallExpression): string | null {
  // `<read>.catch(handler)` and `<read>.then(onFulfilled, onRejected)`.
  const parent: ts.Node = call.parent;

  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === call &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    const chained: ts.CallExpression = parent.parent;

    if (
      parent.name.text === "catch" &&
      handlerCanEndAsAValue(chained.arguments[0])
    ) {
      return "a .catch that can end without throwing";
    }

    if (parent.name.text === "then" && chained.arguments.length > 1) {
      return "a .then with a rejection handler";
    }
  }

  // Up to the function the read is made in.
  let node: ts.Node = call;

  while (node.parent && !isFunctionLike(node.parent)) {
    const up: ts.Node = node.parent;

    if (
      ts.isTryStatement(up) &&
      up.tryBlock === node &&
      up.catchClause &&
      catchCanEndAsAValue(up.catchClause.block)
    ) {
      return "a try whose catch can end without throwing";
    }

    if (
      ts.isCallExpression(up) &&
      ts.isPropertyAccessExpression(up.expression) &&
      ts.isIdentifier(up.expression.expression) &&
      up.expression.expression.text === "Promise" &&
      up.expression.name.text === "allSettled"
    ) {
      return "Promise.allSettled";
    }

    node = up;
  }

  return null;
}

// The class method, or function, a node is written in.
function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) &&
      current.name &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  return "(top level)";
}

function serviceOf(call: ts.CallExpression): string {
  const callee: ts.PropertyAccessExpression =
    call.expression as ts.PropertyAccessExpression;

  return callee.expression.getText();
}

// Reads one file's source the way the guard reads every product file.
function scanSource(file: string, source: string): Scan {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(file),
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const scan: Scan = { readers: {}, swallowed: [], uncalled: [] };

  visit(sourceFile, (node: ts.Node): void => {
    const getter: string | null = ruleGetterCalled(node);

    if (getter) {
      const call: ts.CallExpression = node as ts.CallExpression;

      (scan.readers[file] = scan.readers[file] || []).push(
        `${enclosingFunctionName(call)}: ${serviceOf(call)}.${getter}`,
      );

      const how: string | null = howSwallowed(call);

      if (how) {
        scan.swallowed.push({
          file,
          line: lineOf(sourceFile, call),
          code: call.parent.parent.getText(sourceFile).slice(0, 160),
          how,
        });
      }

      return;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      RULE_GETTERS.includes(node.name.text) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      scan.uncalled.push({
        file,
        line: lineOf(sourceFile, node),
        code: node.parent.getText(sourceFile).slice(0, 160),
      });
    }
  });

  return scan;
}

function scanProductCode(): Scan {
  const scan: Scan = { readers: {}, swallowed: [], uncalled: [] };

  const files: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
    "packages",
    "ee",
  ]).filter((relativePath: string): boolean => {
    return CODE_FILE.test(relativePath);
  });

  for (const file of files) {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    if (!RULE_GETTER_MENTION.test(source)) {
      continue;
    }

    const fileScan: Scan = scanSource(file, source);

    Object.assign(scan.readers, fileScan.readers);
    scan.swallowed.push(...fileScan.swallowed);
    scan.uncalled.push(...fileScan.uncalled);
  }

  return scan;
}

const sorted: (
  record: Record<string, Array<string>>,
) => Record<string, Array<string>> = (
  record: Record<string, Array<string>>,
): Record<string, Array<string>> => {
  const result: Record<string, Array<string>> = {};

  for (const key of Object.keys(record).sort()) {
    result[key] = [...record[key]!].sort();
  }

  return result;
};

describe("every read of the sign-in rules lets a failure through", () => {
  const scan: Scan = scanProductCode();

  test("every read of the rules is one listed here", () => {
    expect(sorted(scan.readers)).toEqual(sorted(READERS));
  });

  test("no read's failure is caught and answered with a value", () => {
    expect(scan.swallowed).toEqual([]);
  });

  test("no getter of the rules is taken without being called", () => {
    expect(scan.uncalled).toEqual([]);
  });
});

/*
 * The checks above see a failure caught and answered, in every shape it
 * takes: the shapes are written out here and read as product code is.
 */
describe("the guard sees a failure caught and answered", () => {
  const read: (body: string) => Scan = (body: string): Scan => {
    return scanSource(
      "Example.ts",
      `class Example {\n  public async check(): Promise<unknown> {\n${body}\n  }\n}\n`,
    );
  };

  const SWALLOWED: Array<[string, string]> = [
    [
      "a .catch that answers false",
      "return await GlobalConfigService.getRequireSsoForLogin().catch(() => { return false; });",
    ],
    [
      "a .catch with a value for a body",
      "return await GlobalConfigService.getRequireSsoForLogin().catch(() => false);",
    ],
    [
      "a .catch that answers no provider",
      "return await ProjectService.getRequireSsoWithSsoProviderId(id).catch(() => { return null; });",
    ],
    [
      "a .catch that logs and goes on",
      "return await ProjectService.getRequireSsoForLogin(id).catch((err: Error) => { logger.error(err); });",
    ],
    [
      "a .catch that throws one failure and answers the rest",
      "return await ProjectService.getRequireSsoForLogin(id).catch((err: Error) => { if (isGone(err)) { throw err; } return false; });",
    ],
    [
      "a .catch handed a function from elsewhere",
      "return await ProjectService.getRequireSsoForLogin(id).catch(answerFalse);",
    ],
    [
      "a .then with a rejection handler",
      "return await GlobalConfigService.getRequireSsoForLogin().then((value: boolean) => value, () => false);",
    ],
    [
      "a try whose catch answers false",
      "try { return await GlobalConfigService.getRequireSsoForLogin(); } catch { return false; }",
    ],
    [
      "a try whose catch logs and goes on",
      "let required: boolean = false; try { required = await ProjectService.getRequireSsoForLogin(id); } catch (err) { logger.error(err); } return required;",
    ],
    [
      "a try whose catch answers a timeout, and throws every other failure",
      "try { return await GlobalConfigService.getRequireSsoForLogin(); } catch (err) { if (isTimeout(err)) { return false; } throw err; }",
    ],
    [
      "a try whose catch answers false whatever the failure, after asking about the project",
      "try { return await ProjectService.getRequireSsoForLogin(id); } catch (err) { if (UserMiddleware.isUnknownProject(err)) { throw err; } else { return false; } throw err; }",
    ],
    [
      "Promise.allSettled",
      "return await Promise.allSettled([GlobalConfigService.getRequireSsoForLogin()]);",
    ],
  ];

  test.each(SWALLOWED)("%s", (_name: string, body: string) => {
    expect(read(body).swallowed.length).toBe(1);
  });

  const LET_THROUGH: Array<[string, string]> = [
    [
      "a read awaited as it is",
      "return await GlobalConfigService.getRequireSsoForLogin();",
    ],
    [
      "a .catch that names one failure and throws every other",
      'return await ProjectService.getRequireSsoForLogin(id).catch((err: Error) => { if (err.message === "Project not found") { throw new TenantNotFoundException("Invalid tenantId"); } throw err; });',
    ],
    [
      "a try whose catch answers a project that does not exist, and throws every other failure",
      "try { return await ProjectService.getRequireSsoForLogin(id); } catch (err) { if (UserMiddleware.isUnknownProject(err)) { return null; } throw err; }",
    ],
    [
      "a read inside Promise.all",
      "return await Promise.all([ProjectService.getRequireSsoForLogin(id), other()]);",
    ],
  ];

  test.each(LET_THROUGH)("%s is let through", (_name: string, body: string) => {
    const scan: Scan = read(body);

    expect(scan.swallowed).toEqual([]);
    expect(Object.values(scan.readers).flat().length).toBe(1);
  });

  test("a getter taken without being called is seen", () => {
    expect(
      read(
        "const readRule = ProjectService.getRequireSsoForLogin.bind(ProjectService); return await readRule(id);",
      ).uncalled.length,
    ).toBe(1);
  });

  test("each read is listed by the function it is made in", () => {
    expect(
      read(
        "return await Promise.all(ids.map(async (id: ObjectID) => { return await ProjectService.getRequireSsoWithSsoProviderId(id); }));",
      ).readers,
    ).toEqual({
      "Example.ts": ["check: ProjectService.getRequireSsoWithSsoProviderId"],
    });
  });
});
