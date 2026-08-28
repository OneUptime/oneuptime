import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../NetworkDevice/DeviceReachabilityUtil";
import SiteHealthRollupPolicy, {
  DefaultSiteOfflineThresholdPercent,
} from "../../Types/NetworkSite/SiteHealthRollupPolicy";

/*
 * Health rollup for a NetworkSite's device subtree.
 *
 * Two policies live here, and both are pure so the whole decision matrix is
 * unit-testable:
 *
 *   WorstStatus (the default, and what every site did before the policy
 *   existed) - each device contributes one MonitorStatus candidate and the
 *   highest priority number wins. MonitorStatus.priority is HIGHER = WORSE
 *   per the seeded rows (Operational 1 ... Offline 3), regardless of what the
 *   column docstring claims.
 *
 *   PercentThreshold - the SHARE of reporting devices that are
 *   non-operational decides, so one dark switch under a four-hundred-store
 *   region no longer paints the region offline. See
 *   Types/NetworkSite/SiteHealthRollupPolicy for why a region wants this and
 *   a single unit does not.
 *
 * Both policies agree on which devices get a vote at all: a device that has
 * never reported anything is not evidence of an outage and is skipped by
 * each of them.
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
   * Whether that status row is the project's operational one. Only
   * PercentThreshold reads it - worst-of never needs to know which END of
   * the ladder a status sits on, just how high up it is.
   *
   * Left undefined when the caller could not resolve the status row, and the
   * share then falls back to SNMP reachability for that device - exactly
   * what worst-of does when it cannot resolve the row's priority. The two
   * policies have to agree on which devices their stamped status speaks for,
   * or the same fleet reads differently depending on which one a site uses.
   */
  monitorStatusIsOperational?: boolean | null | undefined;
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
  /*
   * How many real devices this entry stands for.
   *
   * The rollup engine feeds in BUCKETS, not rows - one entry per distinct
   * combination of health facts, carrying the count of devices that share
   * them (see Server/Utils/NetworkDevice/DeviceHealthAggregation). Worst-of
   * is indifferent to the count; a share is not, so it is carried here.
   * Absent means one device, which keeps every hand-written caller and every
   * existing test correct.
   */
  deviceCount?: number | null | undefined;
}

// A project MonitorStatus row a rollup can resolve to.
export interface RollupStatusOption {
  monitorStatusId: string;
  priority: number;
}

/*
 * The three rungs of the ladder a PercentThreshold rollup can land on.
 * `degradedStatus` is optional: a project that never defined a status
 * between operational and offline gets offline for "some devices are down",
 * which is the honest reading when there is no middle rung to stand on.
 */
export interface RollupStatusLadder {
  operationalStatus?: RollupStatusOption | null | undefined;
  degradedStatus?: RollupStatusOption | null | undefined;
  offlineStatus?: RollupStatusOption | null | undefined;
}

/*
 * How a subtree's devices split between healthy and not, after the
 * never-reported ones have been dropped. Exposed because the UI wants to say
 * "3 of 488 devices down" next to the status it produced, and recomputing
 * that from the same buckets in a second place is how the two end up
 * disagreeing.
 */
export interface DeviceHealthShare {
  // Devices that contributed a verdict (excludes never-reported devices).
  reportingDeviceCount: number;
  // Of those, how many are NOT in the project's operational state.
  nonOperationalDeviceCount: number;
  /*
   * nonOperationalDeviceCount as a percentage of reportingDeviceCount, or 0
   * when nothing reported. Exact, not rounded.
   */
  nonOperationalPercent: number;
}

export class SiteStatusRollupUtil {
  /*
   * Returns the winning MonitorStatus id for a set of devices under the
   * WORST-OF policy, or null when no device contributes anything (empty
   * subtree, or fallbacks unavailable because the project has no
   * operational/offline rows) - the caller treats null as "leave the site's
   * status untouched".
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
          SiteStatusRollupUtil.reachabilityOf(device, now);

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

  /*
   * How the subtree splits between operational and not, in DEVICES rather
   * than in buckets.
   *
   * A device counts as non-operational when its stamped MonitorStatus is not
   * the operational one, or - for devices no monitor stamps - when its SNMP
   * reachability is Down. Never-reported devices are excluded from both the
   * numerator and the denominator, so a region half-way through its first
   * discovery walk is scored on the half that has answered rather than
   * marked down for the half that has not.
   */
  public static deviceHealthShare(data: {
    deviceStates: Array<DeviceHealthState>;
    now?: Date | undefined;
  }): DeviceHealthShare {
    const now: Date = data.now || new Date();

    let reporting: number = 0;
    let nonOperational: number = 0;

    for (const device of data.deviceStates) {
      const count: number = SiteStatusRollupUtil.deviceCountOf(device);

      if (
        device.currentMonitorStatusId &&
        typeof device.monitorStatusIsOperational === "boolean"
      ) {
        reporting += count;
        if (!device.monitorStatusIsOperational) {
          nonOperational += count;
        }
        continue;
      }

      const reachability: NetworkDeviceReachability =
        SiteStatusRollupUtil.reachabilityOf(device, now);

      if (reachability === NetworkDeviceReachability.Pending) {
        continue;
      }

      reporting += count;
      if (reachability === NetworkDeviceReachability.Down) {
        nonOperational += count;
      }
    }

    return {
      reportingDeviceCount: reporting,
      nonOperationalDeviceCount: nonOperational,
      nonOperationalPercent:
        reporting > 0 ? (nonOperational / reporting) * 100 : 0,
    };
  }

  /*
   * Returns the winning MonitorStatus id under the PERCENT-THRESHOLD policy,
   * or null when nothing reported (same "leave the status untouched"
   * contract as worstStatus) or when the ladder has no rung to land on.
   *
   * Nothing down is operational however low the threshold is set - a
   * threshold of zero means "any device down makes this offline", not "a
   * perfectly healthy region is offline".
   */
  public static percentThresholdStatus(data: {
    deviceStates: Array<DeviceHealthState>;
    ladder: RollupStatusLadder;
    offlineThresholdPercent?: number | null | undefined;
    now?: Date | undefined;
  }): string | null {
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: data.deviceStates,
      now: data.now,
    });

    if (share.reportingDeviceCount === 0) {
      return null;
    }

    if (share.nonOperationalDeviceCount === 0) {
      return data.ladder.operationalStatus?.monitorStatusId || null;
    }

    const threshold: number = SiteStatusRollupUtil.normalizeThresholdPercent(
      data.offlineThresholdPercent,
    );

    if (share.nonOperationalPercent >= threshold) {
      return data.ladder.offlineStatus?.monitorStatusId || null;
    }

    /*
     * Below the offline threshold but not clean. Prefer the middle rung;
     * fall back to offline when the project has none, and to operational
     * only if it has neither - a project with a single status row should not
     * have its sites' rollups blocked on a status it never created.
     */
    return (
      data.ladder.degradedStatus?.monitorStatusId ||
      data.ladder.offlineStatus?.monitorStatusId ||
      data.ladder.operationalStatus?.monitorStatusId ||
      null
    );
  }

  /*
   * The one entry point the rollup engine calls. Dispatches on the site's
   * policy so the engine never branches on it - and so an unrecognised
   * policy string falls back to worst-of rather than leaving a site with no
   * verdict at all.
   */
  public static rollupStatus(data: {
    policy: SiteHealthRollupPolicy;
    deviceStates: Array<DeviceHealthState>;
    ladder: RollupStatusLadder;
    offlineThresholdPercent?: number | null | undefined;
    now?: Date | undefined;
  }): string | null {
    if (data.policy === SiteHealthRollupPolicy.PercentThreshold) {
      return SiteStatusRollupUtil.percentThresholdStatus({
        deviceStates: data.deviceStates,
        ladder: data.ladder,
        offlineThresholdPercent: data.offlineThresholdPercent,
        now: data.now,
      });
    }

    return SiteStatusRollupUtil.worstStatus({
      deviceStates: data.deviceStates,
      operationalStatus: data.ladder.operationalStatus,
      offlineStatus: data.ladder.offlineStatus,
      now: data.now,
    });
  }

  /*
   * Out-of-range and non-finite thresholds are clamped rather than rejected:
   * the value reaches here from a settings column, and a site whose rollup
   * refused to run would be far worse than one scored against 0 or 100.
   */
  public static normalizeThresholdPercent(
    value: number | null | undefined,
  ): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DefaultSiteOfflineThresholdPercent;
    }
    return Math.min(100, Math.max(0, value));
  }

  private static deviceCountOf(device: DeviceHealthState): number {
    if (
      typeof device.deviceCount !== "number" ||
      !Number.isFinite(device.deviceCount) ||
      device.deviceCount <= 0
    ) {
      return 1;
    }
    return Math.floor(device.deviceCount);
  }

  private static reachabilityOf(
    device: DeviceHealthState,
    now: Date,
  ): NetworkDeviceReachability {
    return DeviceReachabilityUtil.getStatus(
      {
        isReachable: device.isReachable,
        lastPolledAt: device.lastPolledAt,
        lastSeenAt: device.lastSeenAt,
        pollingIntervalInMinutes: device.pollingIntervalInMinutes,
      },
      now,
    );
  }
}

export default SiteStatusRollupUtil;
