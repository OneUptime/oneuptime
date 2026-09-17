import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The seam between "we saw the app get installed" and "we are allowed to post".
 *
 * A Microsoft Teams team has TWO ids and they are not interchangeable:
 *
 *   channelData.team.id        "19:...@thread.tacv2"   what bot activities carry
 *   channelData.team.aadGroupId  a GUID                what Graph calls the team id
 *
 * Installs were captured under the thread id and looked up under the Graph id,
 * so the lookup could never hit. Nothing caught it, because the write side and
 * the read side were tested in separate files that each picked their own
 * placeholder id and then wrote AND read with it — internally consistent, and
 * blind to the fact that production feeds one side's output into the other.
 *
 * So these tests never name an id twice. Every one of them drives the real
 * capture path with a realistic activity, keeps whatever it chose to store, and
 * feeds that straight into the send path using only the id a notification rule
 * would actually hold — the Graph team id from the team picker. If the two sides
 * ever disagree about id space again, these fail.
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
      getTeamDetails: jest.fn(),
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
import { JSONObject } from "../../../../Types/JSON";
import { WorkspaceChannel } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import { TeamsInfo, type ConversationReference } from "botbuilder";

/*
 * Realistic ids. The two forms are deliberately unrelated strings so that a
 * mix-up cannot accidentally pass — this is exactly what the previous fixtures,
 * where both sides used the same placeholder, could not detect.
 */
const TENANT_ID: string = "aaaaaaaa-1111-2222-3333-444444444444";
const GRAPH_TEAM_ID: string = "bbbbbbbb-5555-6666-7777-888888888888";
const TEAM_THREAD_ID: string = "19:qWeRtY_teamThread@thread.tacv2";
const CHANNEL_ID: string = "19:aSdFgH_channelThread@thread.tacv2";
const ACTIVITY_SERVICE_URL: string = "https://smba.trafficmanager.net/in/";
const FALLBACK_SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";

const ADAPTIVE_CARD: JSONObject = { type: "AdaptiveCard", body: [] };

interface CapturedSend {
  refs: Array<ConversationReference>;
  continueConversationAsync: jest.Mock;
}

/*
 * A channel-scoped bot activity as Microsoft actually sends it — both team ids
 * present, tenant on channelData, regional serviceUrl.
 */
function teamChannelActivity(overrides?: {
  team?: JSONObject | undefined;
  serviceUrl?: string | undefined;
}): JSONObject {
  return {
    type: "conversationUpdate",
    serviceUrl:
      "serviceUrl" in (overrides || {})
        ? overrides!.serviceUrl
        : ACTIVITY_SERVICE_URL,
    conversation: { conversationType: "channel", id: CHANNEL_ID },
    channelData: {
      team:
        overrides && "team" in overrides
          ? overrides.team
          : {
              id: TEAM_THREAD_ID,
              name: "WBNOC",
              aadGroupId: GRAPH_TEAM_ID,
            },
      tenant: { id: TENANT_ID },
      channel: { id: CHANNEL_ID },
    },
  };
}

function buildTurnContext(serviceUrl?: string): any {
  return {
    activity: {
      serviceUrl: serviceUrl === undefined ? ACTIVITY_SERVICE_URL : serviceUrl,
    },
  };
}

/*
 * Runs the real capture path and returns exactly what it decided to persist. No
 * assumption is made here about the key or the field layout — that is the thing
 * under test.
 */
async function captureInstall(
  activity: JSONObject,
): Promise<Record<string, MicrosoftTeamsInstalledTeam>> {
  let stored: Record<string, MicrosoftTeamsInstalledTeam> = {};

  jest
    .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
    .mockImplementation(
      async (data: {
        tenantId: string;
        team: MicrosoftTeamsInstalledTeam;
      }): Promise<void> => {
        stored = { [data.team.id]: data.team };
      },
    );

  await MicrosoftTeamsUtil.captureTeamFromBotActivity({
    activity: activity,
    turnContext: buildTurnContext(),
  });

  return stored;
}

function mockProjectAuthWith(
  installedTeams: Record<string, MicrosoftTeamsInstalledTeam>,
): void {
  const miscData: MicrosoftTeamsMiscData = {
    tenantId: TENANT_ID,
    teamId: GRAPH_TEAM_ID,
    teamName: "WBNOC",
    botId: "11111111-2222-3333-4444-555555555555",
    installedTeams: installedTeams,
  } as MicrosoftTeamsMiscData;

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      id: ObjectID.generate(),
      workspaceProjectId: TENANT_ID,
      miscData: miscData,
    } as unknown as WorkspaceProjectAuthToken);
}

function installFakeBotAdapter(): CapturedSend {
  const refs: Array<ConversationReference> = [];
  const continueConversationAsync: jest.Mock = jest.fn(
    async (
      _appId: string,
      ref: ConversationReference,
      cb: (context: any) => Promise<void>,
    ): Promise<void> => {
      refs.push(ref);
      await cb({
        sendActivity: async (): Promise<JSONObject> => {
          return { id: "msg-1" };
        },
      });
    },
  );

  jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
    continueConversationAsync: continueConversationAsync,
  });

  return { refs: refs, continueConversationAsync: continueConversationAsync };
}

function channel(): WorkspaceChannel {
  return {
    id: CHANNEL_ID,
    name: "WBNOC Test Channel",
    workspaceType: WorkspaceType.MicrosoftTeams,
    teamId: GRAPH_TEAM_ID,
  };
}

/*
 * The send as a notification rule triggers it: teamId is the value the team
 * picker stored, which comes from Graph GET /teams — never a thread id.
 */
function sendAsNotificationRuleWould(): Promise<unknown> {
  return MicrosoftTeamsUtil.sendAdaptiveCardToChannel({
    authToken: "auth-token",
    teamId: GRAPH_TEAM_ID,
    workspaceChannel: channel(),
    adaptiveCard: ADAPTIVE_CARD,
    projectId: ObjectID.generate(),
  });
}

beforeEach(() => {
  (TeamsInfo.getTeamDetails as jest.Mock).mockReset();
  /*
   * Force the Graph fallback to fail so nothing in this file can pass by way of
   * the install check. A send that succeeds here succeeded because the captured
   * record matched, which is the only thing being asserted.
   */
  jest
    .spyOn(MicrosoftTeamsUtil, "isAppInstalledInTeam")
    .mockResolvedValue(MicrosoftTeamsAppInstallState.NotInstalled);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Microsoft Teams install capture and channel send agree on the team id space", () => {
  test("an install captured from a bot activity permits the send a notification rule performs", async () => {
    /*
     * THE regression test for this bug. The app is installed; Teams tells us so;
     * the rule then posts using the Graph team id. Before the fix the captured
     * record was keyed by the thread id, the lookup missed, and the admin was
     * told to install an app that was already installed.
     */
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    mockProjectAuthWith(installedTeams);
    const adapter: CapturedSend = installFakeBotAdapter();

    await sendAsNotificationRuleWould();

    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("the captured record is reachable by the Graph team id, which is what every caller holds", async () => {
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    const index: Record<string, MicrosoftTeamsInstalledTeam> =
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId(installedTeams);

    expect(Object.keys(index)).toEqual([GRAPH_TEAM_ID]);
  });

  test("the captured record keeps the thread id too, so uninstall can still find it", async () => {
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    const record: MicrosoftTeamsInstalledTeam =
      Object.values(installedTeams)[0]!;

    expect(record.teamsThreadId).toBe(TEAM_THREAD_ID);
    expect(record.graphTeamId).toBe(GRAPH_TEAM_ID);
  });

  test("a captured install is never keyed by the thread id when the Graph id is known", async () => {
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    expect(Object.keys(installedTeams)).not.toContain(TEAM_THREAD_ID);
  });

  test("the serviceUrl captured on install reaches the send, instead of the global fallback", async () => {
    /*
     * This never worked either: the serviceUrl was captured but read through the
     * same broken lookup, so `installedTeam?.serviceUrl` was always undefined
     * and every proactive post went to the commercial-cloud endpoint. That is
     * the wrong host for a GCC/DoD tenant, and for a regional one it is the
     * hardcoded guess Microsoft's docs tell you not to make.
     */
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    mockProjectAuthWith(installedTeams);
    const adapter: CapturedSend = installFakeBotAdapter();

    await sendAsNotificationRuleWould();

    expect(adapter.refs[0]!.serviceUrl).toBe(ACTIVITY_SERVICE_URL);
    expect(adapter.refs[0]!.serviceUrl).not.toBe(FALLBACK_SERVICE_URL);
  });

  test("an activity without aadGroupId falls back to TeamsInfo, and the send still works", async () => {
    (TeamsInfo.getTeamDetails as jest.Mock).mockResolvedValue({
      id: TEAM_THREAD_ID,
      name: "WBNOC",
      aadGroupId: GRAPH_TEAM_ID,
    });

    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(
        teamChannelActivity({
          team: { id: TEAM_THREAD_ID, name: "WBNOC" },
        }),
      );

    mockProjectAuthWith(installedTeams);
    const adapter: CapturedSend = installFakeBotAdapter();

    await sendAsNotificationRuleWould();

    expect(TeamsInfo.getTeamDetails as jest.Mock).toHaveBeenCalledTimes(1);
    expect(adapter.continueConversationAsync).toHaveBeenCalledTimes(1);
  });

  test("an unresolvable Graph id keeps the install on record but does not vouch for the team", async () => {
    /*
     * getTeamDetails is what fails on an uninstall, and can fail on a transient
     * error. The record is still worth keeping — it is how uninstall finds the
     * team — but it must not be silently treated as an install of some Graph
     * team id, which is the class of confusion this whole change removes.
     */
    (TeamsInfo.getTeamDetails as jest.Mock).mockRejectedValue(
      new Error("The bot is not part of the conversation roster."),
    );

    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(
        teamChannelActivity({
          team: { id: TEAM_THREAD_ID, name: "WBNOC" },
        }),
      );

    expect(Object.keys(installedTeams)).toEqual([TEAM_THREAD_ID]);
    expect(
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId(installedTeams),
    ).toEqual({});
  });

  test("re-capturing a team that was stored under its thread id leaves exactly one record", async () => {
    /*
     * The upgrade path. A workspace that ran the old code has thread-id-keyed
     * records; the @mention backfill re-captures them, now with a Graph id. Two
     * records for one team would mean one that can never be matched or removed.
     */
    const legacyRecord: MicrosoftTeamsInstalledTeam = {
      id: TEAM_THREAD_ID,
      name: "WBNOC",
      serviceUrl: ACTIVITY_SERVICE_URL,
      addedAt: "2026-08-01T00:00:00.000Z",
    };

    let stored: Record<string, MicrosoftTeamsInstalledTeam> = {
      [TEAM_THREAD_ID]: legacyRecord,
    };

    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        miscData: { installedTeams: stored } as MicrosoftTeamsMiscData,
      },
    ] as unknown as Array<WorkspaceProjectAuthToken>);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
      .mockImplementation(async (args: any): Promise<number> => {
        stored = args.data.miscData.installedTeams;
        return 1;
      });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
    });

    expect(Object.keys(stored)).toEqual([GRAPH_TEAM_ID]);
    expect(stored[GRAPH_TEAM_ID]!.teamsThreadId).toBe(TEAM_THREAD_ID);
  });

  test("a team installed in one tenant does not vouch for a same-named team elsewhere", async () => {
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> =
      await captureInstall(teamChannelActivity());

    mockProjectAuthWith(installedTeams);
    installFakeBotAdapter();

    // A different Graph team id — the picker's other team — must not match.
    await expect(
      MicrosoftTeamsUtil.sendAdaptiveCardToChannel({
        authToken: "auth-token",
        teamId: "cccccccc-9999-0000-1111-222222222222",
        workspaceChannel: channel(),
        adaptiveCard: ADAPTIVE_CARD,
        projectId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/is not installed in the Microsoft Teams team/);
  });
});

describe("MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId", () => {
  test("undefined and empty maps produce an empty index", () => {
    expect(
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId(undefined),
    ).toEqual({});
    expect(MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId({})).toEqual({});
  });

  test("records are keyed by graphTeamId regardless of the map key they were stored under", () => {
    const record: MicrosoftTeamsInstalledTeam = {
      id: "whatever-key",
      graphTeamId: GRAPH_TEAM_ID,
      teamsThreadId: TEAM_THREAD_ID,
    };

    expect(
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId({
        "whatever-key": record,
      }),
    ).toEqual({ [GRAPH_TEAM_ID]: record });
  });

  test("records with no graphTeamId are dropped rather than indexed by a thread id", () => {
    expect(
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId({
        [TEAM_THREAD_ID]: {
          id: TEAM_THREAD_ID,
        } as MicrosoftTeamsInstalledTeam,
      }),
    ).toEqual({});
  });

  test("resolved and unresolved records coexist; only the resolved one is indexed", () => {
    const resolved: MicrosoftTeamsInstalledTeam = {
      id: GRAPH_TEAM_ID,
      graphTeamId: GRAPH_TEAM_ID,
    };

    expect(
      MicrosoftTeamsUtil.indexInstalledTeamsByGraphTeamId({
        [GRAPH_TEAM_ID]: resolved,
        "19:other@thread.tacv2": {
          id: "19:other@thread.tacv2",
        } as MicrosoftTeamsInstalledTeam,
      }),
    ).toEqual({ [GRAPH_TEAM_ID]: resolved });
  });
});

describe("MicrosoftTeamsUtil.isSameInstalledTeam", () => {
  test("matches on graphTeamId", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, graphTeamId: GRAPH_TEAM_ID },
        graphTeamId: GRAPH_TEAM_ID,
      }),
    ).toBe(true);
  });

  test("matches on teamsThreadId", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, teamsThreadId: TEAM_THREAD_ID },
        teamsThreadId: TEAM_THREAD_ID,
      }),
    ).toBe(true);
  });

  test("matches a legacy record whose thread id is only in the key field", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: TEAM_THREAD_ID },
        teamsThreadId: TEAM_THREAD_ID,
      }),
    ).toBe(true);
  });

  test("matches a legacy record by graph id when that is what it was keyed by", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID },
        graphTeamId: GRAPH_TEAM_ID,
      }),
    ).toBe(true);
  });

  test("does not match a different team", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, graphTeamId: GRAPH_TEAM_ID },
        graphTeamId: "cccccccc-9999-0000-1111-222222222222",
        teamsThreadId: "19:someone-else@thread.tacv2",
      }),
    ).toBe(false);
  });

  test("does not cross id spaces — a thread id never matches a graph id field", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, graphTeamId: GRAPH_TEAM_ID },
        teamsThreadId: GRAPH_TEAM_ID,
      }),
    ).toBe(true); // id equals the value, so this is a legitimate key match
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: "some-key", graphTeamId: GRAPH_TEAM_ID },
        teamsThreadId: GRAPH_TEAM_ID,
      }),
    ).toBe(false);
  });

  test("matching is case-sensitive, as Microsoft's ids are", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, graphTeamId: GRAPH_TEAM_ID },
        graphTeamId: GRAPH_TEAM_ID.toUpperCase(),
      }),
    ).toBe(false);
  });

  test("an undefined record never matches", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: undefined,
        graphTeamId: GRAPH_TEAM_ID,
      }),
    ).toBe(false);
  });

  test("no ids to match on means no match, rather than matching everything", () => {
    expect(
      MicrosoftTeamsUtil.isSameInstalledTeam({
        team: { id: GRAPH_TEAM_ID, graphTeamId: GRAPH_TEAM_ID },
      }),
    ).toBe(false);
  });
});

/*
 * The message-driven backfill fires on EVERY inbound channel message, so it has
 * to be cheap once the team is on record. Install events themselves always
 * re-record: that is when the serviceUrl and the group id are freshest.
 */
describe("captureTeamFromBotActivity onlyIfMissingOrStale", () => {
  function mockStoredTeams(
    installedTeams: Record<string, MicrosoftTeamsInstalledTeam>,
  ): { saveSpy: jest.SpyInstance } {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        miscData: { installedTeams: installedTeams } as MicrosoftTeamsMiscData,
      },
    ] as unknown as Array<WorkspaceProjectAuthToken>);

    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    return { saveSpy: saveSpy };
  }

  function fullyRecordedTeam(): MicrosoftTeamsInstalledTeam {
    return {
      id: GRAPH_TEAM_ID,
      graphTeamId: GRAPH_TEAM_ID,
      teamsThreadId: TEAM_THREAD_ID,
      serviceUrl: ACTIVITY_SERVICE_URL,
      addedAt: "2026-08-01T00:00:00.000Z",
    };
  }

  test("an already-recorded team is not rewritten", async () => {
    const { saveSpy } = mockStoredTeams({
      [GRAPH_TEAM_ID]: fullyRecordedTeam(),
    });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
      onlyIfMissingOrStale: true,
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("an already-recorded team does not trigger a Bot Framework lookup", async () => {
    /*
     * The expensive case: an activity with no aadGroupId. Resolving it on every
     * message would be one Bot Framework call per message in a busy channel.
     */
    mockStoredTeams({ [GRAPH_TEAM_ID]: fullyRecordedTeam() });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity({
        team: { id: TEAM_THREAD_ID, name: "WBNOC" },
      }),
      turnContext: buildTurnContext(),
      onlyIfMissingOrStale: true,
    });

    expect(TeamsInfo.getTeamDetails as jest.Mock).not.toHaveBeenCalled();
  });

  test("a team that is not on record yet IS written", async () => {
    const { saveSpy } = mockStoredTeams({});

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
      onlyIfMissingOrStale: true,
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  test("a record missing its graph id is refreshed, so the upgrade path still works", async () => {
    const { saveSpy } = mockStoredTeams({
      [TEAM_THREAD_ID]: {
        id: TEAM_THREAD_ID,
        serviceUrl: ACTIVITY_SERVICE_URL,
      } as MicrosoftTeamsInstalledTeam,
    });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
      onlyIfMissingOrStale: true,
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(saved.graphTeamId).toBe(GRAPH_TEAM_ID);
  });

  test("a moved serviceUrl is refreshed", async () => {
    /*
     * Microsoft's docs say to re-verify the stored serviceUrl when a new message
     * arrives; a stale one sends proactive posts to the wrong regional host.
     */
    const { saveSpy } = mockStoredTeams({
      [GRAPH_TEAM_ID]: {
        ...fullyRecordedTeam(),
        serviceUrl: "https://smba.trafficmanager.net/emea/",
      },
    });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
      onlyIfMissingOrStale: true,
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saved: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(saved.serviceUrl).toBe(ACTIVITY_SERVICE_URL);
  });

  test("without the flag, an install event always re-records", async () => {
    const { saveSpy } = mockStoredTeams({
      [GRAPH_TEAM_ID]: fullyRecordedTeam(),
    });

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamChannelActivity(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MicrosoftTeamsUtil.getInstalledTeamForTenant", () => {
  function mockRows(
    installedTeams: Record<string, MicrosoftTeamsInstalledTeam>,
  ): void {
    jest.spyOn(WorkspaceProjectAuthTokenService, "findBy").mockResolvedValue([
      {
        id: ObjectID.generate(),
        miscData: { installedTeams: installedTeams } as MicrosoftTeamsMiscData,
      },
    ] as unknown as Array<WorkspaceProjectAuthToken>);
  }

  test("finds a record by graph team id", async () => {
    const team: MicrosoftTeamsInstalledTeam = {
      id: GRAPH_TEAM_ID,
      graphTeamId: GRAPH_TEAM_ID,
    };
    mockRows({ [GRAPH_TEAM_ID]: team });

    await expect(
      MicrosoftTeamsUtil.getInstalledTeamForTenant({
        tenantId: TENANT_ID,
        graphTeamId: GRAPH_TEAM_ID,
      }),
    ).resolves.toEqual(team);
  });

  test("finds a legacy record by thread id", async () => {
    const team: MicrosoftTeamsInstalledTeam = { id: TEAM_THREAD_ID };
    mockRows({ [TEAM_THREAD_ID]: team });

    await expect(
      MicrosoftTeamsUtil.getInstalledTeamForTenant({
        tenantId: TENANT_ID,
        teamsThreadId: TEAM_THREAD_ID,
      }),
    ).resolves.toEqual(team);
  });

  test("returns null when the tenant has no matching team", async () => {
    mockRows({
      "other-team": {
        id: "other-team",
        graphTeamId: "other-team",
      },
    });

    await expect(
      MicrosoftTeamsUtil.getInstalledTeamForTenant({
        tenantId: TENANT_ID,
        graphTeamId: GRAPH_TEAM_ID,
        teamsThreadId: TEAM_THREAD_ID,
      }),
    ).resolves.toBeNull();
  });

  test("returns null when the tenant has no rows at all", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await expect(
      MicrosoftTeamsUtil.getInstalledTeamForTenant({
        tenantId: TENANT_ID,
        graphTeamId: GRAPH_TEAM_ID,
      }),
    ).resolves.toBeNull();
  });

  test("queries by MicrosoftTeams workspace type and the tenant id", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([]);

    await MicrosoftTeamsUtil.getInstalledTeamForTenant({
      tenantId: TENANT_ID,
      graphTeamId: GRAPH_TEAM_ID,
    });

    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: TENANT_ID,
        },
      }),
    );
  });
});
