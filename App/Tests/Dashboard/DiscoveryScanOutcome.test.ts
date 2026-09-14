import {
  DiscoveryScanOutcome,
  countPingOnlyHosts,
  getDiscoveredHosts,
  summarizeDiscoveryScan,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { countDiscoveredHosts } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";
import { describe, expect, test } from "@jest/globals";

/*
 * The Discovery scans list is where "SNMP Discovery Scan finds 0 of N hosts"
 * is diagnosed or not diagnosed. Before this, the cell rendered one number —
 * respondedHostCount, which counts SNMP responders only — so all of these
 * looked exactly the same to an operator:
 *
 *   - an empty /24 with nothing on it
 *   - a /24 the probe has no route to
 *   - a /24 where ICMP is filtered, so every SNMP probe was skipped
 *   - a /24 full of devices that rejected the scan's credentials
 *
 * and the probe's own explanation of the sweep was fetched by the page and
 * dropped on the floor. These tests pin the reading of a scan row that keeps
 * those cases distinguishable.
 */

function makeScan(
  overrides?: Partial<NetworkDeviceDiscoveryScan>,
): NetworkDeviceDiscoveryScan {
  return {
    cidr: "10.244.102.0/24",
    status: "Completed",
    respondedHostCount: 0,
    scannedHostCount: 254,
    discoveredDevices: [],
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function host(
  overrides: Partial<DiscoveredNetworkDevice>,
): DiscoveredNetworkDevice {
  return { ipAddress: "10.0.0.1", ...overrides } as DiscoveredNetworkDevice;
}

describe("getDiscoveredHosts", () => {
  test("returns the stored hosts", () => {
    const hosts: Array<DiscoveredNetworkDevice> = [
      host({ ipAddress: "10.0.0.5", snmpReachable: true }),
    ];

    expect(getDiscoveredHosts(makeScan({ discoveredDevices: hosts }))).toEqual(
      hosts,
    );
  });

  test("an unreported scan has no hosts", () => {
    expect(
      getDiscoveredHosts(makeScan({ discoveredDevices: undefined } as never)),
    ).toEqual([]);
  });

  test("null and undefined scans are empty rather than a throw", () => {
    expect(getDiscoveredHosts(null)).toEqual([]);
    expect(getDiscoveredHosts(undefined)).toEqual([]);
  });

  /*
   * discoveredDevices is a jsonb column fed straight from a probe payload, so
   * a row written by a different probe version (or by hand) can hold a
   * non-array. Rendering a table cell must not be the thing that discovers
   * that.
   */
  test("a non-array column value is treated as no results, not a crash", () => {
    for (const badValue of [{}, "hosts", 7, true]) {
      expect(
        getDiscoveredHosts(makeScan({ discoveredDevices: badValue as never })),
      ).toEqual([]);
    }
  });
});

describe("countPingOnlyHosts", () => {
  test("counts hosts that answered ICMP but not SNMP", () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: [
        host({ ipAddress: "10.0.0.1", snmpReachable: false }),
        host({ ipAddress: "10.0.0.2", snmpReachable: true }),
        host({ ipAddress: "10.0.0.3", snmpReachable: false }),
      ],
    });

    expect(countPingOnlyHosts(scan)).toBe(2);
  });

  /*
   * Same rule as isImportableDiscoveredHost: scans stored before the field
   * existed carry undefined, and every host on those scans answered SNMP.
   * Counting them as ping-only would invent a "+ N alive without SNMP" line
   * on historical scans that never had one.
   */
  test("legacy hosts with no snmpReachable field are not ping-only", () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: [
        host({ ipAddress: "10.0.0.1" }),
        host({ ipAddress: "10.0.0.2" }),
      ],
    });

    expect(countPingOnlyHosts(scan)).toBe(0);
  });

  test("a sweep that found nothing has no ping-only hosts", () => {
    expect(countPingOnlyHosts(makeScan())).toBe(0);
  });
});

describe("summarizeDiscoveryScan — the responder summary", () => {
  test("renders responders over hosts swept", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({ respondedHostCount: 12, scannedHostCount: 254 }),
    );

    expect(outcome.respondedHostSummary).toBe("12 of 254 hosts");
  });

  /*
   * Zero responders is a finding and must render as one — this is literally
   * the cell in the bug report.
   */
  test("zero responders still renders a summary", () => {
    expect(
      summarizeDiscoveryScan(makeScan({ respondedHostCount: 0 }))
        .respondedHostSummary,
    ).toBe("0 of 254 hosts");
  });

  test("a scan that has not reported yet gets no summary at all", () => {
    expect(
      summarizeDiscoveryScan(
        makeScan({
          status: "In Progress",
          respondedHostCount: undefined,
        } as never),
      ).respondedHostSummary,
    ).toBeNull();

    expect(
      summarizeDiscoveryScan(makeScan({ respondedHostCount: null } as never))
        .respondedHostSummary,
    ).toBeNull();
  });

  test("an unknown sweep size is marked unknown rather than guessed", () => {
    expect(
      summarizeDiscoveryScan(
        makeScan({
          respondedHostCount: 3,
          scannedHostCount: undefined,
        } as never),
      ).respondedHostSummary,
    ).toBe("3 of ? hosts");
  });

  test("null and undefined scans summarize to nothing", () => {
    expect(summarizeDiscoveryScan(null).respondedHostSummary).toBeNull();
    expect(summarizeDiscoveryScan(undefined).respondedHostSummary).toBeNull();
  });
});

describe("summarizeDiscoveryScan — keeping a zero from reading as an empty network", () => {
  /*
   * The case the bug report screenshots show: the responder count is 0, but
   * the sweep did find live hosts. Without the second line the operator
   * concludes the subnet is empty and stops looking.
   */
  test("surfaces live-but-unmanaged hosts behind a zero responder count", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({
        respondedHostCount: 0,
        discoveredDevices: [
          host({ ipAddress: "10.244.102.11", snmpReachable: false }),
          host({ ipAddress: "10.244.102.12", snmpReachable: false }),
        ],
      }),
    );

    expect(outcome.respondedHostSummary).toBe("0 of 254 hosts");
    expect(outcome.pingOnlyHostCount).toBe(2);
  });

  test("a genuinely empty sweep reports zero of both", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(makeScan());

    expect(outcome.respondedHostSummary).toBe("0 of 254 hosts");
    expect(outcome.pingOnlyHostCount).toBe(0);
  });
});

describe("summarizeDiscoveryScan — the probe's explanation", () => {
  /*
   * statusMessage was already being written by the probe, stored by the
   * server and selected by the page. It was simply never rendered, which is
   * why a scan reporting zero came with no reason attached.
   */
  test("carries the probe's status message through", () => {
    expect(
      summarizeDiscoveryScan(
        makeScan({
          statusMessage:
            "Swept 254 hosts: 0 answered ICMP ping, 0 answered SNMP.",
        }),
      ).explanation,
    ).toBe("Swept 254 hosts: 0 answered ICMP ping, 0 answered SNMP.");
  });

  test("a failed scan's reason is an explanation like any other", () => {
    expect(
      summarizeDiscoveryScan(
        makeScan({
          status: "Failed",
          statusMessage:
            'SNMP v3 privacy protocol "aes-256" is not a recognized value.',
        }),
      ).explanation,
    ).toContain("not a recognized value");
  });

  test("an empty message is no explanation, not an empty one", () => {
    expect(
      summarizeDiscoveryScan(makeScan({ statusMessage: "" })).explanation,
    ).toBeNull();
  });

  test("a scan from an older probe simply has no explanation", () => {
    expect(
      summarizeDiscoveryScan(makeScan({ statusMessage: undefined } as never))
        .explanation,
    ).toBeNull();
  });
});

/*
 * `hasReported` exists so the scans table can tell "no result yet" apart from
 * "nothing to say".
 *
 * The Responded Hosts cell used to short-circuit to an em-dash the moment
 * respondedHostCount was missing, which threw away the only explanation a scan
 * that never ran ever gets — the worker's "nobody has claimed this scan" note
 * and the reaper's "the probe did not report a result within 2 hours" are both
 * written to statusMessage, on rows that by definition have no counts. Both
 * were stored, both were fetched by the page, and neither was ever rendered
 * (OneUptime issue #3287).
 */
describe("summarizeDiscoveryScan — has this scan reported yet", () => {
  test("a Completed scan has reported", () => {
    expect(summarizeDiscoveryScan(makeScan()).hasReported).toBe(true);
  });

  test("zero responders is a report, not the absence of one", () => {
    expect(
      summarizeDiscoveryScan(makeScan({ respondedHostCount: 0 })).hasReported,
    ).toBe(true);
  });

  test("a Pending scan has not reported", () => {
    expect(
      summarizeDiscoveryScan(
        makeScan({
          status: "Pending",
          respondedHostCount: undefined,
          scannedHostCount: undefined,
        } as never),
      ).hasReported,
    ).toBe(false);
  });

  test("a null respondedHostCount is not a report either", () => {
    expect(
      summarizeDiscoveryScan(makeScan({ respondedHostCount: null } as never))
        .hasReported,
    ).toBe(false);
  });

  test("null and undefined scans have not reported", () => {
    expect(summarizeDiscoveryScan(null).hasReported).toBe(false);
    expect(summarizeDiscoveryScan(undefined).hasReported).toBe(false);
  });

  /*
   * The combination the fix turns on: no counts AND an explanation. Before,
   * this row rendered as a bare em-dash.
   */
  test("an unreported scan can still carry the explanation the cell now shows", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({
        status: "Pending",
        respondedHostCount: undefined,
        scannedHostCount: undefined,
        statusMessage:
          'Not started yet: Probe "Datacentre Probe" is not connected to OneUptime, so it has not picked this scan up.',
      } as never),
    );

    expect(outcome.hasReported).toBe(false);
    expect(outcome.respondedHostSummary).toBeNull();
    expect(outcome.explanation).toContain("is not connected to OneUptime");
  });

  /*
   * And the case that must still render an em-dash: a scan submitted moments
   * ago has nothing to report and nothing to explain.
   */
  test("a freshly submitted scan has neither a summary nor an explanation", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({
        status: "Pending",
        respondedHostCount: undefined,
        scannedHostCount: undefined,
        statusMessage: undefined,
      } as never),
    );

    expect(outcome.hasReported).toBe(false);
    expect(outcome.explanation).toBeNull();
  });

  test("hasReported agrees with respondedHostSummary in every case", () => {
    for (const scan of [
      makeScan(),
      makeScan({ respondedHostCount: 12 }),
      makeScan({ respondedHostCount: undefined } as never),
      makeScan({ respondedHostCount: null } as never),
    ]) {
      const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(scan);
      expect(outcome.hasReported).toBe(outcome.respondedHostSummary !== null);
    }
  });
});

describe("the scans table and the review dialog count the same hosts", () => {
  /*
   * The table cell says "+N alive without SNMP" and the dialog's filter row
   * says "No SNMP (N)". They describe the same set of hosts, one click apart,
   * so an operator who reads 12 on the table and 9 on the badge has no way to
   * tell which one is lying. Both now derive from the one predicate; these
   * tests are what stops a future edit giving either of them its own copy of
   * the rule again.
   */

  const mixedHosts: Array<DiscoveredNetworkDevice> = [
    host({ ipAddress: "10.0.0.1", snmpReachable: true }),
    host({ ipAddress: "10.0.0.2", snmpReachable: false }),
    host({ ipAddress: "10.0.0.3" }),
    host({ ipAddress: "10.0.0.4", snmpReachable: false }),
    host({
      ipAddress: "10.0.0.5",
      isAlreadyRegistered: true,
      snmpReachable: false,
    }),
  ];

  test("the table's ping-only tally equals the dialog's No SNMP badge", () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: mixedHosts,
    });

    expect(countPingOnlyHosts(scan)).toBe(3);
    expect(countDiscoveredHosts(getDiscoveredHosts(scan)).noSnmp).toBe(
      countPingOnlyHosts(scan),
    );
  });

  test("a legacy row is SNMP to both of them", () => {
    /*
     * Rows stored before `snmpReachable` existed carry undefined, and every
     * host on those scans answered SNMP. Counting them as ping-only on either
     * screen would invent alive-without-SNMP hosts for every historical scan
     * in the project.
     */
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: [host({ ipAddress: "10.0.0.9" })],
    });

    expect(countPingOnlyHosts(scan)).toBe(0);
    expect(countDiscoveredHosts(getDiscoveredHosts(scan))).toEqual({
      all: 1,
      snmp: 1,
      noSnmp: 0,
    });
  });

  test("a junk row costs a wrong tally, not the whole table", () => {
    /*
     * `discoveredDevices` is jsonb written verbatim from the probe's payload,
     * and getDiscoveredHosts guards only that the VALUE is an array — never
     * that its elements are objects. Reading `host.snmpReachable` off a null
     * element threw a TypeError from inside a table cell, taking the scans
     * list down on a row it was only trying to summarise.
     */
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: [
        null,
        undefined,
        7,
        "10.0.0.1",
        host({ ipAddress: "10.0.0.2", snmpReachable: false }),
      ] as unknown as Array<DiscoveredNetworkDevice>,
    });

    expect(countPingOnlyHosts(scan)).toBe(1);
    expect(summarizeDiscoveryScan(scan).pingOnlyHostCount).toBe(1);
  });

  test("the two groups still account for every row the table can see", () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan({
      discoveredDevices: mixedHosts,
    });

    const hosts: Array<DiscoveredNetworkDevice> = getDiscoveredHosts(scan);

    expect(countPingOnlyHosts(scan) + countDiscoveredHosts(hosts).snmp).toBe(
      hosts.length,
    );
  });
});

/*
 * An ICMP-only scan (issue #3445).
 *
 * A discovery scan used to be an SNMP scan, full stop, and every string on this
 * screen was written for that: "12 of 254 hosts" sits under a column about SNMP
 * responders, and "+N alive without SNMP" beneath it names the shortfall
 * between what answered ping and what answered SNMP.
 *
 * Neither reads correctly on a sweep that never sent an SNMP packet, and both
 * are wrong in the direction that makes an operator distrust the result: the
 * headline number looks like an SNMP tally it is not, and the shortfall line
 * describes a failure that did not happen. So the summary says what the hosts
 * actually answered, and the shortfall line is suppressed.
 *
 * The mode is read through ScanModeUtil, which means a scan row with NO mode
 * column is an SNMP scan — every scan created before this change is exactly
 * that, and every one of the assertions below about "the wording is unchanged"
 * is the assertion that those rows still render as they always did.
 */

function icmpOnlyScan(
  overrides?: Partial<NetworkDeviceDiscoveryScan>,
): NetworkDeviceDiscoveryScan {
  return makeScan({ isSnmpEnabled: false, ...overrides });
}

function snmpScan(
  overrides?: Partial<NetworkDeviceDiscoveryScan>,
): NetworkDeviceDiscoveryScan {
  return makeScan({ isSnmpEnabled: true, ...overrides });
}

/** A scan row from before the column existed: the key is simply not there. */
function legacyScan(
  overrides?: Partial<NetworkDeviceDiscoveryScan>,
): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = makeScan(overrides);

  delete (scan as { isSnmpEnabled?: boolean }).isSnmpEnabled;

  return scan;
}

describe("summarizeDiscoveryScan — what the responder number counted", () => {
  test("an ICMP-only scan says the hosts answered ping", () => {
    expect(
      summarizeDiscoveryScan(
        icmpOnlyScan({ respondedHostCount: 12, scannedHostCount: 254 }),
      ).respondedHostSummary,
    ).toBe("12 of 254 hosts answered ping");
  });

  test("an SNMP scan's summary is word for word the one it has always had", () => {
    /*
     * The regression guard on the other side of the branch. This exact string
     * is asserted at the top of this file too, on a scan with no mode at all;
     * here it is asserted for a scan that explicitly enables SNMP, so neither
     * writer of the column can change the wording of the case that was already
     * shipping.
     */
    expect(
      summarizeDiscoveryScan(
        snmpScan({ respondedHostCount: 12, scannedHostCount: 254 }),
      ).respondedHostSummary,
    ).toBe("12 of 254 hosts");
  });

  test("a scan with no mode recorded reads as an SNMP scan", () => {
    /*
     * THE invariant. Every scan in every project predates this column, and the
     * rows are read back with the key absent until they are re-fetched from a
     * migrated database — and a `select` that omits the column produces the
     * same shape forever. If absence ever read as "ICMP only", every historical
     * scan in the product would silently relabel its own results and drop its
     * "+N alive without SNMP" line.
     */
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      legacyScan({ respondedHostCount: 12 }),
    );

    expect(outcome.respondedHostSummary).toBe("12 of 254 hosts");
    expect(outcome.isIcmpOnly).toBe(false);
  });

  test("a null in the column reads as an SNMP scan too", () => {
    // Only an explicit `false` is an off switch — see ScanModeUtil.
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({ isSnmpEnabled: null, respondedHostCount: 12 } as never),
    );

    expect(outcome.respondedHostSummary).toBe("12 of 254 hosts");
    expect(outcome.isIcmpOnly).toBe(false);
  });

  test("the ICMP wording is the SNMP wording plus what it answered", () => {
    /*
     * A property rather than a second literal: the two summaries must stay the
     * same sentence about the same two numbers, so a future reword of one
     * cannot quietly turn them into two unrelated phrasings that an operator
     * comparing two rows in the same table has to reconcile.
     */
    for (const counts of [
      { respondedHostCount: 0, scannedHostCount: 254 },
      { respondedHostCount: 1, scannedHostCount: 1 },
      { respondedHostCount: 2866, scannedHostCount: 5756 },
    ]) {
      expect(
        summarizeDiscoveryScan(icmpOnlyScan(counts)).respondedHostSummary,
      ).toBe(
        `${
          summarizeDiscoveryScan(snmpScan(counts)).respondedHostSummary
        } answered ping`,
      );
    }
  });

  test("zero answers on an ICMP-only scan is still a finding, rendered as one", () => {
    /*
     * The same rule the SNMP branch has: a zero is a result, not the absence of
     * one. On an ICMP-only sweep it is a particularly loaded result — nothing
     * answered ping at all — so it must reach the cell rather than being
     * flattened to an em-dash.
     */
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      icmpOnlyScan({ respondedHostCount: 0 }),
    );

    expect(outcome.respondedHostSummary).toBe("0 of 254 hosts answered ping");
    expect(outcome.hasReported).toBe(true);
  });

  test("an unknown sweep size stays unknown on an ICMP-only scan", () => {
    expect(
      summarizeDiscoveryScan(
        icmpOnlyScan({
          respondedHostCount: 3,
          scannedHostCount: undefined,
        } as never),
      ).respondedHostSummary,
    ).toBe("3 of ? hosts answered ping");
  });

  test("a NULL sweep size is unknown too, in both modes", () => {
    /*
     * null and undefined arrive here from different writers and only the
     * second was covered. undefined is a scan the probe has not reported on
     * (and a `select` that omits the column); null is what the database hands
     * back for a column that was written empty. The summary reads them through
     * one `?? "?"`, so narrowing that to `=== undefined ? "?" : ...` would put
     * the literal "null" in front of an operator — "3 of null hosts answered
     * ping" — with nothing to fail.
     */
    expect(
      summarizeDiscoveryScan(
        icmpOnlyScan({
          respondedHostCount: 3,
          scannedHostCount: null,
        } as never),
      ).respondedHostSummary,
    ).toBe("3 of ? hosts answered ping");

    expect(
      summarizeDiscoveryScan(
        snmpScan({ respondedHostCount: 3, scannedHostCount: null } as never),
      ).respondedHostSummary,
    ).toBe("3 of ? hosts");
  });

  test("a responder count that is not a number is still rendered in this mode's sentence", () => {
    /*
     * respondedHostCount is interpolated straight into the summary, and the
     * probe writes it over HTTP: a string is what an older probe, a hand-made
     * API call or a JSON body with a quoted number produces. The value is
     * declared `number` and is not parsed, so what matters is that the mode
     * branch is chosen BEFORE the value is read — an ICMP-only row must not
     * fall through to the SNMP sentence because its count looked odd — and
     * that summarizing the row does not take the scans table down with it.
     */
    expect(
      summarizeDiscoveryScan(
        icmpOnlyScan({ respondedHostCount: "12" } as never),
      ).respondedHostSummary,
    ).toBe("12 of 254 hosts answered ping");

    expect(
      summarizeDiscoveryScan(snmpScan({ respondedHostCount: "12" } as never))
        .respondedHostSummary,
    ).toBe("12 of 254 hosts");

    for (const junk of ["", "many", 0, -1, {}, []]) {
      const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
        icmpOnlyScan({ respondedHostCount: junk } as never),
      );

      expect(outcome.hasReported).toBe(true);
      expect(outcome.respondedHostSummary).toContain("answered ping");
      expect(outcome.respondedHostSummary).toContain("of 254 hosts");

      /*
       * And a value the cell cannot read is still not printed as "NaN of 254
       * hosts", which is what "tidying" the interpolation with Number() would
       * produce: an odd row would then read as a broken page rather than as a
       * row holding something odd.
       */
      expect(outcome.respondedHostSummary).not.toContain("NaN");
    }
  });
});

describe("summarizeDiscoveryScan — the scan reports which sweep it was", () => {
  test.each([
    ["an ICMP-only scan", icmpOnlyScan(), true],
    ["an SNMP scan", snmpScan(), false],
    ["a scan with no mode recorded", legacyScan(), false],
  ])(
    "%s reports isIcmpOnly",
    (_label: string, scan: NetworkDeviceDiscoveryScan, isIcmpOnly: boolean) => {
      expect(summarizeDiscoveryScan(scan).isIcmpOnly).toBe(isIcmpOnly);
    },
  );

  test("a missing scan is not an ICMP-only scan", () => {
    /*
     * summarizeDiscoveryScan is called on every render of a list row, including
     * the renders where there is no row yet. "No scan" must not be reported as
     * a kind of scan, and least of all as the kind whose copy suppresses the
     * ping-only line.
     */
    expect(summarizeDiscoveryScan(null).isIcmpOnly).toBe(false);
    expect(summarizeDiscoveryScan(undefined).isIcmpOnly).toBe(false);
  });

  test("a junk value in the mode column does not switch SNMP off", () => {
    // `!== false`, not `Boolean(...)`: an ambiguous value keeps the old sweep.
    for (const value of [0, "", "false", "off", 1, {}]) {
      const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
        makeScan({ isSnmpEnabled: value, respondedHostCount: 12 } as never),
      );

      expect(outcome.isIcmpOnly).toBe(false);
      expect(outcome.respondedHostSummary).toBe("12 of 254 hosts");
    }
  });
});

describe("summarizeDiscoveryScan — no ping-only shortfall on a scan that only pinged", () => {
  /*
   * Every host an ICMP-only sweep finds carries snmpReachable false, because
   * that is literally what the probe writes for a host it never asked about
   * SNMP — and respondedHostCount on those rows counts exactly the same hosts.
   *
   * So the "+N alive without SNMP" line beneath the headline would print the
   * headline's own number back a second time, framed as a shortfall: "12 of 254
   * hosts answered ping / +12 alive without SNMP". It reads as though twelve
   * further hosts were found and lost to a credential failure, on a scan that
   * carried no credentials.
   */
  test("a sweep where every host is ping-only reports no ping-only shortfall", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      icmpOnlyScan({
        respondedHostCount: 3,
        discoveredDevices: [
          host({ ipAddress: "10.244.102.11", snmpReachable: false }),
          host({ ipAddress: "10.244.102.12", snmpReachable: false }),
          host({ ipAddress: "10.244.102.13", snmpReachable: false }),
        ],
      }),
    );

    expect(outcome.respondedHostSummary).toBe("3 of 254 hosts answered ping");
    expect(outcome.pingOnlyHostCount).toBe(0);
  });

  test("the raw counter still counts those hosts — the suppression is the summary's", () => {
    /*
     * Worth separating: countPingOnlyHosts is shared with the review dialog's
     * "No SNMP (N)" badge and has not changed its rule. What changed is that
     * the SUMMARY declines to show that number for a scan where it says nothing
     * new. A future edit that "fixed" this by teaching the counter about the
     * scan mode would move the number off the dialog's badge as well.
     */
    const scan: NetworkDeviceDiscoveryScan = icmpOnlyScan({
      discoveredDevices: [
        host({ ipAddress: "10.244.102.11", snmpReachable: false }),
        host({ ipAddress: "10.244.102.12", snmpReachable: false }),
      ],
    });

    expect(countPingOnlyHosts(scan)).toBe(2);
    expect(summarizeDiscoveryScan(scan).pingOnlyHostCount).toBe(0);
  });

  test("the shortfall is suppressed however many hosts the sweep found", () => {
    for (const count of [0, 1, 2, 254]) {
      const hosts: Array<DiscoveredNetworkDevice> = [];

      for (let index: number = 0; index < count; index++) {
        hosts.push(
          host({ ipAddress: `10.244.102.${index}`, snmpReachable: false }),
        );
      }

      expect(
        summarizeDiscoveryScan(
          icmpOnlyScan({
            respondedHostCount: count,
            discoveredDevices: hosts,
          }),
        ).pingOnlyHostCount,
      ).toBe(0);
    }
  });

  test("an SNMP scan still surfaces its ping-only hosts, unchanged", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      snmpScan({
        respondedHostCount: 0,
        discoveredDevices: [
          host({ ipAddress: "10.244.102.11", snmpReachable: false }),
          host({ ipAddress: "10.244.102.12", snmpReachable: false }),
          host({ ipAddress: "10.244.102.13", snmpReachable: true }),
        ],
      }),
    );

    expect(outcome.pingOnlyHostCount).toBe(2);
  });

  test("a scan with no mode recorded still surfaces its ping-only hosts", () => {
    /*
     * The historical rows again, from the other direction: suppressing the line
     * for them would remove the very signal this cell was built to add in
     * #3287 — the two hosts that ARE alive behind a zero responder count.
     */
    expect(
      summarizeDiscoveryScan(
        legacyScan({
          respondedHostCount: 0,
          discoveredDevices: [
            host({ ipAddress: "10.244.102.11", snmpReachable: false }),
            host({ ipAddress: "10.244.102.12", snmpReachable: false }),
          ],
        }),
      ).pingOnlyHostCount,
    ).toBe(2);
  });
});

describe("summarizeDiscoveryScan — an ICMP-only scan that has not reported", () => {
  test("a queued ICMP-only scan has no summary and has not reported", () => {
    /*
     * The branch on the mode must not reach past the hasReported guard: a scan
     * with no counts renders no summary at all, and "0 of ? hosts answered
     * ping" would be a claim about a sweep that has not run.
     */
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      icmpOnlyScan({
        status: "Pending",
        respondedHostCount: undefined,
        scannedHostCount: undefined,
      } as never),
    );

    expect(outcome.respondedHostSummary).toBeNull();
    expect(outcome.hasReported).toBe(false);
    expect(outcome.isIcmpOnly).toBe(true);
  });

  test("a null count on an ICMP-only scan is not a report either", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      icmpOnlyScan({ respondedHostCount: null } as never),
    );

    expect(outcome.respondedHostSummary).toBeNull();
    expect(outcome.hasReported).toBe(false);
  });

  test("an unreported ICMP-only scan still carries its explanation", () => {
    /*
     * The #3287 case, on the new kind of scan: no counts, but the one thing the
     * operator can act on. An ICMP-only sweep has its own way of never running
     * — the probe cannot send ICMP echo requests at all — and that reason
     * arrives here as the statusMessage on a row with no counts.
     */
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      icmpOnlyScan({
        status: "Failed",
        respondedHostCount: undefined,
        scannedHostCount: undefined,
        statusMessage:
          "This scan checks ICMP only, but this probe could not send ICMP echo requests, so it has no way to find anything.",
      } as never),
    );

    expect(outcome.hasReported).toBe(false);
    expect(outcome.respondedHostSummary).toBeNull();
    expect(outcome.explanation).toContain("could not send ICMP echo requests");
    expect(outcome.isIcmpOnly).toBe(true);
  });

  test("hasReported still agrees with respondedHostSummary in either mode", () => {
    for (const scan of [
      icmpOnlyScan(),
      icmpOnlyScan({ respondedHostCount: 12 }),
      icmpOnlyScan({ respondedHostCount: undefined } as never),
      icmpOnlyScan({ respondedHostCount: null } as never),
      snmpScan(),
      snmpScan({ respondedHostCount: undefined } as never),
      legacyScan(),
    ]) {
      const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(scan);

      expect(outcome.hasReported).toBe(outcome.respondedHostSummary !== null);
    }
  });
});

describe("summarizeDiscoveryScan — the probe's explanation is mode-blind", () => {
  /*
   * statusMessage is written by the probe, which already knows which sweep it
   * ran and phrases the sentence accordingly. This module must pass it through
   * untouched in both modes — an ICMP-only scan's explanation is not a
   * different KIND of value, and a branch that reworded or dropped it would
   * throw away the only account of the sweep the operator ever gets.
   */
  test.each([
    [
      "an ICMP-only scan",
      icmpOnlyScan({
        statusMessage:
          "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.",
      }),
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.",
    ],
    [
      "an SNMP scan",
      snmpScan({
        statusMessage:
          "Swept 254 hosts: 0 answered ICMP ping, 0 answered SNMP.",
      }),
      "Swept 254 hosts: 0 answered ICMP ping, 0 answered SNMP.",
    ],
    [
      "a scan with no mode recorded",
      legacyScan({
        statusMessage:
          "Swept 254 hosts: 3 answered ICMP ping, 3 answered SNMP.",
      }),
      "Swept 254 hosts: 3 answered ICMP ping, 3 answered SNMP.",
    ],
  ])(
    "%s passes its status message through verbatim",
    (_label: string, scan: NetworkDeviceDiscoveryScan, expected: string) => {
      expect(summarizeDiscoveryScan(scan).explanation).toBe(expected);
    },
  );

  test.each([
    ["an ICMP-only scan", icmpOnlyScan({ statusMessage: "" })],
    ["an SNMP scan", snmpScan({ statusMessage: "" })],
  ])(
    "%s with an empty message has no explanation, not an empty one",
    (_label: string, scan: NetworkDeviceDiscoveryScan) => {
      expect(summarizeDiscoveryScan(scan).explanation).toBeNull();
    },
  );

  test.each([
    ["an ICMP-only scan", icmpOnlyScan({ statusMessage: undefined } as never)],
    ["an SNMP scan", snmpScan({ statusMessage: undefined } as never)],
  ])(
    "%s from an older probe simply has no explanation",
    (_label: string, scan: NetworkDeviceDiscoveryScan) => {
      expect(summarizeDiscoveryScan(scan).explanation).toBeNull();
    },
  );
});

describe("summarizeDiscoveryScan — junk in the results column, in either mode", () => {
  /*
   * discoveredDevices is jsonb written verbatim from a probe payload, so its
   * elements are not guaranteed to be objects. The ICMP-only branch short-cuts
   * pingOnlyHostCount to 0 and never walks the array, and the SNMP branch walks
   * it through a nullish-safe predicate — but the guarantee the scans list
   * needs is the same for both: summarizing a row must not be the thing that
   * takes the table down.
   */
  const junkDevices: Array<DiscoveredNetworkDevice> = [
    null,
    undefined,
    7,
    "10.0.0.1",
    { snmpReachable: false },
    host({ ipAddress: "10.0.0.2", snmpReachable: false }),
  ] as unknown as Array<DiscoveredNetworkDevice>;

  test.each([
    ["an ICMP-only scan", icmpOnlyScan({ discoveredDevices: junkDevices }), 0],
    ["an SNMP scan", snmpScan({ discoveredDevices: junkDevices }), 2],
    [
      "a scan with no mode recorded",
      legacyScan({ discoveredDevices: junkDevices }),
      2,
    ],
  ])(
    "%s summarizes rather than throwing",
    (
      _label: string,
      scan: NetworkDeviceDiscoveryScan,
      pingOnlyHostCount: number,
    ) => {
      expect(() => {
        return summarizeDiscoveryScan(scan);
      }).not.toThrow();

      expect(summarizeDiscoveryScan(scan).pingOnlyHostCount).toBe(
        pingOnlyHostCount,
      );
    },
  );

  test.each([
    [
      "an ICMP-only scan",
      icmpOnlyScan({ discoveredDevices: "hosts" } as never),
    ],
    ["an SNMP scan", snmpScan({ discoveredDevices: {} } as never)],
  ])(
    "%s whose results column is not an array summarizes to nothing found",
    (_label: string, scan: NetworkDeviceDiscoveryScan) => {
      expect(summarizeDiscoveryScan(scan).pingOnlyHostCount).toBe(0);
      expect(getDiscoveredHosts(scan)).toEqual([]);
    },
  );
});

/*
 * github.com/OneUptime/oneuptime/issues/3598 — a large scan that is still
 * running.
 *
 * A sweep uploads what it has found every 30 seconds now, so an In Progress
 * row carries real counts — and `scannedHostCount` on such a row means
 * "addresses covered SO FAR", not the size of the target. Without saying so,
 * a 15,360-address scan renders as "4 of 1,024 hosts" and looks like a
 * finished sweep of a subnet that is not the one being scanned.
 *
 * The denominator of the progress line is derived from the scan's own target
 * rather than stored, so it needs no column and cannot disagree with what the
 * probe is actually sweeping.
 */
describe("summarizeDiscoveryScan — a scan that is still sweeping", () => {
  function runningScan(
    overrides?: Partial<NetworkDeviceDiscoveryScan>,
  ): NetworkDeviceDiscoveryScan {
    return makeScan({
      status: "In Progress",
      // The shape from the report: 10 x 256 x 6 = the 15,360 addresses it names.
      cidr: "10.240-249.0-255.220-225",
      respondedHostCount: 4,
      scannedHostCount: 1024,
      ...overrides,
    } as Partial<NetworkDeviceDiscoveryScan>);
  }

  test("says the count is a running total, and how far through the range it is", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(runningScan());

    expect(outcome.isInProgress).toBe(true);
    expect(outcome.progressSummary).toBe(
      "Scanning - 1,024 of 15,360 addresses swept so far",
    );
  });

  // The headline stays the headline; the progress line sits beneath it.
  test("still reports what has answered so far", () => {
    expect(summarizeDiscoveryScan(runningScan()).respondedHostSummary).toBe(
      "4 of 1024 hosts",
    );
  });

  test("a finished scan has no progress line", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(makeScan());

    expect(outcome.isInProgress).toBe(false);
    expect(outcome.progressSummary).toBeNull();
  });

  test("a queued scan has no progress line either", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({
        status: "Pending",
        respondedHostCount: null,
        scannedHostCount: null,
      } as unknown as Partial<NetworkDeviceDiscoveryScan>),
    );

    expect(outcome.isInProgress).toBe(false);
    expect(outcome.progressSummary).toBeNull();
  });

  /*
   * A scan claimed seconds ago has reported nothing at all. Its cell already
   * shows the probe's own explanation (or the unclaimed-scan diagnosis), and
   * a progress line saying "0 of 15,360" would displace it with a number that
   * carries no information.
   */
  test("a claimed scan that has not reported yet has no progress line", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(
      makeScan({
        status: "In Progress",
        respondedHostCount: null,
        scannedHostCount: null,
      } as unknown as Partial<NetworkDeviceDiscoveryScan>),
    );

    expect(outcome.hasReported).toBe(false);
    expect(outcome.progressSummary).toBeNull();
  });

  /*
   * An older probe reports once, at the end, with scannedHostCount set to the
   * whole range. If such a report lands while the row still reads In Progress,
   * "15,360 of 15,360 swept so far" is noise at best — there is no progress
   * left to describe.
   */
  test("no progress line once the swept count has reached the whole range", () => {
    expect(
      summarizeDiscoveryScan(runningScan({ scannedHostCount: 15360 }))
        .progressSummary,
    ).toBeNull();

    // And none if it somehow exceeds it.
    expect(
      summarizeDiscoveryScan(runningScan({ scannedHostCount: 20000 }))
        .progressSummary,
    ).toBeNull();
  });

  /*
   * The denominator comes from parsing the target. A row whose target cannot
   * be parsed — or was not selected by the page — has no total to quote, and
   * inventing one would be worse than leaving the line off.
   */
  test("no progress line when the target gives no total", () => {
    expect(
      summarizeDiscoveryScan(runningScan({ cidr: "not-a-target" }))
        .progressSummary,
    ).toBeNull();

    // A page that did not select the column at all.
    expect(
      summarizeDiscoveryScan(
        runningScan({
          cidr: undefined,
        } as unknown as Partial<NetworkDeviceDiscoveryScan>),
      ).progressSummary,
    ).toBeNull();
  });

  test("reads a CIDR target as well as an octet range", () => {
    expect(
      summarizeDiscoveryScan(
        runningScan({ cidr: "10.0.0.0/16", scannedHostCount: 512 }),
      ).progressSummary,
    ).toBe("Scanning - 512 of 65,534 addresses swept so far");
  });

  test("is nullish-safe, like every other reading on this row", () => {
    const outcome: DiscoveryScanOutcome = summarizeDiscoveryScan(null);

    expect(outcome.isInProgress).toBe(false);
    expect(outcome.progressSummary).toBeNull();
  });
});
