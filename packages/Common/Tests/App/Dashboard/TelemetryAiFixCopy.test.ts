import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_AI_FIX_COPY,
  TELEMETRY_AI_FIX_LANES,
  TELEMETRY_AI_FIX_LEAD,
  TELEMETRY_AI_FIX_LEADS,
  doesInsightOfferTelemetryAiFix,
  getTelemetryAiFixLead,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import ObjectID from "../../../Types/ObjectID";

/*
 * Which findings draw "Fix with AI" (TelemetryAiFixStrip) and what it says:
 * Traces' open findings with no fix yet - the Profiler's draw the
 * Profiler's own - each kind with a line of what the pull request does.
 * The strip's other words are the Profiler's, said the same way.
 */

const LINE_LIMIT: number = 150;

describe("which findings draw Fix with AI", () => {
  test("Traces' kinds, while open and with no fix linked", () => {
    expect(TELEMETRY_AI_FIX_LANES).toEqual([TelemetryAiLane.Trace]);

    for (const insightType of TELEMETRY_AI_LANES[TelemetryAiLane.Trace]
      .insightTypes) {
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
      AIInsightType.NewException,
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
