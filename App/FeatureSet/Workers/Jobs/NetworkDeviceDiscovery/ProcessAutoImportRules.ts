import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceAutoImportRuleEngineService, {
  AUTO_IMPORT_SWEEP_LOCK_KEY,
  AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
  AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
  ExistingHostnamesByProjectId,
  ExistingMonitorsByProjectId,
  ImportAttemptBudgetsByProjectId,
} from "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { AutoImportRuleRunResult } from "Common/Types/NetworkAutomation/RuleRunResult";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";

/*
 * The automatic half of network device auto-import rules (issue #3378).
 *
 * The probe-ingest result endpoint stores a completed scan's discovered
 * hosts and clears the scan's autoImportProcessedAt marker in the same
 * write; this job sweeps every minute for Completed scans whose marker is
 * NULL and hands each to the rule engine, which imports what the project's
 * rules claim and stamps the marker behind a compare-and-set on
 * (status, completedAt). Scans in rule-less projects are stamped without
 * importing, so unprocessed results can never accumulate and mass-import
 * months later when a project writes its first rule.
 *
 * Evaluation deliberately does NOT run inside the ingest request: importing
 * hundreds of devices is minutes of paced work, the probe synchronously
 * waits on that response, and a process restart mid-run would lose the work
 * silently. Here, a crashed pass simply leaves the marker NULL and the next
 * tick resumes — device creation is idempotent per (project, address), so
 * resuming re-creates nothing.
 */

// Wall-clock budget of one sweep, mirrored by the job's own timeoutInMS.
const SWEEP_TIMEOUT_MINUTES: number = 10;

/*
 * Redis mutex that serializes the whole sweep across every worker replica —
 * the same arrangement, for the same reason, as Slo:EvaluateSlos: RunCron
 * has no overlap guard (the next repeatable iteration materializes while
 * the current one runs, across a many-replica fleet at concurrency 100),
 * runJobWithTimeout is a Promise.race with no cancellation, and a sweep
 * that creates hundreds of devices easily outlives the one-minute schedule.
 * Two concurrent sweeps over the same marker-NULL scans would race the
 * engine's check-then-create idempotency into duplicate devices; one sweep
 * at a time makes that window a single process's, which the engine's shared
 * hostname set already covers.
 *
 * The lock identity lives on the ENGINE (AUTO_IMPORT_SWEEP_LOCK_*) because
 * the manual Run Now path takes the same lock for its real runs — sweep vs
 * Run Now is the same duplicate-device race as sweep vs sweep. The lock
 * timeout outlives the job timeout so an overrunning sweep keeps holding
 * the lock rather than letting a second sweep in behind it; redis-semaphore
 * auto-refreshes a held lock, so the value only bounds how long a CRASHED
 * worker's lock lingers.
 */

RunCron(
  "NetworkDeviceDiscovery:ProcessAutoImportRules",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async () => {
    /*
     * acquireAttemptsLimit: 1 — never queue behind the in-flight sweep. The
     * job re-runs every minute anyway; skipping is the correct backpressure.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: AUTO_IMPORT_SWEEP_LOCK_KEY,
        namespace: AUTO_IMPORT_SWEEP_LOCK_NAMESPACE,
        lockTimeout: AUTO_IMPORT_SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `NetworkDeviceDiscovery:ProcessAutoImportRules - Could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this tick: ${err}`,
      );
      return;
    }

    try {
      /*
       * Minimal columns only: discoveredDevices is multi-megabyte jsonb on
       * big sweeps, and this snapshot spans every unprocessed scan across
       * every project. The engine re-reads each scan in full — and
       * re-checks its status and marker on that fresh read, since this
       * snapshot ages while earlier scans are processed.
       */
      const unprocessedScans: Array<NetworkDeviceDiscoveryScan> =
        await NetworkDeviceDiscoveryScanService.findBy({
          query: {
            status: "Completed",
            autoImportProcessedAt: QueryHelper.isNull(),
          },
          select: {
            _id: true,
            projectId: true,
          },
          /*
           * Oldest results first, so under a backlog (worker outage, first
           * deploy) the freshness horizon retires stale scans before newer
           * results wait behind them.
           */
          sort: {
            completedAt: SortOrder.Ascending,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      if (unprocessedScans.length === 0) {
        return;
      }

      /*
       * Shared across the whole sweep: a device created from one scan must
       * read as registered when an overlapping scan reports the same
       * address moments later.
       */
      const existingHostnamesByProjectId: ExistingHostnamesByProjectId =
        new Map();
      const existingMonitorsByProjectId: ExistingMonitorsByProjectId =
        new Map();
      const attemptBudgetsByProjectId: ImportAttemptBudgetsByProjectId =
        new Map();
      const cappedProjectIds: Set<string> = new Set();

      for (const scan of unprocessedScans) {
        const projectId: string = scan.projectId?.toString() || "";

        /*
         * Device and active-monitor caps are per project per sweep, not per
         * scan. Once one scan reaches either cap, leave the rest of that
         * project's markers untouched for the next tick while still serving
         * other projects in this sweep.
         */
        if (projectId && cappedProjectIds.has(projectId)) {
          continue;
        }

        try {
          const result: AutoImportRuleRunResult | null =
            await NetworkDeviceAutoImportRuleEngineService.processCompletedScan(
              {
                scanId: scan.id!,
                existingHostnamesByProjectId: existingHostnamesByProjectId,
                existingMonitorsByProjectId: existingMonitorsByProjectId,
                attemptBudgetsByProjectId: attemptBudgetsByProjectId,
              },
            );

          if (result?.isTruncated && projectId) {
            cappedProjectIds.add(projectId);
          }

          if (
            result &&
            (result.devicesCreated > 0 ||
              result.devicesFailed > 0 ||
              result.monitorsCreated > 0 ||
              result.monitorsFailed > 0)
          ) {
            logger.info(
              `NetworkDeviceDiscovery:ProcessAutoImportRules - scan ${scan.id?.toString()}: ${result.devicesCreated} device(s) auto-imported, ${result.hostsSkippedAlreadyRegistered} already registered, ${result.hostsExcluded} excluded, ${result.devicesFailed} device import(s) failed; ${result.monitorsCreated} active Network Device monitor(s) created, ${result.monitorsSkippedAlreadyExisting} requested monitor(s) skipped because monitoring already existed, ${result.monitorsSkippedUnsupportedHost} requested monitor(s) unsupported, ${result.monitorsFailed} monitor create(s) failed${
                result.isTruncated
                  ? "; capped — the next tick will resume this scan"
                  : ""
              }.`,
              { projectId: scan.projectId?.toString() } as LogAttributes,
            );
          } else if (
            result &&
            (result.hostsSkippedAlreadyRegistered > 0 ||
              result.hostsExcluded > 0 ||
              result.monitorsSkippedAlreadyExisting > 0 ||
              result.monitorsSkippedUnsupportedHost > 0)
          ) {
            logger.debug(
              `NetworkDeviceDiscovery:ProcessAutoImportRules - scan ${scan.id?.toString()} required no writes: ${result.hostsSkippedAlreadyRegistered} host(s) already registered, ${result.hostsExcluded} excluded, ${result.monitorsSkippedAlreadyExisting} requested monitor(s) already covered, ${result.monitorsSkippedUnsupportedHost} requested monitor(s) unsupported.`,
              { projectId: scan.projectId?.toString() } as LogAttributes,
            );
          }
        } catch (err) {
          // One bad scan must never abort the whole sweep.
          logger.error(
            `NetworkDeviceDiscovery:ProcessAutoImportRules - Error processing scan ${scan.id?.toString()}: ${err}`,
            { projectId: scan.projectId?.toString() } as LogAttributes,
          );
        }
      }
    } finally {
      /*
       * Released in `finally` so a throw anywhere in the sweep frees the
       * lock for the next tick instead of wedging the job until the lock
       * times out.
       */
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(
          `NetworkDeviceDiscovery:ProcessAutoImportRules - Error releasing the sweep lock: ${err}`,
        );
      }
    }
  },
);
