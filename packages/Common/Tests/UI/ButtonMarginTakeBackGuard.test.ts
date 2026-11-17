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
 * No box takes back a margin a Button does not have.
 *
 * Every bordered Button (NORMAL, PRIMARY, DANGER, the outlines...) used to
 * carry `md:ml-3`, a dialog footer's gap, and boxes that lined a Button up
 * with the text above it wrote `md:-ml-3` to take it back - or a bare
 * `-ml-3`, which on a phone, where there was nothing to take back, pulled
 * the Button 12px past the left edge of everything else (the time range
 * presets under every date picker, the monitor criteria's Add / Delete).
 *
 * A Button has no margin of its own now (BOXED_BUTTON_CLASS_NAME, #9128):
 * the box that holds buttons spaces them with a gap. So any `-ml-3` on a
 * bordered Button, or on a box holding one, at any width, pulls it 12px
 * past the gutter. A `-ml-3` is right only beside a LINK or SECONDARY_LINK
 * Button, which has no border: there it lines the words up with the text,
 * taking back the button's own padding.
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) through the TypeScript AST and fails on a `-ml-3` class, with or
 * without a breakpoint, on a bordered Button or on a box holding one.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const TAKE_BACK_CLASS: string = "-ml-3";

// -ml-3 at any width: bare, or from a breakpoint up (md:-ml-3).
function isTakeBack(token: string): boolean {
  const parts: Array<string> = token.split(":");

  return parts[parts.length - 1] === TAKE_BACK_CLASS;
}
const WHITESPACE: RegExp = /\s+/;

// Styles without a border or a margin: -ml-3 takes back their padding.
const LINK_STYLES: ReadonlySet<string> = new Set<string>([
  "LINK",
  "SECONDARY_LINK",
]);

interface MarginTakeBackFinding {
  file: string;
  line: number;
  className: string;
  // The Button the class pulls left, as its style names it.
  buttonStyle: string;
}

function classTokens(text: string): Array<string> {
  return text.split(WHITESPACE).filter((token: string): boolean => {
    return token.length > 0;
  });
}

const CHOOSING_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/*
 * The class texts an expression writes out: a literal or a template, and
 * each one a default or a choice can give - `props.className ?? "-ml-3"`,
 * `isOpen ? "..." : "..."`. The Test Monitor button's box defaulted to a
 * bare -ml-3 behind a ??, and pulled the button 12px past the gutter of
 * Create Monitor's criteria step on a phone, where this guard read nothing.
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

// The class text an attribute holds, when it is written out.
function classTextOf(
  attribute: ts.JsxAttribute,
  source: ts.SourceFile,
): string | null {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const texts: Array<string> = writtenClassTexts(
      initializer.expression,
      source,
    );

    return texts.length > 0 ? texts.join(" ") : null;
  }

  return null;
}

function tagName(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  const name: string = element.tagName.getText();
  const lastDot: number = name.lastIndexOf(".");

  return lastDot > -1 ? name.slice(lastDot + 1) : name;
}

// A Button's style, as its buttonStyle attribute names it (NORMAL when unset).
function buttonStyleOf(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  for (const property of element.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.name.getText() === "buttonStyle" &&
      property.initializer &&
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const text: string = property.initializer.expression.getText();
      const lastDot: number = text.lastIndexOf(".");

      return lastDot > -1 ? text.slice(lastDot + 1) : text;
    }
  }

  return "NORMAL";
}

// The Buttons an element is, or holds anywhere inside it.
function buttonsIn(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const found: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];

  if (tagName(element) === "Button") {
    found.push(element);
  }

  const owner: ts.Node = ts.isJsxOpeningElement(element)
    ? element.parent
    : element;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node !== element &&
      tagName(node) === "Button"
    ) {
      found.push(node);
    }

    ts.forEachChild(node, visit);
  };

  if (owner !== element) {
    ts.forEachChild(owner, visit);
  }

  return found;
}

function findMarginTakeBacks(
  file: string,
  text: string,
): Array<MarginTakeBackFinding> {
  if (!text.includes(TAKE_BACK_CLASS)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: Array<MarginTakeBackFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText() === "className") {
      const className: string | null = classTextOf(node, source);
      const element: ts.Node = node.parent.parent;

      if (
        className &&
        classTokens(className).some(isTakeBack) &&
        (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))
      ) {
        for (const button of buttonsIn(element)) {
          const style: string = buttonStyleOf(button);

          if (!LINK_STYLES.has(style)) {
            findings.push({
              file: file,
              line:
                source.getLineAndCharacterOfPosition(node.getStart(source))
                  .line + 1,
              className: className,
              buttonStyle: style,
            });
            break;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return findings;
}

function describeFinding(finding: MarginTakeBackFinding): string {
  return `${finding.file}:${finding.line} "${finding.className}" pulls a ${finding.buttonStyle} Button past the gutter: a Button has no margin to take back, so drop the -ml-3 and space buttons with the box's gap`;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a -ml-3 around a bordered Button is caught, at any width", () => {
    const code: string = `
      const A = () => (
        <div className="mt-1 flex space-x-2 -ml-3">
          <Button title="1 hour" buttonStyle={ButtonStyleType.NORMAL} />
        </div>
      );
      const B = () => (
        <div className="mt-1 flex space-x-2 md:-ml-3">
          <Button title="1 hour" buttonStyle={ButtonStyleType.NORMAL} />
        </div>
      );
      const C = () => <div className="mt-4 -ml-3"><Button title="Add" /></div>;
      const D = () => (
        <Button title="Delete" buttonStyle={ButtonStyleType.DANGER_OUTLINE} className="w-auto -ml-3" />
      );
    `;

    const findings: Array<MarginTakeBackFinding> = findMarginTakeBacks(
      "Fixture.tsx",
      code,
    );

    expect(
      findings.map((finding: MarginTakeBackFinding): string => {
        return `${finding.line}:${finding.buttonStyle}`;
      }),
    ).toEqual(["3:NORMAL", "8:NORMAL", "12:NORMAL", "14:DANGER_OUTLINE"]);
  });

  test("a -ml-3 a default or a choice gives is caught too", () => {
    const code: string = `
      const A = (props) => (
        <div className={props.className ?? "-ml-3 mr-2"}>
          <Button title="Test Monitor" buttonStyle={ButtonStyleType.NORMAL} />
        </div>
      );
      const B = (props) => (
        <div className={props.className ?? "md:-ml-3 md:mr-2"}>
          <Button title="Test Monitor" buttonStyle={ButtonStyleType.NORMAL} />
        </div>
      );
      const C = (props) => (
        <div className={props.isOpen ? "mt-2 -ml-3" : "mt-2"}><Button title="Add" /></div>
      );
      const D = (props) => (
        <div className={(props.isWide && "w-full") || "-ml-3"}><Button title="Add" /></div>
      );
      const E = (props) => (
        <div className={getClassName("-ml-3")}><Button title="Add" /></div>
      );
    `;

    expect(
      findMarginTakeBacks("Fixture.tsx", code).map(
        (finding: MarginTakeBackFinding): string => {
          return `${finding.line}:${finding.buttonStyle}`;
        },
      ),
    ).toEqual(["3:NORMAL", "8:NORMAL", "13:NORMAL", "16:NORMAL"]);
  });

  test("a link Button's -ml-3 lines its words up and is left alone", () => {
    const code: string = `
      const A = () => (
        <div className="flex -ml-3 mt-3 -mb-1">
          <Button title="Edit Filters" buttonStyle={ButtonStyleType.SECONDARY_LINK} />
          <Button title="Clear Filters" buttonStyle={ButtonStyleType.SECONDARY_LINK} />
        </div>
      );
      const B = () => (
        <Button className="-mt-1 -ml-3" title="Show more" buttonStyle={ButtonStyleType.LINK} />
      );
      const C = () => <div className="flex w-full -ml-3"><span>No button here</span></div>;
      const D = () => <div className="pointer-events-none -ml-3x">x</div>;
    `;

    expect(findMarginTakeBacks("Fixture.tsx", code)).toEqual([]);
  });
});

describe("no box takes back a margin a Button does not have", () => {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const files: Array<string> = roots.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(
      files.some((file: string): boolean => {
        return file.endsWith(path.join("Date", "StartAndEndDate.tsx"));
      }),
    ).toBe(true);
  });

  test("no -ml-3 pulls a bordered Button past the gutter", () => {
    const findings: Array<MarginTakeBackFinding> = files.flatMap(
      (file: string): Array<MarginTakeBackFinding> => {
        return findMarginTakeBacks(
          toRelativePath(REPOSITORY_ROOT, file),
          fs.readFileSync(file, "utf8"),
        );
      },
    );

    expect(findings.map(describeFinding)).toEqual([]);
  });

  test("the date presets' row spaces its buttons with a gap", () => {
    const code: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "Common",
        "UI",
        "Components",
        "Date",
        "StartAndEndDate.tsx",
      ),
      "utf8",
    );

    expect(code).toContain('className="mt-1 flex flex-wrap gap-2"');
    expect(code).not.toContain("-ml-3");
  });
});
