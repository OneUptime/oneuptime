import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Which check each service hands StatusAPI for its probes, pinned from the
 * source: importing App/Index.ts or Nginx/Index.ts would boot the service.
 * Comments are not part of the syntax tree, so a comment can neither satisfy
 * nor break an assertion.
 *
 * The rule is on StatusAPIOptions: liveCheck must not depend on Postgres,
 * Valkey or ClickHouse, and readyCheck must check them. Both services used to
 * pass one datastore check as both, which went unnoticed only because the
 * check could not fail. The negative controls at the bottom feed the
 * checkers that old wiring.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const SERVICES: Array<{ name: string; file: string }> = [
  {
    name: "App (the app, worker and telemetry-writer pods)",
    file: "packages/App/Index.ts",
  },
  { name: "Nginx (the ingress)", file: "packages/Nginx/Index.ts" },
];

// Any identifier through which a probe check could reach a datastore.
const DATASTORE_IDENTIFIER: RegExp =
  /InfrastructureStatus|Postgres|Redis|Valkey|Clickhouse/;

type Probe = "liveCheck" | "readyCheck";

const parse: (source: string) => ts.SourceFile = (
  source: string,
): ts.SourceFile => {
  return ts.createSourceFile("Index.ts", source, ts.ScriptTarget.Latest, true);
};

function findAll<T extends ts.Node>(
  root: ts.Node,
  matches: (node: ts.Node) => node is T,
): Array<T> {
  const found: Array<T> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (matches(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(root);
  return found;
}

/*
 * The function a probe is wired to: the value of liveCheck / readyCheck in
 * the statusOptions object, following an identifier to its declaration.
 */
function probeCheck(file: ts.SourceFile, probe: Probe): ts.Node {
  const statusOptions: ts.PropertyAssignment | undefined = findAll(
    file,
    ts.isPropertyAssignment,
  ).find((property: ts.PropertyAssignment) => {
    return property.name.getText(file) === "statusOptions";
  });

  if (
    !statusOptions ||
    !ts.isObjectLiteralExpression(statusOptions.initializer)
  ) {
    throw new Error("No statusOptions object literal found");
  }

  const property: ts.ObjectLiteralElementLike | undefined =
    statusOptions.initializer.properties.find(
      (element: ts.ObjectLiteralElementLike) => {
        return element.name?.getText(file) === probe;
      },
    );

  if (!property) {
    throw new Error(`statusOptions has no ${probe}`);
  }

  let value: ts.Node = property;

  if (ts.isPropertyAssignment(property)) {
    value = property.initializer;
  } else if (ts.isShorthandPropertyAssignment(property)) {
    value = property.name;
  }

  if (!ts.isIdentifier(value)) {
    return value;
  }

  const name: string = value.text;
  const declaration: ts.VariableDeclaration | undefined = findAll(
    file,
    ts.isVariableDeclaration,
  ).find((candidate: ts.VariableDeclaration) => {
    return candidate.name.getText(file) === name;
  });

  if (!declaration?.initializer) {
    throw new Error(`Cannot find the declaration of ${name}`);
  }

  return declaration.initializer;
}

/*
 * The datastore identifiers a check refers to. An option key such as
 * checkPostgresStatus names a datastore without reaching it.
 */
function datastoresReachedBy(check: ts.Node): Array<string> {
  return findAll(check, ts.isIdentifier)
    .filter((identifier: ts.Identifier) => {
      const parent: ts.Node = identifier.parent;
      return !(ts.isPropertyAssignment(parent) && parent.name === identifier);
    })
    .map((identifier: ts.Identifier) => {
      return identifier.text;
    })
    .filter((name: string) => {
      return DATASTORE_IDENTIFIER.test(name);
    });
}

// The check*Status flags a check sets to true in checkStatusWithRetry calls.
function datastoresCheckedBy(check: ts.Node): Array<string> {
  return findAll(check, ts.isCallExpression)
    .filter((call: ts.CallExpression) => {
      return (
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "checkStatusWithRetry"
      );
    })
    .flatMap((call: ts.CallExpression) => {
      const options: ts.Expression | undefined = call.arguments[0];

      if (!options || !ts.isObjectLiteralExpression(options)) {
        return [];
      }

      return options.properties
        .filter(ts.isPropertyAssignment)
        .filter((flag: ts.PropertyAssignment) => {
          return flag.initializer.kind === ts.SyntaxKind.TrueKeyword;
        })
        .map((flag: ts.PropertyAssignment) => {
          return flag.name.getText();
        });
    });
}

describe.each(SERVICES)("$name", ({ file }: { file: string }) => {
  const source: ts.SourceFile = parse(
    fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
  );

  test("its liveness check reaches no datastore", () => {
    expect(datastoresReachedBy(probeCheck(source, "liveCheck"))).toEqual([]);
  });

  test("its readiness check checks a datastore", () => {
    expect(
      datastoresCheckedBy(probeCheck(source, "readyCheck")).length,
    ).toBeGreaterThan(0);
  });
});

describe("the wiring checks themselves", () => {
  const SHARED_CHECK: string = `
    const statusCheck = async () => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: true,
        checkRedisStatus: false,
        retryCount: 3,
      });
    };

    App.init({
      statusOptions: { liveCheck: statusCheck, readyCheck: statusCheck },
    });
  `;

  test("catch a liveness check that reaches a datastore", () => {
    expect(
      datastoresReachedBy(probeCheck(parse(SHARED_CHECK), "liveCheck")),
    ).toEqual(["InfrastructureStatus"]);
  });

  test("read which datastores a readiness check checks", () => {
    expect(
      datastoresCheckedBy(probeCheck(parse(SHARED_CHECK), "readyCheck")),
    ).toEqual(["checkPostgresStatus"]);
  });

  test("catch a readiness check that checks nothing", () => {
    const noChecks: string = `
      App.init({
        statusOptions: { liveCheck: async () => {}, readyCheck: async () => {} },
      });
    `;

    expect(
      datastoresCheckedBy(probeCheck(parse(noChecks), "readyCheck")),
    ).toEqual([]);
  });
});
