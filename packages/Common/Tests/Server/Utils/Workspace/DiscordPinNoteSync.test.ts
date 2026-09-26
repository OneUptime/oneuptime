import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A native Discord pin does not identify who pinned it. The guild audit log
 * does: MESSAGE_PIN (action 74) carries the acting user id and, in options,
 * the channel and message. DiscordPinNoteSync follows that log with a
 * persisted cursor and saves the pinned message as a private note authored
 * by the pin ACTOR, never by the message author. When actor evidence is
 * absent or ambiguous it fails closed.
 *
 * Failure inventory: RESEARCH/ONEUPTIME_DISCORD_REACTION_PIN_FAILURES_2026_09_25.md (items 19-27).
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

import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import DiscordReactionObservationService from "../../../../Server/Services/DiscordReactionObservationService";

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

const observationClaim: jest.Mock = (
  DiscordReactionObservationService as unknown as {
    claim: jest.Mock;
  }
).claim;
const observationMarkDone: jest.Mock = (
  DiscordReactionObservationService as unknown as {
    markDone: jest.Mock;
  }
).markDone;
import DiscordPinNoteSync, {
  DiscordAuditPin,
} from "../../../../Server/Utils/Workspace/Discord/PinNoteSync";
import type { DiscordWatchedChannel } from "../../../../Server/Utils/Workspace/Discord/ReactionNoteSync";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

const projectId: ObjectID = ObjectID.generate();
const oneUptimeUserId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const GUILD_ID: string = "100000000000000001";
const CHANNEL_ID: string = "100000000000000010";
const PIN_ACTOR_ID: string = "100000000000000200";
const MESSAGE_AUTHOR_ID: string = "100000000000000100";
const MESSAGE_ID: string = "234567890123456789";
const NOW: Date = new Date("2026-09-25T12:00:00.000Z");

function auditEntry(data?: {
  id?: string;
  actionType?: number;
  userId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
}): JSONObject {
  // Explicit nulls must stay null: the ?? defaults only apply to undefined.
  const userId: string | null =
    data && "userId" in data ? (data.userId as string | null) : PIN_ACTOR_ID;
  const channelId: string | null =
    data && "channelId" in data
      ? (data.channelId as string | null)
      : CHANNEL_ID;
  const messageId: string | null =
    data && "messageId" in data
      ? (data.messageId as string | null)
      : MESSAGE_ID;

  return {
    id: data?.id ?? "300000000000000001",
    action_type: data?.actionType ?? 74,
    user_id: userId,
    options: {
      channel_id: channelId,
      message_id: messageId,
    },
  };
}

function pinnedMessage(): JSONObject {
  return {
    id: MESSAGE_ID,
    type: 0,
    content: "Failover runbook step 3 complete",
    embeds: [],
    pinned: true,
    timestamp: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    author: { id: MESSAGE_AUTHOR_ID, bot: false },
  };
}

let claimSpy: jest.SpyInstance;
let hasNoteSpy: jest.SpyInstance;
let userAuthSpy: jest.SpyInstance;
let authorizeSpy: jest.SpyInstance;
let saveSpy: jest.SpyInstance;
let cursorGetSpy: jest.SpyInstance;
let cursorSetSpy: jest.SpyInstance;

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

  jest
    .spyOn(DiscordClient, "replyToMessage")
    .mockResolvedValue("100000000000000999");

  cursorGetSpy = jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  cursorSetSpy = jest
    .spyOn(GlobalCache, "setString")
    .mockResolvedValue(undefined as never);

  observationClaim.mockClear();
  observationClaim.mockResolvedValue({
    result: "Claimed",
    observedAt: new Date(NOW.getTime()),
  });
  observationMarkDone.mockClear();
  observationMarkDone.mockResolvedValue(true);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

  // Live installation: the project binding points at this guild (HOM-43
  // review 3 — the pin path revalidates the live binding before saving).
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      workspaceProjectId: GUILD_ID,
      authToken: "test-bot-token",
    } as never);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("DiscordPinNoteSync.getPinsFromAuditLog", () => {
  test("collects MESSAGE_PIN entries with full channel/message options", () => {
    const pins: Array<DiscordAuditPin> = DiscordPinNoteSync.getPinsFromAuditLog(
      {
        guildId: GUILD_ID,
        entries: [
          auditEntry(),
          auditEntry({ actionType: 75 }), // unpin: ignored
          auditEntry({ actionType: 74, messageId: null }), // incomplete: ignored
          auditEntry({ actionType: 74, userId: null }), // no actor: ignored
          auditEntry({ actionType: 72 }), // other action
        ],
      },
    );

    expect(pins).toHaveLength(1);
    expect(pins[0]!.actorUserId).toBe(PIN_ACTOR_ID);
    expect(pins[0]!.channelId).toBe(CHANNEL_ID);
    expect(pins[0]!.messageId).toBe(MESSAGE_ID);
  });
});

describe("DiscordPinNoteSync.syncGuild", () => {
  let auditSpy: jest.SpyInstance;
  let messageSpy: jest.SpyInstance;
  let watched: Array<DiscordWatchedChannel>;

  beforeEach((): void => {
    watched = [
      {
        resource: {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: incidentId,
          projectId: projectId,
        },
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
      },
    ];

    auditSpy = jest
      .spyOn(DiscordClient, "getGuildAuditLog")
      .mockResolvedValue({ audit_log_entries: [auditEntry()] });

    messageSpy = jest
      .spyOn(DiscordClient, "getChannelMessage")
      .mockResolvedValue(pinnedMessage());
  });

  test("a pin becomes a private note authored by the pin actor, not the message author", async () => {
    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["Saved"]);

    expect(userAuthSpy.mock.calls[0]![0].query).toEqual({
      workspaceUserId: PIN_ACTOR_ID,
      workspaceType: WorkspaceType.Discord,
      projectId: projectId,
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Private);
    expect(saveSpy.mock.calls[0]![0].userId.toString()).toBe(
      oneUptimeUserId.toString(),
    );

    // The audit log was queried after the stored cursor.
    expect(auditSpy.mock.calls[0]![0].actionType).toBe(74);
  });

  test("a pin in a channel that is not watched is skipped and the cursor still advances", async () => {
    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: [
        {
          resource: watched[0]!.resource,
          guildId: GUILD_ID,
          channelId: "999999999999999999",
        },
      ],
    });

    expect(outcomes).toEqual(["NotWatched"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cursorSetSpy).toHaveBeenCalledWith(
      "discord-pin-cursor",
      GUILD_ID,
      "300000000000000001",
    );
  });

  test("an unlinked pin actor fails closed: no note, no message-author fallback", async () => {
    userAuthSpy.mockResolvedValue(null);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["NotLinked"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(userAuthSpy.mock.calls[0]![0].query.workspaceUserId).toBe(
      PIN_ACTOR_ID,
    );
  });

  test("a pinned message that no longer exists is skipped and the cursor advances", async () => {
    messageSpy.mockRejectedValue(new BadDataException("HTTP 404"));

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["NoText"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cursorSetSpy).toHaveBeenCalled();
  });

  test("a pin actor without note permission is refused and nothing is saved", async () => {
    authorizeSpy.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to add notes."),
    );

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["NotAuthorized"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a missing audit-log permission disables pin capture for the guild without failing the run", async () => {
    auditSpy.mockRejectedValue(
      Object.assign(new BadDataException("HTTP 403"), { statusCode: 403 }),
    );

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AuditLogUnavailable"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cursorSetSpy).not.toHaveBeenCalled();
  });

  test("duplicate audit entries are processed once", async () => {
    claimSpy.mockResolvedValue(false);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AlreadyHandled"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("cursor loss rescans the first page but dedupes via hasNote", async () => {
    cursorGetSpy.mockResolvedValue(null);
    hasNoteSpy.mockResolvedValue(true);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AlreadySaved"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("entries at or older than the cursor produce no outcomes and no cursor write", async () => {
    cursorGetSpy.mockResolvedValue("300000000000000001");

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual([]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(cursorSetSpy).not.toHaveBeenCalled();
  });

  test("a note saved from the same message by a reaction is not duplicated by the pin", async () => {
    hasNoteSpy.mockResolvedValue(true);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AlreadySaved"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("the pin note save happens BEFORE the durable Done record (HOM-43 review 3)", async () => {
    const order: Array<string> = [];
    saveSpy.mockImplementation(async (): Promise<WorkspaceNoteSaveResult> => {
      order.push("save");
      return WorkspaceNoteSaveResult.Saved;
    });
    observationMarkDone.mockImplementation(async (): Promise<boolean> => {
      order.push("observe");
      return true;
    });

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["Saved"]);
    expect(order).toEqual(["save", "observe"]);
  });

  test("a database failure claiming the observation blocks the pin save and releases the claim", async () => {
    observationClaim.mockRejectedValue(new Error("db down"));

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    // Retried on a later run; nothing saved on an unreadable dedupe layer.
    expect(outcomes).toEqual(["RetryLater"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).toHaveBeenCalled();
  });

  test("a failed pin save returns SaveFailed, leaves the observation Pending, and releases the Redis claim", async () => {
    saveSpy.mockRejectedValue(new Error("note save exploded"));

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    // No note exists; the row stays Pending for the stale-steal retry.
    expect(outcomes).toEqual(["SaveFailed"]);
    expect(observationMarkDone).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).toHaveBeenCalled();
  });

  test("an already-saved pin record marks the observation Done, ending the steal loop", async () => {
    hasNoteSpy.mockResolvedValue(true);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AlreadySaved"]);
    expect(observationMarkDone).toHaveBeenCalledTimes(1);
  });

  test("the pin save and its terminal markDone are scoped by the claim token", async () => {
    const calls: Array<Date | undefined> = [];
    observationMarkDone.mockImplementation(
      async (data: { observedAt?: Date }): Promise<boolean> => {
        calls.push(data?.observedAt);
        return true;
      },
    );

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["Saved"]);
    expect(calls).toHaveLength(1);
    // The token claim() returned is the token markDone carries.
    expect(calls[0]).toBeInstanceOf(Date);
  });

  test("a stolen pin claim (markDone false) suppresses the confirmation reply after the save (HOM-43 review 4)", async () => {
    observationMarkDone.mockResolvedValue(false);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    // The note exists; only the reply is suppressed.
    expect(outcomes).toEqual(["AlreadySaved"]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(DiscordClient.replyToMessage).not.toHaveBeenCalled();
  });

  test("a stolen pin claim on an already-saved note reports AlreadyHandled (HOM-43 review 4)", async () => {
    hasNoteSpy.mockResolvedValue(true);
    observationMarkDone.mockResolvedValue(false);

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["AlreadyHandled"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(DiscordClient.replyToMessage).not.toHaveBeenCalled();
  });
});

/*
 * Pin twin of the same-guild reinstall refusal (HOM-43, Astra event
 * e7e727e8…): the pin path trusts the reaction sync's watched set, so a
 * watched entry carrying a pre-reinstall installation tuple must be
 * refused before any note write, exactly like processReaction.
 */
describe("DiscordPinNoteSync same-guild reinstall refusal (HOM-43)", () => {
  let messageSpy: jest.SpyInstance;

  beforeEach((): void => {
    jest
      .spyOn(DiscordClient, "getGuildAuditLog")
      .mockResolvedValue({ audit_log_entries: [auditEntry()] });
    messageSpy = jest
      .spyOn(DiscordClient, "getChannelMessage")
      .mockResolvedValue(pinnedMessage());
  });

  test("a watched entry stamped under binding B version N is refused at N+1: no note, no reply", async () => {
    // Live binding: SAME row, version bumped by the reinstall.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: ObjectID.fromString("90000000-0000-4000-8000-000000000001"),
        _id: ObjectID.fromString("90000000-0000-4000-8000-000000000001"),
        version: 2,
        workspaceProjectId: GUILD_ID,
        authToken: "test-bot-token",
      } as never);

    const watched: Array<DiscordWatchedChannel> = [
      {
        resource: {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: incidentId,
          projectId: projectId,
        },
        guildId: GUILD_ID,
        channelId: CHANNEL_ID,
        installation: {
          id: "90000000-0000-4000-8000-000000000001",
          version: 1,
        },
      },
    ];

    const outcomes: Array<string> = await DiscordPinNoteSync.syncGuild({
      projectId: projectId,
      authToken: "test-bot-token",
      guildId: GUILD_ID,
      watched: watched,
    });

    expect(outcomes).toEqual(["NotWatched"]);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(messageSpy).not.toHaveBeenCalled();
  });
});
