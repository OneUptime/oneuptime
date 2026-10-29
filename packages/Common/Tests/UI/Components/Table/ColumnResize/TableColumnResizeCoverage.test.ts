import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "Please do this for all tables." - the maintainer, asking for columns a
 * person can drag wider or narrower. Every table a person reads in
 * OneUptime lets them size its columns: the shared Table (every ModelTable
 * and list), the logs list, every dashboard widget's table, and each table a
 * page draws itself (Table/ColumnResize's useResizableColumns, whose
 * tableAttributes the <table> carries).
 *
 * This sweep reads every <table> the frontends draw - through the
 * TypeScript AST, so a comment or a string naming one is not one - and
 * holds each to that, or to the list below of the tables left as they are,
 * each with why. A new table of records sizes its columns, or says here why
 * it does not; the list only shrinks: a table that goes, or starts sizing
 * its columns, must leave it.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../../..");

// Every frontend's source, and the enterprise pages they bundle.
const SOURCE_ROOTS: Array<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "ee/AdminDashboard",
  "ee/Dashboard",
];

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
]);

/*
 * A <table> whose columns a person sizes carries the scope its sized
 * columns' rules are written for: a page's own table spreads
 * useResizableColumns' tableAttributes on it, the shared Table writes the
 * attribute itself.
 */
const SIZES_ITS_COLUMNS: RegExp =
  /\btableAttributes\b|\bCOLUMN_WIDTHS_SCOPE_ATTRIBUTE\b/;

interface LeftOut {
  // How many of the file's tables are left as they are.
  tables: number;
  why: string;
}

/*
 * The tables left as they are. None is a list of records a person reads
 * down: a record's fields (a name and its value a row), a grid read across
 * and down whose cells are one width, a table of our own words (help, the
 * variables an install takes), a preview of a file before it is imported,
 * code, or a table someone wrote in Markdown.
 */
const LEFT_OUT: Record<string, LeftOut> = {
  "packages/Common/UI/Components/JSONTable/JSONTable.tsx": {
    tables: 1,
    why: "A record's fields, a name and its value a row: the names as wide as the longest, the values take the rest and wrap.",
  },
  "packages/Common/UI/Components/Markdown.tsx/MarkdownViewer.tsx": {
    tables: 1,
    why: "A table someone wrote in Markdown - a note, a runbook, an answer from AI: it reads as written, wrapping in its frame.",
  },
  "packages/Common/UI/Components/CSVFileUpload/CSVFileUpload.tsx": {
    tables: 1,
    why: "A preview of a file's first rows, before it is imported.",
  },
  "packages/Common/UI/Components/Charts/ChartGroup/ChartGroup.tsx": {
    tables: 1,
    why: "A chart's details in a dialog, a name and its value a row.",
  },
  "packages/Common/UI/Components/LabelRule/ImportLabelRulesModal.tsx": {
    tables: 1,
    why: "A preview of the rules a file holds, before they are imported.",
  },
  "packages/Common/UI/Components/LogsViewer/components/LogSearchHelp.tsx": {
    tables: 1,
    why: "Help: the search syntax, in our words, laid out for its panel.",
  },
  "packages/Common/UI/Components/TelemetryViewer/components/TelemetrySearchHelp.tsx":
    {
      tables: 1,
      why: "Help: the search syntax, in our words, laid out for its panel.",
    },
  "packages/Common/UI/Components/StatusPage/ResourceGrid.tsx": {
    tables: 1,
    why: "A status page's grid of resources, read across and down: every cell an uptime bar of one width, for visitors who never sign in.",
  },
  "packages/App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx": {
    tables: 1,
    why: "A status page's grid of resources, read across and down: every cell an uptime bar of one width, for visitors who never sign in.",
  },
  "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/StackFrameViewer.tsx":
    {
      tables: 2,
      why: "A stack trace's lines of code, and the source around a frame.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab.tsx":
    {
      tables: 1,
      why: "A resource's YAML, a line a row.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView.tsx":
    {
      tables: 1,
      why: "A check's readings, a metric and its value a row.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SqlMonitorView.tsx":
    {
      tables: 1,
      why: "The first row a query returned, a column's name and its value a row.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DomainMonitorView.tsx":
    {
      tables: 2,
      why: "Lists of one column - name servers, status codes - that fill their frame.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorTestReportView.tsx":
    {
      tables: 1,
      why: "A test's measures, a measure and its value a row (its sample records size their columns).",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/LatencyMatrixGrid.tsx":
    {
      tables: 1,
      why: "A matrix of latencies between sites, read across and down: every cell one width.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/CoverageMatrix.tsx":
    {
      tables: 1,
      why: "A matrix of the hours a policy covers, read across and down: every cell one width.",
    },
  "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings.tsx":
    {
      tables: 1,
      why: "A grid of switches, an event a row and a channel a column.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkSite/ImportSitesFromCsvModal.tsx":
    {
      tables: 2,
      why: "A preview of a file's sites before they are imported, and what the import did with each line.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/ImportGroupsFromCsvModal.tsx":
    {
      tables: 2,
      why: "A preview of a file's groups before they are imported, and what the import did with each line.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/HistoryChartBarColorPreview.tsx":
    {
      tables: 1,
      why: "A preview of a status page's bar colors.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariables.tsx":
    {
      tables: 1,
      why: "Help: the variables a template may use, in our words.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSetupGuide.tsx":
    {
      tables: 1,
      why: "Help: a setup guide's steps, in our words.",
    },
  "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage.tsx":
    {
      tables: 1,
      why: "The variables an AI agent's install takes, in our words, laid out for the install panel.",
    },
};

interface FoundTable {
  file: string;
  line: number;
  sizesItsColumns: boolean;
}

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSourceFiles(path.join(directory, entry.name)));
      }

      continue;
    }

    if (entry.name.endsWith(".tsx")) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
};

const findTables: (absolutePath: string) => Array<FoundTable> = (
  absolutePath: string,
): Array<FoundTable> => {
  const text: string = fs.readFileSync(absolutePath, "utf8");

  // Most files draw no table: the parse is for the ones that may.
  if (!text.includes("<table")) {
    return [];
  }

  const file: string = path
    .relative(REPOSITORY_ROOT, absolutePath)
    .split(path.sep)
    .join("/");
  const source: ts.SourceFile = ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const tables: Array<FoundTable> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "table"
    ) {
      const sizesItsColumns: boolean = node.attributes.properties.some(
        (attribute: ts.JsxAttributeLike): boolean => {
          return (
            ts.isJsxSpreadAttribute(attribute) &&
            SIZES_ITS_COLUMNS.test(attribute.expression.getText(source))
          );
        },
      );

      tables.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        sizesItsColumns: sizesItsColumns,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return tables;
};

const ALL_TABLES: Array<FoundTable> = SOURCE_ROOTS.flatMap(
  (root: string): Array<FoundTable> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root)).flatMap(
      findTables,
    );
  },
);

const countUnsized: (file: string) => number = (file: string): number => {
  return ALL_TABLES.filter((table: FoundTable): boolean => {
    return table.file === file && !table.sizesItsColumns;
  }).length;
};

describe("every table lets a person size its columns", () => {
  test("the sweep reads the tables it should", () => {
    const sizedFiles: Set<string> = new Set<string>(
      ALL_TABLES.filter((table: FoundTable): boolean => {
        return table.sizesItsColumns;
      }).map((table: FoundTable): string => {
        return table.file;
      }),
    );

    // The shared Table, the logs list, a widget's table, an admin page's.
    for (const file of [
      "packages/Common/UI/Components/Table/Table.tsx",
      "packages/Common/UI/Components/LogsViewer/components/LogsTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView.tsx",
      "ee/AdminDashboard/Health/QueryConsole.tsx",
    ]) {
      expect(sizedFiles).toContain(file);
    }

    expect(
      ALL_TABLES.filter((table: FoundTable): boolean => {
        return table.sizesItsColumns;
      }).length,
    ).toBeGreaterThanOrEqual(40);
  });

  test("each table sizes its columns, or is left as it is for a reason given here", () => {
    const unexplained: Array<string> = [];
    const files: Set<string> = new Set<string>(
      ALL_TABLES.map((table: FoundTable): string => {
        return table.file;
      }),
    );

    for (const file of files) {
      const unsized: number = countUnsized(file);

      if (unsized > 0 && unsized !== LEFT_OUT[file]?.tables) {
        unexplained.push(
          `${file}: ${unsized} table(s) whose columns cannot be sized (lines ${ALL_TABLES.filter(
            (table: FoundTable): boolean => {
              return table.file === file && !table.sizesItsColumns;
            },
          )
            .map((table: FoundTable): number => {
              return table.line;
            })
            .join(
              ", ",
            )}) - use useResizableColumns, or list it in LEFT_OUT with why`,
        );
      }
    }

    expect(unexplained).toEqual([]);
  });

  test("the list only names tables still left as they are", () => {
    const stale: Array<string> = Object.keys(LEFT_OUT).filter(
      (file: string): boolean => {
        return countUnsized(file) !== LEFT_OUT[file]?.tables;
      },
    );

    expect(stale).toEqual([]);
  });

  test("each table left as it is says why", () => {
    for (const [file, leftOut] of Object.entries(LEFT_OUT)) {
      expect([file, leftOut.why.trim().length > 20]).toEqual([file, true]);
      expect(leftOut.tables).toBeGreaterThan(0);
    }
  });
});
