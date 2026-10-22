import ts from "typescript";

/*
 * The detector behind the hand-built half of the card description guard
 * (Tests/UI/Components/CardDescriptionUnderTitleGuard.test.tsx).
 *
 * The maintainer, of the Runbooks list: "There's a lot of gap between the
 * title of the card and the description of the card. Can you please fix it?
 * Please do it in other places as well (if we have the same case
 * everywhere)". Card's stacked header drew a row - the title and the card's
 * buttons side by side - and the description after it; a row is as tall as
 * its tallest part, so a 38px button beside a 24px title put the
 * description a button row's height under the title. A header built by
 * hand the same way does the same.
 *
 * Read per module, through the TypeScript AST: an element whose class makes
 * it a flex row (at some width) and whose children hold a heading (h1 - h4)
 * in one child and something to press (button, a, Button, Link, MoreMenu,
 * CardMoreMenu) in another child that holds no heading - followed, as the
 * next element of its parent, by a description: a p, div or span written in
 * a description's quiet type (text-xs or text-sm, text-gray-400 to 600)
 * that a screen shows (not sr-only). A row ruled off from what follows it
 * (border-b) is a panel's header, and what follows it is the panel's body.
 *
 * Such a header keeps its description under the title when every child
 * that holds an action hangs over the heading's line rather than making
 * the row taller: that child's own class - or a Button's className, drawn
 * in the row itself - pulls its bottom edge up with a negative margin
 * (-my-*, -mb-*), as Card's actions do from md up. Better still is no such
 * row at all: the heading and the description one block, the actions
 * beside it (Card's default header), which this scan does not report.
 */

export interface TitleRowWithDescription {
  file: string;
  // The row's line.
  line: number;
  rowClassName: string;
  descriptionClassName: string;
  // Every action in the row hangs over the heading's line.
  keepsDescriptionUnderTitle: boolean;
}

const HEADING_TAGS: ReadonlyArray<string> = ["h1", "h2", "h3", "h4"];

const ACTION_TAGS: ReadonlyArray<string> = [
  "button",
  "a",
  "Button",
  "Link",
  "MoreMenu",
  "CardMoreMenu",
];

const DESCRIPTION_TAGS: ReadonlyArray<string> = ["p", "div", "span"];

const FLEX: RegExp = /(?:^|\s)(?:[\w-]+:)?flex(?:\s|$)/;

const RULED_BELOW: RegExp = /(?:^|\s)border-b(?:-[\w-]+)?(?:\s|$)/;

const QUIET_SIZE: RegExp = /(?:^|\s)text-(?:xs|sm)(?:\s|$)/;

const QUIET_COLOUR: RegExp = /(?:^|\s)text-gray-[456]00(?:\s|$)/;

const SCREEN_READER_ONLY: RegExp = /(?:^|\s)sr-only(?:\s|$)/;

const HANGS_OVER_LINE: RegExp = /(?:^|\s)(?:[\w-]+:)?-m[yb]-[\w.[\]]+(?:\s|$)/;

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) {
    return node.openingElement;
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return node;
  }

  return null;
}

/*
 * The className as written: a string, a template's literal parts (what is
 * worked out at run time is left out), or null when there is none to read.
 */
function classNameOf(element: ts.JsxOpeningLikeElement): string | null {
  for (const property of element.attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      property.name.getText() !== "className" ||
      !property.initializer
    ) {
      continue;
    }

    const initializer: ts.JsxAttributeValue = property.initializer;

    if (ts.isStringLiteral(initializer)) {
      return initializer.text;
    }

    if (ts.isJsxExpression(initializer) && initializer.expression) {
      const expression: ts.Expression = initializer.expression;

      if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      ) {
        return expression.text;
      }

      if (ts.isTemplateExpression(expression)) {
        return [
          expression.head.text,
          ...expression.templateSpans.map((span: ts.TemplateSpan): string => {
            return span.literal.text;
          }),
        ].join(" ");
      }
    }

    return null;
  }

  return null;
}

// Whether a tag of `tags` is drawn in this subtree (the node itself included).
function draws(
  node: ts.Node,
  tags: ReadonlyArray<string>,
  sourceFile: ts.SourceFile,
): boolean {
  let found: boolean = false;

  const visit: (current: ts.Node) => void = (current: ts.Node): void => {
    if (found) {
      return;
    }

    const opening: ts.JsxOpeningLikeElement | null = openingOf(current);

    if (opening && tags.includes(opening.tagName.getText(sourceFile))) {
      found = true;
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);

  return found;
}

// The first element drawn in a child: itself, or the first in an expression.
function firstElementOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  const own: ts.JsxOpeningLikeElement | null = openingOf(node);

  if (own) {
    return own;
  }

  let found: ts.JsxOpeningLikeElement | null = null;

  const visit: (current: ts.Node) => void = (current: ts.Node): void => {
    if (found) {
      return;
    }

    // A fragment (<></>) is not an element: the walk looks inside it.
    const opening: ts.JsxOpeningLikeElement | null = openingOf(current);

    if (opening) {
      found = opening;
      return;
    }

    ts.forEachChild(current, visit);
  };

  visit(node);

  return found;
}

// A JSX element's children, without the whitespace between them.
function childrenOf(node: ts.JsxElement): Array<ts.JsxChild> {
  return node.children.filter((child: ts.JsxChild): boolean => {
    return !ts.isJsxText(child) || child.text.trim().length > 0;
  });
}

function isDescription(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): boolean {
  const className: string | null = classNameOf(element);

  return (
    DESCRIPTION_TAGS.includes(element.tagName.getText(sourceFile)) &&
    className !== null &&
    QUIET_SIZE.test(className) &&
    QUIET_COLOUR.test(className) &&
    !SCREEN_READER_ONLY.test(className)
  );
}

export function scanTitleRowsWithDescriptions(
  file: string,
  source: string,
): Array<TitleRowWithDescription> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Array<TitleRowWithDescription> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const children: Array<ts.JsxChild> = childrenOf(node);

      children.forEach((row: ts.JsxChild, index: number): void => {
        if (!ts.isJsxElement(row)) {
          return;
        }

        const rowClassName: string | null = classNameOf(row.openingElement);

        if (
          !rowClassName ||
          !FLEX.test(rowClassName) ||
          RULED_BELOW.test(rowClassName)
        ) {
          return;
        }

        const parts: Array<ts.JsxChild> = childrenOf(row);
        const hasHeading: boolean = parts.some((part: ts.JsxChild): boolean => {
          return draws(part, HEADING_TAGS, sourceFile);
        });
        const actions: Array<ts.JsxChild> = parts.filter(
          (part: ts.JsxChild): boolean => {
            return (
              draws(part, ACTION_TAGS, sourceFile) &&
              !draws(part, HEADING_TAGS, sourceFile)
            );
          },
        );
        const next: ts.JsxChild | undefined = children[index + 1];
        const nextElement: ts.JsxOpeningLikeElement | null = next
          ? firstElementOf(next)
          : null;

        if (
          !hasHeading ||
          actions.length === 0 ||
          !nextElement ||
          !isDescription(nextElement, sourceFile)
        ) {
          return;
        }

        found.push({
          file: file,
          line: lineOf(sourceFile, row),
          rowClassName: rowClassName,
          descriptionClassName: classNameOf(nextElement) || "",
          keepsDescriptionUnderTitle: actions.every(
            (action: ts.JsxChild): boolean => {
              const element: ts.JsxOpeningLikeElement | null =
                firstElementOf(action);
              const className: string | null = element
                ? classNameOf(element)
                : null;

              return Boolean(className && HANGS_OVER_LINE.test(className));
            },
          ),
        });
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}
