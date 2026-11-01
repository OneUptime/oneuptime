import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { ParsedKubernetesResource } from "../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesAttentionFinding,
  KubernetesHealthRow,
  KubernetesObjectRef,
  getKubernetesAttentionFindings,
  getKubernetesPodWorkload,
} from "../../Types/Kubernetes/KubernetesHealth";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * KubernetesResourceService
 *
 * Writes and reads the inventory table populated by the telemetry
 * ingest path. Callers are either:
 *   - OtelLogsIngestService (bulkUpsert, from processLogsAsync)
 *   - CleanupStaleResources worker (deleteStaleForCluster)
 *   - KubernetesResourceAPI / KubernetesObjectFetcher (reads via
 *     the inherited DatabaseService CRUD)
 *
 * ------------------------------------------------------------------
 */

export type { ParsedKubernetesResource };

export interface ResourceLatestMetric {
  kind: string;
  namespaceKey: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  observedAt: Date;
  /*
   * Optional Pod controller lineage. Read from
   * resource.k8s.deployment.name / resource.k8s.cronjob.name on the
   * metric stream. Persisted via COALESCE so once written they stick
   * even if a later batch lacks the attribute.
   */
  controllerDeploymentName?: string | null;
  controllerCronJobName?: string | null;
}

export interface InventorySummary {
  countsByKind: Record<string, number>;
  /*
   * Sum of the denormalized containerCount column across all pods in
   * the cluster. Containers aren't a top-level kind in the inventory,
   * so we derive the total server-side so the sidebar badge and the
   * Containers page agree.
   */
  containerCount: number;
  podPhaseCounts: {
    running: number;
    pending: number;
    failed: number;
    succeeded: number;
    unknown: number;
  };
  nodeReadyCounts: {
    ready: number;
    notReady: number;
  };
  nodePressureCounts: {
    memoryPressure: number;
    diskPressure: number;
    pidPressure: number;
  };
}

/*
 * What a cluster's Needs attention reads (getNeedsAttention). The objects
 * that need attention are few in a working cluster; these bound what one
 * read can cost in a broken one. The worst come first, so a cluster with
 * more than the limit still shows its critical findings.
 */
export const NEEDS_ATTENTION_ROW_LIMIT: number = 2000;
export const NEEDS_ATTENTION_WORKLOAD_LIMIT: number = 5000;
export const NEEDS_ATTENTION_FINDING_LIMIT: number = 500;

// The workloads a pod's or a Job's finding folds into.
const NEEDS_ATTENTION_WORKLOAD_KINDS: Array<string> = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
];

export interface KubernetesNeedsAttention {
  findings: Array<KubernetesAttentionFinding>;
  // More needed attention than one read takes: the worst are listed.
  isTruncated: boolean;
}

/*
 * An object's own page reads it with what it runs (getPart): a workload's
 * pods, a node's pods, a CronJob's Jobs and their pods. A node runs at most
 * a few hundred pods and a namespace's workloads a few thousand; these
 * bound one read.
 */
export const PART_POD_LIMIT: number = 1000;
export const PART_CANDIDATE_LIMIT: number = 5000;

// A row as getPart and the pages read it: what the rules and the lists use.
export interface KubernetesPartRow extends KubernetesHealthRow {
  _id: string;
  latestCpuPercent: number | string | null;
  latestMemoryBytes: number | string | null;
  latestMemoryPercent: number | string | null;
  metricsUpdatedAt: Date | null;
}

export interface KubernetesPart {
  // Null when the cluster's inventory holds no such object.
  part: KubernetesPartRow | null;
  // Its pods, the most recently seen first.
  pods: Array<KubernetesPartRow>;
  // A CronJob's Jobs; empty for any other kind.
  jobs: Array<KubernetesPartRow>;
  // It runs more pods than one read takes.
  isPodsTruncated: boolean;
}

// The kinds whose page lists the pods they run.
export const KINDS_WITH_PODS: ReadonlySet<string> = new Set<string>([
  "Node",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
]);

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by both bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<keyof ParsedKubernetesResource | string> = [
  "projectId",
  "kubernetesClusterId",
  "kind",
  "namespaceKey",
  "name",
  "uid",
  "phase",
  "isReady",
  "hasMemoryPressure",
  "hasDiskPressure",
  "hasPidPressure",
  "labels",
  "annotations",
  "ownerReferences",
  "spec",
  "containerCount",
  "status",
  "lastSeenAt",
  "resourceCreationTimestamp",
  "healthSeverity",
  "version",
];

/*
 * KubernetesResource's text columns are bounded varchars — name and
 * controllerDeploymentName at 500 chars, kind / namespaceKey / uid /
 * phase at 100. The bulk paths below go through manager.query(), which
 * skips the length validation DatabaseService applies to ordinary
 * writes, so a single oversized value aborts the whole 500-row INSERT
 * chunk it rides in. Clamp per value instead, so one pathological
 * object can never drop the rest of the snapshot.
 */
function sanitizeResource(
  r: ParsedKubernetesResource,
): ParsedKubernetesResource {
  return {
    ...r,
    kind: truncateShortText(r.kind),
    namespaceKey: truncateShortText(r.namespaceKey),
    name: truncateLongText(r.name),
    uid: truncateShortText(r.uid),
    phase: truncateShortText(r.phase),
    healthSeverity: truncateShortText(r.healthSeverity ?? null) as
      | ParsedKubernetesResource["healthSeverity"]
      | null,
  };
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, clusterId, kind,
   * namespaceKey, name) index with a dominance guard on lastSeenAt
   * so out-of-order ingest never regresses a newer snapshot.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    resources: Array<ParsedKubernetesResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedKubernetesResource> = data.resources.map(
      (r: ParsedKubernetesResource) => {
        const sanitized: ParsedKubernetesResource = sanitizeResource(r);
        if (sanitized.name !== r.name) {
          logger.warn(
            `KubernetesResource name exceeds ${ColumnLength.LongText} chars; truncated to "${sanitized.name}" (cluster ${data.kubernetesClusterId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedKubernetesResource> = resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const r of chunk) {
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < UPSERT_COLUMNS.length; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          r.kind,
          r.namespaceKey,
          r.name,
          r.uid,
          r.phase,
          r.isReady,
          r.hasMemoryPressure,
          r.hasDiskPressure,
          r.hasPidPressure,
          r.labels ? JSON.stringify(r.labels) : null,
          r.annotations ? JSON.stringify(r.annotations) : null,
          r.ownerReferences ? JSON.stringify(r.ownerReferences) : null,
          r.spec ? JSON.stringify(r.spec) : null,
          r.containerCount,
          r.status ? JSON.stringify(r.status) : null,
          r.lastSeenAt,
          r.resourceCreationTimestamp,
          r.healthSeverity ?? null,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "KubernetesResource" (
          "projectId", "kubernetesClusterId", "kind", "namespaceKey", "name",
          "uid", "phase", "isReady",
          "hasMemoryPressure", "hasDiskPressure", "hasPidPressure",
          "labels", "annotations", "ownerReferences", "spec", "containerCount", "status",
          "lastSeenAt", "resourceCreationTimestamp", "healthSeverity", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "kubernetesClusterId", "kind", "namespaceKey", "name")
        DO UPDATE SET
          "uid" = EXCLUDED."uid",
          "phase" = EXCLUDED."phase",
          "isReady" = EXCLUDED."isReady",
          "hasMemoryPressure" = EXCLUDED."hasMemoryPressure",
          "hasDiskPressure" = EXCLUDED."hasDiskPressure",
          "hasPidPressure" = EXCLUDED."hasPidPressure",
          "labels" = EXCLUDED."labels",
          "annotations" = EXCLUDED."annotations",
          "ownerReferences" = EXCLUDED."ownerReferences",
          "spec" = EXCLUDED."spec",
          "containerCount" = EXCLUDED."containerCount",
          "status" = EXCLUDED."status",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "resourceCreationTimestamp" = EXCLUDED."resourceCreationTimestamp",
          "healthSeverity" = EXCLUDED."healthSeverity",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "KubernetesResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Update latestCpuPercent / latestMemoryBytes / metricsUpdatedAt for
   * a batch of resources (typically Pods or Nodes). Plain UPDATE: if
   * the snapshot row doesn't exist yet, the metric write is silently
   * skipped — the next k8sobjects snapshot creates the row, and the
   * next metric flush catches up.
   *
   * Guarded by metricsUpdatedAt so out-of-order points don't regress
   * a newer observation.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    metrics: Array<ResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ResourceLatestMetric> = data.metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::timestamptz, $${paramIndex++}, $${paramIndex++})`,
        );
        /*
         * The identity clamps MUST match bulkUpsert's, or this mirror
         * UPDATE would silently miss the row the upsert just wrote
         * under the truncated name. controllerDeploymentName /
         * controllerCronJobName are assigned columns, so an oversized
         * value there aborts the chunk exactly like the INSERT path.
         */
        params.push(
          truncateShortText(m.kind),
          truncateShortText(m.namespaceKey),
          truncateLongText(m.name),
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.memoryPercent !== null && m.memoryPercent !== undefined
            ? m.memoryPercent
            : null,
          m.observedAt,
          truncateLongText(m.controllerDeploymentName ?? null),
          truncateShortText(m.controllerCronJobName ?? null),
        );
      }

      const sql: string = `
        UPDATE "KubernetesResource" AS k
        SET
          "latestCpuPercent" = COALESCE(v."cpu", k."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", k."latestMemoryBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", k."latestMemoryPercent"),
          "metricsUpdatedAt" = v."observedAt",
          "controllerDeploymentName" = COALESCE(v."deployName", k."controllerDeploymentName"),
          "controllerCronJobName" = COALESCE(v."cronName", k."controllerCronJobName"),
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "ns", "name", "cpu", "mem", "memPct", "observedAt", "deployName", "cronName")
        WHERE
          k."projectId" = $1
          AND k."kubernetesClusterId" = $2
          AND k."kind" = v."kind"
          AND k."namespaceKey" = v."ns"
          AND k."name" = v."name"
          AND (k."metricsUpdatedAt" IS NULL OR v."observedAt" >= k."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources in a cluster whose last snapshot is
   * older than olderThan. Returns the number of deleted rows.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    kubernetesClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "KubernetesResource" WHERE "kubernetesClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.kubernetesClusterId.toString(), data.olderThan],
      );

    // Postgres driver returns [rows, affected] for DELETE — normalize.
    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `KubernetesResource cleanup deleted ${affected} stale rows for cluster ${data.kubernetesClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * The nodes and pods of a project that hold any of these addresses, at
   * most `limit`, by id (issue #5340: what the Traffic pages call an
   * address). A node holds its InternalIP and ExternalIP addresses
   * (status.addresses); a pod its podIP - unless it is on the node's own
   * network (podIP is hostIP), where the address is the node's. Raw SQL on
   * purpose: "an object of the jsonb array has one of these" is something
   * the query builder cannot say. Pinned to the project; callers read the
   * rows themselves, with the caller's own rights.
   */
  @CaptureSpan()
  public async findIdsHoldingAddresses(data: {
    projectId: ObjectID;
    addresses: Array<string>;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const addresses: Array<string> = Array.from(
      new Set<string>(
        data.addresses
          .map((address: string): string => {
            return address.trim().toLowerCase();
          })
          .filter((address: string): boolean => {
            return address.length > 0;
          }),
      ),
    );

    if (addresses.length === 0 || data.limit <= 0) {
      return [];
    }

    const rows: unknown = await this.getRepository().manager.query(
      `SELECT "_id"
        FROM "KubernetesResource"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND (
            (
              "kind" = 'Pod'
              AND jsonb_typeof("status") = 'object'
              AND LOWER("status" ->> 'podIP') = ANY($2::text[])
              AND COALESCE("status" ->> 'hostIP', '') <> COALESCE("status" ->> 'podIP', '')
            )
            OR (
              "kind" = 'Node'
              AND jsonb_typeof("status") = 'object'
              AND jsonb_typeof("status" -> 'addresses') = 'array'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements("status" -> 'addresses') AS node_address(item)
                WHERE jsonb_typeof(node_address.item) = 'object'
                  AND node_address.item ->> 'type' IN ('InternalIP', 'ExternalIP')
                  AND LOWER(node_address.item ->> 'address') = ANY($2::text[])
              )
            )
          )
        ORDER BY "_id"
        LIMIT $3`,
      [data.projectId.toString(), addresses, data.limit],
    );

    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown): string => {
        const record: Record<string, unknown> =
          row && typeof row === "object"
            ? (row as Record<string, unknown>)
            : {};

        return String(record["_id"] || "");
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /**
   * Compute the overview-page summary in Postgres. Returns counts per
   * resource kind plus pod phase / node condition breakdowns in a
   * single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<InventorySummary> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const [kindRows, podRows, nodeRows, containerRows]: [
      Array<{ kind: string; count: string }>,
      Array<{ phase: string | null; count: string }>,
      Array<{
        ready: string;
        notReady: string;
        memoryPressure: string;
        diskPressure: string;
        pidPressure: string;
      }>,
      Array<{ total: string }>,
    ] = await Promise.all([
      manager.query(
        `SELECT "kind", COUNT(*)::text AS count
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "deletedAt" IS NULL
         GROUP BY "kind"`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        `SELECT "phase", COUNT(*)::text AS count
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Pod' AND "deletedAt" IS NULL
         GROUP BY "phase"`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        `SELECT
           COUNT(*) FILTER (WHERE "isReady" IS TRUE)::text AS "ready",
           COUNT(*) FILTER (WHERE "isReady" IS FALSE)::text AS "notReady",
           COUNT(*) FILTER (WHERE "hasMemoryPressure" IS TRUE)::text AS "memoryPressure",
           COUNT(*) FILTER (WHERE "hasDiskPressure" IS TRUE)::text AS "diskPressure",
           COUNT(*) FILTER (WHERE "hasPidPressure" IS TRUE)::text AS "pidPressure"
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Node' AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        /*
         * containerCount is cached on the row during ingest
         * (KubernetesInventoryExtractor sets it from
         * spec.containers.length), so this is a plain int sum instead
         * of a JSONB scan. Rows written before that ingest change may
         * have NULL; SUM treats those as 0, which matches the old
         * behavior.
         */
        `SELECT COALESCE(SUM("containerCount"), 0)::text AS total
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Pod' AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
    ]);

    const countsByKind: Record<string, number> = {};
    for (const row of kindRows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
    }

    const podPhaseCounts: InventorySummary["podPhaseCounts"] = {
      running: 0,
      pending: 0,
      failed: 0,
      succeeded: 0,
      unknown: 0,
    };
    for (const row of podRows) {
      const phase: string = row.phase || "Unknown";
      const count: number = parseInt(row.count, 10) || 0;
      if (phase === "Running") {
        podPhaseCounts.running = count;
      } else if (phase === "Pending") {
        podPhaseCounts.pending = count;
      } else if (phase === "Failed") {
        podPhaseCounts.failed = count;
      } else if (phase === "Succeeded") {
        podPhaseCounts.succeeded = count;
      } else {
        podPhaseCounts.unknown += count;
      }
    }

    const nodeRow:
      | {
          ready: string;
          notReady: string;
          memoryPressure: string;
          diskPressure: string;
          pidPressure: string;
        }
      | undefined = nodeRows[0];

    const containerCount: number =
      parseInt(containerRows[0]?.total || "0", 10) || 0;

    return {
      countsByKind,
      containerCount,
      podPhaseCounts,
      nodeReadyCounts: {
        ready: parseInt(nodeRow?.ready || "0", 10) || 0,
        notReady: parseInt(nodeRow?.notReady || "0", 10) || 0,
      },
      nodePressureCounts: {
        memoryPressure: parseInt(nodeRow?.memoryPressure || "0", 10) || 0,
        diskPressure: parseInt(nodeRow?.diskPressure || "0", 10) || 0,
        pidPressure: parseInt(nodeRow?.pidPressure || "0", 10) || 0,
      },
    };
  }

  /**
   * What needs attention in a cluster, the most urgent first: every
   * object ingest flagged (healthSeverity, read through its partial
   * index), with the workloads of the namespaces they are in, so a pod's
   * finding folds into its Deployment and a Job into its CronJob
   * (KubernetesHealth.getKubernetesAttentionFindings). The rules run again
   * on the rows read, at the time each was seen, so the findings say why
   * in today's words even for a row flagged before an upgrade.
   */
  @CaptureSpan()
  public async getNeedsAttention(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<KubernetesNeedsAttention> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const columns: string = `"kind", "namespaceKey", "name", "phase", "isReady",
      "hasMemoryPressure", "hasDiskPressure", "hasPidPressure", "labels",
      "ownerReferences", "spec", "status", "lastSeenAt", "resourceCreationTimestamp"`;

    const flagged: Array<KubernetesHealthRow> = await manager.query(
      `SELECT ${columns}
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "deletedAt" IS NULL
         AND "healthSeverity" IS NOT NULL
       ORDER BY
         CASE "healthSeverity" WHEN 'critical' THEN 0 ELSE 1 END,
         "lastSeenAt" DESC
       LIMIT ${NEEDS_ATTENTION_ROW_LIMIT + 1}`,
      [data.projectId.toString(), data.kubernetesClusterId.toString()],
    );

    const isRowLimitHit: boolean = flagged.length > NEEDS_ATTENTION_ROW_LIMIT;
    const rows: Array<KubernetesHealthRow> = flagged.slice(
      0,
      NEEDS_ATTENTION_ROW_LIMIT,
    );

    // The namespaces whose workloads a flagged pod or Job may fold into.
    const namespaces: Array<string> = Array.from(
      new Set(
        rows
          .filter((row: KubernetesHealthRow): boolean => {
            return Boolean(row.namespaceKey);
          })
          .map((row: KubernetesHealthRow): string => {
            return row.namespaceKey as string;
          }),
      ),
    );

    const workloads: Array<KubernetesHealthRow> =
      namespaces.length > 0
        ? await manager.query(
            `SELECT ${columns}
             FROM "KubernetesResource"
             WHERE "projectId" = $1
               AND "kubernetesClusterId" = $2
               AND "deletedAt" IS NULL
               AND "kind" = ANY($3)
               AND "namespaceKey" = ANY($4)
             LIMIT ${NEEDS_ATTENTION_WORKLOAD_LIMIT}`,
            [
              data.projectId.toString(),
              data.kubernetesClusterId.toString(),
              NEEDS_ATTENTION_WORKLOAD_KINDS,
              namespaces,
            ],
          )
        : [];

    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([...workloads, ...rows]);

    return {
      findings: findings.slice(0, NEEDS_ATTENTION_FINDING_LIMIT),
      isTruncated:
        isRowLimitHit || findings.length > NEEDS_ATTENTION_FINDING_LIMIT,
    };
  }

  /**
   * An object with what it runs, for its own page: a Deployment,
   * StatefulSet, DaemonSet, Job or DeploymentConfig with its pods, a
   * CronJob with its Jobs and their pods, a node with the pods scheduled
   * on it. The pods are found in SQL on what names them - their owner
   * references, a node's name in their spec - and then held to the same
   * owner rule the findings use (getKubernetesPodWorkload), so `checkout`
   * never collects `checkout-v2`'s pods.
   *
   * Without a namespace the object is the first of that name by namespace,
   * so an address without one always opens the same object.
   */
  @CaptureSpan()
  public async getPart(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    kind: string;
    name: string;
    namespace?: string | undefined;
  }): Promise<KubernetesPart> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const columns: string = `"_id", "kind", "namespaceKey", "name", "phase", "isReady",
      "hasMemoryPressure", "hasDiskPressure", "hasPidPressure", "labels",
      "ownerReferences", "spec", "status", "lastSeenAt", "resourceCreationTimestamp",
      "latestCpuPercent", "latestMemoryBytes", "latestMemoryPercent", "metricsUpdatedAt"`;

    const scope: Array<unknown> = [
      data.projectId.toString(),
      data.kubernetesClusterId.toString(),
    ];
    const live: string = `"projectId" = $1 AND "kubernetesClusterId" = $2 AND "deletedAt" IS NULL`;

    const parts: Array<KubernetesPartRow> = await manager.query(
      `SELECT ${columns}
       FROM "KubernetesResource"
       WHERE ${live}
         AND "kind" = $3
         AND "name" = $4
         ${data.namespace !== undefined ? `AND "namespaceKey" = $5` : ""}
       ORDER BY "namespaceKey" ASC
       LIMIT 1`,
      data.namespace !== undefined
        ? [...scope, data.kind, data.name, data.namespace]
        : [...scope, data.kind, data.name],
    );

    const part: KubernetesPartRow | null = parts[0] || null;

    if (!part || !KINDS_WITH_PODS.has(data.kind)) {
      return { part: part, pods: [], jobs: [], isPodsTruncated: false };
    }

    const namespace: string = part.namespaceKey || "";
    let jobs: Array<KubernetesPartRow> = [];
    let candidates: Array<KubernetesPartRow> = [];

    if (data.kind === "Node") {
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "spec"->>'nodeName' = $3
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_POD_LIMIT + 1}`,
        [...scope, data.name],
      );
    } else if (data.kind === "Deployment" || data.kind === "DeploymentConfig") {
      /*
       * A Deployment's pods belong to its ReplicaSets, `<name>-<hash>`; a
       * DeploymentConfig's to its ReplicationControllers, `<name>-<n>`,
       * and OpenShift labels them with its name. A name prefix finds them,
       * and a longer-named neighbour's too: the owner rule below drops
       * those.
       */
      const ownerKind: string =
        data.kind === "Deployment" ? "ReplicaSet" : "ReplicationController";
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "namespaceKey" = $3
           AND (
             jsonb_path_exists(
               "ownerReferences",
               '$.items[*] ? (@.kind == $kind && @.name starts with $prefix)',
               jsonb_build_object('kind', $4::text, 'prefix', $5::text)
             )
             OR "labels"->>'deploymentconfig' = $6
             OR "labels"->>'openshift.io/deployment-config.name' = $6
           )
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_CANDIDATE_LIMIT}`,
        [...scope, namespace, ownerKind, `${data.name}-`, data.name],
      );
    } else if (data.kind === "CronJob") {
      jobs = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Job'
           AND "namespaceKey" = $3
           AND "ownerReferences"->'items' @> jsonb_build_array(
             jsonb_build_object('kind', 'CronJob', 'name', $4::text)
           )
         ORDER BY "resourceCreationTimestamp" DESC NULLS LAST
         LIMIT ${PART_CANDIDATE_LIMIT}`,
        [...scope, namespace, data.name],
      );
      // A CronJob's Jobs are `<cronjob>-<scheduled minute>`.
      candidates =
        jobs.length > 0
          ? await manager.query(
              `SELECT ${columns}
               FROM "KubernetesResource"
               WHERE ${live}
                 AND "kind" = 'Pod'
                 AND "namespaceKey" = $3
                 AND jsonb_path_exists(
                   "ownerReferences",
                   '$.items[*] ? (@.kind == "Job" && @.name starts with $prefix)',
                   jsonb_build_object('prefix', $4::text)
                 )
               ORDER BY "lastSeenAt" DESC
               LIMIT ${PART_CANDIDATE_LIMIT}`,
              [...scope, namespace, `${data.name}-`],
            )
          : [];
    } else {
      // A StatefulSet, DaemonSet or Job owns its pods by name.
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "namespaceKey" = $3
           AND "ownerReferences"->'items' @> jsonb_build_array(
             jsonb_build_object('kind', $4::text, 'name', $5::text)
           )
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_POD_LIMIT + 1}`,
        [...scope, namespace, data.kind, data.name],
      );
    }

    const jobNames: Set<string> = new Set<string>(
      jobs.map((job: KubernetesPartRow): string => {
        return job.name || "";
      }),
    );

    const pods: Array<KubernetesPartRow> = candidates.filter(
      (pod: KubernetesPartRow): boolean => {
        if (data.kind === "Node") {
          return true;
        }
        const workload: KubernetesObjectRef | null =
          getKubernetesPodWorkload(pod);
        if (!workload) {
          return false;
        }
        if (data.kind === "CronJob") {
          return workload.kind === "Job" && jobNames.has(workload.name);
        }
        return workload.kind === data.kind && workload.name === data.name;
      },
    );

    return {
      part: part,
      pods: pods.slice(0, PART_POD_LIMIT),
      jobs: jobs,
      isPodsTruncated: pods.length > PART_POD_LIMIT,
    };
  }

  /**
   * Aggregate the latest pod CPU/memory by namespace. Used by the
   * Namespaces list view, replacing the prior ClickHouse groupBy
   * scan. Only counts pods whose metricsUpdatedAt is within the
   * staleness window so we don't surface stale numbers as current.
   */
  @CaptureSpan()
  public async getLatestMetricsByNamespace(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    staleAfter: Date;
  }): Promise<
    Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >
  > {
    const rows: Array<{
      namespaceKey: string;
      cpu: string | null;
      mem: string | null;
      memPct: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "namespaceKey",
              SUM("latestCpuPercent")::text AS cpu,
              SUM("latestMemoryBytes")::text AS mem,
              SUM("latestMemoryPercent")::text AS "memPct"
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "kind" = 'Pod'
         AND "deletedAt" IS NULL
         AND "metricsUpdatedAt" IS NOT NULL
         AND "metricsUpdatedAt" >= $3
       GROUP BY "namespaceKey"`,
      [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
        data.staleAfter,
      ],
    );

    const out: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = new Map();
    for (const row of rows) {
      out.set(row.namespaceKey || "", {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
        memoryPercent: row.memPct ? parseFloat(row.memPct) || 0 : 0,
      });
    }
    return out;
  }

  /**
   * Aggregate the latest pod CPU/memory by owner (Deployment /
   * StatefulSet / DaemonSet / Job / CronJob).
   *
   * Direct-owner kinds (StatefulSet, DaemonSet, Job) read from the
   * Pod's ownerReferences JSONB. Indirect-owner kinds (Deployment,
   * CronJob) read from the denormalized controllerDeploymentName /
   * controllerCronJobName columns populated by the metric ingest
   * path — Pods don't directly own to those kinds, so we can't walk
   * ownerReferences for them.
   *
   * Returns a Map keyed by owner name. Pods without recent metrics
   * (metricsUpdatedAt past the staleness cutoff) are excluded so the
   * sum reflects "right now," not "ever observed."
   */
  @CaptureSpan()
  public async getLatestMetricsByOwner(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    ownerKind: string;
    staleAfter: Date;
  }): Promise<
    Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >
  > {
    let rows: Array<{
      ownerName: string;
      cpu: string | null;
      mem: string | null;
      memPct: string | null;
    }>;

    if (data.ownerKind === "Deployment" || data.ownerKind === "CronJob") {
      const column: string =
        data.ownerKind === "Deployment"
          ? "controllerDeploymentName"
          : "controllerCronJobName";
      rows = await this.getRepository().manager.query(
        `SELECT
           "${column}" AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "${column}" IS NOT NULL
         GROUP BY "${column}"`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
        ],
      );
    } else if (data.ownerKind === "DeploymentConfig") {
      /*
       * A DeploymentConfig's pods belong to the ReplicationController of its
       * rollout (<name>-<version>), so ownerReferences never name it, and
       * metrics carry no controller column for it. OpenShift labels each of
       * them deploymentconfig=<name>, whichever rollout made it.
       */
      rows = await this.getRepository().manager.query(
        `SELECT
           "labels"->>'deploymentconfig' AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "labels"->>'deploymentconfig' IS NOT NULL
         GROUP BY "labels"->>'deploymentconfig'`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
        ],
      );
    } else {
      rows = await this.getRepository().manager.query(
        `SELECT
           (owner->>'name') AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource",
              jsonb_array_elements("ownerReferences"->'items') AS owner
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "ownerReferences" IS NOT NULL
           AND owner->>'kind' = $4
         GROUP BY (owner->>'name')`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
          data.ownerKind,
        ],
      );
    }

    const out: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = new Map();
    for (const row of rows) {
      if (!row.ownerName) {
        continue;
      }
      out.set(row.ownerName, {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
        memoryPercent: row.memPct ? parseFloat(row.memPct) || 0 : 0,
      });
    }
    return out;
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute snapshot interval by default. Tune via
   * K8S_INVENTORY_STALE_MINUTES — a value below 5 is ignored and the
   * 15-minute default applies, so it is not clamped to the floor. Keep the
   * threshold above the agent's resourceSpecs interval: CleanupStaleResources
   * hard-deletes inventory rows whose lastSeenAt is older than this cutoff.
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["K8S_INVENTORY_STALE_MINUTES"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 5) {
        return parsed;
      }
    }
    return 15;
  }
}

export default new Service();
