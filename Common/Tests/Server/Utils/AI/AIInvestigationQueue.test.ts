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

describe("AIInvestigationQueue", () => {
  beforeEach(() => {
    mockBudgetOk();
    // No per-project cap override => default of 3.
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

  test("a won claim increments attemptCount and dispatches to the incident runner", async () => {
    const runId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: runId,
      projectId: ObjectID.generate(),
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
  });

  test("a won claim dispatches alert runs to the alert runner", async () => {
    const alertId: ObjectID = ObjectID.generate();
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const execute: jest.SpyInstance = jest
      .spyOn(AIAlertInvestigationRunner, "executeInvestigation")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.processRun({
      id: ObjectID.generate(),
      projectId: ObjectID.generate(),
      attemptCount: 0,
      triggeredByAlertId: alertId,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ alertId, attemptCount: 1 }),
    );
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

    const outcome: "requeued" | "stale" =
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

    const outcome: "requeued" | "stale" =
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
