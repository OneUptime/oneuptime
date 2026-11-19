import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import KubernetesResourceService, {
  KubernetesNeedsAttention,
  ParsedKubernetesResource,
  ResourceLatestNodeFilesystem,
  ResourceLatestVolumeStats,
} from "../../../Server/Services/KubernetesResourceService";
import logger from "../../../Server/Utils/Logger";
import { KubernetesAttentionFinding } from "../../../Types/Kubernetes/KubernetesHealth";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * A nearly full claim and a node nearly out of disk under the cluster's
 * Needs attention (#9643, #9645), on Postgres, against the migrated
 * "KubernetesResource" table (1809186000000-AddKubernetesDiskReadings): the
 * metrics path writes a claim's or a node's disk and its verdict at once,
 * the next snapshot keeps that verdict, a reading gone stale or a claim made
 * again under the same name clears it, a claim's fill baseline moves as it
 * should, and the Overview's read - through the partial index of what
 * needs attention - lists them with the pod that mounts a claim.
 *
 * Opt in as KubernetesResourceHealthPostgres does, with
 * RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true against a database the
 * registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true \
 *   KUBERNETES_HEALTH_TEST_DATABASE_HOST=127.0.0.1 \
 *   KUBERNETES_HEALTH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/KubernetesDiskVerdictsPostgres.test.ts --forceExit
 *
 * CI runs it beside that suite in .github/workflows/postgres-schema-drift.yaml.
 * It works on a structure-only clone of the table, its indexes included, in
 * a uniquely named schema, dropped afterwards.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_KUBERNETES_HEALTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "KubernetesResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const SEEN: Date = new Date("2026-11-19T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function minutesAfter(minutes: number): Date {
  return new Date(SEEN.getTime() + minutes * MINUTE);
}

function inventoryRow(
  kind: string,
  name: string,
  fields: Partial<ParsedKubernetesResource> = {},
): ParsedKubernetesResource {
  return {
    kind: kind,
    namespaceKey: kind === "Node" ? "" : "db",
    name: name,
    uid: `${kind}-${name}-uid`,
    phase: kind === "PersistentVolumeClaim" ? "Bound" : null,
    isReady: kind === "Node" ? true : null,
    hasMemoryPressure: kind === "Node" ? false : null,
    hasDiskPressure: kind === "Node" ? false : null,
    hasPidPressure: kind === "Node" ? false : null,
    labels: null,
    annotations: null,
    ownerReferences: null,
    spec:
      kind === "PersistentVolumeClaim"
        ? ({ volumeMode: "Filesystem" } as JSONObject)
        : kind === "Node"
          ? ({ unschedulable: false } as JSONObject)
          : null,
    containerCount: null,
    status:
      kind === "PersistentVolumeClaim"
        ? ({ phase: "Bound" } as JSONObject)
        : kind === "Node"
          ? ({
              conditions: [{ type: "Ready", status: "True" }],
            } as unknown as JSONObject)
          : null,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: SEEN,
    healthSeverity: null,
    ...fields,
  };
}

// A claim of 100 GiB, `usedPercent` used, reported at `minutes` after SEEN.
function claimReading(
  usedPercent: number,
  minutes: number,
  fields: Partial<ResourceLatestVolumeStats> = {},
): ResourceLatestVolumeStats {
  return {
    namespaceKey: "db",
    name: "data-postgres-0",
    capacityBytes: 100 * GIB,
    availableBytes: Math.round(100 * GIB * (1 - usedPercent / 100)),
    inodes: null,
    inodesFree: null,
    observedAt: minutesAfter(minutes),
    ...fields,
  };
}

function nodeReading(
  usedPercent: number,
  minutes: number,
  fields: Partial<ResourceLatestNodeFilesystem> = {},
): ResourceLatestNodeFilesystem {
  return {
    name: "node-1",
    capacityBytes: 100 * GIB,
    availableBytes: Math.round(100 * GIB * (1 - usedPercent / 100)),
    imageFs: { state: "unknown" },
    observedAt: minutesAfter(minutes),
    ...fields,
  };
}

interface StoredDisk {
  healthSeverity: string | null;
  latestVolumeCapacityBytes: string | null;
  latestVolumeAvailableBytes: string | null;
  latestVolumeMeasuredAt: Date | null;
  latestVolumeUsedBaselineBytes: string | null;
  latestVolumeUsedBaselineAt: Date | null;
  latestImageFsCapacityBytes: string | null;
  latestImageFsAvailableBytes: string | null;
  metricsUpdatedAt: Date | null;
}

describePostgres(
  "A Kubernetes claim's and node's disk verdict on Postgres",
  () => {
    const schema: string = `k8s_disk_${ObjectID.generate().toString().replace(/-/g, "")}`;
    let database: DataSource;

    async function seed(rows: Array<ParsedKubernetesResource>): Promise<void> {
      await KubernetesResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        resources: rows,
      });
    }

    async function writeClaims(
      volumes: Array<ResourceLatestVolumeStats>,
    ): Promise<void> {
      await KubernetesResourceService.bulkUpdateLatestVolumeStats({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        volumes: volumes,
      });
    }

    async function writeNodes(
      nodes: Array<ResourceLatestNodeFilesystem>,
    ): Promise<void> {
      await KubernetesResourceService.bulkUpdateLatestNodeFilesystems({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        nodes: nodes,
      });
    }

    async function stored(kind: string, name: string): Promise<StoredDisk> {
      const rows: Array<StoredDisk> = await database.query(
        `SELECT "healthSeverity", "latestVolumeCapacityBytes", "latestVolumeAvailableBytes",
              "latestVolumeMeasuredAt", "latestVolumeUsedBaselineBytes", "latestVolumeUsedBaselineAt",
              "latestImageFsCapacityBytes", "latestImageFsAvailableBytes", "metricsUpdatedAt"
       FROM "${schema}"."${TABLE}"
       WHERE "kubernetesClusterId" = $1 AND "kind" = $2 AND "name" = $3`,
        [CLUSTER_ID.toString(), kind, name],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    async function needsAttention(): Promise<KubernetesNeedsAttention> {
      return KubernetesResourceService.getNeedsAttention({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["KUBERNETES_HEALTH_TEST_DATABASE_HOST"] || "localhost",
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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
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

    test("a claim's reading flags it at 80% and 90%, and clears it with room again", async () => {
      await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);

      await writeClaims([claimReading(70, 1)]);
      expect(
        (await stored("PersistentVolumeClaim", "data-postgres-0"))
          .healthSeverity,
      ).toBeNull();

      await writeClaims([claimReading(85, 2)]);
      expect(
        (await stored("PersistentVolumeClaim", "data-postgres-0"))
          .healthSeverity,
      ).toBe("warning");

      await writeClaims([claimReading(93, 3)]);
      const flagged: StoredDisk = await stored(
        "PersistentVolumeClaim",
        "data-postgres-0",
      );
      expect(flagged.healthSeverity).toBe("critical");
      expect(new Date(flagged.latestVolumeMeasuredAt!).toISOString()).toBe(
        minutesAfter(3).toISOString(),
      );

      await writeClaims([claimReading(40, 4)]);
      expect(
        (await stored("PersistentVolumeClaim", "data-postgres-0"))
          .healthSeverity,
      ).toBeNull();
    });

    test("Needs attention lists the claim, why, and the pod that mounts it, through the partial index", async () => {
      await seed([
        inventoryRow("PersistentVolumeClaim", "data-postgres-0"),
        inventoryRow("PersistentVolumeClaim", "roomy"),
        inventoryRow("Pod", "postgres-0", {
          phase: "Running",
          spec: {
            nodeName: "node-1",
            containers: [],
            volumes: [
              {
                name: "data",
                type: "persistentVolumeClaim",
                source: "data-postgres-0",
              },
            ],
          } as unknown as JSONObject,
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
            containerStatuses: [],
            initContainerStatuses: [],
          } as unknown as JSONObject,
        }),
      ]);
      await writeClaims([
        claimReading(96, 1),
        claimReading(30, 1, { name: "roomy" }),
      ]);

      const result: KubernetesNeedsAttention = await needsAttention();

      expect(
        result.findings.map((finding: KubernetesAttentionFinding) => {
          return finding.key;
        }),
      ).toEqual(["PersistentVolumeClaim:db/data-postgres-0"]);
      expect(result.findings[0]).toMatchObject({
        severity: "critical",
        pod: "postgres-0",
        reasons: [
          {
            text: "{{percent}} used, {{free}} free",
            values: { percent: "96%", free: "4\u00A0GiB" },
          },
        ],
      });
    });

    test("the next snapshot keeps a fresh verdict, and clears one gone stale", async () => {
      await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);
      await writeClaims([claimReading(91, 1)]);

      // Four minutes on: the reading still says how full it is.
      await seed([
        inventoryRow("PersistentVolumeClaim", "data-postgres-0", {
          lastSeenAt: minutesAfter(5),
        }),
      ]);
      expect(
        (await stored("PersistentVolumeClaim", "data-postgres-0"))
          .healthSeverity,
      ).toBe("critical");

      // Twenty minutes on, no pod has reported it since: nothing writes to it.
      await seed([
        inventoryRow("PersistentVolumeClaim", "data-postgres-0", {
          lastSeenAt: minutesAfter(21),
        }),
      ]);
      const stale: StoredDisk = await stored(
        "PersistentVolumeClaim",
        "data-postgres-0",
      );
      expect(stale.healthSeverity).toBeNull();
      // Its last reading stays, for the claims list to show with its age.
      expect(stale.latestVolumeCapacityBytes).toBe(String(100 * GIB));
    });

    test("a claim made again under the same name starts with no reading and no verdict", async () => {
      await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);
      await writeClaims([claimReading(97, 1)]);

      await seed([
        inventoryRow("PersistentVolumeClaim", "data-postgres-0", {
          uid: "a-new-claim",
          lastSeenAt: minutesAfter(2),
        }),
      ]);

      const fresh: StoredDisk = await stored(
        "PersistentVolumeClaim",
        "data-postgres-0",
      );
      expect(fresh.healthSeverity).toBeNull();
      expect(fresh.latestVolumeCapacityBytes).toBeNull();
      expect(fresh.latestVolumeAvailableBytes).toBeNull();
      expect(fresh.latestVolumeMeasuredAt).toBeNull();
      expect(fresh.latestVolumeUsedBaselineBytes).toBeNull();
    });

    test("a claim's fill baseline starts with its first reading, holds, then moves halfway along the line", async () => {
      await seed([inventoryRow("PersistentVolumeClaim", "data-postgres-0")]);

      await writeClaims([claimReading(50, 0)]);
      let disk: StoredDisk = await stored(
        "PersistentVolumeClaim",
        "data-postgres-0",
      );
      expect(disk.latestVolumeUsedBaselineBytes).toBe(String(50 * GIB));
      expect(new Date(disk.latestVolumeUsedBaselineAt!).toISOString()).toBe(
        minutesAfter(0).toISOString(),
      );

      // Two hours on: the baseline stays, so the rate spans two hours.
      await writeClaims([claimReading(60, 120)]);
      disk = await stored("PersistentVolumeClaim", "data-postgres-0");
      expect(disk.latestVolumeUsedBaselineBytes).toBe(String(50 * GIB));

      // Past six hours: halfway to this reading, in bytes and in time.
      await writeClaims([claimReading(70, 7 * 60)]);
      disk = await stored("PersistentVolumeClaim", "data-postgres-0");
      expect(Number(disk.latestVolumeUsedBaselineBytes)).toBe(60 * GIB);
      expect(new Date(disk.latestVolumeUsedBaselineAt!).toISOString()).toBe(
        new Date(SEEN.getTime() + 3.5 * HOUR).toISOString(),
      );
    });

    test("a node's disk flags it, and leaves its CPU's metricsUpdatedAt alone", async () => {
      await seed([inventoryRow("Node", "node-1")]);
      await KubernetesResourceService.bulkUpdateLatestMetrics({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
        metrics: [
          {
            kind: "Node",
            namespaceKey: "",
            name: "node-1",
            cpuPercent: 12,
            memoryBytes: GIB,
            memoryPercent: 10,
            observedAt: minutesAfter(1),
          },
        ],
      });

      await writeNodes([nodeReading(92, 2)]);

      const disk: StoredDisk = await stored("Node", "node-1");
      expect(disk.healthSeverity).toBe("critical");
      expect(disk.latestVolumeCapacityBytes).toBe(String(100 * GIB));
      expect(new Date(disk.metricsUpdatedAt!).toISOString()).toBe(
        minutesAfter(1).toISOString(),
      );

      const result: KubernetesNeedsAttention = await needsAttention();
      expect(result.findings[0]).toMatchObject({
        key: "Node:node-1",
        severity: "critical",
      });
    });

    test("an older node reading never overwrites a newer one", async () => {
      await seed([inventoryRow("Node", "node-1")]);
      await writeNodes([nodeReading(50, 5)]);
      await writeNodes([nodeReading(95, 4)]);

      const disk: StoredDisk = await stored("Node", "node-1");
      expect(disk.latestVolumeAvailableBytes).toBe(String(50 * GIB));
      expect(disk.healthSeverity).toBeNull();
    });

    test("a node's image disk of its own is stored, kept when a batch cannot tell, and cleared when it is the root disk", async () => {
      await seed([inventoryRow("Node", "node-1")]);

      await writeNodes([
        nodeReading(40, 1, {
          imageFs: {
            state: "separate",
            capacityBytes: 500 * GIB,
            availableBytes: 25 * GIB,
          },
        }),
      ]);
      let disk: StoredDisk = await stored("Node", "node-1");
      expect(disk.latestImageFsCapacityBytes).toBe(String(500 * GIB));
      expect(disk.latestImageFsAvailableBytes).toBe(String(25 * GIB));
      // 95% of the image disk used: critical, though the root disk has room.
      expect(disk.healthSeverity).toBe("critical");

      await writeNodes([nodeReading(40, 2)]);
      disk = await stored("Node", "node-1");
      expect(disk.latestImageFsCapacityBytes).toBe(String(500 * GIB));

      await writeNodes([nodeReading(40, 3, { imageFs: { state: "same" } })]);
      disk = await stored("Node", "node-1");
      expect(disk.latestImageFsCapacityBytes).toBeNull();
      expect(disk.latestImageFsAvailableBytes).toBeNull();
      expect(disk.healthSeverity).toBeNull();
    });

    test("a node's snapshot keeps its disk verdict and its own pressure's", async () => {
      await seed([inventoryRow("Node", "node-1")]);
      await writeNodes([nodeReading(85, 1)]);

      await seed([
        inventoryRow("Node", "node-1", {
          lastSeenAt: minutesAfter(3),
          hasDiskPressure: true,
          healthSeverity: null,
        }),
      ]);

      expect((await stored("Node", "node-1")).healthSeverity).toBe("warning");
    });

    test("the claims pods own: what ingest names an ephemeral volume's claim by", async () => {
      await seed([
        inventoryRow("PersistentVolumeClaim", "web-0-scratch", {
          ownerReferences: {
            items: [{ kind: "Pod", name: "web-0", uid: "pod-uid" }],
          } as unknown as JSONObject,
        }),
        inventoryRow("PersistentVolumeClaim", "data-postgres-0", {
          ownerReferences: {
            items: [{ kind: "StatefulSet", name: "postgres", uid: "sts" }],
          } as unknown as JSONObject,
        }),
        inventoryRow("PersistentVolumeClaim", "plain"),
      ]);

      expect(
        await KubernetesResourceService.getPodOwnedVolumeClaims({
          projectId: PROJECT_ID,
          kubernetesClusterId: CLUSTER_ID,
        }),
      ).toEqual([{ namespace: "db", name: "web-0-scratch", podName: "web-0" }]);
    });
  },
);
