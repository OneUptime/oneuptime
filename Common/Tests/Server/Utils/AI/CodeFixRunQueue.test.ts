import CodeFixRunQueue from "../../../../Server/Utils/AI/CodeFix/CodeFixRunQueue";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIAgentService from "../../../../Server/Services/AIAgentService";
import RunnerService from "../../../../Server/Services/RunnerService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../Types/ObjectID";
import { beforeEach, describe, expect, test, afterEach } from "@jest/globals";

/*
 * Sweeper decisions for CodeFix AIRuns:
 *
 *   (a) a heartbeat-stale Running run is finalized as Error, never requeued
 *       — the external agent may have already pushed a partial fix branch,
 *       so re-running the fix automatically is not safe (this is the
 *       deliberate divergence from investigations, which requeue);
 *   (b) a Queued run that outwaited the timeout is failed only when its
 *       project has no alive agent — a project with an alive agent just
 *       has a deep queue and is left alone.
 */

describe("CodeFixRunQueue.markStaleRunAsError", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("finalizes a heartbeat-stale run as Error via a Running-guarded CAS — no requeue", async () => {
    const runId: ObjectID = ObjectID.generate();
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.markStaleRunAsError({ id: runId });

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          completedAt: expect.any(Date),
        }),
      }),
    );
    // Never a requeue.
    expect(transition).not.toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: AIRunStatus.Queued }),
      }),
    );
  });
});

describe("CodeFixRunQueue.failOrphanedQueuedRuns", () => {
  /*
   * A project can be served by an AIAgent or by a customer-installed Runner
   * with the code-fix capability. These tests exercise the AIAgent side, so
   * the Runner lookup is stubbed to "none" — without it the fallback would
   * reach a real database.
   */
  beforeEach(() => {
    jest
      .spyOn(RunnerService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("fails only runs in projects with no alive agent", async () => {
    const projectWithAgent: ObjectID = ObjectID.generate();
    const projectWithoutAgent: ObjectID = ObjectID.generate();
    const coveredRunId: ObjectID = ObjectID.generate();
    const orphanedRunId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      { id: coveredRunId, projectId: projectWithAgent },
      { id: orphanedRunId, projectId: projectWithoutAgent },
    ] as unknown as Array<AIRun>);

    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockImplementation((projectId: ObjectID): Promise<AIAgent | null> => {
        return Promise.resolve(
          projectId.toString() === projectWithAgent.toString()
            ? ({ id: ObjectID.generate() } as unknown as AIAgent)
            : null,
        );
      });

    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: orphanedRunId,
        fromStatus: AIRunStatus.Queued,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: expect.stringContaining("No AI agent picked this"),
        }),
      }),
    );
  });

  test("does nothing when no run outwaited the timeout", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const aliveLookup: jest.SpyInstance = jest.spyOn(
      AIAgentService,
      "getConnectedAIAgentForProject",
    );
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(aliveLookup).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  test("looks the alive agent up once per project, not once per run", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      { id: ObjectID.generate(), projectId },
      { id: ObjectID.generate(), projectId },
    ] as unknown as Array<AIRun>);

    const aliveLookup: jest.SpyInstance = jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue(null);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(aliveLookup).toHaveBeenCalledTimes(1);
  });

  /*
   * A project served only by a customer-installed Runner used to have its
   * queued runs failed out from under a Runner that was polling all along,
   * because only the AIAgent table counted as "an agent".
   */
  test("spares runs in a project whose only agent is a code-fix Runner", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([
        { id: ObjectID.generate(), projectId },
      ] as unknown as Array<AIRun>);

    jest
      .spyOn(AIAgentService, "getConnectedAIAgentForProject")
      .mockResolvedValue(null);
    jest
      .spyOn(RunnerService, "getOnlineCodeFixRunnerForProject")
      .mockResolvedValue({
        id: ObjectID.generate(),
        name: "Prod Runner",
      } as unknown as never);

    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(transition).not.toHaveBeenCalled();
  });
});
