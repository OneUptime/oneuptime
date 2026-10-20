import CodeFixRunQueue from "../../../../Server/Utils/AI/CodeFix/CodeFixRunQueue";
import AIRunService from "../../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import CodeRepositoryRunnerChoice from "../../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import {
  GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
  NO_GLOBAL_RUNNER_ONLINE_DETAIL,
  NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
  getRepositoryRunnerOfflineDetail,
} from "../../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { CodeRepositoryRunnerChoiceKind } from "../../../../Types/Runner/CodeRepositoryRunner";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Sweeper decisions for CodeFix AIRuns:
 *
 *   (a) a heartbeat-stale Running run is finalized as Error, never requeued
 *       — the external agent may have already pushed a partial fix branch,
 *       so re-running the fix automatically is not safe (this is the
 *       deliberate divergence from investigations, which requeue);
 *   (b) a Queued run that outwaited the timeout is failed only when
 *       nothing that may take it is online - the Runner its repository
 *       picks, or a global Runner for one that picks none - and says why;
 *       one that something online may take just waits in a deep queue.
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
   * A run waits for what its repository works on - the Runner its Runner
   * setting in Code picks, or a global Runner for one that picks none - so
   * whether something is online is asked per repository
   * (CodeRepositoryRunnerChoice, which has its own suite); a run that has
   * not found its repository yet asks for its project's repositories.
   */
  const RUNNER_ID: ObjectID = new ObjectID(
    "0a1b2c3d-1111-4222-8333-944455556666",
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockRepositories(
    rows: Array<{ id: ObjectID; runnerId?: ObjectID | undefined }>,
  ): jest.SpyInstance {
    return jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockImplementation(async (findOneBy: unknown) => {
        const id: string = String(
          (findOneBy as { query: { _id: string } }).query._id,
        );
        return (rows.find((row: { id: ObjectID }) => {
          return row.id.toString() === id;
        }) || null) as unknown as CodeRepository | null;
      });
  }

  test("fails a run whose repository's own Runner is offline, saying which and what to do", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const repositoryId: ObjectID = ObjectID.generate();
    const runId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([
        { id: runId, projectId, codeRepositoryId: repositoryId },
      ] as unknown as Array<AIRun>);
    mockRepositories([{ id: repositoryId, runnerId: RUNNER_ID }]);
    const status: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: {
          kind: CodeRepositoryRunnerChoiceKind.Custom,
          runnerId: RUNNER_ID.toString(),
        },
        isOnline: false,
        runnerName: "prod-runner",
      });
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(status).toHaveBeenCalledWith({ projectId, runnerId: RUNNER_ID });
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        fromStatus: AIRunStatus.Queued,
        set: expect.objectContaining({
          status: AIRunStatus.Error,
          errorMessage: CodeFixRunQueue.getOrphanedRunMessage(
            getRepositoryRunnerOfflineDetail("prod-runner"),
          ),
        }),
      }),
    );
  });

  test("leaves a run alone while what its repository works on is online - a deep queue, not an orphan", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const repositoryId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([
        { id: ObjectID.generate(), projectId, codeRepositoryId: repositoryId },
      ] as unknown as Array<AIRun>);
    mockRepositories([{ id: repositoryId }]);
    jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: true,
      });
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(transition).not.toHaveBeenCalled();
  });

  test("a repository on a global Runner with none online, and one in a project that turned them off, each fail with their own reason", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const onGlobal: ObjectID = ObjectID.generate();
    const globalOff: ObjectID = ObjectID.generate();
    const firstRun: ObjectID = ObjectID.generate();
    const secondRun: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      { id: firstRun, projectId, codeRepositoryId: onGlobal },
      { id: secondRun, projectId, codeRepositoryId: globalOff },
    ] as unknown as Array<AIRun>);
    mockRepositories([{ id: onGlobal }, { id: globalOff }]);
    jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValueOnce({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: false,
      })
      .mockResolvedValueOnce({
        decision: { kind: CodeRepositoryRunnerChoiceKind.NoRunner },
        isOnline: false,
      });
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    const messages: Array<string> = transition.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { set: { errorMessage: string } }).set.errorMessage;
      },
    );
    expect(messages).toEqual([
      CodeFixRunQueue.getOrphanedRunMessage(NO_GLOBAL_RUNNER_ONLINE_DETAIL),
      CodeFixRunQueue.getOrphanedRunMessage(
        GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL,
      ),
    ]);
  });

  test("a run with no repository yet asks whether anything is online for its project", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const runId: ObjectID = ObjectID.generate();

    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([{ id: runId, projectId }] as unknown as Array<AIRun>);
    const repositoryRead: jest.SpyInstance = mockRepositories([]);
    const anyOnline: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(false);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(repositoryRead).not.toHaveBeenCalled();
    expect(anyOnline).toHaveBeenCalledWith(projectId);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: runId,
        set: expect.objectContaining({
          errorMessage: CodeFixRunQueue.getOrphanedRunMessage(
            NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
          ),
        }),
      }),
    );
  });

  test("a run whose repository is gone (or another project's) is asked about as one with none", async () => {
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        projectId,
        codeRepositoryId: ObjectID.generate(),
      },
    ] as unknown as Array<AIRun>);
    const repositoryRead: jest.SpyInstance = mockRepositories([]);
    jest
      .spyOn(CodeRepositoryRunnerChoice, "isAnyRunnerOnlineForProject")
      .mockResolvedValue(true);
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    // Pinned to the run's own project.
    expect(repositoryRead).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(transition).not.toHaveBeenCalled();
  });

  test("does nothing when no run outwaited the timeout", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const status: jest.SpyInstance = jest.spyOn(
      CodeRepositoryRunnerChoice,
      "getStatusForRepository",
    );
    const transition: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "attemptStatusTransition",
    );

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(status).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  test("asks once per repository, not once per run", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const repositoryId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      { id: ObjectID.generate(), projectId, codeRepositoryId: repositoryId },
      { id: ObjectID.generate(), projectId, codeRepositoryId: repositoryId },
      { id: ObjectID.generate(), projectId, codeRepositoryId: repositoryId },
    ] as unknown as Array<AIRun>);
    mockRepositories([{ id: repositoryId }]);
    const status: jest.SpyInstance = jest
      .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
      .mockResolvedValue({
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: false,
      });
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(status).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledTimes(3);
  });

  test("the sweep reads each run's repository with it", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([]);

    await CodeFixRunQueue.failOrphanedQueuedRuns();

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ codeRepositoryId: true }),
      }),
    );
  });

  test("the message says how long it waited, why, and to start it again - never the old switch", () => {
    const message: string = CodeFixRunQueue.getOrphanedRunMessage(
      NO_GLOBAL_RUNNER_ONLINE_DETAIL,
    );

    expect(
      message.startsWith("No Runner picked this task up within 30 minutes."),
    ).toBe(true);
    expect(message).toContain(NO_GLOBAL_RUNNER_ONLINE_DETAIL);
    expect(message.endsWith("Then start the task again.")).toBe(true);
    expect(message).not.toContain("Code Fixes");
  });
});
