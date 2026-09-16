import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The SLO Metrics page is wiring: a page that stacks a banner over four tabs,
 * three components that hand prebuilt queries to EmbeddedMetricCard, and the
 * history charts that moved out of the Charts page. The App suite has no
 * renderer, and every way of getting that wrong renders something - an empty
 * card, a tab that shows the wrong view, a Charts route that silently lost its
 * charts - so these read the sources and pin the invariants. The query shapes
 * themselves are pinned as data by SloMetricsQueryConfig.test.ts, and the
 * rendered behaviour by Common/Tests/App/Dashboard/SloMetricsPage.test.tsx.
 *
 * Sources are comment-stripped and whitespace-squashed first, so prose that
 * names a removed pattern cannot fail the assertion that it is gone, and
 * prettier re-wrapping a line cannot fail one that it is present.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readCode(...relativeParts: Array<string>): string {
  const raw: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativeParts),
    "utf8",
  );

  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
}

function importsOf(code: string): Array<string> {
  return Array.from(code.matchAll(/from "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const METRICS_PAGE: Array<string> = ["Pages", "Slo", "View", "Metrics.tsx"];
const CHARTS_PAGE: Array<string> = ["Pages", "Slo", "View", "Charts.tsx"];
const HISTORY_CHARTS: Array<string> = [
  "Components",
  "Slo",
  "SloHistoryCharts.tsx",
];
const SLO_METRICS: Array<string> = ["Components", "Slo", "SloMetrics.tsx"];
const SLO_INCIDENT_METRICS: Array<string> = [
  "Components",
  "Slo",
  "SloIncidentMetrics.tsx",
];
const SLO_ALERT_METRICS: Array<string> = [
  "Components",
  "Slo",
  "SloAlertMetrics.tsx",
];
const QUERY_CONFIG: Array<string> = [
  "Components",
  "Slo",
  "SloMetricsQueryConfig.ts",
];

describe("Pages/Slo/View/Metrics.tsx", () => {
  const code: string = readCode(...METRICS_PAGE);

  test("renders the SLO notice banner above the tabs, so every tab explains an empty chart", () => {
    const bannerIndex: number = code.indexOf(
      "<SloNoticeBanner sloId={modelId} />",
    );
    const tabsIndex: number = code.indexOf("<Tabs");

    expect(bannerIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(bannerIndex).toBeLessThan(tabsIndex);
  });

  test("builds its four tabs from SloMetricsTab, each mounting its own view for this SLO", () => {
    const expectedTabs: Array<[string, string]> = [
      ["SloMetricsTab.SloMetrics", "<SloMetricsElement sloId={modelId} />"],
      [
        "SloMetricsTab.ErrorBudgetHistory",
        "<SloHistoryCharts sloId={modelId} />",
      ],
      [
        "SloMetricsTab.IncidentMetrics",
        "<SloIncidentMetrics sloId={modelId} />",
      ],
      ["SloMetricsTab.AlertMetrics", "<SloAlertMetrics sloId={modelId} />"],
    ];

    let previousIndex: number = -1;

    for (const [tabName, element] of expectedTabs) {
      const tabIndex: number = code.indexOf(
        `name: ${tabName}, children: ${element}`,
      );

      expect(tabIndex).toBeGreaterThan(previousIndex);
      previousIndex = tabIndex;
    }
  });

  test("reads the SLO id from the route, like every other SLO view page", () => {
    expect(code).toContain(
      "const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);",
    );
  });

  test("no longer re-exports the Charts page, which is now only the legacy route", () => {
    expect(importsOf(code)).not.toContain("./Charts");
    expect(code).not.toContain("<SloCharts");
  });

  test("does not import MetricsViewer, so the resource telemetry bare-layout sweep rightly skips it", () => {
    expect(importsOf(code).join(" ")).not.toContain("Metrics/MetricsViewer");
  });
});

describe("Pages/Slo/View/Charts.tsx (the legacy route)", () => {
  const code: string = readCode(...CHARTS_PAGE);

  test("shows the banner and the same history charts the Metrics page's history tab shows", () => {
    expect(code).toContain("<SloNoticeBanner sloId={modelId} />");
    expect(code).toContain("<SloHistoryCharts sloId={modelId} />");
    expect(importsOf(code)).toContain(
      "../../../Components/Slo/SloHistoryCharts",
    );
  });

  test("keeps no chart logic of its own to drift from the tab", () => {
    expect(code).not.toContain("AnalyticsModelAPI");
    expect(code).not.toContain("LineChartElement");
  });
});

describe("Components/Slo/SloHistoryCharts.tsx", () => {
  const code: string = readCode(...HISTORY_CHARTS);

  test("takes the SLO id as a prop instead of reading the route, so it works inside a tab", () => {
    expect(code).toContain(
      "export interface ComponentProps { sloId: ObjectID; }",
    );
    expect(code).not.toContain("Navigation.getLastParamAsObjectID");
    expect(importsOf(code)).not.toContain("Common/UI/Utils/Navigation");
  });

  test("leaves the banner to the page, so a tab never shows it twice", () => {
    expect(code).not.toContain("<SloNoticeBanner");
  });

  test("reads SloHistory through the aggregate endpoint with the shared history-name mapping, never retyped strings", () => {
    expect(code).toContain("AnalyticsModelAPI.aggregate<SloHistory>");

    // Tolerant of prettier wrapping the call and adding a trailing comma.
    for (const widgetMetric of ["Sli", "ErrorBudgetRemaining", "BurnRate"]) {
      expect(code).toMatch(
        new RegExp(
          `getSloHistoryMetricName\\(\\s*SloWidgetMetric\\.${widgetMetric},?\\s*\\)`,
        ),
      );
    }

    expect(code).not.toContain('"sli.percent"');
    expect(code).not.toContain('"error.budget.remaining.percent"');
    expect(code).not.toContain('"burn.rate"');
  });

  test("still draws the target, at-risk, exhausted and burn-rule reference lines", () => {
    expect(code).toContain("referenceLines: sliReferenceLines");
    expect(code).toContain("referenceLines: budgetReferenceLines");
    expect(code).toContain("referenceLines: burnRateReferenceLines");
  });

  test("keys its fetch on the id string, so a parent's fresh ObjectID cannot loop it", () => {
    expect(code).toContain("}, [timeRange, refreshTick, sloIdString]);");
  });
});

describe("the SLO metric cards", () => {
  test("SloMetrics shares ONE time range across every category card", () => {
    const code: string = readCode(...SLO_METRICS);

    expect(code).toContain("getSloMetricCategories()");
    expect(code).toContain("buildSloMetricQueryConfigs({");
    expect(code).toContain("timeRange={timeRange}");
    expect(code).toContain("onTimeRangeChange={handleTimeRangeChange}");
    expect(code).toContain("SLO_METRICS_DEFAULT_TIME_RANGE");
  });

  test.each([
    [
      "SloIncidentMetrics.tsx",
      SLO_INCIDENT_METRICS,
      "buildSloIncidentMetricQueryConfigs",
      "SLO_INCIDENT_METRICS_CARD",
    ],
    [
      "SloAlertMetrics.tsx",
      SLO_ALERT_METRICS,
      "buildSloAlertMetricQueryConfigs",
      "SLO_ALERT_METRICS_CARD",
    ],
  ])(
    "%s hands its builder's queries to one EmbeddedMetricCard",
    (_name: string, file: Array<string>, builder: string, copy: string) => {
      const code: string = readCode(...file);

      expect(code).toContain(`${builder}({`);
      expect(code).toContain(`title={${copy}.title}`);
      expect(code).toContain("<EmbeddedMetricCard");
      expect(code).toContain(
        "defaultTimeRange={SLO_EVENT_METRICS_DEFAULT_TIME_RANGE}",
      );
    },
  );

  test.each([
    ["SloMetrics.tsx", SLO_METRICS],
    ["SloIncidentMetrics.tsx", SLO_INCIDENT_METRICS],
    ["SloAlertMetrics.tsx", SLO_ALERT_METRICS],
  ])(
    "%s memoises its queries on the id string, so the cards do not refetch on every render",
    (_name: string, file: Array<string>) => {
      const code: string = readCode(...file);

      expect(code).toContain(
        "const sloIdString: string = props.sloId.toString();",
      );
      expect(code).toContain("useMemo(");
    },
  );

  test.each([
    ["SloMetrics.tsx", SLO_METRICS],
    ["SloIncidentMetrics.tsx", SLO_INCIDENT_METRICS],
    ["SloAlertMetrics.tsx", SLO_ALERT_METRICS],
  ])(
    "%s builds no query inline - the shapes live in the tested builder module",
    (_name: string, file: Array<string>) => {
      const code: string = readCode(...file);

      expect(code).not.toContain("aggegationType");
      expect(code).not.toContain("filterData");
      expect(code).not.toContain("groupBy: { attributes: true }");
    },
  );
});

describe("Components/Slo/SloMetricsQueryConfig.ts", () => {
  const code: string = readCode(...QUERY_CONFIG);

  test("is React-free and window-free, so App's plain-node suites can import it", () => {
    for (const importedModule of importsOf(code)) {
      expect(importedModule).not.toMatch(/^react/);
      expect(importedModule).not.toContain("RouteMap");
      expect(importedModule).not.toContain("PageMap");
      expect(importedModule).not.toContain("Navigation");
      expect(importedModule).not.toContain("Common/UI/");
    }
  });

  test("names SLO series through SloMetricType, never as oneuptime.slo.* literals", () => {
    expect(code).not.toContain('"oneuptime.slo.');
    expect(code).toContain("SloMetricType.SliPercent");
    expect(code).toContain("SloMetricTypeUtil.getAggregationType(metricType)");
  });

  test("filters incident and alert metrics through the shared attribute constant", () => {
    expect(code).not.toContain('"serviceLevelObjectiveIds"');
    expect(code).toContain(
      "[SERVICE_LEVEL_OBJECTIVE_IDS_METRIC_ATTRIBUTE]: new Search(",
    );
  });
});

describe("the route is still wired to this page", () => {
  test("SloRoutes mounts the Metrics page on SLO_VIEW_METRICS", () => {
    const code: string = readCode("Routes", "SloRoutes.tsx");

    expect(code).toContain(
      "path={RouteUtil.getLastPathForKey(PageMap.SLO_VIEW_METRICS)}",
    );
    expect(importsOf(code)).toContain("../Pages/Slo/View/Metrics");
  });

  test("the SLO side menu links to it as Metrics", () => {
    const code: string = readCode("Pages", "Slo", "View", "SideMenu.tsx");

    expect(code).toContain("RouteMap[PageMap.SLO_VIEW_METRICS]");
    expect(code).toContain('title: "Metrics"');
  });
});
