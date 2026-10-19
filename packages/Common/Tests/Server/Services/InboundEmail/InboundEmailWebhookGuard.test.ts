import { listProductFiles } from "../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * AN INBOUND EMAIL IS TAKEN ONLY FROM THE MAIL PROVIDER.
 *
 * The mail provider delivers every email sent to the inbound domain by
 * posting it to a route anybody can reach, and what is delivered becomes an
 * Incoming Email monitor's or a workflow's email. The rule, everywhere:
 *
 *   - The installation's secret is read in one place: EnvironmentConfig,
 *     which keeps only a secret the installation may use
 *     (getUsableInboundEmailWebhookSecret). Every provider the factory
 *     builds is given that.
 *   - Every provider is a subclass of InboundEmailProvider that leaves
 *     validateWebhook and hasWebhookSecret to it - so an installation with no
 *     secret refuses every delivery, whatever the provider would check - and
 *     brings only its own check of a delivery against the secret
 *     (isFromProvider).
 *   - Every route that turns a request into an inbound email (calls a
 *     provider's parseInboundEmail) checks first, before the body is read,
 *     that the request comes from the provider: refuseUnlessFromMailProvider
 *     ahead of the multipart parser and the handler. A new route that parses
 *     inbound email fails this guard until it does too.
 *
 * Read from the code with TypeScript's own parser, across all product code
 * (ee/ too, when it is checked out).
 */

const ENVIRONMENT_CONFIG: string = "packages/Common/Server/EnvironmentConfig.ts";
const BASE_PROVIDER: string =
  "packages/Common/Server/Services/InboundEmail/InboundEmailProvider.ts";
const FACTORY: string =
  "packages/Common/Server/Services/InboundEmail/InboundEmailProviderFactory.ts";
const PROVIDERS_FOLDER: string =
  "packages/Common/Server/Services/InboundEmail/Providers";
const WEBHOOK_ROUTE: string =
  "packages/App/FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail.ts";

const SECRET_SETTING: string = "INBOUND_EMAIL_WEBHOOK_SECRET";
const CHECK: string = "refuseUnlessFromMailProvider";
const PARSER: string = "MultipartFormDataMiddleware";
const CODE_FILE: RegExp = /\.tsx?$/;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
}

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    walk(child, visit);
  });
}

// Every product code file, by its path from the repository's root.
const PRODUCT_FILES: Array<string> = listProductFiles().filter(
  (file: string) => {
    return CODE_FILE.test(file);
  },
);

// The files whose text names `needle` at all: a cheap first pass.
function filesMentioning(needle: string): Array<string> {
  return PRODUCT_FILES.filter((file: string) => {
    return read(file).includes(needle);
  });
}

// Each `process.env["NAME"]` / `process.env.NAME` read of `name` in a file.
function environmentReadsOf(file: ts.SourceFile, name: string): number {
  let reads: number = 0;

  walk(file, (node: ts.Node) => {
    const isProcessEnv: (expression: ts.Expression) => boolean = (
      expression: ts.Expression,
    ): boolean => {
      return (
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === "env" &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "process"
      );
    };

    if (
      ts.isElementAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === name
    ) {
      reads++;
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      isProcessEnv(node.expression) &&
      node.name.text === name
    ) {
      reads++;
    }
  });

  return reads;
}

interface ProviderClass {
  file: string;
  name: string;
  extendsName: string | null;
  members: Map<string, ts.ClassElement>;
}

function classesIn(file: string): Array<ProviderClass> {
  const classes: Array<ProviderClass> = [];

  walk(parse(file), (node: ts.Node) => {
    if (!ts.isClassDeclaration(node) || !node.name) {
      return;
    }

    const heritage: ts.HeritageClause | undefined = node.heritageClauses?.find(
      (clause: ts.HeritageClause) => {
        return clause.token === ts.SyntaxKind.ExtendsKeyword;
      },
    );
    const extended: ts.Expression | undefined = heritage?.types[0]?.expression;
    const members: Map<string, ts.ClassElement> = new Map();

    for (const member of node.members) {
      if (member.name && ts.isIdentifier(member.name)) {
        members.set(member.name.text, member);
      }
    }

    classes.push({
      file: file,
      name: node.name.text,
      extendsName:
        extended && ts.isIdentifier(extended) ? extended.text : null,
      members: members,
    });
  });

  return classes;
}

function hasModifier(member: ts.ClassElement, kind: ts.SyntaxKind): boolean {
  return Boolean(
    ts.canHaveModifiers(member) &&
      ts.getModifiers(member)?.some((modifier: ts.Modifier) => {
        return modifier.kind === kind;
      }),
  );
}

// Every `<something>.parseInboundEmail(...)` call in product code.
function filesParsingInboundEmail(): Array<string> {
  return filesMentioning("parseInboundEmail").filter((file: string) => {
    let calls: boolean = false;

    walk(parse(file), (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "parseInboundEmail"
      ) {
        calls = true;
      }
    });

    return calls;
  });
}

// The handlers each `router.post(path, ...handlers)` of a file mounts, by name.
function mountedRoutes(
  file: string,
): Array<{ path: string; handlers: Array<string> }> {
  const routes: Array<{ path: string; handlers: Array<string> }> = [];

  walk(parse(file), (node: ts.Node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !["post", "put", "all", "use"].includes(node.expression.name.text)
    ) {
      return;
    }

    const [first, ...rest] = node.arguments;

    if (!first || !ts.isStringLiteralLike(first)) {
      return;
    }

    routes.push({
      path: first.text,
      handlers: rest.map((handler: ts.Expression) => {
        return ts.isIdentifier(handler) ? handler.text : "<inline handler>";
      }),
    });
  });

  return routes;
}

describe("the inbound email webhook secret is read in one place", () => {
  test(`only EnvironmentConfig reads ${SECRET_SETTING} from the environment`, () => {
    const readers: Array<string> = filesMentioning(SECRET_SETTING).filter(
      (file: string) => {
        return environmentReadsOf(parse(file), SECRET_SETTING) > 0;
      },
    );

    expect(readers).toEqual([ENVIRONMENT_CONFIG]);
    expect(environmentReadsOf(parse(ENVIRONMENT_CONFIG), SECRET_SETTING)).toBe(
      1,
    );
  });

  test("EnvironmentConfig keeps only a secret the installation may use", () => {
    const code: string = read(ENVIRONMENT_CONFIG).replace(/\s+/g, " ");

    expect(code).toContain(
      'export const InboundEmailWebhookSecret: string | undefined = getUsableInboundEmailWebhookSecret( process.env["INBOUND_EMAIL_WEBHOOK_SECRET"], );',
    );
  });

  test("the factory gives every provider it builds that secret", () => {
    const factory: ts.SourceFile = parse(FACTORY);
    const constructed: Array<string> = [];

    // The classes the factory imports from the providers folder.
    const providerClasses: Set<string> = new Set();

    for (const statement of factory.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith("./Providers/") &&
        statement.importClause?.name
      ) {
        providerClasses.add(statement.importClause.name.text);
      }
    }

    expect(providerClasses.size).toBeGreaterThan(0);

    walk(factory, (node: ts.Node) => {
      if (
        !ts.isNewExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !providerClasses.has(node.expression.text)
      ) {
        return;
      }

      const config: ts.Expression | undefined = node.arguments?.[0];
      let secret: string | null = null;

      if (config && ts.isObjectLiteralExpression(config)) {
        for (const property of config.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "webhookSecret"
          ) {
            secret = property.initializer.getText(factory);
          }
        }
      }

      constructed.push(`${node.expression.text}: ${secret}`);
    });

    // Every provider class the factory imports, built once each.
    expect(constructed).toHaveLength(providerClasses.size);

    for (const construction of constructed) {
      expect(construction).toMatch(/: InboundEmailWebhookSecret$/);
    }
  });
});

describe("every inbound email provider is held to the base class's rule", () => {
  const providerFiles: Array<string> = PRODUCT_FILES.filter((file: string) => {
    return file.startsWith(`${PROVIDERS_FOLDER}/`);
  });

  const providers: Array<ProviderClass> = PRODUCT_FILES.filter(
    (file: string) => {
      return file !== BASE_PROVIDER && read(file).includes("InboundEmailProvider");
    },
  )
    .flatMap(classesIn)
    .filter((candidate: ProviderClass) => {
      return candidate.extendsName === "InboundEmailProvider";
    });

  test("finds the providers it was written for", () => {
    expect(providerFiles.length).toBeGreaterThan(0);
    expect(
      providers.map((provider: ProviderClass) => {
        return provider.name;
      }),
    ).toContain("SendGridInboundProvider");
  });

  test("every class in the providers folder is a provider", () => {
    for (const file of providerFiles) {
      for (const declared of classesIn(file)) {
        expect({ file, extends: declared.extendsName }).toEqual({
          file,
          extends: "InboundEmailProvider",
        });
      }
    }
  });

  test("no provider decides on its own whether a delivery is taken, or whether there is a secret", () => {
    for (const provider of providers) {
      for (const member of ["validateWebhook", "hasWebhookSecret", "config"]) {
        expect({
          provider: provider.name,
          member,
          declared: provider.members.has(member),
        }).toEqual({ provider: provider.name, member, declared: false });
      }
    }
  });

  test("every provider brings its own check of a delivery against the secret, which only the base class calls", () => {
    for (const provider of providers) {
      const check: ts.ClassElement | undefined =
        provider.members.get("isFromProvider");

      expect({ provider: provider.name, has: Boolean(check) }).toEqual({
        provider: provider.name,
        has: true,
      });
      expect(
        hasModifier(check!, ts.SyntaxKind.ProtectedKeyword) ||
          hasModifier(check!, ts.SyntaxKind.PrivateKeyword),
      ).toBe(true);
    }

    const callers: Array<string> = filesMentioning("isFromProvider").filter(
      (file: string) => {
        let calls: boolean = false;

        walk(parse(file), (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "isFromProvider"
          ) {
            calls = true;
          }
        });

        return calls;
      },
    );

    expect(callers).toEqual([BASE_PROVIDER]);
  });

  test("the base class refuses every delivery while there is no secret, before it asks the provider", () => {
    const base: ts.SourceFile = parse(BASE_PROVIDER);
    let validate: ts.MethodDeclaration | null = null;

    walk(base, (node: ts.Node) => {
      if (
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "validateWebhook"
      ) {
        validate = node;
      }
    });

    expect(validate).not.toBeNull();

    const body: string = (validate as unknown as ts.MethodDeclaration)
      .body!.getText(base)
      .replace(/\s+/g, " ");
    const refusal: number = body.indexOf(
      "if (!webhookSecret) { return false; }",
    );
    const asked: number = body.indexOf("this.isFromProvider(");

    expect(refusal).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(refusal);
    expect(body).toContain(
      "const webhookSecret: string | undefined = this.config.webhookSecret;",
    );
  });

  test("the base class keeps only a secret the installation may use, whoever builds the provider", () => {
    const code: string = read(BASE_PROVIDER).replace(/\s+/g, " ");

    expect(code).toContain(
      "webhookSecret: getUsableInboundEmailWebhookSecret(config.webhookSecret),",
    );
  });
});

describe("every route that takes an inbound email checks where it comes from first", () => {
  test("the routes that turn a request into an inbound email are the ones this guard was written for", () => {
    expect(filesParsingInboundEmail()).toEqual([WEBHOOK_ROUTE]);
  });

  test("each of them mounts the check ahead of the multipart parser and the handler", () => {
    for (const file of filesParsingInboundEmail()) {
      const routes: Array<{ path: string; handlers: Array<string> }> =
        mountedRoutes(file);

      expect(routes.length).toBeGreaterThan(0);

      for (const route of routes) {
        expect({ file, path: route.path, first: route.handlers[0] }).toEqual({
          file,
          path: route.path,
          first: CHECK,
        });

        const parser: number = route.handlers.indexOf(PARSER);

        expect(parser === -1 || parser > 0).toBe(true);
      }
    }
  });

  test("the check answers a missing secret before it compares anything", () => {
    const code: string = read(WEBHOOK_ROUTE).replace(/\s+/g, " ");
    const check: number = code.indexOf(`const ${CHECK}`);
    const configured: number = code.indexOf(
      "if (!InboundEmailProviderFactory.isConfigured())",
      check,
    );
    const missing: number = code.indexOf(
      "if (!provider.hasWebhookSecret())",
      check,
    );
    const compared: number = code.indexOf(
      "await provider.validateWebhook(",
      check,
    );
    const passed: number = code.indexOf("return next();", check);

    expect(check).toBeGreaterThan(-1);
    expect(configured).toBeGreaterThan(check);
    expect(missing).toBeGreaterThan(configured);
    expect(compared).toBeGreaterThan(missing);
    expect(passed).toBeGreaterThan(compared);
    expect(code.slice(missing, compared)).toContain(
      "new ServiceUnavailableException(",
    );
    expect(code.slice(compared, passed)).toContain("new ForbiddenException(");
  });
});
