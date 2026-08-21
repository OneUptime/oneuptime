import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostCounts,
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  areAllShownHostsSelected,
  countDiscoveredHosts,
  countSelectableShownHosts,
  filterDiscoveredHosts,
  getDiscoveredHostFilterLabel,
  getDiscoveredHostFilterOptions,
  getDiscoveredHostsToImport,
  getInitialSelection,
  isPingOnlyDiscoveredHost,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  matchesDiscoveredHostFilter,
  toggleSelectionForShownHosts,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * The rules behind the SNMP / No SNMP filter in the Review Discovered Devices
 * dialog (issue #3322).
 *
 * Everything here fails silently in production if it is wrong: a filter that
 * puts a host in the wrong group, a count badge that disagrees with the list
 * under it, a "Select all" that reaches outside the group on screen, or — the
 * expensive one — an Import that creates the 2,890 ping-only devices the
 * operator just filtered away. All of those render perfectly.
 */

/** An SNMP responder: answered the walk, so it imports as a polled device. */
function snmpHost(
  ipAddress: string,
  overrides?: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return {
    ipAddress: ipAddress,
    sysName: `switch-${ipAddress}`,
    snmpReachable: true,
    ...overrides,
  };
}

/** Answered ping, not SNMP — the "No SNMP" badge group. */
function pingOnlyHost(
  ipAddress: string,
  overrides?: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return {
    ipAddress: ipAddress,
    snmpReachable: false,
    ...overrides,
  };
}

/*
 * A row from a scan stored before `snmpReachable` existed. Every host on those
 * scans answered SNMP — ping-only sweeps did not exist yet — so `undefined`
 * has to read as SNMP everywhere, not as ping-only.
 */
function legacyHost(
  ipAddress: string,
  overrides?: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return {
    ipAddress: ipAddress,
    sysName: `legacy-${ipAddress}`,
    ...overrides,
  };
}

function ipAddressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice) => {
    return host.ipAddress;
  });
}

/** Everything selected — the state the dialog opens in. */
function selectAll(
  hosts: Array<DiscoveredNetworkDevice>,
): Record<string, boolean> {
  return getInitialSelection(hosts);
}

describe("isPingOnlyDiscoveredHost", () => {
  test("explicit snmpReachable false is ping-only", () => {
    expect(isPingOnlyDiscoveredHost(pingOnlyHost("10.0.0.42"))).toBe(true);
  });

  test("an SNMP responder is not ping-only", () => {
    expect(isPingOnlyDiscoveredHost(snmpHost("10.0.0.5"))).toBe(false);
  });

  test("a legacy row with no snmpReachable is not ping-only", () => {
    expect(isPingOnlyDiscoveredHost(legacyHost("10.0.0.9"))).toBe(false);
    expect(
      isPingOnlyDiscoveredHost({
        ipAddress: "10.0.0.10",
        snmpReachable: undefined,
      }),
    ).toBe(false);
  });

  test("already-registered hosts still belong to a group", () => {
    /*
     * Registration is orthogonal to which group a host is in. Reading it as
     * "not in either group" would drop rows out of the counts they are
     * rendered under.
     */
    expect(
      isPingOnlyDiscoveredHost(
        pingOnlyHost("10.0.0.42", { isAlreadyRegistered: true }),
      ),
    ).toBe(true);
    expect(
      isPingOnlyDiscoveredHost(
        snmpHost("10.0.0.5", { isAlreadyRegistered: true }),
      ),
    ).toBe(false);
  });
});

describe("matchesDiscoveredHostFilter", () => {
  test("All keeps every host, whatever it answered", () => {
    for (const host of [
      snmpHost("10.0.0.5"),
      pingOnlyHost("10.0.0.42"),
      legacyHost("10.0.0.9"),
    ]) {
      expect(
        matchesDiscoveredHostFilter({
          host: host,
          filter: DiscoveredHostFilter.All,
        }),
      ).toBe(true);
    }
  });

  test("Snmp keeps SNMP responders and legacy rows, drops ping-only", () => {
    expect(
      matchesDiscoveredHostFilter({
        host: snmpHost("10.0.0.5"),
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(true);
    expect(
      matchesDiscoveredHostFilter({
        host: legacyHost("10.0.0.9"),
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(true);
    expect(
      matchesDiscoveredHostFilter({
        host: pingOnlyHost("10.0.0.42"),
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(false);
  });

  test("NoSnmp keeps only explicit ping-only hosts", () => {
    expect(
      matchesDiscoveredHostFilter({
        host: pingOnlyHost("10.0.0.42"),
        filter: DiscoveredHostFilter.NoSnmp,
      }),
    ).toBe(true);
    expect(
      matchesDiscoveredHostFilter({
        host: snmpHost("10.0.0.5"),
        filter: DiscoveredHostFilter.NoSnmp,
      }),
    ).toBe(false);
    expect(
      matchesDiscoveredHostFilter({
        host: legacyHost("10.0.0.9"),
        filter: DiscoveredHostFilter.NoSnmp,
      }),
    ).toBe(false);
  });

  test("the two groups partition the list — never both, never neither", () => {
    for (const host of [
      snmpHost("10.0.0.5"),
      pingOnlyHost("10.0.0.42"),
      legacyHost("10.0.0.9"),
      { ipAddress: "10.0.0.11" },
    ]) {
      const inSnmp: boolean = matchesDiscoveredHostFilter({
        host: host,
        filter: DiscoveredHostFilter.Snmp,
      });
      const inNoSnmp: boolean = matchesDiscoveredHostFilter({
        host: host,
        filter: DiscoveredHostFilter.NoSnmp,
      });

      expect(inSnmp).toBe(!inNoSnmp);
    }
  });
});

describe("filterDiscoveredHosts", () => {
  const hosts: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    legacyHost("10.0.0.3"),
    pingOnlyHost("10.0.0.4"),
    snmpHost("10.0.0.5"),
  ];

  test("All returns the whole list", () => {
    expect(
      ipAddressesOf(
        filterDiscoveredHosts({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"]);
  });

  test("Snmp returns responders and legacy rows in scan order", () => {
    /*
     * Order is the probe's address order. Re-sorting would move rows under the
     * operator's cursor every time the filter changed.
     */
    expect(
      ipAddressesOf(
        filterDiscoveredHosts({
          hosts: hosts,
          filter: DiscoveredHostFilter.Snmp,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.3", "10.0.0.5"]);
  });

  test("NoSnmp returns ping-only hosts in scan order", () => {
    expect(
      ipAddressesOf(
        filterDiscoveredHosts({
          hosts: hosts,
          filter: DiscoveredHostFilter.NoSnmp,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.4"]);
  });

  test("an empty scan filters to nothing under every filter", () => {
    for (const filter of [
      DiscoveredHostFilter.All,
      DiscoveredHostFilter.Snmp,
      DiscoveredHostFilter.NoSnmp,
    ]) {
      expect(filterDiscoveredHosts({ hosts: [], filter: filter })).toEqual([]);
    }
  });

  test("the scan's own array is never mutated", () => {
    const original: Array<DiscoveredNetworkDevice> = [...hosts];

    filterDiscoveredHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.NoSnmp,
    });

    expect(hosts).toEqual(original);
  });
});

describe("countDiscoveredHosts", () => {
  test("counts each group, legacy rows counted as SNMP", () => {
    const counts: DiscoveredHostCounts = countDiscoveredHosts([
      snmpHost("10.0.0.1"),
      snmpHost("10.0.0.2"),
      legacyHost("10.0.0.3"),
      pingOnlyHost("10.0.0.4"),
    ]);

    expect(counts).toEqual({ all: 4, snmp: 3, noSnmp: 1 });
  });

  test("already-registered hosts are counted — the badge is a group size", () => {
    /*
     * The badge is checked against the probe's own ICMP/SNMP tallies. Hiding
     * rows for a reason the badge cannot show would make the two disagree.
     */
    const counts: DiscoveredHostCounts = countDiscoveredHosts([
      snmpHost("10.0.0.1", { isAlreadyRegistered: true }),
      pingOnlyHost("10.0.0.2", { isAlreadyRegistered: true }),
    ]);

    expect(counts).toEqual({ all: 2, snmp: 1, noSnmp: 1 });
  });

  test("an empty scan counts zero everywhere", () => {
    expect(countDiscoveredHosts([])).toEqual({ all: 0, snmp: 0, noSnmp: 0 });
  });

  test("the two groups always add up to the total", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
      legacyHost("10.0.0.3"),
      { ipAddress: "10.0.0.4", snmpReachable: undefined },
      pingOnlyHost("10.0.0.5", { isAlreadyRegistered: true }),
    ];

    const counts: DiscoveredHostCounts = countDiscoveredHosts(hosts);

    expect(counts.snmp + counts.noSnmp).toBe(counts.all);
    expect(counts.all).toBe(hosts.length);
  });

  test("counts agree with what the filter actually shows", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
      legacyHost("10.0.0.3"),
    ];

    const counts: DiscoveredHostCounts = countDiscoveredHosts(hosts);

    expect(
      filterDiscoveredHosts({ hosts: hosts, filter: DiscoveredHostFilter.Snmp })
        .length,
    ).toBe(counts.snmp);
    expect(
      filterDiscoveredHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.NoSnmp,
      }).length,
    ).toBe(counts.noSnmp);
  });
});

describe("getDiscoveredHostFilterLabel", () => {
  test("groups are named the way the row badge names them", () => {
    // "No SNMP" is the exact wording on the per-row pill.
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.All)).toBe("All");
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.Snmp)).toBe(
      "SNMP",
    );
    expect(getDiscoveredHostFilterLabel(DiscoveredHostFilter.NoSnmp)).toBe(
      "No SNMP",
    );
  });
});

describe("getDiscoveredHostFilterOptions", () => {
  test("three buttons, All first, each carrying its group size", () => {
    const options: Array<DiscoveredHostFilterOption> =
      getDiscoveredHostFilterOptions([
        snmpHost("10.0.0.1"),
        snmpHost("10.0.0.2"),
        pingOnlyHost("10.0.0.3"),
      ]);

    expect(
      options.map((option: DiscoveredHostFilterOption) => {
        return option.value;
      }),
    ).toEqual([
      DiscoveredHostFilter.All,
      DiscoveredHostFilter.Snmp,
      DiscoveredHostFilter.NoSnmp,
    ]);

    expect(
      options.map((option: DiscoveredHostFilterOption) => {
        return option.label;
      }),
    ).toEqual(["All (3)", "SNMP (2)", "No SNMP (1)"]);

    expect(
      options.map((option: DiscoveredHostFilterOption) => {
        return option.count;
      }),
    ).toEqual([3, 2, 1]);
  });

  test("an empty group still renders its zero", () => {
    /*
     * "SNMP (0)" is the answer to "did this sweep find any switches at all".
     * A button that hid its zero would look identical to one with results
     * behind it.
     */
    const options: Array<DiscoveredHostFilterOption> =
      getDiscoveredHostFilterOptions([pingOnlyHost("10.0.0.3")]);

    expect(
      options.map((option: DiscoveredHostFilterOption) => {
        return option.label;
      }),
    ).toEqual(["All (1)", "SNMP (0)", "No SNMP (1)"]);
  });

  test("an empty scan reads zero on all three", () => {
    expect(
      getDiscoveredHostFilterOptions([]).map(
        (option: DiscoveredHostFilterOption) => {
          return option.label;
        },
      ),
    ).toEqual(["All (0)", "SNMP (0)", "No SNMP (0)"]);
  });

  test("four-digit counts are grouped, which is the whole point at scan scale", () => {
    /*
     * The numbers from issue #3322: a sweep of 17,850 addresses that came back
     * with 2,866 SNMP hosts and 2,890 ping-only ones. At that size 2866 and
     * 2,866 are not equally easy to check against the probe's own tally.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [];

    for (let index: number = 0; index < 2866; index++) {
      hosts.push(snmpHost(`10.1.${Math.floor(index / 256)}.${index % 256}`));
    }

    for (let index: number = 0; index < 2890; index++) {
      hosts.push(
        pingOnlyHost(`10.2.${Math.floor(index / 256)}.${index % 256}`),
      );
    }

    expect(
      getDiscoveredHostFilterOptions(hosts).map(
        (option: DiscoveredHostFilterOption) => {
          return option.label;
        },
      ),
    ).toEqual(["All (5,756)", "SNMP (2,866)", "No SNMP (2,890)"]);
  });
});

describe("isSelectableDiscoveredHost", () => {
  test("a fresh SNMP host is selectable", () => {
    expect(isSelectableDiscoveredHost(snmpHost("10.0.0.5"))).toBe(true);
  });

  test("a fresh ping-only host is selectable — it imports as monitor-backed", () => {
    expect(isSelectableDiscoveredHost(pingOnlyHost("10.0.0.42"))).toBe(true);
  });

  test("an already-registered host is not selectable", () => {
    expect(
      isSelectableDiscoveredHost(
        snmpHost("10.0.0.5", { isAlreadyRegistered: true }),
      ),
    ).toBe(false);
    expect(
      isSelectableDiscoveredHost(
        pingOnlyHost("10.0.0.42", { isAlreadyRegistered: true }),
      ),
    ).toBe(false);
  });

  test("a host with no address is not selectable", () => {
    /*
     * The address is both the device's hostname and the selection key, so a
     * blank one has nothing to tick and nothing to import.
     */
    expect(
      isSelectableDiscoveredHost({ ipAddress: "", snmpReachable: true }),
    ).toBe(false);
  });
});

describe("markDiscoveredHostsAsRegistered", () => {
  const hosts: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    snmpHost("10.0.0.3"),
  ];

  test("nothing imported yet leaves the list exactly as it was", () => {
    expect(
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(),
      }),
    ).toBe(hosts);
  });

  test("imported addresses come back already-registered", () => {
    const marked: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(["10.0.0.1", "10.0.0.3"]),
      });

    expect(marked[0]!.isAlreadyRegistered).toBe(true);
    expect(marked[1]!.isAlreadyRegistered).toBeUndefined();
    expect(marked[2]!.isAlreadyRegistered).toBe(true);
  });

  test("the scan's own objects are not mutated", () => {
    markDiscoveredHostsAsRegistered({
      hosts: hosts,
      importedIpAddresses: new Set<string>(["10.0.0.1"]),
    });

    expect(hosts[0]!.isAlreadyRegistered).toBeUndefined();
  });

  test("an address that is not in the scan changes nothing", () => {
    const marked: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(["192.168.99.99"]),
      });

    expect(
      marked.filter((host: DiscoveredNetworkDevice) => {
        return host.isAlreadyRegistered;
      }),
    ).toEqual([]);
  });

  test("marking retires the host from selection and import", () => {
    const marked: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(["10.0.0.1"]),
      });

    expect(isSelectableDiscoveredHost(marked[0]!)).toBe(false);
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: marked,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: selectAll(hosts),
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.3"]);
  });

  test("group membership survives being marked", () => {
    const marked: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(["10.0.0.1", "10.0.0.2"]),
      });

    expect(countDiscoveredHosts(marked)).toEqual({
      all: 3,
      snmp: 2,
      noSnmp: 1,
    });
  });
});

describe("getInitialSelection", () => {
  test("everything importable opens pre-checked, both groups", () => {
    expect(
      getInitialSelection([snmpHost("10.0.0.1"), pingOnlyHost("10.0.0.2")]),
    ).toEqual({ "10.0.0.1": true, "10.0.0.2": true });
  });

  test("already-registered hosts are not pre-checked", () => {
    expect(
      getInitialSelection([
        snmpHost("10.0.0.1", { isAlreadyRegistered: true }),
        snmpHost("10.0.0.2"),
      ]),
    ).toEqual({ "10.0.0.2": true });
  });

  test("a blank address never becomes a selection key", () => {
    expect(
      getInitialSelection([
        { ipAddress: "", snmpReachable: true },
        snmpHost("10.0.0.2"),
      ]),
    ).toEqual({ "10.0.0.2": true });
  });

  test("an empty scan selects nothing", () => {
    expect(getInitialSelection([])).toEqual({});
  });
});

describe("getDiscoveredHostsToImport", () => {
  const hosts: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    legacyHost("10.0.0.3"),
    pingOnlyHost("10.0.0.4"),
  ];

  test("All imports every selected host", () => {
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: selectAll(hosts),
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
  });

  test("filtering to SNMP imports only the SNMP group, even with everything ticked", () => {
    /*
     * This is issue #3322 in one assertion. The dialog opens with every host
     * pre-checked; if Import ignored the filter, narrowing to SNMP and pressing
     * it would still create the ping-only devices the operator just filtered
     * away — at scan scale, thousands of them.
     */
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.Snmp,
          selectedIpAddresses: selectAll(hosts),
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.3"]);
  });

  test("filtering to No SNMP imports only the ping-only group", () => {
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: selectAll(hosts),
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.4"]);
  });

  test("a host hidden by the filter keeps its tick for later", () => {
    // Filtering is a view, not a deselection — the ticks survive the round trip.
    const selection: Record<string, boolean> = selectAll(hosts);

    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.Snmp,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.3"]);

    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.4"]);
  });

  test("unticked hosts are left behind", () => {
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: { "10.0.0.1": true, "10.0.0.4": false },
        }),
      ),
    ).toEqual(["10.0.0.1"]);
  });

  test("an empty selection imports nothing", () => {
    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual([]);
  });

  test("already-registered hosts are never imported, ticked or not", () => {
    const withRegistered: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1", { isAlreadyRegistered: true }),
      snmpHost("10.0.0.2"),
    ];

    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: withRegistered,
          filter: DiscoveredHostFilter.All,
          // A stale tick, e.g. from an import that happened in another tab.
          selectedIpAddresses: { "10.0.0.1": true, "10.0.0.2": true },
        }),
      ),
    ).toEqual(["10.0.0.2"]);
  });

  test("a blank address is never imported", () => {
    expect(
      getDiscoveredHostsToImport({
        hosts: [{ ipAddress: "", snmpReachable: true }],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { "": true },
      }),
    ).toEqual([]);
  });

  test("a duplicated address imports once, not once per row", () => {
    /*
     * `discoveredDevices` is jsonb written from the probe's payload, and one
     * checkbox is keyed by address — so two rows sharing an address share a
     * tick. Importing both would create two devices from one tick.
     */
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: [
            snmpHost("10.0.0.1"),
            snmpHost("10.0.0.1", { sysName: "same-box-again" }),
            snmpHost("10.0.0.2"),
          ],
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: { "10.0.0.1": true, "10.0.0.2": true },
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  test("the first row of a duplicated address is the one imported", () => {
    const imported: Array<DiscoveredNetworkDevice> = getDiscoveredHostsToImport(
      {
        hosts: [
          snmpHost("10.0.0.1", { sysName: "first" }),
          snmpHost("10.0.0.1", { sysName: "second" }),
        ],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { "10.0.0.1": true },
      },
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]!.sysName).toBe("first");
  });

  test("import order follows the scan, not the selection", () => {
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: {
            "10.0.0.4": true,
            "10.0.0.1": true,
            "10.0.0.3": true,
          },
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.3", "10.0.0.4"]);
  });

  test("the button's count is the import list's length, by construction", () => {
    for (const filter of [
      DiscoveredHostFilter.All,
      DiscoveredHostFilter.Snmp,
      DiscoveredHostFilter.NoSnmp,
    ]) {
      const selection: Record<string, boolean> = selectAll(hosts);

      expect(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: filter,
          selectedIpAddresses: selection,
        }).length,
      ).toBe(
        filterDiscoveredHosts({ hosts: hosts, filter: filter }).filter(
          (host: DiscoveredNetworkDevice) => {
            return isSelectableDiscoveredHost(host);
          },
        ).length,
      );
    }
  });
});

describe("countSelectableShownHosts", () => {
  test("counts only what the current filter shows", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
      pingOnlyHost("10.0.0.3"),
    ];

    expect(
      countSelectableShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(3);
    expect(
      countSelectableShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(1);
    expect(
      countSelectableShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.NoSnmp,
      }),
    ).toBe(2);
  });

  test("already-registered and blank-address hosts do not count", () => {
    expect(
      countSelectableShownHosts({
        hosts: [
          snmpHost("10.0.0.1", { isAlreadyRegistered: true }),
          { ipAddress: "", snmpReachable: true },
          snmpHost("10.0.0.2"),
        ],
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(1);
  });

  test("a duplicated address counts once — one address is one checkbox", () => {
    expect(
      countSelectableShownHosts({
        hosts: [snmpHost("10.0.0.1"), snmpHost("10.0.0.1")],
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(1);
  });

  test("an empty group counts zero", () => {
    expect(
      countSelectableShownHosts({
        hosts: [pingOnlyHost("10.0.0.2")],
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(0);
  });
});

describe("areAllShownHostsSelected", () => {
  const hosts: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
  ];

  test("true when every tickable host on screen is ticked", () => {
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selectAll(hosts),
      }),
    ).toBe(true);
  });

  test("false when one is missing", () => {
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { "10.0.0.1": true },
      }),
    ).toBe(false);
  });

  test("judged per group, so a filtered view can be full while the scan is not", () => {
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: { "10.0.0.1": true },
      }),
    ).toBe(true);
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: { "10.0.0.1": true },
      }),
    ).toBe(false);
  });

  test("false for a group with nothing to select, not vacuously true", () => {
    /*
     * Otherwise the bulk control would read "Clear all" over an empty group and
     * offer to clear a selection that does not exist.
     */
    expect(
      areAllShownHostsSelected({
        hosts: [pingOnlyHost("10.0.0.2")],
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: {},
      }),
    ).toBe(false);
    expect(
      areAllShownHostsSelected({
        hosts: [],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toBe(false);
  });

  test("a group of nothing-but-registered hosts is not 'all selected'", () => {
    expect(
      areAllShownHostsSelected({
        hosts: [snmpHost("10.0.0.1", { isAlreadyRegistered: true })],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { "10.0.0.1": true },
      }),
    ).toBe(false);
  });
});

describe("toggleSelectionForShownHosts", () => {
  const hosts: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    snmpHost("10.0.0.2"),
    pingOnlyHost("10.0.0.3"),
    pingOnlyHost("10.0.0.4"),
  ];

  test("a partly-selected group fills up rather than clearing", () => {
    expect(
      toggleSelectionForShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: { "10.0.0.1": true },
      }),
    ).toEqual({ "10.0.0.1": true, "10.0.0.2": true });
  });

  test("a full group clears", () => {
    expect(
      toggleSelectionForShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: { "10.0.0.1": true, "10.0.0.2": true },
      }),
    ).toEqual({ "10.0.0.1": false, "10.0.0.2": false });
  });

  test("clearing the SNMP group leaves the ping-only ticks alone", () => {
    /*
     * The scenario from the issue: 2,890 pre-checked ping-only hosts you do
     * want and 2,866 SNMP ones you do not (or the other way round). Clearing
     * one group has to be exactly that — clearing one group.
     */
    expect(
      toggleSelectionForShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selectAll(hosts),
      }),
    ).toEqual({
      "10.0.0.1": false,
      "10.0.0.2": false,
      "10.0.0.3": true,
      "10.0.0.4": true,
    });
  });

  test("selecting all is additive across groups", () => {
    const afterSnmp: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.Snmp,
      selectedIpAddresses: {},
    });

    const afterBoth: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.NoSnmp,
      selectedIpAddresses: afterSnmp,
    });

    expect(afterBoth).toEqual({
      "10.0.0.1": true,
      "10.0.0.2": true,
      "10.0.0.3": true,
      "10.0.0.4": true,
    });
  });

  test("All selects everything, then clears everything", () => {
    const selected: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.All,
      selectedIpAddresses: {},
    });

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selected,
      }),
    ).toHaveLength(4);

    const cleared: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.All,
      selectedIpAddresses: selected,
    });

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: cleared,
      }),
    ).toEqual([]);
  });

  test("hosts that cannot be ticked are not given a key", () => {
    expect(
      toggleSelectionForShownHosts({
        hosts: [
          snmpHost("10.0.0.1", { isAlreadyRegistered: true }),
          { ipAddress: "", snmpReachable: true },
          snmpHost("10.0.0.2"),
        ],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual({ "10.0.0.2": true });
  });

  test("a group with nothing to select is left untouched", () => {
    expect(
      toggleSelectionForShownHosts({
        hosts: [pingOnlyHost("10.0.0.3")],
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: { "10.0.0.3": true },
      }),
    ).toEqual({ "10.0.0.3": true });
  });

  test("the caller's selection object is not mutated", () => {
    const selection: Record<string, boolean> = { "10.0.0.1": true };

    toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.All,
      selectedIpAddresses: selection,
    });

    expect(selection).toEqual({ "10.0.0.1": true });
  });
});

describe("the review-and-import flow the filter exists for", () => {
  /*
   * Issue #3322's scan, scaled down but shaped the same: a mixed list, all
   * pre-checked, where the operator wants the switches first and the
   * ICMP-only hosts later — without unchecking anything by hand.
   */
  const scan: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    snmpHost("10.0.0.3", { isAlreadyRegistered: true }),
    pingOnlyHost("10.0.0.4"),
    legacyHost("10.0.0.5"),
  ];

  test("import the SNMP group, then the rest, with no manual unchecking", () => {
    const selection: Record<string, boolean> = getInitialSelection(scan);

    // Narrow to SNMP: the ping-only hosts are out of scope for this press.
    const snmpImport: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: scan,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      });

    expect(ipAddressesOf(snmpImport)).toEqual(["10.0.0.1", "10.0.0.5"]);

    // Those are in now, so they retire from the dialog.
    const afterSnmpImport: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: scan,
        importedIpAddresses: new Set<string>(ipAddressesOf(snmpImport)),
      });

    expect(
      countSelectableShownHosts({
        hosts: afterSnmpImport,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(0);

    // Pressing Import again on the same group would create nothing.
    expect(
      getDiscoveredHostsToImport({
        hosts: afterSnmpImport,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      }),
    ).toEqual([]);

    // The other group is untouched and still ticked.
    const noSnmpImport: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: afterSnmpImport,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: selection,
      });

    expect(ipAddressesOf(noSnmpImport)).toEqual(["10.0.0.2", "10.0.0.4"]);

    // And once it goes in too, there is nothing importable left anywhere.
    const afterBoth: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: scan,
        importedIpAddresses: new Set<string>([
          ...ipAddressesOf(snmpImport),
          ...ipAddressesOf(noSnmpImport),
        ]),
      });

    expect(
      countSelectableShownHosts({
        hosts: afterBoth,
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(0);
  });

  test("take only the ping-only group and drop the switches in one press", () => {
    const cleared: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: scan,
      filter: DiscoveredHostFilter.Snmp,
      selectedIpAddresses: getInitialSelection(scan),
    });

    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: cleared,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.4"]);
  });

  test("a host already in the inventory is offered by neither group", () => {
    for (const filter of [
      DiscoveredHostFilter.All,
      DiscoveredHostFilter.Snmp,
      DiscoveredHostFilter.NoSnmp,
    ]) {
      expect(
        ipAddressesOf(
          getDiscoveredHostsToImport({
            hosts: scan,
            filter: filter,
            selectedIpAddresses: { "10.0.0.3": true },
          }),
        ),
      ).toEqual([]);
    }
  });

  test("group sizes stay put no matter what gets imported or selected", () => {
    /*
     * The badges describe the sweep, not the operator's progress through it.
     * A count that shrank as things were imported would stop matching the
     * probe's own ICMP/SNMP tallies, which is what they get checked against.
     */
    const afterImport: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: scan,
        importedIpAddresses: new Set<string>(["10.0.0.1", "10.0.0.2"]),
      });

    expect(countDiscoveredHosts(afterImport)).toEqual(
      countDiscoveredHosts(scan),
    );
  });
});

describe("hosts at scan scale", () => {
  /*
   * The dialog's job at the size #3322 reports. Nothing here is a performance
   * assertion — it is a correctness one: the arithmetic has to survive four
   * digits, and "select all" has to mean the group, not the scan.
   */
  const snmpCount: number = 2866;
  const pingOnlyCount: number = 2890;

  function bigScan(): Array<DiscoveredNetworkDevice> {
    const hosts: Array<DiscoveredNetworkDevice> = [];

    for (let index: number = 0; index < snmpCount; index++) {
      hosts.push(snmpHost(`10.1.${Math.floor(index / 256)}.${index % 256}`));
    }

    for (let index: number = 0; index < pingOnlyCount; index++) {
      hosts.push(
        pingOnlyHost(`10.2.${Math.floor(index / 256)}.${index % 256}`),
      );
    }

    return hosts;
  }

  test("both groups are counted independently and add up", () => {
    expect(countDiscoveredHosts(bigScan())).toEqual({
      all: snmpCount + pingOnlyCount,
      snmp: snmpCount,
      noSnmp: pingOnlyCount,
    });
  });

  test("importing the SNMP group leaves every ping-only host behind", () => {
    const hosts: Array<DiscoveredNetworkDevice> = bigScan();

    const toImport: Array<DiscoveredNetworkDevice> = getDiscoveredHostsToImport(
      {
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: getInitialSelection(hosts),
      },
    );

    expect(toImport).toHaveLength(snmpCount);
    expect(
      toImport.filter((host: DiscoveredNetworkDevice) => {
        return isPingOnlyDiscoveredHost(host);
      }),
    ).toEqual([]);
  });

  test("one press clears all 2,866 pre-checked SNMP hosts", () => {
    const hosts: Array<DiscoveredNetworkDevice> = bigScan();

    const cleared: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.Snmp,
      selectedIpAddresses: getInitialSelection(hosts),
    });

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: cleared,
      }),
    ).toHaveLength(pingOnlyCount);
  });
});
