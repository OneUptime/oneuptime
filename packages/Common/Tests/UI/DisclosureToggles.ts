import ts from "typescript";

/*
 * The detector behind Tests/UI/DisclosureTogglesGuard.test.ts: the controls
 * that show more of something and fold it away again - "More monitor types",
 * "Show all 12", "Show less", "Hide Details" - must say whether what they
 * show is open, and must say it from the state, not as a fixed word.
 *
 * Issue #5364: Create Monitor's "More monitor types" was written with
 * aria-expanded={false} and drawn only while folded, so it vanished once
 * pressed and the rest of the catalog could not be folded again. A sweep of
 * the product found the same shape elsewhere: a header button that said its
 * project list was open while it was shut (aria-expanded="true"), and show
 * more / show less buttons that never said which way they were.
 *
 * Two readings of a frontend source file:
 *
 *   1. findFixedAriaExpanded: every aria-expanded (or Button's ariaExpanded)
 *      written as true or false rather than from the state - except on a
 *      combobox, whose list is drawn for as long as the box is, so its
 *      aria-expanded is rightly always true.
 *   2. findSilentShowMoreToggles: every button whose words switch between
 *      showing more and showing less with a condition
 *      (open ? "Show less" : "Show 12 more") and that has no aria-expanded
 *      at all.
 *
 * A label worked out away from the button (const label = ...) is not read:
 * the guard sees what the button's own attributes and children say.
 */

export interface DisclosureFinding {
  // Line and column, 1-based.
  line: number;
  column: number;
  // The element's tag name.
  tag: string;
  // What was found, for the failure message.
  detail: string;
}

const EXPANDED_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "aria-expanded",
  "ariaExpanded",
]);

// A word that folds what is shown away again, in an English label.
const FOLD_WORDS_REGEX: RegExp =
  /\b(show (less|fewer)|hide (details|empty filters|kernel threads)|fewer|less)\b/i;

// A word that shows more, in an English label.
const UNFOLD_WORDS_REGEX: RegExp =
  /\b(more|all|whole|details|everything|rest|expand)\b/i;

// The same, in a constant's or a property's name (SHOW_LESS, showFewer).
const FOLD_NAME_REGEX: RegExp = /(LESS|FEWER|COLLAPSE|Less|Fewer|Collapse)/;
const UNFOLD_NAME_REGEX: RegExp =
  /(MORE|ALL|WHOLE|EXPAND|More|All|Whole|Expand)/;

const WHITESPACE_REGEX: RegExp = /\s+/g;

function getTagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  return node.tagName.getText();
}

function getAttribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  names: ReadonlySet<string>,
): ts.JsxAttribute | undefined {
  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property) && names.has(property.name.getText())) {
      return property;
    }
  }

  return undefined;
}

function getPlainAttributeValue(
  attribute: ts.JsxAttribute | undefined,
): string | undefined {
  if (!attribute || !attribute.initializer) {
    return undefined;
  }

  let initializer: ts.Node = attribute.initializer;

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    initializer = initializer.expression;
  }

  if (
    ts.isStringLiteral(initializer) ||
    ts.isNoSubstitutionTemplateLiteral(initializer)
  ) {
    return initializer.text;
  }

  return undefined;
}

/*
 * Whether an aria-expanded attribute is written as a fixed value: true,
 * false, "true", "false", or the bare attribute (which JSX reads as true).
 */
export function isFixedExpandedValue(attribute: ts.JsxAttribute): boolean {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return true;
  }

  if (ts.isStringLiteral(initializer)) {
    return true;
  }

  if (ts.isJsxExpression(initializer)) {
    const expression: ts.Expression | undefined = initializer.expression;

    if (!expression) {
      return true;
    }

    return (
      expression.kind === ts.SyntaxKind.TrueKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword ||
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    );
  }

  return false;
}

function position(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );

  return { line: line + 1, column: character + 1 };
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function findFixedAriaExpanded(
  fileName: string,
  source: string,
): Array<DisclosureFinding> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const findings: Array<DisclosureFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const expanded: ts.JsxAttribute | undefined = getAttribute(
        node,
        EXPANDED_ATTRIBUTES,
      );
      const role: string | undefined = getPlainAttributeValue(
        getAttribute(node, new Set<string>(["role"])),
      );

      if (expanded && isFixedExpandedValue(expanded) && role !== "combobox") {
        findings.push({
          ...position(sourceFile, expanded),
          tag: getTagName(node),
          detail: expanded.getText(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}

// Every piece of wording a label expression holds: its texts and its names.
function collectWording(node: ts.Node): {
  texts: Array<string>;
  names: Array<string>;
} {
  const texts: Array<string> = [];
  const names: Array<string> = [];

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    /*
     * An icon's name is not wording: IconProp.Expand / IconProp.Collapse
     * draw a full-screen or a focus toggle as often as a fold.
     */
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === "IconProp"
    ) {
      return;
    }

    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child) ||
      ts.isJsxText(child)
    ) {
      texts.push(child.text);
    } else if (ts.isTemplateExpression(child)) {
      texts.push(child.head.text);

      for (const span of child.templateSpans) {
        texts.push(span.literal.text);
      }
    } else if (ts.isIdentifier(child)) {
      names.push(child.text);
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return { texts, names };
}

function saysFold(wording: { texts: Array<string>; names: Array<string> }): {
  folds: boolean;
  unfolds: boolean;
} {
  const folds: boolean =
    wording.texts.some((text: string): boolean => {
      return FOLD_WORDS_REGEX.test(text);
    }) ||
    wording.names.some((name: string): boolean => {
      return FOLD_NAME_REGEX.test(name);
    });

  const unfolds: boolean =
    wording.texts.some((text: string): boolean => {
      return UNFOLD_WORDS_REGEX.test(text);
    }) ||
    wording.names.some((name: string): boolean => {
      return UNFOLD_NAME_REGEX.test(name);
    });

  return { folds, unfolds };
}

/*
 * Whether a condition picks between a show-less label and a show-more one:
 * one branch folds and the other unfolds.
 */
export function isShowMoreLabel(node: ts.ConditionalExpression): boolean {
  const whenTrue: { folds: boolean; unfolds: boolean } = saysFold(
    collectWording(node.whenTrue),
  );
  const whenFalse: { folds: boolean; unfolds: boolean } = saysFold(
    collectWording(node.whenFalse),
  );

  return (
    (whenTrue.folds && !whenFalse.folds && whenFalse.unfolds) ||
    (whenFalse.folds && !whenTrue.folds && whenTrue.unfolds)
  );
}

function hasAttribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): boolean {
  return Boolean(getAttribute(node, new Set<string>([name])));
}

/*
 * The button a label belongs to: the nearest element up from it that is a
 * button (the DOM's or Common's Button) or that is clicked. Stops at a
 * function, so a label in a callback is not pinned on the element the
 * callback is passed to.
 */
function findOwningControl(
  node: ts.Node,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current)
    ) {
      return undefined;
    }

    const element: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined =
      ts.isJsxElement(current)
        ? current.openingElement
        : ts.isJsxSelfClosingElement(current)
          ? current
          : ts.isJsxOpeningElement(current)
            ? current
            : undefined;

    if (element) {
      const tag: string = getTagName(element);

      if (
        tag === "button" ||
        tag === "Button" ||
        hasAttribute(element, "onClick")
      ) {
        return element;
      }
    }

    current = current.parent;
  }

  return undefined;
}

export function findSilentShowMoreToggles(
  fileName: string,
  source: string,
): Array<DisclosureFinding> {
  const sourceFile: ts.SourceFile = parse(fileName, source);
  const findings: Array<DisclosureFinding> = [];
  const seen: Set<ts.Node> = new Set<ts.Node>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node) && isShowMoreLabel(node)) {
      const control:
        | ts.JsxOpeningElement
        | ts.JsxSelfClosingElement
        | undefined = findOwningControl(node);

      if (
        control &&
        !seen.has(control) &&
        !getAttribute(control, EXPANDED_ATTRIBUTES)
      ) {
        seen.add(control);
        findings.push({
          ...position(sourceFile, control),
          tag: getTagName(control),
          detail: node
            .getText(sourceFile)
            .replace(WHITESPACE_REGEX, " ")
            .slice(0, 160),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}
