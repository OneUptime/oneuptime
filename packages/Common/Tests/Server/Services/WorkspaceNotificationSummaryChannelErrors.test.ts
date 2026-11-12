import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceProjectAuthToken, {
  MattermostMiscData,
  MicrosoftTeamsMiscData,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService, {
  WorkspaceLogData,
} from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationSummaryService, {
  WorkspaceSummaryTestNotPostedException,
} from "../../../Server/Services/WorkspaceNotificationSummaryService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import MattermostConnection from "../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import {
  WorkspaceChannel,
  WorkspaceThread,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import { WorkspaceSummaryTestChannel } from "../../../Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceSummaryNotSendableException } from "../../../Utils/Workspace/WorkspaceSummarySetup";

jest.mock("../../../Server/Utils/Logger");

/*
 * #6920: a workspace summary says what became of it in each channel it
 * names - in that channel's Notification Log, and in what Send Test Now
 * answers. A channel it was not posted in (not found, private without the
 * bot, refused by the workspace, a project not connected) is an Error in
 * the workspace's own words, never "sent successfully". Send Test Now fails
 * naming each such channel and why. A scheduled send does not fail for one
 * - the report worker would post it again a minute later in every channel
 * that did get it - and moves "Last Sent" only once a channel got it.
 *
 * A Microsoft Teams summary names its team as the form asks for it, by the
 * team's name: it is posted in the team of that name, found among the
 * teams of the project's connection, or among those Microsoft Graph lists
 * now - never handed to Graph as if it were the team's id.
 *
 * The summary is sent as the report worker (sendSummary) and Send Test Now
 * (testSummary) send it: through WorkspaceUtil and each workspace's own
 * sendMessage, against servers answered here - Slack's Web API, a
 * Mattermost server, and Microsoft Graph's team and channel listings; a
 * Microsoft Teams card is stubbed where it is posted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-000000000001",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-000000000002",
);
const TESTER_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-000000000003",
);

const SUMMARY_NAME: string = "Daily incidents";

// How a Notification Log names the summary.
const SUMMARY_LABEL: string = `Incident summary "${SUMMARY_NAME}"`;

// Why a summary cannot be sent, as a person reads it: what is missing, and where.
const NO_CHANNELS: string = "The summary has no channel to post in.";
const NO_ITEMS: string =
  "The summary has no items picked under What to Include.";

type Answer = HTTPResponse<JSONObject | JSONArray> | HTTPErrorResponse;

interface ServerCall {
  method: string;
  url: string;
  body: JSONObject | undefined;
}

let calls: Array<ServerCall> = [];

function ok(body: JSONObject | JSONArray): Answer {
  return new HTTPResponse<JSONObject | JSONArray>(200, body, {});
}

function refused(statusCode: number, body: JSONObject): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

// ─── Slack's Web API ───

const SLACK_API: string = "https://slack.com/api/";
const SLACK_BOT_ID: string = "U0BOT";

// The workspace's channels, as conversations.list lists them.
const SLACK_CHANNELS: Array<JSONObject> = [
  { id: "C0OPS", name: "ops" },
  { id: "C0ENGINEERING", name: "engineering" },
  { id: "C0ARCHIVE", name: "old-incidents" },
];

// The message chat.postMessage gives back in each channel.
const SLACK_TS: Record<string, string> = {
  C0OPS: "1760000000.000100",
  C0ENGINEERING: "1760000000.000200",
  C0ARCHIVE: "1760000000.000300",
};

// What chat.postMessage answers in a channel, by its id, instead of a post.
let slackRefusals: Record<string, Answer> = {};

function answerSlack(method: string, body: JSONObject | undefined): Answer {
  if (method === "conversations.list") {
    return ok({
      ok: true,
      channels: SLACK_CHANNELS,
      response_metadata: { next_cursor: "" },
    });
  }

  if (method === "conversations.members") {
    return ok({
      ok: true,
      members: [SLACK_BOT_ID],
      response_metadata: { next_cursor: "" },
    });
  }

  if (method === "chat.postMessage") {
    const channelId: string = String(body?.["channel"]);

    return (
      slackRefusals[channelId] ||
      ok({ ok: true, channel: channelId, ts: SLACK_TS[channelId]! })
    );
  }

  return refused(404, { ok: false, error: "unknown_method" });
}

// The Slack channels posted in, by id.
function slackPostedIn(): Array<string> {
  return calls
    .filter((call: ServerCall): boolean => {
      return call.url === `${SLACK_API}chat.postMessage`;
    })
    .map((call: ServerCall): string => {
      return String(call.body?.["channel"]);
    });
}

// ─── A Mattermost server ───

const MATTERMOST_SERVER: string = "https://chat.example.com";
const ENGINEERING_TEAM: string = "e".repeat(26);
const MATTERMOST_BOT_ID: string = "b".repeat(26);
const TOWN_SQUARE_ID: string = "1".repeat(26);
const STATUS_ID: string = "2".repeat(26);
const WAR_ROOM_ID: string = "3".repeat(26);
const MATTERMOST_POST_ID: string = "p".repeat(26);

interface MattermostChannelFixture {
  json: JSONObject;
  // Whether the bot is a member: it sees a private channel only then.
  isBotMember: boolean;
}

const MATTERMOST_CHANNELS: Array<MattermostChannelFixture> = [
  {
    json: {
      id: TOWN_SQUARE_ID,
      name: "town-square",
      display_name: "Town Square",
      type: "O",
      team_id: ENGINEERING_TEAM,
    },
    isBotMember: true,
  },
  {
    json: {
      id: STATUS_ID,
      name: "status-updates",
      display_name: "Status",
      type: "O",
      team_id: ENGINEERING_TEAM,
    },
    isBotMember: true,
  },
  // Private, and the bot is not in it: the bot cannot see it at all.
  {
    json: {
      id: WAR_ROOM_ID,
      name: "incident-war-room",
      display_name: "War Room",
      type: "P",
      team_id: ENGINEERING_TEAM,
    },
    isBotMember: false,
  },
];

// What POST /api/v4/posts answers in a channel, by its id, instead of a post.
let mattermostRefusals: Record<string, Answer> = {};

const CHANNEL_BY_HANDLE: RegExp =
  /^\/api\/v4\/teams\/([a-z0-9]{26})\/channels\/name\/([^/]+)$/;

function visibleMattermostChannels(): Array<JSONObject> {
  return MATTERMOST_CHANNELS.filter(
    (channel: MattermostChannelFixture): boolean => {
      return channel.json["type"] === "O" || channel.isBotMember;
    },
  ).map((channel: MattermostChannelFixture): JSONObject => {
    return channel.json;
  });
}

function answerMattermost(
  method: string,
  path: string,
  body: JSONObject | undefined,
): Answer {
  const byHandle: RegExpMatchArray | null = path.match(CHANNEL_BY_HANDLE);

  if (method === "GET" && byHandle && byHandle[1] === ENGINEERING_TEAM) {
    const channel: JSONObject | undefined = visibleMattermostChannels().find(
      (json: JSONObject): boolean => {
        return json["name"] === byHandle[2];
      },
    );

    if (channel) {
      return ok(channel);
    }
  }

  if (method === "GET" && path === "/api/v4/users/me/teams") {
    return ok([
      {
        id: ENGINEERING_TEAM,
        name: "engineering",
        display_name: "Engineering",
      },
    ]);
  }

  if (
    method === "GET" &&
    path === `/api/v4/teams/${ENGINEERING_TEAM}/channels`
  ) {
    return ok(
      visibleMattermostChannels().filter((json: JSONObject): boolean => {
        return json["type"] === "O";
      }),
    );
  }

  if (
    method === "GET" &&
    path ===
      `/api/v4/users/${MATTERMOST_BOT_ID}/teams/${ENGINEERING_TEAM}/channels`
  ) {
    return ok(
      MATTERMOST_CHANNELS.filter(
        (channel: MattermostChannelFixture): boolean => {
          return channel.isBotMember;
        },
      ).map((channel: MattermostChannelFixture): JSONObject => {
        return channel.json;
      }),
    );
  }

  if (method === "POST" && path === "/api/v4/posts") {
    const channelId: string = String(body?.["channel_id"]);

    return mattermostRefusals[channelId] || ok({ id: MATTERMOST_POST_ID });
  }

  return refused(404, {
    id: "api.context.404.app_error",
    message: `No route for ${method} ${path}`,
  });
}

// ─── Microsoft Graph and Microsoft Teams ───

// A team's id, as Graph knows it: the team named "Engineering Team".
const TEAM_ID: string = "6920e000-0000-4000-8000-00000000000a";

// Another team of the tenant: "Operations".
const OPERATIONS_TEAM_ID: string = "6920e000-0000-4000-8000-00000000000b";

// A team made after the project's connection read its teams: "Platform".
const PLATFORM_TEAM_ID: string = "6920e000-0000-4000-8000-00000000000c";

const TEAMS_CHANNELS: Array<JSONObject> = [
  {
    id: "19:general@thread.tacv2",
    displayName: "General",
    membershipType: "standard",
  },
  {
    id: "19:incidents@thread.tacv2",
    displayName: "Incidents",
    membershipType: "standard",
  },
];

// The channels of each team, as Graph lists them.
const TEAMS_CHANNELS_OF_TEAM: Record<string, Array<JSONObject>> = {
  [TEAM_ID]: TEAMS_CHANNELS,
  [PLATFORM_TEAM_ID]: [
    {
      id: "19:platform-general@thread.tacv2",
      displayName: "General",
      membershipType: "standard",
    },
  ],
};

// The message a card was posted as, in each channel.
const TEAMS_MESSAGE_ID: Record<string, string> = {
  "19:general@thread.tacv2": "1760000000001",
  "19:incidents@thread.tacv2": "1760000000002",
  "19:platform-general@thread.tacv2": "1760000000003",
};

// What posting a card in a channel throws, by the channel's id.
let teamsRefusals: Record<string, unknown> = {};

// The teams of the tenant, as Graph lists them now.
const GRAPH_TEAMS: Array<JSONObject> = [
  { id: TEAM_ID, displayName: "Engineering Team" },
  { id: OPERATIONS_TEAM_ID, displayName: "Operations" },
  { id: PLATFORM_TEAM_ID, displayName: "Platform" },
];

// What Graph answers instead of listing the tenant's teams.
let graphTeamsRefusal: HTTPErrorResponse | null = null;

const GRAPH_TEAM_CHANNELS: RegExp = /\/teams\/([^/]+)\/channels$/;
const GRAPH_TEAMS_LIST: RegExp = /\/v1\.0\/teams$/;

function answerGraph(url: string): Answer {
  if (GRAPH_TEAMS_LIST.test(url)) {
    return graphTeamsRefusal || ok({ value: GRAPH_TEAMS });
  }

  const teamId: string = decodeURIComponent(
    url.match(GRAPH_TEAM_CHANNELS)?.[1] || "",
  );

  const channels: Array<JSONObject> | undefined =
    TEAMS_CHANNELS_OF_TEAM[teamId];

  if (channels) {
    return ok({ value: channels });
  }

  return refused(404, {
    error: {
      code: "NotFound",
      message: `No team found with Group Id ${teamId}`,
    },
  });
}

// The Graph calls made: a team's channels read, or the tenant's teams listed.
function graphCalls(): Array<string> {
  return calls
    .filter((call: ServerCall): boolean => {
      return (
        GRAPH_TEAM_CHANNELS.test(call.url) || GRAPH_TEAMS_LIST.test(call.url)
      );
    })
    .map((call: ServerCall): string => {
      return call.url.substring(call.url.indexOf("/v1.0/"));
    });
}

// ─── Every server, as API answers ───

function answer(
  method: string,
): (args: { url: URL; data?: JSONObject | JSONArray }) => Promise<Answer> {
  return async (args: {
    url: URL;
    data?: JSONObject | JSONArray;
  }): Promise<Answer> => {
    const url: string = args.url.toString();
    const body: JSONObject | undefined = args.data as JSONObject | undefined;

    calls.push({ method: method, url: url, body: body });

    if (url.startsWith(SLACK_API)) {
      return answerSlack(url.substring(SLACK_API.length), body);
    }

    if (url.startsWith(MATTERMOST_SERVER)) {
      return answerMattermost(
        method,
        url.substring(MATTERMOST_SERVER.length),
        body,
      );
    }

    if (GRAPH_TEAM_CHANNELS.test(url) || GRAPH_TEAMS_LIST.test(url)) {
      return answerGraph(url);
    }

    return refused(404, { message: `Nothing answers ${method} ${url}` });
  };
}

// ─── The project's connections ───

function slackAuth(
  miscData: Partial<SlackMiscData> = {},
): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.workspaceProjectId = "T0ACME";
  auth.authToken = "xoxb-acme";
  auth.miscData = {
    teamId: "T0ACME",
    teamName: "Acme",
    botUserId: SLACK_BOT_ID,
    ...miscData,
  } as SlackMiscData;

  return auth;
}

/*
 * A Microsoft Teams connection as connecting saves it: the tenant's teams
 * Graph listed then (availableTeams) - Platform was made since - and no
 * team of its own.
 */
function teamsAuth(
  miscData: Partial<MicrosoftTeamsMiscData> = {},
): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth._id = "69200000-0000-4000-8000-0000000000aa";
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.MicrosoftTeams;
  auth.workspaceProjectId = "tenant-acme";
  auth.authToken = "graph-app-token";
  auth.miscData = {
    tenantId: "tenant-acme",
    botId: "bot-acme",
    availableTeams: {
      [TEAM_ID]: { id: TEAM_ID, name: "Engineering Team" },
      [OPERATIONS_TEAM_ID]: { id: OPERATIONS_TEAM_ID, name: "Operations" },
    },
    ...miscData,
  } as MicrosoftTeamsMiscData;

  return auth;
}

function mattermostAuth(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Mattermost;
  auth.workspaceProjectId = ENGINEERING_TEAM;
  auth.authToken = MattermostConnection.toAuthToken({
    serverUrl: MATTERMOST_SERVER,
    accessToken: "abcdefghijklmnopqrstuvwxyz",
    teamId: ENGINEERING_TEAM,
    botUserId: MATTERMOST_BOT_ID,
  });
  auth.miscData = {
    serverUrl: MATTERMOST_SERVER,
    teamId: ENGINEERING_TEAM,
    teamName: "engineering",
    teamDisplayName: "Engineering",
    botUserId: MATTERMOST_BOT_ID,
    botUsername: "oneuptime",
    teams: [
      {
        id: ENGINEERING_TEAM,
        name: "engineering",
        displayName: "Engineering",
      },
    ],
    teamsReadAt: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
  } as MattermostMiscData;

  return auth;
}

// The project's connection to each workspace: null for one not connected.
let connections: Partial<Record<WorkspaceType, WorkspaceProjectAuthToken>> = {};

// ─── The summary, and what sending it writes ───

let currentSummary: WorkspaceNotificationSummary | null = null;
let logs: Array<WorkspaceLogData> = [];
let summaryUpdates: Array<JSONObject> = [];
// What was written to the project's connections.
let connectionUpdates: Array<JSONObject> = [];
let isBlocked: SpyInstance<typeof BlockedProjectNotifications.isBlocked>;
let createWorkspaceLog: SpyInstance<
  typeof WorkspaceNotificationLogService.createWorkspaceLog
>;

function useSummary(data: {
  workspaceType: WorkspaceType;
  channelNames: Array<string>;
  teamName?: string | undefined;
}): void {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = SUMMARY_ID.toString();
  summary.projectId = PROJECT_ID;
  summary.name = SUMMARY_NAME;
  summary.workspaceType = data.workspaceType;
  summary.summaryType = WorkspaceNotificationSummaryType.Incident;
  summary.channelNames = data.channelNames;
  summary.summaryItems = [WorkspaceNotificationSummaryItem.All];
  summary.numberOfDaysOfData = 1;

  if (data.teamName !== undefined) {
    summary.teamName = data.teamName;
  }

  currentSummary = summary;
}

// As the report worker sends it.
async function sendScheduled(): Promise<void> {
  await WorkspaceNotificationSummaryService.sendSummary({
    summaryId: SUMMARY_ID,
  });
}

// As Send Test Now sends it.
async function sendTest(): Promise<void> {
  await WorkspaceNotificationSummaryService.testSummary({
    summaryId: SUMMARY_ID,
    projectId: PROJECT_ID,
    testByUserId: TESTER_ID,
    props: { isRoot: true },
  });
}

// What Send Test Now answers when the summary did not reach every channel.
async function testRefusal(): Promise<Error> {
  try {
    await sendTest();
  } catch (err) {
    return err as Error;
  }

  throw new Error("Send Test Now did not fail.");
}

/*
 * What Send Test Now's refusal says of each channel, for the Dashboard to
 * list in the reader's language: a test that a channel did not get is
 * refused with each channel of the summary, in its order - posted, or not
 * with why (WorkspaceSummaryTestNotPostedException).
 */
function testChannelsOf(refusal: Error): Array<WorkspaceSummaryTestChannel> {
  expect(refusal).toBeInstanceOf(WorkspaceSummaryTestNotPostedException);
  return (refusal as WorkspaceSummaryTestNotPostedException).channels;
}

// What a scheduled send throws, when it throws.
async function scheduledRefusal(): Promise<unknown> {
  try {
    await sendScheduled();
  } catch (err) {
    return err;
  }

  throw new Error("The scheduled send did not fail.");
}

// The Notification Log of a channel the summary was posted in.
function postedLog(data: {
  workspaceType: WorkspaceType;
  channelName: string;
  channelId: string;
  threadId: string;
  isTest: boolean;
}): WorkspaceLogData {
  return {
    projectId: PROJECT_ID,
    workspaceType: data.workspaceType,
    channelName: data.channelName,
    channelId: data.channelId,
    threadId: data.threadId,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Success,
    statusMessage: data.isTest
      ? "Test summary sent successfully"
      : "Summary sent successfully",
    message: `${SUMMARY_LABEL} sent to channel "${data.channelName}"`,
    userId: data.isTest ? TESTER_ID : undefined,
  };
}

// The Notification Log of a channel the summary was not posted in.
function notPostedLog(data: {
  workspaceType: WorkspaceType;
  channelName: string;
  reason: string;
  channelId?: string | undefined;
  isTest: boolean;
}): WorkspaceLogData {
  return {
    projectId: PROJECT_ID,
    workspaceType: data.workspaceType,
    channelName: data.channelName,
    channelId: data.channelId,
    actionType: WorkspaceNotificationActionType.SendMessage,
    status: WorkspaceNotificationStatus.Error,
    statusMessage: data.reason,
    message: `Failed to send ${SUMMARY_LABEL} to channel "${data.channelName}"`,
    userId: data.isTest ? TESTER_ID : undefined,
  };
}

// Whether "Last Sent" was moved.
function isLastSentMoved(): boolean {
  return summaryUpdates.some((update: JSONObject): boolean => {
    return update["lastSentAt"] instanceof Date;
  });
}

const SLACK_NOT_FOUND: (channelName: string) => string = (
  channelName: string,
): string => {
  return `The Slack channel ${channelName} was not found. If it is a private channel, invite OneUptime's bot to it in Slack.`;
};

beforeEach(() => {
  calls = [];
  logs = [];
  summaryUpdates = [];
  slackRefusals = {};
  mattermostRefusals = {};
  teamsRefusals = {};
  graphTeamsRefusal = null;
  connectionUpdates = [];
  currentSummary = null;
  connections = {
    [WorkspaceType.Slack]: slackAuth(),
    [WorkspaceType.MicrosoftTeams]: teamsAuth(),
    [WorkspaceType.Mattermost]: mattermostAuth(),
  };

  jest.spyOn(API, "get").mockImplementation(answer("GET") as never);
  jest.spyOn(API, "post").mockImplementation(answer("POST") as never);
  jest.spyOn(API, "put").mockImplementation(answer("PUT") as never);
  jest.spyOn(API, "delete").mockImplementation(answer("DELETE") as never);

  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);

  isBlocked = jest
    .spyOn(BlockedProjectNotifications, "isBlocked")
    .mockResolvedValue(false);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return connections[data.workspaceType] || null;
    }) as never);

  // Slack caches the channels it listed on the connection.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue("graph-access-token");

  // The app's token, as reading the tenant's teams again asks for it.
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        refreshAccessToken: () => Promise<string | null>;
      },
      "refreshAccessToken",
    )
    .mockResolvedValue("graph-app-token");

  // The teams read again, as they are kept on the connection.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }): Promise<void> => {
      connectionUpdates.push(data.data);
    }) as never);

  jest
    .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
    .mockImplementation((async (data: {
      workspaceChannel: WorkspaceChannel;
    }): Promise<WorkspaceThread> => {
      const refusal: unknown = teamsRefusals[data.workspaceChannel.id];

      if (refusal !== undefined) {
        throw refusal;
      }

      return {
        channel: data.workspaceChannel,
        threadId: TEAMS_MESSAGE_ID[data.workspaceChannel.id]!,
      };
    }) as never);

  createWorkspaceLog = jest
    .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
    .mockImplementation((async (data: WorkspaceLogData): Promise<void> => {
      logs.push(data);
    }) as never);

  jest
    .spyOn(WorkspaceNotificationSummaryService, "findOneById")
    .mockImplementation(
      (async (): Promise<WorkspaceNotificationSummary | null> => {
        return currentSummary;
      }) as never,
    );

  jest
    .spyOn(WorkspaceNotificationSummaryService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }): Promise<void> => {
      summaryUpdates.push(data.data);
    }) as never);

  jest
    .spyOn(
      WorkspaceNotificationSummaryService as unknown as {
        buildSummaryMessageBlocks: () => Promise<Array<JSONObject>>;
      },
      "buildSummaryMessageBlocks",
    )
    .mockResolvedValue([
      { _type: "WorkspacePayloadMarkdown", text: "2 incidents yesterday." },
    ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Slack summary", () => {
  test("posted in each of its channels: a Success log for each, with the message Slack gave back, and Last Sent moves", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "engineering"],
    });

    await sendScheduled();

    expect(slackPostedIn()).toEqual(["C0OPS", "C0ENGINEERING"]);
    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        channelId: "C0OPS",
        threadId: "1760000000.000100",
        isTest: false,
      }),
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "engineering",
        channelId: "C0ENGINEERING",
        threadId: "1760000000.000200",
        isTest: false,
      }),
    ]);
    expect(isLastSentMoved()).toBe(true);
  });

  test("Send Test Now that reached every channel succeeds, its logs naming who sent it, and leaves Last Sent alone", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });

    await sendTest();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        channelId: "C0OPS",
        threadId: "1760000000.000100",
        isTest: true,
      }),
    ]);
    expect(logs[0]!.userId?.toString()).toBe(TESTER_ID.toString());
    expect(summaryUpdates).toEqual([]);
  });

  test("Send Test Now with a channel Slack does not have fails, naming it and why; the channel that got it says so", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#gone"],
    });

    const refusal: Error = await testRefusal();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      `The test summary was not posted in 1 of its 2 channels. #gone: ${SLACK_NOT_FOUND("#gone")}`,
    );
    // Channel by channel, in the summary's order - never a channel's id.
    expect(testChannelsOf(refusal)).toStrictEqual([
      { channelName: "#ops", isPosted: true },
      {
        channelName: "#gone",
        isPosted: false,
        reason: SLACK_NOT_FOUND("#gone"),
      },
    ]);

    // The channel that exists still got it.
    expect(slackPostedIn()).toEqual(["C0OPS"]);
    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        channelId: "C0OPS",
        threadId: "1760000000.000100",
        isTest: true,
      }),
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#gone",
        reason: SLACK_NOT_FOUND("#gone"),
        isTest: true,
      }),
    ]);
    expect(summaryUpdates).toEqual([]);
  });

  test("Send Test Now in one channel Slack does not have names that channel alone", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["incidnets"],
    });

    const refusal: Error = await testRefusal();

    /*
     * The channel as the summary names it, and why in Slack's words: Slack
     * says each channel it cannot find (#7115), the way Slack writes a
     * channel - with its "#" - and that is said once.
     */
    expect(refusal.message).toBe(
      `The test summary was not posted in incidnets. ${SLACK_NOT_FOUND("#incidnets")}`,
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      {
        channelName: "incidnets",
        isPosted: false,
        reason: SLACK_NOT_FOUND("#incidnets"),
      },
    ]);
    expect(slackPostedIn()).toEqual([]);
  });

  test("a scheduled send with a channel Slack does not have does not fail: an Error log for it, a Success log for the other, and Last Sent moves", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#gone", "#ops"],
    });

    await sendScheduled();

    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#gone",
        reason: SLACK_NOT_FOUND("#gone"),
        isTest: false,
      }),
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        channelId: "C0OPS",
        threadId: "1760000000.000100",
        isTest: false,
      }),
    ]);
    expect(logs[0]!.userId).toBeUndefined();
    expect(isLastSentMoved()).toBe(true);
  });

  test("a scheduled send that reached no channel does not fail either, and Last Sent stays as it was", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#gone", "#also-gone"],
    });

    await sendScheduled();

    expect(
      logs.map((log: WorkspaceLogData): string => {
        return `${log.channelName} ${log.status}: ${log.statusMessage}`;
      }),
    ).toEqual([
      `#gone Error: ${SLACK_NOT_FOUND("#gone")}`,
      `#also-gone Error: ${SLACK_NOT_FOUND("#also-gone")}`,
    ]);
    expect(summaryUpdates).toEqual([]);
  });

  test("a channel Slack refuses to post in says what Slack answered, with the channel's id", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#old-incidents"],
    });
    slackRefusals["C0ARCHIVE"] = ok({ ok: false, error: "is_archived" });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in 1 of its 2 channels. #old-incidents: Error from Slack is_archived.",
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      { channelName: "#ops", isPosted: true },
      {
        channelName: "#old-incidents",
        isPosted: false,
        reason: "Error from Slack is_archived",
      },
    ]);
    expect(logs[1]).toEqual(
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#old-incidents",
        channelId: "C0ARCHIVE",
        reason: "Error from Slack is_archived",
        isTest: true,
      }),
    );
  });

  test("Slack answering with an HTTP error is said in its words, never [object Object]", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    slackRefusals["C0OPS"] = refused(429, { ok: false, error: "ratelimited" });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in #ops. ratelimited.",
    );
    expect(logs[0]!.statusMessage).toBe("ratelimited");
    expect(refusal.message).not.toContain("[object Object]");
    expect(testChannelsOf(refusal)).toStrictEqual([
      { channelName: "#ops", isPosted: false, reason: "ratelimited" },
    ]);
  });

  test("a project not connected to Slack: every channel says so, and the test says it once", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#engineering"],
    });
    delete connections[WorkspaceType.Slack];

    const notConnected: string =
      "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Workspace > Slack.";

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      `The test summary was not posted in any of its 2 channels. ${notConnected}`,
    );
    // Said once in the message; each channel still says it, for the list.
    expect(testChannelsOf(refusal)).toStrictEqual([
      { channelName: "#ops", isPosted: false, reason: notConnected },
      { channelName: "#engineering", isPosted: false, reason: notConnected },
    ]);
    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        reason: notConnected,
        isTest: true,
      }),
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#engineering",
        reason: notConnected,
        isTest: true,
      }),
    ]);
    expect(calls).toEqual([]);
  });

  test("a Slack connection OneUptime cannot post with (no bot user): reconnect it", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    connections[WorkspaceType.Slack] = slackAuth({ botUserId: "" });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in #ops. OneUptime cannot post in Slack with this project's connection. Please ask a project admin to reconnect Slack in Project Settings > Workspace > Slack.",
    );
    expect(logs[0]!.status).toBe(WorkspaceNotificationStatus.Error);
    expect(calls).toEqual([]);
  });

  test("a Slack connection without a token: reconnect it", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    const connection: WorkspaceProjectAuthToken = slackAuth();
    connection.authToken = "";
    connections[WorkspaceType.Slack] = connection;

    await sendScheduled();

    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        reason:
          "OneUptime cannot post in Slack with this project's connection. Please ask a project admin to reconnect Slack in Project Settings > Workspace > Slack.",
        isTest: false,
      }),
    ]);
    expect(summaryUpdates).toEqual([]);
  });

  test("a project a master admin blocked: nothing is posted, and each channel says why", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    isBlocked.mockResolvedValue(true);

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in #ops. Workspace message not sent: This project has been blocked. Please contact your administrator.",
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      {
        channelName: "#ops",
        isPosted: false,
        reason:
          "Workspace message not sent: This project has been blocked. Please contact your administrator.",
      },
    ]);
    expect(logs[0]!.statusMessage).toBe(
      "Workspace message not sent: This project has been blocked. Please contact your administrator.",
    );
    expect(calls).toEqual([]);
  });

  test("a channel named twice the ways Slack reads as one (#ops, ops, OPS) is posted in once", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "ops", " OPS ", "", "   "],
    });

    await sendTest();

    expect(slackPostedIn()).toEqual(["C0OPS"]);
    expect(
      logs.map((log: WorkspaceLogData): string | undefined => {
        return log.channelName;
      }),
    ).toEqual(["#ops"]);
  });

  test("a summary whose channel names are all blank is refused as having none, and nothing is posted or logged", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: [" ", ""],
    });

    const refusal: Error = await testRefusal();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect(refusal.message).toBe(NO_CHANNELS);
    // No channel was tried: the Dashboard says this message alone.
    expect(refusal).not.toBeInstanceOf(WorkspaceSummaryTestNotPostedException);
    expect(calls).toEqual([]);
    // A test is answered in its dialog: nothing in the Notification Logs.
    expect(logs).toEqual([]);
  });

  test("a channel name and a reason too long for the log's columns are cut to fit, so the log is still written", async () => {
    const longName: string = `#${"a".repeat(449)}`;

    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: [longName],
    });

    await sendScheduled();

    // Longer than its column (500) before it is cut.
    expect(SLACK_NOT_FOUND(longName).length).toBeGreaterThan(500);

    expect(logs).toHaveLength(1);
    expect(logs[0]!.channelName).toBe(longName.substring(0, 100));
    expect(logs[0]!.statusMessage).toBe(
      SLACK_NOT_FOUND(longName).substring(0, 500),
    );
    // The message column takes it whole.
    expect(logs[0]!.message).toBe(
      `Failed to send ${SUMMARY_LABEL} to channel "${longName}"`,
    );
  });

  test("a log that cannot be written never fails a summary that was posted", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#engineering"],
    });
    createWorkspaceLog.mockRejectedValue(new Error("Connection refused"));

    await sendTest();
    await sendScheduled();

    expect(slackPostedIn()).toEqual([
      "C0OPS",
      "C0ENGINEERING",
      "C0OPS",
      "C0ENGINEERING",
    ]);
    expect(createWorkspaceLog).toHaveBeenCalledTimes(4);
    expect(isLastSentMoved()).toBe(true);
  });

  test("a log that cannot be written leaves a failed test failed, with its reason", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#gone"],
    });
    createWorkspaceLog.mockRejectedValue(new Error("Connection refused"));

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      `The test summary was not posted in #gone. ${SLACK_NOT_FOUND("#gone")}`,
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      {
        channelName: "#gone",
        isPosted: false,
        reason: SLACK_NOT_FOUND("#gone"),
      },
    ]);
  });
});

describe("a summary that cannot be sent for a moment (the database)", () => {
  const DATABASE_DOWN: Error = new Error("Connection terminated unexpectedly");

  test("a channel whose send threw is that channel's failure: the channels after it are still posted in", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#engineering", "#ops"],
    });
    isBlocked.mockRejectedValueOnce(DATABASE_DOWN);

    await sendScheduled();

    expect(slackPostedIn()).toEqual(["C0OPS"]);
    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#engineering",
        reason: "Connection terminated unexpectedly",
        isTest: false,
      }),
      postedLog({
        workspaceType: WorkspaceType.Slack,
        channelName: "#ops",
        channelId: "C0OPS",
        threadId: "1760000000.000100",
        isTest: false,
      }),
    ]);
    // Posted somewhere: not sent again a minute later, and Last Sent moves.
    expect(isLastSentMoved()).toBe(true);
  });

  test("a scheduled send that reached no channel because a send threw throws it, for the report worker to send it again a minute later", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#engineering"],
    });
    isBlocked.mockRejectedValue(DATABASE_DOWN);

    const thrown: unknown = await scheduledRefusal();

    expect(thrown).toBe(DATABASE_DOWN);
    expect(thrown).not.toBeInstanceOf(WorkspaceSummaryTestNotPostedException);

    expect(slackPostedIn()).toEqual([]);
    expect(
      logs.map((log: WorkspaceLogData): string => {
        return `${log.channelName} ${log.status}: ${log.statusMessage}`;
      }),
    ).toEqual([
      "#ops Error: Connection terminated unexpectedly",
      "#engineering Error: Connection terminated unexpectedly",
    ]);
    expect(summaryUpdates).toEqual([]);
  });

  test("a scheduled send whose sends threw where others were not found throws too: nothing was posted, so nothing is posted twice", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#gone", "#ops"],
    });
    isBlocked.mockResolvedValueOnce(false).mockRejectedValueOnce(DATABASE_DOWN);

    expect(await scheduledRefusal()).toBe(DATABASE_DOWN);
    expect(slackPostedIn()).toEqual([]);
  });

  test("Send Test Now says it, in the words of what was thrown", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops", "#engineering"],
    });
    isBlocked.mockRejectedValue(DATABASE_DOWN);

    const refusal: Error = await testRefusal();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      "The test summary was not posted in any of its 2 channels. Connection terminated unexpectedly.",
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      {
        channelName: "#ops",
        isPosted: false,
        reason: "Connection terminated unexpectedly",
      },
      {
        channelName: "#engineering",
        isPosted: false,
        reason: "Connection terminated unexpectedly",
      },
    ]);
  });
});

describe("a Mattermost summary", () => {
  test("each channel says what Mattermost answered: posted, not found (private, the bot not in it), refused", async () => {
    useSummary({
      workspaceType: WorkspaceType.Mattermost,
      channelNames: ["town-square", "War Room", "Status"],
    });
    mattermostRefusals[STATUS_ID] = refused(500, {
      id: "api.post.create_post.app_error",
      message: "We could not save the post.",
    });

    const refusal: Error = await testRefusal();

    const notFound: string =
      "The Mattermost channel War Room was not found. If it is a private channel, add OneUptime's bot to it in Mattermost.";

    expect(refusal.message).toBe(
      `The test summary was not posted in 2 of its 3 channels. War Room: ${notFound} Status: Error from Mattermost: We could not save the post.`,
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      { channelName: "town-square", isPosted: true },
      { channelName: "War Room", isPosted: false, reason: notFound },
      {
        channelName: "Status",
        isPosted: false,
        reason: "Error from Mattermost: We could not save the post.",
      },
    ]);
    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "town-square",
        channelId: TOWN_SQUARE_ID,
        threadId: MATTERMOST_POST_ID,
        isTest: true,
      }),
      notPostedLog({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "War Room",
        reason: notFound,
        isTest: true,
      }),
      // Named as the summary names it, not by its handle (status-updates).
      notPostedLog({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "Status",
        channelId: STATUS_ID,
        reason: "Error from Mattermost: We could not save the post.",
        isTest: true,
      }),
    ]);
  });

  test("a channel found by the name people see it by is posted in, and logged by that name", async () => {
    useSummary({
      workspaceType: WorkspaceType.Mattermost,
      channelNames: ["Status", "~town-square"],
    });

    await sendScheduled();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "Status",
        channelId: STATUS_ID,
        threadId: MATTERMOST_POST_ID,
        isTest: false,
      }),
      postedLog({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "~town-square",
        channelId: TOWN_SQUARE_ID,
        threadId: MATTERMOST_POST_ID,
        isTest: false,
      }),
    ]);
    expect(isLastSentMoved()).toBe(true);
  });

  test("~town-square and town-square are one channel, posted in once", async () => {
    useSummary({
      workspaceType: WorkspaceType.Mattermost,
      channelNames: ["~town-square", "town-square", "#Town-Square"],
    });

    await sendTest();

    expect(
      calls.filter((call: ServerCall): boolean => {
        return call.method === "POST" && call.url.endsWith("/api/v4/posts");
      }),
    ).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  test("a project not connected to Mattermost says so, in Mattermost's name", async () => {
    useSummary({
      workspaceType: WorkspaceType.Mattermost,
      channelNames: ["town-square"],
    });
    delete connections[WorkspaceType.Mattermost];

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in town-square. This project is not connected to Mattermost. Please ask a project admin to connect Mattermost in Project Settings > Workspace > Mattermost.",
    );
  });
});

describe("a Microsoft Teams summary", () => {
  const NO_TEAM: string =
    "This summary does not name the Microsoft Teams team its channels are in. Please enter the team's name in the summary's Team Name.";

  const teamNotFound: (teamName: string) => string = (
    teamName: string,
  ): string => {
    return `The Microsoft Teams team "${teamName}" was not found. Please enter the team's name, as Microsoft Teams shows it, in the summary's Team Name.`;
  };

  const channelNotFound: (channelName: string) => string = (
    channelName: string,
  ): string => {
    return `Channel "${channelName}" was not found in this Microsoft Teams team. It may have been renamed or deleted.`;
  };

  // The teams whose channels Graph was asked for, each once.
  const teamsRead: () => Array<string> = (): Array<string> => {
    return Array.from(
      new Set(
        graphCalls().filter((call: string): boolean => {
          return call !== "/v1.0/teams";
        }),
      ),
    );
  };

  // How many times the tenant's teams were listed.
  const teamListings: () => number = (): number => {
    return graphCalls().filter((call: string): boolean => {
      return call === "/v1.0/teams";
    }).length;
  };

  test("the team named as the form asks for it - by its name, whatever its case and spaces - is posted in: its channels are read by the team's id", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: "  engineering TEAM ",
    });

    await sendTest();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:general@thread.tacv2",
        threadId: "1760000000001",
        isTest: true,
      }),
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
        channelId: "19:incidents@thread.tacv2",
        threadId: "1760000000002",
        isTest: true,
      }),
    ]);

    // Found among the teams the connection keeps: none listed again.
    expect(teamsRead()).toEqual([`/v1.0/teams/${TEAM_ID}/channels`]);
    expect(teamListings()).toBe(0);
    expect(connectionUpdates).toEqual([]);
  });

  test("a team named by its id - in any case - is posted in, as before", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: TEAM_ID.toUpperCase(),
    });

    await sendScheduled();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:general@thread.tacv2",
        threadId: "1760000000001",
        isTest: false,
      }),
    ]);
    expect(teamsRead()).toEqual([`/v1.0/teams/${TEAM_ID}/channels`]);
    expect(teamListings()).toBe(0);
    expect(isLastSentMoved()).toBe(true);
  });

  test("a channel the team does not have says so; the one it has is posted in", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Gone"],
      teamName: "Engineering Team",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      `The test summary was not posted in 1 of its 2 channels. Gone: ${channelNotFound("Gone")}`,
    );
    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:general@thread.tacv2",
        threadId: "1760000000001",
        isTest: true,
      }),
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Gone",
        reason: channelNotFound("Gone"),
        isTest: true,
      }),
    ]);
  });

  test("a team made since the connection read its teams is found by listing them again - once for all its channels - and the list is kept on the connection", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: "platform",
    });

    await sendScheduled();

    expect(graphCalls()[0]).toBe("/v1.0/teams");
    expect(teamListings()).toBe(1);
    expect(teamsRead()).toEqual([`/v1.0/teams/${PLATFORM_TEAM_ID}/channels`]);

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:platform-general@thread.tacv2",
        threadId: "1760000000003",
        isTest: false,
      }),
      // Platform has no Incidents channel: Microsoft Teams says so.
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
        reason: channelNotFound("Incidents"),
        isTest: false,
      }),
    ]);
    expect(isLastSentMoved()).toBe(true);

    // Kept for the next send, which finds the team without listing them.
    expect(connectionUpdates).toHaveLength(1);
    expect(
      Object.keys(
        (connectionUpdates[0]!["miscData"] as unknown as MicrosoftTeamsMiscData)
          .availableTeams || {},
      ),
    ).toEqual([TEAM_ID, OPERATIONS_TEAM_ID, PLATFORM_TEAM_ID]);
  });

  test("a team no one has: no channel is looked for, and each says the team was not found - the test says it once", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: "Enginering",
    });

    const refusal: Error = await testRefusal();

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      `The test summary was not posted in any of its 2 channels. ${teamNotFound("Enginering")}`,
    );
    expect(testChannelsOf(refusal)).toStrictEqual([
      {
        channelName: "General",
        isPosted: false,
        reason: teamNotFound("Enginering"),
      },
      {
        channelName: "Incidents",
        isPosted: false,
        reason: teamNotFound("Enginering"),
      },
    ]);
    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        reason: teamNotFound("Enginering"),
        isTest: true,
      }),
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
        reason: teamNotFound("Enginering"),
        isTest: true,
      }),
    ]);

    // Looked for once more among the teams Graph lists now; no channel read.
    expect(graphCalls()).toEqual(["/v1.0/teams"]);
  });

  test("a scheduled send to a team no one has does not fail, and Last Sent stays as it was", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "Enginering",
    });

    await sendScheduled();

    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        reason: teamNotFound("Enginering"),
        isTest: false,
      }),
    ]);
    expect(summaryUpdates).toEqual([]);
  });

  test("two teams of the name: which one is meant cannot be told, so neither is posted in", async () => {
    connections[WorkspaceType.MicrosoftTeams] = teamsAuth({
      availableTeams: {
        [TEAM_ID]: { id: TEAM_ID, name: "Ops" },
        [OPERATIONS_TEAM_ID]: { id: OPERATIONS_TEAM_ID, name: "ops " },
      },
    });
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "OPS",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      `The test summary was not posted in General. 2 Microsoft Teams teams are named "OPS". Please enter the id of the one to post in as the summary's Team Name: the groupId in the link to the team.`,
    );
    expect(graphCalls()).toEqual([]);
  });

  test("a summary that names no team posts in the connection's only team", async () => {
    connections[WorkspaceType.MicrosoftTeams] = teamsAuth({
      availableTeams: {
        [TEAM_ID]: { id: TEAM_ID, name: "Engineering Team" },
      },
    });
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
    });

    await sendScheduled();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:general@thread.tacv2",
        threadId: "1760000000001",
        isTest: false,
      }),
    ]);
  });

  test("a summary that names no team posts in the team the connection was saved with, when it has one", async () => {
    connections[WorkspaceType.MicrosoftTeams] = teamsAuth({
      teamId: TEAM_ID,
      teamName: "Engineering Team",
    });
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "   ",
    });

    await sendScheduled();

    expect(logs[0]!.status).toBe(WorkspaceNotificationStatus.Success);
    expect(teamsRead()).toEqual([`/v1.0/teams/${TEAM_ID}/channels`]);
  });

  test("a summary that names no team, of a connection with two or more: each channel says a team is needed", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
    });

    await sendScheduled();

    expect(logs).toEqual([
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        reason: NO_TEAM,
        isTest: false,
      }),
    ]);
    expect(summaryUpdates).toEqual([]);
    expect(graphCalls()).toEqual([]);
  });

  test("an id Graph does not list is handed to Graph, whose own words say why for each channel - never [object Object]", async () => {
    const unknownTeamId: string = "6920e000-0000-4000-8000-0000000000ff";

    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: unknownTeamId,
    });

    const refusal: Error = await testRefusal();

    // Graph's own answer, the same for each channel: said once.
    expect(refusal.message).toBe(
      `The test summary was not posted in any of its 2 channels. No team found with Group Id ${unknownTeamId}.`,
    );
    expect(
      logs.map((log: WorkspaceLogData): string => {
        return `${log.channelName}: ${log.statusMessage}`;
      }),
    ).toEqual([
      `General: No team found with Group Id ${unknownTeamId}`,
      `Incidents: No team found with Group Id ${unknownTeamId}`,
    ]);
    expect(refusal.message).not.toContain("[object Object]");
    expect(teamListings()).toBe(1);
  });

  test("teams that cannot be listed again say so, in the words of what failed", async () => {
    graphTeamsRefusal = refused(403, {
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation.",
      },
    });
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "Platform",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      `The test summary was not posted in General. The teams of this project's Microsoft Teams connection could not be read to find the team "Platform". Failed to fetch teams from Microsoft Teams.`,
    );
    expect(graphCalls()).toEqual(["/v1.0/teams"]);
    expect(connectionUpdates).toEqual([]);
  });

  test("an id is still handed to Graph when the teams cannot be listed again", async () => {
    graphTeamsRefusal = refused(503, {
      error: { code: "ServiceUnavailable", message: "Try again later." },
    });
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: PLATFORM_TEAM_ID,
    });

    await sendScheduled();

    expect(logs).toEqual([
      postedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "General",
        channelId: "19:platform-general@thread.tacv2",
        threadId: "1760000000003",
        isTest: false,
      }),
    ]);
  });

  test("a project a master admin blocked: no team is looked up, Graph is not asked, and each channel says why", async () => {
    isBlocked.mockResolvedValue(true);
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "Platform",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in General. Workspace message not sent: This project has been blocked. Please contact your administrator.",
    );
    expect(calls).toEqual([]);
    expect(connectionUpdates).toEqual([]);
  });

  test("a project not connected to Microsoft Teams says so, in Microsoft Teams' name, and Graph is not asked", async () => {
    delete connections[WorkspaceType.MicrosoftTeams];
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "Platform",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in General. This project is not connected to Microsoft Teams. Please ask a project admin to connect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
    );
    expect(calls).toEqual([]);
  });

  test("a connection without a token: reconnect it - no team is looked up", async () => {
    const connection: WorkspaceProjectAuthToken = teamsAuth();
    connection.authToken = "";
    connections[WorkspaceType.MicrosoftTeams] = connection;
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General"],
      teamName: "Platform",
    });

    const refusal: Error = await testRefusal();

    expect(refusal.message).toBe(
      "The test summary was not posted in General. OneUptime cannot post in Microsoft Teams with this project's connection. Please ask a project admin to reconnect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
    );
    expect(calls).toEqual([]);
  });

  test("a connection that cannot be read (the database) is each channel's failure, thrown for the report worker to send it again a minute later", async () => {
    const DATABASE_DOWN: Error = new Error(
      "Connection terminated unexpectedly",
    );

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockRejectedValueOnce(DATABASE_DOWN as never);
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: "Engineering Team",
    });

    expect(await scheduledRefusal()).toBe(DATABASE_DOWN);

    expect(
      logs.map((log: WorkspaceLogData): string => {
        return `${log.channelName} ${log.status}: ${log.statusMessage}`;
      }),
    ).toEqual([
      "General Error: Connection terminated unexpectedly",
      "Incidents Error: Connection terminated unexpectedly",
    ]);
    expect(graphCalls()).toEqual([]);
    expect(summaryUpdates).toEqual([]);
  });

  test("a card Teams refuses says what Teams answered, with the channel's id", async () => {
    useSummary({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelNames: ["General", "Incidents"],
      teamName: TEAM_ID,
    });
    teamsRefusals["19:incidents@thread.tacv2"] = refused(403, {
      error: {
        code: "Forbidden",
        message: "The bot is not part of the conversation roster.",
      },
    });

    await sendScheduled();

    expect(logs[1]).toEqual(
      notPostedLog({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
        channelId: "19:incidents@thread.tacv2",
        reason: "The bot is not part of the conversation roster.",
        isTest: false,
      }),
    );
    expect(logs[0]!.status).toBe(WorkspaceNotificationStatus.Success);
    expect(isLastSentMoved()).toBe(true);
  });
});

/*
 * #7116: a summary that cannot be sent as it is set up - no channel to post
 * in, nothing to include - is not sent, and says why where the project
 * looks: a scheduled send leaves one Error row in its Notification Logs, in
 * no channel, and throws WorkspaceSummaryNotSendableException, which the
 * report worker leaves alone (it does not try the summary again a minute
 * later). No workspace is asked anything for it.
 */
describe("a summary that cannot be sent as it is set up", () => {
  /*
   * The Notification Log of a scheduled send of such a summary: a channel's
   * failure without the channel, why it failed its status message - as a
   * channel's reason is. It said "...: it cannot be sent as it is set up"
   * before the reason, which then said it again.
   */
  function notSendableLog(reason: string): WorkspaceLogData {
    return {
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
      actionType: WorkspaceNotificationActionType.SendMessage,
      status: WorkspaceNotificationStatus.Error,
      statusMessage: reason,
      message: `Failed to send ${SUMMARY_LABEL}`,
    };
  }

  test("REGRESSION: a scheduled send of one whose channel names are all blank - refused as one that cannot be sent, with one Error row saying why, and no workspace asked", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: [" ", ""],
    });

    const refusal: unknown = await scheduledRefusal();

    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(NO_CHANNELS);
    expect(logs).toEqual([notSendableLog(NO_CHANNELS)]);
    // In no channel, and sent by no one.
    expect(logs[0]!.channelName).toBeUndefined();
    expect(logs[0]!.userId).toBeUndefined();
    expect(calls).toEqual([]);
    expect(isLastSentMoved()).toBe(false);
  });

  test("a scheduled send of one with nothing to include: the same, saying so", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    currentSummary!.summaryItems = [];

    const refusal: unknown = await scheduledRefusal();

    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect((refusal as Error).message).toBe(NO_ITEMS);
    expect(logs).toEqual([notSendableLog(NO_ITEMS)]);
    expect(slackPostedIn()).toEqual([]);
  });

  test("a scheduled send of one with no project: refused as one that cannot be sent, with nowhere to log it", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    delete currentSummary!.projectId;

    const refusal: unknown = await scheduledRefusal();

    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect((refusal as Error).message).toBe("Summary project ID not found");
    expect(logs).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("its Notification Log not written (the database): the send is still refused as one that cannot be sent, not as the database's failure", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: [],
    });
    createWorkspaceLog.mockRejectedValueOnce(
      new Error("connection terminated") as never,
    );

    const refusal: unknown = await scheduledRefusal();

    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect((refusal as Error).message).toBe(NO_CHANNELS);
  });

  test("Send Test Now of one with nothing to include: refused in the same words, and nothing logged - the dialog says it", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });
    currentSummary!.summaryItems = [];

    const refusal: Error = await testRefusal();

    expect(refusal).toBeInstanceOf(WorkspaceSummaryNotSendableException);
    expect(refusal.message).toBe(NO_ITEMS);
    expect(logs).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("REGRESSION: channels saved as the text the dashboard's edit form sent are posted in by name - not letter by letter", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: [],
    });
    currentSummary!.channelNames =
      "#ops, engineering" as unknown as Array<string>;

    await sendScheduled();

    expect(slackPostedIn()).toEqual(["C0OPS", "C0ENGINEERING"]);
    expect(
      logs.map((log: WorkspaceLogData): string => {
        return `${log.channelName} ${log.status}`;
      }),
    ).toEqual([
      `#ops ${WorkspaceNotificationStatus.Success}`,
      `engineering ${WorkspaceNotificationStatus.Success}`,
    ]);
    expect(isLastSentMoved()).toBe(true);
  });

  test("a summary that can be sent leaves no such row", async () => {
    useSummary({
      workspaceType: WorkspaceType.Slack,
      channelNames: ["#ops"],
    });

    await sendScheduled();

    expect(
      logs.some((log: WorkspaceLogData): boolean => {
        return log.message === notSendableLog(NO_CHANNELS).message;
      }),
    ).toBe(false);
    // Its one row is its channel's.
    expect(
      logs.map((log: WorkspaceLogData): string | undefined => {
        return log.channelName;
      }),
    ).toEqual(["#ops"]);
  });
});
