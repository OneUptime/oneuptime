import AIAgentDataAPI from "../../../Server/API/AIAgentDataAPI";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import OpenPullRequestCap from "../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeRepositoryRunnerChoice from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import CodeHostRunnerToken from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostRunnerToken";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import RunnerCodeFixCapability, {
  RUNNER_CODE_FIX_CAPABILITIES_FIELD,
  SERVER_OPENS_PULL_REQUEST_FIELD,
} from "../../../Types/Runner/RunnerCodeFixCapability";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * WHAT A REPOSITORY'S TOKEN MAY DO, PER RUNNER AND PER RECIPE (#8916).
 *
 * A Runner that has OneUptime open its pull requests declares
 * serverOpensPullRequests on its code-fix requests: its GitHub token then
 * pushes and opens nothing (no pull_requests), and the answer says OneUptime
 * opens the pull request. A Runner that declares nothing keeps the token it
 * always had. A review changes nothing, so its token only reads. For a
 * repository off GitHub the route hands the decision what the Runner
 * declares and the run it holds, and passes on what it decides.
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

const TOKEN_ROUTE: string = "/ai-agent-data/get-repository-token";

function jsonResponse(): JSONObject | undefined {
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  if (sendJson.mock.calls.length === 0) {
    return undefined;
  }

  return sendJson.mock.calls[0]![2] as JSONObject;
}

describe("POST /ai-agent-data/get-repository-token, by what the Runner declares", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let repositoryId: ObjectID;
  let agentId: ObjectID;
  let identity: CodeFixAgentIdentity;
  let run: AIRun;
  let repository: CodeRepository;
  let mintSpy: jest.SpyInstance;
  let decideSpy: jest.SpyInstance;

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

    run = new AIRun();
    run.id = runId;
    run.projectId = projectId;
    run.runType = AIRunType.CodeFix;
    run.status = AIRunStatus.Running;
    run.aiAgentId = agentId;
    run.codeFixTaskType = CodeFixTaskType.FixException;
    run.codeRepositoryId = repositoryId;

    repository = new CodeRepository();
    repository.id = repositoryId;
    repository.projectId = projectId;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "acme";
    repository.repositoryName = "checkout";
    repository.gitHubAppInstallationId = "12345";

    jest
      .spyOn(CodeFixAgentAuth, "checkCredential")
      .mockImplementation(async () => {
        return credentialCheckProving(identity);
      });
    jest
      .spyOn(CodeRepositoryRunnerChoice, "mayWorkInRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockImplementation(async (): Promise<CodeRepository | null> => {
        return repository;
      });
    jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (): Promise<AIRun | null> => {
        return run;
      });
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(0 as never);
    jest
      .spyOn(OpenPullRequestCap, "checkForRepository")
      .mockResolvedValue({ allowed: true } as never);
    jest
      .spyOn(GitHubInstallationBinding, "isInstallationBoundToProject")
      .mockResolvedValue(true);

    mintSpy = jest
      .spyOn(GitHubUtil, "getRepositoryAccessToken")
      .mockResolvedValue({ token: "ghs_for_the_run", expiresAt: new Date() });

    decideSpy = jest.spyOn(CodeHostRunnerToken, "decide");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function callRoute(capabilities: unknown): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: agentId.toString(),
        aiAgentKey: "runner-key",
        codeRepositoryId: repositoryId.toString(),
        taskId: runId.toString(),
        supportedCodeHosts: [
          CodeRepositoryType.GitHub,
          CodeRepositoryType.GitLab,
          CodeRepositoryType.Forgejo,
          CodeRepositoryType.Git,
        ],
        ...(capabilities === undefined
          ? {}
          : { [RUNNER_CODE_FIX_CAPABILITIES_FIELD]: capabilities }),
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    await mockRouter
      .match("POST", TOKEN_ROUTE)
      .handlerFunction(req, res, jest.fn() as unknown as NextFunction);
  }

  function mintedPermissions(): Record<string, string> {
    return (
      mintSpy.mock.calls[0]![0] as { permissions: Record<string, string> }
    ).permissions;
  }

  describe("a GitHub repository", () => {
    test("a Runner that has OneUptime open its pull requests gets a token that pushes and opens nothing, and is told so", async () => {
      await callRoute([RunnerCodeFixCapability.ServerOpensPullRequests]);

      expect(mintedPermissions()).toEqual({
        contents: "write",
        metadata: "read",
      });
      expect(mintedPermissions()["pull_requests"]).toBeUndefined();
      expect(jsonResponse()![SERVER_OPENS_PULL_REQUEST_FIELD]).toBe(true);
      expect(jsonResponse()!["token"]).toBe("ghs_for_the_run");
    });

    test("a Runner that declares nothing gets the token it always did, and opens its pull request itself", async () => {
      for (const capabilities of [undefined, [], ["somethingNewer"], "x"]) {
        jest.clearAllMocks();

        await callRoute(capabilities);

        expect(mintedPermissions()).toEqual({
          contents: "write",
          pull_requests: "write",
          metadata: "read",
        });
        expect(
          jsonResponse()![SERVER_OPENS_PULL_REQUEST_FIELD],
        ).toBeUndefined();
      }
    });

    test("a review, which changes nothing, only reads - whatever the Runner declares", async () => {
      run.codeFixTaskType = CodeFixTaskType.GitHubPullRequestReview;

      for (const capabilities of [
        undefined,
        [RunnerCodeFixCapability.ServerOpensPullRequests],
      ]) {
        jest.clearAllMocks();

        await callRoute(capabilities);

        expect(mintedPermissions()).toEqual({
          contents: "read",
          metadata: "read",
        });
        expect(
          jsonResponse()![SERVER_OPENS_PULL_REQUEST_FIELD],
        ).toBeUndefined();
      }
    });

    test("a revision pushes to its pull request's branch: it writes, and opens nothing", async () => {
      run.codeFixTaskType = CodeFixTaskType.GitHubPullRequestRevision;

      await callRoute([RunnerCodeFixCapability.ServerOpensPullRequests]);

      expect(mintedPermissions()).toEqual({
        contents: "write",
        metadata: "read",
      });
    });
  });

  describe("a repository that is not on GitHub", () => {
    beforeEach(() => {
      repository.repositoryHostedAt = CodeRepositoryType.GitLab;
      delete repository.gitHubAppInstallationId;
      repository.codeRepositoryConnectionId = ObjectID.generate();
    });

    test("the decision is handed what the Runner declares and the run it holds, and its answer passed on", async () => {
      const expiresAt: Date = new Date("2026-11-17T00:00:00.000Z");

      decideSpy.mockResolvedValue({
        grant: {
          token: "glpat-project-token-900",
          expiresAt,
          cloneUrl: "https://gitlab.example.com/acme/checkout.git",
          organizationName: "acme",
          repositoryName: "checkout",
          serverOpensPullRequest: true,
          isMintedForRun: true,
          codeHost: {
            type: CodeRepositoryType.GitLab,
            hostUrl: "https://gitlab.example.com",
            apiUrl: "https://gitlab.example.com/api/v4",
            webUrl: "https://gitlab.example.com/acme/checkout",
            username: "oauth2",
            projectId: "4217",
            hasPullRequests: true,
            isPrivateNetworkAllowed: true,
          },
        },
      } as never);

      await callRoute([RunnerCodeFixCapability.ServerOpensPullRequests]);

      const asked: {
        capabilities: Array<RunnerCodeFixCapability>;
        runId: ObjectID | null;
        repository: CodeRepository;
      } = decideSpy.mock.calls[0]![0] as {
        capabilities: Array<RunnerCodeFixCapability>;
        runId: ObjectID | null;
        repository: CodeRepository;
      };

      expect(asked.capabilities).toEqual([
        RunnerCodeFixCapability.ServerOpensPullRequests,
      ]);
      expect(asked.runId?.toString()).toBe(runId.toString());
      expect(mintSpy).not.toHaveBeenCalled();

      expect(jsonResponse()).toMatchObject({
        token: "glpat-project-token-900",
        expiresAt: "2026-11-17T00:00:00.000Z",
        [SERVER_OPENS_PULL_REQUEST_FIELD]: true,
      });

      // The repository is read with what the decision needs of it.
      const read: { select: Record<string, unknown> } = (
        CodeRepositoryService.findOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as { select: Record<string, unknown> };

      expect(read.select["mintedTokenRefusedAt"]).toBe(true);
    });

    test("an answer where OneUptime opens nothing says nothing of it", async () => {
      decideSpy.mockResolvedValue({
        grant: {
          token: "glpat-connection",
          expiresAt: new Date(),
          cloneUrl: "https://gitlab.example.com/acme/checkout.git",
          organizationName: "acme",
          repositoryName: "checkout",
          serverOpensPullRequest: false,
          isMintedForRun: false,
          codeHost: {
            type: CodeRepositoryType.GitLab,
            hostUrl: "https://gitlab.example.com",
            apiUrl: "https://gitlab.example.com/api/v4",
            webUrl: null,
            username: "alice",
            projectId: "4217",
            hasPullRequests: true,
          },
        },
      } as never);

      await callRoute(undefined);

      expect(
        (decideSpy.mock.calls[0]![0] as { capabilities: Array<string> })
          .capabilities,
      ).toEqual([]);
      expect(jsonResponse()![SERVER_OPENS_PULL_REQUEST_FIELD]).toBeUndefined();
    });
  });
});
