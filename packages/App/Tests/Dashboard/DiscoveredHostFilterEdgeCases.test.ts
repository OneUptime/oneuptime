import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostCounts,
  DiscoveredHostFilter,
  DiscoveredHostFilterOption,
  ImportedIpAddressesByScanId,
  ShownDiscoveredHost,
  areAllShownHostsSelected,
  countDiscoveredHosts,
  countSelectableShownHosts,
  filterDiscoveredHosts,
  getDiscoveredHostFilterEmptyMessage,
  getDiscoveredHostFilterLabel,
  getDiscoveredHostFilterOptions,
  getDiscoveredHostsToImport,
  getImportedIpAddressesForScan,
  getInitialSelection,
  getShownDiscoveredHosts,
  isPingOnlyDiscoveredHost,
  isSelectableDiscoveredHost,
  markDiscoveredHostsAsRegistered,
  matchesDiscoveredHostFilter,
  normalizeDiscoveredHosts,
  toggleSelectionForShownHosts,
  withImportedIpAddresses,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * WHY THIS FILE EXISTS
 *
 * DiscoveredHostFilter.test.ts covers the rules with rows that look like the
 * interface says they will. This file is the other half: what the same rules
 * do when the rows do NOT.
 *
 * They often will not. `discoveredDevices` is a jsonb column written verbatim
 * from whatever a probe uploaded — no column type checks the shape of an
 * element, no migration has ever rewritten one, and rows written by probes of
 * every vintage sit in the same array. `DiscoveredNetworkDevice` is a
 * compile-time story about that array, not a runtime guarantee, and every
 * function here is handed the array with a cast. So `null` elements, a
 * `snmpReachable` that arrived as the STRING "false", an `ipAddress` that is a
 * number, and an address that happens to spell "constructor" are all inputs
 * the dialog can actually receive.
 *
 * The point of pinning them is that the two ways this feature fails are both
 * silent. Either the modal body throws while rendering (a dialog that opens
 * blank, with the scan still listed as having results), or the wrong hosts
 * import — and an import is thousands of sequential creates that no one is
 * going to undo by hand.
 *
 * Every expectation below is the CURRENT behaviour, verified against the
 * implementation, not the behaviour anyone would have designed. Where the
 * current behaviour is wrong, the test still asserts it and the comment says
 * so in the words "SUSPECTED DEFECT" — a red test left behind for a bug the
 * author of this file cannot fix is worth nothing to the next person.
 */

const FILTER_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "NetworkDevice",
  "DiscoveredHostFilter.ts",
);

/*
 * A row the jsonb can hold but the interface says it cannot. Written as one
 * named helper rather than a cast at every call site so that "this value is
 * deliberately the wrong shape" is visible in the test, instead of reading as
 * a type error someone silenced.
 */
function junkRow(value: unknown): DiscoveredNetworkDevice {
  return value as DiscoveredNetworkDevice;
}

/** Junk rows as a scan array. */
function junkScan(values: Array<unknown>): Array<DiscoveredNetworkDevice> {
  return values.map((value: unknown) => {
    return junkRow(value);
  });
}

function snmpHost(ipAddress: string): DiscoveredNetworkDevice {
  return { ipAddress: ipAddress, snmpReachable: true };
}

function pingOnlyHost(ipAddress: string): DiscoveredNetworkDevice {
  return { ipAddress: ipAddress, snmpReachable: false };
}

function ipAddressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice) => {
    return host.ipAddress;
  });
}

/** Every filter, for the assertions that have to hold under all three. */
const ALL_FILTERS: Array<DiscoveredHostFilter> = [
  DiscoveredHostFilter.All,
  DiscoveredHostFilter.Snmp,
  DiscoveredHostFilter.NoSnmp,
];

describe("scan rows that are not objects at all", () => {
  test("a number, a string or an empty object is grouped as SNMP rather than skipped", () => {
    /*
     * `monitoringMethodForDiscoveredHost` asks only whether `snmpReachable` is
     * exactly `false`. On a primitive or a shapeless object that property is
     * undefined, which is the legacy answer, which means SNMP. Nothing skips
     * the row: it stays in the list, it is counted, and the badge under it
     * says SNMP. That is the tolerable outcome of the two available — the
     * alternative, dropping rows the operator can see in the scan's own host
     * count, would make the dialog disagree with the page that opened it.
     */
    const rows: Array<DiscoveredNetworkDevice> = junkScan([
      42,
      "10.0.0.1",
      {},
      { sysName: "no-address-at-all" },
    ]);

    for (const row of rows) {
      expect(isPingOnlyDiscoveredHost(row)).toBe(false);
    }

    expect(countDiscoveredHosts(rows)).toEqual({ all: 4, snmp: 4, noSnmp: 0 });
  });

  test("a null or undefined row reads as SNMP instead of taking the page down", () => {
    /*
     * `null` is a legal jsonb array element and nothing on the read path used
     * to filter one out — `DiscoveryScanOutcome.getDiscoveredHosts` guards the
     * ARRAY, not its elements. Every grouping call then dereferenced the row
     * and died with a TypeError, and not the survivable kind: it happened
     * inside the modal body during render, on the operator's first click of a
     * filter button, on a scan the page had already advertised as having
     * results.
     *
     * A nullish row now answers the same way every other kind of junk element
     * already did — "no explicit snmpReachable, therefore SNMP" — so one bad
     * row costs one wrong-looking row rather than the whole dialog.
     */
    for (const row of junkScan([null, undefined])) {
      expect(isPingOnlyDiscoveredHost(row)).toBe(false);

      expect(countDiscoveredHosts([row])).toEqual({
        all: 1,
        snmp: 1,
        noSnmp: 0,
      });

      expect(
        filterDiscoveredHosts({
          hosts: [row],
          filter: DiscoveredHostFilter.Snmp,
        }),
      ).toHaveLength(1);

      expect(
        getShownDiscoveredHosts({
          hosts: [row],
          filter: DiscoveredHostFilter.NoSnmp,
        }),
      ).toHaveLength(0);
    }
  });

  test("normalising drops nullish rows entirely, so the dialog never renders one", () => {
    /*
     * The predicates surviving a null row is the safety net; this is the
     * actual fix. Discovery.tsx runs every scan through
     * normalizeDiscoveredHosts before anything else reads it, so a nullish
     * row never reaches a badge, a checkbox or the import list at all.
     */
    const rows: Array<DiscoveredNetworkDevice> = junkScan([
      null,
      undefined,
      { ipAddress: "10.0.0.1", snmpReachable: true },
    ]);

    const normalized: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(rows);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.ipAddress).toBe("10.0.0.1");
    expect(countDiscoveredHosts(normalized)).toEqual({
      all: 1,
      snmp: 1,
      noSnmp: 0,
    });
  });

  test("the All filter never reads a row, so junk reaches the list intact", () => {
    /*
     * `matchesDiscoveredHostFilter` returns true for All before touching the
     * host, so the default view of a scan carrying a null row renders it and
     * only blows up when the operator clicks SNMP or No SNMP. Worth pinning
     * precisely because it makes the crash above look like a filter bug: the
     * dialog opened fine, one click killed it.
     */
    const rows: Array<DiscoveredNetworkDevice> = junkScan([null, undefined, 7]);

    for (const row of rows) {
      expect(
        matchesDiscoveredHostFilter({
          host: row,
          filter: DiscoveredHostFilter.All,
        }),
      ).toBe(true);
    }

    expect(
      filterDiscoveredHosts({ hosts: rows, filter: DiscoveredHostFilter.All }),
    ).toHaveLength(3);
  });

  test("selection and import refuse a null row instead of dying on it", () => {
    /*
     * These three read `ipAddress`, so unlike the filter they never had the
     * All short-circuit: a scan with one null row could not compute its
     * opening selection at all, which is the dialog's initial render path —
     * the modal did not open wrong, it did not open.
     *
     * A nullish row is now simply not selectable, which is the honest answer:
     * there is no address to import it under.
     */
    const rows: Array<DiscoveredNetworkDevice> = junkScan([null]);

    expect(isSelectableDiscoveredHost(rows[0]!)).toBe(false);
    expect(getInitialSelection(rows)).toEqual({});
    expect(
      getDiscoveredHostsToImport({
        hosts: rows,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual([]);
    expect(
      markDiscoveredHostsAsRegistered({
        hosts: rows,
        importedIpAddresses: new Set<string>(["10.0.0.1"]),
      }),
    ).toEqual(rows);
  });
  test("a shown row carries its unfiltered scan position, junk rows included", () => {
    /*
     * `scanIndex` is what the dialog builds its React key from, and it has to
     * be the position in the WHOLE scan: taking it from the filtered array
     * would move it on every filter click, remounting rows whose checkbox
     * seeds from `initialValue` and repainting them unchecked for a frame.
     * Junk rows do not get to opt out of that — they occupy a scan position
     * like anything else, and the rows after them must not shift up.
     */
    const rows: Array<DiscoveredNetworkDevice> = junkScan([
      42,
      pingOnlyHost("10.0.0.2"),
      {},
      snmpHost("10.0.0.4"),
    ]);

    const shown: Array<ShownDiscoveredHost> = getShownDiscoveredHosts({
      hosts: rows,
      filter: DiscoveredHostFilter.Snmp,
    });

    expect(
      shown.map((entry: ShownDiscoveredHost) => {
        return entry.scanIndex;
      }),
    ).toEqual([0, 2, 3]);

    expect(shown[0]!.host).toBe(rows[0]);
  });
});

describe("fields that are not the type the interface promises", () => {
  test("snmpReachable arriving as the string 'false' reads as SNMP", () => {
    /*
     * SUSPECTED DEFECT (wire format, reported).
     *
     * The comparison is `=== false`, so any non-boolean falls through to the
     * legacy branch and means SNMP. A probe (or a proxy, or a hand-edited row)
     * that serialised the flag as the string "false" therefore puts a
     * ping-only host in the SNMP group — where it is hidden from the No SNMP
     * filter, counted on the SNMP badge, and imported as a POLLED device
     * carrying the scan's credentials against a box that never answered a
     * walk. The device then sits permanently unreachable in the inventory.
     *
     * "false" is singled out because it is the one junk value that is both
     * plausible on the wire and truthy in JavaScript, so the usual
     * `!host.snmpReachable` reflex would not have caught it either.
     */
    const host: DiscoveredNetworkDevice = junkRow({
      ipAddress: "10.0.0.7",
      snmpReachable: "false",
    });

    expect(isPingOnlyDiscoveredHost(host)).toBe(false);
    expect(
      matchesDiscoveredHostFilter({
        host: host,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toBe(true);
    expect(countDiscoveredHosts([host])).toEqual({
      all: 1,
      snmp: 1,
      noSnmp: 0,
    });
  });

  test("isAlreadyRegistered is judged by truthiness, not by being exactly true", () => {
    /*
     * `!host.isAlreadyRegistered` means a falsy non-boolean (0, "") reads as
     * "not registered yet" and the row stays tickable, while a truthy
     * non-boolean (1, or the string "no", which is truthy however it reads to
     * a human) retires the row.
     *
     * The 0 / "" direction is harmless-to-useful: those are what "not
     * registered" serialises to. The "no" direction is the dangerous one — it
     * disables a host the operator can see and wants, with a row that says
     * "Already added" about a device that is not.
     */
    expect(
      isSelectableDiscoveredHost(
        junkRow({ ipAddress: "10.0.0.1", isAlreadyRegistered: 0 }),
      ),
    ).toBe(true);
    expect(
      isSelectableDiscoveredHost(
        junkRow({ ipAddress: "10.0.0.2", isAlreadyRegistered: "" }),
      ),
    ).toBe(true);
    expect(
      isSelectableDiscoveredHost(
        junkRow({ ipAddress: "10.0.0.3", isAlreadyRegistered: 1 }),
      ),
    ).toBe(false);
    expect(
      isSelectableDiscoveredHost(
        junkRow({ ipAddress: "10.0.0.4", isAlreadyRegistered: "no" }),
      ),
    ).toBe(false);
  });

  test("a numeric ipAddress is selectable and keys the selection as a string", () => {
    /*
     * `Boolean(10)` is true, so a numeric address passes the "has an address"
     * gate, and `selection[host.ipAddress] = true` stringifies the key on the
     * way in. Reading it back out stringifies too, so selection and import
     * agree with each other and the host is importable under a "10" key.
     *
     * Pinned rather than left implicit because the consistency here is what
     * makes the mismatch in the next test surprising.
     */
    const hosts: Array<DiscoveredNetworkDevice> = junkScan([{ ipAddress: 10 }]);

    expect(isSelectableDiscoveredHost(hosts[0]!)).toBe(true);
    expect(getInitialSelection(hosts)).toEqual({ "10": true });
    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { "10": true },
      }),
    ).toHaveLength(1);
  });

  test("a numeric ipAddress is retired like any other, so it cannot import twice", () => {
    /*
     * Everything else on this path goes through object-key stringification;
     * `markDiscoveredHostsAsRegistered` goes through `Set.has`, which uses
     * SameValueZero and does not. So the address the page recorded after an
     * import — the string it read out of the selection — never matched the
     * number on the row, and the host came back still tickable and still
     * pre-checked.
     *
     * That was the exact duplicate-creation loop the overlay exists to close:
     * `isAlreadyRegistered` is frozen into the jsonb at probe-upload time, so
     * the overlay is the only thing standing between "import, come back to the
     * group, press again" and a second Network Device for the same host. The
     * lookup is stringified now, and normalisation stringifies the row itself
     * before the dialog ever sees it.
     */
    const hosts: Array<DiscoveredNetworkDevice> = junkScan([{ ipAddress: 10 }]);

    const marked: Array<DiscoveredNetworkDevice> =
      markDiscoveredHostsAsRegistered({
        hosts: hosts,
        importedIpAddresses: new Set<string>(["10"]),
      });

    expect(marked[0]!.isAlreadyRegistered).toBe(true);
    expect(isSelectableDiscoveredHost(marked[0]!)).toBe(false);

    // And the row reaches the dialog as a string in the first place.
    expect(normalizeDiscoveredHosts(hosts)[0]!.ipAddress).toBe("10");
  });
  test("neither an empty address nor a whitespace-only one is selectable", () => {
    /*
     * The gate used to be `Boolean(host.ipAddress)`, and " " is a perfectly
     * truthy string — so a row whose address was a single space was tickable,
     * pre-checked and importable, and because the address is also the imported
     * device's hostname it created a Network Device called " ".
     */
    expect(isSelectableDiscoveredHost(junkRow({ ipAddress: "" }))).toBe(false);
    expect(isSelectableDiscoveredHost(junkRow({ ipAddress: " " }))).toBe(false);
    expect(isSelectableDiscoveredHost(junkRow({ ipAddress: "\t\n " }))).toBe(
      false,
    );

    const hosts: Array<DiscoveredNetworkDevice> = junkScan([
      { ipAddress: " " },
    ]);

    expect(getInitialSelection(hosts)).toEqual({});
    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: { " ": true },
      }),
    ).toEqual([]);

    // Normalisation collapses it to the empty address it actually is.
    expect(normalizeDiscoveredHosts(hosts)[0]!.ipAddress).toBe("");
  });
  test("addresses are compared raw — no normalisation, no case folding, no length cap", () => {
    /*
     * A reader coming to this file may assume the dedup in
     * `getDiscoveredHostsToImport` understands addresses. It does not: the key
     * is the literal string. "10.0.0.1" and "010.0.0.1" name the same host to
     * every resolver on earth and are two independent checkboxes here; so are
     * the two casings of an IPv6 address, which is worse, because RFC 5952
     * lower-cases and plenty of gear does not.
     *
     * The consequence is duplicate devices for one host, from one press, with
     * both boxes ticked by default. Pinned as current behaviour so that adding
     * canonicalisation later is a deliberate change with a test to update,
     * rather than something someone assumes is already there.
     */
    const longAddress: string = "9".repeat(300);

    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      snmpHost("010.0.0.1"),
      snmpHost("FE80::1"),
      snmpHost("fe80::1"),
      snmpHost(longAddress),
    ];

    expect(Object.keys(getInitialSelection(hosts))).toEqual([
      "10.0.0.1",
      "010.0.0.1",
      "FE80::1",
      "fe80::1",
      longAddress,
    ]);

    expect(
      countSelectableShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(5);

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: getInitialSelection(hosts),
      }),
    ).toHaveLength(5);
  });
});

describe("addresses that collide with Object.prototype", () => {
  test("an UNTICKED host named toString or constructor stays out of the import", () => {
    /*
     * The selection is a plain object literal, and the tick test used to be a
     * bare `data.selectedIpAddresses[host.ipAddress]`. For an address that
     * spells an inherited key, that lookup walks the prototype chain and finds
     * a truthy function, so the host read as ticked no matter what the
     * operator did — below, the selection is `{}`, nothing has ever been
     * ticked, and every one of these hosts used to import.
     *
     * `ipAddress` is a probe-supplied string used as an object key with no
     * validation anywhere on the path, so this was reachable by a malformed or
     * hostile payload rather than only by a typo, and it made the one
     * invariant the whole feature rests on — "Import imports what is ticked" —
     * simply false for these names. `isSelectedIpAddress` now asks for an OWN
     * property.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("toString"),
      snmpHost("constructor"),
      snmpHost("valueOf"),
      snmpHost("hasOwnProperty"),
    ];

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual([]);

    // And a real tick on such a name still works.
    expect(
      ipAddressesOf(
        getDiscoveredHostsToImport({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: { toString: true },
        }),
      ),
    ).toEqual(["toString"]);
  });
  test("a host named __proto__ cannot be ticked, and is therefore not imported", () => {
    /*
     * The same root cause with the opposite symptom, which is why it is a
     * separate test. Assigning `selection["__proto__"] = true` on a plain
     * object does not create a property; it invokes the prototype setter,
     * which ignores a primitive. So `getInitialSelection` and
     * `toggleSelectionForShownHosts` both come back with no key for this host
     * — it cannot be recorded as ticked by any means the dialog offers.
     *
     * Reading it back used to yield `Object.prototype`, which is truthy, so it
     * imported anyway: a host impossible to select, impossible to deselect,
     * and imported regardless. With an own-property check the two halves agree
     * — it cannot be ticked, so it is not imported, which is the safe
     * direction for a host nobody can express an opinion about.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [snmpHost("__proto__")];

    expect(Object.keys(getInitialSelection(hosts))).toEqual([]);
    expect(
      Object.keys(
        toggleSelectionForShownHosts({
          hosts: hosts,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: {},
        }),
      ),
    ).toEqual([]);

    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual([]);
  });
  test("a prototype-named host does not make the bulk control claim the view is full", () => {
    /*
     * The third distinct symptom. `areAllShownHostsSelected` compares the
     * import list's length against the selectable count, and the import list
     * used to be inflated by the phantom tick above — so with an empty
     * selection the two matched and the control rendered "Clear all" over a
     * view where nothing was checked. Pressing it wrote `false` for every
     * shown host, which on a real scan would have cleared the operator's
     * actual ticks on every other row.
     */
    expect(
      areAllShownHostsSelected({
        hosts: [snmpHost("toString")],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toBe(false);

    // One press selects it, as it would any other host.
    expect(
      toggleSelectionForShownHosts({
        hosts: [snmpHost("toString")],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual({ toString: true });
  });
  test("a scan id colliding with Object.prototype reads as an empty record", () => {
    /*
     * The same unguarded index, one layer up.
     * `importedByScanId[scanId] || []` finds an inherited member for these
     * names, and a function or an object is truthy, so the `|| []` fallback
     * never ran and the Set construction died on a non-iterable. Far less
     * reachable than the address case (a scan id is an ObjectID today), but it
     * is the same missing own-property check, it lives in the state the dialog
     * reads on every open, and a throw there took the page with it.
     */
    for (const scanId of ["toString", "constructor", "__proto__"]) {
      expect(
        getImportedIpAddressesForScan({
          importedByScanId: {},
          scanId: scanId,
        }),
      ).toEqual(new Set<string>());

      /*
       * "__proto__" is the one that still cannot be stored: writing that key
       * on an object literal runs the prototype setter. It reads back empty
       * rather than throwing, which costs a re-offered host on reopen — the
       * pre-existing footgun — instead of a blank page.
       */
      const stored: ImportedIpAddressesByScanId = withImportedIpAddresses({
        importedByScanId: {},
        scanId: scanId,
        ipAddresses: ["10.0.0.1"],
      });

      expect(
        getImportedIpAddressesForScan({
          importedByScanId: stored,
          scanId: scanId,
        }),
      ).toEqual(
        scanId === "__proto__"
          ? new Set<string>()
          : new Set<string>(["10.0.0.1"]),
      );
    }
  });
  test("an empty scan renders its own sentence and disturbs nothing", () => {
    /*
     * The All message is deliberately not built from the filter label: "No " +
     * "No SNMP" produced "No No SNMP hosts in this scan.", and a group of zero
     * is one click away on any single-group sweep. Asserting the three exact
     * strings is what stops that from being re-derived.
     *
     * The rest of the test is that an empty scan is inert: a selection carried
     * in from a previous scan comes back untouched rather than being cleared
     * by a view that shows nothing.
     */
    expect(getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.All)).toBe(
      "This scan did not find any responding hosts.",
    );
    expect(getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.Snmp)).toBe(
      "No host in this scan answered SNMP.",
    );
    expect(
      getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.NoSnmp),
    ).toBe("Every host in this scan answered SNMP.");

    const carriedOver: Record<string, boolean> = { "10.0.0.1": true };

    for (const filter of ALL_FILTERS) {
      expect(getShownDiscoveredHosts({ hosts: [], filter: filter })).toEqual(
        [],
      );
      expect(
        toggleSelectionForShownHosts({
          hosts: [],
          filter: filter,
          selectedIpAddresses: carriedOver,
        }),
      ).toEqual({ "10.0.0.1": true });
    }

    expect(
      markDiscoveredHostsAsRegistered({
        hosts: [],
        importedIpAddresses: new Set<string>(["10.0.0.1"]),
      }),
    ).toEqual([]);
  });

  test("a one-host scan opens already full and empties in a single press", () => {
    /*
     * The boundary either side of the "false for an empty view" rule: at
     * exactly one selectable host the view IS full the moment it opens, so the
     * control has to read "Clear all" and one press has to leave nothing
     * importable. An off-by-one in the zero guard shows up here and nowhere
     * else.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [snmpHost("10.0.0.1")];
    const selection: Record<string, boolean> = getInitialSelection(hosts);

    expect(
      countSelectableShownHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
      }),
    ).toBe(1);
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selection,
      }),
    ).toBe(true);

    const cleared: Record<string, boolean> = toggleSelectionForShownHosts({
      hosts: hosts,
      filter: DiscoveredHostFilter.All,
      selectedIpAddresses: selection,
    });

    expect(cleared).toEqual({ "10.0.0.1": false });
    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: cleared,
      }),
    ).toEqual([]);
  });

  test("a scan of nothing but blank addresses still counts every row", () => {
    /*
     * The badge is a group size, checked against the probe's own ICMP/SNMP
     * tallies, so rows that cannot be imported are still counted — otherwise
     * the two numbers disagree for a reason the badge cannot show. Everything
     * downstream of the badge disagrees with it on purpose: nothing is
     * selectable, nothing imports, the bulk control stays off, and no "" key
     * is ever written into the selection.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [
      { ipAddress: "", snmpReachable: true },
      { ipAddress: "", snmpReachable: false },
    ];

    expect(countDiscoveredHosts(hosts)).toEqual({ all: 2, snmp: 1, noSnmp: 1 });

    for (const filter of ALL_FILTERS) {
      expect(countSelectableShownHosts({ hosts: hosts, filter: filter })).toBe(
        0,
      );
      expect(
        areAllShownHostsSelected({
          hosts: hosts,
          filter: filter,
          selectedIpAddresses: { "": true },
        }),
      ).toBe(false);
      expect(
        toggleSelectionForShownHosts({
          hosts: hosts,
          filter: filter,
          selectedIpAddresses: {},
        }),
      ).toEqual({});
    }

    expect(getInitialSelection(hosts)).toEqual({});
  });

  test("a sweep where nothing answered SNMP leaves that group empty and says so", () => {
    /*
     * The single-group sweep in the direction #3322 actually reports: 2,890
     * ICMP-only hosts and no switches. The SNMP button still has to render its
     * zero — "SNMP (0)" is the answer to "did this sweep find any gear at
     * all", and a button that hid the zero would look identical to one with
     * results behind it — and clicking it has to produce a sentence rather
     * than an empty box.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [
      pingOnlyHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
      pingOnlyHost("10.0.0.3"),
    ];

    expect(
      getDiscoveredHostFilterOptions(hosts).map(
        (option: DiscoveredHostFilterOption) => {
          return option.label;
        },
      ),
    ).toEqual(["All (3)", "SNMP (0)", "No SNMP (3)"]);

    expect(
      filterDiscoveredHosts({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
      }),
    ).toEqual([]);
    expect(
      areAllShownHostsSelected({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: getInitialSelection(hosts),
      }),
    ).toBe(false);
    expect(getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.Snmp)).toBe(
      "No host in this scan answered SNMP.",
    );
  });

  test("a sweep of nothing but legacy rows lands entirely in the SNMP group", () => {
    /*
     * A scan stored before `snmpReachable` existed: every row carries
     * undefined, and every host on those scans answered SNMP because ping-only
     * sweeps did not exist yet. Reading undefined as ping-only would move an
     * entire historical scan into the No SNMP group and re-import real
     * switches as monitor-backed devices with no polling at all — the whole
     * reason the rule is `=== false` and not `!snmpReachable`.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [
      { ipAddress: "10.0.0.1" },
      { ipAddress: "10.0.0.2", snmpReachable: undefined },
    ];

    expect(countDiscoveredHosts(hosts)).toEqual({ all: 2, snmp: 2, noSnmp: 0 });
    expect(
      ipAddressesOf(
        filterDiscoveredHosts({
          hosts: hosts,
          filter: DiscoveredHostFilter.Snmp,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: getInitialSelection(hosts),
      }),
    ).toEqual([]);
    expect(
      getDiscoveredHostFilterEmptyMessage(DiscoveredHostFilter.NoSnmp),
    ).toBe("Every host in this scan answered SNMP.");
  });
});

describe("the numbers on the filter buttons", () => {
  /** A scan of `size` identical SNMP hosts, sharing one object. */
  function scanOfSize(size: number): Array<DiscoveredNetworkDevice> {
    return new Array<DiscoveredNetworkDevice>(size).fill(snmpHost("10.0.0.1"));
  }

  function allLabel(size: number): string {
    return getDiscoveredHostFilterOptions(scanOfSize(size))[0]!.label;
  }

  test("group sizes are grouped from four digits up, and never below", () => {
    /*
     * 999 and 1,000 are the boundary either side of the first separator, and
     * 1,000,000 is the second one — a /8 sweep is not hypothetical for the
     * people who filed #3322 (theirs was 17,850 addresses). A separator that
     * appeared at three digits, or stopped at one, would put a number on the
     * badge that cannot be checked against the probe's own tally by eye, which
     * is the entire reason the grouping is there.
     */
    expect(allLabel(0)).toBe("All (0)");
    expect(allLabel(1)).toBe("All (1)");
    expect(allLabel(999)).toBe("All (999)");
    expect(allLabel(1000)).toBe("All (1,000)");
    expect(allLabel(1000000)).toBe("All (1,000,000)");
  });

  test("the locale is pinned, so the runner's default cannot change the label", () => {
    /*
     * `Number.prototype.toLocaleString()` with no argument follows the host's
     * default locale. On a de-DE box 1000 renders "1.000" and 1000000 renders
     * "1.000.000" — a dot is the DECIMAL separator in en-US, so the same badge
     * would read as a fractional host count to everyone else, and a CI runner
     * with a different ICU default would flip the assertion above without a
     * line of code changing.
     *
     * Asserted twice on purpose. The behavioural half proves today's output is
     * not the German grouping; the source half proves that is because the call
     * names its locale rather than because this machine happens to be en-US,
     * which is the part a value assertion alone can never show.
     */
    expect(allLabel(1000)).not.toContain((1000).toLocaleString("de-DE"));

    /*
     * Whitespace is squashed so Prettier stays free to reflow the argument
     * onto its own line (which it has), and the trailing comma is optional for
     * the same reason.
     */
    const source: string = fs
      .readFileSync(FILTER_SOURCE, "utf8")
      .replace(/\s+/g, "");

    expect(source).toMatch(/toLocaleString\("en-US",?\)/);
    expect(source).not.toContain("toLocaleString()");
  });
});

describe("a filter value that is not one of the three", () => {
  test("an unrecognised filter shows everything, matching the All it calls itself", () => {
    /*
     * The page casts its way into the enum — `setHostFilter(value as
     * DiscoveredHostFilter)` — so nothing at runtime rejects a value that is
     * not one of the three. The two halves used to disagree:
     * `matchesDiscoveredHostFilter` fell through to `!isPingOnly` and showed
     * the SNMP group, while `getDiscoveredHostFilterLabel` and the empty
     * message both fell through to the All wording. The result was a dialog
     * headed "All" that had silently hidden every ping-only host — the exact
     * class of confusion #3322 was filed about.
     *
     * Unreachable through the current UI, where the values come from
     * `getDiscoveredHostFilterOptions`, but one persisted filter or one URL
     * parameter away — and showing everything is the only fall-through that
     * cannot hide a group behind a heading that says it is showing them all.
     */
    const bogus: DiscoveredHostFilter = "Bogus" as DiscoveredHostFilter;

    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
    ];

    expect(
      ipAddressesOf(filterDiscoveredHosts({ hosts: hosts, filter: bogus })),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(getDiscoveredHostFilterLabel(bogus)).toBe("All");
    expect(getDiscoveredHostFilterEmptyMessage(bogus)).toBe(
      "This scan did not find any responding hosts.",
    );
  });
  test("every exported function answers the same twice, in any order", () => {
    /*
     * The dialog calls these on every render and in every combination: the
     * counts, the shown list, the import list and the bulk-control state are
     * all derived during one paint, and a memo, cache or accumulator hiding in
     * the module would make the answer depend on what was rendered before it.
     *
     * The seen-address Set inside `getDiscoveredHostsToImport` and
     * `countSelectableShownHosts` is exactly the shape of thing that gets
     * hoisted out of a function "for performance" one day. Hoisted, it would
     * make the SECOND press of Import return nothing at all — every address
     * already seen — which is why this is checked by running the whole set
     * twice, forwards and then interleaved, rather than by inspecting exports.
     */
    const hosts: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.0.0.1"),
      pingOnlyHost("10.0.0.2"),
      { ipAddress: "10.0.0.3" },
      snmpHost("10.0.0.1"),
      { ipAddress: "", snmpReachable: true },
    ];

    const selection: Record<string, boolean> = getInitialSelection(hosts);
    const store: ImportedIpAddressesByScanId = { scan1: ["10.0.0.9"] };

    const answer: () => string = (): string => {
      const parts: Array<unknown> = [];

      for (const filter of ALL_FILTERS) {
        parts.push(filterDiscoveredHosts({ hosts: hosts, filter: filter }));
        parts.push(getShownDiscoveredHosts({ hosts: hosts, filter: filter }));
        parts.push(countSelectableShownHosts({ hosts: hosts, filter: filter }));
        parts.push(
          getDiscoveredHostsToImport({
            hosts: hosts,
            filter: filter,
            selectedIpAddresses: selection,
          }),
        );
        parts.push(
          areAllShownHostsSelected({
            hosts: hosts,
            filter: filter,
            selectedIpAddresses: selection,
          }),
        );
        parts.push(
          toggleSelectionForShownHosts({
            hosts: hosts,
            filter: filter,
            selectedIpAddresses: selection,
          }),
        );
        parts.push(getDiscoveredHostFilterLabel(filter));
        parts.push(getDiscoveredHostFilterEmptyMessage(filter));
      }

      parts.push(countDiscoveredHosts(hosts));
      parts.push(getDiscoveredHostFilterOptions(hosts));
      parts.push(getInitialSelection(hosts));
      parts.push(
        markDiscoveredHostsAsRegistered({
          hosts: hosts,
          importedIpAddresses: new Set<string>(["10.0.0.1"]),
        }),
      );
      parts.push(
        Array.from(
          getImportedIpAddressesForScan({
            importedByScanId: store,
            scanId: "scan1",
          }),
        ),
      );
      parts.push(
        withImportedIpAddresses({
          importedByScanId: store,
          scanId: "scan1",
          ipAddresses: ["10.0.0.1"],
        }),
      );

      return JSON.stringify(parts);
    };

    const first: string = answer();

    /*
     * Reversed so the second sweep does not repeat the first one's call order:
     * a cache keyed only on "have I been called before" would survive a
     * straight repeat.
     */
    const reversedCounts: DiscoveredHostCounts = countDiscoveredHosts(
      [...hosts].reverse(),
    );

    expect(reversedCounts).toEqual(countDiscoveredHosts(hosts));
    expect(answer()).toBe(first);

    // And the inputs themselves are untouched by any of it.
    expect(selection).toEqual(getInitialSelection(hosts));
    expect(store).toEqual({ scan1: ["10.0.0.9"] });
    expect(ipAddressesOf(hosts)).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.1",
      "",
    ]);
  });
});
