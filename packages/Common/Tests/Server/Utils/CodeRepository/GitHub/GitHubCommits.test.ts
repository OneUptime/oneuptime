import GitHubCommits, {
  GitHubCommitRange,
  MAX_COMMITS,
  MAX_FILES,
  MAX_PULL_REQUEST_FILE_PAGES,
  PULL_REQUEST_FILES_PER_PAGE,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubCommits";
import API, { APIRequestOptions } from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../../Types/JSON";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// API.get as jest.spyOn types it: its type argument at its constraint.
type ApiGet = (options: APIRequestOptions) => ReturnType<typeof API.get>;

/*
 * What a deploy shipped, read from GitHub: the commits between two commits,
 * one commit, and the pull requests a commit came from. The parsers pin the
 * shapes GitHub answers with; the calls pin the endpoints and headers.
 */

function githubCommit(data: {
  sha: string;
  message: string;
  name?: string;
  login?: string;
}): JSONObject {
  return {
    sha: data.sha,
    commit: {
      message: data.message,
      author: { name: data.name ?? "Dana", date: "2026-10-19T09:40:00Z" },
    },
    ...(data.login ? { author: { login: data.login } } : {}),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isCommitSha", () => {
  test("full and abbreviated SHAs are commits", () => {
    expect(GitHubCommits.isCommitSha("1a2b3c4")).toBe(true);
    expect(
      GitHubCommits.isCommitSha("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"),
    ).toBe(true);
  });

  test("anything else is not", () => {
    for (const value of [
      undefined,
      "",
      "1a2b3c",
      "v2.3.1",
      "main",
      "zzzzzzz",
    ]) {
      expect(GitHubCommits.isCommitSha(value)).toBe(false);
    }
  });
});

describe("parseRepositoryName", () => {
  test.each([
    ["https://github.com/acme/api", "acme", "api"],
    ["https://github.com/acme/api.git", "acme", "api"],
    ["https://www.github.com/acme/api/", "acme", "api"],
    ["git@github.com:acme/api.git", "acme", "api"],
    ["ssh://git@github.com/acme/api.git", "acme", "api"],
    ["acme/api", "acme", "api"],
    ["Acme-Corp/api.v2", "Acme-Corp", "api.v2"],
  ])("%s is %s/%s", (value: string, owner: string, name: string) => {
    expect(GitHubCommits.parseRepositoryName(value)).toEqual({ owner, name });
  });

  test("anything that is not a GitHub repository is not", () => {
    for (const value of [
      undefined,
      "",
      "api",
      "https://gitlab.com/acme/api",
      "https://github.com/acme",
      "https://github.com/acme/api/pull/4",
      "acme/api; rm -rf /",
    ]) {
      expect(GitHubCommits.parseRepositoryName(value)).toBeNull();
    }
  });
});

describe("pullRequestNumbersFromMessage", () => {
  test("reads a squash merge's and a merge commit's pull request", () => {
    expect(
      GitHubCommits.pullRequestNumbersFromMessage("Fix totals (#482)"),
    ).toEqual([482]);
    expect(
      GitHubCommits.pullRequestNumbersFromMessage(
        "Merge pull request #77 from acme/fix\n\nFix totals",
      ),
    ).toEqual([77]);
  });

  test("lists each once, and none when the message names none", () => {
    expect(
      GitHubCommits.pullRequestNumbersFromMessage(
        "Revert (#12)\n\nReverts (#12) and (#13)",
      ),
    ).toEqual([12, 13]);
    expect(
      GitHubCommits.pullRequestNumbersFromMessage("issue #5 is not a PR"),
    ).toEqual([]);
  });
});

describe("parsing", () => {
  test("a commit: its first line, author and pull requests", () => {
    expect(
      GitHubCommits.parseCommit(
        githubCommit({
          sha: "abc1234def",
          message: "Fix totals (#482)\n\nLonger body",
          login: "dana",
        }),
      ),
    ).toEqual({
      sha: "abc1234def",
      message: "Fix totals (#482)",
      authorName: "Dana",
      authorLogin: "dana",
      date: "2026-10-19T09:40:00Z",
      pullRequestNumbers: [482],
    });
  });

  test("a commit with nothing but a SHA", () => {
    expect(GitHubCommits.parseCommit({ sha: "abc1234" })).toEqual({
      sha: "abc1234",
      message: "",
      authorName: "unknown",
      pullRequestNumbers: [],
    });
  });

  test("files, without the ones that name no path", () => {
    expect(
      GitHubCommits.parseFiles([
        {
          filename: "src/checkout/total.ts",
          status: "modified",
          additions: 3,
          deletions: 1,
        },
        { status: "removed" },
        null,
        "garbage",
      ]),
    ).toEqual([
      {
        path: "src/checkout/total.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
      },
    ]);
    expect(GitHubCommits.parseFiles(undefined)).toEqual([]);
  });

  test("a compare: newest commit first, capped, and whether it was cut", () => {
    const commits: Array<JSONObject> = Array.from(
      { length: MAX_COMMITS + 5 },
      (_value: unknown, index: number) => {
        return githubCommit({ sha: `sha${index}`, message: `commit ${index}` });
      },
    );
    const files: Array<JSONObject> = Array.from(
      { length: MAX_FILES + 1 },
      (_value: unknown, index: number) => {
        return { filename: `f${index}`, status: "modified" };
      },
    );

    const range: GitHubCommitRange = GitHubCommits.parseCompare({
      status: "ahead",
      total_commits: MAX_COMMITS + 5,
      commits,
      files,
    });

    expect(range.status).toBe("ahead");
    expect(range.totalCommits).toBe(MAX_COMMITS + 5);
    expect(range.commits).toHaveLength(MAX_COMMITS);
    expect(range.commits[0]!.sha).toBe(`sha${MAX_COMMITS + 4}`);
    expect(range.files).toHaveLength(MAX_FILES);
    expect(range.isTruncated).toBe(true);
  });

  test("a compare GitHub listed in full is not cut", () => {
    const range: GitHubCommitRange = GitHubCommits.parseCompare({
      status: "ahead",
      total_commits: 2,
      commits: [
        githubCommit({ sha: "a", message: "one" }),
        githubCommit({ sha: "b", message: "two" }),
      ],
      files: [{ filename: "x", status: "added", additions: 1, deletions: 0 }],
    });

    expect(range.isTruncated).toBe(false);
    expect(
      range.commits.map((commit: { sha: string }) => {
        return commit.sha;
      }),
    ).toEqual(["b", "a"]);
  });

  test("a compare that lists fewer commits than it counts was cut", () => {
    expect(
      GitHubCommits.parseCompare({
        total_commits: 300,
        commits: [githubCommit({ sha: "a", message: "one" })],
      }).isTruncated,
    ).toBe(true);
  });

  test("pull requests, without the ones that have no number", () => {
    expect(
      GitHubCommits.parsePullRequests([
        {
          number: 482,
          title: "Fix totals",
          user: { login: "dana" },
          merged_at: "2026-10-19T09:30:00Z",
          html_url: "https://github.com/acme/api/pull/482",
        },
        { title: "no number" },
        null,
      ]),
    ).toEqual([
      {
        number: 482,
        title: "Fix totals",
        authorLogin: "dana",
        mergedAt: "2026-10-19T09:30:00Z",
        url: "https://github.com/acme/api/pull/482",
      },
    ]);
    expect(GitHubCommits.parsePullRequests({})).toEqual([]);
  });
});

describe("the calls", () => {
  function mockGet(data: unknown): SpyInstance<ApiGet> {
    return jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, data as JSONObject, {}),
      );
  }

  function calledUrl(spy: SpyInstance<ApiGet>): string {
    return (
      spy.mock.calls[0]![0] as { url: { toString(): string } }
    ).url.toString();
  }

  function calledHeaders(spy: SpyInstance<ApiGet>): Record<string, string> {
    return (spy.mock.calls[0]![0] as { headers: Record<string, string> })
      .headers;
  }

  test("compare asks for base...head with the token", async () => {
    const get: SpyInstance<ApiGet> = mockGet({
      status: "ahead",
      total_commits: 1,
      commits: [githubCommit({ sha: "b", message: "Fix (#1)" })],
      files: [],
    });

    const range: GitHubCommitRange = await GitHubCommits.compare({
      token: "tok",
      owner: "acme",
      repository: "api",
      base: "1111111",
      head: "2222222",
    });

    expect(calledUrl(get)).toBe(
      "https://api.github.com/repos/acme/api/compare/1111111...2222222",
    );
    expect(calledHeaders(get)).toEqual({
      Authorization: "Bearer tok",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(range.commits[0]!.pullRequestNumbers).toEqual([1]);
  });

  test("getCommit reads one commit and its files", async () => {
    const get: SpyInstance<ApiGet> = mockGet({
      ...githubCommit({ sha: "abc1234", message: "Ship it" }),
      files: [
        { filename: "a.ts", status: "modified", additions: 1, deletions: 2 },
      ],
    });

    const result: Awaited<ReturnType<typeof GitHubCommits.getCommit>> =
      await GitHubCommits.getCommit({
        token: "tok",
        owner: "acme",
        repository: "api",
        sha: "abc1234",
      });

    expect(calledUrl(get)).toBe(
      "https://api.github.com/repos/acme/api/commits/abc1234",
    );
    expect(result.commit.message).toBe("Ship it");
    expect(result.files).toEqual([
      { path: "a.ts", status: "modified", additions: 1, deletions: 2 },
    ]);
  });

  test("listPullRequestsForCommit reads the commit's pull requests", async () => {
    const get: SpyInstance<ApiGet> = mockGet([
      { number: 9, title: "Nine", html_url: "u" },
    ]);

    await expect(
      GitHubCommits.listPullRequestsForCommit({
        token: "tok",
        owner: "acme",
        repository: "api",
        sha: "abc1234",
      }),
    ).resolves.toEqual([{ number: 9, title: "Nine", url: "u" }]);
    expect(calledUrl(get)).toBe(
      "https://api.github.com/repos/acme/api/commits/abc1234/pulls",
    );
  });

  test("names are encoded into the path", async () => {
    const get: SpyInstance<ApiGet> = mockGet({});

    await GitHubCommits.getCommit({
      token: "tok",
      owner: "acme",
      repository: "a b",
      sha: "abc1234",
    });

    expect(calledUrl(get)).toBe(
      "https://api.github.com/repos/acme/a%20b/commits/abc1234",
    );
  });

  test("an error reply is thrown", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPErrorResponse(404, { message: "Not Found" }, {}),
      );

    await expect(
      GitHubCommits.getCommit({
        token: "tok",
        owner: "acme",
        repository: "api",
        sha: "abc1234",
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

/*
 * What a pull request changed, file by file with its diff: what a merged
 * telemetry improvement adds is read from it (TelemetryFixWatch).
 */
describe("a pull request's files", () => {
  function file(index: number, patch?: string): JSONObject {
    return {
      filename: `src/file-${index}.ts`,
      status: "modified",
      ...(patch === undefined ? {} : { patch }),
    };
  }

  function pageOf(count: number, start: number): Array<JSONObject> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return file(start + index, `+ span("s${start + index}")`);
    });
  }

  test("each file keeps its diff; a binary or too large file has none", () => {
    expect(
      GitHubCommits.parsePullRequestFilePatches([
        file(1, '+ span("a")'),
        file(2),
        { status: "added" },
        "not a file",
      ]),
    ).toEqual([
      { path: "src/file-1.ts", patch: '+ span("a")' },
      { path: "src/file-2.ts" },
    ]);
    expect(GitHubCommits.parsePullRequestFilePatches({ message: "x" })).toEqual(
      [],
    );
  });

  test("pages are read until one is not full", async () => {
    const get: SpyInstance<ApiGet> = jest
      .spyOn(API, "get")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          pageOf(PULL_REQUEST_FILES_PER_PAGE, 0) as unknown as JSONObject,
          {},
        ),
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          pageOf(3, PULL_REQUEST_FILES_PER_PAGE) as unknown as JSONObject,
          {},
        ),
      );

    const read: { files: Array<{ path: string }>; isTruncated: boolean } =
      await GitHubCommits.listPullRequestFilePatches({
        token: "tok",
        owner: "acme",
        repository: "api",
        pullRequestNumber: 123,
      });

    expect(read.files).toHaveLength(PULL_REQUEST_FILES_PER_PAGE + 3);
    expect(read.isTruncated).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    expect(
      (get.mock.calls[1]![0] as { url: { toString(): string } }).url.toString(),
    ).toBe(
      "https://api.github.com/repos/acme/api/pulls/123/files?per_page=100&page=2",
    );
  });

  test(`at most ${MAX_PULL_REQUEST_FILE_PAGES} pages are read, and the read says so`, async () => {
    const get: SpyInstance<ApiGet> = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          pageOf(PULL_REQUEST_FILES_PER_PAGE, 0) as unknown as JSONObject,
          {},
        ),
      );

    const read: { files: Array<{ path: string }>; isTruncated: boolean } =
      await GitHubCommits.listPullRequestFilePatches({
        token: "tok",
        owner: "acme",
        repository: "api",
        pullRequestNumber: 123,
      });

    expect(get).toHaveBeenCalledTimes(MAX_PULL_REQUEST_FILE_PAGES);
    expect(read.isTruncated).toBe(true);
  });

  test("an error reply is thrown, for the caller to try again", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPErrorResponse(403, { message: "rate limit" }, {}),
      );

    await expect(
      GitHubCommits.listPullRequestFilePatches({
        token: "tok",
        owner: "acme",
        repository: "api",
        pullRequestNumber: 123,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
