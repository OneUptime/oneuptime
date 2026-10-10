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
import VMwareVCenterConnectionTestService from "../../../Server/Services/VMwareVCenterConnectionTestService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import Encryption from "../../../Server/Utils/Encryption";
import logger from "../../../Server/Utils/Logger";
import VMwareVCenterConnection from "../../../Server/Utils/VMware/VMwareVCenterConnection";
import { VMwareCollectionReportOutcome } from "../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import { Gray500 } from "../../../Types/BrandColors";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import VMwareCollectionErrorCode from "../../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../../Types/VMware/VMwareCollectionStatus";
import VMwareConnectionTestStatus from "../../../Types/VMware/VMwareConnectionTestStatus";
import {
  VMwareCollectionJob,
  VMwareConnectionTestJob,
} from "../../../Types/VMware/VMwareProbeCollection";
import { DataSource } from "typeorm";

/*
 * Probe collection's hand-written SQL against a real Postgres: the probe's
 * claim of the vCenters it collects (FOR UPDATE SKIP LOCKED, its tenancy
 * backstop, the subscription rule), what a report writes, the settings
 * version bump a settings change makes, and the connection tests' claim,
 * report and expiry - each keyed on the probe. The unit suites pin the
 * statements' text; this runs them.
 *
 * Opt in with RUN_POSTGRES_VMWARE_PROBE_COLLECTION_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The Project, Probe,
 * VMwareVCenter and VMwareVCenterConnectionTest tables' STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema), dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from VMWARE_PROBE_COLLECTION_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from VMWARE_PROBE_COLLECTION_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_VMWARE_PROBE_COLLECTION_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "VMwareVCenter",
  "VMwareVCenterConnectionTest",
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

describePostgres("VMware probe collection SQL against Postgres", () => {
  const schema: string = `vmware_probe_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const siblingProbeId: ObjectID = ObjectID.generate();
  const foreignProbeId: ObjectID = ObjectID.generate();
  const globalProbeId: ObjectID = ObjectID.generate();

  let vcenterCount: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["VMWARE_PROBE_COLLECTION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["VMWARE_PROBE_COLLECTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["VMWARE_PROBE_COLLECTION_TEST_DATABASE_NAME"] ||
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

  interface VCenterRow {
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
    isVCenterPasswordSet: boolean;
    vcenterCredentialsUpdatedAt: Date | null;
  }

  interface TestRow {
    _id: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    vcenterPassword: string | null;
    claimedAt: Date | null;
    completedAt: Date | null;
    summary: Record<string, unknown> | null;
  }

  async function insertProject(data: {
    id: ObjectID;
    subscriptionStatus?: SubscriptionStatus | null;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "deletedAt")
       VALUES ($1, $2, $3, NULL, $4)`,
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

  async function insertVCenter(
    data: {
      project?: ObjectID;
      probe?: ObjectID | null;
      method?: VMwareCollectionMethod;
      isPasswordSet?: boolean;
      password?: string | null;
      nextCollectionAt?: Date | null;
      intervalInMinutes?: number | null;
      settingsVersion?: number;
      fingerprint?: string | null;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    vcenterCount++;

    await database.query(
      `INSERT INTO "${schema}"."VMwareVCenter"
        ("_id", "projectId", "name", "slug", "collectionMethod", "vcenterUrl", "vcenterUsername",
         "vcenterPassword", "isVCenterPasswordSet", "collectionProbeId", "trustedCertificateFingerprint",
         "collectionIntervalInMinutes", "nextCollectionAt", "collectionSettingsVersion",
         "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now(), $15, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `vCenter ${vcenterCount}`,
        `vcenter-${vcenterCount}-${id.toString().substring(0, 8)}`,
        data.method || VMwareCollectionMethod.Probe,
        `https://vcsa-${vcenterCount}.example.com`,
        "oneuptime@vsphere.local",
        data.password === null
          ? null
          : await Encryption.encrypt(data.password || `secret-${vcenterCount}`),
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

  async function readVCenter(id: ObjectID): Promise<VCenterRow> {
    const rows: Array<VCenterRow> = await database.query(
      `SELECT * FROM "${schema}"."VMwareVCenter" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function insertTest(
    data: {
      project?: ObjectID;
      probe?: ObjectID;
      status?: VMwareConnectionTestStatus;
      createdAt?: Date;
      claimedAt?: Date | null;
      password?: string | null;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."VMwareVCenterConnectionTest"
        ("_id", "projectId", "probeId", "vcenterUrl", "vcenterUsername", "vcenterPassword",
         "trustedCertificateFingerprint", "status", "claimedAt", "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, 'https://vcsa.example.com', 'oneuptime@vsphere.local', $4, $5, $6, $7, $8, $8, $9, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        (data.probe || probeId).toString(),
        data.password === null
          ? null
          : await Encryption.encrypt(data.password || "test-secret"),
        FINGERPRINT,
        data.status || VMwareConnectionTestStatus.Pending,
        data.claimedAt ?? null,
        data.createdAt || new Date(),
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function readTest(id: ObjectID): Promise<TestRow> {
    const rows: Array<TestRow> = await database.query(
      `SELECT * FROM "${schema}"."VMwareVCenterConnectionTest" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  function idsOf(jobs: Array<VMwareCollectionJob>): Array<string> {
    return jobs.map((job: VMwareCollectionJob): string => {
      return job.vmwareVCenterId;
    });
  }

  describe("the probe's claim of the vCenters it collects", () => {
    test("hands the probe only its due, password-saved, probe-collected vCenters of live projects - never one it is running - oldest first", async () => {
      const neverCollected: ObjectID = await insertVCenter({
        nextCollectionAt: null,
      });
      const due: ObjectID = await insertVCenter({
        nextCollectionAt: minutesFromNow(-3),
        intervalInMinutes: 7,
        fingerprint: FINGERPRINT.replace(/:/g, "").toLowerCase(),
        password: "the-real-secret",
        settingsVersion: 4,
      });

      const notDue: ObjectID = await insertVCenter({
        nextCollectionAt: minutesFromNow(5),
      });
      const agent: ObjectID = await insertVCenter({
        method: VMwareCollectionMethod.Agent,
      });
      const noPassword: ObjectID = await insertVCenter({
        isPasswordSet: false,
      });
      const deleted: ObjectID = await insertVCenter({ deleted: true });
      const running: ObjectID = await insertVCenter({});
      const anotherProbes: ObjectID = await insertVCenter({
        probe: siblingProbeId,
      });
      // A row naming this probe from another project: never handed out.
      const otherProjects: ObjectID = await insertVCenter({
        project: otherProjectId,
      });

      const before: Map<string, Date | null> = new Map();

      for (const id of [
        notDue,
        agent,
        noPassword,
        deleted,
        running,
        anotherProbes,
        otherProjects,
      ]) {
        before.set(id.toString(), (await readVCenter(id)).nextCollectionAt);
      }

      const jobs: Array<VMwareCollectionJob> =
        await VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [running.toString()],
          limit: 10,
        });

      expect(idsOf(jobs)).toEqual([neverCollected.toString(), due.toString()]);

      expect(jobs[1]).toEqual({
        vmwareVCenterId: due.toString(),
        vcenterName: expect.any(String),
        vcenterUrl: expect.stringMatching(/^https:\/\/vcsa-\d+\.example\.com$/),
        username: "oneuptime@vsphere.local",
        password: "the-real-secret",
        trustedCertificateFingerprint: FINGERPRINT,
        collectionIntervalInMinutes: 7,
        settingsVersion: 4,
      });

      // The next collection is one interval on, from now.
      const dueRow: VCenterRow = await readVCenter(due);
      const movedBy: number = dueRow.nextCollectionAt!.getTime() - Date.now();
      expect(movedBy).toBeGreaterThan(7 * 60_000 - 30_000);
      expect(movedBy).toBeLessThanOrEqual(7 * 60_000);

      for (const id of [
        notDue,
        agent,
        noPassword,
        deleted,
        running,
        anotherProbes,
        otherProjects,
      ]) {
        expect({
          id: id.toString(),
          next: (await readVCenter(id)).nextCollectionAt,
        }).toEqual({ id: id.toString(), next: before.get(id.toString()) });
      }

      // A second claim right away hands nothing out twice.
      expect(
        await VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [running.toString()],
          limit: 10,
        }),
      ).toEqual([]);
    });

    test("a project that is deleted, or whose subscription ended, is not collected", async () => {
      const deletedProjectId: ObjectID = ObjectID.generate();
      const canceledProjectId: ObjectID = ObjectID.generate();
      const pastDueProjectId: ObjectID = ObjectID.generate();

      await insertProject({ id: deletedProjectId, deleted: true });
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
      const canceledProbe: ObjectID = ObjectID.generate();
      const pastDueProbe: ObjectID = ObjectID.generate();
      await insertProbe({ id: deletedProbe, projectId: deletedProjectId });
      await insertProbe({ id: canceledProbe, projectId: canceledProjectId });
      await insertProbe({ id: pastDueProbe, projectId: pastDueProjectId });

      await insertVCenter({ project: deletedProjectId, probe: deletedProbe });
      await insertVCenter({ project: canceledProjectId, probe: canceledProbe });
      const pastDue: ObjectID = await insertVCenter({
        project: pastDueProjectId,
        probe: pastDueProbe,
      });

      for (const probe of [deletedProbe, canceledProbe]) {
        expect(
          await VMwareVCenterService.claimForCollection({
            probeId: probe,
            runningVMwareVCenterIds: [],
            limit: 10,
          }),
        ).toEqual([]);
      }

      // past_due is still served: Stripe is still retrying.
      expect(
        idsOf(
          await VMwareVCenterService.claimForCollection({
            probeId: pastDueProbe,
            runningVMwareVCenterIds: [],
            limit: 10,
          }),
        ),
      ).toEqual([pastDue.toString()]);
    });

    test("a global probe collects only on a self-hosted instance", async () => {
      const vcenter: ObjectID = await insertVCenter({ probe: globalProbeId });

      expect(
        idsOf(
          await VMwareVCenterService.claimForCollection({
            probeId: globalProbeId,
            runningVMwareVCenterIds: [],
            limit: 10,
          }),
        ),
      ).toEqual(IsBillingEnabled ? [] : [vcenter.toString()]);
    });

    test("hands out no more than the free slots, and two claims at once never hand out one vCenter twice", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await insertVCenter({
              nextCollectionAt: minutesFromNow(-10 + index),
            })
          ).toString(),
        );
      }

      const firstTwo: Array<VMwareCollectionJob> =
        await VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [],
          limit: 2,
        });
      expect(idsOf(firstTwo)).toEqual(ids.slice(0, 2));

      const [left, right] = await Promise.all([
        VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [],
          limit: 4,
        }),
        VMwareVCenterService.claimForCollection({
          probeId: probeId,
          runningVMwareVCenterIds: [],
          limit: 4,
        }),
      ]);

      const handedOut: Array<string> = [...idsOf(left!), ...idsOf(right!)];
      expect(new Set(handedOut).size).toBe(handedOut.length);
      expect([...handedOut].sort()).toEqual([...ids.slice(2)].sort());
    });
  });

  describe("what a collection report writes", () => {
    test("a success of the current settings: the status, the summary, and when", async () => {
      const vcenter: ObjectID = await insertVCenter({ settingsVersion: 2 });

      const outcome: VMwareCollectionReportOutcome =
        await VMwareVCenterService.recordCollectionReport({
          probeId: probeId,
          report: {
            vmwareVCenterId: vcenter.toString(),
            settingsVersion: 2,
            collectedAt: new Date().toISOString(),
            status: "Succeeded",
            durationInMs: 800,
            summary: {
              datacenterCount: 1,
              clusterCount: 2,
              hostCount: 5,
              vmCount: 10,
              poweredOnVmCount: 9,
              templateCount: 0,
              datastoreCount: 1,
              resourcePoolCount: 5,
              warnings: [],
            },
          },
        });

      expect(outcome).toMatchObject({ accepted: true, isCurrent: true });
      expect(outcome.projectId!.toString()).toBe(projectId.toString());

      const row: VCenterRow = await readVCenter(vcenter);
      expect(row.collectionStatus).toBe(VMwareCollectionStatus.Succeeded);
      expect(row.collectionSummary).toMatchObject({
        hostCount: 5,
        vmCount: 10,
      });
      expect(row.lastCollectionAt).toBeInstanceOf(Date);
      expect(row.lastSuccessfulCollectionAt).toBeInstanceOf(Date);
    });

    test("a failure keeps why, with the certificate to trust", async () => {
      const vcenter: ObjectID = await insertVCenter({});

      await VMwareVCenterService.recordCollectionReport({
        probeId: probeId,
        report: {
          vmwareVCenterId: vcenter.toString(),
          settingsVersion: 0,
          collectedAt: new Date().toISOString(),
          status: "Failed",
          errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
          errorMessage: "Not trusted.",
          presentedCertificate: {
            fingerprint256: FINGERPRINT,
            subject: "CN=vcsa",
            issuer: "CN=CA",
            isSelfSigned: false,
          },
          durationInMs: 30,
        },
      });

      const row: VCenterRow = await readVCenter(vcenter);
      expect(row).toMatchObject({
        collectionStatus: VMwareCollectionStatus.Failed,
        collectionErrorCode: VMwareCollectionErrorCode.UntrustedCertificate,
        collectionError: "Not trusted.",
        presentedCertificate: {
          fingerprint256: FINGERPRINT,
          subject: "CN=vcsa",
          issuer: "CN=CA",
          isSelfSigned: false,
        },
        lastSuccessfulCollectionAt: null,
      });
    });

    test("another probe's report changes nothing; one of older settings only says when", async () => {
      const vcenter: ObjectID = await insertVCenter({ settingsVersion: 3 });

      expect(
        (
          await VMwareVCenterService.recordCollectionReport({
            probeId: siblingProbeId,
            report: {
              vmwareVCenterId: vcenter.toString(),
              settingsVersion: 3,
              collectedAt: new Date().toISOString(),
              status: "Succeeded",
              durationInMs: 1,
            },
          })
        ).accepted,
      ).toBe(false);
      expect((await readVCenter(vcenter)).lastCollectionAt).toBeNull();

      await VMwareVCenterService.recordCollectionReport({
        probeId: probeId,
        report: {
          vmwareVCenterId: vcenter.toString(),
          settingsVersion: 2,
          collectedAt: new Date().toISOString(),
          status: "Failed",
          errorCode: VMwareCollectionErrorCode.InvalidLogin,
          durationInMs: 1,
        },
      });

      const row: VCenterRow = await readVCenter(vcenter);
      expect(row.lastCollectionAt).toBeInstanceOf(Date);
      expect(row.collectionStatus).toBeNull();
      expect(row.collectionErrorCode).toBeNull();
    });
  });

  test("a settings change bumps the settings version in the same statement, and asks for a collection now", async () => {
    const vcenter: ObjectID = await insertVCenter({
      settingsVersion: 6,
      nextCollectionAt: minutesFromNow(30),
    });

    await database.query(
      `UPDATE "${schema}"."VMwareVCenter" SET "collectionStatus" = 'Failed', "collectionErrorCode" = 'InvalidLogin', "presentedCertificate" = '{"fingerprint256":"x"}' WHERE "_id" = $1`,
      [vcenter.toString()],
    );

    await VMwareVCenterConnection.afterWrite({
      change: {
        vmwareVCenterId: vcenter,
        projectId: projectId,
        isConnectionChanged: true,
        isCredentialChanged: true,
        isPasswordSet: true,
        isSwitchedToAgent: false,
        feedLines: [],
        feedColor: Gray500,
      },
      writeServerColumns: async (write: {
        vmwareVCenterId: ObjectID;
        values: Record<string, unknown>;
        bumpSettingsVersion: boolean;
      }): Promise<void> => {
        await (
          VMwareVCenterService as unknown as {
            writeConnectionServerColumns: (data: typeof write) => Promise<void>;
          }
        ).writeConnectionServerColumns(write);
      },
    });

    const row: VCenterRow = await readVCenter(vcenter);
    expect(row.collectionSettingsVersion).toBe(7);
    expect(row.collectionStatus).toBe(VMwareCollectionStatus.Pending);
    expect(row.collectionErrorCode).toBeNull();
    expect(row.presentedCertificate).toBeNull();
    expect(row.isVCenterPasswordSet).toBe(true);
    expect(row.vcenterCredentialsUpdatedAt).toBeInstanceOf(Date);
    expect(row.nextCollectionAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  describe("connection tests", () => {
    test("a probe is handed its fresh pending tests once, and the password leaves the row as it is handed out", async () => {
      const fresh: ObjectID = await insertTest({ password: "typed-secret" });
      const stale: ObjectID = await insertTest({
        createdAt: secondsFromNow(-600),
      });
      const others: ObjectID = await insertTest({ probe: siblingProbeId });
      const foreign: ObjectID = await insertTest({
        project: otherProjectId,
      });
      const deleted: ObjectID = await insertTest({ deleted: true });

      const jobs: Array<VMwareConnectionTestJob> =
        await VMwareVCenterConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        });

      expect(jobs).toEqual([
        {
          vmwareVCenterConnectionTestId: fresh.toString(),
          vcenterUrl: "https://vcsa.example.com",
          username: "oneuptime@vsphere.local",
          password: "typed-secret",
          trustedCertificateFingerprint: FINGERPRINT,
        },
      ]);

      const claimed: TestRow = await readTest(fresh);
      expect(claimed.status).toBe(VMwareConnectionTestStatus.Running);
      expect(claimed.claimedAt).toBeInstanceOf(Date);
      expect(claimed.vcenterPassword).toBeNull();

      for (const id of [stale, others, foreign, deleted]) {
        expect((await readTest(id)).status).toBe(
          VMwareConnectionTestStatus.Pending,
        );
      }

      expect(
        await VMwareVCenterConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: 5,
        }),
      ).toEqual([]);
    });

    test("only the probe running a test answers it", async () => {
      const running: ObjectID = await insertTest({
        status: VMwareConnectionTestStatus.Running,
        claimedAt: new Date(),
        password: null,
      });

      expect(
        await VMwareVCenterConnectionTestService.recordTestReport({
          probeId: siblingProbeId,
          report: {
            vmwareVCenterConnectionTestId: running.toString(),
            status: "Succeeded",
            durationInMs: 10,
          },
        }),
      ).toBe(false);

      expect(
        await VMwareVCenterConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            vmwareVCenterConnectionTestId: running.toString(),
            status: "Succeeded",
            durationInMs: 10,
            summary: {
              datacenterCount: 1,
              clusterCount: 0,
              hostCount: 1,
              vmCount: 2,
              poweredOnVmCount: 2,
              templateCount: 0,
              datastoreCount: 1,
              resourcePoolCount: 1,
              warnings: [],
            },
          },
        }),
      ).toBe(true);

      const row: TestRow = await readTest(running);
      expect(row.status).toBe(VMwareConnectionTestStatus.Succeeded);
      expect(row.summary).toMatchObject({ hostCount: 1, vmCount: 2 });
      expect(row.completedAt).toBeInstanceOf(Date);

      // Settled: a second answer is not heard.
      expect(
        await VMwareVCenterConnectionTestService.recordTestReport({
          probeId: probeId,
          report: {
            vmwareVCenterConnectionTestId: running.toString(),
            status: "Failed",
            durationInMs: 10,
          },
        }),
      ).toBe(false);
    });

    test("tests nobody will answer are failed with the reason, and their passwords wiped", async () => {
      const neverPickedUp: ObjectID = await insertTest({
        createdAt: secondsFromNow(-200),
      });
      const neverReported: ObjectID = await insertTest({
        status: VMwareConnectionTestStatus.Running,
        createdAt: secondsFromNow(-300),
        claimedAt: secondsFromNow(-200),
      });
      const waiting: ObjectID = await insertTest({
        createdAt: secondsFromNow(-10),
      });
      const runningNow: ObjectID = await insertTest({
        status: VMwareConnectionTestStatus.Running,
        claimedAt: secondsFromNow(-10),
      });

      await VMwareVCenterConnectionTestService.expireStaleTests();

      expect(await readTest(neverPickedUp)).toMatchObject({
        status: VMwareConnectionTestStatus.Failed,
        errorCode: VMwareCollectionErrorCode.ProbeNotAvailable,
        vcenterPassword: null,
      });
      expect(await readTest(neverReported)).toMatchObject({
        status: VMwareConnectionTestStatus.Failed,
        errorCode: VMwareCollectionErrorCode.TimedOut,
        vcenterPassword: null,
      });
      expect((await readTest(waiting)).status).toBe(
        VMwareConnectionTestStatus.Pending,
      );
      expect((await readTest(runningNow)).status).toBe(
        VMwareConnectionTestStatus.Running,
      );
    });
  });
});
