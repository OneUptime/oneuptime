// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
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
 * A CHART'S VALUE AXIS AND ITS TOOLTIP WRITE A FIGURE AS THE TILES BESIDE
 * THEM DO (#8349).
 *
 * On a Persian page a chart's time axis was in Persian digits and the tile
 * above it said "۴۲ میلی‌ثانیه", while the chart's value axis and tooltip
 * said "42 ms": the trace charts, the service, serverless and RUM p95
 * charts, a database's engine charts, a queue's, OpenStack's, the Meraki
 * uplinks', the service map's edges each wrote their figures in English on
 * purpose, through formatMillisecondsInEnglish or toFixed, and a metric
 * chart wrote "23,5 Celsius" in German (#8284). The rule is one now
 * (Docs/ux/README.md#numbers-dates-and-plurals): a value axis, its legend
 * and its tooltip are in the reader's digits, decimal sign and percent
 * sign, a duration in their words and any other unit by its symbol, and
 * the axis is as wide as its widest tick.
 *
 * This reads every frontend's source through the TypeScript AST (comments
 * are no code), and fails on:
 *
 *   - formatMillisecondsInEnglish anywhere but its own module, the
 *     Dashboard's re-export and the AI chat's PDF export, whose Latin-1 font
 *     holds no Persian digit (ENGLISH_ON_PURPOSE);
 *   - a chart's value formatter that writes its figure as English does. A
 *     value formatter is what a value axis or a chart's tooltip writes with:
 *     recharts' <YAxis tickFormatter> and <Tooltip formatter>, a chart
 *     card's yFormatter, a histogram's valueFormatter or
 *     histogramValueFormatter, and a shared chart's yAxis.options.formatter.
 *     It writes English when its own code calls toFixed, toPrecision or
 *     toString, String(), toLocaleString with no locale,
 *     ValueFormatter.formatValue with no language, or puts a bare figure in
 *     a template ("`${Math.round(value)}`"). The formatter is read where it
 *     is written - inline, or the function or const of the same file it
 *     names; one another module exports is that module's, held by its own
 *     tests;
 *   - a metric chart that draws a query's yAxisValueFormatter as it comes.
 *     That formatter is a page's own figure in English - "1.5 GiB" from
 *     KubernetesResourceUtils.formatBytesForChart and forty more - and the
 *     chart writes it in the reader's digits (writeFigureInLanguage, #8428).
 *
 * A file still to write its charts' figures in the reader's language is
 * listed in STILL_IN_ENGLISH with the issue that takes it, and the list only
 * shrinks: a listed file that no longer writes a chart's figure in English
 * fails until it is taken off. It is empty: keep it so.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

/*
 * Where formatMillisecondsInEnglish may be named: its module, the
 * Dashboard's re-export of it, and the PDF export.
 */
export const ENGLISH_ON_PURPOSE: Readonly<Record<string, string>> = {
  "packages/Common/Utils/Milliseconds.ts": "Where it is written.",
  "packages/App/FeatureSet/Dashboard/src/Utils/Milliseconds.ts":
    "The Dashboard's re-export of Common's helpers.",
  "packages/App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfWidgets.ts":
    "The AI chat's PDF export: written in Latin-1, which holds no Persian digit.",
};

/*
 * Files whose charts still write a figure on their value axis in English,
 * each with the issue that puts it in the reader's language. Only shrinks;
 * the resource pages' rate and availability charts came off with #8428.
 */
export const STILL_IN_ENGLISH: Readonly<Record<string, string>> = {};

// The metric chart, which draws every query's own figure.
const METRIC_CHARTS_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx";

// The props a chart writes its value axis or its tooltip with.
const VALUE_FORMATTER_ATTRIBUTES: ReadonlyArray<string> = [
  "yFormatter",
  "valueFormatter",
  "histogramValueFormatter",
];

// The recharts elements whose formatter is a value's: the value axis, the tooltip.
const RECHARTS_VALUE_FORMATTERS: Readonly<Record<string, string>> = {
  YAxis: "tickFormatter",
  Tooltip: "formatter",
};

// Calls on a figure that write it as English does.
const ENGLISH_FIGURE_METHODS: ReadonlyArray<string> = [
  "toFixed",
  "toPrecision",
  "toString",
];

export interface EnglishFigure {
  file: string;
  line: number;
  formatter: string;
  why: string;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

// The functions and consts a file declares, by name, for a formatter that names one.
function collectLocalDeclarations(
  sourceFile: ts.SourceFile,
): Map<string, ts.Node> {
  const declarations: Map<string, ts.Node> = new Map<string, ts.Node>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.set(node.name.text, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return declarations;
}

/*
 * Why `node` writes a figure as English does, or undefined: a figure's
 * toFixed, toPrecision or toString, String(), toLocaleString with no
 * locale, ValueFormatter.formatValue with no language, a bare figure in a
 * template.
 */
export function getEnglishFigureReason(node: ts.Node): string | undefined {
  if (ts.isCallExpression(node)) {
    const callee: ts.Expression = node.expression;

    if (ts.isPropertyAccessExpression(callee)) {
      const method: string = callee.name.text;

      if (ENGLISH_FIGURE_METHODS.includes(method)) {
        return `${method}() writes Latin digits and a point`;
      }

      if (method === "toLocaleString" && node.arguments.length === 0) {
        return "toLocaleString() follows the browser, not the page";
      }

      if (
        method === "formatValue" &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "ValueFormatter"
      ) {
        const options: ts.Expression | undefined = node.arguments[2];

        if (!options) {
          return "ValueFormatter.formatValue with no language writes English";
        }

        if (
          ts.isObjectLiteralExpression(options) &&
          !options.properties.some(
            (property: ts.ObjectLiteralElementLike): boolean => {
              return (
                ts.isSpreadAssignment(property) ||
                (property.name !== undefined &&
                  getPropertyName(property.name) === "language")
              );
            },
          )
        ) {
          return "ValueFormatter.formatValue with no language writes English";
        }
      }
    }

    if (ts.isIdentifier(callee) && callee.text === "String") {
      return "String() writes Latin digits and a point";
    }
  }

  if (ts.isTemplateExpression(node)) {
    for (const span of node.templateSpans) {
      if (isBareFigure(span.expression)) {
        return "a bare figure in a template is written as English writes it";
      }
    }
  }

  return undefined;
}

// A number put in a template as it is: a name, a field, Math.round(x), Number(x).
function isBareFigure(expression: ts.Expression): boolean {
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isNumericLiteral(expression)
  ) {
    return true;
  }

  if (ts.isParenthesizedExpression(expression)) {
    return isBareFigure(expression.expression);
  }

  if (ts.isBinaryExpression(expression)) {
    return ["+", "-", "*", "/"].includes(
      ts.tokenToString(expression.operatorToken.kind) || "",
    )
      ? isBareFigure(expression.left) || isBareFigure(expression.right)
      : false;
  }

  if (ts.isCallExpression(expression)) {
    const callee: ts.Expression = expression.expression;

    return (
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Math") ||
      (ts.isIdentifier(callee) && callee.text === "Number")
    );
  }

  return false;
}

/*
 * The functions a formatter expression stands for, in this file: an arrow
 * or a function inline, a name this file declares, either side of a ? : or
 * an ||. One another module exports is that module's.
 */
function resolveFormatter(
  expression: ts.Expression,
  declarations: Map<string, ts.Node>,
  seen: Set<ts.Node> = new Set<ts.Node>(),
): Array<ts.Node> {
  if (seen.has(expression)) {
    return [];
  }
  seen.add(expression);

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return [expression];
  }

  if (ts.isParenthesizedExpression(expression)) {
    return resolveFormatter(expression.expression, declarations, seen);
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...resolveFormatter(expression.whenTrue, declarations, seen),
      ...resolveFormatter(expression.whenFalse, declarations, seen),
    ];
  }

  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...resolveFormatter(expression.left, declarations, seen),
      ...resolveFormatter(expression.right, declarations, seen),
    ];
  }

  if (ts.isIdentifier(expression)) {
    const declaration: ts.Node | undefined = declarations.get(expression.text);

    if (!declaration) {
      return [];
    }

    if (ts.isFunctionDeclaration(declaration)) {
      return [declaration];
    }

    if (ts.isExpression(declaration as ts.Expression)) {
      return resolveFormatter(declaration as ts.Expression, declarations, seen);
    }
  }

  return [];
}

// What a formatter's own code writes as English, with the line it is on.
function findEnglishFiguresIn(
  sourceFile: ts.SourceFile,
  formatter: ts.Node,
): Array<{ line: number; why: string }> {
  const found: Array<{ line: number; why: string }> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const why: string | undefined = getEnglishFigureReason(node);

    if (why) {
      found.push({ line: lineOf(sourceFile, node), why: why });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(formatter, visit);

  return found;
}

// A variable a chart's value axis is kept in: yAxis, latencyYAxis.
const Y_AXIS_NAME: RegExp = /yAxis$/i;

// Whether an object literal is the `options` of a chart's `yAxis`.
function isYAxisOptions(object: ts.ObjectLiteralExpression): boolean {
  const optionsProperty: ts.Node = object.parent;

  if (
    !ts.isPropertyAssignment(optionsProperty) ||
    getPropertyName(optionsProperty.name) !== "options"
  ) {
    return false;
  }

  const yAxisObject: ts.Node = optionsProperty.parent;

  if (!ts.isObjectLiteralExpression(yAxisObject)) {
    return false;
  }

  const yAxisProperty: ts.Node = yAxisObject.parent;

  if (
    ts.isPropertyAssignment(yAxisProperty) &&
    getPropertyName(yAxisProperty.name) === "yAxis"
  ) {
    return true;
  }

  // const yAxis: YAxis = { legend, options: { formatter } }
  return (
    ts.isVariableDeclaration(yAxisProperty) &&
    ts.isIdentifier(yAxisProperty.name) &&
    Y_AXIS_NAME.test(yAxisProperty.name.text)
  );
}

// Every chart value formatter a file writes, with its name for a message.
function findValueFormatters(
  sourceFile: ts.SourceFile,
): Array<{ name: string; expression: ts.Expression }> {
  const formatters: Array<{ name: string; expression: ts.Expression }> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const attribute: string = node.name.getText(sourceFile);
      const element: ts.Node = node.parent.parent;
      const tag: string =
        ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
          ? element.tagName.getText(sourceFile)
          : "";

      if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        (VALUE_FORMATTER_ATTRIBUTES.includes(attribute) ||
          RECHARTS_VALUE_FORMATTERS[tag] === attribute)
      ) {
        formatters.push({
          name: `<${tag} ${attribute}>`,
          expression: node.initializer.expression,
        });
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const property: string | undefined = getPropertyName(node.name);

      // A query's yAxisValueFormatter is English: the metric chart words it.
      if (
        property === "formatter" &&
        ts.isObjectLiteralExpression(node.parent) &&
        isYAxisOptions(node.parent)
      ) {
        formatters.push({
          name: "yAxis.options.formatter",
          expression: node.initializer,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return formatters;
}

// What one file's charts write in English, and where.
export function findEnglishChartFigures(
  relativePath: string,
  source: string,
): Array<EnglishFigure> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const declarations: Map<string, ts.Node> =
    collectLocalDeclarations(sourceFile);
  const found: Array<EnglishFigure> = [];
  const reported: Set<string> = new Set<string>();

  for (const formatter of findValueFormatters(sourceFile)) {
    for (const body of resolveFormatter(formatter.expression, declarations)) {
      for (const english of findEnglishFiguresIn(sourceFile, body)) {
        const key: string = `${english.line}|${english.why}`;

        if (!reported.has(key)) {
          reported.add(key);
          found.push({
            file: relativePath,
            line: english.line,
            formatter: formatter.name,
            why: english.why,
          });
        }
      }
    }
  }

  return found;
}

// Where one file names formatMillisecondsInEnglish, in its code.
export function findEnglishMilliseconds(
  relativePath: string,
  source: string,
): Array<number> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Array<number> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "formatMillisecondsInEnglish") {
      lines.push(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return lines;
}

interface ScannedFile {
  relativePath: string;
  source: string;
}

function scanFrontends(): Array<ScannedFile> {
  const files: Array<ScannedFile> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      files.push({
        relativePath: toRelativePath(REPOSITORY_ROOT, file),
        source: fs.readFileSync(file, "utf8"),
      });
    }
  }

  return files;
}

describe("a chart's value axis and tooltip write a figure as the tiles beside them do", () => {
  const files: Array<ScannedFile> = scanFrontends();

  test("the scan reads every frontend, the Dashboard's charts among them", () => {
    const paths: Array<string> = files.map((file: ScannedFile): string => {
      return file.relativePath;
    });

    expect(paths.length).toBeGreaterThan(1000);
    expect(paths).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent.tsx",
    );
    expect(paths).toContain(
      "packages/Common/UI/Components/TelemetryViewer/components/TelemetryHistogram.tsx",
    );
    expect(paths).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx",
    );
  });

  test("formatMillisecondsInEnglish is named only where English is on purpose: the PDF export", () => {
    const misplaced: Array<string> = [];

    for (const file of files) {
      if (ENGLISH_ON_PURPOSE[file.relativePath]) {
        continue;
      }

      for (const line of findEnglishMilliseconds(
        file.relativePath,
        file.source,
      )) {
        misplaced.push(`${file.relativePath}:${line}`);
      }
    }

    expect(misplaced).toEqual([]);
  });

  test("every file kept English on purpose still is: the list only shrinks", () => {
    for (const file of Object.keys(ENGLISH_ON_PURPOSE)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file: file,
        names: findEnglishMilliseconds(file, source).length > 0,
      }).toEqual({ file: file, names: true });
    }
  });

  test("no chart's value formatter writes its figure as English does", () => {
    const english: Array<string> = [];

    for (const file of files) {
      if (STILL_IN_ENGLISH[file.relativePath]) {
        continue;
      }

      for (const figure of findEnglishChartFigures(
        file.relativePath,
        file.source,
      )) {
        english.push(
          `${figure.file}:${figure.line} (${figure.formatter}): ${figure.why}`,
        );
      }
    }

    expect(english).toEqual([]);
  });

  test("a file still in English still is: the list only shrinks", () => {
    for (const file of Object.keys(STILL_IN_ENGLISH)) {
      const scanned: ScannedFile | undefined = files.find(
        (candidate: ScannedFile): boolean => {
          return candidate.relativePath === file;
        },
      );

      expect({
        file: file,
        stillInEnglish:
          scanned !== undefined &&
          findEnglishChartFigures(scanned.relativePath, scanned.source).length >
            0,
      }).toEqual({ file: file, stillInEnglish: true });
    }
  });

  /*
   * A query's yAxisValueFormatter writes English - a page's shared
   * formatter, KubernetesResourceUtils.formatBytesForChart and forty more -
   * and the metric chart words it in the reader's digits wherever it draws
   * it: its value axes and its series list (#8428). Every query is written
   * through one formatter (getMemberValueFormatter), which each value axis -
   * the second one too (#10042) - and the series list draw with.
   */
  test("the metric chart writes a query's own figure in the reader's digits", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, METRIC_CHARTS_FILE),
      "utf8",
    );
    const drawn: Array<string> =
      source.match(/[^\n]*\n[^\n]*\.yAxisValueFormatter\(value\)/g) || [];

    expect(drawn.length).toBeGreaterThanOrEqual(1);

    for (const call of drawn) {
      expect(call).toContain("writeFigureInLanguage(");
    }

    // Both value axes and the series list draw through it.
    expect(source).toContain(
      "getMemberValueFormatter(firstMember, translator.language)",
    );
    expect(source).toContain(
      "getMemberValueFormatter(secondAxisLead, translator.language)",
    );
    expect(source).toContain("formatter: firstAxisValueFormatter,");
    expect(source).toContain("formatter: secondAxisValueFormatter,");
    expect(source).toContain("getMemberAxisValueFormatter(owner)");
  });
});

describe("negative controls: the scan catches what it is for", () => {
  test("formatMillisecondsInEnglish named on a chart", () => {
    expect(
      findEnglishMilliseconds(
        "packages/App/FeatureSet/Dashboard/src/Pages/X.tsx",
        'import { formatMillisecondsInEnglish } from "../Utils/Milliseconds";\nconst f = (v: number): string => formatMillisecondsInEnglish(v);\n// formatMillisecondsInEnglish in a comment is no code',
      ),
    ).toEqual([1, 2]);
  });

  test("a recharts value axis and tooltip written with toFixed, String() or a bare figure", () => {
    const found: Array<EnglishFigure> = findEnglishChartFigures(
      "x.tsx",
      [
        "const formatTick = (v: number): string => `${v.toFixed(1)} ms`;",
        "const Chart = () => (",
        "  <LineChart>",
        "    <YAxis tickFormatter={formatTick} />",
        "    <Tooltip formatter={(v: number): string => String(v)} />",
        "    <XAxis tickFormatter={(v: number): string => String(v)} />",
        "  </LineChart>",
        ");",
      ].join("\n"),
    );

    expect(
      found.map((figure: EnglishFigure): string => {
        return `${figure.line} ${figure.formatter}`;
      }),
    ).toEqual(["1 <YAxis tickFormatter>", "5 <Tooltip formatter>"]);
  });

  test("a chart card's yFormatter and a shared chart's yAxis.options.formatter; a query's English override is the chart's to word", () => {
    const found: Array<EnglishFigure> = findEnglishChartFigures(
      "x.tsx",
      [
        "const a = <ChartCard yFormatter={(n: number) => `${Math.round(n)}`} />;",
        "const chart = { yAxis: { legend: '', options: { formatter: (v: number) => ValueFormatter.formatValue(v, 'By/s') } } };",
        "const query = { yAxisValueFormatter: (v: number) => ValueFormatter.formatValue(v, 'By', { metricName: 'x' }) };",
        "const latencyYAxis: YAxis = { legend: '', options: { formatter: (v: number) => v.toString() } };",
        "const h = <TelemetryHistogram valueFormatter={(v: number) => v.toLocaleString()} />;",
      ].join("\n"),
    );

    expect(
      found.map((figure: EnglishFigure): string => {
        return `${figure.line} ${figure.formatter}`;
      }),
    ).toEqual([
      "1 <ChartCard yFormatter>",
      "2 yAxis.options.formatter",
      "4 yAxis.options.formatter",
      "5 <TelemetryHistogram valueFormatter>",
    ]);
  });

  test("a formatter named by a const or a function of the file, on either side of ? : or ||", () => {
    const found: Array<EnglishFigure> = findEnglishChartFigures(
      "x.tsx",
      [
        "function formatCount(v: number): string { return `${(v / 1000).toFixed(1)}K`; }",
        "const formatDuration = (v: number): string => formatMilliseconds(t, v);",
        "const pick = isDuration ? formatDuration : formatCount;",
        "const a = <YAxis tickFormatter={pick} />;",
        "const b = <TelemetryHistogram valueFormatter={props.valueFormatter || formatCount} />;",
      ].join("\n"),
    );

    expect(
      found.map((figure: EnglishFigure): string => {
        return `${figure.line} ${figure.formatter}`;
      }),
    ).toEqual(["1 <YAxis tickFormatter>"]);
  });

  test("what writes the reader's figure is left alone", () => {
    expect(
      findEnglishChartFigures(
        "x.tsx",
        [
          "const a = <YAxis tickFormatter={(v: number) => formatDurationMsInLanguage(v, translator)} />;",
          "const b = <ChartCard yFormatter={(v: number) => translator.formatNumber(Math.round(v))} />;",
          "const c = { yAxis: { options: { formatter: (v: number) => ValueFormatter.formatValue(v, unit, { metricName: m, language: translator.language }) } } };",
          "const d = { yAxis: { options: { formatter: (v: number) => ValueFormatter.formatValue(v, unit, formatterOptions) } } };",
          "const e = { yAxis: { options: { formatter: (v: number) => `${formatOpenStackChartBytes(v)}/s` } } };",
          "const f = <Tooltip formatter={(v: number) => v.toLocaleString(getReaderNumberLocale())} />;",
          "const g = { yAxisValueFormatter: KubernetesResourceUtils.formatBytesForChart };",
          "const h = { options: { formatter: (v: number) => v.toFixed(1) } };",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("each reason a figure reads as English", () => {
    const reasonOf: (code: string) => string | undefined = (
      code: string,
    ): string | undefined => {
      const sourceFile: ts.SourceFile = ts.createSourceFile(
        "x.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
      );
      const statement: ts.Statement = sourceFile.statements[0]!;
      const expression: ts.Expression = (statement as ts.ExpressionStatement)
        .expression;

      return getEnglishFigureReason(expression);
    };

    expect(reasonOf("v.toFixed(2)")).toContain("toFixed");
    expect(reasonOf("v.toPrecision(2)")).toContain("toPrecision");
    expect(reasonOf("v.toString()")).toContain("toString");
    expect(reasonOf("String(v)")).toContain("String()");
    expect(reasonOf("v.toLocaleString()")).toContain("browser");
    expect(reasonOf("ValueFormatter.formatValue(v, 'ms')")).toContain(
      "no language",
    );
    expect(reasonOf("`${v} req`")).toContain("bare figure");
    expect(reasonOf("`${Math.round(v * 100) / 100}/s`")).toContain(
      "bare figure",
    );
    expect(reasonOf("v.toLocaleString('de')")).toBeUndefined();
    expect(reasonOf("`${formatBytes(v)}/s`")).toBeUndefined();
    expect(
      reasonOf("ValueFormatter.formatValue(v, 'ms', { ...options })"),
    ).toBeUndefined();
  });
});
