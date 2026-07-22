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
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import SubnetScanner, {
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import { fetchAndRunScans, runScan } from "../../../Jobs/Discovery/FetchScans";

/*
 * The probe's half of the discovery-scan lifecycle:
 *
 *   POST <ingest>/probe/discovery-scan/list   → pending scans for this probe
 *   (sweep the subnet locally)
 *   POST <ingest>/probe/discovery-scan/result → hosts found, or the failure
 *
 * The server's half (claiming scans, storing results) is tested in
 * App/Tests/Telemetry/ProbeIngestDiscoveryScan.test.ts. These tests pin the
 * request contract the probe sends — URLs, auth fields, result payload shape
 * — because a drift on either side strands scans in Pending/In Progress.
 */

const scanId: ObjectID = ObjectID.generate();

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    cidr: "10.0.0.0/24",
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeScanResult(
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: [
      { ipAddress: "10.0.0.5", sysName: "sw1", sysDescr: "Cisco IOS" },
    ],
    scannedHostCount: 254,
    respondedToPingCount: 12,
    ...overrides,
  } as SubnetScanResult;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeScanResult() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type FetchCall = {
  url: string;
  body: JSONObject;
};

function fetchCalls(): Array<FetchCall> {
  return fetchSpy.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      url: String(arg["url"]),
      body: arg["data"] as JSONObject,
    };
  });
}

describe("fetchAndRunScans — fetching the probe's pending scans", () => {
  test("asks the probe-ingest list endpoint, authenticated as this probe", async () => {
    await fetchAndRunScans();

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/list",
    );
    expect(calls[0]!.body["probeId"]).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(calls[0]!.body["probeKey"]).toBe("test-probe-key");
  });

  test("runs every scan the server hands out and reports each result", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: [
        { _id: ObjectID.generate().toString(), cidr: "10.0.0.0/24" },
        { _id: ObjectID.generate().toString(), cidr: "10.1.0.0/24" },
      ],
    } as never);

    await fetchAndRunScans();

    // 1 list call + 2 result reports.
    expect(scanSpy).toHaveBeenCalledTimes(2);
    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(3);
    expect(calls[1]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result",
    );
    expect(calls[2]!.url).toBe(calls[1]!.url);
  });

  test("no pending scans: no sweep, no result report", async () => {
    await fetchAndRunScans();

    expect(scanSpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
  });
});

describe("runScan — a successful sweep", () => {
  test("sweeps with the scan's SNMP config and reports the discovered hosts", async () => {
    await runScan(makeScan());

    expect(scanSpy).toHaveBeenCalledWith({
      cidr: "10.0.0.0/24",
      snmpVersion: "V2c",
      snmpCommunityString: "public",
      snmpV3Auth: undefined,
      snmpPort: 161,
    });

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    const body: JSONObject = calls[0]!.body;
    expect(body["scanId"]).toBe(scanId.toString());
    expect(body["success"]).toBe(true);
    expect(body["scannedHostCount"]).toBe(254);
    expect(
      (body["discoveredDevices"] as Array<JSONObject>)[0]!["ipAddress"],
    ).toBe("10.0.0.5");
    // Auth rides along on the result report too.
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
  });

  test("the status message reports the ICMP pre-sweep when it ran", async () => {
    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 1 answered SNMP.",
    );
  });

  test("the status message says so when the ICMP pre-sweep was unavailable", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({ respondedToPingCount: undefined }) as never,
    );

    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toContain("ICMP pre-sweep unavailable");
    expect(message).toContain("1 answered SNMP.");
  });

  test("builds v3 credentials from the scan's flattened snmpV3 columns", async () => {
    await runScan(
      makeScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authPriv",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-pass",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-pass",
      }),
    );

    const scanArg: JSONObject = scanSpy.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(scanArg["snmpV3Auth"]).toEqual({
      securityLevel: "authPriv",
      username: "monitoring",
      authProtocol: "SHA",
      authKey: "auth-pass",
      privProtocol: "AES",
      privKey: "priv-pass",
    });
  });
});

describe("runScan — failures are reported, never swallowed", () => {
  test("a failed sweep posts success:false with the error message so the scan does not sit In Progress forever", async () => {
    scanSpy.mockRejectedValue(new Error("CIDR too large") as never);

    await runScan(makeScan());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    const body: JSONObject = calls[0]!.body;
    expect(body["success"]).toBe(false);
    expect(body["statusMessage"]).toBe("CIDR too large");
    expect(body["discoveredDevices"]).toEqual([]);
    expect(body["scanId"]).toBe(scanId.toString());
  });

  test("unreadable v3 credentials fail the scan up front instead of sweeping with wrong ones", async () => {
    await runScan(
      makeScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authpriv-typo",
      }),
    );

    // The sweep never starts; the config error is reported as the failure.
    expect(scanSpy).not.toHaveBeenCalled();
    const body: JSONObject = fetchCalls()[0]!.body;
    expect(body["success"]).toBe(false);
    expect(String(body["statusMessage"])).toContain("authpriv-typo");
  });

  test("a failing result report does not throw — the fetch loop must keep going", async () => {
    scanSpy.mockRejectedValue(new Error("sweep failed") as never);
    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    await expect(runScan(makeScan())).resolves.toBeUndefined();
  });

  test("one scan failing does not stop the next scan in the batch", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: [
        { _id: ObjectID.generate().toString(), cidr: "10.0.0.0/24" },
        { _id: ObjectID.generate().toString(), cidr: "10.1.0.0/24" },
      ],
    } as never);
    scanSpy
      .mockRejectedValueOnce(new Error("first sweep failed") as never)
      .mockResolvedValueOnce(makeScanResult() as never);

    await fetchAndRunScans();

    expect(scanSpy).toHaveBeenCalledTimes(2);
    const resultBodies: Array<JSONObject> = fetchCalls()
      .slice(1)
      .map((call: FetchCall) => {
        return call.body;
      });
    expect(resultBodies).toHaveLength(2);
    expect(resultBodies[0]!["success"]).toBe(false);
    expect(resultBodies[1]!["success"]).toBe(true);
  });
});
