import ts from "typescript";

/*
 * Finds a status or label chip drawn by hand: a <span> (or <div>, <p>, <li>)
 * whose classes make the Pill's shape and colour themselves - an inline
 * flex box, round corners (rounded-full or rounded-md), a little side
 * padding, small text and a pale background colour:
 *
 *   <span className="inline-flex items-center rounded-full bg-green-50
 *     px-2 py-0.5 text-xs font-medium text-green-700">Connected</span>
 *
 * Its classes are read from every string in the className, a choice's
 * branches too (`isOk ? "bg-green-50 ..." : "bg-red-50 ..."`), since a chip
 * whose colour depends on a state is still a chip. A control is not a chip:
 * an element with hover: or focus: classes, a click or key handler, or a
 * role is left alone, as is any element that is not one of the four tags.
 *
 * Used by HandWrittenChipGuard.
 */

export interface HandWrittenChip {
  file: string;
  line: number;
}

const CHIP_TAGS: ReadonlySet<string> = new Set(["span", "div", "p", "li"]);

const CONTROL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "onClick",
  "onKeyDown",
  "onMouseDown",
  "role",
  "tabIndex",
]);

const SHAPE: RegExp = /^inline-flex$/u;
const CORNERS: RegExp = /^rounded-(full|md)$/u;
const SIDE_PADDING: RegExp = /^px-(0\.5|1|1\.5|2|2\.5|3)$/u;
const SMALL_TEXT: RegExp = /^(text-xs|text-\[10px\]|text-\[11px\])$/u;
const PALE_BACKGROUND: RegExp =
  /^bg-(?!white|black|transparent)[a-z]+-(50|100|200)(\/\d+)?$/u;
const CONTROL_VARIANT: RegExp = /^(hover|focus|focus-visible|active):/u;

function collectClassText(node: ts.Node, into: Array<string>): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    into.push(node.text);
    return;
  }

  if (ts.isTemplateExpression(node)) {
    into.push(node.head.text);

    for (const span of node.templateSpans) {
      collectClassText(span.expression, into);
      into.push(span.literal.text);
    }

    return;
  }

  ts.forEachChild(node, (child: ts.Node): void => {
    collectClassText(child, into);
  });
}

export function isHandWrittenChipClass(tokens: Array<string>): boolean {
  const has: (pattern: RegExp) => boolean = (pattern: RegExp): boolean => {
    return tokens.some((token: string): boolean => {
      return pattern.test(token);
    });
  };

  return (
    has(SHAPE) &&
    has(CORNERS) &&
    has(SIDE_PADDING) &&
    has(SMALL_TEXT) &&
    has(PALE_BACKGROUND) &&
    !has(CONTROL_VARIANT)
  );
}

export function findHandWrittenChips(
  file: string,
  text: string,
): Array<HandWrittenChip> {
  if (!text.includes("inline-flex") || !text.includes("rounded-")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<HandWrittenChip> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      CHIP_TAGS.has(node.tagName.getText(source))
    ) {
      let classText: Array<string> = [];
      let isControl: boolean = false;

      for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property)) {
          continue;
        }

        const name: string = property.name.getText(source);

        if (CONTROL_ATTRIBUTES.has(name)) {
          isControl = true;
        }

        if (name === "className" && property.initializer) {
          classText = [];
          collectClassText(property.initializer, classText);
        }
      }

      const tokens: Array<string> = classText
        .join(" ")
        .split(/\s+/u)
        .filter((token: string): boolean => {
          return token.length > 0;
        });

      if (!isControl && isHandWrittenChipClass(tokens)) {
        found.push({
          file: file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}
