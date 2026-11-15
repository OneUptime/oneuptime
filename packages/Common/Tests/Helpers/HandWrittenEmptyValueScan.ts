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
 *   - dash-value: a dash handed to a component that draws a value - any
 *     component's `value` (a monitor summary's `<SummaryFact value={probe
 *     || "-"} />`, a stat tile's `<GoldenMetricTile value={x === null ?
 *     "—" : fmt(x)} />`), a `<Pill text="—" />`. A fact and a tile draw
 *     the quiet dash themselves for a value that is not there (#8264);
 *   - dash-figure: a dash drawn in a figure - an element whose classes
 *     draw it from `text-lg` up, a stat tile's number - as its only
 *     content or as a value's fallback (`<span className="text-2xl
 *     text-gray-300">—</span>`, `{count === null ? "—" : count}`), and the
 *     table's quiet dash put there, a speck on a figure's line. A figure
 *     draws `<EmptyFigure />`: the quiet dash at the figure's size, read
 *     out as "Not set" (#8264);
 *   - dash-string: a dash written as a string for a value that is not
 *     there, which the JSX above never sees (#8262) - a formatter's
 *     `return "—"`, a value's fallback anywhere (`const host = r.host ||
 *     "—"`, `{ value: m ? fmt(m) : "—" }`, `${phase ?? "—"}`), a value's
 *     own prop (`{ value: "—" }`) or a name for one (`const NO_VALUE =
 *     "-"`). A component is handed nothing; plain text writes the shared
 *     mark, EMPTY_VALUE_MARK (Detail/EmptyValue), one mark for nothing
 *     where pages wrote three;
 *   - dash-flow: that mark drawn bare in an element - a call of a function
 *     that can write it (`<td>{formatBytes(n)}</td>`), the module's own or
 *     one it imports (indexDashFormatters follows `import { formatBytes }`,
 *     `import Utils from`, `import * as`), or a value of the module that
 *     falls back to it (`<span>{hostName}</span>`), or a prop of an object
 *     that can hold it (#8679): one the module builds (`{ value:
 *     formatBytes(n) }` drawn as `{row.value}`), or one a function it
 *     imports and calls builds (`getRunwayText()`'s `{ value:
 *     EMPTY_VALUE_MARK }` drawn as `{runway.value}`), read by the prop's
 *     name. An element draws it through getValueOrQuietDash
 *     (Table/TableEmptyValue), or getFigure in a figure, which draw the
 *     quiet dash for it; a branch drawn only once `isNoValue(x)` says the
 *     value has words is not read. The mark written into an
 *     element by hand is a dash like any other (dash-element, -fallback,
 *     -value, -figure).
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
 *   - an intrinsic element's `value` (`<option value="-">`, an input's),
 *     which is a choice or what was typed, not a value drawn;
 *   - attributes no one reads as a value (`title`, `aria-label`, a
 *     `breakAfter`), comments, and words with a dash in them ("--", "-1",
 *     "e-mail");
 *   - a string's own work with a dash (`.join("-")`, `.split("-")`,
 *     `=== "-"`, `slug += "-"`, an array of marks), and a dash with room
 *     around it (" – ", "- ", "\n- "): a separator, a range, a list's
 *     bullet.
 */

export type HandWrittenDashKind =
  | "dash-element"
  | "dash-fallback"
  | "dash-words"
  | "dash-value"
  | "dash-figure"
  | "dash-string"
  | "dash-flow";

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

/*
 * The components that draw a value handed to them, and the prop it is in,
 * besides any component's `value` (VALUE_ATTRIBUTE): a monitor summary's
 * fact, every stat tile (GoldenMetricTile, EventStatTile, LlmTile, ...),
 * InfoCard.
 */
export const VALUE_ATTRIBUTES: ReadonlyArray<{
  component: string;
  attribute: string;
}> = [
  { component: "Pill", attribute: "text" },
  // Text drawn as given, in a line or a cell of its own (#8262).
  { component: "IsolatedText", attribute: "text" },
  { component: "IsolatedLine", attribute: "text" },
  { component: "BreakableName", attribute: "text" },
  { component: "ExpandableText", attribute: "text" },
  { component: "ResourceListNameCell", attribute: "name" },
  { component: "DashboardWidgetLine", attribute: "text" },
  { component: "ConfirmModal", attribute: "description" },
];

// The prop a component draws as its value: any component's.
const VALUE_ATTRIBUTE: string = "value";

/*
 * The shared mark a plain-text consumer is handed for a value that is not
 * there (Detail/EmptyValue): an identifier, not a dash written out.
 */
const PLAIN_TEXT_MARK: string = "EMPTY_VALUE_MARK";

/*
 * The props of a value a dash-string may be (`{ value: "—" }`): a tile's,
 * a detail row's, a widget's meta pair.
 */
const VALUE_PROPERTY: RegExp =
  /^(value|text|fullText|label|title|name|sublabel|hint|display|displayValue|formatted)$/;

// JSX attributes no one reads as a value: a dash there is left alone.
const NON_VALUE_ATTRIBUTE: RegExp =
  /^(title|alt|placeholder|aria-[a-z-]+|data-[a-z-]+|className|key|id|breakAfter|separator|testId|dataTestId)$/;

// The table's and the card's quiet dash: a speck in a figure.
const QUIET_DASH_COMPONENTS: ReadonlyArray<string> = [
  "TableEmptyValue",
  "EmptyValue",
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

function isDashLiteral(node: ts.Node): node is ts.StringLiteralLike {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    isDashMark(node.text)
  );
}

/*
 * A dash as drawn: written out ("—"), or the shared mark a plain-text
 * consumer is handed (EMPTY_VALUE_MARK), which in an element is the same
 * bare dash with nothing for a screen reader.
 */
function isDashString(node: ts.Node | undefined): boolean {
  if (!node) {
    return false;
  }

  const value: ts.Node = ts.isExpression(node) ? unwrap(node) : node;

  return (
    isDashLiteral(value) ||
    (ts.isIdentifier(value) && value.text === PLAIN_TEXT_MARK)
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

// A component (GoldenMetricTile, ui.Tile), not an element (option, input).
const COMPONENT_NAME: RegExp = /^[A-Z]|\./;

function isComponentName(tagName: string): boolean {
  return COMPONENT_NAME.test(tagName);
}

/*
 * The figure a quiet dash is drawn in, if it is drawn in one: its element,
 * through the conditions and fallbacks it is the empty branch of -
 * `<span className="text-2xl">{count ?? <TableEmptyValue />}</span>`.
 */
function figureDrawing(node: ts.JsxSelfClosingElement): JsxTree | null {
  let holder: ts.Node = holderOf(node);

  while (
    ts.isConditionalExpression(holder) ||
    ts.isBinaryExpression(holder) ||
    (ts.isJsxExpression(holder) && !ts.isJsxAttribute(holder.parent))
  ) {
    holder = holderOf(holder);
  }

  if (
    (ts.isJsxElement(holder) || ts.isJsxFragment(holder)) &&
    isFigure(holder)
  ) {
    return holder;
  }

  return null;
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

/*
 * Where a value that falls back to a dash goes: up through the fallbacks,
 * conditions and String() it is part of.
 */
function destinationOf(node: ts.Node): { child: ts.Node; holder: ts.Node } {
  let child: ts.Node = node;
  let holder: ts.Node = holderOf(node);

  while (
    (ts.isBinaryExpression(holder) &&
      (holder.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        holder.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) ||
    (ts.isConditionalExpression(holder) && holder.condition !== child) ||
    (ts.isCallExpression(holder) &&
      ts.isIdentifier(holder.expression) &&
      holder.expression.text === "String")
  ) {
    child = holder;
    holder = holderOf(holder);
  }

  return { child: child, holder: holder };
}

// The statement, property or attribute a node is in, for the report.
function shownOf(node: ts.Node): ts.Node {
  let current: ts.Node = node;

  while (
    current.parent &&
    !ts.isStatement(current) &&
    !ts.isPropertyAssignment(current) &&
    !ts.isJsxAttribute(current)
  ) {
    current = current.parent;
  }

  return current;
}

/*
 * A dash written as a string for a value that is not there (#8262), and
 * the code to report it by, or null:
 *
 *   - returned: `return "—"`, `=> "—"`, `return x ?? "—"`;
 *   - a value's fallback, anywhere outside an element (which the JSX pass
 *     reads): `const host = r.host || "—"`, `{ value: m ? fmt(m) : "—" }`,
 *     `setModalText(text || "-")`, `${phase ?? "—"}`;
 *   - a value's own prop (`{ value: "—" }`) or a name for one
 *     (`const NO_VALUE = "-"`, `let at = "-"`).
 *
 * Not a sign (a condition between two literals), a string's own work
 * (`.join("-")`, `"-" + n`, `=== "-"`), nor a non-value attribute.
 */
function dashStringOf(literal: ts.StringLiteralLike): ts.Node | null {
  /*
   * A dash with room around it (" – ", "- ", "\n- ") is a separator or a
   * list's bullet: the mark for nothing is the dash alone.
   */
  if (literal.text !== literal.text.trim()) {
    return null;
  }

  const holder: ts.Node = holderOf(literal);
  let isFallback: boolean = false;

  if (
    ts.isBinaryExpression(holder) &&
    (holder.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      holder.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
    unwrap(holder.right) === literal
  ) {
    isFallback = true;
  } else if (
    ts.isConditionalExpression(holder) &&
    holder.condition !== literal &&
    unwrap(holder.condition) !== literal
  ) {
    const isTrueBranch: boolean = unwrap(holder.whenTrue) === literal;
    const other: ts.Expression = isTrueBranch
      ? holder.whenFalse
      : holder.whenTrue;

    if (isLiteralValue(other)) {
      return null;
    }

    isFallback = true;
  } else if (ts.isReturnStatement(holder)) {
    return holder;
  } else if (
    ts.isArrowFunction(holder) &&
    unwrap(holder.body as ts.Expression) === literal
  ) {
    return holder;
  } else if (
    ts.isPropertyAssignment(holder) &&
    unwrap(holder.initializer) === literal
  ) {
    return VALUE_PROPERTY.test(holder.name.getText()) ? holder : null;
  } else if (
    ts.isVariableDeclaration(holder) &&
    holder.initializer &&
    unwrap(holder.initializer) === literal
  ) {
    return holder;
  } else if (
    ts.isBinaryExpression(holder) &&
    holder.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    unwrap(holder.right) === literal
  ) {
    return shownOf(holder);
  } else {
    return null;
  }

  if (!isFallback) {
    return null;
  }

  const { holder: destination } = destinationOf(literal);

  if (ts.isJsxExpression(destination)) {
    const owner: ts.Node = destination.parent;

    // A child of an element, or a value attribute: the JSX pass reads it.
    if (ts.isJsxElement(owner) || ts.isJsxFragment(owner)) {
      return null;
    }

    if (ts.isJsxAttribute(owner)) {
      const name: string = attributeName(owner);
      const component: string = owner.parent.parent.tagName.getText();

      // An element's own attribute - an input's value, an option's - is no value drawn.
      if (!isComponentName(component)) {
        return null;
      }
      const isReadByJsxPass: boolean =
        EMPTY_WORDS_ATTRIBUTE.test(name) ||
        (name === VALUE_ATTRIBUTE && isComponentName(component)) ||
        VALUE_ATTRIBUTES.some(
          (entry: { component: string; attribute: string }): boolean => {
            return entry.component === component && entry.attribute === name;
          },
        );

      if (isReadByJsxPass || NON_VALUE_ATTRIBUTE.test(name)) {
        return null;
      }

      return owner;
    }
  }

  return shownOf(literal);
}

/*
 * Whether an expression a function returns can be a dash for nothing:
 * the dash itself or the shared mark, or a fallback or a branch that is
 * one - `n === null ? EMPTY_VALUE_MARK : fmt(n)`, `name || "—"`.
 */
function canBeDash(expression: ts.Expression): boolean {
  const value: ts.Expression = unwrap(expression);

  if (isDashString(value)) {
    return true;
  }

  if (ts.isConditionalExpression(value)) {
    return canBeDash(value.whenTrue) || canBeDash(value.whenFalse);
  }

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return canBeDash(value.right);
  }

  return false;
}

// Whether a function's body returns a dash for nothing (canBeDash).
function returnsDash(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) {
    return canBeDash(body);
  }

  let found: boolean = false;

  const walk: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) {
      return;
    }

    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      canBeDash(node.expression)
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, walk);
  };

  ts.forEachChild(body, walk);

  return found;
}

function functionBodyOf(
  initializer: ts.Expression | undefined,
): ts.ConciseBody | null {
  if (!initializer) {
    return null;
  }

  const value: ts.Expression = unwrap(initializer);

  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
    return value.body;
  }

  return null;
}

/*
 * The names a module gives the functions that write a dash for nothing,
 * and the values that hold one (`const host = r.host || "—"`): what it
 * calls them by, and what it exports them as ("default.formatBytes" for a
 * default-exported class's static method or object's property).
 */
interface DashNames {
  local: Set<string>;
  exported: Set<string>;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier: ts.Modifier): boolean => {
        return modifier.kind === ts.SyntaxKind.ExportKeyword;
      }),
  );
}

function dashNamesOf(sourceFile: ts.SourceFile): DashNames {
  const local: Set<string> = new Set<string>();
  const exported: Set<string> = new Set<string>();
  const classMethods: Map<string, Set<string>> = new Map<string, Set<string>>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      if (returnsDash(node.body)) {
        local.add(node.name.text);

        if (hasExportModifier(node)) {
          exported.add(node.name.text);
        }
      }
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }

        const body: ts.ConciseBody | null = functionBodyOf(
          declaration.initializer,
        );
        const isDash: boolean = body
          ? returnsDash(body)
          : Boolean(
              declaration.initializer && canBeDash(declaration.initializer),
            );

        if (isDash) {
          local.add(declaration.name.text);

          if (hasExportModifier(node)) {
            exported.add(declaration.name.text);
          }
        }
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const methods: Set<string> = new Set<string>();

      for (const member of node.members) {
        if (!member.name || !ts.isIdentifier(member.name)) {
          continue;
        }

        const body: ts.ConciseBody | null | undefined = ts.isMethodDeclaration(
          member,
        )
          ? member.body
          : ts.isPropertyDeclaration(member)
            ? functionBodyOf(member.initializer)
            : null;

        if (body && returnsDash(body)) {
          methods.add(member.name.text);
        }
      }

      classMethods.set(node.name.text, methods);

      const isDefault: boolean = Boolean(
        ts.getModifiers(node)?.some((modifier: ts.Modifier): boolean => {
          return modifier.kind === ts.SyntaxKind.DefaultKeyword;
        }),
      );

      if (isDefault) {
        for (const method of methods) {
          exported.add(`default.${method}`);
        }
      }
    }

    // export default Utils; export default { formatBytes, ... };
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const value: ts.Expression = unwrap(node.expression);

      if (ts.isIdentifier(value)) {
        for (const method of classMethods.get(value.text) || []) {
          exported.add(`default.${method}`);
        }
      }

      if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          const name: string | undefined = ts.isShorthandPropertyAssignment(
            property,
          )
            ? property.name.text
            : ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.initializer)
              ? property.initializer.text
              : undefined;
          const key: string | undefined =
            property.name && ts.isIdentifier(property.name)
              ? property.name.text
              : undefined;

          if (name && key && local.has(name)) {
            exported.add(`default.${key}`);
          }
        }
      }
    }

    // A formatter a component declares inside itself is the module's too.
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return { local: local, exported: exported };
}

/*
 * Every scanned module's exported dash writers, by the module's
 * repository-relative path: built once over the tree, so a page that
 * imports a formatter is held to what that formatter writes.
 */
export type DashFormatterIndex = Map<string, Set<string>>;

function parse(sourceText: string, file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function indexDashFormatters(
  modules: ReadonlyArray<{ file: string; sourceText: string }>,
): DashFormatterIndex {
  const index: DashFormatterIndex = new Map<string, Set<string>>();
  const parsed: Map<string, ts.SourceFile> = new Map<string, ts.SourceFile>();

  for (const module of modules) {
    if (
      !ANY_DASH.test(module.sourceText) &&
      !module.sourceText.includes(PLAIN_TEXT_MARK)
    ) {
      continue;
    }

    const sourceFile: ts.SourceFile = parse(module.sourceText, module.file);
    const names: DashNames = dashNamesOf(sourceFile);

    parsed.set(module.file, sourceFile);

    if (names.exported.size > 0) {
      index.set(module.file, names.exported);
    }
  }

  /*
   * Then the objects an exported function builds whose props can hold the
   * mark - a tile's `{ value: formatBytes(n) }`, a runway's `{ value:
   * EMPTY_VALUE_MARK }` - as "returns:<name>:<prop>", read with the dash
   * writers the module itself has and imports.
   */
  const objectProps: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const [file, sourceFile] of parsed) {
    const writers: Set<string> = new Set<string>([
      ...dashNamesOf(sourceFile).local,
      ...importedDashNames(sourceFile, file, index),
    ]);
    const returns: Set<string> = exportedObjectPropsOf(sourceFile, writers);

    if (returns.size > 0) {
      objectProps.set(file, returns);
    }
  }

  for (const [file, returns] of objectProps) {
    const names: Set<string> = index.get(file) || new Set<string>();

    for (const name of returns) {
      names.add(name);
    }

    index.set(file, names);
  }

  return index;
}

// The prefix an index entry for an object-building function carries.
const RETURNS_PREFIX: string = "returns:";

/*
 * Whether a value can be the plain-text mark: as canBeDash, or through a
 * call of a dash writer or a value of the module that falls back to it
 * (`formatBytes(n)`, `fmt(a) || fmt(b)`).
 */
function canHoldDash(expression: ts.Expression, writers: Set<string>): boolean {
  const value: ts.Expression = unwrap(expression);

  if (canBeDash(value)) {
    return true;
  }

  if (ts.isConditionalExpression(value)) {
    return (
      canHoldDash(value.whenTrue, writers) ||
      canHoldDash(value.whenFalse, writers)
    );
  }

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      canHoldDash(value.left, writers) || canHoldDash(value.right, writers)
    );
  }

  if (ts.isCallExpression(value) || ts.isIdentifier(value)) {
    const name: string | null = drawnNameOf(value);

    return name !== null && writers.has(name);
  }

  return false;
}

/*
 * The props of the objects a piece of code builds that can hold the mark:
 * `{ label: "Cluster", value: clusterName || EMPTY_VALUE_MARK }`, a
 * shorthand `{ value }` of a value that falls back to it.
 */
function dashPropsIn(node: ts.Node, writers: Set<string>): Set<string> {
  const props: Set<string> = new Set<string>();

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (
      ts.isPropertyAssignment(child) &&
      (ts.isIdentifier(child.name) || ts.isStringLiteral(child.name)) &&
      canHoldDash(child.initializer, writers)
    ) {
      props.add(child.name.text);
    }

    if (
      ts.isShorthandPropertyAssignment(child) &&
      writers.has(child.name.text)
    ) {
      props.add(child.name.text);
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return props;
}

/*
 * What a module exports that builds objects whose props can hold the mark:
 * "returns:<name>:<prop>", "returns:default.<method>:<prop>" for a
 * default-exported class's static method.
 */
function exportedObjectPropsOf(
  sourceFile: ts.SourceFile,
  writers: Set<string>,
): Set<string> {
  const entries: Set<string> = new Set<string>();

  const record: (name: string, body: ts.Node | undefined) => void = (
    name: string,
    body: ts.Node | undefined,
  ): void => {
    if (!body) {
      return;
    }

    for (const prop of dashPropsIn(body, writers)) {
      entries.add(`${RETURNS_PREFIX}${name}:${prop}`);
    }
  };

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) {
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, statement.body);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          record(
            declaration.name.text,
            functionBodyOf(declaration.initializer) || undefined,
          );
        }
      }
    }

    if (ts.isClassDeclaration(statement)) {
      const isDefault: boolean = Boolean(
        ts.getModifiers(statement)?.some((modifier: ts.Modifier): boolean => {
          return modifier.kind === ts.SyntaxKind.DefaultKeyword;
        }),
      );

      for (const member of statement.members) {
        if (
          isDefault &&
          ts.isMethodDeclaration(member) &&
          ts.isIdentifier(member.name)
        ) {
          record(`default.${member.name.text}`, member.body);
        }
      }
    }
  }

  return entries;
}

/*
 * The props of objects a module draws that can hold the mark: the ones it
 * builds itself (dashPropsIn), and the ones the functions it imports and
 * calls build (index "returns:" entries), by the name it calls them by.
 */
function drawnDashPropsOf(
  sourceFile: ts.SourceFile,
  file: string,
  writers: Set<string>,
  index: DashFormatterIndex | undefined,
): Set<string> {
  const props: Set<string> = dashPropsIn(sourceFile, writers);

  if (!index) {
    return props;
  }

  // What the module calls each object-building function it imports.
  const builders: Map<string, Set<string>> = new Map<string, Set<string>>();

  const addBuilder: (localName: string, entry: string) => void = (
    localName: string,
    entry: string,
  ): void => {
    const prop: string = entry.slice(entry.lastIndexOf(":") + 1);
    const known: Set<string> = builders.get(localName) || new Set<string>();

    known.add(prop);
    builders.set(localName, known);
  };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const resolved: string | null = resolveModule(
      file,
      statement.moduleSpecifier.text,
      index,
    );

    if (!resolved) {
      continue;
    }

    const clause: ts.ImportClause = statement.importClause;

    for (const entry of index.get(resolved)!) {
      if (!entry.startsWith(RETURNS_PREFIX)) {
        continue;
      }

      const name: string = entry.slice(
        RETURNS_PREFIX.length,
        entry.lastIndexOf(":"),
      );

      if (name.startsWith("default.")) {
        if (clause.name) {
          addBuilder(
            `${clause.name.text}.${name.slice("default.".length)}`,
            entry,
          );
        }
        continue;
      }

      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        addBuilder(`${clause.namedBindings.name.text}.${name}`, entry);
      }

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if ((element.propertyName || element.name).text === name) {
            addBuilder(element.name.text, entry);
          }
        }
      }
    }
  }

  if (builders.size === 0) {
    return props;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name: string | null = drawnNameOf(node);

      for (const prop of (name && builders.get(name)) || []) {
        props.add(prop);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return props;
}

const MODULE_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

// The repository-relative module an import names, if the index has it.
function resolveModule(
  fromFile: string,
  specifier: string,
  index: DashFormatterIndex,
): string | null {
  let base: string;

  if (specifier.startsWith(".")) {
    const parts: Array<string> = fromFile.split("/").slice(0, -1);

    for (const part of specifier.split("/")) {
      if (part === "..") {
        parts.pop();
      } else if (part !== ".") {
        parts.push(part);
      }
    }

    base = parts.join("/");
  } else if (specifier.startsWith("Common/")) {
    base = `packages/${specifier}`;
  } else {
    return null;
  }

  for (const extension of ["", ...MODULE_EXTENSIONS]) {
    if (index.has(base + extension)) {
      return base + extension;
    }
  }

  return null;
}

/*
 * What a module calls each dash writer it imports: a name it imported
 * (`formatBytes`), or a namespace's member (`StorageArrayResourceUtils.
 * formatBytes`, as "StorageArrayResourceUtils.formatBytes").
 */
function importedDashNames(
  sourceFile: ts.SourceFile,
  file: string,
  index: DashFormatterIndex,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const resolved: string | null = resolveModule(
      file,
      statement.moduleSpecifier.text,
      index,
    );

    if (!resolved) {
      continue;
    }

    const exported: Set<string> = index.get(resolved)!;
    const clause: ts.ImportClause = statement.importClause;

    if (clause.name) {
      for (const name of exported) {
        if (name.startsWith(RETURNS_PREFIX)) {
          continue;
        }

        if (name.startsWith("default.")) {
          names.add(`${clause.name.text}.${name.slice("default.".length)}`);
        }
      }
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        for (const name of exported) {
          if (
            !name.startsWith("default.") &&
            !name.startsWith(RETURNS_PREFIX)
          ) {
            names.add(`${clause.namedBindings.name.text}.${name}`);
          }
        }
      } else {
        for (const element of clause.namedBindings.elements) {
          const importedName: string = (element.propertyName || element.name)
            .text;

          if (exported.has(importedName)) {
            names.add(element.name.text);
          }
        }
      }
    }
  }

  return names;
}

// What an element's child calls or reads, as a module names it.
function drawnNameOf(expression: ts.Expression): string | null {
  const value: ts.Expression = unwrap(expression);
  const target: ts.Expression = ts.isCallExpression(value)
    ? value.expression
    : value;

  if (ts.isIdentifier(target)) {
    return target.text;
  }

  if (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression)
  ) {
    return `${target.expression.text}.${target.name.text}`;
  }

  return null;
}

/*
 * The values an element's child may draw, through its conditions and
 * fallbacks: `{a ? fmt(x) : fmt(y)}` draws two.
 */
function drawnValuesOf(expression: ts.Expression): Array<ts.Expression> {
  const value: ts.Expression = unwrap(expression);

  if (ts.isConditionalExpression(value)) {
    // A branch drawn only for a value with words is not read (noValueCheckOf).
    const guard: boolean | null = noValueCheckOf(value.condition);

    if (guard !== null) {
      return drawnValuesOf(guard ? value.whenTrue : value.whenFalse);
    }

    return [
      ...drawnValuesOf(value.whenTrue),
      ...drawnValuesOf(value.whenFalse),
    ];
  }

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [...drawnValuesOf(value.left), ...drawnValuesOf(value.right)];
  }

  return [value];
}

// The checks that a value is none: the shared ones (Common/Types/EmptyValueMark).
const NO_VALUE_CHECKS: ReadonlyArray<string> = [
  "isNoValue",
  "isEmptyFigure",
  "isDashText",
];

/*
 * Whether a condition checks that a value is none: true for `isNoValue(x)`
 * (its true branch draws the quiet dash, its false one a value with
 * words), false for `!isNoValue(x)`, null for any other condition.
 */
function noValueCheckOf(condition: ts.Expression): boolean | null {
  const value: ts.Expression = unwrap(condition);

  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner: boolean | null = noValueCheckOf(value.operand);

    return inner === null ? null : !inner;
  }

  if (
    ts.isCallExpression(value) &&
    ts.isIdentifier(value.expression) &&
    NO_VALUE_CHECKS.includes(value.expression.text)
  ) {
    return true;
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
  formatters?: DashFormatterIndex | undefined,
): Array<HandWrittenDash> {
  /*
   * A module that holds no dash, no mark and imports no formatter that
   * writes one has nothing to report: nothing to parse.
   */
  if (
    !ANY_DASH.test(sourceText) &&
    !sourceText.includes(PLAIN_TEXT_MARK) &&
    !formatters
  ) {
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
        !isSeparator(node)
      ) {
        add(node, isFigure(node) ? "dash-figure" : "dash-element", node);
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

      if (dash && !isLiteralTag(parent)) {
        add(dash, isFigure(parent) ? "dash-figure" : "dash-fallback", node);
      }
    }

    // <span className="text-2xl">{count ?? <TableEmptyValue />}</span>
    if (
      ts.isJsxSelfClosingElement(node) &&
      QUIET_DASH_COMPONENTS.includes(tagNameOf(node))
    ) {
      const figure: JsxTree | null = figureDrawing(node);

      if (figure) {
        add(node, "dash-figure", figure);
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

      const drawsValue: boolean =
        (name === VALUE_ATTRIBUTE && isComponentName(component)) ||
        VALUE_ATTRIBUTES.some(
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

  const visitStrings: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isDashLiteral(node)) {
      const shown: ts.Node | null = dashStringOf(node);

      if (shown) {
        add(node, "dash-string", shown);
      }
    }

    ts.forEachChild(node, visitStrings);
  };

  visitStrings(sourceFile);

  /*
   * A dash writer's text drawn bare in an element: `<td>{formatBytes(n)}
   * </td>`, `<span>{hostName}</span>` for `const hostName = r.host ||
   * EMPTY_VALUE_MARK`. The mark is a plain-text consumer's; an element
   * draws it through getValueOrQuietDash (or a tile's getFigure), which
   * turns it into the quiet dash.
   */
  const { local } = dashNamesOf(sourceFile);
  const drawnDashNames: Set<string> = new Set<string>([
    ...local,
    ...(formatters ? importedDashNames(sourceFile, file, formatters) : []),
  ]);
  /*
   * And a prop of an object that can hold it, drawn bare (#8679): a tile's
   * `{tile.value}` for `{ value: formatBytes(n) }`, a runway's
   * `{runway.value}` for an imported `getRunwayText()` that builds `{ value:
   * EMPTY_VALUE_MARK }`. Read by the prop's name in the module, so a prop
   * another object of the module shares is held to it too: drawing it
   * through getValueOrQuietDash costs nothing for a value that has words.
   */
  const drawnDashProps: Set<string> = drawnDashPropsOf(
    sourceFile,
    file,
    drawnDashNames,
    formatters,
  );

  if (drawnDashNames.size > 0 || drawnDashProps.size > 0) {
    const visitFlow: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
        !isLiteralTag(node.parent) &&
        !(
          ts.isJsxElement(node.parent) && isHiddenFromScreenReaders(node.parent)
        )
      ) {
        const drawsDash: boolean = drawnValuesOf(node.expression).some(
          (value: ts.Expression): boolean => {
            const name: string | null = drawnNameOf(value);

            if (name !== null && drawnDashNames.has(name)) {
              return true;
            }

            return (
              ts.isPropertyAccessExpression(value) &&
              drawnDashProps.has(value.name.text)
            );
          },
        );

        if (drawsDash) {
          add(node, "dash-flow", node);
        }
      }

      /*
       * A branch drawn only for a value that has words - the other side of
       * `isNoValue(cell.text) ? <TableEmptyValue /> : ...` - never draws
       * the mark: it is not read.
       */
      if (ts.isConditionalExpression(node)) {
        const guard: boolean | null = noValueCheckOf(node.condition);

        if (guard !== null) {
          visitFlow(node.condition);
          visitFlow(guard ? node.whenTrue : node.whenFalse);
          return;
        }
      }

      ts.forEachChild(node, visitFlow);
    };

    visitFlow(sourceFile);
  }

  return found;
}
