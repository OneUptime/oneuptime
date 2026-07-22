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
  // Last SNMP contact; drives the freshness fallback for unmonitored devices.
  lastSeenAt?: Date | null | undefined;
}

// A project MonitorStatus row a freshness fallback can resolve to.
export interface RollupStatusOption {
  monitorStatusId: string;
  priority: number;
}

export class SiteStatusRollupUtil {
  // A device is considered alive when SNMP data arrived within this window.
  public static readonly DEFAULT_FRESHNESS_WINDOW_IN_MINUTES: number = 15;

  /*
   * Returns the winning MonitorStatus id for a set of devices, or null when
   * no device contributes anything (empty subtree, or freshness fallbacks
   * unavailable because the project has no operational/offline rows) - the
   * caller treats null as "leave the site's status untouched".
   *
   * Per device: a stamped monitor status (with a known priority) wins;
   * otherwise lastSeenAt within the freshness window maps to the project's
   * isOperationalState row and anything staler (or never seen) maps to the
   * isOfflineState row. Priority ties keep the first contributor (stable).
   */
  public static worstStatus(data: {
    deviceStates: Array<DeviceHealthState>;
    operationalStatus?: RollupStatusOption | null | undefined;
    offlineStatus?: RollupStatusOption | null | undefined;
    now?: Date | undefined;
    freshnessWindowInMinutes?: number | undefined;
  }): string | null {
    const now: Date = data.now || new Date();
    const windowInMinutes: number =
      data.freshnessWindowInMinutes ??
      SiteStatusRollupUtil.DEFAULT_FRESHNESS_WINDOW_IN_MINUTES;
    const windowInMs: number = windowInMinutes * 60 * 1000;

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
        const lastSeenAtInMs: number | null = device.lastSeenAt
          ? new Date(device.lastSeenAt).getTime()
          : null;
        const isFresh: boolean =
          lastSeenAtInMs !== null &&
          now.getTime() - lastSeenAtInMs <= windowInMs;

        candidate = isFresh
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
