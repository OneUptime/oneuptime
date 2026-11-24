import {
  EE_PRESENT,
  REPOSITORY_ROOT,
  codeOf,
  relative,
  serverSourceFiles,
} from "../TestingUtils/ServerSourceFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO SERVER REQUEST SENT WITH FETCH LEAVES THE OUTBOUND PROXY OUT (issue
 * #10720).
 *
 * Node's fetch reads no HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, so every
 * server request sent with it went directly - the HTTP mail providers,
 * Microsoft Graph mail, sign-in with Google and Microsoft, the marketplaces,
 * AWS STS - and failed where the internet is reachable only through the
 * proxy. Each goes through OutboundFetch (Server/Utils) now, on the route
 * OutboundProxyAgents decides for its URL, NO_PROXY included.
 *
 * This reads every server source file of the checkout, the files
 * OutboundAxiosRoutingGuard reads (TestingUtils/ServerSourceFiles), and
 * fails on:
 *
 *   - Node's global fetch used anywhere but OutboundFetch: called, or handed
 *     on as a value (a sender's default fetch). TypeScript's parser reads
 *     each file, so a fetch in a string, a comment, a type, a method of that
 *     name or a local binding of it is not one;
 *   - another fetch client imported (node-fetch, got, ...), or undici
 *     anywhere but OutboundFetch;
 *   - Node's own proxy support switched on for the whole process
 *     (NODE_USE_ENV_PROXY, setGlobalProxyFromEnv, a global dispatcher), in
 *     the server's code, images or chart: it would route every request that
 *     brings no agent of its own, service-to-service calls included;
 *   - a library in the server's lockfiles that sends with a fetch client and
 *     is not in FETCH_LIBRARIES, which says how its requests are routed or
 *     why they need none;
 *   - an undici package whose major version is not that of the undici
 *     inside Node, whose fetch hands OutboundFetch's dispatcher each request.
 */

const SERVER_FILES: Array<string> = serverSourceFiles();

// The one file that sends with Node's fetch, routed.
const OUTBOUND_FETCH: string = "packages/Common/Server/Utils/OutboundFetch.ts";

/*
 * The server files that send with fetch, each through OutboundFetch, and
 * what they send.
 */
const ROUTED_FETCHERS: Record<string, string> = {
  "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts":
    "Amazon SES, Mailgun, Postmark and Resend",
  "packages/App/FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider.ts":
    "Microsoft Graph mail",
  "packages/Common/Server/Utils/Marketplace/MarketplaceHttp.ts":
    "Continue with Google, Sign in with Microsoft, the cloud marketplaces and the self-hosted metering reporters",
  "packages/Common/Server/Utils/Aws/AwsDefaultCredentialChain.ts":
    "AWS STS through the proxy; the instance metadata service and the container agents directly",
  "packages/Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient.ts":
    "Google SecOps",
  "packages/Common/Server/Utils/VideoCall/VideoCallHttpClient.ts":
    "Zoom, Google Meet and Microsoft Teams meetings",
  "packages/Home/Utils/IndexNow.ts":
    "IndexNow's notices of the blog, sent from oneuptime.com alone",
  "packages/Home/Utils/Books/BookStore.ts":
    "a book's EPUB, for the marketing site's in-page reader",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkOpenIdMetadata.ts":
    "the Bot Framework's OpenID metadata and signing keys, which the Teams bot checks every message from Teams with",
};

// Clients that send HTTP requests of their own, past OutboundFetch.
const FETCH_CLIENTS: Array<string> = [
  "undici",
  "node-fetch",
  "node-fetch-native",
  "cross-fetch",
  "isomorphic-fetch",
  "@whatwg-node/fetch",
  "make-fetch-happen",
  "minipass-fetch",
  "got",
  "ky",
  "ofetch",
  "superagent",
  "needle",
  "phin",
];

/*
 * The libraries of the server that send with one of those clients, and how
 * each one's requests are routed, or why they need not be.
 */
const FETCH_LIBRARIES: Record<string, string> = {
  "@elastic/transport":
    "undici, for its own Elasticsearch connections: @elastic/elasticsearch is read for its types alone, and sends nothing",
  airtable:
    "node-fetch, for Utils/Airtable, which no server code imports: route it before anything does",
  "botframework-connector":
    "node-fetch, for the Bot Framework's OpenID metadata, read to check Microsoft Teams' messages: the SDK's token checks read metadata OneUptime fetched with OutboundFetch instead (BotFrameworkOpenIdMetadata, put in the SDK's cache by BotFrameworkRouting, #10763), so its node-fetch is never asked; and cross-fetch, for the Emulator's OAuth cards, which OneUptime never sends",
  "cross-fetch":
    "node-fetch, for botframework-connector's Emulator client (EmulatorApiClient), which OneUptime never calls",
  "expo-server-sdk":
    "node-fetch, on the agent it is handed: each request's route (PushNotificationService.expoAgentFor)",
};

// How a hook that routes a library's requests reads in its file.
const FETCH_LIBRARY_HOOKS: Record<string, Array<string>> = {
  // The Bot Framework SDK's token checks: the metadata in its cache is ours.
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkOpenIdMetadata.ts":
    [
      "cache.set(url, new BotFrameworkOpenIdMetadata(url));",
      "await OutboundFetch.fetch(url);",
    ],
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/BotFrameworkRouting.ts":
    ["BotFrameworkOpenIdMetadata.routeEveryDocument();"],
  "packages/Common/Server/Services/PushNotificationService.ts": [
    // Expo's push to the mobile app.
    "httpAgent: PushNotificationService.expoAgentFor as unknown as http.Agent,",
    "return OutboundProxyAgents.getSharedAgentFor(new globalThis.URL(url.href));",
    // Web push, which sends with Node's https on the agent it is handed.
    "agent: PushNotificationService.getWebPushAgent(",
  ],
};

// The lockfiles of the server's packages.
const LOCKFILES: Array<string> = [
  "packages/Common/package-lock.json",
  "packages/App/package-lock.json",
  "packages/Probe/package-lock.json",
  "packages/Runner/package-lock.json",
  "packages/Home/package-lock.json",
  ...(EE_PRESENT ? ["ee/package-lock.json"] : []),
];

/*
 * Node's proxy support switched on for the whole process: in code, an
 * image's environment, or the chart's.
 */
const GLOBAL_PROXY_SWITCHES: Array<string> = [
  "NODE_USE_ENV_PROXY",
  "--use-env-proxy",
  "setGlobalProxyFromEnv",
  "setGlobalDispatcher",
];

// What the server's images and chart set for its processes.
const DEPLOYMENT_FILES: Array<string> = [
  "packages/App/Dockerfile.tpl",
  "packages/Home/Dockerfile.tpl",
  "packages/Probe/Dockerfile.tpl",
  "packages/Runner/Dockerfile.tpl",
  "packages/Nginx/Dockerfile.tpl",
  "docker-compose.base.yml",
  "docker-compose.yml",
  "HelmChart/Public/oneuptime/values.yaml",
  ...fs
    .readdirSync(
      path.join(
        REPOSITORY_ROOT,
        "HelmChart",
        "Public",
        "oneuptime",
        "templates",
      ),
    )
    .filter((name: string): boolean => {
      return name.endsWith(".yaml") || name.endsWith(".tpl");
    })
    .map((name: string): string => {
      return `HelmChart/Public/oneuptime/templates/${name}`;
    }),
];

const FETCH: string = "fetch";

// The names a script calls the global object by.
const GLOBAL_OBJECTS: Array<string> = [
  "globalThis",
  "global",
  "window",
  "self",
];

// Whether a binding name - an identifier or a pattern - declares fetch.
function bindsFetch(name: ts.BindingName | undefined): boolean {
  if (!name) {
    return false;
  }

  if (ts.isIdentifier(name)) {
    return name.text === FETCH;
  }

  return (name.elements as ts.NodeArray<ts.ArrayBindingElement>).some(
    (element: ts.ArrayBindingElement): boolean => {
      return !ts.isOmittedExpression(element) && bindsFetch(element.name);
    },
  );
}

// Whether statements declare fetch: a variable, function, class or import.
function statementsDeclareFetch(
  statements: ts.NodeArray<ts.Statement>,
): boolean {
  return statements.some((statement: ts.Statement): boolean => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration: ts.VariableDeclaration): boolean => {
          return bindsFetch(declaration.name);
        },
      );
    }

    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === FETCH
    ) {
      return true;
    }

    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause: ts.ImportClause = statement.importClause;
      const bindings: ts.NamedImportBindings | undefined = clause.namedBindings;

      if (clause.name?.text === FETCH) {
        return true;
      }

      if (bindings && ts.isNamespaceImport(bindings)) {
        return bindings.name.text === FETCH;
      }

      if (bindings && ts.isNamedImports(bindings)) {
        return bindings.elements.some(
          (element: ts.ImportSpecifier): boolean => {
            return element.name.text === FETCH;
          },
        );
      }
    }

    return false;
  });
}

// Whether the scope a node opens declares fetch.
function scopeDeclaresFetch(node: ts.Node): boolean {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    return statementsDeclareFetch(node.statements);
  }

  if (ts.isCaseBlock(node)) {
    return node.clauses.some((clause: ts.CaseOrDefaultClause): boolean => {
      return statementsDeclareFetch(clause.statements);
    });
  }

  if (ts.isFunctionLike(node)) {
    return (
      ((ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
        node.name?.text === FETCH) ||
      node.parameters.some((parameter: ts.ParameterDeclaration): boolean => {
        return bindsFetch(parameter.name);
      })
    );
  }

  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    const initializer: ts.ForInitializer | undefined = node.initializer;

    return Boolean(
      initializer &&
        ts.isVariableDeclarationList(initializer) &&
        initializer.declarations.some(
          (declaration: ts.VariableDeclaration): boolean => {
            return bindsFetch(declaration.name);
          },
        ),
    );
  }

  if (ts.isCatchClause(node)) {
    return bindsFetch(node.variableDeclaration?.name);
  }

  if (ts.isClassExpression(node)) {
    return node.name?.text === FETCH;
  }

  return false;
}

// Whether a binding named fetch is in scope where `node` is.
function isLocallyBound(node: ts.Node): boolean {
  for (
    let scope: ts.Node | undefined = node.parent;
    scope;
    scope = scope.parent
  ) {
    if (scopeDeclaresFetch(scope)) {
      return true;
    }
  }

  return false;
}

// Whether a node sits in a type: `typeof fetch` there names its type alone.
function isInType(node: ts.Node): boolean {
  for (
    let ancestor: ts.Node | undefined = node.parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (ts.isTypeNode(ancestor)) {
      return true;
    }
  }

  return false;
}

/*
 * Whether the identifier `fetch` is read as a value here - called, or
 * handed on - rather than a name declared, a property's key, or another
 * object's property.
 */
function isReadAsValue(node: ts.Identifier): boolean {
  const parent: ts.Node = node.parent;

  if (ts.isShorthandPropertyAssignment(parent)) {
    return true;
  }

  if ((parent as { name?: ts.Node }).name === node) {
    return false;
  }

  if (
    (ts.isBindingElement(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent)) &&
    parent.propertyName === node
  ) {
    return false;
  }

  if (
    (ts.isQualifiedName(parent) && parent.right === node) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isTypeOfExpression(parent)
  ) {
    return false;
  }

  return !isInType(node);
}

// Whether an expression names the global object (and no local of that name).
function isGlobalObject(expression: ts.Expression): boolean {
  return (
    ts.isIdentifier(expression) && GLOBAL_OBJECTS.includes(expression.text)
  );
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/*
 * Each place a file uses Node's global fetch: "line: code", from the line it
 * is on.
 */
function globalFetchUsesIn(fileName: string, text: string): Array<string> {
  const source: ts.SourceFile = parse(fileName, text);
  const lines: Array<string> = text.split("\n");
  const uses: Array<string> = [];

  const note: (node: ts.Node) => void = (node: ts.Node): void => {
    const line: number = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    ).line;

    uses.push(`${line + 1}: ${(lines[line] || "").trim()}`);
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === FETCH &&
      isGlobalObject(node.expression)
    ) {
      // globalThis.fetch, global.fetch
      note(node);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === FETCH &&
      isGlobalObject(node.expression)
    ) {
      // globalThis["fetch"]
      note(node);
    } else if (
      ts.isIdentifier(node) &&
      node.text === FETCH &&
      isReadAsValue(node) &&
      !isLocallyBound(node)
    ) {
      note(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return uses;
}

// The packages a file imports or requires, as values.
function importedModulesIn(fileName: string, text: string): Array<string> {
  const source: ts.SourceFile = parse(fileName, text);
  const modules: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      modules.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return modules;
}

// The fetch client a package name is, or null.
function fetchClientOf(module: string): string | null {
  return (
    FETCH_CLIENTS.find((client: string): boolean => {
      return module === client || module.startsWith(`${client}/`);
    }) || null
  );
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("every server request sent with fetch goes through OutboundFetch", () => {
  test("the search reads the server's code, the marketing site's included", () => {
    const files: Array<string> = SERVER_FILES.map(relative);

    // The guard reads nothing if its folders move.
    expect(SERVER_FILES.length).toBeGreaterThan(1000);
    expect(files).toContain(OUTBOUND_FETCH);
    expect(files).toContain("packages/Home/Utils/IndexNow.ts");
  });

  test("no file but OutboundFetch uses Node's global fetch", () => {
    const uses: Array<string> = SERVER_FILES.filter((file: string): boolean => {
      return relative(file) !== OUTBOUND_FETCH && read(file).includes(FETCH);
    }).flatMap((file: string): Array<string> => {
      return globalFetchUsesIn(file, read(file)).map((use: string): string => {
        return `${relative(file)}:${use}`;
      });
    });

    expect({
      uses,
      fix: "Send it with OutboundFetch.fetch (Common/Server/Utils/OutboundFetch), which takes fetch's arguments and routes the request through the outbound proxy, NO_PROXY included.",
    }).toEqual({
      uses: [],
      fix: "Send it with OutboundFetch.fetch (Common/Server/Utils/OutboundFetch), which takes fetch's arguments and routes the request through the outbound proxy, NO_PROXY included.",
    });
  });

  test("OutboundFetch sends with the global fetch, once, so what stands in for fetch in a test still does", () => {
    const file: string = path.join(REPOSITORY_ROOT, OUTBOUND_FETCH);
    const uses: Array<string> = globalFetchUsesIn(file, read(file));

    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("globalThis.fetch(url, {");
  });

  test("each sender still sends through OutboundFetch", () => {
    for (const file of Object.keys(ROUTED_FETCHERS)) {
      const code: string = codeOf(read(path.join(REPOSITORY_ROOT, file)));

      expect({ file, routed: code.includes("OutboundFetch.fetch") }).toEqual({
        file,
        routed: true,
      });
    }
  });

  test("no file sends with another fetch client, nor with undici past OutboundFetch", () => {
    // Only a file that names a client in quotes can import it.
    const naming: Array<string> = SERVER_FILES.filter(
      (file: string): boolean => {
        const text: string = read(file);

        return FETCH_CLIENTS.some((client: string): boolean => {
          return text.includes(`"${client}`) || text.includes(`'${client}`);
        });
      },
    );
    const imports: Array<string> = naming.flatMap(
      (file: string): Array<string> => {
        return importedModulesIn(file, read(file))
          .filter((module: string): boolean => {
            const client: string | null = fetchClientOf(module);

            return (
              client !== null &&
              !(client === "undici" && relative(file) === OUTBOUND_FETCH)
            );
          })
          .map((module: string): string => {
            return `${relative(file)}: ${module}`;
          });
      },
    );

    expect(imports).toEqual([]);
  });

  test("nothing switches Node's own proxy on for the whole process", () => {
    const inCode: Array<string> = SERVER_FILES.flatMap(
      (file: string): Array<string> => {
        const code: string = codeOf(read(file));

        return GLOBAL_PROXY_SWITCHES.filter((name: string): boolean => {
          return code.includes(name);
        }).map((name: string): string => {
          return `${relative(file)}: ${name}`;
        });
      },
    );
    const inDeployment: Array<string> = DEPLOYMENT_FILES.filter(
      (file: string): boolean => {
        return fs.existsSync(path.join(REPOSITORY_ROOT, file));
      },
    ).flatMap((file: string): Array<string> => {
      // What is set, not what a comment says.
      const lines: Array<string> = read(path.join(REPOSITORY_ROOT, file))
        .split("\n")
        .filter((line: string): boolean => {
          return !line.trim().startsWith("#");
        });

      return GLOBAL_PROXY_SWITCHES.filter((name: string): boolean => {
        return lines.some((line: string): boolean => {
          return line.includes(name);
        });
      }).map((name: string): string => {
        return `${file}: ${name}`;
      });
    });

    expect(DEPLOYMENT_FILES.length).toBeGreaterThan(10);
    expect([...inCode, ...inDeployment]).toEqual([]);
  });
});

describe("the server's libraries that send with a fetch client", () => {
  test("are each named in FETCH_LIBRARIES, which says how their requests are routed", () => {
    const found: Set<string> = new Set<string>();

    for (const lockfile of LOCKFILES) {
      const lock: {
        packages?: Record<string, { dependencies?: Record<string, string> }>;
      } = JSON.parse(read(path.join(REPOSITORY_ROOT, lockfile)));

      for (const [where, entry] of Object.entries(lock.packages || {})) {
        const sendsWithClient: boolean = Object.keys(
          entry.dependencies || {},
        ).some((dependency: string): boolean => {
          return fetchClientOf(dependency) !== null;
        });

        if (sendsWithClient && where.startsWith("node_modules/")) {
          found.add(where.slice(where.lastIndexOf("node_modules/") + 13));
        }
      }
    }

    expect(Array.from(found).sort()).toEqual(
      Object.keys(FETCH_LIBRARIES).sort(),
    );
  });

  test("whose hooks are where they route them", () => {
    for (const [file, hooks] of Object.entries(FETCH_LIBRARY_HOOKS)) {
      const code: string = codeOf(read(path.join(REPOSITORY_ROOT, file)));

      for (const hook of hooks) {
        expect({ file, hook, present: code.includes(hook) }).toEqual({
          file,
          hook,
          present: true,
        });
      }
    }
  });
});

/*
 * OutboundFetch hands Node's fetch a dispatcher whose agents are the undici
 * package's. Node's fetch calls a dispatcher through the interface of the
 * undici inside Node, which can change between major versions: an upgrade
 * of Node that brings another major version of undici moves the package
 * with it.
 */
describe("the undici package OutboundFetch sends on", () => {
  test("is of the major version of the undici inside Node", () => {
    const lock: { packages: Record<string, { version: string }> } = JSON.parse(
      read(path.join(REPOSITORY_ROOT, "packages/Common/package-lock.json")),
    );
    const packageJson: { dependencies: Record<string, string> } = JSON.parse(
      read(path.join(REPOSITORY_ROOT, "packages/Common/package.json")),
    );
    const insideNode: string = String(process.versions["undici"] || "");
    const majorOf: (version: string) => string = (version: string): string => {
      return version.replace(/^[\^~]/, "").split(".")[0] || "";
    };

    expect(insideNode).not.toBe("");
    expect({
      locked: majorOf(lock.packages["node_modules/undici"]!.version),
      declared: majorOf(packageJson.dependencies["undici"]!),
    }).toEqual({
      locked: majorOf(insideNode),
      declared: majorOf(insideNode),
    });
  });
});

describe("the guard reads a fetch as it is written", () => {
  test.each([
    "await fetch(url);",
    'const response = await fetch(url, { method: "POST" });',
    "await globalThis.fetch(url);",
    "await global.fetch(url);",
    'await globalThis["fetch"](url);',
    "this.send = data.send || fetch;",
    "const send = data.fetchImplementation || (fetch as unknown as FetchLike);",
    "callWith({ fetch });",
    "function run(): Promise<Response> { const x = 1; return fetch(x); }",
    "const code = `${await fetch(url)}`;",
  ])("Node's fetch: %s", (source: string) => {
    expect(globalFetchUsesIn("Example.ts", source)).toHaveLength(1);
  });

  test.each([
    "await API.fetch<JSONObject>({ url });",
    "await DataSourceHttpFetch.fetch(request);",
    "class C { public static async fetch(url: string): Promise<void> {} }",
    "const fetch: ListFetchLike = data.fetch || defaultFetch;\nawait fetch({ url });",
    "function run(fetch: FetchLike): Promise<unknown> { return fetch(url); }",
    'const code = "await fetch(url)";',
    "const code = `await fetch(url)`;",
    "// fetch(url) is how it used to read",
    "/* fetch(url) */",
    "let fetchImpl: typeof fetch | undefined;",
    "type Fetch = typeof fetch;",
    "const handlers = { fetch: (): void => {} };",
    'import { fetch } from "./LocalFetch";\nawait fetch(url);',
    "const { fetch } = clients;\nfetch();",
    "for (const fetch of fetches) { fetch(); }",
    'if (typeof fetch !== "function") {}',
    'await OutboundFetch.fetch(url, { method: "POST" });',
  ])("not Node's fetch: %s", (source: string) => {
    expect(globalFetchUsesIn("Example.ts", source)).toEqual([]);
  });

  test("names the line a use is on", () => {
    expect(
      globalFetchUsesIn(
        "Example.ts",
        "const a: number = 1;\n\nconst response = await fetch(url);",
      ),
    ).toEqual(["3: const response = await fetch(url);"]);
  });

  test.each([
    ['import fetch from "node-fetch";', "node-fetch"],
    ['import { request } from "undici";', "undici"],
    ['const got = require("got");', "got"],
    ['const ky = await import("ky");', "ky"],
    ['export { fetch } from "cross-fetch";', "cross-fetch"],
    ['import fetchPolyfill from "node-fetch/lib/index.js";', "node-fetch"],
  ])("another fetch client: %s", (source: string, client: string) => {
    expect(
      importedModulesIn("Example.ts", source).map(fetchClientOf),
    ).toContain(client);
  });

  test.each([
    'import type { Dispatcher } from "undici";',
    'import got from "./got";',
    'import axios from "axios";',
    'const name = "node-fetch";',
  ])("no fetch client: %s", (source: string) => {
    expect(
      importedModulesIn("Example.ts", source)
        .map(fetchClientOf)
        .filter((client: string | null): boolean => {
          return client !== null;
        }),
    ).toEqual([]);
  });
});
