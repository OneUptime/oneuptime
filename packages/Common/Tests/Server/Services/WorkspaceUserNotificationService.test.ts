import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MattermostUtil from "../../../Server/Utils/Workspace/Mattermost/Mattermost";
import { WorkspaceDirectMessageLocation } from "../../../Server/Utils/Workspace/WorkspaceBase";
import logger from "../../../Server/Utils/Logger";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE } from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import { ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "../TestingUtils/OnCallTimelineRows";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * WorkspaceUserNotificationService.sendDirectMessageToUser is the send half of
 * the Slack / Microsoft Teams / Mattermost notification methods: everything the
 * on-call pipeline and the settings-based notifications know about delivering a
 * workspace DM funnels through this one method. Four things about it are
 * load-bearing and pinned here:
 *
 *   1. RESOLUTION. The PROJECT's bot credentials do the sending — never the
 *      user's own token — and a project that is not connected fails with the
 *      exact actionable message the timeline will carry.
 *
 *   2. DISPATCH. Slack sends through SlackUtil with the bot token; Teams
 *      sends through the Bot Framework helper with the projectId (Teams
 *      resolves its own credentials); Mattermost sends through MattermostUtil
 *      with the project's connection. Crossing those up would page nobody.
 *
 *   3. THE TIMELINE CONTRACT. When a userOnCallLogTimelineId is supplied the
 *      row is flipped to Sent on success and Error (with the send error's own
 *      message) on failure — mirroring what the Notification FeatureSet does
 *      for SMS/Call/Telegram, because the on-call timeline is the one surface
 *      a responder and an operator both read. Flipped only while it still
 *      says Sending, at the version read (OnCallNotificationStatus): the
 *      person may have acknowledged or escalated the page meanwhile, from
 *      another of its messages, and that answer stays (issue #7082). The
 *      row is held in memory (OnCallTimelineRows).
 *
 *   4. FAILURE ISOLATION. A failed WORKSPACE LOG write must never turn a
 *      delivered page into a reported failure, and a failed send must still be
 *      thrown to the caller after the log and timeline writes happen.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TIMELINE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const SLACK_USER_ID: string = "U0123ABCD";
const TEAMS_USER_ID: string = "aad-object-id-1";
const MATTERMOST_USER_ID: string = "abcdefghijklmnopqrstuvwxyz";
const BOT_TOKEN: string = "xoxb-project-bot-token";

function markdownBlocks(): Array<WorkspaceMessageBlock> {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "**incident** page body",
  };

  return [block];
}

function projectAuth(): WorkspaceProjectAuthToken {
  return {
    id: PROJECT_ID,
    authToken: BOT_TOKEN,
  } as unknown as WorkspaceProjectAuthToken;
}

describe("WorkspaceUserNotificationService.sendDirectMessageToUser", () => {
  let getProjectAuth: jest.SpyInstance;
  let slackSend: jest.SpyInstance;
  let teamsSend: jest.SpyInstance;
  let mattermostSend: jest.SpyInstance;
  let createLog: jest.SpyInstance;
  let updateTimeline: jest.SpyInstance;
  let timeline: OnCallTimelineRows;

  function timelineRow(): StoredOnCallNotification {
    return timeline.get(TIMELINE_ID)!;
  }

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth() as never);

    slackSend = jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);

    teamsSend = jest
      .spyOn(MicrosoftTeamsUtil, "sendDirectMessageToUserAsBot")
      .mockResolvedValue(undefined as never);

    mattermostSend = jest
      .spyOn(MattermostUtil, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);

    createLog = jest
      .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
      .mockResolvedValue({} as never);

    // The page's timeline row, as written when the page went out.
    timeline = new OnCallTimelineRows();
    timeline.add(TIMELINE_ID, UserNotificationStatus.Sending, {
      statusMessage: "Sending Slack direct message.",
    });
    timeline.standIn(UserOnCallLogTimelineService);
    updateTimeline =
      UserOnCallLogTimelineService.updateOneBy as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A) Credential resolution.
   * -----------------------------------------------------------------------
   */

  describe("credential resolution", () => {
    test("resolves the PROJECT auth token for the given workspace type", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(getProjectAuth).toHaveBeenCalledTimes(1);
      const arg: { projectId: ObjectID; workspaceType: WorkspaceType } =
        getProjectAuth.mock.calls[0][0] as {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
        };
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.workspaceType).toBe(WorkspaceType.Slack);
    });

    test("a project with no workspace connection throws the actionable message and sends nothing", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "This project is not connected to Slack. Please go to Project Settings and connect the account.",
      );

      expect(slackSend).not.toHaveBeenCalled();
      expect(teamsSend).not.toHaveBeenCalled();
    });

    test("a project auth row with an empty token is treated as not connected", async () => {
      getProjectAuth.mockResolvedValue({
        id: PROJECT_ID,
        authToken: undefined,
      } as unknown as WorkspaceProjectAuthToken as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: TEAMS_USER_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "This project is not connected to Microsoft Teams. Please go to Project Settings and connect the account.",
      );

      expect(teamsSend).not.toHaveBeenCalled();
    });

    test("an empty workspaceUserId throws the user-side actionable message before any lookup", async () => {
      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: "",
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "This account is not connected to Slack. Please go to User Settings and connect the account.",
      );

      expect(getProjectAuth).not.toHaveBeenCalled();
      expect(slackSend).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) Per-platform dispatch.
   * -----------------------------------------------------------------------
   */

  describe("per-platform dispatch", () => {
    test("Slack goes through SlackUtil with the PROJECT bot token and the member id", async () => {
      const blocks: Array<WorkspaceMessageBlock> = markdownBlocks();

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: blocks,
      });

      expect(slackSend).toHaveBeenCalledTimes(1);
      const arg: {
        authToken: string;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      } = slackSend.mock.calls[0][0] as {
        authToken: string;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      };
      expect(arg.authToken).toBe(BOT_TOKEN);
      expect(arg.workspaceUserId).toBe(SLACK_USER_ID);
      expect(arg.messageBlocks).toBe(blocks);

      expect(teamsSend).not.toHaveBeenCalled();
    });

    test("Microsoft Teams goes through the Bot Framework helper with the projectId, not a token", async () => {
      const blocks: Array<WorkspaceMessageBlock> = markdownBlocks();

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: TEAMS_USER_ID,
        messageBlocks: blocks,
      });

      expect(teamsSend).toHaveBeenCalledTimes(1);
      const arg: {
        projectId: ObjectID;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      } = teamsSend.mock.calls[0][0] as {
        projectId: ObjectID;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      };
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.workspaceUserId).toBe(TEAMS_USER_ID);
      expect(arg.messageBlocks).toBe(blocks);

      expect(slackSend).not.toHaveBeenCalled();
    });

    test("Mattermost goes through MattermostUtil with the project's connection and the account id", async () => {
      const blocks: Array<WorkspaceMessageBlock> = markdownBlocks();

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_USER_ID,
        messageBlocks: blocks,
        notificationText: "🚨 New incident assigned to you: INC-8",
      });

      expect(mattermostSend).toHaveBeenCalledTimes(1);
      const arg: {
        authToken: string;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      } = mattermostSend.mock.calls[0][0] as {
        authToken: string;
        workspaceUserId: string;
        messageBlocks: Array<WorkspaceMessageBlock>;
      };
      expect(arg.authToken).toBe(BOT_TOKEN);
      expect(arg.workspaceUserId).toBe(MATTERMOST_USER_ID);
      expect(arg.messageBlocks).toBe(blocks);

      expect(slackSend).not.toHaveBeenCalled();
      expect(teamsSend).not.toHaveBeenCalled();

      const projectAuthArg: { workspaceType: WorkspaceType } = getProjectAuth
        .mock.calls[0][0] as { workspaceType: WorkspaceType };
      expect(projectAuthArg.workspaceType).toBe(WorkspaceType.Mattermost);
    });

    test("a project not connected to Mattermost throws the actionable message and sends nothing", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Mattermost,
          workspaceUserId: MATTERMOST_USER_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "This project is not connected to Mattermost. Please go to Project Settings and connect the account.",
      );

      expect(mattermostSend).not.toHaveBeenCalled();
    });

    test("a Mattermost page flips its timeline row to Sent, in Mattermost's name", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_USER_ID,
        messageBlocks: markdownBlocks(),
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      const arg: {
        data: { status: UserNotificationStatus; statusMessage: string };
      } = updateTimeline.mock.calls[0][0] as {
        data: { status: UserNotificationStatus; statusMessage: string };
      };
      expect(arg.data.status).toBe(UserNotificationStatus.Sent);
      expect(arg.data.statusMessage).toBe("Message sent on Mattermost.");
    });

    test("a refusal from Mattermost lands on the timeline row and is thrown to the caller", async () => {
      mattermostSend.mockRejectedValue(
        new Error("Mattermost refused the direct message.") as never,
      );

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Mattermost,
          workspaceUserId: MATTERMOST_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow("Mattermost refused the direct message.");

      const arg: {
        data: { status: UserNotificationStatus; statusMessage: string };
      } = updateTimeline.mock.calls[0][0] as {
        data: { status: UserNotificationStatus; statusMessage: string };
      };
      expect(arg.data.status).toBe(UserNotificationStatus.Error);
      expect(arg.data.statusMessage).toBe(
        "Mattermost refused the direct message.",
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B2) What the notification of the direct message says.
   * -----------------------------------------------------------------------
   */

  describe("the notification line", () => {
    test("a given line goes to Slack as its text and to Teams as the card's summary", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
        notificationText: "🚨 New incident assigned to you: INC-8",
      });

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: TEAMS_USER_ID,
        messageBlocks: markdownBlocks(),
        notificationText: "🚨 New incident assigned to you: INC-8",
      });

      expect((slackSend.mock.calls[0][0] as { text?: string }).text).toBe(
        "🚨 New incident assigned to you: INC-8",
      );
      expect((teamsSend.mock.calls[0][0] as { text?: string }).text).toBe(
        "🚨 New incident assigned to you: INC-8",
      );
    });

    test("without one, the start of the message: a direct message always says something", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
      });

      expect((slackSend.mock.calls[0][0] as { text?: string }).text).toBe(
        "incident page body",
      );
    });

    test("a message with no words carries no line", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: TEAMS_USER_ID,
        messageBlocks: [{ _type: "WorkspacePayloadDivider" }],
      });

      expect(teamsSend.mock.calls[0][0]).not.toHaveProperty("text");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The on-call timeline contract.
   * -----------------------------------------------------------------------
   */

  describe("the on-call timeline contract", () => {
    test("a successful send flips the timeline row to Sent, as root", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      expect(updateTimeline).toHaveBeenCalledTimes(1);
      expect(updateTimeline).toHaveBeenCalledWith({
        query: {
          _id: TIMELINE_ID.toString(),
          status: UserNotificationStatus.Sending,
          version: 1,
        },
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage: "Message sent on Slack.",
        },
        props: { isRoot: true },
      });
      expect(timelineRow()).toMatchObject({
        status: UserNotificationStatus.Sent,
        statusMessage: "Message sent on Slack.",
      });
    });

    test.each([
      [
        UserNotificationStatus.Acknowledged,
        ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      ],
      [
        UserNotificationStatus.PassedOn,
        ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
      ],
    ])(
      "answered meanwhile from another of the page's messages (%s): the answer stays, sent or not",
      async (status: UserNotificationStatus, statusMessage: string) => {
        timelineRow().status = status;
        timelineRow().statusMessage = statusMessage;

        await WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        });

        slackSend.mockRejectedValue(new Error("channel_not_found") as never);

        await expect(
          WorkspaceUserNotificationService.sendDirectMessageToUser({
            projectId: PROJECT_ID,
            workspaceType: WorkspaceType.Slack,
            workspaceUserId: SLACK_USER_ID,
            messageBlocks: markdownBlocks(),
            userOnCallLogTimelineId: TIMELINE_ID,
          }),
        ).rejects.toThrow("channel_not_found");

        expect(timelineRow()).toMatchObject({
          status: status,
          statusMessage: statusMessage,
        });
        expect(timeline.writes).toEqual([]);
      },
    );

    test("acknowledged while the message was on its way: Sent is not written over it", async () => {
      // Teams takes its time; the person acknowledges from the email meanwhile.
      teamsSend.mockImplementation((async (): Promise<void> => {
        timelineRow().status = UserNotificationStatus.Acknowledged;
        timelineRow().statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
        timelineRow().version++;
      }) as never);

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: TEAMS_USER_ID,
        messageBlocks: markdownBlocks(),
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      expect(timelineRow()).toMatchObject({
        status: UserNotificationStatus.Acknowledged,
        statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      });
      expect(timeline.writes).toEqual([]);
    });

    test("acknowledged between the timeline's read and its write: the acknowledgement stays", async () => {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.status = UserNotificationStatus.Acknowledged;
        row.statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
      });

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_USER_ID,
        messageBlocks: markdownBlocks(),
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      expect(timelineRow().status).toBe(UserNotificationStatus.Acknowledged);
      expect(timeline.writes).toEqual([]);
    });

    test("an error with no words of its own still says what failed", async () => {
      slackSend.mockRejectedValue(new Error("") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow();

      expect(timelineRow()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: "Failed to send Slack direct message.",
      });
    });

    test("a failed send flips the timeline row to Error carrying the send error's own message", async () => {
      slackSend.mockRejectedValue(new Error("channel_not_found") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow("channel_not_found");

      const arg: {
        data: { status: UserNotificationStatus; statusMessage: string };
      } = updateTimeline.mock.calls[0][0] as {
        data: { status: UserNotificationStatus; statusMessage: string };
      };
      expect(arg.data.status).toBe(UserNotificationStatus.Error);
      expect(arg.data.statusMessage).toBe("channel_not_found");
    });

    test("a missing-connection failure also lands on the timeline, with the actionable message", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow(BadDataException);

      const arg: {
        data: { status: UserNotificationStatus; statusMessage: string };
      } = updateTimeline.mock.calls[0][0] as {
        data: { status: UserNotificationStatus; statusMessage: string };
      };
      expect(arg.data.status).toBe(UserNotificationStatus.Error);
      expect(arg.data.statusMessage).toContain(
        "This project is not connected to Slack",
      );
    });

    test("no timeline id means no timeline write - the settings path has no row to flip", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(updateTimeline).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) The workspace notification log.
   * -----------------------------------------------------------------------
   */

  describe("the workspace notification log", () => {
    test("a successful send writes one Success SendMessage row carrying the context ids", async () => {
      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
        messageSummary: "On-call notification: incident created.",
        userId: USER_ID,
        incidentId: INCIDENT_ID,
      });

      expect(createLog).toHaveBeenCalledTimes(1);
      const logData: {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        actionType: WorkspaceNotificationActionType;
        status: WorkspaceNotificationStatus;
        message: string;
        userId: ObjectID;
        incidentId: ObjectID;
      } = createLog.mock.calls[0][0] as {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        actionType: WorkspaceNotificationActionType;
        status: WorkspaceNotificationStatus;
        message: string;
        userId: ObjectID;
        incidentId: ObjectID;
      };
      expect(logData.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(logData.workspaceType).toBe(WorkspaceType.Slack);
      expect(logData.actionType).toBe(
        WorkspaceNotificationActionType.SendMessage,
      );
      expect(logData.status).toBe(WorkspaceNotificationStatus.Success);
      expect(logData.message).toBe("On-call notification: incident created.");
      expect(logData.userId.toString()).toBe(USER_ID.toString());
      expect(logData.incidentId.toString()).toBe(INCIDENT_ID.toString());
    });

    test("a failed send writes one Error row whose statusMessage is the send error", async () => {
      teamsSend.mockRejectedValue(new Error("app not installed") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: TEAMS_USER_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow("app not installed");

      const logData: {
        status: WorkspaceNotificationStatus;
        statusMessage: string;
      } = createLog.mock.calls[0][0] as {
        status: WorkspaceNotificationStatus;
        statusMessage: string;
      };
      expect(logData.status).toBe(WorkspaceNotificationStatus.Error);
      expect(logData.statusMessage).toBe("app not installed");
    });

    /*
     * The isolation property: the log is observability, not delivery. A log
     * write that raises must neither fail a delivered page nor mask the real
     * error of a failed one.
     */
    test("a failed LOG write does not fail a delivered send", async () => {
      createLog.mockRejectedValue(new Error("log table gone") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).resolves.toBeUndefined();

      // The timeline still gets its Sent flip despite the log failure.
      const arg: { data: { status: UserNotificationStatus } } = updateTimeline
        .mock.calls[0][0] as {
        data: { status: UserNotificationStatus };
      };
      expect(arg.data.status).toBe(UserNotificationStatus.Sent);
    });

    test("a failed LOG write does not mask a failed send's own error", async () => {
      slackSend.mockRejectedValue(new Error("real send failure") as never);
      createLog.mockRejectedValue(new Error("log table gone") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow("real send failure");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) Rethrow semantics.
   * -----------------------------------------------------------------------
   */

  describe("rethrow semantics", () => {
    test("the send error is rethrown AFTER the log and timeline writes have happened", async () => {
      slackSend.mockRejectedValue(new Error("slack 500") as never);

      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: SLACK_USER_ID,
          messageBlocks: markdownBlocks(),
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).rejects.toThrow("slack 500");

      expect(createLog).toHaveBeenCalledTimes(1);
      expect(updateTimeline).toHaveBeenCalledTimes(1);
    });

    test("an unsupported workspace type is refused without sending anywhere", async () => {
      await expect(
        WorkspaceUserNotificationService.sendDirectMessageToUser({
          projectId: PROJECT_ID,
          workspaceType: "Discord" as unknown as WorkspaceType,
          workspaceUserId: "someone",
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(BadDataException);

      expect(slackSend).not.toHaveBeenCalled();
      expect(teamsSend).not.toHaveBeenCalled();
    });
  });
});

/*
 * WHERE A DIRECT MESSAGE LANDED (#6317). Once a message is sent, whoever
 * sent it can be told where it is - the direct message, the id the chat
 * gave it, Teams' service, the workspace the project's connection sent it
 * through - to keep it, and edit it later: a public note's approval
 * message is replaced once the note is decided. Keeping it never fails, or
 * changes, the send.
 */
describe("WorkspaceUserNotificationService.sendDirectMessageToUser - where the message landed", () => {
  const SLACK_LANDED: { channelId: string; messageId: string } = {
    channelId: "D0DIRECT",
    messageId: "1760000000.000100",
  };
  const TEAMS_LANDED: {
    channelId: string;
    messageId: string;
    serviceUrl: string;
  } = {
    channelId: "a:1personal-chat-the-bot-opened",
    messageId: "1:activity-1",
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  };
  const MATTERMOST_LANDED: { channelId: string; messageId: string } = {
    channelId: "d".repeat(26),
    messageId: "p".repeat(26),
  };

  let createLog: jest.SpyInstance;
  let updateTimeline: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  function connected(workspaceProjectId: string | undefined): void {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: PROJECT_ID,
        authToken: BOT_TOKEN,
        workspaceProjectId: workspaceProjectId,
      } as unknown as WorkspaceProjectAuthToken as never);
  }

  beforeEach(() => {
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    /*
     * The project may send (BlockedProjectNotifications.getSilencedReason):
     * neither blocked nor a sample project (#6808).
     */
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
    connected("T0TEAM");
    jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue(SLACK_LANDED as never);
    jest
      .spyOn(MicrosoftTeamsUtil, "sendDirectMessageToUserAsBot")
      .mockResolvedValue(TEAMS_LANDED as never);
    jest
      .spyOn(MattermostUtil, "sendDirectMessageToUser")
      .mockResolvedValue(MATTERMOST_LANDED as never);
    createLog = jest
      .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
      .mockResolvedValue({} as never);
    const timeline: OnCallTimelineRows = new OnCallTimelineRows();
    timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
    timeline.standIn(UserOnCallLogTimelineService);
    updateTimeline =
      UserOnCallLogTimelineService.updateOneBy as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [WorkspaceType.Slack, SLACK_USER_ID, "T0TEAM", SLACK_LANDED],
    [WorkspaceType.MicrosoftTeams, TEAMS_USER_ID, "tenant-xyz", TEAMS_LANDED],
    [
      WorkspaceType.Mattermost,
      MATTERMOST_USER_ID,
      "t".repeat(26),
      MATTERMOST_LANDED,
    ],
  ] as Array<[WorkspaceType, string, string, WorkspaceDirectMessageLocation]>)(
    "%s: told once, with where it landed and the workspace it was sent through",
    async (
      workspaceType: WorkspaceType,
      workspaceUserId: string,
      workspaceProjectId: string,
      landed: WorkspaceDirectMessageLocation,
    ) => {
      connected(workspaceProjectId);
      const onSent: jest.Mock = jest.fn(async (): Promise<void> => {
        return undefined;
      });

      await WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: workspaceType,
        workspaceUserId: workspaceUserId,
        messageBlocks: markdownBlocks(),
        onSent: onSent as never,
      });

      expect(onSent).toHaveBeenCalledTimes(1);
      expect(onSent.mock.calls[0]![0]).toEqual({
        ...landed,
        workspaceType: workspaceType,
        workspaceProjectId: workspaceProjectId,
      });
    },
  );

  test("a send that failed tells nobody, and its error is thrown as before", async () => {
    jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockRejectedValue(new Error("channel_not_found") as never);
    const onSent: jest.Mock = jest.fn();

    await expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_USER_ID,
        messageBlocks: markdownBlocks(),
        onSent: onSent as never,
      }),
    ).rejects.toThrow("channel_not_found");

    expect(onSent).not.toHaveBeenCalled();
  });

  test("a chat that did not say where the message landed tells nobody", async () => {
    jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue(null as never);
    const onSent: jest.Mock = jest.fn();

    await WorkspaceUserNotificationService.sendDirectMessageToUser({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: SLACK_USER_ID,
      messageBlocks: markdownBlocks(),
      onSent: onSent as never,
    });

    expect(onSent).not.toHaveBeenCalled();
  });

  test("a connection that names no workspace tells nobody: the message could not be held to its workspace", async () => {
    connected(undefined);
    const onSent: jest.Mock = jest.fn();

    await WorkspaceUserNotificationService.sendDirectMessageToUser({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: SLACK_USER_ID,
      messageBlocks: markdownBlocks(),
      onSent: onSent as never,
    });

    expect(onSent).not.toHaveBeenCalled();
  });

  test("a failure to keep it is logged, and the send stands: logged as sent, its timeline row Sent, nothing thrown", async () => {
    const onSent: jest.Mock = jest.fn(async (): Promise<void> => {
      throw new Error("The table is not there.");
    });

    await WorkspaceUserNotificationService.sendDirectMessageToUser({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: SLACK_USER_ID,
      messageBlocks: markdownBlocks(),
      userOnCallLogTimelineId: TIMELINE_ID,
      onSent: onSent as never,
    });

    expect(onSent).toHaveBeenCalledTimes(1);
    expect(
      (createLog.mock.calls[0]![0] as { status: WorkspaceNotificationStatus })
        .status,
    ).toBe(WorkspaceNotificationStatus.Success);
    expect(
      (
        updateTimeline.mock.calls[0]![0] as {
          data: { status: UserNotificationStatus };
        }
      ).data.status,
    ).toBe(UserNotificationStatus.Sent);
    expect(
      errorLog.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes(
          "OneUptime could not keep where it landed",
        );
      }),
    ).toBe(true);
  });

  test("without anybody to tell, a send is as it always was", async () => {
    await WorkspaceUserNotificationService.sendDirectMessageToUser({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: TEAMS_USER_ID,
      messageBlocks: markdownBlocks(),
    });

    expect(createLog).toHaveBeenCalledTimes(1);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
