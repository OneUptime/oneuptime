import GitHubUtil, {
  GitHubInstallationToken,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API, { APIRequestOptions } from "../../../../../Utils/API";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// API.post / API.get as jest.spyOn types them: their type argument at its constraint.
type ApiPost = (options: APIRequestOptions) => ReturnType<typeof API.post>;
type ApiGet = (options: APIRequestOptions) => ReturnType<typeof API.get>;

/*
 * THE TOKEN A RUNNER IS HANDED FOR A GITHUB REPOSITORY REACHES THAT ONE
 * REPOSITORY.
 *
 * An installation token minted without naming a repository reaches every
 * repository the GitHub App's installation does - on an "All repositories"
 * install, an organization's whole GitHub, the repositories that pick
 * another Runner and those never connected to OneUptime included. The token
 * a code fix is handed (the Runner pushes the fix and opens its pull
 * request with it) now names its repository
 * (GitHubUtil.getRepositoryAccessToken):
 *
 *   - by name, which GitHub matches among the installation's repositories;
 *   - by id, when GitHub refuses the name (422) - a repository renamed after
 *     it was connected keeps its old name in OneUptime, and GitHub answers
 *     the old name with the repository it now names - read with a token that
 *     can read metadata alone;
 *   - or not at all: an id that cannot be read leaves GitHub's refusal, and
 *     any other failure is passed on as it was.
 */

const PERMISSIONS: {
  contents: "write";
  pull_requests: "write";
  metadata: "read";
} = {
  contents: "write",
  pull_requests: "write",
  metadata: "read",
};

let postSpy: SpyInstance<ApiPost>;
let getSpy: SpyInstance<ApiGet>;

// What each access-token request answers, in order.
let tokenAnswers: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>;
// What reading the repository answers.
let repositoryAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

function tokenAnswer(token: string): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    201,
    { token, expires_at: "2030-01-01T00:00:00Z" },
    {},
  );
}

function refused(statusCode: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message }, {});
}

beforeEach(() => {
  jest.spyOn(GitHubUtil, "generateAppJWT").mockReturnValue("app-jwt");

  tokenAnswers = [tokenAnswer("ghs_scoped")];
  repositoryAnswer = new HTTPResponse<JSONObject>(
    200,
    { id: 987654, name: "users-api-renamed" },
    {},
  );

  postSpy = jest.spyOn(API, "post").mockImplementation((async () => {
    const next: HTTPResponse<JSONObject> | HTTPErrorResponse | undefined =
      tokenAnswers.shift();

    if (!next) {
      throw new Error("no more token answers");
    }

    return next;
  }) as never) as never;

  getSpy = jest.spyOn(API, "get").mockImplementation((async () => {
    return repositoryAnswer;
  }) as never) as never;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function tokenRequestBody(index: number): JSONObject {
  return (postSpy.mock.calls[index]![0] as APIRequestOptions)
    .data as JSONObject;
}

function tokenRequestUrl(index: number): string {
  return (postSpy.mock.calls[index]![0] as APIRequestOptions).url.toString();
}

async function mint(): Promise<GitHubInstallationToken> {
  return await GitHubUtil.getRepositoryAccessToken({
    installationId: "4242",
    organizationName: "acme",
    repositoryName: "users-api",
    permissions: PERMISSIONS,
  });
}

describe("getInstallationAccessToken", () => {
  test("names the repositories it is asked to, by name and by id, beside the permissions", async () => {
    tokenAnswers = [tokenAnswer("a"), tokenAnswer("b")];

    await GitHubUtil.getInstallationAccessToken("4242", {
      permissions: { metadata: "read" },
      repositories: ["users-api"],
    });

    await GitHubUtil.getInstallationAccessToken("4242", {
      permissions: { metadata: "read" },
      repositoryIds: [987654],
    });

    expect(tokenRequestBody(0)).toEqual({
      permissions: { metadata: "read" },
      repositories: ["users-api"],
    });
    expect(tokenRequestBody(1)).toEqual({
      permissions: { metadata: "read" },
      repository_ids: [987654],
    });
  });

  test("names none when asked for none, or for an empty list: the request is what it always was", async () => {
    tokenAnswers = [tokenAnswer("a"), tokenAnswer("b")];

    await GitHubUtil.getInstallationAccessToken("4242", {
      permissions: { metadata: "read" },
    });

    await GitHubUtil.getInstallationAccessToken("4242", {
      permissions: { metadata: "read" },
      repositories: [],
      repositoryIds: [],
    });

    expect(tokenRequestBody(0)).toEqual({ permissions: { metadata: "read" } });
    expect(tokenRequestBody(1)).toEqual({ permissions: { metadata: "read" } });
  });
});

describe("getRepositoryAccessToken", () => {
  test("mints a token for the one repository, by its name, with the permissions asked for", async () => {
    const token: GitHubInstallationToken = await mint();

    expect(token.token).toBe("ghs_scoped");
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(tokenRequestUrl(0)).toBe(
      "https://api.github.com/app/installations/4242/access_tokens",
    );
    expect(tokenRequestBody(0)).toEqual({
      permissions: PERMISSIONS,
      repositories: ["users-api"],
    });
    // Nothing is read about the repository when GitHub takes its name.
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("a name GitHub refuses (a repository renamed since it was connected) is read for its id, and the token minted for that id", async () => {
    tokenAnswers = [
      refused(
        422,
        "There is at least one repository that does not exist or is not accessible to the parent installation.",
      ),
      tokenAnswer("ghs_metadata_only"),
      tokenAnswer("ghs_scoped_by_id"),
    ];

    const token: GitHubInstallationToken = await mint();

    expect(token.token).toBe("ghs_scoped_by_id");
    expect(postSpy).toHaveBeenCalledTimes(3);

    // The id is read with a token that may read metadata alone...
    expect(tokenRequestBody(1)).toEqual({ permissions: { metadata: "read" } });

    const read: APIRequestOptions = getSpy.mock
      .calls[0]![0] as APIRequestOptions;
    expect(read.url.toString()).toBe(
      "https://api.github.com/repos/acme/users-api",
    );
    expect(read.headers?.["Authorization"]).toBe("Bearer ghs_metadata_only");

    // ...and the token handed out reaches that one repository, by id.
    expect(tokenRequestBody(2)).toEqual({
      permissions: PERMISSIONS,
      repository_ids: [987654],
    });
  });

  test("a repository whose id cannot be read gets no token: GitHub's refusal of the name is what is thrown", async () => {
    const refusal: HTTPErrorResponse = refused(422, "Not accessible");

    for (const answer of [
      refused(404, "Not Found"),
      new HTTPResponse<JSONObject>(200, { name: "no id here" }, {}),
      new HTTPResponse<JSONObject>(200, { id: "987654" }, {}),
      new HTTPResponse<JSONObject>(200, { id: -1 }, {}),
      new HTTPResponse<JSONObject>(200, { id: 1.5 }, {}),
    ]) {
      jest.clearAllMocks();
      tokenAnswers = [refusal, tokenAnswer("ghs_metadata_only")];
      repositoryAnswer = answer;

      await expect(mint()).rejects.toBe(refusal);

      // No token that reaches more than the repository is ever minted.
      for (let index: number = 0; index < postSpy.mock.calls.length; index++) {
        const body: JSONObject = tokenRequestBody(index);
        const asksForWrite: boolean = JSON.stringify(
          body["permissions"],
        ).includes("write");

        if (asksForWrite) {
          expect(body["repositories"] || body["repository_ids"]).toBeDefined();
        }
      }
    }
  });

  test("a failure that is not GitHub refusing the name is passed on, with no fallback", async () => {
    for (const failure of [
      refused(403, "Resource not accessible by integration"),
      refused(500, "Server Error"),
      refused(401, "Bad credentials"),
    ]) {
      jest.clearAllMocks();
      tokenAnswers = [failure];

      await expect(mint()).rejects.toBe(failure);
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).not.toHaveBeenCalled();
    }
  });

  test("an installation that is gone (404) is reported as it always was, with no fallback", async () => {
    tokenAnswers = [refused(404, "Not Found")];

    await expect(mint()).rejects.toThrow();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("the permissions refused by id too: that refusal is thrown, and nothing wider is ever asked for", async () => {
    const byIdRefusal: HTTPErrorResponse = refused(
      422,
      "The permissions requested are not granted to this installation.",
    );

    tokenAnswers = [
      refused(422, "The permissions requested are not granted"),
      tokenAnswer("ghs_metadata_only"),
      byIdRefusal,
    ];

    await expect(mint()).rejects.toBe(byIdRefusal);
    expect(tokenRequestBody(2)).toEqual({
      permissions: PERMISSIONS,
      repository_ids: [987654],
    });
  });

  test("the repository's path is encoded, so a name can never reach another API route", async () => {
    tokenAnswers = [
      refused(422, "Not accessible"),
      tokenAnswer("ghs_metadata_only"),
      tokenAnswer("ghs_scoped_by_id"),
    ];

    await GitHubUtil.getRepositoryAccessToken({
      installationId: "4242",
      organizationName: "acme/../../orgs",
      repositoryName: "users api?x=1",
      permissions: PERMISSIONS,
    });

    expect((getSpy.mock.calls[0]![0] as APIRequestOptions).url.toString()).toBe(
      "https://api.github.com/repos/acme%2F..%2F..%2Forgs/users%20api%3Fx%3D1",
    );
  });
});
