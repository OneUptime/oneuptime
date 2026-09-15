// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * A custom (non-global) probe unless a test says otherwise. Cleared before any
 * import, because Config.ts reads it once at load and the developer's shell
 * may happen to carry one.
 */
delete process.env["REGISTER_PROBE_KEY"];

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

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
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import {
  DiscoveryNetbiosPolicy,
  runScan,
  scanWithDeadline,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * OneUptime issue #3677 — "Review Discovered Devices" lists hosts with no DNS
 * record and no SNMP as bare IP addresses.
 *
 * The probe can now ask such hosts for their NetBIOS name. The lookup itself
 * (packets, pacing, budgets, which replies count) is pinned against a fake
 * socket in Tests/Utils/Discovery/NetbiosNameResolver.test.ts. THIS file pins
 * where and when the lookup runs, driving scanWithDeadline — and runScan for
 * the scan-row flag — because every one of those decisions is about the job,
 * not the resolver:
 *
 *   1. Only hosts that are STILL unnamed are asked: no sysName, no
 *      dnsHostname. On both return paths of the sweep.
 *   2. It never runs unless the scan opted in with a literal true, and never
 *      on a global probe, whatever the row says. It sends UDP 137 to scanned
 *      hosts; nothing about that may happen by default.
 *   3. It never costs a sweep its results — not when it throws, and not when
 *      it is slower than the sweep's whole deadline.
 *   4. It leaves hosts it could not name exactly as they were: no
 *      `netbiosName` key at all.
 */

const SIX_HOSTS: string = "10.0.0.0/29";

function snmpConfig(): SubnetScanSnmpConfig {
  return {
    id: "config-1",
    label: "v2c on 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
  };
}

// Answers the ICMP pre-sweep for `aliveHosts`; nothing forks a real ping.
function mockPingAlive(aliveHosts: Array<string>): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts.includes(host);
    });
}

// Hosts listed answer SNMP with that sysName; every other host answers nothing.
function mockSnmp(sysNameByHost: Record<string, string>): void {
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      const sysName: string | undefined = sysNameByHost[config.hostname || ""];

      return sysName !== undefined ? { sysName: sysName } : null;
    });
}

function mockReverseDns(hostnameByIpAddress: Record<string, string>): void {
  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(async (): Promise<ReverseDnsResolution> => {
      return {
        hostnameByIpAddress: new Map<string, string>(
          Object.entries(hostnameByIpAddress),
        ),
        isReverseDnsAvailable: true,
        isTimeBudgetExhausted: false,
      };
    });
}

/*
 * Replaces the NetBIOS seam with a fixed table and records every list of
 * addresses it was asked about: "who was asked, and was anyone asked at all"
 * is most of what this file checks.
 */
function mockNetbios(
  nameByIpAddress: Record<string, string>,
  options?: { delayInMs?: number },
): { asked: Array<Array<string>> } {
  const asked: Array<Array<string>> = [];

  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<NetbiosNameResolution> => {
        asked.push([...ipAddresses]);

        if (options?.delayInMs) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, options.delayInMs);
          });
        }

        return {
          nameByIpAddress: new Map<string, string>(
            Object.entries(nameByIpAddress),
          ),
          queriedCount: ipAddresses.length,
          skippedCount: 0,
          isTimeBudgetExhausted: false,
          isHostCapReached: false,
        };
      },
    );

  return { asked: asked };
}

function icmpOnly(isNetbiosLookupEnabled?: boolean): SubnetScanConfig {
  return {
    cidr: SIX_HOSTS,
    isSnmpEnabled: false,
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  };
}

function withSnmp(isNetbiosLookupEnabled?: boolean): SubnetScanConfig {
  return {
    cidr: SIX_HOSTS,
    snmpConfigs: [snmpConfig()],
    isNetbiosLookupEnabled: isNetbiosLookupEnabled,
  };
}

const GENEROUS_DEADLINE_IN_MS: number = 30000;

function sweep(
  config: SubnetScanConfig,
  deadlineInMs: number = GENEROUS_DEADLINE_IN_MS,
): Promise<SubnetScanResult> {
  return scanWithDeadline(config, "scan-3677", deadlineInMs);
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

/*
 * Covers BOTH post-sweep seams for every test: installReverseDnsStub installs
 * the NetBIOS stub too. Tests about naming then replace either seam with a
 * table of their own.
 */
stubReverseDnsAsResolvingNothing();

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who gets asked — only hosts that are still unnamed", () => {
  it("on an ICMP-only sweep, skips hosts reverse DNS already named", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockReverseDns({ "10.0.0.1": "gw.corp.example.com" });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.2": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([["10.0.0.2", "10.0.0.3"]]);
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("reg01");
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("on an SNMP sweep, skips hosts with a sysName and hosts with a PTR name", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    mockReverseDns({ "10.0.0.3": "printer.corp.example.com" });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.2": "cam-lobby",
    });

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(netbios.asked).toEqual([["10.0.0.2"]]);
    expect(hostAt(result, "10.0.0.2")?.netbiosName).toBe("cam-lobby");
    // A named host is never handed a NetBIOS name, even if the table has one.
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(hostAt(result, "10.0.0.3")).not.toHaveProperty("netbiosName");
  });

  it("treats a blank sysName as no name at all", async () => {
    /*
     * An SNMP agent whose sysName varbind came back empty is exactly as
     * nameless as a ping-only host, and the Review dialog would show it as an
     * address either way.
     */
    mockPingAlive(["10.0.0.1"]);
    mockSnmp({ "10.0.0.1": "   " });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "blank-agent",
    });

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(netbios.asked).toEqual([["10.0.0.1"]]);
    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("blank-agent");
  });

  it("asks nothing when every host already has a name", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockReverseDns({
      "10.0.0.1": "a.corp.example.com",
      "10.0.0.2": "b.corp.example.com",
    });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    // It RAN — it just had nobody to ask — so the count is zero, not absent.
    expect(result.netbiosResolvedCount).toBe(0);
  });

  it("asks nothing when the sweep found nothing", async () => {
    mockPingAlive([]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(result.discoveredHosts).toEqual([]);
  });
});

describe("what a host looks like afterwards", () => {
  it("stores the name lower-cased and normalised, whatever the seam returned", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "WORKSTATION-01", "10.0.0.2": "BAD NAME" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("workstation-01");
    // Not a usable name, so not a name at all.
    expect(hostAt(result, "10.0.0.2")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("leaves an unresolved host with no netbiosName key, so old literals still match", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockNetbios({ "10.0.0.1": "reg01" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(hostAt(result, "10.0.0.1")).toEqual({
      ipAddress: "10.0.0.1",
      snmpReachable: false,
      netbiosName: "reg01",
    });
    expect(hostAt(result, "10.0.0.2")).toStrictEqual({
      ipAddress: "10.0.0.2",
      snmpReachable: false,
    });
  });

  it("ignores a name for an address the sweep never found", async () => {
    mockPingAlive(["10.0.0.1"]);
    mockNetbios({ "10.0.0.1": "reg01", "10.0.0.99": "ghost" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(1);
    expect(result.netbiosResolvedCount).toBe(1);
  });

  it("leaves the sweep's order and tallies alone", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
    mockNetbios({ "10.0.0.4": "middle" });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(
      result.discoveredHosts.map((host: DiscoveredHost) => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.4", "10.0.0.6"]);
    expect(result.scannedHostCount).toBe(6);
    expect(result.respondedToPingCount).toBe(3);
  });
});

describe("when it runs at all — opt-in, and never on a global probe", () => {
  it("does not ask when the scan config has no flag", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly());

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    // Did not run, which is a different statement from "named nobody".
    expect(result.netbiosResolvedCount).toBeUndefined();
  });

  it("does not ask when the flag is false, on either sweep path", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await sweep(icmpOnly(false));
    await sweep(withSnmp(false));

    expect(netbios.asked).toEqual([]);
  });

  it("does not ask for a truthy value that is not the literal true", async () => {
    mockPingAlive(["10.0.0.1"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    for (const value of ["true", 1, {}]) {
      await sweep({
        cidr: SIX_HOSTS,
        isSnmpEnabled: false,
        isNetbiosLookupEnabled: value as unknown as boolean,
      });
    }

    expect(netbios.asked).toEqual([]);
  });

  it("does not ask on a global probe, even when the scan opted in", async () => {
    mockPingAlive(["10.0.0.1"]);
    jest.spyOn(DiscoveryNetbiosPolicy, "isGlobalProbe").mockReturnValue(true);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBeUndefined();
    expect(loggedLines(logger.debug)).toMatch(/global probe/);
  });

  it("reads the probe's real REGISTER_PROBE_KEY through Probe/Config", () => {
    /*
     * The spy above proves scanWithDeadline obeys the policy; this proves the
     * policy reads the real thing. Config.ts evaluates the key once at load,
     * so each case gets a freshly loaded module graph.
     */
    const originalKey: string | undefined = process.env["REGISTER_PROBE_KEY"];

    const isGlobalProbeWith: (key: string | undefined) => boolean = (
      key: string | undefined,
    ): boolean => {
      if (key === undefined) {
        delete process.env["REGISTER_PROBE_KEY"];
      } else {
        process.env["REGISTER_PROBE_KEY"] = key;
      }

      let isGlobal: boolean = false;

      jest.isolateModules(() => {
        const freshFetchScans: {
          DiscoveryNetbiosPolicy: { isGlobalProbe: () => boolean };
        } = jest.requireActual("../../../Jobs/Discovery/FetchScans") as {
          DiscoveryNetbiosPolicy: { isGlobalProbe: () => boolean };
        };

        isGlobal = freshFetchScans.DiscoveryNetbiosPolicy.isGlobalProbe();
      });

      return isGlobal;
    };

    try {
      expect(isGlobalProbeWith("global-probe-registration-key")).toBe(true);
      expect(isGlobalProbeWith(undefined)).toBe(false);
    } finally {
      if (originalKey === undefined) {
        delete process.env["REGISTER_PROBE_KEY"];
      } else {
        process.env["REGISTER_PROBE_KEY"] = originalKey;
      }
    }
  });
});

describe("naming never costs a sweep its results", () => {
  it("returns the sweep's hosts and warns when the NetBIOS pass throws", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    jest
      .spyOn(SubnetScanner, "attachNetbiosNames")
      .mockRejectedValue(new Error("netbios blew up"));

    const result: SubnetScanResult = await sweep(icmpOnly(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(result.netbiosResolvedCount).toBeUndefined();
    expect(loggedLines(logger.warn)).toMatch(/netbios blew up/);
  });

  it("returns the SNMP sweep's hosts when the lookup seam rejects", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmp({ "10.0.0.1": "core-switch-01" });
    jest
      .spyOn(SubnetScanner, "resolveNetbiosNames")
      .mockRejectedValue(new Error("socket factory exploded"));

    const result: SubnetScanResult = await sweep(withSnmp(true));

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("core-switch-01");
    // attachNetbiosNames caught it: the pass ran and named nobody.
    expect(result.netbiosResolvedCount).toBe(0);
    expect(loggedLines(logger.warn)).toMatch(/socket factory exploded/);
  });

  it("a NetBIOS pass slower than the whole deadline still returns the sweep's hosts", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    // 250ms of lookups against a 120ms deadline: fatal if it ran inside.
    mockNetbios({ "10.0.0.1": "reg01" }, { delayInMs: 250 });

    const result: SubnetScanResult = await sweep(icmpOnly(true), 120);

    expect(result.discoveredHosts).toHaveLength(2);
    expect(hostAt(result, "10.0.0.1")?.netbiosName).toBe("reg01");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not ask when the sweep itself misses its deadline", async () => {
    jest
      .spyOn(SubnetScanner, "scan")
      .mockImplementation((): Promise<SubnetScanResult> => {
        return new Promise<SubnetScanResult>(() => {});
      });
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await expect(sweep(icmpOnly(true), 80)).rejects.toThrow(
      /did not finish|was abandoned/i,
    );
    expect(netbios.asked).toEqual([]);
  });
});

describe("SubnetScanner.scan itself does no NetBIOS lookups", () => {
  it("returns hosts with no netbiosName and no count, even with the flag on", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "reg01",
    });

    const result: SubnetScanResult = await SubnetScanner.scan(icmpOnly(true));

    expect(netbios.asked).toEqual([]);
    expect(hostAt(result, "10.0.0.1")).not.toHaveProperty("netbiosName");
    expect(result.netbiosResolvedCount).toBeUndefined();
  });
});

describe("SubnetScanner.attachNetbiosNames — used directly", () => {
  it("returns zero and asks nothing for an empty host list", async () => {
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await expect(SubnetScanner.attachNetbiosNames([])).resolves.toBe(0);
    expect(netbios.asked).toEqual([]);
  });

  it("stamps names onto the array it was given, in place", async () => {
    mockNetbios({ "10.0.0.2": "printer" });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ];
    const same: Array<DiscoveredHost> = hosts;

    const count: number = await SubnetScanner.attachNetbiosNames(hosts);

    expect(count).toBe(1);
    expect(hosts).toBe(same);
    expect(hosts[0]).not.toHaveProperty("netbiosName");
    expect(hosts[1]!.netbiosName).toBe("printer");
  });

  it("names every entry for an address the sweep reported twice", async () => {
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.0.0.1": "twice",
    });

    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", snmpReachable: false },
      { ipAddress: "10.0.0.1", snmpReachable: false },
    ];

    await expect(SubnetScanner.attachNetbiosNames(hosts)).resolves.toBe(2);
    // De-duplication is the resolver's job; the seam sees the list as given.
    expect(netbios.asked).toHaveLength(1);
    expect(hosts[1]!.netbiosName).toBe("twice");
  });

  it("never throws, even when handed something that is not a host list", async () => {
    mockNetbios({});

    await expect(
      SubnetScanner.attachNetbiosNames(
        undefined as unknown as Array<DiscoveredHost>,
      ),
    ).resolves.toBe(0);
    await expect(
      SubnetScanner.attachNetbiosNames([
        null,
      ] as unknown as Array<DiscoveredHost>),
    ).resolves.toBe(0);
  });
});

describe("runScan — the flag comes off the scan row as a literal true", () => {
  /*
   * The row is what the server hands the probe, so this is where "an absent
   * column means off" has to hold: a new probe polling an old server must not
   * start sending UDP 137 for every scan in the project.
   */
  const scanId: ObjectID = ObjectID.generate();

  function makeIcmpOnlyScan(
    overrides?: JSONObject,
  ): NetworkDeviceDiscoveryScan {
    return {
      id: scanId,
      cidr: "10.0.0.0/24",
      isSnmpEnabled: false,
      snmpVersion: null,
      snmpCommunityString: null,
      snmpPort: null,
      ...overrides,
    } as unknown as NetworkDeviceDiscoveryScan;
  }

  function mockSweepFinding(hosts: Array<DiscoveredHost>): void {
    jest.spyOn(SubnetScanner, "scan").mockResolvedValue({
      discoveredHosts: hosts,
      scannedHostCount: 254,
      scannedPorts: [],
      responderCountByConfigId: {},
      respondedToPingCount: hosts.length,
      snmpErrorHostCount: 0,
      icmpFilteredFallbackHostCount: 0,
      isIcmpOnlySweep: true,
      isIcmpSweepIncomplete: false,
    } as SubnetScanResult);
  }

  // The final (success: true, not partial) upload's host list.
  function uploadedDevices(
    fetchSpy: ReturnType<typeof jest.spyOn>,
  ): Array<JSONObject> | undefined {
    const finalUpload: JSONObject | undefined = (
      fetchSpy.mock.calls as Array<Array<JSONObject>>
    )
      .map((call: Array<JSONObject>) => {
        return call[0]!["data"] as JSONObject;
      })
      .find((body: JSONObject) => {
        return body["success"] === true && body["isPartial"] !== true;
      });

    return finalUpload?.["discoveredDevices"] as Array<JSONObject> | undefined;
  }

  it("looks names up and uploads them when the row says true", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    mockSweepFinding([
      { ipAddress: "10.18.167.31", snmpReachable: false },
      { ipAddress: "10.18.167.32", snmpReachable: false },
    ]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.18.167.31": "reg01",
    });

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: true }));

    expect(netbios.asked).toEqual([["10.18.167.31", "10.18.167.32"]]);
    expect(uploadedDevices(fetchSpy)).toEqual([
      { ipAddress: "10.18.167.31", snmpReachable: false, netbiosName: "reg01" },
      { ipAddress: "10.18.167.32", snmpReachable: false },
    ]);
    expect(loggedLines(logger.debug)).toMatch(/1 named by NetBIOS/);
  });

  it("does not look anything up when the row has no such column", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
    mockSweepFinding([{ ipAddress: "10.18.167.31", snmpReachable: false }]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({
      "10.18.167.31": "reg01",
    });

    await runScan(makeIcmpOnlyScan());

    expect(netbios.asked).toEqual([]);
    expect(loggedLines(logger.debug)).not.toMatch(/named by NetBIOS/);
  });

  it("does not look anything up when the row says false", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
    mockSweepFinding([{ ipAddress: "10.18.167.31", snmpReachable: false }]);
    const netbios: { asked: Array<Array<string>> } = mockNetbios({});

    await runScan(makeIcmpOnlyScan({ isNetbiosLookupEnabled: false }));

    expect(netbios.asked).toEqual([]);
  });
});
