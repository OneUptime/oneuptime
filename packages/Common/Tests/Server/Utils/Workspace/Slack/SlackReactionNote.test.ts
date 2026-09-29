import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentEpisodeInternalNoteService from "../../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import SlackActionAuthorization from "../../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackAlertActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackReactionNoteActions, {
  SlackReactionData,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/ReactionNote";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * reaction_added / pin_added in Slack: which incident / alert / ... the
 * message becomes a note on, who it is attributed to, and when nothing is
 * written at all.
 */

const projectId: ObjectID = ObjectID.generate();
const secondProjectId: ObjectID = ObjectID.generate();
const oneUptimeUserId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const TEAM_ID: string = "T0WORKSPACE";
const SLACK_USER_ID: string = "U0JANE";
const CHANNEL_ID: string = "C0INCIDENT";
const MESSAGE_TS: string = "1700000000.000200";
const THREAD_TS: string = "1700000000.000100";

function reaction(overrides?: Partial<SlackReactionData>): SlackReactionData {
  return {
    teamId: TEAM_ID,
    reaction: "pushpin",
    userId: SLACK_USER_ID,
    channelId: CHANNEL_ID,
    messageTs: MESSAGE_TS,
    ...(overrides || {}),
  };
}

function projectAuth(
  id: ObjectID,
  authToken: string | null = "xoxb-" + id.toString(),
): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = id;
  if (authToken) {
    token.authToken = authToken;
  }
  return token;
}

function incidentResource(
  overrides?: Partial<WorkspaceNoteResource>,
): WorkspaceNoteResource {
  return {
    resourceType: WorkspaceNoteResourceType.Incident,
    resourceId: incidentId,
    projectId: projectId,
    ...(overrides || {}),
  };
}

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

let projectAuthFindSpy: AnySpy;
let resolveSpy: SpyInstance<
  typeof WorkspaceReactionNote.resolveResourceForChannel
>;
let userAuthFindSpy: AnySpy;
let authorizeSpy: SpyInstance<typeof SlackActionAuthorization.authorize>;
let fetchSpy: SpyInstance<typeof SlackUtil.getMessageDetailsByTimestamp>;
let saveSpy: SpyInstance<typeof WorkspaceReactionNote.saveNote>;
let threadReplySpy: SpyInstance<typeof SlackUtil.sendMessageToThread>;

beforeEach((): void => {
  projectAuthFindSpy = jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockResolvedValue([projectAuth(projectId)]) as AnySpy;

  resolveSpy = jest
    .spyOn(WorkspaceReactionNote, "resolveResourceForChannel")
    .mockResolvedValue(incidentResource());

  const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  userAuth.userId = oneUptimeUserId;
  userAuthFindSpy = jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockResolvedValue(userAuth) as AnySpy;

  authorizeSpy = jest
    .spyOn(SlackActionAuthorization, "authorize")
    .mockResolvedValue({ userId: oneUptimeUserId });

  fetchSpy = jest
    .spyOn(SlackUtil, "getMessageDetailsByTimestamp")
    .mockResolvedValue({ text: "Restarted the primary DB", threadTs: null });

  saveSpy = jest
    .spyOn(WorkspaceReactionNote, "saveNote")
    .mockResolvedValue(WorkspaceNoteSaveResult.Saved);

  jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
    label: "Incident #42",
    link: URL.fromString("https://oneuptime.test/incidents/42"),
  });

  threadReplySpy = jest
    .spyOn(SlackUtil, "sendMessageToThread")
    .mockResolvedValue(undefined);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("SlackReactionNoteActions.handleEmojiReaction", () => {
  test("a pin saves the message as a private note and confirms in the thread", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).toHaveBeenCalledWith({
      resource: incidentResource(),
      noteType: WorkspaceNoteType.Private,
      userId: oneUptimeUserId,
      note: "Restarted the primary DB",
      sourceMessageKey: `${CHANNEL_ID}:${MESSAGE_TS}`,
    });

    expect(threadReplySpy).toHaveBeenCalledWith({
      authToken: "xoxb-" + projectId.toString(),
      channelId: CHANNEL_ID,
      threadTs: MESSAGE_TS,
      text: "✅ Message saved as *private note* to <https://oneuptime.test/incidents/42|Incident #42>.",
    });
  });

  test("a megaphone saves a public note", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(saveSpy.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Public);
    expect(threadReplySpy.mock.calls[0]![0].text).toContain(
      "This note will be visible on the status page.",
    );
  });

  test("authorization is asked for the note row and the resource it lands on", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "loudspeaker" }),
    );

    const args: Parameters<typeof SlackActionAuthorization.authorize>[0] =
      authorizeSpy.mock.calls[0]![0];
    expect(args.requester).toEqual({
      userId: oneUptimeUserId,
      projectId: projectId,
      projectAuthToken: "xoxb-" + projectId.toString(),
      slackUserId: SLACK_USER_ID,
    });
    expect(args.modelType).toBe(IncidentPublicNote);
    expect(args.action).toBe("add a public note to this incident");
    expect(args.resources).toEqual([
      { service: IncidentService, id: incidentId },
    ]);
  });

  test("REGRESSION: a reply in a thread is read and confirmed in that thread", async () => {
    fetchSpy.mockResolvedValue({
      text: "Rolled back deploy 1234",
      threadTs: THREAD_TS,
    });

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy.mock.calls[0]![0].note).toBe("Rolled back deploy 1234");
    // Slack threads hang off the parent; replying to a reply's ts is wrong.
    expect(threadReplySpy.mock.calls[0]![0].threadTs).toBe(THREAD_TS);
  });

  test("REGRESSION: a Slack workspace connected to several projects finds the channel in the right one", async () => {
    projectAuthFindSpy.mockResolvedValue([
      projectAuth(projectId),
      projectAuth(secondProjectId),
    ]);
    resolveSpy.mockResolvedValue(
      incidentResource({ projectId: secondProjectId }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(projectAuthFindSpy.mock.calls[0]![0].query).toEqual({
      workspaceProjectId: TEAM_ID,
      workspaceType: WorkspaceType.Slack,
    });
    expect(resolveSpy.mock.calls[0]![0]).toEqual({
      projectIds: [projectId, secondProjectId],
      workspaceType: WorkspaceType.Slack,
      channelId: CHANNEL_ID,
      messageId: MESSAGE_TS,
      resourceTypes: undefined,
    });

    // The user and the token are the second project's.
    expect(userAuthFindSpy.mock.calls[0]![0].query).toEqual({
      workspaceUserId: SLACK_USER_ID,
      workspaceType: WorkspaceType.Slack,
      projectId: secondProjectId,
    });
    expect(threadReplySpy.mock.calls[0]![0].authToken).toBe(
      "xoxb-" + secondProjectId.toString(),
    );
  });

  test("connections without a token are ignored", async () => {
    projectAuthFindSpy.mockResolvedValue([
      projectAuth(projectId, null),
      projectAuth(secondProjectId),
    ]);
    resolveSpy.mockResolvedValue(
      incidentResource({ projectId: secondProjectId }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(resolveSpy.mock.calls[0]![0].projectIds).toEqual([secondProjectId]);
  });

  test("any other emoji does nothing at all", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "thumbsup" }),
    );

    expect(projectAuthFindSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["teamId", { teamId: "" }],
    ["userId", { userId: "" }],
    ["channelId", { channelId: "" }],
    ["messageTs", { messageTs: "" }],
  ])(
    "an event without %s is ignored",
    async (_field: string, overrides: Partial<SlackReactionData>) => {
      await SlackReactionNoteActions.handleEmojiReaction(reaction(overrides));

      expect(projectAuthFindSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    },
  );

  test("a Slack workspace no project is connected to is ignored", async () => {
    projectAuthFindSpy.mockResolvedValue([]);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a channel that belongs to nothing is ignored", async () => {
    resolveSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(userAuthFindSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a megaphone in an alert channel is ignored: alerts have no public notes", async () => {
    resolveSpy.mockResolvedValue(
      incidentResource({ resourceType: WorkspaceNoteResourceType.Alert }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(userAuthFindSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a Slack user who never connected OneUptime is ignored", async () => {
    userAuthFindSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(authorizeSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a refused user's message is never read or saved", async () => {
    authorizeSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(threadReplySpy).not.toHaveBeenCalled();
  });

  test("a message Slack will not return is not saved", async () => {
    fetchSpy.mockRejectedValue(new Error("channel_not_found"));

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a message without text is not saved", async () => {
    fetchSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("reacting again, or pin and 📌 together, saves once and confirms once", async () => {
    saveSpy.mockResolvedValue(WorkspaceNoteSaveResult.Duplicate);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(threadReplySpy).not.toHaveBeenCalled();
  });

  test("a failed save sends no confirmation", async () => {
    saveSpy.mockRejectedValue(new Error("database is down"));

    await expect(
      SlackReactionNoteActions.handleEmojiReaction(reaction()),
    ).resolves.toBeUndefined();

    expect(threadReplySpy).not.toHaveBeenCalled();
  });

  test("a failed confirmation does not undo or fail the save", async () => {
    threadReplySpy.mockRejectedValue(new Error("not_in_channel"));

    await expect(
      SlackReactionNoteActions.handleEmojiReaction(reaction()),
    ).resolves.toBeUndefined();

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("REGRESSION: Slack episode channels (never worked before)", () => {
  test("a pin in an incident episode channel saves a private episode note", async () => {
    resolveSpy.mockRestore();
    saveSpy.mockRestore();

    // Only the episode lists the channel as its own.
    const episode: IncidentEpisode = new IncidentEpisode();
    episode.id = ObjectID.generate();
    episode.projectId = projectId;
    episode.createdAt = new Date();

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(ScheduledMaintenanceService, "findOneBy")
      .mockResolvedValue(null);
    jest.spyOn(AlertEpisodeService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(IncidentEpisodeService, "findOneBy").mockResolvedValue(episode);
    // Episode messages were never logged with the episode id.
    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);

    jest
      .spyOn(IncidentEpisodeInternalNoteService, "hasNoteFromSlackMessage")
      .mockResolvedValue(false);
    const addSpy: AnySpy = jest
      .spyOn(IncidentEpisodeInternalNoteService, "addNote")
      .mockResolvedValue(undefined as never) as AnySpy;

    await SlackIncidentEpisodeActions.handleEmojiReaction(reaction());

    expect(addSpy).toHaveBeenCalledWith({
      incidentEpisodeId: episode.id,
      projectId: projectId,
      userId: oneUptimeUserId,
      note: "Restarted the primary DB",
      postedFromSlackMessageId: `${CHANNEL_ID}:${MESSAGE_TS}`,
    });
  });
});

describe("per-resource Slack handlers are narrowed to their own channels", () => {
  test.each([
    [SlackIncidentActions, WorkspaceNoteResourceType.Incident],
    [SlackAlertActions, WorkspaceNoteResourceType.Alert],
    [
      SlackScheduledMaintenanceActions,
      WorkspaceNoteResourceType.ScheduledMaintenance,
    ],
    [SlackIncidentEpisodeActions, WorkspaceNoteResourceType.IncidentEpisode],
    [SlackAlertEpisodeActions, WorkspaceNoteResourceType.AlertEpisode],
  ])(
    "%p → %s",
    async (
      handler: {
        handleEmojiReaction: (data: SlackReactionData) => Promise<void>;
      },
      resourceType: WorkspaceNoteResourceType,
    ) => {
      await handler.handleEmojiReaction(reaction());

      expect(resolveSpy.mock.calls[0]![0].resourceTypes).toEqual([
        resourceType,
      ]);
    },
  );

  test("the incident handler still checks the private note row", async () => {
    await SlackIncidentActions.handleEmojiReaction(reaction());

    expect(authorizeSpy.mock.calls[0]![0].modelType).toBe(IncidentInternalNote);
  });
});

describe("SlackReactionNoteActions.getReactionDataFromPinEvent", () => {
  test("a pinned message is a 📌 from the person who pinned it", () => {
    expect(
      SlackReactionNoteActions.getReactionDataFromPinEvent({
        payload: { team_id: TEAM_ID },
        event: {
          type: "pin_added",
          user: SLACK_USER_ID,
          channel_id: CHANNEL_ID,
          item: {
            type: "message",
            channel: CHANNEL_ID,
            created_by: "U0SOMEONEELSE",
            message: { ts: MESSAGE_TS, text: "Restarted the primary DB" },
          },
        },
      }),
    ).toEqual({
      teamId: TEAM_ID,
      reaction: "pushpin",
      userId: SLACK_USER_ID,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
    });
  });

  test("falls back to the item's channel, ts, creator and the event's team", () => {
    expect(
      SlackReactionNoteActions.getReactionDataFromPinEvent({
        payload: {},
        event: {
          type: "pin_added",
          team: TEAM_ID,
          item: {
            channel: CHANNEL_ID,
            ts: MESSAGE_TS,
            created_by: SLACK_USER_ID,
          },
        },
      }),
    ).toEqual({
      teamId: TEAM_ID,
      reaction: "pushpin",
      userId: SLACK_USER_ID,
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
    });
  });

  test("a pinned file is not a message", () => {
    expect(
      SlackReactionNoteActions.getReactionDataFromPinEvent({
        payload: { team_id: TEAM_ID },
        event: {
          type: "pin_added",
          user: SLACK_USER_ID,
          channel_id: CHANNEL_ID,
          item: { type: "file", file: { id: "F1" } },
        },
      }),
    ).toBeNull();
  });

  test.each([
    ["no item", { user: SLACK_USER_ID, channel_id: CHANNEL_ID }],
    [
      "no ts",
      {
        user: SLACK_USER_ID,
        channel_id: CHANNEL_ID,
        item: { type: "message", message: {} },
      },
    ],
    [
      "no channel",
      {
        user: SLACK_USER_ID,
        item: { type: "message", message: { ts: MESSAGE_TS } },
      },
    ],
    [
      "no user",
      {
        channel_id: CHANNEL_ID,
        item: { type: "message", message: { ts: MESSAGE_TS } },
      },
    ],
  ])("%s → null", (_name: string, event: any) => {
    expect(
      SlackReactionNoteActions.getReactionDataFromPinEvent({
        payload: { team_id: TEAM_ID },
        event: event,
      }),
    ).toBeNull();
  });

  test("the pin goes through the same path as a 📌 reaction", async () => {
    const pinData: SlackReactionData | null =
      SlackReactionNoteActions.getReactionDataFromPinEvent({
        payload: { team_id: TEAM_ID },
        event: {
          type: "pin_added",
          user: SLACK_USER_ID,
          channel_id: CHANNEL_ID,
          item: { type: "message", message: { ts: MESSAGE_TS } },
        },
      });

    await SlackReactionNoteActions.handleEmojiReaction(pinData!);

    expect(saveSpy.mock.calls[0]![0]).toEqual({
      resource: incidentResource(),
      noteType: WorkspaceNoteType.Private,
      userId: oneUptimeUserId,
      note: "Restarted the primary DB",
      // Same key as a 📌 on the same message, so both together save once.
      sourceMessageKey: `${CHANNEL_ID}:${MESSAGE_TS}`,
    });
  });
});
