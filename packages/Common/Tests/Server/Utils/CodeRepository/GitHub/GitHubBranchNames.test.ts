import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API, { APIRequestOptions } from "../../../../../Utils/API";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONArray } from "../../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// API.get as jest.spyOn types it: its type argument at its constraint.
type ApiGet = (options: APIRequestOptions) => ReturnType<typeof API.get>;

/*
 * A repository's branch names, read from GitHub for the branch a Code task
 * starts from (GitHubUtil.listBranchNames): the first page GitHub lists, or
 * - searched - the branches whose names start with what the person typed,
 * through the matching-refs API, which reads refs by prefix. With a token
 * that may only read, names only, each once, and whether that was all of
 * them.
 */

let getSpy: SpyInstance<ApiGet>;
let tokenSpy: SpyInstance<typeof GitHubUtil.getInstallationAccessToken>;

beforeEach(() => {
  tokenSpy = jest
    .spyOn(GitHubUtil, "getInstallationAccessToken")
    .mockResolvedValue({
      token: "ghs_token",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function answer(data: JSONArray): void {
  getSpy = jest
    .spyOn(API, "get")
    .mockResolvedValue(new HTTPResponse(200, data, {}) as never) as never;
}

function askedUrl(): string {
  return (getSpy.mock.calls[0]![0] as APIRequestOptions).url.toString();
}

describe("the first page of branches", () => {
  test("their names, in GitHub's order, each once - and short of a full page, that is all of them", async () => {
    answer([
      { name: "main", commit: { sha: "a" } },
      { name: "release/2026-10" },
      { name: "main" },
      { name: "" },
      { name: 42 },
      "not a branch",
      null,
    ] as unknown as JSONArray);

    const listed: { names: Array<string>; isComplete: boolean } =
      await GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        limit: 100,
      });

    expect(listed).toEqual({
      names: ["main", "release/2026-10"],
      isComplete: true,
    });
    expect(askedUrl()).toBe(
      "https://api.github.com/repos/acme/checkout-api/branches?per_page=100",
    );
    // A token that may read the code, and nothing more.
    expect(tokenSpy).toHaveBeenCalledWith("123", {
      permissions: { contents: "read", metadata: "read" },
    });
    expect(
      (getSpy.mock.calls[0]![0] as APIRequestOptions).headers?.[
        "Authorization"
      ],
    ).toBe("Bearer ghs_token");
  });

  test("a full page may not be all of them: the picker then searches", async () => {
    answer(
      Array.from({ length: 3 }, (_value: unknown, index: number) => {
        return { name: `branch-${index}` };
      }),
    );

    const listed: { names: Array<string>; isComplete: boolean } =
      await GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        limit: 3,
      });

    expect(listed.isComplete).toBe(false);
    expect(askedUrl()).toContain("per_page=3");
  });

  test("a page is never asked for more than GitHub gives, nor fewer than one", async () => {
    answer([]);
    await GitHubUtil.listBranchNames({
      installationId: "123",
      organizationName: "acme",
      repositoryName: "checkout-api",
      limit: 5000,
    });
    expect(askedUrl()).toContain("per_page=100");

    getSpy.mockClear();
    await GitHubUtil.listBranchNames({
      installationId: "123",
      organizationName: "acme",
      repositoryName: "checkout-api",
      limit: 0,
    });
    expect(askedUrl()).toContain("per_page=1");
  });

  test("an organization or repository name is never read as part of the path", async () => {
    answer([]);

    await GitHubUtil.listBranchNames({
      installationId: "123",
      organizationName: "acme/../evil",
      repositoryName: "api?x=1",
      limit: 10,
    });

    expect(askedUrl()).toBe(
      "https://api.github.com/repos/acme%2F..%2Fevil/api%3Fx%3D1/branches?per_page=10",
    );
  });

  test("GitHub refusing is thrown, for the server to say it could not read them", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "Resource not accessible by integration" },
      {},
    );
    jest.spyOn(API, "get").mockResolvedValue(refusal as never);

    await expect(
      GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        limit: 100,
      }),
    ).rejects.toBe(refusal);
  });
});

describe("branches searched by what the person typed", () => {
  test("the refs that start with it, named without refs/heads/ - each part of the prefix encoded on its own", async () => {
    answer([
      { ref: "refs/heads/feature/a b", object: { sha: "1" } },
      { ref: "refs/heads/feature/b" },
      { ref: "refs/tags/feature/v1" },
      { ref: 7 },
    ] as unknown as JSONArray);

    const listed: { names: Array<string>; isComplete: boolean } =
      await GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        search: " feature/a#1 ",
        limit: 100,
      });

    expect(listed).toEqual({
      names: ["feature/a b", "feature/b"],
      isComplete: true,
    });
    expect(askedUrl()).toBe(
      "https://api.github.com/repos/acme/checkout-api/git/matching-refs/heads/feature/a%231",
    );
  });

  test("more matches than a page: the first page, and not all of them", async () => {
    answer(
      Array.from({ length: 5 }, (_value: unknown, index: number) => {
        return { ref: `refs/heads/fix/${index}` };
      }),
    );

    const listed: { names: Array<string>; isComplete: boolean } =
      await GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        search: "fix/",
        limit: 3,
      });

    expect(listed).toEqual({
      names: ["fix/0", "fix/1", "fix/2"],
      isComplete: false,
    });
  });

  test("a prefix nothing starts with is no branch, not a failure", async () => {
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
      );

    expect(
      await GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        search: "nothing",
        limit: 100,
      }),
    ).toEqual({ names: [], isComplete: true });
  });

  test("any other refusal is thrown", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      500,
      { message: "boom" },
      {},
    );
    jest.spyOn(API, "get").mockResolvedValue(refusal as never);

    await expect(
      GitHubUtil.listBranchNames({
        installationId: "123",
        organizationName: "acme",
        repositoryName: "checkout-api",
        search: "x",
        limit: 100,
      }),
    ).rejects.toBe(refusal);
  });
});
