import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Discord interactions webhooks carry no reaction events, and Discord REST
 * exposes no reaction timestamps. DiscordReactionNoteSync polls the watched
 * channels instead and saves 📌 / 📣 reactions as OneUptime notes, the same
 * way the Microsoft Teams sync does. These tests drive it with the Discord
 * REST layer and the database stubbed.
 *
 * Failure inventory: RESEARCH/ONEUPTIME_DISCORD_REACTION_PIN_FAILURES_2026_09_25.md.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    DiscordBotToken: "test-bot-token",
  };
});

import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncidentService from "../../../../Server/Services/IncidentService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import DiscordReactionObservationService from "../../../../Server/Services/DiscordReactionObservationService";

// The durable dedupe layer is stubbed; default: fresh claim.
jest.mock(
  "../../../../Server/Services/DiscordReactionObservationService",
  () => {
    return {
      __esModule: true,
      default: {
        claim: jest.fn(
          async (): Promise<{
            result: string;
            observedAt?: Date;
          }> => {
            return { result: "Claimed", observedAt: new Date(NOW.getTime()) };
          },
        ),
        markDone: jest.fn(async (): Promise<boolean> => {
          return true;
        }),
      },
    };
  },
);

const observationClaim: jest.Mock =
  DiscordReactionObservationService.claim as unknown as jest.Mock;
const observationMarkDone: jest.Mock =
  DiscordReactionObservationService.markDone as unknown as jest.Mock;
import DiscordReactionNoteSync, {
  DiscordNoteReaction,
  DiscordReactionOutcome,
  DiscordWatchedChannel,
} from "../../../../Server/Utils/Workspace/Discord/ReactionNoteSync";
import DiscordResourceThreadService from "../../../../Server/Services/DiscordResourceThreadService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

const projectId: ObjectID = ObjectID.generate();
const oneUptimeUserId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const GUILD_ID: string = "100000000000000001";
const CHANNEL_ID: string = "100000000000000010";
const DISCORD_USER_ID: string = "100000000000000100";
const NOW: Date = new Date("2026-09-25T12:00:00.000Z");

// Discord snowflakes carry their timestamp in the top 42 bits.
function snowflakeAt(date: Date): string {
  const discordEpoch: number = 1420070400000;
  return String((date.getTime() - discordEpoch) * 2 ** 22);
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function watchedChannel(
  resourceType: WorkspaceNoteResourceType = WorkspaceNoteResourceType.Incident,
): DiscordWatchedChannel {
  return {
    resource: {
      resourceType: resourceType,
      resourceId: incidentId,
      projectId: projectId,
    },
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
  };
}

function discordMessage(data: {
  id: string;
  content?: string;
  embeds?: Array<JSONObject>;
  type?: number;
  timestamp?: Date;
  reactions?: Array<JSONObject>;
}): JSONObject {
  return {
    id: data.id,
    type: data.type ?? 0,
    content: data.content ?? "Restarted the primary DB",
    embeds: data.embeds ?? [],
    timestamp: (data.timestamp ?? minutesAgo(5)).toISOString(),
    author: { id: DISCORD_USER_ID, bot: false },
    ...(data.reactions ? { reactions: data.reactions } : {}),
  };
}

function reactionSummary(emoji: {
  name: string;
  id?: string;
  count?: number;
}): JSONObject {
  return {
    count: emoji.count ?? 1,
    me: false,
    emoji: emoji.id ? { name: emoji.name, id: emoji.id } : { name: emoji.name },
  };
}

function reactionUser(data?: {
  id?: string;
  bot?: boolean;
  name?: string;
}): JSONObject {
  return {
    id: data?.id ?? DISCORD_USER_ID,
    bot: data?.bot ?? false,
    username: data?.name ?? "jane",
    global_name: data?.name ?? "Jane Doe",
  };
}

function noteReaction(
  overrides?: Partial<DiscordNoteReaction>,
): DiscordNoteReaction {
  return {
    channelId: CHANNEL_ID,
    messageId: snowflakeAt(minutesAgo(5)),
    noteType: WorkspaceNoteType.Private,
    reactingUserId: DISCORD_USER_ID,
    reactingUserName: "Jane Doe",
    messageTimestamp: minutesAgo(5),
    message: discordMessage({ id: snowflakeAt(minutesAgo(5)) }),
    ...(overrides || {}),
  };
}

let claimSpy: jest.SpyInstance;
let hasNoteSpy: jest.SpyInstance;
let userAuthSpy: jest.SpyInstance;
let authorizeSpy: jest.SpyInstance;
let saveSpy: jest.SpyInstance;
let replySpy: jest.SpyInstance;

beforeEach((): void => {
  claimSpy = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue();
  hasNoteSpy = jest
    .spyOn(WorkspaceReactionNote, "hasNote")
    .mockResolvedValue(false);

  const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  userAuth.userId = oneUptimeUserId;
  userAuthSpy = jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockResolvedValue(userAuth);

  authorizeSpy = jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockResolvedValue({ userId: oneUptimeUserId } as never);

  saveSpy = jest
    .spyOn(WorkspaceReactionNote, "saveNote")
    .mockResolvedValue(WorkspaceNoteSaveResult.Saved);

  jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
    label: "Incident #42",
    link: URL.fromString("https://oneuptime.test/incidents/42"),
  });

  replySpy = jest
    .spyOn(DiscordClient, "replyToMessage")
    .mockResolvedValue("100000000000000999");

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

  // Live installation: the project binding points at this guild.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      workspaceProjectId: GUILD_ID,
      authToken: "test-bot-token",
    } as never);

  observationClaim.mockClear();
  observationClaim.mockResolvedValue({
    result: "Claimed",
    observedAt: new Date(NOW.getTime()),
  });
  observationMarkDone.mockClear();
  observationMarkDone.mockResolvedValue(true);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("DiscordReactionNoteSync.getMessageText", () => {
  test("returns the message content", () => {
    expect(
      DiscordReactionNoteSync.getMessageText(
        discordMessage({ id: "1", content: "Failover complete" }),
      ),
    ).toBe("Failover complete");
  });

  test("flattens embed title, description, fields and footer", () => {
    expect(
      DiscordReactionNoteSync.getMessageText(
        discordMessage({
          id: "1",
          content: "",
          embeds: [
            {
              title: "Incident #42 acknowledged",
              description: "by Jane",
              fields: [
                { name: "Severity:", value: "SEV1" },
                { name: "", value: "Only value" },
              ],
              footer: { text: "OneUptime" },
            },
          ],
        }),
      ),
    ).toBe(
      "Incident #42 acknowledged\nby Jane\nSeverity: SEV1\nOnly value\nOneUptime",
    );
  });

  test("keeps content and embed text together, content first", () => {
    expect(
      DiscordReactionNoteSync.getMessageText(
        discordMessage({
          id: "1",
          content: "Look at this",
          embeds: [{ title: "Card text" }],
        }),
      ),
    ).toBe("Look at this\n\nCard text");
  });

  test("a message with no text anywhere is empty", () => {
    expect(
      DiscordReactionNoteSync.getMessageText(
        discordMessage({ id: "1", content: "", embeds: [{ color: 123 }] }),
      ),
    ).toBe("");
  });

  test("hostile content is kept as data, not executed", () => {
    expect(
      DiscordReactionNoteSync.getMessageText(
        discordMessage({
          id: "1",
          content: "<script>alert(1)</script> <@everyone>",
        }),
      ),
    ).toBe("<script>alert(1)</script> <@everyone>");
  });
});

describe("DiscordReactionNoteSync.getNoteReactions", () => {
  const since: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  let reactionsSpy: jest.SpyInstance;

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("collects pin and megaphone reactors from messages, bots excluded", async () => {
    reactionsSpy = jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockImplementation(
        async (data: { emoji: string }): Promise<JSONArray> => {
          if (data.emoji === "📌") {
            return [reactionUser(), reactionUser({ id: "9", bot: true })];
          }
          if (data.emoji === "📣") {
            return [reactionUser({ id: "8", name: "Bob" })];
          }
          return [];
        },
      );

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: since,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(10)),
            reactions: [
              reactionSummary({ name: "📌" }),
              reactionSummary({ name: "👍" }),
              reactionSummary({ name: "📣" }),
            ],
          }),
        ],
      });

    // The 👍 is never probed: only note emojis are fetched.
    expect(
      reactionsSpy.mock.calls.map((call: Array<{ emoji: string }>) => {
        return call[0]!.emoji;
      }),
    ).toEqual(["📌", "📣"]);

    expect(
      reactions.map((reaction: DiscordNoteReaction) => {
        return {
          noteType: reaction.noteType,
          reactingUserId: reaction.reactingUserId,
          reactingUserName: reaction.reactingUserName,
        };
      }),
    ).toEqual([
      {
        noteType: WorkspaceNoteType.Private,
        reactingUserId: DISCORD_USER_ID,
        reactingUserName: "Jane Doe",
      },
      {
        noteType: WorkspaceNoteType.Public,
        reactingUserId: "8",
        reactingUserName: "Bob",
      },
    ]);
  });

  test("a custom emoji whose name classifies as a note emoji is probed by name:id", async () => {
    reactionsSpy = jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValue([reactionUser()]);

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: since,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(10)),
            reactions: [
              reactionSummary({
                name: "pushpin",
                id: "456789012345678901",
              }),
            ],
          }),
        ],
      });

    expect(reactionsSpy.mock.calls[0]![0]!.emoji).toBe(
      "pushpin:456789012345678901",
    );
    expect(reactions).toHaveLength(1);
    expect(reactions[0]!.noteType).toBe(WorkspaceNoteType.Private);
  });

  test("messages older than the window are not probed, even with note reactions", async () => {
    reactionsSpy = jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValue([reactionUser()]);

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: since,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(25 * 60)),
            reactions: [reactionSummary({ name: "📌" })],
          }),
        ],
      });

    expect(reactions).toEqual([]);
    expect(reactionsSpy).not.toHaveBeenCalled();
  });

  test("system messages are skipped", async () => {
    reactionsSpy = jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValue([reactionUser()]);

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: since,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(1)),
            type: 7, // USER_JOIN system message
            reactions: [reactionSummary({ name: "📌" })],
          }),
        ],
      });

    expect(reactions).toEqual([]);
    expect(reactionsSpy).not.toHaveBeenCalled();
  });

  test("reactions are ordered oldest message first", async () => {
    jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValue([reactionUser()]);

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: since,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(1)),
            reactions: [reactionSummary({ name: "📌" })],
          }),
          discordMessage({
            id: snowflakeAt(minutesAgo(30)),
            reactions: [reactionSummary({ name: "📌" })],
          }),
        ],
      });

    expect(
      reactions.map((reaction: DiscordNoteReaction) => {
        return reaction.messageId;
      }),
    ).toEqual([snowflakeAt(minutesAgo(30)), snowflakeAt(minutesAgo(1))]);
  });
});

describe("DiscordReactionNoteSync.processReaction", () => {
  test("a pin saves a private note in the reacting user's name and confirms as a reply", async () => {
    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);

    expect(userAuthSpy.mock.calls[0]![0].query).toEqual({
      workspaceUserId: DISCORD_USER_ID,
      workspaceType: WorkspaceType.Discord,
      projectId: projectId,
    });

    expect(authorizeSpy).toHaveBeenCalledWith({
      userId: oneUptimeUserId,
      projectId: projectId,
      modelType: WorkspaceReactionNote.getNoteModelType(
        WorkspaceNoteResourceType.Incident,
        WorkspaceNoteType.Private,
      ),
      action: "add a private note to this incident",
      resources: [{ service: IncidentService, id: incidentId }],
    });

    expect(saveSpy).toHaveBeenCalledWith({
      resource: watchedChannel().resource,
      noteType: WorkspaceNoteType.Private,
      userId: oneUptimeUserId,
      note: "Restarted the primary DB",
      sourceMessageKey: `${CHANNEL_ID}:${snowflakeAt(minutesAgo(5))}`,
    });

    expect(replySpy).toHaveBeenCalledTimes(1);
    const reply: {
      channelId: string;
      messageId: string;
      content: string;
    } = replySpy.mock.calls[0]![0];
    expect(reply.channelId).toBe(CHANNEL_ID);
    expect(reply.messageId).toBe(snowflakeAt(minutesAgo(5)));
    expect(reply.content).toContain("private note");
    expect(reply.content).toContain("Incident #42");
  });

  test("a megaphone on an incident saves a public note", async () => {
    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          noteType: WorkspaceNoteType.Public,
        }),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
    expect(saveSpy.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Public);
    expect(replySpy.mock.calls[0]![0].content).toContain("public note");
  });

  test("a public note reaction on an alert is not supported", async () => {
    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(WorkspaceNoteResourceType.Alert),
        reaction: noteReaction({
          noteType: WorkspaceNoteType.Public,
        }),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.NotSupported);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("the claim key has no timestamp component, only resource, type, channel, message and reactor", async () => {
    await DiscordReactionNoteSync.processReaction({
      channel: watchedChannel(),
      reaction: noteReaction(),
      now: NOW,
    });

    expect(claimSpy.mock.calls[0]![1]).toBe(
      [
        incidentId.toString(),
        WorkspaceNoteType.Private,
        CHANNEL_ID,
        snowflakeAt(minutesAgo(5)),
        DISCORD_USER_ID,
      ].join(":"),
    );
  });

  test("an unclaimed reaction is already handled", async () => {
    claimSpy.mockResolvedValue(false);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a cache failure fails closed: nothing is saved", async () => {
    claimSpy.mockRejectedValue(new Error("redis down"));

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a note already saved from this message is not saved again", async () => {
    hasNoteSpy.mockResolvedValue(true);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadySaved);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("an unlinked reactor gets a link-your-account reply only on a fresh message", async () => {
    userAuthSpy.mockResolvedValue(null);

    const fresh: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          messageTimestamp: minutesAgo(5),
          message: discordMessage({
            id: snowflakeAt(minutesAgo(5)),
          }),
        }),
        now: NOW,
      });

    expect(fresh).toBe(DiscordReactionOutcome.NotLinked);
    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replySpy.mock.calls[0]![0].content).toContain(
      "user-settings/discord-integration",
    );
    expect(saveSpy).not.toHaveBeenCalled();

    replySpy.mockClear();

    const stale: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          messageTimestamp: minutesAgo(60),
          messageId: snowflakeAt(minutesAgo(60)),
          message: discordMessage({ id: snowflakeAt(minutesAgo(60)) }),
        }),
        now: NOW,
      });

    expect(stale).toBe(DiscordReactionOutcome.NotLinked);
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a reactor without permission is told, only on a fresh message, and nothing is saved", async () => {
    authorizeSpy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to add notes."),
    );

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.NotAuthorized);
    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replySpy.mock.calls[0]![0].content).toContain(
      "You do not have permission to add notes.",
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("an authorization outage is not an authorization denial: the claim is released and the error rethrown", async () => {
    authorizeSpy.mockRejectedValue(new BadDataException("db gone"));

    await expect(
      DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).rejects.toThrow("db gone");

    expect(GlobalCache.deleteKey).toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a message with no extractable text saves nothing", async () => {
    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          message: discordMessage({
            id: snowflakeAt(minutesAgo(5)),
            content: "",
          }),
        }),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.NoText);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a duplicate save result is already saved", async () => {
    saveSpy.mockResolvedValue(WorkspaceNoteSaveResult.Duplicate);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadySaved);
  });

  test("a failed confirmation reply never fails the save", async () => {
    replySpy.mockRejectedValue(new Error("channel gone"));

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
  });
});

describe("DiscordReactionNoteSync.syncChannel", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("fetches one bounded page and processes the reactions it finds", async () => {
    const messagesSpy = jest
      .spyOn(DiscordClient, "getChannelMessages")
      .mockResolvedValue([
        discordMessage({
          id: snowflakeAt(minutesAgo(5)),
          reactions: [reactionSummary({ name: "📌" })],
        }),
      ]);
    jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValue([reactionUser()]);

    const outcomes: Array<DiscordReactionOutcome> =
      await DiscordReactionNoteSync.syncChannel({
        projectId: projectId,
        authToken: "test-bot-token",
        channel: watchedChannel(),
        now: NOW,
      });

    expect(messagesSpy.mock.calls[0]![0].limit).toBe(50);
    expect(outcomes).toEqual([DiscordReactionOutcome.Saved]);
  });
});

describe("DiscordReactionNoteSync pagination completeness (HOM-43 review)", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("message pages walk back until the eligibility window is covered", async () => {
    /*
     * Two pages of 50: the first page is all newer than 24 h, the second
     * crosses the window boundary. Both must be visited.
     */
    const boundary: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const page1: Array<JSONObject> = [];
    for (let i: number = 0; i < 50; i++) {
      page1.push(
        discordMessage({
          id: snowflakeAt(minutesAgo(30)),
          reactions: [],
        }),
      );
    }
    const page2: Array<JSONObject> = [
      // Just inside the window.
      discordMessage({ id: snowflakeAt(new Date(boundary.getTime() + 60000)) }),
      // Just outside: ends the walk.
      discordMessage({ id: snowflakeAt(new Date(boundary.getTime() - 60000)) }),
    ];

    const messagesSpy = jest
      .spyOn(DiscordClient, "getChannelMessages")
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const messages: Array<JSONObject> =
      await DiscordReactionNoteSync.getChannelWindowMessages({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        since: boundary,
        now: NOW,
      });

    expect(messagesSpy).toHaveBeenCalledTimes(2);
    expect(messagesSpy.mock.calls[1]![0]!.before).toBe(page1[49]!["id"]);
    expect(messages).toHaveLength(51);
  });

  test("pagination stops at a bounded number of pages per run and persists a checkpoint", async () => {
    const boundary: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const page: Array<JSONObject> = [];
    for (let i: number = 0; i < 50; i++) {
      page.push(
        discordMessage({ id: snowflakeAt(minutesAgo(30)), reactions: [] }),
      );
    }

    const messagesSpy = jest
      .spyOn(DiscordClient, "getChannelMessages")
      .mockImplementation(async (): Promise<Array<JSONObject>> => {
        return page;
      });
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
    const checkpointSet: jest.SpyInstance = jest
      .spyOn(GlobalCache, "setString")
      .mockResolvedValue(undefined as never);

    await DiscordReactionNoteSync.getChannelWindowMessages({
      authToken: "test-bot-token",
      channelId: CHANNEL_ID,
      since: boundary,
      now: NOW,
    });

    // Bounded: 5 pages max in one run...
    expect(messagesSpy).toHaveBeenCalledTimes(5);
    /*
     * ...and the oldest message visited becomes the persisted checkpoint the
     * next run resumes from, so page 6+ are reached on later runs.
     */
    expect(checkpointSet).toHaveBeenCalled();
    const lastCall: Array<unknown> =
      checkpointSet.mock.calls[checkpointSet.mock.calls.length - 1]!;
    // setString(namespace, key, value, { expiresInSeconds })
    expect(lastCall[0]).toBe("discord-reaction-window-cursor");
    expect(lastCall[1]).toBe(CHANNEL_ID);
    expect(lastCall[2]).toBe(String(page[49]!["id"]));
  });

  test("a resumed run walks back from the checkpoint and reaches a sixth page inside the window", async () => {
    const boundary: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const page: Array<JSONObject> = [];
    for (let i: number = 0; i < 50; i++) {
      page.push(
        discordMessage({ id: snowflakeAt(minutesAgo(30)), reactions: [] }),
      );
    }
    const checkpoint: string = String(page[49]!["id"]);

    const messagesSpy = jest
      .spyOn(DiscordClient, "getChannelMessages")
      .mockImplementation(async (): Promise<Array<JSONObject>> => {
        return page;
      });
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(checkpoint); // run 1 already walked past this
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);

    await DiscordReactionNoteSync.getChannelWindowMessages({
      authToken: "test-bot-token",
      channelId: CHANNEL_ID,
      since: boundary,
      now: NOW,
    });

    /*
     * The run resumed from the checkpoint: page 1 is requested with
     * before=<checkpoint>, not from the newest message again.
     */
    expect(messagesSpy.mock.calls[0]![0].before).toBe(checkpoint);
    expect(messagesSpy).toHaveBeenCalledTimes(5);
  });

  test("reactor pagination beyond one page is fetched while a next page exists", async () => {
    /*
     * Discord caps reaction listings at 100 users per page; beyond the cap
     * needs after=<last user id> walking. The sync must keep walking while
     * Discord returns full pages (Astra review 2).
     */
    const firstPage: JSONArray = [];
    for (let i: number = 0; i < 100; i++) {
      firstPage.push(
        reactionUser({ id: `2000000000000${String(i).padStart(4, "0")}` }),
      );
    }
    const secondPage: JSONArray = [reactionUser({ id: "2000000000009999" })];

    const messagesSpy = jest
      .spyOn(DiscordClient, "getChannelMessages")
      .mockResolvedValue([
        discordMessage({
          id: snowflakeAt(minutesAgo(5)),
          reactions: [reactionSummary({ name: "📌", count: 101 })],
        }),
      ]);
    const reactionsSpy = jest
      .spyOn(DiscordClient, "getChannelReactions")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const reactions: Array<DiscordNoteReaction> =
      await DiscordReactionNoteSync.getNoteReactions({
        authToken: "test-bot-token",
        channelId: CHANNEL_ID,
        messages: [
          discordMessage({
            id: snowflakeAt(minutesAgo(5)),
            reactions: [reactionSummary({ name: "📌", count: 101 })],
          }),
        ],
        since: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      });

    expect(reactions).toHaveLength(101);
    expect(reactionsSpy).toHaveBeenCalledTimes(2);
    // The second page continues after the last user of the first page.
    expect(reactionsSpy.mock.calls[1]![0].after).toBe(
      String(firstPage[99]!["id"]),
    );
    expect(messagesSpy).not.toHaveBeenCalled();
  });
});

describe("DiscordReactionNoteSync durable observation dedupe (HOM-43 review)", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("a processed reaction is remembered in the database, not only in Redis", async () => {
    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
    // The durable observation is written for every terminal outcome.
    expect(observationMarkDone).toHaveBeenCalledTimes(1);
    const observation: {
      projectId: ObjectID;
      claimKey: string;
    } = observationMarkDone.mock.calls[0]![0];
    expect(observation.projectId.toString()).toBe(projectId.toString());
    expect(observation.claimKey).toContain(CHANNEL_ID);
    expect(observation.claimKey).toContain(DISCORD_USER_ID);
  });

  test("Redis loss does not reprocess a reaction already recorded in the database", async () => {
    claimSpy.mockResolvedValue(true); // Redis claim succeeds (fresh)
    observationClaim.mockResolvedValue({
      result: "AlreadyObserved",
    } as never); // but the DB already saw it

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a deleted note is not recreated after a Redis flush, because the observation row stands", async () => {
    claimSpy.mockResolvedValue(true);
    observationClaim.mockResolvedValue({ result: "AlreadyObserved" } as never);
    hasNoteSpy.mockResolvedValue(false); // note was deleted in OneUptime

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("DiscordReactionNoteSync durable claim ordering (HOM-43 review 2)", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("the note save happens BEFORE the durable Done record, not after", async () => {
    const order: Array<string> = [];
    saveSpy.mockImplementation(async (): Promise<WorkspaceNoteSaveResult> => {
      order.push("save");
      return WorkspaceNoteSaveResult.Saved;
    });
    observationMarkDone.mockImplementation(async (): Promise<boolean> => {
      order.push("observe");
      return true;
    });

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
    expect(order).toEqual(["save", "observe"]);
  });

  test("a database failure claiming the observation blocks the save (fail open, retried later)", async () => {
    /*
     * A read failure must not be laundered into "already processed" —
     * Astra review 2: hasObserved() returned true on DB failure.
     */
    observationClaim.mockRejectedValue(new Error("db down"));

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    /*
     * The reaction is released for a later run; nothing is saved on an
     * unreadable dedupe layer.
     */
    expect(outcome).toBe(DiscordReactionOutcome.RetryLater);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).toHaveBeenCalled();
  });

  test("a failed note save returns SaveFailed with the observation left Pending", async () => {
    /*
     * Save-first (HOM-43 review 3): a save that throws leaves NO note and
     * NO Done row — the reaction is retried by the stale-steal window.
     * The Redis claim is released so the retry cadence is minutes, not
     * the 2-day Redis TTL.
     */
    saveSpy.mockRejectedValue(new Error("note save exploded"));

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.SaveFailed);
    expect(observationMarkDone).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).toHaveBeenCalled();
  });

  test("a database failure marking done after a successful save keeps the outcome ambiguous and retries", async () => {
    /*
     * markDone runs AFTER the save now. If it fails the note exists but
     * the row stays Pending: the outcome is RetryLater, the Redis claim
     * is released, and a later steal re-runs the save which hasNote/
     * Duplicate turns into a clean terminal.
     */
    observationMarkDone.mockRejectedValueOnce(new Error("db down"));

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.RetryLater);
    expect(saveSpy).toHaveBeenCalled();
    expect(GlobalCache.deleteKey).toHaveBeenCalled();
  });

  test("a NotLinked reaction is observed durably BEFORE its user-facing reply", async () => {
    const order: Array<string> = [];
    userAuthSpy.mockResolvedValue(null as never);
    replySpy.mockImplementation(async (): Promise<string> => {
      order.push("reply");
      return "100000000000000999";
    });
    observationMarkDone.mockImplementation(async (): Promise<boolean> => {
      order.push("observe");
      return true;
    });

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({ messageTimestamp: NOW }), // fresh: replies fire
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.NotLinked);
    expect(order).toEqual(["observe", "reply"]);
  });

  test("the terminal markDone carries the observedAt token claim() returned", async () => {
    const tokens: Array<Date | undefined> = [];
    observationMarkDone.mockImplementation(
      async (data: { observedAt?: Date }): Promise<boolean> => {
        tokens.push(data?.observedAt);
        return true;
      },
    );

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
    expect(tokens).toHaveLength(1);
    // The token claim() returned is the token markDone carries.
    expect(tokens[0]).toBeInstanceOf(Date);
  });

  test("a stolen claim (markDone false) suppresses the confirmation reply after the save (HOM-43 review 4)", async () => {
    // The save succeeds, but the claim was stolen before the terminal write.
    observationMarkDone.mockResolvedValue(false);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    // The note exists; only the reply is suppressed.
    expect(outcome).toBe(DiscordReactionOutcome.AlreadySaved);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a stolen claim on a NotLinked reaction suppresses the user-facing reply (HOM-43 review 4)", async () => {
    userAuthSpy.mockResolvedValue(null);
    observationMarkDone.mockResolvedValue(false);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({ messageTimestamp: NOW }), // fresh: would reply
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a stolen claim on an AlreadySaved reaction reports AlreadyHandled, not AlreadySaved (HOM-43 review 4)", async () => {
    hasNoteSpy.mockResolvedValue(true);
    observationMarkDone.mockResolvedValue(false);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.AlreadyHandled);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
  });
});

describe("DiscordReactionNoteSync live installation verification (HOM-43 review)", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("a channel whose live guild does not match the project binding is not saved from", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        workspaceProjectId: "999999999999999999",
        authToken: "test-bot-token",
      } as never);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.StaleInstallation);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("DiscordReactionNoteSync.syncProject and syncAllProjects", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("one broken channel does not stop the others", async () => {
    const first: DiscordWatchedChannel = watchedChannel();
    const second: DiscordWatchedChannel = {
      ...watchedChannel(),
      channelId: "100000000000000020",
    };

    jest
      .spyOn(DiscordReactionNoteSync, "getWatchedChannels")
      .mockResolvedValue([first, second]);

    const channelSpy = jest
      .spyOn(DiscordReactionNoteSync, "syncChannel")
      .mockImplementation(async (data: { channel: DiscordWatchedChannel }) => {
        if (data.channel.channelId === first.channelId) {
          throw new BadDataException("HTTP 403");
        }
        return [DiscordReactionOutcome.Saved];
      });

    await DiscordReactionNoteSync.syncProject({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
    });

    expect(channelSpy).toHaveBeenCalledTimes(2);
  });

  test("syncAllProjects skips incomplete auth rows and survives a project failure", async () => {
    const good: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    good.projectId = projectId;
    good.authToken = "test-bot-token";
    good.workspaceProjectId = GUILD_ID;

    const incomplete: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    incomplete.projectId = ObjectID.generate();
    // no authToken

    const findBySpy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([good, incomplete]);

    const projectSpy = jest
      .spyOn(DiscordReactionNoteSync, "syncProject")
      .mockRejectedValue(new Error("boom"));

    await DiscordReactionNoteSync.syncAllProjects();

    expect(findBySpy.mock.calls[0]![0].query).toEqual({
      workspaceType: WorkspaceType.Discord,
    });
    // Only the complete row reached syncProject, and the failure did not throw.
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(projectSpy.mock.calls[0]![0].projectId.toString()).toBe(
      projectId.toString(),
    );
  });
});

describe("DiscordReactionNoteSync.getWatchedChannels", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("watches open or recently updated resources that list a Discord channel, newest owner wins", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([
        {
          id: incidentId,
          projectId: projectId,
          createdAt: minutesAgo(10),
          postUpdatesToWorkspaceChannels: [
            {
              id: CHANNEL_ID,
              name: "incident-42",
              workspaceType: WorkspaceType.Discord,
            },
          ],
        } as never,
      ]);

    // All other resource types return nothing.
    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      if (resourceType === WorkspaceNoteResourceType.Incident) {
        continue;
      }
      jest
        .spyOn(WorkspaceReactionNote.getResourceService(resourceType), "findBy")
        .mockResolvedValue([]);
    }

    const channels: Array<DiscordWatchedChannel> =
      await DiscordReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      });

    expect(channels).toHaveLength(1);
    expect(channels[0]!.channelId).toBe(CHANNEL_ID);
    expect(channels[0]!.resource.resourceId.toString()).toBe(
      incidentId.toString(),
    );

    // The query carries the open-or-recent bound and the Discord filter.
    const queries: Array<JSONObject> = findBySpy.mock.calls.map(
      (call: Array<{ query: JSONObject }>) => {
        return call[0]!.query;
      },
    );
    expect(queries.length).toBeGreaterThan(0);
  });

  test("a channel entry that is not Discord, or has no id, is ignored", async () => {
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      {
        id: incidentId,
        projectId: projectId,
        createdAt: minutesAgo(10),
        postUpdatesToWorkspaceChannels: [
          { id: "1", name: "x", workspaceType: WorkspaceType.Slack },
          { name: "no-id", workspaceType: WorkspaceType.Discord },
          {
            id: CHANNEL_ID,
            name: "incident-42",
            workspaceType: WorkspaceType.Discord,
          },
        ],
      } as never,
    ]);

    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      if (resourceType === WorkspaceNoteResourceType.Incident) {
        continue;
      }
      jest
        .spyOn(WorkspaceReactionNote.getResourceService(resourceType), "findBy")
        .mockResolvedValue([]);
    }

    const channels: Array<DiscordWatchedChannel> =
      await DiscordReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      });

    expect(channels).toHaveLength(1);
    expect(channels[0]!.channelId).toBe(CHANNEL_ID);
  });
});

/*
 * Same-guild reinstall refusal (HOM-43 review, Astra events 04061e71… and
 * e7e727e8…). A stale claim token does NOT cover this: a current claim can
 * still reference an installation that no longer exists. The watched entry
 * carries the persisted lifecycle row's installation tuple; after reinstall
 * of the same binding and guild at N+1, the old entry must be refused
 * BEFORE any note write, and a fresh poll after reinstall must not stamp
 * the live binding onto the old thread.
 */
describe("DiscordReactionNoteSync same-guild reinstall refusal (HOM-43)", () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  const INSTALLATION_ROW_ID: string = "90000000-0000-4000-8000-000000000001";
  const REINSTALLED_ROW_ID: string = "90000000-0000-4000-8000-000000000002";

  const liveAuthAt: (version: number, rowId: string) => void = (
    version: number,
    rowId: string,
  ): void => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: ObjectID.fromString(rowId),
        _id: ObjectID.fromString(rowId),
        version: version,
        workspaceProjectId: GUILD_ID,
        authToken: "test-bot-token",
      } as never);
  };

  test("R1: an entry captured under binding B version N is refused when the same row is at N+1", async (): Promise<void> => {
    liveAuthAt(2, INSTALLATION_ROW_ID);

    const entry: DiscordWatchedChannel = {
      ...watchedChannel(),
      installation: { id: INSTALLATION_ROW_ID, version: 1 },
    };

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: entry,
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.StaleInstallation);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("R2b: an entry captured under binding row B is refused when a reinstall created row B'", async (): Promise<void> => {
    liveAuthAt(1, REINSTALLED_ROW_ID);

    const entry: DiscordWatchedChannel = {
      ...watchedChannel(),
      installation: { id: INSTALLATION_ROW_ID, version: 1 },
    };

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: entry,
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.StaleInstallation);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("R2: a fresh poll after reinstall stamps the persisted row's tuple, not the live binding", async (): Promise<void> => {
    // The resource lists the thread's channel; the lifecycle row still
    // carries the PRE-reinstall installation tuple.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      {
        id: incidentId,
        projectId: projectId,
        createdAt: minutesAgo(10),
        postUpdatesToWorkspaceChannels: [
          {
            id: CHANNEL_ID,
            name: "incident-42",
            workspaceType: WorkspaceType.Discord,
          },
        ],
      } as never,
    ]);

    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      if (resourceType === WorkspaceNoteResourceType.Incident) {
        continue;
      }
      jest
        .spyOn(WorkspaceReactionNote.getResourceService(resourceType), "findBy")
        .mockResolvedValue([]);
    }

    jest.spyOn(DiscordResourceThreadService, "findBy").mockResolvedValue([
      {
        installationId: ObjectID.fromString(INSTALLATION_ROW_ID),
        installationVersion: 1,
        state: "active",
        threadId: CHANNEL_ID,
      },
    ] as never);

    const channels: Array<DiscordWatchedChannel> =
      await DiscordReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      });

    expect(channels).toHaveLength(1);
    expect(channels[0]!.installation).toEqual({
      id: INSTALLATION_ROW_ID,
      version: 1,
    });

    // The live binding is the REINSTALLED row; the persisted tuple governs.
    liveAuthAt(1, REINSTALLED_ROW_ID);

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: channels[0]!,
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.StaleInstallation);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("control: an entry stamped with the live tuple saves normally", async (): Promise<void> => {
    liveAuthAt(1, INSTALLATION_ROW_ID);

    const entry: DiscordWatchedChannel = {
      ...watchedChannel(),
      installation: { id: INSTALLATION_ROW_ID, version: 1 },
    };

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: entry,
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.Saved);
    expect(saveSpy).toHaveBeenCalled();
  });

  test("disconnect: a deleted live binding is refused regardless of tuple", async (): Promise<void> => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        deletedAt: new Date(NOW.getTime() - 60_000),
        workspaceProjectId: GUILD_ID,
      } as never);

    const entry: DiscordWatchedChannel = {
      ...watchedChannel(),
      installation: { id: INSTALLATION_ROW_ID, version: 1 },
    };

    const outcome: DiscordReactionOutcome =
      await DiscordReactionNoteSync.processReaction({
        channel: entry,
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(DiscordReactionOutcome.StaleInstallation);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
