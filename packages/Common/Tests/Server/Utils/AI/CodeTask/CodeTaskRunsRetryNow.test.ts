import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A code task's turn that AI tries again by itself waits a minute or four
 * before its next attempt (CodeFixAutoRetry). Retry now - on the task's
 * page, an insight's Fix Task card - ends the wait: the same turn starts
 * at the next worker, and nothing new is asked, so there is still only
 * one turn, one branch and at most one pull request.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

describe("Retry now, on a turn waiting to be tried again", () => {
  let task: AIRun;
  let latestReply: AIRun | null;
  let updateSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    task = new AIRun();
    task.id = ObjectID.generate();
    task.projectId = PROJECT_ID;
    task.runType = AIRunType.CodeFix;
    task.codeFixTaskType = CodeFixTaskType.FixException;
    task.status = AIRunStatus.Queued;
    task.nextAttemptAt = new Date(Date.now() + 4 * 60_000);
    task.taskContext = {};
    latestReply = null;

    jest.spyOn(AIRunService, "findOneBy").mockImplementation(async () => {
      return latestReply;
    });
    updateSpy = jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    createSpy = jest.spyOn(AIRunService, "create");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ends its wait: the same turn starts at the next worker, and nothing new is asked", async () => {
    const before: number = Date.now();

    const run: AIRun = await CodeTaskRuns.retry({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task,
    });

    expect(run).toBe(task);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const update: {
      query: Record<string, unknown>;
      data: { nextAttemptAt: Date };
    } = updateSpy.mock.calls[0]![0];

    // Only while it is still queued: a turn a worker took meanwhile is left alone.
    expect(update.query).toEqual({
      _id: task.id!.toString(),
      projectId: PROJECT_ID,
      status: AIRunStatus.Queued,
    });
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(update.data.nextAttemptAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
  });

  test("a reply waiting to be tried again is the turn that starts", async () => {
    const reply: AIRun = new AIRun();
    reply.id = ObjectID.generate();
    reply.status = AIRunStatus.Queued;
    reply.codeFixTaskType = CodeFixTaskType.CodeRequest;
    reply.nextAttemptAt = new Date(Date.now() + 60_000);
    latestReply = reply;
    task.status = AIRunStatus.Completed;
    delete task.nextAttemptAt;

    expect(
      await CodeTaskRuns.retry({
        projectId: PROJECT_ID,
        userId: USER_ID,
        task,
      }),
    ).toBe(reply);
    expect(updateSpy.mock.calls[0]![0].query["_id"]).toBe(reply.id!.toString());
  });

  test("a turn whose wait is over, or that never had one, is still not one that failed", async () => {
    for (const nextAttemptAt of [new Date(Date.now() - 1000), undefined]) {
      if (nextAttemptAt) {
        task.nextAttemptAt = nextAttemptAt;
      } else {
        delete task.nextAttemptAt;
      }

      await expect(
        CodeTaskRuns.retry({ projectId: PROJECT_ID, userId: USER_ID, task }),
      ).rejects.toThrow(
        "Only a turn that failed or was stopped can be tried again.",
      );
    }

    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
