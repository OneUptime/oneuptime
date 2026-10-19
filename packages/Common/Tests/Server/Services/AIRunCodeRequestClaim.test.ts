import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A request from Code goes only to a Runner that can carry it out. A Runner
 * names the recipes it has handlers for when it asks for work; one built
 * before it said is handed only the recipes every Runner has had, so a
 * request waits for a Runner that can do it instead of failing at once in
 * one that cannot ("No handler registered"). A queued request that cannot
 * say what was asked, or whose repository is gone, is failed with why.
 */

const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);

function queuedRequest(data: {
  message?: string;
  repositoryId?: ObjectID | null;
}): AIRun {
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    attemptCount: 0,
    codeFixTaskType: CodeFixTaskType.CodeRequest,
    codeRepositoryId:
      data.repositoryId === null
        ? undefined
        : data.repositoryId || REPOSITORY_ID,
    taskContext:
      data.message === undefined
        ? { request: { message: "Add retries", context: [] } }
        : { request: { message: data.message, context: [] } },
  } as unknown as AIRun;
}

// The recipes a claim asked for: the parameter of its Raw IN (...) OR NULL.
function claimableRecipes(findOneBy: jest.Mock): Array<string> {
  const query: Record<string, unknown> = (
    findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
  ).query;

  return Object.values(
    (
      query["codeFixTaskType"] as {
        objectLiteralParameters: Record<string, Array<string>>;
      }
    ).objectLiteralParameters,
  )[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which recipes a Runner is handed", () => {
  test("a Runner that names its recipes is handed only those", async () => {
    const find: jest.Mock = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null) as unknown as jest.Mock;

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
      supportedTaskTypes: [
        CodeFixTaskType.CodeRequest,
        CodeFixTaskType.FixException,
      ],
    });

    expect(claimableRecipes(find)).toEqual([
      CodeFixTaskType.CodeRequest,
      CodeFixTaskType.FixException,
    ]);
  });

  test("a Runner that does not say is never handed a request from Code", async () => {
    const find: jest.Mock = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null) as unknown as jest.Mock;

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
      supportedTaskTypes: null,
    });

    const recipes: Array<string> = claimableRecipes(find);

    expect(recipes).not.toContain(CodeFixTaskType.CodeRequest);
    expect(recipes).toContain(CodeFixTaskType.FixException);
    expect(recipes).toContain(CodeFixTaskType.GitHubIssueFix);
  });

  test("a run with no recipe (before recipes existed) is still claimable: the filter keeps NULL", async () => {
    const find: jest.Mock = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null) as unknown as jest.Mock;

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: ObjectID.generate(),
    });

    const query: Record<string, unknown> = (
      find.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    const sql: string = (
      query["codeFixTaskType"] as { getSql: (alias: string) => string }
    ).getSql('"codeFixTaskType"');

    expect(sql).toContain('"codeFixTaskType" IS NULL');
  });
});

describe("a queued request is claimed only when it can be carried out", () => {
  test("a request with its words and its repository is claimed", async () => {
    const run: AIRun = queuedRequest({});

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    const transition: jest.Mock = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1) as unknown as jest.Mock;

    expect(
      await AIRunService.claimNextQueuedCodeFixRun({
        aiAgentId: ObjectID.generate(),
        supportedTaskTypes: [CodeFixTaskType.CodeRequest],
      }),
    ).toBe(run);
    expect(transition).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      "with no words",
      { message: "   " },
      "Queued request has no request in its task context.",
    ],
    [
      "whose repository is gone",
      { repositoryId: null },
      "The repository this request was made in is no longer connected to the project.",
    ],
  ])(
    "a request %s is failed with why, and the next one claimed",
    async (
      _why: string,
      broken: { message?: string; repositoryId?: ObjectID | null },
      message: string,
    ) => {
      const brokenRun: AIRun = queuedRequest(broken);
      const goodRun: AIRun = queuedRequest({});

      jest
        .spyOn(AIRunService, "findOneBy")
        .mockResolvedValueOnce(brokenRun)
        .mockResolvedValueOnce(goodRun);
      const transition: jest.Mock = jest
        .spyOn(AIRunService, "attemptStatusTransition")
        .mockResolvedValue(1) as unknown as jest.Mock;

      expect(
        await AIRunService.claimNextQueuedCodeFixRun({
          aiAgentId: ObjectID.generate(),
          supportedTaskTypes: [CodeFixTaskType.CodeRequest],
        }),
      ).toBe(goodRun);

      expect(transition).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          aiRunId: brokenRun.id,
          fromStatus: AIRunStatus.Running,
          set: expect.objectContaining({
            status: AIRunStatus.Error,
            errorMessage: expect.stringContaining(message),
          }),
        }),
      );
    },
  );
});
