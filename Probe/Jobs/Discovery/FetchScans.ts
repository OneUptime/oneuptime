import { PROBE_INGEST_URL } from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import SubnetScanner, {
  DiscoveredHost,
  SubnetScanResult,
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
  const scanLabel: string = scan.cidr || scan.id?.toString() || "scan";

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
      `Running discovery scan ${scan.id?.toString()} on ${scan.cidr}`,
    );

    scanResult = await SubnetScanner.scan({
      cidr: scan.cidr || "",
      snmpVersion: scan.snmpVersion,
      snmpCommunityString: scan.snmpCommunityString,
      snmpV3Auth: buildSnmpV3Auth(scan),
      snmpPort: scan.snmpPort,
    });
  } catch (err) {
    logger.error(`Discovery scan ${scan.id?.toString()} failed: ${err}`);

    // Report the SWEEP failure so the scan doesn't sit In Progress forever.
    try {
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
   * The scan model has no column for the ICMP pre-sweep count, so it rides
   * along in statusMessage (which the ingest endpoint already accepts)
   * instead of a payload field the server would silently drop.
   */
  const statusMessage: string =
    scanResult.respondedToPingCount !== undefined
      ? `Swept ${scanResult.scannedHostCount} hosts: ` +
        `${scanResult.respondedToPingCount} answered ICMP ping, ` +
        `${snmpResponderCount} answered SNMP.`
      : `Swept ${scanResult.scannedHostCount} hosts via SNMP ` +
        `(ICMP pre-sweep unavailable on this probe): ` +
        `${snmpResponderCount} answered SNMP.`;

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

    logger.debug(
      `Discovery scan ${scan.id?.toString()} found ${snmpResponderCount} SNMP hosts (${scanResult.discoveredHosts.length} alive in total)`,
    );
  } catch (uploadErr) {
    logger.error(
      `Failed to upload discovery scan result for ${scan.id?.toString()}: ${uploadErr}`,
    );
  }
}

export default InitJob;
