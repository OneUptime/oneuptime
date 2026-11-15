import ts from "typescript";

/*
 * THE DASHES A PAGE WRITES BY HAND FOR A VALUE THAT IS NOT THERE, READ
 * THROUGH THE TYPESCRIPT AST (#7603, #8209).
 *
 * An empty value is the quiet dash: `TableEmptyValue` in a table's cell,
 * `Detail/EmptyValue` on a card - light grey, on the value's line, read out
 * as "Not set". Pages drew some six hundred of their own instead: a hyphen
 * or an em dash in an element of the page's (`<span className="text-gray-
 * 400">-</span>`), or as the fallback of a value (`{team.name || "-"}`). A
 * class of its own kept such a dash out of TableRow's reading of a bare one
 * (isDashPlaceholder), so a row drew it darker or wider than the quiet dash
 * in the next cell, a screen reader heard "dash" or nothing, and a phone's
 * card showed "Team: -" where it leaves every other empty field out.
 *
 * What the scan finds - each is a mark for "nothing here", drawn as words:
 *
 *   - dash-element: an element or fragment whose only content is a dash
 *     (`-`, `–`, `—`, as text or as a string: `<p>-</p>`, `<>{"—"}</>`),
 *     with or without classes, returned or drawn as a value;
 *   - dash-fallback: a dash as the fallback of a value drawn as an element's
 *     child - `{name || "-"}`, `{count ?? "—"}`, `{seen ? when : "—"}`,
 *     `{String(host ?? "—")}`;
 *   - dash-words: a dash handed to a component as its words for an empty
 *     value - `emptyText="-"`, `groupFallbackLabel="—"`;
 *   - dash-value: a dash handed to a component that draws a value - a
 *     monitor summary's `<SummaryFact value={probe || "-"} />`, a
 *     `<Pill text="—" />`. A fact draws the quiet dash itself for a value
 *     that is not there.
 *
 * What it leaves alone, because a dash there is not an empty value:
 *
 *   - a dash between two values, among an element's other content - a
 *     range (`{from}<span>–</span>{to}`) or a separator (`A <span>-</span>
 *     B`) - or drawn on a condition with nothing otherwise
 *     (`{i > 0 && <span>—</span>}`, `{isLast ? <></> : <span>—</span>}`);
 *   - a mark hidden from a screen reader (`aria-hidden`): a page's own
 *     punctuation between words;
 *   - a sign: a ternary between two literals (`{d < 0 ? "-" : "+"}`), and a
 *     minus written into a number's words (`"-" + amount`, `-1`);
 *   - code and the like (`<code>`, `<kbd>`, `<pre>`, `<samp>`), a select's
 *     `<option>`, and SVG text (`<text>`, `<tspan>`, `<title>`), which holds
 *     no element;
 *   - a figure: an element whose classes draw it from `text-lg` up, a
 *     stat tile's number, where the quiet dash would be a speck;
 *   - attributes no one reads as a value (`title`, `aria-label`, a
 *     `breakAfter`), comments, and words with a dash in them ("--", "-1",
 *     "e-mail").
 */

export type HandWrittenDashKind =
  | "dash-element"
  | "dash-fallback"
  | "dash-words"
  | "dash-value";

export interface HandWrittenDash {
  // Repository-relative, with forward slashes.
  file: string;
  line: number;
  kind: HandWrittenDashKind;
  // The code, on one line.
  text: string;
}

// A dash anywhere in a module, as written or as an escape.
const ANY_DASH: RegExp = /[-\u2013\u2014]|\\u201[34]/;

// The marks a page writes for "nothing here".
export const DASH_MARKS: ReadonlyArray<string> = ["-", "–", "—"];

// A dash there is code, a choice or SVG text: never an empty value.
const LITERAL_TAGS: ReadonlyArray<string> = [
  "code",
  "kbd",
  "pre",
  "samp",
  "option",
  "text",
  "tspan",
  "title",
];

// The cells of a table or a list: a value wherever they sit in their row.
const CELL_TAGS: ReadonlyArray<string> = ["td", "th", "dd", "dt", "li"];

// A figure's size: a tile's number, from text-lg up, at any breakpoint.
const FIGURE_CLASS: RegExp = /(^|:)text-(lg|xl|[2-9]xl)$/;

// A component's words for a value it does not have.
const EMPTY_WORDS_ATTRIBUTE: RegExp =
  /^(emptyText|emptyLabel|emptyMessage|noValueMessage|noValueText|noItemsMessage|fallbackText|fallbackLabel|groupFallbackLabel)$/;

// The components that draw a value handed to them, and the prop it is in.
export const VALUE_ATTRIBUTES: ReadonlyArray<{
  component: string;
  attribute: string;
}> = [
  { component: "SummaryFact", attribute: "value" },
  { component: "Pill", attribute: "text" },
];

type JsxTree = ts.JsxElement | ts.JsxFragment;

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// The node an expression is part of, through parentheses and casts.
function holderOf(node: ts.Node): ts.Node {
  let current: ts.Node = node.parent;

  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.parent;
  }

  return current;
}

export function isDashMark(text: string): boolean {
  return DASH_MARKS.includes(text.trim());
}

function isDashString(node: ts.Node | undefined): boolean {
  if (!node) {
    return false;
  }

  const value: ts.Node = ts.isExpression(node) ? unwrap(node) : node;

  return (
    (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) &&
    isDashMark(value.text)
  );
}

function isLiteralValue(node: ts.Expression): boolean {
  const value: ts.Expression = unwrap(node);

  return (
    ts.isStringLiteral(value) ||
    ts.isNoSubstitutionTemplateLiteral(value) ||
    ts.isNumericLiteral(value) ||
    (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand))
  );
}

// Nothing drawn: null, undefined, false, "", or an empty fragment.
function isNothing(node: ts.Expression): boolean {
  const value: ts.Expression = unwrap(node);

  if (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(value) && value.text === "undefined")
  ) {
    return true;
  }

  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text === "";
  }

  if (ts.isJsxFragment(value)) {
    return nonBlankChildren(value).length === 0;
  }

  return false;
}

function nonBlankChildren(tree: JsxTree): Array<ts.JsxChild> {
  return tree.children.filter((child: ts.JsxChild): boolean => {
    return !(ts.isJsxText(child) && child.text.trim() === "");
  });
}

function tagNameOf(tree: JsxTree | ts.JsxSelfClosingElement): string {
  if (ts.isJsxFragment(tree)) {
    return "";
  }

  return ts.isJsxElement(tree)
    ? tree.openingElement.tagName.getText()
    : tree.tagName.getText();
}

function attributesOf(
  tree: JsxTree | ts.JsxSelfClosingElement,
): Array<ts.JsxAttribute> {
  if (ts.isJsxFragment(tree)) {
    return [];
  }

  const attributes: ts.JsxAttributes = ts.isJsxElement(tree)
    ? tree.openingElement.attributes
    : tree.attributes;

  return attributes.properties.filter(ts.isJsxAttribute);
}

function attributeName(attribute: ts.JsxAttribute): string {
  return attribute.name.getText();
}

function isHiddenFromScreenReaders(tree: JsxTree): boolean {
  return attributesOf(tree).some((attribute: ts.JsxAttribute): boolean => {
    return attributeName(attribute) === "aria-hidden";
  });
}

// Whether an element's classes draw it as a figure (a tile's number).
function isFigure(tree: JsxTree): boolean {
  return attributesOf(tree).some((attribute: ts.JsxAttribute): boolean => {
    if (attributeName(attribute) !== "className" || !attribute.initializer) {
      return false;
    }

    return attribute.initializer
      .getText()
      .split(/[\s"'`{}()?:+]+/)
      .some((token: string): boolean => {
        return FIGURE_CLASS.test(token);
      });
  });
}

function isLiteralTag(tree: JsxTree): boolean {
  return LITERAL_TAGS.includes(tagNameOf(tree));
}

// An element or fragment whose only content is a dash.
export function isDashOnlyTree(node: ts.Node): node is JsxTree {
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) {
    return false;
  }

  const children: Array<ts.JsxChild> = nonBlankChildren(node);

  if (children.length !== 1) {
    return false;
  }

  const only: ts.JsxChild = children[0]!;

  if (ts.isJsxText(only)) {
    return isDashMark(only.text);
  }

  return ts.isJsxExpression(only) && isDashString(only.expression);
}

/*
 * Whether a dash-only element is a mark between values rather than a
 * value: between two other things in its parent element (`{from}<span>–
 * </span>{to}`), or drawn on a condition with nothing otherwise (`{i > 0 &&
 * <span>—</span>}`). A cell of a table or a list - `<td>—</td>` beside the
 * row's other cells - is a value wherever it sits.
 */
function isSeparator(tree: JsxTree): boolean {
  if (CELL_TAGS.includes(tagNameOf(tree))) {
    return false;
  }

  let child: ts.Node = tree;
  let holder: ts.Node = holderOf(tree);

  if (
    ts.isBinaryExpression(holder) &&
    holder.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return true;
  }

  if (ts.isConditionalExpression(holder)) {
    const isTrueBranch: boolean = unwrap(holder.whenTrue) === tree;
    const other: ts.Expression = isTrueBranch
      ? holder.whenFalse
      : holder.whenTrue;

    if (isNothing(other)) {
      return true;
    }
  }

  // Up to the element it is drawn in, through the conditions it is in.
  while (
    ts.isConditionalExpression(holder) ||
    ts.isBinaryExpression(holder) ||
    (ts.isJsxExpression(holder) && !ts.isJsxAttribute(holder.parent))
  ) {
    child = holder;
    holder = holderOf(holder);
  }

  if (!ts.isJsxElement(holder) && !ts.isJsxFragment(holder)) {
    return false;
  }

  const siblings: Array<ts.JsxChild> = nonBlankChildren(holder);
  const at: number = siblings.indexOf(child as ts.JsxChild);

  return at > 0 && at < siblings.length - 1;
}

/*
 * The dash a value falls back to, when the value is one: `a || "-"`,
 * `a ?? "-"`, or the branch of `c ? a : "-"` whose other branch is a value
 * (between two literals it is a sign: `d < 0 ? "-" : "+"`). Through
 * `String(...)`: `String(host ?? "—")`.
 */
function dashFallbackOf(expression: ts.Expression): ts.Node | null {
  const value: ts.Expression = unwrap(expression);

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return isDashString(value.right)
      ? value.right
      : dashFallbackOf(value.right);
  }

  if (ts.isConditionalExpression(value)) {
    const dashIsTrue: boolean = isDashString(value.whenTrue);
    const dashIsFalse: boolean = isDashString(value.whenFalse);

    if (dashIsTrue || dashIsFalse) {
      const other: ts.Expression = dashIsTrue
        ? value.whenFalse
        : value.whenTrue;

      if (isLiteralValue(other)) {
        return null;
      }

      return dashIsTrue ? value.whenTrue : value.whenFalse;
    }

    return dashFallbackOf(value.whenTrue) || dashFallbackOf(value.whenFalse);
  }

  if (
    ts.isCallExpression(value) &&
    value.arguments.length === 1 &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "String"
  ) {
    return dashFallbackOf(value.arguments[0]!);
  }

  return null;
}

function oneLine(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim().slice(0, 140);
}

// Every dash a module writes by hand for a value that is not there.
export function findHandWrittenDashes(
  sourceText: string,
  file: string,
): Array<HandWrittenDash> {
  // Most modules hold no dash at all: nothing to parse.
  if (!ANY_DASH.test(sourceText)) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<HandWrittenDash> = [];

  const add: (
    node: ts.Node,
    kind: HandWrittenDashKind,
    shown: ts.Node,
  ) => void = (
    node: ts.Node,
    kind: HandWrittenDashKind,
    shown: ts.Node,
  ): void => {
    found.push({
      file: file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      kind: kind,
      text: oneLine(shown, sourceFile),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isDashOnlyTree(node)) {
      if (
        !isLiteralTag(node) &&
        !isHiddenFromScreenReaders(node) &&
        !isFigure(node) &&
        !isSeparator(node)
      ) {
        add(node, "dash-element", node);
      }

      return;
    }

    // {value || "-"}: drawn as an element's child.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const dash: ts.Node | null = dashFallbackOf(node.expression);
      const parent: JsxTree = node.parent;

      if (dash && !isLiteralTag(parent) && !isFigure(parent)) {
        add(dash, "dash-fallback", node);
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name: string = attributeName(node);
      const owner: ts.JsxOpeningLikeElement = node.parent.parent;
      const component: string = owner.tagName.getText();
      const value: ts.Node = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression || node.initializer
        : node.initializer;

      if (EMPTY_WORDS_ATTRIBUTE.test(name) && isDashString(value)) {
        add(node, "dash-words", node);
      }

      const drawsValue: boolean = VALUE_ATTRIBUTES.some(
        (entry: { component: string; attribute: string }): boolean => {
          return entry.component === component && entry.attribute === name;
        },
      );

      if (
        drawsValue &&
        (isDashString(value) ||
          (ts.isExpression(value) && dashFallbackOf(value)))
      ) {
        add(node, "dash-value", node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}
