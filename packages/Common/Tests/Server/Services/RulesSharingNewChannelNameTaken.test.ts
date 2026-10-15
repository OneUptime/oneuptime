import Incident from "../../../Models/DatabaseModels/Incident";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationRuleChannelToCreate,
  WorkspaceChannelsCreated,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
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

jest.mock("../../../Server/Utils/Logger");

/*
 * TWO RULES ASK FOR ONE CHANNEL BY NAMES THAT ARE NOT THE SAME STRING.
 *
 * Slack lower-cases the name of a channel it creates and drops every
 * character but letters, digits, "-" and "_", so rule A's template
 * "incidents-" and rule B's "Incidents-" (or "incidents -") both ask for
 * the channel "incidents-inc-9". Names were told apart as strings: after
 * the channel was created for rule A, rule B's name was taken for another
 * channel, and Slack refused it (name_taken). That ended the setup of the
 * workspace's channels, so even the channel Slack had created was lost:
 * the incident never kept it, nobody was invited to it, and none of the
 * incident's updates were posted there.
 *
 * Microsoft Teams drops the characters a channel name cannot hold and keeps
 * a team's channel names unique whatever their case (a channel is a folder
 * of the team's SharePoint site), so it refuses the same names within a
 * team - and a name in one team says nothing about another team's.
 *
 * The channels are created here through the real rule matching, channel
 * creation, SlackUtil and MicrosoftTeamsUtil, against fake Slack and
 * Microsoft Graph APIs that refuse a name they have created already. Only
 * the database is faked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000002",
);

// The rule that comes first: it creates the channel and invites nobody.
const FIRST_RULE_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000011",
);
// A rule after it whose template gives a name Slack creates as the same one.
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000012",
);
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000013",
);
// A rule with a template of its own.
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000014",
);

// A member of the project with a Slack account connected to OneUptime.
const RULE_USER: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000031",
);

const SLACK_USER_IDS: Dictionary<string> = {
  [RULE_USER.toString()]: "U0RULE",
};

const BOT_SLACK_USER_ID: string = "B0BOT";

// "INC-9" gives the channel "incidents-inc-9".
const INCIDENT_NUMBER_WITH_PREFIX: string = "INC-9";
const CHANNEL_NAME: string = "incidents-inc-9";

// Microsoft Teams teams; the project's Teams connection was made in TEAM_X.
const TEAM_X: string = "aaaaaaaa-1111-2222-3333-444444444444";
const TEAM_Y: string = "bbbbbbbb-5555-6666-7777-888888888888";

interface RuleSwitches {
  workspaceType?: WorkspaceType;
  template?: string;
  inviteUsers?: Array<ObjectID>;
  teamToCreateChannelIn?: string;
}

function incidentRule(
  id: ObjectID,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = switches.workspaceType || WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    newChannelTemplateName: switches.template ?? "incidents-",
    inviteUsersToNewChannel: switches.inviteUsers || [],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    archiveChannelAutomatically: true,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
  };

  if (switches.teamToCreateChannelIn) {
    notificationRule.teamToCreateChannelIn = switches.teamToCreateChannelIn;
  }

  rule.notificationRule = notificationRule as never;
  return rule;
}

// A rule of the project's Microsoft Teams connection.
function teamsIncidentRule(
  id: ObjectID,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  return incidentRule(id, {
    ...switches,
    workspaceType: WorkspaceType.MicrosoftTeams,
  });
}

interface SlackRequest {
  method: string;
  body: JSONObject;
}

/*
 * The Slack API, as far as creating a channel and adding people to it goes.
 * As Slack does, it creates a name once: asked for it again, it answers
 * name_taken.
 */
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
        const name: string = String(body["name"]);

        const isTaken: boolean = this.channels.some(
          (created: JSONObject): boolean => {
            return created["name"] === name;
          },
        );

        if (isTaken) {
          answer = { ok: false, error: "name_taken" };
        } else {
          const created: JSONObject = {
            id: `C0NEW${this.channels.length + 1}`,
            name: name,
          };
          this.channels.push(created);
          answer = { ok: true, channel: created };
        }
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

  // The names Slack was asked to create, in the order it was asked.
  public askedToCreate(): Array<string> {
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

interface TeamsChannelRequest {
  teamId: string;
  displayName: string;
}

/*
 * Microsoft Graph, as far as creating a team's channels goes. A team's
 * channel names are unique whatever their case: a name the team has, in any
 * case, is refused (NameAlreadyExists). Another team's names are its own.
 */
class FakeTeams {
  public requests: Array<TeamsChannelRequest> = [];

  private channels: Array<TeamsChannelRequest & { id: string }> = [];

  public install(): void {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("graph-token");

    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const teamId: string =
        data.url.toString().split("/teams/")[1]?.split("/")[0] || "";
      const displayName: string = String(data.data["displayName"]);

      this.requests.push({ teamId: teamId, displayName: displayName });

      const isTaken: boolean = this.channels.some(
        (channel: TeamsChannelRequest): boolean => {
          return (
            channel.teamId === teamId &&
            channel.displayName.toLowerCase() === displayName.toLowerCase()
          );
        },
      );

      if (isTaken) {
        return new HTTPErrorResponse(
          400,
          {
            error: {
              code: "BadRequest",
              message: "Channel name already existed, please use other name.",
              innerError: { code: "NameAlreadyExists" },
            },
          },
          {},
        );
      }

      const created: TeamsChannelRequest & { id: string } = {
        id: `19:new${this.channels.length + 1}@thread.tacv2`,
        teamId: teamId,
        displayName: displayName,
      };
      this.channels.push(created);

      const answer: JSONObject = {
        id: created.id,
        displayName: displayName,
        membershipType: "standard",
      };

      return {
        jsonData: answer,
        data: answer,
      } as unknown as HTTPResponse<JSONObject>;
    }) as never);
  }
}

let slack: FakeSlack;
let teams: FakeTeams;
let projectAuths: Array<WorkspaceProjectAuthToken>;
let storedRules: Array<WorkspaceNotificationRule>;
let incidentChannels: Array<NotificationRuleWorkspaceChannel>;
let channelCache: Dictionary<JSONObject>;

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
        channelNameSiffix: INCIDENT_NUMBER_WITH_PREFIX,
      },
    );

  expect(result).not.toBeNull();
  incidentChannels = result!.channelsCreated;
  return result!;
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

function teamsProjectAuth(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.MicrosoftTeams;
  auth.authToken = "graph-app-token";
  auth.workspaceProjectId = "tenant-1";

  auth.miscData = {
    tenantId: "tenant-1",
    teamId: TEAM_X,
    teamName: "Ops",
    botId: "bot-1",
  } as never;

  return auth;
}

function projectAuthOf(
  workspaceType: WorkspaceType | undefined,
): WorkspaceProjectAuthToken | null {
  return (
    projectAuths.find((auth: WorkspaceProjectAuthToken): boolean => {
      return auth.workspaceType === workspaceType;
    }) || null
  );
}

function ruleIdsOf(
  channels: Array<NotificationRuleWorkspaceChannel>,
): Array<Array<string>> {
  return channels.map(
    (channel: NotificationRuleWorkspaceChannel): Array<string> => {
      return channel.notificationRuleIds || [];
    },
  );
}

beforeEach(() => {
  slack = new FakeSlack();
  teams = new FakeTeams();

  projectAuths = [];
  storedRules = [];
  incidentChannels = [];
  channelCache = {};

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

  // Everybody a rule invites is a member of the project.
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

  // The project's workspace connections.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation((async (): Promise<
      Array<WorkspaceProjectAuthToken>
    > => {
      return projectAuths;
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async (data: {
      query: { workspaceType?: WorkspaceType };
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return projectAuthOf(data.query.workspaceType);
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return projectAuthOf(data.workspaceType);
    }) as never);

  // A created Slack channel is cached by name, where the invites look it up.
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

  // The workspace logs a record's Notification Logs page lists.
  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockImplementation((async (data: {
      data: WorkspaceNotificationLog;
    }): Promise<WorkspaceNotificationLog> => {
      return data.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Slack: a rule whose template gives the name of a channel created already", () => {
  beforeEach(() => {
    slack.install();
    projectAuths = [slackProjectAuth()];
  });

  test.each([
    ["differs only in case", "Incidents-"],
    ["is all upper case", "INCIDENTS-"],
    ["has a space Slack drops", "incidents -"],
    ["starts with a # Slack drops", "#Incidents-"],
  ])(
    "REGRESSION: a template that %s (%s) shares the channel the first rule created, with both rules",
    async (_case: string, template: string) => {
      storedRules = [
        incidentRule(FIRST_RULE_ID),
        incidentRule(SECOND_RULE_ID, { template: template }),
      ];

      const result: WorkspaceChannelsCreated = await createIncidentChannels();

      // Slack is asked for the channel once, and does not refuse it.
      expect(slack.askedToCreate()).toEqual([CHANNEL_NAME]);
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
    },
  );

  test("REGRESSION: the users the second rule invites join the channel", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, {
        template: "Incidents-",
        inviteUsers: [RULE_USER],
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.invites()).toEqual([{ channel: "C0NEW1", users: "U0RULE" }]);
    expect(result.membersNotAdded).toEqual([]);
  });

  test("REGRESSION: the incident keeps the channel, so its updates are posted there", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { template: "Incidents-" }),
    ];

    await createIncidentChannels();

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

  test("three rules, each template a different way of writing the name: one channel, with all three", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { template: "Incidents-" }),
      incidentRule(THIRD_RULE_ID, { template: "incidents -" }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.askedToCreate()).toEqual([CHANNEL_NAME]);
    expect(ruleIdsOf(result.channelsCreated)).toEqual([
      [
        FIRST_RULE_ID.toString(),
        SECOND_RULE_ID.toString(),
        THIRD_RULE_ID.toString(),
      ],
    ]);
  });

  test("a template that gives another name still gets a channel of its own", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID),
      incidentRule(SECOND_RULE_ID, { template: "Incidents-" }),
      incidentRule(OTHER_RULE_ID, { template: "Incident-" }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.askedToCreate()).toEqual([CHANNEL_NAME, "incident-inc-9"]);
    expect(ruleIdsOf(result.channelsCreated)).toEqual([
      [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()],
      [OTHER_RULE_ID.toString()],
    ]);
  });

  /*
   * Names are compared again as channels are created, against the channels
   * created already: a request that reaches that point unmerged is given
   * the channel too, rather than asking Slack for it a second time.
   */
  test("REGRESSION: a name asked for after its channel was created is given that channel, and its rule is added", async () => {
    const requests: Array<NotificationRuleChannelToCreate> = [
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [FIRST_RULE_ID.toString()],
      },
      {
        channelName: "Incidents-INC-9",
        notificationRuleId: SECOND_RULE_ID.toString(),
        notificationRuleIds: [SECOND_RULE_ID.toString()],
      },
    ];

    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getnotificationChannelssFromNotificationRules",
      )
      .mockReturnValue(requests);

    const channels: Array<NotificationRuleWorkspaceChannel> =
      await WorkspaceNotificationRuleService.createChannelsBasedOnRules({
        projectId: PROJECT_ID,
        projectOrUserAuthTokenForWorkspace: "xoxb-project",
        workspaceType: WorkspaceType.Slack,
        notificationRules: [],
        channelNameSiffix: INCIDENT_NUMBER_WITH_PREFIX,
        notificationEventType: NotificationRuleEventType.Incident,
      });

    expect(slack.askedToCreate()).toEqual([CHANNEL_NAME]);
    expect(ruleIdsOf(channels)).toEqual([
      [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()],
    ]);
  });
});

describe("Microsoft Teams: a rule whose template gives the name of a channel created already", () => {
  beforeEach(() => {
    teams.install();
    projectAuths = [teamsProjectAuth()];
  });

  test("REGRESSION: a template that differs only in case shares the channel in the same team, with both rules", async () => {
    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
      teamsIncidentRule(SECOND_RULE_ID, {
        template: "Incidents-",
        teamToCreateChannelIn: TEAM_X,
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: CHANNEL_NAME },
    ]);
    expect(result.channelsCreated).toEqual([
      {
        id: "19:new1@thread.tacv2",
        name: CHANNEL_NAME,
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAM_X,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
        ],
      },
    ]);
  });

  test("REGRESSION: a template with characters Teams drops shares the channel in the same team", async () => {
    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
      teamsIncidentRule(SECOND_RULE_ID, {
        template: "incidents!-",
        teamToCreateChannelIn: TEAM_X,
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: CHANNEL_NAME },
    ]);
    expect(ruleIdsOf(result.channelsCreated)).toEqual([
      [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()],
    ]);
  });

  test("REGRESSION: a rule with no team of its own, whose channel is created in the project's team, shares it with a rule that names that team", async () => {
    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID),
      teamsIncidentRule(SECOND_RULE_ID, {
        template: "Incidents-",
        teamToCreateChannelIn: TEAM_X,
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: CHANNEL_NAME },
    ]);
    expect(ruleIdsOf(result.channelsCreated)).toEqual([
      [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()],
    ]);
  });

  test("a name that differs only in case, in another team, is a channel of that team", async () => {
    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
      teamsIncidentRule(SECOND_RULE_ID, {
        template: "Incidents-",
        teamToCreateChannelIn: TEAM_Y,
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: CHANNEL_NAME },
      { teamId: TEAM_Y, displayName: "Incidents-inc-9" },
    ]);
    expect(ruleIdsOf(result.channelsCreated)).toEqual([
      [FIRST_RULE_ID.toString()],
      [SECOND_RULE_ID.toString()],
    ]);
  });

  test("the same name in another team is a channel of that team, not the first team's", async () => {
    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
      teamsIncidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: TEAM_Y }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: CHANNEL_NAME },
      { teamId: TEAM_Y, displayName: CHANNEL_NAME },
    ]);
    expect(
      result.channelsCreated.map(
        (channel: NotificationRuleWorkspaceChannel): Array<unknown> => {
          return [channel.teamId, channel.notificationRuleIds];
        },
      ),
    ).toEqual([
      [TEAM_X, [FIRST_RULE_ID.toString()]],
      [TEAM_Y, [SECOND_RULE_ID.toString()]],
    ]);
  });
});

describe("getnotificationChannelssFromNotificationRules, told the workspace", () => {
  function channelsFor(
    workspaceType: WorkspaceType,
    rules: Array<WorkspaceNotificationRule>,
  ): Array<NotificationRuleChannelToCreate> {
    return WorkspaceNotificationRuleService.getnotificationChannelssFromNotificationRules(
      {
        notificationEventType: NotificationRuleEventType.Incident,
        notificationRules: rules,
        channelNameSiffix: INCIDENT_NUMBER_WITH_PREFIX,
        workspaceType: workspaceType,
      },
    );
  }

  test("REGRESSION: Slack - names Slack creates as one channel are asked for once, with every rule, by the first rule's name", () => {
    expect(
      channelsFor(WorkspaceType.Slack, [
        incidentRule(FIRST_RULE_ID),
        incidentRule(OTHER_RULE_ID, { template: "war-room-" }),
        incidentRule(SECOND_RULE_ID, { template: "Incidents-" }),
        incidentRule(THIRD_RULE_ID, { template: "#incidents -" }),
      ]),
    ).toEqual([
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
          THIRD_RULE_ID.toString(),
        ],
      },
      {
        channelName: "war-room-inc-9",
        notificationRuleId: OTHER_RULE_ID.toString(),
        notificationRuleIds: [OTHER_RULE_ID.toString()],
      },
    ]);
  });

  test("REGRESSION: Microsoft Teams - names a team creates as one channel are asked for once; another team's are its own", () => {
    expect(
      channelsFor(WorkspaceType.MicrosoftTeams, [
        teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
        teamsIncidentRule(OTHER_RULE_ID, { teamToCreateChannelIn: TEAM_Y }),
        teamsIncidentRule(SECOND_RULE_ID, {
          template: "INCIDENTS!-",
          teamToCreateChannelIn: TEAM_X,
        }),
      ]),
    ).toEqual([
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: FIRST_RULE_ID.toString(),
        notificationRuleIds: [
          FIRST_RULE_ID.toString(),
          SECOND_RULE_ID.toString(),
        ],
        teamId: TEAM_X,
      },
      {
        channelName: CHANNEL_NAME,
        notificationRuleId: OTHER_RULE_ID.toString(),
        notificationRuleIds: [OTHER_RULE_ID.toString()],
        teamId: TEAM_Y,
      },
    ]);
  });

  test("Microsoft Teams keeps a space: a template with one asks for a name of its own", () => {
    expect(
      channelsFor(WorkspaceType.MicrosoftTeams, [
        teamsIncidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: TEAM_X }),
        teamsIncidentRule(SECOND_RULE_ID, {
          template: "incidents -",
          teamToCreateChannelIn: TEAM_X,
        }),
      ]).map((channel: NotificationRuleChannelToCreate): string => {
        return channel.channelName;
      }),
    ).toEqual([CHANNEL_NAME, "incidents -inc-9"]);
  });
});

describe("the name a workspace creates a channel by", () => {
  test("Slack lower-cases it and drops all but letters, digits, - and _", () => {
    expect(SlackUtil.getChannelNameToCreate("#Incidents -INC_9!")).toBe(
      "incidents-inc_9",
    );
  });

  test("Microsoft Teams keeps its case and spaces, and drops the characters a channel name cannot hold", () => {
    expect(
      MicrosoftTeamsUtil.getChannelNameToCreate("#Incidents -INC_9!"),
    ).toBe("Incidents -INC_9");
  });

  test("Slack: names it creates as the same name are one channel", () => {
    expect(
      SlackUtil.isSameChannelToCreate(
        { channelName: "Incidents -INC-9" },
        { channelName: CHANNEL_NAME },
      ),
    ).toBe(true);
    expect(
      SlackUtil.isSameChannelToCreate(
        { channelName: "incident-inc-9" },
        { channelName: CHANNEL_NAME },
      ),
    ).toBe(false);
  });

  test("Microsoft Teams: names a team creates as the same name, whatever their case, are one channel of that team only", () => {
    expect(
      MicrosoftTeamsUtil.isSameChannelToCreate(
        { channelName: "Incidents!-INC-9", teamId: TEAM_X },
        { channelName: CHANNEL_NAME, teamId: TEAM_X },
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsUtil.isSameChannelToCreate(
        { channelName: CHANNEL_NAME, teamId: TEAM_Y },
        { channelName: CHANNEL_NAME, teamId: TEAM_X },
      ),
    ).toBe(false);
    expect(
      MicrosoftTeamsUtil.isSameChannelToCreate(
        { channelName: "incidents -inc-9", teamId: TEAM_X },
        { channelName: CHANNEL_NAME, teamId: TEAM_X },
      ),
    ).toBe(false);
  });
});
