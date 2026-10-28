import { jest } from "@jest/globals";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import { AlertFeedEventType } from "../../../../../Models/DatabaseModels/AlertFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import WorkspaceNotificationRule from "../../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertStateService from "../../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../../Server/Services/AlertStateTimelineService";
import IncidentAlertService from "../../../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyEscalationRuleService, {
  AwayOverride,
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  OnCallRuleExecutionOutcome,
} from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService, {
  OnCallDirectPageRun,
  OnCallDirectPageStartedBy,
} from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
} from "../../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceFeedService from "../../../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import ProjectMembership from "../../../../../Server/Utils/TeamMember/ProjectMembership";
import AIIncidentPostmortemRunner from "../../../../../Server/Utils/AI/SRE/IncidentPostmortemRunner";
import InvestigationGrader from "../../../../../Server/Utils/AI/SRE/InvestigationGrader";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../../../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceStateChangePosting from "../../../../../Server/Utils/Workspace/WorkspaceStateChangePosting";
import AlertWorkspaceMessages from "../../../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import ScheduledMaintenanceWorkspaceMessages from "../../../../../Server/Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import URL from "../../../../../Types/API/URL";
import { Red500 } from "../../../../../Types/BrandColors";
import Email from "../../../../../Types/Email";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { OnCallDirectPageTargets } from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "../../../../../Types/OnCallDutyPolicy/NextInRotation";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  getOnCallPolicyRunRecordHandledMessage,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { getOnCallEmptyLevelTimelineMessage } from "../../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallEscalationAdvance from "../../../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../../../Types/UserNotification/UserNotificationStatus";
import NotificationRuleEventType from "../../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import { idsOfAnyFilter } from "../../../TestingUtils/Services/ProjectStatesHelper";
import InMemoryLiveMessages from "./InMemoryLiveMessages";

/*
 * THE INCIDENT, ALERT AND MAINTENANCE EVENT OF THE MAINTAINER'S SCREENSHOTS,
 * DRIVEN THROUGH ONEUPTIME'S REAL SERVICES AND WORKSPACE LAYER.
 *
 * Everything between an event in OneUptime and an HTTP request to Slack or
 * to the Bot Connector is the real code: the feed services, the state
 * timelines' and the on-call services' hooks, WorkspaceNotificationRuleService,
 * the live messages, SlackUtil and MicrosoftTeamsUtil. Only the database is
 * in memory here - the records, the on-call run, its timeline and its
 * deliveries, the workspace rows - and each suite plugs in the far end: a
 * fake Slack API or a fake Bot Connector, which record every request.
 *
 * The on-call run is the one in the screenshots: PolicyX, escalation rules
 * "fhirst" (Nitin, schedule Primary cover), "second" (NB User 3 on schedule
 * sec, and Nitin) and "third" (NB User 2, who is not a member of the
 * project), repeated once. NB User 3 has not connected a Slack account.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000001",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000002",
);
export const ALERT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000003",
);
export const MAINTENANCE_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000004",
);
export const POLICY_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000005",
);
export const RULE_FHIRST: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000011",
);
export const RULE_SECOND: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000012",
);
export const RULE_THIRD: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000013",
);
export const NITIN: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000021",
);
export const NB_USER_3: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000022",
);
export const NB_USER_2: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000023",
);
export const JANE: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000024",
);
export const PRIMARY_COVER: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000031",
);
export const SEC: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000032",
);
export const WORKSPACE_RULE_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000041",
);
// The teams and the workflow of a direct page (startDirectPage).
export const TEAM_PLATFORM: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000061",
);
export const TEAM_NOBODY_JOINED: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000062",
);
export const PAGING_WORKFLOW_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000071",
);
export const PAGING_WORKFLOW_NAME: string = "Page the on-call engineer";

export const DASHBOARD: string = "https://oneuptime.test/dashboard";

// When the screenshots' incident was declared: 5:15 PM UTC, 8 October 2026.
export const SCREENSHOT_START: string = "2026-10-08T17:15:00.000Z";

const MINUTE_IN_MS: number = 60_000;

export const STATE_IDENTIFIED: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000051",
);
export const STATE_ACKNOWLEDGED: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000052",
);
export const STATE_RESOLVED: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000000053",
);

const NAMES: Record<string, string> = {
  [NITIN.toString()]: "Nitin",
  [NB_USER_3.toString()]: "NB User 3",
  [NB_USER_2.toString()]: "NB User 2",
  [JANE.toString()]: "Jane Doe",
};

// Who has connected a workspace account: their user id there.
const CONNECTED: Record<string, string> = {
  [NITIN.toString()]: "U0NITIN",
  [JANE.toString()]: "U0JANE",
};

/*
 * Who OneUptime pages on each escalation rule, and how it comes out. A page
 * can be to the next person in the schedule's rotation (isNextInRotation),
 * and a schedule can have somebody on call but nobody next (nobodyNext).
 */
type Target =
  | {
      kind: "page";
      userId: ObjectID;
      scheduleId?: ObjectID | undefined;
      isNextInRotation?: boolean | undefined;
    }
  | { kind: "notMember"; userId: ObjectID }
  | { kind: "gap"; scheduleId: ObjectID }
  | { kind: "nobodyNext"; scheduleId: ObjectID };

export interface RuleScript {
  id: ObjectID;
  order: number;
  name: string;
  escalateAfterInMinutes: number;
  targets: Array<Target>;
}

export const SCREENSHOT_RULES: Array<RuleScript> = [
  {
    id: RULE_FHIRST,
    order: 1,
    name: "fhirst",
    escalateAfterInMinutes: 6,
    targets: [{ kind: "page", userId: NITIN, scheduleId: PRIMARY_COVER }],
  },
  {
    id: RULE_SECOND,
    order: 2,
    name: "second",
    escalateAfterInMinutes: 7,
    targets: [
      { kind: "page", userId: NB_USER_3, scheduleId: SEC },
      { kind: "page", userId: NITIN, scheduleId: PRIMARY_COVER },
    ],
  },
  {
    id: RULE_THIRD,
    order: 3,
    name: "third",
    escalateAfterInMinutes: 7,
    targets: [{ kind: "notMember", userId: NB_USER_2 }],
  },
];

const SCHEDULE_NAMES: Record<string, string> = {
  [PRIMARY_COVER.toString()]: "Primary cover",
  [SEC.toString()]: "sec",
};

const TEAM_NAMES: Record<string, string> = {
  [TEAM_PLATFORM.toString()]: "Platform",
  [TEAM_NOBODY_JOINED.toString()]: "Night Shift",
};

export interface WorkspaceChannels {
  slack?: NotificationRuleWorkspaceChannel | undefined;
  teams?: NotificationRuleWorkspaceChannel | undefined;
}

export interface FeedEntry {
  record: "incident" | "alert" | "maintenance";
  eventType: string;
  markdown: string;
  postsToWorkspace: boolean;
}

// White space in a name, for the email made from it.
const NAME_SPACE: RegExp = /\s/g;

// A copy of a model, as a read from the database hands one out.
function copyOf<T extends BaseModel>(model: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(model)) as T, model);
}

function user(userId: ObjectID): User {
  const model: User = new User();
  model.id = userId;
  model.name = (NAMES[userId.toString()] || "Someone") as never;
  model.email = new Email(
    `${(NAMES[userId.toString()] || "someone").replace(NAME_SPACE, ".").toLowerCase()}@example.com`,
  );
  return model;
}

export default class QuietChannelsWorld {
  public readonly workspaces: Array<WorkspaceType>;
  public readonly channels: WorkspaceChannels;
  public readonly liveMessages: InMemoryLiveMessages =
    new InMemoryLiveMessages();
  public feed: Array<FeedEntry> = [];

  // Invites, as the workspace util was asked for them.
  public invites: Array<{
    channelNames: Array<string>;
    userIds: Array<string>;
  }> = [];

  /*
   * Who the new channel's setup could not add, until the record's created
   * message is out: the record's service notes them right after it.
   */
  public membersNotAddedToNewChannels: Array<ChannelMembersNotAdded> = [];

  // The on-call run, its steps and its deliveries.
  public run: OnCallDutyPolicyExecutionLog | null = null;
  public steps: Array<OnCallDutyPolicyExecutionLogTimeline> = [];
  public deliveries: Array<UserOnCallLogTimeline> = [];
  public rules: Array<RuleScript> = SCREENSHOT_RULES;
  public repeatsAllowed: number = 1;

  /*
   * Whether a level of the pass the run is in - its levels once round -
   * paged anybody, and whether any level of the run ever did: a level that
   * pages nobody is passed at once, and a pass that paged nobody is not
   * gone round again (OnCallEscalationAdvance).
   */
  private hasPassPagedAnybody: boolean = false;
  private hasRunPagedAnybody: boolean = false;

  /*
   * The run's clock, as the screenshots ran: the incident at 5:15 PM UTC on
   * Thursday 8 October, and each escalation when the rule before it has
   * waited its minutes (5:21, 5:28, 5:35 ...). The run's message names
   * when its next step comes from it ("by 5:28 PM"), so it is the world's
   * own, never the real clock.
   */
  public clock: Date = new Date(SCREENSHOT_START);

  // The record the run pages for, and its state.
  public runFor: "incident" | "alert" = "incident";
  public recordAcknowledged: boolean = false;
  public recordStateName: string = "Identified";
  /*
   * The record's title, when a suite reads it: a page from a chat shows it
   * where it was asked for (OnCallPolicyRunMessage's page request places).
   */
  public recordTitle: string | undefined = undefined;

  // The people in the project, and the rule's people for a new channel.
  public members: Set<string> = new Set<string>([
    NITIN.toString(),
    NB_USER_3.toString(),
    JANE.toString(),
  ]);

  /*
   * What a direct page - people, a team or a schedule paged with no policy
   * (startDirectPage) - finds when it looks: who has joined each team, who
   * is on call in each schedule right now, and who is away (with somebody
   * covering, or nobody). And how many of its pages are still going out,
   * for the worker's tick that ends it (directPagePagesAreOver).
   */
  public teamMembers: Record<string, Array<ObjectID>> = {
    [TEAM_PLATFORM.toString()]: [NITIN, JANE],
    [TEAM_NOBODY_JOINED.toString()]: [],
  };
  public onCallNow: Record<string, ObjectID | null> = {
    [PRIMARY_COVER.toString()]: NITIN,
    [SEC.toString()]: null,
  };
  public away: Record<string, AwayOverride> = {};
  public pagesStillOut: number = 0;

  public constructor(data: {
    workspaces: Array<WorkspaceType>;
    channels: WorkspaceChannels;
  }) {
    this.workspaces = data.workspaces;
    this.channels = data.channels;
  }

  // Everything the services read from the database, in memory.
  public install(): void {
    this.liveMessages.install();

    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Redis client is not connected"));
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD));

    this.installWorkspaceRows();
    this.installPeople();
    this.installRecords();
    this.installFeeds();
    this.installOnCall();
  }

  private installWorkspaceRows(): void {
    const auth: (workspaceType: WorkspaceType) => WorkspaceProjectAuthToken = (
      workspaceType: WorkspaceType,
    ): WorkspaceProjectAuthToken => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.projectId = PROJECT_ID;
      token.workspaceType = workspaceType;
      token.authToken =
        workspaceType === WorkspaceType.Slack ? "xoxb-project" : "teams-token";
      token.workspaceProjectId =
        workspaceType === WorkspaceType.Slack
          ? "T0WORKSPACE"
          : "4111aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
      token.miscData = this.miscDataFor(workspaceType) as never;
      return token;
    };

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        return this.workspaces.includes(data.workspaceType)
          ? auth(data.workspaceType)
          : null;
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockImplementation((async (): Promise<
        Array<WorkspaceProjectAuthToken>
      > => {
        return this.workspaces.map(auth);
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async (data: {
        query: { workspaceType?: WorkspaceType };
      }): Promise<WorkspaceProjectAuthToken | null> => {
        const workspaceType: WorkspaceType | undefined =
          data.query.workspaceType;

        return workspaceType && this.workspaces.includes(workspaceType)
          ? auth(workspaceType)
          : null;
      }) as never);

    // Authors are named by their OneUptime name.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(null);

    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockImplementation((async (data: {
        oneuptimeUserId: ObjectID;
      }): Promise<string | null> => {
        return CONNECTED[data.oneuptimeUserId.toString()] || null;
      }) as never);

    // The rules match every record; the channels are the record's own.
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceNotificationRule>> => {
        return [this.workspaceRule(data.workspaceType)];
      }) as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: { data: unknown }) => {
        return data.data;
      }) as never);
    jest
      .spyOn(WorkspaceNotificationLogService, "logInviteUser")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(SlackUtil, "inviteUsersToChannels")
      .mockImplementation((async (data: {
        workspaceChannelInvitationPayload: {
          channelNames: Array<string>;
          workspaceUserIds: Array<string>;
        };
      }): Promise<void> => {
        this.invites.push({
          channelNames: data.workspaceChannelInvitationPayload.channelNames,
          userIds: data.workspaceChannelInvitationPayload.workspaceUserIds,
        });
      }) as never);

    const channelsFor: (
      workspaceType?: WorkspaceType | null,
    ) => Array<NotificationRuleWorkspaceChannel> = (
      workspaceType?: WorkspaceType | null,
    ): Array<NotificationRuleWorkspaceChannel> => {
      return [this.channels.slack, this.channels.teams].filter(
        (
          channel: NotificationRuleWorkspaceChannel | undefined,
        ): channel is NotificationRuleWorkspaceChannel => {
          return (
            Boolean(channel) &&
            (!workspaceType || channel!.workspaceType === workspaceType)
          );
        },
      );
    };

    jest
      .spyOn(IncidentService, "getWorkspaceChannelForIncident")
      .mockImplementation((async (data: {
        workspaceType?: WorkspaceType | null;
      }) => {
        return channelsFor(data.workspaceType);
      }) as never);
    jest
      .spyOn(AlertService, "getWorkspaceChannelForAlert")
      .mockImplementation((async (data: {
        workspaceType?: WorkspaceType | null;
      }) => {
        return channelsFor(data.workspaceType);
      }) as never);
    jest
      .spyOn(
        ScheduledMaintenanceService,
        "getWorkspaceChannelForScheduledMaintenance",
      )
      .mockImplementation((async (data: {
        workspaceType?: WorkspaceType | null;
      }) => {
        return channelsFor(data.workspaceType);
      }) as never);
  }

  // A rule that creates a channel for the record, and no other place.
  public workspaceRule(
    workspaceType: WorkspaceType,
  ): WorkspaceNotificationRule {
    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.id = WORKSPACE_RULE_ID;
    rule.projectId = PROJECT_ID;
    rule.workspaceType = workspaceType;
    rule.eventType = NotificationRuleEventType.Incident;
    rule.notificationRule = {
      _type: "IncidentNotificationRule",
      filterCondition: "All",
      filters: [],
      shouldPostToExistingChannel: false,
      existingChannelNames: "",
      shouldCreateNewChannel: true,
      newChannelTemplateName: "inc-",
      inviteUsersToNewChannel: [],
      inviteTeamsToNewChannel: [],
      shouldInviteOwnersToNewChannel: true,
      shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
    } as never;
    return rule;
  }

  private miscDataFor(workspaceType: WorkspaceType): JSONObject {
    if (workspaceType === WorkspaceType.Slack) {
      return { botUserId: "B0BOT", teamId: "T0WORKSPACE", teamName: "Ops" };
    }

    return {
      tenantId: "4111aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      teamId: this.channels.teams?.teamId,
      teamName: "Ops",
      botId: "28:oneuptime-bot",
      installedTeams: {
        [this.channels.teams?.teamId || "team"]: {
          id: this.channels.teams?.teamId || "team",
          graphTeamId: this.channels.teams?.teamId,
          name: "Ops",
          serviceUrl: "https://smba.trafficmanager.net/teams/",
        },
      },
      availableChats: {},
    };
  }

  private installPeople(): void {
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: {
        userId: ObjectID;
      }): Promise<MarkdownText> => {
        return mdText`${NAMES[data.userId?.toString()] || "Someone"}`;
      }) as never);

    jest.spyOn(UserService, "findBy").mockImplementation((async () => {
      return Object.keys(NAMES).map((id: string): User => {
        return user(new ObjectID(id));
      });
    }) as never);

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation((async (data: {
        userIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.userIds
            .map((id: ObjectID | string): string => {
              return id.toString();
            })
            .filter((id: string): boolean => {
              return this.members.has(id);
            }),
        );
      }) as never);
  }

  private installRecords(): void {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`,
        ),
      );
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 8,
      numberWithPrefix: "INC-8",
    });
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident.id = INCIDENT_ID;
        incident.projectId = PROJECT_ID;
        incident.incidentNumber = 8;
        incident.incidentNumberWithPrefix = "INC-8";

        if (this.recordTitle !== undefined) {
          incident.title = this.recordTitle;
        }

        const state: IncidentState = new IncidentState();
        state.name = this.recordStateName;
        incident.currentIncidentState = state;
        return incident;
      }) as never);
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockImplementation((async (): Promise<boolean> => {
        return this.recordAcknowledged;
      }) as never);

    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`,
        ),
      );
    jest.spyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 12,
      numberWithPrefix: "AL-12",
    });
    jest
      .spyOn(AlertService, "findOneById")
      .mockImplementation((async (): Promise<Alert> => {
        const alert: Alert = new Alert();
        alert.id = ALERT_ID;
        alert.projectId = PROJECT_ID;
        alert.alertNumber = 12;
        alert.alertNumberWithPrefix = "AL-12";

        if (this.recordTitle !== undefined) {
          alert.title = this.recordTitle;
        }

        const state: AlertState = new AlertState();
        state.name = this.recordStateName;
        alert.currentAlertState = state;
        return alert;
      }) as never);
    jest
      .spyOn(AlertService, "isAlertAcknowledged")
      .mockImplementation((async (): Promise<boolean> => {
        return this.recordAcknowledged;
      }) as never);

    jest
      .spyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      )
      .mockResolvedValue(
        URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/scheduled-maintenance-events/${MAINTENANCE_ID.toString()}`,
        ),
      );

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(
        URL.fromString(
          `${DASHBOARD}/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}`,
        ),
      );
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockImplementation((async (): Promise<OnCallDutyPolicy> => {
        return this.policy();
      }) as never);
  }

  // The feeds' own rows: recorded, with whether each goes to chat.
  private installFeeds(): void {
    jest.spyOn(IncidentFeedService, "create").mockImplementation((async (data: {
      data: { incidentFeedEventType: string; feedInfoInMarkdown: string };
    }) => {
      return data.data;
    }) as never);
    jest.spyOn(AlertFeedService, "create").mockImplementation((async (data: {
      data: unknown;
    }) => {
      return data.data;
    }) as never);
    jest
      .spyOn(ScheduledMaintenanceFeedService, "create")
      .mockImplementation((async (data: { data: unknown }) => {
        return data.data;
      }) as never);

    const record: (
      kind: FeedEntry["record"],
      real: (data: never) => Promise<void>,
    ) => (data: {
      feedInfoInMarkdown: string;
      workspaceNotification?: { sendWorkspaceNotification: boolean };
      incidentFeedEventType?: string;
      alertFeedEventType?: string;
      scheduledMaintenanceFeedEventType?: string;
    }) => Promise<void> = (
      kind: FeedEntry["record"],
      real: (data: never) => Promise<void>,
    ) => {
      return async (data: {
        feedInfoInMarkdown: string;
        workspaceNotification?: { sendWorkspaceNotification: boolean };
        incidentFeedEventType?: string;
        alertFeedEventType?: string;
        scheduledMaintenanceFeedEventType?: string;
      }): Promise<void> => {
        this.feed.push({
          record: kind,
          eventType:
            data.incidentFeedEventType ||
            data.alertFeedEventType ||
            data.scheduledMaintenanceFeedEventType ||
            "",
          markdown: data.feedInfoInMarkdown,
          postsToWorkspace: Boolean(
            data.workspaceNotification?.sendWorkspaceNotification,
          ),
        });

        // The real feed service: its own row (stubbed above), then chat.
        await real(data as never);
      };
    };

    const realIncidentFeed: (data: never) => Promise<void> =
      IncidentFeedService.createIncidentFeedItem.bind(IncidentFeedService);
    const realAlertFeed: (data: never) => Promise<void> =
      AlertFeedService.createAlertFeedItem.bind(AlertFeedService);
    const realMaintenanceFeed: (data: never) => Promise<void> =
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem.bind(
        ScheduledMaintenanceFeedService,
      );

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation(record("incident", realIncidentFeed) as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation(record("alert", realAlertFeed) as never);
    jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockImplementation(record("maintenance", realMaintenanceFeed) as never);
  }

  // ---- The on-call run, in memory, through the services' real hooks ----

  private policy(): OnCallDutyPolicy {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = POLICY_ID;
    policy.projectId = PROJECT_ID;
    policy.name = "PolicyX";
    // Repeats only count while "Repeat if no one acknowledges" is on.
    policy.repeatPolicyIfNoOneAcknowledges = this.repeatsAllowed > 0;
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = this.repeatsAllowed;
    return policy;
  }

  private ruleModel(script: RuleScript): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.id = script.id;
    rule.name = script.name;
    rule.order = script.order;
    rule.escalateAfterInMinutes = script.escalateAfterInMinutes;
    return rule;
  }

  private installOnCall(): void {
    const hook: (
      service: unknown,
      name: string,
    ) => (...args: Array<unknown>) => Promise<unknown> = (
      service: unknown,
      name: string,
    ) => {
      return (
        service as Record<string, (...args: Array<unknown>) => Promise<unknown>>
      )[name]!.bind(service);
    };

    // The run.
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
      .mockImplementation(
        (async (): Promise<OnCallDutyPolicyExecutionLog | null> => {
          if (!this.run) {
            return null;
          }

          const run: OnCallDutyPolicyExecutionLog = copyOf(this.run);

          // A direct page has no policy to read with it.
          if (run.onCallDutyPolicyId) {
            run.onCallDutyPolicy = this.policy();
          }

          if (run.acknowledgedByUserId) {
            run.acknowledgedByUser = user(run.acknowledgedByUserId);
          }

          if (run.triggeredByUserId) {
            run.triggeredByUser = user(run.triggeredByUserId);
          }

          return run;
        }) as never,
      );

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "updateOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
        data: Partial<OnCallDutyPolicyExecutionLog>;
      }): Promise<number> => {
        Object.assign(this.run!, data.data);

        await hook(OnCallDutyPolicyExecutionLogService, "onUpdateSuccess")(
          {
            updateBy: {
              query: { _id: data.id.toString() },
              data: data.data,
              props: { isRoot: true },
            },
            carryForward: null,
          },
          [data.id],
        );

        return 1;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockImplementation((async (): Promise<
        Array<OnCallDutyPolicyEscalationRule>
      > => {
        return this.rules.map((script: RuleScript) => {
          return this.ruleModel(script);
        });
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockImplementation((async (data: {
        query: { order?: number };
      }): Promise<OnCallDutyPolicyEscalationRule | null> => {
        const script: RuleScript | undefined = this.rules.find(
          (candidate: RuleScript): boolean => {
            return candidate.order === data.query.order;
          },
        );
        return script ? this.ruleModel(script) : null;
      }) as never);
    /*
     * A rule's steps, as OneUptime writes them, and whether the run moves
     * on from it at once: it paged nobody (OnCallEmptyLevel). The run's
     * start asks OnCallEscalationAdvance to move it on then, as OneUptime
     * does, once it has said the run is executing.
     */
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
      .mockImplementation((async (
        ruleId: ObjectID,
      ): Promise<OnCallRuleExecutionOutcome> => {
        const pagedNobody: boolean = await this.executeRule(ruleId);

        return {
          paged: [],
          notPaged: [],
          hadScheduleGap: false,
          movesOnAtOnce: pagedNobody,
        };
      }) as never);
    jest
      .spyOn(OnCallEscalationAdvance, "moveOnAtOnce")
      .mockImplementation((async (): Promise<null> => {
        await this.moveOnAtOnce();
        return null;
      }) as never);
    // The policy's levels, as a feed entry counts them for "Level 2 of 3".
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
      .mockImplementation((async () => {
        return new PositiveNumber(this.rules.length);
      }) as never);

    // Its steps.
    const stepWithRelations: (
      step: OnCallDutyPolicyExecutionLogTimeline,
    ) => OnCallDutyPolicyExecutionLogTimeline = (
      step: OnCallDutyPolicyExecutionLogTimeline,
    ): OnCallDutyPolicyExecutionLogTimeline => {
      const copy: OnCallDutyPolicyExecutionLogTimeline = copyOf(step);

      // A direct page's step names no policy.
      if (step.onCallDutyPolicyId) {
        copy.onCallDutyPolicy = this.policy();
      }

      if (step.alertSentToUserId) {
        copy.alertSentToUser = user(step.alertSentToUserId);
      }

      if (step.overridedByUserId) {
        copy.overridedByUser = user(step.overridedByUserId);
      }

      if (step.userBelongsToTeamId) {
        const team: Team = new Team();
        team.id = step.userBelongsToTeamId;
        team.name = TEAM_NAMES[step.userBelongsToTeamId.toString()]!;
        copy.userBelongsToTeam = team;
      }

      // The run the step belongs to: who started it, for a direct page's entry.
      if (this.run) {
        const run: OnCallDutyPolicyExecutionLog =
          new OnCallDutyPolicyExecutionLog();

        if (this.run.triggeredByWorkflowName) {
          run.triggeredByWorkflowName = this.run.triggeredByWorkflowName;
        }

        if (this.run.triggeredByUserId) {
          run.triggeredByUserId = this.run.triggeredByUserId;
        }

        copy.onCallDutyPolicyExecutionLog = run;
      }

      const script: RuleScript | undefined = this.rules.find(
        (candidate: RuleScript): boolean => {
          return (
            candidate.id.toString() ===
            step.onCallDutyPolicyEscalationRuleId?.toString()
          );
        },
      );

      if (script) {
        copy.onCallDutyPolicyEscalationRule = this.ruleModel(script);
      }

      if (step.onCallDutyScheduleId) {
        const schedule: OnCallDutyPolicySchedule =
          new OnCallDutyPolicySchedule();
        schedule.id = step.onCallDutyScheduleId;
        schedule.name = SCHEDULE_NAMES[step.onCallDutyScheduleId.toString()]!;
        copy.onCallDutySchedule = schedule;
      }

      return copy;
    };

    const stepsNamedBy: (query: {
      _id?: unknown;
      onCallDutyPolicyExecutionLogId?: unknown;
    }) => Array<OnCallDutyPolicyExecutionLogTimeline> = (query: {
      _id?: unknown;
      onCallDutyPolicyExecutionLogId?: unknown;
    }): Array<OnCallDutyPolicyExecutionLogTimeline> => {
      if (query._id) {
        return this.steps.filter(
          (step: OnCallDutyPolicyExecutionLogTimeline): boolean => {
            return step.id!.toString() === String(query._id);
          },
        );
      }

      return [...this.steps];
    };

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
      }): Promise<OnCallDutyPolicyExecutionLogTimeline | null> => {
        const step: OnCallDutyPolicyExecutionLogTimeline | undefined =
          this.steps.find(
            (candidate: OnCallDutyPolicyExecutionLogTimeline): boolean => {
              return candidate.id!.toString() === data.id.toString();
            },
          );
        return step ? stepWithRelations(step) : null;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findBy")
      .mockImplementation((async (data: {
        query: { _id?: unknown };
      }): Promise<Array<OnCallDutyPolicyExecutionLogTimeline>> => {
        return stepsNamedBy(data.query).map(stepWithRelations);
      }) as never);

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockImplementation((async (updateBy: {
        query: { _id?: unknown };
      }): Promise<Array<OnCallDutyPolicyExecutionLogTimeline>> => {
        return stepsNamedBy(updateBy.query).map(copyOf);
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLogTimeline;
      }): Promise<OnCallDutyPolicyExecutionLogTimeline> => {
        const step: OnCallDutyPolicyExecutionLogTimeline = data.data;
        step.id = ObjectID.generate();
        step.createdAt = new Date();
        this.steps.push(step);

        await hook(
          OnCallDutyPolicyExecutionLogTimelineService,
          "onCreateSuccess",
        )(
          {
            createBy: { data: step, props: { isRoot: true } },
            carryForward: null,
          },
          step,
        );

        return step;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockImplementation((async (data: {
        id: ObjectID;
        data: Partial<OnCallDutyPolicyExecutionLogTimeline>;
      }): Promise<number> => {
        const updateBy: {
          query: { _id: string };
          data: Partial<OnCallDutyPolicyExecutionLogTimeline>;
          props: { isRoot: boolean };
        } = {
          query: { _id: data.id.toString() },
          data: data.data,
          props: { isRoot: true },
        };

        const onUpdate: unknown = await hook(
          OnCallDutyPolicyExecutionLogTimelineService,
          "onBeforeUpdate",
        )(updateBy);

        const step: OnCallDutyPolicyExecutionLogTimeline | undefined =
          this.steps.find(
            (candidate: OnCallDutyPolicyExecutionLogTimeline): boolean => {
              return candidate.id!.toString() === data.id.toString();
            },
          );
        Object.assign(step!, data.data);

        await hook(
          OnCallDutyPolicyExecutionLogTimelineService,
          "onUpdateSuccess",
        )(onUpdate, [data.id]);

        return 1;
      }) as never);

    this.installDirectPages(hook);

    // How each page reached its person.
    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockImplementation((async (data: {
        query: { _id?: unknown; onCallDutyPolicyExecutionLogId?: unknown };
      }): Promise<Array<UserOnCallLogTimeline>> => {
        if (data.query._id) {
          const ids: Array<string> = idsOfAnyFilter(data.query._id);
          return this.deliveries.filter(
            (delivery: UserOnCallLogTimeline): boolean => {
              return ids.includes(delivery.id!.toString());
            },
          );
        }

        return [...this.deliveries];
      }) as never);
  }

  /*
   * A DIRECT PAGE, through OneUptime's real code: the run is created by the
   * execution log service's own startDirectPage and its create hooks, and
   * its people are found and paged by the escalation rule service's own
   * startDirectPage. Only what those read from the database is here - who
   * has joined a team, who is on call in a schedule, who is away - and the
   * far end of a page: a person's notification rules going out, as an SMS
   * and an email (as for a rule's page, executeRule).
   */
  private installDirectPages(
    hook: (
      service: unknown,
      name: string,
    ) => (...args: Array<unknown>) => Promise<unknown>,
  ): void {
    // The run's create: its real hooks, around a row kept here.
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation((async (createBy: {
        data: OnCallDutyPolicyExecutionLog;
        props: Record<string, unknown>;
      }): Promise<OnCallDutyPolicyExecutionLog> => {
        const onCreate: { createBy: { data: OnCallDutyPolicyExecutionLog } } =
          (await hook(
            OnCallDutyPolicyExecutionLogService,
            "onBeforeCreate",
          )(createBy)) as {
            createBy: { data: OnCallDutyPolicyExecutionLog };
          };

        await hook(
          OnCallDutyPolicyExecutionLogService,
          "onCreatePermitted",
        )(onCreate);

        const run: OnCallDutyPolicyExecutionLog = onCreate.createBy.data;
        run.id = ObjectID.generate();
        run.createdAt = new Date(this.clock);
        this.run = run;

        await hook(OnCallDutyPolicyExecutionLogService, "onCreateSuccess")(
          onCreate,
          run,
        );

        return run;
      }) as never);

    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
    ): Promise<Array<User>> => {
      return teamIds.flatMap((teamId: ObjectID): Array<User> => {
        return (this.teamMembers[teamId.toString()] || []).map(user);
      });
    }) as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockImplementation((async (
        scheduleId: ObjectID,
      ): Promise<CurrentOnCallInSchedule | null> => {
        const onCall: ObjectID | null | undefined =
          this.onCallNow[scheduleId.toString()];

        return onCall ? { userId: onCall, coveredUserId: null } : null;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
      .mockImplementation((async (data: {
        userId: ObjectID;
      }): Promise<AwayOverride | null> => {
        return this.away[data.userId.toString()] || null;
      }) as never);

    // A page going out: the person's notification rules, as for a rule's page.
    jest
      .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
      .mockImplementation((async (
        userId: ObjectID,
        options: {
          onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
        },
      ): Promise<void> => {
        await this.deliverPage(
          userId,
          options.onCallDutyPolicyExecutionLogTimelineId!,
        );
      }) as never);

    // The pages of the run that are still going out, as the worker counts them.
    jest
      .spyOn(UserOnCallLogService, "countBy")
      .mockImplementation((async () => {
        return new PositiveNumber(this.pagesStillOut);
      }) as never);
  }

  /*
   * One page reaching its person: an SMS and an email go out (each a
   * delivery written, then marked sent), and the page's step is marked
   * Notification Sent - once as the page goes out, and once more when the
   * person's notification rules have all run.
   */
  private async deliverPage(userId: ObjectID, stepId: ObjectID): Promise<void> {
    for (const method of ["userSmsId", "userEmailId"] as const) {
      const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
      delivery.id = ObjectID.generate();
      delivery.projectId = PROJECT_ID;
      delivery.userId = userId;
      delivery.onCallDutyPolicyExecutionLogId = this.run!.id!;
      delivery.status = UserNotificationStatus.Sending;
      delivery[method] = ObjectID.generate();
      this.deliveries.push(delivery);

      await (
        UserOnCallLogTimelineService as unknown as Record<
          string,
          (...args: Array<unknown>) => Promise<unknown>
        >
      )["onCreateSuccess"]!.call(
        UserOnCallLogTimelineService,
        {
          createBy: { data: delivery, props: { isRoot: true } },
          carryForward: null,
        },
        delivery,
      );

      delivery.status = UserNotificationStatus.Sent;

      await (
        UserOnCallLogTimelineService as unknown as Record<
          string,
          (...args: Array<unknown>) => Promise<unknown>
        >
      )["onUpdateSuccess"]!.call(
        UserOnCallLogTimelineService,
        {
          updateBy: {
            query: { _id: delivery.id.toString() },
            data: { status: UserNotificationStatus.Sent },
            props: { isRoot: true },
          },
          carryForward: null,
        },
        [delivery.id],
      );
    }

    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: stepId,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        statusMessage: "Alert Sent",
      },
      props: { isRoot: true },
    });

    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: stepId,
      data: {
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      },
      props: { isRoot: true },
    });
  }

  // ---- Driving the run ----

  /*
   * A direct page about the record: the people, teams and schedules it
   * names are paged at once, with no policy, as a workflow's Page steps
   * start one (OnCallPageService). Hands back what came of it.
   */
  public async startDirectPage(data: {
    targets: Partial<OnCallDirectPageTargets>;
    startedBy?: OnCallDirectPageStartedBy | undefined;
  }): Promise<OnCallDirectPageRun> {
    const started: OnCallDirectPageRun =
      await OnCallDutyPolicyExecutionLogService.startDirectPage({
        projectId: PROJECT_ID,
        targets: {
          userIds: data.targets.userIds || [],
          teamIds: data.targets.teamIds || [],
          onCallScheduleIds: data.targets.onCallScheduleIds || [],
        },
        ...(this.runFor === "incident"
          ? { triggeredByIncidentId: INCIDENT_ID }
          : { triggeredByAlertId: ALERT_ID }),
        startedBy: data.startedBy || {
          workflowId: PAGING_WORKFLOW_ID,
          workflowName: PAGING_WORKFLOW_NAME,
        },
      });

    await this.settle();

    return started;
  }

  /*
   * The worker's tick on a direct page nobody has answered, so many minutes
   * after its paging started: once it has waited for an acknowledgement
   * and every page has sent all it had to send, the run is over
   * (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions).
   */
  public async directPageTick(
    minutesAfterPagingStarted: number,
  ): Promise<boolean> {
    const pagingStartedAt: Date = new Date(
      this.run!.lastEscalationRuleExecutedAt || this.run!.createdAt!,
    );

    const ended: boolean =
      await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver({
        executionLogId: this.run!.id!,
        pagingStartedAt: pagingStartedAt,
        at: new Date(
          pagingStartedAt.getTime() + minutesAfterPagingStarted * MINUTE_IN_MS,
        ),
      });

    await this.settle();

    return ended;
  }

  // A run of PolicyX, created as OneUptime creates one, and its first rule.
  public async startRun(): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = ObjectID.generate();
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.status = OnCallDutyPolicyStatus.Scheduled;
    run.statusMessage = "Scheduled.";
    run.onCallPolicyExecutionRepeatCount = 1;
    run.createdAt = new Date(this.clock);

    if (this.runFor === "incident") {
      run.triggeredByIncidentId = INCIDENT_ID;
      run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    } else {
      run.triggeredByAlertId = ALERT_ID;
      run.userNotificationEventType = UserNotificationEventType.AlertCreated;
    }

    this.run = run;

    await (
      OnCallDutyPolicyExecutionLogService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >
    )["onCreateSuccess"]!.call(
      OnCallDutyPolicyExecutionLogService,
      { createBy: { data: run, props: { isRoot: true } }, carryForward: {} },
      run,
    );

    await this.settle();
  }

  // The worker's next tick: the next rule, a repeat, or the end of the run.
  public async escalate(): Promise<void> {
    const order: number = this.run!.lastExecutedEscalationRuleOrder || 0;

    // The tick comes once the rule the run is on has waited its minutes.
    const current: RuleScript | undefined = this.rules.find(
      (script: RuleScript): boolean => {
        return script.order === order;
      },
    );

    this.clock = new Date(
      this.clock.getTime() +
        (current?.escalateAfterInMinutes || 0) * MINUTE_IN_MS,
    );
    const next: RuleScript | undefined = this.rules.find(
      (script: RuleScript): boolean => {
        return script.order === order + 1;
      },
    );

    const pagedNobody: boolean = next
      ? (
          await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
            next.id,
            {} as never,
          )
        ).movesOnAtOnce
      : await this.afterTheLastRule();

    if (pagedNobody) {
      await this.moveOnAtOnce();
    }

    await this.settle();
  }

  /*
   * The rule the run is on paged nobody: the run moves on at once, on the
   * same clock - to the next rule, or after the last to a repeat or its
   * end - and on again from each rule that pages nobody too.
   */
  private async moveOnAtOnce(): Promise<void> {
    const order: number = this.run!.lastExecutedEscalationRuleOrder || 0;
    const next: RuleScript | undefined = this.rules.find(
      (script: RuleScript): boolean => {
        return script.order === order + 1;
      },
    );

    const pagedNobody: boolean = next
      ? await this.executeRule(next.id)
      : await this.afterTheLastRule();

    if (pagedNobody) {
      await this.moveOnAtOnce();
    }
  }

  /*
   * After the last rule: the policy starts again from its first while it
   * has repeats left - unless not one level of the pass paged anybody, which
   * going round again would only repeat - and otherwise the run ends: as
   * one that paged somebody, or as one that paged nobody at all. Says
   * whether the first rule, started again, paged nobody.
   */
  private async afterTheLastRule(): Promise<boolean> {
    if (
      this.hasPassPagedAnybody &&
      (this.run!.onCallPolicyExecutionRepeatCount || 1) <= this.repeatsAllowed
    ) {
      this.hasPassPagedAnybody = false;

      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: this.run!.id!,
        data: {
          onCallPolicyExecutionRepeatCount:
            (this.run!.onCallPolicyExecutionRepeatCount || 1) + 1,
        },
        props: { isRoot: true },
      });

      return await this.executeRule(this.rules[0]!.id);
    }

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: this.run!.id!,
      data: this.hasRunPagedAnybody
        ? {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
          }
        : {
            status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
            statusMessage: ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
          },
      props: { isRoot: true },
    });

    return false;
  }

  /*
   * The record is acknowledged or resolved some other way - in OneUptime, by
   * a button in the channel: the worker's next tick finds it so and ends
   * the run, as OnCallDutyPolicyExecutionLog:ExecutePendingExecutions does.
   */
  public async recordHandledElsewhere(stateName: string): Promise<void> {
    this.recordAcknowledged = true;
    this.recordStateName = stateName;

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: this.run!.id!,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunRecordHandledMessage(this.runFor),
      },
      props: { isRoot: true },
    });

    await this.settle();
  }

  /*
   * Somebody acknowledges their page: their step, then the run. Their step
   * is the page they were sent - not a line that says they were skipped,
   * which is no page to acknowledge.
   */
  public async acknowledge(userId: ObjectID): Promise<void> {
    const step: OnCallDutyPolicyExecutionLogTimeline | undefined = [
      ...this.steps,
    ]
      .reverse()
      .find((candidate: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return (
          candidate.alertSentToUserId?.toString() === userId.toString() &&
          candidate.status !== OnCallDutyExecutionLogTimelineStatus.Skipped
        );
      });

    this.recordAcknowledged = true;
    this.recordStateName = "Acknowledged";

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: this.run!.id!,
      data: {
        acknowledgedAt: new Date(),
        acknowledgedByUserId: userId,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: `Incident acknowledged by ${NAMES[userId.toString()]}`,
      },
      props: { isRoot: true },
    });

    await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
      id: step!.id!,
      data: {
        acknowledgedAt: new Date(),
        isAcknowledged: true,
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        statusMessage: `Incident acknowledged by ${NAMES[userId.toString()]}`,
      },
      props: { isRoot: true },
    });

    await this.settle();
  }

  /*
   * The steps one rule writes, as OneUptime writes them: the run moves to
   * the rule; each person is paged (a step Executing, then Notification
   * Sent, deliveries as they go out, and Notification Sent once more when
   * the person's notification rules have all run - the write that used to
   * post a second "Notification Sent to <person>"); a person who left is
   * skipped; a rule that paged nobody says so, in the words OneUptime uses
   * since such a rule is passed at once (OnCallEmptyLevel). Says whether it
   * paged nobody: the run then moves on from it at once.
   */
  private async executeRule(ruleId: ObjectID): Promise<boolean> {
    const script: RuleScript = this.rules.find(
      (candidate: RuleScript): boolean => {
        return candidate.id.toString() === ruleId.toString();
      },
    )!;

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: this.run!.id!,
      data: {
        lastEscalationRuleExecutedAt: new Date(this.clock),
        lastExecutedEscalationRuleId: script.id,
        lastExecutedEscalationRuleOrder: script.order,
        executeNextEscalationRuleInMinutes: script.escalateAfterInMinutes,
      },
      props: { isRoot: true },
    });

    let paged: number = 0;

    for (const target of script.targets) {
      const step: OnCallDutyPolicyExecutionLogTimeline =
        new OnCallDutyPolicyExecutionLogTimeline();
      step.projectId = PROJECT_ID;
      step.onCallDutyPolicyExecutionLogId = this.run!.id!;
      step.onCallDutyPolicyId = POLICY_ID;
      step.onCallDutyPolicyEscalationRuleId = script.id;
      if (this.run!.triggeredByIncidentId) {
        step.triggeredByIncidentId = this.run!.triggeredByIncidentId;
      }
      if (this.run!.triggeredByAlertId) {
        step.triggeredByAlertId = this.run!.triggeredByAlertId;
      }

      if (target.kind === "gap") {
        step.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        step.statusMessage =
          "Skipped because no active users are found in this schedule.";
        step.onCallDutyScheduleId = target.scheduleId;
        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: step,
          props: { isRoot: true },
        });
        continue;
      }

      if (target.kind === "notMember") {
        step.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        step.statusMessage = NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE;
        step.alertSentToUserId = target.userId;
        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: step,
          props: { isRoot: true },
        });
        continue;
      }

      // Somebody on call in the schedule, nobody next in its rotation.
      if (target.kind === "nobodyNext") {
        step.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        step.statusMessage = NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE;
        step.onCallDutyScheduleId = target.scheduleId;
        step.isNextInRotation = true;
        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: step,
          props: { isRoot: true },
        });
        continue;
      }

      paged++;
      step.status = OnCallDutyExecutionLogTimelineStatus.Executing;
      step.statusMessage = "Sending notification to user.";
      step.alertSentToUserId = target.userId;

      if (target.scheduleId) {
        step.onCallDutyScheduleId = target.scheduleId;
      }

      if (target.isNextInRotation) {
        step.isNextInRotation = true;
      }

      const created: OnCallDutyPolicyExecutionLogTimeline =
        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: step,
          props: { isRoot: true },
        });

      // The person's notification rules go out: an SMS and an email.
      for (const method of ["userSmsId", "userEmailId"] as const) {
        const delivery: UserOnCallLogTimeline = new UserOnCallLogTimeline();
        delivery.id = ObjectID.generate();
        delivery.projectId = PROJECT_ID;
        delivery.userId = target.userId;
        delivery.onCallDutyPolicyExecutionLogId = this.run!.id!;
        delivery.status = UserNotificationStatus.Sending;
        delivery[method] = ObjectID.generate();
        this.deliveries.push(delivery);

        await (
          UserOnCallLogTimelineService as unknown as Record<
            string,
            (...args: Array<unknown>) => Promise<unknown>
          >
        )["onCreateSuccess"]!.call(
          UserOnCallLogTimelineService,
          {
            createBy: { data: delivery, props: { isRoot: true } },
            carryForward: null,
          },
          delivery,
        );

        delivery.status = UserNotificationStatus.Sent;

        await (
          UserOnCallLogTimelineService as unknown as Record<
            string,
            (...args: Array<unknown>) => Promise<unknown>
          >
        )["onUpdateSuccess"]!.call(
          UserOnCallLogTimelineService,
          {
            updateBy: {
              query: { _id: delivery.id.toString() },
              data: { status: UserNotificationStatus.Sent },
              props: { isRoot: true },
            },
            carryForward: null,
          },
          [delivery.id],
        );
      }

      // The page is out ("Alert Sent")...
      await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
        id: created.id!,
        data: {
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
          statusMessage: "Alert Sent",
        },
        props: { isRoot: true },
      });

      // ... and the person's rules have all run: Notification Sent again.
      await OnCallDutyPolicyExecutionLogTimelineService.updateOneById({
        id: created.id!,
        data: {
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        },
        props: { isRoot: true },
      });
    }

    if (paged > 0) {
      this.hasPassPagedAnybody = true;
      this.hasRunPagedAnybody = true;
    }

    if (paged === 0) {
      const nobody: OnCallDutyPolicyExecutionLogTimeline =
        new OnCallDutyPolicyExecutionLogTimeline();
      nobody.projectId = PROJECT_ID;
      nobody.onCallDutyPolicyExecutionLogId = this.run!.id!;
      nobody.onCallDutyPolicyId = POLICY_ID;
      nobody.onCallDutyPolicyEscalationRuleId = script.id;
      if (this.run!.triggeredByIncidentId) {
        nobody.triggeredByIncidentId = this.run!.triggeredByIncidentId;
      }
      if (this.run!.triggeredByAlertId) {
        nobody.triggeredByAlertId = this.run!.triggeredByAlertId;
      }
      nobody.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
      nobody.statusMessage = getOnCallEmptyLevelTimelineMessage({
        namesAnybody: script.targets.length > 0,
      });

      await OnCallDutyPolicyExecutionLogTimelineService.create({
        data: nobody,
        props: { isRoot: true },
      });
    }

    return paged === 0;
  }

  // Waits until every chat message the steps asked for is up to date.
  public async settle(): Promise<void> {
    await OnCallPolicyRunMessage.whenIdle();
  }

  // ---- The incident ----

  // "Incident INC-8 Created", as IncidentService writes it, with its buttons.
  public async incidentCreated(): Promise<void> {
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
      displayColor: Red500,
      feedInfoInMarkdown: mdText`#### 🚨 Incident INC-8 Created:

**testslack**:

${FeedMarkdown.asMarkdown("No description provided.")}

🔴 **Incident State**: Identified

⚠️ **Severity**: Major Incident

`.toString(),
      userId: NITIN,
      workspaceNotification: {
        appendMessageBlocks:
          await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
            incidentId: INCIDENT_ID,
            projectId: PROJECT_ID,
          }),
        sendWorkspaceNotification: true,
      },
    });

    await this.noteMembersNotAddedToNewChannels();
  }

  /*
   * What IncidentService, AlertService and ScheduledMaintenanceService do
   * right after the record's created message: tell its new channels who
   * their setup could not add (NewChannelNoteFollowsCreatedMessage.test.ts
   * holds the services to it).
   */
  private async noteMembersNotAddedToNewChannels(): Promise<void> {
    const membersNotAdded: Array<ChannelMembersNotAdded> =
      this.membersNotAddedToNewChannels;

    this.membersNotAddedToNewChannels = [];

    await ChannelMembersNotAddedNotice.noteAll({
      projectId: PROJECT_ID,
      membersNotAdded: membersNotAdded,
    });
  }

  // The incident's state timeline gets a row, through its real hook.
  public async incidentState(data: {
    to: ObjectID;
    name: string;
    isFirst: boolean;
    by?: ObjectID | undefined;
  }): Promise<void> {
    jest.spyOn(IncidentService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(IncidentStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockImplementation((async (): Promise<IncidentState> => {
        const state: IncidentState = new IncidentState();
        state._id = data.to.toString();
        state.name = data.name;
        state.isCreatedState =
          data.to.toString() === STATE_IDENTIFIED.toString();
        return state;
      }) as never);
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue(this.incidentStates());
    jest
      .spyOn(IncidentService, "refreshIncidentMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentAlertService, "cascadeIncidentStateToLinkedAlerts")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "recordHoldsMonitors")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident.id = INCIDENT_ID;
        incident.projectId = PROJECT_ID;
        incident.monitors = [];
        incident.holdsMonitors = false;
        return incident;
      }) as never);
    jest
      .spyOn(AIIncidentPostmortemRunner, "draftPostmortemOnResolve")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(InvestigationGrader, "gradeInvestigationOnResolve")
      .mockResolvedValue(undefined as never);

    const timelineService: Record<string, () => Promise<unknown>> =
      IncidentStateTimelineService as unknown as Record<
        string,
        () => Promise<unknown>
      >;
    jest
      .spyOn(timelineService, "isLastIncidentState")
      .mockResolvedValue(false as never);
    jest
      .spyOn(timelineService, "autoAssignIncidentCommander")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(timelineService, "trackSlaStateChange")
      .mockResolvedValue(undefined as never);

    const created: IncidentStateTimeline = new IncidentStateTimeline();
    created.id = ObjectID.generate();
    created.projectId = PROJECT_ID;
    created.incidentId = INCIDENT_ID;
    created.incidentStateId = data.to;
    created.startsAt = new Date();

    if (data.by) {
      created.createdByUserId = data.by;
    }

    const before: IncidentStateTimeline | null = data.isFirst
      ? null
      : new IncidentStateTimeline();

    if (before) {
      before.id = ObjectID.generate();
      before.incidentStateId = STATE_IDENTIFIED;
    }

    await (
      IncidentStateTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >
    )["onCreateSuccess"]!.call(
      IncidentStateTimelineService,
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: before,
          statusTimelineAfterThisStatus: null,
          mutex: null,
        },
      },
      created,
    );
  }

  private incidentStates(): Array<IncidentState> {
    const make: (
      id: ObjectID,
      name: string,
      order: number,
      flags: Partial<IncidentState>,
    ) => IncidentState = (
      id: ObjectID,
      name: string,
      order: number,
      flags: Partial<IncidentState>,
    ): IncidentState => {
      const state: IncidentState = new IncidentState();
      state._id = id.toString();
      state.name = name;
      state.order = order;
      Object.assign(state, flags);
      return state;
    };

    return [
      make(STATE_IDENTIFIED, "Identified", 1, { isCreatedState: true }),
      make(STATE_ACKNOWLEDGED, "Acknowledged", 2, {
        isAcknowledgedState: true,
      }),
      make(STATE_RESOLVED, "Resolved", 3, { isResolvedState: true }),
    ];
  }

  /*
   * A channel was created for the record: the rule's people are invited, and
   * who could not be added is held for the record's created message.
   */
  public async channelCreated(userIds: Array<ObjectID>): Promise<void> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getUsersIdsToInviteToChannel")
      .mockResolvedValue([
        { notificationRuleId: WORKSPACE_RULE_ID.toString(), userIds: userIds },
      ]);

    for (const workspaceType of this.workspaces) {
      const channel: NotificationRuleWorkspaceChannel | undefined =
        workspaceType === WorkspaceType.Slack
          ? this.channels.slack
          : this.channels.teams;

      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: PROJECT_ID,
          workspaceType: workspaceType,
        });

      this.membersNotAddedToNewChannels.push(
        ...(await WorkspaceNotificationRuleService.inviteUsersAndTeamsToChannelsBasedOnRules(
          {
            projectId: PROJECT_ID,
            projectAuth: projectAuth!,
            workspaceType: workspaceType,
            notificationRules: [this.workspaceRule(workspaceType)],
            notificationChannels: channel ? [channel] : [],
          },
        )),
      );
    }
  }

  // Somebody was paged, or made an owner: they are invited to the channels.
  public async invitedToRecordChannels(
    userIds: Array<ObjectID>,
  ): Promise<void> {
    await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        projectId: PROJECT_ID,
        notificationRules: this.workspaces.map(
          (workspaceType: WorkspaceType): WorkspaceNotificationRule => {
            return this.workspaceRule(workspaceType);
          },
        ),
        workspaceChannels: [this.channels.slack, this.channels.teams].filter(
          (
            channel: NotificationRuleWorkspaceChannel | undefined,
          ): channel is NotificationRuleWorkspaceChannel => {
            return Boolean(channel);
          },
        ),
        userIds: userIds,
      },
    );
  }

  // A note posted on the incident, as IncidentInternalNoteService writes it.
  public async incidentNote(text: string, by: ObjectID): Promise<void> {
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      feedInfoInMarkdown:
        mdText`📄 posted **private note** for this [Incident INC-8](${DASHBOARD}):

${FeedMarkdown.asMarkdown(text)}`.toString(),
      userId: by,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: by,
      },
    });
  }

  /*
   * A Slack or Microsoft Teams message Nitin saved as a note, as
   * IncidentInternalNoteService writes its entry (SavedChatMessageNote): who
   * wrote it, the chat, who saved it - and not posted back into the channel
   * the message is in, `channelId`.
   */
  public async incidentNoteSavedFromChat(data: {
    text: string;
    workspaceType: WorkspaceType;
    channelId: string;
  }): Promise<void> {
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      feedInfoInMarkdown:
        mdText`📄 **Aidil Rahman** posted **private note** for this [Incident INC-8](${DASHBOARD}) via Slack (note added by Nitin):

${FeedMarkdown.asMarkdown(data.text)}`.toString(),
      userId: NITIN,
      savedFromChatMessage: {
        workspaceType: data.workspaceType,
        authorName: "Aidil Rahman",
      },
      workspaceNotification: {
        sendWorkspaceNotification: true,
        exceptChannel: {
          workspaceType: data.workspaceType,
          channelId: data.channelId,
        },
      },
    });
  }

  // ---- The alert ----

  public async alertCreated(): Promise<void> {
    await AlertFeedService.createAlertFeedItem({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      alertFeedEventType: AlertFeedEventType.AlertCreated,
      displayColor: Red500,
      feedInfoInMarkdown: mdText`#### 🚨 Alert AL-12 Created:

**Checkout latency**:

${FeedMarkdown.asMarkdown("p95 over 2s")}

🔴 **Alert State**: Created

`.toString(),
      workspaceNotification: {
        appendMessageBlocks:
          await AlertWorkspaceMessages.getAlertCreateMessageBlocks({
            alertId: ALERT_ID,
            projectId: PROJECT_ID,
          }),
        sendWorkspaceNotification: true,
      },
    });

    await this.noteMembersNotAddedToNewChannels();
  }

  public async alertState(data: {
    to: ObjectID;
    name: string;
    isFirst: boolean;
  }): Promise<void> {
    jest.spyOn(AlertService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(AlertStateTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertStateService, "findOneBy")
      .mockImplementation((async (): Promise<AlertState> => {
        const state: AlertState = new AlertState();
        state._id = data.to.toString();
        state.name = data.name;
        return state;
      }) as never);
    jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockResolvedValue(false);
    jest
      .spyOn(AlertStateService, "isAcknowledgedAlertState")
      .mockResolvedValue(!data.isFirst);
    jest
      .spyOn(AlertService, "refreshAlertMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertMeasurementValueService, "recomputeForAlert")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        AlertStateTimelineService as unknown as Record<
          string,
          () => Promise<unknown>
        >,
        "isLastAlertState",
      )
      .mockResolvedValue(false as never);

    const created: AlertStateTimeline = new AlertStateTimeline();
    created.id = ObjectID.generate();
    created.projectId = PROJECT_ID;
    created.alertId = ALERT_ID;
    created.alertStateId = data.to;
    created.startsAt = new Date();

    const before: AlertStateTimeline | null = data.isFirst
      ? null
      : new AlertStateTimeline();

    await (
      AlertStateTimelineService as unknown as Record<
        string,
        (...args: Array<unknown>) => Promise<unknown>
      >
    )["onCreateSuccess"]!.call(
      AlertStateTimelineService,
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: {
          statusTimelineBeforeThisStatus: before,
          statusTimelineAfterThisStatus: null,
          mutex: null,
        },
      },
      created,
    );
  }

  // That the alert's owners were told, as AlertOwners' job writes it.
  public async alertOwnersNotified(): Promise<void> {
    await AlertFeedService.createAlertFeedItem({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
      feedInfoInMarkdown:
        "🔔 **Owners have been notified about the state change of the Alert AL-12.**",
      workspaceNotification: {
        sendWorkspaceNotification: false,
      },
    });
  }

  // ---- The scheduled maintenance event ----

  public async maintenanceCreated(): Promise<void> {
    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: MAINTENANCE_ID,
      projectId: PROJECT_ID,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated,
      displayColor: Red500,
      feedInfoInMarkdown: mdText`#### 🕒 Scheduled Maintenance SM-3 Created:

**Database upgrade**:

⏳ **Scheduled Maintenance State**: Scheduled

`.toString(),
      userId: JANE,
      workspaceNotification: {
        appendMessageBlocks:
          await ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
            {
              scheduledMaintenanceId: MAINTENANCE_ID,
              projectId: PROJECT_ID,
            },
          ),
        sendWorkspaceNotification: true,
      },
    });

    await this.noteMembersNotAddedToNewChannels();
  }

  /*
   * A state of the event, as ScheduledMaintenanceStateTimelineService
   * writes its line: posted unless it is the event's first state
   * (WorkspaceStateChangePosting, which the service is held to by
   * StateChangeFirstStateNotPosted.test.ts).
   */
  public async maintenanceState(name: string, isFirst: boolean): Promise<void> {
    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: MAINTENANCE_ID,
      projectId: PROJECT_ID,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
      feedInfoInMarkdown:
        mdText`⏳ Changed **Scheduled Maintenance SM-3 State** to **${name}**`.toString(),
      userId: JANE,
      workspaceNotification: {
        sendWorkspaceNotification: WorkspaceStateChangePosting.postsToWorkspace(
          {
            stateBeforeThis: isFirst ? null : { id: "before" },
            stateAfterThis: null,
          },
        ),
        notifyUserId: JANE,
      },
    });
  }

  // That the event's subscribers were all told, as its job writes it.
  public async maintenanceSubscribersNotified(): Promise<void> {
    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: MAINTENANCE_ID,
      projectId: PROJECT_ID,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.SubscriberNotificationSent,
      feedInfoInMarkdown:
        "📧 **Status Page Subscribers have been notified** about the state change of the Scheduled Maintenance SM-3 to **Ongoing**",
      workspaceNotification: {
        sendWorkspaceNotification: false,
      },
    });
  }

  public async maintenanceNote(text: string): Promise<void> {
    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
      scheduledMaintenanceId: MAINTENANCE_ID,
      projectId: PROJECT_ID,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PublicNote,
      feedInfoInMarkdown:
        mdText`📄 posted **public note** for this Scheduled Maintenance SM-3:

${FeedMarkdown.asMarkdown(text)}`.toString(),
      userId: JANE,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: JANE,
      },
    });
  }
}
