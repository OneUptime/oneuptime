// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanProgress,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpHardwareIdentity from "Common/Types/Monitor/SnmpMonitor/SnmpHardwareIdentity";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * A host that answers a scan's SNMP query is asked for its MAC, model, serial
 * number and firmware, in a follow-up read, so a device nothing walks can fill
 * in those details. What these pin is the sweep's side of it: which hosts are
 * asked, with which credentials, and above all that the host stays one that
 * answered, whatever the read does.
 */

stubReverseDnsAsResolvingNothing();

const IDENTITY: SnmpHardwareIdentity = {
  scannedMacAddress: "00:1b:54:c2:7a:01",
  model: "WS-C2960X-48TS-L",
  serialNumber: "FOC1932X0K1",
  firmwareVersion: "15.2(7r)E",
  softwareVersion: "15.2(7)E2",
};

const SYSTEM_INFO: SnmpSystemInfo = {
  sysName: "edge-sw-07",
  sysObjectId: "1.3.6.1.4.1.9.1.1208",
};

function snmpConfig(
  overrides: Partial<SubnetScanSnmpConfig> = {},
): SubnetScanSnmpConfig {
  return {
    id: "config-1",
    label: "SNMP v2c on port 161",
    snmpVersion: SnmpVersion.V2c,
    communityString: "public",
    port: 161,
    ...overrides,
  };
}

function scanConfig(
  overrides: Partial<SubnetScanConfig> = {},
): SubnetScanConfig {
  return {
    cidr: "10.0.0.0/30",
    snmpConfigs: [snmpConfig()],
    ...overrides,
  };
}

// 10.0.0.1 answers SNMP; 10.0.0.2 answers ping and nothing else.
function aSubnetOfOneSnmpHost(): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async () => {
      return true;
    });
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      return config.hostname === "10.0.0.1" ? SYSTEM_INFO : null;
    });
}

function hostAt(
  result: SubnetScanResult | SubnetScanProgress,
  address: string,
): DiscoveredHost | undefined {
  return result.discoveredHosts.find((host: DiscoveredHost) => {
    return host.ipAddress === address;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubnetScanner - the follow-up read of a host that answered", () => {
  it("stamps what the host said onto its entry", async () => {
    aSubnetOfOneSnmpHost();
    jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockResolvedValue(IDENTITY);

    const result: SubnetScanResult = await SubnetScanner.scan(scanConfig());

    expect(hostAt(result, "10.0.0.1")).toEqual({
      ipAddress: "10.0.0.1",
      sysName: "edge-sw-07",
      sysObjectId: "1.3.6.1.4.1.9.1.1208",
      snmpReachable: true,
      snmpConfigId: "config-1",
      ...IDENTITY,
    });
  });

  it("asks only the hosts that answered SNMP", async () => {
    aSubnetOfOneSnmpHost();
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockResolvedValue(IDENTITY);

    const result: SubnetScanResult = await SubnetScanner.scan(scanConfig());

    expect(read).toHaveBeenCalledTimes(1);
    expect(hostAt(result, "10.0.0.2")).toEqual({
      ipAddress: "10.0.0.2",
      snmpReachable: false,
    });
  });

  it("asks nobody on an ICMP-only sweep", async () => {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async () => {
        return true;
      });
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockResolvedValue(IDENTITY);

    await SubnetScanner.scan({
      cidr: "10.0.0.0/30",
      isSnmpEnabled: false,
      snmpConfigs: [],
    });

    expect(read).not.toHaveBeenCalled();
  });

  it("uses the credential set that answered, and the sysObjectID it read", async () => {
    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async () => {
        return true;
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        return config.communityString === "right" ? SYSTEM_INFO : null;
      });
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockResolvedValue({});

    await SubnetScanner.scan(
      scanConfig({
        cidr: "10.0.0.1/32",
        snmpConfigs: [
          snmpConfig({ id: "wrong", communityString: "wrong" }),
          snmpConfig({ id: "right", communityString: "right", port: 1161 }),
        ],
      }),
    );

    expect(read).toHaveBeenCalledTimes(1);

    const [config, sysObjectId] = read.mock.calls[0]! as [
      MonitorStepSnmpMonitor,
      string,
    ];

    expect(config.hostname).toBe("10.0.0.1");
    expect(config.communityString).toBe("right");
    expect(config.port).toBe(1161);
    expect(config.timeout).toBe(2000);
    expect(config.retries).toBe(0);
    expect(sysObjectId).toBe("1.3.6.1.4.1.9.1.1208");
  });

  it("hands the read the scan's abort signal", async () => {
    aSubnetOfOneSnmpHost();
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockResolvedValue({});
    const controller: AbortController = new AbortController();

    await SubnetScanner.scan(scanConfig({ signal: controller.signal }));

    expect(read.mock.calls[0]![2]).toBe(controller.signal);
  });

  it("leaves no key on a host the read got nothing from", async () => {
    aSubnetOfOneSnmpHost();
    jest.spyOn(SnmpMonitor, "probeHardwareIdentity").mockResolvedValue({});

    const result: SubnetScanResult = await SubnetScanner.scan(scanConfig());

    expect(Object.keys(hostAt(result, "10.0.0.1")!).sort()).toEqual(
      Object.keys({
        ipAddress: "",
        sysDescr: "",
        sysName: "",
        sysObjectId: "",
        sysLocation: "",
        sysContact: "",
        sysUpTimeSeconds: 0,
        snmpReachable: true,
        snmpConfigId: "",
      }).sort(),
    );
  });

  it("keeps a sweep's workers bounded: the read runs in the worker that found the host", async () => {
    const hosts: Array<string> = [];

    for (let last: number = 1; last <= 30; last++) {
      hosts.push(`10.0.0.${last}`);
    }

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async () => {
        return true;
      });
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(SYSTEM_INFO);

    let inFlight: number = 0;
    let mostInFlight: number = 0;

    jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockImplementation(async (): Promise<SnmpHardwareIdentity> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setImmediate(resolve);
        });
        inFlight--;
        return {};
      });

    const result: SubnetScanResult = await SubnetScanner.scan(
      scanConfig({ cidr: "10.0.0.0/27", maxConcurrency: 4 }),
    );

    expect(result.discoveredHosts.length).toBe(hosts.length);
    expect(mostInFlight).toBeLessThanOrEqual(4);
  });
});

describe("SubnetScanner - nothing the read does makes a host read as not answering", () => {
  it("a read that fails leaves the host answered, counted, and with no error reported", async () => {
    aSubnetOfOneSnmpHost();
    jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockRejectedValue(new Error("Authentication failure"));

    const result: SubnetScanResult = await SubnetScanner.scan(scanConfig());

    expect(hostAt(result, "10.0.0.1")?.snmpReachable).toBe(true);
    expect(hostAt(result, "10.0.0.1")?.snmpConfigId).toBe("config-1");
    expect(hostAt(result, "10.0.0.1")?.sysName).toBe("edge-sw-07");
    expect(result.responderCountByConfigId).toEqual({ "config-1": 1 });
    expect(result.snmpErrorHostCount).toBe(0);
    expect(result.mostCommonSnmpError).toBeUndefined();
  });

  it("a read that fails does not move on to the next credential set", async () => {
    aSubnetOfOneSnmpHost();
    const systemProbe: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SnmpMonitor,
      "probeSystemInfo",
    );
    jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockRejectedValue(new Error("Request timed out"));

    await SubnetScanner.scan(
      scanConfig({
        cidr: "10.0.0.1/32",
        snmpConfigs: [
          snmpConfig({ id: "first" }),
          snmpConfig({ id: "second", communityString: "other" }),
        ],
      }),
    );

    expect(systemProbe).toHaveBeenCalledTimes(1);
  });

  it("a host is reported while its read is still running", async () => {
    aSubnetOfOneSnmpHost();

    let finishRead: (identity: SnmpHardwareIdentity) => void = () => {};

    jest.spyOn(SnmpMonitor, "probeHardwareIdentity").mockImplementation(() => {
      return new Promise<SnmpHardwareIdentity>(
        (resolve: (identity: SnmpHardwareIdentity) => void) => {
          finishRead = resolve;
        },
      );
    });

    const snapshots: Array<SubnetScanProgress> = [];
    const scanning: Promise<SubnetScanResult> = SubnetScanner.scan(
      scanConfig({
        onProgress: (progress: SubnetScanProgress): void => {
          snapshots.push(progress);
        },
      }),
    );

    await new Promise<void>((resolve: () => void) => {
      const poll: () => void = (): void => {
        if (snapshots.length > 0) {
          resolve();
          return;
        }

        setTimeout(poll, 10);
      };

      poll();
    });

    const first: DiscoveredHost | undefined = hostAt(snapshots[0]!, "10.0.0.1");
    const responderCount: number = snapshots[0]!.snmpResponderCount;

    // Before any assertion, so that a failing one leaves no sweep running.
    finishRead(IDENTITY);

    const result: SubnetScanResult = await scanning;

    expect(first?.snmpReachable).toBe(true);
    expect(first?.serialNumber).toBeUndefined();
    expect(responderCount).toBe(1);
    expect(hostAt(result, "10.0.0.1")?.serialNumber).toBe("FOC1932X0K1");
    // A copy: the read finishing does not reach into what was already reported.
    expect(first?.serialNumber).toBeUndefined();
  }, 10000);

  it("an abort during the read stops the scan with its reason", async () => {
    aSubnetOfOneSnmpHost();

    const controller: AbortController = new AbortController();
    const reason: Error = new Error("sweep deadline");

    jest
      .spyOn(SnmpMonitor, "probeHardwareIdentity")
      .mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });

    await expect(
      SubnetScanner.scan(scanConfig({ signal: controller.signal })),
    ).rejects.toBe(reason);
  });
});
