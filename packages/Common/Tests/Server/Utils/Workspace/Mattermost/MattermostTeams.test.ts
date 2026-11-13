import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken, {
  MattermostConnectionTeam,
  MattermostMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import MattermostUtil from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import MattermostTeams, {
  MattermostTeamsOfConnection,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostTeams";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * ONE PROJECT, EVERY TEAM ITS MATTERMOST BOT IS IN (MattermostTeams).
 *
 * A project is connected to its Mattermost server through the team chosen
 * when it was connected, and works in every team its bot account is a
 * member of. One of them is the default team: a notification rule that
 * names no team creates its channels there. The teams are listed by the
 * server (GET /api/v4/users/me/teams), kept in the connection's miscData,
 * and read again when they are needed and older than ten minutes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-000000000001",
);

// The team the project was connected to: what its connection is stored under.
const ENGINEERING: string = "e".repeat(26);
const SUPPORT: string = "s".repeat(26);
const PLATFORM: string = "p".repeat(26);
// A team of the server the bot is not a member of.
const FINANCE: string = "f".repeat(26);

const BOT_ID: string = "b".repeat(26);
const ACCESS_TOKEN: string = "abcdefghijklmnopqrstuvwxyz";

const AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: "https://chat.example.com",
  accessToken: ACCESS_TOKEN,
  teamId: ENGINEERING,
  botUserId: BOT_ID,
});

const engineering: MattermostConnectionTeam = {
  id: ENGINEERING,
  name: "engineering",
  displayName: "Engineering",
};
const support: MattermostConnectionTeam = {
  id: SUPPORT,
  name: "support",
  displayName: "Support",
};
const platform: MattermostConnectionTeam = {
  id: PLATFORM,
  name: "platform",
  displayName: "Platform",
};

const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): string {
  return OneUptimeDate.toString(
    new Date(OneUptimeDate.getCurrentDate().getTime() - minutes * MINUTE),
  );
}

// A project's Mattermost connection, connected through Engineering.
function connection(
  miscData: Partial<MattermostMiscData> | undefined,
  overrides: Partial<WorkspaceProjectAuthToken> = {},
): WorkspaceProjectAuthToken {
  const projectAuth: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  projectAuth.projectId = PROJECT_ID;
  projectAuth.workspaceType = WorkspaceType.Mattermost;
  projectAuth.workspaceProjectId = ENGINEERING;
  projectAuth.authToken = AUTH_TOKEN;

  if (miscData) {
    projectAuth.miscData = {
      serverUrl: "https://chat.example.com",
      teamId: ENGINEERING,
      teamName: "engineering",
      teamDisplayName: "Engineering",
      botUserId: BOT_ID,
      botUsername: "oneuptime",
      ...miscData,
    } as MattermostMiscData;
  }

  Object.assign(projectAuth, overrides);

  return projectAuth;
}

function read(
  projectAuth: WorkspaceProjectAuthToken | null,
): MattermostTeamsOfConnection {
  const teams: MattermostTeamsOfConnection | null =
    MattermostTeams.readConnection(projectAuth);

  expect(teams).not.toBeNull();

  return teams!;
}

function idsOf(teams: Array<MattermostConnectionTeam>): Array<string> {
  return teams.map((team: MattermostConnectionTeam): string => {
    return team.id;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readConnection: the teams a connection works in, as stored", () => {
  test("no connection, or one that names no team, is none", () => {
    expect(MattermostTeams.readConnection(null)).toBeNull();
    expect(MattermostTeams.readConnection(undefined)).toBeNull();
    expect(
      MattermostTeams.readConnection({
        workspaceProjectId: "",
        miscData: {} as MattermostMiscData,
      }),
    ).toBeNull();
    expect(
      MattermostTeams.readConnection({
        workspaceProjectId: "not-a-team",
        miscData: { teamId: "../users/me" } as MattermostMiscData,
      }),
    ).toBeNull();
  });

  test("a connection made before teams were listed works in its one team, the default", () => {
    const teams: MattermostTeamsOfConnection = read(connection({}));

    expect(teams).toEqual({
      defaultTeam: engineering,
      teams: [engineering],
      isBotInDefaultTeam: true,
      connectedTeamId: ENGINEERING,
      teamsReadAt: undefined,
      removedTeams: [],
    });
  });

  test("a connection that keeps no names still works in the team it is stored under", () => {
    expect(read(connection(undefined))).toEqual({
      defaultTeam: { id: ENGINEERING, name: "", displayName: "" },
      teams: [{ id: ENGINEERING, name: "", displayName: "" }],
      isBotInDefaultTeam: true,
      connectedTeamId: ENGINEERING,
      teamsReadAt: undefined,
      removedTeams: [],
    });
  });

  test("the teams the server listed: the default first, then the others by name", () => {
    const readAt: string = minutesAgo(1);
    const teams: MattermostTeamsOfConnection = read(
      connection({
        teams: [support, engineering, platform],
        teamsReadAt: readAt,
      }),
    );

    expect(idsOf(teams.teams)).toEqual([ENGINEERING, PLATFORM, SUPPORT]);
    expect(teams.defaultTeam).toEqual(engineering);
    expect(teams.isBotInDefaultTeam).toBe(true);
    expect(teams.teamsReadAt?.toISOString()).toBe(
      OneUptimeDate.fromString(readAt).toISOString(),
    );
  });

  test("another team made the default comes first; the connection is still stored under the team it was made for", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({
        teamId: SUPPORT,
        teamName: "support",
        teamDisplayName: "Support",
        teams: [engineering, platform, support],
      }),
    );

    expect(teams.defaultTeam).toEqual(support);
    expect(idsOf(teams.teams)).toEqual([SUPPORT, ENGINEERING, PLATFORM]);
    expect(teams.connectedTeamId).toBe(ENGINEERING);
  });

  test("the default team as the server named it last, renamed since", () => {
    expect(
      read(
        connection({
          teams: [
            {
              id: ENGINEERING,
              name: "eng",
              displayName: "Product Engineering",
            },
          ],
        }),
      ).defaultTeam,
    ).toEqual({
      id: ENGINEERING,
      name: "eng",
      displayName: "Product Engineering",
    });
  });

  test("a default team the server no longer listed the bot in is still the default, and says so", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({ teams: [support, platform] }),
    );

    expect(teams.defaultTeam).toEqual(engineering);
    expect(idsOf(teams.teams)).toEqual([ENGINEERING, PLATFORM, SUPPORT]);
    expect(teams.isBotInDefaultTeam).toBe(false);
  });

  test("a server that listed no team at all: the bot is in none, the default kept", () => {
    const teams: MattermostTeamsOfConnection = read(connection({ teams: [] }));

    expect(idsOf(teams.teams)).toEqual([ENGINEERING]);
    expect(teams.isBotInDefaultTeam).toBe(false);
  });

  test("stored teams that are not teams are left out: an id Mattermost did not make, one twice, not an object", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({
        teams: [
          support,
          { id: "../users/me", name: "evil", displayName: "Evil" },
          { ...support, displayName: "Support again" },
          "platform" as unknown as MattermostConnectionTeam,
          null as unknown as MattermostConnectionTeam,
          [PLATFORM] as unknown as MattermostConnectionTeam,
          { id: PLATFORM, name: "platform" } as MattermostConnectionTeam,
        ],
      }),
    );

    expect(teams.teams).toEqual([
      engineering,
      // No display name: its name stands for it.
      { id: PLATFORM, name: "platform", displayName: "platform" },
      support,
    ]);
  });

  test("a default team stored as something that is not an id is the team the connection is stored under", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({ teamId: "../users/me" as string, teams: [support] }),
    );

    expect(teams.defaultTeam.id).toBe(ENGINEERING);
    expect(teams.connectedTeamId).toBe(ENGINEERING);
  });

  test("a time it was listed at that is not one is never", () => {
    expect(
      read(connection({ teams: [engineering], teamsReadAt: "yesterday" }))
        .teamsReadAt,
    ).toBeUndefined();
  });
});

describe("isTeamOfConnection: a team the connection works in", () => {
  const teams: MattermostTeamsOfConnection = read(
    connection({
      teamId: SUPPORT,
      teamName: "support",
      teams: [support, platform],
    }),
  );

  test("the default, a team the bot was listed in, and the team it was connected to", () => {
    expect(
      MattermostTeams.isTeamOfConnection({
        connection: teams,
        teamId: SUPPORT,
      }),
    ).toBe(true);
    expect(
      MattermostTeams.isTeamOfConnection({
        connection: teams,
        teamId: PLATFORM,
      }),
    ).toBe(true);
    // Its messages from before another team was the default are still answered.
    expect(
      MattermostTeams.isTeamOfConnection({
        connection: teams,
        teamId: ENGINEERING,
      }),
    ).toBe(true);
  });

  test("a team the bot is not a member of is not, nor anything that is not an id", () => {
    for (const teamId of [FINANCE, "", "support", undefined, 42, null]) {
      expect(
        MattermostTeams.isTeamOfConnection({
          connection: teams,
          teamId: teamId,
        }),
      ).toBe(false);
    }
  });

  test("no connection works in no team", () => {
    expect(
      MattermostTeams.isTeamOfConnection({
        connection: null,
        teamId: ENGINEERING,
      }),
    ).toBe(false);
  });
});

describe("the team of a rule's channel, and of a channel a record holds", () => {
  const movedDefault: WorkspaceProjectAuthToken = connection({
    teamId: SUPPORT,
    teamName: "support",
    teamDisplayName: "Support",
    teams: [engineering, support],
  });

  test("a rule's channel: the team the rule names, else the default", () => {
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: connection({}),
        teamId: SUPPORT,
      }),
    ).toBe(SUPPORT);
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: connection({}),
        teamId: undefined,
      }),
    ).toBe(ENGINEERING);
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: movedDefault,
        teamId: "",
      }),
    ).toBe(SUPPORT);
  });

  test("without a connection, a rule's channel is in the team it names, or none", () => {
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: null,
        teamId: SUPPORT,
      }),
    ).toBe(SUPPORT);
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: null,
        teamId: undefined,
      }),
    ).toBeUndefined();
  });

  test("a rule's team that is not a Mattermost id, written through the API before rules named one, names none: the default", () => {
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: movedDefault,
        teamId: "engineering",
      }),
    ).toBe(SUPPORT);
    expect(
      MattermostTeams.getTeamIdOfRuleChannel({
        projectAuth: null,
        teamId: "../users/me",
      }),
    ).toBeUndefined();
  });

  test("a stored channel: the team it was stored with", () => {
    expect(
      MattermostTeams.getTeamIdOfStoredChannel({
        projectAuth: movedDefault,
        teamId: PLATFORM,
      }),
    ).toBe(PLATFORM);
  });

  test("a stored channel that names no team is in the team the project was connected to, whichever is the default now", () => {
    expect(
      MattermostTeams.getTeamIdOfStoredChannel({
        projectAuth: movedDefault,
        teamId: undefined,
      }),
    ).toBe(ENGINEERING);
  });

  test("a stored team that is not a Mattermost id names no team", () => {
    expect(
      MattermostTeams.getTeamIdOfStoredChannel({
        projectAuth: movedDefault,
        teamId: "../evil",
      }),
    ).toBe(ENGINEERING);
    expect(
      MattermostTeams.getTeamIdOfStoredChannel({
        projectAuth: null,
        teamId: "../evil",
      }),
    ).toBeUndefined();
  });

  test("the name in a stored channel's address: its team's, as the connection lists it", () => {
    expect(
      MattermostTeams.getTeamNameOfChannel({
        projectAuth: movedDefault,
        teamId: SUPPORT,
      }),
    ).toBe("support");
    expect(
      MattermostTeams.getTeamNameOfChannel({
        projectAuth: movedDefault,
        teamId: undefined,
      }),
    ).toBe("engineering");
  });

  test("a stored channel of a team the connection does not list has no address", () => {
    expect(
      MattermostTeams.getTeamNameOfChannel({
        projectAuth: movedDefault,
        teamId: FINANCE,
      }),
    ).toBe("");
    expect(
      MattermostTeams.getTeamNameOfChannel({
        projectAuth: null,
        teamId: SUPPORT,
      }),
    ).toBe("");
  });

  test("getTeam: a listed team by its id, the default for none", () => {
    const teams: MattermostTeamsOfConnection = read(movedDefault);

    expect(MattermostTeams.getTeam({ connection: teams })).toEqual(support);
    expect(
      MattermostTeams.getTeam({ connection: teams, teamId: ENGINEERING }),
    ).toEqual(engineering);
    expect(
      MattermostTeams.getTeam({ connection: teams, teamId: FINANCE }),
    ).toBeUndefined();
  });
});

describe("isFresh: teams listed less than ten minutes ago", () => {
  test.each<[string, string | undefined, boolean]>([
    ["never listed", undefined, false],
    ["listed a minute ago", minutesAgo(1), true],
    ["listed nine minutes ago", minutesAgo(9), true],
    ["listed eleven minutes ago", minutesAgo(11), false],
    // A clock that went back: read again rather than trusted for long.
    ["listed in the future", minutesAgo(-5), false],
  ])("%s", (_label: string, readAt: string | undefined, fresh: boolean) => {
    expect(
      MattermostTeams.isFresh(
        read(connection({ teams: [engineering], teamsReadAt: readAt })),
      ),
    ).toBe(fresh);
  });
});

describe("getOfConnection: the teams, listed again when stale", () => {
  let listTeams: SpyInstance<typeof MattermostUtil.getTeamsOfBot>;
  let keepTeams: SpyInstance<
    typeof WorkspaceProjectAuthTokenService.updateMattermostTeams
  >;

  beforeEach(() => {
    listTeams = jest
      .spyOn(MattermostUtil, "getTeamsOfBot")
      .mockResolvedValue([engineering, support]);
    keepTeams = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateMattermostTeams")
      .mockResolvedValue(undefined);
  });

  test("teams listed just now are used as stored: the server is not asked", async () => {
    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection({
          teams: [engineering],
          teamsReadAt: minutesAgo(2),
        }),
      });

    expect(idsOf(teams!.teams)).toEqual([ENGINEERING]);
    expect(listTeams).not.toHaveBeenCalled();
    expect(keepTeams).not.toHaveBeenCalled();
  });

  test("teams listed long ago, or never: the server is asked with the bot's token, and the teams kept", async () => {
    for (const teamsReadAt of [minutesAgo(30), undefined]) {
      listTeams.mockClear();
      keepTeams.mockClear();

      const teams: MattermostTeamsOfConnection | null =
        await MattermostTeams.getOfConnection({
          projectId: PROJECT_ID,
          projectAuth: connection({
            teams: [engineering],
            teamsReadAt: teamsReadAt,
          }),
        });

      expect(idsOf(teams!.teams)).toEqual([ENGINEERING, SUPPORT]);
      expect(MattermostTeams.isFresh(teams!)).toBe(true);
      expect(listTeams).toHaveBeenCalledWith({
        serverUrl: "https://chat.example.com",
        accessToken: ACCESS_TOKEN,
      });
      expect(keepTeams).toHaveBeenCalledTimes(1);
      expect(keepTeams.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT_ID,
        workspaceProjectId: ENGINEERING,
        teams: [engineering, support],
      });
    }
  });

  test("refresh: asked even when listed just now", async () => {
    await MattermostTeams.getOfConnection({
      projectId: PROJECT_ID,
      projectAuth: connection({
        teams: [engineering],
        teamsReadAt: minutesAgo(1),
      }),
      refresh: true,
    });

    expect(listTeams).toHaveBeenCalledTimes(1);
  });

  test("a server that does not answer: the teams it listed last, never an error", async () => {
    listTeams.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection({
          teams: [engineering, platform],
          teamsReadAt: minutesAgo(30),
        }),
      });

    expect(idsOf(teams!.teams)).toEqual([ENGINEERING, PLATFORM]);
    expect(keepTeams).not.toHaveBeenCalled();
  });

  test("teams that could not be kept are still used", async () => {
    keepTeams.mockRejectedValue(new Error("database down"));

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection({ teams: [engineering] }),
      });

    expect(idsOf(teams!.teams)).toEqual([ENGINEERING, SUPPORT]);
  });

  test("a bot taken out of the default team: listed, and said", async () => {
    listTeams.mockResolvedValue([support]);

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection({ teams: [engineering, support] }),
      });

    expect(teams!.defaultTeam.id).toBe(ENGINEERING);
    expect(teams!.isBotInDefaultTeam).toBe(false);
  });

  test("no connection, or one without its token: nothing is asked of any server", async () => {
    expect(
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: null,
      }),
    ).toBeNull();

    const withoutToken: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection({ teams: [engineering] }, { authToken: "" }),
        refresh: true,
      });

    expect(idsOf(withoutToken!.teams)).toEqual([ENGINEERING]);
    expect(listTeams).not.toHaveBeenCalled();
  });

  test("a token that is not a Mattermost connection: the teams as stored", async () => {
    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfConnection({
        projectId: PROJECT_ID,
        projectAuth: connection(
          { teams: [engineering] },
          { authToken: "xoxb-not-mattermost" },
        ),
        refresh: true,
      });

    expect(idsOf(teams!.teams)).toEqual([ENGINEERING]);
    expect(listTeams).not.toHaveBeenCalled();
  });
});

describe("listNow: what a member's Refresh asks for", () => {
  test("what the server answered is thrown, for the member to be told", async () => {
    jest
      .spyOn(MattermostUtil, "getTeamsOfBot")
      .mockRejectedValue(new Error("Mattermost did not accept the token."));
    const keepTeams: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.updateMattermostTeams
    > = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateMattermostTeams")
      .mockResolvedValue(undefined);

    await expect(
      MattermostTeams.listNow({
        projectId: PROJECT_ID,
        projectAuth: connection({ teams: [engineering] }),
      }),
    ).rejects.toThrow("Mattermost did not accept the token.");
    expect(keepTeams).not.toHaveBeenCalled();
  });

  test("a connection that names no team lists nothing", async () => {
    const listTeams: SpyInstance<typeof MattermostUtil.getTeamsOfBot> = jest
      .spyOn(MattermostUtil, "getTeamsOfBot")
      .mockResolvedValue([engineering]);

    expect(
      await MattermostTeams.listNow({
        projectId: PROJECT_ID,
        projectAuth: connection(undefined, { workspaceProjectId: "" }),
      }),
    ).toBeNull();
    expect(listTeams).not.toHaveBeenCalled();
  });
});

describe("getOfProject: the project's own connection", () => {
  test("read by the project and Mattermost", async () => {
    const getProjectAuth: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        connection({ teams: [engineering], teamsReadAt: minutesAgo(1) }),
      );

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.getOfProject({ projectId: PROJECT_ID });

    expect(getProjectAuth).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Mattermost,
    });
    expect(teams?.defaultTeam).toEqual(engineering);
  });

  test("a connection that cannot be read is none, never an error", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockRejectedValue(new Error("database down"));

    expect(
      await MattermostTeams.getOfProject({ projectId: PROJECT_ID }),
    ).toBeNull();
  });
});

/*
 * #6775: THE TEAMS THE BOT WAS TAKEN OUT OF, BY THE NAMES THEY HAD.
 *
 * A rule that names a team the server no longer lists the bot in posts in
 * no other team instead, and its card says so by the team's name - which
 * the server, asked as the bot, no longer tells. So a team the server
 * listed before and lists no more is kept by its name (removedTeams), the
 * latest first, until the bot is added to it again.
 */

const finance: MattermostConnectionTeam = {
  id: FINANCE,
  name: "finance",
  displayName: "Finance",
};

describe("removedTeams: the teams the bot was taken out of, as stored", () => {
  test("by the names they had, the latest first; none the bot is in now, nor the default team, which isBotInDefaultTeam tells", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({
        teams: [support],
        teamsReadAt: minutesAgo(1),
        removedTeams: [platform, engineering, support, finance],
      }),
    );

    expect(teams.removedTeams).toEqual([platform, finance]);
    expect(teams.isBotInDefaultTeam).toBe(false);
  });

  test("what is not a team is left out: an id Mattermost did not make, one twice, not an object", () => {
    const teams: MattermostTeamsOfConnection = read(
      connection({
        teams: [engineering],
        removedTeams: [
          { id: "../users/me", name: "evil", displayName: "Evil" },
          platform,
          { ...platform, displayName: "Platform again" },
          null as unknown as MattermostConnectionTeam,
          "finance" as unknown as MattermostConnectionTeam,
          { id: FINANCE, name: "finance" } as MattermostConnectionTeam,
        ],
      }),
    );

    expect(teams.removedTeams).toEqual([
      platform,
      { id: FINANCE, name: "finance", displayName: "finance" },
    ]);
  });

  test("a connection that kept none, or a list that is not one: none", () => {
    expect(read(connection({ teams: [engineering] })).removedTeams).toEqual([]);
    expect(
      read(
        connection({
          teams: [engineering],
          removedTeams: "support" as unknown as Array<MattermostConnectionTeam>,
        }),
      ).removedTeams,
    ).toEqual([]);
  });
});

describe("getRemovedTeams: what the server stopped listing", () => {
  test("those listed before and not now, then those removed before - each once, by the name it had, none listed now", () => {
    expect(
      MattermostTeams.getRemovedTeams({
        listedBefore: [engineering, support, platform],
        removedBefore: [finance, support, engineering],
        listedNow: [engineering],
      }),
    ).toEqual([support, platform, finance]);
  });

  test("the bot added to a team again: no longer among them", () => {
    expect(
      MattermostTeams.getRemovedTeams({
        listedBefore: [engineering],
        removedBefore: [support],
        listedNow: [engineering, support],
      }),
    ).toEqual([]);
  });

  test("a team without a display name keeps its name; one that is not a Mattermost id is not kept", () => {
    expect(
      MattermostTeams.getRemovedTeams({
        listedBefore: [
          { id: SUPPORT, name: "support", displayName: "" },
          { id: "../users/me", name: "evil", displayName: "Evil" },
        ],
        removedBefore: [],
        listedNow: [],
      }),
    ).toEqual([{ id: SUPPORT, name: "support", displayName: "support" }]);
  });

  test("at most MAX_REMOVED_TEAMS, the latest kept", () => {
    const team: (index: number) => MattermostConnectionTeam = (
      index: number,
    ): MattermostConnectionTeam => {
      return {
        id: ("x".repeat(26) + index.toString()).slice(-26),
        name: `team-${index}`,
        displayName: `Team ${index}`,
      };
    };

    const removedBefore: Array<MattermostConnectionTeam> = [];

    for (let index: number = 0; index < 60; index++) {
      removedBefore.push(team(index));
    }

    const removed: Array<MattermostConnectionTeam> =
      MattermostTeams.getRemovedTeams({
        listedBefore: [support],
        removedBefore: removedBefore,
        listedNow: [],
      });

    expect(MattermostTeams.MAX_REMOVED_TEAMS).toBe(50);
    expect(removed).toHaveLength(50);
    expect(removed[0]).toEqual(support);
    expect(removed[49]).toEqual(team(48));
  });
});

describe("listNow: a team the server stops listing is kept by its name", () => {
  let listTeams: SpyInstance<typeof MattermostUtil.getTeamsOfBot>;
  let keepTeams: SpyInstance<
    typeof WorkspaceProjectAuthTokenService.updateMattermostTeams
  >;

  beforeEach(() => {
    listTeams = jest.spyOn(MattermostUtil, "getTeamsOfBot");
    keepTeams = jest
      .spyOn(WorkspaceProjectAuthTokenService, "updateMattermostTeams")
      .mockResolvedValue(undefined);
  });

  test("with those kept before, the latest first: kept for the next time, and said", async () => {
    listTeams.mockResolvedValue([engineering]);

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.listNow({
        projectId: PROJECT_ID,
        projectAuth: connection({
          teams: [engineering, support],
          teamsReadAt: minutesAgo(30),
          removedTeams: [platform],
        }),
      });

    expect(teams!.removedTeams).toEqual([support, platform]);
    expect(keepTeams.mock.calls[0]![0]).toMatchObject({
      teams: [engineering],
      removedTeams: [support, platform],
    });
  });

  test("the bot added to a team again: no longer kept as one it was taken out of", async () => {
    listTeams.mockResolvedValue([engineering, support]);

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.listNow({
        projectId: PROJECT_ID,
        projectAuth: connection({
          teams: [engineering],
          removedTeams: [support, platform],
        }),
      });

    expect(teams!.removedTeams).toEqual([platform]);
    expect(keepTeams.mock.calls[0]![0]).toMatchObject({
      removedTeams: [platform],
    });
  });

  test("the default team the bot was taken out of is kept by its name too, for when another team is made the default", async () => {
    listTeams.mockResolvedValue([support]);

    const teams: MattermostTeamsOfConnection | null =
      await MattermostTeams.listNow({
        projectId: PROJECT_ID,
        projectAuth: connection({ teams: [engineering, support] }),
      });

    expect(keepTeams.mock.calls[0]![0]).toMatchObject({
      removedTeams: [engineering],
    });
    // Still the default, and said so by isBotInDefaultTeam.
    expect(teams!.isBotInDefaultTeam).toBe(false);
    expect(teams!.removedTeams).toEqual([]);

    // Support made the default since: Engineering is a team the bot left.
    expect(
      read(
        connection({
          teamId: SUPPORT,
          teamName: "support",
          teams: [support],
          removedTeams: [engineering],
        }),
      ).removedTeams,
    ).toEqual([engineering]);
  });
});
