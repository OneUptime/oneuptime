import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";

/*
 * ------------------------------------------------------------------
 * Cloud:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Flip cloud environments to "disconnected" when telemetry has
 *      stopped arriving. CloudResourceService.markDisconnectedResources
 *      was written but never scheduled — verified: this cron is its
 *      only scheduled caller in the repo — so until now every cloud
 *      environment's status pill read "Connected" forever, including
 *      environments whose collector had been torn down months earlier.
 *      The 15-minute threshold and the reason it must stay well above
 *      the 5-minute OTel ingest maintenance fence both live in that
 *      service, so this cron carries no duplicate policy. Every other
 *      pillar has the identical sweeper (Docker / IoT / Proxmox / Ceph /
 *      DockerSwarm / Host / RUM).
 *   2. For each CONNECTED environment, hard-delete CloudResourceInstance
 *      rows (running tasks) whose lastSeenAt is older than the stale
 *      threshold. Tasks churn on every deploy and scale event and
 *      nothing ever reports a task as gone — it just stops sending — so
 *      without this the Instances tab and the overview's "running
 *      tasks" count every task that ever existed. Threshold and delete
 *      both live in CloudResourceInstanceService (getStaleThresholdDate /
 *      deleteStaleForResource — default 15 minutes = 3x the ingest
 *      fence; override with CLOUD_INSTANCE_STALE_MINUTES, minimum 10) so
 *      this cron carries no duplicate policy. The cutoff is anchored to
 *      each environment's own lastSeenAt rather than wall-clock now:
 *      instance rows and the environment row are refreshed on the same
 *      fence-gated ingest path, so at collector death both go stale
 *      together, and with the disconnect and prune thresholds both at
 *      15 minutes a wall-clock cutoff could wipe the last-known task
 *      list of a still-"connected" environment on the tick just before
 *      step 1 would have flipped it. Anchoring freezes the prune clock
 *      at the last telemetry the environment actually sent.
 *
 * Skipping disconnected environments is deliberate: during a transient
 * collector outage we want to preserve the last-known inventory rather
 * than wipe the overview page. When telemetry resumes, the next batch
 * refreshes lastSeenAt on the environment and on every task that is
 * still alive, and only the tasks that really died age out on the
 * following tick.
 *
 * Cloud RESOURCES (the IaaS and PaaS resources discovered from Azure
 * Monitor, CloudWatch and Cloud Monitoring - CloudResourceKind.Resource)
 * have no instances. They get two steps of their own:
 *   3. "Not reporting" after CLOUD_RESOURCE_DISCONNECTED_MINUTES (60)
 *      without a datapoint - longer than an environment's 15, because a
 *      collector polls the provider's monitoring API every one to five
 *      minutes and a quiet resource can skip polls. One set-based
 *      UPDATE (markUnreportedMonitoredResources).
 *   4. Archived after CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS (default 7) without
 *      a datapoint - nothing ever reports a resource as deleted, it just
 *      stops reporting - and restored as soon as it reports again
 *      (archiveUnseenMonitoredResources / restoreReportingMonitoredResources;
 *      the rules for a person's own archive and restore live there).
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Cloud:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      /*
       * Step 1: flip stale environments to disconnected so step 2
       * skips them. Its own try block — a failure here must not stop
       * the prune, and vice versa.
       */
      try {
        await CloudResourceService.markDisconnectedResources();
      } catch (err) {
        logger.error(
          `${JOB_NAME}: markDisconnectedResources failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Steps 3 and 4: cloud resources discovered from cloud monitoring.
       * Each in its own try block, like step 1: one failing must not stop
       * the others or the instance prune below.
       */
      try {
        await CloudResourceService.markUnreportedMonitoredResources();
      } catch (err) {
        logger.error(
          `${JOB_NAME}: markUnreportedMonitoredResources failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        const restored: number =
          await CloudResourceService.restoreReportingMonitoredResources();
        const archived: number =
          await CloudResourceService.archiveUnseenMonitoredResources();
        if (restored > 0 || archived > 0) {
          logger.debug(
            `${JOB_NAME}: restored ${restored} and archived ${archived} cloud resource(s)`,
          );
        }
      } catch (err) {
        logger.error(
          `${JOB_NAME}: cloud resource auto-archive failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale instance rows for environments that are
       * still believed to be connected.
       */
      const connectedResources: Array<CloudResource> =
        await CloudResourceService.findBy({
          query: {
            // Only environments have instances.
            cloudResourceKind: CloudResourceKind.Environment,
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

      if (connectedResources.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const resource of connectedResources) {
        if (!resource._id) {
          continue;
        }

        // Anchor the cutoff to this environment's lastSeenAt (see header).
        const cutoff: Date = CloudResourceInstanceService.getStaleThresholdDate(
          resource.lastSeenAt || undefined,
        );

        try {
          const deleted: number =
            await CloudResourceInstanceService.deleteStaleForResource({
              cloudResourceId: new ObjectID(resource._id.toString()),
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `${JOB_NAME}: deleteStaleForResource failed for cloud environment ${resource._id.toString()} (project ${resource.projectId?.toString() || "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `${JOB_NAME}: pruned ${totalDeleted} stale CloudResourceInstance row(s) across ${connectedResources.length} connected cloud environment(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
