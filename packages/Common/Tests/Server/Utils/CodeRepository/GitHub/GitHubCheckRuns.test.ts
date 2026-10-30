import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import GitHubCheckRuns, {
  CHECK_RUN_SUMMARY_MAX_LENGTH,
  CHECKS_PERMISSION_MISSING_SECONDS,
  GitHubCheckConclusion,
  GitHubCheckRunContent,
  GitHubCheckRunWritten,
  holdTo,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCheckRuns";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import API from "../../../../../Utils/API";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * A production review's GitHub check run: one per head commit, written
 * when the review is done and edited in place while the head is the same;
 * written anew for a new head, or when the one it wrote is gone. It needs
 * the App's Checks: Read and write - an installation that has not accepted
 * it gets no check, and that is kept an hour so GitHub is not asked for a
 * token it refuses on every review. The token reaches the one repository.
 */

const HEAD: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";
const OLD_HEAD: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const REVIEW_URL: string =
  "https://oneuptime.com/dashboard/3ae4c1a8-7a8b-4c4e-9a52-1d2d5e0f6a11/code/tasks/7c1d2e3f-0000-4000-8000-000000000001";

const CONTENT: GitHubCheckRunContent = {
  name: "OneUptime production review",
  headSha: HEAD,
  conclusion: GitHubCheckConclusion.Neutral,
  title: "Something in production is worth a look",
  summary: "### Production review by OneUptime\n\nIt throws.",
  detailsUrl: REVIEW_URL,
  externalId: "7c1d2e3f-0000-4000-8000-000000000001",
};

let kept: Map<string, string>;
let mint: SpyInstance<typeof GitHubUtil.getRepositoryAccessToken>;
/*
 * API.post and API.patch are generic: a spy on one is typed as jest.spyOn
 * types it, with its type parameter at its constraint.
 */
let post: SpyInstance<
  (...args: Parameters<typeof API.post>) => ReturnType<typeof API.post>
>;
let patch: SpyInstance<
  (...args: Parameters<typeof API.patch>) => ReturnType<typeof API.patch>
>;

function written(id: number): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    {
      id,
      html_url: `https://github.com/acme/checkout/runs/${id}`,
    },
    {},
  );
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-30T10:00:00.000Z") });

  kept = new Map();

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return kept.get(`${namespace}:${key}`) || null;
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        kept.set(`${namespace}:${key}`, value);
      },
    );

  mint = jest
    .spyOn(GitHubUtil, "getRepositoryAccessToken")
    .mockResolvedValue({ token: "ghs_checks", expiresAt: new Date() });
  post = jest.spyOn(API, "post").mockResolvedValue(written(301) as never);
  patch = jest.spyOn(API, "patch").mockResolvedValue(written(300) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function write(
  change: {
    checkRunId?: number;
    checkRunHeadSha?: string;
    content?: Partial<GitHubCheckRunContent>;
  } = {},
): Promise<GitHubCheckRunWritten | null> {
  return await GitHubCheckRuns.write({
    installationId: "4242",
    organizationName: "acme",
    repositoryName: "checkout",
    checkRunId: change.checkRunId,
    checkRunHeadSha: change.checkRunHeadSha,
    content: { ...CONTENT, ...(change.content || {}) },
  });
}

describe("GitHubCheckRuns.write", () => {
  test("writes the check on the head, done, with a token for the one repository that may write checks", async () => {
    expect(await write()).toEqual({
      checkRunId: 301,
      htmlUrl: "https://github.com/acme/checkout/runs/301",
    });

    expect(mint).toHaveBeenCalledWith({
      installationId: "4242",
      organizationName: "acme",
      repositoryName: "checkout",
      permissions: { checks: "write", metadata: "read" },
    });

    const call: {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    } = post.mock.calls[0]![0] as never;

    expect(call.url.toString()).toBe(
      "https://api.github.com/repos/acme/checkout/check-runs",
    );
    expect(call.data).toEqual({
      name: "OneUptime production review",
      status: "completed",
      conclusion: "neutral",
      completed_at: "2026-10-30T10:00:00.000Z",
      details_url: REVIEW_URL,
      external_id: "7c1d2e3f-0000-4000-8000-000000000001",
      output: {
        title: "Something in production is worth a look",
        summary: "### Production review by OneUptime\n\nIt throws.",
      },
      head_sha: HEAD,
    });
    expect(call.headers["Authorization"]).toBe("Bearer ghs_checks");
    expect(patch).not.toHaveBeenCalled();
  });

  test("the check of the same head is edited in place, never written twice", async () => {
    expect(await write({ checkRunId: 300, checkRunHeadSha: HEAD })).toEqual({
      checkRunId: 300,
      htmlUrl: "https://github.com/acme/checkout/runs/300",
    });

    const call: { url: { toString: () => string }; data: JSONObject } = patch
      .mock.calls[0]![0] as never;

    expect(call.url.toString()).toBe(
      "https://api.github.com/repos/acme/checkout/check-runs/300",
    );
    // An edit keeps its head: GitHub takes none on PATCH.
    expect(call.data["head_sha"]).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  test("a new head gets a check of its own: GitHub keeps checks per commit", async () => {
    await write({ checkRunId: 300, checkRunHeadSha: OLD_HEAD });

    expect(patch).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("a check that is gone (404) is written anew; any other refusal of the edit is thrown", async () => {
    patch.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
    );

    expect(
      (await write({ checkRunId: 300, checkRunHeadSha: HEAD }))?.checkRunId,
    ).toBe(301);

    patch.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "boom" }, {}) as never,
    );

    await expect(
      write({ checkRunId: 300, checkRunHeadSha: HEAD }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("an installation that does not grant Checks: write gets no check - and GitHub is not asked again for an hour", async () => {
    mint.mockRejectedValue(
      new HTTPErrorResponse(
        422,
        {
          message:
            "The permissions requested are not granted to this installation.",
        },
        {},
      ),
    );

    expect(await write()).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(kept.get("github-checks-write-missing:4242")).toBe("1");
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "github-checks-write-missing",
      "4242",
      "1",
      { expiresInSeconds: CHECKS_PERMISSION_MISSING_SECONDS },
    );

    mint.mockClear();

    expect(await write()).toBeNull();
    expect(mint).not.toHaveBeenCalled();
  });

  test("a 403 for the token is the same as a missing permission; another installation is asked as usual", async () => {
    mint.mockRejectedValueOnce(
      new HTTPErrorResponse(403, { message: "Forbidden" }, {}),
    );

    expect(await write()).toBeNull();

    expect(
      await GitHubCheckRuns.write({
        installationId: "5151",
        organizationName: "acme",
        repositoryName: "checkout",
        checkRunId: undefined,
        checkRunHeadSha: undefined,
        content: CONTENT,
      }),
    ).not.toBeNull();
  });

  test("GitHub failing to mint a token for another reason is thrown, and nothing is kept", async () => {
    mint.mockRejectedValue(new HTTPErrorResponse(500, { message: "x" }, {}));

    await expect(write()).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(kept.size).toBe(0);
  });

  test("a cache that is down asks GitHub, as if nothing were kept", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Valkey is down"));

    expect(await write()).not.toBeNull();
  });

  test("a written check GitHub says no id of is an error", async () => {
    post.mockResolvedValue(new HTTPResponse(201, { id: "x" }, {}) as never);

    await expect(write()).rejects.toThrow(
      "GitHub did not say which check run it wrote.",
    );
  });
});

describe("GitHubCheckRuns.buildBody: what GitHub is sent", () => {
  test("a summary longer than GitHub takes is cut on a whole character, marked", () => {
    const body: JSONObject = GitHubCheckRuns.buildBody({
      ...CONTENT,
      summary: "é".repeat(CHECK_RUN_SUMMARY_MAX_LENGTH + 10),
    });
    const summary: string = (body["output"] as JSONObject)["summary"] as string;

    expect(Array.from(summary)).toHaveLength(CHECK_RUN_SUMMARY_MAX_LENGTH);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("holdTo keeps what fits, and an emoji whole", () => {
    expect(holdTo("short", 10)).toBe("short");
    expect(holdTo("🔭🔭🔭", 2)).toBe("🔭…");
    expect(holdTo("", 3)).toBe("");
  });
});
