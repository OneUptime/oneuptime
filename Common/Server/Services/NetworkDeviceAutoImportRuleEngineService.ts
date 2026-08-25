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
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
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

/*
 * The Redis lock every path that CREATES devices from scan results runs
 * under — the worker sweep and the manual Run Now alike. The engine's
 * idempotency is check-then-create with no DB backstop (device names are
 * app-level unique, addresses not unique at all), so two concurrent passes
 * over the same results can both pass the check and both insert. The worker
 * holds this lock for its whole sweep; a real (non-dry) manual run takes
 * the SAME lock, so manual-vs-sweep and manual-vs-manual can never
 * interleave — which also means the scan jsonb write-back has exactly one
 * engine writer at a time. Defined here, imported by the worker, so the two
 * can never drift onto different locks.
 */
export const AUTO_IMPORT_SWEEP_LOCK_KEY: string =
  "NetworkDeviceDiscovery:ProcessAutoImportRules";
export const AUTO_IMPORT_SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
export const AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS: number = 11 * 60 * 1000;

/*
 * Hostname sets shared across one worker sweep, keyed by project id. One
 * sweep can process several scans of the same project (overlapping subnets
 * on different probes are normal), and a device created from scan A must
 * read as registered when scan B reports the same address seconds later —
 * before any re-read of the device table would show it.
 */
export type ExistingHostnamesByProjectId = Map<string, Set<string>>;

/*
 * How many imports one run has attempted, shared across every scan the run
 * touches. Real runs count creates and failures; dry runs count the imports
 * they WOULD have attempted — so a dry run over a /16 is bounded by the same
 * cap as the real run it predicts, instead of walking unbounded work inside
 * an API request.
 */
interface ImportAttemptBudget {
  count: number;
}

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
   * clobber a newer host list. A truncated pass that created something
   * stamps nothing on purpose: the NULL marker is what makes the next tick
   * resume. (A truncated pass where every create FAILED stamps anyway — see
   * the zero-progress note at the stamp below.)
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
    const attempts: ImportAttemptBudget = { count: 0 };

    const createdIpAddresses: Array<string> = await this.importHostsFromScan({
      scan: scan,
      rules: rules,
      existingHostnames: existingHostnames,
      result: result,
      attempts: attempts,
      isDryRun: false,
    });

    /*
     * A truncated pass that made progress leaves the marker NULL so the
     * next tick resumes where the cap stopped it. A truncated pass that
     * created NOTHING — every attempt failed — is stamped anyway: resuming
     * it would repeat the identical doomed pass every minute forever, and
     * the sub-cap case already retires all-failing hosts un-imported in one
     * pass, so stamping keeps the two consistent. Run Now remains the
     * deliberate way back into a stamped scan.
     */
    const shouldResume: boolean =
      result.isTruncated && result.devicesCreated > 0;

    if (result.isTruncated && result.devicesCreated === 0) {
      logger.error(
        `Auto-import: scan ${scan.id?.toString()} hit the per-pass cap with every create failing (${result.devicesFailed} failure(s)); stamping it processed so the sweep does not retry it forever. Inspect the failures and use the rule's Run Now to retry deliberately.`,
        { projectId: projectId.toString() } as LogAttributes,
      );
    }

    await this.stampScan({
      scan: scan,
      createdIpAddresses: createdIpAddresses,
      leaveMarkerUnstamped: shouldResume,
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

    /*
     * A DISABLED rule can still be dry-run — that is the point of the dry
     * run: answer "what would this rule import" BEFORE enabling it against
     * live scans. Only a real run of a disabled rule contradicts the toggle
     * the user can see next to the button.
     */
    if (!rule.isEnabled && !data.isDryRun) {
      throw new BadDataException(
        "This auto-import rule is disabled. Enable it before running it, or use Dry Run to preview what it would import.",
      );
    }

    if (rule.isExclusion) {
      throw new BadDataException(
        "An exclusion rule only vetoes other rules and imports nothing by itself, so running it alone would do nothing. Run one of the import rules it applies to instead.",
      );
    }

    /*
     * A real run creates devices, so it must hold the same lock the worker
     * sweep holds (see AUTO_IMPORT_SWEEP_LOCK_KEY): without it, a Run Now
     * clicked while the every-minute sweep is processing the same
     * marker-NULL scan races the check-then-create idempotency and both
     * paths insert the same host. A dry run writes nothing and skips the
     * lock.
     */
    let mutex: SemaphoreMutex | null = null;

    if (!data.isDryRun) {
      try {
        mutex = await Semaphore.lock({
          key: AUTO_IMPORT_SWEEP_LOCK_KEY,
          namespace: AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
          lockTimeout: AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
          acquireAttemptsLimit: 3,
        });
      } catch (err) {
        logger.debug(
          `Auto-import Run Now: could not acquire the sweep lock: ${err}`,
        );
        throw new BadDataException(
          "An automatic import sweep is currently running. Try again in a minute — hosts it imports are skipped by your run anyway.",
        );
      }
    }

    try {
      return await this.runRuleAgainstCompletedScans({
        rule: rule,
        projectId: data.projectId,
        isDryRun: data.isDryRun,
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(
            `Auto-import Run Now: error releasing the sweep lock: ${err}`,
          );
        }
      }
    }
  }

  private async runRuleAgainstCompletedScans(data: {
    rule: NetworkDeviceAutoImportRule;
    projectId: ObjectID;
    isDryRun: boolean;
  }): Promise<AutoImportRuleRunResult> {
    const exclusionRules: Array<NetworkDeviceAutoImportRule> = (
      await this.loadEnabledRules(data.projectId)
    ).filter((candidate: NetworkDeviceAutoImportRule) => {
      return Boolean(candidate.isExclusion);
    });

    const rules: Array<NetworkDeviceAutoImportRule> = [
      data.rule,
      ...exclusionRules,
    ];

    const existingHostnames: Set<string> = await this.loadExistingHostnames(
      data.projectId,
    );

    const result: AutoImportRuleRunResult = this.emptyResult(data.isDryRun);
    const attempts: ImportAttemptBudget = { count: 0 };

    /*
     * Newest results first: a manual run is "bring the estate up to date",
     * and the newest scan of a subnet supersedes its older runs — with
     * idempotency, whichever result mentions a host first imports it and
     * later mentions skip. Minimal columns only — the full row, with its
     * multi-megabyte discoveredDevices jsonb, is re-read one scan at a time
     * inside the loop so only one result set is ever resident (the same
     * two-phase shape the worker sweep uses, for the same reason).
     */
    const scanStubs: Array<NetworkDeviceDiscoveryScan> =
      await NetworkDeviceDiscoveryScanService.findBy({
        query: {
          projectId: data.projectId,
          status: "Completed",
        },
        select: {
          _id: true,
        },
        sort: {
          completedAt: SortOrder.Descending,
        },
        limit: MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN + 1,
        skip: 0,
        props: { isRoot: true },
      });

    // One extra row settles "were there more scans" honestly.
    result.hasMoreScans = scanStubs.length > MAX_SCANS_PER_AUTO_IMPORT_RULE_RUN;

    if (result.hasMoreScans) {
      scanStubs.pop();
    }

    for (const scanStub of scanStubs) {
      const scan: NetworkDeviceDiscoveryScan | null =
        await NetworkDeviceDiscoveryScanService.findOneBy({
          query: {
            _id: scanStub.id!,
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
          props: { isRoot: true },
        });

      // Re-queued or deleted since the stub query — nothing to evaluate.
      if (!scan) {
        continue;
      }

      const createdIpAddresses: Array<string> = await this.importHostsFromScan({
        scan: scan,
        rules: rules,
        existingHostnames: existingHostnames,
        result: result,
        attempts: attempts,
        isDryRun: data.isDryRun,
      });

      if (createdIpAddresses.length > 0) {
        /*
         * Same CAS write-back as the automatic path, so the Review dialog
         * does not re-offer (pre-checked!) hosts this run just imported. A
         * miss only means fresher results arrived, which recomputed the
         * flags anyway. No concurrent engine writer can clobber this: the
         * write happens only on real runs, which hold the sweep lock.
         */
        await this.stampScan({
          scan: scan,
          createdIpAddresses: createdIpAddresses,
          leaveMarkerUnstamped: true,
        });
      }

      // The device cap is shared across the whole run, dry or real.
      if (result.isTruncated) {
        break;
      }

      /*
       * Yield the event loop between scans: this runs inside an API request
       * handler, and evaluating scan after scan of jsonb back-to-back would
       * starve every other request the process is serving. setTimeout
       * rather than setImmediate because the latter is a bare Node global
       * that the jsdom-based test environment does not define.
       */
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
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
      hasMoreScans: false,
      isDryRun: isDryRun,
      matchedIpAddressSample: [],
    };
  }

  /*
   * ALL enabled rules of the project, paged to completeness — never a capped
   * subset. The label/owner engines cap their fetch at 100 and a dropped
   * rule there merely adds nothing; here a dropped EXCLUSION rule fails
   * OPEN, importing the exact hosts the operator vetoed, nondeterministically
   * (an uncapped unsorted fetch returns Postgres's choice of rows). Rule
   * rows are a handful of scalar columns, so completeness is one query in
   * any realistic project.
   */
  private async loadEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<NetworkDeviceAutoImportRule>> {
    const rules: Array<NetworkDeviceAutoImportRule> = [];

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const page: Array<NetworkDeviceAutoImportRule> =
        await NetworkDeviceAutoImportRuleService.findBy({
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
          sort: {
            createdAt: SortOrder.Ascending,
          },
          limit: LIMIT_MAX,
          skip: skip,
          props: { isRoot: true },
        });

      rules.push(...page);

      if (page.length < LIMIT_MAX) {
        break;
      }
    }

    return rules;
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
    attempts: ImportAttemptBudget;
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
      /*
       * The address becomes the device's varchar(100) hostname, on which
       * the create THROWS rather than truncates — and no real address is
       * anywhere near that long, so an over-long "address" is junk that
       * would fail identically on every pass. Refusing it here (instead of
       * counting a devicesFailed per pass forever) is what keeps a
       * pathological scan from failing the same way every worker tick.
       */
      if (!host.ipAddress || host.ipAddress.length > 100) {
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

      if (data.attempts.count >= MAX_DEVICES_PER_AUTO_IMPORT_RUN) {
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
         * The address still joins the set, simulating the create's dedupe:
         * without this, a host on duplicate rows (or in two overlapping
         * scans) would be counted as importable once per appearance, and
         * the dry run would promise more than the real run does.
         */
        data.attempts.count++;
        data.existingHostnames.add(host.ipAddress);
        continue;
      }

      const wasCreated: boolean = await this.createDeviceForHost({
        projectId: scan.projectId,
        scan: scan,
        host: host,
        existingHostnames: data.existingHostnames,
        result: result,
        attempts: data.attempts,
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
    attempts: ImportAttemptBudget;
  }): Promise<boolean> {
    data.attempts.count++;

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
   *
   * The CAS defends against exactly one concurrent writer — the ingest
   * endpoint, which rewrites completedAt with every upload. It cannot
   * defend against another ENGINE write (which changes neither status nor
   * completedAt), and does not need to: every path that reaches this method
   * holds the sweep lock (the worker for its whole sweep, Run Now for a
   * real run; dry runs never write), so the full-array replace below always
   * has the row's only engine writer. Weaken that invariant and this
   * becomes last-writer-wins on the isAlreadyRegistered flips.
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
