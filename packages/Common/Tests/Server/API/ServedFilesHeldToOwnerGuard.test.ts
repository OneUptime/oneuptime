import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY FILE A ROUTE SERVES IS HELD TO ITS OWNER FIRST.
 *
 * A status page's images, a dashboard's images, a note's attachments and a
 * person's picture are served by routes that read the record and send the
 * file it points at. Writes accept only a record's own files
 * (FileOwnership), but a route must not trust whatever wrote the row: each
 * one checks the owner again as it reads. This scans every server route
 * that sends a stored file's bytes and requires, for each send:
 *
 *   - Response.sendFileResponse(req, res, file): `file` is a local variable
 *     set from FileOwnership.keepProjectFile / findProjectAttachment, or the
 *     send sits inside an `if` that asks FileOwnership.isFileOfProject /
 *     isFileOfUser;
 *   - DashboardAPI.getFileAsBase64JSONObject(file): `file` is
 *     FileOwnership.keepProjectFile(...).
 *
 * A route that is right to serve a file by other means goes in
 * ALLOWED_FILES with its reason; the guard fails when an entry no longer
 * sends a file, so the list cannot outlive the code it excuses.
 */

// packages/Common/Tests/Server/API -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
// packages/Common -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages", "Common", "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

const ALLOWED_FILES: Record<string, string> = {
  // The definition of sendFileResponse itself.
  "packages/Common/Server/Utils/Response.ts": "defines sendFileResponse",
  /*
   * Serves a file by its unguessable access token (inline images), or by
   * id only once it is public - never a record's file on the record's
   * behalf. What may become public is held to the record's project where
   * a file is made public (FileService.makeRecordFilePublic,
   * InlineImageAccessTokenSync).
   */
  "packages/Common/Server/API/FileAPI.ts":
    "serves files by access token or public flag",
};

const HOLDING_CALLS: ReadonlySet<string> = new Set<string>([
  "FileOwnership.keepProjectFile",
  "FileOwnership.findProjectAttachment",
]);

const HOLDING_CONDITIONS: Array<string> = [
  "FileOwnership.isFileOfProject(",
  "FileOwnership.isFileOfUser(",
];

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name === "Tests"
    ) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRelativePath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function calleeText(call: ts.CallExpression, source: ts.SourceFile): string {
  return call.expression.getText(source);
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// Whether an expression is a call that holds a file to its owner.
function isHoldingCall(
  expression: ts.Expression | undefined,
  source: ts.SourceFile,
): boolean {
  if (!expression) {
    return false;
  }

  const unwrapped: ts.Expression = unwrap(expression);

  return (
    ts.isCallExpression(unwrapped) &&
    HOLDING_CALLS.has(calleeText(unwrapped, source))
  );
}

// The function a node is written in.
function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }

    current = current.parent;
  }

  return node.getSourceFile();
}

// Whether `name` is declared in `scope` from a call that holds it to its owner.
function isDeclaredFromHoldingCall(
  name: string,
  scope: ts.Node,
  source: ts.SourceFile,
): boolean {
  let found: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      isHoldingCall(node.initializer, source)
    ) {
      found = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(scope);

  return found;
}

// Whether a node sits in an `if` whose condition holds a file to its owner.
function isInsideHoldingCondition(
  node: ts.Node,
  source: ts.SourceFile,
): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isIfStatement(current)) {
      const condition: string = current.expression.getText(source);

      if (
        HOLDING_CONDITIONS.some((call: string): boolean => {
          return condition.includes(call);
        })
      ) {
        return true;
      }
    }

    current = current.parent;
  }

  return false;
}

interface ServedFile {
  file: string;
  line: number;
  send: string;
  held: boolean;
}

function servedFilesOf(file: string): Array<ServedFile> {
  const text: string = fs.readFileSync(file, "utf8");

  if (
    !text.includes("sendFileResponse(") &&
    !text.includes("getFileAsBase64JSONObject(")
  ) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const served: Array<ServedFile> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: string = calleeText(node, source);
      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      if (callee.endsWith("sendFileResponse") && node.arguments.length >= 3) {
        const argument: ts.Expression = unwrap(node.arguments[2]!);

        const held: boolean =
          (ts.isIdentifier(argument) &&
            isDeclaredFromHoldingCall(
              argument.text,
              enclosingFunction(node),
              source,
            )) ||
          isInsideHoldingCondition(node, source);

        served.push({
          file: toRelativePath(file),
          line: line,
          send: node.getText(source).replace(/\s+/g, " "),
          held: held,
        });
      }

      if (
        callee.endsWith("getFileAsBase64JSONObject") &&
        node.arguments.length === 1
      ) {
        served.push({
          file: toRelativePath(file),
          line: line,
          send: node.getText(source).replace(/\s+/g, " "),
          held: isHoldingCall(node.arguments[0], source),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return served;
}

const SERVED: Array<ServedFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
)
  .filter((file: string): boolean => {
    return !ALLOWED_FILES[toRelativePath(file)];
  })
  .flatMap(servedFilesOf);

describe("every file a route serves is held to its owner first", () => {
  test("finds the routes that serve a record's files", () => {
    const files: Array<string> = Array.from(
      new Set(
        SERVED.map((served: ServedFile): string => {
          return served.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/AlertInternalNoteAPI.ts",
        "packages/Common/Server/API/DashboardAPI.ts",
        "packages/Common/Server/API/IncidentAPI.ts",
        "packages/Common/Server/API/IncidentEpisodePublicNoteAPI.ts",
        "packages/Common/Server/API/IncidentInternalNoteAPI.ts",
        "packages/Common/Server/API/IncidentPublicNoteAPI.ts",
        "packages/Common/Server/API/ScheduledMaintenanceInternalNoteAPI.ts",
        "packages/Common/Server/API/ScheduledMaintenancePublicNoteAPI.ts",
        "packages/Common/Server/API/StatusPageAPI.ts",
        "packages/Common/Server/API/StatusPageAnnouncementAPI.ts",
        "packages/Common/Server/API/UserAPI.ts",
      ]),
    );

    // The status page's three images and five attachment routes.
    expect(
      SERVED.filter((served: ServedFile): boolean => {
        return served.file === "packages/Common/Server/API/StatusPageAPI.ts";
      }).length,
    ).toBe(8);
  });

  test("each send serves a file held to its owner", () => {
    expect(
      SERVED.filter((served: ServedFile): boolean => {
        return !served.held;
      }),
    ).toEqual([]);
  });

  test("every allowed file still sends a file", () => {
    for (const allowed of Object.keys(ALLOWED_FILES)) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, allowed),
        "utf8",
      );

      expect({ allowed, sendsFiles: text.includes("sendFileResponse(") }).toEqual(
        { allowed, sendsFiles: true },
      );
    }
  });
});
