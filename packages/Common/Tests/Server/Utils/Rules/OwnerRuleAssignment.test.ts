import MonitorOwnerTeam from "../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseService, {
  PendingRecord,
} from "../../../../Server/Services/DatabaseService";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
  UnreadableReferenceException,
} from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreatePermission from "../../../../Server/Types/Database/Permissions/CreatePermission";
import BasePermission from "../../../../Server/Types/Database/Permissions/BasePermission";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "../../../../Models/DatabaseModels/StatusPageOwnerTeam";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../../TestingUtils/ProjectDirectory";
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
 * the project since, or - saved before the lists were checked - a team of
 * another project, which the owner service refuses; createOwner skips both
 * (see the last blocks).
 */

/*
 * Every owner user below is a project member unless a test says otherwise.
 * The membership read is TeamMemberService's; a team is the owner service's
 * to check, and the stubbed directory shows createOwner never reads one
 * itself. No Postgres here.
 */
let memberCheck: jest.SpyInstance;
let directory: ProjectDirectoryStub;

beforeEach(() => {
  memberCheck = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: { Team: [TEAM_A.toString(), TEAM_B.toString()] },
  });
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
    /*
     * The resource the owner is added to is one the caller may not read
     * (CreatePermission.checkParentPermission): their access, not a stale
     * owner, so it is not skipped like a team of another project.
     */
    [
      "the refusal of a resource the caller may not read",
      new UnreadableParentException(
        'This monitor owner team references records that are not in this project: Monitor "x". Please pick values from this project and try again.',
      ),
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

  it("rethrows a listed record the caller may not read, as it rethrows a parent", async () => {
    const failure: UnreadableReferenceException =
      new UnreadableReferenceException(
        'This monitor owner team references records that are not in this project: Monitors "x". Please pick values from this project and try again.',
      );
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

/*
 * THE OWNERS PICKED WITH A NEW RECORD ARE NOT LOST. Added for the person who
 * just created the record, they are written as that person. One refusal is
 * not theirs to fix: an owner row read through the record needs a read of it,
 * and their read may not reach the record they made a moment ago. For that
 * refusal alone OneUptime writes the row for that person, naming them - once
 * the row is checked against their own permission to add owners on
 * everything but that read. Every other refusal is theirs as before, a
 * permission to add owners limited to labels the record does not carry among
 * them.
 */
describe("OwnerRuleAssignment.createOwner, on the creator's behalf", () => {
  const CREATOR: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );
  const creatorProps: DatabaseCommonInteractionProps = {
    userId: CREATOR,
    tenantId: PROJECT_ID,
  };

  const unreadable: () => UnreadableParentException =
    (): UnreadableParentException => {
      return new UnreadableParentException(
        'This monitor owner team references records that are not in this project: Monitor "x". Please pick values from this project and try again.',
      );
    };

  let columnCheck: jest.SpyInstance;
  let scopeCheck: jest.Mock;

  beforeEach(() => {
    columnCheck = jest
      .spyOn(CreatePermission, "checkCreatePermissions")
      .mockImplementation(() => {
        return undefined as never;
      });
    scopeCheck = jest.fn(async () => {
      return undefined;
    });
  });

  function serviceThat(create: jest.Mock): DatabaseService<MonitorOwnerTeam> {
    return {
      create,
      modelType: MonitorOwnerTeam,
      checkCreateScopeOf: scopeCheck,
    } as unknown as DatabaseService<MonitorOwnerTeam>;
  }

  it("writes the row for its creator after a new record its creator may not read", async () => {
    const create: jest.Mock = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw unreadable();
      })
      .mockImplementationOnce(async () => {
        return {};
      });
    const owner: MonitorOwnerTeam = ownerTeam(TEAM_A);

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create as jest.Mock),
        owner: owner,
        props: creatorProps,
        onCreatorsBehalf: true,
      }),
    ).resolves.toBe(true);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toEqual({
      data: owner,
      props: creatorProps,
    });
    // By OneUptime, naming the creator...
    expect(create.mock.calls[1]![0]).toEqual({
      data: owner,
      props: { isRoot: true, userId: CREATOR },
    });
    // ...once the creator's own permission to add owners holds for the row.
    expect(columnCheck).toHaveBeenCalledWith(
      MonitorOwnerTeam,
      owner,
      creatorProps,
    );
    expect(scopeCheck).toHaveBeenCalledWith({
      row: owner,
      props: creatorProps,
    });
  });

  it("a permission to add owners limited to labels the new record does not carry is not written around", async () => {
    const failure: CreateScopeException = new CreateScopeException(
      "Your access lets you create Monitor Team Owners only for records with one of these labels: Production.",
    );
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: creatorProps,
        onCreatorsBehalf: true,
      }),
    ).rejects.toBe(failure);

    expect(create).toHaveBeenCalledTimes(1);
    expect(scopeCheck).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the labels of their permission to add owners",
      (): void => {
        scopeCheck.mockImplementationOnce(async () => {
          throw new CreateScopeException(
            "Your access lets you create Monitor Team Owners only for records with one of these labels: Production.",
          );
        });
      },
      CreateScopeException,
    ],
    [
      "their permission to write the row's columns",
      (): void => {
        columnCheck.mockImplementationOnce(() => {
          throw new NotAuthorizedException(
            "You do not have permissions to create Monitor Team Owner.",
          );
        });
      },
      NotAuthorizedException,
    ],
  ])(
    "when the creator may not read their new record, OneUptime still asks %s",
    async (
      _label: string,
      refuse: () => void,
      refusal: { new (message: string): Error },
    ) => {
      refuse();

      const create: jest.Mock = jest.fn(async () => {
        throw unreadable();
      });

      await expect(
        OwnerRuleAssignment.createOwner({
          ownerService: serviceThat(create),
          owner: ownerTeam(TEAM_A),
          props: creatorProps,
          onCreatorsBehalf: true,
        }),
      ).rejects.toBeInstanceOf(refusal);

      // Never written by OneUptime.
      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  it("without onCreatorsBehalf, the same refusal reaches the caller", async () => {
    const failure: UnreadableParentException = unreadable();
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: creatorProps,
      }),
    ).rejects.toBe(failure);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a missing permission to add owners at all",
      new NotAuthorizedException("You do not have permissions to create Owner"),
    ],
    ["a generic error", new Error("connection reset")],
  ])("does not write around %s", async (_label: string, failure: unknown) => {
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: creatorProps,
        onCreatorsBehalf: true,
      }),
    ).rejects.toBe(failure);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a team the row may not name is still skipped when OneUptime writes it", async () => {
    const create: jest.Mock = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw unreadable();
      })
      .mockImplementationOnce(async () => {
        throw new ProjectScopedReferenceException(
          'This monitor owner team references records that are not in this project: Team "x".',
        );
      });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create as jest.Mock),
        owner: ownerTeam(TEAM_A),
        props: creatorProps,
        onCreatorsBehalf: true,
      }),
    ).resolves.toBe(false);
  });

  it("OneUptime's own owner rows are written once, as they were", async () => {
    const failure: UnreadableParentException = unreadable();
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: serviceThat(create),
        owner: ownerTeam(TEAM_A),
        props: { isRoot: true, userId: CREATOR },
        onCreatorsBehalf: true,
      }),
    ).rejects.toBe(failure);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("is what addOwners passes on for every owner it adds", async () => {
    const userCreate: jest.Mock = jest
      .fn()
      .mockImplementationOnce(async () => {
        throw unreadable();
      })
      .mockImplementation(async () => {
        return {};
      });
    const services: FakeServices = fakeServices({});

    Object.assign(services.ownerUserService, {
      create: userCreate,
      modelType: MonitorOwnerUser,
      checkCreateScopeOf: scopeCheck,
    });

    const added: OwnersToAssign = await OwnerRuleAssignment.addOwners({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A],
      teamIds: [],
      props: creatorProps,
      onCreatorsBehalf: true,
    });

    expect(ids(added.userIds)).toEqual([USER_A.toString()]);
    expect(userCreate).toHaveBeenCalledTimes(2);
    expect(
      (
        userCreate.mock.calls[1]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props,
    ).toEqual({ isRoot: true, userId: CREATOR });
  });
});

/*
 * THE OWNERS PICKED IN A CREATE FORM ARE ASKED ABOUT BEFORE THE RECORD IS
 * SAVED: the permission to add owners and its columns, a read of the record
 * when its owner rows are read through it, and the labels, blocks with labels
 * and Owned scope of that permission, by the labels the record is created
 * with. A refusal refuses the create.
 */
describe("OwnerRuleAssignment.checkOwnersPickedOnCreate", () => {
  const CREATOR: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );
  const PRODUCTION: ObjectID = new ObjectID(
    "77777777-7777-4777-8777-777777777777",
  );
  const creatorProps: DatabaseCommonInteractionProps = {
    userId: CREATOR,
    tenantId: PROJECT_ID,
  };

  let columnCheck: jest.SpyInstance;
  let parentReadCheck: jest.SpyInstance;
  let userScopeCheck: jest.Mock;
  let teamScopeCheck: jest.Mock;

  beforeEach(() => {
    columnCheck = jest
      .spyOn(CreatePermission, "checkCreatePermissions")
      .mockImplementation(() => {
        return undefined as never;
      });
    parentReadCheck = jest
      .spyOn(BasePermission, "isHeldToParentRead")
      .mockReturnValue(false);
    userScopeCheck = jest.fn(async () => {
      return undefined;
    });
    teamScopeCheck = jest.fn(async () => {
      return undefined;
    });
  });

  function ownerServices(data: {
    ownerUserModel: { new (): MonitorOwnerUser | StatusPageOwnerTeam };
    ownerTeamModel: { new (): MonitorOwnerTeam | StatusPageOwnerTeam };
  }): {
    ownerUserService: DatabaseService<MonitorOwnerUser>;
    ownerTeamService: DatabaseService<MonitorOwnerTeam>;
  } {
    return {
      ownerUserService: {
        modelType: data.ownerUserModel,
        checkCreateScopeOf: userScopeCheck,
      } as unknown as DatabaseService<MonitorOwnerUser>,
      ownerTeamService: {
        modelType: data.ownerTeamModel,
        checkCreateScopeOf: teamScopeCheck,
      } as unknown as DatabaseService<MonitorOwnerTeam>,
    };
  }

  function newMonitor(): Monitor {
    const monitor: Monitor = new Monitor();
    const label: Label = new Label();
    label._id = PRODUCTION.toString();
    monitor.projectId = PROJECT_ID;
    monitor.labels = [label];
    return monitor;
  }

  it("asks about each kind of owner picked, on the record as it will be saved", async () => {
    await OwnerRuleAssignment.checkOwnersPickedOnCreate({
      ...ownerServices({
        ownerUserModel: MonitorOwnerUser,
        ownerTeamModel: MonitorOwnerTeam,
      }),
      resourceIdColumn: "monitorId",
      resourceModelType: Monitor,
      resource: newMonitor(),
      miscDataProps: { ownerUsers: [USER_A.toString()] },
      props: creatorProps,
    });

    // People were picked, teams were not.
    expect(teamScopeCheck).not.toHaveBeenCalled();
    expect(userScopeCheck).toHaveBeenCalledTimes(1);

    const asked: {
      row: MonitorOwnerUser;
      props: DatabaseCommonInteractionProps;
      pending: PendingRecord;
    } = userScopeCheck.mock.calls[0]![0] as never;

    expect(asked.props).toBe(creatorProps);
    expect(asked.pending.modelType).toBe(Monitor);
    expect(asked.pending.labelIds).toEqual([PRODUCTION.toString()]);
    // The creator - a person - becomes the new monitor's owner.
    expect(asked.pending.ownedByCreator).toBe(true);
    // The owner row names the record not saved yet by the placeholder.
    expect(asked.row.monitorId?.toString()).toBe(asked.pending.id.toString());
    expect(asked.row.projectId?.toString()).toBe(PROJECT_ID.toString());

    expect(columnCheck).toHaveBeenCalledWith(
      MonitorOwnerUser,
      asked.row,
      creatorProps,
    );
    // Monitor owner rows are not read through the monitor.
    expect(parentReadCheck).not.toHaveBeenCalled();
  });

  it("owner rows read through the record need a read of it", async () => {
    await OwnerRuleAssignment.checkOwnersPickedOnCreate({
      ...ownerServices({
        ownerUserModel: StatusPageOwnerTeam,
        ownerTeamModel: StatusPageOwnerTeam,
      }),
      resourceIdColumn: "statusPageId",
      resourceModelType: StatusPage,
      resource: new StatusPage(),
      miscDataProps: { ownerTeams: [TEAM_A.toString()] },
      props: creatorProps,
    });

    expect(parentReadCheck).toHaveBeenCalledWith(
      StatusPageOwnerTeam,
      StatusPage,
      creatorProps,
      "create",
    );
    expect(teamScopeCheck).toHaveBeenCalledTimes(1);
  });

  it("a refusal of the permission to add owners refuses the create", async () => {
    const failure: CreateScopeException = new CreateScopeException(
      "Your access lets you create Monitor Owners only for records with one of these labels: Staging.",
    );

    userScopeCheck.mockImplementationOnce(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.checkOwnersPickedOnCreate({
        ...ownerServices({
          ownerUserModel: MonitorOwnerUser,
          ownerTeamModel: MonitorOwnerTeam,
        }),
        resourceIdColumn: "monitorId",
        resourceModelType: Monitor,
        resource: newMonitor(),
        miscDataProps: {
          ownerUsers: [USER_A.toString()],
          ownerTeams: [TEAM_A.toString()],
        },
        props: creatorProps,
      }),
    ).rejects.toBe(failure);
  });

  it.each([
    ["no owners picked", creatorProps, {}],
    ["empty picks", creatorProps, { ownerUsers: [], ownerTeams: [] }],
    [
      "OneUptime's own create",
      { isRoot: true } as DatabaseCommonInteractionProps,
      { ownerUsers: [USER_A.toString()] },
    ],
  ])(
    "asks nothing for %s",
    async (
      _label: string,
      props: DatabaseCommonInteractionProps,
      miscDataProps: Record<string, Array<string>>,
    ) => {
      await OwnerRuleAssignment.checkOwnersPickedOnCreate({
        ...ownerServices({
          ownerUserModel: MonitorOwnerUser,
          ownerTeamModel: MonitorOwnerTeam,
        }),
        resourceIdColumn: "monitorId",
        resourceModelType: Monitor,
        resource: newMonitor(),
        miscDataProps: miscDataProps,
        props: props,
      });

      expect(columnCheck).not.toHaveBeenCalled();
      expect(userScopeCheck).not.toHaveBeenCalled();
      expect(teamScopeCheck).not.toHaveBeenCalled();
    },
  );

  it("an API key, which owns nothing, owns nothing it creates", async () => {
    await OwnerRuleAssignment.checkOwnersPickedOnCreate({
      ...ownerServices({
        ownerUserModel: MonitorOwnerUser,
        ownerTeamModel: MonitorOwnerTeam,
      }),
      resourceIdColumn: "monitorId",
      resourceModelType: Monitor,
      resource: newMonitor(),
      miscDataProps: { ownerTeams: [TEAM_A.toString()] },
      props: { tenantId: PROJECT_ID },
    });

    expect(
      (teamScopeCheck.mock.calls[0]![0] as { pending: PendingRecord }).pending
        .ownedByCreator,
    ).toBe(false);
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

  it("does not ask about membership for a team owner", async () => {
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

describe("OwnerRuleAssignment and the project's teams", () => {
  /*
   * A team owner is checked by the owner row's own service: every owner
   * service is a ProjectReferencesService, which refuses a team (or user,
   * or resource) that is not the row's project's with a
   * ProjectScopedReferenceException. createOwner reports that row as not
   * added, so a saved owner set naming another project's team still adds
   * everyone else. OwnerAndRuleServicesCheckReferences holds every owner
   * service to that check.
   */
  // A team of another project, or one that does not exist at all.
  const FOREIGN_TEAM: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  function refusedAsNotTheProjects(): ProjectScopedReferenceException {
    return new ProjectScopedReferenceException(
      `This monitor team owner references records that are not in this project: Team "${FOREIGN_TEAM.toString()}". Please pick values from this project and try again.`,
    );
  }

  function teamRowOf(teamId: ObjectID): MonitorOwnerTeam {
    const owner: MonitorOwnerTeam = new MonitorOwnerTeam();
    owner.teamId = teamId;
    owner.monitorId = MONITOR_ID;
    owner.projectId = PROJECT_ID;
    return owner;
  }

  it("reports a team the owner service refuses as not the project's as not added", async () => {
    const create: jest.Mock = jest.fn(async () => {
      throw refusedAsNotTheProjects();
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerTeam>,
        owner: teamRowOf(FOREIGN_TEAM),
        props: { isRoot: true },
      }),
    ).resolves.toBe(false);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leaves the team to the owner service rather than reading it a second time", async () => {
    const create: jest.Mock = jest.fn(async () => {
      return {};
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerTeam>,
        owner: teamRowOf(TEAM_A),
        props: { isRoot: true },
      }),
    ).resolves.toBe(true);

    expect(directory.recordLookups).toEqual([]);
    expect(memberCheck).not.toHaveBeenCalled();
  });

  it("still throws a refusal of any other kind", async () => {
    const failure: BadDataException = new BadDataException(
      "teamId is required",
    );
    const create: jest.Mock = jest.fn(async () => {
      throw failure;
    });

    await expect(
      OwnerRuleAssignment.createOwner({
        ownerService: {
          create,
        } as unknown as DatabaseService<MonitorOwnerTeam>,
        owner: teamRowOf(TEAM_A),
        props: { isRoot: true },
      }),
    ).rejects.toBe(failure);
  });

  it("adds the rest of a saved owner set when one of its teams is another project's", async () => {
    const services: WritableServices = writableServices({
      teamErrors: { [FOREIGN_TEAM.toString()]: refusedAsNotTheProjects() },
    });

    const added: OwnersToAssign = await OwnerRuleAssignment.addOwners({
      ownerUserService: services.ownerUserService,
      ownerTeamService: services.ownerTeamService,
      resourceIdColumn: "monitorId",
      resourceId: MONITOR_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A],
      teamIds: [FOREIGN_TEAM, TEAM_A],
      props: { isRoot: true },
    });

    expect(ids(added.teamIds)).toEqual([TEAM_A.toString()]);
    expect(ids(added.userIds)).toEqual([USER_A.toString()]);
  });
});
