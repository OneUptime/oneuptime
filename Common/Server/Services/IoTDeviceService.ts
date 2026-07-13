import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IoTDevice";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { clampIoTTimestamp } from "../Utils/Telemetry/IoTSnapshotScan";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * IoTDeviceService
 *
 * Writes and reads the IoT device inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelMetricsIngestService (bulkUpsert + bulkUpdateLatestMetrics,
 *     from the iot_* snapshot scan in processMetricsAsync)
 *   - CleanupStaleResources worker (deleteStaleForFleet)
 *   - IoTDeviceAPI / the dashboard pages (reads via the inherited
 *     DatabaseService CRUD)
 *
 * Identity + status and the latest-metric mirror both arrive on the
 * same metric scrape (unlike K8s, which needs a separate k8sobjects
 * log stream for identity), so both writes happen in the same flush.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedIoTDevice {
  kind: string; // Device | Sensor | Gateway
  externalId: string; // raw iot `device.id` label
  name: string | null;
  deviceType: string | null;
  firmwareVersion: string | null;
  isUp: boolean | null;
  uptimeSeconds: number | null;
  lastSeenAt: Date;
}

export interface IoTDeviceLatestMetric {
  kind: string;
  externalId: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryPercent: number | null;
  batteryPercent: number | null;
  signalStrengthDbm: number | null;
  temperatureCelsius: number | null;
  observedAt: Date;
}

export interface IoTInventorySummary {
  deviceCount: number;
  onlineDeviceCount: number;
  countsByKind: Record<string, number>;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * The identity/text columns are ShortText (100 chars). A single value
 * over the column limit fails the whole multi-row INSERT chunk it rides
 * in — truncate per value instead so one malformed device can never
 * drop the other rows of its chunk.
 */
function truncateShortText(value: string): string;
function truncateShortText(value: string | null): string | null;
function truncateShortText(value: string | null): string | null {
  if (value === null) {
    return value;
  }
  return value.length > ColumnLength.ShortText
    ? value.substring(0, ColumnLength.ShortText)
    : value;
}

/*
 * Column order used by bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "iotFleetId",
  "kind",
  "externalId",
  "name",
  "deviceType",
  "firmwareVersion",
  "isUp",
  "uptimeSeconds",
  "lastSeenAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed devices for a single (project, fleet)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, iotFleetId,
   * kind, externalId) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer snapshot.
   *
   * Identity/status columns COALESCE against the existing row (unlike
   * the K8s upsert, which overwrites): an iot-exporter batch is usually
   * a complete scrape, but a batch that happens to lack an info series
   * (e.g. only iot_device_up made it through a pipeline filter) must
   * not blank name/deviceType/firmwareVersion that an earlier batch
   * already filled.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    iotFleetId: ObjectID;
    devices: Array<ParsedIoTDevice>;
  }): Promise<void> {
    if (data.devices.length === 0) {
      return;
    }

    /*
     * Sanitize before building chunks: ShortText columns truncate to
     * the column limit (one over-long device.id must not fail the
     * whole 500-row chunk), lastSeenAt clamps so a future-skewed
     * device clock can't wedge the `>=` dominance guard, and rows that
     * collide on the conflict target after truncation dedupe to the
     * newest observation (two VALUES rows hitting the same conflict
     * target would abort the statement).
     */
    const dedupedByIdentity: Map<string, ParsedIoTDevice> = new Map();
    for (const r of data.devices) {
      const externalId: string = truncateShortText(r.externalId);
      if (!externalId) {
        continue;
      }
      if (externalId !== r.externalId) {
        logger.warn(
          `IoTDevice externalId exceeds ${ColumnLength.ShortText} chars; truncated to "${externalId}" (fleet ${data.iotFleetId.toString()}).`,
        );
      }
      const device: ParsedIoTDevice = {
        ...r,
        kind: truncateShortText(r.kind),
        externalId,
        name: truncateShortText(r.name),
        deviceType: truncateShortText(r.deviceType),
        firmwareVersion: truncateShortText(r.firmwareVersion),
        lastSeenAt: clampIoTTimestamp(r.lastSeenAt),
      };
      const key: string = `${device.kind}|${device.externalId}`;
      const existing: ParsedIoTDevice | undefined = dedupedByIdentity.get(key);
      if (!existing || device.lastSeenAt >= existing.lastSeenAt) {
        dedupedByIdentity.set(key, device);
      }
    }

    const devices: Array<ParsedIoTDevice> = Array.from(
      dedupedByIdentity.values(),
    );
    if (devices.length === 0) {
      return;
    }

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < devices.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedIoTDevice> = devices.slice(
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
          data.iotFleetId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.deviceType,
          r.firmwareVersion,
          r.isUp,
          r.uptimeSeconds !== null ? Math.trunc(r.uptimeSeconds) : null,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "IoTDevice" (
          "projectId", "iotFleetId", "kind", "externalId",
          "name", "deviceType", "firmwareVersion",
          "isUp", "uptimeSeconds",
          "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "iotFleetId", "kind", "externalId")
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name", "IoTDevice"."name"),
          "deviceType" = COALESCE(EXCLUDED."deviceType", "IoTDevice"."deviceType"),
          "firmwareVersion" = COALESCE(EXCLUDED."firmwareVersion", "IoTDevice"."firmwareVersion"),
          "isUp" = COALESCE(EXCLUDED."isUp", "IoTDevice"."isUp"),
          "uptimeSeconds" = COALESCE(EXCLUDED."uptimeSeconds", "IoTDevice"."uptimeSeconds"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "IoTDevice"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Update the latest-metric mirror columns for a batch of devices.
   * Plain UPDATE: in practice the row always exists because bulkUpsert
   * runs in the same flush; if it somehow doesn't, the write is
   * silently skipped and the next flush catches up.
   *
   * Guarded by metricsUpdatedAt so out-of-order points don't regress a
   * newer observation. COALESCE keeps the existing value when a batch
   * lacks a series — notably a battery/signal/temperature value stays
   * at its last-known reading (never 0) when a device omits that series.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    iotFleetId: ObjectID;
    metrics: Array<IoTDeviceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    /*
     * Same sanitation as bulkUpsert — and the identity truncation MUST
     * match it, or the mirror UPDATE would silently miss the row the
     * upsert just wrote under the truncated id. Dedupe keeps the UPDATE
     * deterministic when two rows collapse onto one identity.
     */
    const dedupedByIdentity: Map<string, IoTDeviceLatestMetric> = new Map();
    for (const m of data.metrics) {
      const externalId: string = truncateShortText(m.externalId);
      if (!externalId) {
        continue;
      }
      const metric: IoTDeviceLatestMetric = {
        ...m,
        kind: truncateShortText(m.kind),
        externalId,
        observedAt: clampIoTTimestamp(m.observedAt),
      };
      const key: string = `${metric.kind}|${metric.externalId}`;
      const existing: IoTDeviceLatestMetric | undefined =
        dedupedByIdentity.get(key);
      if (!existing || metric.observedAt >= existing.observedAt) {
        dedupedByIdentity.set(key, metric);
      }
    }

    const metrics: Array<IoTDeviceLatestMetric> = Array.from(
      dedupedByIdentity.values(),
    );
    if (metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<IoTDeviceLatestMetric> = metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.iotFleetId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::numeric, $${paramIndex++}::timestamptz)`,
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
          m.batteryPercent !== null && m.batteryPercent !== undefined
            ? m.batteryPercent
            : null,
          m.signalStrengthDbm !== null && m.signalStrengthDbm !== undefined
            ? m.signalStrengthDbm
            : null,
          m.temperatureCelsius !== null && m.temperatureCelsius !== undefined
            ? m.temperatureCelsius
            : null,
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "IoTDevice" AS p
        SET
          "latestCpuPercent" = COALESCE(v."cpu", p."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", p."latestMemoryBytes"),
          "maxMemoryBytes" = COALESCE(v."maxMem", p."maxMemoryBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", p."latestMemoryPercent"),
          "latestBatteryPercent" = COALESCE(v."battery", p."latestBatteryPercent"),
          "latestSignalStrengthDbm" = COALESCE(v."signal", p."latestSignalStrengthDbm"),
          "latestTemperatureCelsius" = COALESCE(v."temp", p."latestTemperatureCelsius"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "externalId", "cpu", "mem", "maxMem", "memPct", "battery", "signal", "temp", "observedAt")
        WHERE
          p."projectId" = $1
          AND p."iotFleetId" = $2
          AND p."kind" = v."kind"
          AND p."externalId" = v."externalId"
          AND (p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Age out devices in a fleet whose last scrape is older than
   * olderThan. Only called by the cleanup worker for fleets that are
   * still connected — a disconnected fleet keeps its last-known
   * inventory.
   *
   * REGISTERED devices (a matching IoTDeviceCredential row on
   * fleet + externalId, kind-agnostic) are flipped to Down instead of
   * deleted: registration marks the device as expected, so a silent
   * device must stay visible in the inventory as offline. Unregistered
   * devices are hard-deleted as before (the inventory is a projection
   * of what is actively reporting).
   *
   * The UPDATE deliberately does NOT touch lastSeenAt: reconnect
   * recovery relies on the bulkUpsert dominance guard comparing a
   * fresh scrape against the old timestamp, so the next scrape flips
   * isUp back to true automatically.
   */
  @CaptureSpan()
  public async deleteStaleForFleet(data: {
    iotFleetId: ObjectID;
    olderThan: Date;
  }): Promise<{ deleted: number; markedOffline: number }> {
    // Postgres driver returns [rows, affected] for UPDATE/DELETE — normalize.
    const affectedOf: (result: unknown) => number = (
      result: unknown,
    ): number => {
      if (Array.isArray(result) && result.length >= 2) {
        const second: unknown = (result as Array<unknown>)[1];
        if (typeof second === "number") {
          return second;
        }
      }
      return 0;
    };

    /*
     * Registered = a live credential on the same PROJECT + fleet +
     * device id (kind-agnostic — one credential covers every kind the
     * device reports). The projectId correlation is defense-in-depth
     * against a credential row that names another project's fleet.
     */
    const registeredSubquery: string = `SELECT 1 FROM "IoTDeviceCredential" c WHERE c."projectId" = "IoTDevice"."projectId" AND c."iotFleetId" = "IoTDevice"."iotFleetId" AND c."externalId" = "IoTDevice"."externalId" AND c."deletedAt" IS NULL`;

    /*
     * A device whose iot.device.kind label drifts mints a second
     * inventory row (identity is projectId+iotFleetId+kind+externalId).
     * Without this guard the stale old-kind row would be registered
     * (same externalId) and pinned as Offline forever. "Shadowed" =
     * a fresher row exists for the same (fleet, externalId) under a
     * different kind — keep only the freshest, let shadows self-heal.
     */
    const shadowedSubquery: string = `SELECT 1 FROM "IoTDevice" d2 WHERE d2."iotFleetId" = "IoTDevice"."iotFleetId" AND d2."externalId" = "IoTDevice"."externalId" AND d2."kind" <> "IoTDevice"."kind" AND d2."lastSeenAt" > "IoTDevice"."lastSeenAt" AND d2."deletedAt" IS NULL`;

    const params: Array<unknown> = [data.iotFleetId.toString(), data.olderThan];

    const updateResult: unknown = await this.getRepository().manager.query(
      `UPDATE "IoTDevice" SET "isUp" = false, "updatedAt" = now() WHERE "iotFleetId" = $1 AND "lastSeenAt" < $2 AND "isUp" IS DISTINCT FROM false AND EXISTS (${registeredSubquery}) AND NOT EXISTS (${shadowedSubquery})`,
      params,
    );

    const deleteResult: unknown = await this.getRepository().manager.query(
      `DELETE FROM "IoTDevice" WHERE "iotFleetId" = $1 AND "lastSeenAt" < $2 AND (NOT EXISTS (${registeredSubquery}) OR EXISTS (${shadowedSubquery}))`,
      params,
    );

    const deleted: number = affectedOf(deleteResult);
    const markedOffline: number = affectedOf(updateResult);

    if (deleted > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `IoTDevice cleanup deleted ${deleted} stale rows for fleet ${data.iotFleetId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return { deleted, markedOffline };
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the total and online device breakdowns, in a single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    iotFleetId: ObjectID;
  }): Promise<IoTInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      upCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE "isUp" IS TRUE)::text AS "upCount"
       FROM "IoTDevice"
       WHERE "projectId" = $1 AND "iotFleetId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [data.projectId.toString(), data.iotFleetId.toString()],
    );

    const countsByKind: Record<string, number> = {};
    let deviceCount: number = 0;
    let onlineDeviceCount: number = 0;
    for (const row of rows) {
      const count: number = parseInt(row.count, 10) || 0;
      const upCount: number = parseInt(row.upCount, 10) || 0;
      countsByKind[row.kind] = count;
      deviceCount += count;
      onlineDeviceCount += upCount;
    }

    return {
      deviceCount,
      onlineDeviceCount,
      countsByKind,
    };
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute scrape interval by default. Tune via
   * IOT_INVENTORY_STALE_MINUTES (min 5).
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["IOT_INVENTORY_STALE_MINUTES"];
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
