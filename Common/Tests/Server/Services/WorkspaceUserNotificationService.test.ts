import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
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
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * WorkspaceUserNotificationService.sendDirectMessageToUser is the send half of
 * the Slack / Microsooft Teams notification methods: everything the on-call
 * pipeline and the settings-based notifications know about delivering a
 * workspace DM funnels through this one method. Four things about it are
 * load-bearing and pinned here:
 *
 *   1. RESOLUTION. The PROJECT's bot credentials do the sending — never the
 *      user's own token — and a project that is not connected fails with the
 *      exact actionable message the timeline will carry.
 *
 *   2. DISPATCH. Slack sends through SlackUtil with the bot token; Teams
 *      sends through the Bot Framework helper with the projectId (Teams
 *      resolves its own credentials). Crossing those up would page nobody.
 *
 *   3. THE TIMELINE CONTRACT. When a userOnCallLogTimelineId is supplied the
 *      row is flipped to Sent on success and Error (with the send error's own
 *      message) on failure — mirroring what the Notification FeatureSet does
 *      for SMS/Call/Telegram, because the on-call timeline is the one surface
 *      a responder and an operator both read.
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
  let createLog: jest.SpyInstance;
  let updateTimeline: jest.SpyInstance;

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

    createLog = jest
      .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
      .mockResolvedValue({} as never);

    updateTimeline = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
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
      const arg: {
        id: ObjectID;
        data: { status: UserNotificationStatus; statusMessage: string };
        props: { isRoot: boolean };
      } = updateTimeline.mock.calls[0][0] as {
        id: ObjectID;
        data: { status: UserNotificationStatus; statusMessage: string };
        props: { isRoot: boolean };
      };
      expect(arg.id.toString()).toBe(TIMELINE_ID.toString());
      expect(arg.data.status).toBe(UserNotificationStatus.Sent);
      expect(arg.data.statusMessage).toBe("Message sent on Slack.");
      expect(arg.props.isRoot).toBe(true);
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
      const arg: { data: { status: UserNotificationStatus } } =
        updateTimeline.mock.calls[0][0] as {
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
