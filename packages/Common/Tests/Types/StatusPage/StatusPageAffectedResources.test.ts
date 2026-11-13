import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  getAffectedResourceLabel,
  getAffectedResourceLabels,
  getResourcesAffectedByMonitors,
} from "../../../Types/StatusPage/StatusPageAffectedResources";
import StatusPageGroupViewMode from "../../../Types/StatusPage/StatusPageGroupViewMode";
import { describe, expect, test } from "@jest/globals";

/*
 * What a status page says an event affects is named the way the page names
 * it, never by the monitors' own names, and the page's Scheduled
 * Maintenance pages and its maintenance calendar read the same list.
 */

const MONITOR_A: string = "019acd20-1111-4111-8111-111111111111";
const MONITOR_B: string = "019acd20-2222-4222-8222-222222222222";
const MONITOR_C: string = "019acd20-3333-4333-8333-333333333333";
const MONITOR_GROUP_X: string = "019acd20-4444-4444-8444-444444444444";
const MONITOR_GROUP_Y: string = "019acd20-5555-4555-8555-555555555555";

function makeGroup(
  name: string,
  viewMode: StatusPageGroupViewMode = StatusPageGroupViewMode.List,
): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = name;
  group.viewMode = viewMode;
  return group;
}

function makeResource(data: {
  displayName?: string;
  group?: StatusPageGroup;
  monitorId?: string;
  monitorGroupId?: string;
  rowAxisValue?: string;
  columnAxisValue?: string;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();

  if (data.displayName !== undefined) {
    resource.displayName = data.displayName;
  }

  if (data.group) {
    resource.statusPageGroup = data.group;
  }

  if (data.monitorId) {
    resource.monitorId = new ObjectID(data.monitorId);
  }

  if (data.monitorGroupId) {
    resource.monitorGroupId = new ObjectID(data.monitorGroupId);
  }

  if (data.rowAxisValue !== undefined) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue !== undefined) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
}

describe("getAffectedResourceLabel", () => {
  test("is the page's name for a resource outside any group", () => {
    expect(getAffectedResourceLabel(makeResource({ displayName: "API" }))).toBe(
      "API",
    );
  });

  test("puts the group's name first", () => {
    expect(
      getAffectedResourceLabel(
        makeResource({ displayName: "API", group: makeGroup("Backend") }),
      ),
    ).toBe("Backend: API");
  });

  test("is empty for a resource the page gives no name", () => {
    expect(getAffectedResourceLabel(makeResource({}))).toBe("");
  });

  test("names a grid cell by its row and column", () => {
    expect(
      getAffectedResourceLabel(
        makeResource({
          displayName: "API",
          group: makeGroup("Regions", StatusPageGroupViewMode.Grid),
          rowAxisValue: "EU",
          columnAxisValue: "Web",
        }),
      ),
    ).toBe("Regions — EU × Web");
  });

  test("names a grid cell by its row or its column when it has only one", () => {
    const grid: StatusPageGroup = makeGroup(
      "Regions",
      StatusPageGroupViewMode.Grid,
    );

    expect(
      getAffectedResourceLabel(
        makeResource({ displayName: "API", group: grid, rowAxisValue: "EU" }),
      ),
    ).toBe("Regions — EU");
    expect(
      getAffectedResourceLabel(
        makeResource({
          displayName: "API",
          group: grid,
          columnAxisValue: "Web",
        }),
      ),
    ).toBe("Regions — Web");
  });

  test("names a grid cell without its group's name when the group has none", () => {
    expect(
      getAffectedResourceLabel(
        makeResource({
          displayName: "API",
          group: makeGroup("", StatusPageGroupViewMode.Grid),
          rowAxisValue: "EU",
          columnAxisValue: "Web",
        }),
      ),
    ).toBe("EU × Web");
  });

  test("names a resource in a grid group without a cell by its display name", () => {
    expect(
      getAffectedResourceLabel(
        makeResource({
          displayName: "API",
          group: makeGroup("Regions", StatusPageGroupViewMode.Grid),
        }),
      ),
    ).toBe("Regions: API");
  });

  test("ignores the row and column of a resource in a list group", () => {
    expect(
      getAffectedResourceLabel(
        makeResource({
          displayName: "API",
          group: makeGroup("Backend"),
          rowAxisValue: "EU",
          columnAxisValue: "Web",
        }),
      ),
    ).toBe("Backend: API");
  });
});

describe("getResourcesAffectedByMonitors", () => {
  const apiResource: StatusPageResource = makeResource({
    displayName: "API",
    monitorId: MONITOR_A,
  });
  const webResource: StatusPageResource = makeResource({
    displayName: "Web",
    monitorId: MONITOR_B,
  });
  const databasesResource: StatusPageResource = makeResource({
    displayName: "Databases",
    monitorGroupId: MONITOR_GROUP_X,
  });
  const queuesResource: StatusPageResource = makeResource({
    displayName: "Queues",
    monitorGroupId: MONITOR_GROUP_Y,
  });

  const statusPageResources: Array<StatusPageResource> = [
    databasesResource,
    apiResource,
    queuesResource,
    webResource,
  ];

  const monitorsInGroup: Dictionary<Array<ObjectID | string>> = {
    [MONITOR_GROUP_X]: [new ObjectID(MONITOR_A), MONITOR_C],
    [MONITOR_GROUP_Y]: [MONITOR_B],
  };

  test("is none when the event has no monitors", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([]);
  });

  test("is none when every monitor id is empty", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [null, undefined],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([]);
  });

  test("is the resources that are the event's monitors, then the groups that hold them", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [MONITOR_A],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([apiResource, databasesResource]);
  });

  test("keeps the page's order within monitors and within groups", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [MONITOR_B, MONITOR_A],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([apiResource, webResource, databasesResource, queuesResource]);
  });

  test("reaches a group through a monitor that is not itself on the page", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [MONITOR_C],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([databasesResource]);
  });

  test("reads monitor ids given as ObjectIDs or strings alike", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [new ObjectID(MONITOR_B), null],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([webResource, queuesResource]);
  });

  test("lists a resource once however many of its monitors are affected", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [MONITOR_A, MONITOR_A, MONITOR_C],
        statusPageResources,
        monitorsInGroup,
      }),
    ).toEqual([apiResource, databasesResource]);
  });

  test("leaves out a group whose monitors are not known", () => {
    expect(
      getResourcesAffectedByMonitors({
        monitorIds: [MONITOR_A, MONITOR_B],
        statusPageResources,
        monitorsInGroup: {},
      }),
    ).toEqual([apiResource, webResource]);
  });
});

describe("getAffectedResourceLabels", () => {
  test("names each affected resource the way the page does", () => {
    const backend: StatusPageGroup = makeGroup("Backend");

    expect(
      getAffectedResourceLabels({
        monitorIds: [MONITOR_A],
        statusPageResources: [
          makeResource({
            displayName: "Databases",
            group: backend,
            monitorGroupId: MONITOR_GROUP_X,
          }),
          makeResource({
            displayName: "API",
            group: backend,
            monitorId: MONITOR_A,
          }),
          makeResource({ displayName: "Web", monitorId: MONITOR_B }),
        ],
        monitorsInGroup: { [MONITOR_GROUP_X]: [MONITOR_A] },
      }),
    ).toEqual(["Backend: API", "Backend: Databases"]);
  });

  test("is none when the event reaches nothing on the page", () => {
    expect(
      getAffectedResourceLabels({
        monitorIds: [MONITOR_C],
        statusPageResources: [
          makeResource({ displayName: "API", monitorId: MONITOR_A }),
        ],
        monitorsInGroup: {},
      }),
    ).toEqual([]);
  });
});
