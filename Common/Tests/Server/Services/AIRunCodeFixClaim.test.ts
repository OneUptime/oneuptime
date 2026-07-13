import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The code-fix claim behind POST /ai-agent-task/get-pending-task: the
 * oldest Queued CodeFix run is claimed with the same status+attemptCount
 * guarded CAS the investigation queue uses, so concurrent agent workers can
 * never receive the same run. These tests mock findOneBy /
 * attemptStatusTransition (the SentinelInvestigationQueue test idiom) and
 * lock in the claim invariants.
 */

function fakeQueuedRun(data?: {
  exceptionId?: ObjectID | null;
  attemptCount?: number;
}): AIRun {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    triggeredByTelemetryExceptionId:
      data?.exceptionId === null
        ? undefined
        : data?.exceptionId || ObjectID.generate(),
    attemptCount: data?.attemptCount || 0,
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

  test("a claimed run without a triggering exception is finalized as Error and skipped", async () => {
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
});
