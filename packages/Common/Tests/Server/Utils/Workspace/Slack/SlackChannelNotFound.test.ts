import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import { Service as WorkspaceNotificationSummaryService } from "../../../../../Server/Services/WorkspaceNotificationSummaryService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../../../Server/Utils/Notification/BlockedProjectNotifications";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../../Server/Utils/Workspace/Workspace";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceChannelNotFound from "../../../../../Server/Utils/Workspace/WorkspaceChannelNotFound";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceNotificationActionType from "../../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * #7115: A SLACK CHANNEL A RULE NAMES THAT SLACK CANNOT FIND IS SAID.
 *
 * A rule posting to existing channels by name - "#incidents" - posted in
 * the ones Slack found and left the others out in silence: misspelled,
 * renamed, deleted, or private without OneUptime's bot in it. Microsoft
 * Teams and Mattermost each answer such a channel with an error, which
 * the rule's Notification Logs show as an Error row; Slack answered none,
 * so the rule looked as if it had posted there, and the incident was never
 * seen in that channel.
 *
 * Now Slack answers each channel it cannot find with one, in the words
 * every place says it in (WorkspaceChannelNotFound): the rule's
 * Notification Logs get an Error row naming the channel and what to do; a
 * summary reports it once, as that channel's reason; and Test Rule
 * refuses such a channel in the same words.
 *
 * Slack is stood in for at the HTTP layer (API.post), answering as its
 * Web API does; the project's connection - one Slack workspace - and the
 * Notification Logs are stubbed rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "71150000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "71150000-0000-4000-8000-000000000002",
);

const SLACK_API: string = "https://slack.com/api/";
const BOT_TOKEN: string = "xoxb-acme";
const BOT_USER_ID: string = "U0BOT";

// The workspace's channels, as conversations.list lists them.
const SLACK_CHANNELS: Array<JSONObject> = [
  { id: "C0GEN", name: "general", is_archived: false },
  { id: "C0OPS", name: "ops", is_archived: false },
];

// What a channel Slack does not have is said with, as the logs say it.
function notFound(channelName: string): string {
  return `The Slack channel #${channelName} was not found. If it is a private channel, invite OneUptime's bot to it in Slack.`;
}

interface SlackCall {
  method: string;
  body: JSONObject;
}

let calls: Array<SlackCall> = [];
let logRows: Array<WorkspaceNotificationLog> = [];

function postedIn(): Array<string> {
  return calls
    .filter((call: SlackCall): boolean => {
      return call.method === "chat.postMessage";
    })
    .map((call: SlackCall): string => {
      return String(call.body["channel"]);
    });
}

function connection(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.workspaceProjectId = "T0ACME";
  auth.authToken = BOT_TOKEN;
  auth.miscData = {
    teamId: "T0ACME",
    teamName: "Acme",
    botUserId: BOT_USER_ID,
  } as SlackMiscData;
  return auth;
}

function payload(
  overrides: Partial<WorkspaceMessagePayload>,
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.Slack,
    channelNames: [],
    channelIds: [],
    messageBlocks: [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "**Incident #12** is acknowledged.",
      },
    ],
    ...overrides,
  } as WorkspaceMessagePayload;
}

// What SlackUtil.sendMessage answers for a rule's channels.
async function send(
  channelNames: Array<string>,
  overrides: Partial<WorkspaceMessagePayload> = {},
): Promise<WorkspaceSendMessageResponse> {
  return SlackUtil.sendMessage({
    workspaceMessagePayload: payload({
      channelNames: channelNames,
      ...overrides,
    }),
    authToken: BOT_TOKEN,
    userId: BOT_USER_ID,
    projectId: PROJECT_ID,
  });
}

beforeEach(() => {
  calls = [];
  logRows = [];

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const url: string = request.url.toString();
    const method: string = url.startsWith(SLACK_API)
      ? url.substring(SLACK_API.length)
      : url;

    calls.push({ method: method, body: { ...(request.data || {}) } });

    let answer: JSONObject;

    if (method === "conversations.list") {
      answer = {
        ok: true,
        channels: SLACK_CHANNELS,
        response_metadata: { next_cursor: "" },
      };
    } else if (method === "conversations.members") {
      answer = {
        ok: true,
        members: [BOT_USER_ID],
        response_metadata: { next_cursor: "" },
      };
    } else if (method === "chat.postMessage") {
      answer = {
        ok: true,
        channel: request.data["channel"],
        ts: "1762851600.000100",
      };
    } else {
      return new HTTPErrorResponse(404, { ok: false, error: "unknown" }, {});
    }

    return new HTTPResponse<JSONObject>(200, answer, {});
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(connection() as never);

  // Slack caches the channels it listed on the connection.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockResolvedValue(undefined as never);

  jest.spyOn(BlockedProjectNotifications, "isBlocked").mockResolvedValue(false);

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

describe("SlackUtil.sendMessage: a channel Slack cannot find", () => {
  test("is said: posted in the channel Slack found, and one error naming the one it did not, with what to do", async () => {
    const response: WorkspaceSendMessageResponse = await send([
      "#ops",
      "#incidnets",
    ]);

    expect(postedIn()).toEqual(["C0OPS"]);
    expect(response.threads).toHaveLength(1);
    expect(response.threads[0]!.channel.id).toBe("C0OPS");
    expect(response.errors).toEqual([
      {
        channel: {
          id: "",
          name: "incidnets",
          workspaceType: WorkspaceType.Slack,
        },
        error: notFound("incidnets"),
      },
    ]);
  });

  test("a channel named with or without its #, or with spaces: the same channel, said the same way", async () => {
    for (const written of [
      "incidnets",
      "#incidnets",
      "##incidnets",
      " #incidnets ",
    ]) {
      const response: WorkspaceSendMessageResponse = await send([written]);

      expect(response.errors).toHaveLength(1);
      expect(response.errors![0]!.error).toBe(notFound("incidnets"));
    }
  });

  test("none of the rule's channels found: nothing posted, an error each, in the rule's order", async () => {
    const response: WorkspaceSendMessageResponse = await send([
      "#gone",
      "#also-gone",
    ]);

    expect(postedIn()).toEqual([]);
    expect(response.threads).toEqual([]);
    expect(
      (response.errors || []).map(
        (error: { channel: WorkspaceChannel; error: string }): string => {
          return `${error.channel.name}: ${error.error}`;
        },
      ),
    ).toEqual([
      `gone: ${notFound("gone")}`,
      `also-gone: ${notFound("also-gone")}`,
    ]);
  });

  test("every channel found: no error, as before", async () => {
    const response: WorkspaceSendMessageResponse = await send([
      "#ops",
      "general",
    ]);

    expect(postedIn()).toEqual(["C0OPS", "C0GEN"]);
    expect(response.errors).toEqual([]);
  });

  test("a rule naming its Slack workspace: the error is that workspace's channel", async () => {
    const response: WorkspaceSendMessageResponse = await send(["#incidnets"], {
      teamId: "T0ACME",
    });

    expect(response.errors![0]!.channel).toEqual({
      id: "",
      name: "incidnets",
      workspaceType: WorkspaceType.Slack,
      teamId: "T0ACME",
    });
  });

  test("an installation that goes by another name tells its readers to invite its bot", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    const response: WorkspaceSendMessageResponse = await send(["#incidnets"]);

    expect(response.errors![0]!.error).toBe(
      "The Slack channel #incidnets was not found. If it is a private channel, invite Acme Status's bot to it in Slack.",
    );
  });
});

describe("a rule's Notification Logs: the channel Slack cannot find gets an Error row", () => {
  test("REGRESSION: a message about an incident, to a channel Slack has and one it has not - a Success row and an Error row naming the channel, both on the incident", async () => {
    // One payload per channel the rule names, as getMessageDestinations builds them.
    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: PROJECT_ID,
        messagePayloadsByWorkspace: [
          payload({ channelNames: ["ops"] }),
          payload({ channelNames: ["incidnets"] }),
        ],
      });

    await WorkspaceNotificationRuleService.logSendResponses({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: INCIDENT_ID },
      responses: responses,
      messageBlocksByWorkspaceTypes: [
        {
          workspaceType: WorkspaceType.Slack,
          messageBlocks: payload({}).messageBlocks,
        },
      ],
    });

    expect(postedIn()).toEqual(["C0OPS"]);
    expect(
      logRows.map((row: WorkspaceNotificationLog): Array<unknown> => {
        return [row.channelName, row.status, row.statusMessage];
      }),
    ).toEqual([
      [
        "ops",
        WorkspaceNotificationStatus.Success,
        "Message posted to workspace channel",
      ],
      ["incidnets", WorkspaceNotificationStatus.Error, notFound("incidnets")],
    ]);

    for (const row of logRows) {
      expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(row.workspaceType).toBe(WorkspaceType.Slack);
      expect(row.actionType).toBe(WorkspaceNotificationActionType.SendMessage);
      expect(row.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(row.message).toBe("**Incident #12** is acknowledged.");
    }
  });
});

describe("a summary's channel Slack cannot find is reported once, in Slack's words", () => {
  test("its reason is the sentence, said once - not twice, nor as a channel Slack did not answer for", async () => {
    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: PROJECT_ID,
        messagePayloadsByWorkspace: [payload({ channelNames: ["incidnets"] })],
      });

    expect(
      WorkspaceNotificationSummaryService.getChannelResult({
        channelName: "incidnets",
        workspaceType: WorkspaceType.Slack,
        responses: responses,
      }),
    ).toEqual({
      channelName: "incidnets",
      isPosted: false,
      channelId: undefined,
      reason: notFound("incidnets"),
    });
  });

  test("a Slack channel that drew no answer at all is still taken for one Slack could not find, in the same words", () => {
    expect(
      WorkspaceNotificationSummaryService.getChannelNotPostedReason({
        workspaceType: WorkspaceType.Slack,
        channelName: "#gone",
      }),
    ).toBe(notFound("gone"));
  });
});

describe("WorkspaceChannelNotFound: one sentence per workspace", () => {
  test("Slack: the channel as Slack writes it, with one #, however it was written", () => {
    for (const written of [
      "ops",
      "#ops",
      "##ops",
      "  #ops  ",
      // A name Slack could not have is still named as it was written.
      "#ops team",
    ]) {
      const name: string = written.trim().replace(/^#+/, "");

      expect(
        WorkspaceChannelNotFound.getReason({
          workspaceType: WorkspaceType.Slack,
          channelName: written,
        }),
      ).toBe(notFound(name));
    }
  });

  test("Mattermost and Microsoft Teams: as each said it before, the channel as it was written", () => {
    expect(
      WorkspaceChannelNotFound.getReason({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "war-room",
      }),
    ).toBe(
      "The Mattermost channel war-room was not found. If it is a private channel, add OneUptime's bot to it in Mattermost.",
    );
    expect(
      WorkspaceChannelNotFound.getReason({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
      }),
    ).toBe(
      'Channel "Incidents" was not found in this Microsoft Teams team. It may have been renamed or deleted.',
    );
  });

  test("an installation that goes by another name: its own name, where OneUptime's bot was named", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    expect(
      WorkspaceChannelNotFound.getReason({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "war-room",
      }),
    ).toBe(
      "The Mattermost channel war-room was not found. If it is a private channel, add Acme Status's bot to it in Mattermost.",
    );
    // Microsoft Teams names no bot.
    expect(
      WorkspaceChannelNotFound.getReason({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelName: "Incidents",
      }),
    ).not.toContain("Acme Status");
  });

  test("a workspace it has no sentence of its own for: the channel, not found", () => {
    expect(
      WorkspaceChannelNotFound.getReason({
        workspaceType: "Discord" as WorkspaceType,
        channelName: " ops ",
      }),
    ).toBe("The Discord channel ops was not found.");
  });
});
