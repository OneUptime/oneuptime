import {
  PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS,
  PROBE_DISCOVERY_SCAN_CONCURRENCY,
  PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS,
  PROBE_INGEST_URL,
} from "../../Config";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import SubnetScanner, {
  DiscoveredHost,
  type SubnetScanConfig,
  type SubnetScanProgress,
  type SubnetScanResult,
  type SubnetScanSnmpConfig,
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
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
} from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import { SnmpVersionUtil } from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
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
 * Assembles the SnmpV3Auth the scanner needs from one credential set's
 * snmpV3* fields. Mirrors NetworkDeviceHydrationUtil.buildSnmpV3Auth: no
 * username means no v3 config, so return undefined and let that config run as
 * v1/v2c.
 *
 * `config` is typed as one entry of the scan's credential list, which a whole
 * scan row also satisfies structurally — the list's fields are named exactly
 * like the flattened columns it generalizes, so a legacy scan needs no
 * translation.
 */
export function buildSnmpV3Auth(
  config: DiscoveryScanSnmpConfig,
  scanLabel?: string | undefined,
): SnmpV3Auth | undefined {
  if (!config.snmpV3Username) {
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
   * Each credential set is built once and reused for every host, so a single
   * unreadable value silently blanks that config across the entire sweep —
   * and, now that a scan carries several, would do so while the OTHER configs
   * kept answering, which is the version of this bug that is hardest to spot.
   * The message therefore names the config as well as the scan.
   */
  const where: string =
    (scanLabel ? `discovery scan ${scanLabel}, ` : "") +
    SnmpScanConfigUtil.getConfigLabel(config);

  if (SnmpSecurityLevelUtil.isUnrecognized(config.snmpV3SecurityLevel)) {
    throw new Error(
      `SNMP v3 security level "${config.snmpV3SecurityLevel}" configured for ${where} is not a recognized value. Expected one of: ${Object.values(
        SnmpSecurityLevel,
      ).join(", ")}.`,
    );
  }

  if (SnmpAuthProtocolUtil.isUnrecognized(config.snmpV3AuthProtocol)) {
    throw new Error(
      `SNMP v3 authentication protocol "${config.snmpV3AuthProtocol}" configured for ${where} is not a recognized value. Expected one of: ${Object.values(
        SnmpAuthProtocol,
      ).join(", ")}.`,
    );
  }

  if (SnmpPrivProtocolUtil.isUnrecognized(config.snmpV3PrivProtocol)) {
    throw new Error(
      `SNMP v3 privacy protocol "${config.snmpV3PrivProtocol}" configured for ${where} is not a recognized value. Expected one of: ${Object.values(
        SnmpPrivProtocol,
      ).join(", ")}.`,
    );
  }

  return {
    securityLevel:
      SnmpSecurityLevelUtil.parse(config.snmpV3SecurityLevel) ||
      SnmpSecurityLevel.NoAuthNoPriv,
    username: config.snmpV3Username,
    authProtocol: SnmpAuthProtocolUtil.parse(config.snmpV3AuthProtocol),
    authKey: config.snmpV3AuthKey || undefined,
    privProtocol: SnmpPrivProtocolUtil.parse(config.snmpV3PrivProtocol),
    privKey: config.snmpV3PrivKey || undefined,
  };
}

/*
 * Every credential set this scan sweeps with, in order, parsed into the shape
 * the SNMP layer wants.
 *
 * Exported for tests, and the one place the server's stored shape meets the
 * probe's runtime shape. Two conversions happen here and nowhere else:
 *
 *   - the stored version is the dropdown key ("V1"/"V2c"/"V3") while
 *     SnmpMonitor branches on the enum VALUE ("1"/"2c"/"3"). A bare cast
 *     leaves "V3" unequal to SnmpVersion.V3, so a v3 session silently
 *     downgrades to v2c and goes out in cleartext.
 *   - the v3 credential block is assembled and validated, so an unreadable
 *     value fails the scan with a sentence instead of blanking it.
 *
 * SnmpScanConfigUtil.resolve() never returns an empty list — a scan with no
 * stored list is described by its flattened columns — so neither does this.
 */
export function buildProbeSnmpConfigs(
  scan: NetworkDeviceDiscoveryScan,
): Array<SubnetScanSnmpConfig> {
  const scanLabel: string =
    ScanNameUtil.getScanLabel(scan) || scan.id?.toString() || "scan";

  return SnmpScanConfigUtil.resolve(scan).map(
    (config: DiscoveryScanSnmpConfig, index: number): SubnetScanSnmpConfig => {
      return {
        id: config.id || `config-${index + 1}`,
        label: SnmpScanConfigUtil.getConfigLabel(config, index),
        snmpVersion: SnmpVersionUtil.parse(config.snmpVersion),
        /*
         * "public" is the fallback the sweep has always used for a config
         * with no community, and is a real answer for discovery rather than a
         * placeholder.
         */
        communityString: config.snmpCommunityString || "public",
        /*
         * Built only for a set that is actually v3.
         *
         * buildSnmpV3Auth gates on the USERNAME, not the version, and throws on
         * an unrecognized security level or protocol. The server's validator
         * deliberately skips those checks for a v1/v2c set — switching a card's
         * version back and forth must not lose the keys already typed into it,
         * so a v2c set legitimately carries leftover v3 values, and it stores
         * them. Calling this unconditionally therefore threw on a list the
         * server had just accepted, and the throw fails the WHOLE scan: a
         * stale value on one v2c set would stop the valid sets beside it from
         * ever sweeping.
         */
        snmpV3Auth: SnmpVersionUtil.isV3(config.snmpVersion)
          ? buildSnmpV3Auth(config, scanLabel)
          : undefined,
        port: config.snmpPort || 161,
      };
    },
  );
}

/*
 * NetworkDeviceDiscoveryScan.statusMessage is a varchar(500), and the probe
 * keeps ITSELF inside it rather than relying on the server's clip.
 *
 * The ingest endpoint does clip (see MAX_STATUS_MESSAGE_LENGTH there), so an
 * over-long message is not lost data — but what it cuts is the TAIL, and the
 * tail is where the credential summary lives. A multi-credential sweep would
 * therefore be the one case that silently loses the sentence the
 * multi-credential feature exists to print. Bounding here means the probe
 * decides what to drop, and says that it dropped something.
 */
export const MAX_STATUS_MESSAGE_LENGTH: number = 500;

/*
 * How much of the message the credential summary may take.
 *
 * Config labels are operator-typed and may each be as long as a scan name
 * (MAX_SNMP_CONFIG_NAME_LENGTH, 100 characters), and there may be ten of them
 * — over 1,000 characters of names alone, in a 500-character column, ahead of
 * the ICMP-filtered note and the quoted SNMP error that are the older and
 * better-established diagnostics. This is the slice the summary gets; past it
 * the remaining labels are counted rather than named, which still tells the
 * operator that more credentials were tried.
 */
const MAX_CREDENTIAL_SUMMARY_LENGTH: number = 120;

// A single label, short enough that one verbose name cannot fill the budget.
const MAX_CREDENTIAL_LABEL_LENGTH: number = 40;

function summarizeConfigLabel(label: string): string {
  return label.length > MAX_CREDENTIAL_LABEL_LENGTH
    ? label.substring(0, MAX_CREDENTIAL_LABEL_LENGTH - 1) + "\u2026"
    : label;
}

/*
 * As many entries as fit in the budget, then "+N more".
 *
 * Never empty-handed: the first entry is always named even when it alone
 * exceeds the budget, because "+3 more" on its own says nothing at all.
 */
function joinWithinBudget(entries: Array<string>): string {
  const kept: Array<string> = [];
  let length: number = 0;

  for (const entry of entries) {
    const cost: number = entry.length + (kept.length > 0 ? 2 : 0);

    if (kept.length > 0 && length + cost > MAX_CREDENTIAL_SUMMARY_LENGTH) {
      break;
    }

    kept.push(entry);
    length += cost;
  }

  const dropped: number = entries.length - kept.length;

  return dropped > 0
    ? `${kept.join(", ")} and ${dropped} more`
    : kept.join(", ");
}

/*
 * The last resort, after every sentence has had its say. Only reachable when
 * several rare branches fire at once — an ICMP-filtered subnet, a 120-char
 * quoted SNMP error and a long credential summary in the same sweep — and it
 * marks the cut so a truncated message cannot be misread as a complete one.
 */
function clipStatusMessage(message: string): string {
  if (message.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return message;
  }

  return message.substring(0, MAX_STATUS_MESSAGE_LENGTH - 1) + "\u2026";
}

/*
 * The operator-facing summary of one sweep.
 *
 * Exported for tests: every "the scan found nothing" support case is decided
 * by whether this sentence names the reason, so its content is asserted
 * rather than left to chance. It is also guaranteed to FIT the statusMessage
 * column — see clipStatusMessage.
 */
export function buildScanStatusMessage(
  scanResult: SubnetScanResult,
  snmpResponderCount: number,
  /*
   * The credential sets the sweep ran with, so the summary can say WHICH of
   * them answered. Optional and defaulted, because a single-config sweep has
   * nothing to disambiguate and its summary is unchanged.
   */
  snmpConfigs: Array<SubnetScanSnmpConfig> = [],
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

    /*
     * Clipped on this path too. The two long sentences above are mutually
     * exclusive today — the scanner throws rather than returning an incomplete
     * sweep that also found nothing — so this cannot currently fire. It is here
     * so the guarantee this function documents ("fits the statusMessage
     * column") holds on EVERY return rather than on the one somebody
     * remembered.
     */
    return clipStatusMessage(parts.join(" "));
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

  /*
   * Which credentials actually worked, named, when the scan carries more than
   * one. This is the half of a multi-credential sweep the operator cannot see
   * any other way: a config that answered nobody is either wrong or aimed at
   * gear that is not on this range, and either way it is costing every silent
   * address another timeout on every run.
   *
   * Labels only — never a community string or a key. This sentence lands in
   * statusMessage, which is readable by roles that are deliberately denied the
   * credential columns.
   */
  if (snmpConfigs.length > 1) {
    const answered: Array<string> = [];
    const silent: Array<string> = [];

    for (const config of snmpConfigs) {
      const count: number =
        scanResult.responderCountByConfigId?.[config.id] || 0;

      if (count > 0) {
        answered.push(`${summarizeConfigLabel(config.label)} on ${count}`);
      } else {
        silent.push(summarizeConfigLabel(config.label));
      }
    }

    if (answered.length > 0) {
      parts.push(`Answered by credentials: ${joinWithinBudget(answered)}.`);
    }

    if (silent.length > 0) {
      parts.push(`No host answered: ${joinWithinBudget(silent)}.`);
    }
  }

  if (snmpResponderCount === 0 && snmpErrorHostCount === 0) {
    /*
     * Usually one port; a list when the scan's configs disagree, which is a
     * real shape on estates that run an agent alongside the stock daemon.
     */
    const ports: Array<number> =
      scanResult.scannedPorts && scanResult.scannedPorts.length > 0
        ? scanResult.scannedPorts
        : [161];
    const portList: string = ports.join(", ");
    const portLabel: string = ports.length > 1 ? "ports" : "port";

    parts.push(
      `Nothing answered SNMP on ${portLabel} ${portList}. Check that this probe can reach the range, ` +
        `that UDP/${portList} is permitted to it, and that the devices' SNMP ACL allows the probe's IP address.`,
    );
  }

  return clipStatusMessage(parts.join(" "));
}

/*
 * The status message a RUNNING sweep carries, replaced by
 * buildScanStatusMessage's final summary when the sweep ends.
 *
 * Exported for tests, and written to be read by an operator watching a scan
 * that will not finish for another twenty minutes. It has one job the final
 * summary does not: to say that the numbers beside it are a running total, so
 * "4 of 15,360" is not read as this sweep's verdict on the range (OneUptime
 * issue #3598).
 */
export function buildScanProgressMessage(progress: SubnetScanProgress): string {
  const swept: string = progress.sweptHostCount.toLocaleString("en-US");
  const total: string = progress.totalHostCount.toLocaleString("en-US");

  if (progress.isIcmpOnlySweep) {
    return clipStatusMessage(
      `Scan in progress: ${swept} of ${total} addresses swept so far, ` +
        `${progress.respondedToPingCount ?? 0} answered ICMP ping ` +
        `(Check SNMP is off for this scan). ` +
        `These results update as the sweep continues.`,
    );
  }

  /*
   * The ICMP tally is omitted rather than shown as zero once the pre-sweep has
   * broken, for the same reason SubnetScanResult omits it: a count over an
   * unknown subset of the range is not a count.
   */
  const pingPart: string =
    progress.respondedToPingCount === undefined
      ? "the ICMP pre-sweep is unavailable on this probe, so every address is being probed over SNMP"
      : `${progress.respondedToPingCount} answered ICMP ping`;

  return clipStatusMessage(
    `Scan in progress: ${swept} of ${total} addresses swept so far, ` +
      `${pingPart}, ${progress.snmpResponderCount} answered SNMP. ` +
      `These results update as the sweep continues.`,
  );
}

/*
 * Uploads what a running sweep has found so far, at most once every
 * PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS.
 *
 * Why this exists at all: a sweep's hosts used to live only in the probe's
 * memory until the whole range was covered. A 15,360-address scan therefore
 * showed "0 of 15360" for as long as it ran, a sweep abandoned at the deadline
 * threw away every host it had already confirmed, and the auto-import worker —
 * which only looks at scans that have finished — could not import one of the
 * hundreds of devices the probe was already holding (OneUptime issues #3598
 * and #3599).
 *
 * Two rules make this safe to run inside the sweep:
 *
 *   - it NEVER blocks the sweep. `report` fires the upload and returns; the
 *     sweep's deadline race is not spent on the network. A second report
 *     arriving while one is in flight is dropped rather than queued, so a slow
 *     server cannot build a backlog of stale uploads.
 *   - it NEVER fails the sweep. Every rejection is logged and swallowed: a
 *     partial result is a convenience, and the final upload is the one that
 *     has to land.
 *
 * `settle()` is awaited before the final upload so an in-flight partial cannot
 * land after it. The server refuses a partial for a scan that is no longer In
 * Progress as well — belt and braces, because only the server can see the
 * order the writes actually arrive in.
 */
export class ScanProgressReporter {
  private readonly scanId: string;
  private readonly resultUrl: URL;
  private readonly intervalInMs: number;
  private lastReportedAt: number = 0;
  private inFlight: Promise<void> | null = null;

  public constructor(data: {
    scanId: string;
    resultUrl: URL;
    intervalInMs?: number | undefined;
  }) {
    this.scanId = data.scanId;
    this.resultUrl = data.resultUrl;
    this.intervalInMs =
      data.intervalInMs ?? PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS;
    /*
     * The clock starts at construction, not at zero: the claim that put this
     * scan In Progress has just written the row, and a partial upload one
     * segment later would only rewrite the same emptiness.
     */
    this.lastReportedAt = Date.now();
  }

  public report(progress: SubnetScanProgress): void {
    if (this.inFlight) {
      return;
    }

    const now: number = Date.now();

    if (now - this.lastReportedAt < this.intervalInMs) {
      return;
    }

    this.lastReportedAt = now;

    const upload: Promise<void> = this.upload(progress).finally(() => {
      this.inFlight = null;
    });

    /*
     * Held so settle() can await it, and given its own catch so that an upload
     * nobody is awaiting yet can never surface as an unhandled rejection and
     * take the probe process down.
     */
    this.inFlight = upload;

    upload.catch(() => {
      // Already logged in upload(); this only keeps the rejection handled.
    });
  }

  // Waits for an in-flight upload, if any. Never throws.
  public async settle(): Promise<void> {
    try {
      await this.inFlight;
    } catch {
      // Already logged in upload().
    }
  }

  private async upload(progress: SubnetScanProgress): Promise<void> {
    try {
      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>({
          method: HTTPMethod.POST,
          url: this.resultUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            scanId: this.scanId,
            /*
             * The flag that stops this being read as a finished run: the
             * server keeps the scan In Progress, leaves completedAt and the
             * recurrence schedule alone, and stores only the results.
             */
            isPartial: true,
            success: true,
            statusMessage: buildScanProgressMessage(progress),
            discoveredDevices: progress.discoveredHosts as unknown as JSONArray,
            /*
             * Addresses swept so far, not the size of the range: the scans
             * list renders this as the denominator of "N of M hosts", and the
             * message above says which of the two it is.
             */
            scannedHostCount: progress.sweptHostCount,
          },
          headers: {},
          options: ProbeAPIRequest.getDefaultRequestOptions(this.resultUrl),
        });

      const rejection: string = getRejectionReason(result);

      if (rejection) {
        logger.debug(
          `The server did not accept a progress update for discovery scan ${this.scanId}: ${rejection}. The sweep continues and its final result is what counts.`,
        );
      }
    } catch (err) {
      logger.debug(
        `Could not send a progress update for discovery scan ${this.scanId}: ${err}. The sweep continues and its final result is what counts.`,
      );
    }
  }
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
    const result: SubnetScanResult = await Promise.race([
      SubnetScanner.scan(config),
      deadline,
    ]);

    /*
     * Reverse DNS (OneUptime issue #3529) runs HERE — after the race has
     * settled — and not inside scan().
     *
     * The race is winner-takes-all: if the sweep has not settled by the
     * deadline, this function rejects and runScan reports the scan Failed
     * with no hosts at all. Naming hosts inside scan() would spend that same
     * budget, so a sweep that had already found every host on the subnet
     * could be discarded wholesale because looking up their names took the
     * run past the line. An enrichment must not be able to destroy the result
     * it exists to improve, and the pass's own 60s cap bounds how much it
     * adds without stopping it being the straw that breaks the deadline.
     *
     * Past this line the sweep has WON its race. `result` is final, the
     * deadline can no longer discard it, and attachReverseDnsHostnames never
     * throws — so the worst case is hosts named by address, exactly as they
     * were before this feature existed.
     *
     * The timer is disarmed FIRST rather than left to the finally. It is
     * still armed at this point, and the enrichment can take up to a minute:
     * leaving it running would let it fire mid-lookup and write
     * "did not settle ... Abandoning this sweep" to the probe log at ERROR
     * level about a sweep that finished cleanly and whose result is on its
     * way back. The log line would be a pure fabrication, and it is the line
     * an operator would be reading to explain a failure that never happened.
     */
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }

    result.reverseDnsResolvedCount =
      await SubnetScanner.attachReverseDnsHostnames(result.discoveredHosts);

    return result;
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
  /*
   * Built outside the try so the summary below can name the credential sets
   * even though the parsing that builds them is what the try is guarding.
   */
  let snmpConfigs: Array<SubnetScanSnmpConfig> = [];

  const scanIdString: string = scan.id?.toString() || "scan";

  /*
   * Built outside the try as well, so the failure path below can still wait
   * for an in-flight partial upload before it reports the sweep failed. Both
   * ends of a run write the same row, and they have to go in order.
   */
  const progressReporter: ScanProgressReporter = new ScanProgressReporter({
    scanId: scanIdString,
    resultUrl: resultUrl,
  });

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

    /*
     * Skipped entirely for an ICMP-only scan, and that is load-bearing rather
     * than an optimisation. buildProbeSnmpConfigs resolves the scan's
     * credential list and validates each set through buildSnmpV3Auth, which
     * THROWS on an unrecognized v3 value — deliberately, so a broken credential
     * fails the scan instead of silently blanking it. A scan that never opens
     * an SNMP session has no credential to be broken, so running that
     * validation would fail an ICMP-only sweep over a value it was never going
     * to use.
     */
    snmpConfigs = isSnmpEnabled ? buildProbeSnmpConfigs(scan) : [];

    scanResult = await scanWithDeadline(
      {
        cidr: scan.cidr || "",
        isSnmpEnabled: isSnmpEnabled,
        snmpConfigs: snmpConfigs,
        /*
         * Results leave the probe while the sweep is still running, so the
         * scan shows real progress instead of "0 of 15360" for an hour, a
         * sweep abandoned at the deadline keeps what it found, and the
         * auto-import worker can act on hosts long before the range is
         * finished (OneUptime issues #3598 and #3599).
         */
        onProgress: (progress: SubnetScanProgress): void => {
          progressReporter.report(progress);
        },
        /*
         * 0 means "size the pool from the target" — the normal case. A probe
         * with an explicit PROBE_DISCOVERY_SCAN_CONCURRENCY overrides it.
         */
        maxConcurrency: PROBE_DISCOVERY_SCAN_CONCURRENCY || undefined,
      },
      scanIdString,
    );
  } catch (err) {
    logger.error(`Discovery scan ${scanIdString} failed: ${err}`);

    /*
     * Let any in-flight partial land BEFORE the failure report, so the run's
     * last findings are on the row when it is marked Failed rather than
     * arriving at a row that has already been closed. The server refuses a
     * partial for a scan that is no longer In Progress, so a straggler is
     * simply dropped — which is safe, but loses whatever it carried; only
     * this side can stop the two writes racing in the first place.
     */
    await progressReporter.settle();

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
            /*
             * NO `discoveredDevices` key.
             *
             * This used to send an empty array, which the server reads as
             * "this run found nothing" and writes to the column. That was
             * harmless while a run's only report was its last one — but a
             * sweep uploads what it has found every 30 seconds now, so a run
             * abandoned at the deadline would erase the hundreds of hosts it
             * had already sent, which is exactly the loss incremental results
             * exist to prevent (OneUptime issue #3598). Omitting the key
             * leaves the stored hosts alone; the status message says the run
             * did not finish.
             */
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
    snmpConfigs,
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
  /*
   * Same ordering guarantee as the failure path: a partial upload still in
   * flight would otherwise be able to land after this one and replace a
   * finished scan's results (reverse-DNS names and all) with the snapshot
   * that preceded them.
   */
  await progressReporter.settle();

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

    /*
     * The reverse-DNS tally rides on the same line rather than getting one of
     * its own, and is omitted entirely when the pass did not run (undefined,
     * which is a different statement from zero — see reverseDnsResolvedCount).
     *
     * It is the only place an operator can tell "this subnet publishes no PTR
     * records" apart from "this probe cannot resolve", without reading the
     * warning ReverseDnsResolver emits only in the second case. A scan whose
     * Review dialog is all bare addresses is otherwise indistinguishable
     * between the two.
     */
    const namedSuffix: string =
      scanResult.reverseDnsResolvedCount === undefined
        ? ""
        : `, ${scanResult.reverseDnsResolvedCount} named by reverse DNS`;

    logger.debug(
      scanResult.isIcmpOnlySweep
        ? `Discovery scan ${scan.id?.toString()} found ${scanResult.discoveredHosts.length} host(s) answering ICMP (SNMP checking is off)${namedSuffix}`
        : `Discovery scan ${scan.id?.toString()} found ${snmpResponderCount} SNMP hosts (${scanResult.discoveredHosts.length} alive in total)${namedSuffix}`,
    );
  } catch (uploadErr) {
    logger.error(
      `Failed to upload discovery scan result for ${scan.id?.toString()}: ${uploadErr}`,
    );
  }
}

export default InitJob;
