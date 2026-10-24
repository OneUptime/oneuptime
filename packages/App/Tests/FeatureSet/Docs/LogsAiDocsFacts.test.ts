import { readPage } from "./DocsContentSupport";
import { LOGS_EXPLORER } from "./TelemetryExplorersDocsPages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { LogInsightEvidence } from "Common/Types/AI/AIInsightEvidence";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import AIInsightType from "Common/Types/AI/AIInsightType";
import {
  TELEMETRY_AI_CODE_FAULT_CLASSIFICATION,
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import {
  LOG_FIX_PRIVACY_RULE,
  LOG_INSIGHT_ERROR_SEVERITIES,
  LOG_INSIGHT_FAILED_SAMPLE_SIZE,
  LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT,
  LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT,
  LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS,
  LOG_INSIGHT_MIN_NOISY_PERCENT,
  LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS,
  LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS,
  LOG_INSIGHT_MIN_TRACED_LOGS,
  LOG_INSIGHT_WINDOW_MINUTES,
  LogInsightKind,
  LogLoggingGap,
  LogPatternReading,
  buildLogFixRequestMessage,
  maskLogPatternTokens,
  pickErrorPatterns,
  pickNoisyPattern,
} from "Common/Utils/Logs/LogInsight";
import { normalizeLogBodyToErrorPattern } from "Common/Utils/Telemetry/LogErrorPattern";
import {
  TRACE_INSIGHT_MIN_FAILED_PERCENT,
  TRACE_INSIGHT_MIN_FAILED_SPANS,
} from "Common/Utils/Traces/TraceInsight";
import { InvestigationRuleTiming } from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_SWITCHES,
  getTelemetryAiFixOptions,
} from "../../../FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";

/*
 * The Logs Explorer page's "Find and fix error, missing and noisy logs with
 * AI" section, held to the code it describes (Common/Types/AI/TelemetryAi,
 * Utils/Logs/LogInsight, the log problem detector and Logs' AI tab): how
 * often OneUptime looks and at what, the three kinds of finding and the
 * gates each is filed by, what each pull request is asked to do, what of a
 * log line reaches it, the verdict an error log's pull request waits for,
 * the switch and where it is, the rules' answers, the ways back into the
 * explorers, the monitor an error log offers, and how many pull requests
 * OneUptime AI opens on its own. TelemetryExplorersDocsFacts holds the
 * page's tab table (the AI tab included); TelemetryExplorersDocsTranslations
 * carries every line into the other sixteen languages.
 */

const SECTION_HEADING: string =
  "## Find and fix error, missing and noisy logs with AI";
const ANCHOR: string = "(#find-and-fix-error-missing-and-noisy-logs-with-ai)";

const PACKAGES_ROOT: string = path.join(__dirname, "../../../..");

const SERVICE_ID: string = "5a880000-2222-4222-8222-222222222222";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// The section, from its heading to the next level-2 heading.
function readSection(): string {
  const page: string = readPage("en", LOGS_EXPLORER);
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

// A finding's evidence, as the detector files each kind.
function evidenceOf(
  kind: LogInsightKind,
  extra: Partial<LogInsightEvidence> = {},
): LogInsightEvidence {
  return {
    serviceId: SERVICE_ID,
    kind: kind,
    windowStartTime: "2026-10-24T08:00:00.000Z",
    windowEndTime: "2026-10-24T09:00:00.000Z",
    logCount: 48000,
    pattern: "Payment provider returned <num>: card declined",
    patternCount: 1240,
    ...extra,
  };
}

function requestFor(evidence: LogInsightEvidence): string {
  return buildLogFixRequestMessage({
    evidence: evidence,
    serviceName: "checkout",
    isStartedByOneUptime: true,
  });
}

function patternReading(
  extra: Partial<LogPatternReading> = {},
): LogPatternReading {
  return {
    pattern: "Payment provider returned <num>: card declined",
    count: LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT,
    severities: ["Error"],
    searchText: "Payment provider returned",
    traceCount: 0,
    sampleTraceIds: [],
    hasException: false,
    ...extra,
  };
}

describe("the Logs Explorer page's section on finding and fixing error, missing and noisy logs", () => {
  const page: string = readPage("en", LOGS_EXPLORER);
  const section: string = readSection();
  const rows: Record<string, string> = findingRows(section);

  it("comes after Logs Insights, before what happens to logs as they arrive", () => {
    expect(page.indexOf(SECTION_HEADING)).toBeGreaterThan(
      page.indexOf("## Logs Insights"),
    );
    expect(page.indexOf(SECTION_HEADING)).toBeLessThan(
      page.indexOf("## What happens to logs as they arrive"),
    );
  });

  it("is linked from the opening cards and from the AI tab's row", () => {
    const opening: string = page.slice(0, page.indexOf("\n## "));
    const tabRow: string =
      page.split("\n").find((line: string): boolean => {
        return line.startsWith("| **AI** |");
      }) || "";

    expect(opening).toContain(
      `- [Find and fix error, missing and noisy logs with AI]${ANCHOR}: `,
    );
    expect(tabRow).toContain(ANCHOR);
    expect(page).toContain("The explorer has five tabs:");
  });

  it("says OneUptime looks every hour, at each service's last hour", () => {
    expect(TELEMETRY_AI_LANES[TelemetryAiLane.Log].scanEveryMinutes).toBe(60);
    expect(LOG_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(section).toContain(
      "Every hour OneUptime looks through each service's logs from the last hour",
    );
  });

  it("names the three kinds of finding as the Dashboard labels them, in the lane's order", () => {
    const presentation: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation.tsx",
    );
    const labels: Record<string, string> = {
      [AIInsightType.LogErrorPattern]: "Error Log",
      [AIInsightType.LogMissingLogging]: "Missing Logging",
      [AIInsightType.LogNoisyPattern]: "Noisy Log",
    };

    expect([...TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes]).toEqual(
      Object.keys(labels),
    );

    for (const [insightType, label] of Object.entries(labels)) {
      expect(presentation).toContain(
        `[AIInsightType.${insightType}]: translationKey("${label}"),`,
      );
    }

    // The finding table comes first; the AI rules' steps follow it.
    expect(Object.keys(rows).slice(0, 3)).toEqual(Object.values(labels));
  });

  it("states an error log's gate as LogInsight has it: its severities, its floor, words of its own, no exception", () => {
    expect([...LOG_INSIGHT_ERROR_SEVERITIES]).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(rows["Error Log"]).toContain(
      `A service logged one message at ${LOG_INSIGHT_ERROR_SEVERITIES.join(" or ")} ${LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT} or more times in the hour, a message with words of its own and no exception.`,
    );

    // The floor, and what keeps a message out at it.
    expect(pickErrorPatterns([patternReading()])).toHaveLength(1);
    expect(
      pickErrorPatterns([
        patternReading({ count: LOG_INSIGHT_MIN_ERROR_PATTERN_COUNT - 1 }),
      ]),
    ).toHaveLength(0);
    expect(
      pickErrorPatterns([patternReading({ hasException: true })]),
    ).toHaveLength(0);
    expect(
      pickErrorPatterns([patternReading({ pattern: "<num> <uuid>" })]),
    ).toHaveLength(0);
  });

  it("sends a message logged with an exception, or with a stack trace in it, to Exception Tracking", () => {
    const detector: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector.ts",
    );

    // Lines carrying exception.* attributes are not read for error logs ...
    expect(detector).toContain("excludeExceptionRecords: true");
    // ... and a message whose line holds a stack trace is not filed.
    expect(detector).toContain("LogExceptionExtractor.bodyHoldsStackTrace(");
    expect(rows["Error Log"]).toContain(
      "A message logged with an exception, or with a stack trace in it, is tracked in [Exception Tracking](/docs/telemetry/exceptions) instead.",
    );
  });

  it("states missing logging's two gates as LogInsight and the Traces lane have them", () => {
    const detector: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector.ts",
    );

    // A failing operation is the Traces lane's own.
    expect(detector).toContain("return pickFailingOperations(");
    expect(rows["Missing Logging"]).toContain(
      `At least ${TRACE_INSIGHT_MIN_FAILED_SPANS} of an operation's spans failed in the hour, ${TRACE_INSIGHT_MIN_FAILED_PERCENT}% or more of them, while at least ${LOG_INSIGHT_MIN_TRACED_LOGS} of the service's logs carry a trace id, and none of the operation's ${LOG_INSIGHT_FAILED_SAMPLE_SIZE} most recent failed requests wrote a log line.`,
    );
    expect(rows["Missing Logging"]).toContain(
      `Or a service sent ${LOG_INSIGHT_MIN_TRACE_CONTEXT_LOGS} or more logs and ${LOG_INSIGHT_MIN_TRACE_CONTEXT_SPANS} or more spans in the hour, and fewer than ${LOG_INSIGHT_MAX_TRACE_CONTEXT_PERCENT}% of its logs carry a trace id.`,
    );
  });

  it("states a noisy log's gate as LogInsight has it: below Error, its share and its lines", () => {
    expect(rows["Noisy Log"]).toContain(
      `One message logged below Error is ${LOG_INSIGHT_MIN_NOISY_PERCENT}% or more of a service's lines in the hour, and some ${LOG_INSIGHT_MIN_NOISY_PATTERN_LOGS.toLocaleString("en-US")} lines or more.`,
    );

    const noisy: (
      severities: Array<string>,
      count: number,
    ) => ReturnType<typeof pickNoisyPattern> = (
      severities: Array<string>,
      count: number,
    ): ReturnType<typeof pickNoisyPattern> => {
      return pickNoisyPattern({
        readings: [
          patternReading({
            pattern: "cache hit for key <uuid>",
            count: count,
            severities: severities,
          }),
        ],
        sampledLogCount: 40000,
        logCount: 40000,
      });
    };

    // 25% of 40,000 is 10,000: at both bars at once.
    expect(noisy(["Debug"], 10000)).not.toBeNull();
    expect(noisy(["Debug"], 9999)).toBeNull();
    // At Error it is an error log's to file, never a noisy one.
    expect(noisy(["Error"], 30000)).toBeNull();
  });

  it("says what each kind's pull request does, as the request OneUptime writes asks it", () => {
    const error: string = requestFor(evidenceOf(LogInsightKind.Error));
    const silent: string = requestFor(
      evidenceOf(LogInsightKind.MissingLogging, {
        gap: LogLoggingGap.SilentFailures,
        operationName: "POST /checkout",
      }),
    );
    const untraced: string = requestFor(
      evidenceOf(LogInsightKind.MissingLogging, {
        gap: LogLoggingGap.NoTraceContext,
      }),
    );
    const noisy: string = requestFor(evidenceOf(LogInsightKind.Noisy));

    expect(error).toContain("Find why it logs this error");
    expect(error).toContain("log it at the level it deserves instead");
    expect(rows["Error Log"]).toContain(
      "| Fixes why the error is logged, or logs it at the level it deserves. |",
    );

    expect(silent).toContain("Where POST /checkout fails, log the failure");
    expect(untraced).toContain(
      "Make every log the service writes inside a request carry that request's trace and span ids",
    );
    expect(rows["Missing Logging"]).toContain(
      "| Logs the failure where it happens, or makes the service's logs carry the trace id. |",
    );

    expect(noisy).toContain(
      "log it at Debug, once for a batch or at an interval with a count, or not at all",
    );
    expect(rows["Noisy Log"]).toContain(
      "| Logs the line less: at Debug, once for a batch, or not at all. |",
    );
  });

  /*
   * What of a log line reaches a pull request: the message's pattern, with
   * the parts that change from line to line masked, and the rule every
   * request carries.
   */
  it("says a pull request is asked for with the message's pattern, never a line as it was logged, and what OneUptime AI is told", () => {
    const line: string =
      "Payment for order 9f8b2c1a-77de-4b0e-8a5b-0c9a2f1e4d33 by jane@example.com failed after 3047 ms with token sk_live_51HxQ2bL7xR9vT3kP0aZ";
    const pattern: string = maskLogPatternTokens(
      normalizeLogBodyToErrorPattern(line),
    );

    for (const changing of [
      "9f8b2c1a-77de-4b0e-8a5b-0c9a2f1e4d33",
      "jane@example.com",
      "3047",
      "sk_live_51HxQ2bL7xR9vT3kP0aZ",
    ]) {
      expect(pattern).not.toContain(changing);
    }

    const detector: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/Detectors/LogProblemDetector.ts",
    );

    expect(detector).toContain("maskLogPatternTokens(");

    const request: string = requestFor(
      evidenceOf(LogInsightKind.Error, { pattern: pattern }),
    );

    expect(request).toContain(pattern);
    expect(request).not.toContain(line);

    for (const kind of [
      evidenceOf(LogInsightKind.Error),
      evidenceOf(LogInsightKind.Noisy),
      evidenceOf(LogInsightKind.MissingLogging, {
        gap: LogLoggingGap.SilentFailures,
      }),
      evidenceOf(LogInsightKind.MissingLogging, {
        gap: LogLoggingGap.NoTraceContext,
      }),
    ]) {
      expect(requestFor(kind)).toContain(LOG_FIX_PRIVACY_RULE);
    }

    expect(LOG_FIX_PRIVACY_RULE).toBe(
      "Never log secrets or personal data, and never copy log lines into the pull request.",
    );
    expect(section).toContain(
      "A finding keeps a message as its pattern: the parts that change from line to line, such as numbers and ids, are masked. The pull request is asked for with that pattern, never with a line as it was logged, and OneUptime AI is told never to log secrets or personal data, or to copy log lines into the pull request.",
    );
  });

  it("says an error log's pull request waits for the code to be found at fault, as the lane and its Fix answer say", () => {
    expect(
      TELEMETRY_AI_LANES[TelemetryAiLane.Log].fixAfterVerdictInsightTypes,
    ).toEqual([AIInsightType.LogErrorPattern]);
    expect(TELEMETRY_AI_CODE_FAULT_CLASSIFICATION).toBe(ErrorClass.CodeFault);
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log].fixOptionDescriptions[
        AiRuleFix.WithoutAsking
      ],
    ).toContain("for an error log once it finds the code at fault");
    expect(section).toContain(
      "OneUptime AI opens an error log's pull request on its own only once it finds the code at fault.",
    );
    expect(section).toContain(
      "gets no pull request unless someone asks for one with **Fix with AI**.",
    );
  });

  it("names the switch as the Settings page draws it, on for new projects", () => {
    const switches: ReadonlyArray<{ column: string; title: string }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log];

    expect(switches).toHaveLength(1);
    expect(switches[0]!.column).toBe(
      TELEMETRY_AI_LANES[TelemetryAiLane.Log].switchColumn,
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

    expect(defaults).toContain('"enableAutomaticLogRemediation"');
  });

  it("gives the paths of Logs' AI tab as its side menu draws it", () => {
    const sideMenu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Logs/AI/SideMenu.tsx",
    );
    const tabs: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/Logs/LogsNavTabs.tsx",
    );

    expect(tabs).toContain('label: "AI"');
    expect(sideMenu).toContain('title: "AI"');

    // Its record of what OneUptime AI did is Activity: inside Logs, not "Logs".
    expect(sideMenu).not.toContain('title: "Logs"');

    for (const item of ["Insights", "Activity", "Settings"]) {
      expect(sideMenu).toContain(`title: "${item}"`);
      expect(section).toContain(`**Logs → AI → ${item}**`);
    }
  });

  it("names the rules' answers as their form draws them", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Log,
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
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log].timing;

    expect(section).toContain(
      `**${timing[InvestigationRuleTiming.RightAway].title}**, or **${timing[InvestigationRuleTiming.AfterWait].title}**`,
    );
  });

  it("names a finding's way into the explorers as its link draws it: Logs, or Traces for a failure that writes no log line", () => {
    // Read from the source: the link util needs a browser to load.
    const links: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks.ts",
    );
    const logLink: string = links.slice(
      links.indexOf("function buildLogFindingLink("),
      links.indexOf("type BuildInsightInvestigationLinkFunction"),
    );

    expect(logLink).toContain('input.log?.gap === "SilentFailures"');
    expect(logLink).toContain("return buildTraceFindingLink(");
    expect(logLink).toContain("RouteMap[PageMap.LOGS] as Route");
    expect(logLink).toContain('target: "logs"');
    expect(logLink).toContain('label: "Open in Logs"');
    expect(section).toContain(
      "**Open in Logs**, which opens the lines it is about, from the hour it was found in, in the **Viewer**.",
    );
    expect(section).toContain(
      "A failure that writes no log line has no lines to open: **Open in Traces** opens its failed spans instead.",
    );
  });

  it("says a pull request needs a repository connected in Code, as the switch's note says", () => {
    const switches: ReadonlyArray<{ note?: string | undefined }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Log];

    expect(switches[0]!.note).toBe("Needs a repository connected in Code.");
    expect(section).toContain(
      "OneUptime AI needs a repository connected in [Code](/docs/ai/ai-agent)",
    );
    expect(section).not.toContain("GitHub");
  });

  it("says a pull request opens for each problem OneUptime AI can fix, as the settings page says it", () => {
    const copy: { advancedDefaultsSummary: string } =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log];

    expect(copy.advancedDefaultsSummary).toBe(
      "OneUptime AI looks into every problem it finds in your logs right away, and opens a pull request for each one it can fix.",
    );
    expect(section).toContain(
      "With no rule, OneUptime AI looks into every problem it finds in your logs right away, and opens a pull request for each one it can fix.",
    );
  });

  it("says an error log offers Create Monitor, a Logs monitor counting the message's lines, and only an error log does", () => {
    // Read from the source: the prefill util needs a browser to load.
    const prefill: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill.ts",
    );
    const logMonitor: string = prefill.slice(
      prefill.indexOf("function buildLogErrorPatternMonitor("),
    );
    const notMonitored: string = prefill.slice(
      prefill.indexOf("export const AI_INSIGHT_TYPES_NOT_MONITORED"),
      prefill.indexOf("];", prefill.indexOf("AI_INSIGHT_TYPES_NOT_MONITORED")),
    );

    expect(prefill).toContain(
      "shape = buildLogErrorPatternMonitor(data.insight);",
    );
    expect(logMonitor).toContain("monitorType: MonitorType.Logs");
    expect(logMonitor).toContain("body: trimmedOrNull(evidence?.searchText)");
    expect(notMonitored).toContain("AIInsightType.LogMissingLogging");
    expect(notMonitored).toContain("AIInsightType.LogNoisyPattern");
    expect(section).toContain(
      "On an error log, **Create Monitor** sets up a Logs monitor that counts the message's lines.",
    );
  });

  it("says how many pull requests OneUptime AI opens on its own a day, for every kind of telemetry together", () => {
    const fix: string = readSource(
      "Common/Server/Utils/AI/TelemetryAi/TelemetryAiFix.ts",
    );
    const count: string = fix.slice(
      fix.indexOf("public static async countStartedToday("),
      fix.indexOf("public static async findActiveTaskIdForInsight("),
    );

    // One count per project: no lane, no insight type in it.
    expect(count).toContain("triggeredByAiInsightId: QueryHelper.notNull()");
    expect(count).not.toContain("insightType");
    expect(
      readSource("Common/Server/Utils/AI/TelemetryAi/LogInsightFix.ts"),
    ).toContain("await TelemetryAiFix.countStartedToday(projectId)");
    expect(section).toContain(
      `OneUptime AI opens at most ${TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY} pull requests on its own each day (UTC), for all the telemetry it fixes together, one for each finding`,
    );
  });
});
