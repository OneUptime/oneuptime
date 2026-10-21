import Incident from "../../../Models/DatabaseModels/Incident";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import IncidentService from "../../../Server/Services/IncidentService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  WorkspaceChannelsCreated,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Dictionary from "../../../Types/Dictionary";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../Utils/API";
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

jest.mock("../../../Server/Utils/Logger");

/*
 * ONE CHANNEL THE WORKSPACE DOES NOT CREATE LOSES NONE OF THE OTHERS.
 *
 * The channels a record's rules ask for are created one after another.
 * When the workspace did not create one - Slack refuses to (restricted_action:
 * only admins may create channels), Microsoft Graph refuses its name, or
 * neither can be reached - its error ended the setup of the workspace's
 * channels. The channels created before it were
 * never returned and the ones after it never created, so the record kept
 * none of them (postUpdatesToWorkspaceChannels): nobody was invited to them,
 * and none of the record's updates were posted there.
 *
 * A channel the workspace does not create is now logged, in the server log
 * and on the record's Notification Logs, and the others are created and
 * kept. The "Test Rule" button still says why its channel was not created.
 *
 * The channels are created here through the real rule matching, channel
 * creation, SlackUtil and MicrosoftTeamsUtil, against fake Slack and
 * Microsoft Graph APIs that refuse the names the real ones refuse, or fail
 * as they are told to. Only the database is faked.
 *
 * A name the workspace refuses for its length or its first character is
 * not one of those any more: a rule's channel is named so the workspace
 * takes it (WorkspaceChannelName - Slack's 80 characters, Teams' 50, no
 * leading "_"), and the last tests here hold that such a name is created.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000002",
);

// The project's rules, read in this order: each asks for a channel of its own.
const FIRST_RULE_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000011",
);
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000012",
);
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000013",
);

// Members of the project with a Slack account connected to OneUptime.
const FIRST_RULE_USER: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000031",
);
const SECOND_RULE_USER: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000032",
);
const THIRD_RULE_USER: ObjectID = new ObjectID(
  "f2000000-0000-4000-8000-000000000033",
);

// Who presses "Test Rule": connected to Slack and to Microsoft Teams.
const TESTER: ObjectID = new ObjectID("f2000000-0000-4000-8000-000000000034");

const SLACK_USER_IDS: Dictionary<string> = {
  [FIRST_RULE_USER.toString()]: "U0FIRST",
  [SECOND_RULE_USER.toString()]: "U0SECOND",
  [THIRD_RULE_USER.toString()]: "U0THIRD",
  [TESTER.toString()]: "U0TESTER",
};

const TEAMS_USER_IDS: Dictionary<string> = {
  [TESTER.toString()]: "teams-user-tester",
};

const BOT_SLACK_USER_ID: string = "B0BOT";

// The channels INC-9's rules ask for, by their templates.
const INCIDENT_NUMBER_WITH_PREFIX: string = "INC-9";
// What INC-9's channels are named from, as IncidentWorkspaceMessages hands it.
const INCIDENT_CHANNEL_NAME_PARTS: WorkspaceChannelNameParts =
  WorkspaceChannelName.forNumberedRecord({
    eventType: NotificationRuleEventType.Incident,
    number: 9,
    numberWithPrefix: INCIDENT_NUMBER_WITH_PREFIX,
  });
const FIRST_CHANNEL_NAME: string = "incidents-inc-9";
const SECOND_CHANNEL_NAME: string = "war-room-inc-9";
const THIRD_CHANNEL_NAME: string = "on-call-inc-9";

// Slack refuses a channel name longer than this (invalid_name_maxlength).
const SLACK_CHANNEL_NAME_MAX_LENGTH: number = 80;
// Microsoft Teams refuses a channel name longer than this.
const TEAMS_CHANNEL_NAME_MAX_LENGTH: number = 50;

/*
 * A template that gives a name over Slack's 80 characters, and over the 100
 * characters a Notification Logs row keeps of a channel's name. The rule's
 * channel is named within Slack's 80 (WorkspaceChannelName).
 */
const OVER_LONG_TEMPLATE: string = "checkout-and-payments-".repeat(5);
const OVER_LONG_CHANNEL_NAME: string = `${OVER_LONG_TEMPLATE}inc-9`;

/*
 * The rule whose channel Slack refuses to create (restricted_action), or
 * whose name Microsoft Graph refuses, when told to.
 */
const REFUSED_TEMPLATE: string = "exec-";
const REFUSED_CHANNEL_NAME: string = "exec-inc-9";
const SLACK_REFUSAL: string = "Error from Slack restricted_action";

// What the fake Microsoft Graph answers for a channel name it refuses.
const TEAMS_REFUSED_NAME_MESSAGE: string = "Channel name is not valid.";

// The suffix "Test Rule" puts on the channel it creates.
const TEST_SUFFIX: string = "abcde";

// The Microsoft Teams team the channels are created in.
const TEAM_X: string = "aaaaaaaa-1111-2222-3333-444444444444";

interface RuleSwitches {
  workspaceType?: WorkspaceType;
  inviteUsers?: Array<ObjectID>;
  teamToCreateChannelIn?: string;
}

function incidentRule(
  id: ObjectID,
  template: string,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.name = "Incident channel";
  rule.workspaceType = switches.workspaceType || WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    newChannelTemplateName: template,
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
  template: string,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  return incidentRule(id, template, {
    ...switches,
    workspaceType: WorkspaceType.MicrosoftTeams,
  });
}

/*
 * How Slack fails to create a channel, other than by refusing its name: it
 * refuses to (restricted_action - the workspace lets only admins create
 * channels), answers an HTTP error, or cannot be reached.
 */
type SlackFailure = "restricted_action" | "http_error" | "unreachable";

interface SlackRequest {
  method: string;
  body: JSONObject;
}

/*
 * The Slack API, as far as creating a channel and adding people to it goes.
 * As Slack does, it refuses a name over 80 characters
 * (invalid_name_maxlength). Told to, it fails to create the channels whose
 * names start with a prefix: with an HTTP error, as after its retries, or
 * with no answer at all.
 */
class FakeSlack {
  public requests: Array<SlackRequest> = [];

  // Who is in each channel: the bot that created it, to begin with.
  public members: Dictionary<Array<string>> = {};

  private channels: Array<JSONObject> = [];

  private failures: Dictionary<SlackFailure> = {};

  public failToCreate(namePrefix: string, failure: SlackFailure): void {
    this.failures[namePrefix] = failure;
  }

  public install(): void {
    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: { toString: () => string };
      data: JSONObject;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const method: string = data.url.toString().split("/api/")[1] || "";
      const body: JSONObject = data.data || {};
      const channel: string = String(body["channel"] || "");

      this.requests.push({ method: method, body: body });

      let answer: JSONObject = { ok: true };

      if (method === "conversations.create") {
        const name: string = String(body["name"]);
        const failure: SlackFailure | undefined = this.failureToCreate(name);

        if (failure === "http_error") {
          return new HTTPErrorResponse(503, {}, {});
        }

        if (failure === "unreachable") {
          throw new APIException(
            "Request failed to https://slack.com/api/conversations.create. Connection timed out",
          );
        }

        if (failure === "restricted_action") {
          answer = { ok: false, error: "restricted_action" };
        } else if (name.length > SLACK_CHANNEL_NAME_MAX_LENGTH) {
          answer = { ok: false, error: "invalid_name_maxlength" };
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

  // Every method Slack was asked for, in the order it was asked.
  public methods(): Array<string> {
    return this.requests.map((request: SlackRequest): string => {
      return request.method;
    });
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

  private failureToCreate(name: string): SlackFailure | undefined {
    const namePrefix: string | undefined = Object.keys(this.failures).find(
      (prefix: string): boolean => {
        return name.startsWith(prefix);
      },
    );

    return namePrefix ? this.failures[namePrefix] : undefined;
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
 * Microsoft Graph, as far as creating a team's channels goes. It refuses
 * (400 Bad Request) a name over 50 characters, or one that starts with "_":
 * a Teams channel cannot have one. Told to, it refuses the names that start
 * with a prefix the same way.
 */
class FakeTeams {
  public requests: Array<TeamsChannelRequest> = [];

  private channels: Array<TeamsChannelRequest & { id: string }> = [];

  private refusedPrefixes: Array<string> = [];

  public refuse(namePrefix: string): void {
    this.refusedPrefixes.push(namePrefix);
  }

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

      if (
        displayName.length > TEAMS_CHANNEL_NAME_MAX_LENGTH ||
        displayName.startsWith("_") ||
        this.refusedPrefixes.some((prefix: string): boolean => {
          return displayName.startsWith(prefix);
        })
      ) {
        return new HTTPErrorResponse(
          400,
          {
            error: {
              code: "BadRequest",
              message: TEAMS_REFUSED_NAME_MESSAGE,
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

  // The names Microsoft Graph was asked to create, in the order it was asked.
  public askedToCreate(): Array<string> {
    return this.requests.map((request: TeamsChannelRequest): string => {
      return request.displayName;
    });
  }
}

let slack: FakeSlack;
let teams: FakeTeams;
let projectAuths: Array<WorkspaceProjectAuthToken>;
let storedRules: Array<WorkspaceNotificationRule>;
let incidentChannels: Array<NotificationRuleWorkspaceChannel>;
let channelCache: Dictionary<JSONObject>;
let logRows: Array<WorkspaceNotificationLog>;

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

// "Test Rule" is pressed for the rule: what it throws.
async function testRuleError(ruleId: ObjectID): Promise<unknown> {
  try {
    await WorkspaceNotificationRuleService.testRule({
      ruleId: ruleId,
      projectId: PROJECT_ID,
      testByUserId: TESTER,
      props: { isRoot: true },
    });
  } catch (err) {
    return err;
  }

  throw new Error("Test Rule did not fail");
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

// The project's Teams connection, made in the team given, or in none.
function teamsProjectAuth(
  teamId: string | undefined,
): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.MicrosoftTeams;
  auth.authToken = "graph-app-token";
  auth.workspaceProjectId = "tenant-1";

  auth.miscData = {
    tenantId: "tenant-1",
    botId: "bot-1",
    ...(teamId ? { teamId: teamId, teamName: "Ops" } : {}),
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

// Each channel as [id, name, the rules it is the channel of].
function channelsOf(
  channels: Array<NotificationRuleWorkspaceChannel>,
): Array<[string, string, Array<string>]> {
  return channels.map(
    (
      channel: NotificationRuleWorkspaceChannel,
    ): [string, string, Array<string>] => {
      return [channel.id, channel.name, channel.notificationRuleIds || []];
    },
  );
}

interface CreateChannelRow {
  status: WorkspaceNotificationStatus | undefined;
  channelId: string | undefined;
  channelName: string | undefined;
  statusMessage: string | undefined;
  incidentId: string | undefined;
}

// The Notification Logs rows written for the channels, in the order written.
function createChannelRows(): Array<CreateChannelRow> {
  return logRows
    .filter((row: WorkspaceNotificationLog): boolean => {
      return row.actionType === WorkspaceNotificationActionType.CreateChannel;
    })
    .map((row: WorkspaceNotificationLog): CreateChannelRow => {
      return {
        status: row.status,
        channelId: row.channelId,
        channelName: row.channelName,
        statusMessage: row.statusMessage,
        incidentId: row.incidentId?.toString(),
      };
    });
}

// A channel that was created, logged against the incident.
function createdRow(channelId: string, channelName: string): CreateChannelRow {
  return {
    status: WorkspaceNotificationStatus.Success,
    channelId: channelId,
    channelName: channelName,
    statusMessage: "Channel created successfully",
    incidentId: INCIDENT_ID.toString(),
  };
}

// A channel that was not created, logged against the incident (or, null, none).
function notCreatedRow(
  channelName: string,
  statusMessage: string,
  incidentId: ObjectID | null = INCIDENT_ID,
): CreateChannelRow {
  return {
    status: WorkspaceNotificationStatus.Error,
    channelId: undefined,
    channelName: channelName,
    statusMessage: statusMessage,
    incidentId: incidentId?.toString(),
  };
}

beforeEach(() => {
  slack = new FakeSlack();
  teams = new FakeTeams();

  projectAuths = [];
  storedRules = [];
  incidentChannels = [];
  channelCache = {};
  logRows = [];

  jest.mocked(logger.error).mockClear();

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

  // The rule "Test Rule" is pressed for.
  jest
    .spyOn(WorkspaceNotificationRuleService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<WorkspaceNotificationRule | null> => {
      return (
        storedRules.find((rule: WorkspaceNotificationRule): boolean => {
          return rule.id?.toString() === data.id.toString();
        }) || null
      );
    }) as never);

  // The channel "Test Rule" creates has a random suffix: this one.
  jest.spyOn(Text, "generateRandomText").mockReturnValue(TEST_SUFFIX);

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

  // Each person's own Slack and Microsoft Teams accounts, connected to OneUptime.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (data: {
      query: { userId: ObjectID; workspaceType: WorkspaceType };
    }): Promise<WorkspaceUserAuthToken | null> => {
      const workspaceUserId: string | undefined = (
        data.query.workspaceType === WorkspaceType.Slack
          ? SLACK_USER_IDS
          : TEAMS_USER_IDS
      )[data.query.userId.toString()];

      if (!workspaceUserId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.workspaceUserId = workspaceUserId;
      return userAuth;
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

describe("Slack: a channel Slack does not create, among an incident's channels", () => {
  beforeEach(() => {
    slack.install();
    projectAuths = [slackProjectAuth()];
  });

  test.each([
    {
      which: "the first",
      templates: [REFUSED_TEMPLATE, "war-room-", "on-call-"],
      kept: [
        ["C0NEW1", SECOND_CHANNEL_NAME, [SECOND_RULE_ID.toString()]],
        ["C0NEW2", THIRD_CHANNEL_NAME, [THIRD_RULE_ID.toString()]],
      ],
    },
    {
      which: "the second",
      templates: ["incidents-", REFUSED_TEMPLATE, "on-call-"],
      kept: [
        ["C0NEW1", FIRST_CHANNEL_NAME, [FIRST_RULE_ID.toString()]],
        ["C0NEW2", THIRD_CHANNEL_NAME, [THIRD_RULE_ID.toString()]],
      ],
    },
    {
      which: "the last",
      templates: ["incidents-", "war-room-", REFUSED_TEMPLATE],
      kept: [
        ["C0NEW1", FIRST_CHANNEL_NAME, [FIRST_RULE_ID.toString()]],
        ["C0NEW2", SECOND_CHANNEL_NAME, [SECOND_RULE_ID.toString()]],
      ],
    },
  ])(
    "REGRESSION: Slack refuses $which rule's channel - the incident keeps the other rules' channels, with their rules",
    async (data: { templates: Array<string>; kept: Array<unknown> }) => {
      slack.failToCreate(REFUSED_TEMPLATE, "restricted_action");

      storedRules = [
        incidentRule(FIRST_RULE_ID, data.templates[0]!),
        incidentRule(SECOND_RULE_ID, data.templates[1]!),
        incidentRule(THIRD_RULE_ID, data.templates[2]!),
      ];

      const result: WorkspaceChannelsCreated = await createIncidentChannels();

      // Slack is asked for every rule's channel, the refused one included.
      expect(slack.askedToCreate()).toEqual(
        data.templates.map((template: string): string => {
          return `${template}inc-9`;
        }),
      );
      expect(channelsOf(result.channelsCreated)).toEqual(data.kept);
    },
  );

  test.each([
    {
      failure: "Slack refuses to create it (restricted_action)",
      template: REFUSED_TEMPLATE,
      slackFailure: "restricted_action" as SlackFailure,
      statusMessage: SLACK_REFUSAL,
    },
    {
      failure: "Slack answers an HTTP error",
      template: "war-room-",
      slackFailure: "http_error" as SlackFailure,
      statusMessage: "Request failed with HTTP status 503",
    },
    {
      failure: "Slack cannot be reached",
      template: "war-room-",
      slackFailure: "unreachable" as SlackFailure,
      statusMessage:
        "Request failed to https://slack.com/api/conversations.create. Connection timed out",
    },
  ])(
    "REGRESSION: when $failure, the channels before and after it are created and kept, and it is listed on the incident's Notification Logs with what Slack answered",
    async (data: {
      template: string;
      slackFailure: SlackFailure | undefined;
      statusMessage: string;
    }) => {
      if (data.slackFailure) {
        slack.failToCreate(data.template, data.slackFailure);
      }

      storedRules = [
        incidentRule(FIRST_RULE_ID, "incidents-"),
        incidentRule(SECOND_RULE_ID, data.template),
        incidentRule(THIRD_RULE_ID, "on-call-"),
      ];

      const result: WorkspaceChannelsCreated = await createIncidentChannels();

      const notCreatedName: string = `${data.template}inc-9`;

      expect(slack.askedToCreate()).toEqual([
        FIRST_CHANNEL_NAME,
        notCreatedName,
        THIRD_CHANNEL_NAME,
      ]);
      expect(channelsOf(result.channelsCreated)).toEqual([
        ["C0NEW1", FIRST_CHANNEL_NAME, [FIRST_RULE_ID.toString()]],
        ["C0NEW2", THIRD_CHANNEL_NAME, [THIRD_RULE_ID.toString()]],
      ]);

      expect(createChannelRows()).toEqual([
        createdRow("C0NEW1", FIRST_CHANNEL_NAME),
        notCreatedRow(notCreatedName.substring(0, 100), data.statusMessage),
        createdRow("C0NEW2", THIRD_CHANNEL_NAME),
      ]);
    },
  );

  test("REGRESSION: the people the other rules invite join their channels, and the refused rule's people are invited nowhere", async () => {
    storedRules = [
      incidentRule(FIRST_RULE_ID, "incidents-", {
        inviteUsers: [FIRST_RULE_USER],
      }),
      incidentRule(SECOND_RULE_ID, REFUSED_TEMPLATE, {
        inviteUsers: [SECOND_RULE_USER],
      }),
      incidentRule(THIRD_RULE_ID, "on-call-", {
        inviteUsers: [THIRD_RULE_USER],
      }),
    ];
    slack.failToCreate(REFUSED_TEMPLATE, "restricted_action");

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(slack.invites()).toEqual([
      { channel: "C0NEW1", users: "U0FIRST" },
      { channel: "C0NEW2", users: "U0THIRD" },
    ]);
    expect(result.membersNotAdded).toEqual([]);

    const invitedRows: Array<WorkspaceNotificationLog> = logRows.filter(
      (row: WorkspaceNotificationLog): boolean => {
        return row.actionType === WorkspaceNotificationActionType.InviteUser;
      },
    );

    expect(
      invitedRows.map((row: WorkspaceNotificationLog): Array<unknown> => {
        return [row.channelId, row.userId?.toString()];
      }),
    ).toEqual([
      ["C0NEW1", FIRST_RULE_USER.toString()],
      ["C0NEW2", THIRD_RULE_USER.toString()],
    ]);
  });

  test("REGRESSION: the incident keeps the channels that were created, so its updates are posted there", async () => {
    slack.failToCreate("war-room-", "unreachable");

    storedRules = [
      incidentRule(FIRST_RULE_ID, "incidents-"),
      incidentRule(SECOND_RULE_ID, "war-room-"),
      incidentRule(THIRD_RULE_ID, "on-call-"),
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
    ).toEqual([["C0NEW1"], ["C0NEW2"]]);
  });

  test("every channel refused: the incident keeps none, and each is listed on its Notification Logs", async () => {
    slack.failToCreate("incidents-", "http_error");
    slack.failToCreate(REFUSED_TEMPLATE, "restricted_action");

    storedRules = [
      incidentRule(FIRST_RULE_ID, "incidents-"),
      incidentRule(SECOND_RULE_ID, REFUSED_TEMPLATE),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(result).toEqual({ channelsCreated: [], membersNotAdded: [] });
    expect(createChannelRows()).toEqual([
      notCreatedRow(FIRST_CHANNEL_NAME, "Request failed with HTTP status 503"),
      notCreatedRow(REFUSED_CHANNEL_NAME, SLACK_REFUSAL),
    ]);
  });

  /*
   * A rule's channel is named within the workspace's limit
   * (WorkspaceChannelName), so a name this long reaches the row only from
   * another caller: the row keeps what its column holds.
   */
  test("the row of a name too long for its column keeps the column's 100 characters, and its message names the channel whole", async () => {
    await WorkspaceNotificationLogService.logCreateChannelError(
      {
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        channelName: OVER_LONG_CHANNEL_NAME,
        error: "Error from Slack invalid_name_maxlength",
        incidentId: INCIDENT_ID,
      },
      { isRoot: true },
    );

    const row: WorkspaceNotificationLog | undefined = logRows.find(
      (logRow: WorkspaceNotificationLog): boolean => {
        return logRow.status === WorkspaceNotificationStatus.Error;
      },
    );

    expect(OVER_LONG_CHANNEL_NAME.length).toBeGreaterThan(100);
    expect(row?.channelName).toBe(OVER_LONG_CHANNEL_NAME.substring(0, 100));
    expect(row?.message).toBe(
      `Channel "${OVER_LONG_CHANNEL_NAME}" was not created`,
    );
  });

  test("the server log says which channel was not created, and what Slack answered", async () => {
    slack.failToCreate(REFUSED_TEMPLATE, "restricted_action");

    storedRules = [
      incidentRule(FIRST_RULE_ID, "incidents-"),
      incidentRule(SECOND_RULE_ID, REFUSED_TEMPLATE),
    ];

    await createIncidentChannels();

    expect(logger.error).toHaveBeenCalledWith(
      `Error creating channel ${REFUSED_CHANNEL_NAME}:`,
      { projectId: PROJECT_ID.toString() },
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: SLACK_REFUSAL,
      }),
      { projectId: PROJECT_ID.toString() },
    );
  });

  test("a failure to write the row does not stop the channels after it", async () => {
    jest
      .spyOn(WorkspaceNotificationLogService, "logCreateChannelError")
      .mockRejectedValue(new Error("database is down"));
    slack.failToCreate(REFUSED_TEMPLATE, "restricted_action");

    storedRules = [
      incidentRule(FIRST_RULE_ID, REFUSED_TEMPLATE),
      incidentRule(SECOND_RULE_ID, "war-room-"),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(channelsOf(result.channelsCreated)).toEqual([
      ["C0NEW1", SECOND_CHANNEL_NAME, [SECOND_RULE_ID.toString()]],
    ]);
  });
});

describe("A name the workspace used to refuse for its length or first character is created now", () => {
  test("Slack: a template past 80 characters gets its channel, shortened to 80, with the other rules' channels", async () => {
    slack.install();
    projectAuths = [slackProjectAuth()];

    storedRules = [
      incidentRule(FIRST_RULE_ID, "incidents-"),
      incidentRule(SECOND_RULE_ID, OVER_LONG_TEMPLATE),
      incidentRule(THIRD_RULE_ID, "on-call-"),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    // The prefix gives way; the incident's part, inc-9, stays whole.
    const shortened: string = WorkspaceChannelName.getChannelName({
      workspaceType: WorkspaceType.Slack,
      prefix: OVER_LONG_TEMPLATE,
      parts: INCIDENT_CHANNEL_NAME_PARTS,
    });

    expect(shortened).toHaveLength(SLACK_CHANNEL_NAME_MAX_LENGTH);
    expect(shortened.endsWith("inc-9")).toBe(true);
    expect(slack.askedToCreate()).toEqual([
      FIRST_CHANNEL_NAME,
      shortened,
      THIRD_CHANNEL_NAME,
    ]);
    expect(channelsOf(result.channelsCreated)).toEqual([
      ["C0NEW1", FIRST_CHANNEL_NAME, [FIRST_RULE_ID.toString()]],
      ["C0NEW2", shortened, [SECOND_RULE_ID.toString()]],
      ["C0NEW3", THIRD_CHANNEL_NAME, [THIRD_RULE_ID.toString()]],
    ]);
    expect(
      createChannelRows().every((row: CreateChannelRow): boolean => {
        return row.status === WorkspaceNotificationStatus.Success;
      }),
    ).toBe(true);
  });

  test.each([
    {
      used: 'started with "_"',
      template: "_war-room-",
      asked: SECOND_CHANNEL_NAME,
    },
    {
      used: "ran past 50 characters",
      template: "war-room-".repeat(6),
      asked: `${"war-room-".repeat(6).substring(0, TEAMS_CHANNEL_NAME_MAX_LENGTH - "inc-9".length)}inc-9`,
    },
  ])(
    "Microsoft Teams: a template that $used gets its channel, named as Teams takes it",
    async (data: { template: string; asked: string }) => {
      teams.install();
      projectAuths = [teamsProjectAuth(TEAM_X)];

      storedRules = [
        teamsIncidentRule(FIRST_RULE_ID, "incidents-", {
          teamToCreateChannelIn: TEAM_X,
        }),
        teamsIncidentRule(SECOND_RULE_ID, data.template, {
          teamToCreateChannelIn: TEAM_X,
        }),
      ];

      const result: WorkspaceChannelsCreated = await createIncidentChannels();

      expect(teams.askedToCreate()).toEqual([FIRST_CHANNEL_NAME, data.asked]);
      expect(data.asked.length).toBeLessThanOrEqual(
        TEAMS_CHANNEL_NAME_MAX_LENGTH,
      );
      expect(channelsOf(result.channelsCreated)).toEqual([
        [
          "19:new1@thread.tacv2",
          FIRST_CHANNEL_NAME,
          [FIRST_RULE_ID.toString()],
        ],
        ["19:new2@thread.tacv2", data.asked, [SECOND_RULE_ID.toString()]],
      ]);
    },
  );
});

describe("Microsoft Teams: a channel Microsoft Graph does not create, among an incident's channels", () => {
  beforeEach(() => {
    teams.install();
    projectAuths = [teamsProjectAuth(TEAM_X)];
  });

  test.each([{ refused: "it is told to refuse", template: REFUSED_TEMPLATE }])(
    "REGRESSION: Graph refuses a name $refused - the incident keeps the other rules' channels, and the refusal is logged with what Graph answered",
    async (data: { template: string }) => {
      teams.refuse(data.template);

      storedRules = [
        teamsIncidentRule(FIRST_RULE_ID, "incidents-", {
          teamToCreateChannelIn: TEAM_X,
        }),
        teamsIncidentRule(SECOND_RULE_ID, data.template, {
          teamToCreateChannelIn: TEAM_X,
        }),
        teamsIncidentRule(THIRD_RULE_ID, "on-call-", {
          teamToCreateChannelIn: TEAM_X,
        }),
      ];

      const result: WorkspaceChannelsCreated = await createIncidentChannels();

      const refusedName: string = `${data.template}inc-9`;

      expect(teams.askedToCreate()).toEqual([
        FIRST_CHANNEL_NAME,
        refusedName,
        THIRD_CHANNEL_NAME,
      ]);
      expect(
        result.channelsCreated.map(
          (channel: NotificationRuleWorkspaceChannel): Array<unknown> => {
            return [
              channel.id,
              channel.name,
              channel.teamId,
              channel.notificationRuleIds,
            ];
          },
        ),
      ).toEqual([
        [
          "19:new1@thread.tacv2",
          FIRST_CHANNEL_NAME,
          TEAM_X,
          [FIRST_RULE_ID.toString()],
        ],
        [
          "19:new2@thread.tacv2",
          THIRD_CHANNEL_NAME,
          TEAM_X,
          [THIRD_RULE_ID.toString()],
        ],
      ]);

      expect(createChannelRows()).toEqual([
        createdRow("19:new1@thread.tacv2", FIRST_CHANNEL_NAME),
        notCreatedRow(refusedName, TEAMS_REFUSED_NAME_MESSAGE),
        createdRow("19:new2@thread.tacv2", THIRD_CHANNEL_NAME),
      ]);
    },
  );

  test("REGRESSION: a rule with no team, in a project whose Teams connection names none, is logged - the rule with a team gets its channel", async () => {
    projectAuths = [teamsProjectAuth(undefined)];

    storedRules = [
      teamsIncidentRule(FIRST_RULE_ID, "incidents-"),
      teamsIncidentRule(SECOND_RULE_ID, "war-room-", {
        teamToCreateChannelIn: TEAM_X,
      }),
    ];

    const result: WorkspaceChannelsCreated = await createIncidentChannels();

    expect(teams.requests).toEqual([
      { teamId: TEAM_X, displayName: SECOND_CHANNEL_NAME },
    ]);
    expect(channelsOf(result.channelsCreated)).toEqual([
      [
        "19:new1@thread.tacv2",
        SECOND_CHANNEL_NAME,
        [SECOND_RULE_ID.toString()],
      ],
    ]);
    expect(createChannelRows()).toEqual([
      notCreatedRow(
        FIRST_CHANNEL_NAME,
        "teamId is required for Microsoft Teams channels",
      ),
      createdRow("19:new1@thread.tacv2", SECOND_CHANNEL_NAME),
    ]);
  });
});

describe('"Test Rule" still says why its channel was not created', () => {
  describe("Slack", () => {
    beforeEach(() => {
      slack.install();
      projectAuths = [slackProjectAuth()];
    });

    test.each([
      {
        failure: "Slack refuses to create it",
        template: REFUSED_TEMPLATE,
        slackFailure: "restricted_action" as SlackFailure,
        reason: SLACK_REFUSAL,
      },
      {
        failure: "Slack answers an HTTP error",
        template: "war-room-",
        slackFailure: "http_error" as SlackFailure,
        reason: "Request failed with HTTP status 503",
      },
      {
        failure: "Slack cannot be reached",
        template: "war-room-",
        slackFailure: "unreachable" as SlackFailure,
        reason:
          "Request failed to https://slack.com/api/conversations.create. Connection timed out",
      },
    ])(
      "REGRESSION: when $failure, the test fails with the reason, invites nobody and posts nothing",
      async (data: {
        template: string;
        slackFailure: SlackFailure | undefined;
        reason: string;
      }) => {
        if (data.slackFailure) {
          slack.failToCreate(data.template, data.slackFailure);
        }

        storedRules = [
          incidentRule(FIRST_RULE_ID, data.template, {
            inviteUsers: [FIRST_RULE_USER],
          }),
        ];

        const error: unknown = await testRuleError(FIRST_RULE_ID);

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as Error).message).toBe(
          `Cannot create a new channel. ${data.reason}`,
        );

        // Slack was asked to create the channel, and for nothing after it.
        expect(slack.methods()).toEqual(["conversations.create"]);

        // A test's channel is logged against no record.
        expect(createChannelRows()).toEqual([
          notCreatedRow(
            `${data.template}${TEST_SUFFIX}`.substring(0, 100),
            data.reason,
            null,
          ),
        ]);
      },
    );
  });

  describe("Microsoft Teams", () => {
    beforeEach(() => {
      teams.install();
      projectAuths = [teamsProjectAuth(TEAM_X)];
    });

    test("REGRESSION: a name Graph refuses fails the test with what Graph answered", async () => {
      teams.refuse(REFUSED_TEMPLATE);

      storedRules = [
        teamsIncidentRule(FIRST_RULE_ID, REFUSED_TEMPLATE, {
          teamToCreateChannelIn: TEAM_X,
        }),
      ];

      const error: unknown = await testRuleError(FIRST_RULE_ID);

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        `Cannot create a new channel. ${TEAMS_REFUSED_NAME_MESSAGE}`,
      );
      expect(teams.requests).toEqual([
        { teamId: TEAM_X, displayName: `${REFUSED_TEMPLATE}${TEST_SUFFIX}` },
      ]);
    });
  });
});
