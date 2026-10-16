import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "../../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerTeam from "../../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import OnCallDutyPolicyOwnerTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import ScheduledMaintenanceOwnerTeam from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOwnerTeamService from "../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOwnerTeamService from "../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyOwnerTeamService from "../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceOwnerTeamService from "../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import CreateChannelNotificationRule from "../../../Types/Workspace/NotificationRules/CreateChannelNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelNameParts } from "../../../Utils/Workspace/WorkspaceChannelName";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
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
 * WHO WAS ADDED TO A RECORD'S CHANNEL IS LISTED ON THE RECORD.
 *
 * A record's Notification Logs > Workspace tab lists the workspace logs that
 * carry the record's id: { incidentId } on an incident's, { monitorId } on a
 * monitor's. Only an on-call page's invite named its record. An owner added
 * to an incident, an alert, a scheduled maintenance, a monitor, an on-call
 * policy or an episode - a user, a team, an incident member - was invited to
 * the record's channels and logged against no record, and the people a rule
 * invites to the channel it creates were not logged at all: the tab showed
 * the channel created and its messages, and nobody added to it.
 *
 * Here every owner service adds an owner as its onCreateSuccess does, and a
 * record's channels are set up as createChannelsAndInviteUsersToChannelsBasedOnRules
 * sets them up, through the real invite paths and the real logInviteUser, to
 * the log rows written. Only the workspace, the database and the record's
 * feed are faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000002");
const TEAM_ID: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000003");

// Made an owner, or invited by the rule: connected to Slack.
const OWNER: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000011");
// The owner team's member, connected to Slack.
const TEAMMATE: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000012");
// Invited by the rule, with no Slack account connected.
const NOT_CONNECTED: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000013",
);

const SLACK_USER_IDS: Dictionary<string> = {
  [OWNER.toString()]: "U0OWNER",
  [TEAMMATE.toString()]: "U0TEAMMATE",
};

// The channel OneUptime created for the record.
const RECORD_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0REC1",
  name: "record-1",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: RULE_ID.toString(),
};

const LINK: URL = URL.fromString("https://oneuptime.example/record/1");

type RecordField = keyof NotificationFor;

const RECORD_FIELDS: Array<RecordField> = [
  "incidentId",
  "alertId",
  "scheduledMaintenanceId",
  "onCallDutyPolicyId",
  "monitorId",
  "incidentEpisodeId",
  "alertEpisodeId",
];

interface OwnerServiceCase {
  service: string;
  // The record the owner is added to, as its Notification Logs page reads it.
  field: RecordField;
  // Who is invited: the owner, or the owner team's people.
  owner: "user" | "team";
  addOwner: (recordId: ObjectID) => Promise<void>;
}

function created<TModel extends DatabaseBaseModel>(
  item: TModel,
): OnCreate<TModel> {
  return {
    createBy: { data: item, props: { isRoot: true } },
    carryForward: null,
  };
}

const OWNER_SERVICES: Array<OwnerServiceCase> = [
  {
    service: "IncidentOwnerUserService",
    field: "incidentId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: IncidentOwnerUser = new IncidentOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.incidentId = recordId;
      owner.userId = OWNER;
      await IncidentOwnerUserService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "IncidentOwnerTeamService",
    field: "incidentId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: IncidentOwnerTeam = new IncidentOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.incidentId = recordId;
      owner.teamId = TEAM_ID;
      await IncidentOwnerTeamService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "IncidentMemberService",
    field: "incidentId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const member: IncidentMember = new IncidentMember();
      member.projectId = PROJECT_ID;
      member.incidentId = recordId;
      member.userId = OWNER;
      await IncidentMemberService.onCreateSuccess(created(member), member);
    },
  },
  {
    service: "AlertOwnerUserService",
    field: "alertId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: AlertOwnerUser = new AlertOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.alertId = recordId;
      owner.userId = OWNER;
      await AlertOwnerUserService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "AlertOwnerTeamService",
    field: "alertId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: AlertOwnerTeam = new AlertOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.alertId = recordId;
      owner.teamId = TEAM_ID;
      await AlertOwnerTeamService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "ScheduledMaintenanceOwnerUserService",
    field: "scheduledMaintenanceId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: ScheduledMaintenanceOwnerUser =
        new ScheduledMaintenanceOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.scheduledMaintenanceId = recordId;
      owner.userId = OWNER;
      await ScheduledMaintenanceOwnerUserService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "ScheduledMaintenanceOwnerTeamService",
    field: "scheduledMaintenanceId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: ScheduledMaintenanceOwnerTeam =
        new ScheduledMaintenanceOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.scheduledMaintenanceId = recordId;
      owner.teamId = TEAM_ID;
      await ScheduledMaintenanceOwnerTeamService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "MonitorOwnerUserService",
    field: "monitorId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: MonitorOwnerUser = new MonitorOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.monitorId = recordId;
      owner.userId = OWNER;
      await MonitorOwnerUserService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "MonitorOwnerTeamService",
    field: "monitorId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: MonitorOwnerTeam = new MonitorOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.monitorId = recordId;
      owner.teamId = TEAM_ID;
      await MonitorOwnerTeamService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "OnCallDutyPolicyOwnerUserService",
    field: "onCallDutyPolicyId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: OnCallDutyPolicyOwnerUser = new OnCallDutyPolicyOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.onCallDutyPolicyId = recordId;
      owner.userId = OWNER;
      await OnCallDutyPolicyOwnerUserService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "OnCallDutyPolicyOwnerTeamService",
    field: "onCallDutyPolicyId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: OnCallDutyPolicyOwnerTeam = new OnCallDutyPolicyOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.onCallDutyPolicyId = recordId;
      owner.teamId = TEAM_ID;
      await OnCallDutyPolicyOwnerTeamService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "IncidentEpisodeOwnerUserService",
    field: "incidentEpisodeId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: IncidentEpisodeOwnerUser = new IncidentEpisodeOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.incidentEpisodeId = recordId;
      owner.userId = OWNER;
      await IncidentEpisodeOwnerUserService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "IncidentEpisodeOwnerTeamService",
    field: "incidentEpisodeId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: IncidentEpisodeOwnerTeam = new IncidentEpisodeOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.incidentEpisodeId = recordId;
      owner.teamId = TEAM_ID;
      await IncidentEpisodeOwnerTeamService.onCreateSuccess(
        created(owner),
        owner,
      );
    },
  },
  {
    service: "AlertEpisodeOwnerUserService",
    field: "alertEpisodeId",
    owner: "user",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: AlertEpisodeOwnerUser = new AlertEpisodeOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.alertEpisodeId = recordId;
      owner.userId = OWNER;
      await AlertEpisodeOwnerUserService.onCreateSuccess(created(owner), owner);
    },
  },
  {
    service: "AlertEpisodeOwnerTeamService",
    field: "alertEpisodeId",
    owner: "team",
    addOwner: async (recordId: ObjectID): Promise<void> => {
      const owner: AlertEpisodeOwnerTeam = new AlertEpisodeOwnerTeam();
      owner.projectId = PROJECT_ID;
      owner.alertEpisodeId = recordId;
      owner.teamId = TEAM_ID;
      await AlertEpisodeOwnerTeamService.onCreateSuccess(created(owner), owner);
    },
  },
];

// Every kind of record a rule creates channels for.
/*
 * What follows the rules' prefix, record-: the channel is record-1 for every
 * kind of record (the parts the record kinds' WorkspaceMessages hand in).
 */
const RECORD_CHANNEL_NAME_PARTS: WorkspaceChannelNameParts = {
  afterPrefix: "1",
  ownName: "record-1",
};

const CHANNEL_RECORDS: Array<{
  field: RecordField;
  eventType: NotificationRuleEventType;
}> = [
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

let logRows: Array<WorkspaceNotificationLog>;
let invite: Mock<(data: unknown) => Promise<void>>;
let inviteUsersSpy: SpyInstance<
  typeof WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels
>;
let inviteTeamsSpy: SpyInstance<
  typeof WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels
>;

// An owner service starts the invite and does not wait for it.
let started: Array<Promise<void>>;

function track(step: Promise<void>): Promise<void> {
  started.push(
    step.catch((): void => {
      return undefined;
    }),
  );
  return step;
}

async function invitesDone(): Promise<void> {
  await Promise.all(started);
}

// The rule that creates the record's channel.
function slackRule(): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = RULE_ID;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Slack;

  const notificationRule: CreateChannelNotificationRule = {
    _type: "CreateChannelNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    newChannelTemplateName: "record-",
    inviteUsersToNewChannel: [OWNER, NOT_CONNECTED],
    inviteTeamsToNewChannel: [TEAM_ID],
    shouldInviteOwnersToNewChannel: true,
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

function userModel(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  return user;
}

function inviteRows(): Array<WorkspaceNotificationLog> {
  return logRows.filter((row: WorkspaceNotificationLog): boolean => {
    return row.actionType === WorkspaceNotificationActionType.InviteUser;
  });
}

// The record each row names, by the column its Notification Logs page reads.
function recordOf(
  row: WorkspaceNotificationLog,
  field: RecordField,
): string | undefined {
  return row.getColumnValue(field)?.toString();
}

beforeEach(() => {
  logRows = [];
  started = [];

  // The workspace: the project's Slack, who is connected to it, the invite.
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(
      async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds.map((userId: ObjectID | string): string => {
            return userId.toString();
          }),
        );
      },
    );

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
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockResolvedValue([userModel(TEAMMATE)]);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockResolvedValue(slackProjectAuth());
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue([slackProjectAuth()]);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getWorkspaceUserIdFromOneUptimeUserId",
    )
    .mockImplementation(
      async (data: { oneuptimeUserId: ObjectID }): Promise<string | null> => {
        return SLACK_USER_IDS[data.oneuptimeUserId.toString()] || null;
      },
    );

  invite = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    inviteUsersToChannels: invite,
  } as never);

  jest
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

  /*
   * The rule invites owners and the people given an incident role (an
   * incident member's invite reads the roles' switch), and its channel is
   * the record's.
   */
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteOwnersIsTrue",
    )
    .mockResolvedValue([slackRule()]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getNotificationRulesWhereInviteRolesIsTrue",
    )
    .mockResolvedValue([slackRule()]);
  jest
    .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
    .mockResolvedValue([slackRule()]);
  jest
    .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
    .mockResolvedValue([RECORD_CHANNEL]);

  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockResolvedValue([RECORD_CHANNEL]);
  jest
    .spyOn(AlertService, "getWorkspaceChannelForAlert")
    .mockResolvedValue([RECORD_CHANNEL]);
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getWorkspaceChannelForScheduledMaintenance",
    )
    .mockResolvedValue([RECORD_CHANNEL]);
  jest
    .spyOn(MonitorService, "getWorkspaceChannelForMonitor")
    .mockResolvedValue([RECORD_CHANNEL]);
  jest
    .spyOn(OnCallDutyPolicyService, "getWorkspaceChannelForOnCallDutyPolicy")
    .mockResolvedValue([RECORD_CHANNEL]);

  const incidentEpisode: IncidentEpisode = new IncidentEpisode();
  incidentEpisode.postUpdatesToWorkspaceChannels = [RECORD_CHANNEL];
  jest
    .spyOn(IncidentEpisodeService, "findOneById")
    .mockResolvedValue(incidentEpisode);

  const alertEpisode: AlertEpisode = new AlertEpisode();
  alertEpisode.postUpdatesToWorkspaceChannels = [RECORD_CHANNEL];
  jest
    .spyOn(AlertEpisodeService, "findOneById")
    .mockResolvedValue(alertEpisode);

  // The record's feed, which says who was added.
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Jane Doe`);
  jest.spyOn(UserService, "findOneById").mockResolvedValue(null);
  jest.spyOn(TeamService, "findOneById").mockResolvedValue(null);

  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 1,
    numberWithPrefix: "INC-1",
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(LINK);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined);

  jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockResolvedValue(undefined);

  jest.spyOn(MonitorService, "getMonitorName").mockResolvedValue("API");
  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(LINK);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Primary");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(LINK);
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined);

  jest.spyOn(IncidentEpisodeService, "getEpisodeNumber").mockResolvedValue({
    number: 1,
    numberWithPrefix: "IE-1",
  });
  jest
    .spyOn(IncidentEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(LINK);
  jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockResolvedValue(undefined);

  jest.spyOn(AlertEpisodeService, "getEpisodeNumber").mockResolvedValue({
    number: 1,
    numberWithPrefix: "AE-1",
  });
  jest
    .spyOn(AlertEpisodeService, "getEpisodeLinkInDashboard")
    .mockResolvedValue(LINK);
  jest
    .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
    .mockResolvedValue(undefined);

  // The invite paths themselves are real.
  const inviteUsers: typeof WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels =
    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels.bind(
      WorkspaceNotificationRuleService,
    );
  const inviteTeams: typeof WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels =
    WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels.bind(
      WorkspaceNotificationRuleService,
    );

  inviteUsersSpy = jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockImplementation(
      (data: Parameters<typeof inviteUsers>[0]): Promise<void> => {
        return track(inviteUsers(data));
      },
    );
  inviteTeamsSpy = jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteTeamsBasedOnRulesAndWorkspaceChannels",
    )
    .mockImplementation(
      (data: Parameters<typeof inviteTeams>[0]): Promise<void> => {
        return track(inviteTeams(data));
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an owner added to a record is listed on the record's Notification Logs", () => {
  test.each(OWNER_SERVICES)(
    "$service hands the invite the record the owner was added to ($field)",
    async (ownerCase: OwnerServiceCase) => {
      const recordId: ObjectID = ObjectID.generate();

      await ownerCase.addOwner(recordId);
      await invitesDone();

      if (ownerCase.owner === "user") {
        expect(inviteUsersSpy).toHaveBeenCalledTimes(1);
        expect(inviteUsersSpy.mock.calls[0]![0]).toMatchObject({
          userIds: [OWNER],
          notificationFor: { [ownerCase.field]: recordId },
        });
        expect(inviteTeamsSpy).not.toHaveBeenCalled();
      } else {
        expect(inviteTeamsSpy).toHaveBeenCalledTimes(1);
        expect(inviteTeamsSpy.mock.calls[0]![0]).toMatchObject({
          teamIds: [TEAM_ID],
          notificationFor: { [ownerCase.field]: recordId },
        });

        // The team's people are invited with the record as well.
        expect(inviteUsersSpy).toHaveBeenCalledTimes(1);
        expect(inviteUsersSpy.mock.calls[0]![0]).toMatchObject({
          userIds: [TEAMMATE],
          notificationFor: { [ownerCase.field]: recordId },
        });
      }

      // The record the owner was added to, and no other.
      expect(inviteUsersSpy.mock.calls[0]![0].notificationFor).toEqual({
        [ownerCase.field]: recordId,
      });
    },
  );

  test.each(OWNER_SERVICES)(
    "REGRESSION: $service - the invite is logged against the $field, which the record's Workspace tab reads",
    async (ownerCase: OwnerServiceCase) => {
      const recordId: ObjectID = ObjectID.generate();

      await ownerCase.addOwner(recordId);
      await invitesDone();

      const rows: Array<WorkspaceNotificationLog> = inviteRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId?.toString()).toBe(
        (ownerCase.owner === "user" ? OWNER : TEAMMATE).toString(),
      );
      expect(rows[0]!.channelId).toBe("C0REC1");
      expect(rows[0]!.channelName).toBe("record-1");
      expect(recordOf(rows[0]!, ownerCase.field)).toBe(recordId.toString());

      // Only on the record the owner was added to.
      for (const field of RECORD_FIELDS) {
        if (field !== ownerCase.field) {
          expect(recordOf(rows[0]!, field)).toBeUndefined();
        }
      }
    },
  );

  test("an invite the workspace refuses logs nobody as invited", async () => {
    invite.mockRejectedValue(new Error("Error from Slack is_archived"));

    await OWNER_SERVICES[0]!.addOwner(ObjectID.generate());
    await invitesDone();

    expect(invite).toHaveBeenCalledTimes(1);
    expect(inviteRows()).toEqual([]);
  });
});

describe("the people a rule invites to the channel it creates for a record are listed on the record's Notification Logs", () => {
  test.each(CHANNEL_RECORDS)(
    "REGRESSION: the channel created for the $field logs everybody it added, against the record",
    async (record: {
      field: RecordField;
      eventType: NotificationRuleEventType;
    }) => {
      const recordId: ObjectID = ObjectID.generate();

      await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: PROJECT_ID,
          notificationRuleEventType: record.eventType,
          notificationFor: { [record.field]: recordId },
          channelNameParts: RECORD_CHANNEL_NAME_PARTS,
        },
      );

      // The rule's user and its team's member - not the person not connected.
      expect(invite).toHaveBeenCalledTimes(1);
      expect(invite.mock.calls[0]![0]).toMatchObject({
        workspaceChannelInvitationPayload: {
          channelNames: ["record-1"],
          workspaceUserIds: ["U0OWNER", "U0TEAMMATE"],
        },
      });

      const rows: Array<WorkspaceNotificationLog> = inviteRows();

      expect(
        rows
          .map((row: WorkspaceNotificationLog): string => {
            return row.userId!.toString();
          })
          .sort(),
      ).toEqual([OWNER.toString(), TEAMMATE.toString()].sort());

      for (const row of rows) {
        expect(row.workspaceType).toBe(WorkspaceType.Slack);
        expect(row.channelId).toBe("C0REC1");
        expect(recordOf(row, record.field)).toBe(recordId.toString());
      }
    },
  );

  test("an invite the workspace refuses logs nobody as invited, and the channel is still set up", async () => {
    invite.mockRejectedValue(new Error("Error from Slack ratelimited"));

    await expect(
      WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: PROJECT_ID,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: ObjectID.generate() },
          channelNameParts: RECORD_CHANNEL_NAME_PARTS,
        },
      ),
    ).resolves.toMatchObject({ channelsCreated: [RECORD_CHANNEL] });

    expect(inviteRows()).toEqual([]);
  });
});

describe("WorkspaceNotificationLogService.logInviteUser", () => {
  test.each(RECORD_FIELDS)(
    "writes the %s it is given onto the invite's row",
    async (field: RecordField) => {
      const recordId: ObjectID = ObjectID.generate();

      const invited: Parameters<
        typeof WorkspaceNotificationLogService.logInviteUser
      >[0] = {
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelId: "C0REC1",
        channelName: "record-1",
        userId: OWNER,
      };
      invited[field] = recordId;

      await WorkspaceNotificationLogService.logInviteUser(invited, {
        isRoot: true,
      });

      expect(logRows).toHaveLength(1);
      expect(logRows[0]!.actionType).toBe(
        WorkspaceNotificationActionType.InviteUser,
      );
      expect(logRows[0]!.userId?.toString()).toBe(OWNER.toString());
      expect(recordOf(logRows[0]!, field)).toBe(recordId.toString());
    },
  );
});
