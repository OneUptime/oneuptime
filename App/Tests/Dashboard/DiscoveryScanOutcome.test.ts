import {
  DiscoveryScanOutcome,
  countPingOnlyHosts,
  getDiscoveredHosts,
  summarizeDiscoveryScan,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryScanOutcome";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
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
