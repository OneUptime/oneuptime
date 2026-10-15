import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationRuleChannelToCreate,
  WorkspaceChannelsCreated,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import ChannelMembersNotAddedNotice from "../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../Utils/API";
import WorkspaceChannelName, {
  WorkspaceChannelNameParts,
} from "../../../Utils/Workspace/WorkspaceChannelName";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * TWO RULES ASK FOR ONE CHANNEL: EACH RULE'S PEOPLE ARE INVITED TO IT.
 *
 * Two incident rules whose templates give the same name - "incidents-" -
 * share the one channel OneUptime creates for the incident: it is created,
 * and posted to, once. Only the first rule's id was kept on that channel,
 * and every invite path matches a record's channels to rules by it, so the
 * second rule's people never joined the channel it asked for:
 *
 *   - the users and teams it invites, as the channel is created;
 *   - the incident's owners, as they are added ("Invite Incident Owners");
 *   - whoever an on-call policy pages ("Automatically Invite On Call Users").
 *
 * Here the channel is created through the real rule matching, channel
 * creation and SlackUtil, against a fake Slack API that records every
 * request; owners are added through the owner services' own hooks, and a
 * page goes out as an escalation rule sends one. Only the database is faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000002",
);
const POLICY_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000003",
);

// The rule that comes first: it creates the channel and invites nobody.
const FIRST_RULE_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000011",
);
// A rule after it whose template gives the same name, and invites people.
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000012",
);
// A rule with a template of its own.
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000013",
);

const TEAM_ID: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000021");

// Members of the project with a Slack account connected to OneUptime.
const RULE_USER: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000031",
);
const OTHER_RULE_USER: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000032",
);
const TEAM_USER: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000033",
);
const OWNER: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000034");
const ON_CALL: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000035");
// A member who has not connected a Slack account.
const NOT_CONNECTED: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000036",
);

const SLACK_USER_IDS: Dictionary<string> = {
  [RULE_USER.toString()]: "U0RULE",
  [OTHER_RULE_USER.toString()]: "U0OTHER",
  [TEAM_USER.toString()]: "U0TEAM",
  [OWNER.toString()]: "U0OWNER",
  [ON_CALL.toString()]: "U0ONCALL",
};

const BOT_SLACK_USER_ID: string = "B0BOT";

// "INC-9" gives the channel "incidents-inc-9".
const INCIDENT_NUMBER_WITH_PREFIX: string = "INC-9";
const CHANNEL_NAME: string = "incidents-inc-9";

// What INC-9's channels are named from, as IncidentWorkspaceMessages hands it.
const INCIDENT_CHANNEL_NAME_PARTS: WorkspaceChannelNameParts =
  WorkspaceChannelName.forNumberedRecord({
    eventType: NotificationRuleEventType.Incident,
    number: 9,
    numberWithPrefix: INCIDENT_NUMBER_WITH_PREFIX,
  });

interface RuleSwitches {
  template?: string;
  createsChannel?: boolean;
  inviteUsers?: Array<ObjectID>;
  inviteTeams?: Array<ObjectID>;
  inviteOwners?: boolean;
  inviteOnCallUsers?: boolean;
}

function incidentRule(
  id: ObjectID,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: switches.createsChannel !== false,
    newChannelTemplateName: switches.template ?? "incidents-",
    inviteUsersToNewChannel: switches.inviteUsers || [],
    inviteTeamsToNewChannel: switches.inviteTeams || [],
    shouldInviteOwnersToNewChannel: Boolean(switches.inviteOwners),
    archiveChannelAutomatically: true,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: Boolean(
      switches.inviteOnCallUsers,
    ),
  };

  rule.notificationRule = notificationRule as never;
  return rule;
}

function user(id: ObjectID): User {
  const model: User = new User();
  model.id = id;
  return model;
}

interface SlackRequest {
  method: string;
  body: JSONObject;
}

// The Slack API, as far as creating a channel and adding people to it goes.
class FakeSlack {
  public requests: Array<SlackRequest> = [];

  // Who is in each channel: the bot that created it, to begin with.
  public members: Dictionary<Array<string>> = {};

  private channels: Array<JSONObject> = [];

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

      if (method === "conversations.create") {
        const created: JSONObject = {
          id: `C0NEW${this.channels.length + 1}`,
          name: String(body["name"]),
        };
        this.channels.push(created);
        answer = { ok: true, channel: created };
      }

      if (method === "conversations.list") {
        answer = {
          ok: true,
          channels: this.channels,
          response_metadata: { next_cursor: "" },
        };
      }

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

  // The names of the channels created, in the order Slack was asked.
  public created(): Array<string> {
    return this.requests
      .filter((request: SlackRequest): boolean => {
        return request.method === "conversations.create";
      })
      .map((request: SlackRequest): string => {
        return String(request.body["name"]);
      });
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
let channelCache: Dictionary<JSONObject>;
let members: Set<string>;
let logRows: Array<WorkspaceNotificationLog>;

/*
 * Adding an owner, and a page, do not wait for their invites - Slack being
 * slow must hold neither up. The invites are collected as they start, so a
 * test can wait for what it set off.
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
        started.push(
          step.catch((): void => {
            return undefined;
          }),
        );
        return step;
      },
    );

  const inviteTeams: typeof WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels =
    WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels.bind(
      WorkspaceNotificationRuleService,
    );

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteTeamsBasedOnRulesAndWorkspaceChannels",
    )
    .mockImplementation(
      (data: Parameters<typeof inviteTeams>[0]): Promise<void> => {
        const step: Promise<void> = inviteTeams(data);
        started.push(
          step.catch((): void => {
            return undefined;
          }),
        );
        return step;
      },
    );
}

/*
 * INC-9 is created: its rules' channels are created and their people
 * invited, and the incident keeps the channels it got, as IncidentService
 * does (postUpdatesToWorkspaceChannels).
 */
async function createIncidentChannels(): Promise<WorkspaceChannelsCreated> {
  const result: WorkspaceChannelsCreated | null =
    await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
      {
        projectId: PROJECT_ID,
        notificationRuleEventType: NotificationRuleEventType.Incident,
        notificationFor: { incidentId: INCIDENT_ID },
        channelNameParts: INCIDENT_CHANNEL_NAME_PARTS,
      },
    );

  expect(result).not.toBeNull();
  incidentChannels = result!.channelsCreated;
  return result!;
}

function onCreate<T extends IncidentOwnerUser | IncidentOwnerTeam>(
  data: T,
): OnCreate<T> {
  return {
    createBy: { data: data, props: { isRoot: true } },
    carryForward: null,
  } as OnCreate<T>;
}

// Somebody is made an owner of INC-9, as the owner service's hook adds them.
async function addOwner(userId: ObjectID): Promise<void> {
  const owner: IncidentOwnerUser = new IncidentOwnerUser();
  owner.projectId = PROJECT_ID;
  owner.incidentId = INCIDENT_ID;
  owner.userId = userId;

  await IncidentOwnerUserService.onCreateSuccess(onCreate(owner), owner);
  await workspaceStepsDone();
}

// A team is made an owner of INC-9.
async function addOwnerTeam(teamId: ObjectID): Promise<void> {
  const ownerTeam: IncidentOwnerTeam = new IncidentOwnerTeam();
  ownerTeam.projectId = PROJECT_ID;
  ownerTeam.incidentId = INCIDENT_ID;
  ownerTeam.teamId = teamId;

  await IncidentOwnerTeamService.onCreateSuccess(
    onCreate(ownerTeam),
    ownerTeam,
  );
  await workspaceStepsDone();
}

// A page going out for INC-9, as an escalation rule of the policy sends it.
async function page(userId: ObjectID): Promise<void> {
  await UserNotificationRuleService.startUserNotificationRulesExecution(
    userId,
    {
      projectId: PROJECT_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
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

  // The channels OneUptime created, cached by name as they are created.
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

  storedRules = [];
  incidentChannels = [];
  channelCache = {};
  members = new Set<string>([
    RULE_USER.toString(),
    OTHER_RULE_USER.toString(),
    TEAM_USER.toString(),
    OWNER.toString(),
    ON_CALL.toString(),
    NOT_CONNECTED.toString(),
  ]);
  logRows = [];
  started = [];

  collectAsStarted();

  // The project's workspace rules, as stored, in the order they are read.
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

  // INC-9, with the channels its rules created.
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident.id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.title = "Checkout is down";
      incident.description = "Orders fail at payment.";
      incident.labels = [];
      incident.monitors = [];
      incident.postUpdatesToWorkspaceChannels = incidentChannels;
      return incident;
    }) as never);

  // What the owner services' feed items need to say who was added.
  jest.spyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 9,
    numberWithPrefix: INCIDENT_NUMBER_WITH_PREFIX,
  });
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/incidents/9"));
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Somebody`);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);

  const team: Team = new Team();
  team.id = TEAM_ID;
  team.name = "Payments";
  jest.spyOn(TeamService, "findOneById").mockResolvedValue(team);

  // The team's one member.
  jest
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockImplementation(
      async (teamIds: Array<ObjectID>): Promise<Array<User>> => {
        return teamIds.some((teamId: ObjectID): boolean => {
          return teamId.toString() === TEAM_ID.toString();
        })
          ? [user(TEAM_USER)]
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
            return members.has(userId.toString());
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
              return members.has(userId);
            }),
        );
      },
    );

  // The project's Slack workspace: its bot token and its channel cache.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation((async (): Promise<
      Array<WorkspaceProjectAuthToken>
    > => {
      return [slackProjectAuth()];
    }) as never);

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

  // A created channel is cached by name, where the invites look it up.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockImplementation((async (data: {
      miscData: { channelCache?: Dictionary<JSONObject> };
    }): Promise<void> => {
      Object.assign(channelCache, data.miscData.channelCache || {});
    }) as never);

  // Each person's own Slack account, connected to OneUptime.
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

  jest
    .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
    .mockResolvedValue(undefined);

  // The page's own row, which the worker later delivers.
  jest.spyOn(UserOnCallLogService, "create").mockImplementation((async (data: {
    data: UserOnCallLog;
  }): Promise<UserOnCallLog> => {
    return data.data;
  }) as never);

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

describe("the channel two rules ask for, as the incident is created", () => {
  test("is created once, and keeps both rules - the first one first", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.created()).toEqual([CHANNEL_NAME]);
    expect(result.channelsCreated).toEqual([
      {
        id: "C0NEW1",
        name: CHANNEL_NAME,
        workspaceType: WorkspaceType.Slack,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
        ],
      },
    ]);
  });

  test("REGRESSION: the users the second rule invites join it", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    await createIncidentChannels();

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
  });

  test("REGRESSION: a team the second rule invites joins it", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteTeams: [TEAM_ID] }),
    ];

    await createIncidentChannels();

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0TEAM" }]);
  });

  test("both rules invite people: everybody joins the one channel", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID, { inviteUsers: [OTHER_RULE_USER] }),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    await createIncidentChannels();

    expect(slack.created()).toEqual([CHANNEL_NAME]);
    expect(slack.invites()).toEqual([
      { channel: "C0NEW1", users: "U0OTHER" },
      { channel: "C0NEW1", users: "U0RULE" },
    ]);
  });

  test("somebody both rules invite is asked into the channel once", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID, { inviteUsers: [RULE_USER] }),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    await createIncidentChannels();

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
  });

  test("somebody the second rule invites who has not connected Slack is handed back for the channel, to be named in its note", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [NOT_CONNECTED] }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.invites()).toEqual([]);
    expect(result.membersNotAdded).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channels: [{ id: "C0NEW1", name: CHANNEL_NAME }],
        userIds: [NOT_CONNECTED],
      },
    ]);
  });

  test("whichever rule comes first, the channel keeps both and the people of each join it", async () => {
    storedRules = [
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
      incidentRule(FIRST_RULE_ID),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(result.channelsCreated).toHaveLength(1);
    expect(result.channelsCreated[0]!.notificationRuleId).toBe(
      SECOND_RULE_ID.toString(),
    );
    expect(result.channelsCreated[0]!.notificationRuleIds).toEqual([
      SECOND_RULE_ID.toString(),
      FIRST_RULE_ID.toString(),
    ]);
    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
  });

  /*
   * Slack lower-cases the name it is asked for: "Incidents-inc-9" creates
   * "incidents-inc-9", the channel the second rule asks for by name.
   */
  test("a template that differs only in case gives the same Slack channel, and both rules count for it", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID, { template: "Incidents-" }),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.created()).toEqual([CHANNEL_NAME]);
    expect(result.channelsCreated).toHaveLength(1);
    expect(result.channelsCreated[0]!.notificationRuleIds).toEqual([
      FIRST_RULE_ID.toString(),
      SECOND_RULE_ID.toString(),
    ]);
    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
  });

  test("rules with templates of their own each get a channel, and only their own people", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID, { inviteUsers: [OTHER_RULE_USER] }),
      incidentRule(OTHER_RULE_ID, {
        template: "war-room-",
        inviteUsers: [RULE_USER],
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.created()).toEqual([CHANNEL_NAME, "war-room-inc-9"]);
    expect(
      result.channelsCreated.map(
        (channel: NotificationRuleWorkspaceChannel): Array<string> => {
          return channel.notificationRuleIds || [];
        },
      ),
    ).toEqual([[FIRST_RULE_ID.toString()], [OTHER_RULE_ID.toString()]]);
    expect(slack.invites()).toEqual([
      { channel: "C0NEW1", users: "U0OTHER" },
      { channel: "C0NEW2", users: "U0RULE" },
    ]);
  });

  test("the incident keeps the channel once, so a message about it is posted there once", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    await createIncidentChannels();

    expect(incidentChannels).toHaveLength(1);

    const destinations: Array<WorkspaceMessagePayload> =
      await WorkspaceNotificationRuleService.getMessageDestinations({
        projectId: PROJECT_ID,
        notificationFor: { incidentId: INCIDENT_ID },
        workspaceType: WorkspaceType.Slack,
      });

    expect(
      destinations.map((destination: WorkspaceMessagePayload) => {
        return destination.channelIds;
      }),
    ).toEqual([["C0NEW1"]]);
  });
});

describe("owners added to the incident later", () => {
  test("REGRESSION: an owner joins the channel when the rule that invites owners shares it with the rule that came first", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteOwners: true }),
    ];

    await createIncidentChannels();
    await addOwner(OWNER);

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0OWNER" }]);
    expect(inviteRows()).toHaveLength(1);
    expect(inviteRows()[0]!.channelId).toBe("C0NEW1");
    expect(inviteRows()[0]!.userId?.toString()).toBe(OWNER.toString());
  });

  test("REGRESSION: an owner team's members join it too", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteOwners: true }),
    ];

    await createIncidentChannels();
    await addOwnerTeam(TEAM_ID);

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0TEAM" }]);
  });

  test("neither rule invites owners: an owner is not added to the channel", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteUsers: [RULE_USER] }),
    ];

    await createIncidentChannels();
    await addOwner(OWNER);

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
  });

  test("a rule that invites owners but creates no channel adds nobody to the channel other rules created", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(OTHER_RULE_ID, {
        createsChannel: false,
        inviteOwners: true,
      }),
    ];

    await createIncidentChannels();
    await addOwner(OWNER);

    expect(slack.created()).toEqual([CHANNEL_NAME]);
    expect(slack.invites()).toEqual([]);
  });
});

describe("whoever an on-call policy pages", () => {
  test("REGRESSION: the person paged joins the channel when the rule that invites on-call users shares it with the rule that came first", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteOnCallUsers: true }),
    ];

    await createIncidentChannels();
    await page(ON_CALL);

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0ONCALL" }]);
    expect(inviteRows()).toHaveLength(1);
    expect(inviteRows()[0]!.incidentId?.toString()).toBe(
      INCIDENT_ID.toString(),
    );
  });

  test("neither rule invites on-call users: the person paged is not added", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { inviteOwners: true }),
    ];

    await createIncidentChannels();
    await page(ON_CALL);

    expect(slack.invites()).toEqual([]);
  });
});

/*
 * A channel stored before every rule was recorded on it has only the first
 * rule's id: it is matched to that rule as it always was.
 */
describe("a channel stored with only its first rule", () => {
  const STORED_CHANNEL: NotificationRuleWorkspaceChannel = {
    id: "C0OLD9",
    name: CHANNEL_NAME,
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: FIRST_RULE_ID.toString(),
  };

  beforeEach(() => {
    // Created with the incident, and cached by name then.
    channelCache[CHANNEL_NAME] = { id: "C0OLD9", name: CHANNEL_NAME };
  });

  test("an owner joins it when its rule invites owners", async () => {
    storedRules = [incidentRule(FIRST_RULE_ID, { inviteOwners: true })];
    incidentChannels = [STORED_CHANNEL];

    await addOwner(OWNER);

    expect(slack.invites()).toEqual([{ channel: "C0OLD9", users: "U0OWNER" }]);
  });

  test("the person paged joins it when its rule invites on-call users", async () => {
    storedRules = [incidentRule(FIRST_RULE_ID, { inviteOnCallUsers: true })];
    incidentChannels = [STORED_CHANNEL];

    await page(ON_CALL);

    expect(slack.invites()).toEqual([{ channel: "C0OLD9", users: "U0ONCALL" }]);
  });
});

describe("getnotificationChannelssFromNotificationRules", () => {
  function channelsFor(
    rules: Array<WorkspaceNotificationRule>,
  ): Array<NotificationRuleChannelToCreate> {
    return WorkspaceNotificationRuleService.getnotificationChannelssFromNotificationRules(
      {
        notificationEventType: NotificationRuleEventType.Incident,
        notificationRules: rules,
        channelNameParts: INCIDENT_CHANNEL_NAME_PARTS,
        workspaceType: WorkspaceType.Slack,
      },
    );
  }

  test("REGRESSION: rules whose templates give the same name ask for one channel, and every one of them is kept", () => {
    expect(
      channelsFor([
        incidentRule(FIRST_RULE_ID),
        incidentRule(OTHER_RULE_ID, { template: "war-room-" }),
        incidentRule(SECOND_RULE_ID),
      ]),
    ).toEqual([
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
        ],
        prefix: "incidents-",
      },
      {
        channelName: "war-room-inc-9",
        notificationRuleId: OTHER_RULE_ID.toString(),
        notificationRuleIds: [OTHER_RULE_ID.toString()],
        prefix: "war-room-",
      },
    ]);
  });

  // No prefix names the channel after the incident itself (WorkspaceChannelName).
  test("rules without a prefix share the incident's own name", () => {
    expect(
      channelsFor([
        incidentRule(FIRST_RULE_ID, { template: "" }),
        incidentRule(SECOND_RULE_ID, { template: "" }),
      ]),
    ).toEqual([
      {
        channelName: "inc-9",
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
        ],
        prefix: "",
      },
    ]);
  });

  test("a rule that creates no channel asks for none", () => {
    expect(
      channelsFor([
        incidentRule(FIRST_RULE_ID),
        incidentRule(SECOND_RULE_ID, { createsChannel: false }),
      ]),
    ).toEqual([
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [FIRST_RULE_ID.toString()],
        prefix: "incidents-",
      },
    ]);
  });

  test("a rule listed twice is kept once", () => {
    expect(
      channelsFor([
        incidentRule(FIRST_RULE_ID),
        incidentRule(FIRST_RULE_ID),
      ])[0]!.notificationRuleIds,
    ).toEqual([FIRST_RULE_ID.toString()]);
  });
});
