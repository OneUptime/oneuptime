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
  AI_REMEDIATION_EXECUTION_FEATURE,
  AI_REMEDIATION_PLANNING_FEATURE,
  RUNBOOK_AI_STEP_FEATURE,
  WORKFLOW_AI_FEATURE,
} from "../../../Server/Services/AIService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIRunService from "../../../Server/Services/AIRunService";
import Project from "../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LlmType from "../../../Types/LLM/LlmType";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * G4 daily budget: incident and alert work have independent per-UTC-day token
 * lanes; subjectless work retains Project.aiDailyAutonomousTokenLimit. The
 * engine skips new investigations quietly when its lane is exhausted (no Error
 * run created); AIService.executeWithLogging is the hard backstop mid-run.
 * Interactive chat is never blocked — its features are not autonomous.
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

function fakeProjectWithLaneLimits(data: {
  subjectless?: number | undefined;
  incident?: number | undefined;
  alert?: number | undefined;
}): Project {
  return {
    id: ObjectID.generate(),
    aiDailyAutonomousTokenLimit: data.subjectless,
    incidentAiDailyAutonomousTokenLimit: data.incident,
    alertAiDailyAutonomousTokenLimit: data.alert,
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
    expect(AI_REMEDIATION_PLANNING_FEATURE).toBe("AI Remediation Planning");
    expect(AI_REMEDIATION_EXECUTION_FEATURE).toBe("AI Remediation Execution");
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
      AI_REMEDIATION_PLANNING_FEATURE,
      AI_REMEDIATION_EXECUTION_FEATURE,
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
        AI_REMEDIATION_PLANNING_FEATURE,
        AI_REMEDIATION_EXECUTION_FEATURE,
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

  test("rejects a request carrying both subject types before reading project settings", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await expect(
      AIService.getAutonomousDailyBudgetStatus(projectId, {
        incidentId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/both an incident and an alert/);

    expect(findProject).not.toHaveBeenCalled();
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
    expect(LlmLogService.getTotalTokensUsedSince).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: undefined,
        alertId: undefined,
      }),
    );
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

  test("incident work selects the incident limit and incident aggregate lane", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        fakeProjectWithLaneLimits({
          subjectless: 900_000,
          incident: 100_000,
          alert: 200_000,
        }),
      );
    const getTokens: jest.SpyInstance = jest
      .spyOn(LlmLogService, "getTotalTokensUsedSince")
      .mockResolvedValue(99_999);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId, { incidentId });

    expect(status).toEqual({
      exhausted: false,
      limitInTokens: 100_000,
      usedTokensToday: 99_999,
    });
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          aiDailyAutonomousTokenLimit: true,
          incidentAiDailyAutonomousTokenLimit: true,
          alertAiDailyAutonomousTokenLimit: true,
        },
      }),
    );
    expect(getTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId,
        alertId: undefined,
        legacyIncidentFeatures: expect.arrayContaining([
          AI_INCIDENT_INVESTIGATION_FEATURE,
          AI_INVESTIGATION_GRADING_FEATURE,
          "Sentinel Incident Investigation",
          "Sentinel Investigation Grading",
        ]),
        legacyAlertFeatures: expect.arrayContaining([
          AI_ALERT_INVESTIGATION_FEATURE,
          "Sentinel Alert Investigation",
        ]),
      }),
    );
  });

  test("alert work selects the alert limit and alert aggregate lane", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      fakeProjectWithLaneLimits({
        subjectless: 900_000,
        incident: 100_000,
        alert: 200_000,
      }),
    );
    const getTokens: jest.SpyInstance = jest
      .spyOn(LlmLogService, "getTotalTokensUsedSince")
      .mockResolvedValue(200_000);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId, { alertId });

    expect(status).toEqual({
      exhausted: true,
      limitInTokens: 200_000,
      usedTokensToday: 200_000,
    });
    expect(getTokens).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: undefined, alertId }),
    );
  });

  test("a missing incident limit does not fall back to the legacy subjectless limit", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      fakeProjectWithLaneLimits({
        subjectless: 1,
        incident: undefined,
        alert: 2,
      }),
    );
    const getTokens: jest.SpyInstance = jest.spyOn(
      LlmLogService,
      "getTotalTokensUsedSince",
    );

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId, {
        incidentId: ObjectID.generate(),
      });

    expect(status).toEqual({
      exhausted: false,
      limitInTokens: null,
      usedTokensToday: 0,
    });
    expect(getTokens).not.toHaveBeenCalled();
  });

  test("one lane can be paused without pausing the other lane", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      fakeProjectWithLaneLimits({
        subjectless: 0,
        incident: 0,
        alert: 50,
      }),
    );
    const getTokens: jest.SpyInstance = jest
      .spyOn(LlmLogService, "getTotalTokensUsedSince")
      .mockResolvedValue(49);

    const incidentStatus: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId, { incidentId });
    const alertStatus: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(projectId, { alertId });

    expect(incidentStatus.exhausted).toBe(true);
    expect(alertStatus).toEqual({
      exhausted: false,
      limitInTokens: 50,
      usedTokensToday: 49,
    });
    expect(getTokens).toHaveBeenCalledTimes(1);
    expect(getTokens).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: undefined, alertId }),
    );
  });
});

describe("LlmLogService autonomous-token lane isolation", () => {
  type QueryCall = [string, Array<unknown>];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockTokenQuery(): jest.Mock {
    const query: jest.Mock = jest.fn().mockResolvedValue([{ total: "17" }]);
    jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
      manager: { query },
    } as any);
    return query;
  }

  async function aggregateFor(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<string> {
    const query: jest.Mock = mockTokenQuery();

    await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: new Date("2026-08-07T00:00:00.000Z"),
      features: [AI_INCIDENT_INVESTIGATION_FEATURE],
      ...data,
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    return sql;
  }

  test("incident aggregates include only incident-linked logs", async () => {
    const sql: string = await aggregateFor({
      incidentId: ObjectID.generate(),
    });

    expect(sql).toContain('"incidentId" IS NOT NULL');
    expect(sql).toContain('"alertId" IS NULL');
  });

  test("alert aggregates include only alert-linked logs", async () => {
    const sql: string = await aggregateFor({ alertId: ObjectID.generate() });

    expect(sql).toContain('"incidentId" IS NULL');
    expect(sql).toContain('"alertId" IS NOT NULL');
  });

  test("subjectless aggregates require both subject ids to be null", async () => {
    const sql: string = await aggregateFor({});

    expect(sql).toContain(
      '"log"."incidentId" IS NULL AND "log"."alertId" IS NULL',
    );
  });

  test("legacy rows are attributed by feature or their linked AI run", async () => {
    const query: jest.Mock = mockTokenQuery();
    const legacyIncidentFeatures: Array<string> = [
      AI_INCIDENT_INVESTIGATION_FEATURE,
    ];
    const legacyAlertFeatures: Array<string> = [AI_ALERT_INVESTIGATION_FEATURE];

    await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: new Date("2026-08-07T00:00:00.000Z"),
      features: AUTONOMOUS_AI_FEATURES,
      incidentId: ObjectID.generate(),
      legacyIncidentFeatures,
      legacyAlertFeatures,
    });

    const [sql, params] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('"log"."feature" = ANY($4)');
    expect(sql).toContain('FROM "AIRun" AS "run"');
    expect(sql).toContain('"run"."triggeredByIncidentId" IS NOT NULL');
    expect(params[3]).toEqual(legacyIncidentFeatures);
    expect(params[4]).toEqual(legacyAlertFeatures);
  });

  test("subjectless totals exclude identifiable legacy incident and alert rows", async () => {
    const query: jest.Mock = mockTokenQuery();

    await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: new Date("2026-08-07T00:00:00.000Z"),
      features: AUTONOMOUS_AI_FEATURES,
      legacyIncidentFeatures: [AI_INCIDENT_INVESTIGATION_FEATURE],
      legacyAlertFeatures: [AI_ALERT_INVESTIGATION_FEATURE],
    });

    const [sql] = query.mock.calls[0] as QueryCall;
    expect(sql).toContain('NOT ("log"."feature" = ANY($4))');
    expect(sql).toContain('NOT ("log"."feature" = ANY($5))');
    expect(sql).toContain('NOT (EXISTS (SELECT 1 FROM "AIRun" AS "run"');
  });

  test("rejects a dual-lane aggregate before running SQL", async () => {
    const query: jest.Mock = mockTokenQuery();

    await expect(
      LlmLogService.getTotalTokensUsedSince({
        projectId: ObjectID.generate(),
        since: new Date("2026-08-07T00:00:00.000Z"),
        features: [AI_INCIDENT_INVESTIGATION_FEATURE],
        incidentId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/both the incident and alert lanes/);

    expect(query).not.toHaveBeenCalled();
  });
});

describe("AIService.executeWithLogging autonomous lane forwarding", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects dual-subject logging before resolving a provider", async () => {
    const getProvider: jest.SpyInstance = jest.spyOn(
      LlmProviderService,
      "getProviderForChat",
    );

    await expect(
      AIService.executeWithLogging({
        projectId: ObjectID.generate(),
        incidentId: ObjectID.generate(),
        alertId: ObjectID.generate(),
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
        messages: [{ role: "user", content: "investigate" }],
      }),
    ).rejects.toThrow(/both an incident and an alert/);

    expect(getProvider).not.toHaveBeenCalled();
  });

  test("forwards subject identity to the hard budget backstop", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const aiRunId: ObjectID = ObjectID.generate();
    jest.spyOn(LlmProviderService, "getProviderForChat").mockResolvedValue({
      id: ObjectID.generate(),
      llmType: LlmType.OpenAI,
      isGlobalLlm: false,
    } as unknown as LlmProvider);
    const budget: jest.SpyInstance = jest
      .spyOn(AIService, "getAutonomousDailyBudgetStatus")
      .mockResolvedValue({
        exhausted: false,
        limitInTokens: 1_000,
        usedTokensToday: 10,
      });
    jest.spyOn(LLMService, "getCompletion").mockResolvedValue({
      content: "done",
      usage: { totalTokens: 1 },
    } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
    const createLog: jest.SpyInstance = jest
      .spyOn(LlmLogService, "create")
      .mockResolvedValue(new LlmLog());

    await AIService.executeWithLogging({
      projectId,
      incidentId,
      aiRunId,
      feature: AI_INCIDENT_INVESTIGATION_FEATURE,
      messages: [{ role: "user", content: "investigate" }],
    });

    expect(budget).toHaveBeenCalledWith(projectId, {
      incidentId,
      alertId: undefined,
    });
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId,
          alertId: undefined,
          aiRunId,
        }),
      }),
    );
  });
});

describe("AIInvestigationQueue budget skip", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("does not enqueue when the daily budget is exhausted", async () => {
    const budget: jest.SpyInstance = jest
      .spyOn(AIService, "getAutonomousDailyBudgetStatus")
      .mockResolvedValue({
        exhausted: true,
        limitInTokens: 100_000,
        usedTokensToday: 120_000,
      });
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");
    const projectId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();

    await AIInvestigationQueue.enqueue({
      projectId,
      subjectAlertId: alertId,
    });

    expect(create).not.toHaveBeenCalled();
    expect(budget).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId,
    });
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
    // No alert-lane cap override; concurrency cap passes…
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject(undefined));
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // …but the budget is exhausted.
    const budget: jest.SpyInstance = jest
      .spyOn(AIService, "getAutonomousDailyBudgetStatus")
      .mockResolvedValue({
        exhausted: true,
        limitInTokens: 100_000,
        usedTokensToday: 120_000,
      });
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    const projectId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAlertId: alertId,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(budget).toHaveBeenCalledWith(projectId, {
      incidentId: undefined,
      alertId,
    });
  });
});
