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
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SubnetScanner, {
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import { fetchAndRunScans, runScan } from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

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
      {
        ipAddress: "10.0.0.5",
        sysName: "sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
        snmpConfigId: "legacy",
      },
    ],
    scannedHostCount: 254,
    /*
     * A scan carries an ordered LIST of credential sets now, so the sweep
     * reports the distinct ports it touched and how many hosts each credential
     * answered. This default is the single-credential shape — the one a scan
     * with only the flattened columns produces.
     */
    scannedPorts: [161],
    responderCountByConfigId: { legacy: 1 },
    respondedToPingCount: 12,
    ...overrides,
  } as SubnetScanResult;
}

/*
 * The one credential set a legacy scan row resolves to, exactly as
 * buildProbeSnmpConfigs hands it to the sweep.
 *
 * Written out in full rather than asserted field by field: this object IS the
 * probe's half of the contract between the stored scan and the SNMP layer, and
 * the two conversions it encodes are both silent when they go wrong — a
 * version left as the stored spelling downgrades a v3 session to v2c in
 * cleartext, and a missing community sweeps with nothing at all.
 */
const legacyResolvedConfig: SubnetScanSnmpConfig = {
  // SnmpScanConfigUtil.LEGACY_SNMP_CONFIG_ID — the stable id for a flattened row.
  id: "legacy",
  label: "SNMP config 1 (V2c)",
  // The PARSED enum value ("2c"), not the stored spelling ("V2c").
  snmpVersion: SnmpVersion.V2c,
  communityString: "public",
  snmpV3Auth: undefined,
  port: 161,
};

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

/*
 * Reverse DNS (issue #3529) runs at the end of scanWithDeadline, on whatever
 * hosts the sweep returned — including the hosts a MOCKED SubnetScanner.scan
 * hands back. Stubbed for this whole file so no test here queries the
 * machine's real resolver; ReverseDnsStubIntegrity.test.ts fails the build if
 * a file that drives this path forgets.
 */
stubReverseDnsAsResolvingNothing();

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
      /*
       * A running sweep now reports what it has found as it goes, so the
       * config carries the callback that ships those partial results and the
       * (unset) concurrency override. Named here rather than matched loosely,
       * because this object IS the contract between the stored scan and the
       * sweep.
       */
      onProgress: expect.any(Function),
      maxConcurrency: undefined,
      cidr: "10.0.0.0/24",
      /*
       * A scan row carrying no method column is an SNMP scan — every scan
       * created before the column existed is one, and so is every scan
       * handed over by a server too old to select it (issue #3445). The
       * sweep must be configured for SNMP either way, which is why this is
       * asserted as `true` on a fixture that never sets it.
       */
      isSnmpEnabled: true,
      /*
       * The flattened snmpVersion / snmpCommunityString / snmpPort columns no
       * longer reach the sweep on their own (issue #3458): they describe ONE
       * credential set, and the sweep now takes an ordered LIST of them. So
       * the contract asserted here is the resolved list, not the columns —
       * this fixture's three columns resolving to the single legacy entry is
       * exactly the conversion buildProbeSnmpConfigs exists to perform, and
       * the whole point of pinning it is that nothing downstream re-reads the
       * flat columns.
       */
      snmpConfigs: [legacyResolvedConfig],
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

  test("ping-only hosts ride along in discoveredDevices but do not count as SNMP responders", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({
        discoveredHosts: [
          {
            ipAddress: "10.0.0.5",
            sysName: "sw1",
            sysDescr: "Cisco IOS",
            snmpReachable: true,
            snmpConfigId: "legacy",
          },
          { ipAddress: "10.0.0.9", snmpReachable: false },
        ],
      }) as never,
    );

    await runScan(makeScan());

    const body: JSONObject = fetchCalls()[0]!.body;
    const devices: Array<JSONObject> = body[
      "discoveredDevices"
    ] as Array<JSONObject>;

    // Both hosts are reported to the server…
    expect(devices).toHaveLength(2);
    expect(devices[1]).toEqual({ ipAddress: "10.0.0.9", snmpReachable: false });
    // …but the "answered SNMP" count only covers real SNMP responders.
    expect(body["statusMessage"]).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 1 answered SNMP.",
    );
  });

  /*
   * A sweep that finds nothing is the hardest discovery outcome to debug: an
   * empty subnet, an unroutable one, one where ICMP is filtered, and one full
   * of devices rejecting the scan's credentials all render as "0 of N hosts".
   * The status message is the only place those are told apart, so its content
   * is asserted rather than left to chance.
   */
  test("says so when the ICMP gate was overridden because nothing answered SNMP", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({
        discoveredHosts: [],
        respondedToPingCount: 3,
        icmpFilteredFallbackHostCount: 251,
      }) as never,
    );

    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toContain("251 ICMP-silent hosts were probed over SNMP");
    expect(message).toContain("ICMP is likely filtered");
  });

  test("names the SNMP error when hosts answered but rejected the credentials", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({
        discoveredHosts: [],
        snmpErrorHostCount: 7,
        mostCommonSnmpError: "Authentication failure",
      }) as never,
    );

    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toContain("7 host(s) replied with an SNMP error");
    expect(message).toContain("Authentication failure");
  });

  test("tells the operator what to check when nothing answered at all", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({
        discoveredHosts: [],
        respondedToPingCount: 0,
        snmpErrorHostCount: 0,
        scannedPorts: [161],
        responderCountByConfigId: { legacy: 0 },
      }) as never,
    );

    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message).toContain("Nothing answered SNMP on port 161");
    expect(message).toContain("UDP/161");
    expect(message).toContain("SNMP ACL");
  });

  /*
   * statusMessage is a varchar(500) and Postgres throws rather than truncates,
   * which would fail the result write and strand a finished scan In Progress.
   * The server clips defensively too, but the probe must not rely on that.
   */
  test("the summary stays within the statusMessage column even at its worst", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({
        discoveredHosts: [],
        scannedHostCount: 32768,
        respondedToPingCount: 32768,
        icmpFilteredFallbackHostCount: 32768,
        snmpErrorHostCount: 32768,
        mostCommonSnmpError: "E".repeat(120),
      }) as never,
    );

    await runScan(makeScan());

    const message: string = fetchCalls()[0]!.body["statusMessage"] as string;
    expect(message.length).toBeLessThanOrEqual(500);
  });

  test("a sweep that found devices stays a one-line summary", async () => {
    scanSpy.mockResolvedValue(
      makeScanResult({ snmpErrorHostCount: 0 }) as never,
    );

    await runScan(makeScan());

    expect(fetchCalls()[0]!.body["statusMessage"]).toBe(
      "Swept 254 hosts: 12 answered ICMP ping, 1 answered SNMP.",
    );
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

    /*
     * The flattened columns still describe one credential set — they are how
     * every scan written before the list column existed is configured — so the
     * sweep gets a one-entry list, with the v3 block assembled on that entry.
     */
    const sweptConfigs: Array<SubnetScanSnmpConfig> = (
      scanSpy.mock.calls[0]![0] as unknown as {
        snmpConfigs: Array<SubnetScanSnmpConfig>;
      }
    ).snmpConfigs;

    expect(sweptConfigs).toHaveLength(1);
    expect(sweptConfigs[0]!.snmpVersion).toBe(SnmpVersion.V3);
    expect(sweptConfigs[0]!.snmpV3Auth).toEqual({
      securityLevel: "authPriv",
      username: "monitoring",
      authProtocol: "SHA",
      authKey: "auth-pass",
      privProtocol: "AES",
      privKey: "priv-pass",
    });
  });
});

/*
 * github.com/OneUptime/oneuptime/issues/3445 crossed with
 * github.com/OneUptime/oneuptime/issues/3458 — the sweep config runScan builds
 * is the single object where the two changes meet, so the contract is pinned
 * here in BOTH modes rather than only in the SNMP one above.
 *
 * #3445 gave a scan a mode (`isSnmpEnabled`); #3458 replaced its one set of
 * SNMP columns with an ordered LIST of credential sets. Each has a way of
 * quietly undoing the other inside this object:
 *
 *   - buildProbeSnmpConfigs never returns an empty list. Handed a scan with no
 *     stored list it SYNTHESIZES one out of the flattened columns, which is
 *     right for a legacy SNMP scan and catastrophic for an ICMP-only one: the
 *     scan would be "Ping only" everywhere the operator can see it, and an
 *     SNMP scan on the wire. Only runScan's `isSnmpEnabled ? … : []` stands
 *     between those two, which is why the empty list is asserted rather than
 *     assumed.
 *   - the same list is what the credential summary is written from, so a list
 *     that leaks into an ICMP-only sweep comes back out in the status message
 *     the operator reads — naming credentials for a scan that opened no SNMP
 *     session.
 *
 * The service nulls the SNMP columns when a scan is saved as ICMP-only, so a
 * row like the fixture below should not exist. The probe must not RELY on
 * that: rows written before that service change, rows created through the API
 * directly, and rows whose credential list was stored by an older build all
 * reach this code carrying credentials they must not be swept with. The mode
 * is the deciding fact; the leftover columns are noise.
 */
describe("runScan — the sweep config carries the scan's mode and its credentials", () => {
  /*
   * An ICMP-only scan that still carries a full set of SNMP credentials, in
   * both shapes at once: the flattened columns from makeScan() and a stored
   * `snmpConfigs` list. Either one alone would be enough for
   * buildProbeSnmpConfigs to hand the sweep something to try.
   *
   * TWO stored sets rather than one, deliberately. The credential summary in
   * the status message only renders when a sweep ran with more than one set,
   * so a single-set fixture would make the "names no credential" assertions
   * below pass for a reason that has nothing to do with the mode. With two,
   * a leaked list is a leaked SENTENCE, and the assertion has something to
   * catch.
   */
  function makeIcmpOnlyScanWithLeftoverCredentials(): NetworkDeviceDiscoveryScan {
    return makeScan({
      isSnmpEnabled: false,
      snmpConfigs: [
        {
          id: "core",
          name: "Core switches",
          snmpVersion: "V2c",
          snmpCommunityString: "s3cret-community",
          snmpPort: 1161,
        },
        {
          id: "access",
          name: "Access switches",
          snmpVersion: "V2c",
          snmpCommunityString: "another-secret",
          snmpPort: 161,
        },
      ],
    });
  }

  function makeIcmpOnlyScanResult(
    overrides?: Partial<SubnetScanResult>,
  ): SubnetScanResult {
    return {
      /*
       * snmpReachable false and NO snmpConfigId on any host: no credential set
       * ran, so none can be said to have found these addresses. The id is what
       * the import path builds a device's credentials from, and inventing one
       * here would build managed devices out of hosts that only ever answered
       * a ping.
       */
      discoveredHosts: [
        { ipAddress: "10.0.0.5", snmpReachable: false },
        { ipAddress: "10.0.0.9", snmpReachable: false },
      ],
      scannedHostCount: 254,
      // Nothing was dialled and no credential was tried, so both are empty.
      scannedPorts: [],
      responderCountByConfigId: {},
      respondedToPingCount: 2,
      isIcmpOnlySweep: true,
      isIcmpSweepIncomplete: false,
      ...overrides,
    } as SubnetScanResult;
  }

  test("an ICMP-only scan is swept with an empty credential list, even though its row still carries credentials", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyScanResult() as never);

    await runScan(makeIcmpOnlyScanWithLeftoverCredentials());

    /*
     * Asserted as the whole object rather than field by field: what matters is
     * that NOTHING else rides along. A config that also carried the row's
     * community string would sweep exactly as an SNMP scan does the moment any
     * layer below reads a field other than this flag.
     */
    expect(scanSpy).toHaveBeenCalledWith({
      /*
       * A running sweep now reports what it has found as it goes, so the
       * config carries the callback that ships those partial results and the
       * (unset) concurrency override. Named here rather than matched loosely,
       * because this object IS the contract between the stored scan and the
       * sweep.
       */
      onProgress: expect.any(Function),
      maxConcurrency: undefined,
      cidr: "10.0.0.0/24",
      isSnmpEnabled: false,
      snmpConfigs: [],
    });
  });

  /*
   * SubnetScanner decides on `isSnmpEnabled !== false`, so anything other than
   * the literal false is an SNMP sweep. The object assertion above would still
   * pass if the flag were dropped and the empty list were read as "no
   * credentials configured", so the two halves are pinned separately: the mode
   * says whether to ask, the list says what to ask with, and neither one
   * substitutes for the other.
   */
  test("the mode reaches the sweep as the literal false and the credential list is empty rather than absent", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyScanResult() as never);

    await runScan(makeIcmpOnlyScanWithLeftoverCredentials());

    const sweptConfig: JSONObject = scanSpy.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(sweptConfig["isSnmpEnabled"]).toBe(false);
    expect(sweptConfig["snmpConfigs"]).toEqual([]);
  });

  /*
   * The credential summary is the sentence #3458 added to statusMessage, and
   * it is written from the same list this scan is not allowed to have. An
   * ICMP-only sweep must therefore never name a credential — not "answered by"
   * and not "no host answered", which on a scan that asked nobody would read
   * as a broken credential rather than as a mode.
   */
  test("an ICMP-only sweep uploads a status message that names no credential", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyScanResult() as never);

    await runScan(makeIcmpOnlyScanWithLeftoverCredentials());

    const body: JSONObject = fetchCalls()[0]!.body;
    const message: string = body["statusMessage"] as string;

    expect(message).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 2 answered ping.",
    );
    expect(message).not.toContain("Answered by credentials");
    expect(message).not.toContain("No host answered");
    // And neither credential's own name — nor its community — leaks in.
    expect(message).not.toContain("Core switches");
    expect(message).not.toContain("Access switches");
    expect(message).not.toContain("s3cret-community");
    expect(message).not.toContain("another-secret");
  });

  /*
   * The rest of the request contract this file exists to pin is unchanged by
   * the mode: the same URL, the same auth fields, the same success/scanId/host
   * payload. Asserted for the ICMP-only path too, because it is the one path
   * that takes a different branch through buildScanStatusMessage and could
   * plausibly have grown a different upload alongside it.
   */
  test("an ICMP-only sweep reports on the same endpoint, with the same auth and payload fields", async () => {
    scanSpy.mockResolvedValue(makeIcmpOnlyScanResult() as never);

    await runScan(makeIcmpOnlyScanWithLeftoverCredentials());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result",
    );

    const body: JSONObject = calls[0]!.body;
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
    expect(body["scanId"]).toBe(scanId.toString());
    expect(body["success"]).toBe(true);
    expect(body["scannedHostCount"]).toBe(254);

    /*
     * Every host is uploaded WITHOUT a credential id. runScan forwards the
     * sweep's hosts verbatim, so this is the contract that the probe never
     * stamps one on after the fact — the server stores this field on the
     * discovered-host row and the import path builds a device's credentials
     * out of it, so a fabricated id would turn a ping-only host into a
     * managed device configured with credentials nothing ever answered.
     */
    const devices: Array<JSONObject> = body[
      "discoveredDevices"
    ] as Array<JSONObject>;
    expect(devices).toHaveLength(2);
    for (const device of devices) {
      expect(device["snmpReachable"]).toBe(false);
      expect(device["snmpConfigId"]).toBeUndefined();
    }
  });

  /*
   * The other direction, and the reason the mode is read through ScanModeUtil
   * rather than off the column: a scan the server explicitly marked SNMP still
   * gets its credential list resolved and swept with. Had the two changes been
   * merged by making the credential list conditional on the raw column, a row
   * whose `isSnmpEnabled` arrived as a string, a 1, or anything else truthy-
   * but-not-`true` would have swept with an empty list — an SNMP scan that
   * silently asks nobody anything.
   */
  test("a scan explicitly marked SNMP is swept with its resolved credential list", async () => {
    await runScan(makeScan({ isSnmpEnabled: true }));

    expect(scanSpy).toHaveBeenCalledWith({
      /*
       * A running sweep now reports what it has found as it goes, so the
       * config carries the callback that ships those partial results and the
       * (unset) concurrency override. Named here rather than matched loosely,
       * because this object IS the contract between the stored scan and the
       * sweep.
       */
      onProgress: expect.any(Function),
      maxConcurrency: undefined,
      cidr: "10.0.0.0/24",
      isSnmpEnabled: true,
      snmpConfigs: [legacyResolvedConfig],
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
    expect(body["scanId"]).toBe(scanId.toString());
    /*
     * The failure report deliberately mentions NO hosts. It used to send an
     * empty array, which the server stores — and since a running sweep now
     * uploads what it has found every 30 seconds, that would erase the hosts
     * an abandoned run had already reported (OneUptime issue #3598).
     */
    expect(body).not.toHaveProperty("discoveredDevices");
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
