import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";

describe("fresh GitHub installation suspension state", () => {
  beforeEach(() => {
    jest.spyOn(GitHubUtil, "generateAppJWT").mockReturnValue("private-app-jwt");
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { suspended_at: null }, {}),
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("uses app authentication, a pinned endpoint, no redirects, and a bounded timeout", async () => {
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).resolves.toBe(false);
    const request: Parameters<typeof API.get>[0] = jest.mocked(API.get).mock
      .calls[0]![0];
    expect(request.url.toString()).toBe(
      "https://api.github.com/app/installations/123",
    );
    expect(request.headers).toMatchObject({
      Authorization: "Bearer private-app-jwt",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(request.options).toMatchObject({
      doNotFollowRedirects: true,
      timeout: 30000,
    });
  });

  test("recognizes current suspension timestamps", async () => {
    jest
      .mocked(API.get)
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { suspended_at: "2026-09-09T10:00:00Z" },
          {},
        ),
      );
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).resolves.toBe(true);
  });

  test("reports missing installations without restoring stale lifecycle state", async () => {
    jest.mocked(API.get).mockResolvedValue(new HTTPErrorResponse(404, {}, {}));
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).resolves.toBeNull();
  });

  test.each([401, 403, 429, 500, 503])(
    "makes HTTP %s retryable",
    async (status: number) => {
      jest
        .mocked(API.get)
        .mockResolvedValue(
          new HTTPErrorResponse(
            status,
            { message: "private upstream detail" },
            {},
          ),
        );
      await expect(
        GitHubUtil.getInstallationSuspensionStatus("123"),
      ).rejects.toThrow("could not be checked");
    },
  );

  test.each([
    {},
    { suspended_at: "" },
    { suspended_at: false },
    { suspended_at: 12 },
  ])("rejects malformed status %p", async (data: JSONObject) => {
    jest
      .mocked(API.get)
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).rejects.toThrow("invalid installation suspension status");
  });

  test("does not expose authentication headers from transport failures", async () => {
    jest
      .mocked(API.get)
      .mockRejectedValue(new Error("Authorization: Bearer private-app-jwt"));
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).rejects.toThrow("could not be checked");
    await expect(
      GitHubUtil.getInstallationSuspensionStatus("123"),
    ).rejects.not.toThrow("private-app-jwt");
  });

  test.each(["", "0", "-1", "1.5", "../../123", "123?token=secret"])(
    "rejects invalid installation path %s before requesting",
    async (id: string) => {
      await expect(
        GitHubUtil.getInstallationSuspensionStatus(id),
      ).rejects.toThrow("valid GitHub installation ID");
      expect(API.get).not.toHaveBeenCalled();
    },
  );
});
