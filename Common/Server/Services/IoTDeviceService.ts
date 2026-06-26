import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IoTDevice";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
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

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < data.devices.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedIoTDevice> = data.devices.slice(
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

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<IoTDeviceLatestMetric> = data.metrics.slice(
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
   * Hard-delete all devices in a fleet whose last scrape is older
   * than olderThan. Returns the number of deleted rows. Only called by
   * the cleanup worker for fleets that are still connected — a
   * disconnected fleet keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForFleet(data: {
    iotFleetId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "IoTDevice" WHERE "iotFleetId" = $1 AND "lastSeenAt" < $2`,
        [data.iotFleetId.toString(), data.olderThan],
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
        `IoTDevice cleanup deleted ${affected} stale rows for fleet ${data.iotFleetId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
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
