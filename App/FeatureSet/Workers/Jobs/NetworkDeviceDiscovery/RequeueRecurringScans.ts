import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import {
  UNCLAIMED_PENDING_MINUTES,
  UnclaimedScanProbeState,
  buildUnclaimedScanDiagnosis,
} from "Common/Utils/NetworkDiscovery/UnclaimedScanDiagnosis";
import logger from "Common/Server/Utils/Logger";

/*
 * The server's half of keeping a subnet discovery scan honest. Three passes,
 * every minute:
 *
 *   1. rescue a scan stranded In Progress by a probe that died mid-sweep,
 *   2. re-queue a recurring scan whose next run is due,
 *   3. explain a scan that is still sitting in Pending because no probe has
 *      claimed it (see explainUnclaimedScans at the bottom of this file).
 *
 * The job's name predates (3) and is kept so its metrics stay continuous.
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
 * A discovery sweep is bounded work: at the ScanTargetUtil.MAX_SCAN_HOSTS
 * ceiling (32,768 addresses) 32 workers with 1s ping + 2s SNMP timeouts
 * finish in well under an hour even when the ICMP pre-sweep is unavailable
 * and every address is SNMP-probed directly. A scan still In Progress after
 * this long means the probe that claimed it died mid-scan (crash, redeploy,
 * decommission) and will never report back.
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

    await explainUnclaimedScans();
  },
);

/*
 * The third pass: say why a scan is still sitting in "Pending".
 *
 * The two passes above rescue scans a probe TOOK and abandoned. Neither can
 * see the opposite failure — a scan no probe ever took — because only the
 * claim endpoint moves a row off Pending and there is nothing for a reaper to
 * time out. That gap is what OneUptime issue #3287 reported: four scans, an
 * hour apart, all "Pending", nothing anywhere in the product to say why.
 *
 * See Common/Utils/NetworkDiscovery/UnclaimedScanDiagnosis for why this
 * annotates rather than fails the scan.
 */
export async function explainUnclaimedScans(): Promise<void> {
  /*
   * updatedAt, not createdAt: a recurring scan that the pass above just
   * re-queued has been Pending for seconds, however old the row is. Any write
   * to the row bumps this, so for a scan sitting untouched in Pending it is
   * exactly the moment it entered that state.
   */
  const unclaimedScans: Array<NetworkDeviceDiscoveryScan> =
    await NetworkDeviceDiscoveryScanService.findAllBy({
      query: {
        status: "Pending",
        updatedAt: QueryHelper.lessThan(
          OneUptimeDate.getSomeMinutesAgo(UNCLAIMED_PENDING_MINUTES),
        ),
      },
      select: {
        _id: true,
        cidr: true,
        probeId: true,
        statusMessage: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (unclaimedScans.length === 0) {
    return;
  }

  /*
   * A probe runs one sweep at a time (the claim endpoint's `limit: 1`), so
   * every other scan assigned to a probe that is mid-sweep is legitimately
   * queued — for as long as that sweep takes, which at the scan-size ceiling
   * is the better part of an hour. Reporting those as unclaimed would turn
   * normal queueing into an alarm, so a probe with work in flight is skipped
   * entirely.
   */
  const busyScans: Array<NetworkDeviceDiscoveryScan> =
    await NetworkDeviceDiscoveryScanService.findAllBy({
      query: {
        status: "In Progress",
      },
      select: {
        _id: true,
        probeId: true,
      },
      props: {
        isRoot: true,
      },
    });

  const busyProbeIds: Set<string> = new Set(
    busyScans.map((scan: NetworkDeviceDiscoveryScan) => {
      return scan.probeId?.toString() || "";
    }),
  );

  /*
   * One probe row per probe, not per scan: a probe with several scans queued
   * behind it is the common shape of this failure.
   */
  const probeStateById: Map<string, UnclaimedScanProbeState> = new Map();

  for (const scan of unclaimedScans) {
    const probeId: string | undefined = scan.probeId?.toString();

    if (!probeId || busyProbeIds.has(probeId)) {
      continue;
    }

    if (!probeStateById.has(probeId)) {
      const probe: Probe | null = await ProbeService.findOneById({
        id: scan.probeId!,
        select: {
          _id: true,
          name: true,
          connectionStatus: true,
          lastAlive: true,
        },
        props: {
          isRoot: true,
        },
      });

      probeStateById.set(probeId, {
        ...(probe?.name ? { probeName: probe.name } : {}),
        /*
         * A probe row that no longer exists cannot be connected. The scan's
         * probeId column is ON DELETE CASCADE, so this is the narrow window
         * between a probe being deleted and the cascade landing.
         */
        isProbeConnected:
          probe?.connectionStatus === ProbeConnectionStatus.Connected,
        lastAliveAt: probe?.lastAlive || null,
      });
    }

    const statusMessage: string = buildUnclaimedScanDiagnosis(
      probeStateById.get(probeId)!,
    );

    /*
     * Only write when the sentence actually changes. This job runs every
     * minute and a probe can stay offline for days; re-writing the identical
     * message would be one UPDATE per scan per minute forever, and — because
     * the write bumps updatedAt — would also reset the very clock the query
     * above uses.
     *
     * The message is not frozen by this, though: it carries a relative
     * "last seen" ("6 hours ago"), so it rewrites itself as that phrase
     * changes rather than going stale on the row.
     */
    if (scan.statusMessage === statusMessage) {
      continue;
    }

    logger.warn(
      `Discovery scan ${scan.id?.toString()} (${scan.cidr}) has been Pending for over ${UNCLAIMED_PENDING_MINUTES} minutes with no probe claiming it: ${statusMessage}`,
    );

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scan.id!,
      /*
       * statusMessage ONLY. The scan stays Pending on purpose — it is still
       * runnable the moment the probe comes back, and the claim endpoint
       * clears this note when it picks the scan up.
       *
       * Cast: the model's JSON column makes DeepPartial recursion blow up,
       * same workaround as the passes above.
       */
      data: {
        statusMessage: statusMessage,
      } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
      props: {
        isRoot: true,
      },
    });
  }
}
