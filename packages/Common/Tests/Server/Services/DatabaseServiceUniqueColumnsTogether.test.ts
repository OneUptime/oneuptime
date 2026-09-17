import DatabaseService from "../../../Server/Services/DatabaseService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import HostOwnerTeamService from "../../../Server/Services/HostOwnerTeamService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import TeamService from "../../../Server/Services/TeamService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HostOwnerTeam from "../../../Models/DatabaseModels/HostOwnerTeam";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import UniqueColumnsTogether from "../../../Types/Database/UniqueColumnsTogether";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #3394, the service half: DatabaseService.create must refuse a second
 * owner row for the same owner of the same resource, whichever path the write
 * came from - REST API, workflow component, or an internal caller.
 *
 * The refusal has to happen BEFORE the row is saved, because saving is what
 * runs onCreateSuccess, and onCreateSuccess is what writes the "Added team web
 * to the incident" feed item and sends the owner notification. A duplicate
 * that got as far as onCreateSuccess would still double-notify the team even
 * if something removed the row afterwards.
 *
 * These tests drive the real create path of real owner services, with the
 * repository replaced by an in-memory table and every network side effect
 * (workflows, realtime, audit log) stubbed. No Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0000000a-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0000000c-0000-4000-8000-000000000001",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "0000000c-0000-4000-8000-000000000002",
);
const HOST_ID: ObjectID = new ObjectID("0000000d-0000-4000-8000-000000000001");
const TEAM_ID: ObjectID = new ObjectID("0000000b-0000-4000-8000-000000000001");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "0000000b-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("0000000e-0000-4000-8000-000000000001");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyService = DatabaseService<any>;

interface FakeTable {
  rows: Array<BaseModel>;
  save: jest.Mock;
  countBy: jest.SpyInstance;
  onCreateSuccess: jest.SpyInstance;
}

function valueOf(row: BaseModel, column: string): string {
  return (row.getColumnValue(column) as ObjectID | undefined)?.toString() || "";
}

/*
 * The owner table as the service sees it. countBy answers from the same rows
 * save() wrote, so a create that slipped past the check would show up as a
 * second row rather than being hidden by a canned answer.
 */
function installFakeTable(
  service: AnyService,
  options: { saveError?: unknown } = {},
): FakeTable {
  const rows: Array<BaseModel> = [];

  const save: jest.Mock = jest.fn(async (item: BaseModel) => {
    if (options.saveError) {
      throw options.saveError;
    }

    item._id = ObjectID.generate().toString();
    rows.push(item);
    return item;
  });

  jest.spyOn(service, "getRepository").mockReturnValue({ save: save } as never);

  const countBy: jest.SpyInstance = jest
    .spyOn(service, "countBy")
    .mockImplementation((async (countByArgs: {
      query: Record<string, unknown>;
    }): Promise<PositiveNumber> => {
      const matching: number = rows.filter((row: BaseModel): boolean => {
        return Object.keys(countByArgs.query).every((column: string) => {
          return (
            valueOf(row, column) ===
            String(countByArgs.query[column] as ObjectID)
          );
        });
      }).length;

      return new PositiveNumber(matching);
    }) as never);

  // Stands in for the feed item and the owner notification.
  const onCreateSuccess: jest.SpyInstance = jest
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .spyOn(service as any, "onCreateSuccess")
    .mockImplementation((async (_onCreate: unknown, createdItem: BaseModel) => {
      return createdItem;
    }) as never);

  jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);

  return { rows, save, countBy, onCreateSuccess };
}

function incidentTeamOwner(
  teamId: ObjectID = TEAM_ID,
  incidentId: ObjectID = INCIDENT_ID,
): IncidentOwnerTeam {
  const owner: IncidentOwnerTeam = new IncidentOwnerTeam();
  owner.projectId = PROJECT_ID;
  owner.incidentId = incidentId;
  owner.teamId = teamId;
  return owner;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("expected the promise to reject");
}

function uniquenessQueries(table: FakeTable): Array<Record<string, unknown>> {
  return table.countBy.mock.calls
    .map((call: Array<unknown>) => {
      return (call[0] as { query: Record<string, unknown> }).query;
    })
    .filter((query: Record<string, unknown>) => {
      return "teamId" in query || "userId" in query;
    });
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Issue #3394 - adding a team that already owns the incident", () => {
  test("the second create is refused, and only the first reaches onCreateSuccess", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(),
      props: { isRoot: true },
    });

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { isRoot: true },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      "This team is already an owner of this incident.",
    );

    // One row, one feed item, one notification.
    expect(table.rows).toHaveLength(1);
    expect(table.save).toHaveBeenCalledTimes(1);
    expect(table.onCreateSuccess).toHaveBeenCalledTimes(1);
  });

  test("the refusal reads as a unique violation, so bulk callers can skip it", async () => {
    installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(),
      props: { isRoot: true },
    });

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { isRoot: true },
      }),
    );

    expect(PostgresErrorTranslator.isUniqueViolation(error)).toBe(true);
  });

  test("repeating the create any number of times still leaves one row", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    for (let attempt: number = 0; attempt < 5; attempt++) {
      await IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { isRoot: true },
      }).catch((error: unknown) => {
        if (!PostgresErrorTranslator.isUniqueViolation(error)) {
          throw error;
        }
      });
    }

    expect(table.rows).toHaveLength(1);
    expect(table.onCreateSuccess).toHaveBeenCalledTimes(1);
  });

  test("another team can still be added to the same incident", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(TEAM_ID),
      props: { isRoot: true },
    });
    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(OTHER_TEAM_ID),
      props: { isRoot: true },
    });

    expect(table.rows).toHaveLength(2);
    expect(table.onCreateSuccess).toHaveBeenCalledTimes(2);
  });

  test("the same team can still own another incident", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(TEAM_ID, INCIDENT_ID),
      props: { isRoot: true },
    });
    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(TEAM_ID, OTHER_INCIDENT_ID),
      props: { isRoot: true },
    });

    expect(table.rows).toHaveLength(2);
  });

  test("a REST API body, ids as strings and project from the tenant, is refused the same way", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(),
      props: { isRoot: true },
    });

    // POST /api/incident-owner-team -> BaseAPI.createItem.
    const body: JSONObject = JSON.parse(
      JSON.stringify({
        incidentId: INCIDENT_ID.toString(),
        teamId: TEAM_ID.toString(),
      }),
    ) as JSONObject;

    const fromApi: IncidentOwnerTeam = BaseModel.fromJSON<IncidentOwnerTeam>(
      body,
      IncidentOwnerTeam,
    ) as IncidentOwnerTeam;

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: fromApi,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );

    expect((error as Error).message).toBe(
      "This team is already an owner of this incident.",
    );
    expect(table.rows).toHaveLength(1);
  });

  test("an owner given only as the team relation is still recognised", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(),
      props: { isRoot: true },
    });

    const relationOnly: IncidentOwnerTeam = new IncidentOwnerTeam();
    relationOnly.projectId = PROJECT_ID;
    relationOnly.incidentId = INCIDENT_ID;
    relationOnly.team = new Team(TEAM_ID);

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: relationOnly,
        props: { isRoot: true },
      }),
    );

    expect(PostgresErrorTranslator.isUniqueViolation(error)).toBe(true);
    expect(table.rows).toHaveLength(1);
  });
});

describe("the same guard on other owner tables", () => {
  test("a user who already owns the incident is refused with a user message", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerUserService);

    const owner: () => IncidentOwnerUser = (): IncidentOwnerUser => {
      const row: IncidentOwnerUser = new IncidentOwnerUser();
      row.projectId = PROJECT_ID;
      row.incidentId = INCIDENT_ID;
      row.userId = USER_ID;
      return row;
    };

    await IncidentOwnerUserService.create({
      data: owner(),
      props: { isRoot: true },
    });

    const error: unknown = await captureError(
      IncidentOwnerUserService.create({
        data: owner(),
        props: { isRoot: true },
      }),
    );

    expect((error as Error).message).toBe(
      "This user is already an owner of this incident.",
    );
    expect(table.rows).toHaveLength(1);
    expect(table.onCreateSuccess).toHaveBeenCalledTimes(1);
  });

  test("an owner table that never had a composite index is guarded too", async () => {
    const table: FakeTable = installFakeTable(HostOwnerTeamService);

    const owner: () => HostOwnerTeam = (): HostOwnerTeam => {
      const row: HostOwnerTeam = new HostOwnerTeam();
      row.projectId = PROJECT_ID;
      row.hostId = HOST_ID;
      row.teamId = TEAM_ID;
      return row;
    };

    await HostOwnerTeamService.create({
      data: owner(),
      props: { isRoot: true },
    });

    const error: unknown = await captureError(
      HostOwnerTeamService.create({ data: owner(), props: { isRoot: true } }),
    );

    expect((error as Error).message).toBe(
      "This team is already an owner of this host.",
    );
    expect(table.rows).toHaveLength(1);
  });
});

describe("the uniqueness query", () => {
  test("counts rows with the same incident, team and project, as root", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    await IncidentOwnerTeamService.create({
      data: incidentTeamOwner(),
      props: { isRoot: true },
    });

    const queries: Array<Record<string, unknown>> = uniquenessQueries(table);

    expect(queries).toHaveLength(1);
    expect(Object.keys(queries[0]!).sort()).toEqual([
      "incidentId",
      "projectId",
      "teamId",
    ]);
    expect(String(queries[0]!["incidentId"])).toBe(INCIDENT_ID.toString());
    expect(String(queries[0]!["teamId"])).toBe(TEAM_ID.toString());
    expect(String(queries[0]!["projectId"])).toBe(PROJECT_ID.toString());

    const uniquenessCall: Array<unknown> = table.countBy.mock.calls.find(
      (call: Array<unknown>) => {
        return (
          (call[0] as { query: Record<string, unknown> }).query === queries[0]
        );
      },
    )!;

    /*
     * Root, so the caller's own read scope cannot hide the existing row and
     * let the duplicate through.
     */
    expect((uniquenessCall[0] as { props: unknown }).props).toEqual({
      isRoot: true,
    });
  });

  test("compares string ids as ids", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    const owner: IncidentOwnerTeam = new IncidentOwnerTeam();
    owner.projectId = PROJECT_ID.toString() as unknown as ObjectID;
    owner.incidentId = INCIDENT_ID.toString() as unknown as ObjectID;
    owner.teamId = TEAM_ID.toString() as unknown as ObjectID;

    await IncidentOwnerTeamService.create({
      data: owner,
      props: { isRoot: true },
    });

    const query: Record<string, unknown> = uniquenessQueries(table)[0]!;

    for (const column of ["incidentId", "teamId", "projectId"]) {
      expect(query[column]).toBeInstanceOf(ObjectID);
    }
  });

  test("runs only after the create permission check", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService);

    /*
     * Answering "already an owner" to a caller who may not create owners at
     * all would tell them something they are not allowed to read.
     */
    await captureError(
      IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );

    expect(uniquenessQueries(table)).toHaveLength(0);
    expect(table.save).not.toHaveBeenCalled();
  });
});

describe("when two writers race past the check", () => {
  test("the database's unique violation is reported the same way, and nobody is notified", async () => {
    const table: FakeTable = installFakeTable(IncidentOwnerTeamService, {
      saveError: {
        code: "23505",
        table: "IncidentOwnerTeam",
        detail:
          'Key ("incidentId", "teamId", "projectId")=(c, b, a) already exists.',
      },
    });

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { isRoot: true },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(PostgresErrorTranslator.isUniqueViolation(error)).toBe(true);
    expect(table.onCreateSuccess).not.toHaveBeenCalled();
  });

  test("any other save failure is not mistaken for a duplicate", async () => {
    installFakeTable(IncidentOwnerTeamService, {
      saveError: new Error("connection reset"),
    });

    const error: unknown = await captureError(
      IncidentOwnerTeamService.create({
        data: incidentTeamOwner(),
        props: { isRoot: true },
      }),
    );

    expect(PostgresErrorTranslator.isUniqueViolation(error)).toBe(false);
  });
});

describe("checkUniqueColumnsTogether", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function check(service: AnyService, data: BaseModel): Promise<void> {
    return (service as any).checkUniqueColumnsTogether(data);
  }

  test("does not query for a model that declares nothing", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(TeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const team: Team = new Team();
    team.name = "web";
    team.projectId = PROJECT_ID;

    await expect(check(TeamService, team)).resolves.toBeUndefined();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("leaves an incomplete key to the database instead of guessing", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(IncidentOwnerTeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const owner: IncidentOwnerTeam = new IncidentOwnerTeam();
    owner.projectId = PROJECT_ID;
    owner.incidentId = INCIDENT_ID;

    await expect(
      check(IncidentOwnerTeamService, owner),
    ).resolves.toBeUndefined();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("reads an id out of a plain { _id } relation from a request body", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(IncidentOwnerTeamService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    const owner: IncidentOwnerTeam = new IncidentOwnerTeam();
    owner.projectId = PROJECT_ID;
    owner.incidentId = INCIDENT_ID;
    owner.team = { _id: TEAM_ID.toString() } as unknown as Team;

    await check(IncidentOwnerTeamService, owner);

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(String(query["teamId"])).toBe(TEAM_ID.toString());
  });

  describe("a model with more than one constraint", () => {
    @UniqueColumnsTogether(["projectId", "name"], "Name is taken.")
    @UniqueColumnsTogether(["projectId", "slug"], "Slug is taken.")
    class TwoConstraintModel extends BaseModel {
      public projectId?: ObjectID = undefined;
      public name?: string = undefined;
      public slug?: string = undefined;
    }

    function serviceAnswering(
      answer: (query: Record<string, unknown>) => number,
    ): { service: DatabaseService<TwoConstraintModel>; countBy: jest.Mock } {
      const service: DatabaseService<TwoConstraintModel> =
        new DatabaseService<TwoConstraintModel>(TwoConstraintModel);

      const countBy: jest.Mock = jest.fn(
        async (args: { query: Record<string, unknown> }) => {
          return new PositiveNumber(answer(args.query));
        },
      );

      (service as unknown as { countBy: jest.Mock }).countBy = countBy;

      return { service, countBy };
    }

    function row(): TwoConstraintModel {
      const model: TwoConstraintModel = new TwoConstraintModel();
      model.projectId = PROJECT_ID;
      model.name = "Checkout";
      model.slug = "checkout";
      return model;
    }

    test("checks each of them", async () => {
      const { service, countBy } = serviceAnswering(() => {
        return 0;
      });

      await check(service, row());

      const queries: Array<Record<string, unknown>> = countBy.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { query: Record<string, unknown> }).query;
        },
      );

      expect(queries).toHaveLength(2);
      expect(queries).toContainEqual({
        projectId: PROJECT_ID,
        name: "Checkout",
      });
      expect(queries).toContainEqual({
        projectId: PROJECT_ID,
        slug: "checkout",
      });
    });

    test("reports the message of the constraint that was broken", async () => {
      const { service } = serviceAnswering((query: Record<string, unknown>) => {
        return "slug" in query ? 1 : 0;
      });

      await expect(check(service, row())).rejects.toThrow("Slug is taken.");
    });

    test("stops at the first broken constraint", async () => {
      const { service, countBy } = serviceAnswering(() => {
        return 1;
      });

      await expect(check(service, row())).rejects.toBeInstanceOf(
        BadDataException,
      );
      expect(countBy).toHaveBeenCalledTimes(1);
    });
  });
});
