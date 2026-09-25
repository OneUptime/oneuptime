import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import API, { APIFetchOptions } from "../../../../Utils/API";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";

jest.mock("../../../../Utils/API", () => {
  return { __esModule: true, default: { fetch: jest.fn() } };
});

describe("Discord API transport", () => {
  const authToken: string = "test-discord-token";
  const channelId: string = "123456789012345678";

  afterEach(() => {
    jest.resetAllMocks();
    jest.useRealTimers();
  });

  test("pins the destination, suppresses automatic retries and returns the message ID", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(
      new HTTPResponse(200, { id: channelId }, {}),
    );
    await expect(
      DiscordClient.sendMessage({
        authToken,
        channelId,
        message: { content: "hello" },
      }),
    ).resolves.toBe(channelId);
    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    expect(request.url.toString()).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
    );
    expect(request.headers?.["Authorization"]).toBe(`Bot ${authToken}`);
    expect(request.options).toMatchObject({
      retries: 0,
      doNotFollowRedirects: true,
    });
  });

  test("rejects path injection before sending bot credentials", async () => {
    await expect(
      DiscordClient.sendMessage({
        authToken,
        channelId: "../users/@me",
        message: {},
      }),
    ).rejects.toThrow("identifier");
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("does not retry a forbidden request or expose provider response data", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(403, { message: "sensitive-provider-detail" }, {}),
    );
    await expect(
      DiscordClient.request({
        authToken,
        method: HTTPMethod.GET,
        path: `/channels/${channelId}`,
      }),
    ).rejects.toThrow("HTTP 403");
    expect(API.fetch).toHaveBeenCalledTimes(1);
  });

  test("honors a bounded Discord retry_after", async () => {
    jest.useFakeTimers();
    (API.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new HTTPErrorResponse(429, { retry_after: 0.5 }, {}),
      )
      .mockResolvedValueOnce(new HTTPResponse(200, { id: channelId }, {}));
    const request: Promise<string> = DiscordClient.openDirectMessage({
      authToken,
      userId: channelId,
    });
    await Promise.resolve();
    expect(API.fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(500);
    await expect(request).resolves.toBe(channelId);
    expect(API.fetch).toHaveBeenCalledTimes(2);
  });

  test("surfaces long rate limits instead of blocking a worker indefinitely", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(429, { retry_after: 60 }, {}),
    );
    await expect(
      DiscordClient.openDirectMessage({ authToken, userId: channelId }),
    ).rejects.toThrow("HTTP 429");
    expect(API.fetch).toHaveBeenCalledTimes(1);
  });
});
