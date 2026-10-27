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
 * A box that takes back a Button's own margin does so only where the Button
 * has one.
 *
 * Every bordered Button (NORMAL, PRIMARY, DANGER, the outlines...) carries
 * `md:ml-3`: a dialog footer's gap, from the md breakpoint up. Below md it
 * has no margin and fills the row. Boxes that line a Button up with the text
 * above it wrote a bare `-ml-3` to take that margin back - right from md up,
 * but on a phone, where there was nothing to take back, it pulled the Button
 * 12px past the left edge of everything else. The time range presets under
 * every date picker sat that way (StartAndEndDate, LLM Connect's usage range
 * among them), and so did the monitor criteria's Add / Delete buttons and a
 * monitor evaluation's View Incident (24px: the button and its box both
 * pulled).
 *
 * Such a box writes `md:-ml-3`, as OnCallPolicySummary already did. A bare
 * `-ml-3` is right only beside a LINK or SECONDARY_LINK Button, which has no
 * border and no margin: there it lines the words up with the text, taking
 * back the button's own padding at every width.
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) through the TypeScript AST and fails on a `-ml-3` class on a
 * bordered Button, or on a box holding one.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const TAKE_BACK_CLASS: string = "-ml-3";
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
    const expression: ts.Expression = initializer.expression;

    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }

    if (ts.isTemplateExpression(expression)) {
      return expression.getText(source);
    }
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
        classTokens(className).includes(TAKE_BACK_CLASS) &&
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
  return `${finding.file}:${finding.line} "${finding.className}" pulls a ${finding.buttonStyle} Button left on a phone: write md:-ml-3`;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a bare -ml-3 around a bordered Button is caught; md:-ml-3 is not", () => {
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
    ).toEqual(["3:NORMAL", "12:NORMAL", "14:DANGER_OUTLINE"]);
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

describe("boxes take back a Button's margin only where it has one", () => {
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

  test("no -ml-3 pulls a bordered Button past the gutter on a phone", () => {
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

  test("the date presets' row takes the margin back from md up only", () => {
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

    expect(code).toContain('className="mt-1 flex space-x-2 md:-ml-3"');
    expect(code).not.toContain("space-x-2 -ml-3");
  });
});
