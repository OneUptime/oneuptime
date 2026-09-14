import { describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import NetworkDeviceMonitoringMethod, {
  LEGACY_SNMP_MONITORING_METHOD,
} from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  DeviceHealthCounts,
  DeviceHealthStateInput,
  NetworkDeviceHealthState,
  addDeviceHealth,
  deviceAttentionCount,
  deviceHealthState,
  emptyDeviceHealthCounts,
  mergeDeviceHealthCounts,
  worstDeviceHealthState,
} from "../../../Utils/NetworkDevice/DeviceHealthStateUtil";

/*
 * Issue #3320 — the rule that decides which SITES hold a device somebody
 * has to look at.
 *
 * Everything the hierarchy view claims about an estate of 21,700 devices is
 * this function summed up, so every branch of it is pinned here: which kind
 * of device a stamped monitor status speaks for, what a dark port does to a
 * device that is otherwise answering, and — the one that matters most —
 * what stays "unknown" instead of being quietly counted as either a failure
 * or a success.
 *
 * The precedence rule (issue #3562, ping-first polling). Under SNMP-first
 * polling a stamped MonitorStatus outranked the poll on EVERY device, and
 * that no longer holds: every probe-polled device is now pinged on its
 * schedule, so it always has a poll verdict of its own, and the monitors
 * that stamp it (a Network Device monitor watching its SNMP walk, with an
 * "interface down → Offline" criterion) are watching something narrower
 * than reachability. The rule is therefore split by kind of device:
 *
 *   monitor-backed ("Monitor")  — nothing polls it, so the stamp IS its
 *                                 health, and no stamp means Pending.
 *   probe-polled (anything else, including NULL, "" and the legacy "SNMP")
 *                               — the poll decides; the stamp is
 *                                 informational and never consulted.
 */

const NOW: Date = OneUptimeDate.fromString("2026-08-21T12:00:00.000Z");

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

/*
 * Every spelling of "this device is polled by its probe" that reaches the
 * classifier from a real row. NULL and "" are rows written before the column
 * existed; "SNMP" is the retired first value of the enum, and a device that
 * carried it was probe-polled all along (the probe just did not ping it
 * yet). All four must take the poll branch identically — a device that read
 * as monitor-backed on one of them would have the stamp outrank its own
 * poll, which is the regression this whole describe block exists to catch.
 */
const PROBE_POLLED_METHODS: Array<string | null | undefined> = [
  // The real values, so a renamed member fails here and not in production.
  NetworkDeviceMonitoringMethod.Probe,
  LEGACY_SNMP_MONITORING_METHOD,
  "",
  null,
  undefined,
];

// The one value on which a stamped MonitorStatus is the device's verdict.
const MONITOR_BACKED: string = NetworkDeviceMonitoringMethod.Monitor;

describe("deviceHealthState — a monitor's verdict is the system of record for a MONITOR-BACKED device", () => {
  test("a status the ladder does not call offline makes the device up, whatever the poll leftovers say", () => {
    expect(
      deviceHealthState(
        {
          monitoringMethod: MONITOR_BACKED,
          monitorStatusIsOffline: false,
          /*
           * Leftovers from before the device was switched over to a bound
           * monitor. Nothing polls it now, so these must not be read.
           */
          isReachable: false,
          lastPolledAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  test("an offline monitor status makes the device down, whatever the poll leftovers say", () => {
    expect(
      deviceHealthState(
        {
          monitoringMethod: MONITOR_BACKED,
          monitorStatusIsOffline: true,
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("down");
  });

  test("a monitor-backed device that is up can still be degraded by its ports", () => {
    expect(
      deviceHealthState(
        {
          monitoringMethod: MONITOR_BACKED,
          monitorStatusIsOffline: false,
          interfacesDown: 3,
        },
        NOW,
      ),
    ).toBe("degraded");
  });

  /*
   * The Pending case. A monitor-backed device with nothing stamped has
   * either had no monitor bound to it yet (discovery used to import
   * ping-only hosts that way on purpose) or has one that has never been
   * evaluated. Neither is a verdict, and the device list says "Pending"
   * about the very same row — reading a green or a red here would put the
   * site card at odds with the pill under it.
   */
  test("a monitor-backed device nothing has stamped is unknown, not a verdict", () => {
    expect(deviceHealthState({ monitoringMethod: MONITOR_BACKED }, NOW)).toBe(
      "unknown",
    );
    expect(
      deviceHealthState(
        { monitoringMethod: MONITOR_BACKED, monitorStatusIsOffline: undefined },
        NOW,
      ),
    ).toBe("unknown");
    expect(
      deviceHealthState(
        { monitoringMethod: MONITOR_BACKED, monitorStatusIsOffline: null },
        NOW,
      ),
    ).toBe("unknown");
    // Not even dark ports promote a Pending device to a verdict.
    expect(
      deviceHealthState(
        { monitoringMethod: MONITOR_BACKED, interfacesDown: 3 },
        NOW,
      ),
    ).toBe("unknown");
  });
});

/*
 * The other direction, and the reason the split exists (issue #3562).
 *
 * A probe-polled switch that answers every ping can carry a stamped Offline
 * status: a Network Device monitor with an "interface down → Offline"
 * criterion stamps one the moment a single port goes dark, and the SNMP
 * walk failing on a credential change does the same. Letting that stamp
 * decide here painted the site card and the topology node RED while the
 * device's own row in the device list — which reads `isReachable` — said Up.
 * These pin the stamp back down to informational for every device the probe
 * polls.
 */
describe("deviceHealthState — a PROBE-POLLED device is judged by its poll, never by a stamp", () => {
  test.each(PROBE_POLLED_METHODS)(
    "monitoringMethod %p: a stamped Offline does not override an answering poll",
    (monitoringMethod: string | null | undefined) => {
      expect(
        deviceHealthState(
          {
            monitoringMethod: monitoringMethod,
            // An "interface down → Offline" criterion fired.
            monitorStatusIsOffline: true,
            // ...but the device answered its ping one minute ago.
            isReachable: true,
            lastPolledAt: minutesAgo(1),
            lastSeenAt: minutesAgo(1),
          },
          NOW,
        ),
      ).toBe("healthy");
    },
  );

  test.each(PROBE_POLLED_METHODS)(
    "monitoringMethod %p: a stamped Operational does not rescue a failing poll",
    (monitoringMethod: string | null | undefined) => {
      expect(
        deviceHealthState(
          {
            monitoringMethod: monitoringMethod,
            monitorStatusIsOffline: false,
            isReachable: false,
            lastPolledAt: minutesAgo(1),
          },
          NOW,
        ),
      ).toBe("down");
    },
  );

  /*
   * The whole point of the split, stated as the invariant an operator sees:
   * the interface-down criterion that stamps a switch Offline must move the
   * device's own dark-port count and nothing else. A site of answering
   * devices stays green with one degraded switch in it, and the map you
   * reach by clicking that card draws the same switch amber rather than red.
   */
  test("an interface-down stamp on an answering switch reads degraded, not down", () => {
    expect(
      deviceHealthState(
        {
          monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
          monitorStatusIsOffline: true,
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
          interfacesDown: 3,
        },
        NOW,
      ),
    ).toBe("degraded");
  });

  /*
   * A probe-polled device with a failing SNMP walk still answers ping, so
   * `isReachable` is true (reachability is ping OR walk) and the device is
   * up. The walk's own verdict lives in isSnmpReachable and is a separate,
   * explanatory pill — it is not this classifier's input at all, which is
   * why a ping-only device can never be coloured by "SNMP failing".
   */
  test("a failing SNMP walk on a device that answers ping is not a health verdict", () => {
    expect(
      deviceHealthState(
        {
          monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
          // The walk failed, so a Network Device monitor stamped it Offline.
          monitorStatusIsOffline: true,
          // Reachability is ping OR walk, and the ping answered.
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  /*
   * `undefined` means no monitor has stamped this device at all, which is
   * the ordinary case for a probe-polled one. It must not be read as a
   * verdict of any kind — doing so would either paint every switch in the
   * estate down or hide every real outage behind a stamped green.
   */
  test("an absent monitor status leaves the poll in charge, as always", () => {
    expect(
      deviceHealthState(
        {
          monitorStatusIsOffline: undefined,
          isReachable: false,
          lastPolledAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("down");
    expect(
      deviceHealthState(
        {
          monitorStatusIsOffline: null,
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });
});

/*
 * The rule that this module exists for, and the one an earlier revision got
 * wrong: MonitorStatus is a LADDER (Operational 1 ... Offline 3), not a
 * pair. Reading the operational end counted every "Degraded" device as down
 * on the site card while the map you reach by clicking that card drew the
 * same device green — the two halves of the product describing different
 * networks, which is precisely what a shared classifier is for.
 *
 * NetworkDeviceTopology.ts resolves the ladder with
 * `status.isOfflineState ? "down" : "up"` — and, since ping-first polling,
 * only for a monitor-backed device (it applies the same isMonitorBacked gate
 * this module does). So every device below is monitor-backed: that is the
 * one kind of device on which a rung of the ladder decides anything.
 */
describe("the MonitorStatus ladder — a middle rung is not an outage", () => {
  type LadderRow = {
    name: string;
    isOperationalState: boolean;
    isOfflineState: boolean;
  };

  // The seeded project rows, plus the middle rung that broke the old rule.
  const LADDER: Array<LadderRow> = [
    { name: "Operational", isOperationalState: true, isOfflineState: false },
    { name: "Degraded", isOperationalState: false, isOfflineState: false },
    { name: "Maintenance", isOperationalState: false, isOfflineState: false },
    { name: "Offline", isOperationalState: false, isOfflineState: true },
  ];

  // Exactly what NetworkDeviceTopology.ts does with a monitor-backed row.
  function mapVerdict(row: LadderRow): "up" | "down" {
    return row.isOfflineState ? "down" : "up";
  }

  test.each(LADDER)(
    "$name: the rollup agrees with the map about up/down",
    (row: LadderRow) => {
      const state: NetworkDeviceHealthState = deviceHealthState(
        {
          monitoringMethod: MONITOR_BACKED,
          monitorStatusIsOffline: row.isOfflineState,
        },
        NOW,
      );
      const rollupSaysDown: boolean = state === "down";
      expect(rollupSaysDown).toBe(mapVerdict(row) === "down");
    },
  );

  test("a Degraded device with no dark ports is healthy, not down", () => {
    expect(
      deviceHealthState(
        { monitoringMethod: MONITOR_BACKED, monitorStatusIsOffline: false },
        NOW,
      ),
    ).toBe("healthy");
  });

  /*
   * The regression in one assertion. If anybody re-wires this input to the
   * operational flag, a Degraded row (isOperationalState false) starts
   * reading "down" here and this fails.
   */
  test("only the OFFLINE rung produces down", () => {
    const downRungs: Array<string> = LADDER.filter((row: LadderRow) => {
      return (
        deviceHealthState(
          {
            monitoringMethod: MONITOR_BACKED,
            monitorStatusIsOffline: row.isOfflineState,
          },
          NOW,
        ) === "down"
      );
    }).map((row: LadderRow) => {
      return row.name;
    });
    expect(downRungs).toEqual(["Offline"]);
  });

  /*
   * ...and the same ladder against a PROBE-POLLED device, where no rung of
   * it decides anything. Every one of the four reads by the poll instead, so
   * the switch that answered its ping is healthy on all four rungs —
   * including Offline, which is exactly what an "interface down" criterion
   * stamps on a switch with one dark port.
   */
  test.each(LADDER)(
    "$name: a probe-polled device ignores the rung entirely and reads by its poll",
    (row: LadderRow) => {
      expect(
        deviceHealthState(
          {
            monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
            monitorStatusIsOffline: row.isOfflineState,
            isReachable: true,
            lastPolledAt: minutesAgo(1),
            lastSeenAt: minutesAgo(1),
          },
          NOW,
        ),
      ).toBe("healthy");

      expect(
        deviceHealthState(
          {
            monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
            monitorStatusIsOffline: row.isOfflineState,
            isReachable: false,
            lastPolledAt: minutesAgo(1),
          },
          NOW,
        ),
      ).toBe("down");
    },
  );
});

describe("deviceHealthState — the poll rule, which every probe-polled device reads", () => {
  test("the probe asked and got nothing: down", () => {
    expect(
      deviceHealthState(
        { isReachable: false, lastPolledAt: minutesAgo(2) },
        NOW,
      ),
    ).toBe("down");
  });

  test("the probe asked and the device answered: healthy", () => {
    expect(
      deviceHealthState(
        {
          isReachable: true,
          lastPolledAt: minutesAgo(2),
          lastSeenAt: minutesAgo(2),
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  /*
   * The whole point of DeviceReachabilityUtil: a fleet whose real poll
   * cadence exceeds the old fifteen-minute freshness window is not an
   * outage. A device that answered two hours ago and has not been asked
   * since is still up, and the site above it must not turn red for it.
   */
  test("a stale but successful poll is still up, not down", () => {
    expect(
      deviceHealthState(
        {
          isReachable: true,
          lastPolledAt: minutesAgo(600),
          lastSeenAt: minutesAgo(600),
          pollingIntervalInMinutes: 5,
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  test("a device nothing has ever polled is unknown, not a failure", () => {
    expect(deviceHealthState({}, NOW)).toBe("unknown");
    expect(
      deviceHealthState({ isReachable: null, interfacesDown: 4 }, NOW),
    ).toBe("unknown");
  });

  test("polled but never once answered is down, not pending", () => {
    expect(deviceHealthState({ lastPolledAt: minutesAgo(30) }, NOW)).toBe(
      "down",
    );
  });

  /*
   * Issue #3562. A monitor-backed device is never polled, so whatever its
   * poll columns hold is either NULL or what a probe last found before it
   * stopped asking — a device switched over to a bound monitor keeps a
   * lastSeenAt from months ago. With nothing stamped yet the only honest
   * answer is "unknown", which is also what the device list says about the
   * same row; letting the legacy freshness branch read that timestamp would
   * put the site card at odds with the pill under it.
   */
  test("a monitor-backed device nothing has reported on is unknown, whatever its leftover poll columns say", () => {
    const leftovers: DeviceHealthStateInput = {
      isReachable: null,
      lastSeenAt: minutesAgo(60 * 24 * 30),
      pollingIntervalInMinutes: 5,
    };

    // The legacy branch, for a device that IS polled: staleness decides.
    expect(deviceHealthState(leftovers, NOW)).toBe("down");
    expect(
      deviceHealthState(
        { ...leftovers, monitoringMethod: MONITOR_BACKED },
        NOW,
      ),
    ).toBe("unknown");
    // ...and a mirrored outcome without a stamp is not a verdict either.
    expect(
      deviceHealthState(
        { ...leftovers, isReachable: true, monitoringMethod: MONITOR_BACKED },
        NOW,
      ),
    ).toBe("unknown");
  });
});

describe("deviceHealthState — degraded", () => {
  test("an up device with dark ports is degraded", () => {
    expect(
      deviceHealthState(
        {
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
          interfacesDown: 1,
        },
        NOW,
      ),
    ).toBe("degraded");
  });

  /*
   * Interface counts on a device that does not answer are by definition
   * stale, so "down" wins. A device reported as both would otherwise be
   * counted in the softer bucket and drop out of a "Down" filter.
   */
  test("down beats degraded when both could apply", () => {
    expect(
      deviceHealthState(
        {
          isReachable: false,
          lastPolledAt: minutesAgo(1),
          interfacesDown: 9,
        },
        NOW,
      ),
    ).toBe("down");
  });

  test("zero, negative and non-finite interface counts never degrade", () => {
    const base: {
      isReachable: boolean;
      lastPolledAt: Date;
      lastSeenAt: Date;
    } = {
      isReachable: true,
      lastPolledAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    };
    expect(deviceHealthState({ ...base, interfacesDown: 0 }, NOW)).toBe(
      "healthy",
    );
    expect(deviceHealthState({ ...base, interfacesDown: -2 }, NOW)).toBe(
      "healthy",
    );
    expect(deviceHealthState({ ...base, interfacesDown: NaN }, NOW)).toBe(
      "healthy",
    );
    expect(deviceHealthState({ ...base, interfacesDown: null }, NOW)).toBe(
      "healthy",
    );
  });

  test("a missing device row is unknown rather than an exception", () => {
    expect(deviceHealthState(null, NOW)).toBe("unknown");
    expect(deviceHealthState(undefined, NOW)).toBe("unknown");
  });
});

describe("tallies", () => {
  test("an empty tally is all zeroes and a fresh object each time", () => {
    const first: DeviceHealthCounts = emptyDeviceHealthCounts();
    const second: DeviceHealthCounts = emptyDeviceHealthCounts();
    expect(first).toEqual({
      total: 0,
      down: 0,
      degraded: 0,
      healthy: 0,
      unknown: 0,
    });
    first.down = 5;
    expect(second.down).toBe(0);
  });

  test("adding a device moves total and exactly one state", () => {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    addDeviceHealth(counts, "down");
    addDeviceHealth(counts, "degraded");
    addDeviceHealth(counts, "degraded");
    addDeviceHealth(counts, "healthy");
    addDeviceHealth(counts, "unknown");
    expect(counts).toEqual({
      total: 5,
      down: 1,
      degraded: 2,
      healthy: 1,
      unknown: 1,
    });
  });

  /*
   * The count defaults to one, and every caller written before the rollups
   * moved into the database depends on that — the topology filter and every
   * other place that still walks devices one at a time calls this with two
   * arguments. A default that stopped being 1 would rescale those tallies
   * without any of them mentioning a count at all.
   */
  test("the count defaults to one", () => {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    addDeviceHealth(counts, "healthy");
    expect(counts).toEqual({
      total: 1,
      down: 0,
      degraded: 0,
      healthy: 1,
      unknown: 0,
    });
  });

  /*
   * And the reason the parameter exists: a bucket arrives already standing
   * for a hundred devices, so one call has to move the tally by the whole
   * count — total and exactly one state, exactly as a hundred single calls
   * would have.
   */
  test("a count above one moves total and exactly one state by that much", () => {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    addDeviceHealth(counts, "down", 37);
    expect(counts).toEqual({
      total: 37,
      down: 37,
      degraded: 0,
      healthy: 0,
      unknown: 0,
    });
    addDeviceHealth(counts, "healthy", 41169);
    expect(counts).toEqual({
      total: 41206,
      down: 37,
      degraded: 0,
      healthy: 41169,
      unknown: 0,
    });
    expect(
      counts.down + counts.degraded + counts.healthy + counts.unknown,
    ).toBe(counts.total);
  });

  /*
   * A grouped aggregate over a filtered set can answer with a combination
   * and a count of zero. Treating that as one device would invent a switch
   * nobody owns — and a "down" one at that.
   */
  test("a count of zero is a no-op, not an increment", () => {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    addDeviceHealth(counts, "unknown", 0);
    expect(counts).toEqual(emptyDeviceHealthCounts());
  });

  test("the four states always sum to the total", () => {
    const counts: DeviceHealthCounts = emptyDeviceHealthCounts();
    const states: Array<NetworkDeviceHealthState> = [
      "down",
      "healthy",
      "healthy",
      "unknown",
      "degraded",
      "healthy",
    ];
    for (const state of states) {
      addDeviceHealth(counts, state);
    }
    expect(
      counts.down + counts.degraded + counts.healthy + counts.unknown,
    ).toBe(counts.total);
  });

  test("merging adds field by field without touching either input", () => {
    const first: DeviceHealthCounts = {
      total: 3,
      down: 1,
      degraded: 0,
      healthy: 2,
      unknown: 0,
    };
    const second: DeviceHealthCounts = {
      total: 4,
      down: 0,
      degraded: 2,
      healthy: 1,
      unknown: 1,
    };
    expect(mergeDeviceHealthCounts(first, second)).toEqual({
      total: 7,
      down: 1,
      degraded: 2,
      healthy: 3,
      unknown: 1,
    });
    expect(first.total).toBe(3);
    expect(second.total).toBe(4);
  });

  test("attention is exactly down plus degraded — never unknown", () => {
    expect(
      deviceAttentionCount({
        total: 10,
        down: 2,
        degraded: 3,
        healthy: 1,
        unknown: 4,
      }),
    ).toBe(5);
    expect(deviceAttentionCount(emptyDeviceHealthCounts())).toBe(0);
  });
});

describe("worstDeviceHealthState", () => {
  test("one down device outranks any number of healthy ones", () => {
    expect(
      worstDeviceHealthState({
        total: 40,
        down: 1,
        degraded: 5,
        healthy: 34,
        unknown: 0,
      }),
    ).toBe("down");
  });

  test("degraded outranks healthy", () => {
    expect(
      worstDeviceHealthState({
        total: 10,
        down: 0,
        degraded: 1,
        healthy: 9,
        unknown: 0,
      }),
    ).toBe("degraded");
  });

  test("healthy outranks unknown — one confirmed answer is a verdict", () => {
    expect(
      worstDeviceHealthState({
        total: 5,
        down: 0,
        degraded: 0,
        healthy: 1,
        unknown: 4,
      }),
    ).toBe("healthy");
  });

  test("a subtree of nothing but never-polled devices is unknown", () => {
    expect(
      worstDeviceHealthState({
        total: 3,
        down: 0,
        degraded: 0,
        healthy: 0,
        unknown: 3,
      }),
    ).toBe("unknown");
  });

  test("an empty subtree is unknown, not healthy", () => {
    expect(worstDeviceHealthState(emptyDeviceHealthCounts())).toBe("unknown");
  });
});
