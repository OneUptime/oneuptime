import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import OpenPullRequestCap from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A repository token, for a run that names itself:
 *
 *  - a request from Code works only in the repository it was asked in, so a
 *    token for another repository of the project is refused;
 *  - a run with no repository yet (an exception fix that finds its
 *    repository as it goes) is linked to the one it is handed a token for,
 *    so it shows on that repository's page in Code - before the open pull
 *    request cap answers, so a run the cap stops shows there with its reason;
 *  - a reply in a Code task whose open pull request it pushes to adds
 *    nothing to the review queue, so the cap does not stop it; a first
 *    request (which opens one) is held to the cap like any fix.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const TOKEN_ROUTE: string = "/ai-agent-data/get-repository-token";

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const OTHER_REPOSITORY_ID: ObjectID = new ObjectID(
  "4d0e3a2f-6b7c-4d8e-9f0a-1b2c3d4e5f60",
);
const RUN_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const TASK_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");

let storedRun: AIRun | null;
let workingPullRequest: AIAgentTaskPullRequest | null;
let capAllows: boolean;

function requestRun(data: {
  repositoryId?: ObjectID;
  codeTaskId?: ObjectID;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.CodeRequest;
  run.codeRepositoryId = data.repositoryId || REPOSITORY_ID;
  if (data.codeTaskId) {
    run.codeTaskId = data.codeTaskId;
  }
  return run;
}

async function askForToken(
  repositoryId: ObjectID = REPOSITORY_ID,
): Promise<{ error: Error | undefined; minted: boolean }> {
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", TOKEN_ROUTE)
    .handlerFunction(
      {
        params: {},
        query: {},
        headers: {},
        body: {
          aiAgentId: ObjectID.generate().toString(),
          aiAgentKey: "runner-key",
          codeRepositoryId: repositoryId.toString(),
          taskId: RUN_ID.toString(),
        },
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();

  const errors: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    error: errors.length > 0 ? (errors[0]![2] as Error) : undefined,
    minted:
      (GitHubUtil.getInstallationAccessToken as unknown as jest.Mock).mock
        .calls.length > 0,
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentDataAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  storedRun = requestRun({});
  workingPullRequest = null;
  capAllows = true;

  jest.spyOn(CodeFixAgentAuth, "resolveAgentIdentity").mockResolvedValue({
    id: ObjectID.generate(),
    projectId: PROJECT_ID,
    source: CodeFixAgentSource.Runner,
  });
  jest
    .spyOn(CodeRepositoryService, "findOneById")
    .mockImplementation(async (data: { id: ObjectID }) => {
      const repository: CodeRepository = new CodeRepository();
      repository._id = data.id.toString();
      repository.projectId = PROJECT_ID;
      repository.repositoryHostedAt = CodeRepositoryType.GitHub;
      repository.organizationName = "acme";
      repository.repositoryName = "users-api";
      repository.gitHubAppInstallationId = "48213377";
      return repository;
    });
  jest
    .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
    .mockResolvedValue(true);
  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    return storedRun;
  });
  jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  jest.spyOn(CodeTaskThread, "findTask").mockImplementation(async () => {
    const task: AIRun = requestRun({});
    task._id = TASK_ID.toString();
    return task;
  });
  jest
    .spyOn(CodeTaskThread, "findWorkingPullRequest")
    .mockImplementation(async () => {
      return workingPullRequest;
    });
  jest
    .spyOn(OpenPullRequestCap, "checkForRepository")
    .mockImplementation(async () => {
      return capAllows
        ? { allowed: true, limit: 5, paused: false, openCount: 1 }
        : { allowed: false, limit: 5, paused: false, openCount: 5 };
    });
  jest.spyOn(OpenPullRequestCap, "describeRejection").mockReturnValue(
    "acme/users-api already has 5 open pull requests from OneUptime AI.",
  );
  jest.spyOn(GitHubUtil, "getInstallationAccessToken").mockResolvedValue({
    token: "ghs_test",
    expiresAt: OneUptimeDate.getCurrentDate(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a request from Code works only in its own repository", () => {
  test("a token for the repository it was asked in is handed over", async () => {
    const { error, minted } = await askForToken();

    expect(error).toBeUndefined();
    expect(minted).toBe(true);
  });

  test("a token for another repository of the project is refused", async () => {
    const { error, minted } = await askForToken(OTHER_REPOSITORY_ID);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "This task was asked in another repository, and works only there.",
    );
    expect(minted).toBe(false);
  });

  test("other recipes are not held to one repository: they find theirs as they go", async () => {
    storedRun!.codeFixTaskType = CodeFixTaskType.FixException;

    expect((await askForToken(OTHER_REPOSITORY_ID)).minted).toBe(true);
  });
});

describe("a run with no repository yet is linked to the one it works in", () => {
  test("an exception fix is linked when it is handed a token, only while it has none", async () => {
    storedRun!.codeFixTaskType = CodeFixTaskType.FixException;
    delete storedRun!.codeRepositoryId;

    await askForToken();

    const update: { query: Record<string, unknown>; data: Record<string, unknown>; props: unknown } = (
      AIRunService.updateOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as never;

    expect(update.query["_id"]).toBe(RUN_ID.toString());
    expect(update.query["codeRepositoryId"]).toBeDefined();
    expect((update.data["codeRepositoryId"] as ObjectID).toString()).toBe(
      REPOSITORY_ID.toString(),
    );
    expect(update.props).toEqual({ isRoot: true });
  });

  test("a run the cap stops is linked first, so its repository's page shows why", async () => {
    storedRun!.codeFixTaskType = CodeFixTaskType.FixException;
    delete storedRun!.codeRepositoryId;
    capAllows = false;

    const { error, minted } = await askForToken();

    expect(error?.message).toContain("already has 5 open pull requests");
    expect(minted).toBe(false);
    expect(AIRunService.updateOneBy).toHaveBeenCalledTimes(1);
  });

  test("a run that already has its repository is left as it is", async () => {
    await askForToken();

    expect(AIRunService.updateOneBy).not.toHaveBeenCalled();
  });
});

describe("the open pull request cap and Code", () => {
  test("a first request opens a pull request, so the cap applies", async () => {
    capAllows = false;

    const { error, minted } = await askForToken();

    expect(error?.message).toContain("already has 5 open pull requests");
    expect(minted).toBe(false);
  });

  test("a reply that pushes to its task's open pull request adds nothing to review: the cap does not stop it", async () => {
    storedRun = requestRun({ codeTaskId: TASK_ID });
    workingPullRequest = new AIAgentTaskPullRequest();
    capAllows = false;

    const { error, minted } = await askForToken();

    expect(error).toBeUndefined();
    expect(minted).toBe(true);
    expect(OpenPullRequestCap.checkForRepository).not.toHaveBeenCalled();
  });

  test("a reply in a task whose pull request was merged opens a new one, so the cap applies", async () => {
    storedRun = requestRun({ codeTaskId: TASK_ID });
    workingPullRequest = null;
    capAllows = false;

    expect((await askForToken()).minted).toBe(false);
  });
});
