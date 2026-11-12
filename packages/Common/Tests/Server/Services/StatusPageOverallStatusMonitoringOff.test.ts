import StatusPageService from "../../../Server/Services/StatusPageService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A STATUS PAGE'S OVERALL STATUS, WITH MONITORS NOTHING CHECKS (#6478).
 *
 * StatusPageService.getOverallMonitorStatus is the page's banner, its
 * embedded badge and its summary: the worst status among its resources. A
 * monitor whose monitoring is off is not checked, so the status it holds is
 * frozen - "Offline" forever after a last bad check. It must decide none of
 * them. The page keeps the resource and draws it as Not monitored
 * (notMonitoredResourceIds), and when nothing on the page is monitored
 * there is no status to give at all: null, which the page draws as Not
 * monitored.
 */

function status(name: string, priority: number): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model._id = ObjectID.generate().toString();
  model.name = name;
  model.priority = priority;
  return model;
}

// The project's statuses, sorted by priority as the overview reads them.
const OPERATIONAL: MonitorStatus = status("Operational", 1);
const DEGRADED: MonitorStatus = status("Degraded", 2);
const OFFLINE: MonitorStatus = status("Offline", 3);
const STATUSES: Array<MonitorStatus> = [OPERATIONAL, DEGRADED, OFFLINE];

function monitorResource(
  current: MonitorStatus,
  state: {
    isMonitoringOff?: boolean | undefined;
    isArchived?: boolean | undefined;
  } = {},
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorId = ObjectID.generate();
  const monitor: Monitor = new Monitor(resource.monitorId);
  monitor.currentMonitorStatusId = new ObjectID(current._id!);
  if (state.isMonitoringOff !== undefined) {
    monitor.disableActiveMonitoring = state.isMonitoringOff;
  }
  if (state.isArchived !== undefined) {
    monitor.isArchived = state.isArchived;
  }
  resource.monitor = monitor;
  return resource;
}

function groupResource(monitorGroupId: ObjectID): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = ObjectID.generate().toString();
  resource.monitorGroupId = monitorGroupId;
  return resource;
}

function idOf(resource: StatusPageResource): string {
  return resource._id!.toString();
}

function overall(data: {
  resources: Array<StatusPageResource>;
  groupStatuses?: Dictionary<ObjectID>;
  notMonitored?: Array<string> | Set<string>;
}): string | null {
  return (
    StatusPageService.getOverallMonitorStatus({
      statusPageResources: data.resources,
      monitorStatuses: STATUSES,
      monitorGroupCurrentStatuses: data.groupStatuses || {},
      notMonitoredResourceIds: data.notMonitored,
    })?.name || null
  );
}

describe("getOverallMonitorStatus: what it always was", () => {
  test("the worst status among the page's resources", () => {
    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), monitorResource(DEGRADED)],
      }),
    ).toBe("Degraded");
  });

  test("a monitor group's status counts as any monitor's", () => {
    const group: ObjectID = ObjectID.generate();

    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), groupResource(group)],
        groupStatuses: { [group.toString()]: new ObjectID(OFFLINE._id!) },
      }),
    ).toBe("Offline");
  });

  test("an empty page is Operational: the project's first status", () => {
    expect(overall({ resources: [] })).toBe("Operational");
    expect(overall({ resources: [], notMonitored: [] })).toBe("Operational");
  });

  test("no statuses: no overall status", () => {
    expect(
      StatusPageService.getOverallMonitorStatus({
        statusPageResources: [monitorResource(OFFLINE)],
        monitorStatuses: [],
        monitorGroupCurrentStatuses: {},
      }),
    ).toBeNull();
  });
});

describe("getOverallMonitorStatus: monitors nothing checks decide nothing", () => {
  test("a monitor whose monitoring is off: its frozen Offline is not the page's", () => {
    const off: StatusPageResource = monitorResource(OFFLINE, {
      isMonitoringOff: true,
    });

    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), off],
        notMonitored: [idOf(off)],
      }),
    ).toBe("Operational");
  });

  test("the monitor's own switch is enough, even when the caller passes no list", () => {
    expect(
      overall({
        resources: [
          monitorResource(DEGRADED),
          monitorResource(OFFLINE, { isMonitoringOff: true }),
        ],
      }),
    ).toBe("Degraded");
  });

  test("an archived monitor decides nothing", () => {
    expect(
      overall({
        resources: [
          monitorResource(OPERATIONAL),
          monitorResource(OFFLINE, { isArchived: true }),
        ],
      }),
    ).toBe("Operational");
  });

  test("a monitor read without the switch counts as checked", () => {
    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), monitorResource(OFFLINE)],
      }),
    ).toBe("Offline");
  });

  test("a monitor whose monitoring is on, said so, counts", () => {
    expect(
      overall({
        resources: [
          monitorResource(OPERATIONAL),
          monitorResource(DEGRADED, { isMonitoringOff: false }),
        ],
      }),
    ).toBe("Degraded");
  });

  test("a resource the list names decides nothing, whatever its monitor says", () => {
    // Its monitor was read without the switch: the list alone leaves it out.
    const listed: StatusPageResource = monitorResource(OFFLINE);

    expect(
      overall({
        resources: [monitorResource(DEGRADED), listed],
        notMonitored: [idOf(listed)],
      }),
    ).toBe("Degraded");
  });

  test("a monitor group whose monitors all have monitoring off: its status is not given, and it decides nothing", () => {
    const allOff: ObjectID = ObjectID.generate();
    const offGroup: StatusPageResource = groupResource(allOff);

    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), offGroup],
        // withoutNotMonitoredMonitorGroups left its status out.
        groupStatuses: {},
        notMonitored: [idOf(offGroup)],
      }),
    ).toBe("Operational");
  });

  test("the list as a set reads the same as the list", () => {
    const off: StatusPageResource = monitorResource(OFFLINE);

    expect(
      overall({
        resources: [monitorResource(OPERATIONAL), off],
        notMonitored: new Set<string>([idOf(off)]),
      }),
    ).toBe("Operational");
  });
});

describe("getOverallMonitorStatus: a page none of whose resources is monitored", () => {
  test("has no overall status: null, never the project's Operational", () => {
    const first: StatusPageResource = monitorResource(OFFLINE, {
      isMonitoringOff: true,
    });
    const second: StatusPageResource = monitorResource(OPERATIONAL, {
      isMonitoringOff: true,
    });

    expect(
      overall({
        resources: [first, second],
        notMonitored: [idOf(first), idOf(second)],
      }),
    ).toBeNull();
  });

  test("monitor groups too: a page of groups whose monitors are all off has no status", () => {
    const group: StatusPageResource = groupResource(ObjectID.generate());
    const monitor: StatusPageResource = monitorResource(DEGRADED, {
      isMonitoringOff: true,
    });

    expect(
      overall({
        resources: [group, monitor],
        notMonitored: new Set<string>([idOf(group), idOf(monitor)]),
      }),
    ).toBeNull();
  });

  test("one resource still monitored is enough for a status", () => {
    const off: StatusPageResource = monitorResource(OFFLINE, {
      isMonitoringOff: true,
    });

    expect(
      overall({
        resources: [off, monitorResource(DEGRADED)],
        notMonitored: [idOf(off)],
      }),
    ).toBe("Degraded");
  });

  test("the monitors' own switches are enough, without the list", () => {
    expect(
      overall({
        resources: [
          monitorResource(OFFLINE, { isMonitoringOff: true }),
          monitorResource(DEGRADED, { isMonitoringOff: true }),
        ],
      }),
    ).toBeNull();
  });

  test("an archived monitor is not a monitor that is not monitored: it is off the page", () => {
    /*
     * The reads leave archived monitors out before they get here; one that
     * slips through decides nothing, and does not make the page Not
     * monitored either.
     */
    expect(
      overall({
        resources: [monitorResource(OFFLINE, { isArchived: true })],
      }),
    ).toBe("Operational");
  });
});
