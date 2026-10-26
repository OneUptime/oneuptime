/*
 * ---------------------------------------------------------------------------
 * What the Runner asks for a code fix, and what it keeps, now that global
 * Runners do code fixes.
 *
 *   - getCodeRepositories names the task it claimed, as getExceptionDetails
 *     and getRepositoryToken do: a global Runner is answered only for the
 *     exception of the run it holds (CodeFixAgentAuth.deniesAccessToRun).
 *   - getRepositoryToken remembers a GitHub repository's token, which is
 *     minted for the run, to be revoked when the run ends
 *     (RepositoryTokenRevocation) - never another host's, which is its
 *     connection's own.
 * ---------------------------------------------------------------------------
 */

import BackendAPI, {
  CodeRepositoryInfo,
  RepositoryToken,
} from "../../Utils/BackendAPI";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import RepositoryTokenRevocation from "../../Utils/RepositoryTokenRevocation";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

interface PostCall {
  url: URL;
  data: JSONObject;
}

function postCall(): PostCall {
  expect(postMock).toHaveBeenCalledTimes(1);

  return postMock.mock.calls[0]?.[0] as PostCall;
}

beforeEach(() => {
  postMock.mockReset();
  RepositoryTokenRevocation.reset();
});

afterAll(() => {
  RepositoryTokenRevocation.reset();
});

describe("BackendAPI.getCodeRepositories", () => {
  beforeEach(() => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          repositories: [
            {
              id: "repository-1",
              name: "users-api",
              repositoryHostedAt: "GitHub",
              organizationName: "acme",
              repositoryName: "users-api",
              mainBranchName: "main",
              setupCommand: null,
              buildCommand: null,
              testCommand: null,
            },
          ],
        },
        {},
      ),
    );
  });

  test("names the task it claimed, beside the exception", async () => {
    const repositories: Array<CodeRepositoryInfo> =
      await new BackendAPI().getCodeRepositories("exception-1", "task-1");

    expect(postCall().url.toString()).toContain(
      "/api/ai-agent-data/get-code-repositories",
    );
    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      exceptionId: "exception-1",
      taskId: "task-1",
    });
    expect(repositories).toHaveLength(1);
  });

  test("with no task: the exception alone, as before", async () => {
    await new BackendAPI().getCodeRepositories("exception-1");

    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      exceptionId: "exception-1",
    });
  });

  test("a repository a global Runner is handed has no commands, and reads as having none", async () => {
    const repositories: Array<CodeRepositoryInfo> =
      await new BackendAPI().getCodeRepositories("exception-1", "task-1");

    expect(repositories[0]!.setupCommand).toBeNull();
    expect(repositories[0]!.buildCommand).toBeNull();
    expect(repositories[0]!.testCommand).toBeNull();
  });
});

describe("BackendAPI.getRepositoryToken", () => {
  function tokenAnswer(extra: JSONObject = {}): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(
      200,
      {
        token: "ghs_minted_for_this_run",
        expiresAt: "2030-01-01T00:00:00.000Z",
        repositoryUrl: "https://github.com/acme/users-api.git",
        organizationName: "acme",
        repositoryName: "users-api",
        ...extra,
      },
      {},
    );
  }

  test("a GitHub repository's token is remembered, to be revoked when the run ends", async () => {
    postMock.mockResolvedValue(tokenAnswer());

    const token: RepositoryToken = await new BackendAPI().getRepositoryToken(
      "repository-1",
      "task-1",
    );

    expect(token.token).toBe("ghs_minted_for_this_run");
    expect(token.codeHost).toBeUndefined();
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(1);
    // The run goes with the request: a global Runner is handed a token only for its run.
    expect(postCall().data["taskId"]).toBe("task-1");
  });

  test("another host's token is its connection's own, and is never remembered for revoking", async () => {
    postMock.mockResolvedValue(
      tokenAnswer({
        token: "glpat-the-connections-own",
        repositoryUrl: "https://gitlab.com/acme/users-api.git",
        codeHost: {
          type: CodeRepositoryType.GitLab,
          hostUrl: "https://gitlab.com",
          apiUrl: "https://gitlab.com/api/v4",
          username: "oauth2",
          hasPullRequests: true,
        },
      }),
    );

    const token: RepositoryToken = await new BackendAPI().getRepositoryToken(
      "repository-1",
      "task-1",
    );

    expect(token.codeHost?.type).toBe(CodeRepositoryType.GitLab);
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
  });

  test("a code host the Runner cannot read is still not GitHub: its token is not revoked", async () => {
    postMock.mockResolvedValue(
      tokenAnswer({
        token: "a-token-of-a-host-this-runner-does-not-know",
        codeHost: { type: "SomeFutureHost", hostUrl: "https://code.example" },
      }),
    );

    await new BackendAPI().getRepositoryToken("repository-1", "task-1");

    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
  });

  test("a refusal throws its reason and remembers nothing", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Code repository not found" }, {}),
    );

    await expect(
      new BackendAPI().getRepositoryToken("repository-1", "task-1"),
    ).rejects.toThrow("Code repository not found");
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
  });
});
