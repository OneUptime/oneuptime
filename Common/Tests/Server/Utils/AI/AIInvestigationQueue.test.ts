import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The durable investigation queue (Phase 2's first item — replaces detached
 * fire-and-forget investigations that a pod restart could orphan, D2).
 *
 * The invariants these tests lock in:
 *   (a) enqueue records a Queued AIRun (the durable intent) before any
 *       expensive work, and kicks inline processing;
 *   (b) the claim is a status-guarded CAS: a lost claim never executes,
 *       a won claim increments attemptCount and dispatches to the right
 *       subject runner;
 *   (c) the retry policy (G9): transient failures requeue while attempts
 *       remain; permanent failures and exhausted attempts finalize as
 *       Error — and the CAS guard means an already-Completed run is never
 *       clobbered;
 *   (d) heartbeat-stale runs requeue while attempts remain, else go Stale;
 *   (e) the poller expires runs that queued past their usefulness window.
 */

function mockBudgetOk(): void {
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });
}

function findOperatorSql(value: unknown): string {
  const operator: { getSql?: ((alias: string) => string) | undefined } =
    value as { getSql?: ((alias: string) => string) | undefined };
  return operator.getSql?.("subject") || "";
}

describe("AIInvestigationQueue", () => {
  beforeEach(() => {
    mockBudgetOk();
    // No lane cap override => default of 3.
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as Project);
    // No investigations currently running (cap check passes).
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("enqueue records a Queued run with the subject and kicks processing", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const createdId: ObjectID = ObjectID.generate();

    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: createdId } as unknown as AIRun);
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId,
      subjectIncidentId: incidentId,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AIRunStatus.Queued,
          triggeredByIncidentId: incidentId,
        }),
      }),
    );
    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      projectId,
      { incidentId, alertId: undefined },
    );
    // The inline kick is detached; give the microtask a beat.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
    expect(processRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdId,
        attemptCount: 0,
        triggeredByIncidentId: incidentId,
      }),
    );
  });

  test("enqueue rejects a run carrying both subject types before any budget or write", async () => {
    const budget: jest.SpyInstance = jest.spyOn(
      AIService,
      "getAutonomousDailyBudgetStatus",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    const runId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: ObjectID.generate(),
      subjectIncidentId: ObjectID.generate(),
      subjectAlertId: ObjectID.generate(),
    });

    expect(runId).toBeNull();
    expect(budget).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("enqueue forwards the alert lane to the budget check", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "create").mockResolvedValue({
      id: ObjectID.generate(),
    } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId,
      subjectAlertId: alertId,
    });

    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      projectId,
      { incidentId: undefined, alertId },
    );
  });

  test("enqueue leaves insight work in the legacy subjectless budget lane", async () => {
    const projectId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "create").mockResolvedValue({
      id: ObjectID.generate(),
    } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId,
      subjectAIInsightId: ObjectID.generate(),
    });

    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      projectId,
      { incidentId: undefined, alertId: undefined },
    );
  });

  test("a lost claim never executes the investigation", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);
    const execute: jest.SpyInstance = jest.spyOn(
      AIIncidentInvestigationRunner,
      "executeInvestigation",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByIncidentId: ObjectID.generate(),
    });

    expect(execute).not.toHaveBeenCalled();
  });

  test("a queued run carrying both subject types is never counted or claimed", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByIncidentId: ObjectID.generate(),
      triggeredByAlertId: ObjectID.generate(),
    });

    expect(findProject).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  test("a won claim increments attemptCount and dispatches to the incident runner", async () => {
    const runId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: runId,
      projectId,
      attemptCount: 0,
      triggeredByIncidentId: incidentId,
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        fromStatus: AIRunStatus.Queued,
        // Guards against stale queue snapshots re-claiming or re-numbering.
        expectedAttemptCount: 0,
        set: expect.objectContaining({
          status: AIRunStatus.Running,
          attemptCount: 1,
        }),
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        incidentId,
        attemptCount: 1,
      }),
    );
    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      projectId,
      { incidentId, alertId: undefined },
    );
  });

  test("a won claim dispatches alert runs to the alert runner", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIAlertInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId,
      attemptCount: 0,
      triggeredByAlertId: alertId,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ alertId, attemptCount: 1 }),
    );
    expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
      projectId,
      { incidentId: undefined, alertId },
    );
  });

  test("an incident at its cap does not consume the alert lane's slots", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      aiMaxConcurrentInvestigations: 1,
      incidentAiMaxConcurrentInvestigations: 1,
      alertAiMaxConcurrentInvestigations: 2,
    } as unknown as Project);
    const count: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(0);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByIncidentId: ObjectID.generate(),
    });
    expect(claim).not.toHaveBeenCalled();

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: ObjectID.generate(),
    });
    expect(claim).toHaveBeenCalledTimes(1);

    const incidentQuery: Record<string, unknown> = (
      count.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(findOperatorSql(incidentQuery["triggeredByIncidentId"])).toContain(
      "IS NOT NULL",
    );
    expect(findOperatorSql(incidentQuery["triggeredByAlertId"])).toContain(
      "IS NULL",
    );

    const alertQuery: Record<string, unknown> = (
      count.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(findOperatorSql(alertQuery["triggeredByIncidentId"])).toContain(
      "IS NULL",
    );
    expect(findOperatorSql(alertQuery["triggeredByAlertId"])).toContain(
      "IS NOT NULL",
    );
  });

  test("subjectless insight work retains the legacy concurrency cap", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: ObjectID.generate(),
      aiMaxConcurrentInvestigations: 1,
      incidentAiMaxConcurrentInvestigations: 10,
      alertAiMaxConcurrentInvestigations: 10,
    } as unknown as Project);
    const count: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const claim: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAiInsightId: ObjectID.generate(),
    });

    expect(claim).not.toHaveBeenCalled();
    const query: Record<string, unknown> = (
      count.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(findOperatorSql(query["triggeredByIncidentId"])).toContain(
      "IS NULL",
    );
    expect(findOperatorSql(query["triggeredByAlertId"])).toContain("IS NULL");
  });

  test("background counts are isolated to the remediation subject lane", async () => {
    const count: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      runType: AIRunType.RemediationPlan,
      triggeredByIncidentId: ObjectID.generate(),
      triggeredByAutoRemediationSuggestionId: ObjectID.generate(),
    });

    expect(count).toHaveBeenCalledTimes(3);
    for (const call of count.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as { query: Record<string, unknown> }
      ).query;
      expect(findOperatorSql(query["triggeredByIncidentId"])).toContain(
        "IS NOT NULL",
      );
      expect(findOperatorSql(query["triggeredByAlertId"])).toContain("IS NULL");
    }
  });

  test("a transient failure on the first attempt requeues the run", async () => {
    const runId: ObjectID = ObjectID.generate();
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.failOrRequeue({
      aiRunId: runId,
      attemptCount: 1,
      errorMessage: "LLM provider timed out",
      isPermanent: false,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Queued,
        }),
      }),
    );
  });

  test("a transient failure on the final attempt finalizes as Error", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.failOrRequeue({
      aiRunId: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      errorMessage: "LLM provider timed out",
      isPermanent: false,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRunStatus.Error,
        }),
      }),
    );
  });

  test("a permanent failure never retries, even with attempts remaining", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.failOrRequeue({
      aiRunId: ObjectID.generate(),
      attemptCount: 1,
      errorMessage: "No LLM provider configured for this project.",
      isPermanent: true,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRunStatus.Error,
        }),
      }),
    );
  });

  test("a heartbeat-stale run requeues while attempts remain", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: 1,
      });

    expect(outcome).toBe("requeued");
  });

  test("a heartbeat-stale run out of attempts is marked Stale", async () => {
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const outcome: "requeued" | "stale" | "noop" =
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      });

    expect(outcome).toBe("stale");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AIRunStatus.Stale,
        }),
      }),
    );
  });

  test("the poller expires runs queued past the usefulness window", async () => {
    const expiredId: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      // First call: expired runs. Second call: nothing left to drain.
      .mockResolvedValueOnce([{ id: expiredId } as unknown as AIRun])
      .mockResolvedValueOnce([]);
    const update: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.processQueuedRuns();

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: expiredId,
        fromStatus: AIRunStatus.Queued,
        set: expect.objectContaining({
          status: AIRunStatus.Cancelled,
        }),
      }),
    );
  });
});
