import ts from "typescript";

/*
 * The detector behind the hand-built half of the card header guard
 * (Tests/UI/Components/CardHeaderActionsGuard.test.tsx).
 *
 * The maintainer's ask, from a details card whose Edit sat under its
 * description at the left: "Why are edit buttons not on the right? Please do
 * this everywhere there's an issue." The shared Card keeps its actions at the
 * right edge at every width. A header built by hand usually copies Card's old
 * responsive recipe instead - `flex flex-col ... sm:flex-row
 * sm:justify-between`, the title and description first, the buttons after -
 * which puts the buttons under the description, at the LEFT, wherever the
 * header is narrower than its breakpoint.
 *
 * Read per module, through the TypeScript AST, so it sees what one file
 * draws: an element whose class stacks its children (flex-col) until a
 * screen lays them out side by side (sm:flex-row ... 2xl:flex-row), with a
 * heading (h1 - h4) in one child and, in a later child that holds no
 * heading, something to press (button, a, Button, Link, MoreMenu,
 * CardMoreMenu). That later child is the header's actions. They keep to the
 * right edge while stacked when the child itself is pushed there (self-end
 * or ml-auto), when it is a row that lines its buttons up on the right
 * (justify-end) across the width the stack stretches it to, or when the
 * stack lines everything up on the right (items-end).
 */

export interface StackingCardHeader {
  file: string;
  // The stacking element's line.
  line: number;
  // The screen from which the parts sit side by side: sm, md, lg ...
  breakpoint: string;
  // The actions' own class, as written (null when worked out at run time).
  actionsClassName: string | null;
  // Whether the actions stay at the right edge while the header is stacked.
  keepsActionsRight: boolean;
}

const RESPONSIVE_ROW: RegExp = /(?:^|\s)(sm|md|lg|xl|2xl):flex-row(?:\s|$)/;
const COLUMN: RegExp = /(?:^|\s)flex-col(?:\s|$)/;
const HEADING_TAGS: ReadonlyArray<string> = ["h1", "h2", "h3", "h4"];
const ACTION_TAGS: ReadonlyArray<string> = [
  "button",
  "a",
  "Button",
  "Link",
  "MoreMenu",
  "CardMoreMenu",
];

// Unprefixed: what holds while the header is stacked.
const PUSHED_RIGHT: RegExp = /(?:^|\s)(self-end|ml-auto)(?:\s|$)/;
const LINED_UP_RIGHT: RegExp = /(?:^|\s)items-end(?:\s|$)/;
const ROW_ENDING_RIGHT: RegExp = /(?:^|\s)justify-end(?:\s|$)/;
// A stack stretches its children to its width unless it says otherwise.
const NOT_STRETCHED: RegExp =
  /(?:^|\s)(items-start|items-center|items-baseline)(?:\s|$)/;

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
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

function openingOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) {
    return node.openingElement;
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return node;
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

export function scanStackingCardHeaders(
  file: string,
  source: string,
): Array<StackingCardHeader> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const headers: Array<StackingCardHeader> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const className: string | null = classNameOf(node.openingElement);
      const row: RegExpMatchArray | null = className
        ? className.match(RESPONSIVE_ROW)
        : null;

      if (className && row && COLUMN.test(className)) {
        const children: Array<ts.JsxChild> = node.children.filter(
          (child: ts.JsxChild): boolean => {
            return !ts.isJsxText(child) || child.text.trim().length > 0;
          },
        );
        const headingIndex: number = children.findIndex(
          (child: ts.JsxChild): boolean => {
            return draws(child, HEADING_TAGS, sourceFile);
          },
        );
        const actions: ts.JsxChild | undefined = children.find(
          (child: ts.JsxChild, index: number): boolean => {
            return (
              headingIndex !== -1 &&
              index > headingIndex &&
              draws(child, ACTION_TAGS, sourceFile) &&
              !draws(child, HEADING_TAGS, sourceFile)
            );
          },
        );

        if (actions) {
          const actionsElement: ts.JsxOpeningLikeElement | null =
            firstElementOf(actions);
          const actionsClassName: string | null = actionsElement
            ? classNameOf(actionsElement)
            : null;

          headers.push({
            file: file,
            line: lineOf(sourceFile, node),
            breakpoint: row[1]!,
            actionsClassName: actionsClassName,
            keepsActionsRight:
              LINED_UP_RIGHT.test(className) ||
              Boolean(
                actionsClassName && PUSHED_RIGHT.test(actionsClassName),
              ) ||
              Boolean(
                actionsClassName &&
                  ROW_ENDING_RIGHT.test(actionsClassName) &&
                  !NOT_STRETCHED.test(className),
              ),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return headers;
}
