// UX rule: Docs/ux/README.md#what-never-to-write
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO WIDGET WRITES ITS OWN "CLICK TO ..." (issue #7160).
 *
 * A dashboard widget is drawn on the board being edited, in its settings
 * dialog's Live Preview, on a board out of edit mode, on a public
 * dashboard and in a playlist - and a click on it opens its settings in
 * the first place only. A widget that wrote "Click to configure metric"
 * itself said it everywhere. The setup lines are now one table, written
 * for each place (DashboardWidgetSetupCopy), and the few other words a
 * widget has about a click are each drawn only where the click works.
 *
 * This guard reads every text a widget writes (the TypeScript AST: string
 * and template literals and JSX text, never comments) and holds each that
 * asks for a click to that table, or to the short list below with where
 * it is drawn - so a new widget, or a new line on an old one, cannot ask
 * a reader for a click that does nothing. It is pinned on snippets first.
 */

const WIDGETS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
);

const SETUP_COPY_FILE: string = "DashboardWidgetSetupCopy.ts";

// A text that asks the reader for a click: "Click to ...", "click here".
const ASKS_FOR_A_CLICK: RegExp = /\bclick(?:ing)?\s+(?:to|here|it|on)\b/i;

/*
 * The other texts that ask for a click, each drawn only where the click
 * does what it says.
 */
const ALLOWED: ReadonlyArray<{ file: string; text: string; why: string }> = [
  {
    file: "DashboardResourceHoneycomb.tsx",
    text: "Click to open",
    why: "under a tile that opens its page; the Live Preview draws no such line, and its tiles open nothing (issue #6859)",
  },
  {
    file: "DashboardWidgetFallback.tsx",
    text: "Click it to edit or delete it.",
    why: "drawn only on the board being edited, never on a public dashboard",
  },
  {
    file: "DashboardWidgetZoomHint.tsx",
    text: " · double-click to reset",
    why: "names the double-click only while there is a zoom to undo, and nothing in edit mode",
  },
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

interface WrittenText {
  file: string;
  line: number;
  text: string;
}

// Every text a source file writes: its string and template literals and JSX text.
function writtenTexts(file: string, source: string): Array<WrittenText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const texts: Array<WrittenText> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let text: string | null = null;

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isJsxText(node) && node.text.trim()) {
      text = node.text.trim();
    }

    if (text !== null) {
      texts.push({
        file,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        text,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return texts;
}

function asksForAClick(text: WrittenText): boolean {
  return ASKS_FOR_A_CLICK.test(text.text);
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

describe("the reader of a widget's texts", () => {
  test("finds a click asked for in a string, a template and JSX text", () => {
    const found: Array<string> = writtenTexts(
      "Snippet.tsx",
      [
        'const a: string = "Click to configure metric";',
        "const b: string = `Click here to add ${what}.`;",
        "const c = <p>Click on a bar to see more</p>;",
      ].join("\n"),
    )
      .filter(asksForAClick)
      .map((text: WrittenText): string => {
        return text.text.trim();
      });

    expect(found).toEqual([
      "Click to configure metric",
      "Click here to add",
      "Click on a bar to see more",
    ]);
  });

  test("leaves comments, names and words that do not ask for a click", () => {
    const found: Array<WrittenText> = writtenTexts(
      "Snippet.tsx",
      [
        "// Click to configure metric, the old line.",
        "/* click here */",
        "const onClick = () => {};",
        'const d: string = "ClickHouse";',
        'const e: string = "Clicks per minute";',
        "const f = <button onClick={onClick}>Open</button>;",
      ].join("\n"),
    ).filter(asksForAClick);

    expect(found).toEqual([]);
  });
});

describe("no widget asks a reader for a click that does nothing", () => {
  test("the widgets folder is where the widgets are", () => {
    const files: Array<string> = widgetFiles();

    expect(files).toEqual(
      expect.arrayContaining([
        SETUP_COPY_FILE,
        "DashboardChartComponent.tsx",
        "DashboardValueComponent.tsx",
        "DashboardSloComponent.tsx",
        "DashboardProductAnalyticsWidget.tsx",
      ]),
    );
  });

  test("a widget's click is the setup table's, or one drawn only where it works", () => {
    const unexpected: Array<WrittenText> = [];
    const allowedFound: Set<string> = new Set<string>();

    for (const file of widgetFiles()) {
      if (path.basename(file) === SETUP_COPY_FILE) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(WIDGETS_DIR, file),
        "utf8",
      );

      for (const text of writtenTexts(file, source).filter(asksForAClick)) {
        const allowed: boolean = ALLOWED.some(
          (entry: { file: string; text: string }): boolean => {
            return entry.file === file && entry.text === text.text;
          },
        );

        if (allowed) {
          allowedFound.add(`${file}: ${text.text}`);
        } else {
          unexpected.push(text);
        }
      }
    }

    expect(unexpected).toEqual([]);

    // The list holds only what is still written: a line removed leaves it.
    expect(Array.from(allowedFound).sort()).toEqual(
      ALLOWED.map((entry: { file: string; text: string }): string => {
        return `${entry.file}: ${entry.text}`;
      }).sort(),
    );
  });

  test("the setup table asks for a click only on the board being edited", () => {
    const source: string = fs.readFileSync(
      path.join(WIDGETS_DIR, SETUP_COPY_FILE),
      "utf8",
    );
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      SETUP_COPY_FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const placesOfClicks: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      // A place's line: `[DashboardWidgetPlace.X]: translationKey("...")`.
      if (
        ts.isPropertyAssignment(node) &&
        ts.isComputedPropertyName(node.name) &&
        !ts.isObjectLiteralExpression(node.initializer) &&
        writtenTexts(
          SETUP_COPY_FILE,
          node.initializer.getText(sourceFile),
        ).some(asksForAClick)
      ) {
        placesOfClicks.push(node.name.expression.getText(sourceFile));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // A metric, a query, an SLO, a Table's column, a Trace Table's dimension.
    expect(placesOfClicks).toEqual([
      "DashboardWidgetPlace.EditedBoard",
      "DashboardWidgetPlace.EditedBoard",
      "DashboardWidgetPlace.EditedBoard",
      "DashboardWidgetPlace.EditedBoard",
      "DashboardWidgetPlace.EditedBoard",
    ]);
  });

  test.each([
    [
      "the Chart widget's",
      /Click here to add a (metric|aggregation)|a aggregation/,
      'setError("Please select a aggregation. Click here to add a aggregation.");',
    ],
    /*
     * The metric Table's and the Trace Table's (issue #7329): one line for
     * every place, in English - a reader's board told to add a column, and
     * a table stopped on an aggregation its picker already showed.
     */
    [
      "the metric Table's",
      /Add a metric column with a Metric Name|Pick an aggregation for your first metric column/,
      'setError(\n  "Pick an aggregation for your first metric column.",\n);',
    ],
    [
      "the Trace Table's",
      /dimension in the widget settings to populate this table/,
      'const line = <div>{t("Choose a “Group rows by” dimension in the widget settings to populate this table.")}</div>;',
    ],
  ])(
    "%s old lines are written nowhere in the Dashboard",
    (_widget: string, oldLine: RegExp, snippet: string) => {
      const dashboardSource: string = path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src",
      );
      const found: Array<string> = [];

      for (const entry of fs.readdirSync(dashboardSource, {
        recursive: true,
      })) {
        const file: string = entry.toString();

        if (!SOURCE_FILE.test(file)) {
          continue;
        }

        const source: string = fs.readFileSync(
          path.join(dashboardSource, file),
          "utf8",
        );

        // Only a file that holds the words anywhere is read as syntax.
        if (!oldLine.test(source)) {
          continue;
        }

        for (const text of writtenTexts(file, source)) {
          if (oldLine.test(text.text)) {
            found.push(`${file}:${text.line} ${text.text}`);
          }
        }
      }

      expect(found).toEqual([]);

      // And the reader finds them where they are written.
      expect(
        writtenTexts("Snippet.tsx", snippet).filter(
          (text: WrittenText): boolean => {
            return oldLine.test(text.text);
          },
        ).length,
      ).toBe(1);
    },
  );
});
