import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import MonitorResourceUtil from "./MonitorResource";
import { NetworkDevicePollMode } from "./NetworkDeviceHydrationUtil";
import NetworkDeviceMetricUtil from "./NetworkDeviceMetricUtil";
import NetworkInventoryUtil from "./NetworkInventoryUtil";
import SnmpInterfaceRateUtil from "./SnmpInterfaceRateUtil";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import PingMonitorResponse from "../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * What the probe's ping of a device found, as the probe reports it
 * (PingMonitor.checkReachability): a verdict, the average RTT, the loss,
 * and why it failed when it did. Packet counts are optional because the
 * reachability ping is a short fixed burst whose counts the probe need not
 * report; the loss percentage is the number that matters.
 */
export interface NetworkDevicePingResult {
  isOnline: boolean;
  avgRttMs?: number | undefined;
  packetLossPercent?: number | undefined;
  packetsSent?: number | undefined;
  packetsReceived?: number | undefined;
  failureCause?: string | undefined;
}

/*
 * Server half of device-owned polling.
 *
 * The device's assigned probe polls every polling-enabled NetworkDevice on
 * the device's own schedule - pinging it always, and walking it over SNMP
 * as well when it has usable credentials - and reports each poll here. This
 * util then:
 *
 *   1. computes interface rates against the device's previous walk
 *      (NetworkDevice.lastWalkLog) when interfaces were walked,
 *   2. syncs the device/interface/endpoint inventory, reachability and
 *      lastSeenAt,
 *   3. emits device-scoped metrics (so health charts work with zero
 *      monitors), and
 *   4. fans the poll out to every Network Device monitor referencing the
 *      device — each gets an event-driven ProbeMonitorResponse evaluated
 *      through the ordinary criteria pipeline (incidents, alerts, status).
 *
 * Monitors are pure alerting config here: they never poll, and deleting
 * every monitor leaves the device fully inventoried and charted.
 */
export default class NetworkDeviceWalkUtil {
  /*
   * One page of the monitor fan-out lookup. The indexed query rarely needs
   * a second page (a device has a handful of monitors); the legacy JSON
   * scan can, on a project with more than this many hand-made Network
   * Device monitors.
   */
  private static readonly FAN_OUT_PAGE_SIZE: number = LIMIT_MAX;

  public static async processWalkResult(data: {
    probeId: ObjectID;
    networkDeviceId: ObjectID;
    /*
     * Device reachability: answered ping OR the walk succeeded. A caller
     * that predates ping-first polling passes only a walk; its verdict is
     * then the device's verdict.
     */
    isOnline?: boolean | undefined;
    /*
     * How the probe polled - "ping" (no credentials, ping only) or "snmp"
     * (ping and a walk in parallel). Absent from a pre-ping-first caller,
     * and read as "snmp" then: such a probe only ever walked.
     */
    pollMode?: NetworkDevicePollMode | undefined;
    // The probe's ping, when it ran one (older probes send none).
    pingResponse?: NetworkDevicePingResult | undefined;
    /*
     * The SNMP walk, when one ran - success or failure. Undefined on a
     * ping-only poll, and never synthesized from the ping.
     */
    snmpResponse?: SnmpMonitorResponse | undefined;
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
        `Device poll ignored: device ${data.networkDeviceId.toString()} is not assigned to probe ${data.probeId.toString()}.`,
      );
      return;
    }

    const pollMode: NetworkDevicePollMode = data.pollMode ?? "snmp";

    /*
     * The device verdict. A ping-first probe states it (ping OR walk); an
     * older probe only walked, so its walk verdict IS the device verdict -
     * and, matching the inventory's convention, a walk that reports no
     * verdict at all counts as answered.
     */
    const isOnline: boolean =
      data.isOnline ??
      (data.snmpResponse ? data.snmpResponse.isOnline !== false : false);

    const pingResponse: PingMonitorResponse | undefined =
      NetworkDeviceWalkUtil.toPingMonitorResponse(data.pingResponse);

    /*
     * Interface rates are counter deltas against the previous walk. Compute
     * them on the FULL interface set, before inventory pruning, so muted
     * ports still get fresh rates in the inventory table. Nothing to do on
     * a poll that ran no walk.
     */
    if (data.snmpResponse) {
      SnmpInterfaceRateUtil.attachInterfaceRates({
        snmpResponse: data.snmpResponse,
        previousWalkLog: device.lastWalkLog as JSONObject | undefined,
      });
    }

    /*
     * Persist this walk as the next delta baseline — but only when it
     * actually walked interfaces. Keeping the last GOOD counters across
     * failed polls (and across ping-only polls, which walk nothing) means
     * rates resume with a correct (longer-window) delta instead of losing
     * a cycle.
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
      data.snmpResponse &&
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
      pollMode: pollMode,
    });

    try {
      await NetworkDeviceMetricUtil.saveWalkMetrics({
        projectId: device.projectId,
        networkDeviceId: device.id,
        deviceName: device.name,
        probeId: data.probeId,
        snmpResponse: data.snmpResponse,
        // Walk time only: a ping-only poll writes no response-time point.
        responseTimeInMs: data.snmpResponse?.responseTimeInMs,
        isOnline: isOnline,
        pingResponse: pingResponse,
      });
    } catch (err) {
      // Metrics must never fail the walk pipeline.
      logger.error(
        `Failed to save device metrics for ${device.id.toString()}:`,
      );
      logger.error(err);
    }

    /*
     * Why the poll failed, for the incident/alert narrative. The walk's own
     * cause is passed through whenever a walk ran (it is the more specific
     * of the two, and the "SNMP walk failing" alert reads it); the ping's
     * cause is only worth stating when the device is actually unreachable
     * - on an ICMP-filtered device whose walk succeeds, "ping timed out" is
     * not a failure of anything.
     */
    const failureCause: string =
      data.snmpResponse?.failureCause ||
      (!isOnline ? data.pingResponse?.failureCause : undefined) ||
      "";

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

        /*
         * `isOnline` is the device verdict; `snmpResponse` is the real walk
         * or undefined - NEVER a synthesized failure, so walk-dependent
         * criteria see "not evaluated" rather than "breaching" on a
         * ping-only device. `responseTimeInMs` is the walk's time only.
         */
        const walkResponse: ProbeMonitorResponse = {
          projectId: monitor.projectId,
          monitorId: monitor.id,
          monitorStepId: monitorStep.id,
          probeId: data.probeId,
          snmpResponse: data.snmpResponse,
          pingResponse: pingResponse,
          isOnline: isOnline,
          responseTimeInMs: data.snmpResponse?.responseTimeInMs,
          isTimeout: data.snmpResponse?.isTimeout,
          failureCause: failureCause,
          monitoredAt: data.monitoredAt,
          ingestedAt: OneUptimeDate.getCurrentDate(),
        };

        try {
          await MonitorResourceUtil.monitorResource(walkResponse);
        } catch (err) {
          logger.error(
            `Error evaluating device poll for monitor ${monitor.id.toString()}:`,
          );
          logger.error(err);
        }
      }
    }

    logger.debug(
      `Device poll for ${device.id.toString()} (${pollMode}) processed: evaluated ${monitors.length} watching monitor(s).`,
    );
  }

  /*
   * The probe's ping result in the shape the criteria pipeline already
   * speaks (ProbeMonitorResponse.pingResponse, as Ping monitors report it),
   * so packet-loss criteria, metrics and evidence read it without a special
   * case. Undefined when the probe ran no ping (older probes).
   */
  public static toPingMonitorResponse(
    ping: NetworkDevicePingResult | undefined,
  ): PingMonitorResponse | undefined {
    if (!ping) {
      return undefined;
    }

    /*
     * Loss is the one number every reader wants; when the probe did not
     * measure it, the verdict implies it - an answered ping lost nothing
     * that matters, a silent one lost everything.
     */
    const packetLossPercent: number =
      typeof ping.packetLossPercent === "number" &&
      isFinite(ping.packetLossPercent)
        ? ping.packetLossPercent
        : ping.isOnline
          ? 0
          : 100;

    return {
      packetsSent: ping.packetsSent ?? 0,
      packetsReceived: ping.packetsReceived ?? 0,
      packetLossPercent: packetLossPercent,
      avgRoundTripTimeInMs:
        typeof ping.avgRttMs === "number" && isFinite(ping.avgRttMs)
          ? ping.avgRttMs
          : undefined,
    };
  }

  /*
   * Every enabled Network Device monitor in the project watching one of
   * the given devices. Shared by the walk fan-out above and the SNMP trap
   * fan-out.
   *
   * Two sources, unioned and deduped by id:
   *
   *   1. Indexed: monitors whose `autoProvisionedNetworkDeviceId` is one of
   *      the devices - every monitor a template, an auto-import rule or an
   *      alert policy provisioned. Served by the partial index on that
   *      column, so it costs one index probe per device however many
   *      monitors the project has.
   *   2. Legacy: hand-made monitors, which carry the device link only in
   *      their step JSON. Restricted to rows with NO
   *      autoProvisionedNetworkDeviceId (the indexed query already covered
   *      the rest), paged, and filtered server-side on the step JSON.
   *
   * The legacy scan is what this lookup used to be in full - one fetch of
   * every Network Device monitor in the project per walk - and it shrinks
   * as monitors move onto the column.
   */
  public static async findMonitorsWatchingDevices(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Array<Monitor>> {
    if (data.deviceIds.length === 0) {
      return [];
    }

    const deviceIdSet: Set<string> = new Set(data.deviceIds);

    const indexedMonitors: Array<Monitor> =
      await NetworkDeviceWalkUtil.findNetworkDeviceMonitorsPaged({
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
        autoProvisionedNetworkDeviceId: QueryHelper.any(data.deviceIds),
      });

    const legacyMonitors: Array<Monitor> = (
      await NetworkDeviceWalkUtil.findNetworkDeviceMonitorsPaged({
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
        autoProvisionedNetworkDeviceId: QueryHelper.isNull(),
      })
    ).filter((monitor: Monitor) => {
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

    const seenMonitorIds: Set<string> = new Set();
    const monitors: Array<Monitor> = [];

    for (const monitor of [...indexedMonitors, ...legacyMonitors]) {
      const monitorId: string | undefined = monitor.id?.toString();

      if (!monitorId || seenMonitorIds.has(monitorId)) {
        continue;
      }

      seenMonitorIds.add(monitorId);
      monitors.push(monitor);
    }

    return monitors;
  }

  /*
   * Every monitor matching the query, in id order so the pages stay
   * stable while monitors are created or deleted underneath the scan.
   */
  private static async findNetworkDeviceMonitorsPaged(
    query: Query<Monitor>,
  ): Promise<Array<Monitor>> {
    const monitors: Array<Monitor> = [];
    let skip: number = 0;

    for (;;) {
      const page: Array<Monitor> = await MonitorService.findBy({
        query: query,
        select: {
          _id: true,
          projectId: true,
          monitorSteps: true,
          disableActiveMonitoring: true,
          disableActiveMonitoringBecauseOfManualIncident: true,
          disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: NetworkDeviceWalkUtil.FAN_OUT_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      monitors.push(...page);

      if (page.length < NetworkDeviceWalkUtil.FAN_OUT_PAGE_SIZE) {
        break;
      }

      skip += page.length;
    }

    return monitors;
  }
}
