import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY BODY THE SERVER READS ITSELF IS READ THROUGH THE ONE SHARED READER
 * (#10643, #10644).
 *
 * StartServer reads every request's body before routing, held to the
 * route's limit (RequestBodyLimit): JSON, forms and protobuf parsed, a gzip
 * body inflated and its bytes left in req.body. A route that reads a body
 * itself - its own JSON or form parser, a raw reader after a key check, a
 * multipart upload - reads it after that, and each one that did it with
 * body-parser or multer on its own got one of the same bugs:
 *
 *   - a valid gzip body, already inflated, was read again from its spent
 *     stream: a 500 with an error-level log line, from any client (/mcp, the
 *     MCP OAuth endpoints, the docs' feedback, every multipart upload);
 *   - a body over the parser's limit was read to its end before the 413, for
 *     as long as its client went on sending (Pyroscope's raw profiles,
 *     multipart uploads), and a multipart body was held to no limit as a
 *     whole at all.
 *
 * RequestBodyParser is that shared reader: body-parser, reading no further
 * than its limit, never reading a spent stream again, a gzip body parsed
 * from the bytes StartServer inflated. This walks every file of the
 * server's code with the TypeScript parser and fails on a body read any
 * other way:
 *
 *   - a body-parser factory (ExpressJson, ExpressUrlEncoded, ExpressRaw,
 *     ExpressText) anywhere but as the first argument of
 *     RequestBodyParser.create - called on its own, or kept in a name to be
 *     called later;
 *   - express's own parsers (express.json and the like) anywhere but where
 *     those factories are defined (Common/Server/Utils/Express);
 *   - a module that reads a request's body itself - body-parser, raw-body,
 *     co-body, busboy, formidable - and multer anywhere but the multipart
 *     middleware, which has it parse the bytes RequestBodyParser read
 *     (Common/Server/Middleware/MultipartFormData).
 *
 * And it lists every read through the shared reader, by file, with why: a
 * route that reads a body of its own is a decision a review sees.
 */

const REPOSITORY: string = path.join(__dirname, "../../../../..");

// Where the server's code is, from the repository's root.
const SERVER_ROOTS: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/App",
  "packages/Probe",
  "packages/Home",
  "packages/TestServer",
  "packages/Runner",
  "packages/CLI",
  "packages/Nginx",
  "ee/Server",
].filter((root: string): boolean => {
  // ee/ only where it is checked out: Common Test deletes it before it runs.
  return fs.existsSync(path.join(REPOSITORY, root));
});

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "tests",
  "__tests__",
]);

// A suite's own file: never the server's.
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// The server's code is TypeScript.
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// body-parser's factories, as Common/Server/Utils/Express exports them.
const BODY_PARSER_FACTORIES: ReadonlySet<string> = new Set([
  "ExpressJson",
  "ExpressUrlEncoded",
  "ExpressRaw",
  "ExpressText",
]);

// express's own parsers, which those factories are.
const EXPRESS_PARSERS: ReadonlySet<string> = new Set([
  "json",
  "urlencoded",
  "raw",
  "text",
]);

// Where the factories are defined from express's own: their one definition.
const FACTORIES_FILE: string = "packages/Common/Server/Utils/Express.ts";

/*
 * The modules that read a request's body themselves, and the files each may
 * be imported in: multer only by the multipart middleware, which hands it
 * the bytes RequestBodyParser read, never the request.
 */
const BODY_READING_MODULES: Record<string, ReadonlyArray<string>> = {
  "body-parser": [],
  "raw-body": [],
  "co-body": [],
  busboy: [],
  formidable: [],
  multer: ["packages/Common/Server/Middleware/MultipartFormData.ts"],
};

// A file the parser need not read: it names none of the above.
const MAY_READ_A_BODY: RegExp =
  /\bExpress(?:Json|UrlEncoded|Raw|Text)\b|["']express["']|body-parser|raw-body|co-body|busboy|formidable|["']multer["']/;

/*
 * Every read through the shared reader, by file and factory, with why the
 * file reads a body itself. Adding one is a decision: say why here.
 */
const SHARED_READS: ReadonlyArray<[string, string]> = [
  [
    "packages/App/FeatureSet/Docs/Index.ts: ExpressJson",
    '"Was this page helpful?" and a search that found nothing: a few dozen bytes, held to 2 KB.',
  ],
  [
    "packages/App/FeatureSet/MCP/Handlers/RouteHandler.ts: ExpressJson",
    "The MCP endpoint's JSON-RPC body, held to its route's limit.",
  ],
  [
    "packages/App/FeatureSet/MCP/OAuth/OAuthRoutes.ts: ExpressJson",
    "Client registration and the consent page's answers, held to 64 KB.",
  ],
  [
    "packages/App/FeatureSet/MCP/OAuth/OAuthRoutes.ts: ExpressUrlEncoded",
    "The token, revocation and authorization endpoints' forms (RFC 6749), held to 64 KB.",
  ],
  [
    "packages/Common/Server/Middleware/MultipartFormData.ts: ExpressRaw",
    "A multipart body's bytes, held to its route's limit, for multer to parse.",
  ],
  [
    "packages/Common/Server/Middleware/RequestBodyAfterAuthentication.ts: ExpressRaw",
    "A body read once its caller's key is checked: a probe's collection, a forwarding pod's rows, and the uploads - a Pyroscope profile (multipart or raw), source maps, dSYMs (#10673).",
  ],
  [
    "packages/Common/Server/Middleware/WebhookRequestBody.ts: ExpressRaw",
    "A relayed webhook's text and +json bytes, as they came (the probe's listener).",
  ],
  [
    "packages/Common/Server/Middleware/WebhookRequestBody.ts: ExpressRaw",
    "A signed webhook's bytes of any type, for its signature to be checked over.",
  ],
  [
    "packages/Common/Server/Middleware/WebhookRequestBody.ts: ExpressText",
    "A webhook's text/plain and +json bodies (Amazon SNS, CloudEvents).",
  ],
  [
    "packages/Common/Server/Utils/StartServer.ts: ExpressJson",
    "Every route's JSON, before routing, held to the route's limit.",
  ],
  [
    "packages/Common/Server/Utils/StartServer.ts: ExpressRaw",
    "Every route's protobuf, before routing, held to the route's limit.",
  ],
  [
    "packages/Common/Server/Utils/StartServer.ts: ExpressUrlEncoded",
    "Every route's forms, before routing, held to the route's limit.",
  ],
  [
    "packages/Probe/API/IncomingRequestIngress.ts: ExpressJson",
    "The probe's incoming request listener, its own app: JSON up to 50 MB.",
  ],
  [
    "packages/Probe/API/IncomingRequestIngress.ts: ExpressUrlEncoded",
    "The probe's incoming request listener, its own app: forms up to 50 MB.",
  ],
];

interface BodyReaders {
  // A read through RequestBodyParser.create: "<file>: <factory>".
  sharedReads: Array<string>;
  // A body read any other way: "<file>:<line> <code> - <why>".
  findings: Array<string>;
}

const squash: (text: string) => string = (text: string): string => {
  return text.replace(/\s+/g, " ").trim();
};

// The module a string names, when the node is one: import("x"), require("x").
const moduleNamed: (node: ts.Node) => string | null = (
  node: ts.Node,
): string | null => {
  if (
    ts.isCallExpression(node) &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0]!) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
      node.expression.kind === ts.SyntaxKind.ImportKeyword)
  ) {
    return (node.arguments[0] as ts.StringLiteralLike).text;
  }

  return null;
};

// Whether a call is RequestBodyParser.create(...).
const isSharedReaderCall: (node: ts.Node) => node is ts.CallExpression = (
  node: ts.Node,
): node is ts.CallExpression => {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "RequestBodyParser" &&
    node.expression.name.text === "create"
  );
};

// What reads a body in a file: its text, by its path from the root.
const findBodyReaders: (file: string, text: string) => BodyReaders = (
  file: string,
  text: string,
): BodyReaders => {
  const readers: BodyReaders = { sharedReads: [], findings: [] };

  if (!MAY_READ_A_BODY.test(text)) {
    return readers;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const find: (node: ts.Node, why: string) => void = (
    node: ts.Node,
    why: string,
  ): void => {
    const line: number =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

    readers.findings.push(
      `${file}:${line} ${squash(node.getText(source))} - ${why}`,
    );
  };

  const checkModule: (node: ts.Node, moduleName: string) => void = (
    node: ts.Node,
    moduleName: string,
  ): void => {
    const allowedIn: ReadonlyArray<string> | undefined =
      BODY_READING_MODULES[moduleName];

    if (allowedIn && !allowedIn.includes(file)) {
      find(
        node,
        `${moduleName} reads a request's body itself: read it with RequestBodyParser`,
      );
    }
  };

  // The names this file gives the express module: its default, its namespace.
  const expressNames: Set<string> = new Set<string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName: string = node.moduleSpecifier.text;

      checkModule(node, moduleName);

      if (moduleName === "express" && node.importClause) {
        const clause: ts.ImportClause = node.importClause;

        if (clause.name) {
          expressNames.add(clause.name.text);
        }

        const bindings: ts.NamedImportBindings | undefined =
          clause.namedBindings;

        if (bindings && ts.isNamespaceImport(bindings)) {
          expressNames.add(bindings.name.text);
        }

        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported: string = (element.propertyName || element.name)
              .text;

            if (EXPRESS_PARSERS.has(imported) && file !== FACTORIES_FILE) {
              find(
                element,
                `express's ${imported} parser: use the factory from Common/Server/Utils/Express through RequestBodyParser.create`,
              );
            }
          }
        }
      }
    }

    const requiredModule: string | null = moduleNamed(node);

    if (requiredModule) {
      checkModule(node, requiredModule);

      if (
        requiredModule === "express" &&
        ts.isVariableDeclaration(node.parent) &&
        ts.isIdentifier(node.parent.name)
      ) {
        expressNames.add(node.parent.name.text);
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      expressNames.has(node.expression.text) &&
      EXPRESS_PARSERS.has(node.name.text) &&
      file !== FACTORIES_FILE
    ) {
      find(
        node,
        "express's own parser: use the factory from Common/Server/Utils/Express through RequestBodyParser.create",
      );
    }

    if (ts.isIdentifier(node) && BODY_PARSER_FACTORIES.has(node.text)) {
      const parent: ts.Node = node.parent;

      const isNamedOnly: boolean =
        ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        (file === FACTORIES_FILE &&
          ts.isVariableDeclaration(parent) &&
          parent.name === node);

      if (isSharedReaderCall(parent) && parent.arguments[0] === node) {
        readers.sharedReads.push(`${file}: ${node.text}`);
      } else if (!isNamedOnly) {
        find(
          ts.isCallExpression(parent) && parent.expression === node
            ? parent
            : node,
          `body-parser on its own: build it with RequestBodyParser.create(${node.text}, ...)`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return readers;
};

// Every file of the server's code, relative to the repository's root.
const listServerFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  const walk: (folder: string) => void = (folder: string): void => {
    for (const entry of fs.readdirSync(path.join(REPOSITORY, folder), {
      withFileTypes: true,
    })) {
      const relative: string = path.posix.join(folder, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          walk(relative);
        }
      } else if (
        TYPESCRIPT_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !TEST_FILE.test(entry.name)
      ) {
        files.push(relative);
      }
    }
  };

  for (const root of SERVER_ROOTS) {
    walk(root);
  }

  return files.sort();
};

// Thousands of files are walked; the few that may read a body are parsed.
const SCAN_TIMEOUT_IN_MS: number = 300000;

describe("every body the server reads itself is read through RequestBodyParser", () => {
  const files: Array<string> = listServerFiles();
  const sharedReads: Array<string> = [];
  const findings: Array<string> = [];

  for (const file of files) {
    const readers: BodyReaders = findBodyReaders(
      file,
      fs.readFileSync(path.join(REPOSITORY, file), "utf8"),
    );

    sharedReads.push(...readers.sharedReads);
    findings.push(...readers.findings);
  }

  test("the walk reads the server code of every package", () => {
    // Guards the guard: a moved folder would leave the scan reading nothing.
    expect(files.length).toBeGreaterThan(2000);
    expect(files).toEqual(
      expect.arrayContaining([
        FACTORIES_FILE,
        "packages/Common/Server/Utils/StartServer.ts",
        "packages/Common/Server/Middleware/RequestBodyParser.ts",
        "packages/Common/Server/Middleware/MultipartFormData.ts",
        "packages/App/FeatureSet/MCP/Handlers/RouteHandler.ts",
        "packages/App/FeatureSet/MCP/OAuth/OAuthRoutes.ts",
        "packages/App/FeatureSet/Docs/Index.ts",
        "packages/App/FeatureSet/Telemetry/API/Pyroscope.ts",
        "packages/Probe/API/IncomingRequestIngress.ts",
      ]),
    );
  });

  test(
    "no body is read with body-parser or multer on their own, or with any other module that reads one",
    () => {
      expect(findings).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test("the reads through the shared reader are these, each with why", () => {
    expect(sharedReads.sort()).toEqual(
      SHARED_READS.map((read: [string, string]): string => {
        return read[0];
      }).sort(),
    );

    for (const [, why] of SHARED_READS) {
      expect(why.trim().length).toBeGreaterThan(20);
    }
  });
});

describe("what the guard calls a body read on its own", () => {
  const ROUTE_FILE: string = "packages/App/FeatureSet/Example/API/Example.ts";

  const findingsIn: (text: string, file?: string) => Array<string> = (
    text: string,
    file: string = ROUTE_FILE,
  ): Array<string> => {
    return findBodyReaders(file, text).findings.map(
      (finding: string): string => {
        return finding.slice(0, finding.indexOf(" - "));
      },
    );
  };

  test.each([
    [
      "a body-parser parser called on its own",
      'app.post("/x", ExpressJson(), handler);',
      [`${ROUTE_FILE}:1 ExpressJson()`],
    ],
    [
      "one called with options",
      'router.post("/y", ExpressUrlEncoded({ extended: false, limit: "64kb" }), h);',
      [`${ROUTE_FILE}:1 ExpressUrlEncoded({ extended: false, limit: "64kb" })`],
    ],
    [
      "one kept in a name, to be called later",
      "const parse = ExpressRaw;\nrouter.use(parse({ limit: '1mb' }));",
      [`${ROUTE_FILE}:1 ExpressRaw`],
    ],
    [
      "one handed to RequestBodyParser.create as anything but its factory",
      "RequestBodyParser.create(other, ExpressText);",
      [`${ROUTE_FILE}:1 ExpressText`],
    ],
    [
      "express's own parser, by its default import",
      'import express from "express";\napp.use(express.json());',
      [`${ROUTE_FILE}:2 express.json`],
    ],
    [
      "by its namespace",
      'import * as e from "express";\napp.use(e.raw({ type: "*/*" }));',
      [`${ROUTE_FILE}:2 e.raw`],
    ],
    [
      "by its name",
      'import { urlencoded } from "express";',
      [`${ROUTE_FILE}:1 urlencoded`],
    ],
    [
      "required",
      'const e = require("express");\napp.use(e.text());',
      [`${ROUTE_FILE}:2 e.text`],
    ],
    [
      "a module that reads a body itself, imported",
      'import bodyParser from "body-parser";',
      [`${ROUTE_FILE}:1 import bodyParser from "body-parser";`],
    ],
    [
      "required",
      'const getRawBody = require("raw-body");',
      [`${ROUTE_FILE}:1 require("raw-body")`],
    ],
    [
      "imported when it is used",
      'const Busboy = await import("busboy");',
      [`${ROUTE_FILE}:1 import("busboy")`],
    ],
    [
      "multer anywhere but the multipart middleware",
      'import multer from "multer";',
      [`${ROUTE_FILE}:1 import multer from "multer";`],
    ],
  ])("%s", (_kind: string, text: string, expected: Array<string>) => {
    expect(findingsIn(text)).toEqual(expected);
  });

  test("a factory handed to RequestBodyParser.create is a read through the shared reader", () => {
    const readers: BodyReaders = findBodyReaders(
      ROUTE_FILE,
      [
        'import { ExpressJson } from "Common/Server/Utils/Express";',
        'import RequestBodyParser from "Common/Server/Middleware/RequestBodyParser";',
        'const read = RequestBodyParser.create(ExpressJson, { limit: "2kb" });',
      ].join("\n"),
    );

    expect(readers.findings).toEqual([]);
    expect(readers.sharedReads).toEqual([`${ROUTE_FILE}: ExpressJson`]);
  });

  test("the factories' one definition, an import or a re-export of them, and words in a string are not reads", () => {
    expect(
      findingsIn(
        [
          'import express from "express";',
          "export const ExpressJson: GenericFunction = express.json;",
          "export const ExpressRaw: GenericFunction = express.raw;",
        ].join("\n"),
        FACTORIES_FILE,
      ),
    ).toEqual([]);

    expect(
      findingsIn(
        [
          'export { ExpressJson, ExpressRaw } from "Common/Server/Utils/Express";',
          'const guide: string = "app.use(express.json());";',
          "const koa: string = 'import { bodyParser } from \"@koa/bodyparser\";';",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("multer in the multipart middleware is the one it may be in", () => {
    expect(
      findingsIn(
        'import multer from "multer";',
        "packages/Common/Server/Middleware/MultipartFormData.ts",
      ),
    ).toEqual([]);
  });
});
