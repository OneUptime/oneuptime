import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import CreateChannelNotificationRule from "../../../Types/Workspace/NotificationRules/CreateChannelNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspacePayloadMarkdown } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelName, {
  WorkspaceChannelNameParts,
} from "../../../Utils/Workspace/WorkspaceChannelName";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A RECORD'S CHANNEL AND WHAT IS SAID ABOUT IT ARE LISTED ON THE RECORD.
 *
 * A record's Notification Logs > Workspace tab lists the workspace logs that
 * carry the record's id: { monitorId } on a monitor's, { onCallDutyPolicyId }
 * on an on-call policy's. The channel a rule creates was logged with the
 * record's id only for an incident, an alert, a scheduled maintenance and an
 * on-call policy: a monitor's or an episode's channel was logged against no
 * record. And a message about a monitor or an on-call policy - posted, or
 * refused by the workspace - was logged against no record either, so a
 * monitor's tab listed the people added to its channel, and neither the
 * channel nor anything said in it.
 *
 * Here a record's channels are set up as createChannelsAndInviteUsersToChannelsBasedOnRules
 * sets them up, through the real createChannelsBasedOnRules and
 * logCreateChannel, and a message about a record is sent as
 * sendWorkspaceMarkdownNotification sends it, through the real
 * logSendResponses, to the log rows written. Only the workspace, the
 * database and where the record's channels are stored are faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000002");

// Invited by the rule to the channel it creates: connected to Slack.
const INVITED: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000011");
// The person a message is sent for.
const NOTIFIED: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000012");

/*
 * What follows the rule's prefix, record-: the channel is record-1 for every
 * kind of record (the parts the record kinds' WorkspaceMessages hand in).
 */
const RECORD_CHANNEL_NAME_PARTS: WorkspaceChannelNameParts = {
  afterPrefix: "1",
  ownName: "record-1",
};

// The channel the workspace creates for the record.
const RECORD_CHANNEL: WorkspaceChannel = {
  id: "C0REC1",
  name: "record-1",
  workspaceType: WorkspaceType.Slack,
};

// The existing channel the rule also posts to, which Slack refuses.
const OPS_CHANNEL: WorkspaceChannel = {
  id: "C0OPS",
  name: "ops",
  workspaceType: WorkspaceType.Slack,
};

const THREAD_ID: string = "1700000000.000100";

/*
 * The records a channel is created for and its log rows are filed under. A
 * security case has neither: its rules only post to channels that exist.
 */
type RecordField = Exclude<keyof NotificationFor, "securityCaseId">;

interface RecordCase {
  field: RecordField;
  eventType: NotificationRuleEventType;
}

// Every kind of record a rule creates channels for and posts about.
const RECORDS: Array<RecordCase> = [
  { field: "incidentId", eventType: NotificationRuleEventType.Incident },
  { field: "alertId", eventType: NotificationRuleEventType.Alert },
  {
    field: "scheduledMaintenanceId",
    eventType: NotificationRuleEventType.ScheduledMaintenance,
  },
  {
    field: "onCallDutyPolicyId",
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
  },
  { field: "monitorId", eventType: NotificationRuleEventType.Monitor },
  {
    field: "incidentEpisodeId",
    eventType: NotificationRuleEventType.IncidentEpisode,
  },
  {
    field: "alertEpisodeId",
    eventType: NotificationRuleEventType.AlertEpisode,
  },
];

const RECORD_FIELDS: Array<RecordField> = RECORDS.map(
  (record: RecordCase): RecordField => {
    return record.field;
  },
);

let logRows: Array<WorkspaceNotificationLog>;
let createChannel: Mock<(data: unknown) => Promise<WorkspaceChannel>>;
let invite: Mock<(data: unknown) => Promise<void>>;
let post: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;

/*
 * The Slack rule that creates the record's channel, invites a person to it
 * and posts to an existing channel as well.
 */
function slackRule(): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = RULE_ID;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Slack;

  const notificationRule: CreateChannelNotificationRule = {
    _type: "CreateChannelNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: true,
    existingChannelNames: OPS_CHANNEL.name,
    shouldCreateNewChannel: true,
    newChannelTemplateName: "record-",
    inviteUsersToNewChannel: [INVITED],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    archiveChannelAutomatically: false,
  };

  rule.notificationRule = notificationRule as never;
  return rule;
}

function slackProjectAuth(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.authToken = "xoxb-project";
  auth.workspaceProjectId = "T0WORKSPACE";
  return auth;
}

// The message reached the record's channel; Slack refused it in "ops".
function sendResponse(): WorkspaceSendMessageResponse {
  return {
    workspaceType: WorkspaceType.Slack,
    threads: [{ channel: RECORD_CHANNEL, threadId: THREAD_ID }],
    errors: [{ channel: OPS_CHANNEL, error: "not_in_channel" }],
  };
}

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text: text };
}

// The record's own channel is in Slack, and the record has none elsewhere.
async function recordChannels(data: {
  workspaceType?: WorkspaceType | null | undefined;
}): Promise<Array<NotificationRuleWorkspaceChannel>> {
  if (data.workspaceType !== WorkspaceType.Slack) {
    return [];
  }

  return [{ ...RECORD_CHANNEL, notificationRuleId: RULE_ID.toString() }];
}

function rowsOf(
  actionType: WorkspaceNotificationActionType,
): Array<WorkspaceNotificationLog> {
  return logRows.filter((row: WorkspaceNotificationLog): boolean => {
    return row.actionType === actionType;
  });
}

// The record each row names, by the column its Notification Logs page reads.
function recordOf(
  row: WorkspaceNotificationLog,
  field: RecordField,
): string | undefined {
  return row.getColumnValue(field)?.toString();
}

// The row names the record, and no record of another kind.
function expectOnlyRecord(
  row: WorkspaceNotificationLog,
  field: RecordField,
  recordId: ObjectID,
): void {
  expect(recordOf(row, field)).toBe(recordId.toString());

  for (const otherField of RECORD_FIELDS) {
    if (otherField !== field) {
      expect(recordOf(row, otherField)).toBeUndefined();
    }
  }
}

beforeEach(() => {
  logRows = [];

  // The workspace: the project's Slack, who is connected to it.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue([slackProjectAuth()]);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(slackProjectAuth());

  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Array<ObjectID>> => {
        return data.userIds.map((userId: ObjectID | string): ObjectID => {
          return new ObjectID(userId.toString());
        });
      },
    );

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getWorkspaceUserIdFromOneUptimeUserId",
    )
    .mockImplementation(
      async (data: { oneuptimeUserId: ObjectID }): Promise<string | null> => {
        return data.oneuptimeUserId.toString() === INVITED.toString()
          ? "U0INVITED"
          : null;
      },
    );

  // The workspace creates the channel asked for and invites to it.
  createChannel = jest.fn(async (): Promise<WorkspaceChannel> => {
    return { ...RECORD_CHANNEL };
  });
  invite = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    createChannel: createChannel,
    inviteUsersToChannels: invite,
    // Whether a refusal means the name is taken, as Slack's answer says.
    isChannelNameTakenError: (error: unknown): boolean => {
      return SlackUtil.isChannelNameTakenError(error);
    },
  } as never);

  post = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockResolvedValue([sendResponse()]);

  // The workspace logs a record's Notification Logs page lists.
  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockImplementation((async (data: {
      data: WorkspaceNotificationLog;
    }): Promise<WorkspaceNotificationLog> => {
      logRows.push(data.data);
      return data.data;
    }) as never);

  // The project's rules: the one Slack rule.
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
    .mockImplementation(
      async (data: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceNotificationRule>> => {
        return data.workspaceType === WorkspaceType.Slack ? [slackRule()] : [];
      },
    );

  // Where each kind of record keeps the channels created for it.
  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockImplementation(recordChannels);
  jest
    .spyOn(AlertService, "getWorkspaceChannelForAlert")
    .mockImplementation(recordChannels);
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getWorkspaceChannelForScheduledMaintenance",
    )
    .mockImplementation(recordChannels);
  jest
    .spyOn(OnCallDutyPolicyService, "getWorkspaceChannelForOnCallDutyPolicy")
    .mockImplementation(recordChannels);
  jest
    .spyOn(MonitorService, "getWorkspaceChannelForMonitor")
    .mockImplementation(recordChannels);
  jest
    .spyOn(IncidentEpisodeService, "getWorkspaceChannelForEpisode")
    .mockImplementation(recordChannels);
  jest
    .spyOn(AlertEpisodeService, "getWorkspaceChannelForEpisode")
    .mockImplementation(recordChannels);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the channel a rule creates for a record is listed on the record's Notification Logs", () => {
  test.each(RECORDS)(
    "REGRESSION: the channel created for the $field is logged against the record, and only it",
    async (record: RecordCase) => {
      const recordId: ObjectID = ObjectID.generate();

      await expect(
        WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
          {
            projectId: PROJECT_ID,
            notificationRuleEventType: record.eventType,
            notificationFor: { [record.field]: recordId },
            channelNameParts: RECORD_CHANNEL_NAME_PARTS,
          },
        ),
      ).resolves.toMatchObject({
        channelsCreated: [{ id: "C0REC1", name: "record-1" }],
      });

      expect(createChannel).toHaveBeenCalledTimes(1);
      expect(createChannel.mock.calls[0]![0]).toMatchObject({
        authToken: "xoxb-project",
        channelName: "record-1",
      });

      const rows: Array<WorkspaceNotificationLog> = rowsOf(
        WorkspaceNotificationActionType.CreateChannel,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.workspaceType).toBe(WorkspaceType.Slack);
      expect(rows[0]!.channelId).toBe("C0REC1");
      expect(rows[0]!.channelName).toBe("record-1");
      expect(rows[0]!.status).toBe(WorkspaceNotificationStatus.Success);
      expect(rows[0]!.message).toBe('Channel "record-1" was created');
      expectOnlyRecord(rows[0]!, record.field, recordId);

      // The record's tab lists the channel beside who was added to it.
      expect(rowsOf(WorkspaceNotificationActionType.InviteUser)).toHaveLength(
        1,
      );
      for (const row of logRows) {
        expectOnlyRecord(row, record.field, recordId);
      }
    },
  );

  test("a channel created with no record named - a rule's test - is logged against no record", async () => {
    await WorkspaceNotificationRuleService.createChannelsBasedOnRules({
      projectId: PROJECT_ID,
      projectOrUserAuthTokenForWorkspace: "xoxb-project",
      workspaceType: WorkspaceType.Slack,
      notificationRules: [slackRule()],
      channelNameParts: RECORD_CHANNEL_NAME_PARTS,
      notificationEventType: NotificationRuleEventType.Monitor,
    });

    const rows: Array<WorkspaceNotificationLog> = rowsOf(
      WorkspaceNotificationActionType.CreateChannel,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.channelId).toBe("C0REC1");
    for (const field of RECORD_FIELDS) {
      expect(recordOf(rows[0]!, field)).toBeUndefined();
    }
  });

  test.each(RECORDS)(
    "a channel the workspace does not create for the $field is logged against the record as not created, with what the workspace answered",
    async (record: RecordCase) => {
      createChannel.mockRejectedValue(new Error("Error from Slack name_taken"));

      const recordId: ObjectID = ObjectID.generate();

      await expect(
        WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
          {
            projectId: PROJECT_ID,
            notificationRuleEventType: record.eventType,
            notificationFor: { [record.field]: recordId },
            channelNameParts: RECORD_CHANNEL_NAME_PARTS,
          },
        ),
      ).resolves.toEqual({ channelsCreated: [], membersNotAdded: [] });

      const rows: Array<WorkspaceNotificationLog> = rowsOf(
        WorkspaceNotificationActionType.CreateChannel,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.workspaceType).toBe(WorkspaceType.Slack);
      expect(rows[0]!.channelId).toBeUndefined();
      expect(rows[0]!.channelName).toBe("record-1");
      expect(rows[0]!.status).toBe(WorkspaceNotificationStatus.Error);
      expect(rows[0]!.statusMessage).toBe("Error from Slack name_taken");
      expect(rows[0]!.message).toBe('Channel "record-1" was not created');
      expectOnlyRecord(rows[0]!, record.field, recordId);

      // Nobody is invited to a channel that is not there.
      expect(invite).not.toHaveBeenCalled();
      expect(rowsOf(WorkspaceNotificationActionType.InviteUser)).toEqual([]);
    },
  );

  test("told to throw - a rule's test - it throws what the workspace answered, and logs the channel as not created against no record", async () => {
    createChannel.mockRejectedValue(new Error("Error from Slack name_taken"));

    await expect(
      WorkspaceNotificationRuleService.createChannelsBasedOnRules({
        projectId: PROJECT_ID,
        projectOrUserAuthTokenForWorkspace: "xoxb-project",
        workspaceType: WorkspaceType.Slack,
        notificationRules: [slackRule()],
        channelNameParts: RECORD_CHANNEL_NAME_PARTS,
        notificationEventType: NotificationRuleEventType.Monitor,
        throwOnCreateChannelError: true,
      }),
    ).rejects.toThrow("name_taken");

    // Tried under each of its names (record-1, record-1-2 ...), and none made.
    expect(createChannel).toHaveBeenCalledTimes(
      WorkspaceChannelName.MAX_NAME_ATTEMPTS,
    );

    const rows: Array<WorkspaceNotificationLog> = rowsOf(
      WorkspaceNotificationActionType.CreateChannel,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe(WorkspaceNotificationStatus.Error);
    expect(rows[0]!.statusMessage).toBe("Error from Slack name_taken");
    for (const field of RECORD_FIELDS) {
      expect(recordOf(rows[0]!, field)).toBeUndefined();
    }
  });
});

describe("a message about a record is listed on the record's Notification Logs", () => {
  test.each(RECORDS)(
    "REGRESSION: a message about the $field is logged against the record where it was posted and where it was refused",
    async (record: RecordCase) => {
      const recordId: ObjectID = ObjectID.generate();

      await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
        projectId: PROJECT_ID,
        notificationFor: { [record.field]: recordId },
        feedInfoInMarkdown: "API is offline",
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      // Sent to the record's channel, and to the channel the rule names.
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]![0].messagePayloadsByWorkspace).toMatchObject([
        {
          workspaceType: WorkspaceType.Slack,
          channelIds: ["C0REC1"],
          channelNames: [],
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelIds: [],
          channelNames: ["ops"],
        },
      ]);

      const rows: Array<WorkspaceNotificationLog> = rowsOf(
        WorkspaceNotificationActionType.SendMessage,
      );

      expect(
        rows.map((row: WorkspaceNotificationLog): Array<unknown> => {
          return [row.channelId, row.status];
        }),
      ).toEqual([
        ["C0REC1", WorkspaceNotificationStatus.Success],
        ["C0OPS", WorkspaceNotificationStatus.Error],
      ]);
      expect(rows[0]!.threadId).toBe(THREAD_ID);
      expect(rows[1]!.statusMessage).toBe("not_in_channel");

      for (const row of rows) {
        expect(row.workspaceType).toBe(WorkspaceType.Slack);
        expect(row.message).toBe("API is offline");
        expectOnlyRecord(row, record.field, recordId);
      }
    },
  );
});

describe("WorkspaceNotificationLogService.logCreateChannel", () => {
  test.each(RECORD_FIELDS)(
    "writes the %s it is given onto the channel's row",
    async (field: RecordField) => {
      const recordId: ObjectID = ObjectID.generate();

      const createdChannel: Parameters<
        typeof WorkspaceNotificationLogService.logCreateChannel
      >[0] = {
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelId: "C0REC1",
        channelName: "record-1",
      };
      createdChannel[field] = recordId;

      await WorkspaceNotificationLogService.logCreateChannel(createdChannel, {
        isRoot: true,
      });

      expect(logRows).toHaveLength(1);
      expect(logRows[0]!.actionType).toBe(
        WorkspaceNotificationActionType.CreateChannel,
      );
      expect(logRows[0]!.channelId).toBe("C0REC1");
      expectOnlyRecord(logRows[0]!, field, recordId);
    },
  );
});

describe("WorkspaceNotificationRuleService.logSendResponses", () => {
  test.each(RECORD_FIELDS)(
    "writes the %s onto the row of the channel a message reached and of the one it did not",
    async (field: RecordField) => {
      const recordId: ObjectID = ObjectID.generate();

      await WorkspaceNotificationRuleService.logSendResponses({
        projectId: PROJECT_ID,
        notificationFor: { [field]: recordId },
        responses: [sendResponse()],
        messageBlocksByWorkspaceTypes: [
          {
            workspaceType: WorkspaceType.Slack,
            messageBlocks: [markdown("API is offline")],
          },
        ],
        authorUserId: NOTIFIED,
      });

      expect(
        logRows.map((row: WorkspaceNotificationLog): Array<unknown> => {
          return [row.actionType, row.channelId, row.status];
        }),
      ).toEqual([
        [
          WorkspaceNotificationActionType.SendMessage,
          "C0REC1",
          WorkspaceNotificationStatus.Success,
        ],
        [
          WorkspaceNotificationActionType.SendMessage,
          "C0OPS",
          WorkspaceNotificationStatus.Error,
        ],
      ]);

      for (const row of logRows) {
        expect(row.userId?.toString()).toBe(NOTIFIED.toString());
        expectOnlyRecord(row, field, recordId);
      }
    },
  );
});
