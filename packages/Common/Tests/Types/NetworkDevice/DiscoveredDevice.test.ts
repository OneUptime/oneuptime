import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
  DiscoveredDeviceMatch,
  DiscoveredDeviceRow,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
  MAX_DISCOVERED_DEVICES_PER_ACTION,
  MAX_DISCOVERED_DEVICE_PAGE_SIZE,
  getEndpointNodeKey,
  isShownBy,
  readDiscoveredDeviceIds,
  readDiscoveredDeviceIdsResponse,
  readDiscoveredDeviceImportFacts,
  readDiscoveredDeviceListRequest,
  readDiscoveredDeviceListResponse,
  readDiscoveredDeviceMapChange,
  readDiscoveredDeviceRow,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import {
  DiscoveryImportSettings,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
  getDiscoveryImportHostKey,
  readDiscoveryImportHostResult,
  readDiscoveryImportSettings,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Discovered Devices list (issue #5775) and the Dashboard exchange,
 * and the rules both apply to it: a request is refused in a sentence when it
 * is wrong, never quietly changed; an answer is read for what it holds.
 */

const ID_A: string = "10000000-0000-4000-8000-00000000000a";
const ID_B: string = "10000000-0000-4000-8000-00000000000b";
const SITE_ID: string = "20000000-0000-4000-8000-000000000001";

describe("reading a list request", () => {
  test("nothing asked is the first page of devices not monitored, last seen first", () => {
    expect(readDiscoveredDeviceListRequest(undefined)).toEqual(
      DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    );
    expect(readDiscoveredDeviceListRequest({})).toEqual({
      search: "",
      show: DiscoveredDeviceShow.NotMonitored,
      sort: DiscoveredDeviceSort.LastSeen,
      sortOrder: "desc",
      limit: 25,
      skip: 0,
    });
  });

  test("everything asked for, read as asked, the search trimmed", () => {
    expect(
      readDiscoveredDeviceListRequest({
        search: "  10.0.0.  ",
        show: "hidden",
        siteId: ` ${SITE_ID} `,
        sort: "ipAddress",
        sortOrder: "desc",
        limit: "50",
        skip: 100,
      }),
    ).toEqual({
      search: "10.0.0.",
      show: DiscoveredDeviceShow.Hidden,
      siteId: SITE_ID,
      sort: DiscoveredDeviceSort.IpAddress,
      sortOrder: "desc",
      limit: 50,
      skip: 100,
    });
  });

  test("a sort picked without an order reads the way its column reads best", () => {
    expect(
      readDiscoveredDeviceListRequest({ sort: DiscoveredDeviceSort.Name })
        .sortOrder,
    ).toBe("asc");
    expect(
      readDiscoveredDeviceListRequest({ sort: DiscoveredDeviceSort.FirstSeen })
        .sortOrder,
    ).toBe("desc");
  });

  test.each([
    [{ search: 42 }, "Search for a name, address, MAC or maker."],
    [{ search: "x".repeat(101) }, "Search for at most 100 characters."],
    [
      { show: "everything" },
      "Show the devices that are not monitored, the monitored ones, the hidden ones, or all of them.",
    ],
    [{ siteId: "store-1" }, "This site was not found."],
    [
      { sort: "mac" },
      "Sort by last seen, name, IP address, maker or first seen.",
    ],
    [{ sortOrder: "up" }, "Sort up or down."],
    [{ limit: 0 }, "Show between 1 and 100 devices a page."],
    [
      { limit: MAX_DISCOVERED_DEVICE_PAGE_SIZE + 1 },
      "Show between 1 and 100 devices a page.",
    ],
    [{ limit: 2.5 }, "Show between 1 and 100 devices a page."],
    [{ limit: "ten" }, "Show between 1 and 100 devices a page."],
    [{ skip: -1 }, "This page of devices does not exist."],
  ])("%j is refused: %s", (body: Record<string, unknown>, message: string) => {
    expect(() => {
      return readDiscoveredDeviceListRequest(body);
    }).toThrow(new BadDataException(message));
  });
});

describe("reading the devices a bulk action is asked for", () => {
  test("ids, each once, in the order asked, lower-cased", () => {
    expect(
      readDiscoveredDeviceIds([ID_A, ` ${ID_B.toUpperCase()} `, ID_A]),
    ).toEqual([ID_A, ID_B]);
  });

  test("nothing selected is refused", () => {
    expect(() => {
      return readDiscoveredDeviceIds([]);
    }).toThrow(new BadDataException("Select the devices first."));
    expect(() => {
      return readDiscoveredDeviceIds(undefined);
    }).toThrow(new BadDataException("Select the devices first."));
  });

  test("an id that is not one is refused, not skipped", () => {
    expect(() => {
      return readDiscoveredDeviceIds([ID_A, "10.0.0.5"]);
    }).toThrow(
      new BadDataException(
        "One of the selected devices was not found. Refresh the list and select them again.",
      ),
    );
    expect(() => {
      return readDiscoveredDeviceIds([ID_A, 42]);
    }).toThrow(BadDataException);
  });

  test("one action takes as many as one import does, and no more", () => {
    expect(MAX_DISCOVERED_DEVICES_PER_ACTION).toBe(
      MAX_HOSTS_PER_DISCOVERY_IMPORT,
    );

    const ids: Array<string> = [];

    for (
      let index: number = 0;
      index <= MAX_DISCOVERED_DEVICES_PER_ACTION;
      index++
    ) {
      ids.push(
        `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      );
    }

    expect(readDiscoveredDeviceIds(ids.slice(0, -1))).toHaveLength(
      MAX_DISCOVERED_DEVICES_PER_ACTION,
    );
    expect(() => {
      return readDiscoveredDeviceIds(ids);
    }).toThrow(
      new BadDataException(
        `Select at most ${MAX_DISCOVERED_DEVICES_PER_ACTION} devices at a time.`,
      ),
    );
  });
});

describe("reading an answer", () => {
  test("a row keeps what it says, and its name falls back to its MAC", () => {
    expect(
      readDiscoveredDeviceRow({
        id: ID_A,
        name: "",
        macAddress: "00:11:22:33:44:55",
        ipAddress: "10.0.0.5",
        vendor: "Zebra",
        vlanId: 0,
        site: { id: SITE_ID, name: "Store 1" },
        seenOn: { id: ID_B },
        isSeenRecently: true,
        isFromController: "yes",
        isHidden: true,
        unknown: "dropped",
      }),
    ).toEqual({
      id: ID_A,
      name: "00:11:22:33:44:55",
      macAddress: "00:11:22:33:44:55",
      ipAddress: "10.0.0.5",
      vendor: "Zebra",
      vlanId: 0,
      site: { id: SITE_ID, name: "Store 1" },
      seenOn: { id: ID_B },
      isSeenRecently: true,
      isFromController: false,
      isHidden: true,
    });
  });

  test("a monitored row is never hidden: the map draws the device itself", () => {
    const row: DiscoveredDeviceRow | null = readDiscoveredDeviceRow({
      id: ID_A,
      name: "printer",
      macAddress: "00:11:22:33:44:55",
      isHidden: true,
      monitoredDevice: { id: ID_B, name: "Printer" },
      monitoredBy: "macAddress",
    });

    expect(row?.isHidden).toBe(false);
    expect(row?.monitoredDevice).toEqual({ id: ID_B, name: "Printer" });
    expect(row?.monitoredBy).toBe(DiscoveredDeviceMatch.MacAddress);
  });

  test("a row with no id is no row; a list keeps the rows it can read", () => {
    expect(readDiscoveredDeviceRow({ name: "x" })).toBeNull();
    expect(readDiscoveredDeviceRow("x")).toBeNull();

    expect(
      readDiscoveredDeviceListResponse({
        rows: [{ id: ID_A, macAddress: "aa" }, null, { name: "no id" }],
        count: "3",
        counts: { all: 9, notMonitored: -1, monitored: 2.7, hidden: "x" },
      }),
    ).toEqual({
      rows: [
        {
          id: ID_A,
          name: "aa",
          macAddress: "aa",
          isSeenRecently: false,
          isFromController: false,
          isHidden: false,
        },
      ],
      count: 3,
      counts: { all: 9, notMonitored: 0, monitored: 2, hidden: 0 },
    });
    expect(readDiscoveredDeviceListResponse(null)).toEqual({
      rows: [],
      count: 0,
      counts: { all: 0, notMonitored: 0, monitored: 0, hidden: 0 },
    });
  });

  test("what a map change did is read by id, keeping only ids", () => {
    expect(
      readDiscoveredDeviceMapChange({
        changedIds: ["a", "b"],
        unchangedIds: ["c", 4, null, ""],
        monitoredIds: "d",
      }),
    ).toEqual({
      changedIds: ["a", "b"],
      unchangedIds: ["c"],
      monitoredIds: [],
      notFoundIds: [],
    });
  });

  test("select all is read as named rows, once each, and the count of every match", () => {
    expect(
      readDiscoveredDeviceIdsResponse({
        devices: [
          { id: "a", name: "Back office printer", ipAddress: "10.0.0.5" },
          { id: "a", name: "again" },
          { id: "b", isMonitored: true },
          { id: "e", isMonitored: "yes" },
          { name: "no id" },
          "c",
        ],
        count: 7,
      }),
    ).toEqual({
      devices: [
        { id: "a", name: "Back office printer", ipAddress: "10.0.0.5" },
        { id: "b", name: "b", isMonitored: true },
        { id: "e", name: "e" },
      ],
      count: 7,
    });
    expect(readDiscoveredDeviceIdsResponse(undefined)).toEqual({
      devices: [],
      count: 0,
    });
  });
});

describe("which rows each choice shows", () => {
  const notMonitored: Pick<
    DiscoveredDeviceRow,
    "monitoredDevice" | "isHidden"
  > = { isHidden: false };
  const hidden: Pick<DiscoveredDeviceRow, "monitoredDevice" | "isHidden"> = {
    isHidden: true,
  };
  const monitored: Pick<DiscoveredDeviceRow, "monitoredDevice" | "isHidden"> = {
    isHidden: false,
    monitoredDevice: { id: ID_B },
  };

  test.each([
    [DiscoveredDeviceShow.NotMonitored, [true, true, false]],
    [DiscoveredDeviceShow.Hidden, [false, true, false]],
    [DiscoveredDeviceShow.Monitored, [false, false, true]],
    [DiscoveredDeviceShow.All, [true, true, true]],
  ])("%s", (show: DiscoveredDeviceShow, expected: Array<boolean>) => {
    expect(
      [notMonitored, hidden, monitored].map(
        (
          row: Pick<DiscoveredDeviceRow, "monitoredDevice" | "isHidden">,
        ): boolean => {
          return isShownBy(row, show);
        },
      ),
    ).toEqual(expected);
  });

  test("an endpoint's node on the map is keyed by its row", () => {
    expect(getEndpointNodeKey(ID_A)).toBe(`endpoint:${ID_A}`);
  });
});

describe("what an import from the list keeps of each device", () => {
  test("its row, name, MAC, site and probe", () => {
    expect(
      readDiscoveredDeviceImportFacts({
        endpointId: ID_A,
        name: "Printer",
        macAddress: "00:11:22:33:44:55",
        siteId: SITE_ID,
        probeId: "not-an-id",
      }),
    ).toEqual({
      endpointId: ID_A,
      name: "Printer",
      macAddress: "00:11:22:33:44:55",
      siteId: SITE_ID,
    });
    expect(readDiscoveredDeviceImportFacts({ name: "x" })).toBeNull();
    expect(readDiscoveredDeviceImportFacts(undefined)).toBeNull();
  });

  test("a result says which device it is, and is told apart by it", () => {
    expect(
      readDiscoveryImportHostResult({
        ipAddress: "10.0.0.5",
        endpointId: ID_A,
        device: "Created",
        monitor: "NotRequested",
      })?.endpointId,
    ).toBe(ID_A);
    expect(
      getDiscoveryImportHostKey({ ipAddress: "10.0.0.5", endpointId: ID_A }),
    ).not.toBe(
      getDiscoveryImportHostKey({ ipAddress: "10.0.0.5", endpointId: ID_B }),
    );
    expect(getDiscoveryImportHostKey({ ipAddress: "10.0.0.5" })).toBe(
      "10.0.0.5",
    );
  });

  test("what the devices are and their credentials are ids, or nothing", () => {
    const settings: DiscoveryImportSettings = readDiscoveryImportSettings({
      networkDeviceRoleId: ` ${ID_A} `,
      snmpCredentialProfileId: ID_B,
    });

    expect(settings.networkDeviceRoleId).toBe(ID_A);
    expect(settings.snmpCredentialProfileId).toBe(ID_B);
    expect(
      readDiscoveryImportSettings({
        networkDeviceRoleId: "",
        snmpCredentialProfileId: null,
      }),
    ).not.toHaveProperty("networkDeviceRoleId");

    expect(() => {
      return readDiscoveryImportSettings({ networkDeviceRoleId: "printer" });
    }).toThrow(
      new BadDataException(
        "Pick what the devices are from the list, or leave it to the devices.",
      ),
    );
    expect(() => {
      return readDiscoveryImportSettings({ snmpCredentialProfileId: 7 });
    }).toThrow(
      new BadDataException(
        "Pick the SNMP credentials from the list, or check the devices by ping.",
      ),
    );
  });
});
