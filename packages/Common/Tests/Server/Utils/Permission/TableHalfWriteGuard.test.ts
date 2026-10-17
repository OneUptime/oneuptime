import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A CHANGE TO ONE RECORD IS DECIDED FOR THAT RECORD.
 *
 * holdsModelPermission (CallerPermission's, and HeldPermissionsUtil's under
 * it) is the table half of a permission check: whether the caller holds one
 * of a model's own permissions for an operation somewhere in the project. It
 * never asks whether that permission reaches a given record - an edit grant
 * limited to the "staging" label does not reach a cluster labelled
 * "production", a grant scoped to Owned does not reach a cluster nobody on
 * the caller's teams owns, and a block on one of the record's labels takes
 * it away - so it can decide a read of a whole table, which the record
 * reads then narrow, and nothing that changes, deletes or acts on one
 * record. The Kubernetes AI access test once let a member whose edit of
 * clusters was limited to some labels run kubectl on every cluster they
 * could read, because it asked exactly this.
 *
 * Such a route decides with the record's own row instead, as an update or a
 * delete through the API would: DatabaseService.findOneUpdatableById, or
 * ModelPermission.checkUpdatePermissionByModel with the update query
 * (KubernetesClusterAiAccessService.assertCallerMayChangeCluster,
 * ResourceAiAccessService.assertCallerMayChangeResource).
 *
 * This guard reads the server's source through the TypeScript syntax tree:
 * every call of holdsModelPermission names its operation as the string
 * "read", except in a file listed in GENERIC_CALLERS - the rule's own
 * definitions, and the route guard that hands the operation on to a route
 * whose records are then weighed with the caller's props. The list only
 * shrinks: an entry whose file no longer calls it fails the guard until the
 * entry goes.
 */

// packages/Common/Tests/Server/Utils/Permission -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

// Server code. ee/ is scanned when it is checked out (CI's Common job runs without it).
const SCANNED_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/App/API",
  "packages/App/Services",
  "packages/App/Utils",
  "packages/App/FeatureSet/APIReference",
  "packages/App/FeatureSet/BaseAPI",
  "packages/App/FeatureSet/Docs",
  "packages/App/FeatureSet/Frontend",
  "packages/App/FeatureSet/Identity",
  "packages/App/FeatureSet/MCP",
  "packages/App/FeatureSet/Notification",
  "packages/App/FeatureSet/Runbook",
  "packages/App/FeatureSet/Telemetry",
  "packages/App/FeatureSet/Workers",
  "packages/App/FeatureSet/Workflow",
  "ee/Server",
];

/*
 * The files that hand holdsModelPermission an operation they did not write
 * down themselves, and why each one is not a decision about a record.
 */
const GENERIC_CALLERS: Record<string, string> = {
  "packages/Common/Server/Utils/Permission/CallerPermission.ts":
    "Defines CallerPermission.holdsModelPermission: hands the caller's rows and the operation to HeldPermissionsUtil.",
  "packages/Common/Server/Middleware/UserAuthorization.ts":
    "requireModelPermission: a route guard ahead of a route that weighs the records it reads or writes with the caller's props (PhoneNumber's routes decide the number with checkUpdatePermissionByModel).",
  "packages/Common/Utils/IncomingCall/IncomingCallPhoneNumberAccess.ts":
    "The table half the incoming call number routes' guard and the dashboard's number picker share; the routes then decide the one policy as an update of it would (PhoneNumber: checkUpdatePermissionByModel and the update query).",
};

// The one operation the table half may decide.
const READ: string = "read";

const METHOD: string = "holdsModelPermission";

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "build" ||
        entry.name === "Tests"
      ) {
        continue;
      }

      found.push(...listSourceFiles(full));
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

interface Call {
  file: string;
  line: number;
  // The operation as written: a string literal's value, or null for anything else.
  operation: string | null;
  text: string;
}

/*
 * The operation a call names: the `operation` of the object literal it is
 * handed (holdsModelPermission(carrier, { model, operation }) or
 * HeldPermissionsUtil.holdsModelPermission(held, { ..., operation })), as
 * a string literal - or null when it is anything else, or not there.
 */
function getOperation(call: ts.CallExpression): string | null {
  for (const argument of call.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) {
      continue;
    }

    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        property.name.getText() === "operation"
      ) {
        return ts.isStringLiteral(property.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(property.initializer)
          ? property.initializer.text
          : null;
      }
    }
  }

  return null;
}

// Every call of a method named holdsModelPermission, in source `text`.
function findCalls(file: string, text: string): Array<Call> {
  if (!text.includes(METHOD)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const calls: Array<Call> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== METHOD
    ) {
      return;
    }

    calls.push({
      file: file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      operation: getOperation(node),
      text: node.getText(sourceFile).split("\n")[0]!,
    });
  });

  return calls;
}

function scanServer(): Array<Call> {
  return SCANNED_ROOTS.flatMap((root: string): Array<Call> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root)).flatMap(
      (file: string): Array<Call> => {
        return findCalls(
          toRepositoryPath(file),
          fs.readFileSync(file, "utf8"),
        );
      },
    );
  });
}

describe("a change to one record is decided for that record", () => {
  const calls: Array<Call> = scanServer();

  test("the scan finds the table-half checks the server makes", () => {
    // The reads of whole tables that are known to ask it.
    expect(
      calls.some((call: Call): boolean => {
        return (
          call.file ===
            "packages/App/FeatureSet/BaseAPI/API/ServiceDependencyTimeseries.ts" &&
          call.operation === READ
        );
      }),
    ).toBe(true);
    expect(
      calls.some((call: Call): boolean => {
        return call.file === "packages/Common/Server/Utils/Realtime.ts";
      }),
    ).toBe(true);
  });

  test("holdsModelPermission decides only reads, outside the listed files", () => {
    const offenders: Array<string> = calls
      .filter((call: Call): boolean => {
        return !GENERIC_CALLERS[call.file] && call.operation !== READ;
      })
      .map((call: Call): string => {
        return `${call.file}:${call.line} asks ${
          call.operation === null
            ? "an operation it does not write down"
            : `"${call.operation}"`
        }: ${call.text}`;
      });

    /*
     * A route that changes, deletes or acts on one record decides with the
     * record's own row (DatabaseService.findOneUpdatableById): the table
     * half cannot see the record's labels or owners.
     */
    expect(offenders).toEqual([]);
  });

  test("every listed file still calls it, so the list only shrinks", () => {
    const callers: Set<string> = new Set<string>(
      calls.map((call: Call): string => {
        return call.file;
      }),
    );

    const stale: Array<string> = Object.keys(GENERIC_CALLERS).filter(
      (file: string): boolean => {
        return !callers.has(file);
      },
    );

    expect(stale).toEqual([]);
  });

  /*
   * The guard can see what it guards against: the call the AI access test
   * used to make is found and refused.
   */
  test("the old access-test check would be refused", () => {
    const source: string = `
      CallerPermission.holdsModelPermission(
        props,
        { model: new KubernetesCluster(), operation: "update" },
        { projectId: projectId },
      );
      HeldPermissionsUtil.holdsModelPermission(held, {
        isOperationalResource: false,
        operation: someOperation,
        modelPermissions: [],
      });
      CallerPermission.holdsModelPermission(props, {
        model: new Span(),
        operation: "read",
      });
    `;

    const found: Array<Call> = findCalls("Example.ts", source);

    expect(
      found.map((call: Call): string | null => {
        return call.operation;
      }),
    ).toEqual(["update", null, READ]);
    expect(
      found.filter((call: Call): boolean => {
        return call.operation !== READ;
      }),
    ).toHaveLength(2);
  });
});
