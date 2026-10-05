import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * A reference has two names a write can use - the relation (`monitor`) and
 * its ID column (`monitorId`) - and they are one database column. When a
 * write carries both, TypeORM stores the relation's id
 * (RelationNamePrecedence.test.ts). So server code that checks or acts on a
 * reference reads both names, through RelationIdUtil.readConsistent (or
 * getWrittenRelationReferences, built on it), which refuses a write whose two
 * names disagree - never one name with the other as a fallback:
 *
 *   resolveReferenceId(data.monitorId) || resolveReferenceId(data.monitor)
 *   resolveReferenceId(data.monitorId || data.monitor)
 *   createBy.data.monitorId || createBy.data.monitor?.id
 *   RelationIdUtil.read(data, ["monitorId", "monitor"])
 *
 * Each of those reads the first name that holds an id: a write naming one
 * record under one name and another under the other has the first checked
 * and the second stored. This scans packages/Common/Server for all four
 * shapes. A read off a stored row (`incident.createdByUserId ||
 * incident.createdByUser?.id`) is not a write's and is left alone.
 */

const SERVER_DIRECTORY: string = path.resolve(__dirname, "../../../../Server");

/*
 * The expressions a hook reads a write's payload through. A read off any
 * other object - a row read back, a function argument - is not a write's.
 */
const PAYLOAD_ROOTS: Array<string> = [
  "createBy.data",
  "updateBy.data",
  "onCreate.createBy.data",
  "onUpdate.updateBy.data",
];

export interface SingleNameRead {
  file: string;
  line: number;
  text: string;
}

function listTypeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listTypeScriptFiles(fullPath));
      }

      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

// Parentheses, `as` casts and non-null assertions do not change what is read.
function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

interface MemberRead {
  // The object read from, as written: "createBy.data".
  object: string;
  // The property read: "monitorId", or "monitor" for `monitor?.id`.
  name: string;
}

/*
 * `a.b`, `a?.b`, `a["b"]`, and a relation read through its id (`a.b?.id`,
 * `a.b._id`) as the relation itself.
 */
function readMember(
  node: ts.Expression,
  source: ts.SourceFile,
): MemberRead | null {
  const expression: ts.Expression = unwrap(node);

  if (ts.isPropertyAccessExpression(expression)) {
    const name: string = expression.name.text;

    if (name === "id" || name === "_id") {
      const relation: MemberRead | null = readMember(
        expression.expression,
        source,
      );

      if (relation) {
        return relation;
      }
    }

    return {
      object: unwrap(expression.expression).getText(source),
      name: name,
    };
  }

  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return {
      object: unwrap(expression.expression).getText(source),
      name: expression.argumentExpression.text,
    };
  }

  return null;
}

// `monitorId` and `monitor`, in either order.
function areTwoNamesOfOneReference(first: string, second: string): boolean {
  return first === `${second}Id` || second === `${first}Id`;
}

// A call of resolveReferenceId, imported or qualified.
const RESOLVE_REFERENCE_ID_CALLEE: RegExp = /(^|\.)resolveReferenceId$/;

// A call of RelationIdUtil.read, which reads the first key holding an id.
const FIRST_WINS_READ_CALLEE: RegExp = /(^|\.)RelationIdUtil\.read$/;

// The argument of `resolveReferenceId(x)`, or null for anything else.
function resolvedArgument(node: ts.Expression): ts.Expression | null {
  const expression: ts.Expression = unwrap(node);

  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    RESOLVE_REFERENCE_ID_CALLEE.test(
      expression.expression.getText().replace(/\s+/g, ""),
    )
  ) {
    return expression.arguments[0]!;
  }

  return null;
}

function isFallback(node: ts.Node): node is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

// The string entries of an array literal, or null when it holds anything else.
function stringEntries(node: ts.Expression): Array<string> | null {
  const expression: ts.Expression = unwrap(node);

  if (!ts.isArrayLiteralExpression(expression)) {
    return null;
  }

  const entries: Array<string> = [];

  for (const element of expression.elements) {
    if (!ts.isStringLiteralLike(element)) {
      return null;
    }

    entries.push(element.text);
  }

  return entries;
}

// Every `const X = [...]` of string literals in a file, by name.
function arrayConstants(source: ts.SourceFile): Map<string, Array<string>> {
  const constants: Map<string, Array<string>> = new Map();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const entries: Array<string> | null = stringEntries(node.initializer);

      if (entries) {
        constants.set(node.name.text, entries);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return constants;
}

function holdsTwoNamesOfOneReference(keys: Array<string>): boolean {
  return keys.some((first: string): boolean => {
    return keys.some((second: string): boolean => {
      return areTwoNamesOfOneReference(first, second);
    });
  });
}

/*
 * The places in `text` (one file's source) that read a reference's two
 * names first-wins. Exported for the self-test below.
 */
export function findSingleNameReads(
  fileName: string,
  text: string,
): Array<SingleNameRead> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const constants: Map<string, Array<string>> = arrayConstants(source);
  const found: Array<SingleNameRead> = [];

  // A fallback already reported as the argument of resolveReferenceId.
  const reportedFallbacks: Set<ts.Node> = new Set();

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    found.push({
      file: fileName,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isFallback(node) && !reportedFallbacks.has(node)) {
      const left: ts.Expression | null = resolvedArgument(node.left);
      const right: ts.Expression | null = resolvedArgument(node.right);

      // resolveReferenceId(a.xId) || resolveReferenceId(a.x)
      if (left && right) {
        const first: MemberRead | null = readMember(left, source);
        const second: MemberRead | null = readMember(right, source);

        if (
          first &&
          second &&
          areTwoNamesOfOneReference(first.name, second.name)
        ) {
          report(node);
        }
      }

      // createBy.data.xId || createBy.data.x?.id
      const first: MemberRead | null = readMember(node.left, source);
      const second: MemberRead | null = readMember(node.right, source);

      if (
        first &&
        second &&
        first.object === second.object &&
        PAYLOAD_ROOTS.includes(first.object) &&
        areTwoNamesOfOneReference(first.name, second.name)
      ) {
        report(node);
      }
    }

    if (ts.isCallExpression(node)) {
      // resolveReferenceId(a.xId || a.x)
      const argument: ts.Expression | null = resolvedArgument(node);

      if (argument && isFallback(unwrap(argument))) {
        const fallback: ts.BinaryExpression = unwrap(
          argument,
        ) as ts.BinaryExpression;
        const first: MemberRead | null = readMember(fallback.left, source);
        const second: MemberRead | null = readMember(fallback.right, source);

        if (
          first &&
          second &&
          areTwoNamesOfOneReference(first.name, second.name)
        ) {
          report(node);
          reportedFallbacks.add(fallback);
        }
      }

      // RelationIdUtil.read(data, ["xId", "x"])
      if (
        FIRST_WINS_READ_CALLEE.test(
          node.expression.getText(source).replace(/\s+/g, ""),
        ) &&
        node.arguments.length >= 2
      ) {
        const keysArgument: ts.Expression = unwrap(node.arguments[1]!);
        const keys: Array<string> | null = ts.isIdentifier(keysArgument)
          ? constants.get(keysArgument.text) || null
          : stringEntries(keysArgument);

        if (keys && holdsTwoNamesOfOneReference(keys)) {
          report(node);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("the scan sees every shape of a single-name read", () => {
  const SHAPES: Array<[string, string]> = [
    [
      "resolveReferenceId(ID column) || resolveReferenceId(relation)",
      "const id = resolveReferenceId(updateBy.data.incidentSeverityId) || resolveReferenceId(updateBy.data.incidentSeverity);",
    ],
    [
      "the relation first",
      "const id = resolveReferenceId(data.monitor) || resolveReferenceId(data.monitorId);",
    ],
    [
      "?? in place of ||",
      "const id = resolveReferenceId(data.monitorId) ?? resolveReferenceId(data.monitor);",
    ],
    [
      "bracket access",
      'const id = resolveReferenceId(data["changeMonitorStatusToId"]) || resolveReferenceId(data["changeMonitorStatusTo"]);',
    ],
    [
      "the fallback inside the call",
      "const id = resolveReferenceId(createBy.data.statusPageId || createBy.data.statusPage);",
    ],
    [
      "a write's payload read through the relation's id",
      "const id = createBy.data.teamId || createBy.data.team?.id;",
    ],
    [
      "an update's payload, cast",
      'const id = (updateBy.data as Record<string, unknown>)["statusPageGroupId"] || (updateBy.data as Record<string, unknown>)["statusPageGroup"];',
    ],
    [
      "a success hook's payload",
      "const id = onUpdate.updateBy.data.currentIncidentStateId || onUpdate.updateBy.data.currentIncidentState;",
    ],
    [
      "RelationIdUtil.read with the two names",
      'const id = RelationIdUtil.read(data, ["siteId", "site"]);',
    ],
    [
      "RelationIdUtil.read with a constant holding them",
      'const SITE_KEYS: Array<string> = ["siteId", "site"];\nconst id = RelationIdUtil.read(data, SITE_KEYS);',
    ],
  ];

  test.each(SHAPES)("%s", (_shape: string, code: string) => {
    expect(findSingleNameReads("Shape.ts", code)).toHaveLength(1);
  });

  const NOT_SINGLE_NAME_READS: Array<[string, string]> = [
    [
      "readConsistent",
      'const id = RelationIdUtil.readConsistent(data, ["siteId", "site"], "Site");',
    ],
    [
      "a stored row read back",
      "const id = createdItem.createdByUserId || createdItem.createdByUser?.id;",
    ],
    [
      "two different references",
      "const id = resolveReferenceId(data.monitorId) || resolveReferenceId(data.probe);",
    ],
    [
      "the requester before the payload",
      "const id = createBy.props.userId || createBy.data.createdByUserId;",
    ],
    ["one name read alone", 'const id = RelationIdUtil.read(data, ["entry"]);'],
    [
      "a model's own id",
      'const id = RelationIdUtil.read(monitor, ["_id", "id"]);',
    ],
  ];

  test.each(NOT_SINGLE_NAME_READS)(
    "not flagged: %s",
    (_shape: string, code: string) => {
      expect(findSingleNameReads("Shape.ts", code)).toEqual([]);
    },
  );
});

describe("server code reads both names of a reference together", () => {
  const files: Array<string> = listTypeScriptFiles(SERVER_DIRECTORY);

  test("the scan reads the services", () => {
    // A scan that read nothing would pass everything below.
    expect(files.length).toBeGreaterThan(500);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Services", "IncidentService.ts"));
      }),
    ).toBe(true);
  });

  test("no check or decision reads one name with the other as a fallback", () => {
    const found: Array<string> = files.flatMap((file: string) => {
      return findSingleNameReads(
        path.relative(SERVER_DIRECTORY, file),
        fs.readFileSync(file, "utf8"),
      ).map((read: SingleNameRead): string => {
        return `${read.file}:${read.line}  ${read.text}`;
      });
    });

    expect(found).toEqual([]);
  });
});
