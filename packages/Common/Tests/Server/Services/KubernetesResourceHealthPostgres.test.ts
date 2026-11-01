import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import KubernetesResourceService, {
  KubernetesNeedsAttention,
  KubernetesPart,
  KubernetesPartRow,
} from "../../../Server/Services/KubernetesResourceService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  ParsedKubernetesResource,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesHealthSeverity,
  getKubernetesHealthSeverity,
} from "../../../Types/Kubernetes/KubernetesHealth";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The Kubernetes inventory's health verdicts and the reads built on them,
 * executed on Postgres against the migrated "KubernetesResource" table.
 *
 * Opt in with RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true against a database
 * the registered migrations (1808800000000-AddKubernetesResourceHealthSeverity
 * and its online index included) have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_KUBERNETES_HEALTH_TESTS=true \
 *   KUBERNETES_HEALTH_TEST_DATABASE_HOST=127.0.0.1 \
 *   KUBERNETES_HEALTH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/KubernetesResourceHealthPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it. CI runs it in
 * .github/workflows/postgres-schema-drift.yaml, right after that job has
 * applied every registered migration to an empty database.
 *
 * Why a real Postgres: the reads are hand-written SQL that the unit suite
 * (KubernetesResourceServiceNeedsAttention) only pins as text - a partial
 * index predicate, JavaScript arrays bound to `= ANY($n)`, JSON path
 * queries with `starts with` and containment on owner references, and a
 * node's name read out of a pod's spec. Here Postgres runs them.
 *
 * It works on a structure-only clone (LIKE ... INCLUDING ALL, so the unique
 * index ON CONFLICT names and the partial index come along) of
 * "KubernetesResource" in a uniquely named schema that is the connection's
 * first search_path entry and is dropped afterwards. Every row is
 * synthetic; the production service runs unchanged against the clone.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_KUBERNETES_HEALTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "KubernetesResource";
const PARTIAL_INDEX: string = "IDX_f66e3c6498c4e546755c7cc6ed";

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const OTHER_CLUSTER_ID: ObjectID = ObjectID.generate();

const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(minutes: number): Date {
  return new Date(SEEN.getTime() - minutes * MINUTE);
}

function owners(...items: Array<[string, string]>): JSONObject {
  return {
    items: items.map(([kind, name]: [string, string]) => {
      return { kind: kind, name: name, uid: `${kind}-${name}` };
    }),
  } as unknown as JSONObject;
}

// A row as the extractor builds it: the verdict worked out the same way.
function resource(
  fields: Partial<ParsedKubernetesResource> & { kind: string; name: string },
): ParsedKubernetesResource {
  const row: ParsedKubernetesResource = {
    namespaceKey: "payments",
    uid: null,
    phase: null,
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
    resourceCreationTimestamp: ago(600),
    ...fields,
  };
  row.healthSeverity = getKubernetesHealthSeverity(row);
  return row;
}

function pod(
  name: string,
  fields: {
    namespace?: string;
    owner?: [string, string];
    nodeName?: string;
    waitingReason?: string;
    labels?: Record<string, string>;
    lastSeenAt?: Date;
  } = {},
): ParsedKubernetesResource {
  return resource({
    kind: "Pod",
    name: name,
    namespaceKey: fields.namespace ?? "payments",
    phase: "Running",
    labels: (fields.labels ?? null) as JSONObject | null,
    ownerReferences: fields.owner ? owners(fields.owner) : null,
    lastSeenAt: fields.lastSeenAt ?? SEEN,
    spec: {
      nodeName: fields.nodeName ?? "node-1",
      containers: [],
    } as unknown as JSONObject,
    status: {
      phase: "Running",
      conditions: [],
      containerStatuses: [
        fields.waitingReason
          ? {
              name: "app",
              ready: false,
              restartCount: 7,
              state: "waiting",
              reason: fields.waitingReason,
              image: "app:1",
            }
          : {
              name: "app",
              ready: true,
              restartCount: 0,
              state: "running",
              reason: "",
              image: "app:1",
            },
      ],
      initContainerStatuses: [],
    } as unknown as JSONObject,
  });
}

function deployment(
  name: string,
  available: number,
  namespace: string = "payments",
): ParsedKubernetesResource {
  return resource({
    kind: "Deployment",
    name: name,
    namespaceKey: namespace,
    spec: { replicas: 3, strategy: "RollingUpdate" } as unknown as JSONObject,
    status: {
      availableReplicas: available,
      readyReplicas: available,
      conditions: [
        {
          type: "Progressing",
          status: "True",
          reason: "NewReplicaSetAvailable",
          message: "",
          lastTransitionTime: ago(900).toISOString(),
        },
      ],
    } as unknown as JSONObject,
  });
}

describePostgres("KubernetesResource health on Postgres", () => {
  const schema: string = `k8s_health_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  async function upsert(
    resources: Array<ParsedKubernetesResource>,
    clusterId: ObjectID = CLUSTER_ID,
    projectId: ObjectID = PROJECT_ID,
  ): Promise<void> {
    await KubernetesResourceService.bulkUpsert({
      projectId: projectId,
      kubernetesClusterId: clusterId,
      resources: resources,
    });
  }

  async function storedSeverity(
    kind: string,
    name: string,
    namespace: string = "payments",
  ): Promise<string | null> {
    const rows: Array<{ healthSeverity: string | null }> = await database.query(
      `SELECT "healthSeverity" FROM "${schema}"."${TABLE}"
       WHERE "kubernetesClusterId" = $1 AND "kind" = $2 AND "name" = $3 AND "namespaceKey" = $4`,
      [CLUSTER_ID.toString(), kind, name, namespace],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.healthSeverity;
  }

  async function needsAttention(): Promise<KubernetesNeedsAttention> {
    return KubernetesResourceService.getNeedsAttention({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
    });
  }

  async function part(data: {
    kind: string;
    name: string;
    namespace?: string;
  }): Promise<KubernetesPart> {
    return KubernetesResourceService.getPart({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      ...data,
    });
  }

  function names(rows: Array<KubernetesPartRow>): Array<string> {
    return rows
      .map((row: KubernetesPartRow): string => {
        return row.name || "";
      })
      .sort();
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

  describe("the stored verdict", () => {
    test("comes from the snapshot the agent sends, through the extractor and the upsert", async () => {
      const crashing: ExtractedInventoryRecord | null =
        extractInventoryResource({
          resourceType: "pods",
          lastSeenAt: SEEN,
          logBody: JSON.stringify({
            kvlistValue: {
              values: [
                { key: "kind", value: { stringValue: "Pod" } },
                {
                  key: "metadata",
                  value: {
                    kvlistValue: {
                      values: [
                        { key: "name", value: { stringValue: "crasher" } },
                        {
                          key: "namespace",
                          value: { stringValue: "payments" },
                        },
                      ],
                    },
                  },
                },
                {
                  key: "status",
                  value: {
                    kvlistValue: {
                      values: [
                        { key: "phase", value: { stringValue: "Running" } },
                        {
                          key: "containerStatuses",
                          value: {
                            arrayValue: {
                              values: [
                                {
                                  kvlistValue: {
                                    values: [
                                      {
                                        key: "name",
                                        value: { stringValue: "app" },
                                      },
                                      {
                                        key: "state",
                                        value: {
                                          kvlistValue: {
                                            values: [
                                              {
                                                key: "waiting",
                                                value: {
                                                  kvlistValue: {
                                                    values: [
                                                      {
                                                        key: "reason",
                                                        value: {
                                                          stringValue:
                                                            "ImagePullBackOff",
                                                        },
                                                      },
                                                    ],
                                                  },
                                                },
                                              },
                                            ],
                                          },
                                        },
                                      },
                                    ],
                                  },
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          }),
        });
      expect(crashing).not.toBeNull();

      await upsert([crashing!.resource, pod("healthy"), deployment("api", 1)]);

      expect(await storedSeverity("Pod", "crasher")).toBe("critical");
      expect(await storedSeverity("Pod", "healthy")).toBeNull();
      expect(await storedSeverity("Deployment", "api")).toBe("warning");
    });

    test("follows each newer snapshot, back to none, and an older one never overwrites it", async () => {
      await upsert([deployment("api", 0)]);
      expect(await storedSeverity("Deployment", "api")).toBe("critical");

      await upsert([{ ...deployment("api", 3), lastSeenAt: ago(-5) }]);
      expect(await storedSeverity("Deployment", "api")).toBeNull();

      // Delivered late: an older snapshot of the broken state.
      await upsert([{ ...deployment("api", 0), lastSeenAt: ago(30) }]);
      expect(await storedSeverity("Deployment", "api")).toBeNull();
    });

    test("is clamped to the column like every other bounded value", async () => {
      const odd: ParsedKubernetesResource = {
        ...pod("odd"),
        healthSeverity: "x".repeat(400) as unknown as KubernetesHealthSeverity,
      };
      await upsert([odd]);
      expect((await storedSeverity("Pod", "odd"))!.length).toBe(100);
    });
  });

  describe("what needs attention", () => {
    test("reads the flagged objects through the partial index, the migrated one", async () => {
      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [schema, TABLE],
      );
      const partial: Array<string> = indexes
        .map((row: { indexdef: string }): string => {
          return row.indexdef;
        })
        .filter((definition: string): boolean => {
          return definition.includes(`"healthSeverity" IS NOT NULL`);
        });
      expect(partial).toHaveLength(1);
      expect(partial[0]).toContain(`("kubernetesClusterId")`);
      expect(partial[0]).toContain(`"deletedAt" IS NULL`);

      const migrated: Array<{ indexname: string }> = await database.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
        [TABLE, PARTIAL_INDEX],
      );
      expect(migrated).toHaveLength(1);

      // With sequential scans off, the read's own predicate uses it.
      await database.query("SET enable_seqscan = off");
      try {
        const plan: Array<{ "QUERY PLAN": string }> = await database.query(
          `EXPLAIN SELECT "name" FROM "${schema}"."${TABLE}"
           WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
             AND "deletedAt" IS NULL AND "healthSeverity" IS NOT NULL`,
          [PROJECT_ID.toString(), CLUSTER_ID.toString()],
        );
        const text: string = plan
          .map((line: { "QUERY PLAN": string }): string => {
            return line["QUERY PLAN"];
          })
          .join("\n");
        expect(text).toMatch(/Index|Bitmap/);
        expect(text).not.toContain("Seq Scan");
      } finally {
        await database.query("SET enable_seqscan = on");
      }
    });

    test("folds the crash-looping pods into their Deployment, read from the namespace's workloads", async () => {
      await upsert([
        deployment("checkout", 1),
        pod("checkout-7d9f8b6c5-aaaaa", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          labels: { "pod-template-hash": "7d9f8b6c5" },
          waitingReason: "CrashLoopBackOff",
        }),
        pod("checkout-7d9f8b6c5-bbbbb", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          labels: { "pod-template-hash": "7d9f8b6c5" },
          waitingReason: "CrashLoopBackOff",
        }),
        pod("checkout-7d9f8b6c5-ccccc", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          labels: { "pod-template-hash": "7d9f8b6c5" },
        }),
      ]);

      const result: KubernetesNeedsAttention = await needsAttention();

      expect(result.isTruncated).toBe(false);
      expect(
        result.findings.map((finding: { key: string; podCount?: number }) => {
          return [finding.key, finding.podCount];
        }),
      ).toEqual([["Deployment:payments/checkout", 2]]);
    });

    test("never reads another cluster's, another project's or a deleted row", async () => {
      await upsert([deployment("ours", 0)]);
      await upsert([deployment("theirs", 0)], OTHER_CLUSTER_ID);
      await upsert([deployment("elsewhere", 0)], CLUSTER_ID, OTHER_PROJECT_ID);
      await upsert([deployment("gone", 0)]);
      await database.query(
        `UPDATE "${schema}"."${TABLE}" SET "deletedAt" = now() WHERE "name" = 'gone'`,
      );

      expect(
        (await needsAttention()).findings.map((finding: { key: string }) => {
          return finding.key;
        }),
      ).toEqual(["Deployment:payments/ours"]);
    });

    test("binds the namespaces and kinds as arrays: a pod folds only into its own namespace's workload", async () => {
      await upsert([
        deployment("checkout", 3, "shop"),
        deployment("checkout", 3, "payments"),
        pod("checkout-7d9f8b6c5-aaaaa", {
          namespace: "payments",
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          waitingReason: "ErrImagePull",
        }),
      ]);

      expect(
        (await needsAttention()).findings.map((finding: { key: string }) => {
          return finding.key;
        }),
      ).toEqual(["Deployment:payments/checkout"]);
    });
  });

  describe("an object's own page", () => {
    beforeEach(async () => {
      await upsert([
        deployment("checkout", 3),
        deployment("checkout-v2", 3),
        deployment("checkout", 3, "shop"),
        pod("checkout-7d9f8b6c5-aaaaa", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          labels: { "pod-template-hash": "7d9f8b6c5" },
          nodeName: "node-1",
        }),
        pod("checkout-v2-5c8d7f9b4-bbbbb", {
          owner: ["ReplicaSet", "checkout-v2-5c8d7f9b4"],
          labels: { "pod-template-hash": "5c8d7f9b4" },
          nodeName: "node-2",
        }),
        pod("checkout-7d9f8b6c5-shop1", {
          namespace: "shop",
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          nodeName: "node-1",
        }),
        resource({
          kind: "StatefulSet",
          name: "postgres",
          spec: { replicas: 2 } as unknown as JSONObject,
          status: { readyReplicas: 2 } as unknown as JSONObject,
        }),
        pod("postgres-0", {
          owner: ["StatefulSet", "postgres"],
          nodeName: "node-2",
        }),
        pod("postgres-1", {
          owner: ["StatefulSet", "postgres"],
          nodeName: "node-1",
        }),
        pod("postgres-backup-0", {
          owner: ["StatefulSet", "postgres-backup"],
          nodeName: "node-1",
        }),
        resource({
          kind: "Node",
          name: "node-1",
          namespaceKey: "",
          isReady: true,
        }),
        resource({
          kind: "CronJob",
          name: "invoice-run",
          spec: { schedule: "0 2 * * *" } as unknown as JSONObject,
        }),
        resource({
          kind: "Job",
          name: "invoice-run-28845600",
          ownerReferences: owners(["CronJob", "invoice-run"]),
          resourceCreationTimestamp: ago(60),
        }),
        resource({
          kind: "Job",
          name: "invoice-run-v2-28845600",
          ownerReferences: owners(["CronJob", "invoice-run-v2"]),
        }),
        pod("invoice-run-28845600-q8xz2", {
          owner: ["Job", "invoice-run-28845600"],
          nodeName: "node-2",
        }),
        pod("invoice-run-v2-28845600-zz9", {
          owner: ["Job", "invoice-run-v2-28845600"],
          nodeName: "node-2",
        }),
      ]);
    });

    test("a Deployment's pods are its ReplicaSets' - never a longer-named neighbour's or another namespace's", async () => {
      const result: KubernetesPart = await part({
        kind: "Deployment",
        name: "checkout",
        namespace: "payments",
      });
      expect(result.part?.namespaceKey).toBe("payments");
      expect(names(result.pods)).toEqual(["checkout-7d9f8b6c5-aaaaa"]);
      expect(result.jobs).toEqual([]);
      expect(result.isPodsTruncated).toBe(false);

      const inShop: KubernetesPart = await part({
        kind: "Deployment",
        name: "checkout",
        namespace: "shop",
      });
      expect(names(inShop.pods)).toEqual(["checkout-7d9f8b6c5-shop1"]);
    });

    test("without a namespace it is always the first of that name, by namespace", async () => {
      const result: KubernetesPart = await part({
        kind: "Deployment",
        name: "checkout",
      });
      expect(result.part?.namespaceKey).toBe("payments");
    });

    test("a StatefulSet owns its pods by name", async () => {
      expect(
        names(
          (
            await part({
              kind: "StatefulSet",
              name: "postgres",
              namespace: "payments",
            })
          ).pods,
        ),
      ).toEqual(["postgres-0", "postgres-1"]);
    });

    test("a node's pods are the ones scheduled on it, in every namespace", async () => {
      const result: KubernetesPart = await part({
        kind: "Node",
        name: "node-1",
      });
      expect(result.part?.kind).toBe("Node");
      expect(names(result.pods)).toEqual([
        "checkout-7d9f8b6c5-aaaaa",
        "checkout-7d9f8b6c5-shop1",
        "postgres-1",
        "postgres-backup-0",
      ]);
    });

    test("a CronJob's page reads its Jobs and their pods, not another CronJob's", async () => {
      const result: KubernetesPart = await part({
        kind: "CronJob",
        name: "invoice-run",
        namespace: "payments",
      });
      expect(names(result.jobs)).toEqual(["invoice-run-28845600"]);
      expect(names(result.pods)).toEqual(["invoice-run-28845600-q8xz2"]);
    });

    test("an object that is not in the inventory reads as none, with nothing it runs", async () => {
      expect(
        await part({
          kind: "Deployment",
          name: "missing",
          namespace: "payments",
        }),
      ).toEqual({ part: null, pods: [], jobs: [], isPodsTruncated: false });
    });

    test("the longer-named neighbour's page has its own pods, and only those", async () => {
      const result: KubernetesPart = await part({
        kind: "Deployment",
        name: "checkout-v2",
        namespace: "payments",
      });
      expect(names(result.pods)).toEqual(["checkout-v2-5c8d7f9b4-bbbbb"]);
    });

    test("a kind that runs no pods reads only itself", async () => {
      const result: KubernetesPart = await part({
        kind: "Namespace",
        name: "payments",
      });
      expect(result).toEqual({
        part: null,
        pods: [],
        jobs: [],
        isPodsTruncated: false,
      });

      await upsert([
        resource({ kind: "Namespace", name: "payments", namespaceKey: "" }),
      ]);
      const namespace: KubernetesPart = await part({
        kind: "Namespace",
        name: "payments",
      });
      expect(namespace.part?.name).toBe("payments");
      expect(namespace.pods).toEqual([]);
    });
  });
});
