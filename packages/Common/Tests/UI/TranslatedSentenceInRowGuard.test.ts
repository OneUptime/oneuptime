// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A SENTENCE IN A FLEX ROW IS ONE ITEM OF IT.
 *
 * TranslatedSentence draws its pieces - the words, and the slots between
 * them - loose in the element that holds it. In a flex or a grid box every
 * loose piece is an item of its own: the spaces at the ends of the words
 * are dropped, and in a sentence read right to left the marks that set a
 * slot apart from the words around it (TranslateTemplate's setsSlotsApart)
 * are items too, each one more gap. The profile's zoom line, "Zoomed into
 * {{name}}" - "بزرگ‌نمایی روی {{name}}" in Persian, where the name is the
 * last piece - drew its Callers and callees button one gap further off on a
 * Persian page than on an English one.
 *
 * So a row holds the sentence in an element of its own (a <span>), where
 * its pieces are one line of text, or draws each piece itself (renderText,
 * which keeps the slots as they are).
 *
 * This reads every frontend's source through the TypeScript AST and fails
 * on a TranslatedSentence without renderText whose parent element's class
 * makes it a flex or a grid box at any width ("flex", "sm:inline-flex").
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * The sentences drawn loose: TranslatedSentence, and ErrorSentence, which is
 * one with an error in it (#7307).
 */
const SENTENCE_TAGS: ReadonlyArray<string> = [
  "TranslatedSentence",
  "ErrorSentence",
];

// The display classes that lay a box's children out as items.
const ROW_DISPLAY_CLASSES: ReadonlySet<string> = new Set<string>([
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
]);

const WHITESPACE: RegExp = /\s+/;

// The operators a sentence can stand behind inside a JSX expression.
const CHOOSING_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

interface SentenceInRowFinding {
  file: string;
  line: number;
  sentenceTag: string;
  parentTag: string;
  className: string;
}

function tagName(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  const name: string = element.tagName.getText();
  const lastDot: number = name.lastIndexOf(".");

  return lastDot > -1 ? name.slice(lastDot + 1) : name;
}

function hasAttribute(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): boolean {
  return element.attributes.properties.some(
    (property: ts.JsxAttributeLike): boolean => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

/*
 * The class texts an expression writes out: a literal or a template, and
 * each one a default or a choice can give.
 */
function writtenClassTexts(
  expression: ts.Expression,
  source: ts.SourceFile,
): Array<string> {
  if (ts.isParenthesizedExpression(expression)) {
    return writtenClassTexts(expression.expression, source);
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [expression.text];
  }

  if (ts.isTemplateExpression(expression)) {
    return [expression.getText(source)];
  }

  if (
    ts.isBinaryExpression(expression) &&
    CHOOSING_OPERATORS.has(expression.operatorToken.kind)
  ) {
    return [
      ...writtenClassTexts(expression.left, source),
      ...writtenClassTexts(expression.right, source),
    ];
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...writtenClassTexts(expression.whenTrue, source),
      ...writtenClassTexts(expression.whenFalse, source),
    ];
  }

  return [];
}

// The class text an element's className holds, when it is written out.
function classTextOf(
  element: ts.JsxOpeningElement,
  source: ts.SourceFile,
): string {
  for (const property of element.attributes.properties) {
    if (
      !ts.isJsxAttribute(property) ||
      property.name.getText() !== "className" ||
      !property.initializer
    ) {
      continue;
    }

    if (ts.isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }

    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      return writtenClassTexts(property.initializer.expression, source).join(
        " ",
      );
    }
  }

  return "";
}

// Whether a class text lays the box's children out as items, at any width.
function isRowClass(className: string): boolean {
  return className.split(WHITESPACE).some((token: string): boolean => {
    const lastColon: number = token.lastIndexOf(":");

    return ROW_DISPLAY_CLASSES.has(
      lastColon > -1 ? token.slice(lastColon + 1) : token,
    );
  });
}

/*
 * The element a sentence's pieces are children of: up through the JSX
 * expressions, the choices and the fragments it stands in, to the first
 * element. Null when the sentence is handed on (a prop, a returned value).
 */
function parentElementOf(node: ts.Node): ts.JsxElement | null {
  let parent: ts.Node | undefined = node.parent;

  while (parent) {
    if (ts.isJsxElement(parent)) {
      return parent;
    }

    if (
      ts.isJsxExpression(parent) ||
      ts.isJsxFragment(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        CHOOSING_OPERATORS.has(parent.operatorToken.kind))
    ) {
      parent = parent.parent;
      continue;
    }

    return null;
  }

  return null;
}

function findSentencesInRows(
  file: string,
  text: string,
): Array<SentenceInRowFinding> {
  if (
    !SENTENCE_TAGS.some((tag: string): boolean => {
      return text.includes(`<${tag}`);
    })
  ) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: Array<SentenceInRowFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      SENTENCE_TAGS.includes(tagName(node)) &&
      !hasAttribute(node, "renderText")
    ) {
      const sentence: ts.Node = ts.isJsxOpeningElement(node)
        ? node.parent
        : node;
      const parent: ts.JsxElement | null = parentElementOf(sentence);
      const className: string = parent
        ? classTextOf(parent.openingElement, source)
        : "";

      if (parent && isRowClass(className)) {
        findings.push({
          file: file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          sentenceTag: tagName(node),
          parentTag: tagName(parent.openingElement),
          className: className,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return findings;
}

function describeFinding(finding: SentenceInRowFinding): string {
  return `${finding.file}:${finding.line} a ${finding.sentenceTag} is loose in <${finding.parentTag} className="${finding.className}">: hold it in a <span>, or draw its pieces with renderText`;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a sentence loose in a flex or a grid box is caught, at any width", () => {
    const code: string = `
      const A = () => (
        <div className="flex items-center gap-1.5">
          <Icon icon={IconProp.Filter} />
          <TranslatedSentence template="Zoomed into {{name}}" slots={{ name: <b>x</b> }} />
        </div>
      );
      const B = (props) => (
        <span className="hidden sm:inline-flex">
          {props.isOn ? <TranslatedSentence template="On {{x}}" slots={{ x: 1 }} /> : null}
        </span>
      );
      const C = () => (
        <div className="grid grid-cols-2">
          <>
            <TranslatedSentence template="{{count}} events" slots={{ count: 2 }} />
          </>
        </div>
      );
      const D = (props) => (
        <p className={props.isWide ? "flex gap-2" : "block"}>
          <TranslatedSentence template="Read {{x}}" slots={{ x: 1 }}></TranslatedSentence>
        </p>
      );
    `;

    expect(
      findSentencesInRows("Fixture.tsx", code).map(
        (finding: SentenceInRowFinding): string => {
          return `${finding.line}:${finding.parentTag}`;
        },
      ),
    ).toEqual(["5:div", "10:span", "16:div", "22:p"]);
  });

  test("an ErrorSentence is a sentence too: loose in a row it is caught, in a span it passes", () => {
    const code: string = `
      const A = (props) => (
        <div className="flex items-center gap-2">
          <Icon icon={IconProp.Alert} />
          <ErrorSentence template="Couldn't refresh. {{error}}" error={props.error} />
        </div>
      );
      const B = (props) => (
        <div className="flex items-center gap-2">
          <span>
            <ErrorSentence template="Couldn't refresh. {{error}}" error={props.error} />
          </span>
        </div>
      );
    `;

    expect(
      findSentencesInRows("Fixture.tsx", code).map(
        (finding: SentenceInRowFinding): string => {
          return `${finding.line}:${finding.sentenceTag}:${finding.parentTag}`;
        },
      ),
    ).toEqual(["5:ErrorSentence:div"]);
  });

  test("a sentence in a span of its own, in a block, with renderText or handed on passes", () => {
    const code: string = `
      const A = () => (
        <div className="flex items-center gap-1.5">
          <span>
            <TranslatedSentence template="Zoomed into {{name}}" slots={{ name: <b>x</b> }} />
          </span>
        </div>
      );
      const B = () => (
        <p className="mt-1 text-sm text-gray-500">
          <TranslatedSentence template="On {{x}}" slots={{ x: 1 }} />
        </p>
      );
      const C = () => (
        <div className="flex flex-wrap gap-1">
          <TranslatedSentence
            template="{{count}} events"
            slots={{ count: 2 }}
            renderText={(text) => <span>{text}</span>}
          />
        </div>
      );
      const D = () => (
        <Card description={<TranslatedSentence template="On {{x}}" slots={{ x: 1 }} />} />
      );
      const E = () => (
        <div className="flex-col flex-1">
          <TranslatedSentence template="On {{x}}" slots={{ x: 1 }} />
        </div>
      );
    `;

    expect(findSentencesInRows("Fixture.tsx", code)).toEqual([]);
  });
});

describe("a sentence in a row is one item of it", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Profiles", "FlamegraphView.tsx"));
      }),
    ).toBe(true);
  });

  test("no TranslatedSentence is loose in a flex or a grid box", () => {
    const findings: Array<SentenceInRowFinding> = files
      .filter((file: string): boolean => {
        return file.endsWith(".tsx");
      })
      .flatMap((file: string): Array<SentenceInRowFinding> => {
        return findSentencesInRows(
          toRelativePath(REPOSITORY_ROOT, file),
          fs.readFileSync(file, "utf8"),
        );
      });

    expect(findings.map(describeFinding)).toEqual([]);
  });
});
