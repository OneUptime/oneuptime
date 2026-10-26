import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FIX_STRIP_ACTION_CONTAINER_CLASS_NAME,
  FIX_STRIP_ACTION_ROW_CLASS_NAME,
  FIX_STRIP_BUTTON_CLASS_NAME,
  FIX_STRIP_PICKER_CLASS_NAME,
  TELEMETRY_AI_FIX_COPY,
  TELEMETRY_AI_FIX_LANES,
  TELEMETRY_AI_FIX_LEAD,
  TELEMETRY_AI_FIX_LEADS,
  TELEMETRY_AI_FIX_LEADS_BY_RECIPE,
  TELEMETRY_AI_FIX_NO_TRACE_CONTEXT_LEAD,
  TELEMETRY_AI_FIX_LEAD_METRIC_NAMES,
  doesInsightOfferTelemetryAiFix,
  getTelemetryAiFixLead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsightEvidence from "../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import ObjectID from "../../../Types/ObjectID";
import { LogLoggingGap } from "../../../Utils/Logs/LogInsight";

/*
 * Which findings draw "Fix with AI" (TelemetryAiFixStrip) and what it says:
 * Traces' open findings with no fix yet - the Profiler's draw the
 * Profiler's own - each kind with a line of what the pull request does.
 * The strip's other words are the Profiler's, said the same way.
 */

const LINE_LIMIT: number = 150;

// High Cardinality by its names: metric names with IDs in them.
const METRIC_NAMES_EVIDENCE: AIInsightEvidence = {
  metric: {
    serviceId: "s",
    kind: "HighCardinality",
    shape: "Name",
    windowStartTime: "2026-10-24T08:00:00.000Z",
    windowEndTime: "2026-10-24T09:00:00.000Z",
    namePattern: "job.{id}.duration",
  },
};

describe("which findings draw Fix with AI", () => {
  test("Traces', Exceptions', Logs' and Metrics' kinds, while open and with no fix linked", () => {
    expect(TELEMETRY_AI_FIX_LANES).toEqual([
      TelemetryAiLane.Trace,
      TelemetryAiLane.Exception,
      TelemetryAiLane.Log,
      TelemetryAiLane.Metric,
    ]);

    for (const insightType of [
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Trace].insightTypes,
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Exception].insightTypes,
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes,
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Metric].insightTypes,
    ]) {
      for (const status of [
        AIInsightStatus.Detected,
        AIInsightStatus.ActionRequired,
        AIInsightStatus.FixOpened,
      ]) {
        expect(doesInsightOfferTelemetryAiFix({ insightType, status })).toBe(
          true,
        );
      }

      expect(
        doesInsightOfferTelemetryAiFix({
          insightType,
          status: AIInsightStatus.ActionRequired,
          fixAiRunId: ObjectID.generate(),
        }),
      ).toBe(false);

      for (const status of [
        AIInsightStatus.Resolved,
        AIInsightStatus.Dismissed,
        null,
        undefined,
      ]) {
        expect(doesInsightOfferTelemetryAiFix({ insightType, status })).toBe(
          false,
        );
      }
    }
  });

  test("never the Profiler's, nor AI Insights' own", () => {
    for (const insightType of [
      AIInsightType.ProfileHotspot,
      AIInsightType.TraceLatencyRegression,
      // AI Insights' own error-log spike is not a Logs finding.
      AIInsightType.ErrorLogSpike,
      // AI Insights' week-over-week drift is a heads-up, never a fix.
      AIInsightType.MetricDrift,
      "Unknown",
      undefined,
    ]) {
      expect(
        doesInsightOfferTelemetryAiFix({
          insightType,
          status: AIInsightStatus.ActionRequired,
        }),
      ).toBe(false);
    }
  });
});

describe("what Fix with AI says", () => {
  test("each of Traces' kinds has its own line, short enough for two lines", () => {
    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Trace]
      .insightTypes) {
      const lead: string | undefined = TELEMETRY_AI_FIX_LEADS[insightType];

      expect(lead).toBeTruthy();
      expect(lead!.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(lead).toContain("pull request");
      expect(getTelemetryAiFixLead(insightType)).toBe(lead);
    }

    expect(getTelemetryAiFixLead("Unknown")).toBe(TELEMETRY_AI_FIX_LEAD);
  });

  test("each of Exceptions' kinds has its own line too: a fix, or stack traces recorded", () => {
    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Exception]
      .insightTypes) {
      const lead: string | undefined = TELEMETRY_AI_FIX_LEADS[insightType];

      expect(lead).toBeTruthy();
      expect(lead!.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(lead).toContain("pull request");
      expect(getTelemetryAiFixLead(insightType)).toBe(lead);
    }

    expect(getTelemetryAiFixLead(AIInsightType.NewException)).toBe(
      "OneUptime AI opens a pull request that fixes this exception, for you to review.",
    );
    expect(
      getTelemetryAiFixLead(AIInsightType.ExceptionMissingStackTrace),
    ).toBe(
      "OneUptime AI opens a pull request that makes this service record stack traces, for you to review.",
    );
  });

  test("each of Metrics' kinds says what its pull request does, short enough for two lines", () => {
    const leads: Array<string> = [];

    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Metric]
      .insightTypes) {
      const lead: string | undefined = TELEMETRY_AI_FIX_LEADS[insightType];

      expect(lead).toBeTruthy();
      expect(lead!.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(lead).toContain("pull request");
      expect(lead).toMatch(/for you to review\.$/u);
      expect(getTelemetryAiFixLead(insightType)).toBe(lead);
      leads.push(lead!);
    }

    // Three kinds, three different pull requests.
    expect(new Set(leads).size).toBe(3);
    expect(TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHighCardinality]).toBe(
      "OneUptime AI opens a pull request that stops recording these values on the metric, for you to review.",
    );
    expect(TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHistogramBuckets]).toBe(
      "OneUptime AI opens a pull request that gives this histogram buckets that fit its values, for you to review.",
    );
    expect(TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricMissingMetrics]).toBe(
      "OneUptime AI opens a pull request that adds metrics to this service, for you to review.",
    );
  });

  test("metric names with IDs say their own pull request: the IDs come out of the names", () => {
    expect(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES).toBe(
      "OneUptime AI opens a pull request that takes the IDs out of these metric names, for you to review.",
    );
    expect(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES.length).toBeLessThanOrEqual(
      LINE_LIMIT,
    );
    // Not the attribute's line: nothing is "recorded on the metric" there.
    expect(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES).not.toBe(
      TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHighCardinality],
    );

    expect(
      getTelemetryAiFixLead(
        AIInsightType.MetricHighCardinality,
        undefined,
        METRIC_NAMES_EVIDENCE,
      ),
    ).toBe(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES);
  });

  test("every other finding says its kind's line", () => {
    const attribute: AIInsightEvidence = {
      metric: {
        serviceId: "s",
        kind: "HighCardinality",
        shape: "Attribute",
        windowStartTime: "2026-10-24T08:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        attributeKey: "user.id",
      },
    };

    expect(
      getTelemetryAiFixLead(
        AIInsightType.MetricHighCardinality,
        undefined,
        attribute,
      ),
    ).toBe(TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHighCardinality]);
    // A finding with no evidence, or of another kind, has nothing to add.
    expect(getTelemetryAiFixLead(AIInsightType.MetricHighCardinality)).toBe(
      TELEMETRY_AI_FIX_LEADS[AIInsightType.MetricHighCardinality],
    );

    for (const insightType of [
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
      AIInsightType.TraceSlowOperation,
      AIInsightType.MetricDrift,
    ]) {
      expect(
        getTelemetryAiFixLead(insightType, undefined, METRIC_NAMES_EVIDENCE),
      ).toBe(TELEMETRY_AI_FIX_LEADS[insightType] || TELEMETRY_AI_FIX_LEAD);
    }
  });

  test("an expected error says it is handled better, not fixed - whatever its kind", () => {
    const lead: string | undefined =
      TELEMETRY_AI_FIX_LEADS_BY_RECIPE[
        CodeFixTaskType.ImproveExceptionHandling
      ];

    expect(lead).toBe(
      "OneUptime AI opens a pull request that improves how your code handles this expected error, for you to review.",
    );
    expect(lead!.length).toBeLessThanOrEqual(LINE_LIMIT);

    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      expect(
        getTelemetryAiFixLead(
          insightType,
          CodeFixTaskType.ImproveExceptionHandling,
        ),
      ).toBe(lead);
      // A fix, or a recipe with no line of its own: the kind's line.
      expect(
        getTelemetryAiFixLead(insightType, CodeFixTaskType.FixException),
      ).toBe(TELEMETRY_AI_FIX_LEADS[insightType]);
      expect(getTelemetryAiFixLead(insightType, undefined)).toBe(
        TELEMETRY_AI_FIX_LEADS[insightType],
      );
    }

    expect(
      getTelemetryAiFixLead(
        AIInsightType.ExceptionMissingStackTrace,
        CodeFixTaskType.CodeRequest,
      ),
    ).toBe(TELEMETRY_AI_FIX_LEADS[AIInsightType.ExceptionMissingStackTrace]);
  });

  test("each of Logs' kinds says what its pull request does", () => {
    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Log]
      .insightTypes) {
      const lead: string | undefined = TELEMETRY_AI_FIX_LEADS[insightType];

      expect(lead).toBeTruthy();
      expect(lead!.length).toBeLessThanOrEqual(LINE_LIMIT);
      expect(lead).toContain("pull request");
      expect(lead).toContain("for you to review");
    }

    expect(getTelemetryAiFixLead(AIInsightType.LogErrorPattern)).toBe(
      "OneUptime AI opens a pull request that fixes why this error is logged, for you to review.",
    );
    expect(getTelemetryAiFixLead(AIInsightType.LogMissingLogging)).toBe(
      "OneUptime AI opens a pull request that adds the logging this lacks, for you to review.",
    );
    expect(getTelemetryAiFixLead(AIInsightType.LogNoisyPattern)).toBe(
      "OneUptime AI opens a pull request that logs this line less, for you to review.",
    );
  });

  /*
   * Missing logging has two gaps: failures that write no line get the
   * logging they lack, but logs with no trace context lack no line - their
   * pull request adds the trace id, and the lead says so.
   */
  test("missing logging says what its pull request adds, by what the logs lack", () => {
    expect(TELEMETRY_AI_FIX_NO_TRACE_CONTEXT_LEAD).toBe(
      "OneUptime AI opens a pull request that adds the trace id to this service's logs, for you to review.",
    );
    expect(TELEMETRY_AI_FIX_NO_TRACE_CONTEXT_LEAD.length).toBeLessThanOrEqual(
      LINE_LIMIT,
    );

    const logsLacking: (gap: string | undefined) => AIInsightEvidence = (
      gap: string | undefined,
    ): AIInsightEvidence => {
      return {
        log: {
          serviceId: ObjectID.generate().toString(),
          kind: "MissingLogging",
          ...(gap ? { gap } : {}),
          windowStartTime: "2026-10-24T08:00:00.000Z",
          windowEndTime: "2026-10-24T09:00:00.000Z",
          logCount: 18400,
        },
      };
    };

    expect(
      getTelemetryAiFixLead(
        AIInsightType.LogMissingLogging,
        undefined,
        logsLacking(LogLoggingGap.NoTraceContext),
      ),
    ).toBe(TELEMETRY_AI_FIX_NO_TRACE_CONTEXT_LEAD);

    // The pull request the server says it starts speaks first, as it does for every kind.
    expect(
      getTelemetryAiFixLead(
        AIInsightType.LogMissingLogging,
        CodeFixTaskType.ImproveExceptionHandling,
        logsLacking(LogLoggingGap.NoTraceContext),
      ),
    ).toBe(
      TELEMETRY_AI_FIX_LEADS_BY_RECIPE[
        CodeFixTaskType.ImproveExceptionHandling
      ],
    );

    // Failures that write no line, or no gap said: the logging they lack.
    for (const evidence of [
      logsLacking(LogLoggingGap.SilentFailures),
      logsLacking(undefined),
      {},
      null,
      undefined,
    ]) {
      expect(
        getTelemetryAiFixLead(
          AIInsightType.LogMissingLogging,
          undefined,
          evidence,
        ),
      ).toBe(TELEMETRY_AI_FIX_LEADS[AIInsightType.LogMissingLogging]);
    }

    // Only missing logging reads the gap: every other kind keeps its line.
    for (const insightType of [
      AIInsightType.LogErrorPattern,
      AIInsightType.LogNoisyPattern,
      AIInsightType.TraceMissingTracing,
      AIInsightType.TraceFailingOperation,
    ]) {
      expect(
        getTelemetryAiFixLead(
          insightType,
          undefined,
          logsLacking(LogLoggingGap.NoTraceContext),
        ),
      ).toBe(TELEMETRY_AI_FIX_LEADS[insightType]);
    }
  });

  test("the button and the rest read as the Profiler's own", () => {
    expect(TELEMETRY_AI_FIX_COPY).toEqual({
      button: "Fix with AI",
      pickRepository: "Which repository holds this code?",
      pickRepositoryPlaceholder: "Pick a repository",
      working: "OneUptime AI is working on it.",
      viewTask: "View the task",
      couldNotStart: "Could not start the fix: {{reason}}",
      connectRepository: "Connect a repository to fix this with AI",
    });
  });
});

/*
 * Where the picker and the button sit. A finding page draws the strip in a
 * narrow rail beside the evidence at a laptop's width: laid out by the
 * window's width (sm:flex-row), the two sat side by side there and the
 * button was squeezed into "Fix / with / AI". The strip's own width decides
 * now (a container query), and the button's words never wrap.
 */
describe("where Fix with AI's picker and button sit", () => {
  const DASHBOARD_COMPONENTS: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components",
  );

  function readComponent(...parts: Array<string>): string {
    return fs.readFileSync(path.join(DASHBOARD_COMPONENTS, ...parts), "utf8");
  }

  test("the strip is a size container, and side by side is keyed to it, never to the window", () => {
    expect(FIX_STRIP_ACTION_CONTAINER_CLASS_NAME).toContain(
      "[container-type:inline-size]",
    );

    const row: Array<string> = FIX_STRIP_ACTION_ROW_CLASS_NAME.split(" ");

    expect(row).toContain("flex-col");
    expect(row).toContain("[@container(min-width:26rem)]:flex-row");

    for (const className of [
      ...row,
      ...FIX_STRIP_PICKER_CLASS_NAME.split(" "),
    ]) {
      // No viewport breakpoint decides the layout.
      expect(className).not.toMatch(/^(sm|md|lg|xl|2xl):(flex-row|w-)/u);
    }

    expect(FIX_STRIP_PICKER_CLASS_NAME.split(" ")).toContain("w-full");
  });

  test("the button keeps its words on one line, at its own width when stacked", () => {
    const button: Array<string> = FIX_STRIP_BUTTON_CLASS_NAME.split(" ");

    expect(button).toContain("whitespace-nowrap");
    expect(button).toContain("self-start");
    // Beside the picker, it lines up with the picker's bottom.
    expect(button).toContain("[@container(min-width:26rem)]:self-end");
    // A button that cannot be pressed yet looks it: Button's own look.
    expect(button).not.toContain("disabled:opacity-50");
    expect(button).not.toContain("opacity-50");
  });

  test("both strips - Traces' and the Profiler's - use the one layout", () => {
    for (const file of [
      ["TelemetryAi", "TelemetryAiFixStrip.tsx"],
      ["Profiles", "ProfileFixStrip.tsx"],
    ]) {
      const source: string = readComponent(...file);

      expect(source).toContain(
        "className={FIX_STRIP_ACTION_CONTAINER_CLASS_NAME}",
      );
      expect(source).toContain("className={FIX_STRIP_ACTION_ROW_CLASS_NAME}");
      expect(source).toContain("className={FIX_STRIP_PICKER_CLASS_NAME}");
      expect(source).toContain("className={FIX_STRIP_BUTTON_CLASS_NAME}");
      expect(source).not.toContain("sm:flex-row sm:items-end");
    }
  });
});
