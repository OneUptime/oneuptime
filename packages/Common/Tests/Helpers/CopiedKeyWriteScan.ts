import ts from "typescript";

/*
 * Finds where one object's keys are copied onto another with an
 * assignment: `target[key] = value` whose key is bound by
 *
 *   for (const key of Object.keys(source))
 *   for (const [key, value] of Object.entries(source))
 *   for (const key in source)
 *   Object.keys(source).forEach((key) => ...)   (and .map, .filter, ...)
 *   Object.entries(source).forEach(([key, value]) => ...)
 *
 * and the same over `Object.keys(source).sort()` (or .filter, .slice ...),
 * or over a variable holding one (`const keys = Object.keys(source)`).
 *
 * Every object inherits "__proto__" as a setter, so an assignment drops a
 * key of that name - a string under it is ignored, an object under it
 * becomes the target's prototype - and when the source's keys are a
 * sender's (an attribute map, a log's fields, a rule's names) that is a
 * key silently lost. writeOwnValue (Common/Utils/LookupTable) writes it
 * as the target's own instead.
 *
 * Not found:
 *   - writing back into the object whose keys are walked
 *     (`for (const key of Object.keys(node)) node[key] = ...`): its own
 *     "__proto__" property is set as the property it is, never the setter;
 *   - a key written in the code (a literal, an enum member, a constant) or
 *     derived from the source's key (`${prefix}.${key}`, `cut(key)`): a
 *     different key, which the reader of that code judges on its own.
 * Syntax only, so it runs over hundreds of files in a moment.
 */

export interface CopiedKeyWrite {
  // The object written, as the code writes it ("attributes", "entry.facts").
  target: string;
  // 1-based line of the write.
  line: number;
  // The write as written, up to the end of its first line.
  code: string;
}

const WHITESPACE_REGEX: RegExp = /\s+/g;

// Array methods whose callback takes one key (or one [key, value]) at a time.
const PER_ITEM_METHODS: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "filter",
  "some",
  "every",
  "find",
  "flatMap",
]);

// Array methods that hand back some of the same keys, in some order.
const SAME_KEYS_METHODS: ReadonlySet<string> = new Set([
  "sort",
  "toSorted",
  "reverse",
  "toReversed",
  "filter",
  "slice",
]);

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function textOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(WHITESPACE_REGEX, "");
}

interface KeysCall {
  method: string;
  source: ts.Expression;
}

/*
 * `Object.keys(source)` or `Object.entries(source)`: the method and the
 * source. Also through a method that keeps some of the same keys
 * (`Object.keys(source).sort()`) and through a variable declared as one
 * (`keyLists`, by its name).
 */
function objectKeysCall(
  expression: ts.Expression,
  keyLists: ReadonlyMap<string, KeysCall>,
): KeysCall | null {
  let call: ts.Expression = unwrap(expression);

  while (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    SAME_KEYS_METHODS.has(call.expression.name.text)
  ) {
    call = unwrap(call.expression.expression);
  }

  if (ts.isIdentifier(call)) {
    return keyLists.get(call.text) || null;
  }

  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "Object" ||
    call.arguments.length !== 1
  ) {
    return null;
  }

  const method: string = call.expression.name.text;

  if (method !== "keys" && method !== "entries") {
    return null;
  }

  return { method: method, source: call.arguments[0]! };
}

// The key's name a binding gives: `key`, or the first of `[key, value]`.
function keyNameOf(
  name: ts.BindingName | undefined,
  method: string,
): string | null {
  if (!name) {
    return null;
  }

  if (method === "keys" && ts.isIdentifier(name)) {
    return name.text;
  }

  if (method === "entries" && ts.isArrayBindingPattern(name)) {
    const first: ts.ArrayBindingElement | undefined = name.elements[0];

    if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
      return first.name.text;
    }
  }

  return null;
}

// The key a loop or a per-item callback binds, and the object its keys are.
function bindingOf(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  keyLists: ReadonlyMap<string, KeysCall>,
): { key: string; source: string } | null {
  if (ts.isForInStatement(node)) {
    const list: ts.ForInitializer = node.initializer;

    if (ts.isVariableDeclarationList(list)) {
      const declaration: ts.VariableDeclaration | undefined =
        list.declarations[0];

      if (declaration && ts.isIdentifier(declaration.name)) {
        return {
          key: declaration.name.text,
          source: textOf(unwrap(node.expression), sourceFile),
        };
      }
    }

    return null;
  }

  if (ts.isForOfStatement(node)) {
    const keys: KeysCall | null = objectKeysCall(node.expression, keyLists);
    const list: ts.ForInitializer = node.initializer;

    if (!keys || !ts.isVariableDeclarationList(list)) {
      return null;
    }

    const key: string | null = keyNameOf(
      list.declarations[0]?.name,
      keys.method,
    );

    return key
      ? { key: key, source: textOf(unwrap(keys.source), sourceFile) }
      : null;
  }

  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments[0] === node &&
    ts.isPropertyAccessExpression(node.parent.expression) &&
    PER_ITEM_METHODS.has(node.parent.expression.name.text)
  ) {
    const keys: KeysCall | null = objectKeysCall(
      node.parent.expression.expression,
      keyLists,
    );

    if (!keys) {
      return null;
    }

    const key: string | null = keyNameOf(node.parameters[0]?.name, keys.method);

    return key
      ? { key: key, source: textOf(unwrap(keys.source), sourceFile) }
      : null;
  }

  return null;
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

export function findCopiedKeyWrites(data: {
  fileName: string;
  text: string;
}): Array<CopiedKeyWrite> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    data.fileName,
    data.text,
    ts.ScriptTarget.Latest,
    true,
    data.fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const writes: Array<CopiedKeyWrite> = [];

  // Each variable declared as a source's keys, by its name.
  const keyLists: Map<string, KeysCall> = new Map();
  const collectKeyLists: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const keys: KeysCall | null = objectKeysCall(node.initializer, keyLists);

      if (keys) {
        keyLists.set(node.name.text, keys);
      }
    }

    ts.forEachChild(node, collectKeyLists);
  };

  collectKeyLists(sourceFile);

  // Each bound key's name, and the object (as written) whose key it is.
  const visit: (node: ts.Node, bound: ReadonlyMap<string, string>) => void = (
    node: ts.Node,
    bound: ReadonlyMap<string, string>,
  ): void => {
    let inScope: ReadonlyMap<string, string> = bound;
    const binding: { key: string; source: string } | null = bindingOf(
      node,
      sourceFile,
      keyLists,
    );

    if (binding) {
      const next: Map<string, string> = new Map(bound);
      next.set(binding.key, binding.source);
      inScope = next;
    }

    if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENTS.has(node.operatorToken.kind) &&
      ts.isElementAccessExpression(unwrap(node.left))
    ) {
      const access: ts.ElementAccessExpression = unwrap(
        node.left,
      ) as ts.ElementAccessExpression;
      const key: ts.Expression = unwrap(access.argumentExpression);
      const target: string = textOf(unwrap(access.expression), sourceFile);

      if (
        ts.isIdentifier(key) &&
        inScope.has(key.text) &&
        inScope.get(key.text) !== target
      ) {
        writes.push({
          target: target,
          line: lineOf(node, sourceFile),
          code: node
            .getText(sourceFile)
            .split("\n")[0]!
            .replace(WHITESPACE_REGEX, " ")
            .trim(),
        });
      }
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      visit(child, inScope);
    });
  };

  visit(sourceFile, new Map());

  return writes;
}
