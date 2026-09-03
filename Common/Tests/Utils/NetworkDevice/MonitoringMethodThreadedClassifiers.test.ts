import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OneUptimeDate from "../../../Types/Date";
import NetworkDeviceMonitoringMethod, {
  NetworkDeviceMonitoringMethodUtil,
} from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { NetworkTopologyNode } from "../../../Types/Monitor/SnmpMonitor/NetworkTopology";
import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import {
  DeviceHealthStateInput,
  NetworkDeviceHealthState,
  deviceHealthState,
} from "../../../Utils/NetworkDevice/DeviceHealthStateUtil";
import SiteStatusRollupUtil, {
  DeviceHealthShare,
  DeviceHealthState,
  RollupStatusOption,
} from "../../../Utils/NetworkSite/SiteStatusRollupUtil";
import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
} from "../../../Utils/Monitor/NetworkTopologyUtil";
import {
  DeviceHealthGroup,
  deviceHealthInputForGroup,
  deviceRollupStateForGroup,
} from "../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";

/*
 * Issue #3562 — the monitoring method reaches every classifier, not only
 * the device list.
 *
 * DeviceReachabilityUtil already knows the two kinds of NetworkDevice: an
 * SNMP one is judged by the OUTCOME of its last poll, a monitor-backed one
 * ONLY by the status its bound Monitor stamped, and a monitor-backed device
 * nothing has reported on yet is Pending. The device list pill goes through
 * that rule with `monitoringMethod` attached and gets the right answer.
 *
 * Three other surfaces build a DeviceReachabilityUtil input of their own —
 * the site card's per-device health (DeviceHealthStateUtil), the site
 * status rollup (SiteStatusRollupUtil) and the topology map
 * (NetworkTopologyUtil) — and none of them used to say what kind of device
 * it was passing. That was survivable while a monitor-backed row had NULL
 * in every poll column, because the rule can only answer Pending for that.
 * It stops being survivable the moment those columns hold anything else:
 *
 *   - a device SWITCHED from SNMP to Monitor keeps its old lastSeenAt until
 *     the switch-over clears it, and `isReachable` NULL + lastSeenAt set is
 *     the one branch of the rule where staleness alone decides — so a
 *     months-old timestamp reads as Down on the site card while the pill
 *     under it reads Pending;
 *   - the server keeps `isReachable` on a monitor-backed device in step
 *     with its Monitor (true/false, NULL when nothing is bound), and a
 *     mirrored outcome beside a stamp that has not landed yet would read as
 *     a poll verdict.
 *
 * So the field is threaded through all three inputs, and through the
 * bucket-to-input builders that feed two of them. What is pinned here:
 *
 *   1. the field is OPTIONAL, and a caller that omits it — or passes NULL,
 *      "SNMP", anything the parser reads as SNMP — behaves exactly as
 *      before, legacy freshness branch included;
 *   2. an unstamped monitor-backed device is "unknown" on the site card, is
 *      skipped by both rollup policies, and is drawn "unknown" on the map,
 *      whatever its leftover poll columns say;
 *   3. a stamped monitor-backed device is judged by the stamp on every
 *      surface, the same way the pill judges it;
 *   4. the aggregation buckets carry the field into both classifier
 *      inputs, and the topology endpoint selects and forwards it.
 */

const NOW: Date = OneUptimeDate.fromString("2026-09-01T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

/** The poll columns every classifier reads, in their raw column shape. */
interface PollColumns {
  isReachable: boolean | null;
  lastPolledAt: Date | null;
  lastSeenAt: Date | null;
  pollingIntervalInMinutes: number;
}

/*
 * What a device switched from SNMP to Monitor is left holding: no recorded
 * outcome, and a last successful walk from long before the probe stopped
 * asking. On the legacy branch of the shared rule (no outcome, but seen)
 * staleness alone decides, so this reads as Down through any classifier
 * that forgets to say what kind of device it is.
 */
const STALE_LEFTOVERS: PollColumns = {
  isReachable: null,
  lastPolledAt: null,
  lastSeenAt: minutesAgo(60 * 24 * 90),
  pollingIntervalInMinutes: 5,
};

// The same leftovers still inside the window, where that branch says Up.
const FRESH_LEFTOVERS: PollColumns = {
  isReachable: null,
  lastPolledAt: null,
  lastSeenAt: minutesAgo(2),
  pollingIntervalInMinutes: 5,
};

const NEVER_POLLED: PollColumns = {
  isReachable: null,
  lastPolledAt: null,
  lastSeenAt: null,
  pollingIntervalInMinutes: 5,
};

const ANSWERED: PollColumns = {
  isReachable: true,
  lastPolledAt: minutesAgo(1),
  lastSeenAt: minutesAgo(1),
  pollingIntervalInMinutes: 5,
};

const FAILED: PollColumns = {
  isReachable: false,
  lastPolledAt: minutesAgo(1),
  lastSeenAt: minutesAgo(600),
  pollingIntervalInMinutes: 5,
};

// The real column value, so a renamed enum member fails here and not in prod.
const MONITOR: string = NetworkDeviceMonitoringMethod.Monitor;

// MonitorStatus priority is HIGHER = WORSE (seeded: Operational 1 ... Offline 3).
const OPERATIONAL: RollupStatusOption = {
  monitorStatusId: "status-operational",
  priority: 1,
};
const DEGRADED: RollupStatusOption = {
  monitorStatusId: "status-degraded",
  priority: 2,
};
const OFFLINE: RollupStatusOption = {
  monitorStatusId: "status-offline",
  priority: 3,
};

/*
 * The ladder as each surface reads it. `isOffline` is the flag the site
 * card and the map read (NetworkDeviceTopology.ts: `isOfflineState ? "down"
 * : "up"`); `isOperational` is the one the percent-threshold share reads.
 */
interface StampedRung {
  name: string;
  option: RollupStatusOption;
  isOperational: boolean;
  isOffline: boolean;
}

const RUNGS: Array<StampedRung> = [
  {
    name: "Operational",
    option: OPERATIONAL,
    isOperational: true,
    isOffline: false,
  },
  {
    name: "Degraded",
    option: DEGRADED,
    isOperational: false,
    isOffline: false,
  },
  {
    name: "Offline",
    option: OFFLINE,
    isOperational: false,
    isOffline: true,
  },
];

function healthInput(
  columns: PollColumns,
  overrides?: Partial<DeviceHealthStateInput>,
): DeviceHealthStateInput {
  return { ...columns, ...overrides };
}

function rollupState(
  columns: PollColumns,
  overrides?: Partial<DeviceHealthState>,
): DeviceHealthState {
  return { ...columns, ...overrides };
}

// TopologyDeviceInput carries `undefined` where a column carries NULL.
function topologyInput(
  columns: PollColumns,
  overrides?: Partial<TopologyDeviceInput>,
): TopologyDeviceInput {
  return {
    id: "device-1",
    name: "device-1",
    isReachable: columns.isReachable === null ? undefined : columns.isReachable,
    lastPolledAt:
      columns.lastPolledAt === null ? undefined : columns.lastPolledAt,
    lastSeenAt: columns.lastSeenAt === null ? undefined : columns.lastSeenAt,
    pollingIntervalInMinutes: columns.pollingIntervalInMinutes,
    ...overrides,
  };
}

function topologyStatus(device: TopologyDeviceInput): string {
  const result: TopologyBuildResult = NetworkTopologyUtil.buildTopology(
    [device],
    NOW,
  );
  const node: NetworkTopologyNode | undefined = result.nodes.find(
    (candidate: NetworkTopologyNode): boolean => {
      return candidate.id === device.id;
    },
  );
  expect(node).toBeDefined();
  return node!.status;
}

function worst(deviceStates: Array<DeviceHealthState>): string | null {
  return SiteStatusRollupUtil.worstStatus({
    deviceStates: deviceStates,
    operationalStatus: OPERATIONAL,
    offlineStatus: OFFLINE,
    now: NOW,
  });
}

function share(deviceStates: Array<DeviceHealthState>): DeviceHealthShare {
  return SiteStatusRollupUtil.deviceHealthShare({
    deviceStates: deviceStates,
    now: NOW,
  });
}

const NOTHING_REPORTED: DeviceHealthShare = {
  reportingDeviceCount: 0,
  nonOperationalDeviceCount: 0,
  nonOperationalPercent: 0,
};

const ONE_DOWN: DeviceHealthShare = {
  reportingDeviceCount: 1,
  nonOperationalDeviceCount: 1,
  nonOperationalPercent: 100,
};

const ONE_UP: DeviceHealthShare = {
  reportingDeviceCount: 1,
  nonOperationalDeviceCount: 0,
  nonOperationalPercent: 0,
};

/*
 * The field is optional precisely so that nothing that does not pass it can
 * change. Every caller written before it existed — and every test of those
 * callers — must land on the same branch of the shared rule it always did,
 * legacy freshness included.
 */
describe("without a monitoring method nothing changes — the legacy path is pinned", () => {
  test("stale leftovers read as down on every surface, as they always did", () => {
    expect(deviceHealthState(healthInput(STALE_LEFTOVERS), NOW)).toBe("down");
    expect(worst([rollupState(STALE_LEFTOVERS)])).toBe(OFFLINE.monitorStatusId);
    expect(share([rollupState(STALE_LEFTOVERS)])).toEqual(ONE_DOWN);
    expect(topologyStatus(topologyInput(STALE_LEFTOVERS))).toBe("down");
  });

  test("fresh leftovers read as up on every surface, as they always did", () => {
    expect(deviceHealthState(healthInput(FRESH_LEFTOVERS), NOW)).toBe(
      "healthy",
    );
    expect(worst([rollupState(FRESH_LEFTOVERS)])).toBe(
      OPERATIONAL.monitorStatusId,
    );
    expect(share([rollupState(FRESH_LEFTOVERS)])).toEqual(ONE_UP);
    expect(topologyStatus(topologyInput(FRESH_LEFTOVERS))).toBe("up");
  });

  /*
   * Everything the parser reads as SNMP has to land on the same path as an
   * omitted value, or a row written before the column existed (NULL) would
   * classify differently from one written after it ("SNMP").
   */
  test.each([null, "", "snmp", NetworkDeviceMonitoringMethod.Snmp])(
    "a monitoring method of %j is the poll rule, exactly as if omitted",
    (monitoringMethod: string | null) => {
      expect(
        deviceHealthState(
          healthInput(STALE_LEFTOVERS, { monitoringMethod: monitoringMethod }),
          NOW,
        ),
      ).toBe("down");
      expect(
        worst([
          rollupState(STALE_LEFTOVERS, { monitoringMethod: monitoringMethod }),
        ]),
      ).toBe(OFFLINE.monitorStatusId);
      expect(
        topologyStatus(
          topologyInput(STALE_LEFTOVERS, {
            monitoringMethod: monitoringMethod,
          }),
        ),
      ).toBe("down");
    },
  );
});

describe("an unstamped monitor-backed device is Pending on every surface", () => {
  test.each([
    ["stale leftovers", STALE_LEFTOVERS],
    ["fresh leftovers", FRESH_LEFTOVERS],
    ["nothing at all", NEVER_POLLED],
  ])("with %s in its poll columns", (_label: string, columns: PollColumns) => {
    expect(
      deviceHealthState(
        healthInput(columns, { monitoringMethod: MONITOR }),
        NOW,
      ),
    ).toBe("unknown");
    expect(
      worst([rollupState(columns, { monitoringMethod: MONITOR })]),
    ).toBeNull();
    expect(
      share([rollupState(columns, { monitoringMethod: MONITOR })]),
    ).toEqual(NOTHING_REPORTED);
    expect(
      topologyStatus(topologyInput(columns, { monitoringMethod: MONITOR })),
    ).toBe("unknown");
  });

  /*
   * The server keeps `isReachable` on a monitor-backed device in step with
   * its Monitor, so a mirrored true/false can exist beside a stamp that has
   * not landed yet. A mirror is not a verdict: only the stamp is — which is
   * exactly what the pill says about the same row.
   */
  test.each([true, false])(
    "with a mirrored isReachable of %s and no stamp yet",
    (isReachable: boolean) => {
      const columns: PollColumns = { ...ANSWERED, isReachable: isReachable };

      expect(
        deviceHealthState(
          healthInput(columns, { monitoringMethod: MONITOR }),
          NOW,
        ),
      ).toBe("unknown");
      expect(
        worst([rollupState(columns, { monitoringMethod: MONITOR })]),
      ).toBeNull();
      expect(
        topologyStatus(topologyInput(columns, { monitoringMethod: MONITOR })),
      ).toBe("unknown");
    },
  );

  test("the column is parsed, not compared: any casing of the word is monitor-backed", () => {
    for (const spelling of ["monitor", "MONITOR", " Monitor "]) {
      expect(
        deviceHealthState(
          healthInput(STALE_LEFTOVERS, { monitoringMethod: spelling }),
          NOW,
        ),
      ).toBe("unknown");
      expect(
        worst([rollupState(STALE_LEFTOVERS, { monitoringMethod: spelling })]),
      ).toBeNull();
      expect(
        topologyStatus(
          topologyInput(STALE_LEFTOVERS, { monitoringMethod: spelling }),
        ),
      ).toBe("unknown");
    }
  });

  /*
   * Skipped means skipped from BOTH sides of the share, the same treatment
   * a never-polled SNMP bucket gets. Four hundred ping-only devices awaiting
   * their first monitor evaluation must not dilute the one switch that is
   * genuinely dark beside them into a 0.25% blip...
   */
  test("a bucket of unstamped monitor-backed devices does not dilute a real outage", () => {
    expect(
      share([
        rollupState(STALE_LEFTOVERS, {
          monitoringMethod: MONITOR,
          deviceCount: 400,
        }),
        rollupState(FAILED),
      ]),
    ).toEqual(ONE_DOWN);
  });

  test("...and cannot drag a healthy site down either", () => {
    expect(
      worst([
        rollupState(STALE_LEFTOVERS, { monitoringMethod: MONITOR }),
        rollupState(ANSWERED),
      ]),
    ).toBe(OPERATIONAL.monitorStatusId);
  });
});

describe("a stamped monitor-backed device is judged by the stamp, everywhere", () => {
  test.each(RUNGS)(
    "$name: the site card reads the offline end of the ladder",
    (rung: StampedRung) => {
      expect(
        deviceHealthState(
          healthInput(STALE_LEFTOVERS, {
            monitoringMethod: MONITOR,
            monitorStatusIsOffline: rung.isOffline,
          }),
          NOW,
        ),
      ).toBe(rung.isOffline ? "down" : "healthy");
    },
  );

  test.each(RUNGS)(
    "$name: worst-of carries the stamp verbatim",
    (rung: StampedRung) => {
      expect(
        worst([
          rollupState(STALE_LEFTOVERS, {
            monitoringMethod: MONITOR,
            currentMonitorStatusId: rung.option.monitorStatusId,
            monitorStatusPriority: rung.option.priority,
          }),
        ]),
      ).toBe(rung.option.monitorStatusId);
    },
  );

  test.each(RUNGS)(
    "$name: the share reads the operational end of the ladder",
    (rung: StampedRung) => {
      expect(
        share([
          rollupState(STALE_LEFTOVERS, {
            monitoringMethod: MONITOR,
            currentMonitorStatusId: rung.option.monitorStatusId,
            monitorStatusIsOperational: rung.isOperational,
          }),
        ]),
      ).toEqual(rung.isOperational ? ONE_UP : ONE_DOWN);
    },
  );

  test.each(RUNGS)("$name: the map draws the stamp", (rung: StampedRung) => {
    expect(
      topologyStatus(
        topologyInput(STALE_LEFTOVERS, {
          monitoringMethod: MONITOR,
          monitorStatus: rung.isOffline ? "down" : "up",
        }),
      ),
    ).toBe(rung.isOffline ? "down" : "up");
  });

  /*
   * The rollup falls back to reachability when a stamped row cannot be
   * resolved (a deleted status, or a lookup that missed). For an SNMP
   * device that fallback is a real poll verdict. For a monitor-backed one
   * there is nothing underneath to fall back TO — and the pill, which
   * resolves the same row, reads Pending for it — so it sits out the vote.
   */
  test("a stamp the rollup cannot resolve leaves a monitor-backed device out of the vote", () => {
    const unresolved: DeviceHealthState = rollupState(STALE_LEFTOVERS, {
      currentMonitorStatusId: "status-deleted",
    });

    expect(worst([{ ...unresolved, monitoringMethod: MONITOR }])).toBeNull();
    expect(share([{ ...unresolved, monitoringMethod: MONITOR }])).toEqual(
      NOTHING_REPORTED,
    );
    // Whereas the SNMP device beside it still has its poll to fall back to.
    expect(worst([unresolved])).toBe(OFFLINE.monitorStatusId);
  });
});

/*
 * The invariant all of the above serves, stated once over the whole
 * matrix: for every row this change is about, the three surfaces answer
 * what the device list pill answers. The pill IS DeviceReachabilityUtil
 * with the same columns, so it is used as the oracle rather than a
 * hand-written expectation per cell.
 */
describe("the site card, the rollup and the map agree with the device list pill", () => {
  interface MatrixCase {
    label: string;
    monitoringMethod: string | null | undefined;
    monitorStatusIsOffline: boolean | undefined;
    columns: PollColumns;
  }

  const METHODS: Array<string | null | undefined> = [
    undefined,
    null,
    "SNMP",
    MONITOR,
  ];
  const STAMPS: Array<boolean | undefined> = [undefined, false, true];
  const COLUMN_SETS: Array<[string, PollColumns]> = [
    ["stale leftovers", STALE_LEFTOVERS],
    ["fresh leftovers", FRESH_LEFTOVERS],
    ["never polled", NEVER_POLLED],
    ["answered", ANSWERED],
    ["failed", FAILED],
  ];

  const cases: Array<MatrixCase> = [];

  for (const monitoringMethod of METHODS) {
    for (const monitorStatusIsOffline of STAMPS) {
      for (const [label, columns] of COLUMN_SETS) {
        /*
         * A stamped SNMP device is out of scope. The pill judges it by its
         * poll and the classifiers by its stamp (a Network Device monitor's
         * verdict is the operator's system of record on the site card and
         * the map). That precedence predates this field and is not what it
         * is about.
         */
        if (
          !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            monitoringMethod,
          ) &&
          monitorStatusIsOffline !== undefined
        ) {
          continue;
        }

        cases.push({
          label: `${label} / method ${String(monitoringMethod)} / stamp ${String(monitorStatusIsOffline)}`,
          monitoringMethod: monitoringMethod,
          monitorStatusIsOffline: monitorStatusIsOffline,
          columns: columns,
        });
      }
    }
  }

  function pill(testCase: MatrixCase): NetworkDeviceReachability {
    return DeviceReachabilityUtil.getStatus(
      {
        ...testCase.columns,
        monitoringMethod: testCase.monitoringMethod,
        monitorStatusIsOffline: testCase.monitorStatusIsOffline,
      },
      NOW,
    );
  }

  test("the matrix reaches every verdict the pill can give", () => {
    const seen: Set<NetworkDeviceReachability> =
      new Set<NetworkDeviceReachability>(cases.map(pill));

    expect(Array.from(seen).sort()).toEqual(
      [
        NetworkDeviceReachability.Down,
        NetworkDeviceReachability.Pending,
        NetworkDeviceReachability.Up,
      ].sort(),
    );
  });

  test("the site card", () => {
    const disagreements: Array<string> = [];

    for (const testCase of cases) {
      const verdict: NetworkDeviceReachability = pill(testCase);
      const expected: NetworkDeviceHealthState =
        verdict === NetworkDeviceReachability.Pending
          ? "unknown"
          : verdict === NetworkDeviceReachability.Up
            ? "healthy"
            : "down";

      const actual: NetworkDeviceHealthState = deviceHealthState(
        healthInput(testCase.columns, {
          monitoringMethod: testCase.monitoringMethod,
          monitorStatusIsOffline: testCase.monitorStatusIsOffline,
        }),
        NOW,
      );

      if (actual !== expected) {
        disagreements.push(`${testCase.label}: pill=${verdict} card=${actual}`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("the worst-of rollup", () => {
    const disagreements: Array<string> = [];

    for (const testCase of cases) {
      const verdict: NetworkDeviceReachability = pill(testCase);
      const expected: string | null =
        verdict === NetworkDeviceReachability.Pending
          ? null
          : verdict === NetworkDeviceReachability.Up
            ? OPERATIONAL.monitorStatusId
            : OFFLINE.monitorStatusId;

      // A stamp reaches the rollup as the status row it resolved to.
      const stamp: RollupStatusOption | undefined =
        testCase.monitorStatusIsOffline === undefined
          ? undefined
          : testCase.monitorStatusIsOffline
            ? OFFLINE
            : OPERATIONAL;

      const actual: string | null = worst([
        rollupState(testCase.columns, {
          monitoringMethod: testCase.monitoringMethod,
          currentMonitorStatusId: stamp?.monitorStatusId,
          monitorStatusPriority: stamp?.priority,
        }),
      ]);

      if (actual !== expected) {
        disagreements.push(
          `${testCase.label}: pill=${verdict} rollup=${String(actual)}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("the map", () => {
    const disagreements: Array<string> = [];

    for (const testCase of cases) {
      const verdict: NetworkDeviceReachability = pill(testCase);
      const expected: string =
        verdict === NetworkDeviceReachability.Pending
          ? "unknown"
          : verdict === NetworkDeviceReachability.Up
            ? "up"
            : "down";

      const actual: string = topologyStatus(
        topologyInput(testCase.columns, {
          monitoringMethod: testCase.monitoringMethod,
          monitorStatus:
            testCase.monitorStatusIsOffline === undefined
              ? undefined
              : testCase.monitorStatusIsOffline
                ? "down"
                : "up",
        }),
      );

      if (actual !== expected) {
        disagreements.push(`${testCase.label}: pill=${verdict} map=${actual}`);
      }
    }

    expect(disagreements).toEqual([]);
  });
});

/*
 * The site card and the rollup never see rows — they see buckets, grouped in
 * SQL by the facts the classifiers read and turned back into classifier
 * inputs by DeviceHealthAggregation. The method is one of those facts, so
 * both builders have to carry it or the whole thread above is cut at the
 * database.
 */
describe("buckets carry the method into both classifier inputs", () => {
  // An unstamped bucket of stale leftovers: the legacy branch, on purpose.
  function bucket(overrides: Partial<DeviceHealthGroup>): DeviceHealthGroup {
    return {
      siteId: null,
      monitorStatusId: null,
      monitoringMethod: null,
      isReachable: null,
      hasBeenPolled: false,
      hasBeenSeen: true,
      isStale: true,
      hasDownInterfaces: false,
      deviceCount: 1,
      interfacesDownTotal: 0,
      ...overrides,
    };
  }

  test.each([null, "SNMP", MONITOR])(
    "deviceHealthInputForGroup emits %j verbatim",
    (monitoringMethod: string | null) => {
      expect(
        deviceHealthInputForGroup({
          group: bucket({ monitoringMethod: monitoringMethod }),
          now: NOW,
        }).monitoringMethod,
      ).toBe(monitoringMethod);
    },
  );

  test.each([null, "SNMP", MONITOR])(
    "deviceRollupStateForGroup emits %j verbatim",
    (monitoringMethod: string | null) => {
      expect(
        deviceRollupStateForGroup({
          group: bucket({ monitoringMethod: monitoringMethod }),
          now: NOW,
        }).monitoringMethod,
      ).toBe(monitoringMethod);
    },
  );

  test("the same stale bucket is down as SNMP and unknown as monitor-backed", () => {
    const snmp: DeviceHealthGroup = bucket({});
    const monitorBacked: DeviceHealthGroup = bucket({
      monitoringMethod: MONITOR,
    });

    expect(
      deviceHealthState(
        deviceHealthInputForGroup({ group: snmp, now: NOW }),
        NOW,
      ),
    ).toBe("down");
    expect(
      deviceHealthState(
        deviceHealthInputForGroup({ group: monitorBacked, now: NOW }),
        NOW,
      ),
    ).toBe("unknown");

    expect(worst([deviceRollupStateForGroup({ group: snmp, now: NOW })])).toBe(
      OFFLINE.monitorStatusId,
    );
    expect(
      worst([deviceRollupStateForGroup({ group: monitorBacked, now: NOW })]),
    ).toBeNull();
  });
});

/*
 * The map's endpoint is the one caller that maps device ROWS into
 * TopologyDeviceInput by hand, so it has to select the column and copy it
 * across — and neither omission would fail to compile or throw. It lives in
 * App, which this suite cannot import, so it is asserted against the source
 * the way App's own surface-invariant tests are. Whitespace is squashed
 * first so prettier re-wrapping a line cannot turn this into a red herring.
 */
describe("the topology endpoint selects the column and forwards it", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "BaseAPI",
        "API",
        "NetworkDeviceTopology.ts",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");

  /*
   * The object literal enclosing the first occurrence of `needle`, found by
   * brace matching outwards — so an assertion about "the device select" is
   * made against that literal and not against the whole file.
   */
  function enclosingLiteral(needle: string): string {
    const needleAt: number = source.indexOf(needle);
    expect(needleAt).toBeGreaterThanOrEqual(0);

    let start: number = -1;
    let depth: number = 0;

    for (let index: number = needleAt; index >= 0; index--) {
      const character: string = source[index]!;

      if (character === "}") {
        depth++;
      } else if (character === "{") {
        if (depth === 0) {
          start = index;
          break;
        }
        depth--;
      }
    }

    expect(start).toBeGreaterThanOrEqual(0);

    depth = 0;

    for (let index: number = start; index < source.length; index++) {
      const character: string = source[index]!;

      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
        if (depth === 0) {
          return source.slice(start, index + 1);
        }
      }
    }

    throw new Error(`Unbalanced literal around ${needle}`);
  }

  test("the device select asks for monitoringMethod beside the poll columns", () => {
    const select: string = enclosingLiteral("isReachable: true,");

    expect(select).toContain("monitoringMethod: true,");
    // ...and still for the stamp, which is what the method qualifies.
    expect(select).toContain("currentMonitorStatusId: true,");
  });

  test("the row is forwarded to the graph input with the method attached", () => {
    const mapping: string = enclosingLiteral(
      "isReachable: device.isReachable,",
    );

    expect(mapping).toContain("monitoringMethod: device.monitoringMethod,");
  });
});
