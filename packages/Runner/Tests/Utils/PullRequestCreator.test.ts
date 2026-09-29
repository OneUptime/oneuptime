/*
 * ---------------------------------------------------------------------------
 * Unit tests for PullRequestCreator.createPullRequest — specifically the
 * DRAFT vs READY-FOR-REVIEW decision that reaches GitHub's create-PR API.
 *
 * The invariant these tests pin: an AI fix pull request opens READY FOR
 * REVIEW. A draft is invisible to reviewers, to CODEOWNERS and to review
 * automation, so a draft-by-default agent quietly buried its own output.
 *
 * That is a *visibility* change, not a safety change, and half of these tests
 * exist to keep the two from being confused. The safety boundary is
 * elsewhere: the agent only ever writes to a fresh branch, and nothing is
 * merged automatically. Nothing here should be read as "the PR is approved".
 *
 * The draft option itself is kept, and so is its 422 fallback, because a
 * caller may still ask for one — but the fallback must fire ONLY for a 422
 * that actually names drafts. GitHub also answers 422 for "a pull request
 * already exists for this branch" and for an invalid head, and retrying those
 * hands the caller a second, misleading error in place of the real one.
 * ---------------------------------------------------------------------------
 */

import PullRequestCreator, {
  PullRequestOptions,
  PullRequestResult,
} from "../../Utils/PullRequestCreator";
import TaskLogger from "../../Utils/TaskLogger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

/*
 * jest hoists these above the imports, so the factories run before
 * PullRequestCreator is loaded. postMock is only dereferenced inside the
 * arrow — reading it in the factory body itself would hit the TDZ.
 */
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

// Silence the module logger; the assertions read the TaskLogger stub instead.
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

const BASE_OPTIONS: PullRequestOptions = {
  token: "gh-token",
  organizationName: "acme",
  repositoryName: "checkout",
  baseBranch: "main",
  headBranch: "oneuptime-ai/fix-checkout",
  title: "fix: resolve TypeError in checkout",
  body: "## Exception Fix",
};

// GitHub's create-PR 201 body, trimmed to the fields we map back.
function prCreatedResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    {
      id: 4242,
      number: 7,
      url: "https://api.github.com/repos/acme/checkout/pulls/7",
      html_url: "https://github.com/acme/checkout/pull/7",
      state: "open",
      title: "fix: resolve TypeError in checkout",
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

// GitHub's refusal on a repository whose plan has no drafts.
function draftsNotSupported(): HTTPErrorResponse {
  return errorResponse(422, {
    message: "Draft pull requests are not supported in this repository.",
  });
}

// The OTHER common 422 — same status, completely different cause.
function pullRequestAlreadyExists(): HTTPErrorResponse {
  return errorResponse(422, {
    message: "Validation Failed",
    errors: [
      {
        resource: "PullRequest",
        code: "custom",
        message:
          "A pull request already exists for acme:oneuptime-ai/fix-checkout.",
      },
    ],
  });
}

interface PostCall {
  url: URL;
  data: JSONObject;
  headers: Headers;
}

// The Nth API.post call, 1-indexed to read the way the retries are described.
function postCall(callNumber: number): PostCall {
  const args: Array<PostCall> | undefined = postMock.mock.calls[
    callNumber - 1
  ] as Array<PostCall> | undefined;

  if (!args || !args[0]) {
    throw new Error(`API.post was not called ${callNumber} time(s)`);
  }

  return args[0];
}

function requestBody(callNumber: number): JSONObject {
  return postCall(callNumber).data;
}

interface LoggerStub {
  logger: TaskLogger;
  lines: Array<string>;
}

/*
 * A TaskLogger-shaped stub. The real one batches over the network on a timer;
 * only info() is on the path under test.
 */
function loggerStub(): LoggerStub {
  const lines: Array<string> = [];

  const logger: TaskLogger = {
    info: async (message: string): Promise<void> => {
      lines.push(message);
    },
  } as unknown as TaskLogger;

  return { logger, lines };
}

describe("PullRequestCreator.createPullRequest — draft vs ready for review", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  describe("the default", () => {
    test("opens the pull request READY FOR REVIEW, not as a draft", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest(BASE_OPTIONS);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(requestBody(1)["draft"]).toBe(false);
    });

    /*
     * `draft` is sent explicitly rather than omitted. GitHub's own default
     * happens to be non-draft today, but leaving the field out would make the
     * intent unassertable here and dependent on their default staying put.
     */
    test("sends draft explicitly rather than relying on GitHub's default", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest(BASE_OPTIONS);

      expect(Object.keys(requestBody(1))).toContain("draft");
    });

    test("sends the branches and content GitHub needs alongside it", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest(BASE_OPTIONS);

      expect(requestBody(1)).toEqual({
        title: "fix: resolve TypeError in checkout",
        body: "## Exception Fix",
        head: "oneuptime-ai/fix-checkout",
        base: "main",
        draft: false,
      });
    });

    test("posts to the repository's pulls endpoint with an authorized header", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest(BASE_OPTIONS);

      expect(postCall(1).url.toString()).toBe(
        "https://api.github.com/repos/acme/checkout/pulls",
      );
      expect(postCall(1).headers["Authorization"]).toBe("Bearer gh-token");
    });

    test("says ready-for-review — and never 'draft' — in the task log", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      const stub: LoggerStub = loggerStub();

      await new PullRequestCreator(stub.logger).createPullRequest(BASE_OPTIONS);

      const creating: string = stub.lines[0] || "";

      expect(creating).toContain("ready-for-review pull request");
      expect(creating).not.toContain("draft");
    });

    test("maps every field of the created pull request back to the caller", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      const result: PullRequestResult =
        await new PullRequestCreator().createPullRequest(BASE_OPTIONS);

      expect(result).toEqual({
        id: 4242,
        number: 7,
        url: "https://api.github.com/repos/acme/checkout/pulls/7",
        htmlUrl: "https://github.com/acme/checkout/pull/7",
        state: "open",
        title: "fix: resolve TypeError in checkout",
      });
    });
  });

  describe("the explicit option", () => {
    test("draft: false opens ready for review", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest({
        ...BASE_OPTIONS,
        draft: false,
      });

      expect(requestBody(1)["draft"]).toBe(false);
    });

    /*
     * The option is kept, not removed — a caller can still opt into a draft.
     * Only the DEFAULT changed.
     */
    test("draft: true still opens a draft", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest({
        ...BASE_OPTIONS,
        draft: true,
      });

      expect(requestBody(1)["draft"]).toBe(true);
    });

    /*
     * A caller threading an optional through ("draft: config.draft") must land
     * on ready-for-review, not on a draft. The old default read `!== false`,
     * where undefined meant draft.
     */
    test("an explicitly undefined draft is ready for review, not a draft", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      const options: PullRequestOptions = { ...BASE_OPTIONS };
      (options as { draft?: boolean | undefined }).draft = undefined;

      await new PullRequestCreator().createPullRequest(options);

      expect(requestBody(1)["draft"]).toBe(false);
    });

    test("draft: true says 'draft' in the task log", async () => {
      postMock.mockResolvedValueOnce(prCreatedResponse());

      const stub: LoggerStub = loggerStub();

      await new PullRequestCreator(stub.logger).createPullRequest({
        ...BASE_OPTIONS,
        draft: true,
      });

      expect(stub.lines[0]).toContain("draft pull request");
    });
  });

  describe("the draft fallback for repositories without the feature", () => {
    test("retries a rejected draft as ready for review", async () => {
      postMock
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(prCreatedResponse());

      const result: PullRequestResult =
        await new PullRequestCreator().createPullRequest({
          ...BASE_OPTIONS,
          draft: true,
        });

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(requestBody(1)["draft"]).toBe(true);
      expect(requestBody(2)["draft"]).toBe(false);
      expect(result.number).toBe(7);
    });

    test("keeps the title, body and branches identical on the retry", async () => {
      postMock
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest({
        ...BASE_OPTIONS,
        draft: true,
      });

      expect({ ...requestBody(2), draft: true }).toEqual(requestBody(1));
    });

    test("tells the reviewer, in the task log, that the PR is still unreviewed", async () => {
      postMock
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(prCreatedResponse());

      const stub: LoggerStub = loggerStub();

      await new PullRequestCreator(stub.logger).createPullRequest({
        ...BASE_OPTIONS,
        draft: true,
      });

      expect(stub.lines.join("\n")).toContain("treat it as unreviewed");
    });

    test("finds the word 'draft' in the errors array, not only in the message", async () => {
      postMock
        .mockResolvedValueOnce(
          errorResponse(422, {
            message: "Validation Failed",
            errors: [
              {
                resource: "PullRequest",
                code: "custom",
                message: "Draft pull requests are not supported.",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(prCreatedResponse());

      await new PullRequestCreator().createPullRequest({
        ...BASE_OPTIONS,
        draft: true,
      });

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(requestBody(2)["draft"]).toBe(false);
    });

    /*
     * The whole point of the draft-specific 422 check. Retrying a
     * "pull request already exists" 422 fails identically and replaces the
     * real message with a second copy of a misleading one.
     */
    test("does NOT retry a 422 that is not about drafts", async () => {
      postMock.mockResolvedValueOnce(pullRequestAlreadyExists());

      await expect(
        new PullRequestCreator().createPullRequest({
          ...BASE_OPTIONS,
          draft: true,
        }),
      ).rejects.toThrow(/already exists/);

      expect(postMock).toHaveBeenCalledTimes(1);
    });

    /*
     * With the default now non-draft there is nothing to fall back FROM, so a
     * retry here would be a silent duplicate create attempt.
     */
    test("never retries when the request was not a draft in the first place", async () => {
      postMock.mockResolvedValueOnce(draftsNotSupported());

      await expect(
        new PullRequestCreator().createPullRequest(BASE_OPTIONS),
      ).rejects.toThrow(/Failed to create pull request/);

      expect(postMock).toHaveBeenCalledTimes(1);
    });

    test("does not retry a non-422 failure even when it mentions drafts", async () => {
      postMock.mockResolvedValueOnce(
        errorResponse(403, { message: "Draft access forbidden" }),
      );

      await expect(
        new PullRequestCreator().createPullRequest({
          ...BASE_OPTIONS,
          draft: true,
        }),
      ).rejects.toThrow(/Failed to create pull request/);

      expect(postMock).toHaveBeenCalledTimes(1);
    });

    test("surfaces the second failure when the retry also fails", async () => {
      postMock
        .mockResolvedValueOnce(draftsNotSupported())
        .mockResolvedValueOnce(
          errorResponse(422, {
            message: "Validation Failed",
            errors: [{ message: "head sha can't be blank" }],
          }),
        );

      await expect(
        new PullRequestCreator().createPullRequest({
          ...BASE_OPTIONS,
          draft: true,
        }),
      ).rejects.toThrow(/head sha can't be blank/);

      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("failures unrelated to drafts", () => {
    test("throws with GitHub's field detail when the branch is invalid", async () => {
      postMock.mockResolvedValueOnce(
        errorResponse(422, {
          message: "Validation Failed",
          errors: [{ field: "head", code: "invalid" }],
        }),
      );

      await expect(
        new PullRequestCreator().createPullRequest(BASE_OPTIONS),
      ).rejects.toThrow(/head invalid/);
    });

    test("throws on a permissions failure without a second attempt", async () => {
      postMock.mockResolvedValueOnce(
        errorResponse(403, {
          message: "Resource not accessible by integration",
        }),
      );

      await expect(
        new PullRequestCreator().createPullRequest(BASE_OPTIONS),
      ).rejects.toThrow(/Resource not accessible by integration/);

      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * The PR body is the only place a human reviewer reads the agent's own
 * account of what it did. It used to end with "mark the pull request ready
 * for review", which is now a stale instruction: the PR already is.
 *
 * What must NOT drop out of it is the part that was never about the draft
 * flag — that a human reviews, and that nothing merges by itself.
 */
describe("PullRequestCreator.generatePRBody", () => {
  const body: string = PullRequestCreator.generatePRBody({
    exceptionMessage: "Cannot read property 'id' of undefined",
    exceptionType: "TypeError",
    stackTrace: "at Checkout.process (src/checkout.ts:42:11)",
    serviceName: "checkout",
    summary: "Guard the undefined cart before reading its id.",
  });

  test("no longer tells the reviewer to mark the pull request ready", () => {
    expect(body.toLowerCase()).not.toContain("mark the pull request ready");
  });

  test("no longer claims the pull request is a draft", () => {
    expect(body.toLowerCase()).not.toContain("draft");
  });

  test("still asks for review before merging", () => {
    expect(body).toContain("Review before merging");
  });

  test("still states that nothing is merged automatically", () => {
    expect(body).toContain("Nothing is merged automatically");
  });

  test("still says the fix is AI-authored", () => {
    expect(body).toContain("AI-authored");
  });

  test("still carries the exception evidence the reviewer needs", () => {
    expect(body).toContain("TypeError");
    expect(body).toContain("checkout");
    expect(body).toContain("Guard the undefined cart before reading its id.");
  });
});
