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
