import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Where a state's built-in flag (isResolvedState, isAcknowledgedState, the
 * scheduled maintenance flags) is read to decide something, for the guards
 * that keep those decisions in one helper each (OneResolvedRuleGuard,
 * OneAcknowledgedRuleGuard, OneInProgressRuleGuard,
 * OneMaintenancePhaseRuleGuard) - and, at the end of this file, where two
 * states' places are compared to decide it.
 *
 * A read is:
 *
 *   - `x.flag`, `x?.flag`, `x["flag"]`, or a destructured `{ flag }` - except
 *     a write (`state.flag = true`) and the flags handed on as they are
 *     (`flag: state.flag`), into a helper's input, say;
 *   - a query that asks for records by it (`query`, `countQuery`, a
 *     `Query<...>` or a `where`: `currentIncidentState: { flag: false }`),
 *     and `flag: false` anywhere but a select, which only ever asks for
 *     records by the flag.
 *
 * Selecting the flag, to hand it to the helper, is no read; nor is a label
 * map, a string naming the flag, or a type member. Only real syntax is read,
 * through the TypeScript AST.
 */

export const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../..");

/*
 * Where the readers live. A directory that is not in the checkout is skipped
 * (the core test job runs without ee/).
 */
const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/App/FeatureSet",
  "packages/MobileApp/src",
  "ee/Server",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  // Schema history: what the database looked like then, not a reader.
  "SchemaMigrations",
  "DataMigrations",
]);

export interface FlagRead {
  file: string;
  line: number;
  text: string;
}

const QUERY_CONTEXT: RegExp = /^(query|\w*Query|where)$/;
const SELECT_CONTEXT: RegExp = /^(select|selectMoreFields|\w*Select)$/;

// The names and types that make a node a select or a query.
const SELECT_TYPE: RegExp = /\bSelect</;
const QUERY_TYPE: RegExp = /\bQuery</;
const SELECT_TARGET: RegExp = /\b\w*[sS]elect\b/;
const QUERY_TARGET: RegExp = /\b(query|\w*Query)\b/;

// The source files the guards read: TypeScript, not tests.
const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;

function nameOf(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

/*
 * What an object literal property sits in: a query, a select, or neither,
 * from the nearest property, JSX attribute, typed variable or assignment that
 * names it.
 */
function contextOf(
  source: ts.SourceFile,
  node: ts.Node,
): "query" | "select" | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isPropertyAssignment(current) || ts.isJsxAttribute(current)) {
      const name: string | null = nameOf(current.name);

      if (name && SELECT_CONTEXT.test(name)) {
        return "select";
      }

      if (name && QUERY_CONTEXT.test(name)) {
        return "query";
      }
    }

    if (ts.isVariableDeclaration(current) && current.type) {
      const type: string = current.type.getText(source);

      if (SELECT_TYPE.test(type)) {
        return "select";
      }

      if (QUERY_TYPE.test(type)) {
        return "query";
      }
    }

    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target: string = current.left.getText(source);

      if (SELECT_TARGET.test(target)) {
        return "select";
      }

      if (QUERY_TARGET.test(target)) {
        return "query";
      }
    }

    // A function boundary ends the search: its body is a context of its own.
    if (ts.isFunctionLike(current)) {
      return null;
    }

    current = current.parent;
  }

  return null;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

// `flag: state.flag`: the flags handed on as they are.
function isHandedOn(flag: string, node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    nameOf(parent.name) === flag
  );
}

// Every read of `flag`, and every query on it, in one source file's text.
export function findStateFlagReads(
  flag: string,
  file: string,
  text: string,
): Array<FlagRead> {
  if (!text.includes(flag)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const reads: Array<FlagRead> = [];

  const record: (node: ts.Node) => void = (node: ts.Node): void => {
    reads.push({
      file: file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // state.flag / state?.flag
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === flag &&
      !isAssignmentTarget(node) &&
      !isHandedOn(flag, node)
    ) {
      record(node);
    }

    // state["flag"]
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === flag &&
      !isAssignmentTarget(node) &&
      !isHandedOn(flag, node)
    ) {
      record(node);
    }

    // const { flag } = state;
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      (node.propertyName
        ? nameOf(node.propertyName as ts.PropertyName) === flag
        : ts.isIdentifier(node.name) && node.name.text === flag)
    ) {
      record(node);
    }

    /*
     * query: { currentIncidentState: { flag: false } } - and `flag: false`
     * anywhere but a select, which only ever asks for records by the flag
     * (a query built in a helper and returned, say).
     */
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      nameOf(node.name) === flag
    ) {
      const context: "query" | "select" | null = contextOf(source, node);

      if (
        context === "query" ||
        (context !== "select" &&
          ts.isPropertyAssignment(node) &&
          node.initializer.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        record(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return reads;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
        continue;
      }

      if (
        SOURCE_FILE.test(entry.name) &&
        !TEST_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(path.join(current, entry.name));
      }
    }
  };

  walk(directory);

  return files;
}

// Every read of `flag` in the readers' directories, by path from the root.
export function scanStateFlagReads(flag: string): Array<FlagRead> {
  const reads: Array<FlagRead> = [];

  for (const relativeDirectory of SCANNED_DIRECTORIES) {
    const directory: string = path.join(REPOSITORY_ROOT, relativeDirectory);

    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const file of listSourceFiles(directory)) {
      reads.push(
        ...findStateFlagReads(
          flag,
          path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
          fs.readFileSync(file, "utf8"),
        ),
      );
    }
  }

  return reads;
}

/*
 * Where two states' places are compared to decide something: a `<`, `<=`,
 * `>` or `>=` with a state's `order` on either side (`a.order`, `a?.order`,
 * `a!.order`, `a["order"]`) - "is it past Ended", "has it moved on". For the
 * guard that keeps where a scheduled maintenance event is in its life in
 * one helper (OneMaintenancePhaseRuleGuard). Sorting a list by place
 * (`a.order - b.order`) is no comparison; nor is assigning a place.
 */
const ORDER_COMPARISON_OPERATORS: Set<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

// `x.order`, `x?.order`, `x!.order`, `(x.order)`, `x["order"]`.
function isOrderOperand(node: ts.Expression): boolean {
  let current: ts.Expression = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }

  if (ts.isPropertyAccessExpression(current)) {
    return current.name.text === "order";
  }

  return (
    ts.isElementAccessExpression(current) &&
    ts.isStringLiteralLike(current.argumentExpression) &&
    current.argumentExpression.text === "order"
  );
}

// Every comparison of a state's place in one source file's text.
export function findStateOrderComparisons(
  file: string,
  text: string,
): Array<FlagRead> {
  if (!text.includes("order")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const comparisons: Array<FlagRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      ORDER_COMPARISON_OPERATORS.has(node.operatorToken.kind) &&
      (isOrderOperand(node.left) || isOrderOperand(node.right))
    ) {
      comparisons.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return comparisons;
}

/*
 * Every comparison of a state's place in the readers' directories, by path
 * from the root - in the files whose text matches `mentions` (the states of
 * one kind, say).
 */
export function scanStateOrderComparisons(mentions: RegExp): Array<FlagRead> {
  const comparisons: Array<FlagRead> = [];

  for (const relativeDirectory of SCANNED_DIRECTORIES) {
    const directory: string = path.join(REPOSITORY_ROOT, relativeDirectory);

    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const file of listSourceFiles(directory)) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!mentions.test(text)) {
        continue;
      }

      comparisons.push(
        ...findStateOrderComparisons(
          path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
          text,
        ),
      );
    }
  }

  return comparisons;
}
