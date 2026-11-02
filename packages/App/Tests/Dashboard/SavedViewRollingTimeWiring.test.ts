import LogSavedView from "Common/Models/DatabaseModels/LogSavedView";
import Migrations from "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every explorer that offers saved views has to persist the time *selection*
 * — "Past 1 Hour" — rather than the window that selection resolved to when
 * Save was clicked. The logs explorer got this wrong: it saved only the
 * serialized query, whose `time` is always an absolute InBetween, so a rolling
 * range came back as a dead Custom window.
 *
 * Nothing about that fails to compile, and the App suite has no renderer, so
 * the wiring is checked here by reading the sources. LogSavedViewTimeRange
 * .test.ts and Common's SavedViewTimeRange.test.ts cover the behaviour of the
 * helpers themselves; this file is about each explorer actually calling them.
 *
 * The last describe walks the components tree rather than naming files, so a
 * saved-views control mounted on a fifth explorer later fails here until its
 * host persists the selection too.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMPONENTS_DIR: string = path.join(DASHBOARD_SRC, "Components");

const LOGS_VIEWER: Array<string> = ["Components", "Logs", "LogsViewer.tsx"];
const METRICS_VIEWER: Array<string> = [
  "Components",
  "Metrics",
  "MetricsViewer.tsx",
];
const METRIC_EXPLORER: Array<string> = [
  "Components",
  "Metrics",
  "MetricExplorer.tsx",
];
const TRACES_VIEWER: Array<string> = [
  "Components",
  "Traces",
  "TracesViewer.tsx",
];

const SHARED_SERIALIZER_IMPORT: string =
  'from "Common/Utils/Telemetry/SavedViewTimeRange"';

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

const LOGS_CODE: string = readCode(...LOGS_VIEWER);
const METRICS_CODE: string = readCode(...METRICS_VIEWER);
const EXPLORER_CODE: string = readCode(...METRIC_EXPLORER);
const TRACES_CODE: string = readCode(...TRACES_VIEWER);
const EXCEPTIONS_CODE: string = readCode(
  "Components",
  "Exceptions",
  "ExceptionsViewer.tsx",
);
const EXCEPTION_SAVED_VIEW: Array<string> = ["Utils", "ExceptionSavedView.ts"];
const EXCEPTION_SAVED_VIEW_CODE: string = readCode(...EXCEPTION_SAVED_VIEW);

/*
 * A host that keeps its saved-view state in a module of its own is read
 * together with it: the exceptions list captures and applies its views
 * through Utils/ExceptionSavedView.
 */
const HOST_HELPERS: Record<string, Array<Array<string>>> = {
  "ExceptionsViewer.tsx": [EXCEPTION_SAVED_VIEW],
};

describe("LogSavedView carries the time selection", () => {
  test("the model has a nullable JSON timeRange column", () => {
    const savedView: LogSavedView = new LogSavedView();
    const column: TableColumnMetadata =
      savedView.getTableColumnMetadata("timeRange");

    expect(column).toBeTruthy();
    expect(column.type).toBe(TableColumnType.JSON);
    /*
     * Required would break every row saved before the column existed — those
     * fall back to the absolute window still sitting in `query`.
     */
    expect(column.required).toBeFalsy();
  });

  test("the column is readable and writable by project members", () => {
    const savedView: LogSavedView = new LogSavedView();

    expect(
      savedView.getColumnAccessControlFor("timeRange")?.create.length,
    ).toBeGreaterThan(0);
    expect(
      savedView.getColumnAccessControlFor("timeRange")?.read.length,
    ).toBeGreaterThan(0);
    expect(
      savedView.getColumnAccessControlFor("timeRange")?.update.length,
    ).toBeGreaterThan(0);
  });

  /*
   * An unregistered migration never runs, so the column would be missing at
   * runtime while every type check still passes.
   */
  test("the migration adding the column is registered", () => {
    const registered: Array<string> = Migrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(registered).toContain("AddTimeRangeToLogSavedView1786096660558");
  });
});

describe("the logs explorer saves and restores the selection", () => {
  test("it imports the shared serializer", () => {
    expect(LOGS_CODE).toContain(SHARED_SERIALIZER_IMPORT);
    expect(LOGS_CODE).toContain("serializeSavedViewTimeRange");
  });

  test("creating a view stores the selection alongside the query", () => {
    expect(LOGS_CODE).toContain(
      "savedView.timeRange = serializeSavedViewTimeRange(timeRange);",
    );
  });

  test("updating the current view stores the selection too", () => {
    expect(LOGS_CODE).toContain(
      squash("timeRange: serializeSavedViewTimeRange(timeRange),"),
    );
  });

  test("the saved-views fetch selects the column", () => {
    expect(LOGS_CODE).toContain(
      squash("select: { name: true, query: true, timeRange: true,"),
    );
  });

  test("applying a view resolves the selection rather than reading query.time", () => {
    expect(LOGS_CODE).toContain(
      squash(
        "resolveLogSavedViewTimeRange({ timeRange: savedView.timeRange, query: savedQuery, })",
      ),
    );
  });

  test("applying a view rebuilds the query window from the selection", () => {
    expect(LOGS_CODE).toContain("withResolvedTime(");
  });

  /*
   * The old helper always returned a Custom range built from `query.time` —
   * the bug itself. If it comes back, the rest of this wiring is moot.
   */
  test("the helper that forced every saved range to Custom is gone", () => {
    expect(LOGS_CODE).not.toContain("resolveSavedTimeRange");
  });
});

describe("the metrics list explorer saves and restores the selection", () => {
  test("it captures the selection into the saved view state", () => {
    expect(METRICS_CODE).toContain(SHARED_SERIALIZER_IMPORT);
    expect(METRICS_CODE).toContain(
      squash("timeRange: serializeSavedViewTimeRange(timeRange),"),
    );
  });

  test("it restores the selection when a view is applied", () => {
    expect(METRICS_CODE).toContain(
      "setTimeRange(deserializeSavedViewTimeRange(state.timeRange));",
    );
  });
});

describe("the traces explorer saves and restores the selection", () => {
  test("it captures the selection into the saved view state", () => {
    expect(TRACES_CODE).toContain(SHARED_SERIALIZER_IMPORT);
    expect(TRACES_CODE).toContain(
      squash("timeRange: serializeSavedViewTimeRange(timeRange),"),
    );
  });

  test("it restores the selection when a view is applied", () => {
    expect(TRACES_CODE).toContain(
      "setTimeRange(deserializeSavedViewTimeRange(state.timeRange));",
    );
  });
});

describe("the exceptions list saves and restores the selection", () => {
  test("it captures the selection into the saved view state", () => {
    expect(EXCEPTION_SAVED_VIEW_CODE).toContain(SHARED_SERIALIZER_IMPORT);
    expect(EXCEPTION_SAVED_VIEW_CODE).toContain(
      squash("timeRange: serializeSavedViewTimeRange(state.timeRange),"),
    );
    expect(EXCEPTIONS_CODE).toContain("captureExceptionsSavedViewState({");
  });

  test("it restores the selection when a view is applied", () => {
    /*
     * readSavedViewTimeRange rather than deserializeSavedViewTimeRange: a
     * view with no window it can use opens the list's own past day, not
     * the explorers' hour (ExceptionSavedView.test).
     */
    expect(EXCEPTION_SAVED_VIEW_CODE).toContain(
      "readSavedViewTimeRange(state.timeRange) || defaults.timeRange",
    );
    expect(EXCEPTIONS_CODE).toContain("setTimeRange(view.timeRange);");
  });
});

describe("the metric explorer saves and restores the selection", () => {
  /*
   * The chart builder carries its selection as a `rangeToken` next to the
   * resolved window, and getValidRangeToken filters out Custom — so a rolling
   * range is the token and a pinned one is the absolute pair.
   */
  test("it stores the rolling token when there is one", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        "...(metricViewData.rangeToken ? { rangeToken: metricViewData.rangeToken } : {}),",
      ),
    );
  });

  test("it prefers the stored token over the stored window when applying", () => {
    expect(EXPLORER_CODE).toContain(
      squash(
        'MetricExplorerUrl.getValidRangeToken(explorerConfig["rangeToken"])',
      ),
    );
    // The absolute window is only read when there is no token to roll with.
    expect(EXPLORER_CODE).toContain("if (!savedRangeToken) {");
  });
});

describe("every saved-views host persists a selection", () => {
  function findFilesMounting(control: string): Array<string> {
    const matches: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.name.endsWith(".tsx")) {
          continue;
        }

        if (readCodeAt(fullPath).includes(`<${control}`)) {
          matches.push(fullPath);
        }
      }
    };

    walk(COMPONENTS_DIR);

    return matches;
  }

  test("the known hosts are the ones this file pins", () => {
    const telemetryHosts: Array<string> = findFilesMounting(
      "TelemetrySavedViewsControl",
    ).map((file: string): string => {
      return path.basename(file);
    });

    expect(telemetryHosts.sort()).toEqual([
      "ExceptionsViewer.tsx",
      "MetricExplorer.tsx",
      "MetricsViewer.tsx",
      "TracesViewer.tsx",
    ]);
  });

  /*
   * A new explorer that mounts the shared control gets saved views for free,
   * including the mistake this whole change was about — so make it say how it
   * captures time.
   */
  test("each host references a time selection, never only a resolved window", () => {
    for (const file of findFilesMounting("TelemetrySavedViewsControl")) {
      const code: string = [
        readCodeAt(file),
        ...(HOST_HELPERS[path.basename(file)] || []).map(
          (helper: Array<string>): string => {
            return readCode(...helper);
          },
        ),
      ].join(" ");

      expect(
        code.includes("serializeSavedViewTimeRange") ||
          code.includes("rangeToken"),
      ).toBe(true);
    }
  });
});
