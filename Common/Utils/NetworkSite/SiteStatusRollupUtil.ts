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
   * How this device's health is established. NULL, empty and anything
   * unrecognised read as SNMP — see NetworkDeviceMonitoringMethodUtil.parse,
   * which is why an omitted value keeps every existing caller on the poll
   * rule unchanged.
   *
   * Only consulted on the fallback path above, and load-bearing there: a
   * monitor-backed device (monitoringMethod "Monitor") that has no stamp
   * yet — or whose stamped row could not be resolved — has poll columns
   * that mean nothing (NULL, or the last thing a probe found before it
   * stopped asking). The shared rule reads it as Pending and both policies
   * skip it, exactly as they skip a never-polled SNMP device, rather than
   * letting a months-old lastSeenAt cast a vote against the site.
   */
  monitoringMethod?: string | null | undefined;
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
    /*
     * Devices withheld from the vote by an ongoing maintenance window. They
     * are known to exist and known NOT to be an unplanned outage, so they
     * cannot make the site worse - but if they are the only devices left,
     * the site is operational rather than frozen at whatever it said before
     * the window opened. See the note on deviceHealthShare.
     */
    suppressedDeviceCount?: number | null | undefined;
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

    /*
     * Nothing voted, but the subtree is not empty - every device in it is
     * inside a maintenance window. "Leave the status untouched" is the right
     * answer for an empty subtree and the wrong one here: it would pin a
     * region at whatever it happened to say when the window opened, for the
     * whole window.
     */
    if (
      !winner &&
      SiteStatusRollupUtil.positiveCount(data.suppressedDeviceCount) > 0
    ) {
      return data.operationalStatus?.monitorStatusId || null;
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
    /*
     * Devices inside an ongoing maintenance window, which the caller has
     * already removed from `deviceStates`.
     *
     * They stay in the DENOMINATOR and never enter the numerator. Dropping
     * them from both is the tempting simplification and it inverts the whole
     * feature: a region of 1,010 devices with 6 genuinely dark reads 0.6%
     * down, but put its 1,000 healthy devices under a planned window and the
     * same 6 become 60% - so scheduling maintenance on a HEALTHY subtree
     * would escalate the region to Offline. That is the identical hazard the
     * uptime side already refuses (it will not subtract a window from an
     * ancestor's denominator, because that erases genuine failures
     * elsewhere); this is the same rule applied to the device population
     * instead of to time.
     */
    suppressedDeviceCount?: number | null | undefined;
    now?: Date | undefined;
  }): DeviceHealthShare {
    const now: Date = data.now || new Date();

    let reporting: number = SiteStatusRollupUtil.positiveCount(
      data.suppressedDeviceCount,
    );
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
   * How many of these devices count towards a share at all — i.e. how many
   * have reported anything. Exposed so a caller holding buckets it has
   * deliberately excluded from the vote (a maintained subtree) can size them
   * with the SAME rule, instead of counting rows.
   *
   * Counting rows is the trap: a bucket of never-polled devices has a
   * deviceCount like any other, but deviceHealthShare drops those from both
   * sides of the fraction. Feeding their raw count back in as suppressed
   * would pad the denominator with devices that were never being measured
   * and dilute a genuine outage beside them.
   */
  public static reportingDeviceCount(
    deviceStates: Array<DeviceHealthState>,
    now?: Date | undefined,
  ): number {
    return SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: deviceStates,
      now: now,
    }).reportingDeviceCount;
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
    // See deviceHealthShare - denominator only, never the numerator.
    suppressedDeviceCount?: number | null | undefined;
    now?: Date | undefined;
  }): string | null {
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: data.deviceStates,
      suppressedDeviceCount: data.suppressedDeviceCount,
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
      /*
       * Same descending fallback as the degraded branch below. A project
       * with no offline row must not leave its worst case with NO verdict
       * while its milder case gets one - that reads as "the rollup stopped
       * working" exactly when something is wrong.
       */
      return (
        data.ladder.offlineStatus?.monitorStatusId ||
        data.ladder.degradedStatus?.monitorStatusId ||
        data.ladder.operationalStatus?.monitorStatusId ||
        null
      );
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
    // Devices withheld by an ongoing maintenance window. See deviceHealthShare.
    suppressedDeviceCount?: number | null | undefined;
    now?: Date | undefined;
  }): string | null {
    if (data.policy === SiteHealthRollupPolicy.PercentThreshold) {
      return SiteStatusRollupUtil.percentThresholdStatus({
        deviceStates: data.deviceStates,
        ladder: data.ladder,
        offlineThresholdPercent: data.offlineThresholdPercent,
        suppressedDeviceCount: data.suppressedDeviceCount,
        now: data.now,
      });
    }

    return SiteStatusRollupUtil.worstStatus({
      deviceStates: data.deviceStates,
      operationalStatus: data.ladder.operationalStatus,
      offlineStatus: data.ladder.offlineStatus,
      suppressedDeviceCount: data.suppressedDeviceCount,
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

  /*
   * A count that can be trusted to be added to a total: non-finite, negative
   * and fractional values all collapse to something safe rather than
   * poisoning the arithmetic with NaN.
   */
  private static positiveCount(value: number | null | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.floor(value);
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
        // See the field docs: decides whether the columns above mean anything.
        monitoringMethod: device.monitoringMethod,
      },
      now,
    );
  }
}

export default SiteStatusRollupUtil;
