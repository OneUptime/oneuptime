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
import { OpenStackCheckReportOutcome } from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackApiCheckJob,
  OpenStackApiCheckResult,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
} from "../../../Types/OpenStack/OpenStackCheck";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
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
               $10, 1, $11, $12, 30, $11, 'oneuptime-checks', $13, $14, true, $15, now(), now(), 1)`,
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
