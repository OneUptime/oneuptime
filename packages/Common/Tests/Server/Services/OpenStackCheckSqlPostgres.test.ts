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
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackCloudCheckService from "../../../Server/Services/OpenStackCloudCheckService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import OpenStackCheckStore, {
  OpenStackCheckReportOutcome,
} from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import ObjectID from "../../../Types/ObjectID";
import {
  DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OpenStackApiCheckJob,
  OpenStackApiCheckResult,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
} from "../../../Types/OpenStack/OpenStackCheck";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import {
  createReferencingTable,
  expectClaimLocksHoldOnlyTheRow,
  expectConcurrentClaimsHandOutEachRowOnce,
  expectHeldRowSkipped,
} from "../TestingUtils/Postgres/ClaimRowLocks";
import { DataSource } from "typeorm";

/*
 * The checks' hand-written SQL against a real Postgres: what a probe claims and what it is handed,
 * including who may be handed which, and what a report leaves on the row. The unit suites hold the
 * rules, and this runs the statements.
 *
 * Opt in as OpenStackProbeCollectionSqlPostgres does: the tables' structure is cloned into a unique
 * schema, and dropped afterwards.
 */

const LOCK_TIMEOUT_MS: number = 2000;

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OPENSTACK_PROBE_COLLECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "OpenStackCloud",
  "OpenStackCloudCheck",
];

const DASHES: RegExp = /-/g;

const AUTH_URL: string = "https://keystone.example.com:5000/v3";
const ENDPOINT_KEY: string = "keystone.example.com:5000";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function apiResult(): OpenStackApiCheckResult {
  return {
    startedAt: new Date().toISOString(),
    durationInMs: 900,
    regionNames: ["RegionOne"],
    token: { status: "Passed", durationInMs: 180 },
    services: [],
    certificates: [],
    warnings: [],
  };
}

function goodRun(): OpenStackLifecycleRun {
  return {
    runId: "20261105010203-abcdef",
    regionName: "RegionOne",
    startedAt: minutesFromNow(-5).toISOString(),
    finishedAt: minutesFromNow(-1).toISOString(),
    status: "Succeeded",
    steps: [
      {
        step: OpenStackLifecycleStep.ServerActive,
        status: "Passed",
        durationInMs: 40000,
      },
    ],
    phases: { boot: "Passed" },
    leftoverCount: 0,
    verifiedProjectId: "aaaaaaaabbbbbbbbccccccccdddddddd",
    verifiedProjectName: "oneuptime-checks",
    requestCount: 10,
    writeCount: 2,
    warnings: [],
  };
}

describePostgres("OpenStack checks' SQL against Postgres", () => {
  const schema: string = `openstack_check_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a check by a foreign key, as its run records do.
  let referencingTable: string;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const collectionProbeId: ObjectID = ObjectID.generate();
  const foreignProbeId: ObjectID = ObjectID.generate();

  let count: number = 0;

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
      parentTable: "OpenStackCloudCheck",
    });
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

    for (const id of [projectId, otherProjectId]) {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked") VALUES ($1, $2, false)`,
        [id.toString(), `Project ${id.toString()}`],
      );
    }

    for (const [id, owner] of [
      [probeId, projectId],
      [collectionProbeId, projectId],
      [foreignProbeId, otherProjectId],
    ] as Array<[ObjectID, ObjectID]>) {
      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe") VALUES ($1, $2, $3, false)`,
        [id.toString(), owner.toString(), `Probe ${id.toString()}`],
      );
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertCloud(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    count++;

    await database.query(
      `INSERT INTO "${schema}"."OpenStackCloud"
        ("_id", "projectId", "name", "slug", "collectionMethod", "authUrl", "endpointInterface",
         "collectionRegions", "credentialKind", "applicationCredentialId", "credentialSecret",
         "isCredentialSet", "collectionProbeId", "isArchived", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, 'public', $7, 'applicationCredential', 'the-clouds', $8, true, $9,
               false, now(), now(), 1)`,
      [
        id.toString(),
        projectId.toString(),
        `Cloud ${count}`,
        `cloud-${count}-${id.toString().substring(0, 8)}`,
        OpenStackCollectionMethod.Probe,
        AUTH_URL,
        JSON.stringify(["RegionOne"]),
        await Encryption.encrypt("the-clouds-secret"),
        collectionProbeId.toString(),
      ],
    );

    return id;
  }

  async function insertCheck(data: {
    cloudId: ObjectID;
    probe?: ObjectID | null;
    isApiOn?: boolean;
    isLifecycleOn?: boolean;
    isSweepPending?: boolean;
    next?: Date;
    settingsVersion?: number;
    apiIntervalInMinutes?: number | null;
    lifecycleIntervalInMinutes?: number | null;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const probe: ObjectID | null =
      data.probe === undefined ? probeId : data.probe;
    const isOwnConnection: boolean = Boolean(probe);

    await database.query(
      `INSERT INTO "${schema}"."OpenStackCloudCheck"
        ("_id", "projectId", "openStackCloudId", "probeId", "authUrl", "endpointInterface", "regions",
         "credentialKind", "applicationCredentialId", "credentialSecret", "isCredentialSet", "credentialBinding",
         "isApiCheckEnabled", "apiCheckIntervalInMinutes", "nextApiCheckAt",
         "isLifecycleCheckEnabled", "lifecycleCheckIntervalInMinutes", "nextLifecycleCheckAt", "lifecycleProjectName",
         "isSweepPending", "osProfilerKey", "isOsProfilerKeySet", "settingsVersion", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, 'public', $6, 'applicationCredential', 'the-checks', $7, $8, $9,
               $10, $16, $11, $12, $17, $11, 'oneuptime-checks', $13, $14, true, $15, now(), now(), 1)`,
      [
        id.toString(),
        projectId.toString(),
        data.cloudId.toString(),
        probe ? probe.toString() : null,
        isOwnConnection ? AUTH_URL : null,
        JSON.stringify([]),
        isOwnConnection ? await Encryption.encrypt("the-checks-secret") : null,
        isOwnConnection,
        isOwnConnection
          ? JSON.stringify({
              endpointKey: ENDPOINT_KEY,
              probeId: probe?.toString(),
              trustedCertificateFingerprints: [],
            })
          : null,
        data.isApiOn ?? true,
        data.next || minutesFromNow(-1),
        data.isLifecycleOn ?? false,
        data.isSweepPending ?? false,
        await Encryption.encrypt("the-key"),
        data.settingsVersion ?? 3,
        data.apiIntervalInMinutes === undefined ? 1 : data.apiIntervalInMinutes,
        data.lifecycleIntervalInMinutes === undefined
          ? 30
          : data.lifecycleIntervalInMinutes,
      ],
    );

    return id;
  }

  async function readCheck(id: ObjectID): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."OpenStackCloudCheck" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  function claimApi(
    forProbe: ObjectID,
    runningIds: Array<string> = [],
  ): Promise<Array<OpenStackApiCheckJob>> {
    return OpenStackCloudCheckService.claimApiChecks({
      probeId: forProbe,
      runningIds: runningIds,
      limit: 10,
    });
  }

  function claimLifecycle(
    forProbe: ObjectID,
    runningIds: Array<string> = [],
  ): Promise<Array<OpenStackLifecycleCheckJob>> {
    return OpenStackCloudCheckService.claimLifecycleChecks({
      probeId: forProbe,
      runningIds: runningIds,
      limit: 10,
    });
  }

  describe("what a probe claims", () => {
    test("is handed once a check is due, and not again until it next is", async () => {
      const cloudId: ObjectID = await insertCloud();
      const checkId: ObjectID = await insertCheck({ cloudId: cloudId });

      const jobs: Array<OpenStackApiCheckJob> = await claimApi(probeId);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.openStackCloudCheckId).toBe(checkId.toString());
      expect(jobs[0]!.authUrl).toBe(AUTH_URL);
      expect(jobs[0]!.credential).toMatchObject({
        kind: "applicationCredential",
        id: "the-checks",
        secret: "the-checks-secret",
      });

      const row: Record<string, unknown> = await readCheck(checkId);

      expect((row["nextApiCheckAt"] as Date).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(await claimApi(probeId)).toEqual([]);
    });

    test("one a probe is still running is not handed to it again", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
      });

      expect(await claimApi(probeId, [checkId.toString()])).toEqual([]);
      expect(await claimApi(probeId)).toHaveLength(1);
    });

    test("no other probe is handed it, in this project or another", async () => {
      await insertCheck({ cloudId: await insertCloud() });

      expect(await claimApi(collectionProbeId)).toEqual([]);
      expect(await claimApi(foreignProbeId)).toEqual([]);
      expect(await claimApi(probeId)).toHaveLength(1);
    });

    test("with no connection of its own, the probe that collects the cloud goes, with the cloud's credential", async () => {
      await insertCheck({ cloudId: await insertCloud(), probe: null });

      const jobs: Array<OpenStackApiCheckJob> =
        await claimApi(collectionProbeId);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.credential).toMatchObject({
        id: "the-clouds",
        secret: "the-clouds-secret",
      });
    });

    test("a lifecycle check is handed its own credential, its project and its key", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
        isLifecycleOn: true,
      });

      const jobs: Array<OpenStackLifecycleCheckJob> =
        await claimLifecycle(probeId);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.openStackCloudCheckId).toBe(checkId.toString());
      expect(jobs[0]!.expectedProjectName).toBe("oneuptime-checks");
      expect(jobs[0]!.checkKey).toMatch(/^[0-9a-f]{12}$/);
      expect(jobs[0]!.osProfilerKey).toBe("the-key");
      expect(jobs[0]!.credential).toMatchObject({
        id: "the-checks",
        secret: "the-checks-secret",
      });
      expect(jobs[0]!.isSweepOnly).toBeFalsy();
      expect(await claimLifecycle(probeId)).toEqual([]);
    });

    test("one that is off is not handed out, unless there is clearing up to do, and then it only clears up", async () => {
      await insertCheck({ cloudId: await insertCloud() });

      expect(await claimLifecycle(probeId)).toEqual([]);

      await insertCheck({
        cloudId: await insertCloud(),
        isSweepPending: true,
      });

      const jobs: Array<OpenStackLifecycleCheckJob> =
        await claimLifecycle(probeId);

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.isSweepOnly).toBe(true);
    });

    /*
     * The claim moves each check on in SQL now, by getSafeApiInterval's
     * and getSafeLifecycleInterval's rule: a whole minute or more is the
     * check's own, anything else the default. The job is handed the same
     * interval the row is moved by.
     */
    test("an API check is moved on by its own interval, or by the default when it has none", async () => {
      // [interval stored, minutes to the next check]
      const intervals: Array<[number | null, number]> = [
        [null, DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES],
        [-3, DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES],
        [0, DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES],
        [1, 1],
        [2, 2],
        [7, 7],
        [61, 61],
        [500, 500],
      ];
      const ids: Array<ObjectID> = [];

      for (const [index, [stored]] of intervals.entries()) {
        ids.push(
          await insertCheck({
            cloudId: await insertCloud(),
            next: minutesFromNow(-30 + index),
            apiIntervalInMinutes: stored,
          }),
        );
      }

      const before: number = Date.now();
      const jobs: Array<OpenStackApiCheckJob> = await claimApi(probeId);
      const after: number = Date.now();

      expect(
        jobs.map((job: OpenStackApiCheckJob): string => {
          return job.openStackCloudCheckId;
        }),
      ).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      for (const [index, [stored, minutes]] of intervals.entries()) {
        expect([
          stored,
          OpenStackCheckStore.getSafeApiInterval(stored),
          jobs[index]!.intervalInMinutes,
        ]).toEqual([stored, minutes, minutes]);

        // The claim read its clock between before and after.
        const row: Record<string, unknown> = await readCheck(ids[index]!);
        const next: number = (row["nextApiCheckAt"] as Date).getTime();
        expect([stored, Math.round((next - before) / 60_000)]).toEqual([
          stored,
          minutes,
        ]);
        expect(next).toBeGreaterThanOrEqual(before + minutes * 60_000);
        expect(next).toBeLessThanOrEqual(after + minutes * 60_000);

        // Only the API check's time moves.
        expect((row["nextLifecycleCheckAt"] as Date).getTime()).toBeLessThan(
          before,
        );
      }
    });

    test("a lifecycle check is moved on by its own interval, or by the default when it has none", async () => {
      // [interval stored, minutes to the next check]
      const intervals: Array<[number | null, number]> = [
        [null, DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES],
        [-3, DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES],
        [0, DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES],
        [1, 1],
        [45, 45],
        [500, 500],
      ];
      const ids: Array<ObjectID> = [];

      for (const [index, [stored]] of intervals.entries()) {
        ids.push(
          await insertCheck({
            cloudId: await insertCloud(),
            isLifecycleOn: true,
            next: minutesFromNow(-30 + index),
            lifecycleIntervalInMinutes: stored,
          }),
        );
      }

      const before: number = Date.now();
      const jobs: Array<OpenStackLifecycleCheckJob> =
        await claimLifecycle(probeId);
      const after: number = Date.now();

      expect(
        jobs.map((job: OpenStackLifecycleCheckJob): string => {
          return job.openStackCloudCheckId;
        }),
      ).toEqual(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      for (const [index, [stored, minutes]] of intervals.entries()) {
        expect([
          stored,
          OpenStackCheckStore.getSafeLifecycleInterval(stored),
          jobs[index]!.intervalInMinutes,
        ]).toEqual([stored, minutes, minutes]);

        const row: Record<string, unknown> = await readCheck(ids[index]!);
        const next: number = (row["nextLifecycleCheckAt"] as Date).getTime();
        expect([stored, Math.round((next - before) / 60_000)]).toEqual([
          stored,
          minutes,
        ]);
        expect(next).toBeGreaterThanOrEqual(before + minutes * 60_000);
        expect(next).toBeLessThanOrEqual(after + minutes * 60_000);

        // Only the lifecycle check's time moves.
        expect((row["nextApiCheckAt"] as Date).getTime()).toBeLessThan(before);
      }
    });

    test("four claims at once hand out each due check once, of either kind", async () => {
      const apiChecks: Array<string> = [];
      const lifecycleChecks: Array<string> = [];

      for (let index: number = 0; index < 8; index++) {
        apiChecks.push(
          (
            await insertCheck({
              cloudId: await insertCloud(),
              next: minutesFromNow(-20 + index),
            })
          ).toString(),
        );
        lifecycleChecks.push(
          (
            await insertCheck({
              cloudId: await insertCloud(),
              isApiOn: false,
              isLifecycleOn: true,
              next: minutesFromNow(-20 + index),
            })
          ).toString(),
        );
      }

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: apiChecks,
        claim: async (limit: number): Promise<Array<string>> => {
          return (
            await OpenStackCloudCheckService.claimApiChecks({
              probeId: probeId,
              runningIds: [],
              limit: limit,
            })
          ).map((job: OpenStackApiCheckJob): string => {
            return job.openStackCloudCheckId;
          });
        },
      });

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: lifecycleChecks,
        claim: async (limit: number): Promise<Array<string>> => {
          return (
            await OpenStackCloudCheckService.claimLifecycleChecks({
              probeId: probeId,
              runningIds: [],
              limit: limit,
            })
          ).map((job: OpenStackLifecycleCheckJob): string => {
            return job.openStackCloudCheckId;
          });
        },
      });
    });

    test("a check another writer holds is skipped, not waited for, and is handed out once it is free", async () => {
      const held: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
        next: minutesFromNow(-9),
      });
      const free: Array<ObjectID> = [
        await insertCheck({
          cloudId: await insertCloud(),
          next: minutesFromNow(-8),
        }),
        await insertCheck({
          cloudId: await insertCloud(),
          next: minutesFromNow(-7),
        }),
      ];

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "OpenStackCloudCheck",
        held: held,
        free: free,
        claim: async (): Promise<Array<string>> => {
          return (await claimApi(probeId)).map(
            (job: OpenStackApiCheckJob): string => {
              return job.openStackCloudCheckId;
            },
          );
        },
      });
    });

    /*
     * The failure OneUptime issue #7194 reported, at its root: a claim held
     * every check it handed out FOR UPDATE for a whole transaction, and
     * every row that names one waited for it, past lock_timeout on a busy
     * database. Each kind of claim is its own statement.
     */
    test("while an API or a lifecycle claim's row locks are held, a row that names the check is still written; only the check row itself waits", async () => {
      const apiCheck: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
      });

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: OpenStackCloudCheckService,
        table: "OpenStackCloudCheck",
        referencingTable: referencingTable,
        id: apiCheck,
        claim: async (): Promise<Array<string>> => {
          return (await claimApi(probeId)).map(
            (job: OpenStackApiCheckJob): string => {
              return job.openStackCloudCheckId;
            },
          );
        },
      });

      const lifecycleCheck: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
        isApiOn: false,
        isLifecycleOn: true,
      });

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: OpenStackCloudCheckService,
        table: "OpenStackCloudCheck",
        referencingTable: referencingTable,
        id: lifecycleCheck,
        claim: async (): Promise<Array<string>> => {
          return (await claimLifecycle(probeId)).map(
            (job: OpenStackLifecycleCheckJob): string => {
              return job.openStackCloudCheckId;
            },
          );
        },
      });
    });
  });

  describe("what a report leaves", () => {
    test("an API check's result, on the row, with the time", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
      });

      const outcome: OpenStackCheckReportOutcome =
        await OpenStackCloudCheckService.recordReport({
          probeId: probeId,
          report: {
            openStackCloudCheckId: checkId.toString(),
            settingsVersion: 3,
            kind: "api",
            api: apiResult(),
          },
          scopeVersion: "1",
        });

      expect(outcome.accepted).toBe(true);

      const row: Record<string, unknown> = await readCheck(checkId);

      expect(
        (row["apiCheckResult"] as OpenStackApiCheckResult).token.status,
      ).toBe("Passed");
      expect(row["lastApiCheckAt"]).toBeInstanceOf(Date);
    });

    test("a probe that does not run it is told so, and nothing changes", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
      });

      const outcome: OpenStackCheckReportOutcome =
        await OpenStackCloudCheckService.recordReport({
          probeId: foreignProbeId,
          report: {
            openStackCloudCheckId: checkId.toString(),
            settingsVersion: 3,
            kind: "api",
            api: apiResult(),
          },
          scopeVersion: "1",
        });

      expect(outcome.accepted).toBe(false);
      expect((await readCheck(checkId))["apiCheckResult"]).toBeNull();
    });

    test("a run's verdict, and the project it verified, which later credentials are held to", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
        isLifecycleOn: true,
      });

      const outcome: OpenStackCheckReportOutcome =
        await OpenStackCloudCheckService.recordReport({
          probeId: probeId,
          report: {
            openStackCloudCheckId: checkId.toString(),
            settingsVersion: 3,
            kind: "lifecycle",
            lifecycle: [goodRun()],
          },
          scopeVersion: "1",
        });

      expect(outcome.accepted).toBe(true);

      const row: Record<string, unknown> = await readCheck(checkId);
      const records: OpenStackLifecycleRecords = row[
        "lifecycleRecords"
      ] as OpenStackLifecycleRecords;

      expect(records["RegionOne"]?.lastVerdict?.status).toBe("Succeeded");
      expect(records["RegionOne"]?.recent).toHaveLength(1);
      expect(row["pinnedLifecycleProjectId"]).toBe(
        "aaaaaaaabbbbbbbbccccccccdddddddd",
      );
      expect(row["lastLifecycleCheckAt"]).toBeInstanceOf(Date);
    });

    test("the secret and the key are encrypted at rest, and a sweep that finds nothing forgets them", async () => {
      const checkId: ObjectID = await insertCheck({
        cloudId: await insertCloud(),
        isApiOn: false,
        isSweepPending: true,
      });

      const before: Record<string, unknown> = await readCheck(checkId);

      expect(before["credentialSecret"]).not.toBe("the-checks-secret");
      expect(before["osProfilerKey"]).not.toBe("the-key");

      const swept: OpenStackLifecycleRun = {
        ...goodRun(),
        status: "Swept",
        steps: [],
        phases: {},
        janitor: { removed: [], remainingCount: 0, errors: [] },
      };

      await OpenStackCloudCheckService.recordReport({
        probeId: probeId,
        report: {
          openStackCloudCheckId: checkId.toString(),
          settingsVersion: 3,
          kind: "lifecycle",
          lifecycle: [swept],
        },
        scopeVersion: "1",
      });

      const after: Record<string, unknown> = await readCheck(checkId);

      expect(after["isSweepPending"]).toBe(false);
      expect(after["credentialSecret"]).toBeNull();
      expect(after["osProfilerKey"]).toBeNull();
      expect(after["isCredentialSet"]).toBe(false);
    });
  });
});
