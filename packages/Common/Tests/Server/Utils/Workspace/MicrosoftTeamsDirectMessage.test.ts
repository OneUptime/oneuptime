import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Tests for the Microsoft Teams DIRECT MESSAGE path —
 * MicrosoftTeamsUtil.sendDirectMessageToUserAsBot, the sender behind the
 * "Microsoft Teams" user notification method.
 *
 * The problem it solves, and the reason it exists next to the older
 * sendDirectMessageToUser: WorkspaceUserAuthToken stores the user's Microsoft
 * ENTRA OBJECT ID, but the Graph-based helper posts to /chats/{chatId} and so
 * needs a CHAT id — the two id spaces never meet. This method resolves a
 * deliverable conversation from the Entra id instead, two ways:
 *
 *   1. REUSE. A personal chat previously captured from a bot activity (whose
 *      roster contained this Entra id) is known-deliverable and carries the
 *      regional serviceUrl, so it is preferred and delivered through the
 *      existing sendAdaptiveCardToChat path.
 *
 *   2. CREATE. Otherwise Bot Framework createConversation is asked to resolve
 *      (or create) the 1:1 conversation from the member's Entra id — which
 *      works exactly when the OneUptime app is installed for that user, so
 *      Microsoft's opaque roster rejection is translated into "install the
 *      OneUptime app" before anybody reads it off an on-call timeline.
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

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import type { ConversationParameters, TurnContext } from "botbuilder";
import { JSONObject } from "../../../../Types/JSON";

const MOCK_APP_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TENANT_ID: string = "tenant-xyz";
const ENTRA_OBJECT_ID: string = "e6f1c1f7-aad0-4b6c-9c11-2f5b7c8d9e0f";
const PERSONAL_CHAT_ID: string = "a:1personalchat";
const DEFAULT_SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";
const REGIONAL_SERVICE_URL: string = "https://smba.emea.teams.microsoft.com/";
const ROSTER_ERROR_TEXT: string =
  "The bot is not part of the conversation roster.";

function markdownBlocks(): Array<WorkspaceMessageBlock> {
  const block: WorkspacePayloadMarkdown = {
    _type: "WorkspacePayloadMarkdown",
    text: "**incident** page body",
  };
  return [block];
}

function personalChat(
  overrides: Partial<MicrosoftTeamsChat> = {},
): MicrosoftTeamsChat {
  return {
    id: PERSONAL_CHAT_ID,
    name: "Alice Example",
    chatType: "personal",
    serviceUrl: REGIONAL_SERVICE_URL,
    memberAadObjectIds: [ENTRA_OBJECT_ID],
    ...overrides,
  } as MicrosoftTeamsChat;
}

function miscData(
  overrides: Partial<MicrosoftTeamsMiscData> = {},
): MicrosoftTeamsMiscData {
  return {
    tenantId: TENANT_ID,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    ...overrides,
  } as MicrosoftTeamsMiscData;
}

function mockProjectAuth(
  overrides: Partial<MicrosoftTeamsMiscData> = {},
): jest.SpyInstance {
  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      id: PROJECT_ID,
      workspaceProjectId: TENANT_ID,
      miscData: miscData(overrides),
    } as unknown as WorkspaceProjectAuthToken as never);
}

interface FakeCreateAdapter {
  createConversationAsync: jest.Mock;
  capturedParams: Array<ConversationParameters>;
  capturedServiceUrls: Array<string>;
  sentActivities: Array<unknown>;
}

function installFakeCreateAdapter(options?: {
  createError?: unknown;
}): FakeCreateAdapter {
  const capturedParams: Array<ConversationParameters> = [];
  const capturedServiceUrls: Array<string> = [];
  const sentActivities: Array<unknown> = [];

  const createConversationAsync: jest.Mock = jest.fn(
    async (
      _appId: string,
      _channelId: string,
      serviceUrl: string,
      _audience: string,
      conversationParameters: ConversationParameters,
      logic: (context: TurnContext) => Promise<void>,
    ): Promise<void> => {
      capturedServiceUrls.push(serviceUrl);
      capturedParams.push(conversationParameters);

      if (options && "createError" in options) {
        throw options.createError;
      }

      const fakeContext: TurnContext = {
        sendActivity: async (activity: unknown): Promise<unknown> => {
          sentActivities.push(activity);
          return { id: "msg-123" };
        },
      } as unknown as TurnContext;

      await logic(fakeContext);
    },
  );

  jest
    .spyOn(MicrosoftTeamsUtil as any, "getBotAdapter")
    .mockReturnValue({ createConversationAsync: createConversationAsync });

  return {
    createConversationAsync: createConversationAsync,
    capturedParams: capturedParams,
    capturedServiceUrls: capturedServiceUrls,
    sentActivities: sentActivities,
  };
}

describe("MicrosoftTeamsUtil.sendDirectMessageToUserAsBot", () => {
  let sendToChat: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

    sendToChat = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat")
      .mockResolvedValue({
        channel: {
          id: PERSONAL_CHAT_ID,
          name: "Alice Example",
          workspaceType: "MicrosoftTeams",
        },
        threadId: "msg-1",
      } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A) Reusing a captured personal chat.
   * -----------------------------------------------------------------------
   */

  describe("reusing a captured personal chat", () => {
    test("a personal chat whose roster carries the Entra id is delivered through sendAdaptiveCardToChat", async () => {
      mockProjectAuth({
        availableChats: { [PERSONAL_CHAT_ID]: personalChat() },
      });
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(sendToChat).toHaveBeenCalledTimes(1);
      const arg: { chatId: string; projectId: ObjectID } = sendToChat.mock
        .calls[0][0] as { chatId: string; projectId: ObjectID };
      expect(arg.chatId).toBe(PERSONAL_CHAT_ID);
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());

      // The Bot Framework create path is not touched at all.
      expect(adapter.createConversationAsync).not.toHaveBeenCalled();
    });

    test("a page through a captured chat carries its notification line as the card's summary", async () => {
      mockProjectAuth({
        availableChats: { [PERSONAL_CHAT_ID]: personalChat() },
      });
      installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
        text: "🚨 New alert assigned to you: AL-3 — Disk full",
      });

      expect(
        (sendToChat.mock.calls[0][0] as { summary?: string }).summary,
      ).toBe("🚨 New alert assigned to you: AL-3 — Disk full");
    });

    test("a personal chat belonging to somebody ELSE is not reused", async () => {
      mockProjectAuth({
        availableChats: {
          [PERSONAL_CHAT_ID]: personalChat({
            memberAadObjectIds: ["some-other-user"],
          }),
        },
      });
      installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(sendToChat).not.toHaveBeenCalled();
    });

    test("a GROUP chat carrying the Entra id is not reused - a page is a direct message, not a group post", async () => {
      mockProjectAuth({
        availableChats: {
          [PERSONAL_CHAT_ID]: personalChat({ chatType: "groupChat" }),
        },
      });
      installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(sendToChat).not.toHaveBeenCalled();
    });

    test("a legacy personal chat with NO captured roster is not matched (absent means unknown, not mine)", async () => {
      mockProjectAuth({
        availableChats: {
          [PERSONAL_CHAT_ID]: personalChat({ memberAadObjectIds: undefined }),
        },
      });
      installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(sendToChat).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) Creating the conversation from the Entra id.
   * -----------------------------------------------------------------------
   */

  describe("creating the 1:1 conversation via Bot Framework", () => {
    test("createConversation is asked for a non-group conversation with the member's Entra id and the tenant", async () => {
      mockProjectAuth();
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.createConversationAsync).toHaveBeenCalledTimes(1);
      const params: ConversationParameters = adapter
        .capturedParams[0] as ConversationParameters;
      expect(params.isGroup).toBe(false);
      expect(params.members?.[0]?.id).toBe(ENTRA_OBJECT_ID);
      expect(params.tenantId).toBe(TENANT_ID);
      expect((params.channelData as { tenant: { id: string } }).tenant.id).toBe(
        TENANT_ID,
      );
      // 28:<appId> is the Teams-side bot account id.
      expect(params.bot?.id).toBe(`28:${MOCK_APP_CLIENT_ID}`);
    });

    test("the adaptive card is sent inside the created conversation", async () => {
      mockProjectAuth();
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.sentActivities).toHaveLength(1);
      const activity: { attachments: Array<{ contentType: string }> } = adapter
        .sentActivities[0] as { attachments: Array<{ contentType: string }> };
      expect(activity.attachments[0]?.contentType).toBe(
        "application/vnd.microsoft.card.adaptive",
      );
    });

    /*
     * A page arrives as this card: what the phone's notification says is its
     * summary, never "OneUptime sent a card".
     */
    test("the card carries the page's notification line as its summary", async () => {
      mockProjectAuth();
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
        text: "🚨 New incident assigned to you: INC-8 — Checkout is down",
      });

      expect((adapter.sentActivities[0] as { summary?: string }).summary).toBe(
        "🚨 New incident assigned to you: INC-8 — Checkout is down",
      );
    });

    test("without a line, the card is sent as it always was", async () => {
      mockProjectAuth();
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.sentActivities[0]).not.toHaveProperty("summary");
    });

    test("falls back to the commercial-cloud serviceUrl when nothing regional was ever captured", async () => {
      mockProjectAuth();
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.capturedServiceUrls[0]).toBe(DEFAULT_SERVICE_URL);
    });

    test("prefers a regional serviceUrl captured on ANY chat (required for GCC/DoD)", async () => {
      mockProjectAuth({
        availableChats: {
          "a:someoneelse": personalChat({
            id: "a:someoneelse",
            memberAadObjectIds: ["some-other-user"],
            serviceUrl: REGIONAL_SERVICE_URL,
          }),
        },
      });
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.capturedServiceUrls[0]).toBe(REGIONAL_SERVICE_URL);
    });

    /*
     * botbuilder attaches the bot's Bot Framework token to the request
     * whatever host the serviceUrl names, so a stored URL that is not
     * Microsoft's is never picked (see MicrosoftTeamsServiceUrl).
     */
    test("skips a captured serviceUrl that is not a Microsoft host", async () => {
      mockProjectAuth({
        availableChats: {
          "a:tampered": personalChat({
            id: "a:tampered",
            memberAadObjectIds: ["some-other-user"],
            serviceUrl: "https://attacker.example.com/",
          }),
        },
        installedTeams: {
          "team-1": {
            id: "team-1",
            serviceUrl: "https://smba.infra.dod.teams.microsoft.us/dod",
          },
        },
      });
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.capturedServiceUrls).toEqual([
        "https://smba.infra.dod.teams.microsoft.us/dod",
      ]);
    });

    test("falls back to the commercial endpoint when every captured serviceUrl is untrusted", async () => {
      mockProjectAuth({
        availableChats: {
          "a:tampered": personalChat({
            id: "a:tampered",
            memberAadObjectIds: ["some-other-user"],
            serviceUrl: "https://attacker.trafficmanager.net/teams/",
          }),
        },
      });
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      });

      expect(adapter.capturedServiceUrls).toEqual([DEFAULT_SERVICE_URL]);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) Failure translation and refusals.
   * -----------------------------------------------------------------------
   */

  describe("failure translation and refusals", () => {
    test("Microsoft's roster rejection becomes 'install the OneUptime app', the one fix that works", async () => {
      mockProjectAuth();
      installFakeCreateAdapter({
        createError: new Error(ROSTER_ERROR_TEXT),
      });

      await expect(
        MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: PROJECT_ID,
          workspaceUserId: ENTRA_OBJECT_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "The OneUptime app is not installed for this Microsoft Teams user. Ask them to add the OneUptime app in Microsoft Teams (personal scope) so the bot can message them directly.",
      );
    });

    test("every other Bot Framework error passes through untouched", async () => {
      mockProjectAuth();
      installFakeCreateAdapter({
        createError: new Error("throttled: too many requests"),
      });

      await expect(
        MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: PROJECT_ID,
          workspaceUserId: ENTRA_OBJECT_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow("throttled: too many requests");
    });

    test("a project with no Teams integration is refused before the Bot Framework is touched", async () => {
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
        .mockResolvedValue(null as never);
      const adapter: FakeCreateAdapter = installFakeCreateAdapter();

      await expect(
        MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: PROJECT_ID,
          workspaceUserId: ENTRA_OBJECT_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(
        "Microsoft Teams integration not found for this project",
      );

      expect(adapter.createConversationAsync).not.toHaveBeenCalled();
    });

    test("a project auth row with no tenant id is refused", async () => {
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
        .mockResolvedValue({
          id: PROJECT_ID,
          workspaceProjectId: undefined,
          miscData: miscData(),
        } as unknown as WorkspaceProjectAuthToken as never);
      installFakeCreateAdapter();

      await expect(
        MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
          projectId: PROJECT_ID,
          workspaceUserId: ENTRA_OBJECT_ID,
          messageBlocks: markdownBlocks(),
        }),
      ).rejects.toThrow(BadDataException);
    });
  });
});

/*
 * WHERE THE CARD LANDED, AND EDITING IT THERE (#6317). A public note's
 * approval card is kept as it is sent - the personal chat, the activity's
 * id and the service the chat is at - and replaced once the note is
 * decided. A personal chat the bot opened itself (createConversation) is
 * never captured, so the edit addresses it at the service it was opened at,
 * held to Microsoft's hosts like every send.
 */
describe("MicrosoftTeamsUtil.sendDirectMessageToUserAsBot - where the card landed", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("through a captured personal chat: that chat, the activity, and the chat's service", async () => {
    mockProjectAuth({
      availableChats: { [PERSONAL_CHAT_ID]: personalChat() },
    });
    installFakeCreateAdapter();
    jest.spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChat").mockResolvedValue({
      channel: {
        id: PERSONAL_CHAT_ID,
        name: "Alice Example",
        workspaceType: "MicrosoftTeams",
      },
      threadId: "msg-1",
    } as never);

    expect(
      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      }),
    ).toEqual({
      channelId: PERSONAL_CHAT_ID,
      messageId: "msg-1",
      serviceUrl: REGIONAL_SERVICE_URL,
    });
  });

  test("through a chat the bot opened: the conversation Teams made, the activity, and the service it is at", async () => {
    mockProjectAuth();

    jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
      createConversationAsync: async (
        _appId: string,
        _channelId: string,
        serviceUrl: string,
        _audience: string,
        _parameters: unknown,
        logic: (context: TurnContext) => Promise<void>,
      ): Promise<void> => {
        await logic({
          activity: {
            conversation: { id: "a:1conversation-teams-made" },
            serviceUrl: serviceUrl,
          },
          sendActivity: async (): Promise<unknown> => {
            return { id: "1:activity-sent" };
          },
        } as unknown as TurnContext);
      },
    });

    expect(
      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      }),
    ).toEqual({
      channelId: "a:1conversation-teams-made",
      messageId: "1:activity-sent",
      serviceUrl: DEFAULT_SERVICE_URL,
    });
  });

  test("Teams naming no conversation or no activity: nowhere to say", async () => {
    mockProjectAuth();
    installFakeCreateAdapter();

    expect(
      await MicrosoftTeamsUtil.sendDirectMessageToUserAsBot({
        projectId: PROJECT_ID,
        workspaceUserId: ENTRA_OBJECT_ID,
        messageBlocks: markdownBlocks(),
      }),
    ).toBeNull();
  });
});

describe("MicrosoftTeamsUtil.updateMessage of a personal chat", () => {
  interface Continued {
    reference: {
      conversation: JSONObject;
      serviceUrl: string;
    };
    updates: Array<JSONObject>;
  }

  function installContinueAdapter(): Continued {
    const continued: Continued = {
      reference: { conversation: {}, serviceUrl: "" },
      updates: [],
    };

    jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
      continueConversationAsync: async (
        _appId: string,
        reference: { conversation: JSONObject; serviceUrl: string },
        logic: (context: TurnContext) => Promise<void>,
      ): Promise<void> => {
        continued.reference = reference;
        await logic({
          updateActivity: async (activity: JSONObject): Promise<void> => {
            continued.updates.push(activity);
          },
        } as unknown as TurnContext);
      },
    });

    return continued;
  }

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one the bot opened and never captured is edited at the service it was opened at", async () => {
    mockProjectAuth();
    const continued: Continued = installContinueAdapter();

    await MicrosoftTeamsUtil.updateMessage({
      authToken: "unused",
      projectId: PROJECT_ID,
      location: {
        channelId: "a:1conversation-teams-made",
        isChat: true,
        serviceUrl: REGIONAL_SERVICE_URL,
      },
      messageId: "1:activity-sent",
      messageBlocks: markdownBlocks(),
      text: "This public note was approved",
    });

    expect(continued.reference.serviceUrl).toBe(REGIONAL_SERVICE_URL);
    expect(continued.reference.conversation).toMatchObject({
      id: "a:1conversation-teams-made",
      isGroup: false,
      conversationType: "personal",
      tenantId: TENANT_ID,
    });
    expect(continued.updates).toHaveLength(1);
    expect(continued.updates[0]!["id"]).toBe("1:activity-sent");
    expect(continued.updates[0]!["summary"]).toBe(
      "This public note was approved",
    );
  });

  test("a captured chat is edited at the service it was captured with, whatever the location says", async () => {
    mockProjectAuth({
      availableChats: { [PERSONAL_CHAT_ID]: personalChat() },
    });
    const continued: Continued = installContinueAdapter();

    await MicrosoftTeamsUtil.updateMessage({
      authToken: "unused",
      projectId: PROJECT_ID,
      location: {
        channelId: PERSONAL_CHAT_ID,
        isChat: true,
        serviceUrl: DEFAULT_SERVICE_URL,
      },
      messageId: "msg-1",
      messageBlocks: markdownBlocks(),
    });

    expect(continued.reference.serviceUrl).toBe(REGIONAL_SERVICE_URL);
    expect(continued.reference.conversation["id"]).toBe(PERSONAL_CHAT_ID);
  });

  test("a stored service that is not Microsoft's is refused, and nothing is sent to it", async () => {
    mockProjectAuth();
    const continued: Continued = installContinueAdapter();

    await expect(
      MicrosoftTeamsUtil.updateMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: {
          channelId: "a:1conversation-teams-made",
          isChat: true,
          serviceUrl: "https://attacker.example/teams/",
        },
        messageId: "1:activity-sent",
        messageBlocks: markdownBlocks(),
      }),
    ).rejects.toThrow(BadDataException);

    expect(continued.updates).toEqual([]);
  });

  test("a chat neither captured nor named with its service is refused, as before", async () => {
    mockProjectAuth();
    const continued: Continued = installContinueAdapter();

    await expect(
      MicrosoftTeamsUtil.updateMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: "a:1unknown", isChat: true },
        messageId: "1:activity-sent",
        messageBlocks: markdownBlocks(),
      }),
    ).rejects.toThrow("This chat is not connected to OneUptime");

    expect(continued.updates).toEqual([]);
  });
});
