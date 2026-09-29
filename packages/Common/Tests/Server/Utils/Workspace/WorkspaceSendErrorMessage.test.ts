import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Tests for WorkspaceBase.getSendErrorMessage and the provider send paths
 * that use it.
 *
 * The bug these pin down: Slack's sendPayloadBlocksToChannel, joinChannel and
 * isUserInChannel `throw response` on a failed call, and that response is an
 * HTTPErrorResponse. It is NOT an Error (it extends HTTPResponse), so the old
 * `e instanceof Error ? e.message : String(e)` in the send catch blocks turned
 * a Slack 429 or a Graph 5xx into "[object Object]". That string reached the
 * user-facing "Send Test" error and the Notification Logs of every real
 * notification.
 *
 * getSendErrorMessage unwraps each shape a send path can throw into a
 * readable, non-empty message, and Slack.sendMessage (per-channel catch) and
 * MicrosoftTeams.sendMessage (channel-id lookup, channel send and chat send
 * catches) now use it. The provider tests below reject with real
 * HTTPErrorResponse instances, built the same way Utils/API builds them.
 */

import WorkspaceBase, {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { MicrosoftTeamsChat } from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";

const UNKNOWN_ERROR: string = "Unknown error";
const OBJECT_OBJECT: string = "[object Object]";

function buildHTTPErrorResponse(
  statusCode: number,
  body: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

function buildMarkdownBlock(): WorkspacePayloadMarkdown {
  return {
    _type: "WorkspacePayloadMarkdown",
    text: "This is a test notification from OneUptime.",
  };
}

function errorTexts(response: WorkspaceSendMessageResponse): Array<string> {
  return (response.errors || []).map(
    (entry: { channel: WorkspaceChannel; error: string }): string => {
      return entry.error;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceBase.getSendErrorMessage", () => {
  describe("Error", () => {
    test("an Error gives its message", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(new Error("socket hang up")),
      ).toBe("socket hang up");
    });

    test("an Exception subclass gives its message", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          new BadDataException("Team ID is required to send messages."),
        ),
      ).toBe("Team ID is required to send messages.");
    });

    test("an Error with an empty message gives 'Unknown error'", () => {
      expect(WorkspaceBase.getSendErrorMessage(new Error(""))).toBe(
        UNKNOWN_ERROR,
      );
    });

    test("an Error with no message argument gives 'Unknown error'", () => {
      expect(WorkspaceBase.getSendErrorMessage(new Error())).toBe(
        UNKNOWN_ERROR,
      );
    });
  });

  describe("HTTPErrorResponse", () => {
    test("is not an Error, so String() of it is the '[object Object]' this helper replaces", () => {
      const response: HTTPErrorResponse = buildHTTPErrorResponse(429, {
        error: "ratelimited",
      });

      expect(response instanceof Error).toBe(false);
      expect(String(response)).toBe(OBJECT_OBJECT);
      expect(WorkspaceBase.getSendErrorMessage(response)).toBe("ratelimited");
    });

    test("a message in the body's `data` field is used", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(400, { data: "invalid_blocks" }),
        ),
      ).toBe("invalid_blocks");
    });

    test("a message in the body's `message` field is used", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(502, { message: "Bad Gateway" }),
        ),
      ).toBe("Bad Gateway");
    });

    test("a message in the body's `error` field is used", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(429, { ok: false, error: "ratelimited" }),
        ),
      ).toBe("ratelimited");
    });

    test("a Graph-style nested `error.message` is used", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(403, {
            error: {
              code: "Forbidden",
              message: "Missing role permissions on the request.",
            },
          }),
        ),
      ).toBe("Missing role permissions on the request.");
    });

    test("a response with an empty body reports its HTTP status", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(buildHTTPErrorResponse(503, {})),
      ).toBe("Request failed with HTTP status 503");
    });

    test("a response whose only message field is an empty string reports its HTTP status", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(500, { error: "" }),
        ),
      ).toBe("Request failed with HTTP status 500");
    });

    test("a response with unrelated body fields reports its HTTP status", () => {
      expect(
        WorkspaceBase.getSendErrorMessage(
          buildHTTPErrorResponse(404, { ok: false }),
        ),
      ).toBe("Request failed with HTTP status 404");
    });
  });

  describe("string", () => {
    test("a string gives itself", () => {
      expect(WorkspaceBase.getSendErrorMessage("graph exploded")).toBe(
        "graph exploded",
      );
    });

    test("an empty string gives 'Unknown error'", () => {
      expect(WorkspaceBase.getSendErrorMessage("")).toBe(UNKNOWN_ERROR);
    });
  });

  describe("plain object", () => {
    test("an object with a non-empty string message gives that message", () => {
      expect(
        WorkspaceBase.getSendErrorMessage({
          message: "conversation not found",
          statusCode: 404,
        }),
      ).toBe("conversation not found");
    });

    test("an object without a message falls back to String()", () => {
      const thrown: JSONObject = { code: "ECONNRESET" };

      expect(WorkspaceBase.getSendErrorMessage(thrown)).toBe(String(thrown));
    });

    test("an object with an empty message falls back to String()", () => {
      const thrown: JSONObject = { message: "" };

      expect(WorkspaceBase.getSendErrorMessage(thrown)).toBe(String(thrown));
    });

    test("an object whose message is not a string falls back to String()", () => {
      const thrown: JSONObject = { message: 42 };

      expect(WorkspaceBase.getSendErrorMessage(thrown)).toBe(String(thrown));
    });

    test("an object without a message uses its own toString()", () => {
      const thrown: { toString: () => string } = {
        toString: (): string => {
          return "custom failure description";
        },
      };

      expect(WorkspaceBase.getSendErrorMessage(thrown)).toBe(
        "custom failure description",
      );
    });
  });

  describe("null, undefined and primitives", () => {
    test("null gives 'Unknown error'", () => {
      expect(WorkspaceBase.getSendErrorMessage(null)).toBe(UNKNOWN_ERROR);
    });

    test("undefined gives 'Unknown error'", () => {
      expect(WorkspaceBase.getSendErrorMessage(undefined)).toBe(UNKNOWN_ERROR);
    });

    test("a number is stringified", () => {
      expect(WorkspaceBase.getSendErrorMessage(429)).toBe("429");
    });

    test("zero is stringified, not treated as missing", () => {
      expect(WorkspaceBase.getSendErrorMessage(0)).toBe("0");
    });

    test("a boolean is stringified", () => {
      expect(WorkspaceBase.getSendErrorMessage(false)).toBe("false");
    });
  });

  test.each([
    ["an Error", new Error("boom")],
    ["an empty Error", new Error("")],
    [
      "an HTTPErrorResponse with a body",
      buildHTTPErrorResponse(429, { error: "ratelimited" }),
    ],
    ["an HTTPErrorResponse without a body", buildHTTPErrorResponse(500, {})],
    ["a string", "boom"],
    ["an empty string", ""],
    ["an object with a message", { message: "boom" }],
    ["an object without a message", { code: 1 }],
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
  ])("%s always gives a non-empty string", (_label: string, err: unknown) => {
    const message: string = WorkspaceBase.getSendErrorMessage(err);

    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("SlackUtil.sendMessage - provider errors are readable", () => {
  const CHANNEL: WorkspaceChannel = {
    id: "C0ALERTS",
    name: "alerts",
    workspaceType: WorkspaceType.Slack,
  };

  function buildSlackPayload(): WorkspaceMessagePayload {
    return {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [CHANNEL.id],
      messageBlocks: [buildMarkdownBlock()],
      workspaceType: WorkspaceType.Slack,
    };
  }

  function callSendMessage(data: {
    userId: string;
  }): Promise<WorkspaceSendMessageResponse> {
    return SlackUtil.sendMessage({
      workspaceMessagePayload: buildSlackPayload(),
      authToken: "xoxb-test-token",
      userId: data.userId,
      projectId: ObjectID.generate(),
    });
  }

  function mockChannelLookup(): jest.SpyInstance {
    return jest
      .spyOn(SlackUtil, "getWorkspaceChannelFromChannelId")
      .mockResolvedValue(CHANNEL);
  }

  function mockUserInChannel(isInChannel: boolean): jest.SpyInstance {
    return jest
      .spyOn(SlackUtil, "isUserInChannel")
      .mockResolvedValue(isInChannel);
  }

  test("an HTTPErrorResponse from sendPayloadBlocksToChannel gives the readable Slack error", async () => {
    mockChannelLookup();
    mockUserInChannel(true);
    jest
      .spyOn(SlackUtil, "sendPayloadBlocksToChannel")
      .mockRejectedValue(
        buildHTTPErrorResponse(429, { ok: false, error: "ratelimited" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: CHANNEL,
        error: "ratelimited",
      },
    ]);
    expect(response.errors?.[0]?.error).not.toBe(OBJECT_OBJECT);
  });

  test("an HTTPErrorResponse with no body from sendPayloadBlocksToChannel reports its HTTP status", async () => {
    mockChannelLookup();
    mockUserInChannel(true);
    jest
      .spyOn(SlackUtil, "sendPayloadBlocksToChannel")
      .mockRejectedValue(buildHTTPErrorResponse(503, {}));

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(errorTexts(response)).toEqual([
      "Request failed with HTTP status 503",
    ]);
  });

  test("an HTTPErrorResponse from joinChannel gives the readable Slack error and nothing is posted", async () => {
    mockChannelLookup();
    mockUserInChannel(false);
    const joinSpy: jest.SpyInstance = jest
      .spyOn(SlackUtil, "joinChannel")
      .mockRejectedValue(
        buildHTTPErrorResponse(429, { ok: false, error: "ratelimited" }),
      );
    const sendSpy: jest.SpyInstance = jest.spyOn(
      SlackUtil,
      "sendPayloadBlocksToChannel",
    );

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(joinSpy).toHaveBeenCalledWith({
      authToken: "xoxb-test-token",
      channelId: CHANNEL.id,
    });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: CHANNEL,
        error: "ratelimited",
      },
    ]);
  });

  test("an HTTPErrorResponse from isUserInChannel gives the readable Slack error", async () => {
    mockChannelLookup();
    jest
      .spyOn(SlackUtil, "isUserInChannel")
      .mockRejectedValue(
        buildHTTPErrorResponse(500, { message: "internal_error" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(errorTexts(response)).toEqual(["internal_error"]);
  });

  test("an Error from sendPayloadBlocksToChannel still gives its message", async () => {
    mockChannelLookup();
    mockUserInChannel(true);
    jest
      .spyOn(SlackUtil, "sendPayloadBlocksToChannel")
      .mockRejectedValue(new Error("Error from Slack not_in_channel"));

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(errorTexts(response)).toEqual(["Error from Slack not_in_channel"]);
  });

  test("an Error from joinChannel still gives its message", async () => {
    mockChannelLookup();
    mockUserInChannel(false);
    jest
      .spyOn(SlackUtil, "joinChannel")
      .mockRejectedValue(new Error("Error from Slack is_archived"));

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    expect(errorTexts(response)).toEqual(["Error from Slack is_archived"]);
  });

  test("the real sendPayloadBlocksToChannel throwing Slack's HTTPErrorResponse gives the readable error", async () => {
    mockChannelLookup();
    const postSpy: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        buildHTTPErrorResponse(429, { ok: false, error: "ratelimited" }),
      );

    // No userId, so the membership check and join are skipped.
    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "",
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect((postSpy.mock.calls[0]![0] as { url: URL }).url.toString()).toBe(
      "https://slack.com/api/chat.postMessage",
    );
    expect(response.threads).toEqual([]);
    expect(errorTexts(response)).toEqual(["ratelimited"]);
  });

  test("the real joinChannel throwing Slack's HTTPErrorResponse gives the readable error", async () => {
    mockChannelLookup();
    mockUserInChannel(false);
    const postSpy: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        buildHTTPErrorResponse(403, { ok: false, error: "method_not_allowed" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage({
      userId: "U0ONCALL",
    });

    // The join failed, so chat.postMessage was never reached.
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect((postSpy.mock.calls[0]![0] as { url: URL }).url.toString()).toBe(
      "https://slack.com/api/conversations.join",
    );
    expect(errorTexts(response)).toEqual(["method_not_allowed"]);
  });
});

describe("MicrosoftTeamsUtil.sendMessage - provider errors are readable", () => {
  const TEAM_ID: string = "team-1";
  const CHANNEL_ID: string = "19:alerts@thread.tacv2";
  const CHAT_ID: string = "19:ops-chat@thread.v2";

  const CHANNEL: WorkspaceChannel = {
    id: CHANNEL_ID,
    name: "Alerts",
    workspaceType: WorkspaceType.MicrosoftTeams,
    teamId: TEAM_ID,
  };

  const CHAT: MicrosoftTeamsChat = {
    id: CHAT_ID,
    name: "Ops group chat",
    chatType: "groupChat",
  };

  function buildTeamsPayload(data: {
    channelIds?: Array<string> | undefined;
    chatIds?: Array<string> | undefined;
  }): WorkspaceMessagePayload {
    return {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: data.channelIds || [],
      chatIds: data.chatIds || [],
      messageBlocks: [buildMarkdownBlock()],
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAM_ID,
    };
  }

  function callSendMessage(
    payload: WorkspaceMessagePayload,
  ): Promise<WorkspaceSendMessageResponse> {
    return MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: payload,
      authToken: "graph-token",
      userId: "user-1",
      projectId: ObjectID.generate(),
    });
  }

  function mockChannelLookup(): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockResolvedValue(CHANNEL);
  }

  function mockChats(): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockResolvedValue({ [CHAT_ID]: CHAT });
  }

  test("an HTTPErrorResponse from the channel-id lookup gives the readable Graph error", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue(
        buildHTTPErrorResponse(403, {
          error: {
            code: "Forbidden",
            message: "Missing role permissions on the request.",
          },
        }),
      );
    const sendSpy: jest.SpyInstance = jest.spyOn(
      MicrosoftTeamsUtil,
      "sendAdaptiveCardToChannel",
    );

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({ channelIds: [CHANNEL_ID] }),
    );

    expect(sendSpy).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: {
          id: CHANNEL_ID,
          name: CHANNEL_ID,
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAM_ID,
        },
        error: "Missing role permissions on the request.",
      },
    ]);
  });

  test("an HTTPErrorResponse with no body from the channel-id lookup reports its HTTP status", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue(buildHTTPErrorResponse(404, {}));

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({ channelIds: [CHANNEL_ID] }),
    );

    expect(errorTexts(response)).toEqual([
      "Request failed with HTTP status 404",
    ]);
  });

  test("an HTTPErrorResponse from sendAdaptiveCardToChannel gives the readable error", async () => {
    mockChannelLookup();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockRejectedValue(
        buildHTTPErrorResponse(502, { message: "Bad Gateway" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({ channelIds: [CHANNEL_ID] }),
    );

    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: CHANNEL,
        error: "Bad Gateway",
      },
    ]);
  });

  test("an HTTPErrorResponse from sendAdaptiveCardToChat gives the readable error", async () => {
    mockChats();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockRejectedValue(
        buildHTTPErrorResponse(429, { data: "Too Many Requests" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({ chatIds: [CHAT_ID] }),
    );

    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: {
          id: CHAT_ID,
          name: "Ops group chat",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        error: "Too Many Requests",
      },
    ]);
  });

  test("HTTPErrorResponses at all three catch sites in one send are each readable", async () => {
    const goodChannelId: string = "19:good@thread.tacv2";
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation(
        async (args: { channelId: string }): Promise<WorkspaceChannel> => {
          if (args.channelId === CHANNEL_ID) {
            throw buildHTTPErrorResponse(404, {
              error: { code: "NotFound", message: "Channel not found." },
            });
          }
          return { ...CHANNEL, id: args.channelId, name: "Good" };
        },
      );
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockRejectedValue(buildHTTPErrorResponse(503, {}));
    mockChats();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockRejectedValue(
        buildHTTPErrorResponse(401, { error: "Authorization has been denied" }),
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({
        channelIds: [CHANNEL_ID, goodChannelId],
        chatIds: [CHAT_ID],
      }),
    );

    expect(errorTexts(response)).toEqual([
      "Channel not found.",
      "Request failed with HTTP status 503",
      "Authorization has been denied",
    ]);
    expect(errorTexts(response)).not.toContain(OBJECT_OBJECT);
  });

  test("an Error at each of the three catch sites still gives its message", async () => {
    const goodChannelId: string = "19:good@thread.tacv2";
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation(
        async (args: { channelId: string }): Promise<WorkspaceChannel> => {
          if (args.channelId === CHANNEL_ID) {
            throw new Error("lookup failed");
          }
          return { ...CHANNEL, id: args.channelId, name: "Good" };
        },
      );
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockRejectedValue(new Error("channel send failed"));
    mockChats();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockRejectedValue(new Error("chat send failed"));

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({
        channelIds: [CHANNEL_ID, goodChannelId],
        chatIds: [CHAT_ID],
      }),
    );

    expect(errorTexts(response)).toEqual([
      "lookup failed",
      "channel send failed",
      "chat send failed",
    ]);
  });

  test("a successful channel and chat send records threads and no errors", async () => {
    mockChannelLookup();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockImplementation(
        async (args: {
          workspaceChannel: WorkspaceChannel;
        }): Promise<WorkspaceThread> => {
          return {
            channel: args.workspaceChannel,
            threadId: "thread-channel",
          };
        },
      );
    mockChats();
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockImplementation(
        async (args: { chatId: string }): Promise<WorkspaceThread> => {
          return {
            channel: {
              id: args.chatId,
              name: CHAT.name,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: "thread-chat",
          };
        },
      );

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildTeamsPayload({ channelIds: [CHANNEL_ID], chatIds: [CHAT_ID] }),
    );

    expect(response.errors).toEqual([]);
    expect(response.threads).toHaveLength(2);
  });
});
