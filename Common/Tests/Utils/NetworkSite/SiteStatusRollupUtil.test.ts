import SiteStatusRollupUtil, {
  DeviceHealthState,
  RollupStatusOption,
} from "../../../Utils/NetworkSite/SiteStatusRollupUtil";

/*
 * MonitorStatus priority is HIGHER = WORSE (seeded: Operational 1,
 * Degraded 2, Offline 3).
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

function worst(
  deviceStates: Array<DeviceHealthState>,
  overrides?: {
    operationalStatus?: RollupStatusOption | null;
    offlineStatus?: RollupStatusOption | null;
    freshnessWindowInMinutes?: number;
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
    freshnessWindowInMinutes: overrides?.freshnessWindowInMinutes,
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

  it("a fresh unmonitored device maps to the operational equivalent", () => {
    expect(worst([{ lastSeenAt: minutesAgo(5) }])).toBe(
      OPERATIONAL.monitorStatusId,
    );
  });

  it("a stale unmonitored device maps to the offline equivalent", () => {
    expect(worst([{ lastSeenAt: minutesAgo(30) }])).toBe(
      OFFLINE.monitorStatusId,
    );
  });

  it("a never-seen unmonitored device maps to the offline equivalent", () => {
    expect(worst([{}])).toBe(OFFLINE.monitorStatusId);
    expect(worst([{ lastSeenAt: null }])).toBe(OFFLINE.monitorStatusId);
  });

  it("freshness boundary: exactly 15 minutes is still fresh, beyond is not", () => {
    expect(worst([{ lastSeenAt: minutesAgo(15) }])).toBe(
      OPERATIONAL.monitorStatusId,
    );
    expect(
      worst([{ lastSeenAt: new Date(minutesAgo(15).getTime() - 1) }]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("mix: a stale unmonitored device outranks a monitored operational one", () => {
    expect(
      worst([
        {
          currentMonitorStatusId: OPERATIONAL.monitorStatusId,
          monitorStatusPriority: OPERATIONAL.priority,
        },
        { lastSeenAt: minutesAgo(60) },
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("mix: a monitored offline device outranks fresh unmonitored ones", () => {
    expect(
      worst([
        { lastSeenAt: minutesAgo(1) },
        {
          currentMonitorStatusId: OFFLINE.monitorStatusId,
          monitorStatusPriority: OFFLINE.priority,
        },
        { lastSeenAt: minutesAgo(2) },
      ]),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("a stamped status whose priority is unknown falls back to freshness", () => {
    // The MonitorStatus row was deleted: treat the device by lastSeenAt.
    expect(
      worst([
        {
          currentMonitorStatusId: "deleted-status",
          monitorStatusPriority: undefined,
          lastSeenAt: minutesAgo(1),
        },
      ]),
    ).toBe(OPERATIONAL.monitorStatusId);
    expect(
      worst([
        {
          currentMonitorStatusId: "deleted-status",
          monitorStatusPriority: null,
          lastSeenAt: minutesAgo(120),
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

  it("returns null when only freshness fallbacks apply but the project has no flagged rows", () => {
    expect(
      worst([{ lastSeenAt: minutesAgo(1) }, { lastSeenAt: minutesAgo(60) }], {
        operationalStatus: null,
        offlineStatus: null,
      }),
    ).toBeNull();
  });

  it("skips devices without a usable fallback but keeps the rest", () => {
    expect(
      worst(
        [
          { lastSeenAt: minutesAgo(60) }, // offline equivalent missing -> skipped
          {
            currentMonitorStatusId: DEGRADED.monitorStatusId,
            monitorStatusPriority: DEGRADED.priority,
          },
        ],
        { offlineStatus: null },
      ),
    ).toBe(DEGRADED.monitorStatusId);
  });

  it("honors a custom freshness window", () => {
    expect(
      worst([{ lastSeenAt: minutesAgo(20) }], {
        freshnessWindowInMinutes: 30,
      }),
    ).toBe(OPERATIONAL.monitorStatusId);
    expect(
      worst([{ lastSeenAt: minutesAgo(20) }], {
        freshnessWindowInMinutes: 10,
      }),
    ).toBe(OFFLINE.monitorStatusId);
  });

  it("a lastSeenAt in the future counts as fresh, not an error", () => {
    expect(worst([{ lastSeenAt: minutesAgo(-5) }])).toBe(
      OPERATIONAL.monitorStatusId,
    );
  });

  it("exposes the default freshness window as 15 minutes", () => {
    expect(SiteStatusRollupUtil.DEFAULT_FRESHNESS_WINDOW_IN_MINUTES).toBe(15);
  });
});
