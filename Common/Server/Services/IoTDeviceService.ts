import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IoTDevice";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import IoTDeviceState from "../../Types/IoT/IoTDeviceState";
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
 *   - CleanupStaleResources worker (markStaleForFleet /
 *     retireStaleForFleet — lifecycle transitions, never deletes)
 *   - CheckDeviceHeartbeats worker (findDevicesGoneSilent /
 *     findSilentDownDevices — silence-based offline detection)
 *   - IoTDeviceAPI / the dashboard pages (reads via the inherited
 *     DatabaseService CRUD)
 *
 * Identity + status and the latest-metric mirror both arrive on the
 * same metric scrape (unlike K8s, which needs a separate k8sobjects
 * log stream for identity), so both writes happen in the same flush.
 *
 * Lifecycle: rows walk Online -> Offline -> Stale -> Retired (see
 * IoTDeviceState) instead of being hard-deleted on staleness. The
 * upsert computes the Online/Offline half from the reported
 * iot_device_up; the workers own the Stale/Retired half. Any fresh
 * datapoint moves a device straight back to Online/Offline inside the
 * upsert SQL, so recovery needs no worker involvement.
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

/*
 * A device the heartbeat sweep considers silent: no data for 3x its
 * effective check-in interval. Carries enough identity to flip state
 * through the hooked update path and to synthesize an
 * iot_device_up = 0 datapoint that groups into the same series as the
 * device's real data.
 */
export interface SilentIoTDevice {
  id: ObjectID;
  kind: string;
  externalId: string;
  deviceType: string | null;
  firmwareVersion: string | null;
  state: string;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_TRANSITION_WARN_THRESHOLD: number = 100;

/*
 * Silence-based offline detection trips at GRACE_FACTOR x the expected
 * check-in interval (floored at MIN_SILENCE_SECONDS) — one missed
 * scrape is jitter, three is an outage. Shared by the SQL below and
 * the CheckDeviceHeartbeats worker.
 */
export const IOT_SILENCE_GRACE_FACTOR: number = 3;
export const IOT_MIN_SILENCE_SECONDS: number = 60;

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
  "state",
  "stateChangedAt",
  "version",
];

/*
 * The Online/Offline half of the lifecycle, computed from the
 * post-merge isUp inside the upsert. Inlined as SQL literals (enum
 * values, not user input). Kept as a fragment so the CASE in the
 * SET list and the CASE inside the stateChangedAt comparison can
 * never drift apart.
 */
const UPSERT_STATE_CASE_SQL: string = `CASE
  WHEN COALESCE(EXCLUDED."isUp", "IoTDevice"."isUp") IS FALSE THEN '${IoTDeviceState.Offline}'
  ELSE '${IoTDeviceState.Online}'
END`;

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
          // Fresh insert: state derives from this scrape's isUp alone.
          r.isUp === false ? IoTDeviceState.Offline : IoTDeviceState.Online,
          r.lastSeenAt, // stateChangedAt (first observation)
          0, // version (BaseModel @VersionColumn)
        );
      }

      /*
       * On conflict the row just reported, so state snaps back to the
       * Online/Offline half of the lifecycle no matter where the
       * workers had walked it (Stale/Retired) — recovery is automatic.
       * stateChangedAt only advances when the state actually flips.
       */
      const sql: string = `
        INSERT INTO "IoTDevice" (
          "projectId", "iotFleetId", "kind", "externalId",
          "name", "deviceType", "firmwareVersion",
          "isUp", "uptimeSeconds",
          "lastSeenAt", "state", "stateChangedAt", "version"
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
          "state" = ${UPSERT_STATE_CASE_SQL},
          "stateChangedAt" = CASE
            WHEN (${UPSERT_STATE_CASE_SQL}) IS DISTINCT FROM "IoTDevice"."state"
            THEN EXCLUDED."lastSeenAt"
            ELSE "IoTDevice"."stateChangedAt"
          END,
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
   * Walk devices in a fleet that have been silent past their
   * EFFECTIVE stale cutoff to Stale. Returns the number of
   * transitioned rows. Only called by the cleanup worker for fleets
   * that are still connected — a disconnected fleet keeps its
   * last-known inventory states (the fleet-level Disconnected status
   * covers the blackout).
   *
   * The cutoff is per-device, not fleet-wide: a device with an
   * expected check-in interval only goes Stale after
   * GREATEST(grace x interval, stale threshold) of silence, so a
   * healthy hourly reporter is never walked to Stale mid-gap (it
   * would otherwise flap Online -> Stale -> Online every reporting
   * cycle and drop out of the online counts). Because the Stale
   * cutoff is always >= the silence cutoff, the heartbeat sweep's
   * hooked Online -> Offline flip fires before this walk can touch a
   * detection-enabled device.
   *
   * Raw SQL (unhooked) is deliberate: Stale is a bookkeeping state,
   * not an alerting event — the alerting transition is Online ->
   * Offline, which the heartbeat sweep routes through the hooked
   * update path.
   */
  @CaptureSpan()
  public async markStaleForFleet(data: {
    iotFleetId: ObjectID;
    anchor: Date;
    fleetDefaultCheckinIntervalSeconds: number | null;
  }): Promise<number> {
    const staleSeconds: number = this.getStaleThresholdMinutes() * 60;

    const affected: number = await this.runStateTransition({
      sql: `UPDATE "IoTDevice"
            SET "state" = $3, "stateChangedAt" = now(), "updatedAt" = now()
            WHERE "iotFleetId" = $1
              AND "lastSeenAt" < ($2::timestamptz - make_interval(secs =>
                    GREATEST(
                      ${IOT_SILENCE_GRACE_FACTOR} * COALESCE("expectedCheckinIntervalSeconds", $6, 0),
                      ${staleSeconds}
                    )))
              AND "state" IN ($4, $5)`,
      params: [
        data.iotFleetId.toString(),
        data.anchor,
        IoTDeviceState.Stale,
        IoTDeviceState.Online,
        IoTDeviceState.Offline,
        data.fleetDefaultCheckinIntervalSeconds,
      ],
    });

    if (affected > STALE_TRANSITION_WARN_THRESHOLD) {
      logger.warn(
        `IoTDevice cleanup marked ${affected} rows Stale for fleet ${data.iotFleetId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Walk devices silent past the retirement threshold to Retired —
   * across ALL fleets in one statement (the cutoff is wall-clock and
   * identical everywhere, so there is no reason to loop fleets).
   * Retired rows are kept for history but drop out of fleet counts
   * and default lists. Includes disconnected fleets: 30 days of
   * silence is a decommissioned device either way.
   */
  @CaptureSpan()
  public async retireStaleDevices(data: { olderThan: Date }): Promise<number> {
    return this.runStateTransition({
      sql: `UPDATE "IoTDevice"
            SET "state" = $2, "stateChangedAt" = now(), "updatedAt" = now()
            WHERE "lastSeenAt" < $1
              AND ("state" IS NULL OR "state" != $2)`,
      params: [data.olderThan, IoTDeviceState.Retired],
    });
  }

  private async runStateTransition(data: {
    sql: string;
    params: Array<unknown>;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(data.sql, data.params);

    // Postgres driver returns [rows, affected] for UPDATE — normalize.
    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }
    return affected;
  }

  /**
   * Devices that just went silent: still Online, but no data for
   * IOT_SILENCE_GRACE_FACTOR x their effective check-in interval
   * (per-device override, else the fleet default passed in). These
   * are the rows the heartbeat sweep flips to Offline through the
   * hooked update path so downstream automation fires.
   */
  @CaptureSpan()
  public async findDevicesGoneSilent(data: {
    iotFleetId: ObjectID;
    fleetDefaultCheckinIntervalSeconds: number | null;
    now: Date;
    limit: number;
  }): Promise<Array<SilentIoTDevice>> {
    return this.querySilentDevices({
      ...data,
      states: [IoTDeviceState.Online],
    });
  }

  /**
   * Devices currently down by silence (already flipped Offline, or
   * walked to Stale while still silent). The heartbeat sweep emits a
   * synthetic iot_device_up = 0 datapoint for each every tick so the
   * offline monitors keep seeing the outage until real data returns —
   * without this, an empty rolling window would auto-resolve the
   * incident while the device is still dark.
   */
  @CaptureSpan()
  public async findSilentDownDevices(data: {
    iotFleetId: ObjectID;
    fleetDefaultCheckinIntervalSeconds: number | null;
    now: Date;
    limit: number;
  }): Promise<Array<SilentIoTDevice>> {
    return this.querySilentDevices({
      ...data,
      states: [IoTDeviceState.Offline, IoTDeviceState.Stale],
    });
  }

  private async querySilentDevices(data: {
    iotFleetId: ObjectID;
    fleetDefaultCheckinIntervalSeconds: number | null;
    now: Date;
    limit: number;
    states: Array<IoTDeviceState>;
  }): Promise<Array<SilentIoTDevice>> {
    const statePlaceholders: Array<string> = data.states.map(
      (_state: IoTDeviceState, index: number) => {
        return `$${5 + index}`;
      },
    );

    const rows: Array<{
      _id: string;
      kind: string;
      externalId: string;
      deviceType: string | null;
      firmwareVersion: string | null;
      state: string;
    }> = await this.getRepository().manager.query(
      `SELECT "_id", "kind", "externalId", "deviceType", "firmwareVersion", "state"
       FROM "IoTDevice"
       WHERE "iotFleetId" = $1
         AND "isArchived" IS NOT TRUE
         AND COALESCE("expectedCheckinIntervalSeconds", $2) IS NOT NULL
         AND "lastSeenAt" < ($3::timestamptz - make_interval(secs =>
               GREATEST(
                 ${IOT_SILENCE_GRACE_FACTOR} * COALESCE("expectedCheckinIntervalSeconds", $2),
                 ${IOT_MIN_SILENCE_SECONDS}
               )))
         AND "state" IN (${statePlaceholders.join(", ")})
       ORDER BY "lastSeenAt" ASC
       LIMIT $4`,
      [
        data.iotFleetId.toString(),
        data.fleetDefaultCheckinIntervalSeconds,
        data.now,
        data.limit,
        ...data.states,
      ],
    );

    return rows.map(
      (row: {
        _id: string;
        kind: string;
        externalId: string;
        deviceType: string | null;
        firmwareVersion: string | null;
        state: string;
      }): SilentIoTDevice => {
        return {
          id: new ObjectID(row._id),
          kind: row.kind,
          externalId: row.externalId,
          deviceType: row.deviceType,
          firmwareVersion: row.firmwareVersion,
          state: row.state,
        };
      },
    );
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the total and online device breakdowns, in a single round-trip.
   *
   * Retired and archived devices are excluded — they are history, not
   * fleet capacity. "Online" means lifecycle-Online: a device that is
   * Stale (silent past the threshold) no longer counts as up even
   * though its last reported isUp was true. Legacy NULL states (rows
   * predating the lifecycle migration) count as present and fall back
   * to isUp for the online check.
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
              COUNT(*) FILTER (
                WHERE ("state" = $3 OR ("state" IS NULL AND "isUp" IS TRUE))
              )::text AS "upCount"
       FROM "IoTDevice"
       WHERE "projectId" = $1 AND "iotFleetId" = $2 AND "deletedAt" IS NULL
         AND ("state" IS NULL OR "state" != $4)
         AND "isArchived" IS NOT TRUE
       GROUP BY "kind"`,
      [
        data.projectId.toString(),
        data.iotFleetId.toString(),
        IoTDeviceState.Online,
        IoTDeviceState.Retired,
      ],
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

  /**
   * Retirement cutoff for the cleanup worker. Devices silent past
   * this walk to Retired (kept for history, dropped from counts).
   * Tune via IOT_INVENTORY_RETIRE_DAYS (min 1, default 30).
   */
  public getRetireThresholdDate(nowOverride?: Date): Date {
    const days: number = this.getRetireThresholdDays();
    return OneUptimeDate.addRemoveDays(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -days,
    );
  }

  public getRetireThresholdDays(): number {
    const raw: string | undefined = process.env["IOT_INVENTORY_RETIRE_DAYS"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        return parsed;
      }
    }
    return 30;
  }
}

export default new Service();
