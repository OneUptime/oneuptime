/*
 * ---------------------------------------------------------------------------
 * The GitHub API surface of PullRequestCreator, and the text it puts in front
 * of a human reviewer.
 *
 * PullRequestCreator.test.ts owns the draft-vs-ready decision. This file owns
 * everything else, and two themes run through it:
 *
 *   1. WHAT THE OPERATOR IS TOLD WHEN GITHUB SAYS NO. GitHub's top-level
 *      `message` on a 422 is only ever "Validation Failed" — the part that
 *      says what actually went wrong ("A pull request already exists for…",
 *      an invalid `head`) lives in the `errors` array. Reporting only the
 *      top-level message turns every distinct failure into the same
 *      unactionable line, and this is the failure at the very END of the
 *      pipeline, after the branch has already been pushed.
 *   2. WHAT LEAKS INTO A PUBLIC PLACE. A pull request title is the most
 *      widely-syndicated surface an exception can reach — it goes into
 *      emails, Slack, the repository's activity feed. Exception MESSAGES
 *      routinely interpolate user data (emails, customer domains, ids), so
 *      the title is built from the exception TYPE and the service name and
 *      never from the message. That is a privacy boundary, not a style
 *      choice, which is why it is pinned here.
 *
 * Calls that decorate a pull request (labels, reviewers, comments) must never
 * fail the run: the pull request already exists by then, and losing the whole
 * fix because a label could not be applied would be absurd.
 * ---------------------------------------------------------------------------
 */

import PullRequestCreator, {
  PullRequestOptions,
  PullRequestResult,
} from "../../Utils/PullRequestCreator";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();
const getMock: jest.Mock = jest.fn();
const patchMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      get: (...args: Array<unknown>) => {
        return getMock(...args);
      },
      patch: (...args: Array<unknown>) => {
        return patchMock(...args);
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

const OPTIONS: PullRequestOptions = {
  token: "gh-token",
  organizationName: "acme",
  repositoryName: "checkout",
  baseBranch: "main",
  headBranch: "oneuptime-fix-abc12345",
  title: "fix: resolve TypeError in checkout",
  body: "## Exception Fix",
};

function prPayload(): JSONObject {
  return {
    id: 4242,
    number: 7,
    url: "https://api.github.com/repos/acme/checkout/pulls/7",
    html_url: "https://github.com/acme/checkout/pull/7",
    state: "open",
    title: "fix: resolve TypeError in checkout",
  };
}

beforeEach(() => {
  postMock.mockReset();
  getMock.mockReset();
  patchMock.mockReset();
});

describe("createPullRequest", () => {
  test("maps GitHub's response onto the result the pipeline records", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(201, prPayload(), {}),
    );

    const result: PullRequestResult =
      await new PullRequestCreator().createPullRequest(OPTIONS);

    expect(result).toEqual({
      id: 4242,
      number: 7,
      url: "https://api.github.com/repos/acme/checkout/pulls/7",
      htmlUrl: "https://github.com/acme/checkout/pull/7",
      state: "open",
      title: "fix: resolve TypeError in checkout",
    });
  });

  test("posts to the right repository with the head and base it was given", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(201, prPayload(), {}),
    );

    await new PullRequestCreator().createPullRequest(OPTIONS);

    const call: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls[0]?.[0];

    expect(call.url.toString()).toBe(
      "https://api.github.com/repos/acme/checkout/pulls",
    );
    expect(call.data["head"]).toBe("oneuptime-fix-abc12345");
    expect(call.data["base"]).toBe("main");
  });

  test("authenticates with a bearer token and pins the API version", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(201, prPayload(), {}),
    );

    await new PullRequestCreator().createPullRequest(OPTIONS);

    const headers: Record<string, string> = postMock.mock.calls[0]?.[0].headers;

    expect(headers["Authorization"]).toBe("Bearer gh-token");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["Accept"]).toBe("application/vnd.github+json");
  });

  /*
   * "Validation Failed" on its own is the same string for every distinct
   * cause. Whoever reads this run's status needs the sentence inside
   * `errors` — that is the one that says what to do.
   */
  test("a 422 reports the detail from the errors array, not just 'Validation Failed'", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        422,
        {
          message: "Validation Failed",
          errors: [
            {
              resource: "PullRequest",
              code: "custom",
              message:
                "A pull request already exists for acme:oneuptime-fix-abc12345.",
            },
          ],
        },
        {},
      ),
    );

    await expect(
      new PullRequestCreator().createPullRequest(OPTIONS),
    ).rejects.toThrow("A pull request already exists");
  });

  test("several errors are folded into one line", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        422,
        {
          message: "Validation Failed",
          errors: [
            { message: "head is invalid" },
            { field: "base", code: "invalid" },
          ],
        },
        {},
      ),
    );

    await expect(
      new PullRequestCreator().createPullRequest(OPTIONS),
    ).rejects.toThrow(/head is invalid; base invalid/);
  });

  test("an error body with no detail at all still names the status code", async () => {
    postMock.mockResolvedValue(new HTTPErrorResponse(500, {}, {}));

    await expect(
      new PullRequestCreator().createPullRequest(OPTIONS),
    ).rejects.toThrow(/500/);
  });

  test("a permissions failure surfaces GitHub's own wording", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { message: "Resource not accessible by integration" },
        {},
      ),
    );

    await expect(
      new PullRequestCreator().createPullRequest(OPTIONS),
    ).rejects.toThrow("Resource not accessible by integration");
  });

  /*
   * A 422 that does NOT name drafts must not trigger the ready-for-review
   * retry: retrying hands the caller a second, misleading error in place of
   * the real one, and doubles the API calls against a rate limit.
   */
  test("a non-draft 422 is not retried", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(
        422,
        {
          message: "Validation Failed",
          errors: [{ message: "A pull request already exists." }],
        },
        {},
      ),
    );

    await expect(
      new PullRequestCreator().createPullRequest({ ...OPTIONS, draft: true }),
    ).rejects.toThrow("already exists");

    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("findExistingPullRequest", () => {
  test("asks GitHub for the open PR on this head and base", async () => {
    getMock.mockResolvedValue(new HTTPResponse<JSONArray>(200, [], {}));

    await new PullRequestCreator().findExistingPullRequest(
      "gh-token",
      "acme",
      "checkout",
      "oneuptime-fix-abc12345",
      "main",
    );

    const params: Record<string, string> = getMock.mock.calls[0]?.[0].params;

    // `owner:branch` is the form GitHub's head filter requires.
    expect(params["head"]).toBe("acme:oneuptime-fix-abc12345");
    expect(params["base"]).toBe("main");
    expect(params["state"]).toBe("open");
  });

  test("returns the first match", async () => {
    getMock.mockResolvedValue(
      new HTTPResponse<JSONArray>(200, [prPayload()], {}),
    );

    const found: PullRequestResult | null =
      await new PullRequestCreator().findExistingPullRequest(
        "gh-token",
        "acme",
        "checkout",
        "oneuptime-fix-abc12345",
        "main",
      );

    expect(found?.number).toBe(7);
  });

  test("no match is null, not an error", async () => {
    getMock.mockResolvedValue(new HTTPResponse<JSONArray>(200, [], {}));

    await expect(
      new PullRequestCreator().findExistingPullRequest(
        "gh-token",
        "acme",
        "checkout",
        "branch",
        "main",
      ),
    ).resolves.toBeNull();
  });

  /*
   * A lookup that fails must not be mistaken for "there is no existing PR" by
   * a caller that then creates a duplicate — but it also must not throw. Null
   * with the failure logged is the honest middle.
   */
  test("a failed lookup is null rather than a throw", async () => {
    getMock.mockResolvedValue(new HTTPErrorResponse(500, {}, {}));

    await expect(
      new PullRequestCreator().findExistingPullRequest(
        "gh-token",
        "acme",
        "checkout",
        "branch",
        "main",
      ),
    ).resolves.toBeNull();
  });
});

describe("getPullRequest and updatePullRequest", () => {
  test("getPullRequest maps a found pull request", async () => {
    getMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, prPayload(), {}),
    );

    const found: PullRequestResult | null =
      await new PullRequestCreator().getPullRequest(
        "gh-token",
        "acme",
        "checkout",
        7,
      );

    expect(found?.htmlUrl).toBe("https://github.com/acme/checkout/pull/7");
  });

  test("getPullRequest returns null for a pull request that is gone", async () => {
    getMock.mockResolvedValue(new HTTPErrorResponse(404, {}, {}));

    await expect(
      new PullRequestCreator().getPullRequest(
        "gh-token",
        "acme",
        "checkout",
        7,
      ),
    ).resolves.toBeNull();
  });

  test("updatePullRequest sends only the fields it was given", async () => {
    patchMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, prPayload(), {}),
    );

    await new PullRequestCreator().updatePullRequest(
      "gh-token",
      "acme",
      "checkout",
      7,
      { body: "updated body" },
    );

    expect(patchMock.mock.calls[0]?.[0].data).toEqual({
      body: "updated body",
    });
  });

  test("a failed update throws with GitHub's detail", async () => {
    patchMock.mockResolvedValue(
      new HTTPErrorResponse(422, { message: "Validation Failed" }, {}),
    );

    await expect(
      new PullRequestCreator().updatePullRequest(
        "gh-token",
        "acme",
        "checkout",
        7,
        { state: "closed" },
      ),
    ).rejects.toThrow("Failed to update pull request");
  });
});

describe("decorating a pull request never fails the run", () => {
  /*
   * By the time these run the pull request EXISTS. Throwing here would
   * propagate up through processRepository, be collected as a repository
   * failure, and report a run that actually produced a pull request as an
   * error — losing the URL in the process.
   */
  test.each([
    [
      "labels",
      async (): Promise<void> => {
        await new PullRequestCreator().addLabels(
          "gh-token",
          "acme",
          "checkout",
          7,
          ["ai-fix"],
        );
      },
    ],
    [
      "reviewers",
      async (): Promise<void> => {
        await new PullRequestCreator().requestReviewers(
          "gh-token",
          "acme",
          "checkout",
          7,
          ["octocat"],
        );
      },
    ],
    [
      "a comment",
      async (): Promise<void> => {
        await new PullRequestCreator().addComment(
          "gh-token",
          "acme",
          "checkout",
          7,
          "hello",
        );
      },
    ],
  ])(
    "%s failing is logged, not thrown",
    async (_label: string, call: () => Promise<void>) => {
      postMock.mockResolvedValue(new HTTPErrorResponse(403, {}, {}));

      await expect(call()).resolves.toBeUndefined();
    },
  );

  test("team reviewers are only sent when there are some", async () => {
    postMock.mockResolvedValue(new HTTPResponse<JSONObject>(201, {}, {}));

    await new PullRequestCreator().requestReviewers(
      "gh-token",
      "acme",
      "checkout",
      7,
      ["octocat"],
    );

    expect(postMock.mock.calls[0]?.[0].data).toEqual({
      reviewers: ["octocat"],
    });

    postMock.mockClear();

    await new PullRequestCreator().requestReviewers(
      "gh-token",
      "acme",
      "checkout",
      7,
      ["octocat"],
      ["platform"],
    );

    expect(postMock.mock.calls[0]?.[0].data["team_reviewers"]).toEqual([
      "platform",
    ]);
  });
});

describe("generatePRTitle", () => {
  test("is built from the exception type and the service", () => {
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: "TypeError",
        serviceName: "checkout",
      }),
    ).toBe("fix: resolve TypeError in checkout");
  });

  /*
   * THE privacy boundary. A pull request title is syndicated into emails,
   * Slack and the repository's public activity feed. Exception messages
   * routinely interpolate user data — an email address, a customer domain, a
   * record id — so the message must never reach the title.
   */
  test("the exception MESSAGE is never part of the title", () => {
    const title: string = PullRequestCreator.generatePRTitle({
      exceptionType: "ValidationError",
      serviceName: "billing",
    });

    expect(title).not.toContain("@");
    expect(title).toBe("fix: resolve ValidationError in billing");
  });

  test("a missing service name degrades to type only", () => {
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: "TypeError",
        serviceName: "",
      }),
    ).toBe("fix: resolve TypeError");
  });

  // Legacy rows can carry a NULL type despite the string typing.
  test("a missing exception type degrades to the word 'exception'", () => {
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: "",
        serviceName: "checkout",
      }),
    ).toBe("fix: resolve exception in checkout");
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: undefined as unknown as string,
        serviceName: undefined as unknown as string,
      }),
    ).toBe("fix: resolve exception");
  });

  test("newlines and runs of whitespace are collapsed to one line", () => {
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: "Type\n\tError",
        serviceName: "check  out",
      }),
    ).toBe("fix: resolve Type Error in check out");
  });

  test("a very long title is truncated with an ellipsis", () => {
    const title: string = PullRequestCreator.generatePRTitle({
      exceptionType: "A".repeat(100),
      serviceName: "checkout",
    });

    expect(title).toHaveLength(70);
    expect(title.endsWith("...")).toBe(true);
  });

  test("the recipe's own prefix is used when given", () => {
    expect(
      PullRequestCreator.generatePRTitle({
        exceptionType: "TypeError",
        serviceName: "checkout",
        prefix: "test: cover",
      }),
    ).toBe("test: cover TypeError in checkout");
  });
});

describe("generatePRBody", () => {
  test("states plainly that the change is AI-authored and unreviewed", () => {
    const body: string = PullRequestCreator.generatePRBody({
      exceptionMessage: "cannot read property 'id' of undefined",
      exceptionType: "TypeError",
      stackTrace: "at Checkout.process (src/checkout.ts:42:11)",
      serviceName: "checkout",
      summary: "Guarded the undefined access.",
    });

    expect(body).toContain("Review before merging");
    expect(body).toContain("AI-authored");
    expect(body).toContain("Nothing is merged automatically");
  });

  test("carries the agent's summary and the stack trace a reviewer needs", () => {
    const body: string = PullRequestCreator.generatePRBody({
      exceptionMessage: "boom",
      exceptionType: "TypeError",
      stackTrace: "at Checkout.process (src/checkout.ts:42:11)",
      serviceName: "checkout",
      summary: "Guarded the undefined access.",
    });

    expect(body).toContain("Guarded the undefined access.");
    expect(body).toContain("src/checkout.ts:42:11");
  });

  /*
   * A stack trace can be megabytes. It is bounded here as well as at the
   * whole-body limit, so one enormous trace cannot crowd out the summary and
   * the verification verdict that follow it.
   */
  test("a huge stack trace is truncated and says so", () => {
    const body: string = PullRequestCreator.generatePRBody({
      exceptionMessage: "boom",
      exceptionType: "TypeError",
      stackTrace: "at Frame (src/x.ts:1:1)\n".repeat(5000),
      serviceName: "checkout",
      summary: "Fixed.",
    });

    expect(body).toContain("...(truncated)");
    // The summary still made it in, after the trace.
    expect(body).toContain("Fixed.");
  });
});
