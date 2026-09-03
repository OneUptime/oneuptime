import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceAutoImportRule from "../../Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkDeviceDiscoveryScanService from "./NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "./NetworkDeviceService";
import MonitorService from "./MonitorService";
import MonitorTemplateService from "./MonitorTemplateService";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import MonitorType from "../../Types/Monitor/MonitorType";
import {
  AutoImportRuleRunResult,
  MAX_MATCHED_IP_SAMPLE,
} from "../../Types/NetworkAutomation/RuleRunResult";
import AutoImportRuleMatcher, {
  AutoImportHostEvaluation,
  AutoImportRuleCandidate,
} from "../../Utils/NetworkDiscovery/AutoImportRuleMatcher";
import {
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
} from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "../../Utils/NetworkDiscovery/DiscoveredHostUtil";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkDeviceMonitorTemplateUtil from "../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import QueryHelper from "../Types/Database/QueryHelper";
import NetworkDeviceHydrationUtil from "../Utils/Monitor/NetworkDeviceHydrationUtil";
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
 * interval, and both paths reuse hosts whose address is already registered.
 * Existing devices are still reconciled for a selected template monitor,
 * while provenance keys prevent the same monitor from being created twice.
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
  /*
   * The ordered credential list, so an imported device is built with the
   * config that ACTUALLY answered its address rather than with the scan's
   * first one. The flattened columns below are what a scan written out of
   * band carries, and are the fallback SnmpScanConfigUtil resolves to.
   */
  snmpConfigs: true,
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

/*
 * Monitor creates run an even broader service pipeline than device creates:
 * plan limits, operational status, labels, owners, SLOs and status pages all
 * participate. Keep a separate cap so reconciling an existing /16 cannot
 * bypass the device cap merely because all devices are already registered.
 * A truncated automatic pass leaves its marker NULL whenever it made
 * progress, and the next sweep resumes from the queryable provenance keys.
 */
export const MAX_MONITORS_PER_AUTO_IMPORT_RUN: number = 500;

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
export type ExistingHostnamesByProjectId = Map<
  string,
  Map<string, NetworkDevice>
>;

export interface ExistingMonitorProvisioningState {
  autoProvisionedKeys: Set<string>;
  manuallyMonitoredDeviceIds: Set<string>;
  attemptedProvisioningKeys: Set<string>;
}

export type ExistingMonitorsByProjectId = Map<
  string,
  ExistingMonitorProvisioningState
>;

/*
 * How many imports one run has attempted, shared across every scan the run
 * touches. Real runs count creates and failures; dry runs count the imports
 * they WOULD have attempted — so a dry run over a /16 is bounded by the same
 * cap as the real run it predicts, instead of walking unbounded work inside
 * an API request.
 */
export interface ImportAttemptBudget {
  deviceCount: number;
  monitorCount: number;
}

export type ImportAttemptBudgetsByProjectId = Map<string, ImportAttemptBudget>;

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
    existingMonitorsByProjectId?: ExistingMonitorsByProjectId;
    attemptBudgetsByProjectId?: ImportAttemptBudgetsByProjectId;
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

    const existingDevices: Map<string, NetworkDevice> = this.getExistingDevices(
      {
        projectId: projectId,
        cache: data.existingHostnamesByProjectId,
      },
    );

    const hasMonitorProvisioningRules: boolean = rules.some(
      (rule: NetworkDeviceAutoImportRule): boolean => {
        return !rule.isExclusion && Boolean(rule.monitorTemplateId);
      },
    );

    const existingMonitors: ExistingMonitorProvisioningState =
      hasMonitorProvisioningRules
        ? await this.getExistingMonitors({
            projectId: projectId,
            cache: data.existingMonitorsByProjectId || new Map(),
          })
        : this.emptyExistingMonitorProvisioningState();

    const monitorTemplates: Map<string, MonitorTemplate> =
      hasMonitorProvisioningRules
        ? await this.loadMonitorTemplates({ projectId, rules })
        : new Map();

    const result: AutoImportRuleRunResult = this.emptyResult(false);
    const projectBudgetKey: string = projectId.toString();
    const attempts: ImportAttemptBudget = data.attemptBudgetsByProjectId
      ? data.attemptBudgetsByProjectId.get(projectBudgetKey) || {
          deviceCount: 0,
          monitorCount: 0,
        }
      : { deviceCount: 0, monitorCount: 0 };

    /*
     * A project budget is shared across every scan in one worker sweep. Keep
     * the starting values so a scan reached after an earlier scan consumed
     * the budget can be distinguished from a scan whose own create attempts
     * all failed. The former must remain unprocessed for the next sweep; the
     * latter is deliberately retired to avoid an infinite retry loop.
     */
    const attemptsAtStart: ImportAttemptBudget = { ...attempts };

    data.attemptBudgetsByProjectId?.set(projectBudgetKey, attempts);

    const createdIpAddresses: Array<string> = await this.importHostsFromScan({
      scan: scan,
      rules: rules,
      existingDevices: existingDevices,
      existingMonitors: existingMonitors,
      monitorTemplates: monitorTemplates,
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
    const inheritedBudget: boolean =
      result.isTruncated &&
      (attemptsAtStart.deviceCount > 0 || attemptsAtStart.monitorCount > 0);

    const shouldResume: boolean =
      result.isTruncated &&
      (result.devicesCreated > 0 ||
        result.monitorsCreated > 0 ||
        inheritedBudget);

    if (
      result.isTruncated &&
      result.devicesCreated === 0 &&
      result.monitorsCreated === 0 &&
      !inheritedBudget
    ) {
      logger.error(
        `Auto-import: scan ${scan.id?.toString()} hit a per-pass cap without making progress (${result.devicesFailed} device failure(s), ${result.monitorsFailed} monitor failure(s)); stamping it processed so the sweep does not retry it forever. Inspect the failures and use the rule's Run Now to retry deliberately.`,
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
    expectedMonitorTemplateId?: ObjectID | null;
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
          sysObjectIdPattern: true,
          includePingOnlyHosts: true,
          monitorTemplateId: true,
          oidTemplateId: true,
        },
        props: { isRoot: true },
      });

    if (!rule) {
      throw new BadDataException("Auto-import rule not found.");
    }

    if (data.expectedMonitorTemplateId !== undefined) {
      const expectedTemplateId: string =
        data.expectedMonitorTemplateId?.toString() || "";
      const currentTemplateId: string =
        rule.monitorTemplateId?.toString() || "";

      if (expectedTemplateId !== currentTemplateId) {
        throw new BadDataException(
          "This auto-import rule changed while the run was being authorized. Review it and run it again.",
        );
      }
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

    /*
     * Starts empty and is primed per scan from the addresses that scan found.
     * See getExistingDevices.
     */
    const existingDevices: Map<string, NetworkDevice> = new Map<
      string,
      NetworkDevice
    >();
    const hasMonitorProvisioningRule: boolean = Boolean(
      data.rule.monitorTemplateId,
    );
    const existingMonitors: ExistingMonitorProvisioningState =
      hasMonitorProvisioningRule
        ? await this.loadExistingMonitors(data.projectId)
        : this.emptyExistingMonitorProvisioningState();
    const monitorTemplates: Map<string, MonitorTemplate> =
      hasMonitorProvisioningRule
        ? await this.loadMonitorTemplates({
            projectId: data.projectId,
            rules: rules,
          })
        : new Map();

    const result: AutoImportRuleRunResult = this.emptyResult(data.isDryRun);
    const attempts: ImportAttemptBudget = { deviceCount: 0, monitorCount: 0 };

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
        existingDevices: existingDevices,
        existingMonitors: existingMonitors,
        monitorTemplates: monitorTemplates,
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
      monitorsWouldCreate: 0,
      monitorsCreated: 0,
      monitorsSkippedAlreadyExisting: 0,
      monitorsSkippedUnsupportedHost: 0,
      monitorsFailed: 0,
      isTruncated: false,
      hasMoreScans: false,
      isDryRun: isDryRun,
      matchedIpAddressSample: [],
    };
  }

  private emptyExistingMonitorProvisioningState(): ExistingMonitorProvisioningState {
    return {
      autoProvisionedKeys: new Set(),
      manuallyMonitoredDeviceIds: new Set(),
      attemptedProvisioningKeys: new Set(),
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
            sysObjectIdPattern: true,
            includePingOnlyHosts: true,
            monitorTemplateId: true,
            oidTemplateId: true,
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

  /*
   * The project's running map of "this address already has a device", shared
   * across every scan in one sweep.
   *
   * It starts EMPTY and is filled per scan by `primeExistingDevices`, from the
   * addresses that scan actually found. It used to start full — every device
   * in the project, paged out of the database — which was both a full-table
   * read per sweep and, on a fleet whose devices share one `createdAt` (what a
   * bulk import produces), an unstable page walk that SKIPPED hostnames and
   * let this engine create duplicates. See loadExistingDevices.
   */
  private getExistingDevices(data: {
    projectId: ObjectID;
    cache: ExistingHostnamesByProjectId;
  }): Map<string, NetworkDevice> {
    const key: string = data.projectId.toString();

    const cached: Map<string, NetworkDevice> | undefined = data.cache.get(key);

    if (cached) {
      return cached;
    }

    const fresh: Map<string, NetworkDevice> = new Map<string, NetworkDevice>();
    data.cache.set(key, fresh);

    return fresh;
  }

  /*
   * Fills the running map with whatever of THESE addresses already has a
   * device. Only what is found is recorded, so an address that is not
   * registered is looked up again if a later scan in the same sweep carries it
   * — one indexed lookup, and recording absence would go stale the moment this
   * run creates the device.
   */
  private async primeExistingDevices(data: {
    projectId: ObjectID;
    hostnames: Array<string>;
    into: Map<string, NetworkDevice>;
  }): Promise<void> {
    const found: Map<string, NetworkDevice> = await this.loadExistingDevices(
      data.projectId,
      data.hostnames,
    );

    for (const [hostname, device] of found) {
      data.into.set(hostname, device);
    }
  }

  /*
   * Every device address in the project — the same paged walk the probe
   * ingest endpoint does to stamp isAlreadyRegistered, for the same reason:
   * a truncated answer produces duplicate devices, which is worse than a
   * slow answer. Sorted for stable paging.
   */
  /*
   * The devices already at these addresses, keyed by hostname.
   *
   * This used to load EVERY device in the project, paging `ORDER BY
   * createdAt` — and a bulk discovery import stamps every device it creates
   * with the same `createdAt`, so on a large fleet the sort key is
   * single-valued and `LIMIT/OFFSET` over it returns an arbitrary,
   * non-deterministic slice per call. Pages overlapped and skipped, and a
   * skipped hostname reads as "not registered", which CREATES A DUPLICATE
   * DEVICE — the exact failure the paging was added to prevent. It also cost
   * a full table scan per page.
   *
   * Asking about the addresses the scans actually carry is both correct and
   * an indexed lookup. See NetworkDeviceService.getDevicesByHostnames.
   */
  private async loadExistingDevices(
    projectId: ObjectID,
    hostnames: Array<string>,
  ): Promise<Map<string, NetworkDevice>> {
    return NetworkDeviceService.getDevicesByHostnames({
      projectId: projectId,
      hostnames: hostnames,
      select: {
        _id: true,
        projectId: true,
        name: true,
        hostname: true,
        monitoringMethod: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static monitorProvisioningKey(
    networkDeviceId: ObjectID | string,
    monitorTemplateId: ObjectID | string,
  ): string {
    return `${networkDeviceId.toString()}:${monitorTemplateId.toString()}`;
  }

  private async getExistingMonitors(data: {
    projectId: ObjectID;
    cache: ExistingMonitorsByProjectId;
  }): Promise<ExistingMonitorProvisioningState> {
    const key: string = data.projectId.toString();
    const cached: ExistingMonitorProvisioningState | undefined =
      data.cache.get(key);

    if (cached) {
      return cached;
    }

    const loaded: ExistingMonitorProvisioningState =
      await this.loadExistingMonitors(data.projectId);
    data.cache.set(key, loaded);
    return loaded;
  }

  /*
   * Queryable provenance is the concurrency/idempotency key for monitors
   * created by this engine. Existing manually-created Network Device
   * monitors are parsed once and suppress automatic duplicates: an operator
   * who already chose how to monitor a device must not receive a second,
   * potentially billable monitor merely because an import rule was edited.
   */
  private async loadExistingMonitors(
    projectId: ObjectID,
  ): Promise<ExistingMonitorProvisioningState> {
    const state: ExistingMonitorProvisioningState =
      this.emptyExistingMonitorProvisioningState();

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: projectId,
          monitorType: MonitorType.NetworkDevice,
        },
        select: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
          monitorTemplateId: true,
          autoProvisionedNetworkDeviceId: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: { isRoot: true },
      });

      for (const monitor of monitors) {
        this.recordExistingMonitor(state, monitor);
      }

      if (monitors.length < LIMIT_MAX) {
        break;
      }
    }

    return state;
  }

  /*
   * Classify one stored monitor from both its queryable provenance and its
   * actual step binding. Provenance is trusted only while the monitor still
   * watches the device it was provisioned for. An orphaned template link or
   * any legacy drift is treated as an operator-managed monitor on its actual
   * device(s), which is the conservative no-duplicate behavior.
   */
  private recordExistingMonitor(
    state: ExistingMonitorProvisioningState,
    monitor: Monitor,
  ): void {
    const referencedDeviceIds: Set<string> = new Set(
      NetworkDeviceHydrationUtil.getReferencedNetworkDeviceIds([monitor]),
    );
    const provenanceDeviceId: string =
      monitor.autoProvisionedNetworkDeviceId?.toString() || "";

    if (
      provenanceDeviceId &&
      monitor.monitorTemplateId &&
      referencedDeviceIds.size === 1 &&
      referencedDeviceIds.has(provenanceDeviceId)
    ) {
      state.autoProvisionedKeys.add(
        NetworkDeviceAutoImportRuleEngineServiceClass.monitorProvisioningKey(
          provenanceDeviceId,
          monitor.monitorTemplateId,
        ),
      );
      return;
    }

    for (const networkDeviceId of referencedDeviceIds) {
      state.manuallyMonitoredDeviceIds.add(networkDeviceId);
    }
  }

  /*
   * Close the practical manual-create race left by the project-wide snapshot:
   * immediately before provisioning a device, search the JSON step payload
   * for its UUID and classify exact bindings. The automatic (device,template)
   * partial unique index remains the final concurrent-auto backstop; this
   * narrow read prevents a monitor a human just created from being ignored by
   * a long-running sweep.
   */
  private async refreshExistingMonitorsForDevice(data: {
    projectId: ObjectID;
    networkDeviceId: ObjectID;
    state: ExistingMonitorProvisioningState;
  }): Promise<void> {
    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          monitorType: MonitorType.NetworkDevice,
          monitorSteps: QueryHelper.search(data.networkDeviceId.toString()),
        },
        select: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
          monitorTemplateId: true,
          autoProvisionedNetworkDeviceId: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: skip,
        props: { isRoot: true },
      });

      for (const monitor of monitors) {
        this.recordExistingMonitor(data.state, monitor);
      }

      if (monitors.length < LIMIT_MAX) {
        break;
      }
    }
  }

  private async loadMonitorTemplates(data: {
    projectId: ObjectID;
    rules: Array<NetworkDeviceAutoImportRule>;
  }): Promise<Map<string, MonitorTemplate>> {
    const ids: Array<ObjectID | string> = Array.from(
      new Map<string, ObjectID | string>(
        data.rules
          .filter((rule: NetworkDeviceAutoImportRule): boolean => {
            return Boolean(rule.monitorTemplateId);
          })
          .map((rule: NetworkDeviceAutoImportRule) => {
            const id: ObjectID | string = rule.monitorTemplateId!;
            return [id.toString(), id];
          }),
      ).values(),
    );

    const templatesById: Map<string, MonitorTemplate> = new Map();
    if (ids.length === 0) {
      return templatesById;
    }

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const templates: Array<MonitorTemplate> =
        await MonitorTemplateService.findBy({
          query: {
            _id: QueryHelper.any(ids),
            projectId: data.projectId,
            monitorType: MonitorType.NetworkDevice,
          },
          select: {
            _id: true,
            projectId: true,
            monitorName: true,
            monitorDescription: true,
            monitorType: true,
            monitorSteps: true,
            monitoringInterval: true,
            minimumProbeAgreement: true,
            customFields: true,
            labels: { _id: true },
          },
          sort: { createdAt: SortOrder.Ascending },
          limit: LIMIT_MAX,
          skip: skip,
          props: { isRoot: true },
        });

      for (const template of templates) {
        if (template.id) {
          templatesById.set(template.id.toString(), template);
        }
      }

      if (templates.length < LIMIT_MAX) {
        break;
      }
    }

    return templatesById;
  }

  /*
   * The core loop: evaluate every discovered host of one scan against the
   * rule set, create what should import, reconcile selected template monitors,
   * and account for every host in the shared result. Returns the addresses
   * actually created (for the jsonb write-back). Mutates `existingDevices` as
   * it creates, which is what makes duplicate rows, overlapping scans in one
   * sweep, and repeat runs idempotent.
   */
  private async importHostsFromScan(data: {
    scan: NetworkDeviceDiscoveryScan;
    rules: Array<NetworkDeviceAutoImportRule>;
    existingDevices: Map<string, NetworkDevice>;
    existingMonitors: ExistingMonitorProvisioningState;
    monitorTemplates: Map<string, MonitorTemplate>;
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

    /*
     * Ask the database about THESE addresses, once, before the loop — rather
     * than having loaded every device in the project up front.
     */
    await this.primeExistingDevices({
      projectId: scan.projectId,
      hostnames: hosts.map((host: DiscoveredNetworkDevice): string => {
        return host.ipAddress || "";
      }),
      into: data.existingDevices,
    });

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

      const templateIds: Array<string> = Array.from(
        new Set(
          evaluation.matchedRules
            .map((matchedRule: AutoImportRuleCandidate): string => {
              return matchedRule.monitorTemplateId?.toString() || "";
            })
            .filter((id: string): boolean => {
              return Boolean(id);
            }),
        ),
      );

      /*
       * The OID Collection Template the imported device is LINKED to.
       *
       * A device carries at most one, so unlike the monitor templates above
       * this is not a set: the first matching rule that names one wins, and
       * rules are already in a deterministic order. Linking here is what
       * makes the template a device TYPE rather than a shortcut - without it
       * every scan would import devices that somebody has to go back and
       * bulk-assign by hand, which is the chore issue #3507 is about.
       */
      const oidTemplateIdForHost: ObjectID | undefined = (():
        | ObjectID
        | undefined => {
        for (const matchedRule of evaluation.matchedRules) {
          const candidateId: string =
            matchedRule.oidTemplateId?.toString() || "";

          if (candidateId) {
            return new ObjectID(candidateId);
          }
        }

        return undefined;
      })();

      let networkDevice: NetworkDevice | undefined = data.existingDevices.get(
        host.ipAddress,
      );
      let deviceWasCreated: boolean = false;

      /*
       * The frozen isAlreadyRegistered flag AND the live set: the flag is a
       * point-in-time answer from the last upload, the set covers devices
       * created since — including by this very run, which is what collapses
       * duplicate rows and overlapping scans into one device.
       */
      if (host.isAlreadyRegistered || networkDevice) {
        result.hostsSkippedAlreadyRegistered++;

        /*
         * A stale scan can claim a deleted device is still registered. With
         * no live row there is neither a safe binding nor enough intent to
         * recreate it from old data, so preserve the established skip.
         */
        if (!networkDevice) {
          continue;
        }
      }

      if (result.matchedIpAddressSample.length < MAX_MATCHED_IP_SAMPLE) {
        if (!result.matchedIpAddressSample.includes(host.ipAddress)) {
          result.matchedIpAddressSample.push(host.ipAddress);
        }
      }

      if (!networkDevice) {
        if (data.attempts.deviceCount >= MAX_DEVICES_PER_AUTO_IMPORT_RUN) {
          result.isTruncated = true;
          break;
        }

        if (data.isDryRun) {
          /*
           * Add a fully-shaped in-memory device to simulate the create. Its
           * generated id never leaves this process; it merely lets monitor
           * reconciliation deduplicate the same host across duplicate rows
           * and overlapping scans exactly as a real run would.
           */
          data.attempts.deviceCount++;
          networkDevice = buildNetworkDeviceFromDiscoveredHost({
            projectId: scan.projectId,
            host: host,
            scan: scan,
            autoApplyVendorHealthTemplate: true,
            ...(oidTemplateIdForHost
              ? { oidTemplateId: oidTemplateIdForHost }
              : {}),
          });
          networkDevice.id = ObjectID.generate();
          data.existingDevices.set(host.ipAddress, networkDevice);
        } else {
          const createResult: {
            device: NetworkDevice | null;
            wasCreated: boolean;
          } = await this.createDeviceForHost({
            projectId: scan.projectId,
            scan: scan,
            host: host,
            existingDevices: data.existingDevices,
            result: result,
            attempts: data.attempts,
            ...(oidTemplateIdForHost
              ? { oidTemplateId: oidTemplateIdForHost }
              : {}),
          });

          networkDevice = createResult.device || undefined;
          deviceWasCreated = createResult.wasCreated;

          if (!networkDevice) {
            continue;
          }
        }
      }

      if (deviceWasCreated) {
        createdIpAddresses.push(host.ipAddress);
      }

      if (templateIds.length === 0) {
        continue;
      }

      const monitorsWereTruncated: boolean = await this.ensureMonitorsForDevice(
        {
          projectId: scan.projectId,
          host: host,
          networkDevice: networkDevice,
          templateIds: templateIds,
          monitorTemplates: data.monitorTemplates,
          existingMonitors: data.existingMonitors,
          result: result,
          attempts: data.attempts,
          isDryRun: data.isDryRun,
        },
      );

      if (monitorsWereTruncated) {
        result.isTruncated = true;
        break;
      }
    }

    return createdIpAddresses;
  }

  private async ensureMonitorsForDevice(data: {
    projectId: ObjectID;
    host: DiscoveredNetworkDevice;
    networkDevice: NetworkDevice;
    templateIds: Array<string>;
    monitorTemplates: Map<string, MonitorTemplate>;
    existingMonitors: ExistingMonitorProvisioningState;
    result: AutoImportRuleRunResult;
    attempts: ImportAttemptBudget;
    isDryRun: boolean;
  }): Promise<boolean> {
    /*
     * A Network Device monitor is fed by the device's polls, and nothing
     * polls a monitor-backed device — its bound monitor's status IS its
     * status — so a monitor provisioned onto one could only ever sit inert.
     * The DEVICE's method is the whole test. A ping-only host is no longer
     * a reason to skip: it imports as a Probe device, pinged on schedule,
     * and its monitor evaluates reachability from that ping while the OID
     * and interface criteria stay unevaluated (null) until credentials
     * arrive and a walk runs — see SnmpMonitorCriteria.
     */
    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        data.networkDevice.monitoringMethod,
      )
    ) {
      data.result.monitorsSkippedUnsupportedHost += data.templateIds.length;
      return false;
    }

    if (!data.networkDevice.id) {
      data.result.monitorsFailed += data.templateIds.length;
      logger.error(
        `Auto-import: cannot provision monitor(s) for ${data.host.ipAddress} because the Network Device has no id.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return false;
    }

    const networkDeviceId: ObjectID = data.networkDevice.id;
    const networkDeviceIdString: string = networkDeviceId.toString();
    const pendingTemplateIds: Array<string> = [];

    /*
     * The project-wide snapshot is complete and indexed. Settle everything
     * it already covers before issuing the narrow JSON race-check query; an
     * established fleet whose monitors are already reconciled must not do one
     * full monitor-table search per discovered device on every scan.
     */
    for (const templateId of data.templateIds) {
      const key: string =
        NetworkDeviceAutoImportRuleEngineServiceClass.monitorProvisioningKey(
          networkDeviceId,
          templateId,
        );

      if (data.existingMonitors.autoProvisionedKeys.has(key)) {
        data.result.monitorsSkippedAlreadyExisting++;
        continue;
      }

      if (data.existingMonitors.attemptedProvisioningKeys.has(key)) {
        continue;
      }

      pendingTemplateIds.push(templateId);
    }

    if (pendingTemplateIds.length === 0) {
      return false;
    }

    if (
      data.existingMonitors.manuallyMonitoredDeviceIds.has(
        networkDeviceIdString,
      )
    ) {
      data.result.monitorsSkippedAlreadyExisting += pendingTemplateIds.length;
      return false;
    }

    /*
     * Do not run the unindexed JSON race-check after this run's monitor-work
     * budget is already exhausted. The device remains unreconciled and the
     * truncated marker protocol brings it back on the next bounded pass.
     */
    if (data.attempts.monitorCount >= MAX_MONITORS_PER_AUTO_IMPORT_RUN) {
      return true;
    }

    if (!data.isDryRun) {
      await this.refreshExistingMonitorsForDevice({
        projectId: data.projectId,
        networkDeviceId: networkDeviceId,
        state: data.existingMonitors,
      });
    }

    if (
      data.existingMonitors.manuallyMonitoredDeviceIds.has(
        networkDeviceIdString,
      )
    ) {
      data.result.monitorsSkippedAlreadyExisting += pendingTemplateIds.length;
      return false;
    }

    for (const templateId of pendingTemplateIds) {
      const key: string =
        NetworkDeviceAutoImportRuleEngineServiceClass.monitorProvisioningKey(
          networkDeviceId,
          templateId,
        );

      /* The race-check may have found this key after the initial snapshot. */
      if (data.existingMonitors.autoProvisionedKeys.has(key)) {
        data.result.monitorsSkippedAlreadyExisting++;
        continue;
      }

      if (data.attempts.monitorCount >= MAX_MONITORS_PER_AUTO_IMPORT_RUN) {
        return true;
      }

      data.attempts.monitorCount++;
      data.existingMonitors.attemptedProvisioningKeys.add(key);

      /*
       * Invalid or concurrently deleted templates are failed attempts too.
       * Count them inside the same cap before looking up the cached template;
       * otherwise one stale rule could walk and log an unbounded estate in a
       * single API request or worker tick.
       */
      const template: MonitorTemplate | undefined =
        data.monitorTemplates.get(templateId);

      if (!template) {
        data.result.monitorsFailed++;
        logger.error(
          `Auto-import: Network Device monitor template ${templateId} is missing, deleted, or not valid for project ${data.projectId.toString()}.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        continue;
      }

      if (data.isDryRun) {
        data.result.monitorsWouldCreate++;
        data.existingMonitors.autoProvisionedKeys.add(key);
        continue;
      }

      try {
        const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
          template: template,
          networkDevice: data.networkDevice,
        });

        await MonitorService.create({
          data: monitor,
          props: {
            isRoot: true,
            tenantId: data.projectId,
          },
        });

        data.existingMonitors.autoProvisionedKeys.add(key);
        data.result.monitorsCreated++;
      } catch (error) {
        /*
         * The partial unique index is the final race backstop. If another
         * writer won between our cache read and create, classify that as an
         * idempotent skip; otherwise expose a real provisioning failure and
         * leave the key absent so a later scan or Run Now can retry it.
         */
        const createdMeanwhile: Monitor | null = await MonitorService.findOneBy(
          {
            query: {
              projectId: data.projectId,
              monitorType: MonitorType.NetworkDevice,
              monitorTemplateId: new ObjectID(templateId),
              autoProvisionedNetworkDeviceId: networkDeviceId,
            },
            select: {
              _id: true,
              monitorType: true,
              monitorSteps: true,
              monitorTemplateId: true,
              autoProvisionedNetworkDeviceId: true,
            },
            props: { isRoot: true },
          },
        );

        if (createdMeanwhile) {
          this.recordExistingMonitor(data.existingMonitors, createdMeanwhile);

          if (data.existingMonitors.autoProvisionedKeys.has(key)) {
            data.result.monitorsSkippedAlreadyExisting++;
            continue;
          }
        }

        data.result.monitorsFailed++;
        logger.error(
          `Auto-import: could not create monitor from template ${templateId} for Network Device ${networkDeviceId.toString()} (${data.host.ipAddress}): ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }

    return false;
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
    oidTemplateId?: ObjectID | undefined;
    projectId: ObjectID;
    scan: NetworkDeviceDiscoveryScan;
    host: DiscoveredNetworkDevice;
    existingDevices: Map<string, NetworkDevice>;
    result: AutoImportRuleRunResult;
    attempts: ImportAttemptBudget;
  }): Promise<{ device: NetworkDevice | null; wasCreated: boolean }> {
    data.attempts.deviceCount++;

    const attemptCreate: (name?: string) => Promise<NetworkDevice> = async (
      name?: string,
    ): Promise<NetworkDevice> => {
      const device: NetworkDevice = buildNetworkDeviceFromDiscoveredHost({
        projectId: data.projectId,
        host: data.host,
        scan: data.scan,
        name: name,
        /*
         * Zero-touch all the way down: nobody reviews an auto-imported
         * device, so nobody would ever click the vendor-template banner.
         * The first poll that fingerprints the vendor seeds the Health
         * OIDs instead (NetworkInventoryUtil).
         */
        autoApplyVendorHealthTemplate: true,
        ...(data.oidTemplateId ? { oidTemplateId: data.oidTemplateId } : {}),
      });

      const created: NetworkDevice = await NetworkDeviceService.create({
        data: device,
        props: {
          isRoot: true,
        },
      });

      return created || device;
    };

    let createdDevice: NetworkDevice;

    try {
      createdDevice = await attemptCreate();
    } catch (firstError) {
      const registeredMeanwhile: NetworkDevice | null =
        await NetworkDeviceService.findOneBy({
          query: {
            projectId: data.projectId,
            hostname: data.host.ipAddress,
          },
          select: {
            _id: true,
            projectId: true,
            name: true,
            hostname: true,
            monitoringMethod: true,
          },
          props: { isRoot: true },
        });

      if (registeredMeanwhile) {
        // Skipped is a sub-bucket of matched, same as the other run results.
        data.result.hostsSkippedAlreadyRegistered++;
        data.existingDevices.set(data.host.ipAddress, registeredMeanwhile);
        return { device: registeredMeanwhile, wasCreated: false };
      }

      try {
        createdDevice = await attemptCreate(buildFallbackDeviceName(data.host));
      } catch (secondError) {
        data.result.devicesFailed++;
        logger.error(
          `Auto-import: could not create a device for ${data.host.ipAddress} (scan ${data.scan.id?.toString()}): ${firstError} / retry: ${secondError}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        return { device: null, wasCreated: false };
      }
    }

    data.result.devicesCreated++;
    data.existingDevices.set(data.host.ipAddress, createdDevice);

    return { device: createdDevice, wasCreated: true };
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
