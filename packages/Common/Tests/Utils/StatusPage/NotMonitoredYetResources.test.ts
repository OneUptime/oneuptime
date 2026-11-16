import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import FrozenMonitorResources, {
  MONITOR_NOT_MONITORED_YET_SELECT,
  NOT_MONITORED_STATUS_NAME,
  NOT_MONITORED_YET_STATUS_NAME,
  ResourceWithMonitor,
  StartingStatusIds,
  StatusPageResourceWithMonitor,
} from "../../../Utils/StatusPage/FrozenMonitorResources";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { describe, expect, test } from "@jest/globals";

/*
 * A STATUS PAGE RESOURCE NOTHING HAS CHECKED YET (issue #8899).
 *
 * A new monitor holds the operational status every monitor is created in
 * before its first check, and for good when no probe ever reaches it. A
 * status page drew it Operational, in green, and counted it as up. It is
 * drawn Not monitored yet now, in gray, and decides no status - the page's,
 * a group's - as a monitor whose monitoring is off does. These are the
 * answers the page's reads (StatusPageAPI, the badge, OneUptime AI's tool)
 * take from FrozenMonitorResources.
 */

const OPERATIONAL: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0101";
const SECOND_OPERATIONAL: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0102";
const DEGRADED: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0103";
const OFFLINE: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0104";
const BOTH_WAYS: string = "8b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0105";

const STATUSES: Array<{
  _id: string;
  isOperationalState: boolean;
  isOfflineState?: boolean;
}> = [
  { _id: OPERATIONAL, isOperationalState: true, isOfflineState: false },
  { _id: SECOND_OPERATIONAL, isOperationalState: true },
  { _id: DEGRADED, isOperationalState: false, isOfflineState: false },
  { _id: OFFLINE, isOperationalState: false, isOfflineState: true },
  // A status flagged both ways is read as offline, as the hero reads it.
  { _id: BOTH_WAYS, isOperationalState: true, isOfflineState: true },
];

const STARTING: StartingStatusIds =
  FrozenMonitorResources.getStartingStatusIds(STATUSES);

interface MonitorFields {
  isArchived?: boolean | undefined;
  disableActiveMonitoring?: boolean | null | undefined;
  firstMeasuredAt?: Date | string | null | undefined;
  monitorType?: string | null | undefined;
  currentMonitorStatusId?: unknown;
}

const NEW_WEBSITE: MonitorFields = {
  isArchived: false,
  disableActiveMonitoring: false,
  firstMeasuredAt: null,
  monitorType: MonitorType.Website,
  currentMonitorStatusId: OPERATIONAL,
};

const CHECKED_WEBSITE: MonitorFields = {
  ...NEW_WEBSITE,
  firstMeasuredAt: new Date("2026-11-16T10:00:00.000Z"),
};

const OFF_WEBSITE: MonitorFields = {
  ...CHECKED_WEBSITE,
  disableActiveMonitoring: true,
};

let nextId: number = 1;

function monitorResource(monitor: MonitorFields): StatusPageResourceWithMonitor {
  const id: string = `9a000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

  return {
    _id: id,
    monitorId: `${id}-monitor`,
    monitor: { ...monitor },
  };
}

function groupResource(groupId: string): StatusPageResourceWithMonitor {
  const id: string = `9b000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

  return { _id: id, monitorGroupId: groupId };
}

function member(monitor: MonitorFields): ResourceWithMonitor {
  return { monitorId: "member", monitor: { ...monitor } };
}

describe("the statuses a monitor can start in", () => {
  test("every operational status, and only those not flagged offline as well", () => {
    expect(Array.from(STARTING).sort()).toEqual(
      [OPERATIONAL, SECOND_OPERATIONAL].sort(),
    );
  });

  test("statuses read as the API hands them over, by their id", () => {
    const ids: StartingStatusIds = FrozenMonitorResources.getStartingStatusIds([
      { id: new ObjectID(OPERATIONAL), isOperationalState: true },
      { id: new ObjectID(DEGRADED), isOperationalState: false },
    ]);

    expect(Array.from(ids)).toEqual([OPERATIONAL]);
  });

  test("none for none", () => {
    expect(FrozenMonitorResources.getStartingStatusIds([]).size).toBe(0);
  });
});

describe("a monitor nothing has checked yet", () => {
  test("is not monitored yet while it holds a status it can have started in", () => {
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource(NEW_WEBSITE),
        STARTING,
      ),
    ).toBe(true);
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource({
          ...NEW_WEBSITE,
          currentMonitorStatusId: SECOND_OPERATIONAL,
        }),
        STARTING,
      ),
    ).toBe(true);
  });

  test("a status something else set before the first check is shown as it is", () => {
    for (const statusId of [DEGRADED, OFFLINE, BOTH_WAYS]) {
      expect({
        statusId,
        isNotMonitoredYet: FrozenMonitorResources.isNotMonitoredYet(
          monitorResource({ ...NEW_WEBSITE, currentMonitorStatusId: statusId }),
          STARTING,
        ),
      }).toEqual({ statusId, isNotMonitoredYet: false });
    }
  });

  test("a monitor something has measured is monitored, whatever its status", () => {
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource(CHECKED_WEBSITE),
        STARTING,
      ),
    ).toBe(false);
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource({
          ...CHECKED_WEBSITE,
          firstMeasuredAt: "2026-11-16T10:00:00.000Z",
        }),
        STARTING,
      ),
    ).toBe(false);
  });

  test("a manual monitor never is: its Operational is a person's word", () => {
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource({ ...NEW_WEBSITE, monitorType: MonitorType.Manual }),
        STARTING,
      ),
    ).toBe(false);
  });

  test("a monitor read without what tells it is shown as it always was", () => {
    for (const monitor of [
      { ...NEW_WEBSITE, firstMeasuredAt: undefined },
      { ...NEW_WEBSITE, monitorType: undefined },
      { ...NEW_WEBSITE, currentMonitorStatusId: undefined },
      {},
    ] as Array<MonitorFields>) {
      expect(
        FrozenMonitorResources.isNotMonitoredYet(
          monitorResource(monitor),
          STARTING,
        ),
      ).toBe(false);
    }

    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        { monitorId: "no-monitor-read" },
        STARTING,
      ),
    ).toBe(false);
  });

  test("an archived monitor or one whose monitoring is off says why itself", () => {
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource({ ...NEW_WEBSITE, isArchived: true }),
        STARTING,
      ),
    ).toBe(false);
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource({ ...NEW_WEBSITE, disableActiveMonitoring: true }),
        STARTING,
      ),
    ).toBe(false);
  });

  test("without the page's starting statuses nothing is", () => {
    expect(
      FrozenMonitorResources.isNotMonitoredYet(
        monitorResource(NEW_WEBSITE),
        new Set<string>(),
      ),
    ).toBe(false);
  });
});

describe("the resources a page draws as not monitored, and the ones it words Not monitored yet", () => {
  const MONITOR_GROUP_ALL_NEW: string = "group-all-new";
  const MONITOR_GROUP_NEW_AND_OFF: string = "group-new-and-off";
  const MONITOR_GROUP_NEW_AND_CHECKED: string = "group-new-and-checked";
  const MONITOR_GROUP_ALL_OFF: string = "group-all-off";
  const MONITOR_GROUP_EMPTY: string = "group-empty";
  const MONITOR_GROUP_ARCHIVED_AND_NEW: string = "group-archived-and-new";

  const newResource: StatusPageResourceWithMonitor =
    monitorResource(NEW_WEBSITE);
  const checkedResource: StatusPageResourceWithMonitor =
    monitorResource(CHECKED_WEBSITE);
  const offResource: StatusPageResourceWithMonitor =
    monitorResource(OFF_WEBSITE);
  const allNewGroup: StatusPageResourceWithMonitor = groupResource(
    MONITOR_GROUP_ALL_NEW,
  );
  const newAndOffGroup: StatusPageResourceWithMonitor = groupResource(
    MONITOR_GROUP_NEW_AND_OFF,
  );
  const newAndCheckedGroup: StatusPageResourceWithMonitor = groupResource(
    MONITOR_GROUP_NEW_AND_CHECKED,
  );
  const allOffGroup: StatusPageResourceWithMonitor = groupResource(
    MONITOR_GROUP_ALL_OFF,
  );
  const emptyGroup: StatusPageResourceWithMonitor =
    groupResource(MONITOR_GROUP_EMPTY);
  const archivedAndNewGroup: StatusPageResourceWithMonitor = groupResource(
    MONITOR_GROUP_ARCHIVED_AND_NEW,
  );

  const resources: Array<StatusPageResourceWithMonitor> = [
    newResource,
    checkedResource,
    offResource,
    allNewGroup,
    newAndOffGroup,
    newAndCheckedGroup,
    allOffGroup,
    emptyGroup,
    archivedAndNewGroup,
  ];

  const monitorGroupResources: Record<string, Array<ResourceWithMonitor>> = {
    [MONITOR_GROUP_ALL_NEW]: [member(NEW_WEBSITE), member(NEW_WEBSITE)],
    [MONITOR_GROUP_NEW_AND_OFF]: [member(NEW_WEBSITE), member(OFF_WEBSITE)],
    [MONITOR_GROUP_NEW_AND_CHECKED]: [
      member(NEW_WEBSITE),
      member(CHECKED_WEBSITE),
    ],
    [MONITOR_GROUP_ALL_OFF]: [member(OFF_WEBSITE)],
    [MONITOR_GROUP_EMPTY]: [],
    [MONITOR_GROUP_ARCHIVED_AND_NEW]: [
      member({ ...CHECKED_WEBSITE, isArchived: true }),
      member(NEW_WEBSITE),
    ],
  };

  function idsOf(
    rows: Array<StatusPageResourceWithMonitor>,
  ): Array<string> {
    return rows
      .map((row: StatusPageResourceWithMonitor): string => {
        return String(row._id);
      })
      .sort();
  }

  test("not monitored: off, not checked yet, and groups of nothing else", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: resources,
        monitorGroupResources: monitorGroupResources,
        startingStatusIds: STARTING,
      }).sort(),
    ).toEqual(
      idsOf([
        newResource,
        offResource,
        allNewGroup,
        newAndOffGroup,
        allOffGroup,
        archivedAndNewGroup,
      ]),
    );
  });

  test("Not monitored yet: what nothing has checked yet, and groups every monitor of which is", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredYetResourceIds({
        statusPageResources: resources,
        monitorGroupResources: monitorGroupResources,
        startingStatusIds: STARTING,
      }).sort(),
    ).toEqual(idsOf([newResource, allNewGroup, archivedAndNewGroup]));
  });

  test("Not monitored yet is always among the not monitored", () => {
    const notMonitored: Set<string> = new Set<string>(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: resources,
        monitorGroupResources: monitorGroupResources,
        startingStatusIds: STARTING,
      }),
    );

    for (const id of FrozenMonitorResources.getNotMonitoredYetResourceIds({
      statusPageResources: resources,
      monitorGroupResources: monitorGroupResources,
      startingStatusIds: STARTING,
    })) {
      expect(notMonitored.has(id)).toBe(true);
    }
  });

  test("without the page's starting statuses, only what is off, as before", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: resources,
        monitorGroupResources: monitorGroupResources,
      }).sort(),
    ).toEqual(idsOf([offResource, allOffGroup]));
  });

  test("a group whose monitors are none of them checked decides no group status", () => {
    const statuses: Record<string, string> = {
      [MONITOR_GROUP_ALL_NEW]: OPERATIONAL,
      [MONITOR_GROUP_NEW_AND_OFF]: OPERATIONAL,
      [MONITOR_GROUP_NEW_AND_CHECKED]: OPERATIONAL,
      [MONITOR_GROUP_ALL_OFF]: OPERATIONAL,
      [MONITOR_GROUP_EMPTY]: OPERATIONAL,
    };

    expect(
      Object.keys(
        FrozenMonitorResources.withoutNotMonitoredMonitorGroups({
          monitorGroupStatuses: statuses,
          monitorGroupResources: monitorGroupResources,
          startingStatusIds: STARTING,
        }),
      ).sort(),
    ).toEqual([MONITOR_GROUP_EMPTY, MONITOR_GROUP_NEW_AND_CHECKED].sort());

    // Without them, a group of new monitors keeps its status, as before.
    expect(
      Object.keys(
        FrozenMonitorResources.withoutNotMonitoredMonitorGroups({
          monitorGroupStatuses: statuses,
          monitorGroupResources: monitorGroupResources,
        }),
      ).sort(),
    ).toEqual(
      [
        MONITOR_GROUP_ALL_NEW,
        MONITOR_GROUP_EMPTY,
        MONITOR_GROUP_NEW_AND_CHECKED,
        MONITOR_GROUP_NEW_AND_OFF,
      ].sort(),
    );
  });

  test("a page of nothing but resources not checked yet has no status but that", () => {
    const page: Array<StatusPageResourceWithMonitor> = [
      monitorResource(NEW_WEBSITE),
      monitorResource(NEW_WEBSITE),
    ];
    const notMonitored: Array<string> =
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: page,
        monitorGroupResources: {},
        startingStatusIds: STARTING,
      });
    const notMonitoredYet: Array<string> =
      FrozenMonitorResources.getNotMonitoredYetResourceIds({
        statusPageResources: page,
        monitorGroupResources: {},
        startingStatusIds: STARTING,
      });

    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(page, notMonitored),
    ).toBe(true);
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(page, notMonitoredYet),
    ).toBe(true);

    // One turned off among them, and the page is Not monitored, not yet.
    const withOneOff: Array<StatusPageResourceWithMonitor> = [
      ...page,
      monitorResource(OFF_WEBSITE),
    ];

    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(
        withOneOff,
        FrozenMonitorResources.getNotMonitoredResourceIds({
          statusPageResources: withOneOff,
          monitorGroupResources: {},
          startingStatusIds: STARTING,
        }),
      ),
    ).toBe(true);
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(
        withOneOff,
        FrozenMonitorResources.getNotMonitoredYetResourceIds({
          statusPageResources: withOneOff,
          monitorGroupResources: {},
          startingStatusIds: STARTING,
        }),
      ),
    ).toBe(false);
  });
});

describe("what a public page is sent of a resource's monitor", () => {
  test("what told a monitor nothing has checked is taken off, and nothing else", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = "9c000000-0000-4000-8000-000000000001";
    monitor.currentMonitorStatusId = new ObjectID(OPERATIONAL);
    monitor.isArchived = false;
    monitor.disableActiveMonitoring = false;
    monitor.firstMeasuredAt = null as unknown as Date;
    monitor.monitorType = MonitorType.Website;

    const resources: Array<ResourceWithMonitor> = [
      { monitorId: monitor._id, monitor: monitor },
      { monitorId: "no-monitor" },
    ];

    FrozenMonitorResources.forgetNotMonitoredYetFields(resources);

    expect(Object.keys(monitor)).not.toContain("firstMeasuredAt");
    expect(Object.keys(monitor)).not.toContain("monitorType");
    expect(monitor.currentMonitorStatusId?.toString()).toBe(OPERATIONAL);
    expect(monitor.isArchived).toBe(false);
    expect(monitor.disableActiveMonitoring).toBe(false);
    expect(
      JSON.stringify(Monitor.toJSONObject(monitor, Monitor)),
    ).not.toContain("firstMeasuredAt");
  });

  test("the fields a page reads to tell are columns of the Monitor model", () => {
    const model: Monitor = new Monitor();

    expect(Object.keys(MONITOR_NOT_MONITORED_YET_SELECT).sort()).toEqual(
      ["firstMeasuredAt", "monitorType"].sort(),
    );

    for (const column of Object.keys(MONITOR_NOT_MONITORED_YET_SELECT)) {
      expect(model.isTableColumn(column)).toBe(true);
    }
  });

  test("the badge's English words for a page nothing on which has been checked yet", () => {
    expect(NOT_MONITORED_YET_STATUS_NAME).toBe("Not monitored yet");
    expect(NOT_MONITORED_STATUS_NAME).toBe("Not monitored");
  });
});
