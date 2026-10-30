import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeRoleMember from "../../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentEpisodeRoleMemberService from "../../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice, {
  ChannelMembersNotAdded,
} from "../../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Dictionary from "../../../../Types/Dictionary";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceNotificationActionType from "../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { jest } from "@jest/globals";

/*
 * A PROJECT WITH SLACK (AND MICROSOFT TEAMS) CONNECTED, ITS NOTIFICATION
 * RULES, AND AN INCIDENT, AN ALERT AND AN INCIDENT EPISODE - DRIVEN THROUGH
 * THE REAL RULE MATCHING, CHANNEL CREATION, INVITES AND MESSAGES.
 *
 * Everything between a record changing in OneUptime and an HTTP request to
 * Slack's Web API or Microsoft Graph is the real code:
 * WorkspaceNotificationRuleService, WorkspaceRecordChannels,
 * WorkspaceRecordPeople, the incident member and on-call services' hooks,
 * SlackUtil and MicrosoftTeamsUtil.createChannel. Only the database is in
 * memory - the rules, the records and the people on them, the pages, the
 * workspace connections and the Notification Logs rows - and the far ends
 * are fakes that record every request.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000001",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000002",
);
export const ALERT_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000003",
);
export const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000004",
);

export const RULE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000011",
);
export const OTHER_RULE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000012",
);

// The incident's states, in the project's order.
export const CREATED_STATE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000021",
);
export const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000022",
);
export const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000023",
);

export const CRITICAL_SEVERITY_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000031",
);
export const MINOR_SEVERITY_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000032",
);

export const COMMANDER_ROLE_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000041",
);

export const TEAM_ID: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000051",
);

/*
 * The people. Each is a member of the project with a Slack account
 * connected to OneUptime, unless said otherwise.
 */
// Acknowledges the incident from OneUptime and so becomes its commander.
export const COMMANDER: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000061",
);
// Paged by the on-call policy.
export const ON_CALL: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000062",
);
// An owner of the incident.
export const OWNER: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000063",
);
// The one member of the owner team TEAM_ID.
export const TEAM_USER: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000064",
);
// A user the rule names.
export const RULE_USER: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000065",
);
// A member who has not connected a Slack account.
export const NOT_CONNECTED: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000066",
);
// Somebody who left the project, though rows still name them.
export const LEFT_PROJECT: ObjectID = new ObjectID(
  "e7000000-0000-4000-8000-000000000067",
);

export const SLACK_USER_IDS: Dictionary<string> = {
  [COMMANDER.toString()]: "U0CMDR",
  [ON_CALL.toString()]: "U0ONCALL",
  [OWNER.toString()]: "U0OWNER",
  [TEAM_USER.toString()]: "U0TEAM",
  [RULE_USER.toString()]: "U0RULE",
  [LEFT_PROJECT.toString()]: "U0LEFT",
};

export const BOT_SLACK_USER_ID: string = "B0BOT";

// The Microsoft Teams team a Teams rule creates its channels in.
export const TEAMS_TEAM_ID: string = "team-ops";

export const INCIDENT_LINK: URL = URL.fromString(
  "https://oneuptime.test/dashboard/incidents/42",
);

export interface RuleOptions {
  id?: ObjectID | undefined;
  name?: string | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
  filters?: Array<NotificationRuleCondition> | undefined;
  createsChannel?: boolean | undefined;
  prefix?: string | undefined;
  inviteUsers?: Array<ObjectID> | undefined;
  inviteTeams?: Array<ObjectID> | undefined;
  inviteOwners?: boolean | undefined;
  inviteOnCall?: boolean | undefined;
  // Left out: the rule does not say (saved before the switch existed).
  inviteRoles?: boolean | undefined;
  archive?: boolean | undefined;
  existingChannels?: string | undefined;
  teamToCreateChannelIn?: string | undefined;
  // Left out: the rule does not say (saved before the switch existed).
  postsUpdatesInThread?: boolean | undefined;
}

// A rule as the database holds it.
export function makeRule(options: RuleOptions = {}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = options.id || RULE_ID;
  rule.projectId = PROJECT_ID;
  rule.name = options.name ?? "Incident channels";
  rule.workspaceType = options.workspaceType || WorkspaceType.Slack;
  rule.eventType = options.eventType || NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: options.filters || [],
    shouldPostToExistingChannel: Boolean(options.existingChannels),
    existingChannelNames: options.existingChannels || "",
    shouldCreateNewChannel: options.createsChannel !== false,
    newChannelTemplateName: options.prefix ?? "",
    inviteUsersToNewChannel: options.inviteUsers || [],
    inviteTeamsToNewChannel: options.inviteTeams || [],
    shouldInviteOwnersToNewChannel: Boolean(options.inviteOwners),
    archiveChannelAutomatically: Boolean(options.archive),
    shouldAutomaticallyInviteOnCallUsersToNewChannel: Boolean(
      options.inviteOnCall,
    ),
  };

  if (options.inviteRoles !== undefined) {
    notificationRule.shouldInviteIncidentRolesToNewChannel =
      options.inviteRoles;
  }

  if (options.teamToCreateChannelIn) {
    notificationRule.teamToCreateChannelIn = options.teamToCreateChannelIn;
  }

  if (options.postsUpdatesInThread !== undefined) {
    notificationRule.shouldPostUpdatesInThread = options.postsUpdatesInThread;
  }

  rule.notificationRule = notificationRule as never;
  return rule;
}

export interface SlackRequest {
  method: string;
  body: JSONObject;
  // What Slack answered: a posted message's ts is in it.
  answer?: JSONObject | undefined;
}

export interface GraphChannelCreate {
  teamId: string;
  displayName: string;
  membershipType: string;
}

/*
 * The project's records and people, as the database would hold them, and
 * the far ends of Slack and Microsoft Graph.
 */
export default class WorkspaceRuleWorld {
  public rules: Array<WorkspaceNotificationRule> = [];
  public connected: Array<WorkspaceType> = [WorkspaceType.Slack];

  // INC-42, created in the Created state, severity Critical.
  public incident: {
    stateId: ObjectID;
    severityId: ObjectID;
    isPrivate: boolean;
    // null: its own channel setup has not run.
    channels: Array<NotificationRuleWorkspaceChannel> | null;
    // Just now: a record without a list of channels is still being set up.
    createdAt: Date;
  } = {
    stateId: CREATED_STATE_ID,
    severityId: CRITICAL_SEVERITY_ID,
    isPrivate: false,
    channels: null,
    createdAt: new Date(),
  };

  // ALT-7, in a state that is not resolved.
  public alert: {
    resolved: boolean;
    channels: Array<NotificationRuleWorkspaceChannel> | null;
  } = { resolved: false, channels: null };

  // IE-3, in a state that is not resolved.
  public incidentEpisode: {
    stateId: ObjectID;
    channels: Array<NotificationRuleWorkspaceChannel> | null;
  } = { stateId: CREATED_STATE_ID, channels: null };

  // The people on the records.
  public incidentOwnerUsers: Array<ObjectID> = [];
  public incidentOwnerTeams: Array<ObjectID> = [];
  public incidentMembers: Array<ObjectID> = [];
  public episodeRoleMembers: Array<ObjectID> = [];
  public pages: Array<UserOnCallLog> = [];

  public projectMembers: Set<string> = new Set<string>([
    COMMANDER.toString(),
    ON_CALL.toString(),
    OWNER.toString(),
    TEAM_USER.toString(),
    RULE_USER.toString(),
    NOT_CONNECTED.toString(),
  ]);

  public logRows: Array<WorkspaceNotificationLog> = [];

  public slackRequests: Array<SlackRequest> = [];
  public slackRefusesCreate: string | null = null;
  // Slack refuses a reply in a thread (thread_ts) with this error: its first message was deleted.
  public slackRefusesReplies: string | null = null;

  // Called as each Slack request arrives, before it is answered.
  public onSlackRequest: ((request: SlackRequest) => void) | null = null;
  public graphCreates: Array<GraphChannelCreate> = [];

  // What happened, in order: stores of a record's channels and Slack requests.
  public events: Array<string> = [];

  // Who could not be added, as the record's service would tell its channels.
  public notesOfMembersNotAdded: Array<ChannelMembersNotAdded> = [];

  // The feed items the services post, by their Markdown.
  public feedItems: Array<string> = [];

  /*
   * The steps set off without being waited for - an invite by an owner's or
   * a member's hook, a page's workspace step - collected as they start, so a
   * test waits for what it set off.
   */
  public started: Array<Promise<unknown>> = [];

  private slackChannels: Array<JSONObject> = [];
  private slackMembers: Dictionary<Array<string>> = {};
  private channelCache: Dictionary<JSONObject> = {};

  public async settle(): Promise<void> {
    let waitedFor: number = -1;

    while (waitedFor !== this.started.length) {
      waitedFor = this.started.length;
      await Promise.all(this.started);
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
    }
  }

  /*
   * A channel Slack has already - one OneUptime created for a record
   * earlier - so it is found by its name, as a created one is.
   */
  public addSlackChannel(data: { id: string; name: string }): void {
    const channel: JSONObject = { id: data.id, name: data.name };
    this.slackChannels.push(channel);
    this.channelCache[data.name] = channel;
  }

  // The Slack methods asked for, in order.
  public slackMethods(): Array<string> {
    return this.slackRequests.map((request: SlackRequest): string => {
      return request.method;
    });
  }

  public slackRequestsOf(method: string): Array<JSONObject> {
    return this.slackRequests
      .filter((request: SlackRequest): boolean => {
        return request.method === method;
      })
      .map((request: SlackRequest): JSONObject => {
        return request.body;
      });
  }

  // The names of the Slack channels created, in order.
  public slackChannelsCreated(): Array<string> {
    return this.slackRequestsOf("conversations.create").map(
      (body: JSONObject): string => {
        return String(body["name"]);
      },
    );
  }

  // Who was added to which channel, as Slack was asked, one person a request.
  public slackInvites(): Array<{ channel: string; users: string }> {
    return this.slackRequestsOf("conversations.invite").map(
      (body: JSONObject): { channel: string; users: string } => {
        return {
          channel: String(body["channel"]),
          users: String(body["users"]),
        };
      },
    );
  }

  // The Slack users invited to a channel, in order.
  public slackUsersInvitedTo(channelId: string): Array<string> {
    return this.slackInvites()
      .filter((invite: { channel: string; users: string }): boolean => {
        return invite.channel === channelId;
      })
      .map((invite: { channel: string; users: string }): string => {
        return invite.users;
      });
  }

  // The text of every message posted to a channel, in order.
  public slackMessagesIn(channelId: string): Array<string> {
    return this.slackRequestsOf("chat.postMessage")
      .filter((body: JSONObject): boolean => {
        return body["channel"] === channelId;
      })
      .map((body: JSONObject): string => {
        return JSON.stringify(body["blocks"] || body["text"] || "");
      });
  }

  public logRowsOf(
    actionType: WorkspaceNotificationActionType,
  ): Array<WorkspaceNotificationLog> {
    return this.logRows.filter((row: WorkspaceNotificationLog): boolean => {
      return row.actionType === actionType;
    });
  }

  // A page for the incident, as an escalation rule sends one.
  public async page(
    userId: ObjectID,
    record: {
      triggeredByIncidentId?: ObjectID;
      triggeredByAlertId?: ObjectID;
      triggeredByIncidentEpisodeId?: ObjectID;
    } = { triggeredByIncidentId: INCIDENT_ID },
  ): Promise<void> {
    await UserNotificationRuleService.startUserNotificationRulesExecution(
      userId,
      {
        projectId: PROJECT_ID,
        ...record,
        userNotificationEventType: record.triggeredByAlertId
          ? UserNotificationEventType.AlertCreated
          : record.triggeredByIncidentEpisodeId
            ? UserNotificationEventType.IncidentEpisodeCreated
            : UserNotificationEventType.IncidentCreated,
        onCallPolicyId: undefined,
      },
    );

    await this.settle();
  }

  /*
   * Somebody is given the commander's role on the incident: the row is
   * stored, then its service's hook runs, as IncidentMemberService.create
   * does.
   */
  public async assignCommander(userId: ObjectID): Promise<void> {
    this.incidentMembers.push(userId);

    const member: IncidentMember = new IncidentMember();
    member.projectId = PROJECT_ID;
    member.incidentId = INCIDENT_ID;
    member.userId = userId;
    member.incidentRoleId = COMMANDER_ROLE_ID;

    await IncidentMemberService.onCreateSuccess(
      {
        createBy: { data: member, props: { isRoot: true } },
        carryForward: null,
      },
      member,
    );

    await this.settle();
  }

  /*
   * Something about the incident is posted, as the incident's feed posts
   * it: a state change, a note.
   */
  public async postAboutIncident(markdown: string): Promise<void> {
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      feedInfoInMarkdown: markdown,
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    await this.settle();
  }

  /*
   * INC-42 is created: its rules' channels are opened, as IncidentService
   * sets them up (IncidentWorkspaceMessages).
   */
  public async createIncidentChannels(): Promise<void> {
    await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
      {
        projectId: PROJECT_ID,
        notificationRuleEventType: NotificationRuleEventType.Incident,
        notificationFor: { incidentId: INCIDENT_ID },
        channelNameParts: WorkspaceChannelName.forNumberedRecord({
          eventType: NotificationRuleEventType.Incident,
          number: 42,
          numberWithPrefix: "INC-42",
        }),
        ...(this.incident.isPrivate ? { isPrivate: true } : {}),
      },
    );

    await this.settle();
  }

  // The incident as the database holds it now.
  public incidentModel(): Incident {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is down";
    incident.description = "Orders fail at payment.";
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    incident.isPrivate = this.incident.isPrivate;
    incident.createdAt = this.incident.createdAt;
    incident.currentIncidentStateId = this.incident.stateId;

    const state: IncidentState = new IncidentState();
    state._id = this.incident.stateId.toString();
    state.id = this.incident.stateId;
    incident.currentIncidentState = state;

    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = this.incident.severityId.toString();
    severity.id = this.incident.severityId;
    incident.incidentSeverity = severity;

    incident.labels = [];
    incident.monitors = [];

    if (this.incident.channels !== null) {
      incident.postUpdatesToWorkspaceChannels = this.incident.channels;
    }

    return incident;
  }

  private isMember(userId: ObjectID | string): boolean {
    return this.projectMembers.has(userId.toString());
  }

  private user(userId: ObjectID): User {
    const model: User = new User();
    model.id = userId;
    model._id = userId.toString();
    return model;
  }

  private projectAuth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
    const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    auth.projectId = PROJECT_ID;
    auth.workspaceType = workspaceType;

    if (workspaceType === WorkspaceType.Slack) {
      auth.authToken = "xoxb-project";
      auth.workspaceProjectId = "T0WORKSPACE";
      auth.miscData = {
        botUserId: BOT_SLACK_USER_ID,
        teamId: "T0WORKSPACE",
        teamName: "Ops",
        channelCache: this.channelCache,
      } as never;
    } else {
      auth.authToken = "teams-token";
      auth.workspaceProjectId = "tenant-1";
      auth.miscData = {
        teamId: TEAMS_TEAM_ID,
        teamName: "Ops",
      } as never;
    }

    return auth;
  }

  private answerSlack(method: string, body: JSONObject): JSONObject {
    const channel: string = String(body["channel"] || "");

    if (method === "conversations.create") {
      if (this.slackRefusesCreate) {
        return { ok: false, error: this.slackRefusesCreate };
      }

      const created: JSONObject = {
        id: `C0NEW${this.slackChannels.length + 1}`,
        name: String(body["name"]),
      };
      this.slackChannels.push(created);
      this.channelCache[String(body["name"])] = created;
      return { ok: true, channel: created };
    }

    if (method === "conversations.list") {
      return {
        ok: true,
        channels: this.slackChannels,
        response_metadata: { next_cursor: "" },
      };
    }

    if (method === "conversations.info") {
      const found: JSONObject | undefined = this.slackChannels.find(
        (candidate: JSONObject): boolean => {
          return candidate["id"] === channel;
        },
      );
      return { ok: true, channel: found || { id: channel, name: channel } };
    }

    if (method === "conversations.members") {
      return {
        ok: true,
        members: this.slackMembers[channel] || [BOT_SLACK_USER_ID],
        response_metadata: { next_cursor: "" },
      };
    }

    if (method === "conversations.invite") {
      this.slackMembers[channel] = [
        ...(this.slackMembers[channel] || [BOT_SLACK_USER_ID]),
        ...String(body["users"]).split(","),
      ];
      return { ok: true, channel: { id: channel } };
    }

    if (method === "chat.postMessage") {
      if (this.slackRefusesReplies && body["thread_ts"]) {
        return { ok: false, error: this.slackRefusesReplies };
      }

      return {
        ok: true,
        channel: channel,
        ts: `1700000000.00000${this.slackRequests.length}`,
      };
    }

    return { ok: true };
  }

  private answerGraph(
    url: string,
    body: JSONObject,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse | null {
    const address: globalThis.URL = new globalThis.URL(url);
    const path: Array<string> = address.pathname.split("/");

    // ["", "v1.0", "teams", "<team>", "channels"]
    if (
      address.origin === "https://graph.microsoft.com" &&
      path.length === 5 &&
      path[2] === "teams" &&
      path[4] === "channels"
    ) {
      const create: GraphChannelCreate = {
        teamId: path[3]!,
        displayName: String(body["displayName"]),
        membershipType: String(body["membershipType"]),
      };
      this.graphCreates.push(create);
      this.events.push(`graph:create:${create.displayName}`);

      return new HTTPResponse<JSONObject>(
        201,
        {
          id: `19:channel-${this.graphCreates.length}@thread.tacv2`,
          displayName: create.displayName,
        },
        {},
      );
    }

    return null;
  }

  // Every fake in place, on the real services.
  public install(): void {
    // The far ends: Slack's Web API and Microsoft Graph.
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = data.url.toString();
      const body: JSONObject = data.data || {};

      const graph: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
        url.startsWith("https://graph.microsoft.com/")
          ? this.answerGraph(url, body)
          : null;

      if (graph) {
        return graph;
      }

      const method: string = url.split("/api/")[1] || "";
      const request: SlackRequest = { method: method, body: body };
      this.slackRequests.push(request);
      this.events.push(`slack:${method}`);
      this.onSlackRequest?.({ method: method, body: body });

      const answer: JSONObject = this.answerSlack(method, body);
      request.answer = answer;

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);

    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("graph-token");

    // No Valkey here: the record's lock is taken and given back in memory.
    jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
      return { identifier: "lock" } as never;
    }) as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    // The project's rules, as stored, by workspace and kind of record.
    jest
      .spyOn(WorkspaceNotificationRuleService, "findBy")
      .mockImplementation((async (data: {
        query: {
          workspaceType?: WorkspaceType;
          eventType?: NotificationRuleEventType;
        };
      }): Promise<Array<WorkspaceNotificationRule>> => {
        return this.rules.filter((rule: WorkspaceNotificationRule): boolean => {
          return (
            rule.workspaceType === data.query.workspaceType &&
            rule.eventType === data.query.eventType &&
            this.connected.includes(rule.workspaceType!)
          );
        });
      }) as never);

    // INC-42, as it is now, whatever is selected.
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        return this.incidentModel();
      }) as never);
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (): Promise<Incident> => {
        return this.incidentModel();
      }) as never);

    // Its channels are stored on it.
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockImplementation((async (data: {
        data: { postUpdatesToWorkspaceChannels?: unknown };
      }): Promise<void> => {
        if ("postUpdatesToWorkspaceChannels" in data.data) {
          this.incident.channels = [
            ...((data.data
              .postUpdatesToWorkspaceChannels as Array<NotificationRuleWorkspaceChannel>) ||
              []),
          ];
          this.events.push(
            `store:incident:${this.incident.channels
              .map((channel: NotificationRuleWorkspaceChannel): string => {
                return channel.name;
              })
              .join(",")}`,
          );
        }
      }) as never);

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(INCIDENT_LINK);
    jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 42,
      numberWithPrefix: "INC-42",
    });

    // Its owners: the owner users and the members of the owner teams.
    jest
      .spyOn(IncidentService, "findOwners")
      .mockImplementation(async (): Promise<Array<User>> => {
        const owners: Array<ObjectID> = [...this.incidentOwnerUsers];

        if (
          this.incidentOwnerTeams.some((teamId: ObjectID): boolean => {
            return teamId.toString() === TEAM_ID.toString();
          })
        ) {
          owners.push(TEAM_USER);
        }

        return owners
          .filter((userId: ObjectID): boolean => {
            return this.isMember(userId);
          })
          .map((userId: ObjectID): User => {
            return this.user(userId);
          });
      });

    // The people given a role on it.
    jest
      .spyOn(IncidentMemberService, "findBy")
      .mockImplementation((async (): Promise<Array<IncidentMember>> => {
        return this.incidentMembers.map((userId: ObjectID): IncidentMember => {
          const member: IncidentMember = new IncidentMember();
          member.userId = userId;
          member.incidentId = INCIDENT_ID;
          member.incidentRoleId = COMMANDER_ROLE_ID;
          return member;
        });
      }) as never);

    jest
      .spyOn(IncidentRoleService, "findOneById")
      .mockImplementation((async (): Promise<IncidentRole> => {
        const role: IncidentRole = new IncidentRole();
        role.id = COMMANDER_ROLE_ID;
        role.name = "Incident Commander";
        return role;
      }) as never);

    // The episode's role members.
    jest
      .spyOn(IncidentEpisodeRoleMemberService, "findBy")
      .mockImplementation((async (): Promise<
        Array<IncidentEpisodeRoleMember>
      > => {
        return this.episodeRoleMembers.map(
          (userId: ObjectID): IncidentEpisodeRoleMember => {
            const member: IncidentEpisodeRoleMember =
              new IncidentEpisodeRoleMember();
            member.userId = userId;
            member.incidentEpisodeId = INCIDENT_EPISODE_ID;
            return member;
          },
        );
      }) as never);

    // The pages that went out, by the record they were for.
    jest
      .spyOn(UserOnCallLogService, "findBy")
      .mockImplementation((async (data: {
        query: JSONObject;
      }): Promise<Array<UserOnCallLog>> => {
        return this.pages.filter((pageRow: UserOnCallLog): boolean => {
          return Object.entries(data.query).every(
            ([key, value]: [string, unknown]): boolean => {
              return (
                (pageRow as unknown as JSONObject)[key]?.toString() ===
                (value as ObjectID)?.toString()
              );
            },
          );
        });
      }) as never);

    jest
      .spyOn(UserOnCallLogService, "create")
      .mockImplementation((async (data: {
        data: UserOnCallLog;
      }): Promise<UserOnCallLog> => {
        this.pages.push(data.data);
        return data.data;
      }) as never);

    // Collected as it starts: a page's workspace step is not waited for.
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
          this.started.push(
            step.catch((): void => {
              return undefined;
            }),
          );
          return step;
        },
      );

    const inviteUsers: typeof WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels =
      WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels.bind(
        WorkspaceNotificationRuleService,
      );
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersBasedOnRulesAndWorkspaceChannels",
      )
      .mockImplementation(
        (data: Parameters<typeof inviteUsers>[0]): Promise<void> => {
          const step: Promise<void> = inviteUsers(data);
          this.started.push(
            step.catch((): void => {
              return undefined;
            }),
          );
          return step;
        },
      );

    // The incident's states: Resolved is resolved.
    jest
      .spyOn(IncidentStateService, "isResolvedIncidentState")
      .mockImplementation(
        async (data: { incidentStateId: ObjectID }): Promise<boolean> => {
          return (
            data.incidentStateId.toString() === RESOLVED_STATE_ID.toString()
          );
        },
      );

    // ALT-7 and IE-3.
    jest
      .spyOn(AlertService, "findOneById")
      .mockImplementation((async (): Promise<Alert> => {
        const alert: Alert = new Alert();
        alert.id = ALERT_ID;
        alert.projectId = PROJECT_ID;
        alert.title = "API latency is high";
        alert.alertNumber = 7;
        alert.alertNumberWithPrefix = "ALT-7";
        alert.currentAlertStateId = CREATED_STATE_ID;
        const state: AlertState = new AlertState();
        state._id = CREATED_STATE_ID.toString();
        alert.currentAlertState = state;
        alert.labels = [];
        if (this.alert.channels !== null) {
          alert.postUpdatesToWorkspaceChannels = this.alert.channels;
        }
        return alert;
      }) as never);
    jest
      .spyOn(AlertStateService, "isResolvedAlertState")
      .mockImplementation(async (): Promise<boolean> => {
        return this.alert.resolved;
      });

    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockImplementation((async (): Promise<IncidentEpisode> => {
        const episode: IncidentEpisode = new IncidentEpisode();
        episode.id = INCIDENT_EPISODE_ID;
        episode.projectId = PROJECT_ID;
        episode.title = "Payments are failing";
        episode.episodeNumber = 3;
        episode.episodeNumberWithPrefix = "IE-3";
        episode.currentIncidentStateId = this.incidentEpisode.stateId;
        const state: IncidentState = new IncidentState();
        state._id = this.incidentEpisode.stateId.toString();
        episode.currentIncidentState = state;
        episode.labels = [];
        if (this.incidentEpisode.channels !== null) {
          episode.postUpdatesToWorkspaceChannels =
            this.incidentEpisode.channels;
        }
        return episode;
      }) as never);

    jest
      .spyOn(MonitorService, "getLabelsForMonitors")
      .mockResolvedValue([] as never);

    // Teams and their members.
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockImplementation(
        async (teamIds: Array<ObjectID>): Promise<Array<User>> => {
          return teamIds.some((teamId: ObjectID): boolean => {
            return teamId.toString() === TEAM_ID.toString();
          })
            ? [this.user(TEAM_USER)]
            : [];
        },
      );

    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockImplementation(
        async (data: {
          userIds: Array<ObjectID | string>;
        }): Promise<Array<ObjectID>> => {
          return data.userIds
            .filter((userId: ObjectID | string): boolean => {
              return this.isMember(userId);
            })
            .map((userId: ObjectID | string): ObjectID => {
              return new ObjectID(userId.toString());
            });
        },
      );

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
                return this.isMember(userId);
              }),
          );
        },
      );

    // The project's workspaces.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockImplementation((async (): Promise<
        Array<WorkspaceProjectAuthToken>
      > => {
        return this.connected.map(
          (workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
            return this.projectAuth(workspaceType);
          },
        );
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        return this.connected.includes(data.workspaceType)
          ? this.projectAuth(data.workspaceType)
          : null;
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async (data: {
        query: { workspaceType?: WorkspaceType };
      }): Promise<WorkspaceProjectAuthToken | null> => {
        return data.query.workspaceType &&
          this.connected.includes(data.query.workspaceType)
          ? this.projectAuth(data.query.workspaceType)
          : null;
      }) as never);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
      .mockResolvedValue(undefined as never);

    // Each person's own Slack account.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async (data: {
        query: { userId: ObjectID; workspaceType: WorkspaceType };
      }): Promise<WorkspaceUserAuthToken | null> => {
        const slackUserId: string | undefined =
          SLACK_USER_IDS[data.query.userId.toString()];

        if (!slackUserId || data.query.workspaceType !== WorkspaceType.Slack) {
          return null;
        }

        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.workspaceUserId = slackUserId;
        return userAuth;
      }) as never);

    // Who could not be added is told in the channel: recorded here.
    jest
      .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
      .mockImplementation((async (
        data: ChannelMembersNotAdded & { projectId: ObjectID },
      ): Promise<void> => {
        if (data.userIds.length > 0) {
          this.notesOfMembersNotAdded.push(data);
        }
      }) as never);
    jest
      .spyOn(ChannelMembersNotAddedNotice, "noteAll")
      .mockImplementation((async (data: {
        membersNotAdded?: Array<ChannelMembersNotAdded> | undefined;
      }): Promise<void> => {
        this.notesOfMembersNotAdded.push(...(data.membersNotAdded || []));
      }) as never);

    // The Notification Logs rows, and the refusals read back from them.
    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceNotificationLog;
      }): Promise<WorkspaceNotificationLog> => {
        this.logRows.push(data.data);
        return data.data;
      }) as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockImplementation((async (data: {
        query: JSONObject;
      }): Promise<WorkspaceNotificationLog | null> => {
        return (
          this.logRows.find((row: WorkspaceNotificationLog): boolean => {
            return Object.entries(data.query).every(
              ([key, value]: [string, unknown]): boolean => {
                return (
                  (row as unknown as JSONObject)[key]?.toString() ===
                  (value as { toString: () => string })?.toString()
                );
              },
            );
          }) || null
        );
      }) as never);

    // The feed items the services post.
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
      }): Promise<void> => {
        this.feedItems.push(data.feedInfoInMarkdown);
      }) as never);

    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(mdText`Somebody`);
  }
}

// A row of the Notification Logs saying the workspace refused a channel.
export function refusedChannelRow(data: {
  channelName: string;
  workspaceType?: WorkspaceType | undefined;
}): WorkspaceNotificationLog {
  const row: WorkspaceNotificationLog = new WorkspaceNotificationLog();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.workspaceType = data.workspaceType || WorkspaceType.Slack;
  row.actionType = WorkspaceNotificationActionType.CreateChannel;
  row.status = WorkspaceNotificationStatus.Error;
  row.channelName = data.channelName;
  return row;
}
