import { describe, expect, test } from "@jest/globals";
import path from "path";
import ts from "typescript";
import {
  COMMON_DIR,
  PACKAGES_DIR,
  listSourceFiles,
  readSources,
  toRelativePath,
} from "Common/Tests/Helpers/RefreshAwareApiScan";

/*
 * NO SIGN-OUT IS LEFT BEHIND BY THE PAGE CHANGE THAT FOLLOWS IT (issue #9508).
 *
 * A sign-out is a request to the server, whose answer clears the session's
 * HttpOnly cookies, and the sign-in page it is followed by is a page change.
 * Firefox cancels a request still on its way when the page changes, so the
 * Sign Out pages - which started the sign-out and changed the page on the
 * next line - left people signed in: `UserUtil.logout();` then
 * `Navigation.navigate(ACCOUNTS_URL);`. A sign-out now resolves once the
 * server has answered it, or once the wait for it is over (UI/Utils/
 * SignOutRequest), and whoever starts one waits for it, or hands it on to
 * a caller who does.
 *
 * This reads every browser module and holds each sign-out to that: a call
 * of a User util's logout, or of an API client's logoutUser, is awaited,
 * returned, or used - never dropped as a statement of its own, or with
 * `void`, which is how the bug was written. Parsed, not grepped, so a
 * comment or a string quoting a sign-out does not count, and UiAnalytics'
 * logout, which ends no session, is not one.
 */

const APP_DIR: string = path.join(PACKAGES_DIR, "App");

const BROWSER_SOURCE_ROOTS: Array<string> = [
  path.join(APP_DIR, "FeatureSet", "Dashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "Accounts", "src"),
  path.join(APP_DIR, "FeatureSet", "StatusPage", "src"),
  path.join(APP_DIR, "FeatureSet", "PublicDashboard", "src"),
  path.join(COMMON_DIR, "UI"),
];

// The modules whose logout ends a session: the dashboards' and a status page's.
const SIGN_OUT_MODULES: Array<string> = [
  path.join(COMMON_DIR, "UI", "Utils", "User"),
  path.join(APP_DIR, "FeatureSet", "StatusPage", "src", "Utils", "User"),
];

interface SignOutCall {
  line: number;
  // What it is, as written.
  call: string;
  isWaitedFor: boolean;
}

// The module a specifier names, without its extension; null for a package.
function resolveSpecifier(filePath: string, specifier: string): string | null {
  if (specifier.startsWith("Common/")) {
    return path.join(
      COMMON_DIR,
      ...specifier.slice("Common/".length).split("/"),
    );
  }

  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(filePath), specifier);
  }

  return null;
}

function isSignOutModule(filePath: string, specifier: string): boolean {
  const resolved: string | null = resolveSpecifier(filePath, specifier);

  return (
    resolved !== null &&
    SIGN_OUT_MODULES.includes(resolved.replace(/\.(ts|tsx)$/, ""))
  );
}

// The names a module gives the User utils it imports (`import UserUtil from ...`).
function signOutModuleNames(
  filePath: string,
  sourceFile: ts.SourceFile,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      statement.importClause?.name &&
      isSignOutModule(filePath, statement.moduleSpecifier.text)
    ) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

function isSignOutCall(
  node: ts.CallExpression,
  moduleNames: Set<string>,
): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return false;
  }

  const method: string = node.expression.name.text;
  const target: ts.Expression = node.expression.expression;

  // A User util's logout.
  if (
    method === "logout" &&
    ts.isIdentifier(target) &&
    moduleNames.has(target.text)
  ) {
    return true;
  }

  // An API client's: BaseAPI's, or a client's own (this.logoutUser()).
  return method === "logoutUser";
}

/*
 * Whether the page waits for it: anything but a statement of its own, or
 * `void`, uses what it resolves to - awaited, returned, handed on, chained.
 */
function isWaitedFor(node: ts.Node): boolean {
  let parent: ts.Node = node.parent;

  while (ts.isParenthesizedExpression(parent)) {
    parent = parent.parent;
  }

  return !ts.isExpressionStatement(parent) && !ts.isVoidExpression(parent);
}

function findSignOutCalls(
  filePath: string,
  source: string,
): Array<SignOutCall> {
  if (!source.includes("logout") && !source.includes("logoutUser")) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const moduleNames: Set<string> = signOutModuleNames(filePath, sourceFile);
  const calls: Array<SignOutCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSignOutCall(node, moduleNames)) {
      calls.push({
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        call: node.getText(sourceFile),
        isWaitedFor: isWaitedFor(node),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return calls;
}

describe("every sign-out is waited for before the page changes", () => {
  test("the detector reads syntax: a sign-out dropped, or dropped with void, and nothing else", () => {
    // It pretends to live in the Dashboard's pages, where "Common/UI/Utils/User" is the User util.
    const fixturePath: string = path.join(
      APP_DIR,
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "Logout",
      "DetectorFixture.tsx",
    );

    const calls: Array<SignOutCall> = findSignOutCalls(
      fixturePath,
      [
        'import UserUtil from "Common/UI/Utils/User";',
        'import UiAnalytics from "Common/UI/Utils/Analytics";',
        "UserUtil.logout();",
        "void UserUtil.logout();",
        "(UserUtil.logout());",
        "this.logoutUser();",
        "await UserUtil.logout();",
        "return UserUtil.logout();",
        "const signingOut = Promise.resolve(this.logoutUser());",
        "UserUtil.logout().then(() => { Navigation.navigate(ACCOUNTS_URL); });",
        "const later = () => UserUtil.logout();",
        "UiAnalytics.logout();",
        "// UserUtil.logout();",
        'const quoted = "UserUtil.logout();";',
      ].join("\n"),
    );

    expect(
      calls.map((call: SignOutCall): [number, boolean] => {
        return [call.line, call.isWaitedFor];
      }),
    ).toEqual([
      [3, false],
      [4, false],
      [5, false],
      [6, false],
      [7, true],
      [8, true],
      [9, true],
      [10, true],
      [11, true],
    ]);
  });

  test("a status page's User util, imported from beside it, is one too", () => {
    const fixturePath: string = path.join(
      APP_DIR,
      "FeatureSet",
      "StatusPage",
      "src",
      "Utils",
      "DetectorFixture.ts",
    );

    const calls: Array<SignOutCall> = findSignOutCalls(
      fixturePath,
      [
        'import UserUtil from "./User";',
        "UserUtil.logout(statusPageId);",
        "await UserUtil.logout(statusPageId);",
      ].join("\n"),
    );

    expect(
      calls.map((call: SignOutCall): boolean => {
        return call.isWaitedFor;
      }),
    ).toEqual([false, true]);
  });

  const browserFiles: Array<string> = BROWSER_SOURCE_ROOTS.flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Map<string, string> = readSources(browserFiles);

  const signOutsByFile: Map<string, Array<SignOutCall>> = new Map<
    string,
    Array<SignOutCall>
  >();

  for (const [file, source] of sources) {
    const calls: Array<SignOutCall> = findSignOutCalls(file, source);

    if (calls.length > 0) {
      signOutsByFile.set(toRelativePath(PACKAGES_DIR, file), calls);
    }
  }

  test("it sees the sign-outs it guards: the Sign Out pages, Delete Account, and the clients' own", () => {
    expect([...signOutsByFile.keys()]).toEqual(
      expect.arrayContaining([
        "App/FeatureSet/Dashboard/src/Pages/Logout/Logout.tsx",
        "App/FeatureSet/AdminDashboard/src/Pages/Logout/Logout.tsx",
        "App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount.tsx",
        "App/FeatureSet/StatusPage/src/Pages/Accounts/Logout.tsx",
        "App/FeatureSet/StatusPage/src/Utils/StatusPage.ts",
        "App/FeatureSet/StatusPage/src/Utils/API.ts",
        "Common/UI/Utils/API/API.ts",
      ]),
    );
  });

  test("no browser module starts a sign-out and leaves it behind", () => {
    const leftBehind: Array<string> = [];

    for (const [file, calls] of signOutsByFile) {
      for (const call of calls) {
        if (!call.isWaitedFor) {
          leftBehind.push(
            `${file}:${call.line} ${call.call} is not waited for: await it (or return it to a caller that does) before the page changes, or the page change cancels it in Firefox and the session's cookies stay (issue #9508).`,
          );
        }
      }
    }

    expect(leftBehind).toEqual([]);
  });
});
