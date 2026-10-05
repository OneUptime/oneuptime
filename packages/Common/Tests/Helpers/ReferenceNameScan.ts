import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detectors behind the reference-name guards: ReferenceNamesReadTogether
 * and HookReferenceWritesUseStamp (Common/Tests/Server), and their ee twin
 * (ee/Tests/Server/ReferenceNamesInServerCode), which runs them over
 * ee/Server - the Common test job runs without ee/.
 *
 * A record's single reference has two names a write can use: the relation
 * (`monitor`, which the dashboard's forms post) and its ID column
 * (`monitorId`, which the API reference, Terraform and server code use).
 * They are one database column, and when a write carries both TypeORM
 * stores the relation's id (RelationNamePrecedence.test.ts). DatabaseService
 * refuses a write made in a project whose two names disagree, before any
 * hook runs (RelationNames.assertNamesAgree). So server code that checks or
 * decides on a reference of a write:
 *
 *   - reads both names, through RelationIdUtil.readConsistent - never one
 *     name with the other as a fallback (findSingleNameReads), and never
 *     one name alone, which misses a write that sends only the other
 *     (findOneNameReads);
 *   - writes a value it decides with RelationIdUtil.stamp, which leaves no
 *     other name to be stored in its place (findReferenceWrites).
 *
 * Only real syntax is read, through the TypeScript AST, so a name in a
 * comment or a string is not a read.
 */

export interface ScanFinding {
  file: string;
  line: number;
  text: string;
}

// A reference's two names: its ID column first, then the relation.
export interface ReferenceNamePair {
  idColumn: string;
  relation: string;
}

// Every .ts file under `directory`, node_modules and build output left out.
export function listTypeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "build") {
        files.push(...listTypeScriptFiles(fullPath));
      }

      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

// Parentheses, `as` casts and non-null assertions do not change what is read.
export function unwrap(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;

  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
      continue;
    }

    return current;
  }
}

function compactText(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/g, "");
}

function findingAt(
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
): ScanFinding {
  return {
    file: fileName,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
  };
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
 * ---------------------------------------------------------------------------
 * One name with the other as a fallback.
 * ---------------------------------------------------------------------------
 */

/*
 * The expressions a hook reads a write's payload through, in the first-wins
 * scan. A read off any other object - a row read back, a function argument -
 * is not a write's.
 */
const FIRST_WINS_PAYLOAD_ROOTS: Array<string> = [
  "createBy.data",
  "updateBy.data",
  "onCreate.createBy.data",
  "onUpdate.updateBy.data",
];

interface MemberRead {
  // The object read from, as written: "createBy.data".
  object: string;
  // The property read: "monitorId", or "monitor" for `monitor?.id`.
  name: string;
}

// `x.toString()`, `x?.toString()`: the same value as `x`, as text.
function withoutToString(node: ts.Expression): ts.Expression {
  const expression: ts.Expression = unwrap(node);

  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length === 0 &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "toString"
  ) {
    return unwrap(expression.expression.expression);
  }

  return expression;
}

/*
 * `a.b`, `a?.b`, `a["b"]`, a relation read through its id (`a.b?.id`,
 * `a.b._id`) as the relation itself, and any of these as text
 * (`a.b?.toString()`).
 */
function readMember(
  node: ts.Expression,
  source: ts.SourceFile,
): MemberRead | null {
  const expression: ts.Expression = withoutToString(node);

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

/*
 * A call of one argument - `resolveReferenceId(x)`, `toObjectID(x)` - and
 * what it is given; null for anything else.
 */
interface WrappedRead {
  callee: string;
  argument: ts.Expression;
}

function wrappedRead(
  node: ts.Expression,
  source: ts.SourceFile,
): WrappedRead | null {
  const expression: ts.Expression = unwrap(node);

  if (ts.isCallExpression(expression) && expression.arguments.length === 1) {
    return {
      callee: compactText(expression.expression, source),
      argument: expression.arguments[0]!,
    };
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
 * names first-wins: one name, or the other when the first holds nothing.
 * Each of these reads the first name that holds an id, so a write naming
 * one record under one name and another record under the other has the
 * first checked and the second stored:
 *
 *   resolveReferenceId(data.monitorId) || resolveReferenceId(data.monitor)
 *   toObjectID(data.monitorId) || toObjectID(data.monitor)
 *   resolveReferenceId(data.monitorId || data.monitor)
 *   createBy.data.monitorId || createBy.data.monitor?.id
 *   createBy.data.domainId?.toString() || createBy.data.domain?._id
 *   RelationIdUtil.read(data, ["monitorId", "monitor"])
 *
 * A read off a stored row (`incident.createdByUserId ||
 * incident.createdByUser?.id`) is not a write's and is left alone.
 */
export function findSingleNameReads(
  fileName: string,
  text: string,
): Array<ScanFinding> {
  const source: ts.SourceFile = parse(fileName, text);
  const constants: Map<string, Array<string>> = arrayConstants(source);
  const found: Array<ScanFinding> = [];

  // A fallback already reported as the argument of a call.
  const reportedFallbacks: Set<ts.Node> = new Set();

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    found.push(findingAt(fileName, source, node));
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isFallback(node) && !reportedFallbacks.has(node)) {
      const left: WrappedRead | null = wrappedRead(node.left, source);
      const right: WrappedRead | null = wrappedRead(node.right, source);

      // f(a.xId) || f(a.x), for any f of one argument.
      if (left && right && left.callee === right.callee) {
        const first: MemberRead | null = readMember(left.argument, source);
        const second: MemberRead | null = readMember(right.argument, source);

        if (
          first &&
          second &&
          first.object === second.object &&
          areTwoNamesOfOneReference(first.name, second.name)
        ) {
          report(node);
          reportedFallbacks.add(node);
        }
      }

      // createBy.data.xId || createBy.data.x?.id
      const first: MemberRead | null = readMember(node.left, source);
      const second: MemberRead | null = readMember(node.right, source);

      if (
        !reportedFallbacks.has(node) &&
        first &&
        second &&
        first.object === second.object &&
        FIRST_WINS_PAYLOAD_ROOTS.includes(first.object) &&
        areTwoNamesOfOneReference(first.name, second.name)
      ) {
        report(node);
      }
    }

    if (ts.isCallExpression(node)) {
      // resolveReferenceId(a.xId || a.x)
      const argument: ts.Expression | null =
        node.arguments.length === 1 &&
        RESOLVE_REFERENCE_ID_CALLEE.test(compactText(node.expression, source))
          ? node.arguments[0]!
          : null;

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
        FIRST_WINS_READ_CALLEE.test(compactText(node.expression, source)) &&
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

/*
 * ---------------------------------------------------------------------------
 * Where a write's payload is.
 * ---------------------------------------------------------------------------
 */

// The expressions a create or update payload is reached through, anywhere.
const PAYLOAD_ROOTS: Array<string> = [
  "createBy.data",
  "updateBy.data",
  "onCreate.createBy.data",
  "onUpdate.updateBy.data",
];

/*
 * The payload a parameter of a hook carries, by its type - `data:
 * CreateBy<Model>` is reached as `data.data` - or null.
 */
function payloadOfParameter(
  parameter: ts.ParameterDeclaration,
  source: ts.SourceFile,
): string | null {
  if (!ts.isIdentifier(parameter.name)) {
    return null;
  }

  const name: string = parameter.name.text;
  const type: string = parameter.type ? compactText(parameter.type, source) : "";

  if (/^(CreateBy|UpdateBy)</.test(type)) {
    return `${name}.data`;
  }

  if (/^OnCreate</.test(type)) {
    return `${name}.createBy.data`;
  }

  if (/^OnUpdate</.test(type)) {
    return `${name}.updateBy.data`;
  }

  return null;
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/*
 * A function's own name for a group of reads: a method, a function
 * declaration, or a function held in a named const or property. Nested
 * callbacks belong to the function they are written in.
 */
function isNamedFunction(node: ts.Node): boolean {
  if (
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return true;
  }

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent: ts.Node = node.parent;

    return (
      (ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertyAssignment(parent)) &&
      parent.initializer === node &&
      !isInsideFunction(parent)
    );
  }

  return false;
}

function isInsideFunction(node: ts.Node): boolean {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (isFunctionLike(current)) {
      return true;
    }
  }

  return false;
}

function functionName(node: ts.Node, source: ts.SourceFile): string {
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText(source);
  }

  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }

  const parent: ts.Node | undefined = node.parent;

  if (
    parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent))
  ) {
    return parent.name.getText(source);
  }

  return "(module)";
}

/*
 * The payload expressions each function sees: the roots every function
 * sees, its own hook parameters (and those of the functions it is written
 * in), and the names it gives a payload (`const data = createBy.data as
 * ...`, and aliases of those).
 */
function payloadRootsByFunction(
  source: ts.SourceFile,
): Map<ts.Node, Set<string>> {
  const rootsByFunction: Map<ts.Node, Set<string>> = new Map();

  const visit: (node: ts.Node, inherited: Set<string>) => void = (
    node: ts.Node,
    inherited: Set<string>,
  ): void => {
    let roots: Set<string> = inherited;

    if (isFunctionLike(node)) {
      roots = new Set(inherited);

      for (const parameter of node.parameters) {
        const payload: string | null = payloadOfParameter(parameter, source);

        if (payload) {
          roots.add(payload);
        }
      }

      // Aliases declared in this function, until no new one turns up.
      for (let added: boolean = true; added; ) {
        added = false;

        const collect: (child: ts.Node) => void = (child: ts.Node): void => {
          if (isFunctionLike(child)) {
            return;
          }

          if (
            ts.isVariableDeclaration(child) &&
            ts.isIdentifier(child.name) &&
            child.initializer &&
            !roots.has(child.name.text) &&
            roots.has(compactText(unwrap(child.initializer), source))
          ) {
            roots.add(child.name.text);
            added = true;
          }

          ts.forEachChild(child, collect);
        };

        if (node.body) {
          ts.forEachChild(node.body, collect);
        }
      }

      rootsByFunction.set(node, roots);
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      visit(child, roots);
    });
  };

  visit(source, new Set(PAYLOAD_ROOTS));

  return rootsByFunction;
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (isFunctionLike(current)) {
      return current;
    }
  }

  return null;
}

function enclosingNamedFunction(node: ts.Node): ts.Node | null {
  for (
    let current: ts.Node | undefined = node.parent;
    current;
    current = current.parent
  ) {
    if (isFunctionLike(current) && isNamedFunction(current)) {
      return current;
    }
  }

  return enclosingFunction(node);
}

/*
 * ---------------------------------------------------------------------------
 * One name alone.
 * ---------------------------------------------------------------------------
 */

export interface OneNameRead extends ScanFinding {
  // The function the read is in, as named in the source.
  functionName: string;
  // The name read ("statusPageId") and the one it leaves out ("statusPage").
  name: string;
  otherName: string;
}

// The calls that leave a reference's id in its ID column for what follows.
const FILLS_ID_COLUMN_CALLEE: RegExp =
  /(^|\.)RelationIdUtil\.(readIntoIdColumn|stamp)$/;

// A statement that never completes normally: a throw, or a block ending in one.
function alwaysThrows(statement: ts.Statement): boolean {
  if (ts.isThrowStatement(statement)) {
    return true;
  }

  if (ts.isBlock(statement)) {
    const last: ts.Statement | undefined =
      statement.statements[statement.statements.length - 1];

    return Boolean(last && alwaysThrows(last));
  }

  return false;
}

/*
 * Whether a statement runs as part of its function's own body: a statement
 * of the body itself, or of a `try` block there whose catch (if any) throws
 * again - a throw inside it still refuses the write.
 */
function isOwnBodyStatement(statement: ts.Statement): boolean {
  const block: ts.Node = statement.parent;

  if (!ts.isBlock(block)) {
    return false;
  }

  if (block.parent && isFunctionLike(block.parent)) {
    return true;
  }

  const tryStatement: ts.Node = block.parent;

  return Boolean(
    tryStatement &&
      ts.isTryStatement(tryStatement) &&
      tryStatement.tryBlock === block &&
      (!tryStatement.catchClause ||
        alwaysThrows(tryStatement.catchClause.block)) &&
      isOwnBodyStatement(tryStatement),
  );
}

// The operands of `a || b || c`, or the expression itself.
function orOperands(node: ts.Expression): Array<ts.Expression> {
  const expression: ts.Expression = unwrap(node);

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return [...orOperands(expression.left), ...orOperands(expression.right)];
  }

  return [expression];
}

/*
 * The reads in `text` (one service's source) of one name of a reference -
 * `createBy.data.statusPageId`, `updateBy.data["parentStatusPageGroupId"]`,
 * `data.data.statusPage?._id` - in a function that never reads its other
 * name. Such a function misses every write that names the reference the
 * other way: a check it makes is skipped, a decision it takes is taken
 * without the reference, a lookup finds nothing.
 *
 * A function reads the reference under both names when it reads it through
 * RelationIdUtil.readConsistent (or getWrittenRelationReferences), which
 * reads no property this scan sees, or reads each name itself (a validator
 * handed both, `[data.userId, data.user]`). Writes and deletes are not
 * reads: findReferenceWrites holds the writes to stamp.
 *
 * Two shapes make a later read of the ID column the reference itself, and
 * the reads after them are not reported:
 *
 *   - RelationIdUtil.readIntoIdColumn (or stamp) given the payload and both
 *     names: the ID column holds the id the write names under either.
 *   - a statement of the function's own body that refuses the write when
 *     the ID column is empty - `if (!createBy.data.statusPageId) { throw
 *     ... }`: a write naming the reference only by the relation never gets
 *     past it, and DatabaseService has refused two names that disagree.
 *
 * Reads are grouped by the named function they are written in - a method,
 * a function declaration - callbacks included. The payload is what a
 * create or update hook is handed: `createBy.data`, `updateBy.data`, a
 * parameter typed CreateBy / UpdateBy / OnCreate / OnUpdate, and the names
 * a function gives it.
 */
export function findOneNameReads(
  fileName: string,
  text: string,
  references: Array<ReferenceNamePair>,
): Array<OneNameRead> {
  const source: ts.SourceFile = parse(fileName, text);
  const rootsByFunction: Map<ts.Node, Set<string>> =
    payloadRootsByFunction(source);
  const topLevelRoots: Set<string> = new Set(PAYLOAD_ROOTS);
  const constants: Map<string, Array<string>> = arrayConstants(source);

  // name -> the other name of its reference.
  const otherNameOf: Map<string, string> = new Map();
  const idColumns: Set<string> = new Set();

  for (const reference of references) {
    otherNameOf.set(reference.idColumn, reference.relation);
    otherNameOf.set(reference.relation, reference.idColumn);
    idColumns.add(reference.idColumn);
  }

  interface Read {
    node: ts.Node;
    name: string;
  }

  // Per named function, the reads it makes.
  const readsByFunction: Map<ts.Node | null, Array<Read>> = new Map();

  /*
   * Per named function, per ID column, where it starts holding the
   * reference: the end of the call that filled it, or of the statement that
   * refused a write without it - the earliest.
   */
  const settledAt: Map<ts.Node | null, Map<string, number>> = new Map();

  const settle: (scope: ts.Node | null, idColumn: string, at: number) => void =
    (scope: ts.Node | null, idColumn: string, at: number): void => {
      if (!settledAt.has(scope)) {
        settledAt.set(scope, new Map());
      }

      const settled: Map<string, number> = settledAt.get(scope)!;

      settled.set(idColumn, Math.min(settled.get(idColumn) ?? at, at));
    };

  const isPayload: (node: ts.Expression, scope: ts.Node | null) => boolean = (
    node: ts.Expression,
    scope: ts.Node | null,
  ): boolean => {
    const roots: Set<string> =
      (scope && rootsByFunction.get(scope)) || topLevelRoots;

    return roots.has(compactText(unwrap(node), source));
  };

  // The ID column `node` reads off a payload, or null.
  const idColumnRead: (node: ts.Expression) => string | null = (
    node: ts.Expression,
  ): string | null => {
    const expression: ts.Expression = unwrap(node);
    let name: string | null = null;
    let object: ts.Expression | null = null;

    if (ts.isPropertyAccessExpression(expression)) {
      name = expression.name.text;
      object = expression.expression;
    } else if (
      ts.isElementAccessExpression(expression) &&
      ts.isStringLiteralLike(expression.argumentExpression)
    ) {
      name = expression.argumentExpression.text;
      object = expression.expression;
    }

    if (
      name &&
      object &&
      idColumns.has(name) &&
      isPayload(object, enclosingFunction(expression))
    ) {
      return name;
    }

    return null;
  };

  const findSettlements: (node: ts.Node) => void = (node: ts.Node): void => {
    // RelationIdUtil.readIntoIdColumn(createBy.data, ["xId", "x"], ...)
    if (
      ts.isCallExpression(node) &&
      FILLS_ID_COLUMN_CALLEE.test(compactText(node.expression, source)) &&
      node.arguments.length >= 2 &&
      isPayload(node.arguments[0]!, enclosingFunction(node))
    ) {
      const keysArgument: ts.Expression = unwrap(node.arguments[1]!);
      const keys: Array<string> | null = ts.isIdentifier(keysArgument)
        ? constants.get(keysArgument.text) || null
        : stringEntries(keysArgument);
      const idColumn: string | undefined = keys?.[0];

      if (
        keys &&
        idColumn &&
        idColumns.has(idColumn) &&
        keys.includes(otherNameOf.get(idColumn)!)
      ) {
        settle(enclosingNamedFunction(node), idColumn, node.end);
      }
    }

    // if (!createBy.data.xId) { throw ... }, in a function's own body.
    if (
      ts.isIfStatement(node) &&
      alwaysThrows(node.thenStatement) &&
      isOwnBodyStatement(node)
    ) {
      for (const operand of orOperands(node.expression)) {
        if (
          ts.isPrefixUnaryExpression(operand) &&
          operand.operator === ts.SyntaxKind.ExclamationToken
        ) {
          const idColumn: string | null = idColumnRead(operand.operand);

          // From the check itself on: it is what refuses the write.
          if (idColumn) {
            settle(
              enclosingNamedFunction(node),
              idColumn,
              node.getStart(source),
            );
          }
        }
      }
    }

    ts.forEachChild(node, findSettlements);
  };

  findSettlements(source);

  const isSettled: (scope: ts.Node | null, read: Read) => boolean = (
    scope: ts.Node | null,
    read: Read,
  ): boolean => {
    const at: number | undefined = settledAt.get(scope)?.get(read.name);

    return at !== undefined && read.node.getStart(source) >= at;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let name: string | null = null;
    let object: ts.Expression | null = null;

    if (ts.isPropertyAccessExpression(node)) {
      name = node.name.text;
      object = node.expression;
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      name = node.argumentExpression.text;
      object = node.expression;
    }

    if (
      name &&
      object &&
      otherNameOf.has(name) &&
      isPayload(object, enclosingFunction(node))
    ) {
      // The outermost expression the property is read through.
      let outer: ts.Node = node;

      while (
        ts.isParenthesizedExpression(outer.parent) ||
        ts.isAsExpression(outer.parent) ||
        ts.isNonNullExpression(outer.parent) ||
        ts.isTypeAssertionExpression(outer.parent)
      ) {
        outer = outer.parent;
      }

      const parent: ts.Node = outer.parent;

      const isWriteTarget: boolean =
        ts.isBinaryExpression(parent) &&
        parent.left === outer &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;

      const isDeleted: boolean = ts.isDeleteExpression(parent);

      if (!isWriteTarget && !isDeleted) {
        const scope: ts.Node | null = enclosingNamedFunction(node);

        if (!readsByFunction.has(scope)) {
          readsByFunction.set(scope, []);
        }

        readsByFunction.get(scope)!.push({ node: node, name: name });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  const found: Array<OneNameRead> = [];

  for (const [scope, allReads] of readsByFunction) {
    // A read of an ID column that holds the reference by then is one.
    const reads: Array<Read> = allReads.filter((read: Read): boolean => {
      return !isSettled(scope, read);
    });

    const namesRead: Set<string> = new Set(
      reads.map((read: Read): string => {
        return read.name;
      }),
    );

    for (const read of reads) {
      const otherName: string = otherNameOf.get(read.name)!;

      if (namesRead.has(otherName)) {
        continue;
      }

      found.push({
        ...findingAt(fileName, source, read.node),
        functionName: scope ? functionName(scope, source) : "(module)",
        name: read.name,
        otherName: otherName,
      });
    }
  }

  return found.sort((first: OneNameRead, second: OneNameRead): number => {
    return first.line - second.line;
  });
}

/*
 * ---------------------------------------------------------------------------
 * A reference written by assignment.
 * ---------------------------------------------------------------------------
 */

// The expressions a hook reaches the payload of a create or update through.
const WRITE_PAYLOAD_ROOTS: Array<string> = [
  "createBy.data",
  "updateBy.data",
  "data.data",
  "data.createBy.data",
  "data.updateBy.data",
  "onCreate.createBy.data",
  "onUpdate.updateBy.data",
];

/*
 * The places in `text` (one service's source) that write one of `idColumns`
 * on a create or update payload other than with stamp: an assignment
 * (`createBy.data.monitorId = id`) or a setColumnValue. A relation sent
 * beside the ID column would be stored in place of what the hook wrote;
 * RelationIdUtil.stamp writes the ID column and removes every other name.
 */
export function findReferenceWrites(
  fileName: string,
  text: string,
  idColumns: Set<string>,
): Array<ScanFinding> {
  const source: ts.SourceFile = parse(fileName, text);
  const roots: Set<string> = new Set(WRITE_PAYLOAD_ROOTS);

  // `const data = createBy.data as ...` is the payload too, and so on down.
  const aliasesOf: (node: ts.Node) => Array<string> = (
    node: ts.Node,
  ): Array<string> => {
    const aliases: Array<string> = [];

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !roots.has(node.name.text) &&
      roots.has(compactText(unwrap(node.initializer), source))
    ) {
      aliases.push(node.name.text);
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      aliases.push(...aliasesOf(child));
    });

    return aliases;
  };

  for (
    let aliases: Array<string> = aliasesOf(source);
    aliases.length > 0;
    aliases = aliasesOf(source)
  ) {
    for (const alias of aliases) {
      roots.add(alias);
    }
  }

  const isPayload: (node: ts.Expression) => boolean = (
    node: ts.Expression,
  ): boolean => {
    return roots.has(compactText(unwrap(node), source));
  };

  // The column `target` writes on a payload, or null for anything else.
  const writtenColumn: (target: ts.Expression) => string | null = (
    target: ts.Expression,
  ): string | null => {
    const expression: ts.Expression = unwrap(target);

    if (
      ts.isPropertyAccessExpression(expression) &&
      isPayload(expression.expression)
    ) {
      return expression.name.text;
    }

    if (
      ts.isElementAccessExpression(expression) &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      isPayload(expression.expression)
    ) {
      return expression.argumentExpression.text;
    }

    return null;
  };

  const found: Array<ScanFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // createBy.data.monitorId = id
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const column: string | null = writtenColumn(node.left);

      if (column && idColumns.has(column)) {
        found.push(findingAt(fileName, source, node));
      }
    }

    // createBy.data.setColumnValue("monitorId", id)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setColumnValue" &&
      isPayload(node.expression.expression) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      idColumns.has(node.arguments[0].text)
    ) {
      found.push(findingAt(fileName, source, node));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/*
 * ---------------------------------------------------------------------------
 * Which model a service serves.
 * ---------------------------------------------------------------------------
 */

/*
 * The DatabaseModels file a service serves (`Incident`, `Workspace/X`): the
 * model it imports and extends a service of (`extends DatabaseService<Model>`
 * or any service base class of one model). Core services import models
 * relatively (`../../Models/DatabaseModels/X`), ee services through the
 * package (`Common/Models/DatabaseModels/X`). Null for anything else.
 */
export function modelFileOf(source: string): string | null {
  const imports: Map<string, string> = new Map();

  for (const match of source.matchAll(
    /import (\w+)(?:,\s*\{[^}]*\})? from "(?:(?:\.\.\/)+|Common\/)Models\/DatabaseModels\/([\w/]+)";/g,
  )) {
    imports.set(match[1]!, match[2]!);
  }

  const extended: RegExpMatchArray | null = source.match(
    /class \w+ extends \w+<(\w+)>/,
  );

  if (!extended) {
    return null;
  }

  return imports.get(extended[1]!) || null;
}
