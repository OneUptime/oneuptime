import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";

/*
 * Reading the message someone reacted to. conversations.history only holds
 * top-level messages, so a pin on a reply in a thread — where most incident
 * discussion happens — used to find nothing and save nothing.
 */

const CHANNEL_ID: string = "C0INCIDENT";
const PARENT_TS: string = "1700000000.000100";
const REPLY_TS: string = "1700000000.000200";

type SlackCall = { method: string; data: JSONObject };

function mockSlack(responses: {
  history?: JSONObject | HTTPErrorResponse;
  replies?: JSONObject | HTTPErrorResponse;
}): Array<SlackCall> {
  const calls: Array<SlackCall> = [];

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { toString(): string };
    data: JSONObject;
  }) => {
    const method: string = options.url.toString().split("/api/")[1] || "";
    calls.push({ method: method, data: options.data });

    const response: JSONObject | HTTPErrorResponse | undefined =
      method === "conversations.history"
        ? responses.history
        : responses.replies;

    if (response instanceof HTTPErrorResponse) {
      return response;
    }

    return new HTTPResponse(200, response || { ok: true, messages: [] }, {});
  }) as any);

  return calls;
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("SlackUtil.getMessageDetailsByTimestamp", () => {
  test("a top-level message comes from conversations.history", async () => {
    const calls: Array<SlackCall> = mockSlack({
      history: {
        ok: true,
        messages: [{ ts: PARENT_TS, text: "DB is down" }],
      },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: PARENT_TS,
      }),
    ).resolves.toEqual({ text: "DB is down", threadTs: null });

    expect(calls).toEqual([
      {
        method: "conversations.history",
        data: {
          channel: CHANNEL_ID,
          latest: PARENT_TS,
          oldest: PARENT_TS,
          inclusive: true,
          limit: 1,
        },
      },
    ]);
  });

  test("a thread's parent reports its own ts as the thread", async () => {
    mockSlack({
      history: {
        ok: true,
        messages: [{ ts: PARENT_TS, thread_ts: PARENT_TS, text: "DB is down" }],
      },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: PARENT_TS,
      }),
    ).resolves.toEqual({ text: "DB is down", threadTs: PARENT_TS });
  });

  test("REGRESSION: a reply in a thread is read with conversations.replies", async () => {
    const calls: Array<SlackCall> = mockSlack({
      history: { ok: true, messages: [] },
      replies: {
        ok: true,
        // Slack always puts the parent first.
        messages: [
          { ts: PARENT_TS, thread_ts: PARENT_TS, text: "DB is down" },
          {
            ts: REPLY_TS,
            thread_ts: PARENT_TS,
            text: "Failed over to replica",
          },
        ],
      },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: REPLY_TS,
      }),
    ).resolves.toEqual({ text: "Failed over to replica", threadTs: PARENT_TS });

    expect(calls[1]).toEqual({
      method: "conversations.replies",
      data: {
        channel: CHANNEL_ID,
        ts: REPLY_TS,
        latest: REPLY_TS,
        oldest: REPLY_TS,
        inclusive: true,
        limit: 10,
      },
    });
  });

  test("the parent is never mistaken for the reply that was reacted to", async () => {
    mockSlack({
      history: { ok: true, messages: [] },
      replies: {
        ok: true,
        messages: [{ ts: PARENT_TS, thread_ts: PARENT_TS, text: "DB is down" }],
      },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: REPLY_TS,
      }),
    ).resolves.toBeNull();
  });

  test("history returning a different message falls through to replies", async () => {
    const calls: Array<SlackCall> = mockSlack({
      history: { ok: true, messages: [{ ts: PARENT_TS, text: "other" }] },
      replies: {
        ok: true,
        messages: [{ ts: REPLY_TS, thread_ts: PARENT_TS, text: "the reply" }],
      },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: REPLY_TS,
      }),
    ).resolves.toEqual({ text: "the reply", threadTs: PARENT_TS });

    expect(
      calls.map((call: SlackCall) => {
        return call.method;
      }),
    ).toEqual(["conversations.history", "conversations.replies"]);
  });

  test("a message with no text is null", async () => {
    mockSlack({
      history: { ok: true, messages: [{ ts: PARENT_TS, text: "" }] },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: PARENT_TS,
      }),
    ).resolves.toBeNull();
  });

  test("Slack refusing the read is an error, not an empty message", async () => {
    mockSlack({
      history: { ok: false, error: "not_in_channel" },
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: PARENT_TS,
      }),
    ).rejects.toThrow("Error from Slack not_in_channel");
  });

  test("an HTTP error is thrown", async () => {
    mockSlack({
      history: new HTTPErrorResponse(500, { error: "boom" }, {}),
    });

    await expect(
      SlackUtil.getMessageDetailsByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: PARENT_TS,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("SlackUtil.getMessageByTimestamp", () => {
  test("returns the text, including a reply's", async () => {
    mockSlack({
      history: { ok: true, messages: [] },
      replies: {
        ok: true,
        messages: [{ ts: REPLY_TS, thread_ts: PARENT_TS, text: "the reply" }],
      },
    });

    await expect(
      SlackUtil.getMessageByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: REPLY_TS,
      }),
    ).resolves.toBe("the reply");
  });

  test("returns null when the message is not found anywhere", async () => {
    mockSlack({});

    await expect(
      SlackUtil.getMessageByTimestamp({
        authToken: "xoxb",
        channelId: CHANNEL_ID,
        messageTs: REPLY_TS,
      }),
    ).resolves.toBeNull();
  });
});
