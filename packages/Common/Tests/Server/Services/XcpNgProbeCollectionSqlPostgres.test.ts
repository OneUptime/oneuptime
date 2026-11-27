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
import XcpNgConnectionService from "../../../Server/Services/XcpNgConnectionService";
import XcpNgConnectionTestService from "../../../Server/Services/XcpNgConnectionTestService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import XcpNgProbeCollectionStore from "../../../Server/Utils/XcpNg/XcpNgProbeCollectionStore";
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
import XcpNgConnectionTestStatus from "../../../Types/XcpNg/XcpNgConnectionTestStatus";
import XcpNgConnectionType from "../../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionJob,
  XcpNgConnectionTestJob,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { DataSource } from "typeorm";

/*
 * The XCP-ng connections' hand-written SQL against a real Postgres (#10996,
 * #10999): a probe's claim of the Xen Orchestras and pools it reads (one
 * statement, FOR NO KEY UPDATE SKIP LOCKED, the secrets each kind needs, its
 * interval rule, its tenancy backstop, the subscription rule, the set-aside
 * of what nothing may read, and the locks it holds), and the connection
 * tests' claim, which wipes the secrets typed for a test as it hands them
 * out. ProbeClaimStatements and XcpNgCollectionStop pin the statements'
 * text; this runs them.
 *
 * Opt in with RUN_POSTGRES_XCP_NG_PROBE_COLLECTION_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The Project, Probe,
 * XcpNgConnection and XcpNgConnectionTest tables' STRUCTURE is cloned into
 * a unique schema (search_path holds only that schema), dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * XCP_NG_PROBE_COLLECTION_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * XCP_NG_PROBE_COLLECTION_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_XCP_NG_PROBE_COLLECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "XcpNgConnection",
  "XcpNgConnectionTest",
];

const DASHES: RegExp = /-/g;

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

const POOL_ID: string = "6a7b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

describePostgres("XCP-ng probe collection SQL against Postgres", () => {
  const schema: string = `xcp_ng_probe_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a connection by a foreign key, as a pool or a feed entry does.
  let referencingTable: string;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const siblingProbeId: ObjectID = ObjectID.generate();
  const globalProbeId: ObjectID = ObjectID.generate();

  let connectionCount: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["XCP_NG_PROBE_COLLECTION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["XCP_NG_PROBE_COLLECTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["XCP_NG_PROBE_COLLECTION_TEST_DATABASE_NAME"] ||
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
      parentTable: "XcpNgConnection",
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

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject({ id: projectId });
    await insertProject({ id: otherProjectId });
    await insertProbe({ id: probeId, projectId: projectId });
    await insertProbe({ id: siblingProbeId, projectId: projectId });
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
  }

  interface TestRow {
    _id: string;
    status: string;
    openMetricsSecret: string | null;
    apiToken: string | null;
    password: string | null;
    claimedAt: Date | null;
  }

  async function insertProject(data: {
    id: ObjectID;
    subscriptionStatus?: SubscriptionStatus | null;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "deletedAt")
       VALUES ($1, $2, false, $3, NULL, $4)`,
      [
        data.id.toString(),
        `Project ${data.id.toString()}`,
        data.subscriptionStatus ?? null,
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function insertProbe(data: {
    id: ObjectID;
    projectId: ObjectID | null;
    isGlobalProbe?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe")
       VALUES ($1, $2, $3, $4)`,
      [
        data.id.toString(),
        data.projectId ? data.projectId.toString() : null,
        `Probe ${data.id.toString()}`,
        Boolean(data.isGlobalProbe),
      ],
    );
  }

  // A Xen Orchestra unless `type` says XAPI; every secret its kind needs saved.
  async function insertConnection(
    data: {
      type?: XcpNgConnectionType;
      project?: ObjectID;
      probe?: ObjectID | null;
      address?: string | null;
      openMetricsSecret?: string | null;
      isOpenMetricsSecretSet?: boolean;
      apiToken?: string | null;
      username?: string | null;
      password?: string | null;
      isPasswordSet?: boolean;
      nextCollectionAt?: Date | null;
      intervalInMinutes?: number | null;
      settingsVersion?: number;
      fingerprint?: string | null;
      poolHosts?: unknown;
      watermark?: unknown;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const type: XcpNgConnectionType =
      data.type || XcpNgConnectionType.XenOrchestra;
    const isXapi: boolean = type === XcpNgConnectionType.Xapi;
    connectionCount++;

    const encrypted: (
      value: string | null | undefined,
      fallback: string | null,
    ) => Promise<string | null> = async (
      value: string | null | undefined,
      fallback: string | null,
    ): Promise<string | null> => {
      const plain: string | null = value === undefined ? fallback : value;
      return plain === null ? null : await Encryption.encrypt(plain);
    };

    await database.query(
      `INSERT INTO "${schema}"."XcpNgConnection"
        ("_id", "projectId", "name", "connectionType", "address", "collectionProbeId",
         "trustedCertificateFingerprint", "collectionIntervalInMinutes",
         "openMetricsSecret", "isOpenMetricsSecretSet", "apiToken", "isApiTokenSet",
         "username", "password", "isPasswordSet", "xapiPoolId", "xapiMasterAddress",
         "xapiPoolHosts", "messageWatermark", "nextCollectionAt", "collectionSettingsVersion",
         "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
         $18::jsonb, $19::jsonb, $20, $21, now(), now(), $22, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `XCP-ng ${connectionCount}`,
        type,
        data.address === undefined
          ? `https://xcp-${connectionCount}.example.com`
          : data.address,
        data.probe === null ? null : (data.probe || probeId).toString(),
        data.fingerprint ?? null,
        data.intervalInMinutes === undefined ? 5 : data.intervalInMinutes,
        await encrypted(
          data.openMetricsSecret,
          isXapi ? null : `secret-${connectionCount}`,
        ),
        data.isOpenMetricsSecretSet ?? !isXapi,
        await encrypted(data.apiToken, null),
        Boolean(data.apiToken),
        data.username === undefined ? (isXapi ? "root" : null) : data.username,
        await encrypted(
          data.password,
          isXapi ? `password-${connectionCount}` : null,
        ),
        data.isPasswordSet ?? isXapi,
        isXapi ? POOL_ID : null,
        isXapi ? `https://xcp-${connectionCount}.example.com` : null,
        data.poolHosts === undefined ? null : JSON.stringify(data.poolHosts),
        data.watermark === undefined ? null : JSON.stringify(data.watermark),
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
      `SELECT * FROM "${schema}"."XcpNgConnection" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function claim(
    data: { probe?: ObjectID; running?: Array<string>; limit?: number } = {},
  ): Promise<Array<XcpNgCollectionJob>> {
    return await XcpNgConnectionService.claimForCollection({
      probeId: data.probe || probeId,
      runningXcpNgConnectionIds: data.running || [],
      limit: data.limit ?? 10,
    });
  }

  function idsOf(jobs: Array<XcpNgCollectionJob>): Array<string> {
    return jobs.map((job: XcpNgCollectionJob): string => {
      return job.xcpNgConnectionId;
    });
  }

  describe("the probe's claim of the XCP-ng connections it reads", () => {
    test("hands the probe only its due connections with the secrets their kind needs, of live projects - never one it is running - oldest first", async () => {
      const neverRead: ObjectID = await insertConnection({
        nextCollectionAt: null,
      });
      const xenOrchestra: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(-4),
        intervalInMinutes: 7,
        openMetricsSecret: "the-plugin-secret",
        apiToken: "the-read-only-token",
        fingerprint: FINGERPRINT.replace(/:/g, "").toLowerCase(),
        settingsVersion: 3,
      });
      const pool: ObjectID = await insertConnection({
        type: XcpNgConnectionType.Xapi,
        nextCollectionAt: minutesFromNow(-3),
        username: "EXAMPLE\\oneuptime",
        password: "the-pool-password",
        poolHosts: [
          {
            uuid: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
            name: "xcp-prod-01",
            address: "10.0.0.11",
            certificateFingerprint: FINGERPRINT,
            isMaster: true,
          },
        ],
        watermark: {
          readUntil: "2026-11-18T10:00:00.000Z",
          uuidsAtReadUntil: ["9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"],
        },
      });

      const notDue: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(5),
      });
      const running: ObjectID = await insertConnection({});
      const anotherProbes: ObjectID = await insertConnection({
        probe: siblingProbeId,
      });

      // Due on this probe, but nothing may read them: set aside.
      const uncollectable: Array<ObjectID> = [
        await insertConnection({
          openMetricsSecret: null,
          isOpenMetricsSecretSet: false,
        }),
        await insertConnection({
          type: XcpNgConnectionType.Xapi,
          password: null,
          isPasswordSet: false,
        }),
        await insertConnection({
          type: XcpNgConnectionType.Xapi,
          username: null,
        }),
        // A Xen Orchestra's secret does not stand in for a pool's password.
        await insertConnection({
          type: XcpNgConnectionType.Xapi,
          password: null,
          isPasswordSet: false,
          openMetricsSecret: "a-plugin-secret",
          isOpenMetricsSecretSet: true,
        }),
        await insertConnection({ address: null }),
        await insertConnection({ deleted: true }),
        // A row naming this probe from another project: never handed out.
        await insertConnection({ project: otherProjectId }),
      ];

      const untouched: Array<ObjectID> = [notDue, running, anotherProbes];
      const before: Map<string, Date | null> = new Map();

      for (const id of untouched) {
        before.set(id.toString(), (await readConnection(id)).nextCollectionAt);
      }

      const claimedAt: number = Date.now();
      const jobs: Array<XcpNgCollectionJob> = await claim({
        running: [running.toString(), "not-an-id"],
      });

      expect(idsOf(jobs)).toEqual([xenOrchestra.toString(), pool.toString()]);
      // Never read: the set-aside after the claim makes it due now.
      expect(
        (await readConnection(neverRead)).nextCollectionAt!.getTime(),
      ).toBeLessThanOrEqual(Date.now());

      // Each job carries only what its kind reads with, decrypted.
      expect(jobs[0]).toEqual({
        xcpNgConnectionId: xenOrchestra.toString(),
        connectionName: expect.any(String),
        connectionType: XcpNgConnectionType.XenOrchestra,
        address: expect.stringMatching(/^https:\/\/xcp-\d+\.example\.com$/),
        trustedCertificateFingerprint: FINGERPRINT,
        collectionIntervalInMinutes: 7,
        settingsVersion: 3,
        openMetricsSecret: "the-plugin-secret",
        apiToken: "the-read-only-token",
      });
      expect(jobs[1]).toEqual({
        xcpNgConnectionId: pool.toString(),
        connectionName: expect.any(String),
        connectionType: XcpNgConnectionType.Xapi,
        address: expect.stringMatching(/^https:\/\/xcp-\d+\.example\.com$/),
        collectionIntervalInMinutes: 5,
        settingsVersion: 0,
        username: "EXAMPLE\\oneuptime",
        password: "the-pool-password",
        xapiPoolId: POOL_ID,
        xapiMasterAddress: expect.stringMatching(/^https:\/\/xcp-\d+/),
        xapiPoolHosts: [
          {
            uuid: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
            name: "xcp-prod-01",
            address: "10.0.0.11",
            certificateFingerprint: FINGERPRINT,
            isMaster: true,
          },
        ],
        messageWatermark: {
          readUntil: "2026-11-18T10:00:00.000Z",
          uuidsAtReadUntil: ["9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"],
        },
      });

      // The next read is one interval on, from now.
      const movedBy: number =
        (await readConnection(xenOrchestra)).nextCollectionAt!.getTime() -
        Date.now();
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
      expect(idsOf(await claim({ running: [running.toString()] }))).toEqual([
        neverRead.toString(),
      ]);
      expect(await claim({ running: [running.toString()] })).toEqual([]);
    });

    test("a project that is deleted, blocked, or whose subscription ended, is not read", async () => {
      const deletedProjectId: ObjectID = ObjectID.generate();
      const canceledProjectId: ObjectID = ObjectID.generate();
      const blockedProjectId: ObjectID = ObjectID.generate();
      const pastDueProjectId: ObjectID = ObjectID.generate();

      await insertProject({ id: deletedProjectId, deleted: true });
      await insertProject({
        id: canceledProjectId,
        subscriptionStatus: SubscriptionStatus.Canceled,
      });
      await insertProject({ id: blockedProjectId });
      await database.query(
        `UPDATE "${schema}"."Project" SET "isBlocked" = true WHERE "_id" = $1`,
        [blockedProjectId.toString()],
      );
      await insertProject({
        id: pastDueProjectId,
        subscriptionStatus: SubscriptionStatus.PastDue,
      });

      const probes: Map<string, ObjectID> = new Map();

      for (const project of [
        deletedProjectId,
        canceledProjectId,
        blockedProjectId,
        pastDueProjectId,
      ]) {
        const probe: ObjectID = ObjectID.generate();
        await insertProbe({ id: probe, projectId: project });
        probes.set(project.toString(), probe);
        await insertConnection({ project: project, probe: probe });
      }

      for (const project of [
        deletedProjectId,
        canceledProjectId,
        blockedProjectId,
      ]) {
        expect(await claim({ probe: probes.get(project.toString())! })).toEqual(
          [],
        );
      }

      // past_due is still served: Stripe is still retrying.
      expect(
        await claim({ probe: probes.get(pastDueProjectId.toString())! }),
      ).toHaveLength(1);
    });

    test("a global probe reads only on a self-hosted instance", async () => {
      const connection: ObjectID = await insertConnection({
        probe: globalProbeId,
      });

      expect(idsOf(await claim({ probe: globalProbeId }))).toEqual(
        IsBillingEnabled ? [] : [connection.toString()],
      );
    });

    test("hands out no more than the free slots, and four claims at once hand out each connection once", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await insertConnection({
              type:
                index % 2 === 0
                  ? XcpNgConnectionType.XenOrchestra
                  : XcpNgConnectionType.Xapi,
              nextCollectionAt: minutesFromNow(-10 + index),
            })
          ).toString(),
        );
      }

      expect(idsOf(await claim({ limit: 2 }))).toEqual(ids.slice(0, 2));

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: ids.slice(2),
        claim: async (limit: number): Promise<Array<string>> => {
          return idsOf(await claim({ limit: limit }));
        },
      });
    });

    // getSafeInterval's rule, in SQL: none or not positive is a minute, else 1 to 60.
    test("moves each claimed connection's next read by its own interval, held to getSafeInterval's bounds", async () => {
      // [interval stored, minutes to the next read]
      const intervals: Array<[number | null, number]> = [
        [null, 1],
        [-3, 1],
        [0, 1],
        [1, 1],
        [2, 2],
        [7, 7],
        [59, 59],
        [60, 60],
        [61, 60],
        [500, 60],
      ];
      const ids: Array<ObjectID> = [];

      for (const [index, [stored]] of intervals.entries()) {
        ids.push(
          await insertConnection({
            nextCollectionAt: minutesFromNow(-30 + index),
            intervalInMinutes: stored,
          }),
        );
      }

      const before: number = Date.now();
      const jobs: Array<XcpNgCollectionJob> = await claim({ limit: 20 });
      const after: number = Date.now();

      expect(idsOf(jobs)).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      for (const [index, [stored, minutes]] of intervals.entries()) {
        expect([
          stored,
          XcpNgProbeCollectionStore.getSafeInterval(stored),
          jobs[index]!.collectionIntervalInMinutes,
        ]).toEqual([stored, minutes, minutes]);

        const next: number = (
          await readConnection(ids[index]!)
        ).nextCollectionAt!.getTime();
        expect(next).toBeGreaterThanOrEqual(before + minutes * 60_000);
        expect(next).toBeLessThanOrEqual(after + minutes * 60_000);
      }
    });

    test("a connection another writer holds is skipped, not waited for, and is handed out once it is free", async () => {
      const held: ObjectID = await insertConnection({
        nextCollectionAt: minutesFromNow(-9),
      });
      const free: Array<ObjectID> = [
        await insertConnection({ nextCollectionAt: minutesFromNow(-8) }),
        await insertConnection({
          type: XcpNgConnectionType.Xapi,
          nextCollectionAt: minutesFromNow(-7),
        }),
      ];

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "XcpNgConnection",
        held: held,
        free: free,
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim());
        },
      });
    });

    /*
     * OneUptime issue #7194 at its root: a claim that held its rows FOR
     * UPDATE for a whole transaction made every row naming one - a pool, a
     * feed entry - wait for it.
     */
    test("while a claim's row locks are held, a row that names the connection is still written; only the connection row itself waits", async () => {
      const connection: ObjectID = await insertConnection({});

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: XcpNgConnectionService,
        table: "XcpNgConnection",
        referencingTable: referencingTable,
        id: connection,
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim());
        },
      });
    });
  });

  describe("connection tests", () => {
    async function insertTest(
      data: {
        type?: XcpNgConnectionType;
        project?: ObjectID;
        probe?: ObjectID;
        status?: XcpNgConnectionTestStatus;
        createdAt?: Date;
        openMetricsSecret?: string | null;
        apiToken?: string | null;
        password?: string | null;
        deleted?: boolean;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const type: XcpNgConnectionType =
        data.type || XcpNgConnectionType.XenOrchestra;
      const isXapi: boolean = type === XcpNgConnectionType.Xapi;

      const encrypted: (
        value: string | null | undefined,
        fallback: string | null,
      ) => Promise<string | null> = async (
        value: string | null | undefined,
        fallback: string | null,
      ): Promise<string | null> => {
        const plain: string | null = value === undefined ? fallback : value;
        return plain === null ? null : await Encryption.encrypt(plain);
      };

      await database.query(
        `INSERT INTO "${schema}"."XcpNgConnectionTest"
          ("_id", "projectId", "probeId", "connectionType", "address", "username",
           "openMetricsSecret", "apiToken", "password", "trustedCertificateFingerprint",
           "status", "createdAt", "updatedAt", "deletedAt", "version")
         VALUES ($1, $2, $3, $4, 'https://xo.example.com', $5, $6, $7, $8, $9, $10, $11, $11, $12, 1)`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          (data.probe || probeId).toString(),
          type,
          isXapi ? "root" : null,
          await encrypted(
            data.openMetricsSecret,
            isXapi ? null : "test-secret",
          ),
          await encrypted(data.apiToken, null),
          await encrypted(data.password, isXapi ? "test-password" : null),
          FINGERPRINT,
          data.status || XcpNgConnectionTestStatus.Pending,
          data.createdAt || new Date(),
          data.deleted ? new Date() : null,
        ],
      );

      return id;
    }

    async function readTest(id: ObjectID): Promise<TestRow> {
      const rows: Array<TestRow> = await database.query(
        `SELECT * FROM "${schema}"."XcpNgConnectionTest" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    async function claimTests(limit: number = 10): Promise<Array<string>> {
      return (
        await XcpNgConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: limit,
        })
      ).map((job: XcpNgConnectionTestJob): string => {
        return job.xcpNgConnectionTestId;
      });
    }

    test("a probe is handed its fresh pending tests once, and the secrets typed for them leave the row as they are handed out", async () => {
      const xenOrchestra: ObjectID = await insertTest({
        openMetricsSecret: "typed-secret",
        apiToken: "typed-token",
        createdAt: secondsFromNow(-20),
      });
      const pool: ObjectID = await insertTest({
        type: XcpNgConnectionType.Xapi,
        password: "typed-password",
        createdAt: secondsFromNow(-10),
      });
      const stale: ObjectID = await insertTest({
        createdAt: secondsFromNow(-600),
      });
      const others: ObjectID = await insertTest({ probe: siblingProbeId });
      const foreign: ObjectID = await insertTest({ project: otherProjectId });
      const deleted: ObjectID = await insertTest({ deleted: true });

      const jobs: Array<XcpNgConnectionTestJob> =
        await XcpNgConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        });

      expect(jobs).toEqual([
        {
          xcpNgConnectionTestId: xenOrchestra.toString(),
          connectionType: XcpNgConnectionType.XenOrchestra,
          address: "https://xo.example.com",
          trustedCertificateFingerprint: FINGERPRINT,
          openMetricsSecret: "typed-secret",
          apiToken: "typed-token",
        },
        {
          xcpNgConnectionTestId: pool.toString(),
          connectionType: XcpNgConnectionType.Xapi,
          address: "https://xo.example.com",
          trustedCertificateFingerprint: FINGERPRINT,
          username: "root",
          password: "typed-password",
        },
      ]);

      for (const id of [xenOrchestra, pool]) {
        const claimed: TestRow = await readTest(id);
        expect(claimed.status).toBe(XcpNgConnectionTestStatus.Running);
        expect(claimed.claimedAt).toBeInstanceOf(Date);
        expect([
          claimed.openMetricsSecret,
          claimed.apiToken,
          claimed.password,
        ]).toEqual([null, null, null]);
      }

      for (const id of [stale, others, foreign, deleted]) {
        expect((await readTest(id)).status).toBe(
          XcpNgConnectionTestStatus.Pending,
        );
      }

      expect(await claimTests()).toEqual([]);
    });

    test("hands out the oldest first, and no more than the limit", async () => {
      const third: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
      });
      const first: ObjectID = await insertTest({
        createdAt: secondsFromNow(-30),
      });
      const second: ObjectID = await insertTest({
        type: XcpNgConnectionType.Xapi,
        createdAt: secondsFromNow(-20),
      });

      expect(await claimTests(2)).toEqual([
        first.toString(),
        second.toString(),
      ]);
      expect(await claimTests(2)).toEqual([third.toString()]);
      expect(await claimTests(2)).toEqual([]);
    });

    test("the claim is one statement, with no transaction around it; then one read, and one wipe a test", async () => {
      await insertTest({});
      await insertTest({ type: XcpNgConnectionType.Xapi });

      const withWork: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claimTests();
        });

      expect(withWork.result).toHaveLength(2);
      expect(withWork.statements[0]).toBe(
        expectOneSelfCommittingClaim(withWork.statements),
      );
      expect(withWork.statements).toHaveLength(1 + 1 + 2);

      const empty: { result: Array<string>; statements: Array<string> } =
        await statementsSentBy(() => {
          return claimTests();
        });

      expect(empty.result).toEqual([]);
      expect(empty.statements).toHaveLength(1);
    });

    test("a test another writer holds is skipped at once, and handed out once it is free", async () => {
      const held: ObjectID = await insertTest({
        createdAt: secondsFromNow(-20),
      });
      const free: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
      });

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "XcpNgConnectionTest",
        held: held,
        free: [free],
        claim: (): Promise<Array<string>> => {
          return claimTests();
        },
      });
    });

    test("claims at once hand out each test exactly once", async () => {
      const due: Array<string> = [];

      for (let index: number = 0; index < 12; index++) {
        due.push(
          (
            await insertTest({
              type:
                index % 2 === 0
                  ? XcpNgConnectionType.XenOrchestra
                  : XcpNgConnectionType.Xapi,
              createdAt: secondsFromNow(-(12 - index)),
            })
          ).toString(),
        );
      }

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: due,
        claim: (limit: number): Promise<Array<string>> => {
          return claimTests(limit);
        },
      });
    });
  });
});
