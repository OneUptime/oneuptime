import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceProjectAuthToken, {
  MattermostMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import MattermostConnection from "../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

jest.mock("../../../Server/Utils/Logger");

/*
 * #6776: a Mattermost summary that picks a team posts only in that team's
 * channel of the name it gives. A summary's teamName holds the Mattermost
 * team's id (WorkspaceSummaryTable), handed to Mattermost as the team of its
 * channels; one that names none - or names one by what is not a Mattermost
 * id - looks in the default team first, as before.
 *
 * The summary is sent as the report worker and Send Test Now send it
 * (sendSummary), through the bot's real Mattermost calls, against a server
 * answered here: every team has a town-square channel, each its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const SERVER: string = "https://chat.example.com";
const ENGINEERING: string = "e".repeat(26);
const SUPPORT: string = "s".repeat(26);
const BOT_ID: string = "b".repeat(26);
const POST_ID: string = "m".repeat(26);

// Each team's own town-square.
const TOWN_SQUARE_OF: Record<string, string> = {
  [ENGINEERING]: "1".repeat(26),
  [SUPPORT]: "2".repeat(26),
};

interface ServerCall {
  method: string;
  path: string;
  body: JSONObject | undefined;
}

type Answer = HTTPResponse<JSONObject> | HTTPErrorResponse;

let calls: Array<ServerCall> = [];

// What the server answers: the channel of each team by its handle, and posts.
function answer(
  method: string,
): (args: { url: URL; data?: JSONObject | JSONArray }) => Promise<Answer> {
  return async (args: {
    url: URL;
    data?: JSONObject | JSONArray;
  }): Promise<Answer> => {
    const path: string = args.url.toString().replace(SERVER, "");

    calls.push({
      method: method,
      path: path,
      body: args.data as JSONObject | undefined,
    });

    const channelOfTeam: RegExpMatchArray | null = path.match(
      /^\/api\/v4\/teams\/([a-z0-9]{26})\/channels\/name\/town-square$/,
    );

    if (
      method === "GET" &&
      channelOfTeam &&
      TOWN_SQUARE_OF[channelOfTeam[1]!]
    ) {
      return new HTTPResponse<JSONObject>(
        200,
        {
          id: TOWN_SQUARE_OF[channelOfTeam[1]!]!,
          name: "town-square",
          display_name: "Town Square",
          type: "O",
          team_id: channelOfTeam[1]!,
        },
        {},
      );
    }

    if (method === "POST" && path === "/api/v4/posts") {
      return new HTTPResponse<JSONObject>(200, { id: POST_ID }, {});
    }

    return new HTTPErrorResponse(
      404,
      { id: "api.not_found", message: `No route for ${method} ${path}` },
      {},
    );
  };
}

function mattermostAuth(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Mattermost;
  auth.workspaceProjectId = ENGINEERING;
  auth.authToken = MattermostConnection.toAuthToken({
    serverUrl: SERVER,
    accessToken: "abcdefghijklmnopqrstuvwxyz",
    teamId: ENGINEERING,
    botUserId: BOT_ID,
  });
  auth.miscData = {
    serverUrl: SERVER,
    teamId: ENGINEERING,
    teamName: "engineering",
    teamDisplayName: "Engineering",
    botUserId: BOT_ID,
    botUsername: "oneuptime",
    teams: [
      { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
      { id: SUPPORT, name: "support", displayName: "Support" },
    ],
    teamsReadAt: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
  } as MattermostMiscData;

  return auth;
}

function summaryNaming(teamName?: string): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = SUMMARY_ID.toString();
  summary.projectId = PROJECT_ID;
  summary.name = "Weekly incidents";
  summary.workspaceType = WorkspaceType.Mattermost;
  summary.summaryType = WorkspaceNotificationSummaryType.Incident;
  summary.channelNames = ["town-square"];
  summary.summaryItems = [WorkspaceNotificationSummaryItem.All];
  summary.numberOfDaysOfData = 7;

  if (teamName !== undefined) {
    summary.teamName = teamName;
  }

  return summary;
}

// The teams a channel was looked for in, in order.
function teamsLookedIn(): Array<string> {
  return calls
    .filter((call: ServerCall): boolean => {
      return call.method === "GET" && call.path.includes("/channels/name/");
    })
    .map((call: ServerCall): string => {
      return call.path.split("/")[4]!;
    });
}

// The channels posted in.
function postedIn(): Array<string> {
  return calls
    .filter((call: ServerCall): boolean => {
      return call.method === "POST" && call.path === "/api/v4/posts";
    })
    .map((call: ServerCall): string => {
      return String(call.body?.["channel_id"]);
    });
}

async function send(summary: WorkspaceNotificationSummary): Promise<void> {
  jest
    .spyOn(WorkspaceNotificationSummaryService, "findOneById")
    .mockResolvedValue(summary as never);

  await WorkspaceNotificationSummaryService.sendSummary({
    summaryId: SUMMARY_ID,
    isTest: true,
  });
}

beforeEach(() => {
  calls = [];

  jest.spyOn(API, "get").mockImplementation(answer("GET") as never);
  jest.spyOn(API, "post").mockImplementation(answer("POST") as never);
  jest.spyOn(API, "put").mockImplementation(answer("PUT") as never);
  jest.spyOn(API, "delete").mockImplementation(answer("DELETE") as never);

  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  jest
    .spyOn(BlockedProjectNotifications, "isBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(mattermostAuth() as never);
  jest
    .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      WorkspaceNotificationSummaryService as unknown as {
        buildSummaryMessageBlocks: () => Promise<Array<JSONObject>>;
      },
      "buildSummaryMessageBlocks",
    )
    .mockResolvedValue([
      { _type: "WorkspacePayloadMarkdown", text: "3 incidents this week." },
    ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Mattermost summary naming the team of its channels", () => {
  test("posts only in that team's channel of the name: town-square of Support, not of the default team", async () => {
    await send(summaryNaming(SUPPORT));

    expect(teamsLookedIn()).toEqual([SUPPORT]);
    expect(postedIn()).toEqual([TOWN_SQUARE_OF[SUPPORT]]);
  });

  test("naming none: the default team's town-square, as before", async () => {
    await send(summaryNaming());

    expect(teamsLookedIn()).toEqual([ENGINEERING]);
    expect(postedIn()).toEqual([TOWN_SQUARE_OF[ENGINEERING]]);
  });

  test("a team named by what is not a Mattermost id - a Microsoft Teams team's name - names none: the default team's, as before", async () => {
    await send(summaryNaming("Engineering Team"));

    expect(teamsLookedIn()).toEqual([ENGINEERING]);
    expect(postedIn()).toEqual([TOWN_SQUARE_OF[ENGINEERING]]);
  });
});
