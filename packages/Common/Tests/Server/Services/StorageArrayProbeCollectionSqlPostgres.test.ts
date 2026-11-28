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
import Entities from "../../../Models/DatabaseModels/Index";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StorageArrayConnectionService from "../../../Server/Services/StorageArrayConnectionService";
import StorageArrayConnectionTestService from "../../../Server/Services/StorageArrayConnectionTestService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import { StorageArrayCollectionReportOutcome } from "../../../Server/Utils/StorageArray/StorageArrayProbeCollectionStore";
import {
  createReferencingTable,
  expectClaimLocksHoldOnlyTheRow,
  expectConcurrentClaimsHandOutEachRowOnce,
  expectHeldRowSkipped,
  expectOneSelfCommittingClaim,
  statementsSentBy,
} from "../TestingUtils/Postgres/ClaimRowLocks";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayCollectionErrorCode from "../../../Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayCollectionStatus from "../../../Types/StorageArray/Collection/StorageArrayCollectionStatus";
import StorageArrayConnectionTestStatus from "../../../Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import {
  StorageArrayCollectionJob,
  StorageArrayConnectionTestJob,
} from "../../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import { DataSource } from "typeorm";

/*
 * Storage array collection's hand-written SQL (#11004) against a real
 * Postgres: the probe's claim of the connections it reads (one statement,
 * FOR NO KEY UPDATE SKIP LOCKED, its interval rule, its tenancy backstop,
 * the subscription rule, and the locks it holds), the set-aside of what
 * nothing may read, what a report writes - and only for the current
 * settings - and the connection tests' claim (the password wiped once it
 * is read), report and expiry. The unit suites pin the rules; this runs
 * the statements, as VMwareProbeCollectionSqlPostgres runs VMware's.
 *
 * Opt in with RUN_POSTGRES_STORAGE_ARRAY_PROBE_COLLECTION_TESTS=true against
 * a Postgres migrated to the current head. The Project, Probe,
 * StorageArrayConnection and StorageArrayConnectionTest tables' STRUCTURE is
 * cloned into a unique schema (search_path holds only that schema), dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from STORAGE_ARRAY_PROBE_COLLECTION_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from
 * STORAGE_ARRAY_PROBE_COLLECTION_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_STORAGE_ARRAY_PROBE_COLLECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "StorageArrayConnection",
  "StorageArrayConnectionTest",
];

const DASHES: RegExp = /-/g;

// What a transaction around a claim would send.
const TRANSACTION_CONTROL: RegExp =
  /^\s*(START TRANSACTION|BEGIN|COMMIT|ROLLBACK)\b/i;

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

describePostgres("storage array probe collection SQL against Postgres", () => {
  const schema: string = `storage_array_probe_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a connection by a foreign key, as a test row does.
  let referencingTable: string;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const siblingProbeId: ObjectID = ObjectID.generate();
  const foreignProbeId: ObjectID = ObjectID.generate();
  const globalProbeId: ObjectID = ObjectID.generate();

  let connectionCount: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["STORAGE_ARRAY_PROBE_COLLECTION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["STORAGE_ARRAY_PROBE_COLLECTION_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["STORAGE_ARRAY_PROBE_COLLECTION_TEST_DATABASE_NAME"] ||
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

    referencingTable = await createReferencingTable({
      database: database,
      schema: schema,
      parentTable: "StorageArrayConnection",
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
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);

    await database.query(`DELETE FROM "${schema}"."${referencingTable}"`);
    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject({ id: projectId });
    await insertProject({ id: otherProjectId });
    await insertProbe({ id: probeId, projectId: projectId });
    await insertProbe({ id: siblingProbeId, projectId: projectId });
    await insertProbe({ id: foreignProbeId, projectId: otherProjectId });
    await insertProbe({
      id: globalProbeId,
      projectId: null,
      isGlobalProbe: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface ConnectionRow {
    _id: string;
    nextCollectionAt: Date | null;
    collectionStatus: string | null;
    collectionErrorCode: string | null;
    collectionError: string | null;
    presentedCertificate: Record<string, unknown> | null;
    collectionSummary: Record<string, unknown> | null;
    lastCollectionAt: Date | null;
    lastSuccessfulCollectionAt: Date | null;
    collectionSettingsVersion: number;
  }

  interface TestRow {
    _id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    password: string | null;
    claimedAt: Date | null;
    completedAt: Date | null;
    summary: Record<string, unknown> | null;
    presentedCertificate: Record<string, unknown> | null;
  }

  async function insertProject(data: {
    id: ObjectID;
    subscriptionStatus?: SubscriptionStatus | null;
    deleted?: boolean;
    blocked?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "isBlocked", "deletedAt")
       VALUES ($1, $2, $3, NULL, $4, $5)`,
      [
        data.id.toString(),
        `Project ${data.id.toString()}`,
        data.subscriptionStatus ?? null,
        Boolean(data.blocked),
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function insertProbe(data: {
    id: ObjectID;
    projectId: ObjectID | null;
    isGlobalProbe?: boolean;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe", "deletedAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        data.id.toString(),
        data.projectId ? data.projectId.toString() : null,
        `Probe ${data.id.toString()}`,
        Boolean(data.isGlobalProbe),
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function insertConnection(
    data: {
      project?: ObjectID;
      probe?: ObjectID | null;
      storageSystem?: string;
      isPasswordSet?: boolean;
      password?: string | null;
      address?: string | null;
      username?: string | null;
      nextCollectionAt?: Date | null;
      intervalInMinutes?: number | null;
      settingsVersion?: number;
      fingerprint?: string | null;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    connectionCount++;

    await database.query(
      `INSERT INTO "${schema}"."StorageArrayConnection"
        ("_id", "projectId", "name", "storageSystem", "address", "username",
         "password", "isPasswordSet", "collectionProbeId", "trustedCertificateFingerprint",
         "collectionIntervalInMinutes", "nextCollectionAt", "collectionSettingsVersion",
         "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), $14, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `Unisphere ${connectionCount}`,
        data.storageSystem || "dell.powermax",
        data.address === undefined
          ? `https://unisphere-${connectionCount}.example.com:8443`
          : data.address,
        data.username === undefined ? "oneuptime-monitor" : data.username,
        data.password === null
          ? null
          : await Encryption.encrypt(
              data.password || `secret-${connectionCount}`,
            ),
        data.isPasswordSet ?? true,
        data.probe === null ? null : (data.probe || probeId).toString(),
        data.fingerprint ?? null,
        data.intervalInMinutes === undefined ? 5 : data.intervalInMinutes,
        data.nextCollectionAt === undefined
          ? minutesFromNow(-1)
          : data.nextCollectionAt,
        data.settingsVersion ?? 0,
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function readConnection(id: ObjectID): Promise<ConnectionRow> {
    const rows: Array<ConnectionRow> = await database.query(
      `SELECT * FROM "${schema}"."StorageArrayConnection" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  async function insertTest(
    data: {
      project?: ObjectID;
      probe?: ObjectID;
      status?: StorageArrayConnectionTestStatus;
      createdAt?: Date;
      claimedAt?: Date | null;
      password?: string | null;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."StorageArrayConnectionTest"
        ("_id", "projectId", "probeId", "storageSystem", "address", "username", "password",
         "trustedCertificateFingerprint", "status", "claimedAt", "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, 'dell.powermax', 'https://unisphere.example.com:8443', 'oneuptime-monitor', $4, $5, $6, $7, $8, $8, $9, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        (data.probe || probeId).toString(),
        data.password === null
          ? null
          : await Encryption.encrypt(data.password || "test-secret"),
        FINGERPRINT,
        data.status || StorageArrayConnectionTestStatus.Pending,
        data.claimedAt ?? null,
        data.createdAt || new Date(),
        data.deleted ? new Date() : null,
      ],
    );
    return id;
  }

  async function readTest(id: ObjectID): Promise<TestRow> {
    const rows: Array<TestRow> = await database.query(
      `SELECT * FROM "${schema}"."StorageArrayConnectionTest" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  function idsOf(jobs: Array<StorageArrayCollectionJob>): Array<string> {
    return jobs.map((job: StorageArrayCollectionJob): string => {
      return job.storageArrayConnectionId;
    });
  }

  async function claim(
    limit: number = 10,
    running: Array<string> = [],
    probe: ObjectID = probeId,
  ): Promise<Array<StorageArrayCollectionJob>> {
    return await StorageArrayConnectionService.claimForCollection({
      probeId: probe,
      runningStorageArrayConnectionIds: running,
      limit: limit,
    });
  }

  describe("the probe's claim of the connections it reads", () => {
    test("hands the probe only its due, password-saved connections of live projects - never one it is running - oldest first", async () => {
      const neverCollected: ObjectID = await insertConnection({
        nextCollectionAt: null,
      });
      const due: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(-3),
        intervalInMinutes: 7,
        fingerprint: FINGERPRINT.replace(/:/g, "").toLowerCase(),
        password: "the-real-secret",
        settingsVersion: 4,
      });

      const notDue: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(5),
      });
      const noPassword: ObjectID = await insertConnection({
        isPasswordSet: false,
      });
      const noAddress: ObjectID = await insertConnection({ address: null });
      const noUser: ObjectID = await insertConnection({ username: null });
      const unknownPlatform: ObjectID = await insertConnection({
        // No probe reads it (StorageArrayProbeCollectors).
        storageSystem: "example.not-a-probe-platform",
      });
      const deleted: ObjectID = await insertConnection({ deleted: true });
      const running: ObjectID = await insertConnection({});
      const anotherProbes: ObjectID = await insertConnection({
        probe: siblingProbeId,
      });
      // A row naming this probe from another project: never handed out.
      const otherProjects: ObjectID = await insertConnection({
        project: otherProjectId,
      });

      const untouched: Array<ObjectID> = [notDue, running, anotherProbes];
      const uncollectable: Array<ObjectID> = [
        noPassword,
        noAddress,
        noUser,
        unknownPlatform,
        deleted,
        otherProjects,
      ];

      const before: Map<string, Date | null> = new Map();
      for (const id of untouched) {
        before.set(id.toString(), (await readConnection(id)).nextCollectionAt);
      }

      const claimedAt: number = Date.now();
      const jobs: Array<StorageArrayCollectionJob> = await claim(10, [
        running.toString(),
      ]);

      expect(idsOf(jobs)).toEqual([due.toString()]);
      // A connection never collected is made due by the set-aside.
      expect(
        (await readConnection(neverCollected)).nextCollectionAt!.getTime(),
      ).toBeLessThanOrEqual(Date.now());

      // The password decrypted for the probe, the fingerprint normalized.
      expect(jobs[0]).toEqual({
        storageArrayConnectionId: due.toString(),
        connectionName: expect.any(String),
        storageSystem: "dell.powermax",
        address: expect.stringMatching(
          /^https:\/\/unisphere-\d+\.example\.com:8443$/,
        ),
        username: "oneuptime-monitor",
        password: "the-real-secret",
        trustedCertificateFingerprint: FINGERPRINT,
        collectionIntervalInMinutes: 7,
        settingsVersion: 4,
      });

      const movedBy: number =
        (await readConnection(due)).nextCollectionAt!.getTime() - Date.now();
      expect(movedBy).toBeGreaterThan(7 * 60_000 - 30_000);
      expect(movedBy).toBeLessThanOrEqual(7 * 60_000);

      for (const id of untouched) {
        expect({
          id: id.toString(),
          next: (await readConnection(id)).nextCollectionAt,
        }).toEqual({ id: id.toString(), next: before.get(id.toString()) });
      }

      // Set aside a quarter of an hour on, plus the spread (ClaimSetAside).
      for (const id of uncollectable) {
        const next: number = (
          await readConnection(id)
        ).nextCollectionAt!.getTime();
        expect(next).toBeGreaterThanOrEqual(
          claimedAt + SET_ASIDE_FOR_MINUTES * 60_000,
        );
        expect(next).toBeLessThanOrEqual(
          Date.now() +
            (SET_ASIDE_FOR_MINUTES + SET_ASIDE_SPREAD_IN_MINUTES) * 60_000,
        );
      }

      // A second claim right away hands out the one made due, nothing twice.
      expect(idsOf(await claim(10, [running.toString()]))).toEqual([
        neverCollected.toString(),
      ]);
      expect(await claim(10, [running.toString()])).toEqual([]);
    });

    test("a project that is deleted, blocked or whose subscription ended is not read", async () => {
      const deletedProjectId: ObjectID = ObjectID.generate();
      const blockedProjectId: ObjectID = ObjectID.generate();
      const canceledProjectId: ObjectID = ObjectID.generate();
      const pastDueProjectId: ObjectID = ObjectID.generate();

      await insertProject({ id: deletedProjectId, deleted: true });
      await insertProject({ id: blockedProjectId, blocked: true });
      await insertProject({
        id: canceledProjectId,
        subscriptionStatus: SubscriptionStatus.Canceled,
      });
      await insertProject({
        id: pastDueProjectId,
        subscriptionStatus: SubscriptionStatus.PastDue,
      });

      const probes: Record<string, ObjectID> = {};
      for (const [name, project] of [
        ["deleted", deletedProjectId],
        ["blocked", blockedProjectId],
        ["canceled", canceledProjectId],
        ["pastDue", pastDueProjectId],
      ] as Array<[string, ObjectID]>) {
        probes[name] = ObjectID.generate();
        await insertProbe({ id: probes[name]!, projectId: project });
      }

      await insertConnection({
        project: deletedProjectId,
        probe: probes["deleted"]!,
      });
      await insertConnection({
        project: blockedProjectId,
        probe: probes["blocked"]!,
      });
      await insertConnection({
        project: canceledProjectId,
        probe: probes["canceled"]!,
      });
      const pastDue: ObjectID = await insertConnection({
        project: pastDueProjectId,
        probe: probes["pastDue"]!,
      });

      for (const name of ["deleted", "blocked", "canceled"]) {
        expect(await claim(10, [], probes[name]!)).toEqual([]);
      }

      // past_due is still served: Stripe is still retrying.
      expect(idsOf(await claim(10, [], probes["pastDue"]!))).toEqual([
        pastDue.toString(),
      ]);
    });

    test("another project's probe never reads a connection, even one that names it", async () => {
      await insertConnection({ probe: foreignProbeId });
      expect(await claim(10, [], foreignProbeId)).toEqual([]);
    });

    test("a global probe reads only on a self-hosted instance", async () => {
      const connection: ObjectID = await insertConnection({
        probe: globalProbeId,
      });
      expect(idsOf(await claim(10, [], globalProbeId))).toEqual(
        IsBillingEnabled ? [] : [connection.toString()],
      );
    });

    test("a deleted probe reads nothing", async () => {
      const deletedProbe: ObjectID = ObjectID.generate();
      await insertProbe({
        id: deletedProbe,
        projectId: projectId,
        deleted: true,
      });
      await insertConnection({ probe: deletedProbe });
      expect(await claim(10, [], deletedProbe)).toEqual([]);
    });

    test("hands out no more than the free slots, and four claims at once hand out each connection once", async () => {
      const ids: Array<string> = [];
      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await insertConnection({
              nextCollectionAt: minutesFromNow(-10 + index),
            })
          ).toString(),
        );
      }

      expect(idsOf(await claim(2))).toEqual(ids.slice(0, 2));

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: ids.slice(2),
        claim: async (limit: number): Promise<Array<string>> => {
          return idsOf(await claim(limit));
        },
      });
    });

    test("moves each claimed connection's next collection by its own interval, held to 1 to 60 minutes", async () => {
      const intervals: Array<[number | null, number]> = [
        [null, 5],
        [-3, 5],
        [0, 5],
        [5, 5],
        [10, 10],
        [61, 60],
        [500, 60],
      ];
      const rows: Array<[ObjectID, number]> = [];
      for (const [interval, minutes] of intervals) {
        rows.push([
          await insertConnection({ intervalInMinutes: interval }),
          minutes,
        ]);
      }

      expect(await claim(intervals.length)).toHaveLength(intervals.length);

      for (const [id, minutes] of rows) {
        const movedBy: number =
          (await readConnection(id)).nextCollectionAt!.getTime() - Date.now();
        expect({
          minutes,
          movedBy: movedBy > minutes * 60_000 - 30_000,
        }).toEqual({ minutes, movedBy: true });
        expect(movedBy).toBeLessThanOrEqual(minutes * 60_000);
      }
    });

    test("skips a connection another writer holds, and hands it out once it is free", async () => {
      const held: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(-5),
      });
      const free: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(-4),
      });

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "StorageArrayConnection",
        held: held,
        free: [free],
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim());
        },
      });
    });

    /*
     * The claim, then the set-aside - each its own self-committing
     * statement, no transaction around them - then one read of what was
     * claimed, the password decrypted on read. With nothing due, the claim
     * and the set-aside only.
     */
    test("claims in one self-committing statement, the set-aside after it", async () => {
      await insertConnection({});
      await insertConnection({});

      const withWork: {
        result: Array<StorageArrayCollectionJob>;
        statements: Array<string>;
      } = await statementsSentBy(() => {
        return claim();
      });

      expect(withWork.result).toHaveLength(2);
      expect(
        withWork.statements.filter((statement: string): boolean => {
          return TRANSACTION_CONTROL.test(statement);
        }),
      ).toEqual([]);
      expect(withWork.statements[0]).toContain(
        "FOR NO KEY UPDATE OF sac SKIP LOCKED",
      );
      expect(withWork.statements[0]).toContain(
        'UPDATE "StorageArrayConnection" AS sac',
      );
      expect(withWork.statements).toHaveLength(1 + 1 + 1);

      const empty: {
        result: Array<StorageArrayCollectionJob>;
        statements: Array<string>;
      } = await statementsSentBy(() => {
        return claim();
      });

      expect(empty.result).toEqual([]);
      expect(empty.statements).toHaveLength(1 + 1);
    });

    test("locks only the claimed row: a row that names it is written without waiting", async () => {
      const connection: ObjectID = await insertConnection({});
      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: StorageArrayConnectionService,
        table: "StorageArrayConnection",
        referencingTable: referencingTable,
        id: connection,
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim());
        },
      });
    });
  });

  describe("what a collection report writes", () => {
    test("the current settings' report writes the status, the summary and the times", async () => {
      const connection: ObjectID = await insertConnection({
        settingsVersion: 3,
      });

      const outcome: StorageArrayCollectionReportOutcome =
        await StorageArrayConnectionService.recordCollectionReport({
          probeId: probeId,
          report: {
            storageArrayConnectionId: connection.toString(),
            settingsVersion: 3,
            collectedAt: new Date().toISOString(),
            status: "Succeeded",
            durationInMs: 12_000,
            summary: {
              serverProductName: "Unisphere for PowerMax",
              serverVersion: "T10.4.0.83",
              apiVersion: "104",
              arrays: [
                {
                  id: "000220200269",
                  isLocal: true,
                  isCollected: true,
                  counts: { StorageGroup: 4 },
                  warnings: [],
                },
              ],
              warnings: [],
            },
          },
        });

      expect(outcome).toMatchObject({ accepted: true, isCurrent: true });
      const row: ConnectionRow = await readConnection(connection);
      expect(row.collectionStatus).toBe(StorageArrayCollectionStatus.Succeeded);
      expect(row.collectionErrorCode).toBeNull();
      expect(row.lastCollectionAt).not.toBeNull();
      expect(row.lastSuccessfulCollectionAt).not.toBeNull();
      expect(row.collectionSummary).toMatchObject({
        serverVersion: "T10.4.0.83",
        arrays: [{ id: "000220200269", isLocal: true }],
      });
    });

    test("a failed report keeps the certificate it found, for Trust this certificate", async () => {
      const connection: ObjectID = await insertConnection({});

      await StorageArrayConnectionService.recordCollectionReport({
        probeId: probeId,
        report: {
          storageArrayConnectionId: connection.toString(),
          settingsVersion: 0,
          collectedAt: new Date().toISOString(),
          status: "Failed",
          errorCode: StorageArrayCollectionErrorCode.UntrustedCertificate,
          errorMessage: "unisphere.example.com's certificate is not trusted.",
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=unisphere.example.com",
            issuer: "CN=unisphere.example.com",
            isSelfSigned: true,
          },
          durationInMs: 300,
        },
      });

      const row: ConnectionRow = await readConnection(connection);
      expect(row.collectionStatus).toBe(StorageArrayCollectionStatus.Failed);
      expect(row.collectionErrorCode).toBe(
        StorageArrayCollectionErrorCode.UntrustedCertificate,
      );
      expect(row.presentedCertificate).toMatchObject({
        fingerprint256: FINGERPRINT,
      });
      expect(row.lastSuccessfulCollectionAt).toBeNull();
    });

    test("a report of older settings delivers its data but leaves the status to the new ones", async () => {
      const connection: ObjectID = await insertConnection({
        settingsVersion: 5,
      });

      const outcome: StorageArrayCollectionReportOutcome =
        await StorageArrayConnectionService.recordCollectionReport({
          probeId: probeId,
          report: {
            storageArrayConnectionId: connection.toString(),
            settingsVersion: 4,
            collectedAt: new Date().toISOString(),
            status: "Failed",
            errorCode: StorageArrayCollectionErrorCode.InvalidLogin,
            errorMessage: "Refused.",
            durationInMs: 100,
          },
        });

      expect(outcome).toMatchObject({ accepted: true, isCurrent: false });
      const row: ConnectionRow = await readConnection(connection);
      expect(row.collectionStatus).toBeNull();
      expect(row.collectionErrorCode).toBeNull();
      expect(row.lastCollectionAt).not.toBeNull();
    });

    test("a probe that does not read the connection is refused", async () => {
      const connection: ObjectID = await insertConnection({});
      for (const probe of [siblingProbeId, foreignProbeId]) {
        expect(
          await StorageArrayConnectionService.recordCollectionReport({
            probeId: probe,
            report: {
              storageArrayConnectionId: connection.toString(),
              settingsVersion: 0,
              collectedAt: new Date().toISOString(),
              status: "Succeeded",
              durationInMs: 1,
            },
          }),
        ).toMatchObject({ accepted: false });
      }
      expect((await readConnection(connection)).lastCollectionAt).toBeNull();
    });

    test("a report that names no connection is refused", async () => {
      expect(
        await StorageArrayConnectionService.recordCollectionReport({
          probeId: probeId,
          report: {
            storageArrayConnectionId: "not-an-id",
            settingsVersion: 0,
            collectedAt: new Date().toISOString(),
            status: "Succeeded",
            durationInMs: 1,
          },
        }),
      ).toEqual({ accepted: false, reason: "The report names no connection." });
    });
  });

  describe("connection tests", () => {
    test("a probe claims its pending tests once each, oldest first, and the password is wiped once read", async () => {
      const first: ObjectID = await insertTest({
        createdAt: secondsFromNow(-20),
        password: "first-secret",
      });
      const second: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
        password: "second-secret",
      });
      const anotherProbes: ObjectID = await insertTest({
        probe: siblingProbeId,
      });
      const tooOld: ObjectID = await insertTest({
        createdAt: secondsFromNow(-3600),
      });
      const deleted: ObjectID = await insertTest({ deleted: true });

      const jobs: Array<StorageArrayConnectionTestJob> =
        await StorageArrayConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        });

      expect(
        jobs.map((job: StorageArrayConnectionTestJob): string => {
          return job.storageArrayConnectionTestId;
        }),
      ).toEqual([first.toString(), second.toString()]);
      expect(jobs[0]).toEqual({
        storageArrayConnectionTestId: first.toString(),
        storageSystem: "dell.powermax",
        address: "https://unisphere.example.com:8443",
        username: "oneuptime-monitor",
        password: "first-secret",
        trustedCertificateFingerprint: FINGERPRINT,
      });

      for (const id of [first, second]) {
        const row: TestRow = await readTest(id);
        expect(row.status).toBe(StorageArrayConnectionTestStatus.Running);
        expect(row.claimedAt).not.toBeNull();
        // Read for the probe: nothing keeps it now.
        expect(row.password).toBeNull();
      }
      for (const id of [anotherProbes, tooOld, deleted]) {
        expect((await readTest(id)).status).toBe(
          StorageArrayConnectionTestStatus.Pending,
        );
      }

      // Claimed once: a second claim hands out nothing.
      expect(
        await StorageArrayConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        }),
      ).toEqual([]);
    });

    /*
     * The claim, one read of the claimed tests, one wipe of each password;
     * with nothing pending, the claim alone - the probe asks every 10
     * seconds.
     */
    test("claims in one self-committing statement", async () => {
      await insertTest({ createdAt: secondsFromNow(-20) });
      await insertTest({ createdAt: secondsFromNow(-10) });

      const claimTests: () => Promise<
        Array<StorageArrayConnectionTestJob>
      > = (): Promise<Array<StorageArrayConnectionTestJob>> => {
        return StorageArrayConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        });
      };

      const withWork: {
        result: Array<StorageArrayConnectionTestJob>;
        statements: Array<string>;
      } = await statementsSentBy(claimTests);

      expect(withWork.result).toHaveLength(2);
      expect(withWork.statements[0]).toBe(
        expectOneSelfCommittingClaim(withWork.statements),
      );
      expect(withWork.statements).toHaveLength(1 + 1 + 2);

      const empty: {
        result: Array<StorageArrayConnectionTestJob>;
        statements: Array<string>;
      } = await statementsSentBy(claimTests);

      expect(empty.result).toEqual([]);
      expect(empty.statements).toHaveLength(1);
    });

    test("skips a test another writer holds, and hands it out once it is free", async () => {
      const held: ObjectID = await insertTest({
        createdAt: secondsFromNow(-20),
      });
      const free: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
      });

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "StorageArrayConnectionTest",
        held: held,
        free: [free],
        claim: async (): Promise<Array<string>> => {
          return (
            await StorageArrayConnectionTestService.claimPendingTests({
              probeId: probeId,
              limit: 5,
            })
          ).map((job: StorageArrayConnectionTestJob): string => {
            return job.storageArrayConnectionTestId;
          });
        },
      });
    });

    test("the test's probe answers it while it runs; nobody else, and never twice", async () => {
      const id: ObjectID = await insertTest({
        status: StorageArrayConnectionTestStatus.Running,
        claimedAt: new Date(),
        password: null,
      });

      expect(
        await StorageArrayConnectionTestService.recordTestReport({
          probeId: siblingProbeId,
          report: {
            storageArrayConnectionTestId: id.toString(),
            status: "Succeeded",
            durationInMs: 10,
          },
        }),
      ).toBe(false);

      expect(
        await StorageArrayConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            storageArrayConnectionTestId: id.toString(),
            status: "Failed",
            errorCode: StorageArrayCollectionErrorCode.MissingRole,
            errorMessage: "The account may not read the arrays.",
            durationInMs: 10,
          },
        }),
      ).toBe(true);

      const row: TestRow = await readTest(id);
      expect(row.status).toBe(StorageArrayConnectionTestStatus.Failed);
      expect(row.errorCode).toBe(StorageArrayCollectionErrorCode.MissingRole);
      expect(row.completedAt).not.toBeNull();

      expect(
        await StorageArrayConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            storageArrayConnectionTestId: id.toString(),
            status: "Succeeded",
            durationInMs: 10,
          },
        }),
      ).toBe(false);
    });

    test("a test nobody picks up, or that never reports, is answered with why", async () => {
      const notPickedUp: ObjectID = await insertTest({
        createdAt: secondsFromNow(-600),
      });
      const neverReported: ObjectID = await insertTest({
        status: StorageArrayConnectionTestStatus.Running,
        createdAt: secondsFromNow(-600),
        claimedAt: secondsFromNow(-600),
        password: null,
      });
      const fresh: ObjectID = await insertTest({});

      await StorageArrayConnectionTestService.expireStaleTests();

      expect(await readTest(notPickedUp)).toMatchObject({
        status: StorageArrayConnectionTestStatus.Failed,
        errorCode: StorageArrayCollectionErrorCode.ProbeNotAvailable,
        password: null,
      });
      expect(await readTest(neverReported)).toMatchObject({
        status: StorageArrayConnectionTestStatus.Failed,
        errorCode: StorageArrayCollectionErrorCode.TimedOut,
      });
      expect((await readTest(fresh)).status).toBe(
        StorageArrayConnectionTestStatus.Pending,
      );
    });
  });
});
