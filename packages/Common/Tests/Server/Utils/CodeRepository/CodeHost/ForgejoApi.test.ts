import { describe, expect, test } from "@jest/globals";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import {
  CodeHostCiSummary,
  CodeHostRepositoryPage,
  CodeHostServerInfo,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import FixPullRequestCiStatus from "../../../../../Types/AI/FixPullRequestCiStatus";
import { ForgejoServerProduct } from "../../../../../Types/CodeRepository/CodeHost";
import { FakeCodeHost, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * ForgejoApi against Forgejo's and Gitea's API as they answer it (v1), for
 * what a real server in a test run cannot show on demand: a repository it
 * may not push to because it is archived or a mirror, paging by
 * X-Total-Count, a folder or a file too large to read, a scope it lacks,
 * a server that cannot compare commits (Gitea before 1.23) and a server
 * that does not say its version. ForgejoApiAgainstServer runs the rest
 * against real Forgejo and Gitea servers.
 */

const TOKEN: string = "f0e1d2c3b4a5968778695a4b3c2d1e0f12345678";
const HOST: string = "https://git.example.com";
const API: string = `${HOST}/api/v1`;

function repository(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 31,
    name: "app",
    full_name: "acme/app",
    owner: { login: "acme" },
    description: "",
    default_branch: "trunk",
    html_url: `${HOST}/acme/app`,
    clone_url: `${HOST}/acme/app.git`,
    private: false,
    archived: false,
    mirror: false,
    permissions: { admin: false, push: true, pull: true },
    ...overrides,
  };
}

function forgejo(routes: Parameters<typeof fakeCodeHost>[0]["routes"]): {
  api: ForgejoApi;
  host: FakeCodeHost;
} {
  const host: FakeCodeHost = fakeCodeHost({ apiBaseUrl: API, routes });

  return {
    api: new ForgejoApi({
      hostUrl: HOST,
      token: TOKEN,
      transport: host.transport,
      providerName: "Gitea",
      backOff: noWait,
    }),
    host,
  };
}

describe("ForgejoApi", () => {
  test("sends the token as Authorization: token, and nowhere else", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/user",
        answer: () => {
          return { json: { id: 3, login: "alice", full_name: "" } };
        },
      },
    ]);

    await expect(api.getAccount()).resolves.toEqual({
      id: "3",
      login: "alice",
      name: "alice",
    });
    expect(host.requests[0]!.headers["Authorization"]).toBe(`token ${TOKEN}`);
    expect(host.requests[0]!.url).not.toContain(TOKEN);
  });

  test("lists what the token's account owns or works in, paged by X-Total-Count; an archived repository or a mirror is not one to push to", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: "/repos/search",
        answer: () => {
          return {
            json: {
              ok: true,
              data: [
                repository(),
                repository({ id: 32, name: "old", archived: true }),
                repository({ id: 33, name: "mirror", mirror: true }),
                repository({
                  id: 34,
                  name: "read",
                  permissions: { push: false, pull: true },
                }),
              ],
            },
            headers: { "x-total-count": "120" },
          };
        },
      },
    ]);

    const page: CodeHostRepositoryPage = await api.listRepositories({
      accountId: "3",
      search: "ap",
      page: 2,
    });
    const query: URLSearchParams =
      host.urlsTo("/repos/search")[0]!.searchParams;

    expect(query.get("uid")).toBe("3");
    expect(query.get("q")).toBe("ap");
    expect(query.get("limit")).toBe("50");
    expect(query.get("page")).toBe("2");
    expect(query.get("sort")).toBe("updated");
    // 2 pages of 50 out of 120: one more to read.
    expect(page.hasMore).toBe(true);
    expect(
      page.repositories.map((each: { name: string; canPush: boolean }) => {
        return [each.name, each.canPush];
      }),
    ).toEqual([
      ["app", true],
      ["old", false],
      ["mirror", false],
      ["read", false],
    ]);
    expect(page.repositories[0]!.defaultBranch).toBe("trunk");
  });

  test("reads a repository by the server's id only when it is one", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: "/repositories/31",
        answer: () => {
          return { json: repository() };
        },
      },
    ]);

    expect((await api.getRepositoryById("31")).fullName).toBe("acme/app");

    for (const id of ["0", "-1", "abc", "1.5", "../user"]) {
      await expect(api.getRepositoryById(id)).rejects.toMatchObject({
        kind: CodeHostHttpErrorKind.NotFound,
      });
    }
  });

  test("a folder is no file, and a file too large to come back at once says so", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: "/repos/acme/app/contents/src",
        answer: () => {
          return { json: [{ type: "file", name: "a.ts" }] };
        },
      },
      {
        method: "GET",
        path: "/repos/acme/app/contents/big.bin",
        answer: () => {
          return { json: { type: "file", size: 52428800, content: null } };
        },
      },
    ]);

    await expect(
      api.getFileContent({
        owner: "acme",
        name: "app",
        ref: "trunk",
        filePath: "src",
      }),
    ).resolves.toBeNull();
    await expect(
      api.getFileContent({
        owner: "acme",
        name: "app",
        ref: "trunk",
        filePath: "big.bin",
      }),
    ).rejects.toThrow("more than the server returns at once");
  });

  test("a scope the token lacks is said with the scopes it needs", async () => {
    const { api } = forgejo([
      {
        method: "GET",
        path: "/user",
        answer: () => {
          return {
            status: 403,
            json: {
              message: `token does not have at least one of required scope(s): [read:user] ${TOKEN}`,
            },
          };
        },
      },
    ]);

    let caught: CodeHostHttpError | null = null;

    try {
      await api.getAccount();
    } catch (error) {
      caught = error as CodeHostHttpError;
    }

    expect(caught?.kind).toBe(CodeHostHttpErrorKind.Forbidden);
    expect(caught?.message).toContain("Gitea did not let the access token");
    expect(caught?.message).toContain("write:repository");
    expect(caught?.message).toContain("read:user");
    expect(caught?.message).not.toContain(TOKEN);
  });

  test("a server that cannot compare commits is read through the history instead", async () => {
    const fix: string = "f".repeat(40);
    const history: Array<{ sha: string }> = [];

    for (let index: number = 0; index < 75; index++) {
      history.push({ sha: index.toString(16).padStart(40, "0") });
    }

    history[60] = { sha: fix };

    const { api, host } = forgejo([
      {
        method: "GET",
        path: /^\/repos\/acme\/app\/compare\//,
        answer: () => {
          return { status: 404, json: { message: "BaseNotExist" } };
        },
      },
      {
        method: "GET",
        path: "/repos/acme/app/commits",
        answer: (_request: unknown, url: URL) => {
          const page: number = Number(url.searchParams.get("page"));
          const limit: number = Number(url.searchParams.get("limit"));

          return {
            json:
              url.searchParams.get("sha") === "deploy-new"
                ? history.slice((page - 1) * limit, page * limit)
                : [{ sha: "e".repeat(40) }],
          };
        },
      },
    ]);

    await expect(
      api.containsCommit({
        owner: "acme",
        name: "app",
        commit: fix,
        containing: "deploy-new",
      }),
    ).resolves.toBe(true);
    // The second page held it: two pages read, no more.
    expect(host.urlsTo("/commits")).toHaveLength(2);
    expect(host.urlsTo("/commits")[0]!.searchParams.get("stat")).toBe("false");

    await expect(
      api.containsCommit({
        owner: "acme",
        name: "app",
        commit: fix,
        containing: "deploy-old",
      }),
    ).resolves.toBe(false);
  });

  test("a server that compares commits says so in total_commits", async () => {
    const { api, host } = forgejo([
      {
        method: "GET",
        path: /^\/repos\/acme\/app\/compare\//,
        answer: (_request: unknown, url: URL) => {
          return {
            json: {
              total_commits: url.pathname.endsWith("/new...fix") ? 0 : 3,
              commits: [],
            },
          };
        },
      },
    ]);

    await expect(
      api.containsCommit({
        owner: "acme",
        name: "app",
        commit: "fix",
        containing: "new",
      }),
    ).resolves.toBe(true);
    await expect(
      api.containsCommit({
        owner: "acme",
        name: "app",
        commit: "fix",
        containing: "old",
      }),
    ).resolves.toBe(false);
    expect(host.urlsTo("/new...fix")).toHaveLength(1);
  });

  test("rolls commit statuses up: none, pending, failed, passed", async () => {
    const summary: (states: Array<string>) => CodeHostCiSummary = (
      states: Array<string>,
    ): CodeHostCiSummary => {
      return ForgejoApi.summarizeStatuses(
        states.map((state: string) => {
          return { status: state };
        }),
      );
    };

    expect(summary([]).conclusion).toBe(FixPullRequestCiStatus.NoCiConfigured);
    expect(summary(["success", "pending"]).conclusion).toBe(
      FixPullRequestCiStatus.Pending,
    );
    expect(summary(["success", "failure"]).conclusion).toBe(
      FixPullRequestCiStatus.Red,
    );
    expect(summary(["error"]).conclusion).toBe(FixPullRequestCiStatus.Red);
    expect(summary(["success", "success"]).conclusion).toBe(
      FixPullRequestCiStatus.Green,
    );
  });

  test("a server that does not say its version is read as unknown, not as a failure", async () => {
    const quiet: { api: ForgejoApi } = forgejo([]);
    const forgejoServer: { api: ForgejoApi } = forgejo([
      {
        method: "GET",
        path: "/version",
        answer: () => {
          return { json: { version: "10.0.0+gitea-1.22.0" } };
        },
      },
    ]);

    await expect(quiet.api.getServerInfo()).resolves.toEqual({
      product: null,
      version: null,
    });

    const info: CodeHostServerInfo = await forgejoServer.api.getServerInfo();

    expect(info).toEqual({
      product: ForgejoServerProduct.Forgejo,
      version: "10.0.0+gitea-1.22.0",
    });
  });
});
