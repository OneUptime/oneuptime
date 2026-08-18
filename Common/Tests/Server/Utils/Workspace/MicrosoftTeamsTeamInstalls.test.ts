import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Extensive tests for Microsoft Teams TEAM INSTALL capture in
 * MicrosoftTeamsUtil.
 *
 * The bug being pinned: Microsoft tells us the OneUptime app was installed
 * into a TEAM via conversationUpdate (bot in membersAdded) and
 * installationUpdate (action add / add-upgrade). Both signals used to be
 * routed only into captureChatFromBotActivity, which drops everything that is
 * not a personal or groupChat conversation — so the team install was thrown
 * away. Two things broke because of that:
 *
 * - we could not tell whether a proactive channel post would be accepted
 *   (Graph can LIST every team in the tenant, but the Bot Framework only
 *   accepts a post into a team the app is actually a roster member of), and
 * - we lost the per-install serviceUrl, which GCC/DoD tenants need because
 *   their Bot Framework endpoint is not the global one.
 *
 * Covered here:
 *
 * - captureTeamFromBotActivity / removeTeamFromBotActivity: the activity ->
 *   MicrosoftTeamsInstalledTeam translation, including which fields are
 *   required, the serviceUrl precedence, and the swallow-don't-throw contract.
 * - saveTeamToProjectAuthTokens / removeTeamFromProjectAuthTokens: installs
 *   are stored in miscData.installedTeams on EVERY WorkspaceProjectAuthToken
 *   row whose workspaceProjectId equals the Teams tenant id.
 * - getInstalledTeamsForProject: the read side of the install store.
 * - handleConversationUpdateActivity / handleInstallationUpdateActivity /
 *   handleBotMessageActivity: the wiring that must call BOTH the chat capture
 *   and the team capture, which is exactly what was missing before.
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
 * repo-wide manual mock (Tests/__mocks__/botbuilder.js) does not expose
 * TeamsInfo or MessageFactory.attachment, both of which MicrosoftTeams.ts
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
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
  MicrosoftTeamsTeam,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import { TeamsInfo, type TurnContext } from "botbuilder";

const BOT_RECIPIENT_ID: string = "bot-recipient-id";
const TURN_CONTEXT_SERVICE_URL: string =
  "https://smba.trafficmanager.net/emea/";
const ACTIVITY_SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";
const GCC_SERVICE_URL: string =
  "https://smba.infra.gov.teams.microsoft.us/gov/";
const TEAM_ID: string = "19:team-aaa@thread.tacv2";
const TENANT_ID: string = "tenant-1";
const ISO_TIMESTAMP: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface UpdateOneByIdArgs {
  id: ObjectID;
  data: { miscData: MicrosoftTeamsMiscData };
}

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
    sendActivity: async (): Promise<undefined> => {
      return undefined;
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

function buildInstalledTeam(data?: {
  id?: string | undefined;
  name?: string | undefined;
  serviceUrl?: string | undefined;
}): MicrosoftTeamsInstalledTeam {
  return {
    id: data?.id || TEAM_ID,
    name: data?.name || "Engineering",
    serviceUrl:
      data && "serviceUrl" in data ? data.serviceUrl : TURN_CONTEXT_SERVICE_URL,
    addedAt: "2026-07-27T00:00:00.000Z",
  };
}

function buildChat(data?: {
  id?: string | undefined;
  name?: string | undefined;
}): MicrosoftTeamsChat {
  return {
    id: data?.id || "19:groupchat@thread.v2",
    name: data?.name || "Alice, Bob",
    chatType: "groupChat",
    serviceUrl: TURN_CONTEXT_SERVICE_URL,
    addedAt: "2026-07-27T00:00:00.000Z",
  };
}

/*
 * A team-scoped bot activity as Teams delivers it: the team id and tenant id
 * live under channelData, never on the conversation object.
 */
function teamActivity(overrides?: JSONObject): JSONObject {
  return {
    channelData: {
      team: { id: TEAM_ID, name: "Engineering" },
      tenant: { id: TENANT_ID },
      channel: { id: "19:general@thread.tacv2" },
    },
    conversation: {
      conversationType: "channel",
      id: "19:general@thread.tacv2",
    },
    serviceUrl: ACTIVITY_SERVICE_URL,
    ...(overrides || {}),
  };
}

function getUpdateArgs(
  updateSpy: jest.SpyInstance,
  callIndex: number,
): UpdateOneByIdArgs {
  return updateSpy.mock.calls[callIndex]?.[0] as unknown as UpdateOneByIdArgs;
}

/*
 * Fan-out assertions must be anchored to the row they are about. Looking the
 * call up by id (rather than by position) is what makes "row two got row one's
 * miscData" a failure instead of a coincidence.
 */
function getUpdateArgsForId(
  updateSpy: jest.SpyInstance,
  id: ObjectID,
): UpdateOneByIdArgs {
  const calls: Array<Array<unknown>> = updateSpy.mock.calls as Array<
    Array<unknown>
  >;

  for (const call of calls) {
    const args: UpdateOneByIdArgs = call[0] as UpdateOneByIdArgs;

    if (String(args.id) === id.toString()) {
      return args;
    }
  }

  throw new Error(`No updateOneById call was made for id ${id.toString()}`);
}

interface DistinctRowFixture {
  id: ObjectID;
  tenantId: string;
  teamName: string;
  botId: string;
  existingTeam: MicrosoftTeamsInstalledTeam;
  chat: MicrosoftTeamsChat;
}

/*
 * Every fan-out row must be DISTINGUISHABLE from its siblings. If all rows are
 * built from the same baseMiscData(), a bug that merges once and writes the
 * same object to every row is invisible: each row's assertions pass against
 * every other row's data. Each fixture therefore owns its scalars, its
 * pre-existing installedTeams entry and its availableChats entry.
 */
function buildDistinctRowFixture(label: string): DistinctRowFixture {
  return {
    id: ObjectID.generate(),
    tenantId: `tenant-${label}`,
    teamName: `${label} team name`,
    botId: `bot-${label}`,
    existingTeam: buildInstalledTeam({
      id: `19:${label}-existing@thread.tacv2`,
      name: `${label} existing team`,
      serviceUrl: `https://smba.trafficmanager.net/${label}/`,
    }),
    chat: buildChat({
      id: `19:${label}-chat@thread.v2`,
      name: `${label} chat`,
    }),
  };
}

function buildRowFromFixture(data: {
  fixture: DistinctRowFixture;
  installedTeams?: Record<string, MicrosoftTeamsInstalledTeam> | undefined;
}): WorkspaceProjectAuthToken {
  const overrides: Partial<MicrosoftTeamsMiscData> = {
    tenantId: data.fixture.tenantId,
    teamName: data.fixture.teamName,
    botId: data.fixture.botId,
    availableChats: { [data.fixture.chat.id]: data.fixture.chat },
  };

  if (data.installedTeams) {
    overrides.installedTeams = data.installedTeams;
  }

  return buildProjectAuthRow({
    id: data.fixture.id,
    miscData: baseMiscData(overrides),
  });
}

function getUpdatedIds(updateSpy: jest.SpyInstance): Array<string> {
  const calls: Array<Array<unknown>> = updateSpy.mock.calls as Array<
    Array<unknown>
  >;
  const ids: Array<string> = [];

  for (const call of calls) {
    ids.push(String((call[0] as UpdateOneByIdArgs).id));
  }

  return ids;
}

function buildRowsFromFixtures(data: {
  fixtures: Array<DistinctRowFixture>;
  sharedTeam?: MicrosoftTeamsInstalledTeam | undefined;
}): Array<WorkspaceProjectAuthToken> {
  const rows: Array<WorkspaceProjectAuthToken> = [];

  for (const fixture of data.fixtures) {
    const installedTeams: Record<string, MicrosoftTeamsInstalledTeam> = {
      [fixture.existingTeam.id]: fixture.existingTeam,
    };

    if (data.sharedTeam) {
      installedTeams[data.sharedTeam.id] = data.sharedTeam;
    }

    rows.push(
      buildRowFromFixture({
        fixture: fixture,
        installedTeams: installedTeams,
      }),
    );
  }

  return rows;
}

function fixtureIds(fixtures: Array<DistinctRowFixture>): Array<string> {
  return fixtures.map((fixture: DistinctRowFixture): string => {
    return fixture.id.toString();
  });
}

function mockFindBy(rows: Array<WorkspaceProjectAuthToken>): jest.SpyInstance {
  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockResolvedValue(rows);
}

function mockUpdateOneById(): jest.SpyInstance {
  return jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockResolvedValue(undefined as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The botbuilder module mock's jest.fn()s are shared by every test in this
 * file — jest.spyOn on an existing mock returns the same function, so call
 * history and mockResolvedValueOnce queues leak between tests unless reset.
 */
beforeEach(() => {
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
  (TeamsInfo.getMembers as jest.Mock).mockReset();
});

describe("MicrosoftTeamsUtil.captureTeamFromBotActivity", () => {
  test("builds an installed team record from channelData and saves it under the tenant", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity(),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const saveArgs: { tenantId: string; team: MicrosoftTeamsInstalledTeam } =
      saveSpy.mock.calls[0]?.[0] as {
        tenantId: string;
        team: MicrosoftTeamsInstalledTeam;
      };
    expect(saveArgs.tenantId).toBe(TENANT_ID);
    expect(saveArgs.team.id).toBe(TEAM_ID);
    expect(saveArgs.team.name).toBe("Engineering");
    expect(saveArgs.team.serviceUrl).toBe(ACTIVITY_SERVICE_URL);
  });

  test("addedAt is an ISO-8601 string", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity(),
      turnContext: buildTurnContext(),
    });

    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(typeof team.addedAt).toBe("string");
    expect(team.addedAt).toMatch(ISO_TIMESTAMP);
    expect(Number.isNaN(new Date(team.addedAt as string).getTime())).toBe(
      false,
    );
  });

  test("serviceUrl prefers the activity over the turn context", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({ serviceUrl: GCC_SERVICE_URL }),
      turnContext: buildTurnContext({ serviceUrl: TURN_CONTEXT_SERVICE_URL }),
    });

    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(team.serviceUrl).toBe(GCC_SERVICE_URL);
  });

  test("serviceUrl falls back to the turn context when the activity has none", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const activity: JSONObject = teamActivity();
    delete activity["serviceUrl"];

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: activity,
      turnContext: buildTurnContext({ serviceUrl: GCC_SERVICE_URL }),
    });

    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(team.serviceUrl).toBe(GCC_SERVICE_URL);
  });

  test("serviceUrl is undefined when neither the activity nor the turn context has one", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);
    const activity: JSONObject = teamActivity();
    delete activity["serviceUrl"];

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: activity,
      turnContext: buildTurnContext({ serviceUrl: undefined }),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(team.serviceUrl).toBeUndefined();
  });

  test("team name absent leaves name undefined but still records the install", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: { team: { id: TEAM_ID }, tenant: { id: TENANT_ID } },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(team.id).toBe(TEAM_ID);
    expect(team.name).toBeUndefined();
  });

  test("an empty-string team name is normalized to undefined", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: {
          team: { id: TEAM_ID, name: "" },
          tenant: { id: TENANT_ID },
        },
      }),
      turnContext: buildTurnContext(),
    });

    const team: MicrosoftTeamsInstalledTeam = (
      saveSpy.mock.calls[0]?.[0] as { team: MicrosoftTeamsInstalledTeam }
    ).team;
    expect(team.name).toBeUndefined();
  });

  test("missing team id short-circuits before ANY database read", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: { tenant: { id: TENANT_ID } },
      }),
      turnContext: buildTurnContext(),
    });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a personal chat activity (no channelData at all) is ignored without throwing", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await expect(
      MicrosoftTeamsUtil.captureTeamFromBotActivity({
        activity: {
          conversation: { conversationType: "personal", id: "a:1personal" },
          serviceUrl: ACTIVITY_SERVICE_URL,
        },
        turnContext: buildTurnContext(),
      }),
    ).resolves.toBeUndefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("an empty-string team id is treated as missing", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: { team: { id: "" }, tenant: { id: TENANT_ID } },
      }),
      turnContext: buildTurnContext(),
    });

    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("missing tenant id records nothing (a team install we cannot attribute is useless)", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: { team: { id: TEAM_ID, name: "Engineering" } },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("an empty-string tenant id records nothing", async () => {
    const saveSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.captureTeamFromBotActivity({
      activity: teamActivity({
        channelData: { team: { id: TEAM_ID }, tenant: { id: "" } },
      }),
      turnContext: buildTurnContext(),
    });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a throwing save is swallowed, not propagated (a failed capture must never 500 the bot endpoint)", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "saveTeamToProjectAuthTokens")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      MicrosoftTeamsUtil.captureTeamFromBotActivity({
        activity: teamActivity(),
        turnContext: buildTurnContext(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("MicrosoftTeamsUtil.removeTeamFromBotActivity", () => {
  test("removes the team install for the tenant on the activity", async () => {
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeTeamFromBotActivity({
      activity: teamActivity(),
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    /*
     * Uninstall passes both ids: the bot is already out of the team so the
     * Graph id cannot be looked up, and records written before it was captured
     * are only findable by the thread id. TEAM_ID here is a thread id, matching
     * what channelData.team.id carries.
     */
    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      teamsThreadId: TEAM_ID,
      graphTeamId: undefined,
    });
  });

  test("an uninstall activity that still carries aadGroupId passes it through", async () => {
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeTeamFromBotActivity({
      activity: teamActivity({
        channelData: {
          team: { id: TEAM_ID, aadGroupId: "graph-team-1" },
          tenant: { id: TENANT_ID },
        },
      }),
    });

    expect(removeSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      teamsThreadId: TEAM_ID,
      graphTeamId: "graph-team-1",
    });
  });

  test("missing team id removes nothing", async () => {
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeTeamFromBotActivity({
      activity: teamActivity({ channelData: { tenant: { id: TENANT_ID } } }),
    });

    expect(removeSpy).not.toHaveBeenCalled();
  });

  test("missing tenant id removes nothing", async () => {
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await MicrosoftTeamsUtil.removeTeamFromBotActivity({
      activity: teamActivity({ channelData: { team: { id: TEAM_ID } } }),
    });

    expect(removeSpy).not.toHaveBeenCalled();
  });

  test("an activity with no channelData removes nothing and does not throw", async () => {
    const removeSpy: jest.SpyInstance = jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockResolvedValue(undefined as never);

    await expect(
      MicrosoftTeamsUtil.removeTeamFromBotActivity({ activity: {} }),
    ).resolves.toBeUndefined();

    expect(removeSpy).not.toHaveBeenCalled();
  });

  test("a throwing removal is swallowed, not propagated", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromProjectAuthTokens")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      MicrosoftTeamsUtil.removeTeamFromBotActivity({
        activity: teamActivity(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("MicrosoftTeamsUtil.saveTeamToProjectAuthTokens", () => {
  test("queries project auth rows by MicrosoftTeams workspace type and tenant id", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: buildInstalledTeam(),
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

  test("fans out to EVERY project connected to the tenant, merging into each row's OWN miscData (3 rows -> 3 updates)", async () => {
    /*
     * Three rows that share nothing: different scalars, different pre-existing
     * installedTeams and different availableChats. Merging once and writing the
     * result to all three rows must fail here, not pass by symmetry.
     */
    const fixtures: Array<DistinctRowFixture> = [
      buildDistinctRowFixture("row-one"),
      buildDistinctRowFixture("row-two"),
      buildDistinctRowFixture("row-three"),
    ];
    mockFindBy(buildRowsFromFixtures({ fixtures: fixtures }));
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: team,
    });

    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(getUpdatedIds(updateSpy)).toEqual(fixtureIds(fixtures));

    const savedObjects: Set<MicrosoftTeamsMiscData> =
      new Set<MicrosoftTeamsMiscData>();

    for (const fixture of fixtures) {
      // Anchored on this row's id: a sibling's payload cannot stand in for it.
      const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgsForId(
        updateSpy,
        fixture.id,
      ).data.miscData;
      savedObjects.add(savedMiscData);

      /*
       * The new install is added on top of THIS row's install history. The
       * exact-map comparison also proves no sibling's team leaked in.
       */
      expect(savedMiscData.installedTeams).toEqual({
        [fixture.existingTeam.id]: fixture.existingTeam,
        [team.id]: team,
      });
      // This row's chat store is untouched, and is not a sibling's chat store.
      expect(savedMiscData.availableChats).toEqual({
        [fixture.chat.id]: fixture.chat,
      });
      expect(savedMiscData.tenantId).toBe(fixture.tenantId);
      expect(savedMiscData.teamName).toBe(fixture.teamName);
      expect(savedMiscData.botId).toBe(fixture.botId);
    }

    /*
     * Each row must be written a miscData object of its own — one shared object
     * handed to all three updates is the exact defect this test guards.
     */
    expect(savedObjects.size).toBe(3);
  });

  test("updates are made with root props", async () => {
    mockFindBy([buildProjectAuthRow({ miscData: baseMiscData() })]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: buildInstalledTeam(),
    });

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  test("merging an install preserves other miscData fields, availableChats and other installed teams", async () => {
    const existingTeam: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:other-team@thread.tacv2",
      name: "Support",
    });
    const existingChat: MicrosoftTeamsChat = buildChat();
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({
          appAccessToken: "token-abc",
          adminConsentGranted: true,
          availableChats: { [existingChat.id]: existingChat },
          installedTeams: { [existingTeam.id]: existingTeam },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    const newTeam: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: newTeam,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgs(updateSpy, 0)
      .data.miscData;
    expect(savedMiscData.tenantId).toBe("tenant-xyz");
    expect(savedMiscData.teamId).toBe("team-1");
    expect(savedMiscData.teamName).toBe("Engineering");
    expect(savedMiscData.botId).toBe("bot-1");
    expect(savedMiscData.appAccessToken).toBe("token-abc");
    expect(savedMiscData.adminConsentGranted).toBe(true);
    // The chat store must survive a team install untouched.
    expect(savedMiscData.availableChats).toEqual({
      [existingChat.id]: existingChat,
    });
    expect(savedMiscData.installedTeams).toEqual({
      [existingTeam.id]: existingTeam,
      [newTeam.id]: newTeam,
    });
  });

  test("re-installing the same team id overwrites the stored record (upsert, keeps serviceUrl fresh)", async () => {
    const staleTeam: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      name: "Old name",
      serviceUrl: "https://smba.trafficmanager.net/OLD/",
    });
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({
          installedTeams: { [staleTeam.id]: staleTeam },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    const freshTeam: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      name: "New name",
      serviceUrl: GCC_SERVICE_URL,
    });
    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: freshTeam,
    });

    const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgs(updateSpy, 0)
      .data.miscData;
    expect(Object.keys(savedMiscData.installedTeams || {})).toHaveLength(1);
    expect(savedMiscData.installedTeams?.[freshTeam.id]?.name).toBe("New name");
    expect(savedMiscData.installedTeams?.[freshTeam.id]?.serviceUrl).toBe(
      GCC_SERVICE_URL,
    );
  });

  test("creates installedTeams when miscData is undefined", async () => {
    mockFindBy([buildProjectAuthRow({ miscData: undefined })]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: team,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getUpdateArgs(updateSpy, 0).data.miscData.installedTeams).toEqual({
      [team.id]: team,
    });
  });

  test("creates installedTeams when the map is present but empty", async () => {
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({ installedTeams: {} }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: team,
    });

    expect(getUpdateArgs(updateSpy, 0).data.miscData.installedTeams).toEqual({
      [team.id]: team,
    });
  });

  test("no matching project auth rows -> no updates", async () => {
    mockFindBy([]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: buildInstalledTeam(),
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("does not mutate the row's own miscData object", async () => {
    const originalMiscData: MicrosoftTeamsMiscData = baseMiscData({
      installedTeams: {},
    });
    mockFindBy([buildProjectAuthRow({ miscData: originalMiscData })]);
    mockUpdateOneById();

    await MicrosoftTeamsUtil.saveTeamToProjectAuthTokens({
      tenantId: "tenant-abc",
      team: buildInstalledTeam(),
    });

    expect(originalMiscData.installedTeams).toEqual({});
  });
});

describe("MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens", () => {
  test("queries project auth rows by MicrosoftTeams workspace type and tenant id", async () => {
    const findBySpy: jest.SpyInstance = mockFindBy([]);

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: TEAM_ID,
    });

    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceProjectId: "tenant-abc",
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    );
  });

  test("removes only the target team and keeps the others", async () => {
    const teamToRemove: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:remove@thread.tacv2",
      name: "Removed",
    });
    const teamToKeep: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:keep@thread.tacv2",
      name: "Kept",
    });
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({
          installedTeams: {
            [teamToRemove.id]: teamToRemove,
            [teamToKeep.id]: teamToKeep,
          },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: teamToRemove.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(getUpdateArgs(updateSpy, 0).data.miscData.installedTeams).toEqual({
      [teamToKeep.id]: teamToKeep,
    });
  });

  test("removal preserves the rest of miscData, including availableChats", async () => {
    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    const chat: MicrosoftTeamsChat = buildChat();
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({
          appAccessToken: "token-abc",
          availableChats: { [chat.id]: chat },
          installedTeams: { [team.id]: team },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: team.id,
    });

    const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgs(updateSpy, 0)
      .data.miscData;
    expect(savedMiscData.installedTeams).toEqual({});
    expect(savedMiscData.availableChats).toEqual({ [chat.id]: chat });
    expect(savedMiscData.appAccessToken).toBe("token-abc");
    expect(savedMiscData.botId).toBe("bot-1");
  });

  test("does not call updateOneById when the row does not have that team", async () => {
    const otherTeam: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:other@thread.tacv2",
    });
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({
          installedTeams: { [otherTeam.id]: otherTeam },
        }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: TEAM_ID,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("rows with no installedTeams at all are skipped without an update", async () => {
    mockFindBy([
      buildProjectAuthRow({ miscData: baseMiscData() }),
      buildProjectAuthRow({ miscData: undefined }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: TEAM_ID,
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("removes the team from every matching row, keeping each row's OWN remaining data (multi-row removal)", async () => {
    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    /*
     * Each row keeps a DIFFERENT second install alongside the shared target, so
     * a removal that computes one miscData and writes it to every row cannot
     * survive: row two would be handed row one's surviving team.
     */
    const fixtures: Array<DistinctRowFixture> = [
      buildDistinctRowFixture("remove-row-one"),
      buildDistinctRowFixture("remove-row-two"),
      buildDistinctRowFixture("remove-row-three"),
    ];
    mockFindBy(buildRowsFromFixtures({ fixtures: fixtures, sharedTeam: team }));
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: team.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(getUpdatedIds(updateSpy)).toEqual(fixtureIds(fixtures));

    const savedObjects: Set<MicrosoftTeamsMiscData> =
      new Set<MicrosoftTeamsMiscData>();

    for (const fixture of fixtures) {
      const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgsForId(
        updateSpy,
        fixture.id,
      ).data.miscData;
      savedObjects.add(savedMiscData);

      // Only the target goes; this row's other install stays, siblings' do not.
      expect(savedMiscData.installedTeams).toEqual({
        [fixture.existingTeam.id]: fixture.existingTeam,
      });
      expect(savedMiscData.availableChats).toEqual({
        [fixture.chat.id]: fixture.chat,
      });
      expect(savedMiscData.tenantId).toBe(fixture.tenantId);
      expect(savedMiscData.teamName).toBe(fixture.teamName);
      expect(savedMiscData.botId).toBe(fixture.botId);
    }

    expect(savedObjects.size).toBe(3);
  });

  test("only the rows that contain the team are updated, and that update carries that row's own miscData", async () => {
    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    const noInstalledTeamsRow: DistinctRowFixture =
      buildDistinctRowFixture("no-map-row");
    const rowWithTeam: DistinctRowFixture =
      buildDistinctRowFixture("has-team-row");
    const emptyMapRow: DistinctRowFixture =
      buildDistinctRowFixture("empty-map-row");
    mockFindBy([
      buildRowFromFixture({ fixture: noInstalledTeamsRow }),
      buildRowFromFixture({
        fixture: rowWithTeam,
        installedTeams: {
          [rowWithTeam.existingTeam.id]: rowWithTeam.existingTeam,
          [team.id]: team,
        },
      }),
      buildRowFromFixture({ fixture: emptyMapRow, installedTeams: {} }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: team.id,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(String(getUpdateArgs(updateSpy, 0).id)).toBe(
      rowWithTeam.id.toString(),
    );
    /*
     * The one update must carry the matching row's data — not data assembled
     * from a skipped neighbour that happened to be iterated first.
     */
    const savedMiscData: MicrosoftTeamsMiscData = getUpdateArgs(updateSpy, 0)
      .data.miscData;
    expect(savedMiscData.installedTeams).toEqual({
      [rowWithTeam.existingTeam.id]: rowWithTeam.existingTeam,
    });
    expect(savedMiscData.availableChats).toEqual({
      [rowWithTeam.chat.id]: rowWithTeam.chat,
    });
    expect(savedMiscData.tenantId).toBe(rowWithTeam.tenantId);
    expect(savedMiscData.botId).toBe(rowWithTeam.botId);
  });

  test("team ids are matched case-sensitively (a different casing is a different team)", async () => {
    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:Team-AAA@thread.tacv2",
    });
    mockFindBy([
      buildProjectAuthRow({
        miscData: baseMiscData({ installedTeams: { [team.id]: team } }),
      }),
    ]);
    const updateSpy: jest.SpyInstance = mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: "19:team-aaa@thread.tacv2",
    });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("does not mutate the row's own installedTeams object", async () => {
    const team: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    const originalMiscData: MicrosoftTeamsMiscData = baseMiscData({
      installedTeams: { [team.id]: team },
    });
    mockFindBy([buildProjectAuthRow({ miscData: originalMiscData })]);
    mockUpdateOneById();

    await MicrosoftTeamsUtil.removeTeamFromProjectAuthTokens({
      tenantId: "tenant-abc",
      teamsThreadId: team.id,
    });

    expect(originalMiscData.installedTeams).toEqual({ [team.id]: team });
  });
});

describe("MicrosoftTeamsUtil.getInstalledTeamsForProject", () => {
  test("returns empty object when there is no project auth", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    const teams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: ObjectID.generate(),
      });

    expect(teams).toEqual({});
  });

  test("returns empty object when project auth has no miscData", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(buildProjectAuthRow({ miscData: undefined }));

    const teams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: ObjectID.generate(),
      });

    expect(teams).toEqual({});
  });

  test("returns empty object when miscData has no installedTeams", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(buildProjectAuthRow({ miscData: baseMiscData() }));

    const teams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: ObjectID.generate(),
      });

    expect(teams).toEqual({});
  });

  test("returns installedTeams when present, keyed by team id", async () => {
    const teamOne: MicrosoftTeamsInstalledTeam = buildInstalledTeam();
    const teamTwo: MicrosoftTeamsInstalledTeam = buildInstalledTeam({
      id: "19:second@thread.tacv2",
      name: "Support",
      serviceUrl: GCC_SERVICE_URL,
    });
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        buildProjectAuthRow({
          miscData: baseMiscData({
            installedTeams: { [teamOne.id]: teamOne, [teamTwo.id]: teamTwo },
          }),
        }),
      );

    const teams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: ObjectID.generate(),
      });

    expect(teams).toEqual({ [teamOne.id]: teamOne, [teamTwo.id]: teamTwo });
    expect(teams[teamTwo.id]?.serviceUrl).toBe(GCC_SERVICE_URL);
  });

  test("does not confuse availableTeams (what Graph can see) with installedTeams (what we can post to)", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        buildProjectAuthRow({
          miscData: baseMiscData({
            availableTeams: {
              "19:listed-only@thread.tacv2": {
                id: "19:listed-only@thread.tacv2",
                name: "Listed but not installed",
              },
            } as Record<string, MicrosoftTeamsTeam>,
          }),
        }),
      );

    const teams: Record<string, MicrosoftTeamsInstalledTeam> =
      await MicrosoftTeamsUtil.getInstalledTeamsForProject({
        projectId: ObjectID.generate(),
      });

    expect(teams).toEqual({});
  });

  test("looks up project auth by projectId and MicrosoftTeams workspace type", async () => {
    const getProjectAuthSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    const projectId: ObjectID = ObjectID.generate();

    await MicrosoftTeamsUtil.getInstalledTeamsForProject({
      projectId: projectId,
    });

    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });
});

interface WiringSpies {
  captureChatSpy: jest.SpyInstance;
  captureTeamSpy: jest.SpyInstance;
  removeChatSpy: jest.SpyInstance;
  removeTeamSpy: jest.SpyInstance;
}

/*
 * Route-level spies: the wiring tests assert WHICH capture ran, not what it
 * did internally, so both the chat and the team capture are stubbed out.
 */
function installWiringSpies(): WiringSpies {
  return {
    captureChatSpy: jest
      .spyOn(MicrosoftTeamsUtil as any, "captureChatFromBotActivity")
      .mockResolvedValue(undefined as never),
    captureTeamSpy: jest
      .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
      .mockResolvedValue(undefined as never),
    removeChatSpy: jest
      .spyOn(MicrosoftTeamsUtil as any, "removeChatFromBotActivity")
      .mockResolvedValue(undefined as never),
    removeTeamSpy: jest
      .spyOn(MicrosoftTeamsUtil, "removeTeamFromBotActivity")
      .mockResolvedValue(undefined as never),
  };
}

describe("MicrosoftTeamsUtil.handleConversationUpdateActivity - team install wiring", () => {
  function installWelcomeSpy(): jest.SpyInstance {
    return jest
      .spyOn(MicrosoftTeamsUtil as any, "sendWelcomeAdaptiveCard")
      .mockResolvedValue(undefined as never);
  }

  test("bot added to a team calls BOTH the chat capture and the team capture", async () => {
    installWelcomeSpy();
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = teamActivity({
      membersAdded: [{ id: BOT_RECIPIENT_ID }],
    });
    const turnContext: TurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: activity,
      turnContext: turnContext,
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledWith({
      activity: activity,
      turnContext: turnContext,
    });
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
  });

  test("bot removed from a team calls BOTH the chat removal and the team removal", async () => {
    installWelcomeSpy();
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = teamActivity({
      membersRemoved: [{ id: BOT_RECIPIENT_ID }],
    });

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: activity,
      turnContext: buildTurnContext(),
    });

    expect(spies.removeChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).toHaveBeenCalledWith({ activity: activity });
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("a non-bot member added or removed touches neither capture", async () => {
    installWelcomeSpy();
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: teamActivity({
        membersAdded: [{ id: "some-human-user" }],
        membersRemoved: [{ id: "another-human-user" }],
      }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).not.toHaveBeenCalled();
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.removeChatSpy).not.toHaveBeenCalled();
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
  });

  test("a conversationUpdate with no member lists at all is a no-op", async () => {
    installWelcomeSpy();
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: teamActivity(),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
  });

  test("bot added to a personal chat still runs the team capture (it self-filters on channelData.team)", async () => {
    installWelcomeSpy();
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: {
        membersAdded: [{ id: BOT_RECIPIENT_ID }],
        conversation: { conversationType: "personal", id: "a:1personal" },
        channelData: { tenant: { id: TENANT_ID } },
        serviceUrl: ACTIVITY_SERVICE_URL,
      },
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MicrosoftTeamsUtil.handleInstallationUpdateActivity - team install wiring", () => {
  test("action 'add' captures BOTH the chat and the team", async () => {
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = teamActivity({ action: "add" });
    const turnContext: TurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: activity,
      turnContext: turnContext,
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledWith({
      activity: activity,
      turnContext: turnContext,
    });
  });

  test("action 'add-upgrade' captures BOTH (manifest upgrade that re-adds the bot)", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: teamActivity({ action: "add-upgrade" }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
  });

  test("action 'remove' removes BOTH the chat and the team", async () => {
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = teamActivity({ action: "remove" });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: activity,
      turnContext: buildTurnContext(),
    });

    expect(spies.removeChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).toHaveBeenCalledWith({ activity: activity });
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("action 'remove-upgrade' removes BOTH", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: teamActivity({ action: "remove-upgrade" }),
      turnContext: buildTurnContext(),
    });

    expect(spies.removeChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.removeTeamSpy).toHaveBeenCalledTimes(1);
  });

  test("an unknown action does neither", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: teamActivity({ action: "something-else" }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
    expect(spies.captureChatSpy).not.toHaveBeenCalled();
    expect(spies.removeChatSpy).not.toHaveBeenCalled();
  });

  test("a missing action does neither", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: teamActivity(),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.removeTeamSpy).not.toHaveBeenCalled();
  });

  test("the action match is case-sensitive ('Add' is not 'add')", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: teamActivity({ action: "Add" }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.captureChatSpy).not.toHaveBeenCalled();
  });
});

describe("MicrosoftTeamsUtil.handleBotMessageActivity - team install backfill wiring", () => {
  /*
   * Teams the app was added to before install capture shipped fire no new
   * install event (a manifest version bump alone sends no installationUpdate
   * per Microsoft docs), so an inbound channel message is the only recovery
   * path. These activities carry no @mention, so the handler exits right
   * after the backfill step.
   */
  function messageActivity(conversation: JSONObject): JSONObject {
    return {
      type: "message",
      text: "hello there",
      from: { id: "user-1", name: "Alice" },
      recipient: { id: BOT_RECIPIENT_ID },
      conversation: conversation,
      channelData: {
        team: { id: TEAM_ID, name: "Engineering" },
        tenant: { id: TENANT_ID },
      },
      serviceUrl: ACTIVITY_SERVICE_URL,
      entities: [],
    };
  }

  test("a CHANNEL message backfills the team install and does not run the chat capture", async () => {
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = messageActivity({
      conversationType: "channel",
      id: "19:general@thread.tacv2",
    });
    const turnContext: TurnContext = buildTurnContext();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: activity,
      turnContext: turnContext,
    });

    expect(spies.captureTeamSpy).toHaveBeenCalledTimes(1);
    /*
     * onlyIfMissingOrStale, because this runs on every inbound channel message:
     * once the team is recorded it must cost one read, not a write plus a
     * possible Bot Framework call to resolve the group id.
     */
    expect(spies.captureTeamSpy).toHaveBeenCalledWith({
      activity: activity,
      turnContext: turnContext,
      onlyIfMissingOrStale: true,
    });
    expect(spies.captureChatSpy).not.toHaveBeenCalled();
  });

  test("a groupChat message runs the chat capture and NOT the team capture", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({
        conversationType: "groupChat",
        id: "19:groupchat@thread.v2",
      }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("a personal message runs the chat capture and NOT the team capture", async () => {
    const spies: WiringSpies = installWiringSpies();
    /*
     * A personal message is a direct message, so the handler runs on past the
     * backfill into tenant resolution. Stop it there — this test is only about
     * which capture ran.
     */
    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue({
        projectAuth: null,
        isAmbiguous: false,
        candidateProjectIds: [],
      } as MicrosoftTeamsTenantResolution);

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({
        conversationType: "personal",
        id: "a:1personal",
      }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).toHaveBeenCalledTimes(1);
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("a conversation with no conversationType triggers neither capture", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({ id: "19:unknown@thread.tacv2" }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureChatSpy).not.toHaveBeenCalled();
    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("conversationType matching is case-sensitive ('Channel' is not 'channel')", async () => {
    const spies: WiringSpies = installWiringSpies();

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: messageActivity({
        conversationType: "Channel",
        id: "19:general@thread.tacv2",
      }),
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });

  test("the bot's own channel message triggers no backfill (loop guard runs first)", async () => {
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = messageActivity({
      conversationType: "channel",
      id: "19:general@thread.tacv2",
    });
    (activity["from"] as JSONObject)["id"] = BOT_RECIPIENT_ID;

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: activity,
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
    expect(spies.captureChatSpy).not.toHaveBeenCalled();
  });

  test("a message from a member flagged with the bot role triggers no backfill", async () => {
    const spies: WiringSpies = installWiringSpies();
    const activity: JSONObject = messageActivity({
      conversationType: "channel",
      id: "19:general@thread.tacv2",
    });
    (activity["from"] as JSONObject)["role"] = "bot";

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: activity,
      turnContext: buildTurnContext(),
    });

    expect(spies.captureTeamSpy).not.toHaveBeenCalled();
  });
});
