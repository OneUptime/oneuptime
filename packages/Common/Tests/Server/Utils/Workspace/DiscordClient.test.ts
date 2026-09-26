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

  /*
   * The lifecycle and interaction transports share one request helper after
   * composition. Preserve the audit reason on bot requests without adding bot
   * credentials to token-authenticated interaction webhooks.
   */
  test("preserves the opaque lifecycle audit reason with bot authorization", async (): Promise<void> => {
    (API.fetch as jest.Mock).mockResolvedValue(new HTTPResponse(200, {}, {}));
    const auditLogReason: string =
      "oneuptime:11111111-1111-4111-8111-111111111111";
    await DiscordClient.request({
      authToken,
      method: HTTPMethod.POST,
      path: `/channels/${channelId}/threads`,
      auditLogReason,
      body: { name: "Thread" },
    });
    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    expect(request.headers).toEqual({
      Authorization: `Bot ${authToken}`,
      "X-Audit-Log-Reason": auditLogReason,
    });
  });

  test("refuses a non-opaque audit reason before making a request", async (): Promise<void> => {
    await expect(
      DiscordClient.request({
        authToken,
        method: HTTPMethod.POST,
        path: `/channels/${channelId}/threads`,
        auditLogReason: "customer title must not enter audit logs",
      }),
    ).rejects.toThrow("Invalid Discord audit log reason");
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("rejects dot-segment traversal in a prebuilt bot path", async () => {
    await expect(
      DiscordClient.request({
        authToken,
        method: HTTPMethod.GET,
        path: "/channels/../users/@me",
      }),
    ).rejects.toThrow("Invalid Discord API request");
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

  test("encodes arbitrary UTF-8 path segments exactly once", () => {
    expect(DiscordClient.encodePathSegment("🔥/incident%2Fstate")).toBe(
      "%F0%9F%94%A5%2Fincident%252Fstate",
    );
    expect((): string => {
      return DiscordClient.encodePathSegment("");
    }).toThrow("path segment");
  });

  test("edits a deferred interaction through its encoded webhook token without bot authorization", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(new HTTPResponse(200, {}, {}));
    await DiscordClient.editOriginalInteractionResponse({
      applicationId: channelId,
      interactionToken: "token/🔥%2Fpart",
      message: {
        content: "done",
        allowed_mentions: { parse: [], replied_user: false },
      },
    });
    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    expect(request.method).toBe(HTTPMethod.PATCH);
    expect(request.url.toString()).toBe(
      `https://discord.com/api/v10/webhooks/${channelId}/token%2F%F0%9F%94%A5%252Fpart/messages/@original`,
    );
    expect(request.headers?.["Authorization"]).toBeUndefined();
    expect(request.options).toMatchObject({
      retries: 0,
      doNotFollowRedirects: true,
    });
  });

  test("upserts owned guild commands without replacing unrelated commands", async () => {
    (API.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new HTTPResponse(
          200,
          [
            {
              id: "666666666666666666",
              name: "unrelated",
              description: "Another integration owns this",
              type: 1,
            },
            {
              id: "777777777777777777",
              name: "incident-state",
              description: "Old description",
              type: 1,
            },
          ],
          {},
        ),
      )
      .mockResolvedValue(new HTTPResponse(200, {}, {}));
    await DiscordClient.upsertGuildCommands({
      authToken,
      applicationId: channelId,
      guildId: "987654321098765432",
      commands: [
        {
          name: "incident-state",
          description: "Change an incident state",
          type: 1,
          options: [],
        },
        {
          name: "incident-note",
          description: "Add an incident note",
          type: 1,
          options: [],
        },
      ],
    });
    const requests: Array<APIFetchOptions> = (
      API.fetch as jest.Mock
    ).mock.calls.map((call: Array<APIFetchOptions>): APIFetchOptions => {
      return call[0]!;
    });
    expect(requests[0]!.method).toBe(HTTPMethod.GET);
    expect(requests[0]!.url.toString()).toBe(
      `https://discord.com/api/v10/applications/${channelId}/guilds/987654321098765432/commands`,
    );
    expect(requests[1]!.method).toBe(HTTPMethod.PATCH);
    expect(requests[1]!.url.toString()).toContain(
      "/commands/777777777777777777",
    );
    expect(requests[2]!.method).toBe(HTTPMethod.POST);
    expect(
      requests.every((request: APIFetchOptions): boolean => {
        return request.method !== HTTPMethod.PUT;
      }),
    ).toBe(true);
    expect(
      requests.some((request: APIFetchOptions): boolean => {
        return request.url.toString().includes("666666666666666666");
      }),
    ).toBe(false);
    expect(requests[1]!.headers?.["Authorization"]).toBe(`Bot ${authToken}`);
  });
});

describe("Discord reaction path transport (HOM-43)", () => {
  const authToken: string = "test-discord-token";
  const channelId: string = "123456789012345678";
  const messageId: string = "234567890123456789";

  afterEach((): void => {
    jest.resetAllMocks();
  });

  test("rejects non-snowflake channel or message ids before sending credentials", async () => {
    await expect(
      DiscordClient.getChannelReactions({
        authToken: authToken,
        channelId: "../../guilds/@me",
        messageId: messageId,
        emoji: "📌",
      }),
    ).rejects.toThrow("identifier");

    await expect(
      DiscordClient.getChannelReactions({
        authToken: authToken,
        channelId: channelId,
        messageId: "not-a-snowflake",
        emoji: "📌",
      }),
    ).rejects.toThrow("identifier");

    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("rejects an empty emoji before sending credentials", async () => {
    await expect(
      DiscordClient.getChannelReactions({
        authToken: authToken,
        channelId: channelId,
        messageId: messageId,
        emoji: "",
      }),
    ).rejects.toThrow();
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("percent-encodes a unicode emoji and appends the note-reaction query", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(new HTTPResponse(200, [], {}));

    await DiscordClient.getChannelReactions({
      authToken: authToken,
      channelId: channelId,
      messageId: messageId,
      emoji: "📌",
    });

    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    expect(request.url.toString()).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/%F0%9F%93%8C?limit=100&type=0`,
    );
  });

  test("encodes a custom emoji name:id so the colon cannot split the path", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(new HTTPResponse(200, [], {}));

    await DiscordClient.getChannelReactions({
      authToken: authToken,
      channelId: channelId,
      messageId: messageId,
      emoji: "custompin:456789012345678901",
    });

    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    expect(request.url.toString()).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/custompin%3A456789012345678901?limit=100&type=0`,
    );
  });

  test("emoji encoding never leaves a raw percent or slash unescaped", async () => {
    (API.fetch as jest.Mock).mockResolvedValue(new HTTPResponse(200, [], {}));

    await DiscordClient.getChannelReactions({
      authToken: authToken,
      channelId: channelId,
      messageId: messageId,
      emoji: "a/b%c?d#e",
    });

    const request: APIFetchOptions = (API.fetch as jest.Mock).mock.calls[0]![0];
    const path: string = request.url.toString();
    expect(path).toContain("/reactions/");
    const segment: string = path.split("/reactions/")[1]!.split("?")[0]!;
    expect(segment).not.toMatch(/[/?#]/);
    expect(decodeURIComponent(segment)).toBe("a/b%c?d#e");
  });
});
