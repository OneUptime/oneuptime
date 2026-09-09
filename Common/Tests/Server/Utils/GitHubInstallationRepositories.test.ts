import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";

function repository(index: number): JSONObject {
  return {
    id: index + 1,
    name: `repository-${index}`,
    full_name: `acme/repository-${index}`,
    private: true,
    html_url: `https://github.com/acme/repository-${index}`,
    description: null,
    default_branch: "main",
    owner: { login: "acme" },
  };
}

describe("authoritative GitHub installation repository membership", () => {
  beforeEach(() => {
    jest.spyOn(GitHubUtil, "getInstallationAccessToken").mockResolvedValue({
      token: "private-installation-token",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { repositories: [] }, {}),
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts an explicitly empty membership list", async () => {
    await expect(
      GitHubUtil.listRepositoriesForInstallation("123"),
    ).resolves.toEqual([]);
  });

  test("returns current membership from every page", async () => {
    jest
      .mocked(API.get)
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            repositories: Array.from(
              { length: 100 },
              (_value: unknown, index: number): JSONObject => {
                return repository(index);
              },
            ),
          },
          {},
        ),
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { repositories: [repository(100)] },
          {},
        ),
      );
    const repositories: Array<GitHubRepository> =
      await GitHubUtil.listRepositoriesForInstallation("123");
    expect(repositories).toHaveLength(101);
    expect(repositories[100]?.fullName).toBe("acme/repository-100");
    expect(
      jest
        .mocked(API.get)
        .mock.calls.map((call: Parameters<typeof API.get>): string => {
          return call[0].url.toString();
        }),
    ).toEqual([
      "https://api.github.com/installation/repositories?per_page=100&page=1",
      "https://api.github.com/installation/repositories?per_page=100&page=2",
    ]);
  });

  test.each([
    {},
    { repositories: null },
    { repositories: {} },
    { repositories: "" },
    { repositories: false },
  ])(
    "does not interpret malformed membership %p as empty",
    async (data: JSONObject) => {
      jest
        .mocked(API.get)
        .mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
      await expect(
        GitHubUtil.listRepositoriesForInstallation("123"),
      ).rejects.toThrow("invalid installation repository list");
    },
  );

  test("rejects incomplete membership if a later page fails", async () => {
    jest
      .mocked(API.get)
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            repositories: Array.from(
              { length: 100 },
              (_value: unknown, index: number): JSONObject => {
                return repository(index);
              },
            ),
          },
          {},
        ),
      )
      .mockResolvedValueOnce(new HTTPErrorResponse(503, {}, {}));
    await expect(
      GitHubUtil.listRepositoriesForInstallation("123"),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test.each(
    [
      null,
      false,
      "repository",
      [],
      {},
      { ...repository(0), full_name: null },
      { ...repository(0), full_name: "acme/another" },
      { ...repository(0), name: null },
      { ...repository(0), name: "" },
      { ...repository(0), name: "repository/name" },
      { ...repository(0), owner: null },
      { ...repository(0), owner: {} },
      { ...repository(0), owner: { login: "" } },
      { ...repository(0), owner: { login: "another" } },
      { ...repository(0), owner: { login: "acme/another" } },
    ].map((invalid: unknown): [unknown] => {
      return [invalid];
    }),
  )(
    "rejects malformed repository identity %p without returning partial membership",
    async (invalid: unknown) => {
      jest
        .mocked(API.get)
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(
            200,
            { repositories: [repository(1), invalid as JSONObject] },
            {},
          ),
        );
      await expect(
        GitHubUtil.listRepositoriesForInstallation("123"),
      ).rejects.toThrow("invalid installation repository identity");
    },
  );

  test("accepts equivalent casing across repository identity fields", async () => {
    jest.mocked(API.get).mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          repositories: [{ ...repository(0), full_name: "ACME/Repository-0" }],
        },
        {},
      ),
    );
    await expect(
      GitHubUtil.listRepositoriesForInstallation("123"),
    ).resolves.toEqual([
      expect.objectContaining({ fullName: "ACME/Repository-0" }),
    ]);
  });

  test("rejects incomplete membership if a later page is malformed", async () => {
    jest
      .mocked(API.get)
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          {
            repositories: Array.from(
              { length: 100 },
              (_value: unknown, index: number): JSONObject => {
                return repository(index);
              },
            ),
          },
          {},
        ),
      )
      .mockResolvedValueOnce(new HTTPResponse<JSONObject>(200, {}, {}));
    await expect(
      GitHubUtil.listRepositoriesForInstallation("123"),
    ).rejects.toThrow("invalid installation repository list");
  });
});
