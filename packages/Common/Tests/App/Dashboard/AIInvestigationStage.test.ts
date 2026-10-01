import {
  AIInvestigationStage,
  getAIInvestigationStage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI Investigation card closes with the conversation in every state, and
 * tells it one thing about the investigation above: is there a report to
 * read, is one coming, or neither. The conversation says "follow-up" only
 * under a report, and leads its suggestions with the root-cause question
 * only when no report is coming, so a wrong stage shows as wrong copy.
 */

interface StageInput {
  isChecking: boolean;
  runStatus: AIRunStatus | null | undefined;
  hasReport: boolean;
  isReportPending: boolean;
}

function stage(overrides: Partial<StageInput>): AIInvestigationStage {
  return getAIInvestigationStage({
    isChecking: false,
    runStatus: null,
    hasReport: false,
    isReportPending: false,
    ...overrides,
  });
}

describe("getAIInvestigationStage", () => {
  test("while the card is still asking, nothing is known", () => {
    expect(stage({ isChecking: true })).toBe("checking");
  });

  test("checking wins over whatever the last subject left behind", () => {
    // A page that moved to another incident still holds the old run's state.
    expect(
      stage({
        isChecking: true,
        runStatus: AIRunStatus.Completed,
        hasReport: true,
      }),
    ).toBe("checking");
    expect(stage({ isChecking: true, runStatus: AIRunStatus.Running })).toBe(
      "checking",
    );
  });

  test.each([[null], [undefined]])(
    "no run (%s) leaves nothing to read",
    (runStatus: null | undefined) => {
      expect(stage({ runStatus })).toBe("none");
    },
  );

  test.each([[AIRunStatus.Queued], [AIRunStatus.Running]])(
    "a %s run is underway",
    (runStatus: AIRunStatus) => {
      expect(stage({ runStatus })).toBe("underway");
    },
  );

  test("a completed run with a report on screen is reported", () => {
    expect(stage({ runStatus: AIRunStatus.Completed, hasReport: true })).toBe(
      "reported",
    );
  });

  test("a report on screen counts even while the server says more is pending", () => {
    expect(
      stage({
        runStatus: AIRunStatus.Completed,
        hasReport: true,
        isReportPending: true,
      }),
    ).toBe("reported");
  });

  test("a completed run whose report is still being written is underway", () => {
    expect(
      stage({ runStatus: AIRunStatus.Completed, isReportPending: true }),
    ).toBe("underway");
  });

  test("a completed run that published no report leaves nothing to read", () => {
    expect(stage({ runStatus: AIRunStatus.Completed })).toBe("none");
  });

  test.each([
    [AIRunStatus.Error],
    [AIRunStatus.Cancelled],
    [AIRunStatus.Stale],
    [AIRunStatus.NoFixFound],
    [AIRunStatus.WaitingForApproval],
  ])("a run that ended as %s will not report", (runStatus: AIRunStatus) => {
    expect(stage({ runStatus })).toBe("none");
  });

  test("a stopped run is not rescued by a stale report or pending flag", () => {
    // Only a Completed run's report is shown, so only it can be 'reported'.
    expect(
      stage({
        runStatus: AIRunStatus.Error,
        hasReport: true,
        isReportPending: true,
      }),
    ).toBe("none");
  });

  test("every run status maps to a stage the conversation knows", () => {
    const known: Array<AIInvestigationStage> = [
      "checking",
      "underway",
      "reported",
      "none",
    ];

    for (const runStatus of Object.values(AIRunStatus)) {
      for (const hasReport of [true, false]) {
        for (const isReportPending of [true, false]) {
          expect(known).toContain(
            stage({ runStatus, hasReport, isReportPending }),
          );
        }
      }
    }
  });

  test("'reported' is only ever reached with a report", () => {
    for (const runStatus of [...Object.values(AIRunStatus), null]) {
      for (const isReportPending of [true, false]) {
        expect(
          stage({ runStatus, hasReport: false, isReportPending }),
        ).not.toBe("reported");
      }
    }
  });
});
