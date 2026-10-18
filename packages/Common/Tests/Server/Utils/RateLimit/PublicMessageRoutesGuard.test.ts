import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { PublicMessageKind } from "../../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY PUBLIC ROUTE THAT SENDS A MESSAGE TO AN ADDRESS ITS CALLER NAMES
 * ASKS PublicMessageRateLimit FIRST.
 *
 * The routes anyone can call without signing in that send a message to a
 * contact the request names - a status page sign-up, a status page manage
 * link, a status page private user's password reset, an account's password
 * reset, the emails an account sign-up sends - are each limited per caller
 * and per contact by PublicMessageRateLimit.assertMaySend. The route suites
 * (StatusPageSubscriberMessageLimits.test.ts here, PasswordResetAndSignUp-
 * EmailLimits.test.ts and StatusPagePasswordResetLimits.test.ts in App)
 * drive each one; this guard holds the wiring itself, read from the code
 * with its comments removed:
 *
 *  - each route asks, with its own kind, before each thing it sends or
 *    creates - with no other send in between, so a branch that sends cannot
 *    lose its own count to a count made for another branch;
 *  - nothing else asks: a new route that sends to a caller-named address is
 *    listed here, with its kind and a suite of its own;
 *  - every kind is asked for by a route, so none is left behind unused.
 */

interface PublicMessageRoute {
  // Where the route's handler is.
  file: string;

  /*
   * The handler: a method of the file's class, or the arrow function of a
   * route registered on its router (the path it is registered under).
   */
  method?: string | undefined;
  routePath?: string | undefined;

  kind: PublicMessageKind;

  /*
   * What the handler sends or creates, each of which must come after an
   * assertMaySend with no other of them in between.
   */
  sends: Array<string>;
}

const STATUS_PAGE_API: string = "packages/Common/Server/API/StatusPageAPI.ts";
const AUTHENTICATION: string =
  "packages/App/FeatureSet/Identity/API/Authentication.ts";
const STATUS_PAGE_AUTHENTICATION: string =
  "packages/App/FeatureSet/Identity/API/StatusPageAuthentication.ts";

const PUBLIC_MESSAGE_ROUTES: Array<PublicMessageRoute> = [
  {
    file: STATUS_PAGE_API,
    method: "subscribeToStatusPage",
    kind: PublicMessageKind.StatusPageSignUp,
    sends: ["StatusPageSubscriberService.createFromStatusPageSignUp("],
  },
  {
    file: STATUS_PAGE_API,
    method: "manageExistingSubscription",
    kind: PublicMessageKind.StatusPageManageLink,
    sends: [
      "StatusPageSubscriberService.findBy(",
      "this.sendManageSubscriptionLinks(",
    ],
  },
  {
    file: AUTHENTICATION,
    routePath: "/forgot-password",
    kind: PublicMessageKind.PasswordReset,
    sends: ["UserService.updateOneBy(", "MailService.sendMail("],
  },
  {
    file: AUTHENTICATION,
    routePath: "/signup",
    kind: PublicMessageKind.SignUpEmail,
    sends: [
      "AuthenticationEmail.sendCompleteRegistrationEmail(",
      "UserService.createUserOnSignup(",
      "MailService.sendMail(",
    ],
  },
  {
    file: STATUS_PAGE_AUTHENTICATION,
    routePath: "/forgot-password",
    kind: PublicMessageKind.StatusPagePasswordReset,
    sends: ["StatusPagePrivateUserService.updateOneBy(", "MailService.sendMail("],
  },
];

const ASKS: string = "PublicMessageRateLimit.assertMaySend(";
const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

function sourceOf(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

// A node's code, its comments removed by TypeScript's own printer.
function codeOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return ts
    .createPrinter({ removeComments: true })
    .printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

function findMethod(
  sourceFile: ts.SourceFile,
  name: string,
): ts.MethodDeclaration | undefined {
  let found: ts.MethodDeclaration | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// The handler of router.post(path, ...): the last argument of the call.
function findRouteHandler(
  sourceFile: ts.SourceFile,
  routePath: string,
): ts.Node | undefined {
  let found: ts.Node | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "router" &&
      node.arguments.length > 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.arguments[0] as ts.StringLiteral).text === routePath
    ) {
      found = node.arguments[node.arguments.length - 1];
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function handlerCodeOf(route: PublicMessageRoute): string {
  const sourceFile: ts.SourceFile = sourceOf(route.file);
  const handler: ts.Node | undefined = route.method
    ? findMethod(sourceFile, route.method)
    : findRouteHandler(sourceFile, route.routePath!);

  if (!handler) {
    throw new Error(
      `${route.file}: no handler ${route.method || route.routePath}`,
    );
  }

  return codeOf(handler, sourceFile);
}

// Every index at which `text` starts in `code`.
function indexesOf(code: string, text: string): Array<number> {
  const indexes: Array<number> = [];
  let index: number = code.indexOf(text);

  while (index !== -1) {
    indexes.push(index);
    index = code.indexOf(text, index + text.length);
  }

  return indexes;
}

function nameOf(route: PublicMessageRoute): string {
  return `${route.file} ${route.method || route.routePath}`;
}

describe("every public route that sends to a caller-named contact asks first", () => {
  test.each(
    PUBLIC_MESSAGE_ROUTES.map(
      (route: PublicMessageRoute): [string, PublicMessageRoute] => {
        return [nameOf(route), route];
      },
    ),
  )("%s", (_name: string, route: PublicMessageRoute) => {
    const code: string = handlerCodeOf(route);
    const asks: Array<number> = indexesOf(code, ASKS);

    expect(asks.length).toBeGreaterThan(0);

    // Every ask in the handler is for the route's own kind.
    for (const ask of asks) {
      const call: string = code.slice(ask, ask + 200);

      expect([nameOf(route), call]).toEqual([
        nameOf(route),
        expect.stringContaining(
          `kind: PublicMessageKind.${
            Object.keys(PublicMessageKind).find((key: string): boolean => {
              return (
                PublicMessageKind[key as keyof typeof PublicMessageKind] ===
                route.kind
              );
            })!
          }`,
        ),
      ]);
    }

    const sends: Array<{ marker: string; index: number }> = route.sends.flatMap(
      (marker: string): Array<{ marker: string; index: number }> => {
        const found: Array<number> = indexesOf(code, marker);

        expect([nameOf(route), marker, found.length > 0]).toEqual([
          nameOf(route),
          marker,
          true,
        ]);

        return found.map((index: number): { marker: string; index: number } => {
          return { marker: marker, index: index };
        });
      },
    );

    /*
     * Each send is preceded by an ask, and no other send lies between that
     * ask and it - except the sends it makes right after one ask, in order:
     * a lookup and then the message it finds, a token written and then the
     * email that carries it.
     */
    for (const send of sends) {
      const ask: number | undefined = asks
        .filter((index: number): boolean => {
          return index < send.index;
        })
        .pop();

      expect([nameOf(route), send.marker, ask !== undefined]).toEqual([
        nameOf(route),
        send.marker,
        true,
      ]);

      const between: Array<string> = sends
        .filter((other: { marker: string; index: number }): boolean => {
          return other.index > ask! && other.index < send.index;
        })
        .map((other: { marker: string; index: number }): string => {
          return other.marker;
        });

      // Only sends that come earlier in the route's own list may sit there.
      const earlierInList: Array<string> = route.sends.slice(
        0,
        route.sends.indexOf(send.marker),
      );

      for (const marker of between) {
        expect([nameOf(route), send.marker, marker, earlierInList]).toEqual([
          nameOf(route),
          send.marker,
          marker,
          expect.arrayContaining([marker]),
        ]);
      }
    }
  });
});

describe("nothing else asks, and every kind is asked for", () => {
  const askers: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
    "packages",
    "ee",
  ])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      return fs
        .readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8")
        .includes(ASKS);
    })
    .filter((relativePath: string): boolean => {
      const sourceFile: ts.SourceFile = sourceOf(relativePath);

      return codeOf(sourceFile, sourceFile).includes(ASKS);
    });

  test("the files that ask are the routes listed here", () => {
    expect(askers.sort()).toEqual(
      Array.from(
        new Set<string>(
          PUBLIC_MESSAGE_ROUTES.map((route: PublicMessageRoute): string => {
            return route.file;
          }),
        ),
      ).sort(),
    );
  });

  test("every kind is a listed route's", () => {
    expect(
      PUBLIC_MESSAGE_ROUTES.map((route: PublicMessageRoute): string => {
        return route.kind;
      }).sort(),
    ).toEqual(Object.values(PublicMessageKind).sort());
  });

  test("each listed file asks only from its listed handlers", () => {
    for (const file of new Set<string>(
      PUBLIC_MESSAGE_ROUTES.map((route: PublicMessageRoute): string => {
        return route.file;
      }),
    )) {
      const sourceFile: ts.SourceFile = sourceOf(file);
      const inFile: number = indexesOf(
        codeOf(sourceFile, sourceFile),
        ASKS,
      ).length;
      const inHandlers: number = PUBLIC_MESSAGE_ROUTES.filter(
        (route: PublicMessageRoute): boolean => {
          return route.file === file;
        },
      ).reduce((total: number, route: PublicMessageRoute): number => {
        return total + indexesOf(handlerCodeOf(route), ASKS).length;
      }, 0);

      expect([file, inFile]).toEqual([file, inHandlers]);
    }
  });
});

describe("the guard's own reading", () => {
  test("finds a route's handler, and a method, by name", () => {
    expect(
      handlerCodeOf({
        file: AUTHENTICATION,
        routePath: "/forgot-password",
        kind: PublicMessageKind.PasswordReset,
        sends: [],
      }),
    ).toContain("resetPasswordToken");
    expect(
      handlerCodeOf({
        file: STATUS_PAGE_API,
        method: "manageExistingSubscription",
        kind: PublicMessageKind.StatusPageManageLink,
        sends: [],
      }),
    ).toContain("sendManageSubscriptionLinks");
  });

  test("reads code, not the comments around it", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "x.ts",
      "function f() {\n  // PublicMessageRateLimit.assertMaySend(\n  return 1;\n}\n",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(codeOf(sourceFile, sourceFile)).not.toContain(ASKS);
  });
});
