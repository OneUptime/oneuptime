import AIService, {
  AUTONOMOUS_AI_FEATURES,
  AutonomousBudgetStatus,
} from "../../../Server/Services/AIService";
import SentinelInvestigationQueue from "../../../Server/Utils/AI/Sentinel/InvestigationQueue";
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

describe("SentinelInvestigationQueue budget skip", () => {
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

    await SentinelInvestigationQueue.enqueue({
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

    await SentinelInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectAlertId: ObjectID.generate(),
    });

    expect(create).not.toHaveBeenCalled();
  });

  test("leaves a queued run unclaimed when the budget is exhausted at claim time", async () => {
    // Concurrency cap passes…
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // …but the budget is exhausted.
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: true,
      limitInTokens: 100_000,
      usedTokensToday: 120_000,
    });
    const claim: jest.SpyInstance = jest.spyOn(AIRunService, "updateOneBy");

    await SentinelInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
  });
});
