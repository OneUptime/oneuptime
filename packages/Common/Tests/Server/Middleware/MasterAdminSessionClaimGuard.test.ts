import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A SESSION IS A MASTER ADMIN'S ONLY WHILE ITS PERSON STILL IS ONE.
 *
 * A session's access token says whether its person was a master admin when
 * it was signed, and lives for 15 minutes. Another master admin may remove
 * the access in the meantime (Admin Dashboard > Users > Master Admin
 * Access), and from the next request on the session is the member's they
 * are. That holds because exactly one place reads a session -
 * UserMiddleware.readRequestSession - and it holds the token's claim to the
 * person's account (UserService.isUserMasterAdmin). This guard keeps it the
 * one place, across all product code (ee/ too, when it is checked out):
 *
 *   - a session's token (JsonWebTokenPurpose.UserSession) is decoded only in
 *     readRequestSession, apart from reads that take nothing from it but
 *     whose session it is (`.userId`: ProjectAPI's records of who extended a
 *     trial or adjusted a balance, behind the master-admin gate), and the
 *     sign-out's, which ends the session the token names and takes whose
 *     session and which - `{ userId, sessionId }`, destructured where it is
 *     decoded, in POST /logout alone (SESSION_ENDERS);
 *   - readRequestSession asks UserService.isUserMasterAdmin, and does so
 *     before it answers with a user's session;
 *   - the master-admin gates and the Admin Dashboard's page read the session
 *     through readRequestSession, never the token themselves;
 *   - nothing reads a master admin claim off a token's raw claims
 *     (JSONWebToken.decodeJsonPayload), which no reader holds to anything.
 *
 * TokenPurposeGuard keeps JSONWebToken called directly, by that name, so a
 * call of it is always a `JSONWebToken.<method>(...)` this guard can see.
 * Read from the code by TypeScript's own parser, so a word in a comment is
 * never taken for code.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;
const DECODES_A_TOKEN: RegExp =
  /\bJSONWebToken\.(?:decode|decodeJsonPayload)\(/;

const JSON_WEB_TOKEN_MODULE: string =
  "packages/Common/Server/Utils/JsonWebToken.ts";
const USER_AUTHORIZATION: string =
  "packages/Common/Server/Middleware/UserAuthorization.ts";
const MASTER_ADMIN_AUTHORIZATION: string =
  "packages/Common/Server/Middleware/MasterAdminAuthorization.ts";
const MASTER_ADMIN_PAGE_ACCESS: string =
  "packages/Common/Server/Utils/MasterAdminPageAccess.ts";

// The one session reader.
const SESSION_READER: FunctionAt = {
  file: USER_AUTHORIZATION,
  name: "readRequestSession",
};

/*
 * The places that decode a session's token for nothing but whose session it
 * is: the audit records of two master-admin actions.
 */
const USER_ID_ONLY_READERS: Array<string> = [
  "packages/Common/Server/API/ProjectAPI.ts",
];

/*
 * The places that decode a session's token to END that session, by route,
 * and what they take from it: whose session it is and which, destructured
 * where it is decoded - so nothing else of the session is kept under a
 * name, passed on or read later - and no claim that grants anything, the
 * master admin claim above all. Ending a session gives its holder nothing.
 */
const SESSION_ENDERS: Array<{
  file: string;
  route: string;
  claims: Array<string>;
  why: string;
}> = [
  {
    file: "packages/App/FeatureSet/Identity/API/Authentication.ts",
    route: "post /logout",
    claims: ["sessionId", "userId"],
    why: "a sign-out ends the session the request's own access token names, expired or not, when its refresh token matches none: a renewal whose answer was lost rotated it (issue #8592)",
  },
];

// What decides whether a session is a master admin's, and must read the session through the one reader.
const MASTER_ADMIN_GATES: Array<FunctionAt> = [
  {
    file: MASTER_ADMIN_AUTHORIZATION,
    name: "isAuthorizedMasterAdminMiddleware",
  },
  { file: MASTER_ADMIN_PAGE_ACCESS, name: "ensureMasterAdminPageAccess" },
];

interface FunctionAt {
  file: string;
  name: string;
}

interface CallAt {
  file: string;
  line: number;
  // The function or method it is in, by name, or "" at the top of the file.
  within: string;
  // What is read off the call's result, when it is read straight away.
  readOff: string | null;
  // The second argument, as written.
  purpose: string | null;
  // The claims read off the result through the name it is kept under, or destructured from it.
  claimsRead: Array<string>;
  /*
   * The claims the result is destructured into where it is decoded
   * (`const { a, b } = decode(...)`), "..." for a rest element - or null
   * when it is not destructured there.
   */
  destructured: Array<string> | null;
  // The route it is in, `<method> <path>` of the router call around it, or null.
  route: string | null;
}

function sourceOf(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

// `JSONWebToken.<method>(...)`.
function isJsonWebTokenCall(node: ts.Node, method: string): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "JSONWebToken" &&
    node.expression.name.text === method
  );
}

// The name a function-like node is known by: a method, a function, or the variable it is assigned to.
function nameOfFunction(node: ts.Node): string | null {
  if (
    (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
    node.name &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }

  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }

  return null;
}

// The nearest named function or method a node is in.
function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    const name: string | null = nameOfFunction(current);

    if (name) {
      return name;
    }

    current = current.parent;
  }

  return "";
}

// The expression a value is used as: through parentheses, awaits and type assertions.
function outermost(node: ts.Node): ts.Node {
  let current: ts.Node = node;

  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAwaitExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent))
  ) {
    current = current.parent;
  }

  return current;
}

// What is read off an expression's value straight away (`decode(...).userId`), or null.
function propertyReadOff(node: ts.Node): string | null {
  const used: ts.Node = outermost(node);

  if (!used.parent) {
    return null;
  }

  if (
    ts.isPropertyAccessExpression(used.parent) &&
    used.parent.expression === used
  ) {
    return used.parent.name.text;
  }

  if (
    ts.isElementAccessExpression(used.parent) &&
    used.parent.expression === used &&
    ts.isStringLiteralLike(used.parent.argumentExpression)
  ) {
    return used.parent.argumentExpression.text;
  }

  return null;
}

/*
 * The claims read off a call's value through the name it is kept under
 * (`const claims = decodeJsonPayload(...)`, then `claims.x` or
 * `claims["x"]`), or destructured from it, in the function it is in.
 */
function claimsReadThroughName(node: ts.Node, scope: ts.Node): Array<string> {
  const used: ts.Node = outermost(node);
  const holder: ts.Node | undefined = used.parent;
  let name: string | null = null;

  if (holder && ts.isVariableDeclaration(holder)) {
    if (ts.isObjectBindingPattern(holder.name)) {
      return holder.name.elements.map((element: ts.BindingElement): string => {
        const key: ts.Node = element.propertyName || element.name;
        return ts.isIdentifier(key) || ts.isStringLiteral(key)
          ? key.text
          : key.getText();
      });
    }

    if (ts.isIdentifier(holder.name)) {
      name = holder.name.text;
    }
  }

  // `claims = JSONWebToken.decodeJsonPayload(...)`, to a name declared before.
  if (
    holder &&
    ts.isBinaryExpression(holder) &&
    holder.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    holder.right === used &&
    ts.isIdentifier(holder.left)
  ) {
    name = holder.left.text;
  }

  if (!name) {
    return [];
  }

  const claims: Array<string> = [];

  visit(scope, (child: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === name
    ) {
      claims.push(child.name.text);
    }

    if (
      ts.isElementAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === name &&
      ts.isStringLiteralLike(child.argumentExpression)
    ) {
      claims.push(child.argumentExpression.text);
    }
  });

  return claims;
}

// The function or method a node is in, or the file.
function enclosingScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isFunctionLike(current)) {
      return current;
    }

    if (!current.parent) {
      return current;
    }

    current = current.parent;
  }

  return node;
}

/*
 * The claims a call's value is destructured into where it is decoded
 * (`const { a, b: c } = decode(...)` is ["a", "b"]), with "..." for a rest
 * element, which keeps the rest of the value - or null when the value is
 * not destructured there.
 */
function destructuredClaims(node: ts.Node): Array<string> | null {
  const used: ts.Node = outermost(node);
  const holder: ts.Node | undefined = used.parent;

  if (
    !holder ||
    !ts.isVariableDeclaration(holder) ||
    holder.initializer !== used ||
    !ts.isObjectBindingPattern(holder.name)
  ) {
    return null;
  }

  return holder.name.elements.map((element: ts.BindingElement): string => {
    if (element.dotDotDotToken) {
      return "...";
    }

    const key: ts.Node = element.propertyName || element.name;

    return ts.isIdentifier(key) || ts.isStringLiteral(key)
      ? key.text
      : key.getText();
  });
}

/*
 * The route a node is in: `<method> <path>` of the nearest
 * `router.<method>("<path>", ...)` around it, or null.
 */
function enclosingRoute(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "router" &&
      current.arguments[0] &&
      ts.isStringLiteralLike(current.arguments[0])
    ) {
      return `${current.expression.name.text} ${current.arguments[0].text}`;
    }

    current = current.parent;
  }

  return null;
}

// Every `JSONWebToken.<method>(...)` in one file's code, and how its value is used.
function decodeCallsIn(
  file: string,
  source: ts.SourceFile,
  method: string,
): Array<CallAt> {
  const calls: Array<CallAt> = [];

  visit(source, (node: ts.Node): void => {
    if (!isJsonWebTokenCall(node, method)) {
      return;
    }

    const call: ts.CallExpression = node as ts.CallExpression;
    const purposeArgument: ts.Expression | undefined = call.arguments[1];

    calls.push({
      file: file,
      line:
        source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1,
      within: enclosingFunctionName(call),
      readOff: propertyReadOff(call),
      purpose: purposeArgument ? purposeArgument.getText(source) : null,
      claimsRead: claimsReadThroughName(call, enclosingScope(call)),
      destructured: destructuredClaims(call),
      route: enclosingRoute(call),
    });
  });

  return calls;
}

function decodeCalls(method: string): Array<CallAt> {
  const calls: Array<CallAt> = [];

  for (const file of listProductFiles(REPOSITORY_DIRECTORY, [
    "packages",
    "ee",
  ])) {
    if (!CODE_FILE.test(file) || file === JSON_WEB_TOKEN_MODULE) {
      continue;
    }

    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    if (!DECODES_A_TOKEN.test(text)) {
      continue;
    }

    calls.push(...decodeCallsIn(file, sourceOf(file), method));
  }

  return calls;
}

/*
 * Whether a decode of a session's token may take what it takes: in
 * readRequestSession, which holds the master admin claim to the account;
 * for its userId alone, in a file listed for that; or, in a route listed
 * as ending the session, destructured into exactly the claims listed.
 */
function isAllowedSessionDecode(call: CallAt): boolean {
  if (
    call.file === SESSION_READER.file &&
    call.within === SESSION_READER.name
  ) {
    return true;
  }

  if (USER_ID_ONLY_READERS.includes(call.file) && call.readOff === "userId") {
    return true;
  }

  return SESSION_ENDERS.some(
    (ender: {
      file: string;
      route: string;
      claims: Array<string>;
    }): boolean => {
      return (
        call.file === ender.file &&
        call.route === ender.route &&
        call.destructured !== null &&
        [...call.destructured].sort().join(",") ===
          [...ender.claims].sort().join(",")
      );
    },
  );
}

// A file's code, as the scan reads it, for the checks on the guard itself.
function sourceFromText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(file),
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

// The body of a function or method, by name, as code (no comments).
function functionNode(at: FunctionAt): ts.Node {
  const source: ts.SourceFile = sourceOf(at.file);
  let found: ts.Node | null = null;

  visit(source, (node: ts.Node): void => {
    if (!found && nameOfFunction(node) === at.name) {
      found = node;
    }
  });

  if (!found) {
    throw new Error(`${at.file}: no function named ${at.name}`);
  }

  return found;
}

// Every `<object>.<method>(...)` call in a function, as "object.method".
function callsIn(at: FunctionAt): Array<{ name: string; position: number }> {
  const calls: Array<{ name: string; position: number }> = [];

  visit(functionNode(at), (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      calls.push({
        name: `${node.expression.expression.text}.${node.expression.name.text}`,
        position: node.getStart(),
      });
    }
  });

  return calls;
}

const sessionDecodes: Array<CallAt> = decodeCalls("decode").filter(
  (call: CallAt): boolean => {
    return call.purpose === "JsonWebTokenPurpose.UserSession";
  },
);

describe("a session's master admin claim counts only through readRequestSession", () => {
  test("the scan found the session reader's own decode", () => {
    expect(
      sessionDecodes.some((call: CallAt): boolean => {
        return (
          call.file === SESSION_READER.file &&
          call.within === SESSION_READER.name
        );
      }),
    ).toBe(true);
  });

  test("a session's token is decoded only by readRequestSession, for its userId alone, or to end the session it names", () => {
    const elsewhere: Array<string> = sessionDecodes
      .filter((call: CallAt): boolean => {
        return !isAllowedSessionDecode(call);
      })
      .map((call: CallAt): string => {
        const reads: string = call.destructured
          ? `{ ${call.destructured.join(", ")} }`
          : call.readOff || "the whole session";

        return `${call.file}:${call.line} (in ${call.route || call.within || "the file"}, reads ${reads})`;
      });

    expect(elsewhere).toEqual([]);
  });

  test("every route listed as ending a session still decodes one, and takes exactly what is listed", () => {
    for (const ender of SESSION_ENDERS) {
      const calls: Array<CallAt> = sessionDecodes.filter(
        (call: CallAt): boolean => {
          return call.file === ender.file && call.route === ender.route;
        },
      );

      expect({ ender: ender.route, reads: calls.length }).toEqual({
        ender: ender.route,
        reads: 1,
      });
      expect({
        ender: ender.route,
        takes: [...(calls[0]!.destructured || [])].sort(),
      }).toEqual({ ender: ender.route, takes: [...ender.claims].sort() });
      expect(ender.claims).not.toContain("isMasterAdmin");
      expect(ender.why.length).toBeGreaterThan(20);
    }
  });

  test("every place listed as reading only the userId still does", () => {
    for (const file of USER_ID_ONLY_READERS) {
      const calls: Array<CallAt> = sessionDecodes.filter(
        (call: CallAt): boolean => {
          return call.file === file;
        },
      );

      expect({ file, reads: calls.length > 0 }).toEqual({ file, reads: true });

      for (const call of calls) {
        expect({ file, line: call.line, readOff: call.readOff }).toEqual({
          file,
          line: call.line,
          readOff: "userId",
        });
      }
    }
  });

  test("readRequestSession holds the claim to the account before it answers with a user's session", () => {
    const reader: ts.Node = functionNode(SESSION_READER);
    const asked: Array<{ name: string; position: number }> = callsIn(
      SESSION_READER,
    ).filter((call: { name: string; position: number }): boolean => {
      return call.name === "UserService.isUserMasterAdmin";
    });

    expect(asked).toHaveLength(1);

    // Every `kind: "user"` answer comes after the account is asked.
    const userAnswers: Array<number> = [];

    visit(reader, (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "kind" &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text === "user"
      ) {
        userAnswers.push(node.getStart());
      }
    });

    expect(userAnswers.length).toBeGreaterThan(0);

    for (const answer of userAnswers) {
      expect(answer).toBeGreaterThan(asked[0]!.position);
    }
  });

  test.each(MASTER_ADMIN_GATES)(
    "$file $name reads the session through readRequestSession",
    (gate: FunctionAt) => {
      const names: Array<string> = callsIn(gate).map(
        (call: { name: string; position: number }): string => {
          return call.name;
        },
      );

      expect(names).toContain("UserMiddleware.readRequestSession");
      expect(
        names.filter((name: string): boolean => {
          return name.startsWith("JSONWebToken.");
        }),
      ).toEqual([]);
    },
  );

  test("nothing reads a master admin claim off a token's raw claims", () => {
    const rawReaders: Array<CallAt> = decodeCalls("decodeJsonPayload");

    // The scan sees them: RealtimeJoinAccess reads a session's times this way.
    expect(
      rawReaders.some((call: CallAt): boolean => {
        return (
          call.file ===
            "packages/Common/Server/Utils/Realtime/RealtimeJoinAccess.ts" &&
          call.claimsRead.includes("exp")
        );
      }),
    ).toBe(true);

    const readingTheClaim: Array<string> = rawReaders
      .filter((call: CallAt): boolean => {
        return (
          call.readOff === "isMasterAdmin" ||
          call.claimsRead.includes("isMasterAdmin")
        );
      })
      .map((call: CallAt): string => {
        return `${call.file}:${call.line}`;
      });

    expect(readingTheClaim).toEqual([]);
  });
});

/*
 * The allowance for ending a session is that one read and nothing like it
 * (issue #8673): the guard, run on code written here, takes the read
 * POST /logout makes and refuses every way of taking more from the token,
 * keeping it whole, or doing the same anywhere else.
 */
describe("the guard allows ending a session by exactly the read listed, and nothing more", () => {
  const ENDER: { file: string; route: string } = SESSION_ENDERS[0]!;

  const LISTED_READ: string =
    "const { userId, sessionId }: JSONWebTokenData = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });";

  interface WrittenRead {
    file?: string;
    // `<method> <path>` of the route it is in; null for a plain function.
    route?: string | null;
    read: string;
  }

  // The session decodes of a file of this code: `read`, in its route.
  function sessionDecodesOf(written: WrittenRead): Array<CallAt> {
    const route: string | null =
      written.route === undefined ? ENDER.route : written.route;
    const [method, routePath] = (route || " ").split(" ");
    const code: string =
      route === null
        ? `async function endSession(token: string): Promise<void> {\n  ${written.read}\n}\n`
        : `router.${method}("${routePath}", async (req, res) => {\n  ${written.read}\n});\n`;
    const file: string = written.file || ENDER.file;

    return decodeCallsIn(file, sourceFromText(file, code), "decode").filter(
      (call: CallAt): boolean => {
        return call.purpose === "JsonWebTokenPurpose.UserSession";
      },
    );
  }

  function isAllowed(written: WrittenRead): boolean {
    const calls: Array<CallAt> = sessionDecodesOf(written);

    expect(calls).toHaveLength(1);

    return isAllowedSessionDecode(calls[0]!);
  }

  test("the read POST /logout makes is allowed, and is the read it makes", () => {
    expect(isAllowed({ read: LISTED_READ })).toBe(true);

    const actual: Array<CallAt> = sessionDecodes.filter(
      (call: CallAt): boolean => {
        return call.file === ENDER.file && call.route === ENDER.route;
      },
    );

    expect(actual).toHaveLength(1);
    expect([...(actual[0]!.destructured || [])].sort()).toEqual([
      "sessionId",
      "userId",
    ]);
  });

  test.each([
    {
      name: "the whole session, kept under a name",
      read: "const session: JSONWebTokenData = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true }); end(session.userId, session.sessionId);",
    },
    {
      name: "the master admin claim besides",
      read: "const { userId, sessionId, isMasterAdmin } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });",
    },
    {
      name: "the rest of the session, kept",
      read: "const { userId, sessionId, ...rest } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });",
    },
    {
      name: "the master admin claim, renamed as the user",
      read: "const { isMasterAdmin: userId, sessionId } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });",
    },
    {
      name: "another claim in place of one listed",
      read: "const { userId, email } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });",
    },
    {
      name: "fewer claims than listed",
      read: "const { userId } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true });",
    },
    {
      name: "the master admin claim, read off the call",
      read: "const isAdmin: boolean = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession).isMasterAdmin;",
    },
    {
      name: "the session, handed on",
      read: "await act(JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true }));",
    },
    {
      name: "the listed claims, assigned to names declared before",
      read: "({ userId, sessionId } = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, { acceptExpired: true }));",
    },
  ])("refused, in the listed route: $name", ({ read }: { read: string }) => {
    expect(isAllowed({ read })).toBe(false);
  });

  test.each([
    { name: "another route of the same file", route: "post /refresh-token" },
    { name: "the same path, by another method", route: "get /logout" },
    { name: "no route at all", route: null },
  ])(
    "refused, the listed read itself: $name",
    ({ route }: { route: string | null }) => {
      expect(isAllowed({ read: LISTED_READ, route })).toBe(false);
    },
  );

  test("refused, the listed read itself in another file", () => {
    for (const file of [
      "packages/Common/Server/API/ProjectAPI.ts",
      "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts",
      "packages/Common/Server/Middleware/UserAuthorization.ts",
    ]) {
      expect({ file, allowed: isAllowed({ file, read: LISTED_READ }) }).toEqual(
        { file, allowed: false },
      );
    }
  });

  test("the reads allowed before are allowed as before, and only they", () => {
    expect(
      isAllowed({
        file: "packages/Common/Server/API/ProjectAPI.ts",
        route: "post /extend-trial",
        read: "const userId: ObjectID = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession).userId;",
      }),
    ).toBe(true);
    expect(
      isAllowed({
        file: "packages/Common/Server/API/ProjectAPI.ts",
        route: "post /extend-trial",
        read: "const admin: boolean = JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession).isMasterAdmin;",
      }),
    ).toBe(false);
  });
});
