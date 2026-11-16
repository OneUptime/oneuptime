import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import CodeFixPullRequestOpener, {
  FixPullRequestRequest,
} from "../../../Server/Utils/AI/CodeFix/CodeFixPullRequestOpener";
import CodeFixPullRequestRecord from "../../../Server/Utils/AI/CodeFix/CodeFixPullRequestRecord";
import CodeRepositoryRunnerChoice from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import FixVerificationStatus from "../../../Types/AI/FixVerificationStatus";
import URL from "../../../Types/API/URL";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL } from "../../../Types/Runner/CodeRepositoryRunner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-agent-data/open-pull-request (issue #8916): OneUptime opens the
 * pull (or merge) request of a branch a worker pushed, with what the
 * repository is connected with, and records it - so the token the worker
 * pushed with needs to do nothing more.
 *
 * It is the one route that writes to a repository's host on a worker's say,
 * so a worker opens one only for the fix it claimed and still holds, in a
 * repository it may work in, from the branch its run made, once per
 * repository - and is told nothing it could not know otherwise.
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
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

const OPEN_ROUTE: string = "/ai-agent-data/open-pull-request";

/*
 * The route's refusals, each a sentence that says what to send (the
 * ErrorMessagesGuard rule). A missing run, another worker's and one in
 * another state read alike, so a probing key cannot tell them apart.
 */
const TASK_NOT_FOUND: string =
  "OneUptime could not find this task. It may have finished, or belong to another worker.";
const TASK_ID_MISSING: string =
  "The request names no task. Send the taskId of the run this pull request is for.";
const REPOSITORY_NOT_FOUND: string =
  "OneUptime could not find this code repository in the task's project. Send the codeRepositoryId of one of its repositories.";
const BRANCH_NAME_REFUSAL: string =
  'The headRefName is not a branch name Git takes. Send one without spaces, ".." or the characters Git refuses.';
const CONNECTION_TOKEN: string = "glpat-never-leaves-the-server-0001";
const PULL_REQUEST_URL: string =
  "https://gitlab.example.com/acme/checkout/-/merge_requests/12";

function thrownError(): Error | undefined {
  const sendErrorResponse: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  if (sendErrorResponse.mock.calls.length === 0) {
    return undefined;
  }

  return sendErrorResponse.mock.calls[0]![2] as Error;
}

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  if (sendJson.mock.calls.length === 0) {
    return undefined;
  }

  return sendJson.mock.calls[0]![2] as JSONObject;
}

describe("POST /ai-agent-data/open-pull-request", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let repositoryId: ObjectID;
  let agentId: ObjectID;
  let identity: CodeFixAgentIdentity;
  let run: AIRun | null;
  let repository: CodeRepository | null;
  let recorded: AIAgentTaskPullRequest | null;
  let next: jest.Mock;

  let mayWorkSpy: jest.SpyInstance;
  let openSpy: jest.SpyInstance;
  let recordSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentDataAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    repositoryId = ObjectID.generate();
    agentId = ObjectID.generate();
    identity = {
      id: agentId,
      projectId: projectId,
      source: CodeFixAgentSource.Runner,
    };
    recorded = null;

    run = new AIRun();
    run.id = runId;
    run.projectId = projectId;
    run.runType = AIRunType.CodeFix;
    run.status = AIRunStatus.Running;
    run.aiAgentId = agentId;
    run.codeFixTaskType = CodeFixTaskType.FixException;

    repository = new CodeRepository();
    repository.id = repositoryId;
    repository.projectId = projectId;
    repository.repositoryHostedAt = CodeRepositoryType.GitLab;
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitLabProjectId = "4217";

    jest
      .spyOn(CodeFixAgentAuth, "checkCredential")
      .mockImplementation(async () => {
        return credentialCheckProving(identity);
      });

    jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (): Promise<AIRun | null> => {
        return run;
      });

    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockImplementation(async (): Promise<CodeRepository | null> => {
        return repository;
      });

    mayWorkSpy = jest
      .spyOn(CodeRepositoryRunnerChoice, "mayWorkInRepository")
      .mockResolvedValue(true);

    jest
      .spyOn(CodeFixPullRequestOpener, "findRecordedPullRequest")
      .mockImplementation(async (): Promise<AIAgentTaskPullRequest | null> => {
        return recorded;
      });

    openSpy = jest.spyOn(CodeFixPullRequestOpener, "open").mockResolvedValue({
      id: 9001,
      number: 12,
      htmlUrl: PULL_REQUEST_URL,
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });

    recordSpy = jest
      .spyOn(CodeFixPullRequestRecord, "record")
      .mockImplementation(async () => {
        const row: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
        row._id = ObjectID.generate().toString();
        return { pullRequest: row, created: true };
      });

    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function body(overrides: JSONObject = {}): JSONObject {
    return {
      aiAgentId: agentId.toString(),
      aiAgentKey: "runner-key",
      taskId: runId.toString(),
      codeRepositoryId: repositoryId.toString(),
      headRefName: `oneuptime-fix-exception-${runId.toString().substring(0, 8)}`,
      baseRefName: "main",
      title: "fix: resolve TypeError in checkout",
      body: "## Exception Fix\n\nWhat changed.",
      runnerVerificationStatus: FixVerificationStatus.Passed,
      runnerVerificationSummary: "Build and tests passed.",
      ...overrides,
    };
  }

  async function callRoute(requestBody: JSONObject = body()): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: requestBody,
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    await mockRouter
      .match("POST", OPEN_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);
  }

  function expectNothingOpened(): void {
    expect(openSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(jsonResponse()).toBeUndefined();
  }

  describe("for the fix the worker claimed and still holds", () => {
    test("opens the pull request as OneUptime, records it on the run, and answers where it is", async () => {
      await callRoute();

      expect(thrownError()).toBeUndefined();
      expect(openSpy).toHaveBeenCalledTimes(1);

      const opened: {
        repository: CodeRepository;
        request: FixPullRequestRequest;
      } = openSpy.mock.calls[0]![0] as {
        repository: CodeRepository;
        request: FixPullRequestRequest;
      };

      expect(opened.repository).toBe(repository);
      expect(opened.request.headRefName).toBe(
        `oneuptime-fix-exception-${runId.toString().substring(0, 8)}`,
      );
      expect(opened.request.baseRefName).toBe("main");
      expect(opened.request.codeRepositoryId.toString()).toBe(
        repositoryId.toString(),
      );

      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy.mock.calls[0]![0]).toMatchObject({
        aiRunId: runId,
        projectId: projectId,
        aiAgent: identity,
        fields: {
          pullRequestUrl: PULL_REQUEST_URL,
          pullRequestNumber: 12,
          pullRequestId: 9001,
          headRefName: opened.request.headRefName,
          baseRefName: "main",
          runnerVerificationStatus: FixVerificationStatus.Passed,
          runnerVerificationSummary: "Build and tests passed.",
        },
      });

      expect(jsonResponse()).toMatchObject({
        success: true,
        pullRequestUrl: PULL_REQUEST_URL,
        pullRequestNumber: 12,
        hostPullRequestId: 9001,
        isNew: true,
      });
    });

    test("never answers with a token", async () => {
      await callRoute();

      expect(JSON.stringify(jsonResponse())).not.toContain(CONNECTION_TOKEN);
      expect(Object.keys(jsonResponse() || {})).not.toContain("token");
    });

    test("a global Runner opens one for the run it claimed, as a project's Runner does", async () => {
      identity = { id: agentId, source: CodeFixAgentSource.Runner };

      await callRoute();

      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    test("asked again for the same branch, it answers with the one it recorded and opens nothing", async () => {
      recorded = new AIAgentTaskPullRequest();
      recorded._id = ObjectID.generate().toString();
      recorded.pullRequestUrl = URL.fromString(PULL_REQUEST_URL);
      recorded.pullRequestNumber = 12;
      recorded.pullRequestId = 9001;
      recorded.title = "fix: resolve TypeError in checkout";
      recorded.headRefName = `oneuptime-fix-exception-${runId.toString().substring(0, 8)}`;

      await callRoute();

      expect(openSpy).not.toHaveBeenCalled();
      expect(recordSpy).not.toHaveBeenCalled();
      expect(jsonResponse()).toMatchObject({
        success: true,
        pullRequestUrl: PULL_REQUEST_URL,
        pullRequestNumber: 12,
        isNew: false,
      });
    });

    test("a second branch in a repository it opened one in is refused: one per repository", async () => {
      recorded = new AIAgentTaskPullRequest();
      recorded.pullRequestUrl = URL.fromString(PULL_REQUEST_URL);
      recorded.headRefName = `oneuptime-fix-exception-${runId.toString().substring(0, 8)}`;

      await callRoute(
        body({
          headRefName: `another-${runId.toString().substring(0, 8)}`,
        }),
      );

      expectNothingOpened();
      expect(thrownError()?.message).toContain(
        "opened its pull request in this repository already",
      );
    });

    test("the host's refusal reaches the worker as an error, and nothing is recorded", async () => {
      openSpy.mockRejectedValue(
        new BadDataException(
          "OneUptime could not open the merge request: GitLab refused the request (HTTP 422) (Source branch does not exist).",
        ),
      );

      await callRoute();

      expect(recordSpy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect((next.mock.calls[0]![0] as Error).message).toContain(
        "Source branch does not exist",
      );
    });
  });

  /*
   * A worker can't open a pull request for a fix it didn't claim: answered
   * exactly as a missing run, so a probing key cannot tell another worker's
   * run from none - and nothing reaches the repository's host.
   */
  describe("never for a fix the worker does not hold", () => {
    test("a run another worker claimed", async () => {
      run!.aiAgentId = ObjectID.generate();

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);
    });

    test("a global Runner's request for a run another worker claimed", async () => {
      identity = { id: agentId, source: CodeFixAgentSource.Runner };
      run!.aiAgentId = ObjectID.generate();

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);
    });

    test.each([
      AIRunStatus.Queued,
      AIRunStatus.Completed,
      AIRunStatus.Error,
      AIRunStatus.NoFixFound,
    ])("a run it claimed that is %s now", async (status: AIRunStatus) => {
      run!.status = status;

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);
    });

    test("a run of another project", async () => {
      run!.projectId = ObjectID.generate();

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);
    });

    test("a run that is not a code fix, or none at all", async () => {
      run!.runType = AIRunType.Chat;

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);

      jest.clearAllMocks();
      run = null;

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(TASK_NOT_FOUND);
    });

    test("a request that names no run, or names something that is not one", async () => {
      for (const taskId of [undefined, "", "not-a-run", 12]) {
        jest.clearAllMocks();

        await callRoute(body({ taskId: taskId as never }));

        expectNothingOpened();
        expect(thrownError()?.message).toBe(TASK_ID_MISSING);
      }
    });

    test.each([
      CodeFixTaskType.GitHubPullRequestReview,
      CodeFixTaskType.GitHubPullRequestRevision,
    ])(
      "a run of a recipe that opens no pull request (%s)",
      async (taskType: CodeFixTaskType) => {
        run!.codeFixTaskType = taskType;

        await callRoute();

        expectNothingOpened();
        expect(thrownError()?.message).toContain("opens no pull request");
      },
    );
  });

  describe("never in a repository the run may not open one in", () => {
    test("one of another project", async () => {
      repository!.projectId = ObjectID.generate();

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(REPOSITORY_NOT_FOUND);
    });

    test("one that is not there", async () => {
      repository = null;

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(REPOSITORY_NOT_FOUND);
    });

    test("a request from Code, in another repository than it was asked in", async () => {
      run!.codeFixTaskType = CodeFixTaskType.CodeRequest;
      run!.codeRepositoryId = ObjectID.generate();

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toContain("asked in another repository");
    });

    test("one whose Runner setting picks another worker", async () => {
      mayWorkSpy.mockResolvedValue(false);

      await callRoute();

      expectNothingOpened();
      expect(thrownError()?.message).toBe(CODE_REPOSITORY_RUNNER_TOKEN_REFUSAL);
    });
  });

  describe("never from a branch the run did not make", () => {
    test.each([
      ["someone else's branch", "feature/login"],
      ["the default branch", "main"],
      ["a branch named for another run", "oneuptime-fix-exception-ffffffff"],
    ])("%s", async (_name: string, headRefName: string) => {
      await callRoute(body({ headRefName }));

      expectNothingOpened();
      expect(thrownError()?.message).toContain(
        "only from the branch this task pushed",
      );
    });

    test.each([
      [
        "a missing branch",
        { headRefName: undefined },
        "The request names no headRefName. Send the name of the branch.",
      ],
      [
        "a missing base",
        { baseRefName: "" },
        "The request names no baseRefName. Send the name of the branch.",
      ],
      [
        "a branch Git takes no name like",
        { headRefName: "../../etc/passwd" },
        BRANCH_NAME_REFUSAL,
      ],
      [
        "a branch with a space",
        { headRefName: "oneuptime fix" },
        BRANCH_NAME_REFUSAL,
      ],
      [
        "a missing title",
        { title: "   " },
        "The pull request has no title. Send one with the request.",
      ],
      [
        "a repository that is not an id",
        { codeRepositoryId: "checkout" },
        "The request names no code repository. Send the codeRepositoryId of the repository to open the pull request in.",
      ],
    ])(
      "%s is refused before anything is read",
      async (_name: string, overrides: JSONObject, message: string) => {
        await callRoute(body(overrides));

        expectNothingOpened();
        expect(thrownError()?.message).toBe(message);
        expect(AIRunService.findOneById).not.toHaveBeenCalled();
      },
    );
  });
});
