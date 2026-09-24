import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - owner rules never create a second owner row for a user
 * or team that already owns the resource.
 *
 * A duplicate owner is an owner listed twice and notified twice. Owner rows
 * are unique now (issue #3394), so a duplicate insert is refused rather than
 * stored - but a refused insert is an error, and a rule run meets existing
 * owners on nearly every resource it touches. That is why this filter sits in
 * front of every owner rule engine, and why the inserts that follow it treat
 * "already an owner" as done rather than as a failure.
 *
 * The owner sets are saved configuration and can name a user who has left
 * the project since; createOwner skips such a user (see the last block).
 */

/*
 * Every owner user below is a project member unless a test says otherwise.
 * The membership read is TeamMemberService's; no Postgres here.
 */
let memberCheck: jest.SpyInstance;

beforeEach(() => {
  memberCheck = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const USER_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_B: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TEAM_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEAM_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function ownerUser(userId: ObjectID): MonitorOwnerUser {
  const row: MonitorOwnerUser = new MonitorOwnerUser();
  row.userId = userId;
  row.monitorId = MONITOR_ID;
  return row;
}

function ownerTeam(teamId: ObjectID): MonitorOwnerTeam {
  const row: MonitorOwnerTeam = new MonitorOwnerTeam();
  row.teamId = teamId;
  row.monitorId = MONITOR_ID;
  return row;
}

interface FakeServices {
  ownerUserService: DatabaseService<MonitorOwnerUser>;
  ownerTeamService: DatabaseService<MonitorOwnerTeam>;
  userFindBy: jest.Mock;
  teamFindBy: jest.Mock;
}

function fakeServices(data: {
  existingUsers?: Array<MonitorOwnerUser>;
  existingTeams?: Array<MonitorOwnerTeam>;
}): FakeServices {
  const userFindBy: jest.Mock = jest.fn(async () => {
    return data.existingUsers || [];
  });
  const teamFindBy: jest.Mock = jest.fn(async () => {
    return data.existingTeams || [];
  });

  return {
    ownerUserService: {
      findBy: userFindBy,
    } as unknown as DatabaseService<MonitorOwnerUser>,
    ownerTeamService: {
      findBy: teamFindBy,
    } as unknown as DatabaseService<MonitorOwnerTeam>,
    userFindBy: userFindBy,
    teamFindBy: teamFindBy,
  };
}

function ids(values: Array<ObjectID>): Array<string> {
  return values.map((value: ObjectID): string => {
    return value.toString();
  });
}

describe("OwnerRuleAssignment.getOwnersNotYetAssigned", () => {
  it("drops users and teams that already own the resource", async () => {
    const services: FakeServices = fakeServices({
      existingUsers: [ownerUser(USER_A)],
      existingTeams: [ownerTeam(TEAM_B)],
    });

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_B],
        teamIds: [TEAM_A, TEAM_B],
      });

    expect(ids(result.userIds)).toEqual([USER_B.toString()]);
    expect(ids(result.teamIds)).toEqual([TEAM_A.toString()]);
  });

  it("asks only about this resource and these owners, by the given column", async () => {
    const services: FakeServices = fakeServices({});

    await OwnerRuleAssignment.getOwnersNotYetAssigned({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      userIds: [USER_A],
      teamIds: [TEAM_A],
    });

    const userQuery: Record<string, unknown> = (
      services.userFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;
    const teamQuery: Record<string, unknown> = (
      services.teamFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(Object.keys(userQuery).sort()).toEqual(["monitorId", "userId"]);
    expect(String(userQuery["monitorId"])).toBe(MONITOR_ID.toString());
    expect(Object.keys(teamQuery).sort()).toEqual(["monitorId", "teamId"]);
  });

  it("collapses duplicates and blanks in its input", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_A.toString(), ""],
        teamIds: [TEAM_A, TEAM_A],
      });

    expect(ids(result.userIds)).toEqual([USER_A.toString()]);
    expect(ids(result.teamIds)).toEqual([TEAM_A.toString()]);
  });

  it("does not query for an empty owner set", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [],
        teamIds: [TEAM_A],
      });

    expect(services.userFindBy).not.toHaveBeenCalled();
    expect(services.teamFindBy).toHaveBeenCalledTimes(1);
    expect(result.userIds).toEqual([]);
  });

  it("returns everything when nobody owns the resource yet", async () => {
    const services: FakeServices = fakeServices({});

    const result: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: services.ownerUserService,
        ownerTeamService: services.ownerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: MONITOR_ID,
        userIds: [USER_A, USER_B],
        teamIds: [],
      });

    expect(ids(result.userIds)).toEqual([USER_A.toString(), USER_B.toString()]);
  });
});

/*
 * What an owner service's create() throws for an owner who is already there,
 * in each of the two forms it can take.
 */
function refusedByServiceCheck(): Error {
  return PostgresErrorTranslator.createUniqueViolationException(
    "This team is already an owner of this monitor.",
  );
}

function refusedByUniqueIndex(): unknown {
  // A QueryFailedError as pg reports it, before DatabaseService translates it.
  return {
    code: "23505",
    table: "MonitorOwnerTeam",
    detail:
      'Key ("monitorId", "teamId", "projectId")=(c, b, a) already exists.',
  };
}

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CREATED_BY: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface WritableServices extends FakeServices {
  createUser: jest.Mock;
  createTeam: jest.Mock;
}

function writableServices(data: {
  existingUsers?: Array<MonitorOwnerUser>;
  existingTeams?: Array<MonitorOwnerTeam>;
  // Thrown by create() for these owner ids, keyed by id string.
  userErrors?: Record<string, unknown>;
  teamErrors?: Record<string, unknown>;
}): WritableServices {
  const services: FakeServices = fakeServices(data);

  const createUser: jest.Mock = jest.fn(
    async (args: { data: MonitorOwnerUser }) => {
      const error: unknown = data.userErrors?.[args.data.userId!.toString()];
      if (error) {
        throw error;
      }
      return args.data;
    },
  );
  const createTeam: jest.Mock = jest.fn(
    async (args: { data: MonitorOwnerTeam }) => {
      const error: unknown = data.teamErrors?.[args.data.teamId!.toString()];
      if (error) {
        throw error;
      }
      return args.data;
    },
  );

  Object.assign(services.ownerUserService, {
    create: createUser,
    modelType: MonitorOwnerUser,
  });
  Object.assign(services.ownerTeamService, {
    create: createTeam,
    modelType: MonitorOwnerTeam,
  });

  return { ...services, createUser, createTeam };
}

function writtenRows<T>(create: jest.Mock): Array<T> {
  return create.mock.calls.map((call: Array<unknown>): T => {
    return (call[0] as { data: T }).data;
  });
}

describe("OwnerRuleAssignment.createOwner", () => {
  function serviceThat(create: jest.Mock): DatabaseService<MonitorOwnerTeam> {
    return { create } as unknown as DatabaseService<MonitorOwnerTeam>;
  }

  it("resolves true when the row is written, passing data and props through", async () => {
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });
    const owner: MonitorOwnerTeam = ownerTeam(TEAM_A);

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: owner,
        props: { isRoot: true },
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      data: owner,
      props: { isRoot: true },
    });
  });

  it("resolves false when the service's own check finds the owner", async () => {
    const create: jest.Mock = jest.fn(async () => {
      throw refusedByServiceCheck();
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: { isRoot: true },
      }),
    ).resolves.toBe(false);
  });

  it("resolves false when the unique index turns away a racing insert", async () => {
    const create: jest.Mock = jest.fn(async () => {
      throw refusedByUniqueIndex();
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: { isRoot: true },
      }),
    ).resolves.toBe(false);
  });

  it("resolves false for a unique violation DatabaseService already translated", async () => {
    const create: jest.Mock = jest.fn(async () => {
      throw PostgresErrorTranslator.translate(refusedByUniqueIndex());
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: { isRoot: true },
      }),
    ).resolves.toBe(false);
  });

  it.each([
    ["a generic error", new Error("connection reset")],
    ["a plain validation failure", new BadDataException("teamId is required")],
    [
      "a foreign key violation",
      {
        code: "23503",
        detail: 'Key (teamId)=(x) is not present in table "Team".',
      },
    ],
  ])("rethrows %s", async (_label: string, failure: unknown) => {
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: { isRoot: true },
      }),
    ).rejects.toBe(failure);
  });
});

describe("OwnerRuleAssignment.addOwners", () => {
  function add(
    services: WritableServices,
    overrides: Partial<{
      userIds: Array<ObjectID | string>;
      teamIds: Array<ObjectID | string>;
      isOwnerNotified: boolean | undefined;
      createdByUserId: ObjectID | undefined;
    }> = {},
  ): Promise<OwnersToAssign> {
    return OwnerRuleAssignment.addOwners({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      projectId: PROJECT_ID,
      userIds: [],
      teamIds: [],
      props: { isRoot: true },
      ...overrides,
    });
  }

  it("writes one row per owner, on the resource and in the project", async () => {
    const services: WritableServices = writableServices({});

    await add(services, {
      userIds: [USER_A],
      teamIds: [TEAM_A],
      isOwnerNotified: false,
    });

    const userRow: MonitorOwnerUser | undefined = writtenRows<MonitorOwnerUser>(
      services.createUser,
    )[0];
    const teamRow: MonitorOwnerTeam | undefined = writtenRows<MonitorOwnerTeam>(
      services.createTeam,
    )[0];

    expect(userRow).toBeInstanceOf(MonitorOwnerUser);
    expect(userRow!.monitorId!.toString()).toBe(MONITOR_ID.toString());
    expect(userRow!.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(userRow!.userId!.toString()).toBe(USER_A.toString());
    expect(userRow!.isOwnerNotified).toBe(false);

    expect(teamRow).toBeInstanceOf(MonitorOwnerTeam);
    expect(teamRow!.monitorId!.toString()).toBe(MONITOR_ID.toString());
    expect(teamRow!.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(teamRow!.teamId!.toString()).toBe(TEAM_A.toString());
    expect(teamRow!.isOwnerNotified).toBe(false);
  });

  it("skips owners the resource already has", async () => {
    const services: WritableServices = writableServices({
      existingUsers: [ownerUser(USER_A)],
      existingTeams: [ownerTeam(TEAM_A)],
    });

    const added: OwnersToAssign = await add(services, {
      userIds: [USER_A, USER_B],
      teamIds: [TEAM_A, TEAM_B],
    });

    expect(
      writtenRows<MonitorOwnerUser>(services.createUser).map(
        (r: MonitorOwnerUser): string => {
          return r.userId!.toString();
        },
      ),
    ).toEqual([USER_B.toString()]);
    expect(
      writtenRows<MonitorOwnerTeam>(services.createTeam).map(
        (r: MonitorOwnerTeam): string => {
          return r.teamId!.toString();
        },
      ),
    ).toEqual([TEAM_B.toString()]);

    expect(ids(added.userIds)).toEqual([USER_B.toString()]);
    expect(ids(added.teamIds)).toEqual([TEAM_B.toString()]);
  });

  it("adds a team listed twice once (a criteria template that repeats a team)", async () => {
    const services: WritableServices = writableServices({});

    await add(services, {
      teamIds: [TEAM_A, TEAM_A.toString(), TEAM_A],
      userIds: [USER_A, USER_A],
    });

    expect(services.createTeam).toHaveBeenCalledTimes(1);
    expect(services.createUser).toHaveBeenCalledTimes(1);
  });

  it("accepts ids that arrive as strings, and writes them as ids", async () => {
    const services: WritableServices = writableServices({});

    await add(services, {
      teamIds: [TEAM_A.toString()],
      userIds: [USER_A.toString()],
    });

    expect(
      writtenRows<MonitorOwnerTeam>(services.createTeam)[0]!.teamId,
    ).toBeInstanceOf(ObjectID);
    expect(
      writtenRows<MonitorOwnerUser>(services.createUser)[0]!.userId,
    ).toBeInstanceOf(ObjectID);
  });

  it("keeps going past an owner another writer added a moment ago", async () => {
    const services: WritableServices = writableServices({
      teamErrors: { [TEAM_A.toString()]: refusedByUniqueIndex() },
      userErrors: { [USER_A.toString()]: refusedByServiceCheck() },
    });

    const added: OwnersToAssign = await add(services, {
      teamIds: [TEAM_A, TEAM_B],
      userIds: [USER_A, USER_B],
    });

    // The raced owners were attempted, the rest still added...
    expect(services.createTeam).toHaveBeenCalledTimes(2);
    expect(services.createUser).toHaveBeenCalledTimes(2);

    // ...and only what this call wrote is reported as added.
    expect(ids(added.teamIds)).toEqual([TEAM_B.toString()]);
    expect(ids(added.userIds)).toEqual([USER_B.toString()]);
  });

  it("stops on a failure that is not a duplicate", async () => {
    const failure: Error = new Error("team was deleted");
    const services: WritableServices = writableServices({
      teamErrors: { [TEAM_A.toString()]: failure },
    });

    await expect(
      add(services, { teamIds: [TEAM_A, TEAM_B], userIds: [USER_A] }),
    ).rejects.toBe(failure);

    expect(services.createUser).not.toHaveBeenCalled();
  });

  it("writes a fresh row for every owner", async () => {
    const services: WritableServices = writableServices({});

    await add(services, { teamIds: [TEAM_A, TEAM_B] });

    const rows: Array<MonitorOwnerTeam> = writtenRows<MonitorOwnerTeam>(
      services.createTeam,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toBe(rows[1]);
    expect(rows[0]!.teamId!.toString()).toBe(TEAM_A.toString());
    expect(rows[1]!.teamId!.toString()).toBe(TEAM_B.toString());
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "writes isOwnerNotified = %p when asked to",
    async (isOwnerNotified: boolean, expected: boolean) => {
      const services: WritableServices = writableServices({});

      await add(services, { teamIds: [TEAM_A], isOwnerNotified });

      expect(
        writtenRows<MonitorOwnerTeam>(services.createTeam)[0]!.isOwnerNotified,
      ).toBe(expected);
    },
  );

  it("leaves isOwnerNotified to the column default when not given", async () => {
    const services: WritableServices = writableServices({});

    await add(services, { teamIds: [TEAM_A] });

    expect(
      writtenRows<MonitorOwnerTeam>(services.createTeam)[0]!.isOwnerNotified,
    ).toBeUndefined();
  });

  it("records who added the owners when told", async () => {
    const services: WritableServices = writableServices({});

    await add(services, {
      teamIds: [TEAM_A],
      userIds: [USER_A],
      createdByUserId: CREATED_BY,
    });

    expect(
      writtenRows<MonitorOwnerTeam>(services.createTeam)[0]!.createdByUserId,
    ).toBe(CREATED_BY);
    expect(
      writtenRows<MonitorOwnerUser>(services.createUser)[0]!.createdByUserId,
    ).toBe(CREATED_BY);
  });

  it("passes the caller's props to every write", async () => {
    const services: WritableServices = writableServices({});
    const props: { tenantId: ObjectID; userId: ObjectID } = {
      tenantId: PROJECT_ID,
      userId: CREATED_BY,
    };

    await OwnerRuleAssignment.addOwners({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A],
      teamIds: [TEAM_A],
      props: props,
    });

    expect(services.createUser.mock.calls[0]![0]).toMatchObject({ props });
    expect(services.createTeam.mock.calls[0]![0]).toMatchObject({ props });
  });

  it("writes nothing and reports nothing for an empty owner set", async () => {
    const services: WritableServices = writableServices({});

    const added: OwnersToAssign = await add(services);

    expect(services.createTeam).not.toHaveBeenCalled();
    expect(services.createUser).not.toHaveBeenCalled();
    expect(added).toEqual({ userIds: [], teamIds: [] });
  });
});

describe("OwnerRuleAssignment and project membership", () => {
  const DEPARTED: ObjectID = USER_B;

  function membersAre(userIds: Array<ObjectID>): void {
    memberCheck.mockImplementation(
      async (data: { projectId: ObjectID; userId: ObjectID }) => {
        return userIds.some((id: ObjectID): boolean => {
          return id.toString() === data.userId.toString();
        });
      },
    );
  }

  it("does not make a user who left the project an owner", async () => {
    membersAre([]);
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });
    const owner: MonitorOwnerUser = ownerUser(DEPARTED);
    owner.projectId = PROJECT_ID;

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerUser>,
        owner: owner,
        props: { isRoot: true },
      }),
    ).resolves.toBe(false);

    expect(create).not.toHaveBeenCalled();
    expect(memberCheck).toHaveBeenCalledTimes(1);
    const asked: { projectId: ObjectID; userId: ObjectID } = memberCheck.mock
      .calls[0]![0] as { projectId: ObjectID; userId: ObjectID };
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.userId.toString()).toBe(DEPARTED.toString());
  });

  it("reads the project from the caller's tenant when the row has none", async () => {
    membersAre([USER_A]);
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerUser>,
        owner: ownerUser(USER_A),
        props: { tenantId: PROJECT_ID },
      }),
    ).resolves.toBe(true);

    const asked: { projectId: ObjectID } = memberCheck.mock.calls[0]![0] as {
      projectId: ObjectID;
    };
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not ask about team owners", async () => {
    membersAre([]);
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });
    const owner: MonitorOwnerTeam = ownerTeam(TEAM_A);
    owner.projectId = PROJECT_ID;

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerTeam>,
        owner: owner,
        props: { isRoot: true },
      }),
    ).resolves.toBe(true);

    expect(memberCheck).not.toHaveBeenCalled();
  });

  it("adds the rest of a saved owner set and reports only what it added", async () => {
    membersAre([USER_A]);
    const services: WritableServices = writableServices({});

    const added: OwnersToAssign = await OwnerRuleAssignment.addOwners({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A, DEPARTED],
      teamIds: [TEAM_A],
      props: { isRoot: true },
    });

    expect(
      writtenRows<MonitorOwnerUser>(services.createUser).map(
        (r: MonitorOwnerUser): string => {
          return r.userId!.toString();
        },
      ),
    ).toEqual([USER_A.toString()]);
    expect(services.createTeam).toHaveBeenCalledTimes(1);

    expect(ids(added.userIds)).toEqual([USER_A.toString()]);
    expect(ids(added.teamIds)).toEqual([TEAM_A.toString()]);
  });

  it("a failing membership read fails the write, as any other read would", async () => {
    const failure: Error = new Error("db down");
    memberCheck.mockRejectedValue(failure);
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });
    const owner: MonitorOwnerUser = ownerUser(USER_A);
    owner.projectId = PROJECT_ID;

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerUser>,
        owner: owner,
        props: { isRoot: true },
      }),
    ).rejects.toBe(failure);

    expect(create).not.toHaveBeenCalled();
  });
});
