import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../NetworkDevice/DeviceReachabilityUtil";

/*
 * Worst-of health rollup for a NetworkSite's device subtree.
 *
 * Each device contributes one MonitorStatus candidate and the highest
 * priority number wins - MonitorStatus.priority is HIGHER = WORSE per the
 * seeded rows (Operational 1 ... Offline 3), regardless of what the column
 * docstring claims. Pure so the whole decision matrix is unit-testable.
 */

// One device's health inputs, denormalized by the rollup engine.
export interface DeviceHealthState {
  /*
   * The MonitorStatus stamped by the monitor bridge (string form). When set
   * together with its priority, it is the device's authoritative status.
   */
  currentMonitorStatusId?: string | null | undefined;
  // Priority of that status row; missing when the row no longer exists.
  monitorStatusPriority?: number | null | undefined;
  /*
   * The SNMP fallback for devices no monitor stamps, resolved by the shared
   * DeviceReachabilityUtil rule: the OUTCOME of the last poll, not the age
   * of the last success. Rolling a site up from freshness alone is what
   * turned "the probe is behind on a 900-device fleet" into a red site card
   * over devices that were all answering.
   */
  isReachable?: boolean | null | undefined;
  lastPolledAt?: Date | null | undefined;
  lastSeenAt?: Date | null | undefined;
  pollingIntervalInMinutes?: number | null | undefined;
}

// A project MonitorStatus row a freshness fallback can resolve to.
export interface RollupStatusOption {
  monitorStatusId: string;
  priority: number;
}

export class SiteStatusRollupUtil {
  /*
   * Returns the winning MonitorStatus id for a set of devices, or null when
   * no device contributes anything (empty subtree, or fallbacks unavailable
   * because the project has no operational/offline rows) - the caller
   * treats null as "leave the site's status untouched".
   *
   * Per device: a stamped monitor status (with a known priority) wins;
   * otherwise the device's SNMP reachability maps Up to the project's
   * isOperationalState row and Down to its isOfflineState row. A device
   * that has never been polled contributes nothing at all - it is not
   * evidence of an outage, and counting it as one used to pin a site red
   * for as long as it took the first walk to land. Priority ties keep the
   * first contributor (stable).
   */
  public static worstStatus(data: {
    deviceStates: Array<DeviceHealthState>;
    operationalStatus?: RollupStatusOption | null | undefined;
    offlineStatus?: RollupStatusOption | null | undefined;
    now?: Date | undefined;
  }): string | null {
    const now: Date = data.now || new Date();

    let winner: RollupStatusOption | null = null;

    for (const device of data.deviceStates) {
      let candidate: RollupStatusOption | null = null;

      if (
        device.currentMonitorStatusId &&
        typeof device.monitorStatusPriority === "number" &&
        Number.isFinite(device.monitorStatusPriority)
      ) {
        candidate = {
          monitorStatusId: device.currentMonitorStatusId,
          priority: device.monitorStatusPriority,
        };
      } else {
        const reachability: NetworkDeviceReachability =
          DeviceReachabilityUtil.getStatus(
            {
              isReachable: device.isReachable,
              lastPolledAt: device.lastPolledAt,
              lastSeenAt: device.lastSeenAt,
              pollingIntervalInMinutes: device.pollingIntervalInMinutes,
            },
            now,
          );

        if (reachability === NetworkDeviceReachability.Pending) {
          continue;
        }

        candidate =
          reachability === NetworkDeviceReachability.Up
            ? data.operationalStatus || null
            : data.offlineStatus || null;
      }

      if (!candidate) {
        continue;
      }

      if (!winner || candidate.priority > winner.priority) {
        winner = candidate;
      }
    }

    return winner ? winner.monitorStatusId : null;
  }
}

export default SiteStatusRollupUtil;
