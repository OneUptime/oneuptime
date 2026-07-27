import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * Extensive tests for the Microsoft Teams CHAT support (group chats +
 * personal 1:1 chats) in MicrosoftTeamsUtil:
 *
 * - getChatDisplayName: pure name-resolution rules for captured chats.
 * - saveChatToProjectAuthTokens / removeChatFromProjectAuthTokens: chats are
 *   stored in miscData.availableChats on EVERY WorkspaceProjectAuthToken row
 *   whose workspaceProjectId equals the Teams tenant id.
 * - getChatsForProject: read side of the captured chat store.
 * - handleConversationUpdateActivity / handleInstallationUpdateActivity: the
 *   Bot Framework events that capture (bot added) and forget (bot removed)
 *   chats.
 * - sendAdaptiveCardToChat: proactive Bot Framework send into a stored chat.
 * - sendMessage: the chatIds routing block (chunking, per-chat errors).
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
 * The repo-wide botbuilder manual mock (Tests/__mocks__/botbuilder.js) does
 * not expose TeamsInfo or MessageFactory.attachment, both of which the chat
 * code paths use — so this file supplies its own richer factory.
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
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import {
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import {
  TeamsInfo,
  type ConversationReference,
  type TeamsChannelAccount,
  type TurnContext,
} from "botbuilder";

const MOCK_APP_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const BOT_RECIPIENT_ID: string = "bot-recipient-id";
const TURN_CONTEXT_SERVICE_URL: string =
  "https://smba.trafficmanager.net/emea/";

type ProactiveCallback = (context: TurnContext) => Promise<void>;

function buildTurnContext(data?: {
  serviceUrl?: string | undefined;
  recipientId?: string | undefined;
}): TurnContext {
  return {
    activity: {
      recipient: { id: data?.recipientId || BOT_RECIPIENT_ID },
      serviceUrl:
        data && "serviceUrl" in data
          ? data.serviceUrl
          : TURN_CONTEXT_SERVICE_URL,
      conversation: { id: "ctx-conversation-id" },
    },
  } as unknown as TurnContext;
}

function buildProjectAuthRow(data: {
  id?: ObjectID | undefined;
  workspaceProjectId?: string | undefined;
  miscData?: MicrosoftTeamsMiscData | undefined;
}): WorkspaceProjectAuthToken {
  return {
    id: data.id || ObjectID.generate(),
    workspaceProjectId: data.workspaceProjectId,
    miscData: data.miscData,
  } as unknown as WorkspaceProjectAuthToken;
}

function buildChat(data?: {
  id?: string | undefined;
  name?: string | undefined;
  chatType?: "personal" | "groupChat" | undefined;
  serviceUrl?: string | undefined;
}): MicrosoftTeamsChat {
  const chat: MicrosoftTeamsChat = {
    id: data?.id || "19:groupchat@thread.v2",
    name: data?.name || "Alice, Bob",
    chatType: data?.chatType || "groupChat",
    addedAt: "2026-07-27T00:00:00.000Z",
  };
  if (data && "serviceUrl" in data) {
    chat.serviceUrl = data.serviceUrl;
  } else {
    chat.serviceUrl = TURN_CONTEXT_SERVICE_URL;
  }
  return chat;
}

function baseMiscData(
  overrides?: Partial<MicrosoftTeamsMiscData>,
): MicrosoftTeamsMiscData {
  return {
    tenantId: "tenant-xyz",
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    ...(overrides || {}),
  } as MicrosoftTeamsMiscData;
}

function installFakeBotAdapter(options?: {
  sendActivityResponse?: JSONObject | undefined;
}): Array<ConversationReference> {
  const capturedRefs: Array<ConversationReference> = [];
  const fakeAdapter: unknown = {
    continueConversationAsync: async (
      _appId: string,
      ref: ConversationReference,
      cb: ProactiveCallback,
    ): Promise<void> => {
      capturedRefs.push(ref);
      const fakeContext: TurnContext = {
        sendActivity: async (): Promise<JSONObject | undefined> => {
          if (options && "sendActivityResponse" in options) {
            return options.sendActivityResponse;
          }
          return { id: "msg-123" };
        },
      } as unknown as TurnContext;
      await cb(fakeContext);
    },
  };
  jest
    .spyOn(MicrosoftTeamsUtil as any, "getBotAdapter")
    .mockReturnValue(fakeAdapter);
  return capturedRefs;
}

function mockMembers(members: Array<{ id: string; name?: string }>): void {
  jest
    .spyOn(TeamsInfo, "getMembers")
    .mockResolvedValue(members as Array<TeamsChannelAccount>);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsUtil.getChatDisplayName", () => {
  test("topic wins over member names", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: "Ops War Room",
      memberNames: ["Alice", "Bob"],
    });
    expect(name).toBe("Ops War Room");
  });

  test("long topics are truncated to 80 chars with an ellipsis (log columns are varchar(100))", () => {
    const longTopic: string = "T".repeat(200);
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: longTopic,
      memberNames: [],
    });
    expect(name.length).toBe(80);
    expect(name.endsWith("…")).toBe(true);
    expect(name.startsWith("TTTT")).toBe(true);
  });

  test("long synthesized member-name lists are truncated too", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["A".repeat(60), "B".repeat(60), "C".repeat(60)],
    });
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("…")).toBe(true);
  });

  test("80-char names are not truncated", () => {
    const exact: string = "X".repeat(80);
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: exact,
      memberNames: [],
    });
    expect(name).toBe(exact);
  });

  test("topic is trimmed before use", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: "  Ops War Room  ",
      memberNames: ["Alice"],
    });
    expect(name).toBe("Ops War Room");
  });

  test("whitespace-only topic is ignored and members are used", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      topic: "   ",
      memberNames: ["Alice", "Bob"],
    });
    expect(name).toBe("Alice, Bob");
  });

  test("personal chat uses the other member's name", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "personal",
      memberNames: ["Alice"],
    });
    expect(name).toBe("Alice");
  });

  test("personal chat with multiple member names uses only the first", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "personal",
      memberNames: ["Alice", "Bob"],
    });
    expect(name).toBe("Alice");
  });

  test("personal chat with no members falls back to 'Personal chat'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "personal",
      memberNames: [],
    });
    expect(name).toBe("Personal chat");
  });

  test("personal chat with only blank member names falls back to 'Personal chat'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "personal",
      memberNames: ["", "   "],
    });
    expect(name).toBe("Personal chat");
  });

  test("group chat joins up to 3 names with a comma", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol"],
    });
    expect(name).toBe("Alice, Bob, Carol");
  });

  test("group chat with 5 members shows 3 names + count of the rest", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol", "Dave", "Erin"],
    });
    expect(name).toBe("Alice, Bob, Carol + 2 more");
  });

  test("group chat with 4 members shows '+ 1 more'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["Alice", "Bob", "Carol", "Dave"],
    });
    expect(name).toBe("Alice, Bob, Carol + 1 more");
  });

  test("group chat with no members falls back to 'Group chat'", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: [],
    });
    expect(name).toBe("Group chat");
  });

  test("blank and empty member names are filtered out before counting", () => {
    const name: string = MicrosoftTeamsUtil.getChatDisplayName({
      chatType: "groupChat",
      memberNames: ["", "  ", "Alice", "", "Bob"],
    });
    expect(name).toBe("Alice, Bob");
  });
});

describe("MicrosoftTeamsUtil.saveChatToProjectAuthTokens", () => {
  test("queries project auth rows by MicrosoftTeams workspace type and tenant id", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: buildChat(),
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: "tenant-abc",
        },
        select: {
          _id: true,
          miscData: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    );
  });

  test("updates EVERY matching project auth row (2 rows -> 2 updates)", async () => {
    const rowIdOne: ObjectID = ObjectID.generate();
    const rowIdTwo: ObjectID = ObjectID.generate();
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([
        buildProjectAuthRow({ id: rowIdOne, miscData: baseMiscData() }),
        buildProjectAuthRow({ id: rowIdTwo, miscData: baseMiscData() }),
      ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const chat: MicrosoftTeamsChat = buildChat();
    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: chat,
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    const updatedIds: Array<string> = updateSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return String((call[0] as { id: ObjectID }).id);
      },
    );
    expect(updatedIds).toEqual([rowIdOne.toString(), rowIdTwo.toString()]);
    for (const call of updateSpy.mock.calls) {
      const args: { data: { miscData: MicrosoftTeamsMiscData } } =
        call[0] as unknown as { data: { miscData: MicrosoftTeamsMiscData } };
      expect(args.data.miscData.availableChats).toEqual({
        [chat.id]: chat,
      });
    }
  });

  test("preserves existing miscData fields and existing chats", async () => {
    const existingChat: MicrosoftTeamsChat = buildChat({
      id: "19:existing@thread.v2",
      name: "Existing chat",
    });
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        miscData: baseMiscData({
          appAccessToken: "token-abc",
          availableChats: { [existingChat.id]: existingChat },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const newChat: MicrosoftTeamsChat = buildChat({
      id: "19:new@thread.v2",
      name: "New chat",
    });
    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: newChat,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const savedMiscData: MicrosoftTeamsMiscData = (
      updateSpy.mock.calls[0]?.[0] as {
        data: { miscData: MicrosoftTeamsMiscData };
      }
    ).data.miscData;
    expect(savedMiscData.tenantId).toBe("tenant-xyz");
    expect(savedMiscData.teamId).toBe("team-1");
    expect(savedMiscData.teamName).toBe("Engineering");
    expect(savedMiscData.botId).toBe("bot-1");
    expect(savedMiscData.appAccessToken).toBe("token-abc");
    expect(savedMiscData.availableChats).toEqual({
      [existingChat.id]: existingChat,
      [newChat.id]: newChat,
    });
  });

  test("overwrites a chat that already exists under the same id (upsert)", async () => {
    const staleChat: MicrosoftTeamsChat = buildChat({
      id: "19:same@thread.v2",
      name: "Old name",
    });
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        miscData: baseMiscData({
          availableChats: { [staleChat.id]: staleChat },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const freshChat: MicrosoftTeamsChat = buildChat({
      id: "19:same@thread.v2",
      name: "New name",
    });
    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: freshChat,
    });

    const savedMiscData: MicrosoftTeamsMiscData = (
      updateSpy.mock.calls[0]?.[0] as {
        data: { miscData: MicrosoftTeamsMiscData };
      }
    ).data.miscData;
    expect(savedMiscData.availableChats).toEqual({
      [freshChat.id]: freshChat,
    });
    expect(savedMiscData.availableChats?.[freshChat.id]?.name).toBe("New name");
  });

  test("creates availableChats when miscData had none (miscData undefined)", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([buildProjectAuthRow({ miscData: undefined })]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const chat: MicrosoftTeamsChat = buildChat();
    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: chat,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const savedMiscData: MicrosoftTeamsMiscData = (
      updateSpy.mock.calls[0]?.[0] as {
        data: { miscData: MicrosoftTeamsMiscData };
      }
    ).data.miscData;
    expect(savedMiscData.availableChats).toEqual({ [chat.id]: chat });
  });

  test("no matching project auth rows -> no updates", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: buildChat(),
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("does not mutate the original row's miscData object", async () => {
    const originalMiscData: MicrosoftTeamsMiscData = baseMiscData({
      availableChats: {},
    });
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([buildProjectAuthRow({ miscData: originalMiscData })]);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: "tenant-abc",
      chat: buildChat(),
    });

    expect(originalMiscData.availableChats).toEqual({});
  });
});

describe("MicrosoftTeamsUtil.removeChatFromProjectAuthTokens", () => {
  test("removes only the target chat and keeps the others", async () => {
    const chatToRemove: MicrosoftTeamsChat = buildChat({
      id: "19:remove@thread.v2",
      name: "Removed chat",
    });
    const chatToKeep: MicrosoftTeamsChat = buildChat({
      id: "19:keep@thread.v2",
      name: "Kept chat",
    });
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        miscData: baseMiscData({
          availableChats: {
            [chatToRemove.id]: chatToRemove,
            [chatToKeep.id]: chatToKeep,
          },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: chatToRemove.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const savedMiscData: MicrosoftTeamsMiscData = (
      updateSpy.mock.calls[0]?.[0] as {
        data: { miscData: MicrosoftTeamsMiscData };
      }
    ).data.miscData;
    expect(savedMiscData.availableChats).toEqual({
      [chatToKeep.id]: chatToKeep,
    });
    expect(savedMiscData.botId).toBe("bot-1");
  });

  test("does not call updateOneById when the chat is absent", async () => {
    const otherChat: MicrosoftTeamsChat = buildChat({
      id: "19:other@thread.v2",
    });
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        miscData: baseMiscData({
          availableChats: { [otherChat.id]: otherChat },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: "19:not-there@thread.v2",
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("handles rows with no availableChats at all", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([
        buildProjectAuthRow({ miscData: baseMiscData() }),
        buildProjectAuthRow({ miscData: undefined }),
      ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: "19:whatever@thread.v2",
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("removes the chat from every matching row (multi-row removal)", async () => {
    const chat: MicrosoftTeamsChat = buildChat({ id: "19:multi@thread.v2" });
    const rowIdOne: ObjectID = ObjectID.generate();
    const rowIdTwo: ObjectID = ObjectID.generate();
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        id: rowIdOne,
        miscData: baseMiscData({ availableChats: { [chat.id]: chat } }),
      }),
      buildProjectAuthRow({
        id: rowIdTwo,
        miscData: baseMiscData({ availableChats: { [chat.id]: chat } }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: chat.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(2);
    for (const call of updateSpy.mock.calls) {
      const args: { data: { miscData: MicrosoftTeamsMiscData } } =
        call[0] as unknown as { data: { miscData: MicrosoftTeamsMiscData } };
      expect(args.data.miscData.availableChats).toEqual({});
    }
  });

  test("only rows that contain the chat are updated", async () => {
    const chat: MicrosoftTeamsChat = buildChat({ id: "19:mixed@thread.v2" });
    const rowWithChat: ObjectID = ObjectID.generate();
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      buildProjectAuthRow({
        id: rowWithChat,
        miscData: baseMiscData({ availableChats: { [chat.id]: chat } }),
      }),
      buildProjectAuthRow({
        miscData: baseMiscData({ availableChats: {} }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: chat.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(String((updateSpy.mock.calls[0]?.[0] as { id: ObjectID }).id)).toBe(
      rowWithChat.toString(),
    );
  });

  test("does not mutate the original row's availableChats object", async () => {
    const chat: MicrosoftTeamsChat = buildChat({ id: "19:immut@thread.v2" });
    const originalMiscData: MicrosoftTeamsMiscData = baseMiscData({
      availableChats: { [chat.id]: chat },
    });
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([buildProjectAuthRow({ miscData: originalMiscData })]);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
      tenantId: "tenant-abc",
      chatId: chat.id,
    });

    expect(originalMiscData.availableChats).toEqual({ [chat.id]: chat });
  });
});

describe("MicrosoftTeamsUtil.getChatsForProject", () => {
  test("returns empty object when there is no project auth", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    const chats: Record<string, MicrosoftTeamsChat> =
      await MicrosoftTeamsUtil.getChatsForProject({
        projectId: ObjectID.generate(),
      });

    expect(chats).toEqual({});
  });

  test("returns empty object when project auth has no miscData", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(buildProjectAuthRow({ miscData: undefined }));

    const chats: Record<string, MicrosoftTeamsChat> =
      await MicrosoftTeamsUtil.getChatsForProject({
        projectId: ObjectID.generate(),
      });

    expect(chats).toEqual({});
  });

  test("returns empty object when miscData has no availableChats", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(buildProjectAuthRow({ miscData: baseMiscData() }));

    const chats: Record<string, MicrosoftTeamsChat> =
      await MicrosoftTeamsUtil.getChatsForProject({
        projectId: ObjectID.generate(),
      });

    expect(chats).toEqual({});
  });

  test("returns availableChats when present", async () => {
    const chatOne: MicrosoftTeamsChat = buildChat({ id: "19:one@thread.v2" });
    const chatTwo: MicrosoftTeamsChat = buildChat({
      id: "a:1personal",
      chatType: "personal",
      name: "Alice",
    });
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        buildProjectAuthRow({
          miscData: baseMiscData({
            availableChats: { [chatOne.id]: chatOne, [chatTwo.id]: chatTwo },
          }),
        }),
      );

    const chats: Record<string, MicrosoftTeamsChat> =
      await MicrosoftTeamsUtil.getChatsForProject({
        projectId: ObjectID.generate(),
      });

    expect(chats).toEqual({ [chatOne.id]: chatOne, [chatTwo.id]: chatTwo });
  });

  test("looks up project auth by projectId and MicrosoftTeams workspace type", async () => {
    const getProjectAuthSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    const projectId: ObjectID = ObjectID.generate();

    await MicrosoftTeamsUtil.getChatsForProject({ projectId: projectId });

    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });
});

describe("MicrosoftTeamsUtil.handleConversationUpdateActivity", () => {
  interface ConversationUpdateSpies {
    saveSpy: jest.SpyInstance;
    removeSpy: jest.SpyInstance;
    welcomeSpy: jest.SpyInstance;
  }

  function installSpies(): ConversationUpdateSpies {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeChatFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const welcomeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil as any, "sendWelcomeAdaptiveCard")
      .mockResolvedValue(undefined as never);
    return { saveSpy, removeSpy, welcomeSpy };
  }

  function groupChatBotAddedActivity(overrides?: JSONObject): JSONObject {
    return {
      membersAdded: [{ id: BOT_RECIPIENT_ID }],
      conversation: {
        conversationType: "groupChat",
        id: "19:groupchat@thread.v2",
      },
      channelData: { tenant: { id: "tenant-1" } },
      serviceUrl: "https://smba.trafficmanager.net/amer/",
      ...(overrides || {}),
    };
  }

  test("bot added to a group chat saves the chat with the full shape", async () => {
    const { saveSpy, welcomeSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice" },
      { id: "user-2", name: "Bob" },
    ]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.tenantId).toBe("tenant-1");
    expect(saveArgs.chat.id).toBe("19:groupchat@thread.v2");
    expect(saveArgs.chat.chatType).toBe("groupChat");
    // Bot member is filtered out of the name.
    expect(saveArgs.chat.name).toBe("Alice, Bob");
    // Service URL is taken from the activity itself when present.
    expect(saveArgs.chat.serviceUrl).toBe(
      "https://smba.trafficmanager.net/amer/",
    );
    expect(typeof saveArgs.chat.addedAt).toBe("string");
    expect(
      Number.isNaN(new Date(saveArgs.chat.addedAt as string).getTime()),
    ).toBe(false);
    expect(welcomeSpy).toHaveBeenCalledTimes(1);
  });

  test("bot added to a personal chat saves chatType personal with the other member's name", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice" },
    ]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        conversation: { conversationType: "personal", id: "a:1personal" },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.chatType).toBe("personal");
    expect(saveArgs.chat.name).toBe("Alice");
    expect(saveArgs.chat.id).toBe("a:1personal");
  });

  test("bot added to a CHANNEL conversation saves nothing but still sends welcome", async () => {
    const { saveSpy, welcomeSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        conversation: {
          conversationType: "channel",
          id: "19:channel@thread.tacv2",
        },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(welcomeSpy).toHaveBeenCalledTimes(1);
  });

  test("a non-bot member added saves nothing and sends no welcome", async () => {
    const { saveSpy, removeSpy, welcomeSpy }: ConversationUpdateSpies =
      installSpies();
    mockMembers([]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        membersAdded: [{ id: "some-human-user" }],
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(welcomeSpy).not.toHaveBeenCalled();
  });

  test("bot removed from a group chat removes the stored chat", async () => {
    const { saveSpy, removeSpy, welcomeSpy }: ConversationUpdateSpies =
      installSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersRemoved: [{ id: BOT_RECIPIENT_ID }],
        conversation: {
          conversationType: "groupChat",
          id: "19:groupchat@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      chatId: "19:groupchat@thread.v2",
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(welcomeSpy).not.toHaveBeenCalled();
  });

  test("bot removed from a personal chat removes the stored chat", async () => {
    const { removeSpy }: ConversationUpdateSpies = installSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersRemoved: [{ id: BOT_RECIPIENT_ID }],
        conversation: { conversationType: "personal", id: "a:1personal" },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      chatId: "a:1personal",
    });
  });

  test("bot removed from a channel conversation does not touch stored chats", async () => {
    const { removeSpy }: ConversationUpdateSpies = installSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersRemoved: [{ id: BOT_RECIPIENT_ID }],
        conversation: {
          conversationType: "channel",
          id: "19:channel@thread.tacv2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(removeSpy).not.toHaveBeenCalled();
  });

  test("missing tenant id -> nothing saved and no throw (welcome still sent)", async () => {
    const { saveSpy, welcomeSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([]);

    await expect(
      MicrosoftTeamsUtil.handleConversationUpdateActivity({
        activity: {
          membersAdded: [{ id: BOT_RECIPIENT_ID }],
          conversation: {
            conversationType: "groupChat",
            id: "19:groupchat@thread.v2",
          },
          // no channelData.tenant and no conversation.tenantId
        },
        turnContext: buildTurnContext(),
      }),
    ).resolves.toBeUndefined();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(welcomeSpy).toHaveBeenCalledTimes(1);
  });

  test("missing conversation id -> nothing saved", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        conversation: { conversationType: "groupChat" },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("TeamsInfo.getMembers throwing still saves the chat with 'Group chat' fallback name", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    jest
      .spyOn(TeamsInfo, "getMembers")
      .mockRejectedValue(new Error("members lookup failed"));

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.name).toBe("Group chat");
  });

  test("TeamsInfo.getMembers throwing on a personal chat falls back to 'Personal chat'", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    jest
      .spyOn(TeamsInfo, "getMembers")
      .mockRejectedValue(new Error("members lookup failed"));

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        conversation: { conversationType: "personal", id: "a:1personal" },
      }),
      turnContext: buildTurnContext(),
    });

    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.name).toBe("Personal chat");
  });

  test("conversation.name (topic) takes priority over member names", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([
      { id: "user-1", name: "Alice" },
      { id: "user-2", name: "Bob" },
    ]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: groupChatBotAddedActivity({
        conversation: {
          conversationType: "groupChat",
          id: "19:groupchat@thread.v2",
          name: "Ops War Room",
        },
      }),
      turnContext: buildTurnContext(),
    });

    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.name).toBe("Ops War Room");
  });

  test("tenant id falls back to conversation.tenantId when channelData.tenant is missing", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([]);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersAdded: [{ id: BOT_RECIPIENT_ID }],
        conversation: {
          conversationType: "groupChat",
          id: "19:groupchat@thread.v2",
          tenantId: "tenant-2",
        },
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      },
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.tenantId).toBe("tenant-2");
  });

  test("service URL falls back to turnContext.activity.serviceUrl when missing from the activity", async () => {
    const { saveSpy }: ConversationUpdateSpies = installSpies();
    mockMembers([]);

    const activity: JSONObject = groupChatBotAddedActivity();
    delete activity["serviceUrl"];

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: activity,
      turnContext: buildTurnContext(),
    });

    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.serviceUrl).toBe(TURN_CONTEXT_SERVICE_URL);
  });
});

describe("MicrosoftTeamsUtil.handleInstallationUpdateActivity", () => {
  interface InstallationSpies {
    saveSpy: jest.SpyInstance;
    removeSpy: jest.SpyInstance;
    welcomeSpy: jest.SpyInstance;
  }

  function installSpies(): InstallationSpies {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveChatToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeChatFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const welcomeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil as any, "sendWelcomeAdaptiveCard")
      .mockResolvedValue(undefined as never);
    return { saveSpy, removeSpy, welcomeSpy };
  }

  test("action 'add' on a group chat saves the chat (no welcome card here)", async () => {
    const { saveSpy, welcomeSpy }: InstallationSpies = installSpies();
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice" },
    ]);

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "add",
        conversation: {
          conversationType: "groupChat",
          id: "19:installed@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      },
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.tenantId).toBe("tenant-1");
    expect(saveArgs.chat.id).toBe("19:installed@thread.v2");
    expect(saveArgs.chat.chatType).toBe("groupChat");
    expect(welcomeSpy).not.toHaveBeenCalled();
  });

  test("action 'remove' removes the stored chat", async () => {
    const { saveSpy, removeSpy }: InstallationSpies = installSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "remove",
        conversation: {
          conversationType: "groupChat",
          id: "19:installed@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      chatId: "19:installed@thread.v2",
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("action 'add-upgrade' (app upgraded in an already-installed chat) also saves the chat", async () => {
    const { saveSpy }: InstallationSpies = installSpies();
    mockMembers([
      { id: BOT_RECIPIENT_ID, name: "OneUptime" },
      { id: "user-1", name: "Alice" },
    ]);

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "add-upgrade",
        conversation: {
          conversationType: "groupChat",
          id: "19:upgraded@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      },
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; chat: MicrosoftTeamsChat } = saveSpy
      .mock.calls[0]?.[0] as { tenantId: string; chat: MicrosoftTeamsChat };
    expect(saveArgs.chat.id).toBe("19:upgraded@thread.v2");
  });

  test("action 'remove-upgrade' also removes the stored chat", async () => {
    const { removeSpy }: InstallationSpies = installSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "remove-upgrade",
        conversation: {
          conversationType: "groupChat",
          id: "19:upgraded@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      chatId: "19:upgraded@thread.v2",
    });
  });

  test("action 'add' on a channel scope is ignored", async () => {
    const { saveSpy, removeSpy }: InstallationSpies = installSpies();
    mockMembers([]);

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "add",
        conversation: {
          conversationType: "channel",
          id: "19:channel@thread.tacv2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  test("unknown action does nothing", async () => {
    const { saveSpy, removeSpy }: InstallationSpies = installSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: {
        action: "update",
        conversation: {
          conversationType: "groupChat",
          id: "19:installed@thread.v2",
        },
        channelData: { tenant: { id: "tenant-1" } },
      },
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.sendAdaptiveCardToChat", () => {
  const ADAPTIVE_CARD: JSONObject = {
    type: "AdaptiveCard",
    body: [],
  };

  function mockProjectAuthWithChats(data?: {
    chats?: Record<string, MicrosoftTeamsChat> | undefined;
    workspaceProjectId?: string | undefined;
    miscData?: MicrosoftTeamsMiscData | null | undefined;
  }): void {
    let miscData: MicrosoftTeamsMiscData | undefined = undefined;
    if (data && "miscData" in data) {
      miscData = data.miscData === null ? undefined : data.miscData;
    } else {
      miscData = baseMiscData({ availableChats: data?.chats || {} });
    }
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        buildProjectAuthRow({
          workspaceProjectId:
            data && "workspaceProjectId" in data
              ? data.workspaceProjectId
              : "tenant-xyz",
          miscData: miscData,
        }),
      );
  }

  test("group chat happy path builds the right conversation reference", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      id: "19:groupchat@thread.v2",
      name: "Alice, Bob",
      chatType: "groupChat",
      serviceUrl: TURN_CONTEXT_SERVICE_URL,
    });
    mockProjectAuthWithChats({ chats: { [chat.id]: chat } });
    const capturedRefs: Array<ConversationReference> = installFakeBotAdapter();

    await MicrosoftTeamsUtil.sendAdaptiveCardToChat({
      chatId: chat.id,
      projectId: ObjectID.generate(),
      adaptiveCard: ADAPTIVE_CARD,
    });

    expect(capturedRefs).toHaveLength(1);
    const ref: ConversationReference = capturedRefs[0]!;
    expect(ref.conversation.id).toBe(chat.id);
    expect(ref.conversation.name).toBe("Alice, Bob");
    expect(ref.conversation.isGroup).toBe(true);
    expect(ref.conversation.conversationType).toBe("groupChat");
    expect(ref.conversation.tenantId).toBe("tenant-xyz");
    expect(ref.serviceUrl).toBe(TURN_CONTEXT_SERVICE_URL);
    expect(ref.channelId).toBe("msteams");
    expect(ref.bot.id).toBe(MOCK_APP_CLIENT_ID);
  });

  test("returns a WorkspaceThread with the chat as channel and the sent message id", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      id: "19:groupchat@thread.v2",
      name: "Alice, Bob",
    });
    mockProjectAuthWithChats({ chats: { [chat.id]: chat } });
    installFakeBotAdapter();

    const thread: WorkspaceThread =
      await MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: chat.id,
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      });

    expect(thread).toEqual({
      channel: {
        id: chat.id,
        name: "Alice, Bob",
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
      threadId: "msg-123",
    });
  });

  test("personal chat sends with isGroup false and conversationType personal", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      id: "a:1personal",
      name: "Alice",
      chatType: "personal",
    });
    mockProjectAuthWithChats({ chats: { [chat.id]: chat } });
    const capturedRefs: Array<ConversationReference> = installFakeBotAdapter();

    await MicrosoftTeamsUtil.sendAdaptiveCardToChat({
      chatId: chat.id,
      projectId: ObjectID.generate(),
      adaptiveCard: ADAPTIVE_CARD,
    });

    const ref: ConversationReference = capturedRefs[0]!;
    expect(ref.conversation.isGroup).toBe(false);
    expect(ref.conversation.conversationType).toBe("personal");
  });

  test("chat without a stored serviceUrl falls back to the global Teams service URL", async () => {
    const chat: MicrosoftTeamsChat = buildChat({
      id: "19:nourl@thread.v2",
      serviceUrl: undefined,
    });
    mockProjectAuthWithChats({ chats: { [chat.id]: chat } });
    const capturedRefs: Array<ConversationReference> = installFakeBotAdapter();

    await MicrosoftTeamsUtil.sendAdaptiveCardToChat({
      chatId: chat.id,
      projectId: ObjectID.generate(),
      adaptiveCard: ADAPTIVE_CARD,
    });

    expect(capturedRefs[0]!.serviceUrl).toBe(
      "https://smba.trafficmanager.net/teams/",
    );
  });

  test("threadId is empty string when sendActivity returns no response", async () => {
    const chat: MicrosoftTeamsChat = buildChat({ id: "19:noresp@thread.v2" });
    mockProjectAuthWithChats({ chats: { [chat.id]: chat } });
    installFakeBotAdapter({ sendActivityResponse: undefined });

    const thread: WorkspaceThread =
      await MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: chat.id,
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      });

    expect(thread.threadId).toBe("");
  });

  test("throws BadDataException when project auth is missing", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    installFakeBotAdapter();

    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: "19:any@thread.v2",
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Microsoft Teams integration not found for this project",
      ),
    );
  });

  test("throws BadDataException when project auth has no miscData", async () => {
    mockProjectAuthWithChats({ miscData: null });
    installFakeBotAdapter();

    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: "19:any@thread.v2",
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Microsoft Teams integration not found for this project",
      ),
    );
  });

  test("throws BadDataException when botId is missing from miscData", async () => {
    mockProjectAuthWithChats({
      miscData: baseMiscData({
        botId: undefined as unknown as string,
        availableChats: {},
      }),
    });
    installFakeBotAdapter();

    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: "19:any@thread.v2",
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      }),
    ).rejects.toThrow(
      new BadDataException("Bot ID not found in Microsoft Teams integration"),
    );
  });

  test("throws BadDataException when tenant id is missing from project auth", async () => {
    mockProjectAuthWithChats({
      chats: {},
      workspaceProjectId: undefined,
    });
    installFakeBotAdapter();

    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: "19:any@thread.v2",
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Tenant ID not found in Microsoft Teams integration",
      ),
    );
  });

  test("throws a helpful error when the chat id is not in availableChats", async () => {
    const otherChat: MicrosoftTeamsChat = buildChat({
      id: "19:other@thread.v2",
    });
    mockProjectAuthWithChats({ chats: { [otherChat.id]: otherChat } });
    installFakeBotAdapter();

    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChat({
        chatId: "19:unknown@thread.v2",
        projectId: ObjectID.generate(),
        adaptiveCard: ADAPTIVE_CARD,
      }),
    ).rejects.toThrow(/add the OneUptime app/i);
  });
});

describe("MicrosoftTeamsUtil.sendMessage - chat routing", () => {
  function buildChatPayload(data: {
    chatIds?: Array<string> | undefined;
    blockCount?: number | undefined;
  }): WorkspaceMessagePayload {
    const blocks: Array<WorkspacePayloadMarkdown> = [];
    const blockCount: number = data.blockCount ?? 1;
    for (let i: number = 0; i < blockCount; i++) {
      blocks.push({
        _type: "WorkspacePayloadMarkdown",
        text: `Block ${i}`,
      });
    }
    const payload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [],
      messageBlocks: blocks,
      workspaceType: WorkspaceType.MicrosoftTeams,
    };
    if ("chatIds" in data) {
      payload.chatIds = data.chatIds;
    }
    return payload;
  }

  function mockChatsForProject(
    chats: Record<string, MicrosoftTeamsChat>,
  ): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockResolvedValue(chats);
  }

  function mockSendCard(): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockImplementation(
        async (args: {
          chatId: string;
          projectId: ObjectID;
          adaptiveCard: JSONObject;
        }): Promise<WorkspaceThread> => {
          return {
            channel: {
              id: args.chatId,
              name: `chat-name-${args.chatId}`,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: `thread-${args.chatId}`,
          };
        },
      );
  }

  const TWO_CHATS: Record<string, MicrosoftTeamsChat> = {
    "chat-1": buildChat({ id: "chat-1", name: "Ops group chat" }),
    "chat-2": buildChat({
      id: "chat-2",
      name: "Alice",
      chatType: "personal",
    }),
  };

  test("payload with ONLY chatIds (no teamId, no channels) does not throw and sends one card per chat", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();
    const projectId: ObjectID = ObjectID.generate();

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({
          chatIds: ["chat-1", "chat-2"],
        }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: projectId,
      });

    expect(sendCardSpy).toHaveBeenCalledTimes(2);
    expect(sendCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-1", projectId: projectId }),
    );
    expect(sendCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat-2", projectId: projectId }),
    );
    expect(response.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(response.errors).toEqual([]);
  });

  test("threads are collected per chat from sendAdaptiveCardToChat results", async () => {
    mockChatsForProject(TWO_CHATS);
    mockSendCard();

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({
          chatIds: ["chat-1", "chat-2"],
        }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(response.threads).toHaveLength(2);
    expect(response.threads).toEqual([
      {
        channel: {
          id: "chat-1",
          name: "chat-name-chat-1",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        threadId: "thread-chat-1",
      },
      {
        channel: {
          id: "chat-2",
          name: "chat-name-chat-2",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        threadId: "thread-chat-2",
      },
    ]);
  });

  test("each send passes an AdaptiveCard payload built from the message blocks", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: buildChatPayload({ chatIds: ["chat-1"] }),
      authToken: "auth-token",
      userId: "user-1",
      projectId: ObjectID.generate(),
    });

    const sendArgs: { adaptiveCard: JSONObject } = sendCardSpy.mock
      .calls[0]?.[0] as { adaptiveCard: JSONObject };
    expect(sendArgs.adaptiveCard["type"]).toBe("AdaptiveCard");
    expect(Array.isArray(sendArgs.adaptiveCard["body"])).toBe(true);
  });

  test("one chat failing records an error with the resolved chat name and the others still send", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockImplementation(
        async (args: {
          chatId: string;
          projectId: ObjectID;
          adaptiveCard: JSONObject;
        }): Promise<WorkspaceThread> => {
          if (args.chatId === "chat-1") {
            throw new Error("proactive send failed");
          }
          return {
            channel: {
              id: args.chatId,
              name: `chat-name-${args.chatId}`,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: `thread-${args.chatId}`,
          };
        },
      );

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({
          chatIds: ["chat-1", "chat-2"],
        }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(sendCardSpy).toHaveBeenCalledTimes(2);
    expect(response.errors).toEqual([
      {
        channel: {
          id: "chat-1",
          // Name resolved from the availableChats store, not the chat id.
          name: "Ops group chat",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        error: "proactive send failed",
      },
    ]);
    expect(response.threads).toHaveLength(1);
    expect(response.threads[0]?.channel.id).toBe("chat-2");
  });

  test("a failing chat id not present in availableChats falls back to the id as name", async () => {
    mockChatsForProject({});
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockRejectedValue(new Error("not connected"));

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({
          chatIds: ["chat-unknown"],
        }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(response.errors).toEqual([
      {
        channel: {
          id: "chat-unknown",
          name: "chat-unknown",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        error: "not connected",
      },
    ]);
  });

  test("non-Error rejection is stringified into the error entry", async () => {
    mockChatsForProject(TWO_CHATS);
    jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockRejectedValue("plain string failure" as never);

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({ chatIds: ["chat-1"] }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0]?.error).toBe("plain string failure");
  });

  test("more than 40 message blocks are chunked: one send per chunk per chat", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    // 85 blocks -> chunks of 40, 40, 5 -> 3 cards per chat.
    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({
          chatIds: ["chat-1", "chat-2"],
          blockCount: 85,
        }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(sendCardSpy).toHaveBeenCalledTimes(6);
    const chatOneCalls: Array<unknown> = sendCardSpy.mock.calls.filter(
      (call: Array<unknown>) => {
        return (call[0] as { chatId: string }).chatId === "chat-1";
      },
    );
    expect(chatOneCalls).toHaveLength(3);
    // Only the LAST thread per chat is collected.
    expect(response.threads).toHaveLength(2);
  });

  test("exactly 40 blocks stays a single card per chat", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: buildChatPayload({
        chatIds: ["chat-1"],
        blockCount: 40,
      }),
      authToken: "auth-token",
      userId: "user-1",
      projectId: ObjectID.generate(),
    });

    expect(sendCardSpy).toHaveBeenCalledTimes(1);
  });

  test("41 blocks becomes two cards per chat", async () => {
    mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    await MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: buildChatPayload({
        chatIds: ["chat-1"],
        blockCount: 41,
      }),
      authToken: "auth-token",
      userId: "user-1",
      projectId: ObjectID.generate(),
    });

    expect(sendCardSpy).toHaveBeenCalledTimes(2);
  });

  test("empty chatIds array sends nothing and never loads the chat store", async () => {
    const chatsSpy: jest.SpyInstance = mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({ chatIds: [] }),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(sendCardSpy).not.toHaveBeenCalled();
    expect(chatsSpy).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([]);
  });

  test("absent chatIds field sends nothing", async () => {
    const chatsSpy: jest.SpyInstance = mockChatsForProject(TWO_CHATS);
    const sendCardSpy: jest.SpyInstance = mockSendCard();

    const response: WorkspaceSendMessageResponse =
      await MicrosoftTeamsUtil.sendMessage({
        workspaceMessagePayload: buildChatPayload({}),
        authToken: "auth-token",
        userId: "user-1",
        projectId: ObjectID.generate(),
      });

    expect(sendCardSpy).not.toHaveBeenCalled();
    expect(chatsSpy).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
  });
});
