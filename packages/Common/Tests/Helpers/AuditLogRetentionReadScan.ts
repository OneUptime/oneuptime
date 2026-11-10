import ts from "typescript";

/*
 * WHERE PRODUCT CODE READS A PROJECT'S AUDIT LOG RETENTION.
 *
 * A project's Retention (days) (Project.auditLogsRetentionInDays) decides
 * when each audit log entry is deleted. The recorder and a failing audit log
 * export once read it each their own way - the recorder clamped it to 1 to
 * 180 days, the export took any value <= 0 as 7 - so for a stored -3 the
 * recorder deleted entries after a day while the export warned as if it kept
 * them a week (#6383). Both now read it through one rule
 * (Common/Types/AuditLog/AuditLogRetention), and so must every reader that
 * comes after them.
 *
 * This finds, in a file's source, every read of the column - `x.<column>`
 * or `x["<column>"]`, not a write to it, a select or a sort - and says
 * whether a call to one of the rule's functions takes it. The guards that
 * use it (AuditLogRetentionReadsGuard in Common and in ee/) fail on a read
 * the rule does not take, unless they list it with its reason. A select
 * (`{ <column>: true }`), a type and the column's own declaration are no
 * reads.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const AUDIT_LOG_RETENTION_COLUMN: string = "auditLogsRetentionInDays";

// The rule's functions: a read inside a call to one of them is read by the rule.
export const AUDIT_LOG_RETENTION_RULE_FUNCTIONS: ReadonlyArray<string> = [
  "readAuditLogRetentionInDays",
  "getAuditLogRetentionDate",
  "getAuditLogRetentionError",
];

export interface AuditLogRetentionRead {
  // The file, as it was handed in.
  file: string;
  // Its line, from 1.
  line: number;
  // The line's text, trimmed.
  text: string;
  // The function, method or constant it sits in; "" at the top of the file.
  within: string;
  // Whether a call to one of the rule's functions takes it.
  throughRule: boolean;
}

// The name of a function-like node, or of what it is assigned to.
const nameOf: (node: ts.Node) => string | null = (
  node: ts.Node,
): string | null => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyAssignment(node)) &&
    node.name &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }

  return null;
};

/*
 * The function or method a node sits in - an arrow or function expression
 * by the constant, field or key it is assigned to, a callback by the
 * function around it - or, outside any, the constant it is part of; "" at
 * the top of the file.
 */
const withinOf: (node: ts.Node) => string = (node: ts.Node): string => {
  let constant: string = "";

  for (let parent: ts.Node | undefined = node.parent; parent; ) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent)
    ) {
      const name: string | null = nameOf(parent);

      if (name) {
        return name;
      }
    }

    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      parent.parent
    ) {
      const name: string | null = nameOf(parent.parent);

      if (name) {
        return name;
      }
    }

    if (ts.isVariableDeclaration(parent)) {
      constant = nameOf(parent) || constant;
    }

    parent = parent.parent;
  }

  return constant;
};

// The name a call is made by: f(...) or x.f(...).
const calleeName: (call: ts.CallExpression) => string = (
  call: ts.CallExpression,
): string => {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return "";
};

// Whether a call to one of the rule's functions takes the node, in its statement.
const isThroughRule: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
  let child: ts.Node = node;

  for (let parent: ts.Node | undefined = node.parent; parent; ) {
    if (
      ts.isCallExpression(parent) &&
      parent.expression !== child &&
      AUDIT_LOG_RETENTION_RULE_FUNCTIONS.includes(calleeName(parent))
    ) {
      return true;
    }

    if (ts.isStatement(parent) || ts.isFunctionLike(parent)) {
      return false;
    }

    child = parent;
    parent = parent.parent;
  }

  return false;
};

// Whether the access is written to: the target of =, ??=, ++ and the like.
const isWrittenTo: (node: ts.Expression) => boolean = (
  node: ts.Expression,
): boolean => {
  let target: ts.Node = node;

  while (
    target.parent &&
    (ts.isParenthesizedExpression(target.parent) ||
      ts.isNonNullExpression(target.parent))
  ) {
    target = target.parent;
  }

  const parent: ts.Node | undefined = target.parent;

  return Boolean(
    parent &&
      ts.isBinaryExpression(parent) &&
      parent.left === target &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken,
  );
};

// Whether a node reads the column: x.<column> or x["<column>"].
const isColumnAccess: (node: ts.Node) => node is ts.Expression = (
  node: ts.Node,
): node is ts.Expression => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === AUDIT_LOG_RETENTION_COLUMN;
  }

  if (ts.isElementAccessExpression(node)) {
    const argument: ts.Expression = node.argumentExpression;

    return (
      (ts.isStringLiteral(argument) ||
        ts.isNoSubstitutionTemplateLiteral(argument)) &&
      argument.text === AUDIT_LOG_RETENTION_COLUMN
    );
  }

  return false;
};

/*
 * Every read of the column in a file's source. `file` names the file in
 * what it finds; a .tsx file is read as TSX.
 */
export const findAuditLogRetentionReads: (
  file: string,
  text: string,
) => Array<AuditLogRetentionRead> = (
  file: string,
  text: string,
): Array<AuditLogRetentionRead> => {
  if (!text.includes(AUDIT_LOG_RETENTION_COLUMN)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Array<string> = text.split("\n");
  const reads: Array<AuditLogRetentionRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isColumnAccess(node) && !isWrittenTo(node)) {
      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      reads.push({
        file,
        line,
        text: (lines[line - 1] || "").trim(),
        within: withinOf(node),
        throughRule: isThroughRule(node),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return reads;
};
