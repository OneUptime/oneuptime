import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "./DeviceReachabilityUtil";

/*
 * The one place that decides how healthy a single NetworkDevice is, and how
 * a pile of those verdicts rolls up into the counts a site card prints.
 *
 * The topology graph has always answered this question — a node is drawn
 * red, amber or green — but it answered it inside the graph, from a
 * NetworkTopologyNode that only exists once the whole map has been built.
 * Issue #3320 needs the same verdict one level up, per SITE, so a franchise
 * estate of 949 sites can say WHICH sites hold a device that needs
 * attention without first drawing 21,700 device nodes.
 *
 * So the rule moves here, and both halves read it:
 *
 *   status  — a monitor-stamped status wins outright; otherwise the shared
 *             reachability rule (the OUTCOME of the last poll, never its
 *             age) decides, and a device nothing has ever polled — or a
 *             monitor-backed device nothing has yet reported on — is
 *             `unknown` rather than a failure.
 *   degraded — an up device with dark ports. A switch that answers every
 *             poll while three of its interfaces are down is not down, but
 *             it is exactly what somebody is looking for.
 *
 * This deliberately mirrors NetworkTopologyUtil.deviceStatus followed by
 * TopologyHealthFilter.healthStateForNode, because a device that reads
 * "degraded" on the map and "healthy" on the site card above it is the two
 * halves of the product describing different networks.
 *
 * The ONE input the map has that a site rollup does not is the link layer:
 * the map also degrades a node with an operationally-down link attached.
 * That fact lives in the topology edges, which are built per-site and never
 * exist at rollup time. The asymmetry is safe in the direction that matters
 * — the device at the other end of a dead link reports its own dark port —
 * but it is why a site's device counts can be very slightly kinder than the
 * map you get when you drill into it, and never the reverse.
 */

/**
 * How healthy one device is.
 *
 * "unknown" is a real answer and not a synonym for healthy: a device
 * nothing has polled yet has never been judged, and counting it either way
 * would put onboarding into an operator's attention list (or hide a real
 * gap behind a green count).
 */
export type NetworkDeviceHealthState =
  | "down"
  | "degraded"
  | "healthy"
  | "unknown";

/**
 * The columns the classifier reads. Every caller selects exactly these.
 *
 * `monitorStatusIsOffline` is the OFFLINE end of the device's stamped
 * MonitorStatus row — `undefined` when no monitor backs the device (the
 * ordinary case for an SNMP-walked switch), which is what sends the
 * decision down to reachability.
 *
 * The offline end and not the operational end, because MonitorStatus is a
 * ladder rather than a pair: the seeded rows run Operational (1) ...
 * Offline (3), and a "Degraded" row in between is NEITHER operational nor
 * offline. The device map resolves that ladder with
 * `isOfflineState ? "down" : "up"` (see NetworkDeviceTopology.ts), so a
 * caller that passed the operational flag instead would count every
 * degraded-but-reachable device as down — and the map you reach by
 * clicking that card would draw the same device green.
 */
export interface DeviceHealthStateInput {
  monitorStatusIsOffline?: boolean | null | undefined;
  isReachable?: boolean | null | undefined;
  lastPolledAt?: Date | string | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  pollingIntervalInMinutes?: number | null | undefined;
  /*
   * How this device's health is established. NULL, empty and anything
   * unrecognised read as SNMP — see NetworkDeviceMonitoringMethodUtil.parse,
   * which is why an omitted value keeps every existing caller on the poll
   * rule unchanged.
   *
   * Load-bearing when a monitor-backed device (monitoringMethod "Monitor")
   * has NO stamped status to read — nothing bound yet, or bound and never
   * evaluated. The shared rule then answers Pending ("unknown" here) rather
   * than falling through to the poll columns, which on such a device are
   * either NULL or, worse, the last thing a probe found before it stopped
   * asking: a device switched from SNMP to Monitor keeps its old lastSeenAt
   * until the switch-over clears it, and a caller that dropped this field
   * would let that months-old timestamp call the device "down" on the site
   * card while its own row in the device list reads Pending.
   */
  monitoringMethod?: string | null | undefined;
  interfacesDown?: number | null | undefined;
}

/**
 * How many devices in some scope are in each state.
 *
 * `total` is carried rather than derived so a caller can print "4 of 128"
 * without summing four fields, and so a partial rollup (see the
 * truncation flags on the hierarchy endpoint) still reports an honest
 * denominator.
 */
export interface DeviceHealthCounts {
  total: number;
  down: number;
  degraded: number;
  healthy: number;
  unknown: number;
}

/**
 * The state of one device.
 *
 * Order is load-bearing. A stamped monitor status is the operator's own
 * system of record and beats everything; then hard-down beats everything
 * else, because a device that does not answer has interface counts that
 * are by definition stale; then — and only for a device known to be up —
 * dark ports make it degraded.
 *
 * Note what this means for a device stamped "Degraded": the ladder does not
 * call it offline, so it is up, and it lands in "degraded" only if it also
 * reports dark ports. That is the device map's rule, reproduced exactly.
 * Diverging from it here — however reasonable the divergence — would put a
 * site card and the map it opens into disagreement, which is the one
 * outcome this module exists to make impossible.
 */
export function deviceHealthState(
  device: DeviceHealthStateInput | null | undefined,
  now?: Date | undefined,
): NetworkDeviceHealthState {
  if (!device) {
    return "unknown";
  }

  let isUp: boolean;

  if (
    device.monitorStatusIsOffline === true ||
    device.monitorStatusIsOffline === false
  ) {
    // Anything the ladder does not call OFFLINE is up. See the input docs.
    isUp = !device.monitorStatusIsOffline;
  } else {
    const reachability: NetworkDeviceReachability =
      DeviceReachabilityUtil.getStatus(
        {
          isReachable: device.isReachable,
          lastPolledAt: device.lastPolledAt,
          lastSeenAt: device.lastSeenAt,
          pollingIntervalInMinutes: device.pollingIntervalInMinutes,
          /*
           * Carried so the shared rule knows whether the poll columns above
           * mean anything. This branch is only reached with NO stamped
           * status (the one above took every stamped one), so for a
           * monitor-backed device it is exactly the "Pending" case — see
           * the input docs.
           */
          monitoringMethod: device.monitoringMethod,
        },
        now,
      );

    if (reachability === NetworkDeviceReachability.Pending) {
      return "unknown";
    }

    isUp = reachability === NetworkDeviceReachability.Up;
  }

  if (!isUp) {
    return "down";
  }

  if (
    typeof device.interfacesDown === "number" &&
    Number.isFinite(device.interfacesDown) &&
    device.interfacesDown > 0
  ) {
    return "degraded";
  }

  return "healthy";
}

/** A fresh, all-zero tally. */
export function emptyDeviceHealthCounts(): DeviceHealthCounts {
  return {
    total: 0,
    down: 0,
    degraded: 0,
    healthy: 0,
    unknown: 0,
  };
}

/**
 * Add a verdict to a tally, in place.
 *
 * `count` is how many devices share it, and defaults to one. It exists
 * because the rollups no longer read devices one at a time: the database
 * groups the fleet by the facts this module classifies and returns a bucket
 * per distinct combination, so one verdict arrives already standing for a
 * hundred devices. Adding them one call at a time would put the eighty
 * thousand iterations back that the grouping removed.
 *
 * Mutating on purpose: the hierarchy aggregator folds every bucket into a few
 * hundred tallies in one pass, and allocating a fresh five-field object per
 * bucket is the whole cost of that pass.
 */
export function addDeviceHealth(
  counts: DeviceHealthCounts,
  state: NetworkDeviceHealthState,
  count: number = 1,
): void {
  counts.total += count;
  counts[state] += count;
}

/** The sum of two tallies, as a new object. */
export function mergeDeviceHealthCounts(
  first: DeviceHealthCounts,
  second: DeviceHealthCounts,
): DeviceHealthCounts {
  return {
    total: first.total + second.total,
    down: first.down + second.down,
    degraded: first.degraded + second.degraded,
    healthy: first.healthy + second.healthy,
    unknown: first.unknown + second.unknown,
  };
}

/**
 * How many devices in this tally need somebody to look at them — the union
 * of down and degraded, which is what every "needs attention" control in
 * the product means by the phrase.
 */
export function deviceAttentionCount(counts: DeviceHealthCounts): number {
  return counts.down + counts.degraded;
}

/**
 * The worst state present in a tally, or "unknown" for an empty one.
 *
 * Used to color a site by its devices: one dark switch in a store of forty
 * makes the store's device rollup read "down", the same worst-of rule
 * SiteStatusRollupUtil applies to the site's own MonitorStatus.
 */
export function worstDeviceHealthState(
  counts: DeviceHealthCounts,
): NetworkDeviceHealthState {
  if (counts.down > 0) {
    return "down";
  }
  if (counts.degraded > 0) {
    return "degraded";
  }
  if (counts.healthy > 0) {
    return "healthy";
  }
  return "unknown";
}
