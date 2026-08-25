import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceAutoImportRuleEngineService, {
  ExistingHostnamesByProjectId,
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
 * The lock timeout outlives the job timeout so an overrunning sweep keeps
 * holding the lock rather than letting a second sweep in behind it;
 * redis-semaphore auto-refreshes a held lock, so the value only bounds how
 * long a CRASHED worker's lock lingers.
 */
const SWEEP_LOCK_KEY: string = "NetworkDeviceDiscovery:ProcessAutoImportRules";
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(SWEEP_TIMEOUT_MINUTES + 1);

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
        key: SWEEP_LOCK_KEY,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
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

      for (const scan of unprocessedScans) {
        try {
          const result: AutoImportRuleRunResult | null =
            await NetworkDeviceAutoImportRuleEngineService.processCompletedScan(
              {
                scanId: scan.id!,
                existingHostnamesByProjectId: existingHostnamesByProjectId,
              },
            );

          if (
            result &&
            (result.devicesCreated > 0 || result.devicesFailed > 0)
          ) {
            logger.info(
              `NetworkDeviceDiscovery:ProcessAutoImportRules - scan ${scan.id?.toString()}: ${result.devicesCreated} device(s) auto-imported, ${result.hostsSkippedAlreadyRegistered} already registered, ${result.hostsExcluded} excluded, ${result.devicesFailed} failed${
                result.isTruncated
                  ? "; capped — the next tick will resume this scan"
                  : ""
              }.`,
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
