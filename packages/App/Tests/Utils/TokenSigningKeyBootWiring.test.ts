import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Where the App loads the key it signs tokens with, pinned from the source.
 *
 * On an installation whose ENCRYPTION_SECRET is unset or a value the
 * repository ships, every app and worker process signs and checks tokens with
 * the installation's own key, kept in Postgres
 * (InstanceTokenSigningKeyService.loadTokenSigningKey). Until a process has
 * loaded it, it signs with a key of its own that no other process shares - so
 * a session signed by one pod would be refused by the next. Hence:
 *
 *   - App/Index.ts awaits loadTokenSigningKey() exactly once, right after
 *     Postgres connects and before anything that signs or checks a token
 *     starts: the cache, the enterprise module, the HTTP server, the realtime
 *     server, any feature set (the workers among them), the startup gate;
 *   - unconditionally, at the top of the boot's try block, whose catch
 *     rethrows: a key that cannot be loaded fails the boot rather than
 *     leaving the process signing with a key nobody else has.
 *
 * Read with the TypeScript parser after the comments are removed, so prose
 * that narrates the order can neither satisfy nor break it. Each check is
 * also run on deliberately broken copies of the boot, to show it fails.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const INDEX_PATH: string = path.join(APP_ROOT, "Index.ts");

const LOAD_CALLEE: string =
  "InstanceTokenSigningKeyService.loadTokenSigningKey";
const LOAD_CALL: string = `await ${LOAD_CALLEE}();`;
const SERVICE_IMPORT: string =
  'import InstanceTokenSigningKeyService from "Common/Server/Services/InstanceTokenSigningKeyService";';
const POSTGRES_CONNECT: string = "await PostgresAppInstance.connect();";

// Everything that may sign or check a token, or start something that does.
const LATER_STEPS: Array<string> = [
  "await Redis.connect();",
  "await App.init({",
  "await EnterpriseLoader.load();",
  "await Realtime.init();",
  "await IdentityRoutes.init();",
  "await NotificationRoutes.init();",
  "await BaseAPIRoutes.init();",
  "await MCPRoutes.init();",
  "await WorkersRoutes.init();",
  "await TelemetryRoutes.init();",
  "await WorkflowRoutes.init();",
  "await RunbookRoutes.init();",
  "StartupGate.open();",
];

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "Index.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function code(source: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(parse(source));
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * What is wrong with the order of a boot's code, comments removed: nothing,
 * when the key is loaded once, after Postgres connects and before every
 * later step.
 */
function orderProblems(source: string): Array<string> {
  const problems: Array<string> = [];

  if (!source.includes(SERVICE_IMPORT)) {
    problems.push("does not import InstanceTokenSigningKeyService");
  }

  if (countOf(source, LOAD_CALL) !== 1) {
    problems.push(`loads the key ${countOf(source, LOAD_CALL)} times`);
    return problems;
  }

  const load: number = source.indexOf(LOAD_CALL);

  if (countOf(source, POSTGRES_CONNECT) !== 1) {
    problems.push("does not connect to Postgres exactly once");
  } else if (source.indexOf(POSTGRES_CONNECT) > load) {
    problems.push("loads the key before Postgres connects");
  }

  for (const laterStep of LATER_STEPS) {
    if (countOf(source, laterStep) !== 1) {
      problems.push(`does not run ${laterStep} exactly once`);
    } else if (source.indexOf(laterStep) < load) {
      problems.push(`runs ${laterStep} before the key is loaded`);
    }
  }

  return problems;
}

/*
 * The syntax between the load and the function it runs in, innermost first,
 * plus what that function is and whether the try it sits in rethrows.
 */
interface LoadPlacement {
  ancestors: Array<string>;
  functionName: string | null;
  catchRethrows: boolean;
}

function loadPlacement(source: string): LoadPlacement | null {
  const sourceFile: ts.SourceFile = parse(source);
  let call: ts.CallExpression | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === LOAD_CALLEE
    ) {
      call = node;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!call) {
    return null;
  }

  const ancestors: Array<ts.Node> = [];
  let node: ts.Node | undefined = (call as ts.CallExpression).parent;

  while (node && !ts.isFunctionLike(node)) {
    ancestors.push(node);
    node = node.parent;
  }

  const tryStatement: ts.Node | undefined = ancestors.find(
    (ancestor: ts.Node): boolean => {
      return ts.isTryStatement(ancestor);
    },
  );
  const catchBlock: string =
    tryStatement && ts.isTryStatement(tryStatement)
      ? tryStatement.catchClause?.block.getText(sourceFile) || ""
      : "";
  const declaration: ts.Node | undefined = node?.parent;

  return {
    ancestors: ancestors.map((ancestor: ts.Node): string => {
      return ts.SyntaxKind[ancestor.kind];
    }),
    functionName:
      node &&
      ts.isArrowFunction(node) &&
      declaration &&
      ts.isVariableDeclaration(declaration)
        ? declaration.name.getText(sourceFile)
        : null,
    catchRethrows: catchBlock.includes("throw err;"),
  };
}

// await -> its statement -> the try block -> the try statement -> the body.
const EXPECTED_PLACEMENT: LoadPlacement = {
  ancestors: [
    "AwaitExpression",
    "ExpressionStatement",
    "Block",
    "TryStatement",
    "Block",
  ],
  functionName: "init",
  catchRethrows: true,
};

const BOOT: string = code(fs.readFileSync(INDEX_PATH, "utf8"));

describe("App/Index.ts loads the token signing key", () => {
  test("once, after Postgres connects, before anything that signs or checks a token starts", () => {
    expect(orderProblems(BOOT)).toEqual([]);
  });

  test("unconditionally, in the boot's try block, whose failure fails the boot", () => {
    expect(loadPlacement(BOOT)).toEqual(EXPECTED_PLACEMENT);
  });
});

describe("the checks fail on a boot that gets it wrong", () => {
  test("a load moved after the routes", () => {
    const moved: string = code(
      BOOT.replace(LOAD_CALL, "").replace(
        "await RunbookRoutes.init();",
        `await RunbookRoutes.init();\n${LOAD_CALL}`,
      ),
    );

    expect(orderProblems(moved)).toEqual(
      expect.arrayContaining([
        "runs await IdentityRoutes.init(); before the key is loaded",
        "runs await App.init({ before the key is loaded",
      ]),
    );
  });

  test("a load before Postgres connects", () => {
    const early: string = code(
      BOOT.replace(LOAD_CALL, "").replace(
        POSTGRES_CONNECT,
        `${LOAD_CALL}\n${POSTGRES_CONNECT}`,
      ),
    );

    expect(orderProblems(early)).toContain(
      "loads the key before Postgres connects",
    );
  });

  test("a boot that never loads it", () => {
    expect(orderProblems(code(BOOT.replace(LOAD_CALL, "")))).toContain(
      "loads the key 0 times",
    );
  });

  test("a load behind a condition", () => {
    const conditional: string = code(
      BOOT.replace(LOAD_CALL, `if (process.env["X"]) {\n${LOAD_CALL}\n}`),
    );

    expect(loadPlacement(conditional)?.ancestors).toContain("IfStatement");
    expect(loadPlacement(conditional)).not.toEqual(EXPECTED_PLACEMENT);
  });

  test("a load whose failure is swallowed", () => {
    const swallowed: string = code(
      BOOT.replace(LOAD_CALL, `try {\n${LOAD_CALL}\n} catch {\n}`),
    );

    expect(loadPlacement(swallowed)).not.toEqual(EXPECTED_PLACEMENT);
  });

  test("a load that is not awaited", () => {
    const floating: string = code(
      BOOT.replace(LOAD_CALL, `void ${LOAD_CALLEE}();`),
    );

    expect(orderProblems(floating)).toContain("loads the key 0 times");
    expect(loadPlacement(floating)?.ancestors[0]).toBe("VoidExpression");
  });
});
