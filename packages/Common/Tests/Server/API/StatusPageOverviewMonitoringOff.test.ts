import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { StatusPageOverviewBase } from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { StatusPageSummary } from "../../../Types/StatusPage/StatusPageSummary";
import StatusPageSummaryBuilder from "../../../Utils/StatusPage/StatusPageSummaryBuilder";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * A STATUS PAGE'S OVERVIEW WITH MONITORING OFF (#6478).
 *
 * A monitor whose monitoring is turned off is not checked: the status it
 * holds is what its last check saw, frozen. The overview keeps it on the
 * page and lists it in notMonitoredResourceIds, for the page to draw as Not
 * monitored in gray - and so does a monitor group whose monitors all have
 * it off. Neither decides a status: not its group's
 * (monitorGroupCurrentStatuses), not the page's banner (overallStatus),
 * which is null when nothing on the page is monitored. The summary built
 * from the overview says the same.
 *
 * The overview is built for real (getStatusPageResourcesAndTimelines,
 * MonitorGroupService.getCurrentStatusesForMonitorGroups, buildOverviewBase)
 * over reads that are stand-ins: no database is touched.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5d600000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "5d600000-0000-4000-8000-000000000002",
);

function id(suffix: string): string {
  return `5d600000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

function status(
  suffix: string,
  name: string,
  priority: number,
  isOperational: boolean = false,
): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model._id = id(suffix);
  model.name = name;
  model.priority = priority;
  model.color = Color.fromString("#2ab57d");
  model.isOperationalState = isOperational;
  return model;
}

const OPERATIONAL: MonitorStatus = status("b01", "Operational", 1, true);
const DEGRADED: MonitorStatus = status("b02", "Degraded", 2);
const OFFLINE: MonitorStatus = status("b03", "Offline", 3);

// The page's resources.
const R_API: string = id("d01");
const R_SEARCH: string = id("d02");
const R_PAYMENTS: string = id("d03");
const R_EDGE: string = id("d04");
const R_LEGACY: string = id("d05");

// Monitor groups.
const G_ALL_OFF: string = id("c01");
const G_MIXED: string = id("c02");

interface MonitorSpec {
  monitorId: string;
  status: MonitorStatus;
  isMonitoringOff?: boolean | undefined;
  isArchived?: boolean | undefined;
}

function monitorOf(spec: MonitorSpec): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = spec.monitorId;
  monitor.currentMonitorStatusId = new ObjectID(spec.status._id!);
  monitor.isArchived = spec.isArchived === true;
  monitor.disableActiveMonitoring = spec.isMonitoringOff === true;
  return monitor;
}

function monitorResource(
  resourceId: string,
  name: string,
  spec: MonitorSpec,
  order: number,
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = resourceId;
  resource.displayName = name;
  resource.order = order;
  resource.showCurrentStatus = true;
  resource.showStatusHistoryChart = true;
  resource.showUptimePercent = false;
  resource.monitorId = new ObjectID(spec.monitorId);
  resource.monitor = monitorOf(spec);
  return resource;
}

function groupResource(
  resourceId: string,
  name: string,
  monitorGroupId: string,
  order: number,
): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = resourceId;
  resource.displayName = name;
  resource.order = order;
  resource.showCurrentStatus = true;
  resource.showStatusHistoryChart = true;
  resource.showUptimePercent = false;
  resource.monitorGroupId = new ObjectID(monitorGroupId);
  return resource;
}

function member(
  monitorGroupId: string,
  spec: MonitorSpec,
): MonitorGroupResource {
  const row: MonitorGroupResource = new MonitorGroupResource();
  row.monitorGroupId = new ObjectID(monitorGroupId);
  row.monitorId = new ObjectID(spec.monitorId);
  row.monitor = monitorOf(spec);
  return row;
}

interface World {
  resources: Array<StatusPageResource>;
  members: Dictionary<Array<MonitorGroupResource>>;
}

// A department's page: one monitor of each kind, and two monitor groups.
function departmentWorld(): World {
  return {
    resources: [
      monitorResource(
        R_API,
        "Checkout API",
        { monitorId: id("a01"), status: DEGRADED },
        1,
      ),
      monitorResource(
        R_SEARCH,
        "Search",
        { monitorId: id("a02"), status: OFFLINE, isMonitoringOff: true },
        2,
      ),
      groupResource(R_PAYMENTS, "Payments", G_ALL_OFF, 3),
      groupResource(R_EDGE, "Edge", G_MIXED, 4),
      monitorResource(
        R_LEGACY,
        "Legacy API",
        { monitorId: id("a03"), status: OFFLINE, isArchived: true },
        5,
      ),
    ],
    members: {
      [G_ALL_OFF]: [
        member(G_ALL_OFF, {
          monitorId: id("a11"),
          status: OFFLINE,
          isMonitoringOff: true,
        }),
        member(G_ALL_OFF, {
          monitorId: id("a12"),
          status: OFFLINE,
          isMonitoringOff: true,
        }),
      ],
      [G_MIXED]: [
        // Off, and left at Offline: its status decides nothing.
        member(G_MIXED, {
          monitorId: id("a21"),
          status: OFFLINE,
          isMonitoringOff: true,
        }),
        member(G_MIXED, { monitorId: id("a22"), status: OPERATIONAL }),
      ],
    },
  };
}

let resourceReads: Array<JSONObject> = [];

function mockWorld(world: World): StatusPageAPI {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID.toString();
  statusPage.projectId = PROJECT_ID;
  statusPage.showUptimeHistoryInDays = 30;
  statusPage.showIncidentsOnStatusPage = false;
  statusPage.showEpisodesOnStatusPage = false;
  statusPage.showAnnouncementsOnStatusPage = false;
  statusPage.showScheduledMaintenanceEventsOnStatusPage = false;

  jest
    .spyOn(StatusPageService, "findOneBy")
    .mockResolvedValue(statusPage as never);
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([OPERATIONAL, DEGRADED, OFFLINE] as never);
  jest.spyOn(StatusPageGroupService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(StatusPageResourceService, "findBy").mockImplementation((async (
    args: JSONObject,
  ) => {
    resourceReads.push(args);
    return world.resources;
  }) as never);
  jest
    .spyOn(MonitorGroupService, "getMonitorGroupResourcesByGroupIds")
    .mockImplementation((async (groupIds: Array<ObjectID>) => {
      const read: Dictionary<Array<MonitorGroupResource>> = {};

      for (const groupId of groupIds) {
        read[groupId.toString()] = world.members[groupId.toString()] || [];
      }

      return read;
    }) as never);
  jest
    .spyOn(StatusPageService, "getMonitorStatusTimelineForStatusPage")
    .mockResolvedValue([] as never);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
    .mockResolvedValue([] as never);
  jest
    .spyOn(StatusPageHistoryChartBarColorRuleService, "findBy")
    .mockResolvedValue([] as never);

  const api: StatusPageAPI = new StatusPageAPI();

  jest
    .spyOn(api, "getMergedDowntimeByMonitorGroupId")
    .mockResolvedValue({} as never);
  jest
    .spyOn(api, "getTimelineScheduledMaintenanceEvents")
    .mockResolvedValue([] as never);

  return api;
}

type ResourcesAndTimelines = Awaited<
  ReturnType<StatusPageAPI["getStatusPageResourcesAndTimelines"]>
>;

async function readResources(world: World): Promise<ResourcesAndTimelines> {
  return await mockWorld(world).getStatusPageResourcesAndTimelines({
    statusPageId: STATUS_PAGE_ID,
    includeUptimeDailyAggregate: false,
  });
}

async function overviewOf(world: World): Promise<JSONObject> {
  const base: StatusPageOverviewBase =
    await mockWorld(world).buildOverviewBase(STATUS_PAGE_ID);

  // Over the wire, as the page and the summary read it.
  return JSON.parse(JSON.stringify(base.response)) as JSONObject;
}

function idsOf(resources: Array<StatusPageResource>): Array<string> {
  return resources.map((resource: StatusPageResource): string => {
    return resource._id!.toString();
  });
}

beforeEach(() => {
  resourceReads = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getStatusPageResourcesAndTimelines: what nothing checks", () => {
  test("reads whether each monitor's monitoring is off, with the resources", async () => {
    await readResources(departmentWorld());

    expect(resourceReads).toHaveLength(1);
    const select: JSONObject = resourceReads[0]!["select"] as JSONObject;
    expect((select["monitor"] as JSONObject)["disableActiveMonitoring"]).toBe(
      true,
    );
    expect((select["monitor"] as JSONObject)["isArchived"]).toBe(true);
  });

  test("keeps a monitor whose monitoring is off on the page, and leaves an archived one off", async () => {
    const read: ResourcesAndTimelines = await readResources(departmentWorld());

    expect(idsOf(read.statusPageResources)).toEqual([
      R_API,
      R_SEARCH,
      R_PAYMENTS,
      R_EDGE,
    ]);
  });

  test("lists the monitor whose monitoring is off, and the group whose monitors all have it off, as not monitored", async () => {
    const read: ResourcesAndTimelines = await readResources(departmentWorld());

    expect(read.notMonitoredResourceIds).toEqual([R_SEARCH, R_PAYMENTS]);
  });

  test("gives no status to a group whose monitors all have monitoring off; a mixed group's comes from its checked monitors", async () => {
    const read: ResourcesAndTimelines = await readResources(departmentWorld());

    expect(read.monitorGroupCurrentStatuses[G_ALL_OFF]).toBeUndefined();
    expect(read.monitorGroupCurrentStatuses[G_MIXED]?.toString()).toBe(
      OPERATIONAL._id,
    );
  });

  test("still lists the monitors of a group nothing checks: incidents and maintenance on them still show", async () => {
    const read: ResourcesAndTimelines = await readResources(departmentWorld());

    expect(
      (read.monitorsInGroup[G_ALL_OFF] || []).map((monitorId: ObjectID) => {
        return monitorId.toString();
      }),
    ).toEqual([id("a11"), id("a12")]);
    expect(
      read.monitorsOnStatusPage.map((monitorId: ObjectID) => {
        return monitorId.toString();
      }),
    ).toEqual(
      expect.arrayContaining([id("a02"), id("a11"), id("a12"), id("a21")]),
    );
  });

  test("a page whose monitors all have monitoring on lists nothing", async () => {
    const world: World = {
      resources: [
        monitorResource(
          R_API,
          "Checkout API",
          { monitorId: id("a01"), status: DEGRADED },
          1,
        ),
        groupResource(R_EDGE, "Edge", G_MIXED, 2),
      ],
      members: {
        [G_MIXED]: [
          member(G_MIXED, { monitorId: id("a22"), status: OPERATIONAL }),
        ],
      },
    };

    const read: ResourcesAndTimelines = await readResources(world);

    expect(read.notMonitoredResourceIds).toEqual([]);
    expect(read.monitorGroupCurrentStatuses[G_MIXED]?.toString()).toBe(
      OPERATIONAL._id,
    );
  });

  test("an empty monitor group is not one nothing checks", async () => {
    const world: World = {
      resources: [groupResource(R_EDGE, "Edge", G_MIXED, 1)],
      members: { [G_MIXED]: [] },
    };

    const read: ResourcesAndTimelines = await readResources(world);

    expect(read.notMonitoredResourceIds).toEqual([]);
  });
});

describe("buildOverviewBase: the overview a page draws", () => {
  test("sends the resources nothing checks, and a banner that leaves them out", async () => {
    const overview: JSONObject = await overviewOf(departmentWorld());

    expect(overview["notMonitoredResourceIds"]).toEqual([R_SEARCH, R_PAYMENTS]);

    // Checkout API is Degraded: the worst of what is checked, never a frozen Offline.
    expect((overview["overallStatus"] as JSONObject)["name"]).toBe("Degraded");

    const groupStatuses: Dictionary<ObjectID> = JSONFunctions.deserialize(
      overview["monitorGroupCurrentStatuses"] as JSONObject,
    ) as Dictionary<ObjectID>;
    expect(Object.keys(groupStatuses)).toEqual([G_MIXED]);
  });

  test("keeps every resource it lists: nothing checked is still on the page", async () => {
    const overview: JSONObject = await overviewOf(departmentWorld());

    expect(
      (overview["statusPageResources"] as Array<JSONObject>).map(
        (resource: JSONObject): unknown => {
          return resource["_id"];
        },
      ),
    ).toEqual([R_API, R_SEARCH, R_PAYMENTS, R_EDGE]);
  });

  test("a page none of whose resources is monitored has no overall status", async () => {
    const world: World = departmentWorld();
    world.resources = [world.resources[1]!, world.resources[2]!];

    const overview: JSONObject = await overviewOf(world);

    expect(overview["overallStatus"]).toBeNull();
    expect(overview["notMonitoredResourceIds"]).toEqual([R_SEARCH, R_PAYMENTS]);
  });

  test("a page with nothing off sends an empty list, and the banner it always did", async () => {
    const world: World = {
      resources: [
        monitorResource(
          R_API,
          "Checkout API",
          { monitorId: id("a01"), status: OFFLINE },
          1,
        ),
      ],
      members: {},
    };

    const overview: JSONObject = await overviewOf(world);

    expect(overview["notMonitoredResourceIds"]).toEqual([]);
    expect((overview["overallStatus"] as JSONObject)["name"]).toBe("Offline");
  });

  test("the summary built from it says the same: listed, not monitored, no status", async () => {
    const summary: StatusPageSummary = StatusPageSummaryBuilder.fromOverview(
      await overviewOf(departmentWorld()),
    );

    expect(
      summary.resources.map((resource: StatusPageSummary["resources"][0]) => {
        return [
          resource.name,
          resource.isMonitored,
          resource.currentStatus?.name || null,
        ];
      }),
    ).toEqual([
      ["Checkout API", true, "Degraded"],
      ["Search", false, null],
      ["Payments", false, null],
      ["Edge", true, "Operational"],
    ]);
    expect(summary.overallStatus?.name).toBe("Degraded");
  });
});
