// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import SubnetScanner from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import { runScan } from "../../../Jobs/Discovery/FetchScans";

/*
 * github.com/OneUptime/oneuptime/issues/3078, end to end.
 *
 * Everything below the network is real: the actual SubnetScanner sweeps the
 * actual target, the actual runScan assembles the actual report. Only the two
 * things that would touch a wire are stubbed — ICMP echo and the SNMP probe —
 * so these tests describe a network rather than a set of return values, and a
 * regression anywhere between "the segment drops echo" and "what the operator
 * reads in the scans list" fails here.
 */

const scanId: ObjectID = ObjectID.generate();

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    // Six addresses: 10.244.102.1 .. 10.244.102.6.
    cidr: "10.244.102.0/29",
    snmpVersion: "V3",
    snmpV3Username: "WBNOC",
    snmpV3SecurityLevel: "authPriv",
    snmpV3AuthProtocol: "sha",
    snmpV3AuthKey: "auth-passphrase",
    snmpV3PrivProtocol: "des",
    snmpV3PrivKey: "priv-passphrase",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function reportedResult(): JSONObject {
  const call: Array<unknown> = fetchSpy.mock.calls[0] as Array<unknown>;
  return (call[0] as JSONObject)["data"] as JSONObject;
}

function reportedDevices(): Array<JSONObject> {
  return (reportedResult()["discoveredDevices"] as Array<JSONObject>) || [];
}

function reportedMessage(): string {
  return String(reportedResult()["statusMessage"] || "");
}

/*
 * A network where echo is dropped at the firewall but UDP/161 is permitted to
 * the NMS — the ordinary shape of a management VLAN, and the shape that used
 * to scan as a confident zero.
 */
function networkWhereIcmpIsFilteredAndSnmpWorks(
  snmpSpeakers: Array<string>,
): void {
  jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
      if (snmpSpeakers.includes(config.hostname || "")) {
        return { sysName: `sw-${config.hostname}`, sysDescr: "Cisco IOS" };
      }
      return null;
    });
}

/*
 * Reverse DNS (issue #3529) is the sweep's third network seam, alongside ICMP
 * and SNMP, and is stubbed out for this whole file for the same reason those
 * are: nothing here is about naming, and a unit test must not ask the
 * machine's real resolver about 10.0.0.0/8. Hosts therefore come back with no
 * dnsHostname, exactly as they did before the feature existed.
 */
stubReverseDnsAsResolvingNothing();

describe("discovery on a subnet where ICMP is filtered", () => {
  test("the devices are found and reported, not silently dropped", async () => {
    networkWhereIcmpIsFilteredAndSnmpWorks(["10.244.102.2", "10.244.102.5"]);

    await runScan(makeScan());

    const devices: Array<JSONObject> = reportedDevices();
    expect(
      devices.map((device: JSONObject) => {
        return device["ipAddress"];
      }),
    ).toEqual(["10.244.102.2", "10.244.102.5"]);
    expect(devices[0]!["sysName"]).toBe("sw-10.244.102.2");
    expect(devices[0]!["snmpReachable"]).toBe(true);
  });

  test("the report is a success with the full sweep size", async () => {
    networkWhereIcmpIsFilteredAndSnmpWorks(["10.244.102.2"]);

    await runScan(makeScan());

    expect(reportedResult()["success"]).toBe(true);
    expect(reportedResult()["scannedHostCount"]).toBe(6);
  });

  test("the status message tells the operator ICMP is being filtered", async () => {
    networkWhereIcmpIsFilteredAndSnmpWorks(["10.244.102.2"]);

    await runScan(makeScan());

    expect(reportedMessage()).toContain("0 answered ICMP ping");
    expect(reportedMessage()).toContain("1 answered SNMP");
    expect(reportedMessage()).toContain("ICMP is likely filtered");
  });
});

describe("discovery on a subnet whose devices reject the credentials", () => {
  /*
   * The other half of the reported symptom. Every host answers, every host
   * refuses the v3 user — which used to be indistinguishable from an empty
   * subnet because the errors were swallowed by a debug log.
   */
  test("names the rejection instead of reporting an empty subnet", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          _config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          onError?.(new Error("Authentication failure"));
          return null;
        },
      );

    await runScan(makeScan());

    expect(reportedMessage()).toContain("6 host(s) replied with an SNMP error");
    expect(reportedMessage()).toContain("Authentication failure");
    // The hosts are alive, so they are still reported — just not importable.
    expect(reportedDevices()).toHaveLength(6);
    expect(reportedDevices()[0]!["snmpReachable"]).toBe(false);
  });

  test("both problems at once are both reported", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(
        async (
          _config: MonitorStepSnmpMonitor,
          onError?: ((error: unknown) => void) | undefined,
        ) => {
          onError?.(new Error("Unknown user name"));
          return null;
        },
      );

    await runScan(makeScan());

    expect(reportedMessage()).toContain("ICMP is likely filtered");
    expect(reportedMessage()).toContain("Unknown user name");
  });
});

describe("discovery on a subnet the probe cannot reach at all", () => {
  /*
   * Nothing replies to anything. There is no error to quote, so the message
   * has to be the checklist — otherwise the operator's only output is a zero.
   */
  test("says what to check rather than just reporting nothing", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    await runScan(makeScan());

    expect(reportedDevices()).toHaveLength(0);
    expect(reportedMessage()).toContain("Nothing answered SNMP on port 161");
    expect(reportedMessage()).toContain("SNMP ACL allows the probe's IP");
  });

  test("names a non-default port when the scan used one", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(false);
    jest.spyOn(SnmpMonitor, "probeSystemInfo").mockResolvedValue(null);

    await runScan(makeScan({ snmpPort: 1610 }));

    expect(reportedMessage()).toContain("port 1610");
  });
});

describe("discovery on a healthy subnet", () => {
  /*
   * The fast path must stay fast: when echo works and devices answer, the
   * hosts that did not reply to ICMP are never SNMP-probed at all.
   */
  test("skips SNMP for ICMP-silent hosts and keeps the summary short", async () => {
    const probed: Array<string> = [];

    jest
      .spyOn(SubnetScanner, "isHostAliveByPing")
      .mockImplementation(async (host: string) => {
        return ["10.244.102.2", "10.244.102.3"].includes(host);
      });
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        probed.push(config.hostname || "");
        return { sysName: `sw-${config.hostname}` };
      });

    await runScan(makeScan());

    expect([...probed].sort()).toEqual(["10.244.102.2", "10.244.102.3"]);
    expect(reportedMessage()).toBe(
      "Swept 6 hosts: 2 answered ICMP ping, 2 answered SNMP.",
    );
  });

  test("mixed SNMP and ping-only hosts are both reported, and told apart", async () => {
    jest.spyOn(SubnetScanner, "isHostAliveByPing").mockResolvedValue(true);
    jest
      .spyOn(SnmpMonitor, "probeSystemInfo")
      .mockImplementation(async (config: MonitorStepSnmpMonitor) => {
        return config.hostname === "10.244.102.4"
          ? { sysName: "sw-core" }
          : null;
      });

    await runScan(makeScan());

    const devices: Array<JSONObject> = reportedDevices();
    expect(devices).toHaveLength(6);
    expect(
      devices.filter((device: JSONObject) => {
        return device["snmpReachable"] === true;
      }),
    ).toHaveLength(1);
    expect(reportedMessage()).toBe(
      "Swept 6 hosts: 6 answered ICMP ping, 1 answered SNMP.",
    );
  });
});

describe("a sweep that cannot run at all", () => {
  /*
   * Unrelated to reachability: a scan-wide misconfiguration must fail the
   * scan up front rather than sweep with the wrong settings and report a
   * confident zero.
   */
  test("an unreadable v3 privacy protocol fails the scan with its reason", async () => {
    await runScan(makeScan({ snmpV3PrivProtocol: "aes-256-gcm" }));

    expect(reportedResult()["success"]).toBe(false);
    expect(String(reportedResult()["statusMessage"])).toContain("aes-256-gcm");
    /*
     * A failure report carries no host list at all, so it cannot erase hosts
     * a running sweep had already uploaded (OneUptime issue #3598).
     */
    expect(reportedResult()).not.toHaveProperty("discoveredDevices");
  });

  test("a target that is too large fails rather than sweeping a subset", async () => {
    await runScan(makeScan({ cidr: "10.0.0.0/8" }));

    expect(reportedResult()["success"]).toBe(false);
    expect(String(reportedResult()["statusMessage"])).toContain(
      "exceeding the",
    );
  });
});
