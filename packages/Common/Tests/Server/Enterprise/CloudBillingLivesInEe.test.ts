import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * OneUptime Cloud's billing is the enterprise module's: selling OneUptime
 * Cloud on AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace
 * and Vercel Marketplace lives in ee/Server/CloudMarketplace, and the Stripe
 * client and the subscription and metered plan jobs in ee/Server/Billing. The
 * Community image is built with ee/ removed and must not carry them, and core
 * must not serve their routes, run their jobs or talk to Stripe. So this
 * suite pins:
 *
 *   - the moved modules are gone from core, and no core file loads them;
 *   - no core router serves a marketplace route or sign-in from Vercel;
 *   - no core server code loads the stripe package at run time or builds a
 *     Stripe client: core names Stripe's types only;
 *   - core kept what every edition uses: the HTTP client and the JWT
 *     verifier Sign in with Microsoft is built on, and the signature check
 *     of the Vercel log drain.
 *
 * It runs in the Common test job, where ee/ is deleted, so it reads only
 * packages/. ee/Tests/Server/CloudMarketplace and ee/Tests/Server/Billing
 * test the moved code itself.
 */

const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const PACKAGES_DIR: string = path.resolve(COMMON_DIR, "..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const APP_DIR: string = path.join(PACKAGES_DIR, "App");

const MARKETPLACE_DIR: string = "packages/Common/Server/Utils/Marketplace";

// Where each moved module used to be (repository-relative, without extension).
const MOVED_MODULES: ReadonlyArray<string> = [
  "packages/Common/Server/API/MarketplaceAPI",
  "packages/Common/Server/API/VercelMarketplaceProviderAPI",
  "packages/App/FeatureSet/Identity/API/VercelSignIn",
  "packages/App/FeatureSet/Workers/Jobs/Marketplace/ReportMarketplaceUsage",
  "packages/App/FeatureSet/Workers/Jobs/Marketplace/SyncMarketplacePurchases",
  "packages/App/FeatureSet/Workers/Jobs/Marketplace/BillVercelMarketplace",
  "packages/App/FeatureSet/Workers/Jobs/MeteredPlan/ReportTelemetryMeteredPlan",
  "packages/App/FeatureSet/Workers/Jobs/PaymentProvider/CheckSubscriptionStatus",
  "packages/App/FeatureSet/Workers/Jobs/PaymentProvider/PopulatePlanNameInProject",
  "packages/App/FeatureSet/Workers/Jobs/PaymentProvider/UpdateTeamMembersIfNull",
  "packages/App/FeatureSet/Workers/Jobs/PaymentProvider/SendDailyEmailsToOwnersIfSubscriptionIsOverdue",
  ...[
    "AWS/AwsMarketplaceAPI",
    "AWS/AwsMarketplaceAdapter",
    "AWS/AwsMarketplaceInbound",
    "Azure/AzureMarketplaceAPI",
    "Azure/AzureMarketplaceAdapter",
    "Azure/AzureMarketplaceInbound",
    "GoogleCloud/GoogleCloudMarketplaceAPI",
    "GoogleCloud/GoogleCloudMarketplaceAdapter",
    "GoogleCloud/GoogleCloudMarketplaceInbound",
    "MarketplaceAdapter",
    "MarketplaceAdapters",
    "MarketplaceApiError",
    "MarketplaceClaimToken",
    "MarketplaceConfig",
    "MarketplacePurchaseClaim",
    "MarketplacePurchaseSync",
    "MarketplaceUsageCalculator",
    "MarketplaceUsageReporter",
    "MarketplaceUsageSummarizer",
    "Vercel/VercelMarketplaceAPI",
    "Vercel/VercelMarketplaceAdapter",
    "Vercel/VercelMarketplaceAuth",
    "Vercel/VercelMarketplaceBilling",
    "Vercel/VercelMarketplaceMonitors",
    "Vercel/VercelMarketplacePlans",
    "Vercel/VercelMarketplaceProvider",
    "Vercel/VercelMarketplaceResources",
    "Vercel/VercelMarketplaceSignIn",
    "Vercel/VercelMarketplaceWebhooks",
    "Vercel/VercelResource",
  ].map((modulePath: string): string => {
    return `${MARKETPLACE_DIR}/${modulePath}`;
  }),
];

/*
 * What stays in core because every edition uses it: Sign in with Microsoft
 * (MicrosoftSignInClient) is built on the first two, the Vercel log drain on
 * the third.
 */
const KEPT_IN_CORE: ReadonlyArray<string> = [
  `${MARKETPLACE_DIR}/MarketplaceHttp.ts`,
  `${MARKETPLACE_DIR}/RemoteJwtVerifier.ts`,
  `${MARKETPLACE_DIR}/Vercel/VercelSignature.ts`,
];

/*
 * A route a core router registers on one of the paths the marketplaces or
 * Vercel call: `.get("/marketplace/aws/...", ...)` and the like, and
 * sign-in from Vercel. The Accounts and Dashboard frontends name these paths
 * as API addresses, so only server code is read.
 */
const MARKETPLACE_ROUTE: RegExp =
  /\.(?:get|post|put|patch|delete|all|use)\(\s*["'`](?:\/marketplace\/(?:aws|azure|google-cloud|purchase|usage|vercel)\b|\/vercel\/sso\b)/;

const SERVER_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet/BaseAPI",
  "packages/App/FeatureSet/Identity",
  "packages/App/FeatureSet/Workers",
  "packages/App/Utils",
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  ".git",
  "coverage",
]);

const SOURCE_FILE: RegExp = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/;

// Cheap prefilter: a file that names no moved module cannot load one.
const MAY_REFERENCE_MOVED_MODULE: RegExp =
  /Marketplace|Vercel|PaymentProvider|ReportTelemetryMeteredPlan/;

const toRepositoryPath: (filePath: string) => string = (
  filePath: string,
): string => {
  return path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join("/");
};

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listSourceFiles(fullPath));
      }
    } else if (
      entry.isFile() &&
      SOURCE_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(fullPath);
    }
  }

  return found;
};

/*
 * The repository-relative module a specifier loads, without extension, or
 * null for a package outside the repository.
 */
const resolveSpecifier: (
  importingFile: string,
  specifier: string,
) => string | null = (
  importingFile: string,
  specifier: string,
): string | null => {
  let absolute: string | null = null;

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    absolute = path.resolve(path.dirname(importingFile), specifier);
  } else if (specifier.startsWith("Common/")) {
    absolute = path.join(COMMON_DIR, specifier.slice("Common/".length));
  } else if (specifier.startsWith("App/")) {
    absolute = path.join(APP_DIR, specifier.slice("App/".length));
  }

  if (!absolute) {
    return null;
  }

  return toRepositoryPath(absolute).replace(SOURCE_FILE, "");
};

/*
 * Every module specifier a file names, from the TypeScript AST (strings and
 * comments never count): imports, exports, import types, import(), require()
 * and jest.mock / doMock / requireActual / requireMock.
 */
const readSpecifiers: (fileName: string, source: string) => Array<string> = (
  fileName: string,
  source: string,
): Array<string> => {
  const specifiers: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;
      const isLoadingCall: boolean =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require") ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "jest" &&
          ["mock", "doMock", "requireActual", "requireMock"].includes(
            callee.name.text,
          ));
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        isLoadingCall &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument)
      ) {
        specifiers.push(firstArgument.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(
    ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  );

  return specifiers;
};

const MOVED: ReadonlySet<string> = new Set<string>(MOVED_MODULES);

// Every core file that still loads a moved module, as "file -> specifier".
const findReferencesToMovedModules: (
  repositoryPath: string,
  source: string,
) => Array<string> = (
  repositoryPath: string,
  source: string,
): Array<string> => {
  const absolutePath: string = path.join(REPOSITORY_ROOT, repositoryPath);

  return readSpecifiers(repositoryPath, source)
    .filter((specifier: string): boolean => {
      const resolved: string | null = resolveSpecifier(absolutePath, specifier);
      return Boolean(resolved && MOVED.has(resolved));
    })
    .map((specifier: string): string => {
      return `${repositoryPath} -> ${specifier}`;
    });
};

describe("the guard's own machinery", () => {
  test("sees a moved module however it is loaded", () => {
    const file: string = "packages/Common/Server/Services/ExampleService.ts";
    const source: string = [
      'import MarketplaceConfig from "../Utils/Marketplace/MarketplaceConfig";',
      'import type { VercelSecret } from "Common/Server/Utils/Marketplace/Vercel/VercelMarketplaceAPI";',
      'export { default } from "../API/MarketplaceAPI";',
      'const lazy = import("../../../App/FeatureSet/Identity/API/VercelSignIn");',
      'jest.mock("../Utils/Marketplace/MarketplaceUsageReporter");',
      // None of these loads a moved module.
      'import MarketplaceHttp from "../Utils/Marketplace/MarketplaceHttp";',
      'import VercelSignature from "../Utils/Marketplace/Vercel/VercelSignature";',
      'const text: string = "../Utils/Marketplace/MarketplaceConfig";',
    ].join("\n");

    expect(findReferencesToMovedModules(file, source)).toEqual([
      `${file} -> ../Utils/Marketplace/MarketplaceConfig`,
      `${file} -> Common/Server/Utils/Marketplace/Vercel/VercelMarketplaceAPI`,
      `${file} -> ../API/MarketplaceAPI`,
      `${file} -> ../../../App/FeatureSet/Identity/API/VercelSignIn`,
      `${file} -> ../Utils/Marketplace/MarketplaceUsageReporter`,
    ]);
  });

  test("sees a moved billing job loaded from core's Workers", () => {
    const file: string = "packages/App/FeatureSet/Workers/Index.ts";
    const source: string = [
      'import "./Jobs/PaymentProvider/CheckSubscriptionStatus";',
      'import "./Jobs/MeteredPlan/ReportTelemetryMeteredPlan";',
      'import "App/FeatureSet/Workers/Jobs/PaymentProvider/UpdateTeamMembersIfNull";',
      // Not moved.
      'import "./Jobs/OnCallPolicy/DeleteOldTimeLogs";',
    ].join("\n");

    expect(MAY_REFERENCE_MOVED_MODULE.test(source)).toBe(true);
    expect(findReferencesToMovedModules(file, source)).toEqual([
      `${file} -> ./Jobs/PaymentProvider/CheckSubscriptionStatus`,
      `${file} -> ./Jobs/MeteredPlan/ReportTelemetryMeteredPlan`,
      `${file} -> App/FeatureSet/Workers/Jobs/PaymentProvider/UpdateTeamMembersIfNull`,
    ]);
  });

  test("sees a route on a marketplace path, and not the frontends' API addresses", () => {
    for (const code of [
      'this.router.post("/marketplace/aws/register", handler);',
      'router.get(\n  "/marketplace/vercel/v1/installations/:installationId",',
      'router.get("/vercel/sso", handler);',
      'app.use("/marketplace/purchase/details", router);',
    ]) {
      expect([code, MARKETPLACE_ROUTE.test(code)]).toEqual([code, true]);
    }

    for (const code of [
      'const url: string = "/marketplace/purchase/details";',
      'router.get("/vercel/v1/logs", handler);',
      'router.post("/billing/webhook", handler);',
    ]) {
      expect([code, MARKETPLACE_ROUTE.test(code)]).toEqual([code, false]);
    }
  });
});

describe("OneUptime Cloud's marketplace billing is not in core", () => {
  test.each(MOVED_MODULES)("%s is gone from core", (modulePath: string) => {
    for (const extension of [".ts", ".tsx", ".js"]) {
      expect(
        fs.existsSync(path.join(REPOSITORY_ROOT, `${modulePath}${extension}`)),
      ).toBe(false);
    }
  });

  test("no file under packages/ loads a moved module", () => {
    const violations: Array<string> = [];
    let scanned: number = 0;

    for (const filePath of listSourceFiles(PACKAGES_DIR)) {
      scanned++;
      const source: string = fs.readFileSync(filePath, "utf8");

      if (!MAY_REFERENCE_MOVED_MODULE.test(source)) {
        continue;
      }

      violations.push(
        ...findReferencesToMovedModules(toRepositoryPath(filePath), source),
      );
    }

    expect(scanned).toBeGreaterThan(1000);
    expect(violations).toEqual([]);
  });

  test("no core router serves a marketplace route or sign-in from Vercel", () => {
    const offenders: Array<string> = [];

    for (const directory of SERVER_DIRECTORIES) {
      for (const filePath of listSourceFiles(
        path.join(REPOSITORY_ROOT, directory),
      )) {
        if (MARKETPLACE_ROUTE.test(fs.readFileSync(filePath, "utf8"))) {
          offenders.push(toRepositoryPath(filePath));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the cloud marketplace jobs are gone from core's Workers, and stay ee-owned names", () => {
    expect(
      listSourceFiles(
        path.join(APP_DIR, "FeatureSet", "Workers", "Jobs", "Marketplace"),
      ),
    ).toEqual([]);

    const loader: string = fs.readFileSync(
      path.join(APP_DIR, "Utils", "EnterpriseLoader.ts"),
      "utf8",
    );

    for (const jobName of [
      "Marketplace:ReportUsage",
      "Marketplace:SyncPurchases",
      "Marketplace:VercelBilling",
    ]) {
      expect(loader).toContain(`"${jobName}",`);
    }
  });

  test("the subscription and metered plan jobs are gone from core's Workers, and stay ee-owned names", () => {
    for (const directory of ["PaymentProvider", "MeteredPlan"]) {
      expect(
        listSourceFiles(
          path.join(APP_DIR, "FeatureSet", "Workers", "Jobs", directory),
        ),
      ).toEqual([]);
    }

    const workers: string = fs.readFileSync(
      path.join(APP_DIR, "FeatureSet", "Workers", "Index.ts"),
      "utf8",
    );
    const loader: string = fs.readFileSync(
      path.join(APP_DIR, "Utils", "EnterpriseLoader.ts"),
      "utf8",
    );

    expect(
      findReferencesToMovedModules(
        "packages/App/FeatureSet/Workers/Index.ts",
        workers,
      ),
    ).toEqual([]);

    for (const jobName of [
      "MeteredPlan:ReportTelemetryMeteredPlan",
      "PaymentProvider:CheckSubscriptionStatus",
      "PaymentProvider:PopulatePlanNameInProject",
      "PaymentProvider:UpdateTeamMembersIfNull",
      "PaymentProvider:SendDailyEmailsToOwnersIfSubscriptionIsOverdue",
    ]) {
      expect(loader).toContain(`"${jobName}",`);
    }
  });
});

/*
 * Every way a file loads the stripe package at run time: an import or export
 * that is not type-only, import() and require(). `import type Stripe from
 * "stripe"` (and `import { type X }`) is erased and loads nothing.
 */
const findRuntimeStripeLoads: (
  fileName: string,
  source: string,
) => Array<string> = (fileName: string, source: string): Array<string> => {
  const loads: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "stripe"
    ) {
      const clause: ts.ImportClause | undefined = node.importClause;
      const bindings: ts.NamedImportBindings | undefined =
        clause?.namedBindings;
      const isTypeOnly: boolean = Boolean(
        clause &&
          (clause.isTypeOnly ||
            (!clause.name &&
              bindings &&
              ts.isNamedImports(bindings) &&
              bindings.elements.every(
                (element: ts.ImportSpecifier): boolean => {
                  return element.isTypeOnly;
                },
              ))),
      );

      if (!isTypeOnly) {
        loads.push(node.getText());
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "stripe" &&
      !node.isTypeOnly
    ) {
      loads.push(node.getText());
    } else if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require")) &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        firstArgument.text === "stripe"
      ) {
        loads.push(node.getText());
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(
    ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  );

  return loads;
};

// A Stripe client being built: `new Stripe(`.
const BUILDS_STRIPE_CLIENT: RegExp = /\bnew\s+Stripe\s*\(/;

/*
 * Core's code: Common's server and every App feature set (the frontends load
 * Stripe.js from @stripe/..., never the stripe package).
 */
const STRIPE_SCAN_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet",
  "packages/App/Utils",
];

describe("OneUptime Cloud's Stripe client is not in core", () => {
  test("the guard sees a run-time load of stripe, and lets a type-only one through", () => {
    const source: string = [
      'import Stripe from "stripe";',
      'import { Stripe as Client } from "stripe";',
      'export { default } from "stripe";',
      'const lazy = import("stripe");',
      'const required = require("stripe");',
      // None of these loads it.
      'import type Stripe from "stripe";',
      'import type { Stripe as TypeOnly } from "stripe";',
      'import { type Stripe as InlineTypeOnly } from "stripe";',
      'export type { Stripe } from "stripe";',
      'const text: string = "import Stripe from \\"stripe\\"";',
    ].join("\n");

    expect(findRuntimeStripeLoads("Example.ts", source)).toEqual([
      'import Stripe from "stripe";',
      'import { Stripe as Client } from "stripe";',
      'export { default } from "stripe";',
      'import("stripe")',
      'require("stripe")',
    ]);
  });

  test("no core server file loads the stripe package at run time or builds a Stripe client", () => {
    const loads: Array<string> = [];
    const builders: Array<string> = [];

    for (const directory of STRIPE_SCAN_DIRECTORIES) {
      for (const filePath of listSourceFiles(
        path.join(REPOSITORY_ROOT, directory),
      )) {
        const source: string = fs.readFileSync(filePath, "utf8");

        if (!source.includes("stripe") && !source.includes("Stripe")) {
          continue;
        }

        for (const load of findRuntimeStripeLoads(filePath, source)) {
          loads.push(`${toRepositoryPath(filePath)}: ${load}`);
        }

        if (BUILDS_STRIPE_CLIENT.test(source)) {
          builders.push(toRepositoryPath(filePath));
        }
      }
    }

    expect(loads).toEqual([]);
    expect(builders).toEqual([]);
  });

  test("BillingService hands its payment-provider calls to the enterprise module", () => {
    const facade: string = fs.readFileSync(
      path.join(COMMON_DIR, "Server", "Services", "BillingService.ts"),
      "utf8",
    );

    expect(facade).toContain("EnterpriseEdition.getBillingProvider()");
    expect(facade).toContain('import type Stripe from "stripe";');
    expect(findRuntimeStripeLoads("BillingService.ts", facade)).toEqual([]);
  });
});

describe("core keeps what every edition uses", () => {
  test.each(KEPT_IN_CORE)("%s stays in core", (repositoryPath: string) => {
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, repositoryPath))).toBe(
      true,
    );
  });

  test("Sign in with Microsoft and the Vercel log drain still load them from core", () => {
    const microsoftSignIn: string = fs.readFileSync(
      path.join(
        COMMON_DIR,
        "Server",
        "Utils",
        "MicrosoftSignIn",
        "MicrosoftSignInClient.ts",
      ),
      "utf8",
    );
    const logDrain: string = fs.readFileSync(
      path.join(
        APP_DIR,
        "FeatureSet",
        "Telemetry",
        "Services",
        "VercelLogDrainIngestService.ts",
      ),
      "utf8",
    );

    expect(microsoftSignIn).toContain('from "../Marketplace/MarketplaceHttp"');
    expect(microsoftSignIn).toContain(
      'from "../Marketplace/RemoteJwtVerifier"',
    );
    expect(logDrain).toContain(
      '"Common/Server/Utils/Marketplace/Vercel/VercelSignature"',
    );
  });
});
