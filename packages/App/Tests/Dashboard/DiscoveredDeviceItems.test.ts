import { describe, expect, test } from "@jest/globals";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DiscoveredDeviceCounts,
  DiscoveredDeviceMatch,
  DiscoveredDeviceRow,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import {
  canAddToMonitoring,
  countForShow,
  DISCOVERED_DEVICE_SHOW_LABELS,
  DISCOVERED_DEVICE_STATE_LABELS,
  DiscoveredDeviceEmptyKind,
  DiscoveredDeviceItem,
  DiscoveredDeviceState,
  getAddToMonitoringPlan,
  getDiscoveredDeviceEmptyKind,
  getDiscoveredDeviceItemForNode,
  getDiscoveredDeviceLabel,
  getDiscoveredDeviceShowOptions,
  getDiscoveredDeviceSort,
  getDiscoveredDeviceState,
  getHostnameUnderName,
  getMapChangeItemOutcome,
  getMapChangeOutcome,
  getSeenOnParts,
  indexMapChange,
  isDiscoveredDeviceShow,
  isSortableDiscoveredDeviceField,
  MAP_CHANGE_REASONS,
  MapChangeIndex,
  toDiscoveredDeviceItem,
  toSelectedDiscoveredDeviceItem,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems";

/*
 * The Discovered Devices list's model (issue #5775): what a row is to the
 * table, what state its badge says, which of a selection Add to monitoring
 * adds, and what a Hide from map or Show on map answer means for each row
 * the reader selected. Every rule is pure, so it is held here on its own;
 * the page that draws it is held in Common's DiscoveredDevicesTable suite.
 */

const ID_A: string = "6d0f2b52-3c1e-4b8a-9f4e-1a2b3c4d5e6f";
const ID_B: string = "7e1a3c63-4d2f-4c9b-8a5f-2b3c4d5e6f70";
const ID_C: string = "8f2b4d74-5e3a-4dac-9b60-3c4d5e6f7081";

function row(
  overrides: Partial<DiscoveredDeviceRow> = {},
): DiscoveredDeviceRow {
  return {
    id: ID_A,
    name: "printer-2f",
    macAddress: "aa:bb:cc:00:11:22",
    ipAddress: "10.20.0.15",
    isSeenRecently: true,
    isFromController: false,
    isHidden: false,
    ...overrides,
  };
}

function item(
  overrides: Partial<DiscoveredDeviceItem> = {},
): DiscoveredDeviceItem {
  return {
    ...toDiscoveredDeviceItem(row()),
    ...overrides,
  };
}

const COUNTS: DiscoveredDeviceCounts = {
  all: 12,
  notMonitored: 9,
  monitored: 3,
  hidden: 4,
};

describe("a row as the table holds it", () => {
  test("a row read on a page keeps everything, matched by its id", () => {
    const read: DiscoveredDeviceRow = row({
      hostname: "printer-2f.example.internal",
      vendor: "Example Printers",
      seenOn: { id: ID_B, name: "access-sw-1" },
      portName: "Gi1/0/7",
      vlanId: 20,
    });

    expect(toDiscoveredDeviceItem(read)).toEqual({
      ...read,
      _id: ID_A,
      isMonitored: false,
      isOnPage: true,
    });
  });

  test("it is monitored when discovery matched a device to it", () => {
    expect(
      toDiscoveredDeviceItem(
        row({
          monitoredDevice: { id: ID_C, name: "printer-2f" },
          monitoredBy: DiscoveredDeviceMatch.MacAddress,
        }),
      ).isMonitored,
    ).toBe(true);
  });

  test("a row selected on another page carries what names it, and says so", () => {
    expect(
      toSelectedDiscoveredDeviceItem({
        id: ID_B,
        name: "camera-lobby",
        ipAddress: "10.20.0.31",
        isMonitored: true,
      }),
    ).toEqual({
      _id: ID_B,
      id: ID_B,
      name: "camera-lobby",
      macAddress: "",
      ipAddress: "10.20.0.31",
      isSeenRecently: false,
      isFromController: false,
      isHidden: false,
      isMonitored: true,
      isOnPage: false,
    });
  });

  test("a selected row with no address and no monitored flag is neither", () => {
    const selected: DiscoveredDeviceItem = toSelectedDiscoveredDeviceItem({
      id: ID_B,
      name: "aa:bb:cc:00:11:99",
    });

    expect("ipAddress" in selected).toBe(false);
    expect(selected.isMonitored).toBe(false);
  });
});

describe("an endpoint node of the map as a row of the list", () => {
  test("is the endpoint the node key names, with what the map knows", () => {
    expect(
      getDiscoveredDeviceItemForNode({
        id: `endpoint:${ID_A}`,
        kind: "endpoint",
        name: "printer-2f",
        ipAddress: "10.20.0.15",
        macAddress: "aa:bb:cc:00:11:22",
        hostname: "printer-2f.example.internal",
        vendor: "Example Printers",
        classification: "Printer",
      }),
    ).toEqual({
      _id: ID_A,
      id: ID_A,
      name: "printer-2f",
      macAddress: "aa:bb:cc:00:11:22",
      ipAddress: "10.20.0.15",
      hostname: "printer-2f.example.internal",
      vendor: "Example Printers",
      classification: "Printer",
      isSeenRecently: true,
      isFromController: false,
      isHidden: false,
      isMonitored: false,
      isOnPage: false,
    });
  });

  test("an upper-case id in the node key is read in lower case, as the server writes ids", () => {
    expect(
      getDiscoveredDeviceItemForNode({
        id: `endpoint:${ID_A.toUpperCase()}`,
        kind: "endpoint",
        name: "printer-2f",
        ipAddress: "10.20.0.15",
      })?.id,
    ).toBe(ID_A);
  });

  test("a node with no name is called by its address, and leaves out what the map does not know", () => {
    const endpoint: DiscoveredDeviceItem | null =
      getDiscoveredDeviceItemForNode({
        id: `endpoint:${ID_A}`,
        kind: "endpoint",
        name: "",
        ipAddress: "10.20.0.15",
      });

    expect(endpoint?.name).toBe("10.20.0.15");
    expect(endpoint?.macAddress).toBe("");
    expect(endpoint && "hostname" in endpoint).toBe(false);
    expect(endpoint && "vendor" in endpoint).toBe(false);
    expect(endpoint && "classification" in endpoint).toBe(false);
  });

  test("is nothing for a device, a neighbour, an endpoint with no address or a key that names no endpoint", () => {
    expect(
      getDiscoveredDeviceItemForNode({
        id: ID_A,
        kind: "device",
        name: "core-sw",
        ipAddress: "10.20.0.1",
      }),
    ).toBeNull();
    expect(
      getDiscoveredDeviceItemForNode({
        id: "unmanaged:aa:bb:cc:00:11:22",
        kind: "unmanaged",
        name: "ap-3",
        ipAddress: "10.20.0.40",
      }),
    ).toBeNull();
    expect(
      getDiscoveredDeviceItemForNode({
        id: `endpoint:${ID_A}`,
        kind: "endpoint",
        name: "aa:bb:cc:00:11:22",
      }),
    ).toBeNull();
    expect(
      getDiscoveredDeviceItemForNode({
        id: "endpoint:not-an-id",
        kind: "endpoint",
        name: "printer-2f",
        ipAddress: "10.20.0.15",
      }),
    ).toBeNull();
    expect(
      getDiscoveredDeviceItemForNode({
        id: `device:${ID_A}`,
        kind: "endpoint",
        name: "printer-2f",
        ipAddress: "10.20.0.15",
      }),
    ).toBeNull();
  });
});

describe("a row's state, in the one badge its State column draws", () => {
  test("monitored first, whatever else is true of it", () => {
    expect(
      getDiscoveredDeviceState({
        isMonitored: true,
        isHidden: true,
        isSeenRecently: false,
      }),
    ).toBe(DiscoveredDeviceState.Monitored);
  });

  test("then hidden from the map, seen recently or not", () => {
    expect(
      getDiscoveredDeviceState({
        isMonitored: false,
        isHidden: true,
        isSeenRecently: false,
      }),
    ).toBe(DiscoveredDeviceState.Hidden);
    expect(
      getDiscoveredDeviceState({
        isMonitored: false,
        isHidden: true,
        isSeenRecently: true,
      }),
    ).toBe(DiscoveredDeviceState.Hidden);
  });

  test("then whether it is still there", () => {
    expect(
      getDiscoveredDeviceState({
        isMonitored: false,
        isHidden: false,
        isSeenRecently: true,
      }),
    ).toBe(DiscoveredDeviceState.DiscoveredOnly);
    expect(
      getDiscoveredDeviceState({
        isMonitored: false,
        isHidden: false,
        isSeenRecently: false,
      }),
    ).toBe(DiscoveredDeviceState.NotSeenRecently);
  });

  test("every state has its words", () => {
    expect(DISCOVERED_DEVICE_STATE_LABELS).toEqual({
      [DiscoveredDeviceState.Monitored]: "Monitored",
      [DiscoveredDeviceState.Hidden]: "Hidden from map",
      [DiscoveredDeviceState.NotSeenRecently]: "Not seen recently",
      [DiscoveredDeviceState.DiscoveredOnly]: "Discovered only",
    });
  });
});

describe("the table's sort, as the server sorts", () => {
  test.each([
    ["name", DiscoveredDeviceSort.Name],
    ["ipAddress", DiscoveredDeviceSort.IpAddress],
    ["vendor", DiscoveredDeviceSort.Vendor],
    ["lastSeenAt", DiscoveredDeviceSort.LastSeen],
    ["firstSeenAt", DiscoveredDeviceSort.FirstSeen],
  ] as Array<[keyof DiscoveredDeviceItem, DiscoveredDeviceSort]>)(
    "the %s column sorts by %s, either way",
    (field: keyof DiscoveredDeviceItem, sort: DiscoveredDeviceSort) => {
      expect(isSortableDiscoveredDeviceField(field)).toBe(true);
      expect(getDiscoveredDeviceSort(field, SortOrder.Ascending)).toEqual({
        sort: sort,
        sortOrder: "asc",
      });
      expect(getDiscoveredDeviceSort(field, SortOrder.Descending)).toEqual({
        sort: sort,
        sortOrder: "desc",
      });
    },
  );

  test("a column the server cannot sort, or none, is the list's own order: most recently seen first", () => {
    for (const field of ["macAddress", "seenOn", "isHidden"] as Array<
      keyof DiscoveredDeviceItem
    >) {
      expect(isSortableDiscoveredDeviceField(field)).toBe(false);
      expect(getDiscoveredDeviceSort(field, SortOrder.Ascending)).toEqual({
        sort: DiscoveredDeviceSort.LastSeen,
        sortOrder: "desc",
      });
    }

    expect(getDiscoveredDeviceSort(null, SortOrder.Ascending)).toEqual({
      sort: DiscoveredDeviceSort.LastSeen,
      sortOrder: "desc",
    });
  });
});

describe("which of a selection Add to monitoring adds", () => {
  test("the ones with an address and not monitored, in the order picked; the rest named with why", () => {
    const first: DiscoveredDeviceItem = item({ id: ID_A, _id: ID_A });
    const monitored: DiscoveredDeviceItem = item({
      id: ID_B,
      _id: ID_B,
      isMonitored: true,
    });
    const noAddress: DiscoveredDeviceItem = item({
      id: ID_C,
      _id: ID_C,
      ipAddress: undefined,
    });
    const last: DiscoveredDeviceItem = item({
      id: "9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192",
      _id: "9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192",
      ipAddress: "10.20.0.99",
    });

    expect(getAddToMonitoringPlan([first, monitored, noAddress, last])).toEqual(
      {
        toAdd: [first, last],
        monitored: [monitored],
        withoutAddress: [noAddress],
      },
    );
  });

  test("a monitored row with no address is left out as monitored, the reason that matters", () => {
    const monitored: DiscoveredDeviceItem = item({
      isMonitored: true,
      ipAddress: undefined,
    });

    expect(getAddToMonitoringPlan([monitored])).toEqual({
      toAdd: [],
      monitored: [monitored],
      withoutAddress: [],
    });
  });

  test("a row's own Add to monitoring adds it only when the plan would", () => {
    expect(
      canAddToMonitoring({ isMonitored: false, ipAddress: "10.0.0.5" }),
    ).toBe(true);
    expect(
      canAddToMonitoring({ isMonitored: true, ipAddress: "10.0.0.5" }),
    ).toBe(false);
    expect(canAddToMonitoring({ isMonitored: false, ipAddress: "" })).toBe(
      false,
    );
    expect(canAddToMonitoring({ isMonitored: false })).toBe(false);
  });
});

describe("what a Hide from map or Show on map answer means for each selected row", () => {
  const index: MapChangeIndex = indexMapChange({
    changedIds: [ID_A.toUpperCase()],
    unchangedIds: [ID_B],
    monitoredIds: [ID_C],
    notFoundIds: [],
  });

  test("the answer is indexed by id in lower case", () => {
    expect(index.changed.has(ID_A)).toBe(true);
    expect(index.unchanged.has(ID_B)).toBe(true);
    expect(index.monitored.has(ID_C)).toBe(true);
  });

  test("a changed row is changed, however its id is written", () => {
    expect(
      getMapChangeItemOutcome({
        id: ID_A.toUpperCase(),
        index: index,
        isHiding: true,
      }),
    ).toEqual({ kind: "changed" });
  });

  test("a row left as it was says why: already hidden, or already on the map", () => {
    expect(
      getMapChangeItemOutcome({ id: ID_B, index: index, isHiding: true }),
    ).toEqual({ kind: "unchanged", reason: MAP_CHANGE_REASONS.alreadyHidden });
    expect(
      getMapChangeItemOutcome({ id: ID_B, index: index, isHiding: false }),
    ).toEqual({ kind: "unchanged", reason: MAP_CHANGE_REASONS.alreadyShown });
  });

  test("a monitored row is left alone, and the reader is told its monitoring is not changed", () => {
    expect(
      getMapChangeItemOutcome({ id: ID_C, index: index, isHiding: true }),
    ).toEqual({ kind: "unchanged", reason: MAP_CHANGE_REASONS.monitored });
    expect(MAP_CHANGE_REASONS.monitored).toContain(
      "Its monitoring is not changed.",
    );
  });

  test("monitored wins when the answer names a row twice", () => {
    expect(
      getMapChangeItemOutcome({
        id: ID_B,
        index: indexMapChange({
          changedIds: [],
          unchangedIds: [ID_B],
          monitoredIds: [ID_B],
          notFoundIds: [],
        }),
        isHiding: true,
      }),
    ).toEqual({ kind: "unchanged", reason: MAP_CHANGE_REASONS.monitored });
  });

  test("a row the answer does not name failed - nothing was done to it - and is never reported as done", () => {
    expect(
      getMapChangeItemOutcome({
        id: "9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192",
        index: index,
        isHiding: false,
      }),
    ).toEqual({ kind: "failed", reason: MAP_CHANGE_REASONS.notFound });
  });

  test("a whole selection is partitioned, in the order it was picked", () => {
    const a: DiscoveredDeviceItem = item({ id: ID_A, _id: ID_A });
    const b: DiscoveredDeviceItem = item({ id: ID_B, _id: ID_B });
    const c: DiscoveredDeviceItem = item({ id: ID_C, _id: ID_C });
    const gone: DiscoveredDeviceItem = item({
      id: "9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192",
      _id: "9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192",
    });

    expect(
      getMapChangeOutcome({
        items: [gone, c, b, a],
        change: {
          changedIds: [ID_A],
          unchangedIds: [ID_B],
          monitoredIds: [ID_C],
          notFoundIds: ["9a3c5e85-6f4b-4ebd-8c71-4d5e6f708192"],
        },
        isHiding: true,
      }),
    ).toEqual({
      changed: [a],
      unchanged: [
        { item: c, reason: MAP_CHANGE_REASONS.monitored },
        { item: b, reason: MAP_CHANGE_REASONS.alreadyHidden },
      ],
      failed: [{ item: gone, reason: MAP_CHANGE_REASONS.notFound }],
    });
  });
});

describe("the Seen On and Name cells", () => {
  test("where a row was seen: the device, then its port and VLAN", () => {
    expect(
      getSeenOnParts({
        seenOn: { id: ID_B, name: "access-sw-1" },
        portName: "Gi1/0/7",
        vlanId: 20,
      }),
    ).toEqual({ deviceName: "access-sw-1", port: "Gi1/0/7", vlanId: 20 });
  });

  test("VLAN 0 is a VLAN; a device the reader may not see has no name to show", () => {
    expect(getSeenOnParts({ seenOn: { id: ID_B }, vlanId: 0 })).toEqual({
      vlanId: 0,
    });
    expect(getSeenOnParts({})).toEqual({});
  });

  test("the hostname is shown under the name only when it says something else", () => {
    expect(
      getHostnameUnderName({ name: "Printer", hostname: "printer-2f" }),
    ).toBe("printer-2f");
    expect(
      getHostnameUnderName({ name: "printer-2f", hostname: " printer-2f " }),
    ).toBeUndefined();
    expect(getHostnameUnderName({ name: "printer-2f", hostname: "" })).toBe(
      undefined,
    );
    expect(getHostnameUnderName({ name: "printer-2f" })).toBeUndefined();
  });

  test("a selected row is named by its name and its address when that is something else", () => {
    expect(
      getDiscoveredDeviceLabel({ name: "printer-2f", ipAddress: "10.20.0.15" }),
    ).toBe("printer-2f (10.20.0.15)");
    expect(
      getDiscoveredDeviceLabel({ name: "10.20.0.15", ipAddress: "10.20.0.15" }),
    ).toBe("10.20.0.15");
    expect(getDiscoveredDeviceLabel({ name: "aa:bb:cc:00:11:22" })).toBe(
      "aa:bb:cc:00:11:22",
    );
  });
});

describe("the Show choices", () => {
  test("Not monitored first - what a reader comes to act on - then Monitored, Hidden from map and All", () => {
    expect(
      DISCOVERED_DEVICE_SHOW_LABELS.map(
        (choice: { show: DiscoveredDeviceShow; label: string }) => {
          return [choice.show, choice.label];
        },
      ),
    ).toEqual([
      [DiscoveredDeviceShow.NotMonitored, "Not monitored"],
      [DiscoveredDeviceShow.Monitored, "Monitored"],
      [DiscoveredDeviceShow.Hidden, "Hidden from map"],
      [DiscoveredDeviceShow.All, "All"],
    ]);
  });

  test("each choice counts its rows", () => {
    expect(countForShow(COUNTS, DiscoveredDeviceShow.NotMonitored)).toBe(9);
    expect(countForShow(COUNTS, DiscoveredDeviceShow.Monitored)).toBe(3);
    expect(countForShow(COUNTS, DiscoveredDeviceShow.Hidden)).toBe(4);
    expect(countForShow(COUNTS, DiscoveredDeviceShow.All)).toBe(12);
  });

  test("the buttons carry the counts once the list has answered, and none before", () => {
    expect(getDiscoveredDeviceShowOptions(COUNTS)).toEqual([
      { label: "Not monitored", value: "notMonitored", badge: 9 },
      { label: "Monitored", value: "monitored", badge: 3 },
      { label: "Hidden from map", value: "hidden", badge: 4 },
      { label: "All", value: "all", badge: 12 },
    ]);

    for (const option of getDiscoveredDeviceShowOptions(null)) {
      expect("badge" in option).toBe(false);
    }
  });

  test("a zero is a count, and drawn", () => {
    expect(
      getDiscoveredDeviceShowOptions({
        all: 0,
        notMonitored: 0,
        monitored: 0,
        hidden: 0,
      })[0],
    ).toEqual({ label: "Not monitored", value: "notMonitored", badge: 0 });
  });

  test("only the four choices are choices", () => {
    for (const show of ["notMonitored", "monitored", "hidden", "all"]) {
      expect(isDiscoveredDeviceShow(show)).toBe(true);
    }

    for (const other of ["", "All", "unmonitored", "hiddenFromMap"]) {
      expect(isDiscoveredDeviceShow(other)).toBe(false);
    }
  });
});

describe("why the list is empty", () => {
  test("a search that matches nothing says so, whatever is chosen", () => {
    for (const show of [
      DiscoveredDeviceShow.NotMonitored,
      DiscoveredDeviceShow.All,
    ]) {
      expect(
        getDiscoveredDeviceEmptyKind({
          search: "camera",
          show: show,
          counts: { ...COUNTS, all: 0 },
        }),
      ).toBe(DiscoveredDeviceEmptyKind.NoMatch);
    }
  });

  /*
   * The counts are the search's: one monitored device looked for under Not
   * monitored, which the list opens on, is not "nothing matches".
   */
  test("a search that matches only under another choice says where, not that nothing matches", () => {
    const elsewhere: DiscoveredDeviceCounts = {
      all: 1,
      notMonitored: 0,
      monitored: 1,
      hidden: 0,
    };

    for (const show of [
      DiscoveredDeviceShow.NotMonitored,
      DiscoveredDeviceShow.Hidden,
    ]) {
      expect(
        getDiscoveredDeviceEmptyKind({
          search: "branch router",
          show: show,
          counts: elsewhere,
        }),
      ).toBe(DiscoveredDeviceEmptyKind.MatchesElsewhere);
    }
    expect(
      getDiscoveredDeviceEmptyKind({
        search: "lobby",
        show: DiscoveredDeviceShow.Monitored,
        counts: { all: 2, notMonitored: 2, monitored: 0, hidden: 1 },
      }),
    ).toBe(DiscoveredDeviceEmptyKind.MatchesElsewhere);
  });

  test("a search of spaces is no search", () => {
    expect(
      getDiscoveredDeviceEmptyKind({
        search: "   ",
        show: DiscoveredDeviceShow.NotMonitored,
        counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
      }),
    ).toBe(DiscoveredDeviceEmptyKind.NoneYet);
  });

  test("nothing discovered yet, whatever is chosen", () => {
    for (const show of [
      DiscoveredDeviceShow.NotMonitored,
      DiscoveredDeviceShow.Monitored,
      DiscoveredDeviceShow.Hidden,
      DiscoveredDeviceShow.All,
    ]) {
      expect(
        getDiscoveredDeviceEmptyKind({
          search: "",
          show: show,
          counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
        }),
      ).toBe(DiscoveredDeviceEmptyKind.NoneYet);
    }
  });

  test("devices were found, and the choice shown holds none of them", () => {
    const found: DiscoveredDeviceCounts = {
      all: 4,
      notMonitored: 0,
      monitored: 0,
      hidden: 0,
    };

    expect(
      getDiscoveredDeviceEmptyKind({
        search: "",
        show: DiscoveredDeviceShow.NotMonitored,
        counts: found,
      }),
    ).toBe(DiscoveredDeviceEmptyKind.AllMonitored);
    expect(
      getDiscoveredDeviceEmptyKind({
        search: "",
        show: DiscoveredDeviceShow.Monitored,
        counts: found,
      }),
    ).toBe(DiscoveredDeviceEmptyKind.NoneMonitored);
    expect(
      getDiscoveredDeviceEmptyKind({
        search: "",
        show: DiscoveredDeviceShow.Hidden,
        counts: found,
      }),
    ).toBe(DiscoveredDeviceEmptyKind.NoneHidden);
  });
});
