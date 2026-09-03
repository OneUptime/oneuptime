import SiteStatusRollupUtil, {
  DeviceHealthShare,
  DeviceHealthState,
  RollupStatusLadder,
  RollupStatusOption,
} from "../../../Utils/NetworkSite/SiteStatusRollupUtil";
import SiteHealthRollupPolicy from "../../../Types/NetworkSite/SiteHealthRollupPolicy";

/*
 * MonitorStatus priority is HIGHER = WORSE (seeded: Operational 1,
 * Degraded 2, Offline 3).
 *
 * The SNMP half of this rollup now asks DeviceReachabilityUtil — "did the
 * last poll succeed" — rather than "was the last success recent". That is
 * what stops a site card going red because its probe is behind on a large
 * fleet while every device under it is answering (issue #3220).
 */
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

const NOW: Date = new Date("2026-07-22T12:00:00Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

// A device whose last poll succeeded `minutes` ago.
function answered(minutes: number): DeviceHealthState {
  return {
    isReachable: true,
    lastPolledAt: minutesAgo(minutes),
    lastSeenAt: minutesAgo(minutes),
    pollingIntervalInMinutes: 5,
  };
}

// A device whose last poll failed `minutes` ago.
function failed(minutes: number): DeviceHealthState {
  return {
    isReachable: false,
    lastPolledAt: minutesAgo(minutes),
    lastSeenAt: minutesAgo(minutes + 60),
    pollingIntervalInMinutes: 5,
  };
}

function worst(
  deviceStates: Array<DeviceHealthState>,
  overrides?: {
    operationalStatus?: RollupStatusOption | null;
    offlineStatus?: RollupStatusOption | null;
  },
): string | null {
  return SiteStatusRollupUtil.worstStatus({
    deviceStates,
    operationalStatus:
      overrides && "operationalStatus" in overrides
        ? overrides.operationalStatus
        : OPERATIONAL,
    offlineStatus:
      overrides && "offlineStatus" in overrides
        ? overrides.offlineStatus
        : OFFLINE,
    now: NOW,
  });
}

describe("SiteStatusRollupUtil.worstStatus", () => {
  it("returns null for an empty device set (no-op)", () => {
    expect(worst([])).toBeNull();
  });

  it("a single monitored device contributes its stamped status", () => {
    expect(
      worst([
        {
          currentMonitorStatusId: DEGRADED.monitorStatusId,
          monitorStatusPriority: DEGRADED.priority,
        },
      ]),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("the worst (highest priority) stamped status wins", () => {
    expect(
      worst([
        {
          currentMonitorStatusId: OPERATIONAL.monitorStatusId,
          monitorStatusPriority: OPERATIONAL.priority,
        },
        {
          currentMonitorStatusId: OFFLINE.monitorStatusId,
          monitorStatusPriority: OFFLINE.priority,
        },
        {
          currentMonitorStatusId: DEGRADED.monitorStatusId,
          monitorStatusPriority: DEGRADED.priority,
        },
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("a device whose last poll succeeded maps to the operational equivalent", () => {
    expect(worst([answered(5)])).toBe(OPERATIONAL.monitorStatusId);
  });

  it("a device whose last poll failed maps to the offline equivalent", () => {
    expect(worst([failed(2)])).toBe(OFFLINE.monitorStatusId);
  });

  /*
   * The rollup half of issue #3220. 21 minutes was the reported lag on a
   * fleet the probe could not get round in 15, and every device under the
   * site was answering.
   */
  it("issue #3220: a site whose devices are all answering, 21 minutes behind, is operational", () => {
    expect(worst([answered(21), answered(19), answered(25)])).toBe(
      OPERATIONAL.monitorStatusId,
    );
  });

  it("a slow-polled device is operational right up to its next poll", () => {
    expect(
      worst([
        {
          isReachable: true,
          lastPolledAt: minutesAgo(29),
          lastSeenAt: minutesAgo(29),
          pollingIntervalInMinutes: 30,
        },
      ]),
    ).toBe(OPERATIONAL.monitorStatusId);
  });

  /*
   * A site nothing has polled for hours keeps its last known status rather
   * than flipping offline. Turning "nobody has checked lately" into a red
   * site card is the same inference this change removed from the device
   * pill — and doing it here alone would put the site card at odds with
   * every device under it, which is the inconsistency issue #3220 reported.
   */
  it("a device out of contact past its stale window keeps its last verdict", () => {
    expect(worst([answered(61)])).toBe(OPERATIONAL.monitorStatusId);
    expect(worst([answered(60 * 24)])).toBe(OPERATIONAL.monitorStatusId);
  });

  it("...but a device that actually failed its last poll still rolls up offline", () => {
    expect(worst([failed(60 * 24)])).toBe(OFFLINE.monitorStatusId);
  });

  /*
   * Changed deliberately: a never-polled device used to be counted as
   * offline, which pinned a brand-new site red until its first walk landed
   * — while the device list showed the very same device as a gray
   * "Pending". It now contributes nothing, and the caller reads null as
   * "leave the site's status alone".
   */
  it("a never-polled device contributes nothing at all", () => {
    expect(worst([{}])).toBeNull();
    expect(worst([{ isReachable: null, lastSeenAt: null }])).toBeNull();
  });

  it("a never-polled device does not drag down a site with healthy devices", () => {
    expect(worst([answered(1), {}])).toBe(OPERATIONAL.monitorStatusId);
  });

  it("mix: a failing device outranks a monitored operational one", () => {
    expect(
      worst([
        {
          currentMonitorStatusId: OPERATIONAL.monitorStatusId,
          monitorStatusPriority: OPERATIONAL.priority,
        },
        failed(1),
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("mix: a monitored offline device outranks answering ones", () => {
    expect(
      worst([
        answered(1),
        {
          currentMonitorStatusId: OFFLINE.monitorStatusId,
          monitorStatusPriority: OFFLINE.priority,
        },
        answered(2),
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("a stamped status whose priority is unknown falls back to reachability", () => {
    // The MonitorStatus row was deleted: treat the device by its last poll.
    expect(
      worst([
        {
          currentMonitorStatusId: "deleted-status",
          monitorStatusPriority: undefined,
          ...answered(1),
        },
      ]),
    ).toBe(OPERATIONAL.monitorStatusId);
    expect(
      worst([
        {
          currentMonitorStatusId: "deleted-status",
          monitorStatusPriority: null,
          ...failed(1),
        },
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("priority ties keep the first contributor (stable)", () => {
    expect(
      worst([
        {
          currentMonitorStatusId: "status-a",
          monitorStatusPriority: 2,
        },
        {
          currentMonitorStatusId: "status-b",
          monitorStatusPriority: 2,
        },
      ]),
    ).toBe("status-a");
  });

  it("returns null when only SNMP fallbacks apply but the project has no flagged rows", () => {
    expect(
      worst([answered(1), failed(1)], {
        operationalStatus: null,
        offlineStatus: null,
      }),
    ).toBeNull();
  });

  it("skips devices without a usable fallback but keeps the rest", () => {
    expect(
      worst(
        [
          failed(1), // offline equivalent missing -> skipped
          {
            currentMonitorStatusId: DEGRADED.monitorStatusId,
            monitorStatusPriority: DEGRADED.priority,
          },
        ],
        { offlineStatus: null },
      ),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("a lastPolledAt in the future counts as fresh, not an error", () => {
    expect(
      worst([
        {
          isReachable: true,
          lastPolledAt: minutesAgo(-5),
          lastSeenAt: minutesAgo(-5),
        },
      ]),
    ).toBe(OPERATIONAL.monitorStatusId);
  });

  /*
   * Rows written before the reachability columns existed carry only
   * lastSeenAt. They must keep rolling up sensibly until the upgrade
   * migration (or their next walk) fills the rest in.
   */
  it("legacy rows with only lastSeenAt still roll up by freshness", () => {
    /*
     * The one place freshness survives: a row written before isReachable
     * existed has nothing else to go on. The upgrade migration backfills
     * these, so it is a short-lived path.
     */
    expect(worst([{ lastSeenAt: minutesAgo(5) }])).toBe(
      OPERATIONAL.monitorStatusId,
    );
    expect(worst([{ lastSeenAt: minutesAgo(600) }])).toBe(
      OFFLINE.monitorStatusId,
    );
  });

  /*
   * Issue #3562: the legacy branch above must never fire for a device that
   * is not polled at all. A monitor-backed device switched over from SNMP
   * keeps its old lastSeenAt until the switch-over clears it, and with no
   * stamp yet it is Pending — not a months-old freshness verdict against
   * the site.
   */
  it("a monitor-backed device with no stamp contributes nothing, whatever its leftover poll columns say", () => {
    const leftovers: DeviceHealthState = {
      lastSeenAt: minutesAgo(600),
      pollingIntervalInMinutes: 5,
      monitoringMethod: "Monitor",
    };

    expect(worst([leftovers])).toBeNull();
    expect(worst([leftovers, answered(1)])).toBe(OPERATIONAL.monitorStatusId);
    // A mirrored outcome without a stamp is not a vote either.
    expect(worst([{ ...leftovers, isReachable: false }])).toBeNull();
  });
});

/*
 * The percent-threshold policy (issue #3431).
 *
 * The complaint it answers: a Region above four hundred stores rolled up
 * worst-of, so one dark switch in one store painted the whole region
 * Offline and the region card could never be green. These pin the share
 * arithmetic — including the two places it is easy to get wrong: buckets
 * carry a COUNT (a bucket of 400 healthy devices is not one vote), and a
 * threshold of zero must not make a perfectly healthy region offline.
 */

const LADDER: RollupStatusLadder = {
  operationalStatus: OPERATIONAL,
  degradedStatus: DEGRADED,
  offlineStatus: OFFLINE,
};

// A bucket of `count` devices carrying a stamped, resolved status.
function stamped(
  status: RollupStatusOption,
  isOperational: boolean,
  count: number,
): DeviceHealthState {
  return {
    currentMonitorStatusId: status.monitorStatusId,
    monitorStatusPriority: status.priority,
    monitorStatusIsOperational: isOperational,
    deviceCount: count,
  };
}

function percent(
  deviceStates: Array<DeviceHealthState>,
  offlineThresholdPercent?: number | null,
  ladder: RollupStatusLadder = LADDER,
): string | null {
  return SiteStatusRollupUtil.percentThresholdStatus({
    deviceStates: deviceStates,
    ladder: ladder,
    offlineThresholdPercent: offlineThresholdPercent,
    now: NOW,
  });
}

describe("SiteStatusRollupUtil.deviceHealthShare", () => {
  it("counts DEVICES, not buckets", () => {
    /*
     * The whole point. Two buckets — 399 healthy, 1 down — is 0.25% down,
     * not 50%. Reading the bucket count instead is what would reproduce
     * the original complaint under a different name.
     */
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [
        stamped(OPERATIONAL, true, 399),
        stamped(OFFLINE, false, 1),
      ],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(400);
    expect(share.nonOperationalDeviceCount).toBe(1);
    expect(share.nonOperationalPercent).toBeCloseTo(0.25, 10);
  });

  it("an entry with no deviceCount stands for exactly one device", () => {
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [answered(1), failed(1)],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(2);
    expect(share.nonOperationalDeviceCount).toBe(1);
    expect(share.nonOperationalPercent).toBe(50);
  });

  it("never-reported devices are in neither the numerator nor the denominator", () => {
    /*
     * A region half-way through its first discovery walk is scored on the
     * half that has answered. Counting pending devices as down would pin it
     * red for as long as the walk takes; counting them as up would inflate
     * the denominator and mask a real outage.
     */
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [
        answered(1),
        failed(1),
        { deviceCount: 500 },
        { isReachable: null, lastPolledAt: null, lastSeenAt: null },
      ],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(2);
    expect(share.nonOperationalDeviceCount).toBe(1);
  });

  /*
   * Issue #3562: an unstamped monitor-backed bucket is a never-reported
   * bucket, whatever its leftover poll columns say — it goes in neither
   * side, so four hundred ping-only devices awaiting their first monitor
   * evaluation cannot dilute the one switch that is genuinely dark.
   */
  it("unstamped monitor-backed devices are in neither side either, whatever their leftovers say", () => {
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [
        failed(1),
        {
          lastSeenAt: minutesAgo(600),
          pollingIntervalInMinutes: 5,
          monitoringMethod: "Monitor",
          deviceCount: 400,
        },
      ],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(1);
    expect(share.nonOperationalDeviceCount).toBe(1);
    expect(share.nonOperationalPercent).toBe(100);
  });

  it("falls back to reachability when the stamped status could not be resolved", () => {
    /*
     * Same fallback worst-of takes when it cannot resolve the row's
     * priority. If the two policies disagreed about which devices their
     * stamped status speaks for, the same fleet would read differently
     * depending on which policy a site happened to use.
     */
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [
        {
          currentMonitorStatusId: "status-deleted-since",
          isReachable: true,
          lastPolledAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
          pollingIntervalInMinutes: 5,
        },
      ],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(1);
    expect(share.nonOperationalDeviceCount).toBe(0);
  });

  it("reports a zero share rather than dividing by zero on an empty subtree", () => {
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [],
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(0);
    expect(share.nonOperationalPercent).toBe(0);
  });
});

describe("SiteStatusRollupUtil.percentThresholdStatus", () => {
  it("one dark switch under four hundred stores leaves the region degraded, not offline", () => {
    expect(
      percent(
        [stamped(OPERATIONAL, true, 399), stamped(OFFLINE, false, 1)],
        50,
      ),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("goes offline once the share reaches the threshold", () => {
    expect(
      percent(
        [stamped(OPERATIONAL, true, 200), stamped(OFFLINE, false, 200)],
        50,
      ),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("is operational when nothing is down", () => {
    expect(percent([stamped(OPERATIONAL, true, 400)], 50)).toBe(
      OPERATIONAL.monitorStatusId,
    );
  });

  it("a zero threshold means 'any device down is offline', not 'always offline'", () => {
    expect(percent([stamped(OPERATIONAL, true, 400)], 0)).toBe(
      OPERATIONAL.monitorStatusId,
    );
    expect(
      percent([stamped(OPERATIONAL, true, 399), stamped(OFFLINE, false, 1)], 0),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("clamps an out-of-range or missing threshold instead of refusing to roll up", () => {
    // Above 100 can never be reached, so anything down is degraded.
    expect(
      percent(
        [stamped(OPERATIONAL, true, 1), stamped(OFFLINE, false, 1)],
        1000,
      ),
    ).toBe(DEGRADED.monitorStatusId);
    // Below zero behaves as zero.
    expect(
      percent([stamped(OPERATIONAL, true, 1), stamped(OFFLINE, false, 1)], -5),
    ).toBe(OFFLINE.monitorStatusId);
    // Missing falls back to the default (50), so 50% down is offline.
    expect(
      percent(
        [stamped(OPERATIONAL, true, 1), stamped(OFFLINE, false, 1)],
        null,
      ),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("falls back to offline when the project has no middle rung", () => {
    expect(
      percent(
        [stamped(OPERATIONAL, true, 399), stamped(OFFLINE, false, 1)],
        50,
        {
          operationalStatus: OPERATIONAL,
          offlineStatus: OFFLINE,
        },
      ),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("returns null when nothing reported, so the caller leaves the status untouched", () => {
    expect(percent([], 50)).toBeNull();
    expect(percent([{ deviceCount: 10 }], 50)).toBeNull();
  });
});

describe("SiteStatusRollupUtil.rollupStatus dispatch", () => {
  const MIXED: Array<DeviceHealthState> = [
    stamped(OPERATIONAL, true, 399),
    stamped(OFFLINE, false, 1),
  ];

  it("WorstStatus reproduces the pre-policy behaviour exactly", () => {
    expect(
      SiteStatusRollupUtil.rollupStatus({
        policy: SiteHealthRollupPolicy.WorstStatus,
        deviceStates: MIXED,
        ladder: LADDER,
        offlineThresholdPercent: 50,
        now: NOW,
      }),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("PercentThreshold routes to the share calculation", () => {
    expect(
      SiteStatusRollupUtil.rollupStatus({
        policy: SiteHealthRollupPolicy.PercentThreshold,
        deviceStates: MIXED,
        ladder: LADDER,
        offlineThresholdPercent: 50,
        now: NOW,
      }),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("an unrecognised policy string falls back to worst-of rather than leaving no verdict", () => {
    expect(
      SiteStatusRollupUtil.rollupStatus({
        policy: "SomethingNobodyDefined" as SiteHealthRollupPolicy,
        deviceStates: MIXED,
        ladder: LADDER,
        now: NOW,
      }),
    ).toBe(OFFLINE.monitorStatusId);
  });
});

/*
 * Maintenance-suppressed devices (issue #3431, follow-up review).
 *
 * The rule: a device withheld by an ongoing maintenance window leaves the
 * DENOMINATOR alone and never enters the numerator. Dropping it from both is
 * the obvious simplification and it inverts the entire feature — scheduling
 * maintenance on a HEALTHY subtree would make its parent look worse. These
 * pin that inversion shut.
 */
describe("SiteStatusRollupUtil and maintenance-suppressed devices", () => {
  it("scheduling maintenance on a HEALTHY subtree cannot escalate the parent", () => {
    /*
     * The regression, concretely. A region of 1,010 devices with 6 genuinely
     * dark is 0.59% down — degraded. Put its 1,000 healthy devices under a
     * planned window and, if they left the denominator with them, the same
     * 6 devices would read 60% and stamp the region OFFLINE. A calendar
     * entry would have caused an outage.
     */
    const beforeWindow: string | null = percent(
      [stamped(OPERATIONAL, true, 1004), stamped(OFFLINE, false, 6)],
      50,
    );
    expect(beforeWindow).toBe(DEGRADED.monitorStatusId);

    // Now 1,000 of the healthy devices are inside a window and cannot vote.
    const duringWindow: string | null =
      SiteStatusRollupUtil.percentThresholdStatus({
        deviceStates: [
          stamped(OPERATIONAL, true, 4),
          stamped(OFFLINE, false, 6),
        ],
        ladder: LADDER,
        offlineThresholdPercent: 50,
        suppressedDeviceCount: 1000,
        now: NOW,
      });

    expect(duringWindow).toBe(DEGRADED.monitorStatusId);
  });

  it("keeps the suppressed devices out of the numerator", () => {
    /*
     * The other half of the rule. Suppressed devices must not be counted as
     * DOWN either — that would let a planned window drag the parent red — the
     * very outcome the feature removes.
     */
    const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
      deviceStates: [stamped(OPERATIONAL, true, 10)],
      suppressedDeviceCount: 90,
      now: NOW,
    });

    expect(share.reportingDeviceCount).toBe(100);
    expect(share.nonOperationalDeviceCount).toBe(0);
    expect(share.nonOperationalPercent).toBe(0);
  });

  it("a subtree that is ENTIRELY under maintenance reads operational, not stale", () => {
    /*
     * Every unit below a region attached to its own window. Nothing votes.
     * Returning null here means "leave the status untouched", which would
     * pin the region at whatever it happened to say when the window opened
     * — for the whole window. Nothing unplanned is wrong, so it is up.
     */
    expect(
      SiteStatusRollupUtil.percentThresholdStatus({
        deviceStates: [],
        ladder: LADDER,
        offlineThresholdPercent: 50,
        suppressedDeviceCount: 40,
        now: NOW,
      }),
    ).toBe(OPERATIONAL.monitorStatusId);

    expect(
      SiteStatusRollupUtil.worstStatus({
        deviceStates: [],
        operationalStatus: OPERATIONAL,
        offlineStatus: OFFLINE,
        suppressedDeviceCount: 40,
        now: NOW,
      }),
    ).toBe(OPERATIONAL.monitorStatusId);
  });

  it("a genuinely empty subtree still returns null under both policies", () => {
    /*
     * No devices at all is a different fact from "all its devices are
     * under maintenance", and must keep the leave-it-alone contract.
     */
    expect(
      SiteStatusRollupUtil.percentThresholdStatus({
        deviceStates: [],
        ladder: LADDER,
        offlineThresholdPercent: 50,
        suppressedDeviceCount: 0,
        now: NOW,
      }),
    ).toBeNull();

    expect(
      SiteStatusRollupUtil.worstStatus({
        deviceStates: [],
        operationalStatus: OPERATIONAL,
        offlineStatus: OFFLINE,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("suppressed devices never outrank a real outage", () => {
    /*
     * Worst-of must still see the dark device: suppression adds a floor, it
     * does not silence what is left.
     */
    expect(
      SiteStatusRollupUtil.worstStatus({
        deviceStates: [stamped(OFFLINE, false, 1)],
        operationalStatus: OPERATIONAL,
        offlineStatus: OFFLINE,
        suppressedDeviceCount: 500,
        now: NOW,
      }),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("sanitises a nonsense suppressed count instead of poisoning the share", () => {
    /*
     * The count reaches here from a database aggregate. NaN would make every
     * comparison below it false and silently return the operational rung for
     * a region that is on fire.
     */
    for (const bad of [Number.NaN, -10, Number.POSITIVE_INFINITY]) {
      const share: DeviceHealthShare = SiteStatusRollupUtil.deviceHealthShare({
        deviceStates: [stamped(OFFLINE, false, 1)],
        suppressedDeviceCount: bad,
        now: NOW,
      });
      expect(Number.isFinite(share.reportingDeviceCount)).toBe(true);
      expect(share.reportingDeviceCount).toBe(1);
      expect(share.nonOperationalPercent).toBe(100);
    }

    // A fractional count is floored rather than dragged into the arithmetic.
    const fractional: DeviceHealthShare =
      SiteStatusRollupUtil.deviceHealthShare({
        deviceStates: [stamped(OFFLINE, false, 1)],
        suppressedDeviceCount: 3.7,
        now: NOW,
      });
    expect(fractional.reportingDeviceCount).toBe(4);
  });

  it("rollupStatus threads the suppressed count through both policies", () => {
    for (const policy of [
      SiteHealthRollupPolicy.WorstStatus,
      SiteHealthRollupPolicy.PercentThreshold,
    ]) {
      expect(
        SiteStatusRollupUtil.rollupStatus({
          policy: policy,
          deviceStates: [],
          ladder: LADDER,
          offlineThresholdPercent: 50,
          suppressedDeviceCount: 7,
          now: NOW,
        }),
      ).toBe(OPERATIONAL.monitorStatusId);
    }
  });
});

describe("percentThresholdStatus ladder fallbacks", () => {
  it("still produces a verdict at or above the threshold with no offline row", () => {
    /*
     * A project with no offline status got a verdict for a SMALL outage
     * (the degraded branch falls back) and none at all for a total one, so
     * the rollup appeared to stop working exactly when everything broke.
     */
    expect(
      percent([stamped(OFFLINE, false, 10)], 50, {
        operationalStatus: OPERATIONAL,
        degradedStatus: DEGRADED,
      }),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("falls all the way back to operational when that is the only rung", () => {
    expect(
      percent([stamped(OFFLINE, false, 10)], 50, {
        operationalStatus: OPERATIONAL,
      }),
    ).toBe(OPERATIONAL.monitorStatusId);
  });

  it("returns null when the project has no statuses at all", () => {
    expect(percent([stamped(OFFLINE, false, 10)], 50, {})).toBeNull();
  });
});

describe("SiteStatusRollupUtil.reportingDeviceCount", () => {
  /*
   * The helper exists so a caller sizing a set of devices it has EXCLUDED
   * from the vote uses the same rule as the vote itself. Counting rows
   * instead pads the denominator with devices nothing was ever measuring.
   */
  it("counts only devices that have actually reported", () => {
    expect(
      SiteStatusRollupUtil.reportingDeviceCount(
        [
          stamped(OPERATIONAL, true, 10),
          stamped(OFFLINE, false, 5),
          // Never polled, never seen — 200 of them.
          { deviceCount: 200 },
        ],
        NOW,
      ),
    ).toBe(15);
  });

  it("agrees with the share's own denominator", () => {
    const states: Array<DeviceHealthState> = [
      stamped(OPERATIONAL, true, 3),
      answered(1),
      failed(1),
      { deviceCount: 40 },
    ];

    expect(SiteStatusRollupUtil.reportingDeviceCount(states, NOW)).toBe(
      SiteStatusRollupUtil.deviceHealthShare({
        deviceStates: states,
        now: NOW,
      }).reportingDeviceCount,
    );
  });

  it("never-reported suppressed devices must not dilute a real outage", () => {
    /*
     * The regression this helper prevents, end to end. A region with 200
     * undiscovered devices inside a maintenance window and 6 of its 10 real
     * ones dark: sizing the window by ROW COUNT gives 6/210 = 2.9% and calls
     * the region Degraded, while more than half of everything that has ever
     * answered is offline.
     */
    const suppressedByRows: number = 200;
    const suppressedByRule: number = SiteStatusRollupUtil.reportingDeviceCount(
      [{ deviceCount: 200 }],
      NOW,
    );

    expect(suppressedByRule).toBe(0);

    const wrong: string | null = SiteStatusRollupUtil.percentThresholdStatus({
      deviceStates: [stamped(OPERATIONAL, true, 4), stamped(OFFLINE, false, 6)],
      ladder: LADDER,
      offlineThresholdPercent: 50,
      suppressedDeviceCount: suppressedByRows,
      now: NOW,
    });
    const right: string | null = SiteStatusRollupUtil.percentThresholdStatus({
      deviceStates: [stamped(OPERATIONAL, true, 4), stamped(OFFLINE, false, 6)],
      ladder: LADDER,
      offlineThresholdPercent: 50,
      suppressedDeviceCount: suppressedByRule,
      now: NOW,
    });

    expect(wrong).toBe(DEGRADED.monitorStatusId);
    expect(right).toBe(OFFLINE.monitorStatusId);
  });
});
