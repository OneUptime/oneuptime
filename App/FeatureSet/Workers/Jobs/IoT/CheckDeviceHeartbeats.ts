import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTDeviceService, {
  IoTInventorySummary,
  SilentIoTDevice,
} from "Common/Server/Services/IoTDeviceService";
import MetricService from "Common/Server/Services/MetricService";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTDeviceState from "Common/Types/IoT/IoTDeviceState";
import { buildSyntheticDeviceDownMetricRow } from "Common/Server/Utils/Telemetry/IoTSnapshotScan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";

/*
 * ------------------------------------------------------------------
 * IoT:CheckDeviceHeartbeats — silence-based offline detection
 *
 * Runs every minute. A dead device stops pushing OTLP entirely, so
 * nothing in the ingest path can flag it — the Device Offline monitor
 * template only fires when a gateway actively reports
 * iot_device_up = 0 on the device's behalf. This sweep closes that
 * gap for fleets that opt in by setting an expected check-in interval
 * (fleet-wide default on IoTFleet, per-device override on IoTDevice;
 * both null = detection off, matching the pre-existing behavior).
 *
 * Two passes per connected fleet:
 *
 *   1. FLIP — devices still lifecycle-Online but silent for 3x their
 *      effective interval walk to Offline through the HOOKED update
 *      path (updateOneById), so database hooks and future workflow
 *      triggers observe the transition. Only `state` flips — `isUp`
 *      stays whatever the device last REPORTED (isUp is
 *      device-reported truth, state is lifecycle truth; falsifying
 *      isUp here would stick, because the upsert COALESCEs isUp and a
 *      recovering device that never sends iot_device_up would then
 *      stay "down" forever). Silence flips are bounded per tick per
 *      fleet; the remainder flips on subsequent ticks.
 *
 *   2. EMIT — every device currently down by silence (Offline or
 *      Stale, still silent, not archived) gets one synthetic
 *      iot_device_up = 0 datapoint. The row carries the same
 *      fleet/device attributes as real data, so it lands in the same
 *      monitor series: the Device Offline template opens a per-device
 *      incident and keeps it open across ticks, then auto-resolves on
 *      the next real up = 1 datapoint. Without the steady 0-signal
 *      the monitor's rolling window would empty out and auto-resolve
 *      mid-outage. Rows are stamped oneuptime.synthetic =
 *      "offline-detection" so they are distinguishable in queries.
 *
 * Blackout protection, layered (per-device silence only carries
 * signal while the fleet itself is alive):
 *
 *   a. DISCONNECTED fleets are skipped: the fleet-level blackout hold
 *      (checkTelemetrySourceReporting in monitor evaluation) freezes
 *      monitor state for that case, and emitting synthetic rows would
 *      mark the source as "reporting" and defeat the hold.
 *   b. Fleets whose own lastSeenAt is stale are skipped BEFORE the
 *      15-minute disconnect fence trips: markDisconnectedFleets lags
 *      up to ~20 minutes, and in that window "every device is silent"
 *      is indistinguishable from "the collector died". lastSeenAt is
 *      legitimately up to ~5 minutes stale during continuous
 *      telemetry (Redis maintenance fence), so the guard sits just
 *      above that.
 *   c. If EVERY active device in a multi-device fleet is
 *      simultaneously silent, the tick is skipped as a suspected
 *      collector blackout — a genuine all-devices-died event is
 *      caught by the fleet Disconnected transition instead.
 *      Single-device fleets are exempt: there, device-down and
 *      fleet-down are the same event and alerting early is the whole
 *      point of the feature.
 *
 * Battery-friendly by construction: intervals are per-device /
 * per-fleet, evaluation compares against lastSeenAt (capture time,
 * already clock-skew-clamped at ingest), and the 3x grace factor
 * means an hourly reporter is only flagged after three missed
 * check-ins — not after one late batch.
 * ------------------------------------------------------------------
 */

// Max Online -> Offline flips per fleet per tick (hooked, one UPDATE each).
const MAX_FLIPS_PER_FLEET_PER_TICK: number = 500;

// Max synthetic down-rows per fleet per tick (lean ClickHouse inserts).
const MAX_SYNTHETIC_ROWS_PER_FLEET: number = 5000;

// Matches the recording-rules cron's derived-row default retention.
const DEFAULT_SYNTHETIC_RETENTION_DAYS: number = 15;

const INSERT_CHUNK_SIZE: number = 500;

/*
 * Blackout guard (b): skip the sweep when the FLEET's own lastSeenAt
 * is older than this. Sits just above the ~5-minute legitimate
 * staleness of fleet.lastSeenAt under continuous telemetry (Redis
 * maintenance fence + 60s update throttle), and far below the
 * 15-minute disconnect fence this guard exists to front-run.
 */
const FLEET_SILENCE_GUARD_SECONDS: number = 6 * 60;

RunCron(
  "IoT:CheckDeviceHeartbeats",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const fleets: Array<IoTFleet> = await IoTFleetService.findBy({
        query: {
          otelCollectorStatus: "connected",
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          lastSeenAt: true,
          expectedDeviceCheckinIntervalSeconds: true,
          retainTelemetryDataForDays: true,
          isArchived: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      for (const fleet of fleets) {
        if (!fleet._id || !fleet.projectId || !fleet.name) {
          continue;
        }
        if (fleet.isArchived) {
          continue;
        }

        try {
          await sweepFleet(fleet);
        } catch (err) {
          logger.error(
            `IoT:CheckDeviceHeartbeats: sweep failed for fleet ${fleet._id.toString()}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      logger.error(
        `IoT:CheckDeviceHeartbeats cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

async function sweepFleet(fleet: IoTFleet): Promise<void> {
  const iotFleetId: ObjectID = new ObjectID(fleet._id!.toString());
  const fleetDefaultCheckinIntervalSeconds: number | null =
    fleet.expectedDeviceCheckinIntervalSeconds ?? null;
  const now: Date = OneUptimeDate.getCurrentDate();

  /*
   * Blackout guard (b): the fleet itself has gone quiet but the
   * 15-minute disconnect fence has not tripped yet. Per-device
   * silence carries no signal in that window — skip.
   */
  if (
    !fleet.lastSeenAt ||
    OneUptimeDate.getSecondsBetweenDates(fleet.lastSeenAt, now) >
      FLEET_SILENCE_GUARD_SECONDS
  ) {
    logger.debug(
      `IoT:CheckDeviceHeartbeats: fleet ${fleet.name} (${iotFleetId.toString()}) looks silent itself (lastSeenAt ${fleet.lastSeenAt?.toISOString() || "never"}); skipping per-device sweep — suspected collector blackout.`,
    );
    return;
  }

  const goneSilent: Array<SilentIoTDevice> =
    await IoTDeviceService.findDevicesGoneSilent({
      iotFleetId: iotFleetId,
      fleetDefaultCheckinIntervalSeconds: fleetDefaultCheckinIntervalSeconds,
      now: now,
      limit: MAX_FLIPS_PER_FLEET_PER_TICK,
    });

  const alreadySilentDown: Array<SilentIoTDevice> =
    await IoTDeviceService.findSilentDownDevices({
      iotFleetId: iotFleetId,
      fleetDefaultCheckinIntervalSeconds: fleetDefaultCheckinIntervalSeconds,
      now: now,
      limit: MAX_SYNTHETIC_ROWS_PER_FLEET,
    });

  /*
   * Blackout guard (c): every active device silent at once in a
   * multi-device fleet reads as collector death, not device death.
   */
  const totalSilent: number = goneSilent.length + alreadySilentDown.length;
  if (totalSilent > 0) {
    const summary: IoTInventorySummary =
      await IoTDeviceService.getInventorySummary({
        projectId: fleet.projectId!,
        iotFleetId: iotFleetId,
      });
    if (summary.deviceCount >= 2 && totalSilent >= summary.deviceCount) {
      logger.warn(
        `IoT:CheckDeviceHeartbeats: all ${summary.deviceCount} active device(s) in fleet ${fleet.name} (${iotFleetId.toString()}) are silent at once; skipping sweep — suspected collector blackout (fleet Disconnected transition will cover a true full outage).`,
      );
      return;
    }
  }

  /*
   * Pass 1: flip devices that just went silent. Hooked path — one
   * update per device, bounded per tick. State only: isUp remains
   * the device-reported value (see header).
   */
  for (const device of goneSilent) {
    try {
      await IoTDeviceService.updateOneById({
        id: device.id,
        data: {
          state: IoTDeviceState.Offline,
          stateChangedAt: now,
        },
        props: { isRoot: true },
      });
    } catch (err) {
      logger.error(
        `IoT:CheckDeviceHeartbeats: offline flip failed for device ${device.externalId} (fleet ${iotFleetId.toString()}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (goneSilent.length > 0) {
    logger.debug(
      `IoT:CheckDeviceHeartbeats: flipped ${goneSilent.length} silent device(s) Offline in fleet ${fleet.name} (${iotFleetId.toString()})`,
    );
    if (goneSilent.length === MAX_FLIPS_PER_FLEET_PER_TICK) {
      logger.warn(
        `IoT:CheckDeviceHeartbeats: fleet ${fleet.name} hit the per-tick flip cap (${MAX_FLIPS_PER_FLEET_PER_TICK}); remaining silent devices flip on subsequent ticks.`,
      );
    }
  }

  /*
   * Pass 2: synthesize iot_device_up = 0 for every device currently
   * down by silence. alreadySilentDown was queried before the flips
   * (so it excludes them by state); the union with goneSilent is the
   * complete silent-down set for this tick.
   */
  const silentDown: Array<SilentIoTDevice> = [
    ...alreadySilentDown,
    ...goneSilent,
  ].slice(0, MAX_SYNTHETIC_ROWS_PER_FLEET);

  if (silentDown.length === 0) {
    return;
  }

  const retentionDays: number =
    fleet.retainTelemetryDataForDays || DEFAULT_SYNTHETIC_RETENTION_DAYS;

  const rows: Array<JSONObject> = silentDown.map(
    (device: SilentIoTDevice): JSONObject => {
      return buildSyntheticDeviceDownMetricRow({
        projectId: fleet.projectId!,
        fleetName: fleet.name!,
        kind: device.kind,
        externalId: device.externalId,
        deviceType: device.deviceType,
        firmwareVersion: device.firmwareVersion,
        at: now,
        retentionDays: retentionDays,
      });
    },
  );

  for (let i: number = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    await MetricService.insertJsonRows(rows.slice(i, i + INSERT_CHUNK_SIZE));
  }

  logger.debug(
    `IoT:CheckDeviceHeartbeats: emitted ${rows.length} synthetic iot_device_up=0 row(s) for fleet ${fleet.name} (${iotFleetId.toString()})`,
  );
  if (silentDown.length === MAX_SYNTHETIC_ROWS_PER_FLEET) {
    logger.warn(
      `IoT:CheckDeviceHeartbeats: fleet ${fleet.name} hit the synthetic-row cap (${MAX_SYNTHETIC_ROWS_PER_FLEET}); devices beyond the cap are not receiving down-signals this tick.`,
    );
  }
}
