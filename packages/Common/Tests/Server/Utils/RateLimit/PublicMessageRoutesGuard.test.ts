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
 * reset, the emails an account sign-up sends, and the verification link a
 * sign-in to an address not verified yet sends - are each limited per
 * caller and per contact by PublicMessageRateLimit.assertMaySend. The route
 * suites drive each one (StatusPageSubscriberMessageLimits.test.ts here; in
 * App, PasswordResetAndSignUpEmailLimits.test.ts and
 * StatusPagePasswordResetLimits.test.ts); this guard holds the wiring
 * itself, read from the code with its comments removed:
 *
 *  - each branch of a route that sends or creates something asks first, with
 *    an ask of its own and the route's own kind, before the first thing it
 *    does - so a branch cannot lose its count to the count of another;
 *  - nothing else asks: a new route that sends to a caller-named address is
 *    listed here, with its kind and a suite of its own;
 *  - every kind is asked for by a route, so none is left behind unused.
 */

interface PublicMessageRoute {
  // Where the route's handler is.
  file: string;

  /*
   * The handler: a method of the file's class, the arrow function of a
   * route registered on its router (the path it is registered under), or a
   * function the file's routes share (the name it is declared under).
   */
  method?: string | undefined;
  routePath?: string | undefined;
  functionName?: string | undefined;

  kind: PublicMessageKind;

  /*
   * The branches of the handler that send or create something: each the
   * calls it makes, in order, after an ask of its own - a lookup and then
   * the link it finds, a token written and then the email that carries it.
   */
  branches: Array<Array<string>>;
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
    branches: [["StatusPageSubscriberService.createFromStatusPageSignUp("]],
  },
  {
    file: STATUS_PAGE_API,
    method: "manageExistingSubscription",
    kind: PublicMessageKind.StatusPageManageLink,
    branches: [
      [
        "StatusPageSubscriberService.findBy(",
        "this.sendManageSubscriptionLinks(",
      ],
    ],
  },
  {
    file: AUTHENTICATION,
    routePath: "/forgot-password",
    kind: PublicMessageKind.PasswordReset,
    branches: [["UserService.updateOneBy(", "MailService.sendMail("]],
  },
  {
    file: AUTHENTICATION,
    routePath: "/signup",
    kind: PublicMessageKind.SignUpEmail,
    branches: [
      // An invitation nobody has claimed: its registration link again.
      ["AuthenticationEmail.sendCompleteRegistrationEmail("],
      // A new account, and its welcome.
      ["UserService.createUserOnSignup(", "MailService.sendMail("],
    ],
  },
  {
    /*
     * Every sign-in step (/login, /verify-totp-auth, /verify-webauthn-auth,
     * /verify-backup-code, /verify-totp-enrolment) runs login(), which
     * mails an address not verified yet a fresh link - the same email a
     * sign-up sends, so the same kind.
     */
    file: AUTHENTICATION,
    functionName: "login",
    kind: PublicMessageKind.SignUpEmail,
    branches: [["AuthenticationEmail.sendVerificationEmail("]],
  },
  {
    file: STATUS_PAGE_AUTHENTICATION,
    routePath: "/forgot-password",
    kind: PublicMessageKind.StatusPagePasswordReset,
    branches: [
      ["StatusPagePrivateUserService.updateOneBy(", "MailService.sendMail("],
    ],
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

// The function a file declares under `name`: const name = ..., or function name.
function findFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Node | undefined {
  let found: ts.Node | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
      return;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
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

function handlerCodeOf(route: {
  file: string;
  method?: string | undefined;
  routePath?: string | undefined;
  functionName?: string | undefined;
}): string {
  const sourceFile: ts.SourceFile = sourceOf(route.file);
  let handler: ts.Node | undefined = undefined;

  if (route.method) {
    handler = findMethod(sourceFile, route.method);
  } else if (route.functionName) {
    handler = findFunction(sourceFile, route.functionName);
  } else {
    handler = findRouteHandler(sourceFile, route.routePath!);
  }

  if (!handler) {
    throw new Error(
      `${route.file}: no handler ${route.method || route.functionName || route.routePath}`,
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

function kindNameOf(kind: PublicMessageKind): string {
  return Object.keys(PublicMessageKind).find((key: string): boolean => {
    return PublicMessageKind[key as keyof typeof PublicMessageKind] === kind;
  })!;
}

/*
 * What is wrong with a handler's wiring, in words: an empty list when every
 * branch asks first, with an ask of its own, for the route's kind.
 */
function wiringProblems(
  code: string,
  kind: PublicMessageKind,
  branches: Array<Array<string>>,
): Array<string> {
  const problems: Array<string> = [];
  const asks: Array<number> = indexesOf(code, ASKS);

  if (asks.length !== branches.length) {
    problems.push(
      `asks ${asks.length} times for ${branches.length} branches that send`,
    );
  }

  for (const ask of asks) {
    // The call's own arguments: up to the next ask, or a few lines on.
    const call: string = code.slice(ask, ask + 200);

    if (!call.includes(`kind: PublicMessageKind.${kindNameOf(kind)},`)) {
      problems.push(`an ask that is not for ${kindNameOf(kind)}`);
    }
  }

  const asksTaken: Set<number> = new Set<number>();

  for (const branch of branches) {
    const first: number = code.indexOf(branch[0]!);

    if (first === -1) {
      problems.push(`${branch[0]} is not in the handler`);
      continue;
    }

    const ask: number | undefined = asks
      .filter((index: number): boolean => {
        return index < first;
      })
      .pop();

    if (ask === undefined) {
      problems.push(`${branch[0]} comes before any ask`);
      continue;
    }

    if (asksTaken.has(ask)) {
      problems.push(`${branch[0]} has no ask of its own`);
    }

    asksTaken.add(ask);

    let previous: number = first;

    for (const call of branch.slice(1)) {
      const at: number = code.indexOf(call, previous);

      if (at === -1) {
        problems.push(`${call} does not follow ${branch[0]}`);
        continue;
      }

      previous = at;
    }

    for (const call of branch) {
      for (const at of indexesOf(code, call)) {
        if (at < ask) {
          problems.push(`${call} comes before its ask`);
        }
      }
    }
  }

  return problems;
}

function nameOf(route: PublicMessageRoute): string {
  return `${route.file} ${route.method || route.functionName || route.routePath}`;
}

describe("every public route that sends to a caller-named contact asks first", () => {
  test.each(
    PUBLIC_MESSAGE_ROUTES.map(
      (route: PublicMessageRoute): [string, PublicMessageRoute] => {
        return [nameOf(route), route];
      },
    ),
  )("%s", (_name: string, route: PublicMessageRoute) => {
    expect([
      nameOf(route),
      wiringProblems(handlerCodeOf(route), route.kind, route.branches),
    ]).toEqual([nameOf(route), []]);
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
      Array.from(
        new Set<string>(
          PUBLIC_MESSAGE_ROUTES.map((route: PublicMessageRoute): string => {
            return route.kind;
          }),
        ),
      ).sort(),
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
  const ask: (kind: string) => string = (kind: string): string => {
    return `await PublicMessageRateLimit.assertMaySend({\n  req: req,\n  kind: PublicMessageKind.${kind},\n  contacts: [contact],\n});\n`;
  };

  const BRANCHES: Array<Array<string>> = [
    ["sendInvitation("],
    ["createAccount(", "sendWelcome("],
  ];

  test("passes a handler whose every branch asks first, for its own kind", () => {
    const code: string = `if (invited) {\n${ask("SignUpEmail")}sendInvitation();\n} else {\n${ask("SignUpEmail")}createAccount();\nsendWelcome();\n}`;

    expect(
      wiringProblems(code, PublicMessageKind.SignUpEmail, BRANCHES),
    ).toEqual([]);
  });

  test("fails a branch that leans on another branch's ask", () => {
    const code: string = `if (invited) {\n${ask("SignUpEmail")}sendInvitation();\n} else {\ncreateAccount();\nsendWelcome();\n}`;

    expect(
      wiringProblems(code, PublicMessageKind.SignUpEmail, BRANCHES),
    ).toEqual([
      "asks 1 times for 2 branches that send",
      "createAccount( has no ask of its own",
    ]);
  });

  test("fails a branch that sends before it asks", () => {
    const code: string = `createAccount();\n${ask("SignUpEmail")}sendWelcome();\n${ask("SignUpEmail")}sendInvitation();`;

    expect(
      wiringProblems(code, PublicMessageKind.SignUpEmail, [
        ["sendInvitation("],
        ["createAccount(", "sendWelcome("],
      ]),
    ).toEqual(["createAccount( comes before any ask"]);
  });

  test("fails an ask for another kind, and a call that is not there", () => {
    const code: string = `${ask("PasswordReset")}sendInvitation();`;

    expect(
      wiringProblems(code, PublicMessageKind.SignUpEmail, [
        ["sendInvitation("],
        ["createAccount("],
      ]),
    ).toEqual([
      "asks 1 times for 2 branches that send",
      "an ask that is not for SignUpEmail",
      "createAccount( is not in the handler",
    ]);
  });

  test("finds a route's handler, and a method, by name", () => {
    expect(
      handlerCodeOf({ file: AUTHENTICATION, routePath: "/forgot-password" }),
    ).toContain("resetPasswordToken");
    expect(
      handlerCodeOf({
        file: STATUS_PAGE_API,
        method: "manageExistingSubscription",
      }),
    ).toContain("sendManageSubscriptionLinks");
    expect(
      handlerCodeOf({ file: AUTHENTICATION, functionName: "login" }),
    ).toContain("verifyHashedColumnValue");
  });

  test("finds a function declared either way, and nothing that is not one", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "x.ts",
      "const login = async () => { sendLink(); };\nfunction logout() { forget(); }\nconst limit = 5;\n",
      ts.ScriptTarget.Latest,
      true,
    );

    expect(codeOf(findFunction(sourceFile, "login")!, sourceFile)).toContain(
      "sendLink()",
    );
    expect(codeOf(findFunction(sourceFile, "logout")!, sourceFile)).toContain(
      "forget()",
    );
    expect(findFunction(sourceFile, "limit")).toBeUndefined();
    expect(findFunction(sourceFile, "missing")).toBeUndefined();
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
