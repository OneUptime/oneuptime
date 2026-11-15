// UX rule: Docs/ux/README.md#empty-states-and-suggestions
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";

/*
 * A WIDGET THAT READ AND FOUND NOTHING SAYS SO IN THE SHARED LOOK (#8038).
 *
 * PR #7990 (#7329, #7330, #7331) gave a widget's "not set up yet" and
 * "something went wrong" states one look: the widget's icon in a soft
 * circle over a line in gray-500 (4.5:1 on white), centred and balanced.
 * The third state - it read, and the time range or the filters held
 * nothing - was left as each widget drew it: bare words in gray-400 (2.5:1
 * on white), with no icon, in the middle of the box
 * ("flex h-full items-center justify-center text-xs text-gray-400") or in
 * a padded block ("px-4 py-8 text-center text-gray-400 text-sm"). A Log
 * Chart that found nothing looked like no other widget on its board.
 *
 * Every widget draws that line through DashboardWidgetEmpty now: its icon
 * over the shared line, in the reader's words. A list or a table that
 * keeps its column headers draws a no-data row in the same readable gray
 * (DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME).
 *
 * This guard reads every widget's source as syntax (the TypeScript AST,
 * so a comment is no code) and fails on a class that draws the old pale
 * box - gray-400 centred in a box of its own (justify-center with h-full
 * or flex-1) or in a padded block (py-8) - and on a no-data sentence handed
 * to DashboardWidgetEmpty that a Dashboard language does not word. It is
 * pinned on snippets first.
 */

const DASHBOARD_COMPONENTS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components",
);

// The widgets, and the list base the infrastructure lists draw through.
const SOURCE_DIRS: ReadonlyArray<string> = [
  path.join(DASHBOARD_COMPONENTS, "Dashboard/Components"),
  path.join(DASHBOARD_COMPONENTS, "Infrastructure"),
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.test\.tsx?$/;

const CLASS_TOKEN_SPLIT: RegExp = /\s+/;

interface Finding {
  file: string;
  line: number;
  what: string;
}

// Whether a class names the old pale no-data box.
function isOldEmptyLook(classes: string): boolean {
  const tokens: Set<string> = new Set(
    classes.split(CLASS_TOKEN_SPLIT).filter(Boolean),
  );

  if (!tokens.has("text-gray-400")) {
    return false;
  }

  // Centred in a box of its own, filling the widget or its body.
  const centredInABox: boolean =
    tokens.has("justify-center") &&
    (tokens.has("h-full") || tokens.has("flex-1"));

  // A padded block or a table cell of its own, under a list's headers.
  const paddedBlock: boolean = tokens.has("py-8");

  return centredInABox || paddedBlock;
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

function isText(
  node: ts.Node,
): node is
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

// Each class in a source that draws the old pale no-data box.
function oldEmptyLooks(file: string, source: string): Array<Finding> {
  const sourceFile: ts.SourceFile = parse(file, source);
  const found: Array<Finding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (isText(node) && isOldEmptyLook(node.text)) {
      found.push({
        file,
        line: lineOf(sourceFile, node),
        what: `draws a no-data line in the old pale look: ${node.text.trim()}`,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/*
 * Each sentence a source hands DashboardWidgetEmpty as written:
 * message="..." or message={"..."}. One held in a constant or a prop - a
 * list widget's emptyMessage, which the list base hands on - is read where
 * it is written.
 */
function emptySentences(file: string, source: string): Array<string> {
  const sourceFile: ts.SourceFile = parse(file, source);
  const sentences: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "DashboardWidgetEmpty"
    ) {
      for (const property of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(property) ||
          property.name.getText(sourceFile) !== "message" ||
          !property.initializer
        ) {
          continue;
        }

        const initializer: ts.JsxAttributeValue = property.initializer;

        if (ts.isStringLiteral(initializer)) {
          sentences.push(initializer.text);
        } else if (
          ts.isJsxExpression(initializer) &&
          initializer.expression &&
          (ts.isStringLiteral(initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(initializer.expression))
        ) {
          sentences.push(initializer.expression.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sentences;
}

function sourceFiles(): Array<string> {
  return SOURCE_DIRS.flatMap((directory: string): Array<string> => {
    return fs
      .readdirSync(directory, { recursive: true })
      .map((entry: string | Buffer): string => {
        return path.join(directory, entry.toString());
      })
      .filter((entry: string): boolean => {
        return SOURCE_FILE.test(entry) && !TEST_FILE.test(entry);
      });
  }).sort();
}

function relative(file: string): string {
  return path.relative(DASHBOARD_COMPONENTS, file);
}

function readSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("the reader of a widget's no-data line", () => {
  test("finds the old pale box: centred in a box of its own, or a padded block", () => {
    const found: Array<string> = oldEmptyLooks(
      "Snippet.tsx",
      [
        'const a = <div className="flex h-full items-center justify-center text-xs text-gray-400">x</div>;',
        'const b = <div className="flex-1 flex items-center justify-center text-gray-400">x</div>;',
        'const c = <td className="px-4 py-8 text-center text-gray-400 text-sm">x</td>;',
        "const d = <div className={`h-full justify-center ${x} text-gray-400`}>x</div>;",
      ].join("\n"),
    ).map((finding: Finding): string => {
      return `${finding.line} ${finding.what}`;
    });

    expect(found).toEqual([
      "1 draws a no-data line in the old pale look: flex h-full items-center justify-center text-xs text-gray-400",
      "2 draws a no-data line in the old pale look: flex-1 flex items-center justify-center text-gray-400",
      "3 draws a no-data line in the old pale look: px-4 py-8 text-center text-gray-400 text-sm",
    ]);
  });

  test("leaves the readable look, a quiet label, a header and a comment alone", () => {
    expect(
      oldEmptyLooks(
        "Snippet.tsx",
        [
          'const a = <div className="flex h-full items-center justify-center text-xs text-gray-500">x</div>;',
          'const b = <td className="px-4 py-8 text-center text-sm text-gray-500">x</td>;',
          // A tile's quiet label, centred on its own line: no box of its own.
          'const c = <div className="flex w-full justify-center text-[11px] font-medium text-gray-400 uppercase">x</div>;',
          'const d = <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0">x</thead>;',
          'const e = <span className="text-gray-400">x</span>;',
          '// <div className="flex h-full justify-center text-gray-400">x</div>',
          'const f = <div className="h-full justify-center text-gray-400x">x</div>;',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("finds each sentence handed to DashboardWidgetEmpty as written, and no other", () => {
    expect(
      emptySentences(
        "Snippet.tsx",
        [
          'const a = <DashboardWidgetEmpty icon={IconProp.Logs} message="No logs found" />;',
          'const b = <DashboardWidgetEmpty icon={IconProp.Logs} message={"No rows returned."} />;',
          "const c = <DashboardWidgetEmpty icon={IconProp.Logs} message={`No data`} />;",
          "const d = <DashboardWidgetEmpty icon={props.emptyIcon} message={props.emptyMessage} />;",
          'const e = <WidgetPlaceholder icon={IconProp.Logs} message="Not this one" />;',
          'const f = <DashboardModelResourceListBase emptyMessage="A list\'s own" />;',
        ].join("\n"),
      ),
    ).toEqual(["No logs found", "No rows returned.", "No data"]);
  });

  test("the shared no-data line is the setup and error lines' readable look", () => {
    expect(DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME).toBe(
      DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
    );

    for (const classes of [
      DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME,
      DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME,
      DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME,
    ]) {
      const tokens: Array<string> = classes.split(CLASS_TOKEN_SPLIT);

      expect({ classes, readable: tokens.includes("text-gray-500") }).toEqual({
        classes,
        readable: true,
      });
      expect({ classes, pale: tokens.includes("text-gray-400") }).toEqual({
        classes,
        pale: false,
      });
      expect(isOldEmptyLook(classes)).toBe(false);
    }
  });
});

describe("every widget draws its no-data line in the shared look", () => {
  test("the folders are where the widgets are", () => {
    expect(sourceFiles().map(relative)).toEqual(
      expect.arrayContaining([
        "Dashboard/Components/DashboardWidgetEmpty.tsx",
        "Dashboard/Components/DashboardLogChartComponent.tsx",
        "Dashboard/Components/DashboardResourceListBase.tsx",
        "Infrastructure/DashboardModelResourceListBase.tsx",
      ]),
    );
  });

  test("no widget draws a no-data line in the old pale look", () => {
    const found: Array<string> = [];

    for (const file of sourceFiles()) {
      for (const finding of oldEmptyLooks(relative(file), readSource(file))) {
        found.push(`${finding.file}:${finding.line} ${finding.what}`);
      }
    }

    expect(found).toEqual([]);
  });

  /*
   * The widgets whose no-data line was the old pale box, each now drawing
   * the shared state with its own icon (the one its error shows).
   */
  test.each([
    ["Dashboard/Components/DashboardLogChartComponent.tsx", "Logs"],
    ["Dashboard/Components/DashboardTraceChartComponent.tsx", "Waterfall"],
    ["Dashboard/Components/DashboardTraceTableComponent.tsx", "Waterfall"],
    [
      "Dashboard/Components/DashboardSecurityEventsFlowComponent.tsx",
      "ShieldExclamation",
    ],
    [
      "Dashboard/Components/DashboardDataSourceTableComponent.tsx",
      "TableCells",
    ],
    ["Dashboard/Components/DashboardLogStreamComponent.tsx", "List"],
    ["Dashboard/Components/DashboardNetworkMapComponent.tsx", "Map"],
  ])(
    "%s draws its no-data line under its %s icon",
    (file: string, icon: string) => {
      const source: string = readSource(path.join(DASHBOARD_COMPONENTS, file));

      expect(source).toMatch(
        new RegExp(
          `<DashboardWidgetEmpty\\s+icon=\\{IconProp\\.${icon}\\}\\s+message=`,
        ),
      );
      // Its error is under the same icon: one widget, one icon, in each state.
      expect(source).toMatch(
        new RegExp(`<DashboardWidgetError\\s+icon=\\{IconProp\\.${icon}\\}`),
      );
    },
  );

  /*
   * The Network Map's line is held in a constant, which the extractor
   * reads only when it is marked: unmarked, it read English on every
   * board, in the map and in the list alike.
   */
  test("the Network Map's no-data line is a key, worded in every Dashboard language", () => {
    const source: string = readSource(
      path.join(
        DASHBOARD_COMPONENTS,
        "Dashboard/Components/DashboardNetworkMapComponent.tsx",
      ),
    );
    const sentence: string | undefined = source.match(
      /const EMPTY_MESSAGE: string = translationKey\(\s*"([^"]+)",?\s*\)/,
    )?.[1];

    expect(sentence).toMatch(/^No network sites with coordinates\./);
    expect(readDashboardLocale("en")[sentence as string]).toBe(sentence);

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        worded: isWordedInDashboardLocale(sentence as string, language),
      }).toEqual({ language, worded: true });
    }
  });

  test("a list in honeycomb view draws its no-data line under its own icon, and in list view a readable row", () => {
    const source: string = readSource(
      path.join(
        DASHBOARD_COMPONENTS,
        "Dashboard/Components/DashboardResourceListBase.tsx",
      ),
    );

    expect(source).toContain(
      "<DashboardWidgetEmpty\n              icon={props.emptyIcon}\n              message={props.emptyMessage}",
    );
    expect(source).toContain(
      "className={DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME}",
    );
  });

  test("every sentence a widget hands the no-data line is worded in every Dashboard language", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const sentences: Set<string> = new Set<string>();

    for (const file of sourceFiles()) {
      for (const sentence of emptySentences(relative(file), readSource(file))) {
        sentences.add(sentence);
      }
    }

    // The widgets do hand sentences: the reader is reading them.
    expect(Array.from(sentences)).toEqual(
      expect.arrayContaining([
        "No logs for the selected time range and filters",
        "No data for the selected time range",
        "No security events for the selected time range and filters",
        "No rows returned.",
        "No logs found",
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
