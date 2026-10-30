import { describe, expect, test } from "@jest/globals";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import CodeHostText from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostText";
import { CodeHostHttpErrorKind } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CODE_HOST_MAX_COMMITS,
  CodeHostCommitFile,
  CodeHostCommitMade,
  CodeHostCommitRange,
  CodeHostCommitSummary,
  CodeHostOpenedPullRequest,
  CodeHostPullRequestSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { FakeCodeHost, FakeRoute, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * What chat writes to a Forgejo or Gitea repository, and what a deploy's
 * list of commits reads from one - against their API (v1) as it answers,
 * read from a real Forgejo 9 and Gitea 1.22 (ForgejoApiReviewsWrites-
 * AgainstServer):
 *
 *   - a branch from another (409 when there already), sent under both of
 *     the API's names for the branch it starts from;
 *   - one commit of several files through the contents API, each created,
 *     or updated with the SHA of the file it replaces;
 *   - a pull request, ready for review;
 *   - the commits from one deploy's commit to the next - from the compare
 *     API, or on a Gitea older than 1.23 (which compares branches only)
 *     from the head's history back to the base - a rollback, the same
 *     commit, and the files they changed, as the change they make together;
 *   - one commit and its files; the pull request a merge commit came from.
 */

const TOKEN: string = "0123456789abcdef0123456789abcdef01234567";
const HOST: string = "https://git.example.com";
const API: string = `${HOST}/api/v1`;
const OWNER: string = "acme";
const NAME: string = "checkout";
const BASE: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const HEAD: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";
const MIDDLE: string = "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";

function forgejo(routes: Array<FakeRoute>): {
  api: ForgejoApi;
  host: FakeCodeHost;
} {
  const host: FakeCodeHost = fakeCodeHost({ apiBaseUrl: API, routes });

  return {
    api: new ForgejoApi({
      hostUrl: HOST,
      token: TOKEN,
      transport: host.transport,
      backOff: noWait,
      providerName: "Gitea",
    }),
    host,
  };
}

function bodyOf(host: FakeCodeHost, index: number): Record<string, unknown> {
  return JSON.parse(host.requests[index]!.body || "{}") as Record<
    string,
    unknown
  >;
}

// A commit as the compare, commits and git/commits APIs list one.
function commit(
  sha: string,
  message: string,
  files: Array<{ filename: string; status: string }> = [],
): unknown {
  return {
    sha,
    html_url: `${HOST}/acme/checkout/commit/${sha}`,
    commit: {
      message: `${message}\n`,
      author: {
        name: "Dana",
        email: "dana@example.com",
        date: "2026-10-30T09:00:00Z",
      },
    },
    author: { login: "dana" },
    files,
    stats: { total: 3, additions: 2, deletions: 1 },
  };
}

describe("ForgejoApi: a branch, made for chat's change", () => {
  test("made from the base branch, named the way old and new servers read it", async () => {
    const { api, host } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/branches",
        answer: () => {
          return { status: 201, json: { name: "oneuptime-ai/fix-1a2b" } };
        },
      },
    ]);

    expect(
      await api.createBranch({
        owner: OWNER,
        name: NAME,
        branchName: "oneuptime-ai/fix-1a2b",
        fromBranchName: "main",
      }),
    ).toBe(true);
    expect(bodyOf(host, 0)).toEqual({
      new_branch_name: "oneuptime-ai/fix-1a2b",
      old_ref_name: "main",
      old_branch_name: "main",
    });
  });

  test("a branch of its name there already (409) is not made again; anything else is thrown", async () => {
    const { api } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/branches",
        answer: () => {
          return {
            status: 409,
            json: { message: "The branch already exists." },
          };
        },
      },
    ]);

    expect(
      await api.createBranch({
        owner: OWNER,
        name: NAME,
        branchName: "b",
        fromBranchName: "main",
      }),
    ).toBe(false);

    const { api: missing } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/branches",
        answer: () => {
          return {
            status: 404,
            json: { message: "The old branch does not exist" },
          };
        },
      },
    ]);

    await expect(
      missing.createBranch({
        owner: OWNER,
        name: NAME,
        branchName: "b",
        fromBranchName: "gone",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.NotFound });
  });
});

describe("ForgejoApi: one commit of several files", () => {
  test("updates a file there with the SHA it replaces, creates a new one, each in base64", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/README.md",
        answer: () => {
          return {
            json: { type: "file", path: "README.md", sha: "29950327" },
          };
        },
      },
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/src/billing/charge.ts",
        answer: () => {
          return { status: 404, json: { message: "GetContentsOrList" } };
        },
      },
      {
        method: "POST",
        path: "/repos/acme/checkout/contents",
        answer: () => {
          return {
            status: 201,
            json: {
              files: [],
              commit: {
                sha: HEAD,
                html_url: `${HOST}/acme/checkout/commit/${HEAD}`,
              },
            },
          };
        },
      },
    ]);

    const made: CodeHostCommitMade = await api.commitFiles({
      owner: OWNER,
      name: NAME,
      branchName: "oneuptime-ai/fix-1a2b",
      commitMessage: "fix: guard the card",
      files: [
        { filePath: "README.md", content: "# Checkout\n" },
        { filePath: "src/billing/charge.ts", content: "export const é = 1;\n" },
      ],
    });

    expect(made).toEqual({
      commitSha: HEAD,
      htmlUrl: `${HOST}/acme/checkout/commit/${HEAD}`,
    });
    expect(host.urlsTo("/contents/README.md")[0]!.searchParams.get("ref")).toBe(
      "oneuptime-ai/fix-1a2b",
    );
    expect(bodyOf(host, 2)).toEqual({
      branch: "oneuptime-ai/fix-1a2b",
      message: "fix: guard the card",
      files: [
        {
          operation: "update",
          path: "README.md",
          content: Buffer.from("# Checkout\n", "utf8").toString("base64"),
          sha: "29950327",
        },
        {
          operation: "create",
          path: "src/billing/charge.ts",
          content: Buffer.from("export const é = 1;\n", "utf8").toString(
            "base64",
          ),
        },
      ],
    });
  });

  test("a folder at the path is refused before anything is written", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/src",
        answer: () => {
          return { json: [{ type: "file", path: "src/a.ts" }] };
        },
      },
    ]);

    await expect(
      api.commitFiles({
        owner: OWNER,
        name: NAME,
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "src", content: "x" }],
      }),
    ).rejects.toThrow("src is a folder in the repository, not a file.");
    expect(host.urlsTo("/contents")).toHaveLength(0);
  });

  test("a server older than 1.20, which writes one file at a time, is said as such", async () => {
    for (const status of [404, 405]) {
      const { api } = forgejo([
        {
          method: "GET",
          path: "/repos/acme/checkout/contents/a.ts",
          answer: () => {
            return { status: 404, json: { message: "not found" } };
          },
        },
        {
          method: "POST",
          path: "/repos/acme/checkout/contents",
          answer: () => {
            return { status, json: { message: "nope" } };
          },
        },
      ]);

      await expect(
        api.commitFiles({
          owner: OWNER,
          name: NAME,
          branchName: "b",
          commitMessage: "m",
          files: [{ filePath: "a.ts", content: "x" }],
        }),
      ).rejects.toThrow(
        "Gitea did not take the commit. Writing several files in one commit needs Forgejo or Gitea 1.20 or later.",
      );
    }
  });

  test("a commit the server says nothing of is the server not being Forgejo's API", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/contents/a.ts",
        answer: () => {
          return { status: 404, json: { message: "not found" } };
        },
      },
      {
        method: "POST",
        path: "/repos/acme/checkout/contents",
        answer: () => {
          return { status: 201, json: { commit: { sha: "x" } } };
        },
      },
    ]);

    await expect(
      api.commitFiles({
        owner: OWNER,
        name: NAME,
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "x" }],
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });
});

describe("ForgejoApi: a pull request, ready for review", () => {
  test("from the branch into the default one", async () => {
    const { api, host } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return {
            status: 201,
            json: {
              id: 4,
              number: 12,
              state: "open",
              merged: false,
              html_url: `${HOST}/acme/checkout/pulls/12`,
            },
          };
        },
      },
    ]);

    const opened: CodeHostOpenedPullRequest = await api.createPullRequest({
      owner: OWNER,
      name: NAME,
      headBranch: "oneuptime-ai/fix-1a2b",
      baseBranch: "main",
      title: "Guard the card",
      body: "Why.",
    });

    expect(opened).toEqual({
      id: 4,
      number: 12,
      htmlUrl: `${HOST}/acme/checkout/pulls/12`,
      state: PullRequestState.Open,
    });
    expect(bodyOf(host, 0)).toEqual({
      head: "oneuptime-ai/fix-1a2b",
      base: "main",
      title: "Guard the card",
      body: "Why.",
    });
  });

  test("one already open for the branch is a conflict (409); an answer with no number is none opened", async () => {
    const { api } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return {
            status: 409,
            json: { message: "pull request already exists for these targets" },
          };
        },
      },
    ]);

    await expect(
      api.createPullRequest({
        owner: OWNER,
        name: NAME,
        headBranch: "b",
        baseBranch: "main",
        title: "t",
        body: "",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Conflict });

    const { api: none } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return { status: 201, json: { state: "open" } };
        },
      },
    ]);

    await expect(
      none.createPullRequest({
        owner: OWNER,
        name: NAME,
        headBranch: "b",
        baseBranch: "main",
        title: "t",
        body: "",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });
});

describe("ForgejoApi: what a deploy shipped", () => {
  test("the compare: newest first, with the files they changed as the change they make together", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: `/repos/acme/checkout/compare/${BASE}...${HEAD}`,
        answer: () => {
          return {
            json: {
              total_commits: 2,
              commits: [
                commit(HEAD, "fix: say why", [
                  { filename: "src/charge.ts", status: "modified" },
                ]),
                commit(MIDDLE, "fix: guard the card (#7)", [
                  { filename: "src/charge.ts", status: "added" },
                  { filename: "README.md", status: "modified" },
                ]),
              ],
            },
          };
        },
      },
    ]);

    const range: CodeHostCommitRange = await api.compareCommits({
      owner: OWNER,
      name: NAME,
      base: BASE,
      head: HEAD,
    });

    expect(range).toEqual({
      status: "ahead",
      totalCommits: 2,
      commits: [
        {
          sha: HEAD,
          message: "fix: say why",
          authorName: "Dana",
          authorLogin: "dana",
          date: "2026-10-30T09:00:00Z",
          pullRequestNumbers: [],
        },
        {
          sha: MIDDLE,
          message: "fix: guard the card (#7)",
          authorName: "Dana",
          authorLogin: "dana",
          date: "2026-10-30T09:00:00Z",
          pullRequestNumbers: [7],
        },
      ],
      files: [
        { path: "src/charge.ts", status: "added" },
        { path: "README.md", status: "modified" },
      ],
      isTruncated: false,
    });
    expect(host.requests).toHaveLength(1);
  });

  test("none from the last deploy's commit: a rollback when the compare back has some, else the same commit", async () => {
    const answers: Record<string, unknown> = {
      [`${HEAD}...${BASE}`]: { total_commits: 0, commits: [] },
      [`${BASE}...${HEAD}`]: {
        total_commits: 1,
        commits: [commit(HEAD, "newer")],
      },
      [`${HEAD}...${HEAD}`]: { total_commits: 0, commits: [] },
    };
    const { api } = forgejo([
      {
        method: "GET",
        path: /^\/repos\/acme\/checkout\/compare\/.+$/,
        answer: (_request: unknown, url: URL) => {
          const key: string = url.pathname.split("/compare/")[1]!;
          return { json: answers[key] || { total_commits: 0, commits: [] } };
        },
      },
    ]);

    expect(
      (
        await api.compareCommits({
          owner: OWNER,
          name: NAME,
          base: HEAD,
          head: BASE,
        })
      ).status,
    ).toBe("behind");
    expect(
      (
        await api.compareCommits({
          owner: OWNER,
          name: NAME,
          base: HEAD,
          head: HEAD,
        })
      ).status,
    ).toBe("identical");
  });

  describe("on a Gitea older than 1.23, which compares branches only", () => {
    function olderGitea(history: Record<string, Array<unknown>>): {
      api: ForgejoApi;
      host: FakeCodeHost;
    } {
      return forgejo([
        {
          method: "GET",
          path: /^\/repos\/acme\/checkout\/compare\/.+$/,
          answer: () => {
            return {
              status: 404,
              json: { message: "BaseNotExist", errors: [] },
            };
          },
        },
        {
          method: "GET",
          path: "/repos/acme/checkout/commits",
          answer: (_request: unknown, url: URL) => {
            const all: Array<unknown> =
              history[url.searchParams.get("sha") || ""] || [];
            const page: number = Number(url.searchParams.get("page"));
            const limit: number = Number(url.searchParams.get("limit"));

            return { json: all.slice((page - 1) * limit, page * limit) };
          },
        },
      ]);
    }

    test("reads the head's history back to the base, with each commit's files", async () => {
      const { api, host } = olderGitea({
        [HEAD]: [
          commit(HEAD, "fix: say why", [
            { filename: "src/charge.ts", status: "modified" },
          ]),
          commit(MIDDLE, "fix: guard the card (#7)", [
            { filename: "src/charge.ts", status: "added" },
          ]),
          commit(BASE, "Initial"),
        ],
      });

      const range: CodeHostCommitRange = await api.compareCommits({
        owner: OWNER,
        name: NAME,
        base: BASE,
        head: HEAD,
      });

      expect(range.status).toBe("ahead");
      expect(
        range.commits.map((item: CodeHostCommitSummary) => {
          return item.sha;
        }),
      ).toEqual([HEAD, MIDDLE]);
      expect(range.files).toEqual([{ path: "src/charge.ts", status: "added" }]);
      expect(range.isTruncated).toBe(false);

      const query: URLSearchParams = host.urlsTo("/commits")[0]!.searchParams;

      expect(Object.fromEntries(query.entries())).toEqual({
        sha: HEAD,
        page: "1",
        limit: "50",
        stat: "false",
        verification: "false",
        files: "true",
      });
    });

    test("an abbreviated base is found by its start; the base first is the same commit", async () => {
      const { api } = olderGitea({
        [HEAD]: [commit(HEAD, "head"), commit(BASE, "base")],
        [BASE]: [commit(BASE, "base")],
      });

      expect(
        (
          await api.compareCommits({
            owner: OWNER,
            name: NAME,
            base: BASE.substring(0, 7),
            head: HEAD,
          })
        ).totalCommits,
      ).toBe(1);
      expect(
        (
          await api.compareCommits({
            owner: OWNER,
            name: NAME,
            base: BASE,
            head: BASE,
          })
        ).status,
      ).toBe("identical");
    });

    test("a history without the base: a rollback when the head is in the base's history, else diverged", async () => {
      const rollback: { api: ForgejoApi } = olderGitea({
        [BASE]: [commit(BASE, "older")],
        [HEAD]: [commit(HEAD, "newer"), commit(BASE, "older")],
      });

      expect(
        (
          await rollback.api.compareCommits({
            owner: OWNER,
            name: NAME,
            base: HEAD,
            head: BASE,
          })
        ).status,
      ).toBe("behind");

      const diverged: { api: ForgejoApi } = olderGitea({
        [HEAD]: [commit(HEAD, "ours"), commit(MIDDLE, "shared")],
        [BASE]: [commit(BASE, "theirs"), commit(MIDDLE, "shared")],
      });

      const range: CodeHostCommitRange = await diverged.api.compareCommits({
        owner: OWNER,
        name: NAME,
        base: BASE,
        head: HEAD,
      });

      expect(range.status).toBe("diverged");
      expect(range.totalCommits).toBe(2);
    });

    test("a history longer than the pages read says it holds more than was listed", async () => {
      const long: Array<unknown> = Array.from(
        { length: 600 },
        (_value: unknown, index: number) => {
          return commit(index.toString(16).padStart(40, "0"), `c${index}`);
        },
      );
      const { api, host } = olderGitea({ [HEAD]: long });

      const range: CodeHostCommitRange = await api.compareCommits({
        owner: OWNER,
        name: NAME,
        base: BASE,
        head: HEAD,
      });

      expect(range.status).toBe("ahead");
      expect(range.isTruncated).toBe(true);
      expect(range.commits).toHaveLength(CODE_HOST_MAX_COMMITS);
      expect(range.totalCommits).toBe(500);
      expect(host.urlsTo("/commits")).toHaveLength(10);
    });
  });

  test("one commit, and the files it changed - which and how", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: `/repos/acme/checkout/git/commits/${HEAD}`,
        answer: () => {
          return {
            json: commit(HEAD, "fix: guard the card (#7)\n\nWhy.", [
              { filename: "src/a.ts", status: "modified" },
              { filename: "src/gone.ts", status: "removed" },
            ]),
          };
        },
      },
    ]);

    const read: {
      commit: CodeHostCommitSummary;
      files: Array<CodeHostCommitFile>;
    } = await api.getCommit({ owner: OWNER, name: NAME, sha: HEAD });

    expect(read.commit).toEqual({
      sha: HEAD,
      message: "fix: guard the card (#7)",
      authorName: "Dana",
      authorLogin: "dana",
      date: "2026-10-30T09:00:00Z",
      pullRequestNumbers: [7],
    });
    expect(read.files).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/gone.ts", status: "removed" },
    ]);
    expect(
      Object.fromEntries(
        host.urlsTo(`/git/commits/${HEAD}`)[0]!.searchParams.entries(),
      ),
    ).toEqual({ stat: "false", verification: "false", files: "true" });
  });

  test("the pull request a merge commit came from; none for any other commit or an older server", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: `/repos/acme/checkout/commits/${HEAD}/pull`,
        answer: () => {
          return {
            json: {
              number: 12,
              title: "Guard the card",
              user: { login: "dana" },
              merged_at: "2026-10-30T09:30:00Z",
              html_url: `${HOST}/acme/checkout/pulls/12`,
            },
          };
        },
      },
    ]);

    const pullRequests: Array<CodeHostPullRequestSummary> =
      await api.getPullRequestOfCommit({ owner: OWNER, name: NAME, sha: HEAD });

    expect(pullRequests).toEqual([
      {
        number: 12,
        title: "Guard the card",
        authorLogin: "dana",
        mergedAt: "2026-10-30T09:30:00Z",
        url: `${HOST}/acme/checkout/pulls/12`,
      },
    ]);
    expect(
      await api.getPullRequestOfCommit({ owner: OWNER, name: NAME, sha: BASE }),
    ).toEqual([]);
  });
});

describe("ForgejoApi.combineCommitFiles: commits' files as the change they make together", () => {
  function entry(files: Array<[string, string]>): unknown {
    return {
      files: files.map(([filename, status]: [string, string]) => {
        return { filename, status };
      }),
    };
  }

  test.each([
    [
      "added, then changed: added",
      [["a", "modified"]],
      [["a", "added"]],
      "added",
    ],
    [
      "added, then removed: no change at all",
      [["a", "removed"]],
      [["a", "added"]],
      null,
    ],
    [
      "removed, then added again: changed",
      [["a", "added"]],
      [["a", "removed"]],
      "modified",
    ],
    [
      "changed, then removed: removed",
      [["a", "removed"]],
      [["a", "modified"]],
      "removed",
    ],
    [
      "renamed, then changed: renamed",
      [["a", "modified"]],
      [["a", "renamed"]],
      "renamed",
    ],
    ["deleted is removed", [["a", "deleted"]], [], "removed"],
    ["anything else is modified", [["a", "changed"]], [], "modified"],
  ] as Array<
    [string, Array<[string, string]>, Array<[string, string]>, string | null]
  >)(
    "%s",
    (
      _what: string,
      newer: Array<[string, string]>,
      older: Array<[string, string]>,
      expected: string | null,
    ) => {
      const files: Array<CodeHostCommitFile> = ForgejoApi.combineCommitFiles([
        entry(newer),
        entry(older),
      ]);

      expect(files).toEqual(
        expected === null ? [] : [{ path: "a", status: expected }],
      );
    },
  );

  test("entries with no files, and files with no name, are passed over", () => {
    expect(
      ForgejoApi.combineCommitFiles([
        null,
        "x",
        { files: "nope" },
        { files: [{ status: "added" }] },
      ]),
    ).toEqual([]);
  });
});

describe("ForgejoApi.readCommit", () => {
  test("a commit with no SHA, or no commit at all, is none", () => {
    expect(ForgejoApi.readCommit({ sha: "nope" })).toBeNull();
    expect(ForgejoApi.readCommit(null)).toBeNull();
    expect(ForgejoApi.readCommit([])).toBeNull();
  });

  test("a commit of no account of the server's is its author's name", () => {
    expect(
      ForgejoApi.readCommit({
        sha: HEAD,
        commit: { message: "x", author: { name: "Robot" } },
        author: null,
      }),
    ).toEqual({
      sha: HEAD,
      message: "x",
      authorName: "Robot",
      pullRequestNumbers: [],
    });
  });
});

describe("CodeHostText.readParenthesizedNumbers", () => {
  test.each([
    ["fix: guard the card (#7)", [7]],
    ["Merge pull request 'Guard' (#12) from fix into main", [12]],
    ["(#1) and (#2) and (#1) again", [1, 2]],
    ["#7 without its brackets", []],
    ["(#) (#x) (#7", []],
    ["(#1234567890)", []],
    ["(#0)", []],
    ["", []],
  ] as Array<[string, Array<number>]>)(
    "%j names %j",
    (message: string, numbers: Array<number>) => {
      expect(CodeHostText.readParenthesizedNumbers(message)).toEqual(numbers);
    },
  );

  test("a message of 400,000 characters of openings is read in time in line with it", () => {
    const message: string = "(#1".repeat(140000);

    const timed: FastestRun<Array<number>> = fastestRun({
      run: (): Array<number> => {
        return CodeHostText.readParenthesizedNumbers(message);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result).toEqual([]);
  });
});
