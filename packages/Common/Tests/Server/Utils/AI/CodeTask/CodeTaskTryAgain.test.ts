import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskTryAgain from "../../../../../Server/Utils/AI/CodeTask/CodeTaskTryAgain";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHICH TASKS OF A LIST OFFER TRY AGAIN (#6508, #6509): a failed or stopped
 * task whose latest turn can be asked again - a request, or a fix OneUptime
 * started with no pull request a new turn would open a second of - in a
 * repository the reader may ask AI in now, decided per repository as a
 * repository's page decides it, each repository asked once, and none at
 * all once something stops AI in the whole project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const HERE: string = "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const THERE: string = "4d0e3a2f-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  tenantId: PROJECT_ID,
};

function summary(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: ObjectID.generate().toString(),
    title: "Add retries",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Failed,
    isQueued: false,
    createdAt: "2026-11-01T09:00:00.000Z",
    lastActivityAt: "2026-11-01T09:00:00.000Z",
    origin: { type: CodeTaskOriginType.Request, label: "" },
    turnCount: 1,
    codeRepositoryId: HERE,
    ...data,
  };
}

let canAsk: Record<string, boolean>;
let blockers: Record<string, CodeTaskBlocker | null>;
let readable: Record<string, boolean>;

beforeEach(() => {
  canAsk = { [HERE]: true, [THERE]: true };
  blockers = { [HERE]: null, [THERE]: null };
  readable = { [HERE]: true, [THERE]: true };

  jest
    .spyOn(CodeTaskAccess, "findReadableRepository")
    .mockImplementation(async (data: { repositoryId: ObjectID }) => {
      const id: string = data.repositoryId.toString();

      if (!readable[id]) {
        return null;
      }

      const repository: CodeRepository = new CodeRepository();
      repository._id = id;
      return repository;
    });
  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation(async (data: { repositoryId: ObjectID }) => {
      return Boolean(canAsk[data.repositoryId.toString()]);
    });
  jest
    .spyOn(CodeTaskGate, "getBlocker")
    .mockImplementation(async (data: { repository: CodeRepository | null }) => {
      return blockers[data.repository!.id!.toString()] || null;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function marked(
  summaries: Array<CodeTaskSummaryJSON>,
): Promise<Array<boolean>> {
  await CodeTaskTryAgain.markWhoMayTryAgain({
    projectId: PROJECT_ID,
    props: PROPS,
    summaries,
  });

  return summaries.map((each: CodeTaskSummaryJSON): boolean => {
    return each.canTryAgain === true;
  });
}

describe("which tasks could be asked again, before asking who reads them", () => {
  test.each([
    [CodeTaskState.Failed, true],
    [CodeTaskState.Stopped, true],
    [CodeTaskState.Working, false],
    [CodeTaskState.Done, false],
    [CodeTaskState.WaitingForYou, false],
  ])(
    "a request whose latest turn is %s: %s",
    (state: CodeTaskState, isAskable: boolean) => {
      expect(CodeTaskTryAgain.isAskableAgain(summary({ state }))).toBe(
        isAskable,
      );
    },
  );

  test.each([
    CodeFixTaskType.FixException,
    CodeFixTaskType.WriteRegressionTest,
    CodeFixTaskType.ImproveExceptionHandling,
    CodeFixTaskType.ImproveInstrumentation,
    CodeFixTaskType.FixPerformance,
    CodeFixTaskType.ImproveLogging,
    CodeFixTaskType.ImproveTracing,
    CodeFixTaskType.FixFromIncident,
  ])(
    "a fix OneUptime started (%s): while its task has no pull request",
    (recipe: CodeFixTaskType) => {
      expect(CodeTaskTryAgain.isAskableAgain(summary({ recipe }))).toBe(true);
      expect(
        CodeTaskTryAgain.isAskableAgain(
          summary({ recipe, pullRequest: { number: 4, state: "closed" } }),
        ),
      ).toBe(false);
    },
  );

  test("a request's pull request is no reason: a request asked again builds on it", () => {
    expect(
      CodeTaskTryAgain.isAskableAgain(
        summary({ pullRequest: { number: 4, state: "open" } }),
      ),
    ).toBe(true);
  });

  test("the latest turn decides: a request asked in reply on a fix's task, a fix asked again on a request's never", () => {
    expect(
      CodeTaskTryAgain.isAskableAgain(
        summary({
          recipe: CodeFixTaskType.FixException,
          latestRecipe: CodeFixTaskType.CodeRequest,
          pullRequest: { number: 4, state: "open" },
        }),
      ),
    ).toBe(true);
    expect(
      CodeTaskTryAgain.isAskableAgain(
        summary({
          recipe: CodeFixTaskType.FixException,
          latestRecipe: CodeFixTaskType.FixException,
          pullRequest: { number: 4, state: "open" },
        }),
      ),
    ).toBe(false);
  });

  test.each([
    CodeFixTaskType.GitHubIssueFix,
    CodeFixTaskType.GitHubPullRequestRevision,
    CodeFixTaskType.GitHubPullRequestReview,
    CodeFixTaskType.GitHubPullRequestProductionReview,
  ])(
    "a task asked for on GitHub, or a review (%s): never",
    (recipe: CodeFixTaskType) => {
      expect(CodeTaskTryAgain.isAskableAgain(summary({ recipe }))).toBe(false);
    },
  );

  test("a task with no repository: never - no repository for AI to work in", () => {
    expect(
      CodeTaskTryAgain.isAskableAgain(summary({ codeRepositoryId: undefined })),
    ).toBe(false);
  });
});

describe("who may try them again: per repository", () => {
  test("rows in a repository the reader may ask AI in, with nothing stopping AI there", async () => {
    expect(
      await marked([
        summary(),
        summary({ codeRepositoryId: THERE, state: CodeTaskState.Stopped }),
      ]),
    ).toEqual([true, true]);
  });

  test("a repository the reader may only read offers none of its rows; the other's still do", async () => {
    canAsk[THERE] = false;

    expect(
      await marked([summary(), summary({ codeRepositoryId: THERE })]),
    ).toEqual([true, false]);
  });

  test("a repository the reader may not read at all: none of its rows", async () => {
    readable[THERE] = false;

    expect(
      await marked([summary(), summary({ codeRepositoryId: THERE })]),
    ).toEqual([true, false]);
    expect(CodeTaskAccess.canAskInRepository).toHaveBeenCalledTimes(1);
  });

  test.each([
    CodeTaskBlockerType.RepositoryNotConnected,
    CodeTaskBlockerType.RepositoryTokenRefused,
    CodeTaskBlockerType.RunnerNotOnline,
    CodeTaskBlockerType.NoAgent,
  ])(
    "a repository AI cannot work in now (%s): none of its rows, the other's still",
    async (type: CodeTaskBlockerType) => {
      blockers[THERE] = { type, message: "Not now." };

      expect(
        await marked([summary({ codeRepositoryId: THERE }), summary()]),
      ).toEqual([false, true]);
    },
  );

  test.each([
    CodeTaskBlockerType.AiDisabled,
    CodeTaskBlockerType.PlanRequired,
    CodeTaskBlockerType.SubscriptionUnpaid,
    CodeTaskBlockerType.NoLlmProvider,
    CodeTaskBlockerType.NoAiCredits,
    CodeTaskBlockerType.DailyLimitReached,
  ])(
    "what stops AI in the whole project (%s): no row, and no other repository asked",
    async (type: CodeTaskBlockerType) => {
      blockers[HERE] = { type, message: "Not in this project." };

      expect(
        await marked([summary(), summary({ codeRepositoryId: THERE })]),
      ).toEqual([false, false]);
      expect(CodeTaskGate.getBlocker).toHaveBeenCalledTimes(1);
    },
  );

  test("each repository is asked once, however many of its rows", async () => {
    await marked([
      summary(),
      summary(),
      summary({ state: CodeTaskState.Stopped }),
      summary({ codeRepositoryId: THERE }),
    ]);

    expect(CodeTaskAccess.canAskInRepository).toHaveBeenCalledTimes(2);
    expect(CodeTaskGate.getBlocker).toHaveBeenCalledTimes(2);
  });

  test("a list with nothing to try again asks nothing", async () => {
    expect(
      await marked([
        summary({ state: CodeTaskState.Done }),
        summary({ state: CodeTaskState.Working }),
      ]),
    ).toEqual([false, false]);
    expect(CodeTaskAccess.findReadableRepository).not.toHaveBeenCalled();
    expect(CodeTaskGate.getBlocker).not.toHaveBeenCalled();
  });

  test("rows it cannot be pressed on are left without the key at all", async () => {
    canAsk[HERE] = false;
    const rows: Array<CodeTaskSummaryJSON> = [summary()];

    await marked(rows);

    expect(rows[0]).not.toHaveProperty("canTryAgain");
  });
});
