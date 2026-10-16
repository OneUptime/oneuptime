import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import AlertEpisodeFeedService from "../../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ScheduledMaintenanceFeedService from "../../../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../../Server/Services/TeamService";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import ProjectMembership from "../../../../../Server/Utils/TeamMember/ProjectMembership";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { WorkspaceChannel } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import { WorkspaceChannelRecordType } from "../../../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import { jest } from "@jest/globals";

/*
 * A PROJECT WITH SLACK (AND MICROSOFT TEAMS) CONNECTED, AN INCIDENT, AN
 * ALERT, TWO EPISODES AND A SCHEDULED MAINTENANCE EVENT WITH CHANNELS OF
 * THEIR OWN, AND THE PEOPLE AROUND THEM - DRIVEN THROUGH THE REAL
 * WorkspaceChannelMembers, SlackChannelMembers AND THE REAL NOTIFICATION LOG
 * WRITER.
 *
 * Everything between the record's page asking and an HTTP request to Slack's
 * Web API is the real code. The database is in memory (the records and
 * their channels, who may read and edit them, the project's members and
 * teams, the connected Slack accounts, the Notification Logs rows and the
 * feed entries), Valkey is a map, and Slack is a fake workspace that
 * records every request and answers as Slack does.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);
export const INCIDENT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000002",
);
export const ALERT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000003",
);
export const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000004",
);
export const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000005",
);
export const SCHEDULED_MAINTENANCE_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000006",
);

export const RECORD_IDS: Record<WorkspaceChannelRecordType, ObjectID> = {
  [WorkspaceChannelRecordType.Incident]: INCIDENT_ID,
  [WorkspaceChannelRecordType.Alert]: ALERT_ID,
  [WorkspaceChannelRecordType.IncidentEpisode]: INCIDENT_EPISODE_ID,
  [WorkspaceChannelRecordType.AlertEpisode]: ALERT_EPISODE_ID,
  [WorkspaceChannelRecordType.ScheduledMaintenance]: SCHEDULED_MAINTENANCE_ID,
};

// The project's teams: Platform, and a team of another project.
export const PLATFORM_TEAM_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000011",
);
export const OTHER_PROJECT_TEAM_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000012",
);

/*
 * The people. Each is a member of the project unless said otherwise, and
 * has a Slack account in the workspace unless said otherwise.
 */
// Looks at the page; has connected her Slack account.
export const ALICE: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000021",
);
// Has connected his Slack account.
export const BOB: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000022",
);
// Has not connected hers; Slack has an account with her email address.
export const CAROL: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000023",
);
// Has not connected his, and no Slack account has his email address.
export const DAN: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000024",
);
// In the Platform team; has connected her account.
export const ERIN: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000025",
);
// A Slack guest; has connected her account.
export const GINA: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000026",
);
// Not a member of the project, though his Slack account is connected.
export const OSCAR: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000027",
);
// In the Platform team, invited but not accepted yet.
export const PAT: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000028",
);
// A name full of Markdown, connected.
export const MALLORY: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000029",
);

export interface Person {
  name: string;
  email: string;
  hasProfilePicture?: boolean | undefined;
}

export const PEOPLE: Dictionary<Person> = {
  [ALICE.toString()]: {
    name: "Alice Smith",
    email: "alice@acme.test",
    hasProfilePicture: true,
  },
  [BOB.toString()]: { name: "Bob Jones", email: "bob@acme.test" },
  [CAROL.toString()]: { name: "Carol Lee", email: "Carol@Acme.test" },
  [DAN.toString()]: { name: "Dan Brown", email: "dan@acme.test" },
  [ERIN.toString()]: { name: "Erin Wu", email: "erin@acme.test" },
  [GINA.toString()]: { name: "Gina Guest", email: "gina@partner.test" },
  [OSCAR.toString()]: { name: "Oscar Out", email: "oscar@acme.test" },
  [PAT.toString()]: { name: "Pat Pending", email: "pat@acme.test" },
  [MALLORY.toString()]: {
    name: "**Mal** [click](https://evil.test) <!here>",
    email: "mallory@acme.test",
  },
};

// The Slack accounts people connected to OneUptime, in this project.
export const CONNECTED: Dictionary<string> = {
  [ALICE.toString()]: "U0ALICE",
  [BOB.toString()]: "U0BOB",
  [ERIN.toString()]: "U0ERIN",
  [GINA.toString()]: "U0GINA",
  [OSCAR.toString()]: "U0OSCAR",
  [MALLORY.toString()]: "U0MAL",
};

export const BOT_USER_ID: string = "U0ONEUPTIME";
export const SLACK_TEAM_ID: string = "T0ACME";

// The workspace's accounts, as users.info tells them.
export interface SlackAccount {
  id: string;
  name: string;
  realName?: string | undefined;
  email: string;
  isBot?: boolean | undefined;
  deleted?: boolean | undefined;
  isGuest?: boolean | undefined;
}

export const SLACK_ACCOUNTS: Array<SlackAccount> = [
  {
    id: "U0ALICE",
    name: "alice",
    realName: "Alice S.",
    email: "alice@acme.test",
  },
  { id: "U0BOB", name: "bob", email: "bob@acme.test" },
  { id: "U0CAROL", name: "carol", realName: "Carol", email: "carol@acme.test" },
  { id: "U0ERIN", name: "erin", email: "erin@acme.test" },
  {
    id: "U0GINA",
    name: "gina",
    email: "gina@partner.test",
    isGuest: true,
  },
  { id: "U0OSCAR", name: "oscar", email: "oscar@acme.test" },
  { id: "U0MAL", name: "mal", email: "mallory@acme.test" },
  // Somebody in Slack who is not a OneUptime user.
  {
    id: "U0SAM",
    name: "sam",
    realName: "Sam from Support",
    email: "sam@acme.test",
  },
  // The OneUptime app, and another app.
  { id: BOT_USER_ID, name: "oneuptime", email: "", isBot: true },
  { id: "U0STATUSBOT", name: "statusbot", email: "", isBot: true },
  // A deactivated account still listed in a channel.
  { id: "U0GONE", name: "gone", email: "gone@acme.test", deleted: true },
];

// A channel in the fake Slack workspace.
export interface SlackChannelState {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  members: Array<string>;
}

export interface SlackRequest {
  method: string;
  body: JSONObject;
}

// The record's channels, as the record stores them.
export function slackChannel(
  id: string,
  name: string,
): NotificationRuleWorkspaceChannel {
  return {
    id: id,
    name: name,
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: "c4000000-0000-4000-8000-0000000000f1",
  };
}

export function teamsChannel(
  id: string,
  name: string,
  teamId: string,
): NotificationRuleWorkspaceChannel {
  return {
    id: id,
    name: name,
    workspaceType: WorkspaceType.MicrosoftTeams,
    teamId: teamId,
    notificationRuleId: "c4000000-0000-4000-8000-0000000000f2",
  };
}

export const TEAMS_TEAM_ID: string = "c4000000-0000-4000-8000-0000000000a1";
export const TEAMS_TENANT_ID: string = "c4000000-0000-4000-8000-0000000000a2";

// The values a QueryHelper.any / in operator holds.
export function valuesOf(operator: unknown): Array<string> {
  if (Array.isArray(operator)) {
    return operator.map((value: unknown) => {
      return String(value);
    });
  }

  if (typeof operator === "string") {
    return [operator];
  }

  if (operator instanceof ObjectID) {
    return [operator.toString()];
  }

  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  for (const value of Object.values(parameters)) {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return String(item);
      });
    }
  }

  return [];
}

export interface FeedEntry {
  recordType: WorkspaceChannelRecordType;
  recordId: string;
  eventType: string;
  markdown: string;
  userId: string;
}

export default class ChannelMembersWorld {
  // Who is asking, and what they may do.
  public viewer: ObjectID = ALICE;
  public canRead: boolean = true;
  public canEdit: boolean = true;
  // An edit check that throws, as the permission layer does for a role without it.
  public editCheckThrows: boolean = false;
  public isApiKey: boolean = false;

  public slackConnected: boolean = true;
  public teamsConnected: boolean = true;

  // Each record's stored channels.
  public recordChannels: Record<WorkspaceChannelRecordType, unknown> = {
    [WorkspaceChannelRecordType.Incident]: [slackChannel("C0INC42", "inc-42")],
    [WorkspaceChannelRecordType.Alert]: [slackChannel("C0ALT7", "alt-7")],
    [WorkspaceChannelRecordType.IncidentEpisode]: [
      slackChannel("C0IE3", "ie-3"),
    ],
    [WorkspaceChannelRecordType.AlertEpisode]: [slackChannel("C0AE5", "ae-5")],
    [WorkspaceChannelRecordType.ScheduledMaintenance]: [
      slackChannel("C0SM5", "sm-5"),
    ],
  };

  // The fake Slack workspace's channels.
  public slackChannels: Dictionary<SlackChannelState> = {
    C0INC42: {
      id: "C0INC42",
      name: "inc-42",
      isPrivate: true,
      isArchived: false,
      members: [BOT_USER_ID, "U0BOB", "U0SAM"],
    },
    C0ALT7: {
      id: "C0ALT7",
      name: "alt-7",
      isPrivate: false,
      isArchived: false,
      members: [BOT_USER_ID],
    },
    C0IE3: {
      id: "C0IE3",
      name: "ie-3",
      isPrivate: false,
      isArchived: false,
      members: [BOT_USER_ID],
    },
    C0AE5: {
      id: "C0AE5",
      name: "ae-5",
      isPrivate: false,
      isArchived: false,
      members: [BOT_USER_ID],
    },
    C0SM5: {
      id: "C0SM5",
      name: "sm-5",
      isPrivate: false,
      isArchived: false,
      members: [BOT_USER_ID],
    },
  };

  public slackAccounts: Array<SlackAccount> = SLACK_ACCOUNTS.map(
    (account: SlackAccount) => {
      return { ...account };
    },
  );

  public projectMembers: Set<string> = new Set<string>([
    ALICE.toString(),
    BOB.toString(),
    CAROL.toString(),
    DAN.toString(),
    ERIN.toString(),
    GINA.toString(),
    MALLORY.toString(),
  ]);

  // The Platform team: Erin and Bob accepted, Pat has not.
  public platformTeam: Array<{ userId: ObjectID; accepted: boolean }> = [
    { userId: ERIN, accepted: true },
    { userId: BOB, accepted: true },
    { userId: PAT, accepted: false },
  ];

  // Slack's answer to a method, whoever it is for: an error code.
  public slackRefuses: Dictionary<string> = {};
  // Slack's answer to inviting one person: an error code.
  public inviteRefusals: Dictionary<string> = {};
  // A method Slack answers with an HTTP status instead (429, 500).
  public slackHttpStatus: Dictionary<number> = {};
  // Whether users.lookupByEmail is refused for want of users:read.email.
  public lookupByEmailMissingScope: boolean = false;
  // The page size Slack uses for conversations.members.
  public membersPageSize: number = 200;

  // Microsoft Graph: each Teams channel's membershipType, or an error.
  public teamsMembershipTypes: Dictionary<string | Error> = {};

  public slackRequests: Array<SlackRequest> = [];
  public feedEntries: Array<FeedEntry> = [];
  public logRows: Array<WorkspaceNotificationLog> = [];

  // Valkey: a map, or down.
  public cache: Map<string, string> = new Map<string, string>();
  public cacheDown: boolean = false;

  public props(): DatabaseCommonInteractionProps {
    if (this.isApiKey) {
      return { tenantId: PROJECT_ID };
    }

    return { tenantId: PROJECT_ID, userId: this.viewer };
  }

  // The Slack methods asked for, in order.
  public slackMethods(): Array<string> {
    return this.slackRequests.map((request: SlackRequest) => {
      return request.method;
    });
  }

  public slackRequestsOf(method: string): Array<JSONObject> {
    return this.slackRequests
      .filter((request: SlackRequest) => {
        return request.method === method;
      })
      .map((request: SlackRequest) => {
        return request.body;
      });
  }

  // Who was invited to which channel, one person a request.
  public invites(): Array<{ channel: string; users: string }> {
    return this.slackRequestsOf("conversations.invite").map(
      (body: JSONObject) => {
        return {
          channel: String(body["channel"]),
          users: String(body["users"]),
        };
      },
    );
  }

  private accountById(id: string): SlackAccount | undefined {
    return this.slackAccounts.find((account: SlackAccount) => {
      return account.id === id;
    });
  }

  private userOf(userId: string): User | null {
    const person: Person | undefined = PEOPLE[userId];

    if (!person) {
      return null;
    }

    const user: User = new User();
    user.id = new ObjectID(userId);
    user._id = userId;
    user.name = person.name as never;
    user.email = person.email as never;

    if (person.hasProfilePicture) {
      user.profilePictureId = new ObjectID(
        "c4000000-0000-4000-8000-0000000000b1",
      );
    }

    return user;
  }

  private slackUser(account: SlackAccount): JSONObject {
    return {
      id: account.id,
      name: account.name,
      real_name: account.realName || "",
      deleted: Boolean(account.deleted),
      is_bot: Boolean(account.isBot),
      is_restricted: Boolean(account.isGuest),
      profile: {
        display_name: "",
        real_name: account.realName || "",
        email: account.email,
      },
    };
  }

  // Slack's Web API, as each method answers.
  private answerSlack(method: string, body: JSONObject): JSONObject {
    const refusal: string | undefined = this.slackRefuses[method];

    if (refusal) {
      return { ok: false, error: refusal };
    }

    const channelId: string = String(body["channel"] || "");
    const channel: SlackChannelState | undefined =
      this.slackChannels[channelId];

    if (method === "conversations.info") {
      // A private channel the app is not in is not there, as far as it can tell.
      if (
        !channel ||
        (channel.isPrivate && !channel.members.includes(BOT_USER_ID))
      ) {
        return { ok: false, error: "channel_not_found" };
      }

      return {
        ok: true,
        channel: {
          id: channel.id,
          name: channel.name,
          is_private: channel.isPrivate,
          is_archived: channel.isArchived,
          is_member: channel.members.includes(BOT_USER_ID),
        },
      };
    }

    if (method === "conversations.members") {
      if (
        !channel ||
        (channel.isPrivate && !channel.members.includes(BOT_USER_ID))
      ) {
        return { ok: false, error: "channel_not_found" };
      }

      const start: number = body["cursor"] ? Number(body["cursor"]) : 0;
      const limit: number = Math.min(
        Number(body["limit"]) || 100,
        this.membersPageSize,
      );
      const page: Array<string> = channel.members.slice(start, start + limit);
      const next: number = start + limit;

      return {
        ok: true,
        members: page,
        response_metadata: {
          next_cursor: next < channel.members.length ? String(next) : "",
        },
      };
    }

    if (method === "users.info") {
      const account: SlackAccount | undefined = this.accountById(
        String(body["user"]),
      );

      return account
        ? { ok: true, user: this.slackUser(account) }
        : { ok: false, error: "user_not_found" };
    }

    if (method === "users.lookupByEmail") {
      if (this.lookupByEmailMissingScope) {
        return { ok: false, error: "missing_scope" };
      }

      const email: string = String(body["email"]).toLowerCase();
      const account: SlackAccount | undefined = this.slackAccounts.find(
        (candidate: SlackAccount) => {
          return candidate.email.toLowerCase() === email && Boolean(email);
        },
      );

      return account
        ? { ok: true, user: this.slackUser(account) }
        : { ok: false, error: "users_not_found" };
    }

    if (method === "conversations.join") {
      if (!channel || channel.isPrivate) {
        return { ok: false, error: "channel_not_found" };
      }

      if (!channel.members.includes(BOT_USER_ID)) {
        channel.members.push(BOT_USER_ID);
      }

      return { ok: true, channel: { id: channel.id } };
    }

    if (method === "conversations.invite") {
      if (!channel) {
        return { ok: false, error: "channel_not_found" };
      }

      if (channel.isArchived) {
        return { ok: false, error: "is_archived" };
      }

      if (!channel.members.includes(BOT_USER_ID)) {
        return {
          ok: false,
          error: channel.isPrivate ? "channel_not_found" : "not_in_channel",
        };
      }

      const user: string = String(body["users"]);
      const personalRefusal: string | undefined = this.inviteRefusals[user];

      if (personalRefusal) {
        return {
          ok: false,
          error: personalRefusal,
          errors: [{ user: user, ok: false, error: personalRefusal }],
        };
      }

      if (channel.members.includes(user)) {
        return { ok: false, error: "already_in_channel" };
      }

      channel.members.push(user);
      return { ok: true, channel: { id: channel.id } };
    }

    return { ok: false, error: "unknown_method" };
  }

  private projectAuth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
    const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    auth.projectId = PROJECT_ID;
    auth.workspaceType = workspaceType;

    if (workspaceType === WorkspaceType.Slack) {
      auth.authToken = "xoxb-acme";
      auth.workspaceProjectId = SLACK_TEAM_ID;
      auth.miscData = {
        teamId: SLACK_TEAM_ID,
        teamName: "Acme",
        botUserId: BOT_USER_ID,
      } as never;
    } else {
      auth.authToken = "graph-token";
      auth.workspaceProjectId = TEAMS_TENANT_ID;
      auth.miscData = {
        tenantId: TEAMS_TENANT_ID,
        teamId: TEAMS_TEAM_ID,
        teamName: "Ops",
        botId: "bot",
        availableTeams: {
          [TEAMS_TEAM_ID]: { id: TEAMS_TEAM_ID, name: "Ops" },
        },
      } as never;
    }

    return auth;
  }

  // A record read with the caller's own props, or as OneUptime.
  private record<T>(data: {
    recordType: WorkspaceChannelRecordType;
    make: () => T;
    props: DatabaseCommonInteractionProps;
    select: JSONObject;
  }): T | null {
    if (!data.props.isRoot && !this.canRead) {
      return null;
    }

    const record: T = data.make();

    if (data.select["postUpdatesToWorkspaceChannels"]) {
      (record as unknown as JSONObject)["postUpdatesToWorkspaceChannels"] = this
        .recordChannels[data.recordType] as never;
    }

    return record;
  }

  private updatable(props: DatabaseCommonInteractionProps): JSONObject | null {
    if (this.editCheckThrows) {
      throw new NotAuthorizedException(
        "You do not have permission to edit this record.",
      );
    }

    return props.userId && this.canEdit ? { _id: "updatable" } : null;
  }

  // Every fake in place, on the real code.
  public install(): void {
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);

    // Slack's Web API.
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = data.url.toString();
      const method: string = url.split("/api/")[1] || "";
      const body: JSONObject = { ...(data.data || {}) };

      this.slackRequests.push({ method: method, body: body });

      const status: number | undefined = this.slackHttpStatus[method];

      if (status) {
        return new HTTPErrorResponse(
          status,
          { ok: false, error: status === 429 ? "ratelimited" : "fatal_error" },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(
        200,
        this.answerSlack(method, body),
        {},
      );
    }) as never);

    // Microsoft Graph: whether a Teams channel is private.
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation((async (data: {
        channelId: string;
        teamId: string;
      }): Promise<WorkspaceChannel> => {
        const membershipType: string | Error | undefined =
          this.teamsMembershipTypes[data.channelId];

        if (membershipType instanceof Error) {
          throw membershipType;
        }

        return {
          id: data.channelId,
          name: data.channelId,
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: data.teamId,
          membershipType: membershipType,
        };
      }) as never);

    // Valkey.
    jest.spyOn(GlobalCache, "getString").mockImplementation((async (
      namespace: string,
      key: string,
    ): Promise<string | null> => {
      if (this.cacheDown) {
        throw new Error("Cache is not connected");
      }

      return this.cache.get(`${namespace}-${key}`) || null;
    }) as never);
    jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
      namespace: string,
      keys: Array<string>,
    ): Promise<Array<string | null>> => {
      if (this.cacheDown) {
        throw new Error("Cache is not connected");
      }

      return keys.map((key: string) => {
        return this.cache.get(`${namespace}-${key}`) || null;
      });
    }) as never);
    jest.spyOn(GlobalCache, "setString").mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ): Promise<void> => {
      if (this.cacheDown) {
        throw new Error("Cache is not connected");
      }

      this.cache.set(`${namespace}-${key}`, value);
    }) as never);

    // The records: read with the caller's props, or as OneUptime.
    const kinds: Array<{
      recordType: WorkspaceChannelRecordType;
      service: unknown;
      make: () => unknown;
    }> = [
      {
        recordType: WorkspaceChannelRecordType.Incident,
        service: IncidentService,
        make: () => {
          const incident: Incident = new Incident();
          incident.id = INCIDENT_ID;
          incident._id = INCIDENT_ID.toString();
          incident.projectId = PROJECT_ID;
          return incident;
        },
      },
      {
        recordType: WorkspaceChannelRecordType.Alert,
        service: AlertService,
        make: () => {
          const alert: Alert = new Alert();
          alert.id = ALERT_ID;
          alert._id = ALERT_ID.toString();
          alert.projectId = PROJECT_ID;
          return alert;
        },
      },
      {
        recordType: WorkspaceChannelRecordType.IncidentEpisode,
        service: IncidentEpisodeService,
        make: () => {
          const episode: IncidentEpisode = new IncidentEpisode();
          episode.id = INCIDENT_EPISODE_ID;
          episode._id = INCIDENT_EPISODE_ID.toString();
          episode.projectId = PROJECT_ID;
          return episode;
        },
      },
      {
        recordType: WorkspaceChannelRecordType.AlertEpisode,
        service: AlertEpisodeService,
        make: () => {
          const episode: AlertEpisode = new AlertEpisode();
          episode.id = ALERT_EPISODE_ID;
          episode._id = ALERT_EPISODE_ID.toString();
          episode.projectId = PROJECT_ID;
          return episode;
        },
      },
      {
        recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
        service: ScheduledMaintenanceService,
        make: () => {
          const event: ScheduledMaintenance = new ScheduledMaintenance();
          event.id = SCHEDULED_MAINTENANCE_ID;
          event._id = SCHEDULED_MAINTENANCE_ID.toString();
          event.projectId = PROJECT_ID;
          return event;
        },
      },
    ];

    for (const kind of kinds) {
      jest
        .spyOn(kind.service as typeof IncidentService, "findOneById")
        .mockImplementation((async (data: {
          id: ObjectID;
          select: JSONObject;
          props: DatabaseCommonInteractionProps;
        }): Promise<unknown> => {
          if (data.id.toString() !== RECORD_IDS[kind.recordType].toString()) {
            return null;
          }

          return this.record({
            recordType: kind.recordType,
            make: kind.make,
            props: data.props,
            select: data.select,
          });
        }) as never);

      jest
        .spyOn(kind.service as typeof IncidentService, "findOneUpdatableById")
        .mockImplementation((async (data: {
          id: ObjectID;
          props: DatabaseCommonInteractionProps;
        }): Promise<unknown> => {
          if (data.id.toString() !== RECORD_IDS[kind.recordType].toString()) {
            return null;
          }

          return this.updatable(data.props);
        }) as never);
    }

    // The project's workspaces.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        if (data.workspaceType === WorkspaceType.Slack) {
          return this.slackConnected
            ? this.projectAuth(WorkspaceType.Slack)
            : null;
        }

        return this.teamsConnected
          ? this.projectAuth(WorkspaceType.MicrosoftTeams)
          : null;
      }) as never);

    // Each person's own Slack account, in this project.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async (data: {
        query: {
          userId: ObjectID;
          workspaceType: WorkspaceType;
          projectId: ObjectID;
        };
      }): Promise<WorkspaceUserAuthToken | null> => {
        const slackUserId: string | undefined =
          CONNECTED[data.query.userId.toString()];

        if (
          !slackUserId ||
          data.query.workspaceType !== WorkspaceType.Slack ||
          data.query.projectId.toString() !== PROJECT_ID.toString()
        ) {
          return null;
        }

        const row: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        row.userId = data.query.userId;
        row.workspaceUserId = slackUserId;
        return row;
      }) as never);

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (data: {
        query: {
          workspaceUserId: unknown;
          workspaceType: WorkspaceType;
          projectId: ObjectID;
        };
      }): Promise<Array<WorkspaceUserAuthToken>> => {
        if (
          data.query.workspaceType !== WorkspaceType.Slack ||
          data.query.projectId.toString() !== PROJECT_ID.toString()
        ) {
          return [];
        }

        const wanted: Array<string> = valuesOf(data.query.workspaceUserId);

        return Object.entries(CONNECTED)
          .filter(([, slackUserId]: [string, string]) => {
            return wanted.includes(slackUserId);
          })
          .map(([userId, slackUserId]: [string, string]) => {
            const row: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
            row.userId = new ObjectID(userId);
            row.workspaceUserId = slackUserId;
            return row;
          });
      }) as never);

    // The users: by id, or by email.
    jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
      query: { _id?: unknown; email?: unknown };
    }): Promise<Array<User>> => {
      if (data.query._id !== undefined) {
        return valuesOf(data.query._id)
          .map((userId: string) => {
            return this.userOf(userId);
          })
          .filter((user: User | null): user is User => {
            return Boolean(user);
          });
      }

      const emails: Array<string> = valuesOf(data.query.email).map(
        (email: string) => {
          return email.toLowerCase();
        },
      );

      return Object.entries(PEOPLE)
        .filter(([, person]: [string, Person]) => {
          return emails.includes(person.email.toLowerCase());
        })
        .map(([userId]: [string, Person]) => {
          return this.userOf(userId)!;
        });
    }) as never);

    jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<User | null> => {
      return this.userOf(data.id.toString());
    }) as never);

    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: {
        userId: ObjectID;
      }): Promise<unknown> => {
        const person: Person | undefined = PEOPLE[data.userId.toString()];
        return mdText`[${person?.name || "User"}](https://oneuptime.test/users/${data.userId.toString()})`;
      }) as never);

    // Who is a member of the project.
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          return new Set<string>(
            data.userIds
              .map((userId: ObjectID | string) => {
                return userId.toString().toLowerCase();
              })
              .filter((userId: string) => {
                return this.projectMembers.has(userId);
              }),
          );
        },
      );

    // The project's teams, and who is in them.
    jest.spyOn(TeamService, "findBy").mockImplementation((async (data: {
      query: { _id: unknown; projectId: ObjectID };
    }): Promise<Array<Team>> => {
      return valuesOf(data.query._id)
        .filter((teamId: string) => {
          return (
            teamId === PLATFORM_TEAM_ID.toString() &&
            data.query.projectId.toString() === PROJECT_ID.toString()
          );
        })
        .map((teamId: string) => {
          const team: Team = new Team();
          team.id = new ObjectID(teamId);
          team._id = teamId;
          return team;
        });
    }) as never);

    jest.spyOn(TeamMemberService, "getUsersInTeams").mockImplementation((async (
      teamIds: Array<ObjectID>,
      options?: { acceptedOnly?: boolean },
    ): Promise<Array<User>> => {
      const isPlatform: boolean = teamIds.some((teamId: ObjectID) => {
        return teamId.toString() === PLATFORM_TEAM_ID.toString();
      });

      if (!isPlatform) {
        return [];
      }

      return this.platformTeam
        .filter((member: { userId: ObjectID; accepted: boolean }) => {
          return member.accepted || !options?.acceptedOnly;
        })
        .map((member: { userId: ObjectID; accepted: boolean }) => {
          return this.userOf(member.userId.toString())!;
        });
    }) as never);

    // The Notification Logs rows the real logInviteUser writes.
    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceNotificationLog;
      }): Promise<WorkspaceNotificationLog> => {
        this.logRows.push(data.data);
        return data.data;
      }) as never);

    // The feed entries, on each record's own feed.
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation((async (data: {
        incidentId: ObjectID;
        incidentFeedEventType: string;
        feedInfoInMarkdown: string;
        userId: ObjectID;
      }): Promise<void> => {
        this.feedEntries.push({
          recordType: WorkspaceChannelRecordType.Incident,
          recordId: data.incidentId.toString(),
          eventType: data.incidentFeedEventType,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId.toString(),
        });
      }) as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation((async (data: {
        alertId: ObjectID;
        alertFeedEventType: string;
        feedInfoInMarkdown: string;
        userId: ObjectID;
      }): Promise<void> => {
        this.feedEntries.push({
          recordType: WorkspaceChannelRecordType.Alert,
          recordId: data.alertId.toString(),
          eventType: data.alertFeedEventType,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId.toString(),
        });
      }) as never);
    jest
      .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
      .mockImplementation((async (data: {
        incidentEpisodeId: ObjectID;
        incidentEpisodeFeedEventType: string;
        feedInfoInMarkdown: string;
        userId: ObjectID;
      }): Promise<void> => {
        this.feedEntries.push({
          recordType: WorkspaceChannelRecordType.IncidentEpisode,
          recordId: data.incidentEpisodeId.toString(),
          eventType: data.incidentEpisodeFeedEventType,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId.toString(),
        });
      }) as never);
    jest
      .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
      .mockImplementation((async (data: {
        alertEpisodeId: ObjectID;
        alertEpisodeFeedEventType: string;
        feedInfoInMarkdown: string;
        userId: ObjectID;
      }): Promise<void> => {
        this.feedEntries.push({
          recordType: WorkspaceChannelRecordType.AlertEpisode,
          recordId: data.alertEpisodeId.toString(),
          eventType: data.alertEpisodeFeedEventType,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId.toString(),
        });
      }) as never);
    jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockImplementation((async (data: {
        scheduledMaintenanceId: ObjectID;
        scheduledMaintenanceFeedEventType: string;
        feedInfoInMarkdown: string;
        userId: ObjectID;
      }): Promise<void> => {
        this.feedEntries.push({
          recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
          recordId: data.scheduledMaintenanceId.toString(),
          eventType: data.scheduledMaintenanceFeedEventType,
          markdown: data.feedInfoInMarkdown,
          userId: data.userId.toString(),
        });
      }) as never);
  }
}
