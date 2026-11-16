// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import MonitorStepMetricQueries from "Common/Utils/Monitor/MonitorStepMetricQueries";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { getUnsetText } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallbackWords";
import {
  RootCauseMetrics,
  RootCauseMonitor,
  getRootCauseMetrics,
} from "../../FeatureSet/Dashboard/src/Utils/EventRootCauseMetrics";
import {
  DerivedTelemetrySnapshot,
  deriveTelemetrySnapshot,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetrySnapshot";

/*
 * THE LINE OVER AN INCIDENT'S OR AN ALERT'S SCOPED CHARTS, IN THE READER'S
 * WORDS (#8269).
 *
 * A grouped metric monitor opens one incident or alert per series, and its
 * charts are narrowed to that series, with a line saying to what: "Metrics
 * related to this incident, scoped to the affected series (service.name =
 * (unset))". The sentence is the reader's; the "(unset)" a group with no
 * value for its attribute is summed up as was English on every page but
 * the chart's own (#7523), beside the page's own words in German or Persian.
 *
 * Every summary drawn for a reader hands MetricSeriesScope the reader's
 * word (getUnsetText): the incident and alert overviews, both episode
 * pages (deriveTelemetrySnapshot) and the Root Cause card
 * (getRootCauseMetrics), and each works it out as the page is drawn, so it
 * follows the language when it changes after the record was read. The
 * summary is never stored or sent: it is drawn in the card's description
 * only (EventMetricInvestigationPanel).
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function readSource(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\s+/g, " ");
}

// A grouped query, as a metric monitor's snapshot keeps it.
function groupedBy(keys: Array<string>): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "http.requests",
        aggegationType: MetricsAggregationType.Sum,
      } as never,
      groupByAttributeKeys: keys,
    },
  };
}

function storedSnapshot(keys: Array<string>): JSONObject {
  return {
    telemetryType: TelemetryType.Metric,
    metricViewData: {
      queryConfigs: [groupedBy(keys)],
      formulaConfigs: [],
      startAndEndDate: {
        _type: "InBetween",
        startValue: "2026-11-15T10:00:00.000Z",
        endValue: "2026-11-15T11:00:00.000Z",
      },
    },
  } as unknown as JSONObject;
}

function snapshotOf(keys: Array<string>): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: new InBetween<Date>(
        new Date("2026-11-15T10:00:00.000Z"),
        new Date("2026-11-15T11:00:00.000Z"),
      ),
      queryConfigs: [groupedBy(keys)],
      formulaConfigs: [],
    },
  };
}

// A metric monitor whose one step reads `query`, as the monitor reads it now.
function metricMonitor(query: MetricQueryConfigData): RootCauseMonitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep = new MonitorStep();
  const stepKey: string =
    (MonitorStepMetricQueries.getStepKey(MonitorType.Metrics) as string) ||
    "metricMonitor";

  step.data = {
    id: "step-1",
    monitorCriteria: { data: { monitorCriteriaInstanceArray: [] } },
    [stepKey]: {
      metricViewConfig: { queryConfigs: [query], formulaConfigs: [] },
    },
  } as unknown as MonitorStep["data"];
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
  } as unknown as MonitorSteps["data"];

  return { monitorType: MonitorType.Metrics, monitorSteps: monitorSteps };
}

const EMPTY_GROUP: JSONObject = { "service.name": "" };
const TWO_GROUPS: JSONObject = { "service.name": "", "host.name": "prod-01" };

const READ: ReadonlyArray<string> = ["de", "fa", "ar"];

describe("the reader's word for a group with no value", () => {
  test("is a key every Dashboard language words", () => {
    expect(readDashboardLocale("en")["(unset)"]).toBe("(unset)");

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        worded: isWordedInDashboardLocale("(unset)", language),
      }).toEqual({ language, worded: true });
    }
  });

  test.each(READ)("reads in %s's own words", (language: string) => {
    const word: string = getUnsetText(dashboardTranslator(language));

    expect(word).toBe(readDashboardLocale(language)["(unset)"]);
    expect(word).not.toBe("(unset)");
  });

  test("English keeps (unset), the name every pin and filter matches", () => {
    expect(getUnsetText(dashboardTranslator("en"))).toBe(
      MetricSeriesScope.UnsetLabelDisplayValue,
    );
  });
});

describe("an episode's snapshot (deriveTelemetrySnapshot)", () => {
  test.each(READ)(
    "says an empty group in %s when handed its word",
    (language: string) => {
      const word: string = getUnsetText(dashboardTranslator(language));
      const snapshot: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
        storedTelemetryQuery: storedSnapshot(["service.name"]),
        seriesLabels: EMPTY_GROUP,
        unsetLabel: word,
      });

      expect(snapshot.seriesSummary).toBe(`service.name = ${word}`);
      expect(snapshot.seriesSummary).not.toContain("(unset)");
    },
  );

  test("names a real value as it is, beside an empty one in the reader's word", () => {
    const word: string = getUnsetText(dashboardTranslator("de"));

    expect(
      deriveTelemetrySnapshot({
        storedTelemetryQuery: storedSnapshot(["service.name", "host.name"]),
        seriesLabels: TWO_GROUPS,
        unsetLabel: word,
      }).seriesSummary,
    ).toBe(`service.name = ${word}, host.name = prod-01`);
  });

  test("without a word it reads (unset), as before (English unchanged)", () => {
    expect(
      deriveTelemetrySnapshot({
        storedTelemetryQuery: storedSnapshot(["service.name"]),
        seriesLabels: EMPTY_GROUP,
      }).seriesSummary,
    ).toBe("service.name = (unset)");
  });

  test("the word changes the line only: the charts are narrowed the same way", () => {
    const english: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: storedSnapshot(["service.name"]),
      seriesLabels: EMPTY_GROUP,
    });
    const german: DerivedTelemetrySnapshot = deriveTelemetrySnapshot({
      storedTelemetryQuery: storedSnapshot(["service.name"]),
      seriesLabels: EMPTY_GROUP,
      unsetLabel: getUnsetText(dashboardTranslator("de")),
    });

    expect(german.telemetryQuery).toEqual(english.telemetryQuery);
  });
});

describe("a Root Cause card (getRootCauseMetrics)", () => {
  test.each(READ)(
    "from the event's snapshot, says an empty group in %s",
    (language: string) => {
      const word: string = getUnsetText(dashboardTranslator(language));
      const metrics: RootCauseMetrics | null = getRootCauseMetrics({
        telemetryQuery: snapshotOf(["service.name"]),
        seriesLabels: EMPTY_GROUP,
        monitors: [],
        unsetLabel: word,
      });

      expect(metrics!.seriesSummary).toBe(`service.name = ${word}`);
    },
  );

  test.each(READ)(
    "from its monitor as it reads now, says an empty group in %s",
    (language: string) => {
      const word: string = getUnsetText(dashboardTranslator(language));
      const metrics: RootCauseMetrics | null = getRootCauseMetrics({
        telemetryQuery: null,
        seriesLabels: EMPTY_GROUP,
        monitors: [metricMonitor(groupedBy(["service.name"]))],
        unsetLabel: word,
      });

      expect(metrics!.chartedFromMonitorNow).toBeDefined();
      expect(metrics!.seriesSummary).toBe(`service.name = ${word}`);
    },
  );

  test("without a word it reads (unset), on both branches", () => {
    expect(
      getRootCauseMetrics({
        telemetryQuery: snapshotOf(["service.name"]),
        seriesLabels: EMPTY_GROUP,
        monitors: [],
      })!.seriesSummary,
    ).toBe("service.name = (unset)");
    expect(
      getRootCauseMetrics({
        telemetryQuery: null,
        seriesLabels: EMPTY_GROUP,
        monitors: [metricMonitor(groupedBy(["service.name"]))],
      })!.seriesSummary,
    ).toBe("service.name = (unset)");
  });
});

/*
 * Every call that sums a series up for the Dashboard hands the reader's
 * word: read from the syntax tree, so a page added later is held too.
 */
const SUMMARY_CALL: string = "getAppliedSeriesLabelSummary";

const SOURCE_FILE: RegExp = /\.tsx?$/;

// A write to the API that carries the line.
const SENT_WITH_A_WRITE: RegExp =
  /ModelAPI\.(create|update|updateById)[\s\S]{0,400}seriesSummary/;

function sourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found;
}

// The lines where `text` sums a series up without saying an empty group's word.
export function callsWithoutTheReadersWord(
  fileName: string,
  text: string,
): Array<number> {
  if (!text.includes(SUMMARY_CALL)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Array<number> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source).split(".").pop() === SUMMARY_CALL
    ) {
      const input: ts.Expression | undefined = node.arguments[0];
      const saysTheWord: boolean = Boolean(
        input &&
          ts.isObjectLiteralExpression(input) &&
          input.properties.some((property: ts.ObjectLiteralElementLike) => {
            return (
              (ts.isPropertyAssignment(property) ||
                ts.isShorthandPropertyAssignment(property)) &&
              property.name.getText(source) === "unsetLabel"
            );
          }),
      );

      if (!saysTheWord) {
        lines.push(
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return lines;
}

describe("every summary the Dashboard draws says an empty group in the reader's word", () => {
  const callers: Array<string> = sourceFiles(DASHBOARD_SRC).filter(
    (file: string): boolean => {
      return fs.readFileSync(file, "utf8").includes(`${SUMMARY_CALL}(`);
    },
  );

  test("the scan finds the places that sum a series up", () => {
    const names: Array<string> = callers.map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
    });

    expect(names).toEqual(
      expect.arrayContaining([
        "Pages/Incidents/View/Index.tsx",
        "Pages/Alerts/View/Index.tsx",
        "Utils/EventRootCauseMetrics.ts",
        "Utils/TelemetrySnapshot.ts",
        "Components/Metrics/MetricCharts.tsx",
      ]),
    );
  });

  test("none of them leaves the word out", () => {
    const problems: Array<string> = [];

    for (const file of callers) {
      for (const line of callsWithoutTheReadersWord(
        file,
        fs.readFileSync(file, "utf8"),
      )) {
        problems.push(`${path.relative(DASHBOARD_SRC, file)}:${line}`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("a summary that drops the word is caught (control)", () => {
    // The incident overview, as it was before #8269.
    expect(
      callsWithoutTheReadersWord(
        "Index.tsx",
        [
          "setSeriesSummary(",
          "  MetricSeriesScope.getAppliedSeriesLabelSummary({",
          "    queryConfigs: telemetryQuery.metricViewData.queryConfigs,",
          "    seriesLabels: incident?.seriesLabels,",
          "  }),",
          ");",
        ].join("\n"),
      ),
    ).toEqual([2]);

    // Handed on by name, it counts.
    expect(
      callsWithoutTheReadersWord(
        "Util.ts",
        "MetricSeriesScope.getAppliedSeriesLabelSummary({ queryConfigs, seriesLabels, unsetLabel });",
      ),
    ).toEqual([]);
  });
});

describe("each page works the line out as it is drawn, so it follows the language", () => {
  test.each([
    ["the incident overview", "Pages/Incidents/View/Index.tsx"],
    ["the alert overview", "Pages/Alerts/View/Index.tsx"],
  ])("%s", (_name: string, file: string) => {
    const code: string = readSource(file);

    expect(code).toContain(
      "const unsetLabel: string = getUnsetText(translator);",
    );
    expect(code).toContain(
      "}, [seriesScopeQueries, seriesLabels, unsetLabel]);",
    );
    // The read keeps what the line is worked out from, not the line.
    expect(code).toContain(
      "setSeriesScopeQueries(telemetryQuery.metricViewData.queryConfigs);",
    );
    expect(code).not.toContain("setSeriesSummary(");
    expect(code).toContain("seriesSummary={seriesSummary}");
  });

  test.each([
    ["the incident episode", "Pages/Incidents/EpisodeView/Index.tsx"],
    ["the alert episode", "Pages/Alerts/EpisodeView/Index.tsx"],
  ])("%s", (_name: string, file: string) => {
    const code: string = readSource(file);

    expect(code).toContain(
      "const unsetLabel: string = getUnsetText(translator);",
    );
    expect(code).toContain("}, [snapshotSource, unsetLabel]);");
    expect(code).toContain("unsetLabel: unsetLabel,");
    expect(code).not.toContain("setTelemetrySnapshot(");
  });

  test("the Root Cause card", () => {
    const code: string = readSource(
      "Components/Telemetry/EventRootCauseMetricChart.tsx",
    );

    expect(code).toContain(
      "const unsetLabel: string = getUnsetText(translator);",
    );
    expect(code).toContain("}, [readEvent, unsetLabel]);");
    expect(code).toContain("seriesSummary={metrics.seriesSummary}");
  });

  test("the line is only drawn: never stored or sent", () => {
    for (const file of sourceFiles(DASHBOARD_SRC)) {
      const code: string = fs.readFileSync(file, "utf8");

      if (!code.includes("seriesSummary")) {
        continue;
      }

      // No API write, no AI prompt carries it.
      expect({
        file: path.relative(DASHBOARD_SRC, file),
        sent: SENT_WITH_A_WRITE.test(code),
      }).toEqual({ file: path.relative(DASHBOARD_SRC, file), sent: false });
    }
  });
});

// The fixtures read their language's word, never an English stand-in.
describe("the fixtures", () => {
  test("cover a language read from the left and two read from the right", () => {
    const words: Dictionary<string> = {};

    for (const language of READ) {
      words[language] = getUnsetText(dashboardTranslator(language));
    }

    expect(new Set(Object.values(words)).size).toBe(READ.length);
  });
});
