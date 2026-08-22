import { describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import {
  DeviceHealthCounts,
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
 * this function summed up, so every branch of it is pinned here: what a
 * monitor's verdict overrides, what a dark port does to a device that is
 * otherwise answering, and — the one that matters most — what stays
 * "unknown" instead of being quietly counted as either a failure or a
 * success.
 */

const NOW: Date = OneUptimeDate.fromString("2026-08-21T12:00:00.000Z");

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

describe("deviceHealthState — a monitor's verdict is the system of record", () => {
  test("a status the ladder does not call offline makes the device up, whatever the poll says", () => {
    expect(
      deviceHealthState(
        {
          monitorStatusIsOffline: false,
          // The SNMP side would say Down on its own.
          isReachable: false,
          lastPolledAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe("healthy");
  });

  test("an offline monitor status makes the device down, whatever the poll says", () => {
    expect(
      deviceHealthState(
        {
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
        { monitorStatusIsOffline: false, interfacesDown: 3 },
        NOW,
      ),
    ).toBe("degraded");
  });

  /*
   * `undefined` means "no monitor is attached", which is the ordinary case
   * for an SNMP-walked switch. It must not be read as a verdict of any kind
   * — doing so would either paint every switch in the estate down or hide
   * every real outage behind a stamped green.
   */
  test("an absent monitor status defers to reachability rather than deciding", () => {
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
 * `status.isOfflineState ? "down" : "up"`. These pin the same answer here.
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

  // Exactly what NetworkDeviceTopology.ts does with a status row.
  function mapVerdict(row: LadderRow): "up" | "down" {
    return row.isOfflineState ? "down" : "up";
  }

  test.each(LADDER)(
    "$name: the rollup agrees with the map about up/down",
    (row: LadderRow) => {
      const state: NetworkDeviceHealthState = deviceHealthState(
        { monitorStatusIsOffline: row.isOfflineState },
        NOW,
      );
      const rollupSaysDown: boolean = state === "down";
      expect(rollupSaysDown).toBe(mapVerdict(row) === "down");
    },
  );

  test("a Degraded device with no dark ports is healthy, not down", () => {
    expect(deviceHealthState({ monitorStatusIsOffline: false }, NOW)).toBe(
      "healthy",
    );
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
          { monitorStatusIsOffline: row.isOfflineState },
          NOW,
        ) === "down"
      );
    }).map((row: LadderRow) => {
      return row.name;
    });
    expect(downRungs).toEqual(["Offline"]);
  });
});

describe("deviceHealthState — reachability, when nothing is stamped", () => {
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
