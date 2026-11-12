import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import BlockedProjectNotifications from "../../../../Server/Utils/Notification/BlockedProjectNotifications";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

jest.mock("../../../../Server/Utils/Logger");

/*
 * #6920: a message posted as the project's bot that its workspace was never
 * asked to send says why (WorkspaceSendMessageResponse.notSentReason) - a
 * project a master admin blocked, a workspace the project is not connected
 * to, a connection OneUptime cannot post with - so a caller that reports
 * each channel (a workspace summary's Notification Logs) says that, not
 * that the message was sent. And a send that throws what is not an Error -
 * Slack's and Microsoft Graph's own HTTP error response - is said in the
 * workspace's words, never "[object Object]".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "69200000-0000-4000-8000-0000000000b1",
);

const NOT_CONNECTED: Record<string, string> = {
  [WorkspaceType.Slack]:
    "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Workspace > Slack.",
  [WorkspaceType.MicrosoftTeams]:
    "This project is not connected to Microsoft Teams. Please ask a project admin to connect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
  [WorkspaceType.Mattermost]:
    "This project is not connected to Mattermost. Please ask a project admin to connect Mattermost in Project Settings > Workspace > Mattermost.",
};

const CANNOT_POST: Record<string, string> = {
  [WorkspaceType.Slack]:
    "OneUptime cannot post in Slack with this project's connection. Please ask a project admin to reconnect Slack in Project Settings > Workspace > Slack.",
  [WorkspaceType.MicrosoftTeams]:
    "OneUptime cannot post in Microsoft Teams with this project's connection. Please ask a project admin to reconnect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
  [WorkspaceType.Mattermost]:
    "OneUptime cannot post in Mattermost with this project's connection. Please ask a project admin to reconnect Mattermost in Project Settings > Workspace > Mattermost.",
};

const BLOCKED: string =
  "Workspace message not sent: This project has been blocked. Please contact your administrator.";

function payload(workspaceType: WorkspaceType): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: workspaceType,
    channelNames: ["incidents"],
    channelIds: [],
    messageBlocks: [],
  };
}

function connection(data: {
  workspaceType: WorkspaceType;
  authToken?: string | undefined;
  botUserId?: string | undefined;
}): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = data.workspaceType;
  auth.authToken = data.authToken === undefined ? "token" : data.authToken;
  auth.miscData = {
    botUserId: data.botUserId === undefined ? "B0BOT" : data.botUserId,
  } as never;
  return auth;
}

// The project's connection to each workspace; none when left out.
let connections: Partial<Record<WorkspaceType, WorkspaceProjectAuthToken>> = {};
let isBlocked: SpyInstance<typeof BlockedProjectNotifications.isBlocked>;
let getProjectAuth: SpyInstance<
  typeof WorkspaceProjectAuthTokenService.getProjectAuth
>;

function sentBy(workspaceType: WorkspaceType): WorkspaceSendMessageResponse {
  return {
    workspaceType: workspaceType,
    threads: [
      {
        channel: {
          id: "C0INCIDENTS",
          name: "incidents",
          workspaceType: workspaceType,
        },
        threadId: "1760.0001",
      },
    ],
    errors: [],
  };
}

async function post(
  workspaceTypes: Array<WorkspaceType>,
): Promise<Array<WorkspaceSendMessageResponse>> {
  return await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
    projectId: PROJECT_ID,
    messagePayloadsByWorkspace: workspaceTypes.map(payload),
  });
}

beforeEach(() => {
  connections = {};

  isBlocked = jest
    .spyOn(BlockedProjectNotifications, "isBlocked")
    .mockResolvedValue(false);

  getProjectAuth = jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken | null> => {
      return connections[data.workspaceType] || null;
    }) as never);

  jest
    .spyOn(SlackUtil, "sendMessage")
    .mockResolvedValue(sentBy(WorkspaceType.Slack));
  jest
    .spyOn(MicrosoftTeamsUtil, "sendMessage")
    .mockResolvedValue(sentBy(WorkspaceType.MicrosoftTeams));
  jest
    .spyOn(MattermostUtil, "sendMessage")
    .mockResolvedValue(sentBy(WorkspaceType.Mattermost));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceUtil.getCannotPostAsBotReason", () => {
  test.each([
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
    WorkspaceType.Mattermost,
  ])(
    "%s, not connected: connect it, and where",
    (workspaceType: WorkspaceType) => {
      expect(
        WorkspaceUtil.getCannotPostAsBotReason({
          workspaceType: workspaceType,
          isConnected: false,
        }),
      ).toBe(NOT_CONNECTED[workspaceType]);
    },
  );

  test.each([
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
    WorkspaceType.Mattermost,
  ])(
    "%s, connected but not to post with: reconnect it, and where",
    (workspaceType: WorkspaceType) => {
      expect(
        WorkspaceUtil.getCannotPostAsBotReason({
          workspaceType: workspaceType,
          isConnected: true,
        }),
      ).toBe(CANNOT_POST[workspaceType]);
    },
  );
});

describe("WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot says why it did not send", () => {
  test("a message sent says nothing of the kind", async () => {
    connections[WorkspaceType.Slack] = connection({
      workspaceType: WorkspaceType.Slack,
    });

    const response: WorkspaceSendMessageResponse = (
      await post([WorkspaceType.Slack])
    )[0]!;

    expect(response).toEqual(sentBy(WorkspaceType.Slack));
    expect(response.notSentReason).toBeUndefined();
  });

  test("a project a master admin blocked: every payload, and its workspaces are not asked", async () => {
    isBlocked.mockResolvedValue(true);

    const responses: Array<WorkspaceSendMessageResponse> = await post([
      WorkspaceType.Slack,
      WorkspaceType.Mattermost,
    ]);

    expect(responses).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        notSentReason: BLOCKED,
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        threads: [],
        notSentReason: BLOCKED,
      },
    ]);
    expect(getProjectAuth).not.toHaveBeenCalled();
    expect(SlackUtil.sendMessage).not.toHaveBeenCalled();
  });

  test("a workspace the project is not connected to: connect it - and the one it is connected to is still sent", async () => {
    connections[WorkspaceType.MicrosoftTeams] = connection({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    const responses: Array<WorkspaceSendMessageResponse> = await post([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]);

    expect(responses).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        notSentReason: NOT_CONNECTED[WorkspaceType.Slack],
      },
      sentBy(WorkspaceType.MicrosoftTeams),
      {
        workspaceType: WorkspaceType.Mattermost,
        threads: [],
        notSentReason: NOT_CONNECTED[WorkspaceType.Mattermost],
      },
    ]);
    expect(SlackUtil.sendMessage).not.toHaveBeenCalled();
  });

  test("a Slack connection without its bot user: reconnect it", async () => {
    connections[WorkspaceType.Slack] = connection({
      workspaceType: WorkspaceType.Slack,
      botUserId: "",
    });

    expect(await post([WorkspaceType.Slack])).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        notSentReason: CANNOT_POST[WorkspaceType.Slack],
      },
    ]);
    expect(SlackUtil.sendMessage).not.toHaveBeenCalled();
  });

  test.each([
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
    WorkspaceType.Mattermost,
  ])(
    "a %s connection without a token: reconnect it",
    async (workspaceType: WorkspaceType) => {
      connections[workspaceType] = connection({
        workspaceType: workspaceType,
        authToken: "",
      });

      expect(await post([workspaceType])).toEqual([
        {
          workspaceType: workspaceType,
          threads: [],
          notSentReason: CANNOT_POST[workspaceType],
        },
      ]);
    },
  );
});

describe("WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot says what a send threw, in its words", () => {
  beforeEach(() => {
    connections[WorkspaceType.Slack] = connection({
      workspaceType: WorkspaceType.Slack,
    });
    connections[WorkspaceType.MicrosoftTeams] = connection({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("Slack's HTTP error response, thrown as it is: Slack's error, never [object Object]", async () => {
    jest
      .spyOn(SlackUtil, "sendMessage")
      .mockRejectedValue(
        new HTTPErrorResponse(429, { ok: false, error: "ratelimited" }, {}),
      );

    const response: WorkspaceSendMessageResponse = (
      await post([WorkspaceType.Slack])
    )[0]!;

    expect(response.errors).toEqual([
      {
        channel: {
          id: "",
          name: "incidents",
          workspaceType: WorkspaceType.Slack,
        },
        error: "ratelimited",
      },
    ]);
    expect(response.notSentReason).toBeUndefined();
  });

  test("Microsoft Graph's HTTP error response: Graph's message", async () => {
    jest.spyOn(MicrosoftTeamsUtil, "sendMessage").mockRejectedValue(
      new HTTPErrorResponse(
        403,
        {
          error: {
            code: "Forbidden",
            message: "Missing role permissions on the request.",
          },
        },
        {},
      ),
    );

    const response: WorkspaceSendMessageResponse = (
      await post([WorkspaceType.MicrosoftTeams])
    )[0]!;

    expect(response.errors?.[0]?.error).toBe(
      "Missing role permissions on the request.",
    );
  });

  test("an HTTP error response with nothing to say: its status", async () => {
    jest
      .spyOn(SlackUtil, "sendMessage")
      .mockRejectedValue(new HTTPErrorResponse(503, {}, {}));

    const response: WorkspaceSendMessageResponse = (
      await post([WorkspaceType.Slack])
    )[0]!;

    expect(response.errors?.[0]?.error).toBe(
      "Request failed with HTTP status 503",
    );
  });

  test("an Error: its message; and a payload after one that threw is still sent", async () => {
    jest
      .spyOn(SlackUtil, "sendMessage")
      .mockRejectedValue(new Error("socket hang up"));

    const responses: Array<WorkspaceSendMessageResponse> = await post([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);

    expect(responses[0]!.errors?.[0]?.error).toBe("socket hang up");
    expect(responses[1]).toEqual(sentBy(WorkspaceType.MicrosoftTeams));
  });
});
