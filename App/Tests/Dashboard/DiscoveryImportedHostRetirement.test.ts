import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostFilter,
  ImportedIpAddressesByScanId,
  countDiscoveredHosts,
  countSelectableShownHosts,
  getDiscoveredHostsToImport,
  getImportedIpAddressesForScan,
  getInitialSelection,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  withImportedIpAddresses,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * WHAT THIS FILE GUARDS
 *
 * The Review Discovered Devices dialog decides what is still importable from
 * `isAlreadyRegistered`, and that flag is computed server-side when the probe
 * uploads its results and then FROZEN into the scan's jsonb column. Nothing
 * recomputes it on read. So a host imported sixty seconds ago still reports
 * false: the dialog re-offers it, pre-checked, and the next press of Import
 * creates a SECOND Network Device for the same address. That was survivable
 * when one press imported everything and closed the dialog; importing group by
 * group is the intended flow since #3322, so coming back to a list that still
 * contains what you just imported is now the normal case.
 *
 * The page closes that hole by keeping its own record of what it has imported
 * and overlaying it on the scan — `withImportedIpAddresses` to write,
 * `getImportedIpAddressesForScan` to read, `markDiscoveredHostsAsRegistered`
 * to apply. This file is about that record and the duplicate it exists to
 * prevent: the store's accumulation and immutability, its per-scan keying, and
 * the two operator journeys that depend on both (import one group then the
 * other; close the dialog and reopen the same scan).
 *
 * The record is keyed by scan id rather than being a bare set of addresses for
 * a reason that is not theoretical: importing 2,866 hosts is thousands of
 * sequential creates and runs for minutes, and nothing stops the operator
 * closing the dialog and opening a DIFFERENT scan meanwhile. A bare set
 * written when that run finally lands would mark the other scan's
 * same-addressed hosts "Already added" — disabled, unticked, and silently
 * excluded from its Import. Overlapping addresses across scans are the norm,
 * not the exception: re-sweeping the same /24 next week is what discovery is
 * for.
 *
 * Every failure here renders perfectly. A duplicate device looks exactly like
 * a real one until someone counts them.
 */

/** An SNMP responder: imports as a polled device with the scan's credentials. */
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

/** Answered ping only: imports as a monitor-backed device, no polling. */
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

function ipAddressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice) => {
    return host.ipAddress;
  });
}

/*
 * The list the dialog actually reasons about, assembled exactly the way
 * Discovery.tsx's `getReviewHosts` assembles it: the probe's hosts with this
 * scan's record overlaid. Reading the store and applying it are two functions
 * because they are two different moments, but they are never used apart — so
 * the composition is what these tests exercise.
 */
function reviewHostsFor(data: {
  importedByScanId: ImportedIpAddressesByScanId;
  scanId: string | null | undefined;
  hosts: Array<DiscoveredNetworkDevice>;
}): Array<DiscoveredNetworkDevice> {
  return markDiscoveredHostsAsRegistered({
    hosts: data.hosts,
    importedIpAddresses: getImportedIpAddressesForScan({
      importedByScanId: data.importedByScanId,
      scanId: data.scanId,
    }),
  });
}

describe("getImportedIpAddressesForScan", () => {
  const store: ImportedIpAddressesByScanId = {
    "scan-a": ["10.0.0.1", "10.0.0.3"],
    "scan-b": ["10.0.0.9"],
  };

  test("a scan's entry comes back as exactly the addresses recorded for it", () => {
    expect(
      getImportedIpAddressesForScan({
        importedByScanId: store,
        scanId: "scan-a",
      }),
    ).toEqual(new Set<string>(["10.0.0.1", "10.0.0.3"]));
  });

  test("a scan id the store has never seen reads empty, not as another scan's addresses", () => {
    /*
     * The default answer has to be "nothing has been imported from this scan
     * yet", because that is the state every freshly opened scan is in. Reading
     * anything else here would retire hosts the operator has never touched.
     */
    expect(
      getImportedIpAddressesForScan({
        importedByScanId: store,
        scanId: "scan-never-opened",
      }),
    ).toEqual(new Set<string>());
  });

  test("a null, undefined or empty scan id reads empty rather than reaching for a key", () => {
    /*
     * The page passes `scan?._id`, so undefined is a real value on this path,
     * and an unsaved model yields "". An empty-string key is the dangerous one:
     * if the guard only rejected null/undefined, every scan without an id would
     * share one bucket and retire each other's hosts. The store below has such
     * a key precisely so a weakened guard is caught rather than being a
     * theoretical concern.
     */
    const storeWithBlankKey: ImportedIpAddressesByScanId = {
      ...store,
      "": ["10.0.0.7"],
    };

    for (const scanId of [null, undefined, ""]) {
      expect(
        getImportedIpAddressesForScan({
          importedByScanId: storeWithBlankKey,
          scanId: scanId,
        }),
      ).toEqual(new Set<string>());
    }
  });

  test("the set handed back is a copy, so nothing downstream can corrupt the record", () => {
    /*
     * The record is React state that outlives the dialog. If callers received
     * the live collection, one stray `add` — or a caller building up "what I
     * am about to import" from it — would silently retire hosts across every
     * later read of this scan, with no import having happened.
     */
    const imported: Set<string> = getImportedIpAddressesForScan({
      importedByScanId: store,
      scanId: "scan-a",
    });

    imported.add("10.0.0.99");
    imported.delete("10.0.0.1");

    expect(store["scan-a"]).toEqual(["10.0.0.1", "10.0.0.3"]);
    expect(
      getImportedIpAddressesForScan({
        importedByScanId: store,
        scanId: "scan-a",
      }),
    ).toEqual(new Set<string>(["10.0.0.1", "10.0.0.3"]));
  });
});

describe("withImportedIpAddresses", () => {
  test("the first import of a sitting creates the scan's entry", () => {
    expect(
      withImportedIpAddresses({
        importedByScanId: {},
        scanId: "scan-a",
        ipAddresses: ["10.0.0.1", "10.0.0.3"],
      }),
    ).toEqual({ "scan-a": ["10.0.0.1", "10.0.0.3"] });
  });

  test("a second import accumulates onto the first instead of replacing it", () => {
    /*
     * The whole point of #3322 is importing the SNMP group and then the
     * ping-only group. If the second write replaced the first, the SNMP hosts
     * would come back offered and pre-checked the moment the ping-only import
     * landed — duplicates for the group the operator imported first.
     */
    const afterSnmp: ImportedIpAddressesByScanId = withImportedIpAddresses({
      importedByScanId: {},
      scanId: "scan-a",
      ipAddresses: ["10.0.0.1", "10.0.0.3"],
    });

    expect(
      withImportedIpAddresses({
        importedByScanId: afterSnmp,
        scanId: "scan-a",
        ipAddresses: ["10.0.0.2", "10.0.0.4"],
      }),
    ).toEqual({
      "scan-a": ["10.0.0.1", "10.0.0.3", "10.0.0.2", "10.0.0.4"],
    });
  });

  test("an address recorded twice is stored once", () => {
    /*
     * A retry after a partial failure re-imports some of the same addresses,
     * and the jsonb itself can carry an address twice. The record is a set of
     * what is in the inventory, not a log of attempts.
     */
    expect(
      withImportedIpAddresses({
        importedByScanId: { "scan-a": ["10.0.0.1"] },
        scanId: "scan-a",
        ipAddresses: ["10.0.0.1", "10.0.0.2", "10.0.0.2"],
      }),
    ).toEqual({ "scan-a": ["10.0.0.1", "10.0.0.2"] });
  });

  test("importing nothing returns the very same store object", () => {
    /*
     * Identity, not just equality: this lands in a `useState` setter, and
     * returning a fresh object for a run that created no devices would
     * re-render the dialog — remounting rows whose checkbox seeds its checked
     * state from `initialValue`, i.e. blanking the operator's selection for a
     * frame in exchange for nothing.
     */
    const store: ImportedIpAddressesByScanId = { "scan-a": ["10.0.0.1"] };

    expect(
      withImportedIpAddresses({
        importedByScanId: store,
        scanId: "scan-a",
        ipAddresses: [],
      }),
    ).toBe(store);
  });

  test("a missing or empty scan id records nothing at all", () => {
    /*
     * Same reasoning as the read side: a run that cannot say which scan it
     * belongs to must not write, because the only bucket it could write to is
     * one every other id-less scan would read back.
     */
    const store: ImportedIpAddressesByScanId = { "scan-a": ["10.0.0.1"] };

    for (const scanId of [null, undefined, ""]) {
      expect(
        withImportedIpAddresses({
          importedByScanId: store,
          scanId: scanId,
          ipAddresses: ["10.0.0.5"],
        }),
      ).toBe(store);
    }
  });

  test("writing one scan's addresses leaves every other scan's entry untouched", () => {
    /*
     * This is the keying doing its job at the data level: an import that lands
     * while a different scan is on screen adds a key, it does not disturb one.
     */
    const store: ImportedIpAddressesByScanId = { "scan-a": ["10.0.0.1"] };

    const afterScanB: ImportedIpAddressesByScanId = withImportedIpAddresses({
      importedByScanId: store,
      scanId: "scan-b",
      ipAddresses: ["10.0.0.2"],
    });

    expect(afterScanB["scan-a"]).toEqual(["10.0.0.1"]);
    // The untouched entry is the same array, not a rebuilt copy of it.
    expect(afterScanB["scan-a"]).toBe(store["scan-a"]);
    expect(afterScanB["scan-b"]).toEqual(["10.0.0.2"]);
  });

  test("the store passed in is never mutated", () => {
    /*
     * The page also derives an `importedAfterThisRun` value from the current
     * store while separately handing a functional update to React. If the write
     * mutated in place, those two would be the same object and the "before"
     * view of the store would silently change under whoever still held it.
     */
    const store: ImportedIpAddressesByScanId = { "scan-a": ["10.0.0.1"] };

    withImportedIpAddresses({
      importedByScanId: store,
      scanId: "scan-a",
      ipAddresses: ["10.0.0.2"],
    });
    withImportedIpAddresses({
      importedByScanId: store,
      scanId: "scan-b",
      ipAddresses: ["10.0.0.3"],
    });

    expect(store).toEqual({ "scan-a": ["10.0.0.1"] });
  });
});

describe("applying the record to the scan the dialog renders", () => {
  const scan: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    snmpHost("10.0.0.3"),
  ];

  test("a scan nothing has been imported from renders the identical array", () => {
    /*
     * Identity again, and for the same React reason as the empty write: the
     * overwhelmingly common case is a scan with no record, and rebuilding the
     * list on every render would give the dialog a new array — and new row
     * objects — each time anything at all changed.
     */
    expect(
      reviewHostsFor({
        importedByScanId: { "scan-b": ["10.0.0.1"] },
        scanId: "scan-a",
        hosts: scan,
      }),
    ).toBe(scan);
  });

  test("a host in the record loses its checkbox and drops out of what Import would create", () => {
    const reviewHosts: Array<DiscoveredNetworkDevice> = reviewHostsFor({
      importedByScanId: { "scan-a": ["10.0.0.1"] },
      scanId: "scan-a",
      hosts: scan,
    });

    expect(reviewHosts[0]!.isAlreadyRegistered).toBe(true);
    expect(isSelectableDiscoveredHost(reviewHosts[0]!)).toBe(false);

    /*
     * The stale tick is the realistic state, not a contrived one: the address
     * was ticked when the dialog opened and nothing unticks it on success — the
     * overlay is what stops that tick meaning anything.
     */
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: reviewHosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: getInitialSelection(scan),
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.3"]);

    expect(
      countSelectableShownHosts({
        hosts: reviewHosts,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(1);
  });

  test("the group badges do not move as hosts are imported", () => {
    /*
     * The badge answers "how big is this group", which is how the number gets
     * checked against the probe's own ICMP/SNMP tallies — it describes the
     * sweep, not the operator's progress through it. Marking must therefore
     * change selectability and nothing else about where a row belongs.
     */
    const reviewHosts: Array<DiscoveredNetworkDevice> = reviewHostsFor({
      importedByScanId: { "scan-a": ["10.0.0.1", "10.0.0.2"] },
      scanId: "scan-a",
      hosts: scan,
    });

    expect(countDiscoveredHosts(reviewHosts)).toEqual({
      all: 3,
      snmp: 2,
      noSnmp: 1,
    });
  });

  test("the scan's own host objects are never written to", () => {
    /*
     * `scan` here stands in for the jsonb the model handed the page. The
     * overlay is the page's opinion about this sitting, so it has to live in
     * copies — otherwise the flag leaks into anything else reading the same
     * model instance, including another scan's rows in the table behind the
     * dialog.
     */
    reviewHostsFor({
      importedByScanId: { "scan-a": ["10.0.0.1", "10.0.0.3"] },
      scanId: "scan-a",
      hosts: scan,
    });

    expect(scan[0]!.isAlreadyRegistered).toBeUndefined();
    expect(scan[2]!.isAlreadyRegistered).toBeUndefined();
  });
});

describe("one scan's imports never retire another scan's hosts", () => {
  /*
   * Two sweeps of the same subnet, a week apart, sharing an address — the
   * ordinary case rather than a contrived one. The scenario the keying exists
   * for: the operator imports 10.0.0.1 from scan A, closes the dialog while
   * the run is still going, and opens scan B.
   */
  const sharedAddress: string = "10.0.0.1";

  const scanAHosts: Array<DiscoveredNetworkDevice> = [
    snmpHost(sharedAddress),
    snmpHost("10.0.0.2"),
  ];

  const scanBHosts: Array<DiscoveredNetworkDevice> = [
    snmpHost(sharedAddress),
    pingOnlyHost("10.0.0.8"),
  ];

  test("importing a shared address from scan A leaves it importable in scan B", () => {
    const store: ImportedIpAddressesByScanId = withImportedIpAddresses({
      importedByScanId: {},
      scanId: "scan-a",
      ipAddresses: [sharedAddress],
    });

    // Retired where it was actually imported from.
    expect(
      isSelectableDiscoveredHost(
        reviewHostsFor({
          importedByScanId: store,
          scanId: "scan-a",
          hosts: scanAHosts,
        })[0]!,
      ),
    ).toBe(false);

    /*
     * And offered, ticked, and imported where it was not. A bare set would fail
     * every assertion below — the host would render disabled and Import would
     * quietly skip it, with nothing on screen explaining why.
     */
    const scanBReviewHosts: Array<DiscoveredNetworkDevice> = reviewHostsFor({
      importedByScanId: store,
      scanId: "scan-b",
      hosts: scanBHosts,
    });

    expect(isSelectableDiscoveredHost(scanBReviewHosts[0]!)).toBe(true);
    expect(getInitialSelection(scanBReviewHosts)).toEqual({
      "10.0.0.1": true,
      "10.0.0.8": true,
    });
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: scanBReviewHosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: getInitialSelection(scanBReviewHosts),
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.8"]);
  });

  test("an address imported from both scans is recorded once under each", () => {
    /*
     * Importing the same address from two scans really does create two devices
     * — that is a server-side question about hostnames, not this record's. What
     * the record must not do is conflate the two: each scan's dialog reports on
     * what was imported from it.
     */
    const afterA: ImportedIpAddressesByScanId = withImportedIpAddresses({
      importedByScanId: {},
      scanId: "scan-a",
      ipAddresses: [sharedAddress],
    });

    const afterB: ImportedIpAddressesByScanId = withImportedIpAddresses({
      importedByScanId: afterA,
      scanId: "scan-b",
      ipAddresses: [sharedAddress, "10.0.0.8"],
    });

    expect(afterB).toEqual({
      "scan-a": ["10.0.0.1"],
      "scan-b": ["10.0.0.1", "10.0.0.8"],
    });
    expect(
      countSelectableShownHosts({
        hosts: reviewHostsFor({
          importedByScanId: afterB,
          scanId: "scan-b",
          hosts: scanBHosts,
        }),
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(0);
  });
});

describe("the two-pass import an operator actually performs", () => {
  /*
   * Issue #3322's flow, scaled down and shaped the same: switches first,
   * endpoints after, with the record carrying what happened between the two
   * presses. Nothing is unticked by hand at any point.
   */
  const scanId: string = "scan-a";

  const scan: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    snmpHost("10.0.0.3"),
    pingOnlyHost("10.0.0.4"),
  ];

  test("import the SNMP group, then the ping-only group, with no duplicates in between", () => {
    // The dialog opens with everything importable ticked.
    const selection: Record<string, boolean> = getInitialSelection(
      reviewHostsFor({ importedByScanId: {}, scanId: scanId, hosts: scan }),
    );

    expect(selection).toEqual({
      "10.0.0.1": true,
      "10.0.0.2": true,
      "10.0.0.3": true,
      "10.0.0.4": true,
    });

    // Narrow to SNMP and press Import: the ping-only hosts are out of scope.
    const snmpImport: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: reviewHostsFor({
          importedByScanId: {},
          scanId: scanId,
          hosts: scan,
        }),
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      });

    expect(ipAddressesOf(snmpImport)).toEqual(["10.0.0.1", "10.0.0.3"]);

    const afterSnmpStore: ImportedIpAddressesByScanId = withImportedIpAddresses(
      {
        importedByScanId: {},
        scanId: scanId,
        ipAddresses: ipAddressesOf(snmpImport),
      },
    );

    expect(afterSnmpStore).toEqual({ "scan-a": ["10.0.0.1", "10.0.0.3"] });

    const afterSnmp: Array<DiscoveredNetworkDevice> = reviewHostsFor({
      importedByScanId: afterSnmpStore,
      scanId: scanId,
      hosts: scan,
    });

    /*
     * The group is spent. Both of these matter: the count is what disables the
     * bulk control and what the submit button shows, and the import list is
     * what a second press would actually create. Every tick is still set, so
     * without the record that second press creates two more devices.
     */
    expect(
      countSelectableShownHosts({
        hosts: afterSnmp,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(0);
    expect(
      getDiscoveredHostsToImport({
        hosts: afterSnmp,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      }),
    ).toEqual([]);

    // The badges still describe the sweep, not what is left of it.
    expect(countDiscoveredHosts(afterSnmp)).toEqual({
      all: 4,
      snmp: 2,
      noSnmp: 2,
    });

    // The other group is untouched, still ticked, still fully importable.
    const noSnmpImport: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: afterSnmp,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: selection,
      });

    expect(ipAddressesOf(noSnmpImport)).toEqual(["10.0.0.2", "10.0.0.4"]);
    expect(
      countSelectableShownHosts({
        hosts: afterSnmp,
        filter: DiscoveredHostFilter.NoSnmp,
      }),
    ).toBe(2);

    const afterBothStore: ImportedIpAddressesByScanId = withImportedIpAddresses(
      {
        importedByScanId: afterSnmpStore,
        scanId: scanId,
        ipAddresses: ipAddressesOf(noSnmpImport),
      },
    );

    expect(afterBothStore).toEqual({
      "scan-a": ["10.0.0.1", "10.0.0.3", "10.0.0.2", "10.0.0.4"],
    });

    // Nothing importable is left anywhere in the scan.
    const afterBoth: Array<DiscoveredNetworkDevice> = reviewHostsFor({
      importedByScanId: afterBothStore,
      scanId: scanId,
      hosts: scan,
    });

    expect(
      countSelectableShownHosts({
        hosts: afterBoth,
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(0);
    expect(
      getDiscoveredHostsToImport({
        hosts: afterBoth,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selection,
      }),
    ).toEqual([]);
  });
});

describe("reopening a scan after importing from it", () => {
  /*
   * The record is kept for the life of the PAGE, not the life of the dialog,
   * and this is why: `closeReviewModal` throws away the selection, so reopening
   * re-derives it from scratch. If that derivation did not run through the
   * overlay, every host imported a moment ago would come back ticked and the
   * next press would duplicate all of them.
   */
  const scan: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.0.0.1"),
    pingOnlyHost("10.0.0.2"),
    snmpHost("10.0.0.3"),
  ];

  test("the opening selection does not re-tick what was already imported", () => {
    const store: ImportedIpAddressesByScanId = {
      "scan-a": ["10.0.0.1", "10.0.0.3"],
    };

    expect(
      getInitialSelection(
        reviewHostsFor({
          importedByScanId: store,
          scanId: "scan-a",
          hosts: scan,
        }),
      ),
    ).toEqual({ "10.0.0.2": true });
  });

  test("a scan with no id yet still opens with everything ticked", () => {
    /*
     * The page reads `scan?._id`, so undefined reaches the store on this path.
     * Degrading to "nothing has been imported" is the safe direction: the
     * operator is shown the whole scan as importable, which is what a scan the
     * record cannot describe actually is.
     */
    expect(
      getInitialSelection(
        reviewHostsFor({
          importedByScanId: { "scan-a": ["10.0.0.1"] },
          scanId: undefined,
          hosts: scan,
        }),
      ),
    ).toEqual({ "10.0.0.1": true, "10.0.0.2": true, "10.0.0.3": true });
  });
});
