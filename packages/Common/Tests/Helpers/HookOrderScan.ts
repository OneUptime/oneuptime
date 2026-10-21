import ts from "typescript";

/*
 * The detector behind the hook order guard (Tests/UI/HookOrderGuard.test.ts).
 *
 * React keeps a component's hooks in a list and pairs them up by position on
 * every render, so every render of one component has to call the same hooks
 * in the same order. A hook that runs on some renders and not on others
 * shifts every hook after it: React throws "Rendered more hooks than during
 * the previous render" or "Rendered fewer hooks than expected" and unmounts
 * the tree up to the nearest error boundary - a whole table, a whole page.
 * When no hook runs before the skipped one React's mount dispatcher hides the
 * mistake, and the component quietly loses its state instead; it becomes the
 * crash as soon as someone adds a hook at the top, which is what the
 * translator hooks did to the filter components and to the table's labels
 * list (#4266, #4285, #4295).
 *
 * So the detector reports, in every function, each hook call that does not
 * run on every call of that function:
 *
 *   1. A hook after a `return` of the same function, in source order: an
 *      early return that fires skips it.
 *   2. A hook only some paths reach: inside an if or else, a loop, a switch,
 *      a catch block, either side of a ternary, or the right of && || ??
 *      (or of &&= ||= ??=).
 *
 * A hook is a call of an identifier named use + a capital letter or digit,
 * or of React.useX, which is how React itself tells a hook from a function.
 * React 19's `use` (no capital) may be called conditionally and is not one.
 * A function named like a hook that is not one is still reported: React and
 * its tooling treat it as a hook, so it is renamed rather than excused.
 *
 * Nested functions are separate: a `return` inside an effect, a callback or
 * a component defined inline is not an early return of the outer function,
 * and the nested function's own hook calls are checked against its own
 * returns. Only real syntax is read, through the TypeScript AST, so a hook
 * named in a comment or a string is not a call.
 */

export interface HookCall {
  file: string;
  line: number;
  // The function the hook is called in, as named in the source.
  functionName: string;
  // The hook as written: "useState", "React.useMemo".
  hook: string;
  /*
   * Why the call can be skipped ("after the return at line 12", "inside an
   * if"), or null when it runs on every call of its function.
   */
  conditionalBecause: string | null;
}

const HOOK_NAME: RegExp = /^use[A-Z0-9]/;

// Anywhere in a module: whether it could call a hook at all.
const MENTIONS_A_HOOK: RegExp = /\buse[A-Z0-9]/;

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

// Nodes whose insides belong to another function (or to no function).
function startsAnotherScope(node: ts.Node): boolean {
  return (
    isFunctionNode(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node)
  );
}

// The hook a call calls, as written, or null when the call is not a hook.
function hookCalledBy(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  if (!ts.isCallExpression(node)) {
    return null;
  }

  const callee: ts.Expression = node.expression;

  if (ts.isIdentifier(callee) && HOOK_NAME.test(callee.text)) {
    return callee.text;
  }

  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "React" &&
    HOOK_NAME.test(callee.name.text)
  ) {
    return callee.getText(sourceFile);
  }

  return null;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

// The name a function is known by: its own, or the variable or key holding it.
function nameOf(fn: FunctionNode): string {
  if (fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }

  let node: ts.Node = fn.parent;

  // const X = React.memo((props) => ...), const X = forwardRef(function (...) ...)
  while (ts.isCallExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.parent;
  }

  if (
    (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }

  return "(anonymous)";
}

// Operators whose right side runs only for some values of the left.
const LOGICAL_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

interface FunctionWalk {
  file: string;
  sourceFile: ts.SourceFile;
  functionName: string;
  // The line of the first `return` of this function met so far.
  firstReturnLine: number | null;
  calls: Array<HookCall>;
}

/*
 * Walks one function's body in source order. `branch` names the innermost
 * construct that only some paths go through, or is null on the straight path.
 */
function walkBody(
  node: ts.Node,
  walk: FunctionWalk,
  branch: string | null,
): void {
  if (startsAnotherScope(node)) {
    return;
  }

  const hook: string | null = hookCalledBy(node, walk.sourceFile);

  if (hook) {
    let conditionalBecause: string | null = null;

    if (walk.firstReturnLine !== null) {
      conditionalBecause = `after the return at line ${walk.firstReturnLine}`;
    } else if (branch) {
      conditionalBecause = `inside ${branch}`;
    }

    walk.calls.push({
      file: walk.file,
      line: lineOf(walk.sourceFile, node),
      functionName: walk.functionName,
      hook: hook,
      conditionalBecause: conditionalBecause,
    });
  }

  const visit: (
    child: ts.Node | undefined,
    childBranch: string | null,
  ) => void = (
    child: ts.Node | undefined,
    childBranch: string | null,
  ): void => {
    if (child) {
      walkBody(child, walk, childBranch);
    }
  };

  if (ts.isIfStatement(node)) {
    visit(node.expression, branch);
    visit(node.thenStatement, branch || "an if");
    visit(node.elseStatement, branch || "an else");
    return;
  }

  if (ts.isConditionalExpression(node)) {
    visit(node.condition, branch);
    visit(node.whenTrue, branch || "a ternary");
    visit(node.whenFalse, branch || "a ternary");
    return;
  }

  if (
    ts.isBinaryExpression(node) &&
    LOGICAL_OPERATORS.has(node.operatorToken.kind)
  ) {
    visit(node.left, branch);
    visit(
      node.right,
      branch || `the right of ${node.operatorToken.getText(walk.sourceFile)}`,
    );
    return;
  }

  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    ts.forEachChild(node, (child: ts.Node) => {
      visit(child, branch || "a loop");
    });
    return;
  }

  if (ts.isSwitchStatement(node)) {
    visit(node.expression, branch);
    visit(node.caseBlock, branch || "a switch");
    return;
  }

  if (ts.isCatchClause(node)) {
    visit(node.block, branch || "a catch block");
    return;
  }

  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, branch);
  });

  // A hook in the returned expression itself still runs; the ones after it may not.
  if (ts.isReturnStatement(node) && walk.firstReturnLine === null) {
    walk.firstReturnLine = lineOf(walk.sourceFile, node);
  }
}

/*
 * Every hook call in a module, each with why it can be skipped (or null).
 * `file` is only carried into the results.
 */
export function scanHookCalls(file: string, text: string): Array<HookCall> {
  const calls: Array<HookCall> = [];

  // Most modules call no hook at all; skip parsing those.
  if (!MENTIONS_A_HOOK.test(text)) {
    return calls;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visitModule: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isFunctionNode(node) && node.body) {
      const walk: FunctionWalk = {
        file: file,
        sourceFile: sourceFile,
        functionName: nameOf(node),
        firstReturnLine: null,
        calls: calls,
      };

      walkBody(node.body, walk, null);
    }

    ts.forEachChild(node, visitModule);
  };

  visitModule(sourceFile);

  return calls;
}

// One line per call that can be skipped, the way the guard prints them.
export function describeConditionalHookCall(call: HookCall): string {
  return `${call.file}:${call.line} ${call.functionName} calls ${call.hook} ${call.conditionalBecause}`;
}
