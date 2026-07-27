import StatusPageResourceUptimeUtil from "../../../Utils/StatusPage/ResourceUptime";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import Dictionary from "../../../Types/Dictionary";
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
});
