import fs from "fs";
import Path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EVERY OPENID CONNECT CALLBACK THAT FINDS OR MAKES A ONEUPTIME ACCOUNT BY
 * THE PROVIDER'S ADDRESS ASKS FIRST WHETHER THE PROVIDER VERIFIED IT
 * (GHSA-8gwc-w386-fh6w).
 *
 * The rule is in Utils/OidcEmailVerification and its gate in
 * Utils/OidcEmailVerificationGate; OidcUnverifiedEmailSignIn.test.ts and
 * OidcEmailVerifiedEndToEnd.test.ts drive the two callbacks that ask it.
 * This holds the source to it, so a callback added later, or one moved
 * around, cannot leave the question out:
 *
 *   - each route file that exchanges an OpenID Connect code and then reads,
 *     makes or signs in a OneUptime account (UserService, the project gate,
 *     a session) is one of the two that ask: API/GlobalOIDC.ts and
 *     API/OIDC.ts;
 *   - each asks once, right after the exchange and before any account is
 *     read, made, emailed, provisioned or signed in, and stops there when
 *     the gate answered;
 *   - the status page's, dashboard's and form's OpenID Connect callbacks
 *     make private users of their own and touch no OneUptime account: they
 *     are left as they are (Utils/OidcEmailVerification says why), and are
 *     named here so one that starts to is noticed.
 * ---------------------------------------------------------------------------
 */

const API: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Identity",
  "API",
);

const EXCHANGE: string = "OIDCUtil.exchangeCodeAndValidate";
const GATE: string = "OidcEmailVerificationGate.refuseUnverifiedAddress";

// What reads, makes, emails, provisions or signs in a OneUptime account.
const ACCOUNT_CALLS: ReadonlyArray<string> = [
  "UserService.findOneBy",
  "UserService.createByEmail",
  "UserService.updateOneById",
  "ProjectSsoSignInGate.decide",
  "ProjectSsoSignInGate.joinOnSignIn",
  "AuthenticationEmail.sendVerificationEmail",
  "SsoTeamMembership.addToTeams",
  "AccessTokenService.refreshUserAllPermissions",
  "UserSessionService.createSession",
];

const ACCOUNT_LINKING_CALLBACKS: ReadonlyArray<string> = [
  "GlobalOIDC.ts",
  "OIDC.ts",
];

const PRIVATE_USER_CALLBACKS: ReadonlyArray<string> = [
  "DashboardOIDC.ts",
  "FormOIDC.ts",
  "StatusPageOIDC.ts",
];

interface Call {
  // "Receiver.method", as written.
  name: string;
  position: number;
  node: ts.CallExpression;
}

interface RouteFile {
  file: string;
  source: ts.SourceFile;
  calls: Array<Call>;
}

function readRouteFile(file: string): RouteFile {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(Path.join(API, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  const calls: Array<Call> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      calls.push({
        name: `${node.expression.expression.text}.${node.expression.name.text}`,
        position: node.getStart(source),
        node: node,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { file, source, calls };
}

function callsNamed(routeFile: RouteFile, name: string): Array<Call> {
  return routeFile.calls.filter((call: Call): boolean => {
    return call.name === name;
  });
}

const ROUTE_FILES: Array<RouteFile> = fs
  .readdirSync(API)
  .filter((file: string): boolean => {
    return file.endsWith(".ts");
  })
  .sort()
  .map(readRouteFile);

const EXCHANGING: Array<RouteFile> = ROUTE_FILES.filter(
  (routeFile: RouteFile): boolean => {
    return callsNamed(routeFile, EXCHANGE).length > 0;
  },
);

function touchesAccounts(routeFile: RouteFile): boolean {
  return routeFile.calls.some((call: Call): boolean => {
    return ACCOUNT_CALLS.includes(call.name);
  });
}

describe("OpenID Connect callbacks and the provider's word on the address", () => {
  test("the scan finds every OpenID Connect callback", () => {
    expect(
      EXCHANGING.map((routeFile: RouteFile): string => {
        return routeFile.file;
      }),
    ).toEqual([...ACCOUNT_LINKING_CALLBACKS, ...PRIVATE_USER_CALLBACKS].sort());
  });

  test("the ones that find or make a OneUptime account are the two that ask", () => {
    expect(
      EXCHANGING.filter(touchesAccounts).map((routeFile: RouteFile): string => {
        return routeFile.file;
      }),
    ).toEqual([...ACCOUNT_LINKING_CALLBACKS]);
  });

  test("the status page's, dashboard's and form's touch no OneUptime account", () => {
    for (const file of PRIVATE_USER_CALLBACKS) {
      const routeFile: RouteFile = ROUTE_FILES.find(
        (candidate: RouteFile): boolean => {
          return candidate.file === file;
        },
      )!;

      expect({ file, touchesAccounts: touchesAccounts(routeFile) }).toEqual({
        file,
        touchesAccounts: false,
      });
    }
  });

  describe.each(ACCOUNT_LINKING_CALLBACKS)("%s", (file: string) => {
    const routeFile: RouteFile = ROUTE_FILES.find(
      (candidate: RouteFile): boolean => {
        return candidate.file === file;
      },
    )!;

    test("exchanges the code once, and asks the gate once", () => {
      expect(callsNamed(routeFile, EXCHANGE)).toHaveLength(1);
      expect(callsNamed(routeFile, GATE)).toHaveLength(1);
    });

    test("asks right after the exchange, before any account is read, made, emailed, provisioned or signed in", () => {
      const exchange: Call = callsNamed(routeFile, EXCHANGE)[0]!;
      const gate: Call = callsNamed(routeFile, GATE)[0]!;

      expect(gate.position).toBeGreaterThan(exchange.position);

      const accountCallsBeforeTheGate: Array<string> = routeFile.calls
        .filter((call: Call): boolean => {
          return (
            ACCOUNT_CALLS.includes(call.name) && call.position < gate.position
          );
        })
        .map((call: Call): string => {
          return call.name;
        });

      expect(accountCallsBeforeTheGate).toEqual([]);

      // And the callback does read an account after it: the scan sees them.
      expect(
        routeFile.calls.some((call: Call): boolean => {
          return (
            ACCOUNT_CALLS.includes(call.name) && call.position > gate.position
          );
        }),
      ).toBe(true);
    });

    test("waits for the gate's answer, and stops when it answered", () => {
      const gate: Call = callsNamed(routeFile, GATE)[0]!;

      const awaited: ts.Node = gate.node.parent;
      expect(ts.isAwaitExpression(awaited)).toBe(true);

      const condition: ts.Node = awaited.parent;
      expect(ts.isIfStatement(condition)).toBe(true);

      const ifStatement: ts.IfStatement = condition as ts.IfStatement;
      expect(ifStatement.expression).toBe(awaited);

      let returns: boolean = false;

      const findReturn: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isReturnStatement(node)) {
          returns = true;
        }

        ts.forEachChild(node, findReturn);
      };

      findReturn(ifStatement.thenStatement);

      expect(returns).toBe(true);
    });
  });
});
