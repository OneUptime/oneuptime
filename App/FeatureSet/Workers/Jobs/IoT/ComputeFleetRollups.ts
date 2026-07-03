import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTDeviceService, {
  IoTFleetRollupStats,
} from "Common/Server/Services/IoTDeviceService";
import MetricService from "Common/Server/Services/MetricService";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import { buildFleetRollupMetricRows } from "Common/Server/Utils/Telemetry/IoTSnapshotScan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";

/*
 * ------------------------------------------------------------------
 * IoT:ComputeFleetRollups
 *
 * Runs every minute. For every non-archived fleet:
 *
 *   1. Compute fleet rollup stats from the FULL Postgres inventory
 *      (IoTDeviceService.getFleetRollupStats) — lifecycle counts,
 *      fresh battery percentiles, fresh weak-signal count.
 *   2. Write IoTFleet.deviceCount / onlineDeviceCount when they
 *      changed. This worker is the single owner of the count columns:
 *      the ingest path no longer writes batch-derived counts, because
 *      one OTLP batch is whatever slice of the fleet a single gateway
 *      shipped (multi-gateway fleets showed whichever partial batch
 *      flushed last). Unhooked single-column write — counts are
 *      bookkeeping, not events.
 *   3. Emit the iot_fleet_* rollup series into the metrics pipeline
 *      (lean rows, same shape as recording-rule outputs): chartable
 *      on the fleet Metrics page and alertable via fleet-scope
 *      monitors ("more than 10% of the fleet is offline"), feeding
 *      the Fleet Health templates.
 *
 * DISCONNECTED fleets are included deliberately, with the online
 * numbers OVERRIDDEN TO ZERO: device lifecycle states freeze during a
 * blackout (the stale walk is anchored to the frozen fleet clock and
 * the heartbeat sweep skips dark fleets), so computing the ratio from
 * inventory would keep asserting the last healthy value forever. A
 * disconnected fleet is by definition hearing from zero devices —
 * forcing onlineCount to 0 drops iot_fleet_online_ratio to 0 and the
 * Fleet Offline Ratio template pages ~20 minutes into a total
 * blackout. That is the fleet-level outage alert OneUptime previously
 * lacked (the status pill flipped, but nothing paged). Postgres
 * device states are left untouched, preserving reconnect recovery.
 * Per-DEVICE silence handling stays blackout-guarded in
 * CheckDeviceHeartbeats, and the telemetry-source liveness probe is
 * blind to rollup rows, so device incidents hold (not auto-resolve)
 * while the fleet-level alert fires.
 * ------------------------------------------------------------------
 */

const INSERT_CHUNK_SIZE: number = 500;

RunCron(
  "IoT:ComputeFleetRollups",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const fleets: Array<IoTFleet> = await IoTFleetService.findBy({
        query: {
          isArchived: false,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          deviceCount: true,
          onlineDeviceCount: true,
          retainTelemetryDataForDays: true,
          otelCollectorStatus: true,
          expectedDeviceCheckinIntervalSeconds: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      if (fleets.length === 0) {
        return;
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const allRows: Array<JSONObject> = [];

      for (const fleet of fleets) {
        if (!fleet._id || !fleet.projectId || !fleet.name) {
          continue;
        }

        try {
          const iotFleetId: ObjectID = new ObjectID(fleet._id.toString());
          const stats: IoTFleetRollupStats =
            await IoTDeviceService.getFleetRollupStats({
              projectId: fleet.projectId,
              iotFleetId: iotFleetId,
              fleetDefaultCheckinIntervalSeconds:
                fleet.expectedDeviceCheckinIntervalSeconds ?? null,
              now: now,
            });

          /*
           * Blackout override (see header): a disconnected fleet is
           * hearing from zero devices, whatever the frozen inventory
           * states claim.
           */
          if (fleet.otelCollectorStatus === "disconnected") {
            stats.onlineCount = 0;
          }

          if (
            fleet.deviceCount !== stats.deviceCount ||
            fleet.onlineDeviceCount !== stats.onlineCount
          ) {
            await IoTFleetService.updateColumnsByIdWithoutHooks({
              id: iotFleetId,
              data: {
                deviceCount: stats.deviceCount,
                onlineDeviceCount: stats.onlineCount,
              },
            });
          }

          allRows.push(
            ...buildFleetRollupMetricRows({
              projectId: fleet.projectId,
              fleetName: fleet.name,
              stats: stats,
              at: now,
              retentionDays: fleet.retainTelemetryDataForDays || 15,
            }),
          );
        } catch (err) {
          logger.error(
            `IoT:ComputeFleetRollups: rollup failed for fleet ${fleet._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      for (let i: number = 0; i < allRows.length; i += INSERT_CHUNK_SIZE) {
        await MetricService.insertJsonRows(
          allRows.slice(i, i + INSERT_CHUNK_SIZE),
        );
      }

      if (allRows.length > 0) {
        logger.debug(
          `IoT:ComputeFleetRollups: wrote ${allRows.length} rollup datapoint(s) across ${fleets.length} fleet(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `IoT:ComputeFleetRollups cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
