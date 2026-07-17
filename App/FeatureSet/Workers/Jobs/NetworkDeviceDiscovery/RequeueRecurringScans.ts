import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";

/*
 * Re-queues recurring subnet discovery scans that are due.
 *
 * The lifecycle: the probe-ingest result endpoint (Telemetry/API/ProbeIngest/
 * DiscoveryScan.ts) stamps nextScanAt when a recurring scan completes or
 * fails. Once that moment passes, this job flips the scan back to Pending so
 * the probe's FetchScans poller picks it up again like a brand-new scan.
 *
 * Only Completed/Failed scans are eligible — a scan that is still Pending or
 * In Progress must never be re-queued underneath the probe that is running
 * it. nextScanAt is cleared on re-queue so a scan the probe never picks up
 * (probe offline) cannot be re-queued twice.
 *
 * discoveredDevices from the previous run are intentionally KEPT: the
 * dashboard's "Review Results" flow is only reachable while status is
 * Completed, so stale results are not reviewable during the re-run anyway,
 * and the ingest endpoint overwrites them the moment new results arrive.
 * Clearing them here would only destroy the last good inventory.
 */
/*
 * A subnet sweep is bounded work: 4096 hosts / 32 workers with 1s ping +
 * 2s SNMP timeouts finishes in minutes. A scan still In Progress after
 * this long means the probe that claimed it died mid-scan (crash,
 * redeploy, decommission) and will never report back.
 */
const STALE_IN_PROGRESS_HOURS: number = 2;

RunCron(
  "NetworkDeviceDiscovery:RequeueRecurringScans",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * Rescue scans stranded In Progress by a dead probe. Without this a
     * recurring scan whose probe died mid-sweep would never be re-queued
     * (nextScanAt is only stamped when a result arrives) and a one-shot
     * scan would sit In Progress in the UI forever. Marking the scan
     * Failed with nextScanAt set lets the requeue below pick a recurring
     * one up on the next tick, exactly as if the probe had reported the
     * failure itself.
     */
    const staleScans: Array<NetworkDeviceDiscoveryScan> =
      await NetworkDeviceDiscoveryScanService.findAllBy({
        query: {
          status: "In Progress",
          startedAt: QueryHelper.lessThan(
            OneUptimeDate.getSomeHoursAgo(STALE_IN_PROGRESS_HOURS),
          ),
        },
        select: {
          _id: true,
          cidr: true,
        },
        props: {
          isRoot: true,
        },
      });

    for (const scan of staleScans) {
      logger.warn(
        `Discovery scan ${scan.id?.toString()} (${scan.cidr}) has been In Progress for over ${STALE_IN_PROGRESS_HOURS} hour(s); marking it Failed (probe likely went offline mid-scan).`,
      );

      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scan.id!,
        // Cast: same DeepPartial-recursion workaround as below.
        data: {
          status: "Failed",
          statusMessage: `The probe did not report a result within ${STALE_IN_PROGRESS_HOURS} hours. It may have gone offline mid-scan.`,
          completedAt: OneUptimeDate.getCurrentDate(),
          // Recurring scans become due immediately; ignored for one-shots.
          nextScanAt: OneUptimeDate.getCurrentDate(),
        } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
        props: {
          isRoot: true,
        },
      });
    }

    const dueScans: Array<NetworkDeviceDiscoveryScan> =
      await NetworkDeviceDiscoveryScanService.findAllBy({
        query: {
          isRecurring: true,
          nextScanAt: QueryHelper.lessThanEqualTo(
            OneUptimeDate.getCurrentDate(),
          ),
          status: QueryHelper.any(["Completed", "Failed"]),
        },
        select: {
          _id: true,
          cidr: true,
        },
        props: {
          isRoot: true,
        },
      });

    for (const scan of dueScans) {
      logger.debug(
        `Re-queueing recurring discovery scan ${scan.id?.toString()} (${scan.cidr}).`,
      );

      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scan.id!,
        /*
         * Cast: the model's JSON column makes DeepPartial recursion blow up
         * (same workaround as the probe-ingest endpoints). Run-state columns
         * are reset so the row reads as a fresh Pending scan; nextScanAt is
         * cleared so this job cannot claim it again before it runs.
         */
        data: {
          status: "Pending",
          statusMessage: null,
          startedAt: null,
          completedAt: null,
          nextScanAt: null,
        } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
        props: {
          isRoot: true,
        },
      });
    }

    if (dueScans.length > 0) {
      logger.debug(`Re-queued ${dueScans.length} recurring discovery scan(s).`);
    }
  },
);
