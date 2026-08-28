import {
  PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import SubnetScanner, {
  DiscoveredHost,
  type SubnetScanConfig,
  type SubnetScanResult,
} from "../../Utils/Discovery/SubnetScanner";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import ScanModeUtil from "Common/Utils/NetworkDiscovery/ScanModeUtil";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";

/*
 * Assembles the SnmpV3Auth the scanner needs from the scan's flattened
 * snmpV3* columns. Mirrors NetworkDeviceHydrationUtil.buildSnmpV3Auth: no
 * username means no v3 config, so return undefined and let the scan run as
 * v1/v2c.
 */
export function buildSnmpV3Auth(
  scan: NetworkDeviceDiscoveryScan,
): SnmpV3Auth | undefined {
  if (!scan.snmpV3Username) {
    return undefined;
  }

  /*
   * Validated here rather than deeper in the scan for one reason: this runs
   * inside runScan's try, so a bad value is reported back as a failed scan the
   * operator can read. The same check inside SnmpMonitor would throw once per
   * host into SubnetScanner's debug-level catch, and the scan would finish
   * "successfully" having found nothing — indistinguishable from a subnet with
   * no SNMP devices on it.
   *
   * One credential set is built per scan and reused for every host, so a
   * single unreadable value silently blanks the entire sweep.
   */
  const scanLabel: string =
    ScanNameUtil.getScanLabel(scan) || scan.id?.toString() || "scan";

  if (SnmpSecurityLevelUtil.isUnrecognized(scan.snmpV3SecurityLevel)) {
    throw new Error(
      `SNMP v3 security level "${scan.snmpV3SecurityLevel}" configured for discovery scan ${scanLabel} is not a recognized value. Expected one of: ${Object.values(
        SnmpSecurityLevel,
      ).join(", ")}.`,
    );
  }

  if (SnmpAuthProtocolUtil.isUnrecognized(scan.snmpV3AuthProtocol)) {
    throw new Error(
      `SNMP v3 authentication protocol "${scan.snmpV3AuthProtocol}" configured for discovery scan ${scanLabel} is not a recognized value. Expected one of: ${Object.values(
        SnmpAuthProtocol,
      ).join(", ")}.`,
    );
  }

  if (SnmpPrivProtocolUtil.isUnrecognized(scan.snmpV3PrivProtocol)) {
    throw new Error(
      `SNMP v3 privacy protocol "${scan.snmpV3PrivProtocol}" configured for discovery scan ${scanLabel} is not a recognized value. Expected one of: ${Object.values(
        SnmpPrivProtocol,
      ).join(", ")}.`,
    );
  }

  return {
    securityLevel:
      SnmpSecurityLevelUtil.parse(scan.snmpV3SecurityLevel) ||
      SnmpSecurityLevel.NoAuthNoPriv,
    username: scan.snmpV3Username,
    authProtocol: SnmpAuthProtocolUtil.parse(scan.snmpV3AuthProtocol),
    authKey: scan.snmpV3AuthKey || undefined,
    privProtocol: SnmpPrivProtocolUtil.parse(scan.snmpV3PrivProtocol),
    privKey: scan.snmpV3PrivKey || undefined,
  };
}

/*
 * The operator-facing summary of one sweep.
 *
 * Exported for tests: every "the scan found nothing" support case is decided
 * by whether this sentence names the reason, so its content is asserted
 * rather than left to chance.
 */
export function buildScanStatusMessage(
  scanResult: SubnetScanResult,
  snmpResponderCount: number,
): string {
  const parts: Array<string> = [];

  /*
   * An ICMP-only sweep gets its own sentence rather than a branch inside the
   * SNMP one. Every SNMP number below is zero in that mode, and each of those
   * zeroes would otherwise read as a finding: "0 answered SNMP" about a scan
   * that never asked, and — the live hazard, because the condition is
   * `snmpResponderCount === 0 && snmpErrorHostCount === 0` and both are
   * structurally zero — "Nothing answered SNMP on port 161. Check that UDP/161
   * is permitted" appended to a healthy ping sweep that found twelve hosts.
   * That advice sends the operator to a firewall rule for traffic the probe
   * never sent.
   *
   * The flag is read positively, so a result built without it (a fixture, an
   * older code path) still takes the SNMP branch it describes.
   */
  if (scanResult.isIcmpOnlySweep) {
    const aliveHostCount: number = scanResult.respondedToPingCount ?? 0;

    if (scanResult.isIcmpSweepIncomplete) {
      /*
       * FIRST, because the server clips this column at 500 characters: the
       * caveat that makes the number readable must not be the part that gets
       * eaten.
       */
      parts.push(
        "This ping sweep stopped early - the probe could not keep sending ICMP echo requests, " +
          "so an unknown part of the range was never checked. " +
          "The hosts reported are the ones confirmed before it stopped.",
      );
    }

    parts.push(
      `Swept ${scanResult.scannedHostCount} hosts with ICMP ping only ` +
        `(Check SNMP is off for this scan): ${aliveHostCount} answered ping.`,
    );

    if (aliveHostCount === 0) {
      parts.push(
        "Nothing answered ICMP ping. Check that this probe can reach the range and that ICMP echo is permitted to it. " +
          "Hosts that drop ping - Windows hosts do by default, and management VLANs often do - cannot be found by an ICMP-only scan; " +
          "turn Check SNMP on if you expect managed devices here.",
      );
    }

    return parts.join(" ");
  }

  if (scanResult.respondedToPingCount !== undefined) {
    parts.push(
      `Swept ${scanResult.scannedHostCount} hosts: ` +
        `${scanResult.respondedToPingCount} answered ICMP ping, ` +
        `${snmpResponderCount} answered SNMP.`,
    );
  } else {
    parts.push(
      `Swept ${scanResult.scannedHostCount} hosts via SNMP ` +
        `(ICMP pre-sweep unavailable on this probe): ` +
        `${snmpResponderCount} answered SNMP.`,
    );
  }

  /*
   * Say so when the ICMP gate was overridden. Otherwise the scan looks like
   * it took the fast path, and the operator has no hint that echo is being
   * dropped on the segment they are scanning.
   */
  if ((scanResult.icmpFilteredFallbackHostCount || 0) > 0) {
    parts.push(
      `No host answered SNMP among those that replied to ICMP, so all ` +
        `${scanResult.icmpFilteredFallbackHostCount} ICMP-silent hosts were probed over SNMP as well ` +
        `(ICMP is likely filtered on this network).`,
    );
  }

  /*
   * The actionable half. A device that returns "Authentication failure" is
   * reachable and speaking SNMP — the scan's credentials are simply wrong for
   * it, which is a completely different fix from "the probe cannot see this
   * subnet", and until now both showed up as an empty result.
   */
  const snmpErrorHostCount: number = scanResult.snmpErrorHostCount || 0;

  if (snmpErrorHostCount > 0 && scanResult.mostCommonSnmpError) {
    parts.push(
      `${snmpErrorHostCount} host(s) replied with an SNMP error rather than silence; ` +
        `most common: ${scanResult.mostCommonSnmpError}`,
    );
  }

  if (snmpResponderCount === 0 && snmpErrorHostCount === 0) {
    const port: number = scanResult.scannedPort || 161;
    parts.push(
      `Nothing answered SNMP on port ${port}. Check that this probe can reach the range, ` +
        `that UDP/${port} is permitted to it, and that the devices' SNMP ACL allows the probe's IP address.`,
    );
  }

  return parts.join(" ");
}

/*
 * node-cron fires every tick regardless of whether the previous run
 * finished. A subnet sweep legitimately runs for many minutes (up to 4096
 * hosts), and a slow/unresponsive server can hang the list fetch itself —
 * either way, without this guard every subsequent tick stacks another
 * request/sweep on top of the stuck one. One discovery cycle at a time.
 */
let isDiscoveryRunInProgress: boolean = false;

// Exported for tests: lets a wedged-state test reset between cases.
export function resetDiscoveryRunInProgress(): void {
  isDiscoveryRunInProgress = false;
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:DiscoveryScanFetch",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: true,
    },
    runFunction: async () => {
      if (isDiscoveryRunInProgress) {
        logger.debug(
          "Previous discovery scan run is still in progress. Skipping this tick.",
        );
        return;
      }

      isDiscoveryRunInProgress = true;

      try {
        await fetchAndRunScans();
      } catch (err) {
        logger.error("Discovery scan fetch failed");
        logger.error(err);
      } finally {
        isDiscoveryRunInProgress = false;
      }
    },
  });
};

/*
 * The server's own words for a rejected request, or "" when it accepted it.
 *
 * Exported for tests. API.fetch RETURNS a rejected request as an
 * HTTPErrorResponse rather than throwing — it only throws when no response
 * arrived at all — so a call site that merely wraps the fetch in try/catch
 * treats every 4xx and 5xx as a success. All three discovery calls need the
 * same sentence out of that response, so it is built once here.
 *
 * `instanceof` is the whole test, deliberately. Axios rejects on any status
 * outside 2xx and API.getErrorResponse turns exactly those into an
 * HTTPErrorResponse, so the type IS the verdict — and unlike
 * HTTPResponse.isSuccess(), which is `statusCode === 200`, it does not
 * misread a 201 or 204 as a rejection.
 */
export function getRejectionReason(
  result: HTTPResponse<JSONArray> | HTTPErrorResponse,
): string {
  if (!(result instanceof HTTPErrorResponse)) {
    return "";
  }

  const serverMessage: string = result.message;

  return (
    `HTTP ${result.statusCode}` + (serverMessage ? ` — ${serverMessage}` : "")
  );
}

/*
 * Exported for tests: bounds ONE sweep in time.
 *
 * Mirrors probeMonitorWithDeadline in Jobs/Monitor/FetchList.ts, and exists
 * for the same reason: Promise.race subscribes to both promises, so a sweep
 * that settles late is still observed and can never surface as an unhandled
 * rejection, and nothing here can cancel the sweep — the point is that the
 * discovery CYCLE stops waiting on it.
 *
 * That matters more here than it does for a monitor. The discovery cron holds
 * a process-lifetime single-flight guard across the whole cycle, so a sweep
 * that never settles does not cost one cycle: it stops discovery on this
 * probe permanently, and every scan queued behind it stays "Pending" until
 * the container is restarted. Rejecting on the deadline drops into runScan's
 * existing catch, which reports the scan Failed with this reason, so the
 * operator gets a sentence instead of a row that never changes.
 */
export async function scanWithDeadline(
  config: SubnetScanConfig,
  scanId: string,
  deadlineInMs: number = PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS,
): Promise<SubnetScanResult> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (err: Error) => void) => {
      deadlineTimer = setTimeout(() => {
        /*
         * Logged here, at the moment the deadline is crossed, rather than in
         * the catch below: only this branch knows the sweep stopped settling
         * rather than failing for a reason of its own, and the probe log is
         * the only place that can name WHICH sweep it was.
         */
        logger.error(
          `Discovery scan ${scanId} on ${config.cidr} did not settle within ${deadlineInMs}ms. Abandoning this sweep so discovery on this probe can continue.`,
        );

        reject(
          new Error(
            `The sweep of ${config.cidr} did not finish within ${Math.round(
              deadlineInMs / 60000,
            )} minutes and was abandoned. Narrow the scan target, or raise PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS on the probe if this range legitimately needs longer.`,
          ),
        );
      }, deadlineInMs);
    },
  );

  try {
    return await Promise.race([SubnetScanner.scan(config), deadline]);
  } finally {
    /*
     * Always clear it: an un-cleared timer holds the event loop open after an
     * otherwise healthy sweep, and this one is up to 90 minutes long.
     */
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
  }
}

// Exported for tests: this is the probe's half of the discovery lifecycle.
export async function fetchAndRunScans(): Promise<void> {
  const listUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/discovery-scan/list",
  );

  const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
    await API.fetch<JSONArray>({
      method: HTTPMethod.POST,
      url: listUrl,
      data: {
        ...ProbeAPIRequest.getDefaultRequestBody(),
      },
      headers: {},
      options: ProbeAPIRequest.getDefaultRequestOptions(listUrl),
    });

  /*
   * API.fetch RETURNS an HTTPErrorResponse for a 4xx/5xx (it only throws when
   * no response arrived at all), and this union was never discriminated: the
   * error body — a JSON object, not an array — went straight into
   * fromJSONArray, whose `for...of` threw "json is not iterable". So the one
   * thing the operator needed, the server's own explanation ("Probe not
   * found", "Invalid Probe ID or Probe Key"), was replaced by a TypeError
   * about a shape, while every scan sat in "Pending" with nothing in the
   * product to say why (OneUptime issue #3287).
   */
  const listRejection: string = getRejectionReason(result);

  if (listRejection) {
    logger.error(
      `The server rejected this probe's request for pending discovery scans: ${listRejection}. ` +
        `No scan on this probe can leave "Pending" until that is resolved.`,
    );

    return;
  }

  /*
   * A 200 whose body is not a list. Nothing the server sends today looks like
   * this, so it means a proxy or gateway answered in the server's place — the
   * captive-portal / SSO-login-page case. Naming it beats the same
   * "not iterable" TypeError one layer down.
   */
  if (!Array.isArray(result.data)) {
    logger.error(
      `Discovery scan list returned a ${typeof result.data}, not a list of scans. ` +
        `Something between this probe and the server is answering for it — check PROBE_INGEST_URL and any proxy in front of it.`,
    );

    return;
  }

  const scans: Array<NetworkDeviceDiscoveryScan> = BaseModel.fromJSONArray(
    result.data as JSONArray,
    NetworkDeviceDiscoveryScan,
  );

  for (const scan of scans) {
    await runScan(scan);
  }
}

// Exported for tests: sweeps one scan and reports the outcome back.
export async function runScan(scan: NetworkDeviceDiscoveryScan): Promise<void> {
  const resultUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
    "/probe/discovery-scan/result",
  );

  let scanResult: SubnetScanResult;

  try {
    logger.debug(
      `Running discovery scan ${scan.id?.toString()} on ${
        ScanNameUtil.getScanLabel(scan) || scan.cidr
      }`,
    );

    /*
     * Asked through ScanModeUtil, not off the column: a scan row from a server
     * too old to select `isSnmpEnabled` arrives without it, and that absence
     * has to keep meaning "SNMP" or upgrading this probe alone would silently
     * turn every scan in the project into a ping sweep.
     */
    const isSnmpEnabled: boolean = ScanModeUtil.isSnmpEnabled(scan);

    scanResult = await scanWithDeadline(
      {
        cidr: scan.cidr || "",
        isSnmpEnabled: isSnmpEnabled,
        snmpVersion: scan.snmpVersion,
        snmpCommunityString: scan.snmpCommunityString,
        /*
         * Skipped entirely for an ICMP-only scan. buildSnmpV3Auth THROWS on an
         * unrecognized v3 value, deliberately, so that a broken credential
         * fails the scan instead of blanking it — but a scan that never opens
         * an SNMP session has no credential to be broken. Calling it here would
         * fail an ICMP-only sweep over a value it was never going to use.
         */
        snmpV3Auth: isSnmpEnabled ? buildSnmpV3Auth(scan) : undefined,
        snmpPort: scan.snmpPort,
      },
      scan.id?.toString() || "scan",
    );
  } catch (err) {
    logger.error(`Discovery scan ${scan.id?.toString()} failed: ${err}`);

    // Report the SWEEP failure so the scan doesn't sit In Progress forever.
    try {
      const reportResult: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>({
          method: HTTPMethod.POST,
          url: resultUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            scanId: scan.id?.toString(),
            success: false,
            statusMessage: (err as Error).message || String(err),
            discoveredDevices: [],
          },
          headers: {},
          options: ProbeAPIRequest.getDefaultRequestOptions(resultUrl),
        });

      /*
       * A rejected failure report is not a lost diagnostic — it is a scan
       * that stays In Progress until the server's reaper eventually times it
       * out, with the real reason known only to this probe. Say so.
       */
      const reportRejection: string = getRejectionReason(reportResult);

      if (reportRejection) {
        logger.error(
          `The server rejected the failure report for discovery scan ${scan.id?.toString()}: ${reportRejection}`,
        );
      }
    } catch (reportErr) {
      logger.error(
        `Failed to report discovery scan failure for ${scan.id?.toString()}: ${reportErr}`,
      );
    }

    return;
  }

  /*
   * discoveredHosts now includes ping-only hosts (snmpReachable false),
   * so the "answered SNMP" count must filter — the whole-array length
   * would overstate manageable devices.
   */
  const snmpResponderCount: number = scanResult.discoveredHosts.filter(
    (host: DiscoveredHost) => {
      return host.snmpReachable;
    },
  ).length;

  /*
   * The scan model has no column for the sweep's diagnostics, so they ride
   * along in statusMessage (which the ingest endpoint already accepts)
   * instead of payload fields the server would silently drop.
   *
   * This is the only explanation an operator gets for a scan that found
   * nothing, so it has to distinguish the cases that look identical in the
   * "0 of 254 hosts" column: an empty subnet, a subnet the probe cannot
   * reach, a subnet where ICMP is filtered, and a subnet full of devices
   * that rejected the scan's credentials.
   */
  const statusMessage: string = buildScanStatusMessage(
    scanResult,
    snmpResponderCount,
  );

  /*
   * The RESULT UPLOAD failing must NOT trigger the success:false report
   * above: the upload's own timeout does not cancel the server-side
   * handler, so on a slow server the sweep's Completed write can land
   * AFTER the client gave up — a failure report sent then would race it,
   * flip the finished scan to Failed and wipe its discovered hosts. Log
   * and walk away instead: a genuinely lost result leaves the scan In
   * Progress, and the server's stale-In-Progress reaper
   * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts) already
   * self-heals that case.
   */
  try {
    const uploadResult: HTTPResponse<JSONArray> | HTTPErrorResponse =
      await API.fetch<JSONArray>({
        method: HTTPMethod.POST,
        url: resultUrl,
        data: {
          ...ProbeAPIRequest.getDefaultRequestBody(),
          scanId: scan.id?.toString(),
          success: true,
          statusMessage: statusMessage,
          discoveredDevices: scanResult.discoveredHosts as unknown as JSONArray,
          scannedHostCount: scanResult.scannedHostCount,
        },
        headers: {},
        options: ProbeAPIRequest.getDefaultRequestOptions(resultUrl),
      });

    /*
     * A rejected upload used to produce no log line at all. API.fetch returns
     * a 4xx/5xx instead of throwing, so the catch below never ran, and the
     * only other line on this path is the debug one underneath — which claims
     * the hosts were delivered and, at the default log level, is not printed
     * anyway. A sweep that ran for half an hour lost its entire result in
     * silence. That is worth an error.
     */
    const uploadRejection: string = getRejectionReason(uploadResult);

    if (uploadRejection) {
      logger.error(
        `The server rejected the result of discovery scan ${scan.id?.toString()}: ${uploadRejection}. ` +
          `${scanResult.discoveredHosts.length} discovered host(s) were not saved.`,
      );

      return;
    }

    logger.debug(
      scanResult.isIcmpOnlySweep
        ? `Discovery scan ${scan.id?.toString()} found ${scanResult.discoveredHosts.length} host(s) answering ICMP (SNMP checking is off)`
        : `Discovery scan ${scan.id?.toString()} found ${snmpResponderCount} SNMP hosts (${scanResult.discoveredHosts.length} alive in total)`,
    );
  } catch (uploadErr) {
    logger.error(
      `Failed to upload discovery scan result for ${scan.id?.toString()}: ${uploadErr}`,
    );
  }
}

export default InitJob;
