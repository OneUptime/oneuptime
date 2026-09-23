import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Pinning (📌) or megaphoning (📣) a message in a Microsoft Teams incident /
 * alert channel never reached OneUptime: the Bot Framework only reports
 * reactions to the bot's own messages, and OneUptime had no handler for those
 * either. MicrosoftTeamsReactionNoteSync reads the reactions from Graph
 * instead. These tests drive it with Graph and the database stubbed.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
  };
});

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: { text: jest.fn(), attachment: jest.fn() },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: { getMembers: jest.fn(), getPagedMembers: jest.fn() },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsReactionNoteSync, {
  MicrosoftTeamsNoteReaction,
  MicrosoftTeamsReactionOutcome,
  MicrosoftTeamsWatchedChannel,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import type { ConversationReference, TurnContext } from "botbuilder";

const projectId: ObjectID = ObjectID.generate();
const oneUptimeUserId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const TEAM_ID: string = "team-graph-id";
const CHANNEL_ID: string = "19:incident-42@thread.tacv2";
const AAD_USER_ID: string = "aad-jane";
const NOW: Date = new Date("2026-09-23T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function graphReaction(data: {
  reactionType?: string;
  displayName?: string;
  userId?: string | null;
  userName?: string;
  createdDateTime?: string;
  application?: boolean;
}): JSONObject {
  const user: JSONObject = data.application
    ? { application: { id: "app-1", displayName: "Some Bot" } }
    : data.userId === null
      ? {}
      : {
          user: {
            id: data.userId || AAD_USER_ID,
            displayName: data.userName || "Jane Doe",
            userIdentityType: "aadUser",
          },
        };

  return {
    reactionType: data.reactionType ?? "📌",
    displayName: data.displayName ?? "Pushpin",
    createdDateTime: data.createdDateTime ?? minutesAgo(1),
    user: user,
  };
}

function graphMessage(data: {
  id: string;
  content?: string;
  contentType?: string;
  reactions?: Array<JSONObject>;
  replies?: Array<JSONObject>;
  replyToId?: string;
  messageType?: string;
  deletedDateTime?: string;
  attachments?: Array<JSONObject>;
}): JSONObject {
  const message: JSONObject = {
    id: data.id,
    replyToId: data.replyToId || null,
    messageType: data.messageType || "message",
    deletedDateTime: data.deletedDateTime || null,
    body: {
      contentType: data.contentType || "html",
      content: data.content ?? "<p>Restarted the primary DB</p>",
    },
    attachments: data.attachments || [],
    reactions: data.reactions || [],
  };

  if (data.replies) {
    message["replies"] = data.replies;
  }

  return message;
}

function watchedChannel(
  resourceType: WorkspaceNoteResourceType = WorkspaceNoteResourceType.Incident,
): MicrosoftTeamsWatchedChannel {
  return {
    resource: {
      resourceType: resourceType,
      resourceId: incidentId,
      projectId: projectId,
    },
    channelId: CHANNEL_ID,
    teamId: TEAM_ID,
  };
}

function noteReaction(
  overrides?: Partial<MicrosoftTeamsNoteReaction>,
): MicrosoftTeamsNoteReaction {
  return {
    message: graphMessage({ id: "1700000000200" }),
    messageId: "1700000000200",
    threadId: "1700000000100",
    noteType: WorkspaceNoteType.Private,
    reactingUserId: AAD_USER_ID,
    reactingUserName: "Jane Doe",
    reactedAt: new Date(NOW.getTime() - 60 * 1000),
    ...(overrides || {}),
  };
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsReactionNoteSync.getNoteReactions", () => {
  const since: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

  test("finds pins and megaphones on messages and on replies", () => {
    const reactions: Array<MicrosoftTeamsNoteReaction> =
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [
          graphMessage({
            id: "100",
            reactions: [
              graphReaction({ createdDateTime: minutesAgo(10) }),
              graphReaction({
                reactionType: "like",
                displayName: "Like",
              }),
            ],
            replies: [
              graphMessage({
                id: "101",
                replyToId: "100",
                reactions: [
                  graphReaction({
                    reactionType: "📣",
                    displayName: "Megaphone",
                    createdDateTime: minutesAgo(5),
                  }),
                ],
              }),
            ],
          }),
        ],
      });

    expect(
      reactions.map((r: MicrosoftTeamsNoteReaction) => {
        return {
          messageId: r.messageId,
          threadId: r.threadId,
          noteType: r.noteType,
          reactingUserId: r.reactingUserId,
          reactingUserName: r.reactingUserName,
        };
      }),
    ).toEqual([
      {
        messageId: "100",
        threadId: "100",
        noteType: WorkspaceNoteType.Private,
        reactingUserId: AAD_USER_ID,
        reactingUserName: "Jane Doe",
      },
      {
        // A reply is answered in its thread, which hangs off the parent.
        messageId: "101",
        threadId: "100",
        noteType: WorkspaceNoteType.Public,
        reactingUserId: AAD_USER_ID,
        reactingUserName: "Jane Doe",
      },
    ]);
  });

  test("oldest reaction first, across threads", () => {
    const reactions: Array<MicrosoftTeamsNoteReaction> =
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [
          graphMessage({
            id: "200",
            reactions: [graphReaction({ createdDateTime: minutesAgo(1) })],
          }),
          graphMessage({
            id: "100",
            reactions: [graphReaction({ createdDateTime: minutesAgo(30) })],
          }),
        ],
      });

    expect(
      reactions.map((r: MicrosoftTeamsNoteReaction) => {
        return r.messageId;
      }),
    ).toEqual(["100", "200"]);
  });

  test("uses the display name when Teams reports a custom reaction type", () => {
    const reactions: Array<MicrosoftTeamsNoteReaction> =
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [
          graphMessage({
            id: "100",
            reactions: [
              graphReaction({ reactionType: "custom", displayName: "Pushpin" }),
            ],
          }),
        ],
      });

    expect(reactions).toHaveLength(1);
  });

  test.each([
    [
      "a reaction older than the window",
      graphMessage({
        id: "100",
        reactions: [graphReaction({ createdDateTime: minutesAgo(25 * 60) })],
      }),
    ],
    [
      "a reaction without a time",
      graphMessage({
        id: "100",
        reactions: [{ ...graphReaction({}), createdDateTime: null }],
      }),
    ],
    [
      "a reaction with an unparseable time",
      graphMessage({
        id: "100",
        reactions: [graphReaction({ createdDateTime: "not a date" })],
      }),
    ],
    [
      "a reaction by an app",
      graphMessage({
        id: "100",
        reactions: [graphReaction({ application: true })],
      }),
    ],
    [
      "a reaction with no user",
      graphMessage({
        id: "100",
        reactions: [graphReaction({ userId: null })],
      }),
    ],
    [
      "a deleted message",
      graphMessage({
        id: "100",
        deletedDateTime: minutesAgo(2),
        reactions: [graphReaction({})],
      }),
    ],
    [
      "a system message",
      graphMessage({
        id: "100",
        messageType: "systemEventMessage",
        reactions: [graphReaction({})],
      }),
    ],
    [
      "any other emoji",
      graphMessage({
        id: "100",
        reactions: [
          graphReaction({ reactionType: "heart", displayName: "Heart" }),
          graphReaction({ reactionType: "👍", displayName: "Thumbs up" }),
        ],
      }),
    ],
  ])("ignores %s", (_name: string, message: JSONObject) => {
    expect(
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [message],
      }),
    ).toEqual([]);
  });

  test("a message without an id is skipped, with its replies", () => {
    const message: JSONObject = graphMessage({
      id: "100",
      reactions: [graphReaction({})],
      replies: [
        graphMessage({
          id: "101",
          replyToId: "100",
          reactions: [graphReaction({})],
        }),
      ],
    });
    delete message["id"];

    expect(
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [message],
      }),
    ).toEqual([]);
  });

  test("tolerates an empty or missing page", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: [],
      }),
    ).toEqual([]);
    expect(
      MicrosoftTeamsReactionNoteSync.getNoteReactions({
        since: since,
        messages: undefined as unknown as Array<JSONObject>,
      }),
    ).toEqual([]);
  });
});

describe("MicrosoftTeamsReactionNoteSync.getMessageText", () => {
  test("turns Teams HTML into readable text", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          id: "1",
          content:
            '<p>Failed over to <at id="0">DB Replica</at>&nbsp;at 12:03</p><p>Next:<br>check lag</p><ul><li>one</li><li>two</li></ul>',
        }),
      ),
    ).toBe(
      "Failed over to @DB Replica at 12:03\nNext:\ncheck lag\n- one\n- two",
    );
  });

  test("decodes entities once — &amp;lt; stays &lt;", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.htmlToText(
        "a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &apos;e&apos; &#128204; &#x1F4E3; &amp;lt;",
      ),
    ).toBe(`a <b> & "c" 'd' 'e' 📌 📣 &lt;`);
  });

  test("collapses blank lines and trims", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.htmlToText(
        "<div>\n\n<p>one</p>   \n\n\n\n<p>two</p></div>",
      ),
    ).toBe("one\n\ntwo");
  });

  test("an invalid numeric entity is dropped rather than throwing", () => {
    expect(MicrosoftTeamsReactionNoteSync.htmlToText("x&#99999999;y")).toBe(
      "xy",
    );
  });

  test("plain text bodies are used as they are", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          id: "1",
          contentType: "text",
          content: "  a <b>literal</b> text  ",
        }),
      ),
    ).toBe("a <b>literal</b> text");
  });

  test("a card message (like OneUptime's own posts) is read from the card", () => {
    const card: JSONObject = {
      type: "AdaptiveCard",
      body: [
        { type: "TextBlock", text: "Incident #42 acknowledged" },
        {
          type: "Container",
          items: [
            {
              type: "ColumnSet",
              columns: [
                {
                  type: "Column",
                  items: [{ type: "TextBlock", text: "  by Jane  " }],
                },
              ],
            },
          ],
        },
        {
          type: "FactSet",
          facts: [
            { title: "Severity:", value: "SEV1" },
            { title: "", value: "Only value" },
            { title: "", value: "" },
          ],
        },
        {
          type: "RichTextBlock",
          inlines: ["Rich ", { type: "TextRun", text: "text" }],
        },
        { type: "Image", url: "https://x/y.png" },
      ],
    };

    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          id: "1",
          content: '<attachment id="card-1"></attachment>',
          attachments: [
            {
              id: "card-1",
              contentType: "application/vnd.microsoft.card.adaptive",
              content: JSON.stringify(card),
            },
          ],
        }),
      ),
    ).toBe(
      "Incident #42 acknowledged\nby Jane\nSeverity: SEV1\nOnly value\nRich text",
    );
  });

  test("text and card are both kept", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          id: "1",
          content: 'Look at this <attachment id="c"></attachment>',
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                type: "AdaptiveCard",
                body: [{ type: "TextBlock", text: "Card text" }],
              },
            },
            {
              contentType: "reference",
              contentUrl: "https://sharepoint/file.docx",
            },
          ],
        }),
      ),
    ).toBe("Look at this\n\nCard text");
  });

  test("a malformed card is ignored", () => {
    expect(
      MicrosoftTeamsReactionNoteSync.getMessageText(
        graphMessage({
          id: "1",
          content: "",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: "{not json",
            },
          ],
        }),
      ),
    ).toBe("");
  });

  test("a message with no body is empty", () => {
    expect(MicrosoftTeamsReactionNoteSync.getMessageText({ id: "1" })).toBe("");
    expect(MicrosoftTeamsReactionNoteSync.htmlToText("")).toBe("");
  });
});

describe("MicrosoftTeamsReactionNoteSync.processReaction", () => {
  let claimSpy: jest.SpyInstance;
  let releaseSpy: jest.SpyInstance;
  let hasNoteSpy: jest.SpyInstance;
  let userAuthSpy: jest.SpyInstance;
  let authorizeSpy: jest.SpyInstance;
  let saveSpy: jest.SpyInstance;
  let replySpy: jest.SpyInstance;

  beforeEach((): void => {
    claimSpy = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true);
    releaseSpy = jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue();
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
      .mockResolvedValue({ userId: oneUptimeUserId });

    saveSpy = jest
      .spyOn(WorkspaceReactionNote, "saveNote")
      .mockResolvedValue(WorkspaceNoteSaveResult.Saved);

    jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
      label: "Incident #42",
      link: URL.fromString("https://oneuptime.test/incidents/42"),
    });

    replySpy = jest
      .spyOn(MicrosoftTeamsUtil, "sendTextReplyToChannelThread")
      .mockResolvedValue();

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  });

  test("a pin saves a private note in the user's name and confirms in the thread", async () => {
    const outcome: MicrosoftTeamsReactionOutcome =
      await MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      });

    expect(outcome).toBe(MicrosoftTeamsReactionOutcome.Saved);

    expect(userAuthSpy.mock.calls[0]![0].query).toEqual({
      workspaceUserId: AAD_USER_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
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
      sourceMessageKey: `${CHANNEL_ID}:1700000000200`,
    });

    expect(replySpy).toHaveBeenCalledWith({
      projectId: projectId,
      teamId: TEAM_ID,
      channelId: CHANNEL_ID,
      parentMessageId: "1700000000100",
      text: "✅ Message saved as **private note** to [Incident #42](https://oneuptime.test/incidents/42).",
    });

    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("a megaphone saves a public note and says it is on the status page", async () => {
    await MicrosoftTeamsReactionNoteSync.processReaction({
      channel: watchedChannel(),
      reaction: noteReaction({ noteType: WorkspaceNoteType.Public }),
      now: NOW,
    });

    expect(saveSpy.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Public);
    expect(authorizeSpy.mock.calls[0]![0].action).toBe(
      "add a public note to this incident",
    );
    expect(replySpy.mock.calls[0]![0].text).toContain(
      "This note will be visible on the status page.",
    );
  });

  test("the reaction is claimed once, keyed to the resource, message, person and time", async () => {
    const reaction: MicrosoftTeamsNoteReaction = noteReaction();

    await MicrosoftTeamsReactionNoteSync.processReaction({
      channel: watchedChannel(),
      reaction: reaction,
      now: NOW,
    });

    expect(claimSpy).toHaveBeenCalledWith(
      "microsoft-teams-reaction-note",
      [
        incidentId.toString(),
        "private",
        CHANNEL_ID,
        "1700000000200",
        AAD_USER_ID,
        reaction.reactedAt.getTime().toString(),
      ].join(":"),
      "1",
      { expiresInSeconds: 2 * 24 * 60 * 60 },
    );
  });

  test("a reaction already handled (earlier run, or another worker) is left alone", async () => {
    claimSpy.mockResolvedValue(false);

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.AlreadyHandled);

    expect(hasNoteSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("with no cache to claim in, nothing is done (rather than risk repeats)", async () => {
    claimSpy.mockRejectedValue(new Error("Cache is not connected"));

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.AlreadyHandled);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a megaphone in an alert channel is not supported, and not even claimed", async () => {
    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(WorkspaceNoteResourceType.Alert),
        reaction: noteReaction({ noteType: WorkspaceNoteType.Public }),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.NotSupported);

    expect(claimSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a note someone else's pin already saved is not saved again, and nobody is pinged", async () => {
    hasNoteSpy.mockResolvedValue(true);

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.AlreadySaved);

    expect(hasNoteSpy).toHaveBeenCalledWith({
      resource: watchedChannel().resource,
      noteType: WorkspaceNoteType.Private,
      sourceMessageKey: `${CHANNEL_ID}:1700000000200`,
    });
    expect(userAuthSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a save that races into a duplicate is not confirmed twice", async () => {
    saveSpy.mockResolvedValue(WorkspaceNoteSaveResult.Duplicate);

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.AlreadySaved);

    expect(replySpy).not.toHaveBeenCalled();
  });

  test("someone who has not linked Teams is told how to, once, while the reaction is fresh", async () => {
    userAuthSpy.mockResolvedValue(null);

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.NotLinked);

    expect(authorizeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replySpy.mock.calls[0]![0].parentMessageId).toBe("1700000000100");
    expect(replySpy.mock.calls[0]![0].text).toBe(
      `Jane Doe, to save messages as notes, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](https://oneuptime.test/dashboard/${projectId.toString()}/user-settings/microsoft-teams-integration), then react again.`,
    );
  });

  test("the link hint still makes sense without a name or a dashboard URL", async () => {
    userAuthSpy.mockResolvedValue(null);
    (
      DatabaseConfig.getDashboardUrl as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("no host"));

    await MicrosoftTeamsReactionNoteSync.processReaction({
      channel: watchedChannel(),
      reaction: noteReaction({ reactingUserName: undefined }),
      now: NOW,
    });

    expect(replySpy.mock.calls[0]![0].text).toBe(
      "To save messages as notes, first connect your Microsoft Teams account to OneUptime, then react again.",
    );
  });

  test("an old reaction by someone unlinked gets no reply", async () => {
    userAuthSpy.mockResolvedValue(null);

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          reactedAt: new Date(NOW.getTime() - 16 * 60 * 1000),
        }),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.NotLinked);

    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a member who may not add the note is told why, and nothing is saved", async () => {
    authorizeSpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to add a public note to this incident.",
      ),
    );

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({ noteType: WorkspaceNoteType.Public }),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.NotAuthorized);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(replySpy.mock.calls[0]![0].text).toBe(
      "Jane Doe, You do not have permission to add a public note to this incident.",
    );
    // A refusal is an answer: it is not retried next minute.
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("an old refused reaction gets no reply", async () => {
    authorizeSpy.mockRejectedValue(new NotAuthorizedException("No."));

    await MicrosoftTeamsReactionNoteSync.processReaction({
      channel: watchedChannel(),
      reaction: noteReaction({
        reactedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        reactingUserName: undefined,
      }),
      now: NOW,
    });

    expect(replySpy).not.toHaveBeenCalled();
  });

  test("a message with nothing to save is skipped", async () => {
    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction({
          message: graphMessage({ id: "1700000000200", content: "<p> </p>" }),
        }),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.NoText);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("an unexpected failure releases the claim so the next run retries, and is reported", async () => {
    saveSpy.mockRejectedValue(new Error("database is down"));

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).rejects.toThrow("database is down");

    expect(releaseSpy).toHaveBeenCalledWith(
      "microsoft-teams-reaction-note",
      claimSpy.mock.calls[0]![1],
    );
  });

  test("an unexpected authorization failure is not mistaken for a refusal", async () => {
    authorizeSpy.mockRejectedValue(new Error("redis timeout"));

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).rejects.toThrow("redis timeout");

    expect(replySpy).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  test("a failure to release the claim does not hide the original error", async () => {
    saveSpy.mockRejectedValue(new Error("database is down"));
    releaseSpy.mockRejectedValue(new Error("cache gone"));

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).rejects.toThrow("database is down");
  });

  test("a failed confirmation does not fail the save", async () => {
    replySpy.mockRejectedValue(new Error("bot not in team"));

    await expect(
      MicrosoftTeamsReactionNoteSync.processReaction({
        channel: watchedChannel(),
        reaction: noteReaction(),
        now: NOW,
      }),
    ).resolves.toBe(MicrosoftTeamsReactionOutcome.Saved);

    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("an episode channel saves an episode note", async () => {
    await MicrosoftTeamsReactionNoteSync.processReaction({
      channel: watchedChannel(WorkspaceNoteResourceType.AlertEpisode),
      reaction: noteReaction(),
      now: NOW,
    });

    expect(saveSpy.mock.calls[0]![0].resource.resourceType).toBe(
      WorkspaceNoteResourceType.AlertEpisode,
    );
    expect(authorizeSpy.mock.calls[0]![0].resources).toEqual([
      { service: AlertEpisodeService, id: incidentId },
    ]);
  });
});

describe("MicrosoftTeamsReactionNoteSync.syncChannel", () => {
  test("reads the channel from Graph and handles each note reaction, oldest first", async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    try {
      const readSpy: jest.SpyInstance = jest
        .spyOn(MicrosoftTeamsUtil, "getRecentChannelMessagesWithReplies")
        .mockResolvedValue([
          graphMessage({
            id: "200",
            reactions: [
              graphReaction({ createdDateTime: minutesAgo(1) }),
              graphReaction({
                reactionType: "📢",
                displayName: "Loudspeaker",
                createdDateTime: minutesAgo(2),
              }),
              graphReaction({ reactionType: "like", displayName: "Like" }),
            ],
          }),
          graphMessage({ id: "100" }),
        ]);

      const processSpy: jest.SpyInstance = jest
        .spyOn(MicrosoftTeamsReactionNoteSync, "processReaction")
        .mockResolvedValue(MicrosoftTeamsReactionOutcome.Saved);

      const outcomes: Array<MicrosoftTeamsReactionOutcome> =
        await MicrosoftTeamsReactionNoteSync.syncChannel({
          projectId: projectId,
          authToken: "teams-token",
          channel: watchedChannel(),
        });

      expect(readSpy).toHaveBeenCalledWith({
        authToken: "teams-token",
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
      });

      expect(outcomes).toEqual([
        MicrosoftTeamsReactionOutcome.Saved,
        MicrosoftTeamsReactionOutcome.Saved,
      ]);
      expect(
        processSpy.mock.calls.map((call: Array<any>) => {
          return call[0].reaction.noteType;
        }),
      ).toEqual([WorkspaceNoteType.Public, WorkspaceNoteType.Private]);
      expect(processSpy.mock.calls[0]![0].now).toEqual(NOW);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a Graph failure is thrown to the caller", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getRecentChannelMessagesWithReplies")
      .mockRejectedValue(new Error("Forbidden"));

    await expect(
      MicrosoftTeamsReactionNoteSync.syncChannel({
        projectId: projectId,
        authToken: "teams-token",
        channel: watchedChannel(),
      }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("MicrosoftTeamsReactionNoteSync.getWatchedChannels", () => {
  const SERVICES: Record<WorkspaceNoteResourceType, any> = {
    [WorkspaceNoteResourceType.Incident]: IncidentService,
    [WorkspaceNoteResourceType.Alert]: AlertService,
    [WorkspaceNoteResourceType.ScheduledMaintenance]:
      ScheduledMaintenanceService,
    [WorkspaceNoteResourceType.IncidentEpisode]: IncidentEpisodeService,
    [WorkspaceNoteResourceType.AlertEpisode]: AlertEpisodeService,
  };

  function resourceRow(data: {
    createdAt: Date;
    channels: Array<JSONObject>;
    id?: ObjectID;
  }): Incident {
    const incident: Incident = new Incident();
    incident.id = data.id || ObjectID.generate();
    incident.projectId = projectId;
    incident.createdAt = data.createdAt;
    incident.postUpdatesToWorkspaceChannels = data.channels as never;
    return incident;
  }

  function mockRows(
    rows: Partial<Record<WorkspaceNoteResourceType, Array<Incident>>>,
  ): Record<WorkspaceNoteResourceType, jest.SpyInstance> {
    const spies: Partial<Record<WorkspaceNoteResourceType, jest.SpyInstance>> =
      {};

    for (const resourceType of Object.values(WorkspaceNoteResourceType)) {
      spies[resourceType] = jest
        .spyOn(SERVICES[resourceType], "findBy")
        .mockResolvedValue(rows[resourceType] || []);
    }

    return spies as Record<WorkspaceNoteResourceType, jest.SpyInstance>;
  }

  test("collects the Teams channels of open and recently changed resources", async () => {
    const incident: Incident = resourceRow({
      createdAt: new Date("2026-09-20"),
      channels: [
        {
          id: CHANNEL_ID,
          name: "incident-42",
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAM_ID,
        },
        // Slack channels are Slack's business.
        {
          id: "C0SLACK",
          name: "incident-42",
          workspaceType: WorkspaceType.Slack,
        },
        // A Teams channel without a team cannot be read.
        {
          id: "19:orphan@thread.tacv2",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        null as unknown as JSONObject,
      ],
    });

    const spies: Record<WorkspaceNoteResourceType, jest.SpyInstance> = mockRows(
      { [WorkspaceNoteResourceType.Incident]: [incident] },
    );

    const channels: Array<MicrosoftTeamsWatchedChannel> =
      await MicrosoftTeamsReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      });

    expect(channels).toEqual([
      {
        resource: {
          resourceType: WorkspaceNoteResourceType.Incident,
          resourceId: incident.id,
          projectId: projectId,
        },
        channelId: CHANNEL_ID,
        teamId: TEAM_ID,
      },
    ]);

    // Two queries per type: still open, and changed in the last day.
    const calls: Array<Array<any>> =
      spies[WorkspaceNoteResourceType.Incident].mock.calls;
    expect(calls).toHaveLength(2);

    const openQuery: any = calls[0]![0].query;
    expect(openQuery.projectId).toBe(projectId);
    expect(openQuery.currentIncidentState).toEqual({ isResolvedState: false });
    expect(
      Object.values(
        openQuery.postUpdatesToWorkspaceChannels.objectLiteralParameters,
      ),
    ).toEqual([
      JSON.stringify([{ workspaceType: WorkspaceType.MicrosoftTeams }]),
    ]);

    const recentQuery: any = calls[1]![0].query;
    expect(recentQuery.currentIncidentState).toBeUndefined();
    expect(recentQuery.updatedAt.type).toBe("raw");

    for (const call of calls) {
      expect(call[0].limit).toBe(
        MicrosoftTeamsReactionNoteSync.MAX_RESOURCES_PER_TYPE,
      );
      expect(call[0].props).toEqual({ isRoot: true });
    }

    for (const resourceType of Object.values(WorkspaceNoteResourceType)) {
      expect(spies[resourceType]).toHaveBeenCalledTimes(2);
    }
  });

  test("a resource found by both queries is listed once", async () => {
    const incident: Incident = resourceRow({
      createdAt: new Date("2026-09-20"),
      channels: [
        {
          id: CHANNEL_ID,
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAM_ID,
        },
      ],
    });
    mockRows({ [WorkspaceNoteResourceType.Incident]: [incident] });

    await expect(
      MicrosoftTeamsReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      }),
    ).resolves.toHaveLength(1);
  });

  test("when two resources list the same channel the newest owns it", async () => {
    const channel: JSONObject = {
      id: CHANNEL_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: TEAM_ID,
    };
    const olderIncident: Incident = resourceRow({
      createdAt: new Date("2026-01-01"),
      channels: [channel],
    });
    const newerEpisode: Incident = resourceRow({
      createdAt: new Date("2026-09-01"),
      channels: [channel],
    });
    mockRows({
      [WorkspaceNoteResourceType.Incident]: [olderIncident],
      [WorkspaceNoteResourceType.IncidentEpisode]: [newerEpisode],
    });

    const channels: Array<MicrosoftTeamsWatchedChannel> =
      await MicrosoftTeamsReactionNoteSync.getWatchedChannels({
        projectId: projectId,
      });

    expect(channels).toHaveLength(1);
    expect(channels[0]!.resource.resourceType).toBe(
      WorkspaceNoteResourceType.IncidentEpisode,
    );
    expect(channels[0]!.resource.resourceId.toString()).toBe(
      newerEpisode.id!.toString(),
    );
  });

  test.each([
    [
      WorkspaceNoteResourceType.Incident,
      { currentIncidentState: { isResolvedState: false } },
    ],
    [
      WorkspaceNoteResourceType.IncidentEpisode,
      { currentIncidentState: { isResolvedState: false } },
    ],
    [
      WorkspaceNoteResourceType.Alert,
      { currentAlertState: { isResolvedState: false } },
    ],
    [
      WorkspaceNoteResourceType.AlertEpisode,
      { currentAlertState: { isResolvedState: false } },
    ],
    [
      WorkspaceNoteResourceType.ScheduledMaintenance,
      { currentScheduledMaintenanceState: { isResolvedState: false } },
    ],
  ])(
    "open %s query",
    (resourceType: WorkspaceNoteResourceType, query: JSONObject) => {
      expect(
        MicrosoftTeamsReactionNoteSync.getOpenResourceQuery(resourceType),
      ).toEqual(query);
    },
  );
});

describe("MicrosoftTeamsReactionNoteSync.syncProject / syncAllProjects", () => {
  test("one unreadable channel does not stop the others", async () => {
    const second: MicrosoftTeamsWatchedChannel = {
      ...watchedChannel(),
      channelId: "19:second@thread.tacv2",
    };
    jest
      .spyOn(MicrosoftTeamsReactionNoteSync, "getWatchedChannels")
      .mockResolvedValue([watchedChannel(), second]);

    const syncChannelSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsReactionNoteSync, "syncChannel")
      .mockRejectedValueOnce(new Error("channel deleted"))
      .mockResolvedValueOnce([]);

    await MicrosoftTeamsReactionNoteSync.syncProject({
      projectId: projectId,
      authToken: "teams-token",
    });

    expect(syncChannelSpy).toHaveBeenCalledTimes(2);
    expect(syncChannelSpy.mock.calls[1]![0].channel).toBe(second);
  });

  test("every Teams-connected project is synced; one failing does not stop the rest", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();

    const withToken: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    withToken.projectId = projectId;
    withToken.authToken = "token-1";

    const withoutToken: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    withoutToken.projectId = ObjectID.generate();

    const other: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    other.projectId = otherProjectId;
    other.authToken = "token-2";

    const findSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([withToken, withoutToken, other]);

    const syncProjectSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsReactionNoteSync, "syncProject")
      .mockRejectedValueOnce(new Error("token revoked"))
      .mockResolvedValueOnce();

    await MicrosoftTeamsReactionNoteSync.syncAllProjects();

    expect(findSpy.mock.calls[0]![0].query).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
    expect(syncProjectSpy.mock.calls).toEqual([
      [{ projectId: projectId, authToken: "token-1" }],
      [{ projectId: otherProjectId, authToken: "token-2" }],
    ]);
  });
});

describe("MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies", () => {
  test("reads the most recently active threads with replies, with the app token", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-token");

    const requests: Array<{ url: string; headers: JSONObject }> = [];
    jest.spyOn(API, "get").mockImplementation((async (options: {
      url: { toString(): string };
      headers: JSONObject;
    }) => {
      requests.push({ url: options.url.toString(), headers: options.headers });
      return new HTTPResponse(
        200,
        { value: [graphMessage({ id: "100" })] },
        {},
      );
    }) as any);

    const messages: Array<JSONObject> =
      await MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: "stored-token",
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
      });

    expect(messages).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${encodeURIComponent(
        CHANNEL_ID,
      )}/messages?$top=50&$expand=replies`,
    );
    expect(requests[0]!.headers["Authorization"]).toBe("Bearer app-token");
  });

  test.each([
    [0, 50],
    [10, 10],
    [500, 50],
    [-3, 1],
  ])("top %p is clamped to %p", async (top: number, expected: number) => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-token");
    let requestedUrl: string = "";
    jest.spyOn(API, "get").mockImplementation((async (options: {
      url: { toString(): string };
    }) => {
      requestedUrl = options.url.toString();
      return new HTTPResponse(200, {}, {});
    }) as any);

    await expect(
      MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: "t",
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
        top: top,
      }),
    ).resolves.toEqual([]);

    expect(requestedUrl).toContain(`$top=${expected}&`);
  });

  test("a Graph error is thrown, not read as an empty channel", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-token");
    jest.spyOn(API, "get").mockImplementation((async () => {
      return new HTTPErrorResponse(403, { error: "Forbidden" }, {});
    }) as any);

    await expect(
      MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: "t",
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("team and channel are required", async () => {
    await expect(
      MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: "t",
        projectId: projectId,
        teamId: "",
        channelId: CHANNEL_ID,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("MicrosoftTeamsUtil.sendTextReplyToChannelThread", () => {
  function mockProjectAuth(
    miscData: Partial<MicrosoftTeamsMiscData> | null,
    tenantId?: string,
  ): void {
    const projectAuth: WorkspaceProjectAuthToken | null = miscData
      ? ({
          workspaceProjectId: tenantId,
          miscData: miscData,
        } as unknown as WorkspaceProjectAuthToken)
      : null;

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);
  }

  function mockAdapter(): {
    refs: Array<ConversationReference>;
    activities: Array<JSONObject>;
  } {
    const refs: Array<ConversationReference> = [];
    const activities: Array<JSONObject> = [];

    jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
      continueConversationAsync: async (
        _appId: string,
        ref: ConversationReference,
        callback: (context: TurnContext) => Promise<void>,
      ): Promise<void> => {
        refs.push(ref);
        await callback({
          sendActivity: async (activity: JSONObject) => {
            activities.push(activity);
            return { id: "reply-1" };
          },
        } as unknown as TurnContext);
      },
    });

    return { refs: refs, activities: activities };
  }

  test("replies in the thread, as markdown, through the team's recorded service URL", async () => {
    mockProjectAuth(
      {
        installedTeams: {
          [TEAM_ID]: {
            id: TEAM_ID,
            graphTeamId: TEAM_ID,
            serviceUrl: "https://smba.infra.gov.teams.microsoft.us/",
          },
        },
      },
      "tenant-1",
    );
    const adapter: {
      refs: Array<ConversationReference>;
      activities: Array<JSONObject>;
    } = mockAdapter();

    await MicrosoftTeamsUtil.sendTextReplyToChannelThread({
      projectId: projectId,
      teamId: TEAM_ID,
      channelId: CHANNEL_ID,
      parentMessageId: "1700000000100",
      text: "✅ saved",
    });

    expect(adapter.refs).toHaveLength(1);
    expect(adapter.refs[0]!.conversation).toEqual({
      id: `${CHANNEL_ID};messageid=1700000000100`,
      isGroup: true,
      conversationType: "channel",
      tenantId: "tenant-1",
    });
    expect(adapter.refs[0]!.serviceUrl).toBe(
      "https://smba.infra.gov.teams.microsoft.us/",
    );
    expect(adapter.refs[0]!.channelId).toBe("msteams");
    expect(adapter.activities).toEqual([
      { type: "message", text: "✅ saved", textFormat: "markdown" },
    ]);
  });

  test("falls back to the commercial endpoint when the install was never recorded", async () => {
    mockProjectAuth({}, "tenant-1");
    const adapter: {
      refs: Array<ConversationReference>;
      activities: Array<JSONObject>;
    } = mockAdapter();

    await MicrosoftTeamsUtil.sendTextReplyToChannelThread({
      projectId: projectId,
      teamId: TEAM_ID,
      channelId: CHANNEL_ID,
      parentMessageId: "1",
      text: "x",
    });

    expect(adapter.refs[0]!.serviceUrl).toBe(
      "https://smba.trafficmanager.net/teams/",
    );
  });

  test("refuses without a Teams connection or tenant", async () => {
    mockAdapter();

    mockProjectAuth(null);
    await expect(
      MicrosoftTeamsUtil.sendTextReplyToChannelThread({
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
        parentMessageId: "1",
        text: "x",
      }),
    ).rejects.toThrow("Microsoft Teams integration not found for this project");

    jest.restoreAllMocks();
    mockAdapter();
    mockProjectAuth({});
    await expect(
      MicrosoftTeamsUtil.sendTextReplyToChannelThread({
        projectId: projectId,
        teamId: TEAM_ID,
        channelId: CHANNEL_ID,
        parentMessageId: "1",
        text: "x",
      }),
    ).rejects.toThrow("Tenant ID not found in Microsoft Teams integration");
  });
});
