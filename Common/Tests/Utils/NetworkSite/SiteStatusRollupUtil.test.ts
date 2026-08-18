import SiteStatusRollupUtil, {
  DeviceHealthState,
  RollupStatusOption,
} from "../../../Utils/NetworkSite/SiteStatusRollupUtil";

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
});
