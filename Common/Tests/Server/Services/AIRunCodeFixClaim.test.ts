import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The code-fix claim behind POST /ai-agent-task/get-pending-task: the
 * oldest Queued CodeFix run is claimed with the same status+attemptCount
 * guarded CAS the investigation queue uses, so concurrent agent workers can
 * never receive the same run. These tests mock findOneBy /
 * attemptStatusTransition (the AIInvestigationQueue test idiom) and
 * lock in the claim invariants.
 */

function fakeQueuedRun(data?: {
  exceptionId?: ObjectID | null;
  attemptCount?: number;
  codeFixTaskType?: CodeFixTaskType;
  incidentId?: ObjectID;
  alertId?: ObjectID;
  taskContext?: CodeFixTaskContext;
}): AIRun {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    triggeredByTelemetryExceptionId:
      data?.exceptionId === null
        ? undefined
        : data?.exceptionId || ObjectID.generate(),
    triggeredByIncidentId: data?.incidentId,
    triggeredByAlertId: data?.alertId,
    attemptCount: data?.attemptCount || 0,
    codeFixTaskType: data?.codeFixTaskType,
    taskContext: data?.taskContext,
  } as unknown as AIRun;
}

describe("AIRunService.claimNextQueuedCodeFixRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns null when no queued code-fix run exists — no CAS attempted", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBeNull();
    expect(transition).not.toHaveBeenCalled();
  });

  test("a won claim transitions Queued -> Running with heartbeat, agent id and attemptCount+1", async () => {
    const run: AIRun = fakeQueuedRun();
    const aiAgentId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId,
    });

    expect(claimed).toBe(run);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Queued,
        // Guards against stale snapshots re-claiming or re-numbering.
        expectedAttemptCount: 0,
        set: expect.objectContaining({
          status: AIRunStatus.Running,
          attemptCount: 1,
          startedAt: expect.any(Date),
          lastHeartbeatAt: expect.any(Date),
          /*
           * The transition path bypasses column transformers, so the agent
           * id must be its pre-transformed string form.
           */
          aiAgentId: aiAgentId.toString(),
        }),
      }),
    );
  });

  test("a lost claim retries with the next candidate instead of returning it", async () => {
    const lostRun: AIRun = fakeQueuedRun();
    const wonRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(lostRun)
      .mockResolvedValueOnce(wonRun);
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValueOnce(0) // another agent won lostRun
      .mockResolvedValueOnce(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(wonRun);
  });

  test("an exception-based run without a triggering exception is finalized as Error and skipped", async () => {
    const brokenRun: AIRun = fakeQueuedRun({ exceptionId: null });
    const goodRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(brokenRun)
      .mockResolvedValueOnce(goodRun);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(goodRun);
    // Claim broken -> Error broken -> claim good.
    expect(transition).toHaveBeenCalledTimes(3);
    expect(transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiRunId: brokenRun.id,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
        }),
      }),
    );
  });

  /*
   * The executability guard is recipe-dependent: ImproveInstrumentation
   * runs are enqueued by the inconclusive-investigation trigger with an
   * incident/alert subject and NO telemetry exception — the claim must
   * hand them to the worker, not Error them for lacking an exception.
   */
  test("an ImproveInstrumentation run without an exception but with an incident subject is claimed, not errored", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
      incidentId: ObjectID.generate(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
    expect(claimed?.codeFixTaskType).toBe(
      CodeFixTaskType.ImproveInstrumentation,
    );
    // Exactly the claim CAS — no Error transition.
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test("an ImproveInstrumentation run with an alert subject is claimed too", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
      alertId: ObjectID.generate(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
  });

  /*
   * FixFromIncident is the second incident/alert-subject recipe: enqueued
   * by the user from the investigation panel, no telemetry exception — the
   * same recipe grouping as ImproveInstrumentation in the guard.
   */
  test("a FixFromIncident run without an exception but with an incident subject is claimed, not errored", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      incidentId: ObjectID.generate(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.FixFromIncident);
    // Exactly the claim CAS — no Error transition.
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test("a FixFromIncident run with an alert subject is claimed too", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      alertId: ObjectID.generate(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
  });

  test("a FixFromIncident run with NO subject at all is finalized as Error and skipped", async () => {
    const brokenRun: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
    });
    const goodRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(brokenRun)
      .mockResolvedValueOnce(goodRun);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(goodRun);
    expect(transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiRunId: brokenRun.id,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: expect.stringContaining("incident or alert subject"),
        }),
      }),
    );
  });

  /*
   * FixPerformance is the third context kind: no exception AND no
   * incident/alert subject — its trace evidence lives in taskContext. The
   * guard must accept it when taskContext carries a traceId and Error it
   * when the evidence is missing.
   */
  test("a FixPerformance run with trace evidence in taskContext is claimed — no exception, no subject", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      taskContext: {
        traceId: "abc123trace",
        performanceFindings: [],
      },
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.FixPerformance);
    // Exactly the claim CAS — no Error transition.
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test("a FixPerformance run with NO trace evidence is finalized as Error and skipped", async () => {
    const brokenRun: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
    });
    const goodRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(brokenRun)
      .mockResolvedValueOnce(goodRun);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(goodRun);
    expect(transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiRunId: brokenRun.id,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: expect.stringContaining("trace evidence"),
        }),
      }),
    );
  });

  test("a FixPerformance run carrying an incident id but no taskContext is still errored — the guard groups by context kind, not by whatever record happens to exist", async () => {
    const brokenRun: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      incidentId: ObjectID.generate(),
    });
    const goodRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(brokenRun)
      .mockResolvedValueOnce(goodRun);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(goodRun);
    expect(transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiRunId: brokenRun.id,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: expect.stringContaining("trace evidence"),
        }),
      }),
    );
  });

  test("an ImproveInstrumentation run with NO subject at all is finalized as Error and skipped", async () => {
    const brokenRun: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
    });
    const goodRun: AIRun = fakeQueuedRun();

    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(brokenRun)
      .mockResolvedValueOnce(goodRun);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(goodRun);
    expect(transition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        aiRunId: brokenRun.id,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: expect.stringContaining("incident or alert subject"),
        }),
      }),
    );
  });
});
