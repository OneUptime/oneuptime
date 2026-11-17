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
 *      element that holds only icons, that is aria-hidden (or inside an
 *      aria-hidden element of the same file), or that sits on
 *      a dark ground of its own (bg-gray-700 and darker, on it or on an
 *      element around it in the same file) is left alone: there the light
 *      gray is the one that reads. A variant (hover:, dark:, placeholder:,
 *      group-hover:) is left alone too: what is drawn at rest is what a
 *      reader reads.
 *   2. Tiny text: a JSX element whose className names text-[10px] or
 *      smaller, which holds text.
 *
 * A className that names a const of this file is read through it:
 * className={FACET_COUNT_COLUMN_CLASS}, `${BASE} truncate`, STYLES.label for
 * a const object of strings, and a const that chooses between strings
 * (`const tone = on ? "text-gray-900" : "text-gray-400"`). The nearest
 * declaration in scope wins. A class imported from another module, or
 * handed in as a prop, is still out of sight.
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
  SmallSize = "small-size",
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
  // Where that string literal sits in the module, quotes included.
  start: number;
  end: number;
}

// A resting light gray text colour, with or without Tailwind's ! mark.
const FAINT_GRAY_TOKEN: RegExp = /^!?text-(gray|slate)-(300|400)$/;

// A size under 11px: text-[10px], text-[10.5px], text-[9px].
const TINY_SIZE_TOKEN: RegExp = /^!?text-\[(?:[0-9]|10)(?:\.\d+)?px\]$/;

/*
 * 11px, a pixel under text-xs. Readable for a short label in capitals (an
 * eyebrow: "LAST 24 HOURS", "RECENT") or in a chip, a badge or a key that
 * frames it; a hint, a value or a sentence is text-xs.
 */
const SMALL_SIZE_TOKEN: RegExp = /^!?text-\[(?:11px|0\.6875rem)\]$/;

// A resting background of its own: a chip, a badge.
const OWN_GROUND_TOKEN: RegExp =
  /^!?(?:bg-(?!transparent$|none$|inherit$)\S+|ring-1|border)$/;

const ROUNDED_TOKEN: RegExp = /^!?rounded(?:-\S+)?$/;

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
const MARK_ENTITIES: RegExp =
  /&(?:mdash|ndash|middot|bull|minus|vert|hellip);/g;

// Separators and dashes, and nothing else.
const MARKS_ONLY: RegExp =
  /^[\u2013\u2014\u2212\u00b7\u2022\u2026/|:,.>\u203a\u00bb-]*$/;

interface ClassLiteral {
  text: string;
  start: number;
  end: number;
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

function unwrapped(expression: ts.Expression): ts.Expression {
  let node: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }

  return node;
}

// The name after a dot (props.className), not a value of its own.
function isAPropertyName(identifier: ts.Identifier): boolean {
  const parent: ts.Node = identifier.parent;

  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier)
  );
}

/*
 * What a const of this name, declared in this file in a scope around the
 * identifier, is set to: the nearest declaration wins, as in the language.
 * Constants imported from another module are not followed.
 */
function constInitializerOf(
  identifier: ts.Identifier,
): ts.Expression | undefined {
  let node: ts.Node | undefined = identifier.parent;

  while (node) {
    const statements: ts.NodeArray<ts.Statement> | undefined =
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isModuleBlock(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node)
        ? node.statements
        : undefined;

    for (const statement of statements || []) {
      if (
        !ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const)
      ) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === identifier.text &&
          declaration.initializer
        ) {
          return unwrapped(declaration.initializer);
        }
      }
    }

    node = node.parent;
  }

  return undefined;
}

/*
 * A const that holds a class string: a literal, a template, a choice
 * between strings (`on ? "text-gray-900" : "text-gray-400"`), a sum of
 * strings. A const set to anything else (a call, a number) is not a class.
 */
function stringConstantInitializerOf(
  identifier: ts.Identifier,
): ts.Expression | undefined {
  const initializer: ts.Expression | undefined = constInitializerOf(identifier);

  if (
    initializer &&
    (ts.isStringLiteral(initializer) ||
      ts.isNoSubstitutionTemplateLiteral(initializer) ||
      ts.isTemplateExpression(initializer) ||
      ts.isConditionalExpression(initializer) ||
      (ts.isBinaryExpression(initializer) &&
        initializer.operatorToken.kind === ts.SyntaxKind.PlusToken))
  ) {
    return initializer;
  }

  return undefined;
}

/*
 * A class string held in a const object of strings, read by name:
 * className={STYLES.label} with const STYLES = { label: "..." }.
 */
function objectConstantPropertyOf(
  access: ts.PropertyAccessExpression,
): ts.Expression | undefined {
  if (!ts.isIdentifier(access.expression)) {
    return undefined;
  }

  const initializer: ts.Expression | undefined = constInitializerOf(
    access.expression,
  );

  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    return undefined;
  }

  for (const property of initializer.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === access.name.text
    ) {
      const value: ts.Expression = unwrapped(property.initializer);

      if (
        ts.isStringLiteral(value) ||
        ts.isNoSubstitutionTemplateLiteral(value) ||
        ts.isTemplateExpression(value)
      ) {
        return value;
      }
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
  const followed: Set<ts.Node> = new Set<ts.Node>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push({ text: node.text, start: node.getStart(), end: node.end });
      return;
    }

    // A class string held in a const: className={FACET_COUNT_COLUMN_CLASS}.
    if (ts.isIdentifier(node) && !isAPropertyName(node)) {
      const initializer: ts.Expression | undefined =
        stringConstantInitializerOf(node);

      if (initializer && !followed.has(initializer)) {
        followed.add(initializer);
        visit(initializer);
      }

      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      const value: ts.Expression | undefined = objectConstantPropertyOf(node);

      if (value) {
        if (!followed.has(value)) {
          followed.add(value);
          visit(value);
        }

        return;
      }
    }

    if (ts.isTemplateExpression(node)) {
      literals.push({
        text: node.head.text,
        start: node.head.getStart(),
        end: node.head.end,
      });

      for (const span of node.templateSpans) {
        visit(span.expression);
        literals.push({
          text: span.literal.text,
          start: span.literal.getStart(),
          end: span.literal.end,
        });
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

/*
 * A short label 11px suits: in capitals (uppercase), or framed in a chip, a
 * badge or a key (rounded, on a ground or in a border of its own; a kbd).
 */
function isAnEyebrowOrAChip(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): boolean {
  if (tagNameOf(element) === "kbd") {
    return true;
  }

  if (
    hasClassToken(element, (token: string): boolean => {
      return token === "uppercase";
    })
  ) {
    return true;
  }

  return (
    hasClassToken(element, (token: string): boolean => {
      return ROUNDED_TOKEN.test(token);
    }) &&
    hasClassToken(element, (token: string): boolean => {
      return OWN_GROUND_TOKEN.test(token);
    })
  );
}

/*
 * Whether an element around this one in the file is aria-hidden: a preview
 * drawn for the eye (a form field's look, a placeholder inside it) that a
 * reader is not meant to read.
 */
function isInsideAriaHidden(element: ts.JsxOpeningElement): boolean {
  let node: ts.Node | undefined = element.parent?.parent;

  while (node) {
    if (ts.isJsxElement(node) && isAriaHidden(node.openingElement)) {
      return true;
    }

    node = node.parent;
  }

  return false;
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
        !isInsideAriaHidden(opening) &&
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
            } else if (
              SMALL_SIZE_TOKEN.test(token) &&
              !isAnEyebrowOrAChip(opening)
            ) {
              kind = FaintTextKind.SmallSize;
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
                start: literal.start,
                end: literal.end,
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
