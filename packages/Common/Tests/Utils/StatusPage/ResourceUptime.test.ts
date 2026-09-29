import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import { MergedDowntimeTotals } from "../../../Types/StatusPage/MergedDowntimeTotals";
import UptimeUtil, { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
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

  /*
   * ROOT CAUSE 2: the status page's timeline rows arrive under a 10,000 row
   * LIMIT_MAX across EVERY monitor on the page, newest first. On
   * status.chainflip.io 255,733 rows matched the sixty day window and the
   * 10,000 that came back covered about five days, so every uptime figure
   * computed from them - the resource percentages, the group roll-ups and
   * the page-wide average - only saw those five days. A flapping monitor
   * whose sixty days were 99.667% read 99.876%.
   *
   * The fix measures a single-monitor resource from the server's per-day
   * buckets (uptimeDailyAggregate), which are summed from every row, and a
   * monitor-group resource from the server's merged downtime
   * (monitorGroupMergedDowntime, the last block). Before it these helpers
   * took no aggregate at all, so each test below that
   * passes one fails against the old code (it does not compile, and the old
   * row path returns the "old reading" each test also pins).
   *
   * "Now" is pinned so the row-based figures, which run open rows up to the
   * current time, are exact whatever day this runs on.
   */
  describe("uptime from the server's day buckets (uptimeDailyAggregate)", () => {
    const NOW: Date = new Date("2026-09-22T12:00:00.000Z");
    const DAY_MS: number = 24 * 60 * 60 * 1000;
    const DAY_SECONDS: number = 86400;

    function daysBeforeNow(days: number): Date {
      return new Date(NOW.getTime() - days * DAY_MS);
    }

    // the status page's sixty day history window.
    const WINDOW: UptimeWindow = {
      startDate: daysBeforeNow(60),
      endDate: NOW,
    };

    const OPERATIONAL_ID: ObjectID = new ObjectID(
      "12121212-1212-4121-8121-121212121212",
    );
    const DEGRADED_ID: ObjectID = new ObjectID(
      "34343434-3434-4343-8343-343434343434",
    );
    const OFFLINE_ID: ObjectID = new ObjectID(
      "56565656-5656-4565-8565-565656565656",
    );

    const MONITOR_D: ObjectID = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    );
    const MONITOR_GROUP: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const PARENT_GROUP: ObjectID = new ObjectID(
      "88888888-8888-4888-8888-888888888888",
    );
    const CHILD_GROUP: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );

    function makeMonitorStatus(data: {
      id: ObjectID;
      name: string;
      priority: number;
      color: typeof Green;
    }): MonitorStatus {
      const status: MonitorStatus = new MonitorStatus();
      status._id = data.id.toString();
      status.name = data.name;
      status.priority = data.priority;
      status.color = data.color;
      return status;
    }

    function operational(): MonitorStatus {
      return makeMonitorStatus({
        id: OPERATIONAL_ID,
        name: "Operational",
        priority: 1,
        color: Green,
      });
    }

    function degraded(): MonitorStatus {
      return makeMonitorStatus({
        id: DEGRADED_ID,
        name: "Degraded",
        priority: 2,
        color: Yellow,
      });
    }

    function offline(): MonitorStatus {
      return makeMonitorStatus({
        id: OFFLINE_ID,
        name: "Offline",
        priority: 3,
        color: Red,
      });
    }

    // the page's downtime statuses: Degraded + Offline.
    function downtimeStatuses(): Array<MonitorStatus> {
      return [degraded(), offline()];
    }

    function makeRow(data: {
      monitorId: ObjectID;
      status: MonitorStatus;
      startsAt: Date;
      endsAt?: Date | undefined;
    }): MonitorStatusTimeline {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorId = data.monitorId;
      timeline.monitorStatus = data.status;
      timeline.monitorStatusId = data.status.id!;
      timeline.startsAt = data.startsAt;

      if (data.endsAt) {
        timeline.endsAt = data.endsAt;
      }

      return timeline;
    }

    // what survives the row cap for a quiet monitor: one open Operational row.
    function operationalTail(
      monitorId: ObjectID,
    ): Array<MonitorStatusTimeline> {
      return [
        makeRow({
          monitorId: monitorId,
          status: operational(),
          startsAt: daysBeforeNow(2),
        }),
      ];
    }

    // the last day of a flapping monitor: a minute Offline, then Operational.
    function flappingTail(monitorId: ObjectID): Array<MonitorStatusTimeline> {
      const recovered: Date = new Date(daysBeforeNow(1).getTime() + 60 * 1000);

      return [
        makeRow({
          monitorId: monitorId,
          status: offline(),
          startsAt: daysBeforeNow(1),
          endsAt: recovered,
        }),
        makeRow({
          monitorId: monitorId,
          status: operational(),
          startsAt: recovered,
        }),
      ];
    }

    /*
     * A monitor whose rows are all present: Offline for the first six of
     * the sixty days, Operational since. 90% measured from the rows.
     */
    function sixDaysOfflineRows(
      monitorId: ObjectID,
    ): Array<MonitorStatusTimeline> {
      const recovered: Date = new Date(WINDOW.startDate.getTime() + 6 * DAY_MS);

      return [
        makeRow({
          monitorId: monitorId,
          status: offline(),
          startsAt: WINDOW.startDate,
          endsAt: recovered,
        }),
        makeRow({
          monitorId: monitorId,
          status: operational(),
          startsAt: recovered,
        }),
      ];
    }

    function bucket(
      dayIndex: number,
      coveredSeconds: number,
      durations: Array<[ObjectID, number]>,
    ): UptimeDayBucket {
      const bucketStart: Date = new Date(
        Date.UTC(2026, 6, 24) + dayIndex * DAY_MS,
      );

      return {
        bucketStart: bucketStart,
        bucketEnd: new Date(bucketStart.getTime() + DAY_MS),
        daySeconds: DAY_SECONDS,
        coveredSeconds: coveredSeconds,
        statusDurations: durations.map((duration: [ObjectID, number]) => {
          return { monitorStatusId: duration[0], seconds: duration[1] };
        }),
      };
    }

    // a fully covered day with `downSeconds` of `downStatusId`, the rest Operational.
    function fullDay(
      dayIndex: number,
      downStatusId?: ObjectID | undefined,
      downSeconds: number = 0,
    ): UptimeDayBucket {
      const durations: Array<[ObjectID, number]> = [
        [OPERATIONAL_ID, DAY_SECONDS - downSeconds],
      ];

      if (downStatusId && downSeconds > 0) {
        durations.push([downStatusId, downSeconds]);
      }

      return bucket(dayIndex, DAY_SECONDS, durations);
    }

    function noDataDays(count: number): Array<UptimeDayBucket> {
      const buckets: Array<UptimeDayBucket> = [];

      for (let d: number = 0; d < count; d++) {
        buckets.push(bucket(d, 0, []));
      }

      return buckets;
    }

    /*
     * One of chainflip's flapping monitors as the server measured it: sixty
     * covered days, 17,270 s of Offline + Degraded -> 99.666 at three
     * decimals (floored).
     */
    function chainflipBuckets(): Array<UptimeDayBucket> {
      const buckets: Array<UptimeDayBucket> = [];

      for (let d: number = 0; d < 60; d++) {
        if (d < 10) {
          buckets.push(fullDay(d, OFFLINE_ID, 1000));
        } else if (d < 20) {
          buckets.push(fullDay(d, DEGRADED_ID, 727));
        } else {
          buckets.push(fullDay(d));
        }
      }

      return buckets;
    }

    // computed from the inputs and floored to three decimals, as roundToPrecision does.
    const CHAINFLIP_UPTIME_THREE_DECIMAL: number =
      Math.floor(
        ((60 * DAY_SECONDS - 17270) / (60 * DAY_SECONDS)) * 100 * 1000,
      ) / 1000;

    function aggregateOf(
      monitors: Array<[ObjectID, Array<UptimeDayBucket>]>,
    ): UptimeDailyAggregate {
      return {
        monitors: monitors.map(
          (monitor: [ObjectID, Array<UptimeDayBucket>]) => {
            return { monitorId: monitor[0], buckets: monitor[1] };
          },
        ),
        isComplete: true,
        completeFrom: null,
        timezone: "UTC",
      };
    }

    function monitorResource(data: {
      monitorId: ObjectID;
      groupId?: ObjectID | undefined;
      showUptimePercent?: boolean | undefined;
    }): StatusPageResource {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitorId = data.monitorId;
      resource.showUptimePercent = data.showUptimePercent ?? true;

      if (data.groupId) {
        resource.statusPageGroupId = data.groupId;
      }

      return resource;
    }

    function monitorGroupResource(data: {
      monitorGroupId: ObjectID;
      groupId?: ObjectID | undefined;
    }): StatusPageResource {
      const resource: StatusPageResource = new StatusPageResource();
      resource.monitorGroupId = data.monitorGroupId;
      resource.showUptimePercent = true;

      if (data.groupId) {
        resource.statusPageGroupId = data.groupId;
      }

      return resource;
    }

    function makeStatusPageGroup(data: {
      id: ObjectID;
      parentId?: ObjectID | undefined;
      showUptimePercent?: boolean | undefined;
    }): StatusPageGroup {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = data.id.toString();
      group.name = data.id.toString();
      group.showUptimePercent = data.showUptimePercent ?? true;
      group.uptimePercentPrecision = UptimePrecision.TWO_DECIMAL;

      if (data.parentId) {
        group.parentStatusPageGroupId = data.parentId;
      }

      return group;
    }

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe("calculateUptimePercentOfResource", () => {
      test("the chainflip fixture is 99.666 at three decimals", () => {
        // guards the constant the tests below compare against.
        expect(CHAINFLIP_UPTIME_THREE_DECIMAL).toBe(99.666);
      });

      test.each([
        ["an all-Operational tail", operationalTail, 100],
        ["a tail with one Offline minute", flappingTail, 99.93],
      ])(
        "a monitor is measured from its buckets when the capped rows hold only %s",
        (
          _name: string,
          tail: (monitorId: ObjectID) => Array<MonitorStatusTimeline>,
          oldReading: number,
        ) => {
          const resource: StatusPageResource = monitorResource({
            monitorId: MONITOR_A,
          });

          const rows: Array<MonitorStatusTimeline> = [
            ...tail(MONITOR_A),
            // a neighbour's rows are in the same capped list.
            ...operationalTail(MONITOR_B),
          ];

          // what the page showed before the fix: the rows alone.
          expect(
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: resource,
              monitorStatusTimelines: rows,
              precision: UptimePrecision.THREE_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
            }),
          ).toBe(oldReading);

          expect(
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: resource,
              monitorStatusTimelines: rows,
              precision: UptimePrecision.THREE_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: aggregateOf([
                [MONITOR_A, chainflipBuckets()],
                [MONITOR_B, [fullDay(0, OFFLINE_ID, DAY_SECONDS)]],
              ]),
            }),
          ).toBe(CHAINFLIP_UPTIME_THREE_DECIMAL);
        },
      );

      test.each([
        [UptimePrecision.NO_DECIMAL, 99],
        [UptimePrecision.ONE_DECIMAL, 99.6],
        [UptimePrecision.TWO_DECIMAL, 99.66],
      ])(
        "the bucket reading honours the requested precision (%s -> %s)",
        (precision: UptimePrecision, expected: number) => {
          expect(
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: monitorResource({ monitorId: MONITOR_A }),
              monitorStatusTimelines: operationalTail(MONITOR_A),
              precision: precision,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: aggregateOf([
                [MONITOR_A, chainflipBuckets()],
              ]),
            }),
          ).toBe(expected);
        },
      );

      test("the page's downtime statuses decide what counts as down in the buckets", () => {
        const aggregate: UptimeDailyAggregate = aggregateOf([
          [MONITOR_A, [fullDay(0, OFFLINE_ID, 8640)]],
        ]);

        // Offline is downtime; a status with no id is skipped, not matched.
        expect(
          StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
            statusPageResource: monitorResource({ monitorId: MONITOR_A }),
            monitorStatusTimelines: operationalTail(MONITOR_A),
            precision: UptimePrecision.TWO_DECIMAL,
            downtimeMonitorStatuses: [offline(), new MonitorStatus()],
            monitorsInGroup: {},
            uptimeWindow: WINDOW,
            uptimeDailyAggregate: aggregate,
          }),
        ).toBe(90);

        // a page that only counts Degraded as downtime.
        expect(
          StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
            statusPageResource: monitorResource({ monitorId: MONITOR_A }),
            monitorStatusTimelines: operationalTail(MONITOR_A),
            precision: UptimePrecision.TWO_DECIMAL,
            downtimeMonitorStatuses: [degraded()],
            monitorsInGroup: {},
            uptimeWindow: WINDOW,
            uptimeDailyAggregate: aggregate,
          }),
        ).toBe(100);
      });

      test.each([
        [
          "its buckets cover nothing",
          (): UptimeDailyAggregate => {
            return aggregateOf([[MONITOR_A, noDataDays(60)]]);
          },
        ],
        [
          "it is missing from the aggregate",
          (): UptimeDailyAggregate => {
            return aggregateOf([[MONITOR_B, chainflipBuckets()]]);
          },
        ],
        [
          "the aggregate holds no monitors",
          (): UptimeDailyAggregate => {
            return aggregateOf([]);
          },
        ],
      ])(
        "a monitor falls back to its rows when %s",
        (_name: string, makeAggregate: () => UptimeDailyAggregate) => {
          /*
           * No reading is not a perfect reading. With nothing to measure, the
           * rows are still the best account there is, exactly as before.
           */
          const resource: StatusPageResource = monitorResource({
            monitorId: MONITOR_A,
          });
          const rows: Array<MonitorStatusTimeline> =
            sixDaysOfflineRows(MONITOR_A);

          const fromRows: number | null =
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: resource,
              monitorStatusTimelines: rows,
              precision: UptimePrecision.THREE_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
            });

          expect(fromRows).toBe(90);

          expect(
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: resource,
              monitorStatusTimelines: rows,
              precision: UptimePrecision.THREE_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: makeAggregate(),
            }),
          ).toBe(fromRows);
        },
      );

      test("a monitor-group resource ignores the aggregate and, with no merged downtime, is measured from its rows", () => {
        /*
         * A group's status at any moment is the worst of its monitors', which
         * per-monitor day sums cannot express. Every bucket below says 0%,
         * including one filed under the group's own id; the rows say the
         * group was Offline for six of sixty days (monitor A), so 90%.
         */
        const resource: StatusPageResource = monitorGroupResource({
          monitorGroupId: MONITOR_GROUP,
        });
        const monitorsInGroup: Dictionary<Array<ObjectID>> = {
          [MONITOR_GROUP.toString()]: [MONITOR_A, MONITOR_B],
        };
        /*
         * Monitor B joins the group when A recovers. It is deliberately NOT
         * Operational from the window start: the row path's group merge
         * (UptimeUtil.getNonOverlappingMonitorEvents) lets a longer,
         * lower-priority event from another monitor cut a higher-priority
         * one short, so B Operational from the start would erase A's six
         * Offline days and read 100%. That is a separate, pre-existing
         * behaviour of the row path and not what this test is about.
         */
        const rows: Array<MonitorStatusTimeline> = [
          ...sixDaysOfflineRows(MONITOR_A),
          makeRow({
            monitorId: MONITOR_B,
            status: operational(),
            startsAt: new Date(WINDOW.startDate.getTime() + 6 * DAY_MS),
          }),
        ];
        const allOffline: Array<UptimeDayBucket> = [
          fullDay(0, OFFLINE_ID, DAY_SECONDS),
        ];

        const withAggregate: number | null =
          StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
            statusPageResource: resource,
            monitorStatusTimelines: rows,
            precision: UptimePrecision.TWO_DECIMAL,
            downtimeMonitorStatuses: downtimeStatuses(),
            monitorsInGroup: monitorsInGroup,
            uptimeWindow: WINDOW,
            uptimeDailyAggregate: aggregateOf([
              [MONITOR_A, allOffline],
              [MONITOR_B, allOffline],
              [MONITOR_GROUP, allOffline],
            ]),
          });

        const withoutAggregate: number | null =
          StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
            statusPageResource: resource,
            monitorStatusTimelines: rows,
            precision: UptimePrecision.TWO_DECIMAL,
            downtimeMonitorStatuses: downtimeStatuses(),
            monitorsInGroup: monitorsInGroup,
            uptimeWindow: WINDOW,
          });

        expect(withAggregate).toBe(90);
        expect(withAggregate).toBe(withoutAggregate);
      });

      test("a resource that hides its uptime percent still reports nothing", () => {
        expect(
          StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
            statusPageResource: monitorResource({
              monitorId: MONITOR_A,
              showUptimePercent: false,
            }),
            monitorStatusTimelines: operationalTail(MONITOR_A),
            precision: UptimePrecision.THREE_DECIMAL,
            downtimeMonitorStatuses: downtimeStatuses(),
            monitorsInGroup: {},
            uptimeWindow: WINDOW,
            uptimeDailyAggregate: aggregateOf([
              [MONITOR_A, chainflipBuckets()],
            ]),
          }),
        ).toBeNull();
      });

      test.each([
        ["omitted", undefined],
        ["null", null],
      ])(
        "with the aggregate %s the rows are measured exactly as before",
        (_name: string, aggregate: UptimeDailyAggregate | null | undefined) => {
          const rows: Array<MonitorStatusTimeline> = [
            ...flappingTail(MONITOR_A),
            ...sixDaysOfflineRows(MONITOR_B),
          ];

          const result: number | null =
            StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
              statusPageResource: monitorResource({ monitorId: MONITOR_A }),
              monitorStatusTimelines: rows,
              precision: UptimePrecision.THREE_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: aggregate,
            });

          expect(result).toBe(
            UptimeUtil.calculateUptimePercentage(
              flappingTail(MONITOR_A),
              UptimePrecision.THREE_DECIMAL,
              downtimeStatuses(),
              WINDOW,
            ),
          );
          expect(result).toBe(99.93);
        },
      );
    });

    /*
     * Parent group (monitor A) -> child group (monitor B), plus monitor C in
     * no group. The capped rows hold only a quiet Operational tail for each,
     * so measured from the rows everything is 100%. The buckets say A 90%,
     * B 80%, C 70%.
     */
    function makeRollUpFixture(data?: {
      parentShowsUptimePercent?: boolean | undefined;
    }): {
      groups: Array<StatusPageGroup>;
      resources: Array<StatusPageResource>;
      rows: Array<MonitorStatusTimeline>;
      aggregate: UptimeDailyAggregate;
    } {
      return {
        groups: [
          makeStatusPageGroup({
            id: PARENT_GROUP,
            showUptimePercent: data?.parentShowsUptimePercent ?? true,
          }),
          makeStatusPageGroup({ id: CHILD_GROUP, parentId: PARENT_GROUP }),
        ],
        resources: [
          monitorResource({ monitorId: MONITOR_A, groupId: PARENT_GROUP }),
          monitorResource({ monitorId: MONITOR_B, groupId: CHILD_GROUP }),
          monitorResource({ monitorId: MONITOR_C }),
        ],
        rows: [
          ...operationalTail(MONITOR_A),
          ...operationalTail(MONITOR_B),
          ...operationalTail(MONITOR_C),
        ],
        aggregate: aggregateOf([
          [MONITOR_A, [fullDay(0, OFFLINE_ID, 8640)]],
          [MONITOR_B, [fullDay(0, DEGRADED_ID, 17280)]],
          [MONITOR_C, [fullDay(0, OFFLINE_ID, 25920)]],
        ]),
      };
    }

    describe("calculateAvgUptimePercentOfStatusPageGroup", () => {
      test("a parent group averages its subtree from the buckets", () => {
        const fixture: ReturnType<typeof makeRollUpFixture> =
          makeRollUpFixture();

        // (90 + 80) / 2.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[0]!,
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              allStatusPageGroups: fixture.groups,
              uptimeDailyAggregate: fixture.aggregate,
            },
          ),
        ).toBe(85);

        // the old reading, from the capped rows alone.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[0]!,
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              allStatusPageGroups: fixture.groups,
            },
          ),
        ).toBe(100);
      });

      test("a child group reports its own resources from the buckets", () => {
        const fixture: ReturnType<typeof makeRollUpFixture> =
          makeRollUpFixture();

        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: fixture.groups[1]!,
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              allStatusPageGroups: fixture.groups,
              uptimeDailyAggregate: fixture.aggregate,
            },
          ),
        ).toBe(80);
      });
    });

    describe("calculateAvgUptimePercentageOfAllResources", () => {
      test("the page average reaches the buckets through nested groups and ungrouped resources", () => {
        const fixture: ReturnType<typeof makeRollUpFixture> =
          makeRollUpFixture();

        // parent subtree (90 + 80) / 2 = 85, ungrouped C 70 -> 77.5.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: fixture.aggregate,
            },
          ),
        ).toBe(77.5);

        // the old reading, from the capped rows alone.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
            },
          ),
        ).toBe(100);
      });

      test("descending past a parent that does not report still reaches the buckets", () => {
        const fixture: ReturnType<typeof makeRollUpFixture> = makeRollUpFixture(
          { parentShowsUptimePercent: false },
        );

        // child B 80, ungrouped C 70 -> 75.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: fixture.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: fixture.resources,
              resourceGroups: fixture.groups,
              monitorsInGroup: {},
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: fixture.aggregate,
            },
          ),
        ).toBe(75);
      });

      test("a monitor-group resource on the same page, with no merged downtime, is still measured from its rows", () => {
        const fixture: ReturnType<typeof makeRollUpFixture> =
          makeRollUpFixture();

        /*
         * Monitor D is the only monitor in a monitor group. Its rows say six
         * days Offline of sixty (90%); its buckets say a day spent Offline
         * (0%), which the group resource must not use.
         */
        const aggregate: UptimeDailyAggregate = {
          ...fixture.aggregate,
          monitors: [
            ...fixture.aggregate.monitors,
            {
              monitorId: MONITOR_D,
              buckets: [fullDay(0, OFFLINE_ID, DAY_SECONDS)],
            },
          ],
        };

        // parent subtree 85, ungrouped C 70, monitor group 90 -> 81.66.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: [
                ...fixture.rows,
                ...sixDaysOfflineRows(MONITOR_D),
              ],
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: [
                ...fixture.resources,
                monitorGroupResource({ monitorGroupId: MONITOR_GROUP }),
              ],
              resourceGroups: fixture.groups,
              monitorsInGroup: {
                [MONITOR_GROUP.toString()]: [MONITOR_D],
              },
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: aggregate,
            },
          ),
        ).toBe(81.66);
      });
    });

    /*
     * A monitor-group resource (monitors A and B) is down whenever at least
     * one of its monitors is, which the day buckets cannot say, so it is
     * measured from the server's merged downtime: the union of its monitors'
     * downtime over the union of their coverage, from every row.
     *
     * Its rows are wrong about it in two ways. The cap leaves only the
     * newest of them, and their merge (UptimeUtil.getNonOverlappingMonitorEvents)
     * keeps one event at a time by priority, so a later-starting,
     * longer-running Operational row of one monitor cuts another monitor's
     * outage short. Before monitorGroupMergedDowntime these helpers only had
     * the rows, so each test below that passes it fails against the old code,
     * which gives the "old reading" each test also pins.
     */
    describe("a monitor group, from the server's merged downtime (monitorGroupMergedDowntime)", () => {
      const OTHER_MONITOR_GROUP: ObjectID = new ObjectID(
        "66666666-6666-4666-8666-666666666666",
      );

      // six days down in sixty covered: 90%.
      const SIX_DAYS_DOWN: MergedDowntimeTotals = {
        coveredSeconds: 60 * DAY_SECONDS,
        downtimeSeconds: 6 * DAY_SECONDS,
      };

      function mergedFor(
        entries: Array<[ObjectID, MergedDowntimeTotals]>,
      ): Dictionary<MergedDowntimeTotals> {
        const merged: Dictionary<MergedDowntimeTotals> = {};

        for (const entry of entries) {
          merged[entry[0].toString()] = entry[1];
        }

        return merged;
      }

      function monitorsOfTheGroup(): Dictionary<Array<ObjectID>> {
        return {
          [MONITOR_GROUP.toString()]: [MONITOR_A, MONITOR_B],
          [OTHER_MONITOR_GROUP.toString()]: [MONITOR_D],
        };
      }

      // what survives the cap: a minute of A Offline yesterday, B quiet.
      function cappedTails(): Array<MonitorStatusTimeline> {
        return [...flappingTail(MONITOR_A), ...operationalTail(MONITOR_B)];
      }

      /*
       * Every row is here: A Offline for the first six days, B Operational
       * throughout. B's row starts with A's outage and runs past it, so the
       * row merge ends the outage the moment B's row starts.
       */
      function outageErasedByTheRowMerge(): Array<MonitorStatusTimeline> {
        return [
          ...sixDaysOfflineRows(MONITOR_A),
          makeRow({
            monitorId: MONITOR_B,
            status: operational(),
            startsAt: WINDOW.startDate,
          }),
        ];
      }

      function groupUptime(data: {
        rows: Array<MonitorStatusTimeline>;
        precision?: UptimePrecision | undefined;
        resource?: StatusPageResource | undefined;
        uptimeDailyAggregate?: UptimeDailyAggregate | undefined;
        monitorGroupMergedDowntime?:
          | Dictionary<MergedDowntimeTotals>
          | null
          | undefined;
      }): number | null {
        return StatusPageResourceUptimeUtil.calculateUptimePercentOfResource({
          statusPageResource:
            data.resource ||
            monitorGroupResource({ monitorGroupId: MONITOR_GROUP }),
          monitorStatusTimelines: data.rows,
          precision: data.precision || UptimePrecision.TWO_DECIMAL,
          downtimeMonitorStatuses: downtimeStatuses(),
          monitorsInGroup: monitorsOfTheGroup(),
          uptimeWindow: WINDOW,
          uptimeDailyAggregate: data.uptimeDailyAggregate,
          monitorGroupMergedDowntime: data.monitorGroupMergedDowntime,
        });
      }

      describe("calculateUptimePercentOfResource", () => {
        test.each([
          ["the capped rows hold only its last day", cappedTails, 99.96],
          [
            "every row is there, but B's Operational row erases A's outage in the row merge",
            outageErasedByTheRowMerge,
            100,
          ],
        ])(
          "a monitor group reads its merged downtime when %s",
          (
            _name: string,
            rows: () => Array<MonitorStatusTimeline>,
            oldReading: number,
          ) => {
            // what the page showed before: the rows alone.
            expect(groupUptime({ rows: rows() })).toBe(oldReading);

            expect(
              groupUptime({
                rows: rows(),
                monitorGroupMergedDowntime: mergedFor([
                  [MONITOR_GROUP, SIX_DAYS_DOWN],
                ]),
              }),
            ).toBe(90);
          },
        );

        test.each([
          [UptimePrecision.NO_DECIMAL, 99],
          [UptimePrecision.ONE_DECIMAL, 99.6],
          [UptimePrecision.TWO_DECIMAL, 99.66],
          [UptimePrecision.THREE_DECIMAL, 99.666],
        ])(
          "the merged reading honours the requested precision (%s -> %s)",
          (precision: UptimePrecision, expected: number) => {
            // the chainflip figure: 17,270 s down in sixty covered days.
            expect(
              groupUptime({
                rows: cappedTails(),
                precision: precision,
                monitorGroupMergedDowntime: mergedFor([
                  [
                    MONITOR_GROUP,
                    {
                      coveredSeconds: 60 * DAY_SECONDS,
                      downtimeSeconds: 17270,
                    },
                  ],
                ]),
              }),
            ).toBe(expected);
          },
        );

        test("the day aggregate is still never read for a monitor group, whatever it holds", () => {
          const allOffline: Array<UptimeDayBucket> = [
            fullDay(0, OFFLINE_ID, DAY_SECONDS),
          ];

          expect(
            groupUptime({
              rows: outageErasedByTheRowMerge(),
              uptimeDailyAggregate: aggregateOf([
                [MONITOR_A, allOffline],
                [MONITOR_B, allOffline],
                [MONITOR_GROUP, allOffline],
              ]),
              monitorGroupMergedDowntime: mergedFor([
                [MONITOR_GROUP, SIX_DAYS_DOWN],
              ]),
            }),
          ).toBe(90);
        });

        test.each([
          [
            "nothing was recorded for it",
            (): Dictionary<MergedDowntimeTotals> => {
              return mergedFor([
                [MONITOR_GROUP, { coveredSeconds: 0, downtimeSeconds: 0 }],
              ]);
            },
          ],
          [
            "only another monitor group has a figure",
            (): Dictionary<MergedDowntimeTotals> => {
              return mergedFor([
                [
                  OTHER_MONITOR_GROUP,
                  {
                    coveredSeconds: 60 * DAY_SECONDS,
                    downtimeSeconds: 60 * DAY_SECONDS,
                  },
                ],
              ]);
            },
          ],
          [
            "the payload predates the figure, which parses as empty",
            (): Dictionary<MergedDowntimeTotals> => {
              return {};
            },
          ],
          [
            "it is omitted",
            (): undefined => {
              return undefined;
            },
          ],
          [
            "it is null",
            (): null => {
              return null;
            },
          ],
        ])(
          "a monitor group falls back to its rows, exactly as before, when %s",
          (
            _name: string,
            makeMerged: () =>
              | Dictionary<MergedDowntimeTotals>
              | null
              | undefined,
          ) => {
            /*
             * No reading is not a perfect reading: with nothing merged, the
             * rows are still the best account there is. B joins when A
             * recovers, so the row merge keeps A's six days (90%).
             */
            const rows: Array<MonitorStatusTimeline> = [
              ...sixDaysOfflineRows(MONITOR_A),
              makeRow({
                monitorId: MONITOR_B,
                status: operational(),
                startsAt: new Date(WINDOW.startDate.getTime() + 6 * DAY_MS),
              }),
            ];

            const fromRows: number | null = groupUptime({ rows: rows });

            expect(fromRows).toBe(90);

            expect(
              groupUptime({
                rows: rows,
                monitorGroupMergedDowntime: makeMerged(),
              }),
            ).toBe(fromRows);
          },
        );

        test("a resource that names a monitor is measured as that monitor, even if it names a monitor group too", () => {
          const resource: StatusPageResource = monitorResource({
            monitorId: MONITOR_A,
          });
          resource.monitorGroupId = MONITOR_GROUP;

          // the group was down the whole time: 0%, which must not be read.
          const merged: Dictionary<MergedDowntimeTotals> = mergedFor([
            [
              MONITOR_GROUP,
              {
                coveredSeconds: 60 * DAY_SECONDS,
                downtimeSeconds: 60 * DAY_SECONDS,
              },
            ],
          ]);

          // from the monitor's buckets...
          expect(
            groupUptime({
              resource: resource,
              rows: sixDaysOfflineRows(MONITOR_A),
              precision: UptimePrecision.THREE_DECIMAL,
              uptimeDailyAggregate: aggregateOf([
                [MONITOR_A, chainflipBuckets()],
              ]),
              monitorGroupMergedDowntime: merged,
            }),
          ).toBe(CHAINFLIP_UPTIME_THREE_DECIMAL);

          // ...and without them, from the monitor's own rows.
          expect(
            groupUptime({
              resource: resource,
              rows: sixDaysOfflineRows(MONITOR_A),
              precision: UptimePrecision.THREE_DECIMAL,
              monitorGroupMergedDowntime: merged,
            }),
          ).toBe(90);
        });

        test("a monitor resource never reads a merged figure, even one filed under its own monitor's id", () => {
          expect(
            groupUptime({
              resource: monitorResource({ monitorId: MONITOR_A }),
              rows: operationalTail(MONITOR_A),
              precision: UptimePrecision.THREE_DECIMAL,
              uptimeDailyAggregate: aggregateOf([
                [MONITOR_A, chainflipBuckets()],
              ]),
              monitorGroupMergedDowntime: mergedFor([
                [
                  MONITOR_A,
                  {
                    coveredSeconds: 60 * DAY_SECONDS,
                    downtimeSeconds: 60 * DAY_SECONDS,
                  },
                ],
              ]),
            }),
          ).toBe(CHAINFLIP_UPTIME_THREE_DECIMAL);
        });

        test("a monitor group that hides its uptime percent still reports nothing", () => {
          const resource: StatusPageResource = monitorGroupResource({
            monitorGroupId: MONITOR_GROUP,
          });
          resource.showUptimePercent = false;

          expect(
            groupUptime({
              resource: resource,
              rows: cappedTails(),
              monitorGroupMergedDowntime: mergedFor([
                [MONITOR_GROUP, SIX_DAYS_DOWN],
              ]),
            }),
          ).toBeNull();
        });
      });

      /*
       * Parent group: the monitor group (A + B, merged 90%). Child group:
       * monitor C (buckets 80%). The ungrouped OTHER monitor group (D,
       * merged 70%). Every row is a quiet Operational tail, so measured from
       * the rows alone both monitor groups are 100%.
       */
      function makeMixedPage(): {
        groups: Array<StatusPageGroup>;
        resources: Array<StatusPageResource>;
        rows: Array<MonitorStatusTimeline>;
        aggregate: UptimeDailyAggregate;
        merged: Dictionary<MergedDowntimeTotals>;
      } {
        return {
          groups: [
            makeStatusPageGroup({ id: PARENT_GROUP }),
            makeStatusPageGroup({ id: CHILD_GROUP, parentId: PARENT_GROUP }),
          ],
          resources: [
            monitorGroupResource({
              monitorGroupId: MONITOR_GROUP,
              groupId: PARENT_GROUP,
            }),
            monitorResource({ monitorId: MONITOR_C, groupId: CHILD_GROUP }),
            monitorGroupResource({ monitorGroupId: OTHER_MONITOR_GROUP }),
          ],
          rows: [
            ...operationalTail(MONITOR_A),
            ...operationalTail(MONITOR_B),
            ...operationalTail(MONITOR_C),
            ...operationalTail(MONITOR_D),
          ],
          aggregate: aggregateOf([
            [MONITOR_C, [fullDay(0, DEGRADED_ID, 17280)]],
          ]),
          merged: mergedFor([
            [MONITOR_GROUP, SIX_DAYS_DOWN],
            [
              OTHER_MONITOR_GROUP,
              {
                coveredSeconds: 60 * DAY_SECONDS,
                downtimeSeconds: 18 * DAY_SECONDS,
              },
            ],
          ]),
        };
      }

      test("a status page group averages a monitor group's merged reading with the rest of its subtree", () => {
        const page: ReturnType<typeof makeMixedPage> = makeMixedPage();

        // (90 + 80) / 2.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: page.groups[0]!,
              monitorStatusTimelines: page.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: page.resources,
              monitorsInGroup: monitorsOfTheGroup(),
              uptimeWindow: WINDOW,
              allStatusPageGroups: page.groups,
              uptimeDailyAggregate: page.aggregate,
              monitorGroupMergedDowntime: page.merged,
            },
          ),
        ).toBe(85);

        // the old reading: the monitor group from its capped rows, (100 + 80) / 2.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentOfStatusPageGroup(
            {
              statusPageGroup: page.groups[0]!,
              monitorStatusTimelines: page.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: page.resources,
              monitorsInGroup: monitorsOfTheGroup(),
              uptimeWindow: WINDOW,
              allStatusPageGroups: page.groups,
              uptimeDailyAggregate: page.aggregate,
            },
          ),
        ).toBe(90);
      });

      test("the page average reaches a monitor group's merged reading, in a group or not", () => {
        const page: ReturnType<typeof makeMixedPage> = makeMixedPage();

        // parent subtree (90 + 80) / 2 = 85, ungrouped monitor group 70 -> 77.5.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: page.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: page.resources,
              resourceGroups: page.groups,
              monitorsInGroup: monitorsOfTheGroup(),
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: page.aggregate,
              monitorGroupMergedDowntime: page.merged,
            },
          ),
        ).toBe(77.5);

        // the old reading: both monitor groups 100% -> (90 + 100) / 2.
        expect(
          StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(
            {
              monitorStatusTimelines: page.rows,
              precision: UptimePrecision.TWO_DECIMAL,
              downtimeMonitorStatuses: downtimeStatuses(),
              statusPageResources: page.resources,
              resourceGroups: page.groups,
              monitorsInGroup: monitorsOfTheGroup(),
              uptimeWindow: WINDOW,
              uptimeDailyAggregate: page.aggregate,
            },
          ),
        ).toBe(95);
      });
    });
  });
});
