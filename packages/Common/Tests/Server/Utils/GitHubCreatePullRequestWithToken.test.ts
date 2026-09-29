/*
 * ---------------------------------------------------------------------------
 * GitHubUtil.createPullRequestWithToken — the App-authenticated create-PR
 * path used by the chat toolbox (open_code_pull_request) and by the
 * server-side fix triggers.
 *
 * The invariant pinned here: the pull request opens READY FOR REVIEW. A draft
 * reaches no reviewer, no CODEOWNERS rule and no review automation, so an
 * agent that drafted by default was burying its own output where nobody was
 * asked to look.
 *
 * This is a VISIBILITY change and not a safety one. The safety boundary lives
 * in the branch policy (never the default branch, never a protected branch,
 * asserted in CodeWriteTools.test.ts) and in the fact that nothing is ever
 * merged automatically. Ready for review still means unreviewed.
 *
 * The isDraft option and its 422 fallback survive for callers that still want
 * a draft — but the fallback must fire ONLY on a 422 that names drafts.
 * GitHub answers 422 for "a pull request already exists for this branch" too,
 * and blindly retrying that produced a second identical failure whose message
 * no longer described the real problem.
 * ---------------------------------------------------------------------------
 */

import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import PullRequest from "../../../Types/CodeRepository/PullRequest";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

const CREATE_ARGS: {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  baseBranchName: string;
  headBranchName: string;
  title: string;
  body: string;
} = {
  installationId: "installation-1",
  organizationName: "acme",
  repositoryName: "checkout",
  baseBranchName: "main",
  headBranchName: "oneuptime-ai/fix-charge",
  title: "fix: guard the undefined cart",
  body: "why this change",
};

// GitHub's create-PR 201 body, trimmed to the fields the mapper reads.
function prCreatedResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    {
      id: 4242,
      number: 7,
      title: "fix: guard the undefined cart",
      body: "why this change",
      url: "https://api.github.com/repos/acme/checkout/pulls/7",
      state: "open",
      created_at: "2026-08-11T10:00:00Z",
      updated_at: "2026-08-11T10:00:00Z",
      head: { ref: "oneuptime-ai/fix-charge" },
      base: { ref: "main" },
    },
    {},
  );
}

function errorResponse(
  statusCode: number,
  data: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, data, {});
}

function draftsNotSupported(): HTTPErrorResponse {
  return errorResponse(422, {
    message: "Draft pull requests are not supported in this repository.",
  });
}

function pullRequestAlreadyExists(): HTTPErrorResponse {
  return errorResponse(422, {
    message: "Validation Failed",
    errors: [
      {
        resource: "PullRequest",
        code: "custom",
        message:
          "A pull request already exists for acme:oneuptime-ai/fix-charge.",
      },
    ],
  });
}

let postSpy: jest.SpiedFunction<typeof API.post>;

// The body of the Nth API.post call, 1-indexed to match how retries read.
function requestBody(callNumber: number): JSONObject {
  const args: unknown = postSpy.mock.calls[callNumber - 1];

  if (!args) {
    throw new Error(`API.post was not called ${callNumber} time(s)`);
  }

  return (args as Array<{ data: JSONObject }>)[0]!.data;
}

describe("GitHubUtil.createPullRequestWithToken", () => {
  beforeEach(() => {
    jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({ token: "gh-token", expiresAt: new Date() });

    postSpy = jest.spyOn(API, "post");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the default", () => {
    test("opens the pull request READY FOR REVIEW, not as a draft", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken(CREATE_ARGS);

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(requestBody(1)["draft"]).toBe(false);
    });

    /*
     * Sent explicitly rather than omitted: GitHub's own default is non-draft
     * today, but leaving the field out makes the intent unassertable and
     * dependent on their default staying put.
     */
    test("sends draft explicitly rather than relying on GitHub's default", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken(CREATE_ARGS);

      expect(Object.keys(requestBody(1))).toContain("draft");
    });

    test("sends the branches, title and body alongside it", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken(CREATE_ARGS);

      expect(requestBody(1)).toEqual({
        base: "main",
        head: "oneuptime-ai/fix-charge",
        title: "fix: guard the undefined cart",
        body: "why this change",
        draft: false,
      });
    });

    test("returns the mapped pull request", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      const pullRequest: PullRequest =
        await GitHubUtil.createPullRequestWithToken(CREATE_ARGS);

      expect(pullRequest.pullRequestId).toBe(4242);
      expect(pullRequest.pullRequestNumber).toBe(7);
      expect(pullRequest.state).toBe(PullRequestState.Open);
      expect(pullRequest.repoOrganizationName).toBe("acme");
      expect(pullRequest.repoName).toBe("checkout");
    });

    test("requests a token scoped to pull requests and contents", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken(CREATE_ARGS);

      expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
        "installation-1",
        { permissions: { pull_requests: "write", contents: "write" } },
      );
    });
  });

  describe("the explicit option", () => {
    test("isDraft: false opens ready for review", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken({
        ...CREATE_ARGS,
        isDraft: false,
      });

      expect(requestBody(1)["draft"]).toBe(false);
    });

    // The option is kept, not removed — only the DEFAULT changed.
    test("isDraft: true still opens a draft", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken({
        ...CREATE_ARGS,
        isDraft: true,
      });

      expect(requestBody(1)["draft"]).toBe(true);
    });

    /*
     * A caller threading an optional through ("isDraft: settings.draft") must
     * land on ready-for-review. The old default read `!== false`, where
     * undefined meant draft.
     */
    test("isDraft: undefined is ready for review, not a draft", async () => {
      postSpy.mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken({
        ...CREATE_ARGS,
        isDraft: undefined,
      });

      expect(requestBody(1)["draft"]).toBe(false);
    });
  });

  describe("the draft fallback for repositories without the feature", () => {
    test("retries a rejected draft as ready for review", async () => {
      postSpy
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(prCreatedResponse());

      const pullRequest: PullRequest =
        await GitHubUtil.createPullRequestWithToken({
          ...CREATE_ARGS,
          isDraft: true,
        });

      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(requestBody(1)["draft"]).toBe(true);
      expect(requestBody(2)["draft"]).toBe(false);
      expect(pullRequest.pullRequestNumber).toBe(7);
    });

    test("keeps the title, body and branches identical on the retry", async () => {
      postSpy
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(prCreatedResponse());

      await GitHubUtil.createPullRequestWithToken({
        ...CREATE_ARGS,
        isDraft: true,
      });

      expect({ ...requestBody(2), draft: true }).toEqual(requestBody(1));
    });

    /*
     * The regression this guards: the retry used to fire on ANY 422. A
     * duplicate-PR 422 was retried, failed identically, and the caller was
     * handed the second error — same status, and no longer the real story.
     */
    test("does NOT retry a 422 that is not about drafts", async () => {
      postSpy.mockResolvedValueOnce(pullRequestAlreadyExists());

      await expect(
        GitHubUtil.createPullRequestWithToken({
          ...CREATE_ARGS,
          isDraft: true,
        }),
      ).rejects.toBeInstanceOf(HTTPErrorResponse);

      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * With the default now non-draft there is nothing to fall back FROM, so a
     * retry here would be a silent duplicate create attempt against GitHub.
     */
    test("never retries when the request was not a draft in the first place", async () => {
      postSpy.mockResolvedValueOnce(draftsNotSupported());

      await expect(
        GitHubUtil.createPullRequestWithToken(CREATE_ARGS),
      ).rejects.toBeInstanceOf(HTTPErrorResponse);

      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    test("does not retry a non-422 failure even when it mentions drafts", async () => {
      postSpy.mockResolvedValueOnce(
        errorResponse(403, { message: "Draft access forbidden" }),
      );

      await expect(
        GitHubUtil.createPullRequestWithToken({
          ...CREATE_ARGS,
          isDraft: true,
        }),
      ).rejects.toBeInstanceOf(HTTPErrorResponse);

      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    test("throws the second failure when the retry also fails", async () => {
      postSpy.mockResolvedValueOnce(draftsNotSupported()).mockResolvedValueOnce(
        errorResponse(422, {
          message: "Validation Failed",
          errors: [{ message: "head sha can't be blank" }],
        }),
      );

      await expect(
        GitHubUtil.createPullRequestWithToken({
          ...CREATE_ARGS,
          isDraft: true,
        }),
      ).rejects.toBeInstanceOf(HTTPErrorResponse);

      expect(postSpy).toHaveBeenCalledTimes(2);
    });
  });
});

/*
 * The predicate behind the fallback, tested directly: it decides whether a
 * failed create is "this repository has no drafts" or something else that
 * must not be retried.
 */
describe("GitHubUtil.isDraftNotSupportedError", () => {
  test("true when the 422 message names drafts", () => {
    expect(GitHubUtil.isDraftNotSupportedError(draftsNotSupported())).toBe(
      true,
    );
  });

  test("true when only the errors array names drafts", () => {
    expect(
      GitHubUtil.isDraftNotSupportedError(
        errorResponse(422, {
          message: "Validation Failed",
          errors: [{ message: "Draft pull requests are not supported." }],
        }),
      ),
    ).toBe(true);
  });

  test("case-insensitive — GitHub capitalizes 'Draft' at the start of a sentence", () => {
    expect(
      GitHubUtil.isDraftNotSupportedError(
        errorResponse(422, { message: "DRAFT PULL REQUESTS UNSUPPORTED" }),
      ),
    ).toBe(true);
  });

  test("false for a duplicate-pull-request 422", () => {
    expect(
      GitHubUtil.isDraftNotSupportedError(pullRequestAlreadyExists()),
    ).toBe(false);
  });

  test("false for an invalid-head 422", () => {
    expect(
      GitHubUtil.isDraftNotSupportedError(
        errorResponse(422, {
          message: "Validation Failed",
          errors: [{ field: "head", code: "invalid" }],
        }),
      ),
    ).toBe(false);
  });

  test("false for any non-422, even one that mentions drafts", () => {
    expect(
      GitHubUtil.isDraftNotSupportedError(
        errorResponse(403, { message: "Draft access forbidden" }),
      ),
    ).toBe(false);

    expect(
      GitHubUtil.isDraftNotSupportedError(
        errorResponse(500, { message: "Draft service unavailable" }),
      ),
    ).toBe(false);
  });

  test("false — not a crash — on a 422 with an empty body", () => {
    expect(GitHubUtil.isDraftNotSupportedError(errorResponse(422, {}))).toBe(
      false,
    );
  });
});
