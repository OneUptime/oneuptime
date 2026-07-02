import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesContainer";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * KubernetesContainerService
 *
 * Inventory + latest-metric writes for container rows. Mirrors the
 * shape of KubernetesResourceService but keyed by
 * (podNamespaceKey, podName, name) since containers don't have a
 * top-level metadata.name of their own.
 *
 * Callers:
 *   - OtelLogsIngestService            -> bulkUpsert (snapshot),
 *                                         bulkDeleteByPodNaturalKeys
 *                                         (watch-mode Pod deletions)
 *   - OtelMetricsIngestService         -> bulkUpdateLatestMetrics
 *   - CleanupStaleResources worker     -> deleteStaleForCluster
 * ------------------------------------------------------------------
 */

export interface ParsedKubernetesContainer {
  podNamespaceKey: string;
  podName: string;
  name: string;
  image: string | null;
  state: string | null;
  reason: string | null;
  isReady: boolean | null;
  restartCount: number | null;
  memoryLimitBytes: number | null;
  lastSeenAt: Date;
}

export interface ContainerLatestMetric {
  podNamespaceKey: string;
  podName: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  observedAt: Date;
}

/**
 * Watch-mode DELETED tombstone for a parent Pod: identifies all of the
 * pod's container rows plus the agent-observed deletion time, used as
 * a dominance guard (lastSeenAt <= occurredAt) so a stale tombstone
 * can't wipe the containers of a pod recreated under the same name.
 */
export interface KubernetesContainerPodTombstone {
  podNamespaceKey: string;
  podName: string;
  occurredAt: Date;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 500;

const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "kubernetesClusterId",
  "podNamespaceKey",
  "podName",
  "name",
  "image",
  "state",
  "reason",
  "isReady",
  "restartCount",
  "memoryLimitBytes",
  "lastSeenAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed containers for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, clusterId,
   * podNamespaceKey, podName, name) index with a dominance guard on
   * lastSeenAt so out-of-order ingest never regresses a newer snapshot.
   *
   * Note: the upsert deliberately leaves latestCpuPercent /
   * latestMemoryBytes / metricsUpdatedAt untouched — those are owned
   * by the separate metric write path.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    containers: Array<ParsedKubernetesContainer>;
  }): Promise<void> {
    if (data.containers.length === 0) {
      return;
    }

    /*
     * Dedupe by natural key keeping the newest snapshot. Watch-mode
     * ingest can carry several envelopes for the same pod in one
     * batch, and a multi-row INSERT .. ON CONFLICT DO UPDATE errors
     * when the same conflict row would be affected twice in one
     * statement ("cannot affect row a second time").
     */
    const latestByKey: Map<string, ParsedKubernetesContainer> = new Map();
    for (const c of data.containers) {
      const key: string = `${c.podNamespaceKey} ${c.podName} ${c.name}`;
      const prev: ParsedKubernetesContainer | undefined = latestByKey.get(key);
      if (!prev || c.lastSeenAt.getTime() >= prev.lastSeenAt.getTime()) {
        latestByKey.set(key, c);
      }
    }
    const containers: Array<ParsedKubernetesContainer> = Array.from(
      latestByKey.values(),
    );

    for (let i: number = 0; i < containers.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedKubernetesContainer> = containers.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const c of chunk) {
        const placeholders: Array<string> = [];
        for (let p: number = 0; p < UPSERT_COLUMNS.length; p++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          c.podNamespaceKey,
          c.podName,
          c.name,
          c.image,
          c.state,
          c.reason,
          c.isReady,
          c.restartCount,
          c.memoryLimitBytes !== null && c.memoryLimitBytes !== undefined
            ? Math.trunc(c.memoryLimitBytes).toString()
            : null,
          c.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "KubernetesContainer" (
          "projectId", "kubernetesClusterId",
          "podNamespaceKey", "podName", "name",
          "image", "state", "reason", "isReady", "restartCount",
          "memoryLimitBytes", "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "kubernetesClusterId", "podNamespaceKey", "podName", "name")
        DO UPDATE SET
          "image" = EXCLUDED."image",
          "state" = EXCLUDED."state",
          "reason" = EXCLUDED."reason",
          "isReady" = EXCLUDED."isReady",
          "restartCount" = EXCLUDED."restartCount",
          "memoryLimitBytes" = EXCLUDED."memoryLimitBytes",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "KubernetesContainer"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete every container row belonging to a batch of tombstoned
   * Pods — the watch-mode DELETED ingest path. Containers have no FK
   * to their Pod row (they're joined by plain podNamespaceKey/podName
   * columns), so without this the Containers page keeps listing a
   * deleted pod's containers until the stale-prune cron catches up.
   * Guarded by lastSeenAt <= occurredAt, mirroring
   * KubernetesResourceService.bulkDeleteByNaturalKeys.
   */
  @CaptureSpan()
  public async bulkDeleteByPodNaturalKeys(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    pods: Array<KubernetesContainerPodTombstone>;
  }): Promise<void> {
    if (data.pods.length === 0) {
      return;
    }

    /*
     * Dedupe: one batch can carry the same DELETED envelope twice.
     * Keep the newest agent-observed time per pod so the dominance
     * guard is as permissive as the tombstones allow.
     */
    const uniqueByKey: Map<string, KubernetesContainerPodTombstone> = new Map();
    for (const p of data.pods) {
      const key: string = `${p.podNamespaceKey} ${p.podName}`;
      const prev: KubernetesContainerPodTombstone | undefined =
        uniqueByKey.get(key);
      if (!prev || p.occurredAt.getTime() > prev.occurredAt.getTime()) {
        uniqueByKey.set(key, p);
      }
    }
    const pods: Array<KubernetesContainerPodTombstone> = Array.from(
      uniqueByKey.values(),
    );

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < pods.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<KubernetesContainerPodTombstone> = pods.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const params: Array<unknown> = [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
      ];
      let paramIndex: number = 3;
      const keyFragments: Array<string> = [];
      for (const p of chunk) {
        keyFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::timestamptz)`,
        );
        params.push(p.podNamespaceKey, p.podName, p.occurredAt);
      }

      await this.getRepository().manager.query(
        `DELETE FROM "KubernetesContainer" AS k
         USING (VALUES ${keyFragments.join(", ")})
           AS v("podNamespaceKey", "podName", "occurredAt")
         WHERE k."projectId" = $1
           AND k."kubernetesClusterId" = $2
           AND k."podNamespaceKey" = v."podNamespaceKey"
           AND k."podName" = v."podName"
           AND k."lastSeenAt" <= v."occurredAt"`,
        params,
      );
    }
  }

  /**
   * Hard-delete all containers in a cluster whose last snapshot is
   * older than olderThan. Returns the number of deleted rows.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    kubernetesClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "KubernetesContainer" WHERE "kubernetesClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.kubernetesClusterId.toString(), data.olderThan],
      );

    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `KubernetesContainer cleanup deleted ${affected} stale rows for cluster ${data.kubernetesClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Update latestCpuPercent/latestMemoryBytes/metricsUpdatedAt for a
   * batch of containers. Plain UPDATE — if the snapshot row doesn't
   * exist yet, the metric write is silently skipped; the next k8s
   * snapshot creates the row and the next metric flush catches up.
   *
   * The WHERE guard ensures out-of-order metric points don't regress
   * a newer observation.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    metrics: Array<ContainerLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    /*
     * Build a single CTE-style UPDATE per chunk: VALUES table joined to
     * the live table on the natural key. Cheaper than firing one UPDATE
     * per row and atomic per chunk.
     */
    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ContainerLatestMetric> = data.metrics.slice(
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
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz)`,
        );
        params.push(
          m.podNamespaceKey,
          m.podName,
          m.name,
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "KubernetesContainer" AS k
        SET
          "latestCpuPercent" = COALESCE(v."cpu", k."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", k."latestMemoryBytes"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("ns", "pod", "name", "cpu", "mem", "observedAt")
        WHERE
          k."projectId" = $1
          AND k."kubernetesClusterId" = $2
          AND k."podNamespaceKey" = v."ns"
          AND k."podName" = v."pod"
          AND k."name" = v."name"
          AND (k."metricsUpdatedAt" IS NULL OR v."observedAt" >= k."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }
}

export default new Service();
