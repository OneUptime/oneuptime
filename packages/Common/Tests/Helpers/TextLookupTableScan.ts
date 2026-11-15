import ts from "typescript";

/*
 * Finds the reads that let a plain object answer for a name it never
 * listed: a table written as an object literal (`const X: Record<string, T>
 * = { ... }`) read with a key that is not written in the code - `X[name]`,
 * or `name in X`. Every object inherits "constructor", "toString",
 * "__proto__" and the rest from Object.prototype, so such a read answers
 * them with a function (or the prototype itself) whatever the table holds.
 * A Map (Common/Utils/LookupTable's lookupTable) answers only for its own
 * keys, and so does a read guarded by hasOwnProperty / Object.hasOwn on the
 * same table, or readOwnValue.
 *
 * What counts as a table: a `const` whose value is an object literal and
 * whose declared type is keyed by any string (Record<string, T>,
 * Readonly<Record<string, T>>, Dictionary<T>, `{ [key: string]: T }`). A
 * table typed by its own keys (Record<SomeEnum, T>, or no type at all) is
 * read by keys TypeScript checks, so only a read that casts its key
 * (`X[name as SomeEnum]`) counts there - the cast is where outside text
 * gets in. A class's static property initialised the same way is a table
 * too, read as `this.X[...]` or `SomeClass.X[...]` (the Fluent ingest kept
 * its severity names so). Syntax only: no type checker, so it runs over
 * hundreds of files in a moment.
 */

export interface PlainTableRead {
  // The table read, as declared.
  table: string;
  // 1-based line of the read.
  line: number;
  // The read as written ("X[name]", "name in X").
  code: string;
}

// An enum's member is written with its enum's name first: `OcsfSeverity.High`.
const ENUM_NAME_REGEX: RegExp = /^[A-Z]/;

// A module's constant, written in the code: `SERVER_PORT_ATTRIBUTE`.
const CONSTANT_NAME_REGEX: RegExp = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

const WHITESPACE_REGEX: RegExp = /\s+/g;

interface DeclaredTable {
  // Keyed by any string: every computed read counts.
  isStringKeyed: boolean;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isStringKeyedType(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) {
    return false;
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    const name: string = typeNode.typeName.getText();
    const typeArguments: ReadonlyArray<ts.TypeNode> =
      typeNode.typeArguments || [];

    if (name === "Readonly") {
      return isStringKeyedType(typeArguments[0]);
    }

    if (name === "Dictionary") {
      return true;
    }

    if (name === "Record") {
      return typeArguments[0]?.kind === ts.SyntaxKind.StringKeyword;
    }

    return false;
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return typeNode.members.some((member: ts.TypeElement): boolean => {
      return (
        ts.isIndexSignatureDeclaration(member) &&
        member.parameters[0]?.type?.kind === ts.SyntaxKind.StringKeyword
      );
    });
  }

  return false;
}

/*
 * A key written in the code: "x", `x`, 1, an enum member (A.B), a
 * module's constant (SOME_ATTRIBUTE).
 */
function isWrittenKey(key: ts.Expression): boolean {
  const unwrapped: ts.Expression = unwrap(key);

  return (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
    ts.isNumericLiteral(unwrapped) ||
    (ts.isIdentifier(unwrapped) && CONSTANT_NAME_REGEX.test(unwrapped.text)) ||
    (ts.isPropertyAccessExpression(unwrapped) &&
      ts.isIdentifier(unwrapped.expression) &&
      ENUM_NAME_REGEX.test(unwrapped.expression.text))
  );
}

function hasCast(key: ts.Expression): boolean {
  let current: ts.Expression = key;

  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return ts.isAsExpression(current) || ts.isTypeAssertionExpression(current);
}

function isNonEmptyObjectLiteral(
  initializer: ts.Expression | undefined,
): boolean {
  return Boolean(
    initializer &&
      ts.isObjectLiteralExpression(unwrap(initializer)) &&
      (unwrap(initializer) as ts.ObjectLiteralExpression).properties.length > 0,
  );
}

interface DeclaredTables {
  // `const X = { ... }`, read as X[...].
  constants: Map<string, DeclaredTable>;
  // `static X = { ... }` in a class, read as this.X[...] or SomeClass.X[...].
  statics: Map<string, DeclaredTable>;
}

function collectTables(sourceFile: ts.SourceFile): DeclaredTables {
  const tables: DeclaredTables = {
    constants: new Map(),
    statics: new Map(),
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      isNonEmptyObjectLiteral(node.initializer)
    ) {
      tables.constants.set(node.name.text, {
        isStringKeyed: isStringKeyedType(node.type),
      });
    }

    if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) !== 0 &&
      isNonEmptyObjectLiteral(node.initializer)
    ) {
      tables.statics.set(node.name.text, {
        isStringKeyed: isStringKeyedType(node.type),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return tables;
}

/*
 * The table an expression names, as the code writes it ("X",
 * "this.X", "SomeClass.X"), or null when it names none.
 */
function tableNamed(
  expression: ts.Expression,
  tables: DeclaredTables,
  sourceFile: ts.SourceFile,
): { table: string; text: string; declared: DeclaredTable } | null {
  if (ts.isIdentifier(expression) && tables.constants.has(expression.text)) {
    return {
      table: expression.text,
      text: expression.text,
      declared: tables.constants.get(expression.text)!,
    };
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.name) &&
    tables.statics.has(expression.name.text) &&
    (expression.expression.kind === ts.SyntaxKind.ThisKeyword ||
      ts.isIdentifier(expression.expression))
  ) {
    return {
      table: expression.name.text,
      text: expression.getText(sourceFile).replace(WHITESPACE_REGEX, ""),
      declared: tables.statics.get(expression.name.text)!,
    };
  }

  return null;
}

/*
 * Whether an enclosing condition checks the table's own keys before the
 * read: `Object.prototype.hasOwnProperty.call(X, key) ? X[key] : ...`,
 * `if (Object.hasOwn(X, key)) { ... X[key] ... }`, `... && X[key]`.
 */
function isGuardedByOwnKeyCheck(
  read: ts.Node,
  table: string,
  sourceFile: ts.SourceFile,
): boolean {
  const checks: Array<string> = [
    `hasOwnProperty.call(${table},`,
    `Object.hasOwn(${table},`,
    `${table}.hasOwnProperty(`,
  ];
  const mentionsCheck: (node: ts.Node) => boolean = (
    node: ts.Node,
  ): boolean => {
    const text: string = node.getText(sourceFile).replace(WHITESPACE_REGEX, "");

    return checks.some((check: string): boolean => {
      return text.includes(check.replace(WHITESPACE_REGEX, ""));
    });
  };

  let child: ts.Node = read;
  let parent: ts.Node | undefined = read.parent;

  while (parent && !ts.isSourceFile(parent)) {
    if (
      ts.isConditionalExpression(parent) &&
      parent.whenTrue === child &&
      mentionsCheck(parent.condition)
    ) {
      return true;
    }

    if (
      ts.isIfStatement(parent) &&
      parent.thenStatement === child &&
      mentionsCheck(parent.expression)
    ) {
      return true;
    }

    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      mentionsCheck(parent.left)
    ) {
      return true;
    }

    child = parent;
    parent = parent.parent;
  }

  return false;
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

export function findPlainTableReads(data: {
  fileName: string;
  text: string;
}): Array<PlainTableRead> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.fileName,
    data.text,
    ts.ScriptTarget.Latest,
    true,
    data.fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tables: DeclaredTables = collectTables(sourceFile);
  const reads: Array<PlainTableRead> = [];

  if (tables.constants.size === 0 && tables.statics.size === 0) {
    return reads;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const accessed: {
      table: string;
      text: string;
      declared: DeclaredTable;
    } | null = ts.isElementAccessExpression(node)
      ? tableNamed(node.expression, tables, sourceFile)
      : null;

    if (accessed && ts.isElementAccessExpression(node)) {
      const key: ts.Expression = node.argumentExpression;
      const parent: ts.Node = node.parent;
      // A delete removes the table's own key only: it never reads what the table inherits.
      const isWrite: boolean =
        (ts.isBinaryExpression(parent) &&
          parent.left === node &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
        ts.isDeleteExpression(parent);
      const counts: boolean = accessed.declared.isStringKeyed
        ? !isWrittenKey(key)
        : hasCast(key) && !isWrittenKey(key);

      if (
        counts &&
        !isWrite &&
        !isGuardedByOwnKeyCheck(node, accessed.text, sourceFile)
      ) {
        reads.push({
          table: accessed.table,
          line: lineOf(node, sourceFile),
          code: node.getText(sourceFile).replace(WHITESPACE_REGEX, " "),
        });
      }
    }

    const checked: {
      table: string;
      text: string;
      declared: DeclaredTable;
    } | null =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword
        ? tableNamed(unwrap(node.right), tables, sourceFile)
        : null;

    if (checked && ts.isBinaryExpression(node) && !isWrittenKey(node.left)) {
      reads.push({
        table: checked.table,
        line: lineOf(node, sourceFile),
        code: node.getText(sourceFile).replace(WHITESPACE_REGEX, " "),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return reads;
}
