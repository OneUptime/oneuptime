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
import OpenStackCloudConnectionTestService from "../../../Server/Services/OpenStackCloudConnectionTestService";
import OpenStackCloudService from "../../../Server/Services/OpenStackCloudService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import OpenStackCloudConnection from "../../../Server/Utils/OpenStack/OpenStackCloudConnection";
import OpenStackProbeCollectionStore, {
  OpenStackCollectionReportOutcome,
} from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import {
  createReferencingTable,
  expectClaimLocksHoldOnlyTheRow,
  expectConcurrentClaimsHandOutEachRowOnce,
  expectHeldRowSkipped,
} from "../TestingUtils/Postgres/ClaimRowLocks";
import { Gray500 } from "../../../Types/BrandColors";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../../Types/OpenStack/OpenStackCollectionStatus";
import OpenStackConnectionTestStatus from "../../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  OpenStackCollectionJob,
  OpenStackCollectionSummary,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestSummary,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import { DataSource } from "typeorm";

/*
 * Probe collection's hand-written SQL against a real Postgres: the probe's claim of the clouds
 * it collects (one statement, FOR NO KEY UPDATE SKIP LOCKED, its interval rule, its tenancy
 * backstop, the subscription rule, and the locks it holds), what a report writes, the settings
 * version bump a settings change makes, and the connection tests'
 * claim, report and expiry, each keyed on the probe. The unit suites pin the statements' text,
 * and this runs them.
 *
 * Opt in with RUN_POSTGRES_OPENSTACK_PROBE_COLLECTION_TESTS=true against a Postgres migrated to
 * the current head: the Postgres Schema Drift workflow's database right after its drift check
 * (CI runs it in .github/workflows/postgres-schema-drift.yaml). The Project, Probe,
 * OpenStackCloud and OpenStackCloudConnectionTest tables' STRUCTURE is cloned into a unique
 * schema (search_path holds only that schema), and dropped afterwards. Credentials come from
 * DATABASE_USERNAME / DATABASE_PASSWORD, the database from
 * OPENSTACK_PROBE_COLLECTION_TEST_DATABASE_NAME or DATABASE_NAME, the endpoint from
 * OPENSTACK_PROBE_COLLECTION_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OPENSTACK_PROBE_COLLECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "OpenStackCloud",
  "OpenStackCloudConnectionTest",
];

const DASHES: RegExp = /-/g;

const FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function collectionSummary(): OpenStackCollectionSummary {
  return {
    credentialKind: "applicationCredential",
    regionNames: ["RegionOne"],
    services: [],
    hypervisorCount: 2,
    instanceCount: 10,
    networkCount: 3,
    volumeCount: 4,
    projectCount: 2,
    warnings: [],
  };
}

function testSummary(): OpenStackConnectionTestSummary {
  return {
    credentialKind: "applicationCredential",
    roleNames: ["reader"],
    hasAccessRules: false,
    isUnrestricted: false,
    canProbablyWrite: false,
    regionsInCatalog: ["RegionOne"],
    servicesByRegion: {},
    accessLevel: "FullView",
    reads: [],
    warnings: [],
  };
}

describePostgres("OpenStack probe collection SQL against Postgres", () => {
  const schema: string = `openstack_probe_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a cloud by a foreign key, as an incident or a feed entry does.
  let referencingTable: string;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const siblingProbeId: ObjectID = ObjectID.generate();
  const foreignProbeId: ObjectID = ObjectID.generate();
  const globalProbeId: ObjectID = ObjectID.generate();

  let cloudCount: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OPENSTACK_PROBE_COLLECTION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["OPENSTACK_PROBE_COLLECTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_PROBE_COLLECTION_TEST_DATABASE_NAME"] ||
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
      parentTable: "OpenStackCloud",
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

  interface CloudRow {
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
    isCredentialSet: boolean;
    credentialsUpdatedAt: Date | null;
    credentialSecret: string | null;
  }

  interface TestRow {
    _id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    credentialSecret: string | null;
    claimedAt: Date | null;
    completedAt: Date | null;
    summary: Record<string, unknown> | null;
  }

  async function insertProject(data: {
    id: ObjectID;
    subscriptionStatus?: SubscriptionStatus | null;
    deleted?: boolean;
    blocked?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "deletedAt", "isBlocked")
       VALUES ($1, $2, $3, NULL, $4, $5)`,
      [
        data.id.toString(),
        `Project ${data.id.toString()}`,
        data.subscriptionStatus ?? null,
        data.deleted ? new Date() : null,
        Boolean(data.blocked),
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

  async function insertCloud(
    data: {
      project?: ObjectID;
      probe?: ObjectID | null;
      method?: OpenStackCollectionMethod;
      isCredentialSet?: boolean;
      secret?: string | null;
      nextCollectionAt?: Date | null;
      intervalInMinutes?: number | null;
      settingsVersion?: number;
      fingerprints?: Array<string> | null;
      password?: boolean;
      archived?: boolean;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    cloudCount++;

    await database.query(
      `INSERT INTO "${schema}"."OpenStackCloud"
        ("_id", "projectId", "name", "slug", "collectionMethod", "authUrl", "endpointInterface", "collectionRegions",
         "credentialKind", "applicationCredentialId", "keystoneUsername", "userDomainName", "projectName", "projectDomainName",
         "credentialSecret", "isCredentialSet", "collectionProbeId", "trustedCertificateFingerprints",
         "collectionIntervalInMinutes", "nextCollectionAt", "collectionSettingsVersion", "isArchived",
         "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, 'internal', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now(), now(), $22, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `Cloud ${cloudCount}`,
        `cloud-${cloudCount}-${id.toString().substring(0, 8)}`,
        data.method || OpenStackCollectionMethod.Probe,
        `https://keystone-${cloudCount}.example.com:5000`,
        JSON.stringify(["RegionOne", "RegionTwo"]),
        data.password ? "password" : "applicationCredential",
        data.password ? null : "an-application-credential",
        data.password ? "reader" : null,
        data.password ? "Default" : null,
        data.password ? "monitoring" : null,
        data.password ? "Default" : null,
        data.secret === null
          ? null
          : await Encryption.encrypt(data.secret || `secret-${cloudCount}`),
        data.isCredentialSet ?? true,
        data.probe === null ? null : (data.probe || probeId).toString(),
        data.fingerprints === undefined || data.fingerprints === null
          ? null
          : JSON.stringify(data.fingerprints),
        data.intervalInMinutes === undefined ? 5 : data.intervalInMinutes,
        data.nextCollectionAt === undefined
          ? minutesFromNow(-1)
          : data.nextCollectionAt,
        data.settingsVersion ?? 0,
        Boolean(data.archived),
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function readCloud(id: ObjectID): Promise<CloudRow> {
    const rows: Array<CloudRow> = await database.query(
      `SELECT * FROM "${schema}"."OpenStackCloud" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function insertTest(
    data: {
      project?: ObjectID;
      probe?: ObjectID;
      status?: OpenStackConnectionTestStatus;
      createdAt?: Date;
      claimedAt?: Date | null;
      secret?: string | null;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."OpenStackCloudConnectionTest"
        ("_id", "projectId", "probeId", "authUrl", "endpointInterface", "collectionRegions", "credentialKind", "applicationCredentialId",
         "credentialSecret", "trustedCertificateFingerprints", "status", "claimedAt", "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, 'https://keystone.example.com:5000', 'internal', $4, 'applicationCredential', 'an-application-credential', $5, $6, $7, $8, $9, $9, $10, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        (data.probe || probeId).toString(),
        JSON.stringify(["RegionOne"]),
        data.secret === null
          ? null
          : await Encryption.encrypt(data.secret || "test-secret"),
        JSON.stringify([FINGERPRINT]),
        data.status || OpenStackConnectionTestStatus.Pending,
        data.claimedAt ?? null,
        data.createdAt || new Date(),
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function readTest(id: ObjectID): Promise<TestRow> {
    const rows: Array<TestRow> = await database.query(
      `SELECT * FROM "${schema}"."OpenStackCloudConnectionTest" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  function idsOf(jobs: Array<OpenStackCollectionJob>): Array<string> {
    return jobs.map((job: OpenStackCollectionJob): string => {
      return job.openStackCloudId;
    });
  }

  describe("the probe's claim of the clouds it collects", () => {
    test("hands the probe only its due, credential-saved, probe-collected clouds of live projects, never one it is running, oldest first", async () => {
      const neverCollected: ObjectID = await insertCloud({
        nextCollectionAt: null,
      });
      const due: ObjectID = await insertCloud({
        nextCollectionAt: minutesFromNow(-3),
        intervalInMinutes: 7,
        fingerprints: [FINGERPRINT.replace(/:/g, "").toLowerCase()],
        secret: "the-real-secret",
        settingsVersion: 4,
      });

      const notDue: ObjectID = await insertCloud({
        nextCollectionAt: minutesFromNow(5),
      });
      const agent: ObjectID = await insertCloud({
        method: OpenStackCollectionMethod.Agent,
      });
      const noCredential: ObjectID = await insertCloud({
        isCredentialSet: false,
      });
      const archived: ObjectID = await insertCloud({ archived: true });
      const deleted: ObjectID = await insertCloud({ deleted: true });
      const running: ObjectID = await insertCloud({});
      const anotherProbes: ObjectID = await insertCloud({
        probe: siblingProbeId,
      });
      // A row naming this probe from another project: never handed out.
      const otherProjects: ObjectID = await insertCloud({
        project: otherProjectId,
      });

      const untouched: Array<ObjectID> = [
        notDue,
        agent,
        noCredential,
        archived,
        deleted,
        running,
        anotherProbes,
        otherProjects,
      ];

      const before: Map<string, Date | null> = new Map();

      for (const id of untouched) {
        before.set(id.toString(), (await readCloud(id)).nextCollectionAt);
      }

      const jobs: Array<OpenStackCollectionJob> =
        await OpenStackCloudService.claimForCollection({
          probeId: probeId,
          runningOpenStackCloudIds: [running.toString()],
          limit: 10,
        });

      expect(idsOf(jobs)).toEqual([neverCollected.toString(), due.toString()]);

      expect(jobs[1]).toEqual({
        openStackCloudId: due.toString(),
        cloudName: expect.any(String),
        authUrl: expect.stringMatching(
          /^https:\/\/keystone-\d+\.example\.com:5000$/,
        ),
        credential: {
          kind: "applicationCredential",
          id: "an-application-credential",
          secret: "the-real-secret",
        },
        regions: ["RegionOne", "RegionTwo"],
        endpointInterface: "internal",
        trustedCertificateFingerprints: [FINGERPRINT],
        collectionIntervalInMinutes: 7,
        // Which instances keep metrics goes with every job, whatever else it reads.
        options: { instanceSeriesMode: "automatic", keptProjectIds: [] },
        settingsVersion: 4,
      });

      // The next collection is one interval on, from now.
      const dueRow: CloudRow = await readCloud(due);
      const movedBy: number = dueRow.nextCollectionAt!.getTime() - Date.now();
      expect(movedBy).toBeGreaterThan(7 * 60_000 - 30_000);
      expect(movedBy).toBeLessThanOrEqual(7 * 60_000);

      for (const id of untouched) {
        expect({
          id: id.toString(),
          next: (await readCloud(id)).nextCollectionAt,
        }).toEqual({ id: id.toString(), next: before.get(id.toString()) });
      }

      // A second claim right away hands nothing out twice.
      expect(
        await OpenStackCloudService.claimForCollection({
          probeId: probeId,
          runningOpenStackCloudIds: [running.toString()],
          limit: 10,
        }),
      ).toEqual([]);
    });

    test("a password is handed out as what it is, and the secret is read decrypted", async () => {
      const cloud: ObjectID = await insertCloud({
        password: true,
        secret: "a-password",
      });

      const jobs: Array<OpenStackCollectionJob> =
        await OpenStackCloudService.claimForCollection({
          probeId: probeId,
          runningOpenStackCloudIds: [],
          limit: 10,
        });

      expect(idsOf(jobs)).toEqual([cloud.toString()]);
      expect(jobs[0]!.credential).toEqual({
        kind: "password",
        username: "reader",
        password: "a-password",
        userDomainName: "Default",
        projectName: "monitoring",
        projectDomainName: "Default",
      });

      // At rest it is not what was handed out.
      expect((await readCloud(cloud)).credentialSecret).not.toBe("a-password");
    });

    test("a project that is deleted, blocked, or whose subscription ended, is not collected", async () => {
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

      // Each project's own probe.
      const deletedProbe: ObjectID = ObjectID.generate();
      const blockedProbe: ObjectID = ObjectID.generate();
      const canceledProbe: ObjectID = ObjectID.generate();
      const pastDueProbe: ObjectID = ObjectID.generate();
      await insertProbe({ id: deletedProbe, projectId: deletedProjectId });
      await insertProbe({ id: blockedProbe, projectId: blockedProjectId });
      await insertProbe({ id: canceledProbe, projectId: canceledProjectId });
      await insertProbe({ id: pastDueProbe, projectId: pastDueProjectId });

      await insertCloud({ project: deletedProjectId, probe: deletedProbe });
      await insertCloud({ project: blockedProjectId, probe: blockedProbe });
      await insertCloud({ project: canceledProjectId, probe: canceledProbe });
      const pastDue: ObjectID = await insertCloud({
        project: pastDueProjectId,
        probe: pastDueProbe,
      });

      for (const probe of [deletedProbe, blockedProbe, canceledProbe]) {
        expect(
          await OpenStackCloudService.claimForCollection({
            probeId: probe,
            runningOpenStackCloudIds: [],
            limit: 10,
          }),
        ).toEqual([]);
      }

      // past_due is still served, because Stripe is still retrying.
      expect(
        idsOf(
          await OpenStackCloudService.claimForCollection({
            probeId: pastDueProbe,
            runningOpenStackCloudIds: [],
            limit: 10,
          }),
        ),
      ).toEqual([pastDue.toString()]);
    });

    test("a global probe collects only on a self-hosted instance", async () => {
      const cloud: ObjectID = await insertCloud({ probe: globalProbeId });

      expect(
        idsOf(
          await OpenStackCloudService.claimForCollection({
            probeId: globalProbeId,
            runningOpenStackCloudIds: [],
            limit: 10,
          }),
        ),
      ).toEqual(IsBillingEnabled ? [] : [cloud.toString()]);
    });

    test("hands out no more than the free slots, and four claims at once hand out each cloud once", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await insertCloud({
              nextCollectionAt: minutesFromNow(-10 + index),
            })
          ).toString(),
        );
      }

      const firstTwo: Array<OpenStackCollectionJob> =
        await OpenStackCloudService.claimForCollection({
          probeId: probeId,
          runningOpenStackCloudIds: [],
          limit: 2,
        });
      expect(idsOf(firstTwo)).toEqual(ids.slice(0, 2));

      // The rest, shared by four claims at once: none twice, none lost.
      await expectConcurrentClaimsHandOutEachRowOnce({
        due: ids.slice(2),
        claim: async (limit: number): Promise<Array<string>> => {
          return idsOf(
            await OpenStackCloudService.claimForCollection({
              probeId: probeId,
              runningOpenStackCloudIds: [],
              limit: limit,
            }),
          );
        },
      });
    });

    /*
     * The claim moves each cloud on in SQL now, by getSafeInterval's rule:
     * none or not positive is the default, otherwise 1 to 60 minutes. The
     * job is handed the same interval the row is moved by.
     */
    test("moves each claimed cloud's next collection by its own interval, held to getSafeInterval's bounds", async () => {
      // [interval stored, minutes to the next collection]
      const intervals: Array<[number | null, number]> = [
        [null, 2],
        [-3, 2],
        [0, 2],
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
          await insertCloud({
            nextCollectionAt: minutesFromNow(-30 + index),
            intervalInMinutes: stored,
          }),
        );
      }

      const before: number = Date.now();
      const jobs: Array<OpenStackCollectionJob> =
        await OpenStackCloudService.claimForCollection({
          probeId: probeId,
          runningOpenStackCloudIds: [],
          limit: 20,
        });
      const after: number = Date.now();

      expect(idsOf(jobs)).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      for (const [index, [stored, minutes]] of intervals.entries()) {
        expect([
          stored,
          OpenStackProbeCollectionStore.getSafeInterval(stored),
          jobs[index]!.collectionIntervalInMinutes,
        ]).toEqual([stored, minutes, minutes]);

        // The claim read its clock between before and after.
        const next: number = (
          await readCloud(ids[index]!)
        ).nextCollectionAt!.getTime();
        expect([stored, Math.round((next - before) / 60_000)]).toEqual([
          stored,
          minutes,
        ]);
        expect(next).toBeGreaterThanOrEqual(before + minutes * 60_000);
        expect(next).toBeLessThanOrEqual(after + minutes * 60_000);
      }
    });

    test("a cloud another writer holds is skipped, not waited for, and is handed out once it is free", async () => {
      const held: ObjectID = await insertCloud({
        nextCollectionAt: minutesFromNow(-9),
      });
      const free: Array<ObjectID> = [
        await insertCloud({ nextCollectionAt: minutesFromNow(-8) }),
        await insertCloud({ nextCollectionAt: minutesFromNow(-7) }),
      ];

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "OpenStackCloud",
        held: held,
        free: free,
        claim: async (): Promise<Array<string>> => {
          return idsOf(
            await OpenStackCloudService.claimForCollection({
              probeId: probeId,
              runningOpenStackCloudIds: [],
              limit: 10,
            }),
          );
        },
      });
    });

    /*
     * The failure OneUptime issue #7194 reported, at its root: a claim held
     * every cloud it handed out FOR UPDATE for a whole transaction, and
     * every row that names one - an incident, an alert, a feed entry -
     * waited for it, past lock_timeout on a busy database.
     */
    test("while a claim's row locks are held, a row that names the cloud is still written; only the cloud row itself waits", async () => {
      const cloud: ObjectID = await insertCloud({});

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: OpenStackCloudService,
        table: "OpenStackCloud",
        referencingTable: referencingTable,
        id: cloud,
        claim: async (): Promise<Array<string>> => {
          return idsOf(
            await OpenStackCloudService.claimForCollection({
              probeId: probeId,
              runningOpenStackCloudIds: [],
              limit: 10,
            }),
          );
        },
      });
    });
  });

  describe("what a collection report writes", () => {
    test("a success of the current settings: the status, the summary, and when", async () => {
      const cloud: ObjectID = await insertCloud({ settingsVersion: 2 });

      const outcome: OpenStackCollectionReportOutcome =
        await OpenStackCloudService.recordCollectionReport({
          probeId: probeId,
          report: {
            openStackCloudId: cloud.toString(),
            settingsVersion: 2,
            collectedAt: new Date().toISOString(),
            status: "Succeeded",
            durationInMs: 800,
            summary: collectionSummary(),
          },
        });

      expect(outcome).toMatchObject({ accepted: true, isCurrent: true });
      expect(outcome.projectId!.toString()).toBe(projectId.toString());
      expect(outcome.cloudName).toEqual(expect.any(String));

      const row: CloudRow = await readCloud(cloud);
      expect(row.collectionStatus).toBe(OpenStackCollectionStatus.Succeeded);
      expect(row.collectionSummary).toMatchObject({
        hypervisorCount: 2,
        instanceCount: 10,
      });
      expect(row.lastCollectionAt).toBeInstanceOf(Date);
      expect(row.lastSuccessfulCollectionAt).toBeInstanceOf(Date);
    });

    test("a partial one says what it could not read, and still counts as collected", async () => {
      const cloud: ObjectID = await insertCloud({});

      await OpenStackCloudService.recordCollectionReport({
        probeId: probeId,
        report: {
          openStackCloudId: cloud.toString(),
          settingsVersion: 0,
          collectedAt: new Date().toISOString(),
          status: "PartiallySucceeded",
          errorCode: OpenStackCollectionErrorCode.ConnectionTimedOut,
          errorMessage: "Neutron did not answer.",
          durationInMs: 30,
          summary: collectionSummary(),
        },
      });

      const row: CloudRow = await readCloud(cloud);
      expect(row).toMatchObject({
        collectionStatus: OpenStackCollectionStatus.PartiallySucceeded,
        collectionErrorCode: OpenStackCollectionErrorCode.ConnectionTimedOut,
        collectionError: "Neutron did not answer.",
        presentedCertificate: null,
      });
      expect(row.lastSuccessfulCollectionAt).toBeInstanceOf(Date);
    });

    test("a failure keeps why, with the certificate to trust", async () => {
      const cloud: ObjectID = await insertCloud({});

      await OpenStackCloudService.recordCollectionReport({
        probeId: probeId,
        report: {
          openStackCloudId: cloud.toString(),
          settingsVersion: 0,
          collectedAt: new Date().toISOString(),
          status: "Failed",
          errorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
          errorMessage: "Not trusted.",
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=keystone",
            issuer: "CN=CA",
            isSelfSigned: false,
          },
          durationInMs: 30,
        },
      });

      const row: CloudRow = await readCloud(cloud);
      expect(row).toMatchObject({
        collectionStatus: OpenStackCollectionStatus.Failed,
        collectionErrorCode: OpenStackCollectionErrorCode.UntrustedCertificate,
        collectionError: "Not trusted.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=keystone",
          issuer: "CN=CA",
          isSelfSigned: false,
        },
        lastSuccessfulCollectionAt: null,
      });
    });

    test("another probe's report changes nothing, and one of older settings only says when", async () => {
      const cloud: ObjectID = await insertCloud({ settingsVersion: 3 });

      expect(
        (
          await OpenStackCloudService.recordCollectionReport({
            probeId: siblingProbeId,
            report: {
              openStackCloudId: cloud.toString(),
              settingsVersion: 3,
              collectedAt: new Date().toISOString(),
              status: "Succeeded",
              durationInMs: 1,
            },
          })
        ).accepted,
      ).toBe(false);
      expect((await readCloud(cloud)).lastCollectionAt).toBeNull();

      const outcome: OpenStackCollectionReportOutcome =
        await OpenStackCloudService.recordCollectionReport({
          probeId: probeId,
          report: {
            openStackCloudId: cloud.toString(),
            settingsVersion: 2,
            collectedAt: new Date().toISOString(),
            status: "Failed",
            errorCode: OpenStackCollectionErrorCode.InvalidCredential,
            durationInMs: 1,
          },
        });

      // Its data still counts, and only the status waits for the new settings.
      expect(outcome).toMatchObject({ accepted: true, isCurrent: false });

      const row: CloudRow = await readCloud(cloud);
      expect(row.lastCollectionAt).toBeInstanceOf(Date);
      expect(row.collectionStatus).toBeNull();
      expect(row.collectionErrorCode).toBeNull();
    });
  });

  test("a settings change bumps the settings version in the same statement, and asks for a collection now", async () => {
    const cloud: ObjectID = await insertCloud({
      settingsVersion: 6,
      nextCollectionAt: minutesFromNow(30),
    });

    await database.query(
      `UPDATE "${schema}"."OpenStackCloud" SET "collectionStatus" = 'Failed', "collectionErrorCode" = 'InvalidCredential', "presentedCertificate" = '{"fingerprint256":"x"}' WHERE "_id" = $1`,
      [cloud.toString()],
    );

    await OpenStackCloudConnection.afterWrite({
      change: {
        openStackCloudId: cloud,
        projectId: projectId,
        isConnectionChanged: true,
        isCredentialChanged: true,
        isCredentialSet: true,
        isSwitchedToAgent: false,
        feedLines: [],
        feedColor: Gray500,
      },
      writeServerColumns: async (write: {
        openStackCloudId: ObjectID;
        values: Record<string, unknown>;
        bumpSettingsVersion: boolean;
      }): Promise<void> => {
        await (
          OpenStackCloudService as unknown as {
            writeConnectionServerColumns: (data: typeof write) => Promise<void>;
          }
        ).writeConnectionServerColumns(write);
      },
    });

    const row: CloudRow = await readCloud(cloud);
    expect(row.collectionSettingsVersion).toBe(7);
    expect(row.collectionStatus).toBe(OpenStackCollectionStatus.Pending);
    expect(row.collectionErrorCode).toBeNull();
    expect(row.presentedCertificate).toBeNull();
    expect(row.isCredentialSet).toBe(true);
    expect(row.credentialsUpdatedAt).toBeInstanceOf(Date);
    expect(row.nextCollectionAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  describe("connection tests", () => {
    test("a probe is handed its fresh pending tests once, and the secret leaves the row as it is handed out", async () => {
      const fresh: ObjectID = await insertTest({ secret: "typed-secret" });
      const stale: ObjectID = await insertTest({
        createdAt: secondsFromNow(-600),
      });
      const others: ObjectID = await insertTest({ probe: siblingProbeId });
      const foreign: ObjectID = await insertTest({
        project: otherProjectId,
      });
      const deleted: ObjectID = await insertTest({ deleted: true });

      const jobs: Array<OpenStackConnectionTestJob> =
        await OpenStackCloudConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        });

      expect(jobs).toEqual([
        {
          openStackCloudConnectionTestId: fresh.toString(),
          authUrl: "https://keystone.example.com:5000",
          credential: {
            kind: "applicationCredential",
            id: "an-application-credential",
            secret: "typed-secret",
          },
          regions: ["RegionOne"],
          endpointInterface: "internal",
          trustedCertificateFingerprints: [FINGERPRINT],
        },
      ]);

      const claimed: TestRow = await readTest(fresh);
      expect(claimed.status).toBe(OpenStackConnectionTestStatus.Running);
      expect(claimed.claimedAt).toBeInstanceOf(Date);
      expect(claimed.credentialSecret).toBeNull();

      for (const id of [stale, others, foreign, deleted]) {
        expect((await readTest(id)).status).toBe(
          OpenStackConnectionTestStatus.Pending,
        );
      }

      expect(
        await OpenStackCloudConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        }),
      ).toEqual([]);
    });

    test("only the probe running a test answers it", async () => {
      const running: ObjectID = await insertTest({
        status: OpenStackConnectionTestStatus.Running,
        claimedAt: new Date(),
        secret: null,
      });

      expect(
        await OpenStackCloudConnectionTestService.recordTestReport({
          probeId: siblingProbeId,
          report: {
            openStackCloudConnectionTestId: running.toString(),
            status: "Succeeded",
            durationInMs: 10,
          },
        }),
      ).toBe(false);

      expect(
        await OpenStackCloudConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            openStackCloudConnectionTestId: running.toString(),
            status: "Succeeded",
            durationInMs: 10,
            summary: testSummary(),
          },
        }),
      ).toBe(true);

      const row: TestRow = await readTest(running);
      expect(row.status).toBe(OpenStackConnectionTestStatus.Succeeded);
      expect(row.summary).toMatchObject({
        accessLevel: "FullView",
        roleNames: ["reader"],
      });
      expect(row.completedAt).toBeInstanceOf(Date);

      // Settled, so a second answer is not heard.
      expect(
        await OpenStackCloudConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            openStackCloudConnectionTestId: running.toString(),
            status: "Failed",
            durationInMs: 10,
          },
        }),
      ).toBe(false);
    });

    test("tests nobody will answer are failed with the reason, and their secrets wiped", async () => {
      const neverPickedUp: ObjectID = await insertTest({
        createdAt: secondsFromNow(-200),
      });
      const neverReported: ObjectID = await insertTest({
        status: OpenStackConnectionTestStatus.Running,
        createdAt: secondsFromNow(-300),
        claimedAt: secondsFromNow(-200),
      });
      const waiting: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
      });
      const runningNow: ObjectID = await insertTest({
        status: OpenStackConnectionTestStatus.Running,
        claimedAt: secondsFromNow(-10),
      });

      await OpenStackCloudConnectionTestService.expireStaleTests();

      expect(await readTest(neverPickedUp)).toMatchObject({
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.ProbeNotAvailable,
        credentialSecret: null,
      });
      expect(await readTest(neverReported)).toMatchObject({
        status: OpenStackConnectionTestStatus.Failed,
        errorCode: OpenStackCollectionErrorCode.TimedOut,
        credentialSecret: null,
      });
      expect((await readTest(waiting)).status).toBe(
        OpenStackConnectionTestStatus.Pending,
      );
      expect((await readTest(runningNow)).status).toBe(
        OpenStackConnectionTestStatus.Running,
      );
    });
  });
});
