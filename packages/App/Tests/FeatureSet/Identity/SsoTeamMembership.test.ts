import { beforeEach, describe, expect, test } from "@jest/globals";
import SsoTeamMembership, {
  SSO_NO_ROOM_ERROR,
  SSO_NO_ROOM_MESSAGE,
  SSO_NO_ROOM_TITLE,
  SsoTeamMembershipOutcome,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import AuditLogService from "Common/Server/Services/AuditLogService";
import Errors from "Common/Server/Utils/Errors";
import logger from "Common/Server/Utils/Logger";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";

/*
 * ---------------------------------------------------------------------------
 * ADDING SOMEONE WHO SIGNS IN THROUGH SINGLE SIGN-ON TO A PROJECT'S TEAMS.
 *
 * Every sign-in that adds people through a provider - a project's SAML or
 * OIDC provider, its emailed confirmation, an instance-wide provider
 * attached to projects - adds them through SsoTeamMembership.addToTeams.
 * These pin what it writes (each team, accepted, as OneUptime's own write
 * with the create hooks skipped - the seat limit is decided with the
 * INSERT whatever the hooks), and how it answers: Added, NoRoom when the
 * project has no room for one more person (they are then in none of its
 * teams), and any other failure thrown as it came.
 * ---------------------------------------------------------------------------
 */

const teamMemberCreate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return teamMemberCreate(...args);
      },
    },
  };
});

/*
 * Which of the teams handed are the project's own (#11149): by default
 * every one of them (./SsoProjectTeamsStandIn); a test names the others.
 */
const teamFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return teamFindBy(...args);
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "72000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72000000-0000-4000-8000-000000000002");
const TEAM_IDS: Array<ObjectID> = [
  new ObjectID("72000000-0000-4000-8000-000000000003"),
  new ObjectID("72000000-0000-4000-8000-000000000004"),
  new ObjectID("72000000-0000-4000-8000-000000000005"),
];

function teams(): Array<Team> {
  return TEAM_IDS.map((id: ObjectID): Team => {
    return new Team(id);
  });
}

async function addToTeams(): Promise<SsoTeamMembershipOutcome> {
  return await SsoTeamMembership.addToTeams({
    projectId: PROJECT_ID,
    userId: USER_ID,
    teams: teams(),
  });
}

let recordCreate: jest.SpyInstance;
let warn: jest.SpyInstance;
let order: Array<string>;

// The teams the stand-in says are not the project's: another's, or deleted.
let notTheProjects: Array<string> = [];

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  order = [];
  notTheProjects = [];
  teamFindBy.mockImplementation(
    (findBy: { query: Record<string, unknown> }): Promise<Array<unknown>> => {
      const standIn: typeof import("./SsoProjectTeamsStandIn") =
        jest.requireActual("./SsoProjectTeamsStandIn");

      return Promise.resolve(
        standIn
          .readQueriedIds(findBy.query["_id"])
          .filter((id: string): boolean => {
            return !notTheProjects.includes(id.toLowerCase());
          })
          .map((id: string): unknown => {
            return { _id: id, projectId: findBy.query["projectId"] };
          }),
      );
    },
  );
  warn = jest.spyOn(logger, "warn").mockImplementation((): never => {
    return undefined as never;
  });
  teamMemberCreate.mockImplementation(
    async (createBy: { data: TeamMember }): Promise<TeamMember> => {
      order.push(`joined ${createBy.data.teamId?.toString()}`);
      return createBy.data;
    },
  );
  recordCreate = jest
    .spyOn(AuditLogService, "recordCreate")
    .mockImplementation(
      async (data: { createdItem: TeamMember }): Promise<void> => {
        order.push(`recorded ${data.createdItem.teamId?.toString()}`);
      },
    );
});

describe("SsoTeamMembership.addToTeams", () => {
  test("adds the person to every team, in order, accepted, as OneUptime's own write", async () => {
    const before: number = Date.now();

    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(teamMemberCreate).toHaveBeenCalledTimes(TEAM_IDS.length);

    teamMemberCreate.mock.calls.forEach(
      (call: Array<unknown>, index: number): void => {
        const createBy: {
          data: Record<string, unknown>;
          props: Record<string, unknown>;
        } = call[0] as {
          data: Record<string, unknown>;
          props: Record<string, unknown>;
        };

        expect(String(createBy.data["projectId"])).toBe(PROJECT_ID.toString());
        expect(String(createBy.data["userId"])).toBe(USER_ID.toString());
        expect(String(createBy.data["teamId"])).toBe(
          TEAM_IDS[index]!.toString(),
        );
        expect(createBy.data["hasAcceptedInvitation"]).toBe(true);
        expect(
          (createBy.data["invitationAcceptedAt"] as Date).getTime(),
        ).toBeGreaterThanOrEqual(before);

        // OneUptime's own write; the seat limit holds with hooks skipped too.
        expect(createBy.props).toEqual({ isRoot: true, ignoreHooks: true });
      },
    );
  });

  test.each([
    ["every seat of its plan taken", Errors.TeamMemberService.LIMIT_REACHED],
    [
      "the Free plan's one person there already",
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    ],
  ])(
    "%s: NoRoom, and no other team is asked",
    async (_label: string, refusal: string) => {
      teamMemberCreate.mockRejectedValueOnce(new BadDataException(refusal));

      await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.NoRoom);
      expect(teamMemberCreate).toHaveBeenCalledTimes(1);
    },
  );

  test("any other failure is thrown as it came", async () => {
    for (const failure of [
      new BadDataException(Errors.TeamMemberService.ALREADY_INVITED),
      new BadDataException("Invalid Team ID"),
      new Error(Errors.TeamMemberService.LIMIT_REACHED),
    ]) {
      teamMemberCreate.mockReset();
      teamMemberCreate.mockRejectedValueOnce(failure);

      await expect(addToTeams()).rejects.toBe(failure);
    }
  });

  test("a failure after the first team is thrown too: only a refusal of the newcomer is NoRoom", async () => {
    const failure: BadDataException = new BadDataException("Invalid Team ID");

    teamMemberCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(failure);

    await expect(addToTeams()).rejects.toBe(failure);
    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
  });

  test("a refusal once a team has taken them is not NoRoom: they are in the project, so it is thrown", async () => {
    const refusal: BadDataException = new BadDataException(
      Errors.TeamMemberService.LIMIT_REACHED,
    );

    teamMemberCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(refusal);

    await expect(addToTeams()).rejects.toBe(refusal);
    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
  });

  test("no teams: NoTeams, nothing read and nothing written", async () => {
    for (const none of [[], null, undefined]) {
      await expect(
        SsoTeamMembership.addToTeams({
          projectId: PROJECT_ID,
          userId: USER_ID,
          teams: none,
        }),
      ).resolves.toBe(SsoTeamMembershipOutcome.NoTeams);
    }

    expect(teamFindBy).not.toHaveBeenCalled();
    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(recordCreate).not.toHaveBeenCalled();
  });
});

/*
 * A sign-in through one project's provider never reaches another project
 * (#11149). A provider's teams are held to its project when it is saved,
 * but one saved before that rule kept its teams, and a team can be deleted
 * after it was picked. A membership of this project in a team of another
 * would put the person on that team's on-call and notifications, which
 * read a team's members by the team alone.
 */
describe("only the project's own teams take them", () => {
  test("reads the teams by their ids and the project, once, as OneUptime's own read", async () => {
    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(teamFindBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = teamFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    const standIn: typeof import("./SsoProjectTeamsStandIn") =
      jest.requireActual("./SsoProjectTeamsStandIn");

    expect(standIn.readQueriedIds(findBy.query["_id"])).toEqual(
      TEAM_IDS.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    expect(String(findBy.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("a team that is not the project's is left out, the rest are joined in order, and the server's log says so without naming anyone", async () => {
    notTheProjects = [TEAM_IDS[1]!.toString()];

    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(order).toEqual([
      `joined ${TEAM_IDS[0]!.toString()}`,
      `recorded ${TEAM_IDS[0]!.toString()}`,
      `joined ${TEAM_IDS[2]!.toString()}`,
      `recorded ${TEAM_IDS[2]!.toString()}`,
    ]);

    expect(warn).toHaveBeenCalledTimes(1);

    const line: string = String(warn.mock.calls[0]![0]);

    expect(line).toContain(PROJECT_ID.toString());
    expect(line).toContain("1 team(s) that are not teams of the project");
    expect(line).not.toContain(USER_ID.toString());
  });

  test("none of them the project's: NoTeams, and nothing is written or recorded", async () => {
    notTheProjects = TEAM_IDS.map((id: ObjectID): string => {
      return id.toString();
    });

    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.NoTeams);

    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(recordCreate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a team named twice, in any case, is joined once", async () => {
    await expect(
      SsoTeamMembership.addToTeams({
        projectId: PROJECT_ID,
        userId: USER_ID,
        teams: [
          new Team(TEAM_IDS[0]!),
          new Team(new ObjectID(TEAM_IDS[0]!.toString().toUpperCase())),
          new Team(TEAM_IDS[1]!),
        ],
      }),
    ).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(order).toEqual([
      `joined ${TEAM_IDS[0]!.toString()}`,
      `recorded ${TEAM_IDS[0]!.toString()}`,
      `joined ${TEAM_IDS[1]!.toString()}`,
      `recorded ${TEAM_IDS[1]!.toString()}`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("getProjectTeams keeps the project's own, in the order handed, and reads nothing for none", async () => {
    notTheProjects = [TEAM_IDS[0]!.toString()];

    const kept: Array<Team> = await SsoTeamMembership.getProjectTeams({
      projectId: PROJECT_ID,
      teams: [...teams()].reverse(),
    });

    expect(
      kept.map((team: Team): string => {
        return team.id!.toString();
      }),
    ).toEqual([TEAM_IDS[2]!.toString(), TEAM_IDS[1]!.toString()]);

    teamFindBy.mockClear();

    for (const none of [[], null, undefined]) {
      await expect(
        SsoTeamMembership.getProjectTeams({
          projectId: PROJECT_ID,
          teams: none,
        }),
      ).resolves.toEqual([]);
    }

    expect(teamFindBy).not.toHaveBeenCalled();
  });
});

/*
 * Joining a team through SSO sign-in, in the audit log (issue #6285). The
 * create skips its hooks, and DatabaseService records no create that does,
 * so a team's Audit Logs never showed who joined it this way. Each join now
 * records its own Create entry, by the person who signed in.
 */
describe("each team joined through SSO sign-in is in the audit log", () => {
  interface RecordedCreate {
    model: TeamMember;
    createdItem: TeamMember;
    props: DatabaseCommonInteractionProps;
  }

  function recorded(): Array<RecordedCreate> {
    return recordCreate.mock.calls.map(
      (call: Array<unknown>): RecordedCreate => {
        return call[0] as RecordedCreate;
      },
    );
  }

  test("a Create entry for each team, by the person who signed in, once they are in it", async () => {
    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(order).toEqual(
      TEAM_IDS.flatMap((id: ObjectID): Array<string> => {
        return [`joined ${id.toString()}`, `recorded ${id.toString()}`];
      }),
    );

    recorded().forEach((entry: RecordedCreate, index: number): void => {
      expect(entry.model).toBeInstanceOf(TeamMember);
      expect(entry.createdItem.teamId?.toString()).toBe(
        TEAM_IDS[index]!.toString(),
      );
      expect(entry.createdItem.userId?.toString()).toBe(USER_ID.toString());
      expect(entry.createdItem.projectId?.toString()).toBe(
        PROJECT_ID.toString(),
      );
      // Theirs, so recorded whether or not the project stores system events.
      expect(entry.props).toEqual({
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
      });
    });
  });

  test("a project with no room records no join", async () => {
    teamMemberCreate.mockRejectedValueOnce(
      new BadDataException(Errors.TeamMemberService.LIMIT_REACHED),
    );

    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.NoRoom);
    expect(recordCreate).not.toHaveBeenCalled();
  });

  test("a failure part way records the teams joined, and only those", async () => {
    teamMemberCreate
      .mockImplementationOnce(
        async (createBy: { data: TeamMember }): Promise<TeamMember> => {
          return createBy.data;
        },
      )
      .mockRejectedValueOnce(new BadDataException("Invalid Team ID"));

    await expect(addToTeams()).rejects.toThrow("Invalid Team ID");
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]!.createdItem.teamId?.toString()).toBe(
      TEAM_IDS[0]!.toString(),
    );
  });

  test("the props of a join name the person, and grant nothing", () => {
    expect(SsoTeamMembership.getJoinProps(USER_ID)).toEqual({
      isRoot: true,
      userId: USER_ID,
      userType: UserType.User,
    });
  });
});

describe("what the person signing in is told", () => {
  test("a title, a sentence for them, and a reason code for the mobile app", () => {
    expect(SSO_NO_ROOM_TITLE).toBe("No room in this project.");
    expect(SSO_NO_ROOM_MESSAGE).toBe(
      "This project's plan has no room for another person, so you were not added to it. Ask an admin of the project to free a seat or change its plan, then sign in again.",
    );
    expect(SSO_NO_ROOM_ERROR).toBe("sso_project_full");
  });

  test("not the refusal written for whoever invites", () => {
    for (const refusal of [
      Errors.TeamMemberService.LIMIT_REACHED,
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    ]) {
      expect(SSO_NO_ROOM_MESSAGE).not.toBe(refusal);
    }

    expect(SSO_NO_ROOM_MESSAGE).not.toContain("invite");
    expect(SSO_NO_ROOM_MESSAGE).not.toContain("billing@");
  });
});
