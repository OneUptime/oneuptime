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
import logger from "Common/Server/Utils/Logger";
import SubnetScanner, {
  SubnetScanResult,
  type SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { fetchAndRunScans, runScan } from "../../../Jobs/Discovery/FetchScans";

/*
 * github.com/OneUptime/oneuptime/issues/3445 — runScan for a scan whose
 * `isSnmpEnabled` is false.
 *
 * FetchScansLifecycle.test.ts pins the request contract for an SNMP scan; this
 * file pins the two decisions runScan makes on top of it for an ICMP-only one,
 * and both are the kind that fail silently:
 *
 *   1. The sweep must be CONFIGURED for ICMP only. SubnetScanner reads
 *      `isSnmpEnabled !== false`, so a config that simply omits the field
 *      sweeps SNMP — passing the flag is not a formality, it is the entire
 *      mechanism.
 *
 *   2. buildSnmpV3Auth must not run. It THROWS on an unrecognized v3 value,
 *      deliberately, so a broken credential fails the scan rather than blanking
 *      it — but a scan that never opens an SNMP session has no credential to be
 *      broken. A row carrying a stale, unreadable v3 value (switched to
 *      ping-only after a bad v3 config was saved, or upgraded from an older
 *      spelling) would otherwise fail every sweep over a value it was never
 *      going to put on the wire.
 *
 * The harness is FetchScansLifecycle's: API.fetch is stubbed so nothing leaves
 * the process, and SubnetScanner.scan is spied so no subnet is actually swept.
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

/*
 * What the server actually stores for an ICMP-only scan:
 * NetworkDeviceDiscoveryScanService.onBeforeCreate nulls every snmp* column,
 * so the row carries the mode and nothing else. Explicit nulls rather than
 * absent keys, because that is what `clearSnmpConfig` writes — omitting them
 * would let the column DEFAULT fill in "V2c"/161 instead.
 */
function makeIcmpOnlyScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return makeScan({
    isSnmpEnabled: false,
    snmpVersion: null,
    snmpCommunityString: null,
    snmpPort: null,
    ...overrides,
  });
}

function makeIcmpOnlyResult(
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    /*
     * snmpReachable false, never undefined — that flag is what routes these
     * hosts to the Monitor monitoring method on import.
     */
    discoveredHosts: [
      { ipAddress: "10.0.0.5", snmpReachable: false },
      { ipAddress: "10.0.0.9", snmpReachable: false },
    ],
    scannedHostCount: 254,
    // No port was dialled.
    scannedPort: undefined,
    respondedToPingCount: 2,
    snmpErrorHostCount: 0,
    mostCommonSnmpError: undefined,
    icmpFilteredFallbackHostCount: 0,
    isIcmpOnlySweep: true,
    isIcmpSweepIncomplete: false,
    ...overrides,
  } as SubnetScanResult;
}

function makeSnmpScanResult(
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: [
      {
        ipAddress: "10.0.0.5",
        sysName: "sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
      },
    ],
    scannedHostCount: 254,
    scannedPort: 161,
    respondedToPingCount: 12,
    ...overrides,
  } as SubnetScanResult;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");
// eslint-disable-next-line @typescript-eslint/typedef
let debugSpy = jest.spyOn(logger, "debug");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeIcmpOnlyResult() as never);
  debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {
    // Keep the test output readable.
  });
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

function sweepConfig(callIndex: number = 0): JSONObject {
  return scanSpy.mock.calls[callIndex]![0] as unknown as JSONObject;
}

/*
 * The credential sets the sweep was handed.
 *
 * A scan's credentials became an ordered LIST in issue #3458, so "what did
 * this sweep get to authenticate with?" is a question about this array rather
 * than about flat keys on the config. Typed, so an assertion against a set's
 * snmpV3Auth is checked rather than reaching into an untyped JSONObject and
 * finding undefined for a spelling that never existed.
 */
function sweptSnmpConfigs(callIndex: number = 0): Array<SubnetScanSnmpConfig> {
  return (
    (sweepConfig(callIndex)["snmpConfigs"] as
      | Array<SubnetScanSnmpConfig>
      | undefined) || []
  );
}

function loggedDebug(): string {
  return debugSpy.mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

describe("runScan — an ICMP-only scan is swept as one", () => {
  test("passes isSnmpEnabled false through to the sweep", async () => {
    await runScan(makeIcmpOnlyScan());

    expect(scanSpy).toHaveBeenCalledWith({
      cidr: "10.0.0.0/24",
      isSnmpEnabled: false,
      /*
       * EMPTY, and that is the whole assertion.
       *
       * Credentials became an ordered list in issue #3458, so the flat
       * snmpVersion/snmpCommunityString/snmpV3Auth/snmpPort keys this used to
       * pin as null no longer exist on a sweep config at all. The guarantee is
       * unchanged and is stated more directly here: an ICMP-only scan reaches
       * the sweep with NOTHING to authenticate with, however much its row
       * still carries. An exact-object assertion, so a credential set added
       * back by a later refactor fails here rather than going out on the wire.
       */
      snmpConfigs: [],
    });
  });

  /*
   * SubnetScanner reads `config.isSnmpEnabled !== false`, so anything other
   * than the literal false sweeps SNMP. An assertion on the whole config would
   * still pass if the flag were dropped and jest's undefined-vs-missing
   * leniency papered over it, so the value is pinned on its own too.
   */
  test("the flag reaches the sweep as the literal false, not as a missing key", async () => {
    await runScan(makeIcmpOnlyScan());

    expect(sweepConfig()["isSnmpEnabled"]).toBe(false);
    expect(sweepConfig()).toHaveProperty("isSnmpEnabled");
  });

  test("builds no v3 auth for the sweep", async () => {
    await runScan(makeIcmpOnlyScan());

    /*
     * Asked of the credential LIST, not of a `snmpV3Auth` key on the sweep
     * config. That key moved onto each list entry in issue #3458, so reading
     * it here would find undefined on an object that never had it and pass for
     * a reason that has nothing to do with the scan's method.
     */
    expect(sweptSnmpConfigs()).toEqual([]);
  });

  /*
   * A row that carried a complete, perfectly VALID v3 credential before it was
   * switched to ping-only. buildSnmpV3Auth would happily build it; the point is
   * that it is not built, because a config that carries credentials is one
   * refactor away from using them.
   */
  test("builds no v3 auth even from a row whose v3 columns are fully populated", async () => {
    await runScan(
      makeIcmpOnlyScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authPriv",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-pass",
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: "priv-pass",
      }),
    );

    expect(sweptSnmpConfigs()).toEqual([]);
    expect(sweepConfig()["isSnmpEnabled"]).toBe(false);
  });

  test("still sweeps the scan's target", async () => {
    await runScan(makeIcmpOnlyScan({ cidr: "192.168.7.0-63" }));

    expect(sweepConfig()["cidr"]).toBe("192.168.7.0-63");
  });
});

/*
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * buildSnmpV3Auth throws on an unrecognized security level, auth protocol or
 * privacy protocol. That is correct for an SNMP scan: one credential set is
 * reused for every host, so a single unreadable value blanks the whole sweep
 * and it is better to fail loudly. It is wrong for a scan that opens no SNMP
 * session at all — the scan would fail over a value it was never going to use,
 * and the operator would be told to fix SNMP credentials on a ping sweep.
 *
 * Each case below is asserted as a PAIR: the same broken row fails the scan
 * when SNMP is on, and runs it when SNMP is off. The failing half is what
 * proves the passing half is actually skipping the call rather than the value
 * having quietly become acceptable.
 */
describe("runScan — a broken v3 value does not fail an ICMP-only scan", () => {
  const BROKEN_V3: JSONObject = {
    snmpVersion: "V3",
    snmpV3Username: "monitoring",
    snmpV3SecurityLevel: "authpriv-typo",
  };

  test("an unrecognized security level fails an SNMP scan", async () => {
    await runScan(makeScan(BROKEN_V3));

    // buildSnmpV3Auth threw before the sweep was ever reached.
    expect(scanSpy).not.toHaveBeenCalled();
    const body: JSONObject = fetchCalls()[0]!.body;
    expect(body["success"]).toBe(false);
    expect(String(body["statusMessage"])).toContain("authpriv-typo");
  });

  test("the same unrecognized security level does not stop an ICMP-only scan", async () => {
    await runScan(makeIcmpOnlyScan(BROKEN_V3));

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const body: JSONObject = fetchCalls()[0]!.body;
    expect(body["success"]).toBe(true);
    expect(String(body["statusMessage"])).not.toContain("authpriv-typo");
  });

  test("an unrecognized auth protocol does not stop an ICMP-only scan", async () => {
    await runScan(
      makeIcmpOnlyScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authPriv",
        snmpV3AuthProtocol: "SHA-256-typo",
      }),
    );

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(fetchCalls()[0]!.body["success"]).toBe(true);
  });

  test("an unrecognized privacy protocol does not stop an ICMP-only scan", async () => {
    await runScan(
      makeIcmpOnlyScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authPriv",
        snmpV3PrivProtocol: "AES-512-typo",
      }),
    );

    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(fetchCalls()[0]!.body["success"]).toBe(true);
  });

  test("the broken value never reaches the sweep config either", async () => {
    await runScan(makeIcmpOnlyScan(BROKEN_V3));

    expect(sweptSnmpConfigs()).toEqual([]);
  });
});

/*
 * THE INVARIANT THE WHOLE CHANGE RESTS ON, at the job layer.
 *
 * runScan asks ScanModeUtil rather than reading the column, because a scan row
 * from a server too old to select `isSnmpEnabled` arrives without it. Reading
 * that absence as "off" would turn every scan in every project into a ping
 * sweep the moment a probe was upgraded ahead of its server — silently, with
 * every scan still reporting "Completed".
 */
describe("runScan — an SNMP scan is unaffected", () => {
  beforeEach(() => {
    scanSpy.mockResolvedValue(makeSnmpScanResult() as never);
  });

  test("a row with no isSnmpEnabled column is swept with SNMP on", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    expect(scan.isSnmpEnabled).toBeUndefined();

    await runScan(scan);

    expect(sweepConfig()["isSnmpEnabled"]).toBe(true);
  });

  test("a row with isSnmpEnabled true is swept with SNMP on", async () => {
    await runScan(makeScan({ isSnmpEnabled: true }));

    expect(sweepConfig()["isSnmpEnabled"]).toBe(true);
  });

  /*
   * A JSON payload can carry an explicit null where the column was not set.
   * Absence and null are the same statement, and both mean SNMP.
   */
  test("a row whose isSnmpEnabled arrived as null is swept with SNMP on", async () => {
    await runScan(makeScan({ isSnmpEnabled: null }));

    expect(sweepConfig()["isSnmpEnabled"]).toBe(true);
  });

  test("a row with no isSnmpEnabled column still builds its v3 credentials", async () => {
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

    expect(sweptSnmpConfigs()[0]!.snmpV3Auth).toEqual({
      securityLevel: "authPriv",
      username: "monitoring",
      authProtocol: "SHA",
      authKey: "auth-pass",
      privProtocol: "AES",
      privKey: "priv-pass",
    });
  });

  test("a row with isSnmpEnabled true still builds its v3 credentials", async () => {
    await runScan(
      makeScan({
        isSnmpEnabled: true,
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: "authNoPriv",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: "auth-pass",
      }),
    );

    expect(sweptSnmpConfigs()[0]!.snmpV3Auth).toEqual({
      securityLevel: "authNoPriv",
      username: "monitoring",
      authProtocol: "SHA",
      authKey: "auth-pass",
      privProtocol: undefined,
      privKey: undefined,
    });
  });

  test("the SNMP status message is unchanged", async () => {
    await runScan(makeScan());

    expect(fetchCalls()[0]!.body["statusMessage"]).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 1 answered SNMP.",
    );
  });

  test("and the SNMP scan still logs its SNMP responder count", async () => {
    await runScan(makeScan());

    const logged: string = loggedDebug();
    expect(logged).toContain("found 1 SNMP hosts (1 alive in total)");
    expect(logged).not.toContain("SNMP checking is off");
  });
});

describe("runScan — what an ICMP-only sweep uploads", () => {
  test("reports the ICMP-only status message, not the SNMP one", async () => {
    await runScan(makeIcmpOnlyScan());

    expect(fetchCalls()[0]!.body["statusMessage"]).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 2 answered ping.",
    );
  });

  /*
   * The live hazard: `snmpResponderCount === 0 && snmpErrorHostCount === 0` is
   * structurally true for every ICMP-only sweep, so without the dedicated
   * branch a healthy ping sweep that found two hosts would be annotated with
   * SNMP firewall advice for traffic the probe never sent.
   */
  test("never appends the SNMP 'nothing answered' advice to a healthy ping sweep", async () => {
    await runScan(makeIcmpOnlyScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).not.toContain("Nothing answered SNMP on port");
    expect(message).not.toContain("UDP/161");
    expect(message).not.toContain("SNMP ACL");
  });

  test("uploads every discovered host with snmpReachable false", async () => {
    await runScan(makeIcmpOnlyScan());

    const devices: Array<JSONObject> = fetchCalls()[0]!.body[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(devices).toEqual([
      { ipAddress: "10.0.0.5", snmpReachable: false },
      { ipAddress: "10.0.0.9", snmpReachable: false },
    ]);
  });

  test("reports the sweep as a success with the full scanned host count", async () => {
    await runScan(makeIcmpOnlyScan());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result",
    );

    const body: JSONObject = calls[0]!.body;
    expect(body["success"]).toBe(true);
    expect(body["scanId"]).toBe(scanId.toString());
    expect(body["scannedHostCount"]).toBe(254);
    // Auth rides along on the result report, same as any other scan.
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
  });

  test("an ICMP-only sweep that found nothing uploads the ICMP checklist", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult({
        discoveredHosts: [],
        respondedToPingCount: 0,
      }) as never,
    );

    await runScan(makeIcmpOnlyScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toContain("Nothing answered ICMP ping.");
    expect(message).toContain(
      "turn Check SNMP on if you expect managed devices",
    );
    expect(message).not.toContain("Nothing answered SNMP on port");
    expect(fetchCalls()[0]!.body["discoveredDevices"]).toEqual([]);
  });

  /*
   * A partially-covered range is still a success — the hosts are real — but the
   * caveat has to lead, because the ingest endpoint clips this column at 500
   * characters from the end.
   */
  test("an incomplete sweep uploads the stopped-early caveat first", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult({ isIcmpSweepIncomplete: true }) as never,
    );

    await runScan(makeIcmpOnlyScan());

    const body: JSONObject = fetchCalls()[0]!.body;
    const message: string = body["statusMessage"] as string;
    expect(body["success"]).toBe(true);
    expect(message.indexOf("This ping sweep stopped early")).toBe(0);
    expect(message).toContain("2 answered ping.");
  });

  /*
   * The probe's own log line, which is where an operator debugging a scan
   * looks before the dashboard tells them anything. The SNMP wording counts
   * SNMP responders — a number that is structurally zero on every ICMP-only
   * sweep — so "found 0 SNMP hosts (2 alive in total)" would be the log for a
   * healthy ping sweep that did exactly what it was asked to.
   */
  test("logs the sweep as an ICMP one rather than counting SNMP responders", async () => {
    await runScan(makeIcmpOnlyScan());

    const logged: string = loggedDebug();
    expect(logged).toContain("found 2 host(s) answering ICMP");
    expect(logged).toContain("SNMP checking is off");
    expect(logged).not.toContain("SNMP hosts");
  });

  test("the uploaded status message fits the column", async () => {
    scanSpy.mockResolvedValue(
      makeIcmpOnlyResult({
        discoveredHosts: [],
        scannedHostCount: 32768,
        respondedToPingCount: 0,
      }) as never,
    );

    await runScan(makeIcmpOnlyScan());

    expect(
      (fetchCalls()[0]!.body["statusMessage"] as string).length,
    ).toBeLessThanOrEqual(500);
  });
});

describe("runScan — an ICMP-only sweep that could not run", () => {
  /*
   * A probe container without NET_RAW cannot send an echo request, and an
   * ICMP-only sweep has nothing to fall back to — SubnetScanner throws rather
   * than reporting a confident "0 of 254", which would be indistinguishable
   * from an empty range. runScan has to turn that into a Failed scan carrying
   * the reason, or the scan sits In Progress until the server's reaper times it
   * out two hours later with nothing to show for it.
   */
  /*
   * Quoted verbatim from SubnetScanner's own throw (Probe/Utils/Discovery/
   * SubnetScanner.ts), because the assertions below are about runScan carrying
   * that sentence through UNCHANGED — a paraphrase here would still pass while
   * the operator got something else. SubnetScannerIcmpOnly.test.ts owns the
   * wording itself; this file owns the fact that it survives the round trip.
   */
  const NO_ICMP_AVAILABLE: string =
    "This scan checks ICMP only, but this probe could not send ICMP echo requests at all, so it has no way to find anything. " +
    "The probe needs the ping binary and the NET_RAW capability - OneUptime's own compose file and Helm chart grant both, so this usually means a hardened runtime dropped the capability, or a custom probe image left iputils-ping out. " +
    "Create the scan with Check SNMP on if this probe cannot be given ICMP. " +
    "Ping reported: Error: ICMP ping is not usable: ping: socket: Operation not permitted";

  test("reports success:false with the sweep's own message", async () => {
    scanSpy.mockRejectedValue(new Error(NO_ICMP_AVAILABLE) as never);

    await runScan(makeIcmpOnlyScan());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);

    const body: JSONObject = calls[0]!.body;
    expect(body["success"]).toBe(false);
    expect(body["statusMessage"]).toBe(NO_ICMP_AVAILABLE);
    expect(body["discoveredDevices"]).toEqual([]);
    expect(body["scanId"]).toBe(scanId.toString());
  });

  /*
   * The message is 555 characters, so the ingest endpoint clips it at 500 —
   * and both fixes have to be on the surviving side of that cut, or the scan
   * row says "this failed" without saying what to do about it.
   */
  test("the reported message keeps both fixes inside the 500 the server stores", async () => {
    scanSpy.mockRejectedValue(new Error(NO_ICMP_AVAILABLE) as never);

    await runScan(makeIcmpOnlyScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    const stored: string = message.substring(0, 500);
    expect(stored).toContain("NET_RAW");
    expect(stored).toContain("ping binary");
    expect(stored).toContain("Check SNMP on");
  });

  test("does not throw, so the rest of the batch still runs", async () => {
    scanSpy.mockRejectedValue(new Error(NO_ICMP_AVAILABLE) as never);

    await expect(runScan(makeIcmpOnlyScan())).resolves.toBeUndefined();
  });
});

describe("fetchAndRunScans — a batch mixing both scan modes", () => {
  /*
   * The realistic deployment: one project with ping-only scans and SNMP scans
   * on the same probe, handed over in one list response. The mode travels on
   * the row, so each scan has to be configured from its own row rather than
   * from whatever the previous one set.
   */
  test("configures each scan from its own row", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: [
        {
          _id: ObjectID.generate().toString(),
          cidr: "10.0.0.0/24",
          isSnmpEnabled: false,
        },
        {
          _id: ObjectID.generate().toString(),
          cidr: "10.1.0.0/24",
          isSnmpEnabled: true,
        },
        // A row from a server too old to select the column at all.
        { _id: ObjectID.generate().toString(), cidr: "10.2.0.0/24" },
      ],
    } as never);

    await fetchAndRunScans();

    expect(scanSpy).toHaveBeenCalledTimes(3);
    expect(sweepConfig(0)["isSnmpEnabled"]).toBe(false);
    expect(sweepConfig(1)["isSnmpEnabled"]).toBe(true);
    expect(sweepConfig(2)["isSnmpEnabled"]).toBe(true);
  });

  test("reports a result for every scan in the batch", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: [
        {
          _id: ObjectID.generate().toString(),
          cidr: "10.0.0.0/24",
          isSnmpEnabled: false,
        },
        { _id: ObjectID.generate().toString(), cidr: "10.1.0.0/24" },
      ],
    } as never);

    await fetchAndRunScans();

    // 1 list call + 2 result reports.
    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(3);
    expect(calls[1]!.body["success"]).toBe(true);
    expect(calls[2]!.body["success"]).toBe(true);
  });
});
