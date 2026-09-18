import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";

const MONITOR_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_C: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GROUP_ONE: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const GROUP_TWO: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

function makeStatus(data: {
  name: string;
  priority: number;
  color: typeof Green;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.color;
  return status;
}

function makeResourceForMonitor(monitorId: ObjectID): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource.monitorId = monitorId;
  return resource;
}

function makeTimelineForMonitor(monitorId: ObjectID): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = monitorId;
  return timeline;
}

describe("StatusPageResourceUptimeUtil", () => {
  describe("getWorstMonitorStatus", () => {
    test("defaults to Operational when there are no statuses", () => {
      const worst: MonitorStatus =
        StatusPageResourceUptimeUtil.getWorstMonitorStatus({
          monitorStatuses: [],
        });

      expect(worst.name).toBe("Operational");
      expect(worst.color).toEqual(Green);
    });

    test("returns the highest priority (worst) status", () => {
      const operational: MonitorStatus = makeStatus({
        name: "Operational",
        priority: 1,
        color: Green,
      });
      const degraded: MonitorStatus = makeStatus({
        name: "Degraded",
        priority: 2,
        color: Yellow,
      });
      const offline: MonitorStatus = makeStatus({
        name: "Offline",
        priority: 3,
        color: Red,
      });

      const worst: MonitorStatus =
        StatusPageResourceUptimeUtil.getWorstMonitorStatus({
          monitorStatuses: [operational, offline, degraded],
        });

      expect(worst.name).toBe("Offline");
      expect(worst.priority).toBe(3);
    });

    test("a single status wins over the operational default", () => {
      const degraded: MonitorStatus = makeStatus({
        name: "Degraded",
        priority: 5,
        color: Yellow,
      });

      const worst: MonitorStatus =
        StatusPageResourceUptimeUtil.getWorstMonitorStatus({
          monitorStatuses: [degraded],
        });

      expect(worst.name).toBe("Degraded");
    });
  });

  describe("getResourcesInStatusPageGroup", () => {
    test("returns only resources whose group id matches", () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = GROUP_ONE.toString();

      const inGroup: StatusPageResource = new StatusPageResource();
      inGroup.statusPageGroupId = GROUP_ONE;

      const otherGroup: StatusPageResource = new StatusPageResource();
      otherGroup.statusPageGroupId = GROUP_TWO;

      const noGroup: StatusPageResource = new StatusPageResource();

      const result: Array<StatusPageResource> =
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroup({
          statusPageGroup: group,
          statusPageResources: [inGroup, otherGroup, noGroup],
        });

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(inGroup);
    });

    test("returns an empty array when nothing matches", () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = GROUP_ONE.toString();

      const otherGroup: StatusPageResource = new StatusPageResource();
      otherGroup.statusPageGroupId = GROUP_TWO;

      expect(
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroup({
          statusPageGroup: group,
          statusPageResources: [otherGroup],
        }),
      ).toHaveLength(0);
    });
  });

  describe("getResourcesWithoutStatusPageGroup", () => {
    test("returns only ungrouped resources", () => {
      const grouped: StatusPageResource = new StatusPageResource();
      grouped.statusPageGroupId = GROUP_ONE;

      const ungroupedA: StatusPageResource = new StatusPageResource();
      const ungroupedB: StatusPageResource = new StatusPageResource();

      const result: Array<StatusPageResource> =
        StatusPageResourceUptimeUtil.getResourcesWithoutStatusPageGroup({
          statusPageResources: [grouped, ungroupedA, ungroupedB],
        });

      expect(result).toHaveLength(2);
      expect(result).toContain(ungroupedA);
      expect(result).toContain(ungroupedB);
      expect(result).not.toContain(grouped);
    });

    test("grouped and ungrouped partitions are complementary", () => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = GROUP_ONE.toString();

      const grouped: StatusPageResource = new StatusPageResource();
      grouped.statusPageGroupId = GROUP_ONE;
      const ungrouped: StatusPageResource = new StatusPageResource();

      const all: Array<StatusPageResource> = [grouped, ungrouped];

      const withoutGroup: Array<StatusPageResource> =
        StatusPageResourceUptimeUtil.getResourcesWithoutStatusPageGroup({
          statusPageResources: all,
        });
      const inGroup: Array<StatusPageResource> =
        StatusPageResourceUptimeUtil.getResourcesInStatusPageGroup({
          statusPageGroup: group,
          statusPageResources: all,
        });

      expect(withoutGroup.length + inGroup.length).toBe(all.length);
    });
  });

  describe("getMonitorStatusTimelineForResource", () => {
    test("filters timelines to the resource's own monitor", () => {
      const resource: StatusPageResource = makeResourceForMonitor(MONITOR_A);

      const result: Array<MonitorStatusTimeline> =
        StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource({
          statusPageResource: resource,
          monitorStatusTimelines: [
            makeTimelineForMonitor(MONITOR_A),
            makeTimelineForMonitor(MONITOR_B),
            makeTimelineForMonitor(MONITOR_A),
          ],
          monitorsInGroup: {},
        });

      expect(result).toHaveLength(2);
      for (const timeline of result) {
        expect(timeline.monitorId?.toString()).toBe(MONITOR_A.toString());
      }
    });

    test("resolves a monitor-group resource to all monitors in the group", () => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitorGroupId = GROUP_ONE;

      const monitorsInGroup: Dictionary<Array<ObjectID>> = {
        [GROUP_ONE.toString()]: [MONITOR_A, MONITOR_B],
      };

      const result: Array<MonitorStatusTimeline> =
        StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource({
          statusPageResource: resource,
          monitorStatusTimelines: [
            makeTimelineForMonitor(MONITOR_A),
            makeTimelineForMonitor(MONITOR_B),
            makeTimelineForMonitor(MONITOR_C),
          ],
          monitorsInGroup,
        });

      // MONITOR_C is not part of the group, so it is excluded.
      expect(result).toHaveLength(2);
      const ids: Array<string> = result.map((t: MonitorStatusTimeline) => {
        return t.monitorId!.toString();
      });
      expect(ids).toContain(MONITOR_A.toString());
      expect(ids).toContain(MONITOR_B.toString());
      expect(ids).not.toContain(MONITOR_C.toString());
    });

    test("returns nothing when the group has no known monitors", () => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitorGroupId = GROUP_ONE;

      const result: Array<MonitorStatusTimeline> =
        StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource({
          statusPageResource: resource,
          monitorStatusTimelines: [makeTimelineForMonitor(MONITOR_A)],
          monitorsInGroup: {},
        });

      expect(result).toHaveLength(0);
    });

    test("returns nothing when the resource has neither monitor nor group", () => {
      const resource: StatusPageResource = new StatusPageResource();

      const result: Array<MonitorStatusTimeline> =
        StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource({
          statusPageResource: resource,
          monitorStatusTimelines: [makeTimelineForMonitor(MONITOR_A)],
          monitorsInGroup: {},
        });

      expect(result).toHaveLength(0);
    });
  });

  /*
   * Groups can be nested (Corporate Unit -> Region -> Market -> Site), and the
   * whole point of the hierarchy is that every level reports a rolled up
   * number. These cases pin down what "rolled up" means:
   *
   *   - a group's status / uptime covers its own resources AND everything in
   *     the groups below it,
   *   - the hierarchy is opt in: without the group list the helpers behave
   *     exactly as they did before nesting existed,
   *   - and the page-wide average counts each resource once, however deep it
   *     sits (a parent already averages its subtree, so descending past it
   *     would count its children twice).
   *
   * A monitor that is operational for the whole window is 100%, a monitor that
   * is offline for the whole window is 0% - so the expected averages below are
   * exact rather than time-dependent.
   */
  describe("nested groups", () => {
    const PARENT_GROUP: ObjectID = new ObjectID(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    const CHILD_GROUP: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const OPERATIONAL_STATUS: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const OFFLINE_STATUS: ObjectID = new ObjectID(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );

    const uptimeWindow: UptimeWindow = {
      startDate: OneUptimeDate.getSomeDaysAgo(10),
      endDate: OneUptimeDate.getCurrentDate(),
    };

    function operationalStatus(): MonitorStatus {
      const status: MonitorStatus = new MonitorStatus();
      status._id = OPERATIONAL_STATUS.toString();
      status.name = "Operational";
      status.priority = 1;
      status.color = Green;
      status.isOperationalState = true;
      return status;
    }

    function offlineStatus(): MonitorStatus {
      const status: MonitorStatus = new MonitorStatus();
      status._id = OFFLINE_STATUS.toString();
      status.name = "Offline";
      status.priority = 3;
      status.color = Red;
      return status;
    }

    // an open timeline row covering the whole reporting window.
    function makeTimeline(data: {
      monitorId: ObjectID;
      status: MonitorStatus;
    }): MonitorStatusTimeline {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorId = data.monitorId;
      timeline.monitorStatus = data.status;
      timeline.monitorStatusId = data.status.id!;
      timeline.startsAt = uptimeWindow.startDate;
      return timeline;
    }

    function makeGroup(data: {
      id: ObjectID;
      name: string;
      parentId?: ObjectID | undefined;
      showUptimePercent: boolean;
    }): StatusPageGroup {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = data.id.toString();
      group.name = data.name;
      group.showUptimePercent = data.showUptimePercent;
      group.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;

      if (data.parentId) {
        group.parentStatusPageGroupId = data.parentId;
      }

      return group;
    }

    function makeResource(data: {
      monitorId: ObjectID;
      currentStatusId: ObjectID;
      groupId?: ObjectID | undefined;
    }): StatusPageResource {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitorId = data.monitorId;
      resource.showUptimePercent = true;

      const monitor: Monitor = new Monitor();
      monitor._id = data.monitorId.toString();
      monitor.currentMonitorStatusId = data.currentStatusId;
      resource.monitor = monitor;

      if (data.groupId) {
        resource.statusPageGroupId = data.groupId;
      }

      return resource;
    }

    /*
     * Parent (2 healthy resources) -> Child (1 offline resource).
     * Parent on its own is 100%, the subtree is (100 + 100 + 0) / 3 = 66.66%.
     */
    function makeFixture(data?: {
      parentShowsUptimePercent?: boolean | undefined;
    }): {
      groups: Array<StatusPageGroup>;
      resources: Array<StatusPageResource>;
      timelines: Array<MonitorStatusTimeline>;
      statuses: Array<MonitorStatus>;
    } {
      const parent: StatusPageGroup = makeGroup({
        id: PARENT_GROUP,
        name: "Corporate Units",
        showUptimePercent: data?.parentShowsUptimePercent ?? true,
      });
      const child: StatusPageGroup = makeGroup({
        id: CHILD_GROUP,
        name: "Region 1000",
        parentId: PARENT_GROUP,
        showUptimePercent: true,
      });

      return {
        groups: [parent, child],
        resources: [
          makeResource({
            monitorId: MONITOR_A,
            currentStatusId: OPERATIONAL_STATUS,
            groupId: PARENT_GROUP,
          }),
          makeResource({
            monitorId: MONITOR_B,
            currentStatusId: OPERATIONAL_STATUS,
            groupId: PARENT_GROUP,
          }),
          makeResource({
            monitorId: MONITOR_C,
            currentStatusId: OFFLINE_STATUS,
            groupId: CHILD_GROUP,
          }),
        ],
        timelines: [
          makeTimeline({ monitorId: MONITOR_A, status: operationalStatus() }),
          makeTimeline({ monitorId: MONITOR_B, status: operationalStatus() }),
          makeTimeline({ monitorId: MONITOR_C, status: offlineStatus() }),
        ],
        statuses: [operationalStatus(), offlineStatus()],
      };
    }

    describe("getResourcesInStatusPageGroupAndDescendants", () => {
      test("a parent covers its own resources and its children's", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        expect(
          StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
            {
              statusPageGroup: fixture.groups[0]!,
              statusPageResources: fixture.resources,
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toHaveLength(3);
      });

      test("a child covers only its own resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        const resources: Array<StatusPageResource> =
          StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
            {
              statusPageGroup: fixture.groups[1]!,
              statusPageResources: fixture.resources,
              allStatusPageGroups: fixture.groups,
            },
          );

        expect(resources).toHaveLength(1);
        expect(resources[0]!.monitorId?.toString()).toBe(MONITOR_C.toString());
      });

      test("without the group list it falls back to the group's own resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        expect(
          StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
            {
              statusPageGroup: fixture.groups[0]!,
              statusPageResources: fixture.resources,
            },
          ),
        ).toHaveLength(2);
      });

      test("never picks up ungrouped resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        const ungrouped: StatusPageResource = makeResource({
          monitorId: MONITOR_A,
          currentStatusId: OPERATIONAL_STATUS,
        });

        expect(
          StatusPageResourceUptimeUtil.getResourcesInStatusPageGroupAndDescendants(
            {
              statusPageGroup: fixture.groups[0]!,
              statusPageResources: [...fixture.resources, ungrouped],
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toHaveLength(3);
      });
    });

    describe("calculateAvgUptimePercentOfStatusPageGroup", () => {
      test("a parent averages every resource in its subtree", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[0]!,
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toBe(66.66);
      });

      test("a child reports only its own resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[1]!,
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toBe(0);
      });

      test("without the group list a parent reports only its own resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[0]!,
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
            },
          ),
        ).toBe(100);
      });

      test("a group that does not show uptime percent reports nothing", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture({
          parentShowsUptimePercent: false,
        });

        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[0]!,
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toBeNull();
      });
    });

    describe("getCurrentStatusPageGroupStatus", () => {
      test("a parent takes the worst status in its subtree", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        const status: MonitorStatus =
          StatusPageResourceUptimeUtil.getCurrentStatusPageGroupStatus({
            statusPageGroup: fixture.groups[0]!,
            monitorStatusTimelines: fixture.timelines,
            statusPageResources: fixture.resources,
            monitorStatuses: fixture.statuses,
            monitorGroupCurrentStatuses: {},
            allStatusPageGroups: fixture.groups,
          });

        expect(status.name).toBe("Offline");
      });

      test("without the group list a parent only sees its own resources", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        const status: MonitorStatus =
          StatusPageResourceUptimeUtil.getCurrentStatusPageGroupStatus({
            statusPageGroup: fixture.groups[0]!,
            monitorStatusTimelines: fixture.timelines,
            statusPageResources: fixture.resources,
            monitorStatuses: fixture.statuses,
            monitorGroupCurrentStatuses: {},
          });

        expect(status.name).toBe("Operational");
      });
    });

    describe("calculateAvgUptimePercentageOfAllResources", () => {
      test("counts a nested resource once, through its top most reporting ancestor", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        /*
         * The parent already averages all three resources (66.66%). Averaging
         * the parent and the child together would count the offline resource
         * twice and land on 33.33%.
         */
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
            },
          ),
        ).toBe(66.66);
      });

      test("descends past a parent that does not report uptime percent", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture({
          parentShowsUptimePercent: false,
        });

        // only the child reports, and everything in the child is offline.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: fixture.resources,
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
            },
          ),
        ).toBe(0);
      });

      test("still includes resources that are in no group at all", () => {
        const fixture: ReturnType<typeof makeFixture> = makeFixture();

        const ungrouped: StatusPageResource = makeResource({
          monitorId: MONITOR_C,
          currentStatusId: OFFLINE_STATUS,
        });

        // parent subtree 66.66%, ungrouped offline resource 0% -> 33.33%.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.timelines,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: [offlineStatus()],
              statusPageResources: [...fixture.resources, ungrouped],
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: uptimeWindow,
            },
          ),
        ).toBe(33.33);
      });
    });
  });
});
