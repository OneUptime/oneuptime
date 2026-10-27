import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../../Server/Utils/Logger";
import SlackAiConversations, {
  SlackMessage,
  SlackMessageKind,
  SlackThreadMessage,
  SlackThreadPerson,
} from "../../../../../Server/Utils/Workspace/Slack/SlackAiConversations";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * WHAT OF SLACK'S MESSAGES IS ADDRESSED TO ONEUPTIME (#4768).
 *
 * The app hears every message of the channels it is in. It used to answer
 * every reply in a thread with a bot's message in it - every notification's
 * thread - so people talking to each other under an incident were answered
 * by OneUptime, each of them, every time. read() decides from the event
 * alone what a message is to OneUptime; a conversation with OneUptime AI is
 * the thread under a question asked at the top of a channel, and who is in
 * it is kept in the cache (join / isIn). SlackEventsRoute.test.ts drives
 * all of it through Slack's endpoint; these pin each piece.
 */

jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

const TEAM_ID: string = "T0ACME";
const ONEUPTIME: string = "U0ONEUPTIME";
const OPS: string = "C0OPS";
const ALICE: string = "U0ALICE";
const QUESTION_TS: string = "1760000001.000100";
const REPLY_TS: string = "1760000002.000100";

// A key of this module's in the cache: its namespace, then a SHA-256 digest.
const CONVERSATION_KEY: RegExp = /^slack-ai-conversation-[0-9a-f]{64}$/;
const CONVERSATION_THREAD_KEY: RegExp =
  /^slack-ai-conversation-thread-[0-9a-f]{64}$/;

function callback(event: JSONObject): JSONObject {
  return {
    token: "verification-token",
    team_id: TEAM_ID,
    api_app_id: "A0ONEUPTIME",
    event: event,
    type: "event_callback",
    event_id: "Ev0001",
    event_time: 1760000002,
  };
}

function channelMessage(fields: JSONObject = {}): JSONObject {
  return callback({
    type: "message",
    channel: OPS,
    channel_type: "channel",
    user: ALICE,
    text: "since when?",
    ts: REPLY_TS,
    thread_ts: QUESTION_TS,
    parent_user_id: ALICE,
    ...fields,
  });
}

beforeEach(() => {
  (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackAiConversations.read: what a message is, from the event alone", () => {
  test("an @mention at the top of a channel", () => {
    expect(
      SlackAiConversations.read(
        callback({
          type: "app_mention",
          channel: OPS,
          user: ALICE,
          text: `<@${ONEUPTIME}> which monitors are down?`,
          ts: QUESTION_TS,
          event_ts: QUESTION_TS,
        }),
      ),
    ).toEqual({
      kind: SlackMessageKind.Mention,
      teamId: TEAM_ID,
      channelId: OPS,
      userId: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
      ts: QUESTION_TS,
    });
  });

  test("an @mention in a thread names the thread", () => {
    expect(
      SlackAiConversations.read(
        callback({
          type: "app_mention",
          channel: OPS,
          user: ALICE,
          text: `<@${ONEUPTIME}> what changed?`,
          ts: REPLY_TS,
          thread_ts: QUESTION_TS,
        }),
      ),
    ).toMatchObject({
      kind: SlackMessageKind.Mention,
      threadTs: QUESTION_TS,
      ts: REPLY_TS,
    });
  });

  test("a direct message, at its top or in a thread of it", () => {
    const direct: JSONObject = {
      type: "message",
      channel: "D0ALICE",
      channel_type: "im",
      user: ALICE,
      text: "which monitors are down?",
      ts: QUESTION_TS,
    };

    expect(SlackAiConversations.read(callback(direct))).toEqual({
      kind: SlackMessageKind.DirectMessage,
      teamId: TEAM_ID,
      channelId: "D0ALICE",
      userId: ALICE,
      text: "which monitors are down?",
      ts: QUESTION_TS,
    });
    expect(
      SlackAiConversations.read(
        callback({ ...direct, ts: REPLY_TS, thread_ts: QUESTION_TS }),
      ),
    ).toMatchObject({
      kind: SlackMessageKind.DirectMessage,
      threadTs: QUESTION_TS,
    });
  });

  test.each([["channel"], ["group"], ["mpim"]])(
    "a plain reply in a thread of a %s: a reply, decided on by the conversation it is in",
    (channelType: string) => {
      expect(
        SlackAiConversations.read(
          channelMessage({ channel_type: channelType }),
        ),
      ).toEqual({
        kind: SlackMessageKind.ThreadReply,
        teamId: TEAM_ID,
        channelId: OPS,
        userId: ALICE,
        text: "since when?",
        ts: REPLY_TS,
        threadTs: QUESTION_TS,
      });
    },
  );

  test.each([
    [
      "a message at the top of a channel",
      { thread_ts: undefined, parent_user_id: undefined },
      "a message at the top of a channel that mentions nobody",
    ],
    [
      "a thread's first message (its thread_ts is its own ts)",
      { ts: QUESTION_TS, thread_ts: QUESTION_TS },
      "a message at the top of a channel that mentions nobody",
    ],
    [
      "a reply that mentions OneUptime (answered as its app_mention)",
      { text: `<@${ONEUPTIME}> since when?` },
      "a message that mentions somebody",
    ],
    [
      "a message at the top of a channel that mentions OneUptime",
      {
        thread_ts: undefined,
        parent_user_id: undefined,
        text: `<@${ONEUPTIME}> hi`,
      },
      "a message that mentions somebody",
    ],
    [
      "a reply that mentions a colleague",
      { text: "<@U0BOB> can you look?" },
      "a message that mentions somebody",
    ],
    [
      "a reply that mentions a colleague, older form",
      { text: "over to <@U0BOB|bob>" },
      "a message that mentions somebody",
    ],
    [
      "a reply that mentions a user group",
      { text: "<!subteam^S0ONCALL|@oncall> please look" },
      "a message that mentions somebody",
    ],
    [
      "a reply to <!here>",
      { text: "<!here> rolling back" },
      "a message that mentions somebody",
    ],
    [
      "a reply to <!channel>",
      { text: "<!channel> heads up" },
      "a message that mentions somebody",
    ],
    [
      "a reply to <!everyone>",
      { text: "<!everyone> all clear" },
      "a message that mentions somebody",
    ],
    [
      "a bot's reply (OneUptime's own included)",
      { user: ONEUPTIME, bot_id: "B0ONEUPTIME" },
      "a bot's message, or a change to a channel or a message",
    ],
    [
      "an edit",
      { subtype: "message_changed" },
      "a bot's message, or a change to a channel or a message",
    ],
    [
      "a reply also sent to the channel",
      { subtype: "thread_broadcast" },
      "a bot's message, or a change to a channel or a message",
    ],
    [
      "a reply with no author",
      { user: undefined },
      "no workspace, channel or author",
    ],
  ])(
    "%s: not addressed to OneUptime",
    (_name: string, fields: JSONObject, reason: string) => {
      const message: SlackMessage | null = SlackAiConversations.read(
        channelMessage(fields),
      );

      expect(message?.kind).toBe(SlackMessageKind.NotAddressed);
      expect(message?.reason).toBe(reason);
    },
  );

  test("a link to a channel or a web page is no mention", () => {
    expect(
      SlackAiConversations.read(
        channelMessage({
          text: "see <#C0INC|inc-42> and <https://status.acme.test|the status page>",
        }),
      )?.kind,
    ).toBe(SlackMessageKind.ThreadReply);
  });

  /*
   * A mention's label ends at the next "<" or ">": Slack writes those of a
   * message's own text as &lt; and &gt;. A label that ran on to the next
   * ">" was tried from every unclosed mention to the end of the message,
   * in time that grows with the square of its length: 40,000 characters
   * (the most Slack sends) of "<@0|" took 268 ms, and these take seconds.
   */
  test.each([
    ["unclosed mentions of people", "<@0|"],
    ["unclosed mentions of everybody", "<!here|"],
  ])(
    "a message of %s is read in time that grows with its length",
    (_name: string, unclosed: string) => {
      const text: string = unclosed.repeat(Math.ceil(400000 / unclosed.length));

      const timed: FastestRun<SlackMessage | null> = fastestRun({
        run: (): SlackMessage | null => {
          return SlackAiConversations.read(channelMessage({ text: text }));
        },
        limitInMs: 2000,
      });
      const message: SlackMessage | null = timed.result;

      expect(message?.kind).toBe(SlackMessageKind.ThreadReply);
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("a mention after many unclosed ones is still a mention", () => {
    expect(
      SlackAiConversations.read(
        channelMessage({ text: `${"<@0|".repeat(50000)}<@U0BOB|bob> look` }),
      )?.reason,
    ).toBe("a message that mentions somebody");
  });

  test.each([
    ["no event", { type: "event_callback" }],
    ["a reaction", callback({ type: "reaction_added", user: ALICE })],
    ["a pin", callback({ type: "pin_added", user: ALICE })],
    [
      "a message with no channel type",
      callback({ type: "message", user: ALICE, text: "hi", ts: REPLY_TS }),
    ],
    [
      "a message of a channel type Slack has no events for here",
      callback({
        type: "message",
        channel_type: "app_home",
        user: ALICE,
        text: "hi",
        ts: REPLY_TS,
      }),
    ],
    ["an event that is a list", { event: [] }],
  ])("%s: not a message at all", (_name: string, payload: JSONObject) => {
    expect(SlackAiConversations.read(payload)).toBeNull();
  });
});

describe("where an answer goes, and what a conversation is", () => {
  const reply: SlackMessage = {
    kind: SlackMessageKind.ThreadReply,
    teamId: TEAM_ID,
    channelId: OPS,
    userId: ALICE,
    text: "since when?",
    ts: REPLY_TS,
    threadTs: QUESTION_TS,
  };
  const question: SlackMessage = {
    kind: SlackMessageKind.Mention,
    teamId: TEAM_ID,
    channelId: OPS,
    userId: ALICE,
    text: `<@${ONEUPTIME}> which monitors are down?`,
    ts: QUESTION_TS,
  };
  const directMessage: SlackMessage = {
    kind: SlackMessageKind.DirectMessage,
    teamId: TEAM_ID,
    channelId: "D0ALICE",
    userId: ALICE,
    text: "which monitors are down?",
    ts: REPLY_TS,
  };

  test("getThreadTs: the thread a message is in, or the one it starts", () => {
    expect(SlackAiConversations.getThreadTs(reply)).toBe(QUESTION_TS);
    expect(SlackAiConversations.getThreadTs(question)).toBe(QUESTION_TS);
    expect(SlackAiConversations.getThreadTs(directMessage)).toBe(REPLY_TS);
  });

  test("getConversation: a channel's thread - the question and its replies are one - or the whole of a direct message", () => {
    expect(SlackAiConversations.getConversation(reply)).toEqual({
      workspaceType: WorkspaceType.Slack,
      workspaceId: TEAM_ID,
      conversationId: `${OPS}:${QUESTION_TS}`,
      workspaceUserId: ALICE,
    });
    expect(SlackAiConversations.getConversation(question)).toEqual(
      SlackAiConversations.getConversation(reply),
    );
    expect(SlackAiConversations.getConversation(directMessage)).toEqual({
      workspaceType: WorkspaceType.Slack,
      workspaceId: TEAM_ID,
      conversationId: "D0ALICE",
      workspaceUserId: ALICE,
    });
    expect(
      SlackAiConversations.getConversation({
        ...directMessage,
        ts: "1760000009.000100",
        threadTs: REPLY_TS,
      }),
    ).toEqual(SlackAiConversations.getConversation(directMessage));
  });

  test("getConnectPromptPlace: in the thread a reply is in; under a question at the top of a channel in the channel, since a thread with no replies shows no message only one person sees; in a direct message, as the app's own message - with the direct messages to come back to, and no channel to answer in", () => {
    expect(
      SlackAiConversations.getConnectPromptPlace({
        message: reply,
        projectAuthToken: "xoxb",
      }),
    ).toEqual({
      projectAuthToken: "xoxb",
      slackUserId: ALICE,
      slackChannelId: OPS,
      slackThreadTs: QUESTION_TS,
    });
    expect(
      SlackAiConversations.getConnectPromptPlace({
        message: question,
        projectAuthToken: "xoxb",
      }),
    ).toEqual({
      projectAuthToken: "xoxb",
      slackUserId: ALICE,
      slackChannelId: OPS,
    });
    expect(
      SlackAiConversations.getConnectPromptPlace({
        message: directMessage,
        projectAuthToken: "xoxb",
      }),
    ).toEqual({
      projectAuthToken: "xoxb",
      slackUserId: ALICE,
      slackDirectMessageChannelId: "D0ALICE",
    });
  });

  test("getConnectPromptPlace: a reply in a thread of a direct message is asked in the direct messages too, never in that thread", () => {
    const place: ReturnType<typeof SlackAiConversations.getConnectPromptPlace> =
      SlackAiConversations.getConnectPromptPlace({
        message: { ...directMessage, threadTs: QUESTION_TS },
        projectAuthToken: "xoxb",
      });

    expect(place).toEqual({
      projectAuthToken: "xoxb",
      slackUserId: ALICE,
      slackDirectMessageChannelId: "D0ALICE",
    });
    // No channel and no thread: nothing a message only they see is posted in.
    expect(place.slackChannelId).toBeUndefined();
    expect(place.slackThreadTs).toBeUndefined();
  });
});

describe("SlackAiConversations.isStartedByAQuestion: a thread whose first message is a person's question to OneUptime", () => {
  function thread(first: SlackThreadMessage): Array<SlackThreadMessage> {
    return [
      { ts: QUESTION_TS, ...first },
      { ts: REPLY_TS, user: ONEUPTIME, bot_id: "B0ONEUPTIME", text: "…" },
    ];
  }

  test.each([
    [
      "a person's question that mentions OneUptime",
      { user: ALICE, text: `<@${ONEUPTIME}> which monitors are down?` },
      true,
    ],
    [
      "…mentioning it the older way",
      { user: ALICE, text: `hey <@${ONEUPTIME}|oneuptime>, what is down?` },
      true,
    ],
    [
      "OneUptime's own notification",
      {
        user: ONEUPTIME,
        bot_id: "B0ONEUPTIME",
        text: "🔴 Incident INC-42 created",
      },
      false,
    ],
    [
      "OneUptime's own message, even if it names itself",
      { user: ONEUPTIME, text: `<@${ONEUPTIME}> posted this` },
      false,
    ],
    [
      "another app's message that mentions OneUptime",
      { user: "U0GITHUB", bot_id: "B0GITHUB", text: `<@${ONEUPTIME}> deploy` },
      false,
    ],
    [
      "a person's message that mentions somebody else",
      { user: ALICE, text: "<@U0BOB> are you seeing this?" },
      false,
    ],
    [
      "a person's message mentioning a user whose id starts with OneUptime's",
      { user: ALICE, text: `<@${ONEUPTIME}X> hi` },
      false,
    ],
    [
      "a thread_broadcast or other subtype",
      {
        user: ALICE,
        subtype: "thread_broadcast",
        text: `<@${ONEUPTIME}> hi`,
      },
      false,
    ],
  ])("%s", (_name: string, first: SlackThreadMessage, expected: boolean) => {
    expect(
      SlackAiConversations.isStartedByAQuestion({
        threadTs: QUESTION_TS,
        messages: thread(first),
        botUserId: ONEUPTIME,
      }),
    ).toBe(expected);
  });

  test("without knowing OneUptime's own Slack user, no thread is taken for one", () => {
    expect(
      SlackAiConversations.isStartedByAQuestion({
        threadTs: QUESTION_TS,
        messages: thread({
          user: ALICE,
          text: `<@${ONEUPTIME}> which monitors are down?`,
        }),
        botUserId: undefined,
      }),
    ).toBe(false);
  });

  test("a thread whose first message Slack did not return is not taken for one", () => {
    expect(
      SlackAiConversations.isStartedByAQuestion({
        threadTs: "1760000000.999999",
        messages: thread({
          user: ALICE,
          text: `<@${ONEUPTIME}> which monitors are down?`,
        }),
        botUserId: ONEUPTIME,
      }),
    ).toBe(false);
  });
});

describe("which threads are conversations, and who is in them: remember, isConversation and isIn", () => {
  const alice: SlackThreadPerson = {
    teamId: TEAM_ID,
    channelId: OPS,
    threadTs: QUESTION_TS,
    userId: ALICE,
  };

  test("a thread remembered is a conversation, and the person remembered in it is in it - in that thread only, and nobody else is", async () => {
    expect(await SlackAiConversations.isConversation(alice)).toBe(false);
    expect(await SlackAiConversations.isIn(alice)).toBe(false);

    await SlackAiConversations.remember(alice);

    expect(await SlackAiConversations.isConversation(alice)).toBe(true);
    expect(await SlackAiConversations.isIn(alice)).toBe(true);
    // Bob is in it once he mentions OneUptime there, not before.
    expect(await SlackAiConversations.isIn({ ...alice, userId: "U0BOB" })).toBe(
      false,
    );
    expect(
      await SlackAiConversations.isConversation({
        ...alice,
        threadTs: "1760000003.000100",
      }),
    ).toBe(false);
    expect(
      await SlackAiConversations.isIn({
        ...alice,
        threadTs: "1760000003.000100",
      }),
    ).toBe(false);
    expect(
      await SlackAiConversations.isIn({ ...alice, channelId: "C0OTHER" }),
    ).toBe(false);
    expect(
      await SlackAiConversations.isIn({ ...alice, teamId: "T0OTHER" }),
    ).toBe(false);

    await SlackAiConversations.remember({ ...alice, userId: "U0BOB" });

    expect(await SlackAiConversations.isIn({ ...alice, userId: "U0BOB" })).toBe(
      true,
    );
  });

  test("for a week from the last message there", async () => {
    await SlackAiConversations.remember(alice);

    expect(SlackAiConversations.OPEN_FOR_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "slack-ai-conversation",
      expect.any(String),
      "1",
      { expiresInSeconds: 7 * 24 * 60 * 60 },
    );
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "slack-ai-conversation-thread",
      expect.any(String),
      "1",
      { expiresInSeconds: 7 * 24 * 60 * 60 },
    );

    const now: number = Date.now();
    const clock: jest.SpyInstance = jest.spyOn(Date, "now");

    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 - 1000);
    expect(await SlackAiConversations.isIn(alice)).toBe(true);
    expect(await SlackAiConversations.isConversation(alice)).toBe(true);

    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 + 1000);
    expect(await SlackAiConversations.isIn(alice)).toBe(false);
    expect(await SlackAiConversations.isConversation(alice)).toBe(false);
  });

  test("the cache names nobody: its keys are digests of who and where", async () => {
    await SlackAiConversations.remember(alice);

    const keys: Array<string> = Array.from(
      (GlobalCache as unknown as { store: Map<string, unknown> }).store.keys(),
    ).sort();

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(CONVERSATION_KEY);
    expect(keys[1]).toMatch(CONVERSATION_THREAD_KEY);
  });

  test("a cache that cannot be read: nobody is in a conversation and no thread is one - a reply is not answered, never answered by mistake - and remembering throws nothing", async () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {});
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected"));

    await expect(SlackAiConversations.remember(alice)).resolves.toBeUndefined();
    await expect(SlackAiConversations.isIn(alice)).resolves.toBe(false);
    await expect(SlackAiConversations.isConversation(alice)).resolves.toBe(
      false,
    );
  });
});
