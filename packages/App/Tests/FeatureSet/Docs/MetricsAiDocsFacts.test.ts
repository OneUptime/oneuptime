import { readPage } from "./DocsContentSupport";
import { METRICS_EXPLORER } from "./TelemetryExplorersDocsPages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import AIInsightType from "Common/Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import {
  METRIC_INSIGHT_METRICS_READ,
  METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES,
  METRIC_INSIGHT_MIN_BUCKET_SHARE,
  METRIC_INSIGHT_MIN_DATA_POINTS,
  METRIC_INSIGHT_MIN_HISTOGRAM_VALUES,
  METRIC_INSIGHT_MIN_NAME_VARIANTS,
  METRIC_INSIGHT_MIN_SERVICE_SPANS,
  METRIC_INSIGHT_WINDOW_MINUTES,
} from "Common/Utils/Metrics/MetricInsight";
import { InvestigationRuleTiming } from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_SWITCHES,
  getTelemetryAiFixOptions,
} from "../../../FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";

/*
 * The Metrics Explorer page's "Improve metrics and add missing ones with AI"
 * section, held to the code it describes (Common/Types/AI/TelemetryAi,
 * Utils/Metrics/MetricInsight, the metric problem detector and Metrics' AI
 * tab): how often OneUptime looks and at what, the three kinds of finding
 * and the gates each is filed by, that no attribute value is ever kept, the
 * switch and where it is, the rules' answers, the ways back into the
 * explorers, and how many pull requests OneUptime AI opens on its own.
 * TelemetryExplorersDocsFacts holds the page's tab table (the AI tab
 * included); TelemetryExplorersDocsTranslations carries every line into the
 * other sixteen languages.
 */

const SECTION_HEADING: string =
  "## Improve metrics and add missing ones with AI";

const ANCHOR: string = "(#improve-metrics-and-add-missing-ones-with-ai)";

const PACKAGES_ROOT: string = path.join(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// The section, from its heading to the next level-2 heading.
function readSection(): string {
  const page: string = readPage("en", METRICS_EXPLORER);
  const start: number = page.indexOf(SECTION_HEADING);

  expect(start).toBeGreaterThan(-1);

  const next: number = page.indexOf("\n## ", start + SECTION_HEADING.length);

  return page.slice(start, next === -1 ? page.length : next);
}

// The body rows of the section's first table, by their first cell (unbolded).
const FINDING_ROW: RegExp = /^\| \*\*([^*]+)\*\* \|/;

function findingRows(section: string): Record<string, string> {
  const rows: Record<string, string> = {};

  for (const line of section.split("\n")) {
    const match: RegExpMatchArray | null = line.match(FINDING_ROW);

    if (match && !(match[1] as string).includes(" → ")) {
      rows[match[1] as string] = line;
    }
  }

  return rows;
}

// A count as the page writes it: 1,000.
function written(count: number): string {
  return count.toLocaleString("en-US");
}

describe("the Metrics Explorer page's section on improving metrics and adding missing ones", () => {
  const page: string = readPage("en", METRICS_EXPLORER);
  const section: string = readSection();

  it("comes after Metrics Insights, before what happens to metrics as they arrive", () => {
    expect(page.indexOf(SECTION_HEADING)).toBeGreaterThan(
      page.indexOf("## Metrics Insights"),
    );
    expect(page.indexOf(SECTION_HEADING)).toBeLessThan(
      page.indexOf("## What happens to metrics as they arrive"),
    );
  });

  it("is linked from the opening cards and from the AI tab's row", () => {
    const opening: string = page.slice(0, page.indexOf("\n## "));
    const tabRow: string =
      page.split("\n").find((line: string): boolean => {
        return line.startsWith("| **AI** |");
      }) || "";

    expect(opening).toContain(
      `- [Improve metrics and add missing ones with AI]${ANCHOR}: `,
    );
    expect(tabRow).toContain(ANCHOR);
    expect(page).toContain("The explorer has five tabs:");
  });

  it("is named for the switch it is about", () => {
    const [metricSwitch] = TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric];

    expect(SECTION_HEADING).toBe(`## ${metricSwitch!.title} with AI`);
  });

  it("says OneUptime looks every hour, at the hour that ended", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Metric].scanEveryMinutes).toBe(
      60,
    );
    expect(METRIC_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(section).toContain(
      "Every hour OneUptime looks through the metrics your services sent in the last hour",
    );
  });

  it("names the three kinds of finding as the Dashboard labels them, in the lane's order", () => {
    const presentation: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation.tsx",
    );
    const labels: Record<string, string> = {
      [AIInsightType.MetricHighCardinality]: "High Cardinality",
      [AIInsightType.MetricHistogramBuckets]: "Wrong Histogram Buckets",
      [AIInsightType.MetricMissingMetrics]: "Missing Metrics",
    };

    expect([
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Metric].insightTypes,
    ]).toEqual(Object.keys(labels));

    /*
     * Prettier may wrap a long label onto its own line, with a trailing
     * comma: drop the whitespace and that comma before comparing.
     */
    const flat: string = presentation
      .replace(/\(\s+"/gu, '("')
      .replace(/",\s+\)/gu, '")');

    for (const [insightType, label] of Object.entries(labels)) {
      expect(flat).toContain(
        `[AIInsightType.${insightType}]: translationKey("${label}"),`,
      );
    }

    expect(Object.keys(findingRows(section)).slice(0, 3)).toEqual(
      Object.values(labels),
    );
  });

  it("states how many metrics are read closely, as MetricInsight reads them", () => {
    expect(section).toContain(
      `OneUptime reads closely the ${METRIC_INSIGHT_METRICS_READ} metrics your services sent the most data points for in the hour, each with at least ${written(METRIC_INSIGHT_MIN_DATA_POINTS)} of them`,
    );
  });

  it("states the gates each finding is filed by, as MetricInsight has them", () => {
    const rows: Record<string, string> = findingRows(section);

    expect(rows["High Cardinality"]).toContain(
      `An attribute the code sets on one of those metrics took ${written(METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES)} or more values in the hour`,
    );
    expect(rows["High Cardinality"]).toContain(
      `Or ${METRIC_INSIGHT_MIN_NAME_VARIANTS} or more of a service's metric names are one name with a different ID in it.`,
    );
    expect(rows["Wrong Histogram Buckets"]).toContain(
      `One of those metrics is a histogram that recorded ${written(METRIC_INSIGHT_MIN_HISTOGRAM_VALUES)} or more values, and ${METRIC_INSIGHT_MIN_BUCKET_SHARE}% or more of them fell in its smallest bucket or above its largest one, or it has no buckets`,
    );
    expect(rows["Missing Metrics"]).toContain(
      `A service sent ${written(METRIC_INSIGHT_MIN_SERVICE_SPANS)} or more spans in the hour and has never sent a metric.`,
    );
  });

  it("says what each pull request does, as the finding's Fix with AI says it", () => {
    const fixCopy: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy.ts",
    );
    const rows: Record<string, string> = findingRows(section);

    expect(fixCopy).toContain("stops recording these values on the metric");
    expect(rows["High Cardinality"]).toContain(
      "| Stops recording the value on the metric, or takes the IDs out of its names. |",
    );
    expect(fixCopy).toContain("gives this histogram buckets that fit its values");
    expect(rows["Wrong Histogram Buckets"]).toContain(
      "| Gives the histogram buckets that fit its values, or fixes its unit. |",
    );
    expect(fixCopy).toContain("adds metrics to this service");
    expect(rows["Missing Metrics"]).toContain(
      "| Adds the request count, errors and duration of its busiest operations as metrics. |",
    );
  });

  it("says no finding keeps an attribute's values, as the evidence keeps none", () => {
    const evidence: string = readSource("Common/Types/AI/AIInsightEvidence.ts");
    const metricEvidence: string = evidence.slice(
      evidence.indexOf("export interface MetricInsightEvidence"),
      evidence.indexOf("export interface AIInsightEvidence"),
    );

    expect(metricEvidence).toContain("attributeKey?: string");
    expect(metricEvidence).toContain("attributeValueCount?: number");
    expect(metricEvidence).toContain("valueShape?: string");
    expect(metricEvidence).not.toMatch(/sampleValues|attributeValues\??:/u);
    expect(section).toContain(
      "A finding never stores an attribute's values: only the attribute's name, how many values it took and what they look like.",
    );
  });

  it("says no metric problem waits for an investigation's verdict", () => {
    expect(
      TELEMETRY_AI_LANES[TelemetryAiLane.Metric].fixAfterVerdictInsightTypes,
    ).toEqual([]);
    expect(section).not.toContain("only once it finds the code at fault");
  });

  it("names the switch as the Settings page draws it, on for new projects", () => {
    const switches: ReadonlyArray<{ column: string; title: string }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric];

    expect(switches).toHaveLength(1);
    expect(switches[0]!.column).toBe(
      TELEMETRY_AI_LANES[TelemetryAiLane.Metric].switchColumn,
    );
    expect(section).toContain(
      `**Metrics → AI → Settings** holds the switch **${switches[0]!.title}**, on for new projects`,
    );

    const projectService: string = readSource(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults).toContain('"enableAutomaticMetricRemediation"');
  });

  it("says what happens with Enable AI off, as the page's notice says it", () => {
    const notice: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy.ts",
    );

    expect(notice).toContain(
      "Problems in your metrics are still found, but none are looked into and no pull requests are opened.",
    );
    expect(section).toContain(
      "With **Enable AI** off, problems in your metrics are still found, but OneUptime AI does nothing with them.",
    );
  });

  it("gives the paths of Metrics' AI tab as its side menu draws it", () => {
    const sideMenu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Metrics/AI/SideMenu.tsx",
    );
    const tabs: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/Metrics/MetricsNavTabs.tsx",
    );

    expect(tabs).toContain('label: "AI"');
    expect(sideMenu).toContain('title: "AI"');

    for (const item of ["Insights", "Logs", "Settings"]) {
      expect(sideMenu).toContain(`title: "${item}"`);
      expect(section).toContain(`**Metrics → AI → ${item}**`);
    }
  });

  it("names the rules' answers as their form draws them", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Metric,
    );

    expect(
      options.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual([
      AiRuleFix.DoNotFix,
      AiRuleFix.AskFirst,
      AiRuleFix.WithoutAsking,
    ]);

    for (const option of options) {
      expect(section).toContain(`**${option.title}**`);
    }

    const timing: Record<InvestigationRuleTiming, { title: string }> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric].timing;

    expect(section).toContain(
      `**${timing[InvestigationRuleTiming.RightAway].title}**, or **${timing[InvestigationRuleTiming.AfterWait].title}**`,
    );
  });

  it("names the findings' ways into the explorers as their links draw them", () => {
    // Read from the source: the link util needs a browser to load.
    const links: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks.ts",
    );
    const metricLink: string = links.slice(
      links.indexOf("function buildMetricFindingLink("),
      links.indexOf("type BuildInsightInvestigationLinkFunction"),
    );

    expect(metricLink).toContain("RouteMap[PageMap.METRIC_VIEW] as Route");
    expect(metricLink).toContain('label: "Open in Metrics"');
    // A service with no metrics opens its spans instead.
    expect(metricLink).toContain("AIInsightType.MetricMissingMetrics");
    expect(metricLink).toContain("RouteMap[PageMap.TRACES] as Route");
    expect(metricLink).toContain('label: "Open in Traces"');
    expect(section).toContain(
      "**Open in Metrics**, which opens its metric for its service, from the hour it was found in.",
    );
    expect(section).toContain(
      "A service with no metrics offers **Open in Traces** instead",
    );
  });

  it("offers no Create Monitor on a metric finding, so the section names none", () => {
    const prefill: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill.ts",
    );
    const without: string = prefill.slice(
      prefill.indexOf("const AI_INSIGHT_TYPES_WITHOUT_MONITOR"),
      prefill.indexOf("export function isAIInsightMonitorOffered"),
    );

    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Metric]
      .insightTypes) {
      expect(without).toContain(`AIInsightType.${insightType}`);
    }

    expect(section).not.toContain("Create Monitor");
  });

  it("says a pull request needs a repository connected in Code, as the switch's note says", () => {
    const switches: ReadonlyArray<{ note?: string | undefined }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Metric];

    expect(switches[0]!.note).toBe("Needs a repository connected in Code.");
    expect(section).toContain(
      "OneUptime AI needs a repository connected in [Code](/docs/ai/ai-agent)",
    );
    expect(section).not.toContain("GitHub");
  });

  it("says a pull request opens for each problem OneUptime AI can fix, as the settings page says it", () => {
    const copy: { advancedDefaultsSummary: string } =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric];

    expect(copy.advancedDefaultsSummary).toBe(
      "OneUptime AI looks into every problem it finds in your metrics right away, and opens a pull request for each one it can fix.",
    );
    expect(section).toContain(
      "With no rule, OneUptime AI looks into every problem it finds in your metrics right away, and opens a pull request for each one it can fix.",
    );
  });

  it("says how many pull requests OneUptime AI opens on its own a day", () => {
    expect(section).toContain(
      `OneUptime AI opens at most ${TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY} pull requests on its own each day (UTC), one for each finding`,
    );
  });
});
