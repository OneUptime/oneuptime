import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CephResourceService from "../../../Server/Services/CephResourceService";
import DockerSwarmResourceService from "../../../Server/Services/DockerSwarmResourceService";
import IoTDeviceService, {
  IoTDeviceLatestMetric,
  ParsedIoTDevice,
} from "../../../Server/Services/IoTDeviceService";
import KubernetesContainerService from "../../../Server/Services/KubernetesContainerService";
import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import ProxmoxResourceService from "../../../Server/Services/ProxmoxResourceService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The latest-metric mirror writes EXECUTED on Postgres, against the
 * migrated table structures.
 *
 * IoTDeviceService.bulkUpdateLatestMetrics shipped with 9 placeholders per
 * VALUES tuple against 10 aliases and 10 params. Postgres rejected every
 * call ("table "v" has 9 columns available but 10 columns specified"), the
 * ingest flush swallowed it at warn, and battery / signal / temperature /
 * CPU / memory never reached the IoTDevice row (GitHub #3998). The unit
 * suites fake `manager.query`, so only a real driver shows it. The sibling
 * inventory services build the same kind of statement, so each is
 * executed here too.
 *
 * Opt in with RUN_POSTGRES_LATEST_METRICS_TESTS=true against a Postgres
 * migrated to the current head — the Postgres Schema Drift workflow's
 * database right after its drift check. Each table's STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema) that is
 * dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from LATEST_METRICS_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from LATEST_METRICS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LATEST_METRICS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "IoTDevice",
  "ProxmoxResource",
  "CephResource",
  "VMwareResource",
  "DockerSwarmResource",
  "KubernetesResource",
  "KubernetesContainer",
];

// Columns a fixture row must fill; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
  "kind",
  "externalId",
  "lastSeenAt",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET_ID: ObjectID = ObjectID.generate();
const T0: Date = new Date("2026-09-23T11:40:00.000Z");
const T1: Date = new Date("2026-09-23T11:45:00.000Z");
const T2: Date = new Date("2026-09-23T11:50:00.000Z");

interface IoTRow {
  kind: string;
  externalId: string;
  latestCpuPercent: string | null;
  latestMemoryBytes: string | null;
  maxMemoryBytes: string | null;
  latestMemoryPercent: string | null;
  latestBatteryPercent: string | null;
  latestSignalStrengthDbm: string | null;
  latestTemperatureCelsius: string | null;
  metricsUpdatedAt: Date | null;
}

function device(overrides: Partial<ParsedIoTDevice> = {}): ParsedIoTDevice {
  return {
    kind: "Sensor",
    externalId: "greenhouse-1",
    name: "Greenhouse 1",
    deviceType: "environment",
    firmwareVersion: "2.4.1",
    isUp: true,
    uptimeSeconds: 7200,
    lastSeenAt: T1,
    ...overrides,
  };
}

function metric(
  overrides: Partial<IoTDeviceLatestMetric> = {},
): IoTDeviceLatestMetric {
  return {
    kind: "Sensor",
    externalId: "greenhouse-1",
    cpuPercent: 12.5,
    memoryBytes: 1048576,
    maxMemoryBytes: 4194304,
    memoryPercent: 25,
    batteryPercent: 87.5,
    signalStrengthDbm: -61.5,
    temperatureCelsius: 21.43,
    observedAt: T1,
    ...overrides,
  };
}

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}

describePostgres("latest-metric mirror writes against Postgres", () => {
  const schema: string = `latest_metrics_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["LATEST_METRICS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["LATEST_METRICS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["LATEST_METRICS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );
      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
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
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function readDevices(
    where: string = "TRUE",
    params: Array<unknown> = [],
  ): Promise<Array<IoTRow>> {
    return database.query(
      `SELECT "kind", "externalId", "latestCpuPercent", "latestMemoryBytes", "maxMemoryBytes",
              "latestMemoryPercent", "latestBatteryPercent", "latestSignalStrengthDbm",
              "latestTemperatureCelsius", "metricsUpdatedAt"
       FROM "${schema}"."IoTDevice" WHERE ${where} ORDER BY "externalId"`,
      params,
    );
  }

  async function readDevice(externalId: string): Promise<IoTRow> {
    const rows: Array<IoTRow> = await readDevices(`"externalId" = $1`, [
      externalId,
    ]);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function upsert(
    devices: Array<ParsedIoTDevice>,
    projectId: ObjectID = PROJECT_ID,
    iotFleetId: ObjectID = FLEET_ID,
  ): Promise<void> {
    await IoTDeviceService.bulkUpsert({ projectId, iotFleetId, devices });
  }

  async function mirror(
    metrics: Array<IoTDeviceLatestMetric>,
    projectId: ObjectID = PROJECT_ID,
    iotFleetId: ObjectID = FLEET_ID,
  ): Promise<void> {
    await IoTDeviceService.bulkUpdateLatestMetrics({
      projectId,
      iotFleetId,
      metrics,
    });
  }

  describe("IoTDeviceService.bulkUpdateLatestMetrics", () => {
    test("fills every latest-metric column of the row the upsert wrote", async () => {
      await upsert([device()]);
      await mirror([metric()]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(numeric(row.latestCpuPercent)).toBe(12.5);
      expect(numeric(row.latestMemoryBytes)).toBe(1048576);
      expect(numeric(row.maxMemoryBytes)).toBe(4194304);
      expect(numeric(row.latestMemoryPercent)).toBe(25);
      expect(numeric(row.latestBatteryPercent)).toBe(87.5);
      expect(numeric(row.latestSignalStrengthDbm)).toBe(-61.5);
      expect(numeric(row.latestTemperatureCelsius)).toBe(21.43);
      expect(row.metricsUpdatedAt?.getTime()).toBe(T1.getTime());
    });

    test("several devices in one statement each land on their own row", async () => {
      const ids: Array<string> = ["dev-a", "dev-b", "dev-c", "dev-d"];
      await upsert(
        ids.map((externalId: string) => {
          return device({ externalId });
        }),
      );
      await mirror(
        ids.map((externalId: string, i: number) => {
          return metric({
            externalId,
            cpuPercent: 10 + i,
            memoryBytes: 1000 + i,
            maxMemoryBytes: 2000 + i,
            memoryPercent: 20 + i,
            batteryPercent: 50 + i,
            signalStrengthDbm: -70 + i,
            temperatureCelsius: 15 + i,
          });
        }),
      );

      const rows: Array<IoTRow> = await readDevices();
      expect(rows).toHaveLength(ids.length);
      rows.forEach((row: IoTRow, i: number) => {
        expect(row.externalId).toBe(ids[i]);
        expect(numeric(row.latestCpuPercent)).toBe(10 + i);
        expect(numeric(row.latestMemoryBytes)).toBe(1000 + i);
        expect(numeric(row.maxMemoryBytes)).toBe(2000 + i);
        expect(numeric(row.latestMemoryPercent)).toBe(20 + i);
        expect(numeric(row.latestBatteryPercent)).toBe(50 + i);
        expect(numeric(row.latestSignalStrengthDbm)).toBe(-70 + i);
        expect(numeric(row.latestTemperatureCelsius)).toBe(15 + i);
      });
    });

    test("a sensor that reports only some series leaves the others null", async () => {
      await upsert([device()]);
      await mirror([
        metric({
          cpuPercent: null,
          memoryBytes: null,
          maxMemoryBytes: null,
          memoryPercent: null,
          signalStrengthDbm: null,
        }),
      ]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(numeric(row.latestBatteryPercent)).toBe(87.5);
      expect(numeric(row.latestTemperatureCelsius)).toBe(21.43);
      expect(row.latestCpuPercent).toBeNull();
      expect(row.latestMemoryBytes).toBeNull();
      expect(row.maxMemoryBytes).toBeNull();
      expect(row.latestMemoryPercent).toBeNull();
      expect(row.latestSignalStrengthDbm).toBeNull();
      expect(row.metricsUpdatedAt?.getTime()).toBe(T1.getTime());
    });

    test("a later batch missing a series keeps that series' last-known reading", async () => {
      await upsert([device()]);
      await mirror([metric()]);
      await mirror([
        metric({
          observedAt: T2,
          batteryPercent: null,
          signalStrengthDbm: null,
          temperatureCelsius: 19,
        }),
      ]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(numeric(row.latestBatteryPercent)).toBe(87.5);
      expect(numeric(row.latestSignalStrengthDbm)).toBe(-61.5);
      expect(numeric(row.latestTemperatureCelsius)).toBe(19);
      expect(row.metricsUpdatedAt?.getTime()).toBe(T2.getTime());
    });

    test("an older observation never overwrites a newer one", async () => {
      await upsert([device()]);
      await mirror([metric({ observedAt: T2, batteryPercent: 40 })]);
      await mirror([metric({ observedAt: T0, batteryPercent: 99 })]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(numeric(row.latestBatteryPercent)).toBe(40);
      expect(row.metricsUpdatedAt?.getTime()).toBe(T2.getTime());
    });

    test("a repeat of the same observation time still applies", async () => {
      await upsert([device()]);
      await mirror([metric({ batteryPercent: 40 })]);
      await mirror([metric({ batteryPercent: 41 })]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(numeric(row.latestBatteryPercent)).toBe(41);
    });

    test("memory beyond 32 bits round-trips through the bigint columns", async () => {
      const eightGiB: number = 8 * 1024 * 1024 * 1024;
      await upsert([device()]);
      await mirror([
        metric({ memoryBytes: eightGiB + 0.9, maxMemoryBytes: 2 * eightGiB }),
      ]);

      const row: IoTRow = await readDevice("greenhouse-1");
      expect(row.latestMemoryBytes).toBe(String(eightGiB));
      expect(row.maxMemoryBytes).toBe(String(2 * eightGiB));
    });

    test("only the fleet, project and kind named are touched", async () => {
      const otherFleet: ObjectID = ObjectID.generate();
      const otherProject: ObjectID = ObjectID.generate();
      await upsert([device(), device({ kind: "Gateway" })]);
      await upsert([device()], PROJECT_ID, otherFleet);
      await upsert([device()], otherProject, FLEET_ID);

      await mirror([metric()]);

      const rows: Array<IoTRow> = await database.query(
        `SELECT "projectId", "iotFleetId", "kind", "latestBatteryPercent"
         FROM "${schema}"."IoTDevice"`,
      );
      expect(rows).toHaveLength(4);
      const updated: Array<IoTRow> = rows.filter((row: IoTRow) => {
        return row.latestBatteryPercent !== null;
      });
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        projectId: PROJECT_ID.toString(),
        iotFleetId: FLEET_ID.toString(),
        kind: "Sensor",
      });
    });

    test("a device with no inventory row is skipped, not inserted", async () => {
      await mirror([metric({ externalId: "never-upserted" })]);

      expect(await readDevices()).toHaveLength(0);
    });

    test("an over-long device id reaches the row the upsert truncated it to", async () => {
      const longId: string = "d".repeat(150);
      await upsert([device({ externalId: longId })]);
      await mirror([metric({ externalId: longId })]);

      const row: IoTRow = await readDevice("d".repeat(100));
      expect(numeric(row.latestBatteryPercent)).toBe(87.5);
    });

    test("a flush larger than one 500-row chunk updates every device", async () => {
      const count: number = 501;
      const ids: Array<string> = Array.from(
        { length: count },
        (_: unknown, i: number) => {
          return `bulk-${String(i).padStart(4, "0")}`;
        },
      );
      await upsert(
        ids.map((externalId: string) => {
          return device({ externalId });
        }),
      );
      await mirror(
        ids.map((externalId: string, i: number) => {
          return metric({ externalId, batteryPercent: i % 100 });
        }),
      );

      const rows: Array<IoTRow> = await readDevices();
      expect(rows).toHaveLength(count);
      rows.forEach((row: IoTRow, i: number) => {
        expect(numeric(row.latestBatteryPercent)).toBe(i % 100);
        expect(row.metricsUpdatedAt?.getTime()).toBe(T1.getTime());
      });
    });
  });

  /*
   * The sibling services build the same UPDATE ... FROM (VALUES ...) by
   * hand. Each is executed once against its migrated table: the matching
   * row takes the metric, a row under another identity does not.
   */
  describe("sibling inventory services' mirror writes", () => {
    async function insertRow(
      table: string,
      columns: Record<string, unknown>,
    ): Promise<void> {
      const all: Record<string, unknown> = {
        version: 0,
        projectId: PROJECT_ID.toString(),
        lastSeenAt: T0,
        ...columns,
      };
      const names: Array<string> = Object.keys(all);
      await database.query(
        `INSERT INTO "${schema}"."${table}" (${names
          .map((name: string) => {
            return `"${name}"`;
          })
          .join(", ")}) VALUES (${names
          .map((_: string, i: number) => {
            return `$${i + 1}`;
          })
          .join(", ")})`,
        Object.values(all),
      );
    }

    async function readMirror(
      table: string,
      column: string,
    ): Promise<Array<{ value: string | null; metricsUpdatedAt: Date | null }>> {
      return database.query(
        `SELECT "${column}"::text AS value, "metricsUpdatedAt" FROM "${schema}"."${table}" ORDER BY "_id"`,
      );
    }

    test("ProxmoxResourceService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("ProxmoxResource", {
        proxmoxClusterId: parent.toString(),
        kind: "VM",
        externalId: "qemu/100",
        name: "vm-100",
      });
      await ProxmoxResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        proxmoxClusterId: parent,
        metrics: [
          {
            kind: "VM",
            externalId: "qemu/100",
            cpuPercent: 12.5,
            memoryBytes: 1024,
            maxMemoryBytes: 4096,
            memoryPercent: 25,
            diskBytes: 2048,
            maxDiskBytes: 8192,
            observedAt: T1,
          },
          {
            kind: "VM",
            externalId: "qemu/999",
            cpuPercent: 99,
            memoryBytes: null,
            maxMemoryBytes: null,
            memoryPercent: null,
            diskBytes: null,
            maxDiskBytes: null,
            observedAt: T1,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("ProxmoxResource", "latestDiskBytes");
      expect(rows).toEqual([{ value: "2048", metricsUpdatedAt: T1 }]);
    });

    test("CephResourceService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("CephResource", {
        cephClusterId: parent.toString(),
        kind: "OSD",
        externalId: "osd.0",
        name: "osd.0",
      });
      await CephResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        cephClusterId: parent,
        metrics: [
          {
            kind: "OSD",
            externalId: "osd.0",
            statBytes: 1000,
            statBytesUsed: 500,
            applyLatencyMs: 1.5,
            commitLatencyMs: 2.5,
            pgCount: 32,
            storedBytes: 400,
            maxAvailBytes: 600,
            objects: 70,
            readOpsCounter: 800,
            writeOpsCounter: 900,
            observedAt: T1,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("CephResource", "writeOpsCounter");
      expect(rows).toEqual([{ value: "900", metricsUpdatedAt: T1 }]);
    });

    test("VMwareResourceService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("VMwareResource", {
        vmwareVCenterId: parent.toString(),
        kind: "VirtualMachine",
        externalId: "vm-42",
        name: "vm-42",
      });
      await VMwareResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        vmwareVCenterId: parent,
        metrics: [
          {
            kind: "VirtualMachine",
            externalId: "vm-42",
            cpuPercent: 10,
            cpuMhz: 100,
            cpuCapacityMhz: 200,
            cpuEffectiveMhz: 150,
            memoryBytes: 1000,
            maxMemoryBytes: 2000,
            memoryEffectiveBytes: 1500,
            memoryPercent: 50,
            diskBytes: 3000,
            maxDiskBytes: 4000,
            diskPercent: 75,
            cpuReadinessPercent: 1,
            memoryBalloonedBytes: 10,
            memorySwappedBytes: 20,
            hostCount: 1,
            effectiveHostCount: 1,
            poweredOnHostCount: 1,
            vmCount: 5,
            poweredOnVmCount: 4,
            vmTemplateCount: 1,
            datastoreCount: 2,
            clusterCount: 3,
            observedAt: T1,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("VMwareResource", "clusterCount");
      expect(rows).toEqual([{ value: "3", metricsUpdatedAt: T1 }]);
    });

    test("DockerSwarmResourceService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("DockerSwarmResource", {
        dockerSwarmClusterId: parent.toString(),
        kind: "Service",
        externalId: "svc-1",
        name: "web",
      });
      await DockerSwarmResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        dockerSwarmClusterId: parent,
        metrics: [
          {
            kind: "Service",
            externalId: "svc-1",
            cpuPercent: 10,
            memoryBytes: 1000,
            maxMemoryBytes: 2000,
            memoryPercent: 50,
            observedAt: T1,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("DockerSwarmResource", "latestMemoryPercent");
      expect(rows).toEqual([{ value: "50", metricsUpdatedAt: T1 }]);
    });

    test("KubernetesResourceService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("KubernetesResource", {
        kubernetesClusterId: parent.toString(),
        kind: "Pod",
        namespaceKey: "default",
        name: "web-7f9",
      });
      await KubernetesResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        kubernetesClusterId: parent,
        metrics: [
          {
            kind: "Pod",
            namespaceKey: "default",
            name: "web-7f9",
            cpuPercent: 10,
            memoryBytes: 1000,
            memoryPercent: 50,
            observedAt: T1,
            controllerDeploymentName: "web",
            controllerCronJobName: null,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("KubernetesResource", "controllerDeploymentName");
      expect(rows).toEqual([{ value: "web", metricsUpdatedAt: T1 }]);
    });

    test("KubernetesContainerService", async () => {
      const parent: ObjectID = ObjectID.generate();
      await insertRow("KubernetesContainer", {
        kubernetesClusterId: parent.toString(),
        podNamespaceKey: "default",
        podName: "web-7f9",
        name: "app",
      });
      await KubernetesContainerService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        kubernetesClusterId: parent,
        metrics: [
          {
            podNamespaceKey: "default",
            podName: "web-7f9",
            name: "app",
            cpuPercent: 10,
            memoryBytes: 1000,
            observedAt: T1,
          },
        ],
      });

      const rows: Array<{
        value: string | null;
        metricsUpdatedAt: Date | null;
      }> = await readMirror("KubernetesContainer", "latestMemoryBytes");
      expect(rows).toEqual([{ value: "1000", metricsUpdatedAt: T1 }]);
    });
  });
});
