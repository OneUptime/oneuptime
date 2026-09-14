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

import MicrosoftTeamsUtil, {
  MicrosoftTeamsAppInstallState,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
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

/*
 * A captured install, as captureTeamFromBotActivity writes it: keyed by the
 * GRAPH team id, with the Bot Framework thread id kept alongside. `id` is the
 * Graph id here because that is the only form the send path can match — see
 * MicrosoftTeamsInstalledTeamIdSpace.test.ts, which derives these fixtures from
 * the real capture path instead of hand-writing them.
 */
function buildInstalledTeam(data: {
  id: string;
  name?: string | undefined;
  serviceUrl?: string | undefined;
  graphTeamId?: string | undefined;
  teamsThreadId?: string | undefined;
}): MicrosoftTeamsInstalledTeam {
  const installedTeam: MicrosoftTeamsInstalledTeam = {
    id: data.id,
    graphTeamId: "graphTeamId" in data ? data.graphTeamId : data.id,
    teamsThreadId: data.teamsThreadId || `19:${data.id}@thread.tacv2`,
    name: data.name || "Engineering",
    addedAt: "2026-07-27T00:00:00.000Z",
  };
  if ("serviceUrl" in data) {
    installedTeam.serviceUrl = data.serviceUrl;
  }
  return installedTeam;
}

/*
 * Pin the Graph installed-apps check. The send path consults it whenever it has
 * no local install record, so leaving it live would put every such test on the
 * network. Unknown is the honest default for a tenant that has not granted the
 * permission, and it is also the pre-existing behaviour (fall through to
 * Microsoft), which keeps these suites about one thing at a time.
 */
let installStateSpy: jest.SpyInstance | undefined = undefined;

function mockInstallState(
  state: MicrosoftTeamsAppInstallState = MicrosoftTeamsAppInstallState.Unknown,
): jest.SpyInstance {
  installStateSpy = jest
    .spyOn(MicrosoftTeamsUtil, "isAppInstalledInTeam")
    .mockResolvedValue(state);
  return installStateSpy;
}

/*
 * The suite that tests isAppInstalledInTeam itself has to undo the file-wide
 * stub, or it would only ever assert against the stub.
 */
function useRealInstallStateCheck(): void {
  installStateSpy?.mockRestore();
  installStateSpy = undefined;
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
  mockInstallState();
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

/*
 * The preflight decides whether to refuse locally or hand the send to Microsoft.
 *
 * It used to refuse purely on the absence of a local install record, which is
 * not evidence: installedTeams is only written from bot activities, so a team
 * the app was added to while OneUptime was unreachable — or before install
 * capture shipped — looks identical to a team it was never added to. Admins who
 * had followed every documented step were told to follow them again.
 *
 * A refusal now requires a POSITIVE answer from Graph that the app is absent.
 * Installed and Unknown both proceed and let Microsoft, the only real authority
 * on roster membership, decide.
 */
describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - install preflight", () => {
  test("a captured install for the target team proceeds without asking Graph", async () => {
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
      },
    });
    const installSpy: jest.SpyInstance = mockInstallState(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
    // The local record is the fast path; no Graph round trip per notification.
    expect(installSpy).not.toHaveBeenCalled();
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

  test("no local record + Graph says NOT installed refuses before the Bot Framework call", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2", name: "Marketing" }),
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
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

  test("the verified refusal is checked against the team the caller asked for", async () => {
    mockProjectAuth({ installedTeams: {} });
    const installSpy: jest.SpyInstance = mockInstallState(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
    installFakeBotAdapter();

    await expect(sendCardToChannel({ teamId: "team-99" })).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );

    expect(installSpy).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-99" }),
    );
  });

  test("no local record + Graph says installed proceeds to the send", async () => {
    mockProjectAuth({ installedTeams: {} });
    mockInstallState(MicrosoftTeamsAppInstallState.Installed);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("no local record + Graph cannot tell us proceeds rather than accusing", async () => {
    mockProjectAuth({
      installedTeams: {
        "team-2": buildInstalledTeam({ id: "team-2" }),
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.Unknown);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: TEAM_ID });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("installedTeams undefined (legacy workspace) with an unknown install state does NOT block the send", async () => {
    mockProjectAuth({ miscData: baseMiscData() });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("an EMPTY installedTeams map with an unknown install state does NOT block the send", async () => {
    mockProjectAuth({ installedTeams: {} });
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("a record written before graph ids were captured cannot vouch for a team, so Graph decides", async () => {
    /*
     * The legacy on-disk shape: keyed by the Bot Framework thread id, with no
     * graphTeamId. It must not be mistaken for an install of the Graph team id
     * that happens to be the rule's value, and it must not be treated as proof
     * of anything either — Graph is asked, and here it says no.
     */
    mockProjectAuth({
      installedTeams: {
        "19:team-aaa@thread.tacv2": {
          id: "19:team-aaa@thread.tacv2",
          name: "Engineering",
          addedAt: "2026-07-27T00:00:00.000Z",
        } as MicrosoftTeamsInstalledTeam,
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(sendCardToChannel({ teamId: TEAM_ID })).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("a legacy record does not block a send Graph is willing to allow", async () => {
    mockProjectAuth({
      installedTeams: {
        "19:team-aaa@thread.tacv2": {
          id: "19:team-aaa@thread.tacv2",
        } as MicrosoftTeamsInstalledTeam,
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.Installed);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await sendCardToChannel({ teamId: TEAM_ID });

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("the graph team id match is exact — a differently-cased record is not this team", async () => {
    mockProjectAuth({
      installedTeams: {
        "TEAM-1": buildInstalledTeam({ id: "TEAM-1" }),
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
    const adapter: FakeBotAdapter = installFakeBotAdapter();

    await expect(sendCardToChannel({ teamId: "team-1" })).rejects.toThrow(
      /is not installed in the Microsoft Teams team/,
    );
    expect(adapter.continueConversationAsync).not.toHaveBeenCalled();
  });

  test("the verified refusal for a PRIVATE channel gives the channel-install instructions", async () => {
    mockProjectAuth({ installedTeams: {} });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
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

  test("the verified refusal is a BadDataException", async () => {
    mockProjectAuth({ installedTeams: {} });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
    installFakeBotAdapter();

    await expect(sendCardToChannel()).rejects.toBeInstanceOf(BadDataException);
  });

  test("the preflight never runs when the integration is missing entirely", async () => {
    mockProjectAuth({ miscData: null });
    const installSpy: jest.SpyInstance = mockInstallState(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
    installFakeBotAdapter();

    await expect(sendCardToChannel()).rejects.toThrow(
      /Microsoft Teams integration not found/,
    );
    expect(installSpy).not.toHaveBeenCalled();
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

/*
 * How Microsoft's roster rejection is worded back to the admin.
 *
 * The rewrite used to assert "the app is not installed in the team" for every
 * roster rejection. That is one cause among several, and for the customer who
 * reported this it was the wrong one — the app was in the team's app list and
 * the bot answered @mentions in the very channel that failed. The rewrite is
 * now conditioned on what the preflight actually established: only a verified
 * absence gets the install instructions, and anything else gets the causes that
 * apply to an app which IS present, with Microsoft's own words attached.
 */
describe("MicrosoftTeamsUtil.sendAdaptiveCardToChannel - roster error translation", () => {
  test("a VERIFIED absent install still gets the parent-team install instructions", async () => {
    /*
     * Graph is asked before the send here and says the app is absent, but the
     * refusal happens up front, so this asserts the message an admin who really
     * has not added the app sees.
     */
    mockProjectAuth({ installedTeams: {} });
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
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

  test("an UNVERIFIED roster rejection does not claim the app is missing", async () => {
    mockProjectAuth();
    mockInstallState(MicrosoftTeamsAppInstallState.Unknown);
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel({
        workspaceChannel: buildChannel({ name: "General" }),
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).not.toContain(
      "The OneUptime app is not installed in the Microsoft Teams team",
    );
    expect((thrown as Error).message).toContain("Likely causes");
  });

  test("an unverified rejection names the channel and quotes Microsoft", async () => {
    mockProjectAuth();
    mockInstallState(MicrosoftTeamsAppInstallState.Unknown);
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel({
        workspaceChannel: buildChannel({ name: "test public channel" }),
      });
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toContain('"test public channel"');
    // The raw error is the one thing support needs and the rewrite used to eat.
    expect((thrown as Error).message).toContain(ROSTER_ERROR_TEXT);
  });

  test("when the app IS known installed, the rejection points at the bot id instead", async () => {
    /*
     * The reporter's exact situation: a real install, and a roster rejection
     * anyway. The actionable cause is that the installed package's bot is not
     * the one this deployment authenticates as.
     */
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
      },
    });
    mockInstallState(MicrosoftTeamsAppInstallState.Installed);
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel({ teamId: TEAM_ID });
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toContain(
      "MICROSOFT_TEAMS_APP_CLIENT_ID",
    );
    expect((thrown as Error).message).not.toContain(
      "The OneUptime app is not installed in the Microsoft Teams team",
    );
  });

  test("a Graph permission refusal reaches the admin as a named grant, end to end", async () => {
    /*
     * The payoff of the whole PermissionDenied split, exercised through the real
     * send path rather than against the message builder in isolation: Graph
     * refuses the installed-apps read, the send is still attempted (a refusal is
     * not a missing install), Microsoft rejects it on the roster, and the
     * exception an admin actually reads names the one permission that would turn
     * the guess into an answer.
     *
     * Unit-testing the pieces separately leaves this green even if PermissionDenied
     * were wired to short-circuit at the preflight, which would break both halves.
     */
    mockProjectAuth({});
    mockInstallState(MicrosoftTeamsAppInstallState.PermissionDenied);
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel({ teamId: TEAM_ID });
    } catch (err) {
      thrown = err;
    }

    const message: string = (thrown as Error).message;

    // The send was attempted: a refusal to answer is not a missing install.
    expect(message).not.toContain(
      "The OneUptime app is not installed in the Microsoft Teams team",
    );
    // And the admin is told what to grant.
    expect(message).toContain("TeamsAppInstallation.ReadForTeam.All");
    expect(message).toContain("admin consent");
    // Microsoft's raw wording survives the rewrite.
    expect(message).toContain(ROSTER_ERROR_TEXT);
  });

  test("a STALE local install record is re-checked, and a confirmed removal gets the install instructions", async () => {
    /*
     * The local record let this send skip the preflight, but the app has since
     * been removed from the team and no uninstall event reached us. Wording the
     * error off the stale record would blame the bot id for a genuinely missing
     * install, so Graph is asked again on the failure path.
     */
    mockProjectAuth({
      installedTeams: {
        [TEAM_ID]: buildInstalledTeam({ id: TEAM_ID }),
      },
    });
    const installSpy: jest.SpyInstance = mockInstallState(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

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

    // Not consulted on the happy path; consulted once the send actually failed.
    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  test("the Graph check is not repeated when the preflight already made it", async () => {
    mockProjectAuth({ installedTeams: {} });
    const installSpy: jest.SpyInstance = mockInstallState(
      MicrosoftTeamsAppInstallState.Unknown,
    );
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    await expect(sendCardToChannel()).rejects.toThrow(/Likely causes/);

    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  test("an unverified rejection on a private channel still leads with the channel install", async () => {
    mockProjectAuth();
    mockInstallState(MicrosoftTeamsAppInstallState.Unknown);
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel({
        workspaceChannel: buildChannel({
          name: "Ops War Room",
          membershipType: "private",
        }),
      });
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toContain("Manage channel > Apps");
  });

  test("every roster rejection mentions the Azure Bot Teams channel", async () => {
    /*
     * A bot whose Azure resource has no Microsoft Teams channel enabled is
     * rejected exactly like an uninstalled app, and nothing in OneUptime can
     * detect it — so it has to be in the message.
     */
    mockProjectAuth();
    installFakeBotAdapter({ adapterError: new Error(ROSTER_ERROR_TEXT) });

    let thrown: unknown = undefined;
    try {
      await sendCardToChannel();
    } catch (err) {
      thrown = err;
    }

    expect((thrown as Error).message).toContain("Microsoft Teams channel");
  });

  test("a roster rejection raised inside the proactive callback is translated too", async () => {
    mockProjectAuth();
    installFakeBotAdapter({
      sendActivityError: new Error(ROSTER_ERROR_TEXT),
    });

    await expect(sendCardToChannel()).rejects.toThrow(/Likely causes/);
  });

  test("a roster rejection thrown as a plain string is translated too", async () => {
    mockProjectAuth();
    installFakeBotAdapter({
      adapterError: "The bot is not part of the conversation roster.",
    });

    await expect(sendCardToChannel()).rejects.toThrow(/Likely causes/);
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
    mockInstallState(MicrosoftTeamsAppInstallState.NotInstalled);
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

describe("MicrosoftTeamsUtil.getRosterRejectionMessage", () => {
  test("names the channel that was refused", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "test public channel",
      installState: MicrosoftTeamsAppInstallState.Unknown,
    });

    expect(message).toContain('"test public channel"');
  });

  test("never tells an admin the app is not installed", () => {
    /*
     * The whole point of this message: it is used when we do NOT know, and the
     * old wording turned "we do not know" into a false statement of fact.
     */
    for (const installState of [
      MicrosoftTeamsAppInstallState.Unknown,
      MicrosoftTeamsAppInstallState.Installed,
    ]) {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).not.toContain(
        "The OneUptime app is not installed in the Microsoft Teams team",
      );
    }
  });

  test("a known install stops blaming the package and points at the Azure Bot", () => {
    /*
     * Graph confirmed a package carrying this deployment's app id is installed,
     * so the package is no longer the lead suspect. It used to be named anyway,
     * which read to admins as though the error had not registered what they had
     * already done. The identifier stays in the text — it is what they compare
     * against — but the instruction now points somewhere new.
     */
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Installed,
    });

    expect(message).toContain("MICROSOFT_TEAMS_APP_CLIENT_ID");
    expect(message).toContain("probably not the problem");
    expect(message).toContain("Azure Bot resource");
    expect(message).not.toContain(
      "check that the Teams app package was built from this deployment",
    );
  });

  test("an unknown install state still suggests adding the app", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
    });

    expect(message).toContain("Manage team > Apps");
  });

  test("a private channel leads with the channel-level install", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "Ops War Room",
      membershipType: "private",
      installState: MicrosoftTeamsAppInstallState.Unknown,
    });

    expect(message).toContain("Manage channel > Apps");
    expect(message).not.toContain("Manage team > Apps");
  });

  test("Microsoft's own wording is quoted when we have it", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: new Error(ROSTER_ERROR_TEXT),
    });

    expect(message).toContain(ROSTER_ERROR_TEXT);
  });

  test("a non-Error microsoftError is stringified rather than dropped", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
      microsoftError: "BotNotInConversationRoster",
    });

    expect(message).toContain("BotNotInConversationRoster");
  });

  test("no trailing quote section when there is no Microsoft error to quote", () => {
    const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
      channelName: "General",
      installState: MicrosoftTeamsAppInstallState.Unknown,
    });

    expect(message).not.toContain("Microsoft's response was");
    expect(message.endsWith(".")).toBe(true);
  });

  test("the Azure Bot Teams channel is always listed as a cause", () => {
    for (const installState of [
      MicrosoftTeamsAppInstallState.Unknown,
      MicrosoftTeamsAppInstallState.Installed,
      MicrosoftTeamsAppInstallState.NotInstalled,
    ]) {
      const message: string = MicrosoftTeamsUtil.getRosterRejectionMessage({
        channelName: "General",
        installState: installState,
      });

      expect(message).toContain(
        "does not have the Microsoft Teams channel enabled",
      );
    }
  });
});

/*
 * The Graph installed-apps check.
 *
 * Its contract is asymmetric on purpose: it may only answer NotInstalled when
 * Graph actually enumerated the team's apps and this deployment's app was not
 * among them. Any other outcome — a permission the tenant never granted, a
 * transport failure, an unconfigured client id — is Unknown, because reporting
 * those as NotInstalled is what sent the reporter of this bug in circles.
 */
describe("MicrosoftTeamsUtil.isAppInstalledInTeam", () => {
  function mockGraph(pages: Array<JSONObject | HTTPErrorResponse>): jest.Mock {
    const get: jest.Mock = jest.fn();

    for (const page of pages) {
      if (page instanceof HTTPErrorResponse) {
        get.mockResolvedValueOnce(page);
        continue;
      }
      get.mockResolvedValueOnce({ data: page } as HTTPResponse<JSONObject>);
    }

    jest.spyOn(API, "get").mockImplementation(get as any);
    return get;
  }

  function callIsAppInstalled(
    teamId: string = TEAM_ID,
  ): Promise<MicrosoftTeamsAppInstallState> {
    return MicrosoftTeamsUtil.isAppInstalledInTeam({
      authToken: "auth-token",
      projectId: ObjectID.generate(),
      teamId: teamId,
    });
  }

  beforeEach(() => {
    useRealInstallStateCheck();
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-access-token");
  });

  test("an installed app matching this deployment's client id is Installed", async () => {
    mockGraph([
      {
        value: [
          { id: "install-1", teamsApp: { externalId: MOCK_APP_CLIENT_ID } },
        ],
      },
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Installed,
    );
  });

  test("matching is on externalId, so another vendor's OneUptime app is not ours", async () => {
    /*
     * This is the case the reporter's screenshots could not rule out: a tile
     * called "OneUptime · HackerBay Inc" in the team's app list which is the
     * public store package, whose bot is not this deployment's bot.
     */
    mockGraph([
      {
        value: [
          {
            id: "install-1",
            teamsApp: {
              externalId: "99999999-9999-9999-9999-999999999999",
              displayName: "OneUptime",
            },
          },
        ],
      },
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
  });

  test("an empty app list is NotInstalled", async () => {
    mockGraph([{ value: [] }]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
  });

  test("a response with no value array at all is NotInstalled", async () => {
    mockGraph([{}]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
  });

  test("the app is found on a later page", async () => {
    const get: jest.Mock = mockGraph([
      {
        value: [{ id: "install-1", teamsApp: { externalId: "other-app" } }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/page-2",
      },
      {
        value: [
          { id: "install-2", teamsApp: { externalId: MOCK_APP_CLIENT_ID } },
        ],
      },
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Installed,
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("NotInstalled is only returned after every page was read", async () => {
    const get: jest.Mock = mockGraph([
      {
        value: [{ id: "install-1", teamsApp: { externalId: "other-app" } }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/page-2",
      },
      { value: [{ id: "install-2", teamsApp: { externalId: "another-app" } }] },
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.NotInstalled,
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("a 403 is PermissionDenied, never NotInstalled", async () => {
    /*
     * The realistic case: a workspace connected before
     * TeamsAppInstallation.ReadForTeam.All was documented gets a 403 here. It
     * must not be told its app is missing — and it is worth separating from a
     * plain Unknown, because a refusal names the grant that would fix it.
     */
    mockGraph([new HTTPErrorResponse(403, { error: "Forbidden" }, {})]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.PermissionDenied,
    );
  });

  test("a non-permission Graph error is still Unknown, never NotInstalled", async () => {
    /*
     * A 500 is Microsoft failing, not refusing. Reporting it as PermissionDenied
     * would tell the admin to grant a permission they already have.
     */
    mockGraph([
      new HTTPErrorResponse(500, { error: "Internal Server Error" }, {}),
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Unknown,
    );
  });

  test("a 401 is Unknown, not PermissionDenied — a stale token is not a missing grant", async () => {
    /*
     * Graph answers a missing application permission with 403 and reserves 401
     * for a token it will not accept. getValidAccessToken can hand over a cached
     * app token without revalidating it when no expiry was stored, so a 401 here
     * is a live possibility — and telling that admin to grant a Graph permission
     * would be a confidently wrong answer.
     */
    mockGraph([
      new HTTPErrorResponse(
        401,
        { error: { code: "InvalidAuthenticationToken" } },
        {},
      ),
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Unknown,
    );
  });

  test("an authorization error code is PermissionDenied whatever status carries it", async () => {
    mockGraph([
      new HTTPErrorResponse(
        400,
        { error: { code: "Authorization_RequestDenied" } },
        {},
      ),
    ]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.PermissionDenied,
    );
  });

  test("a thrown transport error is Unknown", async () => {
    jest.spyOn(API, "get").mockRejectedValue(new Error("socket hang up"));

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Unknown,
    );
  });

  test("a token failure is Unknown", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockRejectedValue(new Error("no token"));
    const get: jest.Mock = mockGraph([{ value: [] }]);

    await expect(callIsAppInstalled()).resolves.toBe(
      MicrosoftTeamsAppInstallState.Unknown,
    );
    expect(get).not.toHaveBeenCalled();
  });

  test("the team id is scoped into the Graph URL and the app list is expanded", async () => {
    const get: jest.Mock = mockGraph([{ value: [] }]);

    await callIsAppInstalled("team-abc");

    const requestedUrl: string = get.mock.calls[0]![0].url.toString();
    expect(requestedUrl).toContain("/teams/team-abc/installedApps");
    // Without $expand there is no teamsApp to match externalId against.
    expect(requestedUrl).toContain("$expand=teamsApp");
  });

  test("the access token is sent as a bearer token", async () => {
    const get: jest.Mock = mockGraph([{ value: [] }]);

    await callIsAppInstalled();

    expect(get.mock.calls[0]![0].headers.Authorization).toBe(
      "Bearer app-access-token",
    );
  });
});
