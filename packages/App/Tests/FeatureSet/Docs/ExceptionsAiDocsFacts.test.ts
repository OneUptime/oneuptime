import { readPage } from "./DocsContentSupport";
import { EXCEPTIONS } from "./TelemetryExplorersDocsPages";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { AiRuleFix } from "Common/Types/AI/AiRule";
import AIInsightType from "Common/Types/AI/AIInsightType";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import {
  EXCEPTION_FIX_TASK_TYPE_BY_KIND,
  EXCEPTION_STACK_TRACE_MIN_OCCURRENCES,
  EXCEPTION_STACK_TRACE_WINDOW_HOURS,
  ExceptionFixKind,
  getAutomaticExceptionFixKind,
  isExceptionRaisedInOwnCode,
} from "Common/Utils/Exceptions/ExceptionInsight";
import { InvestigationRuleTiming } from "../../../FeatureSet/Dashboard/src/Components/AISettings/InvestigationRuleTiming";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_SWITCHES,
  getTelemetryAiFixOptions,
} from "../../../FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import { AI_TASK_PRESENTATION } from "../../../FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";

/*
 * The Exception Tracking page's "Find and fix new and rising exceptions
 * with AI" section, held to the code it describes (Common/Types/AI/
 * TelemetryAi, Utils/Exceptions/ExceptionInsight, the exception detectors,
 * the exception's own AI task and Exceptions' AI tab): how often OneUptime
 * looks and at what, the three kinds of finding and the gates each is
 * filed by, the verdict a new or rising exception's pull request waits
 * for and which of the exception's own AI tasks it is, the own-code gate,
 * the switch and where it is, what happens while it is off, the rules'
 * answers, the ways back into Exceptions, how many pull requests OneUptime
 * AI opens on its own, and where a pull request says why it was opened.
 * TelemetryExplorersDocsTranslations carries every line into the other
 * sixteen languages.
 */

const SECTION_HEADING: string =
  "## Find and fix new and rising exceptions with AI";

const PACKAGES_ROOT: string = path.join(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_ROOT, relativePath), "utf8");
}

// A numeric constant as its module declares it, read from the source.
function declaredNumber(source: string, name: string): number {
  const declaration: string = `export const ${name}: number = `;
  const start: number = source.indexOf(declaration);

  expect(start).toBeGreaterThan(-1);

  const value: string = source
    .slice(start + declaration.length, source.indexOf(";", start))
    .trim();

  return Number(value);
}

// The section, from its heading to the next level-2 heading.
function readSection(): string {
  const page: string = readPage("en", EXCEPTIONS);
  const start: number = page.indexOf(SECTION_HEADING);

  expect(start).toBeGreaterThan(-1);

  const next: number = page.indexOf("\n## ", start + SECTION_HEADING.length);

  return page.slice(start, next === -1 ? page.length : next);
}

// The body rows of the section's first table, by their first cell (unbolded).
function findingRows(section: string): Record<string, string> {
  const rows: Record<string, string> = {};
  const lines: Array<string> = section.split("\n");
  const tableStart: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("| Finding |");
  });

  for (const line of lines.slice(tableStart + 2)) {
    if (!line.startsWith("| **")) {
      break;
    }

    const name: string = line.slice(4, line.indexOf("**", 4));
    rows[name] = line;
  }

  return rows;
}

describe("the Exception Tracking page's section on finding and fixing new and rising exceptions", () => {
  const page: string = readPage("en", EXCEPTIONS);
  const section: string = readSection();
  const lane: (typeof TELEMETRY_AI_LANES)[TelemetryAiLane.Exception] =
    TELEMETRY_AI_LANES[TelemetryAiLane.Exception];

  it("comes after Fix it with AI - the exception's own AI tasks - and before Exceptions Insights", () => {
    expect(page.indexOf(SECTION_HEADING)).toBeGreaterThan(
      page.indexOf("## Fix it with AI"),
    );
    expect(page.indexOf(SECTION_HEADING)).toBeLessThan(
      page.indexOf("## Exceptions Insights"),
    );
  });

  it("is linked from the opening cards", () => {
    const opening: string = page.slice(0, page.indexOf("\n## "));

    expect(opening).toContain(
      "- [Find and fix new and rising exceptions with AI](#find-and-fix-new-and-rising-exceptions-with-ai): ",
    );
  });

  it("says OneUptime looks every 15 minutes, as the lane's look does", () => {
    expect(lane.scanEveryMinutes).toBe(15);
    expect(section).toContain(
      "Every 15 minutes OneUptime looks through your exceptions for new ones, ones that suddenly happen far more often, and services whose exceptions carry no stack trace",
    );
  });

  it("names the three kinds of finding as the Dashboard labels them, in the lane's order", () => {
    const presentation: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation.tsx",
    );
    const labels: Record<string, string> = {
      [AIInsightType.NewException]: "New Exception",
      [AIInsightType.ExceptionSpike]: "Exception Spike",
      [AIInsightType.ExceptionMissingStackTrace]: "Missing Stack Trace",
    };

    expect([...lane.insightTypes]).toEqual(Object.keys(labels));

    for (const [insightType, label] of Object.entries(labels)) {
      expect(
        presentation
          .replace(/\s+/g, " ")
          .includes(
            `[AIInsightType.${insightType}]: translationKey( "${label}", )`,
          ) ||
          presentation.includes(
            `[AIInsightType.${insightType}]: translationKey("${label}"),`,
          ),
      ).toBe(true);
    }

    expect(Object.keys(findingRows(section))).toEqual(Object.values(labels));
  });

  it("states the gates each finding is filed by, as the detectors have them", () => {
    const rows: Record<string, string> = findingRows(section);
    const newException: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector.ts",
    );
    const spike: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/Detectors/ExceptionSpikeDetector.ts",
    );

    expect(rows["New Exception"]).toContain(
      `An exception first seen in the last ${declaredNumber(newException, "NEW_EXCEPTION_LOOKBACK_HOURS")} hours that already happened ${declaredNumber(newException, "NEW_EXCEPTION_MIN_OCCURRENCE_COUNT")} or more times.`,
    );

    expect(declaredNumber(spike, "EXCEPTION_SPIKE_RECENT_WINDOW_HOURS")).toBe(
      1,
    );
    expect(rows["Exception Spike"]).toContain(
      `An exception that happened ${declaredNumber(spike, "EXCEPTION_SPIKE_MIN_RECENT_COUNT")} or more times in the last hour, at ${declaredNumber(spike, "EXCEPTION_SPIKE_MIN_MULTIPLIER")} or more times its hourly rate over the ${declaredNumber(spike, "EXCEPTION_SPIKE_BASELINE_WINDOW_HOURS")} hours before.`,
    );

    expect(EXCEPTION_STACK_TRACE_WINDOW_HOURS).toBe(24);
    expect(rows["Missing Stack Trace"]).toContain(
      `The exceptions a service recorded in the last day carry no stack trace, and together happened ${EXCEPTION_STACK_TRACE_MIN_OCCURRENCES} or more times.`,
    );
  });

  it("says a new or rising exception's pull request waits for the verdict, and is the exception's own AI task the verdict picks", () => {
    expect([...(lane.fixAfterVerdictInsightTypes || [])]).toEqual([
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]);

    // A fault of the code: the fix.
    expect(getAutomaticExceptionFixKind(ErrorClass.CodeFault)).toBe(
      ExceptionFixKind.Fix,
    );
    expect(EXCEPTION_FIX_TASK_TYPE_BY_KIND[ExceptionFixKind.Fix]).toBe(
      CodeFixTaskType.FixException,
    );
    expect(AI_TASK_PRESENTATION[CodeFixTaskType.FixException].title).toBe(
      "Fix this exception with AI",
    );

    // An expected error: better handling.
    for (const expected of [ErrorClass.UserError, ErrorClass.ExpectedDenial]) {
      expect(getAutomaticExceptionFixKind(expected)).toBe(
        ExceptionFixKind.ImproveHandling,
      );
    }
    expect(
      EXCEPTION_FIX_TASK_TYPE_BY_KIND[ExceptionFixKind.ImproveHandling],
    ).toBe(CodeFixTaskType.ImproveExceptionHandling);
    expect(
      AI_TASK_PRESENTATION[CodeFixTaskType.ImproveExceptionHandling].title,
    ).toBe("Improve Error Handling");

    // Anything else: none on its own.
    for (const other of [ErrorClass.Infrastructure, ErrorClass.Unknown]) {
      expect(getAutomaticExceptionFixKind(other)).toBeNull();
    }

    expect(section).toContain(
      "A new or rising exception's pull request is the exception's own AI task, the one its **AI Assistance** page starts, and it waits for OneUptime AI to look into the finding.",
    );
    expect(section).toContain(
      "When it finds the code at fault (`code-fault`), the pull request fixes it, as **Fix this exception with AI** does.",
    );
    expect(section).toContain(
      "When it finds an expected error (`user-error` or `expected-denial`), the pull request handles the error better, as **Improve Error Handling** does.",
    );
    expect(section).toContain(
      "Any other verdict opens no pull request on its own.",
    );
  });

  /*
   * "Archive exceptions that are expected" archives an expected denial as
   * soon as the investigation says so (InsightTriageRunner), and an
   * exception's own AI task never starts for an archived exception
   * (ExceptionInsightFix): the page says the denial gets no pull request.
   */
  it("says an expected denial that Archive exceptions that are expected archives gets no pull request", () => {
    const triage: string = readSource(
      "Common/Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts",
    );
    const fix: string = readSource(
      "Common/Server/Utils/AI/TelemetryAi/ExceptionInsightFix.ts",
    );
    const archiving: string = triage.slice(
      triage.indexOf(
        "classification === ExceptionAIClassification.ExpectedDenial &&",
      ),
    );

    expect(archiving).toContain(
      "project.autoArchiveNonActionableExceptions === true",
    );
    expect(archiving).toContain("isArchived: true");
    expect(fix).toContain(
      "if (!exception || exception.isResolved || exception.isArchived) {\n      return { skip: ExceptionInsightFixSkip.ExceptionClosed };",
    );
    expect(page).toContain(
      "With **Archive exceptions that are expected** on, in the settings of AI Insights,",
    );
    expect(section).toContain(
      "With **Archive exceptions that are expected** on, an expected denial is archived instead, and gets no pull request.",
    );
  });

  it("says one opens on its own only for an exception raised in your own code, and pauses once a person closes one", () => {
    // A frame of the application's own code in the stack trace, or none.
    expect(
      isExceptionRaisedInOwnCode({
        ownCodeFrames: [
          {
            functionName: "getOrder",
            fileName: "src/orders.ts",
            lineNumber: 42,
          },
        ],
      }),
    ).toBe(true);
    expect(isExceptionRaisedInOwnCode({ ownCodeFrames: [] })).toBe(false);

    const fix: string = readSource(
      "Common/Server/Utils/AI/TelemetryAi/ExceptionInsightFix.ts",
    );

    expect(fix).toContain("ExceptionInsightFixSkip.NotOwnCode");
    expect(fix).toContain("if (exception.aiFixDeclinedAt) {");
    expect(section).toContain(
      "OneUptime AI opens one on its own only for an exception raised in your own code: one whose stack trace has a frame of your code, not only frames of libraries or the runtime.",
    );
    expect(section).toContain(
      "A pull request someone closed without merging pauses the automatic ones for that exception.",
    );
  });

  it("names the switch as the Settings page draws it, on for new projects", () => {
    const switches: ReadonlyArray<{ column: string; title: string }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception];

    expect(switches).toHaveLength(1);
    expect(switches[0]!.column).toBe(lane.switchColumn);
    expect(section).toContain(
      `holds the switch **${switches[0]!.title}**, on for new projects`,
    );

    const projectService: string = readSource(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = projectService.slice(
      projectService.indexOf("NEW_PROJECT_AI_DEFAULT_COLUMNS"),
    );

    expect(defaults).toContain('"enableAutomaticExceptionRemediation"');
  });

  it("says that while it is off, new and rising exceptions are AI Insights' as before", () => {
    expect([...(lane.sharedWithAiInsightsInsightTypes || [])]).toEqual([
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]);
    expect(readPage("en", "ai/ai-sre")).toContain(
      "## Insights — proactive detection",
    );
    expect(section).toContain(
      "While it is off, new and rising exceptions are AI Insights' as before: see [AI SRE](/docs/ai/ai-sre#insights-proactive-detection).",
    );
  });

  it("gives the paths of Exceptions' AI tab as its side menu draws it", () => {
    const sideMenu: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Exceptions/AI/SideMenu.tsx",
    );
    const tabs: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsNavTabs.tsx",
    );

    expect(tabs).toContain('label: "AI"');
    expect(sideMenu).toContain('title: "AI"');

    for (const item of ["Insights", "Logs", "Settings"]) {
      expect(sideMenu).toContain(`title: "${item}"`);
      expect(section).toContain(`**Exceptions → AI → ${item}**`);
    }
  });

  it("names the rules' answers as their form draws them", () => {
    const options: Array<CardSelectOption> = getTelemetryAiFixOptions(
      TelemetryAiLane.Exception,
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
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].timing;

    expect(section).toContain(
      `**${timing[InvestigationRuleTiming.RightAway].title}**, or **${timing[InvestigationRuleTiming.AfterWait].title}**`,
    );
  });

  it("names the finding's ways into Exceptions as its links draw them", () => {
    // Read from the source: the link util needs a browser to load.
    const links: string = readSource(
      "App/FeatureSet/Dashboard/src/Utils/AIInsightExplorerLinks.ts",
    );
    const missingStackTraces: string = links.slice(
      links.indexOf("case AIInsightType.ExceptionMissingStackTrace: {"),
    );

    expect(links).toContain('label: "View Exception Group"');
    expect(missingStackTraces).toContain(
      "RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route",
    );
    expect(missingStackTraces).toContain('label: "Open in Exceptions"');
    expect(section).toContain(
      "**View Exception Group** opens the exception, and on a service's missing stack traces, **Open in Exceptions** opens its unresolved exceptions from the last day.",
    );
  });

  it("says a pull request needs a repository connected in Code, as the switch's note says", () => {
    const switches: ReadonlyArray<{ note?: string | undefined }> =
      TELEMETRY_AI_SWITCHES[TelemetryAiLane.Exception];

    expect(switches[0]!.note).toBe("Needs a repository connected in Code.");
    expect(section).toContain(
      "OneUptime AI needs a repository connected in [Code](/docs/ai/ai-agent)",
    );
    expect(section).not.toContain("GitHub");
  });

  it("says a pull request opens for each exception OneUptime AI can fix, as the settings page says it", () => {
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].advancedDefaultsSummary,
    ).toContain("opens a pull request for each one it can fix");
    expect(section).toContain(
      "With no rule, OneUptime AI looks into every exception it finds right away, and opens a pull request for each one it can fix.",
    );
    /*
     * The opening says it the same way: a new or rising exception's pull
     * request waits for the verdict and your own code, so not every
     * finding gets one.
     */
    expect(section).toContain(
      "OneUptime AI then looks into each one and opens a pull request for the ones it can fix.",
    );
    expect(section).not.toContain("opens a pull request for it.");
  });

  it("says Logs show what each investigation found, as the lane's Logs say it", () => {
    const verdicts: Readonly<Record<string, string | undefined>> =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].investigationVerdicts ||
      {};

    // Every verdict an investigation can reach has its words in Logs.
    expect(Object.keys(verdicts).sort()).toEqual(
      [...Object.values(ErrorClass)].sort(),
    );
    expect(section).toContain(
      "- **Exceptions → AI → Logs** lists every investigation and pull request, newest first, with how each one stands and what each investigation found.",
    );
  });

  it("says how many pull requests OneUptime AI opens on its own a day", () => {
    expect(section).toContain(
      `OneUptime AI opens at most ${TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY} pull requests on its own each day (UTC), one for each finding`,
    );
  });

  it("says the pull request says why it was opened and links the exception, as the Runner writes it", () => {
    const handler: string = readSource(
      "Runner/TaskHandlers/ExceptionPullRequestTaskHandler.ts",
    );

    expect(handler).toContain("### Why this pull request");
    expect(handler).toContain("[Open the exception in OneUptime]");
    expect(section).toContain(
      "- The pull request says why it was opened, with a link to its finding. A new or rising exception's also links the exception, and shows on the exception's **AI Assistance** page.",
    );
  });
});
