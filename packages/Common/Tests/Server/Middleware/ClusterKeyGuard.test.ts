import { listProductFiles } from "../../Helpers/CodeScanning";
import {
  REPOSITORY_DIRECTORY,
  SKIPPED_FOLDER_NAMES,
} from "../../Helpers/TagStripScan";
import escapeRegExp from "../../../Utils/RegExpEscape";
import { INSTALLATION_CLUSTER_KEY_LABEL } from "../../../Server/Middleware/ClusterKeyAuthorization";
import {
  CLUSTER_KEY_MIDDLEWARES,
  CLUSTER_KEY_ROUTE_CALLERS,
  CLUSTER_KEY_ROUTE_TOOL_CALLERS,
  ClusterKeyMiddlewareUse,
  ClusterKeyRoute,
  ClusterKeyRouteCaller,
  ClusterKeyRouteToolCaller,
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
 *     (EnvironmentConfig.ClusterKey, IsClusterKeyShipped), and nothing says
 *     whether one is set at all, as HasClusterKey did for the Runner;
 *   - only ClusterKeyAuthorization reads a key a request carries - the
 *     clusterkey and x-clusterkey headers - and nothing writes one into a
 *     body or a URL (LogRedaction names it only to keep it out of logs);
 *   - a route takes the cluster key only by handing a router
 *     ClusterKeyAuthorization's one check, never by wrapping or storing it;
 *   - what let the shared Runner register with the cluster key, or with a
 *     key of its own, is gone, and no product code names it;
 *   - every route that takes it is called by OneUptime's own code or by one
 *     of the installation's own tools on the server, and every file that
 *     presents it presents it to such a route, in the header, in a request
 *     that follows a redirect only on the server it was sent to
 *     (sameServerRedirectsOnly - an HTTP client hands a redirected request's
 *     headers to wherever the redirect points);
 *   - of the product's code, only the app's own (App, Common) presents the
 *     key, because only processes that load the installation's token signing
 *     key at boot (App/Index.ts) know the key an installation that kept a
 *     shipped value derives; no Runner presents it - every Runner proves who
 *     it is with its own id and key;
 *   - outside the product's code, only the installation's own tools present
 *     it - `npm run doctor` and diagnose.sh, with the ONEUPTIME_SECRET of the
 *     installation's own configuration, URI-encoded as the app presents and
 *     compares its own - to the doctor's POST alone, at an address of the
 *     server itself, never to HOST (CLUSTER_KEY_ROUTE_TOOL_CALLERS); nothing
 *     else there names the key's header but tests, documentation and a KEDA
 *     parameter nothing uses;
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
  "packages/Common/Server/Services/CustomNotificationChannelDeliveryService.ts":
    "AppApiHostname",
  "packages/Common/Server/Services/DatabaseService.ts": "WorkflowHostname",
  "packages/Common/Server/Services/MailService.ts": "AppApiHostname",
  "packages/Common/Server/Services/SmsService.ts": "AppApiHostname",
  "packages/Common/Server/Services/TelegramService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WebhookService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WhatsAppService.ts": "AppApiHostname",
  "packages/Common/Server/Services/WorkflowService.ts": "WorkflowHostname",
  "packages/Common/Server/Utils/CallAndSmsGatewayTest.ts": "AppApiHostname",
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
  // Derives, under a label of its own, the key a code file version's fingerprint is made with.
  "packages/Common/Server/Utils/AI/Toolbox/CodeFilesSeen.ts",
  // Derives, under a label of its own, the key a workflow step's fingerprint is made with.
  "packages/Common/Server/Utils/AI/Toolbox/WorkflowBuilderTools.ts",
  // Derives, under a label of its own, the key a custom domain's readiness proof is signed with.
  "packages/Common/Server/Utils/CustomDomain/CustomDomainServerReadiness.ts",
  "packages/Common/Server/Utils/JsonWebToken.ts",
  "packages/Common/Server/Utils/Mcp/McpOAuthSignedToken.ts",
  // Derives, under a label of its own, the key a wrong component key's digest is made with.
  "packages/Common/Server/Utils/RateLimit/WrongComponentKeyLimit.ts",
  "packages/Common/Server/Utils/TokenSigningKey.ts",
  // Derives, under a label of its own, the key Mattermost button contexts are signed with.
  "packages/Common/Server/Utils/Workspace/Mattermost/MattermostActionContext.ts",
  // Derives, under a label of its own, the key a public note approval button's value is signed with.
  "packages/Common/Server/Utils/Workspace/WorkspacePublicNoteApproval.ts",
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
    // HasClusterKey told the shared Runner it was one; it went with it.
    expect(codeOf(ENVIRONMENT_CONFIG)).not.toContain("HasClusterKey");
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

    /*
     * A route the Enterprise Edition serves (ee/) is found only where ee/
     * is checked out - the Common Test job removes it - so its entry is
     * held to the route there. Its caller is core's, and is held to the
     * rest of these checks everywhere.
     */
    const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));
    const called: Array<string> = Array.from(
      new Set([
        ...CLUSTER_KEY_ROUTE_CALLERS.filter(
          (entry: ClusterKeyRouteCaller): boolean => {
            return hasEe || !entry.route.file.startsWith("ee/");
          },
        ).map((entry: ClusterKeyRouteCaller) => {
          return routeKey(entry.route);
        }),
        // The installation's own tools on the server: the doctor's POST.
        ...CLUSTER_KEY_ROUTE_TOOL_CALLERS.map(
          (entry: ClusterKeyRouteToolCaller): string => {
            return routeKey(entry.route);
          },
        ),
      ]),
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
 * THE INSTALLATION'S OWN TOOLS PRESENT IT TO THE DOCTOR ALONE, ON THE SERVER.
 *
 * `npm run doctor` (Scripts/Install/Doctor.js) on a Docker Compose host and
 * HelmChart/Public/diagnose.sh inside the app pod ask the app what is wrong
 * with it, with the key the installation's own configuration holds
 * (CLUSTER_KEY_ROUTE_TOOL_CALLERS, #6826). The checks above read the
 * product's TypeScript and never see them, so these hold them at least as
 * strictly as the app's own callers: the key goes in the clusterkey header
 * of one POST, to the doctor's path at an address of the server itself, in a
 * request that follows no redirect - never to HOST or any other address,
 * never in a URL or a body - and to no other route. It goes URI-encoded, as
 * ClusterKeyAuthorization.getClusterKey() presents the app's own key and
 * isAcceptedClusterKey compares what it is sent: the key as written is
 * refused whenever encoding changes it (+ / = @ & %, a space, a letter
 * beyond ASCII), and Node's http will not send a letter beyond Latin-1 in a
 * header at all. App's Tests/ClusterKey/ClusterKeyToolsOverHttp runs both
 * tools against that comparison. Nothing else outside the product's
 * TypeScript names the key's header, so a new script that presents it fails
 * here until it is listed and held to the same.
 */

// What a file's name says holds no text: images, fonts, sounds, video, archives.
const BINARY_FILE: RegExp =
  /\.(?:png|jpe?g|gif|webp|ico|bmp|avif|ttf|otf|woff2?|eot|wav|mp3|mp4|ogg|webm|zip|gz|tgz|tar|pdf|jar|wasm)$/i;

// The folders tests and their fixtures are kept in, as TagStripScan's isTestCode names them.
const TEST_FOLDER_NAMES: Array<string> = ["Tests", "tests", "__tests__"];
const TEST_FILE_NAME: RegExp = /\.(?:test|spec)\.[A-Za-z0-9]+$/;

// A chart's templates: what Helm renders into a cluster.
const CHART_TEMPLATE: RegExp = /^HelmChart\/(?:[^/]+\/)*templates\/[^/]+$/;

// The line a KEDA TriggerAuthentication of the chart names the key's header in.
const KEDA_KEY_PARAMETER: string = "- parameter: clusterkey";

// A ScaledObject's trigger that uses a TriggerAuthentication.
const KEDA_AUTHENTICATION_USE: RegExp = /^\s*authenticationRef\s*:/m;

// What makes a line of Markdown a request rather than words: an address, a command, a header flag.
const REQUEST_ON_A_LINE: RegExp =
  /https?:\/\/|\bcurl\b|\bwget\b|\bfetch\(|(?:^|\s)-H\b|--header\b/i;

// A fence that opens or closes a Markdown code block.
const MARKDOWN_FENCE: RegExp = /^\s*(?:```|~~~)/;

// The configured key's names: ONEUPTIME_SECRET, the chart's oneuptime-secret and oneuptimeSecret.
const CONFIGURED_KEY_NAME: RegExp = /oneuptime[-_]?secret/i;

// How Doctor.js makes its requests: with Node's http and https, which follow no redirect.
const NODE_HTTP_REQUEST: Record<string, string> = {
  request: "const request = given.request || defaultRequest;",
  client: 'const client = url.indexOf("https:") === 0 ? https : http;',
  http: 'const http = require("http");',
  https: 'const https = require("https");',
};

const DOCTOR_ROUTE_KEY: string =
  'POST packages/App/API/AdminHealth.ts "/doctor"';

// How the key travels: URI-encoded with JavaScript's own function, as getClusterKey() encodes it.
const URI_ENCODING: string = "encodeURIComponent";

// Where App/Index.ts mounts AdminHealth's router.
const ADMIN_HEALTH_MOUNT: string = "/api/admin/health";

function textOf(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

function oneLine(text: string): string {
  return text.split(/\s+/).join(" ").trim();
}

/*
 * Every file of the repository the checks above do not read - all but the
 * product's TypeScript under packages/ and ee/ - by its path from the root.
 * Hidden folders but .github (the workflows), and the folders of
 * dependencies, builds and test reports, hold none of the repository's own
 * files, and a binary file names nothing.
 */
function filesBesidesTheProductTypeScript(): Array<string> {
  const readAbove: Set<string> = new Set<string>(
    listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"]).filter(
      (relativePath: string): boolean => {
        return CODE_FILE.test(relativePath);
      },
    ),
  );
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath: string = path.join(directory, entry.name);
      const relativePath: string = path
        .relative(REPOSITORY_DIRECTORY, fullPath)
        .split(path.sep)
        .join("/");

      if (entry.isDirectory()) {
        if (
          !SKIPPED_FOLDER_NAMES.has(entry.name) &&
          (!entry.name.startsWith(".") || entry.name === ".github")
        ) {
          walk(fullPath);
        }
      } else if (
        entry.isFile() &&
        !BINARY_FILE.test(entry.name) &&
        !readAbove.has(relativePath)
      ) {
        files.push(relativePath);
      }
    }
  };

  walk(REPOSITORY_DIRECTORY);

  return files.sort();
}

/*
 * A test, or a test's fixture or helper: a file in a Tests, tests or
 * __tests__ folder, a *.test.* or *.spec.* file, or a file of packages/E2E.
 */
function isTestFile(relativePath: string): boolean {
  const parts: Array<string> = relativePath.split("/");

  return (
    relativePath.startsWith("packages/E2E/") ||
    TEST_FILE_NAME.test(parts[parts.length - 1]!) ||
    parts.slice(0, -1).some((folder: string): boolean => {
      return TEST_FOLDER_NAMES.includes(folder);
    })
  );
}

/*
 * Documentation that names the key's header in words alone: each line of
 * it that names the header is outside a code block and asks nothing of any
 * address.
 */
function namesTheHeaderInWordsAlone(
  relativePath: string,
  text: string,
): boolean {
  if (!relativePath.endsWith(".md")) {
    return false;
  }

  let isInCodeBlock: boolean = false;

  for (const line of text.split("\n")) {
    if (MARKDOWN_FENCE.test(line)) {
      isInCodeBlock = !isInCodeBlock;
      continue;
    }

    if (
      CLUSTER_KEY_WORD.test(line) &&
      (isInCodeBlock || REQUEST_ON_A_LINE.test(line))
    ) {
      return false;
    }
  }

  return true;
}

// A chart template that names the key's header only as a KEDA TriggerAuthentication's parameter.
function namesTheHeaderAsAKedaParameterAlone(
  relativePath: string,
  text: string,
): boolean {
  return (
    CHART_TEMPLATE.test(relativePath) &&
    text
      .split("\n")
      .filter((line: string): boolean => {
        return CLUSTER_KEY_WORD.test(line);
      })
      .every((line: string): boolean => {
        return line.trim() === KEDA_KEY_PARAMETER;
      })
  );
}

// A tool's script - its file, or what one of its shell variables holds (NAME='...') - and the shell around it.
function scriptOfTool(entry: ClusterKeyRouteToolCaller): {
  script: string;
  shell: string;
} {
  const text: string = textOf(entry.tool);

  if (entry.script === null) {
    return { script: text, shell: "" };
  }

  // The shell's single quotes hold it whole: it has none of its own (Tests/Ops/DiagnoseServerFindings).
  const assignment: RegExpExecArray | null = new RegExp(
    `^${escapeRegExp(entry.script)}='([^']*)'$`,
    "m",
  ).exec(text);

  return {
    script: assignment ? assignment[1]! : "",
    shell: assignment ? text.replace(assignment[0], "") : text,
  };
}

// A property's name as written, when it is a name or a string; what it is otherwise.
function nameOfProperty(
  property: ts.ObjectLiteralElementLike,
  sourceFile: ts.SourceFile,
): string {
  if (
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  // A spread, a shorthand, a method or a computed name.
  return `(${property.getText(sourceFile).slice(0, 60)})`;
}

// Whether a binding - a name, or a destructuring - declares this name.
function bindsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) {
    return binding.text === name;
  }

  const elements: ReadonlyArray<ts.ArrayBindingElement> = binding.elements;

  return elements.some((element: ts.ArrayBindingElement): boolean => {
    return !ts.isOmittedExpression(element) && bindsName(element.name, name);
  });
}

/*
 * What a name used at a node refers to, as JavaScript's scopes make it: a
 * parameter of an enclosing function, or a const, let, var, function or
 * class of the nearest enclosing block that declares it. Null when none
 * does.
 */
function declarationOf(name: string, from: ts.Node): ts.Node | null {
  for (let scope: ts.Node | undefined = from; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (bindsName(parameter.name, name)) {
          return parameter;
        }
      }
    }

    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (bindsName(declaration.name, name)) {
              return declaration;
            }
          }
        } else if (
          (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement)) &&
          statement.name?.text === name
        ) {
          return statement;
        }
      }
    }
  }

  return null;
}

// The statement that makes a declaration, as written, on one line.
function statementTextOf(
  declaration: ts.Node | null,
  sourceFile: ts.SourceFile,
): string {
  if (!declaration) {
    return "(not declared)";
  }

  let statement: ts.Node = declaration;

  while (
    statement.parent &&
    !ts.isBlock(statement.parent) &&
    !ts.isSourceFile(statement.parent)
  ) {
    statement = statement.parent;
  }

  return oneLine(statement.getText(sourceFile)).slice(0, 160);
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (at === ancestor) {
      return true;
    }
  }

  return false;
}

// Whether an identifier uses a name, rather than being a property's name or a declaration's own.
function usesAName(identifier: ts.Identifier): boolean {
  const parent: ts.Node = identifier.parent;

  return !(
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
      parent.name === identifier) ||
    (ts.isBindingElement(parent) &&
      (parent.name === identifier || parent.propertyName === identifier))
  );
}

// The names a declaration written on its own declares (const a = ...; const { b } = ...).
function namesDeclaredBy(line: string): Array<string> {
  const statement: ts.Statement | undefined = ts.createSourceFile(
    "line.js",
    line,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ).statements[0];
  const names: Array<string> = [];

  const collect: (binding: ts.BindingName) => void = (
    binding: ts.BindingName,
  ): void => {
    if (ts.isIdentifier(binding)) {
      names.push(binding.text);
      return;
    }

    const elements: ReadonlyArray<ts.ArrayBindingElement> = binding.elements;

    for (const element of elements) {
      if (!ts.isOmittedExpression(element)) {
        collect(element.name);
      }
    }
  };

  if (statement && ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      collect(declaration.name);
    }
  }

  return names;
}

/*
 * What is wrong with how a tool presents the key, against how it is listed:
 * nothing, or each rule it breaks.
 */
function problemsOfTool(entry: ClusterKeyRouteToolCaller): Array<string> {
  const problems: Array<string> = [];
  const scripted: { script: string; shell: string } = scriptOfTool(entry);
  const script: string = scripted.script;
  const shell: string = scripted.shell;

  if (!script.trim()) {
    return [`${entry.script || entry.tool} holds no script`];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    entry.script ? `${entry.script}.js` : path.basename(entry.tool),
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const code: string = ts
    .createPrinter({ removeComments: true })
    .printFile(sourceFile);
  const where: (node: ts.Node) => string = (node: ts.Node): string => {
    return placeOf(entry.script || entry.tool, sourceFile, node);
  };

  // The shell around a tool's script names neither the key's header nor the key.
  const shellCode: string = shell
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trim().startsWith("#");
    })
    .join("\n");

  if (CLUSTER_KEY_WORD.test(shellCode) || CONFIGURED_KEY_NAME.test(shellCode)) {
    problems.push(
      `${entry.tool} names the key or its header outside ${entry.script}`,
    );
  }

  // The key's header: named once in the code, as one property of a request's headers.
  const mentions: number = (
    code.match(new RegExp(CLUSTER_KEY_WORD.source, "gi")) || []
  ).length;

  if (mentions !== 1) {
    problems.push(
      `its code names the key's header ${mentions} times, not once`,
    );
  }

  const headers: Array<ts.PropertyAssignment> = [];
  const keyReads: Array<ts.Node> = [];
  const fetchCalls: Array<ts.CallExpression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      CLUSTER_KEY_WORD.test(nameOfProperty(node, sourceFile))
    ) {
      headers.push(node);
    }

    if (
      (ts.isStringLiteralLike(node) && node.text === "ONEUPTIME_SECRET") ||
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === "ONEUPTIME_SECRET")
    ) {
      keyReads.push(node);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      fetchCalls.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const header: ts.PropertyAssignment | undefined =
    headers.length === 1 ? headers[0] : undefined;

  if (!header) {
    problems.push(
      `its code has ${headers.length} properties named for the key's header, not one`,
    );
    return problems;
  }

  const headersObject: ts.Node = header.parent;
  const headersProperty: ts.Node = headersObject.parent;
  const options: ts.Node = headersProperty.parent;
  const request: ts.Node = options.parent;

  if (
    !ts.isObjectLiteralExpression(headersObject) ||
    !ts.isPropertyAssignment(headersProperty) ||
    nameOfProperty(headersProperty, sourceFile) !== "headers" ||
    !ts.isObjectLiteralExpression(options) ||
    !ts.isCallExpression(request) ||
    request.arguments.length !== 2 ||
    request.arguments[1] !== options
  ) {
    problems.push(
      `the key is not in the headers of a request's options: ${where(header)}`,
    );
    return problems;
  }

  // The clusterkey header, as ClusterKeyAuthorization reads it, and no other.
  const headerNames: Array<string> = headersObject.properties.map(
    (property: ts.ObjectLiteralElementLike): string => {
      return nameOfProperty(property, sourceFile);
    },
  );

  if (headerNames.join(", ") !== "clusterkey") {
    problems.push(
      `its request's headers are ${headerNames.join(", ")}, not the clusterkey header alone`,
    );
  }

  // A POST, with no body, to the address listed.
  const optionNames: Array<string> = options.properties
    .map((property: ts.ObjectLiteralElementLike): string => {
      return nameOfProperty(property, sourceFile);
    })
    .sort();
  const expectedOptionNames: Array<string> =
    entry.client === "fetch"
      ? ["headers", "method", "redirect"]
      : ["headers", "method"];

  if (optionNames.join(", ") !== expectedOptionNames.join(", ")) {
    problems.push(
      `its request's options are ${optionNames.join(", ")}, not ${expectedOptionNames.join(", ")}`,
    );
  }

  const optionText: (name: string) => string | null = (
    name: string,
  ): string | null => {
    for (const property of options.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        nameOfProperty(property, sourceFile) === name
      ) {
        return property.initializer.getText(sourceFile);
      }
    }

    return null;
  };

  if (optionText("method") !== '"POST"') {
    problems.push(`its request is not a POST (method ${optionText("method")})`);
  }

  const address: ts.Expression = request.arguments[0]!;

  if (address.getText(sourceFile) !== entry.calls) {
    problems.push(
      `it presents the key to ${address.getText(sourceFile)}, not ${entry.calls}`,
    );
  }

  // The address: each name it is made of declared as listed - an address of the server itself, and the route's path.
  const listedNames: Array<string> = [];

  for (const line of entry.address) {
    for (const name of namesDeclaredBy(line)) {
      listedNames.push(name);

      const written: string = statementTextOf(
        declarationOf(name, request),
        sourceFile,
      );

      if (written !== oneLine(line)) {
        problems.push(
          `${name}, of the address it calls, is declared as ${written}, not ${line}`,
        );
      }
    }
  }

  const addressNames: Array<string> = [];

  const collectNames: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && usesAName(node)) {
      addressNames.push(node.text);
    }

    ts.forEachChild(node, collectNames);
  };

  collectNames(address);

  for (const name of addressNames) {
    if (!listedNames.includes(name)) {
      problems.push(
        `the address it calls is made of ${name}, which is not listed`,
      );
    }
  }

  if (
    ![entry.calls, ...entry.address].some((text: string): boolean => {
      return text.includes(JSON.stringify(entry.path));
    })
  ) {
    problems.push(`the address it calls has no path ${entry.path}`);
  }

  // A request that follows no redirect, which would hand the header to wherever it points.
  const callee: string = request.expression.getText(sourceFile);

  if (entry.client === "fetch") {
    if (callee !== "fetch" || optionText("redirect") !== '"manual"') {
      problems.push(
        `its request is not a fetch that follows no redirect (${callee}, redirect ${optionText("redirect")})`,
      );
    }
  } else {
    const defaultRequest: ts.Node | null = declarationOf(
      "defaultRequest",
      request,
    );
    const clientRequests: Array<ts.CallExpression> = [];

    const findClientRequest: (node: ts.Node) => void = (
      node: ts.Node,
    ): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "client.request"
      ) {
        clientRequests.push(node);
      }

      ts.forEachChild(node, findClientRequest);
    };

    if (defaultRequest) {
      findClientRequest(defaultRequest);
    }

    const clientRequest: ts.CallExpression | undefined =
      clientRequests.length === 1 ? clientRequests[0] : undefined;

    const made: Record<string, string> = {
      request: statementTextOf(declarationOf(callee, request), sourceFile),
      client: clientRequest
        ? statementTextOf(declarationOf("client", clientRequest), sourceFile)
        : "(no client.request in defaultRequest)",
      http: clientRequest
        ? statementTextOf(declarationOf("http", clientRequest), sourceFile)
        : "(no client.request in defaultRequest)",
      https: clientRequest
        ? statementTextOf(declarationOf("https", clientRequest), sourceFile)
        : "(no client.request in defaultRequest)",
    };

    for (const name of Object.keys(NODE_HTTP_REQUEST)) {
      if (made[name] !== NODE_HTTP_REQUEST[name]) {
        problems.push(
          `its request is not made with Node's http and https: ${name} is ${made[name]}, not ${NODE_HTTP_REQUEST[name]}`,
        );
      }
    }

    // fetch would follow a redirect to any address.
    for (const fetchCall of fetchCalls) {
      problems.push(`it calls fetch: ${where(fetchCall)}`);
    }
  }

  /*
   * The key as it travels: URI-encoded, as ClusterKeyAuthorization's
   * getClusterKey() presents the app's own and isAcceptedClusterKey compares
   * what it is sent. The header's value is a call of the global
   * encodeURIComponent on the key alone, whatever the tool is listed with,
   * and nothing else in the code names encodeURIComponent, so nothing
   * declares, shadows or replaces it.
   */
  const value: ts.Expression = header.initializer;
  const encoded: ts.Expression | null =
    ts.isCallExpression(value) &&
    value.questionDotToken === undefined &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === URI_ENCODING &&
    value.arguments.length === 1 &&
    !ts.isSpreadElement(value.arguments[0]!)
      ? value.arguments[0]!
      : null;
  const encodings: number = (
    code.match(new RegExp(`\\b${URI_ENCODING}\\b`, "g")) || []
  ).length;

  if (!encoded) {
    problems.push(
      `it presents the key as ${value.getText(sourceFile)}, not URI-encoded as ${URI_ENCODING}(the key), as ClusterKeyAuthorization.getClusterKey() presents it`,
    );
  }

  if (encodings !== 1) {
    problems.push(
      `its code names ${URI_ENCODING} ${encodings} times, not once, where it encodes the key`,
    );
  }

  if (value.getText(sourceFile) !== entry.presents) {
    problems.push(
      `its header's value is ${value.getText(sourceFile)}, not ${entry.presents}`,
    );
  }

  // The key: read once, from the installation's own configuration, for the header alone.
  const presented: ts.Expression = encoded || value;
  let keyExpression: ts.Expression = presented;
  let keyDeclaration: ts.VariableDeclaration | null = null;

  if (ts.isIdentifier(presented)) {
    const declaration: ts.Node | null = declarationOf(
      presented.text,
      presented,
    );

    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isIdentifier(declaration.name) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      keyDeclaration = declaration;
      keyExpression = declaration.initializer;
    } else {
      problems.push(
        `the header's value is not a const: ${statementTextOf(declaration, sourceFile)}`,
      );
    }
  }

  if (keyExpression.getText(sourceFile) !== entry.key) {
    problems.push(
      `it reads the key as ${keyExpression.getText(sourceFile)}, not ${entry.key}`,
    );
  }

  if (keyReads.length !== 1 || !isWithin(keyReads[0]!, keyExpression)) {
    problems.push(
      `its code reads ONEUPTIME_SECRET ${keyReads.length} times, not once where it reads the key: ${keyReads.map(where).join("; ")}`,
    );
  }

  if (keyDeclaration && ts.isIdentifier(keyDeclaration.name)) {
    const name: string = keyDeclaration.name.text;
    const declaration: ts.VariableDeclaration = keyDeclaration;

    // Only the check made before the request, that there is a key that is no placeholder.
    let guard: ts.IfStatement | undefined = undefined;

    for (let at: ts.Node | undefined = request; at; at = at.parent) {
      if (ts.isIfStatement(at) && isWithin(request, at.thenStatement)) {
        guard = at;
        break;
      }
    }

    const checkUse: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node) &&
        node.text === name &&
        node !== presented &&
        usesAName(node) &&
        declarationOf(name, node) === declaration
      ) {
        const parent: ts.Node = node.parent;
        const isTheCheck: boolean =
          guard !== undefined &&
          isWithin(node, guard.expression) &&
          ((ts.isBinaryExpression(parent) &&
            parent.operatorToken.kind ===
              ts.SyntaxKind.AmpersandAmpersandToken) ||
            (ts.isCallExpression(parent) &&
              parent.expression.getText(sourceFile) === "isPlaceholderValue" &&
              parent.arguments.length === 1));

        if (!isTheCheck) {
          problems.push(
            `the key is used besides its header and the check before the request: ${where(parent)}`,
          );
        }
      }

      ts.forEachChild(node, checkUse);
    };

    checkUse(sourceFile);
  }

  return problems;
}

describe("the installation's own tools present the key to the doctor alone, on the server", () => {
  const tools: Array<string> = CLUSTER_KEY_ROUTE_TOOL_CALLERS.map(
    (entry: ClusterKeyRouteToolCaller): string => {
      return entry.tool;
    },
  );

  test("no file besides the product's TypeScript names the key's header but a listed tool, a test, documentation in words, or a KEDA parameter nothing uses", () => {
    const files: Array<string> = filesBesidesTheProductTypeScript();

    /*
     * A KEDA TriggerAuthentication of the chart hands a trigger the key as
     * its clusterkey parameter, which no ScaledObject uses: their triggers
     * read the app's metrics without one. Were one to use it, KEDA would
     * present the key, and it would need listing here as a tool does.
     */
    const isKedaAuthenticationUsed: boolean = files
      .filter((relativePath: string): boolean => {
        return CHART_TEMPLATE.test(relativePath);
      })
      .some((relativePath: string): boolean => {
        return KEDA_AUTHENTICATION_USE.test(textOf(relativePath));
      });

    const naming: Record<string, string> = {};

    for (const relativePath of files) {
      /*
       * Tests and their fixtures: they present the key only to servers
       * they start themselves (Tests/Ops runs the doctor and diagnose.sh's
       * script against one), and never ship.
       */
      if (isTestFile(relativePath)) {
        continue;
      }

      const text: string = textOf(relativePath);

      if (!CLUSTER_KEY_WORD.test(text)) {
        continue;
      }

      naming[relativePath] = tools.includes(relativePath)
        ? "a listed tool"
        : namesTheHeaderInWordsAlone(relativePath, text)
          ? "documentation, in words"
          : !isKedaAuthenticationUsed &&
              namesTheHeaderAsAKedaParameterAlone(relativePath, text)
            ? "a KEDA parameter nothing uses"
            : "names the key's header: list it in CLUSTER_KEY_ROUTE_TOOL_CALLERS and hold it to the doctor's rules, or take the header out";
    }

    // Guards the guard: the walk reads Scripts/ and HelmChart/, and finds every listed tool.
    expect(files.length).toBeGreaterThan(1000);
    expect(
      tools.filter((tool: string): boolean => {
        return naming[tool] !== "a listed tool";
      }),
    ).toEqual([]);

    expect(
      Object.keys(naming).filter((relativePath: string): boolean => {
        return naming[relativePath]!.startsWith("names the key's header");
      }),
    ).toEqual([]);
  });

  test("each tool presents the key only in the clusterkey header of one POST to the doctor's path, at an address of the server itself, following no redirect, read from the installation's own configuration and URI-encoded as the app presents and compares its own", () => {
    const problems: Record<string, Array<string>> = {};
    const expected: Record<string, Array<string>> = {};

    for (const entry of CLUSTER_KEY_ROUTE_TOOL_CALLERS) {
      problems[entry.tool] = problemsOfTool(entry);
      expected[entry.tool] = [];
    }

    expect(tools.length).toBeGreaterThan(0);
    expect(problems).toEqual(expected);

    // The encoding the tools are held to is the app's own: getClusterKey(), which isAcceptedClusterKey compares with.
    const presentsItsOwn: string =
      (
        codeOf(CLUSTER_KEY_AUTHORIZATION).split(
          "public static getClusterKey(): string {",
        )[1] || ""
      ).split("}")[0] || "";

    expect(oneLine(presentsItsOwn)).toBe(
      `return ${URI_ENCODING}(ClusterKeyAuthorization.getInstallationClusterKey());`,
    );
  });

  test("the tools call the doctor's POST and no other route that takes the key", () => {
    // The doctor's route, which the route finder finds, and nothing else.
    expect(
      CLUSTER_KEY_ROUTE_TOOL_CALLERS.map(
        (entry: ClusterKeyRouteToolCaller): string => {
          return `${entry.route.method} ${entry.route.file} ${entry.route.path}`;
        },
      ),
    ).toEqual(
      CLUSTER_KEY_ROUTE_TOOL_CALLERS.map((): string => {
        return DOCTOR_ROUTE_KEY;
      }),
    );
    expect(
      findClusterKeyRoutes().map((route: ClusterKeyRoute): string => {
        return `${route.method} ${route.file} ${route.path}`;
      }),
    ).toContain(DOCTOR_ROUTE_KEY);

    // At its path on the app: where App/Index.ts mounts AdminHealth's router, then the route's.
    const index: string = codeOf("packages/App/Index.ts");

    expect(index).toContain('import AdminHealthAPI from "./API/AdminHealth";');
    expect(index).toContain(
      `expressApp.use("${ADMIN_HEALTH_MOUNT}", AdminHealthAPI);`,
    );

    for (const entry of CLUSTER_KEY_ROUTE_TOOL_CALLERS) {
      expect({ tool: entry.tool, path: entry.path }).toEqual({
        tool: entry.tool,
        path: `${ADMIN_HEALTH_MOUNT}${JSON.parse(entry.route.path) as string}`,
      });
    }

    // No tool names the address of a route the app's own services call.
    const otherAddresses: Array<string> = CLUSTER_KEY_ROUTE_CALLERS.map(
      (entry: ClusterKeyRouteCaller): string => {
        return entry.calls;
      },
    )
      .filter((calls: string): boolean => {
        return calls.startsWith('"') && calls.endsWith('"');
      })
      .map((calls: string): string => {
        return JSON.parse(calls) as string;
      });

    expect(otherAddresses.length).toBeGreaterThan(5);

    for (const tool of tools) {
      const text: string = textOf(tool);

      expect({
        tool,
        names: otherAddresses.filter((address: string): boolean => {
          return text.includes(address);
        }),
      }).toEqual({ tool, names: [] });
    }
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
