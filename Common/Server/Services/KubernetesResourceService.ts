import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { ParsedKubernetesResource } from "../../Types/Kubernetes/KubernetesInventoryExtractor";
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

export interface DegradedPod {
  name: string;
  namespace: string;
  phase: string;
  reason: string;
  message: string;
}

export interface DegradedNode {
  name: string;
  isReady: boolean;
  hasMemoryPressure: boolean;
  hasDiskPressure: boolean;
  hasPidPressure: boolean;
  reason: string;
  message: string;
}

export interface ResourceLatestMetric {
  kind: string;
  namespaceKey: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
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
  /*
   * Top offenders that explain a Degraded/Unhealthy cluster state. Capped
   * so a pathological cluster can't blow up the overview payload; the
   * dedicated Pods/Nodes pages are the source of truth for the full list.
   */
  degradedPods: Array<DegradedPod>;
  degradedNodes: Array<DegradedNode>;
}

const DEGRADED_SAMPLE_LIMIT: number = 20;

/*
 * Pull the first meaningful reason/message off a pod's status block.
 * KubernetesInventoryExtractor stores containerStatuses as an array of
 * { name, ready, state: "running"|"waiting"|"terminated", reason, message, ... }.
 * A waiting container with a reason (ImagePullBackOff, CrashLoopBackOff,
 * CreateContainerConfigError, ...) is exactly what the user needs to see,
 * so we surface that first. We fall back to terminated reasons (OOMKilled,
 * Error, ContainerCannotRun) and then to status-level conditions.
 */
function buildDegradedPod(row: {
  name: string;
  namespaceKey: string;
  phase: string | null;
  status: unknown;
}): DegradedPod {
  const status: Record<string, unknown> =
    row.status && typeof row.status === "object"
      ? (row.status as Record<string, unknown>)
      : {};

  let reason: string = "";
  let message: string = "";

  const containerStatuses: Array<Record<string, unknown>> = Array.isArray(
    status["containerStatuses"],
  )
    ? (status["containerStatuses"] as Array<Record<string, unknown>>)
    : [];
  const initContainerStatuses: Array<Record<string, unknown>> = Array.isArray(
    status["initContainerStatuses"],
  )
    ? (status["initContainerStatuses"] as Array<Record<string, unknown>>)
    : [];

  const scanForReason: (
    list: Array<Record<string, unknown>>,
    targetState: string,
  ) => { reason: string; message: string } | null = (
    list: Array<Record<string, unknown>>,
    targetState: string,
  ) => {
    for (const cs of list) {
      if (cs["state"] !== targetState) {
        continue;
      }
      const r: unknown = cs["reason"];
      if (typeof r === "string" && r) {
        const m: unknown = cs["message"];
        return {
          reason: r,
          message: typeof m === "string" ? m : "",
        };
      }
    }
    return null;
  };

  const waitingHit: { reason: string; message: string } | null =
    scanForReason(containerStatuses, "waiting") ||
    scanForReason(initContainerStatuses, "waiting");
  const terminatedHit: { reason: string; message: string } | null = waitingHit
    ? null
    : scanForReason(containerStatuses, "terminated") ||
      scanForReason(initContainerStatuses, "terminated");
  const hit: { reason: string; message: string } | null =
    waitingHit || terminatedHit;

  if (hit) {
    reason = hit.reason;
    message = hit.message;
  } else {
    /*
     * Fall back to the pod-level reason/message fields set by the scheduler
     * (e.g. "Unschedulable" with "0/3 nodes are available: ...").
     */
    const topReason: unknown = status["reason"];
    const topMessage: unknown = status["message"];
    if (typeof topReason === "string") {
      reason = topReason;
    }
    if (typeof topMessage === "string") {
      message = topMessage;
    }

    // If still nothing, pull from the first non-True condition.
    if (!reason) {
      const conditions: Array<Record<string, unknown>> = Array.isArray(
        status["conditions"],
      )
        ? (status["conditions"] as Array<Record<string, unknown>>)
        : [];
      for (const cond of conditions) {
        if (cond["status"] !== "True") {
          const r: unknown = cond["reason"];
          const m: unknown = cond["message"];
          if (typeof r === "string" && r) {
            reason = r;
            message = typeof m === "string" ? m : "";
            break;
          }
        }
      }
    }
  }

  return {
    name: row.name,
    namespace: row.namespaceKey || "",
    phase: row.phase || "Unknown",
    reason,
    message,
  };
}

/*
 * For a Node: if isReady is false, the "Ready" condition carries the real
 * story (e.g. "KubeletNotReady: PLEG is not healthy"). If only pressure
 * flags are tripped, pick the tripped condition's reason/message.
 */
function buildDegradedNode(row: {
  name: string;
  isReady: boolean | null;
  hasMemoryPressure: boolean | null;
  hasDiskPressure: boolean | null;
  hasPidPressure: boolean | null;
  status: unknown;
}): DegradedNode {
  const status: Record<string, unknown> =
    row.status && typeof row.status === "object"
      ? (row.status as Record<string, unknown>)
      : {};

  const conditions: Array<Record<string, unknown>> = Array.isArray(
    status["conditions"],
  )
    ? (status["conditions"] as Array<Record<string, unknown>>)
    : [];

  const findCondition: (
    predicate: (c: Record<string, unknown>) => boolean,
  ) => Record<string, unknown> | null = (
    predicate: (c: Record<string, unknown>) => boolean,
  ) => {
    for (const c of conditions) {
      if (predicate(c)) {
        return c;
      }
    }
    return null;
  };

  let picked: Record<string, unknown> | null = null;
  if (row.isReady === false) {
    picked = findCondition((c: Record<string, unknown>) => {
      return c["type"] === "Ready" && c["status"] !== "True";
    });
  }
  if (!picked && row.hasMemoryPressure === true) {
    picked = findCondition((c: Record<string, unknown>) => {
      return c["type"] === "MemoryPressure" && c["status"] === "True";
    });
  }
  if (!picked && row.hasDiskPressure === true) {
    picked = findCondition((c: Record<string, unknown>) => {
      return c["type"] === "DiskPressure" && c["status"] === "True";
    });
  }
  if (!picked && row.hasPidPressure === true) {
    picked = findCondition((c: Record<string, unknown>) => {
      return c["type"] === "PIDPressure" && c["status"] === "True";
    });
  }

  const reason: string =
    picked && typeof picked["reason"] === "string"
      ? (picked["reason"] as string)
      : "";
  const message: string =
    picked && typeof picked["message"] === "string"
      ? (picked["message"] as string)
      : "";

  return {
    name: row.name,
    isReady: row.isReady === true,
    hasMemoryPressure: row.hasMemoryPressure === true,
    hasDiskPressure: row.hasDiskPressure === true,
    hasPidPressure: row.hasPidPressure === true,
    reason,
    message,
  };
}

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
  "version",
];

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

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < data.resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedKubernetesResource> = data.resources.slice(
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
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "KubernetesResource" (
          "projectId", "kubernetesClusterId", "kind", "namespaceKey", "name",
          "uid", "phase", "isReady",
          "hasMemoryPressure", "hasDiskPressure", "hasPidPressure",
          "labels", "annotations", "ownerReferences", "spec", "containerCount", "status",
          "lastSeenAt", "resourceCreationTimestamp", "version"
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
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz, $${paramIndex++}, $${paramIndex++})`,
        );
        params.push(
          m.kind,
          m.namespaceKey,
          m.name,
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.observedAt,
          m.controllerDeploymentName ?? null,
          m.controllerCronJobName ?? null,
        );
      }

      const sql: string = `
        UPDATE "KubernetesResource" AS k
        SET
          "latestCpuPercent" = COALESCE(v."cpu", k."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", k."latestMemoryBytes"),
          "metricsUpdatedAt" = v."observedAt",
          "controllerDeploymentName" = COALESCE(v."deployName", k."controllerDeploymentName"),
          "controllerCronJobName" = COALESCE(v."cronName", k."controllerCronJobName"),
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "ns", "name", "cpu", "mem", "observedAt", "deployName", "cronName")
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

    const [
      kindRows,
      podRows,
      nodeRows,
      containerRows,
      degradedPodRows,
      degradedNodeRows,
    ]: [
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
      Array<{
        name: string;
        namespaceKey: string;
        phase: string | null;
        status: unknown;
      }>,
      Array<{
        name: string;
        isReady: boolean | null;
        hasMemoryPressure: boolean | null;
        hasDiskPressure: boolean | null;
        hasPidPressure: boolean | null;
        status: unknown;
      }>,
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
      /*
       * Top-N offenders powering the "Why is this cluster degraded?" card.
       * Failed first (hardest outage), then Pending, then Unknown, so the
       * user sees the worst stuff first without having to sort client-side.
       */
      manager.query(
        `SELECT "name", "namespaceKey", "phase", "status"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND ("phase" IS NULL OR "phase" NOT IN ('Running', 'Succeeded'))
         ORDER BY
           CASE "phase"
             WHEN 'Failed' THEN 0
             WHEN 'Pending' THEN 1
             ELSE 2
           END,
           "lastSeenAt" DESC
         LIMIT ${DEGRADED_SAMPLE_LIMIT}`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        `SELECT "name", "isReady", "hasMemoryPressure", "hasDiskPressure", "hasPidPressure", "status"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Node'
           AND "deletedAt" IS NULL
           AND (
             "isReady" IS FALSE
             OR "hasMemoryPressure" IS TRUE
             OR "hasDiskPressure" IS TRUE
             OR "hasPidPressure" IS TRUE
           )
         ORDER BY
           CASE WHEN "isReady" IS FALSE THEN 0 ELSE 1 END,
           "lastSeenAt" DESC
         LIMIT ${DEGRADED_SAMPLE_LIMIT}`,
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

    const degradedPods: Array<DegradedPod> = degradedPodRows.map(
      (row: {
        name: string;
        namespaceKey: string;
        phase: string | null;
        status: unknown;
      }) => {
        return buildDegradedPod(row);
      },
    );
    const degradedNodes: Array<DegradedNode> = degradedNodeRows.map(
      (row: {
        name: string;
        isReady: boolean | null;
        hasMemoryPressure: boolean | null;
        hasDiskPressure: boolean | null;
        hasPidPressure: boolean | null;
        status: unknown;
      }) => {
        return buildDegradedNode(row);
      },
    );

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
      degradedPods,
      degradedNodes,
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
  }): Promise<Map<string, { cpuPercent: number; memoryBytes: number }>> {
    const rows: Array<{
      namespaceKey: string;
      cpu: string | null;
      mem: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "namespaceKey",
              SUM("latestCpuPercent")::text AS cpu,
              SUM("latestMemoryBytes")::text AS mem
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

    const out: Map<string, { cpuPercent: number; memoryBytes: number }> =
      new Map();
    for (const row of rows) {
      out.set(row.namespaceKey || "", {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
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
  }): Promise<Map<string, { cpuPercent: number; memoryBytes: number }>> {
    let rows: Array<{
      ownerName: string;
      cpu: string | null;
      mem: string | null;
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
           SUM("latestMemoryBytes")::text AS mem
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
    } else {
      rows = await this.getRepository().manager.query(
        `SELECT
           (owner->>'name') AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem
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

    const out: Map<string, { cpuPercent: number; memoryBytes: number }> =
      new Map();
    for (const row of rows) {
      if (!row.ownerName) {
        continue;
      }
      out.set(row.ownerName, {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
      });
    }
    return out;
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute snapshot interval. Tune via CLEANUP_THRESHOLD_MINUTES.
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
