import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #4106: Microsoft Teams group chats were listed by their members'
 * names ("Alice, Bob, Carol + 4 more") instead of the name the group chat has
 * in Teams.
 *
 * Teams does not put a group chat's name on the bot activities OneUptime
 * captures chats from, so the name is read from Microsoft Graph
 * (GET /chats/{id}, which needs the ChatSettings.Read.Chat RSC permission).
 * Member names are only the fallback, for chats with no name or whose name
 * cannot be read.
 *
 * Covered here:
 * - getGroupChatTopicFromGraph: the Graph read and how each answer maps.
 * - capture (conversationUpdate / installationUpdate / message backfill):
 *   named group chats are stored under their name, and the roster is stored
 *   so the name can be rebuilt later.
 * - isChatCapturedForTenant: legacy group chats are re-captured once.
 * - refreshChatNamesForProject: what Refresh Chats does.
 * - renameChatsInProjectAuthTokens: the write behind a refresh.
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

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil, {
  MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION,
  MicrosoftTeamsChatNameRefreshResult,
  MicrosoftTeamsChatTopicLookup,
  MicrosoftTeamsChatTopicLookupStatus,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import {
  TeamsInfo,
  type TeamsChannelAccount,
  type TeamsPagedMembersResult,
  type TurnContext,
} from "botbuilder";

const BOT_RECIPIENT_ID: string = "bot-recipient-id";
const TENANT_ID: string = "tenant-1";
const ACCESS_TOKEN: string = "header.payload.signature";
const SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";

const GROUP_CHAT_ID: string = "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2";

// The chat from the issue: named in Teams, listed by its members in OneUptime.
const ISSUE_MEMBERS: Array<string> = [
  "Bibishek G S Steephensen [Contractor]",
  "Karthik Kallam [Contractor]",
  "Robin Example",
  "Sam Example",
];
// Cut at 80 characters, which is why the chats in the issue ended in "...".
const ISSUE_MEMBER_NAME: string =
  "Bibishek G S Steephensen [Contractor], Karthik Kallam [Contractor], Robin Examp…";

type ProjectIdLookup = (data: { tenantId: string }) => Promise<ObjectID | null>;

function getAnyProjectIdForTenant(): ProjectIdLookup {
  return (MicrosoftTeamsUtil as any).getAnyProjectIdForTenant.bind(
    MicrosoftTeamsUtil,
  );
}

function isChatCapturedForTenant(data: {
  tenantId: string;
  chatId: string;
  serviceUrl?: string | undefined;
}): Promise<boolean> {
  return (MicrosoftTeamsUtil as any).isChatCapturedForTenant(data);
}

function buildTurnContext(): TurnContext {
  return {
    activity: {
      recipient: { id: BOT_RECIPIENT_ID },
      serviceUrl: SERVICE_URL,
      conversation: { id: "ctx-conversation-id" },
    },
  } as unknown as TurnContext;
}

function mockMembers(members: Array<Partial<TeamsChannelAccount>>): void {
  (TeamsInfo.getPagedMembers as jest.Mock).mockResolvedValue({
    members: members as Array<TeamsChannelAccount>,
    continuationToken: undefined,
  } as unknown as TeamsPagedMembersResult);
}

function mockIssueMembers(): void {
  mockMembers([
    { id: BOT_RECIPIENT_ID, name: "OneUptime" },
    ...ISSUE_MEMBERS.map((name: string, index: number) => {
      return {
        id: `user-${index}`,
        name: name,
        aadObjectId: `aad-${index}`,
      };
    }),
  ]);
}

function graphOk(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function graphError(statusCode: number, body: JSONObject): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

function buildChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return {
    id: GROUP_CHAT_ID,
    name: ISSUE_MEMBER_NAME,
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-01T00:00:00.000Z",
    memberNames: [...ISSUE_MEMBERS],
    ...(overrides || {}),
  };
}

function buildAuthRow(data: {
  projectId?: ObjectID | undefined;
  workspaceProjectId?: string | undefined;
  availableChats?: Record<string, MicrosoftTeamsChat> | undefined;
  miscData?: MicrosoftTeamsMiscData | undefined;
}): WorkspaceProjectAuthToken {
  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row._id = ObjectID.generate().toString();
  if (data.projectId) {
    row.projectId = data.projectId;
  }
  if (data.workspaceProjectId !== undefined) {
    row.workspaceProjectId = data.workspaceProjectId;
  }
  row.miscData = (data.miscData ||
    (data.availableChats
      ? { availableChats: data.availableChats }
      : {})) as MicrosoftTeamsMiscData;
  return row;
}

let apiGetSpy: jest.SpyInstance;
let tokenSpy: jest.SpyInstance;

beforeEach(() => {
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();

  tokenSpy = jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue(ACCESS_TOKEN);

  // Every test that reaches Graph sets its own answer; the default is loud.
  apiGetSpy = jest.spyOn(API, "get").mockImplementation(async () => {
    throw new Error("Unexpected Graph call in test");
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ChatSettings.Read.Chat permission constant", () => {
  test("names the RSC permission Graph's GET /chats/{id} accepts for app-only tokens", () => {
    expect(MICROSOFT_TEAMS_CHAT_TOPIC_READ_PERMISSION).toBe(
      "ChatSettings.Read.Chat",
    );
  });
});

describe("MicrosoftTeamsUtil.getGroupChatTopicFromGraph", () => {
  const projectId: ObjectID = ObjectID.generate();

  async function lookup(
    chatId?: string,
  ): Promise<MicrosoftTeamsChatTopicLookup> {
    return MicrosoftTeamsUtil.getGroupChatTopicFromGraph({
      projectId: projectId,
      chatId: chatId === undefined ? GROUP_CHAT_ID : chatId,
    });
  }

  test("a named chat comes back as Found with its topic", async () => {
    apiGetSpy.mockResolvedValue(
      graphOk({
        id: GROUP_CHAT_ID,
        topic: "Platform On-Call",
        chatType: "group",
      }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });
  });

  test("calls GET /v1.0/chats/{id} with the chat id URL-encoded and only the fields it needs", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: "Platform On-Call" }));

    await lookup();

    expect(apiGetSpy).toHaveBeenCalledTimes(1);
    const args: { url: { toString: () => string }; headers: JSONObject } =
      apiGetSpy.mock.calls[0]![0];
    expect(args.url.toString()).toBe(
      `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(
        GROUP_CHAT_ID,
      )}?$select=id,topic,chatType`,
    );
    // The raw ':' and '@' of a Teams thread id never reach the path.
    expect(args.url.toString()).not.toContain("19:3a9c");
    expect(args.url.toString()).toContain("19%3A3a9c");
    expect(args.url.toString()).toContain("%40thread.v2");
  });

  test("authenticates with the project's app-only Graph token", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: "Platform On-Call" }));

    await lookup();

    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(tokenSpy.mock.calls[0]![0]).toMatchObject({ projectId: projectId });
    const args: { headers: JSONObject } = apiGetSpy.mock.calls[0]![0];
    expect(args.headers["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("the topic is trimmed", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ topic: "   Platform On-Call  \n" }));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });
  });

  test("a topic is returned whole — truncation is the display name's job", async () => {
    const longTopic: string = "Incident bridge ".repeat(12).trim();
    apiGetSpy.mockResolvedValue(graphOk({ topic: longTopic }));

    const result: MicrosoftTeamsChatTopicLookup = await lookup();
    expect(result.topic).toBe(longTopic);
  });

  test.each([
    ["null (Graph's answer for an unnamed group chat)", null],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a number", 42],
    ["an object", { value: "Platform On-Call" }],
  ])("topic that is %s is NoTopic", async (_label: string, topic: unknown) => {
    apiGetSpy.mockResolvedValue(graphOk({ id: GROUP_CHAT_ID, topic } as any));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
    });
  });

  test("a response without a topic field is NoTopic", async () => {
    apiGetSpy.mockResolvedValue(graphOk({ id: GROUP_CHAT_ID }));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
    });
  });

  test("403 (the chat has not granted ChatSettings.Read.Chat) is PermissionDenied", async () => {
    apiGetSpy.mockResolvedValue(
      graphError(403, {
        error: { code: "Forbidden", message: "Missing role permissions" },
      }),
    );

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
    });
  });

  test("Graph's Authorization_RequestDenied wording is PermissionDenied whatever the status", async () => {
    const response: HTTPErrorResponse = graphError(400, {
      error: {
        code: "Authorization_RequestDenied",
        message: "Insufficient privileges to complete the operation.",
      },
    });
    jest
      .spyOn(response, "message", "get")
      .mockReturnValue("Authorization_RequestDenied");
    apiGetSpy.mockResolvedValue(response);

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
    });
  });

  test.each([401, 404, 429, 500, 503])(
    "HTTP %s is Unknown, not PermissionDenied",
    async (statusCode: number) => {
      apiGetSpy.mockResolvedValue(
        graphError(statusCode, { error: { code: "Something" } }),
      );

      await expect(lookup()).resolves.toEqual({
        status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
      });
    },
  );

  test("no Graph token (getValidAccessToken throws) is Unknown and never calls Graph", async () => {
    tokenSpy.mockRejectedValue(new Error("no token"));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
    expect(apiGetSpy).not.toHaveBeenCalled();
  });

  test("a network failure (API.get throws) is Unknown — the lookup never throws", async () => {
    apiGetSpy.mockRejectedValue(new Error("ECONNRESET"));

    await expect(lookup()).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
  });

  test("an empty chat id is Unknown and makes no calls at all", async () => {
    await expect(lookup("")).resolves.toEqual({
      status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
    });
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(apiGetSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.getAnyProjectIdForTenant", () => {
  test("queries Microsoft Teams connections of the tenant as root", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await getAnyProjectIdForTenant()({ tenantId: TENANT_ID });

    expect(findBySpy).toHaveBeenCalledWith({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TENANT_ID,
      },
      select: { _id: true, projectId: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("returns the first connection that has a project id", async () => {
    const projectId: ObjectID = ObjectID.generate();
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([
        buildAuthRow({}),
        buildAuthRow({ projectId: projectId }),
        buildAuthRow({ projectId: ObjectID.generate() }),
      ]);

    await expect(
      getAnyProjectIdForTenant()({ tenantId: TENANT_ID }),
    ).resolves.toBe(projectId);
  });

  test("null when the tenant has no connected project", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await expect(
      getAnyProjectIdForTenant()({ tenantId: TENANT_ID }),
    ).resolves.toBeNull();
  });

  test("null (not a throw) when the lookup fails", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      getAnyProjectIdForTenant()({ tenantId: TENANT_ID }),
    ).resolves.toBeNull();
  });
});

describe("chat capture reads the group chat's name from Graph", () => {
  const projectId: ObjectID = ObjectID.generate();
  let saveSpy: jest.SpyInstance;
  let projectLookupSpy: jest.SpyInstance;
  let topicSpy: jest.SpyInstance;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil, "removeChatFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil as any, "sendWelcomeAdaptiveCard")
      .mockResolvedValue(undefined as never);
    projectLookupSpy = jest
      .spyOn(MicrosoftTeamsUtil as any, "getAnyProjectIdForTenant")
      .mockResolvedValue(projectId as never);
    topicSpy = jest.spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph");
  });

  function mockTopic(lookup: MicrosoftTeamsChatTopicLookup): void {
    topicSpy.mockResolvedValue(lookup);
  }

  function botAddedToGroupChat(conversation?: JSONObject): JSONObject {
    return {
      membersAdded: [{ id: BOT_RECIPIENT_ID }],
      conversation: conversation || {
        conversationType: "groupChat",
        id: GROUP_CHAT_ID,
      },
      channelData: { tenant: { id: TENANT_ID } },
      serviceUrl: SERVICE_URL,
    };
  }

  async function addBot(conversation?: JSONObject): Promise<void> {
    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: botAddedToGroupChat(conversation),
      turnContext: buildTurnContext(),
    });
  }

  function savedChat(): MicrosoftTeamsChat {
    expect(saveSpy).toHaveBeenCalledTimes(1);
    return (saveSpy.mock.calls[0]![0] as { chat: MicrosoftTeamsChat }).chat;
  }

  test("the issue: a named group chat is saved under its name, not its members", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe("Platform On-Call");
    expect(chat.name).not.toContain("Contractor");
    expect(chat.chatType).toBe("groupChat");
  });

  test("Graph is asked about this chat, with a project of the activity's tenant", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await addBot();

    expect(projectLookupSpy).toHaveBeenCalledWith({ tenantId: TENANT_ID });
    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy).toHaveBeenCalledWith({
      projectId: projectId,
      chatId: GROUP_CHAT_ID,
    });
  });

  test("the roster is stored with the chat, bot and blank names left out", async () => {
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice", aadObjectId: "aad-1" },
      { id: "user-2", name: "   " },
      { id: "user-3", name: "Bob", aadObjectId: "aad-3" },
    ]);
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.memberNames).toEqual(["Alice", "Bob"]);
    expect(chat.memberAadObjectIds).toEqual(["aad-1", "aad-3"]);
  });

  test("an unnamed group chat (NoTopic) falls back to its members' names", async () => {
    mockIssueMembers();
    mockTopic({ status: MicrosoftTeamsChatTopicLookupStatus.NoTopic });

    await addBot();

    expect(savedChat().name).toBe(ISSUE_MEMBER_NAME);
  });

  test("when Graph refuses (PermissionDenied) the chat is still saved, under its members' names", async () => {
    mockIssueMembers();
    mockTopic({ status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied });

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe(ISSUE_MEMBER_NAME);
    expect(chat.memberNames).toEqual(ISSUE_MEMBERS);
  });

  test("when Graph fails (Unknown) the chat is still saved, under its members' names", async () => {
    mockIssueMembers();
    mockTopic({ status: MicrosoftTeamsChatTopicLookupStatus.Unknown });

    await addBot();

    expect(savedChat().name).toBe(ISSUE_MEMBER_NAME);
  });

  test("a name on the activity itself is used as is, and Graph is not called", async () => {
    mockIssueMembers();

    await addBot({
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      name: "Ops War Room",
    });

    expect(savedChat().name).toBe("Ops War Room");
    expect(topicSpy).not.toHaveBeenCalled();
    expect(projectLookupSpy).not.toHaveBeenCalled();
  });

  test("a whitespace-only name on the activity is ignored and Graph is asked", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await addBot({
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      name: "   ",
    });

    expect(savedChat().name).toBe("Platform On-Call");
    expect(topicSpy).toHaveBeenCalledTimes(1);
  });

  test("personal chats are never looked up — they have no name, and keep the other person's", async () => {
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Jane Doe", aadObjectId: "aad-1" },
    ]);

    await addBot({ conversationType: "personal", id: "a:1personal-chat" });

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.chatType).toBe("personal");
    expect(chat.name).toBe("Jane Doe");
    expect(topicSpy).not.toHaveBeenCalled();
    expect(projectLookupSpy).not.toHaveBeenCalled();
  });

  test("channels are still ignored and never looked up", async () => {
    mockIssueMembers();

    await addBot({ conversationType: "channel", id: "19:chan@thread.tacv2" });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("no project connected to the tenant: Graph is skipped and members name the chat", async () => {
    mockIssueMembers();
    projectLookupSpy.mockResolvedValue(null as never);

    await addBot();

    expect(topicSpy).not.toHaveBeenCalled();
    expect(savedChat().name).toBe(ISSUE_MEMBER_NAME);
  });

  test("a failed roster fetch still gets the Graph name (and an empty, not missing, roster)", async () => {
    (TeamsInfo.getPagedMembers as jest.Mock).mockRejectedValue(
      new Error("roster unavailable"),
    );
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await addBot();

    const chat: MicrosoftTeamsChat = savedChat();
    expect(chat.name).toBe("Platform On-Call");
    expect(chat.memberNames).toEqual([]);
  });

  test("a failed roster fetch and no Graph name falls back to 'Group chat'", async () => {
    (TeamsInfo.getPagedMembers as jest.Mock).mockRejectedValue(
      new Error("roster unavailable"),
    );
    mockTopic({ status: MicrosoftTeamsChatTopicLookupStatus.NoTopic });

    await addBot();

    expect(savedChat().name).toBe("Group chat");
  });

  test("a long Graph name is truncated to 80 characters like any other name", async () => {
    mockIssueMembers();
    const longTopic: string =
      "Payments platform — production incident bridge for the EMEA and APAC on-call rotations";
    expect(longTopic.length).toBeGreaterThan(80);
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: longTopic,
    });

    await addBot();

    const name: string = savedChat().name;
    expect(name).toHaveLength(80);
    expect(name.endsWith("…")).toBe(true);
    expect(name.startsWith("Payments platform — production")).toBe(true);
  });

  test("group chats with the same members are told apart by their names", async () => {
    mockIssueMembers();
    topicSpy
      .mockResolvedValueOnce({
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Payments on-call",
      })
      .mockResolvedValueOnce({
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Search on-call",
      });

    await addBot({ conversationType: "groupChat", id: "19:one@thread.v2" });
    await addBot({ conversationType: "groupChat", id: "19:two@thread.v2" });

    const names: Array<string> = saveSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { chat: MicrosoftTeamsChat }).chat.name;
      },
    );
    expect(names).toEqual(["Payments on-call", "Search on-call"]);
  });

  test("installationUpdate 'add' in a group chat also stores the Graph name", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "add",
        conversation: { conversationType: "groupChat", id: GROUP_CHAT_ID },
        channelData: { tenant: { id: TENANT_ID } },
        serviceUrl: SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });

    expect(savedChat().name).toBe("Platform On-Call");
  });

  test("installationUpdate 'add-upgrade' (the app updated in the chat) re-reads the name", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "add-upgrade",
        conversation: { conversationType: "groupChat", id: GROUP_CHAT_ID },
        channelData: { tenant: { id: TENANT_ID } },
        serviceUrl: SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });

    expect(savedChat().name).toBe("Platform On-Call");
  });

  test("the tenant used for the project lookup falls back to conversation.tenantId", async () => {
    mockIssueMembers();
    mockTopic({
      status: MicrosoftTeamsChatTopicLookupStatus.Found,
      topic: "Platform On-Call",
    });

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersAdded: [{ id: BOT_RECIPIENT_ID }],
        conversation: {
          conversationType: "groupChat",
          id: GROUP_CHAT_ID,
          tenantId: "tenant-from-conversation",
        },
        channelData: {},
        serviceUrl: SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });

    expect(projectLookupSpy).toHaveBeenCalledWith({
      tenantId: "tenant-from-conversation",
    });
    expect(savedChat().name).toBe("Platform On-Call");
  });
});

describe("message backfill re-captures group chats stored before names were read", () => {
  const projectId: ObjectID = ObjectID.generate();
  let saveSpy: jest.SpyInstance;
  let topicSpy: jest.SpyInstance;

  function groupChatMessage(): JSONObject {
    // No @mention, so the handler returns right after the backfill.
    return {
      type: "message",
      text: "hello there",
      from: { id: "user-0", name: ISSUE_MEMBERS[0] },
      recipient: { id: BOT_RECIPIENT_ID },
      conversation: { conversationType: "groupChat", id: GROUP_CHAT_ID },
      channelData: { tenant: { id: TENANT_ID } },
      serviceUrl: SERVICE_URL,
      entities: [],
    };
  }

  beforeEach(() => {
    saveSpy = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil as any, "getAnyProjectIdForTenant")
      .mockResolvedValue(projectId as never);
    topicSpy = jest
      .spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph")
      .mockResolvedValue({
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      });
    mockIssueMembers();
  });

  function storeChat(chat: MicrosoftTeamsChat): void {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildAuthRow({
        projectId: projectId,
        workspaceProjectId: TENANT_ID,
        availableChats: { [chat.id]: chat },
      }),
    ]);
  }

  test("a legacy record (no stored roster) is re-captured with its real name", async () => {
    const legacyChat: MicrosoftTeamsChat = buildChat();
    delete legacyChat.memberNames;
    storeChat(legacyChat);

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: groupChatMessage(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const chat: MicrosoftTeamsChat = (
      saveSpy.mock.calls[0]![0] as { chat: MicrosoftTeamsChat }
    ).chat;
    expect(chat.name).toBe("Platform On-Call");
    expect(chat.memberNames).toEqual(ISSUE_MEMBERS);
  });

  test("a record captured by this version is left alone: no roster, Graph or write", async () => {
    storeChat(buildChat({ name: "Platform On-Call" }));

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: groupChatMessage(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(TeamsInfo.getPagedMembers).not.toHaveBeenCalled();
  });

  test("a record with an empty stored roster (roster fetch failed) is not re-captured on every message", async () => {
    storeChat(buildChat({ name: "Group chat", memberNames: [] }));

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: groupChatMessage(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(topicSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.isChatCapturedForTenant — group chat roster", () => {
  function mockRows(chats: Array<MicrosoftTeamsChat | undefined>): void {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue(
      chats.map((chat: MicrosoftTeamsChat | undefined) => {
        return buildAuthRow({
          availableChats: chat ? { [chat.id]: chat } : {},
        });
      }),
    );
  }

  test("a group chat with no stored roster is stale (captured before names were read)", async () => {
    const chat: MicrosoftTeamsChat = buildChat();
    delete chat.memberNames;
    mockRows([chat]);

    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: GROUP_CHAT_ID,
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(false);
  });

  test("a group chat with a stored roster is captured", async () => {
    mockRows([buildChat()]);

    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: GROUP_CHAT_ID,
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(true);
  });

  test("an empty stored roster still counts as captured (no re-capture loop)", async () => {
    mockRows([buildChat({ memberNames: [] })]);

    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: GROUP_CHAT_ID,
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(true);
  });

  test("the roster rule is for group chats only — a personal chat without memberNames is captured", async () => {
    const personalChat: MicrosoftTeamsChat = buildChat({
      id: "a:1personal",
      name: "Jane Doe",
      chatType: "personal",
      memberAadObjectIds: ["aad-1"],
    });
    delete personalChat.memberNames;
    mockRows([personalChat]);

    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: "a:1personal",
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(true);
  });

  test("one legacy row among several fresh rows makes the chat stale", async () => {
    const legacyChat: MicrosoftTeamsChat = buildChat();
    delete legacyChat.memberNames;
    mockRows([buildChat(), legacyChat]);

    await expect(
      isChatCapturedForTenant({
        tenantId: TENANT_ID,
        chatId: GROUP_CHAT_ID,
        serviceUrl: SERVICE_URL,
      }),
    ).resolves.toBe(false);
  });
});

describe("MicrosoftTeamsUtil.refreshChatNamesForProject (Refresh Chats)", () => {
  const projectId: ObjectID = ObjectID.generate();
  let topicSpy: jest.SpyInstance;
  let renameSpy: jest.SpyInstance;
  let getProjectAuthSpy: jest.SpyInstance;

  beforeEach(() => {
    topicSpy = jest.spyOn(MicrosoftTeamsUtil, "getGroupChatTopicFromGraph");
    renameSpy = jest
      .spyOn(MicrosoftTeamsUtil, "renameChatsInProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    getProjectAuthSpy = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );
  });

  function storeChats(
    chats: Array<MicrosoftTeamsChat>,
    options?: { workspaceProjectId?: string | undefined },
  ): Record<string, MicrosoftTeamsChat> {
    const availableChats: Record<string, MicrosoftTeamsChat> = {};
    for (const chat of chats) {
      availableChats[chat.id] = chat;
    }
    getProjectAuthSpy.mockResolvedValue(
      buildAuthRow({
        projectId: projectId,
        workspaceProjectId:
          options && "workspaceProjectId" in options
            ? options.workspaceProjectId
            : TENANT_ID,
        availableChats: availableChats,
      }),
    );
    return availableChats;
  }

  function topics(
    byChatId: Record<string, MicrosoftTeamsChatTopicLookup>,
  ): void {
    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        return (
          byChatId[data.chatId] || {
            status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
          }
        );
      },
    );
  }

  async function refresh(): Promise<MicrosoftTeamsChatNameRefreshResult> {
    return MicrosoftTeamsUtil.refreshChatNamesForProject({
      projectId: projectId,
    });
  }

  test("looks up the project's own Microsoft Teams connection", async () => {
    storeChats([]);

    await refresh();

    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });

  test("the issue: a group chat stored under its members' names is renamed to its Teams name", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Platform On-Call");
    expect(result.permissionDeniedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });
  });

  test("each chat is looked up with the refreshing project and its own chat id", async () => {
    storeChats([
      buildChat({ id: "19:one@thread.v2" }),
      buildChat({ id: "19:two@thread.v2" }),
    ]);
    topics({});

    await refresh();

    expect(topicSpy).toHaveBeenCalledTimes(2);
    expect(topicSpy).toHaveBeenCalledWith({
      projectId: projectId,
      chatId: "19:one@thread.v2",
    });
    expect(topicSpy).toHaveBeenCalledWith({
      projectId: projectId,
      chatId: "19:two@thread.v2",
    });
  });

  test("a chat renamed in Teams picks up the new name", async () => {
    storeChats([buildChat({ name: "Old name" })]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "New name",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("New name");
    expect(renameSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "New name" },
    });
  });

  test("nothing is written when every name is already right", async () => {
    storeChats([buildChat({ name: "Platform On-Call" })]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Platform On-Call");
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a chat whose name was removed in Teams goes back to its stored members' names", async () => {
    storeChats([buildChat({ name: "Platform On-Call" })]);
    topics({
      [GROUP_CHAT_ID]: { status: MicrosoftTeamsChatTopicLookupStatus.NoTopic },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(renameSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: ISSUE_MEMBER_NAME },
    });
  });

  test("an unnamed chat with no stored roster keeps its current name instead of becoming 'Group chat'", async () => {
    const legacyChat: MicrosoftTeamsChat = buildChat({
      name: "Alice, Bob",
    });
    delete legacyChat.memberNames;
    storeChats([legacyChat]);
    topics({
      [GROUP_CHAT_ID]: { status: MicrosoftTeamsChatTopicLookupStatus.NoTopic },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Alice, Bob");
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("an unnamed chat with an empty stored roster keeps its current name", async () => {
    storeChats([buildChat({ name: "Alice, Bob", memberNames: [] })]);
    topics({
      [GROUP_CHAT_ID]: { status: MicrosoftTeamsChatTopicLookupStatus.NoTopic },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Alice, Bob");
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a legacy record without a roster still gets its Graph name", async () => {
    const legacyChat: MicrosoftTeamsChat = buildChat();
    delete legacyChat.memberNames;
    storeChats([legacyChat]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Platform On-Call");
  });

  test("PermissionDenied is counted and the chat keeps its name", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("Unknown is counted as failed, separately from PermissionDenied", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: { status: MicrosoftTeamsChatTopicLookupStatus.Unknown },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("mixed answers: renames what it can, counts the rest, and writes once", async () => {
    storeChats([
      buildChat({ id: "19:found@thread.v2" }),
      buildChat({ id: "19:same@thread.v2", name: "Already right" }),
      buildChat({ id: "19:denied-1@thread.v2" }),
      buildChat({ id: "19:denied-2@thread.v2" }),
      buildChat({ id: "19:unknown@thread.v2" }),
      buildChat({ id: "19:cleared@thread.v2", name: "Old topic" }),
    ]);
    topics({
      "19:found@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Payments on-call",
      },
      "19:same@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Already right",
      },
      "19:denied-1@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
      },
      "19:denied-2@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.PermissionDenied,
      },
      "19:unknown@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.Unknown,
      },
      "19:cleared@thread.v2": {
        status: MicrosoftTeamsChatTopicLookupStatus.NoTopic,
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      chatNames: {
        "19:found@thread.v2": "Payments on-call",
        "19:cleared@thread.v2": ISSUE_MEMBER_NAME,
      },
    });
    expect(result.chats["19:found@thread.v2"]!.name).toBe("Payments on-call");
    expect(result.chats["19:same@thread.v2"]!.name).toBe("Already right");
    expect(result.chats["19:denied-1@thread.v2"]!.name).toBe(ISSUE_MEMBER_NAME);
    expect(result.chats["19:cleared@thread.v2"]!.name).toBe(ISSUE_MEMBER_NAME);
  });

  test("personal chats are returned untouched and never looked up", async () => {
    const personalChat: MicrosoftTeamsChat = buildChat({
      id: "a:1personal",
      name: "Jane Doe",
      chatType: "personal",
    });
    storeChats([personalChat, buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy.mock.calls[0]![0]).toMatchObject({
      chatId: GROUP_CHAT_ID,
    });
    expect(result.chats["a:1personal"]).toEqual(personalChat);
  });

  test("only personal chats: no Graph calls, no writes, nothing counted", async () => {
    storeChats([
      buildChat({ id: "a:1", name: "Jane", chatType: "personal" }),
      buildChat({ id: "a:2", name: "John", chatType: "personal" }),
    ]);

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    expect(Object.keys(result.chats).sort()).toEqual(["a:1", "a:2"]);
    expect(result.permissionDeniedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  test("no Microsoft Teams connection: an empty result and no calls", async () => {
    getProjectAuthSpy.mockResolvedValue(null);

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result).toEqual({
      chats: {},
      permissionDeniedCount: 0,
      failedCount: 0,
    });
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("a connection without miscData: an empty result and no calls", async () => {
    const row: WorkspaceProjectAuthToken = buildAuthRow({
      projectId: projectId,
      workspaceProjectId: TENANT_ID,
    });
    row.miscData = undefined;
    getProjectAuthSpy.mockResolvedValue(row);

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats).toEqual({});
    expect(topicSpy).not.toHaveBeenCalled();
  });

  test("a connection without a tenant id returns the stored chats without looking anything up", async () => {
    const stored: Record<string, MicrosoftTeamsChat> = storeChats(
      [buildChat()],
      { workspaceProjectId: undefined },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats).toEqual(stored);
    expect(topicSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  test("the stored miscData is not mutated", async () => {
    const stored: Record<string, MicrosoftTeamsChat> = storeChats([
      buildChat(),
    ]);
    const snapshot: string = JSON.stringify(stored);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Platform On-Call");
    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  test("a renamed chat keeps every other field", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      memberAadObjectIds: ["aad-0", "aad-1"],
    });
    storeChats([chat]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]).toEqual({
      ...chat,
      name: "Platform On-Call",
    });
  });

  test("long names are truncated on refresh too", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "x".repeat(200),
      },
    });

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toHaveLength(80);
    expect(result.chats[GROUP_CHAT_ID]!.name.endsWith("…")).toBe(true);
  });

  test("lookups run at most 5 at a time, and every chat is looked up", async () => {
    const chats: Array<MicrosoftTeamsChat> = [];
    for (let index: number = 0; index < 12; index++) {
      chats.push(buildChat({ id: `19:chat-${index}@thread.v2` }));
    }
    storeChats(chats);

    let inFlight: number = 0;
    let maxInFlight: number = 0;
    const seen: Array<string> = [];

    topicSpy.mockImplementation(
      async (data: {
        chatId: string;
      }): Promise<MicrosoftTeamsChatTopicLookup> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        seen.push(data.chatId);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
        inFlight--;
        return {
          status: MicrosoftTeamsChatTopicLookupStatus.Found,
          topic: `Name of ${data.chatId}`,
        };
      },
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(seen.sort()).toEqual(
      chats
        .map((chat: MicrosoftTeamsChat) => {
          return chat.id;
        })
        .sort(),
    );
    expect(
      Object.keys(
        (renameSpy.mock.calls[0]![0] as { chatNames: Record<string, string> })
          .chatNames,
      ),
    ).toHaveLength(12);
    expect(result.chats["19:chat-11@thread.v2"]!.name).toBe(
      "Name of 19:chat-11@thread.v2",
    );
  });

  test("a failing rename write surfaces as an error (the caller shows it)", async () => {
    storeChats([buildChat()]);
    topics({
      [GROUP_CHAT_ID]: {
        status: MicrosoftTeamsChatTopicLookupStatus.Found,
        topic: "Platform On-Call",
      },
    });
    renameSpy.mockRejectedValue(new Error("write failed"));

    await expect(refresh()).rejects.toThrow("write failed");
  });

  test("end to end through the real Graph lookup: a 200 with a topic renames the chat", async () => {
    topicSpy.mockRestore();
    storeChats([buildChat()]);
    apiGetSpy.mockResolvedValue(
      graphOk({ id: GROUP_CHAT_ID, topic: "Platform On-Call" }),
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.chats[GROUP_CHAT_ID]!.name).toBe("Platform On-Call");
    expect(tokenSpy.mock.calls[0]![0]).toMatchObject({ projectId: projectId });
  });

  test("end to end through the real Graph lookup: a 403 is reported as a permission problem", async () => {
    topicSpy.mockRestore();
    storeChats([buildChat()]);
    apiGetSpy.mockResolvedValue(
      graphError(403, { error: { code: "Forbidden" } }),
    );

    const result: MicrosoftTeamsChatNameRefreshResult = await refresh();

    expect(result.permissionDeniedCount).toBe(1);
    expect(result.chats[GROUP_CHAT_ID]!.name).toBe(ISSUE_MEMBER_NAME);
  });
});

describe("MicrosoftTeamsUtil.renameChatsInProjectAuthTokens", () => {
  let updateSpy: jest.SpyInstance;

  beforeEach(() => {
    updateSpy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);
  });

  function mockRows(rows: Array<WorkspaceProjectAuthToken>): jest.SpyInstance {
    return jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue(rows);
  }

  test("queries every Microsoft Teams connection of the tenant as root", async () => {
    const findBySpy: jest.SpyInstance = mockRows([]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(findBySpy).toHaveBeenCalledWith({
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceProjectId: TENANT_ID,
      },
      select: { _id: true, miscData: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("renames the chat on every project of the tenant", async () => {
    const rowOne: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    const rowTwo: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    mockRows([rowOne, rowTwo]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    const updatedIds: Array<string> = updateSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].id.toString();
      },
    );
    expect(updatedIds.sort()).toEqual(
      [rowOne.id!.toString(), rowTwo.id!.toString()].sort(),
    );
    for (const call of updateSpy.mock.calls) {
      expect(call[0].data.miscData.availableChats[GROUP_CHAT_ID].name).toBe(
        "Platform On-Call",
      );
      expect(call[0].props).toEqual({ isRoot: true });
    }
  });

  test("only the name changes: the rest of the chat, other chats and other miscData are kept", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      memberAadObjectIds: ["aad-0"],
    });
    const otherChat: MicrosoftTeamsChat = buildChat({
      id: "19:other@thread.v2",
      name: "Other chat",
    });
    mockRows([
      buildAuthRow({
        miscData: {
          botId: "bot-1",
          tenantId: TENANT_ID,
          availableChats: {
            [chat.id]: chat,
            [otherChat.id]: otherChat,
          },
        } as unknown as MicrosoftTeamsMiscData,
      }),
    ]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    const miscData: JSONObject = updateSpy.mock.calls[0]![0].data.miscData;
    expect(miscData["botId"]).toBe("bot-1");
    expect(miscData["tenantId"]).toBe(TENANT_ID);
    const availableChats: Record<string, MicrosoftTeamsChat> = miscData[
      "availableChats"
    ] as unknown as Record<string, MicrosoftTeamsChat>;
    expect(availableChats[GROUP_CHAT_ID]).toEqual({
      ...chat,
      name: "Platform On-Call",
    });
    expect(availableChats[otherChat.id]).toEqual(otherChat);
  });

  test("a chat removed while names were being read is not brought back", async () => {
    mockRows([
      buildAuthRow({
        availableChats: {
          "19:other@thread.v2": buildChat({ id: "19:other@thread.v2" }),
        },
      }),
    ]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a row that already has the name is not written", async () => {
    mockRows([
      buildAuthRow({
        availableChats: {
          [GROUP_CHAT_ID]: buildChat({ name: "Platform On-Call" }),
        },
      }),
    ]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("the name is applied onto the row's current record, not a stale copy", async () => {
    // The chat was re-captured (fresh serviceUrl) after the refresh read it.
    const current: MicrosoftTeamsChat = buildChat({
      serviceUrl: "https://smba.trafficmanager.net/emea/",
      addedAt: "2026-09-28T00:00:00.000Z",
    });
    mockRows([buildAuthRow({ availableChats: { [GROUP_CHAT_ID]: current } })]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(
      updateSpy.mock.calls[0]![0].data.miscData.availableChats[GROUP_CHAT_ID],
    ).toEqual({ ...current, name: "Platform On-Call" });
  });

  test("several chats are renamed in a single write per row", async () => {
    mockRows([
      buildAuthRow({
        availableChats: {
          "19:one@thread.v2": buildChat({ id: "19:one@thread.v2" }),
          "19:two@thread.v2": buildChat({ id: "19:two@thread.v2" }),
        },
      }),
    ]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: {
        "19:one@thread.v2": "One",
        "19:two@thread.v2": "Two",
      },
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const availableChats: Record<string, MicrosoftTeamsChat> =
      updateSpy.mock.calls[0]![0].data.miscData.availableChats;
    expect(availableChats["19:one@thread.v2"]!.name).toBe("One");
    expect(availableChats["19:two@thread.v2"]!.name).toBe("Two");
  });

  test("rows without miscData or without chats are skipped", async () => {
    const noMisc: WorkspaceProjectAuthToken = buildAuthRow({});
    noMisc.miscData = undefined;
    mockRows([
      noMisc,
      buildAuthRow({ miscData: {} as MicrosoftTeamsMiscData }),
    ]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("the row's original miscData object is not mutated", async () => {
    const row: WorkspaceProjectAuthToken = buildAuthRow({
      availableChats: { [GROUP_CHAT_ID]: buildChat() },
    });
    const snapshot: string = JSON.stringify(row.miscData);
    mockRows([row]);

    await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
      tenantId: TENANT_ID,
      chatNames: { [GROUP_CHAT_ID]: "Platform On-Call" },
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(row.miscData)).toBe(snapshot);
  });
});
