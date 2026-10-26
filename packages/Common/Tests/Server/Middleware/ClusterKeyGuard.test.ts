import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import escapeRegExp from "../../../Utils/RegExpEscape";
import { INSTALLATION_CLUSTER_KEY_LABEL } from "../../../Server/Middleware/ClusterKeyAuthorization";
import {
  CLUSTER_KEY_MIDDLEWARES,
  CLUSTER_KEY_ROUTE_CALLERS,
  ClusterKeyMiddlewareUse,
  ClusterKeyRoute,
  ClusterKeyRouteCaller,
  SERVICE_MIDDLEWARE,
  findClusterKeyMiddlewareUses,
  findClusterKeyRoutes,
} from "../TestingUtils/ClusterKeyRoutes";
import {
  keepsRedirectsOnServer,
  propertyOf,
} from "../TestingUtils/KeyCarryingRequests";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ONE PLACE DECIDES WHICH CLUSTER KEY IS PRESENTED AND ACCEPTED.
 *
 * ClusterKeyAuthorization refuses a value this repository ships from every
 * caller, and presents a key of the installation's own when ONEUPTIME_SECRET
 * is one (see its header). That only holds while nothing else reads the
 * variable, compares a presented key, or sends one it made up itself. So,
 * across all product code (ee/ too, when it is checked out), comments
 * removed:
 *
 *   - only EnvironmentConfig reads ONEUPTIME_SECRET, and it has no fallback;
 *   - only ClusterKeyAuthorization reads the configured key
 *     (EnvironmentConfig.ClusterKey, IsClusterKeyShipped), and nothing reads
 *     whether one is set at all (HasClusterKey), as the Runner used to;
 *   - only ClusterKeyAuthorization reads a key a request carries - the
 *     clusterkey and x-clusterkey headers - and nothing writes one into a
 *     body or a URL (LogRedaction names it only to keep it out of logs);
 *   - a route takes the cluster key only by handing a router
 *     ClusterKeyAuthorization's one check, never by wrapping or storing it;
 *   - what let the shared Runner register with the cluster key, or with a
 *     key of its own, is gone, and no product code names it;
 *   - every route that takes it is called by OneUptime's own code, and every
 *     file that presents it presents it to such a route, in the header, in a
 *     request that follows a redirect only on the server it was sent to
 *     (sameServerRedirectsOnly - an HTTP client hands a redirected request's
 *     headers to wherever the redirect points);
 *   - only the app's own code (App, Common) presents the key, because only
 *     processes that load the installation's token signing key at boot
 *     (App/Index.ts) know the key an installation that kept a shipped value
 *     derives; no Runner presents it - every Runner proves who it is with its
 *     own id and key;
 *   - the check counts the different wrong keys a client sends
 *     (WrongClusterKeyLimit) in one place, after the key is compared and
 *     before the request is answered as right or wrong, and nothing else
 *     counts them; a key from a private network address, where every one of
 *     OneUptime's own services calls from, is never counted or refused, by
 *     the rule every wrong-key limit keeps (WrongKeyLimit).
 *
 * App's Tests/ClusterKey/ClusterKeyRoutesOverHttp sends every value this
 * repository ships to every route found here, and
 * Tests/ClusterKey/WrongClusterKeysOverHttp too many different wrong keys.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const ENVIRONMENT_CONFIG: string =
  "packages/Common/Server/EnvironmentConfig.ts";
const CLUSTER_KEY_AUTHORIZATION: string =
  "packages/Common/Server/Middleware/ClusterKeyAuthorization.ts";
const RUNNER_REGISTRATION: string =
  "packages/Runner/Services/RegisterRunner.ts";
const LOG_REDACTION: string = "packages/Common/Server/Utils/LogRedaction.ts";
const WEBHOOK_TRIGGER: string =
  "packages/Common/Server/Types/Workflow/Components/Webhook.ts";
const INCOMING_REQUEST_INGEST: string =
  "packages/App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts";
const WRONG_CLUSTER_KEY_LIMIT: string =
  "packages/Common/Server/Utils/RateLimit/WrongClusterKeyLimit.ts";
const WRONG_KEY_LIMIT: string =
  "packages/Common/Server/Utils/RateLimit/WrongKeyLimit.ts";

const ONEUPTIME_SECRET_READ: RegExp =
  /process\.env(?:\[\s*["'`]ONEUPTIME_SECRET["'`]\s*\]|\.ONEUPTIME_SECRET\b)/;

// The key's own name, the headers and the body field, any case, as a whole word.
const CLUSTER_KEY_WORD: RegExp = /\bclusterkey\b/i;

/*
 * What the shared Runner registered through, as the installation's global AI
 * agent: a check of its own, the clusterKey field Runners of earlier releases
 * sent, what the app told such a Runner, and the check of the shared
 * Runner's own key. All of it is gone with that Runner.
 */
const SHARED_RUNNER_REGISTRATION: RegExp =
  /\b(?:isAuthorizedRunnerRegistrationMiddleware|getOlderRunnerClusterKey|OLDER_RUNNER_CLUSTER_KEY_MESSAGE|RUNNER_CLUSTER_KEY_MESSAGE|SharedRunnerKeyAuthorization)\b/;

/*
 * Every file that presents the key, with the address it sends it to: one of
 * the installation's own, read from its configuration (the app's API, the
 * workflow service, the telemetry writer), never an address a project or a
 * request supplies.
 */
const PRESENTERS: Record<string, string> = {
  "packages/App/FeatureSet/Telemetry/Services/IncomingEmailWorkflowDelivery.ts":
    "WorkflowHostname",
  "packages/Common/Server/Services/CallService.ts": "AppApiHostname",
  "packages/Common/Server/Services/DatabaseService.ts": "WorkflowHostname",
  "packages/Common/Server/Services/MailService.ts": "AppApiHostname",
  "packages/Common/Server/Services/SmsService.ts": "AppApiHostname",
  "packages/Common/Server/Services/TelegramService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WebhookService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WhatsAppService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WorkflowService.ts": "WorkflowHostname",
  "packages/Common/Server/Utils/IncomingCallPhoneNumber.ts": "AppApiHostname",
  "packages/Common/Server/Utils/Telemetry/TelemetryWriterClient.ts":
    "TELEMETRY_WRITER_URL",
};

/*
 * Every product module that uses the token signing key itself. Each signs
 * something that can never be the cluster key's label: a JWT (its header and
 * payload, joined by a dot), a project SSO confirmation (its own purpose
 * first, the fields joined by colons), or keys derived under labels of their
 * own.
 */
const TOKEN_SIGNING_KEY_USERS: Array<string> = [
  "packages/App/FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation.ts",
  "packages/App/FeatureSet/Identity/Utils/VerificationEmailResendToken.ts",
  "packages/Common/Server/Middleware/ClusterKeyAuthorization.ts",
  "packages/Common/Server/Utils/JsonWebToken.ts",
  "packages/Common/Server/Utils/Mcp/McpOAuthSignedToken.ts",
  // Derives, under a label of its own, the key a wrong component key's digest is made with.
  "packages/Common/Server/Utils/RateLimit/WrongComponentKeyLimit.ts",
  "packages/Common/Server/Utils/TokenSigningKey.ts",
];

const TOKEN_SIGNING_KEY_USE: RegExp = /\bTokenSigningKey\.(?:get|deriveKey)\(/;

// The cluster key's label: lower-case words and hyphens, no dot and no colon.
const LABEL_SHAPE: RegExp = /^[a-z]+(?:-[a-z]+)*$/;

const PRESENTING_CALL: RegExp =
  /\bClusterKeyAuthorization\.(?:getClusterKeyHeaders|getClusterKey)\(/;

// Presenting the key as a bare value, to be put anywhere but a header.
const BARE_KEY_CALL: RegExp = /\bClusterKeyAuthorization\.getClusterKey\(/;

// What carries the key in a request, as ClusterKeyAuthorization reads it.
const REQUEST_PARTS: RegExp = /\breq\.(?:query|params|body)\b/;
const REQUEST_BODY: RegExp = /\breq\.body\b/;
const REQUEST_URL_PARTS: RegExp = /\breq\.(?:query|params)\b/;

// The code of a file, its comments removed by TypeScript's own printer.
function codeOf(relativePath: string): string {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_DIRECTORY, relativePath),
    "utf8",
  );

  return ts
    .createPrinter({ removeComments: true })
    .printFile(
      ts.createSourceFile(
        path.basename(relativePath),
        source,
        ts.ScriptTarget.Latest,
        true,
        relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    );
}

// A file's syntax tree (comments are no part of it).
function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// Where a node is, for a failure to name.
function placeOf(
  relativePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): string {
  const line: number =
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  return `${relativePath}:${line}: ${node.getText(sourceFile).slice(0, 120)}`;
}

/*
 * All that code outside ClusterKeyAuthorization uses of it: present the key
 * in a header, hand a router its check, and take the key's headers out of
 * headers it hands on. Nothing else reads, compares or holds the key, or the
 * class.
 */
const MEMBERS_USED_OUTSIDE: Array<string> = [
  "getClusterKeyHeaders",
  "isAuthorizedServiceMiddleware",
  "withoutClusterKeyHeaders",
];

// What an Express request is called where a route reads it.
const REQUEST_NAMES: Array<string> = ["req", "request"];

/*
 * Product code files whose raw text matches `pattern` (a cheap first pass),
 * then whose code does, comments removed.
 */
function productFilesWhoseCodeMatches(pattern: RegExp): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
      );
    })
    .filter((relativePath: string): boolean => {
      return pattern.test(codeOf(relativePath));
    })
    .sort();
}

/*
 * The product files that import one of these names from EnvironmentConfig,
 * under any local name.
 */
function filesImportingFromEnvironmentConfig(
  names: Array<string>,
): Array<string> {
  const importers: Array<string> = [];

  for (const relativePath of productFilesWhoseCodeMatches(
    /EnvironmentConfig/,
  )) {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      path.basename(relativePath),
      fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.endsWith("EnvironmentConfig")
      ) {
        continue;
      }

      const bindings: ts.NamedImportBindings | undefined =
        statement.importClause?.namedBindings;

      if (bindings && ts.isNamespaceImport(bindings)) {
        // A namespace import can read anything; the code is checked below.
        if (
          names.some((name: string): boolean => {
            return new RegExp(
              `\\b${escapeRegExp(bindings.name.text)}\\.${escapeRegExp(name)}\\b`,
            ).test(codeOf(relativePath));
          })
        ) {
          importers.push(relativePath);
        }

        continue;
      }

      if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some((element: ts.ImportSpecifier): boolean => {
          return names.includes((element.propertyName || element.name).text);
        })
      ) {
        importers.push(relativePath);
      }
    }
  }

  return importers.sort();
}

describe("ONEUPTIME_SECRET is read in one place, with no fallback", () => {
  test("only EnvironmentConfig reads the variable", () => {
    expect(productFilesWhoseCodeMatches(ONEUPTIME_SECRET_READ)).toEqual([
      ENVIRONMENT_CONFIG,
    ]);
  });

  test("EnvironmentConfig gives the cluster key no fallback value", () => {
    const code: string = codeOf(ENVIRONMENT_CONFIG);
    const declaration: string =
      code.split("export const ClusterKey: ObjectID")[1]?.split(";")[0] || "";

    expect(declaration).toContain('process.env["ONEUPTIME_SECRET"] || ""');
  });

  test("only ClusterKeyAuthorization reads the configured key, and nothing whether one is set", () => {
    expect(
      filesImportingFromEnvironmentConfig([
        "ClusterKey",
        "IsClusterKeyShipped",
      ]),
    ).toEqual([CLUSTER_KEY_AUTHORIZATION]);
    expect(filesImportingFromEnvironmentConfig(["HasClusterKey"])).toEqual([]);
  });
});

describe("a presented cluster key is read in one place", () => {
  test("only ClusterKeyAuthorization names the headers or the field, and LogRedaction only to keep it out of logs", () => {
    expect(productFilesWhoseCodeMatches(CLUSTER_KEY_WORD)).toEqual([
      ENVIRONMENT_CONFIG,
      CLUSTER_KEY_AUTHORIZATION,
      LOG_REDACTION,
    ]);
  });

  test("EnvironmentConfig names it only as the export ClusterKey, and LogRedaction only as a fragment of what it redacts", () => {
    const environmentConfigMentions: Array<string> =
      codeOf(ENVIRONMENT_CONFIG).match(/\bclusterkey\b/gi) || [];

    expect(Array.from(new Set(environmentConfigMentions))).toEqual([
      "ClusterKey",
    ]);

    const fragments: string =
      codeOf(LOG_REDACTION)
        .split("const SENSITIVE_KEY_FRAGMENTS")[1]
        ?.split("];")[0] || "";

    expect(codeOf(LOG_REDACTION).match(/\bclusterkey\b.*$/gim)).toEqual([
      'clusterkey",',
    ]);
    expect(fragments).toContain('"clusterkey",');
  });

  test("nothing writes the key into a request body, and no Runner sends it at all", () => {
    expect(codeOf(RUNNER_REGISTRATION)).not.toMatch(/\bclusterKey\s*:/);
    expect(
      productFilesWhoseCodeMatches(/\bClusterKeyAuthorization\b/).filter(
        (relativePath: string): boolean => {
          return relativePath.startsWith("packages/Runner/");
        },
      ),
    ).toEqual([]);
  });

  test("every use of the check is a router handed it for a route", () => {
    const uses: Array<ClusterKeyMiddlewareUse> = findClusterKeyMiddlewareUses();

    expect(uses.length).toBeGreaterThan(0);
    expect(
      uses.filter((use: ClusterKeyMiddlewareUse): boolean => {
        return !use.isRouteArgument;
      }),
    ).toEqual([]);
  });

  test("every route is handed the one check, which reads the key from the headers", () => {
    const routes: Array<ClusterKeyRoute> = findClusterKeyRoutes();

    expect(routes.length).toBeGreaterThan(0);
    expect(
      routes
        .filter((route: ClusterKeyRoute): boolean => {
          return route.middleware !== SERVICE_MIDDLEWARE;
        })
        .map((route: ClusterKeyRoute): string => {
          return `${route.middleware} ${route.method} ${route.file} ${route.path}`;
        }),
    ).toEqual([]);
  });

  test("what let the shared Runner register is gone: no product code names it", () => {
    expect(productFilesWhoseCodeMatches(SHARED_RUNNER_REGISTRATION)).toEqual(
      [],
    );
  });

  test("ClusterKeyAuthorization reads the key from the headers, a URL only to refuse it, and never a body", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "ClusterKeyAuthorization.ts",
      codeOf(CLUSTER_KEY_AUTHORIZATION),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const methods: Record<string, string> = {};

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.body
      ) {
        methods[node.name.text] = node.body.getText(sourceFile);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // The headers, nothing else of a request.
    expect(methods["getPresentedClusterKey"]).toContain("req.headers");
    expect(methods["getPresentedClusterKey"]).not.toMatch(REQUEST_PARTS);

    // No method reads a body.
    expect(
      Object.keys(methods).filter((name: string): boolean => {
        return REQUEST_BODY.test(methods[name]!);
      }),
    ).toEqual([]);

    // The URL is read only to refuse the request, before anything else.
    const authorize: string = methods["authorize"] || "";
    const urlCheck: number = authorize.indexOf(
      "if (ClusterKeyAuthorization.carriesClusterKeyInUrl(req)) {",
    );

    expect(urlCheck).toBeGreaterThan(-1);
    expect(authorize.slice(urlCheck)).toMatch(
      /^if \(ClusterKeyAuthorization\.carriesClusterKeyInUrl\(req\)\) \{\s*return Response\.sendErrorResponse\(\s*req,\s*res,\s*new BadDataException\(CLUSTER_KEY_IN_URL_MESSAGE\)/,
    );
    expect(authorize.slice(0, urlCheck)).not.toContain("next(");
    expect(
      Object.keys(methods).filter((name: string): boolean => {
        return REQUEST_URL_PARTS.test(methods[name]!);
      }),
    ).toEqual(["carriesClusterKeyInUrl"]);
  });

  test("nothing outside ClusterKeyAuthorization reads the key from a request", () => {
    expect(
      productFilesWhoseCodeMatches(
        /\bClusterKeyAuthorization\.(?:getPresentedClusterKey|carriesClusterKeyInUrl|authorize)\(/,
      ).filter((relativePath: string): boolean => {
        return relativePath !== CLUSTER_KEY_AUTHORIZATION;
      }),
    ).toEqual([]);
  });

  test("ClusterKeyAuthorization is imported under its own name, so the checks above see every use", () => {
    const misnamed: Array<string> = [];

    for (const relativePath of productFilesWhoseCodeMatches(
      /ClusterKeyAuthorization/,
    )) {
      const sourceFile: ts.SourceFile = ts.createSourceFile(
        path.basename(relativePath),
        fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.endsWith(
            "Middleware/ClusterKeyAuthorization",
          )
        ) {
          const clause: ts.ImportClause | undefined = node.importClause;

          if (
            !clause ||
            clause.name?.text !== "ClusterKeyAuthorization" ||
            clause.namedBindings
          ) {
            misnamed.push(`${relativePath}: ${node.getText(sourceFile)}`);
          }
        }

        if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.endsWith("ClusterKeyAuthorization")
        ) {
          misnamed.push(`${relativePath}: re-export`);
        }

        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require")) &&
          node.arguments.some((argument: ts.Expression): boolean => {
            return (
              ts.isStringLiteral(argument) &&
              argument.text.endsWith("ClusterKeyAuthorization")
            );
          })
        ) {
          misnamed.push(`${relativePath}: ${node.getText(sourceFile)}`);
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(misnamed).toEqual([]);
  });

  test("code outside ClusterKeyAuthorization only presents, checks or strips the key, through the members for that, and never holds the class", () => {
    const used: Set<string> = new Set<string>();
    const otherwise: Array<string> = [];

    for (const relativePath of productFilesWhoseCodeMatches(
      /ClusterKeyAuthorization/,
    )) {
      if (relativePath === CLUSTER_KEY_AUTHORIZATION) {
        continue;
      }

      const sourceFile: ts.SourceFile = parse(relativePath);

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === "ClusterKeyAuthorization") {
          const parent: ts.Node = node.parent;

          if (
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node
          ) {
            used.add(parent.name.text);
          } else if (!ts.isImportClause(parent)) {
            // Passed along, stored, aliased or indexed: out of sight of the checks.
            otherwise.push(placeOf(relativePath, sourceFile, parent));
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(otherwise).toEqual([]);
    expect(Array.from(used).sort()).toEqual(MEMBERS_USED_OUTSIDE);
  });
});

describe("only processes that can know the installation's key present it", () => {
  const presenters: Array<string> =
    productFilesWhoseCodeMatches(PRESENTING_CALL);

  test("the app's own code, nothing else: no Runner", () => {
    expect(presenters.length).toBeGreaterThan(0);
    expect(
      presenters.filter((relativePath: string): boolean => {
        return (
          !relativePath.startsWith("packages/App/") &&
          !relativePath.startsWith("packages/Common/")
        );
      }),
    ).toEqual([]);
  });

  test("every file that presents it is listed, with the installation's own address it calls", () => {
    expect(
      presenters.filter((relativePath: string): boolean => {
        return relativePath !== CLUSTER_KEY_AUTHORIZATION;
      }),
    ).toEqual(Object.keys(PRESENTERS).sort());

    for (const [relativePath, destination] of Object.entries(PRESENTERS)) {
      expect({ relativePath, callsIt: codeOf(relativePath) }).toEqual({
        relativePath,
        callsIt: expect.stringContaining(destination),
      });
    }
  });

  test("every file that presents it presents it in the header, never as a bare value", () => {
    expect(productFilesWhoseCodeMatches(BARE_KEY_CALL)).toEqual([
      CLUSTER_KEY_AUTHORIZATION,
    ]);
  });

  test("no frontend code presents it", () => {
    expect(
      presenters.filter((relativePath: string): boolean => {
        return (
          relativePath.includes("/src/") ||
          relativePath.startsWith("packages/Common/UI/") ||
          relativePath.endsWith(".tsx")
        );
      }),
    ).toEqual([]);
  });
});

/*
 * A ROUTE TAKES THE CLUSTER KEY ONLY BECAUSE ONEUPTIME CALLS IT.
 *
 * Each route that takes the key is called by one of OneUptime's own
 * services, named in CLUSTER_KEY_ROUTE_CALLERS with the address it calls,
 * and each file that presents the key presents it to such a route alone.
 */
describe("the routes that take the cluster key, and who calls them", () => {
  function routeKey(route: {
    file: string;
    method: string;
    path: string;
  }): string {
    return `${route.method} ${route.file} ${route.path}`;
  }

  test("every route that takes the key has a caller in the repository, and every listed caller's route exists", () => {
    const found: Array<string> = findClusterKeyRoutes().map(routeKey).sort();
    const called: Array<string> = Array.from(
      new Set(
        CLUSTER_KEY_ROUTE_CALLERS.map((entry: ClusterKeyRouteCaller) => {
          return routeKey(entry.route);
        }),
      ),
    ).sort();

    expect(found.length).toBeGreaterThan(0);
    expect(called).toEqual(found);
  });

  test("every caller presents the key and calls the address listed for it", () => {
    for (const entry of CLUSTER_KEY_ROUTE_CALLERS) {
      const code: string = codeOf(entry.caller);

      expect({
        caller: entry.caller,
        presents: code.includes(
          "ClusterKeyAuthorization.getClusterKeyHeaders()",
        ),
        callsIt: code.includes(entry.calls),
      }).toEqual({ caller: entry.caller, presents: true, callsIt: true });
    }
  });

  test("every file that presents the key is the caller of a route that takes it", () => {
    const callers: Array<string> = Array.from(
      new Set(
        CLUSTER_KEY_ROUTE_CALLERS.map((entry: ClusterKeyRouteCaller) => {
          return entry.caller;
        }),
      ),
    ).sort();

    expect(callers).toEqual(Object.keys(PRESENTERS).sort());
  });

  test("every route that takes the key answers a POST, the method its callers send", () => {
    expect(
      findClusterKeyRoutes()
        .filter((route: ClusterKeyRoute): boolean => {
          return route.method !== "POST";
        })
        .map(routeKey),
    ).toEqual([]);
  });

  test("a route that hands the request's headers on to a project takes the key's headers out first", () => {
    expect(codeOf(WEBHOOK_TRIGGER)).toContain(
      '"request-headers": ClusterKeyAuthorization.withoutClusterKeyHeaders(req.headers)',
    );
    expect(codeOf(WEBHOOK_TRIGGER)).not.toContain(
      '"request-headers": req.headers',
    );
    expect(codeOf(INCOMING_REQUEST_INGEST)).toContain(
      "ClusterKeyAuthorization.withoutClusterKeyHeaders(req.headers)",
    );
    expect(codeOf(INCOMING_REQUEST_INGEST)).not.toMatch(
      /requestHeaders: Dictionary<string> = req\.headers/,
    );
  });

  test("every file that presents the key puts it in the headers of a POST it makes, once for each route it calls, and the POST keeps its redirects on its server", () => {
    const shapes: Record<string, Array<string>> = {};
    const expected: Record<string, Array<string>> = {};

    for (const relativePath of Object.keys(PRESENTERS)) {
      const sourceFile: ts.SourceFile = parse(relativePath);

      shapes[relativePath] = [];
      expected[relativePath] = CLUSTER_KEY_ROUTE_CALLERS.filter(
        (entry: ClusterKeyRouteCaller): boolean => {
          return entry.caller === relativePath;
        },
      ).map((): string => {
        return "the headers of an API.post that keeps its redirects on its server";
      });

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(sourceFile) ===
            "ClusterKeyAuthorization.getClusterKeyHeaders"
        ) {
          // ...ClusterKeyAuthorization.getClusterKeyHeaders(), in `headers: {}`
          const spread: ts.Node = node.parent;
          const headers: ts.Node = spread.parent;
          const property: ts.Node = headers.parent;
          const options: ts.Node = property.parent;
          const post: ts.Node = options.parent;

          const inPostHeaders: boolean =
            ts.isSpreadAssignment(spread) &&
            ts.isObjectLiteralExpression(headers) &&
            ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile) === "headers" &&
            ts.isObjectLiteralExpression(options) &&
            ts.isCallExpression(post) &&
            post.expression.getText(sourceFile) === "API.post" &&
            post.arguments[0] === options;

          const keepsItsRedirects: boolean =
            inPostHeaders &&
            keepsRedirectsOnServer(
              propertyOf(
                options as ts.ObjectLiteralExpression,
                "options",
                sourceFile,
              ),
              sourceFile,
            );

          shapes[relativePath]!.push(
            inPostHeaders && keepsItsRedirects
              ? "the headers of an API.post that keeps its redirects on its server"
              : inPostHeaders
                ? `${placeOf(relativePath, sourceFile, post)} follows redirects off its server`
                : placeOf(relativePath, sourceFile, post),
          );
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(shapes).toEqual(expected);
  });

  test("a route that takes the key hands none of the request's headers on: its file reads a header by name, if at all", () => {
    const handedOn: Array<string> = [];

    for (const relativePath of Array.from(
      new Set(
        findClusterKeyRoutes().map((route: ClusterKeyRoute): string => {
          return route.file;
        }),
      ),
    )) {
      const sourceFile: ts.SourceFile = parse(relativePath);

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          REQUEST_NAMES.includes(node.expression.text) &&
          ["headers", "rawHeaders", "headersDistinct"].includes(node.name.text)
        ) {
          const parent: ts.Node = node.parent;
          const byName: boolean =
            node.name.text === "headers" &&
            ((ts.isElementAccessExpression(parent) &&
              parent.expression === node) ||
              (ts.isPropertyAccessExpression(parent) &&
                parent.expression === node));

          if (!byName) {
            handedOn.push(placeOf(relativePath, sourceFile, parent));
          }
        }

        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          REQUEST_NAMES.includes(node.expression.expression.text) &&
          ["get", "header"].includes(node.expression.name.text) &&
          !node.arguments.every((argument: ts.Expression): boolean => {
            return ts.isStringLiteralLike(argument);
          })
        ) {
          handedOn.push(placeOf(relativePath, sourceFile, node));
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(handedOn).toEqual([]);
  });
});

/*
 * NOT ONE GUESS AFTER ANOTHER.
 *
 * Whichever route a request reaches, and wherever it carries the key, the
 * check it goes through compares the key, then counts a wrong one for the
 * client and refuses a client that sent too many - before the request is
 * answered as right or wrong (WrongClusterKeyLimit). ClusterKeyWrongKeys
 * drives the rule; this holds every route to the one place it is kept.
 */
describe("every check counts the different wrong keys a client sends, in one place", () => {
  // Calling next, writing to res or answering through Response.
  const ANSWERS_A_REQUEST: RegExp = /\b(?:next|res)\(|Response\./;

  // The bodies of a file's methods (ClusterKeyAuthorization's unless named), comments removed, on one line each.
  function methodBodies(
    relativePath: string = CLUSTER_KEY_AUTHORIZATION,
  ): Record<string, string> {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      path.basename(relativePath),
      codeOf(relativePath),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const bodies: Record<string, string> = {};

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.body
      ) {
        bodies[node.name.text] = node.body
          .getText(sourceFile)
          .split(/\s+/)
          .join(" ");
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return bodies;
  }

  test("its one check hands the request to authorize, and nothing else answers it", () => {
    const bodies: Record<string, string> = methodBodies();

    // No check but the one ClusterKeyRoutes finds routes handed.
    expect(
      Object.keys(bodies).filter((name: string): boolean => {
        return name.startsWith("isAuthorized");
      }),
    ).toEqual(CLUSTER_KEY_MIDDLEWARES);

    for (const check of CLUSTER_KEY_MIDDLEWARES) {
      expect({ check, body: bodies[check] }).toEqual({
        check,
        body: expect.stringContaining(
          "return await ClusterKeyAuthorization.authorize({",
        ),
      });
      expect({
        check,
        answers: ANSWERS_A_REQUEST.test(bodies[check]!),
      }).toEqual({
        check,
        answers: false,
      });
    }
  });

  test("authorize compares the key, then asks WrongClusterKeyLimit, before it answers the key as wrong or lets the request through", () => {
    const authorize: string = methodBodies()["authorize"] || "";

    const compared: number = authorize.indexOf(
      "const isAccepted: boolean = ClusterKeyAuthorization.isAcceptedClusterKey(presented);",
    );
    // Asked for every key it compared, the right one too: never skipped.
    const asked: number = authorize.indexOf(
      "const refusal: WrongClusterKeyRefusal | null = await WrongClusterKeyLimit.check({ req: req, wrongKey: isAccepted ? null : ClusterKeyAuthorization.getWrongKeyDigest(presented), });",
    );
    const refused: number = authorize.indexOf(
      "if (refusal) { ClusterKeyAuthorization.setRetryAfter(res, refusal.retryAfterSeconds); return Response.sendErrorResponse(req, res, new TooManyRequestsException(WRONG_CLUSTER_KEYS_MESSAGE)); }",
    );
    const answeredWrong: number = authorize.indexOf(
      "new BadDataException(INVALID_CLUSTER_KEY_MESSAGE)",
    );
    const letThrough: number = authorize.indexOf("return next();");

    expect(compared).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(compared);
    expect(refused).toBeGreaterThan(asked);
    expect(answeredWrong).toBeGreaterThan(refused);
    expect(letThrough).toBeGreaterThan(refused);

    // Nothing between the comparison and the question answers the request.
    expect(authorize.slice(compared, asked)).not.toMatch(
      /\bnext\(|Response\.send/,
    );

    // Asked once.
    expect(authorize.split("WrongClusterKeyLimit.check(")).toHaveLength(2);
  });

  test("what is counted of a wrong key is its HMAC under the installation's key, and anything that is not text is one value", () => {
    const digest: string = methodBodies()["getWrongKeyDigest"] || "";

    expect(digest).toContain(
      'return crypto .createHmac("sha256", ClusterKeyAuthorization.getClusterKey()) .update(presented, "utf8") .digest("hex");',
    );
    expect(digest).toContain(
      'if (typeof presented !== "string") { return NOT_TEXT_WRONG_KEY; }',
    );
  });

  test("only ClusterKeyAuthorization asks WrongClusterKeyLimit, from authorize alone", () => {
    expect(
      productFilesWhoseCodeMatches(/\bWrongClusterKeyLimit\.check\(/),
    ).toEqual([CLUSTER_KEY_AUTHORIZATION]);
    expect(
      productFilesWhoseCodeMatches(/\bWrongClusterKeyLimit\b/).filter(
        (relativePath: string): boolean => {
          return relativePath !== WRONG_CLUSTER_KEY_LIMIT;
        },
      ),
    ).toEqual([CLUSTER_KEY_AUTHORIZATION]);

    const bodies: Record<string, string> = methodBodies();

    expect(
      Object.keys(bodies).filter((name: string): boolean => {
        return bodies[name]!.includes("WrongClusterKeyLimit.check(");
      }),
    ).toEqual(["authorize"]);
  });

  test("WrongClusterKeyLimit counts through WrongKeyLimit, which counts through ClientRateLimitCounter, so a client is its address and its /64", () => {
    const code: string = codeOf(WRONG_CLUSTER_KEY_LIMIT);

    expect(code).toContain("const LIMIT: WrongKeyLimit = new WrongKeyLimit({");
    expect(code).toContain(
      "return await LIMIT.check({ req: data.req, wrongKey: data.wrongKey });",
    );
    expect(code).not.toMatch(/\bclusterkey\b/i);

    const core: string = codeOf(WRONG_KEY_LIMIT);

    expect(core).toContain("ClientRateLimitCounter.countDifferent<string>({");
    expect(core).toContain("value: data.wrongKey,");
    expect(core).not.toMatch(/\bclusterkey\b/i);
  });

  test("a key from a private network address is never counted, nor refused: WrongKeyLimit leaves such a client alone before it counts anything, for every limit built on it", () => {
    const check: string = methodBodies(WRONG_KEY_LIMIT)["check"] || "";

    const placed: number = check.indexOf(
      "const clientIp: string = WrongKeyLimit.getClientIp(data.req);",
    );
    const leftAlone: number = check.indexOf(
      "if (WrongKeyLimit.isPrivateNetworkAddress(clientIp)) { return null; }",
    );
    const counted: number = check.indexOf(
      "ClientRateLimitCounter.countDifferent<string>({",
    );

    expect(placed).toBeGreaterThan(-1);
    expect(leftAlone).toBeGreaterThan(placed);
    expect(counted).toBeGreaterThan(leftAlone);

    // Nothing is read, counted or answered for the client before that.
    expect(check.slice(0, leftAlone)).not.toMatch(
      /\bawait\b|ClientRateLimitCounter|logger\./,
    );

    // The cluster key's limit is one of those limits, asked with no way around the rule.
    expect(codeOf(WRONG_CLUSTER_KEY_LIMIT)).toContain(
      "const LIMIT: WrongKeyLimit = new WrongKeyLimit({",
    );

    /*
     * The private networks are listed once, in Utils/PrivateNetworkAddress,
     * which the Health page's report of shared addresses reads too: no rate
     * limit keeps a list of its own, and WrongKeyLimit asks that one.
     */
    expect(productFilesWhoseCodeMatches(/\bnew net\.BlockList\(/)).toEqual([
      "packages/Common/Server/Utils/PrivateNetworkAddress.ts",
    ]);
    expect(
      methodBodies(WRONG_KEY_LIMIT)["isPrivateNetworkAddress"] || "",
    ).toContain("return isPrivateNetworkAddress(address);");
    expect(codeOf(WRONG_KEY_LIMIT)).toContain(
      'import { isPrivateNetworkAddress } from "../PrivateNetworkAddress";',
    );
  });
});

describe("the cluster key an installation that kept a shipped value presents", () => {
  test("is derived from TokenSigningKey, never from ENCRYPTION_SECRET or the configured value", () => {
    const code: string = codeOf(CLUSTER_KEY_AUTHORIZATION);

    expect(code).toContain(
      "TokenSigningKey.deriveKey(INSTALLATION_CLUSTER_KEY_LABEL)",
    );
    expect(code).not.toMatch(/\bEncryptionSecret\b/);
  });

  test("a shipped value is refused before the key it is compared with is even read", () => {
    const code: string = codeOf(CLUSTER_KEY_AUTHORIZATION);
    const accepted: string =
      code.split("public static isAcceptedClusterKey(")[1] || "";
    const refusal: number = accepted.indexOf(
      "if (ClusterKeyAuthorization.isShippedClusterKey(presented)) {",
    );
    const expected: number = accepted.indexOf(
      "ClusterKeyAuthorization.getClusterKey()",
    );

    expect(refusal).toBeGreaterThan(-1);
    expect(expected).toBeGreaterThan(refusal);
    expect(accepted).toContain("crypto.timingSafeEqual(");
  });
});

/*
 * NOTHING ELSE CAN MAKE THE KEY AN INSTALLATION DERIVES FOR ITSELF.
 *
 * An installation that kept a shipped value presents HMAC-SHA256(its token
 * signing key, INSTALLATION_CLUSTER_KEY_LABEL). That is the installation's own
 * only while nothing hands anybody an HMAC of the signing key over that label:
 * so the signing key is used only by the modules listed above, each signing
 * text that can never equal the label, and the label is written once.
 */
describe("the key an installation derives for itself is made nowhere else", () => {
  test("only the listed modules use the token signing key", () => {
    expect(productFilesWhoseCodeMatches(TOKEN_SIGNING_KEY_USE)).toEqual(
      [...TOKEN_SIGNING_KEY_USERS].sort(),
    );
  });

  test("its label is written in ClusterKeyAuthorization alone, once", () => {
    const writers: Array<string> = productFilesWhoseCodeMatches(
      new RegExp(escapeRegExp(INSTALLATION_CLUSTER_KEY_LABEL)),
    );

    expect(writers).toEqual([CLUSTER_KEY_AUTHORIZATION]);
    expect(
      codeOf(CLUSTER_KEY_AUTHORIZATION).split(INSTALLATION_CLUSTER_KEY_LABEL),
    ).toHaveLength(2);
  });

  test("its label holds no dot and no colon, so no JWT and no project SSO confirmation is signed over it", () => {
    expect(INSTALLATION_CLUSTER_KEY_LABEL).toMatch(LABEL_SHAPE);
  });
});
