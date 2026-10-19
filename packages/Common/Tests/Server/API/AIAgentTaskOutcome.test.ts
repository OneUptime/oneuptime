import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { CodeTaskFileStatus } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A turn of a task in Code ends with what the Runner reports alongside its
 * Completed status: the AI's reply, the files it changed and their diff, and
 * whether it asked the person something. It is written in the same
 * transition that finishes the run, so the conversation never shows a
 * finished turn without its reply; a Runner that reports none (built before
 * Code) leaves the run as it always did.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = "/ai-agent-task/update-task-status";

interface TransitionCall {
  fromStatus: AIRunStatus;
  set: Record<string, unknown>;
}

let transitionSpy: jest.Mock;
let runId: ObjectID;

const OUTCOME: JSONObject = {
  summary: "Added a retry with backoff.",
  filesChanged: [
    {
      path: "src/api/users.ts",
      status: "Modified",
      additions: 4,
      deletions: 1,
    },
  ],
  branchName: "oneuptime-task-42-5e1f4b3a",
  pullRequestNumber: 17,
  pullRequestUrl: "https://github.com/acme/users-api/pull/17",
  openedPullRequest: true,
  needsInput: false,
  changes: {
    files: [
      {
        path: "src/api/users.ts",
        status: "Modified",
        additions: 4,
        deletions: 1,
        patch: "@@ -1 +1 @@\n-a\n+b",
      },
    ],
    isTruncated: false,
  },
};

async function report(body: JSONObject): Promise<void> {
  const next: jest.Mock = jest.fn();

  await mockRouter.match("POST", ROUTE).handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "runner-key",
        taskId: runId.toString(),
        ...body,
      },
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  expect(next).not.toHaveBeenCalled();
}

function written(): Record<string, unknown> {
  expect(transitionSpy).toHaveBeenCalledTimes(1);
  return (transitionSpy.mock.calls[0]![0] as TransitionCall).set;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentTaskAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  const projectId: ObjectID = ObjectID.generate();
  runId = ObjectID.generate();

  jest.spyOn(CodeFixAgentAuth, "checkCredential").mockResolvedValue(
    credentialCheckProving({
      id: ObjectID.generate(),
      projectId: projectId,
      source: CodeFixAgentSource.Runner,
    }),
  );
  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    const run: AIRun = new AIRun();
    run.id = runId;
    run.projectId = projectId;
    run.status = AIRunStatus.Running;
    return run;
  });
  transitionSpy = jest
    .spyOn(AIRunService, "attemptStatusTransition")
    .mockResolvedValue(1) as unknown as jest.Mock;
  jest
    .spyOn(AIRunEventService, "appendEventToRun")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AIRunService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a turn's outcome, with its Completed status", () => {
  test("the reply, the files, the pull request and the diff are kept on the run", async () => {
    await report({ status: AIAgentTaskStatus.Completed, outcome: OUTCOME });

    const set: Record<string, unknown> = written();

    expect(set["status"]).toBe(AIRunStatus.Completed);
    expect(set["taskOutcome"]).toEqual({
      summary: "Added a retry with backoff.",
      filesChanged: [
        {
          path: "src/api/users.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 4,
          deletions: 1,
        },
      ],
      branchName: "oneuptime-task-42-5e1f4b3a",
      pullRequestNumber: 17,
      pullRequestUrl: "https://github.com/acme/users-api/pull/17",
      openedPullRequest: true,
    });
    expect(set["codeChanges"]).toEqual({
      files: [
        {
          path: "src/api/users.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 4,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-a\n+b",
        },
      ],
      isTruncated: false,
    });
    expect(set["needsUserInput"]).toBe(false);
  });

  test("a turn that asked the person something waits for their answer", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      outcome: { summary: "Which table holds the sessions?", needsInput: true },
    });

    expect(written()["needsUserInput"]).toBe(true);
  });

  test("only a finished turn can wait: one that found nothing to change does not", async () => {
    await report({
      status: AIAgentTaskStatus.NoFixFound,
      outcome: { summary: "Nothing to change.", needsInput: true },
    });

    const set: Record<string, unknown> = written();

    expect(set["needsUserInput"]).toBe(false);
    expect((set["taskOutcome"] as JSONObject)["summary"]).toBe(
      "Nothing to change.",
    );
  });

  test("a failed turn keeps no outcome", async () => {
    await report({
      status: AIAgentTaskStatus.Error,
      statusMessage: "The tests failed twice.",
      outcome: OUTCOME,
    });

    const set: Record<string, unknown> = written();

    expect(set["taskOutcome"]).toBeUndefined();
    expect(set["codeChanges"]).toBeUndefined();
    expect(set["needsUserInput"]).toBeUndefined();
  });

  test("a Runner built before Code reports none, and the run is kept as it always was", async () => {
    await report({ status: AIAgentTaskStatus.Completed });

    const set: Record<string, unknown> = written();

    expect(set).not.toHaveProperty("taskOutcome");
    expect(set).not.toHaveProperty("codeChanges");
    expect(set).not.toHaveProperty("needsUserInput");
  });

  test("an outcome that is not one is ignored", async () => {
    await report({ status: AIAgentTaskStatus.Completed, outcome: "done" });

    expect(written()).not.toHaveProperty("taskOutcome");
  });
});

describe("a Runner asking for work says which recipes it can carry out", () => {
  async function askForWork(body: JSONObject): Promise<unknown> {
    const claim: jest.Mock = jest
      .spyOn(AIRunService, "claimNextQueuedCodeFixRun")
      .mockResolvedValue(null) as unknown as jest.Mock;

    await mockRouter
      .match("POST", "/ai-agent-task/get-pending-task")
      .handlerFunction(
        {
          params: {},
          query: {},
          headers: {},
          body: {
            aiAgentId: ObjectID.generate().toString(),
            aiAgentKey: "runner-key",
            ...body,
          },
        } as unknown as ExpressRequest,
        {} as ExpressResponse,
        jest.fn() as unknown as NextFunction,
      );

    return (claim.mock.calls[0]![0] as { supportedTaskTypes: unknown })
      .supportedTaskTypes;
  }

  test("its list is read, keeping only real recipes", async () => {
    expect(
      await askForWork({
        supportedTaskTypes: ["CodeRequest", "FixException", "rm -rf"],
      }),
    ).toEqual(["CodeRequest", "FixException"]);
  });

  test("a Runner built before it said sends none, and is handed only what every Runner can do", async () => {
    expect(await askForWork({})).toBeNull();
  });
});
