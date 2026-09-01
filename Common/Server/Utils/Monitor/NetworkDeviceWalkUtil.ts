import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import MonitorResourceUtil from "./MonitorResource";
import NetworkDeviceMetricUtil from "./NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "./NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "./SnmpInterfaceRateUtil";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * Server half of device-owned polling.
 *
 * The device's assigned probe walks every polling-enabled NetworkDevice on
 * the device's own schedule and reports each walk here. This util then:
 *
 *   1. computes interface rates against the device's previous walk
 *      (NetworkDevice.lastWalkLog),
 *   2. syncs the device/interface/endpoint inventory and lastSeenAt,
 *   3. emits device-scoped metrics (so health charts work with zero
 *      monitors), and
 *   4. fans the walk out to every Network Device monitor referencing the
 *      device — each gets an event-driven ProbeMonitorResponse evaluated
 *      through the ordinary criteria pipeline (incidents, alerts, status).
 *
 * Monitors are pure alerting config here: they never poll, and deleting
 * every monitor leaves the device fully inventoried and charted.
 */
export default class NetworkDeviceWalkUtil {
  public static async processWalkResult(data: {
    probeId: ObjectID;
    networkDeviceId: ObjectID;
    snmpResponse: SnmpMonitorResponse;
    monitoredAt: Date;
  }): Promise<void> {
    /*
     * Scope the lookup to the reporting probe (the auth middleware only
     * proves the caller is SOME valid probe) — without this any probe that
     * learned a foreign device id could overwrite another project's
     * inventory or trigger its monitors.
     */
    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: data.networkDeviceId,
        probeId: data.probeId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        siteId: true,
        lastWalkLog: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.id || !device.projectId) {
      logger.warn(
        `Device walk ignored: device ${data.networkDeviceId.toString()} is not assigned to probe ${data.probeId.toString()}.`,
      );
      return;
    }

    const isOnline: boolean | undefined = data.snmpResponse.isOnline;

    /*
     * Interface rates are counter deltas against the previous walk. Compute
     * them on the FULL interface set, before inventory pruning, so muted
     * ports still get fresh rates in the inventory table.
     */
    SnmpInterfaceRateUtil.attachInterfaceRates({
      snmpResponse: data.snmpResponse,
      previousWalkLog: device.lastWalkLog as JSONObject | undefined,
    });

    /*
     * Persist this walk as the next delta baseline — but only when it
     * actually walked interfaces. Keeping the last GOOD counters across
     * failed polls means rates resume with a correct (longer-window) delta
     * instead of losing a cycle.
     *
     * Hook-free single-statement write, deliberately. A 48-interface walk
     * log is ~28 KB of jsonb, stored out of line: the full updateOneById
     * pipeline SELECTs the row before writing it (the column is in the
     * payload), so every poll detoasted the PREVIOUS log a second time —
     * it was already read above — only to overwrite it. Measured against
     * the seeded 80,000-device fleet, that pre-read costs 8 buffer hits and
     * ~0.6 ms where the same lookup without the column costs 4 and
     * ~0.06 ms; at 267 walks/sec it is pure waste on the product's hottest
     * table. It does NOT shrink the ~12 KB of WAL the rewrite itself emits
     * (a plain one-column update is 144 B) — that is what storing less
     * would fix, and it is a separate change.
     *
     * Nothing rides on the hooks for THIS write. NetworkDevice declares
     * neither @EnableWorkflow nor @EnableAuditLog, so _updateBy's workflow,
     * realtime and audit branches are inert for the model, and the payload
     * carries exactly one column: no site-rule identity column
     * (hostname/name/sysName), no siteId, no monitor binding, no
     * monitoringMethod. Both of NetworkDeviceService's real update hooks —
     * site-assignment re-evaluation and the monitor-status stamp — are
     * therefore no-ops here. The inventory sync below still writes those
     * columns through the hooked path, which is where they have to stay.
     * Do not add a column to this payload: anything that lands here stops
     * firing hooks silently.
     *
     * One thing IS lost, deliberately: `updateColumnsByIdWithoutHooks` does
     * not bump the @VersionColumn, so this write leaves `version` alone where
     * `updateOneById` incremented it. Nothing in the product reads
     * NetworkDevice.version, and `sanitizeUpdateData` strips it from client
     * payloads. Note this is the opposite call from the one the interface
     * upsert makes a file away — NetworkInterfaceService hand-writes
     * `version + 1` in its raw statements — and the difference is intended: a
     * batched write REPLACES a path that bumped it and is the row's normal
     * update path, whereas this is a delta-baseline cache write that happens
     * every five minutes and would otherwise be the only thing moving the
     * counter at all.
     */
    if (
      data.snmpResponse.interfaces &&
      data.snmpResponse.interfaces.length > 0
    ) {
      await NetworkDeviceService.updateColumnsByIdWithoutHooks({
        id: device.id,
        data: {
          lastWalkLog: {
            /*
             * ONLY the interfaces, not the whole response.
             *
             * This column exists for exactly one reader —
             * SnmpInterfaceRateUtil, which computes counter deltas from
             * `snmpResponse.interfaces` and touches nothing else. Every other
             * field was dead weight in a jsonb column rewritten on every poll
             * of every device, and `oidResponses` is the one that grows: OID
             * Collection Templates make long health-OID lists normal, so
             * leaving them here would add tens of KB per device per poll of
             * pure TOAST churn on the product's hottest table, for data
             * nothing ever reads back.
             */
            snmpResponse: {
              interfaces: JSON.parse(
                JSON.stringify(data.snmpResponse.interfaces),
              ),
            },
            monitoredAt: OneUptimeDate.getCurrentDate(),
          },
        } as any,
        /*
         * The hooked path finds rows with `withDeleted: false`, so a device
         * deleted between the read at the top of this walk and here was
         * never written to. The raw path matches on `_id` alone, so keep
         * that guard explicitly — a walk still in flight must not push a
         * fresh log back onto a row the user just deleted.
         */
        expectedData: {
          deletedAt: null,
        },
      });
    }

    /*
     * Inventory sync also prunes data.snmpResponse.interfaces down to
     * monitored ports, so the metrics and criteria below only see ports the
     * user cares about.
     */
    await NetworkInventoryUtil.updateFromWalk({
      projectId: device.projectId,
      deviceId: device.id,
      snmpResponse: data.snmpResponse,
      isOnline: isOnline,
    });

    try {
      await NetworkDeviceMetricUtil.saveWalkMetrics({
        projectId: device.projectId,
        networkDeviceId: device.id,
        deviceName: device.name,
        probeId: data.probeId,
        snmpResponse: data.snmpResponse,
        responseTimeInMs: data.snmpResponse.responseTimeInMs,
        isOnline: isOnline,
      });
    } catch (err) {
      // Metrics must never fail the walk pipeline.
      logger.error(
        `Failed to save device metrics for ${device.id.toString()}:`,
      );
      logger.error(err);
    }

    // --- Fan out to the monitors alerting on this device ---
    const monitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findMonitorsWatchingDevices({
        projectId: device.projectId,
        deviceIds: [device.id.toString()],
      });

    for (const monitor of monitors) {
      if (
        monitor.disableActiveMonitoring ||
        monitor.disableActiveMonitoringBecauseOfManualIncident ||
        monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
      ) {
        continue;
      }

      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      for (const monitorStep of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const referencedDeviceId: string | undefined =
          monitorStep.data?.networkDeviceMonitor?.networkDeviceId;

        if (
          !referencedDeviceId ||
          referencedDeviceId !== device.id.toString()
        ) {
          continue;
        }

        const walkResponse: ProbeMonitorResponse = {
          projectId: monitor.projectId,
          monitorId: monitor.id,
          monitorStepId: monitorStep.id,
          probeId: data.probeId,
          snmpResponse: data.snmpResponse,
          isOnline: isOnline,
          responseTimeInMs: data.snmpResponse.responseTimeInMs,
          isTimeout: data.snmpResponse.isTimeout,
          failureCause: data.snmpResponse.failureCause || "",
          monitoredAt: data.monitoredAt,
          ingestedAt: OneUptimeDate.getCurrentDate(),
        };

        try {
          await MonitorResourceUtil.monitorResource(walkResponse);
        } catch (err) {
          logger.error(
            `Error evaluating device walk for monitor ${monitor.id.toString()}:`,
          );
          logger.error(err);
        }
      }
    }

    logger.debug(
      `Device walk for ${device.id.toString()} processed: evaluated ${monitors.length} watching monitor(s).`,
    );
  }

  /*
   * Every enabled Network Device monitor in the project whose steps
   * reference one of the given devices. Shared by the walk fan-out above
   * and the SNMP trap fan-out — the monitor↔device link lives in step JSON,
   * so this fetches the project's Network Device monitors and filters
   * server-side.
   */
  public static async findMonitorsWatchingDevices(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Array<Monitor>> {
    if (data.deviceIds.length === 0) {
      return [];
    }

    const deviceIdSet: Set<string> = new Set(data.deviceIds);

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
        projectId: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return monitors.filter((monitor: Monitor) => {
      return (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).some(
        (monitorStep: MonitorStep) => {
          const referencedDeviceId: string | undefined =
            monitorStep.data?.networkDeviceMonitor?.networkDeviceId;
          return Boolean(
            referencedDeviceId && deviceIdSet.has(referencedDeviceId),
          );
        },
      );
    });
  }
}
