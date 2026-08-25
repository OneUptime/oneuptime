import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "./NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "./NetworkDeviceService";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  AutoImportRuleRunResult,
  MAX_MATCHED_IP_SAMPLE,
} from "../../Types/NetworkAutomation/RuleRunResult";
import AutoImportRuleMatcher, {
  AutoImportHostEvaluation,
} from "../../Utils/NetworkDiscovery/AutoImportRuleMatcher";
import {
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
} from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "../../Utils/NetworkDiscovery/DiscoveredHostUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * The engine behind network device auto-import rules (issue #3378): reads a
 * completed discovery scan's results, asks the project's rules which hosts
 * import, and creates the Network Devices the manual Review dialog would
 * have — through the same builder, so a rule-imported host and a
 * hand-imported host are the same device. Site assignment, owners and labels
 * then apply themselves through NetworkDeviceService.onCreateSuccess's
 * existing rule chain, exactly as they do for a manual import.
 *
 * Two entry points, mirroring the label-rule engine:
 *
 *   - processCompletedScan: the automatic path, called by the
 *     NetworkDeviceDiscovery worker for each Completed scan whose
 *     autoImportProcessedAt marker is NULL.
 *   - applyRuleToCompletedScans: the manual "Run Now" (and its dry run),
 *     applying ONE rule to the project's existing completed scans.
 *
 * Everything here is idempotent by construction: a device exists per
 * (project, address), recurring scans re-report the same hosts every
 * interval, and both paths skip hosts whose address is already registered —
 * so seeing the same results twice creates nothing twice.
 */

/*
 * The scan columns an import copies onto an SNMP device — the same set the
 * probe claim endpoint selects, and for the same reason: an unselected
 * credential column arrives undefined and would be silently NOT copied,
 * leaving the device unable to poll forever. Exported so a test can pin this
 * list against the builder's DiscoveredDeviceScanSource shape.
 */
export const AUTO_IMPORT_SCAN_CREDENTIAL_SELECT: {
  [key: string]: boolean;
} = {
  probeId: true,
  snmpVersion: true,
  snmpCommunityString: true,
  snmpPort: true,
  snmpV3SecurityLevel: true,
  snmpV3Username: true,
  snmpV3AuthProtocol: true,
  snmpV3AuthKey: true,
  snmpV3PrivProtocol: true,
  snmpV3PrivKey: true,
};

/*
 * Devices one pass will create from one scan. Deliberately conservative:
 * every create runs the full service pipeline plus a detached
 * label/owner/site rule chain, so hundreds per pass is already a burst of
 * thousands of queries. The cap loses nothing — a truncated pass leaves the
 * scan's marker unstamped, the next worker tick resumes, and idempotency
 * skips what this pass already created — but it turns "a typo'd rule meets a
 * /16" from an outage into a few paced ticks an operator can catch.
 */
export const MAX_DEVICES_PER_AUTO_IMPORT_RUN: number = 500;

// Scans one manual "Run Now" will read, oldest results last.
export const MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN: number = 100;

/*
 * Results older than this are stamped processed WITHOUT importing. A late
 * result can land on a reaper-Failed scan hours after its sweep ran (the
 * ingest endpoint accepts it as the truth about that run), and a worker
 * outage can leave a backlog — in both cases silently auto-importing an
 * hours-old host list is the wrong surprise. The operator can still reach
 * old results deliberately, through "Run Now".
 */
export const MAX_RESULT_AGE_IN_HOURS: number = 24;

// Same bound the label/owner engines use on their per-project rule fetch.
const RULE_FETCH_LIMIT: number = 100;

/*
 * Hostname sets shared across one worker sweep, keyed by project id. One
 * sweep can process several scans of the same project (overlapping subnets
 * on different probes are normal), and a device created from scan A must
 * read as registered when scan B reports the same address seconds later —
 * before any re-read of the device table would show it.
 */
export type ExistingHostnamesByProjectId = Map<string, Set<string>>;

class NetworkDeviceAutoImportRuleEngineServiceClass {
  /**
   * The automatic path: apply the project's enabled rules to one Completed
   * scan, then stamp the scan's autoImportProcessedAt marker.
   *
   * Returns null when there was nothing to do (scan gone, superseded,
   * already processed, no import rules, or results too old) and the run's
   * counters otherwise. Throws only on unexpected failures — the caller
   * (the worker sweep) isolates those per scan.
   *
   * The marker protocol, and why every stamp is a compare-and-set on
   * (status, completedAt): the ingest endpoint clears the marker in the same
   * write that stores new results, so "marker is NULL" always means "the
   * results now on the row have not been processed". If new results land
   * while this pass is reading the old ones, the CAS misses, the marker
   * stays NULL, and the next tick processes the new upload — the stamp can
   * never retire results it did not see, and the jsonb write-back can never
   * clobber a newer host list. A truncated pass stamps nothing on purpose:
   * the NULL marker is what makes the next tick resume.
   */
  @CaptureSpan()
  public async processCompletedScan(data: {
    scanId: ObjectID;
    existingHostnamesByProjectId: ExistingHostnamesByProjectId;
  }): Promise<AutoImportRuleRunResult | null> {
    const scan: NetworkDeviceDiscoveryScan | null =
      await NetworkDeviceDiscoveryScanService.findOneBy({
        query: {
          _id: data.scanId,
          status: "Completed",
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          completedAt: true,
          autoImportProcessedAt: true,
          discoveredDevices: true,
          ...AUTO_IMPORT_SCAN_CREDENTIAL_SELECT,
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * Re-checked on this fresh read even though the sweep query already
     * filtered: the sweep's snapshot ages while earlier scans in it are
     * processed, and a scan can complete a new run (or be re-queued) in
     * that window.
     */
    if (!scan || !scan.projectId || scan.autoImportProcessedAt) {
      return null;
    }

    const projectId: ObjectID = scan.projectId;

    const rules: Array<NetworkDeviceAutoImportRule> =
      await this.loadEnabledRules(projectId);

    const hasImportRules: boolean = rules.some(
      (rule: NetworkDeviceAutoImportRule) => {
        return !rule.isExclusion;
      },
    );

    if (!hasImportRules) {
      // Nothing can import; retire these results so they never accumulate.
      await this.stampScan({ scan: scan, createdIpAddresses: [] });
      return null;
    }

    if (this.isTooOldToAutoImport(scan)) {
      logger.warn(
        `Auto-import: scan ${scan.id?.toString()} completed more than ${MAX_RESULT_AGE_IN_HOURS} hours ago; stamping it processed without importing. Use the rule's Run Now to import old results deliberately.`,
        { projectId: projectId.toString() } as LogAttributes,
      );
      await this.stampScan({ scan: scan, createdIpAddresses: [] });
      return null;
    }

    const existingHostnames: Set<string> = await this.getExistingHostnames({
      projectId: projectId,
      cache: data.existingHostnamesByProjectId,
    });

    const result: AutoImportRuleRunResult = this.emptyResult(false);

    const createdIpAddresses: Array<string> = await this.importHostsFromScan({
      scan: scan,
      rules: rules,
      existingHostnames: existingHostnames,
      result: result,
      isDryRun: false,
    });

    await this.stampScan({
      scan: scan,
      createdIpAddresses: createdIpAddresses,
      // A truncated pass leaves the marker NULL so the next tick resumes.
      leaveMarkerUnstamped: result.isTruncated,
    });

    return result;
  }

  /*
   * The manual path: apply ONE rule to the project's completed scans, newest
   * first — or, as a dry run, evaluate everything and write nothing. The
   * project's enabled exclusion rules always ride along: "Run Now" must not
   * be a way around a veto.
   *
   * Markers are deliberately not stamped here. They belong to the automatic
   * path's bookkeeping, and a manual run of one rule has not done what the
   * full rule set would.
   */
  @CaptureSpan()
  public async applyRuleToCompletedScans(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
    isDryRun: boolean;
  }): Promise<AutoImportRuleRunResult> {
    const rule: NetworkDeviceAutoImportRule | null =
      await NetworkDeviceAutoImportRuleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          isEnabled: true,
          isExclusion: true,
          ipMatchTarget: true,
          sysNamePattern: true,
          sysDescrPattern: true,
          includePingOnlyHosts: true,
        },
        props: { isRoot: true },
      });

    if (!rule) {
      throw new BadDataException("Auto-import rule not found.");
    }

    if (!rule.isEnabled) {
      throw new BadDataException(
        "This auto-import rule is disabled. Enable it before running it.",
      );
    }

    if (rule.isExclusion) {
      throw new BadDataException(
        "An exclusion rule only vetoes other rules and imports nothing by itself, so running it alone would do nothing. Run one of the import rules it applies to instead.",
      );
    }

    const exclusionRules: Array<NetworkDeviceAutoImportRule> = (
      await this.loadEnabledRules(data.projectId)
    ).filter((candidate: NetworkDeviceAutoImportRule) => {
      return Boolean(candidate.isExclusion);
    });

    const rules: Array<NetworkDeviceAutoImportRule> = [rule, ...exclusionRules];

    const existingHostnames: Set<string> = await this.loadExistingHostnames(
      data.projectId,
    );

    const result: AutoImportRuleRunResult = this.emptyResult(data.isDryRun);

    /*
     * Newest results first: a manual run is "bring the estate up to date",
     * and the newest scan of a subnet supersedes its older runs — with
     * idempotency, whichever result mentions a host first imports it and
     * later mentions skip.
     */
    const scans: Array<NetworkDeviceDiscoveryScan> =
      await NetworkDeviceDiscoveryScanService.findBy({
        query: {
          projectId: data.projectId,
          status: "Completed",
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          completedAt: true,
          discoveredDevices: true,
          ...AUTO_IMPORT_SCAN_CREDENTIAL_SELECT,
        },
        sort: {
          completedAt: SortOrder.Descending,
        },
        limit: MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN + 1,
        skip: 0,
        props: { isRoot: true },
      });

    // One extra row settles "were there more scans" honestly.
    const hasMoreScans: boolean =
      scans.length > MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN;

    if (hasMoreScans) {
      scans.pop();
    }

    for (const scan of scans) {
      const createdIpAddresses: Array<string> = await this.importHostsFromScan({
        scan: scan,
        rules: rules,
        existingHostnames: existingHostnames,
        result: result,
        isDryRun: data.isDryRun,
      });

      if (createdIpAddresses.length > 0) {
        /*
         * Same CAS write-back as the automatic path, so the Review dialog
         * does not re-offer (pre-checked!) hosts this run just imported. A
         * miss only means fresher results arrived, which recomputed the
         * flags anyway.
         */
        await this.stampScan({
          scan: scan,
          createdIpAddresses: createdIpAddresses,
          leaveMarkerUnstamped: true,
        });
      }

      // The device cap is shared across the whole run.
      if (result.isTruncated) {
        break;
      }
    }

    if (hasMoreScans) {
      result.isTruncated = true;
    }

    return result;
  }

  /*
   * ------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------
   */

  private emptyResult(isDryRun: boolean): AutoImportRuleRunResult {
    return {
      hostsEvaluated: 0,
      hostsMatched: 0,
      hostsExcluded: 0,
      hostsSkippedAlreadyRegistered: 0,
      devicesCreated: 0,
      devicesFailed: 0,
      isTruncated: false,
      isDryRun: isDryRun,
      matchedIpAddressSample: [],
    };
  }

  private async loadEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<NetworkDeviceAutoImportRule>> {
    return NetworkDeviceAutoImportRuleService.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      select: {
        _id: true,
        name: true,
        isExclusion: true,
        ipMatchTarget: true,
        sysNamePattern: true,
        sysDescrPattern: true,
        includePingOnlyHosts: true,
      },
      limit: RULE_FETCH_LIMIT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private isTooOldToAutoImport(scan: NetworkDeviceDiscoveryScan): boolean {
    if (!scan.completedAt) {
      return false;
    }

    return OneUptimeDate.isBefore(
      OneUptimeDate.fromString(scan.completedAt),
      OneUptimeDate.getSomeHoursAgo(MAX_RESULT_AGE_IN_HOURS),
    );
  }

  private async getExistingHostnames(data: {
    projectId: ObjectID;
    cache: ExistingHostnamesByProjectId;
  }): Promise<Set<string>> {
    const key: string = data.projectId.toString();

    const cached: Set<string> | undefined = data.cache.get(key);

    if (cached) {
      return cached;
    }

    const loaded: Set<string> = await this.loadExistingHostnames(
      data.projectId,
    );
    data.cache.set(key, loaded);

    return loaded;
  }

  /*
   * Every device address in the project — the same paged walk the probe
   * ingest endpoint does to stamp isAlreadyRegistered, for the same reason:
   * a truncated answer produces duplicate devices, which is worse than a
   * slow answer. Sorted for stable paging.
   */
  private async loadExistingHostnames(
    projectId: ObjectID,
  ): Promise<Set<string>> {
    const existingHostnames: Set<string> = new Set<string>();

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const existing: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          hostname: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const device of existing) {
        if (device.hostname) {
          existingHostnames.add(device.hostname);
        }
      }

      if (existing.length < LIMIT_MAX) {
        break;
      }
    }

    return existingHostnames;
  }

  /*
   * The core loop: evaluate every discovered host of one scan against the
   * rule set, create what should import, and account for every host in the
   * shared result. Returns the addresses actually created (for the jsonb
   * write-back). Mutates `existingHostnames` as it creates, which is what
   * makes duplicate rows, overlapping scans in one sweep, and repeat runs
   * idempotent.
   */
  private async importHostsFromScan(data: {
    scan: NetworkDeviceDiscoveryScan;
    rules: Array<NetworkDeviceAutoImportRule>;
    existingHostnames: Set<string>;
    result: AutoImportRuleRunResult;
    isDryRun: boolean;
  }): Promise<Array<string>> {
    const scan: NetworkDeviceDiscoveryScan = data.scan;
    const result: AutoImportRuleRunResult = data.result;

    if (!scan.projectId) {
      return [];
    }

    /*
     * The jsonb is the probe's payload stored verbatim; normalisation fixes
     * the null rows, non-string addresses and duplicate-row flags the
     * Review dialog already learned to survive. See DiscoveredHostUtil.
     */
    const hosts: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts(
      (scan.discoveredDevices as Array<DiscoveredNetworkDevice>) || [],
    );

    const createdIpAddresses: Array<string> = [];

    for (const host of hosts) {
      if (!host.ipAddress) {
        continue;
      }

      result.hostsEvaluated++;

      const evaluation: AutoImportHostEvaluation =
        AutoImportRuleMatcher.evaluateHost(data.rules, host);

      if (evaluation.excludedByRule) {
        result.hostsExcluded++;
        continue;
      }

      if (!evaluation.shouldImport) {
        continue;
      }

      result.hostsMatched++;

      /*
       * The frozen isAlreadyRegistered flag AND the live set: the flag is a
       * point-in-time answer from the last upload, the set covers devices
       * created since — including by this very run, which is what collapses
       * duplicate rows and overlapping scans into one device.
       */
      if (
        host.isAlreadyRegistered ||
        data.existingHostnames.has(host.ipAddress)
      ) {
        result.hostsSkippedAlreadyRegistered++;
        continue;
      }

      if (
        result.devicesCreated + result.devicesFailed >=
        MAX_DEVICES_PER_AUTO_IMPORT_RUN
      ) {
        result.isTruncated = true;
        break;
      }

      if (result.matchedIpAddressSample.length < MAX_MATCHED_IP_SAMPLE) {
        result.matchedIpAddressSample.push(host.ipAddress);
      }

      if (data.isDryRun) {
        /*
         * A dry run reports the device as "created" in no counter at all —
         * hostsMatched minus hostsSkippedAlreadyRegistered is exactly what a
         * real run would attempt, and the sample above says which hosts.
         */
        continue;
      }

      const wasCreated: boolean = await this.createDeviceForHost({
        projectId: scan.projectId,
        scan: scan,
        host: host,
        existingHostnames: data.existingHostnames,
        result: result,
      });

      if (wasCreated) {
        createdIpAddresses.push(host.ipAddress);
      }
    }

    return createdIpAddresses;
  }

  /*
   * One host -> one device, with the collision protocol the estate needs:
   *
   * Device names are unique per project (an app-level check, not a DB
   * constraint) while addresses are not unique at all, so the failure modes
   * split. A create that fails re-checks the ADDRESS first — losing a race
   * to a concurrent import of the same host must read as "already
   * registered", not spawn a renamed twin. Only when the address is still
   * free is the name the problem (two hosts legitimately sharing a sysName),
   * and one retry under the address-suffixed fallback name settles it.
   */
  private async createDeviceForHost(data: {
    projectId: ObjectID;
    scan: NetworkDeviceDiscoveryScan;
    host: DiscoveredNetworkDevice;
    existingHostnames: Set<string>;
    result: AutoImportRuleRunResult;
  }): Promise<boolean> {
    const attemptCreate: (name?: string) => Promise<void> = async (
      name?: string,
    ): Promise<void> => {
      const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
        projectId: data.projectId,
        host: data.host,
        scan: data.scan,
        name: name,
      });

      await NetworkDeviceService.create({
        data: device,
        props: {
          isRoot: true,
        },
      });
    };

    try {
      await attemptCreate();
    } catch (firstError) {
      const registeredMeanwhile: NetworkDevice | null =
        await NetworkDeviceService.findOneBy({
          query: {
            projectId: data.projectId,
            hostname: data.host.ipAddress,
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (registeredMeanwhile) {
        // Skipped is a sub-bucket of matched, same as the other run results.
        data.result.hostsSkippedAlreadyRegistered++;
        data.existingHostnames.add(data.host.ipAddress);
        return false;
      }

      try {
        await attemptCreate(buildFallbackDeviceName(data.host));
      } catch (secondError) {
        data.result.devicesFailed++;
        logger.error(
          `Auto-import: could not create a device for ${data.host.ipAddress} (scan ${data.scan.id?.toString()}): ${firstError} / retry: ${secondError}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        return false;
      }
    }

    data.result.devicesCreated++;
    data.existingHostnames.add(data.host.ipAddress);

    return true;
  }

  /*
   * The one write this engine makes to the scan row: retire the consumed
   * hosts in the stored jsonb (so the Review dialog stops offering them) and
   * stamp the processed marker — in a single hook-free compare-and-set on
   * (status, completedAt), for the reasons on processCompletedScan. The
   * claim endpoint's hook-free contract is why this must never go through
   * updateOneById: the scan service deliberately has no update-success hooks
   * to piggyback on, and this write must not fire the full pipeline on every
   * worker tick.
   */
  private async stampScan(data: {
    scan: NetworkDeviceDiscoveryScan;
    createdIpAddresses: Array<string>;
    leaveMarkerUnstamped?: boolean;
  }): Promise<void> {
    const payload: JSONObject = {};

    if (!data.leaveMarkerUnstamped) {
      payload["autoImportProcessedAt"] = OneUptimeDate.getCurrentDate();
    }

    if (data.createdIpAddresses.length > 0) {
      const createdSet: Set<string> = new Set<string>(data.createdIpAddresses);

      /*
       * Mapped over the RAW stored rows, not the normalised copies: the
       * write-back must preserve whatever shape the probe sent, only
       * flipping isAlreadyRegistered on rows whose (trimmed) address was
       * imported. Junk rows pass through untouched.
       */
      const restamped: Array<unknown> = (
        (data.scan.discoveredDevices as Array<unknown>) || []
      ).map((row: unknown): unknown => {
        if (!row || typeof row !== "object") {
          return row;
        }

        const hostRow: DiscoveredNetworkDevice = row as DiscoveredNetworkDevice;

        const ipAddress: string = String(hostRow.ipAddress ?? "").trim();

        if (!ipAddress || !createdSet.has(ipAddress)) {
          return row;
        }

        return { ...hostRow, isAlreadyRegistered: true };
      });

      payload["discoveredDevices"] = restamped as unknown as Array<JSONObject>;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks({
      id: data.scan.id!,
      // Cast: the model's JSON column makes DeepPartial recursion blow up.
      data: payload as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
      expectedData: {
        status: "Completed",
        completedAt: data.scan.completedAt || null,
      } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
    });
  }
}

export default new NetworkDeviceAutoImportRuleEngineServiceClass();
