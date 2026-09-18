import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostFilter,
  getDiscoveredHostsToImport,
  normalizeDiscoveredHosts,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";

/*
 * WHAT THIS FILE PINS
 *
 * `getDiscoveredHostsToImport` is the single answer to "what does pressing
 * Import Selected create". Discovery.tsx loops over its result and issues one
 * `ModelAPI.create<NetworkDevice>` per entry, and the count rendered on the
 * button is that same list's length — so this function is simultaneously the
 * promise on the button and the work the press does. One host too many here is
 * one unwanted Network Device; at the size issue #3322 reports (2,866 SNMP +
 * 2,890 ping-only in one scan) a scoping mistake is thousands of them, created
 * one API call at a time.
 *
 * Every expectation below is a hand-written literal — an explicit array of
 * addresses or an explicit number — checkable by eye against the fixture right
 * above it. Nothing here re-derives an expected value by calling the module,
 * because a test that computes its expectation from the same primitives as the
 * function under test agrees with any bug both of them share. For the same
 * reason the selections passed in are built by this file's own `tick` /
 * `tickEveryAddress` helpers rather than by `getInitialSelection`: the
 * interesting cases are the ones where the selection and the selectable set
 * DISAGREE, and handing the function a selection equal to exactly what it
 * would have picked itself never exercises the selection branch at all.
 *
 * DiscoveredHostFilter.test.ts covers the grouping rules and the happy path.
 * This file is about partial selections, ticks that point at nothing, jsonb
 * that repeats an address, and the arithmetic at scan scale.
 */

/** Answered the SNMP walk: imports as a polled device with the scan's creds. */
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

/*
 * A row written before `snmpReachable` existed. Ping-only sweeps did not exist
 * then, so every host on those scans answered SNMP — reading `undefined` as
 * ping-only would retroactively move real switches into the wrong group and
 * import them with no polling.
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

function addressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice) => {
    return host.ipAddress;
  });
}

/**
 * A selection with exactly these addresses ticked, in this order.
 *
 * Written here rather than taken from `getInitialSelection` so the ticks are
 * an independent input: what the operator left checked, not what the module
 * thinks is checkable.
 */
function tick(...ipAddresses: Array<string>): Record<string, boolean> {
  const selection: Record<string, boolean> = {};

  for (const ipAddress of ipAddresses) {
    selection[ipAddress] = true;
  }

  return selection;
}

/**
 * Every address in the scan ticked — including the ones that must never
 * import.
 *
 * Deliberately more generous than the dialog's own opening selection: a stale
 * tick on an already-registered or blank-addressed host is exactly the state a
 * second sitting leaves behind, and it has to be refused by the import rather
 * than by the fact that nobody ticked it.
 */
function tickEveryAddress(
  hosts: Array<DiscoveredNetworkDevice>,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};

  for (const host of hosts) {
    selection[host.ipAddress] = true;
  }

  return selection;
}

/*
 * One mixed sweep, half of it left unticked by the operator.
 *
 * .1 SNMP, ticked          .2 ping-only, ticked
 * .3 SNMP, NOT ticked      .4 ping-only, NOT ticked
 * .5 legacy (SNMP), ticked .6 ping-only, ticked
 */
const mixedScan: Array<DiscoveredNetworkDevice> = [
  snmpHost("10.0.0.1"),
  pingOnlyHost("10.0.0.2"),
  snmpHost("10.0.0.3"),
  pingOnlyHost("10.0.0.4"),
  legacyHost("10.0.0.5"),
  pingOnlyHost("10.0.0.6"),
];

const mixedSelection: Record<string, boolean> = tick(
  "10.0.0.1",
  "10.0.0.2",
  "10.0.0.5",
  "10.0.0.6",
);

describe("a partial selection under each filter", () => {
  test("All imports the four ticked hosts and leaves the two unticked ones alone", () => {
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: mixedSelection,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.5", "10.0.0.6"]);
  });

  test("SNMP imports the ticked SNMP hosts only — not the unticked switch, not the ticked ping-only hosts", () => {
    /*
     * Two independent narrowings at once, which is the state the dialog is
     * actually in: a filter hiding one group and unticked rows inside the
     * group that is showing. .3 is on screen and unticked; .2 and .6 are
     * ticked and hidden. Neither may reach the import.
     */
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.Snmp,
          selectedIpAddresses: mixedSelection,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.5"]);
  });

  test("No SNMP imports the ticked ping-only hosts only", () => {
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: mixedSelection,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.6"]);
  });

  test("a group whose every ticked host is hidden by the filter imports nothing at all", () => {
    /*
     * The zero case has to be a real zero rather than "fall back to the whole
     * selection": Discovery.tsx returns early on an empty list and the button
     * renders "Import Selected (0)" disabled, so a non-empty answer here is a
     * press that creates devices the operator cannot see.
     */
    const pingOnlyTicks: Record<string, boolean> = tick(
      "10.0.0.2",
      "10.0.0.4",
      "10.0.0.6",
    );

    expect(
      getDiscoveredHostsToImport({
        hosts: mixedScan,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: pingOnlyTicks,
      }),
    ).toEqual([]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: pingOnlyTicks,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.4", "10.0.0.6"]);
  });
});

describe("what counts as a tick", () => {
  test("only a truthy value imports — false and a removed key are both untick", () => {
    /*
     * `CheckboxElement` writes `false` on uncheck rather than dropping the
     * key, and the bulk "Clear all" control writes `false` across the whole
     * shown group, so a present-but-false entry is the COMMON shape of an
     * unticked host — while a host never touched has no key at all. Reading
     * presence instead of value would make Clear all import everything it just
     * cleared.
     */
    const selection: Record<string, boolean> = {
      "10.0.0.1": true,
      "10.0.0.2": false,
      "10.0.0.5": true,
      "10.0.0.6": false,
    };

    delete selection["10.0.0.5"];

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.0.0.1"]);
  });

  test("ticks for addresses that are not in the scan are ignored rather than imported or thrown on", () => {
    /*
     * Selection state outlives the list it was made against: the same object
     * is still in hand when a scan is re-opened after a re-sweep dropped hosts
     * that no longer answer. Those ticks have no row, no sysName and no
     * monitoring method — there is nothing to create from them.
     */
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: tick(
            "192.168.99.99",
            "10.0.0.2",
            "172.31.4.4",
            "",
          ),
        }),
      ),
    ).toEqual(["10.0.0.2"]);
  });

  test("an empty selection against a full scan imports nothing under any filter", () => {
    for (const filter of [
      DiscoveredHostFilter.All,
      DiscoveredHostFilter.Snmp,
      DiscoveredHostFilter.NoSnmp,
    ]) {
      expect(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: filter,
          selectedIpAddresses: {},
        }),
      ).toEqual([]);
    }
  });

  test("an address that names an Object.prototype key is not imported unless it was ticked", () => {
    /*
     * The selection is a plain object, and the tick used to be read as
     * `selectedIpAddresses[host.ipAddress]` — so an address colliding with
     * something on Object.prototype ("constructor", "toString", "valueOf")
     * resolved to an inherited function and was truthy for a host nobody
     * ticked. `discoveredDevices` is jsonb written from the probe's payload
     * and `ipAddress` is used verbatim as the device hostname, so the value is
     * not guaranteed to be a dotted quad.
     *
     * `isSelectedIpAddress` now asks for an OWN property. "10.0.0.9" beside it
     * is the control: an ordinary unticked address was always refused, and
     * still is.
     */
    expect(
      getDiscoveredHostsToImport({
        hosts: [snmpHost("constructor"), snmpHost("10.0.0.9")],
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: {},
      }),
    ).toEqual([]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: [snmpHost("constructor"), snmpHost("10.0.0.9")],
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: tick("constructor"),
        }),
      ),
    ).toEqual(["constructor"]);
  });
});

describe("hosts that must never be imported, however they are ticked", () => {
  test("an already-registered host is skipped while the neighbours around it import", () => {
    /*
     * `isAlreadyRegistered` is computed server-side at probe-upload time and
     * frozen into the jsonb, so the tick on it is genuinely stale rather than
     * a fresh choice — and the row's checkbox is disabled, so the operator
     * cannot clear it themselves. Importing it creates a second Network Device
     * for an address the inventory already has.
     */
    const scan: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.5.0.1"),
      snmpHost("10.5.0.2", { isAlreadyRegistered: true }),
      pingOnlyHost("10.5.0.3", { isAlreadyRegistered: true }),
      pingOnlyHost("10.5.0.4"),
    ];

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: tickEveryAddress(scan),
        }),
      ),
    ).toEqual(["10.5.0.1", "10.5.0.4"]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: tickEveryAddress(scan),
        }),
      ),
    ).toEqual(["10.5.0.4"]);
  });

  test("a blank address is skipped even with the empty-string key ticked", () => {
    /*
     * The address is the device hostname AND the selection key, so a blank one
     * would import as a nameless device that every other blank row shares a
     * checkbox with. Grouping still works on it — this row is ping-only — so
     * it has to be refused by selectability, not by falling outside a filter.
     */
    const scan: Array<DiscoveredNetworkDevice> = [
      { ipAddress: "", snmpReachable: false },
      pingOnlyHost("10.6.0.2"),
    ];

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: tickEveryAddress(scan),
        }),
      ),
    ).toEqual(["10.6.0.2"]);
  });

  test("a legacy row imports under SNMP and is invisible to No SNMP", () => {
    /*
     * The expensive half of the legacy rule: if `undefined` were read as
     * ping-only, re-importing an old scan under No SNMP would create real
     * switches as monitor-backed devices with polling switched off, and the
     * SNMP press that was supposed to pick them up would come back empty.
     */
    const scan: Array<DiscoveredNetworkDevice> = [
      legacyHost("10.7.0.1"),
      { ipAddress: "10.7.0.2", snmpReachable: undefined },
      pingOnlyHost("10.7.0.3"),
    ];

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.Snmp,
          selectedIpAddresses: tickEveryAddress(scan),
        }),
      ),
    ).toEqual(["10.7.0.1", "10.7.0.2"]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: scan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: tickEveryAddress(scan),
        }),
      ),
    ).toEqual(["10.7.0.3"]);
  });
});

describe("an address that appears on more than one row", () => {
  /*
   * `discoveredDevices` is jsonb straight from the probe's payload, so the
   * same address can appear twice — a re-walk that answered on two interfaces,
   * a merged payload. One address is one checkbox, so two rows share a single
   * tick, and importing both would create two devices from one decision.
   */
  const duplicateScan: Array<DiscoveredNetworkDevice> = [
    snmpHost("10.8.0.1", { sysName: "first-walk" }),
    pingOnlyHost("10.8.0.2"),
    snmpHost("10.8.0.1", { sysName: "second-walk" }),
    pingOnlyHost("10.8.0.2"),
    snmpHost("10.8.0.3"),
  ];

  test("a duplicated address imports once under each of the three filters", () => {
    const selection: Record<string, boolean> = tick("10.8.0.1", "10.8.0.2");

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: duplicateScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.8.0.1", "10.8.0.2"]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: duplicateScan,
          filter: DiscoveredHostFilter.Snmp,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.8.0.1"]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: duplicateScan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: selection,
        }),
      ),
    ).toEqual(["10.8.0.2"]);
  });

  test("the row that gets imported is the first one in scan order, which decides the device's name", () => {
    /*
     * Not cosmetic: Discovery.tsx builds the device from the returned row —
     * `device.name = entry.sysName || entry.ipAddress` and the description
     * from `sysDescr` — so which of the two rows survives is what the device
     * ends up called. Scan order is the probe's order, so first-wins is the
     * reading of the payload the operator saw at the top of the list.
     */
    const imported: Array<DiscoveredNetworkDevice> = getDiscoveredHostsToImport(
      {
        hosts: duplicateScan,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: tick("10.8.0.1"),
      },
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]!.sysName).toBe("first-walk");
  });

  test("an unticked duplicate contributes nothing, however many rows carry it", () => {
    /*
     * The dedupe is a "seen" set, and a set that were updated before the tick
     * was checked would still be harmless here — but one updated by the FIRST
     * row of an unticked pair and consulted later is how a duplicate becomes
     * un-importable forever. Both rows unticked must simply be absent, with
     * the rest of the scan unaffected.
     */
    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: duplicateScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: tick("10.8.0.3"),
        }),
      ),
    ).toEqual(["10.8.0.3"]);
  });

  test("one address on two rows in DIFFERENT groups is offered by both groups but imported once under All", () => {
    /*
     * The awkward payload: the same address answered ping on one row and SNMP
     * on another. Each filter shows its own row, so the address is importable
     * from either group — and under All it collapses to the scan-first row,
     * which here is the ping-only one, so the device is created WITHOUT
     * polling even though a row claiming SNMP exists further down.
     *
     * This is the one case where the SNMP and No SNMP lists overlap, so it is
     * asserted apart from the partition test below rather than being allowed
     * to weaken it. Importing group by group does not double-create: the page
     * marks the address registered after the first press, and
     * `markDiscoveredHostsAsRegistered` keys on the address, so it retires
     * both rows at once.
     */
    const crossGroupScan: Array<DiscoveredNetworkDevice> = [
      pingOnlyHost("10.9.0.1", { sysName: "ping-row" }),
      snmpHost("10.9.0.1", { sysName: "snmp-row" }),
    ];

    const selection: Record<string, boolean> = tick("10.9.0.1");

    const underAll: Array<DiscoveredNetworkDevice> = getDiscoveredHostsToImport(
      {
        hosts: crossGroupScan,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selection,
      },
    );

    expect(underAll).toHaveLength(1);
    expect(underAll[0]!.sysName).toBe("ping-row");
    expect(underAll[0]!.snmpReachable).toBe(false);

    const underSnmp: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: crossGroupScan,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      });

    expect(addressesOf(underSnmp)).toEqual(["10.9.0.1"]);
    expect(underSnmp[0]!.sysName).toBe("snmp-row");

    const underNoSnmp: Array<DiscoveredNetworkDevice> =
      getDiscoveredHostsToImport({
        hosts: crossGroupScan,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: selection,
      });

    expect(addressesOf(underNoSnmp)).toEqual(["10.9.0.1"]);
    expect(underNoSnmp[0]!.sysName).toBe("ping-row");
  });

  test("a duplicated address registered on either row is not imported on the other", () => {
    /*
     * The dedup in getDiscoveredHostsToImport records an address only once a
     * row has passed selectability, so a registered first row was refused
     * WITHOUT claiming its address and the second row — same address, its own
     * frozen `isAlreadyRegistered: false` — sailed through. A Network Device
     * was created for an address the scan itself reports as already in the
     * inventory, and which row won depended purely on payload order. The
     * dialog renders the pair as one disabled "Already added" row and one
     * enabled row, so the operator cannot see it is the same host twice.
     *
     * normalizeDiscoveredHosts settles it before any of that: registration is
     * a fact about an ADDRESS, so it is propagated to every row carrying it.
     * Asserted in both orders, because order-dependence was the original
     * symptom.
     */
    const registeredFirst: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.10.0.1", {
        sysName: "registered-row",
        isAlreadyRegistered: true,
      }),
      snmpHost("10.10.0.1", { sysName: "unregistered-row" }),
    ];

    const registeredSecond: Array<DiscoveredNetworkDevice> = [
      snmpHost("10.10.0.1", { sysName: "unregistered-row" }),
      snmpHost("10.10.0.1", {
        sysName: "registered-row",
        isAlreadyRegistered: true,
      }),
    ];

    for (const scan of [registeredFirst, registeredSecond]) {
      expect(
        getDiscoveredHostsToImport({
          hosts: normalizeDiscoveredHosts(scan),
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: tick("10.10.0.1"),
        }),
      ).toEqual([]);
    }
  });
});

describe("the two groups partition the import", () => {
  /*
   * A fixture with one of everything that can change the answer: a legacy row,
   * a ticked-but-registered host, an unticked ping-only host, and one plain
   * member of each group.
   *
   * .1 legacy (SNMP), ticked            .2 ping-only, ticked
   * .3 SNMP, ticked but registered      .4 ping-only, NOT ticked
   * .5 SNMP, ticked
   */
  const partitionScan: Array<DiscoveredNetworkDevice> = [
    legacyHost("172.16.0.1"),
    pingOnlyHost("172.16.0.2"),
    snmpHost("172.16.0.3", { isAlreadyRegistered: true }),
    pingOnlyHost("172.16.0.4"),
    snmpHost("172.16.0.5"),
  ];

  const partitionSelection: Record<string, boolean> = tick(
    "172.16.0.1",
    "172.16.0.2",
    "172.16.0.3",
    "172.16.0.5",
  );

  test("importing SNMP then No SNMP creates exactly what importing All would, no host twice and none stranded", () => {
    /*
     * This is the guarantee that makes "do the switches now, the endpoints
     * later" safe. If a host could import under neither group it would be
     * silently unreachable from the two-press flow even though All offers it;
     * if it could import under both, the two presses would create it twice —
     * and neither shows up as an error, only as a wrong inventory.
     */
    const underSnmp: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: partitionScan,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: partitionSelection,
      }),
    );

    const underNoSnmp: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: partitionScan,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: partitionSelection,
      }),
    );

    const underAll: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: partitionScan,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: partitionSelection,
      }),
    );

    expect(underSnmp).toEqual(["172.16.0.1", "172.16.0.5"]);
    expect(underNoSnmp).toEqual(["172.16.0.2"]);
    expect(underAll).toEqual(["172.16.0.1", "172.16.0.2", "172.16.0.5"]);

    // Together the two groups are the whole import, each host in exactly one.
    expect([...underSnmp, ...underNoSnmp].sort()).toEqual([...underAll].sort());
    expect(
      underSnmp.filter((ipAddress: string) => {
        return underNoSnmp.includes(ipAddress);
      }),
    ).toEqual([]);
  });
});

describe("the order the devices are created in", () => {
  test("import order follows the scan even when the boxes were ticked bottom-up", () => {
    /*
     * Discovery.tsx creates the devices sequentially in this order, reporting
     * failures by address as it goes, and a run of thousands can be watched
     * (or interrupted) part-way through. Scan order is the probe's address
     * order — the order the operator just read down the dialog — whereas
     * selection-key order is whatever sequence the boxes happened to be
     * clicked in, which would make a partial run's progress unreadable.
     */
    const bottomUpSelection: Record<string, boolean> = tick(
      "10.0.0.6",
      "10.0.0.5",
      "10.0.0.2",
      "10.0.0.1",
    );

    // The selection genuinely disagrees with scan order, or this proves nothing.
    expect(Object.keys(bottomUpSelection)).toEqual([
      "10.0.0.6",
      "10.0.0.5",
      "10.0.0.2",
      "10.0.0.1",
    ]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.All,
          selectedIpAddresses: bottomUpSelection,
        }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.5", "10.0.0.6"]);

    expect(
      addressesOf(
        getDiscoveredHostsToImport({
          hosts: mixedScan,
          filter: DiscoveredHostFilter.NoSnmp,
          selectedIpAddresses: bottomUpSelection,
        }),
      ),
    ).toEqual(["10.0.0.2", "10.0.0.6"]);
  });
});

describe("the scan from issue #3322, at its real size", () => {
  /*
   * 2,866 SNMP hosts and 2,890 ping-only ones in a single sweep. Every number
   * below is written out and explained rather than computed, because the count
   * on the button IS this list's length: if the arithmetic here is derived the
   * same way the implementation derives it, a wrong number agrees with itself.
   *
   * SNMP addresses are 10.1.x.y, ping-only ones 10.2.x.y, so which group a
   * returned host came from can be read off its address without asking the
   * module.
   */
  const SNMP_COUNT: number = 2866;
  const PING_ONLY_COUNT: number = 2890;

  /** The two SNMP hosts a previous sitting already imported. */
  const REGISTERED_SNMP: Array<string> = ["10.1.0.0", "10.1.4.7"];
  /** The three switches the operator unticked by hand. */
  const UNTICKED_SNMP: Array<string> = ["10.1.1.1", "10.1.2.2", "10.1.3.3"];
  /** The four endpoints the operator unticked by hand. */
  const UNTICKED_PING_ONLY: Array<string> = [
    "10.2.0.1",
    "10.2.0.2",
    "10.2.5.5",
    "10.2.9.9",
  ];

  function bigScan(): Array<DiscoveredNetworkDevice> {
    const hosts: Array<DiscoveredNetworkDevice> = [];

    for (let index: number = 0; index < SNMP_COUNT; index++) {
      const ipAddress: string = `10.1.${Math.floor(index / 256)}.${index % 256}`;

      hosts.push(
        snmpHost(ipAddress, {
          isAlreadyRegistered: REGISTERED_SNMP.includes(ipAddress),
        }),
      );
    }

    for (let index: number = 0; index < PING_ONLY_COUNT; index++) {
      hosts.push(
        pingOnlyHost(`10.2.${Math.floor(index / 256)}.${index % 256}`),
      );
    }

    return hosts;
  }

  /** Everything ticked except the seven rows the operator cleared. */
  function bigSelection(
    hosts: Array<DiscoveredNetworkDevice>,
  ): Record<string, boolean> {
    const selection: Record<string, boolean> = tickEveryAddress(hosts);

    for (const ipAddress of [...UNTICKED_SNMP, ...UNTICKED_PING_ONLY]) {
      selection[ipAddress] = false;
    }

    return selection;
  }

  test("each filter imports its own group's ticked hosts, and the three counts are exactly 2,861 / 2,886 / 5,747", () => {
    /*
     * SNMP:     2,866 found - 2 already registered - 3 unticked = 2,861.
     * No SNMP:  2,890 found - 4 unticked                        = 2,886.
     * All:      2,861 + 2,886                                   = 5,747.
     *
     * The address-prefix checks are what turn a right total into a right list:
     * a scoping bug that swapped the groups would keep All at 5,747 while
     * making both group presses create the wrong thousands of devices.
     */
    const hosts: Array<DiscoveredNetworkDevice> = bigScan();
    const selection: Record<string, boolean> = bigSelection(hosts);

    const underSnmp: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.Snmp,
        selectedIpAddresses: selection,
      }),
    );

    const underNoSnmp: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.NoSnmp,
        selectedIpAddresses: selection,
      }),
    );

    const underAll: Array<string> = addressesOf(
      getDiscoveredHostsToImport({
        hosts: hosts,
        filter: DiscoveredHostFilter.All,
        selectedIpAddresses: selection,
      }),
    );

    expect(underSnmp).toHaveLength(2861);
    expect(underNoSnmp).toHaveLength(2886);
    expect(underAll).toHaveLength(5747);

    expect(
      underSnmp.filter((ipAddress: string) => {
        return !ipAddress.startsWith("10.1.");
      }),
    ).toEqual([]);

    expect(
      underNoSnmp.filter((ipAddress: string) => {
        return !ipAddress.startsWith("10.2.");
      }),
    ).toEqual([]);

    // The seven cleared rows and the two registered ones are absent from All.
    for (const ipAddress of [
      ...REGISTERED_SNMP,
      ...UNTICKED_SNMP,
      ...UNTICKED_PING_ONLY,
    ]) {
      expect(underAll).not.toContain(ipAddress);
    }

    // First and last of the whole sweep, so scan order survived at scale.
    expect(underAll[0]).toBe("10.1.0.1");
    expect(underAll[underAll.length - 1]).toBe("10.2.11.73");
  });
});
