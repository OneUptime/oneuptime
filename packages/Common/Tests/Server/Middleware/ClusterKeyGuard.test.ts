import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import escapeRegExp from "../../../Utils/RegExpEscape";
import { INSTALLATION_CLUSTER_KEY_LABEL } from "../../../Server/Middleware/ClusterKeyAuthorization";
import {
  ClusterKeyMiddlewareUse,
  findClusterKeyMiddlewareUses,
} from "../TestingUtils/ClusterKeyRoutes";
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
 *     (EnvironmentConfig.ClusterKey, IsClusterKeyShipped), and only the
 *     Runner reads whether one is set at all (HasClusterKey);
 *   - only ClusterKeyAuthorization reads a key a request carries - the
 *     clusterkey and x-clusterkey headers, a clusterKey field - and only the
 *     Runner writes one into a body;
 *   - a route takes the cluster key only by handing a router
 *     ClusterKeyAuthorization.isAuthorizedServiceMiddleware, never by
 *     wrapping or storing it;
 *   - only the app's own code (App, Common) and the Runner present the key,
 *     because only processes that load the installation's token signing key
 *     at boot (App/Index.ts) know the key an installation that kept a shipped
 *     value derives; and the Runner never presents one before checking it
 *     was given a key it may send.
 *
 * App's Tests/ClusterKey/ClusterKeyRoutesOverHttp sends every value this
 * repository ships to every route found here.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const ENVIRONMENT_CONFIG: string =
  "packages/Common/Server/EnvironmentConfig.ts";
const CLUSTER_KEY_AUTHORIZATION: string =
  "packages/Common/Server/Middleware/ClusterKeyAuthorization.ts";
const RUNNER_CONFIG: string = "packages/Runner/Config.ts";
const RUNNER_REGISTRATION: string =
  "packages/Runner/Services/RegisterRunner.ts";

const ONEUPTIME_SECRET_READ: RegExp =
  /process\.env(?:\[\s*["'`]ONEUPTIME_SECRET["'`]\s*\]|\.ONEUPTIME_SECRET\b)/;

// The key's own name, the headers and the body field, any case, as a whole word.
const CLUSTER_KEY_WORD: RegExp = /\bclusterkey\b/i;

/*
 * Every file that presents the key, with the address it sends it to: one of
 * the installation's own, read from its configuration (the app's API, the
 * workflow service, the telemetry writer, the OneUptime URL the in-cluster
 * Runner is given), never an address a project or a request supplies.
 */
const PRESENTERS: Record<string, string> = {
  "packages/App/FeatureSet/Telemetry/Services/IncomingEmailWorkflowDelivery.ts":
    "WorkflowHostname",
  "packages/Common/Server/Services/AnalyticsDatabaseService.ts":
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
  "packages/Common/Server/Utils/SecurityPlaybook/SecurityPlaybookActions.ts":
    "WorkflowHostname",
  "packages/Common/Server/Utils/Telemetry/TelemetryWriterClient.ts":
    "TELEMETRY_WRITER_URL",
  "packages/Runner/Services/RegisterRunner.ts": "ONEUPTIME_BASE_URL",
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
  "packages/Common/Server/Utils/TokenSigningKey.ts",
];

const TOKEN_SIGNING_KEY_USE: RegExp = /\bTokenSigningKey\.(?:get|deriveKey)\(/;

// The cluster key's label: lower-case words and hyphens, no dot and no colon.
const LABEL_SHAPE: RegExp = /^[a-z]+(?:-[a-z]+)*$/;

const PRESENTING_CALL: RegExp =
  /\bClusterKeyAuthorization\.(?:getClusterKeyHeaders|getClusterKey)\(/;

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

  test("only ClusterKeyAuthorization reads the configured key, and only the Runner whether one is set", () => {
    expect(
      filesImportingFromEnvironmentConfig([
        "ClusterKey",
        "IsClusterKeyShipped",
      ]),
    ).toEqual([CLUSTER_KEY_AUTHORIZATION]);
    expect(filesImportingFromEnvironmentConfig(["HasClusterKey"])).toEqual([
      RUNNER_CONFIG,
      RUNNER_REGISTRATION,
    ]);
  });
});

describe("a presented cluster key is read in one place", () => {
  test("only ClusterKeyAuthorization names the headers or the field, and only the Runner writes the field", () => {
    expect(productFilesWhoseCodeMatches(CLUSTER_KEY_WORD)).toEqual([
      ENVIRONMENT_CONFIG,
      CLUSTER_KEY_AUTHORIZATION,
      RUNNER_REGISTRATION,
    ]);
  });

  test("EnvironmentConfig names it only as the export ClusterKey, and the Runner only as the field it sends", () => {
    const environmentConfigMentions: Array<string> =
      codeOf(ENVIRONMENT_CONFIG).match(/\bclusterkey\b/gi) || [];

    expect(Array.from(new Set(environmentConfigMentions))).toEqual([
      "ClusterKey",
    ]);

    expect(codeOf(RUNNER_REGISTRATION).match(/\bclusterkey\b.*$/gim)).toEqual([
      "clusterKey: ClusterKeyAuthorization.getClusterKey(),",
    ]);
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
});

describe("only processes that can know the installation's key present it", () => {
  const presenters: Array<string> =
    productFilesWhoseCodeMatches(PRESENTING_CALL);

  test("the app's own code and the Runner, nothing else", () => {
    expect(presenters.length).toBeGreaterThan(0);
    expect(
      presenters.filter((relativePath: string): boolean => {
        return (
          !relativePath.startsWith("packages/App/") &&
          !relativePath.startsWith("packages/Common/") &&
          relativePath !== RUNNER_REGISTRATION
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

  test("the Runner checks it was given a key it may send before it presents one", () => {
    const code: string = codeOf(RUNNER_REGISTRATION);
    const check: number = code.indexOf(
      "if (ClusterKeyAuthorization.isConfiguredClusterKeyShipped()) {",
    );
    const present: number = code.indexOf(
      "ClusterKeyAuthorization.getClusterKey()",
    );

    expect(check).toBeGreaterThan(-1);
    expect(present).toBeGreaterThan(check);
    expect(code.slice(check, present)).toContain(
      "throw new ShippedClusterKeyError();",
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
