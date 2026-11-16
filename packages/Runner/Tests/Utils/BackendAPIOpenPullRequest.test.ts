/*
 * ---------------------------------------------------------------------------
 * BackendAPI.openPullRequest and what the token's answer says (#8916).
 *
 * A server of this release says, on a repository token's answer, that it
 * opens the run's pull request (serverOpensPullRequest): the Runner then
 * pushes the branch with the token and asks OneUptime to open the pull
 * request, which it records. The ask is retried on the failures a retry can
 * fix - the server answers a second ask with the pull request it opened -
 * and a refusal is thrown with its words. An older server says nothing, and
 * the Runner opens the pull request itself, as it always did.
 * ---------------------------------------------------------------------------
 */

import BackendAPI, {
  OpenPullRequestOptions,
  OpenedPullRequest,
  RepositoryToken,
} from "../../Utils/BackendAPI";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import RepositoryTokenRevocation from "../../Utils/RepositoryTokenRevocation";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";

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
  options?: JSONObject;
}

const OPEN: OpenPullRequestOptions = {
  taskId: "6690e1f1-e1f1-4e1f-8e1f-e1f1e1f1e1f1",
  codeRepositoryId: "6650f0b1-a1b2-4c3d-8e5f-607180000001",
  headRefName: "oneuptime-fix-exception-6690e1f1",
  baseRefName: "main",
  title: "fix: resolve TypeError in checkout",
  body: "## Exception Fix",
  runnerVerificationStatus: "Passed",
  runnerVerificationSummary: "npm test passed",
};

function postCall(): PostCall {
  expect(postMock).toHaveBeenCalledTimes(1);

  return postMock.mock.calls[0]?.[0] as PostCall;
}

describe("BackendAPI.openPullRequest", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          pullRequestId: "row-id",
          pullRequestUrl:
            "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
          pullRequestNumber: 12,
          hostPullRequestId: 9001,
          title: "fix: resolve TypeError in checkout",
          isNew: true,
        },
        {},
      ),
    );
  });

  test("asks open-pull-request with the run, the repository, the branches and the words - and no token", async () => {
    await new BackendAPI().openPullRequest(OPEN);

    expect(postCall().url.toString()).toContain(
      "/api/ai-agent-data/open-pull-request",
    );
    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      ...OPEN,
    });
    expect(Object.keys(postCall().data)).not.toContain("token");
  });

  test("retries with backoff, and only on failures a retry can fix", async () => {
    await new BackendAPI().openPullRequest(OPEN);

    expect(postCall().options).toEqual({
      retries: 3,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
      sameServerRedirectsOnly: true,
    });
  });

  test("answers where the pull request is", async () => {
    const opened: OpenedPullRequest = await new BackendAPI().openPullRequest(
      OPEN,
    );

    expect(opened).toEqual({
      id: 9001,
      number: 12,
      htmlUrl: "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });
  });

  test("an answer to an earlier ask says it was open already", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          pullRequestUrl:
            "https://gitlab.example.com/acme/checkout/-/merge_requests/12",
          pullRequestNumber: 12,
          isNew: false,
        },
        {},
      ),
    );

    const opened: OpenedPullRequest = await new BackendAPI().openPullRequest(
      OPEN,
    );

    expect(opened.isNew).toBe(false);
    // No host id said: the number stands in for it.
    expect(opened.id).toBe(12);
  });

  test("a refusal is thrown with its words", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "OneUptime could not open the merge request: GitLab refused the request (HTTP 422) (Source branch does not exist).",
        },
        {},
      ),
    );

    await expect(new BackendAPI().openPullRequest(OPEN)).rejects.toThrow(
      "Source branch does not exist",
    );
  });

  test("an answer that is not a pull request is thrown, never recorded as one", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { success: true }, {}),
    );

    await expect(new BackendAPI().openPullRequest(OPEN)).rejects.toThrow(
      "not a pull request",
    );
  });

  test("an ask that never got an answer throws", async () => {
    postMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(new BackendAPI().openPullRequest(OPEN)).rejects.toThrow(
      "connect ECONNREFUSED",
    );
  });
});

describe("BackendAPI.getRepositoryToken, and who opens the pull request", () => {
  beforeEach(() => {
    postMock.mockReset();
    RepositoryTokenRevocation.reset();
  });

  afterEach(() => {
    RepositoryTokenRevocation.reset();
  });

  test("a server that opens it says so, and the token is read as one that need not open it", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          token: "glpat-project-token-900",
          expiresAt: "2026-11-17T00:00:00.000Z",
          repositoryUrl: "https://gitlab.example.com/acme/checkout.git",
          organizationName: "acme",
          repositoryName: "checkout",
          serverOpensPullRequest: true,
          codeHost: {
            type: CodeRepositoryType.GitLab,
            hostUrl: "https://gitlab.example.com",
            apiUrl: "https://gitlab.example.com/api/v4",
            webUrl: "https://gitlab.example.com/acme/checkout",
            username: "oauth2",
            projectId: "4217",
            hasPullRequests: true,
          },
        },
        {},
      ),
    );

    const token: RepositoryToken = await new BackendAPI().getRepositoryToken(
      OPEN.codeRepositoryId,
      OPEN.taskId,
    );

    expect(token.opensPullRequestOnServer).toBe(true);
    expect(token.token).toBe("glpat-project-token-900");
    // GitLab's is OneUptime's to revoke: the Runner never remembers it for GitHub.
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
  });

  test("a GitHub token a server says it opens the pull request for is still revoked by the Runner at the run's end", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          token: "ghs_push_only",
          expiresAt: "2026-11-16T11:00:00.000Z",
          repositoryUrl: "https://github.com/acme/checkout.git",
          organizationName: "acme",
          repositoryName: "checkout",
          serverOpensPullRequest: true,
        },
        {},
      ),
    );

    const token: RepositoryToken = await new BackendAPI().getRepositoryToken(
      OPEN.codeRepositoryId,
      OPEN.taskId,
    );

    expect(token.opensPullRequestOnServer).toBe(true);
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(1);
  });

  test("an older server says nothing: the Runner opens the pull request itself", async () => {
    for (const said of [undefined, false, "true", 1]) {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            token: "ghs_with_pull_requests",
            expiresAt: "2026-11-16T11:00:00.000Z",
            repositoryUrl: "https://github.com/acme/checkout.git",
            organizationName: "acme",
            repositoryName: "checkout",
            ...(said === undefined
              ? {}
              : { serverOpensPullRequest: said as never }),
          },
          {},
        ),
      );

      const token: RepositoryToken = await new BackendAPI().getRepositoryToken(
        OPEN.codeRepositoryId,
        OPEN.taskId,
      );

      expect(token.opensPullRequestOnServer).toBeUndefined();
    }
  });

  test("every token request declares what this Runner can do", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          token: "ghs_x",
          expiresAt: "2026-11-16T11:00:00.000Z",
          repositoryUrl: "https://github.com/acme/checkout.git",
          organizationName: "acme",
          repositoryName: "checkout",
        },
        {},
      ),
    );

    await new BackendAPI().getRepositoryToken(
      OPEN.codeRepositoryId,
      OPEN.taskId,
    );

    expect(postCall().data["codeFixCapabilities"]).toEqual([
      "serverOpensPullRequests",
    ]);
  });
});
