import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentFeedService, {
  IncidentFeedItemPosted,
} from "../../../Server/Services/IncidentFeedService";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import FeedWorkspaceNotificationUtil from "../../../Server/Utils/Feed/FeedWorkspaceNotification";
import logger from "../../../Server/Utils/Logger";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import { Indigo500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspacePostedMessage from "../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHERE A FEED ENTRY WENT, FOR AN ENTRY ONEUPTIME MAY TAKE BACK (#9290).
 *
 * What OneUptime AI read in a call's transcript is posted as an incident
 * feed item, and from there to the incident's channels. Removing the
 * transcript takes it back, so the post says where it went: the send tells
 * each channel and chat it posted in, with the id the workspace gave the
 * post (onPosted), and postIncidentFeedItem answers the item with them.
 * Every other feed entry is posted exactly as before.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const FEED: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ENTRY: string = "✨ OneUptime AI read the transcript of the **Zoom meeting**.";

const SLACK_POST: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.Slack,
  channelId: "C0INC42",
  channelName: "inc-42",
  messageId: "C0INC42-post",
};

function destinationOf(workspaceType: WorkspaceType): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType,
    messageBlocks: [],
    channelNames: [],
    channelIds: workspaceType === WorkspaceType.Slack ? ["C0INC42"] : [],
  };
}

let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;

beforeEach(() => {
  jest
    .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
    .mockResolvedValue(true);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "createChannelsForRulesThatNowMatch",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMessageDestinationsWanting")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<Array<WorkspaceMessagePayload>> => {
      return data.workspaceType === WorkspaceType.Slack
        ? [destinationOf(data.workspaceType)]
        : [];
    }) as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);
  jest
    .spyOn(WorkspaceUtil, "getMessageBlocksByMarkdown")
    .mockImplementation((async (): Promise<
      Array<MessageBlocksByWorkspaceType>
    > => {
      return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
        (workspaceType: WorkspaceType): MessageBlocksByWorkspaceType => {
          return {
            workspaceType,
            messageBlocks: [{ _type: "WorkspacePayloadMarkdown", text: ENTRY }],
          };
        },
      );
    }) as never);
  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      return data.messagePayloadsByWorkspace.map(
        (payload: WorkspaceMessagePayload): WorkspaceSendMessageResponse => {
          return {
            workspaceType: payload.workspaceType,
            threads: payload.channelIds.map((channelId: string) => {
              return {
                channel: {
                  id: channelId,
                  name: "inc-42",
                  workspaceType: payload.workspaceType,
                },
                threadId: `${channelId}-post`,
              };
            }),
          };
        },
      );
    }) as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the send tells where it posted", () => {
  test("each channel it posted in, with the post's id, once the posts are made", async () => {
    const told: Array<Array<WorkspacePostedMessage>> = [];

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT,
      notificationFor: { incidentId: INCIDENT },
      feedInfoInMarkdown: ENTRY,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        onPosted: (messages: Array<WorkspacePostedMessage>): void => {
          told.push(messages);
        },
      },
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(told).toEqual([[SLACK_POST]]);
  });

  test("a post that was made is told even when logging it fails", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
      .mockRejectedValue(new Error("database unavailable"));
    const told: Array<Array<WorkspacePostedMessage>> = [];

    await expect(
      WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
        projectId: PROJECT,
        notificationFor: { incidentId: INCIDENT },
        feedInfoInMarkdown: ENTRY,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          onPosted: (messages: Array<WorkspacePostedMessage>): void => {
            told.push(messages);
          },
        },
      }),
    ).rejects.toThrow("database unavailable");

    expect(told).toEqual([[SLACK_POST]]);
  });

  test("a project with no workspace connected posts nothing, and tells nothing", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
      .mockResolvedValue(false);
    const onPosted: jest.Mock<(messages: Array<WorkspacePostedMessage>) => void> =
      jest.fn();

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT,
      notificationFor: { incidentId: INCIDENT },
      feedInfoInMarkdown: ENTRY,
      workspaceNotification: { sendWorkspaceNotification: true, onPosted },
    });

    expect(onPosted).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a feed entry's workspace options hand the listener on, and only when there is one", () => {
    const onPosted: () => void = (): void => {
      return undefined;
    };

    expect(
      FeedWorkspaceNotificationUtil.toWorkspaceNotification({
        workspaceNotification: { sendWorkspaceNotification: true, onPosted },
      }).onPosted,
    ).toBe(onPosted);
    expect(
      FeedWorkspaceNotificationUtil.toWorkspaceNotification({
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    ).not.toHaveProperty("onPosted");
  });
});

describe("IncidentFeedService.postIncidentFeedItem", () => {
  let create: SpyInstance<typeof IncidentFeedService.create>;

  beforeEach(() => {
    create = jest
      .spyOn(IncidentFeedService, "create")
      .mockImplementation((async (data: {
        data: IncidentFeed;
      }): Promise<IncidentFeed> => {
        const created: IncidentFeed = data.data;
        created.id = FEED;
        return created;
      }) as never);
  });

  test("answers the item it created and each message it went out as", async () => {
    const posted: IncidentFeedItemPosted | null =
      await IncidentFeedService.postIncidentFeedItem({
        incidentId: INCIDENT,
        projectId: PROJECT,
        incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
        displayColor: Indigo500,
        feedInfoInMarkdown: ENTRY,
        workspaceNotification: { sendWorkspaceNotification: true },
      });

    expect(posted).toEqual({ feedId: FEED, messages: [SLACK_POST] });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("an item kept to the feed went nowhere else", async () => {
    const posted: IncidentFeedItemPosted | null =
      await IncidentFeedService.postIncidentFeedItem({
        incidentId: INCIDENT,
        projectId: PROJECT,
        incidentFeedEventType: IncidentFeedEventType.VideoCallTranscriptRemoved,
        feedInfoInMarkdown: "🗑️ removed the transcript.",
      });

    expect(posted).toEqual({ feedId: FEED, messages: [] });
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("an item that could not be created is null: it never throws", async () => {
    create.mockRejectedValue(new Error("database unavailable"));

    await expect(
      IncidentFeedService.postIncidentFeedItem({
        incidentId: INCIDENT,
        projectId: PROJECT,
        incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
        feedInfoInMarkdown: ENTRY,
        workspaceNotification: { sendWorkspaceNotification: true },
      }),
    ).resolves.toBeNull();
  });

  test("the caller's own listener is told too", async () => {
    const told: Array<Array<WorkspacePostedMessage>> = [];

    await IncidentFeedService.postIncidentFeedItem({
      incidentId: INCIDENT,
      projectId: PROJECT,
      incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
      feedInfoInMarkdown: ENTRY,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        onPosted: (messages: Array<WorkspacePostedMessage>): void => {
          told.push(messages);
        },
      },
    });

    expect(told).toEqual([[SLACK_POST]]);
  });

  test("createIncidentFeedItem posts every other entry as it always has: no listener is added", async () => {
    const send: SpyInstance<
      typeof WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification
    > = jest
      .spyOn(WorkspaceNotificationRuleService, "sendWorkspaceMarkdownNotification")
      .mockResolvedValue(undefined);

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT,
      projectId: PROJECT,
      incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
      feedInfoInMarkdown: "✏️ Updated Incident INC-42.",
      workspaceNotification: { sendWorkspaceNotification: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (
        send.mock.calls[0]![0] as unknown as {
          workspaceNotification: Record<string, unknown>;
        }
      ).workspaceNotification,
    ).not.toHaveProperty("onPosted");
  });
});
