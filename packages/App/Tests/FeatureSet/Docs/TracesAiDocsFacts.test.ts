import { readPage } from "./DocsContentSupport";
import { TRACES_EXPLORER } from "./TelemetryExplorersDocsPages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import AIInsightType from "Common/Types/AI/AIInsightType";
import { PerformanceFindingType } from "Common/Types/AI/CodeFixTaskContext";
import {
  TELEMETRY_AI_CODE_FAULT_CLASSIFICATION,
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import {
  TRACE_INSIGHT_MIN_FAILED_PERCENT,
  TRACE_INSIGHT_MIN_FAILED_SPANS,
  TRACE_INSIGHT_MIN_NO_CHILD_SPANS,
  TRACE_INSIGHT_MIN_OPERATION_SPANS,
  TRACE_INSIGHT_MIN_SERVICE_SPANS,
  TRACE_INSIGHT_MIN_UNTRACED_MS,
  TRACE_INSIGHT_MIN_UNTRACED_PERCENT,
  TRACE_INSIGHT_SLOW_P99_MS,
  TRACE_INSIGHT_WINDOW_MINUTES,
} from "Common/Utils/Traces/TraceInsight";
import { InvestigationRuleTiming } from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_SWITCHES,
  getTelemetryAiFixOptions,
} from "../../../FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";

/*
 * The Traces Explorer page's "Find and fix slow and failing operations with
 * AI" section, held to the code it describes (Common/Types/AI/TelemetryAi,
 * Utils/Traces/TraceInsight, the trace problem detector and Traces' AI tab):
 * how often OneUptime looks and at what, the three kinds of finding and the
 * gates each is filed by, the verdict a failing operation's pull request
 * waits for, the switch and where it is, the rules' answers, the way back
 * into the explorer, and how many pull requests OneUptime AI opens on its
 * own. TelemetryExplorersDocsFacts holds the page's tab table (the AI tab
 * included); TelemetryExplorersDocsTranslations carries every line into the
 * other sixteen languages.
 */

const SECTION_HEADING: string =
  "## Find and fix slow and failing operations with AI";

const PACKAGES_ROOT: string = path.join(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// The section, from its heading to the next level-2 heading.
function readSection(): string {
  const page: string = readPage("en", TRACES_EXPLORER);
  const start: number = page.indexOf(SECTION_HEADING);

  expect(start).toBeGreaterThan(-1);

  const next: number = page.indexOf("\n## ", start + SECTION_HEADING.length);

  return page.slice(start, next === -1 ? page.length : next);
}

// The body rows of the section's first table, by their first cell (unbolded).
function findingRows(section: string): Record<string, string> {
  const rows: Record<string, string> = {};

  for (const line of section.split("\n")) {
    const match: RegExpMatchArray | null = line.match(/^\| \*\*([^*]+)\*\* \|/);

    if (match && !(match[1] as string).includes(" → ")) {
      rows[match[1] as string] = line;
    }
  }

  return rows;
}

describe("the Traces Explorer page's section on finding and fixing slow and failing operations", () => {
  const page: string = readPage("en", TRACES_EXPLORER);
  const section: string = readSection();

  it("comes after Traces Insights, before what happens to spans as they arrive", () => {
    expect(page.indexOf(SECTION_HEADING)).toBeGreaterThan(
      page.indexOf("## Traces Insights"),
    );
    expect(page.indexOf(SECTION_HEADING)).toBeLessThan(
      page.indexOf("## What happens to spans as they arrive"),
    );
  });

  it("is linked from the opening cards and from the AI tab's row", () => {
    const anchor: string =
      "(#find-and-fix-slow-and-failing-operations-with-ai)";
    const opening: string = page.slice(0, page.indexOf("\n## "));
    const tabRow: string =
      page.split("\n").find((line: string): boolean => {
        return line.startsWith("| **AI** |");
      }) || "";

    expect(opening).toContain(
      `- [Find and fix slow and failing operations with AI]${anchor}: `,
    );
    expect(tabRow).toContain(anchor);
    expect(page).toContain("The explorer has five tabs:");
  });

  it("says OneUptime looks every hour, at each service's last hour", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Trace].scanEveryMinutes).toBe(60);
    expect(TRACE_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(section).toContain(
      "Every hour OneUptime looks through each service's traces from the last hour",
    );
  });

  it("names the three kinds of finding as the Dashboard labels them, in the lane's order", () => {
    const presentation: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation.tsx",
    );
    const labels: Record<string, string> = {
      [AIInsightType.TraceSlowOperation]: "Slow Operation",
      [AIInsightType.TraceFailingOperation]: "Failing Operation",
      [AIInsightType.TraceMissingTracing]: "Missing Tracing",
    };

    expect([...TELEMETRY_AI_LANES[TelemetryAiLane.Trace].insightTypes]).toEqual(
      Object.keys(labels),
    );

    for (const [insightType, label] of Object.entries(labels)) {
      expect(presentation).toContain(
        `[AIInsightType.${insightType}]: translationKey("${label}"),`,
      );
    }

    expect(Object.keys(findingRows(section)).slice(0, 3)).toEqual(
      Object.values(labels),
    );
  });

  it("states the gates each finding is filed by, as TraceInsight has them", () => {
    const rows: Record<string, string> = findingRows(section);

    expect(TRACE_INSIGHT_SLOW_P99_MS).toBe(1000);
    expect(section).toContain(
      `OneUptime reads a service once it sent at least ${TRACE_INSIGHT_MIN_SERVICE_SPANS} spans in the last hour`,
    );
    expect(rows["Slow Operation"]).toContain(
      `The operation's P99 is ${TRACE_INSIGHT_SLOW_P99_MS / 1000} second or more over at least ${TRACE_INSIGHT_MIN_OPERATION_SPANS} spans`,
    );
    expect(rows["Failing Operation"]).toContain(
      `At least ${TRACE_INSIGHT_MIN_FAILED_SPANS} of the operation's spans failed, ${TRACE_INSIGHT_MIN_FAILED_PERCENT}% or more of them`,
    );
    expect(rows["Missing Tracing"]).toContain(
      `every one of a service's ${TRACE_INSIGHT_MIN_NO_CHILD_SPANS} or more spans was the root of its trace`,
    );
    expect(rows["Missing Tracing"]).toContain(
      `a slow request spent ${TRACE_INSIGHT_MIN_UNTRACED_PERCENT}% or more of its time (and ${TRACE_INSIGHT_MIN_UNTRACED_MS} ms or more)`,
    );
    expect(rows["Missing Tracing"]).toContain(
      "an operation's failures recorded no error message and no exception",
    );
  });

  it("names the three patterns a slow operation's slowest request repeats", () => {
    expect(Object.values(PerformanceFindingType).sort()).toEqual(
      ["DominantSpan", "NPlusOneQuery", "SequentialSiblings"].sort(),
    );
    expect(findingRows(section)["Slow Operation"]).toContain(
      "the same call made again and again, calls made one after another that could run in parallel, or one call that takes most of the request",
    );
  });

  it("says a failing operation's pull request waits for the code to be found at fault, as the lane and its Fix answer say", () => {
    expect(
      TELEMETRY_AI_LANES[TelemetryAiLane.Trace].fixAfterVerdictInsightTypes,
    ).toEqual([AIInsightType.TraceFailingOperation]);
    expect(TELEMETRY_AI_CODE_FAULT_CLASSIFICATION).toBe(ErrorClass.CodeFault);
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].fixOptionDescriptions[
        AiRuleFix.WithoutAsking
      ],
    ).toContain("for a failing operation once it finds the code at fault");
    expect(section).toContain(
      "OneUptime AI opens a failing operation's pull request on its own only once it finds the code at fault.",
    );
    expect(section).toContain(
      "gets no pull request unless someone asks for one with **Fix with AI**.",
    );
  });

  it("names the switch as the Settings page draws it, on for new projects", () => {
    const switches: ReadonlyArray<{ column: string; title: string }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Trace];

    expect(switches).toHaveLength(1);
    expect(switches[0]!.column).toBe(
      TELEMETRY_AI_LANES[TelemetryAiLane.Trace].switchColumn,
    );
    expect(section).toContain(
      `holds the switch **${switches[0]!.title}**, on for new projects`,
    );

    const projectService: string = readSource(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults).toContain('"enableAutomaticTraceRemediation"');
  });

  it("gives the paths of Traces' AI tab as its side menu draws it", () => {
    const sideMenu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Traces/AI/SideMenu.tsx",
    );
    const tabs: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/Traces/TracesNavTabs.tsx",
    );

    expect(tabs).toContain('label: "AI"');
    expect(sideMenu).toContain('title: "AI"');

    for (const item of ["Insights", "Logs", "Settings"]) {
      expect(sideMenu).toContain(`title: "${item}"`);
      expect(section).toContain(`**Traces → AI → ${item}**`);
    }
  });

  it("names the rules' answers as their form draws them", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Trace,
    );
    const titles: Array<string> = options.map(
      (option: CardSelectOption): string => {
        return option.title;
      },
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

    for (const title of titles) {
      expect(section).toContain(`**${title}**`);
    }

    const timing: Record<InvestigationRuleTiming, { title: string }> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace].timing;

    expect(section).toContain(
      `**${timing[InvestigationRuleTiming.RightAway].title}**, or **${timing[InvestigationRuleTiming.AfterWait].title}**`,
    );
  });

  it("names the finding's way into the explorer as its link draws it", () => {
    // Read from the source: the link util needs a browser to load.
    const links: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks.ts",
    );
    const traceLink: string = links.slice(
      links.indexOf("function buildTraceFindingLink("),
    );

    expect(traceLink).toContain("RouteMap[PageMap.TRACES] as Route");
    expect(traceLink).toContain('target: "traces"');
    expect(traceLink).toContain('label: "Open in Traces"');
    expect(section).toContain(
      "**Open in Traces**, which opens the spans it is about, from the hour it was found in, in the **Viewer**.",
    );
  });

  /*
   * A repository on any host Code connects. The fix finds the code through
   * the repository's own connection, so the section names no one host, as
   * the switch's note names none.
   */
  it("says a pull request needs a repository connected in Code, as the switch's note says", () => {
    const switches: ReadonlyArray<{ note?: string | undefined }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Trace];

    expect(switches[0]!.note).toBe("Needs a repository connected in Code.");
    expect(section).toContain(
      "OneUptime AI needs a repository connected in [Code](/docs/ai/ai-agent)",
    );
    expect(section).not.toContain("GitHub");
  });

  /*
   * A failing operation's pull request waits for the code at fault, and a
   * fix may find nothing to change: "for each one it can fix", as the
   * settings page's own summary says it.
   */
  it("says a pull request opens for each problem OneUptime AI can fix, as the settings page says it", () => {
    const copy: { advancedDefaultsSummary: string } =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Trace];

    expect(copy.advancedDefaultsSummary).toContain(
      "opens a pull request for each one it can fix",
    );
    expect(section).toContain(
      "With no rule, OneUptime AI looks into every problem it finds in your traces right away, and opens a pull request for each one it can fix.",
    );
  });

  it("says a failing operation offers Create Monitor, a Traces monitor on its failed spans, as the finding page draws it", () => {
    // Read from the source: the prefill util needs a browser to load.
    const prefill: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill.ts",
    );
    const traceMonitor: string = prefill.slice(
      prefill.indexOf("function buildTraceFailingOperationMonitor("),
    );

    expect(prefill).toContain(
      "shape = buildTraceFailingOperationMonitor(data.insight);",
    );
    expect(traceMonitor).toContain("monitorType: MonitorType.Traces");
    expect(traceMonitor).toContain("spanStatuses: [SpanStatus.Error]");
    expect(section).toContain(
      "On a failing operation, **Create Monitor** sets up a Traces monitor on its failed spans.",
    );
  });

  it("says how many pull requests OneUptime AI opens on its own a day", () => {
    expect(section).toContain(
      `OneUptime AI opens at most ${TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY} pull requests on its own each day (UTC), one for each finding`,
    );
  });
});
