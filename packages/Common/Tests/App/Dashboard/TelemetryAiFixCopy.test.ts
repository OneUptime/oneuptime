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
  test("Traces' and Logs' kinds, while open and with no fix linked", () => {
    expect(TELEMETRY_AI_FIX_LANES).toEqual([
      TelemetryAiLane.Trace,
      TelemetryAiLane.Log,
    ]);

    for (const insightType of [
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Trace].insightTypes,
      ...TELEMETRY_AI_LANES[TelemetryAiLane.Log].insightTypes,
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
      AIInsightType.NewException,
      // AI Insights' own error-log spike is not a Logs finding.
      AIInsightType.ErrorLogSpike,
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
    // A button that cannot be pressed yet looks it.
    expect(button).toContain("disabled:opacity-50");
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
