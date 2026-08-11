import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Tests for the Microsoft Teams CHANNEL delivery path in MicrosoftTeamsUtil.
 *
 * The bug these pin down: channels are DISCOVERED with tenant-wide Graph
 * application permissions (which can see every team in the tenant) but are
 * DELIVERED to over Bot Framework proactive messaging, which only accepts a
 * post into a team the OneUptime app is actually installed in. So a channel
 * could be picked in the dashboard, validate green, and then fail at send time
 * with Microsoft's opaque "The bot is not part of the conversation roster."
 *
 * sendAdaptiveCardToChannel now:
 * - refuses shared channels up front (bots cannot post in them at all),
 * - preflights miscData.installedTeams and refuses before touching the Bot
 *   Framework when the app was never installed into the target team — while
 *   staying permissive for legacy workspaces whose install map is empty,
 * - uses the serviceUrl captured on install (required for GCC/DoD) instead of
 *   always assuming the commercial-cloud endpoint,
 * - translates Microsoft's roster rejection into instructions an admin can act
 *   on, and lets every other error through untouched.
 *
 * sendMessage now REPORTS destinations it cannot even resolve (an unknown
 * channel name, a channel id whose lookup throws). Both used to be swallowed,
 * so a typo'd or deleted channel reported a successful send.
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
 * Same botbuilder module factory as MicrosoftTeamsChats.test.ts — the repo-wide
 * manual mock (Tests/__mocks__/botbuilder.js) does not expose TeamsInfo or
 * MessageFactory.attachment, both of which these code paths use.
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
      getPagedMembers: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../../../../Server/Utils/Workspace/WorkspaceBase";
import {
  MessageFactory,
  CardFactory,
  TeamsInfo,
  type ConversationReference,
  type TurnContext,
} from "botbuilder";

const MOCK_APP_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";
const TENANT_ID: string = "tenant-xyz";
const TEAM_ID: string = "team-1";
const CHANNEL_ID: string = "19:general@thread.tacv2";
const DEFAULT_SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";
const GCC_SERVICE_URL: string = "https://smba.infra.gov.teams.microsoft.us/";
const ROSTER_ERROR_TEXT: string =
  "The bot is not part of the conversation roster.";

const ADAPTIVE_CARD: JSONObject = {
  type: "AdaptiveCard",
  body: [],
};

type ProactiveCallback = (context: TurnContext) => Promise<void>;

interface FakeBotAdapter {
  capturedRefs: Array<ConversationReference>;
  continueConversationAsync: jest.Mock;
  getBotAdapterSpy: jest.SpyInstance;
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

function baseMiscData(
  overrides?: Partial<MicrosoftTeamsMiscData>,
): MicrosoftTeamsMiscData {
  return {
    tenantId: TENANT_ID,
    teamId: TEAM_ID,
    teamName: "Engineering",
    botId: "bot-1",
    ...(overrides || {}),
  } as MicrosoftTeamsMiscData;
}

function buildInstalledTeam(data: {
  id: string;
  name?: string | undefined;
  serviceUrl?: string | undefined;
}): MicrosoftTeamsInstalledTeam {
  const installedTeam: MicrosoftTeamsInstalledTeam = {
    id: data.id,
    name: data.name || "Engineering",
    addedAt: "2026-07-27T00:00:00.000Z",
  };
  if ("serviceUrl" in data) {
    installedTeam.serviceUrl = data.serviceUrl;
  }
  return installedTeam;
}

function buildChannel(data?: {
  id?: string | undefined;
  name?: string | undefined;
  membershipType?: string | undefined;
  teamId?: string | undefined;
}): WorkspaceChannel {
  const channel: WorkspaceChannel = {
    id: data?.id || CHANNEL_ID,
    name: data?.name || "General",
    workspaceType: WorkspaceType.MicrosoftTeams,
    teamId: data?.teamId || TEAM_ID,
  };
  if (data && "membershipType" in data) {
    channel.membershipType = data.membershipType;
  }
  return channel;
}

/*
 * Mirrors installFakeBotAdapter from MicrosoftTeamsChats.test.ts, plus a way to
 * make the adapter (or the proactive callback) reject so the roster-error
 * translation can be exercised, and the raw jest.fn/spy so tests can assert the
 * Bot Framework was never reached at all.
 */
function installFakeBotAdapter(options?: {
  sendActivityResponse?: JSONObject | undefined;
  adapterError?: unknown;
  sendActivityError?: unknown;
}): FakeBotAdapter {
  const capturedRefs: Array<ConversationReference> = [];
  const continueConversationAsync: jest.Mock = jest.fn(
    async (
      _appId: string,
      ref: ConversationReference,
      cb: ProactiveCallback,
    ): Promise<void> => {
      capturedRefs.push(ref);

      if (options && "adapterError" in options) {
        throw options.adapterError;
      }

      const fakeContext: TurnContext = {
        sendActivity: async (): Promise<JSONObject | undefined> => {
          if (options && "sendActivityError" in options) {
            throw options.sendActivityError;
          }
          if (options && "sendActivityResponse" in options) {
            return options.sendActivityResponse;
          }
          return { id: "msg-123" };
        },
      } as unknown as TurnContext;

      await cb(fakeContext);
    },
  );

  const fakeAdapter: unknown = {
    continueConversationAsync: continueConversationAsync,
  };

  const getBotAdapterSpy: jest.SpyInstance = jest
    .spyOn(MicrosoftTeamsUtil as any, "getBotAdapter")
    .mockReturnValue(fakeAdapter);

  return {
    capturedRefs: capturedRefs,
    continueConversationAsync: continueConversationAsync,
    getBotAdapterSpy: getBotAdapterSpy,
  };
}

function mockProjectAuth(data?: {
  installedTeams?: Record<string, MicrosoftTeamsInstalledTeam> | undefined;
  miscData?: MicrosoftTeamsMiscData | null | undefined;
  workspaceProjectId?: string | undefined;
}): jest.SpyInstance {
  let miscData: MicrosoftTeamsMiscData | undefined = undefined;

  if (data && "miscData" in data) {
    miscData = data.miscData === null ? undefined : data.miscData;
  } else if (data && data.installedTeams) {
    miscData = baseMiscData({ installedTeams: data.installedTeams });
  } else {
    miscData = baseMiscData();
  }

  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(
      buildProjectAuthRow({
        workspaceProjectId:
          data && "workspaceProjectId" in data
            ? data.workspaceProjectId
            : TENANT_ID,
        miscData: miscData,
      }),
    );
}

function sendCardToChannel(data?: {
  workspaceChannel?: WorkspaceChannel | undefined;
  teamId?: string | undefined;
  projectId?: ObjectID | undefined;
}): Promise<WorkspaceThread> {
  return MicrosoftTeamsUtil.sendAdaptiveCardToChannel({
    authToken: "auth-token",
    teamId: data?.teamId || TEAM_ID,
    workspaceChannel: data?.workspaceChannel || buildChannel(),
    adaptiveCard: ADAPTIVE_CARD,
    projectId: data?.projectId || ObjectID.generate(),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The botbuilder module mock's jest.fn()s are shared across tests — jest.spyOn
 * on an existing mock returns the same function, so call history and
 * mockResolvedValueOnce queues leak between tests unless reset here.
 */
beforeEach(() => {
  (MessageFactory.text as jest.Mock).mockReset();
  (MessageFactory.attachment as jest.Mock).mockReset();
  (MessageFactory.attachment as jest.Mock).mockImplementation(
    (attachment: unknown) => {
      return { type: "message", attachments: [attachment] };
    },
  );
  (CardFactory.heroCard as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
});

describe("MicrosoftTeamsUtil.isBotNotInConversationRosterError", () => {
  test("matches Microsoft's exact roster rejection on an Error object", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error(ROSTER_ERROR_TEXT),
      ),
    ).toBe(true);
  });

  test("matches the shorter 'bot is not part of the conversation' phrasing", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error("The bot is not part of the conversation."),
      ),
    ).toBe(true);
  });

  test("matches a plain string error", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        "The bot is not part of the conversation roster",
      ),
    ).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error("THE BOT IS NOT PART OF THE CONVERSATION ROSTER"),
      ),
    ).toBe(true);
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error("Not Part Of The Conversation Roster"),
      ),
    ).toBe(true);
  });

  test("matches when the fragment is buried inside a larger Bot Framework payload", () => {
    const wrapped: Error = new Error(
      'BotFrameworkAdapter.sendActivity(): 403 ERROR {"error":{"code":"BotNotInConversationRoster","message":"The bot is not part of the conversation roster."}}',
    );
    expect(MicrosoftTeamsUtil.isBotNotInConversationRosterError(wrapped)).toBe(
      true,
    );
  });

  test("returns false for an unrelated error", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error("Request timed out"),
      ),
    ).toBe(false);
  });

  test("returns false for a partially-similar message that is not the roster error", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(
        new Error("The user is not part of the team"),
      ),
    ).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(MicrosoftTeamsUtil.isBotNotInConversationRosterError(null)).toBe(
      false,
    );
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(undefined),
    ).toBe(false);
  });

  test("returns false for an empty message", () => {
    expect(MicrosoftTeamsUtil.isBotNotInConversationRosterError("")).toBe(
      false,
    );
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError(new Error("")),
    ).toBe(false);
  });

  test("returns false for an object with no usable message", () => {
    expect(
      MicrosoftTeamsUtil.isBotNotInConversationRosterError({ code: 403 }),
    ).toBe(false);
  });
});

describe("MicrosoftTeamsUtil.getBotNotInTeamMessage", () => {
  test("private channels are told to install into the channel itself", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "Ops War Room",
      membershipType: "private",
    });

    expect(message).toContain('private channel "Ops War Room"');
    expect(message).toContain("Manage channel > Apps");
    expect(message).toContain(
      "Installing OneUptime in the parent team does not cover private channels.",
    );
    expect(message).not.toContain("Manage team");
  });

  test("standard channels are told to install into the parent team", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
      membershipType: "standard",
    });

    expect(message).toContain('team that owns "General"');
    expect(message).toContain("Manage team > Apps > More apps");
    expect(message).not.toContain("Manage channel");
  });

  test("an undefined membershipType falls back to the parent-team instructions", () => {
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
    });

    expect(message).toContain("Manage team > Apps > More apps");
    expect(message).not.toContain("Manage channel");
  });

  test("only the exact string 'private' selects the private-channel instructions", () => {
    /*
     * Graph returns membershipType lowercase, so the comparison is exact —
     * pin it so nobody "helpfully" loosens it without thinking about Graph.
     */
    const message: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "General",
      membershipType: "Private",
    });

    expect(message).toContain("Manage team > Apps > More apps");
  });

  test("the two branches produce genuinely different instructions", () => {
    const privateMessage: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "Same Name",
      membershipType: "private",
    });
    const teamMessage: string = MicrosoftTeamsUtil.getBotNotInTeamMessage({
      channelName: "Same Name",
      membershipType: "standard",
    });

    expect(privateMessage).not.toBe(teamMessage);
    expect(privateMessage).toContain("Same Name");
    expect(teamMessage).toContain("Same Name");
  });
});

describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - shared channel refusal", () => {
  test("a shared channel is refused with a reason, before any Bot Framework call", async () => {
    mockProjectAuth();
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "Partner Sync",
          membershipType: "shared",
        }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        '"Partner Sync" is a shared channel, and Microsoft Teams does not allow bots to post in shared channels. Please pick a standard or private channel instead.',
      ),
    );

    expect(adapter.getBotAdapterSpy).not.toHaveBeenCalled();
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("the shared refusal is a BadDataException", async () => {
    mockProjectAuth();
    installFakeBotAdapter();

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({ membershipType: "shared" }),
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("the shared refusal wins over the install preflight so the real reason is reported", async () => {
    mockProjectAuth({
      installedTeams: {
        "some-other-team": buildInstalledTeam({ id: "some-other-team" }),
      },
    });
    installFakeBotAdapter();

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "Partner Sync",
          membershipType: "shared",
        }),
      }),
    ).rejects.toThrow(/shared channel/);
  });

  test("standard channels are NOT refused", async () => {
    mockProjectAuth();
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({
      workspaceChannel: buildChannel({ membershipType: "standard" }),
    });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("private channels are NOT refused (they only need a channel-level install)", async () => {
    mockProjectAuth();
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({
      workspaceChannel: buildChannel({ membershipType: "private" }),
    });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("an undefined membershipType is NOT refused", async () => {
    mockProjectAuth();
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({
      workspaceChannel: buildChannel({ membershipType: undefined }),
    });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("the shared comparison is exact: 'Shared' is not treated as shared", async () => {
    /*
     * Graph only ever returns lowercase "shared". This pins the current
     * behavior so a future casing change in Graph is noticed here rather than
     * in a customer's incident channel.
     */
    mockProjectAuth();
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({
      workspaceChannel: buildChannel({ membershipType: "Shared" }),
    });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });
});

describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - install preflight", () => {
  test("installedTeams undefined (legacy workspace) does NOT block the send", async () => {
    mockProjectAuth({ miscData: baseMiscData() });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    const thread: WorkspaceThread = await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
    expect(thread.threadId).toBe("msg-123");
  });

  test("an EMPTY installedTeams map does NOT block the send", async () => {
    mockProjectAuth({ installedTeams: {} });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("installedTeams containing ONLY a different team refuses before the Bot Framework call", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2", name: "Marketing" }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(
      sendCardToChannel({
        teamId: TEAM_ID,
        workspaceChannel: buildChannel({ name: "General" }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        MicrosoftTeamsUtil.getBotNotInTeamMessage({ channelName: "General" }),
      ),
    );

    expect(adapter.getBotAdapterSpy).not.toHaveBeenCalled();
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("installedTeams containing this team proceeds to the send", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("several installed teams, one of which is the target, proceeds", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-0": buildInstalledTeam({ id: "team-0" }),
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("several installed teams, none of which is the target, refuses", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-0": buildInstalledTeam({ id: "team-0" }),
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(sendCardToChannel({ teamId: TEAM_ID })).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("the team id lookup is exact — a differently-cased key does not count as installed", async () => {
    mockProjectAuth({
      installedTeams: {
        "TEAM-1": buildInstalledTeam({ id: "TEAM-1" }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(sendCardToChannel({ teamId: "team-1" })).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("the preflight refusal for a PRIVATE channel gives the channel-install instructions", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    installFakeBotAdapter();

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "Ops War Room",
          membershipType: "private",
        }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        MicrosoftTeamsUtil.getBotNotInTeamMessage({
          channelName: "Ops War Room",
          membershipType: "private",
        }),
      ),
    );
  });

  test("the preflight refusal is a BadDataException", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    installFakeBotAdapter();

    await expect(sendCardToChannel()).rejects.toBeInstanceOf(BadDataException);
  });

  test("the preflight never runs when the integration is missing entirely", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(sendCardToChannel()).rejects.toThrow(
      new BadDataException(
        "Microsoft Teams integration not found for this project",
      ),
    );
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - conversation reference", () => {
  test("happy path builds the channel conversation reference the Bot Framework expects", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();
    const channel: WorkspaceChannel = buildChannel({
      id: "19:ops@thread.tacv2",
      name: "Ops",
      membershipType: "standard",
    });

    const thread: WorkspaceThread = await sendCardToChannel({
      workspaceChannel: channel,
    });

    expect(adapter.capturedRefs).toHaveLength(1);
    const ref: ConversationReference = adapter.capturedRefs[0]!;
    expect(ref.conversation.id).toBe("19:ops@thread.tacv2");
    expect(ref.conversation.name).toBe("Ops");
    expect(ref.conversation.isGroup).toBe(true);
    expect(ref.conversation.conversationType).toBe("channel");
    expect(ref.conversation.tenantId).toBe(TENANT_ID);
    expect(ref.channelId).toBe("msteams");
    expect(ref.bot.id).toBe(MOCK_APP_CLIENT_ID);
    expect(thread).toEqual({
      channel: channel,
      threadId: "msg-123",
    });
  });

  test("the adaptive card is sent as an adaptive card attachment", async () => {
    mockProjectAuth();
    installFakeBotAdapter();

    await sendCardToChannel();

    expect(MessageFactory.attachment as jest.Mock).toHaveBeenCalledWith({
      contentType: "application/vnd.microsoft.card.adaptive",
      content: ADAPTIVE_CARD,
    });
  });

  test("serviceUrl comes from the installed team record when it was captured", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({
          id: TEAM_ID,
          serviceUrl: GCC_SERVICE_URL,
        }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: TEAM_ID });

    expect(adapter.capturedRefs[0]!.serviceUrl).toBe(GCC_SERVICE_URL);
  });

  test("serviceUrl falls back to the commercial cloud endpoint when installedTeams is undefined", async () => {
    mockProjectAuth({ miscData: baseMiscData() });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.capturedRefs[0]!.serviceUrl).toBe(DEFAULT_SERVICE_URL);
  });

  test("serviceUrl falls back when the installed team record has no serviceUrl", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID, serviceUrl: undefined }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: TEAM_ID });

    expect(adapter.capturedRefs[0]!.serviceUrl).toBe(DEFAULT_SERVICE_URL);
  });

  test("another team's serviceUrl is never borrowed for this team", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID, serviceUrl: undefined }),
        "team-2": buildInstalledTeam({
          id: "team-2",
          serviceUrl: GCC_SERVICE_URL,
        }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: TEAM_ID });

    expect(adapter.capturedRefs[0]!.serviceUrl).toBe(DEFAULT_SERVICE_URL);
  });

  test("the serviceUrl of the requested team is used even when several teams are installed", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-0": buildInstalledTeam({
          id: "team-0",
          serviceUrl: "https://smba.trafficmanager.net/apac/",
        }),
        "team-2": buildInstalledTeam({
          id: "team-2",
          serviceUrl: GCC_SERVICE_URL,
        }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: "team-2" });

    expect(adapter.capturedRefs[0]!.serviceUrl).toBe(GCC_SERVICE_URL);
  });

  test("threadId is an empty string when sendActivity returns nothing", async () => {
    mockProjectAuth();
    installFakeBotAdapter({ sendActivityResponse: undefined });

    const thread: WorkspaceThread = await sendCardToChannel();

    expect(thread.threadId).toBe("");
  });
});

describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - roster error translation", () => {
  test("Microsoft's roster rejection is replaced with the parent-team install instructions", async () => {
    mockProjectAuth();
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "General",
          membershipType: "standard",
        }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        MicrosoftTeamsUtil.getBotNotInTeamMessage({
          channelName: "General",
          membershipType: "standard",
        }),
      ),
    );
  });

  test("the raw Microsoft text never reaches the caller", async () => {
    mockProjectAuth();
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).not.toContain("conversation roster");
    expect((thrown as Error).message).toContain("Manage team > Apps");
  });

  test("a roster rejection on a private channel gets the channel-install instructions", async () => {
    mockProjectAuth();
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    await expect(
      sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "Ops War Room",
          membershipType: "private",
        }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        MicrosoftTeamsUtil.getBotNotInTeamMessage({
          channelName: "Ops War Room",
          membershipType: "private",
        }),
      ),
    );
  });

  test("a roster rejection raised inside the proactive callback is translated too", async () => {
    mockProjectAuth();
    installFakeBotAdapter({
      sendActivityError: new Error(ROSTER_ERROR_TEXT),
    });

    await expect(sendCardToChannel()).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
  });

  test("a roster rejection thrown as a plain string is translated too", async () => {
    mockProjectAuth();
    installFakeBotAdapter({
      adapterError: "The bot is not part of the conversation roster.",
    });

    await expect(sendCardToChannel()).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
  });

  test("unrelated adapter errors propagate untouched", async () => {
    mockProjectAuth();
    const networkError: Error = new Error("socket hang up");
    installFakeBotAdapter({ adapterError: networkError });

    await expect(sendCardToChannel()).rejects.toBe(networkError);
  });

  test("a 429 throttling error is not disguised as an install problem", async () => {
    mockProjectAuth();
    const throttled: Error = new Error("429 Too Many Requests");
    installFakeBotAdapter({ adapterError: throttled });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBe(throttled);
    expect((thrown as Error).message).not.toContain("Manage team");
  });
});

describe("MicrosoftTeamsUtil.sendMessage - unresolvable channel destinations are reported", () => {
  function buildChannelPayload(data?: {
    channelNames?: Array<string> | undefined;
    channelIds?: Array<string> | undefined;
    teamId?: string | undefined;
  }): WorkspaceMessagePayload {
    const block: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: "Incident created",
    };
    return {
      _type: "WorkspaceMessagePayload",
      channelNames: data?.channelNames || [],
      channelIds: data?.channelIds || [],
      messageBlocks: [block],
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: data?.teamId || TEAM_ID,
    };
  }

  function callSendMessage(
    payload: WorkspaceMessagePayload,
  ): Promise<WorkspaceSendMessageResponse> {
    return MicrosoftTeamsUtil.sendMessage({
      workspaceMessagePayload: payload,
      authToken: "auth-token",
      userId: "user-1",
      projectId: ObjectID.generate(),
    });
  }

  function mockSendCardToChannel(): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockImplementation(
        async (args: {
          workspaceChannel: WorkspaceChannel;
        }): Promise<WorkspaceThread> => {
          return {
            channel: args.workspaceChannel,
            threadId: `thread-${args.workspaceChannel.id}`,
          };
        },
      );
  }

  test("a channelName that does not resolve is reported as an error, not a silent success", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelByName")
      .mockResolvedValue(null);
    const sendSpy: jest.SpyInstance = mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelNames: ["deleted-channel"] }),
    );

    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: {
          id: "",
          name: "deleted-channel",
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAM_ID,
        },
        error:
          'Channel "deleted-channel" was not found in this Microsoft Teams team. It may have been renamed or deleted.',
      },
    ]);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(response.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
  });

  test("a channelName that resolves still sends and records no error", async () => {
    const channel: WorkspaceChannel = buildChannel({ name: "general" });
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelByName")
      .mockResolvedValue(channel);
    const sendSpy: jest.SpyInstance = mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelNames: ["general"] }),
    );

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(response.errors).toEqual([]);
    expect(response.threads).toHaveLength(1);
    expect(response.threads[0]?.channel.id).toBe(CHANNEL_ID);
  });

  test("a missing channel name does not stop the resolvable ones from sending", async () => {
    const channel: WorkspaceChannel = buildChannel({ name: "general" });
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelByName")
      .mockImplementation(
        async (args: {
          channelName: string;
        }): Promise<WorkspaceChannel | null> => {
          return args.channelName === "general" ? channel : null;
        },
      );
    mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelNames: ["typoed", "general"] }),
    );

    expect(response.threads).toHaveLength(1);
    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0]?.channel.name).toBe("typoed");
  });

  test("every missing channel name gets its own error entry", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelByName")
      .mockResolvedValue(null);
    mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelNames: ["gone-1", "gone-2"] }),
    );

    expect(response.threads).toEqual([]);
    expect(response.errors).toHaveLength(2);
    expect(response.errors?.[0]?.channel.name).toBe("gone-1");
    expect(response.errors?.[1]?.channel.name).toBe("gone-2");
  });

  test("a channelId whose lookup throws is reported as an error instead of being swallowed", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue(new Error("Channel not found in team") as never);
    const sendSpy: jest.SpyInstance = mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelIds: ["19:missing@thread.tacv2"] }),
    );

    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([
      {
        channel: {
          id: "19:missing@thread.tacv2",
          name: "19:missing@thread.tacv2",
          workspaceType: WorkspaceType.MicrosoftTeams,
          teamId: TEAM_ID,
        },
        error: "Channel not found in team",
      },
    ]);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("a non-Error thrown by the channelId lookup is stringified into the error entry", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockRejectedValue("graph exploded" as never);
    mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelIds: ["19:missing@thread.tacv2"] }),
    );

    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0]?.error).toBe("graph exploded");
  });

  test("one failing channelId does not stop the other channelIds from sending", async () => {
    const goodChannel: WorkspaceChannel = buildChannel({
      id: "19:good@thread.tacv2",
      name: "Good",
    });
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockImplementation(
        async (args: { channelId: string }): Promise<WorkspaceChannel> => {
          if (args.channelId === "19:bad@thread.tacv2") {
            throw new Error("lookup failed");
          }
          return goodChannel;
        },
      );
    mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({
        channelIds: ["19:bad@thread.tacv2", "19:good@thread.tacv2"],
      }),
    );

    expect(response.threads).toHaveLength(1);
    expect(response.threads[0]?.channel.id).toBe("19:good@thread.tacv2");
    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0]?.channel.id).toBe("19:bad@thread.tacv2");
  });

  test("no destinations at all produces an empty, error-free response", async () => {
    const sendSpy: jest.SpyInstance = mockSendCardToChannel();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload(),
    );

    expect(sendSpy).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
    expect(response.errors).toEqual([]);
  });

  test("the actionable install message from a failed send surfaces in response.errors", async () => {
    const channel: WorkspaceChannel = buildChannel({
      name: "General",
      membershipType: "standard",
    });
    jest
      .spyOn(MicrosoftTeamsUtil, "getWorkspaceChannelFromChannelId")
      .mockResolvedValue(channel);
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    const response: WorkspaceSendMessageResponse = await callSendMessage(
      buildChannelPayload({ channelIds: [CHANNEL_ID] }),
    );

    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
    expect(response.threads).toEqual([]);
    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0]?.channel).toEqual(channel);
    expect(response.errors?.[0]?.error).toBe(
      MicrosoftTeamsUtil.getBotNotInTeamMessage({
        channelName: "General",
        membershipType: "standard",
      }),
    );
  });
});
