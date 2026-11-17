import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * What ReadableTextContrastGuard reads in the frontends' source: text a
 * person reads, drawn in a gray too light to read, or at a size too small.
 *
 * Tailwind's gray-400 (#9ca3af) is 2.5:1 on a white card and gray-300 is
 * 1.5:1, under WCAG AA's 4.5:1 for text. They are right for what nobody
 * reads (an icon beside a label, a separator, a placeholder) and wrong for
 * a label, a description, a value, a hint or a timestamp. The scan finds,
 * in each module:
 *
 *   1. Faint text: a JSX element whose className names a resting
 *      text-gray-300 or text-gray-400 (or slate's) and that holds text: a
 *      word written in the JSX, or a value ({event.description}). An
 *      element that holds only icons, that is aria-hidden, or that sits on
 *      a dark ground of its own (bg-gray-700 and darker, on it or on an
 *      element around it in the same file) is left alone: there the light
 *      gray is the one that reads. A variant (hover:, dark:, placeholder:,
 *      group-hover:) is left alone too: what is drawn at rest is what a
 *      reader reads.
 *   2. Tiny text: a JSX element whose className names text-[10px] or
 *      smaller, which holds text.
 *
 * Classes written as string constants elsewhere and handed in by name are
 * out of the scan's sight; the components that do that hold their own
 * classes to 4.5:1 in a test of their own (EventItemQuietTextContrast).
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

export enum FaintTextKind {
  FaintGray = "faint-gray",
  TinySize = "tiny-size",
}

export interface FaintText {
  kind: FaintTextKind;
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  // The class token found: "text-gray-400", "text-[10px]".
  token: string;
  // The string literal the token was written in, trimmed.
  literal: string;
}

// A resting light gray text colour, with or without Tailwind's ! mark.
const FAINT_GRAY_TOKEN: RegExp = /^!?text-(gray|slate)-(300|400)$/;

// A size under 11px: text-[10px], text-[9px].
const TINY_SIZE_TOKEN: RegExp = /^!?text-\[(?:[0-9]|10)px\]$/;

// A ground dark enough that a light gray is what reads on it.
const DARK_GROUND_TOKEN: RegExp =
  /^!?bg-(?:(?:gray|slate|zinc|neutral|stone)-(?:700|800|900|950)|black)(?:\/\d+)?$/;

// A resting text colour: text-gray-700, text-white, not text-xs.
const TEXT_COLOUR_TOKEN: RegExp =
  /^!?text-(?:[a-z]+-\d{2,3}(?:\/\d+)?|white|black|inherit|current)$/;

// Intrinsic elements that never hold text.
const NOT_TEXT_TAGS: ReadonlySet<string> = new Set<string>([
  "svg",
  "path",
  "circle",
  "line",
  "rect",
  "g",
  "polyline",
  "polygon",
  "ellipse",
  "img",
  "input",
  "textarea",
  "select",
  "hr",
  "br",
  "iframe",
  "video",
  "canvas",
]);

// A component that draws an icon, a logo or a spinner, never words.
const ICON_COMPONENT: RegExp = /Icon|Logo|Svg|Spinner|Loader|Avatar/;

const WHITESPACE: RegExp = /\s+/g;

// The HTML entities of separators and dashes: &mdash;, &middot;.
const MARK_ENTITIES: RegExp = /&(?:mdash|ndash|middot|bull|minus|vert);/g;

// Separators and dashes, and nothing else.
const MARKS_ONLY: RegExp =
  /^[\u2013\u2014\u2212\u00b7\u2022/|:,>\u203a\u00bb-]*$/;

interface ClassLiteral {
  text: string;
}

function tagNameOf(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  return element.tagName.getText();
}

function isIconTag(tag: string): boolean {
  return NOT_TEXT_TAGS.has(tag) || ICON_COMPONENT.test(tag);
}

function attributeNamed(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): ts.JsxAttribute | undefined {
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }

  return undefined;
}

// Every string written in a className: literals, templates' pieces.
function classLiteralsOf(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Array<ClassLiteral> {
  const attribute: ts.JsxAttribute | undefined = attributeNamed(
    element,
    "className",
  );

  if (!attribute || !attribute.initializer) {
    return [];
  }

  const literals: Array<ClassLiteral> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ text: node.text });
      return;
    }

    if (ts.isTemplateExpression(node)) {
      literals.push({ text: node.head.text });

      for (const span of node.templateSpans) {
        visit(span.expression);
        literals.push({ text: span.literal.text });
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(attribute.initializer);

  return literals;
}

function tokensOf(literal: ClassLiteral): Array<string> {
  return literal.text.split(WHITESPACE).filter((token: string): boolean => {
    return token.length > 0;
  });
}

function isAriaHidden(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  const attribute: ts.JsxAttribute | undefined = attributeNamed(
    element,
    "aria-hidden",
  );

  if (!attribute) {
    return false;
  }

  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return true;
  }

  const text: string = initializer.getText();

  return text === '"true"' || text === "{true}";
}

function hasDarkGround(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  return hasClassToken(element, (token: string): boolean => {
    return DARK_GROUND_TOKEN.test(token);
  });
}

// Words only a screen reader reads: sr-only.
function isScreenReaderOnly(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  return hasClassToken(element, (token: string): boolean => {
    return token === "sr-only";
  });
}

// An element that gives its words a resting colour of its own.
function paintsItsOwnText(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  return hasClassToken(element, (token: string): boolean => {
    return TEXT_COLOUR_TOKEN.test(token);
  });
}

function hasClassToken(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  matches: (token: string) => boolean,
): boolean {
  return classLiteralsOf(element).some((literal: ClassLiteral): boolean => {
    return tokensOf(literal).some(matches);
  });
}

// Whether the element, or one around it in the file, sits on a dark ground.
function isOnADarkGround(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  let node: ts.Node | undefined = element;

  while (node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (hasDarkGround(node)) {
        return true;
      }
    }

    if (ts.isJsxElement(node) && hasDarkGround(node.openingElement)) {
      return true;
    }

    node = node.parent;
  }

  return false;
}

// Whether an expression in JSX can draw words, not only an icon.
function expressionHoldsText(expression: ts.Expression | undefined): boolean {
  if (!expression) {
    return false;
  }

  if (ts.isParenthesizedExpression(expression)) {
    return expressionHoldsText(expression.expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return (
      expressionHoldsText(expression.whenTrue) ||
      expressionHoldsText(expression.whenFalse)
    );
  }

  if (ts.isBinaryExpression(expression)) {
    const operator: ts.SyntaxKind = expression.operatorToken.kind;

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionHoldsText(expression.right);
    }

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return (
        expressionHoldsText(expression.left) ||
        expressionHoldsText(expression.right)
      );
    }
  }

  if (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  ) {
    return false;
  }

  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    return jsxHoldsText(expression);
  }

  /*
   * Anything else is a value - {props.title}, {t("...")} - which draws
   * words, unless all it draws is JSX: {items.map(...)} draws its
   * elements, read for words of their own.
   */
  let drawsWords: boolean = false;
  let drawsElements: boolean = false;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (drawsWords) {
      return;
    }

    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      drawsElements = true;

      if (jsxHoldsText(node)) {
        drawsWords = true;
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return drawsWords || !drawsElements;
}

function childrenHoldText(children: ts.NodeArray<ts.JsxChild>): boolean {
  return children.some((child: ts.JsxChild): boolean => {
    if (ts.isJsxText(child)) {
      return child.text.trim().length > 0;
    }

    if (ts.isJsxExpression(child)) {
      return expressionHoldsText(child.expression);
    }

    return jsxHoldsText(child);
  });
}

// Whether a JSX element draws words a person reads.
function jsxHoldsText(node: ts.JsxChild | ts.JsxSelfClosingElement): boolean {
  if (ts.isJsxSelfClosingElement(node)) {
    // A component that is handed its words: <Link text="..." />.
    return false;
  }

  if (ts.isJsxElement(node)) {
    if (isIconTag(tagNameOf(node.openingElement))) {
      return false;
    }

    if (
      isAriaHidden(node.openingElement) ||
      isScreenReaderOnly(node.openingElement)
    ) {
      return false;
    }

    // Words in an element that paints them a colour of its own are read there.
    if (paintsItsOwnText(node.openingElement)) {
      return false;
    }

    return childrenHoldText(node.children);
  }

  if (ts.isJsxFragment(node)) {
    return childrenHoldText(node.children);
  }

  if (ts.isJsxText(node)) {
    return node.text.trim().length > 0;
  }

  if (ts.isJsxExpression(node)) {
    return expressionHoldsText(node.expression);
  }

  return false;
}

/*
 * An element that draws only a mark nobody reads as words: a separator
 * ("/", "·", "•", ":") or the quiet dash of a cell with nothing in it.
 */
function isOnlyAMark(children: ts.NodeArray<ts.JsxChild>): boolean {
  let text: string = "";

  for (const child of children) {
    if (!ts.isJsxText(child)) {
      return false;
    }

    text += child.text;
  }

  const marks: string = text.replace(MARK_ENTITIES, "").replace(WHITESPACE, "");

  return text.trim().length > 0 && MARKS_ONLY.test(marks);
}

export function findFaintText(
  sourceText: string,
  file: string,
): Array<FaintText> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const found: Array<FaintText> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const opening: ts.JsxOpeningElement = node.openingElement;
      const tag: string = tagNameOf(opening);

      if (
        !isIconTag(tag) &&
        !isAriaHidden(opening) &&
        !isScreenReaderOnly(opening) &&
        !isOnlyAMark(node.children) &&
        childrenHoldText(node.children)
      ) {
        const onADarkGround: boolean = isOnADarkGround(opening);

        for (const literal of classLiteralsOf(opening)) {
          for (const token of tokensOf(literal)) {
            let kind: FaintTextKind | null = null;

            if (FAINT_GRAY_TOKEN.test(token) && !onADarkGround) {
              kind = FaintTextKind.FaintGray;
            } else if (TINY_SIZE_TOKEN.test(token)) {
              kind = FaintTextKind.TinySize;
            }

            if (kind) {
              found.push({
                kind: kind,
                file: file,
                line:
                  source.getLineAndCharacterOfPosition(opening.getStart())
                    .line + 1,
                token: token,
                literal: literal.text.trim(),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

// Every .tsx module under a directory, skipping tests and builds.
export function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "build" ||
        entry.name === "dist"
      ) {
        continue;
      }

      files.push(...listTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

// Every faint or tiny text in the modules under these directories.
export function scanDirectories(
  directories: ReadonlyArray<string>,
): Array<FaintText> {
  const found: Array<FaintText> = [];

  for (const directory of directories) {
    for (const file of listTsxFiles(path.join(REPOSITORY_ROOT, directory))) {
      const relative: string = path
        .relative(REPOSITORY_ROOT, file)
        .split(path.sep)
        .join("/");

      found.push(...findFaintText(fs.readFileSync(file, "utf8"), relative));
    }
  }

  return found;
}
