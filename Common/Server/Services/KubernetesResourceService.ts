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

export interface InventorySummary {
  countsByKind: Record<string, number>;
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

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

// Column order used by both bulkUpsert() and its generated parameter tuples.
// Keep this and the INSERT column list in perfect sync.
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
          "labels", "annotations", "ownerReferences", "spec", "status",
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

    const [kindRows, podRows, nodeRows]: [
      Array<{ kind: string; count: string }>,
      Array<{ phase: string | null; count: string }>,
      Array<{
        ready: string;
        notReady: string;
        memoryPressure: string;
        diskPressure: string;
        pidPressure: string;
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

    return {
      countsByKind,
      podPhaseCounts,
      nodeReadyCounts: {
        ready: parseInt(nodeRow?.ready || "0", 10) || 0,
        notReady: parseInt(nodeRow?.notReady || "0", 10) || 0,
      },
      nodePressureCounts: {
        memoryPressure:
          parseInt(nodeRow?.memoryPressure || "0", 10) || 0,
        diskPressure: parseInt(nodeRow?.diskPressure || "0", 10) || 0,
        pidPressure: parseInt(nodeRow?.pidPressure || "0", 10) || 0,
      },
    };
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
    const raw: string | undefined =
      process.env["K8S_INVENTORY_STALE_MINUTES"];
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
