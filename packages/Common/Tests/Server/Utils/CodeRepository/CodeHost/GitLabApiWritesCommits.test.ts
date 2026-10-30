import { describe, expect, test } from "@jest/globals";
import GitLabApi from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
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
 * What chat writes to a GitLab project, and what a deploy's list of
 * commits reads from one - against GitLab's API (v4) as its docs say it
 * answers:
 *
 *   - a branch from another (and the same branch again: there already);
 *   - one commit of several files, each created or updated - which GitLab
 *     needs said - and sent in base64;
 *   - a merge request, ready for review;
 *   - the commits from one deploy's commit to the next, newest first, and
 *     the files they changed, counted; a rollback; the same commit;
 *   - one commit and its files; the merge requests it is in; the merge
 *     requests its message names.
 */

const TOKEN: string = "glpat-0123456789abcdefghij";
const HOST: string = "https://gitlab.example.com";
const API: string = `${HOST}/api/v4`;
const PROJECT: string = "4217";
const BASE: string = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const HEAD: string = "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c";

function gitLab(routes: Array<FakeRoute>): {
  api: GitLabApi;
  host: FakeCodeHost;
} {
  const host: FakeCodeHost = fakeCodeHost({ apiBaseUrl: API, routes });

  return {
    api: new GitLabApi({
      hostUrl: HOST,
      token: TOKEN,
      transport: host.transport,
      backOff: noWait,
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

function commit(
  sha: string,
  message: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id: sha,
    short_id: sha.substring(0, 8),
    title: message.split("\n")[0],
    message,
    author_name: "Dana",
    author_email: "dana@example.com",
    authored_date: "2026-10-30T09:00:00.000Z",
    committed_date: "2026-10-30T09:01:00.000Z",
    web_url: `${HOST}/acme/checkout/-/commit/${sha}`,
    ...overrides,
  };
}

describe("GitLabApi: a branch, made for chat's change", () => {
  test("made from the base branch when there is none of its name", async () => {
    let made: boolean = false;
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/branches/oneuptime-ai%2Ffix-1a2b",
        answer: () => {
          return made
            ? {
                json: {
                  name: "oneuptime-ai/fix-1a2b",
                  protected: false,
                  commit: { id: BASE },
                },
              }
            : { status: 404, json: { message: "404 Branch Not Found" } };
        },
      },
      {
        method: "POST",
        path: "/projects/4217/repository/branches",
        answer: () => {
          made = true;
          return {
            status: 201,
            json: { name: "oneuptime-ai/fix-1a2b", commit: { id: BASE } },
          };
        },
      },
    ]);

    expect(
      await api.createBranch({
        project: PROJECT,
        branchName: "oneuptime-ai/fix-1a2b",
        fromBranchName: "main",
      }),
    ).toBe(true);
    expect(bodyOf(host, 1)).toEqual({
      branch: "oneuptime-ai/fix-1a2b",
      ref: "main",
    });

    // There now: not made again.
    expect(
      await api.createBranch({
        project: PROJECT,
        branchName: "oneuptime-ai/fix-1a2b",
        fromBranchName: "main",
      }),
    ).toBe(false);
    expect(
      host.requests.filter((request: { method: string }) => {
        return request.method === "POST";
      }),
    ).toHaveLength(1);
  });

  test("a branch made meanwhile (400 Branch already exists) is there already, not an error", async () => {
    let posted: boolean = false;
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/branches/feature",
        answer: () => {
          return posted
            ? { json: { name: "feature", commit: { id: BASE } } }
            : { status: 404, json: { message: "404 Branch Not Found" } };
        },
      },
      {
        method: "POST",
        path: "/projects/4217/repository/branches",
        answer: () => {
          posted = true;
          return { status: 400, json: { message: "Branch already exists" } };
        },
      },
    ]);

    expect(
      await api.createBranch({
        project: PROJECT,
        branchName: "feature",
        fromBranchName: "main",
      }),
    ).toBe(false);
  });

  test("a base branch that is not there is GitLab's refusal, thrown", async () => {
    const { api } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/repository/branches",
        answer: () => {
          return { status: 400, json: { message: "Invalid reference name" } };
        },
      },
    ]);

    await expect(
      api.createBranch({
        project: PROJECT,
        branchName: "feature",
        fromBranchName: "no-such-branch",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Rejected });
  });
});

describe("GitLabApi: one commit of several files", () => {
  test("creates the new files and updates the ones there, each sent whole in base64", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/files/README.md",
        answer: () => {
          return { json: { file_path: "README.md", content: "eA==" } };
        },
      },
      {
        method: "GET",
        path: "/projects/4217/repository/files/src%2Fbilling%2Fcharge.ts",
        answer: () => {
          return { status: 404, json: { message: "404 File Not Found" } };
        },
      },
      {
        method: "POST",
        path: "/projects/4217/repository/commits",
        answer: () => {
          return {
            status: 201,
            json: commit(HEAD, "fix: guard the card"),
          };
        },
      },
    ]);

    const made: CodeHostCommitMade = await api.commitFiles({
      project: PROJECT,
      branchName: "oneuptime-ai/fix-1a2b",
      commitMessage: "fix: guard the card",
      files: [
        { filePath: "README.md", content: "# Checkout\n" },
        { filePath: "src/billing/charge.ts", content: "export const é = 1;\n" },
      ],
    });

    expect(made).toEqual({
      commitSha: HEAD,
      htmlUrl: `${HOST}/acme/checkout/-/commit/${HEAD}`,
    });

    // Each file is looked for on the branch it is written to.
    for (const url of host.urlsTo("/repository/files/README.md")) {
      expect(url.searchParams.get("ref")).toBe("oneuptime-ai/fix-1a2b");
    }

    expect(bodyOf(host, 2)).toEqual({
      branch: "oneuptime-ai/fix-1a2b",
      commit_message: "fix: guard the card",
      actions: [
        {
          action: "update",
          file_path: "README.md",
          content: Buffer.from("# Checkout\n", "utf8").toString("base64"),
          encoding: "base64",
        },
        {
          action: "create",
          file_path: "src/billing/charge.ts",
          content: Buffer.from("export const é = 1;\n", "utf8").toString(
            "base64",
          ),
          encoding: "base64",
        },
      ],
    });
  });

  test("a commit GitLab says nothing of is the server not being GitLab's API", async () => {
    const { api } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/repository/commits",
        answer: () => {
          return { status: 201, json: { id: "not-a-sha" } };
        },
      },
    ]);

    await expect(
      api.commitFiles({
        project: PROJECT,
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "" }],
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });

  test("GitLab failing to say whether a file is there stops the commit before it is made", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/files/a.ts",
        answer: () => {
          return { status: 403, json: { message: "403 Forbidden" } };
        },
      },
    ]);

    await expect(
      api.commitFiles({
        project: PROJECT,
        branchName: "b",
        commitMessage: "m",
        files: [{ filePath: "a.ts", content: "x" }],
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Forbidden });
    expect(host.urlsTo("/repository/commits")).toHaveLength(0);
  });
});

describe("GitLabApi: a merge request, ready for review", () => {
  test("from the branch into the default one, its branch kept when it merges", async () => {
    const { api, host } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return {
            status: 201,
            json: {
              id: 90231,
              iid: 12,
              state: "opened",
              web_url: `${HOST}/acme/checkout/-/merge_requests/12`,
            },
          };
        },
      },
    ]);

    const opened: CodeHostOpenedPullRequest = await api.createMergeRequest({
      project: PROJECT,
      sourceBranch: "oneuptime-ai/fix-1a2b",
      targetBranch: "main",
      title: "Guard the card",
      description: "Why.",
    });

    expect(opened).toEqual({
      id: 90231,
      number: 12,
      htmlUrl: `${HOST}/acme/checkout/-/merge_requests/12`,
      state: PullRequestState.Open,
    });
    expect(bodyOf(host, 0)).toEqual({
      source_branch: "oneuptime-ai/fix-1a2b",
      target_branch: "main",
      title: "Guard the card",
      description: "Why.",
      remove_source_branch: false,
    });
  });

  test("one already open for the branch is a conflict (409)", async () => {
    const { api } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return {
            status: 409,
            json: {
              message: [
                "Another open merge request already exists for this source branch: !11",
              ],
            },
          };
        },
      },
    ]);

    await expect(
      api.createMergeRequest({
        project: PROJECT,
        sourceBranch: "b",
        targetBranch: "main",
        title: "t",
        description: "",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Conflict });
  });

  test("an answer with no iid is none it opened; a missing id is its iid", async () => {
    const { api } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return { status: 201, json: { state: "opened" } };
        },
      },
    ]);

    await expect(
      api.createMergeRequest({
        project: PROJECT,
        sourceBranch: "b",
        targetBranch: "main",
        title: "t",
        description: "",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });

    const { api: noId } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return { status: 201, json: { iid: 3, state: "merged" } };
        },
      },
    ]);

    expect(
      await noId.createMergeRequest({
        project: PROJECT,
        sourceBranch: "b",
        targetBranch: "main",
        title: "t",
        description: "",
      }),
    ).toMatchObject({ id: 3, number: 3, state: PullRequestState.Merged });
  });
});

describe("GitLabApi: what a deploy shipped", () => {
  function compareRoute(answers: Record<string, unknown>): FakeRoute {
    return {
      method: "GET",
      path: "/projects/4217/repository/compare",
      answer: (_request: unknown, url: URL) => {
        const key: string = `${url.searchParams.get("from")}..${url.searchParams.get("to")}`;
        return { json: answers[key] || { commits: [], diffs: [] } };
      },
    };
  }

  test("the commits from the last deploy's, newest first, and the files they changed, counted", async () => {
    const { api, host } = gitLab([
      compareRoute({
        [`${BASE}..${HEAD}`]: {
          commit: commit(HEAD, "Merge branch 'fix' into 'main'"),
          commits: [
            commit(
              "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
              "fix: guard the card",
            ),
            commit(
              HEAD,
              "Merge branch 'fix/card' into 'main'\n\nfix: guard the card\n\nSee merge request acme/checkout!12",
            ),
          ],
          diffs: [
            {
              old_path: "src/billing/charge.ts",
              new_path: "src/billing/charge.ts",
              diff: "@@ -1 +1,2 @@\n-a\n+b\n+c\n",
            },
          ],
          compare_timeout: false,
          compare_same_ref: false,
        },
      }),
    ]);

    const range: CodeHostCommitRange = await api.compareCommits({
      project: PROJECT,
      base: BASE,
      head: HEAD,
    });

    expect(range).toEqual({
      status: "ahead",
      totalCommits: 2,
      commits: [
        {
          sha: HEAD,
          message: "Merge branch 'fix/card' into 'main'",
          authorName: "Dana",
          date: "2026-10-30T09:00:00.000Z",
          pullRequestNumbers: [12],
        },
        {
          sha: "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
          message: "fix: guard the card",
          authorName: "Dana",
          date: "2026-10-30T09:00:00.000Z",
          pullRequestNumbers: [],
        },
      ],
      files: [
        {
          path: "src/billing/charge.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
        },
      ],
      isTruncated: false,
    });

    const query: URLSearchParams = host.urlsTo("/repository/compare")[0]!
      .searchParams;

    expect(query.get("from")).toBe(BASE);
    expect(query.get("to")).toBe(HEAD);
  });

  test("a deploy of an older commit than the last is a rollback: none forward, some back", async () => {
    // The last deploy shipped HEAD; this one ships BASE, which is older.
    const { api, host } = gitLab([
      compareRoute({
        [`${BASE}..${HEAD}`]: { commits: [commit(HEAD, "newer")], diffs: [] },
      }),
    ]);

    expect(
      await api.compareCommits({ project: PROJECT, base: HEAD, head: BASE }),
    ).toEqual({
      status: "behind",
      totalCommits: 0,
      commits: [],
      files: [],
      isTruncated: false,
    });
    expect(host.urlsTo("/repository/compare")).toHaveLength(2);
  });

  test("the same commit both ways is identical", async () => {
    const { api } = gitLab([compareRoute({})]);

    expect(
      (await api.compareCommits({ project: PROJECT, base: HEAD, head: HEAD }))
        .status,
    ).toBe("identical");
  });

  test("more commits than a list keeps, or a compare GitLab cut short, says it holds more", async () => {
    const many: Array<unknown> = Array.from(
      { length: CODE_HOST_MAX_COMMITS + 5 },
      (_value: unknown, index: number) => {
        return commit(index.toString(16).padStart(40, "0"), `commit ${index}`);
      },
    );
    const { api } = gitLab([
      compareRoute({
        [`${BASE}..${HEAD}`]: { commits: many, diffs: [] },
        [`${BASE}..${BASE.replace("1a", "1b")}`]: {
          commits: [commit(HEAD, "one")],
          diffs: [],
          compare_timeout: true,
        },
      }),
    ]);

    const long: CodeHostCommitRange = await api.compareCommits({
      project: PROJECT,
      base: BASE,
      head: HEAD,
    });

    expect(long.totalCommits).toBe(CODE_HOST_MAX_COMMITS + 5);
    expect(long.commits).toHaveLength(CODE_HOST_MAX_COMMITS);
    // Newest first: the last GitLab listed.
    expect(long.commits[0]!.message).toBe(
      `commit ${CODE_HOST_MAX_COMMITS + 4}`,
    );
    expect(long.isTruncated).toBe(true);

    expect(
      (
        await api.compareCommits({
          project: PROJECT,
          base: BASE,
          head: BASE.replace("1a", "1b"),
        })
      ).isTruncated,
    ).toBe(true);
  });

  test("a commit GitLab does not have is NotFound, for the caller to fall back", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/compare",
        answer: () => {
          return { status: 404, json: { message: "404 Ref Not Found" } };
        },
      },
    ]);

    await expect(
      api.compareCommits({ project: PROJECT, base: BASE, head: HEAD }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.NotFound });
  });

  test("one commit, and the files it changed, counted from its diff", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: `/projects/4217/repository/commits/${HEAD}`,
        answer: () => {
          return {
            json: commit(HEAD, "fix: guard the card\n\nlonger", {
              stats: { additions: 3, deletions: 1, total: 4 },
            }),
          };
        },
      },
      {
        method: "GET",
        path: `/projects/4217/repository/commits/${HEAD}/diff`,
        answer: () => {
          return {
            json: [
              {
                old_path: "src/a.ts",
                new_path: "src/a.ts",
                diff: "@@ -1 +1,3 @@\n-a\n+b\n+c\n+d\n",
              },
              {
                old_path: "src/gone.ts",
                new_path: "src/gone.ts",
                deleted_file: true,
                diff: "",
              },
            ],
          };
        },
      },
    ]);

    const read: {
      commit: CodeHostCommitSummary;
      files: Array<CodeHostCommitFile>;
    } = await api.getCommit({ project: PROJECT, sha: HEAD });

    expect(read.commit).toMatchObject({
      sha: HEAD,
      message: "fix: guard the card",
      authorName: "Dana",
    });
    expect(read.files).toEqual([
      { path: "src/a.ts", status: "modified", additions: 3, deletions: 1 },
      { path: "src/gone.ts", status: "removed", additions: 0, deletions: 0 },
    ]);
    expect(host.urlsTo("/diff")[0]!.searchParams.get("per_page")).toBe("100");
  });

  test("a commit GitLab answers as no commit is the server not being GitLab's API", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: `/projects/4217/repository/commits/${HEAD}`,
        answer: () => {
          return { json: { id: "nope" } };
        },
      },
    ]);

    await expect(
      api.getCommit({ project: PROJECT, sha: HEAD }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });

  test("the merge requests a commit is in, by their iid", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: `/projects/4217/repository/commits/${HEAD}/merge_requests`,
        answer: () => {
          return {
            json: [
              {
                iid: 12,
                title: "Guard the card",
                author: { username: "dana" },
                merged_at: "2026-10-30T09:30:00.000Z",
                web_url: `${HOST}/acme/checkout/-/merge_requests/12`,
              },
              { iid: 0, title: "not one" },
              "nonsense",
              { iid: 13, title: "Still open", author: null },
            ],
          };
        },
      },
    ]);

    const mergeRequests: Array<CodeHostPullRequestSummary> =
      await api.listMergeRequestsOfCommit({ project: PROJECT, sha: HEAD });

    expect(mergeRequests).toEqual([
      {
        number: 12,
        title: "Guard the card",
        authorLogin: "dana",
        mergedAt: "2026-10-30T09:30:00.000Z",
        url: `${HOST}/acme/checkout/-/merge_requests/12`,
      },
      { number: 13, title: "Still open", url: "" },
    ]);
  });
});

describe("GitLabApi.readMergeRequestNumbers", () => {
  test.each([
    ["See merge request acme/checkout!12", [12]],
    ["See merge request acme/backend/checkout!482", [482]],
    ["Merge branch 'a' into 'main'\n\nSee merge request !7", [7]],
    ["See Merge Request acme/x!3\nSee merge request acme/x!3", [3]],
    ["see merge request acme/x!3 and more", [3]],
    ["fix: guard the card (#12)", []],
    ["See merge request acme/x!", []],
    ["See merge request acme/x!12a", []],
    ["See merge request acme/x!1234567890", []],
    ["", []],
  ] as Array<[string, Array<number>]>)(
    "%j names %j",
    (message: string, numbers: Array<number>) => {
      expect(GitLabApi.readMergeRequestNumbers(message)).toEqual(numbers);
    },
  );

  /*
   * A commit message is whoever committed's text: 400,000 characters of the
   * worst it can be - one line of markers - read in time in line with it.
   */
  test("a message of 400,000 characters is read in time in line with it", () => {
    const message: string = "merge request ".repeat(30000);

    const timed: FastestRun<Array<number>> = fastestRun({
      run: (): Array<number> => {
        return GitLabApi.readMergeRequestNumbers(message);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result).toEqual([]);
  });
});
