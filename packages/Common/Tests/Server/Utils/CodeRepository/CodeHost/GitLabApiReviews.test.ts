import { describe, expect, test } from "@jest/globals";
import GitLabApi from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CodeHostChangedFiles,
  CodeHostComment,
  CodeHostPullRequestDetails,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import { FakeCodeHost, FakeRoute, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * What a production review reads of a GitLab merge request, and the one
 * note it keeps on it - against GitLab's API (v4) as its docs say it
 * answers: the merge request (open, a draft, from a fork, its head and who
 * opened it), its files with their diff (/diffs, and /changes on a GitLab
 * older than 15.7), the project's visibility, the open merge requests that
 * changed lately, a member's role, and the note, written and edited.
 */

const TOKEN: string = "glpat-0123456789abcdefghij";
const HOST: string = "https://gitlab.example.com";
const API: string = `${HOST}/api/v4`;
const PROJECT: string = "4217";
const MERGE_REQUEST_URL: string = `${HOST}/acme/backend/checkout/-/merge_requests/12`;

function mergeRequest(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 90231,
    iid: 12,
    project_id: 4217,
    title: "fix: guard the card before charging",
    state: "opened",
    draft: false,
    work_in_progress: false,
    web_url: MERGE_REQUEST_URL,
    author: { id: 77, username: "dana", name: "Dana" },
    sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
    source_branch: "fix/card",
    target_branch: "main",
    source_project_id: 4217,
    target_project_id: 4217,
    changes_count: "3",
    updated_at: "2026-10-30T09:58:00.000Z",
    ...overrides,
  };
}

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

describe("GitLabApi: a merge request, as a production review reads it", () => {
  test("its title, state, head, branches, author and how many files it changes", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12",
        answer: () => {
          return { json: mergeRequest() };
        },
      },
    ]);

    const read: CodeHostPullRequestDetails = await api.getMergeRequest({
      project: PROJECT,
      iid: 12,
    });

    expect(read).toEqual({
      number: 12,
      title: "fix: guard the card before charging",
      isOpen: true,
      isMerged: false,
      isDraft: false,
      htmlUrl: MERGE_REQUEST_URL,
      authorLogin: "dana",
      authorId: "77",
      headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      headRefName: "fix/card",
      baseRefName: "main",
      isFromFork: false,
      changedFilesCount: 3,
      changedLineCount: 0,
      updatedAt: "2026-10-30T09:58:00.000Z",
    });
    expect(host.requests[0]!.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
    expect(host.requests[0]!.url).not.toContain(TOKEN);
  });

  test.each([
    ["a draft", { draft: true }, { isDraft: true }],
    [
      "an old GitLab's work in progress",
      { work_in_progress: true },
      { isDraft: true },
    ],
    [
      "a locked discussion is still open",
      { state: "locked" },
      { isOpen: true },
    ],
    ["merged", { state: "merged" }, { isOpen: false, isMerged: true }],
    ["closed", { state: "closed" }, { isOpen: false, isMerged: false }],
    [
      "from a fork",
      { source_project_id: 999, target_project_id: 4217 },
      { isFromFork: true },
    ],
    [
      "from a project GitLab no longer names",
      { source_project_id: null },
      { isFromFork: true },
    ],
    [
      "past what GitLab counts (1000+)",
      { changes_count: "1000+" },
      { changedFilesCount: 1000 },
    ],
    ["with no count", { changes_count: null }, { changedFilesCount: 0 }],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)(
    "%s",
    (
      _what: string,
      overrides: Record<string, unknown>,
      expected: Record<string, unknown>,
    ) => {
      expect(GitLabApi.readMergeRequest(mergeRequest(overrides))).toMatchObject(
        expected,
      );
    },
  );

  test("an answer that is no merge request is none - and getMergeRequest says the server is not GitLab's API", async () => {
    expect(GitLabApi.readMergeRequest(null)).toBeNull();
    expect(GitLabApi.readMergeRequest([mergeRequest()])).toBeNull();
    expect(GitLabApi.readMergeRequest(mergeRequest({ iid: 0 }))).toBeNull();
    expect(GitLabApi.readMergeRequest(mergeRequest({ iid: "x" }))).toBeNull();

    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12",
        answer: () => {
          return { json: { message: "ok" } };
        },
      },
    ]);

    await expect(
      api.getMergeRequest({ project: PROJECT, iid: 12 }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });

  test("a merge request GitLab does not know is NotFound", async () => {
    const { api } = gitLab([]);

    await expect(
      api.getMergeRequest({ project: PROJECT, iid: 404 }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.NotFound });
  });

  test("a project read by its path is encoded as one segment", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/acme%2Fbackend%2Fcheckout/merge_requests/12",
        answer: () => {
          return { json: mergeRequest() };
        },
      },
    ]);

    await api.getMergeRequest({ project: "acme/backend/checkout", iid: 12 });

    expect(host.requests[0]!.url).toBe(
      `${API}/projects/acme%2Fbackend%2Fcheckout/merge_requests/12`,
    );
  });
});

describe("GitLabApi: a merge request's files, with their diff", () => {
  function diff(
    path: string,
    overrides: Record<string, unknown> = {},
  ): unknown {
    return {
      old_path: path,
      new_path: path,
      new_file: false,
      renamed_file: false,
      deleted_file: false,
      diff: "@@ -1,2 +1,3 @@\n-a\n+b\n+c\n d\n",
      ...overrides,
    };
  }

  test("read page by page (x-next-page), as far as asked, each counted", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12/diffs",
        answer: (_request: unknown, url: URL) => {
          return url.searchParams.get("page") === "1"
            ? {
                json: [diff("src/a.ts"), diff("src/b.ts")],
                headers: { "x-next-page": "2" },
              }
            : {
                json: [
                  diff("src/c.ts", {
                    new_file: true,
                    diff: "@@ -0,0 +1 @@\n+x\n",
                  }),
                ],
                headers: { "x-next-page": "" },
              };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listMergeRequestFiles({
      project: PROJECT,
      iid: 12,
      maxFiles: 300,
    });

    expect(files.hasMore).toBe(false);
    expect(files.files).toEqual([
      {
        filename: "src/a.ts",
        previousFilename: null,
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,2 +1,3 @@\n-a\n+b\n+c\n d",
      },
      {
        filename: "src/b.ts",
        previousFilename: null,
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,2 +1,3 @@\n-a\n+b\n+c\n d",
      },
      {
        filename: "src/c.ts",
        previousFilename: null,
        status: "added",
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+x",
      },
    ]);

    const query: URLSearchParams = host.urlsTo("/diffs")[0]!.searchParams;

    expect(query.get("per_page")).toBe("100");
  });

  test("stops at as many files as asked, and says there are more", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12/diffs",
        answer: () => {
          return {
            json: [diff("a"), diff("b"), diff("c")],
            headers: { "x-next-page": "2" },
          };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listMergeRequestFiles({
      project: PROJECT,
      iid: 12,
      maxFiles: 2,
    });

    expect(
      files.files.map((file: { filename: string }) => {
        return file.filename;
      }),
    ).toEqual(["a", "b"]);
    expect(files.hasMore).toBe(true);
  });

  test("a GitLab older than 15.7 (no /diffs) is read through /changes, and its overflow is more", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12/changes",
        answer: () => {
          return {
            json: {
              ...(mergeRequest() as Record<string, unknown>),
              changes: [
                diff("src/old.ts", {
                  deleted_file: true,
                  diff: "@@ -1 +0,0 @@\n-x\n",
                }),
                diff("src/b.ts", {
                  old_path: "src/a.ts",
                  renamed_file: true,
                }),
              ],
              overflow: true,
            },
          };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listMergeRequestFiles({
      project: PROJECT,
      iid: 12,
      maxFiles: 300,
    });

    expect(host.urlsTo("/diffs")).toHaveLength(1);
    expect(
      files.files.map((file: { filename: string; status: string }) => {
        return `${file.status} ${file.filename}`;
      }),
    ).toEqual(["removed src/old.ts", "renamed src/b.ts"]);
    expect(files.files[1]!.previousFilename).toBe("src/a.ts");
    expect(files.hasMore).toBe(true);
  });

  test("a file whose diff GitLab left out (too large) has no patch, and an entry that is no file is skipped", () => {
    expect(
      GitLabApi.readDiff(diff("big.json", { too_large: true })),
    ).toMatchObject({ filename: "big.json", patch: null });
    expect(GitLabApi.readDiff(diff("empty.txt", { diff: "" }))).toMatchObject({
      filename: "empty.txt",
      patch: null,
      additions: 0,
      deletions: 0,
    });
    expect(GitLabApi.readDiff({ old_path: "", new_path: "" })).toBeNull();
    expect(GitLabApi.readDiff("nonsense")).toBeNull();
  });

  test("GitLab's count of files reads 1000+ as that many", () => {
    expect(GitLabApi.readChangesCount("12")).toBe(12);
    expect(GitLabApi.readChangesCount(7)).toBe(7);
    expect(GitLabApi.readChangesCount("1000+")).toBe(1000);
    expect(GitLabApi.readChangesCount("")).toBe(0);
    expect(GitLabApi.readChangesCount("many")).toBe(0);
    expect(GitLabApi.readChangesCount(-3)).toBe(0);
  });
});

describe("GitLabApi: the project's visibility", () => {
  test.each([
    ["public", true],
    ["internal", false],
    ["private", false],
    ["something new", null],
  ] as Array<[string, boolean | null]>)(
    "a project that is %s",
    async (visibility: string, expected: boolean | null) => {
      const { api } = gitLab([
        {
          method: "GET",
          path: "/projects/4217",
          answer: () => {
            return { json: { id: 4217, visibility } };
          },
        },
      ]);

      expect(await api.isProjectPublic(PROJECT)).toBe(expected);
    },
  );

  test("a project GitLab could not be asked about says nothing (null), never private", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217",
        answer: () => {
          return { status: 500, json: { message: "boom" } };
        },
      },
    ]);

    expect(await api.isProjectPublic(PROJECT)).toBeNull();
  });
});

describe("GitLabApi: the open merge requests that changed lately", () => {
  test("asks for the open ones changed after the time, least recently changed first", async () => {
    const after: Date = new Date("2026-10-30T09:00:00.000Z");
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return {
            json: [
              mergeRequest({ iid: 12 }),
              { nonsense: true },
              mergeRequest({ iid: 14, title: "feat: retries" }),
            ],
          };
        },
      },
    ]);

    const listed: Array<CodeHostPullRequestDetails> =
      await api.listUpdatedMergeRequests({
        project: PROJECT,
        updatedAfter: after,
        limit: 100,
      });

    expect(
      listed.map((item: CodeHostPullRequestDetails) => {
        return item.number;
      }),
    ).toEqual([12, 14]);

    const query: URLSearchParams =
      host.urlsTo("/merge_requests")[0]!.searchParams;

    expect(Object.fromEntries(query.entries())).toEqual({
      state: "opened",
      updated_after: "2026-10-30T09:00:00.000Z",
      order_by: "updated_at",
      sort: "asc",
      per_page: "100",
      page: "1",
    });
  });

  test("a page is never more than GitLab's largest", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests",
        answer: () => {
          return { json: [] };
        },
      },
    ]);

    await api.listUpdatedMergeRequests({
      project: PROJECT,
      updatedAfter: new Date(),
      limit: 5000,
    });
    await api.listUpdatedMergeRequests({
      project: PROJECT,
      updatedAfter: new Date(),
      limit: 0,
    });

    expect(
      host.urlsTo("/merge_requests").map((url: URL) => {
        return url.searchParams.get("per_page");
      }),
    ).toEqual(["100", "1"]);
  });
});

describe("GitLabApi: who may push", () => {
  function member(answer: { status?: number; json?: unknown }): {
    api: GitLabApi;
    host: FakeCodeHost;
  } {
    return gitLab([
      {
        method: "GET",
        path: "/projects/4217/members/all/77",
        answer: () => {
          return answer;
        },
      },
    ]);
  }

  test("a member's role, their own or a group's (members/all)", async () => {
    const { api, host } = member({
      json: { id: 77, username: "dana", access_level: 30, state: "active" },
    });

    const level: number = await api.getMemberAccessLevel({
      project: PROJECT,
      userId: "77",
    });

    expect(level).toBe(30);
    expect(GitLabApi.canPush(level)).toBe(true);
    expect(host.requests[0]!.url).toBe(`${API}/projects/4217/members/all/77`);
  });

  test.each([
    [10, false],
    [20, false],
    [30, true],
    [40, true],
    [50, true],
    [-1, false],
  ])("a role of %i may push: %s", (level: number, canPush: boolean) => {
    expect(GitLabApi.canPush(level)).toBe(canPush);
  });

  test("not a member, a blocked or not yet accepted membership, or no user id: no role", async () => {
    expect(
      await member({
        status: 404,
        json: { message: "404 Not found" },
      }).api.getMemberAccessLevel({
        project: PROJECT,
        userId: "77",
      }),
    ).toBe(-1);

    expect(
      await member({
        json: { id: 77, access_level: 40, state: "blocked" },
      }).api.getMemberAccessLevel({ project: PROJECT, userId: "77" }),
    ).toBe(-1);

    expect(
      await member({
        json: { id: 77, access_level: 40, state: "awaiting" },
      }).api.getMemberAccessLevel({ project: PROJECT, userId: "77" }),
    ).toBe(-1);

    const { api, host } = member({ json: {} });

    expect(
      await api.getMemberAccessLevel({ project: PROJECT, userId: "" }),
    ).toBe(-1);
    expect(
      await api.getMemberAccessLevel({ project: PROJECT, userId: "x/../1" }),
    ).toBe(-1);
    expect(host.requests).toHaveLength(0);
  });

  test("GitLab failing is thrown, never read as a role", async () => {
    await expect(
      member({
        status: 500,
        json: { message: "boom" },
      }).api.getMemberAccessLevel({ project: PROJECT, userId: "77" }),
    ).rejects.toBeInstanceOf(CodeHostHttpError);
  });
});

describe("GitLabApi: the review's note on the merge request", () => {
  test("is written as the token's account, and its address is the merge request's #note", async () => {
    const { api, host } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests/12/notes",
        answer: () => {
          return { status: 201, json: { id: 5150, body: "Review" } };
        },
      },
    ]);

    const written: CodeHostComment = await api.createMergeRequestNote({
      project: PROJECT,
      iid: 12,
      body: "Review",
      mergeRequestUrl: MERGE_REQUEST_URL,
    });

    expect(written).toEqual({
      commentId: 5150,
      htmlUrl: `${MERGE_REQUEST_URL}#note_5150`,
    });
    expect(JSON.parse(host.requests[0]!.body!)).toEqual({ body: "Review" });
  });

  test("is edited in place with PUT", async () => {
    const { api, host } = gitLab([
      {
        method: "PUT",
        path: "/projects/4217/merge_requests/12/notes/5150",
        answer: () => {
          return { json: { id: 5150, body: "Again" } };
        },
      },
    ]);

    const edited: CodeHostComment = await api.updateMergeRequestNote({
      project: PROJECT,
      iid: 12,
      noteId: 5150,
      body: "Again",
      mergeRequestUrl: `${MERGE_REQUEST_URL}/`,
    });

    expect(edited.htmlUrl).toBe(`${MERGE_REQUEST_URL}#note_5150`);
    expect(host.requests[0]!.method).toBe("PUT");
  });

  test("a locked discussion refuses the token (403), said as GitLab's refusal", async () => {
    const { api } = gitLab([
      {
        method: "POST",
        path: "/projects/4217/merge_requests/12/notes",
        answer: () => {
          return { status: 403, json: { message: "403 Forbidden" } };
        },
      },
    ]);

    await expect(
      api.createMergeRequestNote({
        project: PROJECT,
        iid: 12,
        body: "Review",
        mergeRequestUrl: MERGE_REQUEST_URL,
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Forbidden });
  });

  test("an answer with no note id is the server not being GitLab's API", () => {
    expect(() => {
      return GitLabApi.readNote({ body: "x" }, MERGE_REQUEST_URL);
    }).toThrow(CodeHostHttpError);
    expect(GitLabApi.readNote({ id: 3 }, "")).toEqual({
      commentId: 3,
      htmlUrl: "",
    });
  });
});
