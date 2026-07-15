import AIService, {
  AUTONOMOUS_AI_FEATURES,
  AutonomousBudgetStatus,
  LEGACY_AUTONOMOUS_AI_FEATURES,
  AI_ALERT_INVESTIGATION_FEATURE,
  AI_CODE_FIX_FEATURE,
  AI_CONFIDENCE_CLASSIFICATION_FEATURE,
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AI_INSIGHT_TRIAGE_FEATURE,
  AI_INVESTIGATION_GRADING_FEATURE,
  RUNBOOK_AI_STEP_FEATURE,
  WORKFLOW_AI_FEATURE,
} from "../../../Server/Services/AIService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIRunService from "../../../Server/Services/AIRunService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * G4 daily budget: Project.aiDailyAutonomousTokenLimit bounds the tokens the
 * AUTONOMOUS_AI_FEATURES may consume per UTC day. The engine skips new
 * investigations quietly when the budget is exhausted (no Error run created);
 * AIService.executeWithLogging is the hard backstop mid-run. Interactive chat
 * is never blocked — its features are not in AUTONOMOUS_AI_FEATURES.
 *
 * These tests mock the persistence layer and lock in:
 *   (a) no limit configured => never exhausted, and no usage query is run;
 *   (b) usage below the limit => not exhausted;
 *   (c) usage at/over the limit => exhausted, with the numbers reported;
 *   (d) the engine skips run creation when the budget is exhausted.
 */

function fakeProject(limit: number | undefined): Project {
  return {
    id: ObjectID.generate(),
    aiDailyAutonomousTokenLimit: limit,
  } as unknown as Project;
}

/*
 * The budget is enforced by matching PERSISTED LlmLog.feature strings against
 * AUTONOMOUS_AI_FEATURES, so these labels are data, not display text. Changing
 * one silently rewrites a project's usage history for the current UTC day:
 * older rows stop matching, usedTokensToday collapses toward zero, and an
 * already-exhausted project gets a fresh full budget. These tests pin the
 * exact wire values and the legacy aliases so no rename can do that quietly.
 */
describe("AUTONOMOUS_AI_FEATURES persisted labels", () => {
  test("each label has its exact persisted value", () => {
    expect(AI_INCIDENT_INVESTIGATION_FEATURE).toBe("AI Incident Investigation");
    expect(AI_ALERT_INVESTIGATION_FEATURE).toBe("AI Alert Investigation");
    expect(AI_INVESTIGATION_GRADING_FEATURE).toBe("AI Investigation Grading");
    expect(AI_CONFIDENCE_CLASSIFICATION_FEATURE).toBe(
      "AI Confidence Classification",
    );
    expect(AI_CODE_FIX_FEATURE).toBe("AI Code Fix");
    expect(AI_INSIGHT_TRIAGE_FEATURE).toBe("AI Insight Triage");
    expect(RUNBOOK_AI_STEP_FEATURE).toBe("Runbook AI Step");
    expect(WORKFLOW_AI_FEATURE).toBe("Workflow AI");
  });

  test("the budget match-list covers every autonomous feature", () => {
    for (const feature of [
      AI_INCIDENT_INVESTIGATION_FEATURE,
      AI_ALERT_INVESTIGATION_FEATURE,
      AI_INVESTIGATION_GRADING_FEATURE,
      AI_CONFIDENCE_CLASSIFICATION_FEATURE,
      AI_CODE_FIX_FEATURE,
      AI_INSIGHT_TRIAGE_FEATURE,
      RUNBOOK_AI_STEP_FEATURE,
      WORKFLOW_AI_FEATURE,
    ]) {
      expect(AUTONOMOUS_AI_FEATURES).toContain(feature);
    }
  });

  /*
   * The budget hole this guards: the six labels below were persisted by the
   * pre-rename code. Dropping them from the match-list stops LlmLog rows that
   * ALREADY carry them from counting — during the deploy window (old and new
   * pods write different labels into the same UTC day) and for any row the
   * backfill migration missed. A future cleanup must fail here and go read the
   * retention argument in AIService before deleting them.
   */
  test("the six legacy Sentinel labels are still counted by the budget", () => {
    expect(LEGACY_AUTONOMOUS_AI_FEATURES).toEqual([
      "Sentinel Incident Investigation",
      "Sentinel Alert Investigation",
      "Sentinel Investigation Grading",
      "Sentinel Confidence Classification",
      "Sentinel Code Fix",
      "Sentinel Insight Triage",
    ]);

    for (const legacyFeature of LEGACY_AUTONOMOUS_AI_FEATURES) {
      expect(AUTONOMOUS_AI_FEATURES).toContain(legacyFeature);
    }
  });

  /*
   * Nothing but the constants and the legacy aliases may reach the list — a
   * raw literal here is how a writer and the budget silently drift apart.
   */
  test("the match-list is exactly the current labels plus the legacy aliases", () => {
    expect([...AUTONOMOUS_AI_FEATURES].sort()).toEqual(
      [
        AI_INCIDENT_INVESTIGATION_FEATURE,
        AI_ALERT_INVESTIGATION_FEATURE,
        AI_INVESTIGATION_GRADING_FEATURE,
        AI_CONFIDENCE_CLASSIFICATION_FEATURE,
        AI_CODE_FIX_FEATURE,
        AI_INSIGHT_TRIAGE_FEATURE,
        RUNBOOK_AI_STEP_FEATURE,
        WORKFLOW_AI_FEATURE,
        ...LEGACY_AUTONOMOUS_AI_FEATURES,
      ].sort(),
    );
  });
});

describe("AIService.getAutonomousDailyBudgetStatus", () => {
  const projectId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no configured limit means never exhausted and no usage query", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject(undefined));
    const getTokens: jest.SpyInstance = jest.spyOn(
      LlmLogService,
      "getTotalTokensUsedSince",
    );

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId);

    expect(status.exhausted).toBe(false);
    expect(status.limitInTokens).toBeNull();
    expect(getTokens).not.toHaveBeenCalled();
  });

  test("a limit of 0 pauses autonomous runs without querying usage", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject(0));
    const getTokens: jest.SpyInstance = jest.spyOn(
      LlmLogService,
      "getTotalTokensUsedSince",
    );

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId);

    expect(status.exhausted).toBe(true);
    expect(status.limitInTokens).toBe(0);
    expect(getTokens).not.toHaveBeenCalled();
  });

  test("usage below the limit is not exhausted", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject(100_000));
    jest
      .spyOn(LlmLogService, "getTotalTokensUsedSince")
      .mockResolvedValue(99_999);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId);

    expect(status.exhausted).toBe(false);
    expect(status.limitInTokens).toBe(100_000);
    expect(status.usedTokensToday).toBe(99_999);
  });

  test("usage at the limit is exhausted, scoped to autonomous features", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject(100_000));
    const getTokens: jest.SpyInstance = jest
      .spyOn(LlmLogService, "getTotalTokensUsedSince")
      .mockResolvedValue(100_000);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId);

    expect(status.exhausted).toBe(true);
    expect(getTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        features: AUTONOMOUS_AI_FEATURES,
      }),
    );
  });
});

describe("AIInvestigationQueue budget skip", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does not enqueue when the daily budget is exhausted", async () => {
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: true,
      limitInTokens: 100_000,
      usedTokensToday: 120_000,
    });
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await AIInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectAlertId: ObjectID.generate(),
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("does not enqueue when the budget check itself fails", async () => {
    jest
      .spyOn(AIService, "getAutonomousDailyBudgetStatus")
      .mockRejectedValue(new Error("db down"));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await AIInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectAlertId: ObjectID.generate(),
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("leaves a queued run unclaimed when the budget is exhausted at claim time", async () => {
    // No per-project cap override; concurrency cap passes…
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject(undefined));
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // …but the budget is exhausted.
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: true,
      limitInTokens: 100_000,
      usedTokensToday: 120_000,
    });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
  });
});
