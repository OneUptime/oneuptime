import { describe, expect, test } from "@jest/globals";
import GitLabApi from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CodeHostBranchNames,
  CodeHostFileContent,
  CodeHostRepository,
  CodeHostRepositoryPage,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import FixPullRequestCiStatus from "../../../../../Types/AI/FixPullRequestCiStatus";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { FakeCodeHost, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * GitLabApi against GitLab's API as its docs say it answers (v4): the
 * token in PRIVATE-TOKEN and nowhere else, the projects a Developer or
 * more can push to, branches by prefix, a keyset-paged tree, a file, a
 * merge request's state and pipeline, whether one commit contains
 * another, and errors in words a person acts on - never with the token.
 */

const TOKEN: string = "glpat-0123456789abcdefghij";
const HOST: string = "https://gitlab.example.com";
const API: string = `${HOST}/api/v4`;

function project(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 4217,
    path: "checkout",
    path_with_namespace: "acme/backend/checkout",
    namespace: { full_path: "acme/backend" },
    description: "The checkout service",
    default_branch: "main",
    web_url: `${HOST}/acme/backend/checkout`,
    http_url_to_repo: `${HOST}/acme/backend/checkout.git`,
    visibility: "private",
    archived: false,
    permissions: { project_access: { access_level: 30 }, group_access: null },
    ...overrides,
  };
}

function gitLab(routes: Parameters<typeof fakeCodeHost>[0]["routes"]): {
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

describe("GitLabApi", () => {
  test("says who the token is, sending it in PRIVATE-TOKEN only", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/user",
        answer: () => {
          return { json: { id: 7, username: "alice", name: "Alice Smith" } };
        },
      },
    ]);

    await expect(api.getAccount()).resolves.toEqual({
      id: "7",
      login: "alice",
      name: "Alice Smith",
    });
    expect(host.requests[0]!.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
    expect(host.requests[0]!.url).toBe(`${API}/user`);
    expect(host.requests[0]!.url).not.toContain(TOKEN);
  });

  test("lists the projects a Developer or more can push to, newest activity first, paged by x-next-page", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects",
        answer: (_request: unknown, url: URL) => {
          return url.searchParams.get("page") === "1"
            ? {
                json: [
                  project(),
                  project({
                    id: 9,
                    path: "docs",
                    path_with_namespace: "acme/docs",
                    namespace: { full_path: "acme" },
                    visibility: "public",
                    permissions: {
                      project_access: null,
                      group_access: { access_level: 20 },
                    },
                  }),
                  project({ id: 10, archived: true }),
                  { nonsense: true },
                ],
                headers: { "x-next-page": "2" },
              }
            : { json: [], headers: { "x-next-page": "" } };
        },
      },
    ]);

    const page: CodeHostRepositoryPage = await api.listRepositories({
      page: 1,
    });
    const query: URLSearchParams = host.urlsTo("/projects")[0]!.searchParams;

    expect(query.get("membership")).toBe("true");
    expect(query.get("min_access_level")).toBe("30");
    expect(query.get("archived")).toBe("false");
    expect(query.get("order_by")).toBe("last_activity_at");
    expect(query.get("per_page")).toBe("100");
    expect(page.hasMore).toBe(true);
    expect(page.repositories).toHaveLength(3);

    const checkout: CodeHostRepository = page.repositories[0]!;

    expect(checkout).toEqual({
      id: "4217",
      name: "checkout",
      ownerPath: "acme/backend",
      fullName: "acme/backend/checkout",
      description: "The checkout service",
      defaultBranch: "main",
      webUrl: `${HOST}/acme/backend/checkout`,
      cloneUrl: `${HOST}/acme/backend/checkout.git`,
      isPrivate: true,
      canPush: true,
    });
    // A Reporter cannot push; an archived project cannot either.
    expect(page.repositories[1]!.canPush).toBe(false);
    expect(page.repositories[1]!.isPrivate).toBe(false);
    expect(page.repositories[2]!.canPush).toBe(false);

    const last: CodeHostRepositoryPage = await api.listRepositories({
      page: 2,
    });

    expect(last.hasMore).toBe(false);
  });

  test("searches projects by name and group when asked", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects",
        answer: () => {
          return { json: [project()] };
        },
      },
    ]);

    await api.listRepositories({ page: 1, search: "check" });

    const query: URLSearchParams = host.urlsTo("/projects")[0]!.searchParams;

    expect(query.get("search")).toBe("check");
    expect(query.get("search_namespaces")).toBe("true");
  });

  test("reads a project by its id, and by its path", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: /^\/projects\/[^/]+$/,
        answer: () => {
          return { json: project() };
        },
      },
    ]);

    expect((await api.getRepository("4217")).fullName).toBe(
      "acme/backend/checkout",
    );
    await api.getRepository("acme/backend/checkout");

    expect(host.requests[1]!.url).toBe(
      `${API}/projects/acme%2Fbackend%2Fcheckout`,
    );
  });

  test("lists branches by GitLab's ^prefix search, keeping only names that start with it", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/branches",
        answer: () => {
          return {
            json: [
              { name: "feature/login" },
              { name: "old-feature/x" },
              { name: "feature/login" },
            ],
          };
        },
      },
    ]);

    const names: CodeHostBranchNames = await api.listBranchNames({
      project: "4217",
      search: "feature",
      limit: 20,
    });

    expect(
      host.urlsTo("/repository/branches")[0]!.searchParams.get("search"),
    ).toBe("^feature");
    expect(names).toEqual({ names: ["feature/login"], isComplete: true });
  });

  test("reads one branch's head, and none for a branch GitLab does not have", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/branches/feature%2Flogin",
        answer: () => {
          return {
            json: {
              name: "feature/login",
              protected: true,
              commit: { id: "a".repeat(40) },
            },
          };
        },
      },
    ]);

    await expect(api.getBranch("4217", "feature/login")).resolves.toEqual({
      name: "feature/login",
      headSha: "a".repeat(40),
      isProtected: true,
    });
    await expect(api.getBranch("4217", "nope")).resolves.toBeNull();
  });

  test("reads the whole tree a keyset page at a time, files only", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/tree",
        answer: (_request: unknown, url: URL) => {
          return url.searchParams.get("page_token") === "next-1"
            ? { json: [{ type: "blob", path: "src/b.ts" }] }
            : {
                json: [
                  { type: "tree", path: "src" },
                  { type: "blob", path: "src/a.ts" },
                ],
                headers: {
                  link: `<${API}/projects/4217/repository/tree?page_token=next-1&pagination=keyset>; rel="next"`,
                },
              };
        },
      },
    ]);

    await expect(
      api.getTreePaths({ project: "4217", ref: "main" }),
    ).resolves.toEqual(["src/a.ts", "src/b.ts"]);

    const first: URLSearchParams =
      host.urlsTo("/repository/tree")[0]!.searchParams;

    expect(first.get("recursive")).toBe("true");
    expect(first.get("pagination")).toBe("keyset");
    expect(GitLabApi.readNextPageToken("")).toBeNull();
    expect(
      GitLabApi.readNextPageToken('<https://x/y?page_token=abc>; rel="first"'),
    ).toBeNull();
  });

  test("reads a file's text, with its page; none for a missing or binary file", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/files/src%2Fapp.ts",
        answer: () => {
          return {
            json: {
              encoding: "base64",
              size: 26,
              content: Buffer.from("const a = 1;\nconst b = 2;\n").toString(
                "base64",
              ),
            },
          };
        },
      },
      {
        method: "GET",
        path: "/projects/4217/repository/files/logo.png",
        answer: () => {
          return {
            json: {
              encoding: "base64",
              size: 4,
              content: Buffer.from([0, 159, 146, 150]).toString("base64"),
            },
          };
        },
      },
    ]);

    const file: CodeHostFileContent | null = await api.getFileContent({
      project: "4217",
      webUrl: `${HOST}/acme/backend/checkout`,
      ref: "main",
      filePath: "src/app.ts",
    });

    expect(file).toEqual({
      content: "const a = 1;\nconst b = 2;\n",
      filePath: "src/app.ts",
      sizeInBytes: 26,
      totalLines: 2,
      htmlUrl: `${HOST}/acme/backend/checkout/-/blob/main/src/app.ts`,
    });
    await expect(
      api.getFileContent({
        project: "4217",
        webUrl: HOST,
        ref: "main",
        filePath: "missing.ts",
      }),
    ).resolves.toBeNull();
    await expect(
      api.getFileContent({
        project: "4217",
        webUrl: HOST,
        ref: "main",
        filePath: "logo.png",
      }),
    ).resolves.toBeNull();
  });

  test("reads a merge request from open to merged, landing as its squash commit when there is no merge commit", async () => {
    let state: string = "opened";
    const { api } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/merge_requests/12",
        answer: () => {
          return {
            json:
              state === "opened"
                ? { state, head_pipeline: { status: "running" } }
                : {
                    state,
                    merged_at: "2026-10-20T10:00:00Z",
                    merge_commit_sha: null,
                    squash_commit_sha: "b".repeat(40),
                    sha: "c".repeat(40),
                    head_pipeline: { status: "success" },
                  },
          };
        },
      },
    ]);

    const open: { state: PullRequestState; ci: { conclusion: string } } =
      await api.getMergeRequestState({ project: "4217", iid: 12 });

    expect(open.state).toBe(PullRequestState.Open);
    expect(open.ci.conclusion).toBe(FixPullRequestCiStatus.Pending);

    state = "merged";

    const merged: {
      state: PullRequestState;
      mergeCommitSha?: string | undefined;
      mergedAt?: Date | undefined;
      ci: { conclusion: string };
    } = await api.getMergeRequestState({ project: "4217", iid: 12 });

    expect(merged.state).toBe(PullRequestState.Merged);
    expect(merged.mergeCommitSha).toBe("b".repeat(40));
    expect(merged.mergedAt).toEqual(new Date("2026-10-20T10:00:00Z"));
    expect(merged.ci.conclusion).toBe(FixPullRequestCiStatus.Green);

    state = "closed";
    expect(
      (await api.getMergeRequestState({ project: "4217", iid: 12 })).state,
    ).toBe(PullRequestState.Closed);
  });

  test("rolls a pipeline up the way GitHub's checks are", () => {
    expect(GitLabApi.summarizePipeline(null).conclusion).toBe(
      FixPullRequestCiStatus.NoCiConfigured,
    );
    expect(GitLabApi.summarizePipeline({ status: "skipped" }).conclusion).toBe(
      FixPullRequestCiStatus.NoCiConfigured,
    );
    expect(GitLabApi.summarizePipeline({ status: "manual" }).conclusion).toBe(
      FixPullRequestCiStatus.Pending,
    );
    expect(GitLabApi.summarizePipeline({ status: "failed" }).conclusion).toBe(
      FixPullRequestCiStatus.Red,
    );
    expect(GitLabApi.summarizePipeline({ status: "canceled" }).conclusion).toBe(
      FixPullRequestCiStatus.Red,
    );
    expect(GitLabApi.summarizePipeline({ status: "success" }).conclusion).toBe(
      FixPullRequestCiStatus.Green,
    );
  });

  test("a deploy contains a fix when GitLab's compare from it to the fix lists no commit", async () => {
    const { api, host } = gitLab([
      {
        method: "GET",
        path: "/projects/4217/repository/compare",
        answer: (_request: unknown, url: URL) => {
          return {
            json: {
              commits:
                url.searchParams.get("from") === "deploy-new" ? [] : [{}],
            },
          };
        },
      },
    ]);

    await expect(
      api.containsCommit({
        project: "4217",
        commit: "fix",
        containing: "deploy-new",
      }),
    ).resolves.toBe(true);
    await expect(
      api.containsCommit({
        project: "4217",
        commit: "fix",
        containing: "deploy-old",
      }),
    ).resolves.toBe(false);

    const query: URLSearchParams = host.urlsTo("/repository/compare")[0]!
      .searchParams;

    expect(query.get("from")).toBe("deploy-new");
    expect(query.get("to")).toBe("fix");
  });

  test("says what a refusal means, in words a person acts on, never with the token", async () => {
    const refusing: (status: number, json?: unknown) => GitLabApi = (
      status: number,
      json?: unknown,
    ): GitLabApi => {
      return gitLab([
        {
          method: "GET",
          path: "/user",
          answer: () => {
            return { status, json: json ?? { message: `${status} ${TOKEN}` } };
          },
        },
      ]).api;
    };

    const failure: (api: GitLabApi) => Promise<CodeHostHttpError> = async (
      api: GitLabApi,
    ): Promise<CodeHostHttpError> => {
      try {
        await api.getAccount();
      } catch (error) {
        return error as CodeHostHttpError;
      }

      throw new Error("It did not fail");
    };

    const unauthorized: CodeHostHttpError = await failure(refusing(401));

    expect(unauthorized.kind).toBe(CodeHostHttpErrorKind.Unauthorized);
    expect(unauthorized.isCredentialRefusal()).toBe(true);
    expect(unauthorized.message).toContain("refused the access token");

    const forbidden: CodeHostHttpError = await failure(
      refusing(403, { error: "insufficient_scope", message: `scope ${TOKEN}` }),
    );

    expect(forbidden.kind).toBe(CodeHostHttpErrorKind.Forbidden);
    expect(forbidden.message).toContain("api and write_repository scopes");
    expect(forbidden.message).not.toContain(TOKEN);

    const limited: CodeHostHttpError = await failure(refusing(429));

    expect(limited.kind).toBe(CodeHostHttpErrorKind.RateLimited);

    const down: CodeHostHttpError = await failure(refusing(503));

    expect(down.kind).toBe(CodeHostHttpErrorKind.Unavailable);

    const redirected: CodeHostHttpError = await failure(refusing(302));

    expect(redirected.kind).toBe(CodeHostHttpErrorKind.Rejected);
    expect(redirected.message).toContain("does not follow");
  });

  test("an answer that is not GitLab's API is said to be one", async () => {
    const { api } = gitLab([
      {
        method: "GET",
        path: "/user",
        answer: () => {
          return { text: "<html>sign in</html>" };
        },
      },
    ]);

    await expect(api.getAccount()).rejects.toMatchObject({
      kind: CodeHostHttpErrorKind.BadResponse,
    });
  });
});
