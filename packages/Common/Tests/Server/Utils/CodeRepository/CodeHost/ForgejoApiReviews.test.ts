import { describe, expect, test } from "@jest/globals";
import ForgejoApi, {
  MAX_DIFF_LINES_READ,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import { CodeHostHttpErrorKind } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CodeHostChangedFiles,
  CodeHostComment,
  CodeHostPullRequestDetails,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import { FakeCodeHost, FakeRoute, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * What a production review reads of a Forgejo or Gitea pull request, and
 * the one comment it keeps on it - against their API (v1) as its docs say
 * it answers: the pull request (open, a draft - or a work in progress on a
 * server older than `draft` - from a fork, or pushed with AGit, which is
 * no branch of the repository), its files from its .diff (or, for a diff
 * too large, the file list alone), the repository's visibility, the open
 * pull requests that changed lately, a user's permission (told only to an
 * administrator), and the comment, written and edited. The same answers
 * were read from a real Forgejo 9 and Gitea 1.22 (ForgejoApiReviewsWrites-
 * AgainstServer).
 */

const TOKEN: string = "0123456789abcdef0123456789abcdef01234567";
const HOST: string = "https://codeberg.org";
const API: string = `${HOST}/api/v1`;
const OWNER: string = "acme";
const NAME: string = "checkout";

function pullRequest(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 4,
    number: 12,
    title: "fix: guard the card before charging",
    state: "open",
    merged: false,
    draft: false,
    html_url: `${HOST}/acme/checkout/pulls/12`,
    user: { id: 77, login: "dana" },
    head: {
      ref: "fix/card",
      sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      repo: { id: 5, full_name: "acme/checkout" },
    },
    base: { ref: "main", repo: { id: 5, full_name: "acme/checkout" } },
    changed_files: 3,
    additions: 10,
    deletions: 2,
    updated_at: "2026-10-30T09:58:00Z",
    ...overrides,
  };
}

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
      providerName: "Forgejo",
    }),
    host,
  };
}

describe("ForgejoApi: a pull request, as a production review reads it", () => {
  test("its title, state, head, branches, author and what it changes", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12",
        answer: () => {
          return { json: pullRequest() };
        },
      },
    ]);

    expect(
      await api.getPullRequest({ owner: OWNER, name: NAME, number: 12 }),
    ).toEqual({
      number: 12,
      title: "fix: guard the card before charging",
      isOpen: true,
      isMerged: false,
      isDraft: false,
      htmlUrl: `${HOST}/acme/checkout/pulls/12`,
      authorLogin: "dana",
      authorId: "77",
      headSha: "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766",
      headRefName: "fix/card",
      baseRefName: "main",
      isFromFork: false,
      changedFilesCount: 3,
      changedLineCount: 12,
      updatedAt: "2026-10-30T09:58:00Z",
    });
    expect(host.requests[0]!.headers["Authorization"]).toBe(`token ${TOKEN}`);
    expect(host.requests[0]!.url).not.toContain(TOKEN);
  });

  test.each([
    ["a draft", { draft: true }, { isDraft: true }],
    [
      "a work in progress on a server older than `draft`",
      { draft: undefined, title: "WIP: guard the card" },
      { isDraft: true },
    ],
    ["a [WIP] in any case", { title: "  [wip] guard" }, { isDraft: true }],
    [
      "merged",
      { state: "closed", merged: true },
      { isOpen: false, isMerged: true },
    ],
    ["closed", { state: "closed" }, { isOpen: false, isMerged: false }],
    [
      "from a fork",
      { head: { ref: "fix", sha: "0f1e2d3", repo: { id: 99 } } },
      { isFromFork: true },
    ],
    [
      "from a fork that is gone",
      { head: { ref: "fix", sha: "0f1e2d3", repo: null } },
      { isFromFork: true },
    ],
    [
      "pushed with AGit (refs/for/main): no branch of the repository",
      {
        head: {
          ref: "refs/pull/12/head",
          sha: "0f1e2d3",
          repo: { id: 5 },
        },
      },
      { isFromFork: true },
    ],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)(
    "%s",
    (
      _what: string,
      overrides: Record<string, unknown>,
      expected: Record<string, unknown>,
    ) => {
      expect(ForgejoApi.readPullRequest(pullRequest(overrides))).toMatchObject(
        expected,
      );
    },
  );

  test("a branch head is a branch; a server ref is not", () => {
    expect(ForgejoApi.isBranchHead("fix/card")).toBe(true);
    expect(ForgejoApi.isBranchHead("refs/pull/12/head")).toBe(false);
    expect(ForgejoApi.isBranchHead("")).toBe(false);
  });

  test("an answer that is no pull request is none", async () => {
    expect(ForgejoApi.readPullRequest(null)).toBeNull();
    expect(ForgejoApi.readPullRequest(pullRequest({ number: -1 }))).toBeNull();

    const { api } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12",
        answer: () => {
          return { json: { message: "ok" } };
        },
      },
    ]);

    await expect(
      api.getPullRequest({ owner: OWNER, name: NAME, number: 12 }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.BadResponse });
  });
});

describe("ForgejoApi: a pull request's files, with their diff", () => {
  const DIFF: string = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "diff --git a/src/b.ts b/src/b.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.ts",
    "@@ -0,0 +1 @@",
    "+x",
  ].join("\n");

  test("read from the pull request's .diff, file by file, as text", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12.diff",
        answer: () => {
          return { text: DIFF };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listPullRequestFiles({
      owner: OWNER,
      name: NAME,
      number: 12,
      maxFiles: 300,
      changedLineCount: 3,
    });

    expect(
      files.files.map((file: { filename: string; status: string }) => {
        return `${file.status} ${file.filename}`;
      }),
    ).toEqual(["modified src/a.ts", "added src/b.ts"]);
    expect(files.files[0]!.patch).toBe("@@ -1 +1 @@\n-a\n+b");
    expect(host.requests[0]!.headers["Accept"]).toBe("text/plain");
  });

  test("a diff too large to read is read as its file list alone: which files, none of their lines", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12/files",
        answer: (_request: unknown, url: URL) => {
          return {
            json:
              url.searchParams.get("page") === "1"
                ? [
                    {
                      filename: "src/a.ts",
                      status: "changed",
                      additions: 4,
                      deletions: 1,
                    },
                    {
                      filename: "src/gone.ts",
                      status: "deleted",
                      additions: 0,
                      deletions: 9,
                    },
                    {
                      filename: "src/new-name.ts",
                      previous_filename: "src/old-name.ts",
                      status: "renamed",
                    },
                    { status: "added" },
                  ]
                : [],
          };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listPullRequestFiles({
      owner: OWNER,
      name: NAME,
      number: 12,
      maxFiles: 300,
      changedLineCount: MAX_DIFF_LINES_READ + 1,
    });

    expect(host.urlsTo(".diff")).toHaveLength(0);
    expect(files).toEqual({
      files: [
        {
          filename: "src/a.ts",
          previousFilename: null,
          status: "modified",
          additions: 4,
          deletions: 1,
          patch: null,
        },
        {
          filename: "src/gone.ts",
          previousFilename: null,
          status: "removed",
          additions: 0,
          deletions: 9,
          patch: null,
        },
        {
          filename: "src/new-name.ts",
          previousFilename: "src/old-name.ts",
          status: "renamed",
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
      hasMore: false,
    });
  });

  test("a .diff the server will not give is read as the file list; a refused token is thrown", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12.diff",
        answer: () => {
          return { status: 500, text: "too large" };
        },
      },
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12/files",
        answer: () => {
          return { json: [{ filename: "a.ts", status: "added" }] };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listPullRequestFiles({
      owner: OWNER,
      name: NAME,
      number: 12,
      maxFiles: 300,
    });

    expect(files.files).toHaveLength(1);
    expect(host.urlsTo("/files")).toHaveLength(1);

    const { api: refused } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12.diff",
        answer: () => {
          return { status: 401, json: { message: "token is required" } };
        },
      },
    ]);

    await expect(
      refused.listPullRequestFiles({
        owner: OWNER,
        name: NAME,
        number: 12,
        maxFiles: 300,
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unauthorized });
  });

  test("the file list is read a page at a time, as far as asked", async () => {
    const page: Array<unknown> = Array.from(
      { length: 50 },
      (_value: unknown, index: number) => {
        return { filename: `f${index}.ts`, status: "modified" };
      },
    );
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls/12/files",
        answer: () => {
          return { json: page };
        },
      },
    ]);

    const files: CodeHostChangedFiles = await api.listPullRequestFiles({
      owner: OWNER,
      name: NAME,
      number: 12,
      maxFiles: 60,
      changedLineCount: MAX_DIFF_LINES_READ * 2,
    });

    expect(files.files).toHaveLength(60);
    expect(files.hasMore).toBe(true);
    expect(host.urlsTo("/files")).toHaveLength(2);
  });
});

describe("ForgejoApi: the repository's visibility", () => {
  function repository(fields: Record<string, unknown>): ForgejoApi {
    return forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout",
        answer: () => {
          return { json: { id: 5, name: NAME, ...fields } };
        },
      },
    ]).api;
  }

  test.each([
    [
      "public, of a public owner",
      { private: false, owner: { visibility: "public" } },
      true,
    ],
    ["public, of an owner with no visibility said", { private: false }, true],
    ["private", { private: true }, false],
    [
      "internal (signed-in users only)",
      { private: false, internal: true },
      false,
    ],
    [
      "of a limited organization",
      { private: false, owner: { visibility: "limited" } },
      false,
    ],
    [
      "of a private organization",
      { private: false, owner: { visibility: "private" } },
      false,
    ],
    ["saying nothing of it", {}, null],
  ] as Array<[string, Record<string, unknown>, boolean | null]>)(
    "a repository %s",
    async (
      _what: string,
      fields: Record<string, unknown>,
      expected: boolean | null,
    ) => {
      expect(await repository(fields).isRepositoryPublic(OWNER, NAME)).toBe(
        expected,
      );
    },
  );

  test("a server that could not be asked says nothing (null)", async () => {
    const { api } = forgejo([]);

    expect(await api.isRepositoryPublic(OWNER, NAME)).toBeNull();
  });
});

describe("ForgejoApi: the open pull requests that changed lately", () => {
  test("newest first, stopping at the first that changed before the time", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return {
            json: [
              pullRequest({ number: 14, updated_at: "2026-10-30T10:00:00Z" }),
              { nonsense: true },
              pullRequest({ number: 12, updated_at: "2026-10-30T09:30:00Z" }),
              pullRequest({ number: 9, updated_at: "2026-10-30T08:00:00Z" }),
              pullRequest({ number: 3, updated_at: "2026-10-30T09:59:00Z" }),
            ],
          };
        },
      },
    ]);

    const listed: Array<CodeHostPullRequestDetails> =
      await api.listUpdatedPullRequests({
        owner: OWNER,
        name: NAME,
        updatedAfter: new Date("2026-10-30T09:00:00Z"),
        maxPages: 3,
      });

    expect(
      listed.map((item: CodeHostPullRequestDetails) => {
        return item.number;
      }),
    ).toEqual([14, 12]);

    const query: URLSearchParams = host.urlsTo("/pulls")[0]!.searchParams;

    expect(Object.fromEntries(query.entries())).toEqual({
      state: "open",
      sort: "recentupdate",
      page: "1",
      limit: "50",
    });
  });

  test("full pages are read on, as far as the pages asked", async () => {
    const page: Array<unknown> = Array.from(
      { length: 50 },
      (_value: unknown, index: number) => {
        return pullRequest({
          number: index + 1,
          updated_at: "2026-10-30T10:00:00Z",
        });
      },
    );
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/pulls",
        answer: () => {
          return { json: page };
        },
      },
    ]);

    const listed: Array<CodeHostPullRequestDetails> =
      await api.listUpdatedPullRequests({
        owner: OWNER,
        name: NAME,
        updatedAfter: new Date("2026-10-30T09:00:00Z"),
        maxPages: 2,
      });

    expect(listed).toHaveLength(100);
    expect(host.urlsTo("/pulls")).toHaveLength(2);
  });
});

describe("ForgejoApi: who may write", () => {
  function permission(answer: { status?: number; json?: unknown }): ForgejoApi {
    return forgejo([
      {
        method: "GET",
        path: "/repos/acme/checkout/collaborators/dana/permission",
        answer: () => {
          return answer;
        },
      },
    ]).api;
  }

  test.each([
    ["owner", true],
    ["admin", true],
    ["write", true],
    ["WRITE", true],
    ["read", false],
    ["none", false],
    ["", false],
  ])("%s may push: %s", (value: string, canPush: boolean) => {
    expect(ForgejoApi.canPush(value)).toBe(canPush);
  });

  test("the permission the server tells an administrator", async () => {
    expect(
      await permission({
        json: { permission: "Write", role_name: "write" },
      }).getUserPermission({
        owner: OWNER,
        name: NAME,
        login: "dana",
      }),
    ).toBe("write");
  });

  test("a user the server does not know, or saying nothing: none", async () => {
    expect(
      await permission({
        status: 404,
        json: { message: "user not found" },
      }).getUserPermission({
        owner: OWNER,
        name: NAME,
        login: "dana",
      }),
    ).toBe("none");
    expect(
      await permission({ json: {} }).getUserPermission({
        owner: OWNER,
        name: NAME,
        login: "dana",
      }),
    ).toBe("none");
    expect(
      await permission({ json: {} }).getUserPermission({
        owner: OWNER,
        name: NAME,
        login: "",
      }),
    ).toBe("none");
  });

  test("a token that only writes is not told (403): null, never a guess", async () => {
    expect(
      await permission({
        status: 403,
        json: { message: "forbidden" },
      }).getUserPermission({
        owner: OWNER,
        name: NAME,
        login: "dana",
      }),
    ).toBeNull();
  });

  test("a login is one path segment", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: /^\/repos\/acme\/checkout\/collaborators\/.+\/permission$/,
        answer: () => {
          return { json: { permission: "read" } };
        },
      },
    ]);

    await api.getUserPermission({ owner: OWNER, name: NAME, login: "a/b" });

    expect(host.requests[0]!.url).toBe(
      `${API}/repos/acme/checkout/collaborators/a%2Fb/permission`,
    );
  });
});

describe("ForgejoApi: the review's comment on the pull request", () => {
  test("written on the pull request's issue, then edited in place with PATCH", async () => {
    const { api, host } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/issues/12/comments",
        answer: () => {
          return {
            status: 201,
            json: {
              id: 41,
              html_url: `${HOST}/acme/checkout/pulls/12#issuecomment-41`,
            },
          };
        },
      },
      {
        method: "PATCH",
        path: "/repos/acme/checkout/issues/comments/41",
        answer: () => {
          return {
            json: {
              id: 41,
              html_url: `${HOST}/acme/checkout/pulls/12#issuecomment-41`,
            },
          };
        },
      },
    ]);

    const written: CodeHostComment = await api.createIssueComment({
      owner: OWNER,
      name: NAME,
      number: 12,
      body: "Review",
    });
    const edited: CodeHostComment = await api.updateIssueComment({
      owner: OWNER,
      name: NAME,
      commentId: 41,
      body: "Again",
    });

    expect(written).toEqual({
      commentId: 41,
      htmlUrl: `${HOST}/acme/checkout/pulls/12#issuecomment-41`,
    });
    expect(edited.commentId).toBe(41);
    expect(JSON.parse(host.requests[0]!.body!)).toEqual({ body: "Review" });
    expect(JSON.parse(host.requests[1]!.body!)).toEqual({ body: "Again" });
  });

  test("a token without write access to issues is refused (403)", async () => {
    const { api } = forgejo([
      {
        method: "POST",
        path: "/repos/acme/checkout/issues/12/comments",
        answer: () => {
          return {
            status: 403,
            json: {
              message:
                "token does not have at least one of required scope(s): [write:issue]",
            },
          };
        },
      },
    ]);

    await expect(
      api.createIssueComment({
        owner: OWNER,
        name: NAME,
        number: 12,
        body: "Review",
      }),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Forbidden });
  });

  test("a comment with no id is none written", () => {
    expect(() => {
      return ForgejoApi.readComment({ html_url: "x" });
    }).toThrow();
    expect(ForgejoApi.readComment({ id: 7 })).toEqual({
      commentId: 7,
      htmlUrl: "",
    });
  });
});
