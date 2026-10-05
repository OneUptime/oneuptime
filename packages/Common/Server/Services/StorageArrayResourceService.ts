import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StorageArrayResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import StorageArrayResourceKind from "../../Types/StorageArray/StorageArrayResourceKind";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * StorageArrayResourceService
 *
 * Writes and reads the storage array inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelMetricsIngestService (bulkUpsert, from the purefa_* / purefb_*
 *     snapshot scan in processMetricsAsync — StorageArraySnapshotScan)
 *   - CleanupStaleResources worker (deleteStaleForArray)
 *   - StorageArrayResourceAPI / the dashboard pages (reads via the
 *     inherited DatabaseService CRUD)
 *
 * Unlike CephResource there is no separate identity and metric write:
 * every object's identity, status and latest values arrive in the same
 * scrape of the same endpoint (a FlashArray volume's space AND performance
 * series both come from /metrics/volumes), so one upsert carries them all.
 * Every rate is a gauge the array already computes per second.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedStorageArrayResource {
  kind: string; // StorageArrayResourceKind
  externalId: string; // the object's name as the array reports it
  name: string | null;
  status: string | null;
  statusDetail: string | null;
  componentType: string | null;
  model: string | null;
  firmwareVersion: string | null;
  groupName: string | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  dataReductionRatio: number | null;
  readLatencyUsec: number | null;
  writeLatencyUsec: number | null;
  readIops: number | null;
  writeIops: number | null;
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  temperatureCelsius: number | null;
  replicationLagMs: number | null;
  connectionCount: number | null;
  details: JSONObject | null;
  lastSeenAt: Date;
}

export interface StorageArrayInventorySummary {
  countsByKind: Record<string, number>;
  // Hardware components, drives and controllers in a bad state.
  unhealthyHardwareCount: number;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 500;

/*
 * The kinds whose agent scrape interval is long: the shipped FlashArray
 * config scrapes /metrics/directories every 30 minutes (directory space is
 * expensive for the array to compute), so a directory must not count as
 * stale after the default 15 minutes.
 */
const SLOW_SCRAPE_KINDS: Array<string> = [StorageArrayResourceKind.Directory];
const SLOW_SCRAPE_STALE_MINUTES: number = 90;

/*
 * Statuses that mean a hardware component, drive or controller needs a
 * person: critical / degraded / unknown hardware (purefa_hw_component_status),
 * failed / missing / unhealthy / unrecognized drives
 * (purefa_drive_capacity_bytes), controllers that are not ready, and
 * FlashBlade components reporting unhealthy (purefb_hardware_health = 0).
 * not_installed, device_off, identifying, empty, healthy and ok are fine.
 */
export const UNHEALTHY_HARDWARE_STATUSES: Array<string> = [
  "critical",
  "degraded",
  "unknown",
  "failed",
  "missing",
  "unhealthy",
  "unrecognized",
  "not ready",
];

export const CRITICAL_HARDWARE_STATUSES: Array<string> = [
  "critical",
  "failed",
  "missing",
];

/*
 * Order of the columns bulkUpsert() writes, and of the parameter tuples it
 * generates. Keep this, the INSERT column list and the casts in perfect sync.
 */
const UPSERT_COLUMNS: Array<{ name: string; cast: string }> = [
  { name: "projectId", cast: "uuid" },
  { name: "storageArrayId", cast: "uuid" },
  { name: "kind", cast: "text" },
  { name: "externalId", cast: "text" },
  { name: "name", cast: "text" },
  { name: "status", cast: "text" },
  { name: "statusDetail", cast: "text" },
  { name: "componentType", cast: "text" },
  { name: "model", cast: "text" },
  { name: "firmwareVersion", cast: "text" },
  { name: "groupName", cast: "text" },
  { name: "capacityBytes", cast: "bigint" },
  { name: "usedBytes", cast: "bigint" },
  { name: "dataReductionRatio", cast: "numeric" },
  { name: "readLatencyUsec", cast: "numeric" },
  { name: "writeLatencyUsec", cast: "numeric" },
  { name: "readIops", cast: "numeric" },
  { name: "writeIops", cast: "numeric" },
  { name: "readBytesPerSec", cast: "numeric" },
  { name: "writeBytesPerSec", cast: "numeric" },
  { name: "temperatureCelsius", cast: "numeric" },
  { name: "replicationLagMs", cast: "numeric" },
  { name: "connectionCount", cast: "integer" },
  { name: "details", cast: "jsonb" },
  { name: "metricsUpdatedAt", cast: "timestamptz" },
  { name: "lastSeenAt", cast: "timestamptz" },
  { name: "version", cast: "integer" },
];

// Columns that keep the existing value when a scrape does not carry them.
const COALESCED_COLUMNS: Array<string> = UPSERT_COLUMNS.map(
  (c: { name: string }) => {
    return c.name;
  },
).filter((name: string) => {
  return ![
    "projectId",
    "storageArrayId",
    "kind",
    "externalId",
    "lastSeenAt",
    "version",
  ].includes(name);
});

/*
 * The bulk path below goes through manager.query(), which skips the length
 * validation DatabaseService applies to ordinary writes, so a single
 * oversized value would abort the whole 500-row INSERT chunk it rides in.
 * Clamp per value instead, so one pathological volume name can never drop
 * the rest of the scrape. The identity clamps here are the only ones, so
 * a truncated externalId stays stable from scrape to scrape.
 */
function sanitizeResource(
  r: ParsedStorageArrayResource,
): ParsedStorageArrayResource {
  return {
    ...r,
    kind: truncateShortText(r.kind),
    externalId: truncateLongText(r.externalId),
    name: truncateLongText(r.name),
    status: truncateShortText(r.status),
    statusDetail: truncateShortText(r.statusDetail),
    componentType: truncateShortText(r.componentType),
    model: truncateShortText(r.model),
    firmwareVersion: truncateShortText(r.firmwareVersion),
    groupName: truncateLongText(r.groupName),
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !isFinite(value)) {
    return null;
  }
  return value;
}

function bigintOrNull(value: number | null | undefined): string | null {
  const finite: number | null = finiteOrNull(value);
  if (finite === null || finite < 0) {
    return null;
  }
  return Math.trunc(finite).toString();
}

function hasAnyMetric(r: ParsedStorageArrayResource): boolean {
  return [
    r.capacityBytes,
    r.usedBytes,
    r.dataReductionRatio,
    r.readLatencyUsec,
    r.writeLatencyUsec,
    r.readIops,
    r.writeIops,
    r.readBytesPerSec,
    r.writeBytesPerSec,
    r.temperatureCelsius,
    r.replicationLagMs,
  ].some((v: number | null) => {
    return finiteOrNull(v) !== null;
  });
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, array) pair.
   * Uses ON CONFLICT on the UNIQUE (projectId, storageArrayId, kind,
   * externalId) index with a dominance guard on lastSeenAt so out-of-order
   * ingest never regresses a newer snapshot.
   *
   * Every non-identity column COALESCEs against the existing row: a volume
   * scrape that lacks the QoS or space series (a metric_relabel_configs
   * filter on the agent, an older Purity) must not blank values an earlier
   * scrape already filled.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    storageArrayId: ObjectID;
    resources: Array<ParsedStorageArrayResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedStorageArrayResource> = data.resources.map(
      (r: ParsedStorageArrayResource) => {
        const sanitized: ParsedStorageArrayResource = sanitizeResource(r);
        if (sanitized.externalId !== r.externalId) {
          logger.warn(
            `StorageArrayResource externalId exceeds ${ColumnLength.LongText} chars; truncated to "${sanitized.externalId}" (storage array ${data.storageArrayId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedStorageArrayResource> = resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const r of chunk) {
        const placeholders: Array<string> = [];
        for (const column of UPSERT_COLUMNS) {
          placeholders.push(`$${paramIndex++}::${column.cast}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.storageArrayId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.status,
          r.statusDetail,
          r.componentType,
          r.model,
          r.firmwareVersion,
          r.groupName,
          bigintOrNull(r.capacityBytes),
          bigintOrNull(r.usedBytes),
          finiteOrNull(r.dataReductionRatio),
          finiteOrNull(r.readLatencyUsec),
          finiteOrNull(r.writeLatencyUsec),
          finiteOrNull(r.readIops),
          finiteOrNull(r.writeIops),
          finiteOrNull(r.readBytesPerSec),
          finiteOrNull(r.writeBytesPerSec),
          finiteOrNull(r.temperatureCelsius),
          finiteOrNull(r.replicationLagMs),
          r.connectionCount === null || r.connectionCount === undefined
            ? null
            : Math.trunc(r.connectionCount),
          r.details && Object.keys(r.details).length > 0
            ? JSON.stringify(r.details)
            : null,
          hasAnyMetric(r) ? r.lastSeenAt : null,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const columnList: string = UPSERT_COLUMNS.map((c: { name: string }) => {
        return `"${c.name}"`;
      }).join(", ");

      const updateList: string = COALESCED_COLUMNS.map((name: string) => {
        return `"${name}" = COALESCE(EXCLUDED."${name}", "StorageArrayResource"."${name}")`;
      }).join(",\n          ");

      const sql: string = `
        INSERT INTO "StorageArrayResource" (${columnList})
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "storageArrayId", "kind", "externalId")
        DO UPDATE SET
          ${updateList},
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "StorageArrayResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete every resource of an array whose last scrape is older than
   * its kind's threshold. Returns the number of deleted rows. Only called by
   * the cleanup worker for arrays that are still connected — a disconnected
   * array keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForArray(data: {
    storageArrayId: ObjectID;
    olderThan: Date;
    slowScrapeOlderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "StorageArrayResource"
         WHERE "storageArrayId" = $1
           AND (
             ("kind" <> ALL($4::text[]) AND "lastSeenAt" < $2)
             OR ("kind" = ANY($4::text[]) AND "lastSeenAt" < $3)
           )`,
        [
          data.storageArrayId.toString(),
          data.olderThan,
          data.slowScrapeOlderThan,
          SLOW_SCRAPE_KINDS,
        ],
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
        `StorageArrayResource cleanup deleted ${affected} stale rows for storage array ${data.storageArrayId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind plus
   * the unhealthy hardware count, in a single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    storageArrayId: ObjectID;
  }): Promise<StorageArrayInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      unhealthyCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE lower("status") = ANY($3::text[]))::text AS "unhealthyCount"
       FROM "StorageArrayResource"
       WHERE "projectId" = $1 AND "storageArrayId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [
        data.projectId.toString(),
        data.storageArrayId.toString(),
        UNHEALTHY_HARDWARE_STATUSES,
      ],
    );

    const countsByKind: Record<string, number> = {};
    let unhealthyHardwareCount: number = 0;
    for (const row of rows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
      if (
        row.kind === StorageArrayResourceKind.Hardware ||
        row.kind === StorageArrayResourceKind.Drive ||
        row.kind === StorageArrayResourceKind.Controller
      ) {
        unhealthyHardwareCount += parseInt(row.unhealthyCount, 10) || 0;
      }
    }

    return {
      countsByKind,
      unhealthyHardwareCount,
    };
  }

  /**
   * Cutoffs for the cleanup worker: 3x the agent's slowest regular scrape
   * interval (volumes, hosts and pods: 2 minutes; the array: 1 minute;
   * FlashBlade file systems and buckets: 5 minutes) by default, tunable via
   * STORAGE_ARRAY_INVENTORY_STALE_MINUTES (min 5). Directories, scraped
   * every 30 minutes, use their own 90-minute cutoff.
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -this.getStaleThresholdMinutes(),
    );
  }

  public getSlowScrapeStaleThresholdDate(nowOverride?: Date): Date {
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -Math.max(SLOW_SCRAPE_STALE_MINUTES, this.getStaleThresholdMinutes()),
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined =
      process.env["STORAGE_ARRAY_INVENTORY_STALE_MINUTES"];
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
