import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW EVERY SLACK, MICROSOFT TEAMS AND MATTERMOST DIRECT MESSAGE WENT, FOR
 * THE PLATFORM'S OPERATOR (issue #6600).
 *
 * The send half of the Slack / Teams / Mattermost notification methods runs
 * in-process (WorkspaceUserNotificationService): each message is recorded
 * once (notification.send.count and .duration), by its workspace, as sent
 * through the project's own workspace connection, and as accepted or not.
 * Each says it went to one person (notification.destination
 * direct_message, issue #6645), apart from the channel posts and incoming
 * webhooks the same workspaces carry.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

import WorkspaceUserNotificationService, {
  getDeliveryChannelOfWorkspace,
  getDeliveryProviderOfWorkspace,
} from "../../../Server/Services/WorkspaceUserNotificationService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MattermostUtil from "../../../Server/Utils/Workspace/Mattermost/Mattermost";
import logger from "../../../Server/Utils/Logger";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import OnCallTimelineRows from "../TestingUtils/OnCallTimelineRows";

const PROJECT_ID: ObjectID = new ObjectID(
  "66002222-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66002222-0000-4000-8000-000000000002",
);

function blocks(): Array<WorkspaceMessageBlock> {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "**Incident #12** Checkout API is down",
  };

  return [block];
}

let getProjectAuth: jest.SpiedFunction<
  typeof WorkspaceProjectAuthTokenService.getProjectAuth
>;
let slackSend: jest.SpiedFunction<typeof SlackUtil.sendDirectMessageToUser>;

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  getProjectAuth = jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      id: PROJECT_ID,
      authToken: "xoxb-project-bot-token",
    } as unknown as WorkspaceProjectAuthToken as never);

  slackSend = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MicrosoftTeamsUtil, "sendDirectMessageToUserAsBot")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MattermostUtil, "sendDirectMessageToUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
    .mockResolvedValue({} as never);
  // The page's timeline row, as written when the page went out.
  const timeline: OnCallTimelineRows = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a direct message", () => {
  test.each([
    [WorkspaceType.Slack, "slack"],
    [WorkspaceType.MicrosoftTeams, "microsoft_teams"],
    [WorkspaceType.Mattermost, "mattermost"],
  ])(
    "on %s, sent: a success under its workspace, through the project's own connection",
    async (workspaceType: WorkspaceType, name: string) => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: workspaceType,
        workspaceUserId: "U0123ABCD",
        messageBlocks: blocks(),
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      expect(sendCounterCalls).toEqual([
        {
          value: 1,
          attributes: {
            "notification.channel": name,
            "notification.provider": name,
            "notification.provider.config": "project",
            "notification.on_call_page": "true",
            "notification.destination": "direct_message",
            outcome: "success",
          },
        },
      ]);
      expect(sendDurationCalls).toHaveLength(1);
      expect(sendDurationCalls[0]!.attributes).toEqual(
        sendCounterCalls[0]!.attributes,
      );
    },
  );

  test("refused by Slack: a failure, and the send still throws", async () => {
    slackSend.mockRejectedValue(new Error("channel_not_found") as never);

    await expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U0123ABCD",
        messageBlocks: blocks(),
      }),
    ).rejects.toThrow("channel_not_found");

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendCounterCalls[0]!.attributes["outcome"]).toBe("failure");
    expect(sendCounterCalls[0]!.attributes["notification.on_call_page"]).toBe(
      "false",
    );
    expect(sendCounterCalls[0]!.attributes["notification.destination"]).toBe(
      "direct_message",
    );
  });

  test("a project not connected to the workspace: a failure - the page did not go out", async () => {
    getProjectAuth.mockResolvedValue(null as never);

    await expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U0123ABCD",
        messageBlocks: blocks(),
      }),
    ).rejects.toThrow();

    expect(slackSend).not.toHaveBeenCalled();
    expect(sendCounterCalls[0]!.attributes["outcome"]).toBe("failure");
    expect(sendCounterCalls[0]!.attributes["notification.destination"]).toBe(
      "direct_message",
    );
  });

  test("a log row that could not be written does not change a sent message's outcome", async () => {
    (
      WorkspaceNotificationLogService.createWorkspaceLog as unknown as jest.Mock
    ).mockRejectedValue(new Error("connection reset") as never);

    await WorkspaceUserNotificationService.sendDirectMessageToUser({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: "U0123ABCD",
      messageBlocks: blocks(),
    });

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendCounterCalls[0]!.attributes["outcome"]).toBe("success");
  });
});

describe("the workspaces the metrics know", () => {
  test("every workspace type is a channel and a provider of its own", () => {
    const channels: Array<string> = [];

    for (const workspaceType of Object.values(WorkspaceType)) {
      const channel: string | null =
        getDeliveryChannelOfWorkspace(workspaceType);
      expect(channel).not.toBeNull();
      expect(getDeliveryProviderOfWorkspace(workspaceType)).toBe(channel);
      channels.push(channel!);
    }

    expect(new Set(channels).size).toBe(Object.values(WorkspaceType).length);
  });

  test("a workspace they do not know is neither", () => {
    expect(
      getDeliveryChannelOfWorkspace("Discord" as unknown as WorkspaceType),
    ).toBeNull();
    expect(
      getDeliveryProviderOfWorkspace("Discord" as unknown as WorkspaceType),
    ).toBe("none");
  });

  test("a direct message on a workspace they do not know is not recorded, and refused as before", async () => {
    await expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: "Discord" as unknown as WorkspaceType,
        workspaceUserId: "U0123ABCD",
        messageBlocks: blocks(),
      }),
    ).rejects.toThrow("not supported");

    expect(sendCounterCalls).toEqual([]);
  });
});
