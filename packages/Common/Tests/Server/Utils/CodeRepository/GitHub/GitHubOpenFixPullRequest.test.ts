import GitHubUtil, {
  GitHubOpenedFixPullRequest,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../../../Utils/API";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GitHubUtil.openFixPullRequest (issue #8916): a code fix's pull request,
 * opened by OneUptime itself rather than by the Runner that pushed its
 * branch - with a token of the installation for that one repository that
 * can open pull requests and nothing more, which never leaves the server.
 * GitHub answers 422 "A pull request already exists" when the Runner asks
 * again after an answer it did not get: the open one is the answer then.
 */

const ARGS: {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  baseBranchName: string;
  headBranchName: string;
  title: string;
  body: string;
} = {
  installationId: "installation-7",
  organizationName: "acme",
  repositoryName: "checkout",
  baseBranchName: "main",
  headBranchName: "oneuptime-fix-exception-1a2b3c4d",
  title: "fix: resolve TypeError in checkout",
  body: "## Exception Fix",
};

function created(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    {
      id: 4242,
      number: 7,
      title: "fix: resolve TypeError in checkout",
      html_url: "https://github.com/acme/checkout/pull/7",
      state: "open",
    },
    {},
  );
}

function alreadyExists(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    422,
    {
      message: "Validation Failed",
      errors: [
        {
          resource: "PullRequest",
          code: "custom",
          message:
            "A pull request already exists for acme:oneuptime-fix-exception-1a2b3c4d.",
        },
      ],
    },
    {},
  );
}

let mintSpy: jest.SpiedFunction<typeof GitHubUtil.getRepositoryAccessToken>;
let postSpy: jest.SpiedFunction<typeof API.post>;
let getSpy: jest.SpiedFunction<typeof API.get>;

beforeEach(() => {
  mintSpy = jest
    .spyOn(GitHubUtil, "getRepositoryAccessToken")
    .mockResolvedValue({ token: "ghs_server_only", expiresAt: new Date() });
  postSpy = jest.spyOn(API, "post");
  getSpy = jest.spyOn(API, "get");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GitHubUtil.openFixPullRequest", () => {
  test("mints a token for the one repository that opens pull requests and nothing else", async () => {
    postSpy.mockResolvedValue(created() as never);

    await GitHubUtil.openFixPullRequest(ARGS);

    expect(mintSpy).toHaveBeenCalledWith({
      installationId: "installation-7",
      organizationName: "acme",
      repositoryName: "checkout",
      permissions: { pull_requests: "write", metadata: "read" },
    });
  });

  test("opens it ready for review, from the branch into the base, and answers where it is", async () => {
    postSpy.mockResolvedValue(created() as never);

    const opened: GitHubOpenedFixPullRequest =
      await GitHubUtil.openFixPullRequest(ARGS);

    expect(opened).toEqual({
      id: 4242,
      number: 7,
      htmlUrl: "https://github.com/acme/checkout/pull/7",
      title: "fix: resolve TypeError in checkout",
      isNew: true,
    });

    const sent: { url: { toString: () => string }; data: JSONObject } = postSpy
      .mock.calls[0]![0] as unknown as {
      url: { toString: () => string };
      data: JSONObject;
    };

    expect(sent.url.toString()).toBe(
      "https://api.github.com/repos/acme/checkout/pulls",
    );
    expect(sent.data).toEqual({
      base: "main",
      head: "oneuptime-fix-exception-1a2b3c4d",
      title: "fix: resolve TypeError in checkout",
      body: "## Exception Fix",
      draft: false,
    });
  });

  test("asked again, GitHub's 'already exists' is answered with the open one", async () => {
    postSpy.mockResolvedValue(alreadyExists() as never);
    getSpy.mockResolvedValue(
      new HTTPResponse<JSONArray>(
        200,
        [
          {
            id: 4242,
            number: 7,
            title: "fix: resolve TypeError in checkout",
            html_url: "https://github.com/acme/checkout/pull/7",
          },
        ],
        {},
      ) as never,
    );

    const opened: GitHubOpenedFixPullRequest =
      await GitHubUtil.openFixPullRequest(ARGS);

    expect(opened.number).toBe(7);
    expect(opened.isNew).toBe(false);
    expect(postSpy).toHaveBeenCalledTimes(1);

    const asked: { params: JSONObject } = getSpy.mock
      .calls[0]![0] as unknown as {
      params: JSONObject;
    };

    expect(asked.params).toEqual({
      head: "acme:oneuptime-fix-exception-1a2b3c4d",
      base: "main",
      state: "open",
    });
  });

  test("any other refusal is thrown in GitHub's own words", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        422,
        {
          message: "Validation Failed",
          errors: [{ resource: "PullRequest", field: "head", code: "invalid" }],
        },
        {},
      ) as never,
    );

    await expect(GitHubUtil.openFixPullRequest(ARGS)).rejects.toThrow(
      "GitHub did not open the pull request. Validation Failed (head invalid)",
    );
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("an 'already exists' whose open one cannot be found is thrown, not guessed", async () => {
    postSpy.mockResolvedValue(alreadyExists() as never);
    getSpy.mockResolvedValue(new HTTPResponse<JSONArray>(200, [], {}) as never);

    await expect(GitHubUtil.openFixPullRequest(ARGS)).rejects.toThrow(
      "A pull request already exists",
    );
  });

  test("an answer that is not a pull request is refused", async () => {
    postSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(201, { id: 1 }, {}) as never,
    );

    await expect(GitHubUtil.openFixPullRequest(ARGS)).rejects.toThrow(
      "not a pull request",
    );
  });
});
