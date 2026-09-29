import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * Where the Enterprise loader runs in the App's boot, pinned from the source.
 *
 * EnterpriseLoader.load() decides the edition for the whole process: the
 * feature sets ask EnterpriseEdition which enterprise routers to mount while
 * they initialise, the admin-health router comes from the loaded module, and
 * the boot guards (billing, or IS_ENTERPRISE_EDITION=true, without ee) must
 * stop the process before anything serves a request. A router mounted before
 * the load would be mounted as the Community Edition, silently. So:
 *
 *   - App/Index.ts awaits EnterpriseLoader.load() unconditionally, before every
 *     feature-set init(), before the admin-health mounts and before every other
 *     router is mounted;
 *   - App/Migrate.ts never runs the loader (ee/README.md: migrations run with
 *     Community defaults and record no audit rows), directly or through
 *     anything it imports from the App;
 *   - the Workers feature set awaits EnterpriseLoader.registerWorkerJobs(),
 *     unconditionally, before its queue consumers start, so a consumer never
 *     picks up an ee-owned cron that has no handler yet.
 *
 * Everything is read with the TypeScript parser after the comments are
 * removed, so a comment that narrates the order can neither satisfy nor break
 * an assertion. Each checker is also fed deliberately broken sources (the
 * negative controls), proving it fails when the order is wrong. Core CI runs
 * without ee/, and nothing here needs it.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");

const INDEX_PATH: string = path.join(APP_ROOT, "Index.ts");
const MIGRATE_PATH: string = path.join(APP_ROOT, "Migrate.ts");
const WORKERS_INDEX_PATH: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Workers",
  "Index.ts",
);
const LOADER_PATH: string = path.join(APP_ROOT, "Utils", "EnterpriseLoader.ts");

const FEATURE_SET_SPECIFIER_PATTERN: RegExp = /^\.\/FeatureSet\/[^/]+\/Index$/;
const INIT_CALLEE_PATTERN: RegExp = /^\w+\.init$/;
const ROUTES_INIT_CALLEE_PATTERN: RegExp = /Routes\.init$/;
const USE_CALLEE_PATTERN: RegExp = /\.use$/;
const LOADER_IDENTIFIER_PATTERN: RegExp = /\bEnterpriseLoader\b/;
const EDITION_IDENTIFIER_PATTERN: RegExp = /\bEnterpriseEdition\b/;

const readFile: (filePath: string) => string = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

const parse: (source: string) => ts.SourceFile = (
  source: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    "Source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
};

/*
 * Comments removed by TypeScript's own printer: string contents stay exactly
 * as written, which a regular expression cannot promise.
 */
const stripComments: (source: string) => string = (source: string): string => {
  return ts.createPrinter({ removeComments: true }).printFile(parse(source));
};

const allNodes: (sourceFile: ts.SourceFile) => Array<ts.Node> = (
  sourceFile: ts.SourceFile,
): Array<ts.Node> => {
  const nodes: Array<ts.Node> = [];
  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
};

const calleeText: (
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
) => string = (call: ts.CallExpression, sourceFile: ts.SourceFile): string => {
  return call.expression.getText(sourceFile).replace(/\s+/g, "");
};

const callsTo: (
  sourceFile: ts.SourceFile,
  matches: (callee: string) => boolean,
) => Array<ts.CallExpression> = (
  sourceFile: ts.SourceFile,
  matches: (callee: string) => boolean,
): Array<ts.CallExpression> => {
  return allNodes(sourceFile).filter(
    (node: ts.Node): node is ts.CallExpression => {
      return ts.isCallExpression(node) && matches(calleeText(node, sourceFile));
    },
  );
};

const enclosingFunction: (node: ts.Node) => ts.Node | undefined = (
  node: ts.Node,
): ts.Node | undefined => {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isFunctionLike(current)) {
    current = current.parent;
  }

  return current;
};

/*
 * Problems with the one call that must run first: it exists exactly once, is
 * awaited as a statement of its own, and is unconditional - every block
 * between it and its function is plain (a try block counts: a throw there
 * still stops the boot).
 */
const findGateProblems: (
  sourceFile: ts.SourceFile,
  gateCallee: string,
) => { problems: Array<string>; gate: ts.CallExpression | null } = (
  sourceFile: ts.SourceFile,
  gateCallee: string,
): { problems: Array<string>; gate: ts.CallExpression | null } => {
  const gates: Array<ts.CallExpression> = callsTo(
    sourceFile,
    (callee: string): boolean => {
      return callee === gateCallee;
    },
  );

  if (gates.length !== 1) {
    return {
      problems: [
        `expected exactly one ${gateCallee}() call, found ${gates.length}`,
      ],
      gate: null,
    };
  }

  const gate: ts.CallExpression = gates[0]!;
  const problems: Array<string> = [];
  const awaited: ts.Node = gate.parent;

  if (
    !ts.isAwaitExpression(awaited) ||
    !ts.isExpressionStatement(awaited.parent)
  ) {
    problems.push(`${gateCallee}() must be awaited as its own statement`);
    return { problems, gate };
  }

  const owner: ts.Node | undefined = enclosingFunction(gate);
  let child: ts.Node = awaited.parent;
  let ancestor: ts.Node = child.parent;

  while (ancestor !== owner) {
    const isPlainBlock: boolean = ts.isBlock(ancestor);
    const isTryBlock: boolean =
      ts.isTryStatement(ancestor) && ancestor.tryBlock === child;

    if (!isPlainBlock && !isTryBlock) {
      problems.push(
        `${gateCallee}() must run unconditionally, but it is inside ${ts.SyntaxKind[ancestor.kind]}`,
      );
      break;
    }

    child = ancestor;
    ancestor = ancestor.parent;
  }

  return { problems, gate };
};

/*
 * Every call in `mustFollow` has to start after the gate's statement ends and
 * sit in the same function, so source order is execution order.
 */
const findOrderProblems: (
  sourceFile: ts.SourceFile,
  gate: ts.CallExpression,
  gateCallee: string,
  mustFollow: Array<ts.CallExpression>,
) => Array<string> = (
  sourceFile: ts.SourceFile,
  gate: ts.CallExpression,
  gateCallee: string,
  mustFollow: Array<ts.CallExpression>,
): Array<string> => {
  const gateEnd: number = gate.parent.parent.getEnd();
  const owner: ts.Node | undefined = enclosingFunction(gate);
  const problems: Array<string> = [];

  for (const call of mustFollow) {
    const callee: string = calleeText(call, sourceFile);

    if (enclosingFunction(call) !== owner) {
      problems.push(
        `${callee}() is not in the same function as ${gateCallee}()`,
      );
    } else if (call.getStart(sourceFile) < gateEnd) {
      problems.push(`${callee}() runs before ${gateCallee}()`);
    }
  }

  return problems;
};

// The feature sets App/Index.ts imports: default imports of ./FeatureSet/*/Index.
const featureSetNames: (sourceFile: ts.SourceFile) => Array<string> = (
  sourceFile: ts.SourceFile,
): Array<string> => {
  const names: Array<string> = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      FEATURE_SET_SPECIFIER_PATTERN.test(statement.moduleSpecifier.text) &&
      statement.importClause?.name
    ) {
      names.push(statement.importClause.name.text);
    }
  }

  return names;
};

const LOAD: string = "EnterpriseLoader.load";

const ROUTER_MOUNTS_AFTER_LOAD: Array<string> = [
  "Realtime.init",
  "CommunityEditionSsoReport.logRelaxedEnforcementOnce",
  "App.addDefaultRoutes",
];

/*
 * Everything wrong with App/Index.ts's boot order, or [] when it is right.
 */
const findAppBootOrderProblems: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const sourceFile: ts.SourceFile = parse(stripComments(source));
  const { problems, gate } = findGateProblems(sourceFile, LOAD);

  if (!gate) {
    return problems;
  }

  const featureSets: Array<string> = featureSetNames(sourceFile);

  if (featureSets.length === 0) {
    problems.push("no ./FeatureSet/*/Index imports found");
  }

  for (const featureSet of featureSets) {
    if (
      callsTo(sourceFile, (callee: string): boolean => {
        return callee === `${featureSet}.init`;
      }).length === 0
    ) {
      problems.push(`${featureSet}.init() is never called`);
    }
  }

  for (const required of [...ROUTER_MOUNTS_AFTER_LOAD]) {
    if (
      callsTo(sourceFile, (callee: string): boolean => {
        return callee === required;
      }).length === 0
    ) {
      problems.push(`${required}() is never called`);
    }
  }

  const adminHealthMounts: Array<ts.CallExpression> = callsTo(
    sourceFile,
    (callee: string): boolean => {
      return callee.endsWith(".getAdminHealthRouter");
    },
  );

  if (adminHealthMounts.length === 0) {
    problems.push("getAdminHealthRouter() is never called");
  }

  const mustFollow: Array<ts.CallExpression> = callsTo(
    sourceFile,
    (callee: string): boolean => {
      return (
        INIT_CALLEE_PATTERN.test(callee) &&
        (featureSets.includes(callee.slice(0, -".init".length)) ||
          ROUTES_INIT_CALLEE_PATTERN.test(callee))
      );
    },
  )
    .concat(adminHealthMounts)
    .concat(
      callsTo(sourceFile, (callee: string): boolean => {
        return (
          ROUTER_MOUNTS_AFTER_LOAD.includes(callee) ||
          USE_CALLEE_PATTERN.test(callee)
        );
      }),
    );

  return problems.concat(findOrderProblems(sourceFile, gate, LOAD, mustFollow));
};

const REGISTER_WORKER_JOBS: string = "EnterpriseLoader.registerWorkerJobs";

/*
 * Everything wrong with the Workers feature set's order, or [] when right.
 */
const findWorkerJobOrderProblems: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const sourceFile: ts.SourceFile = parse(stripComments(source));
  const { problems, gate } = findGateProblems(sourceFile, REGISTER_WORKER_JOBS);

  if (!gate) {
    return problems;
  }

  const consumers: Array<ts.CallExpression> = callsTo(
    sourceFile,
    (callee: string): boolean => {
      return callee.endsWith(".getWorker");
    },
  );

  if (consumers.length === 0) {
    problems.push("no queue consumer (QueueWorker.getWorker) found");
  }

  return problems.concat(
    findOrderProblems(sourceFile, gate, REGISTER_WORKER_JOBS, consumers),
  );
};

const EDITION_MODULE_PATTERN: RegExp =
  /(^|\/)(EnterpriseLoader|EnterpriseEdition)$|(^|\/)ee(\/|$)/;

// Every module specifier a source imports, requires or dynamically imports.
const moduleSpecifiers: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const sourceFile: ts.SourceFile = parse(source);
  const specifiers: Array<string> = [];

  for (const node of allNodes(sourceFile)) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
  }

  return specifiers;
};

/*
 * Everything in a source that would bring the edition machinery into
 * Migrate.ts, or [] when there is none.
 */
const findMigrateEditionProblems: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const problems: Array<string> = moduleSpecifiers(source)
    .filter((specifier: string): boolean => {
      return EDITION_MODULE_PATTERN.test(specifier);
    })
    .map((specifier: string): string => {
      return `imports ${specifier}`;
    });

  const code: string = stripComments(source);

  if (LOADER_IDENTIFIER_PATTERN.test(code)) {
    problems.push("mentions EnterpriseLoader in code");
  }

  if (EDITION_IDENTIFIER_PATTERN.test(code)) {
    problems.push("mentions EnterpriseEdition in code");
  }

  return problems;
};

const resolveRelative: (
  fromFile: string,
  specifier: string,
) => string | null = (fromFile: string, specifier: string): string | null => {
  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, "Index.ts"),
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
};

/*
 * Every file inside `root` reachable from `entry` through relative imports.
 * Core never reaches App through a package specifier, so relative imports are
 * the only way App code pulls in other App code.
 */
const relativeImportClosure: (entry: string, root: string) => Set<string> = (
  entry: string,
  root: string,
): Set<string> => {
  const seen: Set<string> = new Set<string>();
  const queue: Array<string> = [entry];

  while (queue.length > 0) {
    const file: string = queue.pop()!;

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const specifier of moduleSpecifiers(readFile(file))) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        continue;
      }

      const resolved: string | null = resolveRelative(file, specifier);

      if (
        resolved &&
        resolved.startsWith(`${root}${path.sep}`) &&
        !resolved.includes(`${path.sep}node_modules${path.sep}`)
      ) {
        queue.push(resolved);
      }
    }
  }

  return seen;
};

const replaceOnce: (source: string, from: string, to: string) => string = (
  source: string,
  from: string,
  to: string,
): string => {
  expect(source.split(from)).toHaveLength(2);
  return source.replace(from, to);
};

const INDEX_SOURCE: string = readFile(INDEX_PATH);
const WORKERS_SOURCE: string = readFile(WORKERS_INDEX_PATH);
const MIGRATE_SOURCE: string = readFile(MIGRATE_PATH);

const LOAD_STATEMENT: string = "await EnterpriseLoader.load();";
const REGISTER_STATEMENT: string =
  "await EnterpriseLoader.registerWorkerJobs();";

describe("App/Index.ts runs the Enterprise loader before anything is mounted", () => {
  test("the real boot order has no problems", () => {
    expect(findAppBootOrderProblems(INDEX_SOURCE)).toEqual([]);
  });

  test("the checker sees every feature set, so the order check is not vacuous", () => {
    const names: Array<string> = featureSetNames(parse(INDEX_SOURCE));

    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toEqual(
      expect.arrayContaining([
        "IdentityRoutes",
        "WorkersRoutes",
        "BaseAPIRoutes",
      ]),
    );
  });

  test("comments are removed, but code and strings are kept as written", () => {
    const stripped: string = stripComments(
      '/* await EnterpriseLoader.load(); */\n// EnterpriseLoader\nconst route: string = "/api//x"; // tail\n',
    );

    expect(stripped).not.toContain("EnterpriseLoader");
    expect(stripped).toContain('"/api//x"');
  });

  describe("negative controls: the checker fails a wrong order", () => {
    test("the load moved after the feature-set inits", () => {
      const moved: string = replaceOnce(
        replaceOnce(INDEX_SOURCE, LOAD_STATEMENT, ""),
        "await RunbookRoutes.init();",
        `await RunbookRoutes.init();\n    ${LOAD_STATEMENT}`,
      );

      const problems: Array<string> = findAppBootOrderProblems(moved);

      expect(problems).toContain(
        "IdentityRoutes.init() runs before EnterpriseLoader.load()",
      );
      expect(problems).toContain(
        "WorkersRoutes.init() runs before EnterpriseLoader.load()",
      );
      expect(problems).toContain(
        "EnterpriseEdition.getModule()?.getAdminHealthRouter() runs before EnterpriseLoader.load()",
      );
      expect(problems).toContain(
        "expressApp.use() runs before EnterpriseLoader.load()",
      );
    });

    test("one feature set initialised ahead of the load", () => {
      const moved: string = replaceOnce(
        replaceOnce(INDEX_SOURCE, "    await TelemetryRoutes.init();\n", ""),
        LOAD_STATEMENT,
        `await TelemetryRoutes.init();\n    ${LOAD_STATEMENT}`,
      );

      expect(findAppBootOrderProblems(moved)).toEqual([
        "TelemetryRoutes.init() runs before EnterpriseLoader.load()",
      ]);
    });

    test("the load not awaited", () => {
      expect(
        findAppBootOrderProblems(
          replaceOnce(
            INDEX_SOURCE,
            LOAD_STATEMENT,
            "void EnterpriseLoader.load();",
          ),
        ),
      ).toEqual([
        "EnterpriseLoader.load() must be awaited as its own statement",
      ]);
    });

    test("the load made conditional", () => {
      expect(
        findAppBootOrderProblems(
          replaceOnce(
            INDEX_SOURCE,
            LOAD_STATEMENT,
            `if (process.env["LOAD_EE"]) {\n      ${LOAD_STATEMENT}\n    }`,
          ),
        ),
      ).toEqual([
        "EnterpriseLoader.load() must run unconditionally, but it is inside IfStatement",
      ]);
    });

    test("the load removed, with only a comment claiming it still runs first", () => {
      expect(
        findAppBootOrderProblems(
          replaceOnce(
            INDEX_SOURCE,
            LOAD_STATEMENT,
            `/* ${LOAD_STATEMENT} runs first */`,
          ),
        ),
      ).toEqual(["expected exactly one EnterpriseLoader.load() call, found 0"]);
    });

    test("a feature set mounted from a callback instead of in order", () => {
      const moved: string = replaceOnce(
        INDEX_SOURCE,
        "    await DocsRoutes.init();\n",
        "    setImmediate(() => { void DocsRoutes.init(); });\n",
      );

      expect(findAppBootOrderProblems(moved)).toEqual([
        "DocsRoutes.init() is not in the same function as EnterpriseLoader.load()",
      ]);
    });

    test("a feature set that is imported but never initialised", () => {
      expect(
        findAppBootOrderProblems(
          replaceOnce(INDEX_SOURCE, "    await MCPRoutes.init();\n", ""),
        ),
      ).toEqual(["MCPRoutes.init() is never called"]);
    });
  });
});

describe("the Workers feature set registers ee's jobs before its consumers start", () => {
  test("the real order has no problems", () => {
    expect(findWorkerJobOrderProblems(WORKERS_SOURCE)).toEqual([]);
  });

  test("the checker sees both queue consumers", () => {
    expect(
      callsTo(
        parse(stripComments(WORKERS_SOURCE)),
        (callee: string): boolean => {
          return callee === "QueueWorker.getWorker";
        },
      ),
    ).toHaveLength(2);
  });

  describe("negative controls: the checker fails a wrong order", () => {
    test("registration moved after the consumers start", () => {
      const moved: string = replaceOnce(
        replaceOnce(WORKERS_SOURCE, REGISTER_STATEMENT, ""),
        "    } catch (err) {",
        `      ${REGISTER_STATEMENT}\n    } catch (err) {`,
      );

      expect(findWorkerJobOrderProblems(moved)).toEqual([
        "QueueWorker.getWorker() runs before EnterpriseLoader.registerWorkerJobs()",
        "QueueWorker.getWorker() runs before EnterpriseLoader.registerWorkerJobs()",
      ]);
    });

    test("registration only in the worker role", () => {
      expect(
        findWorkerJobOrderProblems(
          replaceOnce(
            WORKERS_SOURCE,
            REGISTER_STATEMENT,
            `if (!DisableQueueWorkers) {\n        ${REGISTER_STATEMENT}\n      }`,
          ),
        ),
      ).toEqual([
        "EnterpriseLoader.registerWorkerJobs() must run unconditionally, but it is inside IfStatement",
      ]);
    });

    test("registration not awaited", () => {
      expect(
        findWorkerJobOrderProblems(
          replaceOnce(
            WORKERS_SOURCE,
            REGISTER_STATEMENT,
            "void EnterpriseLoader.registerWorkerJobs();",
          ),
        ),
      ).toEqual([
        "EnterpriseLoader.registerWorkerJobs() must be awaited as its own statement",
      ]);
    });

    test("registration removed", () => {
      expect(
        findWorkerJobOrderProblems(
          replaceOnce(WORKERS_SOURCE, REGISTER_STATEMENT, ""),
        ),
      ).toEqual([
        "expected exactly one EnterpriseLoader.registerWorkerJobs() call, found 0",
      ]);
    });
  });
});

describe("App/Migrate.ts runs without the Enterprise loader", () => {
  const temporaryDirectories: Array<string> = [];

  afterAll(() => {
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("imports neither EnterpriseLoader nor EnterpriseEdition, and names neither", () => {
    expect(findMigrateEditionProblems(MIGRATE_SOURCE)).toEqual([]);
  });

  test("nothing it imports from the App reaches the loader or the App entry points", () => {
    const closure: Set<string> = relativeImportClosure(MIGRATE_PATH, APP_ROOT);

    // Migrate.ts really pulls in the App's migration code, so this is not vacuous.
    expect(closure.size).toBeGreaterThan(20);
    expect(closure.has(LOADER_PATH)).toBe(false);
    expect(closure.has(INDEX_PATH)).toBe(false);
    expect(closure.has(WORKERS_INDEX_PATH)).toBe(false);
  });

  describe("negative controls: the checks fail when the loader is pulled in", () => {
    test.each([
      'import EnterpriseLoader from "./Utils/EnterpriseLoader";',
      'import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";',
      'const loader: unknown = require("./Utils/EnterpriseLoader");',
      'void import("./Utils/EnterpriseLoader");',
      'export { default } from "../ee/Server/Index";',
    ])("%s", (line: string) => {
      expect(
        findMigrateEditionProblems(`${line}\n${MIGRATE_SOURCE}`),
      ).not.toEqual([]);
    });

    test("a comment that mentions the loader is not a problem", () => {
      expect(
        findMigrateEditionProblems(
          `/* Migrate.ts never imports EnterpriseLoader or EnterpriseEdition. */\n${MIGRATE_SOURCE}`,
        ),
      ).toEqual([]);
    });

    test("the closure finds a loader reached through another App file", () => {
      const root: string = fs.mkdtempSync(
        path.join(os.tmpdir(), "enterprise-boot-wiring-"),
      );
      temporaryDirectories.push(root);
      fs.mkdirSync(path.join(root, "Utils"));
      fs.mkdirSync(path.join(root, "Jobs"));
      fs.writeFileSync(
        path.join(root, "Migrate.ts"),
        'import "./Jobs";\nimport logger from "Common/Server/Utils/Logger";\n',
      );
      fs.writeFileSync(
        path.join(root, "Jobs", "Index.ts"),
        'export { default } from "../Utils/EnterpriseLoader";\n',
      );
      fs.writeFileSync(
        path.join(root, "Utils", "EnterpriseLoader.ts"),
        "export default {};\n",
      );

      const closure: Set<string> = relativeImportClosure(
        path.join(root, "Migrate.ts"),
        root,
      );

      expect(closure.has(path.join(root, "Utils", "EnterpriseLoader.ts"))).toBe(
        true,
      );
    });
  });
});
