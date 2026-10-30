import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubPrivateRecords } from "../../../TestingUtils/PrivateRecords";
import type { SpyInstance } from "jest-mock";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentEpisodeInternalNoteService from "../../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import SlackActionAuthorization from "../../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackAlertActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackConnectPrompt from "../../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackReactionNoteActions, {
  SlackReactionData,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/ReactionNote";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { WorkspacePendingActionKind } from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceReactionNote, {
  WorkspaceMessageNoteOutcome,
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import URL from "../../../../../Types/API/URL";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { WorkspaceNoteType } from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * reaction_added / pin_added in Slack: which incident / alert / ... the
 * message becomes a note on, as what - the message as it read in Slack,
 * whose words, posted when - who saved it, how that is confirmed, and when
 * nothing is written at all.
 */

const projectId: ObjectID = ObjectID.generate();
const secondProjectId: ObjectID = ObjectID.generate();
const oneUptimeUserId: ObjectID = ObjectID.generate();
// Aidil's OneUptime account, when his Slack account is connected.
const posterUserId: ObjectID = ObjectID.generate();

// The member's own props, as WorkspaceActionAuthorization.authorize builds them.
const memberProps: DatabaseCommonInteractionProps = {
  userId: oneUptimeUserId,
  tenantId: projectId,
};
const incidentId: ObjectID = ObjectID.generate();

const TEAM_ID: string = "T0WORKSPACE";
// Jane pins; Aidil wrote the message, three hours before.
const SLACK_USER_ID: string = "U0JANE";
const POSTER_SLACK_ID: string = "U0AIDIL";
const CHANNEL_ID: string = "C0INCIDENT";
const MESSAGE_TS: string = "1791454620.000200";
const POSTED_AT: string = "2026-10-08T10:17:00.000Z";
const THREAD_TS: string = "1791454000.000100";

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

// A message as conversations.history hands it over.
function slackMessage(overrides?: JSONObject): JSONObject {
  return {
    type: "message",
    user: POSTER_SLACK_ID,
    ts: MESSAGE_TS,
    text: "Restarted the primary DB",
    blocks: [
      {
        type: "rich_text",
        block_id: "b1",
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: "Restarted the primary DB" }],
          },
        ],
      },
    ],
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
let authorizeSpy: AnySpy;
let fetchSpy: AnySpy;
let namesSpy: AnySpy;
let saveSpy: SpyInstance<typeof WorkspaceReactionNote.saveNote>;
let threadReplySpy: AnySpy;
let refusalSpy: AnySpy;
let promptSpy: AnySpy;

// Which Slack accounts are connected, to which OneUptime member.
let connected: Record<string, ObjectID>;

beforeEach((): void => {
  connected = { [SLACK_USER_ID]: oneUptimeUserId };

  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);

  projectAuthFindSpy = jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockResolvedValue([projectAuth(projectId)]) as AnySpy;

  resolveSpy = jest
    .spyOn(WorkspaceReactionNote, "resolveResourceForChannel")
    .mockResolvedValue(incidentResource());

  userAuthFindSpy = jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (data: {
      query: { workspaceUserId: string };
    }): Promise<WorkspaceUserAuthToken | null> => {
      const userId: ObjectID | undefined =
        connected[data.query.workspaceUserId];

      if (!userId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.userId = userId;
      return userAuth;
    }) as never) as AnySpy;

  authorizeSpy = jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockResolvedValue(memberProps) as AnySpy;

  fetchSpy = jest
    .spyOn(SlackUtil, "getMessage")
    .mockResolvedValue(slackMessage()) as AnySpy;

  namesSpy = jest
    .spyOn(SlackUtil, "getUserDisplayName")
    .mockImplementation((async (data: {
      userId: string;
    }): Promise<{ name: string; isBot: boolean } | null> => {
      return data.userId === POSTER_SLACK_ID
        ? { name: "Aidil Rahman", isBot: false }
        : null;
    }) as never) as AnySpy;

  saveSpy = jest
    .spyOn(WorkspaceReactionNote, "saveNote")
    .mockResolvedValue(WorkspaceNoteSaveResult.Saved);

  jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
    label: "Incident #42",
    link: URL.fromString("https://oneuptime.test/incidents/42"),
  });

  threadReplySpy = jest
    .spyOn(SlackUtil, "sendMessageToThread")
    .mockResolvedValue(undefined as never) as AnySpy;

  refusalSpy = jest
    .spyOn(SlackActionAuthorization, "sendRefusal")
    .mockResolvedValue(undefined as never) as AnySpy;

  promptSpy = jest
    .spyOn(SlackConnectPrompt, "promptOnce")
    .mockResolvedValue(null) as AnySpy;
});

afterEach((): void => {
  jest.restoreAllMocks();
});

/*
 * A public note asked for in a chat - a 📣, an Add Note form - first asks
 * whether its incident or episode is private, which takes no public notes
 * (WorkspaceReactionNote.getNoteTypeSavedAs, WorkspaceNoteForm): none of
 * these is.
 */
beforeEach((): void => {
  stubPrivateRecords();
});

describe("SlackReactionNoteActions.handleEmojiReaction", () => {
  test("a pin saves the message as a private note, as Aidil's words, posted when he posted it", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    /*
     * Saved with the member's own props - Jane saved it - as the message
     * Aidil wrote: he has no OneUptime account, so he is named as Slack
     * names him, and the note is filed when he posted it.
     */
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      resource: incidentResource(),
      noteType: WorkspaceNoteType.Private,
      props: memberProps,
      note: "Restarted the primary DB",
      sourceMessageKey: `${CHANNEL_ID}:${MESSAGE_TS}`,
      savedFromChatMessage: {
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        postedAt: POSTED_AT,
      },
    });
    expect(saveSpy.mock.calls[0]![0].props).toBe(memberProps);

    expect(fetchSpy).toHaveBeenCalledWith({
      authToken: "xoxb-" + projectId.toString(),
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
    });

    /*
     * One confirmation, in the message's thread, with no link preview:
     * Slack's mrkdwn as SlackUtil.slackify writes it (bold between
     * zero-width spaces). The message itself is not posted again.
     */
    expect(threadReplySpy).toHaveBeenCalledTimes(1);
    expect(threadReplySpy).toHaveBeenCalledWith({
      authToken: "xoxb-" + projectId.toString(),
      channelId: CHANNEL_ID,
      threadTs: MESSAGE_TS,
      text: "✅ Saved as a ​*private note*​ on <https://oneuptime.test/incidents/42|Incident #42>.",
      withoutLinkPreviews: true,
    });
    expect(refusalSpy).not.toHaveBeenCalled();
  });

  test("the note keeps the message's formatting, links and mentions", async () => {
    connected[POSTER_SLACK_ID] = posterUserId;
    namesSpy.mockImplementation((async (data: { userId: string }) => {
      return data.userId === "U0NITIN"
        ? { name: "Nitin Kumar", isBot: false }
        : { name: "Aidil Rahman", isBot: false };
    }) as never);

    fetchSpy.mockResolvedValue(
      slackMessage({
        text: "*Root cause:* expired cert <@U0NITIN> <https://wiki.example.com/rca|the RCA>",
        blocks: [
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "Root cause:", style: { bold: true } },
                  { type: "text", text: " expired cert, cc " },
                  { type: "user", user_id: "U0NITIN" },
                  { type: "text", text: " - see " },
                  {
                    type: "link",
                    url: "https://wiki.example.com/rca",
                    text: "the RCA",
                  },
                ],
              },
              {
                type: "rich_text_list",
                style: "bullet",
                elements: [
                  {
                    type: "rich_text_section",
                    elements: [{ type: "text", text: "renewed" }],
                  },
                ],
              },
            ],
          },
        ],
        files: [
          {
            id: "F1",
            name: "graph.png",
            permalink: "https://acme.slack.com/files/U0AIDIL/F1/graph.png",
          },
        ],
      }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(saveSpy.mock.calls[0]![0].note).toBe(
      [
        "**Root cause:** expired cert, cc @Nitin Kumar - see [the RCA](https://wiki.example.com/rca)",
        "",
        "- renewed",
        "",
        "📎 [graph.png](https://acme.slack.com/files/U0AIDIL/F1/graph.png)",
      ].join("\n"),
    );
    // A public note leaves out the links into the company's Slack.
    expect(saveSpy.mock.calls[1]![0].note).toBe(
      [
        "**Root cause:** expired cert, cc @Nitin Kumar - see [the RCA](https://wiki.example.com/rca)",
        "",
        "- renewed",
      ].join("\n"),
    );
  });

  test("a message a connected member wrote is saved as theirs, by their OneUptime name", async () => {
    connected[POSTER_SLACK_ID] = posterUserId;

    const poster: User = new User();
    poster.name = new Name("Aidil R.");
    const userSpy: AnySpy = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(poster) as AnySpy;

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(userSpy.mock.calls[0]![0].id).toBe(posterUserId);
    expect(saveSpy.mock.calls[0]![0].savedFromChatMessage).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Aidil R.",
      authorUserId: posterUserId.toString(),
      postedAt: POSTED_AT,
    });
  });

  test("a message an app posted is saved as the app's", async () => {
    fetchSpy.mockResolvedValue(
      slackMessage({
        user: undefined,
        bot_id: "B0DD",
        bot_profile: { name: "Datadog" },
      }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy.mock.calls[0]![0].savedFromChatMessage).toEqual({
      workspaceType: WorkspaceType.Slack,
      authorName: "Datadog",
      postedAt: POSTED_AT,
    });
  });

  test("somebody Slack does not name is named nobody, never left out", async () => {
    namesSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy.mock.calls[0]![0].savedFromChatMessage).toEqual({
      workspaceType: WorkspaceType.Slack,
      postedAt: POSTED_AT,
    });
  });

  test("a label with Markdown or a mention in it is text in the confirmation's one link", async () => {
    jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
      label: "Incident INC*<!channel>*-42 [docs](https://example.com)",
      link: URL.fromString("https://oneuptime.test/incidents/42"),
    });

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    const text: string = threadReplySpy.mock.calls[0]![0].text;
    // One link, to the record: the label's own brackets make none.
    expect(text.split("<https://").length - 1).toBe(1);
    expect(text).toContain("<https://oneuptime.test/incidents/42|");
    expect(text).not.toContain("<https://example.com");
    // No mention of everyone in the channel.
    expect(text).not.toContain("<!channel>");
  });

  test("a megaphone saves a public note, and says it is on the status page", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(saveSpy.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Public);
    expect(threadReplySpy.mock.calls[0]![0].text).toBe(
      "✅ Saved as a ​*public note*​ on <https://oneuptime.test/incidents/42|Incident #42>. It is shown on the status page.",
    );
  });

  test("authorization is asked for the note row and the resource it lands on", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "loudspeaker" }),
    );

    expect(authorizeSpy).toHaveBeenCalledWith({
      userId: oneUptimeUserId,
      projectId: projectId,
      modelType: IncidentPublicNote,
      action: "add a public note to this incident",
      resources: [{ service: IncidentService, id: incidentId }],
    });
  });

  test("REGRESSION: a reply in a thread is read and confirmed in that thread", async () => {
    fetchSpy.mockResolvedValue(
      slackMessage({
        text: "Rolled back deploy 1234",
        blocks: [],
        thread_ts: THREAD_TS,
      }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy.mock.calls[0]![0].note).toBe("Rolled back deploy 1234");
    // Slack threads hang off the parent; replying to a reply's ts is wrong.
    expect(threadReplySpy.mock.calls[0]![0].threadTs).toBe(THREAD_TS);
  });

  /*
   * A reply in a thread in a shared channel is no notification of
   * OneUptime's: the record is the one whose message starts the thread
   * (WorkspaceReactionNote.resolveResourceForChannel), which Slack tells -
   * read only when the channel and the message itself name nothing.
   */
  test("REGRESSION: the thread the reacted-to message is in is read from Slack, only when asked", async () => {
    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    // resolveResourceForChannel is stubbed here: it never asked.
    const readsBeforeAsking: number = fetchSpy.mock.calls.length;

    const getThreadId: (() => Promise<string | null>) | undefined =
      resolveSpy.mock.calls[0]![0].getThreadId;
    expect(getThreadId).toBeDefined();
    expect(fetchSpy.mock.calls.length).toBe(readsBeforeAsking);

    fetchSpy.mockResolvedValueOnce(slackMessage({ thread_ts: THREAD_TS }));
    await expect(getThreadId!()).resolves.toBe(THREAD_TS);
    expect(fetchSpy.mock.calls[readsBeforeAsking]![0]).toEqual({
      authToken: "xoxb-" + projectId.toString(),
      channelId: CHANNEL_ID,
      messageTs: MESSAGE_TS,
    });

    // A reply that is only a file has no text, and is still in its thread.
    fetchSpy.mockResolvedValueOnce(
      slackMessage({ text: "", blocks: [], thread_ts: THREAD_TS }),
    );
    await expect(getThreadId!()).resolves.toBe(THREAD_TS);

    // In no thread, gone, or unreadable: no thread.
    fetchSpy.mockResolvedValueOnce(slackMessage());
    await expect(getThreadId!()).resolves.toBeNull();
    fetchSpy.mockResolvedValueOnce(null);
    await expect(getThreadId!()).resolves.toBeNull();
    fetchSpy.mockRejectedValueOnce(new Error("channel_not_found"));
    await expect(getThreadId!()).resolves.toBeNull();
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
      // Read from Slack only when asked (the thread the message is in).
      getThreadId: expect.any(Function),
      resourceTypes: undefined,
    });

    // The user and the token are the second project's.
    expect(userAuthFindSpy.mock.calls[0]![0].query).toEqual({
      workspaceUserId: SLACK_USER_ID,
      workspaceType: WorkspaceType.Slack,
      projectId: secondProjectId,
    });
    expect(fetchSpy.mock.calls[0]![0].authToken).toBe(
      "xoxb-" + secondProjectId.toString(),
    );
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

  test("somebody who never connected Slack is asked once, only they see it, with a button that saves the message", async () => {
    connected = {};

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(authorizeSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(threadReplySpy).not.toHaveBeenCalled();

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith({
      projectId: projectId,
      place: {
        projectAuthToken: "xoxb-" + projectId.toString(),
        slackUserId: SLACK_USER_ID,
        slackChannelId: CHANNEL_ID,
      },
      slackTeamId: TEAM_ID,
      description: {
        // The prompt is at the foot of the channel: not "this message".
        purpose:
          "save the message you pinned as a private note on this incident",
        pendingAction: {
          kind: WorkspacePendingActionKind.SavePrivateNote,
          eventType: WorkspaceEventType.Incident,
          eventId: incidentId,
          message: { channelId: CHANNEL_ID, messageId: MESSAGE_TS },
        },
      },
      // One question for the message, however many pins.
      conversation: {
        workspaceType: WorkspaceType.Slack,
        workspaceId: TEAM_ID,
        conversationId: `${CHANNEL_ID}:${MESSAGE_TS}`,
        workspaceUserId: SLACK_USER_ID,
      },
    });
  });

  test("a megaphone from somebody not connected asks to save a public note", async () => {
    connected = {};

    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(promptSpy.mock.calls[0]![0].description.purpose).toBe(
      "save the message you reacted to as a public note on this incident",
    );
    expect(promptSpy.mock.calls[0]![0].description.pendingAction.kind).toBe(
      WorkspacePendingActionKind.SavePublicNote,
    );
  });

  test("a refused member is told why, only they see it, and the message is never read or saved", async () => {
    authorizeSpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to add a private note to this incident.",
      ),
    );

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(threadReplySpy).not.toHaveBeenCalled();
    expect(refusalSpy).toHaveBeenCalledWith({
      requester: {
        userId: oneUptimeUserId,
        projectId: projectId,
        projectAuthToken: "xoxb-" + projectId.toString(),
        slackUserId: SLACK_USER_ID,
        slackChannelId: CHANNEL_ID,
      },
      message:
        "You do not have permission to add a private note to this incident.",
    });
  });

  test("an unexpected authorization failure is thrown, not told as a refusal", async () => {
    authorizeSpy.mockRejectedValue(new Error("redis timeout"));

    await expect(
      SlackReactionNoteActions.handleEmojiReaction(reaction()),
    ).rejects.toThrow("redis timeout");

    expect(refusalSpy).not.toHaveBeenCalled();
  });

  test("a message Slack cannot read is not saved", async () => {
    fetchSpy.mockRejectedValue(new Error("channel_not_found"));

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(refusalSpy).not.toHaveBeenCalled();
  });

  test("a message Slack no longer has is not saved", async () => {
    fetchSpy.mockResolvedValue(null);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(threadReplySpy).not.toHaveBeenCalled();
  });

  test("a message with nothing to save is not saved, and the member is told", async () => {
    fetchSpy.mockResolvedValue(slackMessage({ text: "", blocks: [] }));

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(saveSpy).not.toHaveBeenCalled();
    expect(refusalSpy.mock.calls[0]![0].message).toBe(
      "The message you pinned has no text to save as a note.",
    );
  });

  test("a message of only files is not put on the status page, and the member is told why", async () => {
    fetchSpy.mockResolvedValue(
      slackMessage({
        text: "",
        blocks: [],
        files: [
          {
            id: "F1",
            name: "graph.png",
            permalink: "https://acme.slack.com/files/U0AIDIL/F1/graph.png",
          },
        ],
      }),
    );

    await SlackReactionNoteActions.handleEmojiReaction(
      reaction({ reaction: "mega" }),
    );

    expect(saveSpy).not.toHaveBeenCalled();
    expect(refusalSpy.mock.calls[0]![0].message).toBe(
      "The message you reacted to has only files or images, which the status page does not show, so it was not saved as a public note.",
    );
  });

  test("reacting again, or pin and 📌 together, saves once and confirms once", async () => {
    saveSpy.mockResolvedValue(WorkspaceNoteSaveResult.Duplicate);

    await SlackReactionNoteActions.handleEmojiReaction(reaction());

    expect(threadReplySpy).not.toHaveBeenCalled();
    expect(refusalSpy).not.toHaveBeenCalled();
  });

  test("a failed save sends no confirmation, and no refusal", async () => {
    saveSpy.mockRejectedValue(new Error("database is down"));

    await expect(
      SlackReactionNoteActions.handleEmojiReaction(reaction()),
    ).resolves.toBeUndefined();

    expect(threadReplySpy).not.toHaveBeenCalled();
    // Not a refusal: its text is for operators, not the member.
    expect(refusalSpy).not.toHaveBeenCalled();
  });

  /*
   * The note is saved with the member's props, so its own create can still
   * refuse it after the check above let them through: a label, a column,
   * the plan. The member is told why, as for a button.
   */
  test.each([
    [
      "a permission",
      new NotAuthorizedException(
        "You do not have permission to create Incident Internal Note.",
      ),
    ],
    [
      "a value",
      new BadDataException(
        'This incident internal note references records that are not in this project: Incident "42".',
      ),
    ],
    [
      "the plan",
      new PaymentRequiredException(
        "Please upgrade your plan to Growth to access this feature",
      ),
    ],
  ])(
    "a save its own create refuses (%s) is told to the member, and nothing is confirmed",
    async (_what: string, refusal: Error) => {
      saveSpy.mockRejectedValue(refusal);

      await expect(
        SlackReactionNoteActions.handleEmojiReaction(reaction()),
      ).resolves.toBeUndefined();

      expect(refusalSpy).toHaveBeenCalledTimes(1);
      expect(refusalSpy.mock.calls[0]![0].message).toBe(
        `Could not save the message as a note: ${refusal.message}`,
      );
      expect(threadReplySpy).not.toHaveBeenCalled();
    },
  );

  test("a failed confirmation does not undo or fail the save", async () => {
    threadReplySpy.mockRejectedValue(new Error("not_in_channel"));

    await expect(
      SlackReactionNoteActions.handleEmojiReaction(reaction()),
    ).resolves.toBeUndefined();

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("SlackReactionNoteActions.saveMessage: finished once an account is connected", () => {
  const requester: {
    userId: ObjectID;
    projectId: ObjectID;
    projectAuthToken: string;
    slackUserId: string;
    slackChannelId: string;
  } = {
    userId: oneUptimeUserId,
    projectId: projectId,
    projectAuthToken: "xoxb-project",
    slackUserId: SLACK_USER_ID,
    slackChannelId: CHANNEL_ID,
  };

  test("saves the message and confirms it in its thread", async () => {
    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({
      outcome: WorkspaceMessageNoteOutcome.Saved,
      // Saved as the note the pin asked for: the incident is not private.
      noteType: WorkspaceNoteType.Private,
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(threadReplySpy).toHaveBeenCalledTimes(1);
  });

  test("a refusal comes back to be told with the Connect answer, not on its own", async () => {
    authorizeSpy.mockRejectedValue(new NotAuthorizedException("No."));

    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({
      outcome: WorkspaceMessageNoteOutcome.Refused,
      reason: "No.",
    });
    expect(refusalSpy).not.toHaveBeenCalled();
  });

  test("nothing to save, saved already, gone, and a failure each come back as such", async () => {
    fetchSpy.mockResolvedValueOnce(slackMessage({ text: "", blocks: [] }));
    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({
      outcome: WorkspaceMessageNoteOutcome.NothingToSave,
      reason: "The message you pinned has no text to save as a note.",
    });

    saveSpy.mockResolvedValueOnce(WorkspaceNoteSaveResult.Duplicate);
    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({ outcome: WorkspaceMessageNoteOutcome.AlreadySaved });

    fetchSpy.mockResolvedValueOnce(null);
    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({ outcome: WorkspaceMessageNoteOutcome.NotFound });

    fetchSpy.mockRejectedValueOnce(new Error("ratelimited"));
    await expect(
      SlackReactionNoteActions.saveMessage({
        requester: requester,
        resource: incidentResource(),
        noteType: WorkspaceNoteType.Private,
        channelId: CHANNEL_ID,
        messageTs: MESSAGE_TS,
        tellPerson: false,
      }),
    ).resolves.toEqual({ outcome: WorkspaceMessageNoteOutcome.Failed });

    expect(refusalSpy).not.toHaveBeenCalled();
  });
});

describe("REGRESSION: Slack episode channels (never worked before)", () => {
  test("a pin in an incident episode channel saves a private episode note, filed when the message was posted", async () => {
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
      props: memberProps,
      note: "Restarted the primary DB",
      postedFromSlackMessageId: `${CHANNEL_ID}:${MESSAGE_TS}`,
      savedFromChatMessage: {
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        postedAt: POSTED_AT,
      },
      postedAt: new Date(POSTED_AT),
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
      props: memberProps,
      note: "Restarted the primary DB",
      // Same key as a 📌 on the same message, so both together save once.
      sourceMessageKey: `${CHANNEL_ID}:${MESSAGE_TS}`,
      savedFromChatMessage: {
        workspaceType: WorkspaceType.Slack,
        authorName: "Aidil Rahman",
        postedAt: POSTED_AT,
      },
    });
  });
});
