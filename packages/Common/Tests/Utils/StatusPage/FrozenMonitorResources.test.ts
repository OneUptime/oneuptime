import ObjectID from "../../../Types/ObjectID";
import FrozenMonitorResources, {
  ResourceWithMonitor,
  StatusPageResourceWithMonitor,
} from "../../../Utils/StatusPage/FrozenMonitorResources";
import { describe, expect, test } from "@jest/globals";

/*
 * Two kinds of monitor are not checked, so the status each holds is frozen:
 * an archived one and one whose monitoring is turned off (issue #6478).
 * Neither decides a monitor group's status, a status page group's or a
 * status page's. A status page leaves the archived one out of every public
 * read, and keeps the one whose monitoring is off, drawn as Not monitored -
 * as it does a monitor group whose monitors all have it off. These are the
 * answers every one of those reads relies on.
 */

interface Row extends ResourceWithMonitor {
  name: string;
}

interface MonitorFlags {
  isArchived?: boolean | undefined;
  disableActiveMonitoring?: boolean | null | undefined;
}

function monitorRow(name: string, flags?: MonitorFlags): Row {
  return {
    name,
    monitorId: `${name}-id`,
    monitor: flags === undefined ? {} : { ...flags },
  };
}

function groupRow(name: string): Row {
  return { name };
}

function names(rows: Array<Row>): Array<string> {
  return rows.map((row: Row): string => {
    return row.name;
  });
}

const CHECKED: MonitorFlags = {
  isArchived: false,
  disableActiveMonitoring: false,
};
const OFF: MonitorFlags = { isArchived: false, disableActiveMonitoring: true };
const ARCHIVED: MonitorFlags = {
  isArchived: true,
  disableActiveMonitoring: false,
};
const ARCHIVED_AND_OFF: MonitorFlags = {
  isArchived: true,
  disableActiveMonitoring: true,
};

describe("FrozenMonitorResources.isMonitorArchived", () => {
  test("a resource whose monitor is archived", () => {
    expect(
      FrozenMonitorResources.isMonitorArchived(
        monitorRow("api", { isArchived: true }),
      ),
    ).toBe(true);
  });

  test("a resource whose monitor is live", () => {
    expect(
      FrozenMonitorResources.isMonitorArchived(
        monitorRow("api", { isArchived: false }),
      ),
    ).toBe(false);
  });

  test("a monitor read without the flag counts as live, never as archived", () => {
    expect(FrozenMonitorResources.isMonitorArchived(monitorRow("api"))).toBe(
      false,
    );
  });

  test("a resource with no monitor (a monitor group row) is never archived", () => {
    expect(FrozenMonitorResources.isMonitorArchived(groupRow("group"))).toBe(
      false,
    );
  });

  test("monitoring turned off is not archived", () => {
    expect(
      FrozenMonitorResources.isMonitorArchived(monitorRow("api", OFF)),
    ).toBe(false);
  });
});

describe("FrozenMonitorResources.isMonitoringOff", () => {
  test("a resource whose monitor has its monitoring turned off", () => {
    expect(FrozenMonitorResources.isMonitoringOff(monitorRow("api", OFF))).toBe(
      true,
    );
  });

  test("a resource whose monitor is checked", () => {
    expect(
      FrozenMonitorResources.isMonitoringOff(monitorRow("api", CHECKED)),
    ).toBe(false);
  });

  test("only an explicit true is off: null, undefined and a missing flag are on", () => {
    expect(
      FrozenMonitorResources.isMonitoringOff(
        monitorRow("api", { disableActiveMonitoring: null }),
      ),
    ).toBe(false);
    expect(
      FrozenMonitorResources.isMonitoringOff(
        monitorRow("api", { disableActiveMonitoring: undefined }),
      ),
    ).toBe(false);
    expect(FrozenMonitorResources.isMonitoringOff(monitorRow("api"))).toBe(
      false,
    );
  });

  test("a truthy value that is not true is not off (the column is a boolean)", () => {
    expect(
      FrozenMonitorResources.isMonitoringOff({
        monitor: { disableActiveMonitoring: "true" as unknown as boolean },
      }),
    ).toBe(false);
  });

  test("a resource with no monitor (a monitor group row) is never off itself", () => {
    expect(FrozenMonitorResources.isMonitoringOff(groupRow("group"))).toBe(
      false,
    );
  });

  test("an archived monitor is not off unless its switch says so", () => {
    expect(
      FrozenMonitorResources.isMonitoringOff(monitorRow("api", ARCHIVED)),
    ).toBe(false);
    expect(
      FrozenMonitorResources.isMonitoringOff(
        monitorRow("api", ARCHIVED_AND_OFF),
      ),
    ).toBe(true);
  });
});

describe("FrozenMonitorResources.isStatusFrozen", () => {
  test.each([
    ["checked", CHECKED, false],
    ["monitoring off", OFF, true],
    ["archived", ARCHIVED, true],
    ["archived and monitoring off", ARCHIVED_AND_OFF, true],
  ])(
    "a monitor that is %s",
    (_label: string, flags: MonitorFlags, frozen: boolean) => {
      expect(
        FrozenMonitorResources.isStatusFrozen(monitorRow("api", flags)),
      ).toBe(frozen);
    },
  );

  test("a monitor read without either flag counts as checked", () => {
    expect(FrozenMonitorResources.isStatusFrozen(monitorRow("api"))).toBe(
      false,
    );
  });

  test("a monitor group row is never frozen itself", () => {
    expect(FrozenMonitorResources.isStatusFrozen(groupRow("group"))).toBe(
      false,
    );
  });
});

describe("FrozenMonitorResources.withoutArchivedMonitors", () => {
  test("drops only the rows whose monitor is archived, keeping the order", () => {
    const rows: Array<Row> = [
      monitorRow("checkout", { isArchived: false }),
      monitorRow("legacy", { isArchived: true }),
      groupRow("payments group"),
      monitorRow("search"),
      monitorRow("old-cron", { isArchived: true }),
    ];

    expect(names(FrozenMonitorResources.withoutArchivedMonitors(rows))).toEqual(
      ["checkout", "payments group", "search"],
    );
  });

  test("keeps a monitor whose monitoring is off: a page lists it, as Not monitored", () => {
    const rows: Array<Row> = [
      monitorRow("checkout", CHECKED),
      monitorRow("paused", OFF),
      monitorRow("retired", ARCHIVED_AND_OFF),
    ];

    expect(names(FrozenMonitorResources.withoutArchivedMonitors(rows))).toEqual(
      ["checkout", "paused"],
    );
  });

  test("returns the same row objects, so callers keep every field they read", () => {
    const live: Row = monitorRow("checkout", { isArchived: false });

    expect(FrozenMonitorResources.withoutArchivedMonitors([live])[0]).toBe(
      live,
    );
  });

  test("leaves the input untouched", () => {
    const rows: Array<Row> = [monitorRow("legacy", { isArchived: true })];

    FrozenMonitorResources.withoutArchivedMonitors(rows);

    expect(rows).toHaveLength(1);
  });

  test("an empty list stays empty, and a list of only archived monitors empties", () => {
    expect(FrozenMonitorResources.withoutArchivedMonitors([])).toEqual([]);
    expect(
      FrozenMonitorResources.withoutArchivedMonitors([
        monitorRow("a", { isArchived: true }),
        monitorRow("b", { isArchived: true }),
      ]),
    ).toEqual([]);
  });
});

describe("FrozenMonitorResources.withoutFrozenMonitors", () => {
  test("drops the archived rows and the rows whose monitoring is off, keeping the order", () => {
    const rows: Array<Row> = [
      monitorRow("checkout", CHECKED),
      monitorRow("paused", OFF),
      groupRow("payments group"),
      monitorRow("retired", ARCHIVED),
      monitorRow("search"),
      monitorRow("retired-and-paused", ARCHIVED_AND_OFF),
      monitorRow("billing", { disableActiveMonitoring: null }),
    ];

    expect(names(FrozenMonitorResources.withoutFrozenMonitors(rows))).toEqual([
      "checkout",
      "payments group",
      "search",
      "billing",
    ]);
  });

  test("returns the same row objects and leaves the input untouched", () => {
    const checked: Row = monitorRow("checkout", CHECKED);
    const rows: Array<Row> = [monitorRow("paused", OFF), checked];

    const kept: Array<Row> = FrozenMonitorResources.withoutFrozenMonitors(rows);

    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(checked);
    expect(rows).toHaveLength(2);
  });

  test("a group whose monitors are all off or archived has nothing left to decide its status", () => {
    expect(
      FrozenMonitorResources.withoutFrozenMonitors([
        monitorRow("paused", OFF),
        monitorRow("retired", ARCHIVED),
      ]),
    ).toEqual([]);
  });

  test("is what withoutArchivedMonitors keeps, less the monitors whose monitoring is off", () => {
    const rows: Array<Row> = [
      monitorRow("a", CHECKED),
      monitorRow("b", OFF),
      monitorRow("c", ARCHIVED),
      monitorRow("d", ARCHIVED_AND_OFF),
      monitorRow("e"),
    ];

    expect(names(FrozenMonitorResources.withoutFrozenMonitors(rows))).toEqual(
      names(
        FrozenMonitorResources.withoutArchivedMonitors(rows).filter(
          (row: Row): boolean => {
            return !FrozenMonitorResources.isMonitoringOff(row);
          },
        ),
      ),
    );
  });
});

describe("FrozenMonitorResources.isMonitoringOffForEveryMonitor", () => {
  test("every member has its monitoring off", () => {
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("a", OFF),
        monitorRow("b", OFF),
      ]),
    ).toBe(true);
  });

  test("one member still checked keeps the group monitored", () => {
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("a", OFF),
        monitorRow("b", CHECKED),
      ]),
    ).toBe(false);
  });

  test("an archived member is left out of the count, whatever its switch says", () => {
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("a", OFF),
        monitorRow("retired", ARCHIVED),
      ]),
    ).toBe(true);
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("a", CHECKED),
        monitorRow("retired", ARCHIVED_AND_OFF),
      ]),
    ).toBe(false);
  });

  test("an empty group, or one of archived monitors only, is empty, not off", () => {
    expect(FrozenMonitorResources.isMonitoringOffForEveryMonitor([])).toBe(
      false,
    );
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("retired", ARCHIVED_AND_OFF),
      ]),
    ).toBe(false);
  });

  test("a member read without the flag counts as checked", () => {
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        monitorRow("a", OFF),
        monitorRow("b"),
      ]),
    ).toBe(false);
    expect(
      FrozenMonitorResources.isMonitoringOffForEveryMonitor([
        { monitorId: "c-id" },
      ]),
    ).toBe(false);
  });
});

describe("FrozenMonitorResources.withoutNotMonitoredMonitorGroups", () => {
  /*
   * The statuses a page shows for its monitor groups, less each group whose
   * monitors all have monitoring off: such a group's status is frozen, so
   * the page draws it as Not monitored and it decides no other status.
   */
  test("leaves out a group whose monitors all have monitoring off, and keeps the rest", () => {
    expect(
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<string>({
        monitorGroupStatuses: {
          "g-off": "Offline",
          "g-mixed": "Degraded",
          "g-on": "Operational",
        },
        monitorGroupResources: {
          "g-off": [monitorRow("a", OFF), monitorRow("b", OFF)],
          "g-mixed": [monitorRow("c", OFF), monitorRow("d", CHECKED)],
          "g-on": [monitorRow("e", CHECKED)],
        },
      }),
    ).toEqual({
      "g-mixed": "Degraded",
      "g-on": "Operational",
    });
  });

  test("keeps a group whose members were not read, and an empty one", () => {
    expect(
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<string>({
        monitorGroupStatuses: {
          "g-unread": "Offline",
          "g-empty": "Operational",
        },
        monitorGroupResources: {
          "g-empty": [],
        },
      }),
    ).toEqual({
      "g-unread": "Offline",
      "g-empty": "Operational",
    });
  });

  test("a group whose only other members are archived is off when the rest are off", () => {
    expect(
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<string>({
        monitorGroupStatuses: { "g-1": "Offline", "g-2": "Offline" },
        monitorGroupResources: {
          "g-1": [monitorRow("a", OFF), monitorRow("old", ARCHIVED)],
          // Only archived members: empty, not off.
          "g-2": [monitorRow("older", ARCHIVED_AND_OFF)],
        },
      }),
    ).toEqual({ "g-2": "Offline" });
  });

  test("keeps the statuses as they are: the same values, never copies", () => {
    const status: { name: string } = { name: "Degraded" };

    const kept: Record<string, { name: string }> =
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<{
        name: string;
      }>({
        monitorGroupStatuses: { "g-1": status },
        monitorGroupResources: { "g-1": [monitorRow("a", CHECKED)] },
      });

    expect(kept["g-1"]).toBe(status);
  });

  test("returns a new dictionary and leaves the one given alone", () => {
    const given: Record<string, string> = { "g-off": "Offline" };

    const kept: Record<string, string> =
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<string>({
        monitorGroupStatuses: given,
        monitorGroupResources: { "g-off": [monitorRow("a", OFF)] },
      });

    expect(kept).toEqual({});
    expect(given).toEqual({ "g-off": "Offline" });
  });

  test("nothing in, nothing out", () => {
    expect(
      FrozenMonitorResources.withoutNotMonitoredMonitorGroups<string>({
        monitorGroupStatuses: {},
        monitorGroupResources: { "g-off": [monitorRow("a", OFF)] },
      }),
    ).toEqual({});
  });
});

describe("FrozenMonitorResources.getNotMonitoredResourceIds", () => {
  const checkedGroupId: string = ObjectID.generate().toString();
  const offGroupId: string = ObjectID.generate().toString();
  const mixedGroupId: string = ObjectID.generate().toString();
  const unreadGroupId: string = ObjectID.generate().toString();

  const monitorGroupResources: Record<string, Array<ResourceWithMonitor>> = {
    [checkedGroupId]: [monitorRow("g1", CHECKED), monitorRow("g2", CHECKED)],
    [offGroupId]: [
      monitorRow("g3", OFF),
      monitorRow("g4", OFF),
      monitorRow("g5", ARCHIVED),
    ],
    [mixedGroupId]: [monitorRow("g6", OFF), monitorRow("g7", CHECKED)],
  };

  function monitorResource(
    id: string,
    flags?: MonitorFlags,
  ): StatusPageResourceWithMonitor {
    return {
      _id: id,
      monitorId: `${id}-monitor`,
      monitor: flags === undefined ? {} : { ...flags },
    };
  }

  function groupResource(
    id: string,
    monitorGroupId: string,
  ): StatusPageResourceWithMonitor {
    return { _id: id, monitorGroupId: new ObjectID(monitorGroupId) };
  }

  test("a monitor whose monitoring is off, and a group whose monitors all have it off", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [
          monitorResource("r-checked", CHECKED),
          monitorResource("r-off", OFF),
          groupResource("r-group-checked", checkedGroupId),
          groupResource("r-group-off", offGroupId),
          groupResource("r-group-mixed", mixedGroupId),
        ],
        monitorGroupResources,
      }),
    ).toEqual(["r-off", "r-group-off"]);
  });

  test("a group whose members were not read counts as monitored", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [groupResource("r-group", unreadGroupId)],
        monitorGroupResources,
      }),
    ).toEqual([]);
  });

  test("a monitor read without the flag counts as monitored", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [
          monitorResource("r-1"),
          monitorResource("r-2", { disableActiveMonitoring: null }),
        ],
        monitorGroupResources: {},
      }),
    ).toEqual([]);
  });

  test("a resource that points at a monitor by id only (no monitor read) is monitored", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [{ _id: "r-1", monitorId: "m-1" }],
        monitorGroupResources: {},
      }),
    ).toEqual([]);
  });

  test("a resource that is neither a monitor nor a group is monitored", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [{ _id: "r-1" }],
        monitorGroupResources: {},
      }),
    ).toEqual([]);
  });

  test("ids come as text, once each, and rows without an id are skipped", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [
          {
            _id: new ObjectID("6b1f0c9e-2d4a-4c1b-9f3e-7a5d8c2b1e40"),
            monitorId: "m-1",
            monitor: { ...OFF },
          },
          {
            _id: "6b1f0c9e-2d4a-4c1b-9f3e-7a5d8c2b1e40",
            monitorId: "m-1",
            monitor: { ...OFF },
          },
          { monitorId: "m-2", monitor: { ...OFF } },
          { _id: "", monitorId: "m-3", monitor: { ...OFF } },
        ],
        monitorGroupResources: {},
      }),
    ).toEqual(["6b1f0c9e-2d4a-4c1b-9f3e-7a5d8c2b1e40"]);
  });

  test("keeps the order of the page's resources", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [
          groupResource("r-3", offGroupId),
          monitorResource("r-1", OFF),
          monitorResource("r-2", OFF),
        ],
        monitorGroupResources,
      }),
    ).toEqual(["r-3", "r-1", "r-2"]);
  });

  test("an empty page has nothing to draw as Not monitored", () => {
    expect(
      FrozenMonitorResources.getNotMonitoredResourceIds({
        statusPageResources: [],
        monitorGroupResources,
      }),
    ).toEqual([]);
  });
});

describe("FrozenMonitorResources.isNotMonitored", () => {
  test("answers from a list of ids", () => {
    expect(
      FrozenMonitorResources.isNotMonitored({ _id: "r-1" }, ["r-1", "r-2"]),
    ).toBe(true);
    expect(FrozenMonitorResources.isNotMonitored({ _id: "r-3" }, ["r-1"])).toBe(
      false,
    );
  });

  test("answers from a set of ids", () => {
    const ids: Set<string> = new Set<string>(["r-1"]);

    expect(FrozenMonitorResources.isNotMonitored({ _id: "r-1" }, ids)).toBe(
      true,
    );
    expect(FrozenMonitorResources.isNotMonitored({ _id: "r-2" }, ids)).toBe(
      false,
    );
  });

  test("reads an ObjectID id as its text", () => {
    expect(
      FrozenMonitorResources.isNotMonitored(
        { _id: new ObjectID("0d3c5b7a-9e1f-4a2b-8c6d-4e5f6a7b8c9d") },
        ["0d3c5b7a-9e1f-4a2b-8c6d-4e5f6a7b8c9d"],
      ),
    ).toBe(true);
  });

  test("a resource without an id is never Not monitored", () => {
    expect(FrozenMonitorResources.isNotMonitored({}, [""])).toBe(false);
    expect(FrozenMonitorResources.isNotMonitored({ _id: "" }, [""])).toBe(
      false,
    );
  });

  test("no ids, nothing Not monitored", () => {
    expect(FrozenMonitorResources.isNotMonitored({ _id: "r-1" }, [])).toBe(
      false,
    );
  });
});

describe("FrozenMonitorResources.isEveryResourceNotMonitored", () => {
  test("true when every resource is Not monitored", () => {
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(
        [{ _id: "r-1" }, { _id: "r-2" }],
        ["r-1", "r-2", "r-3"],
      ),
    ).toBe(true);
  });

  test("false when one resource is monitored", () => {
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(
        [{ _id: "r-1" }, { _id: "r-4" }],
        new Set<string>(["r-1", "r-2"]),
      ),
    ).toBe(false);
  });

  test("false for no resources at all: an empty page is not a page of unmonitored ones", () => {
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored([], ["r-1"]),
    ).toBe(false);
  });

  test("a resource without an id keeps the answer false", () => {
    expect(
      FrozenMonitorResources.isEveryResourceNotMonitored(
        [{ _id: "r-1" }, {}],
        ["r-1"],
      ),
    ).toBe(false);
  });
});
