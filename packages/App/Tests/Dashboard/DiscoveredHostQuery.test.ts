import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostFilter,
  DiscoveredHostNameFilter,
  DiscoveredHostNameFilterOption,
  DiscoveredHostQuery,
  areAllShownHostsSelected,
  countDiscoveredHostsByName,
  countSelectableShownHosts,
  countSelectedDiscoveredHosts,
  filterDiscoveredHosts,
  getDiscoveredHostNameFilterLabel,
  getDiscoveredHostNameFilterOptions,
  getDiscoveredHostSearchText,
  getDiscoveredHostVendor,
  getDiscoveredHostsToImport,
  getHostsCountedByFacet,
  getShownDiscoveredHosts,
  isDiscoveredHostQueryNarrowed,
  isNamedDiscoveredHost,
  matchesDiscoveredHostFilter,
  matchesDiscoveredHostNameFilter,
  matchesDiscoveredHostSearch,
  readSearchAsAddressRange,
  toDiscoveredHostQuery,
  toggleSelectionForShownHosts,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * Finding the hosts to import in a scan of hundreds (OneUptime issue #4813):
 * a search that finds a host by any name it goes by, its address, its vendor
 * - or a whole subnet - and two facets, what it answered and whether
 * anything named it, each counting what pressing it would show.
 *
 * Import brings in what is ticked AND shown, so every rule here decides what
 * gets created. The expensive failure renders perfectly: a search that hides
 * hosts the reviewer ticked, and an Import that brings them in anyway.
 */

const ALL: DiscoveredHostQuery = { answered: DiscoveredHostFilter.All };

// A switch that answered SNMP with its own name.
const CORE_SWITCH: DiscoveredNetworkDevice = {
  ipAddress: "10.48.11.1",
  sysName: "core-sw-01",
  sysObjectId: "1.3.6.1.4.1.9.1.2695",
  sysDescr: "Cisco IOS XE Software, Catalyst L3 Switch Software",
  snmpReachable: true,
};

// A register that answered ping, named by its own NetBIOS answer.
const REGISTER: DiscoveredNetworkDevice = {
  ipAddress: "10.48.11.31",
  netbiosName: "WB1100REG01",
  snmpReachable: false,
};

// A kitchen display named only by its reverse-DNS record.
const KITCHEN_DISPLAY: DiscoveredNetworkDevice = {
  ipAddress: "10.48.12.7",
  dnsHostname: "wb-0660-kds01.wbhq.com",
  snmpReachable: false,
};

// Nothing named it: it imports under its address.
const ANONYMOUS: DiscoveredNetworkDevice = {
  ipAddress: "10.48.12.9",
  snmpReachable: false,
};

// Already a device: listed, never imported again.
const ALREADY_ADDED: DiscoveredNetworkDevice = {
  ipAddress: "10.48.11.2",
  sysName: "core-sw-02",
  snmpReachable: true,
  isAlreadyRegistered: true,
};

const SCAN: Array<DiscoveredNetworkDevice> = [
  CORE_SWITCH,
  REGISTER,
  KITCHEN_DISPLAY,
  ANONYMOUS,
  ALREADY_ADDED,
];

function addressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice): string => {
    return host.ipAddress;
  });
}

function shown(query: DiscoveredHostQuery): Array<string> {
  return addressesOf(filterDiscoveredHosts({ hosts: SCAN, filter: query }));
}

function everySelected(
  hosts: Array<DiscoveredNetworkDevice>,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};

  for (const host of hosts) {
    selection[host.ipAddress] = true;
  }

  return selection;
}

describe("the query every caller passes", () => {
  test("a bare SNMP filter is the query with only that facet set", () => {
    expect(toDiscoveredHostQuery(DiscoveredHostFilter.NoSnmp)).toEqual({
      answered: DiscoveredHostFilter.NoSnmp,
    });
    expect(toDiscoveredHostQuery(null)).toEqual(ALL);
    expect(toDiscoveredHostQuery(undefined)).toEqual(ALL);

    const query: DiscoveredHostQuery = {
      answered: DiscoveredHostFilter.Snmp,
      search: "core",
    };
    expect(toDiscoveredHostQuery(query)).toBe(query);
  });

  test("the old one-facet callers get exactly what they always did", () => {
    expect(
      addressesOf(
        filterDiscoveredHosts({
          hosts: SCAN,
          filter: DiscoveredHostFilter.NoSnmp,
        }),
      ),
    ).toEqual(["10.48.11.31", "10.48.12.7", "10.48.12.9"]);
  });
});

describe("whether a host is named", () => {
  test("by SNMP, by NetBIOS or by reverse DNS: named; by nothing: its address", () => {
    expect(isNamedDiscoveredHost(CORE_SWITCH)).toBe(true);
    expect(isNamedDiscoveredHost(REGISTER)).toBe(true);
    expect(isNamedDiscoveredHost(KITCHEN_DISPLAY)).toBe(true);
    expect(isNamedDiscoveredHost(ANONYMOUS)).toBe(false);
    expect(isNamedDiscoveredHost(null)).toBe(false);
  });

  test("a blank sysName names nothing", () => {
    expect(
      isNamedDiscoveredHost({
        ipAddress: "10.0.0.5",
        sysName: "   ",
        snmpReachable: true,
      }),
    ).toBe(false);
  });

  test("the name facet splits the scan in two, and Any is every host", () => {
    const named: Array<string> = SCAN.filter(
      (host: DiscoveredNetworkDevice): boolean => {
        return matchesDiscoveredHostNameFilter({
          host: host,
          name: DiscoveredHostNameFilter.Named,
        });
      },
    ).map((host: DiscoveredNetworkDevice): string => {
      return host.ipAddress;
    });

    expect(named).toEqual([
      "10.48.11.1",
      "10.48.11.31",
      "10.48.12.7",
      "10.48.11.2",
    ]);
    expect(
      shown({ ...ALL, name: DiscoveredHostNameFilter.AddressOnly }),
    ).toEqual(["10.48.12.9"]);
    expect(shown({ ...ALL, name: DiscoveredHostNameFilter.Any })).toEqual(
      addressesOf(SCAN),
    );
  });

  test("its buttons count each side, in en-US digits, and are looked up by their English", () => {
    const options: Array<DiscoveredHostNameFilterOption> =
      getDiscoveredHostNameFilterOptions(SCAN);

    expect(
      options.map((option: DiscoveredHostNameFilterOption) => {
        return [option.value, option.label, option.count];
      }),
    ).toEqual([
      [DiscoveredHostNameFilter.Any, "All (5)", 5],
      [DiscoveredHostNameFilter.Named, "Named (4)", 4],
      [DiscoveredHostNameFilter.AddressOnly, "Address only (1)", 1],
    ]);
    expect(
      getDiscoveredHostNameFilterLabel(DiscoveredHostNameFilter.Named),
    ).toBe("Named");
    expect(countDiscoveredHostsByName(SCAN)).toEqual({
      all: 5,
      named: 4,
      addressOnly: 1,
    });

    const thousands: Array<DiscoveredNetworkDevice> = Array.from(
      { length: 1234 },
      (_value: unknown, index: number): DiscoveredNetworkDevice => {
        return { ipAddress: `10.1.${Math.floor(index / 250)}.${index % 250}` };
      },
    );
    expect(getDiscoveredHostNameFilterOptions(thousands)[0]!.label).toBe(
      "All (1,234)",
    );
  });
});

describe("who makes a host", () => {
  test("is read from its sysObjectID", () => {
    expect(getDiscoveredHostVendor(CORE_SWITCH)).toBe("Cisco");
    expect(
      getDiscoveredHostVendor({
        ipAddress: "10.0.0.2",
        sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.21",
      }),
    ).toBe("Juniper");
  });

  test("and from its sysDescr where the vendor templates do: a UniFi AP on Net-SNMP's arc is Ubiquiti's", () => {
    expect(
      getDiscoveredHostVendor({
        ipAddress: "10.0.0.3",
        sysObjectId: "1.3.6.1.4.1.8072.3.2.10",
        sysDescr: "UAP-AC-Pro 6.5.28.14491",
      }),
    ).toBe("Ubiquiti");
  });

  test("a host that answered ping only, or a vendor the catalog does not name, has none", () => {
    expect(getDiscoveredHostVendor(REGISTER)).toBeUndefined();
    expect(
      getDiscoveredHostVendor({
        ipAddress: "10.0.0.4",
        sysObjectId: "1.3.6.1.4.1.999999.1",
      }),
    ).toBeUndefined();
    expect(getDiscoveredHostVendor({ ipAddress: "10.0.0.4" })).toBeUndefined();
    expect(getDiscoveredHostVendor(undefined)).toBeUndefined();
  });
});

describe("the search", () => {
  test.each([
    ["the row's name", "CORE-SW", ["10.48.11.1", "10.48.11.2"]],
    ["a NetBIOS name", "reg01", ["10.48.11.31"]],
    ["a reverse-DNS name", "wbhq.com", ["10.48.12.7"]],
    ["the start of an address being typed", "10.48.11.3", ["10.48.11.31"]],
    ["a vendor", "cisco", ["10.48.11.1"]],
    ["a word of the description", "catalyst", ["10.48.11.1"]],
  ])(
    "finds a host by %s",
    (_what: string, search: string, expected: Array<string>) => {
      expect(shown({ ...ALL, search: search })).toEqual(expected);
    },
  );

  test("ignores the case and the spaces around it, and an empty search finds every host", () => {
    expect(shown({ ...ALL, search: "  Wb1100Reg01  " })).toEqual([
      "10.48.11.31",
    ]);
    expect(shown({ ...ALL, search: "   " })).toEqual(addressesOf(SCAN));
    expect(shown({ ...ALL, search: "" })).toEqual(addressesOf(SCAN));
  });

  test("a subnet finds the hosts in it, and only those", () => {
    expect(shown({ ...ALL, search: "10.48.11.0/24" })).toEqual([
      "10.48.11.1",
      "10.48.11.31",
      "10.48.11.2",
    ]);
    expect(shown({ ...ALL, search: "10.48.12.0/29" })).toEqual(["10.48.12.7"]);
  });

  test("so does an octet range, a scan target's other notation", () => {
    expect(shown({ ...ALL, search: "10.48.11-12.5-9" })).toEqual([
      "10.48.12.7",
      "10.48.12.9",
    ]);
  });

  test("only a valid range is read as one: a hostname with dashes is text", () => {
    expect(readSearchAsAddressRange("10.48.11.0/24")).toBe("10.48.11.0/24");
    expect(readSearchAsAddressRange(" 10.48.11-12.0-255 ")).toBe(
      "10.48.11-12.0-255",
    );
    expect(readSearchAsAddressRange("10.48.11.3")).toBeNull();
    expect(readSearchAsAddressRange("core-sw")).toBeNull();
    expect(readSearchAsAddressRange("wb-0660-kds01")).toBeNull();
    expect(readSearchAsAddressRange("")).toBeNull();
    expect(shown({ ...ALL, search: "wb-0660" })).toEqual(["10.48.12.7"]);
  });

  test("finds the short name a short-names scan shows, and the full name it was cut from", () => {
    const naming: { useShortDeviceNames: boolean } = {
      useShortDeviceNames: true,
    };
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.48.12.20",
      dnsHostname: "wb-0660-kds02.wbhq.com",
      snmpReachable: false,
    };

    expect(getDiscoveredHostSearchText(host, naming).split("\n")).toContain(
      "wb-0660-kds02",
    );
    expect(
      matchesDiscoveredHostSearch({
        host: host,
        search: "kds02.wbhq",
        naming: naming,
      }),
    ).toBe(true);
  });

  test("a host's text is worked out once per naming choice, and never mixes the two", () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.48.12.21",
      dnsHostname: "wb-0660-kds03.wbhq.com",
      snmpReachable: false,
    };

    const full: string = getDiscoveredHostSearchText(host, {
      useShortDeviceNames: false,
    });
    const short: string = getDiscoveredHostSearchText(host, {
      useShortDeviceNames: true,
    });

    expect(full.split("\n")[1]).toBe("wb-0660-kds03.wbhq.com");
    expect(short.split("\n")[1]).toBe("wb-0660-kds03");
    // Asked again, each comes back as it was the first time.
    expect(getDiscoveredHostSearchText(host, {})).toBe(full);
    expect(
      getDiscoveredHostSearchText(host, { useShortDeviceNames: true }),
    ).toBe(short);
  });
});

describe("hiding what is already a device", () => {
  test("leaves out the hosts already added, and nothing else", () => {
    expect(shown({ ...ALL, hideAlreadyAdded: true })).toEqual([
      "10.48.11.1",
      "10.48.11.31",
      "10.48.12.7",
      "10.48.12.9",
    ]);
  });
});

describe("everything at once", () => {
  test("a host is shown only when every part of the view lets it through", () => {
    const query: DiscoveredHostQuery = {
      answered: DiscoveredHostFilter.NoSnmp,
      name: DiscoveredHostNameFilter.Named,
      search: "10.48.0.0/16",
      hideAlreadyAdded: true,
    };

    expect(shown(query)).toEqual(["10.48.11.31", "10.48.12.7"]);

    for (const host of SCAN) {
      expect({
        host: host.ipAddress,
        shown: matchesDiscoveredHostFilter({ host: host, filter: query }),
      }).toEqual({
        host: host.ipAddress,
        shown: ["10.48.11.31", "10.48.12.7"].includes(host.ipAddress),
      });
    }
  });

  test("whether the view narrows the scan at all", () => {
    expect(isDiscoveredHostQueryNarrowed(ALL)).toBe(false);
    expect(
      isDiscoveredHostQueryNarrowed({
        ...ALL,
        name: DiscoveredHostNameFilter.Any,
        search: "  ",
        hideAlreadyAdded: false,
      }),
    ).toBe(false);
    expect(isDiscoveredHostQueryNarrowed({ ...ALL, search: "core" })).toBe(
      true,
    );
    expect(
      isDiscoveredHostQueryNarrowed({
        ...ALL,
        name: DiscoveredHostNameFilter.AddressOnly,
      }),
    ).toBe(true);
    expect(
      isDiscoveredHostQueryNarrowed({ ...ALL, hideAlreadyAdded: true }),
    ).toBe(true);
    expect(
      isDiscoveredHostQueryNarrowed({ answered: DiscoveredHostFilter.Snmp }),
    ).toBe(true);
  });
});

describe("what a facet's buttons count", () => {
  /*
   * A button says how many hosts pressing it would show: every host the
   * rest of the view lets through. A facet never narrows its own counts -
   * that is what kept every button but the pressed one from reading zero.
   */
  test("the search and the other facet narrow it; its own value does not", () => {
    const query: DiscoveredHostQuery = {
      answered: DiscoveredHostFilter.Snmp,
      name: DiscoveredHostNameFilter.Named,
      search: "10.48.11.0/24",
    };

    expect(
      addressesOf(
        getHostsCountedByFacet({
          hosts: SCAN,
          query: query,
          facet: "answered",
        }),
      ),
    ).toEqual(["10.48.11.1", "10.48.11.31", "10.48.11.2"]);
    expect(
      addressesOf(
        getHostsCountedByFacet({ hosts: SCAN, query: query, facet: "name" }),
      ),
    ).toEqual(["10.48.11.1", "10.48.11.2"]);
  });

  test("hiding the hosts already added takes them off every count", () => {
    expect(
      addressesOf(
        getHostsCountedByFacet({
          hosts: SCAN,
          query: { ...ALL, hideAlreadyAdded: true },
          facet: "name",
        }),
      ),
    ).not.toContain("10.48.11.2");
  });
});

describe("what Import brings in", () => {
  test("what is ticked AND shown, in scan order, never a host already added", () => {
    const query: DiscoveredHostQuery = { ...ALL, search: "10.48.12.0/24" };

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: SCAN,
          filter: query,
          selectedIpAddresses: everySelected(SCAN),
        }),
      ),
    ).toEqual(["10.48.12.7", "10.48.12.9"]);
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: SCAN,
          filter: ALL,
          selectedIpAddresses: everySelected(SCAN),
        }),
      ),
    ).toEqual(["10.48.11.1", "10.48.11.31", "10.48.12.7", "10.48.12.9"]);
  });

  test("the ticked hosts the view hides are counted, so the reader knows they stay behind", () => {
    expect(
      countSelectedDiscoveredHosts({
        hosts: SCAN,
        filter: { ...ALL, name: DiscoveredHostNameFilter.AddressOnly },
        selectedIpAddresses: everySelected(SCAN),
      }),
    ).toEqual({ selected: 4, hiddenSelected: 3 });
    expect(
      countSelectedDiscoveredHosts({
        hosts: SCAN,
        filter: ALL,
        selectedIpAddresses: { "10.48.11.1": true, "10.48.11.2": true },
      }),
    ).toEqual({ selected: 1, hiddenSelected: 0 });
  });

  test("select all ticks the shown hosts and leaves every other choice alone", () => {
    const query: DiscoveredHostQuery = { ...ALL, search: "10.48.12.0/24" };
    const selection: Record<string, boolean> = { "10.48.11.1": false };

    const toggled: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: SCAN,
      filter: query,
      selectedIpAddresses: selection,
    });

    expect(toggled).toEqual({
      "10.48.11.1": false,
      "10.48.12.7": true,
      "10.48.12.9": true,
    });
    expect(
      areAllShownHostsSelected({
        hosts: SCAN,
        filter: query,
        selectedIpAddresses: toggled,
      }),
    ).toBe(true);
    expect(countSelectableShownHosts({ hosts: SCAN, filter: query })).toBe(2);

    // Pressed again over a full view, it clears the shown hosts only.
    expect(
      toggleSelectionForShownHosts({
        hosts: SCAN,
        filter: query,
        selectedIpAddresses: { ...toggled, "10.48.11.31": true },
      }),
    ).toEqual({
      "10.48.11.1": false,
      "10.48.11.31": true,
      "10.48.12.7": false,
      "10.48.12.9": false,
    });
  });

  test("each shown row keeps its place in the whole scan, whatever the view", () => {
    expect(
      getShownDiscoveredHosts({
        hosts: SCAN,
        filter: { ...ALL, search: "10.48.12.0/24" },
      }).map((row: { scanIndex: number }): number => {
        return row.scanIndex;
      }),
    ).toEqual([2, 3]);
  });
});

describe("five hundred registers", () => {
  /*
   * The scan from issue #4812: 514 point-of-sale registers, two per store,
   * every 17th store's second register unnamed. The facets and the search
   * have to find each group exactly, and the counts have to add up.
   */
  const registers: Array<DiscoveredNetworkDevice> = [];

  for (let store: number = 0; store < 257; store++) {
    for (const register of [1, 2]) {
      const isUnnamed: boolean = register === 2 && store % 17 === 0;
      registers.push({
        ipAddress: `10.${100 + Math.floor(store / 200)}.${store % 200}.${30 + register}`,
        snmpReachable: false,
        ...(isUnnamed
          ? {}
          : { netbiosName: `WB${1100 + store}REG0${register}` }),
      });
    }
  }

  test("named and unnamed add up to the scan", () => {
    const counts: { all: number; named: number; addressOnly: number } =
      countDiscoveredHostsByName(registers);

    expect(counts).toEqual({ all: 514, named: 498, addressOnly: 16 });
  });

  test("one store's registers by name, and one subnet's by range", () => {
    expect(
      addressesOf(
        filterDiscoveredHosts({
          hosts: registers,
          filter: { ...ALL, search: "wb1105reg" },
        }),
      ),
    ).toEqual(["10.100.5.31", "10.100.5.32"]);
    expect(
      filterDiscoveredHosts({
        hosts: registers,
        filter: { ...ALL, search: "10.101.0.0/16" },
      }),
    ).toHaveLength(114);
  });
});
