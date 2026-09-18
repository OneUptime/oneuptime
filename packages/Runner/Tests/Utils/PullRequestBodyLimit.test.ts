/*
 * ---------------------------------------------------------------------------
 * The pull-request body length limit.
 *
 * GitHub rejects a body over 65536 characters outright — 422, "body is too
 * long". Everything that flows into the body is unbounded from
 * PullRequestCreator's point of view: the agent's own summary, the stack
 * trace, the tail of failing build output, and one repair summary per repair
 * pass. A verbose test suite is enough on its own.
 *
 * What makes this worth pinning is WHERE it fails. Creating the pull request
 * is the last step of the pipeline: the repository has been cloned, the agent
 * has run for up to thirty minutes, the verification loop has built and
 * tested, the commit is written and the branch is ALREADY PUSHED to the
 * customer's remote. A 422 there strands a real branch on their repository
 * with nothing pointing at it, and the run is reported as an error even
 * though the fix itself was fine.
 *
 * Truncating with a visible marker is strictly better: the reviewer still
 * gets the change, the summary and the verification verdict, and is told the
 * tail was cut.
 * ---------------------------------------------------------------------------
 */

import PullRequestCreator, {
  PullRequestOptions,
} from "../../Utils/PullRequestCreator";
import HTTPResponse from "Common/Types/API/HTTPResponse";
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

function prCreatedResponse(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    {
      id: 1,
      number: 7,
      url: "https://api.github.com/repos/acme/checkout/pulls/7",
      html_url: "https://github.com/acme/checkout/pull/7",
      state: "open",
      title: "fix: resolve TypeError",
    },
    {},
  );
}

function optionsWithBody(body: string): PullRequestOptions {
  return {
    token: "gh-token",
    organizationName: "acme",
    repositoryName: "checkout",
    baseBranch: "main",
    headBranch: "oneuptime-fix-abc12345",
    title: "fix: resolve TypeError",
    body,
  };
}

beforeEach(() => {
  postMock.mockReset();
});

describe("truncateBody", () => {
  test("a body inside the limit is passed through byte for byte", () => {
    const body: string = "## Exception Fix\n\nAll fine.";

    expect(PullRequestCreator.truncateBody(body)).toBe(body);
  });

  test("a body exactly at the limit is not touched", () => {
    const body: string = "x".repeat(PullRequestCreator.MAX_BODY_LENGTH);

    expect(PullRequestCreator.truncateBody(body)).toBe(body);
    expect(PullRequestCreator.truncateBody(body)).toHaveLength(
      PullRequestCreator.MAX_BODY_LENGTH,
    );
  });

  test("an oversized body comes back within the limit", () => {
    const body: string = "x".repeat(PullRequestCreator.MAX_BODY_LENGTH + 5000);

    const truncated: string = PullRequestCreator.truncateBody(body);

    expect(truncated.length).toBeLessThanOrEqual(
      PullRequestCreator.MAX_BODY_LENGTH,
    );
  });

  /*
   * Silent truncation would be its own bug: a reviewer reading a body that
   * stops mid-sentence has no way to tell whether the agent's explanation
   * ended there or was cut.
   */
  test("truncation is stated in the body, not silent", () => {
    const truncated: string = PullRequestCreator.truncateBody(
      "x".repeat(PullRequestCreator.MAX_BODY_LENGTH + 1),
    );

    expect(truncated).toContain("truncated");
    expect(truncated.endsWith("_")).toBe(true);
  });

  test("the beginning of the body — the summary a reviewer reads first — survives", () => {
    const head: string = "## Exception Fix\n\nGuarded the undefined access.\n";
    const truncated: string = PullRequestCreator.truncateBody(
      head + "y".repeat(PullRequestCreator.MAX_BODY_LENGTH),
    );

    expect(truncated.startsWith(head)).toBe(true);
  });
});

describe("createPullRequest", () => {
  test("sends a truncated body to GitHub rather than letting it 422", async () => {
    postMock.mockResolvedValue(prCreatedResponse());

    /*
     * The realistic shape: a normal body followed by a very long failing-test
     * tail, which is exactly what a chatty suite produces on a failed
     * verification.
     */
    const body: string =
      "## Exception Fix\n\nSummary here.\n\n" +
      "FAIL src/checkout.test.ts\n".repeat(5000);

    expect(body.length).toBeGreaterThan(PullRequestCreator.MAX_BODY_LENGTH);

    await new PullRequestCreator().createPullRequest(optionsWithBody(body));

    const sent: { data: { body: string } } = postMock.mock.calls[0]?.[0];

    expect(sent.data.body.length).toBeLessThanOrEqual(
      PullRequestCreator.MAX_BODY_LENGTH,
    );
    expect(sent.data.body).toContain("## Exception Fix");
    expect(sent.data.body).toContain("truncated");
  });

  test("a normal body reaches GitHub unchanged", async () => {
    postMock.mockResolvedValue(prCreatedResponse());

    const body: string = "## Exception Fix\n\nGuarded the undefined access.";

    await new PullRequestCreator().createPullRequest(optionsWithBody(body));

    expect(postMock.mock.calls[0]?.[0].data.body).toBe(body);
  });
});
