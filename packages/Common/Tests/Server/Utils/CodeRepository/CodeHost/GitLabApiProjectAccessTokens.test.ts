import { describe, expect, test } from "@jest/globals";
import GitLabApi, {
  GitLabProjectAccessToken,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpRequest,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostOpenedPullRequest } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { FakeCodeHost, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * The host calls a code fix's server-side pull request and short-lived
 * GitLab tokens are made of (issues #8912, #8916): making and revoking a
 * project access token, and finding the merge (or pull) request a branch
 * already has, each as the host's API documents it.
 */

const TOKEN: string = "glpat-connection-token-000004";

function gitLab(host: FakeCodeHost): GitLabApi {
  return new GitLabApi({
    hostUrl: "https://gitlab.example.com",
    token: TOKEN,
    transport: host.transport,
    backOff: noWait,
  });
}

describe("GitLabApi.createProjectAccessToken", () => {
  test("asks for the scopes, role and expiry given, on the project, and reads the token once", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "POST",
          path: "/projects/4217/access_tokens",
          answer: () => {
            return {
              status: 201,
              json: {
                id: 88,
                name: "OneUptime AI fix 1a2b3c4d",
                scopes: ["write_repository"],
                access_level: 30,
                expires_at: "2026-11-17",
                active: true,
                revoked: false,
                user_id: 501,
                token: "glpat-made-for-the-run",
              },
            };
          },
        },
      ],
    });

    const made: GitLabProjectAccessToken = await gitLab(
      host,
    ).createProjectAccessToken({
      project: "4217",
      name: "OneUptime AI fix 1a2b3c4d",
      description: "d".repeat(300),
      scopes: ["write_repository"],
      accessLevel: 30,
      expiresAt: "2026-11-17",
    });

    expect(made).toEqual({
      id: "88",
      token: "glpat-made-for-the-run",
      expiresAt: "2026-11-17",
    });

    const sent: CodeHostHttpRequest = host.requests[0]!;

    expect(sent.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
    expect(JSON.parse(sent.body || "{}")).toEqual({
      name: "OneUptime AI fix 1a2b3c4d",
      // GitLab takes 255 characters at most.
      description: "d".repeat(255),
      scopes: ["write_repository"],
      access_level: 30,
      expires_at: "2026-11-17",
    });
  });

  test("a project's path is sent encoded", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "POST",
          path: "/projects/acme%2Fcheckout/access_tokens",
          answer: () => {
            return {
              status: 201,
              json: { id: 1, token: "glpat-x", expires_at: "2026-11-17" },
            };
          },
        },
      ],
    });

    await gitLab(host).createProjectAccessToken({
      project: "acme/checkout",
      name: "n",
      description: "d",
      scopes: ["write_repository"],
      accessLevel: 30,
      expiresAt: "2026-11-17",
    });

    expect(host.requests[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/acme%2Fcheckout/access_tokens",
    );
  });

  test.each([
    [403, CodeHostHttpErrorKind.Forbidden],
    [404, CodeHostHttpErrorKind.NotFound],
    [400, CodeHostHttpErrorKind.Rejected],
    [401, CodeHostHttpErrorKind.Unauthorized],
  ])(
    "GitLab refusing (%s) throws its answer, never the token",
    async (status: number, kind: CodeHostHttpErrorKind) => {
      const host: FakeCodeHost = fakeCodeHost({
        apiBaseUrl: "https://gitlab.example.com/api/v4",
        routes: [
          {
            method: "POST",
            path: "/projects/4217/access_tokens",
            answer: () => {
              return { status, json: { message: `${status} ${TOKEN}` } };
            },
          },
        ],
      });

      let thrown: unknown = null;

      try {
        await gitLab(host).createProjectAccessToken({
          project: "4217",
          name: "n",
          description: "d",
          scopes: ["write_repository"],
          accessLevel: 30,
          expiresAt: "2026-11-17",
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(CodeHostHttpError);
      expect((thrown as CodeHostHttpError).kind).toBe(kind);
      expect((thrown as CodeHostHttpError).message).not.toContain(TOKEN);
    },
  );

  test("an answer without the token or its id is not a token", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "POST",
          path: "/projects/4217/access_tokens",
          answer: () => {
            return { status: 201, json: { id: 5 } };
          },
        },
      ],
    });

    await expect(
      gitLab(host).createProjectAccessToken({
        project: "4217",
        name: "n",
        description: "d",
        scopes: ["write_repository"],
        accessLevel: 30,
        expiresAt: "2026-11-17",
      }),
    ).rejects.toThrow("the access token it made");
  });
});

describe("GitLabApi.revokeProjectAccessToken", () => {
  function revoking(status: number): FakeCodeHost {
    return fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "DELETE",
          path: "/projects/4217/access_tokens/88",
          answer: () => {
            return status === 204
              ? { status: 204 }
              : { status, json: { message: `${status}` } };
          },
        },
      ],
    });
  }

  test("true once GitLab revoked it (204), with the connection's token", async () => {
    const host: FakeCodeHost = revoking(204);

    expect(
      await gitLab(host).revokeProjectAccessToken({
        project: "4217",
        tokenId: "88",
      }),
    ).toBe(true);
    expect(host.requests[0]!.method).toBe("DELETE");
    expect(host.requests[0]!.headers["PRIVATE-TOKEN"]).toBe(TOKEN);
  });

  test("false when GitLab has no such token any more (404)", async () => {
    expect(
      await gitLab(revoking(404)).revokeProjectAccessToken({
        project: "4217",
        tokenId: "88",
      }),
    ).toBe(false);
  });

  test("any other answer throws, for the sweep to ask again", async () => {
    await expect(
      gitLab(revoking(400)).revokeProjectAccessToken({
        project: "4217",
        tokenId: "88",
      }),
    ).rejects.toBeInstanceOf(CodeHostHttpError);
  });

  test("an id that is not GitLab's asks nothing", async () => {
    const host: FakeCodeHost = revoking(204);

    for (const tokenId of ["", "abc", "-1", "../users"]) {
      expect(
        await gitLab(host).revokeProjectAccessToken({
          project: "4217",
          tokenId,
        }),
      ).toBe(false);
    }

    expect(host.requests).toHaveLength(0);
  });
});

describe("the merge or pull request a branch already has", () => {
  test("GitLab: the open one from the branch into the base, never a fork's", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "GET",
          path: "/projects/4217/merge_requests",
          answer: () => {
            return {
              json: [
                {
                  id: 1,
                  iid: 3,
                  state: "opened",
                  source_branch: "fix-1a2b3c4d",
                  target_branch: "main",
                  source_project_id: 999,
                  target_project_id: 4217,
                  web_url:
                    "https://gitlab.example.com/acme/x/-/merge_requests/3",
                },
                {
                  id: 2,
                  iid: 4,
                  state: "opened",
                  source_branch: "fix-1a2b3c4d",
                  target_branch: "main",
                  source_project_id: 4217,
                  target_project_id: 4217,
                  web_url:
                    "https://gitlab.example.com/acme/x/-/merge_requests/4",
                },
              ],
            };
          },
        },
      ],
    });

    const found: CodeHostOpenedPullRequest | null = await gitLab(
      host,
    ).findOpenMergeRequest({
      project: "4217",
      sourceBranch: "fix-1a2b3c4d",
      targetBranch: "main",
    });

    expect(found).toEqual({
      id: 2,
      number: 4,
      htmlUrl: "https://gitlab.example.com/acme/x/-/merge_requests/4",
      state: PullRequestState.Open,
    });

    const asked: URL = new URL(host.requests[0]!.url);

    expect(asked.searchParams.get("state")).toBe("opened");
    expect(asked.searchParams.get("source_branch")).toBe("fix-1a2b3c4d");
    expect(asked.searchParams.get("target_branch")).toBe("main");
  });

  test("GitLab: none when nothing matches", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "GET",
          path: "/projects/4217/merge_requests",
          answer: () => {
            return { json: [] };
          },
        },
      ],
    });

    expect(
      await gitLab(host).findOpenMergeRequest({
        project: "4217",
        sourceBranch: "fix",
        targetBranch: "main",
      }),
    ).toBeNull();
  });

  test("Forgejo and Gitea: read page by page, newest first, until the branch's is found", async () => {
    const page: (number: number) => Array<unknown> = (
      number: number,
    ): Array<unknown> => {
      return Array.from({ length: 50 }, (_unused: unknown, index: number) => {
        const pullNumber: number = number * 100 + index;

        return {
          id: pullNumber + 10000,
          number: pullNumber,
          state: "open",
          html_url: `https://codeberg.org/acme/checkout/pulls/${pullNumber}`,
          head: {
            ref:
              number === 2 && index === 7 ? "fix-1a2b3c4d" : `other-${index}`,
            repo: { id: 9 },
          },
          base: { ref: "main", repo: { id: 9 } },
        };
      });
    };

    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://codeberg.org/api/v1",
      routes: [
        {
          method: "GET",
          path: "/repos/acme/checkout/pulls",
          answer: (_request: CodeHostHttpRequest, url: URL) => {
            return { json: page(Number(url.searchParams.get("page"))) };
          },
        },
      ],
    });

    const found: CodeHostOpenedPullRequest | null = await new ForgejoApi({
      hostUrl: "https://codeberg.org",
      token: TOKEN,
      transport: host.transport,
      backOff: noWait,
    }).findOpenPullRequest({
      owner: "acme",
      name: "checkout",
      headBranch: "fix-1a2b3c4d",
      baseBranch: "main",
    });

    expect(found).toEqual({
      id: 10207,
      number: 207,
      htmlUrl: "https://codeberg.org/acme/checkout/pulls/207",
      state: PullRequestState.Open,
    });
    expect(host.requests).toHaveLength(2);
    expect(new URL(host.requests[0]!.url).searchParams.get("state")).toBe(
      "open",
    );
  });

  test("Forgejo and Gitea: none after the last page", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://codeberg.org/api/v1",
      routes: [
        {
          method: "GET",
          path: "/repos/acme/checkout/pulls",
          answer: () => {
            return { json: [] };
          },
        },
      ],
    });

    expect(
      await new ForgejoApi({
        hostUrl: "https://codeberg.org",
        token: TOKEN,
        transport: host.transport,
        backOff: noWait,
      }).findOpenPullRequest({
        owner: "acme",
        name: "checkout",
        headBranch: "fix",
        baseBranch: "main",
      }),
    ).toBeNull();
    expect(host.requests).toHaveLength(1);
  });
});
