import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import MonitorTestService from "../../../Server/Services/MonitorTestService";
import NetworkDeviceDiagnosticService from "../../../Server/Services/NetworkDeviceDiagnosticService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceDiagnosticStatus } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticType";
import {
  createReferencingTable,
  expectClaimLocksHoldOnlyTheRow,
  expectConcurrentClaimsHandOutEachRowOnce,
  expectHeldRowSkipped,
  expectOneSelfCommittingClaim,
  statementsSentBy,
} from "../TestingUtils/Postgres/ClaimRowLocks";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * THE CLAIMS OF A PROBE'S ON-DEMAND JOBS, EXECUTED on Postgres (OneUptime
 * issue #7392): the monitor tests someone started from the dashboard
 * (MonitorTestService.claimMonitorTestsForProbing) and the ping, traceroute
 * and SNMP walk requests of a network device
 * (NetworkDeviceDiagnosticService.claimPendingForProbe). Packet captures and
 * the VMware and OpenStack connection tests are claimed the same way; their
 * own suites (PacketCaptureSqlPostgres, VMwareProbeCollectionSqlPostgres,
 * OpenStackProbeCollectionSqlPostgres) run those.
 *
 * Each claim was a transaction - START TRANSACTION, SELECT ... FOR UPDATE
 * SKIP LOCKED, an UPDATE of the ids, COMMIT - on every probe tick, even with
 * nothing to hand out, holding FOR UPDATE across the round trips. Each is
 * now one self-committing statement that locks the rows FOR NO KEY UPDATE
 * SKIP LOCKED and moves them on. So, for each:
 *
 *   - it is one round trip, with no transaction around it;
 *   - it hands out what it did before, in the same order, and moves it on;
 *   - a row another writer holds is skipped at once, never waited for, and
 *     handed out once it is free;
 *   - claims at once hand out each row exactly once;
 *   - while its locks are held, a row that names a claimed one by a foreign
 *     key is still written;
 *   - and its own rules: a monitor test whose probe never answered is
 *     handed out again after ten minutes, and a diagnostic nobody is still
 *     waiting for is left alone.
 *
 * Opt in with RUN_POSTGRES_ON_DEMAND_PROBE_JOB_CLAIM_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The MonitorTest and
 * NetworkDeviceDiagnostic tables' STRUCTURE is cloned into a unique schema
 * (search_path holds only that schema), dropped afterwards. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * ON_DEMAND_PROBE_JOB_CLAIM_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from ON_DEMAND_PROBE_JOB_CLAIM_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ON_DEMAND_PROBE_JOB_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = ["MonitorTest", "NetworkDeviceDiagnostic"];

const DASHES: RegExp = /-/g;

// A monitor test claimed longer ago than this, and never answered, is handed out again.
const STALE_TEST_CLAIM_IN_MINUTES: number = 10;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function idsOf(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

describePostgres("on-demand probe job claims on Postgres", () => {
  const schema: string = `on_demand_claims_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a monitor test, or a diagnostic, by a foreign key.
  let testReferences: string;
  let diagnosticReferences: string;

  const projectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const otherProbeId: ObjectID = ObjectID.generate();
  const deviceId: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["ON_DEMAND_PROBE_JOB_CLAIM_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["ON_DEMAND_PROBE_JOB_CLAIM_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ON_DEMAND_PROBE_JOB_CLAIM_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what a statement reads; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    testReferences = await createReferencingTable({
      database: database,
      schema: schema,
      parentTable: "MonitorTest",
    });
    diagnosticReferences = await createReferencingTable({
      database: database,
      schema: schema,
      parentTable: "NetworkDeviceDiagnostic",
    });

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of [testReferences, diagnosticReferences, ...TABLES]) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("monitor tests", () => {
    interface TestRow {
      isInQueue: boolean | null;
      updatedAt: Date;
    }

    async function insertTest(
      data: {
        probe?: ObjectID;
        createdMinutesAgo?: number;
        // A test handed to a probe that long ago.
        claimedMinutesAgo?: number;
        answered?: boolean;
        deleted?: boolean;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const isInQueue: boolean = data.claimedMinutesAgo === undefined;

      await database.query(
        `INSERT INTO "${schema}"."MonitorTest"
          ("_id", "projectId", "probeId", "monitorType", "isInQueue",
           "monitorStepProbeResponse", "createdAt", "updatedAt", "deletedAt", "version")
         VALUES ($1, $2, $3, 'Website', $4, $5, $6, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          (data.probe || probeId).toString(),
          isInQueue,
          data.answered ? JSON.stringify({ step: { isOnline: true } }) : null,
          minutesAgo(data.createdMinutesAgo ?? 0),
          minutesAgo(data.claimedMinutesAgo ?? data.createdMinutesAgo ?? 0),
          data.deleted ? new Date() : null,
        ],
      );

      return id;
    }

    async function readTest(id: ObjectID): Promise<TestRow> {
      const rows: Array<TestRow> = await database.query(
        `SELECT "isInQueue", "updatedAt" FROM "${schema}"."MonitorTest" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    async function claim(limit: number = 10): Promise<Array<string>> {
      return idsOf(
        await MonitorTestService.claimMonitorTestsForProbing({
          probeId: probeId,
          limit: limit,
        }),
      );
    }

    test("hands a probe its queued tests, oldest first, and takes them out of the queue; leaves another probe's, answered and deleted ones", async () => {
      const newer: ObjectID = await insertTest({ createdMinutesAgo: 1 });
      const older: ObjectID = await insertTest({ createdMinutesAgo: 3 });
      const others: ObjectID = await insertTest({ probe: otherProbeId });
      const answered: ObjectID = await insertTest({ answered: true });
      const deleted: ObjectID = await insertTest({ deleted: true });

      const before: number = Date.now();

      expect(await claim()).toEqual([older.toString(), newer.toString()]);

      for (const id of [older, newer]) {
        const row: TestRow = await readTest(id);
        expect(row.isInQueue).toBe(false);
        // now() on the database's clock: the start of the claim's own statement.
        expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 5000);
      }

      for (const id of [others, answered, deleted]) {
        expect((await readTest(id)).isInQueue).toBe(true);
      }

      // Claimed just now: not handed out again.
      expect(await claim()).toEqual([]);
    });

    test("a test whose probe never answered is handed out again once its claim is over ten minutes old - not before, and not once answered", async () => {
      const stale: ObjectID = await insertTest({
        createdMinutesAgo: 20,
        claimedMinutesAgo: STALE_TEST_CLAIM_IN_MINUTES + 1,
      });
      const recent: ObjectID = await insertTest({
        createdMinutesAgo: 20,
        claimedMinutesAgo: STALE_TEST_CLAIM_IN_MINUTES - 5,
      });
      const answered: ObjectID = await insertTest({
        createdMinutesAgo: 20,
        claimedMinutesAgo: STALE_TEST_CLAIM_IN_MINUTES + 1,
        answered: true,
      });

      expect(await claim()).toEqual([stale.toString()]);
      expect((await readTest(stale)).updatedAt.getTime()).toBeGreaterThan(
        minutesAgo(1).getTime(),
      );

      for (const id of [recent, answered]) {
        expect((await readTest(id)).isInQueue).toBe(false);
        expect((await readTest(id)).updatedAt.getTime()).toBeLessThan(
          minutesAgo(1).getTime(),
        );
      }
    });

    test("hands out no more than the limit, oldest first", async () => {
      const third: ObjectID = await insertTest({ createdMinutesAgo: 1 });
      const first: ObjectID = await insertTest({ createdMinutesAgo: 3 });
      const second: ObjectID = await insertTest({ createdMinutesAgo: 2 });

      expect(await claim(2)).toEqual([first.toString(), second.toString()]);
      expect(await claim(2)).toEqual([third.toString()]);
      expect(await claim(2)).toEqual([]);
    });

    test("is one statement, with no transaction around it - with tests to hand out, and with none", async () => {
      await insertTest({});

      const withWork: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claim();
        });

      expect(withWork.result).toHaveLength(1);
      expect(withWork.statements).toHaveLength(1);
      expectOneSelfCommittingClaim(withWork.statements);

      const empty: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claim();
        });

      expect(empty.result).toEqual([]);
      expect(empty.statements).toHaveLength(1);
    });

    test("skips a test another replica holds, rather than waiting for it, and hands it out once it is free", async () => {
      const held: ObjectID = await insertTest({ createdMinutesAgo: 3 });
      const free: ObjectID = await insertTest({ createdMinutesAgo: 1 });

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "MonitorTest",
        held: held,
        free: [free],
        claim: (): Promise<Array<string>> => {
          return claim();
        },
      });
    });

    test("claims at once hand out each test exactly once", async () => {
      const due: Array<string> = [];

      for (let index: number = 0; index < 16; index++) {
        due.push(
          (await insertTest({ createdMinutesAgo: 16 - index })).toString(),
        );
      }

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: due,
        claim: (limit: number): Promise<Array<string>> => {
          return claim(limit);
        },
      });
    });

    test("while a claim's row locks are held, a row that names the test is still written; only the test itself waits", async () => {
      const id: ObjectID = await insertTest({});

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: MonitorTestService,
        table: "MonitorTest",
        referencingTable: testReferences,
        id: id,
        claim: (): Promise<Array<string>> => {
          return claim();
        },
      });
    });
  });

  describe("network device diagnostics", () => {
    interface DiagnosticRow {
      status: string;
      startedAt: Date | null;
      updatedAt: Date;
    }

    async function insertDiagnostic(
      data: {
        probe?: ObjectID;
        status?: string;
        createdMinutesAgo?: number;
        deleted?: boolean;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const createdAt: Date = minutesAgo(data.createdMinutesAgo ?? 0);

      await database.query(
        `INSERT INTO "${schema}"."NetworkDeviceDiagnostic"
          ("_id", "projectId", "networkDeviceId", "probeId", "diagnosticType",
           "hostname", "status", "createdAt", "updatedAt", "deletedAt", "version")
         VALUES ($1, $2, $3, $4, $5, '10.0.0.1', $6, $7, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          deviceId.toString(),
          (data.probe || probeId).toString(),
          NetworkDeviceDiagnosticType.Ping,
          data.status || NetworkDeviceDiagnosticStatus.Pending,
          createdAt,
          data.deleted ? new Date() : null,
        ],
      );

      return id;
    }

    async function readDiagnostic(id: ObjectID): Promise<DiagnosticRow> {
      const rows: Array<DiagnosticRow> = await database.query(
        `SELECT "status", "startedAt", "updatedAt" FROM "${schema}"."NetworkDeviceDiagnostic" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    async function claim(limit: number = 10): Promise<Array<string>> {
      return idsOf(
        await NetworkDeviceDiagnosticService.claimPendingForProbe({
          probeId: probeId,
          limit: limit,
        }),
      );
    }

    test("hands a probe its Pending diagnostics inside the claim window, oldest first, and marks them In Progress with a start time; leaves the rest", async () => {
      const newer: ObjectID = await insertDiagnostic({ createdMinutesAgo: 1 });
      const older: ObjectID = await insertDiagnostic({ createdMinutesAgo: 2 });
      // Whoever asked for it has long since stopped waiting.
      const abandoned: ObjectID = await insertDiagnostic({
        createdMinutesAgo:
          NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES + 1,
      });
      const others: ObjectID = await insertDiagnostic({ probe: otherProbeId });
      const deleted: ObjectID = await insertDiagnostic({ deleted: true });
      const completed: ObjectID = await insertDiagnostic({
        status: NetworkDeviceDiagnosticStatus.Completed,
      });
      const running: ObjectID = await insertDiagnostic({
        status: NetworkDeviceDiagnosticStatus.InProgress,
      });

      expect(await claim()).toEqual([older.toString(), newer.toString()]);

      for (const id of [older, newer]) {
        const row: DiagnosticRow = await readDiagnostic(id);
        expect(row.status).toBe(NetworkDeviceDiagnosticStatus.InProgress);
        expect(row.startedAt).toBeInstanceOf(Date);
      }

      for (const id of [abandoned, others, deleted]) {
        const row: DiagnosticRow = await readDiagnostic(id);
        expect(row.status).toBe(NetworkDeviceDiagnosticStatus.Pending);
        expect(row.startedAt).toBeNull();
      }

      expect((await readDiagnostic(completed)).status).toBe(
        NetworkDeviceDiagnosticStatus.Completed,
      );
      expect((await readDiagnostic(running)).startedAt).toBeNull();

      // In Progress now: not handed out again.
      expect(await claim()).toEqual([]);
    });

    test("hands out no more than the limit, oldest first", async () => {
      const third: ObjectID = await insertDiagnostic({ createdMinutesAgo: 1 });
      const first: ObjectID = await insertDiagnostic({ createdMinutesAgo: 3 });
      const second: ObjectID = await insertDiagnostic({ createdMinutesAgo: 2 });

      expect(await claim(2)).toEqual([first.toString(), second.toString()]);
      expect(await claim(2)).toEqual([third.toString()]);
      expect(await claim(2)).toEqual([]);
    });

    test("is one statement, with no transaction around it - with diagnostics to hand out, and with none", async () => {
      await insertDiagnostic({});

      const withWork: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claim();
        });

      expect(withWork.result).toHaveLength(1);
      expect(withWork.statements).toHaveLength(1);
      expectOneSelfCommittingClaim(withWork.statements);

      const empty: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claim();
        });

      expect(empty.result).toEqual([]);
      expect(empty.statements).toHaveLength(1);
    });

    test("skips a diagnostic another replica holds, rather than waiting for it, and hands it out once it is free", async () => {
      const held: ObjectID = await insertDiagnostic({ createdMinutesAgo: 3 });
      const free: ObjectID = await insertDiagnostic({ createdMinutesAgo: 1 });

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "NetworkDeviceDiagnostic",
        held: held,
        free: [free],
        claim: (): Promise<Array<string>> => {
          return claim();
        },
      });
    });

    test("claims at once hand out each diagnostic exactly once", async () => {
      const due: Array<string> = [];

      for (let index: number = 0; index < 16; index++) {
        due.push(
          (
            await insertDiagnostic({ createdMinutesAgo: (16 - index) / 4 })
          ).toString(),
        );
      }

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: due,
        claim: (limit: number): Promise<Array<string>> => {
          return claim(limit);
        },
      });
    });

    test("while a claim's row locks are held, a row that names the diagnostic is still written; only the diagnostic itself waits", async () => {
      const id: ObjectID = await insertDiagnostic({});

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: NetworkDeviceDiagnosticService,
        table: "NetworkDeviceDiagnostic",
        referencingTable: diagnosticReferences,
        id: id,
        claim: (): Promise<Array<string>> => {
          return claim();
        },
      });
    });

    /*
     * What the probe found, written as one self-committing statement
     * (OneUptime issue #8870): it was a transaction around the UPDATE -
     * START TRANSACTION, the UPDATE, COMMIT - three round trips for one.
     */
    async function report(data: {
      id: ObjectID;
      probe?: ObjectID;
      status: NetworkDeviceDiagnosticStatus;
      statusMessage?: string;
    }): Promise<boolean> {
      return await NetworkDeviceDiagnosticService.recordReport({
        probeId: data.probe || probeId,
        report: {
          networkDeviceDiagnosticId: data.id.toString(),
          status: data.status,
          statusMessage: data.statusMessage,
          pingResult:
            data.status === NetworkDeviceDiagnosticStatus.Completed
              ? { isOnline: true, failureCause: "" }
              : undefined,
        },
      });
    }

    async function readReport(id: ObjectID): Promise<{
      status: string;
      statusMessage: string | null;
      completedAt: Date | null;
    }> {
      const rows: Array<{
        status: string;
        statusMessage: string | null;
        completedAt: Date | null;
      }> = await database.query(
        `SELECT "status", "statusMessage", "completedAt" FROM "${schema}"."NetworkDeviceDiagnostic" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    test("a report settles the probe's diagnostic in one statement, with no transaction around it - written or refused", async () => {
      const running: ObjectID = await insertDiagnostic({
        status: NetworkDeviceDiagnosticStatus.InProgress,
      });

      const written: { result: boolean; statements: Array<string> } =
        await statementsSentBy(() => {
          return report({
            id: running,
            status: NetworkDeviceDiagnosticStatus.Completed,
          });
        });

      expect(written.result).toBe(true);
      expect(written.statements).toHaveLength(1);
      expect(written.statements[0]!.trim()).toMatch(
        /^UPDATE "NetworkDeviceDiagnostic"/,
      );

      const row: { status: string; completedAt: Date | null } =
        await readReport(running);

      expect(row.status).toBe(NetworkDeviceDiagnosticStatus.Completed);
      expect(row.completedAt).toBeInstanceOf(Date);

      // Already Completed: refused, in the same one statement.
      const refused: { result: boolean; statements: Array<string> } =
        await statementsSentBy(() => {
          return report({
            id: running,
            status: NetworkDeviceDiagnosticStatus.Failed,
            statusMessage: "A late duplicate.",
          });
        });

      expect(refused.result).toBe(false);
      expect(refused.statements).toHaveLength(1);
    });

    test("another probe's report writes nothing, a Completed one is never written over, and a Failed one may be corrected", async () => {
      const running: ObjectID = await insertDiagnostic({
        status: NetworkDeviceDiagnosticStatus.InProgress,
      });

      expect(
        await report({
          id: running,
          probe: otherProbeId,
          status: NetworkDeviceDiagnosticStatus.Completed,
        }),
      ).toBe(false);
      expect((await readReport(running)).status).toBe(
        NetworkDeviceDiagnosticStatus.InProgress,
      );

      expect(
        await report({
          id: running,
          status: NetworkDeviceDiagnosticStatus.Failed,
          statusMessage: "The device did not answer.",
        }),
      ).toBe(true);
      expect(await readReport(running)).toMatchObject({
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: "The device did not answer.",
      });

      // A run that worked after all corrects the failure.
      expect(
        await report({
          id: running,
          status: NetworkDeviceDiagnosticStatus.Completed,
        }),
      ).toBe(true);

      // And nothing writes over the answer the dashboard has shown.
      expect(
        await report({
          id: running,
          status: NetworkDeviceDiagnosticStatus.Failed,
          statusMessage: "Too late.",
        }),
      ).toBe(false);
      expect(await readReport(running)).toMatchObject({
        status: NetworkDeviceDiagnosticStatus.Completed,
        statusMessage: null,
      });

      // A diagnostic that is gone takes no report.
      const deleted: ObjectID = await insertDiagnostic({
        status: NetworkDeviceDiagnosticStatus.InProgress,
        deleted: true,
      });

      expect(
        await report({
          id: deleted,
          status: NetworkDeviceDiagnosticStatus.Completed,
        }),
      ).toBe(false);
    });
  });
});
