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
 *     trial or adjusted a balance, behind the master-admin gate);
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

    const source: ts.SourceFile = sourceOf(file);

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
      });
    });
  }

  return calls;
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

  test("a session's token is decoded only by readRequestSession, or for its userId alone", () => {
    const elsewhere: Array<string> = sessionDecodes
      .filter((call: CallAt): boolean => {
        if (
          call.file === SESSION_READER.file &&
          call.within === SESSION_READER.name
        ) {
          return false;
        }

        return !(
          USER_ID_ONLY_READERS.includes(call.file) && call.readOff === "userId"
        );
      })
      .map((call: CallAt): string => {
        return `${call.file}:${call.line} (in ${call.within || "the file"}, reads ${call.readOff || "the whole session"})`;
      });

    expect(elsewhere).toEqual([]);
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
