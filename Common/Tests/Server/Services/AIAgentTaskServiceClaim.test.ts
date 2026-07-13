import AIAgentTaskService from "../../../Server/Services/AIAgentTaskService";
import Model from "../../../Models/DatabaseModels/AIAgentTask";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * LEGACY substrate: the get-pending-task route now claims CodeFix AIRuns
 * (AIRunService.claimNextQueuedCodeFixRun — see AIRunCodeFixClaim.test.ts);
 * claimNextScheduledTask remains only for old AIAgentTask rows.
 *
 * claimNextScheduledTask is the atomic-claim fix for the get-pending-task
 * double-processing race: multiple KEDA-scaled AIAgent workers poll the same
 * endpoint, and the old plain findOneBy returned the oldest Scheduled task
 * without mutating it, so two workers could both receive — and both execute —
 * the same task.
 *
 * The claim collapses the read-then-take into findOneBy + a status-guarded
 * updateOneBy (Scheduled -> InProgress). updateOneBy returns the number of
 * rows changed: 1 means this caller won the claim; 0 means another worker
 * already took the task, and the loop retries with the next candidate.
 *
 * These tests mock the two inherited persistence helpers (no Postgres) to
 * lock in:
 *   (a) a won claim returns the task, with the guard and the InProgress
 *       transition on the exact row that was read;
 *   (b) a lost claim (0 rows) is never returned — the loop moves to the
 *       next candidate;
 *   (c) no Scheduled tasks => null, with no write at all;
 *   (d) the retry loop is bounded, so a pathological all-losses storm
 *       terminates.
 */

function fakeTask(id: ObjectID): Model {
  return {
    id,
    _id: id.toString(),
    projectId: ObjectID.generate(),
    taskType: "FixException",
  } as unknown as Model;
}

describe("AIAgentTaskService.claimNextScheduledTask", () => {
  const aiAgentId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the task when the claim wins, guarding on Scheduled status", async () => {
    const task: Model = fakeTask(ObjectID.generate());

    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "findOneBy")
      .mockResolvedValue(task);
    const updateOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "updateOneBy")
      .mockResolvedValue(1);

    const claimed: Model | null =
      await AIAgentTaskService.claimNextScheduledTask({
        aiAgentId: aiAgentId,
      });

    expect(claimed).toBe(task);
    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { status: AIAgentTaskStatus.Scheduled },
      }),
    );
    expect(updateOneBy).toHaveBeenCalledTimes(1);
    expect(updateOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: task.id!.toString(),
          status: AIAgentTaskStatus.Scheduled,
        },
        data: expect.objectContaining({
          status: AIAgentTaskStatus.InProgress,
          aiAgentId: aiAgentId,
          startedAt: expect.any(Date),
        }),
      }),
    );
  });

  test("retries with the next candidate when another worker wins the race", async () => {
    const lostTask: Model = fakeTask(ObjectID.generate());
    const wonTask: Model = fakeTask(ObjectID.generate());

    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "findOneBy")
      .mockResolvedValueOnce(lostTask)
      .mockResolvedValueOnce(wonTask);
    const updateOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "updateOneBy")
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const claimed: Model | null =
      await AIAgentTaskService.claimNextScheduledTask({
        aiAgentId: aiAgentId,
      });

    expect(claimed).toBe(wonTask);
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(updateOneBy).toHaveBeenCalledTimes(2);
    expect(updateOneBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          _id: wonTask.id!.toString(),
          status: AIAgentTaskStatus.Scheduled,
        },
      }),
    );
  });

  test("returns null without writing when no Scheduled task exists", async () => {
    jest.spyOn(AIAgentTaskService, "findOneBy").mockResolvedValue(null);
    const updateOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "updateOneBy")
      .mockResolvedValue(1);

    const claimed: Model | null =
      await AIAgentTaskService.claimNextScheduledTask({
        aiAgentId: aiAgentId,
      });

    expect(claimed).toBeNull();
    expect(updateOneBy).not.toHaveBeenCalled();
  });

  test("gives up after a bounded number of lost claims", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskService, "findOneBy")
      .mockImplementation(async () => {
        return fakeTask(ObjectID.generate());
      });
    jest.spyOn(AIAgentTaskService, "updateOneBy").mockResolvedValue(0);

    const claimed: Model | null =
      await AIAgentTaskService.claimNextScheduledTask({
        aiAgentId: aiAgentId,
      });

    expect(claimed).toBeNull();
    expect(findOneBy).toHaveBeenCalledTimes(5);
  });
});
