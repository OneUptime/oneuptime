import Entities from "../../../Models/DatabaseModels/Index";
import Host from "../../../Models/DatabaseModels/Host";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import HostService, {
  HostsThatMayNeedAttention,
} from "../../../Server/Services/HostService";
import logger from "../../../Server/Utils/Logger";
import {
  HostHealthAssessment,
  assessHost,
} from "../../../Types/Host/HostHealth";
import { HostCollectorConfigStatus } from "../../../Types/HostCollector/HostCollector";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The Hosts list's Needs attention read (HostService
 * .findHostsThatMayNeedAttention) and the readings ingest stores, executed
 * on Postgres against the migrated "Host" table.
 *
 * Opt in with RUN_POSTGRES_HOST_NEEDS_ATTENTION_TESTS=true against a
 * database the registered migrations (1808830000000-AddHostReadings
 * included) have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_HOST_NEEDS_ATTENTION_TESTS=true \
 *   HOST_NEEDS_ATTENTION_TEST_DATABASE_HOST=127.0.0.1 \
 *   HOST_NEEDS_ATTENTION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/HostNeedsAttentionPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml, right after that job has
 * applied every registered migration to an empty database.
 *
 * Why a real Postgres: the unit suite (HostServiceNeedsAttention) pins what
 * each condition asks for as text - a numeric column above a bound value,
 * a load above twice the row's own cores (QueryHelper
 * .greaterThanOtherColumnTimes), a NULL test, a boolean - and here Postgres
 * runs them through TypeORM, on the migrated columns' real types (numeric,
 * integer, jsonb): every host that HostHealth says needs attention is found,
 * no healthy one is, and never an archived host or another project's.
 *
 * It works on a structure-only clone (LIKE ... INCLUDING ALL) of "Host" in a
 * uniquely named schema that is the connection's first search_path entry
 * and is dropped afterwards. Every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_HOST_NEEDS_ATTENTION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "Host";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

const NOW: Date = new Date();

// What HostHealth says of a host that needs attention.
const NEEDS_ATTENTION_SEVERITY: RegExp = /^(critical|warning)$/;
const MINUTE: number = 60 * 1000;

function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

interface SeedHost {
  name: string;
  projectId?: ObjectID;
  isArchived?: boolean;
  otelCollectorStatus?: string | null;
  lastSeenAt?: Date | null;
  createdAt?: Date;
  cpuCores?: number | null;
  latestCpuPercent?: number | null;
  latestMemoryPercent?: number | null;
  latestSwapPercent?: number | null;
  latestDiskPercent?: number | null;
  latestDiskMountpoint?: string | null;
  latestInodesPercent?: number | null;
  latestInodesMountpoint?: string | null;
  latestLoadAverage15m?: number | null;
  failedSystemdUnitCount?: number | null;
  failedSystemdUnits?: Array<string> | null;
  readingsUpdatedAt?: Date | null;
  collectorInstanceUid?: string | null;
  collectorRegisteredAt?: Date | null;
  collectorConfigStatus?: string | null;
  isCollectorHealthy?: boolean | null;
}

// A reporting host whose readings need nothing.
function healthy(name: string, extra: Partial<SeedHost> = {}): SeedHost {
  return {
    name: name,
    otelCollectorStatus: "connected",
    lastSeenAt: ago(1),
    readingsUpdatedAt: ago(1),
    cpuCores: 4,
    latestCpuPercent: 35,
    latestMemoryPercent: 40,
    latestSwapPercent: 0,
    latestDiskPercent: 50,
    latestDiskMountpoint: "/",
    latestInodesPercent: 10,
    latestInodesMountpoint: "/",
    latestLoadAverage15m: 1,
    failedSystemdUnitCount: 0,
    failedSystemdUnits: [],
    ...extra,
  };
}

describePostgres("The Hosts list's Needs attention read on Postgres", () => {
  const schema: string = `host_attention_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  async function seed(hosts: Array<SeedHost>): Promise<void> {
    for (const host of hosts) {
      await database.query(
        `INSERT INTO "${schema}"."${TABLE}" (
          "version", "projectId", "name", "slug", "hostIdentifier",
          "isArchived", "otelCollectorStatus", "lastSeenAt", "createdAt",
          "cpuCores", "latestCpuPercent", "latestMemoryPercent",
          "latestSwapPercent", "latestDiskPercent", "latestDiskMountpoint",
          "latestInodesPercent", "latestInodesMountpoint",
          "latestLoadAverage15m", "failedSystemdUnitCount",
          "failedSystemdUnits", "readingsUpdatedAt", "collectorInstanceUid",
          "collectorRegisteredAt", "collectorConfigStatus", "isCollectorHealthy"
        ) VALUES (
          1, $1, $2, $3, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23
        )`,
        [
          (host.projectId || PROJECT_ID).toString(),
          host.name,
          `${host.name}-${ObjectID.generate().toString().substring(0, 8)}`,
          host.isArchived ?? false,
          host.otelCollectorStatus ?? null,
          host.lastSeenAt ?? null,
          host.createdAt ?? ago(24 * 60),
          host.cpuCores ?? null,
          host.latestCpuPercent ?? null,
          host.latestMemoryPercent ?? null,
          host.latestSwapPercent ?? null,
          host.latestDiskPercent ?? null,
          host.latestDiskMountpoint ?? null,
          host.latestInodesPercent ?? null,
          host.latestInodesMountpoint ?? null,
          host.latestLoadAverage15m ?? null,
          host.failedSystemdUnitCount ?? null,
          host.failedSystemdUnits === undefined ||
          host.failedSystemdUnits === null
            ? null
            : JSON.stringify(host.failedSystemdUnits),
          host.readingsUpdatedAt ?? null,
          host.collectorInstanceUid ?? null,
          host.collectorRegisteredAt ?? null,
          host.collectorConfigStatus ?? null,
          host.isCollectorHealthy ?? null,
        ],
      );
    }
  }

  async function found(): Promise<HostsThatMayNeedAttention> {
    return HostService.findHostsThatMayNeedAttention({
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });
  }

  function namesOf(result: HostsThatMayNeedAttention): Array<string> {
    return result.hosts
      .map((host: Host): string => {
        return host.name || "";
      })
      .sort();
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["HOST_NEEDS_ATTENTION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["HOST_NEEDS_ATTENTION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["HOST_NEEDS_ATTENTION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      try {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.destroy();
      }
    }
  });

  test("finds a host for every line HostHealth draws, and no healthy one", async () => {
    await seed([
      healthy("healthy-1"),
      healthy("healthy-busy-cpu", { latestCpuPercent: 100 }),
      healthy("healthy-big-load", { cpuCores: 32, latestLoadAverage15m: 30 }),
      healthy("not-reporting", {
        otelCollectorStatus: "disconnected",
        lastSeenAt: ago(180),
      }),
      healthy("never-reported", {
        otelCollectorStatus: null,
        lastSeenAt: null,
        readingsUpdatedAt: null,
        collectorInstanceUid: "abc",
        collectorRegisteredAt: ago(60),
      }),
      healthy("disk", {
        latestDiskPercent: 96.5,
        latestDiskMountpoint: "/var",
      }),
      healthy("inodes", { latestInodesPercent: 90 }),
      healthy("memory", { latestMemoryPercent: 92.25 }),
      healthy("swap", { latestSwapPercent: 85 }),
      healthy("load", { cpuCores: 2, latestLoadAverage15m: 4.5 }),
      healthy("units", {
        failedSystemdUnitCount: 2,
        failedSystemdUnits: ["a.service", "b.service"],
      }),
      healthy("config-failed", {
        collectorInstanceUid: "abc",
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
      }),
      healthy("collector-error", {
        collectorInstanceUid: "abc",
        collectorConfigStatus: HostCollectorConfigStatus.Applied,
        isCollectorHealthy: false,
      }),
    ]);

    const result: HostsThatMayNeedAttention = await found();

    expect(namesOf(result)).toEqual([
      "collector-error",
      "config-failed",
      "disk",
      "inodes",
      "load",
      "memory",
      "never-reported",
      "not-reporting",
      "swap",
      "units",
    ]);
    expect(result.isTruncated).toBe(false);

    // Every host it found needs attention by the rules the card follows.
    for (const host of result.hosts) {
      const assessment: HostHealthAssessment = assessHost(host, { now: NOW });
      expect({ name: host.name, severity: assessment.severity }).toEqual({
        name: host.name,
        severity: expect.stringMatching(NEEDS_ATTENTION_SEVERITY),
      });
    }
  });

  test("a load exactly twice the cores is not found; just above it is", async () => {
    await seed([
      healthy("at-the-line", { cpuCores: 4, latestLoadAverage15m: 8 }),
      healthy("above-the-line", { cpuCores: 4, latestLoadAverage15m: 8.01 }),
      healthy("no-cores", { cpuCores: null, latestLoadAverage15m: 50 }),
    ]);

    expect(namesOf(await found())).toEqual(["above-the-line"]);
  });

  test("the numbers come back as numbers, and the failed units as names", async () => {
    await seed([
      healthy("db-01", {
        latestDiskPercent: 96.5,
        latestDiskMountpoint: "/var",
        failedSystemdUnitCount: 1,
        failedSystemdUnits: ["postgresql.service"],
      }),
    ]);

    const [host]: Array<Host> = (await found()).hosts;

    expect(host!.latestDiskPercent).toBe(96.5);
    expect(host!.latestDiskMountpoint).toBe("/var");
    expect(host!.cpuCores).toBe(4);
    expect(host!.failedSystemdUnitCount).toBe(1);
    expect(host!.failedSystemdUnits).toEqual(["postgresql.service"]);
    expect(host!.readingsUpdatedAt).toBeInstanceOf(Date);
  });

  test("never an archived host, nor another project's", async () => {
    await seed([
      healthy("archived", {
        isArchived: true,
        otelCollectorStatus: "disconnected",
        lastSeenAt: ago(60),
      }),
      healthy("other-project", {
        projectId: OTHER_PROJECT_ID,
        latestDiskPercent: 99,
      }),
      healthy("ours", { latestDiskPercent: 99 }),
    ]);

    expect(namesOf(await found())).toEqual(["ours"]);
  });

  test("a host past several lines is returned once", async () => {
    await seed([
      healthy("everything", {
        latestDiskPercent: 99,
        latestMemoryPercent: 99,
        latestSwapPercent: 99,
        failedSystemdUnitCount: 3,
      }),
    ]);

    expect(namesOf(await found())).toEqual(["everything"]);
  });

  test("the readings ingest stores land in the columns as written", async () => {
    await seed([healthy("web-01")]);
    const [row]: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."${TABLE}" WHERE "name" = 'web-01'`,
    );

    const wrote: boolean =
      await HostService.updateColumnsByIdIfUnlockedWithoutHooks({
        id: new ObjectID(row!._id),
        data: {
          latestCpuPercent: 42.5,
          latestDiskPercent: 97.25,
          latestDiskMountpoint: `/${"m".repeat(700)}`,
          bootedAt: ago(90),
          failedSystemdUnitCount: 1,
          failedSystemdUnits: ["nginx.service"],
          readingsUpdatedAt: NOW,
        },
      });
    expect(wrote).toBe(true);

    const [stored]: Array<{
      latestCpuPercent: string;
      latestDiskPercent: string;
      latestDiskMountpoint: string;
      failedSystemdUnits: Array<string>;
      bootedAt: Date;
    }> = await database.query(
      `SELECT "latestCpuPercent", "latestDiskPercent", "latestDiskMountpoint",
              "failedSystemdUnits", "bootedAt"
       FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
      [row!._id],
    );
    expect(Number(stored!.latestCpuPercent)).toBe(42.5);
    expect(Number(stored!.latestDiskPercent)).toBe(97.25);
    // Cut to its column, never refused.
    expect(stored!.latestDiskMountpoint).toHaveLength(500);
    expect(stored!.failedSystemdUnits).toEqual(["nginx.service"]);
    expect(new Date(stored!.bootedAt).getTime()).toBe(ago(90).getTime());

    // And the read finds it, by the new disk reading.
    expect(namesOf(await found())).toEqual(["web-01"]);
  });
});
