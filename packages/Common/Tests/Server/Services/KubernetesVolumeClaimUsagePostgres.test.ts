import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import KubernetesResourceService, {
  ParsedKubernetesResource,
  ResourceLatestVolumeStats,
} from "../../../Server/Services/KubernetesResourceService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
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
 * A persistent volume claim's latest usage (#9539), written and read on
 * Postgres against the migrated "KubernetesResource" table
 * (1809184639539-AddKubernetesVolumeClaimUsage).
 *
 * Opt in as KubernetesResourceHealthPostgres does, with
 * RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true against a database the registered
 * migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true \
 *   KUBERNETES_HEALTH_TEST_DATABASE_HOST=127.0.0.1 \
 *   KUBERNETES_HEALTH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/KubernetesVolumeClaimUsagePostgres.test.ts --forceExit
 *
 * CI runs it beside that suite in .github/workflows/postgres-schema-drift.yaml.
 * Why a real Postgres: bulkUpdateLatestVolumeStats is a hand-written
 * UPDATE ... FROM (VALUES ...) whose bigint casts, COALESCE and date guard the
 * unit suite only pins as text. It works on a structure-only clone of the
 * table in a uniquely named schema, dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_KUBERNETES_HEALTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "KubernetesResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const OTHER_CLUSTER_ID: ObjectID = ObjectID.generate();
const SEEN: Date = new Date("2026-11-18T10:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

function minutesAfter(minutes: number): Date {
  return new Date(SEEN.getTime() + minutes * 60 * 1000);
}

function inventoryRow(
  kind: string,
  name: string,
  namespaceKey: string = "data",
): ParsedKubernetesResource {
  return {
    kind: kind,
    namespaceKey: namespaceKey,
    name: name,
    uid: null,
    phase: kind === "PersistentVolumeClaim" ? "Bound" : null,
    isReady: null,
    hasMemoryPressure: null,
    hasDiskPressure: null,
    hasPidPressure: null,
    labels: null,
    annotations: null,
    ownerReferences: null,
    spec: null,
    containerCount: null,
    status: null,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: SEEN,
    healthSeverity: null,
  };
}

function claimUsage(
  fields: Partial<ResourceLatestVolumeStats> = {},
): ResourceLatestVolumeStats {
  return {
    namespaceKey: "data",
    name: "data-postgres-0",
    // Past 2 GiB, as every real claim is: the bigint path, not an int's.
    capacityBytes: 50 * GIB,
    availableBytes: 14 * GIB,
    inodes: 3276800,
    inodesFree: 3200000,
    observedAt: minutesAfter(1),
    ...fields,
  };
}

interface StoredUsage {
  latestVolumeCapacityBytes: string | null;
  latestVolumeAvailableBytes: string | null;
  latestVolumeInodes: string | null;
  latestVolumeInodesFree: string | null;
  metricsUpdatedAt: Date | null;
}

describePostgres("A persistent volume claim's usage on Postgres", () => {
  const schema: string = `k8s_pvc_usage_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  async function seed(
    rows: Array<ParsedKubernetesResource>,
    clusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: clusterId,
      resources: rows,
    });
  }

  async function write(
    volumes: Array<ResourceLatestVolumeStats>,
    clusterId: ObjectID = CLUSTER_ID,
  ): Promise<void> {
    await KubernetesResourceService.bulkUpdateLatestVolumeStats({
      projectId: PROJECT_ID,
      kubernetesClusterId: clusterId,
      volumes: volumes,
    });
  }

  async function stored(
    kind: string,
    name: string,
    clusterId: ObjectID = CLUSTER_ID,
  ): Promise<StoredUsage> {
    const rows: Array<StoredUsage> = await database.query(
      `SELECT "latestVolumeCapacityBytes", "latestVolumeAvailableBytes",
              "latestVolumeInodes", "latestVolumeInodesFree", "metricsUpdatedAt"
       FROM "${schema}"."${TABLE}"
       WHERE "kubernetesClusterId" = $1 AND "kind" = $2 AND "name" = $3`,
      [clusterId.toString(), kind, name],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["KUBERNETES_HEALTH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["KUBERNETES_HEALTH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["KUBERNETES_HEALTH_TEST_DATABASE_NAME"] ||
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

  test("lands on the claim's row, bytes past 2 GiB intact, and dates it", async () => {
    await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);

    await write([claimUsage()]);

    const usage: StoredUsage = await stored(
      "PersistentVolumeClaim",
      "data-postgres-0",
    );
    expect(usage.latestVolumeCapacityBytes).toBe(String(50 * GIB));
    expect(usage.latestVolumeAvailableBytes).toBe(String(14 * GIB));
    expect(usage.latestVolumeInodes).toBe("3276800");
    expect(usage.latestVolumeInodesFree).toBe("3200000");
    expect(new Date(usage.metricsUpdatedAt as Date).toISOString()).toBe(
      minutesAfter(1).toISOString(),
    );
  });

  test("touches no pod, PersistentVolume or other cluster of the same name", async () => {
    await seed([
      inventoryRow("PersistentVolumeClaim", "data-postgres-0"),
      inventoryRow("Pod", "data-postgres-0"),
      inventoryRow("PersistentVolume", "data-postgres-0", ""),
    ]);
    await seed(
      [inventoryRow("PersistentVolumeClaim", "data-postgres-0")],
      OTHER_CLUSTER_ID,
    );

    await write([claimUsage()]);

    expect(
      (await stored("Pod", "data-postgres-0")).latestVolumeCapacityBytes,
    ).toBeNull();
    expect(
      (await stored("PersistentVolume", "data-postgres-0"))
        .latestVolumeCapacityBytes,
    ).toBeNull();
    expect(
      (
        await stored(
          "PersistentVolumeClaim",
          "data-postgres-0",
          OTHER_CLUSTER_ID,
        )
      ).latestVolumeCapacityBytes,
    ).toBeNull();
  });

  test("a claim in another namespace with the same name keeps its own reading", async () => {
    await seed([
      inventoryRow("PersistentVolumeClaim", "data-0", "billing"),
      inventoryRow("PersistentVolumeClaim", "data-0", "orders"),
    ]);

    await write([
      claimUsage({
        namespaceKey: "billing",
        name: "data-0",
        availableBytes: 1,
      }),
      claimUsage({ namespaceKey: "orders", name: "data-0", availableBytes: 2 }),
    ]);

    const rows: Array<{
      namespaceKey: string;
      latestVolumeAvailableBytes: string;
    }> = await database.query(
      `SELECT "namespaceKey", "latestVolumeAvailableBytes" FROM "${schema}"."${TABLE}"
       WHERE "kind" = 'PersistentVolumeClaim' ORDER BY "namespaceKey"`,
    );
    expect(rows).toEqual([
      { namespaceKey: "billing", latestVolumeAvailableBytes: "1" },
      { namespaceKey: "orders", latestVolumeAvailableBytes: "2" },
    ]);
  });

  test("a later batch without a reading keeps the stored one", async () => {
    await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);
    await write([claimUsage()]);

    await write([
      claimUsage({
        capacityBytes: null,
        availableBytes: 12 * GIB,
        inodes: null,
        inodesFree: null,
        observedAt: minutesAfter(2),
      }),
    ]);

    const usage: StoredUsage = await stored(
      "PersistentVolumeClaim",
      "data-postgres-0",
    );
    expect(usage.latestVolumeCapacityBytes).toBe(String(50 * GIB));
    expect(usage.latestVolumeAvailableBytes).toBe(String(12 * GIB));
    expect(usage.latestVolumeInodes).toBe("3276800");
  });

  test("an older point never overwrites a newer one", async () => {
    await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);
    await write([
      claimUsage({ availableBytes: 3 * GIB, observedAt: minutesAfter(5) }),
    ]);

    await write([
      claimUsage({ availableBytes: 30 * GIB, observedAt: minutesAfter(4) }),
    ]);

    expect(
      (await stored("PersistentVolumeClaim", "data-postgres-0"))
        .latestVolumeAvailableBytes,
    ).toBe(String(3 * GIB));
  });

  test("a claim the inventory has no row for yet is skipped, not created", async () => {
    await write([claimUsage({ name: "not-yet-inventoried" })]);

    const rows: Array<unknown> = await database.query(
      `SELECT 1 FROM "${schema}"."${TABLE}"`,
    );
    expect(rows).toHaveLength(0);
  });

  test("the next snapshot of the claim keeps its usage", async () => {
    await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);
    await write([claimUsage()]);

    const later: ParsedKubernetesResource = inventoryRow(
      "PersistentVolumeClaim",
      "data-postgres-0",
    );
    later.lastSeenAt = minutesAfter(5);
    await seed([later]);

    expect(
      (await stored("PersistentVolumeClaim", "data-postgres-0"))
        .latestVolumeCapacityBytes,
    ).toBe(String(50 * GIB));
  });
});
