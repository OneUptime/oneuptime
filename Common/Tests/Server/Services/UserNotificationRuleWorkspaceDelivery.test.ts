import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import ShortLinkService from "../../../Server/Services/ShortLinkService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import logger from "../../../Server/Utils/Logger";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ShortLink from "../../../Models/DatabaseModels/ShortLink";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The Slack / Microsoft Teams halves of deliverNotificationForRule, driven
 * through the public executeNotificationRuleItem entrypoint exactly like the
 * older channels' characterisation suite. What is pinned:
 *
 *   1. THE VERIFICATION GATE. A verified method with an address delivers; an
 *      unverified one writes exactly one "not verified" Error row and never
 *      reaches the sender; a verified relation whose address column was lost
 *      does neither (the same silent-skip every channel has).
 *
 *   2. THE TIMELINE ROW. Written BEFORE the send (the message embeds its id
 *      via the acknowledge link), stamped with the right method FK column,
 *      status Sending, and "Sending Slack message." / "Sending Microsoft
 *      Teams message." as its message.
 *
 *   3. THE HANDOFF. The sender is handed the workspace type, the stored
 *      workspace user id, the timeline row id (so it can flip Sent/Error
 *      itself), and the correlation ids of whatever fired.
 *
 *   4. FIRE-AND-FORGET. A sender rejection is caught and lands on the
 *      timeline row as Error; it never rejects the execution.
 *
 *   5. THE EVENT MAP. All four event types deliver on both channels, and the
 *      blocks handed over are the event's own generator output (markdown with
 *      the acknowledge short-link inside).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LOG_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const INCIDENT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const ALERT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const METHOD_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const POLICY_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ESCALATION_RULE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const TEAM_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);

const SLACK_USER_ID: string = "U0123ABCD";
const TEAMS_USER_ID: string = "entra-object-id-1";
const ACK_SHORT_URL: string = "https://oneuptime.example.com/l/abc123";

type ExecuteOptions = Parameters<
  typeof UserNotificationRuleService.executeNotificationRuleItem
>[1];

interface TimelineRow {
  status: UserNotificationStatus | undefined;
  statusMessage: string | undefined;
  userSlackId: ObjectID | undefined;
  userMicrosoftTeamsId: ObjectID | undefined;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
    .then((): Promise<void> => {
      return Promise.resolve();
    })
    .then((): Promise<void> => {
      return Promise.resolve();
    });
}

function executeOptions(
  overrides: Partial<ExecuteOptions> = {},
): ExecuteOptions {
  return {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    triggeredByIncidentId: INCIDENT_ID,
    onCallPolicyId: POLICY_ID,
    onCallPolicyEscalationRuleId: ESCALATION_RULE_ID,
    userBelongsToTeamId: TEAM_ID,
    onCallScheduleId: SCHEDULE_ID,
    userNotificationLogId: LOG_ID,
    ...overrides,
  } as ExecuteOptions;
}

function ruleItem(channels: JSONObject = {}): UserNotificationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    userId: USER_ID,
    ...channels,
  } as unknown as UserNotificationRule;
}

function verifiedSlack(): JSONObject {
  return {
    userSlack: {
      id: METHOD_ID,
      slackUserId: SLACK_USER_ID,
      slackUserName: "alice",
      isVerified: true,
    },
  } as unknown as JSONObject;
}

function verifiedTeams(): JSONObject {
  return {
    userMicrosoftTeams: {
      id: METHOD_ID,
      microsoftTeamsUserId: TEAMS_USER_ID,
      microsoftTeamsUserName: "Alice Example",
      isVerified: true,
    },
  } as unknown as JSONObject;
}

describe("deliverNotificationForRule - Slack and Microsoft Teams", () => {
  let findRule: jest.SpyInstance;
  let sendDm: jest.SpyInstance;
  let timelineCreate: jest.SpyInstance;
  let timelineUpdate: jest.SpyInstance;
  let timelineRows: Array<TimelineRow>;

  beforeEach(() => {
    timelineRows = [];

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(UserOnCallLogService, "claimNotificationRuleExecution")
      .mockResolvedValue(true as never);

    findRule = jest
      .spyOn(UserNotificationRuleService, "findOneById")
      .mockResolvedValue(ruleItem(verifiedSlack()) as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      title: "Checkout is down",
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
    } as unknown as Incident as never);

    jest.spyOn(AlertService, "findOneById").mockResolvedValue({
      id: ALERT_ID,
      projectId: PROJECT_ID,
      title: "Disk almost full",
      alertNumber: 7,
      alertNumberWithPrefix: "ALR-7",
    } as unknown as Alert as never);

    jest.spyOn(AlertEpisodeService, "findOneById").mockResolvedValue({
      id: ALERT_EPISODE_ID,
      projectId: PROJECT_ID,
      title: "Flapping disk alerts",
      episodeNumber: 3,
      episodeNumberWithPrefix: "AEP-3",
    } as unknown as AlertEpisode as never);

    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
      id: INCIDENT_EPISODE_ID,
      projectId: PROJECT_ID,
      title: "Checkout instability",
      episodeNumber: 9,
      episodeNumberWithPrefix: "IEP-9",
    } as unknown as IncidentEpisode as never);

    /*
     * The dashboard-link and short-link plumbing the block generators sit on.
     * Stubbing at this level (rather than stubbing the generators) keeps the
     * real generator code in the loop, so the assertions below are about what
     * an actual page carries.
     */
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.example.com") as never);
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS as never);
    jest
      .spyOn(ShortLinkService, "saveShortLinkFor")
      .mockResolvedValue({} as ShortLink as never);
    jest
      .spyOn(ShortLinkService, "getShortenedUrl")
      .mockResolvedValue(URL.fromString(ACK_SHORT_URL) as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.example.com/dashboard/incident",
        ) as never,
      );
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.example.com/dashboard/alert",
        ) as never,
      );
    jest
      .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.example.com/dashboard/alert-episode",
        ) as never,
      );
    jest
      .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.example.com/dashboard/incident-episode",
        ) as never,
      );

    sendDm = jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never);

    timelineCreate = jest.spyOn(UserOnCallLogTimelineService, "create");
    timelineCreate.mockImplementation(
      (createByArg: unknown): Promise<UserOnCallLogTimeline> => {
        const data: UserOnCallLogTimeline = (
          createByArg as { data: UserOnCallLogTimeline }
        ).data;

        timelineRows.push({
          status: data.status,
          statusMessage: data.statusMessage,
          userSlackId: data.userSlackId,
          userMicrosoftTeamsId: data.userMicrosoftTeamsId,
        });

        return Promise.resolve({
          id: TIMELINE_ID,
        } as unknown as UserOnCallLogTimeline);
      },
    );

    timelineUpdate = jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function execute(overrides: Partial<ExecuteOptions> = {}): Promise<void> {
    return UserNotificationRuleService.executeNotificationRuleItem(
      RULE_ID,
      executeOptions(overrides),
    );
  }

  interface CapturedSendArg {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceUserId: string;
    messageBlocks: Array<WorkspaceMessageBlock>;
    userId: ObjectID;
    userOnCallLogTimelineId: ObjectID;
    incidentId?: ObjectID;
    alertId?: ObjectID;
    alertEpisodeId?: ObjectID;
    incidentEpisodeId?: ObjectID;
    onCallPolicyId?: ObjectID;
    onCallPolicyEscalationRuleId?: ObjectID;
    teamId?: ObjectID;
    onCallScheduleId?: ObjectID;
  }

  function sendArg(): CapturedSendArg {
    return sendDm.mock.calls[0][0] as CapturedSendArg;
  }

  function markdownText(): string {
    const blocks: Array<WorkspaceMessageBlock> = sendArg().messageBlocks;
    return (blocks[0] as WorkspacePayloadMarkdown).text;
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The Slack happy path, incident created.
   * -----------------------------------------------------------------------
   */

  describe("a verified Slack method on an IncidentCreated page", () => {
    test("creates the timeline row FIRST (Sending, stamped with userSlackId), then sends", async () => {
      await execute();

      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Sending);
      expect(timelineRows[0]?.statusMessage).toBe("Sending Slack message.");
      expect(timelineRows[0]?.userSlackId?.toString()).toBe(
        METHOD_ID.toString(),
      );

      expect(timelineCreate.mock.invocationCallOrder[0] as number).toBeLessThan(
        sendDm.mock.invocationCallOrder[0] as number,
      );
    });

    test("hands the sender the Slack workspace type, stored member id, and the timeline id", async () => {
      await execute();

      expect(sendDm).toHaveBeenCalledTimes(1);
      const arg: CapturedSendArg = sendArg();
      expect(arg.workspaceType).toBe(WorkspaceType.Slack);
      expect(arg.workspaceUserId).toBe(SLACK_USER_ID);
      expect(arg.userOnCallLogTimelineId.toString()).toBe(
        TIMELINE_ID.toString(),
      );
      expect(arg.userId.toString()).toBe(USER_ID.toString());
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
    });

    test("forwards every on-call correlation id the send should be attributed to", async () => {
      await execute();

      const arg: CapturedSendArg = sendArg();
      expect(arg.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(arg.onCallPolicyId?.toString()).toBe(POLICY_ID.toString());
      expect(arg.onCallPolicyEscalationRuleId?.toString()).toBe(
        ESCALATION_RULE_ID.toString(),
      );
      expect(arg.teamId?.toString()).toBe(TEAM_ID.toString());
      expect(arg.onCallScheduleId?.toString()).toBe(SCHEDULE_ID.toString());
    });

    test("the message is markdown carrying the incident identifier and the acknowledge short-link", async () => {
      await execute();

      const text: string = markdownText();
      expect(text).toContain("New incident assigned to you");
      expect(text).toContain("INC-42");
      expect(text).toContain("Checkout is down");
      expect(text).toContain("You're getting this because you're on call.");
      expect(text).toContain(ACK_SHORT_URL);
      expect(text).toContain(
        "https://oneuptime.example.com/dashboard/incident",
      );
    });

    test("the message sticks to block types both platforms implement (markdown only)", async () => {
      await execute();

      for (const block of sendArg().messageBlocks) {
        expect(block._type).toBe("WorkspacePayloadMarkdown");
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) The Microsoft Teams path.
   * -----------------------------------------------------------------------
   */

  describe("a verified Microsoft Teams method", () => {
    beforeEach(() => {
      findRule.mockResolvedValue(ruleItem(verifiedTeams()) as never);
    });

    test("delivers with the MicrosoftTeams workspace type and the stored Entra id", async () => {
      await execute();

      const arg: CapturedSendArg = sendArg();
      expect(arg.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
      expect(arg.workspaceUserId).toBe(TEAMS_USER_ID);
    });

    test("its timeline row is stamped with userMicrosoftTeamsId and the Teams sending message", async () => {
      await execute();

      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.statusMessage).toBe(
        "Sending Microsoft Teams message.",
      );
      expect(timelineRows[0]?.userMicrosoftTeamsId?.toString()).toBe(
        METHOD_ID.toString(),
      );
      expect(timelineRows[0]?.userSlackId).toBeUndefined();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The verification gate.
   * -----------------------------------------------------------------------
   */

  describe("the verification gate", () => {
    test("an unverified Slack method writes one 'not verified' Error row and never sends", async () => {
      findRule.mockResolvedValue(
        ruleItem({
          userSlack: {
            id: METHOD_ID,
            slackUserId: SLACK_USER_ID,
            isVerified: false,
          },
        } as unknown as JSONObject) as never,
      );

      await execute();

      expect(sendDm).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.status).toBe(UserNotificationStatus.Error);
      expect(timelineRows[0]?.statusMessage).toBe(
        "Slack message not sent because the Slack account is not verified.",
      );
      expect(timelineRows[0]?.userSlackId?.toString()).toBe(
        METHOD_ID.toString(),
      );
    });

    test("an unverified Microsoft Teams method behaves the same, with its own message", async () => {
      findRule.mockResolvedValue(
        ruleItem({
          userMicrosoftTeams: {
            id: METHOD_ID,
            microsoftTeamsUserId: TEAMS_USER_ID,
            isVerified: false,
          },
        } as unknown as JSONObject) as never,
      );

      await execute();

      expect(sendDm).not.toHaveBeenCalled();
      expect(timelineRows[0]?.statusMessage).toBe(
        "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
      );
    });

    test("a verified relation whose address column is missing sends nothing (the same silent skip as every channel)", async () => {
      findRule.mockResolvedValue(
        ruleItem({
          userSlack: {
            id: METHOD_ID,
            isVerified: true,
          },
        } as unknown as JSONObject) as never,
      );

      await execute();

      expect(sendDm).not.toHaveBeenCalled();
      expect(timelineRows).toHaveLength(0);
    });

    test("the unverified guard keys off the RELATION, not the address - a row with no member id still errors", async () => {
      findRule.mockResolvedValue(
        ruleItem({
          userSlack: {
            id: METHOD_ID,
            isVerified: false,
          },
        } as unknown as JSONObject) as never,
      );

      await execute();

      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.statusMessage).toContain("not verified");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) Fire-and-forget failure handling.
   * -----------------------------------------------------------------------
   */

  describe("fire-and-forget failure handling", () => {
    test("a sender rejection is caught and flips the timeline row to Error with the sender's message", async () => {
      sendDm.mockRejectedValue(new Error("slack workspace revoked") as never);

      await expect(execute()).resolves.toBeUndefined();
      await flushMicrotasks();

      expect(timelineUpdate).toHaveBeenCalledTimes(1);
      const arg: {
        id: ObjectID;
        data: { status: UserNotificationStatus; statusMessage: string };
      } = timelineUpdate.mock.calls[0][0] as {
        id: ObjectID;
        data: { status: UserNotificationStatus; statusMessage: string };
      };
      expect(arg.id.toString()).toBe(TIMELINE_ID.toString());
      expect(arg.data.status).toBe(UserNotificationStatus.Error);
      expect(arg.data.statusMessage).toBe("slack workspace revoked");
    });

    test("a rejection with no message falls back to the channel-named default", async () => {
      sendDm.mockRejectedValue(new Error("") as never);

      await execute();
      await flushMicrotasks();

      const arg: { data: { statusMessage: string } } = timelineUpdate.mock
        .calls[0][0] as { data: { statusMessage: string } };
      expect(arg.data.statusMessage).toBe("Error sending Slack message.");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) The event map — all four event types deliver, on the right entity.
   * -----------------------------------------------------------------------
   */

  describe("the event map", () => {
    test("AlertCreated delivers the alert message with the alert correlation id", async () => {
      await execute({
        userNotificationEventType: UserNotificationEventType.AlertCreated,
        triggeredByIncidentId: undefined,
        triggeredByAlertId: ALERT_ID,
      });

      const arg: CapturedSendArg = sendArg();
      expect(arg.alertId?.toString()).toBe(ALERT_ID.toString());
      expect(arg.incidentId).toBeUndefined();
      expect(markdownText()).toContain("New alert assigned to you");
      expect(markdownText()).toContain("ALR-7");
    });

    test("AlertEpisodeCreated delivers the alert-episode message", async () => {
      await execute({
        userNotificationEventType:
          UserNotificationEventType.AlertEpisodeCreated,
        triggeredByIncidentId: undefined,
        triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
      });

      const arg: CapturedSendArg = sendArg();
      expect(arg.alertEpisodeId?.toString()).toBe(ALERT_EPISODE_ID.toString());
      expect(markdownText()).toContain("New alert episode assigned to you");
      expect(markdownText()).toContain("AEP-3");
    });

    test("IncidentEpisodeCreated delivers the incident-episode message", async () => {
      await execute({
        userNotificationEventType:
          UserNotificationEventType.IncidentEpisodeCreated,
        triggeredByIncidentId: undefined,
        triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
      });

      const arg: CapturedSendArg = sendArg();
      expect(arg.incidentEpisodeId?.toString()).toBe(
        INCIDENT_EPISODE_ID.toString(),
      );
      expect(markdownText()).toContain("New incident episode assigned to you");
      expect(markdownText()).toContain("IEP-9");
    });

    test("every event's message carries the acknowledge short-link - the whole point of writing the row first", async () => {
      for (const eventOverrides of [
        {
          userNotificationEventType: UserNotificationEventType.AlertCreated,
          triggeredByIncidentId: undefined,
          triggeredByAlertId: ALERT_ID,
        },
        {
          userNotificationEventType:
            UserNotificationEventType.AlertEpisodeCreated,
          triggeredByIncidentId: undefined,
          triggeredByAlertEpisodeId: ALERT_EPISODE_ID,
        },
        {
          userNotificationEventType:
            UserNotificationEventType.IncidentEpisodeCreated,
          triggeredByIncidentId: undefined,
          triggeredByIncidentEpisodeId: INCIDENT_EPISODE_ID,
        },
      ] as Array<Partial<ExecuteOptions>>) {
        sendDm.mockClear();
        await execute(eventOverrides);
        expect(markdownText()).toContain(ACK_SHORT_URL);
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (F) Both channels on one rule.
   * -----------------------------------------------------------------------
   */

  describe("a rule carrying both workspace methods", () => {
    test("delivers on both, one timeline row and one send per channel", async () => {
      findRule.mockResolvedValue(
        ruleItem({
          ...verifiedSlack(),
          ...verifiedTeams(),
        }) as never,
      );

      await execute();

      expect(sendDm).toHaveBeenCalledTimes(2);

      const workspaceTypes: Array<WorkspaceType> = sendDm.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { workspaceType: WorkspaceType }).workspaceType;
        },
      );
      expect(workspaceTypes).toContain(WorkspaceType.Slack);
      expect(workspaceTypes).toContain(WorkspaceType.MicrosoftTeams);
    });
  });
});
