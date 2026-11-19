import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import WorkspaceBase, {
  WorkspaceMessageLocation,
  WorkspaceSendMessageResponse,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspacePostedMessages, {
  WorkspaceMessageDeletion,
} from "../../../../Server/Utils/Workspace/WorkspacePostedMessages";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspacePostedMessage from "../../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

// What a workspace's deleteMessage is handed.
type DeleteMessageData = {
  authToken: string;
  projectId: ObjectID;
  location: WorkspaceMessageLocation;
  messageId: string;
};

function markdownBlock(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text };
}

/*
 * The messages a send posted, and taking them back (#9290): where each post
 * went is read off what the workspaces answered, a message OneUptime cannot
 * delete whole is kept with no id, and deleting them never throws - each
 * one it could not delete is said, with why - while Notification Logs
 * forget the text they kept of each.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const BLOCKS: Array<WorkspaceMessageBlock> = [
  markdownBlock("✨ OneUptime AI read it."),
];

function payload(
  workspaceType: WorkspaceType,
  overrides: Partial<WorkspaceMessagePayload> = {},
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType,
    messageBlocks: BLOCKS,
    channelNames: [],
    channelIds: [],
    ...overrides,
  };
}

const SLACK: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.Slack,
  channelId: "C0INC42",
  channelName: "inc-42",
  messageId: "1760713500.000100",
};
const TEAMS: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelId: "19:abc@thread.tacv2",
  channelName: "Incidents",
  teamId: "team-1",
  messageId: "1760713500123",
};
const MATTERMOST: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.Mattermost,
  channelId: "4xp9fdt77pncbef59f4k1qe83o",
  channelName: "incidents",
  messageId: "q7f8e3jy8ffuzmgyr9xwnw3b1a",
};

describe("fromSend: where a send posted", () => {
  test("one message per channel each payload went to, with the id its workspace gave the post", () => {
    const payloads: Array<WorkspaceMessagePayload> = [
      payload(WorkspaceType.Slack, { channelIds: ["C0INC42"] }),
      payload(WorkspaceType.MicrosoftTeams, { teamId: "team-1" }),
    ];
    const responses: Array<WorkspaceSendMessageResponse> = [
      {
        workspaceType: WorkspaceType.Slack,
        threads: [
          {
            channel: {
              id: "C0INC42",
              name: "inc-42",
              workspaceType: WorkspaceType.Slack,
            },
            threadId: "1760713500.000100",
          },
        ],
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [
          {
            channel: {
              id: "19:abc@thread.tacv2",
              name: "Incidents",
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: "1760713500123",
          },
        ],
      },
    ];

    expect(WorkspacePostedMessages.fromSend({ payloads, responses })).toEqual([
      SLACK,
      TEAMS,
    ]);
  });

  test("a Microsoft Teams chat is kept as a chat, and its team comes from the channel when the payload names none", () => {
    const chatId: string = `a:${"1".repeat(140)}`;

    expect(
      WorkspacePostedMessages.fromSend({
        payloads: [
          payload(WorkspaceType.MicrosoftTeams, { chatIds: [chatId] }),
        ],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [
              {
                channel: {
                  id: chatId,
                  name: "Incident chat",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "1",
              },
              {
                channel: {
                  id: "19:def@thread.tacv2",
                  name: "On-call",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                  teamId: "team-2",
                },
                threadId: "2",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelId: chatId,
        channelName: "Incident chat",
        isChat: true,
        messageId: "1",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelId: "19:def@thread.tacv2",
        channelName: "On-call",
        teamId: "team-2",
        messageId: "2",
      },
    ]);
  });

  test("a message that went out as several posts is kept with no id: only the last one's came back", () => {
    const many: Array<WorkspaceMessageBlock> = Array.from(
      { length: WorkspacePostedMessages.MAX_BLOCKS_IN_ONE_POST + 1 },
      (_value: unknown, index: number): WorkspaceMessageBlock => {
        return markdownBlock(`Part ${index}`);
      },
    );

    expect(
      WorkspacePostedMessages.fromSend({
        payloads: [payload(WorkspaceType.Slack, { messageBlocks: many })],
        responses: [
          {
            workspaceType: WorkspaceType.Slack,
            threads: [
              {
                channel: {
                  id: "C0INC42",
                  name: "inc-42",
                  workspaceType: WorkspaceType.Slack,
                },
                threadId: "1760713599.000100",
              },
            ],
          },
        ],
      }),
    ).toEqual([{ ...SLACK, messageId: "" }]);
  });

  test("an answer that is not the payload's, and a channel with no id, are left out", () => {
    expect(
      WorkspacePostedMessages.fromSend({
        payloads: [
          payload(WorkspaceType.Slack),
          payload(WorkspaceType.Mattermost),
        ],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [
              {
                channel: {
                  id: "19:abc@thread.tacv2",
                  name: "Incidents",
                  workspaceType: WorkspaceType.MicrosoftTeams,
                },
                threadId: "x",
              },
            ],
          },
          {
            workspaceType: WorkspaceType.Mattermost,
            threads: [
              {
                channel: {
                  id: "",
                  name: "incidents",
                  workspaceType: WorkspaceType.Mattermost,
                },
                threadId: "y",
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  test("nothing sent - a project blocked, a workspace not connected - posted nothing", () => {
    expect(
      WorkspacePostedMessages.fromSend({
        payloads: [payload(WorkspaceType.Slack)],
        responses: [
          {
            workspaceType: WorkspaceType.Slack,
            threads: [],
            notSentReason: "Slack is not connected to this project.",
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("deleteAll: taking messages back", () => {
  let deleteMessage: Mock<(data: DeleteMessageData) => Promise<void>>;
  let getProjectAuth: SpyInstance<
    typeof WorkspaceProjectAuthTokenService.getProjectAuth
  >;

  beforeEach(() => {
    deleteMessage = jest.fn(async (_data: DeleteMessageData): Promise<void> => {
      return undefined;
    });
    jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
      deleteMessage,
      describeError: (error: unknown): string => {
        return `refused: ${(error as Error).message}`;
      },
    } as unknown as typeof WorkspaceBase);
    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
        }): Promise<WorkspaceProjectAuthToken | null> => {
          const auth: WorkspaceProjectAuthToken =
            new WorkspaceProjectAuthToken();
          auth.workspaceType = data.workspaceType;
          auth.authToken = `token-${data.workspaceType}`;
          return auth;
        },
      );
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deletes each message where it is, as the project's bot of its workspace", async () => {
    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: PROJECT,
        messages: [SLACK, TEAMS, MATTERMOST],
      });

    expect(deletion).toEqual({
      deleted: [SLACK, TEAMS, MATTERMOST],
      notDeleted: [],
    });
    expect(deleteMessage.mock.calls).toEqual([
      [
        {
          authToken: "token-Slack",
          projectId: PROJECT,
          location: { channelId: "C0INC42" },
          messageId: "1760713500.000100",
        },
      ],
      [
        {
          authToken: "token-MicrosoftTeams",
          projectId: PROJECT,
          location: { channelId: "19:abc@thread.tacv2", teamId: "team-1" },
          messageId: "1760713500123",
        },
      ],
      [
        {
          authToken: "token-Mattermost",
          projectId: PROJECT,
          location: { channelId: "4xp9fdt77pncbef59f4k1qe83o" },
          messageId: "q7f8e3jy8ffuzmgyr9xwnw3b1a",
        },
      ],
    ]);
  });

  test("a chat is deleted as a chat", async () => {
    await WorkspacePostedMessages.deleteAll({
      projectId: PROJECT,
      messages: [{ ...TEAMS, teamId: undefined, isChat: true }],
    });

    expect(deleteMessage.mock.calls[0]![0].location).toEqual({
      channelId: "19:abc@thread.tacv2",
      isChat: true,
    });
  });

  test("reads each workspace's connection once, however many of its messages there are", async () => {
    await WorkspacePostedMessages.deleteAll({
      projectId: PROJECT,
      messages: [SLACK, { ...SLACK, messageId: "1760713600.000200" }, TEAMS],
    });

    expect(getProjectAuth).toHaveBeenCalledTimes(2);
  });

  test("a message the workspace refuses to delete is said, with why, and the rest are still deleted", async () => {
    deleteMessage.mockImplementationOnce(
      async (_data: DeleteMessageData): Promise<void> => {
        throw new Error("is_archived");
      },
    );

    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: PROJECT,
        messages: [SLACK, TEAMS],
      });

    expect(deletion).toEqual({
      deleted: [TEAMS],
      notDeleted: [{ message: SLACK, reason: "refused: is_archived" }],
    });
  });

  test("a workspace no longer connected cannot delete its messages, and says so", async () => {
    getProjectAuth.mockResolvedValue(null);

    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: PROJECT,
        messages: [SLACK],
      });

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(deletion.notDeleted).toEqual([
      {
        message: SLACK,
        reason:
          "Slack is no longer connected to this project, so OneUptime cannot delete its messages there.",
      },
    ]);
  });

  test("a connection that cannot be read is no connection: never a throw", async () => {
    getProjectAuth.mockRejectedValue(new Error("database unavailable"));
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: PROJECT,
        messages: [SLACK],
      });

    expect(deletion.notDeleted).toHaveLength(1);
  });

  test("a message with no id cannot be deleted by OneUptime, and is said, without asking the workspace", async () => {
    const deletion: WorkspaceMessageDeletion =
      await WorkspacePostedMessages.deleteAll({
        projectId: PROJECT,
        messages: [{ ...TEAMS, messageId: "" }],
      });

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(deletion.notDeleted).toEqual([
      {
        message: { ...TEAMS, messageId: "" },
        reason: WorkspacePostedMessages.NO_MESSAGE_ID_REASON,
      },
    ]);
  });
});

describe("forgetLoggedText: what Notification Logs kept of the messages", () => {
  let updateBy: SpyInstance<typeof WorkspaceNotificationLogService.updateBy>;

  beforeEach(() => {
    updateBy = jest
      .spyOn(WorkspaceNotificationLogService, "updateBy")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each message's rows say the note instead of its text, and what became of it", async () => {
    await WorkspacePostedMessages.forgetLoggedText({
      projectId: PROJECT,
      deletion: {
        deleted: [SLACK],
        notDeleted: [{ message: TEAMS, reason: "The bot was removed." }],
      },
      note: "Removed with the transcript.",
    });

    expect(updateBy).toHaveBeenCalledTimes(2);

    const first: JSONObject = updateBy.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(first["query"]).toEqual({
      projectId: PROJECT,
      workspaceType: WorkspaceType.Slack,
      channelId: "C0INC42",
      threadId: "1760713500.000100",
    });
    expect(first["data"]).toEqual({
      message: "Removed with the transcript.",
      statusMessage: "Message posted to workspace channel, then deleted.",
    });
    expect(first["props"]).toEqual({ isRoot: true, ignoreHooks: true });

    const second: JSONObject = updateBy.mock
      .calls[1]![0] as unknown as JSONObject;

    expect((second["data"] as JSONObject)["statusMessage"]).toBe(
      "Message posted to workspace channel. OneUptime could not delete it: The bot was removed.",
    );
  });

  test("a message with no id has no row to find", async () => {
    await WorkspacePostedMessages.forgetLoggedText({
      projectId: PROJECT,
      deletion: {
        deleted: [],
        notDeleted: [{ message: { ...SLACK, messageId: "" }, reason: "no id" }],
      },
      note: "Removed.",
    });

    expect(updateBy).not.toHaveBeenCalled();
  });

  test("a status too long for its column is cut to fit", async () => {
    await WorkspacePostedMessages.forgetLoggedText({
      projectId: PROJECT,
      deletion: {
        deleted: [],
        notDeleted: [{ message: SLACK, reason: "x".repeat(2000) }],
      },
      note: "Removed.",
    });

    const data: JSONObject = (
      updateBy.mock.calls[0]![0] as unknown as { data: JSONObject }
    ).data;

    expect((data["statusMessage"] as string).length).toBe(500);
  });

  test("a row that cannot be written is logged, and the others are still forgotten", async () => {
    updateBy.mockRejectedValueOnce(new Error("database unavailable"));
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    await expect(
      WorkspacePostedMessages.forgetLoggedText({
        projectId: PROJECT,
        deletion: { deleted: [SLACK, TEAMS], notDeleted: [] },
        note: "Removed.",
      }),
    ).resolves.toBeUndefined();
    expect(updateBy).toHaveBeenCalledTimes(2);
  });
});

describe("describePlaces: where messages stay, as a person finds them", () => {
  test("a Slack or Mattermost channel with its #, a Teams channel and a chat by name, each place once", () => {
    expect(
      WorkspacePostedMessages.describePlaces([
        SLACK,
        { ...SLACK, messageId: "another" },
        TEAMS,
        MATTERMOST,
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          channelId: "a:1",
          channelName: "Priya Shah",
          isChat: true,
          messageId: "1",
        },
        { ...SLACK, channelName: "#already-hashed" },
      ]),
    ).toEqual([
      "#inc-42 (Slack)",
      "Incidents (Microsoft Teams)",
      "#incidents (Mattermost)",
      "Priya Shah (Microsoft Teams)",
      "#already-hashed (Slack)",
    ]);
  });

  test("a channel with no name is named by its id", () => {
    expect(
      WorkspacePostedMessages.describePlaces([
        { ...SLACK, channelName: undefined },
      ]),
    ).toEqual(["C0INC42 (Slack)"]);
  });
});
