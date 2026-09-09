import GitHubWorkflowClient, {
  GitHubWorkflowRequest,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHubWorkflowClient";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../Utils/API";
import logger from "../../../Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const projectId: ObjectID = ObjectID.generate();
const repositoryId: ObjectID = ObjectID.generate();
const TOKEN: string = "ghs_test_installation_private_credential";

function repository(): CodeRepository {
  return Object.assign(new CodeRepository(), {
    _id: repositoryId.toString(),
    projectId,
    repositoryHostedAt: CodeRepositoryType.GitHub,
    gitHubAppInstallationId: "12345",
    organizationName: "acme",
    repositoryName: "api",
  });
}

function request(
  overrides: Partial<GitHubWorkflowRequest> = {},
): GitHubWorkflowRequest {
  return {
    projectId,
    repository: "acme/api",
    method: HTTPMethod.GET,
    path: ["issues", "7"],
    permissions: { metadata: "read", issues: "read" },
    ...overrides,
  };
}

describe("GitHub workflow client repository authorization and transport", () => {
  beforeEach(() => {
    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository());
    jest
      .spyOn(GitHubInstallationBinding, "isRepositoryInstallationBound")
      .mockResolvedValue(true);
    jest.spyOn(GitHubUtil, "getInstallationAccessToken").mockResolvedValue({
      token: TOKEN,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    jest
      .spyOn(API, "fetch")
      .mockResolvedValue(new HTTPResponse(200, { number: 7 }, {}));
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries within the workflow project and verifies the authoritative installation before minting a repository-scoped read token", async () => {
    await GitHubWorkflowClient.request(request());
    expect(CodeRepositoryService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId,
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: expect.any(Wildcard),
          repositoryName: expect.any(Wildcard),
        },
      }),
    );
    expect(
      GitHubInstallationBinding.isRepositoryInstallationBound,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, gitHubAppInstallationId: "12345" }),
    );
    expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        permissions: { metadata: "read", issues: "read" },
        repositories: ["api"],
        sanitizeErrors: true,
      }),
    );
    const call: Parameters<typeof API.fetch>[0] = (API.fetch as jest.Mock).mock
      .calls[0]![0] as Parameters<typeof API.fetch>[0];
    expect(call.url.toString()).toBe(
      "https://api.github.com/repos/acme/api/issues/7",
    );
    expect(call.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(call.options).toEqual(
      expect.objectContaining({
        retries: 0,
        doNotFollowRedirects: true,
        maxContentLength: 2_000_000,
        maxBodyLength: 1_000_000,
      }),
    );
  });

  test("supports a connected repository ID and never treats it as an installation ID", async () => {
    await GitHubWorkflowClient.request(
      request({ repository: repositoryId.toString() }),
    );
    expect(CodeRepositoryService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: repositoryId.toString(),
          projectId,
          repositoryHostedAt: CodeRepositoryType.GitHub,
        },
      }),
    );
    expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
      "12345",
      expect.anything(),
    );
  });

  test("matches GitHub owner/repository names case-insensitively without broadening literal underscores into wildcards", async () => {
    await GitHubWorkflowClient.request(
      request({ repository: "Acme/API_Service" }),
    );
    const query: {
      organizationName: Wildcard<string>;
      repositoryName: Wildcard<string>;
    } = (CodeRepositoryService.findOneBy as jest.Mock).mock.calls[0]![0].query;
    expect(query.organizationName.toPatterns()).toEqual(["Acme"]);
    expect(query.repositoryName.toPatterns()).toEqual(["API\\_Service"]);
  });

  test.each([
    "",
    "12345",
    "https://github.com/acme/api",
    "acme/api/extra",
    "acme/..",
    "../api",
    "acme/repo?x=1",
    "acme/repo#hash",
    "acme/%2f",
    "acme\\api",
  ])(
    "rejects invalid repository reference %j before lookup",
    async (value: string) => {
      await expect(
        GitHubWorkflowClient.request(request({ repository: value })),
      ).rejects.toThrow();
      expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
      expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
    },
  );

  test("rejects an unconnected repository", async () => {
    jest.mocked(CodeRepositoryService.findOneBy).mockResolvedValue(null);
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "not connected",
    );
    expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
  });

  test.each([
    { projectId: ObjectID.generate() },
    { projectId: undefined },
    { repositoryHostedAt: CodeRepositoryType.GitLab },
    { gitHubAppInstallationId: undefined },
    { gitHubAppInstallationId: "../99" },
    { organizationName: ".." },
    { repositoryName: "repo/escape" },
    { repositoryName: undefined },
  ])(
    "rejects invalid or cross-project stored rows: %j",
    async (override: unknown) => {
      jest
        .mocked(CodeRepositoryService.findOneBy)
        .mockResolvedValue(Object.assign(repository(), override));
      await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
        "not connected",
      );
      expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
      expect(API.fetch).not.toHaveBeenCalled();
    },
  );

  test("rejects a stale repository installation binding even if the row belongs to the project", async () => {
    jest
      .mocked(GitHubInstallationBinding.isRepositoryInstallationBound)
      .mockResolvedValue(false);
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "not connected",
    );
    expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
  });

  test("revalidates the installation on every request without authorization caching", async () => {
    await GitHubWorkflowClient.request(request());
    jest
      .mocked(GitHubInstallationBinding.isRepositoryInstallationBound)
      .mockResolvedValue(false);
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "not connected",
    );
    expect(
      GitHubInstallationBinding.isRepositoryInstallationBound,
    ).toHaveBeenCalledTimes(2);
    expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledTimes(1);
  });

  test("URL-encodes label names as one segment", async () => {
    await GitHubWorkflowClient.request(
      request({
        method: HTTPMethod.DELETE,
        path: ["issues", "7", "labels", "priority/high & café?"],
      }),
    );
    expect((API.fetch as jest.Mock).mock.calls[0]![0].url.toString()).toBe(
      "https://api.github.com/repos/acme/api/issues/7/labels/priority%2Fhigh%20%26%20caf%C3%A9%3F",
    );
  });

  test.each([0, 50, 599, Number.NaN, Number.NEGATIVE_INFINITY])(
    "does not mint a token without enough time remaining: %j",
    async (remaining: number) => {
      await expect(
        GitHubWorkflowClient.request(
          request({
            getRemainingExecutionTimeInMs: (): number => {
              return remaining;
            },
          }),
        ),
      ).rejects.toThrow("Not enough");
      expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
    },
  );

  test("recomputes the remaining deadline after the installation token request", async () => {
    let time: number = 4500;
    jest
      .mocked(GitHubUtil.getInstallationAccessToken)
      .mockImplementation(
        async (): Promise<{ token: string; expiresAt: Date }> => {
          time = 1700;
          return { token: TOKEN, expiresAt: new Date() };
        },
      );
    await GitHubWorkflowClient.request(
      request({
        getRemainingExecutionTimeInMs: (): number => {
          return time;
        },
      }),
    );
    expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        requestOptions: expect.objectContaining({ timeout: 4000 }),
      }),
    );
    expect(API.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          timeout: 1200,
          totalTimeoutInMs: 1200,
        }),
      }),
    );
  });

  test("does not start an action when token minting exhausts the workflow deadline", async () => {
    let time: number = 2000;
    jest
      .mocked(GitHubUtil.getInstallationAccessToken)
      .mockImplementation(
        async (): Promise<{ token: string; expiresAt: Date }> => {
          time = 100;
          return { token: TOKEN, expiresAt: new Date() };
        },
      );
    await expect(
      GitHubWorkflowClient.request(
        request({
          getRemainingExecutionTimeInMs: (): number => {
            return time;
          },
        }),
      ),
    ).rejects.toThrow("Not enough");
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test.each([301, 401, 403, 404, 422, 429, 500, 503])(
    "sanitizes error response %i without exposing response data or headers",
    async (statusCode: number) => {
      jest
        .mocked(API.fetch)
        .mockResolvedValue(
          new HTTPErrorResponse(
            statusCode,
            { message: `secret ${TOKEN}` },
            { Authorization: TOKEN },
          ),
        );
      const error: unknown = await GitHubWorkflowClient.request(
        request(),
      ).catch((value: unknown): unknown => {
        return value;
      });
      expect(error).toEqual(expect.objectContaining({ statusCode }));
      expect(JSON.stringify(error)).not.toContain(TOKEN);
      expect(String(error)).not.toContain(TOKEN);
      expect(API.fetch).toHaveBeenCalledTimes(1);
    },
  );

  test("treats successful redirect responses as errors", async () => {
    jest
      .mocked(API.fetch)
      .mockResolvedValue(
        new HTTPResponse(302, { location: "https://attacker.example" }, {}),
      );
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "could not complete",
    );
  });

  test("redacts transport errors carrying credentials", async () => {
    jest
      .mocked(API.fetch)
      .mockRejectedValue(new Error(`timeout Authorization: Bearer ${TOKEN}`));
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "failed or timed out",
    );
    await expect(GitHubWorkflowClient.request(request())).rejects.not.toThrow(
      TOKEN,
    );
  });

  test("redacts token minting errors and does not dispatch the action", async () => {
    jest
      .mocked(GitHubUtil.getInstallationAccessToken)
      .mockRejectedValue(new Error(`private key ${TOKEN}`));
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "Unable to authorize",
    );
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("rejects empty installation tokens", async () => {
    jest
      .mocked(GitHubUtil.getInstallationAccessToken)
      .mockResolvedValue({ token: "", expiresAt: new Date() });
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "invalid installation token",
    );
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("redacts an echoed installation credential from all nested successful response fields", async () => {
    jest
      .mocked(API.fetch)
      .mockResolvedValue(
        new HTTPResponse(
          200,
          { body: `echo ${TOKEN}`, nested: [TOKEN], token: TOKEN },
          { Authorization: TOKEN },
        ),
      );
    const response: unknown = await GitHubWorkflowClient.request(request());
    expect(JSON.stringify(response)).not.toContain(TOKEN);
    expect(JSON.stringify(response)).not.toContain("Authorization");
    expect(JSON.stringify(response)).toContain("[redacted]");
  });

  test("rejects malformed successful payloads", async () => {
    jest.mocked(API.fetch).mockResolvedValue({
      statusCode: 200,
      data: null,
    } as unknown as HTTPResponse<JSONObject>);
    await expect(GitHubWorkflowClient.request(request())).rejects.toThrow(
      "invalid response",
    );
  });

  test.each([
    ["write", true],
    ["admin", true],
    ["read", false],
    ["none", false],
    ["maintain", false],
    [undefined, false],
  ])(
    "fresh collaborator permission %s grants write=%s",
    async (permission: unknown, expected: unknown) => {
      jest
        .mocked(API.fetch)
        .mockResolvedValue(
          new HTTPResponse(
            200,
            { permission: permission as string, role_name: "admin" },
            {},
          ),
        );
      await expect(
        GitHubWorkflowClient.hasWriteAccess({
          projectId,
          repository: repositoryId.toString(),
          username: "octocat",
        }),
      ).resolves.toBe(expected);
      expect((API.fetch as jest.Mock).mock.calls[0]![0].url.toString()).toBe(
        "https://api.github.com/repos/acme/api/collaborators/octocat/permission",
      );
      expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
        "12345",
        expect.objectContaining({ permissions: { metadata: "read" } }),
      );
    },
  );

  test("allows Enterprise Managed User accounts in collaborator checks", async () => {
    jest
      .mocked(API.fetch)
      .mockResolvedValue(new HTTPResponse(200, { permission: "write" }, {}));
    await expect(
      GitHubWorkflowClient.hasWriteAccess({
        projectId,
        repository: repositoryId.toString(),
        username: "mona-cat_octo",
      }),
    ).resolves.toBe(true);
    expect((API.fetch as jest.Mock).mock.calls[0]![0].url.toString()).toBe(
      "https://api.github.com/repos/acme/api/collaborators/mona-cat_octo/permission",
    );
  });

  test.each([
    "",
    "../admin",
    "octocat[bot]",
    "has space",
    "x?query",
    "a".repeat(40),
  ])(
    "rejects invalid collaborator username %s without a request",
    async (username: string) => {
      await expect(
        GitHubWorkflowClient.hasWriteAccess({
          projectId,
          repository: "acme/api",
          username,
        }),
      ).resolves.toBe(false);
      expect(API.fetch).not.toHaveBeenCalled();
    },
  );

  test("non-collaborators fail closed and transient GitHub failures remain retryable errors", async () => {
    jest
      .mocked(API.fetch)
      .mockResolvedValueOnce(new HTTPErrorResponse(404, {}, {}))
      .mockResolvedValueOnce(new HTTPErrorResponse(503, {}, {}));
    await expect(
      GitHubWorkflowClient.hasWriteAccess({
        projectId,
        repository: "acme/api",
        username: "octocat",
      }),
    ).resolves.toBe(false);
    await expect(
      GitHubWorkflowClient.hasWriteAccess({
        projectId,
        repository: "acme/api",
        username: "octocat",
      }),
    ).rejects.toThrow("temporarily unavailable");
  });
});

describe("GitHub installation token transport for workflows", () => {
  beforeEach(() => {
    jest.spyOn(GitHubUtil, "generateAppJWT").mockReturnValue("test-app-jwt");
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(
          201,
          { token: TOKEN, expires_at: "2030-01-01T00:00:00Z" },
          {},
        ),
      );
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends issue permissions and selected repository to token endpoint with a bounded nonredirecting request", async () => {
    await GitHubUtil.getInstallationAccessToken("123", {
      permissions: { issues: "write", metadata: "read" },
      repositories: ["api"],
      requestOptions: { timeout: 1000, doNotFollowRedirects: true },
      sanitizeErrors: true,
    });
    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          permissions: { issues: "write", metadata: "read" },
          repositories: ["api"],
        },
        options: { timeout: 1000, doNotFollowRedirects: true },
      }),
    );
  });

  test("preserves existing token callers that omit scope and request options", async () => {
    await GitHubUtil.getInstallationAccessToken("123");
    expect(API.post).toHaveBeenCalledWith(
      expect.objectContaining({ data: {} }),
    );
    expect((API.post as jest.Mock).mock.calls[0]![0]).not.toHaveProperty(
      "options",
    );
  });

  test.each([403, 404, 422, 500])(
    "sanitized token errors never log upstream payloads (%i)",
    async (statusCode: number) => {
      jest
        .mocked(API.post)
        .mockResolvedValue(
          new HTTPErrorResponse(
            statusCode,
            { message: `permissions ${TOKEN}` },
            {},
          ),
        );
      await expect(
        GitHubUtil.getInstallationAccessToken("123", { sanitizeErrors: true }),
      ).rejects.toThrow(`HTTP ${statusCode}`);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("sanitizes token transport failure before exception telemetry sees it", async () => {
    jest
      .mocked(API.post)
      .mockRejectedValue(new Error(`Authorization: ${TOKEN}`));
    await expect(
      GitHubUtil.getInstallationAccessToken("123", { sanitizeErrors: true }),
    ).rejects.toThrow("Unable to request a GitHub installation token.");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
