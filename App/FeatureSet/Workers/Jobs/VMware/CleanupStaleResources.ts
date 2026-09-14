import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * VMware:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Mark vCenters as disconnected if they have not been seen for
 *      15 minutes (VMwareVCenterService.markDisconnectedVCenters —
 *      this cron is its only scheduled caller). The VMware agent is
 *      the OpenTelemetry Collector `vcenter` receiver, which polls the
 *      vSphere SDK every `collection_interval` (default 2 minutes),
 *      so a healthy vCenter legitimately goes ~2 minutes between
 *      batches with no telemetry at all, and
 *      lastSeenAt is additionally up to ~5 minutes stale during
 *      continuous telemetry because ingest throttles the heartbeat
 *      behind the Redis maintenance fence. 15 minutes is 3x that
 *      fence and 7x the collection interval: a threshold equal to
 *      either would flap healthy vCenters between connected and
 *      disconnected. Net SLA: the list-page status pill flips to
 *      Disconnected <= ~20 minutes after the agent dies (15-minute
 *      threshold + up to one 5-minute cron tick).
 *   2. For each CONNECTED vCenter, hard-delete VMwareResource
 *      inventory rows (hosts, virtual machines, datastores, clusters,
 *      resource pools, datacenters) whose last snapshot is older than
 *      the stale threshold. Threshold and delete both live in
 *      VMwareResourceService (getStaleThresholdDate /
 *      deleteStaleForVCenter — default 15 minutes = 7x the 2-minute
 *      collection interval; override with
 *      VMWARE_INVENTORY_STALE_MINUTES, minimum 5) so this cron carries
 *      no duplicate policy. A row survives at most ~7 missed
 *      collections, so a VM that was deleted in vCenter, a host that
 *      was removed from inventory or a datastore that was unmounted
 *      disappears from the inventory pages within ~20 minutes
 *      (15-minute threshold + up to one cron tick). The cutoff is
 *      anchored to each vCenter's own lastSeenAt rather than
 *      wall-clock now: inventory rows ride the slower snapshot clock,
 *      so with the disconnect and prune thresholds both at 15 minutes
 *      a wall-clock cutoff could wipe the last-known inventory of a
 *      still-connected vCenter late in an outage — on the tick just
 *      before step 1 would have flipped it. Anchoring freezes the
 *      prune clock at the last telemetry the vCenter actually sent.
 *
 * Skipping disconnected vCenters is deliberate: during a transient
 * agent outage (collector restart, vCenter maintenance, an expired
 * read-only session) we want to preserve the last-known inventory
 * rather than wipe the overview page. When the agent reconnects, the
 * next batch refreshes lastSeenAt on the vCenter and on every object
 * the receiver still reports, and only the objects that really went
 * away age out on the following tick.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "VMware:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      /*
       * Step 1: flip stale vCenters to disconnected so step 2 skips
       * them. Its own try block — a failure here must not stop the
       * prune, and vice versa.
       */
      try {
        await VMwareVCenterService.markDisconnectedVCenters();
      } catch (err) {
        logger.error(
          `${JOB_NAME}: markDisconnectedVCenters failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale inventory rows for vCenters that are
       * still believed to be connected.
       */
      const connectedVCenters: Array<VMwareVCenter> =
        await VMwareVCenterService.findBy({
          query: {
            otelCollectorStatus: "connected",
          },
          select: {
            _id: true,
            projectId: true,
            lastSeenAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      if (connectedVCenters.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const vcenter of connectedVCenters) {
        if (!vcenter._id) {
          continue;
        }

        // Anchor the cutoff to this vCenter's lastSeenAt (see header).
        const cutoff: Date = VMwareResourceService.getStaleThresholdDate(
          vcenter.lastSeenAt || undefined,
        );

        try {
          const deleted: number =
            await VMwareResourceService.deleteStaleForVCenter({
              vmwareVCenterId: new ObjectID(vcenter._id.toString()),
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `${JOB_NAME}: deleteStaleForVCenter failed for vCenter ${vcenter._id.toString()} (project ${vcenter.projectId?.toString() || "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `${JOB_NAME}: pruned ${totalDeleted} stale VMwareResource row(s) across ${connectedVCenters.length} connected vCenter(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
