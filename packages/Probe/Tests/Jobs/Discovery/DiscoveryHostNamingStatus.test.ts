// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * A custom (non-global) probe unless a test says otherwise, no configured
 * NetBIOS cap and no fixed reverse-DNS budget. Config.ts reads each of these
 * once at load, and a developer's shell may carry any of them.
 */
delete process.env["REGISTER_PROBE_KEY"];
delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];
delete process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanResult,
  type SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { ReverseDnsResolution } from "../../../Utils/Discovery/ReverseDnsResolver";
import { NetbiosNameResolution } from "../../../Utils/Discovery/NetbiosNameResolver";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
} from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import { normalizeDiscoveredHosts } from "Common/Utils/NetworkDiscovery/DiscoveredHostUtil";
import {
  explainUnnamedDiscoveredHost,
  DiscoveredHostNamingExplanation,
} from "Common/Utils/NetworkDiscovery/DiscoveredHostNamingDiagnosis";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import {
  buildScanStatusMessage,
  DiscoveryNetbiosPolicy,
  runScan,
  scanWithDeadline,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * OneUptime issue #3916, end to end on the probe.
 *
 * The report: an ICMP-only discovery scan of 10.16.42.51-65 found twelve
 * kitchen displays. Four came back with reverse-DNS names — WB0024KDS02,
 * WB0024KDS04, wb-0024-kds09, wb-0024-kds10 — and the Review dialog listed the
 * other eight by address. The status message said "12 answered ping" and
 * nothing else. The operator knew the devices had names; nothing in the
 * product could say whether those eight had no PTR record, whether the probe's
 * DNS server had failed to answer, or whether NetBIOS had ever been asked.
 *
 * This file drives that scan through the real scanWithDeadline and runScan —
 * the real sweep, with ping and both naming seams replaced — and pins what now
 * leaves the probe:
 *
 *   1. Each host left unnamed carries WHY, per naming source: a reverse-DNS
 *      code, and a NetBIOS code when the scan asked for NetBIOS.
 *   2. Named hosts carry no code, and a host the resolver said nothing about
 *      carries no key.
 *   3. The status message says when lookups FAILED (the case a rescan fixes),
 *      and when a global probe refused a NetBIOS lookup the scan asked for —
 *      and still says nothing about addresses that simply have no record.
 *   4. The upload carries the codes verbatim, and they survive the Common
 *      whitelist the dashboard reads through, into the tooltip text.
 *   5. Progress uploads, taken before naming, carry neither names nor codes.
 */

const CUSTOMER_TARGET: string = "10.16.42.51-65";

// The twelve that answered ping: .51 to .62.
const CUSTOMER_HOSTS: Array<string> = [
  51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
].map((lastOctet: number) => {
  return `10.16.42.${lastOctet}`;
});

// The four the screenshot shows named, with the names it shows.
const CUSTOMER_NAMES: Record<string, string> = {
  "10.16.42.52": "WB0024KDS02.wbhq.com",
  "10.16.42.54": "WB0024KDS04.wbhq.com",
  "10.16.42.59": "wb-0024-kds09.wbhq.com",
  "10.16.42.60": "wb-0024-kds10.wbhq.com",
};

// Two lookups that failed, on their retry too.
const TIMED_OUT_HOSTS: Array<string> = ["10.16.42.61", "10.16.42.62"];

// And six the DNS server answered: no PTR record.
const NO_RECORD_HOSTS: Array<string> = [
  "10.16.42.51",
  "10.16.42.53",
  "10.16.42.55",
  "10.16.42.56",
  "10.16.42.57",
  "10.16.42.58",
];

const CUSTOMER_HEADLINE: string =
  "Swept 15 hosts with ICMP ping only (Check SNMP is off for this scan): 12 answered ping.";

const FAILED_LOOKUPS_SENTENCE: string =
  "Reverse DNS lookups failed for 2 of 12 hosts; " +
  "hover the (i) beside an unnamed host for the reason, and rescan to try again.";

const NETBIOS_GLOBAL_PROBE_SENTENCE: string =
  "NetBIOS names were not looked up: this is a global probe, and global probes never send NetBIOS queries.";

const RESULT_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result";

// Answers ping for `aliveHosts`; nothing forks the real ping binary.
function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

// Hosts listed answer SNMP with that sysName; every other host is silent.
function mockSnmp(sysNameByHost: Record<string, string>): void {
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      const sysName: string | undefined = sysNameByHost[config.hostname || ""];

      return sysName !== undefined ? { sysName: sysName } : null;
    });
}

/*
 * The reverse-DNS seam as ReverseDnsResolver answers it since issue #3916:
 * names for some addresses, a code for every other address it was handed, and
 * how many lookups failed.
 */
function mockReverseDns(data: {
  names: Record<string, string>;
  timedOut?: Array<string>;
}): void {
  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<ReverseDnsResolution> => {
        const distinct: Array<string> = Array.from(
          new Set<string>(ipAddresses),
        );
        const timedOut: Array<string> = (data.timedOut || []).filter(
          (ipAddress: string) => {
            return distinct.includes(ipAddress);
          },
        );
        const statusByIpAddress: Map<string, DiscoveredHostReverseDnsStatus> =
          new Map<string, DiscoveredHostReverseDnsStatus>();

        for (const ipAddress of distinct) {
          if (data.names[ipAddress]) {
            continue;
          }

          statusByIpAddress.set(
            ipAddress,
            timedOut.includes(ipAddress)
              ? DiscoveredHostReverseDnsStatus.Timeout
              : DiscoveredHostReverseDnsStatus.NoRecord,
          );
        }

        return {
          hostnameByIpAddress: new Map<string, string>(
            Object.entries(data.names),
          ),
          statusByIpAddress: statusByIpAddress,
          failedAddressCount: timedOut.length,
          isReverseDnsAvailable: true,
          isTimeBudgetExhausted: false,
          lookedUpCount: distinct.length,
          notLookedUpCount: 0,
          totalBudgetInMs: 60000,
        };
      },
    );
}

/*
 * The NetBIOS seam: names for some addresses, "no reply" for the rest it was
 * handed — the commonest answer from anything that is not Windows. Records
 * what it was asked.
 */
function mockNetbios(names: Record<string, string>): Array<Array<string>> {
  const asked: Array<Array<string>> = [];

  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<NetbiosNameResolution> => {
        asked.push([...ipAddresses]);

        const distinct: Array<string> = Array.from(
          new Set<string>(ipAddresses),
        );
        const statusByIpAddress: Map<string, DiscoveredHostNetbiosStatus> =
          new Map<string, DiscoveredHostNetbiosStatus>();

        for (const ipAddress of distinct) {
          if (!names[ipAddress]) {
            statusByIpAddress.set(
              ipAddress,
              DiscoveredHostNetbiosStatus.NoReply,
            );
          }
        }

        return {
          nameByIpAddress: new Map<string, string>(Object.entries(names)),
          statusByIpAddress: statusByIpAddress,
          queriedCount: distinct.length,
          skippedCount: 0,
          isTimeBudgetExhausted: false,
          isHostCapReached: false,
          eligibleCount: distinct.length,
          maxHosts: 2000,
          totalBudgetInMs: 30000,
        };
      },
    );

  return asked;
}

function customerSweep(isNetbiosLookupEnabled?: boolean): SubnetScanConfig {
  return {
    cidr: CUSTOMER_TARGET,
    isSnmpEnabled: false,
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  };
}

function snmpConfig(): SubnetScanSnmpConfig {
  return {
    id: "config-1",
    label: "v2c on 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
  };
}

const GENEROUS_DEADLINE_IN_MS: number = 30000;

function sweep(config: SubnetScanConfig): Promise<SubnetScanResult> {
  return scanWithDeadline(config, "scan-3916", GENEROUS_DEADLINE_IN_MS);
}

function hostAt(
  result: SubnetScanResult,
  ipAddress: string,
): DiscoveredHost | undefined {
  return result.discoveredHosts.find((host: DiscoveredHost) => {
    return host.ipAddress === ipAddress;
  });
}

function loggedLines(spy: unknown): string {
  return (spy as { mock: { calls: Array<Array<unknown>> } }).mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

// The customer's scan row, as the server hands it to the probe.
function customerScanRow(
  isNetbiosLookupEnabled?: boolean,
): NetworkDeviceDiscoveryScan {
  return {
    id: ObjectID.generate(),
    cidr: CUSTOMER_TARGET,
    isSnmpEnabled: false,
    snmpVersion: null,
    snmpCommunityString: null,
    snmpPort: null,
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  } as unknown as NetworkDeviceDiscoveryScan;
}

// Every body POSTed to the result endpoint, partial and final, in order.
function resultUploads(
  fetchSpy: ReturnType<typeof jest.spyOn>,
): Array<JSONObject> {
  return (fetchSpy.mock.calls as Array<Array<JSONObject>>)
    .map((call: Array<JSONObject>) => {
      return call[0]!;
    })
    .filter((arg: JSONObject) => {
      return String(arg["url"]) === RESULT_URL;
    })
    .map((arg: JSONObject) => {
      return arg["data"] as JSONObject;
    });
}

function finalUpload(fetchSpy: ReturnType<typeof jest.spyOn>): JSONObject {
  const finals: Array<JSONObject> = resultUploads(fetchSpy).filter(
    (body: JSONObject) => {
      return body["isPartial"] !== true;
    },
  );

  expect(finals).toHaveLength(1);

  return finals[0]!;
}

/*
 * Both post-sweep seams stubbed for every test (installReverseDnsStub installs
 * the NetBIOS stub too); tests about naming install their own doubles on top.
 * No test here restores mocks mid-test: a test that needs a different double
 * re-spies the seam, which replaces the implementation and leaves every other
 * stub — ping above all — where it is.
 */
stubReverseDnsAsResolvingNothing();

beforeEach(() => {
  // SNMP answers nothing unless a test says otherwise: no real GET leaves.
  mockSnmp({});
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the reported scan — four of twelve named, and every other host says why", () => {
  beforeEach(() => {
    mockPingAlive(CUSTOMER_HOSTS);
    mockReverseDns({ names: CUSTOMER_NAMES, timedOut: TIMED_OUT_HOSTS });
  });

  it("stamps a reverse-DNS code on each of the eight unnamed hosts and none on the four named", async () => {
    const result: SubnetScanResult = await sweep(customerSweep());

    expect(result.discoveredHosts).toHaveLength(12);
    expect(result.scannedHostCount).toBe(15);

    for (const [ipAddress, name] of Object.entries(CUSTOMER_NAMES)) {
      expect(hostAt(result, ipAddress)).toStrictEqual({
        ipAddress: ipAddress,
        snmpReachable: false,
        dnsHostname: name,
      });
    }

    for (const ipAddress of TIMED_OUT_HOSTS) {
      expect(hostAt(result, ipAddress)).toStrictEqual({
        ipAddress: ipAddress,
        snmpReachable: false,
        dnsHostnameStatus: "timeout",
      });
    }

    for (const ipAddress of NO_RECORD_HOSTS) {
      expect(hostAt(result, ipAddress)).toStrictEqual({
        ipAddress: ipAddress,
        snmpReachable: false,
        dnsHostnameStatus: "no-record",
      });
    }
  });

  it("carries the two failures on the verdict, and the message names them", async () => {
    const result: SubnetScanResult = await sweep(customerSweep());

    expect(result.reverseDnsOutcome).toMatchObject({
      resolvedCount: 4,
      addressCount: 12,
      namedAddressCount: 4,
      failedAddressCount: 2,
      isReverseDnsAvailable: true,
      isTimeBudgetExhausted: false,
    });

    /*
     * The message the customer's screenshot showed was the headline alone.
     * The six addresses with no record are still not mentioned — the DNS
     * server answered for them — while the two it never answered are.
     */
    expect(buildScanStatusMessage(result, 0)).toBe(
      `${CUSTOMER_HEADLINE} ${FAILED_LOOKUPS_SENTENCE}`,
    );
  });

  it("with NetBIOS off, stamps no NetBIOS code and says nothing about NetBIOS", async () => {
    /*
     * A scan that did not ask for NetBIOS is described by its own toggle, on
     * the dashboard. A code per host would be thousands of copies of that
     * one scan-wide fact.
     */
    const result: SubnetScanResult = await sweep(customerSweep());

    expect(
      result.discoveredHosts.some((host: DiscoveredHost) => {
        return "netbiosNameStatus" in host;
      }),
    ).toBe(false);
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
    expect(SubnetScanner.resolveNetbiosNames).not.toHaveBeenCalled();
  });

  it("the codes survive the dashboard's whitelist and become different explanations", async () => {
    /*
     * The other half of the pipeline, in Common: the jsonb round trip,
     * normalizeDiscoveredHosts (which deletes anything off the whitelist), and
     * the explanation the Review dialog puts in the (i). Asserted loosely on
     * the copy — that is the dashboard's to word — but strictly on what
     * matters: named rows get no explanation, and a timeout does not read the
     * same as a missing record.
     */
    const result: SubnetScanResult = await sweep(customerSweep());
    const stored: Array<DiscoveredNetworkDevice> = JSON.parse(
      JSON.stringify(result.discoveredHosts),
    ) as Array<DiscoveredNetworkDevice>;
    const normalized: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(stored);

    const explain: (
      ipAddress: string,
    ) => DiscoveredHostNamingExplanation | undefined = (
      ipAddress: string,
    ): DiscoveredHostNamingExplanation | undefined => {
      return explainUnnamedDiscoveredHost({
        host: normalized.find((host: DiscoveredNetworkDevice) => {
          return host.ipAddress === ipAddress;
        }),
        scan: {
          status: "Completed",
          isSnmpEnabled: false,
          isNetbiosLookupEnabled: false,
        },
      });
    };

    expect(normalized).toHaveLength(12);
    expect(
      normalized.find((host: DiscoveredNetworkDevice) => {
        return host.ipAddress === TIMED_OUT_HOSTS[0];
      })?.dnsHostnameStatus,
    ).toBe("timeout");

    for (const ipAddress of Object.keys(CUSTOMER_NAMES)) {
      expect(explain(ipAddress)).toBeUndefined();
    }

    const timedOut: DiscoveredHostNamingExplanation | undefined = explain(
      TIMED_OUT_HOSTS[0]!,
    );
    const noRecord: DiscoveredHostNamingExplanation | undefined = explain(
      NO_RECORD_HOSTS[0]!,
    );

    expect(timedOut).toBeDefined();
    expect(noRecord).toBeDefined();
    expect(timedOut!.text).not.toBe(noRecord!.text);
    expect(timedOut!.text).toContain("Reverse DNS");
    // Nothing the scanned network chose reaches the tooltip — not the address.
    expect(timedOut!.text).not.toContain(TIMED_OUT_HOSTS[0]!);
  });

  it("through runScan, uploads the codes verbatim and the message that names the failures", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);

    await runScan(customerScanRow());

    const body: JSONObject = finalUpload(fetchSpy);

    expect(body["success"]).toBe(true);
    expect(body["scannedHostCount"]).toBe(15);
    expect(body["statusMessage"]).toBe(
      `${CUSTOMER_HEADLINE} ${FAILED_LOOKUPS_SENTENCE}`,
    );

    // Exact and in order: the upload is the sweep's hosts, nothing added.
    expect(body["discoveredDevices"]).toEqual(
      CUSTOMER_HOSTS.map((ipAddress: string): JSONObject => {
        const device: JSONObject = {
          ipAddress: ipAddress,
          snmpReachable: false,
        };

        if (CUSTOMER_NAMES[ipAddress]) {
          device["dnsHostname"] = CUSTOMER_NAMES[ipAddress] as JSONValue;
        } else {
          device["dnsHostnameStatus"] = TIMED_OUT_HOSTS.includes(ipAddress)
            ? "timeout"
            : "no-record";
        }

        return device;
      }),
    );
  });

  it("the same scan with every lookup answered keeps the codes and the silence", async () => {
    /*
     * Six addresses with no record and no failures is the healthy case the
     * message has always been silent about, and still is. The codes are how
     * the operator learns, per host, that the DNS server answered "no record"
     * — which is also what tells them to go and look at the reverse zone.
     *
     * Re-spying replaces the describe's double in place; nothing is restored,
     * so the ping stub the sweep depends on stays where it is.
     */
    mockReverseDns({ names: CUSTOMER_NAMES });

    const result: SubnetScanResult = await sweep(customerSweep());

    expect(result.reverseDnsOutcome?.failedAddressCount).toBe(0);
    expect(buildScanStatusMessage(result, 0)).toBe(CUSTOMER_HEADLINE);
    expect(hostAt(result, TIMED_OUT_HOSTS[0]!)?.dnsHostnameStatus).toBe(
      "no-record",
    );
  });
});

describe("the reported scan on the bundled global probe, with NetBIOS ticked", () => {
  /*
   * The bundled self-hosted probes register with REGISTER_PROBE_KEY and so
   * are global probes, which never send NetBIOS queries. The scan form ticks
   * NetBIOS lookup by default. Before #3916 the skip left one debug line on a
   * probe logging at ERROR, and the hosts came back as bare addresses with no
   * hint the lookup had never run.
   */
  beforeEach(() => {
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    mockPingAlive(CUSTOMER_HOSTS);
    mockReverseDns({ names: CUSTOMER_NAMES, timedOut: TIMED_OUT_HOSTS });
  });

  it("stamps 'skipped on a global probe' on exactly the eight hosts NetBIOS would have asked", async () => {
    const result: SubnetScanResult = await sweep(customerSweep(true));

    for (const ipAddress of Object.keys(CUSTOMER_NAMES)) {
      expect(hostAt(result, ipAddress)).not.toHaveProperty("netbiosNameStatus");
    }

    for (const ipAddress of [...TIMED_OUT_HOSTS, ...NO_RECORD_HOSTS]) {
      expect(hostAt(result, ipAddress)?.netbiosNameStatus).toBe(
        DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
      );
      // Beside its reverse-DNS code, not instead of it.
      expect(hostAt(result, ipAddress)?.dnsHostnameStatus).toEqual(
        expect.any(String),
      );
    }

    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBe(true);
  });

  it("still never asks, never reports a NetBIOS verdict, and keeps its debug line", async () => {
    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(SubnetScanner.resolveNetbiosNames).not.toHaveBeenCalled();
    // No lookup ran, so there is no verdict and no count — only the skip.
    expect(result.netbiosOutcome).toBeUndefined();
    expect(result.netbiosResolvedCount).toBeUndefined();
    expect(loggedLines(logger.debug)).toMatch(
      /asked for NetBIOS names, but this is a global probe/,
    );
  });

  it("the message says both what reverse DNS could not do and that NetBIOS never ran", async () => {
    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(buildScanStatusMessage(result, 0)).toBe(
      `${CUSTOMER_HEADLINE} ${FAILED_LOOKUPS_SENTENCE} ${NETBIOS_GLOBAL_PROBE_SENTENCE}`,
    );
  });

  it("through runScan, uploads both codes on each unnamed host", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);

    await runScan(customerScanRow(true));

    const body: JSONObject = finalUpload(fetchSpy);
    const devices: Array<JSONObject> = body[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(body["statusMessage"]).toBe(
      `${CUSTOMER_HEADLINE} ${FAILED_LOOKUPS_SENTENCE} ${NETBIOS_GLOBAL_PROBE_SENTENCE}`,
    );
    expect(
      devices.find((device: JSONObject) => {
        return device["ipAddress"] === "10.16.42.61";
      }),
    ).toEqual({
      ipAddress: "10.16.42.61",
      snmpReachable: false,
      dnsHostnameStatus: "timeout",
      netbiosNameStatus: "skipped-global-probe",
    });
    expect(
      devices.find((device: JSONObject) => {
        return device["ipAddress"] === "10.16.42.52";
      }),
    ).toEqual({
      ipAddress: "10.16.42.52",
      snmpReachable: false,
      dnsHostname: "WB0024KDS02.wbhq.com",
    });
  });

  it("never stamps a host SNMP named, on an SNMP sweep", async () => {
    mockSnmp({ "10.16.42.51": "kds-controller" });

    const result: SubnetScanResult = await sweep({
      cidr: CUSTOMER_TARGET,
      snmpConfigs: [snmpConfig()],
      isNetbiosLookupEnabled: true,
    });

    expect(hostAt(result, "10.16.42.51")?.sysName).toBe("kds-controller");
    expect(hostAt(result, "10.16.42.51")).not.toHaveProperty(
      "netbiosNameStatus",
    );
    // Nor the reverse-DNS code the resolver reported for its address.
    expect(hostAt(result, "10.16.42.51")).not.toHaveProperty(
      "dnsHostnameStatus",
    );
    expect(hostAt(result, "10.16.42.53")?.netbiosNameStatus).toBe(
      DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
    );
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBe(true);
  });

  it("stamps nothing and says nothing when the scan did not ask for NetBIOS", async () => {
    for (const flag of [undefined, false, "true", 1]) {
      const result: SubnetScanResult = await sweep(
        customerSweep(flag as unknown as boolean),
      );

      expect(
        result.discoveredHosts.some((host: DiscoveredHost) => {
          return "netbiosNameStatus" in host;
        }),
      ).toBe(false);
      expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
      expect(buildScanStatusMessage(result, 0)).not.toContain("NetBIOS");
    }
  });

  it("stamps nothing and says nothing when SNMP and reverse DNS named every host", async () => {
    // NetBIOS would not have been sent to anyone: there is no gap to explain.
    mockPingAlive(Object.keys(CUSTOMER_NAMES));
    mockReverseDns({ names: CUSTOMER_NAMES });

    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(result.discoveredHosts).toHaveLength(4);
    expect(
      result.discoveredHosts.some((host: DiscoveredHost) => {
        return "netbiosNameStatus" in host;
      }),
    ).toBe(false);
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
    expect(buildScanStatusMessage(result, 0)).not.toContain("NetBIOS");
  });

  it("stamps nothing when the sweep found nothing", async () => {
    mockPingAlive([]);

    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(result.discoveredHosts).toEqual([]);
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
  });

  it("a stamping step that throws still returns the sweep's hosts", async () => {
    /*
     * Unreachable — the stamping never throws — and pinned anyway, because
     * the one thing this branch must never do is turn a finished sweep into
     * a Failed scan with no hosts.
     */
    jest
      .spyOn(SubnetScanner, "stampNetbiosStatusOnUnnamedHosts")
      .mockImplementation(() => {
        throw new Error("status stamping blew up");
      });

    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(result.discoveredHosts).toHaveLength(12);
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
    expect(loggedLines(logger.warn)).toMatch(/status stamping blew up/);
  });
});

describe("the reported scan on a custom probe, with NetBIOS ticked", () => {
  beforeEach(() => {
    mockPingAlive(CUSTOMER_HOSTS);
    mockReverseDns({ names: CUSTOMER_NAMES, timedOut: TIMED_OUT_HOSTS });
  });

  it("asks exactly the eight, and stamps the resolver's code on the seven it could not name", async () => {
    const asked: Array<Array<string>> = mockNetbios({
      "10.16.42.51": "WB0024KDS01",
    });

    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(asked).toEqual([[...NO_RECORD_HOSTS, ...TIMED_OUT_HOSTS].sort()]);
    expect(hostAt(result, "10.16.42.51")).toStrictEqual({
      ipAddress: "10.16.42.51",
      snmpReachable: false,
      dnsHostnameStatus: "no-record",
      netbiosName: "wb0024kds01",
    });

    for (const ipAddress of [...NO_RECORD_HOSTS.slice(1), ...TIMED_OUT_HOSTS]) {
      expect(hostAt(result, ipAddress)?.netbiosNameStatus).toBe(
        DiscoveredHostNetbiosStatus.NoReply,
      );
    }

    for (const ipAddress of Object.keys(CUSTOMER_NAMES)) {
      expect(hostAt(result, ipAddress)).not.toHaveProperty("netbiosNameStatus");
    }

    // A lookup that ran: its own verdict, and no global-probe skip.
    expect(result.netbiosOutcome?.namedAddressCount).toBe(1);
    expect(result.isNetbiosLookupSkippedOnGlobalProbe).toBeUndefined();
    expect(
      result.discoveredHosts.some((host: DiscoveredHost) => {
        return (
          host.netbiosNameStatus ===
          DiscoveredHostNetbiosStatus.SkippedGlobalProbe
        );
      }),
    ).toBe(false);
  });

  it("a lookup that asked everyone says nothing about NetBIOS on the message", async () => {
    /*
     * "No reply" from seven kitchen displays is UDP 137 doing what it does on
     * devices that are not Windows. Per host, the (i) says so; on the message
     * it would be noise on every scan.
     */
    mockNetbios({});

    const result: SubnetScanResult = await sweep(customerSweep(true));

    expect(buildScanStatusMessage(result, 0)).toBe(
      `${CUSTOMER_HEADLINE} ${FAILED_LOOKUPS_SENTENCE}`,
    );
  });
});

describe("progress uploads carry no names and no codes", () => {
  it("the partial upload taken during the sweep has neither; the final one has both", async () => {
    /*
     * Names — and so the reasons for their absence — are looked up only after
     * the sweep has won its deadline race. A snapshot taken during the sweep
     * is a copy of each host, so stamping the final hosts cannot reach back
     * into what the partial upload already sent.
     */
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    const hosts: Array<DiscoveredHost> = CUSTOMER_HOSTS.map(
      (ipAddress: string): DiscoveredHost => {
        return { ipAddress: ipAddress, snmpReachable: false };
      },
    );

    jest
      .spyOn(SubnetScanner, "scan")
      .mockImplementation(
        async (config: SubnetScanConfig): Promise<SubnetScanResult> => {
          await config.onProgress?.({
            sweptHostCount: 12,
            totalHostCount: 15,
            discoveredHosts: hosts.map((host: DiscoveredHost) => {
              return { ...host };
            }),
            snmpResponderCount: 0,
            respondedToPingCount: 12,
            isIcmpOnlySweep: true,
          });

          return {
            discoveredHosts: hosts,
            scannedHostCount: 15,
            scannedPorts: [],
            responderCountByConfigId: {},
            respondedToPingCount: 12,
            snmpErrorHostCount: 0,
            icmpFilteredFallbackHostCount: 0,
            isIcmpOnlySweep: true,
            isIcmpSweepIncomplete: false,
          };
        },
      );
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    mockReverseDns({ names: CUSTOMER_NAMES, timedOut: TIMED_OUT_HOSTS });

    await runScan(customerScanRow(true));

    const uploads: Array<JSONObject> = resultUploads(fetchSpy);
    const partials: Array<JSONObject> = uploads.filter((body: JSONObject) => {
      return body["isPartial"] === true;
    });

    expect(partials.length).toBeGreaterThanOrEqual(1);

    for (const partial of partials) {
      for (const device of partial["discoveredDevices"] as Array<JSONObject>) {
        expect(device).not.toHaveProperty("dnsHostname");
        expect(device).not.toHaveProperty("dnsHostnameStatus");
        expect(device).not.toHaveProperty("netbiosNameStatus");
      }

      expect(partial["statusMessage"] as string).not.toContain("NetBIOS");
      expect(partial["statusMessage"] as string).not.toContain("Reverse DNS");
    }

    const final: JSONObject = finalUpload(fetchSpy);
    const finalDevices: Array<JSONObject> = final[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(
      finalDevices.filter((device: JSONObject) => {
        return device["netbiosNameStatus"] === "skipped-global-probe";
      }),
    ).toHaveLength(8);
    expect(
      finalDevices.filter((device: JSONObject) => {
        return typeof device["dnsHostname"] === "string";
      }),
    ).toHaveLength(4);
    // The final upload is the LAST one, so no partial can land after it.
    expect(uploads[uploads.length - 1]).toBe(final);
  });
});
