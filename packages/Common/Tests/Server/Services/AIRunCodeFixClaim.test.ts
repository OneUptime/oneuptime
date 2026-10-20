import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import ObjectID from "../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../Types/Runner/CodeRepositoryRunner";
import { beforeEach, describe, expect, test, afterEach } from "@jest/globals";

/*
 * Who claims: the claim reads the repository's Runner choice for it
 * (CodeFixClaimQuery, pinned in its own suite). These tests are about what
 * happens once a candidate is read, so it is a global Runner and the
 * candidate query always names one; findOneBy hands back the run.
 */
const WORKER: CodeWorker = {
  kind: CodeWorkerKind.GlobalRunner,
  id: new ObjectID("0a1b2c3d-8888-4222-8333-944455556666"),
};
const CANDIDATE_ID: string = "0a1b2c3d-9999-4222-8333-944455556666";

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

function investigationTaskContext(): CodeFixTaskContext {
  return {
    sourceInvestigationRunId: ObjectID.generate().toString(),
    sourceInvestigationAnalysisMarkdown:
      "## Root cause\n\nA repository code change fixes this regression.",
  };
}

describe("AIRunService.claimNextQueuedCodeFixRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "findNextClaimableCodeFixRunId")
      .mockResolvedValue(CANDIDATE_ID);
  });

  test("returns null when no queued code-fix run exists — no CAS attempted", async () => {
    jest
      .spyOn(AIRunService, "findNextClaimableCodeFixRunId")
      .mockResolvedValue(null);
    const read: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  test("the candidate is read again, still Queued, before it is claimed - one taken meanwhile is passed over", async () => {
    const run: AIRun = fakeQueuedRun();

    const read: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(null) // another worker took the first candidate
      .mockResolvedValueOnce(run);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: CANDIDATE_ID,
          status: AIRunStatus.Queued,
        }),
      }),
    );
  });

  test("gives up after five candidates it could not claim", async () => {
    const next: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "findNextClaimableCodeFixRunId",
    );
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeQueuedRun());
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);

    expect(
      await AIRunService.claimNextQueuedCodeFixRun({
        worker: WORKER,
        aiAgentId: ObjectID.generate(),
      }),
    ).toBeNull();
    expect(next).toHaveBeenCalledTimes(5);
  });

  test("a won claim transitions Queued -> Running with heartbeat, agent id and attemptCount+1", async () => {
    const run: AIRun = fakeQueuedRun();
    const aiAgentId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
  });

  /*
   * FixFromIncident is an incident/alert-subject recipe with one additional
   * requirement: the exact Recommended investigation + analysis are pinned
   * in taskContext so a later RootCause cannot change what the worker fixes.
   */
  test("a FixFromIncident run with an incident and pinned investigation snapshot is claimed", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      incidentId: ObjectID.generate(),
      taskContext: investigationTaskContext(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
    expect(claimed?.codeFixTaskType).toBe(CodeFixTaskType.FixFromIncident);
    // Exactly the claim CAS — no Error transition.
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test("a FixFromIncident run with an alert and pinned investigation snapshot is claimed too", async () => {
    const run: AIRun = fakeQueuedRun({
      exceptionId: null,
      codeFixTaskType: CodeFixTaskType.FixFromIncident,
      alertId: ObjectID.generate(),
      taskContext: investigationTaskContext(),
    });

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    const claimed: AIRun | null = await AIRunService.claimNextQueuedCodeFixRun({
      worker: WORKER,
      aiAgentId: ObjectID.generate(),
    });

    expect(claimed).toBe(run);
  });

  test.each([
    ["no", undefined],
    ["a partial", { sourceInvestigationRunId: ObjectID.generate().toString() }],
  ] as Array<[string, CodeFixTaskContext | undefined]>)(
    "a FixFromIncident run with %s pinned snapshot is finalized as Error and skipped",
    async (_label: string, taskContext: CodeFixTaskContext | undefined) => {
      const brokenRun: AIRun = fakeQueuedRun({
        exceptionId: null,
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
        incidentId: ObjectID.generate(),
        ...(taskContext ? { taskContext } : {}),
      });
      const goodRun: AIRun = fakeQueuedRun();

      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValueOnce(brokenRun)
        .mockResolvedValueOnce(goodRun);
      const transition: jest.SpyInstance = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1);

      const claimed: AIRun | null =
        await AIRunService.claimNextQueuedCodeFixRun({
          worker: WORKER,
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
            errorMessage: expect.stringContaining(
              "pinned investigation analysis snapshot",
            ),
          }),
        }),
      );
    },
  );

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
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
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
      worker: WORKER,
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
