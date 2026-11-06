import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listSourceFiles, toRelativePath } from "../ForeignHiddenRuleGuard";

/*
 * A SHARED COMPONENT DRAWS A COUNT IN THE READER'S DIGITS.
 *
 * The shared components put a count beside their words in many places: a
 * side menu entry's badge, a filter button's chip ("Critical 3"), a tab's
 * count, a facet's selected count, the "+2" of a select's hidden labels, a
 * notification bell. Each drew the number as JavaScript writes it, so a
 * Persian page read "بحرانی 3" where every other count on it is "۳" - the
 * words in the reader's language, the digits in English's (#6150's review).
 * A count is now drawn the way the reader's language writes a number, with
 * the translator's formatNumber: "۳" in Persian, "1.234" in German, "1,234"
 * in English.
 *
 * This reads every shared component (packages/Common/UI/Components) through
 * the TypeScript syntax tree and fails on a count drawn as a child of an
 * element as it is: a value whose name says it counts - "count", "total"
 * or ".length" ("badgeCount", "activeCount", "items.length") - or a
 * "badge" the same file declares a number. A value the file declares as
 * text ("const exactCount: string = ...") is already written, and passes;
 * so does every call (formatNumber, a translated sentence).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SHARED_COMPONENTS: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "UI",
  "Components",
);

// Words that make a name a count: "count", "badgeCount", "devicesTotal".
const COUNT_WORDS: ReadonlySet<string> = new Set<string>(["count", "total"]);

// A word that is a count only where the file declares it a number.
const BADGE_WORD: string = "badge";

// The boundaries of a camelCase name's words: "badgeCount" -> badge, Count.
const CAMEL_CASE_BOUNDARY: RegExp = /(?=[A-Z])/;

const NUMBER_TYPE: RegExp = /\bnumber\b/;

// The operators a count can stand behind inside a JSX expression.
const CHOOSING_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

interface RawCountFinding {
  file: string;
  line: number;
  expression: string;
}

// The lower-cased words of a camelCase name.
function nameWords(name: string): Array<string> {
  return name.split(CAMEL_CASE_BOUNDARY).map((word: string): string => {
    return word.toLowerCase();
  });
}

// The name a value is read by: "count", "props.count", "items.length".
function readName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return readName(expression.expression);
  }

  return null;
}

/*
 * The types the file writes for a name - a variable's, a parameter's or a
 * property's annotation ("count: number", "badge?: string | ReactElement")
 * - each as written.
 */
function declaredTypes(source: ts.SourceFile, name: string): Array<string> {
  const types: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node)) &&
      node.type &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === name
    ) {
      types.push(node.type.getText(source));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return types;
}

/*
 * Whether a value drawn as it is would put a count on the screen in
 * JavaScript's digits.
 */
function isRawCount(expression: ts.Expression, source: ts.SourceFile): boolean {
  const name: string | null = readName(expression);

  if (!name) {
    return false;
  }

  if (ts.isPropertyAccessExpression(expression) && name === "length") {
    return true;
  }

  const words: Array<string> = nameWords(name);
  const types: Array<string> = declaredTypes(source, name);
  const isDeclaredNumber: boolean = types.some((type: string): boolean => {
    return NUMBER_TYPE.test(type);
  });

  if (
    words.some((word: string): boolean => {
      return COUNT_WORDS.has(word);
    })
  ) {
    // Declared as text or an element only: already written.
    return types.length === 0 || isDeclaredNumber;
  }

  return words.includes(BADGE_WORD) && isDeclaredNumber;
}

/*
 * The values a child expression draws: itself, or each value a choice
 * (?:, ||, ??) or a guard (&&) in it can draw.
 */
function drawnValues(expression: ts.Expression): Array<ts.Expression> {
  if (ts.isParenthesizedExpression(expression)) {
    return drawnValues(expression.expression);
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...drawnValues(expression.whenTrue),
      ...drawnValues(expression.whenFalse),
    ];
  }

  if (
    ts.isBinaryExpression(expression) &&
    CHOOSING_OPERATORS.has(expression.operatorToken.kind)
  ) {
    // A guard (a && b) draws b; a choice (a || b, a ?? b) either.
    return expression.operatorToken.kind ===
      ts.SyntaxKind.AmpersandAmpersandToken
      ? drawnValues(expression.right)
      : [...drawnValues(expression.left), ...drawnValues(expression.right)];
  }

  return [expression];
}

function findRawCounts(file: string, text: string): Array<RawCountFinding> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: Array<RawCountFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const value of drawnValues(node.expression)) {
        if (isRawCount(value, source)) {
          findings.push({
            file: file,
            line:
              source.getLineAndCharacterOfPosition(value.getStart(source))
                .line + 1,
            expression: value.getText(source),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return findings;
}

function describeFinding(finding: RawCountFinding): string {
  return `${finding.file}:${finding.line} draws {${finding.expression}} in JavaScript's digits: draw it as translator.formatNumber(${finding.expression})`;
}

function lineAndExpression(finding: RawCountFinding): string {
  return `${finding.line}:${finding.expression}`;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a count drawn as it is is caught, behind a choice or a guard too", () => {
    const code: string = `
      export interface Option {
        label: string;
        badge?: number | undefined;
      }
      const A = (props) => (
        <span>{props.count}</span>
      );
      const B = (props) => (
        <span>
          {props.items.length}
        </span>
      );
      const C = (props) => (
        <span>{props.badgeCount > 99 ? "99+" : props.badgeCount}</span>
      );
      const D = (props) => (
        <>{props.isOpen && props.hiddenCount}</>
      );
      const E = (props) => <span>+{hiddenLabelCount}</span>;
      const F = (option: Option) => <span>{option.badge}</span>;
      const G = (props) => <span>{props.tab.countBadge}</span>;
      const H = (data) => <b>{data.devicesTotal!}</b>;
    `;

    expect(findRawCounts("Fixture.tsx", code).map(lineAndExpression)).toEqual([
      "7:props.count",
      "11:props.items.length",
      "15:props.badgeCount",
      "18:props.hiddenCount",
      "20:hiddenLabelCount",
      "21:option.badge",
      "22:props.tab.countBadge",
      "23:data.devicesTotal!",
    ]);
  });

  test("a count written for the reader, a value that is not a count, and a prop pass", () => {
    const code: string = `
      const exactCount: string = formatExactFacetCount(5);
      const badge: ReactElement = <span />;
      export interface Props {
        account: string;
        recordNumber: number;
        badge?: string | ReactElement | undefined;
      }
      const A = (props: Props) => (
        <div count={props.items.length} aria-label={String(props.count)}>
          {translator.formatNumber(props.count)}
          {translator.translatePlural(SENTENCE, props.items.length)}
          {exactCount}
          {badge}
          {props.badge}
          {props.account}
          {props.recordNumber}
          {props.count > 0 ? translator.formatNumber(props.count) : null}
        </div>
      );
    `;

    expect(findRawCounts("Fixture.tsx", code)).toEqual([]);
  });

  test("a name only counts by its words: 'account' and 'discount' are not counts", () => {
    const code: string = `
      const A = (props) => (
        <p>
          {props.account}
          {props.discount}
          {props.totalCount}
          {props.subtotalLabel}
        </p>
      );
    `;

    expect(findRawCounts("Fixture.tsx", code).map(lineAndExpression)).toEqual([
      "6:props.totalCount",
    ]);
  });
});

describe("the shared components draw their counts in the reader's digits", () => {
  const files: Array<string> = listSourceFiles(SHARED_COMPONENTS).filter(
    (file: string): boolean => {
      return file.endsWith(".tsx");
    },
  );

  test("the scan reads the shared components", () => {
    expect(files.length).toBeGreaterThan(500);

    for (const component of [
      ["FilterButtons", "FilterButtons.tsx"],
      ["Badge", "Badge.tsx"],
      ["Tabs", "Tab.tsx"],
    ]) {
      expect(
        files.some((file: string): boolean => {
          return file.endsWith(path.join(...component));
        }),
      ).toBe(true);
    }
  });

  test("no shared component draws a count in JavaScript's digits", () => {
    const findings: Array<RawCountFinding> = files.flatMap(
      (file: string): Array<RawCountFinding> => {
        return findRawCounts(
          toRelativePath(REPOSITORY_ROOT, file),
          fs.readFileSync(file, "utf8"),
        );
      },
    );

    expect(findings.map(describeFinding)).toEqual([]);
  });
});
