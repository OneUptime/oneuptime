import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSiteStatusTimelineService from "../../../Server/Services/NetworkSiteStatusTimelineService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkSiteMaintenanceSuppression from "../../../Server/Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { DeviceHealthGroup } from "../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import SiteHealthRollupPolicy from "../../../Types/NetworkSite/SiteHealthRollupPolicy";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * The rollup engine's two new inputs (issue #3431):
 *
 *   - the site's health rollup POLICY, and
 *   - which descendants a scheduled maintenance window is currently
 *     silencing.
 *
 * The maintenance rule is asymmetric on purpose and that asymmetry is the
 * thing most likely to be "simplified" wrongly later:
 *
 *   A site that is itself under maintenance suppresses NOTHING — not even
 *   its own maintained descendants — because its rollup is supposed to show
 *   the planned outage. Only an ancestor looking DOWN past a maintained
 *   subtree drops it.
 *
 * Everything below the service boundary is spied; no database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const UNIT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_UNIT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const OPERATIONAL_STATUS_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEGRADED_STATUS_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OFFLINE_STATUS_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function statuses(): Array<MonitorStatus> {
  return [
    {
      id: new ObjectID(OPERATIONAL_STATUS_ID),
      name: "Operational",
      priority: 1,
      isOperationalState: true,
      isOfflineState: false,
    },
    {
      id: new ObjectID(DEGRADED_STATUS_ID),
      name: "Degraded",
      priority: 2,
      isOperationalState: false,
      isOfflineState: false,
    },
    {
      id: new ObjectID(OFFLINE_STATUS_ID),
      name: "Offline",
      priority: 3,
      isOperationalState: false,
      isOfflineState: true,
    },
  ] as unknown as Array<MonitorStatus>;
}

// A bucket of `deviceCount` devices at one site, carrying one stamped status.
function group(
  siteId: ObjectID,
  monitorStatusId: string,
  deviceCount: number,
): DeviceHealthGroup {
  return {
    siteId: siteId.toString(),
    monitorStatusId: monitorStatusId,
    monitoringMethod: null,
    isReachable: null,
    hasBeenPolled: true,
    hasBeenSeen: true,
    isStale: false,
    hasDownInterfaces: false,
    deviceCount: deviceCount,
    interfacesDownTotal: 0,
  };
}

interface Harness {
  updateColumns: jest.SpyInstance;
  healthGroups: jest.SpyInstance;
  timelineCreate: jest.SpyInstance;
}

function setup(data: {
  site: Partial<NetworkSite>;
  descendantIds?: Array<ObjectID> | undefined;
  maintainedSiteIds?: Array<ObjectID> | undefined;
  groupsBySite: (siteIds: Array<ObjectID>) => Array<DeviceHealthGroup>;
}): Harness {
  jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue({
    id: REGION_ID,
    _id: REGION_ID.toString(),
    projectId: PROJECT_ID,
    ...data.site,
  } as unknown as NetworkSite);

  jest
    .spyOn(NetworkSiteService, "getDescendantSiteIds")
    .mockResolvedValue(data.descendantIds || []);

  jest
    .spyOn(
      NetworkSiteMaintenanceSuppression,
      "getSiteIdsUnderOngoingMaintenance",
    )
    .mockResolvedValue(
      new Set<string>(
        (data.maintainedSiteIds || []).map((id: ObjectID) => {
          return id.toString();
        }),
      ),
    );

  const healthGroups: jest.SpyInstance = jest
    .spyOn(NetworkDeviceService, "getHealthGroupsForSites")
    .mockImplementation(
      (input: {
        siteIds: Array<ObjectID>;
      }): Promise<Array<DeviceHealthGroup>> => {
        return Promise.resolve(data.groupsBySite(input.siteIds));
      },
    );

  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue(statuses());

  const updateColumns: jest.SpyInstance = jest
    .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(NetworkSiteStatusTimelineService, "updateBy")
    .mockResolvedValue(0 as never);
  const timelineCreate: jest.SpyInstance = jest
    .spyOn(NetworkSiteStatusTimelineService, "create")
    .mockResolvedValue({} as never);

  return { updateColumns, healthGroups, timelineCreate };
}

function persistedStatusId(harness: Harness): string | undefined {
  for (const call of harness.updateColumns.mock.calls) {
    const args: { data: { currentMonitorStatusId?: ObjectID } } = call[0] as {
      data: { currentMonitorStatusId?: ObjectID };
    };
    if (args.data.currentMonitorStatusId) {
      return args.data.currentMonitorStatusId.toString();
    }
  }
  return undefined;
}

function queriedSiteIds(harness: Harness): Array<string> {
  const args: { siteIds: Array<ObjectID> } = harness.healthGroups.mock
    .calls[0]![0] as { siteIds: Array<ObjectID> };
  return args.siteIds.map((id: ObjectID) => {
    return id.toString();
  });
}

describe("recomputeRollupForSite honours the site's rollup policy", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("WorstStatus (the default) turns a region offline for one dark switch", () => {
    /*
     * The behaviour the issue was filed about, kept as the default so that
     * upgrading changes nothing for anyone.
     */
    const harness: Harness = setup({
      site: { currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID) },
      descendantIds: [UNIT_ID],
      groupsBySite: () => {
        return [
          group(REGION_ID, OPERATIONAL_STATUS_ID, 399),
          group(UNIT_ID, OFFLINE_STATUS_ID, 1),
        ];
      },
    });

    return NetworkSiteService.recomputeRollupForSite(REGION_ID).then(() => {
      expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
    });
  });

  it("PercentThreshold leaves that same region degraded", async () => {
    const harness: Harness = setup({
      site: {
        currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
        healthRollupPolicy: SiteHealthRollupPolicy.PercentThreshold,
        offlineThresholdPercent: 50,
      },
      descendantIds: [UNIT_ID],
      groupsBySite: () => {
        return [
          group(REGION_ID, OPERATIONAL_STATUS_ID, 399),
          group(UNIT_ID, OFFLINE_STATUS_ID, 1),
        ];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(persistedStatusId(harness)).toBe(DEGRADED_STATUS_ID);
  });

  it("PercentThreshold still goes offline once the threshold is crossed", async () => {
    const harness: Harness = setup({
      site: {
        currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
        healthRollupPolicy: SiteHealthRollupPolicy.PercentThreshold,
        offlineThresholdPercent: 50,
      },
      descendantIds: [UNIT_ID],
      groupsBySite: () => {
        return [
          group(REGION_ID, OPERATIONAL_STATUS_ID, 100),
          group(UNIT_ID, OFFLINE_STATUS_ID, 100),
        ];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
  });

  it("an unreadable policy string still produces a verdict", async () => {
    const harness: Harness = setup({
      site: {
        currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
        healthRollupPolicy: "GarbageWrittenByHand" as SiteHealthRollupPolicy,
      },
      groupsBySite: () => {
        return [group(REGION_ID, OFFLINE_STATUS_ID, 1)];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
  });
});

describe("recomputeRollupForSite and ongoing scheduled maintenance", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("drops a maintained descendant's devices from an ancestor's rollup", async () => {
    /*
     * The region is not itself under maintenance, so the maintained unit is
     * excluded from the device query entirely — the region stays green for
     * a cutover that was on the calendar.
     */
    const harness: Harness = setup({
      site: { currentMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID) },
      descendantIds: [UNIT_ID, OTHER_UNIT_ID],
      maintainedSiteIds: [UNIT_ID],
      groupsBySite: (siteIds: Array<ObjectID>) => {
        const ids: Array<string> = siteIds.map((id: ObjectID) => {
          return id.toString();
        });
        const groups: Array<DeviceHealthGroup> = [
          group(OTHER_UNIT_ID, OPERATIONAL_STATUS_ID, 5),
        ];
        if (ids.includes(UNIT_ID.toString())) {
          groups.push(group(UNIT_ID, OFFLINE_STATUS_ID, 5));
        }
        return groups;
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(queriedSiteIds(harness)).not.toContain(UNIT_ID.toString());
    expect(queriedSiteIds(harness)).toContain(OTHER_UNIT_ID.toString());
    expect(persistedStatusId(harness)).toBe(OPERATIONAL_STATUS_ID);
  });

  it("a maintained site keeps every device in its OWN rollup", async () => {
    /*
     * The site still reads Offline during planned work. Someone looking at
     * the unit needs to know it is off; only the arithmetic above it and
     * the uptime percentage change.
     */
    const harness: Harness = setup({
      site: {
        id: UNIT_ID,
        _id: UNIT_ID.toString(),
        currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
      } as Partial<NetworkSite>,
      maintainedSiteIds: [UNIT_ID],
      groupsBySite: () => {
        return [group(UNIT_ID, OFFLINE_STATUS_ID, 5)];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(UNIT_ID);

    expect(queriedSiteIds(harness)).toContain(UNIT_ID.toString());
    expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
  });

  it("a maintained site does not suppress its own maintained descendants either", async () => {
    const harness: Harness = setup({
      site: {
        currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
      },
      descendantIds: [UNIT_ID],
      // The whole subtree is covered — attaching a Region covers its units.
      maintainedSiteIds: [REGION_ID, UNIT_ID],
      groupsBySite: () => {
        return [group(UNIT_ID, OFFLINE_STATUS_ID, 5)];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(queriedSiteIds(harness).sort()).toEqual(
      [REGION_ID.toString(), UNIT_ID.toString()].sort(),
    );
    expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
  });

  it("changes nothing when no window is running", async () => {
    const harness: Harness = setup({
      site: { currentMonitorStatusId: new ObjectID(OPERATIONAL_STATUS_ID) },
      descendantIds: [UNIT_ID, OTHER_UNIT_ID],
      maintainedSiteIds: [],
      groupsBySite: () => {
        return [group(UNIT_ID, OFFLINE_STATUS_ID, 1)];
      },
    });

    await NetworkSiteService.recomputeRollupForSite(REGION_ID);

    expect(queriedSiteIds(harness)).toHaveLength(3);
    expect(persistedStatusId(harness)).toBe(OFFLINE_STATUS_ID);
  });
});

describe("NetworkSiteService.recomputeRollupsAfterMaintenanceChange", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("recomputes each attached site and its ancestors exactly once", async () => {
    /*
     * Two sites in the same chain must not walk their shared ancestors
     * twice — a regional window attaching a Region and one of its Markets
     * is an ordinary thing to do.
     */
    const recompute: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSite")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "getAncestorIds")
      .mockImplementation((siteId: ObjectID): Promise<Array<ObjectID>> => {
        if (siteId.toString() === UNIT_ID.toString()) {
          return Promise.resolve([REGION_ID]);
        }
        if (siteId.toString() === OTHER_UNIT_ID.toString()) {
          return Promise.resolve([REGION_ID]);
        }
        return Promise.resolve([]);
      });

    await NetworkSiteService.recomputeRollupsAfterMaintenanceChange({
      projectId: PROJECT_ID,
      siteIds: [UNIT_ID, OTHER_UNIT_ID],
    });

    const recomputedIds: Array<string> = recompute.mock.calls.map(
      (call: Array<ObjectID>) => {
        return call[0]!.toString();
      },
    );

    expect(recomputedIds).toEqual([
      UNIT_ID.toString(),
      REGION_ID.toString(),
      OTHER_UNIT_ID.toString(),
    ]);
  });

  it("invalidates the suppression cache before recomputing", async () => {
    /*
     * The set is cached for a few seconds. A window that has just flipped
     * state would otherwise be scored against the previous answer, which is
     * exactly the answer it just stopped being.
     */
    const invalidate: jest.SpyInstance = jest
      .spyOn(NetworkSiteMaintenanceSuppression, "invalidateCache")
      .mockImplementation(() => {
        return undefined;
      });
    const recompute: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSite")
      .mockResolvedValue(undefined as never);
    jest.spyOn(NetworkSiteService, "getAncestorIds").mockResolvedValue([]);

    await NetworkSiteService.recomputeRollupsAfterMaintenanceChange({
      projectId: PROJECT_ID,
      siteIds: [UNIT_ID],
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.invocationCallOrder[0]!).toBeLessThan(
      recompute.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps going when one site's rollup throws", async () => {
    /*
     * A maintenance event must not fail to start because one site's rollup
     * did; the five-minute sweep is the backstop.
     */
    const recompute: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSite")
      .mockImplementation((siteId: ObjectID): Promise<void> => {
        if (siteId.toString() === UNIT_ID.toString()) {
          return Promise.reject(new Error("rollup exploded"));
        }
        return Promise.resolve();
      });
    jest.spyOn(NetworkSiteService, "getAncestorIds").mockResolvedValue([]);

    await expect(
      NetworkSiteService.recomputeRollupsAfterMaintenanceChange({
        projectId: PROJECT_ID,
        siteIds: [UNIT_ID, OTHER_UNIT_ID],
      }),
    ).resolves.toBeUndefined();

    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all for an event with no sites attached", async () => {
    const invalidate: jest.SpyInstance = jest
      .spyOn(NetworkSiteMaintenanceSuppression, "invalidateCache")
      .mockImplementation(() => {
        return undefined;
      });
    const recompute: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSite")
      .mockResolvedValue(undefined as never);

    await NetworkSiteService.recomputeRollupsAfterMaintenanceChange({
      projectId: PROJECT_ID,
      siteIds: [],
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(recompute).not.toHaveBeenCalled();
  });
});
