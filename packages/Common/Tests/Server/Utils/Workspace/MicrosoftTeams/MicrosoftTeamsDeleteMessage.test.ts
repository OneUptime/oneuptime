import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A CARD THE BOT POSTED, DELETED (Bot Framework deleteActivity), so what
 * OneUptime AI read in a call's transcript is taken back from the incident's
 * Microsoft Teams channels and chats with the transcript (#9290). It is
 * found where an edit finds it - a channel post as its own thread, a chat as
 * the conversation, at the service the team or chat was captured with - and
 * a post Teams no longer has was deleted already. Editing a card
 * (updateMessage) goes the same way as before.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
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

import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import logger from "../../../../../Server/Utils/Logger";
import ObjectID from "../../../../../Types/ObjectID";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { WorkspacePayloadMarkdown } from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import { JSONObject } from "../../../../../Types/JSON";
import type { TurnContext } from "botbuilder";

const APP_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TENANT_ID: string = "tenant-xyz";
const TEAM_ID: string = "graph-team-1";
const CHANNEL_ID: string = "19:abc@thread.tacv2";
const CHAT_ID: string = "19:groupchat@thread.v2";
const TEAM_SERVICE_URL: string = "https://smba.emea.teams.microsoft.com/";
const CHAT_SERVICE_URL: string = "https://smba.amer.teams.microsoft.com/";

function mockProjectAuth(): void {
  const miscData: MicrosoftTeamsMiscData = {
    tenantId: TENANT_ID,
    teamId: "team-1",
    teamName: "Engineering",
    botId: "bot-1",
    installedTeams: {
      [TEAM_ID]: {
        id: TEAM_ID,
        graphTeamId: TEAM_ID,
        name: "Engineering",
        serviceUrl: TEAM_SERVICE_URL,
      },
    },
    availableChats: {
      [CHAT_ID]: {
        id: CHAT_ID,
        name: "Incident war room",
        chatType: "groupChat",
        serviceUrl: CHAT_SERVICE_URL,
      } as MicrosoftTeamsChat,
    },
  } as unknown as MicrosoftTeamsMiscData;

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      id: PROJECT_ID,
      workspaceProjectId: TENANT_ID,
      miscData,
    } as unknown as WorkspaceProjectAuthToken as never);
}

interface Continued {
  appId: string;
  reference: { conversation: JSONObject; serviceUrl: string; bot: JSONObject };
  deleted: Array<string>;
  updated: Array<JSONObject>;
}

function installAdapter(options?: { deleteError?: unknown }): Continued {
  const continued: Continued = {
    appId: "",
    reference: { conversation: {}, serviceUrl: "", bot: {} },
    deleted: [],
    updated: [],
  };

  jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
    continueConversationAsync: async (
      appId: string,
      reference: Continued["reference"],
      logic: (context: TurnContext) => Promise<void>,
    ): Promise<void> => {
      continued.appId = appId;
      continued.reference = reference;
      await logic({
        deleteActivity: async (activityId: string): Promise<void> => {
          if (options?.deleteError) {
            throw options.deleteError;
          }

          continued.deleted.push(activityId);
        },
        updateActivity: async (activity: JSONObject): Promise<void> => {
          continued.updated.push(activity);
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

describe("MicrosoftTeamsUtil.deleteMessage", () => {
  test("a channel post is deleted as its own thread, at the service its team was captured with", async () => {
    mockProjectAuth();
    const continued: Continued = installAdapter();

    await MicrosoftTeamsUtil.deleteMessage({
      authToken: "unused",
      projectId: PROJECT_ID,
      location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
      messageId: "1760713500123",
    });

    expect(continued.appId).toBe(APP_CLIENT_ID);
    expect(continued.reference.serviceUrl).toBe(TEAM_SERVICE_URL);
    expect(continued.reference.conversation).toMatchObject({
      id: `${CHANNEL_ID};messageid=1760713500123`,
      conversationType: "channel",
      tenantId: TENANT_ID,
    });
    expect(continued.reference.bot["id"]).toBe(APP_CLIENT_ID);
    expect(continued.deleted).toEqual(["1760713500123"]);
    expect(continued.updated).toEqual([]);
  });

  test("a chat post is deleted in the chat, at the service the chat was captured with", async () => {
    mockProjectAuth();
    const continued: Continued = installAdapter();

    await MicrosoftTeamsUtil.deleteMessage({
      authToken: "unused",
      projectId: PROJECT_ID,
      location: { channelId: CHAT_ID, isChat: true },
      messageId: "1760713500999",
    });

    expect(continued.reference.serviceUrl).toBe(CHAT_SERVICE_URL);
    expect(continued.reference.conversation).toMatchObject({
      id: CHAT_ID,
      conversationType: "groupChat",
      isGroup: true,
    });
    expect(continued.deleted).toEqual(["1760713500999"]);
  });

  test("a post Teams no longer has was deleted already", async () => {
    mockProjectAuth();
    installAdapter({ deleteError: { statusCode: 404, code: "NotFound" } });

    await expect(
      MicrosoftTeamsUtil.deleteMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
        messageId: "1760713500123",
      }),
    ).resolves.toBeUndefined();
  });

  test("any other refusal is thrown, for the removal to say where the post stays", async () => {
    mockProjectAuth();
    installAdapter({
      deleteError: new Error("The bot is not part of the conversation roster."),
    });

    await expect(
      MicrosoftTeamsUtil.deleteMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
        messageId: "1760713500123",
      }),
    ).rejects.toThrow("roster");
  });

  test("a chat the project never captured cannot be found, and nothing is sent", async () => {
    mockProjectAuth();
    const continued: Continued = installAdapter();

    await expect(
      MicrosoftTeamsUtil.deleteMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: "19:unknown@thread.v2", isChat: true },
        messageId: "1760713500999",
      }),
    ).rejects.toThrow("This chat is not connected to OneUptime");
    expect(continued.deleted).toEqual([]);
  });

  test("no message id: refused before Teams is asked", async () => {
    mockProjectAuth();
    const continued: Continued = installAdapter();

    await expect(
      MicrosoftTeamsUtil.deleteMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
        messageId: "",
      }),
    ).rejects.toThrow(
      "A channel or chat and a message id are required to delete a Microsoft Teams message",
    );
    expect(continued.deleted).toEqual([]);
  });

  test("a project whose Teams connection is gone cannot delete there", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null as never);
    installAdapter();

    await expect(
      MicrosoftTeamsUtil.deleteMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
        messageId: "1760713500123",
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("MicrosoftTeamsUtil.updateMessage, found where a delete finds it", () => {
  test("a channel post is edited as its own thread, with its summary", async () => {
    mockProjectAuth();
    const continued: Continued = installAdapter();
    const block: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: "**updated**",
    };

    await MicrosoftTeamsUtil.updateMessage({
      authToken: "unused",
      projectId: PROJECT_ID,
      location: { channelId: CHANNEL_ID, teamId: TEAM_ID },
      messageId: "1760713500123",
      messageBlocks: [block],
      text: "Updated",
    });

    expect(continued.reference.serviceUrl).toBe(TEAM_SERVICE_URL);
    expect(continued.reference.conversation["id"]).toBe(
      `${CHANNEL_ID};messageid=1760713500123`,
    );
    expect(continued.updated).toHaveLength(1);
    expect(continued.updated[0]!["id"]).toBe("1760713500123");
    expect(continued.updated[0]!["summary"]).toBe("Updated");
    expect(continued.deleted).toEqual([]);
  });

  test("no message id is refused as an update, in the words it always had", async () => {
    mockProjectAuth();
    installAdapter();

    await expect(
      MicrosoftTeamsUtil.updateMessage({
        authToken: "unused",
        projectId: PROJECT_ID,
        location: { channelId: CHANNEL_ID },
        messageId: "",
        messageBlocks: [],
      }),
    ).rejects.toThrow(
      "A channel or chat and a message id are required to update a Microsoft Teams message",
    );
  });
});
