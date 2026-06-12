import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CephResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * CephResourceService
 *
 * Writes and reads the Ceph inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelMetricsIngestService (bulkUpsert + bulkUpdateLatestMetrics,
 *     from the ceph_* snapshot scan in processMetricsAsync)
 *   - CleanupStaleResources worker (deleteStaleForCluster)
 *   - CephResourceAPI / the dashboard pages (reads via the inherited
 *     DatabaseService CRUD)
 *
 * Identity + status and the latest-metric mirror both arrive on the
 * same ceph-mgr scrape, so both writes happen in the same flush.
 *
 * readOpsCounter / writeOpsCounter store the latest RAW cumulative
 * ceph_pool_rd / ceph_pool_wr values — rates ("IOPS") are computed on
 * read from ClickHouse, never from these columns.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedCephResource {
  kind: string; // Osd | Pool | Mon | Mgr | Mds | Rgw
  externalId: string; // ceph_daemon (osd.3, mon.a, ...) or pool_id
  name: string | null; // pool name (Pool kind only)
  hostname: string | null;
  daemonVersion: string | null;
  deviceClass: string | null;
  isUp: boolean | null;
  isIn: boolean | null;
  inQuorum: boolean | null;
  lastSeenAt: Date;
}

export interface CephResourceLatestMetric {
  kind: string;
  externalId: string;
  statBytes: number | null;
  statBytesUsed: number | null;
  applyLatencyMs: number | null;
  commitLatencyMs: number | null;
  pgCount: number | null;
  storedBytes: number | null;
  maxAvailBytes: number | null;
  objects: number | null;
  readOpsCounter: number | null;
  writeOpsCounter: number | null;
  observedAt: Date;
}

export interface CephInventorySummary {
  countsByKind: Record<string, number>;
  osdUpCount: number;
  osdInCount: number;
  monInQuorumCount: number;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "cephClusterId",
  "kind",
  "externalId",
  "name",
  "hostname",
  "daemonVersion",
  "deviceClass",
  "isUp",
  "isIn",
  "inQuorum",
  "lastSeenAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, cephClusterId,
   * kind, externalId) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer snapshot.
   *
   * Identity/status columns COALESCE against the existing row: a
   * ceph-mgr batch is usually a complete scrape, but a batch that
   * happens to lack a *_metadata series must not blank
   * hostname/deviceClass/daemonVersion an earlier batch already filled.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    cephClusterId: ObjectID;
    resources: Array<ParsedCephResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < data.resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedCephResource> = data.resources.slice(
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
          data.cephClusterId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.hostname,
          r.daemonVersion,
          r.deviceClass,
          r.isUp,
          r.isIn,
          r.inQuorum,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "CephResource" (
          "projectId", "cephClusterId", "kind", "externalId",
          "name", "hostname", "daemonVersion", "deviceClass",
          "isUp", "isIn", "inQuorum",
          "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "cephClusterId", "kind", "externalId")
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name", "CephResource"."name"),
          "hostname" = COALESCE(EXCLUDED."hostname", "CephResource"."hostname"),
          "daemonVersion" = COALESCE(EXCLUDED."daemonVersion", "CephResource"."daemonVersion"),
          "deviceClass" = COALESCE(EXCLUDED."deviceClass", "CephResource"."deviceClass"),
          "isUp" = COALESCE(EXCLUDED."isUp", "CephResource"."isUp"),
          "isIn" = COALESCE(EXCLUDED."isIn", "CephResource"."isIn"),
          "inQuorum" = COALESCE(EXCLUDED."inQuorum", "CephResource"."inQuorum"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "CephResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Update the latest-metric mirror columns for a batch of resources.
   * Plain UPDATE: in practice the row always exists because bulkUpsert
   * runs in the same flush; if it somehow doesn't, the write is
   * silently skipped and the next flush catches up.
   *
   * Guarded by metricsUpdatedAt so out-of-order points don't regress a
   * newer observation; COALESCE keeps the existing value when a batch
   * lacks a series.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    cephClusterId: ObjectID;
    metrics: Array<CephResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<CephResourceLatestMetric> = data.metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.cephClusterId.toString(),
      ];
      let paramIndex: number = 3;

      const bigintOrNull: (value: number | null) => string | null = (
        value: number | null,
      ) => {
        return value !== null && value !== undefined
          ? Math.trunc(value).toString()
          : null;
      };

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::integer, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz)`,
        );
        params.push(
          m.kind,
          m.externalId,
          bigintOrNull(m.statBytes),
          bigintOrNull(m.statBytesUsed),
          m.applyLatencyMs !== null && m.applyLatencyMs !== undefined
            ? m.applyLatencyMs
            : null,
          m.commitLatencyMs !== null && m.commitLatencyMs !== undefined
            ? m.commitLatencyMs
            : null,
          m.pgCount !== null && m.pgCount !== undefined
            ? Math.trunc(m.pgCount)
            : null,
          bigintOrNull(m.storedBytes),
          bigintOrNull(m.maxAvailBytes),
          bigintOrNull(m.objects),
          bigintOrNull(m.readOpsCounter),
          bigintOrNull(m.writeOpsCounter),
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "CephResource" AS c
        SET
          "statBytes" = COALESCE(v."statBytes", c."statBytes"),
          "statBytesUsed" = COALESCE(v."statBytesUsed", c."statBytesUsed"),
          "applyLatencyMs" = COALESCE(v."applyLatencyMs", c."applyLatencyMs"),
          "commitLatencyMs" = COALESCE(v."commitLatencyMs", c."commitLatencyMs"),
          "pgCount" = COALESCE(v."pgCount", c."pgCount"),
          "storedBytes" = COALESCE(v."storedBytes", c."storedBytes"),
          "maxAvailBytes" = COALESCE(v."maxAvailBytes", c."maxAvailBytes"),
          "objects" = COALESCE(v."objects", c."objects"),
          "readOpsCounter" = COALESCE(v."readOpsCounter", c."readOpsCounter"),
          "writeOpsCounter" = COALESCE(v."writeOpsCounter", c."writeOpsCounter"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "externalId", "statBytes", "statBytesUsed", "applyLatencyMs", "commitLatencyMs", "pgCount", "storedBytes", "maxAvailBytes", "objects", "readOpsCounter", "writeOpsCounter", "observedAt")
        WHERE
          c."projectId" = $1
          AND c."cephClusterId" = $2
          AND c."kind" = v."kind"
          AND c."externalId" = v."externalId"
          AND (c."metricsUpdatedAt" IS NULL OR v."observedAt" >= c."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources in a cluster whose last scrape is older
   * than olderThan. Returns the number of deleted rows. Only called by
   * the cleanup worker for clusters that are still connected — a
   * disconnected cluster keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    cephClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "CephResource" WHERE "cephClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.cephClusterId.toString(), data.olderThan],
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
        `CephResource cleanup deleted ${affected} stale rows for cluster ${data.cephClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the up/in/quorum breakdowns, in a single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    cephClusterId: ObjectID;
  }): Promise<CephInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      upCount: string;
      inCount: string;
      quorumCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE "isUp" IS TRUE)::text AS "upCount",
              COUNT(*) FILTER (WHERE "isIn" IS TRUE)::text AS "inCount",
              COUNT(*) FILTER (WHERE "inQuorum" IS TRUE)::text AS "quorumCount"
       FROM "CephResource"
       WHERE "projectId" = $1 AND "cephClusterId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [data.projectId.toString(), data.cephClusterId.toString()],
    );

    const countsByKind: Record<string, number> = {};
    let osdUpCount: number = 0;
    let osdInCount: number = 0;
    let monInQuorumCount: number = 0;
    for (const row of rows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
      if (row.kind === "Osd") {
        osdUpCount = parseInt(row.upCount, 10) || 0;
        osdInCount = parseInt(row.inCount, 10) || 0;
      }
      if (row.kind === "Mon") {
        monInQuorumCount = parseInt(row.quorumCount, 10) || 0;
      }
    }

    return {
      countsByKind,
      osdUpCount,
      osdInCount,
      monInQuorumCount,
    };
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute scrape interval by default. Tune via
   * CEPH_INVENTORY_STALE_MINUTES (min 5).
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["CEPH_INVENTORY_STALE_MINUTES"];
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
