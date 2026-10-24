import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../../../Server/Services/AIRunService";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskRuns, {
  CODE_TASK_BUSY_MESSAGE,
  CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../../Types/AI/CodeTask";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Every turn of a task is a Queued code-fix run of the CodeRequest recipe,
 * written as root for a Runner to claim. A task takes one turn at a time:
 * a reply or a retry while a turn is still queued or running is refused,
 * the check and the write held together by a lock on the task.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");
const USER_ID: ObjectID = new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");

const CONTEXT: Array<CodeTaskContextItem> = [
  {
    type: CodeTaskContextType.File,
    label: "src/api/users.ts",
    path: "src/api/users.ts",
  },
];

let created: Array<AIRun>;
let latestReply: AIRun | null;
let released: number;
const mutex: SemaphoreMutex = {
  release: jest.fn(),
} as unknown as SemaphoreMutex;

function task(): AIRun {
  const value: AIRun = new AIRun();
  value._id = TASK_ID.toString();
  value.projectId = PROJECT_ID;
  value.runType = AIRunType.CodeFix;
  value.codeFixTaskType = CodeFixTaskType.CodeRequest;
  value.codeRepositoryId = REPOSITORY_ID;
  value.status = AIRunStatus.Completed;
  return value;
}

function reply(status: AIRunStatus, recipe?: CodeFixTaskType): AIRun {
  const value: AIRun = new AIRun();
  value._id = REPLY_ID.toString();
  value.status = status;
  value.codeFixTaskType = recipe || CodeFixTaskType.CodeRequest;
  value.taskContext = {
    request: { message: "Use exponential backoff", context: CONTEXT },
  };
  return value;
}

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = PROJECT_ID;
  return value;
}

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

beforeEach(() => {
  created = [];
  latestReply = null;
  released = 0;

  jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue(undefined);
  jest
    .spyOn(AIRunService, "create")
    .mockImplementation(async (data: { data: AIRun }): Promise<AIRun> => {
      created.push(data.data);
      const saved: AIRun = data.data;
      saved._id = ObjectID.generate().toString();
      return saved;
    });
  jest.spyOn(AIRunService, "findOneBy").mockImplementation(async () => {
    return latestReply;
  });
  jest.spyOn(Semaphore, "lock").mockResolvedValue(mutex);
  jest.spyOn(Semaphore, "release").mockImplementation(async () => {
    released++;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskRuns.readMessage", () => {
  test("a request is what was typed, trimmed", () => {
    expect(CodeTaskRuns.readMessage("  Add retries  ")).toBe("Add retries");
  });

  test("an empty request, or one over the limit, is refused with what to do", async () => {
    for (const empty of ["", "   ", undefined, 42]) {
      expect(
        await refusal(async () => {
          return CodeTaskRuns.readMessage(empty);
        }),
      ).toBe("Write what you want AI to do.");
    }

    expect(
      await refusal(async () => {
        return CodeTaskRuns.readMessage(
          "x".repeat(CODE_TASK_LIMITS.maxMessageLength + 1),
        );
      }),
    ).toContain("Add long text as a note instead.");
  });
});

describe("CodeTaskRuns.start", () => {
  test("queues the task's first turn: a request, in the repository, by the person, titled from its first line", async () => {
    await CodeTaskRuns.start({
      projectId: PROJECT_ID,
      userId: USER_ID,
      repository: repository(),
      message: "## Add retries to the users API\n\nUse backoff.",
      context: CONTEXT,
    });

    expect(created).toHaveLength(1);

    const run: AIRun = created[0]!;

    expect(run.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(run.runType).toBe(AIRunType.CodeFix);
    expect(run.codeFixTaskType).toBe(CodeFixTaskType.CodeRequest);
    expect(run.status).toBe(AIRunStatus.Queued);
    expect(run.userId?.toString()).toBe(USER_ID.toString());
    expect(run.codeRepositoryId?.toString()).toBe(REPOSITORY_ID.toString());
    expect(run.codeTaskId).toBeUndefined();
    expect(run.title).toBe("Add retries to the users API");
    expect(run.taskContext).toEqual({
      request: {
        message: "## Add retries to the users API\n\nUse backoff.",
        context: CONTEXT,
      },
    });
    expect(
      (AIRunService.create as unknown as jest.Mock).mock.calls[0]![0],
    ).toMatchObject({ props: { isRoot: true } });
  });

  test("the branch the person picked is kept on the first turn's request, where every turn reads it", async () => {
    await CodeTaskRuns.start({
      projectId: PROJECT_ID,
      userId: USER_ID,
      repository: repository(),
      message: "Backport the retry fix",
      context: [],
      baseBranch: "release/2026-10",
    });

    expect(created[0]!.taskContext).toEqual({
      request: {
        message: "Backport the retry fix",
        context: [],
        baseBranch: "release/2026-10",
      },
    });
  });

  test("none picked (null, or left out): no branch is kept - the repository's main branch is the task's", async () => {
    for (const baseBranch of [null, undefined]) {
      await CodeTaskRuns.start({
        projectId: PROJECT_ID,
        userId: USER_ID,
        repository: repository(),
        message: "Add retries",
        context: [],
        baseBranch,
      });
    }

    for (const run of created) {
      expect(run.taskContext?.request).not.toHaveProperty("baseBranch");
    }
  });

  test("the project's AI run budget is asked first", async () => {
    (
      FixRunBudget.assertWithinBudget as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new BadDataException("Daily limit reached.");
    });

    expect(
      await refusal(() => {
        return CodeTaskRuns.start({
          projectId: PROJECT_ID,
          userId: USER_ID,
          repository: repository(),
          message: "Add retries",
          context: [],
        });
      }),
    ).toBe("Daily limit reached.");
    expect(created).toHaveLength(0);
  });
});

/*
 * A task OneUptime starts on its own, from slow code it found in a
 * service's profiles (Types/AI/TelemetryAi): an ordinary Code request in
 * every way but who asked - nobody - and the insight it names.
 */
describe("CodeTaskRuns.startForOneUptime", () => {
  const INSIGHT_ID: ObjectID = new ObjectID(
    "8d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a",
  );
  const PROVIDER_ID: ObjectID = new ObjectID(
    "9e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b",
  );

  test("queues a Code request nobody asked, naming the insight it came from", async () => {
    await CodeTaskRuns.startForOneUptime({
      projectId: PROJECT_ID,
      repository: repository(),
      message:
        "Make OrderParser.parse faster\n\nIt takes 18% of checkout's CPU time.",
      context: CONTEXT,
      triggeredByAiInsightId: INSIGHT_ID,
    });

    expect(created).toHaveLength(1);

    const run: AIRun = created[0]!;

    expect(run.runType).toBe(AIRunType.CodeFix);
    expect(run.codeFixTaskType).toBe(CodeFixTaskType.CodeRequest);
    expect(run.status).toBe(AIRunStatus.Queued);
    expect(run.userId).toBeUndefined();
    expect(run.triggeredByAiInsightId?.toString()).toBe(INSIGHT_ID.toString());
    expect(run.codeRepositoryId?.toString()).toBe(REPOSITORY_ID.toString());
    expect(run.title).toBe("Make OrderParser.parse faster");
    expect(run.llmProviderId).toBeUndefined();
    expect(run.taskContext).toEqual({
      request: {
        message:
          "Make OrderParser.parse faster\n\nIt takes 18% of checkout's CPU time.",
        context: CONTEXT,
      },
    });
    expect(
      (AIRunService.create as unknown as jest.Mock).mock.calls[0]![0],
    ).toMatchObject({ props: { isRoot: true } });
  });

  test("the LLM provider the rules pick is the task's", async () => {
    await CodeTaskRuns.startForOneUptime({
      projectId: PROJECT_ID,
      repository: repository(),
      message: "Make it faster",
      context: [],
      triggeredByAiInsightId: INSIGHT_ID,
      llmProviderId: PROVIDER_ID,
    });

    expect(created[0]!.llmProviderId?.toString()).toBe(PROVIDER_ID.toString());
  });

  test("is held to the project's AI run budget, and to what a request may say", async () => {
    expect(
      await refusal(() => {
        return CodeTaskRuns.startForOneUptime({
          projectId: PROJECT_ID,
          repository: repository(),
          message: "   ",
          context: [],
          triggeredByAiInsightId: INSIGHT_ID,
        });
      }),
    ).toBe("Write what you want AI to do.");

    (
      FixRunBudget.assertWithinBudget as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new BadDataException("Daily limit reached.");
    });

    expect(
      await refusal(() => {
        return CodeTaskRuns.startForOneUptime({
          projectId: PROJECT_ID,
          repository: repository(),
          message: "Make it faster",
          context: [],
          triggeredByAiInsightId: INSIGHT_ID,
        });
      }),
    ).toBe("Daily limit reached.");
    expect(created).toHaveLength(0);
  });

  test("a person's task never names an insight on its own", async () => {
    await CodeTaskRuns.start({
      projectId: PROJECT_ID,
      userId: USER_ID,
      repository: repository(),
      message: "Add retries",
      context: [],
    });

    expect(created[0]!.triggeredByAiInsightId).toBeUndefined();
    expect(created[0]!.userId?.toString()).toBe(USER_ID.toString());
  });
});

describe("CodeTaskRuns.reply", () => {
  test("is the task's next turn: same task, same repository, the person's words", async () => {
    latestReply = reply(AIRunStatus.Completed);

    await CodeTaskRuns.reply({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task: task(),
      message: "Now add a test for it",
      context: [],
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.codeTaskId?.toString()).toBe(TASK_ID.toString());
    expect(created[0]!.codeRepositoryId?.toString()).toBe(
      REPOSITORY_ID.toString(),
    );
    expect(created[0]!.status).toBe(AIRunStatus.Queued);
    expect(created[0]!.title).toBeUndefined();
    expect(created[0]!.taskContext).toEqual({
      request: { message: "Now add a test for it", context: [] },
    });
    expect(released).toBe(1);
  });

  test("waits for the turn in progress: a second turn on the same branch is refused", async () => {
    for (const status of [
      AIRunStatus.Queued,
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ]) {
      latestReply = reply(status);

      expect(
        await refusal(() => {
          return CodeTaskRuns.reply({
            projectId: PROJECT_ID,
            userId: USER_ID,
            task: task(),
            message: "And this",
            context: [],
          });
        }),
      ).toBe(CODE_TASK_BUSY_MESSAGE);
    }

    expect(created).toHaveLength(0);
    // The lock is let go whatever happens.
    expect(released).toBe(3);
  });

  test("with no reply yet, the task's own turn decides", async () => {
    const working: AIRun = task();
    working.status = AIRunStatus.Running;

    expect(
      await refusal(() => {
        return CodeTaskRuns.reply({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: working,
          message: "And this",
          context: [],
        });
      }),
    ).toBe(CODE_TASK_BUSY_MESSAGE);
  });

  test("the check and the write hold the task's lock", async () => {
    latestReply = reply(AIRunStatus.Completed);

    await CodeTaskRuns.reply({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task: task(),
      message: "Go on",
      context: [],
    });

    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: TASK_ID.toString(),
        namespace: "CodeTaskRuns.turn",
      }),
    );
  });

  test("a lock that cannot be had does not stop the reply", async () => {
    (Semaphore.lock as unknown as jest.Mock).mockImplementation(async () => {
      throw new Error("Valkey is down");
    });
    latestReply = reply(AIRunStatus.Completed);

    await CodeTaskRuns.reply({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task: task(),
      message: "Go on",
      context: [],
    });

    expect(created).toHaveLength(1);
    expect(released).toBe(0);
  });

  test("a task with no repository cannot be continued", async () => {
    const orphan: AIRun = task();
    delete orphan.codeRepositoryId;

    expect(
      await refusal(() => {
        return CodeTaskRuns.reply({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: orphan,
          message: "Go on",
          context: [],
        });
      }),
    ).toContain("not linked to a repository");
    expect(created).toHaveLength(0);
  });

  /*
   * A pull request's production review is the server's: it is reviewed
   * again when the pull request changes, or when someone presses Review
   * again - never by a reply that would hand a Runner a turn in it.
   */
  test("a production review takes no reply, and no lock is taken for one", async () => {
    const review: AIRun = task();
    review.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;

    expect(
      await refusal(() => {
        return CodeTaskRuns.reply({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: review,
          message: "Fix what you found",
          context: [],
        });
      }),
    ).toBe(CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE);
    expect(created).toHaveLength(0);
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });
});

describe("CodeTaskRuns.retry", () => {
  test("asks a failed or stopped request again, as a new turn the conversation keeps", async () => {
    for (const status of [
      AIRunStatus.Error,
      AIRunStatus.Stale,
      AIRunStatus.Cancelled,
    ]) {
      latestReply = reply(status);

      await CodeTaskRuns.retry({
        projectId: PROJECT_ID,
        userId: USER_ID,
        task: task(),
      });
    }

    expect(created).toHaveLength(3);
    for (const run of created) {
      expect(run.codeTaskId?.toString()).toBe(TASK_ID.toString());
      expect(run.taskContext).toEqual({
        request: { message: "Use exponential backoff", context: CONTEXT },
      });
    }
  });

  test("a first turn asked from a picked branch is asked again with the same words - the branch stays where it is, on the first turn", async () => {
    // The task's own turn failed: no reply yet.
    latestReply = null;
    const failed: AIRun = task();
    failed.status = AIRunStatus.Error;
    failed.taskContext = {
      request: {
        message: "Backport the retry fix",
        context: CONTEXT,
        baseBranch: "release/2026-10",
      },
    };

    await CodeTaskRuns.retry({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task: failed,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.codeTaskId?.toString()).toBe(TASK_ID.toString());
    expect(created[0]!.taskContext).toEqual({
      request: { message: "Backport the retry fix", context: CONTEXT },
    });
  });

  test("only a turn that failed or was stopped is tried again", async () => {
    latestReply = reply(AIRunStatus.Completed);

    expect(
      await refusal(() => {
        return CodeTaskRuns.retry({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: task(),
        });
      }),
    ).toBe("Only a turn that failed or was stopped can be tried again.");
  });

  test("a turn nobody asked for in Code cannot be asked again", async () => {
    latestReply = reply(AIRunStatus.Error, CodeFixTaskType.FixException);

    expect(
      await refusal(() => {
        return CodeTaskRuns.retry({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: task(),
        });
      }),
    ).toContain("was not asked for in Code");
  });

  test("a failed production review is not asked again as a turn", async () => {
    latestReply = null;
    const review: AIRun = task();
    review.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
    review.status = AIRunStatus.Error;

    expect(
      await refusal(() => {
        return CodeTaskRuns.retry({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: review,
        });
      }),
    ).toContain("was not asked for in Code");
    expect(created).toHaveLength(0);
  });
});

describe("CodeTaskRuns.stop", () => {
  test("stops the task's turn in progress, saying who stopped it", async () => {
    const activeTask: AIRun = task();
    activeTask.status = AIRunStatus.Running;
    const activeReply: AIRun = reply(AIRunStatus.Queued);

    (AIRunService.findOneBy as unknown as jest.Mock).mockImplementation(
      async () => {
        return activeTask;
      },
    );
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([activeReply]);
    const transition: jest.SpiedFunction<
      typeof AIRunService.attemptStatusTransition
    > = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    const stopped: number = await CodeTaskRuns.stop({
      projectId: PROJECT_ID,
      task: task(),
      stoppedByName: "Jane Doe",
    });

    expect(stopped).toBe(2);
    expect(transition).toHaveBeenCalledTimes(2);

    const first: Parameters<typeof AIRunService.attemptStatusTransition>[0] =
      transition.mock.calls[0]![0];

    expect(first.aiRunId.toString()).toBe(TASK_ID.toString());
    // Only from the status it was read in: a turn that finished meanwhile stays finished.
    expect(first.fromStatus).toBe(AIRunStatus.Running);
    expect(first.set.status).toBe(AIRunStatus.Cancelled);
    expect(first.set.errorMessage).toBe("Stopped by Jane Doe.");
    expect(first.set.completedAt).toBeInstanceOf(Date);
  });

  test("a task with nothing in progress stops nothing", async () => {
    (AIRunService.findOneBy as unknown as jest.Mock).mockImplementation(
      async () => {
        return null;
      },
    );
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const transition: jest.SpiedFunction<
      typeof AIRunService.attemptStatusTransition
    > = jest.spyOn(AIRunService, "attemptStatusTransition");

    expect(
      await CodeTaskRuns.stop({
        projectId: PROJECT_ID,
        task: task(),
        stoppedByName: "",
      }),
    ).toBe(0);
    expect(transition).not.toHaveBeenCalled();
  });
});
