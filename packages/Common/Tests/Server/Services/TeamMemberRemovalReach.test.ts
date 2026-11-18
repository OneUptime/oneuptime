import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ReadableTeamNames from "../../../Server/Utils/Team/ReadableTeamNames";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHOM A CALLER'S REMOVE FROM PROJECT WOULD LEAVE IN THE PROJECT (#6599).
 *
 * TeamMemberService.getTeamsOutOfRemovalReach reads a page of people the
 * way assertCallerMayRemoveUserFromProject reads one: their memberships as
 * OneUptime, then the ones the caller's own delete reaches
 * (ModelPermission.checkDeleteQueryPermission). Someone with a membership
 * out of reach is named, with its team; everyone else is not. The Users
 * list locks Remove from Project on exactly those people.
 *
 * ReadableTeamNames names a team only for a reader who may read it.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "6e100000-0000-4000-8000-000000000001",
);
const GRACE: ObjectID = new ObjectID("6e200000-0000-4000-8000-000000000001");
const ALAN: ObjectID = new ObjectID("6e200000-0000-4000-8000-000000000002");
const ADA: ObjectID = new ObjectID("6e200000-0000-4000-8000-000000000003");
const MINE: ObjectID = new ObjectID("6e300000-0000-4000-8000-000000000001");
const PLATFORM: ObjectID = new ObjectID("6e300000-0000-4000-8000-000000000002");
const SECURITY: ObjectID = new ObjectID("6e300000-0000-4000-8000-000000000003");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("6e400000-0000-4000-8000-000000000001"),
  tenantId: PROJECT_ID,
};

// What checkDeleteQueryPermission hands back: the reached memberships' query.
const REACHED: Record<string, unknown> = { reached: true };

let membershipNumber: number = 0;

function membership(userId: ObjectID, teamId: ObjectID | null): TeamMember {
  membershipNumber += 1;

  const member: TeamMember = new TeamMember();
  member._id = `6e500000-0000-4000-8000-${membershipNumber
    .toString()
    .padStart(12, "0")}`;
  member.userId = userId;

  if (teamId) {
    member.teamId = teamId;
  }

  return member;
}

/*
 * The memberships OneUptime reads, and the ones the caller's delete
 * reaches: two findBy reads, told apart by the query they are handed.
 */
function memberships(data: {
  all: Array<TeamMember>;
  reached: Array<TeamMember>;
}): {
  findSpy: SpyInstance<typeof TeamMemberService.findBy>;
  narrowSpy: SpyInstance<typeof ModelPermission.checkDeleteQueryPermission>;
} {
  const narrowSpy: SpyInstance<
    typeof ModelPermission.checkDeleteQueryPermission
  > = jest
    .spyOn(ModelPermission, "checkDeleteQueryPermission")
    .mockResolvedValue(REACHED as never);

  const findSpy: SpyInstance<typeof TeamMemberService.findBy> = jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((async (args: { query: unknown }) => {
      return args.query === REACHED ? data.reached : data.all;
    }) as never);

  return { findSpy, narrowSpy };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getTeamsOutOfRemovalReach", () => {
  test("names someone also in a team the caller's delete does not reach, with that team, and says the caller reaches one of theirs", async () => {
    const mine: TeamMember = membership(GRACE, MINE);
    memberships({
      all: [mine, membership(GRACE, PLATFORM)],
      reached: [mine],
    });

    const people: Awaited<
      ReturnType<typeof TeamMemberService.getTeamsOutOfRemovalReach>
    > = await TeamMemberService.getTeamsOutOfRemovalReach({
      userIds: [GRACE],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(people).toHaveLength(1);
    expect(people[0]!.userId.toString()).toBe(GRACE.toString());
    expect(
      people[0]!.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([PLATFORM.toString()]);
    expect(people[0]!.hasTeamInReach).toBe(true);
    expect(people[0]!.membershipsWithoutTeam).toBe(0);
  });

  test("leaves out someone whose every membership the caller reaches", async () => {
    const mine: TeamMember = membership(ALAN, MINE);
    const platform: TeamMember = membership(ALAN, PLATFORM);
    memberships({ all: [mine, platform], reached: [mine, platform] });

    await expect(
      TeamMemberService.getTeamsOutOfRemovalReach({
        userIds: [ALAN],
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ).resolves.toEqual([]);
  });

  test("says when the caller reaches none of their teams", async () => {
    memberships({
      all: [membership(ADA, PLATFORM), membership(ADA, SECURITY)],
      reached: [],
    });

    const people: Awaited<
      ReturnType<typeof TeamMemberService.getTeamsOutOfRemovalReach>
    > = await TeamMemberService.getTeamsOutOfRemovalReach({
      userIds: [ADA],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(people).toHaveLength(1);
    expect(people[0]!.hasTeamInReach).toBe(false);
    expect(
      people[0]!.teamIds
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    ).toEqual([PLATFORM.toString(), SECURITY.toString()].sort());
  });

  test("answers a whole page at once, person by person, each team once", async () => {
    const graceMine: TeamMember = membership(GRACE, MINE);
    const alanMine: TeamMember = membership(ALAN, MINE);
    memberships({
      all: [
        graceMine,
        membership(GRACE, PLATFORM),
        membership(GRACE, PLATFORM),
        alanMine,
        membership(ADA, SECURITY),
      ],
      reached: [graceMine, alanMine],
    });

    const people: Awaited<
      ReturnType<typeof TeamMemberService.getTeamsOutOfRemovalReach>
    > = await TeamMemberService.getTeamsOutOfRemovalReach({
      userIds: [GRACE, ALAN, ADA],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    const byUser: Record<string, Array<string>> = {};

    for (const person of people) {
      byUser[person.userId.toString()] = person.teamIds.map(
        (id: ObjectID): string => {
          return id.toString();
        },
      );
    }

    expect(byUser).toEqual({
      [GRACE.toString()]: [PLATFORM.toString()],
      [ADA.toString()]: [SECURITY.toString()],
    });
  });

  test("counts a membership out of reach that names no team, as the removal's check counts it", async () => {
    memberships({ all: [membership(GRACE, null)], reached: [] });

    const people: Awaited<
      ReturnType<typeof TeamMemberService.getTeamsOutOfRemovalReach>
    > = await TeamMemberService.getTeamsOutOfRemovalReach({
      userIds: [GRACE],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(people).toHaveLength(1);
    expect(people[0]!.teamIds).toEqual([]);
    expect(people[0]!.membershipsWithoutTeam).toBe(1);
  });

  test("reads the memberships as OneUptime, then those the caller's own delete reaches, by the same query", async () => {
    const { findSpy, narrowSpy } = memberships({ all: [], reached: [] });

    await TeamMemberService.getTeamsOutOfRemovalReach({
      userIds: [GRACE, ALAN],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(narrowSpy).toHaveBeenCalledTimes(1);
    const narrowed: Array<unknown> = narrowSpy.mock.calls[0] as Array<unknown>;
    const query: Record<string, unknown> = narrowed[1] as Record<
      string,
      unknown
    >;

    expect(narrowed[0]).toBe(TeamMember);
    expect(Object.keys(query).sort()).toEqual(["projectId", "userId"]);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(narrowed[2]).toBe(CALLER);

    expect(findSpy).toHaveBeenCalledTimes(2);
    const reads: Array<{ query: unknown; props: unknown }> = (
      findSpy.mock.calls as Array<Array<unknown>>
    ).map((call: Array<unknown>) => {
      return call[0] as { query: unknown; props: unknown };
    });

    // The first read is the same query the narrowing was handed.
    expect(reads[0]!.query).toBe(query);
    expect(reads[1]!.query).toBe(REACHED);

    for (const read of reads) {
      expect(read.props).toEqual({ isRoot: true });
    }
  });

  test("a caller who may delete no membership at all is refused by the permission check itself, as the removal is", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to delete Team Member.",
    );

    memberships({ all: [], reached: [] }).narrowSpy.mockRejectedValue(
      refusal as never,
    );

    await expect(
      TeamMemberService.getTeamsOutOfRemovalReach({
        userIds: [GRACE],
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ).rejects.toBe(refusal);
  });

  test("OneUptime's own reads and a master admin's name nobody, and read nothing", async () => {
    const { findSpy, narrowSpy } = memberships({
      all: [membership(GRACE, PLATFORM)],
      reached: [],
    });

    for (const props of [
      { isRoot: true },
      { ...CALLER, isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        TeamMemberService.getTeamsOutOfRemovalReach({
          userIds: [GRACE],
          projectId: PROJECT_ID,
          props: props,
        }),
      ).resolves.toEqual([]);
    }

    expect(findSpy).not.toHaveBeenCalled();
    expect(narrowSpy).not.toHaveBeenCalled();
  });

  test("nobody asked about reads nothing", async () => {
    const { findSpy } = memberships({ all: [], reached: [] });

    await expect(
      TeamMemberService.getTeamsOutOfRemovalReach({
        userIds: [],
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ).resolves.toEqual([]);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("agrees with the removal's own check: refused exactly when someone is named", async () => {
    for (const reachedCount of [0, 1, 2]) {
      jest.restoreAllMocks();

      const all: Array<TeamMember> = [
        membership(GRACE, MINE),
        membership(GRACE, PLATFORM),
      ];

      memberships({ all: all, reached: all.slice(0, reachedCount) });
      jest
        .spyOn(TeamMemberService, "countBy")
        .mockImplementation((async (args: { query: unknown }) => {
          return new PositiveNumber(
            args.query === REACHED ? reachedCount : all.length,
          );
        }) as never);

      const named: number = (
        await TeamMemberService.getTeamsOutOfRemovalReach({
          userIds: [GRACE],
          projectId: PROJECT_ID,
          props: CALLER,
        })
      ).length;

      let refused: boolean = false;

      try {
        await TeamMemberService.assertCallerMayRemoveUserFromProject({
          userId: GRACE,
          projectId: PROJECT_ID,
          props: CALLER,
        });
      } catch {
        refused = true;
      }

      expect({ reachedCount, named: named > 0 }).toEqual({
        reachedCount,
        named: refused,
      });
    }
  });
});

describe("ReadableTeamNames", () => {
  function team(id: ObjectID, name: string): Team {
    const found: Team = new Team();
    found._id = id.toString();
    found.name = name;
    return found;
  }

  test("names the teams the reader may read, by id, read with the reader's own permissions in the project", async () => {
    const findSpy: SpyInstance<typeof TeamService.findBy> = jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([team(PLATFORM, " Platform ")]);

    const names: Map<string, string> = await ReadableTeamNames.read({
      teamIds: [PLATFORM, SECURITY, PLATFORM],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(Array.from(names.entries())).toEqual([
      [PLATFORM.toString().toLowerCase(), "Platform"],
    ]);

    expect(findSpy).toHaveBeenCalledTimes(1);
    const read: {
      query: Record<string, unknown>;
      props: unknown;
      limit: number;
    } = findSpy.mock.calls[0]![0] as unknown as {
      query: Record<string, unknown>;
      props: unknown;
      limit: number;
    };

    expect(read.props).toBe(CALLER);
    expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
    // Each team asked once.
    expect(read.limit).toBe(2);
  });

  test("a team that came back without a name, or one nobody asked about, is not named", async () => {
    jest
      .spyOn(TeamService, "findBy")
      .mockResolvedValue([team(PLATFORM, "  "), team(MINE, "Mine")]);

    const names: Map<string, string> = await ReadableTeamNames.read({
      teamIds: [PLATFORM],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(names.size).toBe(0);
  });

  test.each([
    ["may read no team", new NotAuthorizedException("You may not read teams.")],
    ["is signed out", new NotAuthenticatedException("Sign in again.")],
  ])(
    "a reader who %s is answered with no name, never the refusal",
    async (_reader: string, refusal: Error) => {
      jest.spyOn(TeamService, "findBy").mockRejectedValue(refusal as never);

      const names: Map<string, string> = await ReadableTeamNames.read({
        teamIds: [PLATFORM],
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(names.size).toBe(0);
    },
  );

  test("any other failure is not hidden", async () => {
    const failure: Error = new Error("The database went away.");
    jest.spyOn(TeamService, "findBy").mockRejectedValue(failure as never);

    await expect(
      ReadableTeamNames.read({
        teamIds: [PLATFORM],
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ).rejects.toBe(failure);
  });

  test("no team reads nothing", async () => {
    const findSpy: SpyInstance<typeof TeamService.findBy> = jest.spyOn(
      TeamService,
      "findBy",
    );

    const names: Map<string, string> = await ReadableTeamNames.read({
      teamIds: [],
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(names.size).toBe(0);
    expect(findSpy).not.toHaveBeenCalled();
  });
});
