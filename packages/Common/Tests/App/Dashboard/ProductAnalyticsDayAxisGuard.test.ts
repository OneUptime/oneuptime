// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * PRODUCT ANALYTICS CHARTS ITS DAYS ON A DAY AXIS (issue #6564).
 *
 * The Users, Sessions and Events pages chart one point a day through
 * ChartCard, from series toProductAnalyticsSeries builds. Left to the
 * window's length, ChartCard's axis guessed its step: an application counted
 * for two days read "07 Nov, 00:00" under its charts, and a long range
 * averaged days into weeks or months. Each such page now hands its cards
 * xAxisPrecision={XAxisPrecision.EVERY_DAY}.
 *
 * This guard holds every Dashboard page that builds day series to it, so a
 * new Product Analytics page (or a new chart on one) gets a day axis too.
 * It reads real syntax (the TypeScript AST), pinned on snippets first.
 */

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

interface ChartCardSite {
  line: number;
  isDayAxis: boolean;
}

interface DayChartFile {
  buildsDaySeries: boolean;
  cards: Array<ChartCardSite>;
}

function readDayCharts(fileName: string, source: string): DayChartFile {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const result: DayChartFile = { buildsDaySeries: false, cards: [] };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "toProductAnalyticsSeries"
    ) {
      result.buildsDaySeries = true;
    }

    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sourceFile) === "ChartCard"
    ) {
      let isDayAxis: boolean = false;

      for (const property of node.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "xAxisPrecision" &&
          property.initializer &&
          ts.isJsxExpression(property.initializer) &&
          property.initializer.expression &&
          property.initializer.expression.getText(sourceFile) ===
            "XAxisPrecision.EVERY_DAY"
        ) {
          isDayAxis = true;
        }
      }

      result.cards.push({
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        isDayAxis: isDayAxis,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return result;
}

function listTsxFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listTsxFiles(fullPath));
      }
      continue;
    }

    if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

describe("the detector", () => {
  test("a page building day series with a card that guesses its axis", () => {
    const read: DayChartFile = readDayCharts(
      "Fixture.tsx",
      [
        "const series = toProductAnalyticsSeries({ days, timeZone, series: [] });",
        "const a = (",
        '  <ChartCard title="Active users" series={series} />',
        ");",
      ].join("\n"),
    );

    expect(read.buildsDaySeries).toBe(true);
    expect(read.cards).toEqual([{ line: 3, isDayAxis: false }]);
  });

  test("a card handed the day step", () => {
    const read: DayChartFile = readDayCharts(
      "Fixture.tsx",
      [
        "const series = toProductAnalyticsSeries({ days, timeZone, series: [] });",
        "const a = (",
        "  <ChartCard",
        '    title="Active users"',
        "    xAxisPrecision={XAxisPrecision.EVERY_DAY}",
        "  />",
        ");",
      ].join("\n"),
    );

    expect(read.cards).toEqual([{ line: 3, isDayAxis: true }]);
  });

  test("another step, or one in a comment, is not the day step", () => {
    const read: DayChartFile = readDayCharts(
      "Fixture.tsx",
      [
        "// xAxisPrecision={XAxisPrecision.EVERY_DAY}",
        "const a = <ChartCard xAxisPrecision={XAxisPrecision.EVERY_HOUR} />;",
        "const b = <ChartCard title={'xAxisPrecision={XAxisPrecision.EVERY_DAY}'} />;",
      ].join("\n"),
    );

    expect(read.buildsDaySeries).toBe(false);
    expect(read.cards).toEqual([
      { line: 2, isDayAxis: false },
      { line: 3, isDayAxis: false },
    ]);
  });
});

describe("every Dashboard page that charts Product Analytics' days", () => {
  const pages: Array<{ file: string; read: DayChartFile }> = listTsxFiles(
    DASHBOARD_SOURCE,
  )
    .map((file: string) => {
      return { file: file, source: fs.readFileSync(file, "utf8") };
    })
    .filter((page: { source: string }): boolean => {
      // Only a file that names the day series' builder can call it.
      return page.source.includes("toProductAnalyticsSeries");
    })
    .map((page: { file: string; source: string }) => {
      return {
        file: path
          .relative(DASHBOARD_SOURCE, page.file)
          .split(path.sep)
          .join("/"),
        read: readDayCharts(page.file, page.source),
      };
    })
    .filter((page: { read: DayChartFile }): boolean => {
      return page.read.buildsDaySeries;
    });

  test("the walk found the Users, Sessions and Events pages", () => {
    const files: Array<string> = pages.map((page: { file: string }) => {
      return page.file;
    });

    for (const page of [
      "Pages/Rum/View/ProductAnalyticsUsers.tsx",
      "Pages/Rum/View/ProductAnalyticsSessions.tsx",
      "Pages/Rum/View/ProductAnalyticsEvents.tsx",
    ]) {
      expect(files).toContain(page);
    }
  });

  test("each draws its days on cards with a day axis", () => {
    const cards: Array<string> = [];
    const missing: Array<string> = [];

    for (const page of pages) {
      for (const card of page.read.cards) {
        cards.push(`${page.file}:${card.line}`);

        if (!card.isDayAxis) {
          missing.push(`${page.file}:${card.line}`);
        }
      }
    }

    // Active users, New and returning users; Sessions by device; Events and users.
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(missing).toEqual([]);
  });
});
