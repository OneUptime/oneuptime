import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Extensive tests for MicrosoftTeamsUtil.getAllWorkspaceChannels — the
 * Microsoft Graph call behind the dashboard's "browse Teams channels"
 * endpoint (GET /microsoft-teams/channels). It must:
 *
 * - resolve a Graph access token via getValidAccessToken,
 * - GET https://graph.microsoft.com/v1.0/teams/{teamId}/channels with a
 *   Bearer header,
 * - map the response's value[] into a Dictionary<WorkspaceChannel> keyed
 *   by channel id with name = displayName and
 *   workspaceType = MicrosoftTeams,
 * - rethrow HTTPErrorResponse results.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * Same botbuilder module factory as MicrosoftTeamsChats.test.ts — the
 * repo-wide manual mock does not expose everything MicrosoftTeams.ts
 * touches at import time.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn(),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { WorkspaceChannel } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../Types/API/URL";
import Headers from "../../../../Types/API/Headers";
import { JSONObject } from "../../../../Types/JSON";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { MessageFactory, CardFactory, TeamsInfo } from "botbuilder";

const GRAPH_TOKEN: string = "graph-token";
const AUTH_TOKEN: string = "stored-auth-token";
const TEAM_ID: string = "team-42";

interface CapturedGetCall {
  url: URL;
  headers: Headers;
}

function mockAccessToken(token?: string): jest.SpyInstance {
  return jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue(token === undefined ? GRAPH_TOKEN : token);
}

function mockGraphResponse(data: JSONObject): jest.SpyInstance {
  return jest
    .spyOn(API, "get")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, data, {}));
}

function channelJson(id: string, displayName?: string): JSONObject {
  const channel: JSONObject = { id: id };
  if (displayName !== undefined) {
    channel["displayName"] = displayName;
  }
  return channel;
}

async function callGetAllWorkspaceChannels(data?: {
  authToken?: string | undefined;
  projectId?: ObjectID | undefined;
  teamId?: string | undefined;
}): Promise<Dictionary<WorkspaceChannel>> {
  return MicrosoftTeamsUtil.getAllWorkspaceChannels({
    authToken: data?.authToken || AUTH_TOKEN,
    projectId: data?.projectId || ObjectID.generate(),
    teamId: data?.teamId || TEAM_ID,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The botbuilder module mock's jest.fn()s are shared across test files in
 * this suite run — jest.spyOn on an existing mock returns the same
 * function, so call history and mockResolvedValueOnce queues leak between
 * tests unless reset here.
 */
beforeEach(() => {
  (MessageFactory.text as jest.Mock).mockReset();
  (MessageFactory.attachment as jest.Mock).mockReset();
  (CardFactory.heroCard as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
});

describe("MicrosoftTeamsUtil.getAllWorkspaceChannels", () => {
  test("maps id and displayName into a WorkspaceChannel", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [channelJson("19:general@thread.tacv2", "General")],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(channels["19:general@thread.tacv2"]).toEqual({
      id: "19:general@thread.tacv2",
      name: "General",
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("keys the dictionary by channel id, not by name", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [channelJson("19:ops@thread.tacv2", "Ops")],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(Object.keys(channels)).toEqual(["19:ops@thread.tacv2"]);
    expect(channels["Ops"]).toBeUndefined();
  });

  test("calls the exact Graph URL for the given teamId", async () => {
    mockAccessToken();
    const getSpy: jest.SpyInstance = mockGraphResponse({ value: [] });

    await callGetAllWorkspaceChannels({ teamId: "my-team-id" });

    expect(getSpy).toHaveBeenCalledTimes(1);
    const callArg: CapturedGetCall = getSpy.mock
      .calls[0]?.[0] as CapturedGetCall;
    expect(callArg.url.toString()).toBe(
      "https://graph.microsoft.com/v1.0/teams/my-team-id/channels",
    );
  });

  test("sends the Bearer token from getValidAccessToken plus a JSON content type header", async () => {
    mockAccessToken("fresh-token-abc");
    const getSpy: jest.SpyInstance = mockGraphResponse({ value: [] });

    await callGetAllWorkspaceChannels();

    const callArg: CapturedGetCall = getSpy.mock
      .calls[0]?.[0] as CapturedGetCall;
    expect(callArg.headers).toEqual({
      Authorization: "Bearer fresh-token-abc",
      "Content-Type": "application/json",
    });
  });

  test("passes the caller's authToken and projectId to getValidAccessToken", async () => {
    const tokenSpy: jest.SpyInstance = mockAccessToken();
    mockGraphResponse({ value: [] });
    const projectId: ObjectID = ObjectID.generate();

    await callGetAllWorkspaceChannels({
      authToken: "caller-token",
      projectId: projectId,
    });

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(tokenSpy).toHaveBeenCalledWith({
      authToken: "caller-token",
      projectId: projectId,
    });
  });

  test("empty value[] returns an empty dictionary", async () => {
    mockAccessToken();
    mockGraphResponse({ value: [] });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(channels).toEqual({});
  });

  test("missing value key returns an empty dictionary", async () => {
    mockAccessToken();
    mockGraphResponse({});

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(channels).toEqual({});
  });

  test("HTTPErrorResponse from the Graph API is rethrown as-is", async () => {
    mockAccessToken();
    const errorResponse: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { error: "Forbidden" },
      {},
    );
    jest.spyOn(API, "get").mockResolvedValue(errorResponse);

    await expect(callGetAllWorkspaceChannels()).rejects.toBe(errorResponse);
  });

  test("a rejected API.get promise (network error) propagates", async () => {
    mockAccessToken();
    jest
      .spyOn(API, "get")
      .mockRejectedValue(new Error("socket hang up") as never);

    await expect(callGetAllWorkspaceChannels()).rejects.toThrow(
      "socket hang up",
    );
  });

  test("channel with a missing displayName is kept with an undefined name (pins current behavior)", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [
        channelJson("19:noname@thread.tacv2"),
        channelJson("19:named@thread.tacv2", "Named"),
      ],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    /*
     * The mapper casts displayName straight to string without a fallback,
     * so a Graph channel without displayName produces name === undefined.
     * If this ever becomes a real problem for consumers, fix the source —
     * this test just pins what the code does today.
     */
    expect(Object.keys(channels)).toHaveLength(2);
    expect(channels["19:noname@thread.tacv2"]?.name).toBeUndefined();
    expect(channels["19:named@thread.tacv2"]?.name).toBe("Named");
  });

  test("multiple channels are all present and correctly mapped", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [
        channelJson("19:general@thread.tacv2", "General"),
        channelJson("19:ops@thread.tacv2", "Ops War Room"),
        channelJson("19:eng@thread.tacv2", "Engineering"),
      ],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(Object.keys(channels)).toHaveLength(3);
    expect(channels["19:general@thread.tacv2"]?.name).toBe("General");
    expect(channels["19:ops@thread.tacv2"]?.name).toBe("Ops War Room");
    expect(channels["19:eng@thread.tacv2"]?.name).toBe("Engineering");
  });

  test("workspaceType is MicrosoftTeams on every returned entry", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [
        channelJson("19:a@thread.tacv2", "A"),
        channelJson("19:b@thread.tacv2", "B"),
        channelJson("19:c@thread.tacv2", "C"),
      ],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(Object.keys(channels)).toHaveLength(3);
    for (const channel of Object.values(channels)) {
      expect(channel.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    }
  });

  test("duplicate channel ids collapse to the LAST occurrence (dictionary upsert, pins current behavior)", async () => {
    mockAccessToken();
    mockGraphResponse({
      value: [
        channelJson("19:dup@thread.tacv2", "First name"),
        channelJson("19:dup@thread.tacv2", "Second name"),
      ],
    });

    const channels: Dictionary<WorkspaceChannel> =
      await callGetAllWorkspaceChannels();

    expect(Object.keys(channels)).toHaveLength(1);
    expect(channels["19:dup@thread.tacv2"]?.name).toBe("Second name");
  });

  test("API.get is called exactly once per invocation", async () => {
    mockAccessToken();
    const getSpy: jest.SpyInstance = mockGraphResponse({ value: [] });

    await callGetAllWorkspaceChannels();
    await callGetAllWorkspaceChannels();

    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  test("getValidAccessToken failure short-circuits before any Graph call", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockRejectedValue(new Error("token refresh failed") as never);
    const getSpy: jest.SpyInstance = jest.spyOn(API, "get");

    await expect(callGetAllWorkspaceChannels()).rejects.toThrow(
      "token refresh failed",
    );
    expect(getSpy).not.toHaveBeenCalled();
  });
});
