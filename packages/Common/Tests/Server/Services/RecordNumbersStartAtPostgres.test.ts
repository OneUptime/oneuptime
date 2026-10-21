import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
  RecordNumbering,
} from "../../../Utils/Project/NextNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHERE A PROJECT'S NUMBERS START, AGAINST POSTGRES.
 *
 * A project moving from another tool chooses the number its next incident,
 * incident episode, alert, alert episode or scheduled maintenance event
 * gets (Utils/Project/NextNumber), and the next one counts up from it. The
 * real ProjectService runs here on a structure-only clone of the migrated
 * Project table, taking numbers through the same methods the record
 * services number new records with, and changing the start through the
 * real update path with a caller's permissions:
 *
 *   - after a change the first record gets the chosen number, the next
 *     ones count up, and a start a record has passed changes nothing;
 *   - a start at or below the highest number given out is refused, and
 *     the refusal writes nothing; one sent as stored is no change; one
 *     moved down is allowed while no record has used the numbers in
 *     between; one cleared lets numbers carry on from the highest;
 *   - records created at the same moment, while the start changes, each
 *     get a number of their own, and every number is either the one after
 *     the last or a start that was chosen;
 *   - each kind of number keeps its own counter and start;
 *   - only someone who may change the project's numbering changes it.
 *
 * No lock is taken: a number is one statement, which is the point (the
 * test fails if Semaphore.lock is called).
 *
 * Opt in with RUN_POSTGRES_RECORD_NUMBERS_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_NUMBERS_TESTS=true \
 *   RECORD_NUMBERS_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_NUMBERS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/RecordNumbersStartAtPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * table's definition is copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RECORD_NUMBERS_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

type TakeNumber = (
  projectId: ObjectID,
) => Promise<{ counter: number; prefix: string | undefined }>;

// The method each kind's record service numbers a new record with.
const TAKE: Record<NumberedRecordKind, TakeNumber> = {
  [NumberedRecordKind.Incident]: (projectId: ObjectID) => {
    return ProjectService.incrementAndGetIncidentCounter(projectId);
  },
  [NumberedRecordKind.IncidentEpisode]: (projectId: ObjectID) => {
    return ProjectService.incrementAndGetIncidentEpisodeCounter(projectId);
  },
  [NumberedRecordKind.Alert]: (projectId: ObjectID) => {
    return ProjectService.incrementAndGetAlertCounter(projectId);
  },
  [NumberedRecordKind.AlertEpisode]: (projectId: ObjectID) => {
    return ProjectService.incrementAndGetAlertEpisodeCounter(projectId);
  },
  [NumberedRecordKind.ScheduledMaintenance]: (projectId: ObjectID) => {
    return ProjectService.incrementAndGetScheduledMaintenanceCounter(projectId);
  },
};

const KINDS: Array<NumberedRecordKindInfo> = [...NUMBERED_RECORD_KINDS];

const INCIDENTS: NumberedRecordKindInfo = KINDS[0]!;

describePostgres("where a project's numbers start, on Postgres", () => {
  const schema: string = `record_numbers_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  let database: DataSource;
  let lockSpy: ReturnType<typeof getJestSpyOn>;

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  // A project as the migrated table holds one, with its counters as given.
  async function createProject(
    counters?: Dictionary<number>,
  ): Promise<ObjectID> {
    const projectId: ObjectID = ObjectID.generate();

    await query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "incidentNumberPrefix", "alertNumberPrefix") VALUES ($1, 'Moved from incident.io', $2, 1, 'INC-', 'ALT-')`,
      [projectId.toString(), `s${projectId.toString()}`],
    );

    for (const [column, value] of Object.entries(counters || {})) {
      await query(
        `UPDATE "${schema}"."Project" SET "${column}" = $1 WHERE "_id" = $2`,
        [value, projectId.toString()],
      );
    }

    return projectId;
  }

  async function storedValue(
    projectId: ObjectID,
    column: string,
  ): Promise<number | null> {
    const rows: Array<Record<string, unknown>> = await query(
      `SELECT "${column}" AS "value" FROM "${schema}"."Project" WHERE "_id" = $1`,
      [projectId.toString()],
    );

    const value: unknown = rows[0]?.["value"];

    return value === null || value === undefined ? null : Number(value);
  }

  // Someone in the project, holding exactly these permissions there.
  function callerHolding(
    projectId: ObjectID,
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    };

    return {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [projectId],
        globalPermissions: [Permission.Public, Permission.User],
      },
    };
  }

  async function setStart(
    projectId: ObjectID,
    data: Dictionary<number | string | null>,
    permissions?: Array<Permission>,
  ): Promise<void> {
    await ProjectService.updateOneById({
      id: projectId,
      data: data as never,
      props: callerHolding(projectId, permissions || [Permission.ProjectOwner]),
    });
  }

  async function refusalOf(work: Promise<unknown>): Promise<unknown> {
    try {
      await work;
    } catch (error) {
      return error;
    }

    return null;
  }

  async function take(
    kind: NumberedRecordKind,
    projectId: ObjectID,
  ): Promise<number> {
    return (await TAKE[kind](projectId)).counter;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["RECORD_NUMBERS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["RECORD_NUMBERS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["RECORD_NUMBERS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public`, max: 20 },
    });
    await database.initialize();
    await query(`CREATE SCHEMA "${schema}"`);
    await query(
      `CREATE TABLE "${schema}"."Project" (LIKE public."Project" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
      database as never,
    );

    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    // What follows a write: workflows, live updates, the audit log.
    getJestSpyOn(ProjectService, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(ProjectService, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    for (const recorded of ["recordUpdate", "recordDelete", "recordCreate"]) {
      getJestSpyOn(AuditLogService, recorded).mockResolvedValue(
        undefined as never,
      );
    }
    getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
      undefined as never,
    );

    // A number is one statement: nothing here may need a lock.
    lockSpy = getJestSpyOn(Semaphore, "lock").mockImplementation(
      (async (): Promise<never> => {
        throw new Error("No lock should be taken to number a record.");
      }) as never,
    );
  });

  afterEach(() => {
    expect(lockSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test("the migrated table holds every start, empty for a project that chose none", async () => {
    const projectId: ObjectID = await createProject();

    for (const info of KINDS) {
      expect([
        info.startsAtColumn,
        await storedValue(projectId, info.startsAtColumn),
      ]).toEqual([info.startsAtColumn, null]);
      expect([
        info.counterColumn,
        await storedValue(projectId, info.counterColumn),
      ]).toEqual([info.counterColumn, 0]);
    }
  });

  test("a project that chose nothing numbers from 1, as before", async () => {
    const projectId: ObjectID = await createProject();

    expect(await TAKE[NumberedRecordKind.Incident](projectId)).toEqual({
      counter: 1,
      prefix: "INC-",
    });
    expect(await take(NumberedRecordKind.Incident, projectId)).toBe(2);
    expect(await take(NumberedRecordKind.Incident, projectId)).toBe(3);
    expect(await storedValue(projectId, "incidentCounter")).toBe(3);
  });

  test("after a change, the first record gets the chosen number and the next ones count up", async () => {
    // 2,345 incidents came over from the old tool's numbering.
    const projectId: ObjectID = await createProject({ incidentCounter: 2345 });

    await setStart(projectId, { incidentNumbersStartAt: 10000 });

    expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(10000);
    expect(await TAKE[NumberedRecordKind.Incident](projectId)).toEqual({
      counter: 10000,
      prefix: "INC-",
    });
    expect(await take(NumberedRecordKind.Incident, projectId)).toBe(10001);
    expect(await take(NumberedRecordKind.Incident, projectId)).toBe(10002);

    // The start stays as chosen; the records have passed it.
    expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(10000);
    expect(await storedValue(projectId, "incidentCounter")).toBe(10002);
  });

  test("a start chosen as text, as the dashboard's field sends it, is stored as a number", async () => {
    const projectId: ObjectID = await createProject();

    await setStart(projectId, { incidentNumbersStartAt: "500" });

    expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(500);
    expect(await take(NumberedRecordKind.Incident, projectId)).toBe(500);
  });

  test("getNumbering says where each kind stands, as the Next Number card shows it", async () => {
    const projectId: ObjectID = await createProject({
      incidentCounter: 2345,
      alertCounter: 41,
    });

    await setStart(projectId, { incidentNumbersStartAt: 10000 });

    const numbering: Array<RecordNumbering> =
      await ProjectService.getNumbering(projectId);

    expect(numbering.slice(0, 3)).toEqual([
      {
        kind: NumberedRecordKind.Incident,
        prefix: "INC-",
        highestNumber: 2345,
        nextNumber: 10000,
        numbersStartAt: 10000,
      },
      {
        kind: NumberedRecordKind.IncidentEpisode,
        prefix: null,
        highestNumber: 0,
        nextNumber: 1,
        numbersStartAt: null,
      },
      {
        kind: NumberedRecordKind.Alert,
        prefix: "ALT-",
        highestNumber: 41,
        nextNumber: 42,
        numbersStartAt: null,
      },
    ]);

    await take(NumberedRecordKind.Incident, projectId);

    expect((await ProjectService.getNumbering(projectId))[0]).toEqual({
      kind: NumberedRecordKind.Incident,
      prefix: "INC-",
      highestNumber: 10000,
      nextNumber: 10001,
      numbersStartAt: 10000,
    });
  });

  describe("a number is never given twice", () => {
    test("a start at or below the highest number given out is refused, and nothing is written", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      for (const startsAt of [2345, 2000, 1]) {
        const error: unknown = await refusalOf(
          setStart(projectId, { incidentNumbersStartAt: startsAt }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toBe(
          "Incident Numbers Start At must be higher than 2345, the highest incident number used so far. A number is never used twice.",
        );
      }

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBeNull();
      expect(await storedValue(projectId, "incidentCounter")).toBe(2345);
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(2346);
    });

    test("a start just above the highest number is the same as none", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      await setStart(projectId, { incidentNumbersStartAt: 2346 });

      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(2346);
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(2347);
    });

    test("a start sent again as stored is no change, once records have passed it", async () => {
      const projectId: ObjectID = await createProject();

      await setStart(projectId, { incidentNumbersStartAt: 100 });
      await take(NumberedRecordKind.Incident, projectId);
      await take(NumberedRecordKind.Incident, projectId);

      // A Terraform apply sends every value it holds.
      await setStart(projectId, {
        incidentNumbersStartAt: 100,
        name: "Renamed by Terraform",
      } as never);

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(100);
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(102);
    });

    test("a typo can be undone while no record has used it", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      await setStart(projectId, { incidentNumbersStartAt: 100000 });
      await setStart(projectId, { incidentNumbersStartAt: 10000 });

      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(10000);
    });

    test("once a record has used a start, the start cannot go below it", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      await setStart(projectId, { incidentNumbersStartAt: 100000 });
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(100000);

      const error: unknown = await refusalOf(
        setStart(projectId, { incidentNumbersStartAt: 10000 }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toContain(
        "higher than 100000",
      );
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(100001);
    });

    test("clearing a start carries the numbers on from the highest one used", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      await setStart(projectId, { incidentNumbersStartAt: 100000 });
      await setStart(projectId, { incidentNumbersStartAt: null });

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBeNull();
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(2346);
    });

    test("a project renamed with a start already passed is not refused", async () => {
      const projectId: ObjectID = await createProject();

      await setStart(projectId, { incidentNumbersStartAt: 5 });
      for (let index: number = 0; index < 10; index++) {
        await take(NumberedRecordKind.Incident, projectId);
      }

      await setStart(projectId, { name: "Renamed" } as never);

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(5);
    });
  });

  describe("records created at the same moment", () => {
    test("each get a number of their own", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      const numbers: Array<number> = await Promise.all(
        Array.from({ length: 60 }, () => {
          return take(NumberedRecordKind.Incident, projectId);
        }),
      );

      expect(new Set(numbers).size).toBe(60);
      expect(
        [...numbers].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(
        Array.from({ length: 60 }, (_value: unknown, index: number) => {
          return 2346 + index;
        }),
      );
      expect(await storedValue(projectId, "incidentCounter")).toBe(2405);
    });

    /*
     * Numbers taken while the start is changed, again and again. Each
     * number is either the one after the number before it, or a start that
     * was chosen: never one given out already, and never one between.
     */
    test("each get a number of their own while the start changes", async () => {
      const projectId: ObjectID = await createProject({
        incidentCounter: 2345,
      });

      const starts: Array<number> = [10000, 20000, 30000, 40000];

      const changes: Promise<void> = (async (): Promise<void> => {
        for (const startsAt of starts) {
          await setStart(projectId, { incidentNumbersStartAt: startsAt });
        }
      })();

      const takes: Promise<Array<number>> = Promise.all(
        Array.from({ length: 80 }, () => {
          return take(NumberedRecordKind.Incident, projectId);
        }),
      );

      const [, numbers] = await Promise.all([changes, takes]);

      expect(new Set(numbers).size).toBe(80);

      const sorted: Array<number> = [...numbers].sort(
        (a: number, b: number) => {
          return a - b;
        },
      );

      expect(sorted[0]).toBeGreaterThanOrEqual(2346);

      let previous: number = 2345;

      for (const number of sorted) {
        expect({
          number,
          previous,
          followsOn: number === previous + 1 || starts.includes(number),
        }).toEqual({ number, previous, followsOn: true });
        previous = number;
      }

      // The last start chosen is the one that stays.
      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(
        40000,
      );

      // The next record continues after every number given out.
      const next: number = await take(NumberedRecordKind.Incident, projectId);
      expect(next).toBe(Math.max(sorted[sorted.length - 1]! + 1, 40000));
    });

    test("of different kinds, at once, keep to their own counters", async () => {
      const projectId: ObjectID = await createProject();

      await setStart(projectId, {
        incidentNumbersStartAt: 1000,
        alertNumbersStartAt: 5000,
      });

      const work: Array<Promise<[NumberedRecordKind, number]>> = [];

      for (let index: number = 0; index < 20; index++) {
        for (const kind of [
          NumberedRecordKind.Incident,
          NumberedRecordKind.Alert,
          NumberedRecordKind.AlertEpisode,
        ]) {
          work.push(
            take(kind, projectId).then(
              (number: number): [NumberedRecordKind, number] => {
                return [kind, number];
              },
            ),
          );
        }
      }

      const taken: Array<[NumberedRecordKind, number]> =
        await Promise.all(work);

      const numbersOf: (kind: NumberedRecordKind) => Array<number> = (
        kind: NumberedRecordKind,
      ): Array<number> => {
        return taken
          .filter((entry: [NumberedRecordKind, number]): boolean => {
            return entry[0] === kind;
          })
          .map((entry: [NumberedRecordKind, number]): number => {
            return entry[1];
          })
          .sort((a: number, b: number) => {
            return a - b;
          });
      };

      const run: (from: number) => Array<number> = (from: number) => {
        return Array.from({ length: 20 }, (_value: unknown, index: number) => {
          return from + index;
        });
      };

      expect(numbersOf(NumberedRecordKind.Incident)).toEqual(run(1000));
      expect(numbersOf(NumberedRecordKind.Alert)).toEqual(run(5000));
      expect(numbersOf(NumberedRecordKind.AlertEpisode)).toEqual(run(1));
    });
  });

  describe.each(KINDS)("$kind numbers", (info: NumberedRecordKindInfo) => {
    test("start where chosen and count up, leaving every other kind alone", async () => {
      const projectId: ObjectID = await createProject({
        [info.counterColumn]: 12,
      });

      await setStart(projectId, { [info.startsAtColumn]: 700 });

      expect(await take(info.kind, projectId)).toBe(700);
      expect(await take(info.kind, projectId)).toBe(701);
      expect(await take(info.kind, projectId)).toBe(702);

      for (const other of KINDS) {
        if (other.kind === info.kind) {
          continue;
        }

        expect([
          other.counterColumn,
          await storedValue(projectId, other.counterColumn),
          await storedValue(projectId, other.startsAtColumn),
        ]).toEqual([other.counterColumn, 0, null]);
      }
    });

    test("refuse a start at or below their own highest number", async () => {
      const projectId: ObjectID = await createProject({
        [info.counterColumn]: 12,
      });

      const error: unknown = await refusalOf(
        setStart(projectId, { [info.startsAtColumn]: 12 }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        `${info.title} must be higher than 12, the highest ${info.recordName} number used so far. A number is never used twice.`,
      );
      expect(await storedValue(projectId, info.startsAtColumn)).toBeNull();
    });
  });

  describe("who may change where numbers start", () => {
    // Changing a record needs reading it too: Edit Project comes with Read Project.
    test.each([
      [[Permission.ProjectOwner]],
      [[Permission.ProjectAdmin]],
      [[Permission.EditProject, Permission.ReadProject]],
    ])("%j may", async (permissions: Array<Permission>) => {
      const projectId: ObjectID = await createProject();

      await setStart(projectId, { incidentNumbersStartAt: 300 }, permissions);

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBe(300);
    });

    test.each([
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.IncidentAdmin,
      Permission.ManageProjectBilling,
    ])(
      "a %s may not, and is not told the highest number",
      async (permission: Permission) => {
        const projectId: ObjectID = await createProject({
          incidentCounter: 2345,
        });

        const error: unknown = await refusalOf(
          setStart(projectId, { incidentNumbersStartAt: 100 }, [permission]),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(String((error as Error).message)).not.toContain("2345");
        expect(
          await storedValue(projectId, "incidentNumbersStartAt"),
        ).toBeNull();
      },
    );

    /*
     * Their update is held to their own project (the tenant), whatever id it
     * names: it never reaches this one.
     */
    test("someone in another project does not change this one's", async () => {
      const projectId: ObjectID = await createProject();
      const otherProjectId: ObjectID = await createProject();

      await refusalOf(
        ProjectService.updateOneById({
          id: projectId,
          data: { incidentNumbersStartAt: 300 } as never,
          props: callerHolding(otherProjectId, [Permission.ProjectOwner]),
        }),
      );

      expect(await storedValue(projectId, "incidentNumbersStartAt")).toBeNull();
      expect(await take(NumberedRecordKind.Incident, projectId)).toBe(1);
    });
  });

  test(`${INCIDENTS.title} reads back as chosen through the API's own read`, async () => {
    const projectId: ObjectID = await createProject();

    await setStart(projectId, { incidentNumbersStartAt: 4242 });

    const project: unknown = await ProjectService.findOneById({
      id: projectId,
      select: { incidentNumbersStartAt: true } as never,
      props: callerHolding(projectId, [Permission.ReadProject]),
    });

    expect(
      (project as Record<string, unknown>)?.["incidentNumbersStartAt"],
    ).toBe(4242);
  });
});
