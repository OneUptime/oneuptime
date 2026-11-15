// UX rule: Docs/ux/README.md#errors
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * NO WIDGET DRAWS ITS OWN ERROR LINE AGAIN (issue #7330).
 *
 * Each widget drew why it had nothing to draw its own way: the set
 * sentence as it was, in English on every board, in gray-400 in a 160 or
 * 192px column; or as a page's error (ErrorMessage), with a page's margins.
 * Every widget now draws it through the one error line (DashboardWidgetError
 * and its line, DashboardWidgetErrorLine), a public dashboard's placeholder
 * (WidgetPlaceholder), or a view that draws one of those (the Gauge's, the
 * Value's, a list's) - in the reader's words, readable.
 *
 * This guard reads every widget's source as syntax (the TypeScript AST) and
 * holds that: an error is handed on (error={error}, message={error}), never
 * drawn as it is; no widget draws a page's ErrorMessage; nothing is drawn
 * in the old gray-400 narrow column; and every sentence a widget sets as
 * its error is worded in every Dashboard language. It is pinned on
 * snippets first.
 */

const WIDGETS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
);

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

// The old error line: pale gray, held to a 160 or 192px column.
const OLD_ERROR_LOOK: RegExp =
  /\btext-gray-400\b[^"`]*\bmax-w-(?:40|48)\b|\bmax-w-(?:40|48)\b[^"`]*\btext-gray-400\b/;

interface Finding {
  file: string;
  line: number;
  what: string;
}

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

// Whether an expression is the widget's error: `error` or `props.error`.
function isTheError(expression: ts.Expression | undefined): boolean {
  if (!expression) {
    return false;
  }

  if (ts.isIdentifier(expression)) {
    return expression.text === "error";
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "error" &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "props"
  );
}

function tagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string {
  return node.tagName.getText();
}

// What a source file does with its error that it should not.
function findings(file: string, source: string): Array<Finding> {
  const sourceFile: ts.SourceFile = parse(file, source);
  const found: Array<Finding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // `{error}` as a child: the error drawn as it was set.
    if (
      ts.isJsxExpression(node) &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      isTheError(node.expression)
    ) {
      found.push({
        file,
        line: lineOf(sourceFile, node),
        what: `draws ${node.getText(sourceFile)} as it is`,
      });
    }

    // A page's error, with a page's margins, in a widget.
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === "ErrorMessage"
    ) {
      found.push({
        file,
        line: lineOf(sourceFile, node),
        what: "draws a page's ErrorMessage",
      });
    }

    // The old look, in any class name.
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      OLD_ERROR_LOOK.test(node.text)
    ) {
      found.push({
        file,
        line: lineOf(sourceFile, node),
        what: `draws in the old error look: ${node.text}`,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

// Each sentence a source sets as its error: setError("...").
function errorSentences(file: string, source: string): Array<string> {
  const sourceFile: ts.SourceFile = parse(file, source);
  const sentences: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "setError" &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) &&
      node.arguments[0].text.trim()
    ) {
      sentences.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sentences;
}

function widgetFiles(): Array<string> {
  return fs
    .readdirSync(WIDGETS_DIR, { recursive: true })
    .map((entry: string | Buffer): string => {
      return entry.toString();
    })
    .filter((entry: string): boolean => {
      return SOURCE_FILE.test(entry) && !TEST_FILE.test(entry);
    })
    .sort();
}

function readWidget(file: string): string {
  return fs.readFileSync(path.join(WIDGETS_DIR, file), "utf8");
}

describe("the reader of a widget's error", () => {
  test("finds an error drawn as it is, a page's ErrorMessage and the old look", () => {
    const found: Array<string> = findings(
      "Snippet.tsx",
      [
        'const a = <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>;',
        "const b = <>{props.error}</>;",
        "const c = <ErrorMessage message={error} />;",
        'const d = <p className="text-xs text-gray-400 text-center max-w-40">x</p>;',
      ].join("\n"),
    ).map((finding: Finding): string => {
      return `${finding.line} ${finding.what}`;
    });

    expect(found).toEqual([
      "1 draws in the old error look: text-xs text-gray-400 text-center max-w-48",
      "1 draws {error} as it is",
      "2 draws {props.error} as it is",
      "3 draws a page's ErrorMessage",
      "4 draws in the old error look: text-xs text-gray-400 text-center max-w-40",
    ]);
  });

  test("leaves an error handed on, a no-data line, and other words alone", () => {
    expect(
      findings(
        "Snippet.tsx",
        [
          "const a = <DashboardWidgetError icon={icon} error={error} />;",
          "const b = <WidgetPlaceholder icon={icon} message={error} />;",
          "const c = <GaugeWidgetView error={error} />;",
          "const d = <p>{errorText}</p>;",
          'const e = <div className="text-xs text-gray-400">No data</div>;',
          "const f = <p>{props.error?.message}</p>;",
          '// <p className="text-gray-400 max-w-48">{error}</p>',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("finds each sentence set as an error, and no other", () => {
    expect(
      errorSentences(
        "Snippet.tsx",
        [
          'setError("Please select a valid start and end date.");',
          "setError(`No project selected.`);",
          'setError("");',
          "setError(API.getFriendlyErrorMessage(err));",
          'setWarning("Not an error.");',
        ].join("\n"),
      ),
    ).toEqual([
      "Please select a valid start and end date.",
      "No project selected.",
    ]);
  });
});

describe("every widget draws its error through the one error line", () => {
  test("the widgets folder is where the widgets are", () => {
    expect(widgetFiles()).toEqual(
      expect.arrayContaining([
        "DashboardWidgetError.tsx",
        "DashboardDataSourceChartComponent.tsx",
        "DashboardTableComponent.tsx",
        "DashboardLogStreamComponent.tsx",
        "DashboardChartComponent.tsx",
        "DashboardNetworkMapComponent.tsx",
        "DashboardSloComponent.tsx",
        "GaugeWidgetView.tsx",
        "ValueWidgetView.tsx",
        "WidgetPlaceholder.tsx",
      ]),
    );
  });

  test("no widget draws its error as it is, as a page's error, or in the old look", () => {
    const found: Array<Finding> = [];

    for (const file of widgetFiles()) {
      found.push(...findings(file, readWidget(file)));
    }

    expect(found).toEqual([]);
  });

  test("each widget that keeps an error hands it to the error line, a placeholder or a view that draws one", () => {
    const DRAWS_IT: RegExp =
      /<(?:DashboardWidgetError|DashboardWidgetErrorLine|WidgetPlaceholder)\b|\b(?:error|message)=\{error\}/;
    const KEEPS_AN_ERROR: RegExp = /\[error, setError\]/;
    const unhanded: Array<string> = [];

    for (const file of widgetFiles()) {
      const source: string = readWidget(file);

      if (!KEEPS_AN_ERROR.test(source)) {
        continue;
      }

      if (!DRAWS_IT.test(source)) {
        unhanded.push(file);
      }
    }

    expect(unhanded).toEqual([]);
  });

  test("every sentence a widget sets as its error is worded in every Dashboard language", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const sentences: Set<string> = new Set<string>();

    for (const file of widgetFiles()) {
      for (const sentence of errorSentences(file, readWidget(file))) {
        sentences.add(sentence);
      }
    }

    // The widgets do set sentences: the reader is reading them.
    expect(Array.from(sentences)).toEqual(
      expect.arrayContaining([
        "Please select a valid start and end date.",
        "No project selected.",
        "Trace tables are not available on public dashboards.",
      ]),
    );

    const missing: Array<string> = [];

    for (const sentence of Array.from(sentences).sort()) {
      if (english[sentence] !== sentence) {
        missing.push(`en: ${sentence}`);
        continue;
      }

      for (const language of DASHBOARD_LANGUAGES) {
        if (!isWordedInDashboardLocale(sentence, language)) {
          missing.push(`${language}: ${sentence}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
