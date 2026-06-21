import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DockerSwarmResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * DockerSwarmResourceService
 *
 * Writes and reads the Docker Swarm inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelLogsIngestService (bulkUpsert, from the inventory JSON-line
 *     snapshot scan — `docker node/service/task/stack/... ls` shipped
 *     by the agent's inventory poller)
 *   - OtelMetricsIngestService (bulkUpdateLatestMetrics, from the
 *     docker_stats receiver per-task CPU/memory mirror)
 *   - CleanupStaleResources worker (deleteStaleForCluster)
 *   - DockerSwarmResourceAPI / the dashboard pages (reads via the
 *     inherited DatabaseService CRUD)
 *
 * Identity/status arrives on the inventory snapshot stream; the
 * latest-metric mirror arrives on the metrics stream, so the two
 * writes happen on different flushes (unlike Proxmox, where both ride
 * the same scrape). Both COALESCE against the existing row so a stream
 * that lacks a field never blanks one another stream already filled.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedDockerSwarmResource {
  kind: string; // Node | Service | Task | Stack | Network | Secret | Config | Volume
  externalId: string; // node/<id>, service/<id>, task/<id>, stack/<name>, ...
  name: string | null;
  state: string | null;
  role: string | null; // Node: manager | worker
  serviceMode: string | null; // Service: replicated | global
  desiredReplicas: number | null;
  runningReplicas: number | null;
  image: string | null;
  stackName: string | null;
  serviceName: string | null;
  nodeHostname: string | null;
  driver: string | null;
  isReady: boolean | null;
  attributes: JSONObject | null;
  lastSeenAt: Date;
}

export interface DockerSwarmResourceLatestMetric {
  kind: string;
  externalId: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryPercent: number | null;
  observedAt: Date;
}

export interface DockerSwarmInventorySummary {
  countsByKind: Record<string, number>;
  nodeReadyCount: number;
  taskRunningCount: number;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync. The `attributes`
 * column is jsonb (ColumnType.JSON) — its placeholder is cast ::jsonb.
 */
const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "dockerSwarmClusterId",
  "kind",
  "externalId",
  "name",
  "state",
  "role",
  "serviceMode",
  "desiredReplicas",
  "runningReplicas",
  "image",
  "stackName",
  "serviceName",
  "nodeHostname",
  "driver",
  "isReady",
  "attributes",
  "lastSeenAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, dockerSwarmClusterId,
   * kind, externalId) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer snapshot.
   *
   * Identity columns COALESCE against the existing row: a snapshot is
   * usually complete, but a partial batch must not blank a field an
   * earlier batch already filled.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    dockerSwarmClusterId: ObjectID;
    resources: Array<ParsedDockerSwarmResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedDockerSwarmResource> = data.resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const r of chunk) {
        const placeholders: Array<string> = [];
        for (const col of UPSERT_COLUMNS) {
          if (col === "attributes") {
            placeholders.push(`$${paramIndex++}::jsonb`);
          } else {
            placeholders.push(`$${paramIndex++}`);
          }
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.dockerSwarmClusterId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.state,
          r.role,
          r.serviceMode,
          r.desiredReplicas !== null ? Math.trunc(r.desiredReplicas) : null,
          r.runningReplicas !== null ? Math.trunc(r.runningReplicas) : null,
          r.image,
          r.stackName,
          r.serviceName,
          r.nodeHostname,
          r.driver,
          r.isReady,
          r.attributes ? JSON.stringify(r.attributes) : null,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "DockerSwarmResource" (
          "projectId", "dockerSwarmClusterId", "kind", "externalId",
          "name", "state", "role", "serviceMode",
          "desiredReplicas", "runningReplicas", "image", "stackName",
          "serviceName", "nodeHostname", "driver", "isReady",
          "attributes", "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "dockerSwarmClusterId", "kind", "externalId")
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name", "DockerSwarmResource"."name"),
          "state" = COALESCE(EXCLUDED."state", "DockerSwarmResource"."state"),
          "role" = COALESCE(EXCLUDED."role", "DockerSwarmResource"."role"),
          "serviceMode" = COALESCE(EXCLUDED."serviceMode", "DockerSwarmResource"."serviceMode"),
          "desiredReplicas" = COALESCE(EXCLUDED."desiredReplicas", "DockerSwarmResource"."desiredReplicas"),
          "runningReplicas" = COALESCE(EXCLUDED."runningReplicas", "DockerSwarmResource"."runningReplicas"),
          "image" = COALESCE(EXCLUDED."image", "DockerSwarmResource"."image"),
          "stackName" = COALESCE(EXCLUDED."stackName", "DockerSwarmResource"."stackName"),
          "serviceName" = COALESCE(EXCLUDED."serviceName", "DockerSwarmResource"."serviceName"),
          "nodeHostname" = COALESCE(EXCLUDED."nodeHostname", "DockerSwarmResource"."nodeHostname"),
          "driver" = COALESCE(EXCLUDED."driver", "DockerSwarmResource"."driver"),
          "isReady" = COALESCE(EXCLUDED."isReady", "DockerSwarmResource"."isReady"),
          "attributes" = COALESCE(EXCLUDED."attributes", "DockerSwarmResource"."attributes"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "DockerSwarmResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Update the latest-metric mirror columns for a batch of resources
   * (Tasks and Services — the kinds that map to running containers).
   * Plain UPDATE guarded by metricsUpdatedAt so out-of-order points
   * don't regress a newer observation. COALESCE keeps the existing
   * value when a batch lacks a series.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    dockerSwarmClusterId: ObjectID;
    metrics: Array<DockerSwarmResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<DockerSwarmResourceLatestMetric> = data.metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.dockerSwarmClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::timestamptz)`,
        );
        params.push(
          m.kind,
          m.externalId,
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.maxMemoryBytes !== null && m.maxMemoryBytes !== undefined
            ? Math.trunc(m.maxMemoryBytes).toString()
            : null,
          m.memoryPercent !== null && m.memoryPercent !== undefined
            ? m.memoryPercent
            : null,
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "DockerSwarmResource" AS p
        SET
          "latestCpuPercent" = COALESCE(v."cpu", p."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", p."latestMemoryBytes"),
          "maxMemoryBytes" = COALESCE(v."maxMem", p."maxMemoryBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", p."latestMemoryPercent"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "externalId", "cpu", "mem", "maxMem", "memPct", "observedAt")
        WHERE
          p."projectId" = $1
          AND p."dockerSwarmClusterId" = $2
          AND p."kind" = v."kind"
          AND p."externalId" = v."externalId"
          AND (p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources in a cluster whose last snapshot is older
   * than olderThan. Returns the number of deleted rows. Only called by
   * the cleanup worker for clusters that are still connected — a
   * disconnected cluster keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    dockerSwarmClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "DockerSwarmResource" WHERE "dockerSwarmClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.dockerSwarmClusterId.toString(), data.olderThan],
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
        `DockerSwarmResource cleanup deleted ${affected} stale rows for cluster ${data.dockerSwarmClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the node-ready and task-running breakdowns, in a single
   * round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    dockerSwarmClusterId: ObjectID;
  }): Promise<DockerSwarmInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      readyCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE "isReady" IS TRUE)::text AS "readyCount"
       FROM "DockerSwarmResource"
       WHERE "projectId" = $1 AND "dockerSwarmClusterId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [data.projectId.toString(), data.dockerSwarmClusterId.toString()],
    );

    const countsByKind: Record<string, number> = {};
    let nodeReadyCount: number = 0;
    let taskRunningCount: number = 0;
    for (const row of rows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
      if (row.kind === "Node") {
        nodeReadyCount = parseInt(row.readyCount, 10) || 0;
      }
      if (row.kind === "Task") {
        taskRunningCount = parseInt(row.readyCount, 10) || 0;
      }
    }

    return {
      countsByKind,
      nodeReadyCount,
      taskRunningCount,
    };
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute snapshot interval by default. Tune via
   * DOCKER_SWARM_INVENTORY_STALE_MINUTES (min 5).
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
      process.env["DOCKER_SWARM_INVENTORY_STALE_MINUTES"];
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
