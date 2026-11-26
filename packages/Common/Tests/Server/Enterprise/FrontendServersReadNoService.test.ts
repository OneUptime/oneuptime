import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every server starts through StartServer, each frontend's too (the
 * Dashboard's, the Admin Dashboard's, the Status Page's, the Public
 * Dashboard's and Accounts'), and StartServer reads EnterpriseEdition, which
 * reads the billing provider's contract (Types/Billing/BillingProvider).
 * TypeScript puts in a program every file an import names, `import type`
 * too, so a type one of these modules takes from a service brings that
 * service, and every service, model and migration it imports, into the type
 * check of every one of those servers, whether it calls a service or not.
 *
 * The contract took two: LiveUsageAuthorization from
 * PayAsYouGoBillingService, and the ServerMeteredPlan class, which reads
 * BillingService. The Public Dashboard's server calls no service, yet on the
 * 17.3.0 release pull request they held its compile to 10,735 files, most of
 * Common/Server, and it ran out of Node's default heap on every attempt.
 * Without them it reads under 4,000.
 *
 * So this suite pins that the files these modules reach through their
 * imports, type-only ones included, hold no file of Common/Server/Services.
 */

// Real paths, as TypeScript resolves a module to its file's real path.
const COMMON_DIR: string = fs.realpathSync(
  path.resolve(__dirname, "..", "..", ".."),
);
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

// What every frontend's server reads, and what they read it through.
const ENTRY_POINTS: ReadonlyArray<string> = [
  "Server/Utils/StartServer.ts",
  "Server/Enterprise/EnterpriseEdition.ts",
  "Server/Types/Billing/BillingProvider.ts",
  "Server/Types/Billing/LiveUsageAuthorization.ts",
  "Server/Utils/ProductBrandingText.ts",
];

const COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Node10,
  resolveJsonModule: true,
};

/*
 * Every module specifier a file names, from the TypeScript AST: imports and
 * exports (type-only ones too), import types, import() and require().
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
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require")) &&
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

// The file of this package a specifier names from a file, if it names one.
const resolveSpecifier: (
  specifier: string,
  fromFile: string,
) => string | null = (specifier: string, fromFile: string): string | null => {
  // Common's tsconfig maps "Common/*" to the package itself.
  const moduleName: string = specifier.startsWith("Common/")
    ? path.join(COMMON_DIR, specifier.slice("Common/".length))
    : specifier;

  const resolved: ts.ResolvedModuleFull | undefined = ts.resolveModuleName(
    moduleName,
    fromFile,
    COMPILER_OPTIONS,
    ts.sys,
  ).resolvedModule;

  if (
    !resolved ||
    resolved.isExternalLibraryImport ||
    !resolved.resolvedFileName.startsWith(COMMON_DIR + path.sep)
  ) {
    return null;
  }

  return resolved.resolvedFileName;
};

// Each file's specifiers, read once for every entry point that reaches it.
const specifiersByFile: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>();

const readSpecifiersOfFile: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  let specifiers: Array<string> | undefined = specifiersByFile.get(file);

  if (!specifiers) {
    specifiers = readSpecifiers(file, fs.readFileSync(file, "utf8"));
    specifiersByFile.set(file, specifiers);
  }

  return specifiers;
};

/*
 * The services a module reaches through its imports, each as the chain of
 * imports that first reaches it. A service's own imports are not followed:
 * reaching one is the finding.
 */
const readServicesReached: (entry: string) => Array<string> = (
  entry: string,
): Array<string> => {
  const start: string = path.join(COMMON_DIR, entry);
  const chains: Map<string, Array<string>> = new Map<string, Array<string>>([
    [start, [entry]],
  ]);
  const queue: Array<string> = [start];
  const services: Array<string> = [];

  while (queue.length > 0) {
    const file: string = queue.shift() as string;

    for (const specifier of readSpecifiersOfFile(file)) {
      const next: string | null = resolveSpecifier(specifier, file);

      if (!next || chains.has(next)) {
        continue;
      }

      const chain: Array<string> = [
        ...(chains.get(file) as Array<string>),
        path.relative(COMMON_DIR, next),
      ];
      chains.set(next, chain);

      if (next.startsWith(SERVICES_DIR + path.sep)) {
        services.push(chain.join(" -> "));
      } else {
        queue.push(next);
      }
    }
  }

  return services;
};

describe("the guard's own machinery", () => {
  test("names every way a file loads a module, a type-only import too", () => {
    const source: string = [
      'import type { LiveUsageAuthorization } from "../../Services/PayAsYouGoBillingService";',
      'import type ServerMeteredPlan from "./MeteredPlan/ServerMeteredPlan";',
      'import ObjectID from "../../../Types/ObjectID";',
      'export { default } from "./MeteredPlan/AllMeteredPlans";',
      'type Lazy = typeof import("../../Services/BillingService");',
      'const lazy = import("../../Services/ProjectService");',
      'const required = require("../../Services/UserService");',
      // A string or a comment is not an import.
      'const text: string = "../../Services/TeamMemberService";',
      '// import TeamService from "../../Services/TeamService";',
    ].join("\n");

    expect(readSpecifiers("Server/Types/Billing/Example.ts", source)).toEqual([
      "../../Services/PayAsYouGoBillingService",
      "./MeteredPlan/ServerMeteredPlan",
      "../../../Types/ObjectID",
      "./MeteredPlan/AllMeteredPlans",
      "../../Services/BillingService",
      "../../Services/ProjectService",
      "../../Services/UserService",
    ]);
  });

  test("follows imports into the services a module does read", () => {
    // A metered plan reads its price ids from BillingService.
    expect(
      readServicesReached(
        "Server/Types/Billing/MeteredPlan/ServerMeteredPlan.ts",
      ),
    ).toContain(
      "Server/Types/Billing/MeteredPlan/ServerMeteredPlan.ts -> Server/Services/BillingService.ts",
    );
  });
});

describe("what every frontend's server reads", () => {
  test.each(ENTRY_POINTS)("%s reaches no service", (entry: string) => {
    expect(readServicesReached(entry)).toEqual([]);
  });
});
