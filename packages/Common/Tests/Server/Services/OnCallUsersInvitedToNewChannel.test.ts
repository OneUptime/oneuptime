import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import AlertNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/AlertNotificationRule";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE PERSON AN ON-CALL POLICY PAGES IS ADDED TO THE RECORD'S NEW CHANNEL.
 *
 * Reported from a project's Slack: an incident rule - "Incident Labels
 * Contains Any alpha", Create Slack Channel on, Invite Incident Owners off,
 * Automatically Invite On Call Users to New Slack Channel on - created the
 * incident's channel and posted to it, and the on-call policy paged the
 * person on call (a Slack direct message reached them), but that person was
 * never added to the channel. The incident's Workspace logs showed the
 * channel created and its messages, and no invite.
 *
 * The page asked for the rules that invite OWNERS, not the rules that
 * invite on-call users: the switch the rule says it honours was never read.
 * A rule that invited on-call users but not owners added nobody it paged,
 * and one that invited owners but not on-call users added everybody it
 * paged.
 *
 * Here a page goes out as an escalation rule sends one
 * (startUserNotificationRulesExecution), through the real rule matching
 * (the label condition), the real invite path and SlackUtil, to a fake
 * Slack API that records every request. Only the database is faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-000000000003");
const POLICY_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000004",
);
const ALPHA_LABEL_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000011",
);
const RULE_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-000000000021");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000022",
);

// The policy's run, its first escalation rule, and the schedule it pages.
const EXECUTION_LOG_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000041",
);
const ESCALATION_RULE_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000042",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000043",
);

// On call now, with a Slack account connected to OneUptime.
const ON_CALL: ObjectID = new ObjectID("c1000000-0000-4000-8000-000000000031");
// Paged when the first rule is not acknowledged in time; connected too.
const NEXT_ON_CALL: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000032",
);
// A member who has not connected a Slack account.
const NOT_CONNECTED: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000033",
);
// Still on a schedule, but no longer a member of the project.
const LEFT_PROJECT: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000034",
);

const SLACK_USER_IDS: Dictionary<string> = {
  [ON_CALL.toString()]: "U0ONCALL",
  [NEXT_ON_CALL.toString()]: "U0NEXT",
  [LEFT_PROJECT.toString()]: "U0LEFT",
};

const BOT_SLACK_USER_ID: string = "B0BOT";

const INCIDENT_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0INC9",
  name: "incidents-inc-9",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: RULE_ID.toString(),
};

const OTHER_INCIDENT_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0WAR9",
  name: "war-room-inc-9",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: OTHER_RULE_ID.toString(),
};

const ALERT_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0AL12",
  name: "alerts-al-12",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: RULE_ID.toString(),
};

interface RuleSwitches {
  inviteOwners: boolean;
  inviteOnCallUsers: boolean;
}

// The reported rule: on-call users are invited, owners are not.
const REPORTED_RULE: RuleSwitches = {
  inviteOwners: false,
  inviteOnCallUsers: true,
};

function incidentRule(
  id: ObjectID,
  switches: RuleSwitches,
  channelTemplate: string = "incidents-",
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
        conditionType: ConditionType.ContainsAny,
        value: [ALPHA_LABEL_ID.toString()],
      },
    ],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    newChannelTemplateName: channelTemplate,
    inviteUsersToNewChannel: [],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: switches.inviteOwners,
    archiveChannelAutomatically: true,
    shouldAutomaticallyInviteOnCallUsersToNewChannel:
      switches.inviteOnCallUsers,
  };

  rule.notificationRule = notificationRule as never;
  return rule;
}

function alertRule(
  id: ObjectID,
  switches: RuleSwitches,
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Alert;

  const notificationRule: AlertNotificationRule = {
    _type: "AlertNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: NotificationRuleConditionCheckOn.AlertLabels,
        conditionType: ConditionType.ContainsAny,
        value: [ALPHA_LABEL_ID.toString()],
      },
    ],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    newChannelTemplateName: "alerts-",
    inviteUsersToNewChannel: [],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: switches.inviteOwners,
    archiveChannelAutomatically: true,
    shouldAutomaticallyInviteOnCallUsersToNewChannel:
      switches.inviteOnCallUsers,
  };

  rule.notificationRule = notificationRule as never;
  return rule;
}

function alphaLabel(): Label {
  const label: Label = new Label();
  label.id = ALPHA_LABEL_ID;
  label.name = "alpha";
  return label;
}

interface SlackRequest {
  method: string;
  body: JSONObject;
}

// The Slack API, as far as adding people to a channel goes.
class FakeSlack {
  public requests: Array<SlackRequest> = [];

  // Who is in each channel: the bot that created it, to begin with.
  public members: Dictionary<Array<string>> = {};

  public install(): void {
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject>> => {
      const method: string = data.url.toString().split("/api/")[1] || "";
      const body: JSONObject = data.data || {};
      const channel: string = String(body["channel"] || "");

      this.requests.push({ method: method, body: body });

      let answer: JSONObject = { ok: true };

      if (method === "conversations.members") {
        answer = {
          ok: true,
          members: this.membersOf(channel),
          response_metadata: { next_cursor: "" },
        };
      }

      if (method === "conversations.invite") {
        this.members[channel] = [
          ...this.membersOf(channel),
          ...String(body["users"]).split(","),
        ];
        answer = { ok: true, channel: { id: channel } };
      }

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);
  }

  // Who was added to which channel, in the order Slack was asked.
  public invites(): Array<{ channel: string; users: string }> {
    return this.requests
      .filter((request: SlackRequest): boolean => {
        return request.method === "conversations.invite";
      })
      .map((request: SlackRequest): { channel: string; users: string } => {
        return {
          channel: String(request.body["channel"]),
          users: String(request.body["users"]),
        };
      });
  }

  private membersOf(channel: string): Array<string> {
    return this.members[channel] || [BOT_SLACK_USER_ID];
  }
}

let slack: FakeSlack;
let storedRules: Array<WorkspaceNotificationRule>;
let incidentChannels: Array<NotificationRuleWorkspaceChannel>;
let alertChannels: Array<NotificationRuleWorkspaceChannel>;
let members: Set<string>;
let logRows: Array<WorkspaceNotificationLog>;
let workspaceUserLookups: Array<string>;
let noticeSpy: SpyInstance<
  typeof ChannelMembersNotAddedNotice.noteMembersNotAdded
>;

/*
 * A page does not wait for its workspace step - Slack being slow must
 * never hold a page up - and the step does not wait for its invite. Both
 * are collected as they start, so a test can wait for what a page set off.
 */
let started: Array<Promise<void>>;

async function workspaceStepsDone(): Promise<void> {
  let waitedFor: number = -1;

  while (waitedFor !== started.length) {
    waitedFor = started.length;
    await Promise.all(started);
  }
}

function collectAsStarted(): void {
  const runWorkspaceRules: typeof UserNotificationRuleService.runWorkspaceRulesForOnCallNotification =
    UserNotificationRuleService.runWorkspaceRulesForOnCallNotification.bind(
      UserNotificationRuleService,
    );

  jest
    .spyOn(
      UserNotificationRuleService,
      "runWorkspaceRulesForOnCallNotification",
    )
    .mockImplementation(
      (data: Parameters<typeof runWorkspaceRules>[0]): Promise<void> => {
        const step: Promise<void> = runWorkspaceRules(data);
        started.push(
          step.catch((): void => {
            return undefined;
          }),
        );
        return step;
      },
    );

  const invite: typeof WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels =
    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels.bind(
      WorkspaceNotificationRuleService,
    );

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockImplementation((data: Parameters<typeof invite>[0]): Promise<void> => {
      const step: Promise<void> = invite(data);
      started.push(
        step.catch((): void => {
          return undefined;
        }),
      );
      return step;
    });
}

// A page going out, as an escalation rule of the policy sends it.
async function page(
  userId: ObjectID,
  record: { incidentId: ObjectID } | { alertId: ObjectID },
): Promise<void> {
  const incidentId: ObjectID | undefined =
    "incidentId" in record ? record.incidentId : undefined;
  const alertId: ObjectID | undefined =
    "alertId" in record ? record.alertId : undefined;

  await UserNotificationRuleService.startUserNotificationRulesExecution(
    userId,
    {
      projectId: PROJECT_ID,
      triggeredByIncidentId: incidentId,
      triggeredByAlertId: alertId,
      userNotificationEventType: incidentId
        ? UserNotificationEventType.IncidentCreated
        : UserNotificationEventType.AlertCreated,
      onCallPolicyId: POLICY_ID,
    },
  );

  await workspaceStepsDone();
}

function slackProjectAuth(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.authToken = "xoxb-project";
  auth.workspaceProjectId = "T0WORKSPACE";

  // The channels OneUptime created are cached by name as they are created.
  const channelCache: Dictionary<JSONObject> = {};

  for (const channel of [...incidentChannels, ...alertChannels]) {
    channelCache[channel.name] = { id: channel.id, name: channel.name };
  }

  auth.miscData = {
    botUserId: BOT_SLACK_USER_ID,
    teamId: "T0WORKSPACE",
    teamName: "Ops",
    channelCache: channelCache,
  } as never;

  return auth;
}

function inviteRows(): Array<WorkspaceNotificationLog> {
  return logRows.filter((row: WorkspaceNotificationLog): boolean => {
    return row.actionType === WorkspaceNotificationActionType.InviteUser;
  });
}

beforeEach(() => {
  slack = new FakeSlack();
  slack.install();

  storedRules = [incidentRule(RULE_ID, REPORTED_RULE)];
  incidentChannels = [INCIDENT_CHANNEL];
  alertChannels = [ALERT_CHANNEL];
  members = new Set<string>([
    ON_CALL.toString(),
    NEXT_ON_CALL.toString(),
    NOT_CONNECTED.toString(),
  ]);
  logRows = [];
  workspaceUserLookups = [];
  started = [];

  collectAsStarted();

  // The page's own row, which the worker later delivers.
  jest.spyOn(UserOnCallLogService, "create").mockImplementation((async (data: {
    data: UserOnCallLog;
  }): Promise<UserOnCallLog> => {
    return data.data;
  }) as never);

  // The project's workspace rules, as stored.
  jest
    .spyOn(WorkspaceNotificationRuleService, "findBy")
    .mockImplementation((async (data: {
      query: {
        workspaceType?: WorkspaceType;
        eventType?: NotificationRuleEventType;
      };
    }): Promise<Array<WorkspaceNotificationRule>> => {
      return storedRules.filter((rule: WorkspaceNotificationRule): boolean => {
        return (
          rule.workspaceType === data.query.workspaceType &&
          rule.eventType === data.query.eventType
        );
      });
    }) as never);

  // INC-9: labelled alpha, with the channel its rule created.
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.title = "Checkout is down";
      incident.description = "Orders fail at payment.";
      incident.labels = [alphaLabel()];
      incident.monitors = [];
      incident.postUpdatesToWorkspaceChannels = incidentChannels;
      return incident;
    }) as never);

  // AL-12: labelled alpha, with the channel its rule created.
  jest
    .spyOn(AlertService, "findOneById")
    .mockImplementation((async (): Promise<Alert> => {
      const alert: Alert = new Alert();
      alert.id = ALERT_ID;
      alert.projectId = PROJECT_ID;
      alert.title = "API latency is high";
      alert.labels = [alphaLabel()];
      alert.postUpdatesToWorkspaceChannels = alertChannels;
      return alert;
    }) as never);

  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds
            .map((userId: ObjectID | string): string => {
              return userId.toString();
            })
            .filter((userId: string): boolean => {
              return members.has(userId);
            }),
        );
      },
    );

  // The project's Slack workspace: its bot token and its channel cache.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async (data: {
      query: { workspaceType?: WorkspaceType };
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return data.query.workspaceType === WorkspaceType.Slack
        ? slackProjectAuth()
        : null;
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return data.workspaceType === WorkspaceType.Slack
        ? slackProjectAuth()
        : null;
    }) as never);

  // Each person's own Slack account, connected to OneUptime.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (data: {
      query: { userId: ObjectID; workspaceType: WorkspaceType };
    }): Promise<WorkspaceUserAuthToken | null> => {
      workspaceUserLookups.push(data.query.userId.toString());

      const slackUserId: string | undefined =
        SLACK_USER_IDS[data.query.userId.toString()];

      if (!slackUserId || data.query.workspaceType !== WorkspaceType.Slack) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.workspaceUserId = slackUserId;
      return userAuth;
    }) as never);

  noticeSpy = jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockResolvedValue(undefined);

  // The workspace logs a record's Notification Logs page lists.
  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockImplementation((async (data: {
      data: WorkspaceNotificationLog;
    }): Promise<WorkspaceNotificationLog> => {
      logRows.push(data.data);
      return data.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a rule that invites on-call users and not owners (the reported rule)", () => {
  test("REGRESSION: the person paged for the incident is added to the channel the rule created", async () => {
    await page(ON_CALL, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([{ channel: "C0INC9", users: "U0ONCALL" }]);
  });

  test("the invite is listed on the incident's Workspace logs, with who was added to which channel", async () => {
    await page(ON_CALL, { incidentId: INCIDENT_ID });

    const rows: Array<WorkspaceNotificationLog> = inviteRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(rows[0]!.alertId).toBeUndefined();
    expect(rows[0]!.userId?.toString()).toBe(ON_CALL.toString());
    expect(rows[0]!.channelId).toBe("C0INC9");
    expect(rows[0]!.channelName).toBe("incidents-inc-9");
    expect(rows[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(rows[0]!.workspaceType).toBe(WorkspaceType.Slack);
  });

  test("everybody is added as they are paged: the next escalation rule's person too", async () => {
    await page(ON_CALL, { incidentId: INCIDENT_ID });
    await page(NEXT_ON_CALL, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([
      { channel: "C0INC9", users: "U0ONCALL" },
      { channel: "C0INC9", users: "U0NEXT" },
    ]);
  });

  test("somebody paged again - a later rule, a repeat of the policy - is not asked into the channel twice", async () => {
    await page(ON_CALL, { incidentId: INCIDENT_ID });
    await page(ON_CALL, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([{ channel: "C0INC9", users: "U0ONCALL" }]);
  });

  test("somebody who has not connected a Slack account is not invited; the channel's note names them", async () => {
    await page(NOT_CONNECTED, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([]);
    expect(inviteRows()).toEqual([]);

    expect(noticeSpy).toHaveBeenCalledTimes(1);
    expect(noticeSpy.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      channels: [{ id: "C0INC9", name: "incidents-inc-9" }],
      userIds: [NOT_CONNECTED],
    });
  });

  test("somebody who has left the project is neither invited, looked up, nor named in the channel", async () => {
    await page(LEFT_PROJECT, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([]);
    expect(workspaceUserLookups).toEqual([]);
    expect(noticeSpy).not.toHaveBeenCalled();
  });
});

describe("which rules add the person paged to their channel", () => {
  test.each([
    {
      name: "on-call users on, owners off - the reported rule",
      switches: { inviteOwners: false, inviteOnCallUsers: true },
      added: true,
    },
    {
      name: "on-call users on, owners on",
      switches: { inviteOwners: true, inviteOnCallUsers: true },
      added: true,
    },
    {
      // REGRESSION: the page read this switch, so everybody paged was added.
      name: "owners on, on-call users off",
      switches: { inviteOwners: true, inviteOnCallUsers: false },
      added: false,
    },
    {
      name: "both off",
      switches: { inviteOwners: false, inviteOnCallUsers: false },
      added: false,
    },
  ])(
    "$name: the person paged is added - $added",
    async (data: { switches: RuleSwitches; added: boolean }) => {
      storedRules = [incidentRule(RULE_ID, data.switches)];

      await page(ON_CALL, { incidentId: INCIDENT_ID });

      expect(slack.invites()).toEqual(
        data.added ? [{ channel: "C0INC9", users: "U0ONCALL" }] : [],
      );
      expect(inviteRows()).toHaveLength(data.added ? 1 : 0);
    },
  );

  test("two rules created channels for the incident: the person paged joins only the one whose rule invites on-call users", async () => {
    storedRules = [
      incidentRule(
        OTHER_RULE_ID,
        {
          inviteOwners: true,
          inviteOnCallUsers: false,
        },
        "war-room-",
      ),
      incidentRule(RULE_ID, REPORTED_RULE),
    ];
    incidentChannels = [OTHER_INCIDENT_CHANNEL, INCIDENT_CHANNEL];

    await page(ON_CALL, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([{ channel: "C0INC9", users: "U0ONCALL" }]);
    expect(
      inviteRows().map((row: WorkspaceNotificationLog): string | undefined => {
        return row.channelId;
      }),
    ).toEqual(["C0INC9"]);
  });

  test("both rules invite on-call users: the person paged joins both channels", async () => {
    storedRules = [
      incidentRule(OTHER_RULE_ID, REPORTED_RULE, "war-room-"),
      incidentRule(RULE_ID, REPORTED_RULE),
    ];
    incidentChannels = [OTHER_INCIDENT_CHANNEL, INCIDENT_CHANNEL];

    await page(ON_CALL, { incidentId: INCIDENT_ID });

    expect(
      slack
        .invites()
        .map((invite: { channel: string; users: string }): string => {
          return invite.channel;
        })
        .sort(),
    ).toEqual(["C0INC9", "C0WAR9"]);
  });

  test("no channel was created for the incident: nobody is added anywhere", async () => {
    incidentChannels = [];

    await page(ON_CALL, { incidentId: INCIDENT_ID });

    expect(slack.invites()).toEqual([]);
    expect(inviteRows()).toEqual([]);
  });
});

describe("alerts", () => {
  test("REGRESSION: an alert rule that invites on-call users and not owners adds the person paged to the alert's channel", async () => {
    storedRules = [alertRule(RULE_ID, REPORTED_RULE)];

    await page(ON_CALL, { alertId: ALERT_ID });

    expect(slack.invites()).toEqual([{ channel: "C0AL12", users: "U0ONCALL" }]);
  });

  test("the invite is listed on the alert's Workspace logs", async () => {
    storedRules = [alertRule(RULE_ID, REPORTED_RULE)];

    await page(ON_CALL, { alertId: ALERT_ID });

    const rows: Array<WorkspaceNotificationLog> = inviteRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(rows[0]!.incidentId).toBeUndefined();
    expect(rows[0]!.userId?.toString()).toBe(ON_CALL.toString());
    expect(rows[0]!.channelId).toBe("C0AL12");
  });

  test("an alert rule that invites owners but not on-call users adds nobody it paged", async () => {
    storedRules = [
      alertRule(RULE_ID, { inviteOwners: true, inviteOnCallUsers: false }),
    ];

    await page(ON_CALL, { alertId: ALERT_ID });

    expect(slack.invites()).toEqual([]);
  });

  test("an incident's rules do not add anybody paged for an alert", async () => {
    storedRules = [incidentRule(RULE_ID, REPORTED_RULE)];

    await page(ON_CALL, { alertId: ALERT_ID });

    expect(slack.invites()).toEqual([]);
  });
});

/*
 * The whole way, as the reported project pages: its policy's escalation
 * rule pages whoever is on call in its schedule (the real
 * startRuleExecution), and that page - the same one that sends the person
 * their Slack direct message - adds them to the record's new channel.
 */
describe("from the policy's escalation rule to the record's channel", () => {
  let timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;

  async function runEscalationRule(
    record: { incidentId: ObjectID } | { alertId: ObjectID },
  ): Promise<void> {
    const incidentId: ObjectID | undefined =
      "incidentId" in record ? record.incidentId : undefined;
    const alertId: ObjectID | undefined =
      "alertId" in record ? record.alertId : undefined;

    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
      ESCALATION_RULE_ID,
      {
        projectId: PROJECT_ID,
        triggeredByIncidentId: incidentId,
        triggeredByAlertId: alertId,
        userNotificationEventType: incidentId
          ? UserNotificationEventType.IncidentCreated
          : UserNotificationEventType.AlertCreated,
        onCallPolicyExecutionLogId: EXECUTION_LOG_ID,
        onCallPolicyId: POLICY_ID,
      },
    );

    await workspaceStepsDone();
  }

  beforeEach(() => {
    timeline = [];

    const escalationRule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    escalationRule.id = ESCALATION_RULE_ID;
    escalationRule.order = 1;
    escalationRule.escalateAfterInMinutes = 10;

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
      .mockResolvedValue(escalationRule);

    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = EXECUTION_LOG_ID;
    run.scheduleGapRetryCount = 0;

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockResolvedValue(run);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    // The rule pages one schedule, and nobody named on it directly.
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([
        { onCallDutyPolicyScheduleId: SCHEDULE_ID },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockResolvedValue({ userId: ON_CALL, coveredUserId: null });
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockResolvedValue(null);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLogTimeline;
      }): Promise<OnCallDutyPolicyExecutionLogTimeline> => {
        data.data.id = ObjectID.generate();
        timeline.push(data.data);
        return data.data;
      }) as never);
  });

  test("REGRESSION: the person on call in the policy's schedule is paged and added to the incident's channel", async () => {
    await runEscalationRule({ incidentId: INCIDENT_ID });

    // Paged...
    expect(
      timeline.map(
        (step: OnCallDutyPolicyExecutionLogTimeline): string | undefined => {
          return step.alertSentToUserId?.toString();
        },
      ),
    ).toEqual([ON_CALL.toString()]);

    // ... and added to the channel the incident's rule created.
    expect(slack.invites()).toEqual([{ channel: "C0INC9", users: "U0ONCALL" }]);
    expect(inviteRows()[0]!.incidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  test("an alert's policy: the person on call is added to the alert's channel", async () => {
    storedRules = [alertRule(RULE_ID, REPORTED_RULE)];

    await runEscalationRule({ alertId: ALERT_ID });

    expect(slack.invites()).toEqual([{ channel: "C0AL12", users: "U0ONCALL" }]);
    expect(inviteRows()[0]!.alertId?.toString()).toBe(ALERT_ID.toString());
  });

  test("the rule invites owners only: the person on call is paged, and not added to the channel", async () => {
    storedRules = [
      incidentRule(RULE_ID, { inviteOwners: true, inviteOnCallUsers: false }),
    ];

    await runEscalationRule({ incidentId: INCIDENT_ID });

    expect(timeline).toHaveLength(1);
    expect(slack.invites()).toEqual([]);
  });
});
