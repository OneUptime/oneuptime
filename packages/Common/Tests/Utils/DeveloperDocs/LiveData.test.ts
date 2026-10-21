import { describe, expect, test } from "@jest/globals";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import {
  addDeveloperDocsLookupResult,
  dedupeDeveloperDocsLookups,
  DEVELOPER_DOCS_SAMPLE_SIZE,
  DeveloperDocsLiveData,
  DeveloperDocsLiveRecord,
  DeveloperDocsLookup,
  getDeveloperDocsLookup,
  getDeveloperDocsLookupSpec,
  getEmptyDeveloperDocsLiveData,
  hasDeveloperDocsLiveTable,
  pickDeveloperDocsLiveRecord,
  toDeveloperDocsLiveRecord,
} from "../../../Utils/DeveloperDocs/LiveData";

/*
 * What a Developer page looks up about its project so its examples are the
 * project's own: a few records of each kind its examples point at, read in
 * their natural order, never anything but ids, names and a few flags.
 */

const NOW: Date = new Date("2026-10-02T15:30:00.000Z");

const STATUSES: Array<DeveloperDocsLiveRecord> = [
  {
    id: "d1",
    name: "Operational",
    flags: { isOperationalState: true, isOfflineState: false },
  },
  {
    id: "d2",
    name: "Degraded",
    flags: { isOperationalState: false, isOfflineState: false },
  },
  {
    id: "d3",
    name: "Offline",
    flags: { isOperationalState: false, isOfflineState: true },
  },
];

function liveWith(
  records: Record<string, Array<DeveloperDocsLiveRecord>>,
): DeveloperDocsLiveData {
  return { ...getEmptyDeveloperDocsLiveData(NOW), records };
}

describe("how a table is read", () => {
  test("severities and states in their order, with the flags that say which is which", () => {
    expect(getDeveloperDocsLookupSpec(IncidentSeverity)).toEqual({
      sortColumn: "order",
      sortOrder: "ASC",
      flagColumns: [],
    });
    expect(getDeveloperDocsLookupSpec(IncidentState)).toEqual({
      sortColumn: "order",
      sortOrder: "ASC",
      flagColumns: ["isCreatedState", "isAcknowledgedState", "isResolvedState"],
    });
    expect(
      getDeveloperDocsLookupSpec(ScheduledMaintenanceState).flagColumns,
    ).toEqual([
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]);
  });

  test("monitor statuses by priority", () => {
    expect(getDeveloperDocsLookupSpec(MonitorStatus)).toEqual({
      sortColumn: "priority",
      sortOrder: "ASC",
      flagColumns: ["isOperationalState", "isOfflineState"],
    });
  });

  test("anything else by its name", () => {
    expect(getDeveloperDocsLookupSpec(Monitor)).toEqual({
      sortColumn: "name",
      sortOrder: "ASC",
      flagColumns: [],
    });
  });

  test("every declared flag is a real column", () => {
    for (const modelType of [
      IncidentState,
      MonitorStatus,
      ScheduledMaintenanceState,
    ]) {
      const columns: Array<string> = new modelType().getTableColumns().columns;

      for (const flag of getDeveloperDocsLookupSpec(modelType).flagColumns) {
        expect({ flag, exists: columns.includes(flag) }).toEqual({
          flag,
          exists: true,
        });
      }
    }
  });
});

describe("a lookup", () => {
  test("asks for the id, the name and the flags, and nothing else", () => {
    const lookup: DeveloperDocsLookup = getDeveloperDocsLookup(MonitorStatus);

    expect(lookup).toEqual({
      modelType: MonitorStatus,
      tableName: "MonitorStatus",
      ids: undefined,
      limit: DEVELOPER_DOCS_SAMPLE_SIZE,
      select: {
        _id: true,
        name: true,
        isOperationalState: true,
        isOfflineState: true,
      },
      sort: { priority: "ASC" },
    });
  });

  test("never asks for a status page's secrets", () => {
    const select: Record<string, boolean> =
      getDeveloperDocsLookup(StatusPage).select;

    expect(Object.keys(select).sort()).toEqual(["_id", "name"]);
  });

  test("by ids asks for exactly those records, once each", () => {
    const lookup: DeveloperDocsLookup = getDeveloperDocsLookup(Label, [
      "l2",
      "l1",
      "l2",
    ]);

    expect(lookup.ids).toEqual(["l1", "l2"]);
    expect(lookup.limit).toBe(2);
  });

  test("the same lookup twice is made once; a lookup by no ids not at all", () => {
    const lookups: Array<DeveloperDocsLookup> = dedupeDeveloperDocsLookups([
      getDeveloperDocsLookup(Label),
      getDeveloperDocsLookup(Label),
      getDeveloperDocsLookup(Label, ["l1"]),
      getDeveloperDocsLookup(Label, []),
      getDeveloperDocsLookup(Monitor),
    ]);

    expect(
      lookups.map((lookup: DeveloperDocsLookup): string => {
        return `${lookup.tableName}:${(lookup.ids || []).join(",")}`;
      }),
    ).toEqual(["Label:", "Label:l1", "Monitor:"]);
  });
});

describe("what a lookup found", () => {
  test("a record from its API JSON: id, trimmed name, flags as booleans", () => {
    expect(
      toDeveloperDocsLiveRecord({
        modelType: MonitorStatus,
        json: {
          _id: "d1",
          name: "  Operational ",
          isOperationalState: true,
        },
      }),
    ).toEqual({
      id: "d1",
      name: "Operational",
      flags: { isOperationalState: true, isOfflineState: false },
    });
  });

  test("a record without an id is no record; one without a name has none", () => {
    expect(
      toDeveloperDocsLiveRecord({ modelType: Label, json: { name: "x" } }),
    ).toBeNull();
    expect(
      toDeveloperDocsLiveRecord({ modelType: Label, json: { _id: "l1" } }),
    ).toEqual({ id: "l1", name: null, flags: {} });
  });

  test("a sample fills the table and names its records", () => {
    const live: DeveloperDocsLiveData = addDeveloperDocsLookupResult(
      getEmptyDeveloperDocsLiveData(NOW),
      getDeveloperDocsLookup(MonitorStatus),
      STATUSES,
    );

    expect(live.records["MonitorStatus"]).toEqual(STATUSES);
    expect(live.namesById).toEqual({
      d1: "Operational",
      d2: "Degraded",
      d3: "Offline",
    });
    expect(hasDeveloperDocsLiveTable(live, "MonitorStatus")).toBe(true);
    expect(hasDeveloperDocsLiveTable(live, "Label")).toBe(false);
  });

  test("a lookup by ids only names its records: the examples' sample stays as it was", () => {
    const live: DeveloperDocsLiveData = addDeveloperDocsLookupResult(
      liveWith({ Label: [{ id: "l9", name: "eu", flags: {} }] }),
      getDeveloperDocsLookup(Label, ["l1"]),
      [{ id: "l1", name: "production", flags: {} }],
    );

    expect(live.records["Label"]).toEqual([
      { id: "l9", name: "eu", flags: {} },
    ]);
    expect(live.namesById["l1"]).toBe("production");
  });
});

describe("which record an example uses", () => {
  const live: DeveloperDocsLiveData = liveWith({ MonitorStatus: STATUSES });

  test("the first, by default", () => {
    expect(pickDeveloperDocsLiveRecord(live, "MonitorStatus")?.name).toBe(
      "Operational",
    );
  });

  test("the one with a flag set", () => {
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", {
        flag: "isOfflineState",
      })?.name,
    ).toBe("Offline");
  });

  test("one with none of some flags: Degraded is neither operational nor offline", () => {
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", {
        withoutFlags: ["isOperationalState", "isOfflineState"],
      })?.name,
    ).toBe("Degraded");
  });

  test("another than the one a record has now", () => {
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", { notId: "d1" })?.name,
    ).toBe("Degraded");
  });

  test("the n-th of those left, or the last when there are fewer", () => {
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", { index: 1 })?.name,
    ).toBe("Degraded");
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", { index: 9 })?.name,
    ).toBe("Offline");
  });

  test("none when nothing fits, or the table was never looked up", () => {
    expect(
      pickDeveloperDocsLiveRecord(live, "MonitorStatus", {
        flag: "isOperationalState",
        notId: "d1",
      }),
    ).toBeNull();
    expect(pickDeveloperDocsLiveRecord(live, "Label")).toBeNull();
  });
});
